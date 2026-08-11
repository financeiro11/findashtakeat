// Árvore de rubricas do DRE para o Assistente.
//
// ESPELHA src/lib/demonstracoes-schema.ts (DRE_SCHEMA). Está duplicado porque aquele
// arquivo é do bundle do browser e este roda em Deno, sem build compartilhado entre os
// dois. Se as rubricas mudarem lá, mudam aqui — e a conferência de soma em consultas.ts
// detecta a divergência (os filhos deixam de reproduzir o total) em vez de deixar passar
// uma análise silenciosamente errada.
//
// A REGRA QUE ESTA ÁRVORE EXISTE PARA APLICAR: nó com filhos vale a SOMA DOS FILHOS,
// nunca o valor gravado na própria linha. O blob guarda um número para "Pessoal" e para
// "(-) SG&A", mas o omie-sync atualiza só as folhas e deixa o pai para trás — em mês
// destravado o pai é lixo (o caso registrado no repo: Pessoal guardado −69.054 contra
// −557.477 somando as equipes). Ler o pai era o bug.

export type Kind = "header" | "child" | "leaf" | "total" | "percent";

export type No = {
  label: string;
  kind: Kind;
  /** Rótulo real no blob, quando diferente de `label`. */
  src?: string;
  children?: No[];
};

export const DRE_SCHEMA: No[] = [
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
  // Irmã, não filha: o tracker soma depreciação e resultado financeiro em
  // parcelas separadas. Ver o comentário em _shared/demonstracoes-schema.ts.
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
];

/** Localiza um nó pelo rótulo, em qualquer profundidade. */
export function acharNo(label: string, nodes: No[] = DRE_SCHEMA): No | null {
  for (const n of nodes) {
    if (n.label === label) return n;
    const dentro = n.children ? acharNo(label, n.children) : null;
    if (dentro) return dentro;
  }
  return null;
}

/** Todas as folhas abaixo de um nó (o próprio nó, se não tiver filhos). */
export function folhasDe(node: No): No[] {
  if (!node.children?.length) return [node];
  return node.children.flatMap(folhasDe);
}

/** Todos os rótulos da árvore, em ordem de leitura. */
export function todosRotulos(nodes: No[] = DRE_SCHEMA): string[] {
  return nodes.flatMap((n) => [n.label, ...(n.children ? todosRotulos(n.children) : [])]);
}

/**
 * Rubricas que descem de um bloco "(-)" — despesas e custos.
 *
 * Usado para saber o efeito de uma variação sobre o resultado: uma despesa que sobe
 * derruba o EBITDA, uma receita que sobe levanta.
 */
export function rotulosDeDespesa(nodes: No[] = DRE_SCHEMA, herdado = false, acc = new Set<string>()): Set<string> {
  for (const n of nodes) {
    const ehDespesa = herdado || n.label.trim().startsWith("(-)");
    if (ehDespesa) acc.add(n.label);
    if (n.children) rotulosDeDespesa(n.children, ehDespesa, acc);
  }
  return acc;
}
