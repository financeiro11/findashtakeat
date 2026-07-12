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
import { requireUser } from "../_shared/auth.ts";

// Normalização e semelhança de texto (mesma lógica de src/lib/normalize.ts).
function normalize(s: string): string {
  return (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function similarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na.includes(nb) || nb.includes(na)) return 1;
  const ca = na.replace(/ /g, ""), cb = nb.replace(/ /g, "");
  if (ca.includes(cb) || cb.includes(ca)) return 0.95;
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // dd/mm/aaaa (Omie)
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    return isNaN(d.getTime()) ? null : d;
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/); // aaaa-mm-dd (Supabase)
  if (iso) { const d = new Date(+iso[1], +iso[2] - 1, +iso[3]); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
const days = (a: Date, b: Date) => Math.abs((a.getTime() - b.getTime()) / 86400000);
function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

type OmieItem = { valor: number; dates: Date[]; codigo: string; text: string };

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

    // 3) Movimentos do Omie → lista indexável por valor
    const movimentos = await listarMovimentos({});
    const omieItems: OmieItem[] = [];
    for (const mov of movimentos) {
      const det = (mov as any)?.detalhes ?? {};
      const valor = Math.abs(toNum(det.nValorTitulo ?? det.nValorMovimento ?? det.nValorPago));
      if (!valor) continue;
      const dates = ["dDtEmissao", "dDtRegistro", "dDtVencimento", "dDtPagamento", "dDtInclusao"]
        .map((k) => parseDate(det[k])).filter(Boolean) as Date[];
      const cats = Array.isArray((mov as any)?.categorias) && (mov as any).categorias.length
        ? (mov as any).categorias
        : [{ cCodCateg: det.cCodCateg, nValor: det.nValorTitulo }];
      // categoria principal = maior parcela do rateio
      const mainCat = [...cats].sort((a, b) => Math.abs(toNum(b.nValor)) - Math.abs(toNum(a.nValor)))[0];
      const codigo = String(mainCat?.cCodCateg ?? "");
      if (!codigo) continue;
      const text = [det.cObs, det.cNumDocFiscal, det.cNumTitulo, det.observacao, det.cCodIntTitulo]
        .filter(Boolean).join(" ");
      omieItems.push({ valor, dates, codigo, text });
    }

    const byValue = new Map<number, OmieItem[]>();
    for (const it of omieItems) {
      const k = Math.round(it.valor * 100);
      const arr = byValue.get(k) ?? [];
      arr.push(it);
      byValue.set(k, arr);
    }

    // 4) Casamento
    type Res = { id: number; id_unico: string; matched: boolean; codigo?: string; descricao?: string; conf?: string; dias?: number; sim?: number; estabelecimento?: string; valor?: number };
    const results: Res[] = [];
    for (const c of (cards ?? []) as any[]) {
      const cValor = Math.abs(toNum(c.valor));
      const cData = parseDate(c.data);
      const cText = normalize(`${c.estabelecimento ?? ""} ${c.descricao_original ?? ""}`);
      const cands = byValue.get(Math.round(cValor * 100)) ?? [];

      let best: { cand: OmieItem; dias: number; sim: number } | null = null;
      let bestScore = -Infinity;
      for (const cand of cands) {
        const dd = cData && cand.dates.length ? Math.min(...cand.dates.map((d) => days(cData, d))) : 999;
        if (dd > maxDias) continue;
        const sim = cand.text ? similarity(cText, cand.text) : 0;
        const score = -dd + sim * 10; // prioriza data próxima, com boost por semelhança
        if (score > bestScore) { bestScore = score; best = { cand, dias: dd, sim }; }
      }

      if (!best) { results.push({ id: c.id, id_unico: c.id_unico, matched: false, estabelecimento: c.estabelecimento, valor: cValor }); continue; }
      const conf = best.dias <= 2 && (best.sim >= 0.5 || cands.length === 1) ? "alta"
        : best.dias <= 7 ? "media" : "baixa";
      const descricao = codToDesc.get(best.cand.codigo) || best.cand.codigo;
      results.push({
        id: c.id, id_unico: c.id_unico, matched: true,
        codigo: best.cand.codigo, descricao, conf, dias: best.dias, sim: Math.round(best.sim * 100) / 100,
        estabelecimento: c.estabelecimento, valor: cValor,
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
