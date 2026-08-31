// Criar acesso para uma pessoa nova.
//
// REESCRITA EM 30/08/2026, por dois defeitos que se somavam:
//
//   1. `password: password || "123456"`. Toda conta nascia com a mesma senha,
//      escrita no código e ANUNCIADA na tela de Usuários ("Senha padrão:
//      123456"). Como quase ninguém troca senha que já funciona, o Hub inteiro
//      ficou com contas abertas por seis dígitos previsíveis. Foi assim que
//      entraram.
//   2. O atalho de bootstrap. Enquanto `profiles` estivesse VAZIA, criar conta
//      não exigia login — pensado para o primeiro admin. O problema é o modo de
//      falhar: se aquela contagem voltasse zero por qualquer motivo (erro de
//      leitura, tabela truncada, RLS mal posta), a porta de criar administrador
//      reabria sozinha, sem nada no log dizendo isso. Não existe mais: o
//      primeiro usuário se cria pelo painel do Supabase, uma vez na vida.
//
// Agora: exige administrador logado, e a senha ou vem forte de quem cria, ou é
// SORTEADA aqui e devolvida uma única vez para ser entregue à pessoa.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { gerarSenhaForte, motivoSenhaRuim } from "../_shared/senha.ts";

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
    const quem = await requireUser(req, { bloquearCargos: ["parcerias"] });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { nome, cargo, email, password } = await req.json();
    if (!email || !nome) throw new Error("Nome e email são obrigatórios");

    const alvo = String(email).trim().toLowerCase();

    // Senha sorteada quando quem cria não informa nenhuma — que é o caminho
    // normal. Devolvida UMA vez na resposta e nunca gravada fora do Auth.
    const senha = password ? String(password) : gerarSenhaForte();
    const ruim = motivoSenhaRuim(senha, alvo);
    if (ruim) throw new Error(ruim);

    // O PORTEIRO. Desde 30/08/2026 o gatilho `handle_new_user` recusa qualquer
    // conta cujo e-mail não esteja autorizado antes — é o que mantém o cadastro
    // público fechado mesmo se o signup do GoTrue estiver ligado no painel. Ver
    // a migração `20260831002000_ninguem_se_cadastra_sozinho.sql`.
    //
    // Autorizar ANTES de chamar o Auth, não depois: o gatilho roda dentro da
    // transação do INSERT, e uma autorização que chegasse depois chegaria tarde.
    const { error: erroAutorizar } = await admin
      .from("cadastro_autorizado")
      .upsert(
        { email: alvo, autorizado_por: quem.email ?? quem.userId ?? "sistema" },
        { onConflict: "email" },
      );
    if (erroAutorizar) throw erroAutorizar;

    const { data, error } = await admin.auth.admin.createUser({
      email: alvo,
      password: senha,
      email_confirm: true,
      user_metadata: { nome, cargo: cargo || "" },
    });
    if (error) throw error;

    console.log(`[create-user] ${quem.email ?? quem.userId} criou o acesso de ${alvo}`);

    return json({
      user: data.user,
      // Só quando fomos nós que sorteamos. Se quem criou escolheu a senha, ela
      // não volta na resposta — não há motivo para ecoar segredo que já é dele.
      senhaTemporaria: password ? null : senha,
    });
  } catch (e: any) {
    const msg = e?.message ?? "Erro";
    const status = /autenticad|permiss/i.test(msg) ? 401 : 400;
    return json({ error: msg }, status);
  }
});
