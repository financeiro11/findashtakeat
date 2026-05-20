import { CheckCircle2, AlertTriangle, AlertOctagon, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DashboardMetricas, HealthStatus, calcStatus, periodoLabel } from "./metrics";
import { fmtBRLShort, fmtPct, fmtMeses } from "./format";

interface Props {
  metricas: DashboardMetricas;
  headline?: string | null;
  subTexto?: string | null;
  onPlanoReducao: () => void;
  onAbrirBridge: () => void;
}

const COLORS: Record<HealthStatus, { bar: string; pill: string; icon: typeof CheckCircle2; label: string }> = {
  verde: { bar: "bg-pos", pill: "bg-pos-soft text-pos", icon: CheckCircle2, label: "OK" },
  ambar: { bar: "bg-warn", pill: "bg-warn-soft text-warn", icon: AlertTriangle, label: "ATENÇÃO" },
  vermelho: { bar: "bg-neg", pill: "bg-neg-soft text-neg", icon: AlertOctagon, label: "CRÍTICO" },
};

function Pulse({ label, valor, sub, tone }: { label: string; valor: string; sub: string; tone: "pos" | "neg" | "warn" | "muted" }) {
  const cls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-warn" : "text-foreground";
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("num text-[20px] font-semibold leading-none", cls)}>{valor}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export function HealthStrip({ metricas, headline, subTexto, onPlanoReducao, onAbrirBridge }: Props) {
  const status = calcStatus(metricas);
  const { bar, pill, icon: Icon, label } = COLORS[status];

  const receitaTone = metricas.receitaBruta > 0 ? "pos" : "muted";
  const margemTone = metricas.margemEbitda > 0 ? "pos" : metricas.margemEbitda > -10 ? "warn" : "neg";
  const runwayTone = metricas.runwayMeses >= 6 ? "pos" : metricas.runwayMeses >= 3 ? "warn" : "neg";

  return (
    <section className="card-surface relative flex items-stretch overflow-hidden">
      <div className={cn("w-1 shrink-0", bar)} aria-hidden />
      <div className="flex flex-1 items-center gap-6 px-5 py-4">
        {/* esquerda: status + headline */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4", status === "verde" ? "text-pos" : status === "ambar" ? "text-warn" : "text-neg")} />
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", pill)}>
              {label} · {periodoLabel(metricas.periodo)}
            </span>
          </div>
          <h2 className="mt-2 text-[15px] font-semibold leading-snug text-foreground">
            {headline ?? defaultHeadline(metricas, status)}
          </h2>
          {(subTexto || true) && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {subTexto ?? defaultSub(metricas)}
            </p>
          )}
        </div>

        {/* centro: 3 pulsos */}
        <div className="hidden lg:grid grid-cols-3 gap-8 shrink-0 px-2">
          <Pulse
            label="Receita"
            valor={fmtBRLShort(metricas.receitaBruta)}
            sub={`${fmtPct(deltaPct(metricas.receitaBruta, metricas.receitaLiquida))} liq.`}
            tone={receitaTone}
          />
          <Pulse
            label="Margem EBITDA"
            valor={`${metricas.margemEbitda.toFixed(1).replace(".", ",")}%`}
            sub={fmtBRLShort(metricas.ebitda)}
            tone={margemTone}
          />
          <Pulse
            label="Runway"
            valor={fmtMeses(metricas.runwayMeses)}
            sub={`meta ≥ 6 meses`}
            tone={runwayTone}
          />
        </div>

        {/* direita: ações */}
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <Button size="sm" onClick={onPlanoReducao} className="gap-1.5">
            Plano de redução <ChevronRight className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="outline" onClick={onAbrirBridge}>
            Abrir bridge
          </Button>
        </div>
      </div>
    </section>
  );
}

function deltaPct(a: number, b: number) {
  if (!a) return 0;
  return ((b - a) / a) * 100;
}

function defaultHeadline(m: DashboardMetricas, status: HealthStatus): string {
  if (status === "vermelho") return "Operacional negativo pressionando o caixa";
  if (status === "ambar") return "Crescimento sustentado mas queima ainda relevante";
  return "Mês saudável, indicadores dentro da meta";
}
function defaultSub(m: DashboardMetricas) {
  return `EBITDA ${fmtBRLShort(m.ebitda)} · Margem ${m.margemEbitda.toFixed(1)}% · Saldo ${fmtBRLShort(m.saldoCaixa)} · Burn 3m ${fmtBRLShort(m.burnMedio3m)}/mês.`;
}
