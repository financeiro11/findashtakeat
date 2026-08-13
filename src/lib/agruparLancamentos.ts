/* ============================================================================
 * Uma linha por fornecedor, não uma linha por cobrança.
 *
 * A célula "Viagens & Transportes Mkt" de julho tem 264 lançamentos, e uma boa
 * parte deles é a MESMA compra picada pela operadora do cartão: quatro parcelas
 * da LATAM, dezoito corridas de Uber, seis diárias de Airbnb. Rolar 264 linhas
 * para descobrir que são doze fornecedores é gastar a conferência com o
 * empacotamento em vez do gasto.
 *
 * Aqui o agrupamento é só isto: juntar pelo NOME QUE ESTÁ NA TELA e somar. Três
 * decisões que valem estar escritas:
 *
 * 1. A CHAVE É O NOME EXIBIDO, não a contraparte crua. No cartão o nome vem da
 *    observação do título (o lojista), e em todo lugar ele passa pelo apelido do
 *    cadastro — então duas grafias que apontam para o mesmo apelido já chegam
 *    aqui como uma coisa só. Quem quer juntar "DL*UberRides" com "DL *UberRid"
 *    cadastra o apelido; esta função não adivinha por semelhança, porque um
 *    palpite errado some com dinheiro dentro de um grupo que ninguém abre.
 *
 * 2. AGRUPAR NÃO MEXE NA SOMA. Os grupos são um recorte da MESMA lista já
 *    filtrada: a soma de todos os grupos é a soma dos lançamentos visíveis, e o
 *    carimbo do cabeçalho continua comparando a célula com a lista inteira.
 *
 * 3. A ORDEM DOS GRUPOS SEGUE A DA LISTA. Em "data" vale a primeira aparição
 *    (que é a ordem do RPC, a que se confere contra o ERP); em "maior"/"menor" o
 *    que ordena é o TOTAL do grupo, não o maior item dele — dezoito corridas de
 *    R$ 30 pesam mais que uma passagem de R$ 400, e é isso que se quer ver no
 *    topo quando se pede "maior primeiro".
 * ========================================================================== */

import { normalize } from "@/lib/normalize";
import type { Ordem } from "@/lib/filtroLancamentos";

export type Grupo<T> = {
  /** Nome normalizado — a identidade do grupo, estável entre re-renders. */
  chave: string;
  /** Como o nome é escrito na tela (já com apelido, quando há). */
  nome: string;
  itens: T[];
  total: number;
};

export function agruparPorNome<T>(
  linhas: T[],
  opts: {
    nomeDe: (l: T) => string;
    valorDe: (l: T) => number;
    ordem?: Ordem;
  },
): Grupo<T>[] {
  const { nomeDe, valorDe, ordem = "data" } = opts;
  const m = new Map<string, Grupo<T>>();

  for (const l of linhas) {
    const nome = (nomeDe(l) || "").trim() || "Sem contraparte";
    /* Sem `normalize` sobrando nada (um nome só de pontuação), a própria string
       serve de chave — dois lançamentos "•••" continuam sendo um grupo só. */
    const chave = normalize(nome) || nome.toUpperCase();
    let g = m.get(chave);
    if (!g) { g = { chave, nome, itens: [], total: 0 }; m.set(chave, g); }
    g.itens.push(l);
    g.total += valorDe(l) || 0;
  }

  const grupos = [...m.values()];
  if (ordem === "data") return grupos;

  const sinal = ordem === "maior" ? -1 : 1;
  // Desempate pela posição original: dois grupos de mesmo total não podem
  // trocar de lugar a cada re-render.
  return grupos
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const d = (Math.abs(a.g.total) - Math.abs(b.g.total)) * sinal;
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.g);
}

/**
 * Quantas linhas o agrupamento tira da tela. Zero significa "cada fornecedor
 * aparece uma vez só" — e aí agrupar não muda nada, que é justamente por que a
 * lista pode ficar agrupada por padrão sem atrapalhar as células pequenas.
 */
export function linhasEconomizadas<T>(grupos: Grupo<T>[]): number {
  return grupos.reduce((s, g) => s + Math.max(0, g.itens.length - 1), 0);
}

/**
 * O intervalo de datas de um grupo. As datas vêm em ISO (`2026-07-01`), que
 * ordena como texto — comparar string aqui é comparar data.
 */
export function periodoDoGrupo(itens: { data: string | null }[]): { de: string | null; ate: string | null } {
  let de: string | null = null;
  let ate: string | null = null;
  for (const { data } of itens) {
    if (!data) continue;
    if (de === null || data < de) de = data;
    if (ate === null || data > ate) ate = data;
  }
  return { de, ate };
}