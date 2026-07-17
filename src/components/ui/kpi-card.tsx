import { Delta } from "@/components/ui/delta";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";

export type KpiStat = {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "warn" | "muted";
};

interface KpiCardProps {
  label: string;
  value: string;
  valueTone?: "pos" | "neg" | "neutral";
  deltaMonth?: number;
  deltaMonthLabel?: string;
  deltaBudget?: number;
  inverse?: boolean;
  spark?: number[];
  sparkColor?: string;
  budgetValue?: string;
  budgetProgress?: number;
  subline?: string;
  stats?: KpiStat[];
  footnote?: string;
  className?: string;
  /** Ícone opcional exibido num selo colorido no canto superior direito (ignorado se `spark` estiver presente). */
  icon?: React.ComponentType<{ className?: string }>;
  /** Classes de cor do selo do ícone, ex.: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400". */
  iconClassName?: string;
}

const toneClass = (t?: KpiStat["tone"]) =>
  t === "pos" ? "text-pos" :
  t === "neg" ? "text-neg" :
  t === "warn" ? "text-warn" :
  "text-foreground";

export function KpiCard({
  label, value, valueTone = "neutral", deltaMonth, deltaMonthLabel = "vs mês ant.", deltaBudget, inverse,
  spark, sparkColor, budgetValue, budgetProgress, subline, stats, footnote, className,
  icon: Icon, iconClassName,
}: KpiCardProps) {
  const valueColor =
    valueTone === "pos" ? "text-pos" :
    valueTone === "neg" ? "text-neg" :
    "text-foreground";

  return (
    <div className={cn("card-surface relative p-4 flex flex-col gap-2.5", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{label}</div>
        {spark ? (
          <Sparkline data={spark} color={sparkColor ?? "hsl(var(--pos))"} fill width={88} height={24} />
        ) : Icon ? (
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconClassName ?? "bg-secondary text-foreground/70")}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>

      <div className={cn("num text-[26px] font-semibold leading-none tracking-tight", valueColor)}>
        {value}
      </div>
      {subline && (
        <div className="num text-[12px] -mt-0.5 text-muted-foreground">{subline}</div>
      )}

      {stats && stats.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          {stats.map((s, i) => (
            <div key={i} className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80 truncate">{s.label}</span>
              <span className={cn("num text-[12px] font-semibold truncate", toneClass(s.tone))}>{s.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-5 text-[11px] text-muted-foreground">
          {deltaMonth !== undefined && (
            <div className="flex items-center gap-1.5">
              <span>{deltaMonthLabel}</span>
              <Delta value={deltaMonth} inverse={inverse} />
            </div>
          )}
          {deltaBudget !== undefined && (
            <div className="flex items-center gap-1.5">
              <span>vs orçado</span>
              <Delta value={deltaBudget} inverse={inverse} />
            </div>
          )}
        </div>
      )}

      {footnote && (
        <div className="text-[10px] text-muted-foreground/80 pt-0.5 border-t border-border/40 mt-1 pt-2">
          {footnote}
        </div>
      )}

      {budgetValue !== undefined && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>Orçado</span>
            <span className="num text-foreground/80">{budgetValue}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, (budgetProgress ?? 0) * 100))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
