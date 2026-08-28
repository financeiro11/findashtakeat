import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Check, X, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import type { Tarefa } from "@/components/tarefas/TaskDialog";
import { AREAS, NATUREZAS, AREA_NAO_CLASSIFICADA, corDaArea } from "@/lib/tarefas/classificacao";

/**
 * Revisão em lote da classificação — a tela que esvazia o "Outros".
 *
 * O carimbo automático (regex no banco) resolve o que tem palavra-chave e para
 * aí. O que sobra são títulos que só quem estava lá entende: "Situação KXC",
 * "FUP <> Miguel", "Slide DGF". Esta tela pede uma hipótese à IA para CADA um
 * deles e deixa a pessoa aceitar, corrigir ou pular — em lote, porque revisar 23
 * tarefas abrindo 23 diálogos é o tipo de trabalho que ninguém faz duas vezes.
 *
 * A IA nunca grava. Ela preenche os seletores; o botão de aplicar é que escreve,
 * e o que for escrito daqui vira `cat_origem='manual'` — imune ao automático
 * para sempre, inclusive a uma revisão de vocabulário futura. É o mesmo desenho
 * da Parametrização de contrapartes, e pela mesma razão: um painel que soma
 * carimbos de IA sobre carimbos de IA não mede mais nada.
 */

type Confianca = "alta" | "media" | "baixa";

interface Proposta {
  id: string;
  natureza: string;
  area: string;
  rotina: boolean;
  motivo: string;
  confianca: Confianca;
}

/** O que a pessoa vê e edita numa linha — começa como está no banco e recebe a
 *  proposta da IA por cima, se ela vier. */
interface Linha {
  tarefa: Tarefa;
  natureza: string;
  area: string;
  rotina: boolean;
  motivo: string | null;
  confianca: Confianca | null;
  marcada: boolean;
}

const CONF_CLS: Record<Confianca, string> = {
  alta: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  media: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  baixa: "bg-muted text-muted-foreground",
};

/* 60 é o teto de UM lote na Edge Function (a resposta é que estoura, não o
   contexto). Paginar aqui é o que faz "revisar 120 pendentes" funcionar sem que
   a tela precise saber disso. */
const LOTE = 60;

export function RevisaoClassificacao({ open, tarefas, onClose, onAplicado }: {
  open: boolean;
  /** As tarefas do quadro. O filtro de "quem precisa de revisão" é feito aqui. */
  tarefas: Tarefa[];
  onClose: () => void;
  /** Chamado depois de gravar, para a página recarregar a lista. */
  onAplicado: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [consultando, setConsultando] = useState(false);
  const [gravando, setGravando] = useState(false);

  /* Precisa de revisão quem está em "Outros" ou sem área — e nunca quem já foi
     corrigido à mão: repropor o que uma pessoa já decidiu é a maneira mais certa
     de fazer alguém parar de usar a tela. */
  const pendentes = useMemo(
    () => tarefas.filter(
      (t) => (t.cat_origem ?? "auto") !== "manual"
        && (!t.cat_area || t.cat_area === AREA_NAO_CLASSIFICADA),
    ),
    [tarefas],
  );

  useEffect(() => {
    if (!open) return;
    setLinhas(pendentes.map((t) => ({
      tarefa: t,
      natureza: t.cat_natureza || "Operacional",
      area: t.cat_area || AREA_NAO_CLASSIFICADA,
      rotina: !!t.rotina,
      motivo: null,
      confianca: null,
      marcada: false,
    })));
    // Só na abertura: reconstruir a cada mudança de `pendentes` apagaria o que a
    // pessoa já corrigiu na tela assim que o quadro recarregasse por trás.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const consultarIA = async () => {
    setConsultando(true);
    try {
      const alvos = linhas.map((l) => l.tarefa);
      const propostas: Proposta[] = [];

      for (let i = 0; i < alvos.length; i += LOTE) {
        const fatia = alvos.slice(i, i + LOTE);
        const r = await invocar<{ propostas: Proposta[] }>(
          supabase.functions.invoke("tarefas-classificar", {
            body: { tarefas: fatia.map((t) => ({ id: t.id, titulo: t.titulo, observacao: t.observacao })) },
          }),
        );
        propostas.push(...(r?.propostas ?? []));
      }

      const porId = new Map(propostas.map((p) => [p.id, p]));
      setLinhas((ls) => ls.map((l) => {
        const p = porId.get(l.tarefa.id);
        if (!p) return l;
        return {
          ...l,
          natureza: p.natureza,
          area: p.area,
          rotina: p.rotina,
          motivo: p.motivo,
          confianca: p.confianca,
          /* Marca sozinha só o que a IA disse com confiança alta E que saiu do
             "Outros". O resto fica proposto mas desmarcado: aplicar em massa um
             palpite de confiança baixa é como não ter revisado. */
          marcada: p.confianca === "alta" && p.area !== AREA_NAO_CLASSIFICADA,
        };
      }));

      const acertos = propostas.filter((p) => p.area !== AREA_NAO_CLASSIFICADA).length;
      toast.success(`${acertos} de ${propostas.length} ganharam uma área proposta.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConsultando(false);
    }
  };

  const mexer = (id: string, patch: Partial<Linha>) =>
    setLinhas((ls) => ls.map((l) => (l.tarefa.id === id ? { ...l, ...patch, marcada: true } : l)));

  const marcadas = linhas.filter((l) => l.marcada);

  const aplicar = async () => {
    if (marcadas.length === 0) return;
    setGravando(true);
    try {
      /* Uma escrita por linha, e não um upsert em bloco: cada tarefa tem campos
         que não estão aqui (checklist, prazo) e um upsert precisaria mandá-los de
         volta — qualquer um que ficasse de fora seria apagado. */
      for (const l of marcadas) {
        const { error } = await supabase
          .from("tarefas")
          .update({
            cat_natureza: l.natureza,
            cat_area: l.area,
            rotina: l.rotina,
            cat_origem: "manual",
          })
          .eq("id", l.tarefa.id);
        if (error) throw error;
      }
      toast.success(`${marcadas.length} tarefa${marcadas.length === 1 ? "" : "s"} classificada${marcadas.length === 1 ? "" : "s"}.`);
      onAplicado();
      onClose();
    } catch (e) {
      toast.error("Falha ao gravar: " + (e as Error).message);
    } finally {
      setGravando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-4 w-4" /> Revisar classificação
          </DialogTitle>
          <DialogDescription>
            {linhas.length === 0
              ? "Nada pendente — todas as tarefas do quadro já têm área."
              : `${linhas.length} tarefa${linhas.length === 1 ? "" : "s"} sem área. `
                + "A IA propõe, você confirma — e o que sair daqui o carimbo automático não mexe mais."}
          </DialogDescription>
        </DialogHeader>

        {linhas.length > 0 && (
          <>
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Button variant="outline" onClick={consultarIA} disabled={consultando} className="gap-1.5">
                {consultando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {consultando ? "Consultando…" : "Propor com IA"}
              </Button>
              <Button
                variant="ghost"
                className="gap-1.5 text-xs"
                onClick={() => setLinhas((ls) => ls.map((l) => ({ ...l, marcada: l.area !== AREA_NAO_CLASSIFICADA })))}
              >
                <Check className="h-3.5 w-3.5" /> Marcar todas com área
              </Button>
              <Button
                variant="ghost"
                className="gap-1.5 text-xs"
                onClick={() => setLinhas((ls) => ls.map((l) => ({ ...l, marcada: false })))}
              >
                <X className="h-3.5 w-3.5" /> Desmarcar
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                <span className="num font-semibold text-foreground">{marcadas.length}</span> marcada{marcadas.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1 py-1">
              {linhas.map((l) => (
                <div
                  key={l.tarefa.id}
                  className={cn(
                    "rounded-md border p-2.5 transition-colors",
                    l.marcada ? "border-primary/40 bg-primary/[0.03]" : "border-border",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      checked={l.marcada}
                      onCheckedChange={(c) => setLinhas((ls) => ls.map((x) =>
                        x.tarefa.id === l.tarefa.id ? { ...x, marcada: c === true } : x))}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-foreground">{l.tarefa.titulo}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{l.tarefa.responsavel || "—"}</span>
                        <span>·</span>
                        <span>{l.tarefa.status}</span>
                        {l.motivo && (
                          <>
                            <span>·</span>
                            <span className="italic">{l.motivo}</span>
                          </>
                        )}
                        {l.confianca && (
                          <span className={cn("rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider", CONF_CLS[l.confianca])}>
                            {l.confianca}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Select value={l.natureza} onValueChange={(v) => mexer(l.tarefa.id, { natureza: v })}>
                        <SelectTrigger className="h-7 w-[124px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {NATUREZAS.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={l.area} onValueChange={(v) => mexer(l.tarefa.id, { area: v })}>
                        <SelectTrigger className="h-7 w-[168px] text-xs">
                          <span className="flex items-center gap-1.5 truncate">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: corDaArea(l.area) }} />
                            <SelectValue />
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <label
                        className="flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground"
                        title="Rotina: volta sozinha toda semana/mês"
                      >
                        <Checkbox
                          checked={l.rotina}
                          onCheckedChange={(c) => mexer(l.tarefa.id, { rotina: c === true })}
                          className="h-3 w-3"
                        />
                        rotina
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={aplicar} disabled={marcadas.length === 0 || gravando}>
            {gravando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aplicar {marcadas.length > 0 ? `(${marcadas.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
