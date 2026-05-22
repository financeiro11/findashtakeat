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
  Sparkles, Send, ArrowRight, AlertTriangle, Clock, Wallet, TrendingUp,
  ShieldAlert, CalendarClock, CircleDot, Zap,
} from "lucide-react";
import { fmtBRL } from "./types";

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

/* ───────────────────────── Executivo (default tab) ───────────────────────── */

const SUGESTOES = [
  "O que conseguimos pagar este mês?",
  "Qual edital ainda tem verba para software?",
  "Posso pagar AWS pelo FINEP EDI?",
  "Quais rubricas estão críticas?",
  "Quais editais vencem em 60 dias?",
];

const RESPOSTA_SIM = {
  total: 184200,
  itens: [
    { label: "Desenvolvimento", valor: 82000 },
    { label: "Infraestrutura Cloud", valor: 56000 },
    { label: "Serviços Terceiros PJ", valor: 46200 },
  ],
  projetos: ["FINEP IA Contábil", "EMBRAPII Analytics", "FAPES Automação Operacional"],
};

const KPIS = [
  { label: "Saldo disponível total", value: "R$ 1,24 mi", sub: "5 projetos ativos", trend: [40,55,52,68,72,80,84,88,90,92], accent: "hsl(var(--primary))" },
  { label: "Verba disponível este mês", value: "R$ 184,2 mil", sub: "execução imediata", trend: [10,18,22,30,28,40,52,60,72,80], accent: "hsl(152 60% 40%)" },
  { label: "Projetos em risco", value: "3", sub: "baixa execução", trend: [1,2,2,3,3,2,3,4,3,3], accent: "hsl(0 78% 47%)" },
  { label: "Próximos vencimentos", value: "2", sub: "≤ 60 dias", trend: [0,0,1,1,1,2,2,2,2,2], accent: "hsl(38 92% 48%)" },
  { label: "Execução média", value: "62%", sub: "+4pp vs mês anterior", trend: [40,44,48,50,52,55,58,60,61,62], accent: "hsl(212 80% 45%)" },
  { label: "Rubricas críticas", value: "2", sub: "acima de 85%", trend: [0,1,1,1,2,2,2,2,2,2], accent: "hsl(0 78% 47%)" },
];

const PROJETOS = [
  { nome: "FINEP IA Contábil", orgao: "FINEP", saldo: 620000, exec: 48, prazo: "12/2026", risco: "Baixo", uso: "Desenvolvimento IA", status: "Em execução" },
  { nome: "EMBRAPII Analytics", orgao: "EMBRAPII", saldo: 412000, exec: 33, prazo: "08/2026", risco: "Médio", uso: "Infraestrutura Cloud", status: "Em execução" },
  { nome: "FAPES Automação Operacional", orgao: "FAPES", saldo: 184500, exec: 37, prazo: "07/2026", risco: "Alto", uso: "Serviços PJ", status: "Atenção" },
  { nome: "BNDES Capacitação", orgao: "BNDES", saldo: 96000, exec: 71, prazo: "10/2026", risco: "Baixo", uso: "Pesquisa aplicada", status: "Em execução" },
  { nome: "SEBRAE Inova", orgao: "SEBRAE", saldo: 42500, exec: 88, prazo: "06/2026", risco: "Baixo", uso: "Equipamentos", status: "Finalizando" },
];

const ALERTAS = [
  { nivel: "Alto", icon: ShieldAlert, titulo: "FAPES encerra em 43 dias", sub: "37% não executado · R$ 116k em risco", data: "hoje", color: "text-rose-600 bg-rose-500/10 border-rose-500/30" },
  { nivel: "Médio", icon: AlertTriangle, titulo: "Rubrica Equipamentos em 91%", sub: "Projeto EMBRAPII · realocar antes do limite", data: "1d", color: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
  { nivel: "Médio", icon: Clock, titulo: "Nota fiscal pendente há 12 dias", sub: "Fornecedor: TechCloud · FINEP IA", data: "2d", color: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
  { nivel: "Baixo", icon: CalendarClock, titulo: "EMBRAPII sem movimentação há 18 dias", sub: "Revisar plano de execução", data: "3d", color: "text-sky-600 bg-sky-500/10 border-sky-500/30" },
];

const riscoBadge = (r: string) =>
  r === "Alto" ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
  : r === "Médio" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
  : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";

const statusBadge = (s: string) =>
  s === "Atenção" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
  : s === "Finalizando" ? "bg-sky-500/10 text-sky-600 border-sky-500/30"
  : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";

export function ExecutivoTab() {
  const [pergunta, setPergunta] = useState("");
  const [resposta, setResposta] = useState<typeof RESPOSTA_SIM | null>(null);

  const consultar = (q?: string) => {
    if (q) setPergunta(q);
    setResposta(RESPOSTA_SIM);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* BLOCO 1 — EDI Assistente IA */}
      <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 via-background to-rose-500/5">
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[radial-gradient(circle_at_top_right,hsl(var(--primary))_0,transparent_60%)]" />
        <div className="relative p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-rose-600 grid place-items-center text-primary-foreground shadow-sm shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold tracking-tight">EDI · Especialista em Editais</h2>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  IA ativa
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">contexto: 5 projetos · 23 rubricas</span>
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
                onKeyDown={e => e.key === "Enter" && consultar()}
                placeholder="Ex: posso pagar AWS pelo FINEP EDI?"
                className="pl-9 h-10 text-[13px] bg-background"
              />
            </div>
            <Button onClick={() => consultar()} className="h-10 gap-1.5">
              <Send className="h-3.5 w-3.5" /> Consultar EDI
            </Button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground mr-1">Sugestões:</span>
            {SUGESTOES.map(s => (
              <button
                key={s}
                onClick={() => consultar(s)}
                className="text-[11.5px] px-2 py-1 rounded-full border border-border bg-background/60 hover:border-primary/40 hover:text-primary transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          {resposta && (
            <div className="rounded-lg border border-primary/20 bg-background/80 backdrop-blur p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-primary">Resposta do EDI</span>
              </div>
              <p className="text-[13px] leading-relaxed">
                Identificamos <span className="num font-semibold text-foreground">{fmtBRL(resposta.total)}</span> disponíveis para utilização imediata:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {resposta.itens.map(i => (
                  <div key={i.label} className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                    <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{i.label}</div>
                    <div className="text-sm font-semibold num">{fmtBRL(i.valor)}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Projetos prioritários</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {resposta.projetos.map(p => (
                    <Badge key={p} variant="outline" className="font-normal text-[11.5px] gap-1">
                      <CircleDot className="h-2.5 w-2.5 text-primary" /> {p}
                    </Badge>
                  ))}
                </div>
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

      {/* BLOCO 3 + 4 — Projetos prioritários + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
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
                {PROJETOS.map(p => (
                  <tr key={p.nome} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{p.nome}</td>
                    <td className="px-2 py-2.5 text-muted-foreground">{p.orgao}</td>
                    <td className="px-2 py-2.5 text-right num font-semibold">{fmtBRL(p.saldo)}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2 min-w-[110px]">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              p.exec >= 70 ? "bg-emerald-500" : p.exec >= 40 ? "bg-amber-500" : "bg-rose-500"
                            )}
                            style={{ width: `${p.exec}%` }}
                          />
                        </div>
                        <span className="num text-[11px] text-muted-foreground w-8 text-right">{p.exec}%</span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 num text-muted-foreground">{p.prazo}</td>
                    <td className="px-2 py-2.5">
                      <Badge variant="outline" className={cn("text-[10.5px] font-normal", riscoBadge(p.risco))}>{p.risco}</Badge>
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-primary/70" />
                        {p.uso}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={cn("text-[10.5px] font-normal", statusBadge(p.status))}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
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
          <div className="divide-y divide-border/50">
            {ALERTAS.map((a, i) => {
              const Icon = a.icon;
              return (
                <div key={i} className="px-4 py-3 flex items-start gap-2.5 hover:bg-muted/30 transition-colors group">
                  <div className={cn("h-7 w-7 rounded-md grid place-items-center border shrink-0", a.color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-medium leading-tight">{a.titulo}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{a.sub}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{a.data}</span>
                      <button className="text-[10.5px] uppercase tracking-wider font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5">
                        Resolver <ArrowRight className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-2.5 border-t bg-muted/20">
            <Button variant="ghost" size="sm" className="w-full h-7 text-[11.5px] gap-1 justify-center">
              Ver todos os alertas <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </Card>
      </div>

      {/* Footer hint */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground py-1">
        <TrendingUp className="h-3 w-3" />
        <span>Visão executiva consolidada · atualizado em tempo real pelo EDI</span>
      </div>
    </div>
  );
}

/* ───────────────────────── Placeholder tabs ───────────────────────── */

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

export const ProjetosTab = () => <Placeholder titulo="Projetos" icone={FolderKanban} descricao="Visão detalhada por projeto aprovado, rubricas, saldos e cronograma de execução." />;
export const IATab = () => <Placeholder titulo="Inteligência IA" icone={Brain} descricao="Histórico de consultas ao EDI, análises de elegibilidade e recomendações automáticas." />;
export const AlertasTab = () => <Placeholder titulo="Alertas" icone={BellRing} descricao="Central completa de alertas operacionais, regras e notificações personalizadas." />;
export const PrestacaoTab = () => <Placeholder titulo="Prestação" icone={FileCheck2} descricao="Gestão de documentos, notas fiscais e prestação de contas por edital." />;
export const ConfigTab = () => <Placeholder titulo="Configurações" icone={Settings} descricao="Parâmetros de rubricas, integrações fiscais e regras de elegibilidade." />;
