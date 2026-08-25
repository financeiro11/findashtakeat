/**
 * A regra contábil da fatura: o que vai para o Omie, o que não vai, e em qual mês.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * A fatura do cartão não é uma lista de despesas do mês — é uma lista de
 * COBRANÇAS do mês, e as duas coisas divergem justamente onde dói. Na fatura de
 * julho/26 (ciclo que fecha em 30/06), das 647 linhas:
 *
 *   • 164 são parcelas de 2 em diante, de compras de até um ano atrás. Já foram
 *     provisionadas quando a primeira parcela chegou. Lançar de novo duplica.
 *   • 345 são compras à vista no crédito: entram inteiras neste mês.
 *   •  45 são primeiras parcelas: entra a 1ª agora e as outras N−1 têm de nascer
 *     provisionadas para os meses à frente, senão o mês que vem chega vazio.
 *   •  As demais nem são despesa: o pagamento do boleto da fatura anterior e os
 *     estornos.
 *
 * O QUE SEPARA OS BALDES é o marcador `NN/MM` que o Sicoob mantém no MEMO, não a
 * data: a 7ª parcela de uma compra de dezembro chega datada de dezembro. Ler pela
 * data também funcionaria neste arquivo, mas quebraria em silêncio numa compra
 * feita nos últimos dias do ciclo — o número da parcela é a informação direta.
 *
 * Módulo puro: sem React, sem Supabase, sem relógio. Nada aqui fala com o Omie.
 */

import { somarMeses, type LinhaOfx } from "./ofx";

/* ------------------------------------------------------------------ */

export type Balde =
  /** Parcela ≥ 2: já provisionada num mês anterior. Não vai para o Omie. */
  | "ignorar"
  /** Compra à vista no crédito (inclui IOF e tarifas). Lança neste mês. */
  | "avista"
  /** 1ª de N: lança esta e provisiona as N−1 seguintes. */
  | "primeira"
  /** Pagamento da fatura e estornos: não é despesa. */
  | "nao-financeiro";

export type LinhaClassificada = LinhaOfx & {
  balde: Balde;
  /** Frase curta que a tela mostra na linha — o porquê de estar neste balde. */
  motivo: string;
};

export type Provisao = {
  /** Linha do OFX que originou esta provisão. */
  fitid: string;
  /**
   * Chave de idempotência mandada ao Omie em `codigo_lancamento_integracao`.
   * O Omie recusa integração repetida — é a última linha de defesa contra
   * clique duplo, reimportação do mesmo arquivo e reprocessamento.
   */
  integracao: string;
  estabelecimento: string;
  chave: string;
  /**
   * Data ORIGINAL da compra, repetida em todas as parcelas — é ela que o Omie
   * grava em `data_entrada` e devolve como `dDtRegistro`, o campo de onde a DRE
   * tira a competência. Ver `montarTitulo` em `_shared/cartao-envio.ts`.
   */
  dataCompra: string;
  /** 1º dia da fatura em que esta parcela cai. */
  competencia: string;
  vencimento: string;
  valor: number;
  parcela: { n: number; de: number } | null;
  /**
   * Verdadeiro nas parcelas 2..N: o OFX só informa o valor da primeira, e o
   * resto é repetição dela. Sicoob parcela em valores iguais, mas centavos de
   * arredondamento podem cair na última — a tela avisa em vez de fingir certeza.
   */
  valorEstimado: boolean;
  memo: string;
};

export type Separacao = {
  linhas: LinhaClassificada[];
  porBalde: Record<Balde, LinhaClassificada[]>;
  totais: Record<Balde, number>;
  /** Soma de tudo que é gasto na fatura (à vista + 1ªs parcelas + parcelas ≥2). */
  totalFatura: number;
  /** O que efetivamente vira título neste mês. */
  totalAProvisionar: number;
};

/* ------------------------------------------------------------------
 * Separação
 * ------------------------------------------------------------------ */

/** O pagamento da própria fatura — some do lado da despesa. */
const ehPagamentoDaFatura = (l: LinhaOfx) =>
  /PAGAMENTO[- ]?BOLETO|PAGTO\.?\s*(DE\s*)?FATURA|PAGAMENTO EFETUADO/i.test(l.memo);

export function classificar(l: LinhaOfx): { balde: Balde; motivo: string } {
  if (ehPagamentoDaFatura(l)) {
    return { balde: "nao-financeiro", motivo: "Pagamento da fatura anterior — não é despesa." };
  }
  // Crédito é devolução, estorno de tarifa ou desconto. Abate a fatura, não gera
  // título a pagar; se virar nota de crédito no Omie, é decisão de quem fecha.
  if (l.sinal === "credito") {
    return { balde: "nao-financeiro", motivo: "Crédito/estorno — abate a fatura, não provisiona." };
  }
  if (l.parcela && l.parcela.n > 1) {
    return {
      balde: "ignorar",
      motivo: `Parcela ${l.parcela.n}/${l.parcela.de} — provisionada quando a 1ª chegou.`,
    };
  }
  if (l.parcela) {
    return {
      balde: "primeira",
      motivo: `1ª de ${l.parcela.de} — gera ${l.parcela.de} títulos, um por mês.`,
    };
  }
  return {
    balde: "avista",
    motivo: l.tarifa ? "Tarifa do cartão — lança no mês." : "Crédito à vista — lança no mês.",
  };
}

const BALDES: Balde[] = ["avista", "primeira", "ignorar", "nao-financeiro"];

export function separar(linhas: LinhaOfx[]): Separacao {
  const classificadas = linhas.map((l) => ({ ...l, ...classificar(l) }));

  const porBalde = Object.fromEntries(BALDES.map((b) => [b, [] as LinhaClassificada[]])) as Separacao["porBalde"];
  const totais = Object.fromEntries(BALDES.map((b) => [b, 0])) as Separacao["totais"];

  for (const l of classificadas) {
    porBalde[l.balde].push(l);
    totais[l.balde] += l.valor;
  }

  return {
    linhas: classificadas,
    porBalde,
    totais,
    totalFatura: totais.avista + totais.primeira + totais.ignorar,
    totalAProvisionar: totais.avista + totais.primeira,
  };
}

/* ------------------------------------------------------------------
 * Agrupamento por lojista
 * ------------------------------------------------------------------ */

export type Grupo = {
  chave: string;
  /** Nome mais frequente entre as linhas — é o que a tela mostra. */
  estabelecimento: string;
  linhas: LinhaClassificada[];
  total: number;
  /** Quantos títulos este grupo vai gerar (parcelado multiplica). */
  titulos: number;
};

/**
 * Junta as linhas por lojista para a CONFERÊNCIA — e só para ela.
 *
 * No Omie cada compra vira um título seu (1:1 com a fatura, como pedido), mas
 * ninguém confere 426 linhas escolhendo categoria uma a uma. Categoria é
 * decisão por FORNECEDOR: as 34 corridas de Uber da fatura de julho são uma
 * escolha, não trinta e quatro. Depois de conferido, `expandir` volta a abrir
 * linha a linha.
 */
export function agrupar(linhas: LinhaClassificada[]): Grupo[] {
  const mapa = new Map<string, Grupo & { nomes: Map<string, number> }>();

  for (const l of linhas) {
    const g = mapa.get(l.chave) ?? {
      chave: l.chave, estabelecimento: l.estabelecimento,
      linhas: [], total: 0, titulos: 0, nomes: new Map<string, number>(),
    };
    g.linhas.push(l);
    g.total += l.valor;
    g.titulos += l.parcela?.de ?? 1;
    g.nomes.set(l.estabelecimento, (g.nomes.get(l.estabelecimento) ?? 0) + 1);
    mapa.set(l.chave, g);
  }

  return [...mapa.values()]
    .map(({ nomes, ...g }) => ({
      ...g,
      estabelecimento: [...nomes.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0],
    }))
    .sort((a, b) => b.total - a.total);
}

/* ------------------------------------------------------------------
 * Vencimento
 * ------------------------------------------------------------------ */

const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

const emMeses = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/**
 * Vencimento da fatura de `competencia`, projetado a partir do vencimento da
 * fatura em mãos.
 *
 * O OFX NÃO traz o vencimento (o `LEDGERBAL` é saldo devedor acumulado, não o
 * total do ciclo — conferido: −334.427,93 contra 337.387,49 de gastos em
 * julho/26). Então o vencimento da fatura atual entra de fora — do PDF ou
 * digitado — e as parcelas seguintes herdam dele o dia E a distância até a
 * competência. Guardar a distância importa: se a fatura de julho vence em
 * 10/07, o deslocamento é zero; se vencesse em 05/08, toda parcela venceria um
 * mês depois da sua competência, e assumir "mesmo mês" adiantaria tudo.
 *
 * O dia é limitado ao tamanho do mês: vencimento 31 vira 28/29 em fevereiro.
 */
export function vencimentoDe(
  competencia: string,
  vencimentoBase: string,
  competenciaBase: string,
): string {
  const alvo = somarMeses(competencia, emMeses(vencimentoBase) - emMeses(competenciaBase));
  const [ano, mes] = alvo.split("-").map(Number);
  const dia = Math.min(Number(vencimentoBase.slice(8, 10)), ultimoDia(ano, mes));
  return `${alvo.slice(0, 8)}${String(dia).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------
 * Expansão das parcelas
 * ------------------------------------------------------------------ */

/**
 * Transforma as linhas que vão para o Omie nos títulos que serão criados.
 *
 * Uma compra à vista vira um título. Uma 1ª parcela de N vira N títulos, um por
 * mês, a partir da fatura atual — é literalmente o "provisionar para frente" que
 * hoje se faz à mão.
 *
 * A COMPETÊNCIA de cada parcela é o mês da FATURA em que ela cai, e não o mês da
 * compra. Ela serve para duas coisas — projetar o vencimento e dizer em que
 * fatura a parcela aparece —, e NÃO é a competência contábil.
 *
 * A contábil é outra e mora no Omie: `data_entrada` (que ele devolve como
 * `dDtRegistro`) é a data da COMPRA, igual em todas as parcelas, então uma
 * compra em 12× reconhece o valor cheio na DRE do mês da compra. Conferido nos
 * títulos reais em 24/08/2026 — os 47 lançamentos registrados em 31/07/2026 têm
 * vencimento espalhado de 11/08/2026 a 11/01/2027. Quem monta isso é
 * `montarTitulo` em `_shared/cartao-envio.ts`; aqui não se decide contabilidade.
 *
 * `vencimentoFatura` é o vencimento da fatura ATUAL (a do arquivo); as parcelas
 * seguintes mantêm o mesmo dia nos meses à frente.
 */
export function expandir(
  linhas: LinhaClassificada[],
  competenciaFatura: string,
  vencimentoFatura: string,
): Provisao[] {
  const out: Provisao[] = [];

  for (const l of linhas) {
    if (l.balde !== "avista" && l.balde !== "primeira") continue;

    const total = l.parcela?.de ?? 1;
    for (let k = 1; k <= total; k++) {
      const competencia = somarMeses(competenciaFatura, k - 1);
      out.push({
        fitid: l.fitid,
        // Sufixo por parcela: a mesma compra gera N títulos, e cada um precisa
        // da própria chave para o Omie poder recusar só o repetido.
        integracao: `CARTAO-${l.fitid}-${String(k).padStart(2, "0")}`,
        estabelecimento: l.estabelecimento,
        chave: l.chave,
        dataCompra: l.data,
        competencia,
        vencimento: vencimentoDe(competencia, vencimentoFatura, competenciaFatura),
        valor: l.valor,
        parcela: l.parcela ? { n: k, de: total } : null,
        valorEstimado: k > 1,
        memo: l.memo,
      });
    }
  }

  return out;
}
