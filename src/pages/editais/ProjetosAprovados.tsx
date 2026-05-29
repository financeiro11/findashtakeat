import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkline } from "@/components/ui/sparkline";
import {
  LayoutDashboard, FolderKanban, Brain, BellRing, FileCheck2, Settings,
  Sparkles, Send, ArrowRight, AlertTriangle, Clock, ShieldAlert,
  CalendarClock, CircleDot, Zap, Lock, FileWarning, CheckCircle2,
  TrendingDown, Wallet, Lightbulb,
} from "lucide-react";
import { fmtBRL } from "./types";


/* ───────────────────────── DADOS (carregados do banco) ───────────────────────── */

type Rubrica = {
  nome: string;
  planejado: number;
  gasto: number;
  reservado?: boolean;       // verba inteira é protegida (obrigatória)
  reservado_valor?: number;  // parcela obrigatória dentro da rubrica (subdivisão)
  pendencias_nf?: number;    // nº de lançamentos sem NF
  sugestoes?: string[];      // o que pode pagar
};

type Projeto = {
  nome: string;
  orgao: string;
  prazo: string;             // mm/yyyy
  status: "em_execucao" | "aguardando_resultado" | "encerrado";
  rubricas: Rubrica[];
  pode_usar_para: string[];
};

const sb = supabase as any;

const mapStatus = (s: string | null | undefined): Projeto["status"] => {
  const v = (s ?? "").toLowerCase();
  if (v.includes("aguard")) return "aguardando_resultado";
  if (v.includes("encerr") || v.includes("finaliz")) return "encerrado";
  return "em_execucao";
};

const fmtPrazo = (d: string | null | undefined): string => {
  if (!d) return "—";
  const [y, m] = d.split("-");
  return m && y ? `${m}/${y}` : "—";
};

/** Carrega todos os projetos do banco e converte para o formato usado pelo Executivo. */
function useProjetosFromDB() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [p, r, c] = await Promise.all([
      sb.from("projetos_aprovados").select("*").order("ordem"),
      sb.from("projetos_aprovados_rubricas").select("*").order("ordem"),
      sb.from("projetos_aprovados_compras").select("*"),
    ]);
    const rawProjetos = (p.data ?? []) as any[];
    const rawRubricas = (r.data ?? []) as any[];
    const rawCompras = (c.data ?? []) as any[];

    // gasto e pendências por rubrica (excluindo canceladas)
    const gastoPorRubrica = new Map<string, number>();
    const pendPorRubrica = new Map<string, number>();
    rawCompras.filter(co => co.status !== "Cancelada").forEach(co => {
      gastoPorRubrica.set(co.rubrica_id, (gastoPorRubrica.get(co.rubrica_id) ?? 0) + Number(co.valor || 0));
      if (!co.nf_anexada) pendPorRubrica.set(co.rubrica_id, (pendPorRubrica.get(co.rubrica_id) ?? 0) + 1);
    });

    // mapear: para cada projeto, agrupar rubricas top-level e somar filhos
    const result: Projeto[] = rawProjetos.map(pr => {
      const rubs = rawRubricas.filter(rb => rb.projeto_id === pr.id);
      const tops = rubs.filter(rb => !rb.parent_id);

      const rubricas: Rubrica[] = tops.map(top => {
        const filhos = rubs.filter(rb => rb.parent_id === top.id);
        // O valor do top já representa o total da rubrica; os filhos são subdivisões internas.
        const planejado = Number(top.valor_planejado || 0);
        const gasto = (gastoPorRubrica.get(top.id) ?? 0) +
          filhos.reduce((s, f) => s + (gastoPorRubrica.get(f.id) ?? 0), 0);
        const pendencias_nf = (pendPorRubrica.get(top.id) ?? 0) +
          filhos.reduce((s, f) => s + (pendPorRubrica.get(f.id) ?? 0), 0);
        const reservadoTodo = !!top.obrigatorio && filhos.length === 0;
        const reservadoParcial = filhos
          .filter(f => f.obrigatorio)
          .reduce((s, f) => s + Number(f.valor_planejado || 0), 0);
        return {
          nome: top.categoria,
          planejado, gasto,
          reservado: reservadoTodo || undefined,
          reservado_valor: reservadoParcial > 0 ? reservadoParcial : undefined,
          pendencias_nf: pendencias_nf || undefined,
        };
      });

      return {
        nome: pr.nome,
        orgao: pr.orgao ?? "—",
        prazo: fmtPrazo(pr.prazo_final),
        status: mapStatus(pr.status),
        rubricas,
        pode_usar_para: [],
      };
    });

    setProjetos(result);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  return { projetos, loading, reload: load };
}


/* ───────────────────────── Derivações / regras de negócio ───────────────────────── */

const pct = (r: Rubrica) => (r.planejado > 0 ? (r.gasto / r.planejado) * 100 : 0);

const statusRubrica = (r: Rubrica) => {
  if (r.reservado) return "reservado" as const;
  if (r.gasto > r.planejado) return "estourado" as const;
  const p = pct(r);
  if (p >= 85) return "critico" as const;
  if (p >= 60) return "atencao" as const;
  return "saudavel" as const;
};

const RUBRICA_BADGE: Record<ReturnType<typeof statusRubrica>, string> = {
  saudavel: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  atencao: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  critico: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  estourado: "bg-rose-500/10 text-rose-600 border-rose-500/30",
  reservado: "bg-amber-500/10 text-amber-700 border-amber-500/30",
};

const RUBRICA_LABEL: Record<ReturnType<typeof statusRubrica>, string> = {
  saudavel: "Saudável", atencao: "Atenção", critico: "Crítico", estourado: "Estourado", reservado: "Reservado",
};

const projStatusBadge = (s: Projeto["status"]) =>
  s === "em_execucao" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
  : s === "aguardando_resultado" ? "bg-sky-500/10 text-sky-600 border-sky-500/30"
  : "bg-muted text-muted-foreground border-border";

const projStatusLabel = (s: Projeto["status"]) =>
  s === "em_execucao" ? "Em execução" : s === "aguardando_resultado" ? "Aguardando resultado" : "Encerrado";

const projRisco = (p: Projeto): "alto" | "medio" | "baixo" | "—" => {
  if (p.status !== "em_execucao") return "—";
  const ativas = p.rubricas.filter(r => !r.reservado);
  if (ativas.some(r => r.gasto > r.planejado)) return "alto";
  if (ativas.some(r => pct(r) >= 85)) return "medio";
  return "baixo";
};

const riscoBadge = (r: string) =>
  r === "alto" ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
  : r === "medio" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
  : r === "baixo" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
  : "bg-muted text-muted-foreground border-border";

const rubricaReservado = (r: Rubrica) =>
  r.reservado ? r.planejado : (r.reservado_valor ?? 0);

const projAgregado = (p: Projeto) => {
  const planejado = p.rubricas.reduce((s, r) => s + (r.reservado ? 0 : r.planejado), 0);
  const gasto = p.rubricas.filter(r => !r.reservado).reduce((s, r) => s + r.gasto, 0);
  const reservado = p.rubricas.reduce((s, r) => s + rubricaReservado(r), 0);
  // saldo livre desconta a parcela obrigatória embutida nas rubricas mistas
  const carvedDentroDeAtivas = p.rubricas.filter(r => !r.reservado).reduce((s, r) => s + (r.reservado_valor ?? 0), 0);
  const saldoBruto = planejado - gasto;
  const comprometido = p.rubricas.filter(r => !r.reservado && r.gasto > r.planejado).reduce((s, r) => s + (r.gasto - r.planejado), 0);
  const saldoLivre = Math.max(0, saldoBruto - comprometido - carvedDentroDeAtivas);
  const exec = planejado > 0 ? (gasto / planejado) * 100 : 0;
  const pendNF = p.rubricas.reduce((s, r) => s + (r.pendencias_nf ?? 0), 0);
  return { planejado, gasto, reservado, saldoBruto, saldoLivre, exec, pendNF };
};

/* ───────────────────────── Sub-nav ───────────────────────── */

const subItems = [
  { to: "/editais/projetos-aprovados", label: "Executivo", icon: LayoutDashboard, end: true },
  { to: "/editais/projetos-aprovados/projetos", label: "Projetos", icon: FolderKanban },
  { to: "/editais/projetos-aprovados/ia", label: "Inteligência IA", icon: Brain },
  { to: "/editais/projetos-aprovados/alertas", label: "Alertas", icon: BellRing },
  { to: "/editais/projetos-aprovados/prestacao", label: "Prestação", icon: FileCheck2 },
  { to: "/editais/projetos-aprovados/config", label: "Configurações", icon: Settings },
];

export default function ProjetosAprovadosLayout() {
  const { pathname } = useLocation();
  const current = subItems.find(i => (i.end ? pathname === i.to : pathname.startsWith(i.to)));

  useEffect(() => { document.title = `Editais · Projetos Aprovados · ${current?.label ?? ""}`; }, [current]);

  return (
    <div className="flex flex-col gap-3">
      {/* Título + ação */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Projetos Aprovados</h1>
          <span className="text-[10px] uppercase tracking-wider text-rose-600 font-semibold bg-rose-500/10 px-1.5 py-0.5 rounded">Execução</span>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[11.5px] gap-1.5">
          <FileCheck2 className="h-3 w-3" /> Manual
        </Button>
      </div>

      <nav className="flex items-center gap-0 border-b overflow-x-auto">

        {subItems.map(it => {
          const Icon = it.icon;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) => cn(
                "relative flex items-center gap-1.5 px-3 py-2 text-[13px] transition-colors whitespace-nowrap border-b-2 -mb-px",
                isActive
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {it.label}
            </NavLink>
          );
        })}
      </nav>

      <Outlet />
    </div>
  );
}

/* abbreviação BRL → "R$ 341 mil" */
function fmtBRLkurz(v: number): { num: string; suffix: string } {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return { num: (v / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(".", ","), suffix: "mi" };
  if (abs >= 1_000) return { num: Math.round(v / 1_000).toString(), suffix: "mil" };
  return { num: Math.round(v).toString(), suffix: "" };
}

/* ───────────────────────── Executivo ───────────────────────── */

const SUGESTOES = [
  "Posso pagar HubSpot pelo Tecnova III?",
  "Qual edital ainda tem verba livre?",
  "Quais projetos estão em risco?",
  "Quanto tenho disponível em terceiros?",
  "Alguma rubrica prestes a estourar?",
  "Quais lançamentos estão sem NF?",
];

export function ExecutivoTab() {
  const [pergunta, setPergunta] = useState("");
  const [mostrarResposta, setMostrarResposta] = useState(false);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaAnswer, setIaAnswer] = useState<string | null>(null);
  const [iaError, setIaError] = useState<string | null>(null);
  const { projetos: PROJETOS, loading } = useProjetosFromDB();

  const consultarIA = async (q: string) => {
    const txt = (q ?? "").trim();
    if (!txt) return;
    setMostrarResposta(true);
    setIaLoading(true);
    setIaAnswer(null);
    setIaError(null);
    try {
      const { data, error } = await supabase.functions.invoke("editais-edi-consult", {
        body: { pergunta: txt },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setIaAnswer((data as any)?.answer ?? "Sem resposta.");
    } catch (e: any) {
      setIaError(e?.message ?? "Falha ao consultar a IA.");
    } finally {
      setIaLoading(false);
    }
  };

  /* ─── Métricas agregadas ─── */
  const metricas = useMemo(() => {
    const ativos = PROJETOS.filter(p => p.status === "em_execucao");
    const aguardando = PROJETOS.filter(p => p.status === "aguardando_resultado");
    let saldoBruto = 0, gasto = 0, reservado = 0, saldoLivre = 0, pendNF = 0;
    const rubricasCriticas: { projeto: string; rubrica: Rubrica }[] = [];
    const rubricasEstouradas: { projeto: string; rubrica: Rubrica }[] = [];
    ativos.forEach(p => {
      const a = projAgregado(p);
      saldoBruto += a.saldoBruto;
      gasto += a.gasto;
      reservado += a.reservado;
      saldoLivre += a.saldoLivre;
      pendNF += a.pendNF;
      p.rubricas.forEach(r => {
        const st = statusRubrica(r);
        if (st === "critico") rubricasCriticas.push({ projeto: p.nome, rubrica: r });
        if (st === "estourado") rubricasEstouradas.push({ projeto: p.nome, rubrica: r });
      });
    });
    const sugestaoTerceiros = ativos.flatMap(p =>
      p.rubricas.filter(r => /terceiros|servi[çc]os pj/i.test(r.nome) && !r.reservado).map(r => ({ projeto: p.nome, livre: r.planejado - r.gasto }))
    );
    return {
      ativos, aguardando, saldoBruto, gasto, reservado, saldoLivre, pendNF,
      rubricasCriticas, rubricasEstouradas, sugestaoTerceiros,
    };
  }, [PROJETOS]);

  /* ─── KPIs (2 linhas de 4) ─── */
  const totalRubricas = PROJETOS.reduce((s, p) => s + p.rubricas.length, 0);
  const aguardandoNomes = metricas.aguardando.map(p => p.nome).join(", ");
  const KPIS_TOP = [
    { label: "Saldo realmente utilizável", value: metricas.saldoLivre, sub: "descontados reservados e rubricas comprometidas" },
    { label: "Saldo operacional livre",    value: metricas.saldoLivre, sub: `${metricas.ativos.length} projetos com verba ativa` },
    { label: "Valor já executado",         value: metricas.gasto,      sub: "soma de todas as rubricas" },
    { label: "Verba reservada obrigatória",value: metricas.reservado,  sub: "proteção contratual · não disponível" },
  ];
  const KPIS_BOTTOM = [
    { label: "Rubricas críticas",       value: metricas.rubricasCriticas.length,   sub: "≥ 85% executado",          tone: "amber" as const },
    { label: "Rubricas estouradas",     value: metricas.rubricasEstouradas.length, sub: "acima do planejado",       tone: "rose"  as const },
    { label: "Pendências documentais",  value: metricas.pendNF,                    sub: "lançamentos sem NF",       tone: "rose"  as const },
    { label: "Aguardando resultado",    value: metricas.aguardando.length,         sub: `pipeline futuro${aguardandoNomes ? ` · ${aguardandoNomes}` : ""}`, tone: "slate" as const },
  ];


  /* ─── Alertas automáticos ─── */
  const ALERTAS = useMemo(() => {
    const items: { nivel: string; icon: any; titulo: string; sub: string; color: string }[] = [];
    PROJETOS.forEach(p => {
      p.rubricas.forEach(r => {
        const st = statusRubrica(r);
        if (st === "estourado") {
          items.push({
            nivel: "Alto", icon: ShieldAlert,
            titulo: `${p.nome} → ${r.nome} estourou em ${Math.round(pct(r))}%`,
            sub: `Gasto ${fmtBRL(r.gasto)} sobre ${fmtBRL(r.planejado)} planejado`,
            color: "text-rose-600 bg-rose-500/10 border-rose-500/30",
          });
        } else if (st === "critico") {
          items.push({
            nivel: "Médio", icon: AlertTriangle,
            titulo: `${p.nome} → ${r.nome} atingiu ${Math.round(pct(r))}%`,
            sub: `Resta ${fmtBRL(r.planejado - r.gasto)} antes do limite`,
            color: "text-amber-600 bg-amber-500/10 border-amber-500/30",
          });
        }
      });
    });
    if (metricas.pendNF > 0) {
      items.push({
        nivel: "Médio", icon: FileWarning,
        titulo: `${metricas.pendNF} lançamentos estão sem nota fiscal`,
        sub: "Risco para prestação de contas",
        color: "text-amber-600 bg-amber-500/10 border-amber-500/30",
      });
    }
    if (metricas.reservado > 0) {
      items.push({
        nivel: "Info", icon: Zap,
        titulo: `${fmtBRL(metricas.reservado)} reservados obrigatoriamente`,
        sub: "Verba protegida · não considerar no saldo operacional livre",
        color: "text-amber-700 bg-amber-500/10 border-amber-500/40",
      });
    }
    metricas.aguardando.forEach(p => {
      items.push({
        nivel: "Info", icon: CalendarClock,
        titulo: `${p.nome} aguardando resultado`,
        sub: `Pleito de ${fmtBRL(projAgregado(p).planejado)} · ${p.orgao}`,
        color: "text-sky-600 bg-sky-500/10 border-sky-500/30",
      });
    });
    return items;
  }, [metricas, PROJETOS]);

  /* ─── Resposta contextual IA (dinâmica: pega as piores rubricas dos projetos ativos) ─── */
  const respostaIA = useMemo(() => {
    const ativos = metricas.ativos;
    // pior projeto = maior % de execução em rubricas não reservadas
    const piorProjeto = [...ativos].sort((a, b) => projAgregado(b).exec - projAgregado(a).exec)[0] ?? null;
    const segundoPior = ativos.filter(p => p !== piorProjeto)
      .sort((a, b) => projAgregado(b).exec - projAgregado(a).exec)[0] ?? null;

    const piorRubricas = piorProjeto
      ? [...piorProjeto.rubricas].filter(r => !r.reservado).sort((a, b) => pct(b) - pct(a)).slice(0, 2)
      : [];
    const segundoRubricasCriticas = segundoPior
      ? [...segundoPior.rubricas].filter(r => !r.reservado && pct(r) >= 60).sort((a, b) => pct(b) - pct(a)).slice(0, 1)
      : [];

    // qualquer projeto com rubrica reservada destacada
    const projetoComReserva = ativos.find(p => p.rubricas.some(r => r.reservado)) ?? null;
    const reservadas = projetoComReserva?.rubricas.filter(r => r.reservado) ?? [];
    const totalReservado = reservadas.reduce((s, r) => s + r.planejado, 0);
    const reservaDestaque = reservadas[0] ?? null;

    return {
      piorProjeto, segundoPior, piorRubricas, segundoRubricasCriticas,
      projetoComReserva, reservadas, totalReservado, reservaDestaque,
      livre: metricas.saldoLivre, pendNF: metricas.pendNF,
    };
  }, [metricas]);


  return (
    <div className="flex flex-col gap-4">
      {/* BLOCO 1 — EDI compacto */}
      <Card className="p-3 flex flex-col gap-2.5 border-border">
        <div className="flex items-center gap-2">
          <div className="h-7 px-2 rounded-md bg-gradient-to-br from-primary to-rose-600 grid place-items-center text-primary-foreground text-[10px] font-bold tracking-wider shadow-sm shrink-0">
            EDI
          </div>
          <span className="text-[12px] text-muted-foreground">
            Consultor IA · {PROJETOS.length} projetos · {totalRubricas} rubricas
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Ativa
          </span>
          <div className="relative flex-1 ml-2">
            <Input
              value={pergunta}
              onChange={e => setPergunta(e.target.value)}
              onKeyDown={e => e.key === "Enter" && setMostrarResposta(true)}
              placeholder="Ex: posso pagar HubSpot pelo Tecnova III?"
              className="h-9 text-[13px] bg-background pr-10"
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="opções">
              <Brain className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button onClick={() => setMostrarResposta(true)} className="h-9 gap-1.5 bg-primary hover:bg-primary/90">
            <ArrowRight className="h-3.5 w-3.5" /> Consultar
          </Button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mr-1">Atalhos</span>
          {SUGESTOES.map(s => (
            <button
              key={s}
              onClick={() => { setPergunta(s); setMostrarResposta(true); }}
              className="text-[11.5px] px-2 py-1 rounded-full border border-border bg-background hover:border-primary/40 hover:text-primary transition-colors"
            >
              {s}
            </button>
          ))}
        </div>

        {mostrarResposta && (
          <div className="rounded-lg border border-primary/20 bg-background p-4 flex flex-col gap-3 mt-1">
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] uppercase tracking-wider font-semibold text-primary">Resposta do EDI</span>
            </div>

            {respostaIA.piorProjeto && respostaIA.piorRubricas.length > 0 ? (
              <>
                <p className="text-[13px] leading-relaxed">
                  Maior risco operacional no projeto <span className="font-semibold text-rose-600">{respostaIA.piorProjeto.nome}</span>:
                </p>
                <ul className="text-[12.5px] space-y-1 ml-1">
                  {respostaIA.piorRubricas.map(r => (
                    <li key={r.nome} className="flex items-start gap-2">
                      <TrendingDown className="h-3 w-3 text-rose-600 mt-1 shrink-0" />
                      <span><b>{r.nome}</b> está <b className="num">{Math.round(pct(r))}%</b> executado</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {loading ? "Carregando dados dos projetos…" : "Nenhum projeto em execução cadastrado ainda."}
              </p>
            )}

            {respostaIA.segundoPior && respostaIA.segundoRubricasCriticas.length > 0 && (
              <>
                <p className="text-[13px] leading-relaxed">No <b>{respostaIA.segundoPior.nome}</b>:</p>
                <ul className="text-[12.5px] space-y-1 ml-1">
                  {respostaIA.segundoRubricasCriticas.map(r => (
                    <li key={r.nome} className="flex items-start gap-2">
                      <AlertTriangle className="h-3 w-3 text-amber-600 mt-1 shrink-0" />
                      <span><b>{r.nome}</b> possui apenas <b className="num">{Math.round(Math.max(0, 100 - pct(r)))}%</b> disponível</span>
                    </li>
                  ))}
                  {respostaIA.pendNF > 0 && (
                    <li className="flex items-start gap-2">
                      <FileWarning className="h-3 w-3 text-amber-600 mt-1 shrink-0" />
                      <span>Existem <b>{respostaIA.pendNF} lançamentos pendentes sem NF</b></span>
                    </li>
                  )}
                </ul>
              </>
            )}

            {respostaIA.projetoComReserva && respostaIA.reservaDestaque && (
              <div className="rounded-md bg-amber-500/5 border border-amber-500/30 px-3 py-2 flex items-start gap-2">
                <Lock className="h-3.5 w-3.5 text-amber-700 mt-0.5 shrink-0" />
                <div className="text-[12.5px] leading-relaxed">
                  A rubrica <b>{respostaIA.reservaDestaque.nome}</b> do {respostaIA.projetoComReserva.nome} possui <b className="num">{fmtBRL(respostaIA.reservaDestaque.planejado)}</b> reservados obrigatoriamente.
                  Somando as {respostaIA.reservadas.length} rubricas reservadas do projeto, <b className="num">{fmtBRL(respostaIA.totalReservado)}</b> não devem ser considerados saldo livre operacional.
                </div>
              </div>
            )}

            <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 mt-1">
              <div className="text-[10.5px] uppercase tracking-wider text-emerald-700 font-semibold">Saldo operacional livre estimado</div>
              <div className="text-base font-semibold num text-emerald-700">{fmtBRL(respostaIA.livre)}</div>
            </div>
          </div>
        )}
      </Card>


      {/* BLOCO 2 — KPIs em 2 linhas de 4 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KPIS_TOP.map(k => {
          const f = fmtBRLkurz(k.value);
          return (
            <Card key={k.label} className="relative p-3.5 pl-4 overflow-hidden">
              <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r bg-primary" />
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-[11px] text-muted-foreground">R$</span>
                <span className="text-3xl font-semibold tracking-tight num leading-none">{f.num}</span>
                {f.suffix && <span className="text-[11px] text-muted-foreground">{f.suffix}</span>}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-1.5">{k.sub}</div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KPIS_BOTTOM.map(k => {
          const toneColor =
            k.tone === "rose" ? "bg-rose-500 text-rose-600"
            : k.tone === "amber" ? "bg-amber-500 text-amber-600"
            : "bg-slate-400 text-slate-600";
          const [accentBg, numColor] = toneColor.split(" ");
          return (
            <Card key={k.label} className="relative p-3.5 pl-4 overflow-hidden">
              <span className={cn("absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r", accentBg)} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</div>
                  <div className="text-[10.5px] text-muted-foreground mt-1.5">{k.sub}</div>
                </div>
                <div className={cn("text-3xl font-semibold tracking-tight num leading-none", numColor)}>{k.value}</div>
              </div>
            </Card>
          );
        })}
      </div>


      {/* BLOCO 4 — Projetos prioritários (cards) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[13px] font-semibold tracking-tight">Projetos prioritários</h3>
            <span className="text-[11px] text-muted-foreground">
              {PROJETOS.length} projetos · ordenados por urgência · alertas inline
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-[11.5px] gap-1">▽ Filtros</Button>
            <Button variant="outline" size="sm" className="h-7 text-[11.5px] gap-1">Risco ↓</Button>
          </div>
        </div>

        {PROJETOS.map(p => <ProjetoCard key={p.nome} p={p} />)}
      </div>
    </div>
  );
}

/* ───────────────────────── ProjetoCard (card de execução) ───────────────────────── */

function diasRestantes(prazo: string): number | null {
  const m = prazo.match(/^(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const end = new Date(Number(m[2]), Number(m[1]), 0); // último dia do mês
  const today = new Date();
  return Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86_400_000));
}

const rubricaSegColor = (s: ReturnType<typeof statusRubrica>) =>
  s === "estourado" ? "bg-rose-500"
  : s === "critico" ? "bg-amber-500"
  : s === "atencao" ? "bg-amber-400"
  : s === "reservado" ? "bg-amber-300"
  : "bg-emerald-500";

const rubricaDot = (s: ReturnType<typeof statusRubrica>) =>
  s === "estourado" ? "bg-rose-500"
  : s === "critico" ? "bg-amber-500"
  : s === "atencao" ? "bg-amber-400"
  : s === "reservado" ? "bg-amber-300"
  : "bg-emerald-500";

const fmtK = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
};

function ProjetoCard({ p }: { p: Projeto }) {
  const a = projAgregado(p);
  const risco = projRisco(p);
  const dias = diasRestantes(p.prazo);

  // Alertas inline
  type AlertaInline = { tone: "rose" | "amber"; titulo: string; sub: string };
  const alertas: AlertaInline[] = [];
  p.rubricas.forEach(r => {
    const st = statusRubrica(r);
    if (st === "estourado") {
      alertas.push({
        tone: "rose",
        titulo: `${r.nome} estourou em ${Math.round(pct(r))}%`,
        sub: `${fmtBRL(r.gasto)} sobre ${fmtBRL(r.planejado)} planejado`,
      });
    } else if (st === "critico") {
      alertas.push({
        tone: "amber",
        titulo: `${r.nome} atingiu ${Math.round(pct(r))}%`,
        sub: `Resta ${fmtBRL(r.planejado - r.gasto)} antes do limite`,
      });
    }
  });

  if (p.status !== "em_execucao") {
    const label = p.status === "aguardando_resultado"
      ? "Aguardando resultado · pipeline futuro"
      : "Encerrado · sem novas execuções";
    return (
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold tracking-tight">{p.nome}</h4>
            <Badge variant="outline" className={cn("text-[10.5px] font-normal", projStatusBadge(p.status))}>{projStatusLabel(p.status)}</Badge>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-[11.5px] gap-1">Abrir <ArrowRight className="h-3 w-3" /></Button>
        </div>
        <div className="px-4 py-2 text-[11px] text-muted-foreground">{p.orgao}</div>
        <div className="px-4 py-6 text-center text-[11.5px] italic text-muted-foreground border-t bg-muted/20">{label}</div>
      </Card>
    );
  }

  // Contexto subtítulo
  const ativasNaoReservadas = p.rubricas.filter(r => !r.reservado);
  const piorRubrica = [...ativasNaoReservadas].sort((x, y) => pct(y) - pct(x))[0];
  const piorStatus = piorRubrica ? statusRubrica(piorRubrica) : null;
  const contextoCurto = piorStatus === "estourado"
    ? `${p.rubricas.filter(r => r.gasto > r.planejado).length} rubricas estouradas`
    : piorStatus === "critico"
    ? `${piorRubrica?.nome} crítico`
    : "execução saudável";

  const sugestaoTopo = p.pode_usar_para[0] ?? "";
  const accentBorder = risco === "alto" ? "border-t-rose-500" : risco === "medio" ? "border-t-amber-500" : "border-t-emerald-500";

  return (
    <Card className={cn("p-0 overflow-hidden border-t-2", accentBorder)}>
      {/* Cabeçalho */}
      <div className="px-4 pt-3 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold tracking-tight">{p.nome}</h4>
            <Badge variant="outline" className={cn("text-[10.5px] font-normal", projStatusBadge(p.status))}>{projStatusLabel(p.status)}</Badge>
            <Badge variant="outline" className={cn("text-[10.5px] font-normal capitalize", riscoBadge(risco))}>{risco}</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {p.orgao} · prazo {p.prazo}
            {dias !== null && <> · <b className="text-foreground/80 num">{dias}d restantes</b></>}
            {sugestaoTopo && <> · janela curta para gastar {sugestaoTopo}</>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Saldo livre</div>
            <div className="flex items-baseline gap-1 justify-end">
              <span className="text-[11px] text-muted-foreground">R$</span>
              <span className="text-2xl font-semibold tracking-tight num text-emerald-700 leading-none">{fmtBRLkurz(a.saldoLivre).num}</span>
              <span className="text-[11px] text-muted-foreground">{fmtBRLkurz(a.saldoLivre).suffix}</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-[11.5px] gap-1">Abrir <ArrowRight className="h-3 w-3" /></Button>
        </div>
      </div>

      {/* Execução do projeto */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Execução do projeto</span>
          <span className="text-[11px] text-muted-foreground">
            <b className="text-foreground num">{Math.round(a.exec)}%</b> · <span className="num">R$ {fmtK(a.gasto)}</span> de <span className="num">R$ {fmtK(a.planejado)}</span>
          </span>
        </div>
        <div className="flex h-2 w-full rounded-full overflow-hidden bg-muted gap-px">
          {p.rubricas.map(r => {
            const w = a.planejado > 0 ? (r.planejado / (a.planejado + a.reservado)) * 100 : 0;
            const st = statusRubrica(r);
            const fill = Math.min(100, pct(r));
            return (
              <div key={r.nome} className="relative bg-muted/60" style={{ width: `${w}%` }} title={`${r.nome} · ${Math.round(pct(r))}%`}>
                <div className={cn("h-full", rubricaSegColor(st))} style={{ width: `${fill}%` }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid de rubricas */}
      <div className="px-4 pb-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2.5">
        {p.rubricas.map(r => {
          const st = statusRubrica(r);
          const p100 = Math.min(100, pct(r));
          return (
            <div key={r.nome} className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", rubricaDot(st))} />
                <span className="text-[11.5px] truncate">{r.nome}</span>
              </div>
              <div className="text-[10.5px] text-muted-foreground num mt-0.5 ml-3">
                <b className={cn(
                  "text-foreground",
                  st === "estourado" ? "text-rose-600" : st === "critico" ? "text-amber-600" : ""
                )}>{Math.round(pct(r))}%</b>
                {" "}<span>{fmtK(r.gasto)}</span> / <span>{fmtK(r.planejado)}</span>
              </div>
              <div className="ml-3 mt-1 h-1 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full", rubricaSegColor(st))} style={{ width: `${p100}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Pode usar para */}
      {p.pode_usar_para.length > 0 && (
        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap border-t pt-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-600" /> Pode usar para
          </span>
          {p.pode_usar_para.map(t => (
            <Badge key={t} variant="outline" className="text-[10.5px] font-normal bg-emerald-500/5 text-emerald-700 border-emerald-500/30">
              <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> {t}
            </Badge>
          ))}
        </div>
      )}

      {/* Alertas inline */}
      {alertas.length > 0 && (
        <div className="border-t bg-muted/20">
          <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Alertas deste projeto · {alertas.length}
          </div>
          <div className="px-4 pb-3 flex flex-col gap-1.5">
            {alertas.map((al, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md border flex items-center gap-2.5 px-3 py-2",
                  al.tone === "rose" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5"
                )}
              >
                <div className={cn(
                  "h-6 w-6 rounded grid place-items-center shrink-0",
                  al.tone === "rose" ? "bg-rose-500/10 text-rose-600" : "bg-amber-500/10 text-amber-600"
                )}>
                  {al.tone === "rose" ? <ShieldAlert className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium leading-tight">{al.titulo}</div>
                  <div className="text-[10.5px] text-muted-foreground mt-0.5 num">{al.sub}</div>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-[11px]">Tratar</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}


/* ───────────────────────── Projetos (detalhe por rubrica) ───────────────────────── */

export { default as ProjetosTab } from "./projetos-aprovados/ProjetosTabDb";


/* ───────────────────────── Outras abas placeholder ───────────────────────── */

function Placeholder({ titulo, icone: Icon, descricao }: { titulo: string; icone: any; descricao: string }) {
  return (
    <Card className="p-8 flex flex-col items-center justify-center text-center gap-3 border-dashed">
      <div className="h-10 w-10 rounded-lg bg-muted grid place-items-center">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{titulo}</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-md">{descricao}</p>
      </div>
      <Badge variant="outline" className="text-[10px] font-normal">Em breve</Badge>
    </Card>
  );
}

export const IATab = () => <Placeholder titulo="Inteligência IA" icone={Brain} descricao="Histórico de consultas ao EDI, análises de elegibilidade e recomendações automáticas." />;
export const AlertasTab = () => <Placeholder titulo="Alertas" icone={BellRing} descricao="Central completa de alertas operacionais, regras e notificações personalizadas." />;
export const PrestacaoTab = () => <Placeholder titulo="Prestação" icone={FileCheck2} descricao="Gestão de documentos, notas fiscais e prestação de contas por edital." />;
export const ConfigTab = () => <Placeholder titulo="Configurações" icone={Settings} descricao="Parâmetros de rubricas, integrações fiscais e regras de elegibilidade." />;
