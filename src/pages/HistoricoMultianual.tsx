import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, Download, FileText, TrendingUp, Layers, ChevronDown } from "lucide-react";
import TabelaDemonstracao, { type ModoTabela, type Unidade } from "@/components/historico/TabelaDemonstracao";
import {
  DRE_SCHEMA, DFC_SCHEMA, colunasDe, indexar, valorBruto, valorDoNo, variacao,
  ultimoMesFechado, flattenLabels, MES_PT,
  type Coluna, type LinhaBase, type Node,
} from "@/lib/demonstracoes-schema";
import { valorExato } from "@/lib/valor";
import { comValorExato } from "@/components/ValorExato";

/* ============================================================================
 * Histórico Multianual — o realizado de 2024, 2025 e o ano corrente lado a lado.
 *
 * Fonte: `demonstracoes_contabeis` (periodo='completo'), a base congelada do
 * Tracker de Orçamento. É a MESMA base das páginas DRE e DFC, e o cálculo passa
 * pelo mesmo módulo (lib/demonstracoes-schema), para os três não divergirem.
 *
 * O mês em aberto é descartado: a base costuma trazê-lo com meia dúzia de
 * linhas soltas, que entrariam no gráfico como um tombo falso.
 * ========================================================================== */

/* Paleta do "Onde o dinheiro sai" — 4 categorias, validada para daltonismo
   (scripts/validate_palette: todos os pares adjacentes passam nos dois modos).
   A ordem importa: é ela que separa vermelho e âmbar, o pior par. */
const CORES_SAIDA_CLARO = ["#d61a1a", "#0284c7", "#b45309", "#7c3aed"];
const CORES_SAIDA_ESCURO = ["#e05252", "#2e93b8", "#b0871f", "#8f6ce6"];

const BLOCOS_SAIDA = [
  { chave: "Pessoal", rotulo: "Pessoal" },
  { chave: "Despesas Marketing & Vendas", rotulo: "Marketing & Vendas" },
  { chave: "Despesas Administrativas", rotulo: "Administrativas" },
  { chave: "(-) Custos Operacionais", rotulo: "Custos operacionais" },
];

const fmtCompactoStr = (n: number) => {
  const a = Math.abs(n);
  const sinal = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sinal}R$ ${(a / 1e6).toFixed(2).replace(".", ",")} M`;
  if (a >= 1e3) return `${sinal}R$ ${Math.round(a / 1e3)} k`;
  return `${sinal}R$ ${Math.round(a)}`;
};
/* Mesmo texto compacto, mas revelando o valor cheio no hover. Onde o resultado
   precisa ser string (texto de insight, title), use fmtCompactoStr. */
const fmtCompacto = (n: number) => comValorExato(n, fmtCompactoStr(n));
const fmtPct1 = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;

type BaseBlob = { columns: string[]; rows: LinhaBase[] };

/** Acha um nó pelo rótulo dentro de um esquema. */
function acharNo(ns: Node[], label: string): Node | null {
  for (const n of ns) {
    if (n.label === label) return n;
    const f = n.children ? acharNo(n.children, label) : null;
    if (f) return f;
  }
  return null;
}

export default function HistoricoMultianual() {
  const [dre, setDre] = useState<BaseBlob | null>(null);
  const [dfc, setDfc] = useState<BaseBlob | null>(null);
  const [loading, setLoading] = useState(true);
  const [recarregando, setRecarregando] = useState(false);

  const [aba, setAba] = useState<"dre" | "dfc">("dre");
  const [modo, setModo] = useState<ModoTabela>("anual");
  const [unidade, setUnidade] = useState<Unidade>("reais");
  const [acumulado, setAcumulado] = useState(false);
  const [heatmap, setHeatmap] = useState(true);
  const [expandirTudo, setExpandirTudo] = useState(false);
  const [anoSel, setAnoSel] = useState<number>(0);
  const [escuro, setEscuro] = useState(false);

  useEffect(() => { document.title = "Análise · Histórico Multianual"; }, []);
  // A paleta das saídas tem um passo próprio por tema — não é o mesmo hex clareado.
  useEffect(() => {
    const el = document.documentElement;
    const ler = () => setEscuro(el.classList.contains("dark"));
    ler();
    const obs = new MutationObserver(ler);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const carregar = useCallback(async (silencioso = false) => {
    if (silencioso) setRecarregando(true);
    const { data, error } = await supabase
      .from("demonstracoes_contabeis")
      .select("tipo,dados")
      .eq("periodo", "completo")
      .in("tipo", ["dre", "dfc"]);
    if (error) toast.error("Falha ao carregar a base: " + error.message);
    else {
      for (const d of (data ?? []) as unknown as { tipo: string; dados: BaseBlob }[]) {
        if (d.tipo === "dre") setDre(d.dados);
        if (d.tipo === "dfc") setDfc(d.dados);
      }
    }
    setLoading(false);
    setRecarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const schema = aba === "dre" ? DRE_SCHEMA : DFC_SCHEMA;
  const base = aba === "dre" ? dre : dfc;
  const rotuloReceita = aba === "dre" ? "Receita Bruta" : "Entradas";

  /* --------------------------- eixo do tempo ---------------------------
   * Vem SEMPRE da DRE, para as duas abas falarem exatamente do mesmo período. */
  const tempo = useMemo(() => {
    if (!dre) return { colunas: [] as Coluna[], anos: [] as number[], parcial: null as number | null, mesesParcial: 12 };
    const todas = colunasDe(dre.columns);
    const ultimo = ultimoMesFechado(dre.rows, todas);
    const colunas = ultimo
      ? todas.filter((c) => c.ano < ultimo.ano || (c.ano === ultimo.ano && c.mes <= ultimo.mes))
      : todas;
    const anos = Array.from(new Set(colunas.map((c) => c.ano))).sort();
    const ultimoAno = anos[anos.length - 1];
    const mesesNoUltimo = colunas.filter((c) => c.ano === ultimoAno).length;
    const parcial = mesesNoUltimo < 12 ? ultimoAno : null;
    return { colunas, anos, parcial, mesesParcial: parcial ? mesesNoUltimo : 12 };
  }, [dre]);

  useEffect(() => { if (!anoSel && tempo.anos.length) setAnoSel(tempo.anos[0]); }, [tempo.anos, anoSel]);

  const idxDre = useMemo(() => indexar(dre?.rows ?? []), [dre]);
  const idxDfc = useMemo(() => indexar(dfc?.rows ?? []), [dfc]);
  const idx = aba === "dre" ? idxDre : idxDfc;

  const colsDoAno = useCallback(
    (ano: number) => tempo.colunas.filter((c) => c.ano === ano),
    [tempo.colunas],
  );

  const anosFechados = useMemo(() => tempo.anos.filter((a) => a !== tempo.parcial), [tempo.anos, tempo.parcial]);
  const anoBase = anosFechados[anosFechados.length - 1];      // último ano cheio — é o número grande do KPI
  const anoAnterior = anosFechados[anosFechados.length - 2];

  /* ------------------------------- KPIs ------------------------------- */
  const kpis = useMemo(() => {
    if (!dre || !anoBase) return [];
    const somaDre = (label: string, cols: Coluna[]) => {
      const n = acharNo(DRE_SCHEMA, label);
      return n ? cols.reduce((s, c) => s + valorDoNo(idxDre, n, c.col), 0) : 0;
    };
    const somaDfc = (label: string, cols: Coluna[]) => cols.reduce((s, c) => s + valorBruto(idxDfc, label, c.col), 0);

    const mk = (rotulo: string, calc: (cols: Coluna[]) => number, sub: (v: number) => string) => {
      const atual = calc(colsDoAno(anoBase));
      const anterior = anoAnterior ? calc(colsDoAno(anoAnterior)) : 0;
      const ytd = tempo.parcial ? calc(colsDoAno(tempo.parcial)) : null;
      return {
        rotulo, atual, anterior, ytd, sub: sub(atual),
        serie: tempo.colunas.map((c) => calc([c])),
        v: anoAnterior ? variacao(anterior, atual) : null,
      };
    };

    const mesesAno = colsDoAno(anoBase).length || 1;
    const rbAno = somaDre("Receita Bruta", colsDoAno(anoBase));
    const rlAno = somaDre("Receita Líquida", colsDoAno(anoBase));

    return [
      mk("Receita Bruta", (c) => somaDre("Receita Bruta", c),
        (v) => `Ano fechado · média ${fmtCompactoStr(v / mesesAno)}/mês`),
      mk("Receita Líquida", (c) => somaDre("Receita Líquida", c),
        (v) => (rbAno ? `Retenção de ${fmtPct1(v / rbAno)} da receita bruta` : "—")),
      mk("EBITDA", (c) => somaDre("EBITDA", c),
        (v) => (rlAno ? `Margem ${fmtPct1(v / rlAno)} sobre receita líquida` : "—")),
      mk("Lucro Líquido", (c) => somaDre("Lucro Líquido", c),
        (v) => (rlAno ? `Margem ${fmtPct1(v / rlAno)} sobre receita líquida` : "—")),
      mk("Cashburn", (c) => somaDfc("Cashburn", c),
        (v) => `Média de ${fmtCompactoStr(v / mesesAno)}/mês em ${anoBase}`),
    ];
  }, [dre, idxDre, idxDfc, anoBase, anoAnterior, tempo, colsDoAno]);

  /* -------------------- gráfico: receita bruta e EBITDA -------------------- */
  const serieGrafico = useMemo(() => {
    if (!dre) return [];
    const rb = acharNo(DRE_SCHEMA, "Receita Bruta"), eb = acharNo(DRE_SCHEMA, "EBITDA");
    if (!rb || !eb) return [];
    return tempo.colunas.map((c) => ({
      col: c, receita: valorDoNo(idxDre, rb, c.col), ebitda: valorDoNo(idxDre, eb, c.col),
    }));
  }, [dre, idxDre, tempo.colunas]);

  /* ------------------------ onde o dinheiro sai ------------------------ */
  const cores = escuro ? CORES_SAIDA_ESCURO : CORES_SAIDA_CLARO;
  const saidas = useMemo(() => {
    if (!dre) return [];
    return tempo.anos.map((ano) => {
      const cols = colsDoAno(ano);
      const partes = BLOCOS_SAIDA.map((b) => {
        const n = acharNo(DRE_SCHEMA, b.chave);
        return { ...b, valor: n ? Math.abs(cols.reduce((s, c) => s + valorDoNo(idxDre, n, c.col), 0)) : 0 };
      });
      return {
        ano,
        total: partes.reduce((s, p) => s + p.valor, 0),
        partes,
        rotulo: ano === tempo.parcial
          ? `${ano} · jan–${MES_PT[tempo.mesesParcial - 1].toLowerCase()}`
          : String(ano),
      };
    });
  }, [dre, idxDre, tempo, colsDoAno]);

  /* ------------------------------ exportar ------------------------------ */
  const exportar = () => {
    if (!base) return;
    const labels = flattenLabels(schema);
    const linhas = [
      ["Rubrica", ...tempo.colunas.map((c) => c.col)],
      ...labels.map((label) => {
        const n = acharNo(schema, label);
        return [label, ...tempo.colunas.map((c) => (n ? valorDoNo(idx, n, c.col) : 0))];
      }),
    ];
    const csv = linhas
      .map((l) => l.map((v) => (typeof v === "number" ? String(v) : `"${String(v).replace(/"/g, '""')}"`)).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `historico-multianual-${aba}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${aba.toUpperCase()} exportada em CSV.`);
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando a base congelada…
      </div>
    );
  }
  if (!dre) {
    return (
      <div className="card-surface mx-auto mt-10 max-w-md p-8 text-center">
        <div className="mb-1 text-[15px] font-semibold">Base do Tracker não encontrada</div>
        <p className="text-[12.5px] text-muted-foreground">
          Esta página lê <span className="num">demonstracoes_contabeis</span> com período “completo”.
          Importe a DRE pelo Tracker de Orçamento para o histórico aparecer aqui.
        </p>
      </div>
    );
  }

  const janela = [...anosFechados.map(String), tempo.parcial ? `${tempo.parcial} YTD` : null]
    .filter(Boolean).join(" · ");

  return (
    <div className="space-y-3 p-4 md:p-6">
      {/* ---------------- cabeçalho ---------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Histórico Multianual</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Realizado {janela}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportar} title="Exportar a visão atual em CSV"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-secondary">
            <Download className="h-4 w-4" />
          </button>
          <button onClick={() => carregar(true)} disabled={recarregando} title="Recarregar a base"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:bg-secondary disabled:opacity-60">
            <RefreshCw className={cn("h-4 w-4", recarregando && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.rotulo} className="card-surface flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[10px] font-bold tracking-wider text-muted-foreground">{k.rotulo.toUpperCase()}</div>
              <Sparkline valores={k.serie} />
            </div>
            <div className={cn("num mt-1.5 text-[26px] font-semibold leading-none tracking-tight",
              k.atual < 0 ? "text-destructive" : "text-foreground")}>
              {fmtCompacto(k.atual)}
            </div>
            {k.v && (
              <div className={cn("num mt-1.5 text-[12px] font-medium", k.v.bom ? "text-success" : "text-destructive")}>
                {k.v.sobe ? "↑" : "↓"} {Math.abs(Math.round(k.v.pct * 100))}% vs {String(anoAnterior).slice(2)}
              </div>
            )}
            <div className="mt-1 text-[11.5px] text-muted-foreground">{k.sub}</div>
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-border/60 pt-2.5">
              <div>
                <div className="text-[10px] text-muted-foreground">{anoAnterior}</div>
                <div className={cn("num text-[12.5px] font-medium", k.anterior < 0 && "text-destructive")}>{fmtCompacto(k.anterior)}</div>
              </div>
              {k.ytd != null && (
                <div>
                  <div className="text-[10px] text-muted-foreground">{tempo.parcial} · YTD</div>
                  <div className={cn("num text-[12.5px] font-medium", k.ytd < 0 && "text-destructive")}>{fmtCompacto(k.ytd)}</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ---------------- gráfico + onde o dinheiro sai ---------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_minmax(0,380px)]">
        <GraficoReceitaEbitda serie={serieGrafico} parcial={tempo.parcial} />

        <div className="card-surface p-4">
          <div className="text-[14px] font-semibold text-foreground">Onde o dinheiro sai</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Custos operacionais e SG&amp;A por bloco, % do total de saídas do ano.
          </p>
          <div className="mt-4 space-y-4">
            {saidas.map((s) => (
              <div key={s.ano}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-semibold text-foreground">{s.rotulo}</span>
                  <span className="num text-[12.5px] text-destructive">{fmtCompacto(-s.total)}</span>
                </div>
                <div className="mt-1.5 flex h-6 gap-[2px] overflow-hidden rounded">
                  {s.partes.map((p, i) => {
                    const pct = s.total ? p.valor / s.total : 0;
                    if (pct <= 0) return null;
                    return (
                      <div key={p.chave}
                           className="flex items-center justify-center text-[10.5px] font-semibold text-white"
                           style={{ width: `${pct * 100}%`, background: cores[i] }}
                           title={`${p.rotulo}: ${valorExato(-p.valor)} (${fmtPct1(pct)})`}>
                        {pct > 0.07 && `${Math.round(pct * 100)}%`}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-border/60 pt-3">
            {BLOCOS_SAIDA.map((b, i) => (
              <span key={b.chave} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: cores[i] }} /> {b.rotulo}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- DRE / DFC ---------------- */}
      <div className="card-surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {([{ k: "dre", l: "DRE", i: FileText }, { k: "dfc", l: "DFC", i: TrendingUp }] as const).map((t) => (
              <button key={t.k} onClick={() => setAba(t.k)}
                      className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition",
                        aba === t.k ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary/60")}>
                <t.i className="h-3.5 w-3.5" /> {t.l}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-muted-foreground">
            {aba === "dre" ? "Demonstrativo de resultado" : "Fluxo de caixa"} ·{" "}
            {modo === "anual"
              ? `ano fechado ${anosFechados.join(" e ")}${tempo.parcial ? `, ${tempo.parcial} até ${MES_PT[tempo.mesesParcial - 1].toLowerCase()}` : ""}`
              : anoSel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Grupo>
            <Opcao ativo={modo === "anual"} onClick={() => setModo("anual")}>Comparativo anual</Opcao>
            <Opcao ativo={modo === "mensal"} onClick={() => setModo("mensal")}>Mês a mês</Opcao>
          </Grupo>
          {modo === "mensal" && (
            <Grupo>
              {tempo.anos.map((a) => <Opcao key={a} ativo={anoSel === a} onClick={() => setAnoSel(a)}>{a}</Opcao>)}
            </Grupo>
          )}
          <Grupo>
            <Opcao ativo={unidade === "reais"} onClick={() => setUnidade("reais")}>R$</Opcao>
            <Opcao ativo={unidade === "pct"} onClick={() => setUnidade("pct")}>% receita</Opcao>
          </Grupo>
          {modo === "mensal" && (
            <Grupo>
              <Opcao ativo={!acumulado} onClick={() => setAcumulado(false)}>Mês</Opcao>
              <Opcao ativo={acumulado} onClick={() => setAcumulado(true)}>Acumulado</Opcao>
            </Grupo>
          )}
          <button onClick={() => setHeatmap((v) => !v)}
                  className={cn("inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition",
                    heatmap ? "border-primary/40 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-secondary")}>
            <Layers className="h-3.5 w-3.5" /> Heatmap
          </button>
          <button onClick={() => setExpandirTudo((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition hover:bg-secondary">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expandirTudo && "rotate-180")} />
            {expandirTudo ? "Recolher tudo" : "Expandir tudo"}
          </button>
        </div>

        <TabelaDemonstracao
          schema={schema}
          rows={base?.rows ?? []}
          idx={idx}
          colunas={tempo.colunas}
          anos={tempo.anos}
          anoParcial={tempo.parcial}
          mesesDoParcial={tempo.mesesParcial}
          modo={modo}
          anoSel={anoSel || tempo.anos[0]}
          unidade={unidade}
          acumulado={acumulado}
          heatmap={heatmap}
          expandirTudo={expandirTudo}
          rotuloReceita={rotuloReceita}
        />

        <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          Valores em R$ · negativos entre parênteses · em rubricas de despesa o Δ compara o módulo (↑ = gastou mais) ·
          base congelada do Tracker de Orçamento. {flattenLabels(schema).length} rubricas na {aba.toUpperCase()}.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ subcomponentes ------------------------------ */
function Grupo({ children }: { children: React.ReactNode }) {
  return <div className="inline-flex rounded-lg border border-border p-0.5">{children}</div>;
}
function Opcao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn(
      "rounded-md px-3 py-1.5 text-[12.5px] font-medium transition",
      ativo ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary/60",
    )}>{children}</button>
  );
}

/** Faísca do KPI — sem eixo nem rótulo, só a forma da série. */
function Sparkline({ valores }: { valores: number[] }) {
  if (valores.length < 2) return null;
  const W = 62, H = 20;
  const max = Math.max(...valores), min = Math.min(...valores);
  const span = max - min || 1;
  const x = (i: number) => (i / (valores.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;
  const d = valores.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} className="shrink-0" aria-hidden>
      <path d={`${d} L ${W} ${H} L 0 ${H} Z`} fill="hsl(var(--primary))" opacity={0.12} />
      <path d={d} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Receita bruta (barras, em cima) e EBITDA (faixa abaixo, verde acima de zero e
 * vermelho abaixo). São dois painéis com um eixo cada — nunca dois eixos y no
 * mesmo gráfico, que faria as duas séries parecerem comparáveis em escala.
 */
function GraficoReceitaEbitda({ serie, parcial }: {
  serie: { col: Coluna; receita: number; ebitda: number }[]; parcial: number | null;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  if (!serie.length) {
    return <div className="card-surface p-4 text-[12.5px] text-muted-foreground">Sem série para o gráfico.</div>;
  }

  const maxRec = Math.max(...serie.map((s) => s.receita), 1);
  const maxEb = Math.max(...serie.map((s) => Math.abs(s.ebitda)), 1);
  const anos = Array.from(new Set(serie.map((s) => s.col.ano)));
  const item = ativo != null ? serie[ativo] : null;

  return (
    <div className="card-surface relative p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-foreground">Receita bruta e EBITDA · {serie.length} meses</div>
          <p className="mt-0.5 max-w-md text-[12px] text-muted-foreground">
            Barras superiores: receita bruta. Faixa inferior: EBITDA acima/abaixo de zero.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-primary" /> Receita bruta</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-success" /> EBITDA +</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-destructive" /> EBITDA –</span>
        </div>
      </div>

      <div className="mt-4 flex items-stretch gap-[3px]" style={{ height: 250 }} onMouseLeave={() => setAtivo(null)}>
        {serie.map((s, i) => {
          const ytd = parcial != null && s.col.ano === parcial;
          const novoAno = i > 0 && s.col.ano !== serie[i - 1].col.ano;
          const apagado = ativo != null && ativo !== i;
          return (
            <div key={s.col.col}
                 className={cn("relative flex flex-1 flex-col justify-end", novoAno && "border-l border-dashed border-border pl-[3px]")}
                 onMouseEnter={() => setAtivo(i)}>
              <div className="flex flex-1 items-end">
                <div className="w-full rounded-t-[4px] bg-primary transition-opacity"
                     style={{ height: Math.max(2, (s.receita / maxRec) * 155), opacity: apagado ? 0.45 : ytd ? 0.62 : 1 }} />
              </div>
              <div className="mt-1 h-px w-full bg-border" />
              <div className="flex h-[42px] items-start">
                <div className={cn("w-full rounded-b-[3px] transition-opacity", s.ebitda >= 0 ? "bg-success" : "bg-destructive")}
                     style={{ height: Math.max(2, (Math.abs(s.ebitda) / maxEb) * 40), opacity: apagado ? 0.45 : 1 }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-[3px] text-[10px] text-muted-foreground">
        {serie.map((s, i) => (
          <div key={s.col.col} className="flex-1 text-center">
            {s.col.mes === 1 || i === 0
              ? <span className="font-semibold text-foreground">{MES_PT[s.col.mes - 1]}</span>
              : s.col.mes % 3 === 1 ? MES_PT[s.col.mes - 1] : ""}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[11px] font-semibold text-muted-foreground">
        {anos.map((a) => (
          <div key={a} className="text-center" style={{ flex: serie.filter((s) => s.col.ano === a).length }}>
            {a === parcial ? `${a} · YTD` : a}
          </div>
        ))}
      </div>

      {item && (
        <div className="pointer-events-none absolute right-4 top-16 rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
          <div className="text-[11px] font-semibold text-foreground">{MES_PT[item.col.mes - 1]}/{String(item.col.ano).slice(2)}</div>
          <div className="num mt-1 text-[12px] text-foreground">Receita {fmtCompacto(item.receita)}</div>
          <div className={cn("num text-[12px]", item.ebitda >= 0 ? "text-success" : "text-destructive")}>
            EBITDA {fmtCompacto(item.ebitda)}
          </div>
        </div>
      )}
    </div>
  );
}
