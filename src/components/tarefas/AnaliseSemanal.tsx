import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronLeft, ChevronRight, RefreshCw, Loader2, Sparkles, BarChart3, Clock, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// A skill "analise-tarefas-semana" (rodada em chat, via Supabase MCP) lê a tabela
// resumo_tarefas_semana e traduz o payload numérico em leitura executiva. Esta tela só
// LÊ o que já está publicado ali — nunca gera nada sozinha (mesmo padrão do Briefing
// Diário: geração é externa/agente; o Hub só exibe e, no máximo, dispara um recálculo
// dos NÚMEROS via RPC). O campo `leitura_md` é onde o agente publica a interpretação em
// prosa quando o usuário pedir — se estiver vazio, mostramos como recalcular os números
// e como pedir a leitura executiva.

type Natureza = "Operacional" | "Estratégico" | "Automação" | string;

interface PorNatureza { natureza: Natureza; n: number; lead_mediana: number; peso_medio: number; }
interface PorArea { area: string; n: number; lead_mediana: number; peso_medio: number; }
interface PorPessoa { pessoa: string; n: number; peso_total: number; }
interface TopItem { titulo: string; pessoa: string; area: string; lead_dias: number; peso?: number; }
interface Recorrente { familia: string; n: number; }

interface Payload {
  totais: { concluidas: number; lead_mediana: number; pct_operacional: number; pct_estrategico: number; pct_automacao: number };
  por_natureza: PorNatureza[];
  por_area: PorArea[];
  por_pessoa: PorPessoa[];
  top_pesadas: TopItem[];
  top_lead: TopItem[];
  recorrentes: Recorrente[];
}

interface Semana {
  id: string;
  semana_inicio: string;
  semana_fim: string;
  gerado_em: string;
  total_concluidas: number;
  payload: Payload;
  leitura_md: string | null;
  leitura_gerado_em: string | null;
}

const NATUREZA_COLOR: Record<string, string> = {
  "Operacional": "#3b82f6",
  "Estratégico": "#8b5cf6",
  "Automação": "#22c55e",
};
const AREA_PALETTE = ["#3b82f6", "#14b8a6", "#8b5cf6", "#22c55e", "#f59e0b", "#f43f5e", "#64748b", "#0ea5e9"];

function fmtCurta(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}
function fmtCurtaAno(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function fmtHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
// p_ref precisa cair na semana SEGUINTE à que queremos recalcular — a função sempre
// recalcula "a semana anterior à data passada". semana_inicio + 7 dias é sempre uma
// segunda-feira dentro dessa semana seguinte.
function pRefParaRecalcular(semanaInicio: string): string {
  const d = new Date(semanaInicio + "T00:00:00");
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const mdComponents = {
  p: (props: any) => <p {...props} className="mb-2 last:mb-0 text-[13px] leading-relaxed text-foreground/90" />,
  strong: (props: any) => <strong {...props} className="font-semibold text-foreground" />,
  ul: (props: any) => <ul {...props} className="mb-2 list-disc space-y-1 pl-5 text-[13px] text-foreground/90" />,
  li: (props: any) => <li {...props} />,
  h1: (props: any) => <h3 {...props} className="mb-1 text-[14px] font-semibold text-foreground" />,
  h2: (props: any) => <h3 {...props} className="mb-1 text-[14px] font-semibold text-foreground" />,
  h3: (props: any) => <h4 {...props} className="mb-1 text-[13px] font-semibold text-foreground" />,
};

export function AnaliseSemanal() {
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recalculando, setRecalculando] = useState(false);

  const load = useCallback(async (manterSemanaInicio?: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("resumo_tarefas_semana" as any)
      .select("id, semana_inicio, semana_fim, gerado_em, total_concluidas, payload, leitura_md, leitura_gerado_em")
      .order("semana_inicio", { ascending: false });
    if (error) {
      toast.error("Falha ao carregar análise: " + error.message);
      setLoading(false);
      return;
    }
    const rows = (data as any as Semana[]) ?? [];
    setSemanas(rows);
    if (manterSemanaInicio) {
      const i = rows.findIndex((r) => r.semana_inicio === manterSemanaInicio);
      setIdx(i >= 0 ? i : 0);
    } else {
      setIdx((prev) => Math.min(prev, Math.max(0, rows.length - 1)));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const atual = semanas[idx] ?? null;

  const recalcular = async () => {
    if (!atual) return;
    setRecalculando(true);
    try {
      const pRef = pRefParaRecalcular(atual.semana_inicio);
      const { error } = await supabase.rpc("fn_resumo_tarefas_semana" as any, { p_ref: pRef });
      if (error) throw error;
      toast.success("Números recalculados a partir das tarefas concluídas.");
      await load(atual.semana_inicio);
    } catch (e: any) {
      toast.error("Falha ao recalcular: " + e.message);
    } finally {
      setRecalculando(false);
    }
  };

  const mix = useMemo(() => {
    if (!atual) return [];
    const p = atual.payload.totais;
    const porNat = new Map(atual.payload.por_natureza.map((n) => [n.natureza, n]));
    return [
      { natureza: "Operacional", pct: p.pct_operacional, n: porNat.get("Operacional")?.n ?? 0 },
      { natureza: "Estratégico", pct: p.pct_estrategico, n: porNat.get("Estratégico")?.n ?? 0 },
      { natureza: "Automação", pct: p.pct_automacao, n: porNat.get("Automação")?.n ?? 0 },
    ].filter((m) => m.pct > 0 || m.n > 0);
  }, [atual]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[100px] rounded-lg" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[100px] rounded-lg" />)}
        </div>
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    );
  }

  if (!atual) {
    return (
      <div className="card-surface flex flex-col items-center gap-3 p-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BarChart3 className="h-6 w-6" />
        </div>
        <div className="text-[15px] font-semibold text-foreground">Nenhuma análise semanal gerada ainda</div>
        <p className="max-w-md text-[13px] text-muted-foreground">
          Todo segunda-feira às 03h o Hub calcula automaticamente os números da semana anterior.
          Peça ao assistente para "analisar as tarefas da semana" para ver a primeira leitura assim
          que houver dados.
        </p>
      </div>
    );
  }

  const p = atual.payload;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card-surface flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="eyebrow">Hub Financeiro · Análise de Tarefas</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            {fmtCurta(atual.semana_inicio)} a {fmtCurtaAno(atual.semana_fim)}
          </h1>
          <div className="mt-1 text-xs text-muted-foreground">
            {atual.total_concluidas} tarefa{atual.total_concluidas === 1 ? "" : "s"} concluída{atual.total_concluidas === 1 ? "" : "s"}
            {" · números recalculados em "}{fmtHora(atual.gerado_em)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => setIdx((i) => Math.min(i + 1, semanas.length - 1))} disabled={idx >= semanas.length - 1} title="Semana anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="num text-xs text-muted-foreground w-16 text-center">{idx + 1} / {semanas.length}</span>
          <Button size="icon" variant="outline" onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx <= 0} title="Próxima semana">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-border mx-1" />
          <Button variant="outline" onClick={recalcular} disabled={recalculando} title="Refaz os números desta semana a partir das tarefas concluídas agora">
            {recalculando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Recalcular
          </Button>
        </div>
      </div>

      {atual.total_concluidas === 0 ? (
        <div className="card-surface p-8 text-center text-[13px] text-muted-foreground">
          Nenhuma tarefa concluída nesta semana.
        </div>
      ) : (
        <>
          {/* Stats + mix */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatCard icon={ListChecks} label="Tarefas concluídas" value={String(p.totais.concluidas)} />
            <StatCard
              icon={Clock}
              label="Lead time mediano"
              value={`${p.totais.lead_mediana}d`}
              hint="tempo aberto no board — sinal de arrasto, não de esforço"
            />
            <div className="card-surface p-4">
              <div className="eyebrow mb-2">Mix por natureza</div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {mix.map((m) => (
                  <div key={m.natureza} style={{ width: `${m.pct}%`, background: NATUREZA_COLOR[m.natureza] ?? "#64748b" }} />
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                {mix.map((m) => (
                  <span key={m.natureza} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: NATUREZA_COLOR[m.natureza] ?? "#64748b" }} />
                    {m.natureza} <span className="num font-medium text-foreground">{m.pct}%</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Por área / Por pessoa */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card-surface p-4">
              <div className="eyebrow mb-3">Por área</div>
              <BarList
                items={p.por_area.map((a, i) => ({
                  key: a.area,
                  label: a.area,
                  sub: `${a.n} tarefa${a.n === 1 ? "" : "s"} · lead mediana ${a.lead_mediana}d`,
                  value: a.n,
                  color: AREA_PALETTE[i % AREA_PALETTE.length],
                }))}
              />
            </div>
            <div className="card-surface p-4">
              <div className="eyebrow mb-3">Por pessoa</div>
              <div className="space-y-2.5">
                {p.por_pessoa.map((pp) => (
                  <div key={pp.pessoa} className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                        {pp.pessoa.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="text-[13px] font-medium text-foreground">{pp.pessoa}</span>
                    </div>
                    <div className="text-right">
                      <div className="num text-[13px] font-semibold text-foreground">{pp.n} concluída{pp.n === 1 ? "" : "s"}</div>
                      <div className="num text-[11px] text-muted-foreground">peso total {pp.peso_total}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* O que arrastou / Mais complexas */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TopList title="O que arrastou" items={p.top_lead} metric="lead" />
            <TopList title="Mais complexas (peso estimado)" items={p.top_pesadas} metric="peso" />
          </div>

          {/* Recorrentes */}
          {p.recorrentes.length > 0 && (
            <div className="card-surface p-4">
              <div className="eyebrow mb-3">Recorrentes na semana</div>
              <div className="flex flex-wrap gap-2">
                {p.recorrentes.map((r) => (
                  <span key={r.familia} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-[12px] text-foreground">
                    {r.familia || "(sem título)"}
                    <span className="num rounded-full bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary">{r.n}×</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Leitura executiva (publicada pela skill) */}
      <div className="card-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-[13.5px] font-semibold text-foreground">Leitura executiva</span>
          {atual.leitura_gerado_em && (
            <span className="text-[11px] text-muted-foreground">· publicada em {fmtHora(atual.leitura_gerado_em)}</span>
          )}
        </div>
        {atual.leitura_md ? (
          <ReactMarkdown components={mdComponents}>{atual.leitura_md}</ReactMarkdown>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            Ainda não há leitura publicada para esta semana. Peça ao assistente para "analisar as
            tarefas da semana e publicar a leitura no Hub" — a interpretação aparece aqui assim que
            for gravada.
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint?: string;
}) {
  return (
    <div className="card-surface flex items-start gap-3 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground/70">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="eyebrow">{label}</div>
        <div className="num mt-0.5 text-[22px] font-semibold leading-none text-foreground">{value}</div>
        {hint && <div className="mt-1.5 text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function BarList({ items }: { items: { key: string; label: string; sub: string; value: number; color: string }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (items.length === 0) {
    return <div className="py-6 text-center text-[12.5px] text-muted-foreground">Sem dados.</div>;
  }
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.key}>
          <div className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="truncate font-medium text-foreground">{it.label}</span>
            <span className="text-[11.5px] text-muted-foreground shrink-0">{it.sub}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(it.value / max) * 100}%`, background: it.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TopList({ title, items, metric }: { title: string; items: TopItem[]; metric: "lead" | "peso" }) {
  return (
    <div className="card-surface p-4">
      <div className="eyebrow mb-3">{title}</div>
      {items.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-muted-foreground">Sem dados.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-foreground">{it.titulo}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{it.pessoa} · {it.area}</div>
              </div>
              <div className={cn("num shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold",
                metric === "lead" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400")}>
                {metric === "lead" ? `${it.lead_dias}d` : `${it.peso}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
