import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Plus, Download, SlidersHorizontal, Filter as FilterIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Edital, fmtBRL, daysUntil, matchColor } from "./types";
import { Sparkline } from "@/components/ui/sparkline";

type Fonte = {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  ultima_sync: string | null;
};

const minutesAgo = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
};

const KpiStrip = ({ label, value, trend, accent, sub }: any) => (
  <div className="flex-1 min-w-[140px] px-4 py-3 border-r last:border-r-0 border-border/50">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
    <div className="flex items-end justify-between mt-1.5 gap-2">
      <div>
        <div className="text-xl font-semibold tracking-tight num">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
      <div className="opacity-60">
        <Sparkline data={trend} color={accent} width={56} height={24} />
      </div>
    </div>
  </div>
);

export default function EditaisDashboard() {
  const [rows, setRows] = useState<Edital[]>([]);
  const [fontes, setFontes] = useState<Fonte[]>([]);

  useEffect(() => {
    document.title = "Editais · Dashboard";
    Promise.all([
      supabase.from("editais" as any).select("*").eq("visibility_status", "visivel").order("match_score", { ascending: false }),
      supabase.from("editais_fontes" as any).select("id, slug, nome, ativo, ultima_sync"),
    ]).then(([r, f]) => {
      setRows(((r.data as any) ?? []) as Edital[]);
      setFontes(((f.data as any) ?? []) as Fonte[]);
    });
  }, []);

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const last24 = new Date(Date.now() - 86400000);
    const hoje = rows.filter(r => new Date(r.data_captura ?? r.created_at ?? "") >= today).length;
    const ultimas24 = rows.filter(r => new Date(r.data_captura ?? r.created_at ?? "") >= last24).length;
    const prioritarios = rows.filter(r => Number(r.match_score ?? 0) >= 70).length;
    const proximos = rows.filter(r => { const d = daysUntil(r.prazo_envio); return d !== null && d >= 0 && d <= 7; }).length;
    const analise = rows.filter(r => r.status === "Em análise").length;
    const enviados = rows.filter(r => r.status === "Enviado").length;
    const total = rows.reduce((s, r) => s + Number(r.valor_estimado || 0), 0);
    const top = [...rows].sort((a,b) => Number(b.match_score ?? 0) - Number(a.match_score ?? 0))[0];
    return { hoje, ultimas24, prioritarios, proximos, analise, enviados, total, top };
  }, [rows]);

  // série de 7 dias por dia para sparkline
  const trendDays = (filter?: (r: Edital) => boolean) => {
    const days = 14;
    const arr = new Array(days).fill(0);
    const now = new Date(); now.setHours(0,0,0,0);
    rows.forEach(r => {
      if (filter && !filter(r)) return;
      const d = new Date(r.data_captura ?? r.created_at ?? "");
      const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
      if (diff >= 0 && diff < days) arr[days - 1 - diff]++;
    });
    return arr.length ? arr : [0,0,0];
  };

  const trendAll = useMemo(() => trendDays(), [rows]);
  const trendPrior = useMemo(() => trendDays(r => Number(r.match_score ?? 0) >= 70), [rows]);
  const trendPrazo = useMemo(() => trendDays(r => { const d = daysUntil(r.prazo_envio); return d !== null && d >= 0 && d <= 7; }), [rows]);
  const trendAnalise = useMemo(() => trendDays(r => r.status === "Em análise"), [rows]);
  const trendEnviado = useMemo(() => trendDays(r => r.status === "Enviado"), [rows]);

  // Captura por fonte — agregação por fonte/portal
  const porFonte = useMemo(() => {
    const map = new Map<string, { fonte: string; vol: number; matchSum: number; valor: number; itens: Edital[] }>();
    rows.forEach(r => {
      const k = (r.fonte ?? "—").trim();
      if (!map.has(k)) map.set(k, { fonte: k, vol: 0, matchSum: 0, valor: 0, itens: [] });
      const o = map.get(k)!;
      o.vol += 1; o.matchSum += Number(r.match_score ?? 0); o.valor += Number(r.valor_estimado ?? 0); o.itens.push(r);
    });
    const arr = Array.from(map.values()).map(o => {
      const f = fontes.find(x => o.fonte.toUpperCase().includes(x.slug.toUpperCase()) || x.nome.toUpperCase().includes(o.fonte.toUpperCase()));
      // série últimos 7 dias
      const series = new Array(7).fill(0);
      const now = new Date(); now.setHours(0,0,0,0);
      o.itens.forEach(r => {
        const d = new Date(r.data_captura ?? r.created_at ?? "");
        const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (diff >= 0 && diff < 7) series[6 - diff]++;
      });
      return {
        fonte: o.fonte,
        vol: o.vol,
        match: o.vol ? Math.round(o.matchSum / o.vol) : 0,
        valor: o.valor,
        ultima: f?.ultima_sync ?? null,
        ativo: f?.ativo ?? true,
        series,
      };
    }).sort((a,b) => b.vol - a.vol);
    return arr;
  }, [rows, fontes]);

  const fontesAtivas = porFonte.length;
  const totalCapturado = porFonte.reduce((s, f) => s + f.vol, 0);
  const matchMedio = totalCapturado ? Math.round(porFonte.reduce((s, f) => s + f.match * f.vol, 0) / totalCapturado) : 0;
  const valorTotalFontes = porFonte.reduce((s, f) => s + f.valor, 0);

  const proximosPrazos = useMemo(() =>
    rows.filter(r => { const d = daysUntil(r.prazo_envio); return d !== null && d >= 0 && d <= 7; })
        .sort((a,b) => (a.prazo_envio! < b.prazo_envio! ? -1 : 1)).slice(0, 8),
  [rows]);

  const topMatch = useMemo(() =>
    [...rows].sort((a,b) => Number(b.match_score ?? 0) - Number(a.match_score ?? 0)).slice(0, 5),
  [rows]);

  // Pipeline funnel
  const funnel = useMemo(() => {
    const stages = ["Identificado", "Em análise", "Proposta", "Enviado", "Vencido", "Perdido"];
    const map: Record<string, { count: number; valor: number }> = {};
    stages.forEach(s => map[s] = { count: 0, valor: 0 });
    rows.forEach(r => {
      const v = Number(r.valor_estimado ?? 0);
      if (r.status === "Em análise") { map["Em análise"].count++; map["Em análise"].valor += v; }
      else if (r.status === "Em elaboração") { map["Proposta"].count++; map["Proposta"].valor += v; }
      else if (r.status === "Enviado") { map["Enviado"].count++; map["Enviado"].valor += v; }
      else if (r.status === "Ganhamos") { map["Vencido"].count++; map["Vencido"].valor += v; }
      else if (r.status === "Perdemos") { map["Perdido"].count++; map["Perdido"].valor += v; }
      map["Identificado"].count++; map["Identificado"].valor += v;
    });
    const max = Math.max(...stages.map(s => map[s].count), 1);
    return stages.map(s => ({ stage: s, ...map[s], pct: (map[s].count / max) * 100 }));
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          Radar Inteligente · <span className="num font-semibold text-foreground">{stats.prioritarios}</span> prioritários
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7 text-[11px]"><Plus className="h-3 w-3 mr-1" /> Capturar manual</Button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <Download className="h-3 w-3" />
          </button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <FilterIcon className="h-3 w-3" />
          </button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <SlidersHorizontal className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Banner Radar IA */}
      <Card className="p-3.5 border-rose-200/40 bg-gradient-to-r from-rose-50/60 via-card to-card dark:from-rose-950/20">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-md grid place-items-center bg-rose-500/10 text-rose-600 shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-rose-600 shrink-0">Radar IA · Resumo</div>
          <div className="text-sm flex-1 truncate">
            <span className="font-semibold">+{stats.ultimas24} editais</span> capturados nas últimas 24h —{" "}
            <span className="font-semibold">{stats.prioritarios} prioritários</span> (match ≥70%) somando{" "}
            <span className="font-semibold num">{fmtBRL(stats.total)}</span>.
            {stats.top && <> Foco sugerido: <span className="font-medium">"{stats.top.titulo}"</span> ({stats.top.match_score}% match{daysUntil(stats.top.prazo_envio) !== null ? `, vence em ${daysUntil(stats.top.prazo_envio)}d` : ""}).</>}
          </div>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs shrink-0">
            <Link to="/editais/radar">Ver radar <ArrowRight className="h-3 w-3 ml-1" /></Link>
          </Button>
        </div>
      </Card>

      {/* KPI Strip */}
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap divide-y md:divide-y-0">
          <KpiStrip label="Encontrados hoje" value={stats.hoje} trend={trendAll} accent="hsl(var(--primary))" />
          <KpiStrip label="Prioritários (IA)" value={stats.prioritarios} trend={trendPrior} accent="hsl(346 87% 60%)" />
          <KpiStrip label="Próximos venc." value={stats.proximos} trend={trendPrazo} accent="hsl(38 92% 55%)" sub="≤ 7 dias" />
          <KpiStrip label="Em análise" value={stats.analise} trend={trendAnalise} accent="hsl(217 91% 60%)" />
          <KpiStrip label="Enviados (mês)" value={stats.enviados} trend={trendEnviado} accent="hsl(160 64% 45%)" />
          <KpiStrip label="Valor potencial" value={fmtBRL(stats.total)} trend={trendAll} accent="hsl(var(--primary))" />
        </div>
      </Card>

      {/* Captura por fonte + Próximos prazos */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-0 lg:col-span-2 overflow-hidden">
          <div className="flex items-start justify-between p-4 pb-2">
            <div>
              <div className="text-sm font-semibold">Captura por fonte · últimos 7 dias</div>
              <div className="text-[11px] text-muted-foreground">{fontesAtivas} portais ativos · ranqueado por volume e match</div>
            </div>
            <div className="flex gap-1">
              {["7d", "30d", "90d"].map((p, i) => (
                <Button key={p} size="sm" variant={i === 0 ? "default" : "outline"} className="h-6 text-[10px] px-2">{p}</Button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-y border-border/50">
                  <th className="text-left font-medium px-4 py-2">Fonte / Portal</th>
                  <th className="text-right font-medium px-2 py-2">Vol.</th>
                  <th className="text-left font-medium px-2 py-2 w-[120px]">Tendência 7d</th>
                  <th className="text-right font-medium px-2 py-2">Match médio</th>
                  <th className="text-right font-medium px-2 py-2">Valor potencial</th>
                  <th className="text-center font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {porFonte.slice(0, 8).map((f) => (
                  <tr key={f.fonte} className="border-b border-border/40 hover:bg-muted/30 transition">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-sm">{f.fonte}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${f.ativo ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                        Última leitura {minutesAgo(f.ultima)}
                      </div>
                    </td>
                    <td className="text-right num text-sm px-2">{f.vol}</td>
                    <td className="px-2"><Sparkline data={f.series} color="hsl(var(--primary))" width={100} height={24} /></td>
                    <td className="text-right px-2">
                      <span className={`text-xs font-semibold num ${matchColor(f.match)}`}>{f.match}%</span>
                    </td>
                    <td className="text-right num text-sm px-2">{fmtBRL(f.valor)}</td>
                    <td className="text-center px-4">
                      <Badge variant="outline" className={f.ativo ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[9px]" : "text-[9px]"}>
                        {f.ativo ? "ATIVO" : "INATIVO"}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {!porFonte.length && (
                  <tr><td colSpan={6} className="text-center text-xs text-muted-foreground py-8">Nenhuma fonte com dados.</td></tr>
                )}
              </tbody>
              {porFonte.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border/60 bg-muted/20">
                    <td className="px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{fontesAtivas} fontes ativas</td>
                    <td className="text-right num text-sm font-semibold px-2">{totalCapturado}</td>
                    <td className="px-2 text-[10px] text-muted-foreground">Média ponderada</td>
                    <td className="text-right px-2 text-xs font-semibold num">{matchMedio}%</td>
                    <td className="text-right num text-sm font-semibold px-2">{fmtBRL(valorTotalFontes)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Próximos prazos</div>
              <div className="text-[11px] text-muted-foreground">{proximosPrazos.length} editais com vencimento ≤ 7 dias</div>
            </div>
            <Button asChild size="sm" variant="outline" className="h-6 text-[10px]">
              <Link to="/editais/calendario">Calendário <ArrowRight className="h-3 w-3 ml-1" /></Link>
            </Button>
          </div>
          <div className="space-y-2">
            {proximosPrazos.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">Nenhum prazo próximo.</div>}
            {proximosPrazos.map(r => {
              const d = daysUntil(r.prazo_envio);
              const score = Number(r.match_score ?? 0);
              return (
                <div key={r.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.titulo}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{r.orgao ?? "—"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="num text-xs font-semibold">{fmtBRL(r.valor_estimado)}</div>
                    <span className={`text-[10px] num font-semibold ${matchColor(score)}`}>{score}%</span>
                  </div>
                  <Badge variant="outline" className={`shrink-0 text-[9px] ${d !== null && d <= 3 ? "border-rose-500/30 text-rose-600 bg-rose-500/5" : "border-amber-500/30 text-amber-600"}`}>
                    {d}d
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Top match + Pipeline funnel */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Top match · IA</div>
              <div className="text-[11px] text-muted-foreground">{topMatch.length} editais com maior aderência ao perfil</div>
            </div>
            <div className="flex gap-1">
              {["Todos", "≥ 80%", "≥ 70%"].map((p, i) => (
                <Button key={p} size="sm" variant={i === 0 ? "default" : "outline"} className="h-6 text-[10px] px-2">{p}</Button>
              ))}
              <Button asChild size="sm" variant="ghost" className="h-6 text-[10px] px-2">
                <Link to="/editais/radar">Ver radar <ArrowRight className="h-3 w-3 ml-1" /></Link>
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {topMatch.map(r => {
              const score = Number(r.match_score ?? 0);
              return (
                <div key={r.id} className="rounded-md border border-border/60 p-2.5 hover:border-primary/40 hover:shadow-sm transition flex flex-col gap-1.5">
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge variant="outline" className="text-[8px] py-0 px-1 h-4">{(r.regiao ?? "—").toUpperCase()}</Badge>
                    {r.opportunity_type && <Badge variant="outline" className="text-[8px] py-0 px-1 h-4">{r.opportunity_type.toUpperCase()}</Badge>}
                    <span className={`ml-auto text-[10px] font-bold num ${matchColor(score)}`}>{score}%</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.numero ?? r.modalidade ?? ""}</div>
                  <div className="text-xs font-medium leading-tight line-clamp-2 min-h-[28px]">{r.titulo}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.orgao ?? "—"}</div>
                  <div className="flex items-center justify-between mt-auto pt-1">
                    <span className="num text-xs font-semibold">{fmtBRL(r.valor_estimado)}</span>
                    <span className="text-[10px] text-muted-foreground num">{r.prazo_envio ? new Date(r.prazo_envio).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—"}</span>
                  </div>
                </div>
              );
            })}
            {!topMatch.length && <div className="col-span-full text-xs text-muted-foreground text-center py-6">Sem dados.</div>}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3">
            <div className="text-sm font-semibold">Pipeline · funil</div>
            <div className="text-[11px] text-muted-foreground">Estágios · contagem & valor</div>
          </div>
          <div className="space-y-2">
            {funnel.map((f, i) => (
              <div key={f.stage} className="flex items-center gap-2 text-xs">
                <div className="w-20 shrink-0 text-muted-foreground">{f.stage}</div>
                <div className="flex-1 h-5 rounded-sm bg-secondary/40 overflow-hidden relative">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.max(f.pct, 4)}%`,
                      background: i === 0 ? "hsl(var(--muted-foreground)/0.5)" :
                                  i === 1 ? "hsl(217 91% 60%)" :
                                  i === 2 ? "hsl(38 92% 55%)" :
                                  i === 3 ? "hsl(160 64% 45%)" :
                                  i === 4 ? "hsl(160 64% 35%)" : "hsl(var(--takeat-red, 346 87% 60%))",
                    }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 text-[10px] font-semibold num">{f.count}</span>
                </div>
                <div className="w-20 text-right num text-[11px] font-medium">{fmtBRL(f.valor)}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t text-[10px] text-muted-foreground flex items-center justify-between">
            <span>CONVERSÃO</span>
            <span className="num font-semibold text-foreground">
              {funnel[0].count ? Math.round((funnel[3].count / funnel[0].count) * 1000) / 10 : 0}%
            </span>
            <span>Enviado → Vencido</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
