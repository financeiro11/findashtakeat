import { cn } from "@/lib/utils";
import type { Selo } from "@/lib/cac";

/* O mesmo selo aparece na matriz e na aba de regras. Na matriz ele divide a
   célula do rótulo com o nome da linha, então vai no formato curto — um "✓"
   basta para dizer "esse número já foi batido". Na aba de regras, onde a
   coluna é só dele, vai por extenso. */
const UI: Record<Selo, { curto: string; longo: string; classe: string }> = {
  ok:       { curto: "✓",          longo: "conferido", classe: "bg-pos-soft text-pos" },
  conferir: { curto: "conferir",   longo: "conferir",  classe: "bg-warn-soft text-warn" },
  semregra: { curto: "sem regra",  longo: "sem regra", classe: "bg-neg-soft text-neg" },
  zero:     { curto: "zero",       longo: "zero",      classe: "bg-muted text-muted-foreground" },
};

export function SeloRegra({ selo, nota, longo, className }: {
  selo: Selo;
  /** A nota da regra, que vira o hover — é onde mora o "por que conferir". */
  nota?: string | null;
  longo?: boolean;
  className?: string;
}) {
  const ui = UI[selo];
  return (
    <span
      title={nota || undefined}
      className={cn(
        "inline-flex flex-none items-center rounded-[3px] px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.04em]",
        ui.classe,
        nota && "cursor-help",
        className,
      )}
    >
      {longo ? ui.longo : ui.curto}
    </span>
  );
}
