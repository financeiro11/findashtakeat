/**
 * A chave do envio de títulos do cartão para o Omie — o lado do frontend.
 *
 * NÃO há regra escrita aqui. Tudo mora em
 * `supabase/functions/_shared/cartao-envio.ts`, que a Edge Function importa
 * também: a MESMA função que desabilita o botão desta tela é a que recusa o
 * request no servidor. Antes disto a chave era uma constante só do frontend, o
 * que é o mesmo que não ter chave — quem chamasse a função direto passaria.
 *
 * PARA DESLIGAR de novo, se for preciso:
 *   1. `ENVIO_AO_OMIE_LIBERADO = false` no módulo compartilhado;
 *   2. só isso — `envio.test.ts` já cobra os dois estados sozinho, e volta a
 *      exigir que nada no repo saiba criar conta a pagar no ERP.
 *
 * As faturas até ago/26 continuam bloqueadas pelo trigger `cartao_faturas_marco`
 * mesmo com a chave ligada. As duas travas são independentes de propósito.
 */

export {
  ENVIO_AO_OMIE_LIBERADO,
  bloqueioDeEnvio,
  MARCO_FORA_DO_HUB,
  PREFIXO_TESTE,
  ehTeste,
  integracaoDe,
  montarTitulo,
  recusaDoEnvio,
  dataBR,
  // O escopo também é regra compartilhada: a tela escolhe de que pedaço da
  // fatura está falando e a Edge Function decide, com a MESMA função, se aquele
  // envio pode fechar a fatura.
  ESCOPOS,
  ehParcial,
  lerEscopo,
  titulosDoEscopo,
  type EscopoEnvio,
  type EstadoDaFatura,
  type TituloParaOmie,
} from "../../../supabase/functions/_shared/cartao-envio.ts";

import { integracaoDe, type TituloParaOmie } from "../../../supabase/functions/_shared/cartao-envio.ts";
import type { Provisao } from "./provisionar";

/**
 * As provisões da tela viram os títulos que a Edge Function recebe.
 *
 * O que entra de fora é só a categoria — ela vem do de-para (`cartao_omie_map`)
 * ou da escolha que a pessoa fez na tela, e é a única decisão que não sai do
 * arquivo OFX. `chave` é a do lojista já fundida por `chaveDe`, e é por ela que
 * se procura a categoria.
 *
 * `dataCompra` já vem no `Provisao`: é a data ORIGINAL do OFX, não a da fatura,
 * e é ela que ancora a competência da DRE lá no Omie (ver `montarTitulo`).
 */
export function titulosDaFatura(
  provisoes: Provisao[],
  categoriaDe: (chave: string) => { codigo: string; descricao: string | null } | null,
): TituloParaOmie[] {
  const out: TituloParaOmie[] = [];
  for (const p of provisoes) {
    const cat = categoriaDe(p.chave);
    out.push({
      fitid: p.fitid,
      integracao: p.integracao,
      dataCompra: p.dataCompra,
      vencimento: p.vencimento,
      competencia: p.competencia,
      valor: p.valor,
      parcela: p.parcela,
      codigoCategoria: cat?.codigo ?? "",
      descricaoCategoria: cat?.descricao ?? null,
      estabelecimento: p.estabelecimento,
      chave: p.chave,
      memo: p.memo,
    });
  }
  return out;
}

/** Só para conferência a olho na tela: a integração que este fitid/parcela terá. */
export const integracaoPrevista = integracaoDe;
