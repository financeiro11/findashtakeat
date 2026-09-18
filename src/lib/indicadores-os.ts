// Lógica pura da tela Metas & Indicadores (/indicadores), que lê o espelho do Takeat OS
// (`os_indicadores`, `os_painel_mensal`, `os_painel_semanal` — ver a migration
// 20260918140000). Fica fora do componente para ser testada: o farol é a parte da tela que
// pode mentir, e mente em silêncio.

import { normalize } from "./normalize";

export type Unidade = "BRL" | "count" | "percent" | string;

export type IndicadorOS = {
  id: string;
  departamento: string;
  canal: string;
  indicador: string;
  unidade: Unidade;
  sensivel: boolean | null;
  e_formula: boolean | null;
  north_star: boolean | null;
  menor_e_melhor: boolean | null;
  ativo: boolean | null;
  no_painel: boolean | null;
  ordem: number | null;
  /** Só nos `e_formula`: "[uuid] + [cost:uuid] / …" — ver ./indicadores-os-calculo. */
  formula?: string | null;
};

/** De onde veio o realizado — definido junto do cálculo, em _shared. */
export type { Origem } from "../../supabase/functions/_shared/indicadores-os-calculo.ts";
import type { Origem } from "../../supabase/functions/_shared/indicadores-os-calculo.ts";

export type LinhaMensalOS = {
  indicator_id: string;
  ano: number;
  mes: number;
  competencia: string;
  orcado: number | null;
  realizado: number | null;
  origem?: Origem;
  /** Por que o número é parcial/estimado — vai no hover. */
  nota?: string;
};

export type LinhaSemanalOS = {
  indicator_id: string;
  ano: number;
  semana: number;
  rotulo_semana: string | null;
  mes: number | null;
  realizado: number | null;
};

/* ------------------------------ sentido ------------------------------ */

export type Sentido = "maior" | "menor" | "neutro";

// O OS só marca `menor_e_melhor` nos dois tempos do Suporte (18/09/2026). Churn,
// cancelamento, downsell, CAC e CPL vêm sem a marca, e o `atingimento_pct` do próprio OS
// sai como "230%" para um churn de 2,3% contra meta de 1% — pintado pelo sentido padrão,
// o pior resultado do mês ficaria verde. A regra por nome cobre isso até o OS corrigir a
// marca; a marca, quando vier, vale sozinha.
const MENOR_POR_NOME = /churn|cancelad|downsell|\bcac\b|\bcpl\b|payback|tempo|ratio volume/;
// Investimento é orçamento a gastar, não meta a bater: passar do orçado não é "bom".
const NEUTRO_POR_NOME = /^investimento/;

export function sentidoDe(ind: Pick<IndicadorOS, "indicador" | "menor_e_melhor">): Sentido {
  if (ind.menor_e_melhor) return "menor";
  const nome = normalize(ind.indicador ?? "").toLowerCase();
  if (NEUTRO_POR_NOME.test(nome)) return "neutro";
  if (MENOR_POR_NOME.test(nome)) return "menor";
  return "maior";
}

/* ------------------------------ atingimento e farol ------------------------------ */

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

/**
 * Realizado ÷ orçado, em %. Recalculado aqui em vez de ler `atingimento_pct`: o OS deixa
 * 210 linhas com orçado e realizado e sem atingimento, e não sabe o sentido (ver acima).
 * Orçado nulo, zero ou negativo não é meta — devolve null.
 */
export function atingimento(realizado: unknown, orcado: unknown): number | null {
  const r = num(realizado);
  const o = num(orcado);
  if (r == null || o == null || o <= 0) return null;
  return (r / o) * 100;
}

export type Farol = "bom" | "atencao" | "ruim" | "sem_meta" | "sem_dado" | "neutro";

/** Folga do amarelo: até 15% do lado errado da meta ainda é "atenção", não "ruim". */
export const FOLGA_ATENCAO = 15;

export function farol(realizado: unknown, orcado: unknown, sentido: Sentido): Farol {
  if (num(realizado) == null) return "sem_dado";
  if (sentido === "neutro") return "neutro";
  const pct = atingimento(realizado, orcado);
  if (pct == null) return "sem_meta";
  if (sentido === "maior") {
    if (pct >= 100) return "bom";
    return pct >= 100 - FOLGA_ATENCAO ? "atencao" : "ruim";
  }
  if (pct <= 100) return "bom";
  return pct <= 100 + FOLGA_ATENCAO ? "atencao" : "ruim";
}

/* ------------------------------ formatação ------------------------------ */

const inteiro = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const decimal = (n: number, casas: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Valor na unidade do indicador, cheio. "—" quando não há número. */
export function fmtValorStr(v: unknown, unidade: Unidade): string {
  const n = num(v);
  if (n == null) return "—";
  if (unidade === "BRL") return Math.abs(n) >= 1000 ? `R$ ${inteiro(n)}` : `R$ ${decimal(n, 2)}`;
  if (unidade === "percent") return `${decimal(n, n % 1 === 0 ? 0 : 2)}%`;
  // count: "Leads por Parceiro" e os tempos do Suporte vêm fracionados.
  return Number.isInteger(n) ? inteiro(n) : decimal(n, 2);
}

/** Versão curta para card e eixo de gráfico: R$ 1,35 M · R$ 95 k. */
export function fmtValorCurtoStr(v: unknown, unidade: Unidade): string {
  const n = num(v);
  if (n == null) return "—";
  if (unidade === "BRL") {
    const a = Math.abs(n);
    if (a >= 1_000_000) return `R$ ${decimal(n / 1_000_000, 2)} M`;
    if (a >= 10_000) return `R$ ${inteiro(n / 1_000)} k`;
  }
  return fmtValorStr(n, unidade);
}

export const fmtPctAtingStr = (pct: number | null) => (pct == null ? "—" : `${inteiro(pct)}%`);

/* ------------------------------ período ------------------------------ */

/**
 * O mês que a tela abre: o último mês FECHADO que tem algum realizado. O mês corrente
 * está sempre parcial (em 18/09 o Inside Sales de setembro mostra zero), e abrir nele
 * faria a tela inteira parecer vermelha.
 */
export function mesPadrao(competencias: string[], hoje: Date = new Date()): string | null {
  const atual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
  const ordenadas = [...new Set(competencias.map((c) => c.slice(0, 10)))].sort();
  const fechadas = ordenadas.filter((c) => c < atual);
  return fechadas.at(-1) ?? ordenadas.at(-1) ?? null;
}

/* ------------------------------ agrupamento ------------------------------ */

export type ItemPainel = {
  ind: IndicadorOS;
  sentido: Sentido;
  origem: Origem;
  nota?: string;
  realizado: number | null;
  orcado: number | null;
  anterior: number | null;
  pct: number | null;
  farol: Farol;
};

export type BlocoCanal = { canal: string; itens: ItemPainel[] };

/**
 * Os indicadores ativos de um departamento no mês, agrupados por canal na ordem do OS.
 * "Consolidado" vai por último: é a soma dos canais, e lida antes deles não diz de onde veio.
 */
export function montarPainel(
  indicadores: IndicadorOS[],
  linhas: LinhaMensalOS[],
  departamento: string,
  competencia: string,
  competenciaAnterior: string | null,
): BlocoCanal[] {
  const chave = (id: string, c: string) => `${id}|${c.slice(0, 10)}`;
  // Linha sem competência é o total anual do OS (mes = 13): não é mês, fica de fora.
  const porChave = new Map(linhas.filter((l) => l.competencia).map((l) => [chave(l.indicator_id, l.competencia), l]));

  const doDepto = indicadores
    .filter((i) => i.departamento === departamento && i.ativo !== false && i.no_painel !== false)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

  const blocos = new Map<string, ItemPainel[]>();
  for (const ind of doDepto) {
    const l = porChave.get(chave(ind.id, competencia));
    const ant = competenciaAnterior ? porChave.get(chave(ind.id, competenciaAnterior)) : undefined;
    const sentido = sentidoDe(ind);
    const realizado = num(l?.realizado);
    const orcado = num(l?.orcado);
    const item: ItemPainel = {
      ind, sentido, realizado, orcado,
      origem: l?.origem ?? "os",
      nota: l?.nota,
      anterior: num(ant?.realizado),
      pct: atingimento(realizado, orcado),
      farol: farol(realizado, orcado, sentido),
    };
    if (!blocos.has(ind.canal)) blocos.set(ind.canal, []);
    blocos.get(ind.canal)!.push(item);
  }

  const canais = [...blocos.keys()];
  const ordem = [...canais.filter((c) => c !== "Consolidado"), ...canais.filter((c) => c === "Consolidado")];
  return ordem.map((canal) => ({ canal, itens: blocos.get(canal)! }));
}

/** Contagem de faróis — o resumo do topo ("12 na meta · 5 em atenção · 9 abaixo"). */
export function resumoFarois(blocos: BlocoCanal[]): Record<Farol, number> {
  const r: Record<Farol, number> = { bom: 0, atencao: 0, ruim: 0, sem_meta: 0, sem_dado: 0, neutro: 0 };
  for (const b of blocos) for (const i of b.itens) r[i.farol]++;
  return r;
}
