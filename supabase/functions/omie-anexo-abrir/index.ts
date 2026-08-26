// Edge Function: omie-anexo-abrir
//
// ABRE, DENTRO DO HUB, O ARQUIVO QUE DECIDE A PERGUNTA.
//
// Por que existe. A aba "Anexo a conferir" pede uma decisão — "é a nota deste
// título?" — e não mostrava o arquivo. O nome dele, sim: `nf_undefined_correta.pdf`,
// `5aef68b9-…​.tmp.pdf`, `whatsappimage2026-04-02at16.05.40 (2).jpeg`. Decidir
// por esses nomes é adivinhar; ir buscar cada um no Omie, à mão, é o trabalho
// que a tela existe para poupar. Fila que não dá para julgar não é fila: é uma
// lista que ninguém abre duas vezes.
//
// DUAS PROCEDÊNCIAS, UM BOTÃO SÓ. O arquivo pode estar em dois lugares, e a
// pessoa não deveria precisar saber em qual:
//
//   "erp" → dentro do Omie. `geral/anexo/ObterAnexo` devolve um link temporário
//           (ou o conteúdo). É o caso do "Anexo a conferir" e do "Com nota".
//   "hub" → aqui: o bucket privado da auditoria, ou um arquivo do Drive. É o
//           caso do "Pronta para subir" — o Hub tem, o ERP ainda não.
//
// LEITURA PURA. Nada aqui escreve no ERP nem no banco. Quem sobe arquivo é a
// `omie-anexar-comprovante`; quem lê a existência do anexo é a
// `omie-anexos-varredura`.
//
// A PORTA É DE USUÁRIO, e sem atalho de cron: isto devolve o CONTEÚDO de
// documento fiscal, e trabalho de fundo não tem por que ler documento nenhum.
//
// Ações (body.action):
//   "erp"   → { cod_titulo, id_anexo?, c_tabela? } → { nome, tipo, url | base64 }
//   "hub"   → { cod_titulo }                       → { nome, fonte, url }
//   "sonda" → { cod_titulo, id_anexo? }            → a resposta CRUA do Omie,
//             com os valores longos cortados. Diagnóstico: a API do Omie mudou
//             de campo mais de uma vez, e adivinhar qual deles é o link foi o
//             que fez a `omie-pix-sync` gravar 348 anexos com `comprovante_url`
//             vazio — um link que não existe, guardado como se existisse.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { omieCall } from "../_shared/omie-rpc.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
/** Uma janela curta: o link é para OLHAR agora, não para guardar. */
const VALIDADE_S = 60 * 30;

const ehUrl = (v: string) => /^https?:\/\//i.test(String(v ?? "").trim());

/** O tipo pelo nome do arquivo — o Omie nem sempre manda o dele. */
function tipoDoNome(nome: string): string {
  const ext = String(nome ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "xml") return "application/xml";
  return "application/octet-stream";
}

/**
 * O link (ou o conteúdo) dentro de uma resposta cujo formato o Omie já trocou.
 *
 * Procurar por NOME DE CAMPO conhecido é o que quebra em silêncio quando eles
 * renomeiam: `cUrl` some, o código não erra, e a coluna guarda string vazia.
 * Aqui a busca é pelo FORMATO — qualquer texto que comece com http, qualquer
 * texto grande que pareça base64 — varrendo o objeto inteiro. Se o Omie mudar o
 * nome do campo de novo, isto continua achando.
 */
function acharConteudo(o: unknown, prof = 0): { url?: string; base64?: string } {
  if (prof > 6 || o === null || o === undefined) return {};
  if (typeof o === "string") {
    const s = o.trim();
    if (/^https?:\/\//i.test(s)) return { url: s };
    if (s.length > 512 && /^[A-Za-z0-9+/=\r\n]+$/.test(s)) return { base64: s.replace(/\s/g, "") };
    return {};
  }
  if (Array.isArray(o)) {
    for (const it of o) {
      const r = acharConteudo(it, prof + 1);
      if (r.url || r.base64) return r;
    }
    return {};
  }
  if (typeof o === "object") {
    let base64: string | undefined;
    for (const v of Object.values(o as Record<string, unknown>)) {
      const r = acharConteudo(v, prof + 1);
      if (r.url) return r;               // link vence conteúdo: mais barato de servir
      if (r.base64 && !base64) base64 = r.base64;
    }
    return base64 ? { base64 } : {};
  }
  return {};
}

/** A resposta crua, legível: valores longos viram "«base64 de N chars»". */
function encurtar(o: unknown, prof = 0): unknown {
  if (typeof o === "string") return o.length > 220 ? `«texto de ${o.length} chars: ${o.slice(0, 60)}…»` : o;
  if (Array.isArray(o)) return prof > 4 ? "«…»" : o.slice(0, 5).map((x) => encurtar(x, prof + 1));
  if (o && typeof o === "object") {
    if (prof > 4) return "«…»";
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, encurtar(v, prof + 1)]));
  }
  return o;
}

/* ============================================================================
 *  O anexo que está dentro do Omie
 * ========================================================================== */

type AnexoGravado = { id: string | null; nome: string | null; tipo: string | null };

/**
 * Qual anexo abrir, e em que tabela.
 *
 * Vem do que a varredura JÁ leu (`omie_titulo_anexo`), e não de um `ListarAnexo`
 * novo: a trava do Omie é por método, e é a mesma que a varredura e o envio de
 * comprovante disputam. Gastar uma chamada de listagem para descobrir o que já
 * está gravado aqui seria pagar duas vezes pela mesma informação — e roubar a
 * vez de quem está varrendo.
 */
async function anexoAlvo(supabase: any, codTitulo: number, idAnexo?: string | null) {
  const { data, error } = await supabase
    .from("omie_titulo_anexo")
    .select("c_tabela, anexos")
    .eq("cod_titulo", codTitulo)
    .maybeSingle();
  if (error) throw new Error(`Não deu para ler o anexo gravado: ${error.message}`);

  const anexos: AnexoGravado[] = Array.isArray(data?.anexos) ? data.anexos : [];
  if (!anexos.length) {
    throw new Error("Este título não tem anexo lido no Omie. Varra o ERP e tente de novo.");
  }
  const alvo = idAnexo ? anexos.find((a) => String(a.id) === String(idAnexo)) : anexos[0];
  if (!alvo) throw new Error(`O anexo ${idAnexo} não está na leitura deste título.`);
  return { cTabela: String(data?.c_tabela ?? "conta-pagar"), anexo: alvo };
}

/* O link que já está guardado, se ainda vale.
 *
 * Servir daqui é o que faz o segundo clique ser instantâneo — e, com o
 * aquecimento, o primeiro também. Ver a migration `20260826200000`. */
async function linkGuardado(supabase: any, codTitulo: number, idAnexo: string) {
  const { data } = await supabase
    .from("omie_anexo_link")
    .select("nome, tipo, url, expira_em")
    .eq("cod_titulo", codTitulo).eq("id_anexo", idAnexo)
    .gt("expira_em", new Date().toISOString())
    .maybeSingle();
  return data?.url ? data : null;
}

/** Seis horas, bem abaixo do dia inteiro que o Omie promete. */
const VALIDADE_LINK_MS = 6 * 60 * 60 * 1000;

async function guardarLink(
  supabase: any, codTitulo: number, idAnexo: string,
  v: { nome: string; tipo: string; url: string },
) {
  await supabase.from("omie_anexo_link").upsert({
    cod_titulo: codTitulo, id_anexo: idAnexo,
    nome: v.nome, tipo: v.tipo, url: v.url,
    expira_em: new Date(Date.now() + VALIDADE_LINK_MS).toISOString(),
    lido_em: new Date().toISOString(),
  }, { onConflict: "cod_titulo,id_anexo" });
}

async function abrirNoErp(
  supabase: any, codTitulo: number, idAnexo?: string | null,
  cTabelaForcada?: string, atualizar = false,
) {
  const { cTabela, anexo } = await anexoAlvo(supabase, codTitulo, idAnexo);
  const nome = anexo.nome ?? "anexo";
  const chaveAnexo = String(anexo.id ?? "");

  if (!atualizar) {
    const guardado = await linkGuardado(supabase, codTitulo, chaveAnexo);
    if (guardado) {
      return {
        fonte: "erp" as const,
        nome: guardado.nome ?? nome,
        tipo: guardado.tipo ?? (anexo.tipo || tipoDoNome(nome)),
        url: guardado.url,
        doCache: true,
      };
    }
  }

  const r = await omieCall<any>("geral/anexo", "ObterAnexo", {
    nId: codTitulo,
    cTabela: cTabelaForcada || cTabela,
    ...(anexo.id ? { nIdAnexo: Number(anexo.id) } : { cNomeArquivo: nome }),
  });

  const { url, base64 } = acharConteudo(r);
  if (!url && !base64) {
    throw new Error(
      "O Omie respondeu, mas sem link nem conteúdo do arquivo — abra o título no ERP por enquanto.",
    );
  }
  const tipo = anexo.tipo || tipoDoNome(nome);
  /* Só o LINK é guardado. Quando vem base64, o arquivo pode ter megabytes e a
     tabela viraria depósito de documento fiscal — ver a migration. */
  if (url) await guardarLink(supabase, codTitulo, chaveAnexo, { nome, tipo, url });

  return {
    fonte: "erp" as const,
    nome,
    tipo,
    ...(url ? { url } : { base64 }),
    doCache: false,
  };
}

/* ============================================================================
 *  Aquecer: buscar o link ANTES de alguém clicar
 * ==========================================================================
 * O primeiro clique é o que doía — o segundo já vinha do cache. Esta ação
 * enche o cache da fila de conferência de fora do caminho de quem está olhando:
 * o cron chama de tempos em tempos, e a aba dispara ao abrir.
 *
 * Orçamento curto e lote pequeno porque cada item custa uma vez na fila do
 * Omie; o que não couber fica para a próxima rodada. */

const ORCAMENTO_AQUECER_MS = 40_000;

async function aquecer(supabase: any, limite: number) {
  const { data: fila, error } = await supabase.rpc("omie_anexo_link_fila", { p_limite: limite });
  if (error) throw new Error(`não deu para ler a fila: ${error.message}`);

  const comecou = Date.now();
  let prontos = 0, falhas = 0;
  const erros: string[] = [];

  for (const item of (fila ?? []) as any[]) {
    if (Date.now() - comecou > ORCAMENTO_AQUECER_MS) break;
    try {
      await abrirNoErp(supabase, Number(item.cod_titulo), item.id_anexo || null, item.c_tabela, true);
      prontos++;
    } catch (e) {
      falhas++;
      const msg = e instanceof Error ? e.message : String(e);
      if (erros.length < 3) erros.push(`${item.cod_titulo}: ${msg.slice(0, 120)}`);
    }
  }
  return { prontos, falhas, na_fila: (fila ?? []).length, erros };
}

/* ============================================================================
 *  A nota que o Hub tem
 * ==========================================================================
 * As MESMAS quatro origens que a view `cap_titulos` conta como "o Hub tem a
 * nota" — em ordem de preferência: o que a auditoria aprovou primeiro, o que o
 * Drive achou por último. Duas cópias da lista seriam duas coisas para
 * desatualizar, e a discordância apareceria como um botão que não abre nada. */

type NoHub = { fonte: string; caminho: string; nome: string | null };

async function acharNoHub(supabase: any, codTitulo: number): Promise<NoHub | null> {
  const cod = String(codTitulo);

  const { data: ach } = await supabase
    .from("auditoria").select("link_comprovante, titulo")
    .eq("omie_cod_titulo", cod).not("link_comprovante", "is", null).neq("link_comprovante", "")
    .limit(1).maybeSingle();
  if (ach?.link_comprovante) return { fonte: "auditoria", caminho: ach.link_comprovante, nome: ach.titulo ?? null };

  const { data: car } = await supabase
    .from("auditoria_cartao_lancamentos").select("link_comprovante, estabelecimento")
    .eq("omie_cod_titulo", cod).not("link_comprovante", "is", null).neq("link_comprovante", "")
    .limit(1).maybeSingle();
  if (car?.link_comprovante) return { fonte: "cartão", caminho: car.link_comprovante, nome: car.estabelecimento ?? null };

  const { data: fac } = await supabase
    .from("facilities_compras").select("nf_arquivo, item")
    .eq("omie_cod_titulo", cod).not("nf_arquivo", "is", null).neq("nf_arquivo", "")
    .limit(1).maybeSingle();
  if (fac?.nf_arquivo) return { fonte: "facilities", caminho: fac.nf_arquivo, nome: fac.item ?? null };

  // O Drive guarda o ID do arquivo, não um link — o link se monta.
  const { data: dri } = await supabase
    .from("comprovantes_drive").select("drive_id, nome_arquivo")
    .eq("cod_titulo", cod).limit(1).maybeSingle();
  if (dri?.drive_id) {
    return {
      fonte: "drive",
      caminho: `https://drive.google.com/file/d/${dri.drive_id}/view`,
      nome: dri.nome_arquivo ?? null,
    };
  }
  return null;
}

async function abrirNoHub(supabase: any, codTitulo: number) {
  const achado = await acharNoHub(supabase, codTitulo);
  if (!achado) throw new Error("O Hub não tem arquivo para este título.");

  // Link do Drive abre como está: quem tem acesso à pasta abre, e o Hub não
  // tem por que virar proxy de um arquivo que já mora num lugar com dono.
  if (ehUrl(achado.caminho)) {
    return { fonte: achado.fonte, nome: achado.nome ?? "comprovante", url: achado.caminho, externo: true };
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(achado.caminho, VALIDADE_S);
  if (error || !data?.signedUrl) {
    throw new Error(`Não deu para abrir o arquivo do bucket: ${error?.message ?? "arquivo não encontrado"}`);
  }
  const nome = (achado.caminho.split("/").pop() || "comprovante").replace(/^\d{10,}_/, "");
  return { fonte: achado.fonte, nome, url: data.signedUrl, externo: false };
}

/* ========================================================================== */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "erp");

    /* AQUECER É A ÚNICA AÇÃO COM ATALHO DE CRON, e ela não devolve documento
       nenhum: só enche o cache de links. As outras continuam exigindo usuário —
       elas servem o CONTEÚDO de documento fiscal, e trabalho de fundo não tem
       por que ler documento. */
    if (action === "aquecer") {
      const token = req.headers.get("x-cron-token");
      if (!token) await requireUser(req, { bloquearCargos: ["parcerias"] });
      else {
        const { data: ok } = await supabase.from("internal_cron_tokens")
          .select("name").eq("name", "omie-anexo-abrir").eq("token", token).maybeSingle();
        if (!ok) return json({ erro: "token inválido" }, 401);
      }
      const limite = Math.min(Math.max(1, Number(body?.limite) || 8), 40);
      return json({ ok: true, ...(await aquecer(supabase, limite)) });
    }

    await requireUser(req, { bloquearCargos: ["parcerias"] });

    const cod = Number(body?.cod_titulo ?? 0);
    if (!cod) return json({ erro: "Informe cod_titulo." }, 400);

    if (action === "hub") return json({ ok: true, ...(await abrirNoHub(supabase, cod)) });

    if (action === "sonda") {
      const { cTabela, anexo } = await anexoAlvo(supabase, cod, body?.id_anexo);
      const cru = await omieCall<any>("geral/anexo", "ObterAnexo", {
        nId: cod,
        cTabela: String(body?.c_tabela ?? cTabela),
        ...(anexo.id ? { nIdAnexo: Number(anexo.id) } : { cNomeArquivo: anexo.nome }),
      });
      return json({ ok: true, pedido: { cod, cTabela, anexo }, resposta: encurtar(cru) });
    }

    if (action === "erp") {
      return json({
        ok: true,
        ...(await abrirNoErp(supabase, cod, body?.id_anexo, body?.c_tabela, body?.atualizar === true)),
      });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    console.error("omie-anexo-abrir:", msg);
    return json({ erro: msg }, 500);
  }
});
