// Componentes compartilhados do módulo Facilities.
import { catColor, STATUS_LABEL, type SolicStatus } from "./lib";
import { cn } from "@/lib/utils";

export function CatDot({ cat, label = false, className }: { cat: string | null | undefined; label?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: catColor(cat) }} />
      {label && <span className="text-[12px] text-muted-foreground">{cat ?? "—"}</span>}
    </span>
  );
}

const STATUS_STYLE: Record<SolicStatus, string> = {
  solicitado: "bg-teal-50 text-teal-700 border-teal-200",
  em_cotacao: "bg-violet-50 text-violet-700 border-violet-200",
  aguardando_aprovacao: "bg-amber-50 text-amber-700 border-amber-200",
  aprovado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  comprado: "bg-slate-100 text-slate-600 border-slate-200",
  recusado: "bg-rose-50 text-rose-700 border-rose-200",
};

export function StatusBadge({ status }: { status: SolicStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}
