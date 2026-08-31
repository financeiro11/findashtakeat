// A banda que decide se um número está fora do normal.
//
// Este arquivo é o motor do sino: nenhuma IA passa por aqui. A IA entra DEPOIS,
// só para escrever a frase em português — o mesmo arranjo do `cartao-sinais.ts`
// e pelo mesmo motivo: se o critério variasse de um dia para o outro, "hoje não
// apareceu nada" não significaria nada, e um sinal que não se explica é um sinal
// que a pessoa aprende a ignorar.
//
// ===========================================================================
// AS QUATRO DECISÕES QUE SEGURAM O FALSO POSITIVO
//
// Falso positivo aqui não é chateação, é dano: dois deles e o contador do sino
// vira decoração. Cada guarda abaixo existe porque, sem ela, uma série real
// deste banco dispararia sem ter acontecido nada.
//
// 1. MEDIANA E MAD, NÃO MÉDIA E DESVIO-PADRÃO. Julho/2026 teve 332 `falta`
//    contra 83–186 dos meses vizinhos. Numa média, esse mês sozinho levanta o
//    centro e engorda o desvio — e o mês seguinte, que era o realmente anormal,
//    passa despercebido por caber na banda que o outlier alargou. A mediana
//    ignora o extremo; o MAD mede a dispersão dos outros.
//
// 2. PISO DE DISPERSÃO. Numa série muito estável o MAD chega perto de zero, e
//    aí QUALQUER variação vira um z gigante — a série mais comportada seria a
//    que mais grita. O piso (3% da mediana) impede que estabilidade vire
//    histeria.
//
// 3. PISO RELATIVO. Passar do z não basta: a variação também precisa ser grande
//    o suficiente para valer o seu tempo. Cobertura caindo de 95,7% para 95,1%
//    pode ser estatisticamente notável e não é notícia para ninguém.
//
// 4. HISTÓRICO MÍNIMO. Com duas ou três competências não há banda que se
//    sustente — a mediana de três pontos é o ponto do meio. Abaixo de
//    MIN_HISTORICO a resposta é "não sei", que é diferente de "está normal" e
//    por isso tem um veredito próprio.

/* ============================================================ estatística */

/** Mediana. Não muta a entrada — o chamador costuma reusar o array. */
export function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Desvio absoluto mediano, escalado por 1,4826 para ficar comparável a um
 * desvio-padrão quando os dados são normais. É esse fator que deixa o `k` da
 * banda ter o significado habitual de "quantos sigmas".
 */
export function mad(xs: number[]): number {
  if (xs.length === 0) return 0;
  const med = mediana(xs);
  return mediana(xs.map((x) => Math.abs(x - med))) * 1.4826;
}

/* ================================================================= banda */

export type Banda = {
  /** O centro: o que se espera do número. */
  centro: number;
  /** Dispersão já com o piso da decisão 2 aplicado. Nunca zero. */
  dispersao: number;
  piso: number;
  teto: number;
  /** Quantas competências entraram na conta. */
  n: number;
};

/** Fração da mediana usada como piso de dispersão (decisão 2). */
const PISO_DISPERSAO_REL = 0.03;

/** Abaixo disso não se calcula banda, se devolve "não sei" (decisão 4). */
export const MIN_HISTORICO = 4;

/**
 * @param historico competências anteriores, do mais antigo ao mais recente.
 * @param k largura em "sigmas". 3 é o padrão do vigia — deliberadamente largo:
 *          o sino erra para o lado de calar a boca.
 */
export function calcularBanda(historico: number[], k = 3): Banda {
  const centro = mediana(historico);
  /* O piso é relativo à mediana, e não absoluto, porque as séries convivem em
     escalas muito diferentes: cobertura anda em 0..1 e contagem de cobrança em
     milhares. Um piso absoluto serviria para uma e seria absurdo para a outra. */
  const dispersao = Math.max(mad(historico), Math.abs(centro) * PISO_DISPERSAO_REL, 1e-9);
  return {
    centro,
    dispersao,
    piso: centro - k * dispersao,
    teto: centro + k * dispersao,
    n: historico.length,
  };
}

/* ============================================================== veredito */

/** Para que lado a série é notícia. Cobertura que SOBE é boa notícia, não sinal. */
export type Direcao = "abaixo" | "acima" | "ambos";

export type Veredito = {
  /** `true` só quando passou de TODAS as guardas. */
  disparou: boolean;
  /** `sem_historico` é diferente de `dentro`: é "não sei", não "está bem". */
  motivo: "sem_historico" | "dentro" | "direcao_ignorada" | "variacao_pequena" | "fora";
  /** Quantos desvios o atual está do centro. Negativo = abaixo. */
  z: number;
  /** Variação contra o centro, em fração (-0,88 = 88% abaixo do normal). */
  relativo: number;
  banda: Banda;
};

/**
 * @param folga multiplicador da largura, vindo da calibragem. O botão "isso é
 *        normal" aumenta a folga DAQUELA série — alargar a banda ensina o vigia,
 *        enquanto simplesmente sumir com o aviso o deixa repetir o erro amanhã.
 * @param minRelativo variação mínima para valer um sinal (decisão 3).
 */
export function avaliar(
  atual: number,
  historico: number[],
  opts: { k?: number; folga?: number; direcao?: Direcao; minRelativo?: number } = {},
): Veredito {
  const { k = 3, folga = 1, direcao = "ambos", minRelativo = 0.15 } = opts;

  if (historico.length < MIN_HISTORICO) {
    const banda = calcularBanda(historico, k);
    return { disparou: false, motivo: "sem_historico", z: 0, relativo: 0, banda };
  }

  const banda = calcularBanda(historico, k * folga);
  const z = (atual - banda.centro) / banda.dispersao;
  /* Divisão protegida: uma série cujo centro é zero não tem variação relativa
     que signifique alguma coisa, e devolver Infinity faria a guarda 3 passar
     sempre — exatamente ao contrário do que ela existe para fazer. */
  const relativo = banda.centro === 0 ? 0 : (atual - banda.centro) / Math.abs(banda.centro);

  const fora = atual < banda.piso || atual > banda.teto;
  if (!fora) return { disparou: false, motivo: "dentro", z, relativo, banda };

  const ladoCerto =
    direcao === "ambos" ||
    (direcao === "abaixo" && atual < banda.centro) ||
    (direcao === "acima" && atual > banda.centro);
  if (!ladoCerto) return { disparou: false, motivo: "direcao_ignorada", z, relativo, banda };

  if (Math.abs(relativo) < minRelativo) {
    return { disparou: false, motivo: "variacao_pequena", z, relativo, banda };
  }

  return { disparou: true, motivo: "fora", z, relativo, banda };
}

/* ============================================================ dia útil */
//
// POR QUE O RITMO, E NÃO O TOTAL: comparar "12 notas até hoje" com "40 no mês
// passado inteiro" grita todo dia 10 de todo mês. A comparação honesta é contra
// quantas o mês passado tinha ATÉ O MESMO DIA ÚTIL — 12 contra 18, e aí sim.
//
// Feriado nacional não entra na conta: não existe tabela de feriados neste banco,
// e inventar uma lista que envelhece sozinha seria pior do que não ter. O viés
// em grande parte se cancela, porque os dois lados da comparação usam a MESMA
// régua — o erro aparece só quando o feriado cai num mês e não no outro, e aí
// vale no máximo um dia útil de diferença, bem dentro da folga da banda.

/** Segunda a sexta. Domingo = 0. */
export function ehDiaUtil(d: Date): boolean {
  const s = d.getUTCDay();
  return s >= 1 && s <= 5;
}

/** Quantos dias úteis já correram no mês de `d`, contando o próprio dia. */
export function diasUteisAte(d: Date): number {
  let n = 0;
  const cursor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  while (cursor.getUTCDate() <= d.getUTCDate() && cursor.getUTCMonth() === d.getUTCMonth()) {
    if (ehDiaUtil(cursor)) n++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return n;
}

/**
 * A data do n-ésimo dia útil de um mês — é o `ate` que se manda ao Postgres para
 * recortar a competência antiga no mesmo ponto em que a atual está.
 *
 * Se o mês acabar antes de completar `n` dias úteis (fevereiro contra um janeiro
 * com 22), devolve o último dia do mês: comparar com o mês inteiro é o mais
 * próximo que existe do pedido, e é o lado conservador — o histórico fica maior,
 * a banda mais alta, e o vigia dispara menos.
 */
export function dataDoNesimoDiaUtil(ano: number, mes0: number, n: number): Date {
  const ultimo = new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
  let contados = 0;
  for (let dia = 1; dia <= ultimo; dia++) {
    const d = new Date(Date.UTC(ano, mes0, dia));
    if (ehDiaUtil(d)) contados++;
    if (contados === n) return d;
  }
  return new Date(Date.UTC(ano, mes0, ultimo));
}

/** `2026-08-31` — o formato que o Postgres espera, sem passar por fuso. */
export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
