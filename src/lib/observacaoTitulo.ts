/* ---------------------------------------------------------------------------
 * A observação do título do Omie, legível.
 *
 * No cartão, a observação é o que diz o que o gasto É — a contraparte do título
 * é sempre "Lancamento Fatura Cartao". O Omie carimba um prefixo na importação
 * automática e cola o MEMO da fatura depois de um "|":
 *
 *   Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.
 *   |OPENAI *CHATGPT SUBS          OPENAI.COM - R$ 525,00  U$ 102,79  V.DOL 5,1075
 *
 * O que vem depois do "|" é o MEMO com as MESMAS colunas do OFX, então quem lê é
 * o parser único do cartão (lib/cartao/ofx) — o repositório tem um só, de
 * propósito, e duplicá-lo aqui faria a auditoria e a tela do cartão discordarem
 * sobre o nome do mesmo lojista.
 * ------------------------------------------------------------------------- */

import { lerMemo } from "@/lib/cartao/ofx";

/**
 * O MEMO cru de dentro da observação, ou null quando não há texto.
 *
 * NÃO faz trim à esquerda: `lerMemo` corta por POSIÇÃO de coluna (22 e 30), e um
 * espaço a menos no começo desloca tudo — o estabelecimento sairia partido.
 */
export function memoDaObservacao(obs: string | null | undefined): string | null {
  if (!obs) return null;
  const corte = obs.lastIndexOf("|");
  const memo = corte >= 0 ? obs.slice(corte + 1) : obs;
  return memo.trim() ? memo : null;
}

export type ObservacaoLida = {
  /** o lojista, já sem o ruído que a fatura acrescenta */
  estabelecimento: string;
  /** cidade, ou a conversão de câmbio quando é compra no exterior */
  detalhe: string | null;
  /** "02/06", quando a fatura marcou parcela */
  parcela: string | null;
};

/**
 * Lê a observação de um gasto de cartão. Devolve null quando não há observação —
 * a tela então mostra só o que já mostrava.
 */
export function lerObservacaoTitulo(obs: string | null | undefined): ObservacaoLida | null {
  const memo = memoDaObservacao(obs);
  if (!memo) return null;

  const m = lerMemo(memo);
  const detalhe = m.exterior
    ? [m.exterior.dominio, m.exterior.originalTexto].filter(Boolean).join(" · ")
    : m.cidade;

  return {
    estabelecimento: m.estabelecimento || memo.trim(),
    detalhe: detalhe?.trim() || null,
    parcela: m.parcela ? `${String(m.parcela.n).padStart(2, "0")}/${String(m.parcela.de).padStart(2, "0")}` : null,
  };
}

/**
 * Título do Omie que é gasto de cartão.
 *
 * A fatura entra no ERP com uma contraparte-carimbo — hoje "Lancamento Fatura
 * Cartao" (4.294 movimentos) e "Lancamento cartão itau" (19). É pelo nome mesmo
 * que dá para reconhecer: não existe campo no movimento dizendo "isto é cartão",
 * e o cadastro é criado justamente para servir de balde da fatura.
 */
export function ehCartao(contraparte: string | null | undefined): boolean {
  const s = (contraparte ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /cartao/.test(s) && /(lancamento|fatura)/.test(s);
}

/**
 * A observação vira nome SÓ quando o título é do cartão — e é por aqui que se
 * pede, nunca por `lerObservacaoTitulo` solta.
 *
 * A trava mora nesta função, e não em cada tela, porque esquecê-la não dá erro:
 * dá uma linha plausível e errada. A varredura diária guarda a observação de
 * TODA conta a pagar, e num título comum esse texto é o que o fornecedor
 * escreveu — "Link para visualizar a NFS-e: https://…", condição de pagamento,
 * número do contrato. Lido como MEMO de fatura (que é posicional), o começo da
 * frase vira "estabelecimento": a linha perde o nome do fornecedor, ganha um
 * ícone de cartão que não é dela, e o mesmo lançamento passa a ter um nome na
 * lista e outro na ponte — que agrupa pela regra travada.
 *
 * Devolve null quando não é cartão: a tela então mostra a contraparte do Omie,
 * que nesses títulos é o nome de verdade.
 */
export function lerGastoDeCartao(
  contraparte: string | null | undefined,
  obs: string | null | undefined,
): ObservacaoLida | null {
  if (!ehCartao(contraparte)) return null;
  return lerObservacaoTitulo(obs);
}
