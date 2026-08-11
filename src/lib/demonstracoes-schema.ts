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
  /* Outros nomes sob os quais esta MESMA rubrica pode estar gravada no blob.
     A DFC do tracker e o DE_PARA do Omie batizaram várias linhas de formas
     diferentes ("Entradas" × "Entradas Operacionais", "Antecipação" ×
     "Antecipação da Receita"), e o que não casa por rótulo some da tela. A
     leitura tenta `label` primeiro e cai nos apelidos — nunca soma os dois,
     senão o mês em que as duas grafias existem contaria em dobro. */
  alias?: string[];
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
  { label: "% Margem de contribuição", kind: "percent", src: "Margem de contribuição", pctOf: "Receita Líquida" },
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
  { label: "% Margem EBITDA", kind: "percent", src: "EBITDA", pctOf: "Receita Líquida" },
  /* Linhas de memória: somam ao EBITDA os eventos que não se repetem e NÃO
     mexem em nada abaixo delas. O Lucro Líquido continua saindo do EBITDA
     contábil — ajustar o resultado do exercício com opinião sobre recorrência
     seria outra coisa, e não é o que se assina. Ver a migration
     20260806190000 e _shared/ebitda-ajustado.ts. */
  { label: "(+) Ajustes de EBITDA", kind: "child" },
  { label: "EBITDA Ajustado", kind: "total" },
  { label: "% Margem EBITDA Ajustado", kind: "percent", src: "EBITDA Ajustado", pctOf: "Receita Líquida" },
  /* D&A é IRMÃ do resultado financeiro, não filha dele. A fórmula do Lucro
     Líquido no tracker soma as duas separadamente — `=SOMA(AJ74;AJ77:AJ78;…)`,
     onde 77 é a depreciação e 78 é o resultado financeiro — e a linha gravada
     de "Resultado Financeiro" é só Juros + IOF + Receita financeira (confere em
     todos os meses de 2026). Aninhada, a tela somava a depreciação dentro dela e
     mostrava R$ 6.617 onde o tracker diz R$ 12.105. */
  { label: "(-) Depreciação & Amortização", kind: "child" },
  { label: "(+/-) Resultado Financeiro", kind: "header", children: [
    { label: "(-) Juros", kind: "child" },
    { label: "(-) IOF", kind: "child" },
    { label: "(+) Receita financeira", kind: "child" },
  ]},
  { label: "(+/-) Resultado Não Operacional", kind: "header", children: [
    { label: "(+) Resultado Não Operacional", kind: "child" },
    { label: "Despesas Não Operacionais", kind: "child" },
    { label: "(-) Estorno de Compras", kind: "child" },
  ]},
  { label: "(-) Impostos", kind: "header", children: [
    { label: "IRPJ", kind: "child" },
    { label: "CSLL", kind: "child" },
    { label: "IRF", kind: "child" },
  ]},
  { label: "Lucro Líquido", kind: "total" },
  { label: "% Margem Líquida", kind: "percent", src: "Lucro Líquido", pctOf: "Receita Líquida" },
];

// A ordem dos blocos de topo é fixa (usada pelos KPIs):
//   Entradas · Saídas · FCO · Investimentos · Financiamento · Fluxo Livre · Cashburn
export const DFC_SCHEMA: Node[] = [
  { label: "Entradas Operacionais", kind: "header", alias: ["Entradas"], children: [
    { label: "Receita de Assinaturas", kind: "child" },
    { label: "Receita com Materiais", kind: "child" },
    { label: "Receita Markup", kind: "child" },
    { label: "Receita de Serviços", kind: "child" },
    { label: "Entrada de Receita", kind: "child" },
    /* Antecipação de recebível entra e sai do CAIXA operacional — é onde o
       tracker a lança. Antes morava em Financiamento com outro nome, e as
       entradas de 2024 (R$ 26,7 mil + 50,3 mil + 93,3 mil) não apareciam. */
    { label: "Antecipação da Receita", kind: "child", alias: ["Antecipação"] },
    { label: "(+) Receita financeira", kind: "child" },
  ]},
  { label: "Saídas Operacionais", kind: "header", alias: ["Saídas"], children: [
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
      /* Existe no tracker desde sempre e faltava aqui: jan–mar/26 tinham
         R$ 27,7 mil que não apareciam em lugar nenhum da DFC. */
      { label: "Equipe Parcerias", kind: "leaf" },
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
    /* "Atencipação" é typo do tracker, e é assim que a linha está gravada. */
    { label: "Abatimento de Antecipação da Receita", kind: "child", alias: ["Abatimento de Atencipação"] },
  ]},
  { label: "Fluxo de Caixa Operacional", kind: "total" },
  { label: "Investimentos", kind: "header", alias: ["Fluxo de Caixa de Investimentos"], children: [
    /* O tracker lança o não operacional AQUI, não nas entradas. Estava do
       outro lado e inflava o fluxo operacional (R$ 12,8 mil em jul/26). */
    { label: "(+) Resultado Não Operacional", kind: "child" },
    { label: "(-) Compra de Equipamentos", kind: "child" },
    { label: "(-) Investimentos em Estrutura", kind: "child" },
    { label: "(-) Compra de Participação", kind: "child" },
    { label: "Depósitos e Caução", kind: "child" },
  ]},
  { label: "Financiamento", kind: "header", alias: ["Fluxo de Financiamento"], children: [
    { label: "(+) Novos Empréstimos & Financiamentos", kind: "child" },
    { label: "(-) Amortização de Financiamentos", kind: "child" },
    { label: "(-) Rodada de Investimentos", kind: "child" },
  ]},
  { label: "Fluxo Livre", kind: "total", alias: ["Fluxo de Caixa Livre"] },
  /* Queima do MÊS, não janela de 12 meses: é o fluxo livre sem a captação
     extraordinária. Ver o comentário de CASHBURN. */
  { label: "Cashburn", kind: "total" },
];

export const flattenLabels = (nodes: Node[]): string[] =>
  nodes.flatMap((n) => [n.label, ...(n.children ? flattenLabels(n.children) : [])]);

/* ---------------------------------------------------------------------------
 * A CASCATA — o que cada linha de TOTAL soma.
 *
 * Bloco (nó com filhos) já se sabe somar sozinho pela árvore. Total não tem
 * filho: "EBITDA" é uma linha solta no esquema, e sem esta tabela ele seria um
 * número que só existe porque alguém escreveu. Aqui está a conta.
 *
 * As parcelas entram com o SINAL que já têm no blob — "(-) Custos Operacionais"
 * é negativo, então a margem é uma soma, não uma subtração. Mesma convenção do
 * tracker, do omie-sync e de `TOTAIS_POR_BLOCO`.
 *
 * A PRIMEIRA parcela é a âncora: sem ela o total não existe (mês vazio não ganha
 * um Lucro Líquido feito só de imposto). `derivadas.ts` aplica essa regra.
 *
 * ESPELHA supabase/functions/_shared/demonstracoes-schema.ts — `derivadas.test.ts`
 * compara as duas cópias e quebra se alguém mexer só de um lado.
 * ------------------------------------------------------------------------- */
export const CASCATA: Record<"dre" | "dfc", Record<string, string[]>> = {
  dre: {
    "Receita Líquida": ["Receita Bruta", "(-) Deduções da receita"],
    "Margem de contribuição": ["Receita Líquida", "(-) Custos Operacionais"],
    "EBITDA": ["Margem de contribuição", "(-) SG&A"],
    "EBITDA Ajustado": ["EBITDA", "(+) Ajustes de EBITDA"],
    /* É literalmente a fórmula da célula no tracker — `=SOMA(AJ74; AJ77:AJ78;
       AJ82:AJ85)`: EBITDA, depreciação, resultado financeiro e, no último
       intervalo, o bloco não operacional inteiro mais a linha de impostos. */
    "Lucro Líquido": [
      "EBITDA",
      "(-) Depreciação & Amortização",
      "(+/-) Resultado Financeiro",
      "(+/-) Resultado Não Operacional",
      "(-) Impostos",
    ],
  },
  dfc: {
    "Fluxo de Caixa Operacional": ["Entradas Operacionais", "Saídas Operacionais"],
    "Fluxo Livre": ["Fluxo de Caixa Operacional", "Investimentos", "Financiamento"],
  },
};

/* A queima do MÊS: fluxo livre menos a captação extraordinária. Um mês em que
   entrou R$ 1,6 M de empréstimo tem fluxo livre positivo e queima de meio
   milhão — é a queima que diz quanto tempo o caixa aguenta. Régua do tracker
   (confere nos 7 meses de 2026) e a mesma que o Dashboard já usava. Antes daqui
   era soma móvel de 12 meses do fluxo livre, que somava os empréstimos e dava
   jul/26 POSITIVO em +309 mil onde a queima do mês foi de 511 mil. */
export const CASHBURN = "Cashburn";
export const NOVOS_EMPRESTIMOS = "(+) Novos Empréstimos & Financiamentos";
/** Fluxo livre − captação extraordinária, com a leitura de quem chama. */
export const cashburnDoMes = (
  fluxoLivre: number | null,
  novosEmprestimos: number | null,
): number | null => (fluxoLivre == null ? null : fluxoLivre - (novosEmprestimos ?? 0));

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

/**
 * A chave de `n` meses atrás: "Jul-26" com n=1 → "Jun-26".
 *
 * Anda em meses absolutos (ano×12 + mês) em vez de mexer no `Date`: a chave não
 * tem dia, e `new Date(2026,6,31)` recuado um mês daria 01/07 de volta.
 */
export function mesAtras(col: string, n = 1): string | null {
  const c = parseColuna(col);
  if (!c) return null;
  const i = c.ano * 12 + (c.mes - 1) - n;
  if (i < 0) return null;
  return `${MES_ABBR[i % 12]}-${String(Math.floor(i / 12) % 100).padStart(2, "0")}`;
}

/** "Jul-26" → "Jul 26", para caber em chip e cabeçalho de coluna. */
export function mesCurto(col: string): string {
  const c = parseColuna(col);
  return c ? `${MES_PT[c.mes - 1]} ${String(c.ano % 100).padStart(2, "0")}` : col;
}

/* ----------------------------- leitura ----------------------------- */
export type LinhaBase = Record<string, string | number | null>;

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Chave de rubrica: ignora acento e caixa — a base escreve "Encargos sociais" e
 * "Encargos Sociais" para a mesma coisa — mas PRESERVA `%`, `+` e `-`, que são
 * o que distingue rubricas de verdade. O `normalize` genérico derruba esses
 * sinais e fazia "% Margem de contribuição" colidir com "Margem de
 * contribuição": a linha de percentual sobrescrevia a de reais e a margem
 * aparecia como "73" em vez de R$ 182 mil.
 */
export const chaveRubrica = (s: string): string =>
  (s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9%+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Índice rótulo → linha. Duas grafias da mesma rubrica são SOMADAS, nunca
 *  sobrescritas — descartar uma delas seria perder dinheiro em silêncio. */
export function indexar(rows: LinhaBase[]): Map<string, LinhaBase> {
  const m = new Map<string, LinhaBase>();
  for (const r of rows) {
    const conta = String(r["Conta"] ?? "").trim();
    if (!conta) continue;
    const k = chaveRubrica(conta);
    const atual = m.get(k);
    if (!atual) { m.set(k, { ...r }); continue; }
    const somado: LinhaBase = { ...atual };
    for (const col of Object.keys(r)) {
      if (col === "Conta") continue;
      somado[col] = num(atual[col]) + num(r[col]);
    }
    m.set(k, somado);
  }
  return m;
}

export const valorBruto = (idx: Map<string, LinhaBase>, label: string, col: string): number =>
  num(idx.get(chaveRubrica(label))?.[col]);

/**
 * Célula do blob → número, PRESERVANDO o vazio.
 *
 * Diferente do `num` acima, que devolve 0: aqui "não existe" continua null,
 * porque nas telas de DRE/DFC ele vira "—", e "—" e "R$ 0,00" dizem coisas
 * diferentes para quem está auditando.
 */
export function celulaNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  s = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? null : (neg ? -n : n);
}

/**
 * Índice das telas de DRE e DFC: rótulo (sem caixa) → { mês → valor }.
 *
 * Duas grafias da mesma rubrica são SOMADAS, nunca sobrescritas — a mesma regra
 * do `indexar`, e pelo mesmo motivo. O blob tem os dois lados: o import do
 * tracker escreve "Outras despesas Adm" e o DE_PARA do Omie escreve "Outras
 * Despesas Adm". Com sobrescrita, a linha que vinha por último apagava a outra e
 * o mês que existia só numa delas aparecia VAZIO na tela — foi o que aconteceu
 * com Jul/26 na DFC, com 54 lançamentos e R$ 26 mil por trás do "—".
 */
export function indexarCelulas(
  rows: Record<string, unknown>[],
  columns: string[],
): Map<string, Record<string, number | null>> {
  const map = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    const labelKey = Object.keys(r).find((k) => !/^[A-Za-z]{3}-\d{2}$/.test(k));
    const label = labelKey ? String(r[labelKey] ?? "").trim() : "";
    if (!label) continue;

    const chave = label.toLowerCase();
    const atual = map.get(chave);
    if (!atual) {
      const obj: Record<string, number | null> = {};
      for (const c of columns) obj[c] = celulaNumero(r[c]);
      map.set(chave, obj);
      continue;
    }
    // Soma célula a célula: vazio + vazio segue vazio, para o "—" não virar zero.
    for (const c of columns) {
      const a = atual[c];
      const b = celulaNumero(r[c]);
      atual[c] = a == null && b == null ? null : (a ?? 0) + (b ?? 0);
    }
  }
  return map;
}

/** Todos os nomes sob os quais a rubrica pode estar gravada — o de verdade primeiro. */
export const rotulosDoNo = (n: Node): string[] => [n.src ?? n.label, ...(n.alias ?? [])];

/**
 * Primeira leitura NÃO NULA entre os nomes do nó. Nunca soma dois nomes: num mês
 * em que o tracker gravou "Entradas" e o omie-sync gravou "Entradas
 * Operacionais", somar contaria a mesma coisa duas vezes.
 */
export function valorComAlias(node: Node, ler: (rotulo: string) => number | null): number | null {
  for (const r of rotulosDoNo(node)) {
    const v = ler(r);
    if (v != null) return v;
  }
  return null;
}

/**
 * Valor de um nó numa coluna. Nó com filhos SOMA os filhos (mesma regra das
 * páginas DRE/DFC — se lesse a própria linha, os três ecrãs divergiriam).
 */
export function valorDoNo(idx: Map<string, LinhaBase>, node: Node, col: string): number {
  if (!node.children?.length) return valorComAlias(node, (r) => valorBruto(idx, r, col)) ?? 0;
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
