/**
 * A leitura do prazo de uma tarefa: passado, hoje ou futuro — e a que distância.
 *
 * O QUE MOTIVOU: no quadro, "11/09/2026" e "18/09/2026" são duas datas cinzas do
 * mesmo tamanho, no mesmo canto do card. Numa faxina de fim de tarde ninguém lê o
 * número inteiro — e foi assim que o card da Pauta de sexta foi concluído numa
 * quarta, dois dias antes de existir. Como o gerador de rotinas tratava aquele dia
 * como usado, a ocorrência de sexta nunca nasceu (migration 20260911170000).
 * A data sozinha não responde a pergunta que a pessoa está fazendo, que é "isso é
 * para agora?". A distância responde.
 *
 * A conta é por DIA, nunca por hora: prazo é `date` (sem fuso), e comparar com
 * `Date.now()` faria uma tarefa de hoje virar "vencida" às 00h01 conforme o
 * relógio de quem abre a tela. Por isso as duas pontas são zeradas à meia-noite
 * local antes de subtrair.
 *
 * `concluida` não muda a distância, só o tom: card fechado não está atrasado (é a
 * mesma regra do contador de atrasadas no topo do quadro). Mas continua sendo útil
 * ver que ele venceria adiante — é o sinal de "fechei antes da hora".
 */

export type TomPrazo = "sem" | "atrasado" | "hoje" | "amanha" | "futuro" | "concluida";

export type LeituraPrazo = {
  tom: TomPrazo;
  /** Dias até o prazo: negativo no passado, 0 hoje. `null` quando não há prazo. */
  dias: number | null;
  /** "11/09/2026" — ou "—" sem prazo. */
  data: string;
  /** Data curta para o card: "11/09", com o ano só quando não é o ano corrente. */
  curta: string;
  /** "hoje" · "amanhã" · "há 3 d" · "em 7 d" — vazio quando não há prazo. */
  distancia: string;
  /** O hover, que diz por extenso o que a cor e a distância resumem. */
  titulo: string;
};

const DIA = 86_400_000;

/** Meia-noite local de uma data `YYYY-MM-DD`. Sem `new Date(iso)`, que lê como UTC. */
function meiaNoite(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function plural(n: number, s: string, p: string) {
  return n === 1 ? s : p;
}

/**
 * `hoje` aceita Date (desktop) ou "YYYY-MM-DD" (o celular trabalha em ISO de
 * ponta a ponta justamente para não passar por Date, ver lib/mobile/formato).
 */
export function lerPrazo(
  prazo: string | null | undefined,
  opts: { hoje?: Date | string; concluida?: boolean } = {},
): LeituraPrazo {
  const { hoje: hojeIn = new Date(), concluida = false } = opts;
  const hoje = typeof hojeIn === "string" ? (meiaNoite(hojeIn) ?? new Date()) : hojeIn;

  if (!prazo) {
    return {
      tom: "sem", dias: null, data: "—", curta: "—", distancia: "",
      titulo: concluida ? "Concluída — sem prazo" : "Sem prazo",
    };
  }

  const alvo = meiaNoite(prazo);
  if (!alvo) {
    return { tom: "sem", dias: null, data: prazo, curta: prazo, distancia: "", titulo: prazo };
  }

  const ref = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = Math.round((alvo.getTime() - ref.getTime()) / DIA);

  const dd = String(alvo.getDate()).padStart(2, "0");
  const mm = String(alvo.getMonth() + 1).padStart(2, "0");
  const data = `${dd}/${mm}/${alvo.getFullYear()}`;
  const curta = alvo.getFullYear() === ref.getFullYear()
    ? `${dd}/${mm}`
    : `${dd}/${mm}/${String(alvo.getFullYear()).slice(2)}`;

  const distancia =
    dias === 0 ? "hoje"
      : dias === 1 ? "amanhã"
      : dias === -1 ? "ontem"
      : dias < 0 ? `há ${-dias} d`
      : `em ${dias} d`;

  const tom: TomPrazo =
    concluida ? "concluida"
      : dias < 0 ? "atrasado"
      : dias === 0 ? "hoje"
      : dias === 1 ? "amanha"
      : "futuro";

  const titulo = concluida
    ? (dias > 0
      /* O caso que este arquivo existe para tornar visível. */
      ? `Concluída antes do prazo — vencia em ${data}, daqui a ${dias} ${plural(dias, "dia", "dias")}`
      : `Concluída · prazo ${data}`)
    : dias < 0 ? `Venceu em ${data} — há ${-dias} ${plural(-dias, "dia", "dias")}`
      : dias === 0 ? `Vence hoje, ${data}`
      : `Vence em ${data} — daqui a ${dias} ${plural(dias, "dia", "dias")}. Ainda não é para agora.`;

  return { tom, dias, data, curta, distancia, titulo };
}

/** Atrasada é o prazo vencido de card ainda aberto — concluída nunca conta. */
export function prazoAtrasado(prazo: string | null | undefined, concluida: boolean, hoje?: Date | string): boolean {
  if (concluida) return false;
  return lerPrazo(prazo, { hoje }).tom === "atrasado";
}
