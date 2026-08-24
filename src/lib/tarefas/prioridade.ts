/**
 * Ordem dos cards dentro da coluna: o mais urgente em cima.
 *
 * Antes, a coluna saía na ordem de criação (`ordem`), que não queria dizer nada
 * para quem olha o quadro — uma "Urgente" criada ontem ficava embaixo de uma
 * "Baixa" da semana passada.
 *
 * Isto não atropela ordenação manual porque ela nunca existiu: arrastar um card
 * no Kanban só troca o `status` (a coluna), nunca a posição dentro dela.
 *
 * A escala mora AQUI e o TaskDialog a reexporta, e não o contrário: a ordenação
 * é regra, o select é tela. Definir a escala em dois lugares faria a ordem
 * divergir do seletor no dia em que alguém acrescentasse um degrau.
 */

/** Do menos para o mais urgente — o índice É o peso. */
export const PRIO_OPTS = ["Baixa", "Média", "Alta", "Urgente"];

export type TarefaPrioridade = {
  prioridade: string;
  prazo?: string | null;
};

/**
 * Comparador para `sort`: prioridade desc, depois prazo mais próximo.
 *
 * Prioridade fora da escala cai para o fim (`indexOf` devolve -1), em vez de ser
 * tratada como a mais baixa — assim um valor digitado errado aparece no rodapé
 * da coluna, onde se percebe, e não misturado no meio.
 *
 * O prazo desempata porque, sem ele, as quatro "Média" da mesma coluna sairiam
 * na ordem de criação e pareceriam aleatórias. Quem não tem prazo vai por
 * último: não dá para chamar de urgente o que não tem data. Empate real devolve
 * 0 e o sort do JS, que é estável, preserva a ordem anterior.
 */
export function comparaPrioridade(a: TarefaPrioridade, b: TarefaPrioridade): number {
  const dif = PRIO_OPTS.indexOf(b.prioridade) - PRIO_OPTS.indexOf(a.prioridade);
  if (dif !== 0) return dif;

  const pa = a.prazo || "";
  const pb = b.prazo || "";
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa.localeCompare(pb);   // ISO yyyy-mm-dd ordena como texto
}

/** Uma cópia ordenada — não mexe no array recebido. */
export function ordenarPorPrioridade<T extends TarefaPrioridade>(itens: T[]): T[] {
  return [...itens].sort(comparaPrioridade);
}
