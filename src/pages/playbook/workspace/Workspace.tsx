import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Plus, Search, Star, Archive, Trash2, Copy, ChevronRight, ChevronDown, ChevronUp,
  FileText, Loader2, Image as ImageIcon, MoreHorizontal, Clock, Sparkles, X,
  CheckCircle2, AlertTriangle, Tag, Pencil, Users, Share2, ChevronsUpDown,
  Folder, FolderOpen, Home, ArrowLeft,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WorkspaceEditor } from "./WorkspaceEditor";

export type WorkspacePage = {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  cover_url: string | null;
  content: any;
  tags: string[];
  is_favorite: boolean;
  archived: boolean;
  position: number;
  created_by: string | null;
  created_by_name: string | null;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
};

const EMOJI_PRESET = ["📄","📝","📊","📈","💡","🚀","🎯","🔥","⭐","✅","📌","🗂️","💰","🏦","📅","🧠","🔍","⚡","🎨","🛠️"];

// Folder color dots (Notion-like)
const FOLDER_DOTS: Record<string, string> = {
  reunioes: "bg-violet-500",
  estudos: "bg-sky-500",
  ideias: "bg-amber-500",
  pessoais: "bg-red-500",
  default: "bg-emerald-500",
};

function dotFor(title: string) {
  const t = title.toLowerCase();
  if (t.includes("reuni")) return FOLDER_DOTS.reunioes;
  if (t.includes("estud")) return FOLDER_DOTS.estudos;
  if (t.includes("ideia") || t.includes("rascunh")) return FOLDER_DOTS.ideias;
  if (t.includes("pessoa")) return FOLDER_DOTS.pessoais;
  return FOLDER_DOTS.default;
}

export default function Workspace() {
  const { user, profile } = useAuth();
  const [pages, setPages] = useState<WorkspacePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkspacePage | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"all" | "favorites" | "recents" | "archive">("all");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const debounceRef = useRef<any>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const p = pages.find(p => p.id === selectedId) ?? null;
    setDraft(p);
  }, [selectedId, pages]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("workspace_pages").select("*").order("position").order("updated_at", { ascending: false });
    if (error) toast.error("Erro ao carregar", { description: error.message });
    setPages((data as WorkspacePage[]) ?? []);
    setLoading(false);
  }

  async function createPage(parent_id: string | null = null, opts?: { title?: string; icon?: string; content?: any }) {
    const { data, error } = await supabase.from("workspace_pages").insert({
      parent_id,
      title: opts?.title ?? "Sem título",
      icon: opts?.icon ?? "📄",
      content: opts?.content ?? { type: "doc", content: [{ type: "paragraph" }] },
      created_by: user?.id ?? null,
      created_by_name: profile?.nome ?? null,
      last_edited_by: profile?.nome ?? null,
    }).select().single();
    if (error) { toast.error("Erro ao criar página"); return; }
    setPages(prev => [...prev, data as WorkspacePage]);
    if (parent_id) setExpanded(prev => new Set(prev).add(parent_id));
    setSelectedId(data!.id);
    toast.success("Página criada");
  }

  async function createFolder() {
    const name = prompt("Nome da pasta:");
    if (!name?.trim()) return;
    await createPage(null, { title: name.trim(), icon: "📁" });
  }

  function createFromTemplate(key: string) {
    const tpl = TEMPLATES.find(t => t.key === key);
    createPage(null, {
      title: tpl?.title ?? "Sem título",
      icon: tpl?.icon ?? "📄",
      content: TEMPLATE_CONTENT[key] ?? { type: "doc", content: [{ type: "paragraph" }] },
    });
  }

  async function persist(p: WorkspacePage) {
    setSaveState("saving");
    const { error } = await supabase.from("workspace_pages").update({
      title: p.title, icon: p.icon, cover_url: p.cover_url, content: p.content,
      tags: p.tags, is_favorite: p.is_favorite, archived: p.archived,
      last_edited_by: profile?.nome ?? null,
    }).eq("id", p.id);
    if (error) { setSaveState("error"); return; }
    setSaveState("saved");
    setPages(prev => prev.map(x => x.id === p.id ? { ...p, updated_at: new Date().toISOString() } : x));
    setTimeout(() => setSaveState("idle"), 1500);
  }

  function update(patch: Partial<WorkspacePage>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(next), 700);
  }

  async function duplicate(p: WorkspacePage) {
    const { data, error } = await supabase.from("workspace_pages").insert({
      parent_id: p.parent_id, title: `${p.title} (cópia)`, icon: p.icon,
      cover_url: p.cover_url, content: p.content, tags: p.tags,
      created_by: user?.id ?? null, created_by_name: profile?.nome ?? null,
    }).select().single();
    if (error) { toast.error("Erro ao duplicar"); return; }
    setPages(prev => [...prev, data as WorkspacePage]);
    toast.success("Página duplicada");
  }

  async function toggleFavorite(p: WorkspacePage) {
    const next = !p.is_favorite;
    await supabase.from("workspace_pages").update({ is_favorite: next }).eq("id", p.id);
    setPages(prev => prev.map(x => x.id === p.id ? { ...x, is_favorite: next } : x));
  }

  async function toggleArchive(p: WorkspacePage) {
    const next = !p.archived;
    await supabase.from("workspace_pages").update({ archived: next }).eq("id", p.id);
    setPages(prev => prev.map(x => x.id === p.id ? { ...x, archived: next } : x));
    toast.success(next ? "Arquivada" : "Restaurada");
  }

  async function remove(p: WorkspacePage) {
    await supabase.from("workspace_pages").delete().eq("id", p.id);
    setPages(prev => prev.filter(x => x.id !== p.id && x.parent_id !== p.id));
    if (selectedId === p.id) setSelectedId(null);
    setConfirmDelete(false);
    toast.success("Excluída");
  }

  async function uploadCover(file: File) {
    if (!draft) return;
    const path = `${draft.id}/cover-${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("workspace-assets").upload(path, file, { upsert: true });
    if (error) { toast.error("Erro upload capa"); return; }
    const { data } = supabase.storage.from("workspace-assets").getPublicUrl(path);
    update({ cover_url: data.publicUrl });
  }

  function addTag() {
    if (!draft || !tagInput.trim()) return;
    const t = tagInput.trim().toLowerCase();
    if (draft.tags.includes(t)) { setTagInput(""); return; }
    update({ tags: [...draft.tags, t] });
    setTagInput("");
  }

  function removeTag(t: string) {
    if (!draft) return;
    update({ tags: draft.tags.filter(x => x !== t) });
  }

  // Tree filtering
  const visiblePages = useMemo(() => {
    let arr = pages.filter(p => !p.archived);
    if (view === "favorites") arr = arr.filter(p => p.is_favorite);
    if (view === "archive") arr = pages.filter(p => p.archived);
    if (view === "recents") {
      arr = [...arr].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 15);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(p => p.title.toLowerCase().includes(q) || JSON.stringify(p.content).toLowerCase().includes(q));
    }
    return arr;
  }, [pages, view, search]);

  const folderCount = useMemo(() => pages.filter(p => !p.archived && pages.some(c => c.parent_id === p.id)).length, [pages]);
  const totalPages = useMemo(() => pages.filter(p => !p.archived).length, [pages]);

  const renderTree = (parent: string | null, depth = 0): React.ReactNode => {
    const children = visiblePages.filter(p => p.parent_id === parent);
    if (children.length === 0) return null;
    return (
      <ul>
        {children.map(p => {
          const subs = pages.filter(c => c.parent_id === p.id);
          const hasChildren = subs.length > 0;
          const isExpanded = depth === 0 ? !collapsedRoots.has(p.id) : expanded.has(p.id);
          const active = selectedId === p.id;
          return (
            <li key={p.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-md py-[5px] pr-1 transition-colors",
                  active ? "bg-accent" : "hover:bg-accent/60"
                )}
                style={{ paddingLeft: 6 + depth * 14 }}
              >
                <button
                  className="h-4 w-4 grid place-items-center text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => {
                    if (!hasChildren) return;
                    if (depth === 0) {
                      setCollapsedRoots(prev => {
                        const n = new Set(prev);
                        n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                        return n;
                      });
                    } else {
                      setExpanded(prev => {
                        const n = new Set(prev);
                        n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                        return n;
                      });
                    }
                  }}
                >
                  {hasChildren ? (isExpanded ? <ChevronDown className="h-3 w-3"/> : <ChevronRight className="h-3 w-3"/>) : <span className="block h-1 w-1 rounded-full bg-muted-foreground/40" />}
                </button>
                <button onClick={() => setSelectedId(p.id)} className="flex-1 flex items-center gap-1.5 min-w-0 text-left">
                  {depth === 0 && hasChildren ? (
                    <span className={cn("h-2 w-2 rounded-full shrink-0", dotFor(p.title))} />
                  ) : (
                    <span className="text-[13px] leading-none shrink-0">{p.icon || "📄"}</span>
                  )}
                  <span className={cn("truncate text-[13px]", depth === 0 && hasChildren && "font-medium")}>
                    {p.title || "Sem título"}
                  </span>
                  {p.is_favorite && <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />}
                </button>
                {depth === 0 && hasChildren && (
                  <span className="text-[10.5px] text-muted-foreground tabular-nums px-1">{subs.length}</span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="opacity-0 group-hover:opacity-100 h-5 w-5 grid place-items-center rounded hover:bg-background">
                      <MoreHorizontal className="h-3 w-3"/>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => createPage(p.id)}><Plus className="h-3.5 w-3.5"/> Subpágina</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleFavorite(p)}><Star className="h-3.5 w-3.5"/> {p.is_favorite ? "Remover favorito" : "Favoritar"}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => duplicate(p)}><Copy className="h-3.5 w-3.5"/> Duplicar</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleArchive(p)}><Archive className="h-3.5 w-3.5"/> {p.archived ? "Restaurar" : "Arquivar"}</DropdownMenuItem>
                    <DropdownMenuSeparator/>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { setSelectedId(p.id); setConfirmDelete(true); }}>
                      <Trash2 className="h-3.5 w-3.5"/> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  className="opacity-0 group-hover:opacity-100 h-5 w-5 grid place-items-center rounded hover:bg-background"
                  onClick={() => createPage(p.id)}
                  title="Adicionar subpágina"
                >
                  <Plus className="h-3 w-3"/>
                </button>
              </div>
              {hasChildren && isExpanded && renderTree(p.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Top header bar (breadcrumb + title + actions) */}
      <header className="border-b bg-background px-8 pt-3 pb-3">
        <div className="max-w-[1400px] mx-auto">
          {headerCollapsed ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Home className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <ChevronRight className="h-3 w-3 opacity-60 shrink-0" />
                <h1 className="text-[15px] font-semibold tracking-tight truncate">Workspace</h1>
                {draft && (
                  <>
                    <ChevronRight className="h-3 w-3 opacity-60 shrink-0" />
                    <span className="text-[13px] text-muted-foreground truncate">{draft.title || "Sem título"}</span>
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-[12px]"
                onClick={() => setHeaderCollapsed(false)}
                title="Expandir cabeçalho"
              >
                <ChevronDown className="h-3.5 w-3.5" /> Expandir
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground mb-1.5">
                <Home className="h-3 w-3" />
                <span>Início</span>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground">Workspace</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-[26px] font-bold tracking-tight">Workspace</h1>
                  <p className="text-[13px] text-muted-foreground mt-0.5 max-w-2xl">
                    Seu bloco de anotações privado: reuniões, estudos, ideias e rascunhos. Quando um rascunho amadurecer, vire um <strong className="text-foreground font-semibold">Playbook</strong>.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => setHeaderCollapsed(true)}
                    title="Recolher cabeçalho"
                  >
                    <ChevronUp className="h-4 w-4" /> Recolher topo
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 gap-2">
                    <Share2 className="h-3.5 w-3.5"/> Compartilhadas
                  </Button>
                  <Button size="sm" className="h-9 gap-2 bg-red-600 hover:bg-red-700 text-white shadow-sm" onClick={() => createPage(null)}>
                    <Plus className="h-3.5 w-3.5"/> Nova página
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </header>


      {/* Main split area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-[300px] border-r bg-background/70 flex flex-col">
          <div className="p-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar páginas..."
                className="pl-8 pr-12 h-8 text-[13px] bg-muted/40 border-muted"
              />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono px-1.5 py-0.5 rounded border bg-background">⌘K</kbd>
            </div>
            <div className="flex items-center gap-1">
              <ViewBtn active={view === "all"} onClick={() => setView("all")}>Todas</ViewBtn>
              <ViewBtn active={view === "favorites"} onClick={() => setView("favorites")}><Star className="h-3 w-3"/></ViewBtn>
              <ViewBtn active={view === "recents"} onClick={() => setView("recents")}><Clock className="h-3 w-3"/></ViewBtn>
              <ViewBtn active={view === "archive"} onClick={() => setView("archive")}><Trash2 className="h-3 w-3"/></ViewBtn>
              <button className="ml-auto h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent">
                <ChevronsUpDown className="h-3 w-3"/>
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {loading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2 p-2"><Loader2 className="h-3 w-3 animate-spin"/> Carregando...</div>
            ) : visiblePages.length === 0 ? (
              <div className="text-center py-10 text-xs text-muted-foreground">
                <FileText className="h-6 w-6 mx-auto mb-2 opacity-40"/>
                Nenhuma página
              </div>
            ) : (
              renderTree(null)
            )}
            <button
              onClick={createFolder}
              className="mt-2 w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors border border-dashed border-transparent hover:border-border"
            >
              <Plus className="h-3 w-3"/> Nova pasta
            </button>
          </div>
          <div className="px-3 py-2.5 border-t flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>{totalPages} páginas · {folderCount} pastas</span>
            <span>vinculadas: 0 playbooks</span>
          </div>
        </aside>

        {/* Editor / Landing */}
        <section
          className="flex-1 overflow-y-auto bg-background"
          onScroll={(e) => {
            const top = (e.target as HTMLElement).scrollTop;
            if (top > 60 && !headerCollapsed) setHeaderCollapsed(true);
            else if (top < 8 && headerCollapsed) setHeaderCollapsed(false);
          }}
        >
          {!draft ? (
            <WorkspaceLanding
              userName={profile?.nome ?? "você"}
              recents={[...pages].filter(p => !p.archived).sort((a,b) => b.updated_at.localeCompare(a.updated_at))}
              onCreate={() => createPage(null)}
              onOpen={(id) => setSelectedId(id)}
              onUseTemplate={(k) => createFromTemplate(k)}
            />
          ) : (
            <div className="max-w-3xl mx-auto px-12 pt-0 pb-20">
              {draft.cover_url ? (
                <div className="relative -mx-12 h-48 group">
                  <img src={draft.cover_url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="secondary" onClick={() => coverRef.current?.click()}><ImageIcon className="h-3.5 w-3.5"/> Trocar capa</Button>
                    <Button size="sm" variant="secondary" onClick={() => update({ cover_url: null })}><X className="h-3.5 w-3.5"/></Button>
                  </div>
                </div>
              ) : null}
              <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCover(f); e.target.value = ""; }} />

              <div className={cn("pt-10", draft.cover_url && "pt-6")}>
                <div className="flex items-center justify-between gap-2 mb-3 text-[11.5px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" className="h-7 text-[11.5px] gap-1 -ml-2" onClick={() => setSelectedId(null)}>
                      <ArrowLeft className="h-3.5 w-3.5"/> Voltar
                    </Button>
                    {saveState === "saving" && <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin"/> Salvando...</span>}
                    {saveState === "saved" && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3"/> Salvo</span>}
                    {saveState === "error" && <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3"/> Erro</span>}
                    {draft.last_edited_by && <span>· por {draft.last_edited_by}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {!draft.cover_url && (
                      <Button size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={() => coverRef.current?.click()}>
                        <ImageIcon className="h-3 w-3"/> Capa
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={() => toggleFavorite(draft)}>
                      <Star className={cn("h-3 w-3", draft.is_favorite && "fill-amber-500 text-amber-500")}/>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7"><MoreHorizontal className="h-3 w-3"/></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => createPage(draft.id)}><Plus className="h-3.5 w-3.5"/> Subpágina</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicate(draft)}><Copy className="h-3.5 w-3.5"/> Duplicar</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleArchive(draft)}><Archive className="h-3.5 w-3.5"/> {draft.archived ? "Restaurar" : "Arquivar"}</DropdownMenuItem>
                        <DropdownMenuSeparator/>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmDelete(true)}>
                          <Trash2 className="h-3.5 w-3.5"/> Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-[64px] leading-none hover:bg-accent rounded-lg p-1 -ml-1 transition-colors">{draft.icon || "📄"}</button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[280px] p-3" align="start">
                      <div className="grid grid-cols-8 gap-1">
                        {EMOJI_PRESET.map(e => (
                          <button key={e} onClick={() => update({ icon: e })} className="h-8 w-8 grid place-items-center rounded hover:bg-accent text-lg">{e}</button>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t">
                        <Input placeholder="Cole um emoji..." onChange={(e) => { if (e.target.value) { update({ icon: e.target.value }); } }} className="h-8 text-sm"/>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Input
                    value={draft.title}
                    onChange={(e) => update({ title: e.target.value })}
                    placeholder="Sem título"
                    className="!text-[56px] md:!text-[56px] font-bold tracking-tight leading-tight border-0 px-0 focus-visible:ring-0 h-auto py-1 placeholder:text-muted-foreground/40 bg-transparent"
                  />
                </div>

                <div className="flex items-center gap-1.5 flex-wrap mt-3 ml-1">
                  <Tag className="h-3 w-3 text-muted-foreground"/>
                  {draft.tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-muted text-[11px]">
                      {t}
                      <button onClick={() => removeTag(t)} className="hover:text-destructive"><X className="h-2.5 w-2.5"/></button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    placeholder="Adicionar tag..."
                    className="h-6 px-2 text-[11px] bg-transparent border-0 outline-none focus:ring-0 placeholder:text-muted-foreground/50 w-32"
                  />
                  <span className="ml-auto text-[10.5px] text-muted-foreground">
                    Atualizado em {new Date(draft.updated_at).toLocaleString("pt-BR")}
                  </span>
                </div>
              </div>

              <div className="mt-6">
                <WorkspaceEditor
                  key={draft.id}
                  value={draft.content}
                  onChange={(v) => update({ content: v })}
                  pageId={draft.id}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir página?</AlertDialogTitle>
            <AlertDialogDescription>Subpáginas também serão removidas. Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => draft && remove(draft)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ViewBtn({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 px-2.5 inline-flex items-center justify-center gap-1 rounded-md text-[11.5px] font-medium transition-colors",
        active ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "text-muted-foreground hover:bg-accent/60"
      )}
    >{children}</button>
  );
}

type LandingProps = {
  userName: string;
  recents: WorkspacePage[];
  onCreate: () => void;
  onOpen: (id: string) => void;
};

const TEMPLATES = [
  { key: "reuniao",     icon: "👥", title: "Reunião de time",     desc: "Pauta, decisões, próximos passos.",          tint: "bg-violet-200/60" },
  { key: "11",          icon: "🤝", title: "Reunião 1:1",          desc: "Check-in, feedback e desenvolvimento.",      tint: "bg-rose-200/60" },
  { key: "estudo",      icon: "📚", title: "Estudo / aula",        desc: "Notas estruturadas com referências.",        tint: "bg-emerald-200/60" },
  { key: "brainstorm",  icon: "💡", title: "Brainstorm",           desc: "Lista livre, depois agrupada e priorizada.", tint: "bg-amber-200/60" },
  { key: "decisao",     icon: "🎯", title: "Decisão",              desc: "Contexto, opções, escolha e impacto.",       tint: "bg-sky-200/60" },
  { key: "blank",       icon: "📄", title: "Documento em branco",  desc: "Comece do zero, do seu jeito.",              tint: "bg-zinc-200/60" },
];

const TEMPLATE_CONTENT: Record<string, any> = {
  reuniao: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Reunião de time" }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Pauta" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Decisões" }] },
    { type: "paragraph" },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Próximos passos" }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] },
  ]},
  "11": { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Reunião 1:1" }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Check-in" }] }, { type: "paragraph" },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Feedback" }] }, { type: "paragraph" },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Desenvolvimento" }] }, { type: "paragraph" },
  ]},
  estudo: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Estudo" }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Resumo" }] }, { type: "paragraph" },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Pontos-chave" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Referências" }] }, { type: "paragraph" },
  ]},
  brainstorm: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Brainstorm" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
  ]},
  decisao: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Decisão" }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Contexto" }] }, { type: "paragraph" },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Opções" }] }, { type: "paragraph" },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Escolha" }] }, { type: "paragraph" },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Impacto esperado" }] }, { type: "paragraph" },
  ]},
  blank: { type: "doc", content: [{ type: "paragraph" }] },
};

const RECENT_ACCENTS = [
  { dot: "bg-violet-500", bar: "bg-violet-500", label: "text-violet-700", tag: "Reuniões" },
  { dot: "bg-sky-500",    bar: "bg-sky-500",    label: "text-sky-700",    tag: "Ideias" },
  { dot: "bg-blue-500",   bar: "bg-blue-500",   label: "text-blue-700",   tag: "Estudos" },
];

function WorkspaceLanding({ userName, recents, onCreate, onOpen, onUseTemplate }: LandingProps & { onUseTemplate: (key: string) => void }) {
  const greet = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  })();

  const firstName = (userName || "você").split(" ")[0];

  return (
    <div className="max-w-[1100px] mx-auto px-8 py-6 space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-200/50 bg-gradient-to-r from-amber-100 via-orange-100 to-rose-100 p-6 flex items-center justify-between gap-6 shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-14 w-14 rounded-2xl bg-white/90 grid place-items-center shrink-0 shadow-sm">
            <Pencil className="h-6 w-6 text-violet-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold tracking-tight text-zinc-900">
              {greet}, {firstName} <span className="inline-block">👋</span>
            </h2>
            <p className="text-[13px] text-zinc-700 mt-1">
              Sua próxima reunião é em <strong>40 min</strong>. Que tal abrir uma página em branco ou um template?
            </p>
          </div>
        </div>
        <Button size="lg" className="gap-2 shrink-0 bg-red-600 hover:bg-red-700 text-white shadow-sm" onClick={onCreate}>
          <Plus className="h-4 w-4"/> Nova página
        </Button>
      </div>

      {/* Recents */}
      <section>
        <SectionTitle title="Continue de onde parou" hint="suas páginas mais recentes" />
        {recents.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-[13px] text-muted-foreground">
            Você ainda não tem páginas. Crie a primeira para começar.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {recents.slice(0, 3).map((p, i) => {
              const accent = RECENT_ACCENTS[i % RECENT_ACCENTS.length];
              const preview = extractPreview(p.content);
              return (
                <button key={p.id} onClick={() => onOpen(p.id)}
                  className="group relative text-left rounded-xl border bg-card overflow-hidden hover:shadow-md hover:border-foreground/20 transition-all">
                  <div className={cn("absolute left-0 top-0 h-full w-1", accent.bar)} />
                  <div className="p-4 pl-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold", accent.label)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", accent.dot)} />
                        {p.tags[0] ?? accent.tag}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground">{relTime(p.updated_at)}</span>
                    </div>
                    <h4 className="text-[14px] font-semibold leading-snug line-clamp-1 text-foreground">{p.title || "Sem título"}</h4>
                    {preview && <p className="text-[12px] text-muted-foreground line-clamp-2 mt-1.5">{preview}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Templates */}
      <section>
        <SectionTitle title="Comece com um template" hint="atalhos pros formatos que você mais usa" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {TEMPLATES.map(t => (
            <button key={t.key} onClick={() => onUseTemplate(t.key)}
              className="group relative overflow-hidden text-left rounded-xl border bg-card p-4 hover:shadow-md hover:border-foreground/20 transition-all">
              {/* pastel circle accent */}
              <div className={cn("absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-80", t.tint)} />
              <div className="relative">
                <div className="h-9 w-9 rounded-lg bg-background/80 border grid place-items-center text-lg mb-2">
                  {t.icon}
                </div>
                <h4 className="text-[13.5px] font-semibold">{t.title}</h4>
                <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">{t.desc}</p>
                <span className="text-[11.5px] text-red-600 font-medium mt-2 inline-flex items-center gap-1 group-hover:gap-1.5 transition-all">Criar →</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Activity + Promote */}
      <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="md:col-span-3 rounded-xl border bg-card p-4">
          <h3 className="text-[13.5px] font-semibold mb-3">Atividade do time</h3>
          <ul className="space-y-2.5">
            {(recents.slice(0, 3)).map((p, i) => {
              const initials = (p.last_edited_by || p.created_by_name || firstName).split(" ").map(s => s[0]).slice(0,2).join("").toUpperCase();
              const colors = ["bg-red-600", "bg-violet-600", "bg-emerald-600"];
              const verb = ["editou", "comentou em", "compartilhou"][i] ?? "atualizou";
              return (
                <li key={p.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <div className={cn("h-7 w-7 rounded-full grid place-items-center text-[10.5px] font-semibold text-white shrink-0", colors[i % 3])}>{initials || "?"}</div>
                  <div className="flex-1 min-w-0 truncate">
                    <span className="font-medium">{p.last_edited_by || p.created_by_name || firstName}</span>
                    <span className="text-muted-foreground"> {verb} </span>
                    <span className="font-medium">{p.title || "Sem título"}</span>
                  </div>
                  <span className="text-[10.5px] text-muted-foreground shrink-0">{relTime(p.updated_at)}</span>
                </li>
              );
            })}
            {recents.length === 0 && (
              <li className="text-[12px] text-muted-foreground py-4 text-center">Nenhuma atividade recente.</li>
            )}
          </ul>
        </div>

        <div className="md:col-span-2 rounded-xl border bg-card p-4">
          <h3 className="text-[13.5px] font-semibold mb-3">Pronto para virar playbook?</h3>
          <ul className="space-y-2">
            {recents.slice(0, 2).map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border bg-muted/20 p-2.5">
                <span className="text-[14px]">{p.icon || "📄"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium truncate">{p.title || "Sem título"}</div>
                  <div className="text-[10.5px] text-muted-foreground">maduro · {p.tags.length || 3} referências</div>
                </div>
                <button className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium transition-colors">
                  Promover →
                </button>
              </li>
            ))}
            {recents.length === 0 && (
              <li className="text-[12px] text-muted-foreground py-4 text-center">Nada por aqui ainda.</li>
            )}
          </ul>
        </div>
      </section>

      <div className="text-[11px] text-muted-foreground text-center pt-1">
        Dica: digite <kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono">/</kbd> dentro de uma página para inserir blocos.
      </div>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      {hint && <span className="text-[11.5px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function extractPreview(content: any): string {
  try {
    const walk = (n: any): string => {
      if (!n) return "";
      if (n.text) return n.text;
      if (Array.isArray(n.content)) return n.content.map(walk).join(" ");
      return "";
    };
    return walk(content).replace(/\s+/g, " ").trim().slice(0, 140);
  } catch { return ""; }
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "hoje";
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  if (d < 30) return `há ${Math.floor(d/7)} sem`;
  return new Date(iso).toLocaleDateString("pt-BR");
}
