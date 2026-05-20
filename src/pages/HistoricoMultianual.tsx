import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, BarChart, Bar,
} from "recharts";

type Row = { id: string; metrica: string; ano: number; mes: number; valor: number; origem: string | null };

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 0, style: "currency", currency: "BRL" });

const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

export default function HistoricoMultianual() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrica, setMetrica] = useState<string>("");
  const [origem, setOrigem] = useState<string>("__all__");

  useEffect(() => { document.title = "Análise · Histórico Multianual"; load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("historico_financeiro" as any)
      .select("*")
      .order("ano").order("mes")
      .limit(10000);
    if (error) toast.error(error.message);
    else setRows((data as any) || []);
    setLoading(false);
  };

  const metricas = useMemo(() => Array.from(new Set(rows.map(r => r.metrica))).sort(), [rows]);
  const origens = useMemo(() => Array.from(new Set(rows.map(r => r.origem).filter(Boolean) as string[])).sort(), [rows]);

  useEffect(() => { if (!metrica && metricas.length) setMetrica(metricas[0]); }, [metricas, metrica]);

  const filtered = useMemo(
    () => rows.filter(r => (origem === "__all__" || r.origem === origem) && r.metrica === metrica),
    [rows, metrica, origem]
  );

  // Linha temporal: x = "YYYY-MM", y = valor
  const serieTemporal = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const k = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
      map.set(k, (map.get(k) || 0) + Number(r.valor));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([periodo, valor]) => ({ periodo, valor }));
  }, [filtered]);

  // Comparação ano x ano: x = mês, séries = anos
  const comparativoAnos = useMemo(() => {
    const anos = Array.from(new Set(filtered.map(r => r.ano))).sort();
    const data = Array.from({ length: 12 }, (_, i) => {
      const obj: any = { mes: i + 1, mesLabel: ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][i] };
      for (const ano of anos) {
        const v = filtered.filter(r => r.ano === ano && r.mes === i + 1).reduce((s, r) => s + Number(r.valor), 0);
        obj[String(ano)] = v;
      }
      return obj;
    });
    return { data, anos };
  }, [filtered]);

  // Total por ano
  const totalPorAno = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of filtered) map.set(r.ano, (map.get(r.ano) || 0) + Number(r.valor));
    return Array.from(map.entries()).sort(([a], [b]) => a - b).map(([ano, total]) => ({ ano: String(ano), total }));
  }, [filtered]);

  const removerOrigem = async (o: string) => {
    if (!confirm(`Excluir todos os dados da origem "${o}"?`)) return;
    const { error } = await supabase.from("historico_financeiro" as any).delete().eq("origem", o);
    if (error) toast.error(error.message);
    else { toast.success("Removido"); load(); }
  };

  if (loading) return <div className="text-sm text-muted-foreground">Carregando...</div>;

  if (!rows.length) {
    return (
      <div className="space-y-4 p-5">
        <h2 className="text-2xl font-bold tracking-tight">Histórico Multianual</h2>
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Nenhum dado estruturado importado ainda. Vá em <strong>Análise · Base de Conhecimento</strong> e importe planilhas com layout "métricas nas linhas × meses nas colunas".
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Histórico Multianual</h2>
        <p className="text-sm text-muted-foreground">Séries temporais extraídas das planilhas importadas na Base de Conhecimento.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[260px]">
          <Select value={metrica} onValueChange={setMetrica}>
            <SelectTrigger><SelectValue placeholder="Selecione a métrica" /></SelectTrigger>
            <SelectContent>
              {metricas.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[260px]">
          <Select value={origem} onValueChange={setOrigem}>
            <SelectTrigger><SelectValue placeholder="Origem" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as origens</SelectItem>
              {origens.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader><div className="font-semibold">{metrica} · evolução mensal</div></CardHeader>
        <CardContent style={{ height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={serieTemporal}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v/1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
              <Line type="monotone" dataKey="valor" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><div className="font-semibold">Comparativo ano x ano</div></CardHeader>
          <CardContent style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={comparativoAnos.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="mesLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v/1000).toFixed(0) + "k"} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend />
                {comparativoAnos.anos.map((a, i) => (
                  <Line key={a} type="monotone" dataKey={String(a)} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="font-semibold">Total por ano</div></CardHeader>
          <CardContent style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={totalPorAno}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v/1000).toFixed(0) + "k"} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Bar dataKey="total" fill={PALETTE[2]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><div className="font-semibold">Origens importadas</div></CardHeader>
        <CardContent className="space-y-2">
          {origens.map(o => (
            <div key={o} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
              <span>{o}</span>
              <Button size="icon" variant="ghost" onClick={() => removerOrigem(o)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
