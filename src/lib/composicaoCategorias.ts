/* ============================================================================
 * Do que esta linha da DRE/DFC é feita — e o que mudou na composição dela.
 *
 * A célula não é um número: é um punhado de categorias do Omie que o DE-PARA
 * jogou na mesma rubrica. "Assessorias & Consultorias" com -R$ 26.015,59 pode
 * ser advocacia, contabilidade e duas consultorias diferentes, e a única
 * pergunta que importa no fechamento é qual delas mexeu.
 *
 * Três decisões desenham este módulo:
 *
 * 1. O MÊS EM FOCO VEM DA LISTA, NÃO DA RPC. As categorias do mês são somadas
 *    dos mesmos lançamentos que o painel exibe (`categoriasDaCelula`). É o que
 *    garante que a coluna do mês feche com o "SOMA DOS LANÇAMENTOS" do topo —
 *    e é o que faz a tabela aparecer inteira mesmo quando a consulta de
 *    histórico falha. A RPC entra só para os meses ANTERIORES.
 *
 * 2. A CHAVE É A DESCRIÇÃO DA CATEGORIA. É por descrição que o DE-PARA casa a
 *    categoria com a rubrica (ver `omie_dre_mapa`), e é a mesma expressão SQL
 *    dos dois lados. Casar por código quebraria: o histórico agregado não
 *    devolve código, e duas categorias de código diferente com a mesma
 *    descrição caem na MESMA linha da demonstração de qualquer jeito.
 *
 * 3. NOVO/SUMIU/SUBIU É O MESMO VEREDITO DOS FORNECEDORES. Reusa
 *    `montarComparativo` em vez de reescrever: as sutilezas que fazem um
 *    comparativo mentir (subiu/caiu em MÓDULO porque despesa é negativa;
 *    "novo" só depois de varrer a janela inteira, senão o anual vira novidade
 *    todo ano; quem sumiu também conta) já estão resolvidas e testadas lá.
 * ========================================================================== */

import { chaveCategoria, type CategoriaNaCelula } from "@/lib/filtroLancamentos";
import {
  montarComparativo, rotuloSituacao,
  type Fornecedor, type LinhaContraparte, type Situacao,
} from "@/lib/comparativoFornecedores";
import { mesCurto } from "@/lib/demonstracoes-schema";

/** Uma linha da RPC `demonstracoes_categorias`. */
export type LinhaCategoriaMes = {
  mes: string;
  categoria: string | null;
  valor: number | string | null;
  lancamentos?: number | null;
};

export type Categoria = {
  /** A descrição, que é a chave do casamento com o histórico. */
  descricao: string;
  /**
   * As chaves de `chaveCategoria` desta descrição no mês em foco — é com elas
   * que o filtro da lista trabalha. Plural porque duas categorias de código
   * diferente podem ter a mesma descrição. Vazio em quem sumiu: não há
   * lançamento neste mês para filtrar.
   */
  chaves: string[];
  /** Os códigos do Omie, para o hover. É o que se corrige no ERP. */
  codigos: string[];
  /**
   * Só significa alguma coisa quando `Composicao.temHistorico`. Sem nenhum mês
   * anterior na janela TODA categoria sairia "novo" — que é uma afirmação que
   * os dados não sustentam. Quem desenha a tela esconde o chip nesse caso.
   */
  situacao: Situacao;
  valor: number;
  lancamentos: number;
  valorAnterior: number;
  lancamentosAnteriores: number;
  /** Quanto pesou a mais (ou a menos), em módulo. */
  delta: number;
  /** delta ÷ |valor anterior|. null quando não havia base — não é 0%. */
  pct: number | null;
  favoravel: boolean;
  /** Mês mais recente, antes do anterior, em que apareceu. Só em "voltou". */
  visto: string | null;
  /** Fatia do movimento da linha no mês, em módulo. 0 em quem sumiu. */
  peso: number;
};

export type Composicao = {
  mes: string;
  mesAnterior: string;
  janela: string[];
  /** Da que mais pesa para a que menos pesa; quem sumiu vai para o fim. */
  categorias: Categoria[];
  /** Quantas categorias compõem a célula neste mês (sem contar as que sumiram). */
  quantas: number;
  novas: number;
  sumidas: number;
  /** Existe algum mês anterior com lançamento nesta rubrica? Sem isso, calar. */
  temHistorico: boolean;
};

/**
 * Monta a composição da célula.
 *
 * `daCelula` são as categorias do mês em foco, somadas dos lançamentos que o
 * painel lista. `historico` é o que a RPC devolveu para a janela — as linhas do
 * mês em foco são DESCARTADAS de propósito (ver decisão 1 no topo).
 */
export function montarComposicao(
  daCelula: CategoriaNaCelula[],
  historico: LinhaCategoriaMes[],
  mes: string,
  meses = 12,
): Composicao {
  /* Descrição → o que a célula sabe dela. Duas categorias de código diferente e
     mesma descrição viram uma linha só, porque é assim que elas caem na
     demonstração — mas as duas chaves e os dois códigos ficam guardados. */
  const naCelula = new Map<string, { valor: number; lancamentos: number; chaves: string[]; codigos: string[] }>();
  for (const c of daCelula) {
    const desc = c.descricao.trim() || "sem categoria";
    let x = naCelula.get(desc);
    if (!x) { x = { valor: 0, lancamentos: 0, chaves: [], codigos: [] }; naCelula.set(desc, x); }
    x.valor += c.total;
    x.lancamentos += c.lancamentos;
    x.chaves.push(c.chave);
    if (c.codigo) x.codigos.push(c.codigo);
  }

  /* O veredito sai do comparativo dos fornecedores: aqui a "contraparte" é a
     descrição da categoria. O mês em foco entra pela célula, os anteriores pela
     RPC — nunca os dois pela mesma fonte, senão a coluna do mês poderia não
     bater com a soma que está no topo do painel. */
  const linhas: LinhaContraparte[] = [
    ...[...naCelula].map(([descricao, x]) => ({
      mes, contraparte: descricao, valor: x.valor, lancamentos: x.lancamentos,
    })),
    ...historico
      .filter((h) => h.mes !== mes)
      .map((h) => ({
        mes: h.mes,
        contraparte: (h.categoria ?? "").trim() || "sem categoria",
        valor: h.valor,
        lancamentos: h.lancamentos ?? 0,
      })),
  ];

  const comp = montarComparativo(linhas, mes, meses);

  /* Em módulo: numa rubrica com estorno, dividir pela soma com sinal daria
     fatias acima de 100% (ou negativas). O que se quer saber é quanto do
     movimento da linha passou por ali. */
  const totalModulo = [...naCelula.values()].reduce((s, x) => s + Math.abs(x.valor), 0);

  const categorias: Categoria[] = comp.fornecedores.map((f: Fornecedor) => {
    const x = naCelula.get(f.contraparte);
    return {
      descricao: f.contraparte,
      chaves: x?.chaves ?? [],
      codigos: x?.codigos ?? [],
      situacao: f.situacao,
      valor: f.valor,
      lancamentos: f.lancamentos,
      valorAnterior: f.valorAnterior,
      lancamentosAnteriores: f.lancamentosAnteriores,
      delta: f.delta,
      pct: f.pct,
      favoravel: f.favoravel,
      visto: f.visto,
      peso: totalModulo > 0 ? Math.abs(f.valor) / totalModulo : 0,
    };
  });

  /* Peso decrescente, e quem sumiu no fim: a tabela é lida de cima para baixo
     como "o que compõe a linha", e quem sumiu não compõe — explica. O
     comparativo ordena por quem mais MEXEU, que é outra pergunta. */
  categorias.sort((a, b) => {
    const fim = (c: Categoria) => (c.situacao === "sumiu" ? 1 : 0);
    return fim(a) - fim(b) || Math.abs(b.valor) - Math.abs(a.valor);
  });

  return {
    mes: comp.mes,
    mesAnterior: comp.mesAnterior,
    janela: comp.janela,
    categorias,
    quantas: categorias.length - comp.sumidos,
    // Sem mês anterior não há novidade: haveria só a primeira vez que se olha.
    novas: comp.temHistorico ? comp.novos : 0,
    sumidas: comp.temHistorico ? comp.sumidos : 0,
    temHistorico: comp.temHistorico,
  };
}

/** As chaves de filtro de uma categoria já estão todas marcadas? */
export function categoriaMarcada(c: Categoria, marcadas: Set<string>): boolean {
  return c.chaves.length > 0 && c.chaves.every((k) => marcadas.has(k));
}

/**
 * Marca/desmarca uma categoria no filtro da lista, devolvendo o conjunto novo.
 * Nunca muda o conjunto de quem não tem lançamento no mês — filtrar por uma
 * categoria que sumiu esvaziaria a lista sem explicar por quê.
 */
export function alternarCategoriaNoFiltro(c: Categoria, marcadas: Set<string>): Set<string> {
  if (!c.chaves.length) return marcadas;
  const n = new Set(marcadas);
  if (categoriaMarcada(c, marcadas)) for (const k of c.chaves) n.delete(k);
  else for (const k of c.chaves) n.add(k);
  return n;
}

/** A faixa fechada: "4 categorias · 1 nova · 1 sumiu". */
export function resumoComposicao(c: Composicao): string {
  const partes = [`${c.quantas} ${c.quantas === 1 ? "categoria" : "categorias"}`];
  const voltaram = c.temHistorico ? c.categorias.filter((x) => x.situacao === "voltou").length : 0;
  if (c.novas) partes.push(`${c.novas} ${c.novas === 1 ? "nova" : "novas"}`);
  if (voltaram) partes.push(`${voltaram} ${voltaram === 1 ? "voltou" : "voltaram"}`);
  if (c.sumidas) partes.push(`${c.sumidas} ${c.sumidas === 1 ? "sumiu" : "sumiram"}`);
  return partes.join(" · ");
}

/** O rótulo do chip — o mesmo dos fornecedores, para os dois se lerem igual. */
export const rotuloCategoria = (c: Categoria): string => rotuloSituacao(c);

/**
 * A frase inteira, para o hover. Existe pelo mesmo motivo da dos fornecedores:
 * o chip diz "−72%" e sozinho não informa sobre o quê, nem entre que meses.
 */
export function explicarCategoria(
  c: Categoria,
  comp: Composicao,
  moeda: (n: number) => string,
): string {
  const atual = mesCurto(comp.mes);
  const anterior = mesCurto(comp.mesAnterior);
  const lanc = (n: number) => `${n} ${n === 1 ? "lançamento" : "lançamentos"}`;
  const fatia = `${(c.peso * 100).toFixed(c.peso < 0.1 ? 1 : 0)}% do movimento da linha em ${atual}`;

  if (c.situacao === "novo") {
    return `"${c.descricao}" não caiu nesta rubrica em nenhum dos ${comp.janela.length - 1} meses anteriores. `
      + `${atual}: ${moeda(c.valor)} em ${lanc(c.lancamentos)} — ${fatia}.`;
  }
  if (c.situacao === "voltou") {
    return `"${c.descricao}" não teve lançamento em ${anterior}; a última vez foi em ${mesCurto(c.visto as string)}. `
      + `${atual}: ${moeda(c.valor)} em ${lanc(c.lancamentos)} — ${fatia}.`;
  }
  if (c.situacao === "sumiu") {
    return `"${c.descricao}" teve ${moeda(c.valorAnterior)} em ${anterior} `
      + `(${lanc(c.lancamentosAnteriores)}) e nenhum lançamento em ${atual}.`;
  }

  const base = `"${c.descricao}" nesta rubrica: ${anterior} ${moeda(c.valorAnterior)} → ${atual} ${moeda(c.valor)}`;
  if (c.situacao === "igual") return `${base} — mesmo valor. ${fatia}.`;
  const pct = c.pct == null ? "" : ` (${Math.round(Math.abs(c.pct) * 100)}%)`;
  return `${base} — ${c.situacao === "subiu" ? "subiu" : "caiu"} ${moeda(Math.abs(c.delta))}${pct}. ${fatia}.`;
}

/** Reexportado para a tela não precisar conhecer o módulo do filtro. */
export { chaveCategoria };
