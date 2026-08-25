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
/* `memoDaObservacao`, `ehCartao` e `lojistaDoTitulo` desceram para `_shared/`
   junto com o leitor de MEMO: a Edge Function que escreve o nome do lojista de
   volta no Omie precisa exatamente das mesmas regras — inclusive a trava do
   `ehCartao`, que é o que impede a observação de um fornecedor comum de ser
   lida como MEMO. Aqui só se reexporta. */
import {
  ehCartao, lojistaDoTitulo, memoDaObservacao,
} from "../../supabase/functions/_shared/cartao-memo";

export { ehCartao, lojistaDoTitulo, memoDaObservacao };

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
