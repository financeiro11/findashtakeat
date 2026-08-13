/* ============================================================================
 * Análises da DRE — a conta por trás da aba "Análises".
 *
 * Tudo aqui é função pura sobre o blob da DRE (`demonstracoes_contabeis`,
 * tipo "dre") para poder ser testado sem tela nem Supabase. O componente
 * `components/demonstracoes/Analises.tsx` só busca dado e desenha.
 *
 * Duas armadilhas do blob que este módulo resolve de uma vez:
 *
 *  1. SINAL. O omie-sync grava despesa negativa; o import do tracker em Excel
 *     nem sempre. Em vez de apostar numa convenção, cada mês descobre a sua
 *     (mesma ideia do `fatorSinal` em lib/pontoEquilibrio.ts). Sem isso o
 *     gráfico de SG&A vira de cabeça para baixo em meses vindos da planilha.
 *
 *  2. PAI DESATUALIZADO. Rubrica com filhos é SEMPRE a soma dos filhos — o
 *     número gravado no pai só é reescrito no import do tracker, e o omie-sync
 *     mexe nas folhas deixando o pai para trás. É a mesma regra do
 *     `valorDaLinha` da página DRE, e as três telas precisam concordar.
 * ========================================================================== */

import {
  DRE_SCHEMA, DFC_SCHEMA, indexarCelulas, rotulosDeDespesa, parseColuna, mesAtras, MES_PT,
  CASHBURN, NOVOS_EMPRESTIMOS, cashburnDoMes,
  type Node,
} from "@/lib/demonstracoes-schema";

export type LinhaBlob = Record<string, unknown>;

/* Rótulos usados nas contas — em um lugar só para um rename na DRE não deixar
   uma análise silenciosamente zerada. */
export const RL = "Receita Líquida";
export const EBITDA = "EBITDA";
export const SGA = "(-) SG&A";
export const CUSTOS_OP = "(-) Custos Operacionais";
export const PESSOAL_SGA = "Pessoal";
export const RECEITA_RECORRENTE = "Receita Recorrente";
/* O custo de gente que NÃO está no bloco Pessoal do SG&A: mora em Custos
   Operacionais porque acompanha o volume de operação. */
export const PESSOAL_OPERACAO = ["Equipe Operacional", "Premiações Operacionais"];

/* Toda rubrica que desce de um bloco "(-)". Em minúsculas porque é assim que o
   `indexarCelulas` chaveia as linhas do blob. */
const DESPESAS = new Set(
  [...rotulosDeDespesa(DRE_SCHEMA)].map((l) => l.toLowerCase()),
);

/* ------------------------------------------------------------------ *
 *  Leitura do blob
 * ------------------------------------------------------------------ */

export type Leitor = {
  /** Valor cru da rubrica no mês, com a regra pai = soma dos filhos. */
  bruto: (label: string, col: string) => number | null;
  /** Receita em módulo (receita nunca é crédito líquido). */
  receita: (label: string, col: string) => number | null;
  /** Despesa como magnitude POSITIVA, respeitando o sinal do mês. */
  custo: (label: string, col: string) => number | null;
  /** Soma de várias rubricas de despesa no mesmo mês. */
  custoDe: (labels: string[], col: string) => number | null;
  colunas: string[];
};

const acharNo = (nodes: Node[], label: string): Node | null => {
  const alvo = label.toLowerCase();
  for (const n of nodes) {
    if (n.label.toLowerCase() === alvo) return n;
    const dentro = n.children ? acharNo(n.children, label) : null;
    if (dentro) return dentro;
  }
  return null;
};

/**
 * Fator de sinal do mês: -1 quando a planilha grava despesa negativa.
 *
 * Decidido pelo TOTAL das despesas do mês, não rubrica a rubrica — assim uma
 * linha de crédito isolada (um estorno) continua abatendo em vez de somar, que
 * é o que um `Math.abs` linha a linha jogaria fora.
 */
function fatorSinal(
  celulas: Map<string, Record<string, number | null>>,
  col: string,
): number {
  let soma = 0;
  for (const [chave, meses] of celulas) {
    if (!DESPESAS.has(chave)) continue;
    soma += meses[col] ?? 0;
  }
  return soma <= 0 ? -1 : 1;
}

export function lerDre(rows: LinhaBlob[], columns: string[]): Leitor {
  const celulas = indexarCelulas(rows, columns);
  const sinais = new Map<string, number>();
  for (const c of columns) sinais.set(c, fatorSinal(celulas, c));

  const cru = (label: string, col: string): number | null =>
    celulas.get(label.toLowerCase())?.[col] ?? null;

  const somaFilhos = (node: Node, col: string): number | null => {
    if (!node.children?.length) return cru(node.src ?? node.label, col);
    let total: number | null = null;
    for (const f of node.children) {
      const v = somaFilhos(f, col);
      if (v != null) total = (total ?? 0) + v;
    }
    return total ?? cru(node.src ?? node.label, col);
  };

  const bruto = (label: string, col: string): number | null => {
    const no = acharNo(DRE_SCHEMA, label);
    return no ? somaFilhos(no, col) : cru(label, col);
  };

  const custo = (label: string, col: string): number | null => {
    const v = bruto(label, col);
    return v == null ? null : (sinais.get(col) ?? 1) * v;
  };

  const custoDe = (labels: string[], col: string): number | null => {
    let total: number | null = null;
    for (const l of labels) {
      const v = custo(l, col);
      if (v != null) total = (total ?? 0) + v;
    }
    return total;
  };

  const receita = (label: string, col: string): number | null => {
    const v = bruto(label, col);
    return v == null ? null : Math.abs(v);
  };

  return { bruto, receita, custo, custoDe, colunas: columns };
}

/* ------------------------------------------------------------------ *
 *  Janela de meses
 * ------------------------------------------------------------------ */

/**
 * Meses que entram nos gráficos: os que têm receita de verdade.
 *
 * O mês corrente aparece na DRE com custo cheio e receita pela metade — num
 * gráfico de tendência ele é sempre um tombo falso. Por isso o último mês só
 * entra se estiver travado (fechado) ou se não for o mês corrente.
 */
export function mesesComDado(
  leitor: Leitor,
  colunas: string[],
  travados: Set<string>,
  colAtual: string,
): string[] {
  return colunas.filter((c) => {
    if ((leitor.receita(RL, c) ?? 0) <= 0) return false;
    if (c === colAtual && !travados.has(c)) return false;
    return true;
  });
}

/**
 * Lê o blob de `demonstracoes_contabeis` nos DOIS formatos que existem.
 *
 * Import antigo gravou array cru; o novo grava `{ rows, columns }`. Quem lê tem
 * de aguentar os dois — e já aguentava, em cópias separadas em cada tela. As
 * colunas voltam só as MENSAIS e em ordem cronológica: "Conta", "Total" e afins
 * não são mês, e a ordem alfabética poria Ago antes de Jul.
 */
export function lerBlobMensal(raw: unknown): { rows: LinhaBlob[]; columns: string[] } {
  let rows: LinhaBlob[] = [];
  let cols: string[] = [];
  if (Array.isArray(raw)) {
    rows = raw as LinhaBlob[];
    cols = Object.keys(rows[0] ?? {});
  } else if (raw && typeof raw === "object") {
    const envelope = raw as { rows?: LinhaBlob[]; columns?: string[] };
    if (Array.isArray(envelope.rows)) {
      rows = envelope.rows;
      cols = envelope.columns ?? Object.keys(rows[0] ?? {});
    }
  }
  const mensais = cols.filter((c) => parseColuna(c) != null);
  const ordem = (k: string) => {
    const c = parseColuna(k)!;
    return c.ano * 12 + c.mes;
  };
  return { rows, columns: mensais.sort((a, b) => ordem(a) - ordem(b)) };
}

/**
 * "Jul-26" → "2026-07", a chave de competência dos snapshots.
 *
 * A coluna do blob é o idioma da DRE; `assinaturas_snapshot`, `churn_snapshot` e
 * os outros falam competência ISO. Mora aqui, junto dos outros tradutores de
 * mês, porque já foi escrita duas vezes em telas diferentes.
 */
export function competenciaDe(col: string): string | null {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(col ?? "");
  if (!m) return null;
  const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const i = EN.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (i < 0) return null;
  return `20${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

/** "Jul-26" → "Jul/26" */
export function rotuloMes(col: string): string {
  const c = parseColuna(col);
  return c ? `${MES_PT[c.mes - 1]}/${String(c.ano % 100).padStart(2, "0")}` : col;
}

/** A coluna do mesmo mês 12 meses antes ("Jul-26" → "Jul-25"). */
export const mesmoMesAnoPassado = (col: string): string | null => mesAtras(col, 12);

/* ------------------------------------------------------------------ *
 *  1. Alavancagem operacional — receita × SG&A
 * ------------------------------------------------------------------ */

export type PontoAlavancagem = {
  mes: string;
  rotulo: string;
  receita: number | null;
  sga: number | null;
  /** ambos indexados em 100 no primeiro mês da janela */
  receitaIdx: number | null;
  sgaIdx: number | null;
  receitaBpIdx: number | null;
  sgaBpIdx: number | null;
  /** SG&A como % da receita líquida */
  pesoSga: number | null;
  pesoSgaBp: number | null;
};

export type Alavancagem = {
  serie: PontoAlavancagem[];
  /** crescimento acumulado da receita na janela (0,25 = +25%) */
  cresceReceita: number | null;
  cresceSga: number | null;
  /** cresceReceita − cresceSga: positivo = a tesoura abriu a nosso favor */
  tesoura: number | null;
  /** peso do SG&A no primeiro e no último mês, em pontos percentuais */
  pesoInicio: number | null;
  pesoFim: number | null;
};

/**
 * A receita está crescendo mais rápido que a estrutura?
 *
 * Os dois indexados em 100 no primeiro mês da janela: é a leitura que responde
 * a pergunta sem que a diferença de tamanho entre receita e SG&A esmague uma
 * das curvas. O peso (SG&A ÷ receita) vem junto porque índice sozinho esconde
 * o nível — duas empresas com a mesma inclinação podem ter SG&A de 30% ou 80%
 * da receita.
 */
export function alavancagem(
  leitor: Leitor,
  meses: string[],
  bp?: (label: string, col: string) => number | null,
): Alavancagem {
  const base = meses[0];
  const receitaBase = base ? leitor.receita(RL, base) : null;
  const sgaBase = base ? leitor.custo(SGA, base) : null;
  const receitaBpBase = base && bp ? bp(RL, base) : null;
  const sgaBpBase = base && bp ? bp(SGA, base) : null;

  const idx = (v: number | null, b: number | null) =>
    v == null || b == null || b === 0 ? null : (v / Math.abs(b)) * 100;

  const serie: PontoAlavancagem[] = meses.map((mes) => {
    const receita = leitor.receita(RL, mes);
    const sga = leitor.custo(SGA, mes);
    const receitaBp = bp ? bp(RL, mes) : null;
    const sgaBp = bp ? bp(SGA, mes) : null;
    return {
      mes,
      rotulo: rotuloMes(mes),
      receita,
      sga,
      receitaIdx: idx(receita, receitaBase),
      sgaIdx: idx(sga, sgaBase),
      receitaBpIdx: idx(receitaBp == null ? null : Math.abs(receitaBp), receitaBpBase == null ? null : Math.abs(receitaBpBase)),
      sgaBpIdx: idx(sgaBp == null ? null : Math.abs(sgaBp), sgaBpBase == null ? null : Math.abs(sgaBpBase)),
      pesoSga: receita && receita !== 0 && sga != null ? (sga / receita) * 100 : null,
      pesoSgaBp: receitaBp && receitaBp !== 0 && sgaBp != null ? (Math.abs(sgaBp) / Math.abs(receitaBp)) * 100 : null,
    };
  });

  const primeiro = serie[0];
  const ultimo = serie[serie.length - 1];
  const cresc = (fim: number | null, ini: number | null) =>
    fim == null || ini == null || ini === 0 ? null : fim / Math.abs(ini) - 1;

  const cresceReceita = cresc(ultimo?.receita ?? null, primeiro?.receita ?? null);
  const cresceSga = cresc(ultimo?.sga ?? null, primeiro?.sga ?? null);

  return {
    serie,
    cresceReceita,
    cresceSga,
    tesoura: cresceReceita == null || cresceSga == null ? null : cresceReceita - cresceSga,
    pesoInicio: primeiro?.pesoSga ?? null,
    pesoFim: ultimo?.pesoSga ?? null,
  };
}

/* ------------------------------------------------------------------ *
 *  2. Produtividade — pessoal sobre receita líquida
 * ------------------------------------------------------------------ */

export type PontoPessoal = {
  mes: string;
  rotulo: string;
  receita: number | null;
  /** bloco "Pessoal" do SG&A (equipes adm/mkt/comercial/tec + encargos e benefícios) */
  estrutura: number | null;
  /** estrutura + equipe operacional e premiações operacionais */
  total: number | null;
  /** ambos em % da receita líquida */
  estruturaPct: number | null;
  totalPct: number | null;
};

/**
 * Cada real de receita paga quanto de gente?
 *
 * Duas linhas de propósito: o bloco Pessoal do SG&A é estrutura (não deveria
 * crescer com a venda) e a equipe operacional é custo de servir (cresce). Uma
 * empresa pode estar ficando mais produtiva na estrutura e menos na operação —
 * a linha somada esconderia isso.
 *
 * CAI = mais produtivo. É custo sobre receita, não o contrário.
 */
export function pessoalSobreReceita(leitor: Leitor, meses: string[]): PontoPessoal[] {
  return meses.map((mes) => {
    const receita = leitor.receita(RL, mes);
    const estrutura = leitor.custo(PESSOAL_SGA, mes);
    const operacao = leitor.custoDe(PESSOAL_OPERACAO, mes);
    const total = estrutura == null && operacao == null ? null : (estrutura ?? 0) + (operacao ?? 0);
    const pct = (v: number | null) =>
      v == null || !receita || receita === 0 ? null : (v / receita) * 100;
    return {
      mes,
      rotulo: rotuloMes(mes),
      receita,
      estrutura,
      total,
      estruturaPct: pct(estrutura),
      totalPct: pct(total),
    };
  });
}

/* ------------------------------------------------------------------ *
 *  3. ARR — a receita recorrente do mês anualizada
 * ------------------------------------------------------------------ */

export type PontoArr = {
  mes: string;
  rotulo: string;
  mrr: number | null;
  arr: number | null;
  arrBp: number | null;
  /** variação vs. o mesmo mês do ano anterior */
  yoy: number | null;
};

/**
 * ARR = receita recorrente do mês × 12.
 *
 * É o ARR FATURADO: sai da linha "Receita Recorrente" da DRE (assinaturas +
 * enterprise), regime de competência. Não é o mesmo número da tela
 * /assinaturas, que lê a base contratada no Asaas — faturamento atrasado ou
 * adiantado separa os dois, e é justamente por isso que os dois existem.
 */
export function serieArr(
  leitor: Leitor,
  meses: string[],
  bp?: (label: string, col: string) => number | null,
): PontoArr[] {
  const porMes = new Map(meses.map((m) => [m, leitor.receita(RECEITA_RECORRENTE, m)]));
  return meses.map((mes) => {
    const mrr = porMes.get(mes) ?? null;
    const anterior = mesmoMesAnoPassado(mes);
    const mrrAnterior = anterior ? porMes.get(anterior) ?? null : null;
    const mrrBp = bp ? bp(RECEITA_RECORRENTE, mes) : null;
    return {
      mes,
      rotulo: rotuloMes(mes),
      mrr,
      arr: mrr == null ? null : mrr * 12,
      arrBp: mrrBp == null ? null : Math.abs(mrrBp) * 12,
      yoy: mrr == null || mrrAnterior == null || mrrAnterior === 0 ? null : mrr / mrrAnterior - 1,
    };
  });
}

/* ------------------------------------------------------------------ *
 *  4. Regra dos 40
 * ------------------------------------------------------------------ */

export type PontoRegra40 = {
  mes: string;
  rotulo: string;
  /** crescimento da receita líquida vs. o mesmo mês do ano anterior, em % */
  crescimento: number | null;
  /** margem EBITDA do mês, em % */
  margem: number | null;
  /** crescimento + margem; ≥ 40 é o patamar saudável */
  regra: number | null;
};

/**
 * Regra dos 40: crescimento de receita (% a/a) + margem EBITDA (%).
 *
 * O atalho que investidor de SaaS usa para dizer se a empresa pode queimar
 * caixa em paz — cresce rápido OU dá lucro, e a soma tem que passar de 40.
 *
 * Crescimento é ano contra ano (mesmo mês do ano anterior), não mês contra
 * mês: sazonalidade de um mês curto viraria "queda de 12%" sem nada ter
 * acontecido. Meses sem o par do ano anterior ficam com `null` em vez de
 * inventar base.
 */
export function regraDos40(leitor: Leitor, meses: string[]): PontoRegra40[] {
  const receitas = new Map(leitor.colunas.map((m) => [m, leitor.receita(RL, m)]));
  return meses.map((mes) => {
    const receita = receitas.get(mes) ?? null;
    const anterior = mesmoMesAnoPassado(mes);
    const receitaAnterior = anterior ? receitas.get(anterior) ?? null : null;
    const ebitda = leitor.bruto(EBITDA, mes);
    const crescimento =
      receita == null || receitaAnterior == null || receitaAnterior === 0
        ? null
        : (receita / receitaAnterior - 1) * 100;
    const margem = ebitda == null || !receita || receita === 0 ? null : (ebitda / receita) * 100;
    return {
      mes,
      rotulo: rotuloMes(mes),
      crescimento,
      margem,
      regra: crescimento == null || margem == null ? null : crescimento + margem,
    };
  });
}

/* ------------------------------------------------------------------ *
 *  5. Runway
 * ------------------------------------------------------------------ */

export type Runway = {
  saldo: number;
  /** queima MENSAL média (positiva = está queimando) */
  queima: number;
  /** meses de vida no ritmo atual; null quando a empresa gera caixa */
  meses: number | null;
  /** quantos meses de fluxo livre entraram na média */
  base: number;
  gerandoCaixa: boolean;
};

/**
 * Fluxo livre por mês a partir do blob da DFC.
 *
 * O blob quase nunca traz a linha "Fluxo Livre" pronta: quem escreve é o
 * omie-sync, que mexe nas folhas e deixa os totais para trás — a página da DFC
 * recalcula na tela e nunca grava de volta. Ler a linha e desistir quando não
 * existe era o runway sumindo em silêncio.
 *
 * Mesma cascata da DFC, na mesma ordem: usa o total gravado quando ele existe e
 * cai para a soma das folhas quando não existe. Saídas vêm negativas no blob da
 * DFC (por isso somam, não subtraem).
 */
export function fluxoLivreDaDfc(
  rows: LinhaBlob[],
  columns: string[],
): Record<string, number | null> {
  const celulas = indexarCelulas(rows as Record<string, unknown>[], columns);
  const tem = (label: string) => celulas.has(label.toLowerCase());
  const val = (label: string, col: string): number | null =>
    celulas.get(label.toLowerCase())?.[col] ?? null;

  const somaFilhos = (node: Node, col: string): number | null => {
    if (!node.children?.length) return val(node.src ?? node.label, col);
    let total: number | null = null;
    for (const f of node.children) {
      const v = somaFilhos(f, col);
      if (v != null) total = (total ?? 0) + v;
    }
    return total ?? val(node.src ?? node.label, col);
  };

  const out: Record<string, number | null> = {};
  for (const col of columns) {
    const entradas = tem("Entradas") ? val("Entradas", col) : somaFilhos(DFC_SCHEMA[0], col);
    const saidas = tem("Saídas") ? val("Saídas", col)
      : tem("Saidas") ? val("Saidas", col)
      : somaFilhos(DFC_SCHEMA[1], col);
    const op = val("Fluxo de Caixa Operacional", col)
      ?? (entradas != null || saidas != null ? (entradas ?? 0) + (saidas ?? 0) : null);
    const livre = val("Fluxo Livre", col)
      ?? (op != null ? op + (somaFilhos(DFC_SCHEMA[3], col) ?? 0) + (somaFilhos(DFC_SCHEMA[4], col) ?? 0) : null);
    out[col] = livre;
  }
  return out;
}

/**
 * Cashburn por mês a partir do blob da DFC — a queima que o caixa sente.
 *
 * É o fluxo livre SEM a captação extraordinária. Julho/26 é o exemplo que
 * justifica a função existir: entrou um empréstimo de R$ 307,1 mil, o fluxo
 * livre fechou em −218,3 mil e a queima real foi de 525,4 mil. Medir ritmo de
 * queima pelo fluxo livre faz o mês do empréstimo parecer o melhor do semestre.
 *
 * A régua é a mesma do esquema (`cashburnDoMes`) e a ordem é a mesma da página
 * da DFC: o valor GRAVADO manda — é o que o omie-sync escreve e o que a grade
 * mostra —, e a fórmula só entra quando não há linha gravada.
 */
export function cashburnDaDfc(
  rows: LinhaBlob[],
  columns: string[],
): Record<string, number | null> {
  const celulas = indexarCelulas(rows as Record<string, unknown>[], columns);
  const val = (label: string, col: string): number | null =>
    celulas.get(label.toLowerCase())?.[col] ?? null;
  const livre = fluxoLivreDaDfc(rows, columns);

  const out: Record<string, number | null> = {};
  for (const col of columns) {
    out[col] = val(CASHBURN, col)
      ?? cashburnDoMes(livre[col] ?? null, val(NOVOS_EMPRESTIMOS, col));
  }
  return out;
}

/**
 * Quantos meses o caixa aguenta no ritmo atual.
 *
 * A queima vem da DFC (regime caixa, já líquido de investimento e
 * financiamento) e não da DRE — a pergunta é sobre dinheiro saindo da conta,
 * não sobre resultado por competência. Média dos últimos meses fechados porque
 * um mês com 13º ou uma antecipação sozinha daria um runway de mentira.
 *
 * A SÉRIE É ESCOLHA DE QUEM CHAMA, e a escolha importa: `cashburnDaDfc` ignora
 * a captação e responde "quanto tempo o caixa aguenta"; `fluxoLivreDaDfc`
 * conta o empréstimo como se fosse geração de caixa e estica o runway no mês
 * em que ele entra.
 *
 * Média positiva = está gerando caixa: runway não se aplica, e a tela diz isso
 * em vez de exibir um número absurdo.
 */
export function calcularRunway(
  saldo: number,
  fluxoLivrePorMes: (number | null)[],
  janela = 3,
): Runway {
  const validos = fluxoLivrePorMes.filter((v): v is number => v != null).slice(-janela);
  if (!validos.length) {
    return { saldo, queima: 0, meses: null, base: 0, gerandoCaixa: false };
  }
  const medio = validos.reduce((s, v) => s + v, 0) / validos.length;
  if (medio >= 0) {
    return { saldo, queima: 0, meses: null, base: validos.length, gerandoCaixa: true };
  }
  const queima = -medio;
  return {
    saldo,
    queima,
    meses: queima > 0 ? saldo / queima : null,
    base: validos.length,
    gerandoCaixa: false,
  };
}

/* ------------------------------------------------------------------ *
 *  6. Ponte do EBITDA
 * ------------------------------------------------------------------ */

export type DegrauPonte = {
  rubrica: string;
  /** contribuição para a variação do EBITDA (positiva = ajudou) */
  delta: number;
  /** posição na cascata: onde a barra começa */
  base: number;
};

export type Ponte = {
  de: number;
  para: number;
  degraus: DegrauPonte[];
  /** o que a decomposição não explicou (arredondamento ou linha fora do esquema) */
  residuo: number;
};

const BLOCOS_PONTE: { rubrica: string; label: string; receita?: boolean }[] = [
  { rubrica: RL, label: "Receita líquida", receita: true },
  { rubrica: CUSTOS_OP, label: "Custos operacionais" },
  { rubrica: PESSOAL_SGA, label: "Pessoal" },
  { rubrica: "Despesas Administrativas", label: "Despesas adm" },
  { rubrica: "Despesas Marketing & Vendas", label: "Marketing & vendas" },
];

/**
 * De onde veio a variação do EBITDA entre dois pontos.
 *
 * EBITDA = receita líquida − custos operacionais − SG&A, então a variação
 * fecha decompondo esses quatro blocos. Em despesa a contribuição é o
 * NEGATIVO da variação: gastar R$ 10 mil a mais tira R$ 10 mil do EBITDA.
 *
 * O resíduo é publicado em vez de distribuído — se a soma não fecha, é porque
 * a DRE ganhou linha fora do esquema, e esconder isso numa barra "outros" é o
 * jeito de nunca descobrir.
 */
export function ponteEbitda(
  valorDe: (label: string) => number | null,
  valorPara: (label: string) => number | null,
  custoDe: (label: string) => number | null,
  custoPara: (label: string) => number | null,
): Ponte {
  const de = valorDe(EBITDA) ?? 0;
  const para = valorPara(EBITDA) ?? 0;

  const degraus: DegrauPonte[] = [];
  let base = de;
  for (const b of BLOCOS_PONTE) {
    const antes = b.receita ? Math.abs(valorDe(b.rubrica) ?? 0) : custoDe(b.rubrica) ?? 0;
    const depois = b.receita ? Math.abs(valorPara(b.rubrica) ?? 0) : custoPara(b.rubrica) ?? 0;
    const delta = b.receita ? depois - antes : -(depois - antes);
    degraus.push({ rubrica: b.label, delta, base });
    base += delta;
  }

  return { de, para, degraus, residuo: para - base };
}