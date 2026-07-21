// Edge Function: omie-match-cartao
// Cruza cada lançamento do cartão (auditoria_cartao_lancamentos) e cada achado sem vínculo
// (auditoria) com o movimento financeiro correspondente no Omie, para saber a CATEGORIA
// CONTÁBIL do gasto E o TÍTULO do Omie de onde ela veio.
//
// Não há ID compartilhado, então o casamento é por VALOR (exato) + DATA (mais próxima,
// dentro de uma janela) e desempate por SEMELHANÇA da descrição/estabelecimento.
//
// Grava, por lançamento: omie_categoria_codigo/descricao, omie_match_confianca e
// omie_cod_titulo (o nCodTitulo). A PRESENÇA do omie_cod_titulo é a prova de que a
// categoria veio de um movimento REAL do Omie — sem ele, era só "a categoria que casaria".
//
// Ações (body.action):
//   "preview" → devolve uma amostra de casamentos (card ↔ omie) SEM gravar, para validar
//   "match"   → grava categoria + confiança + id do título em cada lançamento
//
// Params opcionais: { referencia?: "YYYY-MM", competencia?: "YYYY-MM-DD", maxDias?, reprocess? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listarCategorias, listarMovimentos } from "../_shared/omie.ts";
// A lógica de casamento vive em _shared porque `omie-anexar-comprovante` também precisa
// dela: decide a CATEGORIA aqui e o TÍTULO onde o comprovante é anexado lá. Se cada função
// tivesse sua cópia, o anexo poderia ir para um título diferente do que esta tela mostra.
import { casarComOmie, indexarMovimentos, MatchResult } from "../_shared/match-cartao.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Linha = { id: number; match: MatchResult | null };

// Grava os casamentos em `tabela`, agrupando por (codTitulo, codigo, confiança) para
// reduzir UPDATEs, e rodando os grupos em lotes paralelos (o id do título é ~único por
// linha, então sem os lotes seriam centenas de chamadas sequenciais — estouraria o tempo).
async function gravar(
  supabase: any,
  tabela: string,
  linhas: Linha[],
  agora: string,
): Promise<number> {
  const grupos = new Map<string, { codigo: string; descricao: string; conf: string; codTitulo: string; ids: number[] }>();
  for (const l of linhas) {
    if (!l.match?.codTitulo) continue;
    const m = l.match;
    const key = `${m.codTitulo}|${m.codigo}|${m.conf}`;
    const g = grupos.get(key) ?? { codigo: m.codigo, descricao: m.descricao, conf: m.conf, codTitulo: m.codTitulo, ids: [] };
    g.ids.push(l.id);
    grupos.set(key, g);
  }

  const lista = [...grupos.values()];
  let casados = 0;
  const LOTE = 25;
  for (let i = 0; i < lista.length; i += LOTE) {
    const parte = lista.slice(i, i + LOTE);
    const res = await Promise.all(parte.map((g) =>
      supabase.from(tabela).update({
        omie_categoria_codigo: g.codigo,
        omie_categoria_descricao: g.descricao,
        omie_match_confianca: g.conf,
        omie_cod_titulo: g.codTitulo,
        omie_matched_em: agora,
      }).in("id", g.ids),
    ));
    for (let j = 0; j < res.length; j++) {
      if (res[j].error) throw res[j].error;
      casados += parte[j].ids.length;
    }
  }
  return casados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "match";
    const maxDias = Number(body?.maxDias ?? 10);

    // Índice do Omie (categorias + movimentos por valor). O casarComOmie devolve o codTitulo.
    const [categorias, movimentos] = await Promise.all([listarCategorias(), listarMovimentos({})]);
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");
    const byValue = indexarMovimentos(movimentos);

    // 1) Lançamentos do cartão. Sem reprocess: pega os que ainda não têm categoria OU não têm
    //    o id do título (assim um lançamento antigo, casado antes desta melhoria, ganha o id).
    let q = supabase
      .from("auditoria_cartao_lancamentos")
      .select("id,id_unico,data,valor,estabelecimento,descricao_original,referencia")
      .limit(10000);
    if (body?.referencia) q = q.eq("referencia", body.referencia);
    if (!body?.reprocess) q = q.or("omie_categoria_codigo.is.null,omie_cod_titulo.is.null");
    const { data: cards, error: cardErr } = await q;
    if (cardErr) throw cardErr;

    const cartaoLinhas: Linha[] = (cards ?? []).map((c: any) => ({
      id: c.id,
      match: casarComOmie(c, byValue, codToDesc, maxDias),
    }));

    // 2) Achados SEM vínculo com o cartão (id_transacao nulo) — ex.: faturas importadas
    //    direto na tabela `auditoria` (como a de Julho/2026). Casa direto por valor + data.
    let qa = supabase
      .from("auditoria")
      .select("id,valor,data_lancamento,titulo,descricao,competencia")
      .is("id_transacao", null)
      .limit(10000);
    if (body?.competencia) qa = qa.eq("competencia", body.competencia);
    if (!body?.reprocess) qa = qa.or("omie_categoria_codigo.is.null,omie_cod_titulo.is.null");
    const { data: achados, error: achErr } = await qa;
    if (achErr) throw achErr;

    const achadoLinhas: Linha[] = (achados ?? []).map((a: any) => ({
      id: a.id,
      match: casarComOmie(
        { valor: a.valor, data: a.data_lancamento, estabelecimento: a.titulo, descricao_original: a.descricao },
        byValue, codToDesc, maxDias,
      ),
    }));

    // 3) PREVIEW: amostra sem gravar (mostra o título casado, para conferência)
    if (action === "preview") {
      const amostra = [...cartaoLinhas, ...achadoLinhas].slice(0, 30).map((l) => ({
        id: l.id,
        matched: !!l.match?.codTitulo,
        omie_cod_titulo: l.match?.codTitulo ?? null,
        categoria: l.match?.descricao ?? null,
        conf: l.match?.conf ?? null,
        dias: l.match?.dias ?? null,
        fornecedor: l.match?.fornecedor ?? null,
      }));
      return json({ ok: true, total_lancamentos: cartaoLinhas.length + achadoLinhas.length, total_movimentos_omie: movimentos.length, amostra });
    }

    // 4) MATCH: grava categoria + confiança + id do título nas duas tabelas.
    const agora = new Date().toISOString();
    const casadosCartao = await gravar(supabase, "auditoria_cartao_lancamentos", cartaoLinhas, agora);
    const casadosAchados = await gravar(supabase, "auditoria", achadoLinhas, agora);

    const todos = [...cartaoLinhas, ...achadoLinhas];
    const porConf = (c: string) => todos.filter((l) => l.match?.conf === c).length;
    return json({
      ok: true,
      total: todos.length,
      casados: casadosCartao + casadosAchados,
      casados_cartao: casadosCartao,
      casados_achados: casadosAchados,
      sem_match: todos.filter((l) => !l.match?.codTitulo).length,
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
