/**
 * Valor por extenso — sem abreviação, com todas as casas decimais.
 * Usado nos tooltips de hover dos números compactados pela UI
 * (ex.: "R$ 1,23 M" → "R$ 1.234.567,89").
 */
export function valorExato(
  v: number | null | undefined,
  opts: { moeda?: boolean | "USD"; casas?: number } = {},
): string {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "—";
  const { moeda = true, casas = 2 } = opts;
  if (moeda === "USD") {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
  }
  return n.toLocaleString("pt-BR", {
    ...(moeda ? { style: "currency" as const, currency: "BRL" } : {}),
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
