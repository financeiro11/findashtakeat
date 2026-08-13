import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageCircleQuestion, Loader2, Copy, Trash2, ArrowUpToLine, Sparkles, CornerDownRight,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chaveCelula } from "@/components/demonstracoes/Reclassificacoes";
import { DetalheStatus, SegmentoStatus } from "@/components/demonstracoes/BarraStatus";
import { variacao } from "@/lib/demonstracoes-schema";
import { perguntar, type PayloadPergunta, type Pergunta } from "@/lib/perguntas";
import { usePessoasPJ } from "@/hooks/usePessoasPJ";
import { pessoasNoTexto } from "@/lib/pessoasPJ";

/* ---------------------------------------------------------------------------
 * Perguntar sobre um valor, na própria célula da DRE/DFC.
 *
 * As justificativas respondem a pergunta que a MÁQUINA sabe fazer — "esta célula
 * variou, quem se mexeu?". A que fecha o mês é outra, e costuma ser sobre uma
 * célula que não variou: "teve reajuste de quatro pessoas do comercial em julho,
 * por que Pessoal não subiu?". O fato que motiva a pergunta não está no banco;
 * quem o traz é a pessoa.
 *
 * Por isso o gatilho vive na célula e não no chat da barra lateral: a pergunta
 * já nasce apontando para rubrica e mês, e a resposta fica onde a dúvida estava.
 *
 * UMA CAIXA SÓ NA GRADE: quando a célula tem justificativa, este bloco entra no
 * rodapé do balão dela; quando não tem, o "?" ocupa o MESMO lugar que o balão
 * ocuparia. Duas marcas de conversa lado a lado alargariam toda a grade para
 * dizer a mesma coisa duas vezes.
 * ------------------------------------------------------------------------- */

export type { Pergunta } from "@/lib/perguntas";

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a tabela criada na
   migration 20260806210000. Mesmo atalho tipado das justificativas e dos valores
   manuais — some quando os tipos forem regerados. */
const db = supabase as unknown as {
  from: (tabela: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{
          data: Pergunta[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rotuloMes(k: string | null): string {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(k ?? "");
  if (!m) return k ?? "—";
  const i = EN.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i >= 0 ? `${MES_PT[i]}/${m[2]}` : k!;
}

const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/* ============================================================
 *  Carga
 * ============================================================ */

export function usePerguntas(tipo: "dre" | "dfc") {
  const [mapa, setMapa] = useState<Map<string, Pergunta[]>>(new Map());

  const recarregar = useCallback(async () => {
    const { data, error } = await db
      .from("demonstracoes_perguntas")
      .select("*")
      .eq("tipo", tipo)
      .order("criado_em", { ascending: true });
    if (error) {
      // Acessória como as outras marcas da célula: falhou, a demonstração
      // continua na tela sem marca nenhuma em vez de derrubar a página.
      setMapa(new Map());
      return;
    }
    const m = new Map<string, Pergunta[]>();
    for (const r of data ?? []) {
      const k = chaveCelula(r.rubrica, r.mes);
      const lista = m.get(k);
      const linha = { ...r, drivers: Array.isArray(r.drivers) ? r.drivers : [] };
      if (lista) lista.push(linha); else m.set(k, [linha]);
    }
    setMapa(m);
  }, [tipo]);

  useEffect(() => { recarregar(); }, [recarregar]);

  return { perguntas: mapa, recarregarPerguntas: recarregar };
}

export function tituloPerguntas(lista: Pergunta[] | undefined): string | null {
  if (!lista?.length) return null;
  return lista.length === 1
    ? `1 pergunta respondida nesta célula`
    : `${lista.length} perguntas respondidas nesta célula`;
}

/* ============================================================
 *  O fio: perguntas, respostas e a caixa de escrever
 * ============================================================ */

async function copiar(texto: string, rotulo: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${rotulo} copiado — é só colar no tracker.`);
  } catch {
    toast.error("O navegador bloqueou a cópia. Selecione o texto e copie à mão.");
  }
}

/**
 * O fio de uma célula. Vive dentro de um popover — o do balão de justificativa
 * ou o do "?" — e é o mesmo bloco nos dois, para a pergunta ser a mesma coisa
 * onde quer que se escreva.
 *
 * `montarPayload` é função, não objeto: o dossiê é remontado no instante do
 * envio, com os números que a grade mostra AGORA. Congelá-lo na abertura do
 * popover faria a resposta falar de um número que um recálculo já mudou.
 */
export function BlocoPerguntas({
  perguntas, montarPayload, onMudou, compacto,
}: {
  perguntas: Pergunta[];
  montarPayload: () => (PayloadPergunta | null);
  onMudou: () => void | Promise<void>;
  /** dentro do balão de justificativa o cabeçalho já foi dito lá em cima */
  compacto?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  /* Respostas gravadas antes de o de-para existir (ou antes daquele nome entrar
     nele) carregam a razão social. A troca acontece na leitura, então cadastrar
     um nome corrige o fio inteiro na hora — sem repetir a pergunta. */
  const mapaPessoas = usePessoasPJ();
  const respostaDe = (q: Pergunta) => pessoasNoTexto(mapaPessoas, q.resposta);

  const enviar = async () => {
    const p = texto.trim();
    if (p.length < 3) { toast.error("Escreva a pergunta."); return; }
    const payload = montarPayload();
    if (!payload) { toast.error("Não consegui identificar esta célula no esquema da demonstração."); return; }
    setEnviando(true);
    try {
      await perguntar({ ...payload, pergunta: p });
      setTexto("");
      await onMudou();
    } catch (e) {
      toast.error("Não consegui responder: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  };

  /** A resposta vira O comentário da célula — o que é copiado para o tracker. */
  const promover = async (q: Pergunta) => {
    const payload = montarPayload();
    const valor = payload?.valor ?? q.valor;
    const anterior = payload?.valorAnterior ?? q.valor_anterior;
    const despesa = payload?.despesa ?? false;
    const delta = valor == null || anterior == null
      ? null
      : despesa ? Math.abs(valor) - Math.abs(anterior) : valor - anterior;
    const va = valor == null || anterior == null ? null : variacao(anterior, valor, { despesa });

    setOcupado(q.id);
    const { error } = await db.rpc("pergunta_promover", {
      p_id: q.id,
      p_valor: valor,
      p_valor_anterior: anterior,
      p_delta: delta,
      p_delta_pct: va?.pct ?? null,
      p_mes_anterior: payload?.mesAnterior ?? q.mes_anterior,
      p_despesa: despesa,
    });
    setOcupado(null);
    if (error) { toast.error("Não consegui promover: " + error.message); return; }
    toast.success("Esta resposta agora é o comentário desta célula — entra no “Copiar todos”.");
    await onMudou();
  };

  const apagar = async (q: Pergunta) => {
    setOcupado(q.id);
    const { error } = await db.rpc("pergunta_apagar", { p_id: q.id });
    setOcupado(null);
    if (error) { toast.error("Não consegui apagar: " + error.message); return; }
    await onMudou();
  };

  return (
    <div className={cn(compacto && "border-t border-border")}>
      {!!perguntas.length && (
        <div className="max-h-[260px] space-y-3 overflow-y-auto px-4 py-3">
          {perguntas.map((q) => (
            <div key={q.id} className="space-y-1">
              <div className="flex items-baseline gap-1.5 text-[11px] font-medium text-foreground">
                <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="whitespace-pre-wrap">{q.pergunta}</span>
              </div>
              <p className="whitespace-pre-wrap pl-[18px] text-[12.5px] leading-relaxed text-foreground">
                {respostaDe(q)}
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[18px] text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  {q.autor_email ? `perguntado por ${q.autor_email}` : "perguntado"}
                  {q.criado_em && ` · ${quando(q.criado_em)}`}
                  {q.confianca && ` · confiança ${q.confianca}`}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => copiar(respostaDe(q), "Resposta")}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-secondary"
                  >
                    <Copy className="h-2.5 w-2.5" /> Copiar
                  </button>
                  <button
                    onClick={() => promover(q)}
                    disabled={ocupado === q.id}
                    title="A resposta passa a ser o comentário desta célula, o que vai para o tracker"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-sky-800 transition hover:bg-sky-50 disabled:opacity-50"
                  >
                    {ocupado === q.id
                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      : <ArrowUpToLine className="h-2.5 w-2.5" />}
                    Virar comentário
                  </button>
                  <button
                    onClick={() => apagar(q)}
                    disabled={ocupado === q.id}
                    title="Some do fio — e para de servir de contexto para as próximas perguntas"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-secondary disabled:opacity-50"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </span>
              </div>
              {/* A prova, como nos drivers da justificativa: quem lê confere sem
                  sair da tela quantos lançamentos sustentaram a resposta. */}
              {!!q.dados?.lancamentos && (
                <div className="pl-[18px] text-[9.5px] text-muted-foreground/80">
                  Lidos {q.dados.lancamentos} lançamento(s) do Omie
                  {!!q.dados.contrapartes && ` · ${q.dados.contrapartes} contraparte(s)`}
                  {!!q.dados.omitidos && ` · ${q.dados.omitidos} fora do recorte enviado`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={cn("px-4 py-3", !!perguntas.length && "border-t border-border")}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviar(); }}
          rows={perguntas.length ? 2 : 3}
          placeholder={perguntas.length
            ? "Repicar — a resposta anterior vai junto…"
            : "Ex.: teve reajuste de 4 pessoas do comercial em julho, por que não subiu?"}
          className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={enviar}
            disabled={enviando}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {enviando
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Lendo os lançamentos…</>
              : <><MessageCircleQuestion className="h-3 w-3" /> Perguntar</>}
          </button>
          {/* Sem isto a resposta passaria por verdade contábil. Ela é leitura dos
              lançamentos — o Omie diz QUEM e QUANTO, nunca POR QUÊ. */}
          <span className="text-[10px] leading-snug text-muted-foreground">
            Responde pelos lançamentos do Omie desta célula e dos meses vizinhos. Confira antes de levar ao tracker.
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 *  Marca na célula (quando não há justificativa)
 * ============================================================ */

export function MarcaPerguntas({
  rubrica, mes, valorCelula, perguntas, montarPayload, onMudou,
}: {
  rubrica: string;
  mes: string;
  valorCelula: number | null;
  perguntas: Pergunta[];
  montarPayload: () => (PayloadPergunta | null);
  onMudou: () => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  /* Só monta o Popover no primeiro clique — mesma razão do lápis de valor
     manual: com "Todos os anos" a grade passa de mil células, e mil árvores de
     componente para a pessoa abrir uma seria desperdício puro. */
  const [montado, setMontado] = useState(false);
  const tem = perguntas.length > 0;

  const gatilho = (
    <button
      type="button"
      /* A célula inteira abre o drill-down de lançamentos. Sem isto, perguntar
         abriria também a gaveta por baixo. */
      onClick={(e) => { e.stopPropagation(); if (!montado) { setMontado(true); setAberto(true); } }}
      title={tem ? tituloPerguntas(perguntas)! : "Perguntar sobre este valor"}
      /* Sem pergunta o "?" é `invisible`, não `hidden`: some da vista e do clique,
         mas continua ocupando o espaço, então o número não dança quando o mouse
         entra e sai da linha. */
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm transition hover:bg-black/10",
        tem
          ? "text-indigo-700"
          : "invisible text-muted-foreground/70 group-hover/linha:visible",
      )}
    >
      <MessageCircleQuestion strokeWidth={tem ? 2.5 : 2.25} className="h-3.5 w-3.5" />
      {perguntas.length > 1 && (
        <span className="ml-px text-[8px] font-bold leading-none text-indigo-700">{perguntas.length}</span>
      )}
    </button>
  );

  if (!montado) return gatilho;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>{gatilho}</PopoverTrigger>
      <PopoverContent align="end" className="w-[440px] p-0 text-left" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 pb-2.5 pt-3">
          <div className="text-[13px] font-semibold leading-tight text-foreground">
            {rubrica}
            <span className="font-normal text-muted-foreground"> · {rotuloMes(mes)}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Na tela: <span className="num font-medium text-foreground">{valorExato(valorCelula)}</span>
          </div>
        </div>
        <BlocoPerguntas perguntas={perguntas} montarPayload={montarPayload} onMudou={onMudou} />
      </PopoverContent>
    </Popover>
  );
}

/* ============================================================
 *  Resumo acima da tabela
 * ============================================================ */

export function ResumoPerguntas({
  mapa, colunas,
}: { mapa: Map<string, Pergunta[]>; colunas: string[] }) {
  const visiveis = useMemo(() => {
    const cols = new Set(colunas);
    const ordem = new Map(colunas.map((c, i) => [c, i]));
    return [...mapa.values()].flat()
      .filter((q) => cols.has(q.mes))
      .sort((a, b) => (ordem.get(a.mes)! - ordem.get(b.mes)!) || a.rubrica.localeCompare(b.rubrica));
  }, [mapa, colunas]);

  if (!visiveis.length) return null;

  return (
    <SegmentoStatus
      icone={<MessageCircleQuestion strokeWidth={2.2} className="h-[13px] w-[13px] text-indigo-600" />}
      valor={visiveis.length}
      rotulo={visiveis.length === 1 ? "pergunta" : "perguntas"}
      titulo="Perguntas respondidas nos meses visíveis. Ficam na célula em que foram feitas e não somem no “Regerar”."
      larguraDetalhe={420}
      detalhe={
        <DetalheStatus
          titulo="Perguntas nesta demonstração"
          nota="Elas ficam na célula em que foram feitas e não somem no “Regerar”. Para ler a resposta, clique no “?” dentro da célula; para levar uma ao tracker, use “Virar comentário”."
        >
          <div className="max-h-[320px] overflow-y-auto py-1">
            {visiveis.map((q) => (
              <div key={q.id} className="px-3 py-1.5 hover:bg-secondary/60">
                <div className="text-[11px] font-medium text-foreground">
                  {q.rubrica}
                  <span className="text-muted-foreground"> · {rotuloMes(q.mes)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{q.pergunta}</div>
              </div>
            ))}
          </div>
        </DetalheStatus>
      }
    />
  );
}
