// Catálogo de fontes do Hub — o mapa que o Assistente usa para achar dado fora do DRE.
//
// POR QUE UM CATÁLOGO, E NÃO SQL LIVRE GERADO PELO MODELO:
// SQL escrito por modelo cobre tudo, mas ninguém consegue conferir o que ele somou. Aqui
// o modelo só ESCOLHE uma fonte e parâmetros; quem monta a consulta é o código, contra
// uma lista fechada de tabelas e colunas. O modelo não inventa join, não inventa filtro
// e não alcança tabela que não esteja aqui.
//
// COMO CRESCER: acrescente uma entrada. Não é preciso escrever código novo — o explorador
// genérico (consultas.ts) trata qualquer fonte descrita aqui. É por isso que o catálogo é
// dado e não função.
//
// SEGURANÇA: a leitura roda com o token do usuário que perguntou, então a RLS de cada
// tabela continua valendo. "Acesso a todo o Hub" significa, na prática, acesso a tudo que
// AQUELA PESSOA já poderia abrir na tela — nada além.
//
// PRECISÃO: as colunas abaixo foram extraídas do schema real (src/integrations/supabase/
// types.ts). Coluna que não existe faz a consulta falhar em vez de mentir, mas o certo é
// conferir contra o types.ts ao editar.

export type Fonte = {
  /** Nome exato da tabela ou view. */
  id: string;
  /** Área do Hub, para o modelo entender do que se trata. */
  area: string;
  /** Uma frase: o que esta tabela guarda. Vai no prompt do roteador. */
  descricao: string;
  /** Coluna de data usada para filtrar período. */
  data?: string;
  /** Coluna numérica que faz sentido somar. */
  valor?: string;
  /** Colunas categóricas por onde agrupar ("por responsável", "por status"). */
  dimensoes: string[];
  /** Colunas trazidas ao listar linhas individuais. */
  listar: string[];
};

export const CATALOGO: Fonte[] = [
  {
    id: "tarefas",
    area: "Time Financeiro",
    descricao: "Tarefas do time: título, responsável, status, prioridade e prazo.",
    data: "prazo",
    dimensoes: ["responsavel", "status", "prioridade", "cat_area", "cat_natureza"],
    listar: ["titulo", "responsavel", "status", "prioridade", "prazo"],
  },
  {
    id: "auditoria",
    area: "Governança",
    descricao:
      "Achados de auditoria (exceções detectadas por regra), com severidade, responsável, " +
      "competência e valor. NÃO é o razão contábil: só o que fugiu do padrão.",
    data: "data_lancamento",
    valor: "valor",
    dimensoes: ["area", "regra", "severidade", "status", "responsavel", "categoria", "competencia"],
    listar: ["titulo", "area", "severidade", "status", "responsavel", "valor", "competencia"],
  },
  {
    id: "cartao_lancamentos",
    area: "Cartão de Crédito",
    descricao: "Lançamentos do cartão: estabelecimento, categoria, cidade, parcela e valor.",
    data: "data",
    valor: "valor",
    dimensoes: ["estabelecimento", "categoria", "cidade", "tipo", "competencia"],
    listar: ["data", "estabelecimento", "categoria", "valor", "parcela", "competencia"],
  },
  {
    id: "facilities_solicitacoes",
    area: "Facilities",
    descricao: "Solicitações de compra: título, solicitante, categoria, status e valor.",
    data: "created_at",
    valor: "valor",
    dimensoes: ["categoria", "status", "solicitante", "decidido_por"],
    listar: ["titulo", "solicitante", "categoria", "status", "valor"],
  },
  {
    id: "facilities_contratos",
    area: "Facilities",
    descricao: "Contratos recorrentes com fornecedores.",
    dimensoes: ["status"],
    listar: ["id"],
  },
  {
    id: "parceiros_indicacoes",
    area: "Parceiros",
    descricao:
      "Indicações de parceiros e embaixadores: indicador, campanha, canal, MRR gerado e " +
      "valor total do negócio.",
    data: "data_indicacao",
    valor: "valor_total",
    dimensoes: ["indicador", "nome_campanha", "canal_aquisicao", "origem", "vendedor", "responsavel_takeat"],
    listar: ["indicador", "nome_negocio", "nome_campanha", "mrr", "valor_total", "data_venda"],
  },
  {
    id: "editais",
    area: "Radar de Editais",
    descricao:
      "Editais e chamadas de fomento captados: órgão, modalidade, prazo, valor estimado, " +
      "estágio no pipeline e score de relevância.",
    data: "prazo_envio",
    valor: "valor_estimado",
    dimensoes: ["orgao", "fonte", "modalidade", "status", "pipeline_stage", "regiao", "prioridade", "responsavel"],
    listar: ["titulo", "orgao", "modalidade", "prazo_envio", "valor_estimado", "pipeline_stage"],
  },
  {
    id: "projetos_aprovados",
    area: "Radar de Editais",
    descricao: "Projetos de fomento já aprovados: órgão, valor aprovado, contrapartida e prazo.",
    data: "data_inicio",
    valor: "valor_aprovado",
    dimensoes: ["orgao", "status"],
    listar: ["nome", "orgao", "valor_aprovado", "valor_contrapartida", "prazo_final", "status"],
  },
  {
    id: "recargas_viagens",
    area: "Recargas",
    descricao: "Viagens lançadas, com valor total por evento.",
    data: "data",
    valor: "valor_total",
    dimensoes: [],
    listar: ["data", "valor_total", "observacao"],
  },
  {
    id: "recargas_celulares",
    area: "Recargas",
    descricao: "Recargas de celular do time.",
    dimensoes: [],
    listar: ["id"],
  },
  {
    id: "lib_colaboradores",
    area: "Biblioteca",
    descricao: "Cadastro de colaboradores: nome, e-mail, telefone e cargo.",
    dimensoes: ["cargo_id"],
    listar: ["nome", "email", "telefone"],
  },
  {
    id: "lib_fornecedores",
    area: "Biblioteca",
    descricao: "Cadastro de fornecedores da empresa.",
    dimensoes: [],
    listar: ["nome"],
  },
  {
    id: "historico_financeiro",
    area: "Financeiro",
    descricao:
      "Série histórica de métricas financeiras por mês (metrica, ano, mes, valor). Usada " +
      "como complemento do DRE para métricas que não são rubrica.",
    valor: "valor",
    dimensoes: ["metrica", "origem", "ano", "mes"],
    listar: ["metrica", "ano", "mes", "valor", "origem"],
  },
  {
    id: "omie_caixa_snapshot",
    area: "Caixa",
    descricao: "Fotos do caixa vindas do Omie.",
    dimensoes: [],
    listar: ["id"],
  },
  {
    id: "ai_usage_log",
    area: "Governança",
    descricao: "Consumo de IA no Hub: modelo, funcionalidade, tokens e custo em dólar.",
    data: "created_at",
    valor: "cost_usd",
    dimensoes: ["model", "feature"],
    listar: ["created_at", "model", "feature", "total_tokens", "cost_usd"],
  },
];

/** Bloco de fontes para o prompt do roteador. Só id, área e descrição — nada de colunas. */
export function catalogoParaPrompt(): string {
  const porArea = new Map<string, Fonte[]>();
  for (const f of CATALOGO) {
    const lista = porArea.get(f.area) ?? [];
    lista.push(f);
    porArea.set(f.area, lista);
  }
  return [...porArea.entries()]
    .map(([area, fontes]) =>
      `${area}:\n` + fontes.map((f) => `  - ${f.id}: ${f.descricao}`).join("\n"))
    .join("\n");
}

export function acharFonte(id: string): Fonte | null {
  return CATALOGO.find((f) => f.id === id) ?? null;
}
