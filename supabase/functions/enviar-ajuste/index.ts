import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { id_unico, mensagem_final, telefone, enviado_por } = await req.json();
    if (!id_unico || !mensagem_final || !telefone) {
      return new Response(JSON.stringify({ error: "Parâmetros ausentes" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Carrega lançamento
    const { data: row, error: errSel } = await supabase
      .from("auditoria")
      .select("id, status, trilha")
      .eq("id_unico", id_unico)
      .maybeSingle();
    if (errSel || !row) throw new Error(errSel?.message || "Lançamento não encontrado");

    const trilha = Array.isArray(row.trilha) ? row.trilha : [];
    const novaTrilha = [
      ...trilha,
      {
        em: new Date().toISOString(),
        por: enviado_por || "sistema",
        de: row.status,
        para: "Ajuste solicitado",
        tipo: "whatsapp",
        comentario: `Mensagem enviada para ${telefone}: ${mensagem_final.slice(0, 500)}`,
      },
    ];

    const { error: errUpd } = await supabase
      .from("auditoria")
      .update({ status: "Ajuste solicitado", trilha: novaTrilha })
      .eq("id", row.id);
    if (errUpd) throw new Error(errUpd.message);

    // TODO: integrar provider real de WhatsApp aqui.
    // Por ora, apenas registra o envio no log da função.
    console.log("[enviar-ajuste]", { id_unico, telefone, enviado_por });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
