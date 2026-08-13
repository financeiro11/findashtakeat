// Fecha o ciclo: marca a solicitação como concluída e avisa o TakeatOS.
//
// Quem clica em "feita" é o Financeiro, no navegador — e o segredo do callback não
// pode viver lá. Por isso a chamada de volta sai daqui, server-side.
//
// Sem esta função o pedido do colaborador ficaria "Pendente" para sempre no TakeatOS
// mesmo depois de atendido, que é exatamente a desorganização que o fluxo veio acabar.
//
// Secrets (Supabase › Edge Functions › Secrets):
//   FINANCEIRO_CALLBACK_SECRET  mesmo valor da env de mesmo nome no TakeatOS
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injetados pela plataforma)
//
// Body: { linha_id?: uuid, solicitacao_id?: uuid, status: "Concluída" | "Pendente" }
// Auth: JWT do usuário logado (o gateway já exige, verify_jwt fica no padrão).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Solicitacao = {
  id: string;
  origem: string | null;
  origem_id: string | null;
  callback_url: string | null;
  status: string;
};

// Avisa o TakeatOS. Nunca lança: a conclusão aqui já está gravada, e uma falha de rede
// não pode desfazê-la — vira estado (callback_status) para diagnóstico e reenvio.
async function avisarOrigem(s: Solicitacao, novoStatus: string) {
  const segredo = Deno.env.get("FINANCEIRO_CALLBACK_SECRET");
  if (!s.callback_url) return { ok: false, motivo: "sem_callback_url" };
  if (!segredo) return { ok: false, motivo: "FINANCEIRO_CALLBACK_SECRET não configurado" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(s.callback_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Takeat-Secret": segredo,
      },
      // O id que o TakeatOS conhece é o DELE (origem_id), não o nosso.
      body: JSON.stringify({ id: s.origem_id, status: novoStatus, card_id: s.id }),
      signal: ctrl.signal,
    });
    const texto = await r.text().catch(() => "");
    if (!r.ok) return { ok: false, motivo: `http_${r.status}${texto ? ": " + texto.slice(0, 200) : ""}` };
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    return { ok: false, motivo: err?.name === "AbortError" ? "timeout" : err?.message || "erro" };
  } finally {
    clearTimeout(timer);
  }
}

// A solicitação em aberto daquela linha. Casa por origem_id quando a linha veio do
// TakeatOS; senão pelos DÍGITOS do número, porque os dois sistemas formatam diferente.
async function acharSolicitacao(
  supabase: SupabaseClient,
  linhaId: string,
): Promise<Solicitacao | null> {
  const { data: linha } = await supabase
    .from("recargas_celulares")
    .select("origem_id, numero")
    .eq("id", linhaId)
    .maybeSingle();
  if (!linha) return null;

  const { data: abertas } = await supabase
    .from("recargas_celulares_solicitacoes")
    .select("id, origem, origem_id, callback_url, status, numero")
    .eq("status", "Pendente")
    .order("solicitado_em", { ascending: true });

  const lista = (abertas || []) as (Solicitacao & { numero: string | null })[];
  if (!lista.length) return null;

  const digitos = String(linha.numero || "").replace(/\D/g, "").slice(-8);
  // A mais antiga primeiro: a fila é atendida por ordem de pedido.
  return (
    lista.find((x) => digitos && String(x.numero || "").replace(/\D/g, "").endsWith(digitos)) || null
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "missing env" }, 500);

  const { linha_id, solicitacao_id, status } = await req.json().catch(() => ({}));
  const novoStatus = status === "Pendente" ? "Pendente" : "Concluída";
  if (!linha_id && !solicitacao_id) {
    return json({ error: "linha_id ou solicitacao_id é obrigatório" }, 400);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  let solicitacao: Solicitacao | null = null;
  if (solicitacao_id) {
    const { data } = await supabase
      .from("recargas_celulares_solicitacoes")
      .select("id, origem, origem_id, callback_url, status")
      .eq("id", solicitacao_id)
      .maybeSingle();
    solicitacao = (data as Solicitacao) ?? null;
  } else {
    solicitacao = await acharSolicitacao(supabase, linha_id);
  }

  // Linha recarregada sem pedido formal (o Financeiro adiantou) não é erro: só não há
  // ninguém para avisar.
  if (!solicitacao) return json({ ok: true, avisado: false, motivo: "sem_solicitacao_aberta" });

  const agora = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("recargas_celulares_solicitacoes")
    .update({
      status: novoStatus,
      concluido_em: novoStatus === "Concluída" ? agora : null,
    })
    .eq("id", solicitacao.id);
  if (upErr) return json({ error: upErr.message }, 500);

  const aviso = await avisarOrigem(solicitacao, novoStatus);

  await supabase
    .from("recargas_celulares_solicitacoes")
    .update({
      callback_status: aviso.ok ? "sent" : "failed",
      callback_erro: aviso.ok ? null : String(aviso.motivo).slice(0, 500),
      callback_em: agora,
    })
    .eq("id", solicitacao.id);

  return json({
    ok: true,
    solicitacao_id: solicitacao.id,
    status: novoStatus,
    avisado: aviso.ok,
    motivo: aviso.ok ? undefined : aviso.motivo,
  });
});
