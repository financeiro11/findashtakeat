// Edge Function: omie-match-cartao
// Cruza cada lançamento do cartão (auditoria_cartao_lancamentos) com o movimento
// financeiro correspondente no Omie, para saber a CATEGORIA CONTÁBIL do gasto.
//
// Não há ID compartilhado, então o casamento é por VALOR (exato) + DATA (mais próxima,
// dentro de uma janela) e desempate por SEMELHANÇA da descrição/estabelecimento.
//
// Ações (body.action):
//   "preview" → devolve uma amostra de casamentos (card ↔ omie) SEM gravar, para validar
//   "match"   → grava a categoria do Omie em cada lançamento (colunas omie_categoria_*)
//
// Params opcionais: { referencia?: "YYYY-MM", maxDias?: number, reprocess?: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listarCategorias, listarMovimentos } from "../_shared/omie.ts";
// A lógica de casamento vive em _shared porque `omie-anexar-comprovante` também precisa
// dela: ela decide a CATEGORIA aqui e o TÍTULO onde o comprovante é anexado lá. Se cada
// função tivesse sua cópia, o anexo poderia ir para um título diferente do que esta tela
// mostra como categoria.
import { casarComOmie, indexarMovimentos } from "../_shared/match-cartao.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "match";
    const maxDias = Number(body?.maxDias ?? 10);

    // 1) Lançamentos do cartão a casar
    let q = supabase
      .from("auditoria_cartao_lancamentos")
      .select("id,id_unico,data,valor,estabelecimento,descricao_original,referencia")
      .limit(10000);
    if (body?.referencia) q = q.eq("referencia", body.referencia);
    if (!body?.reprocess) q = q.is("omie_categoria_codigo", null);
    const { data: cards, error: cardErr } = await q;
    if (cardErr) throw cardErr;

    // 2) Categorias do Omie (código → descrição)
    const categorias = await listarCategorias();
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");

    // 3) Movimentos do Omie → índice por valor (mesmo índice que o envio de anexo usa)
    const movimentos = await listarMovimentos({});
    const byValue = indexarMovimentos(movimentos);

    // 4) Casamento
    type Res = { id: number; id_unico: string; matched: boolean; codigo?: string; descricao?: string; conf?: string; dias?: number; sim?: number; estabelecimento?: string; valor?: number };
    const results: Res[] = [];
    for (const c of (cards ?? []) as any[]) {
      const m = casarComOmie(c, byValue, codToDesc, maxDias);
      if (!m) {
        results.push({ id: c.id, id_unico: c.id_unico, matched: false, estabelecimento: c.estabelecimento, valor: Number(c.valor ?? 0) });
        continue;
      }
      results.push({
        id: c.id, id_unico: c.id_unico, matched: true,
        codigo: m.codigo, descricao: m.descricao, conf: m.conf, dias: m.dias, sim: m.sim,
        estabelecimento: c.estabelecimento, valor: Number(c.valor ?? 0),
      });
    }

    // 5) PREVIEW: amostra sem gravar
    if (action === "preview") {
      return json({
        ok: true,
        total_lancamentos: cards?.length ?? 0,
        total_movimentos_omie: omieItems.length,
        amostra: results.slice(0, 30),
      });
    }

    // 6) MATCH: grava agrupando por (codigo, descricao, confiança) → poucos UPDATEs
    const agrupado = new Map<string, { codigo: string; descricao: string; conf: string; ids: number[] }>();
    for (const r of results) {
      if (!r.matched) continue;
      const key = `${r.codigo}|${r.conf}`;
      const g = agrupado.get(key) ?? { codigo: r.codigo!, descricao: r.descricao!, conf: r.conf!, ids: [] };
      g.ids.push(r.id);
      agrupado.set(key, g);
    }
    const agora = new Date().toISOString();
    let casados = 0;
    for (const g of agrupado.values()) {
      const { error } = await supabase
        .from("auditoria_cartao_lancamentos")
        .update({
          omie_categoria_codigo: g.codigo,
          omie_categoria_descricao: g.descricao,
          omie_match_confianca: g.conf,
          omie_matched_em: agora,
        })
        .in("id", g.ids);
      if (error) throw error;
      casados += g.ids.length;
    }

    const semMatch = results.filter((r) => !r.matched).length;
    const porConf = (c: string) => results.filter((r) => r.matched && r.conf === c).length;
    return json({
      ok: true,
      total: cards?.length ?? 0,
      casados,
      sem_match: semMatch,
      alta: porConf("alta"),
      media: porConf("media"),
      baixa: porConf("baixa"),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-match-cartao error:", msg);
    return json({ error: msg }, 200);
  }
});
