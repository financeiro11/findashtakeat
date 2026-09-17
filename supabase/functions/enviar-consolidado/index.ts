// Manda por WhatsApp a mensagem consolidada de justificativas da Auditoria
// (botão "Solicitar justificativas" → "Enviar WhatsApp").
//
// RECRIADA EM 17/09/2026. A versão original foi feita fora do repositório e
// apagada do projeto em 31/08/2026 para abrir vaga no limite de funções
// (commit a7fa695) — o botão passou a responder "Failed to send a request to
// the Edge Function" e ninguém recebeu cobrança desde então. O código antigo
// não existe mais; o que se sabe dele vem dos rastros:
//   • o segredo `N8N_WEBHOOK_AUDITORIA` nasceu no mesmo dia do botão (09/07) e
//     nada mais no repo o lê — era o destino do POST;
//   • os links de 18/08 foram abertos tanto com telefone "+5527…" quanto com
//     "27…" (sem DDI), então o fluxo do n8n aceita os dois formatos.
// Por isso o corpo repassa os mesmos campos que a tela sempre mandou, e o
// telefone vai no formato "+55…" que funcionou na maioria dos envios.
//
// O TELEFONE TEM DE SER O DO LINK. A tela chama `criar_token_e_registrar`
// antes, que grava `enviado_para`. Conferir aqui impede que alguém com sessão
// dispare mensagem em nome da Takeat para um número escolhido à mão — mensagem
// que sai não se desfaz.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser, AuthError } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRAZO_MS = 20_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Só dígitos, com DDI. Recusa o que não fecha 55 + DDD + 8/9 dígitos. */
function telefoneComDdi(t: string): string | null {
  let d = String(t ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (!d.startsWith("55") || d.length < 12 || d.length > 13) return null;
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireUser(req);
    if (!caller.pode("conciliacao")) {
      throw new AuthError("Você não tem permissão para esta ação.");
    }

    const { token, telefone, mensagem_final, id_unicos, enviado_por } = await req.json();
    if (!token || !telefone || !mensagem_final?.trim()) {
      return json({ error: "Parâmetros ausentes" }, 400);
    }

    const digitos = telefoneComDdi(telefone);
    if (!digitos) return json({ error: `Telefone inválido: ${telefone}` });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: link } = await supabase
      .from("magic_tokens").select("responsavel, enviado_para").eq("token", token).maybeSingle();
    if (!link) return json({ error: "Link não encontrado — gere a mensagem de novo." });
    if (telefoneComDdi(link.enviado_para ?? "") !== digitos) {
      return json({ error: "O telefone não confere com o do link gerado." });
    }

    const webhook = Deno.env.get("N8N_WEBHOOK_AUDITORIA");
    if (!webhook || !/^https?:\/\//.test(webhook)) {
      return json({ error: "N8N_WEBHOOK_AUDITORIA não está configurada — nada foi enviado." });
    }

    const corte = new AbortController();
    const relogio = setTimeout(() => corte.abort(), PRAZO_MS);
    let r: Response;
    try {
      r = await fetch(webhook, {
        method: "POST",
        signal: corte.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          telefone: `+${digitos}`,
          mensagem_final,
          mensagem: mensagem_final,
          id_unicos: Array.isArray(id_unicos) ? id_unicos : [],
          responsavel: link.responsavel,
          enviado_por: enviado_por ?? caller.email ?? null,
          origem: "auditoria-consolidado",
        }),
      });
    } catch (e) {
      return json({
        error: corte.signal.aborted
          ? `O n8n não respondeu em ${PRAZO_MS / 1000}s`
          : `Falha ao chamar o n8n: ${(e as Error).message}`,
      });
    } finally {
      clearTimeout(relogio);
    }

    const corpo = (await r.text().catch(() => "")).slice(0, 300);
    console.log("[enviar-consolidado]", { token, telefone: digitos, status: r.status, corpo });
    // A falha volta com 200 e `error`: com status não-2xx o supabase-js descarta
    // o corpo e a tela só mostraria "non-2xx status code".
    if (!r.ok) return json({ error: `O n8n recusou o envio (${r.status}): ${corpo}` });

    return json({ ok: true, enviados: Array.isArray(id_unicos) ? id_unicos.length : 0 });
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg }, e instanceof AuthError ? 401 : 500);
  }
});
