import { normalize } from "@/lib/normalize";

/* ============================================================================
 * Esquema das demonstrações (DRE e DFC) + leitura da base congelada.
 *
 * A base é `demonstracoes_contabeis` com periodo='completo': um blob
 * { columns: ["Conta","Jan-24",…,"Jul-26"], rows: [{Conta, "Jan-24": n, …}] }.
 * O blob é PLANO — a hierarquia (pai → filho) mora aqui, e é a mesma usada
 * pelas páginas DRE, DFC e Histórico Multianual, para os três não divergirem.
 * ========================================================================== */

export type Kind = "header" | "child" | "leaf" | "total" | "percent";
export type Node = {
  label: string;
  kind: Kind;
  /** rótulo real na base, quando diferente de `label` */
  src?: string;
  /** em rubricas percentuais, divide pelo total deste rótulo */
  pctOf?: string;
  children?: Node[];
};

export const DRE_SCHEMA: Node[] = [
  { label: "Receita Bruta", kind: "header", children: [
    { label: "Receita Recorrente", kind: "child", children: [
      { label: "Receita de Assinaturas", kind: "leaf" },
      { label: "Enterprise", kind: "leaf" },
    ]},
    { label: "Receita Spot", kind: "child", children: [
      { label: "Receita com Materiais", kind: "leaf" },
      { label: "Receita Markup", kind: "leaf" },
      { label: "Serviços para Clientes", kind: "leaf" },
    ]},
  ]},
  { label: "(-) Deduções da receita", kind: "header", children: [
    { label: "Simples Nacional", kind: "child" },
    { label: "PIS", kind: "child" },
    { label: "COFINS", kind: "child" },
    { label: "ISS", kind: "child" },
    { label: "ICMS", kind: "child" },
    { label: "Inadimplência", kind: "child" },
    { label: "Devoluções", kind: "child" },
  ]},
  { label: "Receita Líquida", kind: "total" },
  { label: "(-) Custos Operacionais", kind: "header", children: [
    { label: "Equipe Operacional", kind: "child" },
    { label: "Premiações Operacionais", kind: "child" },
    { label: "Meios de Pagamento", kind: "child" },
    { label: "CMV Materiais", kind: "child" },
    { label: "Servidor", kind: "child" },
    { label: "Softwares Operacionais", kind: "child" },
    { label: "Outros Custos", kind: "child" },
  ]},
  { label: "Margem de contribuição", kind: "total" },
  { label: "% Margem de contribuição", kind: "percent", pctOf: "Receita Líquida" },
  { label: "(-) SG&A", kind: "header", children: [
    { label: "Pessoal", kind: "child", children: [
      { label: "Equipe Administrativa", kind: "leaf" },
      { label: "Equipe Marketing", kind: "leaf" },
      { label: "Equipe Parcerias", kind: "leaf" },
      { label: "Equipe Comercial", kind: "leaf" },
      { label: "Equipe Onboarding", kind: "leaf" },
      { label: "Equipe Tecnologia", kind: "leaf" },
      { label: "Benefícios", kind: "leaf" },
      { label: "Encargos Sociais", kind: "leaf" },
    ]},
    { label: "Despesas Administrativas", kind: "child", children: [
      { label: "Ocupação & Escritório", kind: "leaf" },
      { label: "Assessorias & Consultorias", kind: "leaf" },
      { label: "Softwares Administrativos", kind: "leaf" },
      { label: "Viagens & Transportes Adm", kind: "leaf" },
      { label: "Outras despesas Adm", kind: "leaf" },
    ]},
    { label: "Despesas Marketing & Vendas", kind: "child", children: [
      { label: "Campanhas de Mídia Paga", kind: "leaf" },
      { label: "Campanhas de Outros Canais", kind: "leaf" },
      { label: "Comissões Consultores / Parceiros", kind: "leaf" },
      { label: "Premiações", kind: "leaf" },
      { label: "MGM", kind: "leaf" },
      { label: "Softwares Marketing & Vendas", kind: "leaf" },
      { label: "Agências & Consultorias", kind: "leaf" },
      { label: "Viagens & Transportes Mkt", kind: "leaf" },
      { label: "Eventos e Feiras", kind: "leaf" },
      { label: "Outras despesas Mkt", kind: "leaf" },
    ]},
  ]},
  { label: "EBITDA", kind: "total" },
  { label: "% Margem EBITDA", kind: "percent", pctOf: "Receita Líquida" },
  { label: "(+/-) Resultado Financeiro", kind: "header", children: [
    { label: "(-) Depreciação & Amortização", kind: "child" },
    { label: "(-) Juros", kind: "child" },
    { label: "(-) IOF", kind: "child" },
    { label: "(+) Receita financeira", kind: "child" },
  ]},
  { label: "(+/-) Resultado Não Operacional", kind: "header", children: [
    { label: "Despesas Não Operacionais", kind: "child" },
    { label: "(-) Estorno de Compras", kind: "child" },
  ]},
  { label: "(-) Impostos", kind: "header", children: [
    { label: "IRPJ", kind: "child" },
    { label: "CSLL", kind: "child" },
    { label: "IRF", kind: "child" },
  ]},
  { label: "Lucro Líquido", kind: "total" },
  { label: "% Margem Líquida", kind: "percent", pctOf: "Receita Líquida" },
];

// A ordem dos blocos de topo é fixa (usada pelos KPIs):
//   Entradas · Saídas · FCO · Investimentos · Financiamento · Fluxo Livre · Cashburn
export const DFC_SCHEMA: Node[] = [
  { label: "Entradas Operacionais", kind: "header", children: [
    { label: "Receita de Assinaturas", kind: "child" },
    { label: "Receita com Materiais", kind: "child" },
    { label: "Receita Markup", kind: "child" },
    { label: "Receita de Serviços", kind: "child" },
    { label: "Entrada de Receita", kind: "child" },
    { label: "(+) Receita financeira", kind: "child" },
    { label: "(+) Resultado Não Operacional", kind: "child" },
  ]},
  { label: "Saídas Operacionais", kind: "header", children: [
    { label: "Impostos", kind: "child", children: [
      { label: "Simples Nacional", kind: "leaf" },
      { label: "PIS", kind: "leaf" },
      { label: "COFINS", kind: "leaf" },
      { label: "ISS", kind: "leaf" },
      { label: "ICMS", kind: "leaf" },
      { label: "IRF", kind: "leaf" },
      { label: "Parcelamento de Impostos", kind: "leaf" },
      { label: "Retenção de Contribuição", kind: "leaf" },
    ]},
    { label: "Pessoal", kind: "child", children: [
      { label: "Equipe Administrativa", kind: "leaf" },
      { label: "Equipe Comercial", kind: "leaf" },
      { label: "Equipe Marketing", kind: "leaf" },
      { label: "Equipe Tecnologia", kind: "leaf" },
      { label: "Equipe Operacional", kind: "leaf" },
      { label: "Equipe Onboarding", kind: "leaf" },
      { label: "Premiações Operacionais", kind: "leaf" },
      { label: "Premiações", kind: "leaf" },
      { label: "Encargos sociais", kind: "leaf" },
      { label: "Benefícios", kind: "leaf" },
    ]},
    { label: "Custos de Operação", kind: "child", children: [
      { label: "CMV Materiais", kind: "leaf" },
      { label: "Outros Custos", kind: "leaf" },
      { label: "Meios de Pagamento", kind: "leaf" },
      { label: "Servidor", kind: "leaf" },
      { label: "Softwares Operacionais", kind: "leaf" },
      { label: "MGM", kind: "leaf" },
    ]},
    { label: "Despesas Administrativas", kind: "child", children: [
      { label: "Assessorias & Consultorias", kind: "leaf" },
      { label: "Softwares Administrativos", kind: "leaf" },
      { label: "Ocupação & Escritório", kind: "leaf" },
      { label: "Viagens & Transportes Adm", kind: "leaf" },
      { label: "Outras Despesas Adm", kind: "leaf" },
    ]},
    { label: "Despesas Marketing & Vendas", kind: "child", children: [
      { label: "Softwares Marketing & Vendas", kind: "leaf" },
      { label: "Agências & Consultorias", kind: "leaf" },
      { label: "Campanhas de Mídia Paga", kind: "leaf" },
      { label: "Campanhas de Outros Canais", kind: "leaf" },
      { label: "Comissões Consultores / Parceiros", kind: "leaf" },
      { label: "Eventos e Feiras", kind: "leaf" },
      { label: "Viagens & Transportes Mkt", kind: "leaf" },
      { label: "Outras Despesas Mkt", kind: "leaf" },
    ]},
    { label: "Financeiras", kind: "child", children: [
      { label: "(-) Juros", kind: "leaf" },
      { label: "(-) IOF", kind: "leaf" },
      { label: "(-) Depesas Financeiras", kind: "leaf" },
    ]},
    { label: "Devoluções", kind: "child" },
  ]},
  { label: "Fluxo de Caixa Operacional", kind: "total" },
  { label: "Investimentos", kind: "header", children: [
    { label: "(-) Compra de Equipamentos", kind: "child" },
    { label: "(-) Investimentos em Estrutura", kind: "child" },
    { label: "(-) Compra de Participação", kind: "child" },
    { label: "Depósitos e Caução", kind: "child" },
  ]},
  { label: "Financiamento", kind: "header", children: [
    { label: "(+) Novos Empréstimos & Financiamentos", kind: "child" },
    { label: "(-) Amortização de Financiamentos", kind: "child" },
    { label: "Antecipação da Receita", kind: "child" },
    { label: "Abatimento de Antecipação da Receita", kind: "child" },
    { label: "(-) Rodada de Investimentos", kind: "child" },
  ]},
  { label: "Fluxo Livre", kind: "total" },
  { label: "Cashburn 12M", kind: "total" },
];

export const flattenLabels = (nodes: Node[]): string[] =>
  nodes.flatMap((n) => [n.label, ...(n.children ? flattenLabels(n.children) : [])]);

/* --------------------------- colunas da base --------------------------- */
const MES_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export type Coluna = { col: string; ano: number; mes: number };

/** "Jan-24" → { ano: 2024, mes: 1 }. Devolve null para "Conta" e afins. */
export function parseColuna(col: string): Coluna | null {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(col.trim());
  if (!m) return null;
  const mes = MES_ABBR.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (mes < 0) return null;
  return { col, ano: 2000 + Number(m[2]), mes: mes + 1 };
}

export const colunasDe = (columns: string[]): Coluna[] =>
  columns.map(parseColuna).filter(Boolean) as Coluna[];

/* ----------------------------- leitura ----------------------------- */
export type LinhaBase = Record<string, string | number | null>;

/** Índice rótulo → linha, tolerante a acento e caixa (a base tem "Encargos sociais"
 *  em um lugar e "Encargos Sociais" em outro; sem isso viraria zero silencioso). */
export function indexar(rows: LinhaBase[]): Map<string, LinhaBase> {
  const m = new Map<string, LinhaBase>();
  for (const r of rows) {
    const conta = String(r["Conta"] ?? "").trim();
    if (conta) m.set(normalize(conta), r);
  }
  return m;
}

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export const valorBruto = (idx: Map<string, LinhaBase>, label: string, col: string): number =>
  num(idx.get(normalize(label))?.[col]);

/**
 * Valor de um nó numa coluna. Nó com filhos SOMA os filhos (mesma regra das
 * páginas DRE/DFC — se lesse a própria linha, os três ecrãs divergiriam).
 */
export function valorDoNo(idx: Map<string, LinhaBase>, node: Node, col: string): number {
  if (!node.children?.length) return valorBruto(idx, node.src ?? node.label, col);
  return node.children.reduce((s, c) => s + valorDoNo(idx, c, col), 0);
}

/** Soma de um nó ao longo de várias colunas (ano cheio, YTD, trimestre…). */
export const valorNoPeriodo = (idx: Map<string, LinhaBase>, node: Node, cols: Coluna[]): number =>
  cols.reduce((s, c) => s + valorDoNo(idx, node, c.col), 0);

/**
 * Último mês com dado de verdade. A base costuma trazer o mês em aberto com
 * meia dúzia de linhas soltas (ex.: Jul-26 com "Receita Bruta = 1"), que
 * entraria no gráfico como um tombo falso. Vale o mês cujo preenchimento
 * chega a metade do mês mais cheio.
 */
export function ultimoMesFechado(rows: LinhaBase[], cols: Coluna[]): Coluna | null {
  if (!cols.length) return null;
  const preenchimento = cols.map((c) => rows.filter((r) => num(r[c.col]) !== 0).length);
  const cheio = Math.max(...preenchimento);
  if (!cheio) return null;
  for (let i = cols.length - 1; i >= 0; i--) if (preenchimento[i] >= cheio * 0.5) return cols[i];
  return null;
}

/* --------------------------- variação (Δ) ---------------------------
 * O rodapé do relatório promete: "em rubricas de despesa o Δ compara o módulo
 * (↑ = gastou mais)". Rubrica de despesa é a que desce de um bloco "(-)".
 * Resultado (EBITDA, Lucro) é comparado com sinal: cair de +60k para -107k é
 * uma queda, não um "gastou 279% a mais". */
export type Variacao = { pct: number; pp?: number; sobe: boolean; bom: boolean } | null;

export function variacao(velho: number, novo: number, opts: { despesa?: boolean; percentual?: boolean } = {}): Variacao {
  if (opts.percentual) {
    const pp = (novo - velho) * 100;
    if (!Number.isFinite(pp)) return null;
    return { pct: 0, pp, sobe: pp >= 0, bom: pp >= 0 };
  }
  if (!velho) return null;
  if (opts.despesa) {
    const pct = (Math.abs(novo) - Math.abs(velho)) / Math.abs(velho);
    return { pct, sobe: pct >= 0, bom: pct < 0 }; // gastar mais é ruim
  }
  const pct = (novo - velho) / Math.abs(velho);
  return { pct, sobe: pct >= 0, bom: pct >= 0 };
}

/** Marca cada rótulo que desce de um bloco "(-)" — as rubricas de despesa. */
export function rotulosDeDespesa(nodes: Node[], herdado = false, acc = new Set<string>()): Set<string> {
  for (const n of nodes) {
    const ehDespesa = herdado || n.label.trim().startsWith("(-)");
    if (ehDespesa) acc.add(n.label);
    if (n.children) rotulosDeDespesa(n.children, ehDespesa, acc);
  }
  return acc;
}
