import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Trash2, ChevronDown, ChevronRight, Filter, X, LayoutGrid,
  Table as TableIcon, AlertTriangle, MoreHorizontal,
  Search, GripVertical, Pencil, Palette, Check, CheckCircle2, Clock, ListChecks, Target,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type Subtarefa = {
  id: string;
  titulo: string;
  responsavel: string | null;
  done: boolean;
};

type Tarefa = {
  id: string; ordem: number; titulo: string; responsavel: string | null;
  status: string; prioridade: string; prazo: string | null; observacao: string | null;
  created_at: string;
  subtarefas: Subtarefa[];
};

const DEFAULT_COLUMNS = ["Backlog", "Em andamento", "Acompanhamento", "Revisão", "Concluído", "Tasks - RPA"];
const COLUMNS_CFG_KEY = "tarefas.columns.cfg.v1";
const LEGACY_EXTRA_KEY = "tarefas.columns.extra.v1";

type ColorId = "muted" | "warning" | "orange" | "blue" | "success" | "purple" | "pink" | "destructive";

const COLOR_PRESETS: { id: ColorId; label: string; dot: string; bar: string; ring: string }[] = [
  { id: "muted",       label: "Cinza",    dot: "bg-muted-foreground",    bar: "bg-muted-foreground/40", ring: "ring-muted-foreground/40" },
  { id: "warning",     label: "Amarelo",  dot: "bg-warning",             bar: "bg-warning",             ring: "ring-warning/40" },
  { id: "orange",      label: "Laranja",  dot: "bg-orange-500",          bar: "bg-orange-500",          ring: "ring-orange-500/40" },
  { id: "blue",        label: "Azul",     dot: "bg-blue-500",            bar: "bg-blue-500",            ring: "ring-blue-500/40" },
  { id: "success",     label: "Verde",    dot: "bg-success",             bar: "bg-success",             ring: "ring-success/40" },
  { id: "purple",      label: "Roxo",     dot: "bg-purple-500",          bar: "bg-purple-500",          ring: "ring-purple-500/40" },
  { id: "pink",        label: "Rosa",     dot: "bg-pink-500",            bar: "bg-pink-500",            ring: "ring-pink-500/40" },
  { id: "destructive", label: "Vermelho", dot: "bg-destructive",         bar: "bg-destructive",         ring: "ring-destructive/40" },
];

const DEFAULT_COLOR_BY_NAME: Record<string, ColorId> = {
  "Backlog": "muted",
  "Em andamento": "warning",
  "Acompanhamento": "orange",
  "Revisão": "blue",
  "Concluído": "success",
  "Tasks - RPA": "purple",
};

type ColumnsCfg = {
  order: string[];
  meta: Record<string, { color: ColorId }>;
};

function loadColumnsCfg(): ColumnsCfg {
  try {
    const raw = localStorage.getItem(COLUMNS_CFG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ColumnsCfg;
      if (Array.isArray(parsed.order) && parsed.order.length) return parsed;
    }
  } catch {}
  // migrate from legacy extras
  let extra: string[] = [];
  try { extra = JSON.parse(localStorage.getItem(LEGACY_EXTRA_KEY) || "[]"); } catch {}
  const order = [...DEFAULT_COLUMNS, ...extra];
  const meta: Record<string, { color: ColorId }> = {};
  order.forEach(c => { meta[c] = { color: DEFAULT_COLOR_BY_NAME[c] || "muted" }; });
  return { order, meta };
}

function colorOf(col: string, meta: ColumnsCfg["meta"]) {
  const id: ColorId = meta[col]?.color || DEFAULT_COLOR_BY_NAME[col] || "muted";
  return COLOR_PRESETS.find(p => p.id === id) || COLOR_PRESETS[0];
}

const PRIO_OPTS = ["Baixa", "Média", "Alta", "Urgente"];
const PRIO_DOT: Record<string, string> = {
  "Baixa": "bg-muted-foreground",
  "Média": "bg-yellow-500",
  "Alta": "bg-red-600",
  "Urgente": "bg-[#7f1d1d]",
};
const PRIO_TEXT: Record<string, string> = {
  "Baixa": "text-muted-foreground",
  "Média": "text-yellow-600 dark:text-yellow-400",
  "Alta": "text-red-600 dark:text-red-500",
  "Urgente": "text-[#7f1d1d] dark:text-[#b91c1c]",
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function isAtrasada(t: Tarefa) {
  if (!t.prazo || t.status === "Concluído") return false;
  return new Date(t.prazo) < new Date(new Date().toDateString());
}
function diasDesde(iso: string) {
  const d = new Date(iso);
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}
function initials(name: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}
// Hash determinístico p/ derivar progresso por id (sem alterar schema)
// Progresso: somente baseado em subtarefas. Sem subtarefas = sem barra.
function progressFor(t: Tarefa): number {
  const subs = t.subtarefas || [];
  if (subs.length === 0) return 0;
  const done = subs.filter(s => s.done).length;
  return Math.round((done / subs.length) * 100);
}
// Tags derivadas (TASK / RPA quando coluna RPA, ou primeira palavra do responsável como "cliente")
function tagsFor(t: Tarefa): { label: string; cls: string }[] {
  const tags: { label: string; cls: string }[] = [];
  if (t.status === "Tasks - RPA") {
    tags.push({ label: "TASK", cls: "bg-foreground text-background" });
    tags.push({ label: "RPA", cls: "bg-destructive/15 text-destructive" });
  }
  return tags;
}

// Extrai "evento" da observação ("Evento: XXX") ou do título "Recarga de viagem - {evento}"
function eventoFor(t: Tarefa): string {
  const obs = (t as any).observacao as string | null | undefined;
  if (obs) {
    const m = /^\s*Evento:\s*(.+?)\s*$/im.exec(obs);
    if (m) {
      const ev = m[1].trim();
      if (ev && ev !== "—" && ev !== "-") return ev;
    }
  }
  const mt = /^\s*Recarga de viagem\s*[-–]\s*(.+?)\s*$/i.exec(t.titulo || "");
  if (mt) return mt[1].trim();
  return "";
}
function groupByEvento(items: Tarefa[]): { evento: string; items: Tarefa[] }[] {
  const map = new Map<string, Tarefa[]>();
  for (const t of items) {
    const ev = eventoFor(t);
    if (!map.has(ev)) map.set(ev, []);
    map.get(ev)!.push(t);
  }
  // sem-evento primeiro (sem header), depois eventos em ordem alfabética
  const groups: { evento: string; items: Tarefa[] }[] = [];
  if (map.has("")) groups.push({ evento: "", items: map.get("")! });
  [...map.keys()]
    .filter(k => k !== "")
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach(k => groups.push({ evento: k, items: map.get(k)! }));
  return groups;
}

function progressBarColor(p: number): string {
  if (p >= 100) return "bg-emerald-500";
  if (p >= 51) return "bg-orange-500";
  return "bg-destructive";
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 80, h = 28;
  const step = w / (data.length - 1);
  const path = data
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke={`hsl(var(--${color}))`} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Tarefas() {
  const [rows, setRows] = useState<Tarefa[]>([]);
  const [view, setView] = useState<"kanban" | "tabela">("kanban");
  const [search, setSearch] = useState("");
  const [concluidoCollapsed, setConcluidoCollapsed] = useState(true);
  const [editing, setEditing] = useState<Tarefa | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingStatus, setCreatingStatus] = useState<string>("Backlog");
  const [colsCfg, setColsCfg] = useState<ColumnsCfg>(() => loadColumnsCfg());
  const COLUMNS = colsCfg.order;
  const persistCfg = (next: ColumnsCfg) => {
    setColsCfg(next);
    localStorage.setItem(COLUMNS_CFG_KEY, JSON.stringify(next));
  };
  const addColumn = () => {
    const name = window.prompt("Nome da nova coluna:");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (COLUMNS.includes(trimmed)) { toast.error("Já existe uma coluna com esse nome"); return; }
    persistCfg({
      order: [...colsCfg.order, trimmed],
      meta: { ...colsCfg.meta, [trimmed]: { color: "muted" } },
    });
  };
  const removeColumn = async (col: string) => {
    if (DEFAULT_COLUMNS.includes(col)) { toast.error("Coluna padrão não pode ser removida"); return; }
    if (rows.some(r => r.status === col)) {
      toast.error("Mova ou exclua as tarefas desta coluna antes de removê-la");
      return;
    }
    const meta = { ...colsCfg.meta };
    delete meta[col];
    persistCfg({ order: colsCfg.order.filter(c => c !== col), meta });
  };
  const renameColumn = async (col: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === col) return;
    if (COLUMNS.includes(trimmed)) { toast.error("Já existe uma coluna com esse nome"); return; }
    // Atualiza tarefas que usam esta coluna como status
    const affected = rows.filter(r => r.status === col);
    if (affected.length) {
      const { error } = await supabase.from("tarefas").update({ status: trimmed }).eq("status", col);
      if (error) { toast.error(error.message); return; }
      setRows(rs => rs.map(r => r.status === col ? { ...r, status: trimmed } : r));
    }
    const order = colsCfg.order.map(c => c === col ? trimmed : c);
    const meta = { ...colsCfg.meta };
    meta[trimmed] = meta[col] || { color: "muted" };
    delete meta[col];
    persistCfg({ order, meta });
    toast.success("Coluna renomeada");
  };
  const recolorColumn = (col: string, color: ColorId) => {
    persistCfg({
      order: colsCfg.order,
      meta: { ...colsCfg.meta, [col]: { color } },
    });
  };
  const moveColumn = (from: string, to: string) => {
    if (from === to) return;
    const order = [...colsCfg.order];
    const i = order.indexOf(from);
    const j = order.indexOf(to);
    if (i === -1 || j === -1) return;
    order.splice(i, 1);
    order.splice(j, 0, from);
    persistCfg({ order, meta: colsCfg.meta });
  };

  // Filtros chips topo
  const [chipPrio, setChipPrio] = useState<string>("");
  const [chipResp, setChipResp] = useState<string>("");
  const [chipAtrasadas, setChipAtrasadas] = useState(false);
  const [chipPeriodo, setChipPeriodo] = useState<string>(""); // "", "mes", "3m", "ano"

  // Filtros tabela (header)
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fPrioridade, setFPrioridade] = useState<string[]>([]);
  const [fResponsavel, setFResponsavel] = useState<string[]>([]);

  const load = async () => {
    const { data, error } = await supabase.from("tarefas").select("*").order("ordem");
    if (error) toast.error(error.message);
    else {
      const mapped: Tarefa[] = ((data as any[]) || []).map(r => ({
        ...r,
        subtarefas: Array.isArray(r.subtarefas) ? (r.subtarefas as Subtarefa[]) : [],
      }));
      setRows(mapped);
    }
  };
  useEffect(() => { load(); }, []);

  const normalizeResp = (v: string | null | undefined) => {
    const s = (v || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (s.startsWith("henr")) return "Henrique";
    if (s.startsWith("juli")) return "Júlia";
    return v?.trim() || "—";
  };

  const responsaveis = useMemo(() => ["Henrique", "Júlia"], []);

  const filteredBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !r.titulo.toLowerCase().includes(q) && !(r.responsavel || "").toLowerCase().includes(q)) return false;
      if (chipPrio && r.prioridade !== chipPrio) return false;
      if (chipResp && normalizeResp(r.responsavel) !== chipResp) return false;
      if (chipAtrasadas && !isAtrasada(r)) return false;
      return true;
    });
  }, [rows, search, chipPrio, chipResp, chipAtrasadas]);

  const filteredTable = useMemo(() => filteredBase.filter(r => {
    if (fStatus.length && !fStatus.includes(r.status)) return false;
    if (fPrioridade.length && !fPrioridade.includes(r.prioridade)) return false;
    if (fResponsavel.length && !fResponsavel.includes(normalizeResp(r.responsavel))) return false;
    return true;
  }), [filteredBase, fStatus, fPrioridade, fResponsavel]);

  // Counts respect prioridade/responsável/busca, mas ignoram o chip "atrasadas"
  // (para que o próprio chip mostre o total filtrado de atrasadas)
  const baseForCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !r.titulo.toLowerCase().includes(q) && !(r.responsavel || "").toLowerCase().includes(q)) return false;
      if (chipPrio && r.prioridade !== chipPrio) return false;
      if (chipResp && normalizeResp(r.responsavel) !== chipResp) return false;
      return true;
    });
  }, [rows, search, chipPrio, chipResp]);

  const total = baseForCounts.length;
  const emAnd = baseForCounts.filter(r => ["Em andamento", "Acompanhamento", "Revisão", "Tasks - RPA"].includes(r.status)).length;
  const concl = baseForCounts.filter(r => r.status === "Concluído").length;
  // Conta apenas tarefas atrasadas cujo status está visível nas colunas (evita contar registros de status legados/órfãos que não aparecem na UI)
  const atras = baseForCounts.filter(r => isAtrasada(r) && COLUMNS.includes(r.status)).length;
  const pctEm = total ? Math.round((emAnd / total) * 100) : 0;
  const META_CONCLUIDAS = 22;

  const grouped = useMemo(() => {
    const g: Record<string, Tarefa[]> = {};
    COLUMNS.forEach(c => g[c] = []);
    filteredBase.forEach(r => { (g[r.status] ||= []).push(r); });
    return g;
  }, [filteredBase]);

  const update = async (id: string, patch: Partial<Tarefa>) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("tarefas").update(patch as any).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("tarefas").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const create = async (t: Partial<Tarefa>) => {
    const ordem = rows.length ? Math.max(...rows.map(r => r.ordem)) + 1 : 1;
    const { error } = await supabase.from("tarefas").insert({
      ordem, titulo: t.titulo || "Nova tarefa", responsavel: t.responsavel || null,
      status: t.status || creatingStatus, prioridade: t.prioridade || "Média",
      prazo: t.prazo || null, observacao: t.observacao || null,
      subtarefas: (t.subtarefas || []) as any,
    });
    if (error) toast.error(error.message);
    else { toast.success("Tarefa criada"); load(); setCreating(false); }
  };

  const openCreate = (status?: string) => {
    setCreatingStatus(status || "Backlog");
    setCreating(true);
  };

  // ---------- Header com KPIs + chips ----------
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Tarefas</h2>
          <p className="text-xs text-muted-foreground">Acompanhamento de demandas do time financeiro</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openCreate()} className="h-8 gap-1.5 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" /> Nova Tarefa
          </Button>
          {view === "kanban" && (
            <Button
              variant="outline"
              onClick={addColumn}
              className="h-8 gap-1.5 px-3 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Nova Coluna
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Total" value={total} hint={`${total} no escopo atual`} tone="foreground" icon={ListChecks} />
        <KPI label="Em andamento" value={emAnd} hint={`${pctEm}% do total`} tone="warning" icon={Clock} progress={pctEm} />
        <KPI label="Concluídas" value={concl} hint={`meta ${META_CONCLUIDAS}`} tone="success" icon={CheckCircle2} progress={META_CONCLUIDAS ? Math.min(100, Math.round((concl / META_CONCLUIDAS) * 100)) : 0} />
        <KPI label="Atrasadas" value={atras} hint={atras ? "requerem ação" : "tudo em dia"} tone="destructive" icon={AlertTriangle} progress={total ? Math.round((atras / total) * 100) : 0} />
      </div>

      {/* Toolbar de chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, tag ou responsável..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-72 pl-7 text-xs"
          />
        </div>
        <ChipSelect
          label="Todas prioridades"
          value={chipPrio}
          options={PRIO_OPTS}
          onChange={setChipPrio}
        />
        <ChipSelect
          label="Todos responsáveis"
          value={chipResp}
          options={responsaveis}
          onChange={setChipResp}
        />
        <button
          onClick={() => setChipAtrasadas(v => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
            chipAtrasadas
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          <AlertTriangle className="h-3 w-3" />
          Atrasadas ({atras})
        </button>
        <div className="ml-auto flex items-center gap-0.5 rounded-md border-2 border-destructive bg-destructive p-0.5 shadow-sm">
          <button
            onClick={() => setView("kanban")}
            className={cn("flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-colors",
              view === "kanban" ? "bg-white text-destructive" : "text-white hover:bg-white/10")}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Kanban
          </button>
          <button
            onClick={() => setView("tabela")}
            className={cn("flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-colors",
              view === "tabela" ? "bg-white text-destructive" : "text-white hover:bg-white/10")}
          >
            <TableIcon className="h-3.5 w-3.5" /> Tabela
          </button>
        </div>
      </div>

      {view === "kanban" ? (
        <KanbanView
          columns={COLUMNS}
          colsMeta={colsCfg.meta}
          grouped={grouped}
          collapsed={concluidoCollapsed}
          onToggleConcluido={() => setConcluidoCollapsed(v => !v)}
          onOpen={setEditing}
          onAdd={openCreate}
          onMove={(id, status) => update(id, { status })}
          onRemove={remove}
          onAddColumn={addColumn}
          onRemoveColumn={removeColumn}
          onRenameColumn={renameColumn}
          onRecolorColumn={recolorColumn}
          onMoveColumn={moveColumn}
          isCustomColumn={(c) => !DEFAULT_COLUMNS.includes(c)}
        />
      ) : (
        <TableView
          columns={COLUMNS}
          colsMeta={colsCfg.meta}
          rows={filteredTable}
          fStatus={fStatus} setFStatus={setFStatus}
          fPrioridade={fPrioridade} setFPrioridade={setFPrioridade}
          fResponsavel={fResponsavel} setFResponsavel={setFResponsavel}
          responsaveis={responsaveis}
          onOpen={setEditing}
          onRemove={remove}
        />
      )}

      <TaskDialog
        columns={COLUMNS}
        open={creating}
        defaultStatus={creatingStatus}
        onClose={() => setCreating(false)}
        onSave={create}
        title="Nova Tarefa"
      />
      <TaskDialog
        columns={COLUMNS}
        open={!!editing}
        tarefa={editing || undefined}
        onClose={() => setEditing(null)}
        onSave={(patch) => { if (editing) update(editing.id, patch); }}
        title="Editar Tarefa"
      />
    </div>
  );
}

/* --------------------------- KPI --------------------------- */
function KPI({ label, value, hint, tone, icon: Icon, progress }: {
  label: string; value: number; hint: string;
  tone: "foreground" | "warning" | "success" | "destructive";
  icon: React.ComponentType<{ className?: string }>;
  progress?: number;
}) {
  const toneCls: Record<string, { bg: string; fg: string; bar: string }> = {
    foreground:  { bg: "bg-muted",            fg: "text-foreground",       bar: "bg-foreground/60" },
    warning:     { bg: "bg-warning/15",       fg: "text-warning",          bar: "bg-warning" },
    success:     { bg: "bg-success/15",       fg: "text-success",          bar: "bg-success" },
    destructive: { bg: "bg-destructive/15",   fg: "text-destructive",      bar: "bg-destructive" },
  };
  const t = toneCls[tone];
  return (
    <Card className="flex items-center gap-3 border-border p-3">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", t.bg, t.fg)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="num mt-0.5 text-2xl font-bold leading-none">{value}</div>
        {hint && (
          <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>
        )}
        {typeof progress === "number" && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full transition-all", t.bar)} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        )}
      </div>
    </Card>
  );
}

/* --------------------------- Chip Select --------------------------- */
function ChipSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="h-8 w-auto gap-1 border-border bg-card px-2.5 text-xs text-muted-foreground">
        <SelectValue placeholder={label}>{value || label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{label}</SelectItem>
        {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* --------------------------- KANBAN --------------------------- */
function KanbanView({
  columns, colsMeta, grouped, collapsed, onToggleConcluido, onOpen, onAdd, onMove, onRemove,
  onAddColumn, onRemoveColumn, onRenameColumn, onRecolorColumn, onMoveColumn, isCustomColumn,
}: {
  columns: string[];
  colsMeta: ColumnsCfg["meta"];
  grouped: Record<string, Tarefa[]>;
  collapsed: boolean;
  onToggleConcluido: () => void;
  onOpen: (t: Tarefa) => void;
  onAdd: (status: string) => void;
  onMove: (id: string, status: string) => void;
  onRemove: (id: string) => void;
  onAddColumn: () => void;
  onRemoveColumn: (col: string) => void;
  onRenameColumn: (col: string, newName: string) => void;
  onRecolorColumn: (col: string, color: ColorId) => void;
  onMoveColumn: (from: string, to: string) => void;
  isCustomColumn: (col: string) => boolean;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [colDragOver, setColDragOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setRenameValue(renaming);
      setTimeout(() => renameInputRef.current?.select(), 10);
    }
  }, [renaming]);

  const COL_DRAG_TYPE = "application/x-tarefas-col";

  const handleDrop = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    setDragOver(null);
    setColDragOver(null);
    const fromCol = e.dataTransfer.getData(COL_DRAG_TYPE);
    if (fromCol) {
      if (fromCol !== col) onMoveColumn(fromCol, col);
      return;
    }
    const id = e.dataTransfer.getData("text/plain");
    if (id) onMove(id, col);
  };

  const handleDragOver = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes(COL_DRAG_TYPE)) {
      setColDragOver(col);
    } else {
      setDragOver(col);
    }
  };

  const submitRename = () => {
    if (renaming && renameValue.trim() && renameValue.trim() !== renaming) {
      onRenameColumn(renaming, renameValue.trim());
    }
    setRenaming(null);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map(col => {
        const items = grouped[col] || [];
        const overdue = items.filter(isAtrasada).length;
        const isConcluido = col === "Concluído";
        const color = colorOf(col, colsMeta);

        if (isConcluido && collapsed) {
          return (
            <button
              key={col}
              onClick={onToggleConcluido}
              onDragOver={(e) => handleDragOver(e, col)}
              onDragLeave={() => { setDragOver(null); setColDragOver(null); }}
              onDrop={(e) => handleDrop(e, col)}
              className={cn(
                "flex w-12 shrink-0 flex-col items-center justify-between rounded-lg border border-border bg-card py-3 hover:border-success",
                dragOver === col && "border-success ring-2 ring-success/30",
                colDragOver === col && "border-primary ring-2 ring-primary/30",
              )}
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <div
                className="flex flex-1 items-center justify-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              >
                Concluído
              </div>
              <span className="num rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                {items.length}
              </span>
            </button>
          );
        }

        return (
          <div
            key={col}
            onDragOver={(e) => handleDragOver(e, col)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOver(null);
                setColDragOver(null);
              }
            }}
            onDrop={(e) => handleDrop(e, col)}
            className={cn(
              "flex w-[280px] shrink-0 flex-col rounded-lg border border-border bg-card transition-colors",
              dragOver === col && "border-primary ring-2 ring-primary/30 bg-primary/5",
              colDragOver === col && "border-primary ring-2 ring-primary/40 bg-primary/5",
            )}
          >
            <div
              className="flex items-center justify-between gap-2 border-b border-border px-2 py-2"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(COL_DRAG_TYPE, col);
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground" />
                <span className={cn("h-2 w-2 shrink-0 rounded-full", color.dot)} />
                {renaming === col ? (
                  <input
                    ref={renameInputRef}
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={submitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    draggable={false}
                    className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-[11px] font-bold uppercase tracking-wider outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <span
                    className="truncate text-[10px] font-bold uppercase tracking-wider cursor-text"
                    onDoubleClick={() => setRenaming(col)}
                    title="Duplo clique para renomear"
                  >
                    {col}
                  </span>
                )}
                <span className="num rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{items.length}</span>
                {overdue > 0 && (
                  <span className="num flex items-center gap-0.5 text-[10px] font-semibold text-destructive">
                    <AlertTriangle className="h-2.5 w-2.5" />{overdue}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                {isConcluido && (
                  <button onClick={onToggleConcluido} className="rounded p-1 text-muted-foreground hover:bg-secondary">
                    <ChevronDown className="h-3 w-3" />
                  </button>
                )}
                <ColumnMenu
                  col={col}
                  currentColor={colorOf(col, colsMeta).id}
                  isCustom={isCustomColumn(col)}
                  onRename={() => setRenaming(col)}
                  onRecolor={(c) => onRecolorColumn(col, c)}
                  onAddTask={() => onAdd(col)}
                  onRemove={() => {
                    if (confirm(`Remover a coluna "${col}"?`)) onRemoveColumn(col);
                  }}
                />
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {groupByEvento(items).map(g => (
                <div key={g.evento || "__none__"} className="space-y-1.5">
                  {g.evento && (
                    <div className="flex items-center gap-1.5 px-0.5 pt-1">
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                      <span className="truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        {g.evento}
                      </span>
                      <span className="num rounded bg-secondary px-1 py-px text-[9px] text-muted-foreground">
                        {g.items.length}
                      </span>
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {g.items.map(t => (
                      <KanbanCard
                        key={t.id}
                        t={t}
                        bar={colorOf(t.status, colsMeta).bar}
                        onClick={() => onOpen(t)}
                        onRemove={() => onRemove(t.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={() => onAdd(col)}
                className="flex items-center justify-center gap-1 rounded border border-dashed border-border py-1.5 text-[10px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-3 w-3" /> Adicionar tarefa
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ t, bar, onClick, onRemove }: { t: Tarefa; bar: string; onClick: () => void; onRemove: () => void }) {
  const tags = tagsFor(t);
  const progress = progressFor(t);
  const overdue = isAtrasada(t);
  const subsTotal = t.subtarefas?.length || 0;
  const subsDone = t.subtarefas?.filter(s => s.done).length || 0;
  const showProgress = subsTotal > 0;

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group relative cursor-grab active:cursor-grabbing space-y-2 rounded-md border border-border bg-background p-2.5 shadow-sm transition-all hover:border-primary/40 hover:shadow"
    >
      <button
        onClick={(e) => { e.stopPropagation(); if (confirm("Excluir esta tarefa?")) onRemove(); }}
        className="absolute right-1 top-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        aria-label="Excluir tarefa"
      >
        <Trash2 className="h-3 w-3" />
      </button>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tg => (
            <span key={tg.label} className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider", tg.cls)}>
              {tg.label}
            </span>
          ))}
        </div>
      )}
      <div className="pr-5 text-xs font-semibold leading-snug text-foreground">{t.titulo}</div>

      {showProgress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-muted-foreground">
            <span>{`Checklist ${subsDone}/${subsTotal}`}</span>
            <span className="num font-semibold">{progress}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full transition-all", progressBarColor(progress))} style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className={cn("flex items-center gap-1 text-[10px] font-medium", PRIO_TEXT[t.prioridade])}>
          <span className={cn("h-1.5 w-1.5 rounded-full", PRIO_DOT[t.prioridade])} />
          {t.prioridade}
        </div>
        <div className={cn("num flex items-center gap-1 text-[10px]",
          overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {overdue && <AlertTriangle className="h-2.5 w-2.5" />}
          {fmtDate(t.prazo)}
        </div>
        <Avatar name={t.responsavel} />
      </div>
    </div>
  );
}

function Avatar({ name, size = "xs" }: { name: string | null; size?: "xs" | "sm" }) {
  const cls = size === "xs" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]";
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-bold text-primary", cls)}>
      {initials(name)}
    </span>
  );
}

/* --------------------------- TABELA --------------------------- */
function TableView({
  columns, colsMeta,
  rows, fStatus, setFStatus, fPrioridade, setFPrioridade, fResponsavel, setFResponsavel,
  responsaveis, onOpen, onRemove,
}: {
  columns: string[];
  colsMeta: ColumnsCfg["meta"];
  rows: Tarefa[];
  fStatus: string[]; setFStatus: (v: string[]) => void;
  fPrioridade: string[]; setFPrioridade: (v: string[]) => void;
  fResponsavel: string[]; setFResponsavel: (v: string[]) => void;
  responsaveis: string[];
  onOpen: (t: Tarefa) => void;
  onRemove: (id: string) => void;
}) {
  // Agrupa por status
  const groups = useMemo(() => {
    const visibleStatuses = fStatus.length ? fStatus : columns;
    return visibleStatuses.map(s => ({
      status: s,
      items: rows.filter(r => r.status === s),
    })).filter(g => g.items.length > 0);
  }, [rows, fStatus, columns]);

  return (
    <Card className="overflow-hidden border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/50 hover:bg-secondary/50">
            <TableHead className="w-8" />
            <TableHead className="text-[10px] font-bold uppercase tracking-wider">Tarefa</TableHead>
            <TableHead className="w-[150px]">
              <ColumnFilter label="Resp." options={responsaveis} value={fResponsavel} onChange={setFResponsavel} />
            </TableHead>
            <TableHead className="w-[140px]">
              <ColumnFilter label="Prioridade" options={PRIO_OPTS} value={fPrioridade} onChange={setFPrioridade} />
            </TableHead>
            <TableHead className="w-[110px] text-[10px] font-bold uppercase tracking-wider">Prazo</TableHead>
            <TableHead className="w-[110px] text-[10px] font-bold uppercase tracking-wider">Criada</TableHead>
            <TableHead className="w-[80px] text-[10px] font-bold uppercase tracking-wider">Idade</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma tarefa.
              </TableCell>
            </TableRow>
          ) : groups.map(g => {
            const overdue = g.items.filter(isAtrasada).length;
            return (
              <>
                <TableRow key={`grp-${g.status}`} className="border-b-0 bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={8} className="py-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", colorOf(g.status, colsMeta).dot)} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">{g.status}</span>
                        <span className="num text-[10px] text-muted-foreground">· {g.items.length}</span>
                      </div>
                      {overdue > 0 && (
                        <div className="num flex items-center gap-1 text-[10px] font-semibold text-destructive">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {overdue} atrasada{overdue > 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {g.items.map(t => {
                  const tags = tagsFor(t);
                  const overdueRow = isAtrasada(t);
                  const idade = diasDesde(t.created_at);
                  return (
                    <TableRow key={t.id} className="cursor-pointer text-xs" onClick={() => onOpen(t)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox />
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2">
                          {tags.map(tg => (
                            <span key={tg.label} className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider", tg.cls)}>
                              {tg.label}
                            </span>
                          ))}
                          <span className="font-medium">{t.titulo}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Avatar name={t.responsavel} />
                          <span className="truncate text-xs">{(t.responsavel || "—").split(" ")[0]}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          t.prioridade === "Urgente" && "bg-[#7f1d1d]/15",
                          t.prioridade === "Alta" && "bg-red-600/15",
                          t.prioridade === "Média" && "bg-yellow-500/15",
                          t.prioridade === "Baixa" && "bg-muted",
                        )}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", PRIO_DOT[t.prioridade])} />
                          <span className={PRIO_TEXT[t.prioridade]}>{t.prioridade}</span>
                        </div>
                      </TableCell>
                      <TableCell className={cn("num text-xs", overdueRow && "font-semibold text-destructive")}>
                        <span className="inline-flex items-center gap-1">
                          {overdueRow && <AlertTriangle className="h-2.5 w-2.5" />}
                          {fmtDate(t.prazo)}
                        </span>
                      </TableCell>
                      <TableCell className="num text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className={cn("num text-xs",
                        idade > 7 ? "text-destructive font-semibold" : idade > 3 ? "text-warning-foreground" : "text-muted-foreground"
                      )}>
                        {idade}d
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { if (confirm("Excluir esta tarefa?")) onRemove(t.id); }} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function ColumnFilter({ label, options, value, onChange }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (o: string) => {
    onChange(value.includes(o) ? value.filter(v => v !== o) : [...value, o]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
          <Filter className="h-2.5 w-2.5" />
          {label}
          {value.length > 0 && <span className="num rounded bg-primary/15 px-1 text-[9px] text-primary">{value.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold">{label}</span>
          {value.length > 0 && (
            <button onClick={() => onChange([])} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> Limpar
            </button>
          )}
        </div>
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {options.map(o => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary">
              <Checkbox checked={value.includes(o)} onCheckedChange={() => toggle(o)} />
              <span className="flex-1 truncate">{o}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* --------------------------- DIALOG --------------------------- */
function TaskDialog({ columns, open, tarefa, defaultStatus, onClose, onSave, title }: {
  columns: string[];
  open: boolean; tarefa?: Tarefa; defaultStatus?: string;
  onClose: () => void; onSave: (t: Partial<Tarefa>) => void; title: string;
}) {
  const [titulo, setTitulo] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [status, setStatus] = useState("Backlog");
  const [prioridade, setPrioridade] = useState("Média");
  const [prazo, setPrazo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [subtarefas, setSubtarefas] = useState<Subtarefa[]>([]);
  const [newSubTitle, setNewSubTitle] = useState("");
  const [newSubResp, setNewSubResp] = useState("");

  useEffect(() => {
    if (open) {
      setTitulo(tarefa?.titulo || "");
      setResponsavel(tarefa?.responsavel || "");
      setStatus(tarefa?.status || defaultStatus || "Backlog");
      setPrioridade(tarefa?.prioridade || "Média");
      setPrazo(tarefa?.prazo || "");
      setObservacao(tarefa?.observacao || "");
      setSubtarefas(tarefa?.subtarefas ? [...tarefa.subtarefas] : []);
      setNewSubTitle("");
      setNewSubResp("");
    }
  }, [open, tarefa, defaultStatus]);

  const addSub = () => {
    const t = newSubTitle.trim();
    if (!t) return;
    setSubtarefas(prev => [
      ...prev,
      { id: crypto.randomUUID(), titulo: t, responsavel: newSubResp.trim() || null, done: false },
    ]);
    setNewSubTitle("");
    setNewSubResp("");
  };

  const toggleSub = (id: string) =>
    setSubtarefas(prev => prev.map(s => s.id === id ? { ...s, done: !s.done } : s));
  const removeSub = (id: string) =>
    setSubtarefas(prev => prev.filter(s => s.id !== id));
  const updateSubResp = (id: string, resp: string) =>
    setSubtarefas(prev => prev.map(s => s.id === id ? { ...s, responsavel: resp || null } : s));
  const updateSubTitle = (id: string, titulo: string) =>
    setSubtarefas(prev => prev.map(s => s.id === id ? { ...s, titulo } : s));

  const subsDone = subtarefas.filter(s => s.done).length;
  const subsProgress = subtarefas.length ? Math.round((subsDone / subtarefas.length) * 100) : 0;

  // Autosave para edição: dispara onSave com debounce quando valores mudam
  const isEdit = !!tarefa;
  const firstSyncRef = useRef(true);
  useEffect(() => {
    if (!open || !isEdit) return;
    if (firstSyncRef.current) { firstSyncRef.current = false; return; }
    const handle = setTimeout(() => {
      onSave({
        titulo,
        responsavel: responsavel || null,
        status,
        prioridade,
        prazo: prazo || null,
        observacao: observacao || null,
        subtarefas,
      });
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulo, responsavel, status, prioridade, prazo, observacao, subtarefas, open, isEdit]);
  useEffect(() => { if (open) firstSyncRef.current = true; }, [open, tarefa?.id]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Título</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Responsável</Label>
              <Select value={responsavel || "__none"} onValueChange={(v) => setResponsavel(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  <SelectItem value="Henrique">Henrique</SelectItem>
                  <SelectItem value="Júlia">Júlia</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prazo</Label>
              <Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {columns.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prioridade</Label>
              <Select value={prioridade} onValueChange={setPrioridade}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIO_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Observação</Label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="w-full min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Subtarefas / Checklist */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Subtarefas</Label>
              <span className="text-[11px] text-muted-foreground">
                {subsDone}/{subtarefas.length} concluídas · {subsProgress}%
              </span>
            </div>
            {subtarefas.length > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn("h-full rounded-full transition-all", progressBarColor(subsProgress))}
                  style={{ width: `${subsProgress}%` }}
                />
              </div>
            )}

            <div className="space-y-1.5">
              {subtarefas.map(s => (
                <div key={s.id} className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5">
                  <Checkbox checked={s.done} onCheckedChange={() => toggleSub(s.id)} />
                  <Input
                    value={s.titulo}
                    onChange={(e) => updateSubTitle(s.id, e.target.value)}
                    className={cn(
                      "h-7 flex-1 text-sm",
                      s.done && "line-through text-muted-foreground"
                    )}
                  />
                  <Select value={s.responsavel || "__none"} onValueChange={(v) => updateSubResp(s.id, v === "__none" ? "" : v)}>
                    <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="Resp." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      <SelectItem value="Henrique">Henrique</SelectItem>
                      <SelectItem value="Júlia">Júlia</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => removeSub(s.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Remover subtarefa"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {subtarefas.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma subtarefa. Adicione abaixo.</p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Input
                value={newSubTitle}
                onChange={(e) => setNewSubTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } }}
                placeholder="Nova subtarefa..."
                className="h-8 flex-1 text-xs"
              />
              <Select value={newSubResp || "__none"} onValueChange={(v) => setNewSubResp(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Resp." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  <SelectItem value="Henrique">Henrique</SelectItem>
                  <SelectItem value="Júlia">Júlia</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline" onClick={addSub} className="h-8 gap-1 px-2">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          {isEdit ? (
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => onSave({
                titulo,
                responsavel: responsavel || null,
                status,
                prioridade,
                prazo: prazo || null,
                observacao: observacao || null,
                subtarefas,
              })}>
                Criar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Column Menu --------------------------- */
function ColumnMenu({
  col, currentColor, isCustom, onRename, onRecolor, onAddTask, onRemove,
}: {
  col: string;
  currentColor: ColorId;
  isCustom: boolean;
  onRename: () => void;
  onRecolor: (c: ColorId) => void;
  onAddTask: () => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Opções da coluna"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {col}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={onRename} className="text-xs">
          <Pencil className="mr-2 h-3.5 w-3.5" /> Renomear
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddTask} className="text-xs">
          <Plus className="mr-2 h-3.5 w-3.5" /> Adicionar tarefa
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Palette className="h-3 w-3" /> Cor
        </DropdownMenuLabel>
        <div className="grid grid-cols-4 gap-1 px-2 pb-2">
          {COLOR_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => onRecolor(p.id)}
              className={cn(
                "relative grid h-7 place-items-center rounded-md transition-transform hover:scale-110",
                p.dot,
                currentColor === p.id && "ring-2 ring-offset-1 ring-offset-popover ring-foreground"
              )}
              title={p.label}
              aria-label={`Cor ${p.label}`}
            >
              {currentColor === p.id && <Check className="h-3.5 w-3.5 text-background" />}
            </button>
          ))}
        </div>
        {isCustom && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onRemove}
              className="text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir coluna
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
