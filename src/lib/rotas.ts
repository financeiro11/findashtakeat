// O mapa de rotas do Hub — quem é cada tela.
//
// Vivia dentro do PageHeader, que era seu único leitor. Saiu de lá quando o Assistente
// passou a precisar da MESMA informação para saber de onde a pergunta veio (ver
// ./contexto-pagina): dois mapas de rotas em arquivos diferentes divergem no primeiro
// menu novo que alguém acrescentar, e aí o cabeçalho diz uma coisa e a IA entende outra.

export const ROTAS: Record<string, { crumbs: string[]; context?: string }> = {
  "/": { crumbs: ["Início", "Dashboard"], context: "Visão consolidada · DRE + DFC" },
  "/caixa": { crumbs: ["Início", "Caixa"], context: "Panorama do caixa · Omie" },
  "/caixa/conta-corrente/sicoob": { crumbs: ["Início", "Caixa", "Conta Corrente"], context: "Extrato Sicoob" },
  "/caixa/conta-corrente/asaas": { crumbs: ["Início", "Caixa", "Conta Corrente"], context: "Extrato Asaas" },
  "/briefing": { crumbs: ["Início", "Briefing Diário"], context: "Resumo do dia · agenda · e-mails · notícias" },
  "/design-system": { crumbs: ["Início", "Design System"] },
  "/governanca/auditoria": { crumbs: ["Governança", "Auditoria"], context: "Achados do extrato · PIX e cartão" },
  "/governanca/cartao": { crumbs: ["Governança", "Cartão"], context: "Evolução da fatura · Sicoob" },
  "/orcamento": { crumbs: ["Governança", "Orçamento"], context: "Orçado × realizado · competência do Omie" },
  "/governanca/cac": { crumbs: ["Governança", "Painel CAC"], context: "Custo de aquisição por time · exporta para o sistema da controladoria" },
  "/governanca/rescisoes": { crumbs: ["Governança", "Rescisões"], context: "Acerto de saída parcela a parcela · cálculo da skill Rescisão PJ + controle do pagamento" },
  "/operacional/colaboradores": { crumbs: ["Operacional", "Colaboradores (RH)"], context: "Ficha do colaborador · espelho do Portal RH" },
  "/operacional/cartao": { crumbs: ["Operacional", "Cartão → Omie"], context: "Importar a fatura · separar parcelas · provisionar" },
  "/operacional/parceiros": { crumbs: ["Operacional", "Parceiros"], context: "Embaixadores · bonificação e recorrência" },
  "/operacional/reembolsos": { crumbs: ["Operacional", "Reembolsos"], context: "Pedidos de reembolso do time" },
  "/de-para": { crumbs: ["Configurações", "DE_PARA"], context: "Mapeamento de classificações" },
  "/usuarios": { crumbs: ["Configurações", "Usuários"] },
  "/configuracoes/parametrizacao": { crumbs: ["Configurações", "Parametrização"], context: "Apelido das contrapartes · o nome que o fornecedor tem para nós" },
  "/configuracoes/uso-ia": { crumbs: ["Configurações", "Uso IA"], context: "Custo estimado das chamadas à IA" },
  "/automacoes/proporcionais": { crumbs: ["Automações", "Proporcionais"], context: "Aprovação de salários proporcionais" },
  "/asaas": { crumbs: ["Operacional", "Asaas"], context: "Recebimentos · Assinaturas · NF-e" },
  "/assinaturas": { crumbs: ["Início", "Assinaturas"], context: "Base Asaas · MRR & carteira de clientes" },
  "/operacional/variavel": { crumbs: ["Operacional", "Variável"], context: "Comissões variáveis · fechamento mensal" },
  "/operacional/estornos": { crumbs: ["Operacional", "Estornos"], context: "Estornado no Asaas × planilha de churn · churn real do mês" },
  "/operacional/notas-fiscais": { crumbs: ["Operacional", "Notas Fiscais"], context: "Cobranças do Asaas × NFS-e do Omie · emissão em lote pela Ordem de Serviço" },
  "/investimentos": { crumbs: ["Investimentos", "Takeat LTD/LLC"], context: "Financials LTD & LLC · export do contador" },
  "/captable": { crumbs: ["Investimentos", "Captable"], context: "Sócios e participação" },
  "/playbook": { crumbs: ["Time Financeiro", "Anotações"], context: "Notas e playbook do time" },
  "/notas": { crumbs: ["Time Financeiro", "Anotações"], context: "Workspace · notas do time" },
  "/automacoes/catalogo": { crumbs: ["Automações", "Catálogo"] },
  "/automacoes/projetos": { crumbs: ["Automações", "Projetos"] },
  "/recargas/celulares": { crumbs: ["Recargas", "Celulares"] },
  "/recargas/viagens": { crumbs: ["Recargas", "Viagens"] },
  "/tarefas": { crumbs: ["Time Financeiro", "Tarefas"], context: "Gestão de tarefas do time" },
  "/time/visao": { crumbs: ["Time Financeiro", "Visão do Time"], context: "Estrutura, vagas e maturidade em IA · horizonte 1–5 anos" },
  "/editais": { crumbs: ["Radar de Editais", "Dashboard"], context: "Radar inteligente de editais" },
  "/editais/radar": { crumbs: ["Radar de Editais", "Radar"] },
  "/editais/triagem": { crumbs: ["Radar de Editais", "Triagem"] },
  "/editais/pipeline": { crumbs: ["Radar de Editais", "Pipeline"] },
  "/editais/calendario": { crumbs: ["Radar de Editais", "Calendário"] },
  "/editais/historico": { crumbs: ["Radar de Editais", "Histórico"] },
  "/editais/monitor": { crumbs: ["Radar de Editais", "Monitor"] },
  "/editais/configuracoes": { crumbs: ["Radar de Editais", "Configurações"] },
  "/editais/projetos-aprovados": { crumbs: ["Radar de Editais", "Projetos Aprovados"], context: "Executivo" },
  "/editais/projetos-aprovados/projetos": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Projetos"] },
  "/editais/projetos-aprovados/ia": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Inteligência IA"] },
  "/editais/projetos-aprovados/alertas": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Alertas"] },
  "/editais/projetos-aprovados/prestacao": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Prestação"] },
  "/editais/projetos-aprovados/config": { crumbs: ["Radar de Editais", "Projetos Aprovados", "Configurações"] },
  "/demonstracoes/dre": { crumbs: ["Demonstrações", "DRE"], context: "Demonstrativo de Resultado" },
  "/demonstracoes/dfc": { crumbs: ["Demonstrações", "DFC"], context: "Fluxo de Caixa" },
  "/apresentacoes/revisao": { crumbs: ["Apresentações", "Revisão Mensal"], context: "Reunião de tracker com o CEO" },
  "/apresentacoes/reportes": { crumbs: ["Apresentações", "Reportes"], context: "Materiais para Conselho e Investidores" },
  // Rota antiga da Revisão: continua respondendo e redireciona (ver App.tsx).
  "/demonstracoes/revisao": { crumbs: ["Apresentações", "Revisão Mensal"], context: "Reunião de tracker com o CEO" },
  "/demonstracoes/balancete": { crumbs: ["Demonstrações", "Balancete"] },
  "/demonstracoes/balanco": { crumbs: ["Demonstrações", "Balanço"] },
  "/bp/versoes": { crumbs: ["BP", "Histórico de versões"], context: "Planos importados por ano" },
  "/analise/cenarios": { crumbs: ["Análise Preditiva", "Cenários"] },
  "/analise/bp": { crumbs: ["Análise Preditiva", "BP Anual (legado)"] },
  "/analise/historico": { crumbs: ["Análise Preditiva", "Histórico Multianual"] },
  "/analise/conhecimento": { crumbs: ["Análise Preditiva", "Biblioteca"] },
  "/facilities": { crumbs: ["Facilities", "Dashboard"], context: "Visão consolidada · compras e fornecedores" },
  "/facilities/solicitacoes": { crumbs: ["Facilities", "Solicitações"], context: "Pipeline de compras" },
  "/facilities/cotacoes": { crumbs: ["Facilities", "Cotações"], context: "Comparativo de orçamentos" },
  "/facilities/fornecedores": { crumbs: ["Facilities", "Fornecedores"], context: "Cadastro e histórico por fornecedor" },
  "/facilities/historico": { crumbs: ["Facilities", "Histórico"], context: "Compras realizadas" },
  "/facilities/contratos": { crumbs: ["Facilities", "Contratos"], context: "Serviços recorrentes" },
  "/assistente/memoria": { crumbs: ["Assistente", "Memória"], context: "O que foi lembrado sobre você" },
  "/assistente/teste-voz": { crumbs: ["Assistente", "Teste de Voz"], context: "Vozes gratuitas do navegador · diagnóstico" },
};

/**
 * Rotas com parâmetro não cabem no mapa exato. Resolvidas por padrão,
 * e a própria página refina o miolo via evento `header:breadcrumb`.
 */
export function resolverDinamica(pathname: string): { crumbs: string[]; context?: string } | null {
  const bp = pathname.match(/^\/bp\/(\d{4})$/);
  if (bp) return { crumbs: ["BP", `BP ${bp[1]}`] };
  // /notas/<id> — o endereço de uma anotação. O título dela é o próprio cabeçalho da
  // tela; aqui basta a trilha não virar o caminho cru.
  if (/^\/notas\/[^/]+$/.test(pathname)) {
    return { crumbs: ["Time Financeiro", "Anotações"], context: "Workspace · notas do time" };
  }
  return null;
}

/** "Governança › Cartão — Evolução da fatura · Sicoob". Vazio quando a rota é desconhecida. */
export function descreverRota(pathname: string): string {
  const rota = ROTAS[pathname] ?? resolverDinamica(pathname);
  if (!rota) return "";
  const nome = rota.crumbs.join(" › ");
  return rota.context ? `${nome} — ${rota.context}` : nome;
}
