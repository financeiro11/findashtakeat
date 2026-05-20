import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Upload, Search, X, LayoutGrid, List as ListIcon } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Automacao = {
  id: string;
  ordem: number;
  automacao: string;
  responsavel: string | null;
  status: string;
  dor: string | null;
  solucao: string | null;
  observacao: string | null;
  ferramentas: string | null;
  impacto: string | null;
  categoria: string | null;
  horas_mes: number | null;
  execucoes: number | null;
  ultima_falha: string | null;
  created_at?: string;
};

const STATUS_COLS = [
  { key: "Ideias", icon: "💡", accent: "bg-amber-500" },
  { key: "A fazer", icon: "📝", accent: "bg-slate-500" },
  { key: "Em teste", icon: "🧪", accent: "bg-blue-500" },
  { key: "Rodando", icon: "✅", accent: "bg-emerald-500" },
] as const;

const IMPACTO_OPTS = ["Baixo", "Médio", "Alto"];
const IMPACTO_CLS: Record<string, string> = {
  Baixo: "bg-slate-200 text-slate-700",
  Médio: "bg-amber-100 text-amber-800",
  Alto: "bg-rose-100 text-rose-700",
};

// Paleta por categoria (cor da borda esquerda + cor do chip)
const CAT_COLORS: Record<string, { border: string; chip: string; dot: string }> = {
  "IA & Categorização":   { border: "border-l-rose-400",    chip: "text-rose-600",    dot: "bg-rose-500" },
  "Pagamentos & Cobrança":{ border: "border-l-violet-400",  chip: "text-violet-600",  dot: "bg-violet-500" },
  "Notas Fiscais":        { border: "border-l-sky-400",     chip: "text-sky-600",     dot: "bg-sky-500" },
  "Reportes & DRE":       { border: "border-l-emerald-400", chip: "text-emerald-600", dot: "bg-emerald-500" },
  "Conciliação":          { border: "border-l-amber-400",   chip: "text-amber-700",   dot: "bg-amber-500" },
  "Comunicação Interna":  { border: "border-l-orange-400",  chip: "text-orange-600",  dot: "bg-orange-500" },
};
const CAT_DEFAULT = { border: "border-l-slate-300", chip: "text-slate-600", dot: "bg-slate-400" };
const CAT_PALETTE: { border: string; chip: string; dot: string }[] = [
  { border: "border-l-rose-400",    chip: "text-rose-600",    dot: "bg-rose-500" },
  { border: "border-l-violet-400",  chip: "text-violet-600",  dot: "bg-violet-500" },
  { border: "border-l-sky-400",     chip: "text-sky-600",     dot: "bg-sky-500" },
  { border: "border-l-emerald-400", chip: "text-emerald-600", dot: "bg-emerald-500" },
  { border: "border-l-amber-400",   chip: "text-amber-700",   dot: "bg-amber-500" },
  { border: "border-l-orange-400",  chip: "text-orange-600",  dot: "bg-orange-500" },
  { border: "border-l-teal-400",    chip: "text-teal-600",    dot: "bg-teal-500" },
  { border: "border-l-indigo-400",  chip: "text-indigo-600",  dot: "bg-indigo-500" },
  { border: "border-l-pink-400",    chip: "text-pink-600",    dot: "bg-pink-500" },
  { border: "border-l-lime-500",    chip: "text-lime-700",    dot: "bg-lime-500" },
];
const DEFAULT_CATEGORIAS = Object.keys(CAT_COLORS);
const CAT_LS_KEY = "automacoes.categorias.custom";
function loadCustomCategorias(): string[] {
  try { return JSON.parse(localStorage.getItem(CAT_LS_KEY) || "[]"); } catch { return []; }
}
function saveCustomCategorias(arr: string[]) {
  try { localStorage.setItem(CAT_LS_KEY, JSON.stringify(arr)); } catch {}
}
function colorForCategoria(name: string): { border: string; chip: string; dot: string } {
  if (CAT_COLORS[name]) return CAT_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}

// Mapeia palavra → letra de chip de ferramenta
const TOOL_LETTER: Record<string, string> = {
  n8n: "N", omie: "O", slack: "S", whatsapp: "W", drive: "D", sheets: "S",
  asaas: "A", "rd station": "R", rd: "R", telegram: "T", excel: "X", gmail: "G",
};
const TOOL_COLOR: Record<string, string> = {
  N: "bg-rose-100 text-rose-700",
  O: "bg-violet-100 text-violet-700",
  S: "bg-emerald-100 text-emerald-700",
  W: "bg-green-100 text-green-700",
  D: "bg-sky-100 text-sky-700",
  A: "bg-amber-100 text-amber-700",
  R: "bg-orange-100 text-orange-700",
  T: "bg-blue-100 text-blue-700",
  X: "bg-emerald-100 text-emerald-700",
  G: "bg-rose-100 text-rose-700",
};

function parseTools(s: string | null): { letter: string; name: string }[] {
  if (!s) return [];
  return s.split(/[,;|/]+/).map((x) => x.trim()).filter(Boolean).map((t) => {
    const k = t.toLowerCase();
    const letter = TOOL_LETTER[k] || t[0].toUpperCase();
    return { letter, name: t };
  });
}

function initials(name: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase();
}

export default function AutomacoesCatalogo() {
  const [rows, setRows] = useState<Automacao[]>([]);
  const [search, setSearch] = useState("");
  const [filtCat, setFiltCat] = useState("__all");
  const [filtImp, setFiltImp] = useState("__all");
  const [filtResp, setFiltResp] = useState("__all");
  const [filtTool, setFiltTool] = useState("__all");
  const [editing, setEditing] = useState<Automacao | null>(null);
  const [creatingStatus, setCreatingStatus] = useState<string | null>(null);
  const [customCats, setCustomCats] = useState<string[]>(() => loadCustomCategorias());
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [view, setView] = useState<"kanban" | "list">("list");
  const fileRef = useRef<HTMLInputElement>(null);

  const CATEGORIAS = useMemo(() => {
    const fromRows = rows.map(r => r.categoria || "").filter(Boolean);
    return Array.from(new Set([...DEFAULT_CATEGORIAS, ...customCats, ...fromRows]));
  }, [rows, customCats]);

  const addCategoria = (name: string) => {
    const n = name.trim();
    if (!n) return;
    if (CATEGORIAS.includes(n)) { toast.info("Categoria já existe"); return; }
    const next = Array.from(new Set([...customCats, n]));
    setCustomCats(next);
    saveCustomCategorias(next);
    if (editing) setEditing({ ...editing, categoria: n });
    setNewCatName("");
    setNewCatOpen(false);
  };

  const load = async () => {
    const { data, error } = await supabase
      .from("automacoes_catalogo").select("*").order("ordem");
    if (error) toast.error(error.message);
    else setRows((data as Automacao[]) || []);
  };
  useEffect(() => { load(); }, []);

  const responsaveis = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.responsavel && s.add(r.responsavel));
    return Array.from(s).sort();
  }, [rows]);

  const tools = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => parseTools(r.ferramentas).forEach((t) => s.add(t.name)));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtCat !== "__all" && (r.categoria || "") !== filtCat) return false;
      if (filtImp !== "__all" && (r.impacto || "") !== filtImp) return false;
      if (filtResp !== "__all" && (r.responsavel || "") !== filtResp) return false;
      if (filtTool !== "__all" && !parseTools(r.ferramentas).some((t) => t.name === filtTool)) return false;
      if (!q) return true;
      return [r.automacao, r.dor, r.solucao, r.ferramentas, r.categoria]
        .some((f) => (f || "").toLowerCase().includes(q));
    });
  }, [rows, search, filtCat, filtImp, filtResp, filtTool]);

  // KPIs
  const rodandoCount = useMemo(() => rows.filter((r) => r.status === "Rodando").length, [rows]);
  const horasMes = useMemo(() => rows.filter((r) => r.status === "Rodando").reduce((s, r) => s + (Number(r.horas_mes) || 0), 0), [rows]);
  const execucoesTotal = useMemo(() => rows.reduce((s, r) => s + (Number(r.execucoes) || 0), 0), [rows]);
  const diasMedios = useMemo(() => {
    const ativas = rows.filter((r) => r.status === "Rodando");
    if (!ativas.length) return 0;
    const today = new Date();
    const dias = ativas.map((r) => {
      const base = r.ultima_falha || (r.created_at ? r.created_at.slice(0, 10) : null);
      if (!base) return 0;
      const d = new Date(base + "T00:00:00");
      return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000));
    });
    return Math.round(dias.reduce((a, b) => a + b, 0) / dias.length);
  }, [rows]);
  const topTools = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => parseTools(r.ferramentas).forEach((t) => { counts[t.name] = (counts[t.name] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  const update = async (id: string, patch: Partial<Automacao>) => {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("automacoes_catalogo").update(patch as any).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta automação?")) return;
    const { error } = await supabase.from("automacoes_catalogo").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const openNew = (status: string) => {
    setEditing({
      id: "", ordem: 0, automacao: "", responsavel: "", status,
      dor: "", solucao: "", observacao: "", ferramentas: "",
      impacto: "Médio", categoria: CATEGORIAS[0], horas_mes: null, execucoes: 0, ultima_falha: null,
    });
    setCreatingStatus(status);
  };
  const openEdit = (r: Automacao) => { setEditing(r); setCreatingStatus(null); };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.automacao.trim()) { toast.error("Informe um nome."); return; }
    if (creatingStatus) {
      const ordem = rows.length ? Math.max(...rows.map((r) => r.ordem)) + 1 : 1;
      const { error } = await supabase.from("automacoes_catalogo").insert({
        ordem, automacao: editing.automacao, responsavel: editing.responsavel || null,
        status: editing.status, dor: editing.dor || null, solucao: editing.solucao || null,
        observacao: editing.observacao || null, ferramentas: editing.ferramentas || null,
        impacto: editing.impacto || "Médio", categoria: editing.categoria || null,
        horas_mes: editing.horas_mes, execucoes: editing.execucoes ?? 0, ultima_falha: editing.ultima_falha,
      });
      if (error) { toast.error(error.message); return; }
    } else {
      const { id, ordem: _o, created_at: _c, ...patch } = editing;
      const { error } = await supabase.from("automacoes_catalogo").update(patch as any).eq("id", id);
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

  const norm = (s: string) => s?.toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const pickStatus = (v: any) => {
    const n = norm(String(v ?? ""));
    return STATUS_COLS.map(c => c.key).find((s) => norm(s) === n) || "A fazer";
  };
  const pickImpacto = (v: any) => {
    const n = norm(String(v ?? ""));
    return IMPACTO_OPTS.find((s) => norm(s) === n) || "Médio";
  };

  const importExcel = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
      if (!json.length) return toast.error("Planilha vazia");
      const map: Record<string, string> = {};
      Object.keys(json[0]).forEach((k) => { map[norm(k)] = k; });
      const get = (row: any, ...keys: string[]) => {
        for (const k of keys) { const real = map[norm(k)]; if (real) return row[real]; }
        return "";
      };
      const startOrdem = rows.length ? Math.max(...rows.map((r) => r.ordem)) + 1 : 1;
      const payload = json.map((r, i) => ({
        ordem: startOrdem + i,
        automacao: String(get(r, "automacao", "automação", "nome") || "Sem nome"),
        responsavel: String(get(r, "responsavel", "responsável") || "") || null,
        status: pickStatus(get(r, "status")),
        dor: String(get(r, "dor") || "") || null,
        solucao: String(get(r, "solucao", "solução") || "") || null,
        observacao: String(get(r, "observacao", "observação", "obs") || "") || null,
        ferramentas: String(get(r, "ferramentas", "ferramenta", "tools") || "") || null,
        impacto: pickImpacto(get(r, "impacto")),
        categoria: String(get(r, "categoria") || "") || null,
        horas_mes: Number(get(r, "horas_mes", "horas/mês", "horas")) || null,
      }));
      const { error } = await supabase.from("automacoes_catalogo").insert(payload);
      if (error) toast.error(error.message);
      else { toast.success(`${payload.length} automação(ões) importada(s)`); load(); }
    } catch (e: any) {
      toast.error(e.message || "Erro ao importar");
    }
  };

  const clearFilters = () => { setFiltCat("__all"); setFiltImp("__all"); setFiltResp("__all"); setFiltTool("__all"); };
  const hasFilters = filtCat !== "__all" || filtImp !== "__all" || filtResp !== "__all" || filtTool !== "__all";

  return (
    <div className="space-y-5 p-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Catálogo de Automações</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Pipeline das automações do time financeiro — da ideia ao roteiro de produção. Arraste cartões entre colunas para mover de etapa.
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importExcel(f); e.target.value = ""; }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Importar Excel
          </Button>
          <Button onClick={() => openNew("Ideias")} className="bg-rose-600 hover:bg-rose-700 text-white">
            <Plus className="mr-2 h-4 w-4" /> Nova automação
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="RODANDO" value={String(rodandoCount)} hint="automações ativas" valueClass="text-foreground" />
        <Kpi label="HORAS/MÊS" value={horasMes ? horasMes.toLocaleString("pt-BR") : "—"} hint="economizadas pelo time" valueClass="text-rose-600" />
        <Kpi label="EXECUÇÕES" value={execucoesTotal ? execucoesTotal.toLocaleString("pt-BR") : "—"} hint="acumuladas no programa" valueClass="text-foreground" />
        <Kpi label="DIAS MÉDIOS" value={diasMedios ? String(diasMedios) : "—"} hint="rodando sem falhar" valueClass="text-foreground" />
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[10px] font-semibold tracking-wider text-muted-foreground">TOOLS MAIS USADAS</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topTools.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : topTools.map(([n, c]) => {
              const letter = (TOOL_LETTER[n.toLowerCase()] || n[0]).toUpperCase();
              return (
                <span key={n} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", TOOL_COLOR[letter] || "bg-slate-100 text-slate-700")}>
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
          <Input placeholder="Buscar automação, dor ou tool..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <MiniSelect label="Categoria" value={filtCat} onChange={setFiltCat} options={[["__all", "Todas"], ...CATEGORIAS.map(c => [c, c] as [string, string])]} />
        <MiniSelect label="Impacto" value={filtImp} onChange={setFiltImp} options={[["__all", "Todos"], ...IMPACTO_OPTS.map(c => [c, c] as [string, string])]} />
        <MiniSelect label="Responsável" value={filtResp} onChange={setFiltResp} options={[["__all", "Todos"], ...responsaveis.map(c => [c, c] as [string, string])]} />
        <MiniSelect label="Tool" value={filtTool} onChange={setFiltTool} options={[["__all", "Todas"], ...tools.map(c => [c, c] as [string, string])]} />
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
        <Button variant="outline" size="icon" onClick={() => openNew("Ideias")} title="Nova automação">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {view === "list" ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Automação</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Impacto</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead className="text-right">h/mês</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                    Nenhuma automação encontrada.
                  </TableCell>
                </TableRow>
              ) : filtered.map((r) => {
                const cat = r.categoria ? colorForCategoria(r.categoria) : CAT_DEFAULT;
                const ts = parseTools(r.ferramentas);
                const statusCol = STATUS_COLS.find((s) => s.key === r.status);
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => openEdit(r)}>
                    <TableCell className="font-medium">{r.automacao || "(sem nome)"}</TableCell>
                    <TableCell>
                      {r.categoria ? (
                        <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", cat.chip)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", cat.dot)} />
                          {r.categoria}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={cn("h-2 w-2 rounded-full", statusCol?.accent || "bg-slate-400")} />
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px] px-1.5 h-4", IMPACTO_CLS[r.impacto || "Médio"])}>
                        {(r.impacto || "Médio").toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[9.5px] font-semibold text-primary">
                          {initials(r.responsavel)}
                        </span>
                        {r.responsavel || <span className="text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {ts.slice(0, 6).map((t, i) => (
                          <span key={i} title={t.name}
                            className={cn("inline-flex h-5 min-w-[20px] items-center justify-center rounded text-[10px] font-bold px-1",
                              TOOL_COLOR[t.letter] || "bg-slate-100 text-slate-700")}>
                            {t.letter}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {r.horas_mes ? Number(r.horas_mes).toLocaleString("pt-BR") : "—"}
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
        {/* Kanban */}
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
                  const cat = r.categoria ? colorForCategoria(r.categoria) : CAT_DEFAULT;
                  const ts = parseTools(r.ferramentas);
                  return (
                    <div key={r.id} draggable
                      onDragStart={(e) => onDragStart(e, r.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => { if (!draggingId) openEdit(r); }}
                      className={cn(
                        "group cursor-grab active:cursor-grabbing rounded-md border bg-card border-l-4 px-3 py-2.5 shadow-sm hover:shadow transition select-none",
                        cat.border,
                        draggingId === r.id && "opacity-40 ring-2 ring-primary"
                      )}>
                      <div className="flex items-center justify-between gap-2">
                        <div className={cn("flex items-center gap-1 text-[10.5px] font-semibold tracking-wide", cat.chip)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", cat.dot)} />
                          {r.categoria || "Sem categoria"}
                        </div>
                        <Badge className={cn("text-[10px] px-1.5 h-4", IMPACTO_CLS[r.impacto || "Médio"])}>
                          {(r.impacto || "Médio").toUpperCase()}
                        </Badge>
                      </div>
                      <div className="mt-1.5 text-[13px] font-semibold leading-snug text-foreground">{r.automacao || "(sem nome)"}</div>
                      {(r.dor || r.solucao) && (
                        <div className="mt-1 text-[11.5px] text-muted-foreground line-clamp-2">{r.dor || r.solucao}</div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          {ts.slice(0, 5).map((t, i) => (
                            <span key={i} title={t.name}
                              className={cn("inline-flex h-5 min-w-[20px] items-center justify-center rounded text-[10px] font-bold px-1",
                                TOOL_COLOR[t.letter] || "bg-slate-100 text-slate-700")}>
                              {t.letter}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                          {(() => {
                            if (r.horas_mes) return <span>↑ {Number(r.horas_mes).toLocaleString("pt-BR")} h/mês</span>;
                            if (r.execucoes) return <span>{Number(r.execucoes).toLocaleString("pt-BR")} exec.</span>;
                            const base = r.ultima_falha || (r.created_at ? r.created_at.slice(0, 10) : null);
                            if (base) {
                              const d = Math.max(0, Math.floor((Date.now() - new Date(base + "T00:00:00").getTime()) / 86400000));
                              return <span className="italic">há {d}d</span>;
                            }
                            return null;
                          })()}
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[9.5px] font-semibold text-primary">
                            {initials(r.responsavel)}
                          </span>
                        </div>
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
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{creatingStatus ? "Nova automação" : "Editar automação"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nome</Label>
                <Input value={editing.automacao} onChange={(e) => setEditing({ ...editing, automacao: e.target.value })} />
              </div>
              <div>
                <Label>Categoria</Label>
                {newCatOpen ? (
                  <div className="flex gap-1">
                    <Input
                      autoFocus
                      value={newCatName}
                      placeholder="Nome da categoria"
                      onChange={(e) => setNewCatName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addCategoria(newCatName); }
                        if (e.key === "Escape") { setNewCatOpen(false); setNewCatName(""); }
                      }}
                    />
                    <Button type="button" size="sm" onClick={() => addCategoria(newCatName)}>OK</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setNewCatOpen(false); setNewCatName(""); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={editing.categoria || ""}
                    onValueChange={(v) => {
                      if (v === "__new__") { setNewCatOpen(true); return; }
                      setEditing({ ...editing, categoria: v });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS.map(c => {
                        const cc = colorForCategoria(c);
                        return (
                          <SelectItem key={c} value={c}>
                            <span className="inline-flex items-center gap-2">
                              <span className={cn("h-2 w-2 rounded-full", cc.dot)} />
                              {c}
                            </span>
                          </SelectItem>
                        );
                      })}
                      <SelectItem value="__new__" className="text-primary font-medium">
                        + Nova categoria…
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_COLS.map(c => <SelectItem key={c.key} value={c.key}>{c.key}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Impacto</Label>
                <Select value={editing.impacto || "Médio"} onValueChange={(v) => setEditing({ ...editing, impacto: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{IMPACTO_OPTS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Horas/mês</Label>
                <Input type="number" value={editing.horas_mes ?? ""} onChange={(e) => setEditing({ ...editing, horas_mes: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <div>
                <Label>Execuções acumuladas</Label>
                <Input type="number" value={editing.execucoes ?? 0} onChange={(e) => setEditing({ ...editing, execucoes: e.target.value === "" ? 0 : Number(e.target.value) })} />
              </div>
              <div>
                <Label>Última falha</Label>
                <Input type="date" value={editing.ultima_falha ?? ""} onChange={(e) => setEditing({ ...editing, ultima_falha: e.target.value || null })} />
              </div>
              <div className="col-span-2">
                <Label>Responsável</Label>
                <Input value={editing.responsavel || ""} onChange={(e) => setEditing({ ...editing, responsavel: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Ferramentas (separadas por vírgula)</Label>
                <Input value={editing.ferramentas || ""} placeholder="n8n, Omie, Slack" onChange={(e) => setEditing({ ...editing, ferramentas: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Dor</Label>
                <Textarea rows={2} value={editing.dor || ""} onChange={(e) => setEditing({ ...editing, dor: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label>Solução</Label>
                <Textarea rows={2} value={editing.solucao || ""} onChange={(e) => setEditing({ ...editing, solucao: e.target.value })} />
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
