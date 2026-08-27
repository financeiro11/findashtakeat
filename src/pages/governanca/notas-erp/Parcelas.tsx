import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { useAuth } from "@/hooks/useAuth";

/**
 * "A nota desta compra parcelada também vale para as outras parcelas."
 *
 * POR QUE ESTA ABA EXISTE. Compra em 6x vira SEIS títulos no Omie, e a nota ia
 * só ao que casou — quem abrisse a parcela 5/6 não achava nada e o contador
 * cobrava um documento que já estava no sistema. Medido em 27/08/2026: 60
 * compras nessa situação, 225 títulos sem a nota que já existe.
 *
 * O QUE APARECE AQUI É SÓ O DUVIDOSO. O casamento com confiança alta é anexado
 * pelo cron sem passar por ninguém — pedir confirmação para 225 pares seria
 * transformar uma correção em trabalho manual. Sobra a dúvida real: duas compras
 * iguais do mesmo fornecedor, no mesmo dia, no mesmo plano, em que os números de
 * parcela se repetem. Nem uma pessoa separa isso sem abrir a nota, e anexar no
 * título errado é pior que não anexar — o próximo a olhar vai acreditar.
 */

interface Proposta {
  id: number;
  cod_titulo_origem: number;
  cod_titulo: number;
  parcela: string | null;
  origem: string;
  confianca: string;
  motivo: string;
  status: string;
  erro: string | null;
  created_at: string;
}

const db = supabase as any;

export function Parcelas() {
  const { profile } = useAuth();
  const [linhas, setLinhas] = useState<Proposta[] | null>(null);
  const [rodando, setRodando] = useState(false);
  const [decidindo, setDecidindo] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await db
      .from("omie_parcela_anexo")
      .select("*")
      .in("status", ["proposto", "confirmado", "anexado", "recusado"])
      .order("created_at", { ascending: false })
      .limit(400);
    setLinhas((data as Proposta[]) ?? []);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const grupos = useMemo(() => {
    const todas = linhas ?? [];
    return {
      revisar: todas.filter((l) => l.status === "proposto"),
      naFila: todas.filter((l) => l.status === "confirmado"),
      prontas: todas.filter((l) => l.status === "anexado"),
      recusadas: todas.filter((l) => l.status === "recusado"),
      comErro: todas.filter((l) => l.erro && l.status !== "anexado"),
    };
  }, [linhas]);

  /* Procurar é SEMPRE simulação neste botão. Quem escreve no ERP é o cron, em
     lotes de cinco — e escrita no ERP não se desfaz com um clique. */
  async function procurar() {
    setRodando(true);
    try {
      const r = await invocar<any>(supabase.functions.invoke("omie-anexar-comprovante", {
        body: { action: "parcelas", simular: true },
      }));
      toast.success(
        `${r.compras_parceladas_com_irma_sem_nota} compra(s) parcelada(s) com parcela sem nota · ` +
        `${r.parcelas_a_receber} título(s) a receber` +
        (r.para_revisao ? ` · ${r.para_revisao} para você conferir` : ""),
      );
      await carregar();
    } catch (e: any) {
      toast.error(e.message ?? "Não consegui procurar as parcelas.");
    } finally { setRodando(false); }
  }

  async function decidir(l: Proposta, status: "confirmado" | "recusado") {
    setDecidindo(l.id);
    const { error } = await db.from("omie_parcela_anexo").update({
      status,
      decidido_por: profile?.nome ?? null,
      decidido_em: new Date().toISOString(),
    }).eq("id", l.id);
    setDecidindo(null);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "confirmado"
      ? "Confirmado — a nota vai nesta parcela na próxima rodada."
      : "Recusado. Não vai ser proposto de novo.");
    setLinhas((p) => (p ?? []).map((x) => (x.id === l.id ? { ...x, status } : x)));
  }

  if (!linhas) return <Skeleton className="h-64 rounded-lg" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-[13px] text-muted-foreground">
          Compra parcelada vira vários títulos no Omie, e a nota ia só a um deles. O Hub acha as parcelas irmãs e leva o mesmo
          documento para todas. <span className="font-medium text-foreground">O que está aqui embaixo é só o que ficou duvidoso</span> —
          o casamento claro é anexado sozinho, de hora em hora.
        </p>
        <Button variant="outline" onClick={procurar} disabled={rodando}>
          {rodando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Procurar parcelas
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi rotulo="Para você conferir" valor={grupos.revisar.length} destaque={grupos.revisar.length > 0} />
        <Kpi rotulo="Na fila do anexo" valor={grupos.naFila.length} />
        <Kpi rotulo="Já anexadas" valor={grupos.prontas.length} bom />
        <Kpi rotulo="Recusadas" valor={grupos.recusadas.length} />
      </div>

      {grupos.comErro.length > 0 && (
        /* Erro de anexo não pode ficar só no log do worker: é assim que uma
           parcela fica "na fila" para sempre sem ninguém saber por quê. */
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> {grupos.comErro.length} tentativa(s) com erro
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-muted-foreground">
            {grupos.comErro.slice(0, 4).map((l) => (
              <li key={l.id}>título {l.cod_titulo} ({l.parcela}) — {l.erro}</li>
            ))}
          </ul>
        </div>
      )}

      {grupos.revisar.length === 0 ? (
        <div className="card-surface py-12 text-center text-[13px] text-muted-foreground">
          Nada para conferir. O que o Hub não consegue afirmar sozinho aparece aqui — normalmente quando o mesmo fornecedor tem
          duas compras iguais, no mesmo dia e no mesmo número de parcelas.
        </div>
      ) : (
        <div className="card-surface divide-y divide-border">
          {grupos.revisar.map((l) => (
            <div key={l.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium text-foreground">Parcela {l.parcela ?? "—"}</span>
                  <span className="text-muted-foreground">título {l.cod_titulo}</span>
                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    {l.confianca}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">{l.motivo}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground/80">
                  a nota viria do título {l.cod_titulo_origem} · casamento por {l.origem === "cartao" ? "chave do cartão" : "evidência"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" disabled={decidindo === l.id} onClick={() => decidir(l, "recusado")}>
                  <X className="mr-1.5 h-3.5 w-3.5" /> Não é a mesma compra
                </Button>
                <Button size="sm" disabled={decidindo === l.id} onClick={() => decidir(l, "confirmado")}>
                  {decidindo === l.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                  É a mesma — anexar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {grupos.prontas.length > 0 && (
        <details className="card-surface p-4">
          <summary className="cursor-pointer text-[12.5px] font-medium text-foreground">
            {grupos.prontas.length} parcela(s) que já receberam a nota
          </summary>
          <div className="mt-3 max-h-64 overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 bg-muted/50 text-left uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Parcela</th>
                  <th className="px-2 py-1.5 font-semibold">Título</th>
                  <th className="px-2 py-1.5 font-semibold">Veio de</th>
                  <th className="px-2 py-1.5 font-semibold">Casamento</th>
                </tr>
              </thead>
              <tbody>
                {grupos.prontas.map((l) => (
                  <tr key={l.id} className="border-t border-border/60">
                    <td className="px-2 py-1.5 text-foreground">{l.parcela ?? "—"}</td>
                    <td className="num px-2 py-1.5 text-muted-foreground">{l.cod_titulo}</td>
                    <td className="num px-2 py-1.5 text-muted-foreground">{l.cod_titulo_origem}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{l.origem === "cartao" ? "chave do cartão" : "evidência"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, destaque, bom }: { rotulo: string; valor: number; destaque?: boolean; bom?: boolean }) {
  return (
    <div className={cn("card-surface p-3", destaque && "border-amber-500/30 bg-amber-500/5")}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className={cn(
        "num mt-0.5 text-[22px] font-semibold leading-none",
        destaque ? "text-amber-700 dark:text-amber-400" : bom ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
      )}>
        {valor}
      </div>
    </div>
  );
}
