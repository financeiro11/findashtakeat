import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Json } from "@/integrations/supabase/types";
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
 *
 * QUEM BATEU O OLHO APROVA AQUI MESMO. O bloco "precisa de olho humano" não é
 * uma recusa: quase sempre é a IA sendo cautelosa (a razão social não parece o
 * nome da maquininha, a data do recibo é de outro dia). Quem está lendo o motivo
 * com o documento transcrito na frente já decidiu — mandar essa pessoa fechar o
 * modal, achar a linha na lista e aprovar por lá era refazer a mesma leitura.
 * O botão da linha grava a MESMA coisa que o menu da lista grava (status +
 * evento na trilha, com quem e quando), então não há dois jeitos de aprovar.
 *
 * UM CLIQUE LÊ A FATURA INTEIRA. Quem manda na rodada do servidor não é o lote
 * pedido, é o relógio: ela para no orçamento de 75 segundos para não ser morta
 * pelo limite de recurso do worker, e com PDF pesado isso dá TRÊS documentos por
 * chamada. Pedir 10 e receber 3 fazia a pessoa clicar "Ler mais" quatro vezes
 * para uma fatura de doze notas. Então quem encadeia é esta tela: chamada nova é
 * worker novo, com 75 segundos novos e memória limpa, e ela repete até a fila
 * zerar. O botão "Ler mais" continua ali para o que sobrar de cota ou de parada.
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
  /** true = quem aprovou foi a pessoa, aqui na tela, e não a regra. Só existe no
   *  front: no banco os dois são a mesma coisa, separados pela trilha. */
  aprovado_na_mao?: boolean;
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
  /** true = a rodada parou no orçamento de 75s do worker, não por falta de fila. */
  tempo_esgotado?: boolean;
  itens: ItemConferido[];
  /** `transitorio` = tropeço do serviço de IA; o achado continua na fila. */
  erros: { id: number; titulo: string; erro: string; transitorio?: boolean }[];
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
/* Trava de segurança do encadeamento. Não existe fatura com cem comprovantes:
   se chegar aqui, alguma coisa está andando em círculo e é melhor devolver o
   controle para a pessoa do que ficar gastando cota sozinho. */
const MAX_RODADAS = 12;

export default function ConferenciaModal({ open, onClose, onMudou, competencia, totalComComprovante }: Props) {
  const { user } = useAuth();
  const [lendo, setLendo] = useState(false);
  /** Id do achado que está sendo aprovado agora — trava só aquele botão. */
  const [aprovando, setAprovando] = useState<number | null>(null);
  const [rodada, setRodada] = useState(0);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /* O pedido de parar mora numa ref, não no estado: o laço é uma função só, e a
     variável de estado que ele leria ficaria congelada na primeira rodada. O
     estado ao lado existe só para o botão mudar de cara — ref não redesenha. */
  const pararRef = useRef(false);
  const [parando, setParando] = useState(false);

  // Cada abertura começa limpa: um resumo velho ao lado de uma fatura nova mente.
  useEffect(() => { if (open) { setResumo(null); setErro(null); setRodada(0); } }, [open, competencia]);
  // Fechar no meio não deixa rodada órfã disparando chamada atrás de chamada.
  useEffect(() => () => { pararRef.current = true; }, []);

  /** Uma chamada à função. Devolve o resumo da rodada, ou null se falhou. */
  const umaRodada = async (reler: boolean): Promise<Resumo | null> => {
    const { data, error } = await supabase.functions.invoke("auditoria-conferir-comprovante", {
      body: { action: "conferir", competencia, limite: LOTE, reler },
    });
    if (error) { setErro(error.message); return null; }
    // A função devolve 200 com `{ error }` no corpo para o erro chegar legível
    // no toast em vez de virar "FunctionsHttpError" — é o padrão do resto do Hub.
    const falha = (data as Falha)?.error;
    if (falha) { setErro(falha); return null; }

    const r = data as Resumo;
    /* Acumula em vez de substituir: a leitura sai em rodadas e quem já apareceu
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
    onMudou();
    return r;
  };

  const conferir = async (reler = false) => {
    setLendo(true); setErro(null); pararRef.current = false; setParando(false);
    let aprovados = 0;
    /* O que sobrava na rodada anterior. É por ele que se sabe se a rodada ANDOU:
       um documento que o serviço de IA não conseguiu ler continua na fila sem ser
       carimbado, e insistir nele seria repetir o mesmo tropeço até a trava. */
    let sobrava: number | null = null;
    try {
      for (let i = 0; i < MAX_RODADAS; i++) {
        setRodada(i + 1);
        const r = await umaRodada(reler && i === 0);
        if (!r) break;
        aprovados += r.aprovados;
        if (pararRef.current) break;
        if (r.restantes <= 0 || r.quota_esgotada) break;
        if (sobrava !== null && r.restantes >= sobrava) break;
        sobrava = r.restantes;
        /* "Ler de novo" é rodada única, de propósito. Com `reler`, a fila do
           servidor é a lista INTEIRA e a rodada é sempre a cabeça dela — encadear
           releria os mesmos três documentos para sempre. Quem quiser reler a
           fatura toda clica de novo. */
        if (reler) break;
      }
    } finally {
      setLendo(false);
      setRodada(0);
      setParando(false);
      pararRef.current = false;
    }
    // Um toast no fim, e não um por rodada: são quatro chamadas para uma fatura
    // de doze notas, e quatro avisos empilhados na tela não informam mais nada.
    if (aprovados > 0) {
      toast.success(`${aprovados} lançamento${aprovados === 1 ? "" : "s"} aprovado${aprovados === 1 ? "" : "s"}: bate com a nota.`);
    }
  };

  /** Aprova um achado daqui, com o documento à vista. Mesma gravação do menu da
   *  lista: status + evento na trilha, para a auditoria ter uma história só. */
  const aprovarNaMao = async (i: ItemConferido) => {
    setAprovando(i.id);
    try {
      /* A trilha é lida AGORA, não reaproveitada do resumo. O modal nunca a
         carregou, e escrever por cima de uma cópia velha apagaria o comentário
         que outra pessoa deixou enquanto esta tela estava aberta. De quebra, o
         status de verdade é o que vale no `de` do evento. */
      const { data: atual, error: eLer } = await supabase
        .from("auditoria").select("status, trilha").eq("id", i.id).maybeSingle();
      if (eLer) { toast.error("Não consegui ler o lançamento: " + eLer.message); return; }
      if (!atual) { toast.error("Lançamento não encontrado — recarregue a página."); return; }
      if (atual.status === "Aprovado") {
        toast.message("Este lançamento já estava aprovado.");
        marcarAprovado(i.id);
        return;
      }
      /* Reprovado é terminal na lista (`NEXT_STATUS` não dá saída para ele), e
         não é um botão de atalho que vai abrir essa porta pelos fundos. */
      if (atual.status === "Reprovado") {
        toast.error("Este lançamento foi reprovado — reabra pela lista, não por aqui.");
        return;
      }

      const evento = {
        em: new Date().toISOString(),
        por: user?.email ?? "desconhecido",
        de: String(atual.status),
        para: "Aprovado",
        // O que a IA achou fica escrito junto: quem abrir a trilha depois vê que
        // a ressalva existia e que alguém olhou o documento e decidiu assim mesmo.
        comentario: `Aprovado na conferência de comprovantes, com o documento à vista. A IA havia apontado: ${i.motivo}`,
      };
      const trilha = [...(Array.isArray(atual.trilha) ? atual.trilha : []), evento];

      const { error } = await supabase.from("auditoria")
        // A trilha é JSONB: o tipo gerado não descreve a forma do evento, então
        // ela entra como `Json` mesmo. (A lista faz o mesmo com `as any`, que o
        // eslint recusa em código novo.)
        .update({ status: "Aprovado", trilha: trilha as unknown as Json })
        .eq("id", i.id);
      if (error) { toast.error("Erro ao aprovar: " + error.message); return; }

      toast.success("Aprovado.");
      marcarAprovado(i.id);
      onMudou();
    } finally {
      setAprovando(null);
    }
  };

  /** Move o item para o bloco verde sem refazer leitura nenhuma. */
  const marcarAprovado = (id: number) =>
    setResumo((ant) => ant
      ? { ...ant, itens: ant.itens.map((x) => x.id === id ? { ...x, aprovado: true, aprovado_na_mao: true, status: "Aprovado" } : x) }
      : ant);

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
            para <strong>Aprovado</strong> — no resto, você decide aqui mesmo, no{" "}
            <strong>Aprovar</strong> da linha.
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
                Lê todos de uma vez, em rodadas de poucos segundos cada. O que bater com a nota já
                muda para Aprovado, com o motivo escrito na trilha do lançamento.
              </p>
            </div>
          )}

          {erro && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {erro}
            </div>
          )}

          {lendo && (
            <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground py-6">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lendo os comprovantes…
                {rodada > 1 && ` ${rodada}ª leva`}
              </span>
              {/* Sem isto, o silêncio de quatro minutos parece travamento. */}
              <span className="text-xs">
                {resumo
                  ? `${resumo.lidos} lido${resumo.lidos === 1 ? "" : "s"}, ${resumo.restantes} na fila · cada nota leva uns 20 segundos`
                  : "cada nota leva uns 20 segundos"}
              </span>
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

          {/* O título não promete mais "bate com a nota": o bloco passou a receber
              também o que a pessoa aprovou na mão, e esse não bate — ela é que
              olhou e decidiu. Quem é quem vai no selo de cada linha. */}
          {aprovados.length > 0 && (
            <Secao
              titulo={`Aprovados (${aprovados.length})`}
              cor="verde"
              itens={aprovados}
            />
          )}
          {revisar.length > 0 && (
            <Secao
              titulo={`Precisa de olho humano (${revisar.length})`}
              cor="ambar"
              itens={revisar}
              onAprovar={aprovarNaMao}
              aprovando={aprovando}
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

          {/* Sobrar fila com a leitura parada quer dizer que ela desistiu: a
              pessoa mandou parar, ou duas levas seguidas não conseguiram ler
              nada (serviço de IA fora do ar). Dizer só "faltam 5" fazia parecer
              que a rodada tinha um teto — e o teto não é de contagem. */}
          {resumo && resumo.restantes > 0 && !resumo.quota_esgotada && !lendo && (
            <div className="text-center text-sm text-muted-foreground">
              Faltam {resumo.restantes} comprovante{resumo.restantes === 1 ? "" : "s"} para ler.
              {resumo.erros.some((e) => e.transitorio)
                ? " A IA tropeçou nos últimos — espere um pouco e clique em \"Ler mais\"."
                : " Clique em \"Ler mais\" para continuar de onde parou."}
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
            {/* Parar termina a leva que está no ar e não começa a próxima. O que
                já saiu está gravado, e "Ler mais" retoma de onde parou. */}
            {lendo ? (
              <Button
                variant="outline"
                onClick={() => { pararRef.current = true; setParando(true); }}
                disabled={parando}
                className="h-9"
                title="Termina a leva em andamento e para"
              >
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {parando ? "Parando…" : "Parar"}
              </Button>
            ) : (
              /* Enquanto sobra fila, o botão retoma dali. Com a fila zerada ele
                 relê do zero — serve para quando alguém trocou a nota ou a
                 leitura saiu torta e vale gastar cota de novo. */
              <Button
                variant="outline"
                onClick={() => conferir(!!resumo && resumo.restantes === 0)}
                className="h-9"
                title={resumo && resumo.restantes === 0 ? "Lê os comprovantes de novo, gastando cota" : undefined}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {!resumo ? "Ler comprovantes" : resumo.restantes > 0 ? "Ler mais" : "Ler de novo"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Secao({ titulo, cor, itens, onAprovar, aprovando }: {
  titulo: string;
  cor: "verde" | "ambar";
  itens: ItemConferido[];
  /** Ausente no bloco verde: lá já está tudo aprovado. */
  onAprovar?: (i: ItemConferido) => void;
  aprovando?: number | null;
}) {
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
              {/* Sem isto, o aprovado na mão fica idêntico ao que a regra aprovou
                  sozinha — e o motivo logo abaixo é a RESSALVA, o que faria a
                  linha parecer aprovada apesar de a IA ter reprovado. */}
              {i.aprovado_na_mao && (
                <span className="ml-1.5 text-[10px] font-medium text-[hsl(152_60%_28%)]">aprovado por você</span>
              )}
            </div>
            <div className="num text-sm font-medium shrink-0">{brl(i.valor)}</div>
          </div>
          <div className="text-xs text-muted-foreground">
            {i.responsavel || "sem responsável"} · {fmtDateBR(i.data)}
          </div>
          <div className="text-[13px] text-foreground/80">{i.motivo}</div>
          {/* O que a IA leu, para conferir sem reabrir o PDF — e, do lado, o
              atalho para decidir sem sair daqui. */}
          <div className="flex items-end justify-between gap-3">
            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
              <span>{i.tipo_documento || "documento"}</span>
              {i.numero_documento && <span>nº {i.numero_documento}</span>}
              {i.data_documento && <span>emitido {fmtDateBR(i.data_documento)}</span>}
              {i.emitente_cnpj && <span>{i.emitente_cnpj}</span>}
              {i.valor_documento > 0 && <span>total do documento {brl(i.valor_documento)}</span>}
            </div>
            {onAprovar && (
              <Button
                variant="outline"
                onClick={() => onAprovar(i)}
                disabled={aprovando != null}
                className="h-7 px-2.5 shrink-0 text-xs text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)] hover:bg-[hsl(152_55%_94%)] hover:text-[hsl(152_60%_28%)]"
                title="Aprova este lançamento agora, com o motivo registrado na trilha"
              >
                {aprovando === i.id
                  ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5 mr-1.5" />}
                Aprovar
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
