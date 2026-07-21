import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload, ChevronDown, ChevronRight, Search, Sparkles, Loader2, RefreshCw, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { OmieDeParaPanel } from "@/components/OmieDeParaPanel";
import { runOmieSync } from "@/lib/omieSync";
import { SyncOmieButtons } from "@/components/SyncOmieButtons";

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

// Corta as colunas do import nas que têm dado real e substancial — planilhas de tracker
// costumam ter o ano inteiro (ou vários anos) de cabeçalho, mas só os meses já FECHADOS
// vêm de fato preenchidos; os meses futuros ficam em branco ou com lixo esporádico
// (ex.: uma fórmula do template deixando "1" numa célula). Sem esse corte, o import travava
// e sobrescrevia meses que nem estavam fechados ainda — inclusive apagando o que o Omie já
// tinha calculado pra eles. Mesmo critério do heurístico de lastCol/prevCol (linha populada
// em pelo menos 25% do máximo, piso de 3), parando no primeiro mês que não bate o critério.
function colunasFechadas(rows: Record<string, any>[], colsOrdenadas: string[]): string[] {
  const counts = colsOrdenadas.map((col) => rows.reduce((acc, row) => (typeof row[col] === "number" ? acc + 1 : acc), 0));
  const maxCount = Math.max(...counts, 0);
  if (maxCount === 0) return [];
  const minCount = Math.max(3, Math.ceil(maxCount * 0.25));
  let ultimoIdx = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] >= minCount) ultimoIdx = i;
    else break;
  }
  return colsOrdenadas.slice(0, ultimoIdx + 1);
}

/* ============================================================
 *  DFC schema (hierarchy)
 * ============================================================ */

type Kind = "header" | "child" | "leaf" | "total" | "percent";
type Node = {
  label: string;
  kind: Kind;
  children?: Node[];
};

// Estrutura completa da DFC (método direto). Os rótulos-folha batem EXATAMENTE
// com as rubricas do DE_PARA (coluna "PARA DFC"), inclusive capitalização.
// A ordem dos 7 blocos de topo é fixa (usada pelos KPIs):
//   [0] Entradas · [1] Saídas · [2] FCO · [3] Investimentos · [4] Financiamento · [5] Fluxo Livre · [6] Cashburn
const DFC_SCHEMA: Node[] = [
  { label: "Entradas Operacionais", kind: "header", children: [
    { label: "Receita de Assinaturas", kind: "child" },
    { label: "Receita com Materiais", kind: "child" },
    { label: "Receita Markup", kind: "child" },
    { label: "Receita de Serviços", kind: "child" },
    { label: "Entrada de Receita", kind: "child" },
    { label: "(+) Receita financeira", kind: "child" },
    { label: "(+) Resultado Não Operacional", kind: "child" },
  ]},
  { label: "Saídas Operacionais", kind: "header", children: [
    { label: "Impostos", kind: "child", children: [
      { label: "Simples Nacional", kind: "leaf" },
      { label: "PIS", kind: "leaf" },
      { label: "COFINS", kind: "leaf" },
      { label: "ISS", kind: "leaf" },
      { label: "ICMS", kind: "leaf" },
      { label: "IRF", kind: "leaf" },
      { label: "Parcelamento de Impostos", kind: "leaf" },
      { label: "Retenção de Contribuição", kind: "leaf" },
    ]},
    { label: "Pessoal", kind: "child", children: [
      { label: "Equipe Administrativa", kind: "leaf" },
      { label: "Equipe Comercial", kind: "leaf" },
      { label: "Equipe Marketing", kind: "leaf" },
      { label: "Equipe Tecnologia", kind: "leaf" },
      { label: "Equipe Operacional", kind: "leaf" },
      { label: "Equipe Onboarding", kind: "leaf" },
      { label: "Premiações Operacionais", kind: "leaf" },
      { label: "Premiações", kind: "leaf" },
      { label: "Encargos sociais", kind: "leaf" },
      { label: "Benefícios", kind: "leaf" },
    ]},
    { label: "Custos de Operação", kind: "child", children: [
      { label: "CMV Materiais", kind: "leaf" },
      { label: "Outros Custos", kind: "leaf" },
      { label: "Meios de Pagamento", kind: "leaf" },
      { label: "Servidor", kind: "leaf" },
      { label: "Softwares Operacionais", kind: "leaf" },
      { label: "MGM", kind: "leaf" },
    ]},
    { label: "Despesas Administrativas", kind: "child", children: [
      { label: "Assessorias & Consultorias", kind: "leaf" },
      { label: "Softwares Administrativos", kind: "leaf" },
      { label: "Ocupação & Escritório", kind: "leaf" },
      { label: "Viagens & Transportes Adm", kind: "leaf" },
      { label: "Outras Despesas Adm", kind: "leaf" },
    ]},
    { label: "Despesas Marketing & Vendas", kind: "child", children: [
      { label: "Softwares Marketing & Vendas", kind: "leaf" },
      { label: "Agências & Consultorias", kind: "leaf" },
      { label: "Campanhas de Mídia Paga", kind: "leaf" },
      { label: "Campanhas de Outros Canais", kind: "leaf" },
      { label: "Comissões Consultores / Parceiros", kind: "leaf" },
      { label: "Eventos e Feiras", kind: "leaf" },
      { label: "Viagens & Transportes Mkt", kind: "leaf" },
      { label: "Outras Despesas Mkt", kind: "leaf" },
    ]},
    { label: "Financeiras", kind: "child", children: [
      { label: "(-) Juros", kind: "leaf" },
      { label: "(-) IOF", kind: "leaf" },
      { label: "(-) Depesas Financeiras", kind: "leaf" },
    ]},
    { label: "Devoluções", kind: "child" },
  ]},
  { label: "Fluxo de Caixa Operacional", kind: "total" },
  { label: "Investimentos", kind: "header", children: [
    { label: "(-) Compra de Equipamentos", kind: "child" },
    { label: "(-) Investimentos em Estrutura", kind: "child" },
    { label: "(-) Compra de Participação", kind: "child" },
    { label: "Depósitos e Caução", kind: "child" },
  ]},
  { label: "Financiamento", kind: "header", children: [
    { label: "(+) Novos Empréstimos & Financiamentos", kind: "child" },
    { label: "(-) Amortização de Financiamentos", kind: "child" },
    { label: "Antecipação da Receita", kind: "child" },
    { label: "Abatimento de Antecipação da Receita", kind: "child" },
    { label: "(-) Rodada de Investimentos", kind: "child" },
  ]},
  { label: "Fluxo Livre", kind: "total" },
  { label: "Cashburn 12M", kind: "total" },
];

const flattenLabels = (nodes: Node[]): string[] =>
  nodes.flatMap((n) => [n.label, ...(n.children ? flattenLabels(n.children) : [])]);
const DFC_RUBRICAS = flattenLabels(DFC_SCHEMA);

/* ============================================================
 *  Page
 * ============================================================ */

export default function DFC() {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState<"dfc" | "depara">("dfc");
  const [tab, setTab] = useState<"valores" | "mom" | "acum">("valores");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [travados, setTravados] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const availableYears = useMemo(() => {
    const ys = new Set<string>();
    for (const c of columns) {
      const m = c.match(/^[A-Za-z]{3}-(\d{2})$/);
      if (m) ys.add(m[1]);
    }
    return Array.from(ys).sort();
  }, [columns]);

  const displayColumns = useMemo(() => {
    if (yearFilter === "all") return columns;
    return columns.filter(c => c.endsWith(`-${yearFilter}`));
  }, [columns, yearFilter]);

  useEffect(() => { document.title = "Demonstrações Financeiras · DFC"; }, []);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: travasData }] = await Promise.all([
      supabase
        .from("demonstracoes_contabeis" as any)
        .select("dados,updated_at")
        .eq("tipo", "dfc")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("demonstracoes_mes_trancado" as any).select("col_key"),
    ]);
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
    setTravados(new Set(((travasData as any[]) ?? []).map((t) => String(t.col_key))));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const sincronizarOmie = async (forcar: boolean) => {
    setSyncing(true);
    toast.message(forcar
      ? "Buscando dados do Omie (pode levar ~1–2 min)…"
      : "Recalculando com o cache do Omie…");
    try {
      const r = await runOmieSync({ forcar });
      if (r.status === "ok") {
        toast.success(
          `Omie sincronizado · ${r.movimentos ?? 0} lançamentos` +
          (r.nao_mapeadas ? ` · ${r.nao_mapeadas} categoria(s) sem DE_PARA` : ""),
        );
        await load();
      } else if (r.status === "erro") {
        toast.error("Falha na sincronização: " + (r.erro || "erro desconhecido"));
      } else {
        toast.message("A sincronização continua rodando em segundo plano. Recarregando o que já temos…");
        await load();
      }
    } catch (e: any) {
      toast.error("Falha ao sincronizar com o Omie: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

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

  /* ----- Import (Tracker template - reaproveita o mesmo fluxo do DRE, salva ambos) ----- */
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
      toast.error("Formato não suportado. Envie um arquivo .xlsx, .xls ou .csv.");
      e.target.value = "";
      return;
    }
    setImporting(true);
    try {
      let matrix: any[][] = [];
      if (ext === "csv") {
        const buf = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { text = new TextDecoder("windows-1252").decode(bytes); }
        const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
        const delim = (firstLines.match(/;/g)?.length ?? 0) > (firstLines.match(/,/g)?.length ?? 0) ? ";" : ",";
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

      let headerRowIdx = -1;
      let labelColIdx = 1;
      for (let i = 0; i < Math.min(matrix.length, 20); i++) {
        const row = matrix[i] || [];
        if (row.some((c: any) => colKey(String(c ?? "")))) {
          headerRowIdx = i;
          const dataCol = row.findIndex((c: any) => String(c ?? "").trim().toLowerCase() === "data");
          if (dataCol >= 0) labelColIdx = dataCol;
          break;
        }
      }
      if (headerRowIdx < 0) { toast.error("Não consegui identificar o cabeçalho de meses"); return; }

      const headerRow = matrix[headerRowIdx];
      const monthMap: { idx: number; key: string }[] = [];
      headerRow.forEach((cell: any, idx: number) => {
        const k = colKey(String(cell ?? ""));
        if (k) monthMap.push({ idx, key: k });
      });
      const seenKeys = new Set<string>();
      const monthCols = monthMap
        .sort((a, b) => sortKey(a.key) - sortKey(b.key))
        .filter(m => { if (seenKeys.has(m.key)) return false; seenKeys.add(m.key); return true; });
      const cols = monthCols.map(m => m.key);

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

      // Só considera "fechado" (grava + tranca) até o último mês com dado substancial em
      // cada demonstrativo — meses além disso (template ainda não preenchido) ficam de fora
      // e continuam sendo calculados normalmente pelo Sincronizar Omie.
      const dreColsFechadas = colunasFechadas(dreRows, cols);
      const dfcColsFechadas = colunasFechadas(dfcRows, cols);
      const mesesTrancados = new Set([...dreColsFechadas, ...dfcColsFechadas]);
      const colsIgnoradas = cols.filter((c) => !mesesTrancados.has(c));

      // Grava via edge function: mescla célula a célula com o que já existe (não substitui
      // o blob inteiro) e TRANCA os meses fechados deste arquivo — a partir de agora o
      // Sincronizar Omie não sobrescreve mais esses meses, só os que ainda estiverem abertos.
      const { data: impData, error: impErr } = await supabase.functions.invoke("demonstracoes-import", {
        body: {
          dre: dreColsFechadas.length ? { columns: ["Conta", ...dreColsFechadas], rows: dreRows } : undefined,
          dfc: dfcRows.length && dfcColsFechadas.length ? { columns: ["Conta", ...dfcColsFechadas], rows: dfcRows } : undefined,
        },
      });
      if (impErr) throw impErr;
      if ((impData as any)?.error) throw new Error((impData as any).error);
      toast.success(
        `Importado e travado: ${dfcRows.length} linhas DFC` + (dreRows.length ? ` · ${dreRows.length} linhas DRE` : "") +
        ` · ${mesesTrancados.size} mês(es) trancado(s)` +
        (colsIgnoradas.length ? ` · ${colsIgnoradas.length} ignorado(s) por dado incompleto (${colsIgnoradas.map(ptLabelFromKey).join(", ")})` : ""),
        { duration: 8000 },
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

  /* ----- KPIs: compara sempre os DOIS ÚLTIMOS MESES FECHADOS (travados) -----
   * Meses travados são meses fechados de verdade (tracker importado); o mês corrente
   * (aberto, sincronizando com o Omie aos poucos) está sempre incompleto e comparar
   * contra ele dava variações sem sentido. Se ainda não há pelo menos 2 meses travados
   * (ex.: instalação nova, antes do 1º import), cai no heurístico antigo de "mês mais
   * preenchido" para não deixar os KPIs vazios. */
  const { lastCol, prevCol } = useMemo(() => {
    const travadosOrdenados = columns.filter((c) => travados.has(c));
    if (travadosOrdenados.length >= 2) {
      return {
        lastCol: travadosOrdenados[travadosOrdenados.length - 1],
        prevCol: travadosOrdenados[travadosOrdenados.length - 2],
      };
    }

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
  }, [columns, rows, travados]);

  // Default ano = ano mais recente com dados
  useEffect(() => {
    if (yearFilter !== "all") return;
    if (!lastCol) return;
    const m = lastCol.match(/^[A-Za-z]{3}-(\d{2})$/);
    if (m) setYearFilter(m[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  function kpi(label: string): { val: number | null; prev: number | null; delta: number | null } {
    const row = valuesFor(label);
    const v = lastCol ? row[lastCol] : null;
    const p = prevCol ? row[prevCol] : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }

  // Cashburn 12M = soma dos últimos 12 meses do "Fluxo Livre" (ou Operacional, se não existir)
  function cashburnKpi(): { val: number | null; prev: number | null; delta: number | null } {
    const baseLabel = valueByLabel.has("fluxo livre")
      ? "Fluxo Livre"
      : valueByLabel.has("cashburn 12m")
        ? "Cashburn 12M"
        : "Fluxo de Caixa Operacional";
    if (!lastCol) return { val: null, prev: null, delta: null };
    const idx = columns.indexOf(lastCol);
    if (idx < 0) return { val: null, prev: null, delta: null };
    const window = columns.slice(Math.max(0, idx - 11), idx + 1);
    const prevWindow = columns.slice(Math.max(0, idx - 23), Math.max(0, idx - 11));
    const sum = (cs: string[]) => cs.reduce((acc, c) => {
      const v = valueAt(baseLabel, c);
      return v == null ? acc : acc + v;
    }, 0);
    const v = sum(window);
    const p = prevWindow.length ? sum(prevWindow) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }

  const sumChildren = (node: Node, col: string): number | null => {
    if (!node.children?.length) return valueAt(node.label, col);
    let total: number | null = null;
    for (const c of node.children) {
      const v = c.children?.length ? sumChildren(c, col) : valueAt(c.label, col);
      if (v != null) total = (total ?? 0) + v;
    }
    return total ?? valueAt(node.label, col);
  };

  // Cálculos derivados quando rótulos não existem na planilha
  function entradasAt(col: string): number | null {
    if (valueByLabel.has("entradas")) return valueAt("Entradas", col);
    return sumChildren(DFC_SCHEMA[0], col);
  }
  function saidasAt(col: string): number | null {
    if (valueByLabel.has("saídas")) return valueAt("Saídas", col);
    if (valueByLabel.has("saidas")) return valueAt("Saidas", col);
    return sumChildren(DFC_SCHEMA[1], col);
  }
  function fluxoOpAt(col: string): number | null {
    const v = valueAt("Fluxo de Caixa Operacional", col);
    if (v != null) return v;
    const e = entradasAt(col); const s = saidasAt(col);
    return e != null || s != null ? (e ?? 0) + (s ?? 0) : null;
  }
  function fluxoLivreAt(col: string): number | null {
    const v = valueAt("Fluxo Livre", col);
    if (v != null) return v;
    const op = fluxoOpAt(col);
    const inv = sumChildren(DFC_SCHEMA[3], col) ?? 0;
    const fin = sumChildren(DFC_SCHEMA[4], col) ?? 0;
    return op != null ? op + inv + fin : null;
  }

  const entradasKpi = useMemo(() => {
    const v = lastCol ? entradasAt(lastCol) : null;
    const p = prevCol ? entradasAt(prevCol) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }, [lastCol, prevCol, valueByLabel]);

  const saidasKpiV = useMemo(() => {
    const v = lastCol ? saidasAt(lastCol) : null;
    const p = prevCol ? saidasAt(prevCol) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }, [lastCol, prevCol, valueByLabel]);

  const fluxoOpKpi = useMemo(() => {
    const v = lastCol ? fluxoOpAt(lastCol) : null;
    const p = prevCol ? fluxoOpAt(prevCol) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }, [lastCol, prevCol, valueByLabel]);

  const fluxoLivreKpi = useMemo(() => {
    const v = lastCol ? fluxoLivreAt(lastCol) : null;
    const p = prevCol ? fluxoLivreAt(prevCol) : null;
    const d = v != null && p != null && p !== 0 ? (v - p) / Math.abs(p) : null;
    return { val: v, prev: p, delta: d };
  }, [lastCol, prevCol, valueByLabel]);

  const cashburn = useMemo(() => cashburnKpi(), [lastCol, prevCol, valueByLabel, columns]);

  const kpis: Array<{ key: string; title: string; val: number | null; prev: number | null; delta: number | null; pos: boolean }> = [
    { key: "entradas", title: "ENTRADAS", ...entradasKpi, pos: true },
    { key: "saidas", title: "SAÍDAS", ...saidasKpiV, pos: false },
    { key: "fop", title: "FLUXO OPERACIONAL", ...fluxoOpKpi, pos: true },
    { key: "fl", title: "FLUXO LIVRE", ...fluxoLivreKpi, pos: true },
    { key: "cb", title: "CASHBURN 12M", ...cashburn, pos: true },
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
    walk(DFC_SCHEMA, 0, false);
    return out;
  }, [collapsed]);

  const filtered = useMemo(() => {
    if (!search.trim()) return flat;
    const q = search.toLowerCase();
    return flat.filter(f => f.node.label.toLowerCase().includes(q));
  }, [flat, search]);

  function getValueForRow(node: Node, col: string): number | null {
    if (node.label === "Fluxo de Caixa Operacional") return fluxoOpAt(col);
    if (node.label === "Fluxo Livre") return fluxoLivreAt(col);
    if (node.label === "Cashburn 12M") {
      const idx = columns.indexOf(col);
      if (idx < 0) return null;
      const w = columns.slice(Math.max(0, idx - 11), idx + 1);
      return w.reduce<number | null>((acc, c) => {
        const v = fluxoLivreAt(c);
        return v == null ? acc : (acc ?? 0) + v;
      }, null);
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
    walk(DFC_SCHEMA);
    setCollapsed(all);
  }
  function expandAll() { setCollapsed(new Set()); }
  const allCollapsed = collapsed.size > 0;

  const monthsCount = columns.length;
  const lastLabel = lastCol ? ptLabelFromKey(lastCol) : "—";
  const prevLabel = prevCol ? ptLabelFromKey(prevCol) : "—";

  /* ============================================================
   *  UI
   * ============================================================ */

  return (
    <div className="min-h-full bg-background">
      {/* header */}
      <div className="px-6 pt-5 pb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-2">
            Demonstração de Fluxo de Caixa
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-primary">DFC</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Demonstrativo do fluxo de caixa · {lastLabel} · {prevLabel} · {monthsCount} meses · método direto
            {travados.size > 0 && (
              <span className="inline-flex items-center gap-1 ml-1.5 text-emerald-700">
                <Lock className="h-3 w-3" /> {travados.size} travado{travados.size === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-border p-0.5">
            <button
              onClick={() => setView("dfc")}
              className={cn("h-7 rounded px-2.5 text-[12px] font-medium transition-colors", view === "dfc" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              DFC
            </button>
            <button
              onClick={() => setView("depara")}
              className={cn("h-7 rounded px-2.5 text-[12px] font-medium transition-colors", view === "depara" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              DE-PARA
            </button>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 h-8 text-[11.5px] font-medium text-emerald-700">
            <Sparkles className="h-3.5 w-3.5" />
            Tracker vOMIE ativo · sincronizado
          </span>
          <Button variant="outline" size="sm" className="h-8 text-[12px]">Exportar</Button>
          <SyncOmieButtons
            syncing={syncing}
            onRecalcular={() => sincronizarOmie(false)}
            onAtualizar={() => sincronizarOmie(true)}
            recalcularHint="Recalcula a DRE/DFC com os dados já baixados do Omie (cache das últimas horas). Instantâneo e sem consumir a API do Omie. Use para refletir mudanças de DE_PARA ou de meses travados."
            atualizarHint="Busca os lançamentos direto do Omie agora, ignorando o cache, e recalcula. Mais lento (~1–2 min) e consome a API do Omie. Use quando lançou/alterou algo no Omie e quer refletir na hora."
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="h-8 text-[12px]"
          >
            {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Importar Excel/CSV
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onImport} />
        </div>
      </div>

      {view === "depara" ? (
        <OmieDeParaPanel demonstrativo="dfc" rubricas={DFC_RUBRICAS} />
      ) : (
        <>
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
                  {isNeg ? `(${fmtMoney(Math.abs(k.val ?? 0))})` : fmtMoney(k.val)}
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
            { id: "valores", label: "Método direto" },
            { id: "mom", label: "Método indireto" },
            { id: "acum", label: "Caixa acumulado" },
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
              placeholder="Buscar rubrica…"
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
            Nenhum dado importado. Clique em <b>Importar Excel/CSV</b> para enviar o Tracker.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky left-0 z-20 bg-muted px-3 py-2 text-left text-[10px] font-semibold tracking-[0.08em] text-muted-foreground w-[220px] min-w-[220px] shadow-[1px_0_0_0_hsl(var(--border))]">
                    RUBRICA
                  </th>
                  {displayColumns.map(c => (
                    <th key={c} className="px-1.5 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap num min-w-[64px]">
                      <span className="inline-flex items-center justify-end gap-1">
                        {travados.has(c) && (
                          <span title="Mês travado — dado do tracker, não sincroniza com o Omie" className="inline-flex">
                            <Lock className="h-2.5 w-2.5 text-emerald-600" aria-label="Mês travado" />
                          </span>
                        )}
                        {ptLabelFromKey(c).replace("/", " ")}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ node, depth, hidden }) => {
                  if (hidden) return null;
                  const isHeader = node.kind === "header";
                  const isTotal = node.kind === "total";
                  const isChild = node.kind === "child";
                  const isLeaf = node.kind === "leaf";
                  const hasChildren = !!node.children?.length;
                  const isCol = collapsed.has(node.label);

                  const rowCls = cn(
                    "border-b border-border/60 transition-colors",
                    isTotal && "bg-emerald-50/40 font-semibold",
                    isHeader && "font-semibold",
                    !isHeader && !isTotal && "hover:bg-muted/30",
                  );

                  return (
                    <tr key={node.label + depth} className={rowCls}>
                      <td
                        className={cn(
                          "sticky left-0 z-[2] px-3 py-1.5 text-[12.5px] w-[220px] min-w-[220px] shadow-[1px_0_0_0_hsl(var(--border))]",
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
                          // Caixa acumulado: soma do fluxo livre até a coluna
                          const idx = columns.indexOf(c);
                          if (idx < 0) v = null;
                          else {
                            const w = columns.slice(0, idx + 1);
                            v = w.reduce<number | null>((acc, cc) => {
                              const x = isHeader && hasChildren ? sumChildren(node, cc) : getValueForRow(node, cc);
                              return x == null ? acc : (acc ?? 0) + x;
                            }, null);
                          }
                        }

                        const isNeg = (v ?? 0) < 0;
                        const display =
                          tab === "mom"
                            ? fmtPct(v)
                            : (isNeg ? `(${fmtCompact(Math.abs(v ?? 0))})` : fmtCompact(v));
                        return (
                          <td
                            key={c}
                            className={cn(
                              "px-1.5 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[64px]",
                              isNeg ? "text-primary" : isTotal ? "text-emerald-800" : "text-foreground/90",
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
      </>
      )}
    </div>
  );
}
