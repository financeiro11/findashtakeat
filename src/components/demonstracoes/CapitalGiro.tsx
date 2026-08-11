/* ============================================================
 *  Card "Necessidade de capital de giro" da aba Análises da DRE.
 *
 *  Quanto SAI do caixa por mês para a operação girar. A fonte é o
 *  Omie (contas a pagar), pré-calculada pela edge `omie-capital-giro-sync`
 *  e servida pela tabela `omie_capital_giro_snapshot` — aqui não há
 *  conta, só leitura e desenho.
 *
 *  Regime: CAIXA. O ponto de equilíbrio ao lado é competência (lê a
 *  DRE). Os dois números não batem de propósito.
 *
 *  Vinha inline no /caixa; virou componente quando as duas análises
 *  mudaram de casa para a DRE.
 * ============================================================ */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import { fmtBRLShort as fmtBRLShortStr, fmtPct } from "@/pages/dashboard/format";

const sb = supabase as any;

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/* Abreviado na tela mostra o valor cheio no hover; a variante …Str é a que
   pode entrar em template literal (ver CLAUDE.md). */
const fmtBRLShort = (n: number) => comValorExato(n, fmtBRLShortStr(n));
const fmtBRL = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
// "2026-06" → "Junho 2026" / "Jun/26"
const fmtMesRef = (mes: string) => { const [y, m] = mes.split("-").map(Number); return `${MESES[(m || 1) - 1]} ${y}`; };
const fmtMesCurto = (mes: string) => { const [y, m] = mes.split("-").map(Number); return `${MESES[(m || 1) - 1].slice(0, 3)}/${String(y).slice(-2)}`; };
const mesAnteriorStr = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  const pm = m > 1 ? m - 1 : 12;
  const py = m > 1 ? y : y - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
};

type CapitalGiroMes = {
  mes: string;
  necessidade_total: number;
  fechado: boolean;
  parcial: boolean;
  [grupo: string]: number | string | boolean; // custos, pessoal, marketing, admin, tecnologia, impostos, excl_*
};
export type CapitalGiroSnapshot = {
  meses: CapitalGiroMes[];
  mes_referencia: string;        // último mês fechado (ex.: "2026-06")
  necessidade_mes: number;       // necessidade do mês de referência (destaque)
  necessidade_mes_anterior: number;
  run_rate_2m: number;
  run_rate_3m: number;           // média móvel dos últimos 3 meses fechados
  var_mom_pct: number;           // variação vs. mês anterior (%)
  grupos_op: string[];
  grupos_label: Record<string, string>;
  mes_atual_parcial: string;
  definicao: string;
  metodo: string;
  sincronizado_em: string;
};

const Footnote = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[10.5px] leading-snug text-muted-foreground/80">{children}</p>
);

export default function CapitalGiro() {
  const [cg, setCg] = useState<CapitalGiroSnapshot | null>(null);

  /* Carrega em silêncio: tabela ausente/vazia só esconde o card, nunca
     derruba a aba inteira. */
  useEffect(() => {
    (async () => {
      const { data } = await sb
        .from("omie_capital_giro_snapshot").select("dados")
        .order("gerado_em", { ascending: false }).limit(1).maybeSingle();
      setCg((data?.dados as CapitalGiroSnapshot) ?? null);
    })();
  }, []);

  if (!cg) return null;

  const mesRef = cg.meses.find((m) => m.mes === cg.mes_referencia);
  const grupos = cg.grupos_op
    .map((g) => ({ key: g, label: cg.grupos_label[g] ?? g, valor: Number((mesRef as any)?.[g] ?? 0) }))
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const maxGrupo = Math.max(1, ...grupos.map((g) => g.valor));
  const diff3m = cg.necessidade_mes - cg.run_rate_3m;         // destaque vs. média móvel 3m
  const pct3m = cg.run_rate_3m ? (diff3m / cg.run_rate_3m) * 100 : 0;

  return (
    <div className="card-surface p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="eyebrow">Necessidade de capital de giro</div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Saídas operacionais previstas por mês · fonte Omie (contas a pagar)
            {cg.mes_atual_parcial ? ` · ${fmtMesCurto(cg.mes_atual_parcial)} ainda parcial` : ""}
          </p>
        </div>
        <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
          Sincronizado {new Date(cg.sincronizado_em).toLocaleDateString("pt-BR")} {fmtHora(cg.sincronizado_em)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
        {/* Destaque: mês de referência (mês anterior fechado) */}
        <div className="flex flex-col gap-2 lg:border-r lg:border-border/60 lg:pr-4">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold text-foreground">{fmtMesRef(cg.mes_referencia)}</span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">mês fechado</span>
          </div>
          <div className="num text-[30px] font-semibold leading-none tracking-tight text-foreground">{fmtBRL(cg.necessidade_mes)}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn(
              "num inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
              cg.var_mom_pct > 0 ? "bg-neg/10 text-neg" : "bg-pos/10 text-pos",
            )}>
              {cg.var_mom_pct > 0 ? "▲" : "▼"} {fmtPct(Math.abs(cg.var_mom_pct))}
            </span>
            <span className="text-[11px] text-muted-foreground">
              vs. {fmtMesCurto(mesAnteriorStr(cg.mes_referencia))} ({fmtBRLShort(cg.necessidade_mes_anterior)})
            </span>
          </div>
          <Footnote>Custos, pessoal, marketing, admin, tecnologia e impostos · exclui transferências, CAPEX, captação e financeiras</Footnote>
        </div>

        {/* Comparação: média móvel + composição */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
              <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Média móvel · 3 meses</div>
              <div className="num mt-1 text-[18px] font-semibold text-foreground">{fmtBRLShort(cg.run_rate_3m)}</div>
              <div className={cn("num mt-0.5 text-[11px] font-medium", diff3m >= 0 ? "text-neg" : "text-pos")}>
                ref. {fmtPct(pct3m)} vs. média
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
              <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Média móvel · 2 meses</div>
              <div className="num mt-1 text-[18px] font-semibold text-foreground">{fmtBRLShort(cg.run_rate_2m)}</div>
              <div className="num mt-0.5 text-[11px] text-muted-foreground">tendência recente</div>
            </div>
            <div className="col-span-2 rounded-lg border border-border/60 bg-secondary/30 p-2.5 sm:col-span-1">
              <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Mês anterior</div>
              <div className="num mt-1 text-[18px] font-semibold text-foreground">{fmtBRLShort(cg.necessidade_mes_anterior)}</div>
              <div className="num mt-0.5 text-[11px] text-muted-foreground">{fmtMesCurto(mesAnteriorStr(cg.mes_referencia))}</div>
            </div>
          </div>

          {/* Composição do mês de referência */}
          {grupos.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Composição · {fmtMesRef(cg.mes_referencia)}</div>
              <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
                {grupos.map((g) => (
                  <div key={g.key} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-[11px] text-muted-foreground" title={g.label}>{g.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${(g.valor / maxGrupo) * 100}%` }} />
                    </div>
                    <span className="num w-[68px] shrink-0 text-right text-[11px] font-medium text-foreground">{fmtBRLShort(g.valor)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
