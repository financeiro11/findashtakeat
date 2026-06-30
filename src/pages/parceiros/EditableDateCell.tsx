import { useState } from "react";
import { CalendarIcon, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Table = "parceiros_indicacoes" | "parceiros_recorrencias";
type Field = "data_indicacao" | "data_venda" | "data_cancelamento";

function toIsoDate(d: Date): string {
  // YYYY-MM-DD (date column, no timezone shift)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  } catch { return iso; }
}

export function EditableDateCell({
  table, id, field, value, emptyLabel = "Definir", onSaved, allowEditWhenFilled = false,
}: {
  table: Table;
  id: string;
  field: Field;
  value: string | null;
  emptyLabel?: string;
  onSaved?: () => void;
  allowEditWhenFilled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(value ? new Date(`${value.slice(0,10)}T12:00:00`) : undefined);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!date) return;
    setSaving(true);
    try {
      const iso = toIsoDate(date);
      const { error } = await supabase.from(table).update({ [field]: iso } as any).eq("id", id);
      if (error) throw error;
      toast.success("Data atualizada");
      setOpen(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar data");
    } finally {
      setSaving(false);
    }
  };

  if (value && !allowEditWhenFilled) {
    return <span className="tabular-nums text-muted-foreground">{fmtDate(value)}</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              {value ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-foreground hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                  <span className="tabular-nums">{fmtDate(value)}</span>
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              ) : (
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border border-dashed border-primary/40 px-1.5 py-0.5",
                    "text-[10.5px] text-primary hover:bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  )}
                >
                  <CalendarIcon className="h-3 w-3" />
                  {emptyLabel}
                </button>
              )}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[11.5px]">
            {value ? "Editar data" : "Clique para definir a data"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
        <div className="flex items-center justify-between gap-2 border-t border-border p-2">
          <Badge variant="outline" className="text-[10.5px]">
            {field === "data_indicacao" ? "Data indicação" : field === "data_venda" ? "Data venda" : "Data cancelamento"}
          </Badge>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-7 text-[11.5px]" disabled={!date || saving} onClick={save}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
