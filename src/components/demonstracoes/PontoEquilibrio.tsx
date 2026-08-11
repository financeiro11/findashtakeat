/* ============================================================
 *  Card "Ponto de equilíbrio" da aba Análises da DRE — vizinho da
 *  necessidade de capital de giro.
 *
 *  Enquanto o card ao lado responde "quanto sai do caixa por mês",
 *  este responde "quanto precisa ENTRAR para as atividades se
 *  pagarem". A conta mora em @/lib/pontoEquilibrio; aqui é só busca
 *  de dados, classificação editável e desenho.
 *
 *  Regime: COMPETÊNCIA (lê a DRE). O capital de giro ao lado é caixa.
 *  Os dois números divergem de propósito — a nota de rodapé avisa.
 *
 *  Morava em components/caixa/ e vinha do /caixa; mudou de casa junto
 *  com o capital de giro quando as duas análises foram para a DRE.
 * ============================================================ */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { valorExato } from "@/lib/valor";
import { comValorExato } from "@/components/ValorExato";
import { fmtBRLShort as fmtBRLShortStr, fmtPct } from "@/pages/dashboard/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SlidersHorizontal, RotateCcw, AlertTriangle, Info } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Cell, CartesianGrid,
} from "recharts";
import {
  calcular, media, mesReferencia, catalogoCompleto, classificacaoPadrao, rubricasOrfas,
  colunaDoMes, diasDoMes, rotuloCurto, rotuloLongo, sortKey, COL_MES, GRUPO_OUTRAS,
  type Bucket, type LinhaDRE, type ResultadoMes,
} from "@/lib/pontoEquilibrio";

const sb = supabase as any;
const CLASSIF_KEY = "caixa:pe-classificacao";

/* Abreviado na tela mostra o valor cheio no hover; a variante …Str é a que
   pode entrar em template literal / tickFormatter (ver CLAUDE.md). */
const fmtBRLShort = (n: number) => comValorExato(n, fmtBRLShortStr(n));
const fmtBRL = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
const fmtInt = (n: number) => Math.abs(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

const ROTULO_BUCKET: Record<Bucket, string> = { variavel: "Variável", fixo: "Fixo", fora: "Fora" };

/* Resquício da época em que a classificação era por navegador — hoje só serve
   de ponte até a tabela compartilhada responder. */
function lerLocal(): Record<string, Bucket> {
  try { return JSON.parse(localStorage.getItem(CLASSIF_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

type KpisAssinaturas = { ticket_medio?: number; mrr_total?: number; clientes_ativos?: number };

export default function PontoEquilibrio() {
  const [rows, setRows] = useState<LinhaDRE[]>([]);
  const [colunas, setColunas] = useState<string[]>([]);
  const [travados, setTravados] = useState<Set<string>>(new Set());
  const [assin, setAssin] = useState<KpisAssinaturas | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [painel, setPainel] = useState(false);
  // Só o que a pessoa mudou à mão. O padrão fica de fora para que uma rubrica
  // nova na DRE herde a regra atual em vez de congelar a de hoje.
  const [ajustes, setAjustes] = useState<Record<string, Bucket>>({});
  // Onde a classificação está de fato gravada. "local" é degradação: a tabela
  // ainda não existe (migration não aplicada) ou o insert foi negado — e aí a
  // escolha vale só neste navegador. A tela diz isso em vez de fingir.
  const [origem, setOrigem] = useState<"banco" | "local">("banco");

  /* Carrega em silêncio: DRE ausente só esconde o card, nunca derruba o /caixa. */
  useEffect(() => {
    (async () => {
      const [dre, travas, assinaturas, classif] = await Promise.all([
        sb.from("demonstracoes_contabeis").select("dados,updated_at")
          .eq("tipo", "dre").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("demonstracoes_mes_trancado").select("col_key"),
        sb.from("assinaturas_snapshot").select("competencia,dados")
          .order("competencia", { ascending: false }).limit(1).maybeSingle(),
        sb.from("ponto_equilibrio_classificacao").select("rubrica,bucket"),
      ]);

      const raw: any = dre?.data?.dados;
      let r: LinhaDRE[] = [];
      let cols: string[] = [];
      if (Array.isArray(raw)) { r = raw; cols = r[0] ? Object.keys(r[0]) : []; }
      else if (Array.isArray(raw?.rows)) { r = raw.rows; cols = raw.columns ?? (r[0] ? Object.keys(r[0]) : []); }

      setRows(r);
      setColunas(cols.filter((c) => COL_MES.test(c)).sort((a, b) => sortKey(a) - sortKey(b)));
      setAtualizadoEm(dre?.data?.updated_at ?? null);
      setTravados(new Set(((travas?.data as any[]) ?? []).map((t) => String(t.col_key))));
      setAssin((assinaturas?.data?.dados?.kpis as KpisAssinaturas) ?? null);

      await carregarClassificacao(classif);
    })().catch(() => { /* card some, painel do caixa segue */ });
  }, []);

  /* A classificação é compartilhada: mora na tabela, não no navegador. O
     localStorage só sobrevive como rede de segurança para o intervalo entre o
     deploy e a migration — e como origem do que já tinha sido editado antes. */
  async function carregarClassificacao(resp: { data?: any[] | null; error?: any }) {
    const local = lerLocal();
    if (resp?.error) {
      setAjustes(local);
      setOrigem("local");
      return;
    }
    const doBanco: Record<string, Bucket> = {};
    for (const l of resp?.data ?? []) doBanco[String(l.rubrica)] = l.bucket as Bucket;
    setOrigem("banco");

    // Primeira vez com a tabela no ar: sobe o que a pessoa já tinha ajustado
    // localmente. Só quando o banco está vazio — havendo classificação da
    // equipe lá, ela manda, e o resquício local é descartado.
    const temLocal = Object.keys(local).length > 0;
    if (temLocal && Object.keys(doBanco).length === 0) {
      const { error } = await sb.from("ponto_equilibrio_classificacao").upsert(
        Object.entries(local).map(([rubrica, bucket]) => ({ rubrica, bucket })),
        { onConflict: "rubrica" },
      );
      if (error) { setAjustes(local); setOrigem("local"); return; }
      toast.success("Classificação do ponto de equilíbrio publicada para todos os logins.");
      localStorage.removeItem(CLASSIF_KEY);
      setAjustes(local);
      return;
    }
    if (temLocal) localStorage.removeItem(CLASSIF_KEY);
    setAjustes(doBanco);
  }

  /* Padrão + o que a pessoa reclassificou. */
  const classificacao = useMemo(
    () => ({ ...classificacaoPadrao(rows), ...ajustes }),
    [rows, ajustes],
  );

  const resultados = useMemo(() => calcular(rows, colunas, classificacao), [rows, colunas, classificacao]);
  const mesRef = useMemo(
    () => mesReferencia(colunas, travados, resultados, colunaDoMes(new Date())),
    [colunas, travados, resultados],
  );

  const idxRef = mesRef ? colunas.indexOf(mesRef) : -1;
  const ref = idxRef >= 0 ? resultados[idxRef] : null;
  const anterior = idxRef > 0 ? resultados[idxRef - 1] : null;
  const { m3, m2 } = useMemo(() => {
    const janela = (n: number) =>
      idxRef < 0 ? null : media(resultados.slice(Math.max(0, idxRef - n + 1), idxRef + 1));
    return { m3: janela(3), m2: janela(2) };
  }, [resultados, idxRef]);

  /* Últimos 12 meses fechados até a referência. */
  const serie = useMemo(() => {
    if (idxRef < 0) return [];
    return resultados.slice(Math.max(0, idxRef - 11), idxRef + 1).map((r) => ({
      mes: rotuloCurto(r.mes), receita: r.receita, pe: r.pe, cobre: r.pe !== null && r.receita >= r.pe,
    }));
  }, [resultados, idxRef]);

  /* Rubricas da DRE fora do catálogo que ainda estão fora da conta e têm
     valor no mês de referência — nada some em silêncio. */
  const orfasIgnoradas = useMemo(() => {
    if (!mesRef) return { nomes: [] as string[], total: 0 };
    const porConta = new Map(rows.map((r) => [String(r?.["Conta"] ?? "").trim(), r]));
    const valor = (r: string) => Math.abs(Number(porConta.get(r)?.[mesRef] ?? 0));
    const nomes = rubricasOrfas(rows)
      .filter((r) => classificacao[r] === "fora" && valor(r) > 0.005)
      .sort((a, b) => valor(b) - valor(a));
    return { nomes, total: nomes.reduce((s, r) => s + valor(r), 0) };
  }, [rows, classificacao, mesRef]);

  /* Grava a rubrica sozinha, não o mapa inteiro: duas pessoas mexendo em
     rubricas diferentes não se sobrescrevem. A tela move na hora e só volta
     atrás se o banco recusar. */
  async function reclassificar(rubrica: string, bucket: Bucket) {
    setAjustes((prev) => ({ ...prev, [rubrica]: bucket }));

    const { error } = await sb
      .from("ponto_equilibrio_classificacao")
      .upsert({ rubrica, bucket, atualizado_em: new Date().toISOString() }, { onConflict: "rubrica" });

    if (!error) { if (origem !== "banco") setOrigem("banco"); return; }

    // Sem tabela (migration pendente) o card continua utilizável, só que local.
    const next = { ...ajustes, [rubrica]: bucket };
    localStorage.setItem(CLASSIF_KEY, JSON.stringify(next));
    if (origem !== "local") {
      setOrigem("local");
      toast.warning("Classificação salva só neste navegador — a tabela compartilhada ainda não está no ar.");
    }
  }

  async function restaurarPadrao() {
    const rubricas = Object.keys(ajustes);
    setAjustes({});
    localStorage.removeItem(CLASSIF_KEY);
    if (!rubricas.length) return;
    const { error } = await sb.from("ponto_equilibrio_classificacao").delete().in("rubrica", rubricas);
    if (error && origem === "banco") toast.error("Não foi possível limpar a classificação compartilhada.");
  }

  if (!ref || !mesRef) return null;

  const gap = ref.pe !== null ? ref.pe - ref.receita : null;   // >0 = falta vender
  const ticket = Number(assin?.ticket_medio ?? 0);
  const clientesGap = gap !== null && ticket > 0 ? gap / ticket : null;
  const diasNoMes = diasDoMes(mesRef);
  // Quantos dias de faturamento do mês servem só para pagar a conta.
  const diasParaPagar = ref.pe !== null && ref.receita > 0 ? (ref.pe / ref.receita) * diasNoMes : null;

  return (
    <div className="card-surface p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="eyebrow">Ponto de equilíbrio</div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Receita necessária no mês para as atividades se pagarem · fonte DRE (competência)
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setPainel(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-foreground transition hover:bg-secondary"
            title="Escolher quais rubricas da DRE são custo variável, custo fixo ou ficam fora da conta"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Classificar custos
          </button>
          {atualizadoEm && (
            <span className="text-[10.5px] text-muted-foreground/70">
              DRE de {new Date(atualizadoEm).toLocaleDateString("pt-BR")}
            </span>
          )}
        </div>
      </div>

      {orfasIgnoradas.nomes.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-semibold">{fmtBRLShortStr(orfasIgnoradas.total)}</span> em{" "}
            {orfasIgnoradas.nomes.length} rubrica(s) da DRE estão FORA desta conta em {rotuloCurto(mesRef)}
            {" "}({orfasIgnoradas.nomes.slice(0, 3).join(", ")}{orfasIgnoradas.nomes.length > 3 ? "…" : ""}).{" "}
            <button onClick={() => setPainel(true)} className="underline underline-offset-2">Classificar</button>
          </span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
        {/* Destaque: quanto precisa faturar */}
        <div className="flex flex-col gap-2 lg:border-r lg:border-border/60 lg:pr-4">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold text-foreground">{rotuloLongo(mesRef)}</span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              {travados.has(mesRef) ? "mês fechado" : "último mês cheio"}
            </span>
          </div>

          {ref.pe === null ? (
            <>
              <div className="num text-[26px] font-semibold leading-none tracking-tight text-neg">não existe</div>
              <p className="text-[11.5px] text-muted-foreground">
                Os custos variáveis comeram toda a receita (margem de contribuição {ref.mcPct === null ? "—" : pct1(ref.mcPct)}).
                Vender mais aumenta o prejuízo: não há volume que feche a conta sem mexer em preço ou custo variável.
              </p>
            </>
          ) : (
            <>
              <div className="num text-[30px] font-semibold leading-none tracking-tight text-foreground" title={valorExato(ref.pe)}>
                {fmtBRL(ref.pe)}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn(
                  "num inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                  (ref.margemSeguranca ?? 0) >= 0 ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg",
                )}>
                  {(ref.margemSeguranca ?? 0) >= 0 ? "▲" : "▼"} {fmtPct(ref.msPct ?? 0)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {(ref.margemSeguranca ?? 0) >= 0 ? "acima" : "abaixo"} do equilíbrio · faturou {fmtBRLShort(ref.receita)}
                </span>
              </div>
              {diasParaPagar !== null && (
                <div className="text-[11px] text-muted-foreground">
                  No ritmo do mês, {Math.min(diasNoMes, Math.ceil(diasParaPagar))} de {diasNoMes} dias de faturamento
                  {" "}pagam a operação{diasParaPagar < diasNoMes ? "; o resto vira resultado." : "."}
                </div>
              )}
            </>
          )}

          <Footnote>
            Custos fixos {fmtBRLShort(ref.fixos)} ÷ margem de contribuição{" "}
            {ref.mcPct === null ? "—" : pct1(ref.mcPct)} · regime competência, diferente do capital de giro (caixa)
          </Footnote>
        </div>

        {/* Números de apoio + tradução em clientes + série */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Bloco titulo="Margem de contribuição" valor={ref.mcPct === null ? "—" : pct1(ref.mcPct)}
              rodape={`${fmtBRLShortStr(ref.mc)} de ${fmtBRLShortStr(ref.receita)}`} />
            <Bloco titulo="Custos fixos · mês" valor={fmtBRLShort(ref.fixos)}
              rodape={`variáveis ${fmtBRLShortStr(ref.variaveis)}`} />
            <Bloco titulo="Equilíbrio · média 3m" valor={m3?.pe != null ? fmtBRLShort(m3.pe) : "—"}
              rodape={m3?.mcPct != null ? `MC ${pct1(m3.mcPct)}` : "sem base"} />
            <Bloco titulo="Equilíbrio · média 2m" valor={m2?.pe != null ? fmtBRLShort(m2.pe) : "—"}
              rodape="tendência recente" />
          </div>

          {/* Tradução em MRR / clientes */}
          {gap !== null && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg border p-2.5 text-[11.5px]",
              gap > 0 ? "border-neg/30 bg-neg/5" : "border-pos/30 bg-pos/5",
            )}>
              <Info className={cn("mt-px h-3.5 w-3.5 shrink-0", gap > 0 ? "text-neg" : "text-pos")} />
              <div className="min-w-0">
                {gap > 0 ? (
                  <>
                    <span className="font-semibold text-foreground">Faltam {fmtBRL(gap)} de receita no mês</span>
                    {clientesGap !== null && (
                      <> — cerca de <span className="font-semibold text-foreground">{fmtInt(Math.ceil(clientesGap))} clientes</span> ao ticket médio de {fmtBRLShort(ticket)}.</>
                    )}
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-foreground">Folga de {fmtBRL(-gap)} acima do equilíbrio</span>
                    {clientesGap !== null && (
                      <> — daria para perder cerca de <span className="font-semibold text-foreground">{fmtInt(Math.floor(-clientesGap))} clientes</span> ao ticket médio de {fmtBRLShort(ticket)} antes de empatar.</>
                    )}
                  </>
                )}
                {clientesGap === null && <> · sem ticket médio no snapshot de assinaturas para converter em clientes.</>}
                {clientesGap !== null && assin?.clientes_ativos ? (
                  <span className="text-muted-foreground"> Base atual: {fmtInt(assin.clientes_ativos)} clientes.</span>
                ) : null}
              </div>
            </div>
          )}

          {/* 12 meses: receita realizada vs. ponto de equilíbrio */}
          {serie.length > 1 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                  Receita vs. ponto de equilíbrio · {serie.length} meses
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pos" /> cobriu</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neg" /> não cobriu</span>
                  <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-primary" /> equilíbrio</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={170}>
                <ComposedChart data={serie} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={54}
                    tickFormatter={(v: number) => fmtBRLShortStr(v)} />
                  <Tooltip content={<SerieTooltip />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)" }} />
                  <Bar dataKey="receita" name="Receita" radius={[3, 3, 0, 0]} maxBarSize={30}>
                    {serie.map((d, i) => (
                      <Cell key={i} fill={d.cobre ? "hsl(var(--pos))" : "hsl(var(--neg))"} />
                    ))}
                  </Bar>
                  <Line dataKey="pe" name="Ponto de equilíbrio" stroke="hsl(var(--primary))" strokeWidth={2}
                    dot={{ r: 2 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <PainelClassificacao
        open={painel} onOpenChange={setPainel}
        rows={rows} mesRef={mesRef} classificacao={classificacao}
        onReclassificar={reclassificar} onRestaurar={restaurarPadrao}
        ajustesCount={Object.keys(ajustes).length} resultado={ref} anterior={anterior}
        origem={origem}
      />
    </div>
  );
}

/* ------------------------------ subcomponentes ------------------------------ */

function Footnote({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto border-t border-border/40 pt-2 text-[10px] text-muted-foreground/80">{children}</div>;
}

function Bloco({ titulo, valor, rodape }: { titulo: string; valor: React.ReactNode; rodape?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
      <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">{titulo}</div>
      <div className="num mt-1 text-[18px] font-semibold text-foreground">{valor}</div>
      {rodape && <div className="num mt-0.5 truncate text-[11px] text-muted-foreground">{rodape}</div>}
    </div>
  );
}

function SerieTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload ?? {};
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-[11.5px] shadow-md">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      <div className="num text-muted-foreground">Receita: <span className="text-foreground">{valorExato(d.receita ?? 0)}</span></div>
      <div className="num text-muted-foreground">
        Equilíbrio: <span className="text-foreground">{d.pe == null ? "não existe" : valorExato(d.pe)}</span>
      </div>
      {d.pe != null && (
        <div className={cn("num mt-0.5 font-medium", d.cobre ? "text-pos" : "text-neg")}>
          {d.cobre ? "acima" : "abaixo"} em {valorExato(Math.abs((d.receita ?? 0) - d.pe))}
        </div>
      )}
    </div>
  );
}

/* Painel de classificação — o que é variável, o que é fixo e o que fica fora.
   Mostra o valor da rubrica no mês de referência porque mover uma linha sem
   ver quanto ela pesa é decidir no escuro. */
function PainelClassificacao({
  open, onOpenChange, rows, mesRef, classificacao, onReclassificar, onRestaurar, ajustesCount, resultado, anterior, origem,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  rows: LinhaDRE[]; mesRef: string;
  classificacao: Record<string, Bucket>;
  onReclassificar: (rubrica: string, b: Bucket) => void;
  onRestaurar: () => void;
  ajustesCount: number;
  resultado: ResultadoMes;
  anterior: ResultadoMes | null;
  origem: "banco" | "local";
}) {
  const grupos = useMemo(() => catalogoCompleto(rows), [rows]);
  const valorDe = useMemo(() => {
    const map = new Map(rows.map((r) => [String(r?.["Conta"] ?? "").trim(), Math.abs(Number(r?.[mesRef] ?? 0))]));
    return (rubrica: string) => map.get(rubrica) ?? 0;
  }, [rows, mesRef]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Classificação de custos · ponto de equilíbrio</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
          <div className="text-[11.5px] text-muted-foreground">
            Valores de <span className="font-semibold text-foreground">{rotuloLongo(mesRef)}</span> ·{" "}
            fixos <span className="num font-semibold text-foreground">{fmtBRLShort(resultado.fixos)}</span> ·{" "}
            MC <span className="num font-semibold text-foreground">{resultado.mcPct === null ? "—" : pct1(resultado.mcPct)}</span> ·{" "}
            equilíbrio <span className="num font-semibold text-foreground">{resultado.pe === null ? "não existe" : fmtBRLShort(resultado.pe)}</span>
          </div>
          <button
            onClick={onRestaurar}
            disabled={!ajustesCount}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão{ajustesCount ? ` (${ajustesCount})` : ""}
          </button>
        </div>

        <p className="text-[11.5px] text-muted-foreground">
          <span className="font-medium text-foreground">Variável</span> sobe junto com a venda ·{" "}
          <span className="font-medium text-foreground">Fixo</span> acontece independente do faturamento ·{" "}
          <span className="font-medium text-foreground">Fora</span> não entra na conta.
          Depreciação está como fixo (ponto de equilíbrio contábil); jogue em "Fora" para ler o de caixa.
        </p>

        <div className="-mx-1 max-h-[52vh] overflow-y-auto px-1">
          {grupos.map((g) => (
            <div key={g.grupo} className="mb-3">
              <div className="sticky top-0 z-10 bg-background py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {g.grupo}
                {g.grupo === GRUPO_OUTRAS && (
                  <span className="ml-2 font-normal normal-case tracking-normal text-amber-600 dark:text-amber-400">
                    fora do catálogo — nascem em "Fora"
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {g.rubricas.map((r) => {
                  const v = valorDe(r);
                  const b = classificacao[r] ?? "fora";
                  return (
                    <div key={r} className={cn(
                      "flex items-center justify-between gap-3 rounded-md px-2 py-1.5",
                      v > 0 ? "bg-secondary/40" : "bg-secondary/10",
                    )}>
                      <div className="min-w-0 flex-1">
                        <div className={cn("truncate text-[12px]", v > 0 ? "text-foreground" : "text-muted-foreground")} title={r}>{r}</div>
                      </div>
                      <div className="num shrink-0 text-[11.5px] text-muted-foreground" title={valorExato(v)}>
                        {v > 0 ? fmtBRLShortStr(v) : "—"}
                      </div>
                      <div className="flex shrink-0 rounded-md border border-border bg-card p-0.5">
                        {(["variavel", "fixo", "fora"] as const).map((k) => (
                          <button
                            key={k}
                            onClick={() => onReclassificar(r, k)}
                            className={cn(
                              "rounded px-2 py-0.5 text-[11px] font-medium transition",
                              b === k
                                ? k === "variavel" ? "bg-primary text-primary-foreground"
                                  : k === "fixo" ? "bg-foreground text-background"
                                  : "bg-secondary text-muted-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {ROTULO_BUCKET[k]}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="border-t border-border pt-2 text-[10.5px] text-muted-foreground/80">
          {origem === "banco" ? (
            <>Vale para todos os logins — cada mudança grava na hora e o card de todo mundo passa a usar esta regra.</>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">
              Salvando só neste navegador: a tabela compartilhada ainda não está no ar. Assim que estiver, o que você
              ajustou aqui sobe sozinho na próxima abertura da página.
            </span>
          )}
          {anterior ? ` · ${rotuloCurto(anterior.mes)} para comparar: equilíbrio ${anterior.pe === null ? "não existe" : fmtBRLShortStr(anterior.pe)}.` : ""}
        </p>
      </DialogContent>
    </Dialog>
  );
}
