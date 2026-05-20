import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MONTH_RE = /^([A-Za-z]{3})-(\d{2})$/;
const MONTH_ORDER = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function toNum(v: any): number {
  if (typeof v === "number") return v;
  if (v == null || v === "" || v === "-") return 0;
  const s = String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function labelOf(r: Record<string, any>): string {
  for (const [k, v] of Object.entries(r)) {
    if (!MONTH_RE.test(k) && v != null && String(v).trim() !== "") {
      return String(v).toLowerCase().trim();
    }
  }
  return "";
}
function lastMonthCol(rows: Record<string, any>[]): string | null {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]);
  let best: { key: string; sortKey: number } | null = null;
  for (const k of keys) {
    const m = k.match(MONTH_RE);
    if (!m) continue;
    const mIdx = MONTH_ORDER.indexOf(m[1]);
    if (mIdx < 0) continue;
    let filled = 0;
    for (const r of rows) {
      const v = r[k];
      if (v == null || v === "" || v === "-") continue;
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, ""));
      if (!isNaN(n) && n !== 0) filled++;
    }
    if (filled < Math.max(5, Math.ceil(rows.length * 0.2))) continue;
    const year = 2000 + parseInt(m[2], 10);
    const sortKey = year * 12 + mIdx;
    if (!best || sortKey > best.sortKey) best = { key: k, sortKey };
  }
  return best?.key ?? null;
}
function findRow(rows: Record<string, any>[], terms: string[]) {
  return rows.find((r) => {
    const f = labelOf(r);
    return terms.some((t) => f === t.toLowerCase() || f.includes(t.toLowerCase()));
  }) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [{ data: dem }, { data: editais }] = await Promise.all([
      supabase
        .from("demonstracoes_contabeis")
        .select("tipo,dados,updated_at")
        .in("tipo", ["dre", "dfc"])
        .order("updated_at", { ascending: false }),
      supabase
        .from("editais")
        .select("status,visibility_status")
        .eq("visibility_status", "visivel"),
    ]);

    let dreRows: any[] = [];
    let dfcRows: any[] = [];
    const seen = new Set<string>();
    for (const d of dem ?? []) {
      if (seen.has(d.tipo)) continue;
      seen.add(d.tipo);
      const rows = Array.isArray(d.dados) ? d.dados : ((d.dados as any)?.rows ?? []);
      if (d.tipo === "dre") dreRows = rows;
      if (d.tipo === "dfc") dfcRows = rows;
    }

    const dreLast = lastMonthCol(dreRows);
    const dfcLast = lastMonthCol(dfcRows);
    const receitaRow = findRow(dreRows, ["receita bruta"]);
    const cashburnRow = findRow(dfcRows, ["cashburn"]);

    const receita = receitaRow && dreLast ? toNum(receitaRow[dreLast]) : 0;
    const cashburn = cashburnRow && dfcLast ? toNum(cashburnRow[dfcLast]) : 0;
    const editaisAtivos = (editais ?? []).filter(
      (e: any) => e.status !== "Ganhamos" && e.status !== "Perdemos" && e.status !== "Arquivado"
    ).length;

    return new Response(
      JSON.stringify({ receita, cashburn, editaisAtivos, ts: Date.now() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e), receita: 0, cashburn: 0, editaisAtivos: 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
