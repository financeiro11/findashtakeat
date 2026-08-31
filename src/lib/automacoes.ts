/* ---------------------------------------------------------------------------
 * O CATÁLOGO DAS AUTOMAÇÕES — o que cada cron faz, dito em português.
 *
 * `hub_automacoes()` devolve `jobname`, `schedule` e status. Isso responde "está
 * rodando?" para quem já sabe o que é `nota-propagar-varredura` — ou seja, para
 * quem escreveu. Quem abre o painel para conferir precisa da outra metade: o que
 * aquilo faz e em que ponto da esteira ele entra.
 *
 * A ESTEIRA DAS NOTAS É UMA CORRENTE, e é por isso que ela aparece separada das
 * outras 30 automações. Uma nota que vai parar dentro do Omie passa por cinco
 * etapas em ordem — chegar, ser lida, casar com o título, subir e ser conferida
 * no ERP — e cada etapa tem uma FILA própria. Ver o cron sozinho não diz nada:
 * ele pode estar disparando de dez em dez minutos com a fila da etapa anterior
 * parada, e o número da tela não anda sem que nada acuse.
 *
 * As descrições são curtas de propósito. Elas existem para quem está perdido
 * ("o que é isso que vai rodar em 3 minutos?"), não para documentar a função.
 * ------------------------------------------------------------------------- */

export type Automacao = {
  jobname: string;
  schedule: string;
  ativo: boolean;
  alvo: string | null;
  chama_funcao: boolean;
  ultimo_em: string | null;
  status_http: number | null;
  resposta: string;
  aguardando: boolean;
  status_sql: string | null;
  erro_sql: string | null;
  falhas_24h: number;
  execucoes_24h: number;
};

export type Fila = { chave: string; rotulo: string; quantos: number };

export type EstadoHub = {
  automacoes: Automacao[];
  filas: Fila[];
  gerado_em: string;
};

/**
 * Falhou? A resposta HTTP manda quando existe; o `job_run_details` só responde
 * por quem não chama função nenhuma.
 *
 * A ORDEM IMPORTA e é o miolo deste painel: `job_run_details` diz `succeeded`
 * quando o SQL do cron rodou, e o SQL de todo cron aqui é um `net.http_post`,
 * que "sucede" mesmo quando a função devolve 500. Perguntar ao SQL primeiro
 * pintaria de verde exatamente o que está quebrado — foi assim que
 * `omie-cartao-nome` passou dias respondendo "Não autenticado." com o painel do
 * Supabase todo verde.
 */
/**
 * O 2xx QUE SE DESMENTE NO CORPO.
 *
 * Metade das funções do Hub devolve o erro com status 200 — `errorResponse` do
 * helper do Gemini e o `json({ error })` de várias delas não carimbam 4xx. Um
 * cron sem `x-cron-token` recebe de volta, com HTTP 200:
 *
 *     {"error":"Não autenticado."}          {"status":"erro","erro":"..."}
 *     {"ok":false,"error":"casar: ..."}
 *
 * Custou dois dias em 29/08/2026: treze crons perderam o token numa reescrita
 * (ver `20260829150000`), e só os dois que por acaso devolviam 401 acenderam a
 * faixa. Asaas, caixa do Omie, orçamento e estornos ficaram parados pintados de
 * verde — o painel dizia "está rodando" sobre uma sync que não rodou.
 *
 * A leitura é DELIBERADAMENTE ESTREITA: só três formas explícitas de dizer "não
 * deu", todas no topo do objeto. Procurar a palavra "erro" solta no corpo
 * pintaria de vermelho a rodada que responde `{"ok":true,"falhas":0,"erros":[]}`
 * — que é como quase toda função daqui relata sucesso.
 */
function corpoDesmente(resposta: string): boolean {
  if (!resposta) return false;
  let corpo: unknown;
  try {
    corpo = JSON.parse(resposta);
  } catch {
    return false; // resposta truncada ou não-JSON: o status que decida
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return false;
  const o = corpo as Record<string, unknown>;
  if (o.ok === false) return true;
  if (typeof o.error === "string" && o.error !== "") return true;
  if (o.status === "erro") return true;
  return false;
}

export function falhou(a: Automacao): boolean {
  if (!a.ativo) return false;
  /* O corpo vem ANTES do status: um 200 que diz `{"error":...}` é falha, e é
     justamente o caso que o status sozinho não enxerga. */
  if (a.status_http != null) return a.status_http >= 300 || corpoDesmente(a.resposta);
  if (a.chama_funcao) return false; // ainda não colheu resposta
  return a.status_sql != null && a.status_sql !== "succeeded";
}

export type Situacao =
  | "falha" | "esperando" | "sem_resposta" | "ok" | "sem_registro" | "desligada";

/**
 * As três formas de NÃO SABER têm nome próprio, e é isso que separa este painel
 * de um enfeite verde:
 *
 * • `sem_registro` — nenhuma execução guardada. O histórico dura sete dias e um
 *   cron mensal (capital de giro, planilha de assinaturas) passa a maior parte
 *   do tempo assim. Não é quebrado: é quem ainda não teve a vez.
 * • `esperando` — disparou agora e a resposta ainda não foi colhida (a colheita
 *   roda de cinco em cinco minutos; a resposta é assíncrona por construção).
 * • `sem_resposta` — o disparo saiu e o desfecho NUNCA foi lido: ou o pg_net
 *   desistiu de esperar, ou a resposta expirou antes da colheita, ou aquele cron
 *   ainda não passa por `disparar_automacao`. Aqui o `job_run_details` diria
 *   `succeeded` — ele considera sucesso o `net.http_post` ter sido enfileirado.
 *   Chamar isso de verde seria afirmar um 2xx que ninguém viu.
 */
export function situacao(a: Automacao): Situacao {
  if (!a.ativo) return "desligada";
  if (falhou(a)) return "falha";
  if (!a.ultimo_em) return "sem_registro";
  if (a.aguardando) return "esperando";
  if (a.chama_funcao && a.status_http == null) return "sem_resposta";
  return "ok";
}

/** O que cada automação faz — o nome do cron não conta a história para quem lê. */
export const O_QUE_FAZ: Record<string, string> = {
  "anexo-link-aquecer": "renova os links dos anexos do Omie (cada link vale só o dia)",
  "anexo-triagem-ia": "a IA olha o anexo duvidoso e diz se é mesmo a nota",
  "asaas-extrato-sync-diario": "baixa o extrato da conta Asaas",
  "asaas-janela-sync-diaria": "atualiza a janela de cobranças a receber",
  "asaas-sync-diario": "espelha as cobranças do Asaas aqui dentro",
  "assinaturas-sheet-sync-mensal": "lê a planilha de assinaturas do mês",
  "auditoria-anexo-varredura": "manda o comprovante para o título no Omie",
  "automacao-colher": "lê o que as funções responderam — é o que faz este painel dizer a verdade",
  "churn-sheet-sync-diario": "recalcula o churn a partir das bases",
  "comprovantes-drive-sync-diario": "recolhe os comprovantes das pastas do Drive",
  "editais-sync-diario": "varre as fontes de editais",
  "estornos-sync-asaas": "puxa os estornos do Asaas",
  "estornos-sync-planilha": "concilia os estornos com a planilha",
  "facilities-nf-varredura": "procura a nota das compras do Facilities",
  "facilities-radar-confirma-manha": "reconfere o achado antes de ele virar aviso",
  "facilities-radar-confirma-tarde": "reconfere o achado antes de ele virar aviso",
  "facilities-radar-manha": "consulta o preço dos alvos do radar",
  "facilities-radar-tarde": "consulta o preço dos alvos do radar",
  "gmail-nf-sync-horaria": "procura notas fiscais no e-mail",
  "hub-novidades-diario": "lê os commits publicados e escreve as novidades do Hub",
  "nf-emissao-diaria": "emite as NFS-e do dia, em lote",
  "nf-espelho-tarde": "reconfere no Omie o desfecho das emissões",
  "nf-preparar-cadastros": "cadastra no Omie o cliente que ainda não existe lá",
  "nf-sondar-config-asaas": "confere de quem é a nota daquele cliente: do Asaas ou nossa",
  "nota-baixar-link": "baixa a nota que chegou como link",
  "nota-ler-arquivo": "lê o arquivo da nota: valor, CNPJ e data",
  "email-responder-preparar":
    "prepara a tratativa dos e-mails acionáveis do briefing: a resposta e/ou a tarefa",
  "integracoes-checar":
    "confere se as portas do Hub para fora ainda abrem (Gmail, planilhas, Omie, Asaas, IA)",
  "automacoes-diagnosticar-dia":
    "a IA lê as automações que falharam e escreve a causa provável e o que fazer",
  "notas-explicar-rodada":
    "a IA explica por que a nota não casou e desempata quem tem vários títulos candidatos",
  "nota-propagar-varredura": "repete a nota nas demais parcelas do mesmo compromisso",
  "notas-acervo-casar": "casa a nota do acervo com o título do contas a pagar",
  "notas-arquivar-diaria": "arquiva o que já não pede atenção",
  "notas-diagnostico-manha": "mede o que ainda falta na esteira",
  "omie-anexos-varredura": "pergunta ao Omie, título a título, quais já têm anexo",
  "omie-caixa-sync-diario": "atualiza os saldos do painel Caixa",
  "omie-capital-giro-sync-mensal": "recalcula o capital de giro do mês",
  "omie-cartao-nome": "descobre o lojista por trás do lançamento de fatura",
  "omie-clientes-criar-diario": "cadastra no Omie os clientes que faltam",
  "omie-clientes-sync-semanal": "espelha o cadastro de clientes do Omie",
  "omie-contas-pagar-sync-diario": "espelha o contas a pagar do Omie",
  "omie-orcamento-sync-diario": "atualiza o realizado do orçamento",
  "omie-parcelas-anexo": "leva a mesma nota para as outras parcelas no Omie",
  "omie-titulo-texto-varredura-diaria": "guarda a observação dos títulos — é onde mora o lojista",
  "parametrizacao-evidencia-auditoria-diaria": "colhe da auditoria a evidência de CNPJ",
  "parametrizacao-planilhas-sync-semanal": "relê as planilhas que dão nome às contrapartes",
  "planilhas-nf-sync-diaria": "lê as planilhas de notas externas",
  "resumo_tarefas_semanal": "monta o resumo semanal das tarefas",
  "sync_rh_colaboradores": "espelha o Portal RH",
  "planilhas-nf-sync": "lê as planilhas de notas externas",
};

export type EtapaEsteira = {
  chave: string;
  titulo: string;
  /** O que acontece nesta etapa, numa frase. */
  explica: string;
  /** Os crons desta etapa, na ordem em que fazem sentido ser lidos. */
  jobs: string[];
  /** As filas de `hub_automacoes().filas` que medem o acúmulo NESTE ponto. */
  filas: string[];
};

/**
 * A esteira que leva a nota do fornecedor até dentro do Omie, em ordem.
 *
 * É esta a corrente que a pergunta "o cron das notas para o Omie está rodando?"
 * quer ver. Separar por etapa não é enfeite: a fila de uma etapa é o entulho da
 * anterior, e ver as duas coisas lado a lado é o que diz se o problema é um cron
 * parado ou trabalho a mais chegando.
 */
export const ESTEIRA_NOTAS: EtapaEsteira[] = [
  {
    chave: "chegar",
    titulo: "1 · A nota chega",
    explica: "e-mail, planilhas e pastas do Drive enchem o acervo",
    jobs: ["gmail-nf-sync-horaria", "planilhas-nf-sync-diaria", "comprovantes-drive-sync-diario", "nota-baixar-link"],
    filas: ["baixar_link"],
  },
  {
    chave: "ler",
    titulo: "2 · O Hub lê o arquivo",
    explica: "tira valor, CNPJ e data do documento — sem isso não há como casar",
    jobs: ["nota-ler-arquivo", "anexo-triagem-ia", "anexo-link-aquecer"],
    filas: ["ler_arquivo", "anexo_conferir"],
  },
  {
    chave: "casar",
    titulo: "3 · Casa com o título",
    explica: "acha no contas a pagar o compromisso daquela nota",
    jobs: ["notas-acervo-casar", "nota-propagar-varredura"],
    filas: ["espera_gente"],
  },
  {
    chave: "subir",
    titulo: "4 · Sobe para o Omie",
    explica: "o anexo entra no título dentro do ERP",
    jobs: ["auditoria-anexo-varredura", "omie-parcelas-anexo"],
    filas: ["anexo_erp"],
  },
  {
    chave: "conferir",
    titulo: "5 · Confere no ERP",
    explica: "pergunta ao próprio Omie o que de fato está lá",
    jobs: ["omie-anexos-varredura", "notas-diagnostico-manha", "notas-arquivar-diaria"],
    filas: [],
  },
];

/** Todos os crons da esteira das notas, para marcá-los onde eles aparecerem. */
export const DA_ESTEIRA: Set<string> = new Set(ESTEIRA_NOTAS.flatMap((e) => e.jobs));

/**
 * A fila que a faixa do topo mostra: a última da corrente, a que responde
 * "quanta nota ainda falta subir para o Omie?".
 */
export const FILA_DESTAQUE = "anexo_erp";
