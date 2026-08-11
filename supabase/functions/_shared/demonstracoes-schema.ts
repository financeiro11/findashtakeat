/* ============================================================================
 * Hierarquia da DRE e da DFC — ESPELHO de src/lib/demonstracoes-schema.ts.
 *
 * Existe porque o valor manual (ver valores-manuais.ts) precisa saber, para uma
 * rubrica qualquer, QUEM ela soma: os blocos acima dela e as linhas de total que
 * ela alimenta. Isso é hierarquia, e hierarquia mora no esquema — não no blob,
 * que é plano.
 *
 * Edge Function é Deno e não enxerga `src/`, então a lista é copiada. Para a
 * cópia não envelhecer em silêncio, src/lib/demonstracoes-schema.test.ts compara
 * os dois arquivos e quebra se divergirem. Mexeu num, mexe no outro.
 * ========================================================================== */

export type Kind = "header" | "child" | "leaf" | "total" | "percent";
export type Node = {
  label: string;
  kind: Kind;
  src?: string;
  pctOf?: string;
  /* Outros nomes sob os quais esta MESMA rubrica pode estar gravada no blob —
     ver o comentário no espelho src/lib/demonstracoes-schema.ts. */
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

/* ---------------------------------------------------------------------------
 * Quais TOTAIS cada bloco de topo alimenta.
 *
 * É a mesma cascata que o omie-sync calcula do zero a cada sync
 * (Receita Líquida → Margem de contribuição → EBITDA → Lucro Líquido): mexeu numa
 * rubrica de custo, mexeu na margem, no EBITDA e no lucro — não só na margem.
 * ------------------------------------------------------------------------- */

const RL = "Receita Líquida";
const MC = "Margem de contribuição";
const EB = "EBITDA";
const LL = "Lucro Líquido";
const FCO = "Fluxo de Caixa Operacional";
const FL = "Fluxo Livre";

const TOTAIS_POR_BLOCO: Record<"dre" | "dfc", Record<string, string[]>> = {
  dre: {
    "Receita Bruta": [RL, MC, EB, LL],
    "(-) Deduções da receita": [RL, MC, EB, LL],
    "(-) Custos Operacionais": [MC, EB, LL],
    "(-) SG&A": [EB, LL],
    // Linha de topo sem filhos: precisa de entrada própria desde que saiu de
    // dentro do resultado financeiro, senão a depreciação digitada à mão volta a
    // não derrubar o Lucro Líquido — que é o item 1 de valores-manuais.ts.
    "(-) Depreciação & Amortização": [LL],
    "(+/-) Resultado Financeiro": [LL],
    "(+/-) Resultado Não Operacional": [LL],
    "(-) Impostos": [LL],
  },
  dfc: {
    "Entradas Operacionais": [FCO, FL],
    "Saídas Operacionais": [FCO, FL],
    "Investimentos": [FL],
    "Financiamento": [FL],
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

/* ---------------------------------------------------------------------------
 * A CASCATA — o que cada linha de TOTAL soma.
 *
 * Bloco (nó com filhos) já se sabe somar sozinho pela árvore. Total não tem
 * filho: "EBITDA" é uma linha solta no esquema, e sem esta tabela ele seria um
 * número que só existe porque alguém escreveu. Aqui está a conta.
 *
 * As parcelas entram com o SINAL que já têm no blob — "(-) Custos Operacionais"
 * é negativo, então a margem é uma soma, não uma subtração. Mesma convenção do
 * tracker, do omie-sync e de `TOTAIS_POR_BLOCO` acima.
 *
 * A PRIMEIRA parcela é a âncora: sem ela o total não existe (mês vazio não ganha
 * um Lucro Líquido feito só de imposto). `derivadas.ts` aplica essa regra.
 *
 * ESPELHADA em src/lib/demonstracoes-schema.ts — `derivadas.test.ts` compara as
 * duas cópias e quebra se alguém mexer só de um lado.
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

const chave = (s: string) => (s ?? "").trim().toLowerCase();

/**
 * Onde um ajuste na `rubrica` precisa repercutir: os blocos acima dela e os
 * totais do seu bloco de topo. Rubrica fora do esquema devolve listas vazias —
 * ajuste solto não inventa total.
 */
export function alvosDoAjuste(
  tipo: "dre" | "dfc",
  rubrica: string,
): { ancestrais: string[]; totais: string[] } {
  const schema = tipo === "dre" ? DRE_SCHEMA : DFC_SCHEMA;
  const alvo = chave(rubrica);

  const buscar = (nodes: Node[], caminho: string[]): string[] | null => {
    for (const n of nodes) {
      if (chave(n.label) === alvo) return caminho;
      if (n.children?.length) {
        const r = buscar(n.children, [...caminho, n.label]);
        if (r) return r;
      }
    }
    return null;
  };

  const ancestrais = buscar(schema, []);
  if (!ancestrais) return { ancestrais: [], totais: [] };
  /* Rubrica que JÁ é linha de topo (a depreciação, desde que saiu de dentro do
     resultado financeiro) tem caminho vazio: o bloco de topo dela é ela mesma.
     Sem o `?? rubrica` o valor manual digitado ali não repercutiria em nada. */
  const blocoTopo = ancestrais[0] ?? schema.find((n) => chave(n.label) === alvo)?.label;
  return { ancestrais, totais: blocoTopo ? (TOTAIS_POR_BLOCO[tipo][blocoTopo] ?? []) : [] };
}
