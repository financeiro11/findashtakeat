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
import { ErroSheets, sheetsConfigurado, titulosDasAbas } from "../_shared/sheets.ts";

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
  conserto?: "gmail_oauth" | "painel_supabase" | "compartilhar_planilha" | "compartilhar_com_conta";
  /* SÓ `alta` INTERROMPE com modal (ver `avisos_graves_abertos`). A régua é o
     que se perde enquanto estiver quebrado: dado de dinheiro parando é alta;
     uma comodidade que atrasa trabalho é média. Marcar tudo como alta é o mesmo
     que não marcar nada — o modal vira clique automático em "Entendi". */
  gravidade?: "alta" | "media" | "baixa";
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

/* As planilhas que alimentam sync, e POR ONDE cada uma entra. O ID fica aqui
   repetido de propósito — a fonte da verdade é cada função, e duplicar 4 ids é
   mais barato que fazer quatro funções exportarem constante para uma tela de
   diagnóstico ler. Se um id mudar lá e não aqui, a checagem acusa "não abre" e
   alguém vem conferir, que é exatamente o comportamento desejado.

   O `via` NÃO É DETALHE: checar pelo caminho errado é pior que não checar. Esta
   tela nasceu acusando a planilha de churn como quebrada para as DUAS syncs que
   ela alimenta, quando o `estornos-sync` lê pelo conector e nunca parou — quem
   dependia do link público era só o `churn-sheet-sync`.

   DESDE 30/08/2026 NENHUMA SYNC ENTRA POR LINK PÚBLICO, e por isso não há mais
   checagem anônima aqui: as nativas vão pelo conector do Sheets, e o .xlsx de
   assinaturas (que o Sheets recusa, por ser Office file) pelo OAuth do
   financeiro@ no Drive.

     'conector' → conta Google conectada (`_shared/sheets.ts`).
     'drive'    → OAuth do financeiro@ (`_shared/gmail.ts` + Drive v3).
   Nos dois casos o conserto é o mesmo: compartilhar o arquivo com a conta. */
const PLANILHAS: { id: string; nome: string; usada: string; via: "conector" | "drive"; gravidade: "alta" | "media" }[] = [
  { id: "10A9YnskShPPZ2Xz9d-kN2SHCv-qN-48-94rQBbCNWIo", nome: "Churn e estornos", usada: "churn-sheet-sync, estornos-sync", via: "conector", gravidade: "alta" },
  { id: "110Vp0mA3r8OgGpODHxszllKIBsELSeqR", nome: "Assinaturas", usada: "assinaturas-sheet-sync", via: "drive", gravidade: "alta" },
  { id: "1fwt-sosZW-YRkV-uNyE06sE40ZLwdlkh3fjbo50VU8o", nome: "Proporcionais", usada: "proporcionais-sheet", via: "conector", gravidade: "alta" },
  { id: "17MOvrcc7OpMVPFxzoKn4Nufg0zKU33qgmvZ-N3eCwgk", nome: "Recargas e viagens", usada: "recargas-viagens-sheet", via: "conector", gravidade: "alta" },
  /* As CINCO de formulário (`_shared/planilhas-notas.ts`). Não eram checadas por
     ninguém: quando uma perdeu o compartilhamento, o jeito de descobrir foi um
     humano estranhar o número de notas. Média, e não alta: uma delas parada
     atrasa a captura de nota — não congela número de dinheiro na tela. */
  { id: "1Y2jvIpZDrwe30z3M_UVazzBv2BrtJJujT-S0SUt2JqM", nome: "Formulário de Compras", usada: "planilhas-nf-sync, parametrizacao-planilhas-sync", via: "conector", gravidade: "media" },
  { id: "1P7O1xRyrybuDQOfw3WIRkne15FOM7bBPMTWweMrCulA", nome: "Reembolsos - NFs", usada: "planilhas-nf-sync, parametrizacao-planilhas-sync", via: "conector", gravidade: "media" },
  { id: "1jd0-LRwWdElNBttQP0z-8bv_rJ-Hh92aX9eE2pL9uwc", nome: "NFS-e (colaboradores)", usada: "planilhas-nf-sync, parametrizacao-planilhas-sync", via: "conector", gravidade: "media" },
  { id: "1TQU3dph4qOTUpOXPCwp-bahVRxEORE9DjGKX3RRuCNs", nome: "NFs - Eventos & Parcerias", usada: "planilhas-nf-sync, parametrizacao-planilhas-sync", via: "conector", gravidade: "media" },
  { id: "1A_J9MPtdpCqA0PrafjA28KT-3HMBuQyGOtSCjZTfEEU", nome: "NFs - Parceiros (Novo)", usada: "planilhas-nf-sync", via: "conector", gravidade: "media" },
];

/* NOVE PLANILHAS DE UMA VEZ ESTOURAM A COTA. O limite de "Read requests per
   minute" do Sheets é do projeto Google do conector, que é COMPARTILHADO — cinco
   leituras simultâneas já devolveram 429 (medido em 30/08/2026). As checagens
   continuam começando juntas, mas passam por esta fila: uma de cada vez, ~300ms
   cada, o que cabe folgado no orçamento de 12s de cada uma. */
let fila: Promise<unknown> = Promise.resolve();
function emFila<T>(f: () => Promise<T>): Promise<T> {
  const p = fila.then(f, f);
  fila = p.catch(() => {});
  return p;
}

/** A planilha abre para a CONTA CONECTADA? Um metadado, nenhuma célula. */
async function checarPeloConector(id: string): Promise<{ ok: boolean; detalhe: string }> {
  if (!sheetsConfigurado()) {
    return { ok: false, detalhe: "conector do Google Sheets sem chave (LOVABLE_API_KEY / GOOGLE_SHEETS_API_KEY)" };
  }
  try {
    /* Sem retentativa: aqui o orçamento é de 12s por checagem, e esperar a cota
       do Google virar o minuto seguraria a tela inteira. */
    const abas = await emFila(() => titulosDasAbas(id, { tentativas: 0 }));
    return { ok: true, detalhe: `abre pela conta conectada (${abas.length} aba${abas.length === 1 ? "" : "s"})` };
  } catch (e) {
    /* 401/403/404 é veredito: a conta perdeu o acesso, ou a conexão morreu.
       Qualquer outra coisa (5xx, rede) sobe e vira "não deu para checar" — que
       é cinza, e não vermelho, porque não é a mesma informação. */
    if (e instanceof ErroSheets && [401, 403, 404].includes(e.status)) {
      return {
        ok: false,
        detalhe: e.status === 401
          ? "a conexão do Google Sheets no Lovable expirou ou foi revogada"
          : "a conta Google conectada não enxerga mais esta planilha",
      };
    }
    throw e;
  }
}

/** O arquivo abre para o financeiro@ no Drive? Só o metadado, sem baixar os 6 MB. */
async function checarNoDrive(supa: ReturnType<typeof createClient>, id: string): Promise<{ ok: boolean; detalhe: string }> {
  const s = await segredosDoGmail(supa);
  if (!s.refreshToken) return { ok: false, detalhe: "financeiro@ nunca foi conectado — autorize em Gmail e Drive" };

  const token = await tokenDeAcesso(s);
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) },
  );
  if (r.ok) {
    const nome = String(((await r.json().catch(() => ({}))) as { name?: string })?.name ?? "");
    return { ok: true, detalhe: `abre pela conta financeiro@${nome ? ` (${nome})` : ""}` };
  }
  // O Drive responde 404 — e não 403 — para o que a conta não pode ver.
  if (r.status === 403 || r.status === 404) {
    return { ok: false, detalhe: "a conta financeiro@ não enxerga este arquivo no Drive" };
  }
  return { ok: false, detalhe: `o Drive respondeu ${r.status}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    /* DUAS PORTAS. A tela chama com o usuário logado; o cron chama com
       `x-cron-token` para GRAVAR o veredito — e é da tabela gravada que o modal
       de aviso lê. Sem o caminho de cron, só saberia de uma integração quebrada
       quem fosse até a tela de Integrações, que é exatamente quem não precisa
       ser avisado. */
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supa.from("internal_cron_tokens")
        .select("name").eq("name", "integracoes-status").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const testes: Array<Promise<Estado>> = [];

    /* ---------------------------------------------------------- Gmail --- */
    testes.push(checar(
      {
        chave: "gmail",
        nome: "Gmail e Drive (financeiro@)",
        para_que: "Lê as notas que chegam por e-mail e responde pelo briefing.",
        conserto: "gmail_oauth",
        /* Média: parar de ler a caixa atrasa a captura de nota, mas nenhum
           número do Hub fica errado por causa disso. */
        gravidade: "media",
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
          conserto: "compartilhar_com_conta",
          gravidade: p.gravidade,
        },
        /* SEMPRE O MESMO CAMINHO QUE A SYNC USA. Uma checagem por outro caminho
           mente dos dois lados: passa verde com a planilha fechada para quem
           importa, ou pinta de vermelho uma sync que está viva. */
        async () => p.via === "conector"
          ? await checarPeloConector(p.id)
          : await checarNoDrive(supa, p.id),
      ));
    }

    /* ----------------------------------------------------------- Omie --- */
    testes.push(checar(
      {
        chave: "omie",
        // Alta: sem Omie, contas a pagar, caixa e DRE param de andar.
        gravidade: "alta",
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
        // Alta: é a entrada de dinheiro — cobrança, assinatura e estorno.
        gravidade: "alta",
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
        // Média: a IA para, o resto do Hub continua inteiro.
        gravidade: "media",
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
        gravidade: "media",
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

    /* GRAVA SEMPRE, não só no cron: quem abriu a tela acabou de produzir a
       leitura mais fresca que existe, e jogá-la fora obrigaria o modal a esperar
       o próximo cron para saber de algo que já se sabe.
       `null` (não deu para checar) NÃO é gravado como quebrado — sobrescrever um
       veredito bom com uma dúvida de rede faria o modal acusar falha que não
       houve. */
    const ajuda: Record<string, string> = {
      gmail_oauth: "Reconecte o Gmail em Configurações › Integrações.",
      painel_supabase: "É uma chave de ambiente: troque em Supabase › Edge Functions › Secrets.",
      compartilhar_planilha: 'Abra a planilha em Compartilhar e deixe "qualquer pessoa com o link" como leitor.',
      compartilhar_com_conta: "Compartilhe a planilha (leitor basta) com a conta Google conectada ao Hub.",
    };

    await Promise.all(integracoes.map(async (i) => {
      if (i.conectado === null) return;
      const { error } = await supa.rpc("integracao_estado_gravar", {
        p_chave: i.chave,
        p_nome: i.nome,
        p_para_que: i.para_que,
        p_conectado: i.conectado,
        p_detalhe: i.detalhe,
        p_causa: i.conectado ? null : i.detalhe,
        p_o_que_fazer: i.conectado ? null : (i.conserto ? ajuda[i.conserto] ?? null : null),
        p_gravidade: i.gravidade ?? "media",
      });
      if (error) console.error("integracao_estado_gravar", i.chave, error.message);
    }));

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
