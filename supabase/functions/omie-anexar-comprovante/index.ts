// Edge Function: omie-anexar-comprovante
//
// Pega os comprovantes que os gestores anexaram pelo link público (bucket privado
// `comprovantes-auditoria`) e os anexa no TÍTULO correspondente do Omie.
//
// Elegível = "aprovado com anexo", que na tela vem de DUAS origens:
//   • achado da tabela `auditoria` com status = "Aprovado" e link_comprovante; e
//   • lançamento do cartão com status_nf = "OK" e comprovante — a tela o exibe como
//     "Aprovado", mas ele NÃO existe em `auditoria` (é linha sintética do front).
//
// Nem todo elegível é enviável, e o motivo é informado item a item (`bloqueio`):
// comprovante no Google Drive (o servidor não tem credencial e o download devolve uma
// página de login), sem título correspondente no Omie, ou já enviado antes.
//
// O título do Omie NÃO está gravado em lugar nenhum (o omie-match-cartao só guardava a
// categoria), então ele é reencontrado aqui com a MESMA lógica de casamento
// (_shared/match-cartao.ts) — valor exato + data próxima + semelhança de texto.
//
// Confiança do casamento (decisão do cliente):
//   • "alta"  → pode enviar direto
//   • média / baixa / sem match → NÃO envia sozinho; o front lista e a pessoa confirma
//     uma a uma, vendo o título que foi encontrado.
// Se o título já tiver anexo no Omie, ACRESCENTA (nunca substitui).
//
// Ações (body.action):
//   "preview" → lista os elegíveis com o título encontrado. NÃO envia nada.
//   "enviar"  → envia. Params: { ids?: number[] } (ids de `auditoria`).
//               Sem `ids`, envia só os de confiança alta ainda não enviados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listarCategorias, listarMovimentos, omieCall } from "../_shared/omie.ts";
import { casarComOmie, indexarMovimentos, MatchResult } from "../_shared/match-cartao.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";

/** Uint8Array → base64, em blocos (String.fromCharCode(...bytes) estoura a pilha em PDFs grandes). */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const nomeDoPath = (p: string) => {
  const base = p.split("/").pop() || "comprovante";
  // o upload prefixa com timestamp ("1783626823462_nota.pdf") — tira para o Omie
  return base.replace(/^\d{10,}_/, "");
};
const extDe = (nome: string) =>
  (nome.includes(".") ? nome.split(".").pop()! : "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";

/**
 * O comprovante pode estar em dois lugares, e só UM deles o servidor consegue ler:
 *
 *   • caminho no bucket `comprovantes-auditoria` (o gestor subiu pelo link público)
 *     → dá para baixar com a service role e mandar ao Omie.
 *
 *   • URL do Google Drive (veio do n8n / preenchimento manual)
 *     → NÃO dá. Baixar sem credencial do Google devolve HTTP 200 com uma PÁGINA DE
 *       LOGIN em HTML (~900 KB). Se anexássemos isso no Omie, viraria um "comprovante"
 *       que só se revela falso quando alguém abre. Por isso é bloqueado explicitamente.
 */
const ehUrl = (v: string) => /^https?:\/\//i.test(v.trim());
const ehCaminhoStorage = (v: string) => !ehUrl(v) && v.includes("/");

type Motivo = null | "drive" | "sem_titulo" | "ja_enviado" | "comprovante_invalido";

type Item = {
  /** id na tabela `auditoria`; negativo = linha sintética vinda do cartão (não é achado) */
  achado_id: number;
  origem: "achado" | "cartao";
  titulo: string;
  valor: number;
  data: string | null;
  comprovante: string;
  cartao_id: number | null;
  cartao_id_unico: string | null;
  estabelecimento: string | null;
  ja_enviado_em: string | null;
  match: MatchResult | null;
  /** null = pode enviar; senão, por que não */
  bloqueio: Motivo;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "preview";
    const cTabela = String(body?.anexoTabela ?? "conta-pagar");

    /* -------- 1) Achados (tabela `auditoria`) Aprovados + com comprovante -------- */
    const { data: achados, error: achErr } = await supabase
      .from("auditoria")
      .select("id, id_unico, titulo, valor, data_lancamento, status, link_comprovante, id_transacao")
      .eq("status", "Aprovado")
      .not("link_comprovante", "is", null)
      .neq("link_comprovante", "");
    if (achErr) throw achErr;

    /* -------- 2) Lançamentos do cartão "aprovados direto" + com comprovante -------
     * A tela mostra como "Aprovado" também os lançamentos com status_nf = "OK", que NÃO
     * existem na tabela `auditoria` (são linhas sintéticas montadas pelo front). Eles
     * também contam como "aprovado com anexo" — ignorá-los era o motivo de o botão
     * dizer "nenhum item" com duas linhas Aprovadas na tela.
     */
    const { data: cartoesOk, error: cOkErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .select("id, id_unico, data, valor, estabelecimento, descricao_original, status_nf, link_comprovante, arquivo_comprovante, omie_anexo_enviado_em")
      .eq("status_nf", "OK")
      .not("link_comprovante", "is", null)
      .neq("link_comprovante", "");
    if (cOkErr) throw cOkErr;

    // Lançamentos de origem dos achados (para casar pelos dados do gasto real).
    const idsTransacao = [...new Set((achados ?? []).map((a: any) => a.id_transacao).filter(Boolean))] as string[];
    const { data: cartoes, error: cartErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .select("id, id_unico, data, valor, estabelecimento, descricao_original, omie_anexo_enviado_em")
      .in("id_unico", idsTransacao.length ? idsTransacao : ["__nenhum__"]);
    if (cartErr) throw cartErr;
    const cartaoPorId = new Map((cartoes ?? []).map((c: any) => [c.id_unico, c]));

    if (!achados?.length && !cartoesOk?.length) {
      return json({ ok: true, elegiveis: [], total: 0, aviso: "Nenhum lançamento Aprovado com comprovante anexado." });
    }

    /* -------- 3) Reencontra o título no Omie (mesma lógica do match-cartao) -------- */
    const [categorias, movimentos] = await Promise.all([listarCategorias(), listarMovimentos({})]);
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");
    const byValue = indexarMovimentos(movimentos);

    /** Decide por que um item não pode ser enviado (null = pode). */
    const motivo = (comprovante: string, match: MatchResult | null, jaEnviado: string | null): Motivo => {
      if (jaEnviado) return "ja_enviado";
      if (ehUrl(comprovante)) return "drive";              // servidor não consegue baixar
      if (!ehCaminhoStorage(comprovante)) return "comprovante_invalido"; // só o nome do arquivo
      if (!match?.codTitulo) return "sem_titulo";
      return null;
    };

    const daAuditoria: Item[] = (achados ?? []).map((a: any) => {
      const c = a.id_transacao ? cartaoPorId.get(a.id_transacao) : null;
      // Casa pelos dados do CARTÃO (é o gasto real). Sem lançamento de origem, cai para
      // os dados do próprio achado — pior, mas melhor que nada.
      const base = c ?? { valor: a.valor, data: a.data_lancamento, estabelecimento: a.titulo, descricao_original: null };
      const match = casarComOmie(base as any, byValue, codToDesc);
      const comprovante = String(a.link_comprovante ?? "");
      const jaEnviado = c?.omie_anexo_enviado_em ?? null;
      return {
        achado_id: a.id,
        origem: "achado" as const,
        titulo: a.titulo,
        valor: Number(a.valor ?? 0),
        data: a.data_lancamento ?? null,
        comprovante,
        cartao_id: c?.id ?? null,
        cartao_id_unico: c?.id_unico ?? null,
        estabelecimento: c?.estabelecimento ?? null,
        ja_enviado_em: jaEnviado,
        match: match?.codTitulo ? match : null,
        bloqueio: motivo(comprovante, match, jaEnviado),
      };
    });

    // Evita listar duas vezes o mesmo gasto (achado + lançamento de origem).
    const jaCobertos = new Set(daAuditoria.map((i) => i.cartao_id_unico).filter(Boolean));

    const doCartao: Item[] = (cartoesOk ?? [])
      .filter((c: any) => !jaCobertos.has(c.id_unico))
      .map((c: any) => {
        const match = casarComOmie(c as any, byValue, codToDesc);
        const comprovante = String(c.link_comprovante ?? "");
        return {
          // id sintético negativo: não existe achado correspondente em `auditoria`
          achado_id: -c.id,
          origem: "cartao" as const,
          titulo: c.estabelecimento || c.descricao_original || "Lançamento com nota",
          valor: Number(c.valor ?? 0),
          data: c.data ?? null,
          comprovante,
          cartao_id: c.id,
          cartao_id_unico: c.id_unico,
          estabelecimento: c.estabelecimento ?? null,
          ja_enviado_em: c.omie_anexo_enviado_em ?? null,
          match: match?.codTitulo ? match : null,
          bloqueio: motivo(comprovante, match, c.omie_anexo_enviado_em ?? null),
        };
      });

    const elegiveis: Item[] = [...daAuditoria, ...doCartao];

    /* -------- PREVIEW -------- */
    if (action === "preview") {
      return json({
        ok: true,
        total: elegiveis.length,
        // O front usa isso para separar "envia direto", "confirmar" e "não dá".
        elegiveis: elegiveis.map((e) => ({
          ...e,
          pode_enviar_direto: !e.bloqueio && e.match?.conf === "alta",
        })),
      });
    }

    /* -------- ENVIAR -------- */
    if (action !== "enviar") return json({ error: `Ação desconhecida: ${action}` }, 200);

    const idsPedidos: number[] | null = Array.isArray(body?.ids) ? body.ids.map(Number) : null;
    const alvos = elegiveis.filter((e) => {
      // `bloqueio` já cobre: já enviado, comprovante no Drive, sem título, nome solto.
      // Nenhum deles é contornável pela confirmação do usuário — não é questão de
      // confiança, é que o arquivo ou o destino não existem para o servidor.
      if (e.bloqueio) return false;
      // Sem lista explícita → só os de confiança alta. Com lista → a pessoa já confirmou.
      return idsPedidos ? idsPedidos.includes(e.achado_id) : e.match!.conf === "alta";
    });

    const enviados: any[] = [];
    const falhas: any[] = [];

    for (const e of alvos) {
      try {
        // 3a) Baixa o arquivo do bucket privado (service role passa pela RLS).
        const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(e.comprovante);
        if (dlErr || !blob) throw new Error(`Falha ao baixar do storage: ${dlErr?.message ?? "arquivo não encontrado"}`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const nome = nomeDoPath(e.comprovante);

        // Cinto de segurança: nunca anexar uma página HTML no Omie. Se um dia o
        // comprovante vier de uma origem que exige login (Drive, por exemplo), o
        // download "bem-sucedido" é a tela de login — e viraria um anexo falso.
        const cabecalho = new TextDecoder().decode(bytes.subarray(0, 64)).trim().toLowerCase();
        if (cabecalho.startsWith("<!doctype html") || cabecalho.startsWith("<html")) {
          throw new Error("O arquivo baixado é uma página HTML, não um comprovante.");
        }
        if (bytes.length === 0) throw new Error("Arquivo vazio.");

        // 3b) Anexa no título do Omie. "Sempre acrescentar": não listamos nem excluímos
        // os anexos que já existem lá — o IncluirAnexo entra ao lado deles.
        await omieCall("geral/anexo", "IncluirAnexo", {
          cCodIntAnexo: `hub-ach-${e.achado_id}-${Date.now()}`,
          cTabela,
          nId: Number(e.match!.codTitulo),
          cNomeArquivo: nome,
          cTipoArquivo: extDe(nome),
          cArquivo: toBase64(bytes),
        });

        const agora = new Date().toISOString();

        // 3c) Registra no lançamento do cartão (idempotência + rastreio).
        if (e.cartao_id) {
          await supabase.from("auditoria_cartao_lancamentos").update({
            omie_cod_titulo: e.match!.codTitulo,
            omie_anexo_enviado_em: agora,
            omie_anexo_nome: nome,
            updated_at: agora,
          }).eq("id", e.cartao_id);
        }

        // 3d) Deixa rastro na trilha do achado — só existe quando a origem é a tabela
        // `auditoria`. As linhas vindas do cartão têm id sintético (negativo) e não têm
        // achado correspondente; para elas o rastro é o omie_anexo_enviado_em acima.
        if (e.origem === "achado") {
          const { data: atual } = await supabase.from("auditoria").select("trilha").eq("id", e.achado_id).maybeSingle();
          const trilha = Array.isArray((atual as any)?.trilha) ? (atual as any).trilha : [];
          await supabase.from("auditoria").update({
            trilha: [...trilha, {
              evento: "comprovante_enviado_omie",
              canal: "hub",
              omie_cod_titulo: e.match!.codTitulo,
              confianca: e.match!.conf,
              arquivo: nome,
              timestamp: agora,
            }],
            updated_at: agora,
          }).eq("id", e.achado_id);
        }

        enviados.push({
          achado_id: e.achado_id, titulo: e.titulo,
          omie_cod_titulo: e.match!.codTitulo, confianca: e.match!.conf, arquivo: nome,
        });
      } catch (err) {
        falhas.push({
          achado_id: e.achado_id, titulo: e.titulo,
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return json({
      ok: true,
      enviados: enviados.length,
      falhas: falhas.length,
      detalhe_enviados: enviados,
      detalhe_falhas: falhas,
      ignorados: elegiveis.length - alvos.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message
      : (e && typeof e === "object")
        ? ([(e as any).message, (e as any).details, (e as any).hint].filter(Boolean).join(" — ") || JSON.stringify(e))
        : String(e);
    console.error("omie-anexar-comprovante error:", msg);
    return json({ error: msg }, 200);
  }
});
