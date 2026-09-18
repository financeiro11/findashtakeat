/* ---------------------------------------------------------------------------
 * O QUE ESTÁ RODANDO POR VOCÊ — no topo, em qualquer página.
 *
 * Par da `FaixaEsteira`: ela responde pelas automações do servidor; esta, pelo
 * que VOCÊ mandou fazer (emitir, refazer nota) e segue andando depois que a
 * janela fecha. Só aparece quando há algo — um marcador permanente de "nada
 * rodando" ensinaria a não olhar para ele.
 *
 * A janela de andamento mora aqui também, e não na página que disparou: é ela
 * que se reabre pelo "Ver" do toast em qualquer tela do Hub.
 * ------------------------------------------------------------------------- */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Check, CircleStop, Hourglass, Info, Layers, Loader2, Minus, TriangleAlert, X,
} from "lucide-react";
import {
  abrirTarefa, dispensar, parar, useTarefaAberta, useTarefas, type EstadoPasso, type Tarefa,
} from "@/lib/segundo-plano";

const hora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function IconeEstado({ estado, className }: { estado: EstadoPasso | Tarefa["estado"]; className?: string }) {
  const c = cn("h-3.5 w-3.5 shrink-0", className);
  if (estado === "correndo" || estado === "rodando") return <Loader2 className={cn(c, "animate-spin text-primary")} />;
  if (estado === "ok") return <Check className={cn(c, "text-emerald-600 dark:text-emerald-400")} />;
  if (estado === "atencao") return <TriangleAlert className={cn(c, "text-amber-600 dark:text-amber-400")} />;
  if (estado === "falhou") return <X className={cn(c, "text-destructive")} />;
  if (estado === "pulado" || estado === "parada") return <Minus className={cn(c, "text-muted-foreground")} />;
  return <Hourglass className={cn(c, "text-muted-foreground")} />;
}

export function TarefasEmSegundoPlano() {
  const tarefas = useTarefas();
  const [aberto, setAberto] = useState(false);
  const correndo = tarefas.filter((t) => t.estado === "rodando");
  const pedemVoce = tarefas.filter((t) => t.estado === "atencao" || t.estado === "falhou");
  if (!tarefas.length) return <JanelaTarefa />;

  return (
    <>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded border px-2 py-1 text-[12px] hover:bg-muted",
              correndo.length ? "border-primary/40 text-primary"
                : pedemVoce.length ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
                : "border-border text-muted-foreground",
            )}
            title="O que você mandou fazer e continua rodando — pode fechar as janelas e seguir trabalhando."
          >
            {correndo.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
            <span className="hidden md:inline">
              {correndo.length ? `${correndo.length} rodando` : pedemVoce.length ? "Precisa de você" : "Tarefas"}
            </span>
            {!correndo.length && pedemVoce.length > 0 && (
              <span className="num rounded bg-amber-500/15 px-1 md:hidden">{pedemVoce.length}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] p-0">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-semibold text-foreground">Rodando por você</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Pode fechar as janelas e trocar de tela — só fechar a aba do Hub interrompe.
            </p>
          </div>
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {tarefas.map((t) => {
              const atual = t.passos.find((p) => p.estado === "correndo");
              return (
                <li key={t.id} className="flex items-start gap-2 px-3 py-2">
                  <IconeEstado estado={t.estado} className="mt-0.5" />
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => { setAberto(false); abrirTarefa(t.id); }}
                  >
                    <span className="block truncate text-xs font-medium text-foreground">{t.titulo}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {t.estado === "rodando"
                        ? atual ? `${atual.titulo}${atual.detalhe ? ` — ${atual.detalhe}` : ""}` : "Começando…"
                        : `${t.resumo ?? t.subtitulo ?? ""}${t.terminadaEm ? ` · ${hora(t.terminadaEm)}` : ""}`}
                    </span>
                  </button>
                  {t.estado !== "rodando" && (
                    <button
                      onClick={() => dispensar(t.id)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Tirar da lista"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
      <JanelaTarefa />
    </>
  );
}

/** O andamento de UMA tarefa. Fechar esta janela não para nada. */
function JanelaTarefa() {
  const t = useTarefaAberta();
  if (!t) return null;
  const terminou = t.estado !== "rodando";

  return (
    <Dialog open onOpenChange={(v) => !v && abrirTarefa(null)}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <IconeEstado estado={t.estado} className="h-4 w-4" />
            {t.titulo}
          </DialogTitle>
          {t.subtitulo && <DialogDescription className="text-xs">{t.subtitulo}</DialogDescription>}
        </DialogHeader>

        <ol className="space-y-1">
          {t.passos.map((p, i) => (
            <li
              key={p.id}
              className={cn(
                "flex items-start gap-2.5 rounded-md border p-2.5 text-xs",
                p.estado === "correndo" && "border-primary/40 bg-primary/5",
                p.estado === "ok" && "border-emerald-500/30 bg-emerald-500/5",
                p.estado === "atencao" && "border-amber-500/40 bg-amber-500/5",
                p.estado === "falhou" && "border-destructive/40 bg-destructive/5",
                (p.estado === "espera" || p.estado === "pulado") && "border-border opacity-60",
              )}
            >
              <IconeEstado estado={p.estado} className="mt-px" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{i + 1}. {p.titulo}</span>
                {p.detalhe && <span className="mt-0.5 block leading-relaxed text-muted-foreground">{p.detalhe}</span>}
              </span>
            </li>
          ))}
        </ol>

        {t.destaques.length > 0 && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
            {t.destaques.map((d, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground">{d.rotulo}</span>
                <span className="num shrink-0 font-medium text-emerald-700 dark:text-emerald-400">{d.valor}</span>
              </div>
            ))}
          </div>
        )}

        {t.avisos.map((a, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" /> <span>{a}</span>
          </div>
        ))}

        {/* O QUE SOBROU PARA VOCÊ — só quando existe. Uma caixa permanente de
            pendências vazia treina a pessoa a ignorá-la no dia em que tiver algo. */}
        {terminou && t.paraVoce.length > 0 && (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <TriangleAlert className="h-3.5 w-3.5" />
              {t.paraVoce.length === 1 ? "Uma coisa precisa de você" : `${t.paraVoce.length} coisas precisam de você`}
            </div>
            {t.paraVoce.map((p, i) => (
              <div key={i} className="rounded border border-border bg-background p-2 text-[11px] leading-relaxed">
                <div className="font-medium text-foreground">{p.titulo}</div>
                {p.nome !== "—" && <div className="text-muted-foreground">{p.nome}</div>}
                <div className="mt-1 text-muted-foreground">{p.oQueFazer}</div>
                {p.tentado.length > 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground/70">
                    Já tentado antes de chegar até você: {p.tentado.join(" · ")}.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {terminou && t.resumo && t.paraVoce.length === 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t.resumo}</p>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {terminou ? "" : "Pode fechar: continua rodando e avisa quando terminar."}
          </span>
          <div className="flex gap-2">
            {!terminou && (
              <button
                onClick={() => {
                  if (window.confirm("Parar esta tarefa? O passo em andamento termina; os seguintes não começam.")) parar(t.id);
                }}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              >
                <CircleStop className="h-3.5 w-3.5" /> Parar
              </button>
            )}
            <button
              onClick={() => abrirTarefa(null)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {terminou ? "Fechar" : "Fechar e seguir trabalhando"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
