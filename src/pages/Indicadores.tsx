// Metas & Indicadores — orçado × realizado de cada canal de Aquisição e Operação, lido do
// espelho do Takeat OS (o painel de indicadores que o time de RPA mantém noutro projeto
// Supabase e copia para cá todo dia; ver a migration 20260918140000).
//
// A tela só LÊ. Quem digita meta e realizado é o OS; aqui o Hub acrescenta o que o OS não
// faz: o sentido do farol (churn acima da meta é vermelho — ver lib/indicadores-os) e a
// leitura lado a lado com o resto do financeiro.

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts";
import { ChevronLeft, ChevronRight, Loader2, Star, Sigma, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { comValorExato } from "@/components/ValorExato";
import {
  type IndicadorOS, type LinhaMensalOS, type LinhaSemanalOS, type ItemPainel, type Farol, type Sentido,
  montarPainel, resumoFarois, mesPadrao, fmtValorStr, fmtValorCurtoStr, fmtPctAtingStr, farol, atingimento, sentidoDe,
  type Origem,
} from "@/lib/indicadores-os";
import { completarMensal, type CustoOS, type AssinaturaOS } from "@/lib/indicadores-os-calculo";

const sb = supabase as any;
const LOTE = 1000;

// O PostgREST devolve no máximo 1000 linhas por pedido, calado — o painel mensal tem ~4 mil.
async function lerTudo<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await montar(de, de + LOTE - 1);
    if (error) throw error;
    todas.push(...((data ?? []) as T[]));
    if (!data || data.length < LOTE) return todas;
  }
}

const MES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const rotuloMes = (c: string) => `${MES_CURTO[Number(c.slice(5, 7)) - 1]} ${c.slice(2, 4)}`;
const DEPARTAMENTOS = ["Aquisição", "Operação"] as const;

const FAROL: Record<Farol, { texto: string; barra: string; rotulo: string }> = {
  bom:      { texto: "text-pos",              barra: "bg-pos",                 rotulo: "na meta" },
  atencao:  { texto: "text-warn",             barra: "bg-warn",                rotulo: "em atenção" },
  ruim:     { texto: "text-neg",              barra: "bg-neg",                 rotulo: "abaixo" },
  sem_meta: { texto: "text-muted-foreground", barra: "bg-muted-foreground/30", rotulo: "sem meta" },
  sem_dado: { texto: "text-muted-foreground", barra: "bg-muted-foreground/30", rotulo: "sem realizado" },
  neutro:   { texto: "text-muted-foreground", barra: "bg-muted-foreground/40", rotulo: "orçamento" },
};

/* ================================ página ================================ */
export default function Indicadores() {
  const [indicadores, setIndicadores] = useState<IndicadorOS[]>([]);
  const [mensalOS, setMensalOS] = useState<LinhaMensalOS[]>([]);
  const [custos, setCustos] = useState<CustoOS[]>([]);
  const [carteira, setCarteira] = useState<AssinaturaOS[]>([]);
  const [semanal, setSemanal] = useState<LinhaSemanalOS[] | null>(null);
  const [sync, setSync] = useState<{ executado_em: string; ok: boolean; erro: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [depto, setDepto] = useState<(typeof DEPARTAMENTOS)[number]>("Aquisição");
  const [visao, setVisao] = useState<"mensal" | "semanal">("mensal");
  const [competencia, setCompetencia] = useState<string | null>(null);
  const [aberto, setAberto] = useState<IndicadorOS | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [inds, linhas, cst, cart, log] = await Promise.all([
          lerTudo<IndicadorOS>((de, ate) => sb.from("os_indicadores")
            .select("id,departamento,canal,indicador,unidade,sensivel,e_formula,north_star,menor_e_melhor,ativo,no_painel,ordem,formula")
            .order("ordem").range(de, ate)),
          lerTudo<LinhaMensalOS>((de, ate) => sb.from("os_painel_mensal")
            .select("indicator_id,ano,mes,competencia,orcado,realizado")
            .order("competencia").order("indicator_id").range(de, ate)),
          lerTudo<CustoOS>((de, ate) => sb.from("os_custos")
            .select("competencia,grupo,categoria,valor").order("competencia").range(de, ate)),
          lerTudo<AssinaturaOS>((de, ate) => sb.from("os_assinaturas")
            .select("competencia,clientes").order("competencia").range(de, ate)),
          sb.from("os_sync_log").select("executado_em,ok,erro").order("id", { ascending: false }).limit(1).maybeSingle(),
        ]);
        setIndicadores(inds);
        setMensalOS(linhas);
        setCustos(cst);
        setCarteira(cart);
        setSync(log.data ?? null);
        const comReal = linhas.filter((l) => l.realizado != null).map((l) => l.competencia);
        setCompetencia(mesPadrao(comReal));
      } catch (e) {
        toast.error("Falha ao carregar os indicadores: " + ((e as Error)?.message ?? String(e)));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // O semanal só é lido quando alguém abre a aba: são ~5 mil linhas.
  useEffect(() => {
    if (visao !== "semanal" || semanal) return;
    lerTudo<LinhaSemanalOS>((de, ate) => sb.from("os_painel_semanal")
      .select("indicator_id,ano,semana,rotulo_semana,mes,realizado")
      .order("ano").order("semana").order("indicator_id").range(de, ate))
      .then(setSemanal)
      .catch((e) => toast.error("Falha ao carregar o semanal: " + (e?.message ?? String(e))));
  }, [visao, semanal]);

  // O OS deixa vazio o realizado de boa parte dos indicadores calculados (CAC, LTV, TM MRR,
  // totais): o Hub completa com a fórmula do próprio OS e marca a origem de cada número.
  const mensal = useMemo(
    () => completarMensal(indicadores, mensalOS, custos, carteira),
    [indicadores, mensalOS, custos, carteira],
  );

  const meses = useMemo(
    () => [...new Set(mensal.filter((l) => l.realizado != null).map((l) => l.competencia.slice(0, 10)))].sort(),
    [mensal],
  );
  const idx = competencia ? meses.indexOf(competencia) : -1;
  const anterior = idx > 0 ? meses[idx - 1] : null;

  const blocos = useMemo(
    () => (competencia ? montarPainel(indicadores, mensal, depto, competencia, anterior) : []),
    [indicadores, mensal, depto, competencia, anterior],
  );
  const resumo = resumoFarois(blocos);
  const northStars = blocos.flatMap((b) => b.itens).filter((i) => i.ind.north_star);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando indicadores…
      </div>
    );
  }

  return (
    <div className="space-y-3.5 px-5 pb-7 pt-3.5">
      {/* ---------------- Cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Metas & Indicadores</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Takeat OS
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Orçado × realizado de cada canal, como o comercial e a operação lançam no OS
            {sync && (
              <>
                {" · "}
                <span className={cn(!sync.ok && "text-neg")} title={sync.erro ?? undefined}>
                  {sync.ok ? "copiado" : "última cópia FALHOU"} em{" "}
                  {new Date(sync.executado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          <Alternador<typeof depto> valor={depto} opcoes={DEPARTAMENTOS.map((d) => [d, d] as const)} onChange={setDepto} />
          <Alternador<typeof visao> valor={visao} opcoes={[["mensal", "Mensal"], ["semanal", "Semanal"]]} onChange={setVisao} />
        </div>
      </div>

      {!competencia ? (
        <div className="card-surface mx-auto mt-10 max-w-md p-8 text-center">
          <div className="mb-2 text-[15px] font-semibold">Nenhum indicador ainda</div>
          <p className="text-[12.5px] text-muted-foreground">
            A tela lê a cópia do Takeat OS, refeita todo dia às 6h. Se ela estiver vazia, a cópia não rodou —
            veja em Configurações › Monitoramento.
          </p>
        </div>
      ) : visao === "mensal" ? (
        <>
          {/* ---------------- Navegação de mês + resumo ---------------- */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex h-8 items-center rounded-lg border border-border bg-card">
              <button
                className="px-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                disabled={idx <= 0}
                onClick={() => setCompetencia(meses[idx - 1])}
                aria-label="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="num min-w-[64px] text-center text-[12.5px] font-semibold">{rotuloMes(competencia)}</span>
              <button
                className="px-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                disabled={idx >= meses.length - 1}
                onClick={() => setCompetencia(meses[idx + 1])}
                aria-label="Mês seguinte"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
              {(["bom", "atencao", "ruim"] as const).map((f) => (
                <span key={f} className="inline-flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", FAROL[f].barra)} />
                  <span className="num font-semibold text-foreground">{resumo[f]}</span>
                  <span className="text-muted-foreground">{FAROL[f].rotulo}</span>
                </span>
              ))}
              {resumo.sem_dado + resumo.sem_meta > 0 && (
                <span className="text-muted-foreground">
                  · {resumo.sem_dado} sem realizado · {resumo.sem_meta} sem meta
                </span>
              )}
            </div>
          </div>

          {/* ---------------- North stars ---------------- */}
          {northStars.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {northStars.map((i) => (
                <CardNorthStar key={i.ind.id} item={i} onAbrir={() => setAberto(i.ind)} />
              ))}
            </div>
          )}

          {/* ---------------- Canais ---------------- */}
          <div className="grid gap-3 xl:grid-cols-2">
            {blocos.map((b) => (
              <div key={b.canal} className="card-surface overflow-hidden">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                  <div className="text-[13.5px] font-semibold">{b.canal}</div>
                  <FaroisDoCanal itens={b.itens} />
                </div>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-1.5 text-left font-medium">Indicador</th>
                      <th className="px-2 py-1.5 text-right font-medium">Realizado</th>
                      <th className="px-2 py-1.5 text-right font-medium">Meta</th>
                      <th className="w-[120px] px-4 py-1.5 text-left font-medium">Atingido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.itens.map((i) => (
                      <LinhaIndicador key={i.ind.id} item={i} onAbrir={() => setAberto(i.ind)} />
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Semanal indicadores={indicadores} linhas={semanal} depto={depto} onAbrir={setAberto} />
      )}

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Fonte: Takeat OS, copiado para o Hub todo dia às 6h. O farol segue o sentido de cada indicador —
        churn, cancelamento, downsell, CAC, CPL e tempos de atendimento são melhores <em>abaixo</em> da meta,
        mesmo quando o OS não os marca assim; investimento é orçamento, sem cor. <Sigma className="inline h-3 w-3" /> indica
        indicador calculado a partir de outros. Quando o OS deixa um calculado vazio, o Hub calcula com a
        fórmula do próprio OS e marca: <b>Hub</b> (fórmula completa), <b>parcial</b> (soma só dos canais que
        lançaram) e <b>≈</b> (estimado). O CAC consolidado soma os custos do OS menos Sucesso, Suporte e
        Liderança OPS, mais o ADS; o CAC MKT é estimado (Investimentos + Comissões + ADS).
      </p>

      <HistoricoIndicador ind={aberto} linhas={mensal} onFechar={() => setAberto(null)} />
    </div>
  );
}

/* ================================ peças ================================ */

function Alternador<T extends string>({
  valor, opcoes, onChange,
}: { valor: T; opcoes: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-card p-[3px]">
      {opcoes.map(([v, rotulo]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "h-full rounded-md px-3 text-[12px] font-medium transition",
            valor === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

function FaroisDoCanal({ itens }: { itens: ItemPainel[] }) {
  const cores = itens.filter((i) => i.farol === "bom" || i.farol === "atencao" || i.farol === "ruim");
  if (!cores.length) return null;
  return (
    <div className="flex items-center gap-1" title={`${cores.filter((i) => i.farol === "bom").length} de ${cores.length} na meta`}>
      {cores.map((i) => <span key={i.ind.id} className={cn("h-1.5 w-1.5 rounded-full", FAROL[i.farol].barra)} />)}
    </div>
  );
}

const SELO: Record<Exclude<Origem, "os">, { texto: string; cls: string; titulo: string }> = {
  hub:          { texto: "Hub",     cls: "bg-primary/10 text-primary",  titulo: "O OS deixou vazio; o Hub calculou com a fórmula do OS." },
  hub_parcial:  { texto: "parcial", cls: "bg-warn/15 text-warn",        titulo: "Soma só dos canais que lançaram." },
  hub_estimado: { texto: "≈",       cls: "bg-muted text-muted-foreground", titulo: "Estimado pelo Hub." },
};

/** Número que não veio pronto do OS diz de onde veio. Sem selo = número do OS. */
function SeloOrigem({ origem, nota }: { origem?: Origem; nota?: string }) {
  if (!origem || origem === "os") return null;
  const s = SELO[origem];
  return (
    <span className={cn("rounded px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide", s.cls)} title={nota ?? s.titulo}>
      {s.texto}
    </span>
  );
}

function BarraAtingimento({ pct, f, sentido }: { pct: number | null; f: Farol; sentido: Sentido }) {
  if (pct == null) return <span className="text-[11.5px] text-muted-foreground">{FAROL[f].rotulo}</span>;
  // A barra satura em 150% (maior-é-melhor) para um 500% não esmagar a escala do resto;
  // no menor-é-melhor, o que passa de 100% é o excesso, e ele é o que aparece.
  const largura = Math.min(100, (pct / 150) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", FAROL[f].barra)} style={{ width: `${largura}%` }} />
        <div className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${(100 / 150) * 100}%` }} title="meta" />
      </div>
      <span className={cn("num w-[40px] text-right text-[11.5px] font-semibold", FAROL[f].texto)}
        title={sentido === "menor" ? "Menor é melhor: acima de 100% passou da meta" : undefined}>
        {fmtPctAtingStr(pct)}
      </span>
    </div>
  );
}

function Variacao({ atual, anterior, sentido }: { atual: number | null; anterior: number | null; sentido: Sentido }) {
  if (atual == null || anterior == null || anterior === 0) return null;
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (!isFinite(pct) || Math.abs(pct) < 0.5) return null;
  const subiu = pct > 0;
  const bom = sentido === "neutro" ? null : sentido === "maior" ? subiu : !subiu;
  return (
    <span className={cn("inline-flex items-center text-[10.5px]", bom == null ? "text-muted-foreground" : bom ? "text-pos" : "text-neg")}
      title="Contra o mês anterior">
      {subiu ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  );
}

function LinhaIndicador({ item: i, onAbrir }: { item: ItemPainel; onAbrir: () => void }) {
  return (
    <tr className="cursor-pointer border-t border-border/40 hover:bg-muted/40" onClick={onAbrir}>
      <td className="px-4 py-1.5">
        <span className="inline-flex items-center gap-1">
          {i.ind.north_star && <Star className="h-3 w-3 fill-primary text-primary" aria-label="North star" />}
          {i.ind.indicador}
          {i.ind.e_formula && <Sigma className="h-3 w-3 text-muted-foreground" aria-label="Calculado no OS" />}
        </span>
      </td>
      <td className="num px-2 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Variacao atual={i.realizado} anterior={i.anterior} sentido={i.sentido} />
          <SeloOrigem origem={i.origem} nota={i.nota} />
          <span className="font-medium text-foreground">{fmtValorStr(i.realizado, i.ind.unidade)}</span>
        </div>
      </td>
      <td className="num px-2 py-1.5 text-right text-muted-foreground">{fmtValorStr(i.orcado || null, i.ind.unidade)}</td>
      <td className="px-4 py-1.5"><BarraAtingimento pct={i.pct} f={i.farol} sentido={i.sentido} /></td>
    </tr>
  );
}

function CardNorthStar({ item: i, onAbrir }: { item: ItemPainel; onAbrir: () => void }) {
  const moeda = i.ind.unidade === "BRL";
  return (
    <button type="button" onClick={onAbrir} className="card-surface flex flex-col gap-1.5 p-3.5 text-left hover:border-primary/40">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow truncate">{i.ind.canal}</div>
        <span className={cn("h-2 w-2 shrink-0 rounded-full", FAROL[i.farol].barra)} title={FAROL[i.farol].rotulo} />
      </div>
      <div className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
        {i.ind.indicador} <SeloOrigem origem={i.origem} nota={i.nota} />
      </div>
      <div className="num text-[22px] font-semibold leading-none tracking-tight">
        {comValorExato(i.realizado, fmtValorCurtoStr(i.realizado, i.ind.unidade), { moeda, casas: 2 })}
      </div>
      <div className="text-[11.5px] text-muted-foreground">
        meta <span className="num">{fmtValorCurtoStr(i.orcado || null, i.ind.unidade)}</span>
        {i.pct != null && <span className={cn("num ml-1.5 font-semibold", FAROL[i.farol].texto)}>{fmtPctAtingStr(i.pct)}</span>}
      </div>
    </button>
  );
}

/* ------------------------------ semanal ------------------------------ */
function Semanal({
  indicadores, linhas, depto, onAbrir,
}: {
  indicadores: IndicadorOS[]; linhas: LinhaSemanalOS[] | null; depto: string; onAbrir: (i: IndicadorOS) => void;
}) {
  const N = 8;
  const { semanas, porChave } = useMemo(() => {
    const comDado = (linhas ?? []).filter((l) => l.realizado != null);
    const chaves = [...new Map(comDado.map((l) => [`${l.ano}-${String(l.semana).padStart(2, "0")}`, l])).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-N);
    return {
      semanas: chaves.map(([k, l]) => ({ k, rotulo: l.rotulo_semana || `S${l.semana}` })),
      porChave: new Map((linhas ?? []).map((l) => [`${l.indicator_id}|${l.ano}-${String(l.semana).padStart(2, "0")}`, l.realizado])),
    };
  }, [linhas]);

  if (!linhas) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando semanas…
      </div>
    );
  }

  const inds = indicadores
    .filter((i) => i.departamento === depto && i.ativo !== false && i.no_painel !== false)
    .filter((i) => semanas.some((s) => porChave.get(`${i.id}|${s.k}`) != null));
  const canais = [...new Set(inds.map((i) => i.canal))];

  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 text-left font-medium">Indicador</th>
            {semanas.map((s) => <th key={s.k} className="num px-2 py-2 text-right font-medium">{s.rotulo}</th>)}
          </tr>
        </thead>
        <tbody>
          {canais.map((canal) => (
            <Fragment key={canal}>
              <tr className="border-t border-border/60 bg-muted/30">
                <td colSpan={semanas.length + 1} className="px-4 py-1.5 text-[12px] font-semibold">{canal}</td>
              </tr>
              {inds.filter((i) => i.canal === canal).map((i) => (
                <tr key={i.id} className="cursor-pointer border-t border-border/40 hover:bg-muted/40" onClick={() => onAbrir(i)}>
                  <td className="px-4 py-1.5">{i.indicador}</td>
                  {semanas.map((s) => (
                    <td key={s.k} className="num px-2 py-1.5 text-right">{fmtValorStr(porChave.get(`${i.id}|${s.k}`), i.unidade)}</td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {!canais.length && <div className="p-6 text-center text-[12.5px] text-muted-foreground">Nenhum realizado semanal para {depto}.</div>}
    </div>
  );
}

/* ------------------------------ histórico de um indicador ------------------------------ */
function HistoricoIndicador({
  ind, linhas, onFechar,
}: { ind: IndicadorOS | null; linhas: LinhaMensalOS[]; onFechar: () => void }) {
  const serie = useMemo(() => {
    if (!ind) return [];
    const doInd = linhas.filter((l) => l.indicator_id === ind.id && (l.realizado != null || (l.orcado ?? 0) > 0));
    return doInd
      .sort((a, b) => a.competencia.localeCompare(b.competencia))
      .slice(-13)
      .map((l) => ({
        label: rotuloMes(l.competencia),
        realizado: l.realizado,
        origem: l.origem,
        nota: l.nota,
        orcado: (l.orcado ?? 0) > 0 ? l.orcado : null,
        f: farol(l.realizado, l.orcado, sentidoDe(ind)),
        pct: atingimento(l.realizado, l.orcado),
      }));
  }, [ind, linhas]);

  if (!ind) return null;
  const u = ind.unidade;
  return (
    <Dialog open={!!ind} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{ind.indicador}</DialogTitle>
          <DialogDescription>
            {ind.departamento} › {ind.canal}
            {sentidoDe(ind) === "menor" && " · menor é melhor"}
            {ind.e_formula && " · calculado no OS"}
          </DialogDescription>
        </DialogHeader>
        {serie.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">Sem histórico lançado no OS.</p>
        ) : (
          <>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} width={70} stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v) => fmtValorCurtoStr(v, u)} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                    formatter={(v: number | string, nome: string) => [fmtValorStr(v, u), nome === "orcado" ? "Meta" : "Realizado"]}
                  />
                  <Bar dataKey="realizado" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Line dataKey="orcado" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="max-h-[220px] overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1 text-left font-medium">Mês</th>
                    <th className="py-1 text-right font-medium">Realizado</th>
                    <th className="py-1 text-right font-medium">Meta</th>
                    <th className="py-1 text-right font-medium">Atingido</th>
                  </tr>
                </thead>
                <tbody>
                  {[...serie].reverse().map((s) => (
                    <tr key={s.label} className="border-t border-border/40">
                      <td className="py-1">{s.label}</td>
                      <td className="num py-1 text-right">
                        <span className="inline-flex items-center gap-1.5"><SeloOrigem origem={s.origem} nota={s.nota} />{fmtValorStr(s.realizado, u)}</span>
                      </td>
                      <td className="num py-1 text-right text-muted-foreground">{fmtValorStr(s.orcado, u)}</td>
                      <td className={cn("num py-1 text-right font-semibold", FAROL[s.f].texto)}>{fmtPctAtingStr(s.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
