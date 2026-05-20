import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Upload, ChevronDown, ChevronRight, ChevronLeft, Search, Sparkles, Loader2,
  TrendingUp, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ============================================================
 *  Helpers
 * ============================================================ */

const MES_PT_TO_EN: Record<string, string> = {
  jan: "Jan", fev: "Feb", mar: "Mar", abr: "Apr", mai: "May", jun: "Jun",
  jul: "Jul", ago: "Aug", set: "Sep", out: "Oct", nov: "Nov", dez: "Dec",
};
const MES_PT_SHORT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const EN_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function colKey(ptLabel: string): string | null {
  const m = ptLabel?.toString().toLowerCase().trim().match(/^([a-zçãéê]{3,})[\s\/\-]+(\d{2,4})$/);
  if (!m) return null;
  const en = MES_PT_TO_EN[m[1].slice(0, 3)];
  if (!en) return null;
  const yy = m[2].length === 4 ? m[2].slice(-2) : m[2];
  return `${en}-${yy}`;
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}
function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  const abs = Math.abs(v);
  let str: string;
  if (abs >= 1_000_000) str = `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")} M`;
  else if (abs >= 1_000) str = `R$ ${(v / 1_000).toFixed(1).replace(".", ",")} K`;
  else str = `R$ ${v.toFixed(0)}`;
  return str;
}
function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(".", ",") + " M";
  if (abs >= 1_000) return (v / 1_000).toFixed(1).replace(".", ",") + " K";
  return v.toFixed(0);
}
function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}
function normLabel(s: string): string {
  return s.toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^[\d\.\)\s\-\+]+/, "")            // strip "1.", "1.1.", "(-)" etc
    .replace(/^[\(\)\+\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
 *  DRE schema (mesma da DRE)
 * ============================================================ */

type Kind = "header" | "child" | "leaf" | "total" | "percent";
type Direction = "revenue" | "cost" | "neutral";
type Node = {
  label: string;
  kind: Kind;
  direction?: Direction;
  pctOf?: string;
  children?: Node[];
};

const SCHEMA: Node[] = [
  { label: "Receita Bruta", kind: "header", direction: "revenue", children: [
    { label: "Receita Recorrente", kind: "child", direction: "revenue", children: [
      { label: "Receita de Assinaturas", kind: "leaf", direction: "revenue" },
      { label: "Enterprise", kind: "leaf", direction: "revenue" },
    ]},
    { label: "Receita Spot", kind: "child", direction: "revenue" },
  ]},
  { label: "(-) Deduções da receita", kind: "header", direction: "cost" },
  { label: "Receita Líquida", kind: "total", direction: "revenue" },
  { label: "(-) Custos Operacionais", kind: "header", direction: "cost", children: [
    { label: "Equipe Operacional", kind: "child", direction: "cost" },
    { label: "Premiações Operacionais", kind: "child", direction: "cost" },
    { label: "Meios de Pagamento", kind: "child", direction: "cost" },
    { label: "CMV Materiais", kind: "child", direction: "cost" },
    { label: "Servidor", kind: "child", direction: "cost" },
    { label: "Softwares Operacionais", kind: "child", direction: "cost" },
    { label: "Outros Custos", kind: "child", direction: "cost" },
  ]},
  { label: "Margem de contribuição", kind: "total", direction: "revenue" },
  { label: "% Margem de contribuição", kind: "percent", direction: "neutral", pctOf: "Receita Líquida" },
  { label: "(-) SG&A", kind: "header", direction: "cost", children: [
    { label: "Pessoal", kind: "child", direction: "cost" },
    { label: "Despesas Administrativas", kind: "child", direction: "cost" },
    { label: "Despesas Marketing & Vendas", kind: "child", direction: "cost" },
  ]},
  { label: "EBITDA", kind: "total", direction: "revenue" },
  { label: "% Margem EBITDA", kind: "percent", direction: "neutral", pctOf: "Receita Líquida" },
  { label: "(+/-) Resultado Financeiro", kind: "header", direction: "neutral", children: [
    { label: "(-) Depreciação & Amortização", kind: "child", direction: "cost" },
  ]},
  { label: "(+/-) Resultado Não Operacional", kind: "header", direction: "neutral" },
  { label: "(-) Impostos", kind: "header", direction: "cost" },
  { label: "Lucro Líquido", kind: "total", direction: "revenue" },
];

/* ============================================================
 *  Page
 * ============================================================ */

type MonthlyMap = Record<string, (number | null)[]>; // labelNorm -> 12 months

export default function BPAnual() {
  const navigate = useNavigate();
  const today = new Date();
  const [ano, setAno] = useState<number>(today.getFullYear());
  const [bp, setBp] = useState<MonthlyMap>({});
  const [bpAnnual, setBpAnnual] = useState<Record<string, number>>({});
  const [bpRaw, setBpRaw] = useState<any[]>([]);
  const [real, setReal] = useState<MonthlyMap>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<"plano" | "realorc" | "forecast">("realorc");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { document.title = `BP Anual · ${ano}`; }, [ano]);

  /* ---------- Carrega BP do ano ---------- */
  const loadBp = async () => {
    const { data } = await supabase.from("bp_anual" as any).select("dados").eq("ano", ano).maybeSingle();
    const arr = ((data as any)?.dados as any[]) || [];
    setBpRaw(arr);
    const map: MonthlyMap = {};
    const annual: Record<string, number> = {};
    if (!arr.length) { setBp({}); setBpAnnual({}); return; }
    // identifica colunas dos 12 meses (Mês 1..Mês 12) e total anual
    const keys = Object.keys(arr[0] || {});
    const labelKey = keys[0]; // "Imagem"
    // procura linha "Mês Calendário" para localizar colunas dos meses
    const monthRow = arr.find(r => normLabel(String(r[labelKey] ?? "")).startsWith("mes calendario"));
    const monthCols: string[] = [];
    if (monthRow) {
      for (const k of keys) {
        const v = monthRow[k];
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= 12) monthCols[n - 1] = k;
      }
    }
    // fallback: pega primeiras 12 chaves numéricas após a label
    if (monthCols.filter(Boolean).length < 12) {
      const nums = keys.slice(1).filter(k => arr.some(r => typeof r[k] === "number"));
      for (let i = 0; i < 12 && i < nums.length; i++) monthCols[i] = nums[i];
    }
    // total anual: heurística — coluna logo depois do mês 12 que tenha valores grandes
    const m12 = monthCols[11];
    const idx12 = m12 ? keys.indexOf(m12) : -1;
    let totalKey: string | null = null;
    for (let i = idx12 + 1; i < keys.length; i++) {
      const k = keys[i];
      if (arr.some(r => typeof r[k] === "number" && Math.abs(r[k]) > 1000)) { totalKey = k; break; }
    }

    for (const r of arr) {
      const lab = String(r[labelKey] ?? "").trim();
      if (!lab) continue;
      const norm = normLabel(lab);
      if (!norm) continue;
      const months: (number | null)[] = monthCols.map(k => k ? toNum(r[k]) : null);
      if (months.every(v => v == null)) continue;
      // se já existe (varias linhas iguais), soma
      if (!map[norm]) map[norm] = [null, null, null, null, null, null, null, null, null, null, null, null];
      months.forEach((v, i) => {
        if (v == null) return;
        map[norm][i] = (map[norm][i] ?? 0) + v;
      });
      const t = totalKey ? toNum(r[totalKey]) : null;
      const computed = months.reduce<number | null>((a, b) => b == null ? a : (a ?? 0) + b, null);
      annual[norm] = (annual[norm] ?? 0) + (t ?? computed ?? 0);
    }
    setBp(map);
    setBpAnnual(annual);
  };

  /* ---------- Carrega Realizado (DRE) do ano ---------- */
  const loadReal = async () => {
    const { data } = await supabase
      .from("demonstracoes_contabeis" as any)
      .select("dados")
      .eq("tipo", "dre")
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();
    const raw: any = (data as any)?.dados;
    if (!raw) { setReal({}); return; }
    const rows: any[] = Array.isArray(raw) ? raw : (raw.rows || []);
    const yy = String(ano).slice(-2);
    const map: MonthlyMap = {};
    for (const r of rows) {
      const labelKey = Object.keys(r).find(k => !/^[A-Za-z]{3}-\d{2}$/.test(k));
      const lab = labelKey ? String(r[labelKey] ?? "").trim() : "";
      if (!lab) continue;
      const norm = normLabel(lab);
      const arr12: (number | null)[] = Array(12).fill(null);
      for (let i = 0; i < 12; i++) {
        const k = `${EN_ORDER[i]}-${yy}`;
        arr12[i] = toNum(r[k]);
      }
      if (arr12.some(v => v != null)) map[norm] = arr12;
    }
    setReal(map);
  };

  const reload = async () => { setLoading(true); await Promise.all([loadBp(), loadReal()]); setLoading(false); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [ano]);

  /* ---------- Lookup com matching flexível ---------- */
  // Prefer exact match. Otherwise, choose the key that contains the target (or vice-versa)
  // with the SMALLEST length difference — avoids matching short keys like "receita"
  // when looking for "receita liquida". Also exclude percent-row labels when the
  // target is not itself a percent row.
  function bestKey(keys: string[], target: string): string | null {
    if (keys.includes(target)) return target;
    const targetIsPct = target.startsWith("%") || target.includes("margem");
    const candidates = keys.filter(k => {
      if (k === target) return true;
      if (!targetIsPct && (k.startsWith("%") || k.includes("margem"))) return false;
      return k.includes(target) || target.includes(k);
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => Math.abs(a.length - target.length) - Math.abs(b.length - target.length));
    return candidates[0];
  }
  function lookup(map: MonthlyMap, label: string): (number | null)[] {
    const target = normLabel(label);
    const k = bestKey(Object.keys(map), target);
    return k ? map[k] : Array(12).fill(null);
  }
  function lookupAnnual(label: string): number | null {
    const target = normLabel(label);
    const k = bestKey(Object.keys(bpAnnual), target);
    return k ? bpAnnual[k] : null;
  }

  /* ---------- Último mês realizado (para o ano) ---------- */
  const lastRealIdx = useMemo(() => {
    const ref = lookup(real, "Receita Líquida");
    let last = -1;
    ref.forEach((v, i) => { if (v != null && v !== 0) last = i; });
    return last; // -1 se não houver realizado
  }, [real]);

  const monthsRealizados = lastRealIdx + 1;
  const monthsProjetados = 12 - monthsRealizados;

  /* ---------- Cálculo por linha ---------- */
  function valueForMonth(node: Node, monthIdx: number, mode: "plano" | "realorc" | "forecast"): { v: number | null; tag: "REAL" | "PROJ" | null } {
    if (node.kind === "percent" && node.pctOf) {
      const numLabel =
        node.label.includes("EBITDA") ? "EBITDA"
        : node.label.includes("contribuição") ? "Margem de contribuição"
        : node.label.includes("Líquida") ? "Lucro Líquido"
        : node.label;
      const numArr = mode === "plano" ? lookup(bp, numLabel) : (monthIdx <= lastRealIdx ? lookup(real, numLabel) : lookup(bp, numLabel));
      const denArr = mode === "plano" ? lookup(bp, node.pctOf) : (monthIdx <= lastRealIdx ? lookup(real, node.pctOf) : lookup(bp, node.pctOf));
      const n = numArr[monthIdx]; const d = denArr[monthIdx];
      if (n == null || !d) return { v: null, tag: null };
      return { v: n / d, tag: mode !== "plano" ? (monthIdx <= lastRealIdx ? "REAL" : "PROJ") : null };
    }
    if (mode === "plano") return { v: lookup(bp, node.label)[monthIdx], tag: null };
    if (monthIdx <= lastRealIdx) return { v: lookup(real, node.label)[monthIdx], tag: "REAL" };
    return { v: lookup(bp, node.label)[monthIdx], tag: "PROJ" };
  }

  function annualBudget(label: string): number | null {
    const a = lookupAnnual(label);
    if (a != null) return a;
    const arr = lookup(bp, label);
    return arr.reduce<number | null>((acc, v) => v == null ? acc : (acc ?? 0) + v, null);
  }
  function ytdReal(label: string): number | null {
    if (lastRealIdx < 0) return null;
    const arr = lookup(real, label);
    let sum: number | null = null;
    for (let i = 0; i <= lastRealIdx; i++) {
      const v = arr[i]; if (v == null) continue;
      sum = (sum ?? 0) + v;
    }
    return sum;
  }
  function ytdBudget(label: string): number | null {
    if (lastRealIdx < 0) return null;
    const arr = lookup(bp, label);
    let sum: number | null = null;
    for (let i = 0; i <= lastRealIdx; i++) {
      const v = arr[i]; if (v == null) continue;
      sum = (sum ?? 0) + v;
    }
    return sum;
  }
  function totalAnual(node: Node, mode: "plano" | "realorc" | "forecast"): number | null {
    let sum: number | null = null;
    for (let i = 0; i < 12; i++) {
      const { v } = valueForMonth(node, i, mode);
      if (v == null || node.kind === "percent") continue;
      sum = (sum ?? 0) + v;
    }
    return sum;
  }
  function pctAtingido(node: Node): number | null {
    if (node.kind === "percent" || lastRealIdx < 0) return null;
    const r = ytdReal(node.label); const b = ytdBudget(node.label);
    if (r == null || b == null || b === 0) return null;
    return r / b;
  }
  function pctColor(pct: number | null, dir: Direction = "revenue"): string {
    if (pct == null) return "bg-muted text-muted-foreground";
    const p = pct * 100;
    if (dir === "cost") {
      if (p > 110) return "bg-red-500";
      if (p < 100) return "bg-emerald-500";
      return "bg-amber-500";
    }
    if (p < 90) return "bg-red-500";
    if (p > 100) return "bg-emerald-500";
    return "bg-amber-500";
  }
  function pctTextColor(pct: number | null, dir: Direction = "revenue"): string {
    if (pct == null) return "text-muted-foreground";
    const p = pct * 100;
    if (dir === "cost") {
      if (p > 110) return "text-red-600";
      if (p < 100) return "text-emerald-600";
      return "text-amber-600";
    }
    if (p < 90) return "text-red-600";
    if (p > 100) return "text-emerald-600";
    return "text-amber-600";
  }

  /* ---------- KPIs anuais ---------- */
  const kpis = useMemo(() => {
    const make = (title: string, label: string, dir: Direction) => {
      const orc = annualBudget(label);
      const r = ytdReal(label);
      return { title, label, dir, orc, real: r };
    };
    return [
      make("RECEITA BRUTA ANUAL", "Receita Bruta", "revenue"),
      make("EBITDA ANUAL", "EBITDA", "revenue"),
      { title: "MARGEM EBITDA", label: "% Margem EBITDA", dir: "revenue" as Direction,
        orc: (() => { const e = annualBudget("EBITDA"); const r = annualBudget("Receita Líquida"); return e != null && r ? e / r : null; })(),
        real: (() => { const e = ytdReal("EBITDA"); const r = ytdReal("Receita Líquida"); return e != null && r ? e / r : null; })(),
        isPct: true },
      make("SG&A ANUAL", "(-) SG&A", "cost"),
      make("LUCRO LÍQUIDO ANUAL", "Lucro Líquido", "revenue"),
    ] as Array<{ title: string; label: string; dir: Direction; orc: number | null; real: number | null; isPct?: boolean }>;
  }, [bp, bpAnnual, real, lastRealIdx]);

  /* ---------- Insight banner (IA simples computada) ---------- */
  const insight = useMemo(() => {
    const recR = ytdReal("Receita Líquida");
    const recA = annualBudget("Receita Líquida");
    if (recR == null || !recA) return null;
    const pct = recR / recA;
    const expectedPct = monthsRealizados / 12;
    const desvio = pct - expectedPct;
    const tone = desvio < -0.05 ? "alerta" : desvio > 0.05 ? "positivo" : "neutro";
    return {
      tone,
      pct, recR, recA, desvio,
    };
  }, [bp, bpAnnual, real, lastRealIdx, monthsRealizados]);

  /* ---------- Importar BP ---------- */
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setImporting(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (!json.length) throw new Error("Planilha vazia");
      const { error } = await supabase.from("bp_anual" as any).upsert({ ano, dados: json } as any, { onConflict: "ano" });
      if (error) throw error;
      toast.success(`${json.length} linha(s) importada(s) em BP ${ano}`);
      reload();
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
      e.target.value = "";
    }
  };

  /* ---------- Hierarquia ---------- */
  type Flat = { node: Node; depth: number; hidden?: boolean };
  const flat: Flat[] = useMemo(() => {
    const out: Flat[] = [];
    const walk = (nodes: Node[], depth: number, parentCol: boolean) => {
      for (const n of nodes) {
        out.push({ node: n, depth, hidden: parentCol });
        if (n.children?.length) walk(n.children, depth + 1, parentCol || collapsed.has(n.label));
      }
    };
    walk(SCHEMA, 0, false);
    return out;
  }, [collapsed]);
  const filtered = useMemo(() => {
    if (!search.trim()) return flat;
    const q = search.toLowerCase();
    return flat.filter(f => f.node.label.toLowerCase().includes(q));
  }, [flat, search]);
  const toggle = (l: string) => setCollapsed(p => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const collapseAll = () => { const all = new Set<string>(); const walk = (n: Node[]) => n.forEach(x => { if (x.children?.length) { all.add(x.label); walk(x.children); } }); walk(SCHEMA); setCollapsed(all); };
  const expandAll = () => setCollapsed(new Set());
  const allCollapsed = collapsed.size > 0;

  const hasBp = Object.keys(bp).length > 0;

  /* ============================================================
   *  UI
   * ============================================================ */

  return (
    <div className="min-h-full bg-background">
      {/* header */}
      <div className="px-6 pt-5 pb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-2">
            Budget Plan Anual
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-primary">{ano}</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Plano financeiro do ano — base para cenários preditivos. {monthsRealizados} meses realizados, {monthsProjetados} meses de projeção.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-card h-8 px-1">
            <button onClick={() => setAno(ano - 1)} className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="px-2 text-[12.5px] font-semibold text-foreground tabular-nums">{ano}</span>
            <button onClick={() => setAno(ano + 1)} className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 h-8 text-[11.5px] font-medium text-emerald-700">
            <Sparkles className="h-3.5 w-3.5" /> Tracker vOMIE · sincronizado
          </span>
          <Button variant="outline" size="sm" className="h-8 text-[12px]">Exportar</Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={importing}
            className="h-8 text-[12px] bg-foreground text-background hover:bg-foreground/90">
            {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Importar Excel
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onImport} />
        </div>
      </div>

      {/* KPIs anuais */}
      <div className="grid grid-cols-2 gap-3 px-6 md:grid-cols-3 lg:grid-cols-5">
        {kpis.map(k => {
          const isNeg = (k.orc ?? 0) < 0;
          const main = k.isPct ? fmtPct(k.orc) : (isNeg ? `(${fmtMoney(Math.abs(k.orc ?? 0))})` : fmtMoney(k.orc));
          const realStr = k.real == null ? "—" : (k.isPct ? fmtPct(k.real) : fmtMoney(k.real));
          return (
            <div key={k.title} className="rounded-lg border border-border bg-card p-3.5">
              <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">{k.title}</div>
              <div className={cn("mt-2 text-[19px] font-bold tracking-tight num", isNeg ? "text-primary" : "text-foreground")}>{main}</div>
              <div className="mt-1 text-[10.5px] text-muted-foreground">orçado anual</div>
              <div className="mt-2 text-[10.5px] text-muted-foreground num">
                Real YTD · <span className="text-foreground/80 font-semibold">{realStr}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI insight banner */}
      {insight && (
        <div className="mt-4 mx-6 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3">
          <div className="mt-0.5 h-7 w-7 rounded-md bg-primary/10 inline-flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] text-foreground">
              <b>YTD acumulado:</b> {fmtMoney(insight.recR)} em receita — <b>{fmtPct(insight.pct)}</b> do orçado anual de {fmtMoney(insight.recA)}.{" "}
              {insight.tone === "alerta" && <span className="text-red-600">Ritmo {fmtPct(Math.abs(insight.desvio))} abaixo do necessário pra bater meta. Sugiro revisão de marketing e despesas com eventos.</span>}
              {insight.tone === "positivo" && <span className="text-emerald-600">Ritmo {fmtPct(insight.desvio)} acima do necessário — meta está saudável.</span>}
              {insight.tone === "neutro" && <span className="text-muted-foreground">Ritmo dentro do esperado para o ano.</span>}
            </div>
          </div>
          <button
            onClick={() => navigate("/analise/cenarios")}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-card px-3 h-8 text-[12px] font-semibold text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors whitespace-nowrap shadow-sm"
          >
            Criar cenário <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tabs + search */}
      <div className="mt-4 px-6 flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex items-center gap-1">
          {[
            { id: "plano", label: "Plano original" },
            { id: "realorc", label: "Realizado vs Orçado" },
            { id: "forecast", label: "Forecast revisado" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={cn("h-9 px-3 text-[12.5px] font-medium border-b-2 -mb-px transition-colors",
                tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar rubrica…" className="h-8 w-[200px] pl-7 text-[12px]" />
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-[12px] text-muted-foreground" onClick={() => allCollapsed ? expandAll() : collapseAll()}>
            {allCollapsed ? "Expandir tudo" : "Colapsar tudo"}
          </Button>
        </div>
      </div>

      {/* Tabela */}
      <div className="px-6 pb-8">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !hasBp ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Nenhum BP importado para {ano}. Clique em <b>Importar Excel</b> para enviar.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky left-0 z-20 bg-muted px-3 py-2 text-left text-[10px] font-semibold tracking-[0.08em] text-muted-foreground w-[280px] min-w-[280px] shadow-[1px_0_0_0_hsl(var(--border))]">RUBRICA</th>
                  {MES_PT_SHORT.map((m, i) => {
                    const isReal = tab !== "plano" && i <= lastRealIdx;
                    return (
                      <th key={m} className={cn(
                        "px-2 py-2 text-right text-[10px] font-semibold tracking-[0.06em] whitespace-nowrap min-w-[80px]",
                        isReal ? "text-emerald-700" : "text-muted-foreground",
                      )}>
                        {m}
                        <div className="text-[8.5px] font-normal opacity-80">{isReal ? "REAL" : "PROJ"}</div>
                      </th>
                    );
                  })}
                  <th className={cn(
                    "sticky z-20 px-2 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap min-w-[90px] w-[90px] bg-muted shadow-[-1px_0_0_0_hsl(var(--border))]",
                    tab === "plano" ? "right-0" : "",
                  )} style={tab === "plano" ? undefined : { right: 200 }}>TOTAL ANUAL</th>
                  {tab !== "plano" && (
                    <>
                      <th className="sticky z-20 px-2 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap min-w-[90px] w-[90px] bg-muted" style={{ right: 110 }}>YTD REAL</th>
                      <th className="sticky right-0 z-20 px-2 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap min-w-[110px] w-[110px] bg-muted">% ATINGIDO</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ node, depth, hidden }) => {
                  if (hidden) return null;
                  const isHeader = node.kind === "header";
                  const isTotal = node.kind === "total";
                  const isPercent = node.kind === "percent";
                  const isChild = node.kind === "child";
                  const isLeaf = node.kind === "leaf";
                  const hasChildren = !!node.children?.length;
                  const isCol = collapsed.has(node.label);

                  const rowCls = cn(
                    "border-b border-border/60 transition-colors",
                    isTotal && "bg-emerald-50/40 font-semibold",
                    isPercent && "text-muted-foreground italic text-[11.5px]",
                    isHeader && "font-semibold",
                    !isHeader && !isTotal && !isPercent && "hover:bg-muted/30",
                  );

                  const ytd = ytdReal(node.label);
                  const tot = totalAnual(node, tab);
                  const pct = pctAtingido(node);
                  const dir = node.direction ?? "revenue";

                  return (
                    <tr key={node.label + depth} className={rowCls}>
                      <td
                        className={cn(
                          "sticky left-0 z-[2] px-3 py-1.5 text-[12.5px] w-[280px] min-w-[280px] shadow-[1px_0_0_0_hsl(var(--border))]",
                          isTotal ? "bg-emerald-50" : "bg-card",
                        )}
                        style={{ paddingLeft: 12 + depth * 18 }}
                      >
                        <div className="flex items-center gap-1.5">
                          {hasChildren ? (
                            <button onClick={() => toggle(node.label)} className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted">
                              {isCol ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          ) : <span className="inline-block w-4" />}
                          <span className={cn(
                            isTotal && "text-emerald-800",
                            isHeader && !isTotal && "text-foreground",
                            isChild && "text-foreground/85",
                            isLeaf && "text-muted-foreground",
                          )}>{node.label}</span>
                        </div>
                      </td>

                      {Array.from({ length: 12 }).map((_, i) => {
                        const { v, tag } = valueForMonth(node, i, tab);
                        const isNeg = (v ?? 0) < 0;
                        const display = isPercent ? fmtPct(v)
                          : (isNeg ? `(${fmtCompact(Math.abs(v ?? 0))})` : fmtCompact(v));
                        return (
                          <td key={i} className={cn(
                            "px-2 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[80px] relative",
                            tag === "REAL" && "bg-emerald-50/30",
                            isNeg && !isPercent ? "text-primary" : isTotal ? "text-emerald-800" : "text-foreground/90",
                            v == null && "text-muted-foreground/40",
                          )}>
                            {display}
                          </td>
                        );
                      })}

                      {/* TOTAL ANUAL */}
                      <td
                        className={cn(
                          "sticky z-[2] px-2 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[90px] w-[90px] font-semibold shadow-[-1px_0_0_0_hsl(var(--border))]",
                          isTotal ? "bg-emerald-50" : "bg-card",
                          (tot ?? 0) < 0 && !isPercent ? "text-primary" : isTotal ? "text-emerald-800" : "text-foreground",
                          tab === "plano" ? "right-0" : "",
                        )}
                        style={tab === "plano" ? undefined : { right: 200 }}
                      >
                        {isPercent ? "—" : ((tot ?? 0) < 0 ? `(${fmtCompact(Math.abs(tot ?? 0))})` : fmtCompact(tot))}
                      </td>

                      {tab !== "plano" && (
                        <>
                          {/* YTD REAL */}
                          <td
                            className={cn(
                              "sticky z-[2] px-2 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[90px] w-[90px]",
                              isTotal ? "bg-emerald-50" : "bg-card",
                              (ytd ?? 0) < 0 && !isPercent ? "text-primary" : "text-foreground/90",
                              ytd == null && "text-muted-foreground/40",
                            )}
                            style={{ right: 110 }}
                          >
                            {isPercent ? "—" : (ytd == null ? "—" : ((ytd ?? 0) < 0 ? `(${fmtCompact(Math.abs(ytd))})` : fmtCompact(ytd)))}
                          </td>

                          {/* % ATINGIDO */}
                          <td
                            className={cn(
                              "sticky right-0 z-[2] px-2 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[110px] w-[110px]",
                              isTotal ? "bg-emerald-50" : "bg-card",
                            )}
                          >
                            {isPercent || pct == null ? <span className="text-muted-foreground/50">—</span> : (
                              <div className="flex items-center justify-end gap-2">
                                <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                                  <div className={cn("h-full rounded-full", pctColor(pct, dir))} style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
                                </div>
                                <span className={cn("font-semibold tabular-nums", pctTextColor(pct, dir))}>{fmtPct(pct, 0)}</span>
                              </div>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <div>
            Coluna <span className="text-emerald-700 font-semibold">verde</span> = realizado · cinza = projeção · <b>% atingido</b> = YTD real / YTD orçado.
          </div>
          <div>BP {ano} · {monthsRealizados}/12 meses realizados</div>
        </div>
      </div>
    </div>
  );
}
