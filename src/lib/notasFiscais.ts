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
  emitida_asaas: {
    rotulo: "Emitida no Asaas",
    tom: "ok",
    ajuda: "Nota autorizada pelo Asaas antes da data de corte — não precisa sair de novo pelo Omie.",
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
 * `RECEIVED` é o dinheiro já disponível. As duas exigem nota (o fato gerador é a
 * prestação do serviço, não a liquidação), por isso as duas entram no lote — mas
 * quem olha a tela para conferir caixa precisa enxergar qual é qual sem abrir o
 * Asaas. Daí tons diferentes para as duas.
 */
export const STATUS_ASAAS: Record<string, { rotulo: string; tom: "ok" | "aviso" | "erro" | "neutro"; ajuda: string }> = {
  RECEIVED:         { rotulo: "Recebida",   tom: "ok",     ajuda: "Dinheiro disponível na conta." },
  RECEIVED_IN_CASH: { rotulo: "Recebida",   tom: "ok",     ajuda: "Recebida em dinheiro, fora do Asaas." },
  CONFIRMED:        { rotulo: "Confirmada", tom: "aviso",  ajuda: "Pagamento autorizado, liquidação ainda não caiu na conta. Exige nota do mesmo jeito." },
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
 * Por que esta linha NÃO pode entrar num lote de emissão. `null` = pode.
 *
 * A ordem importa: o primeiro motivo é o que aparece na tela, e o mais grave tem
 * de vir primeiro. Emitir nota de cobrança estornada é pior do que emitir uma
 * segunda via de algo que já tem nota — a primeira cria imposto sobre receita que
 * não existe.
 */
export function motivoBloqueio(l: Pick<LinhaNota, "situacao" | "estornado" | "cnpj_cpf" | "valor" | "data_vencimento" | "data_pagamento"> & { nfse_mensagem?: string | null }): string | null {
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
  if (l.situacao === "nao_exige") return "A cobrança não foi recebida.";
  if (!l.cnpj_cpf) return "Cliente sem CNPJ/CPF no Asaas — sem documento não há como achar o cadastro no Omie.";
  if (!(Number(l.valor) > 0)) return "Valor zerado ou negativo.";
  if (!l.data_vencimento && !l.data_pagamento) return "Cobrança sem data.";
  return null;
}

export const podeEmitir = (l: Parameters<typeof motivoBloqueio>[0]): boolean => motivoBloqueio(l) === null;

/**
 * O que o lote vai fazer, antes de fazer.
 *
 * `bloqueadas` não é erro — é o número que explica por que "selecionei 50 e ele
 * mandou 47". Sem ele a diferença parece perda silenciosa.
 */
export function resumoLote(linhas: LinhaNota[], selecionados: Set<string>) {
  const sel = linhas.filter((l) => selecionados.has(l.id_asaas));
  const podem = sel.filter(podeEmitir);
  const motivos = new Map<string, number>();
  for (const l of sel) {
    const m = motivoBloqueio(l);
    if (m) motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
  return {
    selecionadas: sel.length,
    emitiveis: podem.length,
    bloqueadas: sel.length - podem.length,
    valor: podem.reduce((s, l) => s + Number(l.valor || 0), 0),
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

/** "37511891000150" → "37.511.891/0001-50"; CPF de 11 → "064.191.081-95". */
export function formatarDoc(doc: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc ?? "";
}
