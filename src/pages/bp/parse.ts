/**
* Parsing puro da planilha do BP e da DRE das Demonstrações — sem I/O, pra
 * poder ser testado isoladamente.
 *
 * A planilha do BP é importada crua: a aba Consolidado vira um array de linhas
 * onde a 1ª coluna é o rótulo e as demais são os meses. O layout é:
 *
 *   Imagem      → rótulo da linha
 *   __EMPTY_1   → "Mês 0" (saldo de abertura)
 *   __EMPTY_2.. → meses 1..12  (localizados pela linha "Mês Calendário")
 *   __EMPTY_15  → total do ano
 *
 * A planilha repete os mesmos rótulos em três blocos (DRE, Balanço e Fluxo de
 * Caixa) — por isso o parse é **seccionado**: "3.1.Equipe Operacional" existe
 * nos três e não pode ser somado entre eles.
 */
import { MESES_EN, normRotulo, paraNumero, partirRotulo, soma } from "./format";
export type SecaoBP = "dre" | "balanco" | "dfc";
export type TipoLinha = "linha" | "total" | "percent";

export type LinhaBP = {
  id: string;
  /** Rótulo exibido, já sem a numeração ("Equipe Operacional"). */
  texto: string;
  /** Numeração original da planilha ("3.1"), quando existir. */
  numero: string | null;
  chave: string;
  depth: number;
  tipo: TipoLinha;
  paiId: string | null;
  temFilhos: boolean;
  meses: (number | null)[];
  total: number | null;
};

/** Subtotais da DRE — vêm sem numeração na planilha e são destacados na tela. */
const TOTAIS_DRE = new Set([
  "receita liquida",
  "margem de contribuicao",
  "ebitda",
  "lucro liquido",
  "sg a",
]);

const MARCADORES: { secao: SecaoBP; chave: string }[] = [
  { secao: "dre", chave: "demonstrativo de resultado" },
  { secao: "balanco", chave: "balanco patrimonial" },
  { secao: "dfc", chave: "fluxo de caixa" },
];

/**
 * Rótulos que mudam de nome entre o BP e as Demonstrações. Sem isso a coluna
 * de realizado fica vazia justamente nas linhas de topo, que são as que mais
 * importam.
 */
export const APELIDOS: Record<string, string> = {
  receita: "receita bruta",
  "receita recorrente assinaturas": "receita recorrente",
  "receitas spot": "receita spot",
  "custo operacional": "custos operacionais",
  "premiacao operacional": "premiacoes operacionais",
  infraestrutura: "servidor",
  "impostos sobre resultado": "impostos",
  depreciacao: "depreciacao amortizacao",
  "outras despesas adm": "outras despesas adm",
};

export function ehStub(v: number | null): boolean {
  // Mês aberto nas Demonstrações costuma vir com 1 ou 0 em Receita Bruta.
  return v == null || Math.abs(v) < 1000;
}

export function vazio12(): (number | null)[] {
  return Array(12).fill(null);
}

/** Descobre quais colunas do JSON cru são os meses 1..12 e qual é o total. */
function mapearColunas(linhas: Record<string, unknown>[]) {
  const chaves = Object.keys(linhas[0] ?? {});
  const colRotulo = chaves[0];
  const colsMes: string[] = [];

  const linhaMes = linhas.find(
    (l) => normRotulo(String(l[colRotulo] ?? "")) === "mes calendario",
  );
  if (linhaMes) {
    for (const k of chaves) {
      const n = Number(linhaMes[k]);
      if (Number.isInteger(n) && n >= 1 && n <= 12) colsMes[n - 1] = k;
    }
  }
  // Fallback: primeiras 12 colunas numéricas depois do rótulo.
  if (colsMes.filter(Boolean).length < 12) {
    const numericas = chaves.slice(1).filter((k) => linhas.some((l) => typeof l[k] === "number"));
    for (let i = 0; i < 12 && i < numericas.length; i++) colsMes[i] = numericas[i];
  }

  // Total do ano: primeira coluna depois do mês 12 com valores relevantes.
  const idx12 = colsMes[11] ? chaves.indexOf(colsMes[11]) : -1;
  let colTotal: string | null = null;
  for (let i = idx12 + 1; i < chaves.length; i++) {
    const k = chaves[i];
    if (linhas.some((l) => typeof l[k] === "number" && Math.abs(l[k] as number) > 1000)) {
      colTotal = k;
      break;
    }
  }
  return { colRotulo, colsMes, colTotal };
}

export function parsearPlano(linhas: Record<string, unknown>[]) {
  const secoes: Record<SecaoBP, LinhaBP[]> = { dre: [], balanco: [], dfc: [] };
  if (!linhas.length) return secoes;

  const { colRotulo, colsMes, colTotal } = mapearColunas(linhas);
  let atual: SecaoBP | null = null;
  const vistas = new Set<SecaoBP>();
  // Último ancestral por profundidade, pra ligar filho → pai.
  let ultimoNumerado: LinhaBP | null = null;
  const porNumero = new Map<string, LinhaBP>();

  linhas.forEach((linha, i) => {
    const bruto = String(linha[colRotulo] ?? "").trim();
    if (!bruto) return;
    const chave = normRotulo(bruto);
    if (!chave) return;

    // Troca de seção. O marcador precisa bater exato — "Fluxo de Caixa
    // Operacional" não pode reabrir a seção "Fluxo de Caixa".
    const marcador = MARCADORES.find((m) => m.chave === chave && !vistas.has(m.secao));
    if (marcador) {
      atual = marcador.secao;
      vistas.add(marcador.secao);
      ultimoNumerado = null;
      porNumero.clear();
      return;
    }
    if (!atual) return;
    const secao: SecaoBP = atual;

    const meses = colsMes.map((k) => (k ? paraNumero(linha[k]) : null));
    const totalPlanilha = colTotal ? paraNumero(linha[colTotal]) : null;
    if (meses.every((v) => v == null) && totalPlanilha == null) return;

    const { numero, texto } = partirRotulo(bruto);
    const ehPercent = bruto.trim().startsWith("%");
    const ehTotal = !numero && !ehPercent && TOTAIS_DRE.has(chave);

    let depth = 0;
    let paiId: string | null = null;
    if (numero) {
      depth = numero.split(".").length - 1;
      const numeroPai = numero.split(".").slice(0, -1).join(".");
      paiId = numeroPai ? (porNumero.get(numeroPai)?.id ?? null) : null;
    } else if (!ehTotal && !ehPercent && ultimoNumerado) {
      // Linhas sem numeração penduradas na última numerada
      // (ex.: "Geração de Leads | Inbound" sob "6.1.Aquisição de Clientes").
      depth = ultimoNumerado.depth + 1;
      paiId = ultimoNumerado.id;
    }

    const item: LinhaBP = {
      id: `${secao}-${i}`,
      texto,
      numero,
      chave,
      depth,
      tipo: ehPercent ? "percent" : ehTotal ? "total" : "linha",
      paiId,
      temFilhos: false,
      meses,
      total: totalPlanilha ?? soma(meses),
    };

    if (numero) {
      porNumero.set(numero, item);
      ultimoNumerado = item;
    }
    if (paiId) {
      const pai = secoes[secao].find((l) => l.id === paiId);
      if (pai) pai.temFilhos = true;
    }
    secoes[secao].push(item);
  });

  return secoes;
}

/** Lê a DRE das Demonstrações e devolve série mensal por rótulo normalizado. */
export function parsearRealizado(dados: unknown, ano: number) {
  const mapa: Record<string, (number | null)[]> = {};
  if (!dados) return mapa;
  const linhas: Record<string, unknown>[] = Array.isArray(dados)
    ? dados
    : ((dados as { rows?: Record<string, unknown>[] }).rows ?? []);
  const yy = String(ano).slice(-2);

  for (const linha of linhas) {
    const colRotulo =
      Object.keys(linha).find((k) => k === "Conta") ??
      Object.keys(linha).find((k) => !/^[A-Za-z]{3}-\d{2}$/.test(k));
    const bruto = colRotulo ? String(linha[colRotulo] ?? "").trim() : "";
    if (!bruto) continue;
    const serie = MESES_EN.map((m) => paraNumero(linha[`${m}-${yy}`]));
    if (serie.some((v) => v != null)) mapa[normRotulo(bruto)] = serie;
  }
  return mapa;
}

