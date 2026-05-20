import { Wallet, Banknote, Scale, TrendingUp, Coins, AlertTriangle } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtBRL, pctDelta } from "./utils";
import type { BalanceteTotals } from "./types";

interface Props {
  totals: BalanceteTotals | null;
  prevTotals: BalanceteTotals | null;
  loading: boolean;
}

export function BalanceteKpis({ totals, prevTotals, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
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
  }> = [
    { label: "Ativo total", value: totals.ativo_total, prev: prevTotals?.ativo_total, icon: Wallet },
    { label: "Passivo total", value: totals.passivo_total, prev: prevTotals?.passivo_total, inverse: true, icon: Scale },
    { label: "Patrimônio líquido", value: totals.patrimonio_liquido, prev: prevTotals?.patrimonio_liquido, icon: TrendingUp },
    { label: "Resultado acumulado", value: totals.resultado_acumulado, prev: prevTotals?.resultado_acumulado, icon: Coins },
    { label: "Disponibilidades", value: totals.disponibilidades, prev: prevTotals?.disponibilidades, icon: Banknote },
    { label: "Obrigações de curto prazo", value: totals.obrigacoes_curto_prazo, prev: prevTotals?.obrigacoes_curto_prazo, inverse: true, icon: AlertTriangle },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {items.map((it) => {
        const delta = pctDelta(it.value, it.prev);
        return (
          <KpiCard
            key={it.label}
            label={it.label}
            value={fmtBRL(it.value, { compact: true })}
            subline={fmtBRL(it.value)}
            deltaMonth={delta ?? undefined}
            inverse={it.inverse}
          />
        );
      })}
    </div>
  );
}
