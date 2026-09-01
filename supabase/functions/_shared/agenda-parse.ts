/* ---------------------------------------------------------------------------
 * Como se lê um evento do Google Calendar. SEM nada de Deno, de propósito.
 *
 * A parte que fala com o Google mora em `agenda.ts`; esta aqui é só a leitura —
 * de onde sai o dia, de onde sai o valor, e o que conta como pagamento. É a
 * parte que erra, e por isso é a que precisa de teste: os testes vivem em
 * `src/lib/tarefas/agenda-parse.test.ts` e rodam contra eventos REAIS da agenda
 * de financeiro@takeat.app (o vitest só varre `src/**`, daí o import relativo).
 * ------------------------------------------------------------------------- */

export type EventoAgenda = {
  /** id da INSTÂNCIA (a recorrência expandida traz "..._20260820"), não da série. */
  eventId: string;
  dia: string;              // YYYY-MM-DD — o dia de INÍCIO
  diaInteiro: boolean;
  titulo: string;
  descricao: string;
  cor: string | null;
  link: string | null;
  valor: number | null;
  ehPagamento: boolean;
  /** O que vira a subtarefa: título + valor, quando o título ainda não o traz. */
  rotulo: string;
};

/**
 * Palavras que dizem "isto não é um pagamento".
 *
 * É a MESMA lista de `src/lib/pagamentos.ts` (const ROTINA), de propósito: as
 * duas leituras da agenda — o card do briefing e o checklist da rotina —
 * precisam concordar sobre o que é pagamento, senão o mesmo dia aparece com
 * contagens diferentes em duas telas e ninguém sabe qual acreditar. Mudou lá,
 * mude aqui.
 *
 * O filtro não é perfeito, e o limite é conhecido e medido na agenda real:
 * "Desativar fluxo <> Emissão NFs Asaas" é evento de dia inteiro, não é
 * pagamento e passa. Preferimos errar para o lado de MOSTRAR: a subtarefa a mais
 * se apaga num clique, e a de menos é um pagamento que ninguém conferiu.
 */
export const NAO_E_PAGAMENTO =
  /(fechamento|dia util|dia utl|conferir|checar|revis|reuni|feriado|folga|ferias|anivers|prazo|lembrete)/i;

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** "R$ 4.361,00" → 4361 · "R$ 90,00" → 90 · "R$6000,00" → 6000 · "R$ 1444" → 1444 */
export function extrairValor(texto: string): number | null {
  const m = /R\$\s*([\d.]+(?:,\d{1,2})?)/i.exec(texto || "");
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return isFinite(n) && n > 0 ? n : null;
}

/** O HTML que o Google aceita na descrição vira texto — os links do formulário ficam. */
export function descricaoEmTexto(html: string): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * O ESPAÇO NÃO-QUEBRÁVEL SAI, e isto não é preciosismo.
 *
 * `toLocaleString("pt-BR", …BRL)` separa "R$" do número com U+00A0, não com um
 * espaço comum — invisível na tela e diferente na comparação. O rótulo vira
 * título de subtarefa e entra no texto que a busca do quadro varre: com o NBSP
 * guardado, procurar "R$ 1.444,00" digitando o espaço do teclado não acha a
 * linha que está escrita bem ali. Descoberto por um teste cuja mensagem de erro
 * mostrava duas strings idênticas.
 */
export function formatarBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    .replace(/ /g, " ");
}

/**
 * O rótulo que vira subtarefa.
 *
 * O valor é acrescentado só quando o título ainda não o traz: metade dos eventos
 * já se chama "Monbee - R$ 250,00" e "Baltazar - Parcela 2 (R$ 4035,28)"; a outra
 * metade guarda o valor na descrição ("Valor NF: R$6000,00", "CPF Miguel:
 * R$ 4.361,00"), e é aí que a soma do dia aparecia zerada para quem só lia o
 * título.
 */
export function montarRotulo(titulo: string, valor: number | null): string {
  const t = String(titulo ?? "").trim();
  if (valor == null || /R\$/i.test(t)) return t;
  return `${t} — ${formatarBRL(valor)}`;
}

/** O `start` de um evento de dia inteiro vem como `date`; o com hora, `dateTime`. */
export function diaDoEvento(e: Record<string, any>): { dia: string; diaInteiro: boolean } {
  const s = e?.start ?? {};
  if (s.date) return { dia: String(s.date).slice(0, 10), diaInteiro: true };
  /* Evento com hora: o dia é o do fuso da agenda (America/Sao_Paulo). Cortar o
     ISO em UTC jogaria um compromisso das 21h para o dia seguinte. */
  const iso = String(s.dateTime ?? "");
  if (!iso) return { dia: "", diaInteiro: false };
  const d = new Date(iso);
  const local = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const p = (n: number) => String(n).padStart(2, "0");
  return { dia: `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}`, diaInteiro: false };
}

export function lerEvento(e: Record<string, any>): EventoAgenda | null {
  const { dia, diaInteiro } = diaDoEvento(e);
  const eventId = String(e?.id ?? "");
  if (!dia || !eventId) return null;

  const titulo = String(e?.summary ?? "").trim() || "(sem título)";
  const descricao = descricaoEmTexto(String(e?.description ?? ""));
  const valor = extrairValor(titulo) ?? extrairValor(descricao);

  return {
    eventId,
    dia,
    diaInteiro,
    titulo,
    descricao,
    cor: e?.colorId ? String(e.colorId) : null,
    link: e?.htmlLink ? String(e.htmlLink) : null,
    valor,
    /* Só evento de DIA INTEIRO é candidato a pagamento — é a convenção que o
       time já usa e que o card do briefing já assumia. Reunião tem hora e cai
       fora sozinha, sem precisar de lista de exceção. */
    ehPagamento: diaInteiro && !NAO_E_PAGAMENTO.test(semAcento(titulo)),
    rotulo: montarRotulo(titulo, valor),
  };
}
