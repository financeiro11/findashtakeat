import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

    const { data: profiles, error } = await admin
      .from("profiles")
      .select("user_id,nome,cargo,email")
      .order("nome");

    if (error) throw error;

    const authEmailByUserId = new Map<string, string>();

    for (let page = 1; page <= 10; page++) {
      const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listError) throw listError;

      for (const user of data.users) {
        if (user.email) authEmailByUserId.set(user.id, user.email);
      }

      if (data.users.length < 200) break;
    }

    const users = (profiles ?? []).map((profile) => ({
      nome: profile.nome,
      cargo: profile.cargo,
      email: authEmailByUserId.get(profile.user_id) ?? profile.email,
    }));

    return new Response(JSON.stringify({ users }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message, users: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
