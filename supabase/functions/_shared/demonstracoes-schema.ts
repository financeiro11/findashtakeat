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
  { label: "(+/-) Resultado Financeiro", kind: "header", children: [
    { label: "(-) Depreciação & Amortização", kind: "child" },
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

/** Total que é soma móvel de 12 meses do Fluxo Livre — propaga para a frente. */
export const CASHBURN = "Cashburn 12M";

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
  const blocoTopo = ancestrais[0];
  return { ancestrais, totais: blocoTopo ? (TOTAIS_POR_BLOCO[tipo][blocoTopo] ?? []) : [] };
}
