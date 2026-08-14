// Recebe os eventos de recarga vindos do TakeatOS.
//
// Dois eventos entram por aqui:
//   linha.sincronizada  → alguém cadastrou/editou um celular no TakeatOS. Cria ou
//                         atualiza a linha em recargas_celulares.
//   recarga.solicitada  → um colaborador pediu recarga. Entra na fila
//                         (recargas_celulares_solicitacoes) na ordem em que chegou.
//
// Duas coisas mandam no desenho:
//   1. Autenticação real — a função roda com verify_jwt = false, então quem prova a
//      origem é a assinatura HMAC do corpo, não o gateway.
//   2. Idempotência — o TakeatOS reenvia sozinho o que não entrar, e reenvio não pode
//      duplicar linha nem card na fila do Financeiro.
//
// Secrets (Supabase › Edge Functions › Secrets):
//   RECARGAS_WEBHOOK_SECRET   mesmo valor de FINANCEIRO_WEBHOOK_SECRET no TakeatOS
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injetados pela plataforma)

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

// HMAC-SHA256 do corpo bruto, "sha256=<hex>" — igual ao que o TakeatOS gera em
// api/_lib/recargaWebhook.js.
async function assinar(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// Comparar com === vazaria o segredo pelo tempo de resposta, um caractere por vez.
function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ORIGEM = "takeatos";

type PayloadLinha = {
  evento: "linha.sincronizada";
  linha: {
    id: string;
    colaborador?: string | null;
    numero?: string | null;
    operadora?: string | null;
    setor?: string | null;
    valor?: number | null;
    verificado?: boolean | null;
    ultima_recarga?: string | null;
  };
  removida?: boolean;
};

type PayloadSolicitacao = {
  evento: "recarga.solicitada";
  id: string;
  solicitado_em?: string;
  fila?: { posicao_do_dia?: number | null; limite_diario?: number | null };
  colaborador?: { id?: string | null; nome?: string | null; email?: string | null };
  solicitante?: { nome?: string | null };
  linha?: {
    id?: string | null;
    numero?: string | null;
    operadora?: string | null;
    setor?: string | null;
    valor?: number | null;
  };
  callback_url?: string | null;
};

// ── linha.sincronizada ──────────────────────────────────────────────────────
async function sincronizarLinha(supabase: SupabaseClient, p: PayloadLinha) {
  const l = p.linha;
  if (!l?.id) return json({ error: "linha.id é obrigatório" }, 400);

  // Remoção no TakeatOS não apaga o histórico daqui: a linha só sai de operação.
  if (p.removida) {
    const { error } = await supabase
      .from("recargas_celulares")
      .update({ situacao: "Descartado" })
      .eq("origem", ORIGEM)
      .eq("origem_id", l.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, acao: "descartada" });
  }

  const registro: Record<string, unknown> = {
    origem: ORIGEM,
    origem_id: l.id,
    proprietario: l.colaborador || "(sem nome)",
    numero: l.numero ?? null,
    setor: l.setor ?? null,
    valor: Number(l.valor ?? 0),
  };
  if (l.verificado != null) registro.verificado = l.verificado ? "Sim" : "Não";
  if (l.ultima_recarga) registro.ultima_recarga = l.ultima_recarga;

  // `situacao` só é definida na CRIAÇÃO. O estado do chip (Ativo/Suspenso/Descartado)
  // é gerido aqui, e o TakeatOS não sabe dele — reenviar não pode reativar um chip
  // que o Financeiro suspendeu.
  const { data: existente } = await supabase
    .from("recargas_celulares")
    .select("id")
    .eq("origem", ORIGEM)
    .eq("origem_id", l.id)
    .maybeSingle();

  // Sem vínculo pelo id, o mesmo chip pode já existir aqui cadastrado à mão — os
  // sistemas gravam "(27) 99830-1143" e "27998301143" para o mesmo número, então o
  // casamento é pelos 8 dígitos finais. Adotar o registro existente (e carimbar o
  // vínculo) é o que impede o celular de aparecer duas vezes; foi exatamente assim
  // que Arthur, Brittes e Julia viraram duplicata na primeira sincronização.
  let adotada: string | null = existente?.id ?? null;
  if (!adotada && l.numero) {
    const digitos = String(l.numero).replace(/\D/g, "").slice(-8);
    if (digitos.length === 8) {
      const { data: todas } = await supabase
        .from("recargas_celulares")
        .select("id, numero, situacao")
        .is("origem", null);
      adotada =
        (todas || []).find(
          (x) =>
            x.situacao !== "Descartado" &&
            String(x.numero || "").replace(/\D/g, "").endsWith(digitos),
        )?.id ?? null;
    }
  }

  if (!existente && !adotada) registro.situacao = "Ativo";

  const { data, error } = adotada
    ? await supabase
        .from("recargas_celulares")
        .update(registro)
        .eq("id", adotada)
        .select("id")
        .single()
    : await supabase
        .from("recargas_celulares")
        .upsert(registro, { onConflict: "origem,origem_id" })
        .select("id")
        .single();
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, acao: existente || adotada ? "atualizada" : "criada", card_id: data.id });
}

// ── recarga.solicitada ──────────────────────────────────────────────────────
async function registrarSolicitacao(supabase: SupabaseClient, p: PayloadSolicitacao) {
  if (!p.id) return json({ error: "id da solicitação é obrigatório" }, 400);
  const colaborador = p.colaborador?.nome;
  if (!colaborador) return json({ error: "colaborador é obrigatório" }, 400);

  const linha = p.linha || {};
  const registro = {
    origem: ORIGEM,
    origem_id: String(p.id),
    colaborador,
    colaborador_email: p.colaborador?.email ?? null,
    solicitante: p.solicitante?.nome ?? null,
    numero: linha.numero ?? null,
    operadora: linha.operadora ?? null,
    setor: linha.setor ?? null,
    valor: Number(linha.valor ?? 0),
    solicitado_em: p.solicitado_em ?? new Date().toISOString(),
    posicao_do_dia: p.fila?.posicao_do_dia ?? null,
    limite_diario: p.fila?.limite_diario ?? null,
    callback_url: p.callback_url ?? null,
  };

  // `status` fica FORA do upsert de propósito: se o Financeiro já concluiu aqui,
  // um reenvio do TakeatOS não pode reabrir o card.
  const { data, error } = await supabase
    .from("recargas_celulares_solicitacoes")
    .upsert(registro, { onConflict: "origem,origem_id" })
    .select("id, status")
    .single();
  if (error) return json({ error: error.message }, 500);

  // Espelha a data do pedido na linha cadastrada, para o card mostrar "Solicitada".
  // Casa pelo id de origem; sem ele, pelos DÍGITOS do número (os dois sistemas
  // formatam diferente: "(27) 99830-1143" x "27998301143").
  try {
    let alvoId: string | null = null;
    if (linha.id) {
      const { data: porOrigem } = await supabase
        .from("recargas_celulares")
        .select("id")
        .eq("origem", ORIGEM)
        .eq("origem_id", linha.id)
        .maybeSingle();
      alvoId = porOrigem?.id ?? null;
    }
    if (!alvoId && linha.numero) {
      const digitos = String(linha.numero).replace(/\D/g, "").slice(-8);
      const { data: todas } = await supabase.from("recargas_celulares").select("id, numero");
      alvoId =
        (todas || []).find((x) => String(x.numero || "").replace(/\D/g, "").endsWith(digitos))?.id ??
        null;
    }
    if (alvoId) {
      await supabase
        .from("recargas_celulares")
        .update({ solicitado_em: registro.solicitado_em })
        .eq("id", alvoId);
    }
  } catch (e) {
    // A fila já tem o card; o espelho na linha é conveniência e não derruba o evento.
    console.warn("[recargas-takeatos-webhook] espelho falhou", (e as Error)?.message);
  }

  return json({ ok: true, acao: "enfileirada", card_id: data.id, status: data.status });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = Deno.env.get("RECARGAS_WEBHOOK_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // Sem segredo a função fica FECHADA: aceitar sem validar deixaria qualquer um na
  // internet cadastrar linha e criar card na fila do Financeiro.
  if (!secret) return json({ error: "RECARGAS_WEBHOOK_SECRET não configurado" }, 500);
  if (!url || !serviceKey) return json({ error: "missing env" }, 500);

  // Corpo BRUTO: reserializar o JSON muda bytes e a assinatura deixa de bater.
  const rawBody = await req.text();
  const recebida = req.headers.get("x-takeat-signature") || "";
  if (!iguaisEmTempoConstante(recebida, await assinar(rawBody, secret))) {
    return json({ error: "assinatura inválida" }, 401);
  }

  let payload: PayloadLinha | PayloadSolicitacao;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "corpo não é JSON válido" }, 400);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  switch (payload.evento) {
    case "linha.sincronizada":
      return sincronizarLinha(supabase, payload as PayloadLinha);
    case "recarga.solicitada":
      return registrarSolicitacao(supabase, payload as PayloadSolicitacao);
    default:
      return json({ error: `evento desconhecido: ${(payload as { evento?: string }).evento}` }, 400);
  }
});
