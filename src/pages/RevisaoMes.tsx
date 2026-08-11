/* ============================================================================
 * Revisão do Mês — a tela da reunião mensal de tracker com o CEO.
 *
 * Cinco blocos, um por assunto, feitos para serem passados um a um numa reunião
 * de meia hora: Resumo, DRE, Pareto, Caixa e as metas do mês seguinte. Setas do
 * teclado navegam, "Modo reunião" tira o Hub da frente e "Exportar" leva o mês
 * para PDF em paisagem, PowerPoint 16:9 ou papel — com a quebra de página
 * montada peça a peça em `lib/folhaRevisao.ts`, não deixada para o navegador.
 *
 * Cada bloco ocupa uma tela e é mostrado em TAMANHO NATURAL; o que não couber
 * rola por dentro do próprio bloco. Encolher o bloco para caber na moldura já
 * foi tentado e o resultado era a reunião lendo um Resumo a 55%.
 *
 * DE ONDE VEM CADA COISA
 *   · realizado      → blob da DRE e da DFC (`demonstracoes_contabeis`)
 *   · orçado         → `bp_anual` (a seção DRE via lerBpAnual, a DFC via parsearPlano)
 *   · caixa          → `omie_caixa_snapshot`
 *   · carteira/churn → `assinaturas_snapshot` e `churn_snapshot`
 *   · metas          → aba "Operação" do BP (`parsearOperacao`)
 *   · "por que"      → `demonstracoes_justificativas`, o comentário da célula da DRE
 *   · "impacto/ação" → `demonstracoes_revisao`, escrito pela IA sobre o sinal
 *
 * A CONTA MORA EM `lib/revisaoMes.ts`, testada, e é a mesma da grade da DRE.
 * Aqui é busca de dado e desenho — mais o disparo da redação, que manda o sinal
 * pronto para a edge function e nunca deixa a IA escolher o que é relevante.
 *
 * Nenhuma fonte é obrigatória: sem BP as colunas de orçado somem, sem snapshot
 * de caixa o runway sai da tela, sem revisão gerada os blocos mostram só número.
 * Um bloco vazio esconde uma leitura; nunca derruba a reunião.
 * ========================================================================== */

import {
  Children, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Loader2, Lock, LockOpen,
  Maximize2, Minimize2, Sparkles, AlertTriangle, Flame, TrendingUp, Target,
  MessageSquareText, Check, Pencil, X, Info, RotateCcw, Layers, Plus, Send, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { ExportarRevisao } from "@/components/demonstracoes/ExportarRevisao";
import { MontadorApresentacao } from "@/components/demonstracoes/MontadorApresentacao";
import { CardSerie, CardTexto } from "@/components/demonstracoes/CardsApresentacao";
import {
  roteiroPadrao, sanear, serieDaRubrica, ROTEIRO_VAZIO,
  type ItemCatalogo, type Peca, type Roteiro,
} from "@/lib/apresentacao";
import { REGISTRO_CARDS } from "@/lib/registroCards";
import { valorExato } from "@/lib/valor";
import { competenciaDe, lerDre, mesesComDado, rotuloMes, RL, EBITDA, SGA } from "@/lib/analisesDre";
import { lerBpAnual, type BpAnual } from "@/lib/bpAnual";
import { parsearPlano, type LinhaBP } from "@/pages/bp/parse";
import { parsearOperacao, type MesBP } from "@/pages/assinaturas/orcadoBp";
import { colunaDoMes } from "@/lib/pontoEquilibrio";
import {
  espinhaDre, cascata, pareto, acimaDoCorte, blocoCaixa, proximoMes, montarSinal,
  aplicarEdicao, sinalMudou, mesPorExtenso, mesSeguinte, abreviado, fracPct,
  planoDaDre, RECEITA_BRUTA, MARGEM_CONTRIB,
  type Detalhe, type Leitura, type Ofensor, type Sinal, type LinhaEspinha,
} from "@/lib/revisaoMes";

const sb = supabase as any;

/* ------------------------------ formatação ------------------------------ */
/* Abreviado na tela revela o valor cheio no hover (convenção do CLAUDE.md).
   A variante …Str existe para template literal e atributo `title`. */
const brl = (n: number | null | undefined) => comValorExato(n, abreviado(n));
const brlCheio = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : valorExato(n, { casas: 0 });
const inteiro = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("pt-BR");

/** Cor de um número pelo que ele significa, não pelo sinal aritmético. */
const tom = (bom: boolean | null) =>
  bom == null ? "text-foreground" : bom ? "text-pos" : "text-neg";

/** `+R$ 12,3 k` / `-R$ 4,0 k`, com o sinal explícito. */
const comSinal = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${abreviado(n)}`;

/** `+18` / `-7` clientes. */
const contagem = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("pt-BR")}`;

/** Positivo é bom; null quando não há com o que comparar. */
const sinalDe = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? null : n >= 0;

/* ------------------------------ tipos locais ------------------------------ */

type Blob = { rows: Record<string, unknown>[]; columns: string[] };

type Carteira = {
  mix: { nivel: string; clientes: number; mrr: number; tm: number }[];
  clientes: number;
  mrr: number;
  ticket: number;
  mesLabel: string;
};

type ChurnMes = { qtd: number; valor: number; pct: number; mesLabel: string };

/** O que um `CampoTexto` precisa para saber a quem pertence e onde gravar. */
type PropsCampo = {
  rotulo: string;
  onSalvar: (v: string) => Promise<void>;
  onIA: (instrucao: string) => Promise<string | null>;
};

type RevisaoRow = {
  mes: string;
  detalhe: Detalhe;
  veredicto_nivel: Leitura["veredicto_nivel"] | null;
  veredicto_titulo: string | null;
  veredicto_resumo: string | null;
  destaques: Leitura["destaques"] | null;
  rubricas: Leitura["rubricas"] | null;
  decisoes: string[] | null;
  fecho: string | null;
  sinal: Partial<Sinal> | null;
  editado: Partial<Leitura> | null;
  status: "novo" | "aceito";
  gerado_em: string | null;
  modelo: string | null;
};

const BLOCOS = ["Resumo", "DRE", "Pareto", "Caixa", "Metas"] as const;

/** Uma linha de `demonstracoes_apresentacoes`. */
type Apresentacao = {
  id: string;
  mes: string;
  nome: string;
  roteiro: Roteiro;
  textos: Record<string, string>;
  status: "rascunho" | "publicada";
  congelado: Congelado | null;
  publicada_em: string | null;
};

/** O que o publicar congela: o HTML de cada peça e a leitura do momento. */
type Congelado = {
  html?: Record<string, string>;
  leitura?: Partial<Leitura>;
  sinal?: unknown;
  em?: string;
};

/* ============================================================
 *  O catálogo de cards
 * ============================================================
 * Como cada card se chama para gente e quais andam colados. A CHAVE é o `key`
 * do filho de topo do bloco, prefixado pelo bloco — é ela que a apresentação
 * salva, então mudar uma chave aqui é mudar o que uma apresentação antiga
 * mostra. Card que sumir do catálogo é retirado do roteiro por `sanear`, com
 * aviso; renomear é seguro, re-chavear não.
 */
const CARDS_META: Record<string, { rotulo: string; grupo?: string; vazio?: boolean }> = {
  "resumo.cabecalho":       { rotulo: "Título · Resumo" },
  "resumo.veredicto":       { rotulo: "Veredicto do mês" },
  "resumo.kpis-resultado":  { rotulo: "KPIs · receita, margem, EBITDA e SG&A" },
  "resumo.kpis-base":       { rotulo: "KPIs · caixa, runway, clientes e churn" },
  "resumo.aviso-carteira":  { rotulo: "Aviso · carteira de outro mês", vazio: true },
  "resumo.destaques":       { rotulo: "Os três destaques" },
  "dre.cabecalho":          { rotulo: "Título · DRE" },
  "dre.cascata":            { rotulo: "Cascata do resultado" },
  "dre.tabela":             { rotulo: "DRE vs. orçado (tabela)" },
  "pareto.cabecalho":       { rotulo: "Título · Pareto" },
  "pareto.vazio":           { rotulo: "Aviso · não há Pareto", vazio: true },
  "pareto.barras":          { rotulo: "Barras do Pareto" },
  "pareto.abaixo-do-corte": { rotulo: "Rubricas abaixo do corte", grupo: "pareto.rubricas" },
  "pareto.balanco":         { rotulo: "Amortecedores e a conta que fecha" },
  "caixa.cabecalho":        { rotulo: "Título · Caixa" },
  "caixa.kpis":             { rotulo: "KPIs do caixa" },
  "caixa.dfc":              { rotulo: "DFC simplificada" },
  "metas.cabecalho":        { rotulo: "Título · Metas" },
  "metas.vazio":            { rotulo: "Aviso · sem mês seguinte", vazio: true },
  "metas.kpis":             { rotulo: "KPIs das metas" },
  "metas.carteira":         { rotulo: "Carteira por porte", grupo: "metas.grid" },
  "metas.decisoes":         { rotulo: "Decisões e fecho", grupo: "metas.grid" },
};

/** O invólucro que devolve a vizinhança a cards que andam colados. */
const GRUPOS: Record<string, { classe: string; pilha?: boolean }> = {
  // A lista de rubricas: gap menor que o do bloco e repartível entre páginas.
  "pareto.rubricas": { classe: "flex flex-col gap-2", pilha: true },
  "metas.grid": { classe: "grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]" },
};

/** Um card pronto para desenhar: a chave do catálogo mais o nó de verdade. */
type CardPronto = ItemCatalogo & { no: ReactNode };

/**
 * Lê os cards de um bloco a partir do próprio JSX.
 *
 * Os filhos de topo do fragmento JÁ SÃO os cards; o que faltava era nome. A
 * identidade vem do `key` de cada filho (e não da posição) porque nem todo card
 * aparece todo mês — sem leitura escrita não há destaques, sem mês seguinte não
 * há metas — e a posição faria a apresentação de julho apontar para outro card
 * quando aberta em agosto.
 */
function cardsDoBloco(bloco: string, prefixo: string, node: ReactElement): CardPronto[] {
  const filhos = Children.toArray((node.props as { children?: ReactNode }).children);
  return filhos.filter(isValidElement).map((filho) => {
    // `Children.toArray` prefixa a key: ".$cabecalho", ".2:$rubrica:Pessoal".
    const key = String(filho.key ?? "").replace(/^.*\$/, "");
    const chave = `${prefixo}.${key}`;
    const meta = CARDS_META[chave] ?? (key.startsWith("rubrica:")
      ? { rotulo: `Rubrica · ${key.slice("rubrica:".length)}`, grupo: "pareto.rubricas" }
      : { rotulo: chave });
    return { chave, bloco, rotulo: meta.rotulo, grupo: meta.grupo, vazio: meta.vazio, no: filho };
  });
}

/**
 * Desenha uma sequência de cards, devolvendo aos vizinhos de grupo o invólucro.
 *
 * Grupo com UM membro só não ganha invólucro: uma pauta sozinha numa grade de
 * duas colunas ficaria espremida na coluna da esquerda com metade da folha em
 * branco, que é o oposto do que a montagem existe para permitir.
 */
function desenharCards(cards: CardPronto[]): ReactNode[] {
  const saida: ReactNode[] = [];
  let i = 0;
  while (i < cards.length) {
    const grupo = cards[i].grupo;
    let j = i + 1;
    if (grupo) while (j < cards.length && cards[j].grupo === grupo) j++;
    const trecho = cards.slice(i, j);
    if (!grupo || trecho.length === 1) {
      for (const c of trecho) saida.push(<Peca key={c.chave} chave={c.chave}>{c.no}</Peca>);
    } else {
      const meta = GRUPOS[grupo];
      saida.push(
        <div
          key={`${grupo}#${i}`}
          className={meta?.classe}
          {...(meta?.pilha ? { "data-export-pilha": "" } : {})}
        >
          {trecho.map((c) => <Peca key={c.chave} chave={c.chave}>{c.no}</Peca>)}
        </div>,
      );
    }
    i = j;
  }
  return saida;
}

/**
 * Envelope de uma peça — é por ele que o publicar congela card a card.
 *
 * `[&>*]:flex-1` não é enfeite: dentro de um grupo em grade, quem vira célula
 * agora é o envelope, e sem isso o card ficaria com a altura do próprio texto
 * enquanto o vizinho da outra coluna estica — duas caixas desalinhadas onde
 * antes havia duas do mesmo tamanho.
 */
function Peca({ chave, children }: { chave: string; children: ReactNode }) {
  return <div data-revisao-peca={chave} className="flex min-w-0 flex-col [&>*]:flex-1">{children}</div>;
}

/* ============================================================
 *  Peças de UI
 * ============================================================ */

function Chip({ children, tone }: { children: React.ReactNode; tone?: "warn" | "neg" | "pos" }) {
  return (
    <span className={cn(
      "chip whitespace-nowrap",
      tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      tone === "neg" && "border-neg/25 bg-neg-soft text-neg",
      tone === "pos" && "border-pos/25 bg-pos-soft text-pos",
    )}>
      {children}
    </span>
  );
}

function CabecalhoBloco({
  n, titulo, direita,
}: { n: number; titulo: string; direita?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6 border-b border-border pb-3">
      <div className="min-w-0">
        <div className="eyebrow">Bloco {n} de 5</div>
        <h1 className="mt-1.5 text-[23px] font-semibold tracking-tight">{titulo}</h1>
      </div>
      {direita && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{direita}</div>}
    </div>
  );
}

function Kpi({
  eyebrow, valor, tomValor, children,
}: {
  eyebrow: React.ReactNode;
  valor: React.ReactNode;
  tomValor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card-surface flex flex-col gap-2.5 p-4">
      <div className="eyebrow">{eyebrow}</div>
      <div className={cn("num text-[26px] font-semibold leading-none tracking-tight", tomValor ?? "text-foreground")}>
        {valor}
      </div>
      {children}
    </div>
  );
}

/**
 * As duas comparações que todo KPI da reunião responde.
 *
 * Sempre as MESMAS DUAS, na mesma ordem e no mesmo lugar do card: "como está
 * contra o mês passado" e "como está contra o plano". A cor sai do argumento
 * `bom`, e não do sinal do número, porque em despesa e em churn subir é ruim —
 * pintar de verde tudo que é positivo diria o contrário do que aconteceu.
 */
function Comparativos({
  itens,
}: { itens: { rotulo: string; texto: React.ReactNode; bom: boolean | null }[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {itens.map((i) => (
        <span key={i.rotulo} className="whitespace-nowrap">
          {i.rotulo} <b className={cn("num", tom(i.bom))}>{i.texto}</b>
        </span>
      ))}
    </div>
  );
}

/** Barrinha de progresso contra o orçado, como nos KPIs do dashboard. */
function Barra({ pct, cor }: { pct: number; cor?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("h-full rounded-full", cor ?? "bg-primary")}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

const NIVEL_META = {
  critico: { rotulo: "CRÍTICO", cls: "insight-tag critico", Icone: Flame },
  atencao: { rotulo: "ATENÇÃO", cls: "insight-tag atencao", Icone: AlertTriangle },
  info: { rotulo: "INFO", cls: "insight-tag info", Icone: TrendingUp },
} as const;

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <div className="card-surface flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/* ============================================================
 *  Um card de texto: escrever à mão, ou pedir à IA
 * ============================================================
 * Cada reunião é diferente — numa o assunto é a folha, na outra o CEO quer o
 * churn por porte na frente. Refazer a pauta inteira para mudar uma frase
 * gastaria uma ida à IA e apagaria as outras nove que já estavam boas.
 *
 * Por isso a edição é POR CAMPO e a instrução vai junto do MESMO dossiê: a
 * pessoa muda a ênfase, não a fonte dos números. Tudo o que sai daqui vira um
 * patch parcial em `editado` (ver `aplicarEdicao`) e sobrevive ao "Regerar" —
 * o que alguém escreveu ou mandou escrever não é apagado por um clique alheio.
 */
function CampoTexto({
  valor, rotulo, vazio, className, linhas = 3, onSalvar, onIA, desabilitado, renderizar,
}: {
  valor: string;
  /** Como o campo se chama para a IA e no cabeçalho da caixa ("Impacto · Pessoal"). */
  rotulo: string;
  vazio?: string;
  className?: string;
  linhas?: number;
  onSalvar: (v: string) => Promise<void>;
  onIA: (instrucao: string) => Promise<string | null>;
  desabilitado?: boolean;
  /** Quando a exibição não é o texto cru — a pauta é uma lista numerada. */
  renderizar?: (valor: string) => React.ReactNode;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);
  const [instrucao, setInstrucao] = useState("");
  const [ocupado, setOcupado] = useState<"salvar" | "ia" | null>(null);
  const [aberto, setAberto] = useState(false);

  const salvar = async () => {
    setOcupado("salvar");
    try { await onSalvar(rascunho); setEditando(false); } finally { setOcupado(null); }
  };

  const pedir = async () => {
    setOcupado("ia");
    try {
      const novo = await onIA(instrucao);
      if (novo != null) { setInstrucao(""); setAberto(false); }
    } finally { setOcupado(null); }
  };

  if (editando) {
    return (
      <div className="flex flex-col gap-1.5">
        <textarea
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          rows={linhas}
          autoFocus
          onKeyDown={(e) => { if (e.key === "Escape") setEditando(false); }}
          className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={salvar}
            disabled={ocupado != null}
            className="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-[10.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {ocupado === "salvar" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
            Salvar
          </button>
          <button
            onClick={() => { setRascunho(valor); setEditando(false); }}
            className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground transition hover:bg-secondary"
          >
            <X className="h-2.5 w-2.5" /> Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <span className="group/campo relative inline-block w-full align-top">
      <span className={className}>
        {valor
          ? (renderizar ? renderizar(valor) : valor)
          : <span className="text-muted-foreground/60">{vazio ?? "—"}</span>}
      </span>
      {!desabilitado && (
        <span
          data-chrome="campo"
          className="ml-1.5 inline-flex translate-y-[2px] items-center gap-0.5 opacity-0 transition-opacity group-hover/campo:opacity-100 focus-within:opacity-100"
        >
          <button
            onClick={() => { setRascunho(valor); setEditando(true); }}
            title={`Escrever à mão: ${rotulo}`}
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <Popover open={aberto} onOpenChange={setAberto}>
            <PopoverTrigger asChild>
              <button
                title={`Pedir à IA para mexer em: ${rotulo}`}
                className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm text-muted-foreground transition hover:bg-secondary hover:text-primary"
              >
                <Sparkles className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[340px] p-3">
              <div className="text-[11px] font-semibold text-foreground">{rotulo}</div>
              <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
                Diga o que mudar. A IA reescreve só este campo, com os mesmos números do
                dossiê — ela muda a ênfase, não a conta.
              </p>
              <textarea
                value={instrucao}
                onChange={(e) => setInstrucao(e.target.value)}
                rows={3}
                autoFocus
                placeholder="ex.: cite o Datadog e diga que a migração acaba em agosto"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) pedir(); }}
                className="mt-2 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[11.5px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={pedir}
                disabled={ocupado != null}
                className="mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-[11.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {ocupado === "ia"
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Escrevendo…</>
                  : <><Sparkles className="h-3 w-3" /> Reescrever este campo</>}
              </button>
            </PopoverContent>
          </Popover>
        </span>
      )}
    </span>
  );
}

/* ============================================================
 *  Página
 * ============================================================ */

export default function RevisaoMes() {
  /* ---------------------------- estado ---------------------------- */
  const [dre, setDre] = useState<Blob>({ rows: [], columns: [] });
  const [dfc, setDfc] = useState<Blob>({ rows: [], columns: [] });
  const [travados, setTravados] = useState<Set<string>>(new Set());
  const [bpPorAno, setBpPorAno] = useState<Map<number, BpAnual>>(new Map());
  const [dfcPorAno, setDfcPorAno] = useState<Map<number, LinhaBP[]>>(new Map());
  const [operacaoPorAno, setOperacaoPorAno] = useState<Map<number, Map<string, MesBP>>>(new Map());
  const [caixaSnap, setCaixaSnap] = useState<{ saldo: number | null; em: string | null } | null>(null);
  /* Os snapshots vêm TODOS e ficam indexados por competência ("2026-06"): a
     reunião pode ser sobre um mês que não é o último, e casar a carteira de hoje
     com a DRE de junho seria comparar base de agosto com receita de junho. */
  const [carteiras, setCarteiras] = useState<Map<string, Carteira>>(new Map());
  const [churns, setChurns] = useState<Map<string, ChurnMes>>(new Map());
  const [justificativas, setJustificativas] = useState<Map<string, string>>(new Map());
  const [revisao, setRevisao] = useState<RevisaoRow | null>(null);

  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [mesEscolhido, setMesEscolhido] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe>("bloco");
  const [corte, setCorte] = useState(0.8);
  const [bloco, setBloco] = useState(0);
  const [modoReuniao, setModoReuniao] = useState(false);
  const [railAberto, setRailAberto] = useState(true);
  const [exportando, setExportando] = useState(false);

  /* ---- a apresentação --------------------------------------------------
     `apresId` null = a tela de trabalho, com os cinco blocos como sempre. Com
     uma apresentação escolhida, o palco passa a mostrar as FOLHAS do roteiro. */
  const [apresentacoes, setApresentacoes] = useState<Apresentacao[]>([]);
  const [apresId, setApresId] = useState<string | null>(null);
  const [nomeApres, setNomeApres] = useState("");
  const [roteiro, setRoteiro] = useState<Roteiro>(ROTEIRO_VAZIO);
  const [textosApres, setTextosApres] = useState<Record<string, string>>({});
  const [statusApres, setStatusApres] = useState<"rascunho" | "publicada">("rascunho");
  const [congelado, setCongelado] = useState<Congelado | null>(null);
  const [montando, setMontando] = useState(false);
  const [salvandoApres, setSalvandoApres] = useState(false);
  /* O catálogo só existe depois que os blocos são montados, lá embaixo no
     render; os handlers ficam acima e o alcançam por aqui. */
  const catalogoRef = useRef<ItemCatalogo[]>([]);
  /** Só os cinco blocos — é deles que sai o roteiro de uma apresentação nova. */
  const catalogoPadraoRef = useRef<ItemCatalogo[]>([]);
  const palcoRef = useRef<HTMLDivElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const animando = useRef(false);
  const [alturaPalco, setAlturaPalco] = useState<number | null>(null);

  useEffect(() => { document.title = "Demonstrações · Revisão do Mês"; }, []);

  /* A altura útil, MEDIDA em vez de estimada.
     O palco precisa de altura definida (é ele que rola, e é o scroll dele que o
     rail acompanha), e ela depende do cabeçalho do Hub, que esta página não
     controla. Chutar `100vh - 49px` funciona até alguém mexer no header. */
  useLayoutEffect(() => {
    const medir = () => {
      const topo = raizRef.current?.getBoundingClientRect().top ?? 0;
      setAlturaPalco(Math.max(320, window.innerHeight - topo));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [modoReuniao]);

  /* ---------------------------- carga ---------------------------- */
  /* O blob vem em dois formatos: array cru (import antigo) ou
     `{ columns, rows }`. Mesma leitura das páginas DRE/DFC. */
  const lerBlob = (raw: unknown): Blob => {
    let rows: Record<string, unknown>[] = [];
    let cols: string[] = [];
    if (Array.isArray(raw)) {
      rows = raw as Record<string, unknown>[];
      cols = Object.keys(rows[0] ?? {});
    } else if (raw && typeof raw === "object") {
      const envelope = raw as { rows?: Record<string, unknown>[]; columns?: string[] };
      if (Array.isArray(envelope.rows)) {
        rows = envelope.rows;
        cols = envelope.columns ?? Object.keys(rows[0] ?? {});
      }
    }
    const mensais = cols.filter((c) => /^[A-Za-z]{3}-\d{2}$/.test(c));
    const ordem = (k: string) => {
      const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const m = /^([A-Za-z]{3})-(\d{2})$/.exec(k)!;
      return (2000 + Number(m[2])) * 12 + EN.indexOf(m[1]);
    };
    return { rows, columns: mensais.sort((a, b) => ordem(a) - ordem(b)) };
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [dreRes, dfcRes, travasRes, bpsRes, caixaRes, assinRes, churnRes] = await Promise.all([
      sb.from("demonstracoes_contabeis").select("dados")
        .eq("tipo", "dre").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("demonstracoes_contabeis").select("dados")
        .eq("tipo", "dfc").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("demonstracoes_mes_trancado").select("col_key"),
      sb.from("bp_anual").select("ano,dados,abas"),
      sb.from("omie_caixa_snapshot").select("dados,gerado_em")
        .order("gerado_em", { ascending: false }).limit(1).maybeSingle(),
      sb.from("assinaturas_snapshot").select("competencia,mes_label,dados")
        .order("competencia", { ascending: true }),
      sb.from("churn_snapshot").select("competencia,mes_label,dados")
        .order("competencia", { ascending: true }),
    ]);

    setDre(lerBlob(dreRes?.data?.dados));
    setDfc(lerBlob(dfcRes?.data?.dados));
    setTravados(new Set(
      ((travasRes?.data ?? []) as { col_key: string }[]).map((t) => String(t.col_key)),
    ));

    const bps = new Map<number, BpAnual>();
    const dfcs = new Map<number, LinhaBP[]>();
    const ops = new Map<number, Map<string, MesBP>>();
    type LinhaBp = { ano: number; dados: unknown; abas: Record<string, unknown> | null };
    for (const r of ((bpsRes?.data ?? []) as LinhaBp[])) {
      const ano = Number(r.ano);
      const dados = (Array.isArray(r.dados) ? r.dados : []) as Record<string, unknown>[];
      bps.set(ano, lerBpAnual(r.dados));
      dfcs.set(ano, parsearPlano(dados).dfc);
      ops.set(ano, parsearOperacao(r.abas?.["Operação"], ano));
    }
    setBpPorAno(bps);
    setDfcPorAno(dfcs);
    setOperacaoPorAno(ops);

    const dadosCaixa = caixaRes?.data?.dados as { saldo_consolidado?: number } | null;
    setCaixaSnap({
      saldo: dadosCaixa?.saldo_consolidado ?? null,
      em: caixaRes?.data?.gerado_em ?? null,
    });

    type LinhaAssinaturas = {
      competencia: string;
      mes_label: string | null;
      dados: {
        mix_nivel?: { nivel: string; clientes: number; mrr: number; tm: number }[];
        kpis?: { clientes_ativos?: number; mrr_core?: number; ticket_medio?: number };
      } | null;
    };
    const porCarteira = new Map<string, Carteira>();
    for (const r of ((assinRes?.data ?? []) as LinhaAssinaturas[])) {
      if (!r.dados) continue;
      porCarteira.set(String(r.competencia).slice(0, 7), {
        mix: (r.dados.mix_nivel ?? []).map((n) => ({
          nivel: n.nivel, clientes: n.clientes, mrr: n.mrr, tm: n.tm,
        })),
        clientes: r.dados.kpis?.clientes_ativos ?? 0,
        mrr: r.dados.kpis?.mrr_core ?? 0,
        ticket: r.dados.kpis?.ticket_medio ?? 0,
        mesLabel: r.mes_label ?? "",
      });
    }
    setCarteiras(porCarteira);

    type LinhaChurn = {
      competencia: string;
      mes_label: string | null;
      dados: { kpis?: { churn_qtd?: number; churn_valor?: number; pct_receita_geral?: number } } | null;
    };
    const porChurn = new Map<string, ChurnMes>();
    for (const r of ((churnRes?.data ?? []) as LinhaChurn[])) {
      if (!r.dados) continue;
      porChurn.set(String(r.competencia).slice(0, 7), {
        qtd: r.dados.kpis?.churn_qtd ?? 0,
        valor: r.dados.kpis?.churn_valor ?? 0,
        pct: r.dados.kpis?.pct_receita_geral ?? 0,
        mesLabel: r.mes_label ?? "",
      });
    }
    setChurns(porChurn);

    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /* ---------------------------- janela de meses ---------------------------- */
  const leitor = useMemo(() => lerDre(dre.rows, dre.columns), [dre]);
  const colAtual = colunaDoMes(new Date());
  const comDado = useMemo(
    () => mesesComDado(leitor, dre.columns, travados, colAtual),
    [leitor, dre.columns, travados, colAtual],
  );

  /* Abre no último mês FECHADO — é sobre ele que a reunião é. Sem nenhum
     cadeado, cai no último mês com dado e a tela avisa em voz alta. */
  const mesPadrao = useMemo(() => {
    const fechados = comDado.filter((c) => travados.has(c));
    return fechados[fechados.length - 1] ?? comDado[comDado.length - 1] ?? null;
  }, [comDado, travados]);

  const mes = mesEscolhido && comDado.includes(mesEscolhido) ? mesEscolhido : mesPadrao;
  const idxMes = mes ? comDado.indexOf(mes) : -1;
  const mesAnterior = idxMes > 0 ? comDado[idxMes - 1] : null;

  /* Os meses que o histórico e o runway podem enxergar: os fechados até aqui,
     mais o próprio mês em foco (que pode ainda não ter cadeado). */
  const janela = useMemo(() => {
    if (!mes || idxMes < 0) return [];
    return [...comDado.slice(0, idxMes).filter((c) => travados.has(c)), mes];
  }, [comDado, idxMes, mes, travados]);

  /* ---------------------------- a conta ---------------------------- */
  /* `planoDaDre`, e não o `planoPorColuna` de lib/bpAnual: aqui o casamento com o
     BP tem de ser exato. Ver o comentário na função — o aproximado dava a
     "Receita Recorrente" o plano da receita TOTAL. */
  const plano = useMemo(() => planoDaDre(bpPorAno), [bpPorAno]);
  const temBp = bpPorAno.size > 0;

  const espinha = useMemo<LinhaEspinha[]>(
    () => (mes ? espinhaDre(leitor, temBp ? plano : null, mes, mesAnterior) : []),
    [leitor, plano, temBp, mes, mesAnterior],
  );

  const degraus = useMemo(
    () => (mes ? cascata(leitor, temBp ? plano : null, mes) : []),
    [leitor, plano, temBp, mes],
  );

  const par = useMemo(
    () => (mes
      ? pareto({ leitor, plano: temBp ? plano : null, mes, mesAnterior, mesesFechados: janela, detalhe, corte })
      : null),
    [leitor, plano, temBp, mes, mesAnterior, janela, detalhe, corte],
  );

  const anoDoMes = mes ? 2000 + Number(mes.slice(-2)) : new Date().getFullYear();
  const caixa = useMemo(() => (mes ? blocoCaixa({
    dfcRows: dfc.rows,
    dfcColumns: dfc.columns,
    planoDfc: dfcPorAno.get(anoDoMes) ?? [],
    mes,
    mesAnterior,
    mesesFechados: janela,
    saldo: caixaSnap?.saldo ?? null,
    saldoEm: caixaSnap?.em ?? null,
  }) : null), [dfc, dfcPorAno, anoDoMes, mes, mesAnterior, janela, caixaSnap]);

  /* ---- carteira e churn ALINHADOS ao mês da reunião ----
     A base do fim de junho é o que fecha com a DRE de junho. Pegar sempre o
     último snapshot faria a pauta de junho exibir a carteira de agosto. Quando o
     mês em foco não tem snapshot (a planilha da diretoria atrasa), cai no mais
     recente ANTERIOR a ele e a tela diz de que mês veio. */
  const noMaisRecenteAte = <T,>(mapa: Map<string, T>, col: string | null): { valor: T | null; chave: string | null } => {
    const alvo = col ? competenciaDe(col) : null;
    if (!alvo) return { valor: null, chave: null };
    if (mapa.has(alvo)) return { valor: mapa.get(alvo)!, chave: alvo };
    const antes = [...mapa.keys()].filter((k) => k < alvo).sort();
    const k = antes[antes.length - 1];
    return k ? { valor: mapa.get(k)!, chave: k } : { valor: null, chave: null };
  };

  const carteiraMes = useMemo(() => noMaisRecenteAte(carteiras, mes), [carteiras, mes]);
  const carteiraAnt = useMemo(() => noMaisRecenteAte(carteiras, mesAnterior), [carteiras, mesAnterior]);
  const churnMes = useMemo(() => noMaisRecenteAte(churns, mes), [churns, mes]);
  const churnAnt = useMemo(() => noMaisRecenteAte(churns, mesAnterior), [churns, mesAnterior]);
  /** A carteira exibida é de outro mês que não o da reunião? */
  const carteiraDefasada = !!mes && !!carteiraMes.chave && carteiraMes.chave !== competenciaDe(mes);

  /** Meta da aba "Operação" do BP para um mês qualquer. */
  const metaOperacao = useCallback((col: string | null) => {
    if (!col) return null;
    const ano = 2000 + Number(col.slice(-2));
    const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const m = EN.indexOf(col.slice(0, 3)) + 1;
    if (m < 1) return null;
    return operacaoPorAno.get(ano)?.get(`${ano}-${String(m).padStart(2, "0")}-01`) ?? null;
  }, [operacaoPorAno]);

  /** O plano de clientes/churn do PRÓPRIO mês da reunião, para os KPIs do Resumo. */
  const metaDoMes = useMemo(() => metaOperacao(mes), [metaOperacao, mes]);

  const prox = useMemo(() => {
    if (!mes) return null;
    return proximoMes({
      plano: temBp ? plano : null,
      ebitdaRealizado: espinha.find((l) => l.rubrica === EBITDA)?.realizado ?? null,
      mes,
      metaClientes: metaOperacao(mesSeguinte(mes)),
      carteira: carteiraMes.valor?.mix ?? null,
      clientesAtivos: carteiraMes.valor?.clientes ?? null,
      mrr: carteiraMes.valor?.mrr ?? null,
      ticket: carteiraMes.valor?.ticket ?? null,
      churn: churnMes.valor,
    });
  }, [mes, metaOperacao, temBp, plano, espinha, carteiraMes, churnMes]);

  const quantosNoCorte = par ? acimaDoCorte(par.ofensores, corte) : 0;

  const sinal = useMemo(() => (mes && par && caixa ? montarSinal({
    mes, detalhe, espinha, pareto: par, caixa, proximo: prox,
    justificativas, quantos: quantosNoCorte,
  }) : null), [mes, detalhe, espinha, par, caixa, prox, justificativas, quantosNoCorte]);

  /* ---------------------------- o texto ---------------------------- */
  const carregarTexto = useCallback(async (alvo: string) => {
    const [rev, just] = await Promise.all([
      sb.from("demonstracoes_revisao").select("*").eq("mes", alvo).maybeSingle(),
      sb.rpc("revisao_justificativas", { p_mes: alvo }),
    ]);
    setRevisao((rev?.data as RevisaoRow) ?? null);
    setJustificativas(new Map(Object.entries((just?.data ?? {}) as Record<string, string>)));
  }, []);

  useEffect(() => { if (mes) void carregarTexto(mes); }, [mes, carregarTexto]);

  /* ---- as apresentações do mês ----
     Trocar de mês FECHA a apresentação aberta em vez de tentar levá-la junto: o
     roteiro é do mês (aponta para "Rubrica · Servidor", que pode não existir em
     agosto), e arrastá-lo para outro mês daria uma folha cheia de buraco. */
  const carregarApresentacoes = useCallback(async (alvo: string) => {
    const { data } = await sb
      .from("demonstracoes_apresentacoes")
      .select("*")
      .eq("mes", alvo)
      .order("atualizada_em", { ascending: false });
    setApresentacoes((data ?? []) as Apresentacao[]);
  }, []);

  useEffect(() => {
    if (!mes) return;
    setApresId(null);
    setRoteiro(ROTEIRO_VAZIO);
    setTextosApres({});
    setCongelado(null);
    setStatusApres("rascunho");
    setNomeApres("");
    void carregarApresentacoes(mes);
  }, [mes, carregarApresentacoes]);

  const leitura = useMemo<Leitura>(() => aplicarEdicao(
    revisao ? {
      veredicto_nivel: revisao.veredicto_nivel ?? "atencao",
      veredicto_titulo: revisao.veredicto_titulo ?? "",
      veredicto_resumo: revisao.veredicto_resumo ?? "",
      destaques: revisao.destaques ?? [],
      rubricas: revisao.rubricas ?? [],
      decisoes: revisao.decisoes ?? [],
      fecho: revisao.fecho ?? "",
    } : null,
    revisao?.editado ?? null,
  ), [revisao]);

  const textoDe = (rubrica: string) => leitura.rubricas.find((r) => r.rubrica === rubrica);
  const temTexto = !!revisao && !!leitura.veredicto_titulo;
  const envelheceu = sinal ? sinalMudou(revisao?.sinal ?? null, sinal) : false;
  /* O texto foi escrito contra outra granularidade de Pareto: as rubricas com
     parágrafo não são as que estão na tela. Vale dizer, não corrigir sozinho. */
  const outroDetalhe = !!revisao && revisao.detalhe !== detalhe;

  const gerar = async (force: boolean) => {
    if (!mes || !sinal) return;
    setGerando(true);
    try {
      const { data, error } = await supabase.functions.invoke("demonstracoes-revisao", {
        body: { mes, sinal, detalhe, force },
      });
      if (error) throw error;
      const resposta = (data ?? {}) as { error?: string; gerada?: boolean; faltando?: number };
      if (resposta.error) throw new Error(resposta.error);
      if (resposta.gerada === false) {
        toast.info("O sinal não mudou desde a última geração — o texto continua valendo.");
      } else {
        /* A IA pode devolver menos rubricas do que se pediu sem a chamada
           falhar. Sem isto, uma pauta pela metade chega com cara de completa. */
        const faltando = Number(resposta.faltando) || 0;
        toast.success(
          faltando > 0
            ? `Revisão reescrita — ${faltando} rubrica(s) ficaram sem texto.`
            : "Revisão reescrita.",
        );
      }
      await carregarTexto(mes);
    } catch (e) {
      toast.error("Não consegui gerar a revisão: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGerando(false);
    }
  };

  /* ---- edição por campo ----
     O patch é acumulado em cima do `editado` que JÁ ESTÁ no banco, e nunca em
     cima do texto exibido: gravar a leitura inteira como edição congelaria os
     dez campos contra o próximo "Regerar", que é exatamente o que a edição por
     card existe para evitar. */
  const salvarPatch = async (mudar: (p: Partial<Leitura>) => Partial<Leitura>) => {
    if (!mes) return;
    const base = structuredClone((revisao?.editado ?? {}) as Partial<Leitura>);
    const { error } = await sb.rpc("revisao_decidir", { p_mes: mes, p_editado: mudar(base) });
    if (error) { toast.error("Não consegui salvar: " + error.message); return; }
    await carregarTexto(mes);
  };

  /** Reescreve UM campo com a IA e grava o resultado como edição da pessoa. */
  const pedirIA = async (
    rotulo: string,
    atual: string,
    instrucao: string,
    aplicar: (p: Partial<Leitura>, texto: string, itens: string[]) => Partial<Leitura>,
    lista = false,
  ): Promise<string | null> => {
    if (!mes || !sinal) return null;
    try {
      const { data, error } = await supabase.functions.invoke("demonstracoes-revisao", {
        body: { mes, sinal, detalhe, campo: { rotulo, atual, lista }, instrucao },
      });
      if (error) throw error;
      const r = (data ?? {}) as { error?: string; texto?: string; itens?: string[] };
      if (r.error) throw new Error(r.error);
      const texto = (r.texto ?? "").trim();
      const itens = (r.itens ?? []).filter(Boolean);
      if (!texto && !itens.length) throw new Error("a IA devolveu vazio");
      await salvarPatch((p) => aplicar(p, texto, itens));
      toast.success(`"${rotulo}" reescrito. O Regerar não apaga isto.`);
      return texto || itens.join("\n");
    } catch (e) {
      toast.error("Não consegui reescrever: " + (e instanceof Error ? e.message : String(e)));
      return null;
    }
  };

  const voltarAoRascunho = async () => {
    if (!mes) return;
    setSalvando(true);
    const { error } = await sb.rpc("revisao_decidir", { p_mes: mes, p_editado: {} });
    setSalvando(false);
    if (error) { toast.error("Não consegui limpar: " + error.message); return; }
    toast.success("Voltou tudo ao rascunho da IA.");
    await carregarTexto(mes);
  };

  /* ============================================================
   *  A apresentação: abrir, salvar, publicar
   * ============================================================ */

  const abrirApresentacao = (a: Apresentacao | null) => {
    if (!a) {
      setApresId(null);
      setRoteiro(ROTEIRO_VAZIO);
      setTextosApres({});
      setCongelado(null);
      setStatusApres("rascunho");
      setNomeApres("");
      setMontando(false);
      return;
    }
    /* `sanear` na ABERTURA, não na gravação: o roteiro é de julho e a tela pode
       estar em agosto, onde a rubrica "Servidor" não existe mais. Tirar na hora
       de mostrar evita a folha com buraco e avisa quem abriu. */
    const { roteiro: limpo, removidas } = sanear(a.roteiro ?? ROTEIRO_VAZIO, catalogoRef.current);
    if (removidas.length) {
      toast.message(`${removidas.length} card(s) saíram: não existem mais neste mês.`, {
        description: removidas.join(", "),
      });
    }
    setApresId(a.id);
    setNomeApres(a.nome);
    setRoteiro(limpo);
    setTextosApres(a.textos ?? {});
    setStatusApres(a.status);
    setCongelado(a.congelado ?? null);
    setBloco(0);
  };

  /**
   * Devolve o id da apresentação em edição, CRIANDO-A se ainda não existir.
   *
   * A primeira mudança é que faz a apresentação nascer — reescrever um "por que"
   * na tela de trabalho, tirar um card, o que vier. Obrigar a criar antes seria
   * um passo a mais para quem só queria ajustar uma frase.
   */
  const garantirApresentacao = useCallback(async (
    r?: Roteiro,
    textos?: Record<string, string>,
    nome?: string,
  ): Promise<string | null> => {
    if (!mes) return null;
    const alvo = nome ?? nomeApres ?? "";
    const { data, error } = await sb.rpc("apresentacao_salvar", {
      p_mes: mes,
      p_nome: alvo.trim() || `Revisão de ${mesPorExtenso(mes)}`,
      p_roteiro: r ?? (roteiro.folhas.length ? roteiro : roteiroPadrao(catalogoPadraoRef.current)),
      p_textos: textos ?? textosApres,
      p_id: apresId,
    });
    if (error) { toast.error("Não consegui salvar a apresentação: " + error.message); return null; }
    const id = data as string;
    if (!apresId) {
      setApresId(id);
      if (!nomeApres) setNomeApres(`Revisão de ${mesPorExtenso(mes)}`);
      if (!roteiro.folhas.length) setRoteiro(roteiroPadrao(catalogoPadraoRef.current));
    }
    setStatusApres("rascunho");
    setCongelado(null);
    await carregarApresentacoes(mes);
    return id;
  }, [mes, nomeApres, roteiro, textosApres, apresId, carregarApresentacoes]);

  /** Grava o roteiro depois de qualquer mexida do montador. */
  const salvarRoteiro = useCallback(async (novo: Roteiro, descricao: string) => {
    setRoteiro(novo);
    setSalvandoApres(true);
    const publicadaAntes = statusApres === "publicada";
    const id = await garantirApresentacao(novo);
    setSalvandoApres(false);
    if (!id) return;
    if (publicadaAntes) toast.message(`${descricao} — a apresentação voltou a rascunho.`);
  }, [garantirApresentacao, statusApres]);

  const renomearApresentacao = useCallback(async (v: string) => {
    setNomeApres(v);
    setSalvandoApres(true);
    await garantirApresentacao(roteiro, textosApres, v);
    setSalvandoApres(false);
  }, [garantirApresentacao, roteiro, textosApres]);

  /**
   * Publica: congela o HTML de cada peça como ela está na tela.
   *
   * Congelar o NÚMERO e remontar depois exigiria uma segunda implementação da
   * DRE dentro do leitor de ata — a que sempre diverge. O HTML já renderizado é
   * o que o CEO viu, literalmente. Os botões de tela (`data-chrome`) saem antes:
   * ata não tem lápis.
   */
  const publicar = async () => {
    if (!mes) return;
    setSalvandoApres(true);
    try {
      const id = await garantirApresentacao();
      if (!id) return;
      const html: Record<string, string> = {};
      for (const el of document.querySelectorAll<HTMLElement>("[data-revisao-peca]")) {
        const chave = el.getAttribute("data-revisao-peca");
        if (!chave) continue;
        const copia = el.cloneNode(true) as HTMLElement;
        for (const botao of copia.querySelectorAll("[data-chrome]")) botao.remove();
        html[chave] = copia.innerHTML;
      }
      const { error } = await sb.rpc("apresentacao_publicar", {
        p_id: id,
        p_congelado: { html, leitura, sinal, em: new Date().toISOString() },
      });
      if (error) throw new Error(error.message);
      setStatusApres("publicada");
      setCongelado({ html, leitura, sinal, em: new Date().toISOString() });
      await carregarApresentacoes(mes);
      toast.success("Apresentação publicada — os números ficaram congelados como estão agora.");
    } catch (e) {
      toast.error("Não consegui publicar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvandoApres(false);
    }
  };

  /**
   * Nasce uma apresentação nova, já com os cinco blocos montados.
   *
   * INSERÇÃO explícita (`p_id: null`), e não `garantirApresentacao`: aquela
   * grava por cima da que está aberta, e "nova" com uma aberta gravaria a nova
   * em cima da velha. O nome procura o primeiro número livre porque (mes, nome)
   * é único — contar quantas existem daria colisão logo depois de uma exclusão.
   */
  const criarApresentacao = async () => {
    if (!mes) return;
    const usados = new Set(apresentacoes.map((a) => a.nome));
    let n = apresentacoes.length + 1;
    let nome = `Apresentação ${n} · ${mesPorExtenso(mes)}`;
    while (usados.has(nome)) nome = `Apresentação ${++n} · ${mesPorExtenso(mes)}`;

    const novo = roteiroPadrao(catalogoPadraoRef.current);
    setSalvandoApres(true);
    const { data, error } = await sb.rpc("apresentacao_salvar", {
      p_mes: mes, p_nome: nome, p_roteiro: novo, p_textos: {}, p_id: null,
    });
    setSalvandoApres(false);
    if (error) { toast.error("Não consegui criar: " + error.message); return; }
    setApresId(data as string);
    setNomeApres(nome);
    setRoteiro(novo);
    setTextosApres({});
    setStatusApres("rascunho");
    setCongelado(null);
    setBloco(0);
    setMontando(true);
    await carregarApresentacoes(mes);
    toast.success(`"${nome}" criada com os cinco blocos. Tire o que não for desta reunião.`);
  };

  const duplicarApresentacao = async () => {
    if (!apresId || !mes) return;
    const nome = window.prompt("Nome da cópia:", `${nomeApres} (cópia)`);
    if (!nome?.trim()) return;
    const { data, error } = await sb.rpc("apresentacao_duplicar", { p_id: apresId, p_nome: nome.trim() });
    if (error) { toast.error(error.message); return; }
    await carregarApresentacoes(mes);
    const { data: nova } = await sb.from("demonstracoes_apresentacoes").select("*").eq("id", data).maybeSingle();
    if (nova) abrirApresentacao(nova as Apresentacao);
    toast.success(`"${nome.trim()}" criada a partir desta.`);
  };

  const excluirApresentacao = async () => {
    if (!apresId || !mes) return;
    if (!window.confirm(`Excluir "${nomeApres}"? Isto não volta atrás.`)) return;
    const { error } = await sb.rpc("apresentacao_excluir", { p_id: apresId });
    if (error) { toast.error(error.message); return; }
    abrirApresentacao(null);
    await carregarApresentacoes(mes);
    toast.success("Apresentação excluída.");
  };

  /* ---- o texto que é DESTA apresentação ----------------------------------
     O "por que aconteceu" nasce do comentário da célula da DRE. Reescrever aqui
     grava em `textos` da apresentação e NÃO volta para a DRE: a mesma rubrica
     pode precisar de uma frase para o CEO e de outra para o board, e o
     comentário do fechamento é da contabilidade, não da plateia. Apagar o texto
     devolve o da DRE. */
  const porQueDe = (rubrica: string): string | null =>
    textosApres[`porque:${rubrica}`] ?? justificativas.get(rubrica) ?? null;

  const salvarTextoApres = async (chave: string, valor: string) => {
    const novos = { ...textosApres };
    if (valor.trim()) novos[chave] = valor; else delete novos[chave];
    setTextosApres(novos);
    setSalvandoApres(true);
    await garantirApresentacao(undefined, novos);
    setSalvandoApres(false);
  };

  const campoPorQue = (rubrica: string) => ({
    rotulo: `Por que aconteceu · ${rubrica}`,
    onSalvar: (v: string) => salvarTextoApres(`porque:${rubrica}`, v),
    /* A IA reescreve com o MESMO dossiê dos outros campos, mas o resultado é
       gravado na apresentação, não na leitura do mês. */
    onIA: async (instrucao: string): Promise<string | null> => {
      if (!mes || !sinal) return null;
      try {
        const { data, error } = await supabase.functions.invoke("demonstracoes-revisao", {
          body: {
            mes, sinal, detalhe,
            campo: { rotulo: `Por que aconteceu · ${rubrica}`, atual: porQueDe(rubrica) ?? "", lista: false },
            instrucao,
          },
        });
        if (error) throw error;
        const r = (data ?? {}) as { error?: string; texto?: string };
        if (r.error) throw new Error(r.error);
        const texto = (r.texto ?? "").trim();
        if (!texto) throw new Error("a IA devolveu vazio");
        await salvarTextoApres(`porque:${rubrica}`, texto);
        toast.success("Reescrito só nesta apresentação — a DRE não mudou.");
        return texto;
      } catch (e) {
        toast.error("Não consegui reescrever: " + (e instanceof Error ? e.message : String(e)));
        return null;
      }
    },
  });

  /* ---- os campos, um por um ----
     Cada entrada diz como o texto entra no patch. Ficam juntas porque é a lista
     do que é editável na tela — espalhar isso pelo JSX esconderia a resposta. */
  const campoVeredictoTitulo = {
    rotulo: "Veredicto · manchete",
    onSalvar: (v: string) => salvarPatch((p) => ({ ...p, veredicto_titulo: v })),
    onIA: (i: string) => pedirIA("Veredicto · manchete", leitura.veredicto_titulo, i,
      (p, t) => ({ ...p, veredicto_titulo: t })),
  };
  const campoVeredictoResumo = {
    rotulo: "Veredicto · resumo",
    onSalvar: (v: string) => salvarPatch((p) => ({ ...p, veredicto_resumo: v })),
    onIA: (i: string) => pedirIA("Veredicto · resumo", leitura.veredicto_resumo, i,
      (p, t) => ({ ...p, veredicto_resumo: t })),
  };
  const campoFecho = {
    rotulo: "Fecho · se as decisões saírem",
    onSalvar: (v: string) => salvarPatch((p) => ({ ...p, fecho: v })),
    onIA: (i: string) => pedirIA("Fecho · se as decisões saírem", leitura.fecho, i,
      (p, t) => ({ ...p, fecho: t })),
  };

  /** Um destaque do bloco 1, casado por POSIÇÃO (ver `aplicarEdicao`). */
  const campoDestaque = (i: number) => {
    const d = leitura.destaques[i];
    const rotulo = `Destaque ${i + 1}${d?.area ? ` · ${d.area}` : ""}`;
    const noPatch = (p: Partial<Leitura>, texto: string) => {
      const lista = [...(p.destaques ?? [])];
      while (lista.length <= i) lista.push({ nivel: "info", area: "", titulo: "", texto: "" });
      lista[i] = { ...lista[i], nivel: lista[i].nivel ?? d?.nivel ?? "info", texto };
      return { ...p, destaques: lista };
    };
    return {
      rotulo,
      onSalvar: (v: string) => salvarPatch((p) => noPatch(p, v)),
      onIA: (instr: string) => pedirIA(rotulo, d?.texto ?? "", instr, (p, t) => noPatch(p, t)),
    };
  };

  /** Impacto ou ação de uma rubrica do Pareto. */
  const campoRubrica = (rubrica: string, qual: "impacto" | "acao") => {
    const rotulo = `${qual === "impacto" ? "Impacto" : "Ação sugerida"} · ${rubrica}`;
    const atual = leitura.rubricas.find((r) => r.rubrica === rubrica)?.[qual] ?? "";
    const noPatch = (p: Partial<Leitura>, texto: string) => {
      const lista = [...(p.rubricas ?? [])];
      const i = lista.findIndex((r) => r.rubrica === rubrica);
      const linha = i >= 0 ? { ...lista[i] } : { rubrica, impacto: "", acao: "" };
      linha[qual] = texto;
      if (i >= 0) lista[i] = linha; else lista.push(linha);
      return { ...p, rubricas: lista };
    };
    return {
      rotulo,
      onSalvar: (v: string) => salvarPatch((p) => noPatch(p, v)),
      onIA: (instr: string) => pedirIA(rotulo, atual, instr, (p, t) => noPatch(p, t)),
    };
  };

  const campoDecisoes = {
    rotulo: "O que a reunião decide hoje",
    onSalvar: (v: string) => salvarPatch((p) => ({
      ...p,
      decisoes: v.split("\n").map((x) => x.trim()).filter(Boolean),
    })),
    onIA: (i: string) => pedirIA(
      "O que a reunião decide hoje", leitura.decisoes.join("\n"), i,
      (p, t, itens) => ({ ...p, decisoes: itens.length ? itens : t.split("\n").filter(Boolean) }),
      true,
    ),
  };

  const conferir = async () => {
    if (!mes) return;
    const { error } = await sb.rpc("revisao_decidir", {
      p_mes: mes,
      p_status: revisao?.status === "aceito" ? "novo" : "aceito",
    });
    if (error) { toast.error(error.message); return; }
    await carregarTexto(mes);
  };

  /* ---------------------------- modo reunião ----------------------------
     Tela cheia DE VERDADE (Fullscreen API), não só a sobreposição do Hub: numa
     reunião projetada, a barra de endereço e as abas roubam dois centímetros do
     slide e denunciam que aquilo é uma página aberta no navegador.

     Quem vai para tela cheia é o `<html>`, e NÃO a raiz desta página. Diálogos
     (exportar) e toasts são portados para o `<body>`; com um nó abaixo deles em
     tela cheia, eles ficariam fora da árvore exibida — invisíveis, sem erro
     nenhum para explicar por quê.

     A sobreposição continua existindo para o caso de o navegador recusar a tela
     cheia (permissão, iframe): recusada, o modo reunião ainda esconde o Hub. */
  const alternarReuniao = useCallback((ligar: boolean) => {
    setModoReuniao(ligar);
    // Entrar em tela cheia RECOLHE a barra: ela é a única coisa no slide que
    // denuncia que aquilo é um sistema. Sair traz de volta.
    setRailAberto(!ligar);
    if (ligar) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  /* F11 e o Esc do navegador saem da tela cheia POR FORA do React. Sem ouvir o
     evento, o botão continuaria dizendo "sair" com a página já fora dela. */
  useEffect(() => {
    const aoTrocar = () => { if (!document.fullscreenElement) setModoReuniao(false); };
    document.addEventListener("fullscreenchange", aoTrocar);
    return () => document.removeEventListener("fullscreenchange", aoTrocar);
  }, []);

  /* ---------------------------- navegação ---------------------------- */
  const irPara = useCallback((i: number) => {
    const palco = palcoRef.current;
    // O limite vem do DOM, não de uma constante: com uma apresentação aberta as
    // seções são as folhas do roteiro, e são quantas a pessoa montou.
    const secoes = palco?.querySelectorAll<HTMLElement>("[data-revisao-bloco]") ?? [];
    const n = Math.max(0, Math.min(secoes.length - 1, i));
    setBloco(n);
    const alvo = secoes[n];
    if (!palco || !alvo) return;
    /* Salto síncrono: `scroll-behavior: smooth` é cancelado pelo scroll-snap e
       deixaria o rail apontando um bloco e a tela mostrando outro. */
    animando.current = true;
    // O bloco alto rola por dentro (ver a seção no render). Chegar nele pela
    // seta e encontrar a metade de baixo, de onde a pessoa parou da última vez,
    // seria começar o assunto pelo meio.
    alvo.scrollTop = 0;
    palco.scrollTop = alvo.offsetTop;
    window.setTimeout(() => { animando.current = false; }, 160);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      // Digitar num textarea não pode virar troca de bloco.
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); irPara(bloco + 1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); irPara(bloco - 1); }
      // Sai pelo mesmo caminho do botão: só `setModoReuniao(false)` deixaria a
      // janela em tela cheia com o Hub de volta por baixo.
      if (e.key === "Escape") alternarReuniao(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bloco, irPara, alternarReuniao]);

  /* O rail acompanha a rolagem feita com o mouse — senão os pontinhos ficam
     dizendo "01 / 05" enquanto a pessoa já está no bloco do caixa. */
  const aoRolar = () => {
    if (animando.current) return;
    const palco = palcoRef.current;
    if (!palco) return;
    const y = palco.scrollTop + 48;
    const secoes = [...palco.querySelectorAll<HTMLElement>("[data-revisao-bloco]")];
    let i = 0;
    secoes.forEach((s, k) => { if (y >= s.offsetTop) i = k; });
    if (i !== bloco) setBloco(i);
  };

  /* ============================================================
   *  Render
   * ============================================================ */

  if (carregando) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Montando a revisão…
      </div>
    );
  }

  if (!mes || !par || !caixa) {
    return (
      <div className="p-6">
        <Vazio>
          Nenhum mês com dado na DRE. Importe o tracker ou rode a sincronização com o Omie
          em <b>Demonstrações › DRE</b> e volte aqui.
        </Vazio>
      </div>
    );
  }

  const travado = travados.has(mes);
  const receita = espinha.find((l) => l.rubrica === RECEITA_BRUTA);
  const ebitda = espinha.find((l) => l.rubrica === EBITDA);
  const rl = espinha.find((l) => l.rubrica === RL);
  const sga = espinha.find((l) => l.rubrica === SGA);
  const margemContrib = espinha.find((l) => l.rubrica === MARGEM_CONTRIB);
  const margem = ebitda?.realizado != null && rl?.realizado ? ebitda.realizado / rl.realizado : null;
  const margemOrcada = ebitda?.orcado != null && rl?.orcado ? ebitda.orcado / rl.orcado : null;
  /** Quanto uma rubrica pesa na receita líquida do mês. */
  const pctDaRl = (v: number | null | undefined) =>
    v == null || !rl?.realizado ? "—" : `${((v / rl.realizado) * 100).toFixed(1).replace(".", ",")}%`;
  const ofensoresNoCorte = par.ofensores.slice(0, quantosNoCorte);
  const abaixoDoCorte = par.ofensores.slice(quantosNoCorte);
  const nivelMeta = NIVEL_META[leitura.veredicto_nivel === "ok" ? "info" : leitura.veredicto_nivel];

  /* ------------------------------ blocos ------------------------------ */

  /* ---- os cards do bloco 1 ------------------------------------------------
     Cada filho de topo leva `key`: é ela que vira a CHAVE do card no catálogo
     da apresentação (`pecasDoBloco`, mais abaixo). Sem a key, a identidade do
     card seria a posição — e um card que não aparece neste mês (o aviso da
     carteira, os destaques antes de a leitura existir) empurraria todos os
     outros, trocando silenciosamente o que a apresentação salva mostra. */
  const blocoResumo = (
    <>
      <CabecalhoBloco
        key="cabecalho"
        n={1}
        titulo="Resumo"
        direita={
          <>
            <Chip tone={travado ? undefined : "warn"}>
              {travado ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
              {rotuloMes(mes)} {travado ? "travado" : "ainda sem cadeado"}
            </Chip>
            {!temBp && <Chip tone="warn">sem BP importado — nada a comparar</Chip>}
            {envelheceu && <Chip tone="warn">os números mudaram depois deste texto</Chip>}
          </>
        }
      />

      {/* -------- o veredicto -------- */}
      {temTexto ? (
        <section key="veredicto" className="card-surface relative flex items-stretch overflow-hidden">
          <div className={cn(
            "w-1 shrink-0",
            leitura.veredicto_nivel === "critico" ? "bg-neg"
              : leitura.veredicto_nivel === "ok" ? "bg-pos" : "bg-amber-500",
          )} />
          <div className="flex flex-1 flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-7">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <nivelMeta.Icone className={cn(
                  "h-4 w-4",
                  leitura.veredicto_nivel === "critico" ? "text-neg"
                    : leitura.veredicto_nivel === "ok" ? "text-pos" : "text-amber-500",
                )} />
                <span className={nivelMeta.cls}>{nivelMeta.rotulo} · {rotuloMes(mes)}</span>
                {revisao?.status === "aceito" && (
                  <span className="insight-tag" style={{ color: "hsl(var(--pos))", background: "hsl(var(--pos) / 0.1)" }}>
                    CONFERIDO
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-[15px] font-semibold leading-snug">
                <CampoTexto valor={leitura.veredicto_titulo} linhas={2} {...campoVeredictoTitulo} />
              </h2>
              <div className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <CampoTexto valor={leitura.veredicto_resumo} {...campoVeredictoResumo} />
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-6 lg:gap-8">
              {[
                { r: "Receita", v: brl(receita?.realizado), sub: `${brlCheio(rl?.realizado)} líq.`, t: "text-pos" },
                { r: "Margem EBITDA", v: fracPct(margem), sub: `orçado ${fracPct(margemOrcada)}`, t: tom(margem != null && margemOrcada != null ? margem >= margemOrcada : null) },
                {
                  r: "Runway",
                  v: caixa.runway?.gerandoCaixa ? "gera caixa"
                    : caixa.runway?.meses == null ? "—"
                    : `${caixa.runway.meses.toFixed(1).replace(".", ",")} m`,
                  sub: "meta ≥ 6 meses",
                  t: caixa.runway?.gerandoCaixa ? "text-pos"
                    : caixa.runway?.meses != null && caixa.runway.meses < 6 ? "text-neg" : "text-pos",
                },
              ].map((x) => (
                <div key={x.r} className="flex flex-col gap-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{x.r}</div>
                  <div className={cn("num text-[20px] font-semibold leading-none", x.t)}>{x.v}</div>
                  <div className="text-[11px] text-muted-foreground">{x.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <Vazio key="veredicto">
          A leitura deste mês ainda não foi escrita. Os números abaixo já estão prontos —
          clique em <b>Gerar leitura</b>, no rodapé, para a IA redigir o veredicto, o impacto
          de cada rubrica e a pauta de decisões em cima deles.
        </Vazio>
      )}

      {/* -------- os oito KPIs ----------------------------------------------
           Resultado em cima, caixa e base embaixo. Todo card responde as duas
           mesmas perguntas — como está contra o mês passado e contra o plano —
           porque é essa a conversa da reunião, e um card que só mostra o valor
           obriga quem lê a fazer a conta de cabeça. */}
      <div key="kpis-resultado" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi eyebrow="Receita bruta" valor={brl(receita?.realizado)}>
          <Comparativos itens={[
            { rotulo: "vs mês ant.", texto: fracPct(receita?.mom), bom: sinalDe(receita?.mom) },
            { rotulo: "vs orçado", texto: fracPct(receita?.desvioPct), bom: sinalDe(receita?.impacto) },
          ]} />
          {receita?.orcado != null && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
                <span>Orçado</span><span className="num text-foreground/80">{brlCheio(receita.orcado)}</span>
              </div>
              <Barra pct={((receita.realizado ?? 0) / receita.orcado) * 100} />
            </div>
          )}
        </Kpi>

        <Kpi
          eyebrow="Margem de contribuição"
          valor={brl(margemContrib?.realizado)}
          tomValor={tom((margemContrib?.realizado ?? 0) >= 0)}
        >
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            {pctDaRl(margemContrib?.realizado)} da receita líquida
          </div>
          <Comparativos itens={[
            { rotulo: "vs mês ant.", texto: fracPct(margemContrib?.mom), bom: sinalDe(margemContrib?.mom) },
            { rotulo: "vs orçado", texto: comSinal(margemContrib?.impacto), bom: sinalDe(margemContrib?.impacto) },
          ]} />
        </Kpi>

        <Kpi eyebrow="EBITDA" valor={brl(ebitda?.realizado)} tomValor={tom((ebitda?.realizado ?? 0) >= 0)}>
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            margem {fracPct(margem)} · orçado {fracPct(margemOrcada)}
          </div>
          <Comparativos itens={[
            { rotulo: "vs mês ant.", texto: fracPct(ebitda?.mom), bom: sinalDe(ebitda?.mom) },
            { rotulo: "vs orçado", texto: comSinal(ebitda?.impacto), bom: sinalDe(ebitda?.impacto) },
          ]} />
        </Kpi>

        <Kpi eyebrow="SG&A" valor={brl(sga?.realizado)}>
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            {pctDaRl(sga?.realizado)} da RL
            {sga?.orcado != null && rl?.orcado
              ? ` · alvo ${((sga.orcado / rl.orcado) * 100).toFixed(1).replace(".", ",")}%`
              : ""}
          </div>
          <Comparativos itens={[
            // Em despesa, subir é ruim — daí o sinal invertido.
            { rotulo: "vs mês ant.", texto: fracPct(sga?.mom), bom: sga?.mom == null ? null : sga.mom <= 0 },
            { rotulo: "vs orçado", texto: fracPct(sga?.desvioPct), bom: sinalDe(sga?.impacto) },
          ]} />
        </Kpi>
      </div>

      <div key="kpis-base" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          eyebrow="FCO · caixa operacional"
          valor={brl(caixa.fco)}
          tomValor={tom((caixa.fco ?? 0) >= 0)}
        >
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            fluxo livre {abreviado(caixa.livre)}
          </div>
          <Comparativos itens={[
            {
              rotulo: "vs mês ant.",
              texto: comSinal(caixa.fco != null && caixa.fcoAnterior != null ? caixa.fco - caixa.fcoAnterior : null),
              bom: caixa.fco != null && caixa.fcoAnterior != null ? caixa.fco >= caixa.fcoAnterior : null,
            },
            {
              rotulo: "vs orçado",
              texto: comSinal(caixa.fco != null && caixa.fcoOrcado != null ? caixa.fco - caixa.fcoOrcado : null),
              bom: caixa.fco != null && caixa.fcoOrcado != null ? caixa.fco >= caixa.fcoOrcado : null,
            },
          ]} />
        </Kpi>

        <Kpi
          eyebrow={<>Caixa hoje{caixa.saldoEm ? ` · ${new Date(caixa.saldoEm).toLocaleDateString("pt-BR")}` : ""}</>}
          valor={brl(caixa.saldo)}
        >
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            burn 3m {abreviado(caixa.burn3m)}
          </div>
          <div className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
            <span>runway</span>
            <b className={cn(
              "num text-[13px]",
              caixa.runway?.gerandoCaixa || (caixa.runway?.meses ?? 0) >= 6 ? "text-pos" : "text-neg",
            )}>
              {caixa.runway?.gerandoCaixa ? "gera caixa"
                : caixa.runway?.meses == null ? "—"
                : `${caixa.runway.meses.toFixed(1).replace(".", ",")} meses`}
            </b>
            <span className="opacity-80">meta ≥ 6</span>
          </div>
        </Kpi>

        <Kpi eyebrow="Clientes ativos" valor={inteiro(carteiraMes.valor?.clientes)}>
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            MRR {abreviado(carteiraMes.valor?.mrr)} · ticket {abreviado(carteiraMes.valor?.ticket)}
          </div>
          <Comparativos itens={[
            {
              rotulo: "vs mês ant.",
              texto: contagem(carteiraMes.valor && carteiraAnt.valor
                ? carteiraMes.valor.clientes - carteiraAnt.valor.clientes : null),
              bom: carteiraMes.valor && carteiraAnt.valor
                ? carteiraMes.valor.clientes >= carteiraAnt.valor.clientes : null,
            },
            {
              rotulo: "vs meta BP",
              texto: contagem(carteiraMes.valor && metaDoMes
                ? carteiraMes.valor.clientes - metaDoMes.clientes_eop : null),
              bom: carteiraMes.valor && metaDoMes
                ? carteiraMes.valor.clientes >= metaDoMes.clientes_eop : null,
            },
          ]} />
        </Kpi>

        <Kpi eyebrow="Churn do mês" valor={inteiro(churnMes.valor?.qtd)} tomValor="text-neg">
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            {abreviado(churnMes.valor?.valor)} de MRR
            {churnMes.valor?.pct ? ` · ${churnMes.valor.pct.toFixed(2).replace(".", ",")}% da receita` : ""}
          </div>
          <Comparativos itens={[
            {
              rotulo: "vs mês ant.",
              // Menos gente saindo é melhor: o sinal é invertido de propósito.
              texto: contagem(churnMes.valor && churnAnt.valor
                ? churnMes.valor.qtd - churnAnt.valor.qtd : null),
              bom: churnMes.valor && churnAnt.valor ? churnMes.valor.qtd <= churnAnt.valor.qtd : null,
            },
            {
              rotulo: "vs meta BP",
              texto: contagem(churnMes.valor && metaDoMes
                ? churnMes.valor.qtd - metaDoMes.perdidos : null),
              bom: churnMes.valor && metaDoMes ? churnMes.valor.qtd <= metaDoMes.perdidos : null,
            },
          ]} />
        </Kpi>
      </div>

      {carteiraDefasada && (
        <p key="aviso-carteira" className="flex items-start gap-1.5 text-[10.5px] leading-snug text-muted-foreground/80">
          <Info className="mt-px h-3 w-3 shrink-0" />
          Não há snapshot de assinaturas para {rotuloMes(mes)}: clientes, MRR e churn acima são de{" "}
          <b>{carteiraMes.valor?.mesLabel || carteiraMes.chave}</b>. O resto do bloco é de {rotuloMes(mes)}.
        </p>
      )}

      {/* -------- os três destaques -------- */}
      {leitura.destaques.length > 0 && (
        <div key="destaques" className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {leitura.destaques.map((d, i) => {
            const meta = NIVEL_META[d.nivel] ?? NIVEL_META.info;
            return (
              <article key={i} className="card-surface p-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className={meta.cls}><meta.Icone className="h-3 w-3" /> {meta.rotulo}</span>
                  <span className="truncate text-[10.5px] text-muted-foreground">{d.area}</span>
                </div>
                <h4 className="text-[13px] font-semibold leading-snug">{d.titulo}</h4>
                <div className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  <CampoTexto valor={d.texto} {...campoDestaque(i)} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );

  /* Escala da cascata: a faixa inteira que os degraus percorrem, COM O ZERO
     dentro. A cascata da Takeat termina abaixo de zero (EBITDA negativo), e uma
     escala montada só sobre o módulo dos valores empurraria a barra do EBITDA
     para fora da caixa — ela ficaria por cima dos rótulos, apontando para baixo,
     sem nenhuma linha de zero para dizer que aquilo é prejuízo. */
  const pontosCascata = degraus.flatMap((d) => (d.total ? [0, d.valor] : [d.base, d.base + d.valor]));
  const topoCascata = Math.max(...pontosCascata, 0);
  const fundoCascata = Math.min(...pontosCascata, 0);
  const amplitudeCascata = topoCascata - fundoCascata || 1;
  /** Valor → altura em % desde o fundo da caixa. */
  const yCascata = (v: number) => ((v - fundoCascata) / amplitudeCascata) * 100;

  const blocoDre = (
    <>
      <CabecalhoBloco
        key="cabecalho"
        n={2}
        titulo="DRE vs. orçado"
        direita={<Chip>{rotuloMes(mes)} · R$ · BP {anoDoMes}</Chip>}
      />

      {/* -------- cascata -------- */}
      <div key="cascata" className="card-surface">
        <header className="flex items-start justify-between gap-4 border-b border-border p-3.5">
          <div>
            <h3 className="text-[13.5px] font-semibold tracking-tight">Cascata do resultado</h3>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Barra cheia é o realizado; o traço é onde o BP colocava a linha.
            </p>
          </div>
          <div className="flex items-center gap-3.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--info))]" />entrada</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />saída</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />orçado</span>
          </div>
        </header>
        <div className="relative grid grid-cols-7 items-end gap-3 px-4 pt-4" style={{ height: 210 }}>
          {/* A linha do zero. Sem ela, uma barra que desce não se distingue de
              uma barra pequena — e é justamente aí que está o prejuízo. */}
          <span
            className="pointer-events-none absolute left-4 right-4 h-px bg-border"
            style={{ bottom: `${yCascata(0)}%` }}
          />
          {degraus.map((d) => {
            const topo = Math.max(d.total ? 0 : d.base, (d.total ? 0 : d.base) + d.valor);
            const fundo = Math.min(d.total ? 0 : d.base, (d.total ? 0 : d.base) + d.valor);
            const orcado = d.orcado == null ? null : (d.total ? d.orcado : d.base + d.orcado);
            return (
              <div key={d.rubrica} className="flex h-full flex-col items-center justify-end gap-1.5">
                <span
                  className={cn("num text-[11px] font-semibold", d.valor < 0 ? "text-neg" : "text-foreground")}
                  title={valorExato(d.valor)}
                >
                  {abreviado(d.valor)}
                </span>
                <div className="relative w-full flex-1">
                  <div
                    className={cn(
                      "absolute w-full rounded-sm",
                      d.total
                        ? (d.valor >= 0 ? "bg-[hsl(var(--info))]" : "bg-neg")
                        : (d.valor >= 0 ? "bg-[hsl(var(--info))]" : "bg-primary"),
                    )}
                    style={{
                      bottom: `${yCascata(fundo)}%`,
                      height: `${Math.max(yCascata(topo) - yCascata(fundo), 1.5)}%`,
                    }}
                  />
                  {orcado != null && (
                    <span
                      className="absolute -left-1 -right-1 h-0.5 bg-muted-foreground/50"
                      style={{ bottom: `calc(${yCascata(orcado)}% - 1px)` }}
                      title={`Orçado ${valorExato(d.orcado)}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-7 gap-3 px-4 pb-3.5 pt-2 text-center text-[10.5px] text-muted-foreground">
          {degraus.map((d) => (
            <span key={d.rubrica} className={cn(d.total && "font-semibold text-foreground")}>
              {d.rubrica.replace("(-) ", "").replace(" da receita", "").replace("Despesas ", "")}
            </span>
          ))}
        </div>
      </div>

      {/* -------- tabela -------- */}
      <div key="tabela" className="card-surface overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-secondary/40">
              {["RUBRICA", `${rotuloMes(mes).toUpperCase()}`, "ORÇADO", "IMPACTO NO EBITDA", "DESVIO %", mesAnterior ? rotuloMes(mesAnterior).toUpperCase() : "—", "MoM"].map((h, i) => (
                <th key={h + i} className={cn(
                  "px-3 py-2 text-[10px] font-bold tracking-wider text-muted-foreground",
                  i === 0 ? "text-left" : "text-right",
                )}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {espinha.map((l) => (
              <tr key={l.rubrica} className={cn("border-b border-border/50", l.total && "bg-secondary/60")}>
                <td className={cn(
                  "px-3 py-[7px] text-[12px]",
                  l.nivel === 1 && "pl-6 text-foreground/80",
                  (l.total || l.nivel === 0) && "font-semibold",
                  l.total && "text-[12.5px] font-bold",
                )}>
                  {l.rubrica}
                </td>
                <td className={cn("num px-3 py-[7px] text-right text-[12px]", l.total && "font-bold", (l.realizado ?? 0) < 0 && "text-neg")}
                    title={valorExato(l.realizado)}>
                  {l.realizado == null ? "—" : abreviado(l.realizado)}
                </td>
                <td className="num px-3 py-[7px] text-right text-[12px] text-muted-foreground" title={valorExato(l.orcado)}>
                  {l.orcado == null ? "—" : abreviado(l.orcado)}
                </td>
                <td className={cn("num px-3 py-[7px] text-right text-[12px] font-semibold", tom(l.impacto == null ? null : l.impacto >= 0))}>
                  {l.impacto == null ? "—" : `${l.impacto >= 0 ? "+" : ""}${abreviado(l.impacto)}`}
                </td>
                <td className={cn("num px-3 py-[7px] text-right text-[12px]", tom(l.impacto == null ? null : l.impacto >= 0))}>
                  {fracPct(l.desvioPct)}
                </td>
                <td className="num px-3 py-[7px] text-right text-[12px] text-muted-foreground" title={valorExato(l.anterior)}>
                  {l.anterior == null ? "—" : abreviado(l.anterior)}
                </td>
                <td className={cn(
                  "num px-3 py-[7px] text-right text-[12px]",
                  l.mom == null ? "text-muted-foreground"
                    : l.natureza === "despesa" ? tom(l.mom <= 0) : tom(l.mom >= 0),
                )}>
                  {fracPct(l.mom)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border/60 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <b>Impacto no EBITDA</b> é o efeito da rubrica no resultado, não o desvio bruto: em receita
          é realizado − orçado, em despesa é orçado − realizado. Nos dois, negativo quer dizer que
          tirou do EBITDA — é o que permite somar receita e despesa no Pareto do bloco seguinte.
          {!travado && " Mês sem cadeado: o omie-sync ainda mexe nas folhas e as linhas de total podem estar atrás delas."}
        </p>
      </div>
    </>
  );

  const blocoPareto = (
    <>
      <CabecalhoBloco
        key="cabecalho"
        n={3}
        titulo="Pareto do desvio"
        direita={
          <>
            {/* Alternador e slider são controles de TELA: na folha exportada eles
                somem (o `data-so-tela` em index.css), porque o relatório mostra
                o resultado da escolha, não o botão que a fez. */}
            <div data-so-tela className="inline-flex items-center rounded-md border border-border p-0.5">
              {(["bloco", "rubrica"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDetalhe(d)}
                  className={cn(
                    "h-7 rounded px-2.5 text-[11.5px] font-medium transition-colors",
                    detalhe === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d === "bloco" ? "por bloco" : "por rubrica"}
                </button>
              ))}
            </div>
            <label data-so-tela className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
              corte
              <input
                type="range" min={50} max={95} step={5}
                value={Math.round(corte * 100)}
                onChange={(e) => setCorte(Number(e.target.value) / 100)}
                className="h-1 w-20 cursor-pointer accent-primary"
              />
              <b className="num text-foreground">{Math.round(corte * 100)}%</b>
            </label>
            <Chip tone="neg">Desfavorável {abreviado(par.desfavoravel)}</Chip>
            <Chip tone="pos">Favorável {abreviado(par.favoravel)}</Chip>
          </>
        }
      />

      {/* Cada pedaço é um filho de TOPO, com key própria, em vez de um `? :` que
          devolve um fragmento com três cards dentro: quem monta a apresentação
          escolhe as barras sem levar as rubricas junto, e o catálogo enxerga
          três cards em vez de um. */}
      {par.ofensores.length === 0 && (
        <Vazio key="vazio">
          {temBp
            ? "Nenhuma rubrica ficou abaixo do plano neste mês — não há Pareto a montar."
            : "Sem BP importado para este ano não há orçado, e sem orçado não há desvio a ranquear. Importe o plano em BP › Importar."}
        </Vazio>
      )}

      {par.ofensores.length > 0 && (
          /* -------- as barras acumuladas -------- */
          <div key="barras" className="card-surface px-4 py-3">
            <div className="relative flex items-end gap-2" style={{ height: 88 }}>
              {par.ofensores.slice(0, 8).map((o, i) => (
                <div key={o.rubrica} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="num text-[10.5px] text-muted-foreground">
                    {(o.fatia * 100).toFixed(1).replace(".", ",")}%
                  </span>
                  <div
                    className={cn("w-full rounded-t-sm", i < quantosNoCorte ? "bg-primary" : "bg-muted-foreground/30")}
                    style={{ height: `${Math.max((o.fatia / (par.ofensores[0]?.fatia || 1)) * 68, 3)}px` }}
                    title={`${o.rubrica} · ${valorExato(o.impacto)}`}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2 text-center text-[10.5px] text-muted-foreground">
              {par.ofensores.slice(0, 8).map((o, i) => (
                <span key={o.rubrica} className="min-w-0 flex-1">
                  <span className="block truncate" title={o.rubrica}>{o.rubrica.replace("(-) ", "")}</span>
                  <span className={cn("num", i === quantosNoCorte - 1 && "font-semibold text-primary")}>
                    acum. {(o.acumulado * 100).toFixed(1).replace(".", ",")}%
                  </span>
                </span>
              ))}
            </div>
          </div>

      )}

      {/* -------- as linhas com leitura --------
          CADA RUBRICA É UM CARD, não uma linha de uma lista: é o card que a
          reunião tira ("Servidor a gente já resolveu, não entra") e é ele que a
          apresentação move de folha. O `grupo` do catálogo devolve a lista ao
          seu invólucro quando as rubricas caem juntas na mesma folha — inclusive
          o `data-export-pilha`, que deixa o exportador repartir a lista entre
          páginas só em rubrica inteira. */}
      {ofensoresNoCorte.map((o) => (
        <LinhaOfensor
          key={`rubrica:${o.rubrica}`}
          o={o}
          porQue={porQueDe(o.rubrica)}
          texto={textoDe(o.rubrica)}
          campoImpacto={campoRubrica(o.rubrica, "impacto")}
          campoAcao={campoRubrica(o.rubrica, "acao")}
          campoPorQue={campoPorQue(o.rubrica)}
        />
      ))}

      {par.ofensores.length > 0 && abaixoDoCorte.length > 0 && (
        <div key="abaixo-do-corte" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-secondary px-1 num text-[11px] font-semibold text-foreground/80">
            {abaixoDoCorte.length}
          </span>
          <span>
            rubricas abaixo do corte de {Math.round(corte * 100)}%, somando{" "}
            <b className="num text-foreground">
              {abreviado(abaixoDoCorte.reduce((s, o) => s + Math.abs(o.impacto ?? 0), 0))}
            </b>{" "}
            — a maior é {abaixoDoCorte[0].rubrica}. Elas continuam na conta do total;
            o corte só decide quem ganha parágrafo.
          </span>
        </div>
      )}

      {par.ofensores.length > 0 && (
          /* -------- amortecedores e o que não fechou -------- */
          <div key="balanco" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="card-surface p-4 lg:col-span-2">
              <div className="eyebrow">O que segurou o resultado</div>
              <div className="mt-2 flex flex-col gap-1.5">
                {par.amortecedores.length === 0 && (
                  <p className="text-[12px] text-muted-foreground">Nenhuma rubrica veio abaixo do plano neste mês.</p>
                )}
                {par.amortecedores.slice(0, 4).map((o) => (
                  <div key={o.rubrica} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="truncate">{o.rubrica}</span>
                    <span className="num shrink-0 font-semibold text-pos" title={valorExato(o.impacto)}>
                      +{abreviado(o.impacto)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card-surface p-4">
              <div className="eyebrow">A conta fecha?</div>
              <div className="mt-2 space-y-1 text-[12px]">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Gap do EBITDA</span>
                  <b className={cn("num", tom(par.gapEbitda == null ? null : par.gapEbitda >= 0))}>
                    {par.gapEbitda == null ? "—" : `${par.gapEbitda >= 0 ? "+" : ""}${abreviado(par.gapEbitda)}`}
                  </b>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Explicado pelas rubricas</span>
                  <b className="num">{abreviado(par.favoravel - par.desfavoravel)}</b>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Não explicado</span>
                  <b className="num">{par.residuo == null ? "—" : abreviado(par.residuo)}</b>
                </div>
              </div>
              <p className="mt-2 text-[10.5px] leading-snug text-muted-foreground/80">
                O resíduo fica publicado em vez de diluído numa barra "outros" — quando ele cresce,
                é a DRE ou o BP tendo ganhado linha que o outro não tem.
                {par.semPlano.length > 0 && (
                  <> {par.semPlano.length} rubrica(s) têm realizado e não têm plano: {par.semPlano.slice(0, 4).join(", ")}
                    {par.semPlano.length > 4 && "…"}.</>
                )}
              </p>
            </div>
          </div>
      )}
    </>
  );

  const blocoCaixaUi = (
    <>
      <CabecalhoBloco
        key="cabecalho"
        n={4}
        titulo="Caixa"
        direita={<Chip>Omie · regime de caixa</Chip>}
      />

      <div key="kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          eyebrow={<>Saldo em caixa{caixa.saldoEm ? ` · ${new Date(caixa.saldoEm).toLocaleDateString("pt-BR")}` : ""}</>}
          valor={brl(caixa.saldo)}
        >
          <div className="text-[11px] leading-snug text-muted-foreground">
            Consolidado do Omie, foto de hoje — não é o fechamento de {rotuloMes(mes)}.
          </div>
        </Kpi>
        <Kpi eyebrow="Fluxo livre do mês" valor={brl(caixa.livre)} tomValor={tom((caixa.livre ?? 0) >= 0)}>
          <div className="text-[11px] text-muted-foreground">
            {caixa.livreOrcado == null ? "sem plano de DFC no BP" : <>orçado <span className="num">{brlCheio(caixa.livreOrcado)}</span></>}
          </div>
        </Kpi>
        <Kpi eyebrow="Burn médio 3m" valor={brl(caixa.burn3m)} tomValor={tom((caixa.burn3m ?? 0) <= 0)}>
          <div className="text-[11px] text-muted-foreground">
            {janela.slice(-3).map(rotuloMes).join(" · ") || "—"}
          </div>
        </Kpi>
        <Kpi
          eyebrow="Runway"
          valor={caixa.runway?.gerandoCaixa ? "gera caixa"
            : caixa.runway?.meses == null ? "—"
            : `${caixa.runway.meses.toFixed(1).replace(".", ",")} meses`}
          tomValor={caixa.runway?.gerandoCaixa || (caixa.runway?.meses ?? 0) >= 6 ? "text-pos" : "text-neg"}
        >
          <div className="text-[11px] text-muted-foreground">
            {caixa.runway == null ? "sem saldo de caixa carregado"
              : caixa.runway.gerandoCaixa ? `fluxo livre médio positivo nos últimos ${caixa.runway.base} meses`
              : <>caixa ÷ queima de <span className="num">{brlCheio(caixa.runway.queima)}</span>/mês · meta ≥ 6</>}
          </div>
        </Kpi>
      </div>

      <div key="dfc" className="card-surface overflow-hidden">
        <header className="flex items-start justify-between gap-4 border-b border-border p-3.5">
          <div>
            <h3 className="text-[13.5px] font-semibold">DFC simplificada · {rotuloMes(mes)}</h3>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              FCO, FCI e FCF somados das folhas da DFC — a linha de total do blob quase nunca vem preenchida.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">Orçado do BP {anoDoMes}</span>
        </header>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-secondary/40">
              {["FLUXO", rotuloMes(mes).toUpperCase(), "ORÇADO", "DESVIO"].map((h, i) => (
                <th key={h} className={cn("px-4 py-2 text-[10px] font-bold tracking-wider text-muted-foreground", i === 0 ? "text-left" : "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {caixa.linhas.map((l) => {
              const desvio = l.realizado == null || l.orcado == null ? null : l.realizado - l.orcado;
              return (
                <tr key={l.rubrica} className={cn("border-b border-border/50", l.bloco && "bg-secondary/40")}>
                  <td className={cn("px-4 py-2 text-[12px]", l.nivel === 1 ? "pl-8 text-foreground/80" : "font-bold text-[12.5px]")}>
                    {l.rubrica}
                  </td>
                  <td className={cn("num px-4 py-2 text-right text-[12px]", l.bloco && "font-bold", (l.realizado ?? 0) < 0 && "text-neg")}
                      title={valorExato(l.realizado)}>
                    {l.realizado == null ? "—" : abreviado(l.realizado)}
                  </td>
                  <td className="num px-4 py-2 text-right text-[12px] text-muted-foreground" title={valorExato(l.orcado)}>
                    {l.orcado == null ? "—" : abreviado(l.orcado)}
                  </td>
                  <td className={cn("num px-4 py-2 text-right text-[12px] font-semibold", tom(desvio == null ? null : desvio >= 0))}>
                    {desvio == null ? "—" : `${desvio >= 0 ? "+" : ""}${abreviado(desvio)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-border/60 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          O saldo do card acima é a foto de hoje do Omie; esta tabela é o FLUXO de {rotuloMes(mes)}.
          Os dois não se somam — reconstituir o saldo de fechamento andando para trás pelos fluxos
          empilharia três aproximações num número com cara de extrato.
        </p>
      </div>
    </>
  );

  const blocoMetas = (
    <>
      <CabecalhoBloco
        key="cabecalho"
        n={5}
        titulo={prox ? `Metas de ${prox.rotulo}` : "Metas do próximo mês"}
        direita={
          <>
            {carteiraMes.valor?.mesLabel && <Chip>carteira Asaas · {carteiraMes.valor.mesLabel}</Chip>}
            {!temBp && <Chip tone="warn">sem BP — não há meta</Chip>}
          </>
        }
      />

      {!prox && (
        <Vazio key="vazio">Não consegui identificar o mês seguinte a partir de {rotuloMes(mes)}.</Vazio>
      )}

      {prox && (
          <div key="kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi eyebrow="Receita orçada" valor={brl(prox.receitaOrcada)}>
              <div className="text-[11px] text-muted-foreground">
                {rotuloMes(mes)} realizado <span className="num">{brlCheio(receita?.realizado)}</span>
              </div>
              {prox.receitaOrcada != null && receita?.realizado != null && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10.5px] text-muted-foreground">
                    <span>Falta</span>
                    <b className="num text-primary">
                      {abreviado(prox.receitaOrcada - receita.realizado)} · {fracPct((prox.receitaOrcada - receita.realizado) / receita.realizado)}
                    </b>
                  </div>
                  <Barra pct={(receita.realizado / prox.receitaOrcada) * 100} />
                </div>
              )}
            </Kpi>

            <Kpi eyebrow="EBITDA orçado" valor={brl(prox.ebitdaOrcado)} tomValor={tom((prox.ebitdaOrcado ?? 0) >= 0)}>
              <div className="text-[11px] text-muted-foreground">
                margem {fracPct(prox.margemOrcada)} · {rotuloMes(mes)} {fracPct(margem)}
              </div>
              {prox.gap != null && (
                <div className="text-[11.5px] leading-snug">
                  Precisa melhorar <b className="num">{abreviado(prox.gap)}</b> em um mês.
                </div>
              )}
            </Kpi>

            <Kpi eyebrow="SG&A alvo" valor={brl(prox.sgaOrcado)}>
              <div className="text-[11px] text-muted-foreground">
                {prox.sgaPeso == null ? "—" : `${(prox.sgaPeso * 100).toFixed(1).replace(".", ",")}% da receita líquida orçada`}
              </div>
              {prox.sgaOrcado != null && sga?.realizado != null && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10.5px] text-muted-foreground">
                    <span>{rotuloMes(mes)} {sga.realizado != null && rl?.realizado ? `${((sga.realizado / rl.realizado) * 100).toFixed(1).replace(".", ",")}%` : ""}</span>
                    <b className={cn("num", sga.realizado > prox.sgaOrcado ? "text-primary" : "text-pos")}>
                      {sga.realizado > prox.sgaOrcado ? `cortar ${abreviado(sga.realizado - prox.sgaOrcado)}` : "dentro do alvo"}
                    </b>
                  </div>
                  <Barra
                    pct={(sga.realizado / prox.sgaOrcado) * 100}
                    cor={sga.realizado > prox.sgaOrcado ? "bg-amber-500" : "bg-pos"}
                  />
                </div>
              )}
            </Kpi>

            <Kpi eyebrow="Meta de clientes · BP" valor={inteiro(prox.clientesMeta)}>
              <div className="text-[11px] text-muted-foreground">
                hoje <span className="num">{inteiro(prox.clientesHoje)}</span>
                {prox.liquidosNecessarios != null && (
                  <> · <b className="num text-primary">+{inteiro(prox.liquidosNecessarios)} líquidos</b></>
                )}
              </div>
              {prox.clientesMeta != null && prox.clientesHoje != null && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10.5px] text-muted-foreground">
                    <span>Atingido</span>
                    <span className="num">{((prox.clientesHoje / prox.clientesMeta) * 100).toFixed(1).replace(".", ",")}%</span>
                  </div>
                  <Barra pct={(prox.clientesHoje / prox.clientesMeta) * 100} />
                </div>
              )}
            </Kpi>

            <div className="card-surface flex flex-col gap-2.5 border-primary/35 p-4">
              <div className="eyebrow text-primary">Novos necessários</div>
              <div className="num text-[26px] font-semibold leading-none text-primary">
                {inteiro(prox.novosNecessarios)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {prox.liquidosNecessarios == null ? "sem meta no BP"
                  : <>{inteiro(prox.liquidosNecessarios)} líquidos + {inteiro(prox.churnEsperado ?? 0)} de churn esperado</>}
              </div>
              {prox.churnMesQtd != null && (
                <div className="text-[11.5px] leading-snug">
                  Churn de {rotuloMes(mes)}: <b className="num">{inteiro(prox.churnMesQtd)}</b> clientes
                  {prox.churnMesValor ? <> · <span className="num">{abreviado(prox.churnMesValor)}</span> de MRR</> : null}
                </div>
              )}
            </div>
          </div>
      )}

      {/* Carteira e decisões são DOIS cards, e o `grupo` do catálogo é que os põe
          lado a lado quando os dois caem na mesma folha. Numa apresentação em que
          só a pauta entra, ela ocupa a largura toda em vez de ficar apertada numa
          coluna de grade com a outra metade vazia. */}
      {prox && (
            /* -------- carteira -------- */
            <div key="carteira" className="card-surface overflow-hidden">
              <header className="flex items-start justify-between gap-4 border-b border-border p-3.5">
                <div>
                  <h3 className="text-[13.5px] font-semibold">Carteira hoje · por porte</h3>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    Base do Asaas · {inteiro(prox.clientesHoje)} clientes ativos
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  MRR <b className="num text-foreground">{brlCheio(prox.mrr)}</b> · ticket{" "}
                  <b className="num text-foreground">{brlCheio(prox.ticket)}</b>
                </span>
              </header>
              {prox.carteira.length === 0 ? (
                <p className="p-4 text-[12px] text-muted-foreground">
                  Sem snapshot de assinaturas carregado. A carteira aparece quando o
                  <b> assinaturas-sheet-sync</b> rodar.
                </p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40">
                      {["PORTE", "CLIENTES", "MIX", "MRR", "META BP"].map((h, i) => (
                        <th key={h} className={cn("px-4 py-2 text-[10px] font-bold tracking-wider text-muted-foreground", i === 0 || i === 2 ? "text-left" : "text-right")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prox.carteira.map((n) => (
                      <tr key={n.nivel} className="border-b border-border/50">
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
                            {n.nivel}
                          </span>
                        </td>
                        <td className="num px-4 py-2 text-right text-[12px]">{inteiro(n.clientes)}</td>
                        <td className="px-4 py-2">
                          <div className="h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-secondary">
                            <div className="h-full bg-primary/70" style={{ width: `${n.mix * 100}%` }} />
                          </div>
                        </td>
                        <td className="num px-4 py-2 text-right text-[12px]" title={valorExato(n.mrr)}>{abreviado(n.mrr)}</td>
                        <td className={cn(
                          "num px-4 py-2 text-right text-[12px]",
                          n.clientesOrcado == null ? "text-muted-foreground"
                            : tom(n.clientes >= n.clientesOrcado),
                        )}>
                          {n.clientesOrcado == null ? "—" : `${inteiro(n.clientesOrcado)} (${n.clientes >= n.clientesOrcado ? "+" : ""}${n.clientes - n.clientesOrcado})`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
      )}

      {prox && (
            /* -------- as decisões -------- */
            <div key="decisoes" className="flex flex-col gap-3">
              <div className="card-surface p-4">
                <h3 className="text-[13.5px] font-semibold">O que a reunião decide hoje</h3>
                {/* A lista inteira é UM campo: editar uma pauta é reordenar,
                    acrescentar e remover, e casar item a item por índice erraria
                    no primeiro item inserido no meio. */}
                <div className="mt-2 text-[12px] leading-relaxed">
                  <CampoTexto
                    valor={leitura.decisoes.join("\n")}
                    linhas={6}
                    vazio="A pauta sai junto com a leitura do mês. Gere-a no rodapé, ou escreva aqui — uma decisão por linha."
                    renderizar={(v) => (
                      <ol className="flex list-decimal flex-col gap-2 pl-5">
                        {v.split("\n").filter(Boolean).map((d, i) => <li key={i}>{d}</li>)}
                      </ol>
                    )}
                    {...campoDecisoes}
                  />
                </div>
              </div>
              <div className="rounded-lg border border-primary/25 bg-accent p-4">
                <div className="eyebrow text-accent-foreground">Se as decisões saírem</div>
                <div className="mt-1.5 text-[12.5px] leading-relaxed">
                  <CampoTexto
                    valor={leitura.fecho}
                    vazio="Sem fecho escrito."
                    {...campoFecho}
                  />
                </div>
              </div>
            </div>
      )}
    </>
  );

  /* ============================================================
   *  O catálogo e o que vai no palco
   * ============================================================
   * Os cinco blocos continuam sendo a FONTE dos cards — a apresentação não
   * redesenha nada, ela escolhe. É isso que faz o card do EBITDA na folha 2 do
   * "Board 3T" ser exatamente o mesmo que está na tela de trabalho, com o mesmo
   * número, sem uma segunda implementação para manter em dia. */
  const cardsLocais = [
    ...cardsDoBloco("Resumo", "resumo", blocoResumo),
    ...cardsDoBloco("DRE", "dre", blocoDre),
    ...cardsDoBloco("Pareto", "pareto", blocoPareto),
    ...cardsDoBloco("Caixa", "caixa", blocoCaixaUi),
    ...cardsDoBloco("Metas", "metas", blocoMetas),
  ];

  /* Os cards que vêm de OUTRAS telas (ver `lib/registroCards`). Eles se viram
     sozinhos: recebem o mês e buscam o que precisam. É o que permite pôr o churn
     numa folha sem esta página saber o que é churn. */
  const ctxCard = { mes, rotuloMes: mesPorExtenso(mes) };
  const cardsDoRegistro: CardPronto[] = REGISTRO_CARDS.map((r) => ({
    chave: r.chave,
    rotulo: r.rotulo,
    bloco: r.fonte,
    no: <r.Card ctx={ctxCard} />,
  }));

  const cards = [...cardsLocais, ...cardsDoRegistro];
  const catalogo: ItemCatalogo[] = cards.map(({ chave, rotulo, bloco, grupo, vazio }) =>
    ({ chave, rotulo, bloco, grupo, vazio }));
  catalogoRef.current = catalogo;
  /* O roteiro PADRÃO é só dos cinco blocos: uma apresentação nova abre com a
     reunião de sempre, e o que vem de outras telas entra quando for chamado —
     senão toda apresentação nasceria com oito folhas que ninguém pediu. */
  catalogoPadraoRef.current = cardsLocais.map(({ chave, rotulo, bloco, grupo, vazio }) =>
    ({ chave, rotulo, bloco, grupo, vazio }));

  const emApresentacao = apresId != null;
  const publicada = emApresentacao && statusApres === "publicada";

  /** Uma peça do roteiro virando card desenhável. */
  const pecaComoCard = (p: Peca): CardPronto => {
    /* Apresentação publicada mostra o HTML CONGELADO, não o card de agora: é a
       diferença entre a ata e a tela. O html sai do nosso próprio render (o
       texto de gente já vem escapado como nó de texto), e os botões foram
       removidos antes de congelar. */
    const gelo = publicada ? congelado?.html?.[p.id] ?? congelado?.html?.[p.tipo === "card" ? p.chave : p.id] : null;
    if (gelo != null) {
      return {
        chave: p.id, bloco: "", rotulo: "",
        no: <div dangerouslySetInnerHTML={{ __html: gelo }} />,
      };
    }
    if (p.tipo === "texto") {
      return {
        chave: p.id, bloco: "", rotulo: p.titulo,
        no: (
          <CardTexto
            titulo={p.titulo}
            corpo={p.corpo}
            onEditar={() => {
              const corpo = window.prompt(`Texto de "${p.titulo}"`, p.corpo);
              if (corpo == null) return;
              void salvarRoteiro(
                { folhas: roteiro.folhas.map((f) => ({
                  ...f, pecas: f.pecas.map((x) => (x.id === p.id ? { ...x, corpo } : x)),
                })) },
                "texto reescrito",
              );
            }}
          />
        ),
      };
    }
    if (p.tipo === "serie") {
      return {
        chave: p.id, bloco: "", rotulo: p.titulo,
        no: (
          <CardSerie
            titulo={p.titulo}
            rubrica={p.rubrica}
            formato={p.formato}
            pontos={serieDaRubrica(leitor, janela, p.rubrica, p.meses)}
          />
        ),
      };
    }
    const achado = cards.find((c) => c.chave === p.chave);
    if (achado) return achado;
    /* Card que existia quando a apresentação foi montada e não existe mais neste
       mês. `sanear` tira na abertura; isto aqui é a rede para o caso de o card
       sumir DEPOIS (trocar o Pareto de "por bloco" para "por rubrica", por
       exemplo) — some da folha, não quebra a reunião. */
    return {
      chave: p.chave, bloco: "", rotulo: p.chave,
      no: (
        <div className="rounded-lg border border-dashed border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
          O card <b>{p.chave}</b> não existe neste mês com os filtros de agora.
        </div>
      ),
    };
  };

  /** As seções do palco: as folhas do roteiro, ou os cinco blocos de sempre. */
  const folhasDoPalco: { titulo: string; itens: CardPronto[] }[] = emApresentacao
    ? roteiro.folhas.map((f) => ({ titulo: f.titulo, itens: f.pecas.map(pecaComoCard) }))
    // Filtra os LOCAIS, não `cards`: a fonte de um card do registro pode se
    // chamar igual a um bloco (o capital de giro vem de "Caixa") e ele apareceria
    // sozinho na tela de trabalho, que não é o que ela mostra.
    : BLOCOS.map((b) => ({ titulo: b, itens: cardsLocais.filter((c) => c.bloco === b) }));

  const conteudo = (
    // `relative` ancora a pastilha do rodapé quando a barra está recolhida.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
      {/* `relative` não é decoração: `irPara` e `aoRolar` usam `offsetTop`, que é
          medido contra o ancestral POSICIONADO mais próximo. Sem isto o offset
          sairia relativo ao <body> e os saltos parariam no lugar errado. */}
      <div
        ref={palcoRef}
        onScroll={aoRolar}
        data-revisao-palco
        className="relative min-h-0 flex-1 overflow-y-auto"
        style={{ scrollSnapType: "y proximity" }}
      >
        {/* Uma folha por tela, em TAMANHO NATURAL. A folha que não couber rola
            por dentro e, quando chega ao fim, a rolagem passa para o palco e
            cai na seguinte (encadeamento padrão do navegador).

            Já foi o contrário: o bloco era medido e REDUZIDO com `transform`
            até caber na altura da tela. Cabia — e o resultado era a reunião
            lendo um Resumo a 55%, com tarja em branco dos dois lados. Encolher
            o conteúdo para caber na moldura é resolver o problema errado. */}
        {folhasDoPalco.map((f, i) => (
          <section
            key={`${f.titulo}#${i}`}
            data-revisao-bloco
            data-titulo={f.titulo}
            className="h-full overflow-y-auto"
            style={{ scrollSnapAlign: "start" }}
          >
            <div data-revisao-conteudo className="flex flex-col gap-3.5 px-6 py-5">
              {f.itens.length === 0 ? (
                <Vazio>
                  Folha vazia. Abra o montador e traga cards do catálogo — ou peça por escrito,
                  do tipo "põe a cascata e a tabela da DRE aqui".
                </Vazio>
              ) : desenharCards(f.itens)}
            </div>
          </section>
        ))}
      </div>

      {/* O montador fica AO LADO do palco, não por cima: montar é uma conversa
          entre a lista e a folha, e um painel flutuante esconderia justamente o
          que a pessoa acabou de mexer. */}
      {montando && (
        <MontadorApresentacao
          catalogo={catalogo}
          roteiro={emApresentacao ? roteiro : roteiroPadrao(catalogoPadraoRef.current)}
          onRoteiro={salvarRoteiro}
          nome={nomeApres || `Revisão de ${mesPorExtenso(mes)}`}
          onNome={renomearApresentacao}
          mes={mes}
          publicada={publicada}
          salvando={salvandoApres}
          onFechar={() => setMontando(false)}
        />
      )}
      </div>

      {/* ------------------------------ rail ------------------------------
          Recolhível: numa apresentação projetada, a barra de controles no rodapé
          é a única coisa na tela que denuncia que aquilo é um sistema, e não um
          slide. Recolhida, sobra só a pastilha do canto com "03 / 05" — que
          ainda diz onde a reunião está e traz a barra de volta num clique. As
          setas do teclado continuam navegando de qualquer jeito. */}
      {!railAberto && (
        <button
          onClick={() => setRailAberto(true)}
          title="Mostrar os controles"
          className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] shadow-sm backdrop-blur transition hover:bg-secondary"
        >
          <span className="num font-semibold text-muted-foreground">
            {String(bloco + 1).padStart(2, "0")} / {String(folhasDoPalco.length).padStart(2, "0")}
          </span>
          <ChevronUp className="h-3 w-3 text-muted-foreground" />
        </button>
      )}

      <div
        data-revisao-rail
        /* `style` e não a classe `hidden`: as duas valem `display` com a mesma
           especificidade que o `flex` daqui, e quem ganha passa a depender da
           ordem em que o Tailwind emitiu as regras. Inline não tem esse debate. */
        style={{ display: railAberto ? undefined : "none" }}
        className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-2.5 backdrop-blur"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="num text-[11px] font-semibold text-muted-foreground">
            {String(bloco + 1).padStart(2, "0")} / {String(folhasDoPalco.length).padStart(2, "0")}
          </span>
          <span className="truncate text-[12.5px] font-semibold">
            {folhasDoPalco[bloco]?.titulo ?? "—"}
          </span>
          <select
            value={mes}
            onChange={(e) => setMesEscolhido(e.target.value)}
            className="ml-2 h-7 rounded-md border border-border bg-card px-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
            title="Mês da reunião. Meses sem cadeado ainda podem mudar."
          >
            {[...comDado].reverse().map((c) => (
              <option key={c} value={c}>
                {mesPorExtenso(c)}{travados.has(c) ? " · travado" : " · aberto"}
              </option>
            ))}
          </select>

          {/* -------- qual apresentação ----------------------------------------
              "A tela" é a de trabalho, com os cinco blocos. Escolher uma
              apresentação troca o palco pelas folhas do roteiro dela. */}
          <select
            value={apresId ?? ""}
            onChange={(e) => abrirApresentacao(apresentacoes.find((a) => a.id === e.target.value) ?? null)}
            className="h-7 max-w-[190px] rounded-md border border-border bg-card px-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
            title="Qual apresentação está no palco"
          >
            <option value="">A tela de trabalho</option>
            {apresentacoes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}{a.status === "publicada" ? " · publicada" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={criarApresentacao}
            title="Nova apresentação, já com os cinco blocos montados"
            className="ghost-btn ghost-icone"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {emApresentacao && (
            <>
              <button onClick={duplicarApresentacao} title="Duplicar para outra plateia" className="ghost-btn h-7 px-2 text-[11px]">
                cópia
              </button>
              <button onClick={excluirApresentacao} title="Excluir esta apresentação" className="ghost-btn ghost-icone hover:text-neg">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {folhasDoPalco.map((f, i) => (
            <button
              key={`${f.titulo}#${i}`}
              onClick={() => irPara(i)}
              title={f.titulo}
              className={cn(
                "h-2 rounded-full transition-all",
                i === bloco ? "w-5 bg-primary" : "w-2 bg-border hover:bg-muted-foreground/40",
              )}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <>
            <>
              <span className="mr-1 hidden text-[11px] text-muted-foreground lg:inline">← → navega</span>
              <button onClick={() => irPara(bloco - 1)} className="ghost-btn ghost-icone" title="Bloco anterior">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => irPara(bloco + 1)} className="ghost-btn ghost-icone" title="Próximo bloco">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              {temTexto && (
                <>
                  {revisao?.editado && (
                    <button
                      onClick={voltarAoRascunho}
                      disabled={salvando}
                      title="Descarta TODAS as suas reescritas deste mês e volta a valer o rascunho da IA"
                      className="ghost-btn h-7 px-2.5 text-[11.5px]"
                    >
                      <RotateCcw className="h-3 w-3" /> Voltar ao rascunho
                    </button>
                  )}
                  <button
                    onClick={conferir}
                    className={cn("ghost-btn h-7 px-2.5 text-[11.5px]", revisao?.status === "aceito" && "border-pos/40 text-pos")}
                    title="Marca a leitura como conferida por gente"
                  >
                    <Check className="h-3 w-3" /> {revisao?.status === "aceito" ? "Conferido" : "Conferi"}
                  </button>
                </>
              )}
              <button
                onClick={() => gerar(temTexto)}
                disabled={gerando || !sinal}
                title={temTexto
                  ? "Reescreve a leitura com os números de agora. A sua reescrita e o 'conferi' não são apagados."
                  : "A IA redige veredicto, impacto e ação em cima do Pareto que já está calculado."}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11.5px] font-medium transition hover:bg-secondary disabled:opacity-50"
              >
                {gerando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {temTexto ? "Regerar" : "Gerar leitura"}
              </button>
              <button
                onClick={() => setMontando((v) => !v)}
                className={cn("ghost-btn h-7 px-2.5 text-[11.5px]", montando && "border-primary/40 text-primary")}
                title="Escolher o que entra em cada folha desta apresentação"
              >
                <Layers className="h-3 w-3" /> Montar
              </button>
              {emApresentacao && (
                <button
                  onClick={publicar}
                  disabled={salvandoApres || publicada}
                  className={cn(
                    "ghost-btn h-7 px-2.5 text-[11.5px]",
                    publicada && "border-pos/40 text-pos",
                  )}
                  title={publicada
                    ? "Publicada: os números desta apresentação estão congelados como estavam na hora"
                    : "Congela os números como estão agora e guarda a apresentação para consulta"}
                >
                  {salvandoApres ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {publicada ? "Publicada" : "Publicar"}
                </button>
              )}
              <button
                onClick={() => alternarReuniao(!modoReuniao)}
                className={cn("ghost-btn h-7 px-2.5 text-[11.5px]", modoReuniao && "border-primary/40 text-primary")}
                title={modoReuniao
                  ? "Sair da tela cheia (Esc também sai)"
                  : "Tela cheia: sem menu do Hub, sem abas e sem barra de endereço"}
              >
                {modoReuniao ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />} Modo reunião
              </button>
              <button
                onClick={() => setExportando(true)}
                title="PDF em paisagem, PowerPoint em 16:9 ou impressão — com a quebra de página montada na hora"
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11.5px] font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Download className="h-3 w-3" /> Exportar
              </button>
              <button
                onClick={() => setRailAberto(false)}
                title="Recolher esta barra — as setas do teclado continuam passando as folhas"
                aria-label="Recolher a barra de controles"
                className="ghost-btn ghost-icone"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </>
          </>
        </div>
      </div>

      {/* O exportador não sabe o que é apresentação: ele lê as seções que estão
          no palco. Com uma apresentação aberta, as seções SÃO as folhas do
          roteiro — a exportação sai montada como a reunião foi armada. */}
      <ExportarRevisao
        aberto={exportando}
        onOpenChange={setExportando}
        blocos={folhasDoPalco.map((f) => f.titulo)}
        rotulo={mesPorExtenso(mes)}
        arquivo={emApresentacao
          ? `${nomeApres.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${mes}`
          : `revisao-do-mes-${mes}`}
      />
    </div>
  );

  /* Aviso de granularidade: aparece uma vez, acima de tudo, e não some sozinho.
     Corrigir o texto por conta própria seria pior — quem escreveu escolheu. */
  const avisoDetalhe = outroDetalhe && temTexto && (
    <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        A leitura deste mês foi escrita com o Pareto <b>por {revisao?.detalhe}</b> e a tela está{" "}
        <b>por {detalhe}</b>: as rubricas com parágrafo podem não ser as que estão à vista.
        Volte a granularidade ou clique em <b>Regerar</b>.
      </span>
    </div>
  );

  /* Modo reunião: a janela vai para tela cheia (ver `alternarReuniao`) e esta
     sobreposição cobre o Hub inteiro em vez de tentar desmontá-lo por fora. O
     AppLayout monta a sidebar e o header para toda página autenticada, e uma
     página não deveria ter de saber disso para se apresentar. */
  if (modoReuniao) {
    return (
      <div ref={raizRef} data-revisao-raiz className="fixed inset-0 z-[60] flex flex-col bg-background">
        {avisoDetalhe}
        {conteudo}
      </div>
    );
  }

  return (
    <div
      ref={raizRef}
      data-revisao-raiz
      className="flex flex-col"
      style={{ height: alturaPalco ?? undefined }}
    >
      {avisoDetalhe}
      {conteudo}
    </div>
  );
}

/* ============================================================
 *  Uma linha do Pareto
 * ============================================================
 * Três colunas de leitura, e as três têm autoria diferente — por isso cada uma
 * traz o seu rótulo. "Por que aconteceu" é o comentário que a célula da DRE já
 * carrega (escrito sobre os lançamentos do Omie e conferido no fechamento);
 * "impacto" e "ação" são desta tela. Misturar as três num parágrafo só apagaria
 * a diferença entre o que foi apurado e o que foi sugerido.
 */
function LinhaOfensor({
  o, porQue, texto, campoImpacto, campoAcao, campoPorQue,
}: {
  o: Ofensor;
  porQue: string | null;
  texto: { rubrica: string; impacto: string; acao: string } | undefined;
  campoImpacto: PropsCampo;
  campoAcao: PropsCampo;
  /** Reescreve o "por que" SÓ nesta apresentação — a DRE fica como está. */
  campoPorQue: PropsCampo;
}) {
  const recorrente = o.mesesConferidos > 0 && o.mesesRuins >= Math.ceil(o.mesesConferidos / 2);
  return (
    <div className="card-surface px-4 py-2.5" style={{ boxShadow: "inset 3px 0 0 hsl(var(--primary))" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="num inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
          {o.posicao}
        </span>
        <span className="text-[13px] font-semibold">{o.rubrica}</span>
        {o.bloco !== o.rubrica && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground">{o.bloco}</span>
        )}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10.5px]",
            recorrente ? "bg-neg-soft text-neg" : "bg-secondary text-muted-foreground",
          )}
          title={
            o.mesesConferidos === 0
              ? "Não há mês fechado anterior na janela para comparar."
              : `${o.mesesRuins} dos ${o.mesesConferidos} meses fechados anteriores também ficaram do lado ruim do plano: `
                + o.historico.slice(0, -1).map((h) => `${h.rotulo} ${abreviado(h.impacto)}`).join(" · ")
          }
        >
          {o.mesesConferidos === 0 ? "sem histórico"
            : recorrente ? `se repete · ${o.mesesRuins}/${o.mesesConferidos} meses`
            : `pontual · ${o.mesesRuins}/${o.mesesConferidos} meses`}
        </span>

        <div className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>realizado <b className="num text-[12.5px] text-foreground" title={valorExato(o.realizado)}>{abreviado(o.realizado)}</b></span>
          <span>orçado <span className="num text-[12.5px]" title={valorExato(o.orcado)}>{abreviado(o.orcado)}</span></span>
          <span>no EBITDA <b className="num text-[12.5px] text-neg" title={valorExato(o.impacto)}>{abreviado(o.impacto)}</b></span>
          <span>desvio <span className="num text-[12.5px]">{fracPct(o.desvioPct)}</span></span>
          <span>do gap <b className="num text-[12.5px] text-foreground">{(o.fatia * 100).toFixed(1).replace(".", ",")}%</b></span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-4 border-t border-border/70 pt-2 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-[0.08em] text-[hsl(var(--info))]">
            <MessageSquareText className="h-3 w-3" /> POR QUE ACONTECEU
          </div>
          {/* Vem da célula da DRE e pode ser reescrito PARA ESTA APRESENTAÇÃO —
              ver `campoPorQue` em RevisaoMes. Apagar devolve o texto da DRE. */}
          <div className="mt-1 text-[11.5px] leading-relaxed text-foreground/85">
            <CampoTexto
              valor={porQue ?? ""}
              linhas={4}
              vazio="Sem comentário na célula da DRE. Gere as justificativas em Demonstrações › DRE, ou escreva aqui só para esta apresentação."
              {...campoPorQue}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-[0.08em] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> IMPACTO
          </div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-foreground/85">
            <CampoTexto
              valor={texto?.impacto ?? ""}
              vazio="O que isto faz com o mês que vem"
              {...campoImpacto}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-[0.08em] text-pos">
            <Target className="h-3 w-3" /> AÇÃO SUGERIDA
          </div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-foreground/85">
            <CampoTexto
              valor={texto?.acao ?? ""}
              vazio="Uma frase no imperativo, com prazo ou número"
              {...campoAcao}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
