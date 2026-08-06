// Aba "Recorrência" de /assinaturas — base de assinaturas do Asaas (MRR, mix por nível,
// mix por plano, top contratos), alimentada por `assinaturas_snapshot`.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts";
import {
  ChevronLeft, ChevronRight, Loader2, TrendingUp, Users, Ticket, Layers, Search, Database,
} from "lucide-react";
import { SeletorAba, KpiCard, VsOrcado } from "./comum";
import {
  type Aba, NIVEL_ORDEM, NIVEL_META,
  fmtCheio, fmt2, fmtInt, fmtK, fmtKStr, fmtPct1, delta,
} from "./fmt";
import { useOrcadoBp, desvio, type MesBP, type NivelBP } from "./orcadoBp";

/* ------------------------------ tipos ------------------------------ */
type Kpis = {
  mrr_core: number; mrr_total: number; mrr_outras: number; mrr_aluguel: number; mrr_banestes: number;
  ticket_medio: number; clientes_ativos: number; ticket_medio_total: number;
};
type MixNivel = { nivel: string; clientes: number; perfil_pct: number; mrr: number; tm: number; receita_pct: number };
type MixPlano = { plano: string; clientes: number; mrr: number };
type TopContrato = { nome: string; plano: string; descricao: string; nivel: string; intervalo: string; dia_venc: string; mrr: number };
type Dados = {
  competencia: string; mes_label: string; kpis: Kpis;
  mix_nivel: MixNivel[]; mix_plano: MixPlano[]; top_contratos: TopContrato[]; carteira_total: number;
};
type Insight = { tipo: "positivo" | "info" | "atencao"; texto: string };
type Snap = { competencia: string; mes_label: string; dados: Dados; insights: Insight[] | null };

const sb = supabase as any;

// rótulo curto do plano para a tabela de contratos (usa TIPO DE PLANO; se vazio, deriva da descrição)
function planoLabel(c: TopContrato): string {
  if (c.plano) return c.plano;
  let d = (c.descricao || "").replace(/^takeat\s*-\s*plano\s*/i, "").replace(/\(delivery e balc[aã]o\)/i, "");
  d = d.replace(/\+\s*adicionais:\s*sem adicionais/i, "").replace(/\s+/g, " ").trim();
  return d.split("+")[0].trim() || "—";
}

const INSIGHT_META: Record<string, { rotulo: string; cls: string; dot: string }> = {
  positivo: { rotulo: "POSITIVO", cls: "bg-success/10 text-success", dot: "bg-success" },
  info:     { rotulo: "INFO",     cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  atencao:  { rotulo: "ATENÇÃO",  cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
};

/* ================================ componente ================================ */
export default function Recorrencia({ aba, setAba }: { aba: Aba; setAba: (a: Aba) => void }) {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(true);
  const [selIdx, setSelIdx] = useState(0);
  const [histView, setHistView] = useState<"mes" | "tend">("mes");
  const [topNivel, setTopNivel] = useState<string>("Todos");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("assinaturas_snapshot")
        .select("competencia,mes_label,dados,insights")
        .order("competencia", { ascending: true });
      if (error) toast.error("Falha ao carregar assinaturas: " + error.message);
      const rows = (data ?? []) as Snap[];
      setSnaps(rows);
      setSelIdx(Math.max(0, rows.length - 1)); // abre no mês mais recente
      setLoading(false);
    })();
  }, []);

  const sel = snaps[selIdx];
  const prev = snaps[selIdx - 1];
  const d = sel?.dados;
  const k = d?.kpis;
  const kPrev = prev?.dados?.kpis;

  // Orçado do BP do ano da competência aberta. A comparação é direta: a competência M da
  // recorrência é a base de fim do mês M, que no BP é o "# Número de Clientes EoP" de M.
  const bp = useOrcadoBp(Number(sel?.competencia?.slice(0, 4)) || new Date().getFullYear());
  const orc = sel ? bp.meses.get(sel.competencia.slice(0, 10)) : undefined;
  const orcPorte = (nivel: string): MesBP["portes"][number] | undefined =>
    orc?.portes.find((p) => p.nivel === (nivel === "XG" ? "GG" : (nivel as NivelBP)));

  // série do histórico para gráfico/tabela
  const historico = useMemo(() => snaps.map((s, i) => {
    const mrr = s.dados?.kpis?.mrr_core ?? 0;
    const o = bp.meses.get(s.competencia.slice(0, 10));
    return {
      label: s.mes_label,
      competencia: s.competencia,
      mrr_core: mrr,
      mrr_total: s.dados?.kpis?.mrr_total ?? 0,
      clientes: s.dados?.kpis?.clientes_ativos ?? 0,
      tm: s.dados?.kpis?.ticket_medio ?? 0,
      delta_mrr: i > 0 ? delta(mrr, snaps[i - 1]?.dados?.kpis?.mrr_core) : null,
      orcado: o?.mrr_recorrente ?? null,
      orcado_pre: !!o?.pre_revisao,
      orcado_ancora: !!o?.ancora,
      desvio_mrr: desvio(mrr, o?.mrr_recorrente),
      idx: i,
    };
  }), [snaps, bp.meses]);

  const topFiltrado = useMemo(() => {
    let rows = d?.top_contratos ?? [];
    if (topNivel !== "Todos") rows = rows.filter((r) => r.nivel === topNivel);
    const q = busca.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.nome.toLowerCase().includes(q));
    return rows.slice(0, 60);
  }, [d, topNivel, busca]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando assinaturas…
      </div>
    );
  }
  if (!sel || !d || !k) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Cabecalho aba={aba} setAba={setAba} />
        <div className="card-surface mx-auto mt-10 max-w-md p-8 text-center">
          <div className="mb-2 text-[15px] font-semibold">Nenhum dado de assinaturas ainda</div>
          <p className="text-[12.5px] text-muted-foreground">
            O snapshot mensal é alimentado pela planilha do Google (sincroniza automaticamente no dia 2 de cada mês).
          </p>
        </div>
      </div>
    );
  }

  const receitaMax = Math.max(...d.mix_plano.map((p) => p.mrr), 1);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* ---------------- Cabeçalho ---------------- */}
      <Cabecalho
        aba={aba}
        setAba={setAba}
        nav={
          <>
            <span className="text-muted-foreground/40">·</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSelIdx((i) => Math.max(0, i - 1))}
                disabled={selIdx === 0}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                aria-label="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="num font-semibold text-foreground">Competência {sel.mes_label}</span>
              <button
                onClick={() => setSelIdx((i) => Math.min(snaps.length - 1, i + 1))}
                disabled={selIdx >= snaps.length - 1}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                aria-label="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[12px]">abre sempre no mês mais recente</span>
          </>
        }
      />

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          eyebrow="MRR Core (restaurantes)" valor={fmtCheio(k.mrr_core)}
          delta={delta(k.mrr_core, kPrev?.mrr_core)} icon={<TrendingUp className="h-4 w-4" />}
          extra={<VsOrcado real={k.mrr_core} orcado={orc?.mrr_recorrente} formatar={fmtCheio} preRevisao={orc?.pre_revisao} ancora={orc?.ancora} />}
        />
        <KpiCard
          eyebrow="Clientes ativos" valor={fmtInt(k.clientes_ativos)}
          delta={delta(k.clientes_ativos, kPrev?.clientes_ativos)} icon={<Users className="h-4 w-4" />}
          extra={<VsOrcado real={k.clientes_ativos} orcado={orc?.clientes_eop} formatar={fmtInt} delta="abs" preRevisao={orc?.pre_revisao} ancora={orc?.ancora} />}
        />
        <KpiCard
          eyebrow="Ticket médio" valor={fmt2(k.ticket_medio)}
          delta={delta(k.ticket_medio, kPrev?.ticket_medio)} icon={<Ticket className="h-4 w-4" />}
          rodape={`TM total ${fmt2(k.ticket_medio_total)}`}
          extra={<VsOrcado real={k.ticket_medio} orcado={orc?.ticket} formatar={fmt2} preRevisao={orc?.pre_revisao} ancora={orc?.ancora} />}
        />
        <KpiCard
          eyebrow="Outras receitas recorrentes" valor={fmtCheio(k.mrr_outras)}
          icon={<Layers className="h-4 w-4" />}
          rodape="Banestes + aluguéis de sala"
          extra={<>MRR Total (core + outras): <span className="num font-semibold text-foreground">{fmtCheio(k.mrr_total)}</span></>}
        />
      </div>

      {/* ---------------- Mix por nível ---------------- */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[14px] font-semibold text-foreground">Mix por nível de cliente</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Perfil da carteira · contagem, receita e ticket por nível P / M / G / XG</p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            {orc
              ? <>vs Orçado (BP {sel.competencia.slice(0, 4)}){orc.pre_revisao && <span className="text-muted-foreground/60"> · pré-revisão</span>}</>
              : <>vs Orçado (BP) <span className="text-muted-foreground/60">— sem plano para esta competência</span></>}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {NIVEL_ORDEM.map((niv) => {
            const m = d.mix_nivel.find((x) => x.nivel === niv);
            if (!m) return null;
            const meta = NIVEL_META[niv];
            const ob = orcPorte(niv);
            // Participação do nível na receita, como o BP projetou — a barra fantasma.
            const obPct = ob && orc?.mrr_recorrente ? (ob.mrr / orc.mrr_recorrente) * 100 : null;
            const dCli = desvio(m.clientes, ob?.clientes_eop);
            const dMrr = desvio(m.mrr, ob?.mrr);
            return (
              <div key={niv} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", meta.badge)}>{niv}</span>
                  <span className="text-[11px] text-muted-foreground">{meta.faixa}</span>
                </div>
                <div className="num mt-2 text-[22px] font-bold leading-none text-foreground">{fmtInt(m.clientes)}</div>
                <div className="text-[11px] text-muted-foreground">clientes · {fmtPct1(m.perfil_pct)}</div>

                <div className="mt-2.5 flex items-center justify-between text-[10.5px] uppercase tracking-wider text-muted-foreground/80">
                  <span>% da receita</span><span className="num">{fmtPct1(m.receita_pct)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className={cn("h-full rounded-full", meta.barra)} style={{ width: `${Math.min(100, m.receita_pct)}%` }} />
                </div>
                {obPct != null && (
                  <div
                    className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-secondary/60"
                    title={`Orçado no BP: ${fmtPct1(obPct)} da receita`}
                  >
                    <div className="h-full rounded-full bg-muted-foreground/35" style={{ width: `${Math.min(100, obPct)}%` }} />
                  </div>
                )}

                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border/50 pt-2">
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">MRR</div>
                    <div className="num text-[12.5px] font-semibold text-foreground">{fmtK(m.mrr)}</div>
                  </div>
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Ticket</div>
                    <div className="num text-[12.5px] font-semibold text-foreground">{fmt2(m.tm)}</div>
                  </div>
                </div>

                {ob && dCli && dMrr && (
                  <div className={cn("mt-2 flex items-center justify-between text-[10.5px]", orc?.pre_revisao && "opacity-60")}>
                    <span className="uppercase tracking-wider text-muted-foreground/80">vs BP</span>
                    {orc?.ancora ? (
                      <span className="text-muted-foreground/70">reancorado</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className={cn("num font-semibold", dCli.acima ? "text-pos" : "text-neg")}>
                          {dCli.acima ? "+" : "−"}{fmtInt(Math.abs(dCli.abs))} cli
                        </span>
                        <span className={cn("num font-semibold", dMrr.acima ? "text-pos" : "text-neg")}>
                          {dMrr.acima ? "+" : "−"}{fmtKStr(Math.abs(dMrr.abs))}
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* barra empilhada de receita por nível */}
        <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full">
          {NIVEL_ORDEM.map((niv) => {
            const m = d.mix_nivel.find((x) => x.nivel === niv);
            if (!m) return null;
            return <div key={niv} className={cn("h-full", NIVEL_META[niv].barra)} style={{ width: `${m.receita_pct}%` }} title={`${niv} · ${fmtPct1(m.receita_pct)}`} />;
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Distribuição da receita core por nível — XG concentra a maior fatia com a menor base de clientes.
        </p>
      </div>

      {/* ---------------- Histórico + Mix por plano ---------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        {/* Histórico */}
        <div className="card-surface p-4 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[14px] font-semibold text-foreground">Histórico</div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Evolução da recorrência</p>
            </div>
            <div className="flex rounded-md border border-border bg-card p-0.5">
              {(["mes", "tend"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setHistView(v)}
                  className={cn(
                    "rounded px-2.5 py-1 text-[12px] font-medium transition",
                    histView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "mes" ? "Mês a mês" : "Tendência & insights"}
                </button>
              ))}
            </div>
          </div>

          {histView === "mes" ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-bold">Mês</th>
                    <th className="px-2 py-1.5 text-right font-bold">MRR Core</th>
                    <th className="px-2 py-1.5 text-right font-bold">Δ MRR</th>
                    <th className="px-2 py-1.5 text-right font-bold">Orçado (BP)</th>
                    <th className="px-2 py-1.5 text-right font-bold">vs BP</th>
                    <th className="px-2 py-1.5 text-right font-bold">Clientes</th>
                    <th className="px-2 py-1.5 text-right font-bold">TM</th>
                    <th className="px-2 py-1.5 text-right font-bold">MRR Total</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((h) => (
                    <tr
                      key={h.competencia}
                      onClick={() => setSelIdx(h.idx)}
                      className={cn(
                        "cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/40",
                        h.idx === selIdx && "bg-primary/5",
                      )}
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 text-[12.5px]">
                        <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", h.idx === selIdx ? "bg-primary" : "bg-muted-foreground/30")} />
                        {h.label}
                      </td>
                      <td className="num px-2 py-1.5 text-right text-[12.5px] font-medium">{fmtCheio(h.mrr_core)}</td>
                      <td className={cn("num px-2 py-1.5 text-right text-[12px]", !h.delta_mrr ? "text-muted-foreground" : h.delta_mrr.up ? "text-pos" : "text-neg")}>
                        {h.delta_mrr ? `${h.delta_mrr.up ? "↑" : "↓"} ${fmtPct1(Math.abs(h.delta_mrr.pct))}` : "—"}
                      </td>
                      <td className={cn("num px-2 py-1.5 text-right text-[12px] text-muted-foreground", h.orcado_pre && "opacity-60")}>
                        {h.orcado == null ? "—" : fmtCheio(h.orcado)}
                      </td>
                      <td
                        className={cn(
                          "num px-2 py-1.5 text-right text-[12px]",
                          h.orcado_pre && "opacity-60",
                          !h.desvio_mrr || h.orcado_ancora ? "text-muted-foreground" : h.desvio_mrr.acima ? "text-pos" : "text-neg",
                        )}
                      >
                        {!h.desvio_mrr ? "—" : h.orcado_ancora ? "âncora" : `${h.desvio_mrr.acima ? "+" : "−"}${fmtPct1(Math.abs(h.desvio_mrr.pct ?? 0))}`}
                      </td>
                      <td className="num px-2 py-1.5 text-right text-[12.5px]">{fmtInt(h.clientes)}</td>
                      <td className="num px-2 py-1.5 text-right text-[12.5px]">{fmt2(h.tm)}</td>
                      <td className="num px-2 py-1.5 text-right text-[12.5px]">{fmtCheio(h.mrr_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Clique num mês para carregar a competência. O orçado é a receita recorrente de clientes do BP
                (P+M+G+GG, sem Banestes){bp.ancora && <> — o plano foi reancorado no realizado de {bp.ancora.mes_nome.toLowerCase()}, então os meses anteriores comparam contra a projeção original</>}.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={historico} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis hide domain={["dataMin - 50000", "dataMax + 50000"]} />
                    <RTooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="mrr_core" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#mrrFill)" dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {(sel.insights ?? []).map((ins, i) => {
                  const meta = INSIGHT_META[ins.tipo] ?? INSIGHT_META.info;
                  return (
                    <div key={i} className="flex gap-2.5 rounded-lg border border-border p-2.5">
                      <span className={cn("mt-0.5 inline-flex h-fit shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold", meta.cls)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {meta.rotulo}
                      </span>
                      <p className="text-[12.5px] leading-relaxed text-foreground">{ins.texto}</p>
                    </div>
                  );
                })}
                {!(sel.insights ?? []).length && (
                  <p className="text-[12px] text-muted-foreground">Os insights de tendência são gerados no sync mensal.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mix por plano */}
        <div className="card-surface p-4 lg:col-span-2">
          <div className="text-[14px] font-semibold text-foreground">Mix por plano</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Clientes e MRR por tipo de plano</p>
          <div className="mt-3 space-y-3">
            {d.mix_plano.map((p) => (
              <div key={p.plano}>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="font-medium text-foreground">{p.plano}</span>
                  <span className="text-muted-foreground">
                    {fmtInt(p.clientes)} clientes · <span className="num font-semibold text-foreground">{fmtK(p.mrr)}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(p.mrr / receitaMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Distribuição pela coluna “Tipo de plano” da planilha.</p>
        </div>
      </div>

      {/* ---------------- Top contratos ---------------- */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[14px] font-semibold text-foreground">Top contratos</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Maiores assinaturas por MRR · {sel.mes_label}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border bg-card p-0.5">
              {["Todos", ...NIVEL_ORDEM].map((n) => (
                <button
                  key={n}
                  onClick={() => setTopNivel(n)}
                  className={cn(
                    "rounded px-2.5 py-1 text-[12px] font-medium transition",
                    topNivel === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente…"
                className="h-8 w-44 rounded-md border border-border bg-card pl-7 pr-2 text-[12.5px] outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-bold">#</th>
                <th className="px-2 py-1.5 text-left font-bold">Cliente</th>
                <th className="px-2 py-1.5 text-left font-bold">Plano</th>
                <th className="px-2 py-1.5 text-left font-bold">Nível</th>
                <th className="px-2 py-1.5 text-left font-bold">Recorrência</th>
                <th className="px-2 py-1.5 text-right font-bold">Venc.</th>
                <th className="px-2 py-1.5 text-right font-bold">MRR</th>
              </tr>
            </thead>
            <tbody>
              {topFiltrado.map((c, i) => (
                <tr key={`${c.nome}-${i}`} className="border-b border-border/40 hover:bg-muted/40">
                  <td className="num px-2 py-1.5 text-[12px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[12.5px] font-medium text-foreground">{c.nome}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[12.5px] text-muted-foreground">{planoLabel(c)}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-bold", NIVEL_META[c.nivel]?.badge ?? "bg-muted text-muted-foreground")}>{c.nivel || "—"}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[12.5px] text-muted-foreground">{c.intervalo}</td>
                  <td className="num whitespace-nowrap px-2 py-1.5 text-right text-[12px] text-muted-foreground">{c.dia_venc ? `dia ${c.dia_venc}` : "—"}</td>
                  <td className="num whitespace-nowrap px-2 py-1.5 text-right text-[12.5px] font-semibold text-foreground">{fmt2(c.mrr)}</td>
                </tr>
              ))}
              {!topFiltrado.length && (
                <tr><td colSpan={7} className="py-6 text-center text-[12px] text-muted-foreground">Nenhum contrato encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ subcomponentes ------------------------------ */
function Cabecalho({ aba, setAba, nav }: { aba: Aba; setAba: (a: Aba) => void; nav?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Assinaturas</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <span>Base de recorrência · Asaas</span>
          {nav}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-start">
        <SeletorAba aba={aba} setAba={setAba} />
        <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
          <Database className="h-3 w-3" /> Planilha · Supabase
        </span>
      </div>
    </div>
  );
}

function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-md">
      <div className="mb-1 font-semibold text-foreground">{p.label}</div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">MRR Core</span><span className="num font-semibold text-foreground">{fmt2(p.mrr_core)}</span></div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Clientes</span><span className="num text-foreground">{fmtInt(p.clientes)}</span></div>
    </div>
  );
}
