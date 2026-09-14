// Desfazer uma pergunta — a cirurgia na lista de mensagens, fora do componente.
//
// Mora aqui pelo mesmo motivo de lib/mobile/chat.ts: é a parte que dá para testar sem
// navegador, e é a que erra calada. Errar aqui não trava nada — só apaga a resposta errada,
// deixa uma bolha vazia para sempre, ou devolve à caixa de texto uma pergunta que continuou
// no banco e volta sozinha na próxima vez que a conversa for aberta.
//
// As duas funções são a mesma ideia em dois momentos: a pergunta volta para a caixa de onde
// saiu, e some da conversa. A diferença é o que já chegou na tela.

import type { MsgAssistente } from "@/lib/assistente";

export type Retirada<T> = {
  /** A conversa sem a pergunta e sem o que veio depois dela. */
  mensagens: T[];
  /** O texto que volta para a caixa. `null` quando não havia pergunta a retirar. */
  pergunta: string | null;
  /** Os conteúdos que saíram — é por eles que as linhas são apagadas no banco. */
  removidas: string[];
};

/**
 * Tira da conversa a última pergunta e tudo o que veio depois dela.
 *
 * Varre de trás para a frente até achar a última mensagem do usuário, porque "depois dela"
 * pode ser uma resposta, um aviso de erro, ou nada — e nos três casos o que se descarta é o
 * bloco inteiro. Descartar só a resposta deixaria a pergunta órfã na tela; descartar só a
 * pergunta deixaria uma resposta sem enunciado, que é pior: ela continua parecendo válida.
 */
export function retirarUltimaPergunta<T extends MsgAssistente>(mensagens: T[]): Retirada<T> {
  let i = mensagens.length - 1;
  while (i >= 0 && mensagens[i].role !== "user") i--;
  if (i < 0) return { mensagens, pergunta: null, removidas: [] };

  return {
    mensagens: mensagens.slice(0, i),
    pergunta: mensagens[i].content,
    // Conteúdo vazio não identifica linha nenhuma: incluí-lo num `delete ... in (...)`
    // transformaria "apagar esta pergunta" em "apagar toda mensagem vazia da conversa".
    removidas: mensagens.slice(i).map((m) => m.content).filter((c) => c.trim().length > 0),
  };
}

/**
 * O que fica na tela quando a pessoa manda parar.
 *
 * A REGRA: texto que já chegou é informação, e não se apaga. Quem esperou quarenta segundos
 * e desistiu no meio de uma resposta que já estava saindo prefere ler o pedaço a ver a tela
 * limpar sozinha — e a pergunta continua na conversa, porque a resposta parcial só faz
 * sentido embaixo dela.
 *
 * Quando NADA chegou (a bolha do assistente nasce vazia antes do streaming), não há nada a
 * preservar: some a bolha, some a pergunta, e o texto volta para a caixa. É o caso do envio
 * por engano — o "O q" que saiu com um Enter sem querer.
 */
export function aoParar<T extends MsgAssistente>(mensagens: T[]): Retirada<T> {
  const ultima = mensagens[mensagens.length - 1];
  if (ultima?.role === "assistant" && ultima.content.trim()) {
    return { mensagens, pergunta: null, removidas: [] };
  }
  const semBolhaVazia = ultima?.role === "assistant" ? mensagens.slice(0, -1) : mensagens;
  return retirarUltimaPergunta(semBolhaVazia);
}
