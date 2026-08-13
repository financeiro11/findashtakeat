// Recebe as solicitações de recarga de celular vindas do TakeatOS e vira card na
// aba Recargas › Celulares.
//
// O TakeatOS grava o pedido do lado dele ANTES de chamar aqui e reenvia sozinho o que
// não entrar (cron de 15 min). Por isso duas coisas importam nesta função:
//   1. autenticar de verdade — ela roda com verify_jwt = false, então quem prova a
//      origem é a assinatura HMAC do corpo, não o gateway;
//   2. ser idempotente — o mesmo pedido pode chegar várias vezes e não pode duplicar
//      card na fila do Financeiro.
//
// Secrets (Supabase › Edge Functions › Secrets):
//   RECARGAS_WEBHOOK_SECRET   mesmo valor de FINANCEIRO_WEBHOOK_SECRET no TakeatOS
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injetados pela plataforma)

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// HMAC-SHA256 do corpo bruto, no formato "sha256=<hex>" — igual ao que o TakeatOS
// gera em api/_lib/recargaWebhook.js.
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

// Comparação em tempo constante: comparar com === vazaria o segredo pelo tempo de
// resposta, um caractere por vez.
function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Payload = {
  evento?: string;
  id?: string;
  solicitado_em?: string;
  status?: string;
  fila?: { posicao_do_dia?: number | null; limite_diario?: number | null };
  colaborador?: { id?: string | null; nome?: string | null; email?: string | null };
  solicitante?: { nome?: string | null };
  linha?: {
    numero?: string | null;
    operadora?: string | null;
    setor?: string | null;
    valor?: number | null;
  };
  callback_url?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = Deno.env.get("RECARGAS_WEBHOOK_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // Sem segredo a função fica FECHADA. Aceitar sem validar deixaria qualquer um na
  // internet criar card na fila do Financeiro.
  if (!secret) return json({ error: "RECARGAS_WEBHOOK_SECRET não configurado" }, 500);
  if (!url || !serviceKey) return json({ error: "missing env" }, 500);

  // Precisa ser o corpo BRUTO: reserializar o JSON muda bytes (ordem, espaços) e a
  // assinatura deixa de bater.
  const rawBody = await req.text();
  const recebida = req.headers.get("x-takeat-signature") || "";
  const esperada = await assinar(rawBody, secret);
  if (!iguaisEmTempoConstante(recebida, esperada)) {
    return json({ error: "assinatura inválida" }, 401);
  }

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "corpo não é JSON válido" }, 400);
  }

  if (!payload.id) return json({ error: "id da solicitação é obrigatório" }, 400);
  if (!payload.colaborador?.nome) return json({ error: "colaborador é obrigatório" }, 400);

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const linha = payload.linha || {};
  const registro = {
    origem: "takeatos",
    origem_id: String(payload.id),
    colaborador: payload.colaborador.nome,
    colaborador_email: payload.colaborador.email ?? null,
    solicitante: payload.solicitante?.nome ?? null,
    numero: linha.numero ?? null,
    operadora: linha.operadora ?? null,
    setor: linha.setor ?? null,
    valor: Number(linha.valor ?? 0),
    solicitado_em: payload.solicitado_em ?? new Date().toISOString(),
    posicao_do_dia: payload.fila?.posicao_do_dia ?? null,
    limite_diario: payload.fila?.limite_diario ?? null,
    callback_url: payload.callback_url ?? null,
  };

  // onConflict em (origem, origem_id): reenvio atualiza o card existente em vez de
  // criar outro. O `status` fica DE FORA do upsert de propósito — se o Financeiro já
  // concluiu aqui, um reenvio do TakeatOS não pode reabrir o card.
  const { data, error } = await supabase
    .from("recargas_celulares_solicitacoes")
    .upsert(registro, { onConflict: "origem,origem_id" })
    .select("id, status")
    .single();

  if (error) {
    console.error("[recargas-solicitacao-receber]", error.message);
    return json({ error: error.message }, 500);
  }

  // Espelha a data do pedido na linha cadastrada, para o card de Recargas › Celulares
  // mostrar "Solicitado em ..." sem precisar de subquery a cada render.
  //
  // O casamento é pelos DÍGITOS do número: os dois sistemas formatam diferente
  // ("(27) 99830-1143" x "27998301143") e comparar a string crua nunca casaria.
  // Sem número, cai no nome do proprietário. Se nada casar, seguimos em frente —
  // o card na fila de solicitações é o que importa, o espelho é conveniência.
  const digitos = (registro.numero || "").replace(/\D/g, "");
  try {
    const { data: linhas } = await supabase
      .from("recargas_celulares")
      .select("id, numero, proprietario");
    const alvo = (linhas || []).find((l) => {
      const d = String(l.numero || "").replace(/\D/g, "");
      if (digitos && d) return d.endsWith(digitos.slice(-8)) || digitos.endsWith(d.slice(-8));
      return (
        String(l.proprietario || "").trim().toLowerCase() ===
        registro.colaborador.trim().toLowerCase()
      );
    });
    if (alvo) {
      await supabase
        .from("recargas_celulares")
        .update({ solicitado_em: registro.solicitado_em })
        .eq("id", alvo.id);
    }
  } catch (e) {
    console.warn("[recargas-solicitacao-receber] espelho falhou", (e as Error)?.message);
  }

  // O TakeatOS guarda o card_id para fechar o rastro entre os dois sistemas.
  return json({ ok: true, card_id: data.id, status: data.status });
});
