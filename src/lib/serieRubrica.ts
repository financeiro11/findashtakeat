/* ============================================================================
 * A HISTÓRIA de uma rubrica — a segunda régua da DRE/DFC.
 *
 * Até aqui, tudo o que a máquina sabia dizer sobre uma célula vinha de comparar
 * DOIS meses: `celulasCandidatas` olha o mês e o anterior, a ponte de variação
 * decompõe o par, o comentário fala de "subiu/caiu contra maio". Um par não
 * enxerga duas coisas que o fechamento precisa enxergar:
 *
 *  1. A RUBRICA QUE SUMIU. "(+) Receita financeira" teve 8,4k, 12,1k, 35,2k,
 *     18,0k e 17,0k — e em agosto está zerada. Contra julho isso é uma variação
 *     como outra qualquer; contra a série é o fato mais alto da coluna. Foi o
 *     caso que motivou este arquivo.
 *  2. O NÚMERO GRANDE QUE VARIOU POUCO EM %. O piso de 10% não significa nada
 *     numa rubrica estável de meio milhão: 30 mil de diferença é 5,5% e passa
 *     batido, mesmo sendo seis vezes a oscilação normal daquela linha.
 *
 * MEDIANA E MAD, NÃO MÉDIA E DESVIO-PADRÃO. Folha tem 13º, férias e rescisão;
 * receita tem o mês da campanha. Um único mês fora da curva puxa a média e
 * infla o desvio-padrão o bastante para a régua parar de acusar qualquer coisa
 * — que é o oposto do que se quer. A mediana ignora o outlier em vez de ser
 * dominada por ele.
 *
 * Tudo aqui é função pura sobre a série que a PÁGINA leu (`valorDaLinha`), pelo
 * mesmo motivo de `justificativas.ts`: a estatística tem de falar dos números
 * que estão à vista, não de uma segunda leitura do blob.
 * ========================================================================== */

/** Um ponto da série: o mês e o que a célula mostra nele. */
export type PontoSerie = { mes: string; valor: number | null };

/** Meses de história considerados. Doze pega o ciclo inteiro (13º, férias). */
export const JANELA_PADRAO = 12;

/**
 * Corte do z robusto de Iglewicz–Hoaglin. 3,5 é o valor que o método propõe e
 * que a literatura usa como padrão; abaixo disso a régua acusa oscilação normal.
 */
export const Z_ATIPICO = 3.5;

/** Sem este tanto de história não há série: há duas ou três medições soltas. */
export const MIN_MESES_SERIE = 4;

/**
 * Para a rubrica ser "recorrente" — e portanto a ausência dela ser um fato.
 *
 * Quatro, e não três, por causa do ensaio contra a base real (01/09/2026): com
 * três, o começo da base virava fábrica de achado fraco — "Antecipação",
 * "(+) Novos Empréstimos" e "(-) Amortização de Financiamentos" acusavam em
 * abr–jun/24 com histórico de 3 meses em janelas de 3 a 5, que é o mínimo
 * aritmeticamente possível. Subir para quatro apagou os nove achados fracos e
 * NENHUM dos reais (o pior deles tem 8 meses de história).
 */
export const MIN_MESES_RECORRENTE = 4;
export const FRACAO_RECORRENTE = 0.6;

/**
 * Piso em R$ da mediana para a ausência virar sinal. Uma rubrica que costuma
 * trazer R$ 300 e este mês não veio não é notícia de fechamento.
 */
export const MIN_MEDIANA_AUSENCIA = 1_000;

export type AnaliseSerie = {
  /** Quantos meses anteriores entraram na conta. */
  janela: number;
  /** Destes, quantos tinham valor (não nulo e não zero). */
  meses: number;
  /** Mediana do histórico, já orientada (despesa em módulo). */
  mediana: number;
  /** Desvio absoluto mediano — a "oscilação normal" desta rubrica. */
  mad: number;
  /**
   * Quantos desvios o mês está fora do normal (z robusto). `null` quando não há
   * amostra suficiente ou quando o MAD é zero — série constante não tem escala,
   * e dividir por ela produziria "infinitamente atípico" para R$ 1 de diferença.
   */
  z: number | null;
  /** O valor deste mês é o maior/menor da janela inteira. */
  extremo: "maior" | "menor" | null;
  /** O teto e o piso do HISTÓRICO (sem o mês em foco). Zero quando não há amostra. */
  maximo: number;
  minimo: number;
  /** A rubrica aparece em quase todo mês — a ausência dela quer dizer algo. */
  recorrente: boolean;
  /** Rubrica recorrente que este mês não veio. */
  ausente: boolean;
  /** `true` = a célula traz 0; `false` = a célula não traz linha nenhuma. */
  zerada: boolean;
  /** O último mês com valor e quanto foi — o "de onde ela caiu". */
  ultimoMes: string | null;
  ultimoValor: number | null;
};

/** Despesa chega negativa do blob; a série é lida em módulo, como o comentário. */
const orientar = (v: number, despesa: boolean) => (despesa ? Math.abs(v) : v);

/** Presença: zero não conta como "a rubrica veio" — é justamente o que se caça. */
const temValor = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v !== 0;

export function mediana(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  return s.length % 2 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
}

/** MAD: a mediana das distâncias até a mediana. */
export function desvioMediano(xs: number[], med = mediana(xs)): number {
  if (!xs.length) return 0;
  return mediana(xs.map((x) => Math.abs(x - med)));
}

/**
 * O que a história desta rubrica diz sobre este mês.
 *
 * `historico` são os meses ANTERIORES ao que está em foco, na ordem da grade —
 * quem chama corta a janela. O mês em foco entra separado, em `atual`, porque
 * ele não pode participar da própria régua: uma queda a zero que entrasse na
 * amostra puxaria a mediana para baixo e se justificaria sozinha.
 */
export function analisarSerie(opts: {
  historico: PontoSerie[];
  atual: number | null;
  despesa: boolean;
  janela?: number;
  minMedianaAusencia?: number;
}): AnaliseSerie {
  const { atual, despesa } = opts;
  const janelaN = opts.janela ?? JANELA_PADRAO;
  const minMediana = opts.minMedianaAusencia ?? MIN_MEDIANA_AUSENCIA;

  const recorte = opts.historico.slice(-janelaN);
  const comValor = recorte.filter((p) => temValor(p.valor));
  const amostra = comValor.map((p) => orientar(p.valor as number, despesa));

  const med = mediana(amostra);
  const mad = desvioMediano(amostra, med);

  const atualO = atual == null ? null : orientar(atual, despesa);
  /* Iglewicz–Hoaglin: 0,6745 é o fator que põe o MAD na mesma escala do
     desvio-padrão de uma normal, e é o que faz o corte de 3,5 significar o que
     a literatura diz que significa. */
  const z = atualO != null && amostra.length >= MIN_MESES_SERIE && mad > 0
    ? (0.6745 * (atualO - med)) / mad
    : null;

  const maximo = amostra.length ? Math.max(...amostra) : 0;
  const minimo = amostra.length ? Math.min(...amostra) : 0;

  let extremo: AnaliseSerie["extremo"] = null;
  if (atualO != null && amostra.length >= MIN_MESES_SERIE) {
    if (atualO > maximo) extremo = "maior";
    else if (atualO < minimo) extremo = "menor";
  }

  const recorrente =
    comValor.length >= MIN_MESES_RECORRENTE
    && recorte.length > 0
    && comValor.length / recorte.length >= FRACAO_RECORRENTE;

  const vazia = !temValor(atual);
  const ausente = vazia && recorrente && Math.abs(med) >= minMediana;
  const ultimo = comValor.length ? comValor[comValor.length - 1] : null;

  return {
    janela: recorte.length,
    meses: comValor.length,
    mediana: med,
    mad,
    z,
    extremo,
    maximo,
    minimo,
    recorrente,
    ausente,
    // Zero digitado e linha ausente são coisas diferentes para quem fecha: uma é
    // "o Omie trouxe nada", a outra é "a rubrica não existe neste mês".
    zerada: atual === 0,
    ultimoMes: ultimo?.mes ?? null,
    ultimoValor: ultimo ? orientar(ultimo.valor as number, despesa) : null,
  };
}

/** O mês destoa da própria história — mesmo que a variação em % seja pequena. */
export function atipicaNaSerie(a: AnaliseSerie, corte = Z_ATIPICO): boolean {
  return a.z != null && Math.abs(a.z) >= corte;
}

/**
 * O mês bateu o recorde da rubrica — e por uma margem que quer dizer algo.
 *
 * A margem é o que separa recorde de crescimento: numa receita que sobe de 100
 * para 110 todo mês, TODO mês é o maior de doze, e um painel que dissesse isso
 * seria desligado. Exige-se passar o teto anterior por pelo menos a oscilação
 * típica da própria rubrica (o MAD) — ou pelo piso em R$, quando a série é tão
 * constante que o MAD é zero.
 *
 * Não se usa o z aqui de propósito: série perfeitamente constante tem MAD zero,
 * o z fica indefinido, e é justamente o caso em que o salto é mais gritante.
 */
export function recordeNaSerie(
  a: AnaliseSerie, atual: number | null, despesa: boolean, piso: number,
): boolean {
  if (a.extremo == null || atual == null) return false;
  const atualO = orientar(atual, despesa);
  const margem = Math.max(piso, a.mad);
  return a.extremo === "maior"
    ? atualO - a.maximo >= margem
    : a.minimo - atualO >= margem;
}

/* ============================================================
 *  O que vai para o prompt e para o sinal
 * ============================================================
 * Só NÚMEROS atravessam a fronteira cliente → servidor. A frase é montada lá,
 * com os mesmos formatadores dos drivers (`brl`, `abrev`, `rotuloMes`), pela
 * mesma razão de sempre: sinal redigido em dois lugares diverge no primeiro
 * ajuste que alguém fizer num deles.
 */
export type SerieResumo = {
  janela: number;
  meses: number;
  mediana: number;
  mad: number;
  z: number | null;
  extremo: "maior" | "menor" | null;
  maximo: number;
  minimo: number;
  recorrente: boolean;
  ausente: boolean;
  zerada: boolean;
  ultimoMes: string | null;
  ultimoValor: number | null;
};

export const resumoDaSerie = (a: AnaliseSerie): SerieResumo => ({
  janela: a.janela,
  meses: a.meses,
  mediana: a.mediana,
  mad: a.mad,
  z: a.z,
  extremo: a.extremo,
  maximo: a.maximo,
  minimo: a.minimo,
  recorrente: a.recorrente,
  ausente: a.ausente,
  zerada: a.zerada,
  ultimoMes: a.ultimoMes,
  ultimoValor: a.ultimoValor,
});
