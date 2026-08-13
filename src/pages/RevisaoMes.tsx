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
  MessageSquareText, Check, Pencil, X, Info, RotateCcw, Layers, Plus, Repeat, Send, Trash2,
  Copy, ArrowRight,
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
  expandirGrupos, nomeLivre, roteiroPadrao, sanear, serieDaRubrica, ROTEIRO_VAZIO,
  type ItemCatalogo, type Peca, type Roteiro,
} from "@/lib/apresentacao";
import { ModelosApresentacao } from "@/components/demonstracoes/ModelosApresentacao";
import { REGISTRO_CARDS } from "@/lib/registroCards";
import { resolverPeriodo, TIPOS, type Periodo, type TipoPeriodo } from "@/lib/periodo";
import { valorExato } from "@/lib/valor";
import { competenciaDe, lerBlobMensal, lerDre, mesesComDado, rotuloMes, RL, EBITDA, SGA } from "@/lib/analisesDre";
import { parseColuna } from "@/lib/demonstracoes-schema";
import { useFormatoNumero, SeletorFormato, fmtCheio } from "@/components/demonstracoes/FormatoNumero";
import { lerBpAnual, type BpAnual } from "@/lib/bpAnual";
import { parsearPlano, type LinhaBP } from "@/pages/bp/parse";
import { parsearOperacao, type MesBP } from "@/pages/assinaturas/orcadoBp";
import { colunaDoMes } from "@/lib/pontoEquilibrio";
import {
  espinhaDre, cascata, pareto, acimaDoCorte, blocoCaixa, proximoMes, montarSinal, mesesDoAno,
  atingimento, type Atingimento,
  aplicarEdicao, sinalMudou, mesPorExtenso, mesSeguinte, abreviado, fracPct,
  planoDaDre, RECEITA_BRUTA, MARGEM_CONTRIB,
  type Detalhe, type Leitura, type Ofensor, type Sinal, type LinhaEspinha, type TextoRubrica,
} from "@/lib/revisaoMes";

const sb = supabase as any;

/* ------------------------------ formatação ------------------------------ */
/* Abreviado na tela revela o valor cheio no hover (convenção do CLAUDE.md).
   A variante …Str existe para template literal e atributo `title`. */
const brlCheio = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : valorExato(n, { casas: 0 });
const inteiro = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("pt-BR");

/**
 * Os formatadores da tela, resolvidos pelo seletor "1,25 M / 1.254.439".
 *
 * Fábrica, e não constantes de módulo, porque o formato é escolha de quem está
 * olhando: `-R$ 378,3 k` é o que cabe na reunião e `-378.328` é o que se confere
 * contra o Omie. A página desestrutura isto uma vez e o JSX inteiro segue
 * chamando `brl()` e `num()` sem saber que existe um seletor.
 *
 * O SINAL MANDADO PARA A IA NÃO PASSA POR AQUI (`montarSinal` usa `abreviado`
 * direto): ele é texto que vai para o prompt e fica gravado em `demonstracoes_
 * revisao.sinal`, e `sinalMudou` compara essas strings — um clique no seletor
 * marcaria toda leitura já escrita como envelhecida.
 */
function formatadores(cheio: boolean) {
  const num = (n: number | null | undefined) =>
    n == null || !isFinite(n) ? "—" : cheio ? fmtCheio(n) : abreviado(n);
  return {
    num,
    brl: (n: number | null | undefined) => comValorExato(n, num(n)),
    comSinal: (n: number | null | undefined) =>
      n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${num(n)}`,
  };
}

/** Cor de um número pelo que ele significa, não pelo sinal aritmético. */
const tom = (bom: boolean | null) =>
  bom == null ? "text-foreground" : bom ? "text-pos" : "text-neg";

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
  periodo_tipo: TipoPeriodo | null;
  congelado: Congelado | null;
  publicada_em: string | null;
};

/** O que o publicar congela: o HTML de cada peça e a leitura do momento. */
type Congelado = {
  html?: Record<string, string>;
  leitura?: Partial<Leitura>;
  sinal?: unknown;
  /** A janela como estava — a ata precisa dizer de que período ela fala. */
  periodo?: Periodo;
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
  /* As duas fileiras de KPI do Resumo estão em `FILEIRAS`, logo abaixo: elas não
     são card, são quatro cada uma. */
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
  "caixa.dfc":              { rotulo: "DFC simplificada" },
  "metas.cabecalho":        { rotulo: "Título · Metas" },
  "metas.vazio":            { rotulo: "Aviso · sem mês seguinte", vazio: true },
  "metas.carteira":         { rotulo: "Carteira por porte", grupo: "metas.grid" },
  "metas.decisoes":         { rotulo: "Decisões e fecho", grupo: "metas.grid" },
};

/** O invólucro que devolve a vizinhança a cards que andam colados. */
const GRUPOS: Record<string, { classe: string; rotulo: string; pilha?: boolean }> = {
  // A lista de rubricas: gap menor que o do bloco e repartível entre páginas.
  "pareto.rubricas": { classe: "flex flex-col gap-2", rotulo: "Rubricas do Pareto", pilha: true },
  "metas.grid": { classe: "grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]", rotulo: "Carteira e decisões" },
};

/* ============================================================
 *  Cards que são uma FILEIRA de peças
 * ============================================================
 * "KPIs · receita, margem, EBITDA e SG&A" era um card só, e quem quisesse tirar
 * o SG&A da folha tinha de tirar os quatro. Aqui a fileira continua sendo um
 * `<div>` de grade no JSX — é ele que dá o alinhamento — mas cada filho vira uma
 * peça de catálogo própria, com chave `<a chave da fileira>:<o membro>`.
 *
 * A CLASSE DA GRADE NÃO É COPIADA para cá: ela é lida do próprio invólucro no
 * render. Duas verdades sobre a mesma grade dariam a fileira de quatro colunas
 * numa tela e de três na outra, sem ninguém saber qual manda.
 *
 * Apresentação salva antes disto aponta para a chave da fileira; `expandirGrupos`
 * (em `lib/apresentacao.ts`) troca a peça velha pelos membros na abertura.
 */
const FILEIRAS: Record<string, { rotulo: string; itens: Record<string, string> }> = {
  "resumo.kpis-resultado": {
    rotulo: "KPIs · resultado",
    itens: {
      receita: "Receita bruta",
      margem: "Margem de contribuição",
      ebitda: "EBITDA",
      sga: "SG&A",
    },
  },
  "resumo.kpis-base": {
    rotulo: "KPIs · caixa e base",
    itens: {
      fco: "FCO · caixa operacional",
      caixa: "Caixa hoje e runway",
      clientes: "Clientes ativos",
      churn: "Churn do mês",
    },
  },
  "caixa.kpis": {
    rotulo: "KPIs do caixa",
    itens: {
      saldo: "Saldo em caixa",
      livre: "Fluxo livre do mês",
      burn: "Burn médio 3m",
      runway: "Runway",
    },
  },
  "metas.kpis": {
    rotulo: "KPIs das metas",
    itens: {
      receita: "Receita orçada",
      ebitda: "EBITDA orçado",
      sga: "SG&A alvo",
      clientes: "Meta de clientes",
      novos: "Novos necessários",
    },
  },
};

/**
 * Desfaz o escape que o React faz na `key`.
 *
 * React troca ':' por '=2' e '=' por '=0' antes de guardar a key, então
 * `key="rubrica:Servidor"` volta de `Children.toArray` como `rubrica=2Servidor`.
 * Sem desfazer, o card do Pareto não casava com nada: perdia o rótulo ("Rubrica ·
 * Servidor" virava a chave crua na lista do montador) e perdia o grupo, que é o
 * que põe as rubricas empilhadas e permite tirá-las de uma vez.
 */
const desescaparKey = (key: string) => key.replace(/=([02])/g, (_, c) => (c === "2" ? ":" : "="));

/** Um card pronto para desenhar: a chave do catálogo mais o nó de verdade. */
type CardPronto = ItemCatalogo & {
  no: ReactNode;
  /** A classe da grade, quando o card veio de uma fileira (ver `FILEIRAS`). */
  grupoClasse?: string;
};

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
  return filhos.filter(isValidElement).flatMap((filho): CardPronto[] => {
    // `Children.toArray` prefixa a key: ".$cabecalho", ".2:$rubrica:Pessoal".
    const key = desescaparKey(String(filho.key ?? "").replace(/^.*\$/, ""));
    const chave = `${prefixo}.${key}`;

    /* Fileira: o invólucro não é card nenhum, os filhos dele é que são. A classe
       da grade vai junto com cada membro para o desenho remontar a fileira. */
    const fileira = FILEIRAS[chave];
    if (fileira) {
      const props = filho.props as { children?: ReactNode; className?: string };
      return Children.toArray(props.children).filter(isValidElement).map((neto) => {
        const item = String(neto.key ?? "").replace(/^.*\$/, "");
        return {
          chave: `${chave}:${item}`,
          bloco,
          rotulo: fileira.itens[item] ?? item,
          grupo: chave,
          grupoRotulo: fileira.rotulo,
          grupoClasse: props.className,
          no: neto,
        };
      });
    }

    const meta = CARDS_META[chave] ?? (key.startsWith("rubrica:")
      ? { rotulo: `Rubrica · ${key.slice("rubrica:".length)}`, grupo: "pareto.rubricas" }
      : { rotulo: chave });
    return [{
      chave, bloco, rotulo: meta.rotulo, grupo: meta.grupo,
      grupoRotulo: meta.grupo ? GRUPOS[meta.grupo]?.rotulo : undefined,
      vazio: meta.vazio, no: filho,
    }];
  });
}

/**
 * Desenha uma sequência de cards, devolvendo aos vizinhos de grupo o invólucro.
 *
 * Grupo com UM membro só não ganha invólucro: uma pauta sozinha numa grade de
 * duas colunas ficaria espremida na coluna da esquerda com metade da folha em
 * branco, que é o oposto do que a montagem existe para permitir.
 *
 * FILEIRA é o contrário e por isso guarda a classe (`grupoClasse`): um KPI
 * sozinho tem de continuar do tamanho de um KPI, numa célula da grade de quatro
 * colunas. Sem o invólucro ele esticaria pela folha inteira — que é justamente o
 * que assusta quem tirou três dos quatro.
 */
function desenharCards(cards: CardPronto[]): ReactNode[] {
  const saida: ReactNode[] = [];
  let i = 0;
  while (i < cards.length) {
    const grupo = cards[i].grupo;
    let j = i + 1;
    if (grupo) while (j < cards.length && cards[j].grupo === grupo) j++;
    const trecho = cards.slice(i, j);
    const meta = grupo ? GRUPOS[grupo] : undefined;
    const classe = meta?.classe ?? trecho[0].grupoClasse;
    if (!grupo || !classe || (trecho.length === 1 && !trecho[0].grupoClasse)) {
      for (const c of trecho) saida.push(<Peca key={c.chave} chave={c.chave}>{c.no}</Peca>);
    } else {
      saida.push(
        <div
          key={`${grupo}#${i}`}
          className={classe}
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

/**
 * Célula "hoje → meta": o número de hoje em preto, o que o BP pede em verde e,
 * embaixo, o que falta para lá chegar. Sem meta no BP a seta some e sobra o
 * número de hoje — a coluna nunca fica com um "—" verde fingindo alvo.
 */
function Alvo({
  hoje, meta, moeda = false, fmtMoeda = abreviado,
}: {
  hoje: number | null | undefined;
  meta: number | null | undefined;
  moeda?: boolean;
  /** O formatador da página, para a célula seguir o seletor reduzido/cheio. */
  fmtMoeda?: (v: number | null | undefined) => string;
}) {
  const num = (v: number | null | undefined) => (v == null || !isFinite(v) ? null : v);
  const h = num(hoje);
  const m = num(meta);
  const fmt = (v: number) => (moeda ? fmtMoeda(v) : Math.round(v).toLocaleString("pt-BR"));
  const tit = (v: number) => (moeda ? valorExato(v) : undefined);
  const dif = h != null && m != null ? h - m : null;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-baseline justify-end gap-1 whitespace-nowrap">
        <span className="num text-[12px] text-foreground" title={h == null ? undefined : tit(h)}>
          {h == null ? "—" : fmt(h)}
        </span>
        {m != null && (
          <>
            <ArrowRight className="h-3 w-3 shrink-0 self-center text-muted-foreground" />
            <span className="num text-[12px] font-semibold text-pos" title={tit(m)}>{fmt(m)}</span>
          </>
        )}
      </div>
      {dif != null && (
        <span className={cn("num text-[10px] leading-none", dif >= 0 ? "text-pos" : "text-neg")}>
          {dif === 0 ? "no alvo" : dif > 0 ? `+${fmt(dif)} acima` : `faltam ${fmt(-dif)}`}
        </span>
      )}
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

/* As três cores da barra do YTD. Tons fixos em vez de token semântico: `text-pos`
   e `text-neg` são dois estados, e aqui são três — o amarelo do meio não existe
   na paleta da marca porque em lugar nenhum do Hub houve "quase". */
const COR_FAIXA = {
  verde: { barra: "bg-emerald-500", texto: "text-emerald-700 dark:text-emerald-400" },
  amarelo: { barra: "bg-amber-500", texto: "text-amber-700 dark:text-amber-500" },
  vermelho: { barra: "bg-primary", texto: "text-primary" },
} as const;

/**
 * Quanto do orçado do ano o realizado alcançou.
 *
 * O RÓTULO é a razão crua (`fracao`) e a COR é o efeito no EBITDA: em despesa,
 * 104% do orçado é gastar 4% a mais, e a barra fica vermelha mostrando 104%.
 * Ler só a porcentagem levaria à conclusão contrária em metade das linhas.
 */
function BarraOrcado({ a }: { a: Atingimento | null }) {
  if (!a) return <div className="text-right text-[11px] text-muted-foreground">—</div>;
  const cor = COR_FAIXA[a.faixa];
  return (
    <div
      className="flex min-w-[76px] flex-col gap-1"
      title={`${fracPct(a.fracao - 1)} contra o plano do ano — ${
        a.faixa === "verde" ? "dentro do orçado" : a.faixa === "amarelo" ? "perto do limite" : "fora do orçado"
      }`}
    >
      <span className={cn("num text-right text-[11.5px] font-semibold leading-none", cor.texto)}>
        {(a.fracao * 100).toFixed(0)}%
      </span>
      <Barra pct={a.preenchimento * 100} cor={cor.barra} />
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
  /* Reduzido ou cheio: a mesma preferência (e o mesmo seletor) da grade da DRE
     e da DFC. Desestruturado uma vez aqui — o JSX abaixo chama `brl`, `num` e
     `comSinal` como sempre chamou. */
  const { formato, escolher: escolherFormato } = useFormatoNumero();
  const { num, brl, comSinal } = useMemo(
    () => formatadores(formato === "completo"),
    [formato],
  );

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
  const [detalhe] = useState<Detalhe>("rubrica");
  const [corte, setCorte] = useState(() => {
    const salvo = localStorage.getItem("revisao-corte-pareto");
    return salvo ? Number(salvo) : 0.8;
  });
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
  /* Só o TIPO é estado (e só o tipo vai ao banco): a janela de meses é derivada
     na hora contra os meses que têm dado. Guardada, ela envelheceria — um 3T26
     salvo em agosto continuaria com dois meses depois de setembro fechar. */
  const [periodoTipo, setPeriodoTipo] = useState<TipoPeriodo>("mes");
  const [statusApres, setStatusApres] = useState<"rascunho" | "publicada">("rascunho");
  const [congelado, setCongelado] = useState<Congelado | null>(null);
  const [montando, setMontando] = useState(false);
  const [modelosAberto, setModelosAberto] = useState(false);
  const [salvandoApres, setSalvandoApres] = useState(false);
  /* O catálogo só existe depois que os blocos são montados, lá embaixo no
     render; os handlers ficam acima e o alcançam por aqui. */
  const catalogoRef = useRef<ItemCatalogo[]>([]);
  /** Só os cinco blocos — é deles que sai o roteiro de uma apresentação nova. */
  const catalogoPadraoRef = useRef<ItemCatalogo[]>([]);
  /* Bilhetes entre a geração de um modelo e o efeito que reage à troca de mês:
     qual apresentação abrir quando a carga terminar, e como abri-la (a função
     é declarada mais abaixo, depois do efeito). */
  const abrirDepoisRef = useRef<string | null>(null);
  const abrirApresentacaoRef = useRef<((a: Apresentacao) => void) | null>(null);
  /* A criação em voo. O montador grava a cada mexida e o campo de nome, a cada
     tecla: com duas chamadas antes de o id voltar, as duas entrariam pelo INSERT
     e o mês ganharia duas apresentações — ou o erro de chave única. A segunda
     espera esta promessa e vira UPDATE. */
  const nascendoRef = useRef<Promise<string | null> | null>(null);
  const palcoRef = useRef<HTMLDivElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const animando = useRef(false);
  const [alturaPalco, setAlturaPalco] = useState<number | null>(null);

  useEffect(() => { document.title = "Demonstrações · Revisão do Mês"; }, []);

  useEffect(() => {
    localStorage.setItem("revisao-corte-pareto", String(corte));
  }, [corte]);

  /* A altura útil, MEDIDA em vez de estimada.
     O palco precisa de altura definida (é ele que rola, e é o scroll dele que o
     rail acompanha), e ela depende do cabeçalho do Hub, que esta página não
     controla. Chutar `100vh - 49px` funciona até alguém mexer no header.

     A medida é contra o CABEÇALHO, e não contra a posição da raiz na tela. Com
     `getBoundingClientRect().top` da raiz, quem já tivesse rolado a janela media
     ~0 (o cabeçalho é sticky e continua por cima), a conta devolvia uma altura
     MAIOR que a área útil e a barra de controles caía para fora da dobra — só
     aparecia depois de rolar a página inteira, que é exatamente o que não pode
     acontecer com a barra que comanda a tela. */
  useLayoutEffect(() => {
    const cabecalho = () => document.querySelector<HTMLElement>('[data-chrome="header"]');
    const medir = () => {
      const acima = modoReuniao ? 0 : cabecalho()?.getBoundingClientRect().height ?? 0;
      setAlturaPalco(Math.max(320, window.innerHeight - acima));
    };
    medir();
    window.addEventListener("resize", medir);
    /* O cabeçalho muda de altura sozinho (o breadcrumb quebra em duas linhas em
       tela estreita) e ninguém dispara `resize` por isso. */
    const cab = cabecalho();
    const ro = cab ? new ResizeObserver(medir) : null;
    if (cab && ro) ro.observe(cab);
    return () => { window.removeEventListener("resize", medir); ro?.disconnect(); };
  }, [modoReuniao]);

  /* ---------------------------- carga ---------------------------- */
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

    setDre(lerBlobMensal(dreRes?.data?.dados));
    setDfc(lerBlobMensal(dfcRes?.data?.dados));
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

  /* O acumulado do ano sai da mesma janela do resto da tela, recortada no ano do
     mês em foco. Em janeiro sobra um mês só — a coluna continua de pé e mostra o
     próprio mês, que é a resposta certa para "até aqui no ano". */
  const mesesYtd = useMemo(() => (mes ? mesesDoAno(janela, mes) : []), [janela, mes]);

  /* O cabeçalho da coluna diz o intervalo, e o hover diz mês a mês — inclusive
     quando algum mês do ano não entrou por não estar travado. Um "YTD" mudo
     sobre uma soma incompleta é a diferença entre um acumulado e uma pegadinha. */
  const rotuloYtd = useMemo(() => {
    if (!mesesYtd.length) return "YTD";
    const curto = (c: string) => rotuloMes(c).split("/")[0].toUpperCase();
    const ini = curto(mesesYtd[0]);
    const fim = curto(mesesYtd[mesesYtd.length - 1]);
    const ano = mes ? mes.slice(-2) : "";
    return `YTD · ${ini === fim ? ini : `${ini}–${fim}`}/${ano}`;
  }, [mesesYtd, mes]);

  const tituloYtd = useMemo(() => {
    if (!mesesYtd.length) return undefined;
    const doAno = parseColuna(mes ?? "")?.mes ?? mesesYtd.length;
    const faltam = doAno - mesesYtd.length;
    return `Acumulado de ${mesesYtd.map(rotuloMes).join(" · ")}`
      + (faltam > 0
        ? ` — ${faltam} ${faltam === 1 ? "mês do ano ficou de fora" : "meses do ano ficaram de fora"} por não estar${faltam === 1 ? "" : "em"} travado${faltam === 1 ? "" : "s"}.`
        : ".");
  }, [mesesYtd, mes]);

  const espinha = useMemo<LinhaEspinha[]>(
    () => (mes ? espinhaDre(leitor, temBp ? plano : null, mes, mesAnterior, mesesYtd) : []),
    [leitor, plano, temBp, mes, mesAnterior, mesesYtd],
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
    const lista = (data ?? []) as Apresentacao[];
    setApresentacoes(lista);
    // Devolve a lista além de guardá-la: quem acabou de criar precisa ler o nome
    // que a linha ficou tendo, e o estado só chega no quadro seguinte.
    return lista;
  }, []);

  useEffect(() => {
    if (!mes) return;
    /* Gerar de um modelo pode mudar o mês da tela. Sem este bilhete, o reset
       abaixo fecharia a apresentação que acabou de nascer — ela seria criada,
       aberta e some no mesmo quadro. */
    const pendente = abrirDepoisRef.current;
    abrirDepoisRef.current = null;

    setApresId(null);
    setRoteiro(ROTEIRO_VAZIO);
    setTextosApres({});
    setCongelado(null);
    setStatusApres("rascunho");
    setNomeApres("");
    setPeriodoTipo("mes");

    void (async () => {
      await carregarApresentacoes(mes);
      if (!pendente) return;
      const { data } = await sb
        .from("demonstracoes_apresentacoes").select("*").eq("id", pendente).maybeSingle();
      if (data) abrirApresentacaoRef.current?.(data as Apresentacao);
    })();
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
      setPeriodoTipo("mes");
      setMontando(false);
      return;
    }
    /* `sanear` na ABERTURA, não na gravação: o roteiro é de julho e a tela pode
       estar em agosto, onde a rubrica "Servidor" não existe mais. Tirar na hora
       de mostrar evita a folha com buraco e avisa quem abriu.
       `expandirGrupos` vem ANTES: a peça que aponta para uma fileira inteira
       (os KPIs, antes de virarem peças soltas) vira os membros dela — se
       corresse depois, `sanear` já a teria levado embora como card inexistente. */
    const { roteiro: limpo, removidas } = sanear(
      expandirGrupos(a.roteiro ?? ROTEIRO_VAZIO, catalogoRef.current),
      catalogoRef.current,
    );
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
    setPeriodoTipo((a.periodo_tipo ?? "mes") as TipoPeriodo);
    setBloco(0);
  };
  abrirApresentacaoRef.current = abrirApresentacao;

  /** O nome que a apresentação ganharia se nascesse agora — é o que o montador
      mostra no cabeçalho enquanto nenhuma está aberta. */
  const nomeDaProxima = useMemo(
    () => (mes ? nomeLivre(`Revisão de ${mesPorExtenso(mes)}`, apresentacoes.map((a) => a.nome)) : ""),
    [mes, apresentacoes],
  );

  /**
   * O "Montar" mexe numa apresentação DE VERDADE.
   *
   * Aberto sem nenhuma escolhida, o montador mostrava o roteiro padrão com o
   * nome que a apresentação teria — e quem tirasse um card ali estava, sem saber,
   * mandando nascer uma segunda "Revisão de Julho/26". Se o mês já tem
   * apresentação, o montador abre a mais recente: era essa que a pessoa pensava
   * estar editando. Para começar outra do zero, o "+" continua ao lado.
   */
  const alternarMontador = () => {
    if (montando) { setMontando(false); return; }
    if (!apresId && apresentacoes.length) {
      abrirApresentacao(apresentacoes[0]);
      toast.message(`Montando "${apresentacoes[0].nome}".`, {
        description: 'Para começar outra, use o "+" ao lado do seletor.',
      });
    }
    setMontando(true);
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
    tipo?: TipoPeriodo,
  ): Promise<string | null> => {
    if (!mes) return null;

    /* Se uma criação está em voo, esta chamada é a SEGUNDA mexida da mesma
       apresentação: espera o id e grava por cima, em vez de mandar outro INSERT. */
    let id = apresId;
    if (!id && nascendoRef.current) id = await nascendoRef.current;

    const gravar = async (): Promise<string | null> => {
      const base = (nome ?? nomeApres ?? "").trim() || `Revisão de ${mesPorExtenso(mes)}`;
      /* Nascendo agora, o nome precisa ser um que ainda não exista: `(mes, nome)`
         é único e "Revisão de Julho/26" costuma já estar tomada — é o nome que a
         apresentação do mês ganhou na primeira vez. Sem isto, tirar um card da
         tela de trabalho devolvia o erro cru do Postgres na cara de quem clicou. */
      const alvo = id ? base : nomeLivre(base, apresentacoes.map((a) => a.nome));
      const { data, error } = await sb.rpc("apresentacao_salvar", {
        p_mes: mes,
        p_nome: alvo,
        p_roteiro: r ?? (roteiro.folhas.length ? roteiro : roteiroPadrao(catalogoPadraoRef.current)),
        p_textos: textos ?? textosApres,
        p_id: id,
        p_periodo_tipo: tipo ?? periodoTipo,
      });
      if (error) { toast.error("Não consegui salvar a apresentação: " + error.message); return null; }
      const novoId = data as string;
      setStatusApres("rascunho");
      setCongelado(null);
      const lista = await carregarApresentacoes(mes);
      if (!id) {
        setApresId(novoId);
        /* O nome de verdade vem da linha, não do que pedimos: o banco desempata
           duas abas que colidam no mesmo instante. Quem está DIGITANDO o nome só
           é corrigido quando o banco discordou — senão o campo saltaria para trás
           a cada tecla. */
        const criada = lista.find((a) => a.id === novoId);
        const nomeReal = criada?.nome ?? alvo;
        if (!nome || nomeReal !== base) setNomeApres(nomeReal);
        /* `r` é o roteiro que acabou de ser gravado, e quem chamou já o pôs no
           estado. Sobrescrever com o padrão desfaria na tela justamente a mexida
           que o banco aceitou. */
        if (!r && !roteiro.folhas.length) setRoteiro(roteiroPadrao(catalogoPadraoRef.current));
        toast.message(`"${nomeReal}" criada — a apresentação nasceu com esta mudança.`);
      }
      return novoId;
    };

    if (id) return gravar();
    const promessa = gravar();
    nascendoRef.current = promessa;
    try { return await promessa; } finally { nascendoRef.current = null; }
  }, [mes, nomeApres, roteiro, textosApres, apresId, apresentacoes, periodoTipo, carregarApresentacoes]);

  /** Trocar o período é uma mudança da apresentação — grava e volta a rascunho. */
  const trocarPeriodo = async (tipo: TipoPeriodo) => {
    setPeriodoTipo(tipo);
    setSalvandoApres(true);
    await garantirApresentacao(undefined, undefined, undefined, tipo);
    setSalvandoApres(false);
  };

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
      // O período entra no congelado: a ata tem de dizer de QUE janela ela fala,
      // e o tipo salvo na linha pode mudar depois sem alterar o que foi mostrado.
      const gelo = { html, leitura, sinal, periodo, em: new Date().toISOString() };
      const { error } = await sb.rpc("apresentacao_publicar", { p_id: id, p_congelado: gelo });
      if (error) throw new Error(error.message);
      setStatusApres("publicada");
      setCongelado(gelo);
      await carregarApresentacoes(mes);
      toast.success("Apresentação publicada — os números ficaram congelados como estão agora.");
    } catch (e) {
      toast.error("Não consegui publicar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvandoApres(false);
    }
  };

  /**
   * Cria uma apresentação e a abre. É o caminho único de "nova" e de "gerar do
   * modelo" — as duas nascem do mesmo jeito, mudam só o roteiro e a janela.
   *
   * INSERÇÃO explícita (`p_id: null`), e não `garantirApresentacao`: aquela
   * grava por cima da que está aberta, e criar com uma aberta gravaria a nova
   * em cima da velha.
   */
  const criarApresentacao = async (opts: {
    nome: string; roteiro: Roteiro; mes: string; tipo: TipoPeriodo;
  }): Promise<boolean> => {
    // `(mes, nome)` é único: gerar o mesmo modelo duas vezes no trimestre é
    // rotina, e o erro do banco não ensinaria nada a quem clicou.
    const nome = nomeLivre(opts.nome, apresentacoes.filter((a) => a.mes === opts.mes).map((a) => a.nome));
    setSalvandoApres(true);
    const { data, error } = await sb.rpc("apresentacao_salvar", {
      p_mes: opts.mes, p_nome: nome, p_roteiro: opts.roteiro, p_textos: {},
      p_id: null, p_periodo_tipo: opts.tipo,
    });
    setSalvandoApres(false);
    if (error) { toast.error("Não consegui criar: " + error.message); return false; }

    /* Mês diferente: quem abre é o efeito da troca de mês, depois de os dados
       do novo mês carregarem. Abrir aqui daria uma tela com o roteiro de outubro
       e a DRE de julho por um quadro. */
    if (opts.mes !== mes) {
      abrirDepoisRef.current = data as string;
      setMesEscolhido(opts.mes);
      toast.success(`"${nome}" criada.`);
      return true;
    }

    setApresId(data as string);
    setNomeApres(nome);
    setRoteiro(opts.roteiro);
    setTextosApres({});
    setStatusApres("rascunho");
    setCongelado(null);
    setPeriodoTipo(opts.tipo);
    setBloco(0);
    await carregarApresentacoes(opts.mes);
    toast.success(`"${nome}" criada.`);
    return true;
  };

  /** O botão "+": uma apresentação com os cinco blocos, no mês da tela. */
  const novaApresentacao = async () => {
    if (!mes) return;
    const ok = await criarApresentacao({
      nome: `Apresentação · ${mesPorExtenso(mes)}`,
      roteiro: roteiroPadrao(catalogoPadraoRef.current),
      mes,
      tipo: "mes",
    });
    if (ok) setMontando(true);
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

  /* ---- o "por que aconteceu", e onde a reescrita dele mora ----------------
     O texto nasce do comentário da célula da DRE e NUNCA volta para lá: o
     comentário do fechamento é da contabilidade, não da plateia. Mas ele tem
     DOIS níveis de reescrita, e é o nível que decide onde grava:

       · com apresentação aberta → `textos` DELA, porque a mesma rubrica pode
         precisar de uma frase para o CEO e de outra para o board;
       · na tela de trabalho     → o patch do MÊS, ao lado do impacto e da ação.

     Antes ia sempre para a apresentação. Na tela de trabalho isso fazia nascer
     uma "Revisão de Julho/26 (2)" que ninguém pediu, e o texto ficava gravado
     num lugar que a tela não lê de volta: ao recarregar, a frase da DRE voltava
     e a reescrita parecia perdida. Apagar o texto continua devolvendo o da DRE,
     em qualquer um dos dois níveis. */
  const porQueDe = (rubrica: string): string | null =>
    textosApres[`porque:${rubrica}`]
    || leitura.rubricas.find((r) => r.rubrica === rubrica)?.porque
    || justificativas.get(rubrica)
    || null;

  const salvarTextoApres = async (chave: string, valor: string) => {
    const novos = { ...textosApres };
    if (valor.trim()) novos[chave] = valor; else delete novos[chave];
    setTextosApres(novos);
    setSalvandoApres(true);
    await garantirApresentacao(undefined, novos);
    setSalvandoApres(false);
  };

  const campoPorQue = (rubrica: string) => {
    const rotulo = `Por que aconteceu · ${rubrica}`;
    /* Mesmo formato de patch do impacto e da ação: por RUBRICA e campo a campo,
       para o "Regerar" não levar a frase junto. */
    const noPatch = (p: Partial<Leitura>, texto: string) => {
      const lista = [...(p.rubricas ?? [])];
      const i = lista.findIndex((r) => r.rubrica === rubrica);
      const linha: TextoRubrica = i >= 0 ? { ...lista[i] } : { rubrica, impacto: "", acao: "" };
      linha.porque = texto;
      if (i >= 0) lista[i] = linha; else lista.push(linha);
      return { ...p, rubricas: lista };
    };

    return {
      rotulo,
      onSalvar: (v: string) => (apresId
        ? salvarTextoApres(`porque:${rubrica}`, v)
        : salvarPatch((p) => noPatch(p, v))),
      /* A IA reescreve com o MESMO dossiê dos outros campos; o que muda é o
         destino, pela mesma regra do `onSalvar`. */
      onIA: async (instrucao: string): Promise<string | null> => {
        if (!apresId) return pedirIA(rotulo, porQueDe(rubrica) ?? "", instrucao, (p, t) => noPatch(p, t));
        if (!mes || !sinal) return null;
        try {
          const { data, error } = await supabase.functions.invoke("demonstracoes-revisao", {
            body: {
              mes, sinal, detalhe,
              campo: { rotulo, atual: porQueDe(rubrica) ?? "", lista: false },
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
    };
  };

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
    // Sempre no TOPO da folha: a rolagem é uma só (ver a seção no render), então
    // chegar pela seta é chegar no começo do assunto, e não no meio de onde a
    // pessoa parou da última vez.
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
        <Kpi key="receita" eyebrow="Receita bruta" valor={brl(receita?.realizado)}>
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
          key="margem"
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

        <Kpi key="ebitda" eyebrow="EBITDA" valor={brl(ebitda?.realizado)} tomValor={tom((ebitda?.realizado ?? 0) >= 0)}>
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            margem {fracPct(margem)} · orçado {fracPct(margemOrcada)}
          </div>
          <Comparativos itens={[
            { rotulo: "vs mês ant.", texto: fracPct(ebitda?.mom), bom: sinalDe(ebitda?.mom) },
            { rotulo: "vs orçado", texto: comSinal(ebitda?.impacto), bom: sinalDe(ebitda?.impacto) },
          ]} />
        </Kpi>

        <Kpi key="sga" eyebrow="SG&A" valor={brl(sga?.realizado)}>
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
          key="fco"
          eyebrow="FCO · caixa operacional"
          valor={brl(caixa.fco)}
          tomValor={tom((caixa.fco ?? 0) >= 0)}
        >
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            fluxo livre {num(caixa.livre)}
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
          key="caixa"
          eyebrow={<>Caixa hoje{caixa.saldoEm ? ` · ${new Date(caixa.saldoEm).toLocaleDateString("pt-BR")}` : ""}</>}
          valor={brl(caixa.saldo)}
        >
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            burn 3m {num(caixa.burn3m)}
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

        <Kpi key="clientes" eyebrow="Clientes ativos" valor={inteiro(carteiraMes.valor?.clientes)}>
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            MRR {num(carteiraMes.valor?.mrr)} · ticket {num(carteiraMes.valor?.ticket)}
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

        <Kpi key="churn" eyebrow="Churn do mês" valor={inteiro(churnMes.valor?.qtd)} tomValor="text-neg">
          <div className="num -mt-1 text-[12px] text-muted-foreground">
            {num(churnMes.valor?.valor)} de MRR
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
                  {num(d.valor)}
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
              {[
                { h: "RUBRICA" },
                { h: rotuloMes(mes).toUpperCase() },
                { h: "ORÇADO" },
                { h: "IMPACTO NO EBITDA" },
                { h: "DESVIO %" },
                { h: mesAnterior ? rotuloMes(mesAnterior).toUpperCase() : "—" },
                { h: "MoM" },
                /* O cabeçalho DIZ quais meses somaram. "YTD" sozinho esconderia
                   um mês que ficou de fora por não estar travado, e ninguém
                   descobriria olhando um acumulado que parece o do ano todo. */
                { h: rotuloYtd, t: tituloYtd, div: true },
                { h: "YTD ORÇADO", t: tituloYtd },
                { h: "% DO ORÇADO", t: "Quanto do orçado do ano o realizado alcançou. A cor é o efeito no EBITDA, não a razão crua: em despesa, passar do plano é vermelho." },
              ].map(({ h, t, div }, i) => (
                <th key={h + i} title={t} className={cn(
                  "px-3 py-2 text-[10px] font-bold tracking-wider text-muted-foreground",
                  i === 0 ? "text-left" : "text-right",
                  div && "border-l border-border",
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
                  {l.realizado == null ? "—" : num(l.realizado)}
                </td>
                <td className="num px-3 py-[7px] text-right text-[12px] text-muted-foreground" title={valorExato(l.orcado)}>
                  {l.orcado == null ? "—" : num(l.orcado)}
                </td>
                <td className={cn("num px-3 py-[7px] text-right text-[12px] font-semibold", tom(l.impacto == null ? null : l.impacto >= 0))}>
                  {l.impacto == null ? "—" : `${l.impacto >= 0 ? "+" : ""}${num(l.impacto)}`}
                </td>
                <td className={cn("num px-3 py-[7px] text-right text-[12px]", tom(l.impacto == null ? null : l.impacto >= 0))}>
                  {fracPct(l.desvioPct)}
                </td>
                <td className="num px-3 py-[7px] text-right text-[12px] text-muted-foreground" title={valorExato(l.anterior)}>
                  {l.anterior == null ? "—" : num(l.anterior)}
                </td>
                <td className={cn(
                  "num px-3 py-[7px] text-right text-[12px]",
                  l.mom == null ? "text-muted-foreground"
                    : l.natureza === "despesa" ? tom(l.mom <= 0) : tom(l.mom >= 0),
                )}>
                  {fracPct(l.mom)}
                </td>
                <td className={cn(
                  "num border-l border-border px-3 py-[7px] text-right text-[12px]",
                  l.total && "font-bold", (l.ytd ?? 0) < 0 && "text-neg",
                )} title={valorExato(l.ytd)}>
                  {l.ytd == null ? "—" : num(l.ytd)}
                </td>
                <td className="num px-3 py-[7px] text-right text-[12px] text-muted-foreground" title={valorExato(l.ytdOrcado)}>
                  {l.ytdOrcado == null ? "—" : num(l.ytdOrcado)}
                </td>
                <td className="px-3 py-[7px]">
                  <BarraOrcado a={atingimento(l.ytd, l.ytdOrcado, l.impactoYtd)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-border/60 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <b>Impacto no EBITDA</b> é o efeito da rubrica no resultado, não o desvio bruto: em receita
          é realizado − orçado, em despesa é orçado − realizado. Nos dois, negativo quer dizer que
          tirou do EBITDA — é o que permite somar receita e despesa no Pareto do bloco seguinte.
          {" "}<b>YTD</b> soma os meses fechados do ano até {rotuloMes(mes)}, realizado e orçado na
          mesma janela — passe o mouse no cabeçalho para ver quais meses entraram. A barra mostra
          quanto do orçado do ano o realizado alcançou; a cor é o efeito no EBITDA, e não a
          porcentagem: verde é estar no plano ou melhor (folga de 2%), amarelo é até 10% pior,
          vermelho é além disso. Por isso um SG&amp;A a 102% do orçado aparece em amarelo, não em verde.
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
            {/* Slider é controle de TELA: na folha exportada ele some (o `data-so-tela`
                em index.css), porque o relatório mostra o resultado da escolha. */}
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
            <Chip tone="neg">Desfavorável {num(par.desfavoravel)}</Chip>
            <Chip tone="pos">Favorável {num(par.favoravel)}</Chip>
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
          num={num}
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
              {num(abaixoDoCorte.reduce((s, o) => s + Math.abs(o.impacto ?? 0), 0))}
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
                      +{num(o.impacto)}
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
                    {par.gapEbitda == null ? "—" : `${par.gapEbitda >= 0 ? "+" : ""}${num(par.gapEbitda)}`}
                  </b>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Explicado pelas rubricas</span>
                  <b className="num">{num(par.favoravel - par.desfavoravel)}</b>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Não explicado</span>
                  <b className="num">{par.residuo == null ? "—" : num(par.residuo)}</b>
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
          key="saldo"
          eyebrow={<>Saldo em caixa{caixa.saldoEm ? ` · ${new Date(caixa.saldoEm).toLocaleDateString("pt-BR")}` : ""}</>}
          valor={brl(caixa.saldo)}
        >
          <div className="text-[11px] leading-snug text-muted-foreground">
            Consolidado do Omie, foto de hoje — não é o fechamento de {rotuloMes(mes)}.
          </div>
        </Kpi>
        <Kpi key="livre" eyebrow="Fluxo livre do mês" valor={brl(caixa.livre)} tomValor={tom((caixa.livre ?? 0) >= 0)}>
          <div className="text-[11px] text-muted-foreground">
            {caixa.livreOrcado == null ? "sem plano de DFC no BP" : <>orçado <span className="num">{brlCheio(caixa.livreOrcado)}</span></>}
          </div>
        </Kpi>
        <Kpi key="burn" eyebrow="Burn médio 3m" valor={brl(caixa.burn3m)} tomValor={tom((caixa.burn3m ?? 0) <= 0)}>
          <div className="text-[11px] text-muted-foreground">
            cashburn de {janela.slice(-3).map(rotuloMes).join(" · ") || "—"}
          </div>
        </Kpi>
        <Kpi
          key="runway"
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
              O cashburn é o fluxo livre sem a captação: é ele que diz o ritmo de queima.
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
                    {l.realizado == null ? "—" : num(l.realizado)}
                  </td>
                  <td className="num px-4 py-2 text-right text-[12px] text-muted-foreground" title={valorExato(l.orcado)}>
                    {l.orcado == null ? "—" : num(l.orcado)}
                  </td>
                  <td className={cn("num px-4 py-2 text-right text-[12px] font-semibold", tom(desvio == null ? null : desvio >= 0))}>
                    {desvio == null ? "—" : `${desvio >= 0 ? "+" : ""}${num(desvio)}`}
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
            <Kpi key="receita" eyebrow="Receita orçada" valor={brl(prox.receitaOrcada)}>
              <div className="text-[11px] text-muted-foreground">
                {rotuloMes(mes)} realizado <span className="num">{brlCheio(receita?.realizado)}</span>
              </div>
              {prox.receitaOrcada != null && receita?.realizado != null && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10.5px] text-muted-foreground">
                    <span>Falta</span>
                    <b className="num text-primary">
                      {num(prox.receitaOrcada - receita.realizado)} · {fracPct((prox.receitaOrcada - receita.realizado) / receita.realizado)}
                    </b>
                  </div>
                  <Barra pct={(receita.realizado / prox.receitaOrcada) * 100} />
                </div>
              )}
            </Kpi>

            <Kpi key="ebitda" eyebrow="EBITDA orçado" valor={brl(prox.ebitdaOrcado)} tomValor={tom((prox.ebitdaOrcado ?? 0) >= 0)}>
              <div className="text-[11px] text-muted-foreground">
                margem {fracPct(prox.margemOrcada)} · {rotuloMes(mes)} {fracPct(margem)}
              </div>
              {prox.gap != null && (
                <div className="text-[11.5px] leading-snug">
                  Precisa melhorar <b className="num">{num(prox.gap)}</b> em um mês.
                </div>
              )}
            </Kpi>

            <Kpi key="sga" eyebrow="SG&A alvo" valor={brl(prox.sgaOrcado)}>
              <div className="text-[11px] text-muted-foreground">
                {prox.sgaPeso == null ? "—" : `${(prox.sgaPeso * 100).toFixed(1).replace(".", ",")}% da receita líquida orçada`}
              </div>
              {prox.sgaOrcado != null && sga?.realizado != null && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[10.5px] text-muted-foreground">
                    <span>{rotuloMes(mes)} {sga.realizado != null && rl?.realizado ? `${((sga.realizado / rl.realizado) * 100).toFixed(1).replace(".", ",")}%` : ""}</span>
                    <b className={cn("num", sga.realizado > prox.sgaOrcado ? "text-primary" : "text-pos")}>
                      {sga.realizado > prox.sgaOrcado ? `cortar ${num(sga.realizado - prox.sgaOrcado)}` : "dentro do alvo"}
                    </b>
                  </div>
                  <Barra
                    pct={(sga.realizado / prox.sgaOrcado) * 100}
                    cor={sga.realizado > prox.sgaOrcado ? "bg-amber-500" : "bg-pos"}
                  />
                </div>
              )}
            </Kpi>

            <Kpi key="clientes" eyebrow="Meta de clientes · BP" valor={inteiro(prox.clientesMeta)}>
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

            <div key="novos" className="card-surface flex flex-col gap-2.5 border-primary/35 p-4">
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
                  {prox.churnMesValor ? <> · <span className="num">{num(prox.churnMesValor)}</span> de MRR</> : null}
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
                  {/* O MRR e o ticket saíram daqui para a linha TOTAL: lá eles
                      ganham a meta ao lado, que é o que a reunião discute. */}
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    Base do Asaas · {inteiro(prox.clientesHoje)} clientes ativos
                  </p>
                </div>
                {/* A legenda diz de uma vez o que as três colunas de número
                    fazem — sem ela, o verde parece "está bom" em vez de "é
                    para cá que a carteira tem de ir". */}
                <span className="shrink-0 whitespace-nowrap text-[10.5px] text-muted-foreground">
                  <b className="text-foreground">hoje</b>
                  <ArrowRight className="mx-1 inline h-3 w-3 align-[-1px]" />
                  <b className="text-pos">meta do BP · {prox.rotulo}</b>
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
                      {["PORTE", "CLIENTES", "MIX", "MRR", "TICKET MÉDIO"].map((h, i) => (
                        <th key={h} className={cn("px-3 py-2 text-[10px] font-bold tracking-wider text-muted-foreground", i === 0 || i === 2 ? "text-left" : "text-right")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prox.carteira.map((n) => (
                      <tr key={n.nivel} className="border-b border-border/50">
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
                            {n.nivel}
                          </span>
                        </td>
                        <td className="px-3 py-2"><Alvo hoje={n.clientes} meta={n.clientesOrcado} /></td>
                        <td className="px-3 py-2">
                          {/* O risquinho é onde o BP põe este porte na carteira:
                              a barra pode estar cheia e mesmo assim o porte
                              estar pesando menos do que o plano pede. */}
                          <div className="relative h-1.5 w-full min-w-[56px] max-w-[110px] overflow-hidden rounded-full bg-secondary">
                            <div className="h-full bg-primary/70" style={{ width: `${n.mix * 100}%` }} />
                            {n.mixOrcado != null && (
                              <span
                                className="absolute inset-y-0 w-[2px] bg-foreground/50"
                                style={{ left: `calc(${Math.min(Math.max(n.mixOrcado, 0), 1) * 100}% - 1px)` }}
                                title={`Mix no BP: ${(n.mixOrcado * 100).toFixed(1).replace(".", ",")}%`}
                              />
                            )}
                          </div>
                          <div className="mt-1 text-[10px] leading-none text-muted-foreground">
                            {(n.mix * 100).toFixed(1).replace(".", ",")}%
                          </div>
                        </td>
                        <td className="px-3 py-2"><Alvo hoje={n.mrr} meta={n.mrrOrcado} moeda fmtMoeda={num} /></td>
                        <td className="px-3 py-2"><Alvo hoje={n.ticket} meta={n.ticketOrcado} moeda fmtMoeda={num} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-secondary/40">
                      <td className="px-3 py-2 text-[11px] font-semibold">TOTAL</td>
                      <td className="px-3 py-2"><Alvo hoje={prox.clientesHoje} meta={prox.clientesMeta} /></td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2"><Alvo hoje={prox.mrr} meta={prox.mrrMeta} moeda fmtMoeda={num} /></td>
                      <td className="px-3 py-2"><Alvo hoje={prox.ticket} meta={prox.ticketMeta} moeda fmtMoeda={num} /></td>
                    </tr>
                  </tfoot>
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
  const emApresentacao = apresId != null;
  const publicada = emApresentacao && statusApres === "publicada";
  /* A janela é DERIVADA aqui, contra os meses que têm dado (ver `lib/periodo`).
     Sem apresentação aberta a tela de trabalho é do mês e ponto: a reunião de
     tracker é mensal, e um seletor de trimestre ali só confundiria. */
  const periodo = resolverPeriodo(emApresentacao ? periodoTipo : "mes", mes, comDado);

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
  const ctxCard = { periodo, mes: periodo.mesFoco, rotuloMes: mesPorExtenso(periodo.mesFoco) };
  const cardsDoRegistro: CardPronto[] = REGISTRO_CARDS.map((r) => ({
    chave: r.chave,
    rotulo: r.rotulo,
    bloco: r.fonte,
    no: <r.Card ctx={ctxCard} />,
  }));

  const cards = [...cardsLocais, ...cardsDoRegistro];
  const catalogo: ItemCatalogo[] = cards.map(({ chave, rotulo, bloco, grupo, grupoRotulo, vazio }) =>
    ({ chave, rotulo, bloco, grupo, grupoRotulo, vazio }));
  catalogoRef.current = catalogo;
  /* O roteiro PADRÃO é só dos cinco blocos: uma apresentação nova abre com a
     reunião de sempre, e o que vem de outras telas entra quando for chamado —
     senão toda apresentação nasceria com oito folhas que ninguém pediu. */
  catalogoPadraoRef.current = cardsLocais.map(({ chave, rotulo, bloco, grupo, grupoRotulo, vazio }) =>
    ({ chave, rotulo, bloco, grupo, grupoRotulo, vazio }));

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
            /* A série tem os próprios meses (foi ela que a pessoa escolheu ao
               criar o card); o período só entra como PISO, para uma folha de
               trimestre nunca mostrar menos meses do que o trimestre tem. */
            pontos={serieDaRubrica(leitor, janela, p.rubrica, Math.max(p.meses, periodo.meses.length))}
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
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ scrollSnapType: "y proximity" }}
      >
        {/* Uma folha por tela, em TAMANHO NATURAL, e UMA BARRA DE ROLAGEM SÓ.
            A folha que não couber continua na mesma rolagem: `min-h-full` faz a
            curta ocupar a tela inteira (o snap continua parando no topo de cada
            uma) e deixa a comprida crescer.

            Já foram duas barras — a folha rolava por dentro e o palco por fora,
            uma coladinha na outra no canto direito, e ninguém sabia qual mexia
            o quê. E já foi pior: o bloco era medido e REDUZIDO com `transform`
            até caber na altura da tela. Cabia — e o resultado era a reunião
            lendo um Resumo a 55%, com tarja em branco dos dois lados. Encolher
            o conteúdo para caber na moldura é resolver o problema errado. */}
        {folhasDoPalco.map((f, i) => (
          <section
            key={`${f.titulo}#${i}`}
            data-revisao-bloco
            data-titulo={f.titulo}
            className="min-h-full"
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
          nome={nomeApres || nomeDaProxima}
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
        {/* Cada controle com o NOME do que ele governa. Sem os rótulos, a barra
            era "05/05 Metas" seguido de duas caixas e dois botões, e não havia
            como saber que a primeira caixa é o mês da reunião e a segunda troca a
            tela inteira pela apresentação — dava para descobrir clicando, que é
            o tipo de descoberta que ninguém quer fazer na frente do CEO. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="num text-[11px] font-semibold text-muted-foreground">
            {String(bloco + 1).padStart(2, "0")} / {String(folhasDoPalco.length).padStart(2, "0")}
          </span>
          <span className="truncate text-[12.5px] font-semibold">
            {folhasDoPalco[bloco]?.titulo ?? "—"}
          </span>

          <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />

          <label className="flex items-center gap-1.5">
            <span className="eyebrow">Mês</span>
            <select
              value={mes}
              onChange={(e) => setMesEscolhido(e.target.value)}
              className="h-7 rounded-md border border-border bg-card px-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
              title="Mês da reunião. Meses sem cadeado ainda podem mudar."
            >
              {[...comDado].reverse().map((c) => (
                <option key={c} value={c}>
                  {mesPorExtenso(c)}{travados.has(c) ? " · travado" : " · aberto"}
                </option>
              ))}
            </select>
          </label>

          <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />

          {/* -------- qual apresentação ----------------------------------------
              "A tela" é a de trabalho, com os cinco blocos. Escolher uma
              apresentação troca o palco pelas folhas do roteiro dela. */}
          <label className="flex min-w-0 items-center gap-1.5">
            <span className="eyebrow">Apresentação</span>
            <select
              value={apresId ?? ""}
              onChange={(e) => abrirApresentacao(apresentacoes.find((a) => a.id === e.target.value) ?? null)}
              className="h-7 max-w-[190px] rounded-md border border-border bg-card px-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
              title="O que está no palco: a tela de trabalho (os cinco blocos de sempre) ou uma apresentação montada"
            >
              <option value="">A tela de trabalho</option>
              {apresentacoes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}{a.status === "publicada" ? " · publicada" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={novaApresentacao}
            title="Cria uma apresentação nova neste mês, já com os cinco blocos montados"
            className="ghost-btn h-7 px-2 text-[11px]"
          >
            <Plus className="h-3 w-3" /> Nova
          </button>
          <button
            onClick={() => setModelosAberto(true)}
            title="Modelos: o deck que se repete a cada mês ou trimestre — salvar este como modelo ou gerar um novo a partir de um"
            className="ghost-btn h-7 px-2 text-[11px]"
          >
            <Repeat className="h-3 w-3" /> Modelos
          </button>
          {emApresentacao && (
            <>
              {/* -------- o período ------------------------------------------
                  Só aparece com uma apresentação aberta: a tela de trabalho é a
                  reunião mensal, e um seletor de trimestre nela só confundiria.
                  Os cards mensais (cascata, Pareto, DRE) continuam desenhando o
                  MÊS DE FECHAMENTO da janela — daí o rótulo dizer os dois. */}
              <label className="flex items-center gap-1.5">
                <span className="eyebrow">Janela</span>
                <select
                  value={periodoTipo}
                  onChange={(e) => trocarPeriodo(e.target.value as TipoPeriodo)}
                  title="A janela desta apresentação. Cards de fluxo somam o período; os de estoque valem no fechamento."
                  className="h-7 rounded-md border border-border bg-card px-2 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {TIPOS.map((t) => <option key={t.tipo} value={t.tipo}>{t.nome}</option>)}
                </select>
              </label>
              {periodoTipo !== "mes" && (
                <span
                  className="chip whitespace-nowrap"
                  title={`${periodo.meses.length} mês(es): ${periodo.meses.join(", ")}. Os cards de um mês só desenham ${mesPorExtenso(periodo.mesFoco)}.`}
                >
                  {periodo.rotulo}{periodo.parcial ? " · parcial" : ""}
                </span>
              )}
              <button
                onClick={duplicarApresentacao}
                title="Duplicar esta apresentação — monta-se uma e tira-se dela o que não interessa à outra plateia"
                className="ghost-btn h-7 px-2 text-[11px]"
              >
                <Copy className="h-3 w-3" /> Duplicar
              </button>
              <button
                onClick={excluirApresentacao}
                title={`Excluir a apresentação "${nomeApres}"`}
                aria-label="Excluir esta apresentação"
                className="ghost-btn ghost-icone hover:text-neg"
              >
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
              {/* O mesmo seletor da grade da DRE e da DFC, e a mesma preferência:
                  quem abriu o número cheio para conferir o fechamento não quer
                  reabrir a cada tela. Na reunião o reduzido é o que cabe. */}
              <SeletorFormato formato={formato} onChange={escolherFormato} />
              <button
                onClick={alternarMontador}
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
      <ModelosApresentacao
        aberto={modelosAberto}
        onOpenChange={setModelosAberto}
        meses={comDado}
        rotuloDoMes={mesPorExtenso}
        catalogo={catalogo}
        roteiroAtual={emApresentacao ? roteiro : null}
        nomeAtual={nomeApres}
        periodoAtual={periodoTipo}
        onGerar={criarApresentacao}
      />

      <ExportarRevisao
        aberto={exportando}
        onOpenChange={setExportando}
        blocos={folhasDoPalco.map((f) => f.titulo)}
        /* O cabeçalho da folha exportada leva o PERÍODO, não o mês: um relatório
           de trimestre com "Julho/26" no topo seria lido como sendo de julho. */
        rotulo={periodo.tipo === "mes" ? mesPorExtenso(periodo.mesFoco) : periodo.rotulo}
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
  o, porQue, texto, campoImpacto, campoAcao, campoPorQue, num,
}: {
  o: Ofensor;
  porQue: string | null;
  texto: { rubrica: string; impacto: string; acao: string } | undefined;
  campoImpacto: PropsCampo;
  campoAcao: PropsCampo;
  /** Reescreve o "por que" SÓ nesta apresentação — a DRE fica como está. */
  campoPorQue: PropsCampo;
  /* Vem da página, não daqui: `formatadores()` resolve o seletor "1,25 M /
     1.254.439" e o estado dele mora no componente de cima. Chamar o hook aqui
     dentro daria a esta linha uma cópia do formato que não acompanharia o
     clique no seletor — e a mesma tela mostraria dois formatos. */
  num: (n: number | null | undefined) => string;
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
                + o.historico.slice(0, -1).map((h) => `${h.rotulo} ${num(h.impacto)}`).join(" · ")
          }
        >
          {o.mesesConferidos === 0 ? "sem histórico"
            : recorrente ? `se repete · ${o.mesesRuins}/${o.mesesConferidos} meses`
            : `pontual · ${o.mesesRuins}/${o.mesesConferidos} meses`}
        </span>

        <div className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>realizado <b className="num text-[12.5px] text-foreground" title={valorExato(o.realizado)}>{num(o.realizado)}</b></span>
          <span>orçado <span className="num text-[12.5px]" title={valorExato(o.orcado)}>{num(o.orcado)}</span></span>
          <span>no EBITDA <b className="num text-[12.5px] text-neg" title={valorExato(o.impacto)}>{num(o.impacto)}</b></span>
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
