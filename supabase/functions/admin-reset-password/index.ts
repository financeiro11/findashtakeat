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

    // 1) Read the profile, but don't trust profile.user_id until it is verified in Auth.
    let authUserId: string | null = null;
    const { data: profiles, error: profilesErr } = await admin
      .from("profiles")
      .select("id, user_id, nome, cargo, email")
      .ilike("email", target)
      .order("created_at", { ascending: false });
    if (profilesErr) throw profilesErr;
    let prof = (profiles ?? [])[0] ?? null;

    // 2) Auth is the source of truth. Find the real Auth user by email.
    for (let page = 1; page <= 10 && !authUserId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const found = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
      if (found) authUserId = found.id;
      if (data.users.length < 200) break;
    }

    if (authUserId) {
      prof = (profiles ?? []).find((p) => p.user_id === authUserId) ?? prof;
    }

    if (authUserId && prof?.id) {
      await admin.from("profiles").delete().ilike("email", target).neq("id", prof.id);
    }

    if (!authUserId) {
      // Auth user doesn't exist yet — create it using profile data if available.
      const nome = (prof as any)?.nome ?? target.split("@")[0];
      const cargo = (prof as any)?.cargo ?? "";
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: target,
        password,
        email_confirm: true,
        user_metadata: { nome, cargo },
      });
      if (createErr) throw createErr;
      authUserId = created.user?.id ?? null;
      if (!authUserId) throw new Error("Usuário criado sem ID");

      if (prof?.id) {
        await admin.from("profiles").delete().ilike("email", target).neq("id", prof.id);
        await admin.from("profiles").delete().eq("user_id", authUserId).neq("id", prof.id);
        const { error: profileErr } = await admin.from("profiles").update({ user_id: authUserId, email: target }).eq("id", prof.id);
        if (profileErr) throw profileErr;
      } else {
        const { error: profileErr } = await admin.from("profiles").insert({ user_id: authUserId, email: target, nome, cargo });
        if (profileErr) throw profileErr;
      }

      return new Response(JSON.stringify({ ok: true, created: true, user_id: authUserId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (prof?.id && prof.user_id !== authUserId) {
      await admin.from("profiles").delete().ilike("email", target).neq("id", prof.id);
      await admin.from("profiles").delete().eq("user_id", authUserId).neq("id", prof.id);
      const { error: profileErr } = await admin.from("profiles").update({ user_id: authUserId, email: target }).eq("id", prof.id);
      if (profileErr) throw profileErr;
    }

    const { error } = await admin.auth.admin.updateUserById(authUserId, { password });
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
