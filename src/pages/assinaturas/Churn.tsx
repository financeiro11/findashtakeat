// Aba "Churn" de /assinaturas — bloco "KPI's Gerais" da planilha de churn da diretoria,
// recalculado mês a mês pela edge function `churn-sheet-sync` e lido de `churn_snapshot`.
//
// A ponte com a aba Recorrência: o "MRR início do mês" de um mês é a base fechada no fim do
// mês anterior — o mesmo número do snapshot de assinaturas daquela competência. O card da
// cascata mostra essa amarração e se as duas planilhas batem.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts";
import {
  ChevronLeft, ChevronRight, Loader2, TrendingDown, UserMinus, Ticket, Target,
  Database, Check, AlertTriangle, ArrowRight,
} from "lucide-react";
import { SeletorAba, KpiCard, VsOrcado } from "./comum";
import {
  type Aba, NIVEL_META,
  fmtCheio, fmt2, fmtInt, fmtK, fmtPct1, fmtPct2, delta,
} from "./fmt";
import { useOrcadoBp, desvio } from "./orcadoBp";

/* ------------------------------ tipos ------------------------------ */
type LinhaSetor = {
  setor: string; qtd: number; valor: number;
  pct_do_cancelamento: number; pct_receita: number; pct_receita_liquido: number; pct_cliente: number;
};
type LinhaNivel = { nivel: string; qtd: number; valor: number; pct_do_bloco: number; pct_mrr: number; tm: number };
type Kpis = {
  cancel_qtd: number; cancel_valor: number; cancel_tm: number;
  downsell_qtd: number; downsell_valor: number;
  upsell_qtd: number; upsell_valor: number;
  reativacao_qtd: number; reativacao_valor: number;
  churn_qtd: number; churn_valor: number; churn_tm: number;
  pct_receita_geral: number; pct_receita_onboarding: number; pct_receita_sucesso: number;
  pct_cliente_geral: number; pct_cliente_onboarding: number; pct_cliente_sucesso: number;
  meta_pct: number; meta_valor: number; north_star: number;
};
type Dados = {
  competencia: string; mes_label: string; mes_nome: string; mes_num: number;
  base: {
    mrr_inicio: number; clientes: number; tm_mrr: number;
    mix_clientes: Record<string, number> | null;
    snapshot_recorrencia: { competencia: string; mes_label: string; mrr_core: number } | null;
    /** MRR e clientes por nível da base sobre a qual o churn incidiu (snapshot de M−1). */
    mix_nivel: { nivel: string; clientes: number; mrr: number }[] | null;
    conferencia: { diferenca: number; confere: boolean } | null;
  };
  kpis: Kpis;
  por_setor: LinhaSetor[];
  por_qualificacao: { geral: LinhaNivel[]; onboarding: LinhaNivel[]; sucesso: LinhaNivel[] };
  em_andamento: boolean;
};
type Snap = { competencia: string; mes_label: string; dados: Dados };

const sb = supabase as any;

const SETOR_COR: Record<string, string> = {
  onboarding: "bg-blue-500/70",
  sucesso: "bg-primary/80",
  comercial: "bg-amber-500/70",
};
const chave = (s: string) => (s ?? "").trim().toLowerCase();

/* ================================ componente ================================ */
export default function Churn({ aba, setAba }: { aba: Aba; setAba: (a: Aba) => void }) {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(true);
  const [selIdx, setSelIdx] = useState(0);
  const [escopo, setEscopo] = useState<"geral" | "onboarding" | "sucesso">("geral");
  const [histView, setHistView] = useState<"mes" | "tend">("mes");

  useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("churn_snapshot")
        .select("competencia,mes_label,dados")
        .order("competencia", { ascending: true });
      if (error) toast.error("Falha ao carregar churn: " + error.message);
      const rows = (data ?? []) as Snap[];
      setSnaps(rows);
      setSelIdx(Math.max(0, rows.length - 1)); // abre no mês mais recente
      setLoading(false);
    })();
  }, []);

  const sel = snaps[selIdx];
  const d = sel?.dados;
  const k = d?.kpis;
  const kPrev = snaps[selIdx - 1]?.dados?.kpis;

  // Orçado do BP. O mês de churn M casa direto com a coluna M da aba Operação: os dois
  // medem a perda ocorrida dentro do mês sobre a base de início dele (BoP).
  const bp = useOrcadoBp(Number(sel?.competencia?.slice(0, 4)) || new Date().getFullYear());
  const orc = sel ? bp.meses.get(sel.competencia.slice(0, 10)) : undefined;

  const historico = useMemo(() => snaps.map((s, i) => {
    const o = bp.meses.get(s.competencia.slice(0, 10));
    return {
      label: s.mes_label,
      competencia: s.competencia,
      mrr_inicio: s.dados?.base?.mrr_inicio ?? 0,
      churn_valor: s.dados?.kpis?.churn_valor ?? 0,
      churn_qtd: s.dados?.kpis?.churn_qtd ?? 0,
      pct_receita: s.dados?.kpis?.pct_receita_geral ?? 0,
      pct_cliente: s.dados?.kpis?.pct_cliente_geral ?? 0,
      meta_pct: s.dados?.kpis?.meta_pct ?? 0,
      north_star: s.dados?.kpis?.north_star ?? 0,
      em_andamento: !!s.dados?.em_andamento,
      bp_pct: o?.churn_pct ?? null,
      bp_qtd: o?.perdidos ?? null,
      bp_pre: !!o?.pre_revisao,
      idx: i,
    };
  }), [snaps, bp.meses]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando churn…
      </div>
    );
  }
  if (!sel || !d || !k) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Cabecalho aba={aba} setAba={setAba} />
        <div className="card-surface mx-auto mt-10 max-w-md p-8 text-center">
          <div className="mb-2 text-[15px] font-semibold">Nenhum dado de churn ainda</div>
          <p className="text-[12.5px] text-muted-foreground">
            Os números vêm da planilha de churn da diretoria e são recalculados todo dia às 9h.
          </p>
        </div>
      </div>
    );
  }

  const niveis = d.por_qualificacao?.[escopo] ?? [];
  const conf = d.base.conferencia;

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
              <span className="num font-semibold text-foreground">{d.mes_nome} de {d.competencia.slice(0, 4)}</span>
              <button
                onClick={() => setSelIdx((i) => Math.min(snaps.length - 1, i + 1))}
                disabled={selIdx >= snaps.length - 1}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                aria-label="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {d.em_andamento && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                mês em andamento
              </span>
            )}
          </>
        }
      />

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          eyebrow="$ Churn (líquido)" valor={fmtCheio(k.churn_valor)}
          delta={delta(k.churn_valor, kPrev?.churn_valor)} inverso
          icon={<TrendingDown className="h-4 w-4" />}
          rodape={`${fmtPct2(k.pct_receita_geral)} da receita · TM ${fmt2(k.churn_tm)}`}
          extra={<VsOrcado real={k.churn_valor} orcado={orc?.churn_valor} formatar={fmtCheio} inverso preRevisao={orc?.pre_revisao} />}
        />
        <KpiCard
          eyebrow="# Churn (clientes)" valor={fmtInt(k.churn_qtd)}
          delta={delta(k.churn_qtd, kPrev?.churn_qtd)} inverso
          icon={<UserMinus className="h-4 w-4" />}
          rodape={`${fmtPct2(k.pct_cliente_geral)} da base · ${fmtInt(k.cancel_qtd)} canc. − ${fmtInt(k.reativacao_qtd)} reat.`}
          extra={<VsOrcado real={k.churn_qtd} orcado={orc?.perdidos} formatar={fmtInt} delta="abs" inverso preRevisao={orc?.pre_revisao} />}
        />
        <KpiCard
          eyebrow="Ticket médio cancelado" valor={fmt2(k.cancel_tm)}
          delta={delta(k.cancel_tm, kPrev?.cancel_tm)} inverso
          icon={<Ticket className="h-4 w-4" />}
          rodape={`sobre ${fmtInt(k.cancel_qtd)} cancelamentos`}
          extra={<>Base do mês: <span className="num font-semibold text-foreground">{fmt2(d.base.tm_mrr)}</span> de TM</>}
        />
        <KpiCard
          eyebrow="North Star Metric" valor={fmtPct2(k.north_star)}
          delta={delta(k.north_star, kPrev?.north_star)}
          icon={<Target className="h-4 w-4" />}
          rodape={<>Meta CS {fmtPct2(k.meta_pct)} · {fmtCheio(k.meta_valor)} tolerado</>}
          extra={
            orc?.churn_pct == null ? (
              <>Realizado {fmtPct2(k.pct_receita_geral)} — sem churn orçado no BP para este mês</>
            ) : (
              <>
                Orçado no BP <span className="num font-semibold text-foreground">{fmtPct2(orc.churn_pct)}</span> ·
                realizado <span className={cn("num font-semibold", k.pct_receita_geral <= orc.churn_pct ? "text-pos" : "text-neg")}>{fmtPct2(k.pct_receita_geral)}</span>
                {" "}— o plano tolera mais churn do que a meta do CS
              </>
            )
          }
        />
      </div>

      {/* ---------------- Cascata: da carteira ao churn ---------------- */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[14px] font-semibold text-foreground">Da carteira ao churn</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Como o churn líquido de {d.mes_nome} se forma sobre a base do início do mês
            </p>
          </div>
          {/* Ponte com a aba Recorrência: o MRR de início do mês é o snapshot do mês anterior. */}
          {d.base.snapshot_recorrencia && (
            <button
              onClick={() => setAba("recorrencia")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition hover:bg-muted/60",
                conf?.confere ? "border-border text-muted-foreground" : "border-amber-500/40 text-amber-600 dark:text-amber-400",
              )}
              title={
                conf?.confere
                  ? "O MRR de início do mês é idêntico ao MRR Core da aba Recorrência."
                  : `Diferença de ${fmt2(Math.abs(conf?.diferenca ?? 0))} entre as duas planilhas.`
              }
            >
              {conf?.confere ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              base = Recorrência {d.base.snapshot_recorrencia.mes_label}
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* base do mês */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 p-3">
          <span className="eyebrow">MRR no início do mês</span>
          <span className="num text-[20px] font-bold leading-none text-foreground">{fmtCheio(d.base.mrr_inicio)}</span>
          <span className="text-[12px] text-muted-foreground">
            {fmtInt(d.base.clientes)} clientes · TM {fmt2(d.base.tm_mrr)}
          </span>
          {conf && !conf.confere && (
            <span className="text-[11.5px] text-amber-600 dark:text-amber-400">
              difere da Recorrência em {fmt2(Math.abs(conf.diferenca))}
            </span>
          )}
        </div>

        <div className="mt-3 space-y-2">
          <LinhaCascata rotulo="Cancelamentos" sinal="+" qtd={k.cancel_qtd} valor={k.cancel_valor} max={k.cancel_valor} cor="bg-neg/70" mrr={d.base.mrr_inicio} />
          <LinhaCascata rotulo="Downsell" sinal="+" qtd={k.downsell_qtd} valor={k.downsell_valor} max={k.cancel_valor} cor="bg-amber-500/70" mrr={d.base.mrr_inicio} />
          <LinhaCascata rotulo="Upsell" sinal="−" qtd={k.upsell_qtd} valor={k.upsell_valor} max={k.cancel_valor} cor="bg-pos/70" mrr={d.base.mrr_inicio} />
          <LinhaCascata rotulo="Reativações" sinal="−" qtd={k.reativacao_qtd} valor={k.reativacao_valor} max={k.cancel_valor} cor="bg-pos/70" mrr={d.base.mrr_inicio} />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-baseline gap-3">
            <span className="text-[13px] font-semibold text-foreground">= Churn líquido</span>
            <span className="text-[12px] text-muted-foreground">{fmtInt(k.churn_qtd)} clientes</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="num text-[20px] font-bold leading-none text-neg">{fmtCheio(k.churn_valor)}</span>
            <span className="num text-[12.5px] font-semibold text-muted-foreground">{fmtPct2(k.pct_receita_geral)} do MRR</span>
          </div>
        </div>
        {orc?.churn_valor != null && (
          <div className={cn("mt-2 flex flex-wrap items-baseline justify-between gap-2 text-[11.5px]", orc.pre_revisao && "opacity-60")}>
            <span className="text-muted-foreground">Orçado no BP para {orc.mes_nome.toLowerCase()}</span>
            <span className="flex flex-wrap items-baseline gap-3 text-muted-foreground">
              <span className="num font-semibold text-foreground">{fmtCheio(orc.churn_valor)}</span>
              <span className="num">{fmtInt(orc.perdidos)} clientes</span>
              <span className="num">{fmtPct2(orc.churn_pct ?? 0)} do MRR</span>
            </span>
          </div>
        )}

        <p className="mt-2 text-[11px] text-muted-foreground">
          Fórmula da planilha: cancelamentos + downsell − upsell − reativações. Upsell entra só quando o pagamento
          foi confirmado; reativações, só as pagas.
        </p>
      </div>

      {/* ---------------- Cortes: setor + qualificação ---------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        {/* por setor */}
        <div className="card-surface p-4 lg:col-span-2">
          <div className="text-[14px] font-semibold text-foreground">Por setor</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Onde o cliente estava quando cancelou</p>

          <div className="mt-3 space-y-3">
            {d.por_setor.map((s) => (
              <div key={s.setor}>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="font-medium text-foreground">{s.setor}</span>
                  <span className="text-muted-foreground">
                    {fmtInt(s.qtd)} · <span className="num font-semibold text-foreground">{fmtK(s.valor)}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full rounded-full", SETOR_COR[chave(s.setor)] ?? "bg-muted-foreground/40")}
                    style={{ width: `${Math.min(100, s.pct_do_cancelamento)}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10.5px] text-muted-foreground">
                  <span>{fmtPct1(s.pct_do_cancelamento)} do cancelamento</span>
                  <span className="num">{fmtPct2(s.pct_receita)} da receita · {fmtPct2(s.pct_cliente)} da base</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/50 pt-3">
            <div>
              <div className="eyebrow">% Churn receita — Onboarding</div>
              <div className="num text-[15px] font-semibold text-foreground">{fmtPct2(k.pct_receita_onboarding)}</div>
              <div className="text-[10.5px] text-muted-foreground">{fmtPct2(k.pct_cliente_onboarding)} dos clientes</div>
            </div>
            <div>
              <div className="eyebrow">% Churn receita — Sucesso</div>
              <div className="num text-[15px] font-semibold text-foreground">{fmtPct2(k.pct_receita_sucesso)}</div>
              <div className="text-[10.5px] text-muted-foreground">líquido de upsell e reativações</div>
            </div>
          </div>
        </div>

        {/* por qualificação */}
        <div className="card-surface p-4 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[14px] font-semibold text-foreground">Por qualificação</div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Tamanho do cliente que cancelou · GG é o mesmo grupo do XG na aba Recorrência
                {escopo === "geral" && orc && " · comparado ao % de churn que o BP projeta para cada porte"}
              </p>
            </div>
            <div className="flex rounded-md border border-border bg-card p-0.5">
              {([["geral", "Geral"], ["onboarding", "Onboarding"], ["sucesso", "Sucesso"]] as const).map(([v, rotulo]) => (
                <button
                  key={v}
                  onClick={() => setEscopo(v)}
                  className={cn(
                    "rounded px-2.5 py-1 text-[12px] font-medium transition",
                    escopo === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {niveis.map((n) => {
              const meta = NIVEL_META[n.nivel] ?? NIVEL_META.P;
              // % de churn do nível sobre a base DELE (não sobre o MRR total) — é assim que
              // o BP projeta o churn por porte, então é o único jeito de comparar de igual.
              const baseNivel = d.base.mix_nivel?.find((x) => x.nivel === n.nivel);
              const pctDaBase = baseNivel?.mrr ? (n.valor / baseNivel.mrr) * 100 : null;
              const bpNivel = escopo === "geral" ? orc?.portes.find((p) => p.nivel === n.nivel) : undefined;
              const ppt = pctDaBase != null && bpNivel ? pctDaBase - bpNivel.churn_pct : null;
              return (
                <div key={n.nivel} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", meta.badge)}>{n.nivel}</span>
                    <span className="num text-[11px] text-muted-foreground">{fmtPct1(n.pct_do_bloco)}</span>
                  </div>
                  <div className="num mt-2 text-[22px] font-bold leading-none text-foreground">{fmtInt(n.qtd)}</div>
                  <div className="text-[11px] text-muted-foreground">cancelamentos</div>

                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div className={cn("h-full rounded-full", meta.barra)} style={{ width: `${Math.min(100, n.pct_do_bloco)}%` }} />
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border/50 pt-2">
                    <div>
                      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">MRR</div>
                      <div className="num text-[12.5px] font-semibold text-foreground">{fmtK(n.valor)}</div>
                    </div>
                    <div>
                      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Ticket</div>
                      <div className="num text-[12.5px] font-semibold text-foreground">{fmt2(n.tm)}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                    <span className="num">{fmtPct2(n.pct_mrr)}</span> do MRR total
                  </div>

                  {pctDaBase != null && (
                    <div className={cn("mt-2 border-t border-border/50 pt-2", orc?.pre_revisao && "opacity-60")}>
                      <div className="flex items-baseline justify-between text-[10.5px]">
                        <span className="uppercase tracking-wider text-muted-foreground/80">churn do nível</span>
                        <span className="num text-[12px] font-semibold text-foreground">{fmtPct2(pctDaBase)}</span>
                      </div>
                      {bpNivel && (
                        <div className="mt-0.5 flex items-baseline justify-between text-[10.5px] text-muted-foreground">
                          <span>BP <span className="num">{fmtPct2(bpNivel.churn_pct)}</span></span>
                          <span className={cn("num font-semibold", (ppt ?? 0) <= 0 ? "text-pos" : "text-neg")}>
                            {(ppt ?? 0) <= 0 ? "−" : "+"}{fmtPct1(Math.abs(ppt ?? 0)).replace("%", "")} p.p.
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!niveis.length && (
              <p className="col-span-full py-6 text-center text-[12px] text-muted-foreground">
                Nenhum cancelamento nesse recorte.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- Histórico ---------------- */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[14px] font-semibold text-foreground">Histórico</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Churn de receita mês a mês contra a meta</p>
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
                {v === "mes" ? "Mês a mês" : "Tendência"}
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
                  <th className="px-2 py-1.5 text-right font-bold">MRR base</th>
                  <th className="px-2 py-1.5 text-right font-bold">$ Churn</th>
                  <th className="px-2 py-1.5 text-right font-bold">% Receita</th>
                  <th className="px-2 py-1.5 text-right font-bold">Meta CS</th>
                  <th className="px-2 py-1.5 text-right font-bold">Orçado BP</th>
                  <th className="px-2 py-1.5 text-right font-bold">North Star</th>
                  <th className="px-2 py-1.5 text-right font-bold"># Churn</th>
                  <th className="px-2 py-1.5 text-right font-bold">BP #</th>
                  <th className="px-2 py-1.5 text-right font-bold">% Cliente</th>
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
                      {h.em_andamento && <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">parcial</span>}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-[12.5px] text-muted-foreground">{fmtCheio(h.mrr_inicio)}</td>
                    <td className="num px-2 py-1.5 text-right text-[12.5px] font-medium">{fmtCheio(h.churn_valor)}</td>
                    <td className={cn("num px-2 py-1.5 text-right text-[12.5px] font-semibold", h.pct_receita <= h.meta_pct ? "text-pos" : "text-neg")}>
                      {fmtPct2(h.pct_receita)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-[12px] text-muted-foreground">{fmtPct2(h.meta_pct)}</td>
                    <td className={cn("num px-2 py-1.5 text-right text-[12px]", h.bp_pre && "opacity-60", h.bp_pct == null ? "text-muted-foreground" : h.pct_receita <= h.bp_pct ? "text-pos" : "text-neg")}>
                      {h.bp_pct == null ? "—" : fmtPct2(h.bp_pct)}
                    </td>
                    <td className={cn("num px-2 py-1.5 text-right text-[12.5px]", h.north_star >= 100 ? "text-pos" : "text-muted-foreground")}>
                      {fmtPct1(h.north_star)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-[12.5px]">{fmtInt(h.churn_qtd)}</td>
                    <td className={cn("num px-2 py-1.5 text-right text-[12px]", h.bp_pre && "opacity-60", h.bp_qtd == null ? "text-muted-foreground" : h.churn_qtd <= h.bp_qtd ? "text-pos" : "text-neg")}>
                      {h.bp_qtd == null ? "—" : fmtInt(h.bp_qtd)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-[12.5px] text-muted-foreground">{fmtPct2(h.pct_cliente)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Clique num mês para carregar a competência. “Parcial” = mês ainda em andamento na planilha.
              A <b>meta CS</b> é a da planilha de churn; o <b>orçado BP</b> é o “% Churn Mensal” da aba Operação —
              o plano tolera mais churn do que a meta interna
              {bp.ancora && <>, e os meses anteriores a {bp.ancora.mes_nome.toLowerCase()} comparam contra a projeção anterior à reancoragem</>}.
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={historico} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="churnFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false} width={44}
                  tickFormatter={(v: number) => fmtPct1(v)}
                />
                <RTooltip content={<ChartTip />} />
                <Area type="monotone" dataKey="pct_receita" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#churnFill)" dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                <Line type="stepAfter" dataKey="meta_pct" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                <Line type="monotone" dataKey="bp_pct" stroke="hsl(var(--neg))" strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[10.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-primary" /> Realizado</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-muted-foreground" /> Meta CS</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-neg" /> Orçado BP</span>
            </div>
          </div>
        )}
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
          <span>Churn · planilha da diretoria</span>
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

function LinhaCascata({
  rotulo, sinal, qtd, valor, max, cor, mrr,
}: {
  rotulo: string; sinal: "+" | "−"; qtd: number; valor: number; max: number; cor: string; mrr: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("w-3 shrink-0 text-center text-[13px] font-bold", sinal === "+" ? "text-neg" : "text-pos")}>{sinal}</span>
      <span className="w-28 shrink-0 text-[12.5px] font-medium text-foreground">{rotulo}</span>
      <span className="num w-10 shrink-0 text-right text-[12px] text-muted-foreground">{fmtInt(qtd)}</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", cor)} style={{ width: `${max ? Math.min(100, (valor / max) * 100) : 0}%` }} />
      </div>
      <span className="num w-24 shrink-0 text-right text-[12.5px] font-semibold text-foreground">{fmt2(valor)}</span>
      <span className="num hidden w-14 shrink-0 text-right text-[11px] text-muted-foreground sm:inline">
        {fmtPct2(mrr ? (valor / mrr) * 100 : 0)}
      </span>
    </div>
  );
}

function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-md">
      <div className="mb-1 font-semibold text-foreground">{p.label}</div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">% Churn receita</span><span className="num font-semibold text-foreground">{fmtPct2(p.pct_receita)}</span></div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Meta CS</span><span className="num text-foreground">{fmtPct2(p.meta_pct)}</span></div>
      {p.bp_pct != null && (
        <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Orçado BP</span><span className="num text-foreground">{fmtPct2(p.bp_pct)}</span></div>
      )}
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">$ Churn</span><span className="num text-foreground">{fmt2(p.churn_valor)}</span></div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground"># Churn</span><span className="num text-foreground">{fmtInt(p.churn_qtd)}</span></div>
    </div>
  );
}
