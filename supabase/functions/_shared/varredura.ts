/* ============================================================================
 * A ordem em que as contas correntes são varridas no Omie.
 *
 * Mora fora de `omie.ts` para poder ser testada: aquele arquivo importa pdf-lib e
 * fflate de URL, e o vitest não resolve isso.
 *
 * DUAS CONSULTAS SEGUIDAS QUE NÃO RETORNAM NADA COLIDEM. O Omie recusa a segunda
 * com "Consumo redundante detectado", mesmo com `nCodCC` diferente e mesmo com
 * tamanho de página diferente — o que descarta a chave ser do request; é a
 * resposta vazia que ele não distingue. Medido em 10/09/2026, três vezes, sempre
 * no mesmo ponto: as contas com movimento passam, e a falha vem na SEGUNDA conta
 * vazia consecutiva.
 *
 * Esta conta do Omie tem duas contas dormentes — "Banestes Contrapartida -
 * Tecnova" e "Omie.CASH - Ative agora" — e elas ficavam lado a lado no cadastro.
 *
 * A regra: **no máximo UMA consulta que pode vir vazia por varredura.** As contas
 * que a última varredura viu com movimento vão primeiro; das dormentes, só uma
 * entra por vez, rodiziando pelo dia. Uma conta que acorde é encontrada em no
 * máximo `dormentes.length` dias — hoje, dois.
 * ========================================================================== */

/**
 * @param contas       todas as contas candidatas, na ordem do cadastro
 * @param comMovimento as que a última varredura viu com movimento
 * @param hoje         epoch em ms; parâmetro para o teste não depender do relógio
 */
export function ordemDaVarredura(
  contas: string[],
  comMovimento: ReadonlySet<string>,
  hoje: number = Date.now(),
): string[] {
  const ativas = contas.filter((c) => comMovimento.has(c));
  const dormentes = contas.filter((c) => !comMovimento.has(c));

  /* Primeira varredura: não há mapa ainda, então vai tudo. No pior caso ela falha
     uma vez — e a falha cai no fallback da varredura única, que já grava o cache
     e dá o mapa para a próxima. */
  if (ativas.length === 0) return contas;
  if (dormentes.length === 0) return ativas;

  const dia = Math.floor(hoje / 86_400_000);
  return [...ativas, dormentes[dia % dormentes.length]];
}
