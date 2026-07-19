import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ExternalLink, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const SPREADSHEET_ID = "1P7O1xRyrybuDQOfw3WIRkne15FOM7bBPMTWweMrCulA";
const SHEET_NAME = "Form Responses 1";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=2045888472`;

// Índices da planilha
const COL = {
  timestamp: 0,
  nome: 1,
  setor: 2,
  valor: 3,
  statusAuto: 4,
  motivo: 5,
  urlNota: 6,
  descricao: 7,
};

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type SheetData = { headers: string[]; rows: string[][]; sheet: string };

function parseTS(s: string): Date | null {
  if (!s) return null;
  // MM/DD/YYYY HH:mm:ss
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseValor(s: string): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return isFinite(n) ? n : 0;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function initials(nome: string): string {
  const parts = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function avatarColor(seed: string): string {
  // paleta suave, consistente por nome
  const palette = [
    "bg-violet-500", "bg-emerald-500", "bg-sky-500", "bg-amber-500",
    "bg-rose-500", "bg-teal-500", "bg-indigo-500", "bg-fuchsia-500",
    "bg-lime-600", "bg-cyan-600", "bg-orange-500",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function fmtDataHora(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

type Registro = {
  origIdx: number;
  data: Date | null;
  nome: string;
  setor: string;
  valor: number;
  statusAuto: string;
  motivo: string;
  descricao: string;
  urlNota: string;
};

export default function Reembolsos() {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const today = new Date();
  const [mes, setMes] = useState<{ ano: number; mes: number }>({
    ano: today.getFullYear(),
    mes: today.getMonth(),
  });
  const [segmento, setSegmento] = useState<"todos" | "s1" | "s2" | "s3" | "s4">("todos");

  useEffect(() => {
    document.title = "FinHub · Reembolsos";
  }, []);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("sheets-mirror", {
        body: { action: "read", spreadsheetId: SPREADSHEET_ID, sheet: SHEET_NAME, force },
      });
      if (err) throw new Error(err.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      setData(res as SheetData);
    } catch (e: any) {
      setError(e.message ?? "Falha ao carregar");
      toast.error("Falha ao carregar: " + (e.message ?? ""));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const registros: Registro[] = useMemo(() => {
    if (!data) return [];
    return data.rows.map((r, i) => ({
      origIdx: i,
      data: parseTS(r[COL.timestamp] ?? ""),
      nome: (r[COL.nome] ?? "").trim(),
      setor: (r[COL.setor] ?? "").trim(),
      valor: parseValor(r[COL.valor] ?? ""),
      statusAuto: (r[COL.statusAuto] ?? "").trim(),
      motivo: (r[COL.motivo] ?? "").trim(),
      descricao: (r[COL.descricao] ?? "").trim(),
      urlNota: (r[COL.urlNota] ?? "").trim(),
    }));
  }, [data]);

  // Meses disponíveis (para dropdown)
  const mesesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const r of registros) {
      if (!r.data) continue;
      set.add(`${r.data.getFullYear()}-${r.data.getMonth()}`);
    }
    const arr = Array.from(set).map((k) => {
      const [a, m] = k.split("-").map(Number);
      return { ano: a, mes: m };
    });
    arr.sort((a, b) => b.ano - a.ano || b.mes - a.mes);
    return arr;
  }, [registros]);

  const filtrados = useMemo(() => {
    return registros
      .filter((r) => r.data && r.data.getFullYear() === mes.ano && r.data.getMonth() === mes.mes)
      .filter((r) => {
        if (segmento === "todos") return true;
        const dia = r.data!.getDate();
        if (segmento === "s1") return dia <= 7;
        if (segmento === "s2") return dia >= 8 && dia <= 14;
        if (segmento === "s3") return dia >= 15 && dia <= 21;
        return dia >= 22;
      })
      .sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0));
  }, [registros, mes, segmento]);

  const kpis = useMemo(() => {
    const total = filtrados.reduce((s, r) => s + r.valor, 0);
    const qtd = filtrados.length;
    const conferidos = filtrados.filter((r) => /conferido|lançado|lancado|ok/i.test(r.statusAuto)).length;
    const pendencias = filtrados.filter((r) => /pend|erro|falha/i.test(r.statusAuto)).length;
    return { total, qtd, conferidos, pendencias };
  }, [filtrados]);

  function toggleSel(idx: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }

  const mesLabel = `${MESES[mes.mes]} ${mes.ano}`;

  return (
    <div className="space-y-6 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            HUB FINANCEIRO · REEMBOLSOS
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1">Conferência Geral</h1>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                {mesLabel}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-auto">
              {mesesDisponiveis.map((m) => (
                <DropdownMenuItem
                  key={`${m.ano}-${m.mes}`}
                  onClick={() => setMes(m)}
                >
                  {MESES[m.mes]} {m.ano}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Segmentos */}
          <div className="inline-flex rounded-md border bg-background p-0.5">
            {([
              ["todos", "Tudo"],
              ["s1", "S1"],
              ["s2", "S2"],
              ["s3", "S3"],
              ["s4", "S4"],
            ] as const).map(([id, lbl]) => (
              <button
                key={id}
                onClick={() => setSegmento(id)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded transition-colors",
                  segmento === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {lbl}
              </button>
            ))}
          </div>

          <Button variant="outline" size="icon" onClick={() => load(true)} disabled={loading} title="Atualizar">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" onClick={() => window.open(SHEET_URL, "_blank")} title="Abrir planilha">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total a pagar no período" value={brl(kpis.total)} tone="primary" />
        <KpiCard label="Reembolsos" value={String(kpis.qtd)} />
        <KpiCard label="Pendências" value={String(kpis.pendencias)} tone={kpis.pendencias > 0 ? "danger" : "muted"} />
        <KpiCard label="Conferidos" value={String(kpis.conferidos)} tone="muted" />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-lg border bg-card">
        <div className="grid grid-cols-[36px_1.6fr_2fr_1.3fr_140px_120px] gap-3 items-center px-4 py-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase border-b">
          <div />
          <div>Colaborador</div>
          <div>Descrição</div>
          <div>Status ERP</div>
          <div className="text-right">Valor</div>
          <div>Nota</div>
        </div>

        {loading && !data ? (
          <div className="p-10 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            Nenhum reembolso em {mesLabel}.
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {filtrados.map((r) => (
              <div
                key={r.origIdx}
                className="grid grid-cols-[36px_1.6fr_2fr_1.3fr_140px_120px] gap-3 items-center px-3 py-3 rounded-md border border-dashed border-border/70 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center justify-center">
                  <Checkbox
                    checked={selected.has(r.origIdx)}
                    onCheckedChange={() => toggleSel(r.origIdx)}
                  />
                </div>

                {/* Colaborador */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "h-9 w-9 rounded-md flex items-center justify-center text-white text-xs font-semibold shrink-0",
                      avatarColor(r.nome || "?")
                    )}
                  >
                    {initials(r.nome)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{r.nome || "—"}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.setor || "—"}
                      {r.data && <> · {fmtDataHora(r.data)}</>}
                    </div>
                  </div>
                </div>

                {/* Descrição */}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.motivo || "—"}</div>
                  {r.descricao && (
                    <div className="text-xs text-muted-foreground line-clamp-1">{r.descricao}</div>
                  )}
                </div>

                {/* Status ERP */}
                <div className="flex flex-col gap-1 min-w-0">
                  <StatusBadge status={r.statusAuto} />
                </div>

                {/* Valor */}
                <div className="text-right text-sm font-semibold tabular-nums">
                  {brl(r.valor)}
                </div>

                {/* Nota */}
                <div>
                  {r.urlNota ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={() => window.open(r.urlNota, "_blank")}
                    >
                      Abrir <ExternalLink className="h-3 w-3" />
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "danger" | "muted";
}) {
  const toneCls =
    tone === "primary"
      ? "text-primary"
      : tone === "danger"
      ? "text-destructive"
      : tone === "muted"
      ? "text-muted-foreground"
      : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", toneCls)}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").trim();
  if (!s) {
    return (
      <Badge variant="outline" className="w-fit text-xs font-normal">
        <span className="mr-1 h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        Pendente
      </Badge>
    );
  }
  const isOk = /conferido|lançado|lancado|ok/i.test(s);
  const isErr = /erro|falha|pend/i.test(s);
  return (
    <Badge
      variant="outline"
      className={cn(
        "w-fit text-xs font-normal",
        isOk && "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
        isErr && "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10"
      )}
    >
      <span
        className={cn(
          "mr-1 h-1.5 w-1.5 rounded-full",
          isOk ? "bg-emerald-500" : isErr ? "bg-amber-500" : "bg-muted-foreground"
        )}
      />
      {s}
    </Badge>
  );
}
