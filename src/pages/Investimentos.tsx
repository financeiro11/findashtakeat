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
// Dados default reproduzem o print; "Importar planilha" popula tudo a partir de
// um .xlsx/.csv (parser genérico best-effort abaixo). Nada persiste em banco por
// enquanto — é populado no cliente.
// ============================================================================

type Tone = "blue" | "violet" | "indigo" | "green";

interface KPI {
  label: string;
  big: string;       // valor compacto ($1.58M)
  detalhe: string;   // linha 2 ($1,580,838.17 ou "Jun 26: +1,995.91")
  brl: string;       // ≈ R$ ...
  variacao: string;  // vs mês ant. ↑ 0,1%
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
  nivel: number;      // 0=raiz … profundidade da conta
  tipo: RowTipo;
  muted?: boolean;    // subárvore zerada/intercompany (cinza no print)
  valores: Record<string, number>;
}

const ENTITIES = ["Takeat Ltd", "Takeat LLC"] as const;
type Entity = (typeof ENTITIES)[number];

const ENTITY_META: Record<Entity, { eyebrow: string; local: string }> = {
  "Takeat Ltd": { eyebrow: "INVESTIMENTOS · LTD / LLC", local: "Cayman / BVI — holding" },
  "Takeat LLC": { eyebrow: "INVESTIMENTOS · LTD / LLC", local: "Delaware, USA — operating" },
};

const STATEMENTS = [
  { key: "balance", label: "Balance Sheet" },
  { key: "pl", label: "P&L" },
  { key: "cf", label: "Cash Flow" },
  { key: "ap", label: "AP Aging" },
  { key: "gl", label: "GL" },
  { key: "tb", label: "TB" },
] as const;

const DEFAULT_MONTHS = ["DEC 25", "JAN 26", "FEB 26", "MAR 26", "APR 26", "MAY 26", "JUN 26"];

// Taxa USD→BRL usada nas conversões dos KPIs (bate com o print: 8.183.366,87 / 1.580.838,17).
const RATE = 5.1766;

// Glossário de termos do export (pt-BR) — alimenta os tooltips de tradução.
const TERMOS: Record<string, string> = {
  "Accrual basis": "Regime de competência",
  "holding": "Controladora (holding)",
  "Issuing date": "Data de emissão",
  "Balance sheet (amounts in USD)": "Balanço patrimonial (valores em USD)",
  "Balance Sheet": "Balanço patrimonial",
  "Cash Flow": "Fluxo de caixa",
  "AP Aging": "Contas a pagar por vencimento",
  "ASSETS": "Ativos",
  "CURRENT ASSETS": "Ativo circulante",
  "CHECKING/SAVINGS": "Conta corrente / poupança",
  "Short-Term Investments & Secur": "Investimentos de curto prazo e títulos",
  "OTHER CURRENT ASSETS": "Outros ativos circulantes",
  "Intercompany Current Assets": "Ativos circulantes intercompanhia",
  "Morgan Stanley Acct": "Conta Morgan Stanley",
  "IC Advances and Loans": "Adiantamentos e empréstimos intercompanhia",
  "Total Assets": "Ativos totais",
  "Equity": "Patrimônio líquido",
  "Net Income": "Lucro líquido",
  "Cash": "Caixa",
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
// Números da tabela: formato US do contador (2.212.837,69 → "2,212,837.69").
function fmtCell(n: number | undefined): string {
  if (n == null) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Tradução: tira " Total" do fim e procura o termo-base.
function traduzir(termo: string): string | undefined {
  const base = termo.replace(/\s+Total\s*$/i, "").trim();
  return TERMOS[termo] ?? TERMOS[base];
}

// -------------------------------------------------------------- <Termo> hover
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
  // Deriva ancestrais e "tem filhos" a partir da lista achatada por nível.
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

// ============================================================== dados default
function defaultKPIs(): KPI[] {
  return [
    { label: "Cash (fim do período)", big: "$1.58M", detalhe: fullUSD(1_580_838.17), brl: brlAprox(1_580_838.17), variacao: "vs mês ant. ↑ 0,1%", variacaoUp: true, icon: Wallet, tone: "blue" },
    { label: "Total Assets", big: "$2.77M", detalhe: fullUSD(2_771_358.17), brl: brlAprox(2_771_358.17), variacao: "vs mês ant. ↑ 0,0%", variacaoUp: true, icon: Archive, tone: "indigo" },
    { label: "Equity", big: "$2.77M", detalhe: fullUSD(2_770_886.17), brl: brlAprox(2_770_886.17), variacao: "vs mês ant. ↑ 0,1%", variacaoUp: true, icon: Scale, tone: "violet" },
    { label: "Net Income (Jan-Jun)", big: "-$11.9k", detalhe: "Jun 26: +$1,995.91", brl: brlAprox(-11_862.5), variacao: "vs mês ant. ↑ 14,4%", variacaoUp: true, negativo: true, icon: Activity, tone: "green" },
  ];
}

const V_ATIVO = { "DEC 25": 2_212_837.69, "JAN 26": 2_184_612.74, "FEB 26": 1_989_682.80, "MAR 26": 1_890_357.11, "APR 26": 1_577_487.09, "MAY 26": 1_579_478.26, "JUN 26": 1_580_838.17 };
const V_IC = { "DEC 25": 0, "JAN 26": 0, "FEB 26": 0, "MAR 26": 0, "APR 26": 0, "MAY 26": 2_320, "JUN 26": 2_320 };
const V_CA_TOTAL = { "DEC 25": 2_212_837.69, "JAN 26": 2_184_612.74, "FEB 26": 1_989_682.80, "MAR 26": 1_890_357.11, "APR 26": 1_577_487.09, "MAY 26": 1_581_798.26, "JUN 26": 1_583_158.17 };

function defaultRows(): BalanceRow[] {
  return [
    { id: "assets", account: "ASSETS", nivel: 0, tipo: "header", valores: {} },
    { id: "ca", account: "CURRENT ASSETS", nivel: 1, tipo: "header", valores: {} },
    { id: "checking", account: "CHECKING/SAVINGS", nivel: 2, tipo: "header", valores: {} },
    { id: "sti", account: "Short-Term Investments & Secur", nivel: 3, tipo: "header", valores: {} },
    { id: "morgan", account: "Morgan Stanley Acct", code: "1103010", nivel: 4, tipo: "leaf", valores: V_ATIVO },
    { id: "sti-total", account: "Short-Term Investments & Secur Total", nivel: 3, tipo: "total", valores: V_ATIVO },
    { id: "checking-total", account: "CHECKING/SAVINGS Total", nivel: 2, tipo: "total", valores: V_ATIVO },
    { id: "other-ca", account: "OTHER CURRENT ASSETS", nivel: 2, tipo: "header", muted: true, valores: {} },
    { id: "ic", account: "Intercompany Current Assets", nivel: 3, tipo: "header", muted: true, valores: {} },
    { id: "ic-adv", account: "IC Advances and Loans", code: "1108200", nivel: 4, tipo: "leaf", muted: true, valores: V_IC },
    { id: "ic-total", account: "Intercompany Current Assets Total", nivel: 3, tipo: "total", muted: true, valores: V_IC },
    { id: "other-ca-total", account: "OTHER CURRENT ASSETS Total", nivel: 2, tipo: "total", muted: true, valores: V_IC },
    { id: "ca-total", account: "CURRENT ASSETS Total", nivel: 1, tipo: "total", valores: V_CA_TOTAL },
  ];
}

// ======================================================== parser de planilha
const MES_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|dez|fev|abr|mai|ago|set|out)\w*|\btotal\b/i;

function parseNumero(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s); // (1,234) = negativo
  s = s.replace(/[()]/g, "").replace(/[R$\s]/g, "").replace(/,/g, "").replace(/\./g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

function parseBalance(aoa: unknown[][]): { months: string[]; rows: BalanceRow[] } {
  if (!aoa.length) return { months: [], rows: [] };

  // 1) Encontrar linha de cabeçalho = a com mais células "mês" (ou que contenha "Dec", "Jan", etc.)
  let headerIdx = -1, headerScore = 0;
  aoa.forEach((linha, i) => {
    const score = linha.filter((c) => {
      if (typeof c !== "string") return false;
      const t = c.trim().toUpperCase();
      return /^(DEC|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV)/.test(t) || t === "TOTAL";
    }).length;
    if (score > headerScore) { headerScore = score; headerIdx = i; }
  });
  if (headerIdx === -1) return { months: [], rows: [] };

  const header = aoa[headerIdx];
  const monthCols: { idx: number; label: string }[] = [];
  header.forEach((c, idx) => {
    if (typeof c === "string") {
      const t = c.trim().toUpperCase();
      if (/^(DEC|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV)-?\d{0,2}/.test(t)) {
        monthCols.push({ idx, label: t });
      }
    }
  });
  if (monthCols.length === 0) return { months: [], rows: [] };
  const months = monthCols.map((m) => m.label);

  // 2) Parsear linhas de dados a partir do índice após header
  // Pula colunas de "grupos" (Group-A, Group-B, etc.) — procura a 1ª coluna com texto de conta
  const rows: BalanceRow[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const linha = aoa[i];
    if (!linha || !linha.length) continue;

    // Encontra 1ª coluna com texto (ignorando grupos vazios)
    let accIdx = -1;
    for (let j = 0; j < Math.min(linha.length, monthCols[0]?.idx ?? Infinity); j++) {
      if (typeof linha[j] === "string" && linha[j].trim()) {
        accIdx = j;
        break;
      }
    }
    if (accIdx === -1) continue;

    const bruto = String(linha[accIdx]);
    const account = bruto.trim();
    if (!account || account.length === 0) continue;

    // Extrai código (ex.: "1103010 · Morgan Stanley" → code="1103010", account="Morgan Stanley")
    let code: string | undefined;
    let cleanAccount = account;
    const codeMatch = /^(\d{7})\s*[·•]\s*(.+)$/.exec(account);
    if (codeMatch) { code = codeMatch[1]; cleanAccount = codeMatch[2]; }
    // Fallback: código sem ponto (ex.: "1103010 Morgan Stanley")
    const codeMatch2 = /^(\d{7})\s+(.+)$/.exec(account);
    if (!codeMatch && codeMatch2) { code = codeMatch2[1]; cleanAccount = codeMatch2[2]; }

    const isTotal = /total\s*$/i.test(cleanAccount);
    const isUpper = cleanAccount === cleanAccount.toUpperCase() && /[A-Z]{2,}/.test(cleanAccount);
    const nivel = code ? 4 : (isUpper && !isTotal ? (cleanAccount.length > 20 ? 2 : 1) : isTotal ? 3 : 2);
    const tipo: RowTipo = isTotal ? "total" : code ? "leaf" : "header";

    const valores: Record<string, number> = {};
    monthCols.forEach((mc) => {
      valores[mc.label] = parseNumero(linha[mc.idx]);
    });

    rows.push({ id: `r${i}`, account: cleanAccount, code, nivel, tipo, valores });
  }

  return { months, rows };
}

// ================================================================ componente
export default function Investimentos() {
  const [entity, setEntity] = useState<Entity>("Takeat Ltd");
  const [statement, setStatement] = useState<string>("balance");
  const [months, setMonths] = useState<string[]>(DEFAULT_MONTHS);
  const [kpis, setKpis] = useState<KPI[]>(defaultKPIs);
  const [rows, setRows] = useState<BalanceRow[]>(defaultRows);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importadoEm, setImportadoEm] = useState("08/07/2026 17:52");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const meta = ENTITY_META[entity];

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const expandirTudo = () => setCollapsed(new Set());
  const recolherTudo = () =>
    setCollapsed(new Set(rows.filter((r, i) => rows[i + 1]?.nivel > r.nivel).map((r) => r.id)));

  const recalcularKPIs = (rs: BalanceRow[], ms: string[]) => {
    if (!ms.length) return;
    const ult = ms[ms.length - 1];
    const acha = (re: RegExp) => rs.find((r) => re.test(r.account))?.valores[ult];
    const next = kpis.map((k) => ({ ...k }));
    const set = (i: number, val: number | undefined, detalhePrefix = "") => {
      if (val == null) return;
      next[i] = {
        ...next[i],
        big: compactUSD(val),
        detalhe: detalhePrefix + fullUSD(val),
        brl: brlAprox(val),
        negativo: val < 0,
      };
    };
    set(0, acha(/checking\/savings total|^cash/i));
    set(1, acha(/total assets|assets total/i));
    set(2, acha(/^equity|total equity|equity total/i));
    set(3, acha(/net income/i));
    setKpis(next);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
      const parsed = parseBalance(aoa);
      if (!parsed.rows.length || !parsed.months.length) {
        toast.error("Não reconheci meses/linhas na planilha. Confira o cabeçalho (meses nas colunas).");
        return;
      }
      setMonths(parsed.months);
      setRows(parsed.rows);
      setCollapsed(new Set());
      recalcularKPIs(parsed.rows, parsed.months);
      const agora = new Date();
      setImportadoEm(agora.toLocaleDateString("pt-BR") + " " + agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      toast.success(`Planilha importada · ${parsed.rows.length} linhas, ${parsed.months.length} meses`);
    } catch (e: any) {
      toast.error("Falha ao ler a planilha: " + (e?.message ?? String(e)));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const stmtLabel = STATEMENTS.find((s) => s.key === statement)?.label ?? "";

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
            <span className="text-[13px] text-muted-foreground">June, 2026</span>
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {meta.local.split("holding")[0]}
            {meta.local.includes("holding") && <Termo>holding</Termo>}
            {" · "}
            <Termo>Issuing date</Termo>: Jul 8, 2026 · Importado em {importadoEm}
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
            accept=".xlsx,.xls,.csv"
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
          {STATEMENTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setStatement(s.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                statement === s.key
                  ? "border-destructive text-destructive"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {statement === "balance" && (
          <div className="flex items-center gap-3 pb-1 text-[12px] text-muted-foreground">
            <span className="hidden items-center gap-1.5 sm:flex">
              <Languages className="h-3.5 w-3.5" /> Passe o mouse nos termos para ver a tradução
            </span>
            <button onClick={expandirTudo} className="hover:text-foreground">Expandir</button>
            <button onClick={recolherTudo} className="hover:text-foreground">Recolher</button>
          </div>
        )}
      </div>

      {/* --------------------------------------------------- balanço / tabela */}
      {statement === "balance" ? (
        <div className="space-y-3">
          <div className="text-[13px] font-semibold">
            <Termo>Balance sheet (amounts in USD)</Termo>{" "}
            <span className="font-normal text-muted-foreground">Balanço Patrimonial</span>
          </div>
          <BalanceTable rows={rows} months={months} collapsed={collapsed} onToggle={toggle} />
        </div>
      ) : (
        <Card className="border-border p-10 text-center text-[13px] text-muted-foreground">
          Dados de <span className="font-medium text-foreground">{stmtLabel}</span> serão carregados ao importar a planilha correspondente.
        </Card>
      )}
    </div>
  );
}
