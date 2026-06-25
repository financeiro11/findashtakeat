import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertTriangle, Download, ChevronRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";

type AreaRow = {
  area: string; ano: number; mes: number;
  orcado: number; orcado_pessoal: number;
  realizado: number; realizado_pessoal: number;
  saldo: number; consumido_pct: number | null;
  status: "dentro" | "atencao" | "estourado" | "sem";
};
type LinhaRow = {
  area: string; subcategoria: string; pessoal: boolean;
  ano: number; mes: number;
  orcado: number; realizado: number; saldo: number; consumido_pct: number | null;
};

const ANO = 2026;
const ALL_AREAS = ["Comercial","Novos Canais","Backoffice","Operações","Marketing","Produto","Tecnologia","Corporativo/Adm"];
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const COLORS = {
  bg: "#FFFEF2",
  text: "#222222",
  red: "#C8131B",
  green: "#1F9D57",
  amber: "#F2A93B",
  grayBar: "#D8D4C8",
  border: "#ECE8DB",
};

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

function statusFromPct(pct: number | null, hasData: boolean): AreaRow["status"] {
  if (!hasData) return "sem";
  if (pct === null || pct === undefined) return "sem";
  if (pct > 100) return "estourado";
  if (pct >= 90) return "atencao";
  return "dentro";
}

function statusColor(s: AreaRow["status"]) {
  return s === "dentro" ? COLORS.green : s === "atencao" ? COLORS.amber : s === "estourado" ? COLORS.red : "#9CA3AF";
}
function statusLabel(s: AreaRow["status"]) {
  return s === "dentro" ? "Dentro" : s === "atencao" ? "Atenção" : s === "estourado" ? "Estourado" : "Sem dados";
}

export default function Orcamento() {
  const [areaRows, setAreaRows] = useState<AreaRow[]>([]);
  const [linhaRows, setLinhaRows] = useState<LinhaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mes"|"acum">("mes");
  const [view, setView] = useState<"resumo"|"tabela">("resumo");
  const [mes, setMes] = useState<number>(5);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [a, l] = await Promise.all([
        supabase.from("vw_orcamento_area").select("*").eq("ano", ANO),
        supabase.from("vw_orcamento_area_linha").select("*").eq("ano", ANO),
      ]);
      setAreaRows((a.data as any) ?? []);
      setLinhaRows((l.data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  // Aggregate to scope
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
      const status: AreaRow["status"] = !v.hasData ? "sem" : statusFromPct(pct, true);
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

  const fontHead = { fontFamily: 'Poppins, "Inter Tight", sans-serif' };
  const fontBody = { fontFamily: 'Montserrat, "Inter Tight", sans-serif' };

  return (
    <div className="min-h-full" style={{ backgroundColor: COLORS.bg, color: COLORS.text, ...fontBody }}>
      {/* Chrome */}
      <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: COLORS.border }}>
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "#888" }}>Hub Financeiro</span>
          <ChevronRight className="h-3 w-3" style={{ color: "#888" }} />
          <span className="text-[13px] font-semibold" style={fontHead}>Orçamento por área</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border" style={{ borderColor: COLORS.border, backgroundColor: "#fff" }}>
            <button
              onClick={() => setScope("mes")}
              className={cn("px-3 py-1 text-[12px] rounded-l-md transition-colors")}
              style={{ backgroundColor: scope === "mes" ? COLORS.red : "transparent", color: scope === "mes" ? "#fff" : COLORS.text }}
            >Mês</button>
            <button
              onClick={() => setScope("acum")}
              className={cn("px-3 py-1 text-[12px] rounded-r-md transition-colors")}
              style={{ backgroundColor: scope === "acum" ? COLORS.red : "transparent", color: scope === "acum" ? "#fff" : COLORS.text }}
            >Acumulado</button>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 h-8" style={{ borderColor: COLORS.border, backgroundColor: "#fff" }}>
            <Download className="h-3.5 w-3.5" /> Exportar
          </Button>
        </div>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Banner */}
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ backgroundColor: "#FFF7D6", border: `1px solid #F0E2A6`, color: "#7A5A00" }}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Dados provisórios — mapeamento linha→área a validar.
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold leading-tight" style={fontHead}>Orçamento por área</h1>
            <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "#666" }}>
              <span>Planejado vs. realizado ·</span>
              <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
                <SelectTrigger className="h-7 w-[130px] text-[12.5px]" style={{ backgroundColor: "#fff", borderColor: COLORS.border }}>
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
          <div className="inline-flex rounded-md border" style={{ borderColor: COLORS.border, backgroundColor: "#fff" }}>
            <button onClick={() => setView("resumo")} className="px-3 py-1 text-[12px] rounded-l-md transition-colors"
              style={{ backgroundColor: view === "resumo" ? COLORS.red : "transparent", color: view === "resumo" ? "#fff" : COLORS.text }}>Resumo</button>
            <button onClick={() => setView("tabela")} className="px-3 py-1 text-[12px] rounded-r-md transition-colors"
              style={{ backgroundColor: view === "tabela" ? COLORS.red : "transparent", color: view === "tabela" ? "#fff" : COLORS.text }}>Tabela</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiBox label={`Orçamento (${scope === "mes" ? "mês" : "acum."})`} value={brlAbbr(totals.orcado)} fontHead={fontHead} />
          <KpiBox label="Realizado" value={brlAbbr(totals.realizado)} sub={`${totals.pct.toFixed(1)}% do orçamento`} fontHead={fontHead} />
          <KpiBox
            label="Saldo"
            value={brlAbbr(totals.saldo)}
            sub={totals.saldo >= 0 ? "disponível" : "acima do orçado"}
            valueColor={totals.saldo >= 0 ? COLORS.green : COLORS.red}
            fontHead={fontHead}
          />
          <KpiBox
            label="Áreas estouradas"
            value={`${totals.estouradas}/${totals.totalAreas}`}
            valueColor={totals.estouradas > 0 ? COLORS.red : COLORS.text}
            fontHead={fontHead}
          />
        </div>

        {/* Chart */}
        <Card className="p-4" style={{ borderColor: COLORS.border, backgroundColor: "#fff" }}>
          <div className="text-[13px] font-semibold mb-3" style={fontHead}>Planejado vs. realizado por área</div>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEE9D8" vertical={false} />
                <XAxis dataKey="area" tick={{ fontSize: 11, fill: "#555" }} interval={0} angle={-12} dy={8} height={50} />
                <YAxis tick={{ fontSize: 11, fill: "#555" }} tickFormatter={(v) => brlAbbr(Number(v))} width={80} />
                <Tooltip formatter={(v: any) => brl(Number(v))} contentStyle={{ borderRadius: 8, borderColor: COLORS.border, fontSize: 12 }} />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  payload={[
                    { value: "Planejado", type: "square", color: COLORS.grayBar },
                    { value: "Dentro", type: "square", color: COLORS.green },
                    { value: "Atenção", type: "square", color: COLORS.amber },
                    { value: "Estourado", type: "square", color: COLORS.red },
                  ]}
                />
                <Bar dataKey="planejado" name="Planejado" fill={COLORS.grayBar} radius={[4,4,0,0]} />
                <Bar dataKey="realizado" name="Realizado" radius={[4,4,0,0]}
                  shape={(props: any) => {
                    const { x, y, width, height, payload } = props;
                    const fill = statusColor(payload.status);
                    return <rect x={x} y={y} width={width} height={height} fill={fill} rx={4} ry={4} />;
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Content */}
        {view === "resumo" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {areaAgg.map(a => (
              <AreaCard key={a.area} area={a} linhas={linhaAgg.filter(l => l.area === a.area)} fontHead={fontHead} />
            ))}
          </div>
        ) : (
          <Card className="overflow-hidden" style={{ borderColor: COLORS.border, backgroundColor: "#fff" }}>
            <table className="w-full text-[12.5px]">
              <thead style={{ backgroundColor: "#FAF7E8" }}>
                <tr>
                  <th className="px-3 py-2 text-left font-semibold" style={fontHead}>Área</th>
                  <th className="px-3 py-2 text-right font-semibold" style={fontHead}>Orçado</th>
                  <th className="px-3 py-2 text-right font-semibold" style={fontHead}>Realizado</th>
                  <th className="px-3 py-2 text-right font-semibold" style={fontHead}>Saldo</th>
                  <th className="px-3 py-2 text-right font-semibold" style={fontHead}>Consumido</th>
                  <th className="px-3 py-2 text-center font-semibold" style={fontHead}>Status</th>
                </tr>
              </thead>
              <tbody>
                {areaAgg.map(a => (
                  <tr key={a.area} className="border-t" style={{ borderColor: COLORS.border }}>
                    <td className="px-3 py-2">{a.area}</td>
                    <td className="px-3 py-2 text-right num">{brl(a.orcado)}</td>
                    <td className="px-3 py-2 text-right num">{a.status === "sem" ? "—" : brl(a.realizado)}</td>
                    <td className="px-3 py-2 text-right num" style={{ color: a.status === "sem" ? undefined : (a.saldo >= 0 ? COLORS.green : COLORS.red) }}>
                      {a.status === "sem" ? "—" : brl(a.saldo)}
                    </td>
                    <td className="px-3 py-2 text-right num">{a.status === "sem" || a.consumido_pct === null ? "—" : `${a.consumido_pct.toFixed(1)}%`}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="outline" style={{ backgroundColor: `${statusColor(a.status)}15`, color: statusColor(a.status), borderColor: `${statusColor(a.status)}40` }}>
                        {statusLabel(a.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-semibold" style={{ borderColor: COLORS.border, backgroundColor: "#FAF7E8" }}>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right num">{brl(totals.orcado)}</td>
                  <td className="px-3 py-2 text-right num">{brl(totals.realizado)}</td>
                  <td className="px-3 py-2 text-right num" style={{ color: totals.saldo >= 0 ? COLORS.green : COLORS.red }}>{brl(totals.saldo)}</td>
                  <td className="px-3 py-2 text-right num">{totals.pct.toFixed(1)}%</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </Card>
        )}

        {loading && <div className="text-center text-[12px]" style={{ color: "#888" }}>Carregando…</div>}
      </div>
    </div>
  );
}

function KpiBox({ label, value, sub, valueColor, fontHead }: { label: string; value: string; sub?: string; valueColor?: string; fontHead: any }) {
  return (
    <Card className="p-4 transition-shadow hover:shadow-md" style={{ borderColor: COLORS.border, backgroundColor: "#fff" }}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: "#888" }}>{label}</div>
      <div className="num text-[26px] font-semibold mt-1 leading-tight" style={{ ...fontHead, color: valueColor ?? COLORS.text }}>{value}</div>
      {sub && <div className="text-[11.5px] mt-0.5" style={{ color: "#666" }}>{sub}</div>}
    </Card>
  );
}

function AreaCard({ area: a, linhas, fontHead }: { area: ReturnType<typeof statusFromPct> extends never ? never : any; linhas: any[]; fontHead: any }) {
  const color = statusColor(a.status);
  if (a.status === "sem") {
    return (
      <Card className="p-4 flex flex-col gap-2" style={{ borderColor: COLORS.border, backgroundColor: "#fff" }}>
        <div className="flex items-center justify-between">
          <div className="font-semibold text-[14px]" style={fontHead}>{a.area}</div>
          <Badge variant="outline" style={{ color: "#888", borderColor: COLORS.border }}>Sem dados</Badge>
        </div>
        <div className="text-[12px] italic mt-4 text-center py-6" style={{ color: "#999" }}>
          Sem fonte — definir origem
        </div>
      </Card>
    );
  }
  const pct = a.consumido_pct ?? 0;
  const sorted = [...linhas].sort((x, y) => Number(y.realizado || y.orcado) - Number(x.realizado || x.orcado));
  return (
    <Card className="p-4 flex flex-col gap-2 transition-shadow hover:shadow-md" style={{ borderColor: COLORS.border, backgroundColor: "#fff" }}>
      <div className="flex items-center justify-between">
        <div className="font-semibold text-[14px]" style={fontHead}>{a.area}</div>
        <Badge variant="outline" style={{ backgroundColor: `${color}15`, color, borderColor: `${color}40` }}>{statusLabel(a.status)}</Badge>
      </div>
      <div>
        <div className="num text-[20px] font-semibold" style={{ ...fontHead, color: COLORS.text }}>{brlAbbr(a.realizado)}</div>
        <div className="text-[11.5px]" style={{ color: "#666" }}>de {brlAbbr(a.orcado)}</div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "#F2EFE0" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
      </div>
      <div className="flex items-center justify-between text-[11.5px]">
        <span style={{ color: "#666" }}>{pct.toFixed(1)}% consumido</span>
        <span className="num font-medium" style={{ color: a.saldo >= 0 ? COLORS.green : COLORS.red }}>
          {a.saldo >= 0 ? "+" : ""}{brlAbbr(a.saldo)}
        </span>
      </div>
      <Accordion type="single" collapsible className="border-t pt-1 mt-1" style={{ borderColor: COLORS.border }}>
        <AccordionItem value="comp" className="border-0">
          <AccordionTrigger className="py-1.5 text-[12px] hover:no-underline" style={{ color: COLORS.red }}>Ver composição</AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-2 pt-1">
              {sorted.length === 0 && <li className="text-[12px]" style={{ color: "#999" }}>Sem subcategorias.</li>}
              {sorted.map((l) => {
                const lpct = l.orcado > 0 ? Math.min(100, (l.realizado / l.orcado) * 100) : 0;
                const lstatus = l.orcado > 0 ? statusFromPct((l.realizado/l.orcado)*100, true) : "sem";
                const lcolor = statusColor(lstatus);
                return (
                  <li key={l.subcategoria} className="space-y-1">
                    <div className="flex items-center justify-between text-[11.5px] gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate">{l.subcategoria}</span>
                        {l.pessoal && <span className="text-[9px] uppercase rounded px-1 py-0.5" style={{ backgroundColor: "#F2EFE0", color: "#7A5A00" }}>folha</span>}
                      </div>
                      <span className="num shrink-0" style={{ color: "#666" }}>
                        <span style={{ color: COLORS.text }}>{brlAbbr(l.realizado)}</span> / {brlAbbr(l.orcado)}
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: "#F2EFE0" }}>
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
