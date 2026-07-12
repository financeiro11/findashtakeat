import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Bootstrap: enquanto NÃO houver nenhum usuário, o seed do primeiro admin é permitido
    // sem login (tela de Login). A partir do 1º usuário, criar conta exige um usuário logado
    // (não a anon key pública) e que não seja "parcerias".
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const { nome, cargo, email, password } = await req.json();
    if (!email || !nome) throw new Error("Nome e email são obrigatórios");

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: password || "123456",
      email_confirm: true,
      user_metadata: { nome, cargo: cargo || "" },
    });
    if (error) throw error;

    return new Response(JSON.stringify({ user: data.user }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
