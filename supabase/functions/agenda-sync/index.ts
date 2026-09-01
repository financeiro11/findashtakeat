// Edge Function: agenda-sync
//
// Espelha uma JANELA do Google Calendar de `financeiro@takeat.app` na tabela
// `agenda_eventos`.
//
// POR QUE UM ESPELHO, e não uma leitura ao vivo: quem monta o checklist da
// rotina do dia é o gerador `public.tarefas_rotinas_gerar`, que é SQL puro
// rodando no pg_cron. SQL não fala com o Google. O espelho é o que permite a
// pergunta "quais pagamentos caem no dia 20?" ser respondida por um SELECT — no
// dia 20 e, o que importa mais, ANTES dele: com antecedência de 3 dias, a tarefa
// do dia 20 nasce no dia 17 já com os nove pagamentos listados.
//
// A JANELA é generosa (padrão hoje−1 até hoje+45) por dois motivos: a
// antecedência de uma rotina vai até 30 dias, e a prévia da tela mostra as três
// próximas ocorrências. Custa uma chamada ao Google — a API devolve 2500 eventos
// por página e esta agenda tem ~60 por mês.
//
// Ações (body.action):
//   "sync" (default) → relê a janela e reescreve o espelho dela.
//   "status"         → o que já está no espelho, sem chamar o Google.
// Parâmetros: `de` / `ate` (YYYY-MM-DD), `calendario` (padrão "primary").

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { eventosDaJanela } from "../_shared/agenda.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** YYYY-MM-DD de hoje no fuso de Brasília — a agenda é lida em dias, não em instantes. */
function hojeBRT(): string {
  const agora = new Date();
  const brt = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${brt.getFullYear()}-${p(brt.getMonth() + 1)}-${p(brt.getDate())}`;
}

function somaDias(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const dt = new Date(a, m - 1, d + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** O portão do cron: `x-cron-token` conferido contra `internal_cron_tokens`. */
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "agenda-sync").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (!(await chamadaDeCron(req, supa))) {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 401);
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const acao = String(body.action ?? "sync");
    const hoje = hojeBRT();
    const de = String(body.de ?? somaDias(hoje, -1));
    const ate = String(body.ate ?? somaDias(hoje, 45));

    if (acao === "status") {
      const { data, error } = await supa
        .from("agenda_eventos")
        .select("dia, eh_pagamento")
        .gte("dia", de).lte("dia", ate);
      if (error) throw error;
      const linhas = data ?? [];
      return json({
        ok: true, de, ate,
        eventos: linhas.length,
        pagamentos: linhas.filter((r: { eh_pagamento: boolean }) => r.eh_pagamento).length,
        dias_com_pagamento: [...new Set(linhas.filter((r: any) => r.eh_pagamento).map((r: any) => r.dia))].sort(),
      });
    }

    const eventos = await eventosDaJanela(supa, de, ate, String(body.calendario ?? "primary"));

    /* Reescreve a janela inteira em vez de casar diferença a diferença. O
       evento APAGADO no Google não volta na resposta — sem o apagar aqui, um
       pagamento cancelado continuaria virando subtarefa para sempre. Apagar só
       a janela relida (e não a tabela) preserva o histórico fora dela. */
    const { error: errDel } = await supa
      .from("agenda_eventos").delete().gte("dia", de).lte("dia", ate);
    if (errDel) throw errDel;

    const linhas = eventos.map((e) => ({
      event_id: e.eventId,
      dia: e.dia,
      dia_inteiro: e.diaInteiro,
      titulo: e.titulo,
      descricao: e.descricao || null,
      cor: e.cor,
      link: e.link,
      valor: e.valor,
      eh_pagamento: e.ehPagamento,
      rotulo: e.rotulo,
    }));

    /* Em lotes: a agenda de 45 dias cabe folgada, mas um `insert` de milhares de
       linhas numa tacada é o tipo de coisa que estoura sem aviso claro. */
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await supa.from("agenda_eventos").insert(linhas.slice(i, i + 500));
      if (error) throw error;
    }

    const pagamentos = linhas.filter((l) => l.eh_pagamento);
    return json({
      ok: true, de, ate,
      eventos: linhas.length,
      pagamentos: pagamentos.length,
      dias_com_pagamento: [...new Set(pagamentos.map((l) => l.dia))].sort(),
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
