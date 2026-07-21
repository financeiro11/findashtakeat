import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { db, CATEGORIAS, parseValor } from "./lib";

export function NovaSolicitacaoDialog({ onCreated }: { onCreated?: () => void }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState<string>("");
  const [valor, setValor] = useState("");
  const [solicitante, setSolicitante] = useState("Renan");
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitulo(""); setCategoria(""); setValor(""); setSolicitante("Renan"); setObservacao("");
  };

  const salvar = async () => {
    if (!titulo.trim()) { toast.error("Informe o título da solicitação"); return; }
    setSaving(true);
    try {
      const { error } = await db.from("facilities_solicitacoes").insert({
        titulo: titulo.trim(),
        categoria: categoria || null,
        valor: parseValor(valor),
        solicitante: solicitante.trim() || profile?.nome || null,
        observacao: observacao.trim() || null,
        status: "solicitado",
      });
      if (error) throw error;
      toast.success("Solicitação criada");
      reset();
      setOpen(false);
      onCreated?.();
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button className="h-9 gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Nova solicitação
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova solicitação de compra</DialogTitle>
          <DialogDescription>Registre um pedido. Compras acima de R$ 500 passam por aprovação.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Título</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Cadeiras ergonômicas (4 un)" autoFocus />
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
              <Label>Valor estimado</Label>
              <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0" inputMode="decimal" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Solicitante</Label>
            <Input value={solicitante} onChange={(e) => setSolicitante(e.target.value)} placeholder="Renan" />
          </div>
          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="Detalhes, links, urgência…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Criar solicitação"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Barra de ações padrão no topo de cada página do módulo.
export function FacToolbar({
  context, onChanged, children,
}: { context?: string; onChanged?: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {context ? <p className="text-[13px] text-muted-foreground">{context}</p> : <span />}
      <div className="flex items-center gap-2">
        {children}
        <NovaSolicitacaoDialog onCreated={onChanged} />
      </div>
    </div>
  );
}
