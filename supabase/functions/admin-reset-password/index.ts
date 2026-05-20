import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SECRET_CODE = "2122";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, secret, password } = await req.json();
    if (!email || !secret || !password) throw new Error("Dados incompletos");
    if (String(secret).trim() !== SECRET_CODE) throw new Error("Código secreto inválido");
    if (String(password).length < 6) throw new Error("Senha deve ter ao menos 6 caracteres");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const target = String(email).trim().toLowerCase();

    // 1) Try profiles table first
    let userId: string | null = null;
    const { data: prof } = await admin
      .from("profiles")
      .select("user_id, email")
      .ilike("email", target)
      .maybeSingle();
    if (prof?.user_id) userId = prof.user_id as string;

    // 2) Fallback: paginate through auth users
    if (!userId) {
      for (let page = 1; page <= 10 && !userId; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const found = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
        if (found) userId = found.id;
        if (data.users.length < 200) break;
      }
    }

    if (!userId) throw new Error("Usuário não encontrado");

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw error;

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
