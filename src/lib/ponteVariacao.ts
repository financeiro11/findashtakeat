/* ============================================================================
 * A ponte da célula: por que esta linha mudou do mês passado para este.
 *
 * O drill-down já dizia QUEM está na célula (a lista), DE QUE ela é feita (a
 * composição por categoria) e QUEM mexeu (o chip por fornecedor). Faltava a
 * única pergunta que se faz no fechamento e que exige os dois meses ao mesmo
 * tempo: "a rubrica subiu R$ 41 mil — QUAIS gastos entraram, QUAIS aumentaram e
 * o que foi economizado?".
 *
 * Este módulo monta essa decomposição a partir das DUAS listas de lançamentos —
 * a do mês em foco e a do mês anterior, as mesmas que o painel confere contra o
 * ERP. Quatro decisões desenham o resultado:
 *
 * 1. A CONTA TEM DE FECHAR NO CENTAVO. `delta` é sempre `atual − anterior` COM
 *    SINAL, e a soma dos deltas de todos os fornecedores é, por construção,
 *    exatamente a variação da célula. É o que separa esta ponte de um "top 5 do
 *    que mudou": nada fica de fora, nem o fornecedor de R$ 12. Quem desenha a
 *    tela pode afirmar "isto explica a variação inteira" sem ressalva.
 *
 * 2. O SINAL DECIDE O GRUPO, O MÓDULO DECIDE O RÓTULO. Despesa é negativa:
 *    -241,27 → -723,81 é um delta de -482,54 (piorou o resultado) e um gasto
 *    482,54 MAIOR. Agrupar pelo sinal é o que faz a conta fechar em receita e em
 *    despesa com a mesma regra (`delta > 0` = melhorou); o rótulo "+200%" sai do
 *    módulo, que é como se lê "gastou o dobro". Misturar os dois é o jeito
 *    clássico de o comparativo dizer que a rubrica que economizou "subiu".
 *
 * 3. QUEM É O FORNECEDOR É DE QUEM CHAMA. No cartão a contraparte do título é
 *    sempre o balde da fatura ("Lancamento Fatura Cartao") e o lojista está na
 *    OBSERVAÇÃO, que a tela lê de `omie_titulo_texto`. Agrupar por
 *    `contraparte` jogaria a fatura inteira num nome só; por isso o nome entra
 *    por `nomeDe`, a MESMA função que a lista usa para escrever a linha. Uma
 *    regra só, um nome só nos dois lugares.
 *
 * 4. "ENTROU" AQUI É SÓ SOBRE O MÊS ANTERIOR. Este módulo enxerga dois meses:
 *    dizer "novo" (que é uma afirmação sobre a janela inteira) é papel do
 *    comparativo de 12 meses, que já sabe distinguir novo de trimestral. Aqui a
 *    peça se diz "entrou", e quem desenha a tela refina para "voltou · Abr 26"
 *    quando o comparativo souber mais.
 * ========================================================================== */

import { normalize } from "@/lib/normalize";

/** O que a ponte precisa de um lançamento — subconjunto do que a RPC devolve. */
export type LancamentoDaPonte = {
  data: string | null;
  titulo: string | null;
  documento: string | null;
  contraparte: string | null;
  cnpj_cpf: string | null;
  categoria_codigo: string | null;
  categoria_descricao: string | null;
  status: string | null;
  valor: number | null;
  cod_titulo: string | null;
};

/** O que aconteceu com este fornecedor entre os dois meses. */
export type Movimento = "entrou" | "saiu" | "aumentou" | "reduziu" | "igual";

export type PecaDaPonte = {
  /** Chave de agrupamento (nome normalizado) — não é para exibir. */
  chave: string;
  nome: string;
  movimento: Movimento;
  /** Total no mês em foco, com o sinal do lançamento (0 quando saiu). */
  atual: number;
  /** Total no mês anterior (0 quando entrou). */
  anterior: number;
  /** `atual − anterior`. É o que soma para dar a variação da célula. */
  delta: number;
  /** `|atual| − |anterior|`: quanto dinheiro a mais (ou a menos) passou por aqui. */
  deltaModulo: number;
  /** `deltaModulo ÷ |anterior|`. null quando não havia base — não é 0%, é "não dá". */
  pct: number | null;
  /** O delta melhorou o resultado? Vale para receita e despesa. Decide a cor. */
  favoravel: boolean;
  /** Os lançamentos do mês em foco, na ordem em que vieram da RPC (data). */
  lancamentos: LancamentoDaPonte[];
  /** Os do mês anterior — é o que responde "1 parcela virou 3". */
  anteriores: LancamentoDaPonte[];
};

export type Ponte = {
  mes: string;
  mesAnterior: string;
  soma: number;
  somaAnterior: number;
  /** `soma − somaAnterior`. */
  delta: number;
  pct: number | null;
  /** A rubrica é de despesa? Só muda as palavras ("gastou" × "faturou"). */
  despesa: boolean;
  /** Quem puxou o resultado para baixo (delta < 0), do que mais pesou ao que menos. */
  piora: PecaDaPonte[];
  /** Quem puxou para cima (delta > 0), na mesma ordem. */
  melhora: PecaDaPonte[];
  /** Mesmo valor nos dois meses: não explica nada, mas some da conta se sumir da tela. */
  iguais: PecaDaPonte[];
  /** Soma dos deltas de `piora` (negativa) e de `melhora` (positiva). */
  totalPiora: number;
  totalMelhora: number;
  /** Fornecedores com lançamento no mês em foco (o que a célula tem hoje). */
  fornecedores: number;
  fornecedoresAnteriores: number;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Diferença abaixo de um centavo é o mesmo valor — não é "aumentou 0,00". */
const CENTAVO = 0.005;

/** O nome que a tela mostra vira chave; sem nome, o lançamento é seu próprio grupo. */
const chaveDe = (nome: string): string => normalize(nome) || nome.trim() || "SEM CONTRAPARTE";

/**
 * Monta a ponte entre dois meses de lançamentos da MESMA célula.
 *
 * `nomeDe` resolve o nome exibível de um lançamento — no cartão, o lojista lido
 * da observação. Ela é aplicada aos dois meses, senão o mesmo gasto apareceria
 * com um nome em junho e outro em julho, e a ponte inventaria uma entrada e uma
 * saída no lugar de uma linha que não se mexeu.
 */
export function montarPonte(
  atuais: LancamentoDaPonte[],
  anteriores: LancamentoDaPonte[],
  opcoes: { mes: string; mesAnterior: string; nomeDe: (l: LancamentoDaPonte) => string },
): Ponte {
  const { mes, mesAnterior, nomeDe } = opcoes;

  type Acumulado = {
    nome: string;
    atual: number; anterior: number;
    lancamentos: LancamentoDaPonte[];
    anterioresL: LancamentoDaPonte[];
  };
  const grupos = new Map<string, Acumulado>();

  const pegar = (l: LancamentoDaPonte): Acumulado => {
    const nome = (nomeDe(l) || "").trim() || "Sem contraparte";
    const chave = chaveDe(nome);
    let g = grupos.get(chave);
    if (!g) { g = { nome, atual: 0, anterior: 0, lancamentos: [], anterioresL: [] }; grupos.set(chave, g); }
    return g;
  };

  for (const l of atuais) {
    const g = pegar(l);
    g.atual += num(l.valor);
    g.lancamentos.push(l);
  }
  for (const l of anteriores) {
    const g = pegar(l);
    g.anterior += num(l.valor);
    g.anterioresL.push(l);
  }

  const pecas: PecaDaPonte[] = [];
  for (const [chave, g] of grupos) {
    const delta = g.atual - g.anterior;
    const deltaModulo = Math.abs(g.atual) - Math.abs(g.anterior);

    /* "Entrou" e "saiu" olham a LISTA, não o valor: um fornecedor pode ter
       lançamentos que se anulam (compra e estorno no mesmo mês) e somar zero
       sem ter sumido. Dizer "saiu" ali seria mandar procurar um gasto que está
       na tela, logo abaixo. */
    const temAgora = g.lancamentos.length > 0;
    const temAntes = g.anterioresL.length > 0;

    const movimento: Movimento =
      !temAntes ? "entrou"
      : !temAgora ? "saiu"
      : Math.abs(delta) < CENTAVO ? "igual"
      : deltaModulo > 0 ? "aumentou" : "reduziu";

    pecas.push({
      chave,
      nome: g.nome,
      movimento,
      atual: g.atual,
      anterior: g.anterior,
      delta,
      deltaModulo,
      pct: Math.abs(g.anterior) > CENTAVO ? deltaModulo / Math.abs(g.anterior) : null,
      favoravel: delta > 0,
      lancamentos: g.lancamentos,
      anteriores: g.anterioresL,
    });
  }

  // O que mais pesou primeiro: é a ordem em que se lê "por que a linha mudou".
  const porPeso = (a: PecaDaPonte, b: PecaDaPonte) => Math.abs(b.delta) - Math.abs(a.delta);
  const piora = pecas.filter((p) => p.delta < -CENTAVO).sort(porPeso);
  const melhora = pecas.filter((p) => p.delta > CENTAVO).sort(porPeso);
  const iguais = pecas.filter((p) => Math.abs(p.delta) <= CENTAVO).sort(porPeso);

  const soma = atuais.reduce((s, l) => s + num(l.valor), 0);
  const somaAnterior = anteriores.reduce((s, l) => s + num(l.valor), 0);
  const delta = soma - somaAnterior;

  return {
    mes,
    mesAnterior,
    soma,
    somaAnterior,
    delta,
    pct: Math.abs(somaAnterior) > CENTAVO ? (Math.abs(soma) - Math.abs(somaAnterior)) / Math.abs(somaAnterior) : null,
    // Os dois meses juntos, e não só o mês em foco: uma rubrica de despesa que
    // ficou vazia neste mês continua sendo de despesa.
    despesa: soma + somaAnterior <= 0,
    piora,
    melhora,
    iguais,
    totalPiora: piora.reduce((s, p) => s + p.delta, 0),
    totalMelhora: melhora.reduce((s, p) => s + p.delta, 0),
    fornecedores: pecas.filter((p) => p.lancamentos.length > 0).length,
    fornecedoresAnteriores: pecas.filter((p) => p.anteriores.length > 0).length,
  };
}

/**
 * As palavras do grupo. "Gastou a mais" numa linha de receita seria errado — e
 * numa DRE de verdade a mesma tela abre as duas.
 */
export function rotuloGrupo(p: Ponte, favoravel: boolean): string {
  if (p.despesa) return favoravel ? "Economizou" : "Gastou a mais";
  return favoravel ? "Entrou a mais" : "Entrou a menos";
}

/** O mesmo rótulo contando gente: "12 gastaram a mais". */
export function rotuloContagem(p: Ponte, favoravel: boolean): string {
  if (p.despesa) return favoravel ? "economizaram" : "gastaram a mais";
  return favoravel ? "renderam mais" : "renderam menos";
}

/**
 * A frase do cabeçalho, sem valores — quem formata dinheiro é a tela.
 * Devolve null quando a variação é zero: não há o que explicar.
 */
export function resumoPonte(p: Ponte): string | null {
  if (Math.abs(p.delta) <= CENTAVO) return null;
  const piorou = p.delta < 0;
  if (p.despesa) return piorou ? "gastou a mais" : "gastou a menos";
  return piorou ? "entrou menos" : "entrou mais";
}

/** A frase inteira de uma peça, para o hover — é ela que impede o chip de mentir. */
export function explicarPeca(
  p: PecaDaPonte, ponte: Ponte, moeda: (n: number) => string, mesCurto: (m: string) => string,
): string {
  const atual = mesCurto(ponte.mes);
  const anterior = mesCurto(ponte.mesAnterior);
  const lanc = (n: number) => `${n} ${n === 1 ? "lançamento" : "lançamentos"}`;

  if (p.movimento === "entrou") {
    return `${p.nome} não tem lançamento nesta rubrica em ${anterior}. `
      + `${atual}: ${moeda(p.atual)} em ${lanc(p.lancamentos.length)}.`;
  }
  if (p.movimento === "saiu") {
    return `${p.nome} teve ${moeda(p.anterior)} em ${anterior} (${lanc(p.anteriores.length)}) `
      + `e nenhum lançamento em ${atual}.`;
  }

  const base = `${p.nome}: ${anterior} ${moeda(p.anterior)} (${lanc(p.anteriores.length)}) → `
    + `${atual} ${moeda(p.atual)} (${lanc(p.lancamentos.length)})`;
  if (p.movimento === "igual") return `${base} — mesmo valor.`;
  const pct = p.pct == null ? "" : ` (${Math.round(Math.abs(p.pct) * 100)}%)`;
  const verbo = p.movimento === "aumentou" ? "passou" : "deixou de passar";
  return `${base} — ${verbo} ${moeda(Math.abs(p.deltaModulo))}${pct}.`;
}