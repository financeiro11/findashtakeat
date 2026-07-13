import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Download, CloudDownload, Loader2, Check } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AreaRow = {
  area: string; ano: number; mes: number;
  orcado: number; orcado_pessoal: number;
  realizado: number; realizado_pessoal: number;
  saldo: number; consumido_pct: number | null;
  status: "dentro" | "atencao" | "estourado" | "sem";
  tem_omie?: boolean;
};
type LinhaRow = {
  area: string; subcategoria: string; pessoal: boolean;
  ano: number; mes: number;
  orcado: number; realizado: number; saldo: number; consumido_pct: number | null;
};

const ANO = 2026;
const ALL_AREAS = ["Comercial","Novos Canais","Backoffice","Operações","Marketing","Produto","Tecnologia","Corporativo/Adm"];
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function brlAbbr(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs/1_000_000).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})} mi`;
  if (abs >= 1_000) return `${sign}R$ ${Math.round(abs/1_000).toLocaleString("pt-BR")} mil`;
  return brl(n);
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type Status = AreaRow["status"];

function statusFromPct(pct: number | null, hasData: boolean): Status {
  if (!hasData) return "sem";
  if (pct === null || pct === undefined) return "sem";
  if (pct > 100) return "estourado";
  if (pct >= 90) return "atencao";
  return "dentro";
}

// Semantic tokens (matches --pos / --warn / --neg / --muted-foreground defined in tokens.css / index.css)
function statusHsl(s: Status) {
  if (s === "dentro") return "hsl(var(--pos))";
  if (s === "atencao") return "hsl(var(--warn))";
  if (s === "estourado") return "hsl(var(--neg))";
  return "hsl(var(--muted-foreground))";
}
function statusBadgeClass(s: Status) {
  if (s === "dentro") return "bg-pos-soft text-pos border-transparent";
  if (s === "atencao") return "bg-warn-soft text-warn border-transparent";
  if (s === "estourado") return "bg-neg-soft text-neg border-transparent";
  return "bg-muted text-muted-foreground border-transparent";
}
function statusLabel(s: Status) {
  return s === "dentro" ? "Dentro" : s === "atencao" ? "Atenção" : s === "estourado" ? "Estourado" : "Sem dados";
}

export default function Orcamento() {
  const [areaRows, setAreaRows] = useState<AreaRow[]>([]);
  const [linhaRows, setLinhaRows] = useState<LinhaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mes"|"acum">("mes");
  const [view, setView] = useState<"resumo"|"tabela">("resumo");
  const [mes, setMes] = useState<number>(5);
  const [syncing, setSyncing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  async function recarregar() {
    const [a, l] = await Promise.all([
      supabase.from("vw_orcamento_area").select("*").eq("ano", ANO),
      supabase.from("vw_orcamento_area_linha").select("*").eq("ano", ANO),
    ]);
    setAreaRows((a.data as any) ?? []);
    setLinhaRows((l.data as any) ?? []);
  }

  useEffect(() => {
    document.title = "FinHub · Orçamento";
    (async () => {
      setLoading(true);
      await recarregar();
      const { data: log } = await supabase
        .from("orcamento_omie_sync_log" as any)
        .select("concluido_em").eq("status", "ok")
        .order("concluido_em", { ascending: false }).limit(1).maybeSingle();
      setLastSync((log as any)?.concluido_em ?? null);
      setLoading(false);
    })();
  }, []);

  async function abrirPrevia() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("omie-orcamento-sync", { body: { action: "preview", ano: ANO } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setPreview(data);
    } catch (e: any) {
      toast.error("Falha na prévia do Omie: " + (e?.message ?? String(e)));
    } finally {
      setSyncing(false);
    }
  }

  async function aplicarSync() {
    setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke("omie-orcamento-sync", { body: { action: "sync", ano: ANO } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Realizado sincronizado do Omie · ${(data as any).linhas_atualizadas} linhas atualizadas.`);
      setPreview(null);
      await recarregar();
      setLastSync(new Date().toISOString());
    } catch (e: any) {
      toast.error("Falha ao sincronizar: " + (e?.message ?? String(e)));
    } finally {
      setApplying(false);
    }
  }

  const areaAgg = useMemo(() => {
    const map = new Map<string, { orcado: number; realizado: number; hasData: boolean }>();
    ALL_AREAS.forEach(a => map.set(a, { orcado: 0, realizado: 0, hasData: false }));
    for (const r of areaRows) {
      if (scope === "mes" && r.mes !== mes) continue;
      if (scope === "acum" && r.mes > mes) continue;
      const cur = map.get(r.area) ?? { orcado: 0, realizado: 0, hasData: false };
      cur.orcado += Number(r.orcado || 0);
      cur.realizado += Number(r.realizado || 0);
      if (Number(r.orcado || 0) > 0 || Number(r.realizado || 0) > 0) cur.hasData = true;
      map.set(r.area, cur);
    }
    return ALL_AREAS.map(area => {
      const v = map.get(area)!;
      const saldo = v.orcado - v.realizado;
      const pct = v.orcado > 0 ? (v.realizado / v.orcado) * 100 : null;
      const status: Status = !v.hasData ? "sem" : statusFromPct(pct, true);
      return { area, orcado: v.orcado, realizado: v.realizado, saldo, consumido_pct: pct, status };
    });
  }, [areaRows, scope, mes]);

  const linhaAgg = useMemo(() => {
    const map = new Map<string, { area: string; subcategoria: string; pessoal: boolean; orcado: number; realizado: number }>();
    for (const r of linhaRows) {
      if (scope === "mes" && r.mes !== mes) continue;
      if (scope === "acum" && r.mes > mes) continue;
      const key = `${r.area}::${r.subcategoria}`;
      const cur = map.get(key) ?? { area: r.area, subcategoria: r.subcategoria, pessoal: r.pessoal, orcado: 0, realizado: 0 };
      cur.orcado += Number(r.orcado || 0);
      cur.realizado += Number(r.realizado || 0);
      map.set(key, cur);
    }
    return Array.from(map.values());
  }, [linhaRows, scope, mes]);

  const totals = useMemo(() => {
    const withData = areaAgg.filter(a => a.status !== "sem");
    const orcado = withData.reduce((s, a) => s + a.orcado, 0);
    const realizado = withData.reduce((s, a) => s + a.realizado, 0);
    const saldo = orcado - realizado;
    const pct = orcado > 0 ? (realizado / orcado) * 100 : 0;
    const estouradas = withData.filter(a => a.status === "estourado").length;
    return { orcado, realizado, saldo, pct, estouradas, totalAreas: withData.length };
  }, [areaAgg]);

  const chartData = useMemo(() => areaAgg
    .filter(a => a.status !== "sem")
    .map(a => ({ area: a.area, planejado: a.orcado, realizado: a.realizado, status: a.status })),
  [areaAgg]);

  const handleExport = () => {
    const header = ["area","subcategoria","pessoal","orcado","realizado","saldo","consumido_pct"];
    const lines = [header.join(";")];
    for (const r of linhaAgg) {
      const saldo = r.orcado - r.realizado;
      const pct = r.orcado > 0 ? ((r.realizado / r.orcado) * 100).toFixed(2) : "";
      lines.push([r.area, r.subcategoria, r.pessoal ? "true":"false", r.orcado.toFixed(2), r.realizado.toFixed(2), saldo.toFixed(2), pct].join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `orcamento_${scope}_${mes}_${ANO}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-5 py-5 space-y-5">
      {/* Banner de fonte do realizado */}
      {areaRows.some((r: any) => r.tem_omie) ? (
        <div className="flex items-center gap-2 rounded-md border border-pos/30 bg-pos-soft px-3 py-2 text-[12.5px] text-pos">
          <Check className="h-4 w-4 shrink-0" />
          <span>
            Realizado sincronizado do Omie (competência){lastSync ? ` · última sync ${fmtDateTime(lastSync)}` : ""}. Linhas sem categoria no Omie usam o tracker.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Realizado do tracker (provisório). Clique em "Sincronizar com Omie" para puxar o realizado direto do ERP.</span>
        </div>
      )}

      {/* Título + controles */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Orçamento por área</h1>
          <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <span>Planejado vs. realizado ·</span>
            <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
              <SelectTrigger className="h-7 w-[130px] text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESES.map((m, i) => (
                  <SelectItem key={i} value={String(i+1)}>{m}/{ANO}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedToggle
            value={scope}
            onChange={(v) => setScope(v as "mes"|"acum")}
            options={[{ v: "mes", label: "Mês" }, { v: "acum", label: "Acumulado" }]}
          />
          <SegmentedToggle
            value={view}
            onChange={(v) => setView(v as "resumo"|"tabela")}
            options={[{ v: "resumo", label: "Resumo" }, { v: "tabela", label: "Tabela" }]}
          />
          <Button variant="outline" size="sm" onClick={abrirPrevia} disabled={syncing} className="h-8 gap-1.5">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />} Sincronizar com Omie
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="h-8 gap-1.5">
            <Download className="h-3.5 w-3.5" /> Exportar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiBox label={`Orçamento (${scope === "mes" ? "mês" : "acum."})`} value={brlAbbr(totals.orcado)} />
        <KpiBox label="Realizado" value={brlAbbr(totals.realizado)} sub={`${totals.pct.toFixed(1)}% do orçamento`} />
        <KpiBox
          label="Saldo"
          value={brlAbbr(totals.saldo)}
          sub={totals.saldo >= 0 ? "disponível" : "acima do orçado"}
          valueClass={totals.saldo >= 0 ? "text-pos" : "text-neg"}
        />
        <KpiBox
          label="Áreas estouradas"
          value={`${totals.estouradas}/${totals.totalAreas}`}
          valueClass={totals.estouradas > 0 ? "text-neg" : undefined}
        />
      </div>

      {/* Chart */}
      <Card className="p-4">
        <div className="mb-3 text-[13px] font-semibold">Planejado vs. realizado por área</div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="area" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} interval={0} angle={-12} dy={8} height={50} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => brlAbbr(Number(v))} width={80} />
              <Tooltip
                formatter={(v: any) => brl(Number(v))}
                contentStyle={{
                  borderRadius: 8,
                  borderColor: "hsl(var(--border))",
                  backgroundColor: "hsl(var(--popover))",
                  color: "hsl(var(--popover-foreground))",
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                payload={[
                  { value: "Planejado", type: "square", color: "hsl(var(--muted-foreground) / 0.35)" },
                  { value: "Dentro", type: "square", color: "hsl(var(--pos))" },
                  { value: "Atenção", type: "square", color: "hsl(var(--warn))" },
                  { value: "Estourado", type: "square", color: "hsl(var(--neg))" },
                ]}
              />
              <Bar dataKey="planejado" name="Planejado" fill="hsl(var(--muted-foreground) / 0.25)" radius={[4,4,0,0]} />
              <Bar dataKey="realizado" name="Realizado" radius={[4,4,0,0]}
                shape={(props: any) => {
                  const { x, y, width, height, payload } = props;
                  return <rect x={x} y={y} width={width} height={height} fill={statusHsl(payload.status)} rx={4} ry={4} />;
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Conteúdo */}
      {view === "resumo" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {areaAgg.filter(a => a.status !== "sem").map(a => (
            <AreaCard key={a.area} area={a} linhas={linhaAgg.filter(l => l.area === a.area)} />
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/60">
              <tr className="text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Área</th>
                <th className="px-3 py-2 text-right font-semibold">Orçado</th>
                <th className="px-3 py-2 text-right font-semibold">Realizado</th>
                <th className="px-3 py-2 text-right font-semibold">Saldo</th>
                <th className="px-3 py-2 text-right font-semibold">Consumido</th>
                <th className="px-3 py-2 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {areaAgg.map(a => (
                <tr key={a.area} className="border-t border-border">
                  <td className="px-3 py-2">{a.area}</td>
                  <td className="px-3 py-2 text-right num">{brl(a.orcado)}</td>
                  <td className="px-3 py-2 text-right num">{a.status === "sem" ? "—" : brl(a.realizado)}</td>
                  <td className={cn("px-3 py-2 text-right num", a.status !== "sem" && (a.saldo >= 0 ? "text-pos" : "text-neg"))}>
                    {a.status === "sem" ? "—" : brl(a.saldo)}
                  </td>
                  <td className="px-3 py-2 text-right num">{a.status === "sem" || a.consumido_pct === null ? "—" : `${a.consumido_pct.toFixed(1)}%`}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant="outline" className={statusBadgeClass(a.status)}>{statusLabel(a.status)}</Badge>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border bg-muted/60 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right num">{brl(totals.orcado)}</td>
                <td className="px-3 py-2 text-right num">{brl(totals.realizado)}</td>
                <td className={cn("px-3 py-2 text-right num", totals.saldo >= 0 ? "text-pos" : "text-neg")}>{brl(totals.saldo)}</td>
                <td className="px-3 py-2 text-right num">{totals.pct.toFixed(1)}%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      {loading && <div className="text-center text-[12px] text-muted-foreground">Carregando…</div>}

      {/* Prévia da sincronização com o Omie */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Prévia — realizado do Omie ({ANO})</DialogTitle>
          </DialogHeader>
          {preview && !preview.error && (
            <div className="space-y-4">
              <p className="text-[12.5px] text-muted-foreground">
                {preview.movimentos} movimentos lidos (competência). Comparação do realizado atual (tracker) com o do Omie, por área. Nada é gravado até você aplicar.
              </p>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Área</th>
                      <th className="px-3 py-2 text-right font-semibold">Atual (tracker)</th>
                      <th className="px-3 py-2 text-right font-semibold">Novo (Omie)</th>
                      <th className="px-3 py-2 text-right font-semibold">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.areas.map((a: any) => (
                      <tr key={a.area} className="border-t border-border">
                        <td className="px-3 py-1.5">{a.area}</td>
                        <td className="px-3 py-1.5 text-right num">{brlAbbr(a.atual)}</td>
                        <td className="px-3 py-1.5 text-right num">{brlAbbr(a.novo)}</td>
                        <td className={cn("px-3 py-1.5 text-right num", a.delta > 0 ? "text-neg" : a.delta < 0 ? "text-pos" : "")}>
                          {a.delta >= 0 ? "+" : ""}{brlAbbr(a.delta)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-border bg-muted/60 font-semibold">
                      <td className="px-3 py-1.5">Total</td>
                      <td className="px-3 py-1.5 text-right num">{brlAbbr(preview.total_atual)}</td>
                      <td className="px-3 py-1.5 text-right num">{brlAbbr(preview.total_novo)}</td>
                      <td className="px-3 py-1.5 text-right num">{preview.total_novo - preview.total_atual >= 0 ? "+" : ""}{brlAbbr(preview.total_novo - preview.total_atual)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {preview.linhas_sem_fonte?.length > 0 && (
                <div className="text-[11.5px] text-muted-foreground">
                  <span className="font-medium text-foreground">Sem fonte no Omie (mantêm o tracker):</span> {preview.linhas_sem_fonte.join(" · ")}
                </div>
              )}
              {preview.nao_mapeadas?.total > 0 && (
                <details className="rounded-md border border-border p-2 text-[11.5px]">
                  <summary className="cursor-pointer text-muted-foreground">
                    Despesas do Omie fora do orçamento: {brlAbbr(preview.nao_mapeadas.total)} ({preview.nao_mapeadas.qtd} categorias)
                  </summary>
                  <ul className="mt-2 space-y-0.5">
                    {preview.nao_mapeadas.top.map((x: any, i: number) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="truncate">{x.descricao}</span>
                        <span className="num shrink-0">{brlAbbr(x.valor)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Cancelar</Button>
            <Button onClick={aplicarSync} disabled={applying}>
              {applying ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              Aplicar sincronização
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SegmentedToggle<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5">
      {options.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "px-3 py-1 text-[12px] rounded-[5px] transition-colors",
            value === o.v ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KpiBox({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <Card className="p-4 transition-shadow hover:shadow-sm">
      <div className="eyebrow">{label}</div>
      <div className={cn("num mt-1 text-[26px] font-semibold leading-tight tracking-tight", valueClass)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function AreaCard({ area: a, linhas }: { area: any; linhas: any[] }) {
  if (a.status === "sem") {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold">{a.area}</div>
          <Badge variant="outline" className="text-muted-foreground">Sem dados</Badge>
        </div>
        <div className="py-6 text-center text-[12px] italic text-muted-foreground">
          Sem fonte — definir origem
        </div>
      </Card>
    );
  }
  const pct = a.consumido_pct ?? 0;
  const sorted = [...linhas].sort((x, y) => Number(y.realizado || y.orcado) - Number(x.realizado || x.orcado));
  const color = statusHsl(a.status);
  return (
    <Card className="flex flex-col gap-2 p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">{a.area}</div>
        <Badge variant="outline" className={statusBadgeClass(a.status)}>{statusLabel(a.status)}</Badge>
      </div>
      <div>
        <div className="num text-[20px] font-semibold leading-tight">{brlAbbr(a.realizado)}</div>
        <div className="text-[11.5px] text-muted-foreground">de {brlAbbr(a.orcado)}</div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
      </div>
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-muted-foreground">{pct.toFixed(1)}% consumido</span>
        <span className={cn("num font-medium", a.saldo >= 0 ? "text-pos" : "text-neg")}>
          {a.saldo >= 0 ? "+" : ""}{brlAbbr(a.saldo)}
        </span>
      </div>
      <Accordion type="single" collapsible className="mt-1 border-t border-border pt-1">
        <AccordionItem value="comp" className="border-0">
          <AccordionTrigger className="py-1.5 text-[12px] text-primary hover:no-underline">Ver composição</AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-2 pt-1">
              {sorted.length === 0 && <li className="text-[12px] text-muted-foreground">Sem subcategorias.</li>}
              {sorted.map((l) => {
                const lpct = l.orcado > 0 ? Math.min(100, (l.realizado / l.orcado) * 100) : 0;
                const lstatus: Status = l.orcado > 0 ? statusFromPct((l.realizado/l.orcado)*100, true) : "sem";
                const lcolor = statusHsl(lstatus);
                return (
                  <li key={l.subcategoria} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11.5px]">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{l.subcategoria}</span>
                        {l.pessoal && (
                          <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">folha</span>
                        )}
                      </div>
                      <span className="num shrink-0 text-muted-foreground">
                        <span className="text-foreground">{brlAbbr(l.realizado)}</span> / {brlAbbr(l.orcado)}
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${lpct}%`, backgroundColor: lcolor }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
