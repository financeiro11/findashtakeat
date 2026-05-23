import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
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

/* ───────────────────────── DADOS REAIS ───────────────────────── */

type Rubrica = {
  nome: string;
  planejado: number;
  gasto: number;
  reservado?: boolean;       // verba protegida (obrigatória)
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

const PROJETOS: Projeto[] = [
  {
    nome: "Tecnova III",
    orgao: "FINEP / FAPES",
    prazo: "11/2026",
    status: "em_execucao",
    pode_usar_para: ["Software & SaaS", "Cloud / Infraestrutura", "Consultoria técnica", "Serviços PJ"],
    rubricas: [
      { nome: "Equipamentos e Material Permanente", planejado: 180_000, gasto: 160_200, pendencias_nf: 1, sugestoes: ["Notebooks", "Servidores"] },
      { nome: "Software & Serviços", planejado: 240_000, gasto: 96_000, sugestoes: ["HubSpot", "AWS", "Vercel"] },
      { nome: "Serviços de Terceiros PJ", planejado: 180_000, gasto: 72_000, sugestoes: ["Consultoria técnica", "Agência"] },
      { nome: "Material de Consumo", planejado: 40_000, gasto: 22_000, pendencias_nf: 1 },
      { nome: "Diárias e Passagens", planejado: 30_000, gasto: 9_400 },
      { nome: "Reserva técnica obrigatória", planejado: 60_000, gasto: 0, reservado: true },
    ],
  },
  {
    nome: "BretA",
    orgao: "EMBRAPII",
    prazo: "08/2026",
    status: "em_execucao",
    pode_usar_para: ["Diárias", "Passagens limitadas", "Equipamentos remanescentes"],
    rubricas: [
      { nome: "Material de Consumo", planejado: 25_000, gasto: 42_250 },
      { nome: "Passagens", planejado: 18_000, gasto: 20_340 },
      { nome: "Diárias", planejado: 32_000, gasto: 12_800, sugestoes: ["Diárias técnicas", "Visitas em campo"] },
      { nome: "Equipamentos", planejado: 70_000, gasto: 41_500, sugestoes: ["Hardware de bancada"] },
      { nome: "Serviços PJ", planejado: 60_000, gasto: 38_400, pendencias_nf: 1 },
      { nome: "Reserva internacionalização", planejado: 35_200, gasto: 0, reservado: true },
    ],
  },
  {
    nome: "Clusters",
    orgao: "SEBRAE",
    prazo: "—",
    status: "aguardando_resultado",
    pode_usar_para: [],
    rubricas: [
      { nome: "Pleito global", planejado: 420_000, gasto: 0 },
    ],
  },
  {
    nome: "Parceria Startups",
    orgao: "FAPES",
    prazo: "encerrado",
    status: "encerrado",
    pode_usar_para: [],
    rubricas: [
      { nome: "Execução total", planejado: 180_000, gasto: 180_000 },
    ],
  },
];

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
  reservado: "bg-sky-500/10 text-sky-600 border-sky-500/30",
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

const projAgregado = (p: Projeto) => {
  const ativas = p.rubricas.filter(r => !r.reservado);
  const planejado = ativas.reduce((s, r) => s + r.planejado, 0);
  const gasto = ativas.reduce((s, r) => s + r.gasto, 0);
  const reservado = p.rubricas.filter(r => r.reservado).reduce((s, r) => s + r.planejado, 0);
  const saldoBruto = planejado - gasto;
  const comprometido = ativas.filter(r => r.gasto > r.planejado).reduce((s, r) => s + (r.gasto - r.planejado), 0);
  const saldoLivre = Math.max(0, saldoBruto - comprometido);
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 -mt-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">Projetos Aprovados</span>
          <span className="text-[10px] uppercase tracking-wider text-rose-600 font-semibold bg-rose-500/10 px-1.5 py-0.5 rounded">Execução</span>
        </div>
        <div className="text-xs text-muted-foreground ml-1">/ {current?.label ?? ""}</div>
      </div>

      <nav className="flex items-center gap-0 border-b -mt-1 overflow-x-auto">
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
  }, []);

  /* ─── KPIs ─── */
  const KPIS = [
    { label: "Saldo disponível total", value: fmtBRL(metricas.saldoBruto), sub: `${metricas.ativos.length} projetos ativos`,
      trend: [10,18,22,24,28,32,38,42,48,52], accent: "hsl(var(--primary))" },
    { label: "Saldo operacional livre", value: fmtBRL(metricas.saldoLivre), sub: "descontados reservados e comprometidos",
      trend: [12,15,18,22,26,30,34,36,40,42], accent: "hsl(152 60% 40%)" },
    { label: "Valor já executado", value: fmtBRL(metricas.gasto), sub: "soma de todas as rubricas",
      trend: [4,8,12,18,24,30,38,46,54,62], accent: "hsl(212 80% 45%)" },
    { label: "Verba reservada obrigatória", value: fmtBRL(metricas.reservado), sub: "proteção contratual",
      trend: [2,2,3,3,4,4,5,5,5,5], accent: "hsl(212 80% 45%)" },
    { label: "Rubricas críticas", value: String(metricas.rubricasCriticas.length), sub: "≥ 85% executado",
      trend: [0,0,1,1,1,1,1,2,2,2], accent: "hsl(38 92% 48%)" },
    { label: "Rubricas estouradas", value: String(metricas.rubricasEstouradas.length), sub: "acima do planejado",
      trend: [0,0,0,1,1,1,2,2,2,2], accent: "hsl(0 78% 47%)" },
    { label: "Pendências de NF", value: String(metricas.pendNF), sub: "lançamentos sem documento",
      trend: [1,1,2,2,3,3,3,3,3,3], accent: "hsl(0 78% 47%)" },
    { label: "Aguardando resultado", value: String(metricas.aguardando.length), sub: "pipeline futuro",
      trend: [1,1,1,1,1,1,1,1,1,1], accent: "hsl(212 80% 45%)" },
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
        nivel: "Info", icon: Lock,
        titulo: `${fmtBRL(metricas.reservado)} estão reservados obrigatoriamente`,
        sub: "Não considerar no saldo operacional",
        color: "text-sky-600 bg-sky-500/10 border-sky-500/30",
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
  }, [metricas]);

  /* ─── Resposta contextual IA ─── */
  const respostaIA = useMemo(() => {
    const breta = PROJETOS.find(p => p.nome === "BretA")!;
    const tec = PROJETOS.find(p => p.nome === "Tecnova III")!;
    const bMatCons = breta.rubricas.find(r => /Material de Consumo/i.test(r.nome))!;
    const bPass = breta.rubricas.find(r => /Passagens/i.test(r.nome))!;
    const tEq = tec.rubricas.find(r => /Equipamentos/i.test(r.nome))!;
    return { bMatCons, bPass, tEq, livre: metricas.saldoLivre, pendNF: metricas.pendNF };
  }, [metricas]);

  return (
    <div className="flex flex-col gap-4">
      {/* BLOCO 1 — EDI */}
      <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 via-background to-rose-500/5">
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[radial-gradient(circle_at_top_right,hsl(var(--primary))_0,transparent_60%)]" />
        <div className="relative p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-rose-600 grid place-items-center text-primary-foreground shadow-sm shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold tracking-tight">EDI · Consultor IA de Execução</h2>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  IA ativa
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  contexto: {PROJETOS.length} projetos · {PROJETOS.reduce((s,p)=>s+p.rubricas.length,0)} rubricas
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pergunte sobre saldos, elegibilidade, rubricas, fornecedores e melhor uso da verba aprovada.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Brain className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={pergunta}
                onChange={e => setPergunta(e.target.value)}
                onKeyDown={e => e.key === "Enter" && setMostrarResposta(true)}
                placeholder="Ex: posso pagar HubSpot pelo Tecnova III?"
                className="pl-9 h-10 text-[13px] bg-background"
              />
            </div>
            <Button onClick={() => setMostrarResposta(true)} className="h-10 gap-1.5">
              <Send className="h-3.5 w-3.5" /> Consultar EDI
            </Button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground mr-1">Sugestões:</span>
            {SUGESTOES.map(s => (
              <button
                key={s}
                onClick={() => { setPergunta(s); setMostrarResposta(true); }}
                className="text-[11.5px] px-2 py-1 rounded-full border border-border bg-background/60 hover:border-primary/40 hover:text-primary transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          {mostrarResposta && (
            <div className="rounded-lg border border-primary/20 bg-background/80 backdrop-blur p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-primary">Resposta do EDI</span>
              </div>
              <p className="text-[13px] leading-relaxed">
                Identificamos <span className="font-semibold text-rose-600">risco operacional no projeto BretA</span>:
              </p>
              <ul className="text-[12.5px] space-y-1 ml-1">
                <li className="flex items-start gap-2">
                  <TrendingDown className="h-3 w-3 text-rose-600 mt-1 shrink-0" />
                  <span><b>{respostaIA.bMatCons.nome}</b> está <b className="num">{Math.round(pct(respostaIA.bMatCons))}%</b> executado</span>
                </li>
                <li className="flex items-start gap-2">
                  <TrendingDown className="h-3 w-3 text-rose-600 mt-1 shrink-0" />
                  <span><b>{respostaIA.bPass.nome}</b> atingiu <b className="num">{Math.round(pct(respostaIA.bPass))}%</b></span>
                </li>
              </ul>
              <p className="text-[13px] leading-relaxed">No <b>Tecnova III</b>:</p>
              <ul className="text-[12.5px] space-y-1 ml-1">
                <li className="flex items-start gap-2">
                  <AlertTriangle className="h-3 w-3 text-amber-600 mt-1 shrink-0" />
                  <span><b>{respostaIA.tEq.nome}</b> possui apenas <b className="num">{Math.round(100 - pct(respostaIA.tEq))}%</b> disponível</span>
                </li>
                {respostaIA.pendNF > 0 && (
                  <li className="flex items-start gap-2">
                    <FileWarning className="h-3 w-3 text-amber-600 mt-1 shrink-0" />
                    <span>Existem <b>{respostaIA.pendNF} lançamentos pendentes sem NF</b></span>
                  </li>
                )}
              </ul>
              <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 mt-1">
                <div className="text-[10.5px] uppercase tracking-wider text-emerald-700 font-semibold">Saldo operacional livre estimado</div>
                <div className="text-base font-semibold num text-emerald-700">{fmtBRL(respostaIA.livre)}</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* BLOCO 2 — KPIs executivos */}
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap divide-x divide-border/50">
          {KPIS.map(k => (
            <div key={k.label} className="flex-1 min-w-[180px] px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{k.label}</div>
              <div className="flex items-end justify-between mt-1.5 gap-2">
                <div>
                  <div className="text-xl font-semibold tracking-tight num">{k.value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</div>
                </div>
                <div className="opacity-70">
                  <Sparkline data={k.trend} color={k.accent} width={56} height={24} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* BLOCO 3 — Saldo realmente utilizável (destaque) */}
      <Card className="p-0 overflow-hidden border-emerald-500/30">
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_2fr]">
          <div className="p-5 bg-gradient-to-br from-emerald-500/10 via-background to-transparent border-r border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="h-3.5 w-3.5 text-emerald-700" />
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-emerald-700">Saldo realmente utilizável</span>
            </div>
            <div className="text-3xl font-semibold tracking-tight num text-emerald-700">{fmtBRL(metricas.saldoLivre)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">descontados reservados e rubricas comprometidas</div>
          </div>
          <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo bruto</div>
              <div className="text-sm font-semibold num mt-1">{fmtBRL(metricas.saldoBruto)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" /> Reservado</div>
              <div className="text-sm font-semibold num mt-1 text-sky-700">- {fmtBRL(metricas.reservado)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Comprometido (estouros)</div>
              <div className="text-sm font-semibold num mt-1 text-rose-600">
                - {fmtBRL(metricas.rubricasEstouradas.reduce((s, x) => s + (x.rubrica.gasto - x.rubrica.planejado), 0))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">= Operacional livre</div>
              <div className="text-sm font-semibold num mt-1 text-emerald-700">{fmtBRL(metricas.saldoLivre)}</div>
            </div>
          </div>
        </div>
      </Card>

      {/* BLOCO 4 — Projetos prioritários + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-3.5 w-3.5 text-primary" />
              <h3 className="text-[13px] font-semibold tracking-tight">Projetos prioritários</h3>
              <Badge variant="outline" className="text-[10px] font-normal">{PROJETOS.length}</Badge>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-[11.5px] gap-1">
              Ver todos <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <th className="px-4 py-2 font-medium">Projeto</th>
                  <th className="px-2 py-2 font-medium">Órgão</th>
                  <th className="px-2 py-2 font-medium text-right">Saldo livre</th>
                  <th className="px-2 py-2 font-medium">Execução</th>
                  <th className="px-2 py-2 font-medium">Prazo</th>
                  <th className="px-2 py-2 font-medium">Risco</th>
                  <th className="px-2 py-2 font-medium">Melhor uso sugerido</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {PROJETOS.map(p => {
                  const a = projAgregado(p);
                  const risco = projRisco(p);
                  return (
                    <tr key={p.nome} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium">{p.nome}</td>
                      <td className="px-2 py-2.5 text-muted-foreground">{p.orgao}</td>
                      <td className="px-2 py-2.5 text-right num font-semibold">
                        {p.status === "em_execucao" ? fmtBRL(a.saldoLivre) : "—"}
                      </td>
                      <td className="px-2 py-2.5">
                        {p.status === "em_execucao" ? (
                          <div className="flex items-center gap-2 min-w-[110px]">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  a.exec >= 100 ? "bg-rose-500" : a.exec >= 85 ? "bg-amber-500" : a.exec >= 50 ? "bg-sky-500" : "bg-emerald-500"
                                )}
                                style={{ width: `${Math.min(100, a.exec)}%` }}
                              />
                            </div>
                            <span className="num text-[11px] text-muted-foreground w-9 text-right">{Math.round(a.exec)}%</span>
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-2.5 num text-muted-foreground">{p.prazo}</td>
                      <td className="px-2 py-2.5">
                        <Badge variant="outline" className={cn("text-[10.5px] font-normal capitalize", riscoBadge(risco))}>{risco}</Badge>
                      </td>
                      <td className="px-2 py-2.5 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="h-3 w-3 text-primary/70" />
                          {p.pode_usar_para[0] ?? (p.status === "encerrado" ? "Encerrado" : "Aguardando")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={cn("text-[10.5px] font-normal", projStatusBadge(p.status))}>
                          {projStatusLabel(p.status)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden h-fit">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <BellRing className="h-3.5 w-3.5 text-rose-600" />
              <h3 className="text-[13px] font-semibold tracking-tight">Alertas inteligentes</h3>
              <Badge variant="outline" className="text-[10px] font-normal">{ALERTAS.length}</Badge>
            </div>
          </div>
          <div className="divide-y divide-border/50 max-h-[520px] overflow-y-auto">
            {ALERTAS.map((a, i) => {
              const Icon = a.icon;
              return (
                <div key={i} className="px-4 py-3 flex items-start gap-2.5 hover:bg-muted/30 transition-colors group">
                  <div className={cn("h-7 w-7 rounded-md grid place-items-center border shrink-0", a.color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium leading-tight">{a.titulo}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{a.sub}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{a.nivel}</span>
                      <button className="text-[10.5px] uppercase tracking-wider font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5">
                        Resolver <ArrowRight className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* BLOCO 5 — Pode usar para */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-3.5 w-3.5 text-amber-600" />
            <h3 className="text-[13px] font-semibold tracking-tight">Pode usar para</h3>
            <span className="text-[11px] text-muted-foreground">decisão rápida por projeto</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                <th className="px-4 py-2 font-medium">Projeto</th>
                <th className="px-2 py-2 font-medium">Pode usar para</th>
                <th className="px-2 py-2 font-medium">Rubricas disponíveis</th>
                <th className="px-2 py-2 font-medium">Rubricas críticas</th>
                <th className="px-2 py-2 font-medium">Rubricas estouradas</th>
                <th className="px-4 py-2 font-medium text-right">Saldo livre</th>
              </tr>
            </thead>
            <tbody>
              {PROJETOS.map(p => {
                const a = projAgregado(p);
                const disp = p.rubricas.filter(r => !r.reservado && statusRubrica(r) !== "estourado" && statusRubrica(r) !== "critico");
                const crit = p.rubricas.filter(r => statusRubrica(r) === "critico");
                const est = p.rubricas.filter(r => statusRubrica(r) === "estourado");
                if (p.status === "encerrado") {
                  return (
                    <tr key={p.nome} className="border-t border-border/50">
                      <td className="px-4 py-2.5 font-medium">{p.nome}</td>
                      <td className="px-2 py-2.5 text-muted-foreground italic" colSpan={4}>Encerrado · sem novas execuções</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                    </tr>
                  );
                }
                if (p.status === "aguardando_resultado") {
                  return (
                    <tr key={p.nome} className="border-t border-border/50">
                      <td className="px-4 py-2.5 font-medium">{p.nome}</td>
                      <td className="px-2 py-2.5 text-muted-foreground italic" colSpan={4}>Aguardando resultado · pipeline futuro</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                    </tr>
                  );
                }
                return (
                  <tr key={p.nome} className="border-t border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium align-top">{p.nome}</td>
                    <td className="px-2 py-2.5 align-top">
                      <div className="flex items-center gap-1 flex-wrap">
                        {p.pode_usar_para.map(t => (
                          <Badge key={t} variant="outline" className="text-[10.5px] font-normal bg-emerald-500/5 text-emerald-700 border-emerald-500/30">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> {t}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      <div className="flex items-center gap-1 flex-wrap">
                        {disp.length === 0 ? <span className="text-muted-foreground">—</span> :
                          disp.slice(0, 3).map(r => (
                            <span key={r.nome} className="text-[11px] text-muted-foreground">{r.nome}{disp.indexOf(r) < Math.min(disp.length,3)-1 ? "," : ""}</span>
                          ))}
                        {disp.length > 3 && <span className="text-[11px] text-muted-foreground">+{disp.length-3}</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      {crit.length === 0 ? <span className="text-muted-foreground">—</span> :
                        crit.map(r => (
                          <Badge key={r.nome} variant="outline" className={cn("text-[10.5px] font-normal mr-1", RUBRICA_BADGE.critico)}>
                            {r.nome.split(" ")[0]} {Math.round(pct(r))}%
                          </Badge>
                        ))}
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      {est.length === 0 ? <span className="text-muted-foreground">—</span> :
                        est.map(r => (
                          <Badge key={r.nome} variant="outline" className={cn("text-[10.5px] font-normal mr-1", RUBRICA_BADGE.estourado)}>
                            {r.nome.split(" ")[0]} {Math.round(pct(r))}%
                          </Badge>
                        ))}
                    </td>
                    <td className="px-4 py-2.5 text-right num font-semibold align-top">{fmtBRL(a.saldoLivre)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────── Projetos (detalhe por rubrica) ───────────────────────── */

export function ProjetosTab() {
  return (
    <div className="flex flex-col gap-4">
      {PROJETOS.map(p => {
        const a = projAgregado(p);
        const risco = projRisco(p);
        return (
          <Card key={p.nome} className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold tracking-tight">{p.nome}</h3>
                <span className="text-[11px] text-muted-foreground">· {p.orgao}</span>
                <Badge variant="outline" className={cn("text-[10.5px] font-normal", projStatusBadge(p.status))}>{projStatusLabel(p.status)}</Badge>
                {p.status === "em_execucao" && (
                  <Badge variant="outline" className={cn("text-[10.5px] font-normal capitalize", riscoBadge(risco))}>risco {risco}</Badge>
                )}
              </div>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span>Planejado: <b className="num text-foreground">{fmtBRL(a.planejado)}</b></span>
                <span>Executado: <b className="num text-foreground">{fmtBRL(a.gasto)}</b></span>
                <span>Saldo livre: <b className="num text-emerald-700">{fmtBRL(a.saldoLivre)}</b></span>
                {a.reservado > 0 && <span>Reservado: <b className="num text-sky-700">{fmtBRL(a.reservado)}</b></span>}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="px-4 py-2 font-medium">Rubrica</th>
                    <th className="px-2 py-2 font-medium text-right">Planejado</th>
                    <th className="px-2 py-2 font-medium text-right">Gasto</th>
                    <th className="px-2 py-2 font-medium text-right">Saldo</th>
                    <th className="px-2 py-2 font-medium">Execução</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Sugestões</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rubricas.map(r => {
                    const st = statusRubrica(r);
                    const p2 = pct(r);
                    return (
                      <tr key={r.nome} className="border-t border-border/50 hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{r.nome}</div>
                          {(r.pendencias_nf ?? 0) > 0 && (
                            <div className="text-[10.5px] text-amber-600 mt-0.5 inline-flex items-center gap-1">
                              <FileWarning className="h-3 w-3" /> {r.pendencias_nf} sem NF
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right num">{fmtBRL(r.planejado)}</td>
                        <td className="px-2 py-2.5 text-right num">{fmtBRL(r.gasto)}</td>
                        <td className={cn("px-2 py-2.5 text-right num font-semibold", r.planejado - r.gasto < 0 && "text-rose-600")}>
                          {fmtBRL(r.planejado - r.gasto)}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2 min-w-[110px]">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  st === "estourado" ? "bg-rose-500" : st === "critico" ? "bg-orange-500" : st === "atencao" ? "bg-amber-500" : st === "reservado" ? "bg-sky-500" : "bg-emerald-500"
                                )}
                                style={{ width: `${Math.min(100, p2)}%` }}
                              />
                            </div>
                            <span className="num text-[11px] text-muted-foreground w-10 text-right">{Math.round(p2)}%</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <Badge variant="outline" className={cn("text-[10.5px] font-normal", RUBRICA_BADGE[st])}>{RUBRICA_LABEL[st]}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {r.sugestoes?.length ? r.sugestoes.join(" · ") : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

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
