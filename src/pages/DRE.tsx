import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload, ChevronDown, ChevronRight, Search, Sparkles, Loader2,
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
const MES_PT_FULL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function colKey(ptLabel: string): string | null {
  // "jan/24" => "Jan-24"
  const m = ptLabel?.toString().toLowerCase().trim().match(/^([a-zçãéê]{3,})[\s\/\-]+(\d{2,4})$/);
  if (!m) return null;
  const en = MES_PT_TO_EN[m[1].slice(0, 3)];
  if (!en) return null;
  const yy = m[2].length === 4 ? m[2].slice(-2) : m[2];
  return `${en}-${yy}`;
}
function ptLabelFromKey(k: string): string {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return k;
  const idx = EN_ORDER.indexOf(m[1]);
  return idx >= 0 ? `${MES_PT_FULL[idx]}/${m[2]}` : k;
}
function sortKey(k: string): number {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return -1;
  const i = EN_ORDER.indexOf(m[1]);
  if (i < 0) return -1;
  return (2000 + parseInt(m[2], 10)) * 12 + i;
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  s = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
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
  let s: string;
  if (abs >= 1_000_000) s = (v / 1_000_000).toFixed(2).replace(".", ",") + " M";
  else if (abs >= 1_000) s = (v / 1_000).toFixed(1).replace(".", ",") + " K";
  else s = v.toFixed(0);
  return s;
}
function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

/* ============================================================
 *  DRE schema (hierarchy)
 * ============================================================ */

type Kind = "header" | "child" | "leaf" | "total" | "percent";
type Node = {
  label: string;
  kind: Kind;
  /** label real no CSV (se diferente de `label`) */
  src?: string;
  /** se for percent, divide pelo total deste rótulo */
  pctOf?: string;
  children?: Node[];
};

const DRE_SCHEMA: Node[] = [
  { label: "Receita Bruta", kind: "header", children: [
    { label: "Receita Recorrente", kind: "child", children: [
      { label: "Receita de Assinaturas", kind: "leaf" },
      { label: "Enterprise", kind: "leaf" },
    ]},
    { label: "Receita Spot", kind: "child" },
    { label: "Receita com Materiais", kind: "child" },
    { label: "Receita Markup", kind: "child" },
    { label: "Serviços para Clientes", kind: "child" },
  ]},
  { label: "(-) Deduções da receita", kind: "header", children: [
    { label: "Simples Nacional", kind: "child" },
    { label: "PIS", kind: "child" },
    { label: "COFINS", kind: "child" },
    { label: "ISS", kind: "child" },
    { label: "ICMS", kind: "child" },
    { label: "Inadimplência", kind: "child" },
    { label: "Devoluções", kind: "child" },
  ]},
  { label: "Receita Líquida", kind: "total" },
  { label: "(-) Custos Operacionais", kind: "header", children: [
    { label: "Equipe Operacional", kind: "child" },
    { label: "Premiações Operacionais", kind: "child" },
    { label: "Meios de Pagamento", kind: "child" },
    { label: "CMV Materiais", kind: "child" },
    { label: "Servidor", kind: "child" },
    { label: "Softwares Operacionais", kind: "child" },
    { label: "Outros Custos", kind: "child" },
  ]},
  { label: "Margem de contribuição", kind: "total" },
  { label: "% Margem de contribuição", kind: "percent", pctOf: "Receita Líquida" },
  { label: "(-) SG&A", kind: "header", children: [
    { label: "Pessoal", kind: "child", children: [
      { label: "Equipe Administrativa", kind: "leaf" },
      { label: "Equipe Marketing", kind: "leaf" },
      { label: "Equipe Parcerias", kind: "leaf" },
      { label: "Equipe Comercial", kind: "leaf" },
      { label: "Equipe Onboarding", kind: "leaf" },
      { label: "Equipe Tecnologia", kind: "leaf" },
      { label: "Benefícios", kind: "leaf" },
      { label: "Encargos Sociais", kind: "leaf" },
    ]},
    { label: "Despesas Administrativas", kind: "child", children: [
      { label: "Ocupação & Escritório", kind: "leaf" },
      { label: "Assessorias & Consultorias", kind: "leaf" },
      { label: "Softwares Administrativos", kind: "leaf" },
      { label: "Viagens & Transportes Adm", kind: "leaf" },
      { label: "Outras despesas Adm", kind: "leaf" },
    ]},
    { label: "Despesas Marketing & Vendas", kind: "child", children: [
      { label: "Campanhas de Mídia Paga", kind: "leaf" },
      { label: "Campanhas de Outros Canais", kind: "leaf" },
      { label: "Comissões Consultores / Parceiros", kind: "leaf" },
      { label: "Premiações", kind: "leaf" },
      { label: "MGM", kind: "leaf" },
      { label: "Softwares Marketing & Vendas", kind: "leaf" },
      { label: "Agências & Consultorias", kind: "leaf" },
      { label: "Viagens & Transportes Mkt", kind: "leaf" },
      { label: "Eventos e Feiras", kind: "leaf" },
      { label: "Outras despesas Mkt", kind: "leaf" },
    ]},
  ]},
  { label: "EBITDA", kind: "total" },
  { label: "% Margem EBITDA", kind: "percent", pctOf: "Receita Líquida" },
  { label: "(+/-) Resultado Financeiro", kind: "header", children: [
    { label: "(-) Depreciação & Amortização", kind: "child" },
    { label: "(-) Juros", kind: "child" },
    { label: "(-) IOF", kind: "child" },
    { label: "(+) Receita financeira", kind: "child" },
  ]},
  { label: "(+/-) Resultado Não Operacional", kind: "header", children: [
    { label: "Despesas Não Operacionais", kind: "child" },
    { label: "(-) Estorno de Compras", kind: "child" },
  ]},
  { label: "(-) Impostos", kind: "header", children: [
    { label: "IRPJ", kind: "child" },
    { label: "CSLL", kind: "child" },
    { label: "IRF", kind: "child" },
  ]},
  { label: "Lucro Líquido", kind: "total" },
  { label: "% Margem Líquida", kind: "percent", pctOf: "Receita Líquida" },
];

/* ============================================================
 *  Page
 * ============================================================ */

export default function DRE() {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<"valores" | "mom" | "pct">("valores");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [yearFilter, setYearFilter] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);

  // Anos disponíveis a partir das colunas
  const availableYears = useMemo(() => {
    const ys = new Set<string>();
    for (const c of columns) {
      const m = c.match(/^[A-Za-z]{3}-(\d{2})$/);
      if (m) ys.add(m[1]);
    }
    return Array.from(ys).sort();
  }, [columns]);

  // Colunas visíveis após filtro de ano
  const displayColumns = useMemo(() => {
    if (yearFilter === "all") return columns;
    return columns.filter(c => c.endsWith(`-${yearFilter}`));
  }, [columns, yearFilter]);

  useEffect(() => { document.title = "Demonstrações Financeiras · DRE"; }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("demonstracoes_contabeis" as any)
      .select("dados,updated_at")
      .eq("tipo", "dre")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw: any = (data as any)?.dados;
    let r: any[] = [];
    let cols: string[] = [];
    if (raw) {
      if (Array.isArray(raw)) { r = raw; cols = r[0] ? Object.keys(r[0]) : []; }
      else if (Array.isArray(raw.rows)) { r = raw.rows; cols = raw.columns || (r[0] ? Object.keys(r[0]) : []); }
    }
    const monthCols = cols.filter(c => /^[A-Za-z]{3}-\d{2}$/.test(c)).sort((a, b) => sortKey(a) - sortKey(b));
    setColumns(monthCols);
    setRows(r);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Default: ao carregar, seleciona o ano mais recente com dados
  useEffect(() => {
    if (yearFilter !== "all") return;
    if (!lastCol) return;
    const m = lastCol.match(/^[A-Za-z]{3}-(\d{2})$/);
    if (m) setYearFilter(m[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  /* ----- Lookup map by label ----- */
  const valueByLabel = useMemo(() => {
    const map = new Map<string, Record<string, number | null>>();
    for (const r of rows) {
      const labelKey = Object.keys(r).find(k => !/^[A-Za-z]{3}-\d{2}$/.test(k));
      const label = labelKey ? String(r[labelKey] ?? "").trim() : "";
      if (!label) continue;
      const obj: Record<string, number | null> = {};
      for (const c of columns) obj[c] = toNum(r[c]);
      map.set(label.toLowerCase(), obj);
    }
    return map;
  }, [rows, columns]);

  function valuesFor(label: string): Record<string, number | null> {
    return valueByLabel.get(label.toLowerCase()) ?? Object.fromEntries(columns.map(c => [c, null]));
  }
  function valueAt(label: string, col: string): number | null {
    return valuesFor(label)[col] ?? null;
  }

  /* ----- Import (Tracker template) ----- */
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setImporting(true);
    try {
      const ext = f.name.split(".").pop()?.toLowerCase();
      let matrix: any[][] = [];
      if (ext === "csv") {
        // Detecta encoding e parseia manualmente (separador ; com vírgula decimal BR)
        const buf = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { text = new TextDecoder("windows-1252").decode(bytes); }
        // Detecta delimitador
        const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
        const delim = (firstLines.match(/;/g)?.length ?? 0) > (firstLines.match(/,/g)?.length ?? 0) ? ";" : ",";
        // Parser CSV simples com aspas
        const parseCsv = (src: string, d: string): string[][] => {
          const out: string[][] = [];
          let row: string[] = [], cur = "", inQ = false;
          for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            if (inQ) {
              if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
              else if (ch === '"') inQ = false;
              else cur += ch;
            } else {
              if (ch === '"') inQ = true;
              else if (ch === d) { row.push(cur); cur = ""; }
              else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
              else if (ch === "\r") { /* skip */ }
              else cur += ch;
            }
          }
          if (cur.length || row.length) { row.push(cur); out.push(row); }
          return out;
        };
        matrix = parseCsv(text, delim);
      } else {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as any[][];
      }

      // Encontra a linha de cabeçalho (contém "jan/24" ou similar) e a coluna do rótulo
      let headerRowIdx = -1;
      let labelColIdx = 1;
      for (let i = 0; i < Math.min(matrix.length, 20); i++) {
        const row = matrix[i] || [];
        if (row.some((c: any) => colKey(String(c ?? "")))) {
          headerRowIdx = i;
          // a coluna do rótulo costuma ser a que tem "Data"
          const dataCol = row.findIndex((c: any) => String(c ?? "").trim().toLowerCase() === "data");
          if (dataCol >= 0) labelColIdx = dataCol;
          break;
        }
      }
      if (headerRowIdx < 0) {
        toast.error("Não consegui identificar o cabeçalho de meses");
        return;
      }

      const headerRow = matrix[headerRowIdx];
      const monthMap: { idx: number; key: string }[] = [];
      headerRow.forEach((cell: any, idx: number) => {
        const k = colKey(String(cell ?? ""));
        if (k) monthMap.push({ idx, key: k });
      });
      // Ordena cronologicamente e dedupa
      const seenKeys = new Set<string>();
      const monthCols = monthMap
        .sort((a, b) => sortKey(a.key) - sortKey(b.key))
        .filter(m => { if (seenKeys.has(m.key)) return false; seenKeys.add(m.key); return true; });
      const cols = monthCols.map(m => m.key);

      // Localiza separadores das seções
      let dreStart = -1, dfcStart = -1;
      for (let i = headerRowIdx + 1; i < matrix.length; i++) {
        const lab = String(matrix[i]?.[labelColIdx] ?? "").trim().toLowerCase();
        if (!lab) continue;
        if (dreStart < 0 && lab.includes("demonstrativo de resultado")) dreStart = i;
        else if (dfcStart < 0 && (lab.includes("fluxo de caixa") || lab === "dfc")) { dfcStart = i; break; }
      }
      if (dreStart < 0) dreStart = headerRowIdx;
      const dreEnd = dfcStart > 0 ? dfcStart : matrix.length;
      const dfcEnd = matrix.length;

      const buildRows = (from: number, to: number): Record<string, any>[] => {
        const out: Record<string, any>[] = [];
        for (let i = from + 1; i < to; i++) {
          const row = matrix[i] || [];
          const lab = String(row[labelColIdx] ?? "").trim();
          if (!lab) continue;
          const rec: Record<string, any> = { Conta: lab };
          for (const m of monthCols) {
            const v = toNum(row[m.idx]);
            rec[m.key] = v === null ? "" : v;
          }
          out.push(rec);
        }
        return out;
      };

      const dreRows = buildRows(dreStart, dreEnd);
      const dfcRows = dfcStart > 0 ? buildRows(dfcStart, dfcEnd) : [];

      const ops: any[] = [];
      ops.push(await supabase.from("demonstracoes_contabeis" as any).upsert(
        { tipo: "dre", periodo: "completo", dados: { columns: ["Conta", ...cols], rows: dreRows }, pdf_path: null } as any,
        { onConflict: "tipo,periodo" },
      ));
      if (dfcRows.length) {
        ops.push(await supabase.from("demonstracoes_contabeis" as any).upsert(
          { tipo: "dfc", periodo: "completo", dados: { columns: ["Conta", ...cols], rows: dfcRows }, pdf_path: null } as any,
          { onConflict: "tipo,periodo" },
        ));
      }
      const errs = ops.map(r => (r as any).error).filter(Boolean);
      if (errs.length) throw errs[0];
      toast.success(
        `Importado: ${dreRows.length} linhas DRE` + (dfcRows.length ? ` · ${dfcRows.length} linhas DFC` : ""),
      );
      load();
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
      e.target.value = "";
    }
  };

  /* ----- KPIs (sempre o mês mais recente realmente preenchido) ----- */
  const { lastCol, prevCol } = useMemo(() => {
    const populatedCounts = columns.map((col) => {
      const count = rows.reduce((acc, row) => {
        const raw = row?.[col];
        if (raw === "" || raw === null || raw === undefined) return acc;
        return toNum(raw) === null ? acc : acc + 1;
      }, 0);

      return { col, count };
    });

    const maxCount = Math.max(...populatedCounts.map(({ count }) => count), 0);
    const minCountForValidMonth = maxCount > 0 ? Math.max(3, Math.ceil(maxCount * 0.25)) : 1;

    const validMonths = populatedCounts
      .filter(({ count }) => count >= minCountForValidMonth)
      .map(({ col }) => col);

    const last = validMonths[validMonths.length - 1] ?? columns[columns.length - 1];
    const lastValidIdx = validMonths.indexOf(last);
    const prev = lastValidIdx > 0
      ? validMonths[lastValidIdx - 1]
      : columns[Math.max(columns.indexOf(last) - 1, 0)];

    return { lastCol: last, prevCol: prev };
  }, [columns, rows]);

  function kpi(label: string): { val: number | null; prev: number | null; delta: number | null } {
    const row = valuesFor(label);
    const v = lastCol ? row[lastCol] : null;
    const p = prevCol ? row[prevCol] : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }
  function pctKpi(num: string, den: string): { val: number | null; prev: number | null; delta: number | null } {
    const n = valuesFor(num); const d = valuesFor(den);
    const v = lastCol && d[lastCol] ? (n[lastCol]! / d[lastCol]!) : null;
    const p = prevCol && d[prevCol] ? (n[prevCol]! / d[prevCol]!) : null;
    const dd = v != null && p != null ? v - p : null;
    return { val: v, prev: p, delta: dd };
  }

  const kpis: Array<{ key: string; title: string; val: number | null; prev: number | null; delta: number | null; pos: boolean; isPct?: boolean }> = [
    { key: "receita", title: "RECEITA LÍQUIDA", ...kpi("Receita Líquida"), pos: true },
    { key: "ebitda", title: "EBITDA", ...kpi("EBITDA"), pos: true },
    { key: "margem", title: "MARGEM EBITDA", ...pctKpi("EBITDA", "Receita Líquida"), pos: true, isPct: true },
    { key: "lucro", title: "LUCRO LÍQUIDO", ...kpi("Lucro Líquido"), pos: true },
    { key: "sga", title: "SG&A", ...kpi("(-) SG&A"), pos: false },
  ];

  /* ----- Render rows from schema ----- */
  type Flat = { node: Node; depth: number; hidden?: boolean };
  const flat: Flat[] = useMemo(() => {
    const out: Flat[] = [];
    const walk = (nodes: Node[], depth: number, parentCollapsed: boolean) => {
      for (const n of nodes) {
        out.push({ node: n, depth, hidden: parentCollapsed });
        if (n.children?.length) {
          const isCol = collapsed.has(n.label);
          walk(n.children, depth + 1, parentCollapsed || isCol);
        }
      }
    };
    walk(DRE_SCHEMA, 0, false);
    return out;
  }, [collapsed]);

  const filtered = useMemo(() => {
    if (!search.trim()) return flat;
    const q = search.toLowerCase();
    return flat.filter(f => f.node.label.toLowerCase().includes(q));
  }, [flat, search]);

  function getValueForRow(node: Node, col: string, prev?: string): number | null {
    if (node.kind === "percent" && node.pctOf) {
      const num = valueAt(node.label.replace(/^%\s*/, ""), col) ?? 0;
      // Try multiple bases for %
      // For "% Margem EBITDA": numerator is EBITDA, denominator is Receita Líquida
      const numerator =
        node.label.includes("EBITDA") ? valueAt("EBITDA", col)
        : node.label.includes("contribuição") ? valueAt("Margem de contribuição", col)
        : node.label.includes("Líquida") ? valueAt("Lucro Líquido", col)
        : num;
      const den = valueAt(node.pctOf, col);
      if (numerator == null || den == null || den === 0) return null;
      return numerator / den;
    }
    return valueAt(node.label, col);
  }

  function toggle(label: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  function collapseAll() {
    const all = new Set<string>();
    const walk = (n: Node[]) => n.forEach(x => { if (x.children?.length) { all.add(x.label); walk(x.children); } });
    walk(DRE_SCHEMA);
    setCollapsed(all);
  }
  function expandAll() { setCollapsed(new Set()); }
  const allCollapsed = collapsed.size > 0;

  const monthsCount = columns.length;
  const lastLabel = lastCol ? ptLabelFromKey(lastCol) : "—";
  const prevLabel = prevCol ? ptLabelFromKey(prevCol) : "—";

  const sumChildren = (node: Node, col: string): number | null => {
    if (!node.children?.length) return valueAt(node.label, col);
    let total: number | null = null;
    for (const c of node.children) {
      const v = c.children?.length ? sumChildren(c, col) : valueAt(c.label, col);
      if (v != null) total = (total ?? 0) + v;
    }
    return total ?? valueAt(node.label, col);
  };

  /* ============================================================
   *  UI
   * ============================================================ */

  return (
    <div className="min-h-full bg-background">
      {/* header */}
      <div className="px-6 pt-5 pb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-2">
            Demonstração do Resultado do Exercício
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-primary">DRE</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Demonstrativo de resultado · {lastLabel} · {prevLabel} · {monthsCount} meses · {rows.length} contas detectadas
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 h-8 text-[11.5px] font-medium text-emerald-700">
            <Sparkles className="h-3.5 w-3.5" />
            Tracker vOMIE ativo · sincronizado
          </span>
          <Button variant="outline" size="sm" className="h-8 text-[12px]">Mapear chaves</Button>
          <Button variant="outline" size="sm" className="h-8 text-[12px]">Exportar</Button>
          <Button
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="h-8 text-[12px] bg-foreground text-background hover:bg-foreground/90"
          >
            {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Reimportar Excel
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onImport} />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 px-6 md:grid-cols-3 lg:grid-cols-5">
        {kpis.map(k => {
          const isNeg = (k.val ?? 0) < 0;
          const deltaPos = (k.delta ?? 0) > 0;
          const goodDelta = k.pos ? deltaPos : !deltaPos;
          return (
            <div key={k.key} className="rounded-lg border border-border bg-card p-3.5">
              <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">{k.title}</div>
              <div className="mt-2 flex items-baseline justify-between">
                <div className={cn("text-[19px] font-bold tracking-tight num", isNeg ? "text-primary" : "text-foreground")}>
                  {k.isPct ? fmtPct(k.val) : (isNeg ? `(${fmtMoney(Math.abs(k.val ?? 0)).replace("R$ ", "R$ ")})` : fmtMoney(k.val))}
                </div>
                {k.delta != null && (
                  <span className={cn(
                    "text-[10.5px] font-semibold px-1.5 py-0.5 rounded num",
                    goodDelta ? "text-emerald-700 bg-emerald-50" : "text-primary bg-primary/10",
                  )}>
                    {deltaPos ? "▲" : "▼"} {Math.abs((k.delta ?? 0) * 100).toFixed(1).replace(".", ",")}%
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10.5px] text-muted-foreground num">
                Anterior · {prevLabel}
              </div>
              <div className="text-[10.5px] text-muted-foreground num">
                vs {lastLabel}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabs + search */}
      <div className="mt-4 px-6 flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex items-center gap-1">
          {[
            { id: "valores", label: "Valores" },
            { id: "mom", label: "Variação MoM" },
            { id: "pct", label: "% sobre receita" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={cn(
                "h-9 px-3 text-[12.5px] font-medium border-b-2 -mb-px transition-colors",
                tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conta…"
              className="h-8 w-[200px] pl-7 text-[12px]"
            />
          </div>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">Todos os anos</option>
            {availableYears.map(y => (
              <option key={y} value={y}>20{y}</option>
            ))}
          </select>
          <Button variant="ghost" size="sm" className="h-8 text-[12px] text-muted-foreground" onClick={() => allCollapsed ? expandAll() : collapseAll()}>
            {allCollapsed ? "Expandir tudo" : "Colapsar tudo"}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="px-6 pb-8">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !rows.length ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Nenhum dado importado. Clique em <b>Reimportar Excel</b> para enviar o Tracker.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky left-0 z-20 bg-muted px-3 py-2 text-left text-[10px] font-semibold tracking-[0.08em] text-muted-foreground w-[280px] min-w-[280px] shadow-[1px_0_0_0_hsl(var(--border))]">
                    RUBRICA
                  </th>
                  {displayColumns.map(c => (
                    <th key={c} className="px-3 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap num min-w-[88px]">
                      {ptLabelFromKey(c).replace("/", " ")}
                    </th>
                  ))}
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

                  // Row classes
                  const rowCls = cn(
                    "border-b border-border/60 transition-colors",
                    isTotal && "bg-emerald-50/40 font-semibold",
                    isPercent && "text-muted-foreground italic text-[11.5px]",
                    isHeader && "font-semibold",
                    !isHeader && !isTotal && !isPercent && "hover:bg-muted/30",
                  );

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
                            <button
                              onClick={() => toggle(node.label)}
                              className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                            >
                              {isCol ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          ) : (
                            <span className="inline-block w-4" />
                          )}
                          <span className={cn(
                            isTotal && "text-emerald-800",
                            isHeader && !isTotal && "text-foreground",
                            isChild && "text-foreground/85",
                            isLeaf && "text-muted-foreground",
                          )}>
                            {node.label}
                          </span>
                        </div>
                      </td>
                      {displayColumns.map(c => {
                        let v: number | null = null;
                        if (tab === "valores") {
                          v = isHeader && hasChildren ? sumChildren(node, c) : getValueForRow(node, c);
                        } else if (tab === "mom") {
                          const idx = columns.indexOf(c);
                          const prev = idx > 0 ? columns[idx - 1] : null;
                          const cur = isHeader && hasChildren ? sumChildren(node, c) : getValueForRow(node, c);
                          const pre = prev ? (isHeader && hasChildren ? sumChildren(node, prev) : getValueForRow(node, prev)) : null;
                          v = (cur != null && pre != null && pre !== 0) ? (cur - pre) / Math.abs(pre) : null;
                        } else {
                          // % sobre receita
                          const cur = isHeader && hasChildren ? sumChildren(node, c) : getValueForRow(node, c);
                          const rec = valueAt("Receita Líquida", c);
                          v = (cur != null && rec && rec !== 0) ? cur / rec : null;
                        }

                        const isNeg = (v ?? 0) < 0;
                        const display =
                          isPercent || tab === "mom" || tab === "pct"
                            ? fmtPct(v)
                            : (isNeg ? `(${fmtCompact(Math.abs(v ?? 0))})` : fmtCompact(v));
                        return (
                          <td
                            key={c}
                            className={cn(
                              "px-3 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[88px]",
                              isNeg && !isPercent ? "text-primary" : isTotal ? "text-emerald-800" : "text-foreground/90",
                              v == null && "text-muted-foreground/40",
                            )}
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <div>Valores em <b>R$</b>. Negativos entre parênteses · arredondamento na unidade.</div>
          <div>Importado de Tracker_vOMIE_Realizado.xlsx · sincronizado há 12 min</div>
        </div>
      </div>
    </div>
  );
}
