import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const N8N_URL = "https://webhook.takeat.cloud/webhook/financeiroSistema";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const form = await req.formData();
    const nome = String(form.get("nome") ?? "").trim();
    const tipo = String(form.get("tipo") ?? "").trim();
    const arquivo = form.get("arquivo");

    if (!nome || nome.length > 200) {
      return new Response(JSON.stringify({ error: "Nome inválido (1–200 caracteres)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (tipo !== "cartao" && tipo !== "conta") {
      return new Response(JSON.stringify({ error: "Tipo deve ser 'cartao' ou 'conta'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!(arquivo instanceof File) || arquivo.size === 0) {
      return new Response(JSON.stringify({ error: "Arquivo obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (arquivo.size > 20 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Arquivo excede 20MB" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Forward to n8n
    const fwd = new FormData();
    fwd.append("nome", nome);
    fwd.append("tipo", tipo);
    fwd.append("arquivo", arquivo, arquivo.name);

    let n8nStatus = 0;
    let n8nBody = "";
    let status = "enviado";
    try {
      const r = await fetch(N8N_URL, { method: "POST", body: fwd });
      n8nStatus = r.status;
      n8nBody = (await r.text()).slice(0, 4000);
      if (!r.ok) status = "erro";
    } catch (e) {
      status = "erro";
      n8nBody = e instanceof Error ? e.message : String(e);
    }

    // Log (best effort)
    await supabase.from("extratos_importados").insert({
      user_id: userId,
      nome,
      tipo,
      filename: arquivo.name,
      status,
      n8n_status: n8nStatus || null,
      n8n_response: n8nBody,
    });

    return new Response(JSON.stringify({ ok: status === "enviado", status, n8n_status: n8nStatus, n8n_response: n8nBody }), {
      status: status === "enviado" ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
