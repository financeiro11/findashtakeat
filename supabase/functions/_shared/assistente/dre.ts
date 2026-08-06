// Leitura do DRE/DFC para o Assistente.
//
// O DRE não é tabular no banco: é UM registro em `demonstracoes_contabeis`
// (tipo='dre', periodo='completo') com um blob jsonb no formato
//   { columns: ["Conta", "Jan-26", "Feb-26", ...], rows: [{ Conta: "EBITDA", "Jan-26": 123 }] }
// Meses são chaves em inglês abreviado com ano de 2 dígitos ("Apr-26").
//
// O parsing aqui espelha `flattenDemonstracoes`/`toNum` de src/pages/dashboard/useFinanceData.ts.
// Está duplicado de propósito: aquilo é browser/React e isto é Deno/Edge, sem build
// compartilhado entre os dois. Se o formato do blob mudar, os DOIS lugares mudam juntos.

/** Regra do negócio, não detalhe técnico — ver `mesesFechados()`. */
export const TABELA_TRAVAS = "demonstracoes_mes_trancado";

const MES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export type Competencia = { ano: number; mes: number };

/** "Apr-26" → { ano: 2026, mes: 4 }. Devolve null para qualquer outra chave. */
export function parseColuna(chave: string): Competencia | null {
  const m = chave.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const i = MES_EN.indexOf(m[1]);
  if (i < 0) return null;
  return { ano: 2000 + Number(m[2]), mes: i + 1 };
}

/** { ano: 2026, mes: 4 } → "Apr-26". Inverso de `parseColuna`. */
export function montarColuna(c: Competencia): string {
  return `${MES_EN[c.mes - 1]}-${String(c.ano % 100).padStart(2, "0")}`;
}

/** "julho de 2026" — para a fala e para o rótulo de fonte. */
export function competenciaExtenso(c: Competencia): string {
  return `${MES_PT[c.mes - 1]} de ${c.ano}`;
}

/** "07/2026" — formato de tela, conforme o padrão do Hub. */
export function competenciaCurta(c: Competencia): string {
  return `${String(c.mes).padStart(2, "0")}/${c.ano}`;
}

export function ordenar(a: Competencia, b: Competencia): number {
  return a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes;
}

/**
 * Converte célula do blob em número.
 *
 * O blob mistura tipos: número puro, "1.234,56", "R$ 1.234,56" e "(1.234,56)" —
 * parênteses são a notação contábil de NEGATIVO, e ignorar isso inverteria o sinal
 * de despesas inteiras.
 */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const negativo = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");

  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

export type Demonstracao = {
  /** rubrica → (coluna "Apr-26" → valor) */
  valores: Map<string, Map<string, number>>;
  /** Todas as competências presentes no blob, em ordem cronológica. */
  competencias: Competencia[];
  atualizadoEm: string | null;
};

/**
 * Estrutura o blob para consulta por (rubrica, competência).
 *
 * Linhas de percentual ("% Margem EBITDA") são descartadas: são derivadas, e recalculá-las
 * a partir dos valores é mais confiável do que confiar no que foi salvo.
 */
export function estruturar(blob: unknown, atualizadoEm: string | null = null): Demonstracao {
  const linhas: Record<string, unknown>[] = Array.isArray(blob)
    ? (blob as Record<string, unknown>[])
    : Array.isArray((blob as { rows?: unknown })?.rows)
      ? ((blob as { rows: Record<string, unknown>[] }).rows)
      : [];

  const valores = new Map<string, Map<string, number>>();
  const colunas = new Set<string>();

  for (const linha of linhas) {
    // A coluna do rótulo chama-se "Conta", mas nem todo blob antigo respeita isso:
    // pega-se a primeira chave que NÃO seja uma competência.
    const chaveRotulo = Object.keys(linha).find((k) => parseColuna(k) === null);
    const rubrica = chaveRotulo ? String(linha[chaveRotulo] ?? "").trim() : "";
    if (!rubrica || rubrica.startsWith("%")) continue;

    const porMes = valores.get(rubrica) ?? new Map<string, number>();
    for (const chave of Object.keys(linha)) {
      if (parseColuna(chave) === null) continue;
      const n = toNum(linha[chave]);
      if (n === null) continue;
      porMes.set(chave, n);
      colunas.add(chave);
    }
    if (porMes.size > 0) valores.set(rubrica, porMes);
  }

  const competencias = [...colunas]
    .map(parseColuna)
    .filter((c): c is Competencia => c !== null)
    .sort(ordenar);

  return { valores, competencias, atualizadoEm };
}

/** Valor de uma rubrica numa competência, ou null se a célula não existe. */
export function valorDe(d: Demonstracao, rubrica: string, c: Competencia): number | null {
  return d.valores.get(rubrica)?.get(montarColuna(c)) ?? null;
}

/**
 * Competências FECHADAS, em ordem cronológica.
 *
 * Isto não é preciosismo: o mês corrente sincroniza com o Omie aos poucos e está sempre
 * incompleto. Comparar contra ele produz variações sem sentido — a página de DRE registra
 * ter visto "EBITDA +7000%" por causa disso. Toda análise do Assistente usa só meses
 * travados; um mês aberto pode ser MOSTRADO, nunca comparado.
 *
 * @param travas linhas de `demonstracoes_mes_trancado` (col_key = "Apr-26")
 */
export function mesesFechados(d: Demonstracao, travas: string[]): Competencia[] {
  const travadas = new Set(travas);
  return d.competencias.filter((c) => travadas.has(montarColuna(c)));
}
