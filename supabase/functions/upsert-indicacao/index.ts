import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const toDate = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/[R$\s]/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("N8N_SECRET");
  if (!secret) return json({ error: "Server misconfigured" }, 500);
  if (req.headers.get("x-webhook-secret") !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const id_negocio = body?.id_negocio != null ? String(body.id_negocio).trim() : "";
  if (!id_negocio) return json({ error: "id_negocio é obrigatório" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Campos que o n8n pode enviar (responsavel_takeat e observacoes NUNCA são sobrescritos)
  const payload: Record<string, unknown> = {
    id_negocio,
    id_campanha: body.id_campanha ?? null,
    nome_campanha: body.nome_campanha ?? null,
    indicador: body.indicador ?? null,
    email_indicador: body.email_indicador ?? null,
    vendedor: body.vendedor ?? null,
    codigo_indicacao: body.codigo_indicacao ?? null,
    nome_negocio: body.nome_negocio ?? null,
    mrr: toNum(body.mrr),
    valor_total: toNum(body.valor_total),
    data_indicacao: toDate(body.data_indicacao),
    data_venda: toDate(body.data_venda),
    canal_aquisicao: body.canal_aquisicao ?? null,
    origem: body.origem ?? null,
    hubspot_url: body.hubspot_url ?? null,
    asaas_url: body.asaas_url ?? null,
    synced_at: new Date().toISOString(),
  };

  // Verifica existência
  const { data: existing, error: selErr } = await supabase
    .from("parceiros_indicacoes")
    .select("id")
    .eq("id_negocio", id_negocio)
    .maybeSingle();

  if (selErr) return json({ error: selErr.message }, 500);

  if (existing) {
    // Registro já existe: NÃO atualizamos nada para preservar edições feitas no front.
    return json({ ok: true, action: "skipped", reason: "already_exists", id: existing.id });
  }

  const { data, error } = await supabase
    .from("parceiros_indicacoes")
    .insert(payload)
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, action: "inserted", data });
});
