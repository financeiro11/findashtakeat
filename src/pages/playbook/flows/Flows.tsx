import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Search, Workflow, Loader2, Copy, Trash2, Archive, CheckCircle2, AlertTriangle,
  PanelLeftClose, PanelLeftOpen, Home, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PLAYBOOK_CATEGORIES, PLAYBOOK_STATUSES, STATUS_STYLES } from "../constants";
import { FlowEditor } from "./FlowEditor";
import type { Flow } from "./types";

export default function Flows() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [draft, setDraft] = useState<Flow | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const debounceRef = useRef<any>(null);

  const selected = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId]);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (selected) setDraft(selected);
    else setDraft(null);
    setSaveState("idle");
  }, [selectedId]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("playbook_flows").select("*").order("updated_at", { ascending: false });
    if (error) toast.error("Erro ao carregar fluxos", { description: error.message });
    setItems((data as any as Flow[]) ?? []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let arr = [...items];
    if (filterCat !== "all") arr = arr.filter(i => i.category === filterCat);
    if (filterStatus !== "all") arr = arr.filter(i => i.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(i => i.title.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q));
    }
    return arr;
  }, [items, filterCat, filterStatus, search]);

  async function handleCreate(p: { title: string; description: string; category: string }) {
    const { data, error } = await supabase.from("playbook_flows").insert({
      title: p.title || "Novo fluxo",
      description: p.description || null,
      category: p.category,
      status: "Rascunho",
      owner_name: profile?.nome ?? null,
      nodes: [
        { id: "start", type: "start", position: { x: 80, y: 80 }, data: { label: "Início" } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      last_edited_by: profile?.nome ?? null,
    }).select().single();
    if (error) { toast.error("Erro ao criar", { description: error.message }); return; }
    setItems(prev => [data as any as Flow, ...prev]);
    setSelectedId((data as any).id);
    setCreateOpen(false);
    toast.success("Fluxo criado");
  }

  async function persist(d: Flow) {
    setSaveState("saving");
    const { error } = await supabase.from("playbook_flows").update({
      title: d.title,
      description: d.description,
      category: d.category,
      status: d.status,
      owner_name: d.owner_name,
      nodes: d.nodes,
      edges: d.edges,
      viewport: d.viewport,
      archived: d.archived,
      last_edited_by: profile?.nome ?? null,
    }).eq("id", d.id);
    if (error) { setSaveState("error"); toast.error("Erro ao salvar", { description: error.message }); return; }
    setSaveState("saved");
    setSavedAt(new Date().toISOString());
    setItems(prev => prev.map(i => i.id === d.id ? { ...d, updated_at: new Date().toISOString() } : i));
  }

  function updateDraft(patch: Partial<Flow>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(next), 800);
  }

  async function handleDuplicate(f: Flow) {
    const { data, error } = await supabase.from("playbook_flows").insert({
      title: `${f.title} (cópia)`,
      description: f.description,
      category: f.category,
      status: "Rascunho",
      owner_name: f.owner_name,
      nodes: f.nodes,
      edges: f.edges,
      viewport: f.viewport,
      last_edited_by: profile?.nome ?? null,
    }).select().single();
    if (error) { toast.error("Erro ao duplicar"); return; }
    setItems(prev => [data as any as Flow, ...prev]);
    setSelectedId((data as any).id);
    toast.success("Fluxo duplicado");
  }

  async function handleDelete() {
    if (!selected) return;
    const { error } = await supabase.from("playbook_flows").delete().eq("id", selected.id);
    if (error) { toast.error("Erro ao excluir"); return; }
    setItems(prev => prev.filter(i => i.id !== selected.id));
    setSelectedId(null);
    setConfirmDelete(false);
    toast.success("Fluxo excluído");
  }

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Header */}
      <div className="border-b bg-background/80 backdrop-blur-sm px-6 pt-4 pb-3">
        <nav className="flex items-center gap-1.5 text-[12px] text-muted-foreground mb-2">
          <Home className="h-3.5 w-3.5" />
          <span>Início</span>
          <ChevronRight className="h-3 w-3 opacity-60" />
          <span className={cn(selected ? "" : "text-foreground font-medium")}>Fluxos</span>
          {selected && (
            <>
              <ChevronRight className="h-3 w-3 opacity-60" />
              <span className="text-foreground font-medium truncate max-w-[420px]">{selected.title}</span>
            </>
          )}
        </nav>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[22px] font-semibold tracking-tight leading-none">Fluxos & Diagramas</h1>
              <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-secondary text-secondary-foreground text-[11px] font-medium tabular-nums">
                {items.length} {items.length === 1 ? "fluxo" : "fluxos"}
              </span>
            </div>
            <p className="text-[12.5px] text-muted-foreground mt-1.5 max-w-2xl">
              Desenhe os processos da empresa visualmente: etapas, decisões, swimlanes e responsáveis.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setSidebarOpen(o => !o)}>
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              {sidebarOpen ? "Recolher" : "Expandir"}
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="h-9 gap-2">
              <Plus className="h-4 w-4" /> Novo fluxo
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <div className="relative w-[300px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar fluxo..." className="pl-8 h-9 bg-background" />
          </div>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="h-9 w-[170px] bg-background"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {PLAYBOOK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 w-[170px] bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              {PLAYBOOK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Body */}
      <div className={cn(
        "flex-1 grid grid-cols-1 overflow-hidden transition-[grid-template-columns] duration-300 ease-out",
        sidebarOpen ? "lg:grid-cols-[320px_1fr]" : "lg:grid-cols-[0px_1fr]"
      )}>
        <aside className={cn("border-r overflow-hidden bg-background/60 transition-all", sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none")}>
          <div className="h-full overflow-y-auto px-2.5 py-3">
            {loading ? (
              <div className="px-3 py-6 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <Workflow className="h-6 w-6 text-muted-foreground/60 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum fluxo ainda</p>
                <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Criar primeiro
                </Button>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map(f => {
                  const active = selectedId === f.id;
                  return (
                    <li key={f.id}>
                      <button
                        onClick={() => setSelectedId(f.id)}
                        className={cn(
                          "group w-full text-left rounded-lg px-3 py-2.5 transition-all relative",
                          active ? "bg-background shadow-sm ring-1 ring-border" : "hover:bg-background/80"
                        )}
                      >
                        {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary" />}
                        <div className="font-medium text-[13px] leading-snug truncate">{f.title}</div>
                        {f.description && (
                          <div className="text-[11.5px] leading-relaxed text-muted-foreground line-clamp-2 mt-1">{f.description}</div>
                        )}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span className="inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-medium text-muted-foreground bg-muted">{f.category}</span>
                          <span className={cn("inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-medium border", STATUS_STYLES[f.status] ?? "")}>{f.status}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-[10.5px] text-muted-foreground/80">
                          <span className="truncate">{f.owner_name ?? "—"}</span>
                          <span className="tabular-nums">{new Date(f.updated_at).toLocaleDateString("pt-BR")}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="overflow-hidden bg-muted/30 flex flex-col min-h-0">
          {!draft ? (
            <div className="flex-1 grid place-items-center text-center px-6">
              <div>
                <Workflow className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="text-base font-semibold">Selecione um fluxo</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Crie um novo fluxo ou escolha um existente para começar a desenhar o processo.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Sub-header */}
              <div className="border-b bg-background/80 px-3 py-1.5 flex items-center gap-2">
                <Input
                  value={draft.title}
                  onChange={e => updateDraft({ title: e.target.value })}
                  className="h-7 flex-1 min-w-0 text-[13px] font-semibold border-transparent hover:border-border focus-visible:border-border bg-transparent px-2"
                />
                <Select value={draft.status} onValueChange={v => updateDraft({ status: v })}>
                  <SelectTrigger className="h-7 w-[120px] text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLAYBOOK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={draft.category} onValueChange={v => updateDraft({ category: v })}>
                  <SelectTrigger className="h-7 w-[140px] text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLAYBOOK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <SaveBadge state={saveState} savedAt={savedAt} />
                <div className="flex items-center gap-0.5 border-l pl-1.5 ml-0.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicar" onClick={() => handleDuplicate(draft)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title={draft.archived ? "Desarquivar" : "Arquivar"} onClick={() => updateDraft({ archived: !draft.archived })}>
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>


              {/* Canvas */}
              <div className="flex-1 min-h-0">
                <FlowEditor
                  key={draft.id}
                  nodes={draft.nodes as any}
                  edges={draft.edges as any}
                  viewport={draft.viewport}
                  title={draft.title}
                  onChange={(next) => updateDraft({ nodes: next.nodes as any, edges: next.edges as any, viewport: next.viewport })}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo fluxo</DialogTitle></DialogHeader>
          <CreateForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este fluxo?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SaveBadge({ state, savedAt }: { state: string; savedAt: string | null }) {
  if (state === "saving") return <Badge variant="outline" className="h-7 gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Salvando…</Badge>;
  if (state === "error") return <Badge variant="destructive" className="h-7 gap-1.5"><AlertTriangle className="h-3 w-3" /> Erro</Badge>;
  if (state === "saved") return <Badge variant="outline" className="h-7 gap-1.5 text-emerald-700 border-emerald-300 bg-emerald-50"><CheckCircle2 className="h-3 w-3" /> Salvo {savedAt ? new Date(savedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}</Badge>;
  return null;
}

function CreateForm({ onSubmit, onCancel }: { onSubmit: (p: any) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(PLAYBOOK_CATEGORIES[0]);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Título</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Fechamento mensal — fluxo geral" />
      </div>
      <div className="space-y-1.5">
        <Label>Descrição</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Resumo opcional" />
      </div>
      <div className="space-y-1.5">
        <Label>Categoria</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PLAYBOOK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSubmit({ title, description, category })}>Criar fluxo</Button>
      </DialogFooter>
    </div>
  );
}
