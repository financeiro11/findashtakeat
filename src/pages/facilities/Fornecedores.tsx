import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LayoutGrid, List, Plus } from "lucide-react";
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
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot } from "./components";
import {
  db, fmtBRL, fmtData, CATEGORIAS,
  type Fornecedor, type Compra,
} from "./lib";

interface Stats { compras: number; total: number; ultima: string | null; }

export default function Fornecedores() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"cards" | "lista">("cards");
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [edit, setEdit] = useState<Fornecedor | "novo" | null>(null);

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

  const ativos = fornecedores.filter((f) => f.status !== "inativo");

  return (
    <div className="space-y-4 p-5">
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

      {loading ? (
        <Skeleton className="h-80 rounded-lg" />
      ) : fornecedores.length === 0 ? (
        <div className="card-surface py-16 text-center text-[13px] text-muted-foreground">
          Nenhum fornecedor cadastrado. Clique em <span className="font-medium text-foreground">Novo fornecedor</span>.
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fornecedores.map((f) => {
            const s = statsDe.get(f.id)!;
            return (
              <button key={f.id} onClick={() => setEdit(f)} className="card-surface p-4 text-left transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between">
                  <div className="text-[14px] font-semibold text-foreground">{f.nome}</div>
                  {f.tem_contrato && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">Contrato</span>}
                </div>
                <div className="mt-0.5"><CatDot cat={f.categoria} label /></div>
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
              {fornecedores.map((f) => {
                const s = statsDe.get(f.id)!;
                return (
                  <tr key={f.id} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30" onClick={() => setEdit(f)}>
                    <td className="px-4 py-2.5 text-[13px] font-medium text-foreground">
                      {f.nome} {f.tem_contrato && <span className="ml-1 rounded bg-sky-50 px-1 text-[9px] font-semibold uppercase text-sky-700">contrato</span>}
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
  const [categoria, setCategoria] = useState("");
  const [contato, setContato] = useState("");
  const [temContrato, setTemContrato] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNome(f?.nome ?? "");
    setCategoria(f?.categoria ?? "");
    setContato(f?.contato ?? "");
    setTemContrato(f?.tem_contrato ?? false);
    setObservacao(f?.observacao ?? "");
  }, [alvo]);

  const salvar = async () => {
    if (!nome.trim()) { toast.error("Informe o nome"); return; }
    setBusy(true);
    const payload = {
      nome: nome.trim(),
      categoria: categoria || null,
      contato: contato.trim() || null,
      tem_contrato: temContrato,
      observacao: observacao.trim() || null,
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
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Limpamax Serviços" autoFocus />
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
