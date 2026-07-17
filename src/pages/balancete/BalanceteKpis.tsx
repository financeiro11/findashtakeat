import { Wallet, Banknote, Scale, TrendingUp, Coins, AlertTriangle } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtBRL, pctDelta } from "./utils";
import type { BalanceteTotals } from "./types";

interface Props {
  totals: BalanceteTotals | null;
  prevTotals: BalanceteTotals | null;
  loading: boolean;
  /** Rótulo do comparativo, ex.: "vs mês ant." (Balancete) ou "vs trim. ant." (Balanço). */
  deltaLabel?: string;
}

export function BalanceteKpis({ totals, prevTotals, loading, deltaLabel = "vs mês ant." }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[124px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (!totals) return null;

  const items: Array<{
    label: string;
    value: number;
    prev?: number;
    inverse?: boolean;
    icon: any;
    iconClassName: string;
  }> = [
    { label: "Ativo total", value: totals.ativo_total, prev: prevTotals?.ativo_total, icon: Wallet, iconClassName: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400" },
    { label: "Passivo total", value: totals.passivo_total, prev: prevTotals?.passivo_total, inverse: true, icon: Scale, iconClassName: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" },
    { label: "Patrimônio líquido", value: totals.patrimonio_liquido, prev: prevTotals?.patrimonio_liquido, icon: TrendingUp, iconClassName: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400" },
    { label: "Resultado acumulado", value: totals.resultado_acumulado, prev: prevTotals?.resultado_acumulado, icon: Coins, iconClassName: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400" },
    { label: "Disponibilidades", value: totals.disponibilidades, prev: prevTotals?.disponibilidades, icon: Banknote, iconClassName: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400" },
    { label: "Obrigações de curto prazo", value: totals.obrigacoes_curto_prazo, prev: prevTotals?.obrigacoes_curto_prazo, inverse: true, icon: AlertTriangle, iconClassName: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((it) => {
        const delta = pctDelta(it.value, it.prev);
        return (
          <KpiCard
            key={it.label}
            label={it.label}
            value={fmtBRL(it.value, { compact: true })}
            subline={fmtBRL(it.value)}
            deltaMonth={delta ?? undefined}
            deltaMonthLabel={deltaLabel}
            inverse={it.inverse}
            icon={it.icon}
            iconClassName={it.iconClassName}
          />
        );
      })}
    </div>
  );
}
