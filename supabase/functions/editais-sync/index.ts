import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/normalize.ts";
import { calculateEditalRelevance, loadFilterSettings } from "../_shared/relevance.ts";

const FONTE_TO_FUNCTION: Record<string, string> = {
  pncp: "editais-fonte-pncp",
  finep: "editais-fonte-finep",
  bndes: "editais-fonte-bndes",
  sebrae: "editais-fonte-sebrae",
  embrapii: "editais-fonte-embrapii",
  govbr: "editais-fonte-govbr",
  inovativa: "editais-fonte-inovativa",
  fapes: "editais-fonte-fapes",
};

interface SyncResult {
  fonte: string;
  ok: boolean;
  capturados?: number;
  novos?: number;
  duplicados?: number;
  descartados_filtro?: number;
  ocultados?: number;
  duracao_ms?: number;
  status?: string;
  urls_consultadas?: string[];
  paginas_log?: unknown[];
  erros?: unknown[];
  error?: string;
  mensagem?: string;
}

async function callFonte(slug: string, timeoutMs = 90000): Promise<SyncResult> {
  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const fnName = FONTE_TO_FUNCTION[slug];
  if (!fnName) return { fonte: slug, ok: false, error: "Unknown fonte" };
  const url = `${baseUrl}/functions/v1/${fnName}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: "{}",
      signal: ctrl.signal,
    });
    const json = await r.json();
    return { fonte: slug, ...json };
  } catch (e) {
    return { fonte: slug, ok: false, error: String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Recalcula relevância dos editais existentes sem nova captura */
async function reprocessAll(supa: any) {
  const settings = await loadFilterSettings(supa);
  const PAGE = 500;
  let from = 0;
  let total = 0, atualizados = 0, mudaramVisibilidade = 0;

  while (true) {
    const { data, error } = await supa.from("editais")
      .select("id,titulo,objeto,resumo_ia,orgao,modalidade,regiao,prazo_envio,fonte,visibility_status,match_score")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    total += data.length;

    for (const e of data) {
      const slug = String(e.fonte ?? "").toLowerCase();
      const rel = calculateEditalRelevance({
        titulo: e.titulo, objeto: e.objeto, resumo_ia: e.resumo_ia,
        orgao: e.orgao, modalidade: e.modalidade, regiao: e.regiao,
        prazo_envio: e.prazo_envio, fonte: e.fonte, fonte_slug: slug,
      }, settings);
      const changed = e.match_score !== rel.score || e.visibility_status !== rel.visibility_status;
      if (changed) {
        await supa.from("editais").update({
          match_score: rel.score,
          visibility_status: rel.visibility_status,
          relevance_reason: rel.relevance_reason,
          exclusion_reason: rel.exclusion_reason,
          source_priority: rel.source_priority,
          opportunity_type: rel.opportunity_type,
          prioridade: rel.score >= 75 ? "Alta" : rel.score >= 50 ? "Média" : "Baixa",
        }).eq("id", e.id);
        atualizados++;
        if (e.visibility_status !== rel.visibility_status) mudaramVisibilidade++;
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { total, atualizados, mudaramVisibilidade };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAll = Date.now();
  const supa = getServiceClient();

  let body: { fonte?: string; force?: boolean; reprocess?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  // Reprocesso: recalcula scores sem nova captura
  if (body.reprocess) {
    try {
      const out = await reprocessAll(supa);
      return new Response(JSON.stringify({
        ok: true, action: "reprocess",
        ...out,
        mensagem: `${out.atualizados} editais reclassificados (${out.mudaramVisibilidade} mudaram visibilidade) de ${out.total} totais.`,
        duracao_ms: Date.now() - startedAll,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let q = supa.from("editais_fontes").select("*").eq("ativo", true);
  if (body.fonte) q = supa.from("editais_fontes").select("*").eq("slug", body.fonte);

  const { data: fontes, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const elegiveis = (fontes ?? []).filter((f: any) => {
    if (body.force || body.fonte) return true;
    if (!f.proxima_sync) return true;
    return new Date(f.proxima_sync).getTime() <= now;
  });

  const results: SyncResult[] = await Promise.all(elegiveis.map(async (f: any) => {
    const startedFonte = Date.now();
    const { data: log } = await supa.from("editais_sync_logs").insert({
      fonte_slug: f.slug,
      iniciado_em: new Date().toISOString(),
      status: "sucesso",
    }).select().single();

    const res = await callFonte(f.slug);
    const duracao = Date.now() - startedFonte;
    const status = res.ok
      ? (res.status ?? ((res.novos ?? 0) === 0 && (res.duplicados ?? 0) === 0 ? "funcionando_sem_resultados" : "sucesso"))
      : "erro";

    if (log?.id) {
      await supa.from("editais_sync_logs").update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: duracao,
        status,
        capturados: res.capturados ?? 0,
        novos: res.novos ?? 0,
        duplicados: res.duplicados ?? 0,
        descartados_filtro: (res.descartados_filtro ?? 0) + (res.ocultados ?? 0),
        erros: [
          ...(Array.isArray(res.erros) ? res.erros : []),
          ...(res.urls_consultadas ? [{ urls_consultadas: res.urls_consultadas }] : []),
          ...(res.paginas_log ? [{ paginas: res.paginas_log }] : []),
          ...(res.error ? [{ error: res.error }] : []),
        ],
        mensagem: res.mensagem ?? (res.ok ? null : res.error ?? "erro desconhecido"),
      }).eq("id", log.id);
    }

    const proxima = new Date(now + (f.intervalo_horas ?? 24) * 3600 * 1000).toISOString();
    await supa.from("editais_fontes").update({
      ultima_sync: new Date().toISOString(),
      proxima_sync: proxima,
    }).eq("id", f.id);

    return { ...res, status };
  }));

  return new Response(JSON.stringify({
    ok: true,
    duracao_ms: Date.now() - startedAll,
    fontes_executadas: results.length,
    results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
