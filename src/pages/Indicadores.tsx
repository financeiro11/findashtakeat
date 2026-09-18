// Metas & Indicadores — orçado × realizado de cada canal de Aquisição e Operação, lido do
// espelho do Takeat OS (o painel de indicadores que o time de RPA mantém noutro projeto
// Supabase e copia para cá todo dia; ver a migration 20260918140000).
//
// A tela só LÊ. Quem digita meta e realizado é o OS; aqui o Hub acrescenta o que o OS não
// faz: o sentido do farol (churn acima da meta é vermelho — ver lib/indicadores-os) e a
// leitura lado a lado com o resto do financeiro.

import { Fragment, createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Loader2, Star, Sigma, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { comValorExato } from "@/components/ValorExato";
import {
  type IndicadorOS, type LinhaMensalOS, type LinhaSemanalOS, type ItemPainel, type BlocoCanal, type Farol, type Sentido,
  montarPainel, resumoFarois, mesPadrao, separarConsolidado, serieAte, fmtValorStr, fmtValorCurtoStr, fmtPctAtingStr, farol, atingimento, sentidoDe,
  type Origem,
} from "@/lib/indicadores-os";
import {
  completarMensal, explicar, inconsistenciasDoMes, textoParaEnviar, TITULO_INCONSISTENCIA,
  type CustoOS, type AssinaturaOS, type Explicacao, type Inconsistencia,
} from "@/lib/indicadores-os-calculo";
import { conferirComOS } from "@/lib/cac-os";
import type { PainelRow } from "@/lib/cac";

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

/* Indicador → o que o Hub achou de errado nele no OS (vai no ⚠ de cada número). */
const AlertasOS = createContext<Map<string, string>>(new Map());

function AlertaOS({ id }: { id: string }) {
  const texto = useContext(AlertasOS).get(id);
  if (!texto) return null;
  return (
    <span title={`${texto} O Hub mostra o número do OS; esta inconsistência está na lista para o time do OS.`}
      className="inline-flex shrink-0 text-warn" aria-label="Inconsistência no OS">
      <AlertTriangle className="h-3.5 w-3.5" />
    </span>
  );
}

/* ================================ página ================================ */
export default function Indicadores() {
  const [indicadores, setIndicadores] = useState<IndicadorOS[]>([]);
  const [mensalOS, setMensalOS] = useState<LinhaMensalOS[]>([]);
  const [custos, setCustos] = useState<CustoOS[]>([]);
  const [carteira, setCarteira] = useState<AssinaturaOS[]>([]);
  /* O Painel CAC (Omie) é o oficial; a matriz de custos do OS é conferida contra ele. */
  const [cacPainel, setCacPainel] = useState<{ ano: number; rows: PainelRow[] } | null>(null);
  const [vendoInconsistencias, setVendoInconsistencias] = useState(false);
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
            // mes = 13 é o total anual do OS, sem competência: não é mês e quebraria a ordenação.
            .not("competencia", "is", null)
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
  // O consolidado é o que se lê; os canais são o detalhamento dele.
  const { destaques, demaisConsolidado, canais } = useMemo(() => separarConsolidado(blocos, depto), [blocos, depto]);
  const resumoConsolidado = resumoFarois([{ canal: "Consolidado", itens: [...destaques, ...demaisConsolidado] }]);
  const resumoCanais = resumoFarois(canais);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const anoDoMes = competencia ? Number(competencia.slice(0, 4)) : null;
  useEffect(() => {
    if (!anoDoMes || cacPainel?.ano === anoDoMes) return;
    sb.rpc("cac_painel", { p_ano: anoDoMes }).then(({ data, error }: { data: PainelRow[] | null; error: unknown }) => {
      // Acessório: sem o Painel CAC, a lista segue sem os itens de custo.
      setCacPainel({ ano: anoDoMes, rows: error ? [] : (data ?? []) });
    });
  }, [anoDoMes, cacPainel?.ano]);

  const inconsistencias = useMemo<Inconsistencia[]>(() => {
    if (!competencia) return [];
    const itens = inconsistenciasDoMes(indicadores, mensal, custos, competencia, (v, u) => fmtValorStr(v, u ?? "count"));
    if (cacPainel?.rows.length) {
      const mes = Number(competencia.slice(5, 7));
      for (const l of conferirComOS(cacPainel.rows, custos, cacPainel.ano, mes)) {
        if (l.bate) continue;
        itens.push({
          tipo: "custo_divergente",
          texto: `${l.grupo} › ${l.rotulo}: o OS tem ${l.os == null ? "nada lançado" : fmtValorStr(l.os, "BRL")}, ` +
            `o Painel CAC (Omie) tem ${fmtValorStr(l.hub, "BRL")} — diferença de ${fmtValorStr(Math.abs(l.diferenca), "BRL")}. ` +
            "Como o CAC do OS sai desta matriz, ele muda junto.",
        });
      }
    }
    return itens;
  }, [competencia, indicadores, mensal, custos, cacPainel]);

  const alertas = useMemo(() => new Map(
    inconsistencias.filter((i) => i.indicadorId && i.tipo === "formula_divergente").map((i) => [i.indicadorId!, i.texto]),
  ), [inconsistencias]);

  const alternarCanal = (c: string) =>
    setAbertos((a) => { const n = new Set(a); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando indicadores…
      </div>
    );
  }

  return (
    <AlertasOS.Provider value={alertas}>
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
            <ResumoFarois resumo={resumoConsolidado} prefixo="Consolidado:" />
            {inconsistencias.length > 0 && (
              <button type="button" onClick={() => setVendoInconsistencias(true)}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-3 text-[12px] font-medium text-warn hover:bg-warn/20">
                <AlertTriangle className="h-3.5 w-3.5" />
                {inconsistencias.length} {inconsistencias.length === 1 ? "inconsistência" : "inconsistências"} no OS
              </button>
            )}
          </div>

          {/* ---------------- Consolidado: o protagonista ---------------- */}
          <section className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight">Consolidado · {depto}</h2>
              <span className="text-[12px] text-muted-foreground">{rotuloMes(competencia)} · realizado contra a meta do OS</span>
            </div>
            {destaques.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {destaques.map((i) => (
                  <CardDestaque key={i.ind.id} item={i} serie={serieAte(mensal, i.ind.id, competencia)} onAbrir={() => setAberto(i.ind)} />
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">O OS não tem consolidado lançado para {depto} neste mês.</p>
            )}
            {demaisConsolidado.length > 0 && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                {demaisConsolidado.map((i) => <TileConsolidado key={i.ind.id} item={i} onAbrir={() => setAberto(i.ind)} />)}
              </div>
            )}
          </section>

          {/* ---------------- Canais: o detalhamento, recolhido ---------------- */}
          {canais.length > 0 && (
            <section className="space-y-2 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[13.5px] font-semibold text-muted-foreground">Detalhe por canal</h2>
                  <ResumoFarois resumo={resumoCanais} pequeno />
                </div>
                <button
                  type="button"
                  className="text-[12px] text-muted-foreground hover:text-foreground"
                  onClick={() => setAbertos(abertos.size === canais.length ? new Set() : new Set(canais.map((b) => b.canal)))}
                >
                  {abertos.size === canais.length ? "Recolher todos" : "Abrir todos"}
                </button>
              </div>
              <div className="card-surface divide-y divide-border/60 overflow-hidden">
                {canais.map((b) => (
                  <CanalRecolhivel key={b.canal} bloco={b} aberto={abertos.has(b.canal)}
                    onAlternar={() => alternarCanal(b.canal)} onAbrir={setAberto} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <Semanal indicadores={indicadores} linhas={semanal} depto={depto} onAbrir={setAberto} />
      )}

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Fonte: Takeat OS, copiado para o Hub todo dia às 6h. O farol segue o sentido de cada indicador —
        churn, cancelamento, downsell, CAC, CPL e tempos de atendimento são melhores <em>abaixo</em> da meta,
        mesmo quando o OS não os marca assim; investimento é orçamento, sem cor. <Sigma className="inline h-3 w-3" /> indica
        indicador calculado a partir de outros. Quando o OS deixa um calculado vazio, o Hub calcula com a
        fórmula do próprio OS — clique no número para ver a conta, de onde veio cada parcela e se algum
        canal deixou de lançar o mês. O CAC consolidado soma os custos do OS menos Sucesso, Suporte e
        Liderança OPS, mais o ADS; o CAC MKT é estimado (Investimentos + Comissões + ADS).
      </p>

      <MemoriaDeCalculo ind={aberto} competencia={competencia} indicadores={indicadores} linhas={mensal}
        custos={custos} carteira={carteira} onFechar={() => setAberto(null)} />
      <ListaInconsistencias aberto={vendoInconsistencias} onFechar={() => setVendoInconsistencias(false)}
        itens={inconsistencias} rotulo={competencia ? rotuloMes(competencia) : ""} />
    </div>
    </AlertasOS.Provider>
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
  hub_parcial:  { texto: "incompleto", cls: "bg-warn/15 text-warn",     titulo: "Algum canal não lançou o mês no OS; a soma usa só os que lançaram." },
  hub_estimado: { texto: "≈",       cls: "bg-muted text-muted-foreground", titulo: "Estimado pelo Hub." },
};

/** Número que não veio pronto do OS diz de onde veio. Sem selo = número do OS. */
function SeloOrigem({ origem, nota, faltam }: { origem?: Origem; nota?: string; faltam?: string[] }) {
  if (!origem || origem === "os") return null;
  const s = SELO[origem];
  // "Parcial" solto se lia como "mês em andamento" — o selo diz QUEM faltou.
  const texto = origem === "hub_parcial" && faltam?.length
    ? (faltam.length <= 2 ? `sem ${faltam.join(" e ")}` : `sem ${faltam.length} canais`)
    : s.texto;
  return (
    <span className={cn("rounded px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide", s.cls)} title={nota ?? s.titulo}>
      {texto}
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
      <td className="px-4 py-1.5 pl-11">
        <span className="inline-flex items-center gap-1">
          {i.ind.north_star && <Star className="h-3 w-3 fill-primary text-primary" aria-label="North star" />}
          {i.ind.indicador}
          {i.ind.e_formula && <Sigma className="h-3 w-3 text-muted-foreground" aria-label="Calculado no OS" />}
        </span>
      </td>
      <td className="num px-2 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Variacao atual={i.realizado} anterior={i.anterior} sentido={i.sentido} />
          <AlertaOS id={i.ind.id} />
          <span className="font-medium text-foreground">{fmtValorStr(i.realizado, i.ind.unidade)}</span>
        </div>
      </td>
      <td className="num px-2 py-1.5 text-right text-muted-foreground">{fmtValorStr(i.orcado || null, i.ind.unidade)}</td>
      <td className="px-4 py-1.5"><BarraAtingimento pct={i.pct} f={i.farol} sentido={i.sentido} /></td>
    </tr>
  );
}

function ResumoFarois({ resumo, prefixo, pequeno }: { resumo: Record<Farol, number>; prefixo?: string; pequeno?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", pequeno ? "text-[11px]" : "text-[12px]")}>
      {prefixo && <span className="text-muted-foreground">{prefixo}</span>}
      {(["bom", "atencao", "ruim"] as const).map((f) => (
        <span key={f} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", FAROL[f].barra)} />
          <span className="num font-semibold text-foreground">{resumo[f]}</span>
          <span className="text-muted-foreground">{FAROL[f].rotulo}</span>
        </span>
      ))}
    </div>
  );
}

/** Cartão grande do consolidado: número, meta, atingimento e os últimos 12 meses. */
function CardDestaque({ item: i, serie, onAbrir }: {
  item: ItemPainel;
  serie: { competencia: string; realizado: number | null; orcado: number | null }[];
  onAbrir: () => void;
}) {
  const u = i.ind.unidade;
  const moeda = u === "BRL";
  return (
    <button type="button" onClick={onAbrir}
      className="card-surface flex flex-col gap-2 p-4 text-left transition hover:border-primary/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="eyebrow truncate">{i.ind.indicador}</span>
          <AlertaOS id={i.ind.id} />
        </div>
        <span className={cn("h-2 w-2 shrink-0 rounded-full", FAROL[i.farol].barra)} title={FAROL[i.farol].rotulo} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="num text-[30px] font-semibold leading-none tracking-tight">
          {comValorExato(i.realizado, fmtValorCurtoStr(i.realizado, u), { moeda, casas: 2 })}
        </span>
        <Variacao atual={i.realizado} anterior={i.anterior} sentido={i.sentido} />
      </div>
      <div className="text-[12px] text-muted-foreground">
        {(i.orcado ?? 0) > 0
          ? <>meta <span className="num text-foreground">{fmtValorCurtoStr(i.orcado, u)}</span></>
          : "sem meta no OS"}
        {i.sentido === "menor" && <span className="ml-1.5 text-[10.5px]">· menor é melhor</span>}
      </div>
      <BarraAtingimento pct={i.pct} f={i.farol} sentido={i.sentido} />
      {serie.length > 1 && (
        <div className="mt-1 h-[52px]" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serie} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Bar dataKey="realizado" fill="hsl(var(--primary))" fillOpacity={0.55} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Line dataKey="orcado" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" dot={false} strokeWidth={1.2}
                connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </button>
  );
}

/** O resto do consolidado: pequeno, mas ainda do consolidado. */
function TileConsolidado({ item: i, onAbrir }: { item: ItemPainel; onAbrir: () => void }) {
  const u = i.ind.unidade;
  return (
    <button type="button" onClick={onAbrir}
      className="rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:border-primary/40">
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-[11px] text-muted-foreground">{i.ind.indicador}</span>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", FAROL[i.farol].barra)} title={FAROL[i.farol].rotulo} />
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="num text-[16px] font-semibold">
          {comValorExato(i.realizado, fmtValorCurtoStr(i.realizado, u), { moeda: u === "BRL", casas: 2 })}
        </span>
        <AlertaOS id={i.ind.id} />
      </div>
      <div className="num text-[10.5px] text-muted-foreground">
        {(i.orcado ?? 0) > 0 ? <>meta {fmtValorCurtoStr(i.orcado, u)} · <span className={FAROL[i.farol].texto}>{fmtPctAtingStr(i.pct)}</span></> : "sem meta"}
      </div>
    </button>
  );
}

/** Um canal numa linha só; a tabela aparece ao abrir. */
function CanalRecolhivel({ bloco: b, aberto, onAlternar, onAbrir }: {
  bloco: BlocoCanal; aberto: boolean; onAlternar: () => void; onAbrir: (i: IndicadorOS) => void;
}) {
  const ns = b.itens.find((i) => i.ind.north_star && i.realizado != null) ?? b.itens.find((i) => i.ind.north_star);
  const alertas = useContext(AlertasOS);
  const comAlerta = b.itens.filter((i) => alertas.has(i.ind.id)).length;
  return (
    <div>
      <button type="button" onClick={onAlternar} aria-expanded={aberto}
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/40">
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} />
        <span className="w-36 shrink-0 truncate text-[12.5px] font-medium">{b.canal}</span>
        <FaroisDoCanal itens={b.itens} />
        {comAlerta > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-warn" title="Números deste canal que não batem com a fórmula do próprio OS">
            <AlertTriangle className="h-3 w-3" /> {comAlerta}
          </span>
        )}
        {ns && (
          <span className="ml-auto flex min-w-0 items-baseline gap-1.5 text-[11.5px] text-muted-foreground">
            <Star className="h-3 w-3 shrink-0 self-center fill-primary/60 text-primary/60" aria-label="North star" />
            <span className="truncate">{ns.ind.indicador}</span>
            <span className="num font-medium text-foreground">{fmtValorCurtoStr(ns.realizado, ns.ind.unidade)}</span>
            {ns.pct != null && <span className={cn("num", FAROL[ns.farol].texto)}>{fmtPctAtingStr(ns.pct)}</span>}
          </span>
        )}
      </button>
      {aberto && (
        <table className="mb-1 w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-1.5 pl-11 text-left font-medium">Indicador</th>
              <th className="px-2 py-1.5 text-right font-medium">Realizado</th>
              <th className="px-2 py-1.5 text-right font-medium">Meta</th>
              <th className="w-[120px] px-4 py-1.5 text-left font-medium">Atingido</th>
            </tr>
          </thead>
          <tbody>
            {b.itens.map((i) => <LinhaIndicador key={i.ind.id} item={i} onAbrir={() => onAbrir(i.ind)} />)}
          </tbody>
        </table>
      )}
    </div>
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

/* ------------------------------ inconsistências para o time do OS ------------------------------ */

/**
 * O que o Hub achou de errado no OS no mês, agrupado por tipo e pronto para copiar. O Hub
 * NÃO corrige número do OS (a tela tem de bater com ele): quem corrige é o time do OS, e
 * esta lista é o que o financeiro manda para eles.
 */
function ListaInconsistencias({ aberto, onFechar, itens, rotulo }: {
  aberto: boolean; onFechar: () => void; itens: Inconsistencia[]; rotulo: string;
}) {
  const grupos = useMemo(() => {
    const m = new Map<Inconsistencia["tipo"], Inconsistencia[]>();
    for (const i of itens) { if (!m.has(i.tipo)) m.set(i.tipo, []); m.get(i.tipo)!.push(i); }
    return [...m.entries()];
  }, [itens]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoParaEnviar(itens, rotulo));
      toast.success("Copiado — é só colar na mensagem para o time do OS.");
    } catch {
      toast.error("Não consegui copiar; selecione o texto da lista e copie à mão.");
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inconsistências no Takeat OS · {rotulo}</DialogTitle>
          <DialogDescription>
            A tela mostra os números como estão no OS. Isto é o que o Hub encontrou de errado, para você
            repassar ao time que mantém o OS.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <button type="button" onClick={copiar}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90">
            <Copy className="h-3.5 w-3.5" /> Copiar para enviar
          </button>
        </div>
        <div className="space-y-4">
          {grupos.map(([tipo, lista]) => (
            <section key={tipo}>
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                {TITULO_INCONSISTENCIA[tipo]} <span className="num">({lista.length})</span>
              </h3>
              <ul className="space-y-1.5">
                {lista.map((i, n) => (
                  <li key={n} className="flex gap-2 text-[12.5px] leading-relaxed">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                    <span>{i.texto}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ memória de cálculo ------------------------------ */

const TIPO_CALCULO: Record<Explicacao["tipo"], string> = {
  lancado: "Lançado no Takeat OS",
  formula: "Fórmula do Takeat OS",
  regra_cac: "Regra do Hub para o CAC (aprovada em 18/09/2026)",
  carteira: "Carteira do Takeat OS",
  estimativa: "Estimativa do Hub",
  sem_dado: "Sem número neste mês",
};

/**
 * "De onde saiu este número?" — a conta aberta de qualquer indicador, num mês. Entrada que
 * também é calculada abre a memória dela (LTV → TM MRR → Novo MRR Total → canais), com
 * trilha para voltar. A explicação vem de `explicar` (_shared), o mesmo módulo que faz a
 * conta: o que está escrito aqui é o que foi somado.
 */
function MemoriaDeCalculo({
  ind, competencia, indicadores, linhas, custos, carteira, onFechar,
}: {
  ind: IndicadorOS | null;
  competencia: string | null;
  indicadores: IndicadorOS[];
  linhas: LinhaMensalOS[];
  custos: CustoOS[];
  carteira: AssinaturaOS[];
  onFechar: () => void;
}) {
  const porId = useMemo(() => new Map(indicadores.map((i) => [i.id, i])), [indicadores]);
  const [pilha, setPilha] = useState<string[]>([]);
  const [mes, setMes] = useState<string | null>(null);

  // Abrir outro indicador pela tela recomeça a trilha e volta ao mês da tela.
  useEffect(() => {
    setPilha(ind ? [ind.id] : []);
    setMes(competencia);
  }, [ind, competencia]);

  const atualId = pilha[pilha.length - 1];
  const atual = atualId ? porId.get(atualId) ?? null : null;

  const serie = useMemo(() => {
    if (!atual) return [];
    return linhas
      .filter((l) => l.indicator_id === atual.id && l.competencia && (l.realizado != null || (l.orcado ?? 0) > 0))
      .sort((a, b) => a.competencia.localeCompare(b.competencia))
      .slice(-13)
      .map((l) => ({
        competencia: l.competencia.slice(0, 10),
        label: rotuloMes(l.competencia),
        realizado: l.realizado,
        origem: l.origem,
        nota: l.nota,
        faltam: l.faltam,
        orcado: (l.orcado ?? 0) > 0 ? l.orcado : null,
        f: farol(l.realizado, l.orcado, sentidoDe(atual)),
        pct: atingimento(l.realizado, l.orcado),
      }));
  }, [atual, linhas]);

  const mesDaMemoria = mes ?? serie[serie.length - 1]?.competencia ?? null;
  const exp = useMemo(
    () => (atual && mesDaMemoria
      ? explicar(atual.id, mesDaMemoria, indicadores, linhas, custos, carteira, (v, u) => fmtValorStr(v, u ?? "count"))
      : null),
    [atual, mesDaMemoria, indicadores, linhas, custos, carteira],
  );
  const linhaDoMes = serie.find((s) => s.competencia === mesDaMemoria);

  if (!ind || !atual) return null;
  const u = atual.unidade;

  return (
    <Dialog open={!!ind} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          {pilha.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-muted-foreground">
              <button type="button" className="inline-flex items-center gap-0.5 hover:text-foreground"
                onClick={() => setPilha((p) => p.slice(0, -1))}>
                <ChevronLeft className="h-3.5 w-3.5" /> voltar
              </button>
              <span className="mx-1">·</span>
              {pilha.map((pid, n) => (
                <span key={`${pid}-${n}`} className="inline-flex items-center gap-1">
                  {n > 0 && <ChevronRight className="h-3 w-3" />}
                  <button type="button" className={cn("hover:text-foreground", n === pilha.length - 1 && "font-medium text-foreground")}
                    onClick={() => setPilha((p) => p.slice(0, n + 1))}>
                    {porId.get(pid)?.indicador ?? "?"}
                  </button>
                </span>
              ))}
            </div>
          )}
          <DialogTitle>{atual.indicador}</DialogTitle>
          <DialogDescription>
            {atual.departamento} › {atual.canal}
            {sentidoDe(atual) === "menor" && " · menor é melhor"}
          </DialogDescription>
        </DialogHeader>

        {/* ---------------- a conta aberta ---------------- */}
        {exp && mesDaMemoria && (
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="eyebrow">{rotuloMes(mesDaMemoria)}</span>
                <span className="num text-[24px] font-semibold leading-none">{fmtValorStr(exp.resultado, u)}</span>
                <SeloOrigem origem={exp.origem} nota={exp.nota} faltam={linhaDoMes?.faltam} />
              </div>
              {linhaDoMes?.orcado != null && (
                <span className="text-[12px] text-muted-foreground">
                  meta <span className="num text-foreground">{fmtValorStr(linhaDoMes.orcado, u)}</span>
                  {linhaDoMes.pct != null && <span className={cn("num ml-1.5 font-semibold", FAROL[linhaDoMes.f].texto)}>{fmtPctAtingStr(linhaDoMes.pct)}</span>}
                </span>
              )}
            </div>

            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{TIPO_CALCULO[exp.tipo]}</div>

            {exp.formula && (
              <div className="space-y-1.5 rounded-md bg-muted/50 px-3 py-2">
                <div className="text-[12.5px] leading-relaxed">{exp.formula}</div>
                {exp.conta && <div className="num text-[12.5px] leading-relaxed text-muted-foreground">{exp.conta}</div>}
              </div>
            )}

            {exp.observacoes.length > 0 && (
              <ul className="space-y-1 text-[12px] leading-relaxed">
                {exp.observacoes.map((o) => (
                  <li key={o} className={cn("flex gap-1.5", /mas a fórmula dele/.test(o) ? "text-warn" : "text-muted-foreground")}>
                    {/mas a fórmula dele/.test(o) ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <span className="shrink-0">·</span>}
                    {o}
                  </li>
                ))}
              </ul>
            )}

            {exp.entradas.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Números que entram na conta</div>
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {exp.entradas.map((e, n) => {
                      const abre = !!e.id && porId.has(e.id);
                      return (
                        <tr key={`${e.id ?? e.nome}-${n}`} className="border-t border-border/40">
                          <td className="py-1.5 pr-2">
                            {abre ? (
                              <button type="button" className="text-left underline decoration-dotted underline-offset-2 hover:text-primary"
                                onClick={() => setPilha((p) => [...p, e.id!])}
                                title={e.calculado ? "Abrir a conta deste número" : "Ver o histórico deste número"}>
                                {e.nome}
                              </button>
                            ) : <span>{e.nome}</span>}
                            {e.nota && <div className="text-[11px] text-muted-foreground">{e.nota}</div>}
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            <span className="inline-flex items-center gap-1.5">
                              <SeloOrigem origem={e.origem} nota={e.nota} />
                              <span className={cn("num", e.valor == null && "text-muted-foreground")}>
                                {e.valor == null ? "não lançado" : fmtValorStr(e.valor, e.unidade ?? "count")}
                              </span>
                            </span>
                          </td>
                          <td className="w-5 py-1.5 text-right text-muted-foreground">
                            {abre && e.calculado && <ChevronRight className="h-3.5 w-3.5" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {exp.custos && exp.custos.length > 0 && (
              <div>
                <div className="mb-1 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Custos do mês no OS (os_custos)</span>
                  <span className="num normal-case tracking-normal">
                    entram {fmtValorStr(exp.custos.filter((c) => c.entra).reduce((a, c) => a + c.valor, 0), "BRL")}
                  </span>
                </div>
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {exp.custos.map((c) => (
                      <tr key={`${c.grupo}|${c.categoria}`} className={cn("border-t border-border/40", !c.entra && "text-muted-foreground")}>
                        <td className="py-1 pr-2">
                          <span className="text-muted-foreground">{c.grupo} › </span>
                          <span className={cn(!c.entra && "line-through")}>{c.categoria}</span>
                        </td>
                        <td className={cn("num py-1 pr-2 text-right", !c.entra && "line-through")}>{fmtValorStr(c.valor, "BRL")}</td>
                        <td className="w-20 py-1 text-right text-[11px]">
                          {c.entra ? <span className="inline-flex items-center gap-0.5 text-pos"><Check className="h-3 w-3" /> entra</span> : "fica fora"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ---------------- histórico: escolhe o mês da conta ---------------- */}
        {serie.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">Sem histórico lançado no OS.</p>
        ) : (
          <>
            <div className="h-[200px]">
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
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 text-left font-medium">Mês · clique para ver a conta</th>
                  <th className="py-1 text-right font-medium">Realizado</th>
                  <th className="py-1 text-right font-medium">Meta</th>
                  <th className="py-1 text-right font-medium">Atingido</th>
                </tr>
              </thead>
              <tbody>
                {[...serie].reverse().map((s) => (
                  <tr key={s.competencia} onClick={() => setMes(s.competencia)}
                    className={cn("cursor-pointer border-t border-border/40 hover:bg-muted/40", s.competencia === mesDaMemoria && "bg-primary/5")}>
                    <td className="py-1">{s.label}</td>
                    <td className="num py-1 text-right">
                      <span className="inline-flex items-center gap-1.5"><SeloOrigem origem={s.origem} nota={s.nota} faltam={s.faltam} />{fmtValorStr(s.realizado, u)}</span>
                    </td>
                    <td className="num py-1 text-right text-muted-foreground">{fmtValorStr(s.orcado, u)}</td>
                    <td className={cn("num py-1 text-right font-semibold", FAROL[s.f].texto)}>{fmtPctAtingStr(s.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
