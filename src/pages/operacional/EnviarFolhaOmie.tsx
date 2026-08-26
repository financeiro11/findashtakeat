/**
 * O rodapé da prévia: enviar o lote ao Omie, ou testar com dois títulos antes.
 *
 * O TESTE existe por uma dúvida concreta que a documentação não responde: o
 * exemplo do `IncluirContaPagarPorLote` mostra só os campos simples, e não
 * prova que o endpoint em lote aceita `departamentos` e
 * `cnab_integracao_bancaria`. Se ignorar os blocos aninhados, o título nasce
 * sem departamento e sem os dados do PIX — e isso NÃO dá erro, só sai errado.
 * Descobrir isso com dois títulos custa dois cliques; com cento e dois, custa
 * uma folha inteira remontada à mão.
 *
 * Por isso o teste devolve as chaves criadas e um botão para apagá-las. Teste
 * sem desfazer é aposta.
 */

import { useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { doisParaTestar, type Candidato } from "@/lib/folha/teste";

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/** O que `folha-omie-enviar` devolve, nas três ações. */
type Resposta = {
  status: string;
  erro?: string;
  titulos?: number;
  /** As chaves `FOLHA-…` criadas — é por elas que o teste é desfeito. */
  integracoes?: string[];
  respostas?: unknown[];
};

export default function EnviarFolhaOmie({
  competencia, candidatos, totalDoLote, recusa, onEnviado,
}: {
  competencia: string;
  candidatos: Candidato[];
  totalDoLote: number;
  /** Motivo que impede o envio completo. `null` = liberado. */
  recusa: string | null;
  onEnviado: () => void;
}) {
  const [ocupado, setOcupado] = useState<null | "teste" | "tudo" | "limpar">(null);
  const [criados, setCriados] = useState<string[]>([]);
  const [confirmando, setConfirmando] = useState(false);

  const teste = doisParaTestar(candidatos);

  const chamar = async (body: Record<string, unknown>): Promise<Resposta> => {
    const { data, error } = await supabase.functions.invoke("folha-omie-enviar", { body });
    if (error) throw new Error(error.message);
    const r = data as Resposta;
    if (r?.status !== "ok") throw new Error(r?.erro || "Falha ao falar com o Omie.");
    return r;
  };

  const enviarTeste = async () => {
    setOcupado("teste");
    try {
      const r = await chamar({
        acao: "enviar", competencia, codigos: teste.map((t) => t.codigo),
      });
      setCriados(r.integracoes ?? []);
      toast.success(`${r.titulos} título(s) criados no Omie`, {
        description: "Confira no ERP se o departamento e o PIX chegaram.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async () => {
    setOcupado("limpar");
    try {
      await chamar({ acao: "excluir", integracoes: criados });
      setCriados([]);
      toast.success("Títulos de teste apagados do Omie");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  const enviarTudo = async () => {
    setOcupado("tudo");
    try {
      const r = await chamar({ acao: "enviar", competencia });
      toast.success(`Folha de ${competencia} provisionada — ${r.titulos} títulos`);
      setConfirmando(false);
      onEnviado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-3 border-t pt-3">
      {criados.length > 0 && (
        <div className="rounded-xl border border-[hsl(var(--info)/0.3)] bg-[hsl(var(--info)/0.08)] px-3.5 py-2.5">
          <p className="text-[12.5px] font-semibold text-[hsl(var(--info))]">
            {criados.length} título(s) de teste criados no Omie
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Abra no ERP e confira o que a documentação não garante: se o <b>departamento</b> está
            preenchido e se os dados do <b>PIX</b> chegaram. Depois apague por aqui.
          </p>
          <ul className="mono mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
            {criados.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <Button
            variant="outline" size="sm" className="mt-2 gap-1.5"
            onClick={excluir} disabled={ocupado !== null}
          >
            {ocupado === "limpar" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Apagar os {criados.length} do Omie
          </Button>
        </div>
      )}

      {confirmando && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
          <p className="text-[12.5px] font-semibold text-destructive">
            Criar {candidatos.length} títulos de {BRL(totalDoLote)} no Omie?
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Isto marca a competência {competencia} como enviada e passa a recusar um segundo
            envio. Desfazer depois é apagar título por título no ERP.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmando(false)} disabled={ocupado !== null}>
              Cancelar
            </Button>
            <Button size="sm" onClick={enviarTudo} disabled={ocupado !== null} className="gap-1.5">
              {ocupado === "tudo" && <Loader2 className="size-3.5 animate-spin" />}
              Confirmo, provisionar
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className={cn("max-w-[55%] text-xs", recusa ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {recusa ?? "Lote em ordem. Nada é criado até você clicar."}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={enviarTeste}
            disabled={ocupado !== null || teste.length === 0 || criados.length > 0}
            title={teste.length === 0
              ? "Ninguém pronto para o teste — resolva as pendências primeiro."
              : `Cria só ${teste.map((t) => t.nome).join(" e ")} no Omie, para conferir o formato.`}
            className="gap-1.5"
          >
            {ocupado === "teste" ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
            Testar com {teste.length}
          </Button>
          <Button
            onClick={() => setConfirmando(true)}
            disabled={ocupado !== null || !!recusa || confirmando}
            title={recusa ?? undefined}
            className="gap-1.5"
          >
            <Send className="size-4" />
            Provisionar {candidatos.length} no Omie
          </Button>
        </div>
      </div>
    </div>
  );
}
