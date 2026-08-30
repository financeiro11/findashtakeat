// O e-mail acionável do briefing, com a solução preparada.
//
//   { action: "preparar" }             → lê o briefing e prepara (pode rodar de cron)
//   { action: "enviar", chave, texto } → manda de verdade (SÓ com pessoa logada)
//   { action: "previa" }               → o que entraria, sem gastar IA
//
// ---------------------------------------------------------------------------
// O CORPUS É O BRIEFING, e a primeira versão errava nisso. Ela lia
// `email_mensagens`, que o `gmail-nf-sync` alimenta procurando NOTA FISCAL —
// caixa quase toda de `noreply@`, onde 3 de 3 e-mails saíram "não precisa
// responder", corretamente. Os e-mails que importam já estão curados em
// `briefing_diario.emails`, cada um com a AÇÃO escrita pelo agente que gera o
// briefing. É esse o material.
//
// DUAS SAÍDAS, porque nem todo e-mail acionável pede resposta. "Sua cobrança
// vence amanhã" pede PAGAMENTO, não cordialidade. Então cada item ganha:
//   • `sugestao` — a resposta ao remetente, quando responder ajuda;
//   • `acao`     — o que fazer aqui dentro, que vira tarefa em /tarefas.
// Quem lê o briefing escolhe qual das duas usa, ou as duas.
//
// ---------------------------------------------------------------------------
// O ITEM DO BRIEFING NÃO TEM O ID DA MENSAGEM. Ele traz remetente, assunto e
// data — e o Gmail precisa do id para a resposta cair na conversa certa. Então
// procuramos: `from:<remetente> subject:<assunto>`, a mais recente. Isso ACHA A
// THREAD ERRADA de vez em quando ("Sua fatura chegou" se repete todo mês), e por
// isso o que foi achado é gravado (`msg_assunto`, `msg_data`) e mostrado na tela
// ANTES de alguém enviar. Não achar também é resposta: o item continua valendo
// como tarefa, só não como resposta.
//
// `enviar` NÃO ACEITA CRON, sem exceção nem parâmetro de escape. O resto desta
// leva deu autonomia à IA — ela aponta o título de uma nota sozinha quando a
// prova é forte. Aqui a régua muda porque a consequência muda: errar o desempate
// de uma nota custa uma linha interna que se desfaz; errar um e-mail custa uma
// mensagem que saiu com o nome da empresa, e para isso não existe desfazer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateJSON, MODELO_LITE } from "../_shared/gemini.ts";
import { podeGastarIA, quantasCabem, registrarUsoIA } from "../_shared/ia-orcamento.ts";
import { segredosDoGmail, tokenDeAcesso, listar, mensagem } from "../_shared/gmail.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_LOTE = 10;
const LIMITE_WORKER_MS = 110_000;
const TETO_IA_MS = 30_000;

function comPrazo<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${oque} não respondeu em ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

type ItemBriefing = { remetente?: string; assunto?: string; data?: string; acao?: string; resumo?: string };

/** A identidade do item. Minúsculas e sem espaço dobrado: o briefing é gerado
 *  por IA e o mesmo item pode voltar amanhã com espaçamento diferente. */
const chaveDe = (i: ItemBriefing) =>
  [i.remetente ?? "", i.assunto ?? "", i.data ?? ""]
    .map((s) => String(s).toLowerCase().replace(/\s+/g, " ").trim())
    .join("|")
    .slice(0, 400);

/** Só o endereço, de "Fulano <f@x.com>" ou de "f@x.com". */
const enderecoDe = (s: string) =>
  s.match(/<([^>]+)>/)?.[1] ?? s.trim();

const SCHEMA = {
  type: "object",
  properties: {
    veredito: {
      type: "string", enum: ["responder", "so_acao"],
      description: "so_acao quando responder o remetente não ajuda (aviso automático, cobrança a pagar)",
    },
    resposta: { type: "string", description: "corpo da resposta, sem saudação de rodapé nem assinatura" },
    porque: { type: "string", description: "uma frase: por que respondeu assim, ou por que não cabe responder" },
  },
  required: ["veredito", "resposta", "porque"],
} as const;

const INSTRUCAO =
  "Você prepara a tratativa de e-mails para o time FINANCEIRO da Takeat, empresa brasileira de " +
  "tecnologia para restaurantes. Cada e-mail já foi marcado como ACIONÁVEL pelo briefing, e vem " +
  "com a ação que o briefing identificou.\n\n" +
  "Primeiro decida o veredito:\n" +
  "- 'so_acao' quando responder o remetente não resolve nada: aviso automático, remetente " +
  "'noreply', cobrança que precisa ser PAGA, notificação de sistema. A providência é interna.\n" +
  "- 'responder' quando há uma pessoa do outro lado esperando algo nosso: fornecedor pedindo " +
  "dado, contador pedindo documento, cliente perguntando.\n\n" +
  "Em 'so_acao', escreva mesmo assim uma resposta curta em 'resposta' — às vezes é útil " +
  "confirmar recebimento —, mas deixe claro em 'porque' que ela é opcional.\n\n" +
  "Quando responder:\n" +
  "- Português brasileiro, cordial e DIRETO. Duas a cinco linhas. Sem 'espero que esteja bem'.\n" +
  "- Não assine e não escreva saudação de rodapé — quem envia acrescenta.\n" +
  "- NUNCA prometa data de pagamento, valor ou condição comercial que o e-mail não afirme. " +
  "Faltando informação, a resposta PEDE essa informação.\n" +
  "- Não invente número de nota, CNPJ nem protocolo.\n" +
  "- Se depende de decisão de alguém (aprovar, negociar, cancelar), diga que está em análise e " +
  "dê o próximo passo — não decida no lugar da pessoa.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const t0 = Date.now();
  const restaTempo = () => LIMITE_WORKER_MS - (Date.now() - t0);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "preparar");

    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supa.from("internal_cron_tokens")
        .select("name").eq("name", "email-responder").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }

    /* ======================================================= enviar ===== */
    if (action === "enviar") {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      if (!caller.userId) {
        return json({ ok: false, error: "o envio precisa de uma pessoa logada, não da service role" }, 403);
      }

      const chave = String(body?.chave ?? "").trim();
      if (!chave) return json({ ok: false, error: "informe a chave do item" }, 400);

      const { data: a } = await supa.from("email_acao")
        .select("chave, remetente, assunto, gmail_id, thread_id, msg_assunto, sugestao, enviado_em")
        .eq("chave", chave).maybeSingle();
      if (!a) return json({ ok: false, error: "não achei esse item" }, 404);
      if (a.enviado_em) return json({ ok: false, error: "essa resposta já foi enviada" }, 409);
      if (!a.gmail_id) {
        return json({
          ok: false,
          error: "não localizei a mensagem original no Gmail — sem ela a resposta cairia fora da conversa. Responda pelo Gmail, ou use o item como tarefa.",
        }, 409);
      }

      /* O TEXTO QUE VAI É O DA TELA, não o do banco. A caixa é editável e
         enviar outra coisa seria a pior armadilha de uma tela cujo propósito é
         justamente deixar alguém revisar antes. */
      const texto = String(body?.texto ?? a.sugestao ?? "").trim();
      if (!texto) return json({ ok: false, error: "a resposta está vazia" }, 400);

      const seg = await segredosDoGmail(supa);
      if (!seg.refreshToken) {
        return json({ ok: false, error: "o Gmail não está conectado — reconecte em Configurações." }, 409);
      }
      const token = await tokenDeAcesso(seg);

      const para = enderecoDe(String(a.remetente ?? ""));
      const base = String(a.msg_assunto ?? a.assunto ?? "");
      const assunto = /^re:/i.test(base) ? base : `Re: ${base}`;

      /* `In-Reply-To`/`References` fazem a resposta cair NA MESMA CONVERSA no
         cliente de quem recebe. Sem eles chega uma thread nova, e a pessoa perde
         o contexto que ela mesma escreveu. Usam o Message-ID do cabeçalho, que é
         diferente do id interno do Gmail — por isso ele é lido da mensagem. */
      const msgIdRfc = String(body?.message_id ?? "").trim();
      const cabecalhos = [
        `To: ${para}`,
        `Subject: ${assunto}`,
        ...(msgIdRfc ? [`In-Reply-To: ${msgIdRfc}`, `References: ${msgIdRfc}`] : []),
        "Content-Type: text/plain; charset=UTF-8",
        "MIME-Version: 1.0",
        "",
        texto,
      ].join("\r\n");

      const bytes = new TextEncoder().encode(cabecalhos);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      const raw = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw, threadId: a.thread_id ?? undefined }),
      });

      if (!resp.ok) {
        const detalhe = await resp.text();
        const faltaEscopo = resp.status === 403 && /insufficient|scope|permission/i.test(detalhe);
        const msg = faltaEscopo
          ? "O Gmail ainda não tem permissão de ENVIO. Reconecte o Gmail em Configurações — o escopo de envio foi acrescentado em 29/08/2026 e o acesso antigo não o inclui."
          : `Gmail recusou o envio (${resp.status}): ${detalhe.slice(0, 200)}`;
        await supa.from("email_acao").update({ erro: msg.slice(0, 500) }).eq("chave", chave);
        return json({ ok: false, error: msg, falta_escopo: faltaEscopo }, faltaEscopo ? 409 : 502);
      }

      /* Carimba COM O TOKEN DE QUEM CLICOU: a RPC exige `auth.uid()`, e a
         service role não tem uid — o registro ficaria sem dono. */
      const comoUsuario = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
          auth: { persistSession: false },
        },
      );
      const { error: eM } = await comoUsuario.rpc("email_acao_marcar_enviada", { p_chave: chave });
      if (eM) console.error("marcar_enviada:", eM.message);

      return json({ ok: true, enviado: true, para, assunto });
    }

    /* ===================================================== preparar ===== */
    let quem: string | null = null;
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.userId ?? null;
    }

    const limite = Math.max(1, Math.min(Number(body?.limite ?? MAX_LOTE), MAX_LOTE));

    /* Os itens acionáveis do briefing mais recente. */
    const { data: brief } = await supa.from("briefing_diario")
      .select("emails, gerado_em").order("gerado_em", { ascending: false }).limit(1).maybeSingle();

    const cru = brief?.emails;
    const itens: ItemBriefing[] = (Array.isArray(cru) ? cru : (cru?.itens ?? []))
      .filter((i: ItemBriefing) => i && (i.remetente || i.assunto));

    if (action === "previa") {
      const [freio, seg] = await Promise.all([
        podeGastarIA(supa, "email_resposta", 1),
        segredosDoGmail(supa),
      ]);
      const { data: jaTem } = await supa.from("email_acao").select("chave");
      const vistos = new Set((jaTem ?? []).map((r: { chave: string }) => r.chave));
      return json({
        ok: true, previa: true,
        no_briefing: itens.length,
        novos: itens.filter((i) => !vistos.has(chaveDe(i))).length,
        gmail_conectado: !!seg.refreshToken,
        freio,
      });
    }

    if (action !== "preparar") return json({ ok: false, error: `ação desconhecida: ${action}` }, 400);

    const veredito = await podeGastarIA(supa, "email_resposta", 1);
    const cabem = quantasCabem(veredito, limite);
    if (!cabem) return json({ ok: true, freado: veredito.motivo, preparados: 0 });

    /* Idempotência: item já preparado não volta. É o freio mais barato — o
       briefing repete o mesmo e-mail enquanto ele seguir acionável. */
    const { data: jaTem } = await supa.from("email_acao").select("chave");
    const vistos = new Set((jaTem ?? []).map((r: { chave: string }) => r.chave));
    const fila = itens.filter((i) => !vistos.has(chaveDe(i))).slice(0, cabem);

    const seg = await segredosDoGmail(supa);
    const token = seg.refreshToken ? await tokenDeAcesso(seg) : null;

    let preparados = 0, responder = 0, soAcao = 0, achados = 0;
    const erros: string[] = [];
    let parouPorTempo = false;

    for (const item of fila) {
      if (restaTempo() < TETO_IA_MS + 10_000) { parouPorTempo = true; break; }
      const chave = chaveDe(item);
      try {
        /* ---- procurar a mensagem no Gmail (pode não achar) ---- */
        let gmailId: string | null = null, threadId: string | null = null;
        let msgAssunto: string | null = null, msgData: string | null = null;
        let corpo = "";

        if (token && item.remetente) {
          const de = enderecoDe(String(item.remetente));
          /* Aspas no assunto para o Gmail tratar como frase; sem elas, cada
             palavra vira um termo e a busca traz a caixa inteira. */
          const assuntoBusca = String(item.assunto ?? "").replace(/["\\]/g, " ").trim();
          const q = [
            `from:${de}`,
            assuntoBusca ? `subject:"${assuntoBusca.slice(0, 120)}"` : "",
            "newer_than:30d",
            "-in:sent -in:draft -in:trash",
          ].filter(Boolean).join(" ");

          const { ids } = await listar(token, q, undefined, 1);
          if (ids.length) {
            gmailId = ids[0].id;
            threadId = ids[0].threadId;
            const m = await mensagem(token, gmailId);
            msgAssunto = m.assunto ?? null;
            msgData = m.data ?? null;
            /* CORTADO EM 4 000: e-mail de fornecedor traz assinatura, aviso de
               confidencialidade e a thread inteira citada embaixo. O que decide
               está sempre no topo, e mandar o resto é pagar token para o modelo
               reler o que ele já leu. */
            corpo = String(m.corpo ?? "").slice(0, 4000);
            achados++;
          }
        }

        /* ---- a IA prepara ---- */
        const contexto = [
          `De: ${item.remetente ?? "?"}`,
          `Assunto: ${item.assunto ?? "?"}`,
          item.data ? `Data: ${item.data}` : "",
          item.acao ? `Ação identificada pelo briefing: ${item.acao}` : "",
          "",
          corpo ? `Corpo do e-mail:\n${corpo}` : "(o corpo original não foi localizado; use o assunto e a ação acima)",
        ].filter(Boolean).join("\n");

        const out = await comPrazo(generateJSON<{ veredito: string; resposta: string; porque: string }>({
          model: MODELO_LITE,
          temperature: 0.3,
          responseSchema: SCHEMA,
          messages: [
            { role: "system", content: INSTRUCAO },
            { role: "user", content: contexto },
          ],
          onUso: (u) => { void registrarUsoIA(supa, { consumidor: "email_resposta", userId: quem, ...u }); },
        }), TETO_IA_MS, "a preparação da tratativa");

        const vd = out?.veredito === "so_acao" ? "so_acao" : "responder";

        const { error } = await supa.from("email_acao").upsert({
          chave,
          remetente: String(item.remetente ?? "?"),
          assunto: item.assunto ?? null,
          data_email: item.data ?? null,
          acao: item.acao ?? item.resumo ?? null,
          veredito: vd,
          sugestao: String(out?.resposta ?? "").slice(0, 4000),
          porque: String(out?.porque ?? "").slice(0, 400),
          modelo: MODELO_LITE,
          gmail_id: gmailId,
          thread_id: threadId,
          msg_assunto: msgAssunto,
          msg_data: msgData,
        }, { onConflict: "chave" });
        if (error) throw new Error(error.message);

        preparados++;
        if (vd === "responder") responder++; else soAcao++;
      } catch (e) {
        erros.push(`${item.remetente ?? "?"}: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
        void registrarUsoIA(supa, { consumidor: "email_resposta", model: MODELO_LITE, userId: quem });
      }
    }

    return json({
      ok: true,
      no_briefing: itens.length,
      preparados, responder, so_acao: soAcao,
      mensagem_achada_no_gmail: achados,
      gmail_conectado: !!seg.refreshToken,
      parou_por_tempo: parouPorTempo, erros,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error("email-responder", e);
    const msg = String((e as Error)?.message ?? e);
    return json({ ok: false, error: msg }, /não autenticado|sem permissão/i.test(msg) ? 401 : 500);
  }
});
