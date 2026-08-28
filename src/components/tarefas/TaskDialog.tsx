import { useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
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
import { AREAS, NATUREZAS } from "@/lib/tarefas/classificacao";

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
  /* Contabilidade da idade, escrita pelo gatilho no banco a cada movimentação —
     opcionais porque quem monta uma Tarefa "na mão" (Briefing) não tem esses campos.
     A conta em si mora em src/lib/tarefas/idade.ts. */
  status_desde?: string | null;
  pausado_ms?: number | null;
  /* Classificação. O gatilho no banco carimba pelo título; quando alguém mexe
     aqui, `cat_origem` vira "manual" e o gatilho não encosta mais nessa linha.
     Opcionais pelo mesmo motivo dos campos de idade. */
  cat_natureza?: string | null;
  cat_area?: string | null;
  cat_origem?: string | null;
  rotina?: boolean | null;
  subtarefas: Subtarefa[];
};

export const DEFAULT_COLUMNS = ["Backlog", "Em andamento", "Acompanhamento", "Revisão", "Concluído", "Tasks - RPA"];
/* A escala mora em @/lib/tarefas/prioridade — é ela que ordena a coluna, e a
   ordenação não pode divergir do seletor. Reexportado aqui para quem já
   importava daqui não precisar mudar. */
export { PRIO_OPTS } from "@/lib/tarefas/prioridade";
import { PRIO_OPTS } from "@/lib/tarefas/prioridade";

export function progressBarColor(p: number): string {
  if (p >= 100) return "bg-emerald-500";
  if (p >= 51) return "bg-orange-500";
  return "bg-destructive";
}

/* Tipo próprio de arrasto: com "text/plain" o id vazaria como texto dentro do
   <Input> da própria linha ao soltar. */
const SUB_DRAG_TYPE = "application/x-subtarefa";

/** Move um item de `from` para `to` dentro do array (a ordem da lista É a ordem gravada). */
function moverItem<T>(lista: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= lista.length || to >= lista.length || from === to) return lista;
  const next = [...lista];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
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
  const [natureza, setNatureza] = useState<string>("");
  const [area, setArea] = useState<string>("");
  const [rotina, setRotina] = useState(false);
  /* Só marca `cat_origem: "manual"` se a pessoa realmente mexeu na classificação.
     Sem isso, abrir uma tarefa para trocar o prazo e salvar congelaria o carimbo
     automático dela para sempre — e o backfill de uma revisão de vocabulário
     futura passaria por cima sem tocar justamente nas mais mexidas. */
  const [classifTocada, setClassifTocada] = useState(false);
  const [subtarefas, setSubtarefas] = useState<Subtarefa[]>([]);
  const [newSubTitle, setNewSubTitle] = useState("");
  const [newSubResp, setNewSubResp] = useState("");
  /* Arrasto das subtarefas. `grabId` é a linha liberada para arrastar: só o punho
     (⠿) liga o draggable, senão arrastar para selecionar o texto do Input viraria
     arrasto da linha. */
  const [grabId, setGrabId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitulo(tarefa?.titulo || "");
      setResponsavel(tarefa?.responsavel || "");
      setStatus(tarefa?.status || defaultStatus || "Backlog");
      setPrioridade(tarefa?.prioridade || "Média");
      setPrazo(tarefa?.prazo || "");
      setObservacao(tarefa?.observacao || "");
      setNatureza(tarefa?.cat_natureza || "");
      setArea(tarefa?.cat_area || "");
      setRotina(!!tarefa?.rotina);
      setClassifTocada(false);
      setSubtarefas(tarefa?.subtarefas ? [...tarefa.subtarefas] : []);
      setNewSubTitle("");
      setNewSubResp("");
      setGrabId(null);
      setDragId(null);
      setOverId(null);
    }
  }, [open, tarefa, defaultStatus]);

  /* Se soltar o botão do mouse sem chegar a arrastar, o mouseup pode cair fora do
     punho — sem isso a linha continuaria arrastável. */
  useEffect(() => {
    if (!grabId) return;
    const solta = () => setGrabId(null);
    window.addEventListener("mouseup", solta);
    return () => window.removeEventListener("mouseup", solta);
  }, [grabId]);

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

  /* Reordenar: solta em cima de uma linha e o arrastado assume o lugar dela. */
  const soltarSub = (alvoId: string) => {
    if (!dragId || dragId === alvoId) return;
    setSubtarefas(prev => moverItem(prev, prev.findIndex(s => s.id === dragId), prev.findIndex(s => s.id === alvoId)));
  };
  /* Mesma reordenação pelo teclado, com o foco no punho (↑/↓). */
  const moverSub = (id: string, delta: number) =>
    setSubtarefas(prev => {
      const i = prev.findIndex(s => s.id === id);
      return i < 0 ? prev : moverItem(prev, i, i + delta);
    });
  const encerraArrasto = () => { setDragId(null); setOverId(null); setGrabId(null); };
  const dragIdx = dragId ? subtarefas.findIndex(s => s.id === dragId) : -1;

  const origemAtual = tarefa?.cat_origem ?? "auto";

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
      /* Numa tarefa NOVA os três campos vão vazios de propósito: quem carimba é o
         gatilho, a partir do título, e mandar `cat_natureza: null` é exatamente o
         que ele espera para preencher. Só vai valor daqui se a pessoa escolheu. */
      ...(classifTocada
        ? {
            cat_natureza: natureza || null,
            cat_area: area || null,
            rotina,
            cat_origem: "manual",
          }
        : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        onKeyDown={(e) => {
          // O atalho salva nos dois modos. Antes, em edição ele chamava onClose()
          // e fechava DESCARTANDO o que tinha sido digitado — e o próprio botão
          // anuncia "Salvar · Ctrl+Enter", então o atalho perdia o trabalho
          // exatamente de quem confiou no rótulo.
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
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
          {/* Classificação. Fica recolhida numa moldura discreta porque não é o
              que se preenche ao criar — o gatilho carimba sozinho pelo título, e
              este bloco existe para CORRIGIR quando ele erra. Mexer aqui é o que
              faz a aba Análise parar de mentir. */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Classificação</Label>
              <span className="text-[11px] text-muted-foreground">
                {classifTocada
                  ? "corrigida à mão — o carimbo automático não mexe mais"
                  : origemAtual === "manual"
                    ? "corrigida à mão anteriormente"
                    : "carimbada pelo título"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Natureza</Label>
                <Select
                  value={natureza || "__none"}
                  onValueChange={(v) => { setNatureza(v === "__none" ? "" : v); setClassifTocada(true); }}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {NATUREZAS.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Área</Label>
                <Select
                  value={area || "__none"}
                  onValueChange={(v) => { setArea(v === "__none" ? "" : v); setClassifTocada(true); }}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-2 pt-1">
              <Checkbox
                checked={rotina}
                onCheckedChange={(c) => { setRotina(c === true); setClassifTocada(true); }}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-medium text-foreground">É rotina</span>
                <span className="text-muted-foreground"> — volta sozinha toda semana/mês. É o que a
                Análise soma para montar a fila de automação em ordem de custo.</span>
              </span>
            </label>
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

            <div
              className="space-y-1.5"
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverId(null);
              }}
            >
              {subtarefas.map((s, i) => (
                <div
                  key={s.id}
                  draggable={grabId === s.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData(SUB_DRAG_TYPE, s.id);
                    setDragId(s.id);
                  }}
                  onDragEnd={encerraArrasto}
                  onDragOver={(e) => {
                    if (!dragId) return;   // arrasto de fora (arquivo, texto) não é nosso
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overId !== s.id) setOverId(s.id);
                  }}
                  onDrop={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    soltarSub(s.id);
                    encerraArrasto();
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5 transition-opacity",
                    dragId === s.id && "opacity-40",
                    // fio de inserção do lado para onde a linha vai
                    overId === s.id && dragId && dragId !== s.id && (
                      i < dragIdx
                        ? "shadow-[inset_0_2px_0_0_hsl(var(--primary))]"
                        : "shadow-[inset_0_-2px_0_0_hsl(var(--primary))]"
                    ),
                  )}
                >
                  <button
                    type="button"
                    onMouseDown={() => setGrabId(s.id)}
                    onMouseUp={() => setGrabId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") { e.preventDefault(); moverSub(s.id, -1); }
                      if (e.key === "ArrowDown") { e.preventDefault(); moverSub(s.id, 1); }
                    }}
                    className="shrink-0 cursor-grab rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
                    aria-label={`Reordenar "${s.titulo || "subtarefa"}"`}
                    title="Arraste para reordenar (ou ↑ / ↓ com o foco aqui)"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
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
