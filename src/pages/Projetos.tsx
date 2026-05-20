import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Search, X, LayoutGrid, List as ListIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Projeto = {
  id: string;
  ordem: number;
  automacao: string;
  responsavel: string | null;
  status: string;
  descricao_entrega: string | null;
  observacao: string | null;
};

const STATUS_COLS = [
  { key: "A fazer",      icon: "📝", accent: "bg-slate-500" },
  { key: "Em andamento", icon: "🚧", accent: "bg-amber-500" },
  { key: "Pausado",      icon: "⏸️", accent: "bg-rose-500" },
  { key: "Concluido",    icon: "✅", accent: "bg-emerald-500" },
] as const;

const STATUS_CLS: Record<string, string> = {
  "Concluido":    "bg-emerald-100 text-emerald-700",
  "Em andamento": "bg-amber-100 text-amber-800",
  "A fazer":      "bg-slate-200 text-slate-700",
  "Pausado":      "bg-rose-100 text-rose-700",
};

const RESP_PALETTE = [
  { chip: "text-rose-600",    dot: "bg-rose-500",    border: "border-l-rose-400" },
  { chip: "text-violet-600",  dot: "bg-violet-500",  border: "border-l-violet-400" },
  { chip: "text-sky-600",     dot: "bg-sky-500",     border: "border-l-sky-400" },
  { chip: "text-emerald-600", dot: "bg-emerald-500", border: "border-l-emerald-400" },
  { chip: "text-amber-700",   dot: "bg-amber-500",   border: "border-l-amber-400" },
  { chip: "text-indigo-600",  dot: "bg-indigo-500",  border: "border-l-indigo-400" },
  { chip: "text-teal-600",    dot: "bg-teal-500",    border: "border-l-teal-400" },
  { chip: "text-pink-600",    dot: "bg-pink-500",    border: "border-l-pink-400" },
];
const RESP_DEFAULT = { chip: "text-slate-600", dot: "bg-slate-400", border: "border-l-slate-300" };
function colorForResp(name: string | null) {
  if (!name) return RESP_DEFAULT;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return RESP_PALETTE[h % RESP_PALETTE.length];
}
function initials(name: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase();
}

export default function Projetos() {
  const [rows, setRows] = useState<Projeto[]>([]);
  const [search, setSearch] = useState("");
  const [filtStatus, setFiltStatus] = useState("__all");
  const [filtResp, setFiltResp] = useState("__all");
  const [view, setView] = useState<"kanban" | "list">("list");
  const [editing, setEditing] = useState<Projeto | null>(null);
  const [creatingStatus, setCreatingStatus] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from("projetos" as any).select("*").order("ordem");
    if (error) toast.error(error.message);
    else setRows(((data as unknown) as Projeto[]) || []);
  };
  useEffect(() => { document.title = "Projetos"; load(); }, []);

  const responsaveis = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.responsavel && s.add(r.responsavel));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtStatus !== "__all" && r.status !== filtStatus) return false;
      if (filtResp !== "__all" && (r.responsavel || "") !== filtResp) return false;
      if (!q) return true;
      return [r.automacao, r.descricao_entrega, r.observacao, r.responsavel]
        .some((f) => (f || "").toLowerCase().includes(q));
    });
  }, [rows, search, filtStatus, filtResp]);

  // KPIs
  const totalCount = rows.length;
  const emAndamento = useMemo(() => rows.filter((r) => r.status === "Em andamento").length, [rows]);
  const concluidos = useMemo(() => rows.filter((r) => r.status === "Concluido").length, [rows]);
  const aFazer = useMemo(() => rows.filter((r) => r.status === "A fazer").length, [rows]);
  const topResp = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => { if (r.responsavel) counts[r.responsavel] = (counts[r.responsavel] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  const update = async (id: string, patch: Partial<Projeto>) => {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("projetos" as any).update(patch as any).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir projeto?")) return;
    const { error } = await supabase.from("projetos" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const openNew = (status: string) => {
    setEditing({
      id: "", ordem: 0, automacao: "", responsavel: "", status,
      descricao_entrega: "", observacao: "",
    });
    setCreatingStatus(status);
  };
  const openEdit = (r: Projeto) => { setEditing(r); setCreatingStatus(null); };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.automacao.trim()) { toast.error("Informe um nome."); return; }
    if (creatingStatus) {
      const ordem = rows.length ? Math.max(...rows.map((r) => r.ordem)) + 1 : 1;
      const { error } = await supabase.from("projetos" as any).insert({
        ordem, automacao: editing.automacao, responsavel: editing.responsavel || null,
        status: editing.status, descricao_entrega: editing.descricao_entrega || null,
        observacao: editing.observacao || null,
      } as any);
      if (error) { toast.error(error.message); return; }
    } else {
      const { id, ordem: _o, ...patch } = editing;
      const { error } = await supabase.from("projetos" as any).update(patch as any).eq("id", id);
      if (error) { toast.error(error.message); return; }
    }
    setEditing(null); setCreatingStatus(null); load();
  };

  // Drag & drop entre colunas
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  };
  const onDragEnd = () => { setDraggingId(null); setDragOverCol(null); };
  const onDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    if (id) {
      const row = rows.find((r) => r.id === id);
      if (row && row.status !== status) update(id, { status });
    }
  };

  const clearFilters = () => { setFiltStatus("__all"); setFiltResp("__all"); };
  const hasFilters = filtStatus !== "__all" || filtResp !== "__all";

  return (
    <div className="space-y-5 p-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Projetos</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Gestão dos projetos do time financeiro — da ideia à entrega. Arraste cartões entre colunas para mover de etapa.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => openNew("A fazer")} className="bg-rose-600 hover:bg-rose-700 text-white">
            <Plus className="mr-2 h-4 w-4" /> Novo projeto
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="TOTAL" value={String(totalCount)} hint="projetos cadastrados" valueClass="text-foreground" />
        <Kpi label="A FAZER" value={String(aFazer)} hint="aguardando início" valueClass="text-foreground" />
        <Kpi label="EM ANDAMENTO" value={String(emAndamento)} hint="em execução" valueClass="text-rose-600" />
        <Kpi label="CONCLUÍDOS" value={String(concluidos)} hint="entregues" valueClass="text-emerald-600" />
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[10px] font-semibold tracking-wider text-muted-foreground">TOP RESPONSÁVEIS</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topResp.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : topResp.map(([n, c]) => {
              const cc = colorForResp(n);
              return (
                <span key={n} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-muted", cc.chip)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", cc.dot)} />
                  {n} <span className="opacity-70">{c}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar projeto, descrição ou responsável..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <MiniSelect label="Status" value={filtStatus} onChange={setFiltStatus} options={[["__all", "Todos"], ...STATUS_COLS.map(c => [c.key, c.key] as [string, string])]} />
        <MiniSelect label="Responsável" value={filtResp} onChange={setFiltResp} options={[["__all", "Todos"], ...responsaveis.map(c => [c, c] as [string, string])]} />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}><X className="mr-1 h-3 w-3" /> Limpar</Button>
        )}
        <div className="ml-auto flex items-center rounded-md border border-border p-0.5">
          <Button
            variant={view === "kanban" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setView("kanban")}
            title="Visão Kanban"
          >
            <LayoutGrid className="mr-1 h-3.5 w-3.5" /> Kanban
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => setView("list")}
            title="Visão em lista"
          >
            <ListIcon className="mr-1 h-3.5 w-3.5" /> Lista
          </Button>
        </div>
        <Button variant="outline" size="icon" onClick={() => openNew("A fazer")} title="Novo projeto">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {view === "list" ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projeto</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Descrição da entrega</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                    Nenhum projeto encontrado.
                  </TableCell>
                </TableRow>
              ) : filtered.map((r) => {
                const statusCol = STATUS_COLS.find((s) => s.key === r.status);
                const rc = colorForResp(r.responsavel);
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => openEdit(r)}>
                    <TableCell className="font-medium">{r.automacao || "(sem nome)"}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={cn("h-2 w-2 rounded-full", statusCol?.accent || "bg-slate-400")} />
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full text-[9.5px] font-semibold bg-muted", rc.chip)}>
                          {initials(r.responsavel)}
                        </span>
                        {r.responsavel || <span className="text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                      {r.descricao_entrega || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">
                      {r.observacao || "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={(e) => { e.stopPropagation(); remove(r.id); }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUS_COLS.map((col) => {
            const items = filtered.filter((r) => r.status === col.key);
            return (
              <div key={col.key}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOverCol !== col.key) setDragOverCol(col.key); }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOverCol((c) => c === col.key ? null : c); }}
                onDrop={(e) => onDrop(e, col.key)}
                className={cn(
                  "rounded-lg p-3 flex flex-col gap-3 min-h-[300px] transition-colors",
                  dragOverCol === col.key && draggingId
                    ? "bg-primary/10 ring-2 ring-primary/40"
                    : "bg-muted/40"
                )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", col.accent)} />
                    <span className="text-sm font-semibold">{col.icon} {col.key}</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{items.length}</Badge>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openNew(col.key)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex flex-col gap-2.5">
                  {items.length === 0 ? (
                    <div className={cn(
                      "text-xs italic px-1 py-6 text-center rounded border-2 border-dashed",
                      dragOverCol === col.key && draggingId
                        ? "border-primary/50 text-primary"
                        : "border-transparent text-muted-foreground"
                    )}>
                      {dragOverCol === col.key && draggingId ? "Solte aqui" : "Vazio"}
                    </div>
                  ) : items.map((r) => {
                    const rc = colorForResp(r.responsavel);
                    return (
                      <div key={r.id} draggable
                        onDragStart={(e) => onDragStart(e, r.id)}
                        onDragEnd={onDragEnd}
                        onClick={() => { if (!draggingId) openEdit(r); }}
                        className={cn(
                          "group cursor-grab active:cursor-grabbing rounded-md border bg-card border-l-4 px-3 py-2.5 shadow-sm hover:shadow transition select-none",
                          rc.border,
                          draggingId === r.id && "opacity-40 ring-2 ring-primary"
                        )}>
                        <div className="flex items-center justify-between gap-2">
                          <div className={cn("flex items-center gap-1 text-[10.5px] font-semibold tracking-wide", rc.chip)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", rc.dot)} />
                            {r.responsavel || "Sem responsável"}
                          </div>
                          <Badge className={cn("text-[10px] px-1.5 h-4", STATUS_CLS[r.status] || "")}>
                            {r.status.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="mt-1.5 text-[13px] font-semibold leading-snug text-foreground">{r.automacao || "(sem nome)"}</div>
                        {(r.descricao_entrega || r.observacao) && (
                          <div className="mt-1 text-[11.5px] text-muted-foreground line-clamp-2">{r.descricao_entrega || r.observacao}</div>
                        )}
                        <div className="mt-2 flex items-center justify-end gap-1.5">
                          <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full text-[9.5px] font-semibold bg-muted", rc.chip)}>
                            {initials(r.responsavel)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setCreatingStatus(null); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{creatingStatus ? "Novo projeto" : "Editar projeto"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nome</Label>
                <Input value={editing.automacao} onChange={(e) => setEditing({ ...editing, automacao: e.target.value })} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_COLS.map(c => <SelectItem key={c.key} value={c.key}>{c.key}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Responsável</Label>
                <Input value={editing.responsavel || ""} onChange={(e) => setEditing({ ...editing, responsavel: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Descrição da entrega</Label>
                <Textarea rows={3} value={editing.descricao_entrega || ""} onChange={(e) => setEditing({ ...editing, descricao_entrega: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Observação</Label>
                <Textarea rows={2} value={editing.observacao || ""} onChange={(e) => setEditing({ ...editing, observacao: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            {editing && !creatingStatus ? (
              <Button variant="ghost" className="text-destructive" onClick={() => { remove(editing.id); setEditing(null); }}>
                <Trash2 className="mr-2 h-4 w-4" /> Excluir
              </Button>
            ) : <div />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setEditing(null); setCreatingStatus(null); }}>Cancelar</Button>
              <Button onClick={saveEdit}>Salvar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, hint, valueClass }: { label: string; value: string; hint: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] font-semibold tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold leading-none", valueClass)}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function MiniSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[120px] text-xs">
        <span className="text-muted-foreground mr-1">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
