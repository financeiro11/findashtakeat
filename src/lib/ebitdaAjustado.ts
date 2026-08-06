/* ---------------------------------------------------------------------------
 * Apoio ao EBITDA Ajustado (ver components/demonstracoes/AjustesEbitda).
 * Só a parte que não depende de React — é o que dá para testar sozinho.
 * ------------------------------------------------------------------------- */

import { DRE_SCHEMA, type Node } from "@/lib/demonstracoes-schema";

export const LINHA_AJUSTES = "(+) Ajustes de EBITDA";
export const LINHA_EBITDA_AJUSTADO = "EBITDA Ajustado";
export const LINHA_MARGEM_AJUSTADA = "% Margem EBITDA Ajustado";

/** As três linhas que a curadoria escreve — nenhuma delas se audita, se digita
 *  à mão nem se comenta como as outras: são derivadas. */
export const LINHAS_DO_AJUSTE = new Set<string>([
  LINHA_AJUSTES, LINHA_EBITDA_AJUSTADO, LINHA_MARGEM_AJUSTADA,
]);

/**
 * Rubricas que ficam ACIMA do EBITDA — receita, deduções, custos e SG&A.
 *
 * É a lista que vai para a RPC de candidatos, e o corte é o ponto todo: só entra
 * no EBITDA Ajustado o que já estava DENTRO do EBITDA. Somar de volta juros,
 * depreciação ou resultado não operacional — que moram abaixo da linha — seria
 * devolver ao EBITDA algo que ele nunca teve.
 *
 * Só rubrica-folha: é o que o DE_PARA do Omie preenche. Bloco e subtotal são
 * soma dos filhos e não têm lançamento próprio.
 */
export function rubricasDoEbitda(schema: Node[] = DRE_SCHEMA): string[] {
  const out: string[] = [];
  const folhas = (n: Node) => {
    if (n.kind === "total" || n.kind === "percent") return;
    if (!n.children?.length) { out.push(n.label); return; }
    n.children.forEach(folhas);
  };
  for (const n of schema) {
    if (n.label === "EBITDA") break;
    folhas(n);
  }
  return out;
}

/** "salto" → um rótulo curto para a marca na tela. */
export function rotuloRegra(regra: string | null | undefined): string {
  switch (regra) {
    case "contraparte_nova": return "fornecedor novo";
    case "esporadico": return "aparece raramente";
    case "salto": return "acima do próprio histórico";
    case "palavra": return "texto de evento único";
    default: return "sugerido";
  }
}

/**
 * O add-back de um lançamento: o que ele SOMA ao EBITDA.
 *
 * Despesa está no blob como negativa, então tirá-la do EBITDA é somar o módulo;
 * receita não recorrente entra ao contrário. Guardar já somável é o que impede
 * cada leitor (blob, tela, IA) de reinventar a inversão de sinal — e errar.
 */
export const addBack = (valorNoBlob: number): number => -valorNoBlob;

const cent = (n: number) => Math.round(n * 100) / 100;

/**
 * Reparte UM lançamento entre o que volta para o EBITDA e o que fica no mês.
 *
 * POR QUE NEM TODO ONE-OFF É ONE-OFF INTEIRO. A fatura do Datadog de julho veio
 * R$ 40 mil porque trazia meses atrasados; a competência de julho ali dentro era
 * R$ 6,5 mil. Devolver os R$ 40 mil ao EBITDA apagaria um custo que a operação
 * TEM todo mês — o EBITDA Ajustado ficaria melhor que a realidade, que é o
 * oposto do que a linha existe para fazer. O que não se repete são os R$ 33,5
 * mil de atraso.
 *
 * `parte` chega em MÓDULO: a tela pede um número positivo em qualquer dos dois
 * campos e o sinal sai daqui. É o mesmo motivo de `addBack` existir — quem digita
 * não deve precisar saber que despesa mora negativa no blob.
 *
 * Os dois pedaços somam o lançamento inteiro por construção, então a conta que
 * aparece na tela ("40 mil = 33,5 devolvidos + 6,5 que ficam") é sempre verdade.
 */
export function repartirAjuste(
  valorNoBlob: number,
  parteDevolvida: number,
): { valor: number; fica: number } {
  const cheio = addBack(valorNoBlob);
  const sinal = cheio < 0 ? -1 : 1;
  // Devolver mais do que o lançamento tem seria inventar dinheiro; o teto é ele.
  const parte = Math.min(Math.abs(parteDevolvida), Math.abs(cheio));
  const valor = cent(sinal * parte);
  return { valor, fica: cent(valorNoBlob + valor) };
}

/**
 * O que impede um ajuste parcial de virar número solto, em português.
 *
 * `null` quando está de pé. Roda na tela E na Edge Function: a validação que só
 * existe no cliente é a que não existe.
 */
export function erroDoAjuste(valorNoBlob: number | null, valor: number): string | null {
  if (!Number.isFinite(valor) || cent(valor) === 0) {
    return 'O ajuste não pode ser zero — use "Não é" para marcar o lançamento como recorrente.';
  }
  // Ajuste avulso (provisão, estorno) não tem lançamento no Omie para comparar.
  if (valorNoBlob == null || !Number.isFinite(valorNoBlob) || valorNoBlob === 0) return null;

  const cheio = addBack(valorNoBlob);
  if (Math.sign(valor) !== Math.sign(cheio)) {
    return cheio > 0
      ? "Este lançamento é despesa: o ajuste devolve valor ao EBITDA, então tem que ser positivo."
      : "Este lançamento é receita: o ajuste tira valor do EBITDA, então tem que ser negativo.";
  }
  if (Math.abs(valor) - Math.abs(cheio) > 0.01) {
    const teto = Math.abs(cheio).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return `O ajuste não pode passar de ${teto} — é o valor do lançamento inteiro.`;
  }
  return null;
}

/** O ajuste cobre o lançamento todo, ou só um pedaço dele? */
export const ehParcial = (valorNoBlob: number | null | undefined, valor: number): boolean =>
  valorNoBlob != null && Number.isFinite(valorNoBlob)
  && Math.abs(Math.abs(valor) - Math.abs(valorNoBlob)) > 0.01;

/** Soma dos ajustes aceitos de um mês. */
export const somaAjustes = (ajustes: { valor: number }[]): number =>
  ajustes.reduce((s, a) => s + (Number(a.valor) || 0), 0);

/**
 * A linha "EBITDA Ajustado" do blob está atrasada?
 *
 * Ela é DERIVADA e quem escreve o blob é que a refaz — mas nem todo escritor
 * conhece a regra (o omie-sync do cron pode estar numa versão anterior a ela).
 * Em vez de exigir que todos saibam, a tela confere: para cada mês com EBITDA,
 * o ajustado tem que ser o EBITDA mais os ajustes aceitos daquele mês. Um
 * centavo de tolerância porque tanto o blob quanto os ajustes são arredondados.
 */
export function precisaRecalcular(
  colunas: string[],
  ebitdaDe: (col: string) => number | null,
  ajustadoDe: (col: string) => number | null,
  ajustesDe: (col: string) => { valor: number }[],
): boolean {
  return colunas.some((col) => {
    const eb = ebitdaDe(col);
    if (eb == null) return false; // mês sem EBITDA não tem linha ajustada
    const esperado = eb + somaAjustes(ajustesDe(col));
    const atual = ajustadoDe(col);
    return atual == null || Math.abs(atual - esperado) > 0.01;
  });
}
