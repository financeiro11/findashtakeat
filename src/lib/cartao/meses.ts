/**
 * Nomes de competência da fatura, em pt-BR.
 *
 * Mora aqui e não na página porque a fatura do líder passou a mostrar TODOS os meses
 * atribuídos ao cartão, e o que sobra — os meses do extrato que o financeiro ainda não
 * rateou por cartão — vira uma frase no rodapé. Seis competências soltas ("01/2026,
 * 02/2026, 03/2026, 04/2026, 05/2026, 07/2026") ninguém lê; colapsadas em faixa, o vão
 * do calendário aparece de uma olhada.
 */

export const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

/** "2026-08-01" → "Agosto de 2026". */
export function nomeDoMes(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  const nome = MESES[Number(mes) - 1] || competencia;
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${ano}`;
}

/**
 * ["01/2026","02/2026","03/2026","07/2026"] → "janeiro a março e julho de 2026".
 * Aceita a lista fora de ordem e com repetição. Ano só sai no fim quando é um só;
 * cruzando o ano, cada faixa carrega o seu.
 */
export function faixaDeMeses(chaves: string[]): string {
  const validas = chaves.filter((k) => /^\d{2}\/\d{4}$/.test(k));
  const ordenadas = [...new Set(validas)].sort((a, b) => {
    const [ma, aa] = a.split("/");
    const [mb, ab] = b.split("/");
    return (aa + ma).localeCompare(ab + mb);
  });
  if (!ordenadas.length) return "";

  const nome = (k: string) => MESES[Number(k.split("/")[0]) - 1] || k;
  const ano = (k: string) => k.split("/")[1];
  const indice = (k: string) => Number(ano(k)) * 12 + Number(k.split("/")[0]);

  const blocos: string[][] = [];
  for (const k of ordenadas) {
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && indice(k) === indice(ultimo[ultimo.length - 1]) + 1) ultimo.push(k);
    else blocos.push([k]);
  }

  const anoUnico = new Set(ordenadas.map(ano)).size === 1;
  const rotulo = (k: string) => (anoUnico ? nome(k) : `${nome(k)} de ${ano(k)}`);
  // Faixa só a partir de três: "abril a maio" é mais duro de ler que "abril e maio", e o
  // par cabe na própria lista, que já sabe juntar com vírgula e "e".
  const partes = blocos.flatMap((b) =>
    b.length <= 2 ? b.map(rotulo) : [`${rotulo(b[0])} a ${rotulo(b[b.length - 1])}`]);
  const lista = partes.length === 1
    ? partes[0]
    : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;

  return anoUnico ? `${lista} de ${ano(ordenadas[0])}` : lista;
}
