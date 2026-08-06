/* ============================================================================
 * Quais células merecem um comentário — e o disparo da geração.
 *
 * A CONTA DA VARIAÇÃO MORA AQUI, no cliente, de propósito: é esta página que
 * tem o esquema hierárquico da DRE/DFC e portanto os mesmos números que estão à
 * vista. Se o servidor recalculasse a partir do blob, um comentário poderia
 * dizer "+8k" numa célula que mostra outra coisa — e um comentário que não bate
 * com o número ao lado destrói a confiança em todos os outros.
 *
 * Isso só vale se a conta daqui for LITERALMENTE a da tela. Já não era: este
 * arquivo tinha cópias próprias do índice e da soma, e elas ficaram para trás
 * quando as páginas aprenderam a somar as duas grafias da mesma rubrica e a
 * somar os filhos de qualquer nó (não só dos `header`). O resultado foi o
 * comentário "Receita Recorrente caiu -1,13M" numa célula que mostrava 1,23M:
 * a tela somava os filhos, o gerador lia a linha-pai vazia do blob. Agora as
 * duas usam `indexarCelulas` e a mesma regra de soma — ver demonstracoes-schema.
 *
 * O servidor (`demonstracoes-justificar`) faz o que a tela não pode: descer nos
 * lançamentos do Omie para descobrir QUEM causou a variação, e redigir.
 * ========================================================================== */

import { supabase } from "@/integrations/supabase/client";
import { celulaNumero, indexarCelulas, variacao, rotulosDeDespesa, type Node } from "@/lib/demonstracoes-schema";

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
  /** Rótulos que compõem a célula — é por eles que o servidor acha os
   *  lançamentos do Omie. Numa linha somada, os filhos; numa folha, ela mesma. */
  fontes: string[];
};

type ValorEm = (label: string, col: string) => number | null;

/**
 * Índice rótulo → valores, o MESMO das páginas DRE/DFC (`indexarCelulas`):
 * duas grafias da mesma rubrica somam, em vez de uma apagar a outra.
 *
 * Existe para a geração poder rodar logo depois de um import, com os dados que
 * acabaram de ser lidos, sem depender do estado do React já ter re-renderizado —
 * senão o comentário sairia descrevendo a planilha ANTERIOR.
 */
export function criarValorEm(rows: Record<string, unknown>[], columns: string[]): ValorEm {
  const idx = indexarCelulas(rows, columns);
  return (label, col) => idx.get(label.trim().toLowerCase())?.[col] ?? null;
}

/** Achata o esquema preservando a ordem de exibição. */
function achatar(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => [n, ...(n.children ? achatar(n.children) : [])]);
}

/**
 * Valor de uma célula EXATAMENTE como a tela calcula (`valorDaLinha` +
 * `sumChildren` em DRE.tsx / DFC.tsx): QUALQUER nó com filhos é a soma dos
 * filhos — o número que o blob guarda para "Pessoal" ou "Receita Recorrente" só
 * é reescrito no import do tracker, e o omie-sync mexe nas folhas deixando o pai
 * para trás. Sem nenhum filho preenchido, cai na própria linha.
 */
function valorCelula(node: Node, col: string, valorEm: ValorEm): number | null {
  if (!node.children?.length) return valorEm(node.label, col);
  let total: number | null = null;
  for (const c of node.children) {
    const v = valorCelula(c, col, valorEm);
    if (v != null) total = (total ?? 0) + v;
  }
  return total ?? valorEm(node.label, col);
}

/**
 * De onde vêm os lançamentos que explicam a célula: as folhas que a tela soma,
 * mais o próprio rótulo (o DE-PARA do Omie às vezes aponta direto para o pai).
 *
 * Sem isto o servidor procurava contraparte pelo nome da linha somada — que não
 * existe no DE-PARA — e TODA rubrica com filhos saía sem driver nenhum e com o
 * aviso "os lançamentos do Omie não cobrem essa variação". Eram 59% dos
 * comentários, justamente nas linhas que o tracker mais comenta.
 */
export function fontesDaCelula(node: Node): string[] {
  const out = new Set<string>([node.label]);
  const walk = (n: Node) => {
    if (!n.children?.length) { out.add(n.label); return; }
    for (const c of n.children) walk(c);
  };
  walk(node);
  return [...out];
}

/** Quantas rubricas o mês tem preenchidas na base. */
function preenchimento(rows: Record<string, unknown>[], mes: string): number {
  let n = 0;
  for (const r of rows) {
    const v = celulaNumero(r[mes]);
    if (v != null && v !== 0) n++;
  }
  return n;
}

/**
 * O mês tem dado de gente ou é o mês em aberto?
 *
 * A base traz o mês corrente com meia dúzia de linhas soltas (o clássico
 * "Receita Bruta = 1"). Comparado com um mês inteiro, tudo "caiu 100%" — foram
 * 50 comentários assim só em Ago/26. Vale o mês que chega a 40% do
 * preenchimento dos meses anteriores.
 */
export function mesTemDadoSuficiente(
  rows: Record<string, unknown>[], columns: string[], mes: string, fracao = 0.4,
): boolean {
  const i = columns.indexOf(mes);
  if (i < 0) return false;
  const referencia = columns.slice(Math.max(0, i - 6), i).map((c) => preenchimento(rows, c));
  if (!referencia.length) return true;
  const cheio = Math.max(...referencia);
  if (!cheio) return true;
  return preenchimento(rows, mes) >= cheio * fracao;
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
    // Célula sem número NÃO é queda: é ausência de dado. Tratá-la como zero foi
    // o que produziu "Receita Recorrente caiu -1,13M (-100%)" num mês em que a
    // linha simplesmente ainda não tinha sido preenchida.
    if (v == null) continue;

    const atual = v;
    const anterior = p ?? 0;

    // "Despesa" pelo esquema (bloco "(-)") OU pelo dado: na DFC as saídas não
    // trazem "(-)" no rótulo, mas chegam negativas. Sem isto, gastar mais
    // apareceria como variação negativa e o texto sairia invertido.
    const despesa = despesasDoEsquema.has(node.label)
      || (atual <= 0 && anterior <= 0 && (atual < 0 || anterior < 0));

    const delta = despesa ? Math.abs(atual) - Math.abs(anterior) : atual - anterior;
    if (Math.abs(delta) < limiarValor) continue;

    const fontes = fontesDaCelula(node);
    const va = variacao(anterior, atual, { despesa });
    if (va == null) {
      // Base zero: não há percentual, mas surgir R$ 50 mil onde não havia nada é
      // justamente o tipo de coisa que precisa de explicação.
      out.push({ rubrica: node.label, valor: v, valorAnterior: p, delta, deltaPct: null, despesa, fontes });
      continue;
    }
    if (Math.abs(va.pct) < limiarPct) continue;
    out.push({ rubrica: node.label, valor: v, valorAnterior: p, delta, deltaPct: va.pct, despesa, fontes });
  }

  // Maiores variações primeiro: se algum lote falhar, o que se perde é o menos
  // relevante.
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export type ProgressoGeracao = { mes: string; indice: number; total: number; geradas: number };

/**
 * Gera as justificativas de uma lista de meses, um mês por chamada.
 *
 * SÓ MÊS TRAVADO. Travar é o ato de fechar o mês — é quando os números param de
 * mudar e é exatamente quando o comentário era escrito à mão no tracker. Gerar
 * antes disso produzia texto sobre um mês pela metade que ninguém via (a marca
 * na célula só aparece em mês travado) e que ficava congelado ali: quando o mês
 * fechava de verdade, o comentário que aparecia era o velho, escrito contra
 * números que não existiam mais.
 *
 * Um mês por chamada (e não tudo de uma vez) porque cada mês é uma varredura do
 * cache do Omie mais uma ida à IA: em lote único a chamada estoura o tempo
 * do navegador e o usuário fica sem nada. Assim ele vê o progresso e, se algo
 * falhar no meio, os meses anteriores já ficaram salvos.
 */
export async function gerarJustificativas(opts: {
  tipo: "dre" | "dfc";
  schema: Node[];
  columns: string[];
  rows: Record<string, unknown>[];
  meses: string[];
  /** Meses fechados. Os demais são ignorados — ver acima. */
  travados: Set<string>;
  force?: boolean;
  onProgress?: (p: ProgressoGeracao) => void;
}): Promise<{
  geradas: number; puladas: number; semLastro: number; meses: number;
  ignorados: string[]; erros: string[];
}> {
  const { tipo, schema, columns, rows, meses, travados, force } = opts;
  const valorEm = criarValorEm(rows, columns);
  let geradas = 0, puladas = 0, semLastro = 0, processados = 0;
  const ignorados: string[] = [];
  const erros: string[] = [];

  const elegiveis = meses.filter((mes) => {
    const idx = columns.indexOf(mes);
    if (idx <= 0) return false;                       // sem mês anterior não há o que comparar
    if (!travados.has(mes)) { ignorados.push(mes); return false; }
    // Comparar contra um mês pela metade inventa variação; o mês de referência
    // precisa ser tão real quanto o que está sendo comentado.
    if (!mesTemDadoSuficiente(rows, columns, mes)
      || !mesTemDadoSuficiente(rows, columns, columns[idx - 1])) { ignorados.push(mes); return false; }
    return true;
  });

  for (let i = 0; i < elegiveis.length; i++) {
    const mes = elegiveis[i];
    const mesAnterior = columns[columns.indexOf(mes) - 1];

    const celulas = celulasCandidatas({ schema, mes, mesAnterior, valorEm });
    opts.onProgress?.({ mes, indice: i + 1, total: elegiveis.length, geradas });
    if (!celulas.length) { processados++; continue; }

    const { data, error } = await supabase.functions.invoke("demonstracoes-justificar", {
      body: { tipo, mes, mesAnterior, celulas, force },
    });
    if (error || data?.error) {
      erros.push(`${mes}: ${data?.error ?? error?.message ?? "erro desconhecido"}`);
      continue;
    }
    // A redação pode falhar sem a chamada falhar (o lote é engolido lá dentro
    // para não derrubar os outros meses). Sem isto, "0 geradas" chegava aqui com
    // cara de "não havia o que gerar".
    if (data?.lotes_falhos) {
      erros.push(`${mes}: a IA não redigiu ${data.lotes_falhos} lote(s) — ${data.falha_ia ?? "sem detalhe"}`);
    }
    geradas += Number(data?.geradas) || 0;
    puladas += Number(data?.puladas) || 0;
    semLastro += Number(data?.sem_lastro) || 0;
    processados++;
  }

  return { geradas, puladas, semLastro, meses: processados, ignorados, erros };
}
