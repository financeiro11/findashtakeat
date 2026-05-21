import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Plus, Search, BookOpenCheck, Edit3, Copy, Trash2, Archive,
  CheckCircle2, AlertTriangle, Link as LinkIcon, MoreHorizontal,
  Paperclip, Loader2, FileText, Save, X, Upload, ChevronRight,
  PanelLeftClose, PanelLeftOpen, Home, ChevronUp, ChevronDown,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  PLAYBOOK_CATEGORIES, PLAYBOOK_STATUSES, STATUS_STYLES, type Playbook,
} from "./constants";
import { PlaybookEditor } from "./PlaybookEditor";
import { cn } from "@/lib/utils";

type Asset = {
  id: string;
  playbook_id: string;
  file_url: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
};

export default function Playbook() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"updated" | "newest" | "oldest" | "alpha">("updated");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Playbook | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<any>(null);

  const selected = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId]);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (selected) {
      setDraft(selected);
      setEditing(false);
      loadAssets(selected.id);
    } else {
      setDraft(null);
      setAssets([]);
    }
  }, [selectedId]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("playbooks").select("*").order("updated_at", { ascending: false });
    if (error) toast.error("Erro ao carregar playbooks", { description: error.message });
    setItems((data as Playbook[]) ?? []);
    setLoading(false);
  }

  async function loadAssets(id: string) {
    const { data } = await supabase.from("playbook_assets").select("*").eq("playbook_id", id).order("created_at", { ascending: false });
    setAssets((data as Asset[]) ?? []);
  }

  const filtered = useMemo(() => {
    let arr = [...items];
    if (filterCat !== "all") arr = arr.filter(i => i.category === filterCat);
    if (filterStatus !== "all") arr = arr.filter(i => i.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q) ||
        (i.category ?? "").toLowerCase().includes(q) ||
        JSON.stringify(i.content ?? {}).toLowerCase().includes(q)
      );
    }
    if (sortBy === "updated") arr.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (sortBy === "newest") arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sortBy === "oldest") arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sortBy === "alpha") arr.sort((a, b) => a.title.localeCompare(b.title));
    return arr;
  }, [items, filterCat, filterStatus, search, sortBy]);

  async function handleCreate(p: { title: string; description: string; category: string; status: string; owner_name: string }) {
    const { data, error } = await supabase.from("playbooks").insert({
      title: p.title,
      description: p.description || null,
      category: p.category,
      status: p.status,
      owner_name: p.owner_name || profile?.nome || null,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      last_edited_by: profile?.nome ?? null,
    }).select().single();
    if (error) { toast.error("Erro ao criar", { description: error.message }); return; }
    setItems(prev => [data as Playbook, ...prev]);
    setSelectedId(data!.id);
    setEditing(true);
    setCreateOpen(false);
    toast.success("Playbook criado");
  }

  async function persist(d: Playbook) {
    setSaveState("saving");
    const { error } = await supabase.from("playbooks").update({
      title: d.title,
      description: d.description,
      category: d.category,
      status: d.status,
      owner_name: d.owner_name,
      content: d.content,
      archived: d.archived,
      last_edited_by: profile?.nome ?? null,
    }).eq("id", d.id);
    if (error) { setSaveState("error"); toast.error("Erro ao salvar", { description: error.message }); return; }
    setSaveState("saved");
    setSavedAt(new Date().toISOString());
    setItems(prev => prev.map(i => i.id === d.id ? { ...d, updated_at: new Date().toISOString() } : i));
  }

  function updateDraft(patch: Partial<Playbook>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(next), 800);
  }

  async function handleManualSave() {
    if (!draft) return;
    await persist(draft);
    setEditing(false);
  }

  async function handleDuplicate(p: Playbook) {
    const { data, error } = await supabase.from("playbooks").insert({
      title: `${p.title} (cópia)`,
      description: p.description,
      category: p.category,
      status: "Rascunho",
      owner_name: p.owner_name,
      content: p.content,
      last_edited_by: profile?.nome ?? null,
    }).select().single();
    if (error) { toast.error("Erro ao duplicar"); return; }
    setItems(prev => [data as Playbook, ...prev]);
    setSelectedId(data!.id);
    toast.success("Playbook duplicado");
  }

  async function handleDelete() {
    if (!selected) return;
    const { error } = await supabase.from("playbooks").delete().eq("id", selected.id);
    if (error) { toast.error("Erro ao excluir"); return; }
    setItems(prev => prev.filter(i => i.id !== selected.id));
    setSelectedId(null);
    setConfirmDelete(false);
    toast.success("Playbook excluído");
  }

  async function handleSetStatus(s: string) {
    if (!draft) return;
    updateDraft({ status: s });
    toast.success(`Status alterado para "${s}"`);
  }

  async function handleArchive() {
    if (!draft) return;
    updateDraft({ archived: !draft.archived, status: !draft.archived ? "Arquivado" : draft.status });
    toast.success(draft.archived ? "Playbook desarquivado" : "Playbook arquivado");
  }

  function copyLink() {
    if (!selected) return;
    const url = `${window.location.origin}/playbook?id=${selected.id}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  }

  function exportPdf() {
    window.print();
  }

  async function uploadAttachment(file: File) {
    if (!selected) return;
    const path = `${selected.id}/attachments/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("playbook-assets").upload(path, file);
    if (error) { toast.error("Erro no upload"); return; }
    const { data } = supabase.storage.from("playbook-assets").getPublicUrl(path);
    const { data: row, error: err2 } = await supabase.from("playbook_assets").insert({
      playbook_id: selected.id,
      file_url: data.publicUrl,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
    }).select().single();
    if (err2) { toast.error("Erro ao registrar anexo"); return; }
    setAssets(prev => [row as Asset, ...prev]);
    toast.success("Anexo adicionado");
  }

  async function deleteAsset(a: Asset) {
    await supabase.from("playbook_assets").delete().eq("id", a.id);
    setAssets(prev => prev.filter(x => x.id !== a.id));
  }

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Header */}
      <div className="border-b bg-background/80 backdrop-blur-sm px-6 pt-4 pb-3">
        {/* Breadcrumb */}
        <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-[12px] text-muted-foreground mb-2">
          <Home className="h-3.5 w-3.5" />
          <span>Início</span>
          <ChevronRight className="h-3 w-3 opacity-60" />
          <span className={cn(selected ? "" : "text-foreground font-medium")}>Playbook</span>
          {selected && (
            <>
              <ChevronRight className="h-3 w-3 opacity-60" />
              <span className="text-foreground font-medium truncate max-w-[420px]">{selected.title}</span>
            </>
          )}
        </nav>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[22px] font-semibold tracking-tight leading-none">Playbook Financeiro</h1>
              <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-secondary text-secondary-foreground text-[11px] font-medium tabular-nums">
                {items.length} {items.length === 1 ? "documento" : "documentos"}
              </span>
            </div>
            <p className="text-[12.5px] text-muted-foreground mt-1.5 max-w-2xl">
              Central de documentação financeira: processos, rotinas, checklists e instruções de onboarding em um só lugar.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setSidebarOpen(o => !o)}
              title={sidebarOpen ? "Recolher lista" : "Expandir lista"}
            >
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              {sidebarOpen ? "Recolher" : "Expandir"}
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="h-9 gap-2">
              <Plus className="h-4 w-4" /> Novo playbook
            </Button>
          </div>
        </div>

        {/* Counter stats (status filters) */}
        <div className="flex items-center gap-5 mt-3 flex-wrap">
          {([
            { key: "all", label: "documentos", num: "text-foreground" },
            { key: "Publicado", label: "publicados", num: "text-emerald-600" },
            { key: "Em revisão", label: "em revisão", num: "text-amber-600" },
            { key: "Rascunho", label: "rascunhos", num: "text-foreground" },
          ] as const).map(c => {
            const count = c.key === "all" ? items.length : items.filter(i => i.status === c.key).length;
            const active = filterStatus === c.key;
            return (
              <button key={c.key}
                onClick={() => setFilterStatus(c.key)}
                className={cn(
                  "inline-flex items-baseline gap-1.5 text-[13px] transition-colors",
                  active ? "opacity-100" : "opacity-80 hover:opacity-100"
                )}>
                <span className={cn("text-[16px] font-bold tabular-nums leading-none", c.num)}>{count}</span>
                <span className={cn("text-muted-foreground", active && "underline underline-offset-4 decoration-2 decoration-foreground/40")}>{c.label}</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="relative w-[300px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar processo, rotina ou palavra-chave..."
                className="pl-8 h-9 bg-background"
              />
            </div>
            <Select value={filterCat} onValueChange={setFilterCat}>
              <SelectTrigger className="h-9 w-[170px] bg-background"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                {PLAYBOOK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
              <SelectTrigger className="h-9 w-[170px] bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">Última atualização</SelectItem>
                <SelectItem value="newest">Mais recentes</SelectItem>
                <SelectItem value="oldest">Mais antigos</SelectItem>
                <SelectItem value="alpha">Ordem alfabética</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        className={cn(
          "flex-1 grid grid-cols-1 overflow-hidden transition-[grid-template-columns] duration-300 ease-out",
          sidebarOpen ? "lg:grid-cols-[320px_1fr]" : "lg:grid-cols-[0px_1fr]"
        )}
      >
        {/* List */}
        <aside
          className={cn(
            "border-r overflow-hidden bg-background/60 transition-all duration-300",
            sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <div className="h-full overflow-y-auto px-2.5 py-3">
            {loading ? (
              <div className="px-3 py-6 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <BookOpenCheck className="h-6 w-6 text-muted-foreground/60 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum playbook encontrado</p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map(p => {
                  const active = selectedId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => setSelectedId(p.id)}
                        className={cn(
                          "group w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150 relative",
                          active
                            ? "bg-background shadow-sm ring-1 ring-border"
                            : "hover:bg-background/80"
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary" />
                        )}
                        <div className="font-medium text-[13px] leading-snug truncate text-foreground">{p.title}</div>
                        {p.description && (
                          <div className="text-[11.5px] leading-relaxed text-muted-foreground line-clamp-2 mt-1">
                            {p.description}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span className="inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-medium text-muted-foreground bg-muted">
                            {p.category}
                          </span>
                          <span className={cn(
                            "inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-medium border",
                            STATUS_STYLES[p.status] ?? ""
                          )}>
                            {p.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-[10.5px] text-muted-foreground/80">
                          <span className="truncate">{p.owner_name ?? "—"}</span>
                          <span className="shrink-0 tabular-nums">{new Date(p.updated_at).toLocaleDateString("pt-BR")}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Detail */}
        <section className="overflow-y-auto bg-muted/30">
          {!draft ? (
            <PlaybookLanding
              items={items}
              onCreate={() => setCreateOpen(true)}
              onSelectCategory={(c) => { setFilterCat(c); setFilterStatus("all"); }}
              onOpen={(id) => setSelectedId(id)}
            />
          ) : (
            <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
              {/* Toolbar */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 h-6 px-2 rounded-full border text-[10.5px] font-semibold uppercase tracking-wider",
                    editing
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted text-muted-foreground border-border"
                  )}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", editing ? "bg-primary animate-pulse" : "bg-muted-foreground/50")} />
                    {editing ? "Editando" : "Leitura"}
                  </span>
                  {saveState === "saving" && <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Salvando...</span>}
                  {saveState === "saved" && <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Salvo</span>}
                  {saveState === "error" && <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> Erro ao salvar</span>}
                  {savedAt && saveState !== "saving" && (
                    <span className="text-muted-foreground/80">· {new Date(savedAt).toLocaleTimeString("pt-BR")}</span>
                  )}
                  {draft.last_edited_by && <span className="text-muted-foreground/80">por {draft.last_edited_by}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setDraft(selected); setEditing(false); }}>
                        <X className="h-3.5 w-3.5" /> Cancelar
                      </Button>
                      <Button size="sm" onClick={handleManualSave}>
                        <Save className="h-3.5 w-3.5" /> Salvar alterações
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                        <Edit3 className="h-3.5 w-3.5" /> Editar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleDuplicate(draft)}>
                        <Copy className="h-3.5 w-3.5" /> Duplicar
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline"><MoreHorizontal className="h-3.5 w-3.5" /> Mais ações</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onClick={() => handleSetStatus("Publicado")}><CheckCircle2 className="h-4 w-4" /> Marcar como publicado</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleSetStatus("Desatualizado")}><AlertTriangle className="h-4 w-4" /> Marcar como desatualizado</DropdownMenuItem>
                          <DropdownMenuItem onClick={handleArchive}><Archive className="h-4 w-4" /> {draft.archived ? "Desarquivar" : "Arquivar"}</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={copyLink}><LinkIcon className="h-4 w-4" /> Copiar link</DropdownMenuItem>
                          <DropdownMenuItem onClick={exportPdf}><FileText className="h-4 w-4" /> Exportar como PDF</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmDelete(true)}>
                            <Trash2 className="h-4 w-4" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </div>

              {/* Document — paper surface with header + editor unified */}
              <div
                className={cn(
                  "rounded-xl border bg-card transition-shadow duration-300",
                  editing ? "shadow-lg ring-1 ring-primary/15" : "shadow-sm hover:shadow-md"
                )}
              >
                {/* Doc header */}
                <div className="px-10 pt-10 pb-6 border-b">
                  {editing ? (
                    <Input
                      value={draft.title}
                      onChange={e => updateDraft({ title: e.target.value })}
                      className="text-[34px] font-bold tracking-tight border-0 px-0 focus-visible:ring-0 h-auto py-1 placeholder:text-muted-foreground/40"
                      placeholder="Sem título"
                    />
                  ) : (
                    <h2 className="text-[34px] font-bold tracking-tight leading-tight">{draft.title}</h2>
                  )}
                  {editing ? (
                    <Textarea
                      value={draft.description ?? ""}
                      onChange={e => updateDraft({ description: e.target.value })}
                      className="border-0 px-0 mt-2 resize-none focus-visible:ring-0 text-[15px] leading-relaxed text-muted-foreground placeholder:text-muted-foreground/50"
                      placeholder="Adicione uma breve descrição..."
                      rows={2}
                    />
                  ) : (
                    draft.description && <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{draft.description}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap mt-5">
                    {editing ? (
                      <>
                        <Select value={draft.category} onValueChange={v => updateDraft({ category: v })}>
                          <SelectTrigger className="h-8 w-[200px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{PLAYBOOK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={draft.status} onValueChange={v => updateDraft({ status: v })}>
                          <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{PLAYBOOK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input
                          value={draft.owner_name ?? ""}
                          onChange={e => updateDraft({ owner_name: e.target.value })}
                          className="h-8 w-[200px]"
                          placeholder="Responsável"
                        />
                      </>
                    ) : (
                      <>
                        <Badge variant="outline" className="font-normal">{draft.category}</Badge>
                        <Badge className={cn("border font-normal", STATUS_STYLES[draft.status] ?? "")} variant="outline">{draft.status}</Badge>
                        <span className="text-[12px] text-muted-foreground">Responsável: <strong className="text-foreground font-medium">{draft.owner_name ?? "—"}</strong></span>
                        <span className="text-[12px] text-muted-foreground ml-auto">Atualizado em {new Date(draft.updated_at).toLocaleString("pt-BR")}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Editor body — generous paper-like padding */}
                <div className="px-10 py-8 min-h-[60vh]">
                  <PlaybookEditor
                    value={draft.content}
                    onChange={(v) => updateDraft({ content: v })}
                    editable={editing}
                    playbookId={draft.id}
                  />
                </div>
              </div>

              {/* Anexos */}
              <Card className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Anexos do playbook</h3>
                    <span className="text-xs text-muted-foreground">({assets.length})</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Adicionar anexo
                  </Button>
                  <input
                    ref={fileRef} type="file" hidden
                    accept=".pdf,.xlsx,.csv,.docx,.png,.jpg,.jpeg"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.target.value = ""; }}
                  />
                </div>
                {assets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum anexo. Adicione PDFs, planilhas ou imagens relacionadas.</p>
                ) : (
                  <ul className="divide-y">
                    {assets.map(a => (
                      <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <a href={a.file_url} target="_blank" rel="noreferrer" className="flex-1 truncate hover:underline">{a.file_name}</a>
                        <span className="text-xs text-muted-foreground">{a.file_size ? `${(a.file_size / 1024).toFixed(1)} KB` : ""}</span>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => deleteAsset(a)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </section>
      </div>

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} defaultOwner={profile?.nome ?? ""} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir playbook?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este playbook? Essa ação não poderá ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState(_: { onCreate: () => void }) { return null as any; }

const CATEGORY_TINTS: Record<string, { bar: string; chip: string; letter: string }> = {
  "Conta corrente":      { bar: "bg-cyan-500",    chip: "bg-cyan-100 text-cyan-800",       letter: "C" },
  "Cartão de crédito":   { bar: "bg-pink-500",    chip: "bg-pink-100 text-pink-800",       letter: "C" },
  "Editais":             { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800", letter: "E" },
  "Fechamento mensal":   { bar: "bg-violet-500",  chip: "bg-violet-100 text-violet-800",   letter: "F" },
  "Importação para Omie":{ bar: "bg-amber-500",   chip: "bg-amber-100 text-amber-800",     letter: "I" },
  "Conciliação bancária":{ bar: "bg-teal-500",    chip: "bg-teal-100 text-teal-800",       letter: "C" },
  "Comissões":           { bar: "bg-rose-500",    chip: "bg-rose-100 text-rose-800",       letter: "C" },
  "Reembolsos":          { bar: "bg-orange-500",  chip: "bg-orange-100 text-orange-800",   letter: "R" },
  "Pagamentos":          { bar: "bg-sky-500",     chip: "bg-sky-100 text-sky-800",         letter: "P" },
  "Rotinas internas":    { bar: "bg-indigo-500",  chip: "bg-indigo-100 text-indigo-800",   letter: "R" },
};

const SUGGESTED_TEMPLATES = [
  { icon: "🧾", title: "Conciliação bancária", desc: "Checklist de batimento entre extrato e ERP.", category: "Conta corrente",     steps: "8 etapas · 20 min" },
  { icon: "📊", title: "DRE mensal",            desc: "Estrutura para apuração de resultado.",       category: "Fechamento mensal",  steps: "14 etapas · 1 h" },
  { icon: "💧", title: "Fluxo de caixa diário", desc: "Rotina de atualização do fluxo.",             category: "Conta corrente",     steps: "6 etapas · 10 min" },
  { icon: "🧮", title: "Apuração de DARFs",     desc: "Cálculo e geração de DARFs mensais.",         category: "Pagamentos",         steps: "11 etapas · 45 min" },
];

const TEAM_SUGGESTIONS = [
  { who: "HM", name: "Henrique", verb: "sugere documentar", what: "Pagamento de fornecedores", category: "Conta corrente" },
  { who: "RC", name: "Rafael",   verb: "sugere documentar", what: "Devoluções e estornos",      category: "Cartão de crédito" },
  { who: "JR", name: "Você",     verb: "não documentou ainda", what: "Provisões mensais",      category: "Fechamento mensal" },
];

function PlaybookLanding({
  items, onCreate, onSelectCategory, onOpen,
}: {
  items: Playbook[];
  onCreate: () => void;
  onSelectCategory: (c: string) => void;
  onOpen: (id: string) => void;
}) {
  const recent = [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  const categoriesWithCount = PLAYBOOK_CATEGORIES.map(c => ({
    name: c,
    count: items.filter(i => i.category === c).length,
    docs: items.filter(i => i.category === c).slice(0, 1),
  }));

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-7">
      {/* Categories grid */}
      <section>
        <div className="flex items-baseline gap-2 mb-3">
          <h3 className="text-[14px] font-semibold tracking-tight">Explore por categoria</h3>
          <span className="text-[11.5px] text-muted-foreground">clique para filtrar a lista abaixo</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {categoriesWithCount.map(c => {
            const tint = CATEGORY_TINTS[c.name] ?? { bar: "bg-zinc-400", chip: "bg-zinc-100 text-zinc-800", letter: c.name[0] };
            const empty = c.count === 0;
            return (
              <button key={c.name} onClick={() => empty ? onCreate() : onSelectCategory(c.name)}
                className="group relative text-left rounded-xl border bg-card overflow-hidden hover:shadow-md hover:border-foreground/20 transition-all">
                <div className={cn("h-1 w-full", tint.bar)} />
                <div className="p-3.5">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-7 w-7 grid place-items-center rounded-md text-[12px] font-bold", tint.chip)}>{tint.letter}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {empty ? "sem docs" : `${c.count} ${c.count === 1 ? "doc" : "docs"}`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 min-h-[18px]">
                    {empty ? (
                      <span className="text-[11.5px] text-primary font-medium">+ Documentar</span>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground truncate">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", tint.bar)} />
                        <span className="truncate">{c.docs[0]?.title}</span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Hero CTA */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-orange-50 to-rose-50 p-5 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-12 w-12 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0 shadow-sm font-bold text-lg">T</div>
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold tracking-tight">Selecione um playbook ou comece um novo</h3>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">Abra um documento na lista ao lado para visualizar, ou parta de um template pronto abaixo.</p>
          </div>
        </div>
        <Button size="lg" className="gap-2 shrink-0" onClick={onCreate}><Plus className="h-4 w-4"/> Criar novo</Button>
      </div>

      {/* Templates */}
      <section>
        <div className="flex items-baseline gap-2 mb-3">
          <h3 className="text-[14px] font-semibold tracking-tight">Templates sugeridos para o financeiro</h3>
          <span className="text-[11.5px] text-muted-foreground">processos que costumam vir primeiro</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SUGGESTED_TEMPLATES.map(t => {
            const tint = CATEGORY_TINTS[t.category] ?? CATEGORY_TINTS["Conta corrente"];
            return (
              <button key={t.title} onClick={onCreate}
                className="group text-left rounded-xl border bg-card p-4 hover:shadow-md hover:border-foreground/20 transition-all flex items-start gap-3">
                <div className={cn("h-9 w-9 rounded-lg grid place-items-center text-lg shrink-0", tint.chip)}>{t.icon}</div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-[13.5px] font-semibold leading-snug">{t.title}</h4>
                  <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-1">{t.desc}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="inline-flex items-center gap-1 text-[10.5px]">
                      <span className={cn("h-1.5 w-1.5 rounded-full", tint.bar)} />
                      <span className="text-muted-foreground">{t.category}</span>
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">· {t.steps}</span>
                  </div>
                </div>
                <span className="text-[11.5px] text-primary font-medium shrink-0 group-hover:gap-1.5 transition-all">Usar →</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Team suggestions */}
      <section>
        <div className="flex items-baseline gap-2 mb-3">
          <h3 className="text-[14px] font-semibold tracking-tight">Sugestões do time</h3>
        </div>
        <div className="rounded-xl border bg-card divide-y">
          {TEAM_SUGGESTIONS.map((s, i) => {
            const tint = CATEGORY_TINTS[s.category] ?? CATEGORY_TINTS["Conta corrente"];
            return (
              <div key={i} className="flex items-center gap-3 p-3">
                <div className="h-7 w-7 rounded-full bg-muted grid place-items-center text-[10.5px] font-semibold shrink-0">{s.who}</div>
                <div className="flex-1 min-w-0 text-[13px]">
                  <strong className="font-semibold">{s.name}</strong>{" "}
                  <span className="text-muted-foreground">{s.verb}</span>{" "}
                  <strong className="font-semibold">{s.what}</strong>
                </div>
                <span className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10.5px] font-medium", tint.chip)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", tint.bar)} />
                  {s.category}
                </span>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11.5px]" onClick={onCreate}>
                  Iniciar <ChevronRight className="h-3 w-3"/>
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <div className="flex items-baseline gap-2 mb-3">
            <h3 className="text-[14px] font-semibold tracking-tight">Recentes</h3>
            <span className="text-[11.5px] text-muted-foreground">últimos editados</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {recent.slice(0, 3).map(p => {
              const tint = CATEGORY_TINTS[p.category] ?? CATEGORY_TINTS["Conta corrente"];
              return (
                <button key={p.id} onClick={() => onOpen(p.id)}
                  className="text-left rounded-xl border bg-card p-3.5 hover:shadow-md hover:border-foreground/20 transition-all">
                  <span className={cn("inline-flex items-center gap-1 h-5 px-2 rounded-md text-[10.5px] font-medium", tint.chip)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", tint.bar)} />
                    {p.category}
                  </span>
                  <h4 className="text-[13.5px] font-semibold mt-1.5 line-clamp-1">{p.title}</h4>
                  {p.description && <p className="text-[11.5px] text-muted-foreground line-clamp-2 mt-0.5">{p.description}</p>}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function CreateDialog({
  open, onOpenChange, onCreate, defaultOwner,
}: {
  open: boolean; onOpenChange: (b: boolean) => void;
  onCreate: (p: { title: string; description: string; category: string; status: string; owner_name: string }) => void;
  defaultOwner: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(PLAYBOOK_CATEGORIES[0]);
  const [status, setStatus] = useState<string>("Rascunho");
  const [owner, setOwner] = useState(defaultOwner);

  useEffect(() => { if (open) { setTitle(""); setDescription(""); setCategory(PLAYBOOK_CATEGORIES[0]); setStatus("Rascunho"); setOwner(defaultOwner); } }, [open, defaultOwner]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Novo playbook</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Título</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Conciliação bancária mensal" />
          </div>
          <div>
            <Label className="text-xs">Descrição curta</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Resumo do processo" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PLAYBOOK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PLAYBOOK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Responsável</Label>
            <Input value={owner} onChange={e => setOwner(e.target.value)} placeholder="Nome do responsável" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!title.trim()} onClick={() => onCreate({ title: title.trim(), description, category, status, owner_name: owner })}>
            Criar playbook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
