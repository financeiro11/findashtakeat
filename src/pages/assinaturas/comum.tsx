// Componentes compartilhados pelas abas de /assinaturas (Recorrência e Churn).
// Os helpers puros (formatação, delta, metadados de nível) ficam em ./fmt.

import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { type Aba, fmtInt, fmtPct1 } from "./fmt";
import { desvio } from "./orcadoBp";

/* ------------------------------ seletor de aba ------------------------------ */
export function SeletorAba({ aba, setAba }: { aba: Aba; setAba: (a: Aba) => void }) {
  return (
    <div className="flex rounded-md border border-border bg-card p-0.5">
      {([["recorrencia", "Recorrência"], ["churn", "Churn"]] as const).map(([v, rotulo]) => (
        <button
          key={v}
          onClick={() => setAba(v)}
          className={cn(
            "rounded px-3 py-1 text-[12.5px] font-medium transition",
            aba === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ realizado vs orçado ------------------------------ */
/**
 * Linha "BP <orçado> ▲ <desvio>" usada dentro dos blocos que já existem, em vez de uma
 * seção separada de orçamento. Meses anteriores à reancoragem do BP entram esmaecidos,
 * porque comparam contra a projeção antiga.
 */
export function VsOrcado({
  real, orcado, formatar, inverso, preRevisao, ancora, rotulo = "BP", delta: modo = "pct",
}: {
  real: number;
  orcado: number | null | undefined;
  formatar: (n: number) => React.ReactNode;
  /** true quando ficar ABAIXO do orçado é o bom resultado (churn). */
  inverso?: boolean;
  preRevisao?: boolean;
  ancora?: boolean;
  rotulo?: string;
  /** "pct" mostra o desvio relativo; "abs" mostra a diferença em unidades (clientes). */
  delta?: "pct" | "abs";
}) {
  const d = desvio(real, orcado);
  if (!d) return <span className="text-muted-foreground">sem orçado no BP</span>;

  const bom = inverso ? !d.acima : d.acima;
  const texto = modo === "abs" || d.pct == null
    ? `${d.acima ? "+" : "−"}${fmtInt(Math.abs(d.abs))}`
    : `${d.acima ? "+" : "−"}${fmtPct1(Math.abs(d.pct))}`;

  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5", preRevisao && "opacity-60")}>
      <span>{rotulo}</span>
      <span className="num font-semibold text-foreground">{formatar(orcado as number)}</span>
      {ancora ? (
        <span className="text-muted-foreground/70">· mês da reancoragem</span>
      ) : (
        <span className={cn("num font-semibold", bom ? "text-pos" : "text-neg")}>{texto}</span>
      )}
      {preRevisao && <span className="text-muted-foreground/70">· pré-revisão</span>}
    </span>
  );
}

/* ------------------------------ card de KPI ------------------------------ */
export function KpiCard({
  eyebrow, valor, delta: d, icon, rodape, extra, inverso,
}: {
  eyebrow: string;
  valor: React.ReactNode;
  delta?: { pct: number; up: boolean } | null;
  icon: React.ReactNode;
  rodape?: React.ReactNode;
  extra?: React.ReactNode;
  /** true quando subir é ruim (churn): inverte as cores da variação. */
  inverso?: boolean;
}) {
  const bom = d ? (inverso ? !d.up : d.up) : false;
  return (
    <div className="card-surface flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <div className="eyebrow">{eyebrow}</div>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      </div>
      <div className="num text-[26px] font-semibold leading-none tracking-tight text-foreground">{valor}</div>
      {d ? (
        <div className={cn("flex items-center gap-1 text-[11.5px] font-medium", bom ? "text-pos" : "text-neg")}>
          {d.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          vs mês ant. {fmtPct1(Math.abs(d.pct))}
          {rodape && <span className="ml-1 font-normal text-muted-foreground">· {rodape}</span>}
        </div>
      ) : rodape ? (
        <div className="text-[11.5px] text-muted-foreground">{rodape}</div>
      ) : null}
      {extra && <div className="mt-auto border-t border-border/40 pt-2 text-[11px] text-muted-foreground">{extra}</div>}
    </div>
  );
}
