/* ---------------------------------------------------------------------------
 * Apoio ao valor manual da DRE/DFC (ver components/demonstracoes/ValoresManuais).
 * Só a parte que não depende de React — é o que dá para testar sozinho.
 * ------------------------------------------------------------------------- */

/**
 * Lê o que a pessoa digitou no campo de valor. Aceita o que o teclado do
 * financeiro produz: "-5.488,00", "(5.488)", "R$ 5488", "5488.75".
 *
 * O caso ambíguo é o ponto sem vírgula: "1.234" é mil duzentos e trinta e quatro
 * no Brasil e um vírgula dois em qualquer planilha exportada. Vale a regra do
 * grupo de milhar — ponto seguido de exatamente três dígitos, até o fim — porque
 * é a forma que sai do Excel em pt-BR, que é de onde estes números vêm.
 */
export function paraNumero(entrada: string): number | null {
  const t = String(entrada ?? "").trim().replace(/\s/g, "").replace(/r\$/gi, "");
  if (!t) return null;

  const negativo = t.startsWith("-") || /^\(.*\)$/.test(t);
  let n = t.replace(/[()+-]/g, "");
  if (!n) return null;

  if (n.includes(",")) {
    // Vírgula manda: tudo que é ponto ali é separador de milhar.
    n = n.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(n)) {
    n = n.replace(/\./g, "");
  }

  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return negativo ? -Math.abs(v) : v;
}

/** Campo de edição: número cheio, sem "R$", como se digita. */
export function paraCampo(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "Jun-26" → "Jun 26". */
export function rotuloMes(col: string): string {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(col ?? "");
  if (!m) return col ?? "—";
  const i = EN.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i >= 0 ? `${PT[i]} ${m[2]}` : col;
}
