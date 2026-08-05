/* ============================================================================
 * Quais células merecem um comentário — e o disparo da geração.
 *
 * A CONTA DA VARIAÇÃO MORA AQUI, no cliente, de propósito: é esta página que
 * tem o esquema hierárquico da DRE/DFC e portanto os mesmos números que estão à
 * vista. Se o servidor recalculasse a partir do blob, um comentário poderia
 * dizer "+8k" numa célula que mostra outra coisa — e um comentário que não bate
 * com o número ao lado destrói a confiança em todos os outros.
 *
 * O servidor (`demonstracoes-justificar`) faz o que a tela não pode: descer nos
 * lançamentos do Omie para descobrir QUEM causou a variação, e redigir.
 * ========================================================================== */

import { supabase } from "@/integrations/supabase/client";
import { variacao, rotulosDeDespesa, type Node } from "@/lib/demonstracoes-schema";

/** Variação mínima para a célula virar comentário. */
export const LIMIAR_PCT = 0.10;
/** Piso em R$: 10% de uma rubrica de R$ 800 é ruído, não fato relevante. */
export const LIMIAR_VALOR = 1_000;

export type CelulaCandidata = {
  rubrica: string;
  valor: number | null;
  valorAnterior: number | null;
  delta: number;
  deltaPct: number | null;   // null = base zero (não havia valor no mês anterior)
  despesa: boolean;
};

type ValorEm = (label: string, col: string) => number | null;

/* Mesmo `toNum` das páginas DRE/DFC: a base guarda número, mas um tracker
   importado pode deixar "R$ 1.234,56" ou "(890)" numa célula. */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

/**
 * Índice rótulo → valores, idêntico ao `valueByLabel` das páginas (inclusive no
 * detalhe de rótulo repetido SOBRESCREVER em vez de somar).
 *
 * Existe para a geração poder rodar logo depois de um import, com os dados que
 * acabaram de ser lidos, sem depender do estado do React já ter re-renderizado —
 * senão o comentário sairia descrevendo a planilha ANTERIOR.
 */
export function criarValorEm(rows: Record<string, unknown>[], columns: string[]): ValorEm {
  const mapa = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    const labelKey = Object.keys(r).find((k) => !/^[A-Za-z]{3}-\d{2}$/.test(k));
    const label = labelKey ? String(r[labelKey] ?? "").trim() : "";
    if (!label) continue;
    const obj: Record<string, number | null> = {};
    for (const c of columns) obj[c] = toNum(r[c]);
    mapa.set(label.toLowerCase(), obj);
  }
  return (label, col) => mapa.get(label.toLowerCase())?.[col] ?? null;
}

/** Achata o esquema preservando a ordem de exibição. */
function achatar(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => [n, ...(n.children ? achatar(n.children) : [])]);
}

/**
 * Valor de uma célula EXATAMENTE como a tela calcula (DRE.tsx / DFC.tsx):
 * só nó `header` com filhos soma os filhos; qualquer outro lê a própria linha
 * da base — inclusive `child` que tem filhos, como "Pessoal".
 */
function valorCelula(node: Node, col: string, valorEm: ValorEm): number | null {
  if (node.kind === "header" && node.children?.length) {
    let total: number | null = null;
    const somar = (n: Node): number | null => {
      if (!n.children?.length) return valorEm(n.label, col);
      let t: number | null = null;
      for (const c of n.children) {
        const v = somar(c);
        if (v != null) t = (t ?? 0) + v;
      }
      return t ?? valorEm(n.label, col);
    };
    for (const c of node.children) {
      const v = somar(c);
      if (v != null) total = (total ?? 0) + v;
    }
    return total ?? valorEm(node.label, col);
  }
  return valorEm(node.label, col);
}

/**
 * Células de um mês que variaram acima do limiar contra o mês anterior.
 *
 * Linha de percentual fica de fora: ela é derivada de duas outras linhas, então
 * o comentário certo pertence às linhas de origem — explicar a margem seria
 * repetir, com menos informação, o que já está dito na receita e no custo.
 */
export function celulasCandidatas(opts: {
  schema: Node[];
  mes: string;
  mesAnterior: string;
  valorEm: ValorEm;
  limiarPct?: number;
  limiarValor?: number;
}): CelulaCandidata[] {
  const { schema, mes, mesAnterior, valorEm } = opts;
  const limiarPct = opts.limiarPct ?? LIMIAR_PCT;
  const limiarValor = opts.limiarValor ?? LIMIAR_VALOR;
  const despesasDoEsquema = rotulosDeDespesa(schema);

  const vistas = new Set<string>();
  const out: CelulaCandidata[] = [];

  for (const node of achatar(schema)) {
    if (node.kind === "percent") continue;
    if (vistas.has(node.label)) continue;   // rótulo repetido no esquema (DRE e DFC compartilham nomes)
    vistas.add(node.label);

    const v = valorCelula(node, mes, valorEm);
    const p = valorCelula(node, mesAnterior, valorEm);
    if (v == null && p == null) continue;

    const atual = v ?? 0;
    const anterior = p ?? 0;

    // "Despesa" pelo esquema (bloco "(-)") OU pelo dado: na DFC as saídas não
    // trazem "(-)" no rótulo, mas chegam negativas. Sem isto, gastar mais
    // apareceria como variação negativa e o texto sairia invertido.
    const despesa = despesasDoEsquema.has(node.label)
      || (atual <= 0 && anterior <= 0 && (atual < 0 || anterior < 0));

    const delta = despesa ? Math.abs(atual) - Math.abs(anterior) : atual - anterior;
    if (Math.abs(delta) < limiarValor) continue;

    const va = variacao(anterior, atual, { despesa });
    if (va == null) {
      // Base zero: não há percentual, mas surgir R$ 50 mil onde não havia nada é
      // justamente o tipo de coisa que precisa de explicação.
      out.push({ rubrica: node.label, valor: v, valorAnterior: p, delta, deltaPct: null, despesa });
      continue;
    }
    if (Math.abs(va.pct) < limiarPct) continue;
    out.push({ rubrica: node.label, valor: v, valorAnterior: p, delta, deltaPct: va.pct, despesa });
  }

  // Maiores variações primeiro: se algum lote falhar, o que se perde é o menos
  // relevante.
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export type ProgressoGeracao = { mes: string; indice: number; total: number; geradas: number };

/**
 * Gera as justificativas de uma lista de meses, um mês por chamada.
 *
 * Um mês por chamada (e não tudo de uma vez) porque cada mês é uma varredura do
 * cache do Omie mais uma ida ao Gemini: em lote único a chamada estoura o tempo
 * do navegador e o usuário fica sem nada. Assim ele vê o progresso e, se algo
 * falhar no meio, os meses anteriores já ficaram salvos.
 */
export async function gerarJustificativas(opts: {
  tipo: "dre" | "dfc";
  schema: Node[];
  columns: string[];
  valorEm: ValorEm;
  meses: string[];
  force?: boolean;
  onProgress?: (p: ProgressoGeracao) => void;
}): Promise<{ geradas: number; puladas: number; meses: number; erros: string[] }> {
  const { tipo, schema, columns, valorEm, meses, force } = opts;
  let geradas = 0, puladas = 0, processados = 0;
  const erros: string[] = [];

  for (let i = 0; i < meses.length; i++) {
    const mes = meses[i];
    const idx = columns.indexOf(mes);
    if (idx <= 0) continue;                       // sem mês anterior não há o que comparar
    const mesAnterior = columns[idx - 1];

    const celulas = celulasCandidatas({ schema, mes, mesAnterior, valorEm });
    opts.onProgress?.({ mes, indice: i + 1, total: meses.length, geradas });
    if (!celulas.length) { processados++; continue; }

    const { data, error } = await supabase.functions.invoke("demonstracoes-justificar", {
      body: { tipo, mes, mesAnterior, celulas, force },
    });
    if (error || data?.error) {
      erros.push(`${mes}: ${data?.error ?? error?.message ?? "erro desconhecido"}`);
      continue;
    }
    geradas += Number(data?.geradas) || 0;
    puladas += Number(data?.puladas) || 0;
    processados++;
  }

  return { geradas, puladas, meses: processados, erros };
}
