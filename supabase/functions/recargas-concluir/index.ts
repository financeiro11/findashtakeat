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
// Body: { linha_id?: uuid, solicitacao_id?: uuid, status: "Concluída" | "Pendente" | "Cancelada" }
// Auth: JWT do usuário logado (o gateway já exige, verify_jwt fica no padrão).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
// CORS inline, como em create-user e admin-reset-password: a funcao e publicada
// isolada, e depender de ../_shared/ acopla o deploy ao resto da pasta.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  numero?: string | null;
  colaborador?: string | null;
  operadora?: string | null;
  valor?: number | null;
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
    .select("id, origem, origem_id, callback_url, status, numero, colaborador, operadora, valor")
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
  // Três estados, não dois: cancelar é diferente de voltar para pendente. Antes
  // qualquer coisa que não fosse "Pendente" virava "Concluída", então um cancelamento
  // chegava aqui como conclusão.
  const novoStatus =
    status === "Pendente" ? "Pendente" : status === "Cancelada" ? "Cancelada" : "Concluída";
  if (!linha_id && !solicitacao_id) {
    return json({ error: "linha_id ou solicitacao_id é obrigatório" }, 400);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  let solicitacao: Solicitacao | null = null;
  if (solicitacao_id) {
    const { data } = await supabase
      .from("recargas_celulares_solicitacoes")
      .select("id, origem, origem_id, callback_url, status, numero, colaborador, operadora, valor")
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

  // A recarga acompanha o pedido nos DOIS sentidos. Concluir registra; reverter desfaz.
  // Sem o segundo, a linha continuaria dizendo que foi recarregada e o histórico teria
  // uma entrada de uma recarga que não aconteceu — o gasto apareceria em relatório.
  try {
    const { data: linhas } = await supabase
      .from("recargas_celulares")
      .select("id, numero, proprietario, valor");
    const digitos = String(solicitacao.numero || "").replace(/\D/g, "").slice(-8);
    const alvo = digitos
      ? (linhas || []).find((l) => String(l.numero || "").replace(/\D/g, "").endsWith(digitos))
      : null;

    if (alvo) {
      if (novoStatus === "Concluída") {
        const hoje = agora.slice(0, 10);
        await supabase.from("recargas_celulares").update({ ultima_recarga: hoje }).eq("id", alvo.id);

        // Não duplica se a mesma linha já tiver recarga registrada hoje.
        const { data: jaTem } = await supabase
          .from("recargas_celulares_historico")
          .select("id")
          .eq("linha_id", alvo.id)
          .eq("recarregado_em", hoje)
          .maybeSingle();

        if (!jaTem) {
          await supabase.from("recargas_celulares_historico").insert({
            linha_id: alvo.id,
            colaborador: solicitacao.colaborador ?? alvo.proprietario,
            numero: solicitacao.numero ?? alvo.numero,
            operadora: solicitacao.operadora ?? null,
            valor: Number(solicitacao.valor ?? alvo.valor ?? 0),
            recarregado_em: hoje,
            solicitacao_id: solicitacao.id,
          });
        }
      } else {
        // Apaga só a entrada deste pedido — recargas anteriores da linha ficam.
        await supabase
          .from("recargas_celulares_historico")
          .delete()
          .eq("solicitacao_id", solicitacao.id);

        // A data volta a ser a da recarga anterior, se houver; senão fica vazia.
        const { data: anterior } = await supabase
          .from("recargas_celulares_historico")
          .select("recarregado_em")
          .eq("linha_id", alvo.id)
          .order("recarregado_em", { ascending: false })
          .limit(1)
          .maybeSingle();

        await supabase
          .from("recargas_celulares")
          .update({ ultima_recarga: anterior?.recarregado_em ?? null })
          .eq("id", alvo.id);
      }
    }
  } catch (e) {
    // O status do pedido já está gravado; o registro na linha é conveniência.
    console.warn("[recargas-concluir] registro na linha falhou", (e as Error)?.message);
  }

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
