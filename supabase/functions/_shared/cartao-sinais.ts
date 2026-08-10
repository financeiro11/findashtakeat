/* ============================================================================
 * O detector de sinais da fatura do cartão.
 *
 * O QUE ENTRA: a série de cada estabelecimento, mês a mês, a história inteira
 * (`cartao_series()`). O QUE SAI: os candidatos a recomendação de UMA fatura, com
 * os números já formatados e os fatos já escritos.
 *
 * A IA NÃO ENTRA AQUI. Quem decide o que merece recomendação são os limiares
 * abaixo, e eles são fixos de propósito: se o critério variasse de mês para mês,
 * "não apareceu nada nesta fatura" não significaria nada.
 *
 * Os limiares foram calibrados contra as 8 faturas de 2026 (jan–ago), e o número
 * de achados de cada regra está anotado ao lado dela. Duas variantes que pareciam
 * boas foram descartadas por ruído, e ficam registradas para não voltarem:
 *
 *   ✗ "valores idênticos repetidos na mesma fatura" — GOOGLE ADS 2.000 × 8 e
 *     ANTHROPIC 550 × 12 são recarga de crédito, o comportamento NORMAL desses
 *     fornecedores. A regra achava 24 "duplicidades" em 8 faturas, nenhuma real.
 *   ✗ "dobrou o total" sem olhar a contagem — UBER com 96 corridas custando 2×
 *     não é cobrança dobrada, é mês de mais viagem. Daí o teto de lançamentos em
 *     `dobrada`: cobrança dobrada é de fornecedor de mensalidade, não de fluxo.
 *
 * Módulo puro (sem Deno, sem Supabase) para dar para conferir a regra lendo — e
 * para o modo `preview` da função poder devolver os candidatos sem gastar IA.
 * ========================================================================== */

/** Uma linha de `cartao_series()`: fornecedor × fatura. */
export type PontoSerie = {
  e: string;            // estabelecimento
  m: string;            // competência da fatura, 'YYYY-MM-DD'
  v: number;            // total gasto
  n: number;            // nº de lançamentos
  c?: string | null;    // categoria dominante
  d?: string | null;    // descrição crua do OFX do maior lançamento
  ci?: string | null;   // cidade do maior lançamento
};

export type TipoSinal = "pico" | "ausente" | "dobrada";
export type Nivel = "critico" | "atencao" | "info";

export type Candidato = {
  estabelecimento: string;
  sinal: TipoSinal;
  nivel: Nivel;
  titulo: string;
  valor: number;
  valorReferencia: number;
  razao: number | null;
  lancamentos: number;
  categoria: string | null;
  /** Descrição crua do OFX — é com ela que se distingue um SaaS de um mercado. */
  descricaoOfx: string | null;
  cidade: string | null;
  serie: { m: string; v: number; n: number }[];
  /** As frases determinísticas. A IA redige EM CIMA delas, não no lugar delas. */
  fatos: string[];
  /** Ordena o painel: quanto de dinheiro está em jogo no sinal. */
  peso: number;
};

/* ------------------------------------------------------------------
 * Limiares
 * ------------------------------------------------------------------ */

/** `pico`: quantas vezes a mediana do próprio fornecedor. 3× deixa passar IOF
 *  (2,8×) e NINECOMERCIO (2,1×), que são variação de rotina. */
const PICO_RAZAO = 3;
/**
 * `pico`: e quanto acima do RECORDE anterior.
 *
 * Sem isto, fornecedor que sobe de patamar dispara duas vezes: a mediana leva
 * meses para acompanhar o salto, então o segundo mês — com o valor PARADO —
 * ainda aparece como "13× acima do normal". Aconteceu com GOOGLE (outros), que
 * fez 15.081 em jul/26 e 15.099 em ago/26: bater o recorde por R$ 18 e virar
 * alerta de pico é o tipo de aviso que ensina a ignorar o painel.
 *
 * 1,2 foi calibrado nas 8 faturas: derruba os 2 casos de patamar (GOOGLE ago/26 a
 * 1,00× do recorde e TAXA DE EMBARQUE mai/26 a 1,08×) e não derruba nenhum pico
 * de verdade — o menor deles é o 99 em ago/26, a 1,75× do recorde.
 */
const PICO_SOBRE_RECORDE = 1.2;
/** `pico`/`dobrada`: excesso mínimo em R$ sobre a mediana. Sem ele, a padaria que
 *  saiu de R$ 144 para R$ 771 (5,4×) virava recomendação. */
const EXCESSO_MIN = 1_000;
/** `pico`: meses com gasto antes desta fatura. Com um só, "mediana" é aquele mês. */
const PICO_MESES_MIN = 2;

/** `ausente`: em quantas faturas anteriores o fornecedor apareceu. */
const AUSENTE_MESES_MIN = 4;
/** `ausente`: e nas 3 imediatamente anteriores, TODAS — é o que separa
 *  mensalidade de fornecedor que aparece de vez em quando. */
const AUSENTE_JANELA = 3;
/** `ausente`: mediana mínima. Abaixo disso a ausência não paga o incômodo. */
const AUSENTE_VALOR_MIN = 300;

/** `dobrada`: faixa em torno de 2× — fora dela é outra história (pico ou rotina). */
const DOBRADA_MIN = 1.75;
const DOBRADA_MAX = 2.35;
/** `dobrada`: teto de lançamentos. Cobrança dobrada é de mensalidade; fornecedor
 *  com dezenas de lançamentos que dobra é volume. */
const DOBRADA_LANC_MAX = 4;
const DOBRADA_MESES_MIN = 3;

/** Teto de recomendações por fatura. Painel que não cabe na tela não é lido — e
 *  cada item é uma ida à IA. Ordena por dinheiro em jogo, então o que cai é o
 *  menos relevante. */
export const MAX_POR_FATURA = 8;

/* ------------------------------------------------------------------ */

const nf = (casas: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** "R$ 15.878,40" — o número cheio. A IA copia estas strings; não refaz conta. */
export function brl(n: number): string {
  return Number(n).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** "207×" / "2,8×" — inteiro quando é grande, uma casa quando importa. */
function razaoTexto(r: number): string {
  return `${r >= 10 ? nf(0).format(r) : nf(1).format(r)}×`;
}

/** 'ago/26' a partir de '2026-08-01'. */
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function labelMes(competencia: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(competencia ?? "");
  return m ? `${MES_CURTO[Number(m[2]) - 1] ?? m[2]}/${m[1].slice(2)}` : (competencia ?? "");
}

/** Mediana. Os valores chegam sem ordem garantida, então ordena aqui. */
function mediana(ns: number[]): number {
  if (!ns.length) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  return s.length % 2 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
}

/* ------------------------------------------------------------------
 * Detecção
 * ------------------------------------------------------------------ */

/**
 * Candidatos a recomendação da fatura `competencia`.
 *
 * `faturas` é a lista COMPLETA de competências importadas, em ordem — e não as
 * chaves que aparecem na série. Sem ela não há como saber que um fornecedor
 * FALTOU: uma série que só tem os meses em que ele veio nunca tem buraco.
 */
export function detectar(
  serie: PontoSerie[],
  faturas: string[],
  competencia: string,
): Candidato[] {
  const ordem = [...faturas].sort();
  const iAtual = ordem.indexOf(competencia);
  if (iAtual < 0) return [];
  const anteriores = ordem.slice(0, iAtual);
  const label = labelMes(competencia);

  // fornecedor -> competência -> ponto
  const porFornecedor = new Map<string, Map<string, PontoSerie>>();
  for (const p of serie) {
    if (!p?.e || !p?.m) continue;
    let m = porFornecedor.get(p.e);
    if (!m) { m = new Map(); porFornecedor.set(p.e, m); }
    // Uma competência por fornecedor: se vier repetido, soma em vez de sobrescrever.
    const antes = m.get(p.m);
    m.set(p.m, antes
      ? { ...antes, v: Number(antes.v) + Number(p.v), n: Number(antes.n) + Number(p.n) }
      : { ...p, v: Number(p.v), n: Number(p.n) });
  }

  const out: Candidato[] = [];

  for (const [estabelecimento, meses] of porFornecedor) {
    const atual = meses.get(competencia);
    const valor = atual?.v ?? 0;
    const lancamentos = atual?.n ?? 0;

    // Só o que já existia ANTES desta fatura entra na base de comparação: usar a
    // série inteira faria a fatura se comparar consigo mesma e afundaria o pico.
    const historico = anteriores
      .map((m) => ({ m, p: meses.get(m) }))
      .filter((x) => (x.p?.v ?? 0) > 0);
    const valoresAnt = historico.map((x) => x.p!.v);
    const med = mediana(valoresAnt);
    const maxAnt = valoresAnt.length ? Math.max(...valoresAnt) : 0;

    const serieCompleta = ordem.map((m) => ({
      m, v: meses.get(m)?.v ?? 0, n: meses.get(m)?.n ?? 0,
    }));
    const contexto = atual ?? historico[historico.length - 1]?.p;
    const comum = {
      estabelecimento,
      categoria: contexto?.c ?? null,
      descricaoOfx: contexto?.d ?? null,
      cidade: contexto?.ci ?? null,
      serie: serieCompleta,
      lancamentos,
    };

    /* --- pico: recorde histórico, e muito acima do próprio normal -------
       Duas medidas de "alto", e as duas são necessárias: muito acima da MEDIANA
       (é anormal para este fornecedor) e bem acima do RECORDE anterior (é pico,
       não patamar novo — ver PICO_SOBRE_RECORDE). 15 achados nas 8 faturas, 3 em
       ago/26: SYMPLA 207×, 99 10,5×, OPENAI 6,7×. */
    const razao = med > 0 ? valor / med : null;
    if (
      valoresAnt.length >= PICO_MESES_MIN &&
      med > 0 && razao != null &&
      valor >= maxAnt * PICO_SOBRE_RECORDE &&
      razao >= PICO_RAZAO &&
      valor - med >= EXCESSO_MIN
    ) {
      out.push({
        ...comum,
        sinal: "pico",
        nivel: razao >= 10 || valor - med >= 10_000 ? "critico" : "atencao",
        titulo: `${estabelecimento} veio ${razaoTexto(razao)} acima do normal`,
        valor,
        valorReferencia: med,
        razao,
        fatos: [
          `Nesta fatura (${label}): ${brl(valor)} em ${lancamentos} ${lancamentos === 1 ? "lançamento" : "lançamentos"}.`,
          `A mediana das ${valoresAnt.length} faturas anteriores com gasto neste estabelecimento é ${brl(med)}` +
            ` — ${razaoTexto(razao)} menos.`,
          `É o maior valor já registrado nele, e por folga: o recorde anterior era ${brl(maxAnt)}.`,
          `Excesso sobre a mediana: ${brl(valor - med)}.`,
        ],
        peso: valor - med,
      });
    }

    /* --- ausente: mensalidade que não veio ------------------------------
       O buraco no MEIO do período também conta, e é o caso que a tela não
       pegava: HUBSPOT faltou em mai/26 e ninguém viu — jun/26 veio com 2,12× a
       mediana, a cobrança acumulada. 3 achados em ago/26. */
    const janela = anteriores.slice(-AUSENTE_JANELA);
    const janelaCheia =
      janela.length === AUSENTE_JANELA && janela.every((m) => (meses.get(m)?.v ?? 0) > 0);
    if (valor === 0 && valoresAnt.length >= AUSENTE_MESES_MIN && janelaCheia && med >= AUSENTE_VALOR_MIN) {
      const ultimo = historico[historico.length - 1]!;
      out.push({
        ...comum,
        sinal: "ausente",
        nivel: med >= 10_000 ? "critico" : "atencao",
        titulo: `${estabelecimento} não veio nesta fatura`,
        valor: 0,
        valorReferencia: med,
        razao: null,
        fatos: [
          `Nenhum lançamento em ${label}.`,
          `Veio em ${valoresAnt.length} das ${anteriores.length} faturas anteriores, inclusive nas ` +
            `${AUSENTE_JANELA} últimas seguidas — é cobrança mensal.`,
          `Na fatura anterior (${labelMes(ultimo.m)}) foram ${brl(ultimo.p!.v)}; a mediana é ${brl(med)}.`,
        ],
        peso: med,
      });
    }

    /* --- dobrada: ~2× a mediana, com a mesma quantidade de lançamentos ---
       O teto de lançamentos é o que separa cobrança dobrada de mês movimentado.
       1 achado em 8 faturas: HUBSPOT jun/26 (53k = 2,12× a mediana, 3
       lançamentos) — a recuperação do mês que faltou. */
    if (
      razao != null && med > 0 &&
      valoresAnt.length >= DOBRADA_MESES_MIN &&
      razao >= DOBRADA_MIN && razao <= DOBRADA_MAX &&
      valor - med >= EXCESSO_MIN &&
      lancamentos <= DOBRADA_LANC_MAX
    ) {
      // Um pico não é também uma cobrança dobrada: as faixas não se cruzam
      // (pico exige >= 3×), então não há dedupe a fazer aqui.
      const faltou = anteriores.filter((m) => (meses.get(m)?.v ?? 0) === 0).map(labelMes);
      out.push({
        ...comum,
        sinal: "dobrada",
        nivel: valor - med >= 10_000 ? "critico" : "atencao",
        titulo: `${estabelecimento} veio ${razaoTexto(razao)} o valor de sempre`,
        valor,
        valorReferencia: med,
        razao,
        fatos: [
          `Nesta fatura (${label}): ${brl(valor)} em ${lancamentos} ${lancamentos === 1 ? "lançamento" : "lançamentos"}` +
            ` — a mediana é ${brl(med)}.`,
          `A quantidade de lançamentos NÃO cresceu na proporção do valor, o que costuma indicar ` +
            `cobrança em duplicidade ou duas competências na mesma fatura.`,
          faltou.length
            ? `Este fornecedor não apareceu em ${faltou.join(", ")} — pode ser a cobrança daquele mês vindo junto.`
            : `Ele veio em todas as faturas anteriores, então não é atraso acumulado.`,
        ],
        peso: valor - med,
      });
    }
  }

  return out.sort((a, b) => b.peso - a.peso).slice(0, MAX_POR_FATURA);
}
