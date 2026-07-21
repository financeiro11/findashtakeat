import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LayoutGrid, List, Plus, Paperclip, Loader2, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot } from "./components";
import {
  db, fmtBRL, fmtData, CATEGORIAS,
  type Fornecedor, type Compra, type FornecedorAnexo,
} from "./lib";

const CONTRATOS_BUCKET = "facilities-contratos";

function fmtTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCnpj(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14);
  const parts = [
    d.slice(0, 2),
    d.slice(2, 5),
    d.slice(5, 8),
    d.slice(8, 12),
    d.slice(12, 14),
  ];
  let out = parts[0];
  if (d.length > 2) out += "." + parts[1];
  if (d.length > 5) out += "." + parts[2];
  if (d.length > 8) out += "/" + parts[3];
  if (d.length > 12) out += "-" + parts[4];
  return out;
}

interface Stats { compras: number; total: number; ultima: string | null; }

export default function Fornecedores() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"cards" | "lista">("cards");
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [edit, setEdit] = useState<Fornecedor | "novo" | null>(null);
  const [catFiltro, setCatFiltro] = useState<string>("todas");

  const load = useCallback(async () => {
    setLoading(true);
    const [f, c] = await Promise.all([
      db.from("facilities_fornecedores").select("*").order("nome"),
      db.from("facilities_compras").select("*"),
    ]);
    setFornecedores((f.data as Fornecedor[]) ?? []);
    setCompras((c.data as Compra[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const statsDe = useMemo(() => {
    const m = new Map<string, Stats>();
    for (const f of fornecedores) m.set(f.id, { compras: 0, total: 0, ultima: null });
    for (const c of compras) {
      const key = c.fornecedor_id && m.has(c.fornecedor_id)
        ? c.fornecedor_id
        : fornecedores.find((f) => f.nome === c.fornecedor_nome)?.id;
      if (!key) continue;
      const s = m.get(key)!;
      s.compras += 1;
      s.total += Number(c.valor || 0);
      if (!s.ultima || c.data > s.ultima) s.ultima = c.data;
    }
    return m;
  }, [fornecedores, compras]);

  const catCounts = useMemo(() => {
    const m: Record<string, number> = { todas: fornecedores.length, sem_categoria: 0 };
    for (const cat of CATEGORIAS) m[cat] = 0;
    for (const f of fornecedores) {
      if (f.categoria && m[f.categoria] != null) m[f.categoria] += 1;
      else if (!f.categoria) m.sem_categoria += 1;
    }
    return m;
  }, [fornecedores]);

  const fornecedoresFiltrados = useMemo(() => {
    if (catFiltro === "todas") return fornecedores;
    if (catFiltro === "sem_categoria") return fornecedores.filter((f) => !f.categoria);
    return fornecedores.filter((f) => f.categoria === catFiltro);
  }, [fornecedores, catFiltro]);

  const ativos = fornecedores.filter((f) => f.status !== "inativo");


  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Catálogo de fornecedores</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Cadastro, histórico de compras e contratos por fornecedor — filtre por categoria e veja quem tem contrato ativo.</p>
      </div>
      <FacToolbar context={`${ativos.length} fornecedor(es) ativo(s)`} onChanged={load}>
        <div className="flex items-center rounded-md border border-border p-0.5">
          <button onClick={() => setView("cards")} className={cn("flex items-center gap-1 rounded px-2.5 py-1 text-[12px]", view === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </button>
          <button onClick={() => setView("lista")} className={cn("flex items-center gap-1 rounded px-2.5 py-1 text-[12px]", view === "lista" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
            <List className="h-3.5 w-3.5" /> Lista
          </button>
        </div>
        <Button variant="outline" className="h-9 gap-2" onClick={() => setEdit("novo")}>
          <Plus className="h-4 w-4" /> Novo fornecedor
        </Button>
      </FacToolbar>

      <div className="flex flex-wrap gap-1.5">
        {[
          { key: "todas", label: "Todas" },
          ...CATEGORIAS.map((c) => ({ key: c, label: c })),
          { key: "sem_categoria", label: "Sem categoria" },
        ].filter((f) => f.key === "todas" || (catCounts[f.key] ?? 0) > 0).map((f) => (
          <button
            key={f.key}
            onClick={() => setCatFiltro(f.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              catFiltro === f.key
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {f.label} <span className="opacity-70">({catCounts[f.key] ?? 0})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-80 rounded-lg" />
      ) : fornecedoresFiltrados.length === 0 ? (
        <div className="card-surface py-16 text-center text-[13px] text-muted-foreground">
          {fornecedores.length === 0
            ? <>Nenhum fornecedor cadastrado. Clique em <span className="font-medium text-foreground">Novo fornecedor</span>.</>
            : "Nenhum fornecedor nesta categoria."}
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fornecedoresFiltrados.map((f) => {
            const s = statsDe.get(f.id)!;
            return (
              <button key={f.id} onClick={() => setEdit(f)} className="card-surface p-4 text-left transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
                    {f.nome}
                    {f.contratos?.length > 0 && (
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={`${f.contratos.length} anexo(s)`} />
                    )}
                  </div>
                  {f.tem_contrato && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">Contrato</span>}
                </div>
                <div className="mt-0.5"><CatDot cat={f.categoria} label /></div>
                {f.cnpj && <div className="mt-0.5 num text-[11.5px] text-muted-foreground">{formatCnpj(f.cnpj)}</div>}
                <div className="mt-1 text-[12.5px] text-muted-foreground">{f.contato || "—"}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
                  <Stat label="Compras" value={String(s.compras)} />
                  <Stat label="Total" value={fmtBRL(s.total)} />
                  <Stat label="Última compra" value={s.ultima ? fmtData(s.ultima) : "—"} />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Fornecedor</th>
                <th className="px-4 py-3 font-semibold">Categoria</th>
                <th className="px-4 py-3 font-semibold">Contato</th>
                <th className="px-4 py-3 text-right font-semibold">Compras</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 text-right font-semibold">Última</th>
              </tr>
            </thead>
            <tbody>
              {fornecedoresFiltrados.map((f) => {
                const s = statsDe.get(f.id)!;
                return (
                  <tr key={f.id} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30" onClick={() => setEdit(f)}>
                    <td className="px-4 py-2.5 text-[13px] font-medium text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {f.nome}
                        {f.contratos?.length > 0 && (
                          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={`${f.contratos.length} anexo(s)`} />
                        )}
                      </span>
                      {f.tem_contrato && <span className="ml-1 rounded bg-sky-50 px-1 text-[9px] font-semibold uppercase text-sky-700">contrato</span>}
                    </td>
                    <td className="px-4 py-2.5"><CatDot cat={f.categoria} label /></td>
                    <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground">{f.contato || "—"}</td>
                    <td className="num px-4 py-2.5 text-right text-[13px]">{s.compras}</td>
                    <td className="num px-4 py-2.5 text-right text-[13px]">{fmtBRL(s.total)}</td>
                    <td className="num px-4 py-2.5 text-right text-[12.5px] text-muted-foreground">{s.ultima ? fmtData(s.ultima) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <FornecedorDialog alvo={edit} onClose={() => setEdit(null)} onSaved={load} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="num text-[13px] font-semibold text-foreground">{value}</div>
    </div>
  );
}

function FornecedorDialog({ alvo, onClose, onSaved }: { alvo: Fornecedor | "novo" | null; onClose: () => void; onSaved: () => void }) {
  const isNovo = alvo === "novo";
  const f = alvo && alvo !== "novo" ? alvo : null;
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [categoria, setCategoria] = useState("");
  const [contato, setContato] = useState("");
  const [temContrato, setTemContrato] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [contratos, setContratos] = useState<FornecedorAnexo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historico, setHistorico] = useState<Compra[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNome(f?.nome ?? "");
    setCnpj(f?.cnpj ?? "");
    setCategoria(f?.categoria ?? "");
    setContato(f?.contato ?? "");
    setTemContrato(f?.tem_contrato ?? false);
    setObservacao(f?.observacao ?? "");
    setContratos(f?.contratos ?? []);
  }, [alvo]);

  useEffect(() => {
    if (!f) { setHistorico([]); return; }
    setLoadingHist(true);
    (async () => {
      const { data } = await db
        .from("facilities_compras")
        .select("*")
        .or(`fornecedor_id.eq.${f.id},fornecedor_nome.eq.${f.nome}`)
        .order("data", { ascending: false });
      setHistorico((data as Compra[]) ?? []);
      setLoadingHist(false);
    })();
  }, [f?.id]);

  const totalHist = historico.reduce((s, c) => s + Number(c.valor || 0), 0);


  const anexarArquivos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const novos: FornecedorAnexo[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name}: máximo 20MB`); continue; }
      const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await supabase.storage.from(CONTRATOS_BUCKET).upload(path, file);
      if (up.error) { toast.error(`${file.name}: ${up.error.message}`); continue; }
      const { data } = supabase.storage.from(CONTRATOS_BUCKET).getPublicUrl(path);
      novos.push({ nome: file.name, url: data.publicUrl, tamanho: file.size });
    }
    if (novos.length) setContratos((prev) => [...prev, ...novos]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removerAnexo = (idx: number) => {
    setContratos((prev) => prev.filter((_, i) => i !== idx));
  };

  const salvar = async () => {
    if (!nome.trim()) { toast.error("Informe o nome"); return; }
    const cnpjDig = cnpj.replace(/\D/g, "");
    if (cnpjDig && cnpjDig.length !== 14) { toast.error("CNPJ deve ter 14 dígitos"); return; }
    setBusy(true);
    const payload = {
      nome: nome.trim(),
      cnpj: cnpjDig ? cnpjDig : null,
      categoria: categoria || null,
      contato: contato.trim() || null,
      tem_contrato: temContrato,
      observacao: observacao.trim() || null,
      contratos,
    };
    const { error } = f
      ? await db.from("facilities_fornecedores").update(payload).eq("id", f.id)
      : await db.from("facilities_fornecedores").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(f ? "Fornecedor atualizado" : "Fornecedor criado");
    onClose(); onSaved();
  };

  const excluir = async () => {
    if (!f) return;
    if (!confirm(`Excluir o fornecedor "${f.nome}"?`)) return;
    const { error } = await db.from("facilities_fornecedores").delete().eq("id", f.id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    onClose(); onSaved();
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNovo ? "Novo fornecedor" : "Editar fornecedor"}</DialogTitle>
          <DialogDescription>Cadastro e histórico por fornecedor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Limpamax Serviços" maxLength={120} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>CNPJ</Label>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(formatCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              maxLength={18}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Contato</Label>
              <Input value={contato} onChange={(e) => setContato(e.target.value)} placeholder="Telefone, e-mail ou site" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input type="checkbox" checked={temContrato} onChange={(e) => setTemContrato(e.target.checked)} className="h-4 w-4" />
            Tem contrato ativo
          </label>
          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Contratos anexados</Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => anexarArquivos(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11.5px]"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                {uploading ? "Enviando…" : "Anexar"}
              </Button>
            </div>
            {contratos.length > 0 && (
              <div className="space-y-1">
                {contratos.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1">
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-[11.5px] text-foreground hover:text-primary hover:underline"
                    >
                      {c.nome}
                    </a>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTamanho(c.tamanho)}</span>
                    <button
                      type="button"
                      onClick={() => removerAnexo(idx)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      aria-label={`Remover ${c.nome}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {f && (
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <Label>Histórico de compras</Label>
                <span className="text-[11px] text-muted-foreground">
                  {historico.length} compra(s) · {fmtBRL(totalHist)}
                </span>
              </div>
              {loadingHist ? (
                <Skeleton className="h-20 rounded-md" />
              ) : historico.length === 0 ? (
                <div className="rounded-md border border-dashed border-border py-4 text-center text-[12px] text-muted-foreground">
                  Nenhuma compra registrada.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-muted/40">
                      <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-2.5 py-1.5 font-semibold">Data</th>
                        <th className="px-2.5 py-1.5 font-semibold">Item</th>
                        <th className="px-2.5 py-1.5 text-right font-semibold">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historico.map((c) => (
                        <tr key={c.id} className="border-t border-border/60">
                          <td className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground whitespace-nowrap">{fmtData(c.data)}</td>
                          <td className="px-2.5 py-1.5 text-[12px] text-foreground">{c.item}</td>
                          <td className="num px-2.5 py-1.5 text-right text-[12px]">{fmtBRL(Number(c.valor || 0), true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="items-center">
          {f && <button onClick={excluir} className="mr-auto text-[12px] text-muted-foreground hover:text-primary">Excluir</button>}
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
