/* ---------------------------------------------------------------------------
 * O Google Calendar de `financeiro@takeat.app`, lido pelo Hub.
 *
 * POR QUE ISTO EXISTE. A agenda já era a fonte de verdade dos pagamentos — os
 * dias 5, 10, 15, 20, 25 e 30 estão lá como eventos de dia inteiro, quase todos
 * recorrentes criados no próprio Google, e QUATRO pessoas escrevem neles (além
 * do formulário de notas externas, que cria evento com "Valor NF / Link NF PDF /
 * Data pagamento"). O que o Hub tinha era uma FOTOGRAFIA: a skill do briefing
 * gravava a agenda do dia dentro de um JSONB, uma vez por dia, em formato livre
 * de LLM. Servia para a tela do briefing e não servia para mais nada — não dava
 * para perguntar "quais pagamentos caem no dia 20?" antes do dia 20.
 *
 * Este módulo lê a agenda de verdade, e o `agenda-sync` guarda a janela numa
 * tabela. É o cache que torna possível o gerador de rotinas (que é SQL puro,
 * rodando no pg_cron) montar o checklist do dia sem falar com o Google.
 *
 * ESCOPO SOMENTE LEITURA (`calendar.readonly`), no mesmo consentimento OAuth do
 * Gmail e do Drive — ver `gmail-oauth`. O Hub não cria, não move e não apaga
 * evento nenhum: o que ele faz com a agenda é ler.
 *
 * ATENÇÃO: o escopo entrou depois do consentimento existente. Enquanto ninguém
 * reautorizar na `gmail-oauth`, o refresh token guardado vale só para os escopos
 * antigos e o Google devolve 403 aqui. É estado normal e tratado, não exceção.
 * ------------------------------------------------------------------------- */

import { segredosDoGmail, tokenDeAcesso } from "./gmail.ts";
import { EventoAgenda, lerEvento } from "./agenda-parse.ts";

/* A LEITURA do evento (dia, valor, rotulo, "isto e pagamento?") mora em
   `agenda-parse.ts`, sem nada de Deno — e por isso tem teste de verdade, rodando
   contra eventos reais desta agenda em src/lib/tarefas/agenda-parse.test.ts.
   Aqui fica so o que fala com o Google. */
export type { EventoAgenda };
export {
  descricaoEmTexto, extrairValor, formatarBRL, lerEvento, montarRotulo,
} from "./agenda-parse.ts";

const BASE = "https://www.googleapis.com/calendar/v3";

/* ---------------------------------------------------------------- API -- */

/**
 * Os eventos de uma janela, com as recorrências JÁ EXPANDIDAS.
 *
 * `singleEvents=true` é o que faz a diferença entre útil e inútil aqui: sem ele
 * o Google devolve a REGRA ("toda quinta-feira do dia 20") e caberia ao Hub
 * interpretar RRULE, incluindo as exceções de instância — que existem de verdade
 * nesta agenda ("Pró Labore" tem `originalStartTime` dia 5 e `start` dia 6,
 * porque alguém arrastou aquela ocorrência). Com ele, o Google entrega a
 * instância já no lugar certo.
 */
export async function eventosDaJanela(
  supabase: { from: (t: string) => any },
  deISO: string,
  ateISO: string,
  calendarId = "primary",
): Promise<EventoAgenda[]> {
  const token = await tokenDeAcesso(await segredosDoGmail(supabase));
  const out: EventoAgenda[] = [];
  let pageToken: string | undefined;

  do {
    const u = new URLSearchParams({
      timeMin: `${deISO}T00:00:00-03:00`,
      timeMax: `${ateISO}T23:59:59-03:00`,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
    });
    if (pageToken) u.set("pageToken", pageToken);

    const r = await fetch(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${u}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) {
      const corpo = (await r.text()).slice(0, 300);
      if (r.status === 403 && /insufficient|scope/i.test(corpo)) {
        throw new Error(
          "O consentimento do Google ainda não inclui o calendário. Abra a função gmail-oauth " +
          "e autorize de novo — o escopo calendar.readonly entrou depois do consentimento atual.",
        );
      }
      throw new Error(`Calendar API ${r.status}: ${corpo}`);
    }
    const j = await r.json();
    for (const e of (j.items ?? [])) {
      /* Evento cancelado continua vindo quando é exceção de uma recorrência. */
      if (e?.status === "cancelled") continue;
      const lido = lerEvento(e);
      if (lido) out.push(lido);
    }
    pageToken = j.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}
