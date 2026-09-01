// Edge Function: gmail-oauth
//
// O consentimento único que dá ao Hub a leitura da caixa `financeiro@takeat.app`.
//
// POR QUE UMA FUNÇÃO, e não um passo manual no navegador: o refresh token morre
// um dia — alguém revoga o acesso, a senha muda, o app sai do ar. Quando isso
// acontecer, reconectar tem de ser um clique, e não uma arqueologia de qual
// comando alguém rodou uma vez em agosto de 2026.
//
// O FLUXO, em três passos:
//   1. `{ action: "url" }`  (exige usuário logado) devolve o link do Google.
//   2. a pessoa abre o link, escolhe a conta e consente.
//   3. o Google redireciona de volta PARA CÁ com `?code=…&state=…`; a função
//      troca o código pelo refresh token e o guarda em `internal_secrets`.
//
// `access_type=offline` + `prompt=consent` são obrigatórios juntos: sem os dois,
// o Google devolve refresh token só na PRIMEIRA autorização da vida daquela
// conta com aquele client — e a segunda tentativa volta sem nada, sem erro
// nenhum, o que é impossível de depurar sem saber disto.
//
// verify_jwt = false (ver config.toml): quem chega no passo 3 é o navegador da
// pessoa, redirecionado pelo Google, sem a anon key do Supabase. Quem protege
// esse passo é o `state` — um valor aleatório que ESTA função gerou e guardou;
// sem ele, a troca é recusada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { segredosDoGmail, tokenDeAcesso } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PROJETO = "lgcxyxyidoirqmbdlldh";
const REDIRECT = `https://${PROJETO}.supabase.co/functions/v1/gmail-oauth`;
/* DOIS ESCOPOS, E OS DOIS SÃO SOMENTE LEITURA.
 *
 * `gmail.readonly` é o original: ler a caixa e extrair a nota que chega por
 * e-mail.
 *
 * `drive.readonly` entrou em 26/08/2026, e o motivo é concreto. As notas que as
 * cinco planilhas de formulário recolhem NÃO SÃO DA EMPRESA: o upload fica no
 * Drive de quem preencheu, e o `financeiro@` só recebe compartilhamento. Um
 * exemplo real da fila — "uber golburger dia 19-11-2024 - Franco Passos.pdf",
 * `owner: joaoesteves.takeat@gmail.com`, um Gmail PESSOAL, `sharedWithMeTime`
 * de 19/11/2024. Se essa pessoa sair, mover ou apagar, a nota some e a empresa
 * nunca a teve.
 *
 * Chave de API não serve para copiar isso: ela só abre arquivo público, e
 * responde `404 File not found` para o que é compartilhado com uma conta
 * específica — que é o caso de 2.335 notas. Só o consentimento do próprio
 * `financeiro@` alcança o que foi compartilhado com ele.
 *
 * Somar escopo OBRIGA A RECONSENTIR: o refresh token antigo vale só para o
 * escopo antigo, e o Google não amplia token existente. Por isso a `url` tem de
 * ser aberta de novo depois desta mudança — o `prompt=consent` já garante que
 * volte refresh token novo. */
/* `gmail.send` entrou em 29/08/2026, para a resposta sugerida do briefing.
 *
 * É O ESCOPO MAIS ESTREITO QUE FAZ O TRABALHO, e a escolha é deliberada:
 * `gmail.send` só permite ENVIAR. Ele não lê, não apaga, não mexe em rótulo e
 * não altera rascunho — diferente de `gmail.modify`, que daria tudo isso de
 * brinde para uma funcionalidade que precisa de um verbo só.
 *
 * ATENÇÃO, E ISTO NÃO É AUTOMÁTICO: enquanto ninguém reabrir o consentimento, o
 * refresh token guardado continua valendo só para os dois escopos antigos, e
 * qualquer tentativa de enviar volta 403. O Hub trata isso como estado normal e
 * diz o que fazer, em vez de estourar. */
/* `calendar.readonly` entrou em 31/08/2026, para o Hub ler a agenda de
 * pagamentos de verdade em vez da fotografia que a skill do briefing gravava
 * uma vez por dia. Somente leitura, e a escolha e deliberada: o Hub nao cria,
 * nao move e nao apaga evento — a agenda continua sendo escrita por pessoas.
 *
 * MESMA ARMADILHA DOS OUTROS: enquanto ninguem reabrir o consentimento, o
 * refresh token guardado vale so para os escopos antigos, e a agenda-sync volta
 * 403 dizendo exatamente isso. */
const ESCOPO = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

/** A resposta para quem chega pelo navegador — é uma pessoa do outro lado. */
/* ESTA PÁGINA NÃO PODE SER HTML, e agora se sabe por quê.
 *
 * Em 26/08/2026 ela chegou como TEXTO CRU com acentos quebrados ("jÃ¡"), e a
 * tentativa da época foi mandar documento inteiro em bytes UTF-8, com
 * `Content-Type: text/html; charset=utf-8`. Não resolveu — em 30/08/2026 o
 * mesmo sintoma voltou, e desta vez a resposta foi MEDIDA com `curl`:
 *
 *     Content-Type: text/plain
 *     Content-Security-Policy: default-src 'none'; sandbox
 *     x-content-type-options: nosniff
 *
 * O gateway do Supabase SOBRESCREVE o nosso `text/html` por `text/plain` e
 * injeta CSP `sandbox`. É proteção da plataforma — servir HTML de
 * `*.supabase.co/functions/v1/...` seria phishing pronto no domínio deles.
 * Com `nosniff` junto, o navegador é OBRIGADO a mostrar a fonte.
 *
 * Ou seja: mandar HTML aqui é escrever markup para ninguém ver, e o `text/plain`
 * sem charset é o que quebra os acentos. Então a página vira TEXTO PURO, e
 * SEM ACENTO — não por desleixo, mas porque o charset não é nosso para escolher.
 * A regra é chata e vale registrar: Edge Function do Supabase não serve página. */
const pagina = (titulo: string, texto: string, ok: boolean) =>
  new Response(
    [
      ok ? "[OK] " + titulo : "[ERRO] " + titulo,
      "",
      texto,
      "",
      "Pode fechar esta aba.",
    ].join("\n"),
    {
      status: ok ? 200 : 400,
      headers: {
        /* Declarado mesmo sabendo que o gateway sobrescreve: se um dia ele
           parar de sobrescrever, a resposta já sai certa. */
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );

async function guardar(supabase: any, nome: string, valor: string, observacao: string) {
  const { error } = await supabase.from("internal_secrets")
    .upsert({ nome, valor, observacao }, { onConflict: "nome" });
  if (error) throw new Error(`internal_secrets ${nome}: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const erroGoogle = url.searchParams.get("error");

    /* -------- passo 3: a volta do Google -------- */
    if (code || erroGoogle) {
      if (erroGoogle) return pagina("Autorização recusada", `O Google respondeu: ${erroGoogle}`, false);

      const { data: guardado } = await supabase.from("internal_secrets")
        .select("valor").eq("nome", "GMAIL_OAUTH_STATE").maybeSingle();
      if (!guardado?.valor || guardado.valor !== state) {
        return pagina(
          "Pedido não reconhecido",
          "O `state` não confere com nenhuma autorização iniciada aqui. Comece de novo pelo Hub.",
          false,
        );
      }

      const s = await segredosDoGmail(supabase);
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code, client_id: s.clientId, client_secret: s.clientSecret,
          redirect_uri: REDIRECT, grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return pagina("O Google recusou a troca", JSON.stringify(j).slice(0, 300), false);

      if (!j.refresh_token) {
        /* Acontece quando a conta já tinha autorizado este client antes: sem
           `prompt=consent` o Google devolve só o access token. O link que esta
           função monta sempre pede consentimento, então chegar aqui significa
           que alguém usou um link montado à mão. */
        return pagina(
          "Veio sem refresh token",
          "O Google devolveu só um token de curta duração. Refaça pelo Hub — o link de lá pede " +
          "consentimento explícito, que é o que faz o refresh token vir junto.",
          false,
        );
      }

      await guardar(supabase, "GMAIL_REFRESH_TOKEN", j.refresh_token,
        `Leitura da caixa financeiro@ · autorizado em ${new Date().toISOString().slice(0, 10)}`);
      // O `state` é de uso único: gasto, some.
      await supabase.from("internal_secrets").delete().eq("nome", "GMAIL_OAUTH_STATE");

      return pagina(
        "Caixa conectada",
        "O Hub ja pode ler as notas que chegam por e-mail e responder pelo briefing.",
        true,
      );
    }

    /* -------- passos 1 e 2, e o diagnóstico: exigem usuário -------- */
    await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? url.searchParams.get("action") ?? "url";

    if (action === "status") {
      const s = await segredosDoGmail(supabase);
      if (!s.refreshToken) return json({ ok: true, conectado: false, motivo: "sem refresh token" });
      try {
        const token = await tokenDeAcesso(s);

        /* OS ESCOPOS CONCEDIDOS, e não os PEDIDOS. A diferença é a pergunta que
           mais custou tempo aqui: `ESCOPO` acima diz o que o Hub pede, e o
           refresh token guardado pode ser mais antigo que essa lista — o Google
           não amplia token existente. Sem perguntar ao `tokeninfo`, "conectado:
           true" convive com um envio que volta 403, e o painel mente.

           Falha de leitura NÃO derruba o status: não saber os escopos é pior que
           saber, mas ainda é melhor que responder "desconectado" para uma caixa
           que lê e-mail sem problema. */
        let escopos: string[] | null = null;
        try {
          const ti = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          if (ti.ok) {
            const j = await ti.json();
            escopos = String(j?.scope ?? "").split(/\s+/).filter(Boolean);
          }
        } catch { /* segue sem a lista */ }

        return json({
          ok: true,
          conectado: true,
          escopos,
          pode_enviar: escopos ? escopos.includes("https://www.googleapis.com/auth/gmail.send") : null,
          pode_ler: escopos ? escopos.includes("https://www.googleapis.com/auth/gmail.readonly") : null,
        });
      } catch (e) {
        return json({ ok: true, conectado: false, motivo: String((e as Error)?.message ?? e) });
      }
    }

    if (action === "url") {
      const s = await segredosDoGmail(supabase);
      const novoState = crypto.randomUUID().replace(/-/g, "");
      await guardar(supabase, "GMAIL_OAUTH_STATE", novoState, "uso único, gasto na volta do Google");

      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.searchParams.set("client_id", s.clientId);
      u.searchParams.set("redirect_uri", REDIRECT);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", ESCOPO);
      // Os dois juntos, sempre — ver o cabeçalho.
      u.searchParams.set("access_type", "offline");
      u.searchParams.set("prompt", "consent");
      u.searchParams.set("state", novoState);
      // Sugere a caixa certa; a pessoa ainda escolhe.
      u.searchParams.set("login_hint", "financeiro@takeat.app");

      return json({ ok: true, url: u.toString(), redirect_uri: REDIRECT });
    }

    return json({ ok: false, error: `ação desconhecida: ${action}` }, 400);
  } catch (e) {
    console.error("gmail-oauth", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
