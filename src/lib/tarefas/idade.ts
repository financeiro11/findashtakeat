/**
 * Idade de uma tarefa descontando o tempo em que ela ficou parada.
 *
 * A regra é do time: card estacionado no Backlog ou no Acompanhamento não está atrasado,
 * está esperando — então o relógio pausa enquanto ele está lá e volta a correr quando sai.
 * Quais colunas pausam vem da tabela `tarefas_colunas` (compartilhada), não daqui.
 *
 * A conta é dividida entre banco e tela de propósito:
 *   - `pausado_ms` guarda só os trechos JÁ FECHADOS, bancados pelo gatilho na saída da coluna;
 *   - o trecho corrente (de `status_desde` até agora) é somado aqui, porque ele cresce sozinho
 *     a cada segundo e gravá-lo no banco exigiria um cron mexendo em toda tarefa parada.
 */

export type TarefaIdade = {
  created_at: string;
  status: string;
  status_desde?: string | null;
  pausado_ms?: number | null;
};

export type Idade = {
  /** Dias que contam: vida total menos tudo que foi passado em coluna pausada. */
  dias: number;
  /** O card está numa coluna que não conta idade agora. */
  pausada: boolean;
  /** Total de dias descontados (trechos fechados + o corrente, se estiver pausado). */
  diasPausados: number;
  /** Há quantos dias o card está na coluna atual. */
  diasNoStatus: number;
};

const DIA = 86_400_000;

export function calcIdade(
  t: TarefaIdade,
  pausa: (status: string) => boolean,
  agora: number = Date.now(),
): Idade {
  const nasceu = new Date(t.created_at).getTime();
  if (!Number.isFinite(nasceu)) return { dias: 0, pausada: false, diasPausados: 0, diasNoStatus: 0 };

  const desdeRaw = t.status_desde ? new Date(t.status_desde).getTime() : NaN;
  const desde = Number.isFinite(desdeRaw) ? desdeRaw : nasceu;
  const pausada = pausa(t.status);

  const corrente = pausada ? Math.max(0, agora - desde) : 0;
  const parado = Math.max(0, t.pausado_ms ?? 0) + corrente;
  const ativo = Math.max(0, agora - nasceu - parado);

  return {
    dias: Math.floor(ativo / DIA),
    pausada,
    diasPausados: Math.floor(parado / DIA),
    diasNoStatus: Math.floor(Math.max(0, agora - desde) / DIA),
  };
}

/** Texto do hover da célula "Idade" — explica por que o número parou. */
export function explicaIdade(t: TarefaIdade, i: Idade): string {
  const criada = new Date(t.created_at).toLocaleDateString("pt-BR");
  const partes = [`Criada em ${criada}`];
  if (i.pausada) {
    partes.push(`Parada em "${t.status}" há ${i.diasNoStatus}d — o relógio não corre aqui`);
  }
  if (i.diasPausados > 0) {
    partes.push(`${i.diasPausados}d fora da conta`);
  }
  return partes.join(" · ");
}
