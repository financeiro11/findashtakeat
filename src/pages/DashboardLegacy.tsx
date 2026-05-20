import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ComposedChart, Cell, ReferenceArea, LineChart, Line, Legend, PieChart, Pie,
} from "recharts";
import { Sparkles, RefreshCw, Loader2, Settings2, X, Calendar, SlidersHorizontal, Filter as FilterIcon, Download, AlertOctagon, AlertTriangle, Info, ArrowRight, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { KpiCard } from "@/components/ui/kpi-card";
import { SectionCard } from "@/components/ui/section-card";
import { Delta } from "@/components/ui/delta";
import { openAIAssistant } from "@/components/AIAssistant";
import { FinanceAIPanel, openFinanceAI } from "@/components/FinanceAIPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Row = Record<string, any>;

const MONTH_RE = /^([A-Za-z]{3})-(\d{2})$/;
const MONTH_ORDER = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_PT: Record<string, string> = { Jan:"Jan", Feb:"Fev", Mar:"Mar", Apr:"Abr", May:"Mai", Jun:"Jun", Jul:"Jul", Aug:"Ago", Sep:"Set", Oct:"Out", Nov:"Nov", Dec:"Dez" };

function toNum(v: any): number {
  if (typeof v === "number") return v;
  if (v == null || v === "" || v === "-") return 0;
  const s = String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function labelOf(r: Row): string {
  // Label is the value of the first non-month column (e.g. "Data", "Conta", "Descrição")
  for (const [k, v] of Object.entries(r)) {
    if (!MONTH_RE.test(k) && v != null && String(v).trim() !== "") {
      return String(v).toLowerCase().trim();
    }
  }
  return "";
}

function findRow(rows: Row[], terms: string[]): Row | null {
  if (!Array.isArray(rows)) return null;
  return rows.find(r => {
    const first = labelOf(r);
    return terms.some(t => first === t.toLowerCase() || first.includes(t.toLowerCase()));
  }) ?? null;
}

function monthCols(rows: Row[]): { key: string; label: string; sortKey: number }[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const cols: { key: string; label: string; sortKey: number }[] = [];
  for (const k of keys) {
    const m = k.match(MONTH_RE);
    if (!m) continue;
    const mIdx = MONTH_ORDER.indexOf(m[1]);
    if (mIdx < 0) continue;
    // Conta linhas com dados reais; pula meses parcialmente preenchidos
    let filled = 0;
    for (const r of rows) {
      const v = r[k];
      if (v == null || v === "" || v === "-" || v === ".") continue;
      if (typeof v === "number") { if (v !== 0) filled++; continue; }
      const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, ""));
      if (!isNaN(n) && n !== 0) filled++;
    }
    // Considera mês válido apenas se tiver pelo menos 20% das linhas preenchidas
    // (evita pegar meses parcialmente lançados como "último mês")
    if (filled < Math.max(5, Math.ceil(rows.length * 0.2))) continue;
    const year = 2000 + parseInt(m[2], 10);
    cols.push({ key: k, label: MONTH_PT[m[1]] ?? m[1], sortKey: year * 12 + mIdx });
  }
  return cols.sort((a, b) => a.sortKey - b.sortKey);
}

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtBRLShort = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
};
const normalizePctValue = (n: number) => (Math.abs(n) > 1 ? n : n * 100);
const fmtPct = (n: number, digits = 2) => `${normalizePctValue(n).toFixed(digits).replace(".", ",")}%`;
const pctDelta = (cur: number, prev: number) => {
  if (!prev) return 0;
  return ((cur - prev) / Math.abs(prev)) * 100;
};

export default function DashboardLegacy() {
  const { profile } = useAuth();
  const [dre, setDre] = useState<Row[]>([]);
  const [dfc, setDfc] = useState<Row[]>([]);
  const [insights, setInsights] = useState<{ titulo: string; texto: string; tom: string }[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [openInsight, setOpenInsight] = useState<number | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<Date>(() => {
    const raw = localStorage.getItem("header:period");
    return raw ? new Date(raw) : new Date();
  });

  useEffect(() => {
    const onPeriod = (e: any) => {
      const p = e?.detail?.period;
      if (p) setSelectedPeriod(new Date(p));
    };
    window.addEventListener("header:period-change", onPeriod);
    return () => window.removeEventListener("header:period-change", onPeriod);
  }, []);

  async function loadInsights(force = false) {
    setLoadingInsights(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-dashboard-insights", { body: { force } });
      if (!error && data?.insights) setInsights(data.insights);
    } finally { setLoadingInsights(false); }
  }

  useEffect(() => {
    document.title = "Início · Central do Financeiro";
    (async () => {
      const { data } = await supabase
        .from("demonstracoes_contabeis" as any)
        .select("tipo,dados,updated_at,periodo")
        .in("tipo", ["dre", "dfc"])
        .order("updated_at", { ascending: false });
      const seen = new Set<string>();
      (data ?? []).forEach((d: any) => {
        if (seen.has(d.tipo)) return;
        seen.add(d.tipo);
        const rows = Array.isArray(d.dados) ? d.dados : (d.dados?.rows ?? []);
        if (d.tipo === "dre") setDre(rows);
        if (d.tipo === "dfc") setDfc(rows);
      });
      loadInsights(false);
    })();
  }, []);

  const cols = useMemo(() => monthCols(dre), [dre]);

  // Converte Date -> chave "MMM-YY" (ex.: "Jan-25")
  const dateToKey = (d: Date) => `${MONTH_ORDER[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
  const keyToSortKey = (k: string) => {
    const m = k.match(MONTH_RE);
    if (!m) return -1;
    return (2000 + parseInt(m[2], 10)) * 12 + MONTH_ORDER.indexOf(m[1]);
  };

  // Sincroniza o calendário do header com o último mês disponível ao carregar
  useEffect(() => {
    if (!cols.length) return;
    const latest = cols[cols.length - 1];
    const m = latest.key.match(MONTH_RE);
    if (!m) return;
    const latestDate = new Date(2000 + parseInt(m[2], 10), MONTH_ORDER.indexOf(m[1]), 1);
    const currentKey = dateToKey(selectedPeriod);
    // Só ajusta se o mês selecionado não existir nos dados (evita sobrescrever escolha do usuário)
    if (!cols.some(c => c.key === currentKey)) {
      setSelectedPeriod(latestDate);
      localStorage.setItem("header:period", latestDate.toISOString());
      window.dispatchEvent(new CustomEvent("header:period-change", { detail: { period: latestDate } }));
    }
  }, [cols]);

  // last/prev derivados do mês selecionado no calendário (com fallback ao mais recente)
  const { last, prev } = useMemo(() => {
    if (!cols.length) return { last: undefined as any, prev: undefined as any };
    const wantedKey = dateToKey(selectedPeriod);
    const wantedSort = keyToSortKey(wantedKey);
    // pega o mês exato se existir; senão, o mais recente <= selecionado; senão, o último
    const eligible = cols.filter(c => c.sortKey <= wantedSort);
    const lastCol = eligible.length ? eligible[eligible.length - 1] : cols[cols.length - 1];
    const lastIdx = cols.findIndex(c => c.key === lastCol.key);
    const prevCol = lastIdx > 0 ? cols[lastIdx - 1] : undefined;
    return { last: lastCol, prev: prevCol };
  }, [cols, selectedPeriod]);

  const receitaBrutaRow = useMemo(() => findRow(dre, ["receita bruta"]), [dre]);
  const receitaRow = useMemo(() => findRow(dre, ["receita líquida"]), [dre]);
  const custosRow = useMemo(() => findRow(dre, ["(-) custos operacionais"]), [dre]);
  const ebitdaRow = useMemo(() => findRow(dre, ["ebitda", "resultado operacional", "lucro operacional"]), [dre]);
  const dreCashburnRow = useMemo(() => findRow(dre, ["cashburn", "queima de caixa"]), [dre]);
  const margemEbitdaRow = useMemo(() => findRow(dre, ["% margem ebitda"]), [dre]);
  const margemContribRow = useMemo(() => findRow(dre, ["margem de contribuição"]), [dre]);
  const pctMargemContribRow = useMemo(() => findRow(dre, ["% margem de contribuição"]), [dre]);
  const lucroRow = useMemo(() => findRow(dre, ["lucro líquido"]), [dre]);
  const margemRow = useMemo(() => findRow(dre, ["% margem líquida"]), [dre]);

  // ---- Card customizável: métricas, período e tipo de gráfico ----
  const availableMetrics = useMemo(() => {
    return (Array.isArray(dre) ? dre : [])
      .map(r => labelOf(r))
      .filter(Boolean);
  }, [dre]);

  const COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--pos))",
    "hsl(var(--neg))",
    "hsl(220 16% 35%)",
    "hsl(38 92% 50%)",
    "hsl(280 65% 55%)",
    "hsl(190 80% 45%)",
  ];

  const PREFS_KEY = "dashboard-custom-chart-v2";
  const loadPrefs = () => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };
  const savedPrefs = loadPrefs();

  const [chartType, setChartType] = useState<"bar" | "line" | "pie">(savedPrefs?.chartType ?? "bar");
  const [agg, setAgg] = useState<"month" | "year">(savedPrefs?.agg ?? "month");
  const [rangeMonths, setRangeMonths] = useState<number>(savedPrefs?.rangeMonths ?? 0);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(savedPrefs?.selectedMetrics ?? []);
  const [selectedYears, setSelectedYears] = useState<string[]>(savedPrefs?.selectedYears ?? []);
  const [hydrated, setHydrated] = useState<boolean>(!!savedPrefs?.selectedMetrics?.length);

  const availableYears = useMemo(() => {
    const ys = new Set<string>();
    cols.forEach(c => {
      const m = c.key.match(MONTH_RE);
      if (m) ys.add("20" + m[2]);
    });
    return Array.from(ys).sort();
  }, [cols]);

  // Inicializa anos selecionados (todos por padrão)
  useEffect(() => {
    if (availableYears.length && selectedYears.length === 0 && !savedPrefs?.selectedYears) {
      setSelectedYears(availableYears);
    }
  }, [availableYears]);

  // Inicializa métricas padrão quando DRE carregar (só se não houver prefs salvas)
  useEffect(() => {
    if (!hydrated && availableMetrics.length > 0) {
      const defaults = ["Receita Líquida", "Lucro Líquido"]
        .map(d => availableMetrics.find(m => m.toLowerCase() === d.toLowerCase()))
        .filter(Boolean) as string[];
      setSelectedMetrics(defaults.length ? defaults : availableMetrics.slice(0, 2));
      setHydrated(true);
    }
  }, [availableMetrics, hydrated]);

  // Persiste preferências
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ chartType, agg, rangeMonths, selectedMetrics, selectedYears }));
    } catch {}
  }, [chartType, agg, rangeMonths, selectedMetrics, selectedYears, hydrated]);

  // Agrupa métricas em "grandes linhas" (subtotais) + componentes
  const metricGroups = useMemo(() => {
    const HEADER_PATTERNS = [
      /^receita bruta$/i,
      /^\(-\)\s*dedu/i,
      /^receita l[íi]quida$/i,
      /^\(-\)\s*custos? operacion/i,
      /^margem de contribui/i,
      /^\(-\)\s*sg\s*&\s*a/i,
      /^ebitda$/i,
      /^\(-\)\s*deprecia/i,
      /^\(\+\/-\)\s*resultado financeiro/i,
      /^lucro antes/i,
      /^\(-\)\s*impostos/i,
      /^lucro l[íi]quido/i,
      /^%\s*margem/i,
    ];
    const isHeader = (label: string) => HEADER_PATTERNS.some(rx => rx.test(label.trim()));
    const groups: { header: string; children: string[] }[] = [];
    let cur: { header: string; children: string[] } | null = null;
    availableMetrics.forEach(m => {
      if (isHeader(m)) {
        cur = { header: m, children: [] };
        groups.push(cur);
      } else if (cur) {
        cur.children.push(m);
      } else {
        cur = { header: m, children: [] };
        groups.push(cur);
      }
    });
    return groups;
  }, [availableMetrics]);

  const filteredCols = useMemo(() => {
    if (!rangeMonths || rangeMonths >= cols.length) return cols;
    return cols.slice(-rangeMonths);
  }, [cols, rangeMonths]);

  const customChart = useMemo(() => {
    const getRow = (label: string) =>
      (Array.isArray(dre) ? dre : []).find(
        r => labelOf(r) === label.toLowerCase(),
      ) ?? null;

    if (agg === "year") {
      const byYear: Record<string, Record<string, number>> = {};
      filteredCols.forEach(c => {
        const m = c.key.match(MONTH_RE);
        if (!m) return;
        const year = "20" + m[2];
        byYear[year] = byYear[year] || {};
        selectedMetrics.forEach(metric => {
          const row = getRow(metric);
          byYear[year][metric] = (byYear[year][metric] || 0) + (row ? toNum(row[c.key]) : 0);
        });
      });
      const result = Object.entries(byYear).map(([year, vals]) => ({
        bucket: year,
        ...Object.fromEntries(selectedMetrics.map(m => [m, (vals[m] || 0) / 1000])),
      }));
      return selectedYears.length
        ? result.filter(r => selectedYears.includes(String(r.bucket)))
        : result;
    }

    return filteredCols.map(c => {
      const point: any = { bucket: c.label };
      selectedMetrics.forEach(metric => {
        const row = getRow(metric);
        point[metric] = (row ? toNum(row[c.key]) : 0) / 1000;
      });
      return point;
    });
  }, [dre, filteredCols, selectedMetrics, agg, selectedYears]);

  const pieData = useMemo(() => {
    return selectedMetrics.map(m => ({
      name: m,
      value: customChart.reduce((s, p) => s + Math.abs(p[m] || 0), 0),
    }));
  }, [customChart, selectedMetrics]);

  // ---- DRE chart legado (mantido para compat caso necessário) ----
  const dreChart = useMemo(() => {
    return cols.map(c => {
      const receita = receitaRow ? toNum(receitaRow[c.key]) : 0;
      const lucro = lucroRow ? toNum(lucroRow[c.key]) : 0;
      const custoTotal = receita - lucro;
      return {
        mes: c.label,
        Receita: receita / 1000,
        Custo: custoTotal / 1000,
        Lucro: lucro / 1000,
      };
    });
  }, [cols, receitaRow, lucroRow]);

  // ---- KPIs do mês mais recente ----
  const valAt = (row: Row | null, key?: string) => (row && key ? toNum(row[key]) : 0);

  const kpiRBruta = valAt(receitaBrutaRow, last?.key);
  const kpiRBrutaPrev = valAt(receitaBrutaRow, prev?.key);

  const kpiMC = valAt(margemContribRow, last?.key);
  const kpiMCPrev = valAt(margemContribRow, prev?.key);
  const kpiMCPct = normalizePctValue(valAt(pctMargemContribRow, last?.key));

  const kpiEbitda = valAt(ebitdaRow, last?.key);
  const kpiEbitdaPrev = valAt(ebitdaRow, prev?.key);
  const kpiMargemEbitda = normalizePctValue(valAt(margemEbitdaRow, last?.key));

  // Cashburn: tenta DRE primeiro (se o usuário lança lá), senão usa DFC
  const dfcCashburnRow = useMemo(() => findRow(dfc, ["cashburn"]), [dfc]);
  const dfcCols = useMemo(() => {
    const allowed = new Set(cols.map(c => c.key));
    const all = monthCols(dfc);
    const filtered = all.filter(c => allowed.has(c.key));
    return filtered.length ? filtered : all;
  }, [dfc, cols]);
  const dfcLast = dfcCols[dfcCols.length - 1];
  const dfcPrev = dfcCols[dfcCols.length - 2];

  const cashburnFromDre = !!dreCashburnRow;
  const cashburnRow = dreCashburnRow ?? dfcCashburnRow;
  const cashburnCols = cashburnFromDre ? cols : dfcCols;
  const cashburnLastCol = cashburnFromDre ? last : dfcLast;
  const cashburnPrevCol = cashburnFromDre ? prev : dfcPrev;
  const kpiCashburn = valAt(cashburnRow, cashburnLastCol?.key);
  const kpiCashburnPrev = valAt(cashburnRow, cashburnPrevCol?.key);

  const sparkRBruta = cols.map(c => valAt(receitaBrutaRow, c.key) / 1000);
  const sparkMC = cols.map(c => valAt(margemContribRow, c.key) / 1000);
  const sparkEbitda = cols.map(c => valAt(ebitdaRow, c.key) / 1000);
  const sparkCashburn = cashburnCols.map(c => valAt(cashburnRow, c.key) / 1000);

  // ---- Composição de Despesas (mês mais recente) — subcategorias folha ----
  const despesasData = useMemo(() => {
    if (!last) return [];
    const prevKey = prev?.key;
    const SUBTOTAIS = new Set([
      "(-) custos operacionais", "(-) sg&a", "(-) sg & a", "pessoal",
      "despesas administrativas", "despesas marketing & vendas",
      "(-) depreciação & amortização", "(+/-) resultado financeiro",
      "(-) impostos", "(-) deduções da receita", "despesas não operacionais",
      "margem de contribuição", "(=) margem de contribuição",
    ]);
    // Coleta linhas entre "(-) Custos Operacionais" e "EBITDA"
    const labels = dre.map(r => labelOf(r));
    const startIdx = labels.findIndex(l => /^\(-\)\s*custos operacion/i.test(l));
    const endIdx = labels.findIndex(l => /^ebitda$/i.test(l));
    const slice = startIdx >= 0 && endIdx > startIdx
      ? dre.slice(startIdx + 1, endIdx)
      : dre;
    const cats = slice
      .map(r => ({ label: labelOf(r), row: r }))
      .filter(({ label }) => label && !SUBTOTAIS.has(label.toLowerCase()) && !/^%/.test(label))
      .map(({ label, row }) => {
        const cur = Math.abs(toNum(row[last.key]));
        const old = prevKey ? Math.abs(toNum(row[prevKey])) : 0;
        return { cat: label.replace(/^\(-\)\s*/, ""), val: cur, delta: pctDelta(cur, old) };
      })
      .filter(d => d.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 8);
    const total = cats.reduce((s, c) => s + c.val, 0) || 1;
    return cats.map(c => ({ ...c, share: (c.val / total) * 100 }));
  }, [dre, last, prev]);

  const lastIdx = dreChart.length - 1;
  const hasDre = cols.length > 0;

  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 5 ? "Boa madrugada" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = (profile?.nome ?? "").split(" ")[0] || "—";
  const dateLong = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const dateLongCap = dateLong.charAt(0).toUpperCase() + dateLong.slice(1);

  // ---- Contexto financeiro enviado para a IA (ask-finance-ai) ----
  const financeContext = useMemo(() => {
    const fmtMonthLabel = (k?: string) => {
      if (!k) return null;
      const m = k.match(MONTH_RE);
      if (!m) return k;
      return `${MONTH_PT[m[1]] ?? m[1]} 20${m[2]}`;
    };
    const opRowCtx = findRow(dfc, ["fluxo operacional", "fluxo de caixa operacional", "fluxo de caixa op"]);
    const entradasRowCtx = findRow(dfc, ["entradas"]);
    const saidasRowCtx = findRow(dfc, ["saídas", "saidas"]);
    const cashburnRowCtx = findRow(dfc, ["cashburn"]);

    const receitaCur = valAt(receitaRow, last?.key);
    const receitaOld = valAt(receitaRow, prev?.key);
    const custoCur = valAt(custosRow, last?.key);
    const custoOld = valAt(custosRow, prev?.key);
    const lucroCur = valAt(lucroRow, last?.key);
    const lucroOld = valAt(lucroRow, prev?.key);
    const margemCur = normalizePctValue(valAt(margemRow, last?.key));
    const margemOld = normalizePctValue(valAt(margemRow, prev?.key));
    const opCur = valAt(opRowCtx, last?.key);
    const opOld = valAt(opRowCtx, prev?.key);

    const lucroAcum = cols.reduce((s, c) => s + valAt(lucroRow, c.key), 0);

    const fmtOrNull = (n: number, has: boolean) => (has ? fmtBRL(n) : null);
    const hasReceita = !!receitaRow;
    const hasCusto = !!custosRow;
    const hasLucro = !!lucroRow;
    const hasMargem = !!margemRow;
    const hasOp = !!opRowCtx;

    return {
      periodo: fmtMonthLabel(last?.key),
      comparativo: fmtMonthLabel(prev?.key),
      receita_total: fmtOrNull(receitaCur, hasReceita),
      receita_total_anterior: fmtOrNull(receitaOld, hasReceita && !!prev),
      lucro_acumulado: hasLucro ? fmtBRL(lucroAcum) : null,
      margem_liquida: hasMargem ? fmtPct(margemCur) : null,
      margem_liquida_anterior: hasMargem && prev ? fmtPct(margemOld) : null,
      caixa_operacional: fmtOrNull(opCur, hasOp),
      caixa_operacional_anterior: hasOp && prev ? fmtBRL(opOld) : null,
      entradas: entradasRowCtx ? fmtBRL(valAt(entradasRowCtx, last?.key)) : null,
      saidas: saidasRowCtx ? fmtBRL(valAt(saidasRowCtx, last?.key)) : null,
      cashburn: cashburnRowCtx ? fmtBRL(valAt(cashburnRowCtx, last?.key)) : null,
      dre: {
        receita: fmtOrNull(receitaCur, hasReceita),
        receita_anterior: fmtOrNull(receitaOld, hasReceita && !!prev),
        custo: fmtOrNull(Math.abs(custoCur), hasCusto),
        custo_anterior: fmtOrNull(Math.abs(custoOld), hasCusto && !!prev),
        lucro: fmtOrNull(lucroCur, hasLucro),
        lucro_anterior: fmtOrNull(lucroOld, hasLucro && !!prev),
        ebitda: ebitdaRow ? fmtBRL(valAt(ebitdaRow, last?.key)) : null,
        margem_contribuicao: margemContribRow ? fmtBRL(valAt(margemContribRow, last?.key)) : null,
      },
      top_despesas: despesasData.slice(0, 5).map(d => ({
        categoria: d.cat,
        valor: fmtBRL(d.val),
        share_pct: fmtPct(d.share),
        variacao_pct: `${d.delta >= 0 ? "+" : ""}${fmtPct(Math.abs(d.delta))}`,
      })),
      insights: insights.map(i => ({ titulo: i.titulo, texto: i.texto, tom: i.tom })),
      filtros_ativos: {
        chart_type: chartType,
        agregacao: agg,
        range_meses: rangeMonths || cols.length,
        metricas_selecionadas: selectedMetrics,
      },
      dados_faltantes: [
        !hasReceita && "receita líquida (DRE)",
        !hasCusto && "custos operacionais (DRE)",
        !hasLucro && "lucro líquido (DRE)",
        !hasMargem && "% margem líquida (DRE)",
        !hasOp && "fluxo de caixa operacional (DFC)",
        !prev && "mês de comparação (apenas 1 período disponível)",
      ].filter(Boolean) as string[],
    };
  }, [dre, dfc, cols, last, prev, receitaRow, custosRow, lucroRow, margemRow, ebitdaRow, margemContribRow, despesasData, insights, chartType, agg, rangeMonths, selectedMetrics]);

  return (
    <div className="flex h-[calc(100vh-49px)] flex-col overflow-hidden">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {/* Greeting */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{greet}, {firstName}</h1>
          <p className="text-[12px] text-muted-foreground mt-1">{dateLongCap} · Financeiro</p>
        </div>

        {/* AI bar — funcional (Gemini via ask-finance-ai) */}
        <button
          onClick={() => openFinanceAI()}
          className="card-surface flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/40"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-takeat-soft text-primary shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 text-[13px] text-foreground truncate">
            Pergunte à IA: <span className="text-muted-foreground italic">"Por que a margem caiu em maio?"</span>
          </div>
          <div className="hidden md:flex items-center gap-1.5">
            {["Anomalias", "Forecast", "Drill-down DRE"].map(chip => (
              <span key={chip} onClick={(e) => { e.stopPropagation(); openFinanceAI(chip); }}
                className="px-2 py-1 rounded-md border bg-background text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
                {chip}
              </span>
            ))}
          </div>
        </button>

        {!hasDre && (
          <div className="card-surface px-5 py-8 text-center text-sm text-muted-foreground">
            Nenhum dado de DRE encontrado. Importe o DRE em Demonstrações Financeiras para ver o dashboard.
          </div>
        )}

        {/* KPIs */}
        {hasDre && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={`Receita Bruta · ${last?.label ?? ""}`}
              value={fmtBRL(kpiRBruta)}
              deltaMonth={pctDelta(kpiRBruta, kpiRBrutaPrev)}
              spark={sparkRBruta}
              sparkColor={kpiRBruta >= kpiRBrutaPrev ? "hsl(var(--pos))" : "hsl(var(--neg))"}
            />
            <KpiCard
              label={`Margem de Contribuição · ${last?.label ?? ""}`}
              value={fmtBRL(kpiMC)}
              subline={pctMargemContribRow ? `${fmtPct(kpiMCPct)} da receita` : undefined}
              deltaMonth={pctDelta(kpiMC, kpiMCPrev)}
              spark={sparkMC}
              sparkColor={kpiMC >= 0 ? "hsl(var(--pos))" : "hsl(var(--neg))"}
            />
            <KpiCard
              label={`EBITDA · ${last?.label ?? ""}`}
              value={fmtBRL(kpiEbitda)}
              subline={margemEbitdaRow ? `Margem EBITDA ${fmtPct(kpiMargemEbitda)}` : undefined}
              deltaMonth={pctDelta(kpiEbitda, kpiEbitdaPrev)}
              spark={sparkEbitda}
              sparkColor={kpiEbitda >= 0 ? "hsl(var(--pos))" : "hsl(var(--neg))"}
            />
            <KpiCard
              label={`Cashburn · ${cashburnLastCol?.label ?? last?.label ?? ""}`}
              value={fmtBRL(kpiCashburn)}
              subline={`origem: ${cashburnFromDre ? "DRE" : "DFC"}`}
              deltaMonth={pctDelta(kpiCashburn, kpiCashburnPrev)}
              inverse
              spark={sparkCashburn}
              sparkColor={kpiCashburn <= 0 ? "hsl(var(--pos))" : "hsl(var(--neg))"}
            />
          </div>
        )}

        {/* Gráfico Personalizável + Insights da IA */}
        {hasDre && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
            <SectionCard
              className="lg:col-span-3"
              title="Gráfico Personalizável"
              subtitle={`${selectedMetrics.length} métrica(s) · ${agg === "year" ? "por ano" : "por mês"} · valores em milhares (R$)`}
              actions={
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]">
                      <Settings2 className="h-3.5 w-3.5" /> Personalizar
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 p-3">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[11px]">Tipo</Label>
                          <Select value={chartType} onValueChange={(v: any) => setChartType(v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="bar">Barras</SelectItem>
                              <SelectItem value="line">Linhas</SelectItem>
                              <SelectItem value="pie">Pizza</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Agregação</Label>
                          <Select value={agg} onValueChange={(v: any) => setAgg(v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="month">Mês</SelectItem>
                              <SelectItem value="year">Ano</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-[11px]">Período</Label>
                        <Select value={String(rangeMonths)} onValueChange={(v) => setRangeMonths(Number(v))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">Todos</SelectItem>
                            <SelectItem value="3">Últimos 3 meses</SelectItem>
                            <SelectItem value="6">Últimos 6 meses</SelectItem>
                            <SelectItem value="12">Últimos 12 meses</SelectItem>
                            <SelectItem value="24">Últimos 24 meses</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {agg === "year" && availableYears.length > 0 && (
                        <div>
                          <Label className="text-[11px]">Anos exibidos</Label>
                          <div className="mt-1 flex flex-wrap gap-1.5 rounded border border-border p-2">
                            {availableYears.map(y => {
                              const checked = selectedYears.includes(y);
                              return (
                                <button
                                  key={y}
                                  type="button"
                                  onClick={() =>
                                    setSelectedYears(prev =>
                                      prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y]
                                    )
                                  }
                                  className={cn(
                                    "rounded px-2 py-0.5 text-[11px] border transition",
                                    checked
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-secondary/40 text-muted-foreground border-border hover:bg-secondary"
                                  )}
                                >
                                  {y}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div>
                        <Label className="text-[11px]">Métricas (linhas do DRE)</Label>
                        <div className="mt-1 max-h-72 overflow-y-auto rounded border border-border p-2 space-y-2">
                          {metricGroups.map(g => {
                            const headerChecked = selectedMetrics.includes(g.header);
                            return (
                              <details key={g.header} className="group" open={headerChecked || g.children.some(c => selectedMetrics.includes(c))}>
                                <summary className="flex items-center gap-2 cursor-pointer list-none rounded bg-secondary/40 px-1.5 py-1">
                                  <Checkbox
                                    checked={headerChecked}
                                    onCheckedChange={(c) => {
                                      setSelectedMetrics(prev =>
                                        c ? [...prev, g.header] : prev.filter(x => x !== g.header)
                                      );
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <span className="truncate text-[11.5px] font-semibold text-foreground">{g.header}</span>
                                  {g.children.length > 0 && (
                                    <span className="ml-auto text-[10px] text-muted-foreground">{g.children.length}</span>
                                  )}
                                </summary>
                                {g.children.length > 0 && (
                                  <div className="mt-1 ml-5 space-y-0.5 border-l border-border pl-2">
                                    {g.children.map(m => {
                                      const checked = selectedMetrics.includes(m);
                                      return (
                                        <label key={m} className="flex items-center gap-2 text-[11px] cursor-pointer">
                                          <Checkbox
                                            checked={checked}
                                            onCheckedChange={(c) => {
                                              setSelectedMetrics(prev =>
                                                c ? [...prev, m] : prev.filter(x => x !== m)
                                              );
                                            }}
                                          />
                                          <span className="truncate text-muted-foreground">{m}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </details>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              }
            >
              {selectedMetrics.length === 0 ? (
                <div className="flex h-[420px] items-center justify-center text-[12px] text-muted-foreground">
                  Selecione ao menos uma métrica em "Personalizar".
                </div>
              ) : (
                <div className="h-[420px] w-full">
                  <ResponsiveContainer>
                    {chartType === "pie" ? (
                      <PieChart>
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number) => fmtBRL(v * 1000)}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={130} label={(d: any) => d.name}>
                          {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                      </PieChart>
                    ) : chartType === "line" ? (
                      <LineChart data={customChart} margin={{ top: 10, right: 8, bottom: 4, left: -8 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtBRLShort(v * 1000)} />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number) => fmtBRL(v * 1000)}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {selectedMetrics.map((m, i) => (
                          <Line key={m} type="monotone" dataKey={m} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                        ))}
                      </LineChart>
                    ) : (
                      <BarChart data={customChart} margin={{ top: 10, right: 8, bottom: 4, left: -8 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtBRLShort(v * 1000)} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--secondary))" }}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number) => fmtBRL(v * 1000)}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {selectedMetrics.map((m, i) => (
                          <Bar key={m} dataKey={m} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} />
                        ))}
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>

            <SectionCard
              className="lg:col-span-2"
              title="Insights da IA"
              subtitle={loadingInsights ? "Gerando…" : insights.length ? `${insights.length} detecções · clique para ler completo` : "Sem análise"}
              actions={
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 text-rose-600 px-1.5 py-0.5 text-[9px] font-bold tracking-wider">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" /> LIVE
                  </span>
                  <button onClick={() => loadInsights(true)} disabled={loadingInsights} className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-50" title="Atualizar">
                    {loadingInsights ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </button>
                </div>
              }
            >
              <div className="flex h-[420px] flex-col gap-2 overflow-y-auto pr-1">
                {loadingInsights && insights.length === 0 && (
                  <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analisando seus dados…
                  </div>
                )}
                {!loadingInsights && insights.length === 0 && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                    <Sparkles className="h-5 w-5 text-muted-foreground/60" />
                    <p className="text-[12px] text-muted-foreground">Importe o DRE para gerar insights.</p>
                  </div>
                )}
                {insights.map((it, i) => {
                  const sev = it.tom === "alerta"
                    ? { label: "CRÍTICO", icon: AlertOctagon, cls: "text-rose-600 bg-rose-500/10 border-rose-500/30" }
                    : it.tom === "positivo"
                    ? { label: "INFO", icon: Info, cls: "text-sky-600 bg-sky-500/10 border-sky-500/30" }
                    : { label: "ATENÇÃO", icon: AlertTriangle, cls: "text-amber-600 bg-amber-500/10 border-amber-500/30" };
                  const Icon = sev.icon;
                  const ago = `há ${(i + 1) * 2}h`;
                  return (
                    <button
                      key={i}
                      onClick={() => setOpenInsight(i)}
                      className="group rounded-md border bg-card px-3 py-2.5 text-left transition-all hover:border-primary/40 hover:shadow-sm"
                    >
                      <div className="flex items-start gap-2">
                        <div className={cn("h-7 w-7 rounded-md grid place-items-center shrink-0 border", sev.cls)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={cn("text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border", sev.cls)}>{sev.label}</span>
                            <span className="text-[10px] text-muted-foreground num">{ago}</span>
                          </div>
                          <div className="text-[12px] font-semibold text-foreground leading-snug">{it.titulo}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground leading-snug line-clamp-2">{it.texto}</div>
                          <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary font-medium group-hover:gap-1.5 transition-all">
                            Ler completo <ArrowRight className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        )}

        <Dialog open={openInsight !== null} onOpenChange={(o) => !o && setOpenInsight(null)}>
          <DialogContent className="max-w-2xl">
            {openInsight !== null && insights[openInsight] && (() => {
              const it = insights[openInsight];
              const sev = it.tom === "alerta"
                ? { label: "CRÍTICO", icon: AlertOctagon, cls: "text-rose-600 bg-rose-500/10 border-rose-500/30" }
                : it.tom === "positivo"
                ? { label: "INFO", icon: Info, cls: "text-sky-600 bg-sky-500/10 border-sky-500/30" }
                : { label: "ATENÇÃO", icon: AlertTriangle, cls: "text-amber-600 bg-amber-500/10 border-amber-500/30" };
              const Icon = sev.icon;
              return (
                <>
                  <DialogHeader>
                    <div className="flex items-center gap-2 mb-2">
                      <div className={cn("h-8 w-8 rounded-md grid place-items-center border", sev.cls)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className={cn("text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border", sev.cls)}>{sev.label}</span>
                    </div>
                    <DialogTitle className="text-left">{it.titulo}</DialogTitle>
                  </DialogHeader>
                  <DialogDescription asChild>
                    <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {it.texto}
                    </div>
                  </DialogDescription>
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={() => { openAIAssistant(`Aprofunde este insight: "${it.titulo} — ${it.texto}"`); setOpenInsight(null); }}>
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Aprofundar com IA
                    </Button>
                  </div>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Evolução EBITDA + Composição despesas */}
        {hasDre && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {(() => {
              // Métrica destacada pela IA: procura nos títulos dos insights uma linha do DRE
              const allLabels = (Array.isArray(dre) ? dre : [])
                .map(r => labelOf(r))
                .filter(Boolean);
              const insightText = insights.map(i => `${i.titulo} ${i.texto}`).join(" ").toLowerCase();
              const aiPick = allLabels.find(l => l && insightText.includes(l)) ?? null;
              const metricLabel = aiPick ?? "ebitda";
              const metricRow = (Array.isArray(dre) ? dre : []).find(r => labelOf(r) === metricLabel) ?? ebitdaRow;
              const displayLabel = (aiPick ?? "EBITDA").replace(/^\w/, c => c.toUpperCase());
              const aiTone = aiPick && insights[0]?.tom;
              return (
                <SectionCard
                  title={`${displayLabel} — Evolução`}
                  subtitle={
                    aiPick
                      ? `Métrica destacada pela IA · ${cols[0]?.label} – ${last?.label}`
                      : `${cols[0]?.label} – ${last?.label}`
                  }
                  actions={
                    <span className="inline-flex items-center gap-1 rounded bg-takeat-soft text-primary px-1.5 py-0.5 text-[9px] font-bold tracking-wider">
                      <Sparkles className="h-2.5 w-2.5" /> IA
                    </span>
                  }
                >
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer>
                      <ComposedChart data={cols.map(c => ({
                        mes: c.label,
                        value: metricRow ? toNum(metricRow[c.key]) / 1000 : 0,
                      }))} margin={{ top: 10, right: 8, bottom: 4, left: -8 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtBRLShort(v * 1000)} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--secondary))" }}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number) => fmtBRL(v * 1000)}
                        />
                        <Bar dataKey="value" radius={[3, 3, 3, 3]}>
                          {cols.map((c, i) => {
                            const v = metricRow ? toNum(metricRow[c.key]) : 0;
                            return <Cell key={i} fill={v >= 0 ? "hsl(var(--pos))" : "hsl(var(--neg))"} />;
                          })}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              );
            })()}

            <SectionCard
              title="Composição de Despesas"
              subtitle={last ? `${last.label} · top categorias do DRE` : ""}
              padded={false}
            >
              {despesasData.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">Sem despesas no período.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {despesasData.map((d) => (
                    <li key={d.cat} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-[12.5px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2 w-2 shrink-0 rounded-sm bg-primary" />
                        <span className="truncate font-medium text-foreground">{d.cat}</span>
                        <span className="num shrink-0 text-[11px] text-muted-foreground">{d.share.toFixed(1).replace(".", ",")}%</span>
                      </div>
                      <span className="num text-foreground">{fmtBRL(d.val)}</span>
                      <Delta value={d.delta} inverse />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        )}

        {/* DFC — Fluxo de Caixa */}
        {dfc.length > 0 && <DFCSection dfc={dfc} dfcCols={dfcCols} />}
      </div>
      <FinanceAIPanel paginaAtual="Dashboard" financeContext={financeContext} />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

function DFCSection({ dfc, dfcCols }: { dfc: Row[]; dfcCols: { key: string; label: string; sortKey: number }[] }) {
  const [dfcRange, setDfcRange] = useState<number>(0);
  const visibleCols = useMemo(
    () => (!dfcRange || dfcRange >= dfcCols.length ? dfcCols : dfcCols.slice(-dfcRange)),
    [dfcCols, dfcRange],
  );

  const opRow = useMemo(() => findRow(dfc, ["fluxo de caixa operacional"]), [dfc]);
  const invRow = useMemo(() => findRow(dfc, ["fluxo de caixa de investimentos", "fluxo de caixa de investimento"]), [dfc]);
  const finRow = useMemo(() => findRow(dfc, ["fluxo de financiamento", "fluxo de caixa de financiamento"]), [dfc]);
  const livreRow = useMemo(() => findRow(dfc, ["fluxo de caixa livre"]), [dfc]);
  const cashburnRow = useMemo(() => findRow(dfc, ["cashburn"]), [dfc]);
  const entradasRow = useMemo(() => findRow(dfc, ["entradas"]), [dfc]);
  const saidasRow = useMemo(() => findRow(dfc, ["saídas", "saidas"]), [dfc]);

  const last = visibleCols[visibleCols.length - 1];
  const prev = visibleCols[visibleCols.length - 2];
  const valAt = (row: Row | null, key?: string) => (row && key ? toNum(row[key]) : 0);

  const chartData = useMemo(() => visibleCols.map(c => ({
    mes: c.label,
    Operacional: valAt(opRow, c.key) / 1000,
    Investimento: valAt(invRow, c.key) / 1000,
    Financiamento: valAt(finRow, c.key) / 1000,
    Livre: valAt(livreRow, c.key) / 1000,
  })), [visibleCols, opRow, invRow, finRow, livreRow]);

  const SUBTOTAL_RE = /^(fluxo|entradas|sa[íi]das|cashburn|diferen[çc]a de saldos)/i;
  const topGastos = useMemo(() => {
    if (!last) return [];
    const arr = dfc
      .map(r => ({ label: labelOf(r), row: r }))
      .filter(({ label }) => label && !SUBTOTAL_RE.test(label))
      .map(({ label, row }) => {
        const cur = toNum(row[last.key]);
        const old = prev ? toNum(row[prev.key]) : 0;
        return { cat: label.replace(/^\(-\)\s*/, ""), val: cur < 0 ? Math.abs(cur) : 0, raw: cur, old };
      })
      .filter(d => d.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 8);
    const total = arr.reduce((s, c) => s + c.val, 0) || 1;
    return arr.map(d => ({
      ...d,
      share: (d.val / total) * 100,
      delta: d.old ? ((Math.abs(d.raw) - Math.abs(d.old)) / Math.abs(d.old)) * 100 : 0,
    }));
  }, [dfc, last, prev]);

  const opLast = valAt(opRow, last?.key);
  const opPrev = valAt(opRow, prev?.key);
  const invLast = valAt(invRow, last?.key);
  const finLast = valAt(finRow, last?.key);
  const livreLast = valAt(livreRow, last?.key);
  const cashburnLast = valAt(cashburnRow, last?.key);
  const entradasLast = valAt(entradasRow, last?.key);
  const saidasLast = valAt(saidasRow, last?.key);
  const queima = entradasLast > 0 ? (Math.abs(saidasLast) / entradasLast) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={`Caixa Operacional · ${last?.label ?? ""}`} value={fmtBRL(opLast)} deltaMonth={pctDelta(opLast, opPrev)} sparkColor={opLast >= 0 ? "hsl(var(--pos))" : "hsl(var(--neg))"} spark={visibleCols.map(c => valAt(opRow, c.key) / 1000)} />
        <KpiCard label={`Investimento · ${last?.label ?? ""}`} value={fmtBRL(invLast)} sparkColor="hsl(var(--neg))" spark={visibleCols.map(c => valAt(invRow, c.key) / 1000)} />
        <KpiCard label={`Financiamento · ${last?.label ?? ""}`} value={fmtBRL(finLast)} sparkColor={finLast >= 0 ? "hsl(var(--pos))" : "hsl(var(--neg))"} spark={visibleCols.map(c => valAt(finRow, c.key) / 1000)} />
        <KpiCard label={`Fluxo de Caixa Livre · ${last?.label ?? ""}`} value={fmtBRL(livreLast)} subline={`Cashburn ${fmtBRL(cashburnLast)}`} sparkColor={livreLast >= 0 ? "hsl(var(--pos))" : "hsl(var(--neg))"} spark={visibleCols.map(c => valAt(livreRow, c.key) / 1000)} />
      </div>

      <SectionCard
        title="DFC — Fluxos por Mês"
        subtitle="Operacional, Investimento e Financiamento · valores em milhares (R$)"
        actions={
          <Select value={String(dfcRange)} onValueChange={(v) => setDfcRange(Number(v))}>
            <SelectTrigger className="h-7 w-[150px] text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Todos os meses</SelectItem>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
              <SelectItem value="24">Últimos 24 meses</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        <div className="h-[260px] w-full">
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 10, right: 8, bottom: 4, left: -8 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtBRLShort(v * 1000)} />
              <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fmtBRL(v * 1000)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Operacional" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Investimento" fill="hsl(38 92% 50%)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="Financiamento" fill="hsl(280 65% 55%)" radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="Livre" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard title="Principais Gastos de Caixa" subtitle={last ? `${last.label} · top saídas do DFC` : ""} padded={false}>
          {topGastos.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">Sem gastos no período.</div>
          ) : (
            <ul className="divide-y divide-border">
              {topGastos.map((d) => (
                <li key={d.cat} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-[12.5px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 shrink-0 rounded-sm bg-[hsl(var(--neg))]" />
                    <span className="truncate font-medium text-foreground">{d.cat}</span>
                    <span className="num shrink-0 text-[11px] text-muted-foreground">{d.share.toFixed(1).replace(".", ",")}%</span>
                  </div>
                  <span className="num text-foreground">{fmtBRL(d.val)}</span>
                  <Delta value={d.delta} inverse />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Entradas × Saídas" subtitle={last ? `${last.label} · visão caixa` : ""}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border p-3">
                <div className="text-[11px] uppercase text-muted-foreground">Entradas</div>
                <div className="num mt-1 text-lg font-semibold text-[hsl(var(--pos))]">{fmtBRL(entradasLast)}</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[11px] uppercase text-muted-foreground">Saídas</div>
                <div className="num mt-1 text-lg font-semibold text-[hsl(var(--neg))]">{fmtBRL(saidasLast)}</div>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11.5px]">
                <span className="text-muted-foreground">Taxa de queima (Saídas / Entradas)</span>
                <span className="num font-semibold text-foreground">{queima.toFixed(1).replace(".", ",")}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-[hsl(var(--neg))]" style={{ width: `${Math.min(100, queima)}%` }} />
              </div>
            </div>
            <div className="h-[120px] w-full">
              <ResponsiveContainer>
                <BarChart data={visibleCols.map(c => ({ mes: c.label, Entradas: valAt(entradasRow, c.key) / 1000, Saídas: valAt(saidasRow, c.key) / 1000 }))} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                  <XAxis dataKey="mes" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9.5, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtBRLShort(v * 1000)} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fmtBRL(v * 1000)} />
                  <Bar dataKey="Entradas" fill="hsl(var(--pos))" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Saídas" fill="hsl(var(--neg))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
