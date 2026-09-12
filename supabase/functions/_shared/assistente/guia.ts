// O GUIA DO HUB — como se faz cada coisa, e em que tela.
//
// POR QUE ESTE ARQUIVO EXISTE. O Assistente sabia os NÚMEROS do negócio e sabia QUEM É QUEM
// na empresa (org-context), e não sabia nada sobre o próprio Hub. Perguntado "como eu emito
// a nota de comissão?", o planejador não achava consulta nenhuma, a pergunta caía no caminho
// geral, e o modelo — que tem a DRE inteira no prompt e nenhuma linha sobre as telas —
// escrevia um procedimento plausível e inventado ("emita manualmente no Omie"). O Hub tem um
// botão para exatamente isso, na linha bloqueada do painel de Notas Fiscais.
//
// Esse é o pior formato de erro que este sistema pode produzir: específico, confiante, com a
// cara de documentação, e sem nenhum aviso — o selo da tela fala de NÚMEROS ("sem números
// verificados"), então um passo a passo inventado atravessa a checagem inteira sem encostar
// nela. E quem mais pergunta "como eu faço" é justamente quem tem menos condição de
// desconfiar da resposta: quem não é do financeiro.
//
// A REGRA QUE ORGANIZA O ARQUIVO: procedimento é CONTEÚDO ESCRITO, nunca geração. O que está
// aqui foi lido do código das telas e revisado; o que não está aqui o Assistente diz que não
// sabe, e aponta a tela. Um verbete errado é pior que um verbete ausente — ausente manda a
// pessoa perguntar a alguém, errado a faz executar.
//
// COMO ELE NÃO ENVELHECE. `src/lib/guia.test.ts` cruza este arquivo com o catálogo de
// navegação e com o PORTÃO: tela de menu sem verbete quebra o teste, e `capacidades` que
// divergir de `capacidadesDaRota` quebra também. A duplicação da capacidade é deliberada —
// o Deno não importa `src/lib/modules.ts` (que traz ícones do React) —, mas ela é PROVADA
// igual por teste, e não confiada à memória de quem edita.
//
// ACESSO. Cada verbete carrega as capacidades da tela, e o guia é filtrado por elas antes de
// chegar ao modelo. Explicar a alguém do Facilities como se lê a folha de pagamento seria
// vazar pela conversa o que a barra lateral esconde — e o Assistente responde com contexto
// que a tela não mostra, então a filtragem tem de acontecer aqui, na origem.

/** Uma tela do Hub (ou um assunto do Hub, quando `rota` é null). */
export type Verbete = {
  /**
   * Prefixo de rota, no mesmo formato do PORTÃO — `/bp` cobre `/bp/2026` e `/bp/versoes`.
   * `null` para assunto que não é tela (o Assistente, o acesso, a busca, o celular).
   */
  rota: string | null;
  /** O nome que está no menu. É por ele que a resposta chama a tela. */
  titulo: string;
  /** Onde fica no menu — "Operacional", "Governança". Vazio para assunto sem menu. */
  grupo: string;
  /** Capacidades que abrem a tela; QUALQUER uma basta. `null` = livre para quem tem conta. */
  capacidades: readonly string[] | null;
  /** Uma frase: o que esta tela é. Sempre presente. */
  oQueE: string;
  /** Quem usa isto no dia a dia — ajuda quem chegou de fora a saber se é com ele. */
  quemUsa: string;
  /** O passo a passo, quando foi verificado no código. Ausente ≠ inexistente: ver o cabeçalho. */
  passos?: string[];
  /** As armadilhas — o que faz a pessoa achar que deu certo quando não deu. */
  cuidados?: string[];
  /** Sinônimos e o jeito como as pessoas falam da coisa. Alimenta a busca do guia. */
  termos?: string[];
};

/* ---------------------------------------------------------------------------------------
 * OS VERBETES
 *
 * Ordem: a mesma da barra lateral, para que ler este arquivo de cima a baixo seja andar
 * pelo menu. Depois, o módulo Facilities e os assuntos que não são tela.
 * ------------------------------------------------------------------------------------- */

export const GUIA: readonly Verbete[] = [
  // ---- Início ---------------------------------------------------------------------------
  {
    rota: "/",
    titulo: "Dashboard",
    grupo: "Início",
    capacidades: ["metricas"],
    oQueE: "A primeira tela: os indicadores do mês corrente — receita, resultado, base de clientes — com o comparativo do mês anterior.",
    quemUsa: "Todo mundo que abre o Hub. É a home da maioria dos perfis.",
    termos: ["início", "home", "visão geral", "painel inicial", "abrir o hub", "primeira tela"],
  },
  {
    rota: "/briefing",
    titulo: "Briefing",
    grupo: "Início",
    capacidades: ["tesouraria"],
    oQueE: "O resumo do dia: agenda, e-mails que chegaram, notícias do setor, pagamentos previstos e o que a máquina achou estranho desde ontem.",
    quemUsa: "O financeiro, de manhã, antes de começar.",
    passos: [
      "Abra Início › Briefing. Ele já vem montado com o dia de hoje — não há nada a gerar.",
      "Os compromissos vêm da agenda do Google espelhada no Hub; os e-mails, da caixa do financeiro.",
      "A conferência de pagamentos cruza a agenda do dia com o que está provisionado no Omie e acusa o que não está.",
    ],
    cuidados: [
      "Valor citado dentro de um e-mail não é dado da empresa — é 'fulano mencionou, confirme'.",
    ],
    termos: ["diário", "agenda", "e-mails", "notícias", "o que tenho hoje", "resumo do dia", "manhã"],
  },
  {
    rota: "/briefing/novidades",
    titulo: "Novidades do Hub",
    grupo: "Início",
    capacidades: null,
    oQueE: "O que mudou no Hub, em ordem de data — cada item escrito a partir do que foi de fato publicado no código.",
    quemUsa: "Qualquer pessoa. É a tela para descobrir o que apareceu de novo.",
    termos: ["mudanças", "changelog", "o que mudou", "atualizações", "versão", "novo", "lançamento"],
  },
  {
    rota: "/caixa",
    titulo: "Caixa",
    grupo: "Início",
    capacidades: ["tesouraria"],
    oQueE: "Saldo em banco e movimentação: o que entrou, o que saiu, o fluxo projetado, o capital de giro e o ponto de equilíbrio.",
    quemUsa: "Financeiro e diretoria.",
    passos: [
      "Início › Caixa mostra o saldo consolidado. Os extratos linha a linha ficam em Extrato Sicoob e Extrato Asaas (busque por '⌘K extrato').",
      "O saldo do Sicoob chega pelo Omie, não por conexão direta com o banco.",
    ],
    cuidados: [
      "Caixa é saldo e extrato bancário. Fluxo de caixa CONTÁBIL por atividade (operacional, investimento, financiamento) é a DFC, outra tela.",
    ],
    termos: ["saldo", "banco", "conta corrente", "sicoob", "capital de giro", "ponto de equilíbrio", "quanto tem em caixa"],
  },
  {
    rota: "/asaas",
    titulo: "Asaas",
    grupo: "Início",
    capacidades: ["tesouraria"],
    oQueE: "O espelho local do Asaas: cobranças emitidas, recebimentos, estornos e quanto tempo cada meio de pagamento leva para virar dinheiro.",
    quemUsa: "Financeiro.",
    cuidados: [
      "É um espelho: o Hub lê o Asaas periodicamente e guarda. Cobrança criada agora pode levar alguns minutos para aparecer.",
    ],
    termos: ["cobranças", "recebimentos", "boleto", "pix do cliente", "cartão do cliente", "quando cai"],
  },
  {
    rota: "/assinaturas",
    titulo: "Assinaturas",
    grupo: "Início",
    capacidades: ["metricas"],
    oQueE: "A base de assinantes: MRR, carteira, mix de planos e a aba de Churn com os cancelamentos do mês.",
    quemUsa: "Diretoria, comercial e financeiro.",
    cuidados: [
      "No Churn, a base de comparação do mês M é o MRR de M−1. Comparar com o próprio mês infla ou desinfla a taxa.",
    ],
    termos: ["mrr", "recorrência", "churn", "carteira", "base de clientes", "cancelamento", "quantos clientes"],
  },
  {
    rota: "/operacional/parceiros",
    titulo: "Parceiros",
    grupo: "Início",
    capacidades: ["parceiros"],
    oQueE: "Embaixadores e parceiros de indicação: quem indicou quem, qual campanha, o MRR gerado e a bonificação devida.",
    quemUsa: "Quem toca parcerias, e o financeiro na hora de pagar a bonificação.",
    termos: ["embaixador", "indicação", "bonificação", "comissão de parceiro", "campanha", "indicou"],
  },

  // ---- Time Financeiro ------------------------------------------------------------------
  {
    rota: "/time/visao",
    titulo: "Visão do Time",
    grupo: "Time Financeiro",
    capacidades: ["biblioteca"],
    oQueE: "A estrutura do time financeiro: organograma, rituais, o catálogo de automações e quem responde por cada frente.",
    quemUsa: "Quem quer saber com quem falar sobre o quê.",
    cuidados: [
      "No organograma há membros virtuais: um agente de IA aparece como CARGO, não como pessoa.",
    ],
    termos: ["organograma", "estrutura", "quem faz o quê", "com quem falo", "cargos", "rituais", "automações"],
  },
  {
    rota: "/tarefas",
    titulo: "Tarefas",
    grupo: "Time Financeiro",
    capacidades: ["time"],
    oQueE: "O kanban do time financeiro: cada demanda é um card, e as colunas são o estado dela.",
    quemUsa: "O time financeiro. Quem é de fora normalmente só é citado como responsável.",
    passos: [
      "Abra Time Financeiro › Tarefas.",
      "Clique em 'Nova Tarefa' (ou no + da coluna, que já cria a tarefa naquela coluna) e preencha título, responsável, prioridade e prazo.",
      "Arraste o card entre as colunas conforme ele anda. 'Concluído' não é só mais uma coluna: é o estado que zera atraso e encerra a contagem.",
      "Para mandar a tarefa a alguém, use o link da demanda — /tarefas?tarefa=<id> abre o Hub direto naquele card, e funciona no celular.",
    ],
    cuidados: [
      "Backlog e Acompanhamento não envelhecem: uma tarefa parada ali de propósito não conta como atrasada.",
      "Muita tarefa nasce sozinha (cartão, automações, gatilho do Facilities, planilha de viagens) e cai no Backlog.",
    ],
    termos: ["kanban", "quadro", "card", "demanda", "backlog", "abrir tarefa", "criar tarefa", "pedir para o financeiro", "responsável", "prazo"],
  },
  {
    rota: "/automacoes/projetos",
    titulo: "Projetos",
    grupo: "Time Financeiro",
    capacidades: ["time"],
    oQueE: "Os projetos do time — o que é maior que uma tarefa, com as etapas e o andamento de cada um.",
    quemUsa: "O time financeiro.",
    termos: ["projeto", "iniciativa", "andamento", "etapas"],
  },
  {
    rota: "/playbook",
    titulo: "Anotações",
    grupo: "Time Financeiro",
    capacidades: ["time"],
    oQueE: "As notas e o playbook do time: procedimentos escritos, decisões e rascunhos, cada nota com endereço próprio.",
    quemUsa: "O time financeiro.",
    passos: [
      "Time Financeiro › Anotações lista as notas; abrir uma leva a /notas/<id>.",
      "Para mostrar uma nota a quem não tem conta no Hub, gere o link próprio dela: /n/<token> deixa ler e comentar, nunca editar.",
    ],
    termos: ["playbook", "nota", "documento", "procedimento escrito", "wiki", "anotação", "compartilhar nota"],
  },

  // ---- Apresentações --------------------------------------------------------------------
  {
    rota: "/apresentacoes/revisao",
    titulo: "Revisão Mensal",
    grupo: "Apresentações",
    capacidades: ["apresentacoes"],
    oQueE: "A reunião de tracker com o CEO: cinco blocos de leitura do mês, montados sobre os números já fechados, com redação por cima.",
    quemUsa: "Financeiro, para apresentar à diretoria.",
    cuidados: [
      "Publicar congela o HTML da apresentação: o que foi publicado não muda depois, mesmo que o número mude.",
    ],
    termos: ["revisão do mês", "tracker", "ceo", "reunião mensal", "apresentar o mês"],
  },
  {
    rota: "/apresentacoes/reportes",
    titulo: "Reportes",
    grupo: "Apresentações",
    capacidades: ["apresentacoes"],
    oQueE: "O material que sai para conselho e investidores, em formato de apresentação.",
    quemUsa: "Diretoria e financeiro.",
    termos: ["conselho", "investidores", "board", "deck", "reporte"],
  },

  // ---- Operacional ----------------------------------------------------------------------
  {
    rota: "/operacional/cartao",
    titulo: "Cartão → Omie",
    grupo: "Operacional",
    capacidades: ["conciliacao"],
    oQueE: "A esteira que transforma a fatura do cartão corporativo em títulos provisionados no Omie, parcela por parcela.",
    quemUsa: "Financeiro.",
    cuidados: [
      "As parcelas vão marcadas com NN/MM na observação do título — é por esse marcador que o Hub reconhece o que já provisionou.",
      "Quem é o portador de cada gasto só existe no PDF da fatura; o arquivo .ofx não traz. Deduzir pelo estabelecimento erra cerca de um em cada três.",
    ],
    termos: ["fatura", "provisionar", "parcelas", "cartão corporativo", "lançar no omie", "título"],
  },
  {
    rota: "/operacional/variavel",
    titulo: "Variável",
    grupo: "Operacional",
    capacidades: ["remuneracao"],
    oQueE: "O variável do mês por pessoa — comissões e premiações que entram na folha além do fixo.",
    quemUsa: "Financeiro e RH.",
    termos: ["comissão", "premiação", "bônus", "variável do mês", "quanto vai receber"],
  },
  {
    rota: "/operacional/reembolsos",
    titulo: "Reembolsos",
    grupo: "Operacional",
    capacidades: ["remuneracao"],
    oQueE: "Os reembolsos a colaboradores: o que foi pedido, o que foi aprovado e o que entra na folha.",
    quemUsa: "Financeiro e RH. Quem pediu o reembolso normalmente não abre esta tela — o pedido chega por fora.",
    termos: ["reembolso", "despesa do colaborador", "gastei do meu", "ressarcimento", "prestação de contas"],
  },
  {
    rota: "/operacional/estornos",
    titulo: "Estornos",
    grupo: "Operacional",
    capacidades: ["metricas"],
    oQueE: "As cobranças estornadas no Asaas e o que elas significam de churn real.",
    quemUsa: "Financeiro e quem acompanha churn.",
    cuidados: [
      "O Asaas limpa a data de pagamento ao estornar — o Hub conta pelo registro de estorno, não pelo pagamento sumido.",
      "A competência de um estorno é o vencimento da cobrança, não o dia do estorno.",
    ],
    termos: ["estorno", "refund", "chargeback", "devolução", "cancelou e pediu dinheiro de volta"],
  },
  {
    rota: "/operacional/notas-fiscais",
    titulo: "Notas Fiscais",
    grupo: "Operacional",
    capacidades: ["conciliacao"],
    oQueE: "A emissão de NFS-e das cobranças do Asaas pelo Omie: quais cobranças podem virar nota, quais já viraram, quais a prefeitura recusou e por quê.",
    quemUsa: "Financeiro.",
    passos: [
      "Abra Operacional › Notas Fiscais. A lista traz as cobranças candidatas a nota.",
      "A regra geral é: a nota sai DEPOIS que o dinheiro entra. Cobrança não recebida vem com a caixa de seleção apagada e 'A cobrança não foi recebida.' no hover.",
      "Marque as cobranças liberadas e mande emitir. A emissão vai em levas de cerca de 25, e a nota é criada dentro de uma Ordem de Serviço no Omie.",
      "Se a prefeitura recusar, a nota aparece na lista de recusas com o motivo; quando o motivo nomeia um campo do cadastro, o Hub oferece corrigir ali mesmo e reenviar.",
    ],
    cuidados: [
      "EXCEÇÃO — nota que precisa sair ANTES do pagamento. São dois casos opostos, e o Hub pede que você diga qual é: (a) cliente que só paga CONTRA a nota; (b) parceiro que nos deve COMISSÃO de indicação. A porta fica na própria linha bloqueada: abra a liberação de 'nota antes do pagamento' na linha da cobrança, escolha o tipo e escreva o motivo — sem motivo o Hub recusa.",
      "A liberação é por CNPJ, não por cobrança: vale para tudo o que aquele documento tiver em aberto, hoje e no futuro. Se o parceiro também for cliente, a mensalidade dele também destrava.",
      "'Pode ser faturada?' e 'já tem nota?' são perguntas diferentes — a fila de emissão tem um corte de data que não muda o que é nota.",
      "O tomador precisa de cadastro completo no Omie; o campo que mais trava é o e-mail, e ele não vem de consulta pública de CNPJ.",
    ],
    termos: [
      "nfse", "nfs-e", "nota fiscal", "emitir nota", "emito", "emissão", "faturar", "faturamento",
      "comissão", "nota de comissão", "parceiro", "indicação", "antes do pagamento", "recusa",
      "prefeitura", "tomador", "ordem de serviço", "os",
    ],
  },
  {
    rota: "/automacoes/proporcionais",
    titulo: "Proporcionais",
    grupo: "Operacional",
    capacidades: ["remuneracao"],
    oQueE: "O cálculo pró-rata de salário de quem entrou ou saiu no meio do mês.",
    quemUsa: "Financeiro e RH.",
    termos: ["pró-rata", "proporcional", "entrou no meio do mês", "salário parcial", "admissão"],
  },
  {
    rota: "/operacional/remuneracao",
    titulo: "Remuneração",
    grupo: "Operacional",
    capacidades: ["remuneracao", "remuneracao_time"],
    oQueE: "Quanto cada pessoa ganha, mês a mês, com fixo e variável separados, evolução e reajustes.",
    quemUsa: "RH, financeiro e diretoria. Líderes abrem a mesma tela recortada no próprio time.",
    cuidados: [
      "Há duas portas para esta sala: quem tem 'Pessoas e folha' vê a empresa inteira; quem tem 'Folha do meu time' vê só os setores marcados na própria ficha — e sem setores marcados, ninguém.",
      "A competência é a data de registro do lançamento, não o mês em que o dinheiro saiu.",
    ],
    termos: ["salário", "quanto ganha", "folha", "reajuste", "aumento", "plano de carreira", "remuneração", "pró-labore"],
  },

  // ---- Recargas -------------------------------------------------------------------------
  {
    rota: "/recargas/celulares",
    titulo: "Celulares",
    grupo: "Recargas",
    capacidades: ["maquinario"],
    oQueE: "As recargas de chip dos celulares corporativos: quem tem qual linha e o histórico de recarga de cada uma.",
    quemUsa: "Quem administra os aparelhos da operação.",
    termos: ["chip", "celular", "recarga", "linha", "telefone", "operadora"],
  },
  {
    rota: "/recargas/viagens",
    titulo: "Viagens",
    grupo: "Recargas",
    capacidades: ["maquinario"],
    oQueE: "As viagens lançadas e o valor total de cada evento, para acompanhar o gasto por deslocamento.",
    quemUsa: "Quem organiza as viagens da operação.",
    passos: [
      "Recargas › Viagens, botão 'Nova recarga · Viagem', e preencha o evento e o valor.",
    ],
    termos: ["viagem", "deslocamento", "evento", "diária", "gasto de viagem"],
  },

  // ---- Editais --------------------------------------------------------------------------
  {
    rota: "/editais",
    titulo: "Radar de Editais",
    grupo: "Editais",
    capacidades: ["editais"],
    oQueE: "O radar de fomento: editais e chamadas captados automaticamente de BNDES, FINEP, FAPES, SEBRAE, PNCP, gov.br e outras fontes, com triagem, pipeline e calendário de prazos.",
    quemUsa: "Quem toca captação de recursos.",
    passos: [
      "Editais › Radar de Editais abre o dashboard. As abas internas separam o que chegou (Radar), o que foi triado, o pipeline e o calendário de prazos.",
      "A coleta roda sozinha; não é preciso disparar nada para o radar encher.",
    ],
    termos: ["fomento", "grants", "licitação", "chamada pública", "bndes", "finep", "sebrae", "captação", "edital"],
  },
  {
    rota: "/editais/projetos-aprovados",
    titulo: "Projetos Aprovados",
    grupo: "Editais",
    capacidades: ["editais"],
    oQueE: "Os projetos de fomento já aprovados: valor, contrapartida, prazos e a prestação de contas.",
    quemUsa: "Quem toca captação e o financeiro.",
    termos: ["projeto aprovado", "prestação de contas", "contrapartida", "convênio"],
  },

  // ---- Investimentos --------------------------------------------------------------------
  {
    rota: "/captable",
    titulo: "Captable",
    grupo: "Investimentos",
    capacidades: ["societario"],
    oQueE: "A composição societária e o simulador de rodadas: quem tem quanto, e o que uma nova rodada faz com isso.",
    quemUsa: "Diretoria e sócios. É o dado mais sensível do Hub.",
    cuidados: [
      "No simulador, pool antes e depois do dinheiro (pré × pós-money) dá resultados bem diferentes — a escolha é sua, não do Hub.",
    ],
    termos: ["cap table", "sócios", "equity", "diluição", "rodada", "simulador", "pre-money", "participação"],
  },
  {
    rota: "/investimentos/flip",
    titulo: "O Flip",
    grupo: "Investimentos",
    capacidades: ["societario"],
    oQueE: "A reorganização societária para o exterior, em quatro cadernos fixos de acompanhamento.",
    quemUsa: "Diretoria.",
    termos: ["flip", "cayman", "delaware", "holding", "series a", "reorganização"],
  },
  {
    rota: "/investimentos",
    titulo: "Takeat LTD/LLC",
    grupo: "Investimentos",
    capacidades: ["societario"],
    oQueE: "A posição das entidades no exterior — saldos e movimentação das empresas de fora.",
    quemUsa: "Diretoria e financeiro.",
    termos: ["exterior", "ltd", "llc", "financials", "fora do brasil"],
  },

  // ---- Demonstrações --------------------------------------------------------------------
  {
    rota: "/demonstracoes/dre",
    titulo: "DRE",
    grupo: "Demonstrações",
    capacidades: ["demonstracoes"],
    oQueE: "A demonstração de resultado mês a mês: receita, custos, despesas, EBITDA e lucro, na hierarquia de blocos e rubricas.",
    quemUsa: "Financeiro e diretoria.",
    passos: [
      "Demonstrações › DRE. Cada coluna é um mês; cada linha, uma rubrica.",
      "Clique numa célula para abrir os lançamentos que a compõem — data, contraparte, valor, categoria e título no Omie.",
      "Para trocar a categoria de um lançamento, o caminho é o ERP primeiro: a correção se faz no Omie e volta na próxima sincronização.",
    ],
    cuidados: [
      "Mês travado não é o mesmo que mês fechado. Mês aberto ainda recebe lançamento, e o número é parcial.",
      "O EBITDA Ajustado tem uma linha própria: a máquina garimpa os candidatos a ajuste, mas quem decide o que é ajuste é uma pessoa.",
    ],
    termos: ["dre", "resultado", "ebitda", "margem", "receita", "despesa", "rubrica", "lançamentos", "abrir a célula", "por que caiu"],
  },
  {
    rota: "/demonstracoes/dfc",
    titulo: "DFC",
    grupo: "Demonstrações",
    capacidades: ["demonstracoes"],
    oQueE: "O fluxo de caixa contábil por atividade: operacional, investimento, financiamento e fluxo de caixa livre.",
    quemUsa: "Financeiro e diretoria.",
    cuidados: [
      "DFC não é a tela de Caixa. Caixa é saldo e extrato bancário; DFC é a demonstração contábil.",
      "Cashburn aqui é o fluxo de caixa livre menos empréstimos.",
    ],
    termos: ["dfc", "fluxo de caixa", "cashburn", "runway", "queima de caixa", "geração de caixa"],
  },
  {
    rota: "/demonstracoes/balancete",
    titulo: "Balancete",
    grupo: "Demonstrações",
    capacidades: ["demonstracoes"],
    oQueE: "O balancete do período, conta a conta.",
    quemUsa: "Financeiro e contabilidade.",
    cuidados: [
      "Balancete e Balanço chegam por PDF. Quando o arquivo é escaneado, a leitura passa por OCR e vale conferir os números contra o original.",
    ],
    termos: ["balancete", "contas contábeis", "razão", "contabilidade"],
  },
  {
    rota: "/demonstracoes/balanco",
    titulo: "Balanço",
    grupo: "Demonstrações",
    capacidades: ["demonstracoes"],
    oQueE: "O balanço patrimonial: ativo, passivo e patrimônio líquido.",
    quemUsa: "Financeiro, contabilidade e diretoria.",
    termos: ["balanço", "bp patrimonial", "ativo", "passivo", "patrimônio"],
  },

  // ---- BP -------------------------------------------------------------------------------
  {
    rota: "/bp",
    titulo: "BP (Business Plan)",
    grupo: "BP",
    capacidades: ["planejamento"],
    oQueE: "O plano do ano em seis abas, importado de planilha: é contra ele que o realizado é comparado. Há o BP do ano corrente, o do ano seguinte em construção e o histórico de versões.",
    quemUsa: "Diretoria e financeiro.",
    cuidados: [
      "Na planilha, a mesma rubrica aparece em três blocos repetidos; o importador considera o primeiro.",
      "O BP foi reancorado em junho de 2026 — de janeiro a maio a comparação é contra o plano anterior.",
    ],
    termos: ["bp", "business plan", "plano", "orçado", "planejado", "meta do ano", "versões"],
  },

  // ---- Análise Preditiva ----------------------------------------------------------------
  {
    rota: "/analise/cenarios",
    titulo: "Cenários",
    grupo: "Análise Preditiva",
    capacidades: ["planejamento"],
    oQueE: "Simulações: premissas alteradas e o efeito delas sobre a projeção.",
    quemUsa: "Diretoria e financeiro.",
    termos: ["cenário", "projeção", "simulação", "e se", "premissa"],
  },
  {
    rota: "/analise/historico",
    titulo: "Histórico Multianual",
    grupo: "Análise Preditiva",
    capacidades: ["planejamento"],
    oQueE: "A série de vários anos das métricas financeiras, para ver trajetória em vez de mês isolado.",
    quemUsa: "Diretoria e financeiro.",
    termos: ["histórico", "série", "vários anos", "evolução", "tendência"],
  },

  // ---- Governança -----------------------------------------------------------------------
  {
    rota: "/orcamento",
    titulo: "Orçamento",
    grupo: "Governança",
    capacidades: ["orcamento"],
    oQueE: "Orçado × realizado por área, com saldo e percentual consumido. O realizado vem do Omie por um de-para de categorias.",
    quemUsa: "Donos de área e financeiro.",
    termos: ["orçamento", "budget", "estourou", "quanto sobra", "realizado", "por área", "consumido"],
  },
  {
    rota: "/governanca/auditoria",
    titulo: "Auditoria",
    grupo: "Governança",
    capacidades: ["conciliacao"],
    oQueE: "Os achados: lançamentos que fugiram de uma regra — PIX sem comprovante, valor fora do padrão, pagamento sem nota — cada um com severidade e responsável.",
    quemUsa: "Financeiro.",
    passos: [
      "Governança › Auditoria lista os achados abertos por regra e severidade.",
      "Em cada achado dá para anexar o comprovante; a IA transcreve o documento e uma regra escrita em código decide se ele aprova o achado.",
      "Para casar um achado com o ERP, use 'Cruzar com Omie': não existe identificador comum, então o casamento é por valor e data.",
    ],
    cuidados: [
      "Auditoria não é o razão contábil: só aparece aqui o que fugiu do padrão.",
      "O CNPJ lido de um comprovante vale como evidência e pode virar cadastro na Parametrização.",
    ],
    termos: ["auditoria", "achado", "pix", "comprovante", "conciliação", "exceção", "sem nota", "conferir"],
  },
  {
    rota: "/governanca/notas-erp",
    titulo: "Notas no ERP",
    grupo: "Governança",
    capacidades: ["conciliacao"],
    oQueE: "A cobertura de notas de fornecedor no Omie: quais títulos têm nota anexada e quais não, com o acervo de notas que chegaram por e-mail, link, XML ou Drive.",
    quemUsa: "Financeiro.",
    cuidados: [
      "A fila de envio ao ERP só anda por clique — nenhum cron enfileira nota sozinho.",
      "O Omie recusa imagem: um jpg vira PDF antes de subir, e o tipo real é lido dos bytes, não da extensão.",
    ],
    termos: ["nota de fornecedor", "anexo", "omie", "cobertura", "acervo", "xml", "danfe", "anexar nota"],
  },
  {
    rota: "/governanca/cartao",
    titulo: "Cartão (OFX)",
    grupo: "Governança",
    capacidades: ["conciliacao"],
    oQueE: "A fatura do cartão corporativo lida do arquivo OFX: evolução mês a mês, variação por estabelecimento e por categoria.",
    quemUsa: "Financeiro.",
    cuidados: [
      "As recomendações da tela saem de um sinal determinístico; a IA só redige o texto em cima dele.",
    ],
    termos: ["fatura", "ofx", "cartão", "estabelecimento", "por que subiu", "gasto do cartão", "sicoob"],
  },
  {
    rota: "/governanca/cac",
    titulo: "Painel CAC",
    grupo: "Governança",
    capacidades: ["metricas"],
    oQueE: "O custo de aquisição de cliente: o que marketing e comercial gastaram contra o que entrou.",
    quemUsa: "Diretoria, marketing e comercial.",
    cuidados: [
      "O casamento entre gasto e cliente é por CNPJ, não por nome.",
    ],
    termos: ["cac", "aquisição", "custo por cliente", "marketing", "comercial", "mídia paga"],
  },
  {
    rota: "/governanca/vigilancia",
    titulo: "Vigilância externa",
    grupo: "Governança",
    capacidades: ["maquinario"],
    oQueE: "O acompanhamento de páginas externas — reajuste de preço de fornecedor, sinal de que um cliente fechou — e o painel de créditos de raspagem.",
    quemUsa: "Quem cuida do maquinário e de contratos.",
    cuidados: [
      "A raspagem é orçada: seis consumidores dividem o mesmo plano mensal, e cada um tem teto próprio e um piso de saldo que define quem para primeiro.",
    ],
    termos: ["vigilância", "monitorar página", "reajuste", "preço do fornecedor", "fechou", "raspagem", "créditos", "firecrawl"],
  },
  {
    rota: "/governanca/rescisoes",
    titulo: "Rescisões",
    grupo: "Governança",
    capacidades: ["remuneracao"],
    oQueE: "Os desligamentos e as verbas de cada um.",
    quemUsa: "RH e financeiro.",
    cuidados: [
      "A multa sai do tipo de rescisão; o pagamento em si é lançado pelo Hub.",
    ],
    termos: ["rescisão", "desligamento", "demissão", "verbas", "saiu da empresa", "acerto"],
  },

  // ---- Configurações --------------------------------------------------------------------
  {
    rota: "/monitoramento",
    titulo: "Monitoramento",
    grupo: "Configurações",
    capacidades: ["maquinario"],
    oQueE: "Se a máquina está de pé, em três abas: a agente TETS e sua trilha, o painel de automações (o que rodou, o que falhou) e as integrações e credenciais.",
    quemUsa: "Quem cuida do maquinário.",
    passos: [
      "Configurações › Monitoramento. A aba de automações mostra a última execução de cada rotina; faixa verde quer dizer que a função respondeu 2xx — não que o resultado estava certo.",
      "A aba de integrações é onde se reconecta Gmail, Omie, Asaas e planilhas quando uma credencial cai.",
    ],
    termos: ["cron", "automação", "está rodando", "falhou", "integração", "credencial", "token", "oauth", "gmail", "tets", "agente", "esteira"],
  },
  {
    rota: "/operacional/colaboradores",
    titulo: "Colaboradores (RH)",
    grupo: "Configurações",
    capacidades: ["remuneracao"],
    oQueE: "O espelho da planilha do RH: a ficha de cada colaborador, incluindo a coluna de valor.",
    quemUsa: "RH e financeiro.",
    termos: ["rh", "ficha", "colaborador", "funcionário", "equipe", "admissão", "cadastro de pessoa"],
  },
  {
    rota: "/configuracoes/parametrizacao",
    titulo: "Parametrização",
    grupo: "Configurações",
    capacidades: ["maquinario"],
    oQueE: "O de-para de nomes: o extrato entrega 'JIM.COM GRUPO SOUZA' e é aqui que isso vira 'Café dos eventos' em todas as telas.",
    quemUsa: "Financeiro.",
    passos: [
      "Configurações › Parametrização, e cadastre o apelido do fornecedor ou da contraparte.",
      "O apelido passa a aparecer na linha de cima em todas as telas, com o nome cru embaixo — é o nome cru que se procura no Omie.",
    ],
    cuidados: [
      "Os apelidos vêm das planilhas de cadastro, não de adivinhação da IA.",
    ],
    termos: ["apelido", "de-para", "de para", "nome do fornecedor", "contraparte", "renomear", "nome estranho no extrato"],
  },
  {
    rota: "/configuracoes/uso-ia",
    titulo: "Uso de IA",
    grupo: "Configurações",
    capacidades: ["maquinario"],
    oQueE: "Quanto a IA do Hub gastou no mês e quanto falta para o teto.",
    quemUsa: "Quem cuida do maquinário.",
    cuidados: [
      "O teto é nosso, definido aqui — não é o limite do fornecedor do modelo.",
    ],
    termos: ["ia", "gemini", "custo", "token", "teto", "gasto", "crédito", "quanto a ia gastou"],
  },
  {
    rota: "/usuarios",
    titulo: "Usuários",
    grupo: "Configurações",
    capacidades: ["usuarios"],
    oQueE: "Quem entra no Hub e o que cada perfil enxerga: as contas, e a matriz de Perfis de acesso que liga perfil a capacidades.",
    quemUsa: "Só quem administra o Hub.",
    passos: [
      "Configurações › Usuários lista as contas. A aba 'Perfis de acesso' é a matriz: cada perfil marca as capacidades que abre.",
      "Para dar acesso a uma tela, marque a CAPACIDADE dela no perfil da pessoa — a tela aparece embaixo de cada linha, para o nome abstrato virar decisão informada.",
      "Trocar o perfil de uma conta muda o menu e as rotas que ela alcança na mesma hora.",
    ],
    cuidados: [
      "O cargo é texto livre e só serve de rótulo na tela. Quem decide o que a pessoa vê é o PERFIL.",
      "O perfil admin não se edita: a linha dele é reescrita inteira, para ninguém conseguir trancar a própria tela de administração.",
      "Perfil em branco ou desconhecido não abre nada — o padrão é o mínimo, não o máximo.",
    ],
    termos: ["acesso", "permissão", "perfil", "não consigo abrir", "liberar tela", "criar usuário", "convidar", "senha", "cargo"],
  },
  {
    rota: "/analise/conhecimento",
    titulo: "Biblioteca",
    grupo: "Configurações",
    capacidades: ["biblioteca"],
    oQueE: "O cadastro da organização: departamentos, cargos, centros de custo, colaboradores, fornecedores e políticas internas.",
    quemUsa: "Financeiro e RH mantêm; todas as IAs do Hub leem.",
    cuidados: [
      "O que está aqui entra no contexto de todas as IAs do Hub — é por isso que o Assistente conhece os nomes reais de gente e fornecedor.",
    ],
    termos: ["biblioteca", "base de conhecimento", "políticas", "departamento", "centro de custo", "fornecedor", "cadastro"],
  },

  // ---- Módulo Facilities ----------------------------------------------------------------
  {
    rota: "/facilities",
    titulo: "Facilities — Dashboard",
    grupo: "Facilities",
    capacidades: ["facilities"],
    oQueE: "A visão geral de compras: o que está em aberto, o que foi gasto e por onde as solicitações estão paradas.",
    quemUsa: "Quem toca compras e facilities.",
    cuidados: [
      "O módulo Facilities substitui o menu inteiro: quem tem o perfil de Facilities vê este menu, não o do Financeiro.",
    ],
    termos: ["facilities", "compras", "dashboard de compras"],
  },
  {
    rota: "/facilities/solicitacoes",
    titulo: "Solicitações",
    grupo: "Facilities",
    capacidades: ["facilities"],
    oQueE: "Os pedidos de compra, do pedido à compra feita. É por aqui que se pede qualquer coisa que a empresa precise comprar.",
    quemUsa: "Qualquer pessoa que precise de uma compra — é a porta de entrada de quem não é do financeiro.",
    passos: [
      "Facilities › Solicitações, botão 'Nova solicitação'.",
      "Preencha o título (o que é, com quantidade — 'Cadeiras ergonômicas (4 un)'), a categoria, o valor estimado, quem está solicitando e uma observação com links, detalhes ou urgência.",
      "Salve em 'Criar solicitação'. Ela nasce no estado 'solicitado'.",
      "Daí ela anda pelos estados: em cotação → aguardando aprovação → aprovado → comprado (ou recusado).",
    ],
    cuidados: [
      "Compras acima de R$ 500 passam por aprovação — abaixo disso o caminho é mais curto.",
      "A aprovação vira uma tarefa no kanban do time automaticamente, e é fechada sozinha quando a decisão sai. Não abra uma tarefa à mão para isso.",
    ],
    termos: [
      "comprar", "compra", "pedido", "solicitar", "preciso de", "quero pedir", "solicitação",
      "aprovar compra", "aprovação", "cadeira", "notebook", "material", "equipamento",
    ],
  },
  {
    rota: "/facilities/cotacoes",
    titulo: "Cotações",
    grupo: "Facilities",
    capacidades: ["facilities"],
    oQueE: "As cotações de cada solicitação lado a lado, com as evidências (print, link, proposta) de cada uma.",
    quemUsa: "Quem toca compras.",
    passos: [
      "Facilities › Cotações. Cada cotação pertence a uma solicitação e traz fornecedor, valor e anexos.",
      "Marque a cotação escolhida — é ela que sustenta a aprovação.",
    ],
    termos: ["cotação", "orçamento do fornecedor", "comparar preço", "três orçamentos", "proposta", "evidência"],
  },
  {
    rota: "/facilities/radar",
    titulo: "Radar de preços",
    grupo: "Facilities",
    capacidades: ["facilities"],
    oQueE: "O acompanhamento do preço de equipamentos em lojas online: você cadastra o alvo e o Hub varre periodicamente para avisar quando o preço cai.",
    quemUsa: "Quem toca compras.",
    cuidados: [
      "Um alvo novo nasce em quarentena até a primeira conferência.",
      "'Bloqueada' não é o mesmo que 'esgotado' — uma é a loja recusando a leitura, a outra é o produto sem estoque.",
      "O aviso de queda tem gatilho na CONFERÊNCIA, e só repete se cair mais 3%.",
    ],
    termos: ["radar de preço", "monitorar preço", "promoção", "notebook", "mercado livre", "baixou de preço", "oferta", "alvo"],
  },
  {
    rota: "/facilities/passagens",
    titulo: "Passagens",
    grupo: "Facilities",
    capacidades: ["facilities"],
    oQueE: "O acompanhamento de preço de passagem aérea para as rotas que interessam.",
    quemUsa: "Quem organiza viagens.",
    cuidados: [
      "As APIs de voo fecharam em 2026: o preço aqui vem do alerta do Google Voos que chega por e-mail, não de consulta direta a companhia aérea.",
    ],
    termos: ["passagem", "voo", "aérea", "viagem", "bilhete", "google flights", "aeroporto", "comprar passagem"],
  },
  {
    rota: "/facilities/fornecedores",
    titulo: "Fornecedores (Facilities)",
    grupo: "Facilities",
    capacidades: ["facilities"],
    oQueE: "O cadastro de fornecedores de compras: contato, CNPJ, categoria e os contratos anexados.",
    quemUsa: "Quem toca compras.",
    termos: ["fornecedor", "cadastrar fornecedor", "cnpj do fornecedor", "contato", "contrato anexado"],
  },
  {
    rota: "/facilities/historico",
    titulo: "Histórico (Facilities)",
    grupo: "Facilities",
    capacidades: ["facilities"],
    oQueE: "As compras já realizadas, com data, item, fornecedor, forma de pagamento e valor.",
    quemUsa: "Quem toca compras e o financeiro.",
    termos: ["compras realizadas", "histórico de compras", "o que já compramos", "quanto pagamos"],
  },
  {
    rota: "/facilities/contratos",
    titulo: "Contratos (Facilities)",
    grupo: "Facilities",
    capacidades: ["facilities"],
    oQueE: "Os contratos recorrentes com fornecedores e o que cada um custa por mês.",
    quemUsa: "Quem toca compras e o financeiro.",
    termos: ["contrato", "recorrente", "mensalidade do fornecedor", "renovação", "assinatura de serviço"],
  },

  // ---- Telas fora do menu ---------------------------------------------------------------
  {
    rota: "/assistente/memoria",
    titulo: "Memória do Assistente",
    grupo: "Outras telas",
    capacidades: ["maquinario"],
    oQueE: "O que o Assistente guardou das conversas — números, nomes e decisões que ele passa a lembrar.",
    quemUsa: "Quem cuida do maquinário.",
    termos: ["memória", "o que a ia lembrou", "esquecer", "apagar memória"],
  },
  {
    rota: "/assistente/teste-voz",
    titulo: "Teste de Voz",
    grupo: "Outras telas",
    capacidades: null,
    oQueE: "A tela para ouvir as vozes disponíveis e escolher como o Assistente fala quando a leitura em voz alta está ligada.",
    quemUsa: "Quem usa o Assistente com a voz ligada.",
    termos: ["voz", "falar", "ouvir", "áudio", "leitura em voz alta", "narração"],
  },
  {
    rota: "/design-system",
    titulo: "Design System",
    grupo: "Outras telas",
    capacidades: null,
    oQueE: "A página viva de cores, tokens e componentes do Hub.",
    quemUsa: "Quem mexe na interface.",
    termos: ["cores", "tokens", "componentes", "design", "identidade"],
  },

  /* ---- Assuntos que não são tela -------------------------------------------------------
   * Estes existem porque as perguntas de quem chegou agora quase nunca começam numa tela:
   * começam em "não consigo entrar", "onde eu acho", "dá para usar no celular". Sem verbete,
   * cada uma dessas caía no caminho geral — o mesmo que inventou o procedimento do Omie. */
  {
    rota: null,
    titulo: "O Assistente (esta conversa)",
    grupo: "",
    capacidades: ["assistente"],
    oQueE: "A bolinha de IA presente em toda página do Hub. Responde sobre os números da empresa consultando o banco na hora, e sobre como usar o Hub a partir de um guia escrito.",
    quemUsa: "Quem tiver a capacidade 'Assistente (IA)' no perfil.",
    passos: [
      "Abra pela bolinha no canto da tela, ou por ⌘/Ctrl + I.",
      "Pergunte em português normal. O Assistente sabe de que tela você está perguntando, então 'por que subiu?' na frente da fatura do cartão é entendido como pergunta da fatura.",
      "Dá para anexar print ou foto de documento — mas o que ele lê de uma imagem vem marcado como 'lido da imagem', e não tem a mesma procedência de um número vindo do banco.",
    ],
    cuidados: [
      "O selo embaixo de cada resposta diz de onde ela veio: 'números conferidos agora' quer dizer que os valores saíram de consulta ao banco naquela pergunta, com a tabela de origem ao lado. 'Sem números verificados' quer dizer que não houve consulta — confira antes de usar.",
      "Ele responde sobre o negócio inteiro, e por isso o acesso a ele é uma capacidade à parte: esconder a bolinha não fecharia nada.",
    ],
    termos: ["assistente", "ia", "bolinha", "perguntar", "chat", "como funciona a ia", "selo", "conferido"],
  },
  {
    rota: null,
    titulo: "Acesso: por que não consigo abrir uma tela",
    grupo: "",
    capacidades: null,
    oQueE: "O que você enxerga no Hub sai do seu PERFIL de acesso — uma lista fechada de perfis, cada um marcando as capacidades que abre. O cargo escrito na sua ficha é só um rótulo e não abre nada.",
    quemUsa: "Qualquer pessoa que esbarrou numa tela fechada.",
    passos: [
      "Se a tela não aparece no menu, o seu perfil não tem a capacidade dela — digitar a URL também não abre, a trava é a mesma nos dois caminhos.",
      "Peça a quem administra o Hub (Configurações › Usuários) para marcar a capacidade correspondente no seu perfil.",
      "Diga QUAL TELA você precisa, não qual capacidade: a tela de Perfis de acesso mostra, embaixo de cada capacidade, as telas que ela abre.",
    ],
    cuidados: [
      "Conta sem perfil definido não abre nada — o padrão é o mínimo, de propósito.",
      "Quem tem o perfil de Facilities vê o menu do módulo de compras, e não o menu do Financeiro. Não é falta de acesso: é outro menu.",
    ],
    termos: [
      "não consigo abrir", "não aparece", "sem acesso", "permissão", "acesso negado", "bloqueado",
      "liberar", "meu perfil", "não vejo a tela", "sumiu do menu", "pedir acesso",
    ],
  },
  {
    rota: null,
    titulo: "Achar as coisas: busca, favoritos e o menu",
    grupo: "",
    capacidades: null,
    oQueE: "O menu da esquerda agrupa as telas por assunto; a busca rápida acha qualquer uma pelo nome, pela sigla ou pelo nome do sistema de origem.",
    quemUsa: "Todo mundo, principalmente quem chegou agora.",
    passos: [
      "Aperte ⌘K (Ctrl+K no Windows) e digite o que procura — vale 'extrato', 'omie', 'nfse', 'cac'.",
      "A busca só mostra o que o seu perfil alcança: o que não aparece, ou não existe, ou não é seu.",
      "Passe o mouse sobre um item do menu e clique na estrela para fixá-lo nos favoritos, no topo.",
    ],
    termos: ["buscar", "procurar", "onde fica", "onde acho", "atalho", "cmd k", "ctrl k", "favoritos", "menu", "navegar"],
  },
  {
    rota: null,
    titulo: "Hub no celular",
    grupo: "",
    capacidades: null,
    oQueE: "Em tela estreita o Hub monta um app próprio, com um conjunto menor de abas — início, tarefas, extratos, notas, chat e perfil — e não uma versão encolhida do desktop.",
    quemUsa: "Quem precisa consultar ou responder algo fora da mesa.",
    cuidados: [
      "As telas que só existem no desktop avisam isso no celular em vez de abrir quebradas.",
    ],
    termos: ["celular", "mobile", "app", "telefone", "pwa", "instalar", "fora do escritório"],
  },
] as const;

/* =========================================================================================
 * BUSCA
 *
 * Determinística e simples de propósito: quem escolhe o verbete é uma contagem de termos,
 * não um modelo. Se a escolha do verbete fosse do modelo, o guia deixaria de ser a garantia
 * de que o procedimento não foi inventado — ele poderia "lembrar" de um verbete que não leu.
 * ======================================================================================= */

const IRRELEVANTES = new Set([
  "como", "para", "pra", "por", "que", "qual", "quais", "onde", "quando", "quem", "com",
  "sem", "dos", "das", "nos", "nas", "uma", "uns", "umas", "num", "numa", "isso", "isto",
  "aqui", "hub", "sistema", "tela", "pagina", "página", "fazer", "faco", "faço", "posso",
  "consigo", "preciso", "quero", "devo", "deve", "tem", "ter", "ser", "vou", "vai", "mim",
  "meu", "minha", "seu", "sua", "esse", "essa", "este", "esta", "dele", "dela", "sobre",
  "mais", "menos", "muito", "ainda", "então", "entao", "certo", "favor", "alguem", "alguém",
]);

function palavras(texto: string): string[] {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !IRRELEVANTES.has(p));
}

/**
 * Duas palavras são a mesma coisa?
 *
 * Prefixo comum de 4 letras, e não igualdade: "emitir", "emito" e "emitida" são a mesma
 * pergunta, e exigir a forma exata faria o guia errar justamente quem escreve como fala.
 * Quatro é o piso que separa "emit-" de casos como "para"/"parceiro".
 */
function casa(a: string, b: string): boolean {
  if (a === b) return true;
  const menor = Math.min(a.length, b.length);
  return menor >= 4 && (a.startsWith(b.slice(0, menor)) && b.startsWith(a.slice(0, menor)));
}

function achouEm(termo: string, alvos: string[]): boolean {
  return alvos.some((alvo) => casa(termo, alvo));
}

/** O verbete é visível para quem tem estas capacidades? `null` = tela livre. */
export function verbeteVisivel(v: Verbete, pode: (c: string) => boolean): boolean {
  return v.capacidades === null || v.capacidades.some(pode);
}

export type Achado = { verbete: Verbete; pontos: number };

/**
 * Os verbetes que respondem a esta pergunta, do mais forte ao mais fraco.
 *
 * `rotaAtual` pesa porque a pergunta quase sempre é sobre a tela aberta: "como eu libero
 * isso?" perguntado dentro de Notas Fiscais é sobre a nota, e não sobre uma solicitação
 * de compra que por acaso também usa a palavra "liberar".
 */
export function buscarNoGuia(
  pergunta: string,
  opts: { rotaAtual?: string | null; pode: (c: string) => boolean; limite?: number },
): Achado[] {
  const termos = palavras(pergunta);
  const visiveis = GUIA.filter((v) => verbeteVisivel(v, opts.pode));
  const rota = String(opts.rotaAtual ?? "");

  const achados = visiveis.map((v) => {
    const noTitulo = palavras(v.titulo);
    const nosTermos = (v.termos ?? []).flatMap(palavras);
    const noTexto = palavras([v.oQueE, v.quemUsa, ...(v.passos ?? []), ...(v.cuidados ?? [])].join(" "));

    let pontos = 0;
    let casados = 0;
    for (const t of termos) {
      if (achouEm(t, noTitulo)) { pontos += 6; casados++; }
      else if (achouEm(t, nosTermos)) { pontos += 4; casados++; }
      else if (achouEm(t, noTexto)) { pontos += 1; casados++; }
    }

    // A tela aberta entra na disputa mesmo sem casar palavra: quem pergunta olhando para
    // ela merece que ela seja considerada.
    const naTela = !!(v.rota && rota && (rota === v.rota || rota.startsWith(v.rota + "/")));
    if (naTela) pontos += 5;

    return { verbete: v, pontos, casados, naTela };
  });

  /* DOIS FILTROS, porque uma pontuação só não separa acerto de coincidência.
   *
   * O PISO de 4 exige que a pergunta tenha casado com o TÍTULO ou com um sinônimo, e não
   * com uma palavra perdida no meio de um verbete.
   *
   * A COBERTURA é o que impede o resto do português de entrar: "me conta uma piada" casa
   * "conta" com "conta corrente" e traria Caixa e Balancete. Exigir que uma boa parte das
   * palavras da pergunta tenha casado transforma isso em "nenhum verbete", que é a resposta
   * certa. Dois quintos é frouxo de propósito — "onde peço um notebook" casa só "notebook",
   * e tem de continuar achando as Solicitações.
   *
   * Verbete fraco é pior que verbete nenhum: o modelo escreve em cima do que recebe, e um
   * bloco irrelevante no prompt vira uma resposta confiante sobre a tela errada. */
  const minimo = Math.max(1, Math.ceil(termos.length * 0.4));

  return achados
    .filter((a) => a.naTela || (a.pontos >= 4 && a.casados >= minimo))
    .sort((a, b) => b.pontos - a.pontos || a.verbete.titulo.localeCompare(b.verbete.titulo))
    .map(({ verbete, pontos }) => ({ verbete, pontos }))
    .slice(0, opts.limite ?? 3);
}

/* =========================================================================================
 * O QUE VAI PARA O MODELO
 * ======================================================================================= */

function ondeFica(v: Verbete): string {
  if (!v.rota) return v.titulo;
  return `${v.grupo ? `${v.grupo} › ` : ""}${v.titulo} (${v.rota})`;
}

function verbeteEmTexto(v: Verbete): string {
  const linhas = [`## ${ondeFica(v)}`, v.oQueE, `Quem usa: ${v.quemUsa}`];
  if (v.passos?.length) linhas.push("Passo a passo:", ...v.passos.map((p, i) => `${i + 1}. ${p}`));
  else linhas.push("PASSO A PASSO: não está escrito no guia para esta tela.");
  if (v.cuidados?.length) linhas.push("Cuidados:", ...v.cuidados.map((c) => `- ${c}`));
  return linhas.join("\n");
}

/**
 * O mapa das telas que ESTA pessoa alcança.
 *
 * Vai junto sempre, e não só quando a busca falha: é ele que transforma "não sei" em "não
 * sei o passo a passo, mas isso se faz em tal tela" — e é a única parte da resposta que
 * continua útil quando o verbete certo ainda não foi escrito.
 */
export function mapaDoHub(pode: (c: string) => boolean): string {
  const porGrupo = new Map<string, string[]>();
  for (const v of GUIA) {
    if (!v.rota || !verbeteVisivel(v, pode)) continue;
    const lista = porGrupo.get(v.grupo) ?? [];
    lista.push(`${v.titulo} (${v.rota}) — ${v.oQueE}`);
    porGrupo.set(v.grupo, lista);
  }
  const blocos = [...porGrupo.entries()].map(([g, itens]) => `### ${g}\n${itens.map((i) => `- ${i}`).join("\n")}`);
  return blocos.length ? `# Telas que esta pessoa pode abrir\n${blocos.join("\n")}` : "";
}

/** O bloco fechado que o sintetizador recebe. Fora daqui ele não tem nada sobre o Hub. */
export function blocoDoGuia(achados: Achado[], pode: (c: string) => boolean): string {
  const partes: string[] = [];

  if (achados.length) {
    partes.push("# Guia do Hub — verbetes que respondem a esta pergunta");
    partes.push(achados.map((a) => verbeteEmTexto(a.verbete)).join("\n\n"));
  } else {
    partes.push(
      "# Guia do Hub\nNenhum verbete do guia casou com esta pergunta. " +
      "Não descreva nenhum procedimento: diga que o passo a passo disto ainda não está no " +
      "guia e aponte, pelo mapa abaixo, a tela mais provável.",
    );
  }

  const mapa = mapaDoHub(pode);
  if (mapa) partes.push(mapa);

  return partes.join("\n\n");
}
