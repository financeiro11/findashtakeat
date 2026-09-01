/* ---------------------------------------------------------------------------
 * Notas Fiscais — as regras que decidem o que a tela deixa emitir.
 *
 * A SITUAÇÃO de cada cobrança é calculada no Postgres (`notas_fiscais_painel`),
 * porque depende de cruzar três tabelas e da data de corte. O que mora aqui é o
 * degrau seguinte, que é decisão de INTERFACE e não de dado: dessa situação, o
 * que a pessoa pode selecionar para o lote — e, quando não pode, por quê.
 *
 * Está em módulo puro (sem React, sem Supabase) por um motivo prático: é a regra
 * que evita mandar uma emissão fiscal indevida, e regra assim se testa com
 * `vitest` em vez de se conferir clicando.
 * ------------------------------------------------------------------------- */

export type Situacao =
  | "nao_exige"
  | "emitida_asaas"
  | "emitida_omie"
  | "nota_rejeitada"
  | "em_processamento"
  | "nota_a_cancelar"
  | "falta";

export interface LinhaNota {
  id_asaas: string;
  descricao: string | null;
  cliente_asaas: string | null;
  cnpj_cpf: string | null;
  valor: number;
  data_vencimento: string | null;
  data_pagamento: string | null;
  status_asaas: string | null;
  estornado: boolean;
  nf_asaas_status: string | null;
  nf_asaas_numero: string | null;
  n_cod_os: number | null;
  os_etapa: string | null;
  os_faturada: boolean | null;
  nfse_numero: string | null;
  nfse_status: string | null;
  nfse_xml: string | null;
  /** Os 50 dígitos que abrem a nota no Portal Nacional — ver `linkPortalNacional`. */
  nfse_chave: string | null;
  /** A recusa da prefeitura, em português. É o que diz o que consertar. */
  nfse_mensagem: string | null;
  situacao: Situacao;
}

/**
 * A recusa da prefeitura reduzida ao que se lê de relance.
 *
 * As mensagens vêm com o código colado na frase ("E0240 : O CEP informado para o
 * endereço nacional do tomador do serviço não existe ou não pertence ao município
 * do endereço do tomador.") — bom para agrupar, comprido demais para uma linha de
 * tabela. O texto inteiro continua no `title`, que é a convenção do projeto para
 * o que foi encurtado.
 */
export function motivoCurto(msg: string | null): string | null {
  if (!msg) return null;
  const s = msg.trim();
  if (/E0240/.test(s)) return "CEP do tomador não confere com o município";
  if (/E092[12]/.test(s)) return "Código do município do tomador";
  if (/403|acesso negado|forbidden/i.test(s)) return "Prefeitura recusou a conexão (403)";
  if (/nenhuma resposta/i.test(s)) return "Prefeitura não respondeu";
  if (/e-?mail/i.test(s)) return "Cliente sem e-mail";
  // Sem regra conhecida: mostra o começo da frase do Omie, sem o código.
  return s.replace(/^E\d+\s*:\s*/, "").slice(0, 60);
}

/** Como cada situação se apresenta. `tom` casa com os tokens semânticos do tema. */
export const SITUACOES: Record<Situacao, { rotulo: string; tom: "ok" | "aviso" | "erro" | "neutro"; ajuda: string }> = {
  emitida_omie: {
    rotulo: "Emitida no Omie",
    tom: "ok",
    ajuda: "OS faturada e RPS autorizado pela prefeitura.",
  },
  // ANTES E DEPOIS DO CORTE SÃO A MESMA SITUAÇÃO, e isso é uma correção de
  // 31/08/2026. A classificação só valia antes do corte, e por isso 1.035
  // cobranças de agosto com nota autorizada do Asaas apareciam como "Sem nota"
  // — com o número da nota impresso na coluna ao lado. O corte responde "quem
  // emite de agora em diante?", pergunta da fila; a situação responde "esta
  // cobrança tem nota?", e nota autorizada é nota independente de data.
  emitida_asaas: {
    rotulo: "Emitida no Asaas",
    tom: "ok",
    ajuda: "Nota autorizada pelo Asaas — não precisa sair de novo pelo Omie. Depois do corte isto é o paralelo: os dois emitem, e quem chegou primeiro vale.",
  },
  // "Faturado (NFS-e rejeitada)" é o nome que a própria tela do Omie dá ao
  // cStatusRps '003'. A OS foi faturada, o RPS foi enviado e a prefeitura
  // RECUSOU — sem número, sem XML. Chamar isso de "em processamento" sugeriria
  // que o tempo resolve, e não resolve: é receita faturada sem nota válida.
  nota_rejeitada: {
    rotulo: "NFS-e rejeitada",
    tom: "erro",
    ajuda: "A prefeitura recusou o RPS. A OS consta faturada mas não existe nota fiscal válida — precisa ser corrigida e reenviada no Omie.",
  },
  em_processamento: {
    rotulo: "Em processamento",
    tom: "aviso",
    ajuda: "A OS foi faturada e o RPS ainda não voltou da prefeitura. Este caso o próximo 'Atualizar do Omie' resolve sozinho.",
  },
  nota_a_cancelar: {
    rotulo: "Nota a cancelar",
    tom: "erro",
    ajuda: "A cobrança foi estornada e a nota continua de pé. O cancelamento é feito no Omie ou no Asaas.",
  },
  falta: {
    rotulo: "Sem nota",
    tom: "erro",
    ajuda: "Cobrança recebida sem nota em lugar nenhum.",
  },
  nao_exige: {
    rotulo: "Não exige",
    tom: "neutro",
    ajuda: "Cobrança não recebida — pendente, vencida ou cancelada.",
  },
};

/**
 * O status da cobrança no Asaas, em português e com peso visual.
 *
 * RECEBIDA E CONFIRMADA NÃO SÃO A MESMA COISA, e a diferença é dinheiro:
 * `CONFIRMED` é cartão autorizado cuja liquidação ainda não caiu na conta;
 * `RECEIVED` é o dinheiro já disponível. As duas EXIGEM nota — o fato gerador do
 * ISS é a prestação do serviço, não a liquidação —, mas só a recebida ENTRA no
 * lote: uma autorização pode não liquidar (chargeback, cancelamento, falha na
 * captura), e a nota emitida sobre ela vira imposto sobre receita que nunca
 * existiu, desfeito só por cancelamento com prazo e justificativa. Esperar
 * alguns dias é barato; errar não. A confirmada volta sozinha à fila no dia em
 * que o dinheiro entrar. Daí tons diferentes para as duas.
 */
export const STATUS_ASAAS: Record<string, { rotulo: string; tom: "ok" | "aviso" | "erro" | "neutro"; ajuda: string }> = {
  RECEIVED:         { rotulo: "Recebida",   tom: "ok",     ajuda: "Dinheiro disponível na conta." },
  RECEIVED_IN_CASH: { rotulo: "Recebida",   tom: "ok",     ajuda: "Recebida em dinheiro, fora do Asaas." },
  CONFIRMED:        { rotulo: "Confirmada", tom: "aviso",  ajuda: "Pagamento autorizado, liquidação ainda não caiu na conta. Exige nota, mas só depois de liquidar — entra na fila sozinha no dia em que o dinheiro entrar." },
  PENDING:          { rotulo: "Pendente",   tom: "neutro", ajuda: "Ainda não paga." },
  OVERDUE:          { rotulo: "Vencida",    tom: "erro",   ajuda: "Venceu sem pagamento." },
  AWAITING_RISK_ANALYSIS: { rotulo: "Em análise", tom: "neutro", ajuda: "Em análise de risco pelo Asaas." },
  REFUNDED:         { rotulo: "Estornada",  tom: "erro",   ajuda: "Devolvida ao cliente." },
  REFUND_REQUESTED: { rotulo: "Estorno pedido", tom: "erro", ajuda: "Estorno solicitado, dinheiro ainda não saiu." },
  REFUND_IN_PROGRESS: { rotulo: "Estornando", tom: "erro", ajuda: "Estorno agendado para depois da liquidação." },
  CHARGEBACK_REQUESTED: { rotulo: "Chargeback", tom: "erro", ajuda: "Contestação aberta pelo cliente." },
  CHARGEBACK_DISPUTE:   { rotulo: "Chargeback", tom: "erro", ajuda: "Contestação em disputa." },
  AWAITING_CHARGEBACK_REVERSAL: { rotulo: "Chargeback", tom: "erro", ajuda: "Aguardando reversão da contestação." },
};

/** O status traduzido; status desconhecido volta cru, para não esconder o que é novo. */
export function statusAsaas(s: string | null | undefined) {
  const k = String(s ?? "").toUpperCase();
  return STATUS_ASAAS[k] ?? { rotulo: k || "—", tom: "neutro" as const, ajuda: "Status não mapeado — veja no Asaas." };
}

/** A cobrança já foi paga? (as duas formas contam) */
export const foiPaga = (s: string | null | undefined) =>
  ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(String(s ?? "").toUpperCase());

/**
 * Os status que podem virar nota. Note que `CONFIRMED` está fora e `foiPaga` o
 * inclui: são perguntas diferentes — "esta cobrança foi paga?" (sim, autorizada)
 * e "o dinheiro está na conta a ponto de virar imposto?" (ainda não).
 */
export const EMITIVEIS = ["RECEIVED", "RECEIVED_IN_CASH"];

/**
 * A RÉGUA LARGA — a da nota AVULSA.
 *
 * São duas réguas e não uma afrouxada, e a diferença entre elas não é o direito
 * de emitir: a confirmada exige nota tanto quanto a recebida, porque o fato
 * gerador do ISS é a prestação do serviço e não a liquidação. O que separa as
 * duas é QUEM RESPONDE se a liquidação nunca vier — cartão autorizado pode não
 * liquidar (chargeback, cancelamento, falha na captura), e a nota emitida sobre
 * ele vira imposto sobre receita que não existiu.
 *
 * Numa rodada automática não há a quem perguntar, então ela fica na régua
 * estreita — foi a decisão de 20/08/26 e continua de pé. Na avulsa há: alguém
 * abriu o painel, achou a cobrança, ligou a chave e mandou, e o nome dessa
 * pessoa fica em `nf_emissoes.avulsa` junto com o operador. Esperar é barato
 * quando dá para esperar; a avulsa existe para quando não dá.
 *
 * O QUE ELA NÃO ALCANÇA, e não há chave que abra: estorno (nas três caras),
 * pendente, vencida — e nenhuma das guardas de duplicata, que respondem "esta
 * nota já saiu?" e não têm urgência do outro lado.
 */
export const EMITIVEIS_AVULSA = [...EMITIVEIS, "CONFIRMED"];

/**
 * Por que esta linha NÃO pode entrar num lote de emissão. `null` = pode.
 *
 * A ordem importa: o primeiro motivo é o que aparece na tela, e o mais grave tem
 * de vir primeiro. Emitir nota de cobrança estornada é pior do que emitir uma
 * segunda via de algo que já tem nota — a primeira cria imposto sobre receita que
 * não existe.
 *
 * ESTA FUNÇÃO NÃO É MAIS A ÚNICA GUARDA, e isso é uma correção e não um detalhe.
 * Enquanto ela era, a regra valia só para quem passava pela tela: a Edge Function
 * `omie-nfse-sync` recebia uma lista de ids e emitia sem perguntar o status. Hoje
 * a mesma regra está no Postgres (`nfse_bloqueio_emissao`) e é conferida ao vivo
 * contra o Asaas no instante da emissão. O que sobrou aqui é o papel que sempre
 * foi o dela: explicar à pessoa, ANTES do clique, por que a caixa não marca.
 */
export function motivoBloqueio(
  l: Pick<LinhaNota, "situacao" | "estornado" | "status_asaas" | "cnpj_cpf" | "valor" | "data_vencimento" | "data_pagamento"> & { nfse_mensagem?: string | null },
  opts: { avulsa?: boolean } = {},
): string | null {
  const avulsa = opts.avulsa === true;
  // O estorno é o primeiro e é o que a avulsa NÃO alcança — de propósito, e
  // acima de tudo o resto.
  if (l.estornado) return "Cobrança estornada — emitir criaria imposto sobre receita devolvida.";
  if (l.situacao === "emitida_omie") return "Já tem NFS-e autorizada no Omie.";
  if (l.situacao === "emitida_asaas") return "Já tem nota autorizada no Asaas.";
  // Rejeitada NÃO libera emissão daqui: a OS já está faturada no Omie: emitir de
  // novo criaria uma segunda OS para a mesma cobrança. O conserto é reenviar o
  // RPS no Omie, corrigindo o que a prefeitura recusou.
  if (l.situacao === "nota_rejeitada") {
    // Com o motivo em mãos, o bloqueio deixa de ser "não pode" e vira instrução.
    const m = motivoCurto(l.nfse_mensagem ?? null);
    return m
      ? `${m}. Corrija o cadastro e reenvie pelo Omie — emitir aqui duplicaria a OS.`
      : "A prefeitura rejeitou o RPS. Corrija e reenvie pelo Omie — emitir aqui duplicaria a OS.";
  }
  if (l.situacao === "em_processamento") return "A OS já foi faturada; o RPS está a caminho.";
  /* O dinheiro, pelo STATUS e não pela situação: `nao_exige` só cobre quem nunca
   * foi paga, e a confirmada é classificada como "falta" — ela é receita que
   * ainda pode não acontecer, não receita ausente. */
  const st = String(l.status_asaas ?? "").toUpperCase();
  const regua = avulsa ? EMITIVEIS_AVULSA : EMITIVEIS;
  if (st === "CONFIRMED" && !avulsa) {
    return "Cobrança confirmada e ainda não liquidada — a nota sai sozinha no dia em que o dinheiro entrar. " +
      "Para emiti-la agora, ligue a chave \"Avulsa\".";
  }
  if (st && !regua.includes(st)) {
    return "A cobrança não foi recebida." + (avulsa ? " A avulsa vai até a confirmada e não além." : "");
  }
  /* `nao_exige` é a situação de quem nunca foi paga, e a avulsa não a resgata:
   * se o status já disse "confirmada" o `if` acima liberou, e o que sobra aqui
   * é pendente, vencida ou cancelada — nenhuma delas vira nota por atalho. */
  if (l.situacao === "nao_exige") return "A cobrança não foi recebida.";
  if (!l.cnpj_cpf) return "Cliente sem CNPJ/CPF no Asaas — sem documento não há como achar o cadastro no Omie.";
  if (!(Number(l.valor) > 0)) return "Valor zerado ou negativo.";
  if (!l.data_vencimento && !l.data_pagamento) return "Cobrança sem data.";
  return null;
}

export const podeEmitir = (
  l: Parameters<typeof motivoBloqueio>[0],
  opts: { avulsa?: boolean } = {},
): boolean => motivoBloqueio(l, opts) === null;

/**
 * Esta linha só sai como AVULSA?
 *
 * É a diferença entre as duas réguas, medida linha a linha — e é ela que a tela
 * usa para pôr o selo âmbar. Sem o selo, ligar a chave "Avulsa" faria caixas
 * novas se acenderem no meio da lista sem que nada dissesse QUAIS mudaram nem
 * por quê: o operador veria mais opções e não veria mais risco.
 */
export const exigeAvulsa = (l: Parameters<typeof motivoBloqueio>[0]): boolean =>
  !podeEmitir(l) && podeEmitir(l, { avulsa: true });

/**
 * O que o lote vai fazer, antes de fazer.
 *
 * `bloqueadas` não é erro — é o número que explica por que "selecionei 50 e ele
 * mandou 47". Sem ele a diferença parece perda silenciosa.
 *
 * `confirmadas` é o mesmo raciocínio aplicado à régua larga: das que VÃO sair,
 * quantas estão saindo antes de o dinheiro entrar. É o número que o aviso de
 * confirmação precisa dizer em voz alta — "emitir 12 notas" e "emitir 12 notas,
 * 5 delas sobre cobrança que ainda não liquidou" são dois pedidos diferentes.
 */
export function resumoLote(
  linhas: LinhaNota[], selecionados: Set<string>,
  opts: { avulsa?: boolean } = {},
) {
  const sel = linhas.filter((l) => selecionados.has(l.id_asaas));
  const podem = sel.filter((l) => podeEmitir(l, opts));
  const motivos = new Map<string, number>();
  for (const l of sel) {
    const m = motivoBloqueio(l, opts);
    if (m) motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
  return {
    selecionadas: sel.length,
    emitiveis: podem.length,
    bloqueadas: sel.length - podem.length,
    // Só entre as que realmente vão sair: contar as bloqueadas aqui inflaria o
    // aviso com cobranças que ninguém vai emitir.
    confirmadas: podem.filter((l) => exigeAvulsa(l)).length,
    valor: podem.reduce((s, l) => s + Number(l.valor || 0), 0),
    valorConfirmadas: podem.filter((l) => exigeAvulsa(l)).reduce((s, l) => s + Number(l.valor || 0), 0),
    motivos: [...motivos.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/**
 * A URL pública do XML que o Omie devolve é ASSINADA e EXPIRA (o `Expires` da
 * query é um timestamp Unix, medido em ~24h). Guardá-la no espelho é útil para
 * não reconsultar o Omie a cada abertura da tela, mas oferecer um link morto é
 * pior do que não oferecer link nenhum — quem clica acha que o sistema perdeu a
 * nota. Por isso a tela pergunta antes se ainda vale.
 */
export function xmlAindaVale(url: string | null, agora = Date.now()): boolean {
  if (!url) return false;
  const m = url.match(/[?&]Expires=(\d+)/);
  if (!m) return true; // sem carimbo de validade: deixa tentar
  return Number(m[1]) * 1000 > agora;
}

/* ---------------------------------------------------------------------------
 * A NOTA NO PORTAL NACIONAL — o endereço que não expira.
 *
 * O link do XML acima é do CDN do Omie e morre em ~24h; passado um dia, a nota
 * emitida não tinha endereço nenhum aqui dentro. A chave de acesso resolve isso
 * porque não é um link: é a IDENTIDADE da nota, e o Portal Nacional da NFS-e
 * (nfse.gov.br) abre qualquer NFS-e do país a partir dela, para sempre.
 *
 * DE ONDE VEM A CHAVE. Do campo que o Omie chama de `cCodVerif` e o Hub grava em
 * `nf_os_omie.nfse_verificacao`. O nome engana: no padrão ABRASF antigo ele era
 * um código curto de verificação, mas no padrão NACIONAL o que vem ali são os 50
 * dígitos da chave — município (7) + ambiente (1) + tipo de inscrição (1) + CNPJ
 * (14) + número da NFS-e (13) + AAMM (4) + código numérico (9) + DV (1).
 *
 * POR QUE SÓ O TAMANHO É CONFERIDO, e não o dígito verificador: a checagem que
 * importa é distinguir a chave de 50 dígitos do código curto do padrão antigo —
 * essa o `\d{50}` faz. Recalcular o DV para recusar a chave que o Omie mandou
 * seria o Hub arbitrando contra a prefeitura: se a chave estiver torta, quem tem
 * de dizer isso é o portal, e ele diz. O que não se pode é oferecer link para o
 * que claramente não é chave.
 * ------------------------------------------------------------------------- */

/** A chave de acesso da NFS-e do padrão nacional: 50 dígitos, nada mais. */
export const chaveNfseValida = (chave: string | null | undefined): boolean =>
  /^\d{50}$/.test(String(chave ?? "").trim());

/**
 * O link da consulta pública. `tpc=1` é "por chave de acesso" e `chave` já chega
 * preenchida no formulário — é o mesmo endereço que o QR Code do DANFSe carrega.
 *
 * O portal ainda pede o captcha antes de mostrar a nota, e isso não tem volta
 * pelo link: é a proteção da consulta pública. O que o link poupa é o resto —
 * achar o portal, escolher o tipo de consulta e digitar 50 dígitos sem errar.
 */
export function linkPortalNacional(chave: string | null | undefined): string | null {
  const c = String(chave ?? "").trim();
  if (!chaveNfseValida(c)) return null;
  return `https://www.nfse.gov.br/consultapublica/?tpc=1&chave=${c}`;
}

/** "3205 3092 2375 …" — 50 dígitos seguidos ninguém confere a olho. */
export const chaveEmBlocos = (chave: string | null | undefined): string =>
  String(chave ?? "").trim().replace(/(\d{4})(?=\d)/g, "$1 ");

/** "37511891000150" → "37.511.891/0001-50"; CPF de 11 → "064.191.081-95". */
export function formatarDoc(doc: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc ?? "";
}

/* ---------------------------------------------------------------------------
 * AUDITORIA — a leitura do que a RPC `notas_fiscais_auditoria` devolve.
 *
 * A tela de auditoria existe porque a fila da emissão descarta em silêncio: os
 * dois `join` que ligam cobrança → cliente do Asaas → cadastro do Omie não
 * devolvem erro quando não casam, devolvem ausência. O que está aqui embaixo é
 * como essa ausência vira frase em português — e a frase é o produto, porque o
 * conserto (cadastrar, corrigir CNPJ) acontece no Omie, fora daqui.
 * ------------------------------------------------------------------------- */

export type Balde =
  | "nota_omie" | "nota_asaas" | "nao_exige" | "estornada"
  | "fila" | "aguardando_liquidar" | "em_processamento"
  | "antes_do_corte" | "nota_rejeitada" | "nota_a_cancelar" | "sombra"
  | "cadastro_divergente" | "sem_cadastro_omie" | "sem_documento" | "sem_cliente";

export type ClasseProntidao = "ok" | "cadastro_divergente" | "sem_cadastro_omie" | "sem_documento" | "sem_cliente";

export interface AuditoriaBalde { balde: Balde; cobrancas: number; valor: number }
export interface AuditoriaProntidao { classe: ClasseProntidao; cobrancas: number; valor: number; clientes: number }

export interface ClienteFaltante {
  doc: string;
  nome: string;
  cobrancas: number;
  valor: number;
  ultima: string | null;
  /** Quantas dessas cobranças JÁ estão sem nota hoje (o resto o Asaas cobriu). */
  sem_nota_hoje: number;
  classe: "cadastro_divergente" | "sem_cadastro_omie";
  omie_nome: string | null;
  omie_doc: string | null;
  /** Força da semelhança de nome (0–1). Só existe quando o par veio por nome. */
  forca: number | null;
  /** Como o par foi achado: pela raiz do CNPJ (quase certeza) ou pelo nome (palpite). */
  via: "raiz" | "nome" | null;
}

export interface AuditoriaMeta {
  de: string; ate: string;
  corte: string | null;
  corte_vigente: boolean;
  cadastro_omie_em: string | null;
  cadastro_omie_qtd: number;
  docs_duplicados: number;
  total_cobrancas: number;
  total_valor: number;
}

export interface Auditoria {
  meta: AuditoriaMeta;
  baldes: AuditoriaBalde[];
  prontidao: AuditoriaProntidao[];
  clientes: ClienteFaltante[];
}

/**
 * Os baldes da partição, agrupados pelo que significam para quem audita.
 *
 * `grupo` é o que separa "está resolvido" de "vai dar problema": a tela mostra os
 * três grupos em ordem invertida (o que trava primeiro), porque uma lista
 * alfabética esconderia as 40 cobranças sem cadastro no meio de 2.400 resolvidas.
 */
export const BALDES: Record<Balde, { rotulo: string; tom: "ok" | "aviso" | "erro" | "neutro"; grupo: "resolvido" | "andamento" | "travado"; ajuda: string }> = {
  nota_omie:        { rotulo: "Nota emitida no Omie", tom: "ok", grupo: "resolvido", ajuda: "NFS-e autorizada pela prefeitura." },
  nota_asaas:       { rotulo: "Nota emitida no Asaas", tom: "ok", grupo: "resolvido", ajuda: "Nota autorizada pelo Asaas. Vale antes e depois do corte: no paralelo os dois emitem, e a nota dele é nota igual." },
  nao_exige:        { rotulo: "Não exige nota", tom: "neutro", grupo: "resolvido", ajuda: "Cobrança não recebida — pendente, vencida ou cancelada." },
  estornada:        { rotulo: "Estornada", tom: "neutro", grupo: "resolvido", ajuda: "Dinheiro devolvido ao cliente; não há receita para tributar." },

  fila:             { rotulo: "Na fila de emissão", tom: "ok", grupo: "andamento", ajuda: "Tem cliente no Omie e nada a bloqueia: a rodada diária emite." },
  aguardando_liquidar: { rotulo: "Aguardando liquidar", tom: "aviso", grupo: "andamento", ajuda: "Cartão autorizado e ainda não liquidado. A emissão automática só pega o que entrou; entra sozinha na fila no dia em que liquidar." },
  em_processamento: { rotulo: "No forno do Omie", tom: "aviso", grupo: "andamento", ajuda: "A OS foi faturada e o RPS ainda não voltou da prefeitura." },

  antes_do_corte:   { rotulo: "Sem nota, antes do corte", tom: "erro", grupo: "travado", ajuda: "Recebida antes da data de corte e sem nota em sistema nenhum — o Asaas era quem devia ter emitido." },
  nota_rejeitada:   { rotulo: "NFS-e rejeitada", tom: "erro", grupo: "travado", ajuda: "OS faturada e RPS recusado pela prefeitura: receita faturada sem nota válida. O reenvio é botão da tela do Omie." },
  nota_a_cancelar:  { rotulo: "Nota a cancelar", tom: "erro", grupo: "travado", ajuda: "Cobrança estornada com a nota de pé." },
  sombra:           { rotulo: "Barrada como duplicata", tom: "aviso", grupo: "travado", ajuda: "Já existe nota do mesmo documento, mesmo valor e mesmo mês. A guarda é frouxa de propósito: pode estar segurando emissão legítima — confira no Omie." },
  cadastro_divergente: { rotulo: "Cadastro divergente no Omie", tom: "erro", grupo: "travado", ajuda: "O cliente existe no Omie com OUTRO documento. A fila não o encontra, e cadastrar de novo emitiria para o tomador errado." },
  sem_cadastro_omie:{ rotulo: "Cliente não cadastrado no Omie", tom: "erro", grupo: "travado", ajuda: "Não há cadastro equivalente no Omie. A cobrança some da fila sem erro." },
  sem_documento:    { rotulo: "Cliente sem CNPJ/CPF", tom: "erro", grupo: "travado", ajuda: "O cadastro no Asaas está sem documento — sem ele não há como achar o cliente no Omie." },
  sem_cliente:      { rotulo: "Cliente fora do espelho", tom: "erro", grupo: "travado", ajuda: "A cobrança aponta para um cliente que a carga local do Asaas não tem. É buraco de espelho: rode a carga histórica de clientes." },
};

export const PRONTIDAO: Record<ClasseProntidao, { rotulo: string; tom: "ok" | "aviso" | "erro"; ajuda: string }> = {
  ok:                  { rotulo: "Prontas para emitir", tom: "ok", ajuda: "O cliente tem cadastro no Omie com o mesmo documento do Asaas." },
  cadastro_divergente: { rotulo: "Cadastro divergente", tom: "erro", ajuda: "Existe cadastro parecido no Omie com outro documento. Precisa de decisão humana: qual documento é o verdadeiro." },
  sem_cadastro_omie:   { rotulo: "Sem cadastro no Omie", tom: "erro", ajuda: "Não há nada equivalente no Omie. Falta cadastrar o cliente." },
  sem_documento:       { rotulo: "Sem CNPJ/CPF no Asaas", tom: "erro", ajuda: "Falta o documento no cadastro do Asaas." },
  sem_cliente:         { rotulo: "Cliente fora do espelho", tom: "erro", ajuda: "A carga local do Asaas não tem esse cliente." },
};

/**
 * A resposta em números: quantas cobranças do período NÃO sairiam se o Omie
 * tivesse de emitir todas.
 *
 * Mede a prontidão e não os baldes porque enquanto o Asaas ainda emite, o buraco
 * está tapado por fora — e o dia do corte destapa tudo de uma vez.
 */
export function vereditoProntidao(prontidao: AuditoriaProntidao[]) {
  const bloqueio = prontidao.filter((p) => p.classe !== "ok");
  const total = prontidao.reduce((s, p) => s + p.cobrancas, 0);
  const cobrancas = bloqueio.reduce((s, p) => s + p.cobrancas, 0);
  return {
    total,
    cobrancas,
    valor: bloqueio.reduce((s, p) => s + Number(p.valor || 0), 0),
    clientes: bloqueio.reduce((s, p) => s + p.clientes, 0),
    pronto: cobrancas === 0,
    /** Fração das cobranças do período que sairia sem intervenção. */
    cobertura: total > 0 ? (total - cobrancas) / total : 1,
  };
}

/**
 * O que fazer com este cliente — instrução, não rótulo.
 *
 * A distinção entre `raiz` e `nome` é a que muda a ação, e por isso ela vem antes
 * de tudo: raiz igual é a MESMA EMPRESA em outro estabelecimento, e nesse caso
 * "cadastrar" é o conserto errado duas vezes (cria duplicado E emite na filial
 * errada). Nome parecido é só coincidência a conferir.
 */
export function oQueFazer(c: Pick<ClienteFaltante, "classe" | "via" | "omie_nome" | "omie_doc">): string {
  if (c.classe === "sem_cadastro_omie" || !c.omie_doc) {
    return "Cadastrar o cliente no Omie com este CNPJ/CPF — é o que o botão faz.";
  }
  if (c.via === "raiz") {
    return `Mesma empresa, outro estabelecimento: o Omie tem "${c.omie_nome}" em ${formatarDoc(c.omie_doc)}. ` +
      "Confirme qual filial presta o serviço — emitir contra o cadastro existente põe a nota no CNPJ errado.";
  }
  return `O Omie tem "${c.omie_nome}" em ${formatarDoc(c.omie_doc)}, com nome igual e documento diferente. ` +
    "Um dos dois cadastros está com o documento errado; corrija na origem antes de emitir.";
}

/**
 * Há quantos dias o cadastro de clientes do Omie foi lido.
 *
 * Importa porque o `omie-clientes-sync` roda semanalmente (segunda, 05h BRT) e a
 * emissão roda todo dia: um cliente que entrou na terça só aparece no cadastro
 * local na segunda seguinte, e até lá suas cobranças caem em "sem cadastro" sem
 * que nada esteja errado no Omie. Sem este número, a auditoria acusaria o
 * inocente.
 */
export function diasDoCadastro(iso: string | null, agora = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((agora - t) / 86_400_000));
}

/* ---------------------------------------------------------------------------
 * CADASTRO NO OMIE — o desfecho de quem a auditoria acusou.
 *
 * A aba nasceu só apontando o buraco ("o conserto acontece no Omie"). Agora o
 * conserto tem botão: `omie-clientes-criar` cria o cadastro faltante a partir do
 * cliente do Asaas. O que mora aqui é a leitura do resultado — o que a tabela
 * `omie_clientes_criados` guarda vira frase em português.
 *
 * A DIFERENÇA QUE IMPORTA na leitura é `criado` × `ja_existia`: os dois são boa
 * notícia (o cadastro está lá), mas o segundo quer dizer que o ERRO estava no
 * espelho local, não no Omie — o cliente sempre esteve cadastrado e a leitura
 * semanal é que não o tinha visto.
 * ------------------------------------------------------------------------- */

export type CadastroSituacao = "criado" | "ja_existia" | "bloqueado" | "falhou";

export interface CadastroNoOmie {
  doc: string;
  nome: string | null;
  n_cod_cli: number | null;
  situacao: CadastroSituacao;
  motivo: string | null;
  /** De onde veio o endereço que foi cadastrado. */
  fonte_endereco: "receita" | "cep" | "asaas" | null;
  tentativas: number;
  atualizado_em: string;
}

/**
 * Por que o cadastro não foi criado — em português e com o que fazer junto.
 *
 * Nenhum destes é falha do Omie: são dados do cliente que não sustentam uma nota
 * fiscal. Dizer "erro ao cadastrar" mandaria a pessoa tentar de novo, e tentar
 * de novo não conserta um CEP que não existe.
 */
export const BLOQUEIOS_CADASTRO: Record<string, string> = {
  cep_inexistente:
    "O CEP do cliente não existe nos Correios. É o mesmo erro (E0240) que prende a nota na prefeitura — " +
    "corrija o CEP no Asaas e tente de novo.",
  cnpj_nao_encontrado_na_receita:
    "O CNPJ fecha no dígito verificador mas a Receita não o conhece. Confira o número no cadastro do Asaas.",
  endereco_incompleto:
    "Falta endereço para montar o cadastro, e as consultas de CNPJ e CEP não responderam. Tente de novo mais tarde.",
  documento_invalido:
    "O CPF/CNPJ do Asaas não fecha no dígito verificador: é número errado, não decisão a tomar.",
  cadastro_divergente:
    "Existe cadastro parecido no Omie com outro documento. Cadastrar sem decidir criaria duplicado.",
  sem_cliente_no_espelho:
    "A carga local do Asaas não tem este cliente, então não há endereço para mandar.",
};

export const FONTE_ENDERECO: Record<string, string> = {
  receita: "endereço e razão social da Receita Federal",
  cep: "endereço do Asaas com cidade e UF conferidas pelo CEP",
  asaas: "endereço do Asaas, sem conferência externa",
};

/** O selo de uma linha já trabalhada: o que aconteceu, e com que peso. */
export function recadoDoCadastro(c: CadastroNoOmie): { rotulo: string; tom: "ok" | "aviso" | "erro"; ajuda: string } {
  if (c.situacao === "criado") {
    return {
      rotulo: "Cadastrado no Omie",
      tom: "ok",
      ajuda: `Criado com ${FONTE_ENDERECO[c.fonte_endereco ?? "asaas"] ?? "os dados do Asaas"}` +
        `${c.n_cod_cli ? ` — código ${c.n_cod_cli} no Omie` : ""}.`,
    };
  }
  if (c.situacao === "ja_existia") {
    return {
      rotulo: "Já estava no Omie",
      tom: "ok",
      ajuda: "O Omie recusou por documento repetido: o cadastro existe e quem estava desatualizado era o espelho local.",
    };
  }
  if (c.situacao === "bloqueado") {
    return {
      rotulo: "Não dá para cadastrar",
      tom: "aviso",
      ajuda: BLOQUEIOS_CADASTRO[c.motivo ?? ""] ?? c.motivo ?? "Bloqueado.",
    };
  }
  return {
    rotulo: "O Omie recusou",
    tom: "erro",
    ajuda: c.motivo ?? "Recusa sem mensagem.",
  };
}

/** A lista dos faltantes em texto, para colar onde o conserto acontece. */
export function clientesEmTexto(clientes: ClienteFaltante[]): string {
  const linhas = clientes.map((c) => [
    c.nome,
    formatarDoc(c.doc),
    c.classe === "cadastro_divergente" ? "cadastro divergente" : "sem cadastro",
    c.omie_doc ? `${c.omie_nome} (${formatarDoc(c.omie_doc)})` : "",
    String(c.cobrancas),
    `R$ ${Number(c.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  ].join("\t"));
  return ["Cliente\tCNPJ/CPF no Asaas\tSituação\tCadastro parecido no Omie\tCobranças\tValor", ...linhas].join("\n");
}

/* ---------------------------------------------------------------------------
 * EMISSÃO EM MASSA — o motor de fechamento de mês, do lado do navegador.
 *
 * POR QUE ISTO EXISTE DO LADO DE CÁ. A edge function morre aos 150s e uma leva
 * de 20 cobranças já come 116s deles (duas chamadas Omie seriais por cobrança:
 * IncluirOS + TrocarEtapaOS). Não há como pedir 900 notas numa chamada — nem
 * como pedir 50, que é o `teto_lote` no papel. Quem quiser emitir o mês inteiro
 * precisa de alguém CHAMANDO EM SEQUÊNCIA, e esse alguém é ou o cron (que tem o
 * dia todo) ou a tela (que tem a pessoa esperando).
 *
 * Os dois existem de propósito e não competem: o cron é a vazão que sobrevive
 * ao notebook fechado, e o botão é para quando o mês fecha amanhã e alguém
 * precisa VER acontecer. O motor no servidor é o mesmo — `action: "emitir"` com
 * um bloco de ids —, então o que o botão faz é só cadenciar.
 *
 * A CADÊNCIA É O PROBLEMA INTEIRO, e ela não é uma pausa fixa. O Omie fatura
 * por LOTE e só aceita um lote de cada vez: enquanto o anterior está `RUNNING`,
 * a função recusa a leva seguinte com "o lote N ainda está em processamento" e
 * NÃO cria nada. Isso não é erro — é a fila do Omie falando. Quem trata como
 * falha desiste no segundo bloco; quem trata como "espere e repita" emite o mês.
 * ------------------------------------------------------------------------- */

/**
 * Quantas cobranças cabem numa chamada.
 *
 * 20 e não `teto_lote` (50): o teto do banco é o que o SERVIDOR aceita, e o
 * relógio é o que o worker aguenta. Medido em 27/08: 20 OS = 116s dos 150s. Uma
 * leva de 50 seria recusada pelo relógio depois de já ter criado metade das OS
 * no Omie — o pior desfecho possível, porque OS criada e não faturada fica
 * ocupando o corredor de isolamento e trava a rodada seguinte.
 */
export const CABEM_NUMA_CHAMADA = 20;

/** O acumulado de uma emissão em massa — é o que a barra de progresso lê. */
export interface ProgressoMassa {
  /** blocos já respondidos (não necessariamente bem-sucedidos) */
  blocosFeitos: number;
  blocosTotal: number;
  /** cobranças que entraram num lote do Omie — a nota nasce minutos depois */
  despachadas: number;
  /** já tinham nota: nada foi emitido, e isso não é falha */
  jaEmitidas: number;
  /** barradas na conferência com o Asaas (estorno, dinheiro não entrou) */
  barradas: number;
  /** não saíram por erro do Omie */
  falhas: number;
  /** os motivos agrupados, do mais frequente para o menos */
  motivos: Array<[string, number]>;
}

export const PROGRESSO_ZERO = (blocosTotal: number): ProgressoMassa => ({
  blocosFeitos: 0, blocosTotal, despachadas: 0, jaEmitidas: 0, barradas: 0, falhas: 0, motivos: [],
});

/** A resposta de `action: "emitir"`, no que interessa a quem cadencia. */
export interface RespostaEmissao {
  despachadas?: number;
  resultados?: Array<{
    id_asaas?: string; ok?: boolean; ja_emitida?: boolean;
    em_processamento?: boolean; bloqueado?: boolean; erro?: string; aviso?: string;
  }>;
  pulada?: string;
  erro?: string;
}

/**
 * O bloco respondeu — soma ao acumulado.
 *
 * `em_processamento` é SUCESSO e é a resposta normal: o lote é assíncrono, então
 * ninguém volta com número de nota na mão. Contar isso como falha faria a barra
 * dizer "0 de 900" no fim de uma emissão que deu certo inteira — e, pior, faria
 * quem está olhando mandar emitir de novo o que já foi emitido.
 */
export function somarBloco(acc: ProgressoMassa, r: RespostaEmissao): ProgressoMassa {
  const res = r.resultados ?? [];
  const motivos = new Map(acc.motivos);
  const anota = (m?: string) => {
    const t = (m ?? "").trim();
    if (t) motivos.set(t, (motivos.get(t) ?? 0) + 1);
  };

  for (const x of res) {
    if (x.ja_emitida) anota(x.aviso);
    else if (x.bloqueado || (!x.ok && !x.em_processamento)) anota(x.erro);
  }
  // Rodada que não produziu resultado nenhum ainda tem o que dizer: é o
  // `pulada` que explica por que o bloco não andou (corredor ocupado, teto do
  // dia). Sem ele a barra avança em silêncio e ninguém sabe que parou de sair.
  if (!res.length && r.pulada) anota(r.pulada);
  if (r.erro) anota(r.erro);

  return {
    ...acc,
    blocosFeitos: acc.blocosFeitos + 1,
    despachadas: acc.despachadas + res.filter((x) => x.em_processamento).length,
    jaEmitidas: acc.jaEmitidas + res.filter((x) => x.ja_emitida).length,
    barradas: acc.barradas + res.filter((x) => x.bloqueado).length,
    falhas: acc.falhas + res.filter((x) => !x.ok && !x.em_processamento && !x.bloqueado).length,
    motivos: [...motivos.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/**
 * O bloco não andou porque o Omie ainda está faturando o anterior?
 *
 * A pergunta parece detalhe e é a diferença entre emitir 40 notas e emitir 900.
 * `FaturarLoteOS` é assíncrono: a função dispara o lote e volta na hora, mas o
 * Omie leva minutos para processá-lo — e enquanto processa, `limparCorredor`
 * devolve "o lote N ainda está em processamento" e a leva seguinte NÃO é criada.
 *
 * Nada foi perdido quando isso acontece: as cobranças do bloco continuam
 * intactas, e é por isso que a resposta certa é repetir O MESMO bloco depois de
 * esperar, em vez de seguir para o próximo (o próximo bateria na mesma trava) ou
 * abortar (o mês não fecha).
 */
export function precisaEsperarOLote(r: RespostaEmissao): boolean {
  const t = `${r.pulada ?? ""} ${r.erro ?? ""}`.toLowerCase();
  if (!t.trim()) return false;
  return /ainda está em processamento|lote_em_voo|em processamento no omie/.test(t);
}

/**
 * O teto do dia acabou — parar é a única resposta certa.
 *
 * Diferente da espera do lote, aqui repetir não adianta: o freio é de calendário
 * e só abre amanhã. Insistir queimaria a chamada e encheria o registro de
 * rodadas puladas idênticas.
 */
export function tetoDoDiaAtingido(r: RespostaEmissao): boolean {
  return /teto do dia atingido/i.test(`${r.pulada ?? ""} ${r.erro ?? ""}`);
}

/**
 * Quanto esperar antes de repetir o bloco, em ms.
 *
 * Cresce a cada tentativa (10s, 20s, 40s…) e para de crescer em 60s. O lote de
 * 20 OS leva de uns segundos a poucos minutos dependendo da prefeitura, e
 * perguntar de 5 em 5 segundos só gasta a cota do Omie — `ListarLotesOS` conta
 * como chamada e a trava dele é por método.
 */
export function esperaAntesDeRepetir(tentativa: number): number {
  return Math.min(60_000, 10_000 * Math.pow(2, Math.max(0, tentativa - 1)));
}
