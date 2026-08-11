/* ============================================================================
 * Aba "Análises" da DRE.
 *
 * As leituras que não cabem na grade de rubricas: alavancagem operacional,
 * produtividade de pessoal, ARR, regra dos 40, runway, ponte do EBITDA e os
 * dois cards que vieram do /caixa (capital de giro e ponto de equilíbrio).
 *
 * A conta mora em @/lib/analisesDre — aqui é busca de dado e desenho. O que
 * este arquivo carrega além da DRE (que já vem por prop):
 *
 *   · DFC        → fluxo livre dos últimos meses, para a queima do runway
 *   · caixa      → saldo consolidado do Omie, o numerador do runway
 *   · bp_anual   → o plano, para as curvas tracejadas e a ponte vs. BP
 *
 * Nenhum dos três é obrigatório: sem BP as linhas de plano somem, sem caixa ou
 * DFC o card de runway sai da tela. Uma tabela vazia esconde uma análise, nunca
 * derruba a aba.
 * ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { comValorExato } from "@/components/ValorExato";
import { fmtBRLShort as fmtBRLShortStr } from "@/pages/dashboard/format";
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, Bar, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Users, Gauge, Timer, ArrowRight, Info } from "lucide-react";
import CapitalGiro from "@/components/demonstracoes/CapitalGiro";
import PontoEquilibrio from "@/components/demonstracoes/PontoEquilibrio";
import {
  lerDre, mesesComDado, alavancagem, pessoalSobreReceita, serieArr,
  regraDos40, calcularRunway, ponteEbitda, rotuloMes, fluxoLivreDaDfc,
  RL, EBITDA, SGA, CUSTOS_OP,
  type LinhaBlob,
} from "@/lib/analisesDre";
import { lerBpAnual, planoPorColuna, type BpAnual } from "@/lib/bpAnual";
import { colunaDoMes } from "@/lib/pontoEquilibrio";

const sb = supabase as any;

/* ------------------------------ formatação ------------------------------ */
/* Abreviado na tela revela o valor cheio no hover. Dentro de SVG o <span> do
   `comValorExato` some, então lá vale a variante …Str (ver CLAUDE.md). */
const brl = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : comValorExato(n, fmtBRLShortStr(n));
const brlStr = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? "—" : fmtBRLShortStr(n);
const pct = (n: number | null | undefined, casas = 1) =>
  n == null || !isFinite(n) ? "—" : `${n.toFixed(casas).replace(".", ",")}%`;
const pctSinal = (n: number | null | undefined, casas = 1) =>
  n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(casas).replace(".", ",")}%`;
/** fração (0,22) → "+22,0%" */
const fracSinal = (n: number | null | undefined, casas = 1) =>
  n == null || !isFinite(n) ? "—" : pctSinal(n * 100, casas);

const COR = {
  receita: "hsl(var(--primary))",
  sga: "hsl(var(--muted-foreground))",
  pos: "hsl(var(--pos))",
  neg: "hsl(var(--neg))",
  grade: "hsl(var(--border))",
  eixo: "hsl(var(--muted-foreground))",
};

/* ------------------------------ peças de UI ------------------------------ */

function Secao({
  titulo, descricao, children, acoes,
}: { titulo: string; descricao: React.ReactNode; children: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <div className="card-surface p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="eyebrow">{titulo}</div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{descricao}</p>
        </div>
        {acoes && <div className="shrink-0">{acoes}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Kpi({
  eyebrow, valor, detalhe, tom, icone, titulo,
}: {
  eyebrow: string;
  valor: React.ReactNode;
  detalhe: React.ReactNode;
  tom?: "pos" | "neg" | "neutro";
  icone: React.ReactNode;
  titulo?: string;
}) {
  return (
    <div className="card-surface p-3.5" title={titulo}>
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{eyebrow}</div>
        <span className="text-muted-foreground/60">{icone}</span>
      </div>
      <div className={cn(
        "num mt-1.5 text-[24px] font-semibold leading-none tracking-tight",
        tom === "pos" ? "text-pos" : tom === "neg" ? "text-neg" : "text-foreground",
      )}>
        {valor}
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{detalhe}</div>
    </div>
  );
}

/** Tooltip dos gráficos: valor cheio, sem abreviar — a caixa já flutua. */
function Caixinha({
  active, payload, label, formatar,
}: any & { formatar: (v: number, nome: string) => string }) {
  if (!active || !payload?.length) return null;
  const itens = payload.filter((p: any) => p.value != null && p.name);
  if (!itens.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-[11.5px] shadow-md">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {itens.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.stroke ?? p.fill }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="num ml-auto font-medium text-foreground">{formatar(p.value, p.name)}</span>
        </div>
      ))}
    </div>
  );
}

/** Tooltip da cascata: a barra é uma FAIXA [de, até], então o número que
    interessa é a contribuição, que viaja no próprio ponto. */
function CaixinhaPonte({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-[11.5px] shadow-md">
      <div className="mb-1 font-semibold text-foreground">{p.rubrica}</div>
      <div className="num text-foreground">
        {p.total ? valorExato(p.delta) : `${p.delta >= 0 ? "+" : ""}${valorExato(p.delta)}`}
      </div>
      {!p.total && (
        <div className="mt-0.5 text-[10.5px] text-muted-foreground">
          {p.delta >= 0 ? "somou ao" : "tirou do"} EBITDA
        </div>
      )}
    </div>
  );
}

const Nota = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-snug text-muted-foreground/80">
    <Info className="mt-[1px] h-3 w-3 shrink-0" />
    <span>{children}</span>
  </p>
);

const Vazio = ({ children }: { children: React.ReactNode }) => (
  <div className="py-8 text-center text-[12px] text-muted-foreground">{children}</div>
);

/* ============================================================
 *  Aba
 * ============================================================ */

type Props = {
  /** as linhas do blob da DRE, como a página já carregou */
  rows: LinhaBlob[];
  /** colunas visíveis (respeitam o filtro de ano do cabeçalho) */
  columns: string[];
  /** meses fechados (cadeado) */
  travados: Set<string>;
};

export default function Analises({ rows, columns, travados }: Props) {
  const [fluxoLivre, setFluxoLivre] = useState<Record<string, number | null> | null>(null);
  const [saldoCaixa, setSaldoCaixa] = useState<number | null>(null);
  const [bpPorAno, setBpPorAno] = useState<Map<number, BpAnual>>(new Map());
  const [baseDaPonte, setBaseDaPonte] = useState<"mes" | "bp">("mes");

  /* ---- o que não vem por prop ---- */
  useEffect(() => {
    (async () => {
      const [dfc, caixa, bps] = await Promise.all([
        sb.from("demonstracoes_contabeis").select("dados")
          .eq("tipo", "dfc").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("omie_caixa_snapshot").select("dados")
          .order("gerado_em", { ascending: false }).limit(1).maybeSingle(),
        sb.from("bp_anual").select("ano,dados"),
      ]);

      /* Fluxo livre da DFC — recalculado a partir das folhas, e não lido da
         linha de total, porque o blob quase nunca a traz preenchida. */
      const bruto: any = dfc?.data?.dados;
      const linhas: any[] = Array.isArray(bruto) ? bruto : (bruto?.rows ?? []);
      const colsDfc: string[] = Array.isArray(bruto)
        ? Object.keys(linhas[0] ?? {}).filter((k) => /^[A-Za-z]{3}-\d{2}$/.test(k))
        : (bruto?.columns ?? []).filter((k: string) => /^[A-Za-z]{3}-\d{2}$/.test(k));
      if (linhas.length && colsDfc.length) setFluxoLivre(fluxoLivreDaDfc(linhas, colsDfc));

      setSaldoCaixa((caixa?.data?.dados as any)?.saldo_consolidado ?? null);

      const mapa = new Map<number, BpAnual>();
      for (const r of ((bps?.data as any[]) ?? [])) mapa.set(Number(r.ano), lerBpAnual(r.dados));
      setBpPorAno(mapa);
    })().catch(() => { /* acessório: a aba segue com o que a DRE já deu */ });
  }, []);

  /* ---- cálculo ---- */
  const leitor = useMemo(() => lerDre(rows, columns), [rows, columns]);
  const colAtual = colunaDoMes(new Date());
  const meses = useMemo(
    () => mesesComDado(leitor, columns, travados, colAtual),
    [leitor, columns, travados, colAtual],
  );
  const plano = useMemo(() => planoPorColuna(bpPorAno), [bpPorAno]);
  const temBp = bpPorAno.size > 0;

  const alav = useMemo(() => alavancagem(leitor, meses, plano), [leitor, meses, plano]);
  const pessoal = useMemo(() => pessoalSobreReceita(leitor, meses), [leitor, meses]);
  const arr = useMemo(() => serieArr(leitor, meses, plano), [leitor, meses, plano]);
  const r40 = useMemo(() => regraDos40(leitor, meses), [leitor, meses]);

  const ultimo = meses[meses.length - 1] ?? null;
  const penultimo = meses[meses.length - 2] ?? null;

  const runway = useMemo(() => {
    if (saldoCaixa == null || !fluxoLivre) return null;
    const serie = meses.map((m) => fluxoLivre[m] ?? null);
    return calcularRunway(saldoCaixa, serie, 3);
  }, [saldoCaixa, fluxoLivre, meses]);

  const ponte = useMemo(() => {
    if (!ultimo) return null;
    if (baseDaPonte === "bp") {
      if (!temBp) return null;
      /* O plano não traz EBITDA sempre; quando não trouxer, ele sai da própria
         estrutura do plano (receita − custos − SG&A), que é como a DRE o define. */
      const doPlano = (label: string) => plano(label, ultimo);
      const ebitdaPlano = doPlano(EBITDA) ?? (
        Math.abs(doPlano(RL) ?? 0)
        - Math.abs(doPlano(CUSTOS_OP) ?? 0)
        - Math.abs(doPlano(SGA) ?? 0)
      );
      return ponteEbitda(
        (l) => (l === EBITDA ? ebitdaPlano : doPlano(l)),
        (l) => leitor.bruto(l, ultimo),
        (l) => { const v = doPlano(l); return v == null ? null : Math.abs(v); },
        (l) => leitor.custo(l, ultimo),
      );
    }
    if (!penultimo) return null;
    return ponteEbitda(
      (l) => leitor.bruto(l, penultimo),
      (l) => leitor.bruto(l, ultimo),
      (l) => leitor.custo(l, penultimo),
      (l) => leitor.custo(l, ultimo),
    );
  }, [baseDaPonte, ultimo, penultimo, leitor, plano, temBp]);

  /* A cascata desenhada como FAIXA [de, até] em vez do truque da barra
     transparente empilhada: empilhamento em Recharts joga negativo para baixo
     do zero, e um mês de EBITDA negativo desmontaria a ponte. */
  const dadosPonte = useMemo(() => {
    if (!ponte) return [];
    const linhas: { rubrica: string; faixa: [number, number]; delta: number; total: boolean }[] = [
      {
        rubrica: baseDaPonte === "bp" ? "EBITDA plano" : "EBITDA anterior",
        faixa: [0, ponte.de], delta: ponte.de, total: true,
      },
      ...ponte.degraus.map((d) => ({
        rubrica: d.rubrica,
        faixa: [d.base, d.base + d.delta] as [number, number],
        delta: d.delta,
        total: false,
      })),
    ];
    if (Math.abs(ponte.residuo) > 0.5) {
      linhas.push({
        rubrica: "Não explicado",
        faixa: [ponte.para - ponte.residuo, ponte.para],
        delta: ponte.residuo,
        total: false,
      });
    }
    linhas.push({ rubrica: "EBITDA atual", faixa: [0, ponte.para], delta: ponte.para, total: true });
    return linhas;
  }, [ponte, baseDaPonte]);

  if (!meses.length) {
    return (
      <Vazio>
        Nenhum mês fechado com receita para analisar. As análises usam meses fechados —
        o mês corrente entra com custo cheio e receita pela metade e distorceria toda curva.
      </Vazio>
    );
  }

  /* Meses da janela que ainda não têm cadeado. Vale dizer em voz alta: em mês
     destravado o omie-sync mexe nas folhas e deixa as linhas de TOTAL para trás
     (Jul/26 chegou a ter EBITDA gravado R$ 21 mil acima do que a estrutura
     dava), então uma curva pode ter um último ponto que ainda vai mudar. */
  const abertosNaJanela = meses.filter((m) => !travados.has(m));
  const bpDuplicadas = [...bpPorAno.values()].flatMap((b) => b.duplicadas);

  const arrUltimo = arr[arr.length - 1];
  const r40Ultimo = [...r40].reverse().find((x) => x.regra != null) ?? null;
  const pessoalUltimo = pessoal[pessoal.length - 1];
  const pessoalAnoAtras = pessoal.length > 12 ? pessoal[pessoal.length - 13] : null;

  return (
    <div className="space-y-4 pb-4">
      {/* ------------------------------------------------------------------ *
       *  Que janela está na tela — e o que nela ainda pode mudar
       * ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3 text-[11.5px] text-muted-foreground">
        <span>
          Janela: <b className="text-foreground">{rotuloMes(meses[0])}</b> a{" "}
          <b className="text-foreground">{rotuloMes(meses[meses.length - 1])}</b> · {meses.length} meses fechados
        </span>
        {abertosNaJanela.length > 0 && (
          <span
            className="rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-400"
            title="Mês sem cadeado: o omie-sync reescreve as folhas e pode deixar as linhas de total (EBITDA, Receita Recorrente) para trás. O número ainda vai mudar."
          >
            {abertosNaJanela.map(rotuloMes).join(", ")} ainda sem cadeado
          </span>
        )}
        {!temBp && <span className="text-muted-foreground/70">· sem BP importado, as linhas de plano não aparecem</span>}
        {bpDuplicadas.length > 0 && (
          <span
            className="text-muted-foreground/70"
            title={`Valeu o primeiro bloco do plano para: ${bpDuplicadas.join(", ")}`}
          >
            · {bpDuplicadas.length} rubrica(s) repetida(s) no BP
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------ *
       *  Leitura rápida
       * ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          eyebrow="ARR (receita recorrente × 12)"
          valor={brl(arrUltimo?.arr)}
          detalhe={
            <>
              {rotuloMes(arrUltimo?.mes ?? "")} · MRR {brl(arrUltimo?.mrr)}
              {arrUltimo?.yoy != null && (
                <> · <span className={arrUltimo.yoy >= 0 ? "text-pos" : "text-neg"}>{fracSinal(arrUltimo.yoy)} a/a</span></>
              )}
            </>
          }
          icone={<TrendingUp className="h-4 w-4" />}
          titulo={arrUltimo?.arr != null ? valorExato(arrUltimo.arr) : undefined}
        />
        <Kpi
          eyebrow="Regra dos 40"
          valor={r40Ultimo?.regra == null ? "—" : r40Ultimo.regra.toFixed(0)}
          tom={r40Ultimo?.regra == null ? "neutro" : r40Ultimo.regra >= 40 ? "pos" : "neg"}
          detalhe={
            r40Ultimo
              ? <>crescimento {pctSinal(r40Ultimo.crescimento)} + margem {pct(r40Ultimo.margem)}</>
              : <>precisa de 12 meses de histórico</>
          }
          icone={<Gauge className="h-4 w-4" />}
        />
        <Kpi
          eyebrow="Runway"
          valor={
            runway == null ? "—"
            : runway.gerandoCaixa ? "gera caixa"
            : runway.meses == null ? "—"
            : `${runway.meses.toFixed(1).replace(".", ",")} m`
          }
          tom={
            runway?.gerandoCaixa ? "pos"
            : runway?.meses != null && runway.meses < 6 ? "neg"
            : "neutro"
          }
          detalhe={
            runway == null ? <>sem saldo de caixa ou DFC carregados</>
            : runway.gerandoCaixa ? <>fluxo livre médio positivo nos últimos {runway.base} meses</>
            : <>caixa {brl(runway.saldo)} ÷ queima {brl(runway.queima)}/mês</>
          }
          icone={<Timer className="h-4 w-4" />}
        />
        <Kpi
          eyebrow="Pessoal sobre receita"
          valor={pct(pessoalUltimo?.totalPct)}
          tom={
            pessoalAnoAtras?.totalPct == null || pessoalUltimo?.totalPct == null ? "neutro"
            : pessoalUltimo.totalPct <= pessoalAnoAtras.totalPct ? "pos" : "neg"
          }
          detalhe={
            <>
              estrutura {pct(pessoalUltimo?.estruturaPct)}
              {pessoalAnoAtras?.totalPct != null && pessoalUltimo?.totalPct != null && (
                <> · {pctSinal(pessoalUltimo.totalPct - pessoalAnoAtras.totalPct)} p.p. a/a</>
              )}
            </>
          }
          icone={<Users className="h-4 w-4" />}
        />
      </div>

      {/* ------------------------------------------------------------------ *
       *  1. Alavancagem operacional
       * ------------------------------------------------------------------ */}
      <Secao
        titulo="Alavancagem operacional · receita × SG&A"
        descricao={
          <>
            As duas curvas partem de 100 em {rotuloMes(meses[0])}. Se a da receita sobe mais
            rápido que a do SG&A, cada real novo de venda está pagando menos estrutura.
            {temBp && " Tracejado é o BP."}
          </>
        }
        acoes={
          alav.tesoura != null && (
            <span className={cn(
              "num inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold",
              alav.tesoura >= 0 ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg",
            )}>
              {alav.tesoura >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {alav.tesoura >= 0 ? "receita na frente" : "custo na frente"} · {fracSinal(Math.abs(alav.tesoura))} p.p.
            </span>
          )
        }
      >
        <div className="h-[280px] w-full">
          <ResponsiveContainer>
            <LineChart data={alav.serie} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={COR.grade} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={{ stroke: COR.grade }} />
              <YAxis tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={false}
                tickFormatter={(v) => String(Math.round(v))} />
              <ReferenceLine y={100} stroke={COR.grade} strokeDasharray="4 4" />
              <Tooltip content={<Caixinha formatar={(v: number) => `${v.toFixed(1).replace(".", ",")} (base 100)`} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
              <Line type="monotone" dataKey="receitaIdx" name="Receita líquida" stroke={COR.receita} strokeWidth={2.2} dot={false} connectNulls />
              <Line type="monotone" dataKey="sgaIdx" name="SG&A" stroke={COR.sga} strokeWidth={2.2} dot={false} connectNulls />
              {temBp && <Line type="monotone" dataKey="receitaBpIdx" name="Receita · BP" stroke={COR.receita} strokeWidth={1.4} strokeDasharray="5 4" dot={false} connectNulls />}
              {temBp && <Line type="monotone" dataKey="sgaBpIdx" name="SG&A · BP" stroke={COR.sga} strokeWidth={1.4} strokeDasharray="5 4" dot={false} connectNulls />}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Receita no período</div>
            <div className="num mt-1 text-[17px] font-semibold text-foreground">{fracSinal(alav.cresceReceita)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">SG&A no período</div>
            <div className="num mt-1 text-[17px] font-semibold text-foreground">{fracSinal(alav.cresceSga)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">SG&A / receita · início</div>
            <div className="num mt-1 text-[17px] font-semibold text-foreground">{pct(alav.pesoInicio)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">SG&A / receita · fim</div>
            <div className={cn(
              "num mt-1 text-[17px] font-semibold",
              alav.pesoFim != null && alav.pesoInicio != null
                ? (alav.pesoFim <= alav.pesoInicio ? "text-pos" : "text-neg")
                : "text-foreground",
            )}>
              {pct(alav.pesoFim)}
            </div>
          </div>
        </div>

        <Nota>
          Índice base 100 responde a velocidade, não o nível: as duas linhas podem subir
          juntas com o SG&A comendo 40% ou 80% da receita. Por isso o peso vai nos quadros
          abaixo do gráfico.
        </Nota>
      </Secao>

      {/* ------------------------------------------------------------------ *
       *  2. Produtividade de pessoal
       * ------------------------------------------------------------------ */}
      <Secao
        titulo="Pessoal sobre receita líquida"
        descricao={
          <>
            Quanto de cada real faturado vai para gente. <b>Cair é ficar mais produtivo.</b>{" "}
            Estrutura é o bloco Pessoal do SG&A (não deveria crescer com a venda); o total
            inclui equipe e premiações operacionais, que crescem com o volume.
          </>
        }
      >
        <div className="h-[260px] w-full">
          <ResponsiveContainer>
            <LineChart data={pessoal} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={COR.grade} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={{ stroke: COR.grade }} />
              <YAxis tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={false}
                tickFormatter={(v) => `${Math.round(v)}%`} />
              <Tooltip content={<Caixinha formatar={(v: number) => pct(v, 2)} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
              <Line type="monotone" dataKey="totalPct" name="Todo custo de gente" stroke={COR.neg} strokeWidth={2.2} dot={false} connectNulls />
              <Line type="monotone" dataKey="estruturaPct" name="Estrutura (SG&A)" stroke={COR.receita} strokeWidth={2.2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <Nota>
          A distância entre as duas linhas é o custo de servir. Se a de cima abre e a de
          baixo fica parada, quem cresceu foi a operação — a estrutura está segurando.
        </Nota>
      </Secao>

      {/* ------------------------------------------------------------------ *
       *  3. ARR
       * ------------------------------------------------------------------ */}
      <Secao
        titulo="ARR · receita recorrente anualizada"
        descricao={
          <>
            A linha "Receita Recorrente" da DRE (assinaturas + enterprise) do mês × 12.
            É o ARR <b>faturado</b>, em competência — não é o mesmo número da tela
            /assinaturas, que lê a base contratada no Asaas.
            {temBp && " Tracejado é o BP."}
          </>
        }
      >
        <div className="h-[260px] w-full">
          <ResponsiveContainer>
            <ComposedChart data={arr} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={COR.grade} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={{ stroke: COR.grade }} />
              <YAxis tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={false}
                tickFormatter={(v) => brlStr(v)} width={72} />
              <Tooltip content={<Caixinha formatar={(v: number) => valorExato(v)} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="arr" name="ARR faturado" fill={COR.receita} fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={38} />
              {temBp && <Line type="monotone" dataKey="arrBp" name="ARR · BP" stroke={COR.eixo} strokeWidth={1.6} strokeDasharray="5 4" dot={false} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Secao>

      {/* ------------------------------------------------------------------ *
       *  4. Regra dos 40
       * ------------------------------------------------------------------ */}
      <Secao
        titulo="Regra dos 40"
        descricao={
          <>
            Crescimento de receita (% contra o mesmo mês do ano anterior) + margem EBITDA.
            O atalho de SaaS: cresça rápido <i>ou</i> dê lucro — a soma tem que passar de 40.
          </>
        }
      >
        {r40.every((x) => x.regra == null) ? (
          <Vazio>
            Sem 12 meses de histórico na janela, não há com o que comparar ano contra ano.
            Tire o filtro de ano no cabeçalho para incluir os meses anteriores.
          </Vazio>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={r40} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} stackOffset="sign">
                <CartesianGrid stroke={COR.grade} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={{ stroke: COR.grade }} />
                <YAxis tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `${Math.round(v)}`} />
                <ReferenceLine y={40} stroke={COR.pos} strokeDasharray="5 4"
                  label={{ value: "40", position: "right", fontSize: 10, fill: COR.pos }} />
                <ReferenceLine y={0} stroke={COR.grade} />
                <Tooltip content={<Caixinha formatar={(v: number) => pct(v, 1)} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="crescimento" name="Crescimento a/a" stackId="r40" fill={COR.receita} fillOpacity={0.8} maxBarSize={38} />
                <Bar dataKey="margem" name="Margem EBITDA" stackId="r40" fill={COR.pos} fillOpacity={0.7} maxBarSize={38} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <Nota>
          As duas parcelas podem ser negativas — a barra desce abaixo do zero em vez de
          somar em módulo, senão um mês de prejuízo apareceria como desempenho.
        </Nota>
      </Secao>

      {/* ------------------------------------------------------------------ *
       *  5. Ponte do EBITDA
       * ------------------------------------------------------------------ */}
      <Secao
        titulo="Ponte do EBITDA"
        descricao={
          ultimo
            ? baseDaPonte === "mes"
              ? <>De onde veio a variação entre {penultimo ? rotuloMes(penultimo) : "—"} e {rotuloMes(ultimo)}.</>
              : <>Onde {rotuloMes(ultimo)} descolou do plano, rubrica a rubrica.</>
            : "—"
        }
        acoes={
          <div className="inline-flex items-center rounded-md border border-border p-0.5">
            {([["mes", "vs. mês anterior"], ["bp", "vs. BP"]] as const).map(([id, rotulo]) => (
              <button
                key={id}
                onClick={() => setBaseDaPonte(id)}
                disabled={id === "bp" && !temBp}
                title={id === "bp" && !temBp ? "Nenhum BP importado" : undefined}
                className={cn(
                  "h-7 rounded px-2.5 text-[11.5px] font-medium transition-colors disabled:opacity-40",
                  baseDaPonte === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
        }
      >
        {!ponte ? (
          <Vazio>
            {baseDaPonte === "bp"
              ? "Sem BP importado para o ano deste mês."
              : "Precisa de dois meses fechados na janela para comparar."}
          </Vazio>
        ) : (
          <>
            <div className="h-[280px] w-full">
              <ResponsiveContainer>
                <ComposedChart data={dadosPonte} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke={COR.grade} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rubrica" tick={{ fontSize: 10, fill: COR.eixo }} tickLine={false}
                    axisLine={{ stroke: COR.grade }} interval={0} angle={-14} textAnchor="end" height={64} />
                  <YAxis tick={{ fontSize: 10.5, fill: COR.eixo }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => brlStr(v)} width={72} />
                  <ReferenceLine y={0} stroke={COR.grade} />
                  <Tooltip content={<CaixinhaPonte />} cursor={{ fill: "hsl(var(--secondary))", fillOpacity: 0.4 }} />
                  <Bar dataKey="faixa" name="Contribuição" radius={[3, 3, 0, 0]} maxBarSize={54}>
                    {dadosPonte.map((d, i) => (
                      <Cell key={i} fill={d.total ? COR.receita : d.delta >= 0 ? COR.pos : COR.neg} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                {baseDaPonte === "bp" ? "Plano" : "Anterior"}{" "}
                <span className="num font-medium text-foreground">{brl(ponte.de)}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
              <span>
                Atual <span className="num font-medium text-foreground">{brl(ponte.para)}</span>
              </span>
              <span className={cn("num font-semibold", ponte.para - ponte.de >= 0 ? "text-pos" : "text-neg")}>
                {ponte.para - ponte.de >= 0 ? "+" : ""}{brlStr(ponte.para - ponte.de)}
              </span>
              {Math.abs(ponte.residuo) > 0.5 && (
                <span className="text-muted-foreground/80">
                  · não explicado {brl(ponte.residuo)}
                </span>
              )}
            </div>

            <Nota>
              Em despesa a contribuição é o negativo da variação: gastar mais tira do EBITDA.
              A barra "não explicado" aparece quando a decomposição não fecha — em mês sem
              cadeado costuma ser a própria linha do EBITDA atrasada em relação às folhas;
              nos meses de 2025, é "Meios de Pagamento", que o tracker daquele ano não punha
              dentro de Custos Operacionais. Fica publicada em vez de diluída numa barra
              "outros", que é o jeito de nunca descobrir.
            </Nota>
          </>
        )}
      </Secao>

      {/* ------------------------------------------------------------------ *
       *  6 e 7. Os dois cards que vieram do /caixa
       * ------------------------------------------------------------------ */}
      <CapitalGiro />
      <PontoEquilibrio />
    </div>
  );
}
