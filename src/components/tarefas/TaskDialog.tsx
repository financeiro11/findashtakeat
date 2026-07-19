import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* Tipos e helpers de Tarefas compartilhados entre a página Tarefas e o Briefing. */
export type Subtarefa = {
  id: string;
  titulo: string;
  responsavel: string | null;
  done: boolean;
};

export type Tarefa = {
  id: string; ordem: number; titulo: string; responsavel: string | null;
  status: string; prioridade: string; prazo: string | null; observacao: string | null;
  created_at: string;
  subtarefas: Subtarefa[];
};

export const DEFAULT_COLUMNS = ["Backlog", "Em andamento", "Acompanhamento", "Revisão", "Concluído", "Tasks - RPA"];
export const PRIO_OPTS = ["Baixa", "Média", "Alta", "Urgente"];

export function progressBarColor(p: number): string {
  if (p >= 100) return "bg-emerald-500";
  if (p >= 51) return "bg-orange-500";
  return "bg-destructive";
}

/* --------------------------- DIALOG --------------------------- */
export function TaskDialog({ columns, open, tarefa, defaultStatus, onClose, onSave, title }: {
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

  const isEdit = !!tarefa;

  const canSave = !!titulo.trim() && !!responsavel && !!prazo;
  const submit = () => {
    if (!canSave) {
      toast.error("Preencha título, responsável e prazo");
      return;
    }
    onSave({
      titulo,
      responsavel: responsavel || null,
      status,
      prioridade,
      prazo: prazo || null,
      observacao: observacao || null,
      subtarefas,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (isEdit) onClose();
            else submit();
          }
        }}
      >
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
            <>
              <Button variant="outline" onClick={onClose}>Fechar</Button>
              <Button onClick={submit} disabled={!canSave} title={canSave ? "" : "Preencha título, responsável e prazo"}>
                Salvar <span className="ml-2 text-[10px] opacity-70">Ctrl+Enter</span>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={submit} disabled={!canSave} title={canSave ? "" : "Preencha título, responsável e prazo"}>
                Criar <span className="ml-2 text-[10px] opacity-70">Ctrl+Enter</span>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
