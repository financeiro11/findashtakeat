/**
 * A pergunta que o Hub faz antes de fechar um card que ainda não venceu.
 *
 * POR QUE EXISTE: concluir um card de data futura quase sempre é engano de
 * faxina — a pessoa está limpando o quadro e não leu a data. Foi assim que a
 * Pauta de 11/09 foi fechada no dia 09 (ver src/lib/tarefas/prazo.ts). Adiantar
 * trabalho é legítimo, então a pergunta não proíbe nada; ela só obriga a
 * escolha a ser escolha.
 *
 * POR QUE FOI REESCRITA: em 18/09/2026 a pergunta apareceu num card que o quadro
 * mostrava como "17/09 · ontem" e anunciou "só vence em 21/09/2026 (em 3 d)".
 * Duas coisas estavam erradas ao mesmo tempo. A data tinha sido mexida pelo
 * próprio diálogo, em silêncio (consertado em rotina.ts: prazo que já chegou não
 * se mexe), e o texto falava de uma data que ninguém tinha escolhido, sem dizer
 * que ela era nova. Daí as duas regras deste arquivo:
 *
 *   1. a pergunta cita a data COMO ELA VAI SER GRAVADA, e
 *   2. quando essa data é diferente da que estava no cartão, a mudança é dita
 *      na cara, na mesma tela — não se pergunta sobre um número que a pessoa
 *      está vendo pela primeira vez.
 *
 * Aqui só se decide O QUE DIZER. Quem desenha é a tela: `AlertDialog` no quadro,
 * `confirm()` no celular (via `textoDoAviso`). É por isso que isto é texto puro
 * e testável, e não um componente.
 */

import { lerPrazo } from "./prazo";

export type AvisoConclusao = {
  /** O cabeçalho, que já é a pergunta. */
  titulo: string;
  /** Uma frase por parágrafo, na ordem de leitura. */
  linhas: string[];
  /** O rótulo do botão que segue em frente — diz o que vai acontecer, nunca "OK". */
  confirmar: string;
};

/** "daqui a 3 dias" · "amanhã" — a distância por extenso, que é o que se lê. */
function porExtenso(dias: number): string {
  if (dias === 1) return "amanhã";
  return `daqui a ${dias} dias`;
}

function dataDe(prazo: string | null | undefined): string {
  return lerPrazo(prazo).data;
}

/**
 * O aviso, ou `null` quando não há o que perguntar.
 *
 * `prazoDepois` é o prazo que o salvamento vai gravar — no quadro (arrastar o
 * card) ele é igual ao de antes; no diálogo dá para mudar a data e concluir no
 * mesmo salvar, e é essa a data que vale.
 */
export function avisoDeConclusao(args: {
  titulo: string;
  prazoAntes: string | null | undefined;
  prazoDepois?: string | null;
  /** Tarefa de rotina: a pessoa precisa saber que a próxima ocorrência não se perde. */
  rotina?: boolean;
  hoje?: Date | string;
}): AvisoConclusao | null {
  const { titulo, prazoAntes, rotina = false, hoje } = args;
  const prazoDepois = "prazoDepois" in args ? args.prazoDepois ?? null : prazoAntes ?? null;

  const p = lerPrazo(prazoDepois, { hoje });
  /* Sem prazo, vencido ou de hoje: fechar é o curso normal das coisas. */
  if ((p.dias ?? 0) <= 0) return null;

  const nome = titulo.trim() || "Esta tarefa";
  const linhas = [`“${nome}” vence em ${p.data} — ${porExtenso(p.dias!)}.`];

  if ((prazoAntes ?? null) !== prazoDepois) {
    linhas.push(
      `Atenção: neste mesmo salvamento o prazo está mudando de ${dataDe(prazoAntes)} para ${p.data}.`,
    );
  }

  linhas.push(
    "Se você adiantou o trabalho, pode concluir. Se está arrumando o quadro, é provável que este não seja o card certo.",
  );

  if (rotina) {
    linhas.push(
      `A rotina não se perde: como a conclusão é anterior ao prazo, o card de ${p.data} ainda vai nascer.`,
    );
  }

  return { titulo: "Concluir antes do prazo?", linhas, confirmar: "Concluir mesmo assim" };
}

/** O mesmo aviso em texto corrido, para o `confirm()` do celular. */
export function textoDoAviso(a: AvisoConclusao): string {
  return [a.titulo, ...a.linhas].join("\n\n");
}
