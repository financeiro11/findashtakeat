import { useEffect, useRef, useState } from "react";
import { Check, GripVertical, Link2, Plus, Share2, Trash2 } from "lucide-react";
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
import { compartilharNativo, copiar, temCompartilhamentoNativo } from "@/lib/compartilhar";
import { mensagemDaTarefa, urlDaTarefa } from "@/lib/tarefas/link";
import { AREAS, NATUREZAS } from "@/lib/tarefas/classificacao";
import {
  CADENCIA_PADRAO, Cadencia, ajustarPrazoACadencia, cadenciaValida, deIso, descreverCadencia,
  ehDataDaCadencia, iso, lerCadencia, proximaData,
} from "@/lib/tarefas/rotina";
import { CadenciaEditor, PagamentoDoDia } from "@/components/tarefas/CadenciaEditor";

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
  /* A agenda da rotina. `rotina` acima diz "isto se repete" (e é o que a Análise
     soma); estes dizem QUANDO — e é o que o cron `tarefas_rotinas_gerar` executa
     para criar a próxima ocorrência. Sem cadência, `rotina` continua valendo
     como observação, exatamente como antes. */
  rotina_cadencia?: Cadencia | null;
  rotina_serie_id?: string | null;
  rotina_ativa?: boolean | null;
  rotina_antecedencia_dias?: number | null;
  /* De onde vem o checklist da PRÓXIMA ocorrência. null = clona o desta;
     "agenda" = uma subtarefa por pagamento daquele dia no Google Calendar. */
  rotina_subtarefas_fonte?: string | null;
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
  const [cadencia, setCadencia] = useState<Cadencia | null>(null);
  const [rotinaAtiva, setRotinaAtiva] = useState(true);
  const [antecedencia, setAntecedencia] = useState(0);
  const [fonteSubtarefas, setFonteSubtarefas] = useState<string | null>(null);
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
  /* O ✓ do "Copiar link" por um instante: o toast some no canto e o botão é onde a
     pessoa ainda está olhando. */
  const [linkCopiado, setLinkCopiado] = useState(false);

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
      setCadencia(lerCadencia(tarefa?.rotina_cadencia));
      setRotinaAtiva(tarefa?.rotina_ativa ?? true);
      setAntecedencia(tarefa?.rotina_antecedencia_dias ?? 0);
      setFonteSubtarefas(tarefa?.rotina_subtarefas_fonte ?? null);
      setClassifTocada(false);
      setSubtarefas(tarefa?.subtarefas ? [...tarefa.subtarefas] : []);
      setNewSubTitle("");
      setNewSubResp("");
      setGrabId(null);
      setDragId(null);
      setOverId(null);
      setLinkCopiado(false);
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

  /* O PRAZO DE UMA ROTINA SE DEDUZ, e por isso deixa de ser obrigatorio.
     Quem escreveu "todo dia 5, 10, 15, 20, 25 e 30" ja disse quando a tarefa
     vence — pedir a data de novo e pedir a mesma informacao duas vezes.

     E ele nao pode CONTRADIZER a cadencia. A primeira versao so preenchia o
     campo vazio, e o resultado apareceu no quadro: "todo dia 31" vencendo em
     30/09, "dias 6, 16, 21, 26 e 31" vencendo em 05/09 — o cartao anunciando
     uma regra e vencendo noutro dia. Alem de nao fazer sentido para quem le,
     duplica: o gerador cria a ocorrencia do dia da cadencia enquanto a de prazo
     torto segue aberta. Por isso o ajuste vale tambem para prazo ja preenchido,
     ancorado no que a pessoa escreveu (05/09 numa rotina de dia 6 vira 06/09,
     e nao o proximo contado de hoje). */
  const cadenciaAtiva = rotina && cadenciaValida(cadencia) ? cadencia : null;
  const prazoSugerido = cadenciaAtiva ? ajustarPrazoACadencia(cadenciaAtiva, prazo) : null;
  const prazoEfetivo = prazo || (prazoSugerido ?? "");
  const prazoDaRotina = !!cadenciaAtiva;
  /* Divergencia que a pessoa PRECISA ver: ela digitou uma data, e a regra que
     ela mesma escreveu nao produz aquele dia. */
  const prazoDiverge = !!cadenciaAtiva && !!prazo && !ehDataDaCadencia(cadenciaAtiva, deIso(prazo));

  useEffect(() => {
    if (!cadenciaAtiva) return;
    const ajustado = ajustarPrazoACadencia(cadenciaAtiva, prazo);
    if (ajustado) setPrazo(ajustado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotina, cadencia]);

  /* Traz os pagamentos da agenda como SUBTAREFA de verdade — marcavel, editavel
     e salva com a tarefa. Antes isto era so prevIa, e a tarefa recem-criada
     nascia com checklist vazio: o preenchimento automatico so vale para a
     PROXIMA ocorrencia, a que o cron cria. Casa por rotulo para nao duplicar
     quem ja esta na lista, e o que foi escrito a mao fica onde estava. */
  const trazerDaAgenda = (itens: PagamentoDoDia[]) => {
    setSubtarefas(prev => {
      const tem = new Set(prev.map(s => s.titulo));
      const novas = itens
        .filter(i => !tem.has(i.rotulo))
        .map(i => ({ id: crypto.randomUUID(), titulo: i.rotulo, responsavel: responsavel || null, done: false }));
      return novas.length ? [...prev, ...novas] : prev;
    });
    toast.success("Pagamentos trazidos para o checklist");
  };

  const origemAtual = tarefa?.cat_origem ?? "auto";

  const subsDone = subtarefas.filter(s => s.done).length;
  const subsProgress = subtarefas.length ? Math.round((subsDone / subtarefas.length) * 100) : 0;

  const isEdit = !!tarefa;

  /* Mandar a demanda para alguém. Só em edição, porque o endereço é o id da linha e
     tarefa que ainda não foi criada não tem id — não há o que mandar.

     Copia o TÍTULO junto com o link: colado no WhatsApp, um endereço terminado em UUID
     não diz do que se trata, e quem recebe abre para descobrir. */
  const copiarLink = async () => {
    if (!tarefa) return;
    const url = urlDaTarefa(tarefa.id);
    /* `tarefa.titulo`, não o campo em edição: o recado tem que descrever o que está
       gravado no quadro, e não um título que a pessoa ainda pode cancelar. */
    if (!(await copiar(mensagemDaTarefa(tarefa)))) {
      toast.error("O navegador bloqueou a cópia", { description: url });
      return;
    }
    setLinkCopiado(true);
    toast.success("Link copiado, com o título junto", { description: url });
    setTimeout(() => setLinkCopiado(false), 1800);
  };

  const canSave = !!titulo.trim() && !!responsavel && !!prazoEfetivo;
  const submit = () => {
    if (!canSave) {
      toast.error(rotina
        ? "Preencha título e responsável (o prazo vem da rotina)"
        : "Preencha título, responsável e prazo");
      return;
    }
    onSave({
      titulo,
      responsavel: responsavel || null,
      status,
      prioridade,
      prazo: prazoEfetivo || null,
      observacao: observacao || null,
      subtarefas,
      /* A agenda vai SEMPRE, independente de `classifTocada`. Ela não é carimbo
         que o gatilho preenche — é ordem de execução, e omiti-la ao salvar uma
         tarefa cuja rotina foi desmarcada deixaria o cron gerando ocorrências de
         uma rotina que a pessoa acabou de encerrar. */
      rotina_cadencia: rotina ? cadencia : null,
      rotina_ativa: rotinaAtiva,
      rotina_antecedencia_dias: antecedencia,
      rotina_subtarefas_fonte: rotina && cadencia ? fonteSubtarefas : null,
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
              <div className="flex items-baseline justify-between gap-2">
                <Label>Prazo</Label>
                {prazoDaRotina && (
                  <span className={cn("text-[10px]", prazoDiverge ? "text-warning" : "text-muted-foreground")}>
                    {prazoDiverge ? "não é dia da rotina" : "pela rotina"}
                  </span>
                )}
              </div>
              <Input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                className={cn(prazoDiverge && "border-warning")}
              />
              {prazoDiverge && prazoSugerido && (
                <button
                  type="button"
                  onClick={() => setPrazo(prazoSugerido)}
                  className="mt-1 text-left text-[10px] text-warning underline-offset-2 hover:underline"
                >
                  {descreverCadencia(cadenciaAtiva)} não cai nesse dia — usar{" "}
                  {deIso(prazoSugerido).toLocaleDateString("pt-BR")}
                </button>
              )}
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
                onCheckedChange={(c) => {
                  const v = c === true;
                  setRotina(v);
                  setClassifTocada(true);
                  /* Marcar "é rotina" já abre uma agenda utilizável (todo dia 5),
                     em vez de um bloco vazio: a pergunta seguinte é sempre
                     "quando?", e deixar o padrão pronto é o que faz a resposta
                     custar um clique. Quem não quer agenda escolhe "Sem agenda". */
                  if (v && !cadencia) setCadencia(CADENCIA_PADRAO);
                  if (!v) setCadencia(null);
                }}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-medium text-foreground">É rotina</span>
                <span className="text-muted-foreground"> — se repete. A Análise soma as rotinas para
                montar a fila de automação em ordem de custo.</span>
              </span>
            </label>
          </div>

          {/* Quando ela volta. Bloco à parte de propósito: classificação é como a
              tarefa é CONTADA; cadência é o que o banco EXECUTA. Misturar os dois
              foi o que fez o checkbox prometer "volta sozinha" sem nada atrás. */}
          {rotina && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Quando volta</Label>
                <span className="text-[11px] text-muted-foreground">
                  {cadencia ? "o Hub cria a próxima sozinho" : "nada é criado automaticamente"}
                </span>
              </div>
              <CadenciaEditor
                cadencia={cadencia}
                onCadencia={setCadencia}
                antecedencia={antecedencia}
                onAntecedencia={setAntecedencia}
                ativa={rotinaAtiva}
                onAtiva={setRotinaAtiva}
                fonte={fonteSubtarefas}
                onFonte={setFonteSubtarefas}
                prazo={prazoEfetivo}
                jaNoChecklist={new Set(subtarefas.map(s => s.titulo))}
                onTrazerDaAgenda={trazerDaAgenda}
              />
            </div>
          )}

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
          {isEdit && tarefa && (
            <div className="flex items-center gap-1.5 sm:mr-auto">
              <Button variant="outline" onClick={copiarLink} className="gap-1.5" title={urlDaTarefa(tarefa.id)}>
                {linkCopiado
                  ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                  : <Link2 className="h-3.5 w-3.5" />}
                Copiar link
              </Button>
              {/* A folha do sistema (WhatsApp, e-mail) não existe em todo navegador —
                  onde não existir, o botão nem aparece e sobra o "Copiar link". */}
              {temCompartilhamentoNativo() && (
                <Button
                  variant="outline"
                  className="w-10 shrink-0 p-0"
                  onClick={() => compartilharNativo(tarefa.titulo, urlDaTarefa(tarefa.id))}
                  title="Enviar por WhatsApp, e-mail…"
                  aria-label="Enviar por WhatsApp, e-mail…"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
          {isEdit ? (
            <>
              <Button variant="outline" onClick={onClose}>Fechar</Button>
              <Button onClick={submit} disabled={!canSave} title={canSave ? "" : (rotina ? "Preencha título e responsável" : "Preencha título, responsável e prazo")}>
                Salvar <span className="ml-2 text-[10px] opacity-70">Ctrl+Enter</span>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={submit} disabled={!canSave} title={canSave ? "" : (rotina ? "Preencha título e responsável" : "Preencha título, responsável e prazo")}>
                Criar <span className="ml-2 text-[10px] opacity-70">Ctrl+Enter</span>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
