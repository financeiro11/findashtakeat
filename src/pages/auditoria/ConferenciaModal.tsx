import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, AlertCircle, Loader2, Sparkles, FileText, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { brl, fmtDateBR } from "./utils";

/* ---------------------------------------------------------------------------
 * "Conferir comprovantes": a tela da leitura automática.
 *
 * O que bate com a nota SAI APROVADO na hora — a lista abaixo é o extrato do que
 * aconteceu, não uma fila esperando um segundo clique. Aprovar era um botão à
 * parte enquanto a regra estava em observação; ela se provou nas notas de ago/26
 * e reconferir na mão o que a regra já conferiu virou trabalho por nada. Nada se
 * perde: a trilha guarda o motivo escrito e o status volta como qualquer outro.
 *
 * O que continua sendo dois passos é a LEITURA: ela custa cota da chave do
 * Gemini, então só sai quando alguém pede, em lotes. O que a IA lê fica gravado
 * no achado (`ia_leitura`), e reabrir uma conferência antiga não gasta nada.
 * ------------------------------------------------------------------------- */

export type ItemConferido = {
  id: number;
  id_unico: string;
  titulo: string;
  valor: number;
  data: string;
  responsavel: string | null;
  veredito: "aprovar" | "revisar";
  /** true = o status já virou "Aprovado" no banco nesta rodada. */
  aprovado: boolean;
  status: string;
  motivo: string;
  como: "total" | "item" | "parcela" | "nenhum";
  valor_casado: number | null;
  item_rotulo: string | null;
  /** "1/2" quando a cobrança é uma parcela do documento; null nos outros casos. */
  parcela: string | null;
  emitente: string;
  emitente_cnpj: string | null;
  tipo_documento: string;
  valor_documento: number;
  data_documento: string | null;
  numero_documento: string | null;
  descricao: string;
};

type Resumo = {
  lidos: number;
  /** Quantos desta rodada já foram para "Aprovado" no banco. */
  aprovados: number;
  para_revisar: number;
  restantes: number;
  quota_esgotada: boolean;
  /** true = cota do dia; false = cota por minuto, que passa em instantes. */
  quota_por_dia: boolean;
  modelo?: string;
  itens: ItemConferido[];
  erros: { id: number; titulo: string; erro: string }[];
};

/** O corpo de erro da função — ela responde 200 com a mensagem pronta. */
type Falha = { error?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Recarrega a lista da página depois de conferir/aprovar. */
  onMudou: () => void;
  competencia: string;
  /** Quantos achados da fatura têm comprovante e ainda estão em aberto. */
  totalComComprovante: number;
};

const LOTE = 10;

export default function ConferenciaModal({ open, onClose, onMudou, competencia, totalComComprovante }: Props) {
  const [lendo, setLendo] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Cada abertura começa limpa: um resumo velho ao lado de uma fatura nova mente.
  useEffect(() => { if (open) { setResumo(null); setErro(null); } }, [open, competencia]);

  const conferir = async (reler = false) => {
    setLendo(true); setErro(null);
    const { data, error } = await supabase.functions.invoke("auditoria-conferir-comprovante", {
      body: { action: "conferir", competencia, limite: LOTE, reler },
    });
    setLendo(false);
    if (error) { setErro(error.message); return; }
    // A função devolve 200 com `{ error }` no corpo para o erro chegar legível
    // no toast em vez de virar "FunctionsHttpError" — é o padrão do resto do Hub.
    const falha = (data as Falha)?.error;
    if (falha) { setErro(falha); return; }

    const r = data as Resumo;
    /* Acumula em vez de substituir: a cota lê de dez em dez e quem já apareceu
       na lista continua nela. `restantes` e `quota_esgotada` são sempre os da
       última rodada — é o estado de agora, não a soma de nada. As contagens da
       tela saem de `itens`, então não há contador para somar aqui. */
    setResumo((ant) => {
      if (!ant) return r;
      const vistos = new Set(r.itens.map((i) => i.id));
      return {
        ...r,
        itens: [...r.itens, ...ant.itens.filter((i) => !vistos.has(i.id))],
        erros: [...r.erros, ...ant.erros.filter((e) => !r.erros.some((n) => n.id === e.id))],
        lidos: ant.lidos + r.lidos,
      };
    });
    if (r.aprovados > 0) {
      toast.success(`${r.aprovados} lançamento${r.aprovados === 1 ? "" : "s"} aprovado${r.aprovados === 1 ? "" : "s"}: bate com a nota.`);
    }
    onMudou();
  };

  const itens = resumo?.itens ?? [];
  /* Separa pelo que ACONTECEU, não pelo veredito: se a gravação do status falhou,
     o item cai no bloco de baixo — que é onde alguém precisa olhar mesmo. */
  const aprovados = itens.filter((i) => i.aprovado);
  const revisar = itens.filter((i) => !i.aprovado);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !lendo) onClose(); }}>
      <DialogContent className="sm:max-w-[760px] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[hsl(212_80%_45%)]" />
            Conferir comprovantes
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            A IA lê cada nota anexada e compara com a cobrança. O que tem o{" "}
            <strong>valor exato</strong> e o <strong>fornecedor confirmado</strong> vai direto
            para <strong>Aprovado</strong> — o resto continua com você.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-4">
          {!resumo && !lendo && (
            <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <FileText className="h-4 w-4 text-muted-foreground" />
                {totalComComprovante} lançamento{totalComComprovante === 1 ? "" : "s"} com comprovante nesta fatura
              </div>
              <p className="text-muted-foreground mt-2">
                A leitura sai em lotes de {LOTE}. O que bater com a nota já muda para Aprovado, com
                o motivo escrito na trilha do lançamento.
              </p>
            </div>
          )}

          {erro && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {erro}
            </div>
          )}

          {lendo && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo os comprovantes… pode levar até 2 minutos.
            </div>
          )}

          {resumo?.quota_esgotada && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {resumo.quota_por_dia
                  ? "A cota da chave do Gemini acabou por hoje. O que já foi lido está aqui e ficou gravado; o resto sai amanhã (ou hoje mesmo, com faturamento ligado no projeto do Google)."
                  : "A chave bateu no limite por minuto. Espere alguns segundos e clique em \"Ler mais\" — o que já foi lido está gravado."}
              </span>
            </div>
          )}

          {aprovados.length > 0 && (
            <Secao
              titulo={`Aprovados · bate com a nota (${aprovados.length})`}
              cor="verde"
              itens={aprovados}
            />
          )}
          {revisar.length > 0 && (
            <Secao
              titulo={`Precisa de olho humano (${revisar.length})`}
              cor="ambar"
              itens={revisar}
            />
          )}

          {resumo?.erros?.length ? (
            <div className="rounded-xl border border-border p-4 space-y-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                Não deu para ler ({resumo.erros.length})
              </div>
              {resumo.erros.map((e) => (
                <div key={e.id} className="text-sm">
                  <span className="font-medium">{e.titulo}</span>
                  <span className="text-muted-foreground"> — {e.erro}</span>
                </div>
              ))}
            </div>
          ) : null}

          {resumo && resumo.restantes > 0 && !resumo.quota_esgotada && (
            <div className="text-center text-sm text-muted-foreground">
              Faltam {resumo.restantes} comprovante{resumo.restantes === 1 ? "" : "s"} para ler.
            </div>
          )}
        </div>

        <div className="border-t border-border px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-muted-foreground">
            {resumo
              ? `${resumo.lidos} lido${resumo.lidos === 1 ? "" : "s"}${resumo.modelo ? ` · ${resumo.modelo}` : ""}`
              : "Nenhuma leitura ainda"}
          </div>
          <div className="flex items-center gap-2">
            {aprovados.length > 0 && (
              <span className="text-xs font-medium text-[hsl(152_60%_28%)] inline-flex items-center gap-1">
                <Check className="h-3.5 w-3.5" />
                {aprovados.length} aprovado{aprovados.length === 1 ? "" : "s"}
              </span>
            )}
            <Button variant="outline" onClick={onClose} disabled={lendo} className="h-9">
              Fechar
            </Button>
            {/* Enquanto sobra fila, o botão lê o próximo lote. Com a fila zerada
                ele relê do zero — serve para quando alguém trocou a nota ou a
                leitura saiu torta e vale gastar cota de novo. */}
            <Button
              variant="outline"
              onClick={() => conferir(!!resumo && resumo.restantes === 0)}
              disabled={lendo}
              className="h-9"
              title={resumo && resumo.restantes === 0 ? "Lê os comprovantes de novo, gastando cota" : undefined}
            >
              {lendo ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {!resumo ? "Ler comprovantes" : resumo.restantes > 0 ? "Ler mais" : "Ler de novo"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Secao({ titulo, cor, itens }: { titulo: string; cor: "verde" | "ambar"; itens: ItemConferido[] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className={cn(
        "px-4 py-2 text-[11px] uppercase tracking-wider font-semibold border-b border-border",
        cor === "verde"
          ? "bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)]"
          : "bg-[hsl(48_96%_92%)] text-[hsl(38_80%_32%)]",
      )}>
        {titulo}
      </div>
      {itens.map((i) => (
        <div key={i.id} className="px-4 py-3 border-b border-border last:border-0 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-medium text-sm min-w-0 truncate">
              {i.titulo}
              {/* Compra parcelada: o valor da linha é um pedaço do da nota, e a
                  mesma nota volta a explicar a fatura do mês que vem. */}
              {i.parcela && (
                <span className="ml-1.5 text-[10px] font-medium text-[hsl(212_80%_35%)]">parcela {i.parcela}</span>
              )}
            </div>
            <div className="num text-sm font-medium shrink-0">{brl(i.valor)}</div>
          </div>
          <div className="text-xs text-muted-foreground">
            {i.responsavel || "sem responsável"} · {fmtDateBR(i.data)}
          </div>
          <div className="text-[13px] text-foreground/80">{i.motivo}</div>
          {/* O que a IA leu, para conferir sem reabrir o PDF. */}
          <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{i.tipo_documento || "documento"}</span>
            {i.numero_documento && <span>nº {i.numero_documento}</span>}
            {i.data_documento && <span>emitido {fmtDateBR(i.data_documento)}</span>}
            {i.emitente_cnpj && <span>{i.emitente_cnpj}</span>}
            {i.valor_documento > 0 && <span>total do documento {brl(i.valor_documento)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
