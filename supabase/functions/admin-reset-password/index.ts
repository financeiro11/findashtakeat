// Definir a senha de OUTRA pessoa. Ferramenta de administração, não de autoatendimento.
//
// ---------------------------------------------------------------------------
// POR QUE ESTA FUNÇÃO FOI REESCRITA EM 30/08/2026
//
// A versão anterior tinha um único portão: um código de quatro dígitos, "2122",
// escrito em texto puro AQUI e também em `src/pages/Login.tsx` — ou seja, no
// bundle que qualquer pessoa baixa ao abrir a tela de login. Com ele, qualquer
// um na internet trocava a senha de QUALQUER e-mail, sem estar logado. Foi
// exatamente por aí que entraram, e o aviso chegou por Instagram.
//
// Duas lições viraram regra aqui:
//
//   1. SEGREDO NO FRONT NÃO É SEGREDO. Tudo que o navegador precisa saber para
//      chamar a função, o atacante também sabe. O portão tem de ser um usuário
//      autenticado de verdade — `requireUser` valida o token de sessão contra o
//      Auth, e recusa a anon key sozinha (que é pública).
//   2. `verify_jwt` DO GATEWAY NÃO BASTA. Ele aceita qualquer JWT assinado pelo
//      projeto, e a anon key é um desses. A checagem interna é a que vale.
//
// O caminho de "esqueci a senha" do usuário comum NÃO passa mais por aqui: ele é
// o e-mail de recuperação do próprio Supabase (`resetPasswordForEmail`), que
// prova a posse da caixa de entrada — ver `src/pages/Login.tsx`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { motivoSenhaRuim } from "../_shared/senha.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // PORTÃO. Antes de ler o corpo, antes de tudo: quem está chamando?
    // "parcerias" fica de fora porque é o cargo de menor alcance no Hub (ver
    // AppLayout) — quem não pode ver o financeiro não redefine senha de ninguém.
    const quem = await requireUser(req, { bloquearCargos: ["parcerias"] });

    const { email, password } = await req.json();
    if (!email || !password) throw new Error("Dados incompletos");

    const target = String(email).trim().toLowerCase();

    const ruim = motivoSenhaRuim(String(password), target);
    if (ruim) throw new Error(ruim);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Lê o cadastro, mas não confia em `profile.user_id` até conferir no Auth.
    let authUserId: string | null = null;
    const { data: profiles, error: profilesErr } = await admin
      .from("profiles")
      .select("id, user_id, nome, cargo, email")
      .ilike("email", target)
      .order("created_at", { ascending: false });
    if (profilesErr) throw profilesErr;
    let prof = (profiles ?? [])[0] ?? null;

    // 2) O Auth é a fonte da verdade. Acha o usuário real pelo e-mail.
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
      // Conserto de descompasso: existe cadastro em `profiles` mas o usuário do
      // Auth sumiu. Continua sendo permitido porque é reparo real, e agora exige
      // um administrador logado — não é mais porta de entrada para desconhecido.
      const nome = (prof as any)?.nome ?? target.split("@")[0];
      const cargo = (prof as any)?.cargo ?? "";

      // Este caminho CRIA usuário, então passa pelo mesmo porteiro do
      // `create-user`: sem a autorização prévia, o gatilho `handle_new_user`
      // aborta e o reparo falharia sem explicar por quê. Ver a migração
      // `20260831002000_ninguem_se_cadastra_sozinho.sql`.
      const { error: erroAutorizar } = await admin
        .from("cadastro_autorizado")
        .upsert(
          { email: target, autorizado_por: quem.email ?? quem.userId ?? "reparo" },
          { onConflict: "email" },
        );
      if (erroAutorizar) throw erroAutorizar;

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
        const { error: profileErr } = await admin
          .from("profiles").update({ user_id: authUserId, email: target }).eq("id", prof.id);
        if (profileErr) throw profileErr;
      } else {
        const { error: profileErr } = await admin
          .from("profiles").insert({ user_id: authUserId, email: target, nome, cargo });
        if (profileErr) throw profileErr;
      }

      console.log(`[admin-reset-password] ${quem.email ?? quem.userId} RECRIOU o acesso de ${target}`);
      return json({ ok: true, created: true, user_id: authUserId });
    }

    if (prof?.id && prof.user_id !== authUserId) {
      await admin.from("profiles").delete().ilike("email", target).neq("id", prof.id);
      await admin.from("profiles").delete().eq("user_id", authUserId).neq("id", prof.id);
      const { error: profileErr } = await admin
        .from("profiles").update({ user_id: authUserId, email: target }).eq("id", prof.id);
      if (profileErr) throw profileErr;
    }

    const { error } = await admin.auth.admin.updateUserById(authUserId, { password });
    if (error) throw error;

    // Trocar a senha não derruba sessão nenhuma por conta própria. Se a conta foi
    // usada por outra pessoa, a senha nova sozinha não expulsa ninguém — quem
    // expulsa é isto. É o passo que faltava na versão antiga.
    const { error: erroSair } = await admin.auth.admin.signOut(authUserId, "global");
    if (erroSair) console.error("[admin-reset-password] falhou ao encerrar sessões:", erroSair.message);

    console.log(`[admin-reset-password] ${quem.email ?? quem.userId} redefiniu a senha de ${target}`);
    return json({ ok: true, sessoesEncerradas: !erroSair });
  } catch (e: any) {
    const msg = e?.message ?? "Erro";
    // 401 quando o problema é quem chamou; 400 quando é o que foi pedido. Ajuda a
    // enxergar tentativa de acesso no log em vez de virar mais um "erro 400".
    const status = /autenticad|permiss/i.test(msg) ? 401 : 400;
    return json({ error: msg }, status);
  }
});
