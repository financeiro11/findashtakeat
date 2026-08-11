/* ============================================================
 *  Ponto de equilíbrio (break-even) a partir da DRE.
 *
 *  Responde "quanto precisamos faturar no mês para as atividades
 *  se pagarem". A conta clássica:
 *
 *      margem de contribuição %  =  (receita − custos variáveis) / receita
 *      ponto de equilíbrio (R$)  =  custos fixos / margem de contribuição %
 *
 *  O insumo é o blob da DRE (`demonstracoes_contabeis`, tipo "dre"),
 *  que é o único lugar onde a receita está separada do custo E cada
 *  despesa está classificada por rubrica. O regime, portanto, é
 *  COMPETÊNCIA — diferente do card de capital de giro ao lado, que é
 *  caixa. Os dois números não batem de propósito.
 *
 *  O que é fixo e o que é variável é decisão de negócio, não de
 *  contabilidade: por isso `CLASSIFICACAO_PADRAO` é só um ponto de
 *  partida e a tela deixa reclassificar rubrica a rubrica.
 * ============================================================ */

export type Bucket = "variavel" | "fixo" | "fora";

/* As rubricas de receita da DRE (espelham DRE_SECOES.receitaBruta do
   supabase/functions/omie-sync/index.ts). */
export const RUBRICAS_RECEITA = [
  "Receita de Assinaturas",
  "Enterprise",
  "Receita Spot",
  "Receita com Materiais",
  "Receita Markup",
  "Serviços para Clientes",
];

export const GRUPO_OUTRAS = "Outras rubricas encontradas na DRE";

/* Catálogo de custos/despesas, agrupado como a pessoa pensa — não como a
   DRE empilha. A ordem dentro do grupo é a da própria DRE. */
export const GRUPOS_CUSTO: { grupo: string; rubricas: string[] }[] = [
  {
    grupo: "Deduções sobre receita",
    rubricas: ["Simples Nacional", "PIS", "COFINS", "ISS", "ICMS", "Inadimplência", "Devoluções"],
  },
  {
    grupo: "Custos",
    rubricas: [
      "Equipe Operacional", "Premiações Operacionais", "Meios de Pagamento",
      "CMV Materiais", "Servidor", "Softwares Operacionais", "Outros Custos",
    ],
  },
  {
    grupo: "Pessoal & administrativo",
    rubricas: [
      "Equipe Administrativa", "Equipe Marketing", "Equipe Parcerias", "Equipe Comercial",
      "Equipe Onboarding", "Equipe Tecnologia", "Benefícios", "Encargos Sociais",
      "Ocupação & Escritório", "Assessorias & Consultorias", "Softwares Administrativos",
      "Viagens & Transportes Adm", "Outras despesas Adm",
    ],
  },
  {
    grupo: "Marketing & vendas",
    rubricas: [
      "Campanhas de Mídia Paga", "Campanhas de Outros Canais", "Comissões Consultores / Parceiros",
      "Premiações", "MGM", "Softwares Marketing & Vendas", "Agências & Consultorias",
      "Viagens & Transportes Mkt", "Eventos e Feiras", "Outras despesas Mkt",
    ],
  },
  {
    grupo: "Financeiras & não operacionais",
    rubricas: [
      "(-) Depreciação & Amortização", "(-) Juros", "(-) IOF",
      "Despesas Não Operacionais", "(-) Estorno de Compras",
      "IRPJ", "CSLL", "IRF",
    ],
  },
];

/* Classificação inicial.
   VARIÁVEL — sobe junto com a venda: imposto sobre faturamento, adquirência,
   CMV, infra por cliente e o que se paga por venda nova (comissão, MGM).
   FORA — não faz parte da conta: imposto sobre lucro (no ponto de equilíbrio
   o lucro é zero, logo o imposto também), não recorrentes e créditos.
   Todo o resto é FIXO. */
export const CLASSIFICACAO_PADRAO: Record<string, Bucket> = {
  // variáveis
  "Simples Nacional": "variavel",
  "PIS": "variavel",
  "COFINS": "variavel",
  "ISS": "variavel",
  "ICMS": "variavel",
  "Inadimplência": "variavel",
  "Devoluções": "variavel",
  "Meios de Pagamento": "variavel",
  "CMV Materiais": "variavel",
  "Servidor": "variavel",
  "Softwares Operacionais": "variavel",
  "Premiações Operacionais": "variavel",
  "Comissões Consultores / Parceiros": "variavel",
  "Premiações": "variavel",
  "MGM": "variavel",
  // fora da conta
  "Despesas Não Operacionais": "fora",
  "(-) Estorno de Compras": "fora",
  "IRPJ": "fora",
  "CSLL": "fora",
  "IRF": "fora",
};

/* Linhas de total/memória que a DRE carrega e que jamais são custo — usadas
   para não confundir um total com uma rubrica órfã. */
const LINHAS_NAO_CUSTO = new Set<string>([
  "Receita Líquida", "Margem de contribuição", "EBITDA", "Lucro Líquido",
  "(+) Ajustes de EBITDA", "EBITDA Ajustado", "% Margem EBITDA Ajustado",
  "(+) Receita financeira", "Cashburn", "Fluxo de Caixa Operacional", "Fluxo Livre",
  ...RUBRICAS_RECEITA,
]);

/* ------------------------------ meses ------------------------------ */

const EN_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PT_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const PT_LONGO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export const COL_MES = /^[A-Za-z]{3}-\d{2}$/;

/** "Jun-26" → 26*12+5, para ordenar. -1 quando não é coluna de mês. */
export function sortKey(col: string): number {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(col ?? "");
  if (!m) return -1;
  const i = EN_ORDER.indexOf(m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase());
  return i < 0 ? -1 : (2000 + parseInt(m[2], 10)) * 12 + i;
}

function mesIdx(col: string): number {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(col ?? "");
  if (!m) return -1;
  return EN_ORDER.indexOf(m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase());
}

/** "Jun-26" → "Jun/26" */
export function rotuloCurto(col: string): string {
  const i = mesIdx(col);
  return i < 0 ? col : `${PT_CURTO[i]}/${col.slice(-2)}`;
}

/** "Jun-26" → "Junho 2026" */
export function rotuloLongo(col: string): string {
  const i = mesIdx(col);
  return i < 0 ? col : `${PT_LONGO[i]} 20${col.slice(-2)}`;
}

/** Coluna do mês corrente no formato da DRE ("Ago-26"), para nunca tratar
    um mês pela metade como fechado. */
export function colunaDoMes(d: Date): string {
  return `${EN_ORDER[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

/** Quantos dias tem o mês da coluna ("Fev-24" → 29). 30 quando não dá para ler. */
export function diasDoMes(col: string): number {
  const i = mesIdx(col);
  if (i < 0) return 30;
  return new Date(2000 + parseInt(col.slice(-2), 10), i + 1, 0).getDate();
}

/* ------------------------------ leitura do blob ------------------------------ */

export type LinhaDRE = Record<string, unknown>;

function num(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

/** Rubricas que existem na DRE mas não estão no catálogo. Ficam visíveis na
    tela para não sumirem em silêncio da conta dos custos fixos. */
export function rubricasOrfas(rows: LinhaDRE[]): string[] {
  const catalogadas = new Set(GRUPOS_CUSTO.flatMap((g) => g.rubricas));
  const vistas = new Set<string>();
  for (const r of rows ?? []) {
    const conta = String(r?.["Conta"] ?? "").trim();
    if (!conta || conta.startsWith("%")) continue;
    if (catalogadas.has(conta) || LINHAS_NAO_CUSTO.has(conta)) continue;
    vistas.add(conta);
  }
  return [...vistas].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Catálogo + órfãs, para montar o painel de classificação. */
export function catalogoCompleto(rows: LinhaDRE[]): { grupo: string; rubricas: string[] }[] {
  const orfas = rubricasOrfas(rows);
  return orfas.length ? [...GRUPOS_CUSTO, { grupo: GRUPO_OUTRAS, rubricas: orfas }] : GRUPOS_CUSTO;
}

/** Classificação padrão já cobrindo as órfãs (que entram "fora" da conta). */
export function classificacaoPadrao(rows: LinhaDRE[]): Record<string, Bucket> {
  const out: Record<string, Bucket> = {};
  for (const g of GRUPOS_CUSTO) for (const r of g.rubricas) out[r] = CLASSIFICACAO_PADRAO[r] ?? "fixo";
  for (const r of rubricasOrfas(rows)) out[r] = "fora";
  return out;
}

/* ------------------------------ cálculo ------------------------------ */

export type ResultadoMes = {
  mes: string;
  receita: number;
  variaveis: number;
  fixos: number;
  /** margem de contribuição em R$ (receita − variáveis) */
  mc: number;
  /** margem de contribuição em % (0–100); null quando não houve receita */
  mcPct: number | null;
  /** receita necessária no mês para o resultado zerar; null se a margem não cobre nada */
  pe: number | null;
  /** receita − ponto de equilíbrio, em R$ */
  margemSeguranca: number | null;
  /** margem de segurança em % da receita */
  msPct: number | null;
  /** receita − variáveis − fixos (resultado pela ótica do ponto de equilíbrio) */
  resultado: number;
};

function montar(receita: number, variaveis: number, fixos: number, mes: string): ResultadoMes {
  const mc = receita - variaveis;
  const mcPct = receita > 0 ? (mc / receita) * 100 : null;
  // Margem de contribuição não positiva = vender mais só aumenta o prejuízo:
  // não existe ponto de equilíbrio, e é isso que o `null` comunica na tela.
  const pe = mcPct !== null && mc > 0 ? fixos / (mc / receita) : null;
  const margemSeguranca = pe !== null ? receita - pe : null;
  const msPct = pe !== null && receita > 0 ? ((receita - pe) / receita) * 100 : null;
  return { mes, receita, variaveis, fixos, mc, mcPct, pe, margemSeguranca, msPct, resultado: mc - fixos };
}

/* A DRE do omie-sync grava despesa com sinal negativo, mas o import do tracker
   em Excel nem sempre. Em vez de apostar numa convenção, cada mês descobre a
   sua: se o bruto dos custos deu negativo, o sinal é invertido. Assim uma
   linha de crédito (ex.: estorno) continua abatendo em vez de somar, o que
   `Math.abs` linha a linha jogaria fora. */
function fatorSinal(bruto: number): number {
  return bruto <= 0 ? -1 : 1;
}

/* -1 * 0 dá -0 em JS, e o formatador de moeda escreveria "-R$ 0,00". */
const semZeroNegativo = (n: number) => (n === 0 ? 0 : n);

export function calcular(
  rows: LinhaDRE[],
  colunas: string[],
  classificacao: Record<string, Bucket>,
): ResultadoMes[] {
  const byConta = new Map<string, LinhaDRE>();
  for (const r of rows ?? []) {
    const conta = String(r?.["Conta"] ?? "").trim();
    if (conta && !byConta.has(conta)) byConta.set(conta, r);
  }
  const val = (conta: string, col: string) => num(byConta.get(conta)?.[col]);

  const variaveis = Object.keys(classificacao).filter((r) => classificacao[r] === "variavel");
  const fixas = Object.keys(classificacao).filter((r) => classificacao[r] === "fixo");

  return colunas.map((col) => {
    // Receita nunca é crédito líquido, então o total pode ir em módulo.
    const receita = Math.abs(RUBRICAS_RECEITA.reduce((s, r) => s + val(r, col), 0));
    const brutoVar = variaveis.reduce((s, r) => s + val(r, col), 0);
    const brutoFix = fixas.reduce((s, r) => s + val(r, col), 0);
    const s = fatorSinal(brutoVar + brutoFix);
    return montar(receita, semZeroNegativo(s * brutoVar), semZeroNegativo(s * brutoFix), col);
  });
}

/** Agrega N meses e devolve o equivalente MENSAL — somar receita, variáveis e
    fixos e só então dividir dá a média ponderada certa, enquanto a média
    simples dos pontos de equilíbrio distorce quando um mês fatura pouco. */
export function media(meses: ResultadoMes[], rotulo = "média"): ResultadoMes | null {
  const n = meses.length;
  if (!n) return null;
  const receita = meses.reduce((s, m) => s + m.receita, 0) / n;
  const variaveis = meses.reduce((s, m) => s + m.variaveis, 0) / n;
  const fixos = meses.reduce((s, m) => s + m.fixos, 0) / n;
  return montar(receita, variaveis, fixos, rotulo);
}

/**
 * Mês de referência = último mês FECHADO (coluna travada na DRE).
 * Sem travas, cai para o último mês com receita que não seja o corrente —
 * um mês em andamento tem custo cheio e receita pela metade, e entraria na
 * tela como um ponto de equilíbrio inalcançável.
 */
export function mesReferencia(
  colunas: string[],
  travados: Set<string>,
  resultados: ResultadoMes[],
  colAtual: string,
): string | null {
  const ordenadas = [...colunas].sort((a, b) => sortKey(a) - sortKey(b));
  const fechadas = ordenadas.filter((c) => travados.has(c));
  if (fechadas.length) return fechadas[fechadas.length - 1];
  const porMes = new Map(resultados.map((r) => [r.mes, r]));
  for (let i = ordenadas.length - 1; i >= 0; i--) {
    const c = ordenadas[i];
    if (c !== colAtual && (porMes.get(c)?.receita ?? 0) > 0) return c;
  }
  return null;
}
