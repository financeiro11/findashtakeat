import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { SectionCard } from "@/components/ui/section-card";

type Row = {
  id: string;
  created_at: string;
  user_id: string;
  model: string;
  feature: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
};

type Period = "today" | "7d" | "30d" | "month" | "prev_month" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "month", label: "Mês atual" },
  { key: "prev_month", label: "Mês anterior" },
  { key: "all", label: "Tudo" },
];

const FEATURE_LABEL: Record<string, string> = {
  chat: "Chat",
  dashboard_insights: "Insights do Dashboard",
  cenario_analise: "Cenários",
};

function periodRange(p: Period): { from?: Date; to?: Date } {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (p === "today") return { from: start };
  if (p === "7d") { const d = new Date(start); d.setDate(d.getDate() - 6); return { from: d }; }
  if (p === "30d") { const d = new Date(start); d.setDate(d.getDate() - 29); return { from: d }; }
  if (p === "month") { return { from: new Date(now.getFullYear(), now.getMonth(), 1) }; }
  if (p === "prev_month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to };
  }
  return {};
}

export default function UsoIA() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("month");
  const [fx, setFx] = useState<number>(5.30);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  useEffect(() => { document.title = "Uso IA · Configurações"; }, []);

  async function load() {
    setLoading(true);
    const { from, to } = periodRange(period);
    let q = supabase.from("ai_usage_log" as any).select("*").order("created_at", { ascending: false }).limit(2000);
    if (from) q = q.gte("created_at", from.toISOString());
    if (to) q = q.lt("created_at", to.toISOString());
    const { data } = await q;
    setRows((data ?? []) as any);
    const ids = Array.from(new Set((data ?? []).map((r: any) => r.user_id)));
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id,nome").in("user_id", ids);
      const map: Record<string, string> = {};
      (ps ?? []).forEach((p: any) => { map[p.user_id] = p.nome; });
      setProfiles(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period]);

  const kpis = useMemo(() => {
    const totalCalls = rows.length;
    const totalTokens = rows.reduce((s, r) => s + (r.total_tokens || 0), 0);
    const totalUsd = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    const avgUsd = totalCalls ? totalUsd / totalCalls : 0;
    const byModel: Record<string, number> = {};
    rows.forEach(r => { byModel[r.model] = (byModel[r.model] || 0) + 1; });
    const topModel = Object.entries(byModel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    return { totalCalls, totalTokens, totalUsd, avgUsd, topModel };
  }, [rows]);

  const daily = useMemo(() => {
    const map: Record<string, { dia: string; usd: number; calls: number }> = {};
    rows.forEach(r => {
      const d = new Date(r.created_at).toISOString().slice(0, 10);
      if (!map[d]) map[d] = { dia: d.slice(5), usd: 0, calls: 0 };
      map[d].usd += Number(r.cost_usd || 0);
      map[d].calls += 1;
    });
    return Object.values(map).sort((a, b) => a.dia.localeCompare(b.dia));
  }, [rows]);

  const byModel = useMemo(() => {
    const map: Record<string, { model: string; usd: number; calls: number }> = {};
    rows.forEach(r => {
      if (!map[r.model]) map[r.model] = { model: r.model, usd: 0, calls: 0 };
      map[r.model].usd += Number(r.cost_usd || 0);
      map[r.model].calls += 1;
    });
    return Object.values(map).sort((a, b) => b.usd - a.usd);
  }, [rows]);

  const byFeature = useMemo(() => {
    const map: Record<string, { feature: string; usd: number; calls: number }> = {};
    rows.forEach(r => {
      if (!map[r.feature]) map[r.feature] = { feature: r.feature, usd: 0, calls: 0 };
      map[r.feature].usd += Number(r.cost_usd || 0);
      map[r.feature].calls += 1;
    });
    return Object.values(map).sort((a, b) => b.usd - a.usd);
  }, [rows]);

  const fmtUsd = (n: number) => `US$ ${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  const fmtBrl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });

  return (
    <div className="space-y-4 p-5">
      {/* Filters */}
      <div className="card-surface flex flex-wrap items-center gap-2 px-3 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-medium">Uso IA</span>
        <span className="text-[12px] text-muted-foreground">· custo estimado das chamadas à IA</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${period === p.key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/70"}`}
            >{p.label}</button>
          ))}
          <div className="ml-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span>Câmbio US$→R$</span>
            <input
              type="number" step="0.01" value={fx}
              onChange={(e) => setFx(parseFloat(e.target.value) || 0)}
              className="num w-16 rounded border border-border bg-card px-1.5 py-0.5 text-right text-[12px]"
            />
          </div>
          <button onClick={load} disabled={loading} className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-50" title="Atualizar">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Perguntas" value={kpis.totalCalls.toLocaleString("pt-BR")} subline={kpis.topModel !== "—" ? `Top: ${kpis.topModel.split("/").pop()}` : undefined} />
        <KpiCard label="Tokens totais" value={kpis.totalTokens.toLocaleString("pt-BR")} />
        <KpiCard label="Custo estimado" value={fmtUsd(kpis.totalUsd)} subline={fmtBrl(kpis.totalUsd * fx)} />
        <KpiCard label="Custo médio / pergunta" value={fmtUsd(kpis.avgUsd)} subline={fmtBrl(kpis.avgUsd * fx)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
        <SectionCard title="Gasto por dia" subtitle="US$ estimado">
          <div className="h-[260px] w-full">
            {daily.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">Sem dados no período.</div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={daily} margin={{ top: 10, right: 8, bottom: 4, left: -8 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--secondary))" }}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, name) => name === "usd" ? fmtUsd(v) : v}
                  />
                  <Bar dataKey="usd" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Por modelo" subtitle={`${byModel.length} modelos`} padded={false}>
          {byModel.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">Sem dados.</div>
          ) : (
            <ul className="divide-y divide-border">
              {byModel.map(m => (
                <li key={m.model} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-[12.5px]">
                  <span className="truncate font-medium">{m.model.split("/").pop()}</span>
                  <span className="num text-[11px] text-muted-foreground">{m.calls}×</span>
                  <span className="num font-semibold">{fmtUsd(m.usd)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* By feature */}
      <SectionCard title="Por origem" subtitle="onde a IA está sendo usada" padded={false}>
        {byFeature.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">Sem dados.</div>
        ) : (
          <ul className="divide-y divide-border">
            {byFeature.map(f => (
              <li key={f.feature} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2.5 text-[12.5px]">
                <span className="font-medium">{FEATURE_LABEL[f.feature] ?? f.feature}</span>
                <span className="num text-[11px] text-muted-foreground">{f.calls} chamadas</span>
                <span className="num text-muted-foreground">{fmtUsd(f.usd)}</span>
                <span className="num font-semibold">{fmtBrl(f.usd * fx)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Recent calls */}
      <SectionCard title="Últimas chamadas" subtitle={`${Math.min(rows.length, 50)} de ${rows.length}`} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Quando</th>
                <th className="px-3 py-2 text-left">Usuário</th>
                <th className="px-3 py-2 text-left">Origem</th>
                <th className="px-3 py-2 text-left">Modelo</th>
                <th className="px-3 py-2 text-right">Tokens (in/out)</th>
                <th className="px-3 py-2 text-right">US$</th>
                <th className="px-3 py-2 text-right">R$</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, 50).map(r => (
                <tr key={r.id} className="hover:bg-secondary/30">
                  <td className="px-3 py-2 text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2">{profiles[r.user_id] ?? r.user_id.slice(0, 6)}</td>
                  <td className="px-3 py-2">{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.model.split("/").pop()}</td>
                  <td className="px-3 py-2 text-right num">{r.prompt_tokens}/{r.completion_tokens}</td>
                  <td className="px-3 py-2 text-right num">{fmtUsd(Number(r.cost_usd))}</td>
                  <td className="px-3 py-2 text-right num">{fmtBrl(Number(r.cost_usd) * fx)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Sem registros no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <p className="px-1 text-[11px] text-muted-foreground">
        Custo estimado a partir dos preços públicos por modelo (tabela <code>ai_model_pricing</code>). O valor real cobrado pela Lovable AI pode diferir.
      </p>
    </div>
  );
}
