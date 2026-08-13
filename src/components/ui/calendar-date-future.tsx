// Campo de período: fica recolhido numa linha só e abre o painel ao ser clicado.
//
// O valor mora no próprio campo (com rótulo flutuante), então ele ocupa uma linha
// quando ninguém está mexendo — diferente de deixar presets e calendário sempre
// abertos, que empurram o resto da tela para baixo.
//
// A seleção só vale ao clicar em "Aplicar": mexer no calendário não deve refiltrar a
// tela a cada clique, senão escolher um intervalo dispara uma busca no meio do caminho.

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, CalendarCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type PeriodoValor = { from?: Date; to?: Date; preset?: string };

export type PresetPeriodo = {
  id: string;
  label: string;
  resolver: () => { from: Date; to: Date };
};

const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fimDoDia = (d: Date) => {
  const x = inicioDoDia(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const somaDias = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
// Semana começando no domingo, como o calendário exibe.
const inicioDaSemana = (d: Date) => somaDias(inicioDoDia(d), -d.getDay());

/** Presets padrão — os mesmos usados nos demais filtros de período do Hub. */
export const PRESETS_PADRAO: PresetPeriodo[] = [
  { id: "hoje", label: "Hoje", resolver: () => { const h = new Date(); return { from: inicioDoDia(h), to: fimDoDia(h) }; } },
  { id: "amanha", label: "Amanhã", resolver: () => { const a = somaDias(new Date(), 1); return { from: inicioDoDia(a), to: fimDoDia(a) }; } },
  { id: "semana", label: "Essa semana", resolver: () => { const i = inicioDaSemana(new Date()); return { from: i, to: fimDoDia(somaDias(i, 6)) }; } },
  { id: "prox_semana", label: "Semana que vem", resolver: () => { const i = somaDias(inicioDaSemana(new Date()), 7); return { from: i, to: fimDoDia(somaDias(i, 6)) }; } },
  { id: "mes", label: "Esse mês", resolver: () => { const h = new Date(); return { from: new Date(h.getFullYear(), h.getMonth(), 1), to: fimDoDia(new Date(h.getFullYear(), h.getMonth() + 1, 0)) }; } },
  { id: "prox_mes", label: "Mês que vem", resolver: () => { const h = new Date(); return { from: new Date(h.getFullYear(), h.getMonth() + 1, 1), to: fimDoDia(new Date(h.getFullYear(), h.getMonth() + 2, 0)) }; } },
  { id: "ano", label: "Esse ano", resolver: () => { const h = new Date(); return { from: new Date(h.getFullYear(), 0, 1), to: fimDoDia(new Date(h.getFullYear(), 11, 31)) }; } },
];

const paraData = (d?: Date) => (d ? d.toLocaleDateString("pt-BR") : "");
const paraHora = (d?: Date) =>
  d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
// yyyy-MM-dd para o <input type="date">, em horário local (toISOString jogaria para UTC).
const paraInputData = (d?: Date) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";

function combinar(dataStr: string, horaStr: string): Date | undefined {
  if (!dataStr) return undefined;
  const [a, m, dia] = dataStr.split("-").map(Number);
  const [h, min] = (horaStr || "00:00").split(":").map(Number);
  const d = new Date(a, (m || 1) - 1, dia || 1, h || 0, min || 0, 0, 0);
  return isNaN(d.getTime()) ? undefined : d;
}

export type CalendarDateFutureProps = {
  /** Rótulo flutuante do campo. */
  dateLabel?: string;
  /** Valor controlado. Deixe indefinido para o componente cuidar do próprio estado. */
  value?: PeriodoValor;
  /** Chamado ao clicar em "Aplicar" (ou ao limpar, com `{}`). */
  onSelectDate?: (valor: PeriodoValor) => void;
  presets?: PresetPeriodo[];
  placeholder?: string;
  className?: string;
  /** Permite limpar o período direto do painel. */
  limpavel?: boolean;
};

export function CalendarDateFuture({
  dateLabel,
  value,
  onSelectDate,
  presets = PRESETS_PADRAO,
  placeholder = "Selecione o período",
  className,
  limpavel = true,
}: CalendarDateFutureProps) {
  const [aberto, setAberto] = React.useState(false);
  const [interno, setInterno] = React.useState<PeriodoValor>({});
  const valor = value ?? interno;

  // Rascunho: só vira valor no "Aplicar", então fechar sem aplicar não altera nada.
  const [rascunho, setRascunho] = React.useState<PeriodoValor>(valor);
  React.useEffect(() => {
    if (aberto) setRascunho(valor);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const temValor = !!(valor.from || valor.to);
  const textoCampo = !temValor
    ? placeholder
    : `${paraData(valor.from)} - ${paraHora(valor.from) || "00:00"} a ${paraData(valor.to) || paraData(valor.from)} - ${paraHora(valor.to) || "23:59"}`;

  const aplicar = () => {
    if (!value) setInterno(rascunho);
    onSelectDate?.(rascunho);
    setAberto(false);
  };

  const limpar = () => {
    const vazio: PeriodoValor = {};
    setRascunho(vazio);
    if (!value) setInterno(vazio);
    onSelectDate?.(vazio);
    setAberto(false);
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition",
            aberto || temValor ? "border-primary" : "border-input hover:border-primary/50",
            className,
          )}
        >
          {dateLabel && (
            // Rótulo montado na borda: o campo recolhido continua dizendo o que é.
            <span
              className={cn(
                "absolute -top-2 left-2 bg-background px-1 text-[11px] leading-none",
                aberto || temValor ? "text-primary" : "text-muted-foreground",
              )}
            >
              {dateLabel}
            </span>
          )}
          <span className={cn("truncate", !temValor && "text-muted-foreground")}>{textoCampo}</span>
          <CalendarCheck className={cn("h-4 w-4 shrink-0", temValor ? "text-primary" : "text-muted-foreground")} />
        </button>
      </PopoverTrigger>

      {/* side/align ancoram o painel logo ABAIXO do campo; sticky=always faz ele
          acompanhar a rolagem em vez de descolar; collisionPadding evita encostar na
          borda da janela, e o max-h com scroll interno impede que ele estoure a tela
          quando abre perto do rodapé. */}
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        avoidCollisions
        collisionPadding={12}
        sticky="always"
        className="pointer-events-auto max-h-[min(80vh,34rem)] w-auto overflow-y-auto overscroll-contain p-0"
      >
        <div className="flex flex-col sm:flex-row">
          {/* Presets */}
          <div className="flex shrink-0 flex-row flex-wrap gap-1 border-b border-border p-2 sm:w-40 sm:flex-col sm:gap-0 sm:border-b-0 sm:border-r sm:p-0 sm:py-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setRascunho({ ...p.resolver(), preset: p.id })}
                className={cn(
                  "rounded px-3 py-1.5 text-left text-sm transition hover:bg-muted sm:rounded-none sm:px-4 sm:py-2",
                  rascunho.preset === p.id ? "font-semibold text-primary" : "text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendário + campos de/até */}
          <div className="p-3">
            <DayPicker
              mode="range"
              locale={ptBR}
              selected={{ from: rascunho.from, to: rascunho.to }}
              onSelect={(r) =>
                setRascunho({
                  from: r?.from,
                  // Sem hora escolhida, o fim do intervalo cobre o dia inteiro.
                  to: r?.to ? fimDoDia(r.to) : undefined,
                  preset: undefined,
                })
              }
              defaultMonth={rascunho.from}
              showOutsideDays
              formatters={{
                formatCaption: (d) =>
                  `${d.toLocaleDateString("pt-BR", { month: "long" }).replace(/^./, (c) => c.toUpperCase())}, ${d.getFullYear()}`,
                formatWeekdayName: (d) => d.toLocaleDateString("pt-BR", { weekday: "narrow" }).toUpperCase(),
              }}
              components={{
                IconLeft: () => <ChevronLeft className="h-4 w-4" />,
                IconRight: () => <ChevronRight className="h-4 w-4" />,
              }}
              classNames={{
                months: "flex flex-col",
                month: "space-y-3",
                caption: "relative flex items-center justify-center pt-1",
                caption_label: "text-sm font-bold text-primary",
                nav: "flex items-center",
                nav_button: "h-6 w-6 rounded text-primary hover:bg-muted inline-flex items-center justify-center",
                nav_button_previous: "absolute left-0",
                nav_button_next: "absolute right-0",
                table: "w-full border-collapse",
                head_row: "flex",
                head_cell: "w-8 text-[11px] font-semibold text-foreground",
                row: "mt-1 flex w-full",
                cell: "h-8 w-8 p-0 text-center text-sm",
                day: "h-8 w-8 rounded-full font-normal hover:bg-muted",
                day_selected: "bg-primary text-primary-foreground hover:bg-primary",
                day_range_middle: "rounded-none bg-primary/10 text-foreground",
                day_range_start: "rounded-full bg-primary text-primary-foreground",
                day_range_end: "rounded-full bg-primary text-primary-foreground",
                day_today: "font-semibold text-primary",
                day_outside: "text-muted-foreground/50",
                day_disabled: "text-muted-foreground/40",
              }}
            />

            <div className="mt-2 space-y-2 text-sm">
              {(["from", "to"] as const).map((campo) => (
                <div key={campo} className="flex items-center gap-2">
                  <span className="w-8 text-muted-foreground">{campo === "from" ? "De" : "Até"}</span>
                  <input
                    type="date"
                    value={paraInputData(rascunho[campo])}
                    onChange={(e) =>
                      setRascunho((r) => ({
                        ...r,
                        [campo]: combinar(e.target.value, paraHora(r[campo]) || (campo === "from" ? "00:00" : "23:59")),
                        preset: undefined,
                      }))
                    }
                    className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                  <input
                    type="time"
                    value={paraHora(rascunho[campo]) || (campo === "from" ? "00:00" : "23:59")}
                    onChange={(e) =>
                      setRascunho((r) => ({
                        ...r,
                        [campo]: combinar(paraInputData(r[campo]), e.target.value),
                        preset: undefined,
                      }))
                    }
                    className="w-[84px] rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              {limpavel && temValor && (
                <Button type="button" variant="ghost" size="sm" onClick={limpar}>
                  Limpar
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-primary px-6 text-primary hover:bg-primary hover:text-primary-foreground"
                onClick={aplicar}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default CalendarDateFuture;
