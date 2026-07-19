import { useMemo, useRef, useState } from "react";
import {
  Upload, ChevronDown, ChevronRight, Loader2, Wallet, Archive, Scale, Activity,
  Languages, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ============================================================================
// Investimentos · LTD / LLC — espelha o export do contador (Financials Ltd & LLC).
// "Importar planilha" lê TODAS as abas (Balance Sheet, P&L, Cash Flow, AP Aging,
// GL, TB, Capital) e popula cada aba correspondente. Entidade é detectada de A1
// ("Takeat Ltd" vs "Takeat LLC"). Dados ficam em memória (não persistem).
// ============================================================================

type Tone = "blue" | "violet" | "indigo" | "green";

interface KPI {
  label: string;
  big: string;
  detalhe: string;
  brl: string;
  variacao: string;
  variacaoUp: boolean;
  negativo?: boolean;
  icon: LucideIcon;
  tone: Tone;
}

type RowTipo = "header" | "leaf" | "total";
interface BalanceRow {
  id: string;
  account: string;
  code?: string;
  nivel: number;
  tipo: RowTipo;
  muted?: boolean;
  valores: Record<string, number>;
}

interface HierData { months: string[]; rows: BalanceRow[] }
interface FlatData { columns: string[]; rows: (string | number)[][] }
type SheetKey = "balance" | "pl" | "cf" | "ap" | "gl" | "tb" | "capital";
type EntityData = Partial<Record<SheetKey, HierData | FlatData>> & { issuedAt?: string };

const ENTITIES = ["Takeat Ltd", "Takeat LLC"] as const;
type Entity = (typeof ENTITIES)[number];

const ENTITY_META: Record<Entity, { eyebrow: string; local: string }> = {
  "Takeat Ltd": { eyebrow: "INVESTIMENTOS · LTD / LLC", local: "Cayman / BVI — holding" },
  "Takeat LLC": { eyebrow: "INVESTIMENTOS · LTD / LLC", local: "Delaware, USA — operating" },
};

const STATEMENTS: { key: SheetKey; label: string; kind: "hier" | "flat" }[] = [
  { key: "balance", label: "Balance Sheet", kind: "hier" },
  { key: "pl", label: "P&L", kind: "hier" },
  { key: "cf", label: "Cash Flow", kind: "flat" },
  { key: "ap", label: "AP Aging", kind: "flat" },
  { key: "gl", label: "GL", kind: "flat" },
  { key: "tb", label: "TB", kind: "flat" },
  { key: "capital", label: "Capital", kind: "flat" },
];

// Nome da aba no xlsx → chave interna.
const SHEET_TO_KEY: Record<string, SheetKey> = {
  "balance sheet": "balance",
  "p&l": "pl",
  "income statement": "pl",
  "cash flow": "cf",
  "ap aging": "ap",
  "a/p aging": "ap",
  "gl": "gl",
  "general ledger": "gl",
  "tb": "tb",
  "trial balance": "tb",
  "capital": "capital",
};

const RATE = 5.1766;

const TERMOS: Record<string, string> = {
  "Accrual basis": "Regime de competência",
  "holding": "Controladora (holding)",
  "Issuing date": "Data de emissão",
  "Balance sheet (amounts in USD)": "Balanço patrimonial (valores em USD)",
  "Balance Sheet": "Balanço patrimonial",
  "Income Statement": "Demonstração de resultado",
  "Cash Flow": "Fluxo de caixa",
  "AP Aging": "Contas a pagar por vencimento",
  "GL": "Livro razão",
  "General Ledger": "Livro razão",
  "TB": "Balancete",
  "Trial Balance": "Balancete",
  "Capital": "Movimento de capital",
  "ASSETS": "Ativos",
  "CURRENT ASSETS": "Ativo circulante",
  "CHECKING/SAVINGS": "Conta corrente / poupança",
  "Short-Term Investments & Secur": "Investimentos de curto prazo e títulos",
  "OTHER CURRENT ASSETS": "Outros ativos circulantes",
  "Intercompany Current Assets": "Ativos circulantes intercompanhia",
  "Morgan Stanley Acct": "Conta Morgan Stanley",
  "IC Advances and Loans": "Adiantamentos e empréstimos intercompanhia",
  "Total Assets": "Ativos totais",
  "LIABILITIES & EQUITY": "Passivos + Patrimônio líquido",
  "LIABILITIES": "Passivos",
  "CURRENT LIABILITIES": "Passivo circulante",
  "ACCOUNTS PAYABLE": "Contas a pagar",
  "Equity": "Patrimônio líquido",
  "EQUITY": "Patrimônio líquido",
  "Common Stock": "Capital social",
  "Net Income": "Lucro líquido",
  "Cash": "Caixa",
  "OPERATING": "Operacional",
  "INVESTING": "Investimentos",
  "FINANCING": "Financiamentos",
  "Investments in Subsidiaries": "Investimentos em subsidiárias",
};

const TONE_CLS: Record<Tone, string> = {
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  indigo: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  green: "bg-success/15 text-success",
};

// ---------------------------------------------------------------- formatação
function compactUSD(n: number): string {
  const s = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${s}$${(a / 1_000).toFixed(1)}k`;
  return `${s}$${a.toFixed(2)}`;
}
function fullUSD(n: number): string {
  const s = n < 0 ? "-" : "";
  return `${s}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function brlAprox(usd: number): string {
  const v = usd * RATE;
  const s = v < 0 ? "-" : "";
  return `≈ R$ ${s}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtCell(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  if (n === 0) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function traduzir(termo: string): string | undefined {
  const base = termo.replace(/\s+Total\s*$/i, "").trim();
  return TERMOS[termo] ?? TERMOS[base];
}

function Termo({ children, texto }: { children: React.ReactNode; texto?: string }) {
  const t = texto ?? (typeof children === "string" ? traduzir(children) : undefined);
  if (!t) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{t}</TooltipContent>
    </Tooltip>
  );
}

// ------------------------------------------------------------------ KPI card
function KPICard({ kpi }: { kpi: KPI }) {
  const Icon = kpi.icon;
  return (
    <Card className="border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{kpi.label}</div>
        <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", TONE_CLS[kpi.tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className={cn("num mt-1.5 text-[26px] font-bold leading-none", kpi.negativo ? "text-destructive" : "text-foreground")}>
        {kpi.big}
      </div>
      <div className="num mt-1.5 text-[12px] text-muted-foreground">{kpi.detalhe}</div>
      <div className="num mt-0.5 text-[12px] text-muted-foreground">
        <Termo texto="Conversão aproximada pela taxa do dia">{kpi.brl}</Termo>
      </div>
      <div className={cn("mt-1 text-[11px] font-medium", kpi.variacaoUp ? "text-success" : "text-destructive")}>
        {kpi.variacao}
      </div>
    </Card>
  );
}

// --------------------------------------------------------------- Balance table
function BalanceTable({
  rows, months, collapsed, onToggle,
}: {
  rows: BalanceRow[];
  months: string[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}) {
  const meta = useMemo(() => {
    const ancestors: Record<string, string[]> = {};
    const hasChildren: Record<string, boolean> = {};
    const stack: { id: string; nivel: number }[] = [];
    rows.forEach((r, i) => {
      while (stack.length && stack[stack.length - 1].nivel >= r.nivel) stack.pop();
      ancestors[r.id] = stack.map((s) => s.id);
      const next = rows[i + 1];
      hasChildren[r.id] = !!next && next.nivel > r.nivel;
      stack.push({ id: r.id, nivel: r.nivel });
    });
    return { ancestors, hasChildren };
  }, [rows]);

  const visiveis = rows.filter((r) => meta.ancestors[r.id].every((a) => !collapsed.has(a)));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            <th className="sticky left-0 z-10 bg-secondary/50 px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Account
            </th>
            {months.map((m) => (
              <th key={m} className="whitespace-nowrap px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visiveis.map((row) => {
            const podeExpandir = meta.hasChildren[row.id];
            const aberto = !collapsed.has(row.id);
            const isTotal = row.tipo === "total";
            const isHeader = row.tipo === "header";
            return (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border/40 last:border-0",
                  isTotal ? "bg-muted/20" : "hover:bg-muted/30",
                )}
              >
                <td
                  className={cn(
                    "sticky left-0 z-10 whitespace-nowrap px-4 py-1.5 text-[12.5px]",
                    isTotal ? "bg-muted/20 font-semibold" : "bg-card",
                    isHeader && row.nivel <= 1 && "font-bold",
                    row.muted && "text-muted-foreground",
                  )}
                >
                  <div className="flex items-center gap-1" style={{ paddingLeft: row.nivel * 16 }}>
                    {podeExpandir ? (
                      <button
                        onClick={() => onToggle(row.id)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                        aria-label={aberto ? "Recolher" : "Expandir"}
                      >
                        {aberto ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </button>
                    ) : (
                      <span className="inline-block w-4" />
                    )}
                    {row.code && <span className="num mr-1.5 text-[11px] text-muted-foreground/70">{row.code}</span>}
                    <Termo>{row.account}</Termo>
                  </div>
                </td>
                {months.map((m) => {
                  const v = row.valores[m];
                  const zero = v === 0;
                  return (
                    <td
                      key={m}
                      className={cn(
                        "num whitespace-nowrap px-3 py-1.5 text-right text-[12.5px]",
                        isTotal && "font-semibold",
                        (row.muted || zero) && "text-muted-foreground/70",
                      )}
                    >
                      {fmtCell(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------- Flat (CF/AP/GL/TB)
function FlatTable({ data }: { data: FlatData }) {
  const isNum = (v: unknown) => typeof v === "number" && !Number.isNaN(v);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            {data.columns.map((c, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
              {data.columns.map((_, j) => {
                const v = r[j];
                return (
                  <td key={j} className={cn(
                    "whitespace-nowrap px-3 py-1.5 text-[12.5px]",
                    isNum(v) ? "num text-right" : "text-left",
                    isNum(v) && (v as number) < 0 && "text-destructive",
                  )}>
                    {isNum(v) ? fmtCell(v as number) : (v == null ? "" : String(v))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================== parsers
function parseNumero(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/[R$\s]/g, "").replace(/,/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

const MES_CURTOS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function fmtMonth(d: Date): string {
  return `${MES_CURTOS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

// Parser hierárquico (Balance Sheet & P&L): colunas 0..7 são níveis de indentação
// (Group-A..Account), colunas seguintes são meses (Date). O nível = índice da
// coluna onde o texto aparece. Códigos "1234567 · Nome" viram (code, account).
function parseHier(aoa: unknown[][]): HierData {
  // acha linha de cabeçalho (Group-A)
  let h = -1;
  for (let i = 0; i < aoa.length; i++) {
    const first = aoa[i]?.[0];
    if (typeof first === "string" && /^group-?a$/i.test(first.trim())) { h = i; break; }
  }
  if (h < 0) return { months: [], rows: [] };

  const header = aoa[h] || [];
  const monthCols: { idx: number; label: string }[] = [];
  header.forEach((c, i) => {
    if (c instanceof Date) monthCols.push({ idx: i, label: fmtMonth(c) });
    else if (typeof c === "string") {
      const t = c.trim();
      if (/^(jan|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|sep|set|oct|out|nov|dec|dez)/i.test(t)) {
        monthCols.push({ idx: i, label: t.toUpperCase() });
      }
    }
  });
  if (!monthCols.length) return { months: [], rows: [] };
  const firstMonthCol = monthCols[0].idx;
  const months = monthCols.map((m) => m.label);

  const rows: BalanceRow[] = [];
  for (let i = h + 1; i < aoa.length; i++) {
    const linha = aoa[i] || [];
    // acha coluna de texto (a mais à direita antes dos meses)
    let textIdx = -1;
    let text = "";
    for (let j = firstMonthCol - 1; j >= 0; j--) {
      const v = linha[j];
      if (typeof v === "string" && v.trim()) { textIdx = j; text = v.trim(); break; }
    }
    if (textIdx < 0) continue;

    let code: string | undefined;
    let account = text;
    const m = /^(\d{6,8})\s*[·•]\s*(.+)$/.exec(text);
    if (m) { code = m[1]; account = m[2].trim(); }

    const isTotal = /\bTotal\s*$/i.test(account);
    const tipo: RowTipo = isTotal ? "total" : code ? "leaf" : "header";

    const valores: Record<string, number> = {};
    monthCols.forEach((mc) => {
      const v = linha[mc.idx];
      valores[mc.label] = typeof v === "number" ? v : parseNumero(v);
    });

    rows.push({ id: `r${i}`, account, code, nivel: textIdx, tipo, valores });
  }

  return { months, rows };
}

// Parser flat (Cash Flow, AP Aging, GL, TB, Capital): acha a 1ª linha com >=3
// células de texto e trata como cabeçalho; abaixo dela ficam os dados.
function parseFlat(aoa: unknown[][]): FlatData {
  let h = -1;
  for (let i = 0; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const strs = r.filter((c) => typeof c === "string" && c.trim()).length;
    if (strs >= 3) { h = i; break; }
  }
  if (h < 0) return { columns: [], rows: [] };

  const headerRow = aoa[h] || [];
  let last = headerRow.length - 1;
  while (last >= 0 && (headerRow[last] == null || String(headerRow[last]).trim() === "")) last--;
  const columns: string[] = [];
  for (let j = 0; j <= last; j++) {
    const c = headerRow[j];
    columns.push(c instanceof Date ? fmtMonth(c) : (c == null ? "" : String(c)));
  }

  const rows: (string | number)[][] = [];
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (!r.some((v) => v != null && String(v).trim() !== "")) continue;
    const out: (string | number)[] = [];
    for (let j = 0; j <= last; j++) {
      const v = r[j];
      if (v == null) out.push("");
      else if (v instanceof Date) out.push(v.toISOString().slice(0, 10));
      else if (typeof v === "number") out.push(v);
      else out.push(String(v));
    }
    rows.push(out);
  }
  return { columns, rows };
}

// KPIs derivados da Balance Sheet (+ Net Income Jan–Jun do P&L, se disponível).
function kpisFromData(bs: HierData | undefined, pl: HierData | undefined): KPI[] {
  const acha = (rs: BalanceRow[], re: RegExp) => rs.find((r) => re.test(r.account));
  const base: KPI[] = [
    { label: "Cash (fim do período)", big: "—", detalhe: "Sem dados", brl: brlAprox(0), variacao: "—", variacaoUp: true, icon: Wallet, tone: "blue" },
    { label: "Total Assets", big: "—", detalhe: "Sem dados", brl: brlAprox(0), variacao: "—", variacaoUp: true, icon: Archive, tone: "indigo" },
    { label: "Equity", big: "—", detalhe: "Sem dados", brl: brlAprox(0), variacao: "—", variacaoUp: true, icon: Scale, tone: "violet" },
    { label: "Net Income (Jan–Jun)", big: "—", detalhe: "Sem dados", brl: brlAprox(0), variacao: "—", variacaoUp: true, icon: Activity, tone: "green" },
  ];
  if (!bs || !bs.months.length) return base;
  const ms = bs.months;
  const ult = ms[ms.length - 1];
  const pen = ms.length > 1 ? ms[ms.length - 2] : undefined;
  const set = (i: number, val: number | undefined, prev: number | undefined, prefix = "") => {
    if (val == null) return;
    let variacao = "—";
    let up = true;
    if (prev != null && prev !== 0) {
      const d = (val - prev) / Math.abs(prev);
      up = d >= 0;
      variacao = `vs mês ant. ${up ? "↑" : "↓"} ${Math.abs(d * 100).toFixed(1)}%`;
    }
    base[i] = { ...base[i], big: compactUSD(val), detalhe: prefix + fullUSD(val), brl: brlAprox(val), variacao, variacaoUp: up, negativo: val < 0 };
  };
  const cash = acha(bs.rows, /checking\/savings total|^cash|cash total/i);
  const assets = acha(bs.rows, /total assets|^assets total|assets total$/i);
  const equity = acha(bs.rows, /^equity total|equity total$|^total equity/i);
  set(0, cash?.valores[ult], cash?.valores[pen ?? ""]);
  set(1, assets?.valores[ult], assets?.valores[pen ?? ""]);
  set(2, equity?.valores[ult], equity?.valores[pen ?? ""]);

  // Net Income Jan–Jun: soma no P&L, ou usa a linha "Net Income" da BS.
  if (pl && pl.months.length) {
    const ni = pl.rows.find((r) => /^net income( total)?$/i.test(r.account));
    if (ni) {
      const soma = pl.months.reduce((s, m) => s + (ni.valores[m] || 0), 0);
      const mesUlt = pl.months[pl.months.length - 1];
      set(3, soma, undefined, `${mesUlt}: ${(ni.valores[mesUlt] || 0) >= 0 ? "+" : ""}${fullUSD(ni.valores[mesUlt] || 0).replace("$", "$")}  ·  `);
    }
  } else {
    const ni = acha(bs.rows, /^net income$/i);
    set(3, ni?.valores[ult], ni?.valores[pen ?? ""]);
  }
  return base;
}

function detectarEntidade(aoa: unknown[][]): Entity | null {
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const cell = aoa[i]?.[0];
    if (typeof cell === "string") {
      const t = cell.trim();
      if (/^takeat\s+ltd\b/i.test(t)) return "Takeat Ltd";
      if (/^takeat\s+llc\b/i.test(t)) return "Takeat LLC";
    }
  }
  return null;
}

// ================================================================ componente
export default function Investimentos() {
  const [entity, setEntity] = useState<Entity>("Takeat Ltd");
  const [statement, setStatement] = useState<SheetKey>("balance");
  const [data, setData] = useState<Record<Entity, EntityData>>({ "Takeat Ltd": {}, "Takeat LLC": {} });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const meta = ENTITY_META[entity];
  const entData = data[entity] || {};
  const currentStmt = STATEMENTS.find((s) => s.key === statement)!;
  const currentData = entData[statement];

  const kpis = useMemo(() => kpisFromData(entData.balance as HierData | undefined, entData.pl as HierData | undefined), [entData]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const balance = entData.balance as HierData | undefined;
  const rowsForCollapse = balance?.rows ?? [];

  const expandirTudo = () => setCollapsed(new Set());
  const recolherTudo = () =>
    setCollapsed(new Set(rowsForCollapse.filter((r, i) => (rowsForCollapse[i + 1]?.nivel ?? -1) > r.nivel).map((r) => r.id)));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });

      // Detecta entidade pelo A1 da primeira aba.
      const first = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
      const ent = detectarEntidade(first) ?? entity;

      const nova: EntityData = { ...data[ent] };
      let importadas = 0;
      const abasEncontradas: string[] = [];

      for (const nome of wb.SheetNames) {
        const key = SHEET_TO_KEY[nome.trim().toLowerCase()];
        if (!key) continue;
        const stmt = STATEMENTS.find((s) => s.key === key);
        if (!stmt) continue;
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, blankrows: false });
        const parsed = stmt.kind === "hier" ? parseHier(aoa) : parseFlat(aoa);
        const temDados = stmt.kind === "hier" ? (parsed as HierData).rows.length > 0 : (parsed as FlatData).rows.length > 0;
        if (temDados) {
          nova[key] = parsed;
          importadas++;
          abasEncontradas.push(stmt.label);
        }
      }

      if (!importadas) {
        toast.error("Não reconheci nenhuma aba conhecida (Balance Sheet, P&L, Cash Flow, AP Aging, GL, TB, Capital).");
        return;
      }

      const agora = new Date();
      nova.issuedAt = agora.toLocaleDateString("pt-BR") + " " + agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      setData((prev) => ({ ...prev, [ent]: nova }));
      setEntity(ent);
      setCollapsed(new Set());
      toast.success(`${ent} · ${importadas} abas importadas: ${abasEncontradas.join(", ")}`);
    } catch (e: any) {
      toast.error("Falha ao ler a planilha: " + (e?.message ?? String(e)));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const emptyMsg = (
    <Card className="border-border p-10 text-center text-[13px] text-muted-foreground">
      Nenhum dado de <span className="font-medium text-foreground">{currentStmt.label}</span> para {entity}. Clique em <span className="font-medium text-foreground">Importar planilha</span> para carregar o export do contador.
    </Card>
  );

  return (
    <div className="space-y-4 p-5">
      {/* ---------------------------------------------- cabeçalho da entidade */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{meta.eyebrow}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{entity}</h1>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              <Termo>Accrual basis</Termo>
            </span>
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {meta.local.split("holding")[0]}
            {meta.local.includes("holding") && <Termo>holding</Termo>}
            {entData.issuedAt && <> · Importado em {entData.issuedAt}</>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            {ENTITIES.map((ent) => (
              <button
                key={ent}
                onClick={() => setEntity(ent)}
                className={cn(
                  "rounded px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  entity === ent ? "bg-destructive text-white" : "text-foreground hover:bg-muted",
                )}
              >
                {ent}
              </button>
            ))}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? "Importando…" : "Importar planilha"}
          </Button>
        </div>
      </div>

      {/* -------------------------------------------------------------- KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => <KPICard key={kpi.label} kpi={kpi} />)}
      </div>

      {/* ------------------------------------------- abas de demonstrações */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
        <div className="flex flex-wrap gap-0.5">
          {STATEMENTS.map((s) => {
            const has = !!entData[s.key];
            return (
              <button
                key={s.key}
                onClick={() => setStatement(s.key)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                  statement === s.key
                    ? "border-destructive text-destructive"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                  !has && "opacity-60",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {statement === "balance" && balance && (
          <div className="flex items-center gap-3 pb-1 text-[12px] text-muted-foreground">
            <span className="hidden items-center gap-1.5 sm:flex">
              <Languages className="h-3.5 w-3.5" /> Passe o mouse nos termos para ver a tradução
            </span>
            <button onClick={expandirTudo} className="hover:text-foreground">Expandir</button>
            <button onClick={recolherTudo} className="hover:text-foreground">Recolher</button>
          </div>
        )}
      </div>

      {/* --------------------------------------------------- conteúdo da aba */}
      {!currentData ? (
        emptyMsg
      ) : currentStmt.kind === "hier" ? (
        <div className="space-y-3">
          <div className="text-[13px] font-semibold">
            <Termo>{currentStmt.label}</Termo>{" "}
            <span className="font-normal text-muted-foreground">(amounts in USD)</span>
          </div>
          <BalanceTable
            rows={(currentData as HierData).rows}
            months={(currentData as HierData).months}
            collapsed={collapsed}
            onToggle={toggle}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-[13px] font-semibold">
            <Termo>{currentStmt.label}</Termo>{" "}
            <span className="font-normal text-muted-foreground">(amounts in USD)</span>
          </div>
          <FlatTable data={currentData as FlatData} />
        </div>
      )}
    </div>
  );
}
