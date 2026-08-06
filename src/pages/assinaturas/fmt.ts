// Helpers puros compartilhados pelas abas de /assinaturas (Recorrência e Churn).
//
// Convenção do projeto: o formatador "normal" devolve ReactNode com o valor cheio no hover;
// a variante `…Str` devolve string pura (pra template literal, title=, tickFormatter do
// Recharts). Fica num .ts separado do comum.tsx para não misturar constantes com
// componentes (fast refresh).

import { comValorExato } from "@/components/ValorExato";

export type Aba = "recorrencia" | "churn";

/* ------------------------------ formatação ------------------------------ */
export const fmtCheioStr = (n: number) => `R$ ${Math.round(n || 0).toLocaleString("pt-BR")}`;
export const fmtCheio = (n: number) => comValorExato(n, fmtCheioStr(n));
export const fmt2 = (n: number) =>
  `R$ ${(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtInt = (n: number) => Math.round(n || 0).toLocaleString("pt-BR");

export function fmtKStr(n: number): string {
  const a = Math.abs(n || 0);
  if (a >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
  if (a >= 1_000) return `R$ ${Math.round(n / 1_000)} k`;
  return `R$ ${Math.round(n)}`;
}
export const fmtK = (n: number) => comValorExato(n, fmtKStr(n));

export const fmtPct1 = (n: number) =>
  `${n >= 0 ? "" : "-"}${Math.abs(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const fmtPct2 = (n: number) =>
  `${n >= 0 ? "" : "-"}${Math.abs(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/** Variação percentual entre atual e anterior. */
export function delta(cur: number, prev?: number): { pct: number; up: boolean } | null {
  if (prev == null || prev === 0) return null;
  const pct = ((cur - prev) / prev) * 100;
  return { pct, up: pct >= 0 };
}

/* ------------------------------ níveis de cliente ------------------------------ */
// A planilha de recorrência chama o topo de XG; a de churn chama de GG. Mesmo grupo,
// mesma cor — o rótulo de cada aba segue a fonte dela.
export const NIVEL_ORDEM = ["P", "M", "G", "XG"] as const;
export const NIVEL_META: Record<string, { faixa: string; badge: string; barra: string }> = {
  P:  { faixa: "até ~R$ 250",     badge: "bg-muted text-muted-foreground",                     barra: "bg-muted-foreground/40" },
  M:  { faixa: "~R$ 250–350",     badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400",    barra: "bg-blue-500/70" },
  G:  { faixa: "~R$ 350–580",     badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400", barra: "bg-amber-500/70" },
  XG: { faixa: "acima de R$ 580", badge: "bg-primary/15 text-primary",                         barra: "bg-primary/80" },
  GG: { faixa: "acima de R$ 580", badge: "bg-primary/15 text-primary",                         barra: "bg-primary/80" },
};
