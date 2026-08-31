// Manda a mensagem de ajuste ao responsável e carimba a trilha do lançamento.
//
// FECHADA EM 30/08/2026. Rodava com a service role e sem checagem nenhuma:
// qualquer pessoa com a chave pública do bundle disparava mensagem em nome da
// Takeat, para um telefone escolhido por ela, e ainda escrevia na trilha de
// auditoria com o `enviado_por` que quisesse. Mensagem que sai não se desfaz, e
// trilha de auditoria adulterada estraga justamente o registro que serve para
// conferir o resto.
//
// A versão do supabase-js é FIXA: com `@2` solto o bundler do Deno resolve a
// última do dia e já quebrou deploy neste projeto. 2.45.0 é a das outras.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // PORTÃO: antes de ler o corpo. Ver o cabeçalho.
    await requireUser(req, { bloquearCargos: ["parcerias"] });

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
    const msg = (e as Error).message;
    // 401 quando o problema e QUEM chamou, e nao o que foi pedido: a recusa do
    // portao precisa se ler como tentativa de acesso no log, nao como bug nosso.
    return new Response(JSON.stringify({ error: msg }), {
      status: /autenticad|permiss/i.test(msg) ? 401 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
