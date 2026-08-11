/* ============================================================================
 * "De que essa célula é feita?" — para as linhas de RESULTADO da DRE e da DFC.
 *
 * A célula-folha já era auditável: clicar abre os lançamentos do Omie. As linhas
 * que ninguém conseguia conferir eram justamente as que se lê primeiro — Receita
 * Líquida, Margem de contribuição, EBITDA, Lucro Líquido e as margens em % na
 * DRE; Fluxo de Caixa Operacional e Fluxo Livre na DFC.
 *
 * E elas não são somadas na tela: a demonstração lê o número GRAVADO no blob.
 * Quem grava (o tracker, o omie-sync, o valor manual) pode deixar o total
 * dessincronizado das rubricas acima dele, e a tela não tinha como acusar —
 * mostrava um total que não era a soma de nada visível. Foi assim que a Margem
 * de contribuição de Jul-26 apareceu R$ 12,7 mil abaixo das suas próprias
 * parcelas.
 *
 * Este módulo é o contraditório: para cada célula de resultado devolve AS
 * PARCELAS, o que elas somam e o que está gravado — e diz quando os dois não
 * batem. Puro de propósito (recebe as leituras por parâmetro) para poder ser
 * testado com os números reais da empresa.
 *
 * Note que ele NÃO corrige o número: o valor mostrado continua sendo o gravado,
 * porque é ele que a diretoria assina e que a IA lê. O que ele faz é impedir que
 * uma divergência passe calada.
 * ========================================================================== */

import { CASCATA, DRE_SCHEMA, DFC_SCHEMA, type Node } from "./demonstracoes-schema";

export type TipoDemonstracao = "dre" | "dfc";

/* ---------------------------------------------------------------------------
 * A cascata — o que cada linha de TOTAL soma.
 *
 * É a MESMA tabela que `_shared/derivadas.ts` usa para ESCREVER esses totais no
 * banco. Tem que ser a mesma: este painel existe para conferir o que foi
 * gravado, e conferir com uma conta diferente da que gravou não confere nada.
 * Por isso ela mora no esquema, e não aqui.
 *
 * "Cashburn" fica de fora de propósito: ele não soma parcelas, é o Fluxo Livre
 * MENOS a captação extraordinária. Subtração não cabe num modelo que só soma, e
 * fingir que cabe mostraria uma conta que não é a dele.
 * ------------------------------------------------------------------------- */
export const TOTAIS_DRE = CASCATA.dre;
export const TOTAIS_DFC = CASCATA.dfc;

export type Parcela = {
  rotulo: string;
  valor: number | null;
  /** tem composição própria — a UI deixa descer mais um nível */
  abrivel: boolean;
};

export type Composicao = {
  rotulo: string;
  /** como a linha se forma: soma das rubricas de dentro, cascata do demonstrativo, ou divisão */
  tipo: "filhos" | "cascata" | "percentual";
  parcelas: Parcela[];
  /** o que as parcelas dão (soma; no percentual, a divisão) */
  calculado: number | null;
  /** o que está gravado no blob para esta linha — null quando a linha não existe lá */
  guardado: number | null;
  /** guardado − calculado; null quando falta um dos dois */
  diferenca: number | null;
  /** margem de arredondamento aceita (o tracker arredonda cada linha na unidade) */
  tolerancia: number;
  divergente: boolean;
  /** no percentual, a linha exibida É o cálculo — não há número gravado a conferir */
  numerador?: Parcela;
  denominador?: Parcela;
};

/**
 * As leituras de que a composição precisa, sempre num MÊS já fixado pelo chamador.
 *
 * `naTela` é o número que a grade mostra para a rubrica — já com a regra "linha
 * com filhos é a soma dos filhos". `guardado` é o número cru do blob, sem somar
 * nada: é a diferença entre os dois que revela o total que ficou para trás.
 *
 * O `tipo` viaja junto com as leituras porque é delas que ele é propriedade: um
 * leitor da DFC não sabe responder "Receita Líquida". Assim `composicaoDaCelula`
 * nunca pode ser chamada com o esquema de um demonstrativo e os números do outro.
 */
export type LeitorDaCelula = {
  tipo: TipoDemonstracao;
  naTela: (rotulo: string) => number | null;
  guardado: (rotulo: string) => number | null;
};

const chave = (s: string) => (s ?? "").trim().toLowerCase();

function indexarNos(nodes: Node[], acc = new Map<string, Node>()): Map<string, Node> {
  for (const n of nodes) {
    if (!acc.has(chave(n.label))) acc.set(chave(n.label), n);
    if (n.children?.length) indexarNos(n.children, acc);
  }
  return acc;
}

const NOS: Record<TipoDemonstracao, Map<string, Node>> = {
  dre: indexarNos(DRE_SCHEMA),
  dfc: indexarNos(DFC_SCHEMA),
};
const TOTAIS: Record<TipoDemonstracao, Record<string, string[]>> = {
  dre: TOTAIS_DRE,
  dfc: TOTAIS_DFC,
};

export const noDaRubrica = (rotulo: string, tipo: TipoDemonstracao): Node | undefined =>
  NOS[tipo].get(chave(rotulo));

/** A rubrica é uma célula de resultado (tem o que explicar) ou é folha de lançamento? */
export function temComposicao(rotulo: string, tipo: TipoDemonstracao): boolean {
  const no = NOS[tipo].get(chave(rotulo));
  if (!no) return false;
  if (no.kind === "percent" && no.pctOf) return true;
  if (no.children?.length) return true;
  return !!TOTAIS[tipo][no.label];
}

const soma = (vs: (number | null)[]): number | null =>
  vs.some((v) => v != null) ? vs.reduce<number>((s, v) => s + (v ?? 0), 0) : null;

const parcela = (rotulo: string, ler: LeitorDaCelula): Parcela => ({
  rotulo,
  valor: ler.naTela(rotulo),
  abrivel: temComposicao(rotulo, ler.tipo),
});

/**
 * Monta a conferência da célula. Devolve `null` para folha — folha não é
 * resultado, é lançamento, e o drill-down dela já existe.
 *
 * A tolerância é o número de parcelas, não um percentual: o tracker arredonda
 * cada linha na unidade, então uma soma de quatro parcelas pode fechar com até
 * R$ 4 de diferença sem que nada esteja errado. Um percentual do valor deixaria
 * passar centenas de reais nas linhas grandes — justamente onde o erro dói.
 */
export function composicaoDaCelula(rotulo: string, ler: LeitorDaCelula): Composicao | null {
  const no = NOS[ler.tipo].get(chave(rotulo));
  if (!no) return null;

  if (no.kind === "percent" && no.pctOf) {
    // Sem `src`, cai no rótulo sem o "%" — nunca no próprio, que faria a leitura
    // do numerador chamar esta mesma linha e estourar a pilha.
    const numerador = parcela(no.src ?? no.label.replace(/^%\s*/, ""), ler);
    const denominador = parcela(no.pctOf, ler);
    const calculado =
      numerador.valor != null && denominador.valor ? numerador.valor / denominador.valor : null;
    /* A linha de % também existe no blob — o tracker grava "73,18". Está em
       PONTOS percentuais, então vira fração antes de comparar com a divisão. */
    const cru = ler.guardado(no.label);
    const guardado = cru == null ? null : cru / 100;
    const diferenca = guardado != null && calculado != null ? guardado - calculado : null;
    const tolerancia = 0.0015; // 0,15 p.p. — o tracker grava a margem com 2 casas
    return {
      rotulo: no.label,
      tipo: "percentual",
      parcelas: [numerador, denominador],
      numerador,
      denominador,
      calculado,
      guardado,
      diferenca,
      tolerancia,
      divergente: diferenca != null && Math.abs(diferenca) > tolerancia,
    };
  }

  const rotulos = no.children?.length
    ? no.children.map((c) => c.label)
    : TOTAIS[ler.tipo][no.label];
  if (!rotulos?.length) return null;

  const parcelas = rotulos.map((r) => parcela(r, ler));
  const calculado = soma(parcelas.map((p) => p.valor));
  const guardado = ler.guardado(no.label);
  const diferenca = guardado != null && calculado != null ? guardado - calculado : null;
  const tolerancia = Math.max(1, parcelas.length);

  return {
    rotulo: no.label,
    tipo: no.children?.length ? "filhos" : "cascata",
    parcelas,
    calculado,
    guardado,
    diferenca,
    tolerancia,
    divergente: diferenca != null && Math.abs(diferenca) > tolerancia,
  };
}

/**
 * Uma frase sobre a conferência, para o `title` da célula e para o topo do painel.
 * Recebe o formatador de moeda de quem chama — a DRE e a DFC formatam diferente.
 */
export function resumoComposicao(c: Composicao, moeda: (n: number) => string): string {
  if (c.tipo === "percentual") {
    const n = c.numerador?.rotulo ?? "";
    const d = c.denominador?.rotulo ?? "";
    return `${n} ÷ ${d}`;
  }
  const conta = c.parcelas.map((p) => p.rotulo).join(" + ");
  if (!c.divergente) return `= ${conta}`;
  return `= ${conta} · gravado ${moeda(c.guardado ?? 0)}, parcelas somam ${moeda(c.calculado ?? 0)}`;
}
