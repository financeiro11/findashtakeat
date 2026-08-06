/**
 * Formatadores da tela de Cartão — TODOS devolvem string pura.
 *
 * Ficam separados dos formatadores com hover (./valores.tsx) porque `analise.ts`
 * monta as frases da leitura rápida e dos destaques em template literal: um
 * ReactNode ali viraria "[object Object]". A regra do repo (CLAUDE.md) é a
 * mesma, só que aqui o módulo inteiro é a variante `…Str`.
 */

const nf = (casas: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** "R$ 92.171,00" — o número cheio, para hover, detalhe e frase. */
export function fmtBRLStr(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/**
 * "R$ 474 mil" / "R$ 1,25 mi" / "R$ 623,00".
 * Abaixo de mil devolve o valor cheio: arredondar R$ 623 para "R$ 1 mil" seria
 * mentir num número que cabe inteiro na tela.
 */
export function abrevStr(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return "—";
  const v = Number(n);
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1_000_000) return `${s}R$ ${nf(2).format(a / 1_000_000)} mi`;
  if (a >= 1_000) return `${s}R$ ${nf(0).format(a / 1_000)} mil`;
  return fmtBRLStr(v);
}

/**
 * A célula da matriz, em milhares e com uma casa: "18,4".
 * Zero vira travessão — matriz cheia de "0,0" esconde onde de fato houve gasto.
 */
export function milStr(n: number | null | undefined, opts: { sinal?: boolean } = {}): string {
  if (n == null || !isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v === 0) return "—";
  const txt = nf(1).format(Math.abs(v) / 1_000);
  return opts.sinal ? `${v > 0 ? "+" : "−"}${txt}` : (v < 0 ? `−${txt}` : txt);
}

/** Coluna de variação: "+16,2 mil". */
export function deltaMilStr(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return "—";
  if (Number(n) === 0) return "—";
  return `${milStr(n, { sinal: true })} mil`;
}

/** "+87,7%" a partir de uma fração (0.877). `null` → "novo". */
export function pctStr(f: number | null | undefined, opts: { sinal?: boolean } = { sinal: true }): string {
  if (f == null || !isFinite(Number(f))) return "novo";
  const v = Number(f) * 100;
  const txt = `${nf(1).format(Math.abs(v))}%`;
  if (!opts.sinal || v === 0) return v === 0 ? "0,0%" : txt;
  return `${v > 0 ? "+" : "−"}${txt}`;
}

export function intStr(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return "—";
  return nf(0).format(Number(n));
}

/** "2026-08-01" → "ago/26", quando a fatura não trouxe rótulo próprio. */
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function labelDeCompetencia(competencia: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(competencia ?? "");
  if (!m) return competencia ?? "";
  return `${MES_CURTO[Number(m[2]) - 1] ?? m[2]}/${m[1].slice(2)}`;
}
