import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  MapPin,
  Calendar as CalIcon,
  ExternalLink,
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  MoreHorizontal,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const STATUS_OPTS = ["Pendente", "Feito"] as const;
type StatusViagem = (typeof STATUS_OPTS)[number];
const STATUS_CLS: Record<StatusViagem, string> = {
  Pendente:
    "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  Feito:
    "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
};
const STATUS_KEY = "recargas-viagens-status";
const loadStatus = (): Record<string, StatusViagem> => {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) || "{}");
  } catch {
    return {};
  }
};
const cardKey = (v: {
  colaborador: string;
  destino: string;
  data_ida: string | null;
}) => `${v.colaborador}|${v.destino}|${v.data_ida || ""}`.toLowerCase();

type Viagem = {
  id: string;
  colaborador: string;
  destino: string;
  data_ida: string | null;
  data_volta: string | null;
  dias: number;
  valor_total: number;
  viagem_hash?: string;
};

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/17MOvrcc7OpMVPFxzoKn4Nufg0zKU33qgmvZ-N3eCwgk/edit?usp=sharing";

const MONTHS = [
  "JAN","FEV","MAR","ABR","MAI","JUN",
  "JUL","AGO","SET","OUT","NOV","DEZ",
] as const;
const MONTHS_FULL = [
  "Jan","Fev","Mar","Abr","Mai","Jun",
  "Jul","Ago","Set","Out","Nov","Dez",
] as const;

const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-amber-500",
  "bg-fuchsia-500",
  "bg-teal-500",
  "bg-orange-500",
];
const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "—";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + "T00:00").toLocaleDateString("pt-BR") : "—";

const splitDestino = (d: string) => {
  const parts = d.split(/\s+[-–]\s+/);
  return { evento: parts[0] || d, sub: parts.slice(1).join(" - ") };
};

export default function RecargasViagens() {
  const [viagens, setViagens] = useState<Viagem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [statusMap, setStatusMap] = useState<Record<string, StatusViagem>>(
    loadStatus,
  );
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-11
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState<"todos" | StatusViagem>("todos");

  const setStatus = async (key: string, s: StatusViagem, viagemHash?: string) => {
    setStatusMap((prev) => {
      const next = { ...prev, [key]: s };
      localStorage.setItem(STATUS_KEY, JSON.stringify(next));
      return next;
    });
    if (viagemHash) {
      const { error: upErr } = await supabase
        .from("recargas_viagens_status" as any)
        .upsert({ viagem_hash: viagemHash, status: s }, { onConflict: "viagem_hash" });
      if (upErr) {
        toast.error("Não foi possível salvar o status: " + upErr.message);
        return;
      }
      const novoStatus = s === "Feito" ? "Concluído" : "Backlog";
      await supabase
        .from("tarefas")
        .update({ status: novoStatus })
        .ilike("observacao", `%[viagem:${viagemHash}]%`);
    }
  };

  useEffect(() => {
    document.title = "Recargas · Viagens";
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke(
      "recargas-viagens-sheet",
    );
    setLoading(false);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    setViagens(((data as any)?.viagens || []) as Viagem[]);
    setLastSync(new Date());
  };

  // group by year/month from data_ida
  const inMonth = (v: Viagem, y: number, m: number) => {
    if (!v.data_ida) return false;
    const d = new Date(v.data_ida + "T00:00");
    return d.getFullYear() === y && d.getMonth() === m;
  };
  const monthCounts = useMemo(() => {
    const c = new Array(12).fill(0);
    viagens.forEach((v) => {
      if (!v.data_ida) return;
      const d = new Date(v.data_ida + "T00:00");
      if (d.getFullYear() === year) c[d.getMonth()] += 1;
    });
    return c;
  }, [viagens, year]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return viagens
      .filter((v) => inMonth(v, year, month))
      .filter((v) =>
        !term
          ? true
          : [v.colaborador, v.destino].some((x) =>
              x.toLowerCase().includes(term),
            ),
      )
      .filter((v) => {
        if (statusFilter === "todos") return true;
        const st = statusMap[cardKey(v)] || "Pendente";
        return st === statusFilter;
      });
  }, [viagens, q, year, month, statusFilter, statusMap]);

  const total = useMemo(
    () => filtered.reduce((a, v) => a + Number(v.valor_total || 0), 0),
    [filtered],
  );

  const prevMonthLabel = useMemo(() => {
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    return `${MONTHS_FULL[m]} ${y}`;
  }, [month, year]);
  const currentMonthLabel = `${MONTHS_FULL[month]} ${year}`;

  const minutesAgo = lastSync
    ? Math.max(0, Math.floor((Date.now() - lastSync.getTime()) / 60000))
    : null;

  return (
    <div className="space-y-5 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Recargas <span className="text-muted-foreground">·</span> Viagens
          </h2>
          <p className="text-sm text-muted-foreground">
            Acompanhe os repasses para colaboradores em viagem corporativa
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1">
            <CalIcon className="h-3.5 w-3.5" /> {currentMonthLabel}
          </Badge>
          <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1">
            <Clock className="h-3.5 w-3.5" /> vs {prevMonthLabel}
          </Badge>
          <a href={SHEET_URL} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink className="mr-2 h-4 w-4" /> Abrir planilha
            </Button>
          </a>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Sincronizar
          </Button>
          <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white">
            <Plus className="mr-1.5 h-4 w-4" /> Nova recarga
          </Button>
        </div>
      </div>

      {/* Month tabs */}
      <div className="flex items-stretch gap-2 rounded-lg border border-border bg-card p-1.5">
        <div className="flex items-center gap-1 rounded-md border border-border px-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setYear((y) => y - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[3rem] text-center text-sm font-semibold">
            {year}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid flex-1 grid-cols-12 gap-1">
          {MONTHS.map((m, i) => {
            const active = i === month;
            const count = monthCounts[i];
            return (
              <button
                key={m}
                onClick={() => setMonth(i)}
                className={cn(
                  "relative flex flex-col items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <span>{m}</span>
                <span
                  className={cn(
                    "mt-0.5 text-[11px]",
                    count > 0 ? "text-foreground font-semibold" : "opacity-60",
                  )}
                >
                  {count > 0 ? count : "·"}
                </span>
                {active && (
                  <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-rose-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por colaborador, destino ou evento…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border-0 bg-transparent pl-8 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
            {(["todos", "Pendente", "Feito"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium transition",
                  statusFilter === s
                    ? s === "Pendente"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : s === "Feito"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "todos" ? "Todos" : s}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground">
            {filtered.length} viagem(ns)
          </span>
          <span className="font-semibold">{fmt(total)}</span>
        </div>
      </div>

      {/* Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((v) => {
          const k = cardKey(v);
          const st: StatusViagem = statusMap[k] || "Pendente";
          const { evento, sub } = splitDestino(v.destino || "");
          const perDia = v.dias > 0 ? Number(v.valor_total) / v.dias : 0;
          return (
            <div
              key={v.id}
              className="rounded-lg border border-border bg-card p-3.5 shadow-sm transition hover:shadow-md"
            >
              {/* top: avatar + name + days */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
                      colorFor(v.colaborador),
                    )}
                  >
                    {initials(v.colaborador)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold leading-tight">
                      {v.colaborador || "—"}
                    </div>
                    <div className="truncate text-[10.5px] text-muted-foreground">
                      Colaborador
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className="gap-1 rounded-full h-5 px-2 text-[10.5px]">
                  <Clock className="h-3 w-3" /> {v.dias}d
                </Badge>
              </div>

              {/* Evento */}
              <div className="mt-3 flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 text-rose-500 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium leading-tight">{evento}</div>
                  {sub && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {sub}
                    </div>
                  )}
                </div>
              </div>

              {/* Período */}
              <div className="mt-2.5 flex items-center gap-1.5">
                <div className="flex flex-1 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11.5px]">
                  <CalIcon className="h-3 w-3 text-muted-foreground" />
                  {fmtDate(v.data_ida)}
                </div>
                <span className="text-[10.5px] text-muted-foreground">→</span>
                <div className="flex flex-1 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11.5px]">
                  <CalIcon className="h-3 w-3 text-muted-foreground" />
                  {fmtDate(v.data_volta)}
                </div>
              </div>

              {/* Valor + Status */}
              <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                <div>
                  <div className="text-base font-bold leading-none">
                    {fmt(Number(v.valor_total))}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {fmt(perDia)} / dia
                  </div>
                </div>
                <Select
                  value={st}
                  onValueChange={(val) => setStatus(k, val as StatusViagem, v.viagem_hash)}
                >
                  <SelectTrigger
                    className={cn(
                      "h-6 w-[108px] rounded-full border px-2.5 text-[11px]",
                      STATUS_CLS[st],
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
        {!filtered.length && !loading && (
          <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
            Nenhuma viagem neste mês.
          </p>
        )}
        {loading && !filtered.length && (
          <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
            Carregando da planilha…
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="pt-2 text-center text-xs text-muted-foreground">
        Sincronizado com <strong className="font-semibold">Planilha de Recargas · Viagens</strong>
        {minutesAgo !== null && <> · última atualização há {minutesAgo} min</>}
      </div>
    </div>
  );
}
