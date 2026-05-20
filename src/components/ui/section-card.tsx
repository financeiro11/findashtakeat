import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface SectionCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}

export function SectionCard({ title, subtitle, actions, children, className, padded = true }: SectionCardProps) {
  return (
    <section className={cn("card-surface flex flex-col", className)}>
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn(padded ? "p-4" : "")}>{children}</div>
    </section>
  );
}
