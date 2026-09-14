import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronLeft, ChevronRight, RefreshCw, Loader2, Sparkles, BarChart3, Clock, ListChecks, Repeat, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { NATUREZA_COR, corDaArea } from "@/lib/tarefas/classificacao";
import { TarefasDoRecorte } from "@/components/tarefas/TarefasDoRecorte";
import {
  arredonda, fmtDias, fmtHoras, percentual, type Medida, type Recorte, type TarefaDaSemana,
} from "@/lib/tarefas/recorte";

// A skill "analise-tarefas-semana" (rodada em chat, via Supabase MCP) lê a tabela
// resumo_tarefas_semana e traduz o payload numérico em leitura executiva. Esta tela só
// LÊ o que já está publicado ali — nunca gera nada sozinha (mesmo padrão do Briefing
// Diário: geração é externa/agente; o Hub só exibe e, no máximo, dispara um recálculo
// dos NÚMEROS via RPC). O campo `leitura_md` é onde o agente publica a interpretação em
// prosa quando o usuário pedir — se estiver vazio, mostramos como recalcular os números
// e como pedir a leitura executiva.
//
// DOIS DENOMINADORES, e a escolha é do leitor. Contagem de cards responde "quantas
// coisas fiz"; horas respondem "onde a semana foi". Elas discordam de propósito:
// sempre haverá mais tarefas operacionais — são pequenas e voltam toda semana —,
// então contá-las só confirma o óbvio. Na semana de 24/08, Estratégico era 15% dos
// cards e 72% do tempo. O padrão é TEMPO porque é a leitura que decide alguma coisa.
//
// TODO NÚMERO ABRE. Cada card chama `abrir()` com o recorte que o formou, e o painel
// (TarefasDoRecorte) refaz a conta a partir das linhas — é o carimbo de que a lista
// está completa, e é lá que a classificação errada e a hora não apontada se corrigem.

type Natureza = "Operacional" | "Estratégico" | "Automação" | string;

interface PorNatureza { natureza: Natureza; n: number; lead_mediana: number; peso_medio: number; rotinas?: number; horas?: number }
interface PorArea { area: string; n: number; lead_mediana: number; peso_medio: number; rotinas?: number; peso_rotina?: number; horas?: number; horas_rotina?: number }
interface PorPessoa { pessoa: string; n: number; peso_total: number; rotinas?: number; horas?: number; horas_construir?: number }
interface TopItem { id?: string; titulo: string; pessoa: string; area: string; lead_dias: number; peso?: number; horas?: number; rotina?: boolean; apontada?: boolean }
interface Recorrente { familia: string; n: number; peso_total?: number; area?: string; horas?: number }

interface Payload {
  /* `pct_rotina` e companhia só existem em semanas recalculadas depois de
     27/08/2026, e `horas_*` depois de 11/09/2026 — as anteriores foram gravadas
     antes de as colunas existirem. Por isso são opcionais: a tela mostra cada
     bloco só quando ele foi medido, em vez de desenhar "0%" para uma semana que
     nunca contou. */
  totais: { concluidas: number; lead_mediana: number; pct_operacional: number; pct_estrategico: number; pct_automacao: number;
            pct_rotina?: number; rotinas?: number; peso_rotina?: number; peso_total?: number;
            horas_total?: number; horas_rotina?: number; pct_rotina_h?: number;
            pct_operacional_h?: number; pct_estrategico_h?: number; pct_automacao_h?: number;
            apontadas?: number; horas_apontadas?: number; pct_horas_apontadas?: number };
  por_natureza: PorNatureza[];
  por_area: PorArea[];
  por_pessoa: PorPessoa[];
  top_pesadas: TopItem[];
  top_lead: TopItem[];
  top_horas?: TopItem[];
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

/* As cores vêm de @/lib/tarefas/classificacao — as mesmas que o card do quadro
   usa no ponto ao lado da área. Quando a paleta morava aqui, a mesma área tinha
   uma cor no Kanban e outra no gráfico, e o olho tinha de reler o rótulo. */

function fmtCurta(iso: string): string {
  const [, m, d] = iso.split("-");
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

export function AnaliseSemanal({ onAbrirTarefa }: { onAbrirTarefa?: (id: string) => void } = {}) {
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recalculando, setRecalculando] = useState(false);
  const [medida, setMedida] = useState<Medida>("tempo");

  /* As linhas da semana, buscadas só quando alguém abre o primeiro recorte: a
     aba é lida muito mais vezes do que é auditada, e o payload já traz tudo o
     que ela desenha. */
  const [linhas, setLinhas] = useState<TarefaDaSemana[] | null>(null);
  const [carregandoLinhas, setCarregandoLinhas] = useState(false);
  const [recorte, setRecorte] = useState<Recorte | null>(null);
  /* Quantas correções foram feitas desde o último cálculo. Enquanto for > 0, os
     números da tela são os de antes da correção — e o botão diz isso. */
  const [pendentes, setPendentes] = useState(0);

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

  /* Trocar de semana invalida a lista aberta: ela é de outra semana. */
  useEffect(() => { setLinhas(null); setRecorte(null); setPendentes(0); }, [atual?.semana_inicio]);

  const buscarLinhas = useCallback(async (semana: Semana) => {
    setCarregandoLinhas(true);
    try {
      const { data, error } = await supabase.rpc("fn_tarefas_da_semana", {
        p_ini: semana.semana_inicio, p_fim: semana.semana_fim,
      });
      if (error) throw error;
      /* O PostgREST devolve `numeric` como número, mas a coerção explícita é o
         que garante que uma soma não vire concatenação de string se isso mudar. */
      setLinhas((data ?? []).map((l) => ({
        ...l,
        rotina: !!l.rotina,
        subtarefas: Number(l.subtarefas ?? 0),
        lead_dias: Number(l.lead_dias ?? 0),
        peso: Number(l.peso ?? 0),
        horas: Number(l.horas ?? 0),
        horas_apontadas: l.horas_apontadas == null ? null : Number(l.horas_apontadas),
        horas_board: Number(l.horas_board ?? 0),
        horas_abertas: Number(l.horas_abertas ?? 0),
        horas_paradas: Number(l.horas_paradas ?? 0),
      })) as TarefaDaSemana[]);
    } catch (e) {
      toast.error("Falha ao abrir as tarefas: " + (e as Error).message);
      setLinhas([]);
    } finally {
      setCarregandoLinhas(false);
    }
  }, []);

  const abrir = (r: Recorte) => {
    if (!atual) return;
    setRecorte(r);
    if (linhas === null && !carregandoLinhas) buscarLinhas(atual);
  };

  const corrigir = (id: string, patch: Partial<TarefaDaSemana>) => {
    setLinhas((ls) => (ls ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setPendentes((n) => n + 1);
  };

  const recalcular = async () => {
    if (!atual) return;
    setRecalculando(true);
    try {
      const pRef = pRefParaRecalcular(atual.semana_inicio);
      const { error } = await supabase.rpc("fn_resumo_tarefas_semana" as any, { p_ref: pRef });
      if (error) throw error;
      toast.success("Números recalculados a partir das tarefas concluídas.");
      setPendentes(0);
      await load(atual.semana_inicio);
      if (linhas !== null) await buscarLinhas(atual);
    } catch (e: any) {
      toast.error("Falha ao recalcular: " + e.message);
    } finally {
      setRecalculando(false);
    }
  };

  const p = atual?.payload;
  const porTempo = medida === "tempo";
  /* Semana gravada antes de 11/09/2026 não tem hora nenhuma. Em vez de desenhar
     um mix zerado, a tela cai para contagem e diz por quê. */
  const temHoras = (p?.totais.horas_total ?? 0) > 0;
  const medidaEfetiva: Medida = porTempo && temHoras ? "tempo" : "tarefas";

  /* Depois que as linhas chegam, o total vem delas — não do payload. Uma hora
     apontada agora muda o denominador na mesma hora; do payload, ele só mudaria
     no recálculo, e a fatia do painel sairia contra um total de antes. */
  const totalSemana = useMemo(
    () => (linhas
      ? { n: linhas.length, horas: arredonda(linhas.reduce((s, l) => s + l.horas, 0)) }
      : { n: p?.totais.concluidas ?? 0, horas: p?.totais.horas_total ?? 0 }),
    [linhas, p],
  );

  const mix = useMemo(() => {
    if (!p) return [];
    const t = p.totais;
    const porNat = new Map(p.por_natureza.map((n) => [n.natureza, n]));
    const linha = (natureza: string, pctN: number, pctH?: number) => {
      const item = porNat.get(natureza);
      return {
        natureza,
        pct: medidaEfetiva === "tempo" ? (pctH ?? 0) : pctN,
        pctN,
        pctH: pctH ?? 0,
        n: item?.n ?? 0,
        horas: item?.horas ?? 0,
      };
    };
    return [
      linha("Operacional", t.pct_operacional, t.pct_operacional_h),
      linha("Estratégico", t.pct_estrategico, t.pct_estrategico_h),
      linha("Automação", t.pct_automacao, t.pct_automacao_h),
    ].filter((m) => m.pct > 0 || m.n > 0);
  }, [p, medidaEfetiva]);

  /* O número que a pergunta pedia: quanto da semana sobrou para construir e
     decidir, em vez de manter de pé. */
  const construir = useMemo(() => {
    if (!p) return { tempo: 0, tarefas: 0 };
    return {
      tempo: (p.totais.pct_automacao_h ?? 0) + (p.totais.pct_estrategico_h ?? 0),
      tarefas: p.totais.pct_automacao + p.totais.pct_estrategico,
    };
  }, [p]);

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

  if (!atual || !p) {
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

  const topSecundario = medidaEfetiva === "tempo" && p.top_horas?.length
    ? { titulo: "Onde o tempo foi", items: p.top_horas, metric: "horas" as const, eixo: "horas" as const }
    : { titulo: "Mais complexas (peso estimado)", items: p.top_pesadas, metric: "peso" as const, eixo: "peso" as const };

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
            {temHoras && (
              <>
                {" · "}
                {/* O total é soma de relógio, não de esforço: dois cards abertos
                    ao mesmo tempo contam as mesmas horas duas vezes, então ele
                    passa da capacidade do time sem que nada esteja errado. É a
                    proporção que se lê — e o hover é onde isso fica dito. */}
                <span
                  className="num cursor-help underline decoration-dotted underline-offset-2"
                  title={"Soma do tempo das tarefas. Cards abertos em paralelo contam as mesmas horas cada um,"
                    + " então este total pode passar da capacidade da semana — o que se lê aqui é a PROPORÇÃO"
                    + " entre naturezas e áreas, não o valor absoluto."
                    + ((p.totais.pct_horas_apontadas ?? 0) < 100
                      ? ` Hoje ${p.totais.pct_horas_apontadas ?? 0}% dele vem de hora apontada; o resto é estimativa do board.`
                      : " Todo ele vem de hora apontada.")}
                >
                  {fmtHoras(p.totais.horas_total)}
                </span>
                {" de tempo"}
              </>
            )}
            {" · números recalculados em "}{fmtHora(atual.gerado_em)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SeletorMedida valor={medida} onChange={setMedida} desabilitado={!temHoras} />
          <div className="h-6 w-px bg-border mx-1" />
          <Button size="icon" variant="outline" onClick={() => setIdx((i) => Math.min(i + 1, semanas.length - 1))} disabled={idx >= semanas.length - 1} title="Semana anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="num text-xs text-muted-foreground w-16 text-center">{idx + 1} / {semanas.length}</span>
          <Button size="icon" variant="outline" onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={idx <= 0} title="Próxima semana">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-border mx-1" />
          {/* Depois de uma correção os números da tela são os de antes dela: o
              botão deixa de ser opcional e passa a dizer o que está pendente. */}
          <Button
            variant={pendentes > 0 ? "default" : "outline"}
            onClick={recalcular}
            disabled={recalculando}
            title={pendentes > 0
              ? `${pendentes} correção(ões) feita(s) agora ainda não entraram nestes números`
              : "Refaz os números desta semana a partir das tarefas concluídas"}
          >
            {recalculando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {pendentes > 0 ? `Recalcular (${pendentes})` : "Recalcular"}
          </Button>
        </div>
      </div>

      {atual.total_concluidas === 0 ? (
        <div className="card-surface p-8 text-center text-[13px] text-muted-foreground">
          Nenhuma tarefa concluída nesta semana.
        </div>
      ) : (
        <>
          {/* Stats + mix. Quatro colunas no telão porque o card de rotina entrou
              ao lado dos outros três — em md eles quebram de dois em dois, e o
              mix (que é o mais largo) fica com uma fileira inteira. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={ListChecks}
              label="Tarefas concluídas"
              value={String(p.totais.concluidas)}
              onClick={() => abrir({ eixo: "todas", titulo: `As ${p.totais.concluidas} tarefas concluídas na semana` })}
            />
            <StatCard
              icon={Clock}
              label="Lead time mediano"
              value={fmtDias(p.totais.lead_mediana)}
              hint="tempo aberto no board — sinal de arrasto, não de esforço"
              onClick={() => abrir({ eixo: "lead", titulo: "Tempo aberto no board, da mais arrastada à mais rápida" })}
            />
            {/* O eixo que faltava. "Operacional 70%" não decide nada; "70%
                operacional, e metade disso é rotina que volta todo mês" aponta
                para o que automatizar. */}
            {p.totais.pct_rotina != null && (
              <StatCard
                icon={Repeat}
                label="Rotina"
                value={`${medidaEfetiva === "tempo" ? (p.totais.pct_rotina_h ?? 0) : p.totais.pct_rotina}%`}
                hint={
                  medidaEfetiva === "tempo"
                    ? `${fmtHoras(p.totais.horas_rotina)} em trabalho que volta sozinho · ${p.totais.pct_rotina}% das tarefas`
                    : p.totais.rotinas != null && p.totais.peso_rotina != null && p.totais.peso_total
                      ? `${p.totais.rotinas} tarefa${p.totais.rotinas === 1 ? "" : "s"} que volta sozinha · `
                        + `${Math.round((p.totais.peso_rotina / p.totais.peso_total) * 100)}% do esforço da semana`
                      : "trabalho que volta sozinho toda semana/mês"
                }
                onClick={() => abrir({ eixo: "rotina", titulo: "Rotina — o que volta sozinho" })}
              />
            )}
            <div className="card-surface p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div className="eyebrow">Mix por natureza</div>
                <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  {medidaEfetiva === "tempo" ? "por tempo" : "por tarefa"}
                </span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {mix.map((m) => (
                  <button
                    key={m.natureza}
                    type="button"
                    onClick={() => abrir({ eixo: "natureza", valor: m.natureza, titulo: m.natureza })}
                    style={{ width: `${m.pct}%`, background: NATUREZA_COR[m.natureza] ?? "#64748b" }}
                    title={`${m.natureza}: ${m.pctH}% do tempo · ${m.pctN}% das tarefas`}
                    className="transition-opacity hover:opacity-80"
                  />
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                {mix.map((m) => (
                  <button
                    key={m.natureza}
                    type="button"
                    onClick={() => abrir({ eixo: "natureza", valor: m.natureza, titulo: m.natureza })}
                    className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: NATUREZA_COR[m.natureza] ?? "#64748b" }} />
                    {m.natureza} <span className="num font-medium text-foreground">{m.pct}%</span>
                  </button>
                ))}
              </div>
              {/* A leitura que a barra não dá sozinha: construir e decidir contra
                  manter de pé, nos dois denominadores, para que a diferença entre
                  eles fique à vista. */}
              {temHoras && (
                <div className="mt-2.5 flex items-start gap-1.5 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
                  <Hammer className="mt-px h-3 w-3 shrink-0" />
                  <span>
                    Construir e decidir:{" "}
                    <span className="num font-semibold text-foreground">{construir.tempo}%</span> do tempo
                    {" · "}
                    <span className="num">{construir.tarefas}%</span> das tarefas
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quanto do tempo é medido e quanto é palpite do board. Sem isto o mix
              acima passa por apurado quando ainda é quase todo estimativa. */}
          {temHoras && medidaEfetiva === "tempo" && (p.totais.pct_horas_apontadas ?? 0) < 100 && (
            <button
              type="button"
              onClick={() => abrir({ eixo: "todas", titulo: "Apontar as horas da semana" })}
              className="card-surface flex w-full items-center gap-2 p-3 text-left text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40"
            >
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="num font-semibold text-foreground">{p.totais.apontadas ?? 0} de {p.totais.concluidas}</span>{" "}
                tarefas com hora apontada (<span className="num">{p.totais.pct_horas_apontadas ?? 0}%</span> do tempo da semana).
                O resto é estimativa do board — horas com o card aberto em horário comercial, sem o tempo parado.
                Clique para apontar e o mix passa a ser medida, não palpite.
              </span>
            </button>
          )}

          {/* Por área / Por pessoa */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card-surface p-4">
              <div className="eyebrow mb-3">Por área</div>
              <BarList
                items={p.por_area.map((a) => ({
                  key: a.area ?? "—",
                  label: a.area || "Sem área",
                  sub: medidaEfetiva === "tempo"
                    ? `${fmtHoras(a.horas)} · ${a.n} tarefa${a.n === 1 ? "" : "s"}`
                      + (a.horas_rotina ? ` · ${fmtHoras(a.horas_rotina)} de rotina` : "")
                    : a.rotinas
                      ? `${a.n} tarefa${a.n === 1 ? "" : "s"} · ${a.rotinas} de rotina · lead ${fmtDias(a.lead_mediana)}`
                      : `${a.n} tarefa${a.n === 1 ? "" : "s"} · lead mediana ${fmtDias(a.lead_mediana)}`,
                  value: medidaEfetiva === "tempo" ? (a.horas ?? 0) : a.n,
                  color: corDaArea(a.area),
                  onClick: () => abrir({ eixo: "area", valor: a.area, titulo: a.area || "Sem área" }),
                }))}
              />
            </div>
            <div className="card-surface p-4">
              <div className="eyebrow mb-3">Por pessoa</div>
              <div className="space-y-2.5">
                {p.por_pessoa.map((pp) => (
                  <button
                    key={pp.pessoa}
                    type="button"
                    onClick={() => abrir({ eixo: "pessoa", valor: pp.pessoa, titulo: pp.pessoa })}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/50"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                        {pp.pessoa.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="text-[13px] font-medium text-foreground">{pp.pessoa}</span>
                    </div>
                    <div className="text-right">
                      {medidaEfetiva === "tempo" ? (
                        <>
                          <div className="num text-[13px] font-semibold text-foreground">{fmtHoras(pp.horas)}</div>
                          <div className="num text-[11px] text-muted-foreground">
                            {pp.n} concluída{pp.n === 1 ? "" : "s"}
                            {pp.horas_construir != null && pp.horas
                              ? ` · ${percentual(pp.horas_construir, pp.horas)}% construindo`
                              : ""}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="num text-[13px] font-semibold text-foreground">{pp.n} concluída{pp.n === 1 ? "" : "s"}</div>
                          <div className="num text-[11px] text-muted-foreground">peso total {pp.peso_total}</div>
                        </>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* O que arrastou / Onde o tempo foi (ou Mais complexas) */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TopList
              title="O que arrastou"
              items={p.top_lead}
              metric="lead"
              onAbrir={(it) => abrir({
                eixo: "lead", destaque: it.id,
                titulo: "Tempo aberto no board, da mais arrastada à mais rápida",
              })}
            />
            <TopList
              title={topSecundario.titulo}
              items={topSecundario.items}
              metric={topSecundario.metric}
              onAbrir={(it) => abrir({
                eixo: topSecundario.eixo, destaque: it.id,
                titulo: topSecundario.titulo,
              })}
            />
          </div>

          {/* Fila de automação — o que se repetiu, em ordem de custo.
              Era "Recorrentes na semana": uma nuvem de chips que dizia o QUE
              voltou, mas não em que ordem mexer. Ordenar por custo é o que
              transforma a lista em fila: quatro execuções leves custam menos que
              duas pesadas, e é o custo que decide o que vale automatizar. */}
          {p.recorrentes.length > 0 && (
            <div className="card-surface p-4">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <div className="eyebrow">Fila de automação</div>
                <span className="text-[11px] text-muted-foreground">
                  o que voltou nesta semana, do mais caro para o mais barato
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {p.recorrentes.map((r) => (
                  <button
                    key={r.familia}
                    type="button"
                    onClick={() => abrir({ eixo: "familia", valor: r.familia, titulo: `Repetiu ${r.n}×: ${r.familia || "(sem título)"}` })}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/50"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {r.area && (
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: corDaArea(r.area) }} />
                      )}
                      <span className="truncate text-[12.5px] font-medium text-foreground">
                        {r.familia || "(sem título)"}
                      </span>
                      {r.area && <span className="shrink-0 text-[11px] text-muted-foreground">{r.area}</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="num rounded-full bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary">{r.n}×</span>
                      {medidaEfetiva === "tempo" && r.horas != null ? (
                        <span className="num rounded-md bg-sky-50 px-2 py-1 text-[12px] font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-400">
                          {fmtHoras(r.horas)}
                        </span>
                      ) : r.peso_total != null ? (
                        <span className="num rounded-md bg-violet-50 px-2 py-1 text-[12px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-400">
                          {r.peso_total}
                        </span>
                      ) : null}
                    </div>
                  </button>
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

      <TarefasDoRecorte
        recorte={recorte}
        linhas={linhas ?? []}
        carregando={carregandoLinhas}
        totalSemana={totalSemana}
        medida={medidaEfetiva}
        onFechar={() => setRecorte(null)}
        onMudou={corrigir}
        onAbrirTarefa={onAbrirTarefa}
      />
    </div>
  );
}

/** Tarefas ou tempo — o denominador de toda a aba. */
function SeletorMedida({ valor, onChange, desabilitado }: {
  valor: Medida; onChange: (m: Medida) => void; desabilitado: boolean;
}) {
  const opcoes: { id: Medida; label: string; dica: string }[] = [
    { id: "tarefas", label: "Tarefas", dica: "Conta cards concluídos" },
    { id: "tempo", label: "Tempo", dica: "Soma as horas — apontadas, ou estimadas pelo board" },
  ];
  return (
    <div
      className="flex items-center rounded-md border border-border p-0.5"
      title={desabilitado ? "Esta semana foi calculada antes de o tempo existir — use Recalcular" : undefined}
    >
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={desabilitado && o.id === "tempo"}
          onClick={() => onChange(o.id)}
          title={o.dica}
          className={cn(
            "rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            valor === o.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            desabilitado && o.id === "tempo" && "cursor-not-allowed opacity-40",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint, onClick }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint?: string;
  onClick?: () => void;
}) {
  const conteudo = (
    <>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground/70">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 text-left">
        <div className="eyebrow">{label}</div>
        <div className="num mt-0.5 text-[22px] font-semibold leading-none text-foreground">{value}</div>
        {hint && <div className="mt-1.5 text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </>
  );
  if (!onClick) {
    return <div className="card-surface flex items-start gap-3 p-4">{conteudo}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Ver as tarefas por trás deste número"
      className="card-surface flex w-full items-start gap-3 p-4 transition-colors hover:border-primary/40"
    >
      {conteudo}
    </button>
  );
}

function BarList({ items }: {
  items: { key: string; label: string; sub: string; value: number; color: string; onClick?: () => void }[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (items.length === 0) {
    return <div className="py-6 text-center text-[12.5px] text-muted-foreground">Sem dados.</div>;
  }
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={it.onClick}
          disabled={!it.onClick}
          className="group block w-full text-left"
        >
          <div className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="truncate font-medium text-foreground group-hover:underline">{it.label}</span>
            <span className="text-[11.5px] text-muted-foreground shrink-0">{it.sub}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-opacity group-hover:opacity-80" style={{ width: `${(it.value / max) * 100}%`, background: it.color }} />
          </div>
        </button>
      ))}
    </div>
  );
}

function TopList({ title, items, metric, onAbrir }: {
  title: string; items: TopItem[]; metric: "lead" | "peso" | "horas";
  onAbrir: (it: TopItem) => void;
}) {
  return (
    <div className="card-surface p-4">
      <div className="eyebrow mb-3">{title}</div>
      {items.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-muted-foreground">Sem dados.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <button
              key={it.id ?? i}
              type="button"
              onClick={() => onAbrir(it)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/50"
            >
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-foreground">{it.titulo}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{it.pessoa} · {it.area}</div>
              </div>
              <div className={cn("num shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold",
                metric === "lead" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                : metric === "horas" ? "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400"
                : "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400")}
                title={metric === "horas" && it.apontada === false ? "Estimativa do board — ninguém apontou a hora" : undefined}
              >
                {metric === "lead" ? fmtDias(it.lead_dias)
                  : metric === "horas" ? `${fmtHoras(it.horas)}${it.apontada === false ? "*" : ""}`
                  : `${it.peso}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
