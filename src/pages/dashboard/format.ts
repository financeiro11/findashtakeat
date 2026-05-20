// Formatters compartilhados pelo dashboard.

export const fmtBRL = (n: number) => {
  const v = Math.round(n);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
};

export const fmtBRLShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}R$ ${(abs / 1_000_000_000).toFixed(2).replace(".", ",")} bi`;
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(2).replace(".", ",")} M`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toFixed(0)} k`;
  return `${sign}R$ ${abs.toFixed(0)}`;
};

export const fmtPct = (n: number, digits = 1) =>
  `${(n >= 0 ? "+" : "")}${n.toFixed(digits).replace(".", ",")}%`;

export const fmtMeses = (n: number) => {
  if (!isFinite(n)) return "∞";
  if (n > 99) return "99+";
  return `${n.toFixed(1).replace(".", ",")} meses`;
};
