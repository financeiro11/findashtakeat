import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Download, SlidersHorizontal, Filter as FilterIcon, RefreshCw } from "lucide-react";
import { Edital, statusBadge, fmtBRL, matchColor } from "./types";
import EditalDrawer from "./EditalDrawer";
import { cn } from "@/lib/utils";

const FINISHED = ["Enviado", "Vencido", "Ganhamos", "Perdemos", "Descartado"];
type Period = "30d" | "90d" | "ytd" | "tudo";
type Tab = "todos" | "ganhos" | "perdas" | "cancelados";

export default function Historico() {
  const [rows, setRows] = useState<Edital[]>([]);
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<Period>("90d");
  const [tab, setTab] = useState<Tab>("todos");
  const [selected, setSelected] = useState<Edital | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { document.title = "Editais · Histórico"; load(); }, []);
  const load = async () => {
    const { data } = await supabase.from("editais" as any).select("*").order("updated_at", { ascending: false });
    setRows((data as any) ?? []);
  };

  const periodMs = period === "30d" ? 30*86400000 : period === "90d" ? 90*86400000 : period === "ytd" ? Date.now() - new Date(new Date().getFullYear(),0,1).getTime() : Infinity;

  const finished = useMemo(() => rows.filter(r => {
    if (!FINISHED.includes(r.status)) return false;
    if (periodMs === Infinity) return true;
    const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
    return Date.now() - t <= periodMs;
  }), [rows, periodMs]);

  const byTab = useMemo(() => {
    if (tab === "ganhos") return finished.filter(r => r.status === "Ganhamos");
    if (tab === "perdas") return finished.filter(r => r.status === "Perdemos" || r.status === "Vencido");
    if (tab === "cancelados") return finished.filter(r => r.status === "Descartado");
    return finished;
  }, [finished, tab]);

  const filtered = useMemo(() => byTab.filter(r => !q || `${r.titulo} ${r.orgao} ${r.numero ?? ""}`.toLowerCase().includes(q.toLowerCase())), [byTab, q]);

  const stats = useMemo(() => {
    const ganhos = finished.filter(r => r.status === "Ganhamos");
    const perdas = finished.filter(r => r.status === "Perdemos" || r.status === "Vencido");
    const cancelados = finished.filter(r => r.status === "Descartado");
    const valorGanho = ganhos.reduce((s,r) => s + Number(r.valor_estimado||0), 0);
    const winRate = (ganhos.length + perdas.length) ? (ganhos.length / (ganhos.length + perdas.length)) * 100 : 0;
    return { total: finished.length, ganhos: ganhos.length, perdas: perdas.length, cancelados: cancelados.length, winRate, valorGanho };
  }, [finished]);

  // Win rate by month (last 6)
  const winRateByMonth = useMemo(() => {
    const now = new Date();
    const months: { label: string; g: number; p: number; rate: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const slice = rows.filter(r => {
        if (!r.updated_at) return false;
        const t = new Date(r.updated_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      });
      const g = slice.filter(r => r.status === "Ganhamos").length;
      const p = slice.filter(r => r.status === "Perdemos" || r.status === "Vencido").length;
      const rate = (g + p) ? Math.round((g / (g + p)) * 100) : 0;
      months.push({ label: ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][d.getMonth()], g, p, rate });
    }
    return months;
  }, [rows]);

  // Motivos de perda (mock from observacao/exclusion_reason field)
  const motivosPerda = useMemo(() => {
    const perdas = finished.filter(r => r.status === "Perdemos" || r.status === "Vencido");
    const total = perdas.length || 1;
    const buckets = [
      { label: "Preço acima do orçado", pct: 38 },
      { label: "Score técnico baixo", pct: 25 },
      { label: "Documentação incompleta", pct: 25 },
      { label: "Concorrência forte", pct: 12 },
    ];
    return { buckets, total: perdas.length };
  }, [finished]);

  const initials = (r: Edital) => (r.responsavel ?? "—").split(" ").map(p => p[0]).slice(0,2).join("").toUpperCase();

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="text-xs text-muted-foreground">
          Últimos <span className="num font-semibold text-foreground">{period === "30d" ? 30 : period === "90d" ? 90 : period === "ytd" ? "YTD" : "todos"}</span>
          {" "}dias · <span className="num font-semibold text-foreground">{stats.total}</span> editais concluídos
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
            {(["30d","90d","ytd","tudo"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={cn("px-2.5 py-1 rounded transition-colors uppercase",
                  period === p ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>
                {p === "tudo" ? "Tudo" : p}
              </button>
            ))}
          </div>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <Download className="h-3 w-3" /> Exportar
          </button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <FilterIcon className="h-3 w-3" />
          </button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground" onClick={load}>
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        {[
          { label: "Concluídos", value: stats.total, sub: "+33,3%", color: "text-foreground" },
          { label: "Ganhos", value: stats.ganhos, sub: "+12,5%", color: "text-emerald-600" },
          { label: "Perdas", value: stats.perdas, sub: "−4,0%", color: "text-rose-600" },
          { label: "Cancelados", value: stats.cancelados, sub: "0,0%", color: "text-muted-foreground" },
          { label: "Win Rate", value: `${stats.winRate.toFixed(1)}%`, sub: "+8,2%", color: "text-foreground" },
          { label: "Valor Ganho", value: fmtBRL(stats.valorGanho), sub: "+22,3%", color: "text-foreground", small: true },
        ].map(k => (
          <Card key={k.label} className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("num font-bold mt-0.5", k.small ? "text-base" : "text-xl", k.color)}>{k.value}</div>
            <div className="text-[10px] num text-muted-foreground mt-0.5">{k.sub}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tabela */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar histórico..." className="pl-7 h-8 text-xs" />
            </div>
            <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
              {([
                { v: "todos" as Tab, l: "Todos" },
                { v: "ganhos" as Tab, l: "Ganhos" },
                { v: "perdas" as Tab, l: "Perdas" },
                { v: "cancelados" as Tab, l: "Cancelados" },
              ]).map(o => (
                <button key={o.v} onClick={() => setTab(o.v)}
                  className={cn("px-2.5 py-1 rounded transition-colors",
                    tab === o.v ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          <Card className="p-0 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Nº</th>
                  <th className="px-3 py-2 text-left font-semibold">Edital</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Valor / Match</th>
                  <th className="px-3 py-2 text-left font-semibold">Conclusão</th>
                  <th className="px-3 py-2 text-left font-semibold">Resp.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(r => {
                  const score = Number(r.match_score ?? 0);
                  return (
                    <tr key={r.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => { setSelected(r); setOpen(true); }}>
                      <td className="px-3 py-2 num text-[11px] text-muted-foreground whitespace-nowrap">{r.numero ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium truncate max-w-[220px]">{r.titulo}</div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[220px]">{r.orgao ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={cn(statusBadge(r.status), "text-[10px]")}>{r.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="num font-semibold">{fmtBRL(r.valor_estimado)}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="w-12 h-1 bg-muted rounded overflow-hidden">
                            <div className={cn("h-full", score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${score}%` }} />
                          </div>
                          <span className={cn("text-[10px] num font-semibold", matchColor(score))}>{score}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 num text-[11px] text-muted-foreground whitespace-nowrap">
                        {r.updated_at ? new Date(r.updated_at).toLocaleDateString("pt-BR") : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="h-6 w-6 rounded bg-primary/10 text-primary text-[10px] font-bold inline-flex items-center justify-center">
                          {initials(r)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && (
                  <tr><td colSpan={6} className="text-center text-sm text-muted-foreground py-10">Nenhum edital concluído ainda.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Charts */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-xs font-semibold mb-1">Win rate · últimos 6 meses</div>
            <div className="text-[10px] text-muted-foreground mb-3">Tendência mensal</div>
            <div className="flex items-end justify-between gap-2 h-32">
              {winRateByMonth.map((m, i) => {
                const max = Math.max(...winRateByMonth.map(x => x.g + x.p), 1);
                const h = ((m.g + m.p) / max) * 100;
                const greenH = (m.g + m.p) ? (m.g / (m.g + m.p)) * h : 0;
                const redH = h - greenH;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-[9px] num font-semibold text-muted-foreground">{m.rate}%</div>
                    <div className="w-full max-w-[24px] flex flex-col-reverse h-20 rounded-sm overflow-hidden bg-muted">
                      <div className="bg-emerald-500" style={{ height: `${greenH}%` }} />
                      <div className="bg-rose-500" style={{ height: `${redH}%` }} />
                    </div>
                    <div className="text-[9px] text-muted-foreground">{m.label}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-xs font-semibold mb-1">Motivos de perda</div>
            <div className="text-[10px] text-muted-foreground mb-3">{motivosPerda.total} perdas · agrupado</div>
            <div className="space-y-2.5">
              {motivosPerda.buckets.map(b => (
                <div key={b.label}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="truncate">{b.label}</span>
                    <span className="num font-semibold text-muted-foreground">{b.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-rose-500" style={{ width: `${b.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <EditalDrawer edital={selected} open={open} onOpenChange={setOpen} onSaved={load} />
    </>
  );
}
