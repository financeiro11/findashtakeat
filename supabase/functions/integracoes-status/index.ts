// As portas do Hub para fora, e se cada uma abre.
//
//   { action: "status" }  → checa tudo e devolve uma linha por integração
//
// POR QUE ISTO EXISTE, e o caso que decidiu: em 29/08/2026 a planilha de churn
// deixou de abrir — alguém removeu o compartilhamento "qualquer pessoa com o
// link". O Hub só soube porque o cron `churn-sheet-sync-diario` ficou vermelho,
// e mesmo assim a mensagem dizia "Google [401]", não "a planilha fechou".
//
// Credencial não avisa que morreu. Ela simplesmente para de funcionar, e o
// sintoma aparece três telas adiante como um número que não anda. Esta função é
// o lugar onde se pergunta ANTES de precisar.
//
// ---------------------------------------------------------------------------
// O QUE ELA NÃO FAZ:
//
// • NÃO devolve segredo nenhum. Nem prefixo, nem tamanho, nem "termina em X".
//   O que sai daqui é `conectado: true|false` e uma frase. Uma tela de
//   diagnóstico que vaza credencial é pior que não ter tela.
// • NÃO conserta. Onde existe conserto (Gmail), ela devolve o caminho; o resto
//   é chave de ambiente, que se troca no painel do Supabase.
// • NÃO gasta cota à toa: as checagens são as mais baratas que provam a coisa —
//   `HEAD` na planilha, o endpoint mais leve de cada API.
//
// AS CHECAGENS SÃO PARALELAS mas cada uma tem prazo curto: uma integração fora
// do ar não pode fazer a tela inteira esperar. Quem estoura vira "não deu para
// checar", que é diferente de "está quebrada" — e essa diferença é o ponto.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { segredosDoGmail, tokenDeAcesso } from "../_shared/gmail.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PRAZO_MS = 12_000;

/** `null` em `conectado` quer dizer NÃO SEI — e não é o mesmo que `false`. */
type Estado = {
  chave: string;
  nome: string;
  para_que: string;
  conectado: boolean | null;
  detalhe: string;
  /** O que a tela oferece: `gmail_oauth` abre o consentimento; o resto é texto. */
  conserto?: "gmail_oauth" | "painel_supabase" | "compartilhar_planilha";
  extra?: Record<string, unknown>;
};

function comPrazo<T>(p: Promise<T>, ms = PRAZO_MS): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("não respondeu a tempo")), ms); }),
  ]);
}

/** Envolve uma checagem para que falhar seja "não sei", nunca uma exceção solta. */
async function checar(base: Omit<Estado, "conectado" | "detalhe">, f: () => Promise<{ ok: boolean; detalhe: string; extra?: Record<string, unknown> }>): Promise<Estado> {
  try {
    const r = await comPrazo(f());
    return { ...base, conectado: r.ok, detalhe: r.detalhe, extra: r.extra };
  } catch (e) {
    return { ...base, conectado: null, detalhe: `não deu para checar: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
}

/* As planilhas públicas que alimentam sync. O ID fica aqui repetido de propósito
   — a fonte da verdade é cada função, e duplicar 5 ids é mais barato que fazer
   cinco funções exportarem constante para uma tela de diagnóstico ler. Se um id
   mudar lá e não aqui, a checagem acusa "não abre" e alguém vem conferir, que é
   exatamente o comportamento desejado. */
const PLANILHAS = [
  { id: "10A9YnskShPPZ2Xz9d-kN2SHCv-qN-48-94rQBbCNWIo", nome: "Churn e estornos", usada: "churn-sheet-sync, estornos-sync" },
  { id: "110Vp0mA3r8OgGpODHxszllKIBsELSeqR", nome: "Assinaturas", usada: "assinaturas-sheet-sync" },
  { id: "1fwt-sosZW-YRkV-uNyE06sE40ZLwdlkh3fjbo50VU8o", nome: "Proporcionais", usada: "proporcionais-sheet" },
  { id: "17MOvrcc7OpMVPFxzoKn4Nufg0zKU33qgmvZ-N3eCwgk", nome: "Recargas e viagens", usada: "recargas-viagens-sheet" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });

    const testes: Array<Promise<Estado>> = [];

    /* ---------------------------------------------------------- Gmail --- */
    testes.push(checar(
      {
        chave: "gmail",
        nome: "Gmail e Drive (financeiro@)",
        para_que: "Lê as notas que chegam por e-mail e responde pelo briefing.",
        conserto: "gmail_oauth",
      },
      async () => {
        const s = await segredosDoGmail(supa);
        if (!s.refreshToken) return { ok: false, detalhe: "nunca foi conectado" };
        const token = await tokenDeAcesso(s);

        /* OS ESCOPOS CONCEDIDOS, e não os pedidos. `conectado: true` convive com
           envio que volta 403 quando o token é mais antigo que a lista de
           escopos do código — o Google não amplia token existente. Sem
           perguntar ao `tokeninfo`, esta tela mentiria com cara de verde. */
        const ti = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
          { signal: AbortSignal.timeout(8_000) },
        );
        if (!ti.ok) return { ok: true, detalhe: "conectado (não deu para ler os escopos)" };

        const escopos = String(((await ti.json()) as { scope?: string })?.scope ?? "").split(/\s+/).filter(Boolean);
        const podeEnviar = escopos.includes("https://www.googleapis.com/auth/gmail.send");
        const podeLer = escopos.includes("https://www.googleapis.com/auth/gmail.readonly");
        const drive = escopos.includes("https://www.googleapis.com/auth/drive.readonly");

        return {
          ok: podeLer,
          detalhe: podeEnviar
            ? "lê a caixa e pode enviar resposta"
            : "lê a caixa, mas NÃO pode enviar — reconecte para liberar o envio",
          extra: { pode_ler: podeLer, pode_enviar: podeEnviar, drive },
        };
      },
    ));

    /* ------------------------------------------------------ planilhas --- */
    for (const p of PLANILHAS) {
      testes.push(checar(
        {
          chave: `planilha_${p.id.slice(0, 8)}`,
          nome: `Planilha: ${p.nome}`,
          para_que: `Alimenta ${p.usada}.`,
          conserto: "compartilhar_planilha",
        },
        async () => {
          /* O MESMO endpoint que a sync usa, e não a API do Sheets: é o
             compartilhamento "qualquer pessoa com o link" que se quer provar, e
             só o export anônimo prova isso. Uma checagem por outro caminho
             passaria verde com a planilha fechada para quem importa. */
          const r = await fetch(
            `https://docs.google.com/spreadsheets/d/${p.id}/export?format=csv`,
            { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000) },
          );
          /* O Google devolve 200 com HTML de login quando a planilha fechou —
             status sozinho não distingue. O tipo do conteúdo distingue. */
          const tipo = r.headers.get("content-type") ?? "";
          if (r.ok && !tipo.includes("text/html")) return { ok: true, detalhe: "abre pelo link" };
          if (r.status === 401 || r.status === 403 || tipo.includes("text/html")) {
            return { ok: false, detalhe: 'o compartilhamento "qualquer pessoa com o link" foi removido' };
          }
          return { ok: false, detalhe: `o Google respondeu ${r.status}` };
        },
      ));
    }

    /* ----------------------------------------------------------- Omie --- */
    testes.push(checar(
      {
        chave: "omie",
        nome: "Omie (ERP)",
        para_que: "Contas a pagar, caixa, NFS-e e anexos.",
        conserto: "painel_supabase",
      },
      async () => {
        const key = Deno.env.get("OMIE_APP_KEY"), secret = Deno.env.get("OMIE_APP_SECRET");
        if (!key || !secret) return { ok: false, detalhe: "OMIE_APP_KEY / OMIE_APP_SECRET ausentes" };
        /* A consulta mais barata que existe lá: uma página de UM registro. */
        const r = await fetch("https://app.omie.com.br/api/v1/geral/contacorrente/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call: "ListarContasCorrentes", app_key: key, app_secret: secret,
            param: [{ pagina: 1, registros_por_pagina: 1 }],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && !j?.faultstring) return { ok: true, detalhe: "responde" };
        return { ok: false, detalhe: String(j?.faultstring ?? `HTTP ${r.status}`).slice(0, 140) };
      },
    ));

    /* ---------------------------------------------------------- Asaas --- */
    testes.push(checar(
      {
        chave: "asaas",
        nome: "Asaas",
        para_que: "Cobranças, assinaturas e estornos.",
        conserto: "painel_supabase",
      },
      async () => {
        const key = Deno.env.get("ASAAS_API_KEY");
        if (!key) return { ok: false, detalhe: "ASAAS_API_KEY ausente" };
        const base = Deno.env.get("ASAAS_BASE_URL") ?? "https://api.asaas.com/v3";
        const r = await fetch(`${base}/finance/balance`, {
          headers: { access_token: key },
          signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) return { ok: true, detalhe: "responde" };
        return { ok: false, detalhe: `HTTP ${r.status}` };
      },
    ));

    /* -------------------------------------------------------- Gemini --- */
    testes.push(checar(
      {
        chave: "gemini",
        nome: "Gemini",
        para_que: "Lê documento, tria anexo e desempata nota.",
        conserto: "painel_supabase",
      },
      async () => {
        const key = Deno.env.get("GEMINI_API_KEY");
        if (!key) return { ok: false, detalhe: "GEMINI_API_KEY ausente" };
        /* Listar modelos não gasta cota de geração — é o ping mais barato. */
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) return { ok: true, detalhe: "responde" };
        return { ok: false, detalhe: `HTTP ${r.status}` };
      },
    ));

    /* -------------------------------------------------------- OpenAI --- */
    testes.push(checar(
      {
        chave: "openai",
        nome: "OpenAI",
        para_que: "Motor do Assistente e dos comentários da DRE.",
        conserto: "painel_supabase",
      },
      async () => {
        const key = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_KEY");
        if (!key) return { ok: false, detalhe: "OPENAI_API_KEY ausente" };
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) return { ok: true, detalhe: "responde" };
        return { ok: false, detalhe: `HTTP ${r.status}` };
      },
    ));

    const integracoes = await Promise.all(testes);

    return json({
      ok: true,
      gerado_em: new Date().toISOString(),
      integracoes,
      resumo: {
        total: integracoes.length,
        conectadas: integracoes.filter((i) => i.conectado === true).length,
        quebradas: integracoes.filter((i) => i.conectado === false).length,
        indefinidas: integracoes.filter((i) => i.conectado === null).length,
      },
    });
  } catch (e) {
    console.error("integracoes-status", e);
    const msg = String((e as Error)?.message ?? e);
    return json({ ok: false, error: msg }, /não autenticado|sem permissão/i.test(msg) ? 401 : 500);
  }
});
