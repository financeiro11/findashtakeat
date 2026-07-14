// Edge Function: omie-anexar-comprovante
//
// Pega os comprovantes que os gestores anexaram pelo link público (bucket privado
// `comprovantes-auditoria`) e os anexa no TÍTULO correspondente do Omie.
//
// Elegível = achado (tabela `auditoria`) com:
//   • status = "Aprovado"  E
//   • link_comprovante preenchido (caminho no bucket)  E
//   • id_transacao apontando para um lançamento do cartão
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

type Elegivel = {
  achado_id: number;
  achado_id_unico: string;
  titulo: string;
  valor: number;
  data: string | null;
  storage_path: string;
  cartao_id: number | null;
  cartao_id_unico: string | null;
  estabelecimento: string | null;
  ja_enviado_em: string | null;
  match: MatchResult | null;
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

    /* -------- 1) Achados elegíveis: Aprovado + com comprovante -------- */
    const { data: achados, error: achErr } = await supabase
      .from("auditoria")
      .select("id, id_unico, titulo, valor, data_lancamento, status, link_comprovante, id_transacao")
      .eq("status", "Aprovado")
      .not("link_comprovante", "is", null)
      .neq("link_comprovante", "");
    if (achErr) throw achErr;

    if (!achados?.length) {
      return json({ ok: true, elegiveis: [], total: 0, aviso: "Nenhum achado Aprovado com comprovante anexado." });
    }

    /* -------- 2) Lançamentos do cartão correspondentes -------- */
    const idsTransacao = [...new Set(achados.map((a: any) => a.id_transacao).filter(Boolean))] as string[];
    const { data: cartoes, error: cartErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .select("id, id_unico, data, valor, estabelecimento, descricao_original, omie_cod_titulo, omie_anexo_enviado_em")
      .in("id_unico", idsTransacao.length ? idsTransacao : ["__nenhum__"]);
    if (cartErr) throw cartErr;
    const cartaoPorId = new Map((cartoes ?? []).map((c: any) => [c.id_unico, c]));

    /* -------- 3) Reencontra o título no Omie (mesma lógica do match-cartao) -------- */
    const [categorias, movimentos] = await Promise.all([listarCategorias(), listarMovimentos({})]);
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");
    const byValue = indexarMovimentos(movimentos);

    const elegiveis: Elegivel[] = achados.map((a: any) => {
      const c = a.id_transacao ? cartaoPorId.get(a.id_transacao) : null;
      // Casa pelos dados do CARTÃO (é o gasto real). Sem lançamento de origem, cai para
      // os dados do próprio achado — pior, mas melhor que nada.
      const base = c ?? { valor: a.valor, data: a.data_lancamento, estabelecimento: a.titulo, descricao_original: null };
      const match = casarComOmie(base as any, byValue, codToDesc);
      return {
        achado_id: a.id,
        achado_id_unico: a.id_unico,
        titulo: a.titulo,
        valor: Number(a.valor ?? 0),
        data: a.data_lancamento ?? null,
        storage_path: a.link_comprovante,
        cartao_id: c?.id ?? null,
        cartao_id_unico: c?.id_unico ?? null,
        estabelecimento: c?.estabelecimento ?? null,
        ja_enviado_em: c?.omie_anexo_enviado_em ?? null,
        match: match && match.codTitulo ? match : null,
      };
    });

    /* -------- PREVIEW -------- */
    if (action === "preview") {
      return json({
        ok: true,
        total: elegiveis.length,
        // O front usa isso para separar "envia direto" de "precisa confirmar".
        elegiveis: elegiveis.map((e) => ({
          ...e,
          pode_enviar_direto: e.match?.conf === "alta" && !e.ja_enviado_em,
        })),
      });
    }

    /* -------- ENVIAR -------- */
    if (action !== "enviar") return json({ error: `Ação desconhecida: ${action}` }, 200);

    const idsPedidos: number[] | null = Array.isArray(body?.ids) ? body.ids.map(Number) : null;
    const alvos = elegiveis.filter((e) => {
      if (e.ja_enviado_em && !body?.reenviar) return false;  // idempotente: não duplica no clique repetido
      if (!e.match?.codTitulo) return false;                 // sem título no Omie não há onde anexar
      // Sem lista explícita → só os de confiança alta. Com lista → a pessoa já confirmou.
      return idsPedidos ? idsPedidos.includes(e.achado_id) : e.match.conf === "alta";
    });

    const enviados: any[] = [];
    const falhas: any[] = [];

    for (const e of alvos) {
      try {
        // 3a) Baixa o arquivo do bucket privado (service role passa pela RLS).
        const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(e.storage_path);
        if (dlErr || !blob) throw new Error(`Falha ao baixar do storage: ${dlErr?.message ?? "arquivo não encontrado"}`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const nome = nomeDoPath(e.storage_path);

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

        // 3d) Deixa rastro na trilha do achado.
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
