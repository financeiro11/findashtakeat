// Conserto da lista de mensagens quando o assistente falha no meio.
//
// Mora aqui, fora do componente, porque é a parte da aba Chat que dá para testar sem
// navegador — e é a que errava calada: a tela continuava "funcionando", só que com um
// balão vazio permanente e a pergunta duplicada a cada tentativa.

import type { MsgAssistente } from "@/lib/assistente";

/**
 * Depois de uma falha: tira a bolha do assistente que nasceu vazia (o streaming morreu
 * antes do primeiro pedaço) e marca a pergunta, que fica na tela para ser reenviada.
 *
 * A ordem importa. A bolha vazia é criada ANTES de o stream responder, então quando ele
 * morre a última mensagem é ela, não a pergunta — marcar sem limpar não marcava nada, e o
 * "Tentar novamente" então não reconhecia a pergunta e mandava uma segunda cópia.
 */
export function marcarFalha<T extends MsgAssistente>(mensagens: T[]): T[] {
  const ultima = mensagens[mensagens.length - 1];
  const limpo = ultima?.role === "assistant" && !ultima.content ? mensagens.slice(0, -1) : mensagens;
  return limpo.map((m, i) => (i === limpo.length - 1 && m.role === "user" ? { ...m, erro: true } : m));
}

/** Antes de reenviar: tira a pergunta marcada, senão ela aparece duas vezes na conversa. */
export function tirarPerguntaFalha<T extends MsgAssistente>(mensagens: T[]): T[] {
  const ultima = mensagens[mensagens.length - 1];
  return ultima?.role === "user" && ultima.erro ? mensagens.slice(0, -1) : mensagens;
}
