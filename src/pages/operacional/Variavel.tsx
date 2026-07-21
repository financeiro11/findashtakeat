import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Percent, RefreshCw, Loader2, ExternalLink, CheckCircle2, AlertTriangle,
  ShieldAlert, FileWarning,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Central de Comissões Variáveis.
 * Cada time preenche uma planilha "[Time] - Colaboradores e Comissionamento" no Google Drive,
 * onde CADA MÊS é uma aba separada (Janeiro, Fevereiro, ...). Esta página lê essas planilhas
 * via a edge function `sheets-mirror` e mostra, para o mês selecionado, quem já lançou as
 * bonificações e quem ainda está pendente — para o time financeiro cobrar e fechar o mês.
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
      filled: boolean;
      tabTitle: string | null;
      lancamentos: number;
      data: SheetData | null;
      sheetTabId: number | null;
    };

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

/** Conta quantos lançamentos (colaboradores/linhas com valor) o mês tem. */
function contarLancamentos(team: Team, data: SheetData): number {
  const { headers, rows } = data;
  if (team.kind === "rpa") {
    // Liderança: qualquer linha com >= 2 células preenchidas conta como conteúdo lançado.
    return rows.filter((r) => r.filter((c) => (c ?? "").trim()).length >= 2).length;
  }
  const varIdx = headers.findIndex((h) => norm(h).includes("variavel"));
  return rows.filter((r) => {
    const colaborador = (r[0] ?? "").trim();
    if (!colaborador) return false;
    if (varIdx < 0) return r.filter((c) => (c ?? "").trim()).length >= 2;
    const v = (r[varIdx] ?? "").trim();
    return v !== "" && v !== "-";
  }).length;
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
  const [active, setActive] = useState(TEAMS[0].key);

  const periodKey = `${year}-${monthIdx}`;

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
            [team.key]: { state: "done", filled: false, tabTitle: null, lancamentos: 0, data: null, sheetTabId: null },
          }));
          return;
        }

        const read = await invokeSheets({ action: "read", spreadsheetId: team.spreadsheetId, sheet: match.title, force });
        const data: SheetData = { headers: read?.headers ?? [], rows: read?.rows ?? [] };
        const lancamentos = contarLancamentos(team, data);
        setStatuses((prev) => ({
          ...prev,
          [team.key]: {
            state: "done",
            filled: lancamentos > 0,
            tabTitle: match.title,
            lancamentos,
            data,
            sheetTabId: match.sheetId,
          },
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

  const resumo = useMemo(() => {
    let preenchidos = 0, pendentes = 0, erros = 0, carregando = 0;
    for (const t of TEAMS) {
      const s = statuses[t.key];
      if (!s || s.state === "loading") carregando++;
      else if (s.state === "error") erros++;
      else if (s.filled) preenchidos++;
      else pendentes++;
    }
    return { preenchidos, pendentes, erros, carregando };
  }, [statuses]);

  // Opções de mês: últimos 12 meses a partir do mês atual.
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Percent className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Comissões Variáveis</h2>
            <p className="text-sm text-muted-foreground">
              Centraliza as planilhas de bonificação dos times e mostra quem já lançou o mês.
            </p>
          </div>
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

      {/* Box de status / cobrança */}
      <Card className="border-border shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Status do fechamento · {MESES[monthIdx]} / {year}</CardTitle>
              <CardDescription>
                {resumo.preenchidos} de {TEAMS.length} times já lançaram
                {resumo.pendentes > 0 && ` · ${resumo.pendentes} pendente(s)`}
                {resumo.erros > 0 && ` · ${resumo.erros} com erro`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> {resumo.preenchidos} preenchidos
              </Badge>
              <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> {resumo.pendentes} pendentes
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TEAMS.map((team) => {
              const s = statuses[team.key];
              return (
                <button
                  key={team.key}
                  onClick={() => setActive(team.key)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                    active === team.key && "ring-2 ring-primary/40",
                    !s || s.state === "loading" ? "border-border" :
                      s.state === "error" ? "border-destructive/40 bg-destructive/5" :
                      s.filled ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" :
                      "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{team.label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {(!s || s.state === "loading") ? "verificando…" :
                        s.state === "error" ? (s.forbidden ? "sem acesso à planilha" : "erro ao ler") :
                        s.filled ? `${s.lancamentos} lançamento(s) · aba "${s.tabTitle}"` :
                        s.tabTitle ? "aba do mês vazia" : "sem aba do mês"}
                    </div>
                  </div>
                  <StatusIcon status={s} />
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Abas por time */}
      <Tabs value={active} onValueChange={setActive} className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          {TEAMS.map((team) => {
            const s = statuses[team.key];
            const dot =
              !s || s.state === "loading" ? "bg-muted-foreground/40" :
              s.state === "error" ? "bg-destructive" :
              s.filled ? "bg-emerald-500" : "bg-amber-500";
            return (
              <TabsTrigger key={team.key} value={team.key} className="gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
                {team.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {TEAMS.map((team) => (
          <TabsContent key={team.key} value={team.key} className="space-y-4">
            {team.key === active && (
              <TeamPanel
                team={team}
                status={statuses[team.key]}
                mesLabel={`${MESES[monthIdx]} / ${year}`}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function StatusIcon({ status }: { status: TeamStatus | undefined }) {
  if (!status || status.state === "loading") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />;
  if (status.state === "error") {
    return status.forbidden
      ? <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
      : <FileWarning className="h-4 w-4 shrink-0 text-destructive" />;
  }
  return status.filled
    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
    : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />;
}

function TeamPanel({ team, status, mesLabel }: { team: Team; status: TeamStatus | undefined; mesLabel: string }) {
  const sheetTabId = status && status.state === "done" ? status.sheetTabId : null;
  const url = sheetUrl(team.spreadsheetId, sheetTabId);

  return (
    <Card className="border-border shadow-[var(--shadow-card)]">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{team.label}</CardTitle>
            <CardDescription>
              {mesLabel}
              {status?.state === "done" && status.filled && ` · ${status.lancamentos} lançamento(s)`}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.open(url, "_blank")}>
            <ExternalLink className="h-4 w-4" /> Abrir planilha
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {(!status || status.state === "loading") && (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lendo planilha…
          </div>
        )}

        {status?.state === "error" && (
          <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {status.forbidden ? (
              <>Sem acesso à planilha. Compartilhe-a (como Editor) com a conta Google conectada ao Hub e clique em Atualizar.</>
            ) : (
              <>Erro ao ler a planilha: {status.message}</>
            )}
          </div>
        )}

        {status?.state === "done" && !status.tabTitle && (
          <div className="m-4 rounded-md border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mr-1.5 inline h-4 w-4" />
            Ainda não existe a aba de <strong>{mesLabel}</strong> nesta planilha. O time ainda não lançou este mês.
          </div>
        )}

        {status?.state === "done" && status.tabTitle && !status.filled && (
          <div className="m-4 rounded-md border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mr-1.5 inline h-4 w-4" />
            A aba "{status.tabTitle}" existe mas está sem lançamentos de variável.
          </div>
        )}

        {status?.state === "done" && status.data && status.data.rows.length > 0 && (
          <ReadOnlyTable data={status.data} />
        )}
      </CardContent>
    </Card>
  );
}

function ReadOnlyTable({ data }: { data: SheetData }) {
  // Mostra apenas colunas com cabeçalho (ignora colunas de apoio/vazias).
  const cols = data.headers
    .map((h, i) => ({ h: (h ?? "").trim(), i }))
    .filter((c) => c.h.length > 0);

  if (cols.length === 0) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Planilha sem cabeçalho reconhecível.</div>;
  }

  return (
    <div className="overflow-auto max-h-[65vh]">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c.i} className="whitespace-nowrap">{c.h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row, ri) => (
            <TableRow key={ri}>
              {cols.map((c) => {
                const cell = (row[c.i] ?? "").trim();
                return (
                  <TableCell key={c.i} className="whitespace-nowrap text-sm">
                    {cell || <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
