import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
} from "recharts";
import { RefreshCw, Loader2, MessageCircle, Eye, EyeOff, Maximize2, Search, ChevronDown } from "lucide-react";
import { fmtBRLShort, fmtPct } from "@/pages/dashboard/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { SyncOmieButtons } from "@/components/SyncOmieButtons";
import RelatorioCaixaModal from "@/components/RelatorioCaixaModal";

/* ------------------------------ formatters ------------------------------ */
const fmtBRL = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtHora = (isoStr?: string | null) =>
  isoStr ? new Date(isoStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDiaMes = (d: string) => { const [, m, dd] = d.split("-"); return `${dd}/${m}`; };
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
// "2026-06" → "Junho 2026" / "Jun/26"
const fmtMesRef = (mes: string) => { const [y, m] = mes.split("-").map(Number); return `${MESES[(m || 1) - 1]} ${y}`; };
const fmtMesCurto = (mes: string) => { const [y, m] = mes.split("-").map(Number); return `${MESES[(m || 1) - 1].slice(0, 3)}/${String(y).slice(-2)}`; };
const mesAnteriorStr = (mes: string) => { const [y, m] = mes.split("-").map(Number); const pm = m > 1 ? m - 1 : 12; const py = m > 1 ? y : y - 1; return `${py}-${String(pm).padStart(2, "0")}`; };
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HIDDEN_KEY = "caixa:contas-ocultas";

/* Variação vs. período anterior = (atual − anterior); % sobre |anterior|.
   ENTRADA positiva = recebeu mais; SAÍDA negativa = gastou menos; SALDO positivo = melhorou. */
function fmtVariacao(atual: number, anterior: number) {
  const diff = atual - anterior;
  const pct = Math.abs(anterior) > 0.005 ? (diff / Math.abs(anterior)) * 100 : null;
  const sinal = diff >= 0 ? "+" : "-";
  if (pct === null) return `${sinal}${fmtBRL(Math.abs(diff))} (período anterior zerado)`;
  return `${sinal}${fmtBRL(Math.abs(diff))} (${sinal}${Math.abs(pct).toFixed(2).replace(".", ",")}%)`;
}

/* ------------------------------ types (loose) ------------------------------ */
type Periodo = {
  entradas: number; saidas: number; resultado: number; n_recebimentos: number; n_pagamentos: number;
  entradas_vs_media: number; saidas_vs_media: number; entradas_pct_fluxo: number; liquido_pct: number;
  gastos_categoria: { nome: string; valor: number; pct: number }[];
  fornecedores: { nome: string; categoria: string; valor: number }[];
  movimentacoes: { data: string | null; descricao: string; categoria: string; conta: string; valor: number; natureza: string }[];
  mov_total: number;
};
type Conta = { ncodcc: string; nome: string; banco: string; subtitulo: string; saldo: number; saldo_data?: string | null; pct: number; incluir: boolean };
type DiaCal = { dia: number; realizado: boolean; tem_projetado: boolean; entradas: number; saidas: number; projetado: number; recebido: number };
type Snapshot = {
  sincronizado_em: string;
  saldo_consolidado: number;
  saldo_delta_periodo: number;
  n_contas: number;
  contas: Conta[];
  periodos: { ontem: Periodo; hoje: Periodo; semana: Periodo; mes: Periodo };
  contas_a_pagar: { total: number; itens: { data: string; descricao: string; categoria: string; valor: number; dias: number }[] };
  calendario: { ano: number; mes: number; hoje: number; dias: DiaCal[] };
  calendario_anterior: { ano: number; mes: number; dias: { dia: number; entradas: number; saidas: number; recebido: number }[] };
  fluxo_projetado: {
    menor: { valor: number; data: string }; maior_desembolso: { valor: number; data: string };
    saldo_final: { data: string; saldo: number }; saldo_atual: number;
    pontos: { data: string; saldo: number; entradas: number; saidas: number }[];
  };
};

/* ---- Capital de giro (necessidade mensal) — snapshot do Omie CAP ---- */
type CapitalGiroMes = {
  mes: string;
  necessidade_total: number;
  fechado: boolean;
  parcial: boolean;
  [grupo: string]: number | string | boolean; // custos, pessoal, marketing, admin, tecnologia, impostos, excl_*
};
type CapitalGiro = {
  meses: CapitalGiroMes[];
  mes_referencia: string;        // último mês fechado (ex.: "2026-06")
  necessidade_mes: number;       // necessidade do mês de referência (destaque)
  necessidade_mes_anterior: number;
  run_rate_2m: number;
  run_rate_3m: number;           // média móvel dos últimos 3 meses fechados
  var_mom_pct: number;           // variação vs. mês anterior (%)
  grupos_op: string[];
  grupos_label: Record<string, string>;
  mes_atual_parcial: string;
  definicao: string;
  metodo: string;
  sincronizado_em: string;
};

const sb = supabase as any;

export default function Caixa() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [cg, setCg] = useState<CapitalGiro | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [janela, setJanela] = useState<"ontem" | "hoje" | "semana" | "mes">("hoje");
  // modais de "expandir" (movimentações e fluxo projetado)
  const [movOpen, setMovOpen] = useState(false);
  const [movFiltro, setMovFiltro] = useState("");
  const [fluxoOpen, setFluxoOpen] = useState(false);
  // prévia editável do relatório antes de enviar (WhatsApp / futuro webhook n8n)
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgTitulo, setMsgTitulo] = useState("");
  const [msgTexto, setMsgTexto] = useState("");
  // seleção de período no calendário (2 cliques): início e fim
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  // contas ocultas do consolidado (persistido em localStorage; sincronizado ao Omie via `incluir`)
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "null") ?? []); } catch { return new Set(); }
  });

  async function carregar() {
    setLoading(true);
    const { data, error } = await sb
      .from("omie_caixa_snapshot").select("dados,gerado_em").order("gerado_em", { ascending: false }).limit(1).maybeSingle();
    if (error) toast.error("Falha ao carregar o caixa: " + error.message);
    setSnap((data?.dados as Snapshot) ?? null);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, []);

  // Capital de giro (necessidade mensal) — carrega o snapshot mais recente à parte,
  // pra uma tabela ausente/vazia não derrubar o painel do caixa.
  useEffect(() => {
    (async () => {
      const { data } = await sb
        .from("omie_capital_giro_snapshot").select("dados").order("gerado_em", { ascending: false }).limit(1).maybeSingle();
      setCg((data?.dados as CapitalGiro) ?? null);
    })();
  }, []);

  // 1ª carga: se o usuário nunca escolheu, herda o `incluir` do snapshot.
  useEffect(() => {
    if (snap && localStorage.getItem(HIDDEN_KEY) == null) {
      setHidden(new Set(snap.contas.filter((c) => c.incluir === false).map((c) => c.ncodcc)));
    }
  }, [snap]);

  async function sincronizar(forcar = false) {
    setSyncing(true);
    toast.message(forcar
      ? "Buscando dados do Omie… isso pode levar até 1 minuto."
      : "Recalculando o caixa com o cache do Omie…");
    try {
      const { data, error } = await supabase.functions.invoke("omie-caixa-sync", { body: { action: "sync", atualizar: forcar } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Caixa atualizado.");
      await carregar();
    } catch (e: any) {
      toast.error("Erro ao sincronizar: " + (e?.message ?? String(e)));
    } finally {
      setSyncing(false);
    }
  }

  function toggleConta(ncodcc: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(ncodcc) ? next.delete(ncodcc) : next.add(ncodcc);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      // persiste no Omie (best-effort) p/ o próximo sync respeitar a escolha
      sb.from("omie_caixa_conta").update({ incluir: !next.has(ncodcc) }).eq("ncodcc", ncodcc).then(() => {}, () => {});
      return next;
    });
  }

  const p = snap?.periodos?.[janela];

  /* ---------- saldo consolidado recalculado no cliente (respeita ocultas) ---------- */
  const contasView = useMemo(() => {
    const contas = snap?.contas ?? [];
    const visiveis = contas.filter((c) => !hidden.has(c.ncodcc));
    const consolidado = visiveis.reduce((s, c) => s + c.saldo, 0);
    return {
      consolidado,
      delta: (snap?.saldo_consolidado ?? 0) - consolidado, // quanto foi removido ao ocultar
      nVisiveis: visiveis.length,
      nomesVisiveis: visiveis.map((c) => c.nome),
      lista: contas.map((c) => ({
        ...c,
        oculta: hidden.has(c.ncodcc),
        pctView: consolidado ? (c.saldo / consolidado) * 100 : 0,
      })),
    };
  }, [snap, hidden]);

  /* ---------- período selecionado no calendário ---------- */
  const calHoje = snap?.calendario?.hoje ?? null;
  const [selMin, selMax] = useMemo(() => {
    if (rangeStart == null) return [calHoje, calHoje] as [number | null, number | null];
    const a = rangeStart, b = rangeEnd ?? rangeStart;
    return [Math.min(a, b), Math.max(a, b)] as [number, number];
  }, [rangeStart, rangeEnd, calHoje]);

  const periodoDia = useMemo(() => {
    if (!snap || selMin == null) return null;
    const dias = snap.calendario.dias.filter((d) => d.dia >= selMin && d.dia <= (selMax ?? selMin));
    return dias.reduce(
      (acc, d) => ({ entradas: acc.entradas + d.entradas, saidas: acc.saidas + d.saidas, projetado: acc.projetado + d.projetado }),
      { entradas: 0, saidas: 0, projetado: 0 },
    );
  }, [snap, selMin, selMax]);

  // Mesmos dias (por número) no mês ANTERIOR, para o comparativo abaixo de cada linha.
  // Dias que não existem no mês anterior (ex.: dia 31 selecionado e o mês anterior tem 30)
  // ficam de fora da soma — sinalizado por `diasComparados < diasSelecionados`.
  const periodoAnterior = useMemo(() => {
    if (!snap?.calendario_anterior || selMin == null) return null;
    const hi = selMax ?? selMin;
    const byDia = new Map(snap.calendario_anterior.dias.map((d) => [d.dia, d]));
    let entradas = 0, saidas = 0, diasComparados = 0;
    for (let d = selMin; d <= hi; d++) {
      const info = byDia.get(d);
      if (info) { entradas += info.entradas; saidas += info.saidas; diasComparados++; }
    }
    return { entradas, saidas, resultado: entradas - saidas, diasComparados, diasSelecionados: hi - selMin + 1 };
  }, [snap, selMin, selMax]);

  // Comparativo genérico: delta absoluto + % vs. o mesmo período do mês anterior.
  function comparativo(atual: number, anteriorVal: number) {
    const delta = atual - anteriorVal;
    const pct = Math.abs(anteriorVal) > 0.005 ? (delta / Math.abs(anteriorVal)) * 100 : null;
    return { delta, pct };
  }

  function onDayClick(dia: number) {
    if (rangeStart == null || rangeEnd != null) { setRangeStart(dia); setRangeEnd(null); }
    else setRangeEnd(dia);
  }

  /* ---------- fluxo projetado deslocado pelo saldo consolidado visível ---------- */
  const projData = useMemo(() => {
    const pts = snap?.fluxo_projetado?.pontos ?? [];
    const atual = contasView.consolidado;
    const maiorData = snap?.fluxo_projetado?.maior_desembolso?.data;
    return pts.map((pt) => {
      const saldo = pt.saldo - contasView.delta;
      return {
        data: fmtDiaMes(pt.data), dataISO: pt.data, saldo,
        entradas: pt.entradas, saidas: pt.saidas, liquido: pt.entradas - pt.saidas,
        cor: pt.data === maiorData && pt.saidas > 0 ? "maior" : saldo >= atual ? "acima" : "abaixo",
      };
    });
  }, [snap, contasView]);
  const projMin = useMemo(() => (projData.length ? Math.min(...projData.map((x) => x.saldo)) : 0), [projData]);
  const projTotais = useMemo(() => projData.reduce(
    (a, d) => ({ entradas: a.entradas + d.entradas, saidas: a.saidas + d.saidas }),
    { entradas: 0, saidas: 0 },
  ), [projData]);

  /* ---------- movimentações filtradas (modal "ver tudo") ---------- */
  const movFiltradas = useMemo(() => {
    const rows = p?.movimentacoes ?? [];
    const q = movFiltro.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => `${m.descricao} ${m.categoria} ${m.conta}`.toLowerCase().includes(q));
  }, [p, movFiltro]);
  const movTotais = useMemo(() => movFiltradas.reduce(
    (a, m) => { if (m.natureza === "entrada") a.entradas += m.valor; else a.saidas += m.valor; return a; },
    { entradas: 0, saidas: 0 },
  ), [movFiltradas]);

  /* Relatório de caixa por corte de dia do mês (dia 1 → diaFim), no padrão da skill do Miguel:
     entrada/saída/saldo do período + comparativo com o MESMO período do mês anterior (mesmos
     números de dia, com o convênio de variação do Miguel) + top 3 categorias de saída.
     Fonte: o próprio snapshot — `calendario`/`calendario_anterior` (já incluem Omie + Asaas),
     então a entrada é calculada automaticamente (na skill ela era digitada à mão). */
  function montarRelatorio(diaIni: number, diaFim: number, rotulo: string): string {
    const cal = snap!.calendario, calAnt = snap!.calendario_anterior;
    const ultimoDiaAnt = calAnt.dias.length;      // nº de dias do mês anterior
    const fimAnt = Math.min(diaFim, ultimoDiaAnt); // mês anterior mais curto → usa o último dia

    // ENTRADA = "caixa recebido" (só Asaas Disponível + Sicoob CC, campo `recebido`).
    // SAÍDA = todos os pagamentos do período (campo `saidas`, todas as contas).
    const soma = (dias: { dia: number; recebido: number; saidas: number }[], de: number, ate: number) =>
      dias.reduce((a, d) => (d.dia >= de && d.dia <= ate ? { rec: a.rec + (d.recebido ?? 0), s: a.s + d.saidas } : a), { rec: 0, s: 0 });
    const at = soma(cal.dias, diaIni, diaFim);
    const an = soma(calAnt.dias, diaIni, fimAnt);
    const entrada = at.rec, saida = at.s, saldo = entrada - saida;
    const entradaAnt = an.rec, saidaAnt = an.s, saldoAnt = entradaAnt - saidaAnt;

    // Top 3 categorias de saída no período (das movimentações do mês, filtradas por dia).
    const catMap = new Map<string, number>();
    for (const m of snap!.periodos.mes.movimentacoes) {
      if (m.natureza !== "saida" || !m.data) continue;
      const d = Number(m.data.slice(8, 10));
      if (d >= diaIni && d <= diaFim) {
        const c = m.categoria || "(sem categoria)";
        catMap.set(c, (catMap.get(c) ?? 0) + m.valor);
      }
    }
    const top = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    const dd = (n: number) => String(n).padStart(2, "0");
    const mm = dd(cal.mes + 1), mmA = dd(calAnt.mes + 1);
    const dAtual = (n: number) => `${dd(n)}/${mm}/${cal.ano}`;
    const dAnt = (n: number) => `${dd(n)}/${mmA}/${calAnt.ano}`;
    const pctCat = (v: number) => (saida ? (v / saida) * 100 : 0).toFixed(2).replace(".", ",");
    const periodoAtual = `${dAtual(diaIni)} a ${dAtual(diaFim)}`;
    const periodoAnt = `${dAnt(diaIni)} a ${dAnt(fimAnt)}`;

    const L: string[] = [];
    L.push(`CAIXA: ${rotulo.toUpperCase()} — ${MESES[cal.mes]}/${cal.ano} — Takeat`);
    L.push(`Período: ${periodoAtual}`);
    L.push(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`);
    L.push("");
    L.push("- ENTRADA DE CAIXA (Asaas Disponível + Sicoob CC)");
    L.push(`${periodoAtual}: ${fmtBRL(entrada)}`);
    L.push(`Mesmo período do mês anterior (${periodoAnt}): ${fmtBRL(entradaAnt)}`);
    L.push(`📈 Variação vs. período anterior: ${fmtVariacao(entrada, entradaAnt)}`);
    L.push("");
    L.push("- SAÍDA DE CAIXA");
    L.push(`${periodoAtual}: ${fmtBRL(saida)}`);
    L.push(`Mesmo período do mês anterior (${periodoAnt}): ${fmtBRL(saidaAnt)}`);
    L.push(`📈 Variação vs. período anterior: ${fmtVariacao(saida, saidaAnt)}`);
    if (top.length) {
      L.push("");
      L.push("Top 3 categorias do período:");
      top.forEach(([c, v], i) => L.push(`${i + 1}. ${c} — ${fmtBRL(v)} (${pctCat(v)}%)`));
    }
    L.push("");
    L.push("________");
    L.push("SALDO DO PERÍODO (Entrada − Saída)");
    L.push("");
    L.push(`${periodoAtual}: ${fmtBRL(saldo)}`);
    L.push(`Mesmo período do mês anterior: ${fmtBRL(saldoAnt)}`);
    L.push(`📈 Variação vs. período anterior: ${fmtVariacao(saldo, saldoAnt)}`);
    return L.join("\n");
  }

  // Abre a PRÉVIA editável (não envia direto). O envio final é feito de dentro do modal.
  function abrirRelatorio(diaIni: number, diaFim: number, rotulo: string) {
    if (!snap) return;
    setMsgTitulo(rotulo);
    setMsgTexto(montarRelatorio(diaIni, diaFim, rotulo));
    setMsgOpen(true);
  }
  async function copiarRelatorio() {
    try { await navigator.clipboard.writeText(msgTexto); toast.success("Texto copiado."); }
    catch { toast.error("Não consegui copiar o texto."); }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando o caixa…
      </div>
    );
  }

  if (!snap) {
    return (
      <div className="card-surface mx-auto mt-10 max-w-md p-8 text-center">
        <div className="mb-2 text-[15px] font-semibold">Nenhum snapshot do caixa ainda</div>
        <p className="mb-4 text-[12.5px] text-muted-foreground">
          Sincronize com o Omie para trazer saldos, entradas, saídas, contas a pagar e o fluxo projetado.
        </p>
        <button
          onClick={() => sincronizar(true)}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sincronizar com o Omie
        </button>
      </div>
    );
  }

  // rótulo do período selecionado
  const { ano, mes } = snap.calendario;
  const dataLabel = (d: number) => `${String(d).padStart(2, "0")}/${String(mes + 1).padStart(2, "0")}/${ano}`;
  const rangeLabel = selMin === selMax || selMax == null ? dataLabel(selMin!) : `${dataLabel(selMin!)} – ${dataLabel(selMax)}`;
  const tagPeriodo = (selMax ?? selMin!) <= (calHoje ?? 0) ? "Realizado" : (selMin ?? 0) > (calHoje ?? 0) ? "Projetado" : "Período";

  // ---- capital de giro: composição do mês de referência + comparações ----
  const cgMesRef = cg?.meses.find((m) => m.mes === cg.mes_referencia);
  const cgGrupos = cg
    ? cg.grupos_op
        .map((g) => ({ key: g, label: cg.grupos_label[g] ?? g, valor: Number((cgMesRef as any)?.[g] ?? 0) }))
        .filter((x) => x.valor > 0)
        .sort((a, b) => b.valor - a.valor)
    : [];
  const cgMaxGrupo = Math.max(1, ...cgGrupos.map((g) => g.valor));
  const cgDiff3m = cg ? cg.necessidade_mes - cg.run_rate_3m : 0;         // destaque vs. média móvel 3m
  const cgPct3m = cg && cg.run_rate_3m ? (cgDiff3m / cg.run_rate_3m) * 100 : 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* ---------------- Cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Caixa</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Omie
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Panorama consolidado do caixa · sincronizado com o Omie às {fmtHora(snap.sincronizado_em)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-2 rounded-md bg-[#25D366] px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:brightness-95">
                <MessageCircle className="h-4 w-4" /> Relatório → WhatsApp <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Corte do dia 1 até…</DropdownMenuLabel>
              {[15, 20, 25].map((n) => (
                <DropdownMenuItem
                  key={n}
                  disabled={n > snap.calendario.hoje}
                  onClick={() => abrirRelatorio(1, n, `Corte dia ${n}`)}
                  className="text-[12.5px]"
                >
                  Corte dia {n}
                  {n > snap.calendario.hoje && <span className="ml-auto text-[10px] text-muted-foreground">ainda não chegou</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => abrirRelatorio(1, snap.calendario.hoje, "Mês até hoje")} className="text-[12.5px]">
                Mês (até hoje)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={rangeStart == null || selMin == null}
                onClick={() => selMin != null && abrirRelatorio(selMin, selMax ?? selMin, `Período ${String(selMin).padStart(2, "0")}–${String(selMax ?? selMin).padStart(2, "0")}`)}
                className="text-[12.5px]"
              >
                Período selecionado no calendário
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex rounded-md border border-border bg-card p-0.5">
            {(["ontem", "hoje", "semana", "mes"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setJanela(k)}
                className={cn(
                  "rounded px-3 py-1 text-[12px] font-medium capitalize transition",
                  janela === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "mes" ? "Mês" : k}
              </button>
            ))}
          </div>
          <SyncOmieButtons
            syncing={syncing}
            onRecalcular={() => sincronizar(false)}
            onAtualizar={() => sincronizar(true)}
            recalcularHint="Refaz o painel do caixa com os dados já baixados do Omie (cache das últimas horas). Instantâneo e sem consumir a API do Omie."
            atualizarHint="Busca os lançamentos direto do Omie agora, ignorando o cache, e refaz o painel. Mais lento (~1 min) e consome a API do Omie. Use quando algo mudou no Omie e você quer o saldo/entradas na hora."
          />
        </div>
      </div>

      {/* ---------------- KPIs ---------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Saldo consolidado */}
        <div className="card-surface flex flex-col gap-3 p-4">
          <div className="eyebrow">Saldo consolidado · agora</div>
          <div className={cn("num text-[26px] font-semibold leading-none tracking-tight", contasView.consolidado >= 0 ? "text-pos" : "text-neg")}>{fmtBRL(contasView.consolidado)}</div>
          <div className="grid grid-cols-3 gap-2 pt-0.5">
            <MiniStat label="Δ no período" value={fmtBRLShort(snap.saldo_delta_periodo)} tone={snap.saldo_delta_periodo >= 0 ? "pos" : "neg"} />
            <MiniStat label="Contas" value={String(contasView.nVisiveis)} />
            <MiniStat label="Últ. sync" value={fmtHora(snap.sincronizado_em)} />
          </div>
          <Footnote>
            {contasView.nomesVisiveis.slice(0, 4).join(" + ") || "Contas correntes do Omie"}
            {contasView.delta !== 0 && <span className="text-muted-foreground/60"> · {hidden.size} oculta(s)</span>}
          </Footnote>
        </div>

        {/* Entradas */}
        <div className="card-surface flex flex-col gap-3 p-4">
          <div className="eyebrow">Entradas · {janela === "mes" ? "mês" : janela}</div>
          <div className="num text-[26px] font-semibold leading-none tracking-tight text-pos">{fmtBRL(p!.entradas)}</div>
          <div className="grid grid-cols-3 gap-2 pt-0.5">
            <MiniStat label="vs média 30d" value={fmtPct(p!.entradas_vs_media)} tone={p!.entradas_vs_media >= 0 ? "pos" : "neg"} />
            <MiniStat label="Recebimentos" value={String(p!.n_recebimentos)} />
          </div>
          <Footnote>Contas a receber liquidadas no Omie</Footnote>
        </div>

        {/* Saídas */}
        <div className="card-surface flex flex-col gap-3 p-4">
          <div className="eyebrow">Saídas · {janela === "mes" ? "mês" : janela}</div>
          <div className="num text-[26px] font-semibold leading-none tracking-tight text-neg">{fmtBRL(p!.saidas)}</div>
          <div className="grid grid-cols-3 gap-2 pt-0.5">
            <MiniStat label="vs média 30d" value={fmtPct(p!.saidas_vs_media)} tone={p!.saidas_vs_media <= 0 ? "pos" : "neg"} />
            <MiniStat label="Pagamentos" value={String(p!.n_pagamentos)} />
          </div>
          <Footnote>Contas a pagar liquidadas no Omie</Footnote>
        </div>

        {/* Resultado líquido */}
        <div className="card-surface flex flex-col gap-3 p-4">
          <div className="eyebrow">Resultado líquido · {janela === "mes" ? "mês" : janela}</div>
          <div className={cn("num text-[26px] font-semibold leading-none tracking-tight", p!.resultado >= 0 ? "text-pos" : "text-neg")}>
            {p!.resultado >= 0 ? "+" : ""}{fmtBRL(p!.resultado)}
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-pos" style={{ width: `${Math.min(100, Math.max(0, p!.entradas_pct_fluxo))}%` }} />
          </div>
          <div className="num text-[11px] text-muted-foreground">
            entradas {p!.entradas_pct_fluxo.toFixed(1).replace(".", ",")}% do fluxo · líquido {fmtPct(p!.liquido_pct)}
          </div>
          <Footnote>Entradas − saídas do período</Footnote>
        </div>
      </div>

      {/* ---------------- Necessidade de capital de giro ---------------- */}
      {cg && (
        <div className="card-surface p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="eyebrow">Necessidade de capital de giro</div>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Saídas operacionais previstas por mês · fonte Omie (contas a pagar){cg.mes_atual_parcial ? ` · ${fmtMesCurto(cg.mes_atual_parcial)} ainda parcial` : ""}
              </p>
            </div>
            <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
              Sincronizado {new Date(cg.sincronizado_em).toLocaleDateString("pt-BR")} {fmtHora(cg.sincronizado_em)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
            {/* Destaque: mês de referência (mês anterior fechado) */}
            <div className="flex flex-col gap-2 lg:border-r lg:border-border/60 lg:pr-4">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">{fmtMesRef(cg.mes_referencia)}</span>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">mês fechado</span>
              </div>
              <div className="num text-[30px] font-semibold leading-none tracking-tight text-foreground">{fmtBRL(cg.necessidade_mes)}</div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn(
                  "num inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold",
                  cg.var_mom_pct > 0 ? "bg-neg/10 text-neg" : "bg-pos/10 text-pos",
                )}>
                  {cg.var_mom_pct > 0 ? "▲" : "▼"} {fmtPct(Math.abs(cg.var_mom_pct))}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  vs. {fmtMesCurto(mesAnteriorStr(cg.mes_referencia))} ({fmtBRLShort(cg.necessidade_mes_anterior)})
                </span>
              </div>
              <Footnote>Custos, pessoal, marketing, admin, tecnologia e impostos · exclui transferências, CAPEX, captação e financeiras</Footnote>
            </div>

            {/* Comparação: média móvel + composição */}
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Média móvel · 3 meses</div>
                  <div className="num mt-1 text-[18px] font-semibold text-foreground">{fmtBRLShort(cg.run_rate_3m)}</div>
                  <div className={cn("num mt-0.5 text-[11px] font-medium", cgDiff3m >= 0 ? "text-neg" : "text-pos")}>
                    ref. {fmtPct(cgPct3m)} vs. média
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                  <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Média móvel · 2 meses</div>
                  <div className="num mt-1 text-[18px] font-semibold text-foreground">{fmtBRLShort(cg.run_rate_2m)}</div>
                  <div className="num mt-0.5 text-[11px] text-muted-foreground">tendência recente</div>
                </div>
                <div className="col-span-2 rounded-lg border border-border/60 bg-secondary/30 p-2.5 sm:col-span-1">
                  <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">Mês anterior</div>
                  <div className="num mt-1 text-[18px] font-semibold text-foreground">{fmtBRLShort(cg.necessidade_mes_anterior)}</div>
                  <div className="num mt-0.5 text-[11px] text-muted-foreground">{fmtMesCurto(mesAnteriorStr(cg.mes_referencia))}</div>
                </div>
              </div>

              {/* Composição do mês de referência */}
              {cgGrupos.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Composição · {fmtMesRef(cg.mes_referencia)}</div>
                  <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
                    {cgGrupos.map((g) => (
                      <div key={g.key} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 truncate text-[11px] text-muted-foreground" title={g.label}>{g.label}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-primary/70" style={{ width: `${(g.valor / cgMaxGrupo) * 100}%` }} />
                        </div>
                        <span className="num w-[68px] shrink-0 text-right text-[11px] font-medium text-foreground">{fmtBRLShort(g.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Calendário + Saldo por conta ---------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <SectionCard
            title="Calendário de caixa"
            subtitle="Clique em duas datas para ver o resultado do período · à frente de hoje, os pagamentos projetados"
            actions={
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pos" /> Realizadas</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> Projetados</span>
              </div>
            }
          >
            <Calendario snap={snap} selMin={selMin} selMax={selMax} onSelect={onDayClick} />
          </SectionCard>

          {/* Resultado do período selecionado */}
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <span className="num text-primary">{rangeLabel}</span>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">{tagPeriodo}</span>
              </span>
            }
            actions={
              (rangeStart != null) ? (
                <button onClick={() => { setRangeStart(null); setRangeEnd(null); }} className="text-[11px] text-muted-foreground hover:text-foreground">
                  Limpar seleção
                </button>
              ) : undefined
            }
          >
            <div className="space-y-2">
              <LinhaDia
                titulo="Entradas recebidas" sub="cobranças e recebimentos liquidados" valor={periodoDia?.entradas ?? 0} tone="pos"
                comparativo={periodoAnterior && comparativo(periodoDia?.entradas ?? 0, periodoAnterior.entradas)}
                favoravelSeAumenta
                diasIncompletos={periodoAnterior ? periodoAnterior.diasComparados < periodoAnterior.diasSelecionados : false}
              />
              <LinhaDia
                titulo="Saídas pagas" sub="títulos liquidados no período" valor={-(periodoDia?.saidas ?? 0)} tone="neg"
                comparativo={periodoAnterior && comparativo(periodoDia?.saidas ?? 0, periodoAnterior.saidas)}
                favoravelSeAumenta={false}
                diasIncompletos={periodoAnterior ? periodoAnterior.diasComparados < periodoAnterior.diasSelecionados : false}
              />
              <LinhaDia
                titulo="Resultado do período" sub="entradas − saídas"
                valor={(periodoDia?.entradas ?? 0) - (periodoDia?.saidas ?? 0)} tone="auto" destaque
                comparativo={periodoAnterior && comparativo((periodoDia?.entradas ?? 0) - (periodoDia?.saidas ?? 0), periodoAnterior.resultado)}
                favoravelSeAumenta
                diasIncompletos={periodoAnterior ? periodoAnterior.diasComparados < periodoAnterior.diasSelecionados : false}
              />
              {periodoDia && periodoDia.projetado > 0 && (
                <LinhaDia titulo="Pagamentos projetados" sub="títulos a vencer no período" valor={-(periodoDia.projetado)} tone="neg" />
              )}
            </div>
          </SectionCard>
        </div>

        {/* Saldo por conta bancária */}
        <SectionCard
          title="Saldo por conta bancária"
          subtitle="Última posição conciliada no Omie · clique no olho para ocultar do consolidado"
        >
          <div className="space-y-3.5">
            {contasView.lista.length === 0 && <div className="text-[12px] text-muted-foreground">Nenhuma conta retornada pelo Omie.</div>}
            {contasView.lista.map((c) => (
              <div key={c.ncodcc} className="flex items-start gap-2">
                <button
                  onClick={() => toggleConta(c.ncodcc)}
                  title={c.oculta ? "Mostrar no consolidado" : "Ocultar do consolidado"}
                  className="mt-0.5 shrink-0 text-muted-foreground/50 transition hover:text-foreground"
                >
                  {c.oculta ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <div className={cn("min-w-0 flex-1 space-y-1", c.oculta && "opacity-45")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">{c.nome}</span>
                    <span className="num text-[13px] font-semibold text-foreground">{fmtBRL(c.saldo)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full", c.oculta ? "bg-muted-foreground/40" : "bg-primary")}
                      style={{ width: `${c.oculta ? 100 : Math.min(100, Math.max(2, c.pctView))}%` }}
                    />
                  </div>
                  <div className="num text-[10.5px] text-muted-foreground">
                    {c.oculta ? "não considerada no consolidado" : `${c.pctView.toFixed(1).replace(".", ",")}% do consolidado`}
                    {c.subtitulo ? ` · ${c.subtitulo}` : ""}
                    {c.saldo_data ? ` · posição de ${fmtDiaMes(c.saldo_data)}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ---------------- Gastos por categoria + Fornecedores + Contas a pagar ---------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SectionCard title={`Gastos por categoria · ${janela === "mes" ? "mês" : janela}`} subtitle="Classificação das saídas conforme plano de contas do Omie">
          <div className="space-y-3">
            {p!.gastos_categoria.length === 0 && <Vazio>Sem saídas no período.</Vazio>}
            {p!.gastos_categoria.map((g, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium text-foreground">{g.nome}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="num text-[12.5px] font-semibold text-foreground">{fmtBRLShort(g.valor)}</span>
                    <span className="num text-[11px] text-muted-foreground">{g.pct.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.min(100, Math.max(2, g.pct))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title={`Maiores fornecedores · ${janela === "mes" ? "mês" : janela}`} subtitle="Top 5 por valor pago no período">
          <div className="space-y-2.5">
            {p!.fornecedores.length === 0 && <Vazio>Sem pagamentos no período.</Vazio>}
            {p!.fornecedores.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="num w-5 shrink-0 text-[11px] font-semibold text-muted-foreground/70">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-foreground">{f.nome}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{f.categoria}</div>
                </div>
                <span className="num shrink-0 text-[12.5px] font-semibold text-neg">-{fmtBRLShort(f.valor)}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Contas a pagar próximas"
          subtitle="Títulos em aberto no Omie · próximos 30 dias"
          actions={<span className="num text-[13px] font-semibold text-neg">{fmtBRLShort(snap.contas_a_pagar.total)}</span>}
        >
          <div className="max-h-[320px] space-y-2.5 overflow-y-auto pr-1">
            {snap.contas_a_pagar.itens.length === 0 && <Vazio>Nenhuma conta a vencer nos próximos 30 dias.</Vazio>}
            {snap.contas_a_pagar.itens.map((c, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="num w-9 shrink-0 pt-0.5 text-[11px] font-semibold text-muted-foreground">{fmtDiaMes(c.data)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-foreground">{c.descricao}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {c.categoria} · {c.dias === 0 ? "hoje" : c.dias === 1 ? "em 1 dia" : `em ${c.dias} dias`}
                  </div>
                </div>
                <span className="num shrink-0 text-[12.5px] font-semibold text-foreground">{fmtBRL(c.valor)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ---------------- Movimentações + Fluxo projetado ---------------- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SectionCard
          title={`Movimentações · ${janela === "mes" ? "mês" : janela}`}
          subtitle="Extrato consolidado das contas · Omie"
          actions={
            <>
              <span className="text-[11px] text-muted-foreground">{Math.min(60, p!.movimentacoes.length)} de {p!.mov_total} lançamentos</span>
              <button
                onClick={() => { setMovFiltro(""); setMovOpen(true); }}
                className="ghost-btn flex items-center gap-1 px-2 text-[11px]"
                title="Expandir e ver todos os lançamentos"
              >
                <Maximize2 className="h-3.5 w-3.5" /> Expandir
              </button>
            </>
          }
          padded={false}
        >
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-2 py-2 font-medium">Descrição</th>
                  <th className="px-2 py-2 font-medium">Categoria</th>
                  <th className="px-2 py-2 font-medium">Conta</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {p!.movimentacoes.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Sem lançamentos no período.</td></tr>
                )}
                {p!.movimentacoes.slice(0, 60).map((m, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-secondary/40">
                    <td className="num whitespace-nowrap px-4 py-1.5 text-muted-foreground">{m.data ? fmtDiaMes(m.data) : "—"}</td>
                    <td className="max-w-[160px] truncate px-2 py-1.5 text-foreground">{m.descricao}</td>
                    <td className="max-w-[130px] truncate px-2 py-1.5 text-muted-foreground">{m.categoria}</td>
                    <td className="max-w-[110px] truncate px-2 py-1.5 text-muted-foreground">{m.conta}</td>
                    <td className={cn("num whitespace-nowrap px-4 py-1.5 text-right font-medium", m.natureza === "entrada" ? "text-pos" : "text-neg")}>
                      {m.natureza === "entrada" ? "+" : "-"}{fmtBRL(m.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="Fluxo de caixa projetado · próximos 30 dias"
          subtitle="Saldo diário estimado a partir dos títulos a pagar e a receber do Omie"
          actions={
            <button
              onClick={() => setFluxoOpen(true)}
              className="ghost-btn flex items-center gap-1 px-2 text-[11px]"
              title="Expandir e ver o detalhe por dia"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Expandir
            </button>
          }
        >
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="eyebrow">Menor saldo projetado</div>
              <div className="num text-[18px] font-semibold text-foreground">
                {fmtBRLShort(snap.fluxo_projetado.menor.valor - contasView.delta)} <span className="text-[12px] font-normal text-muted-foreground">· {fmtDiaMes(snap.fluxo_projetado.menor.data)}</span>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="text-right">
                <div className="eyebrow">Entradas 30d</div>
                <div className="num text-[13px] font-semibold text-pos">+{fmtBRLShort(projTotais.entradas)}</div>
              </div>
              <div className="text-right">
                <div className="eyebrow">Saídas 30d</div>
                <div className="num text-[13px] font-semibold text-neg">-{fmtBRLShort(projTotais.saidas)}</div>
              </div>
            </div>
          </div>
          <div className="h-[190px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="data" tick={{ fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
                <YAxis domain={[projMin * 0.96, "dataMax"]} hide />
                <Tooltip content={<FluxoTooltip />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)" }} />
                <Bar dataKey="saldo" radius={[2, 2, 0, 0]}>
                  {projData.map((d, i) => (
                    <Cell key={i} fill={d.cor === "maior" ? "hsl(var(--neg))" : d.cor === "acima" ? "hsl(var(--pos))" : "hsl(var(--muted-foreground) / 0.35)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[10.5px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pos" /> saldo acima do atual</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/40" /> abaixo do atual</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neg" /> maior desembolso</span>
            <span className="ml-auto num">saldo em {fmtDiaMes(snap.fluxo_projetado.saldo_final.data)}: {fmtBRLShort(snap.fluxo_projetado.saldo_final.saldo - contasView.delta)}</span>
          </div>
        </SectionCard>
      </div>

      <div className="pt-1 text-center text-[11px] text-muted-foreground">
        Dados sincronizados do Omie ERP às {fmtHora(snap.sincronizado_em)} · contas correntes, contas a pagar e contas a receber
      </div>

      {/* ---------------- Modal: Prévia do relatório (WhatsApp → Miguel) ---------------- */}
      <RelatorioCaixaModal
        open={msgOpen}
        onClose={() => setMsgOpen(false)}
        titulo={msgTitulo}
        texto={msgTexto}
        onChangeTexto={setMsgTexto}
        onCopiar={copiarRelatorio}
      />

      {/* ---------------- Modal: Movimentações (ver tudo) ---------------- */}
      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Movimentações · {janela === "mes" ? "mês" : janela}</DialogTitle>
          </DialogHeader>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={movFiltro}
                onChange={(e) => setMovFiltro(e.target.value)}
                placeholder="Filtrar por fornecedor, categoria ou conta…"
                className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-4 text-[12px]">
              <span className="text-muted-foreground">{movFiltradas.length} lançamento{movFiltradas.length === 1 ? "" : "s"}</span>
              <span className="num font-semibold text-pos">+{fmtBRL(movTotais.entradas)}</span>
              <span className="num font-semibold text-neg">-{fmtBRL(movTotais.saidas)}</span>
            </div>
          </div>
          <div className="max-h-[65vh] overflow-auto rounded-md border border-border">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 font-medium">Categoria</th>
                  <th className="px-3 py-2 font-medium">Conta</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {movFiltradas.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Nenhum lançamento encontrado.</td></tr>
                )}
                {movFiltradas.map((m, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-secondary/40">
                    <td className="num whitespace-nowrap px-3 py-1.5 text-muted-foreground">{m.data ? fmtDiaMes(m.data) : "—"}</td>
                    <td className="px-3 py-1.5 text-foreground">{m.descricao}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{m.categoria}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{m.conta}</td>
                    <td className={cn("num whitespace-nowrap px-3 py-1.5 text-right font-medium", m.natureza === "entrada" ? "text-pos" : "text-neg")}>
                      {m.natureza === "entrada" ? "+" : "-"}{fmtBRL(m.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            Mostrando as maiores movimentações da janela (até 400) · valores em regime de caixa (data de pagamento).
          </p>
        </DialogContent>
      </Dialog>

      {/* ---------------- Modal: Fluxo projetado (detalhe por dia) ---------------- */}
      <Dialog open={fluxoOpen} onOpenChange={setFluxoOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Fluxo de caixa projetado · próximos 30 dias</DialogTitle>
          </DialogHeader>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Saldo atual" value={fmtBRLShort(contasView.consolidado)} />
            <MiniStat label="Menor saldo" value={`${fmtBRLShort(snap.fluxo_projetado.menor.valor - contasView.delta)} · ${fmtDiaMes(snap.fluxo_projetado.menor.data)}`} tone="neg" />
            <MiniStat label="Entradas 30d" value={`+${fmtBRLShort(projTotais.entradas)}`} tone="pos" />
            <MiniStat label="Saídas 30d" value={`-${fmtBRLShort(projTotais.saidas)}`} tone="neg" />
          </div>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="data" tick={{ fontSize: 9 }} interval={1} axisLine={false} tickLine={false} />
                <YAxis domain={[projMin * 0.96, "dataMax"]} hide />
                <Tooltip content={<FluxoTooltip />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)" }} />
                <Bar dataKey="saldo" radius={[2, 2, 0, 0]}>
                  {projData.map((d, i) => (
                    <Cell key={i} fill={d.cor === "maior" ? "hsl(var(--neg))" : d.cor === "acima" ? "hsl(var(--pos))" : "hsl(var(--muted-foreground) / 0.35)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 max-h-[38vh] overflow-auto rounded-md border border-border">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Dia</th>
                  <th className="px-3 py-2 text-right font-medium">Entradas</th>
                  <th className="px-3 py-2 text-right font-medium">Saídas</th>
                  <th className="px-3 py-2 text-right font-medium">Líquido</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo projetado</th>
                </tr>
              </thead>
              <tbody>
                {projData.map((d, i) => {
                  const semMov = d.entradas === 0 && d.saidas === 0;
                  const dow = DOW[new Date(d.dataISO + "T00:00:00").getDay()];
                  return (
                    <tr key={i} className={cn("border-b border-border/50", semMov ? "text-muted-foreground/60" : "hover:bg-secondary/40")}>
                      <td className="num whitespace-nowrap px-3 py-1.5">
                        {d.data} <span className="text-[10px] text-muted-foreground">{dow}</span>
                        {i === 0 && <span className="ml-1 rounded bg-secondary px-1 text-[9px] text-muted-foreground">hoje</span>}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-1.5 text-right text-pos">{d.entradas > 0 ? `+${fmtBRL(d.entradas)}` : "—"}</td>
                      <td className="num whitespace-nowrap px-3 py-1.5 text-right text-neg">{d.saidas > 0 ? `-${fmtBRL(d.saidas)}` : "—"}</td>
                      <td className={cn("num whitespace-nowrap px-3 py-1.5 text-right font-medium", d.liquido > 0 ? "text-pos" : d.liquido < 0 ? "text-neg" : "text-muted-foreground")}>
                        {semMov ? "—" : `${d.liquido >= 0 ? "+" : "-"}${fmtBRL(Math.abs(d.liquido))}`}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-1.5 text-right font-semibold text-foreground">{fmtBRL(d.saldo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            Projeção pelos títulos em aberto do Omie (vencimento nos próximos 30 dias), partindo do saldo consolidado atual. Não inclui recorrências ainda não lançadas.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Tooltip do gráfico de fluxo: entradas, saídas e saldo do dia. */
function FluxoTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-md">
      <div className="mb-1 font-semibold text-foreground">{d.data}</div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Entradas</span><span className="num text-pos">+{fmtBRL(d.entradas)}</span></div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Saídas</span><span className="num text-neg">-{fmtBRL(d.saidas)}</span></div>
      <div className="mt-1 flex items-center justify-between gap-6 border-t border-border pt-1"><span className="text-muted-foreground">Saldo</span><span className="num font-semibold text-foreground">{fmtBRL(d.saldo)}</span></div>
    </div>
  );
}

/* ------------------------------ subcomponentes ------------------------------ */
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[9.5px] uppercase tracking-wider text-muted-foreground/80">{label}</span>
      <span className={cn("num truncate text-[12px] font-semibold", tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-foreground")}>{value}</span>
    </div>
  );
}
function Footnote({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto border-t border-border/40 pt-2 text-[10px] text-muted-foreground/80">{children}</div>;
}
function Vazio({ children }: { children: React.ReactNode }) {
  return <div className="py-4 text-center text-[12px] text-muted-foreground">{children}</div>;
}
function LinhaDia({
  titulo, sub, valor, tone, destaque, comparativo, favoravelSeAumenta, diasIncompletos,
}: {
  titulo: string; sub: string; valor: number; tone: "pos" | "neg" | "auto"; destaque?: boolean;
  comparativo?: { delta: number; pct: number | null } | null;
  favoravelSeAumenta?: boolean;
  diasIncompletos?: boolean;
}) {
  const cor = tone === "auto" ? (valor >= 0 ? "text-pos" : "text-neg") : tone === "pos" ? "text-pos" : "text-neg";
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-md px-3 py-2", destaque ? "bg-secondary/60" : "bg-secondary/30")}>
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-foreground">{titulo}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn("num text-[14px] font-semibold", cor)}>
          {valor >= 0 ? "+" : ""}{fmtBRL(valor)}
        </div>
        {comparativo && <ComparativoMes {...comparativo} favoravelSeAumenta={!!favoravelSeAumenta} diasIncompletos={diasIncompletos} />}
      </div>
    </div>
  );
}

/* Linha "vs mês anterior: +R$ X (+Y%)" abaixo do valor — cor reflete se a direção é boa ou ruim. */
function ComparativoMes({
  delta, pct, favoravelSeAumenta, diasIncompletos,
}: { delta: number; pct: number | null; favoravelSeAumenta: boolean; diasIncompletos?: boolean }) {
  const semMudanca = Math.abs(delta) < 0.005;
  const aumentou = delta > 0;
  const favoravel = semMudanca ? null : aumentou === favoravelSeAumenta;
  const cor = favoravel == null ? "text-muted-foreground" : favoravel ? "text-pos" : "text-neg";
  return (
    <div className={cn("num text-[10.5px]", cor)} title={diasIncompletos ? "O mês anterior tem menos dias — comparando só os dias correspondentes." : undefined}>
      vs mês anterior: {delta >= 0 ? "+" : ""}{fmtBRLShort(delta)}
      {pct !== null && ` (${fmtPct(pct)})`}
      {diasIncompletos && "*"}
    </div>
  );
}

function Calendario({ snap, selMin, selMax, onSelect }: { snap: Snapshot; selMin: number | null; selMax: number | null; onSelect: (d: number) => void }) {
  const { ano, mes, hoje, dias } = snap.calendario;
  const byDia = new Map(dias.map((d) => [d.dia, d]));
  const primeiroDow = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const celulas: (number | null)[] = [...Array(primeiroDow).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)];
  const lo = selMin, hi = selMax ?? selMin;

  return (
    <div>
      <div className="mb-2 text-center text-[13px] font-semibold text-foreground">{MESES[mes]} {ano}</div>
      <div className="grid grid-cols-7 gap-1">
        {DOW.map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{d}</div>
        ))}
        {celulas.map((dia, i) => {
          if (dia === null) return <div key={i} />;
          const info = byDia.get(dia);
          const isHoje = dia === hoje;
          const isEndpoint = dia === lo || dia === hi;
          const inRange = lo != null && hi != null && dia > lo && dia < hi;
          return (
            <button
              key={i}
              onClick={() => onSelect(dia)}
              className={cn(
                "relative flex h-9 flex-col items-center justify-center gap-0.5 rounded-md text-[11.5px] transition",
                isEndpoint ? "bg-primary font-semibold text-primary-foreground"
                  : inRange ? "bg-primary/15 text-foreground"
                  : isHoje ? "bg-secondary font-semibold text-foreground"
                  : "text-foreground hover:bg-secondary/60",
              )}
            >
              <span className="num leading-none">{dia}</span>
              <span className="flex h-1 items-center gap-0.5">
                {info?.realizado && <span className={cn("h-1 w-1 rounded-full", isEndpoint ? "bg-primary-foreground" : "bg-pos")} />}
                {info?.tem_projetado && <span className={cn("h-1 w-1 rounded-full", isEndpoint ? "bg-primary-foreground/70" : "bg-primary")} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
