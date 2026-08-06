/* ============================================================================
 * Achar UM lançamento no meio de cinquenta.
 *
 * O drill-down da DRE/DFC existe para conferir uma célula, e conferir é
 * procurar: "esse fornecedor aparece quantas vezes?", "o que aqui é aluguel e o
 * que é obra?", "qual foi o maior gasto?". Com dez linhas o olho resolve; com
 * cinquenta, não — e a rubrica de investimento em estrutura tem cinquenta.
 *
 * A busca e a ordenação moram aqui, fora da tela, porque as três decisões abaixo
 * são o que separa um filtro útil de um que esconde dinheiro:
 *
 * 1. BUSCA POR TERMO, NÃO POR SUBSTRING. "ingram brasil" acha "INGRAM MICRO
 *    BRASIL LTDA": cada palavra digitada precisa aparecer em algum lugar da
 *    linha, em qualquer ordem. Substring cru não acharia, e quem digita o nome
 *    do fornecedor de memória raramente acerta a ordem do cadastro.
 *
 * 2. A BUSCA VARRE O QUE ESTÁ NA TELA, inclusive o lojista do cartão — que não
 *    é campo do lançamento, e sim texto lido da observação do título. Buscar só
 *    na contraparte não acharia "Datadog", porque no ERP ele se chama
 *    "Lancamento Fatura Cartao".
 *
 * 3. ORDENAR É POR TAMANHO, NÃO PELO SINAL. Despesa vem negativa: ordenar pelo
 *    número cru poria o maior gasto no fim da lista quando se pede "maior
 *    primeiro". Quem procura o que pesa quer o de maior módulo — e um estorno de
 *    R$ 50 mil pesa tanto quanto um gasto de R$ 50 mil.
 * ========================================================================== */

import { normalize } from "@/lib/normalize";

/** O bastante do lançamento para filtrar — a lista real tem mais campos. */
export type LinhaFiltravel = {
  contraparte: string | null;
  cnpj_cpf: string | null;
  titulo: string | null;
  documento: string | null;
  categoria_codigo: string | null;
  categoria_descricao: string | null;
  valor: number | null;
};

/** `data` é a ordem que o RPC devolveu — é nela que se confere contra o ERP. */
export type Ordem = "data" | "maior" | "menor";

export type Filtro = {
  busca: string;
  /** Chaves de categoria marcadas. Vazio = todas (e não "nenhuma"). */
  categorias: Set<string>;
  ordem: Ordem;
};

/**
 * O estado de partida. É função, e não constante: um `Set` de módulo seria o
 * MESMO objeto em todos os painéis, e bastaria alguém marcar uma categoria sem
 * copiar o conjunto para a célula seguinte abrir já filtrada.
 */
export const filtroInicial = (): Filtro => ({ busca: "", categorias: new Set(), ordem: "data" });

export const filtroVazio = (f: Filtro): boolean =>
  !f.busca.trim() && f.categorias.size === 0 && f.ordem === "data";

/**
 * A chave de uma categoria. O código é o que o Omie corrige e o que distingue
 * duas categorias de descrição parecida; sem ele, a descrição serve.
 */
export const chaveCategoria = (l: Pick<LinhaFiltravel, "categoria_codigo" | "categoria_descricao">): string =>
  (l.categoria_codigo || l.categoria_descricao || "—").trim();

export type CategoriaNaCelula = {
  chave: string;
  codigo: string | null;
  descricao: string;
  lancamentos: number;
  total: number;
};

/**
 * As categorias que compõem a célula, da que mais pesa para a que menos pesa —
 * com quanto cada uma pesa. A lista É a resposta para "do que essa linha é
 * feita?", então ela vale mesmo antes de qualquer clique.
 */
export function categoriasDaCelula(linhas: LinhaFiltravel[]): CategoriaNaCelula[] {
  const m = new Map<string, CategoriaNaCelula>();
  for (const l of linhas) {
    const chave = chaveCategoria(l);
    let c = m.get(chave);
    if (!c) {
      c = {
        chave,
        codigo: l.categoria_codigo?.trim() || null,
        descricao: (l.categoria_descricao || l.categoria_codigo || "sem categoria").trim(),
        lancamentos: 0,
        total: 0,
      };
      m.set(chave, c);
    }
    c.lancamentos++;
    c.total += Number(l.valor) || 0;
  }
  return [...m.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/**
 * O texto que a busca varre. `extra` é o que a tela sabe e o lançamento não —
 * hoje, o lojista lido da observação do título do cartão.
 */
export function textoDaLinha(l: LinhaFiltravel, extra?: string | null): string {
  return normalize([
    l.contraparte, l.cnpj_cpf, l.titulo, l.documento,
    l.categoria_codigo, l.categoria_descricao, extra,
  ].filter(Boolean).join(" "));
}

/** Todo termo digitado precisa aparecer — em qualquer ordem, em qualquer campo. */
export function casaBusca(texto: string, busca: string): boolean {
  const termos = normalize(busca).split(" ").filter(Boolean);
  if (!termos.length) return true;
  return termos.every((t) => texto.includes(t));
}

/**
 * Filtra e ordena. `extra` recebe a linha e devolve o texto de apoio dela.
 *
 * A ordem "data" não reordena nada: devolve o que veio do RPC, que já vem por
 * data e é como se confere lançamento a lançamento contra o Omie.
 */
export function filtrarLancamentos<T extends LinhaFiltravel>(
  linhas: T[],
  f: Filtro,
  extra?: (l: T) => string | null | undefined,
): T[] {
  const busca = f.busca.trim();
  const filtradas = linhas.filter((l) => {
    if (f.categorias.size && !f.categorias.has(chaveCategoria(l))) return false;
    if (busca && !casaBusca(textoDaLinha(l, extra?.(l)), busca)) return false;
    return true;
  });

  if (f.ordem === "data") return filtradas;
  const sinal = f.ordem === "maior" ? -1 : 1;
  // `map/sort/map` para o desempate ficar na posição original: duas linhas do
  // mesmo valor não podem trocar de lugar a cada re-render.
  return filtradas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const d = (Math.abs(Number(a.l.valor) || 0) - Math.abs(Number(b.l.valor) || 0)) * sinal;
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.l);
}
