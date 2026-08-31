// A lista de quem tem conta no Hub.
//
// FECHADA EM 30/08/2026. Ela rodava com a service role e SEM checagem nenhuma:
// bastava a anon key — que está no bundle do front, pública — para qualquer
// pessoa na internet baixar nome, cargo e e-mail de todo o time. Era metade do
// "vazou todos os dados", e a outra metade era o que se fazia com essa lista:
// escolher um alvo e trocar a senha dele pelo código de quatro dígitos.
//
// A tela de login NÃO chama mais esta função. Ela existia lá para montar um
// seletor de usuários — conveniência que entregava o quadro de funcionários a
// quem nem tinha conta. Hoje o login pede o e-mail digitado, e quem lembra dele
// é o gerenciador de senhas do navegador.
//
// Continua servindo a telas internas, agora exigindo pessoa logada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });

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
    const msg = e?.message ?? "Erro";
    const naoAutenticado = /autenticad|permiss/i.test(msg);
    // Antes esta função devolvia 200 mesmo no erro. Agora recusa com o código
    // certo: 200 com lista vazia esconde a recusa e faz a tela parecer vazia
    // quando na verdade o chamador não tinha permissão.
    return new Response(JSON.stringify({ error: msg, users: [] }), {
      status: naoAutenticado ? 401 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
