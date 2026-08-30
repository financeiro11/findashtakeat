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
    descricao:
      "Consumo de IA no Hub, uma linha por chamada: modelo, funcionalidade (feature), " +
      "tokens e custo em dólar. `user_id` nulo quer dizer que quem chamou foi o servidor " +
      "(cron, fila, varredura), não uma pessoa. Só tem dado a partir de 29/08/2026 — " +
      "antes disso o registro estava quebrado e a tabela ficou quatro meses vazia.",
    data: "created_at",
    valor: "cost_usd",
    dimensoes: ["model", "feature"],
    listar: ["created_at", "model", "feature", "total_tokens", "cost_usd"],
  },

  // --- Acervo de notas, contas a pagar e cobrança ---
  //
  // As quatro fontes abaixo entraram em 29/08/2026 e são as áreas onde o
  // trabalho de fato acontece: o acervo tem milhares de documentos em triagem, o
  // contas a pagar é o denominador de tudo que se cobra do ERP, e o Asaas é a
  // ponta que recebe. Sem elas o Assistente respondia sobre o Hub inteiro
  // MENOS sobre o que ocupa o dia de quem trabalha nele.
  {
    id: "notas_externas",
    area: "Notas fiscais",
    descricao:
      "Acervo de notas e comprovantes recolhidos de planilhas, e-mail e Drive. `alvo_tipo` " +
      "diz a que lançamento a nota foi casada (pix, cartao, erp) e fica NULO quando o " +
      "casador não decidiu; `conferencia` diz se o ERP já tem o arquivo; " +
      "`nao_casou_motivo` explica por que ficou sem alvo. Uma linha por documento.",
    data: "enviado_em",
    valor: "valor",
    dimensoes: [
      "fonte", "alvo_tipo", "casamento", "confianca", "conferencia",
      "nao_casou_motivo", "tipo_documento", "moeda",
    ],
    listar: ["enviado_em", "nome", "valor", "fonte", "alvo_tipo", "conferencia", "nao_casou_motivo"],
  },
  {
    id: "cap_titulos",
    area: "Contas a pagar",
    descricao:
      "Títulos do contas a pagar do Omie: fornecedor, categoria, valor, vencimento, " +
      "pagamento e quantos anexos o título já tem no ERP (`anexos_no_erp`). É a lista " +
      "contra a qual o acervo de notas é conferido. `favorecido` já vem com o apelido " +
      "da Parametrização; `favorecido_cru` é o nome como o ERP escreve.",
    data: "vencimento",
    valor: "valor",
    dimensoes: ["categoria", "conta", "status", "situacao", "favorecido", "competencia", "regra"],
    listar: ["vencimento", "favorecido", "categoria", "valor", "status", "anexos_no_erp"],
  },
  {
    id: "asaas_cache",
    area: "Recebimentos",
    descricao:
      "Espelho das cobranças do Asaas. `tipo` separa cobrança de assinatura e de nota; " +
      "`status` é a situação da cobrança; `data_credito` é quando o dinheiro entra, que " +
      "não é a mesma coisa que `data_pagamento`.",
    data: "data_vencimento",
    valor: "valor",
    dimensoes: ["tipo", "status", "forma", "ciclo", "nome"],
    listar: ["data_vencimento", "nome", "valor", "status", "forma", "data_credito"],
  },
  {
    id: "auditoria_pix_lancamentos",
    area: "Auditoria",
    descricao:
      "Lançamentos de PIX e transferência do extrato, com favorecido, categoria e se já " +
      "têm comprovante anexado. É a base da auditoria de comprovantes.",
    data: "data",
    valor: "valor",
    dimensoes: ["favorecido", "categoria", "conta_corrente", "status", "tem_comprovante"],
    listar: ["data", "favorecido", "valor", "categoria", "tem_comprovante"],
  },
  {
    id: "nfse_preparo_fila",
    area: "Notas fiscais",
    descricao:
      "Clientes cujo cadastro precisa de conserto antes de a NFS-e poder ser emitida. " +
      "`falta` diz o que está faltando e `situacao` diz em que pé está (pendente, " +
      "corrigido, bloqueado, humano).",
    data: "montada_em",
    valor: "valor",
    dimensoes: ["situacao", "falta", "motivo", "nome"],
    listar: ["montada_em", "nome", "doc", "falta", "situacao", "valor"],
  },

  // --- Facilities (completando: compras, cotações, fornecedores) ---
  {
    id: "facilities_compras",
    area: "Facilities",
    descricao: "Compras efetivadas: item, fornecedor, categoria, forma de pagamento, status da NF e valor.",
    data: "data",
    valor: "valor",
    dimensoes: ["categoria", "fornecedor_nome", "forma_pagamento", "nf_status", "pagamento_status"],
    listar: ["data", "item", "fornecedor_nome", "categoria", "valor", "pagamento_status"],
  },
  {
    id: "facilities_cotacoes",
    area: "Facilities",
    descricao: "Cotações recebidas por solicitação, com o fornecedor e se foi a escolhida.",
    data: "created_at",
    valor: "valor",
    dimensoes: ["fornecedor_nome", "escolhida"],
    listar: ["fornecedor_nome", "valor", "escolhida", "observacao"],
  },
  {
    id: "facilities_fornecedores",
    area: "Facilities",
    descricao: "Fornecedores de facilities: categoria, contato, CNPJ e se tem contrato.",
    dimensoes: ["categoria", "status", "tem_contrato"],
    listar: ["nome", "categoria", "contato", "cnpj", "status"],
  },

  // --- Parceiros (completando: cadastro e recorrências) ---
  {
    id: "parceiros_cadastro",
    area: "Parceiros",
    descricao: "Cadastro de parceiros e embaixadores: tier, campanha, método e valores de bonificação e recorrência.",
    valor: "valor_bonificacao",
    dimensoes: ["tier", "campanha", "status", "metodo_bonificacao"],
    listar: ["nome", "tier", "campanha", "status", "valor_bonificacao", "valor_recorrencia"],
  },
  {
    id: "parceiros_recorrencias",
    area: "Parceiros",
    descricao: "Contratos recorrentes trazidos por parceiros, com MRR e data de cancelamento quando houver.",
    data: "data_venda",
    valor: "mrr",
    dimensoes: ["indicador", "nome_campanha", "ativo", "responsavel_takeat"],
    listar: ["indicador", "nome_negocio", "mrr", "recorrencia_valor", "ativo", "data_cancelamento"],
  },
  {
    id: "embaixador_valores_calculados",
    area: "Parceiros",
    descricao: "Valores já calculados por embaixador e mês: bonificação, recorrência e soma.",
    valor: "soma",
    dimensoes: ["embaixador", "mes"],
    listar: ["embaixador", "mes", "bonificacao_total", "recorrencia_total", "soma"],
  },

  // --- Projetos e fomento ---
  {
    id: "projetos_aprovados_parcelas",
    area: "Radar de Editais",
    descricao: "Parcelas de projetos aprovados: previsão, recebimento e valor.",
    data: "data_prevista",
    valor: "valor",
    dimensoes: ["recebido"],
    listar: ["descricao", "numero", "data_prevista", "data_recebimento", "valor", "recebido"],
  },
  {
    id: "projetos",
    area: "Automações",
    descricao: "Projetos internos de automação: responsável, status e entrega.",
    dimensoes: ["responsavel", "status", "automacao"],
    listar: ["automacao", "descricao_entrega", "responsavel", "status"],
  },
  {
    id: "automacoes_catalogo",
    area: "Automações",
    descricao:
      "Catálogo de automações do time: dor que resolve, solução, ferramentas, esforço, " +
      "impacto, horas economizadas por mês e nível de maturidade.",
    valor: "horas_mes",
    dimensoes: ["categoria", "status", "responsavel", "nivel", "impacto", "esforco"],
    listar: ["automacao", "dor", "solucao", "responsavel", "status", "horas_mes", "nivel"],
  },

  // --- Time ---
  {
    id: "time_cargos",
    area: "Time Financeiro",
    descricao:
      "Estrutura do time por ano: cargo, pessoa, senioridade, atribuições, custo mensal e " +
      "se a vaga está preenchida ou é alvo futuro.",
    valor: "custo_mensal",
    dimensoes: ["ano", "pessoa", "senioridade", "status", "prioridade"],
    listar: ["titulo", "pessoa", "senioridade", "ano", "status", "custo_mensal"],
  },
  {
    id: "time_rituais",
    area: "Time Financeiro",
    descricao: "Rituais e cerimônias recorrentes do time financeiro.",
    dimensoes: [],
    listar: ["id"],
  },
  {
    id: "tarefas_log",
    area: "Time Financeiro",
    descricao: "Histórico de mudanças nas tarefas — quem mexeu no quê e quando.",
    dimensoes: [],
    listar: ["id"],
  },

  // --- Conhecimento e configuração ---
  {
    id: "playbooks",
    area: "Anotações",
    descricao: "Playbooks e anotações do time: título, categoria, dono e conteúdo.",
    data: "updated_at",
    dimensoes: ["category", "status", "owner_name"],
    listar: ["title", "category", "description", "owner_name", "status"],
  },
  {
    id: "base_conhecimento",
    area: "Biblioteca",
    descricao: "Base de conhecimento da empresa: documentos e políticas em texto.",
    data: "updated_at",
    dimensoes: ["tipo"],
    listar: ["titulo", "tipo", "updated_at"],
  },
  {
    id: "lib_departamentos",
    area: "Biblioteca",
    descricao: "Departamentos da empresa, com gestor e descrição.",
    dimensoes: [],
    listar: ["nome", "descricao"],
  },
  {
    id: "lib_centros_custo",
    area: "Biblioteca",
    descricao: "Centros de custo: código, nome e descrição.",
    dimensoes: [],
    listar: ["codigo", "nome", "descricao"],
  },
  {
    id: "lib_politicas",
    area: "Biblioteca",
    descricao: "Políticas internas da empresa.",
    dimensoes: [],
    listar: ["id"],
  },
  {
    id: "de_para_rules",
    area: "Configurações",
    descricao:
      "Regras DE/PARA de classificação: palavra-chave que mapeia para categoria, conta, " +
      "centro de custo e fornecedor no Omie.",
    dimensoes: ["categoria", "centro_custo", "tipo", "conta"],
    listar: ["keyword", "categoria", "conta", "centro_custo", "cliente_fornecedor"],
  },

  // --- Análise e cenários ---
  {
    id: "cenarios",
    area: "Análise Preditiva",
    descricao: "Cenários de projeção salvos, com premissas, projeção e análise.",
    data: "updated_at",
    dimensoes: ["periodo_base"],
    listar: ["nome", "descricao", "periodo_base", "meses_projecao"],
  },

  // --- Operacional ---
  {
    id: "cartao_faturas",
    area: "Cartão de Crédito",
    descricao: "Faturas de cartão importadas, por competência e data de fechamento.",
    data: "fechamento",
    dimensoes: ["competencia"],
    listar: ["mes_label", "competencia", "fechamento", "arquivo", "importado_em"],
  },
  {
    id: "recargas_viagens_itens",
    area: "Recargas",
    descricao: "Itens individuais dentro de cada viagem lançada.",
    dimensoes: [],
    listar: ["id"],
  },
  {
    id: "extratos_importados",
    area: "Caixa",
    descricao: "Extratos bancários importados manualmente para o Hub.",
    dimensoes: [],
    listar: ["id"],
  },
  {
    id: "profiles",
    area: "Configurações",
    descricao: "Usuários do Hub: nome, e-mail e cargo. O cargo controla o acesso às áreas.",
    dimensoes: ["cargo"],
    listar: ["nome", "email", "cargo"],
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
