import { useEffect, useMemo, useState } from "react";
import { KpiCard, type KpiStat } from "@/components/ui/kpi-card";
import { Greeting } from "./dashboard/Greeting";
import { AskAIBar } from "./dashboard/AskAIBar";
import { HealthStrip } from "./dashboard/HealthStrip";
import { useFinanceData } from "./dashboard/useFinanceData";
import { fmtBRL, fmtBRLShort, fmtPct, fmtMeses } from "./dashboard/format";
import { calcMetricas, subMeses, periodoLabel, rankingCrescimento, serieDerivada, calcBridge, detectarAnomalias, GRUPOS } from "./dashboard/metrics";
import { openFinanceAI } from "@/components/FinanceAIPanel";
import { SectionCard } from "@/components/ui/section-card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart, Line, Cell, Area, AreaChart, Legend, ReferenceLine, PieChart, Pie, RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";
import { Loader2, Sparkles, RefreshCw, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export default function Dashboard() {
  const fd = useFinanceData();

  const m = fd.metricas;
  const ma = fd.metricasAnt;
  const m12 = fd.metricas12m;

  const deltaPct = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : 0);

  // Séries de sparklines (12m) — hooks sempre chamados, mesmo durante loading
  const sparkReceita = useMemo(
    () => fd.periodos12m.map((p) => (fd.rows.length ? calcMetricas(fd.rows, p, fd.saldoInicial).receitaBruta : 0)),
    [fd.rows, fd.periodos12m, fd.saldoInicial],
  );
  const sparkEbitda = useMemo(
    () => fd.periodos12m.map((p) => (fd.rows.length ? calcMetricas(fd.rows, p, fd.saldoInicial).ebitda : 0)),
    [fd.rows, fd.periodos12m, fd.saldoInicial],
  );
  const sparkSaldo = useMemo(
    () => fd.periodos12m.map((p) => (fd.rows.length ? calcMetricas(fd.rows, p, fd.saldoInicial).saldoCaixa : 0)),
    [fd.rows, fd.periodos12m, fd.saldoInicial],
  );
  const sparkBurn = useMemo(
    () => fd.periodos12m.map((p) => (fd.rows.length ? calcMetricas(fd.rows, p, fd.saldoInicial).cashburn : 0)),
    [fd.rows, fd.periodos12m, fd.saldoInicial],
  );

  const ranking = useMemo(
    () => (m ? rankingCrescimento(fd.rows, m.periodo) : []),
    [fd.rows, m?.periodo.ano, m?.periodo.mes],
  );
  const maxRanking = Math.max(...ranking.map((r) => r.crescPct), 1);

  const trendData = useMemo(
    () => fd.periodos12m.map((p) => {
      if (!fd.rows.length) return { mes: periodoLabel(p), receita: 0, ebitda: 0, margem: 0 };
      const x = calcMetricas(fd.rows, p, fd.saldoInicial);
      return {
        mes: periodoLabel(p),
        receita: Math.round(x.receitaLiquida),
        ebitda: Math.round(x.ebitda),
        margem: Number(x.margemEbitda.toFixed(1)),
      };
    }),
    [fd.rows, fd.periodos12m, fd.saldoInicial],
  );

  const dreData = useMemo(
    () => fd.periodos12m.map((p) => {
      if (!fd.rows.length) return { mes: periodoLabel(p), pessoal: 0, mkt: 0, custos: 0, adm: 0 };
      const x = calcMetricas(fd.rows, p, fd.saldoInicial);
      return {
        mes: periodoLabel(p),
        pessoal: Math.round(Math.abs(x.pessoal)),
        mkt: Math.round(Math.abs(x.mktVendas)),
        custos: Math.round(Math.abs(x.custosOp)),
        adm: Math.round(Math.abs(x.admImpFin)),
      };
    }),
    [fd.rows, fd.periodos12m, fd.saldoInicial],
  );

  if (fd.loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando dados financeiros…
      </div>
    );
  }
  if (fd.error || !m || !ma) {
    return (
      <div className="card-surface mx-auto mt-8 max-w-md p-6 text-center">
        <div className="text-[13px] font-semibold text-neg mb-2">Falha ao carregar dados</div>
        <div className="text-[12px] text-muted-foreground mb-3">{fd.error ?? "Sem dados disponíveis"}</div>
        <button onClick={fd.reload} className="rounded-md bg-primary px-3 py-1.5 text-[12px] text-primary-foreground">
          Tentar novamente
        </button>
      </div>
    );
  }

  function askAI(prompt: string) {
    const ctx = {
      periodo: periodoLabel(m.periodo),
      receita_bruta: m.receitaBruta,
      receita_liquida: m.receitaLiquida,
      ebitda: m.ebitda,
      margem_ebitda_pct: m.margemEbitda,
      saldo_caixa: m.saldoCaixa,
      cashburn: m.cashburn,
      burn_medio_3m: m.burnMedio3m,
      runway_meses: m.runwayMeses,
      pessoal: m.pessoal,
      mkt_vendas: m.mktVendas,
      custos_op: m.custosOp,
      adm_imp_fin: m.admImpFin,
      top_rubricas_crescimento: ranking.slice(0, 5).map(r => ({ metrica: r.metrica, grupo: r.grupo, cresc_pct: r.crescPct.toFixed(1), atual: r.atual, base: r.base })),
    };
    openFinanceAI(prompt);
    window.dispatchEvent(new CustomEvent("finance-ai:context", { detail: ctx }));
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Greeting
        periodo={m.periodo}
        periodosDisponiveis={fd.periodosDisponiveis}
        onPeriodoChange={fd.setPeriodo}
        onNovaAnalise={() => askAI("Faça uma análise financeira completa deste mês.")}
        onPerguntarIA={() => askAI("")}
      />

      <AskAIBar onAsk={askAI} />

      <HealthStrip
        metricas={m}
        onPlanoReducao={() => askAI("Liste sugestões priorizadas de cortes de despesas com impacto estimado em runway.")}
        onAbrirBridge={() => document.getElementById("bridge-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />

      {/* KPI Row */}
      {(() => {
        const dReceitaMes = deltaPct(m.receitaBruta, ma.receitaBruta);
        const dReceita12m = m12 ? deltaPct(m.receitaBruta, m12.receitaBruta) : 0;
        const dEbitdaMes = deltaPct(m.ebitda, ma.ebitda);
        const dEbitda12m = m12 ? deltaPct(m.ebitda, m12.ebitda) : 0;
        const deltaSaldo = m.saldoCaixa - ma.saldoCaixa;
        const dSaldo12m = m12 ? deltaPct(m.saldoCaixa, m12.saldoCaixa) : 0;
        const origemSaldo = Math.abs(m.novosEmprestimos) > Math.abs(m.fco) ? "Captação" : m.fco >= 0 ? "Operacional" : "Misto";
        const startPeriodo = fd.periodos12m[0];
        const saldoInicio = m12?.saldoCaixa ?? fd.saldoInicial;
        const tonePct = (v: number, inv = false): KpiStat["tone"] => {
          const eff = inv ? -v : v;
          return eff > 0 ? "pos" : eff < 0 ? "neg" : "muted";
        };

        const orcReceita = fd.orcado(["Receita Bruta", "Receita", "Receita Líquida"], m.periodo);
        const orcEbitda = fd.orcado(["EBITDA"], m.periodo);
        const dReceitaOrc = orcReceita && orcReceita !== 0 ? ((m.receitaBruta - orcReceita) / Math.abs(orcReceita)) * 100 : null;
        const dEbitdaOrc = orcEbitda && orcEbitda !== 0 ? ((m.ebitda - orcEbitda) / Math.abs(orcEbitda)) * 100 : null;

        const receitaStats: KpiStat[] = [
          { label: "vs mês ant.", value: fmtPct(dReceitaMes), tone: tonePct(dReceitaMes) },
          { label: "12m atrás", value: fmtPct(dReceita12m), tone: tonePct(dReceita12m) },
          { label: "vs orçado", value: dReceitaOrc != null ? fmtPct(dReceitaOrc) : "—", tone: dReceitaOrc != null ? tonePct(dReceitaOrc) : "muted" },
        ];
        const ebitdaStats: KpiStat[] = [
          { label: "margem ebitda", value: fmtPct(m.margemEbitda), tone: tonePct(m.margemEbitda) },
          { label: "vs mês ant.", value: fmtPct(dEbitdaMes), tone: tonePct(dEbitdaMes) },
          { label: "vs orçado", value: dEbitdaOrc != null ? fmtPct(dEbitdaOrc) : "—", tone: dEbitdaOrc != null ? tonePct(dEbitdaOrc) : "muted" },
        ];

        const saldoStats: KpiStat[] = [
          { label: "Δ no mês", value: fmtBRLShort(deltaSaldo), tone: deltaSaldo >= 0 ? "pos" : "neg" },
          { label: "origem", value: origemSaldo, tone: "muted" },
          { label: "vs 12m", value: fmtPct(dSaldo12m), tone: tonePct(dSaldo12m) },
        ];
        const burnStats: KpiStat[] = [
          { label: "burn médio 3m", value: fmtBRLShort(m.burnMedio3m), tone: m.burnMedio3m >= 0 ? "pos" : "neg" },
          { label: "runway", value: fmtMeses(m.runwayMeses), tone: m.runwayMeses >= 6 ? "pos" : m.runwayMeses >= 3 ? "warn" : "neg" },
          { label: "meta", value: "≥ 6 meses", tone: "muted" },
        ];

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label={`Receita Bruta · ${periodoLabel(m.periodo)}`}
              value={fmtBRL(m.receitaBruta)}
              spark={sparkReceita}
              sparkColor="hsl(var(--pos))"
              stats={receitaStats}
            />
            <KpiCard
              label={`EBITDA · ${periodoLabel(m.periodo)}`}
              value={fmtBRL(m.ebitda)}
              valueTone={m.ebitda < 0 ? "neg" : "pos"}
              spark={sparkEbitda}
              sparkColor={m.ebitda < 0 ? "hsl(var(--neg))" : "hsl(var(--pos))"}
              stats={ebitdaStats}
            />
            <KpiCard
              label="Saldo de Caixa · Estimado"
              value={fmtBRL(m.saldoCaixa)}
              valueTone={m.saldoCaixa >= 0 ? "pos" : "neg"}
              spark={sparkSaldo}
              sparkColor="hsl(var(--pos))"
              stats={saldoStats}
              footnote={`Σ FCL + saldo inicial (${periodoLabel(startPeriodo)} = ${fmtBRLShort(saldoInicio)})`}
            />
            <KpiCard
              label="Cashburn & Runway"
              value={fmtBRL(m.cashburn)}
              valueTone={m.cashburn < 0 ? "neg" : "pos"}
              spark={sparkBurn}
              sparkColor="hsl(var(--neg))"
              stats={burnStats}
              footnote="Cashburn = FCL excluindo captação extraordinária"
            />
          </div>
        );
      })()}

      {/* Bridge placeholder */}
      <div id="bridge-section" />
      <div className="grid grid-cols-1 lg:grid-cols-[2.2fr_1fr] gap-3">
        <SectionCard
          title={`Bridge de Caixa · ${periodoLabel(m.periodo)}`}
          subtitle="De onde veio e para onde foi o caixa este mês"
        >
          <BridgeView rows={fd.rows} periodo={m.periodo} saldoInicial={fd.saldoInicial} />
          {(() => {
            const steps = calcBridge(fd.rows, m.periodo, fd.saldoInicial);
            if (!steps.length) return null;
            const inicio = steps[0];
            const fim = steps[steps.length - 1];
            const variacao = fim.acumulado - inicio.acumulado;
            const movimentos = steps.filter((s) => s.tipo !== "anchor");
            const maiorEntrada = movimentos.filter((s) => s.valor > 0).sort((a, b) => b.valor - a.valor)[0];
            const maiorSaida = movimentos.filter((s) => s.valor < 0).sort((a, b) => a.valor - b.valor)[0];
            const totalSaidas = movimentos.filter((s) => s.valor < 0).reduce((s, x) => s + x.valor, 0);
            const concentracao = maiorSaida && totalSaidas ? (maiorSaida.valor / totalSaidas) * 100 : 0;
            const tone = variacao < 0 ? "neg" : "pos";
            const dotColor = tone === "neg" ? "hsl(var(--neg))" : "hsl(142 70% 38%)";
            return (
              <div className="mt-3 pt-3 border-t border-border/60">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                      Comentário IA · {periodoLabel(m.periodo)}
                    </div>
                    <p className="text-[12px] leading-relaxed text-foreground/90">
                      Caixa {variacao >= 0 ? "cresceu" : "reduziu"}{" "}
                      <span className={`num font-semibold ${variacao < 0 ? "text-neg" : "text-pos"}`}>
                        {fmtBRLShort(Math.abs(variacao))}
                      </span>{" "}
                      no mês, encerrando em{" "}
                      <span className="num font-semibold">{fmtBRLShort(fim.acumulado)}</span>.{" "}
                      {maiorEntrada && (
                        <>Principal entrada veio de <span className="font-medium">{maiorEntrada.label}</span> ({fmtBRLShort(maiorEntrada.valor)}). </>
                      )}
                      {maiorSaida && (
                        <>Maior saída foi <span className="font-medium">{maiorSaida.label}</span>{" "}
                        (<span className="text-neg num font-semibold">{fmtBRLShort(maiorSaida.valor)}</span>), {concentracao.toFixed(0)}% do total de saídas.</>
                      )}
                    </p>
                    <button
                      onClick={() => askAI(`Analise o bridge de caixa de ${periodoLabel(m.periodo)}: explique os principais movimentos de entrada e saída e aponte riscos.`)}
                      className="mt-1.5 text-[11px] text-primary hover:underline font-medium"
                    >
                      Aprofundar com IA →
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </SectionCard>
        <SectionCard
          title="Insights & Anomalias"
          subtitle="Detecções automáticas no fechamento"
        >
          <InsightsView rows={fd.rows} periodo={m.periodo} onAsk={askAI} />
        </SectionCard>
      </div>

      {/* Trend + Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
        <SectionCard
          title="Receita Líquida × EBITDA · 12 meses"
          subtitle="Receita em azul · EBITDA em violeta · Margem (%) na linha âmbar"
        >
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradReceita" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(142 70% 38%)" stopOpacity={1} />
                    <stop offset="100%" stopColor="hsl(142 70% 38%)" stopOpacity={0.8} />
                  </linearGradient>
                  <linearGradient id="gradEbitda" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0 78% 55%)" stopOpacity={1} />
                    <stop offset="100%" stopColor="hsl(0 78% 55%)" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="L" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtBRLShort(v)} />
                <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(value: any, name: any) => {
                    if (name === "margem") return [`${value}%`, "Margem"];
                    return [fmtBRLShort(Number(value)), name === "receita" ? "Receita Líq." : "EBITDA"];
                  }}
                />
                <Legend
                  verticalAlign="top"
                  height={24}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
                  formatter={(v) => v === "receita" ? "Receita Líq." : v === "ebitda" ? "EBITDA" : "Margem %"}
                />
                <Bar yAxisId="L" dataKey="receita" fill="url(#gradReceita)" radius={[3, 3, 0, 0]} barSize={14} />
                <Bar yAxisId="L" dataKey="ebitda" radius={[3, 3, 0, 0]} barSize={14}>
                  {trendData.map((d, i) => <Cell key={i} fill={d.ebitda < 0 ? "hsl(var(--neg))" : "url(#gradEbitda)"} />)}
                </Bar>
                <Line yAxisId="R" type="monotone" dataKey="margem" stroke="hsl(32 95% 50%)" strokeWidth={2.25} dot={{ r: 3, fill: "hsl(32 95% 50%)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {(() => {
            if (!trendData.length) return null;
            const last = trendData[trendData.length - 1];
            const prev = trendData[trendData.length - 2] ?? last;
            const recDelta = prev.receita ? ((last.receita - prev.receita) / Math.abs(prev.receita)) * 100 : 0;
            const ebDelta = prev.ebitda ? ((last.ebitda - prev.ebitda) / Math.abs(prev.ebitda)) * 100 : 0;
            const avgMargem = trendData.reduce((s, d) => s + (d.margem ?? 0), 0) / trendData.length;
            const margDelta = (last.margem ?? 0) - avgMargem;
            const best = trendData.reduce((a, b) => (b.ebitda > a.ebitda ? b : a));
            const worst = trendData.reduce((a, b) => (b.ebitda < a.ebitda ? b : a));
            const tone = last.ebitda < 0 ? "neg" : margDelta >= 0 ? "pos" : "warn";
            const dotColor = tone === "neg" ? "hsl(var(--neg))" : tone === "pos" ? "hsl(142 70% 38%)" : "hsl(32 95% 50%)";
            return (
              <div className="mt-3 pt-3 border-t border-border/60">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                      Comentário IA · {last.mes}
                    </div>
                    <p className="text-[12px] leading-relaxed text-foreground/90">
                      Receita {recDelta >= 0 ? "avançou" : "recuou"}{" "}
                      <span className="num font-semibold">{fmtPct(Math.abs(recDelta), 1)}</span> vs. mês anterior, com EBITDA{" "}
                      <span className={`num font-semibold ${last.ebitda < 0 ? "text-neg" : "text-pos"}`}>
                        {fmtBRLShort(last.ebitda)}
                      </span>{" "}
                      ({ebDelta >= 0 ? "+" : ""}{fmtPct(ebDelta, 1)}). Margem em{" "}
                      <span className="num font-semibold">{(last.margem ?? 0).toFixed(1)}%</span>,{" "}
                      {margDelta >= 0 ? "acima" : "abaixo"} da média 12m ({avgMargem.toFixed(1)}%). Melhor mês:{" "}
                      <span className="font-medium">{best.mes}</span> · pior:{" "}
                      <span className="font-medium">{worst.mes}</span>.
                    </p>
                    <button
                      onClick={() => askAI(`Analise a evolução de Receita Líquida e EBITDA nos últimos 12 meses e aponte tendências e riscos.`)}
                      className="mt-1.5 text-[11px] text-primary hover:underline font-medium"
                    >
                      Aprofundar com IA →
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </SectionCard>

        <SectionCard
          title="Onde estamos queimando mais"
          subtitle="Realizado no mês vs orçado do BP por rubrica"
        >
          <div className="space-y-3">
            {ranking.length === 0 && <div className="text-[12px] text-muted-foreground py-4 text-center">Sem variações relevantes no período.</div>}
            {(() => {
              const items = ranking.map((r) => {
                const orc = fd.orcado(r.metrica, m.periodo) ?? 0;
                const orcAbs = Math.abs(Number(orc));
                const realAbs = Math.abs(Number(r.atual));
                const desvio = orcAbs > 0 ? ((realAbs - orcAbs) / orcAbs) * 100 : (realAbs > 0 ? 100 : 0);
                return { ...r, orc: orcAbs, real: realAbs, desvio };
              });
              const maxVal = Math.max(...items.map((i) => Math.max(i.real, i.orc)), 1);
              return items.map((r) => {
                const realPct = (r.real / maxVal) * 100;
                const orcPct = (r.orc / maxVal) * 100;
                const acima = r.real > r.orc;
                return (
                  <button
                    key={r.metrica}
                    onClick={() => askAI(`Compare o realizado de ${r.metrica} (${fmtBRLShort(r.real)}) com o orçado (${fmtBRLShort(r.orc)}) em ${periodoLabel(m.periodo)}.`)}
                    className="block w-full text-left"
                  >
                    <div className="flex items-baseline justify-between text-[11.5px] mb-1">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">{r.metrica}</div>
                        <div className="text-[10.5px] text-muted-foreground">{r.grupo}</div>
                      </div>
                      <div className="num text-right shrink-0 pl-2">
                        <div className={`text-[10px] font-semibold ${acima ? "text-neg" : "text-pos"}`}>
                          {r.desvio >= 0 ? "+" : ""}{r.desvio.toFixed(0)}% vs orçado
                        </div>
                      </div>
                    </div>
                    <div className="space-y-[2px]">
                      {/* Orçado */}
                      <div className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Orç.</span>
                        <div className="relative h-3.5 flex-1 rounded bg-muted overflow-hidden">
                          <div
                            className="h-full bg-muted-foreground/60"
                            style={{ width: `${Math.max(2, orcPct)}%` }}
                          />
                        </div>
                        <span className="num w-14 shrink-0 text-right text-[10.5px] text-muted-foreground">{fmtBRLShort(r.orc)}</span>
                      </div>
                      {/* Realizado */}
                      <div className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-foreground">Real.</span>
                        <div className="relative h-3.5 flex-1 rounded bg-muted overflow-hidden">
                          <div
                            className={`h-full ${acima ? "bg-neg" : "bg-pos"}`}
                            style={{ width: `${Math.max(2, realPct)}%` }}
                          />
                        </div>
                        <span className="num w-14 shrink-0 text-right text-[10.5px] font-semibold text-foreground">{fmtBRLShort(r.real)}</span>
                      </div>
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </SectionCard>
      </div>

      {/* Trio analítico de receita & despesas */}
      <TrioReceitaDespesa
        rows={fd.rows}
        periodo={m.periodo}
        receitaBruta={m.receitaBruta}
        receitaLiquida={m.receitaLiquida}
        pessoalTotal={m.pessoal}
        mkt={m.mktVendas}
        custos={m.custosOp}
        adm={m.admImpFin}
      />


      <div className="text-[10.5px] text-muted-foreground text-center pt-2">
        Atualizado {fd.lastUpdate?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · {fd.rows.length} registros financeiros
      </div>
    </div>
  );
}

// --- Bridge inline (waterfall em SVG) ----------------------------------------
function BridgeView({ rows, periodo, saldoInicial }: { rows: any[]; periodo: any; saldoInicial: number }) {
  const steps = calcBridge(rows, periodo, saldoInicial);

  // Determina topo/base do "eixo" considerando saldo acumulado e tops/bottoms de cada barra
  const tops: number[] = [];
  const bottoms: number[] = [];
  steps.forEach((s) => {
    if (s.tipo === "anchor") {
      tops.push(Math.max(0, s.acumulado));
      bottoms.push(Math.min(0, s.acumulado));
    } else {
      const prev = s.acumulado - s.valor;
      tops.push(Math.max(prev, s.acumulado));
      bottoms.push(Math.min(prev, s.acumulado));
    }
  });
  const yMax = Math.max(...tops, 0);
  const yMin = Math.min(...bottoms, 0);
  const range = Math.max(yMax - yMin, 1);

  // viewBox em unidades reais, sem stretching
  const COL = 90;            // largura por coluna
  const BAR = 46;            // largura da barra
  const PAD_X = 12;
  const PAD_T = 28;          // espaço pro label de valor
  const PAD_B = 44;          // espaço pros labels embaixo
  const H = 200;             // altura útil
  const W = PAD_X * 2 + steps.length * COL;
  const totalH = PAD_T + H + PAD_B;

  const y = (v: number) => PAD_T + ((yMax - v) / range) * H;
  const zeroY = y(0);
  const xCenter = (i: number) => PAD_X + i * COL + COL / 2;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${totalH}`}
        className="w-full"
        style={{ minWidth: W * 0.7, height: totalH * 0.95, maxHeight: 280 }}
        preserveAspectRatio="xMidYMid meet"
      >
        <title>Bridge de caixa do período</title>
        <line x1={PAD_X} x2={W - PAD_X} y1={zeroY} y2={zeroY} stroke="hsl(var(--border))" strokeWidth="1" />

        {steps.map((s, i) => {
          const cx = xCenter(i);
          const xLeft = cx - BAR / 2;
          const isAnchor = s.tipo === "anchor";
          const top = isAnchor ? Math.max(0, s.acumulado) : Math.max(s.acumulado, s.acumulado - s.valor);
          const bot = isAnchor ? Math.min(0, s.acumulado) : Math.min(s.acumulado, s.acumulado - s.valor);
          const yTop = y(top);
          const yBot = y(bot);
          const h = Math.max(2, yBot - yTop);
          const fill = isAnchor
            ? "hsl(var(--foreground) / 0.85)"
            : s.tipo === "in"
            ? "hsl(var(--pos))"
            : "hsl(var(--neg))";

          const next = steps[i + 1];
          const yAcc = y(s.acumulado);

          return (
            <g key={s.key}>
              {next && (
                <line
                  x1={xLeft + BAR}
                  x2={xCenter(i + 1) - BAR / 2}
                  y1={yAcc}
                  y2={yAcc}
                  stroke="hsl(var(--border))"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              )}
              <rect x={xLeft} y={yTop} width={BAR} height={h} rx="3" fill={fill} />
              <text
                x={cx}
                y={yTop - 8}
                fontSize="12"
                fontWeight="600"
                textAnchor="middle"
                fill="hsl(var(--foreground))"
                style={{ fontFamily: "ui-monospace, 'JetBrains Mono', monospace" }}
              >
                {fmtBRLShort(isAnchor ? s.acumulado : s.valor)}
              </text>
              <text x={cx} y={PAD_T + H + 18} fontSize="11" fontWeight="500" textAnchor="middle" fill="hsl(var(--foreground))">
                {s.label}
              </text>
              <text x={cx} y={PAD_T + H + 32} fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))">
                {s.subLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// --- Insights AI (DRE + DFC + BP Anual) ------------------------------------
type AIInsight = { titulo: string; texto: string; tom: "positivo" | "neutro" | "alerta" };

function InsightsView({ rows: _rows, periodo: _periodo, onAsk }: { rows: any[]; periodo: any; onAsk: (p: string) => void }) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalIdx, setModalIdx] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<number, string>>({});
  const [detailLoading, setDetailLoading] = useState<number | null>(null);

  async function carregar(force = false) {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-dashboard-insights", { body: { force } });
      if (error) throw error;
      setInsights(Array.isArray((data as any)?.insights) ? (data as any).insights : []);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao gerar insights");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(false); }, []);

  async function abrir(i: number, it: AIInsight) {
    setModalIdx(i);
    if (detail[i]) return;
    setDetailLoading(i);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-finance-ai`;
      const message = `Aprofunde este insight sobre os dados financeiros (DRE, DFC, BP Anual) da Takeat:\n\n"${it.titulo}: ${it.texto}"\n\nDê 1) explicação detalhada com números, 2) causas prováveis, 3) 2 ações práticas.`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ message, context: { empresa: "Takeat", modulo: "Financeiro", paginaAtual: "Dashboard · Insight IA", insight: it } }),
      });
      if (!resp.ok) {
        let friendly = "A IA está temporariamente indisponível. Tente novamente em instantes.";
        try {
          const j = JSON.parse(await resp.text());
          if (j?.error && typeof j.error === "string" && !j.error.startsWith("{")) friendly = j.error;
        } catch { /* ignore */ }
        throw new Error(friendly);
      }
      const data = await resp.json();
      const text = [data.resumo, data.answer, Array.isArray(data.acoes_recomendadas) && data.acoes_recomendadas.length ? "\n**Ações:**\n" + data.acoes_recomendadas.map((x: string) => `- ${x}`).join("\n") : ""].filter(Boolean).join("\n\n");
      setDetail((p) => ({ ...p, [i]: text || "Sem resposta." }));
    } catch (e: any) {
      setDetail((p) => ({ ...p, [i]: `⚠️ ${e?.message ?? "Falha ao gerar explicação."}` }));
    } finally {
      setDetailLoading(null);
    }
  }

  function retryDetail(i: number, it: AIInsight) {
    setDetail((p) => { const n = { ...p }; delete n[i]; return n; });
    abrir(i, it);
  }

  const tomClass: Record<string, string> = {
    positivo: "border-l-pos bg-pos-soft",
    alerta: "border-l-neg bg-neg-soft",
    neutro: "border-l-foreground/30",
  };
  const tomDot: Record<string, string> = { positivo: "bg-pos", alerta: "bg-neg", neutro: "bg-muted-foreground/40" };
  const tomBadge: Record<string, string> = { positivo: "bg-pos/15 text-pos", alerta: "bg-neg/15 text-neg", neutro: "bg-muted text-muted-foreground" };
  const tomLabel: Record<string, string> = { positivo: "Positivo", alerta: "Alerta", neutro: "Neutro" };
  const ativo = modalIdx !== null ? insights[modalIdx] : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" /> IA · DRE · DFC · BP Anual
        </div>
        <button onClick={() => carregar(true)} disabled={loading} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50">
          <RefreshCw className={`h-2.5 w-2.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>
      {loading && !insights.length ? (
        <div className="flex items-center justify-center py-8 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Analisando dados…
        </div>
      ) : error ? (
        <div className="text-[11px] text-neg py-4 text-center">{error}</div>
      ) : !insights.length ? (
        <div className="text-[12px] text-muted-foreground py-6 text-center">Sem insights gerados.</div>
      ) : (
        <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
          {insights.map((it, i) => (
            <button
              key={i}
              onClick={() => abrir(i, it)}
              className={`w-full text-left border-l-2 pl-2 py-1.5 pr-1.5 rounded-r ${tomClass[it.tom] ?? tomClass.neutro} hover:bg-muted/40 transition-colors`}
            >
              <div className="flex items-start gap-1.5">
                <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${tomDot[it.tom] ?? tomDot.neutro}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-foreground">{it.titulo}</div>
                  <div className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">{it.texto}</div>
                  <div className="text-[10px] font-medium text-primary inline-flex items-center gap-1 mt-1">
                    Ver explicação <ChevronDown className="h-2.5 w-2.5 -rotate-90" />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={modalIdx !== null} onOpenChange={(o) => !o && setModalIdx(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {ativo && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${tomBadge[ativo.tom] ?? tomBadge.neutro}`}>
                    {tomLabel[ativo.tom] ?? "Insight"}
                  </span>
                  <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Análise IA · DRE · DFC · BP Anual
                  </span>
                </div>
                <DialogTitle className="text-base">{ativo.titulo}</DialogTitle>
                <DialogDescription className="text-[12.5px] leading-relaxed text-foreground/80 pt-1">
                  {ativo.texto}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-3 border-t border-border pt-3">
                <div className="text-[11px] font-semibold text-foreground mb-2 inline-flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-primary" /> Explicação detalhada
                </div>
                {detailLoading === modalIdx ? (
                  <div className="flex items-center py-6 text-[12px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Analisando dados financeiros…
                  </div>
                ) : detail[modalIdx!] ? (
                  detail[modalIdx!].startsWith("⚠️") ? (
                    <div className="rounded-md border border-neg/30 bg-neg-soft/40 px-3 py-2.5 text-[12px] text-foreground/90 flex items-start justify-between gap-3">
                      <span>{detail[modalIdx!]}</span>
                      <button
                        onClick={() => retryDetail(modalIdx!, ativo)}
                        className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-border bg-background hover:bg-muted inline-flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" /> Tentar novamente
                      </button>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none text-foreground/90 [&_p]:my-2 [&_ul]:my-2 [&_li]:my-0.5">
                      <ReactMarkdown>{detail[modalIdx!]}</ReactMarkdown>
                    </div>
                  )
                ) : (
                  <div className="text-[12px] text-muted-foreground py-2">Sem explicação ainda.</div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border mt-3">
                <button
                  onClick={() => setModalIdx(null)}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-border hover:bg-muted"
                >
                  Fechar
                </button>
                <button
                  onClick={() => { onAsk(`Sobre "${ativo.titulo}": ${ativo.texto}`); setModalIdx(null); }}
                  className="text-[12px] px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1.5"
                >
                  <Sparkles className="h-3 w-3" /> Continuar no chat
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Trio: Crescimento por equipe · Receita recorrente x spot · Onde vai cada R$ ---
function TrioReceitaDespesa({
  rows, periodo, receitaBruta, receitaLiquida, pessoalTotal, mkt, custos, adm,
}: {
  rows: any[]; periodo: { ano: number; mes: number };
  receitaBruta: number; receitaLiquida: number;
  pessoalTotal: number; mkt: number; custos: number; adm: number;
}) {
  const get = (nome: string, p = periodo) => {
    const r = rows.find((x) => x.ano === p.ano && x.mes === p.mes && String(x.metrica).toLowerCase() === nome.toLowerCase());
    return r ? Math.abs(Number(r.valor)) : 0;
  };
  const ant12 = subMeses(periodo, 1);
  const pLabel = periodoLabel(periodo);

  // 1) Crescimento por equipe — descobre TODAS as linhas "Equipe X" + "Benefícios" direto da DRE.
  const PALETA = ["hsl(0 70% 35%)", "hsl(15 75% 40%)", "hsl(25 85% 50%)", "hsl(35 95% 55%)", "hsl(20 80% 45%)", "hsl(40 90% 60%)", "hsl(10 65% 30%)", "hsl(30 80% 65%)"];
  const equipesKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const m = String(r.metrica ?? "");
      if (/^equipe\s+/i.test(m) || /^benef[ií]cios$/i.test(m)) set.add(m);
    }
    return Array.from(set);
  }, [rows]);
  const radialData = equipesKeys.map((key, i) => {
    const atual = get(key);
    const base = get(key, ant12);
    const cresc = base > 0 ? ((atual - base) / base) * 100 : (atual > 0 ? 100 : 0);
    const label = key.replace(/^Equipe\s+/i, "");
    return { name: label, valor: atual, cresc: Math.round(cresc), color: PALETA[i % PALETA.length] };
  }).filter((d) => d.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const maxValor = Math.max(...radialData.map((d) => d.valor), 1);
  const radialChartData = radialData.map((d) => ({ ...d, escala: (d.valor / maxValor) * 100 }));

  // 2) Receita recorrente × spot — total amarrado à receitaBruta do KPI (mesma base do dashboard).
  const assinaturas = get("Receita de Assinaturas");
  const enterprise = get("Enterprise");
  const spot = get("Receita Spot");
  const identificada = assinaturas + enterprise + spot;
  const outrosReceita = Math.max(0, receitaBruta - identificada);
  const totalReceita = receitaBruta;
  const recorrentePct = totalReceita > 0 ? ((assinaturas + enterprise) / totalReceita) * 100 : 0;
  const receitaData = [
    { name: "Assinaturas", value: assinaturas, color: "hsl(150 70% 30%)" },
    { name: "Enterprise", value: enterprise, color: "hsl(150 60% 55%)" },
    { name: "Spot (não recorrente)", value: spot, color: "hsl(45 95% 55%)" },
    ...(outrosReceita > 0 ? [{ name: "Outras receitas", value: outrosReceita, color: "hsl(150 25% 70%)" }] : []),
  ].filter((d) => d.value > 0);

  // 3) Onde vai cada R$ — pessoal/mkt/custos/adm vêm de calcMetricas (mesma base dos KPIs).
  const totalDesp = pessoalTotal + mkt + custos + adm;
  const consumoPct = receitaLiquida > 0 ? (totalDesp / receitaLiquida) * 100 : 0;
  const por1 = (v: number) => (receitaLiquida > 0 ? v / receitaLiquida : 0);
  const despData = [
    { name: "Pessoal", value: pessoalTotal, por: por1(pessoalTotal), color: "hsl(0 70% 30%)" },
    { name: "Mkt & Vendas", value: mkt, por: por1(mkt), color: "hsl(0 75% 50%)" },
    { name: "Custos Op.", value: custos, por: por1(custos), color: "hsl(25 85% 50%)" },
    { name: "Adm/Imp/Fin", value: adm, por: por1(adm), color: "hsl(0 0% 50%)" },
  ];
  const saldoPorReal = 1 - (consumoPct / 100);


  const fmtK = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000) return `R$ ${Math.round(n / 1_000)}k`;
    return `R$ ${Math.round(n)}`;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* 1 - Radial */}
      <SectionCard
        title="Crescimento por equipe · radial"
        subtitle="Cada barra radial mostra o gasto atual (escala = maior equipe). Etiqueta interna marca o crescimento vs mês anterior."
        actions={<span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Radial</span>}
      >
        <div className="grid grid-cols-[1fr_150px] items-center gap-3">
          <div className="relative h-[260px]">
            {(() => {
              const n = radialChartData.length;
              const cx = 130, cy = 130;
              const innerR = 32;
              const outerMax = 120;
              const labelR = 112;
              const start = -90; // topo
              const step = 360 / Math.max(n, 1);
              const toXY = (r: number, deg: number) => {
                const rad = (deg * Math.PI) / 180;
                return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
              };
              const arc = (r: number, a1: number, a2: number, sweep: 0 | 1) => {
                const [x1, y1] = toXY(r, a1);
                const [x2, y2] = toXY(r, a2);
                const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
                return `A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
              };
              return (
                <svg viewBox="0 0 260 260" className="h-full w-full">
                  {/* anéis guia */}
                  {[0.5, 0.75, 1].map((f, i) => (
                    <circle key={i} cx={cx} cy={cy} r={innerR + (outerMax - innerR) * f}
                            fill="none" stroke="hsl(var(--border))" strokeDasharray="2 3" strokeOpacity={0.5} />
                  ))}
                  {radialChartData.map((d, i) => {
                    const a1 = start + step * i + 1;
                    const a2 = start + step * (i + 1) - 1;
                    const r = innerR + ((d.valor / Math.max(...radialChartData.map(x => x.valor), 1)) * (outerMax - innerR));
                    const [ix1, iy1] = toXY(innerR, a1);
                    const [ox2, oy2] = toXY(r, a2);
                    const path = `M ${ix1} ${iy1} ${arc(innerR, a1, a2, 1)} L ${ox2} ${oy2} ${arc(r, a2, a1, 0)} Z`;
                    const mid = (a1 + a2) / 2;
                    const [lx, ly] = toXY((innerR + r) / 2, mid);
                    return (
                      <g key={d.name}>
                        <path d={path} fill={d.color} />
                        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
                              fill="#fff" fontSize="11" fontWeight={700}>
                          {`${d.cresc >= 0 ? "+" : ""}${d.cresc}%`}
                        </text>
                      </g>
                    );
                  })}
                  {/* círculo central */}
                  <circle cx={cx} cy={cy} r={innerR - 2} fill="hsl(var(--card))" stroke="hsl(var(--border))" />
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                        fill="hsl(var(--foreground))" fontSize="11" fontWeight={700}>{["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][periodo.mes-1]}/{String(periodo.ano).slice(-2)}</text>
                </svg>
              );
            })()}
          </div>
          <div className="space-y-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">vs mês anterior</div>
            {radialChartData.map((d) => (
              <div key={d.name} className="flex items-center justify-between gap-1.5 text-[10.5px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: d.color }} />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="num shrink-0 text-muted-foreground">{fmtK(d.valor)}</span>
                <span className={`num shrink-0 font-semibold ${d.cresc >= 0 ? "text-neg" : "text-pos"}`}>{d.cresc >= 0 ? "+" : ""}{d.cresc}%</span>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* 2 - Receita recorrente x spot */}
      <SectionCard
        title={`Receita: recorrente × spot · ${pLabel}`}
        subtitle={`${recorrentePct.toFixed(1)}% da receita é recorrente — base saudável; dependência alta de assinaturas SMB (${totalReceita > 0 ? ((assinaturas / totalReceita) * 100).toFixed(0) : 0}%).`}
        actions={<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">Receita</span>}
      >
        <div className="grid grid-cols-[160px_1fr] items-center gap-3">
          <div className="relative h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={receitaData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={78} stroke="hsl(var(--card))" strokeWidth={2} paddingAngle={1}>
                  {receitaData.map((d, i) => (<Cell key={i} fill={d.color} />))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, n: any) => [fmtK(Number(v)), n]}
                  position={{ x: 170, y: 10 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[8.5px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Recorrente</div>
              <div className="num text-2xl font-bold text-emerald-700 dark:text-emerald-400">{recorrentePct.toFixed(1).replace(".", ",")}%</div>
              <div className="text-[9px] text-muted-foreground">do bruto total</div>
            </div>
          </div>
          <div className="space-y-1.5 text-[11px]">
            {receitaData.map((d) => (
              <div key={d.name} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="num shrink-0 text-muted-foreground">{fmtK(d.value)}</span>
              </div>
            ))}
            <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-[10.5px]">
              <span className="font-semibold">Total bruto: {fmtK(totalReceita)}</span>
              {assinaturas > enterprise && assinaturas > spot && <span className="text-muted-foreground"> · maior dependência: SMB.</span>}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* 3 - Onde vai cada R$ */}
      <SectionCard
        title={`Onde vai cada R$ de receita · ${pLabel}`}
        subtitle={consumoPct > 100
          ? `Despesas equivalem a ${consumoPct.toFixed(0)}% da receita líquida — toda a receita vira despesa e ainda falta ${fmtK(totalDesp - receitaLiquida)}.`
          : `Despesas consomem ${consumoPct.toFixed(0)}% da receita líquida; sobra ${fmtK(receitaLiquida - totalDesp)} de operação.`}
        actions={<span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">Narrativa</span>}
      >
        <div className="grid grid-cols-[160px_1fr] items-center gap-3">
          <div className="relative h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={despData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={78} stroke="hsl(var(--card))" strokeWidth={2} paddingAngle={1}>
                  {despData.map((d, i) => (<Cell key={i} fill={d.color} />))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, n: any) => [fmtK(Number(v)), n]}
                  position={{ x: 170, y: 10 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[8.5px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">Consome</div>
              <div className="num text-2xl font-bold text-rose-700 dark:text-rose-400">{consumoPct.toFixed(0)}%</div>
              <div className="text-[9px] text-muted-foreground">da receita líquida</div>
            </div>
          </div>
          <div className="space-y-1.5 text-[11px]">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">de cada R$ 1,00 que entra</div>
            {despData.map((d) => (
              <div key={d.name} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="num shrink-0 text-muted-foreground">R$ {d.por.toFixed(2).replace(".", ",")}</span>
              </div>
            ))}
            <div className={`mt-2 rounded-md border px-2 py-1.5 text-[10.5px] ${saldoPorReal < 0 ? "border-rose-500/30 bg-rose-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
              <span className="font-semibold">Saldo: R$ {saldoPorReal.toFixed(2).replace(".", ",")}</span>
              <span className="text-muted-foreground">{saldoPorReal < 0 ? ` de prejuízo operacional por R$ 1 de receita.` : ` sobra por R$ 1 de receita.`}</span>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
