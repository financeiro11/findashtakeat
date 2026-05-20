import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { openAIAssistant } from "@/components/AIAssistant";

type Premissa = { valor: number; frequencia: "mensal" | "anual" };
type Cenario = {
  id: string;
  nome: string;
  descricao: string | null;
  meses_projecao: number;
  premissas: Record<string, Premissa | number>;
  projecao: any[] | null;
  sensibilidade: any[] | null;
  analise: string | null;
  graficos: any[] | null;
};

const PREMISSAS_PADRAO: Record<string, Premissa> = {
  crescimento_receita_aa_pct: { valor: 20, frequencia: "anual" },
  inflacao_custos_aa_pct: { valor: 6, frequencia: "anual" },
  margem_bruta_alvo_pct: { valor: 70, frequencia: "mensal" },
  churn_mensal_pct: { valor: 2, frequencia: "mensal" },
  cac: { valor: 5000, frequencia: "mensal" },
  ltv: { valor: 30000, frequencia: "mensal" },
  headcount_delta: { valor: 0, frequencia: "mensal" },
  capex_mensal: { valor: 0, frequencia: "mensal" },
};

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent-foreground))",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
  "hsl(217 91% 60%)",
  "hsl(142 71% 45%)",
];

function asPremissa(v: Premissa | number | undefined): Premissa {
  if (typeof v === "number") return { valor: v, frequencia: "mensal" };
  if (v && typeof v === "object") return { valor: Number(v.valor ?? 0), frequencia: (v.frequencia as any) || "mensal" };
  return { valor: 0, frequencia: "mensal" };
}

export default function AnalisePreditiva() {
  const [cenarios, setCenarios] = useState<Cenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [novoNome, setNovoNome] = useState("");

  useEffect(() => { document.title = "Análise Preditiva · Cenários"; load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("cenarios" as any).select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else { setCenarios((data as any) || []); if (!selId && data?.length) setSelId((data as any)[0].id); }
    setLoading(false);
  };

  const sel = useMemo(() => cenarios.find(c => c.id === selId) || null, [cenarios, selId]);

  const criar = async () => {
    if (!novoNome) return toast.error("Informe um nome");
    const { data, error } = await supabase.from("cenarios" as any).insert({
      nome: novoNome, premissas: PREMISSAS_PADRAO, meses_projecao: 12,
    }).select().single();
    if (error) toast.error(error.message);
    else { setNovoNome(""); await load(); setSelId((data as any).id); }
  };

  const remover = async (id: string) => {
    if (!confirm("Excluir cenário?")) return;
    const { error } = await supabase.from("cenarios" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else { setSelId(null); load(); }
  };

  const salvarPremissas = async (patch: Partial<Cenario>) => {
    if (!sel) return;
    const { error } = await supabase.from("cenarios" as any).update(patch).eq("id", sel.id);
    if (error) toast.error(error.message); else load();
  };

  const rodar = async () => {
    if (!sel) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("projetar-cenario", {
        body: { cenario_id: sel.id, premissas: sel.premissas, meses_projecao: sel.meses_projecao },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Projeção gerada");
      load();
    } catch (e: any) {
      toast.error(e.message || "Falha na projeção");
    } finally { setRunning(false); }
  };

  const updatePrem = (k: string, patch: Partial<Premissa>) => {
    if (!sel) return;
    const atual = asPremissa(sel.premissas?.[k]);
    const novo = { ...(sel.premissas || {}), [k]: { ...atual, ...patch } };
    setCenarios(cs => cs.map(c => c.id === sel.id ? { ...c, premissas: novo } : c));
  };

  const renderChart = (g: any) => {
    if (!sel?.projecao) return null;
    const data = sel.projecao;
    const series = (g.series || []) as { campo: string; rotulo: string }[];
    const Chart = g.tipo === "bar" ? BarChart : g.tipo === "area" ? AreaChart : LineChart;
    return (
      <Card key={g.titulo}>
        <CardHeader>
          <div className="font-semibold text-sm">{g.titulo}</div>
          {g.descricao && <div className="text-xs text-muted-foreground">{g.descricao}</div>}
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <Chart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="mes" />
                <YAxis />
                <Tooltip />
                <Legend />
                {series.map((s, i) => {
                  const c = COLORS[i % COLORS.length];
                  if (g.tipo === "bar") return <Bar key={s.campo} dataKey={s.campo} name={s.rotulo} fill={c} />;
                  if (g.tipo === "area") return <Area key={s.campo} type="monotone" dataKey={s.campo} name={s.rotulo} stroke={c} fill={c} fillOpacity={0.15} />;
                  return <Line key={s.campo} type="monotone" dataKey={s.campo} name={s.rotulo} stroke={c} />;
                })}
              </Chart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6 p-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Análise Preditiva</h2>
        <p className="text-sm text-muted-foreground">Crie cenários, ajuste premissas e deixe a IA projetar resultados ancorada em DRE, DFC, BP e na base de conhecimento.</p>
      </div>

      <Card>
        <CardHeader><div className="font-semibold">Novo cenário</div></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input placeholder="Nome (ex: Base, Otimista, Pessimista)" value={novoNome} onChange={e => setNovoNome(e.target.value)} />
            <Button onClick={criar}><Plus className="mr-2 h-4 w-4" /> Criar</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {cenarios.map(c => (
          <Button key={c.id} variant={c.id === selId ? "default" : "outline"} size="sm" onClick={() => setSelId(c.id)}>
            {c.nome}
          </Button>
        ))}
        {!cenarios.length && !loading && <div className="text-sm text-muted-foreground">Nenhum cenário ainda.</div>}
      </div>

      {sel && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <div className="font-semibold">{sel.nome}</div>
              <div className="text-xs text-muted-foreground">Ajuste premissas e clique em Rodar.</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => openAIAssistant(`Analise o cenário "${sel.nome}". Premissas: ${JSON.stringify(sel.premissas)}. ${sel.projecao ? `Projeção: ${JSON.stringify(sel.projecao).slice(0, 2000)}` : ""} Compare com o histórico do DRE e diga riscos, oportunidades e o que ajustar.`)}>
                <Sparkles className="mr-2 h-4 w-4" /> Analisar com IA
              </Button>
              <Button onClick={rodar} disabled={running}>
                {running ? <><Sparkles className="mr-2 h-4 w-4 animate-pulse" /> Calculando...</> : <><Play className="mr-2 h-4 w-4" /> Rodar projeção</>}
              </Button>
              <Button variant="outline" onClick={() => remover(sel.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(sel.premissas || {}).map(([k, raw]) => {
                const p = asPremissa(raw as any);
                return (
                  <div key={k} className="space-y-1 rounded-md border border-border p-2">
                    <Label className="text-xs">{k}</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number" value={p.valor}
                        onChange={(e) => updatePrem(k, { valor: Number(e.target.value) })}
                        onBlur={() => salvarPremissas({ premissas: sel.premissas })}
                      />
                      <Select
                        value={p.frequencia}
                        onValueChange={(v) => { updatePrem(k, { frequencia: v as any }); setTimeout(() => salvarPremissas({ premissas: sel.premissas }), 0); }}
                      >
                        <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mensal">Mensal</SelectItem>
                          <SelectItem value="anual">Anual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
              <div className="space-y-1 rounded-md border border-border p-2">
                <Label className="text-xs">meses_projecao</Label>
                <Input type="number" value={sel.meses_projecao}
                  onChange={(e) => setCenarios(cs => cs.map(c => c.id === sel.id ? { ...c, meses_projecao: Number(e.target.value) } : c))}
                  onBlur={() => salvarPremissas({ meses_projecao: sel.meses_projecao })} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {sel?.projecao && Array.isArray(sel.projecao) && sel.projecao.length > 0 && (
        <>
          {Array.isArray(sel.graficos) && sel.graficos.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {sel.graficos.map(renderChart)}
            </div>
          ) : (
            <Card>
              <CardHeader><div className="font-semibold">Projeção mensal</div></CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sel.projecao}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="mes" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="receita" stroke="hsl(var(--primary))" />
                      <Line type="monotone" dataKey="ebitda" stroke="hsl(var(--accent-foreground))" />
                      <Line type="monotone" dataKey="resultado_liquido" stroke="hsl(var(--destructive))" />
                      <Line type="monotone" dataKey="fluxo_caixa" stroke="hsl(var(--muted-foreground))" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {sel?.sensibilidade && Array.isArray(sel.sensibilidade) && sel.sensibilidade.length > 0 && (
        <Card>
          <CardHeader><div className="font-semibold">Sensibilidade (impacto no EBITDA)</div></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Variável</TableHead>
                <TableHead className="text-right">+10%</TableHead>
                <TableHead className="text-right">-10%</TableHead>
                <TableHead>Comentário</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sel.sensibilidade.map((s: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{s.variavel}</TableCell>
                    <TableCell className="text-right">{Number(s.impacto_pos_10pct).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">{Number(s.impacto_neg_10pct).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.comentario}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {sel?.analise && (
        <Card>
          <CardHeader><div className="font-semibold">Análise da IA</div></CardHeader>
          <CardContent>
            <Textarea readOnly value={sel.analise} rows={Math.min(20, sel.analise.split("\n").length + 4)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
