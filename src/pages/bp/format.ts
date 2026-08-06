/**
 * Formatação numérica do módulo BP.
 *
 * A tela sempre mostra o número abreviado (K/M) e o valor cheio vai no
 * `title` do elemento — mesmo padrão da DRE/DFC (ver src/lib/valor.ts).
 */
import { valorExato } from "@/lib/valor";
import { normalize } from "@/lib/normalize";

export const MESES_CURTO = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
export const MESES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const TRIMESTRES = ["1T", "2T", "3T", "4T"];

/** "1,04 M" · "868 K" · "694" — abreviado, sem moeda. */
export function compacto(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sinal = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return sinal + (abs / 1_000_000).toFixed(2).replace(".", ",") + " M";
  if (abs >= 1_000) return sinal + Math.round(abs / 1_000).toLocaleString("pt-BR") + " K";
  return sinal + Math.round(abs).toLocaleString("pt-BR");
}

/** Padrão contábil do BP: negativo entre parênteses — "(3,92 M)". */
export function contabil(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  const s = compacto(Math.abs(v));
  return v < 0 ? `(${s})` : s;
}

/** "R$ 14,84 M" · "R$ (3,92 M)" */
export function moeda(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `R$ ${contabil(v)}`;
}

/** "R$ 5.606" — reais cheios, sem abreviar. Usado em CAC, ticket, remuneração. */
export function reais(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

/** "1.415" */
export function inteiro(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return Math.round(v).toLocaleString("pt-BR");
}

/** `pct(0.073)` → "7,3%" · `pct(0.73, 0)` → "73%" */
export function pct(v: number | null | undefined, casas = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(casas).replace(".", ",")}%`;
}

/** Valor cheio pro tooltip — o número na tela vem sempre abreviado. */
export function exato(v: number | null | undefined, ehPct = false): string | undefined {
  if (v == null || !isFinite(v)) return undefined;
  return ehPct ? `${valorExato(v * 100, { moeda: false, casas: 2 })}%` : valorExato(v);
}

/**
 * Normaliza rótulo pra casar linha do BP com linha das Demonstrações.
 * Tira o prefixo de sinal ("(-)", "(+/-)") e a numeração ("3.1.") antes de
 * passar pelo normalizador compartilhado (que remove acento e pontuação).
 *
 *   "3.1.Equipe Operacional"  → "equipe operacional"
 *   "(-) Custos Operacionais" → "custos operacionais"
 */
export function normRotulo(s: string): string {
  const limpo = (s ?? "")
    .toString()
    .replace(/^\s*\(?[+\-/]+\)?\s*/, "")
    .replace(/^\s*\d+(\.\d+)*\.?\s*/, "");
  return normalize(limpo).toLowerCase();
}

/** Separa "3.1.Equipe Operacional" em { numero: "3.1", texto: "Equipe Operacional" }. */
export function partirRotulo(bruto: string): { numero: string | null; texto: string } {
  const s = (bruto ?? "").toString().trim();
  const m = s.match(/^(\d+(?:\.\d+)*)\.?\s*(.*)$/);
  if (!m || !m[2]) return { numero: null, texto: s };
  return { numero: m[1], texto: m[2].trim() };
}

/** Converte célula da planilha em número — aceita "1.234,56", "(123)", "-", "". */
export function paraNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const negativo = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return negativo ? -n : n;
}

/** Soma ignorando nulos; devolve null se não houver nenhum valor. */
export function soma(vals: (number | null | undefined)[]): number | null {
  let acc: number | null = null;
  for (const v of vals) {
    if (v == null || !isFinite(v)) continue;
    acc = (acc ?? 0) + v;
  }
  return acc;
}
