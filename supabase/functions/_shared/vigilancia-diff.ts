// A regra que decide se uma mudança de página vira aviso — e de que tipo.
//
// SEM IMPORTS DE PROPÓSITO, como `radar-precos.ts`: assim o Deno (na Edge
// Function) e o Vite (no teste e, se um dia precisar, na tela) leem o MESMO
// arquivo, e não duas cópias que divergem na primeira correção feita só de um
// lado.
//
// POR QUE ISTO NÃO É TRABALHO DA IA. A vigilância lê dez páginas por dia, quase
// sempre sem novidade. Se "isto merece aviso?" fosse pergunta para o modelo, a
// mesma página produziria respostas diferentes em dias diferentes sem nada ter
// mudado — e a lista de avisos, que existe para ser confiável, ficaria instável.
// A IA entra depois, e só para escrever a frase que descreve o diff.

/** As linhas que o `git diff` marca como acrescentadas ou removidas.
 *
 *  `+++` e `---` (cabeçalho de arquivo) ficam de fora: são metadados do formato,
 *  não conteúdo da página, e contá-los faria TODO diff parecer ter duas linhas
 *  alteradas a mais do que tem. */
export function linhasAlteradas(diff: string): string[] {
  return (diff || "").split("\n").filter((l) =>
    (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"));
}

/**
 * A mudança mexeu em dinheiro?
 *
 * Reconhece as formas em que preço aparece numa página brasileira ou americana
 * de SaaS: símbolo de moeda antes do número, o número antes da palavra, e a
 * periodicidade ("/mês", "por mês") — porque uma linha que muda de "por mês"
 * para "por ano" é mudança de preço mesmo sem número nenhum ter mudado.
 */
export function classificarDiff(diff: string): "preco" | "outro" {
  const dinheiro = /(R\$|US\$|\$|€)\s?\d|\d[\d.,]*\s?(reais|d[óo]lares|usd|brl)\b|\/\s?(m[êe]s|ano|mo|month|year)\b|por\s+(m[êe]s|ano)\b/i;
  return linhasAlteradas(diff).some((l) => dinheiro.test(l)) ? "preco" : "outro";
}

/**
 * A mudança vira aviso na tela?
 *
 * O RUÍDO É O INIMIGO, e ele é real: página de marketing mexe sozinha o tempo
 * todo — token de sessão no rodapé, contador de clientes, banner rotativo, ordem
 * dos depoimentos. Se cada uma dessas virar aviso, em duas semanas ninguém abre
 * mais a tela, e o reajuste de verdade chega enterrado no meio do lixo.
 *
 * A régua tem duas saídas:
 *   • mexeu em dinheiro → passa, ainda que seja uma linha só. É exatamente o que
 *     a vigilância existe para pegar;
 *   • mexeu em três linhas ou mais → passa. Reescrita de seção costuma trazer
 *     mudança de política junto (limite de uso, o que o plano inclui), e isso
 *     importa mesmo sem número.
 *
 * Uma ou duas linhas sem dinheiro é ruído de página viva, e fica de fora. O
 * corte é frouxo de propósito: errar avisando demais tem conserto de um clique
 * ("marcar como visto"); errar avisando de menos perde o reajuste, que é a única
 * coisa que esta função existe para pegar.
 */
export function vaiVirarAviso(diff: string): boolean {
  const alteradas = linhasAlteradas(diff);
  if (!alteradas.length) return false;
  return classificarDiff(diff) === "preco" || alteradas.length >= 3;
}
