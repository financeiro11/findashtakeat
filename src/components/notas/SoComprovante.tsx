/* ---------------------------------------------------------------------------
 * SÓ COMPROVANTE — o que tem papel e não tem nota, e de quem se cobra.
 *
 * Pedido de 27/08/2026: *"lançamentos que tenham recibo ou outro comprovante que
 * não é nota fiscal eu preciso que fiquem sinalizados. Não precisa considerar na
 * parte vermelha, mas deixa sinalizado, porque se um dia aparecer a NF ela tem
 * que ser colocada nesses lugares."*
 *
 * DUAS LISTAS NA MESMA SEÇÃO, e elas são a mesma coisa vista dos dois lados:
 * o que ainda se cobra (por valor, porque vira e-mail) e o que já se resolveu
 * (por data, porque é notícia). Separar em duas telas faria a segunda nunca ser
 * aberta — e ela é a única que responde "adiantou cobrar?".
 *
 * O CADASTRO FICA AQUI, e não numa tela de configuração distante: o momento em
 * que se descobre que um fornecedor não emite nota é exatamente o momento em que
 * se olha para a linha dele nesta lista. Um clique tira o título daqui e o põe
 * no verde, com o motivo escrito.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brlStr, dataStr } from "@/lib/notasErp";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BadgeCheck, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";

const sb = supabase as any;

/** Como cada tipo de papel se chama na tela. */
const PAPEL: Record<string, string> = {
  recibo: "recibo",
  comprovante_pagamento: "comprovante de pagamento",
  boleto: "boleto",
  extrato: "extrato",
  print_de_tela: "print de tela",
  nota_fiscal: "nota fiscal",
  cupom_fiscal: "cupom fiscal",
};

type Linha = {
  cod_titulo: number;
  favorecido: string;
  valor: number;
  competencia: string | null;
  categoria: string;
  anexo_tipo: string | null;
  documento_classe: string | null;
  situacao: string;
  virou_nota_em: string | null;
};

type SemNf = { id: number; padrao_nome: string; motivo: string };

export function SoComprovante({ de, ate }: { de: string; ate: string }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [semNf, setSemNf] = useState<SemNf[]>([]);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [tudo, setTudo] = useState(false);

  const ler = useCallback(async () => {
    const [a, b] = await Promise.all([
      sb.rpc("cap_notas_so_comprovante", { p_de: de, p_ate: ate, p_dias: 14, p_limite: 300 }),
      sb.from("fornecedor_sem_nf").select("id, padrao_nome, motivo")
        .is("resolvido_em", null).order("padrao_nome"),
    ]);
    if (a.error) { toast.error(`Não deu para ler: ${a.error.message}`); setLinhas([]); }
    else setLinhas((a.data as Linha[]) ?? []);
    if (!b.error) setSemNf((b.data as SemNf[]) ?? []);
  }, [de, ate]);

  useEffect(() => { void ler(); }, [ler]);

  /* O NOME QUE VAI PARA O CADASTRO é um TRECHO, não o nome inteiro: o extrato
     escreve "UBER *TRIP" hoje e "DL*UberRides" amanhã. Pega-se a primeira
     palavra com quatro letras ou mais, que é a que sobrevive às grafias. */
  async function naoEmite(l: Linha) {
    const palavras = String(l.favorecido || "").split(/[^A-Za-zÀ-ÿ0-9]+/).filter((p) => p.length >= 4);
    const trecho = (palavras[0] || l.favorecido || "").toLowerCase();
    if (!trecho) { toast.error("Não consegui tirar um nome desta linha."); return; }
    setSalvando(String(l.cod_titulo));
    const { error } = await sb.from("fornecedor_sem_nf").insert({
      padrao_nome: trecho,
      motivo: `Não emite nota fiscal — marcado a partir do título ${l.cod_titulo} (${l.favorecido}).`,
      criado_por: "tela",
    });
    setSalvando(null);
    if (error) {
      toast.error(error.message.includes("duplicate") ? `"${trecho}" já está no cadastro.` : error.message);
      return;
    }
    toast.success(`"${trecho}" entrou na lista de quem não emite nota.`);
    await ler();
  }

  async function remover(id: number, nome: string) {
    const { error } = await sb.from("fornecedor_sem_nf")
      .update({ resolvido_em: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${nome}" saiu da lista — o recibo dele volta a não valer como nota.`);
    await ler();
  }

  if (!linhas) {
    return (
      <div className="card-surface flex items-center gap-2 p-4 text-[12.5px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> lendo…
      </div>
    );
  }

  const cobrar = linhas.filter((l) => l.situacao === "so_comprovante");
  const resolvidos = linhas.filter((l) => l.virou_nota_em && l.situacao !== "so_comprovante");
  const total = cobrar.reduce((s, l) => s + Number(l.valor || 0), 0);
  const mostrar = tudo ? cobrar : cobrar.slice(0, 15);

  if (!cobrar.length && !resolvidos.length && !semNf.length) return null;

  return (
    <div className="card-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Só comprovante — a nota fiscal ainda falta</h3>
          <p className="mt-0.5 max-w-3xl text-[12.5px] text-muted-foreground">
            Tem recibo, boleto ou comprovante de pagamento pendurado no título, e não é a
            nota. O gasto está provado — por isso não é vermelho — mas o fornecedor emite
            nota e ela não chegou. Quando chegar, entra neste mesmo título.
          </p>
        </div>
        <span className="text-[12.5px] text-muted-foreground">
          {cobrar.length} títulos · {brlStr(total)}
        </span>
      </div>

      <div className="mt-3 divide-y divide-border">
        {mostrar.map((l) => (
          <div key={l.cod_titulo} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{l.favorecido}</span>
            <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
              {PAPEL[String(l.anexo_tipo)] ?? "comprovante"}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {brlStr(Number(l.valor))} · {dataStr(l.competencia)}
            </span>
            <button
              className="chip shrink-0"
              disabled={salvando === String(l.cod_titulo)}
              onClick={() => void naoEmite(l)}
              title="Este fornecedor não emite nota fiscal — o recibo dele passa a valer como documento, aqui e em todo o Hub"
            >
              {salvando === String(l.cod_titulo)
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <BadgeCheck className="h-3.5 w-3.5" />}
              não emite NF
            </button>
          </div>
        ))}
        {!cobrar.length && (
          <p className="py-2 text-[12.5px] text-muted-foreground">
            Nada só com comprovante no período. À medida que a triagem abrir os anexos que
            ninguém leu, o que for recibo aparece aqui.
          </p>
        )}
      </div>

      {cobrar.length > 15 && (
        <button className="mt-2 text-[12.5px] text-muted-foreground hover:text-foreground"
                onClick={() => setTudo((v) => !v)}>
          {tudo ? "mostrar menos" : `ver os outros ${cobrar.length - 15}`}
        </button>
      )}

      {/* A COBRANÇA QUE DEU CERTO. Some da lista de cima e aparece aqui por duas
          semanas — sumir não é a mesma coisa que avisar. */}
      {!!resolvidos.length && (
        <div className="mt-4 rounded border border-emerald-500/25 bg-emerald-500/5 p-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            A nota chegou em {resolvidos.length} {resolvidos.length === 1 ? "título" : "títulos"} nos últimos 14 dias
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {resolvidos.slice(0, 8).map((l) => (
              <li key={l.cod_titulo} className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate">{l.favorecido}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {brlStr(Number(l.valor))} · {dataStr(l.virou_nota_em)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------------- quem não emite, e é editável ---------------- */}
      <div className="mt-4 border-t border-border pt-3">
        <p className="text-[12.5px] font-medium">Fornecedores que não emitem nota fiscal</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Para estes, o recibo É o documento: eles contam como cobertos e não aparecem em
          cobrança nenhuma. Vale em todo o Hub — na cobertura, no diagnóstico e na triagem
          de anexos.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {semNf.map((f) => (
            <span key={f.id} title={f.motivo}
                  className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11.5px]">
              {f.padrao_nome}
              <button className="text-muted-foreground hover:text-red-600"
                      onClick={() => void remover(f.id, f.padrao_nome)}
                      title="Tirar da lista — o recibo dele volta a não valer como nota">
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
          {!semNf.length && (
            <span className="text-[12px] text-muted-foreground">Ninguém cadastrado ainda.</span>
          )}
        </div>
        <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
          <Plus className="h-3 w-3" /> para acrescentar, use o botão
          <span className={cn("rounded border border-border px-1")}>não emite NF</span>
          na linha do fornecedor, acima.
        </p>
      </div>
    </div>
  );
}
