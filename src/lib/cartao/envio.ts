/**
 * A chave do envio de títulos do cartão para o Omie.
 *
 * POR QUE UMA CONSTANTE E NÃO UMA CONFIGURAÇÃO
 * Enquanto isto for `false`, o Hub não cria nada no ERP. Mas a garantia não é a
 * constante — é o teste que anda com ela (`envio.test.ts`): ele varre o repo e
 * REPROVA se aparecer código capaz de criar conta a pagar no Omie enquanto a
 * chave estiver desligada. Ou seja, quem construir o caminho de escrita não tem
 * como esquecer de passar por aqui: a suíte quebra e diz o porquê.
 *
 * Uma flag no banco ou numa variável de ambiente poderia ser virada por engano,
 * de madrugada, no meio de um fechamento. Esta só vira num commit — com diff,
 * com autor e com o teste sendo alterado junto, de propósito.
 *
 * PARA LIGAR, quando o Henrique der o comando:
 *   1. `ENVIO_AO_OMIE_LIBERADO = true` aqui;
 *   2. ajustar `envio.test.ts`, que passa a exigir o caminho de escrita completo;
 *   3. mover o marco em `20260806120000_cartao_provisionamento.sql` se a fatura
 *      a enviar for anterior a set/26 — o banco trava independente desta chave.
 *
 * As faturas até ago/26 foram lançadas à mão e continuam bloqueadas no banco
 * mesmo com a chave ligada. As duas travas são independentes de propósito.
 */
export const ENVIO_AO_OMIE_LIBERADO = false;

/** O que a tela diz enquanto o envio está desligado. `null` quando liberado. */
export function bloqueioDeEnvio(): string | null {
  return ENVIO_AO_OMIE_LIBERADO
    ? null
    : "O envio ao Omie está desligado. Esta tela confere a fatura e mostra o que seria "
      + "lançado; nada é criado no ERP. A liberação é feita no código, não por aqui.";
}
