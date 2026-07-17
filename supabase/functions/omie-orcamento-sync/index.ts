// Edge Function: omie-orcamento-sync
// Puxa o REALIZADO do Orçamento (Governança) direto do Omie (competência) e grava
// em orcamento_area_linha.realizado_omie (não-destrutivo; o tracker fica de fallback).
//
// Ações (body.action):
//   "preview"         (default) → agrega o realizado do Omie por (área, subcategoria, mês)
//                      via orcamento_omie_map e devolve a comparação por área (Omie × atual)
//                      + categorias de despesa não mapeadas. NÃO grava.
//   "sync"             → aplica o realizado (RPC apply_orcamento_realizado_omie em lote).
//   "agendar_horario"  → grava um novo horário (BRT) para o cron diário. Só entra em
//                        vigor a partir de AMANHÃ (nunca no mesmo dia — evita ambiguidade
//                        sobre se o sync de hoje já rodou no horário velho ou no novo);
//                        um cron de promoção separado (promover_agendamentos_sync, 00:10
//                        BRT) aplica a mudança no cron.job quando a data chega.
//                        Params: { hora: number (0–23, BRT) }
//
// Regime = competência (data de registro), igual à DRE do Omie.
// Auth: usuário logado (requireUser, bloqueia "parcerias") OU x-cron-token (cron).
//
// Self-contained de propósito: inlina o cliente Omie e a auth para o deploy via MCP
// não depender de ../_shared.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* ============================ Cliente Omie (inline) ============================ */
const OMIE_BASE = "https://app.omie.com.br/api/v1";
function omieCreds() {
  const app_key = Deno.env.get("OMIE_APP_KEY");
  const app_secret = Deno.env.get("OMIE_APP_SECRET");
  if (!app_key || !app_secret) throw new Error("Credenciais do Omie ausentes (OMIE_APP_KEY / OMIE_APP_SECRET).");
  return { app_key, app_secret };
}
async function omieCall<T = any>(path: string, call: string, param: Record<string, unknown> = {}): Promise<T> {
  const { app_key, app_secret } = omieCreds();
  const url = `${OMIE_BASE}/${path}/`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
    });
    const text = await res.text();
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const fault = data && typeof data === "object" ? data.faultstring : null;
    if (res.ok && !fault) return data as T;
    const msg = fault || (typeof data === "string" ? data : JSON.stringify(data));
    lastErr = new Error(`Omie ${call} [${res.status}]: ${msg}`);
    if (/425|redundante|processando|5020|too many|bloqueada/i.test(String(msg)) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}
async function listarCategorias(): Promise<any[]> {
  const out: any[] = [];
  let pagina = 1, totalPaginas = 1;
  do {
    const r = await omieCall<any>("geral/categorias", "ListarCategorias", { pagina, registros_por_pagina: 500 });
    for (const c of (r?.categoria_cadastro ?? [])) out.push(c);
    totalPaginas = Number(r?.total_de_paginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas);
  return out;
}
async function listarMovimentos(filtros: Record<string, unknown> = {}, limitePaginas = 200): Promise<any[]> {
  const out: any[] = [];
  let nPagina = 1, totalPaginas = 1;
  do {
    const r = await omieCall<any>("financas/mf", "ListarMovimentos", { nPagina, nRegPorPagina: 500, ...filtros });
    for (const m of (r?.movimentos ?? [])) out.push(m);
    totalPaginas = Number(r?.nTotPaginas ?? 1);
    nPagina++;
  } while (nPagina <= totalPaginas && nPagina <= limitePaginas);
  return out;
}

/* ===================== Cache compartilhado do Omie =====================
 * Lê os movimentos/categorias da tabela `omie_cache` (populada por qualquer
 * uma das 4 sincronizações) em vez de repuxar todo o histórico do Omie a cada
 * execução. Reaproveita o pull quando fresco; refaz quando velho ou forçado.
 * (Inline de propósito: esta função é self-contained para deploy via MCP.) */
async function lerCacheMovimentos(supabase: any, forcar: boolean, maxIdadeMin = 360): Promise<any[]> {
  if (!forcar) {
    const { data } = await supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "movimentos").maybeSingle();
    if (data && Array.isArray(data.dados) && (Date.now() - new Date(data.atualizado_em).getTime()) / 60000 <= maxIdadeMin) {
      return data.dados;
    }
  }
  const dados = await listarMovimentos({});
  await supabase.from("omie_cache").upsert({ chave: "movimentos", dados, registros: dados.length, atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
  return dados;
}
async function lerCacheCategorias(supabase: any, forcar: boolean, maxIdadeMin = 1440): Promise<any[]> {
  if (!forcar) {
    const { data } = await supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "categorias").maybeSingle();
    if (data && Array.isArray(data.dados) && (Date.now() - new Date(data.atualizado_em).getTime()) / 60000 <= maxIdadeMin) {
      return data.dados;
    }
  }
  const dados = await listarCategorias();
  await supabase.from("omie_cache").upsert({ chave: "categorias", dados, registros: dados.length, atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
  return dados;
}

/* ============================ Helpers ============================ */
function parseOmieDate(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function pickDate(det: any, keys: string[]): Date | null {
  for (const k of keys) { const d = parseOmieDate(det?.[k]); if (d) return d; }
  return null;
}
function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/* ============================ Auth (inline) ============================ */
function jwtRole(token: string): string | null {
  try {
    const b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b))?.role ?? null;
  } catch { return null; }
}
async function requireUser(req: Request, supabase: any, bloquear: string[] = ["parcerias"]) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) throw new Error("Não autenticado.");
  if (jwtRole(token) === "service_role") return;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new Error("Não autenticado."); // anon key ou token inválido
  const { data: prof } = await supabase.from("profiles").select("cargo").eq("user_id", data.user.id).maybeSingle();
  const cargo = (prof?.cargo ?? "").trim().toLowerCase();
  if (bloquear.map((c) => c.toLowerCase()).includes(cargo)) throw new Error("Você não tem permissão para esta ação.");
}

/* ============================ Handler ============================ */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // ---- auth: cron-token OU usuário ----
    const cronToken = req.headers.get("x-cron-token");
    let authed = false;
    if (cronToken) {
      const { data } = await supabase.from("internal_cron_tokens").select("token").eq("name", "omie-orcamento-sync").maybeSingle();
      if (data?.token && data.token === cronToken) authed = true;
    }
    if (!authed) await requireUser(req, supabase);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "preview";
    const forcar = body?.atualizar === true; // força buscar do Omie; senão usa o cache
    const ano = Number(body?.ano ?? 2026);

    /* ---------------- AGENDAR HORÁRIO (cron diário) ---------------- */
    if (action === "agendar_horario") {
      const hora = Number(body?.hora);
      if (!Number.isInteger(hora) || hora < 0 || hora > 23) {
        return json({ error: "Hora inválida. Use um número inteiro de 0 a 23." }, 200);
      }
      // Vigência SEMPRE a partir de amanhã (BRT) — nunca no mesmo dia, mesmo que a
      // hora escolhida ainda não tenha passado hoje. Calculada no servidor (não confia
      // no relógio do navegador). Um cron de promoção separado aplica a mudança.
      const hojeBRT = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const amanha = new Date(hojeBRT.getFullYear(), hojeBRT.getMonth(), hojeBRT.getDate() + 1);
      const vigenteAPartir = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, "0")}-${String(amanha.getDate()).padStart(2, "0")}`;

      const { data, error } = await supabase.from("sync_agendamento")
        .update({ hora_pendente: hora, vigente_a_partir: vigenteAPartir, atualizado_em: new Date().toISOString() })
        .eq("job_name", "omie-orcamento-sync-diario")
        .select().single();
      if (error) throw error;
      return json({ ok: true, agendamento: data });
    }

    // ---- de-para categoria -> linha do orçamento ----
    const { data: mapRows } = await supabase
      .from("orcamento_omie_map").select("descricao_categoria, area, subcategoria").not("area", "is", null);
    const mapa = new Map<string, { area: string; subcategoria: string }>();
    const mappedLines = new Set<string>();
    for (const m of (mapRows ?? []) as any[]) {
      mapa.set(norm(m.descricao_categoria), { area: m.area, subcategoria: m.subcategoria });
      mappedLines.add(`${m.area}||${m.subcategoria}`);
    }

    // ---- categorias: cCodCateg -> descrição (via cache compartilhado) ----
    const categorias = await lerCacheCategorias(supabase, forcar);
    const codigoToDescricao = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codigoToDescricao.set(String(c.codigo), c.descricao ?? "");

    // ---- movimentos: via cache compartilhado (recálculo local; `atualizar:true` refaz o pull) ----
    const movimentos = await lerCacheMovimentos(supabase, forcar);

    const agg = new Map<string, Map<number, number>>();   // "area||sub" -> mes -> valor
    const naoMap = new Map<string, number>();             // descrição -> valor
    let valorNaoMap = 0;

    for (const mov of movimentos) {
      const det = mov?.detalhes ?? {};
      const natureza = String(det.cNatureza ?? det.natureza ?? "R").toUpperCase();
      if (natureza.startsWith("R")) continue; // receita: fora do orçamento de custos
      const dataComp = pickDate(det, ["dDtRegistro", "dDtInclusao", "dDtEmissao", "dDtPrevisao"]);
      if (!dataComp || dataComp.getFullYear() !== ano) continue;
      const mes = dataComp.getMonth() + 1;

      const cats = Array.isArray(mov?.categorias) && mov.categorias.length
        ? mov.categorias
        : [{ cCodCateg: det.cCodCateg, nValor: det.nValorTitulo }];

      for (const cat of cats) {
        const codigo = String(cat.cCodCateg ?? "");
        if (!codigo) continue;
        const descricao = codigoToDescricao.get(codigo) ?? codigo;
        const valor = Math.abs(toNum(cat.nValor));
        if (!valor) continue;
        const hit = mapa.get(norm(descricao));
        if (hit) {
          const key = `${hit.area}||${hit.subcategoria}`;
          let bm = agg.get(key); if (!bm) { bm = new Map(); agg.set(key, bm); }
          bm.set(mes, (bm.get(mes) ?? 0) + valor);
        } else {
          naoMap.set(descricao, (naoMap.get(descricao) ?? 0) + valor);
          valorNaoMap += valor;
        }
      }
    }

    // linhas do orçamento (tracker) do ano — para comparar e detectar "sem fonte"
    const { data: linhas } = await supabase
      .from("orcamento_area_linha").select("area, subcategoria, mes, realizado").eq("ano", ano);

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const valorLinhaMes = (area: string, sub: string, mes: number) => agg.get(`${area}||${sub}`)?.get(mes) ?? 0;

    /* ---------------- PREVIEW ---------------- */
    if (action === "preview") {
      // por área: realizado atual (tracker) × realizado novo (Omie onde há, tracker onde não)
      const porArea = new Map<string, { atual: number; novo: number; omie: number }>();
      for (const l of (linhas ?? []) as any[]) {
        const key = `${l.area}||${l.subcategoria}`;
        const mapped = mappedLines.has(key);
        const tracker = toNum(l.realizado);
        const omie = valorLinhaMes(l.area, l.subcategoria, l.mes);
        const novo = mapped ? omie : tracker;
        const cur = porArea.get(l.area) ?? { atual: 0, novo: 0, omie: 0 };
        cur.atual += tracker;
        cur.novo += novo;
        cur.omie += mapped ? omie : 0;
        porArea.set(l.area, cur);
      }
      const areas = [...porArea.entries()].map(([area, v]) => ({
        area, atual: round2(v.atual), novo: round2(v.novo), omie: round2(v.omie), delta: round2(v.novo - v.atual),
      })).sort((a, b) => a.area.localeCompare(b.area, "pt-BR"));

      const naoMapeadasTop = [...naoMap.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 20)
        .map(([descricao, valor]) => ({ descricao, valor: round2(valor) }));

      const linhasSemFonte = [...new Set(((linhas ?? []) as any[])
        .filter((l) => !mappedLines.has(`${l.area}||${l.subcategoria}`))
        .map((l) => `${l.area} · ${l.subcategoria}`))].sort();

      return json({
        ok: true, ano, movimentos: movimentos.length,
        areas,
        total_atual: round2(areas.reduce((s, a) => s + a.atual, 0)),
        total_novo: round2(areas.reduce((s, a) => s + a.novo, 0)),
        total_omie: round2(areas.reduce((s, a) => s + a.omie, 0)),
        nao_mapeadas: { total: round2(valorNaoMap), qtd: naoMap.size, top: naoMapeadasTop },
        linhas_sem_fonte: linhasSemFonte,
      });
    }

    /* ---------------- SYNC ---------------- */
    const { data: logRow } = await supabase
      .from("orcamento_omie_sync_log")
      .insert({ status: "rodando", ano }).select("id").single();
    const logId = (logRow as any)?.id;
    try {
      // payload: todas as linhas mapeadas × 12 meses (0 onde não houve gasto)
      const payload: { area: string; subcategoria: string; mes: number; valor: number }[] = [];
      for (const key of mappedLines) {
        const [area, subcategoria] = key.split("||");
        const bm = agg.get(key);
        for (let mes = 1; mes <= 12; mes++) payload.push({ area, subcategoria, mes, valor: round2(bm?.get(mes) ?? 0) });
      }
      const { data: nAplic, error } = await supabase.rpc("apply_orcamento_realizado_omie", { p_ano: ano, p_dados: payload });
      if (error) throw error;

      if (logId) await supabase.from("orcamento_omie_sync_log").update({
        status: "ok", concluido_em: new Date().toISOString(),
        movimentos: movimentos.length, linhas_atualizadas: Number(nAplic ?? 0),
        nao_mapeadas: naoMap.size, valor_nao_mapeado: round2(valorNaoMap),
      }).eq("id", logId);

      return json({
        ok: true, ano, movimentos: movimentos.length,
        linhas_atualizadas: Number(nAplic ?? 0),
        nao_mapeadas: { total: round2(valorNaoMap), qtd: naoMap.size },
      });
    } catch (e) {
      if (logId) await supabase.from("orcamento_omie_sync_log").update({
        status: "erro", concluido_em: new Date().toISOString(), erro: e instanceof Error ? e.message : String(e),
      }).eq("id", logId);
      throw e;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-orcamento-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
