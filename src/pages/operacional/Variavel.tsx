import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Percent, RefreshCw, Loader2, ExternalLink, ChevronRight,
  ShieldAlert, FileWarning, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Central de Comissões Variáveis.
 * Cada time preenche uma planilha "[Time] - Colaboradores e Comissionamento" no Google Drive,
 * onde CADA MÊS é uma aba separada (Janeiro, Fevereiro, ...). Esta página lê essas planilhas
 * via a edge function `sheets-mirror` e consolida, para o mês selecionado, o total variável de
 * cada time. Cada linha é expansível e revela os lançamentos por colaborador. Times com mais de
 * uma coluna de valor (ex.: OPS, com Variável/Meta + Plantão Suporte + Plantão Onboarding)
 * mostram cada coluna e um total por colaborador.
 */

type Team = {
  key: string;
  label: string;
  spreadsheetId: string;
  /** Formato do conteúdo — a maioria é lista de colaboradores; RPA é bônus de liderança. */
  kind: "colaboradores" | "rpa";
};

// Planilhas fornecidas pelo financeiro (pasta "Colaboradores e Comissionamento" no Drive).
const TEAMS: Team[] = [
  { key: "branding", label: "Branding / Conteúdo", spreadsheetId: "1mQzzMcqP1VuVpcd5QNajbqUDL6Yo-vp7EhMKXv0njGM", kind: "colaboradores" },
  { key: "parceiros", label: "Canais Indiretos (Parceiros)", spreadsheetId: "17I8bsViv4BtzEnYiTbU9059-a_LS5Abwgz-1OYIhw7E", kind: "colaboradores" },
  { key: "eventos", label: "Eventos", spreadsheetId: "1bgPFY4w8nNOF0ugpt2j6t0YR5uEzn2HZ5tgzdDsGu7s", kind: "colaboradores" },
  { key: "franquias", label: "Franquias", spreadsheetId: "1kh6bhP7knx64MLali9181-CKnit5dQ4HLxiWcFc6zUk", kind: "colaboradores" },
  { key: "inside", label: "Inside Sales", spreadsheetId: "16TpxEs6LtLuzR-ONtxs6HVf5AYI37ixzghPuTiLPr4k", kind: "colaboradores" },
  { key: "ops", label: "OPS", spreadsheetId: "12nlAEW2G6kQSgsKJB8dSdgfNc7SR_ZLZ_E9YEi6jTK4", kind: "colaboradores" },
  { key: "outbound", label: "Outbound", spreadsheetId: "1B4ICorMqsThP_BHPYuOC1mQsPolc5sI6_Kdp4sLQy4c", kind: "colaboradores" },
  { key: "performance", label: "Performance", spreadsheetId: "1v-V_F1qqMUphKZRw_VHbiNlN-hZi41rd4nBOwtuRaR0", kind: "colaboradores" },
  { key: "rpa", label: "Variáveis — RPA (Liderança)", spreadsheetId: "1noFfhGmTEhnCAZXaxbLDmiud5knK09_coBC1JkzR8pE", kind: "rpa" },
];

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function norm(s: string): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Interpreta um valor monetário em pt-BR ("R$ 6.998,55", "1.560,00", "-", "") -> número. */
function parseMoney(s: string): number {
  const t = (s ?? "").replace(/r\$/i, "").replace(/\s/g, "").trim();
  if (!t || t === "-" || t === "—") return 0;
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Interpreta o nome de uma aba: "Junho" -> mês; "Fevereiro26" -> mês + ano 2026. */
function parseTabMonth(title: string): { monthIdx: number; year: number | null } | null {
  const n = norm(title);
  for (let i = 0; i < 12; i++) {
    const m = norm(MESES[i]);
    if (n.startsWith(m)) {
      const digits = n.slice(m.length).replace(/[^0-9]/g, "");
      let year: number | null = null;
      if (digits.length === 2) year = 2000 + parseInt(digits, 10);
      else if (digits.length === 4) year = parseInt(digits, 10);
      return { monthIdx: i, year };
    }
  }
  return null;
}

type SheetTab = { title: string; sheetId: number | null };
type SheetData = { headers: string[]; rows: string[][] };

type TeamStatus =
  | { state: "loading" }
  | { state: "error"; message: string; forbidden?: boolean }
  | {
      state: "done";
      tabTitle: string | null;
      data: SheetData | null;
      sheetTabId: number | null;
    };

/**
 * Colaborador com os campos PADRONIZADOS que interessam ao financeiro.
 * As planilhas de cada time têm colunas próprias (coeficiente, follow-fix, etc.), mas aqui só
 * expomos o que é comum a todas: nome, cargo e variável. O OPS é a única exceção — além do
 * variável tem escala de onboarding e de suporte, que ficam separadas.
 */
type ParsedRow = {
  colaborador: string;
  cargo: string;
  variavel: number;
  onboarding: number; // só OPS
  suporte: number;    // só OPS
  total: number;
};
/** Time depois de interpretar a planilha: linhas padronizadas + total geral. */
type ParsedTeam = {
  isOps: boolean;
  /** RPA (Liderança): cada linha é um líder; mostramos todos, mesmo com bônus 0. */
  isRpa: boolean;
  rows: ParsedRow[];
  total: number;
};

/**
 * Interpreta a planilha bruta de um time e extrai APENAS os campos padronizados.
 * - Nome = coluna "colaborador"/"nome" (ou a 1ª); Cargo = coluna "cargo".
 * - Variável = coluna cujo cabeçalho contém "variável" (fallback: 1ª coluna numérica útil).
 * - OPS: além do variável, captura "onboarding" e "suporte" (as demais colunas são ignoradas).
 * Colunas como coeficiente/follow-fix não entram nem na tabela nem no total.
 */
function parseTeam(team: Team, data: SheetData | null): ParsedTeam {
  const isOps = team.key === "ops";
  if (!data) return { isOps, isRpa: team.kind === "rpa", rows: [], total: 0 };
  if (team.kind === "rpa") return parseRpa(data);

  // Algumas planilhas (ex.: OPS) têm uma linha-título mesclada ("Setor de Operações")
  // na linha 1; o cabeçalho real fica na linha 2. Detecta e desloca.
  let headers = data.headers.map((h) => (h ?? "").trim());
  let bodyRows = data.rows;
  if (
    headers.filter(Boolean).length <= 1 &&
    bodyRows[0] &&
    bodyRows[0].some((c) => norm(c).includes("colaborador") || norm(c).includes("nome"))
  ) {
    headers = bodyRows[0].map((h) => (h ?? "").trim());
    bodyRows = bodyRows.slice(1);
    data = { headers, rows: bodyRows };
  }
  const colabIdx = headers.findIndex((h) => norm(h).includes("colaborador") || norm(h).includes("nome"));
  const nameIdx = colabIdx >= 0 ? colabIdx : 0;
  const cargoIdx = headers.findIndex((h) => norm(h).includes("cargo"));

  const findCol = (pred: (h: string) => boolean) =>
    headers.findIndex((h, i) => i !== nameIdx && i !== cargoIdx && !!h && pred(norm(h)));

  const onbIdx = isOps ? findCol((h) => h.includes("onboarding")) : -1;
  const supIdx = isOps ? findCol((h) => h.includes("suporte")) : -1;

  let varIdx = findCol((h) => h.includes("variavel"));
  if (varIdx < 0) {
    // Fallback: 1ª coluna numérica útil que não seja onboarding/suporte.
    varIdx = headers.findIndex(
      (h, i) =>
        i !== nameIdx && i !== cargoIdx && i !== onbIdx && i !== supIdx && !!h &&
        !norm(h).includes("total") && data.rows.some((r) => /\d/.test(r[i] ?? "")),
    );
  }

  const rows: ParsedRow[] = [];
  for (const r of data.rows) {
    const colaborador = (r[nameIdx] ?? "").trim();
    if (!colaborador) continue;
    if (norm(colaborador).startsWith("total")) continue; // ignora linha de total da planilha
    const variavel = varIdx >= 0 ? parseMoney(r[varIdx] ?? "") : 0;
    const onboarding = onbIdx >= 0 ? parseMoney(r[onbIdx] ?? "") : 0;
    const suporte = supIdx >= 0 ? parseMoney(r[supIdx] ?? "") : 0;
    rows.push({
      colaborador,
      cargo: cargoIdx >= 0 ? (r[cargoIdx] ?? "").trim() : "",
      variavel,
      onboarding,
      suporte,
      total: variavel + onboarding + suporte,
    });
  }

  const total = rows.filter((r) => r.total > 0).reduce((a, b) => a + b.total, 0);
  return { isOps, isRpa: false, rows, total };
}

/**
 * Parser específico da planilha de RPA (Liderança), que tem um layout em blocos —
 * um por líder: um título tipo "Receita (Arthur)" ou "OPS (Guilherme)", subáreas com
 * resultado (%) e uma linha "Bônus Final" cujo valor (coluna Variável) é o que interessa.
 * Padronizamos para: Colaborador = nome entre parênteses; Cargo = área antes do parêntese;
 * Variável/Total = valor do Bônus Final.
 */
function parseRpa(data: SheetData): ParsedTeam {
  const grid: string[][] = [data.headers, ...data.rows];
  const nameRe = /\(([^)]+)\)/;

  // Localiza as linhas de título de bloco (contêm um nome entre parênteses, ex.: "(Arthur)").
  const titles: { i: number; area: string; name: string }[] = [];
  for (let i = 0; i < grid.length; i++) {
    for (const cell of grid[i] ?? []) {
      const c = (cell ?? "").trim();
      if (!c) continue;
      const m = c.match(nameRe);
      // Ignora "Resultado (%)" e afins — o miolo do parêntese precisa ter letras e não ser "%".
      if (m && !m[1].includes("%") && /[A-Za-zÀ-ÿ]/.test(m[1])) {
        titles.push({ i, area: c.slice(0, c.indexOf("(")).trim(), name: m[1].trim() });
        break;
      }
    }
  }

  const rows: ParsedRow[] = [];
  for (let b = 0; b < titles.length; b++) {
    const start = titles[b].i;
    const end = b + 1 < titles.length ? titles[b + 1].i : grid.length;

    // Coluna "Variável" dentro do bloco.
    let varCol = -1;
    for (let i = start; i < end && varCol < 0; i++) {
      const idx = (grid[i] ?? []).findIndex((c) => norm(c).includes("variavel"));
      if (idx >= 0) varCol = idx;
    }

    // Linha "Bônus Final" → valor da variável.
    let variavel = 0;
    for (let i = start; i < end; i++) {
      const line = grid[i] ?? [];
      if (!line.some((c) => norm(c).startsWith("bonus"))) continue;
      const atVarCol = varCol >= 0 ? (line[varCol] ?? "").trim() : "";
      if (atVarCol) {
        variavel = parseMoney(atVarCol);
      } else {
        // Fallback: célula com "R$" (ou a numérica mais à direita) da linha do bônus.
        const withMoney = line.find((c) => /r\$/i.test(c ?? ""));
        if (withMoney != null) variavel = parseMoney(withMoney);
        else {
          for (let k = line.length - 1; k >= 0; k--) {
            const cell = (line[k] ?? "").trim();
            if (cell && !cell.includes("%") && /\d/.test(cell)) { variavel = parseMoney(cell); break; }
          }
        }
      }
      break;
    }

    rows.push({
      colaborador: titles[b].name,
      cargo: titles[b].area,
      variavel,
      onboarding: 0,
      suporte: 0,
      total: variavel,
    });
  }

  const total = rows.filter((r) => r.total > 0).reduce((a, b) => a + b.total, 0);
  return { isOps: false, isRpa: true, rows, total };
}

async function invokeSheets(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke("sheets-mirror", { body });
  if (error) throw new Error(error.message);
  if (data?.error) {
    const e = new Error(data.error) as Error & { forbidden?: boolean };
    e.forbidden = !!data.forbidden;
    throw e;
  }
  return data;
}

/** Executa tarefas com concorrência limitada (evita estourar o limite do Google Sheets). */
async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function sheetUrl(spreadsheetId: string, sheetTabId?: number | null) {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return sheetTabId != null ? `${base}#gid=${sheetTabId}` : base;
}

export default function Variavel() {
  const now = new Date();
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [statuses, setStatuses] = useState<Record<string, TeamStatus>>({});
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const periodKey = `${year}-${monthIdx}`;

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const loadAll = useCallback(async (force = false) => {
    setLoading(true);
    setStatuses(Object.fromEntries(TEAMS.map((t) => [t.key, { state: "loading" } as TeamStatus])));

    await runLimited(TEAMS, 4, async (team) => {
      try {
        const meta = await invokeSheets({ action: "meta", spreadsheetId: team.spreadsheetId, force });
        const tabs: SheetTab[] = (meta?.sheets ?? []).map((s: any) => ({ title: s.title, sheetId: s.sheetId }));
        const match = tabs.find((t) => {
          const p = parseTabMonth(t.title);
          return p && p.monthIdx === monthIdx && (p.year == null || p.year === year);
        });

        if (!match) {
          setStatuses((prev) => ({
            ...prev,
            [team.key]: { state: "done", tabTitle: null, data: null, sheetTabId: null },
          }));
          return;
        }

        const read = await invokeSheets({ action: "read", spreadsheetId: team.spreadsheetId, sheet: match.title, force });
        const data: SheetData = { headers: read?.headers ?? [], rows: read?.rows ?? [] };
        setStatuses((prev) => ({
          ...prev,
          [team.key]: { state: "done", tabTitle: match.title, data, sheetTabId: match.sheetId },
        }));
      } catch (e: any) {
        setStatuses((prev) => ({
          ...prev,
          [team.key]: { state: "error", message: e?.message ?? "Falha ao carregar", forbidden: !!e?.forbidden },
        }));
      }
    });

    setLoading(false);
  }, [monthIdx, year]);

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [periodKey]);

  // Interpreta cada time e calcula o resumo geral.
  const parsedByTeam = useMemo(() => {
    const map: Record<string, ParsedTeam> = {};
    for (const t of TEAMS) {
      const s = statuses[t.key];
      map[t.key] = parseTeam(t, s?.state === "done" ? s.data : null);
    }
    return map;
  }, [statuses]);

  const resumo = useMemo(() => {
    let totalGeral = 0, lancados = 0;
    for (const t of TEAMS) {
      const s = statuses[t.key];
      const p = parsedByTeam[t.key];
      if (s?.state === "done" && p.total > 0) { lancados++; totalGeral += p.total; }
    }
    return { totalGeral, lancados };
  }, [statuses, parsedByTeam]);

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const base = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let k = 0; k < 12; k++) {
      const d = new Date(base.getFullYear(), base.getMonth() - k, 1);
      opts.push({ value: `${d.getFullYear()}-${d.getMonth()}`, label: `${MESES[d.getMonth()]} / ${d.getFullYear()}` });
    }
    return opts;
    // eslint-disable-next-line
  }, []);

  return (
    <div className="space-y-6 p-5">
      {/* Cabeçalho */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Hub Financeiro · Operacional</div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">Comissões Variáveis</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Centraliza as planilhas de bonificação dos times e consolida o total variável do mês.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={periodKey}
            onValueChange={(v) => {
              const [y, m] = v.split("-").map(Number);
              setYear(y); setMonthIdx(m);
            }}
          >
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => loadAll(true)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* Tabela consolidada */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-6">
        {/* Título + resumo geral */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-xl font-bold tracking-tight">
            Comissões Variáveis{" "}
            <span className="text-base font-normal text-muted-foreground">{MESES[monthIdx]} / {year}</span>
          </h3>
          <div className="flex items-center gap-6 rounded-xl border border-border px-5 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Total geral</span>
              <span className="text-lg font-bold text-primary">{fmtBRL(resumo.totalGeral)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {resumo.lancados} <span className="text-muted-foreground/70">/ {TEAMS.length} lançados</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Time</th>
                <th className="px-4 py-3 text-center font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Lanç.</th>
                <th className="px-4 py-3 text-right font-medium">Total Variável</th>
              </tr>
            </thead>
            <tbody>
              {TEAMS.map((team) => (
                <TeamRows
                  key={team.key}
                  team={team}
                  status={statuses[team.key]}
                  parsed={parsedByTeam[team.key]}
                  open={expanded.has(team.key)}
                  onToggle={() => toggle(team.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TeamRows({
  team, status, parsed, open, onToggle,
}: {
  team: Team;
  status: TeamStatus | undefined;
  parsed: ParsedTeam;
  open: boolean;
  onToggle: () => void;
}) {
  const loading = !status || status.state === "loading";
  const error = status?.state === "error";
  const done = status?.state === "done";
  const filled = done && parsed.total > 0;
  // No RPA cada líder é um lançamento (mesmo com bônus 0); nos demais, só quem tem valor.
  const lancamentos = (parsed.isRpa ? parsed.rows : parsed.rows.filter((r) => r.total > 0)).length;
  const canExpand = filled;

  // Texto/cor do status na coluna do meio.
  let statusText: string;
  let statusClass: string;
  if (loading) { statusText = "Verificando…"; statusClass = "text-muted-foreground"; }
  else if (error) {
    statusText = (status as any).forbidden ? "Sem acesso" : "Erro";
    statusClass = "text-destructive";
  } else if (filled) { statusText = "Preenchido"; statusClass = "text-emerald-600 dark:text-emerald-400"; }
  else { statusText = "Pendente"; statusClass = "text-amber-600 dark:text-amber-500"; }

  const dot =
    loading ? "bg-muted-foreground/40" :
    error ? "bg-destructive" :
    filled ? "bg-emerald-500" : "bg-amber-500";

  return (
    <>
      <tr
        className={cn(
          "border-b border-border transition-colors",
          canExpand && "cursor-pointer hover:bg-muted/40",
          open && "bg-muted/30",
        )}
        onClick={canExpand ? onToggle : undefined}
      >
        {/* Time */}
        <td className="px-4 py-4">
          <div className="flex items-center gap-2.5">
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform",
                open && "rotate-90",
                !canExpand && "opacity-0",
              )}
            />
            <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
            <span className="font-semibold">{team.label}</span>
          </div>
        </td>

        {/* Status */}
        <td className={cn("px-4 py-4 text-center text-sm font-medium", statusClass)}>
          {statusText}
        </td>

        {/* Lançamentos */}
        <td className="px-4 py-4 text-right text-sm tabular-nums text-muted-foreground">
          {filled ? lancamentos : "0"}
        </td>

        {/* Total variável / ação */}
        <td className="px-4 py-4 text-right">
          {filled ? (
            <div className="flex items-center justify-end gap-4">
              <span className="font-bold tabular-nums">{fmtBRL(parsed.total)}</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> conferido
              </span>
            </div>
          ) : loading ? (
            <span className="text-muted-foreground">—</span>
          ) : error ? (
            <div className="flex items-center justify-end gap-2 text-xs text-destructive">
              {(status as any).forbidden
                ? <ShieldAlert className="h-3.5 w-3.5" />
                : <FileWarning className="h-3.5 w-3.5" />}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); window.open(sheetUrl(team.spreadsheetId, done ? (status as any).sheetTabId : null), "_blank"); }}
                className="underline underline-offset-2 hover:text-destructive/80"
              >
                Abrir planilha
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3">
              <span className="text-muted-foreground">—</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); window.open(sheetUrl(team.spreadsheetId, done ? (status as any).sheetTabId : null), "_blank"); }}
                className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/5 px-3 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                Cobrar
              </button>
            </div>
          )}
        </td>
      </tr>

      {open && filled && (
        <tr className="border-b border-border bg-muted/10">
          <td colSpan={4} className="px-4 pb-5 pt-1">
            <TeamDetail team={team} parsed={parsed} sheetTabId={done ? (status as any).sheetTabId : null} />
          </td>
        </tr>
      )}
    </>
  );
}

function TeamDetail({ team, parsed, sheetTabId }: { team: Team; parsed: ParsedTeam; sheetTabId: number | null }) {
  const { isOps, isRpa } = parsed;
  // No RPA mostramos todos os líderes (mesmo com bônus 0); nos demais, escondemos linhas zeradas.
  const rows = isRpa ? parsed.rows : parsed.rows.filter((r) => r.total > 0);
  // Colunas de valor: iguais em todos os times; o OPS acrescenta onboarding e suporte.
  // colSpan das células vazias do rodapé = tudo antes da última coluna (Total).
  const emptyFootCols = isOps ? 4 : 2; // Cargo + Variável (+ Onboarding + Suporte no OPS)

  const money = (v: number) =>
    v > 0 ? fmtBRL(v) : <span className="text-muted-foreground/50">—</span>;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 text-left font-medium">Colaborador</th>
              <th className="px-4 py-2.5 text-left font-medium">Cargo</th>
              <th className="px-4 py-2.5 text-right font-medium">Variável</th>
              {isOps && <th className="px-4 py-2.5 text-right font-medium">Escala Onboarding</th>}
              {isOps && <th className="px-4 py-2.5 text-right font-medium">Escala Suporte</th>}
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t border-border/60">
                <td className="px-4 py-2.5 font-medium">{r.colaborador}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.cargo || "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(r.variavel)}</td>
                {isOps && <td className="px-4 py-2.5 text-right tabular-nums">{money(r.onboarding)}</td>}
                {isOps && <td className="px-4 py-2.5 text-right tabular-nums">{money(r.suporte)}</td>}
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtBRL(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/30">
              <td className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total do time
              </td>
              <td colSpan={emptyFootCols} />
              <td className="px-4 py-2.5 text-right font-bold tabular-nums text-primary">
                {fmtBRL(parsed.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex justify-end border-t border-border bg-card px-4 py-2">
        <button
          type="button"
          onClick={() => window.open(sheetUrl(team.spreadsheetId, sheetTabId), "_blank")}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Abrir planilha
        </button>
      </div>
    </div>
  );
}
