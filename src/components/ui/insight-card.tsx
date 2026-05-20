import { cn } from "@/lib/utils";
import { AlertTriangle, Flame, TrendingUp, ArrowRight } from "lucide-react";

type Severity = "critico" | "atencao" | "info";

interface InsightCardProps {
  severity: Severity;
  time: string;
  title: string;
  description: string;
  cta: string;
  className?: string;
}

const ICONS: Record<Severity, React.ComponentType<{ className?: string }>> = {
  critico: Flame,
  atencao: AlertTriangle,
  info: TrendingUp,
};

const LABEL: Record<Severity, string> = {
  critico: "CRÍTICO",
  atencao: "ATENÇÃO",
  info: "INFO",
};

export function InsightCard({ severity, time, title, description, cta, className }: InsightCardProps) {
  const Icon = ICONS[severity];
  return (
    <article className={cn("border-b border-border px-4 py-3 last:border-b-0", className)}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={cn("insight-tag", severity)}>
          <Icon className="h-3 w-3" /> {LABEL[severity]}
        </span>
        <span className="text-[10.5px] text-muted-foreground">{time}</span>
      </div>
      <h4 className="text-[13px] font-semibold leading-snug text-foreground">{title}</h4>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      <button className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
        {cta} <ArrowRight className="h-3 w-3" />
      </button>
    </article>
  );
}
