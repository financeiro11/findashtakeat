import { useEffect, useMemo, useState } from "react";
import { Clock, ExternalLink, Loader2, Repeat, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { AREAS, NATUREZAS, corDaArea } from "@/lib/tarefas/classificacao";
import {
  fmtDias, fmtHoras, lerHoras, ordenarRecorte, percentual, pertenceAoRecorte,
  resumoDoRecorte, type Medida, type Recorte, type TarefaDaSemana,
} from "@/lib/tarefas/recorte";

/**
 * O painel por trás de um número da Análise Semanal.
 *
 * TRÊS COISAS, e as três são a mesma: conferir, entender e corrigir.
 *
 * Conferir — o cabeçalho repete a conta do card a partir das linhas listadas.
 * Quando os dois batem, é o carimbo de que a lista está completa; é o mesmo
 * contrato do painel de lançamentos da DRE, e a razão de ele existir.
 *
 * Entender — cada linha mostra de onde saiu o seu número: o peso é prioridade
 * mais checklist, a hora é apontada ou estimada pelo board, e quando é estimada
 * a linha diz com quanto tempo aberto e quanto parado ela foi calculada.
 *
 * Corrigir — a classificação e a hora se editam aqui, na linha, sem sair da
 * leitura. Quem corrige carimba `cat_origem='manual'` e o regex do banco não
 * encosta mais naquela tarefa. É a diferença entre um painel que informa e um
 * que se conserta: o número errado tem onde ser consertado no instante em que
 * alguém percebe que está errado.
 *
 * A lista é CONGELADA na abertura. Mudar a área de uma tarefa a tira do recorte,
 * e uma linha que some debaixo do cursor no meio da correção é o jeito mais
 * rápido de fazer alguém perder o lugar — ela fica, marcada como "saiu daqui".
 */

export function TarefasDoRecorte({
  recorte, linhas, carregando, totalSemana, medida, onFechar, onMudou, onAbrirTarefa,
}: {
  recorte: Recorte | null;
  linhas: TarefaDaSemana[];
  carregando: boolean;
  /** A semana inteira, para dizer que fatia dela este recorte é. */
  totalSemana: { n: number; horas: number };
  medida: Medida;
  onFechar: () => void;
  /** Devolve a linha corrigida para a página, que refaz os números na hora. */
  onMudou: (id: string, patch: Partial<TarefaDaSemana>) => void;
  onAbrirTarefa?: (id: string) => void;
}) {
  /* Os ids do momento da abertura, calculados DURANTE o render — uma ref
     preenchida em efeito não repinta, e a lista ficaria congelada na do recorte
     anterior até algo mais forçar um render.
     A lista de dependências é estreita de propósito: `linhas.length` e não
     `linhas`, porque o array troca de identidade a cada correção e recongelar
     ali refaria a seleção a cada tecla. Ela muda quando o recorte muda e quando
     as linhas chegam do banco — os dois momentos em que deve ser outra. */
  const chave = `${recorte?.eixo}|${recorte?.valor ?? ""}`;
  const congelados = useMemo(
    () => (!recorte || linhas.length === 0
      ? null
      : linhas.filter((l) => pertenceAoRecorte(l, recorte)).map((l) => l.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chave, linhas.length],
  );

  const lista = useMemo(() => {
    if (!recorte) return [];
    if (!congelados) return ordenarRecorte(linhas.filter((l) => pertenceAoRecorte(l, recorte)), recorte.eixo);
    const porId = new Map(linhas.map((l) => [l.id, l]));
    return ordenarRecorte(congelados.map((id) => porId.get(id)).filter(Boolean) as TarefaDaSemana[], recorte.eixo);
  }, [linhas, recorte, congelados]);

  /* O resumo é das que AINDA pertencem ao recorte — é ele que prevê o número
     que a semana vai mostrar depois de recalculada. */
  const dentro = useMemo(
    () => (recorte ? lista.filter((l) => pertenceAoRecorte(l, recorte)) : []),
    [lista, recorte],
  );
  const r = useMemo(() => resumoDoRecorte(dentro), [dentro]);

  const fatia = medida === "tempo"
    ? percentual(r.horas, totalSemana.horas)
    : percentual(r.n, totalSemana.n);

  return (
    <Sheet open={!!recorte} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[720px]">
        <SheetHeader className="shrink-0 space-y-0 border-b border-border px-5 pb-3.5 pt-5 text-left">
          <SheetTitle className="text-[15px] font-semibold">{recorte?.titulo ?? ""}</SheetTitle>
          {/* A conferência: a mesma conta do card, refeita a partir das linhas
              abaixo. É por isso que o painel existe. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span><span className="num font-semibold text-foreground">{r.n}</span> tarefa{r.n === 1 ? "" : "s"}</span>
            <span>·</span>
            <span><span className="num font-semibold text-foreground">{fmtHoras(r.horas)}</span> de tempo</span>
            <span>·</span>
            <span><span className="num font-semibold text-foreground">{fatia}%</span> da semana em {medida === "tempo" ? "tempo" : "tarefas"}</span>
            <span>·</span>
            <span>lead mediano <span className="num text-foreground">{fmtDias(r.leadMediana)}</span></span>
            {r.rotinas > 0 && (
              <>
                <span>·</span>
                <span className="num">{r.rotinas} de rotina</span>
              </>
            )}
          </div>
          {/* Sem isto o mix de tempo passa por medido quando ainda é quase todo
              estimativa — e uma estimativa apresentada como medida é pior que
              não ter número nenhum. */}
          {r.apontadas < r.n && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="num font-semibold">{r.apontadas} de {r.n}</span> com hora apontada.
                O resto é estimativa do board — tempo com o card aberto em horário comercial, sem o que
                ficou parado. Digite as horas na linha para o número virar medida.
              </span>
            </div>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {carregando ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando as tarefas desta semana…
            </div>
          ) : lista.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-muted-foreground">
              Nenhuma tarefa neste recorte.
            </div>
          ) : (
            <div className="space-y-1.5">
              {lista.map((l) => (
                <LinhaTarefa
                  key={l.id}
                  linha={l}
                  saiu={!!recorte && !pertenceAoRecorte(l, recorte)}
                  destacada={recorte?.destaque === l.id}
                  onMudou={onMudou}
                  onAbrirTarefa={onAbrirTarefa}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LinhaTarefa({ linha, saiu, destacada, onMudou, onAbrirTarefa }: {
  linha: TarefaDaSemana;
  saiu: boolean;
  destacada: boolean;
  onMudou: (id: string, patch: Partial<TarefaDaSemana>) => void;
  onAbrirTarefa?: (id: string) => void;
}) {
  const [horasTxt, setHorasTxt] = useState(linha.horas_apontadas != null ? String(linha.horas_apontadas).replace(".", ",") : "");
  const [gravando, setGravando] = useState(false);

  /* O texto segue o que veio do banco enquanto ninguém está digitando: é assim
     que a linha reflete um recálculo feito noutro lugar sem apagar o que a
     pessoa escreveu agora. */
  useEffect(() => {
    setHorasTxt(linha.horas_apontadas != null ? String(linha.horas_apontadas).replace(".", ",") : "");
  }, [linha.horas_apontadas]);

  const gravar = async (patch: TablesUpdate<"tarefas">, local: Partial<TarefaDaSemana>) => {
    setGravando(true);
    try {
      const { error } = await supabase.from("tarefas").update(patch).eq("id", linha.id);
      if (error) throw error;
      onMudou(linha.id, local);
    } catch (e) {
      toast.error("Falha ao gravar: " + (e as Error).message);
    } finally {
      setGravando(false);
    }
  };

  /* Mexer na classificação carimba `manual`: o gatilho do banco não reclassifica
     mais essa tarefa, nem quando o título mudar, nem numa revisão futura de
     vocabulário. Os três campos vão juntos porque o carimbo vale para a
     classificação inteira — é a mesma regra da revisão em lote. */
  const classificar = (patch: Partial<Pick<TarefaDaSemana, "natureza" | "area" | "rotina">>) => {
    const novo = {
      natureza: patch.natureza ?? linha.natureza ?? "Operacional",
      area: patch.area ?? linha.area ?? "Outros",
      rotina: patch.rotina ?? linha.rotina,
    };
    gravar(
      { cat_natureza: novo.natureza, cat_area: novo.area, rotina: novo.rotina, cat_origem: "manual" },
      { ...novo, cat_origem: "manual" },
    );
  };

  const apontarHoras = () => {
    const lido = lerHoras(horasTxt);
    if (lido === undefined) {          // ilegível: devolve o que estava, sem gravar
      setHorasTxt(linha.horas_apontadas != null ? String(linha.horas_apontadas).replace(".", ",") : "");
      toast.error("Hora não reconhecida — use um número, como 1,5.");
      return;
    }
    if (lido === linha.horas_apontadas) return;          // nada mudou
    if (lido === null && linha.horas_apontadas == null) return;
    gravar(
      { horas_gastas: lido },
      { horas_apontadas: lido, horas: lido ?? linha.horas_board },
    );
  };

  const estimada = linha.horas_apontadas == null;

  return (
    <div className={cn(
      "rounded-md border p-2.5 transition-colors",
      destacada ? "border-primary/50 bg-primary/[0.04]" : "border-border",
      saiu && "opacity-60",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">{linha.titulo}</span>
            {linha.rotina && (
              <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="rotina" />
            )}
            {onAbrirTarefa && (
              <button
                type="button"
                onClick={() => onAbrirTarefa(linha.id)}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                title="Abrir a tarefa no quadro"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{linha.pessoa}</span>
            <span>·</span>
            <span>{linha.prioridade}</span>
            {linha.subtarefas > 0 && (
              <>
                <span>·</span>
                <span className="num">{linha.subtarefas} subtarefa{linha.subtarefas === 1 ? "" : "s"}</span>
              </>
            )}
            <span>·</span>
            {/* De onde saiu o peso — senão é um número que ninguém sabe conferir. */}
            <span className="num" title={`Peso estimado: ${linha.prioridade} + ${linha.subtarefas} subtarefa(s)`}>
              peso {linha.peso}
            </span>
            <span>·</span>
            <span className="num">{fmtDias(linha.lead_dias)} no board</span>
            {linha.cat_origem === "manual" && (
              <span className="rounded bg-secondary px-1.5 py-px text-[10px] uppercase tracking-wider">manual</span>
            )}
            {saiu && (
              <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                saiu deste recorte
              </span>
            )}
          </div>
        </div>

        {/* O tempo. Quando ninguém apontou, o campo mostra a estimativa como
            placeholder — digitar por cima é o gesto inteiro de apontar. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Clock className={cn("h-3.5 w-3.5", estimada ? "text-muted-foreground/60" : "text-primary")} />
          <Input
            value={horasTxt}
            onChange={(e) => setHorasTxt(e.target.value)}
            onBlur={apontarHoras}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder={fmtHoras(linha.horas_board)}
            title={estimada
              ? `Estimativa do board: ${fmtHoras(linha.horas_abertas)} com o card aberto em horário comercial,`
                + ` ${fmtHoras(linha.horas_paradas)} parado em Backlog/Acompanhamento.`
                + ` Digite as horas reais para substituir.`
              : `Hora apontada. Apague o campo para voltar à estimativa do board (${fmtHoras(linha.horas_board)}).`}
            className={cn(
              "num h-7 w-[68px] text-right text-xs",
              estimada && "text-muted-foreground placeholder:italic",
            )}
          />
          <span className="w-3 text-[11px] text-muted-foreground">
            {gravando ? <Loader2 className="h-3 w-3 animate-spin" /> : "h"}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Select value={linha.natureza ?? "Operacional"} onValueChange={(v) => classificar({ natureza: v })}>
          <SelectTrigger className="h-7 w-[124px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {NATUREZAS.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={linha.area ?? "Outros"} onValueChange={(v) => classificar({ area: v })}>
          <SelectTrigger className="h-7 w-[176px] text-xs">
            <span className="flex items-center gap-1.5 truncate">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: corDaArea(linha.area ?? "Outros") }} />
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
            checked={linha.rotina}
            onCheckedChange={(c) => classificar({ rotina: c === true })}
            className="h-3 w-3"
          />
          rotina
        </label>
      </div>
    </div>
  );
}
