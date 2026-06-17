import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new Error("Método não permitido");

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) throw new Error("Acesso não autorizado");

    const { user_id, email } = await req.json();
    const targetEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!user_id && !targetEmail) throw new Error("Informe o usuário a ser excluído");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller.user) throw new Error("Acesso não autorizado");

    let uid = user_id as string | undefined;
    if (!uid && targetEmail) {
      const { data: prof, error: profileLookupError } = await admin
        .from("profiles")
        .select("user_id")
        .ilike("email", targetEmail)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      uid = prof?.user_id;
    }
    if (!uid) throw new Error("Usuário não encontrado");

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr && !delErr.message.toLowerCase().includes("not found")) throw delErr;

    const { error: profileDeleteError } = await admin.from("profiles").delete().eq("user_id", uid);
    if (profileDeleteError) throw profileDeleteError;

    if (targetEmail) {
      const { error: duplicateProfileDeleteError } = await admin.from("profiles").delete().ilike("email", targetEmail);
      if (duplicateProfileDeleteError) throw duplicateProfileDeleteError;
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
