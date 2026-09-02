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
import {
  analisarSerie, atipicaNaSerie, recordeNaSerie, resumoDaSerie, JANELA_PADRAO,
  type PontoSerie, type SerieResumo,
} from "@/lib/serieRubrica";

/** Variação mínima para a célula virar comentário. */
export const LIMIAR_PCT = 0.10;
/** Piso em R$: 10% de uma rubrica de R$ 800 é ruído, não fato relevante. */
export const LIMIAR_VALOR = 1_000;

/**
 * Quanto do preenchimento dos meses anteriores um mês precisa ter para valer
 * como mês. Compartilhado por `mesTemDadoSuficiente` (que decide se o mês pode
 * ser COMENTADO) e por `ausenciasDoMes` (que decide se ele pode ser LIDO) —
 * duas perguntas diferentes com a mesma resposta: mês pela metade não se
 * compara com mês inteiro.
 */
export const FRACAO_MES_UTIL = 0.4;

/**
 * Por que a célula está na lista.
 *
 * `variacao` é a régua de sempre (>10% E ≥ R$ 1 mil contra o mês anterior). As
 * outras duas nasceram do que um PAR de meses não consegue ver:
 *
 * · `ausencia` — a rubrica vinha todo mês e este mês não veio. Contra o mês
 *   anterior isso é uma queda como outra qualquer; contra a série é o fato mais
 *   relevante da coluna.
 * · `atipica` — variou pouco em %, mas muito para o padrão DAQUELA rubrica.
 *   O piso de 10% não significa nada numa linha estável de meio milhão.
 */
export type MotivoCandidata = "variacao" | "ausencia" | "atipica";

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
  motivo: MotivoCandidata;
  /** A história da rubrica, em números. A frase é montada no servidor. */
  serie: SerieResumo | null;
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
  rows: Record<string, unknown>[], columns: string[], mes: string, fracao = FRACAO_MES_UTIL,
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
 * A rubrica é de despesa quando o par de meses não pode dizer.
 *
 * Não unificada com a regra de duas colunas abaixo DE PROPÓSITO: aquela decide o
 * SINAL do delta de comentários que já estão na base, e trocá-la por uma que
 * enxerga doze meses inverteria a direção de qualquer rubrica que um dia tenha
 * vindo positiva (um estorno basta). Aqui não há esse risco — na ausência o mês
 * está vazio, e sem o histórico não haveria orientação nenhuma.
 */
function despesaPeloHistorico(historico: PontoSerie[]): boolean {
  const vistos = historico
    .map((p) => p.valor)
    .filter((x): x is number => x != null && Number.isFinite(x) && x !== 0);
  return vistos.length > 0 && vistos.every((x) => x < 0);
}

/** Rótulos abaixo deste nó, sem ele. */
function descendentes(node: Node): string[] {
  return (node.children ?? []).flatMap((c) => [c.label, ...descendentes(c)]);
}

/**
 * A ausência pertence à FOLHA, nunca ao bloco que a soma.
 *
 * Uma linha com filhos vale a soma dos filhos: quando a única folha preenchida
 * some, o bloco e o total somem junto, e a mesma notícia sairia três vezes —
 * "(+) Receita financeira", "Entradas Operacionais" e o fluxo inteiro. Fica o
 * mais fundo, que é onde o lançamento cairia e onde o "?" tem o que procurar.
 *
 * O bloco continua entrando quando a ausência é DELE: se nenhum filho passou
 * sozinho no piso em R$ mas a soma passa, não há descendente na lista e ele
 * sobrevive ao corte.
 */
function apenasOMaisFundo<T>(itens: { item: T; rubrica: string; node: Node }[]): T[] {
  const ausentes = new Set(itens.map((i) => i.rubrica));
  return itens
    .filter(({ node }) => !descendentes(node).some((d) => ausentes.has(d)))
    .map(({ item }) => item);
}

/**
 * Células de um mês que merecem comentário — por três motivos, não mais um só.
 *
 * Linha de percentual fica de fora: ela é derivada de duas outras linhas, então
 * o comentário certo pertence às linhas de origem — explicar a margem seria
 * repetir, com menos informação, o que já está dito na receita e no custo.
 */
export function celulasCandidatas(opts: {
  schema: Node[];
  mes: string;
  mesAnterior: string;
  /** A grade inteira, em ordem — é dela que sai a história de cada rubrica. */
  colunas: string[];
  valorEm: ValorEm;
  limiarPct?: number;
  limiarValor?: number;
  janela?: number;
}): CelulaCandidata[] {
  const { schema, mes, mesAnterior, colunas, valorEm } = opts;
  const limiarPct = opts.limiarPct ?? LIMIAR_PCT;
  const limiarValor = opts.limiarValor ?? LIMIAR_VALOR;
  const janela = opts.janela ?? JANELA_PADRAO;
  const despesasDoEsquema = rotulosDeDespesa(schema);

  const iMes = colunas.indexOf(mes);
  /* Os meses ANTERIORES ao que está em foco. O mês em foco nunca entra na
     própria amostra: uma queda a zero puxaria a mediana para baixo e passaria a
     se explicar sozinha. */
  const janelaCols = iMes > 0 ? colunas.slice(Math.max(0, iMes - janela), iMes) : [];

  const vistas = new Set<string>();
  const out: CelulaCandidata[] = [];
  /* As ausências ficam de lado até o fim do laço: só com todas na mão dá para
     saber qual delas é a mais funda (ver `apenasOMaisFundo`). */
  const ausencias: { item: CelulaCandidata; rubrica: string; node: Node }[] = [];

  for (const node of achatar(schema)) {
    if (node.kind === "percent") continue;
    if (vistas.has(node.label)) continue;   // rótulo repetido no esquema (DRE e DFC compartilham nomes)
    vistas.add(node.label);

    const v = valorCelula(node, mes, valorEm);
    const p = valorCelula(node, mesAnterior, valorEm);
    const fontes = fontesDaCelula(node);
    const historico: PontoSerie[] = janelaCols.map((col) => ({
      mes: col,
      valor: valorCelula(node, col, valorEm),
    }));

    /* ---- 1) A rubrica que sumiu -------------------------------------------
       Vem ANTES do corte de célula vazia abaixo, e é a única razão pela qual
       uma célula sem número pode virar comentário: aqui a ausência não é
       "ainda não preencheram", é "vinha todo mês e este mês não veio". Quem
       separa as duas é a série — e o mês inteiro já passou por
       `mesTemDadoSuficiente` antes de chegar aqui. */
    const despesaAusencia = despesasDoEsquema.has(node.label) || despesaPeloHistorico(historico);
    const analise = analisarSerie({
      historico,
      atual: v,
      despesa: despesaAusencia,
      janela,
      minMedianaAusencia: limiarValor,
    });
    if (analise.ausente) {
      const anteriorA = p ?? 0;
      const atualA = v ?? 0;
      const deltaA = despesaAusencia
        ? Math.abs(atualA) - Math.abs(anteriorA)
        : atualA - anteriorA;
      ausencias.push({
        rubrica: node.label,
        node,
        item: {
          rubrica: node.label,
          valor: v,
          valorAnterior: p,
          delta: deltaA,
          deltaPct: variacao(anteriorA, atualA, { despesa: despesaAusencia })?.pct ?? null,
          despesa: despesaAusencia,
          fontes,
          motivo: "ausencia",
          serie: resumoDaSerie(analise),
        },
      });
      continue;
    }

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

    /* A série foi analisada acima com a orientação da ausência; se a do par
       discordar, refaz — a mediana e o z têm de ser lidos na mesma direção do
       delta que vai no mesmo comentário. */
    const serie = despesa === despesaAusencia
      ? analise
      : analisarSerie({ historico, atual: v, despesa, janela, minMedianaAusencia: limiarValor });

    const delta = despesa ? Math.abs(atual) - Math.abs(anterior) : atual - anterior;
    // O piso em R$ vale para TODOS os motivos: nenhuma régua justifica comentar
    // R$ 300 de diferença.
    if (Math.abs(delta) < limiarValor) continue;

    const va = variacao(anterior, atual, { despesa });
    if (va == null) {
      // Base zero: não há percentual, mas surgir R$ 50 mil onde não havia nada é
      // justamente o tipo de coisa que precisa de explicação.
      out.push({
        rubrica: node.label, valor: v, valorAnterior: p, delta, deltaPct: null, despesa, fontes,
        motivo: "variacao", serie: resumoDaSerie(serie),
      });
      continue;
    }

    /* ---- 2) A segunda régua ------------------------------------------------
       Abaixo de 10% a célula só entra se destoar da PRÓPRIA história. É o que
       resgata a rubrica grande e estável, onde 10% é um número que nunca
       acontece e por isso nunca acusou nada. */
    const foraDoPadrao = atipicaNaSerie(serie);
    if (Math.abs(va.pct) < limiarPct && !foraDoPadrao) continue;

    out.push({
      rubrica: node.label, valor: v, valorAnterior: p, delta, deltaPct: va.pct, despesa, fontes,
      motivo: Math.abs(va.pct) < limiarPct ? "atipica" : "variacao",
      serie: resumoDaSerie(serie),
    });
  }

  out.push(...apenasOMaisFundo(ausencias));

  /* A ausência vem primeiro, e não por tamanho: ela é rara, é a que mais
     costuma ser erro de lançamento, e o delta dela pode ser pequeno justamente
     quando a rubrica já estava minguando. Depois disso, maiores variações
     primeiro — se algum lote falhar, o que se perde é o menos relevante. */
  const peso = (c: CelulaCandidata) => (c.motivo === "ausencia" ? 1 : 0);
  return out.sort((a, b) => (peso(b) - peso(a)) || (Math.abs(b.delta) - Math.abs(a.delta)));
}

/* ============================================================
 *  A varredura de ausências — a única que roda em MÊS ABERTO
 * ============================================================
 * `celulasCandidatas` acima só é chamada para mês travado, e por bons motivos
 * (ver `gerarJustificativas`). Só que o fechamento acontece no mês ABERTO: é ali
 * que se descobre que a receita financeira não entrou, e ali não havia máquina
 * nenhuma olhando.
 *
 * Esta varredura é a metade da régua que pode rodar a qualquer hora, porque não
 * escreve nada: ela não redige, não chama IA, não grava. Só aponta a rubrica que
 * vinha todo mês e este mês não veio — e a pessoa pergunta dali mesmo, no "?" da
 * célula, que é onde a IA já sabe procurar no mês inteiro.
 *
 * Recebe `valorDaLinha` da PÁGINA, e não o índice do blob: é a mesma função que
 * pintou a célula, então o que a varredura chama de vazio é o que está vazio na
 * tela. Pelo mesmo motivo de `montarPergunta`.
 */
export type Ausencia = {
  rubrica: string;
  mes: string;
  despesa: boolean;
  serie: SerieResumo;
};

/**
 * O recorte de uma varredura de mês: os nós comentáveis e a janela de história.
 * `null` quando não há o que varrer — e o motivo mais importante é o segundo.
 */
function recorteDoMes(
  schema: Node[], colunas: string[], mes: string, janela: number,
  valorDaLinha: (node: Node, col: string) => number | null,
): { nos: Node[]; janelaCols: string[] } | null {
  const i = colunas.indexOf(mes);
  if (i <= 0) return null;   // sem história não há o que constatar
  const janelaCols = colunas.slice(Math.max(0, i - janela), i);
  const nos = achatar(schema).filter((n) => n.kind !== "percent");

  /* MÊS VAZIO NÃO TEM AUSÊNCIA — TEM O MÊS INTEIRO FALTANDO.
     Medido contra a base real em 01/09/2026: `Sep-26` da DRE tem 12 de 61
     células preenchidas (o tracker traz meses à frente pela metade) e, sem esta
     guarda, a varredura acusava 45 rubricas "que não vieram" — a página abriria
     com um alarme inteiro sobre um mês que nem começou.
     Não dava para confiar no corte de colunas vazias do fim que as páginas já
     fazem: ele exige a coluna INTEIRA zerada, e essas 12 células a salvam.
     Mesma régua dos 40% de `mesTemDadoSuficiente`, só que lida pela grade. */
  const preenchidas = (col: string) =>
    nos.reduce((n, no) => {
      const v = valorDaLinha(no, col);
      return v != null && v !== 0 ? n + 1 : n;
    }, 0);
  const cheio = janelaCols.length ? Math.max(...janelaCols.map(preenchidas)) : 0;
  if (cheio > 0 && preenchidas(mes) < cheio * FRACAO_MES_UTIL) return null;

  return { nos, janelaCols };
}

export function ausenciasDoMes(opts: {
  schema: Node[];
  colunas: string[];
  mes: string;
  valorDaLinha: (node: Node, col: string) => number | null;
  limiarValor?: number;
  janela?: number;
}): Ausencia[] {
  const { schema, colunas, mes, valorDaLinha } = opts;
  const limiarValor = opts.limiarValor ?? LIMIAR_VALOR;
  const janela = opts.janela ?? JANELA_PADRAO;
  const despesasDoEsquema = rotulosDeDespesa(schema);

  const recorte = recorteDoMes(schema, colunas, mes, janela, valorDaLinha);
  if (!recorte) return [];
  const { nos, janelaCols } = recorte;

  const vistas = new Set<string>();
  const achadas: { item: Ausencia; rubrica: string; node: Node }[] = [];

  for (const node of nos) {
    if (vistas.has(node.label)) continue;
    vistas.add(node.label);

    const atual = valorDaLinha(node, mes);
    if (atual != null && atual !== 0) continue;   // veio: não há o que apontar

    const historico: PontoSerie[] = janelaCols.map((col) => ({ mes: col, valor: valorDaLinha(node, col) }));
    const despesa = despesasDoEsquema.has(node.label) || despesaPeloHistorico(historico);
    const analise = analisarSerie({
      historico, atual, despesa, janela, minMedianaAusencia: limiarValor,
    });
    if (!analise.ausente) continue;

    achadas.push({
      rubrica: node.label, node,
      item: { rubrica: node.label, mes, despesa, serie: resumoDaSerie(analise) },
    });
  }

  // Maior mediana primeiro: é o dinheiro que está faltando na coluna.
  return apenasOMaisFundo(achadas)
    .sort((a, b) => Math.abs(b.serie.mediana) - Math.abs(a.serie.mediana));
}

/* ============================================================
 *  Recorde de 12 meses — a outra metade que roda em mês aberto
 * ============================================================
 * A ausência acusa o que não veio; esta acusa o que veio grande demais. É o
 * mesmo desenho: determinística, sem gravar nada, válida no mês em curso.
 *
 * A margem de `recordeNaSerie` é o que impede a lista de virar "toda receita
 * bate recorde todo mês" numa empresa que cresce.
 */
export type Recorde = {
  rubrica: string;
  mes: string;
  despesa: boolean;
  /** O valor da célula, cru (com o sinal do blob). */
  valor: number;
  serie: SerieResumo;
};

export function recordesDoMes(opts: {
  schema: Node[];
  colunas: string[];
  mes: string;
  valorDaLinha: (node: Node, col: string) => number | null;
  limiarValor?: number;
  janela?: number;
}): Recorde[] {
  const { schema, colunas, mes, valorDaLinha } = opts;
  const limiarValor = opts.limiarValor ?? LIMIAR_VALOR;
  const janela = opts.janela ?? JANELA_PADRAO;
  const despesasDoEsquema = rotulosDeDespesa(schema);

  const recorte = recorteDoMes(schema, colunas, mes, janela, valorDaLinha);
  if (!recorte) return [];
  const { nos, janelaCols } = recorte;

  const vistas = new Set<string>();
  const out: Recorde[] = [];

  for (const node of nos) {
    if (vistas.has(node.label)) continue;
    vistas.add(node.label);

    const atual = valorDaLinha(node, mes);
    if (atual == null || atual === 0) continue;

    const historico: PontoSerie[] = janelaCols.map((col) => ({ mes: col, valor: valorDaLinha(node, col) }));
    const despesa = despesasDoEsquema.has(node.label) || despesaPeloHistorico(historico);
    const analise = analisarSerie({ historico, atual, despesa, janela, minMedianaAusencia: limiarValor });
    if (!recordeNaSerie(analise, atual, despesa, limiarValor)) continue;

    out.push({ rubrica: node.label, mes, despesa, valor: atual, serie: resumoDaSerie(analise) });
  }

  /* Aqui NÃO se corta o pai: quando o bloco inteiro bate recorde, isso é um fato
     sobre o bloco, e não a repetição do fato do filho — pode ser a soma de três
     folhas que subiram um pouco cada. Quem some é a repetição literal, e ela não
     existe: dois nós só batem recorde juntos se ambos bateram. */
  return out.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
}

/**
 * A frase que a marca da célula e o resumo da barra mostram.
 *
 * Fica aqui, e não no componente, porque a barra e o "?" dizem a MESMA coisa em
 * dois lugares — e porque ela também vira a pergunta sugerida, que precisa ser
 * a mesma frase que a pessoa acabou de ler.
 */
export function fraseDaAusencia(a: Ausencia, rotuloMes: (k: string) => string): string {
  const brl = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const quantos = a.serie.meses === a.serie.janela
    ? `nos ${a.serie.janela} meses anteriores`
    : `em ${a.serie.meses} dos ${a.serie.janela} meses anteriores`;
  const ultimo = a.serie.ultimoMes && a.serie.ultimoValor != null
    ? ` — o último foi ${brl(a.serie.ultimoValor)} em ${rotuloMes(a.serie.ultimoMes)}`
    : "";
  return `Teve valor ${quantos} (mediana ${brl(a.serie.mediana)})${ultimo}, e em `
    + `${rotuloMes(a.mes)} está ${a.serie.zerada ? "zerada" : "sem linha"}.`;
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

    const celulas = celulasCandidatas({ schema, mes, mesAnterior, colunas: columns, valorEm });
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
