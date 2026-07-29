import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { normalize } from "@/lib/normalize";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AutomacoesCatalogo from "@/pages/AutomacoesCatalogo";
import {
  Loader2, Plus, Pencil, Trash2, X, Users, UserPlus, Network, ListChecks,
  CalendarDays, Bot, Target, Zap, Clock, ArrowRight, Layers, ChevronDown, ShieldCheck,
  Download, Copy, ArrowRightLeft, Check, Lock, Wrench, Waypoints, Calculator, Landmark, Rocket, Search,
} from "lucide-react";

// ============================================================================
// Time Financeiro · Visão do Time — estrutura do time (organograma, funções,
// vagas & expansão), rituais mensais e maturidade em IA. Fonte da verdade:
// tabelas `time_cargos` e `time_passos` (seed importado da planilha da
// diretoria, que foi abandonada — tudo é editado aqui).
// ============================================================================

const sb = supabase as any;

/* ------------------------------ tipos ------------------------------ */
type Status = "efetivo" | "vaga_aberta" | "entrevista" | "contratado" | "planejado";
// Item de atribuição: texto simples OU objeto com transferência pendente (Request:
// ao "mover" para um cargo ainda não efetivo, o item continua na origem sinalizado
// e só some quando o destino vira efetivo).
type AtribItem = string | { texto: string; transfPara?: string; transfParaNome?: string };
type AtribGrupo = { titulo: string; itens: AtribItem[] };
type Cargo = {
  id: string; titulo: string; pessoa: string | null; senioridade: string | null;
  status: Status; acumulo: boolean; prioridade: string | null; custo_mensal: number | null;
  alvo: string | null; parent_id: string | null; atribuicoes: AtribGrupo[]; ordem: number; ano: number;
  chave: string; desacoplado: boolean;
};
const ANOS = [2026, 2027, 2028];

// Texto e flag de transferência de um item.
const itxt = (it: AtribItem): string => (typeof it === "string" ? it : it?.texto ?? "");
const itransf = (it: AtribItem): { paraId: string; paraNome?: string } | null =>
  typeof it === "object" && it && it.transfPara ? { paraId: it.transfPara, paraNome: it.transfParaNome } : null;

// Linha de item (leitura) — mostra a sinalização quando o item está a caminho de outro cargo.
function ItemLinha({ it }: { it: AtribItem }) {
  const t = itransf(it);
  return (
    <li className={cn("list-disc text-[12px] leading-relaxed", t ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
      {itxt(it)}
      {t && (
        <span className="ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap rounded bg-amber-500/15 px-1 text-[9.5px] font-semibold text-amber-600 dark:text-amber-400" title={`Vai para "${t.paraNome ?? "outro cargo"}" quando esse cargo for efetivado`}>
          <ArrowRightLeft className="h-2.5 w-2.5" /> {t.paraNome ?? "transferência"}
        </span>
      )}
    </li>
  );
}
type Passo = { id: string; texto: string; done: boolean; ordem: number };
type Ritual = { id: string; titulo: string; tipo: string | null; periodicidade: string | null; descricao: string | null; pauta: string[]; ordem: number };

/* ------------------------------ metadados ------------------------------ */
const STATUS_META: Record<Status, { label: string; badge: string; borda: string }> = {
  efetivo:     { label: "EFETIVO",       badge: "bg-success/10 text-success",              borda: "border-l-[3px] border-l-primary" },
  vaga_aberta: { label: "VAGA ABERTA",   badge: "bg-primary/10 text-primary",              borda: "border-primary" },
  entrevista:  { label: "EM ENTREVISTA", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400", borda: "border-amber-500/60" },
  contratado:  { label: "CONTRATADO",    badge: "bg-success/15 text-success",              borda: "border-success/60" },
  planejado:   { label: "PLANEJADO",     badge: "bg-muted text-muted-foreground",          borda: "border-dashed" },
};

const fmtBRL0 = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

// Cor do badge de tipo de ritual/reunião.
function tipoRitualBadge(tipo?: string | null): string {
  const t = (tipo ?? "").toLowerCase();
  if (t.includes("estrat")) return "bg-violet-500/15 text-violet-600 dark:text-violet-400";
  if (t.includes("tátic") || t.includes("tatic")) return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  if (t.includes("operac")) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (t.includes("cad") || t.includes("fech") || t.includes("mensal")) return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

// ---- IA & Automação: pirâmide de maturidade + automações em produção ----
const NIVEL_ATUAL = 3;
const NIVEIS = [
  { n: 1, nome: "Fundação Operacional", bullets: ["Caixa, pagamentos e conciliação com rotinas automatizadas", "Relatórios operacionais recorrentes (posição e cortes de caixa)", "Consolidações automáticas no Omie (comissões, categorias, faturas)"] },
  { n: 2, nome: "Controles & Auditoria", bullets: ["Cruzamentos automáticos (cartão × notas fiscais)", "Playbooks de fluxos operacionais (n8n)", "Trilhas de verificação contínuas sobre os lançamentos"] },
  { n: 3, nome: "Relatórios, Insights & FP&A", bullets: ["DRE e DFC — real vs. orçado", "Orçamento por área e métricas SaaS (MRR, CAC/LTV, NRR)", "Análise de churn real", "Relatório gerencial para diretoria"] },
  { n: 4, nome: "Projeções & Cenários", bullets: ["Projeção de caixa (45 dias)", "Cenários e simulações orçamentárias", "Alertas preditivos de desvio"] },
  { n: 5, nome: "Financeiro Autônomo", bullets: ["Agentes executando rotinas ponta a ponta", "Decisões assistidas com aprovação humana", "Fechamento contínuo (continuous close)"] },
];
// Cores da pirâmide (base → topo), espelhando o design aprovado.
const NIVEL_COR = ["hsl(0 62% 20%)", "hsl(0 65% 31%)", "hsl(0 84% 51%)", "hsl(0 70% 68%)", "hsl(0 0% 12%)"];

// ---- Padrão de Mercado (referência: quem responde por quê no financeiro) ----
// Pirâmide de obrigações macro (base → topo) + estrutura padrão em 3 pilares.
const MACRO_COR = ["hsl(211 56% 24%)", "hsl(206 74% 42%)", "hsl(202 74% 66%)"]; // CFO, Controller, dia a dia
const OBRIGACOES_MACRO = [
  {
    eyebrow: "ESTRATÉGIA", role: "CFO",
    subtitle: "Define a direção financeira e responde à diretoria e ao conselho.",
    bullets: ["Planejamento estratégico", "Relacionamento com investidores", "Validação do orçamento", "Captação de recursos", "Acompanhamento de KPIs", "Fusões e aquisições (M&A)"],
    footer: "Liderado pelo CFO",
  },
  {
    eyebrow: "REPORTAR", role: "CONTROLLER",
    subtitle: "Traduz a operação em números confiáveis e cobra os setores.",
    bullets: ["Relatórios estratégicos", "Análise detalhada", "Gestão do orçamento", "Gestão de processos", "Supervisão dos setores", "Controles internos"],
    footer: "Liderado pelo Controller",
  },
  {
    eyebrow: "DIA A DIA", role: "CONTABILIDADE, TESOURARIA, FP&A",
    subtitle: "Executa a operação financeira do dia a dia.",
    bullets: ["Gestão diária e fechamento contábil", "Gerenciamento de despesas", "Execução do orçamento", "Faturamento", "Análise de tributos", "Gestão de caixa"],
    footer: "Liderado pelo Controller",
  },
];

const PILARES: { nome: string; grupos: { titulo: string; itens: string[] }[] }[] = [
  {
    nome: "Contabilidade",
    grupos: [
      { titulo: "Departamento Pessoal", itens: ["Contabilização de folha e encargos", "Suporte a auditorias e fiscalizações"] },
      { titulo: "Contábil", itens: ["CPC/IFRS, conciliações, provisões e reconciliações", "Imobilizado e depreciação"] },
      { titulo: "Fiscal / Tributário", itens: ["Apurações (ISS, ICMS, IPI, PIS/COFINS etc.)", "Obrigações acessórias (SPED, ECD/EFD, DCTF, PER/DCOMP)", "Planejamento e suporte a FP&A / Tesouraria"] },
      { titulo: "Governança Societária", itens: ["Livros societários, atas, junta comercial e procurações", "Suporte a auditoria externa"] },
    ],
  },
  {
    nome: "Controladoria e Planejamento",
    grupos: [
      { titulo: "Orçamento", itens: ["Orçamento anual (OBZ / colaborativo)", "Rolling forecast (mensal / trimestral)"] },
      { titulo: "Análise de Desempenho", itens: ["DRE gerencial, margem por produto/cliente", "Dashboards e relato à diretoria/conselho", "KPIs"] },
      { titulo: "Políticas & Controles Internos", itens: ["Rateios e centros de custo", "Análises de custo", "Controle de SaaS", "Controle de processos e automações"] },
    ],
  },
  {
    nome: "Tesouraria",
    grupos: [
      { titulo: "Gestão de Fluxo de Caixa", itens: ["Conciliação diária, posição de caixa e aplicações de curto prazo", "Meios de pagamento: PIX, boletos, cartões, gateways/adquirentes", "Prioridade de pagamentos conforme política de liquidez"] },
      { titulo: "Contas a Pagar", itens: ["Conferência fiscal/contratual, agendamento e execução de pagamentos", "Compras", "Compliance de alçadas de aprovação"] },
      { titulo: "Contas a Receber", itens: ["Faturamento, geração de cobranças e baixa de títulos", "Cobrança e inadimplência (régua, negativação, protesto)"] },
      { titulo: "Relacionamento Bancário", itens: ["Empréstimos, linhas e garantias", "Abertura e fechamento de contas", "Manutenção de cartões de crédito e conta corrente"] },
    ],
  },
];

/* ---- Escopo do Financeiro: matriz de trilhas (hoje → futuro) ---- */
type EscopoStatus = "hoje" | "construindo" | "futuro";
type Escopo = {
  id: string; pilar: string; titulo: string; descricao: string | null;
  status: EscopoStatus; horizonte: string | null; parent_id: string | null; responsavel: string | null; ordem: number;
};
const PILARES_ESCOPO: { nome: string; cor: string; Icon: any; sub: string }[] = [
  { nome: "Tesouraria",    cor: "hsl(162 60% 36%)", Icon: Landmark,   sub: "Caixa, pagamentos e recebimentos" },
  { nome: "Contabilidade", cor: "hsl(221 60% 52%)", Icon: Calculator, sub: "Contábil, fiscal, DP e societário" },
  { nome: "Controladoria", cor: "hsl(0 72% 51%)",   Icon: Target,     sub: "Relatórios, orçamento e FP&A" },
  { nome: "Estratégico",   cor: "hsl(38 92% 50%)",  Icon: Rocket,     sub: "Captação, pricing, M&A e IR" },
];
const ESCOPO_META: Record<EscopoStatus, { label: string; chip: string; dot: string; bar: string; Icon: any }> = {
  hoje:        { label: "Hoje",          chip: "bg-success/10 text-success",                          dot: "bg-success",             bar: "hsl(var(--success))", Icon: Check },
  construindo: { label: "Em construção", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",  dot: "bg-amber-500",           bar: "hsl(38 92% 50%)",     Icon: Wrench },
  futuro:      { label: "Futuro",        chip: "bg-muted text-muted-foreground",                      dot: "bg-muted-foreground/50", bar: "hsl(var(--border))",  Icon: Lock },
};
// As 4 colunas (horizontes) da trilha. O futuro se divide em curto (1–2a) e longo (3–5a).
const HORIZONTES: { key: string; label: string; sub: string; match: (e: Escopo) => boolean }[] = [
  { key: "hoje",        label: "Dominado hoje", sub: "roda sem depender de ninguém", match: (e) => e.status === "hoje" },
  { key: "construindo", label: "Em construção", sub: "próximos 6 meses",             match: (e) => e.status === "construindo" },
  { key: "curto",       label: "1–2 anos",      sub: "próxima fronteira",            match: (e) => e.status === "futuro" && (e.horizonte ?? "curto") === "curto" },
  { key: "longo",       label: "3–5 anos",      sub: "ambição de longo prazo",       match: (e) => e.status === "futuro" && e.horizonte === "longo" },
];
// Peso de cada status na barra de cobertura (0..1): dominado=1, desbloqueando=0.5.
const escScore = (s: EscopoStatus) => (s === "hoje" ? 1 : s === "construindo" ? 0.5 : 0);
// Cor estável do avatar de responsável a partir do nome.
const RESP_COR = ["hsl(0 72% 51%)", "hsl(221 60% 52%)", "hsl(162 60% 36%)", "hsl(38 92% 45%)", "hsl(280 55% 55%)"];
const respCor = (nome: string) => RESP_COR[[...nome].reduce((a, c) => a + c.charCodeAt(0), 0) % RESP_COR.length];

// Card de uma competência dentro de uma célula da trilha.
function EscopoCard({ e, dim, selected, onSel, onEdit, onAvancar }: {
  e: Escopo; dim: boolean; selected: boolean;
  onSel: (id: string) => void; onEdit: (e: Escopo) => void; onAvancar: (e: Escopo) => void;
}) {
  const m = ESCOPO_META[e.status];
  const futuro = e.status === "futuro";
  return (
    <div
      className={cn(
        "group/ec relative rounded-lg border bg-card px-2 py-1.5 shadow-sm transition",
        futuro ? "border-dashed border-border/70" : "border-border",
        dim ? "opacity-30" : "hover:shadow-md",
        selected && "ring-2 ring-primary/50",
      )}
      style={{ borderLeft: `3px solid ${m.bar}` }}
    >
      <button onClick={() => onSel(e.id)} title={e.descricao ?? "Ver a corrente de dependências"} className="flex w-full items-start gap-1.5 text-left">
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", m.dot)} />
        <span className={cn("min-w-0 flex-1 text-[11.5px] font-medium leading-tight", futuro ? "text-muted-foreground" : "text-foreground")}>{e.titulo}</span>
        {e.responsavel ? (
          <span title={e.responsavel} className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ background: respCor(e.responsavel) }}>
            {e.responsavel.trim()[0]?.toUpperCase()}
          </span>
        ) : (
          <span title="Sem responsável" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
        )}
      </button>
      <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-card/95 opacity-0 shadow-sm transition group-hover/ec:opacity-100">
        {e.status !== "hoje" && (
          <button onClick={() => onAvancar(e)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-success" title={e.status === "futuro" ? "Começar a desbloquear" : "Marcar como dominado"}>
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
        <button onClick={() => onEdit(e)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Editar"><Pencil className="h-3 w-3" /></button>
      </div>
    </div>
  );
}

// Chip de filtro (pilar / responsável).
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const TABS = [
  { key: "org", label: "Organograma", icon: Network },
  { key: "funcoes", label: "Funções", icon: ListChecks },
  { key: "vagas", label: "Vagas & Expansão", icon: UserPlus },
  { key: "escopo", label: "Escopo", icon: Waypoints },
  { key: "rituais", label: "Rituais", icon: CalendarDays },
  { key: "ia", label: "IA & Automação", icon: Bot },
  { key: "padrao", label: "Padrão de Mercado", icon: Layers },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/* ------------------------------ subcomponentes ------------------------------ */
function Avatar({ cargo, size = "h-9 w-9 text-[13px]" }: { cargo: Cargo; size?: string }) {
  if (!cargo.pessoa) {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-primary/60 text-primary", size)}>
        <UserPlus className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground", size)}>
      {cargo.pessoa.trim()[0]?.toUpperCase()}
    </div>
  );
}

function subtitulo(c: Cargo): string {
  if (c.pessoa) return [c.pessoa, c.senioridade].filter(Boolean).join(" · ");
  return ["Em aberto", c.senioridade, c.prioridade ? `prioridade ${c.prioridade}` : null].filter(Boolean).join(" · ");
}

function CargoCard({ c, selected, onClick }: { c: Cargo; selected: boolean; onClick: () => void }) {
  const meta = STATUS_META[c.status];
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-[230px] rounded-lg border border-muted-foreground/30 bg-card p-3 text-left shadow-sm transition hover:shadow-md",
        meta.borda,
        selected && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar cargo={c} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{c.titulo}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">{subtitulo(c)}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider", meta.badge)}>
            {meta.label}{c.acumulo ? " · ACÚMULO" : ""}
          </span>
          {c.desacoplado && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400" title="Personalizado neste ano — não herda mais mudanças do ano anterior">
              EDITADO
            </span>
          )}
          {c.alvo && (
            <span className="num shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold text-primary" title={`Card específico do ano de ${c.alvo}`}>
              {c.alvo}
            </span>
          )}
        </div>
        {c.custo_mensal != null && c.status !== "efetivo" && (
          <span className="num shrink-0 text-[11px] font-semibold text-foreground">{fmtBRL0(c.custo_mensal)}/mês</span>
        )}
      </div>
    </button>
  );
}

// Pirâmide de maturidade (SVG) — clique num nível para ver os detalhes.
function Piramide({ sel, onSel }: { sel: number; onSel: (n: number) => void }) {
  const PAD = 18, H = 250, HALF = 148, CX = 196, GAP = 6;
  const h = (H - GAP * 4) / 5;
  const halfAt = (y: number) => ((y - PAD) / H) * HALF;
  const slices = [1, 2, 3, 4, 5].map((k) => {
    const yTop = PAD + (5 - k) * (h + GAP);
    const yBot = yTop + h;
    const ht = halfAt(yTop), hb = halfAt(yBot);
    return { k, yTop, yBot, pts: `${CX - ht},${yTop} ${CX + ht},${yTop} ${CX + hb},${yBot} ${CX - hb},${yBot}` };
  });
  return (
    <svg viewBox="0 0 392 312" className="mx-auto w-full max-w-[420px]">
      {/* eixo lateral */}
      <text x={22} y={92} fontSize={9} letterSpacing={2.5} fill="hsl(var(--muted-foreground))" transform="rotate(-90 22 92)" textAnchor="middle">AUTÔNOMO</text>
      <text x={22} y={226} fontSize={9} letterSpacing={2.5} fill="hsl(var(--muted-foreground))" transform="rotate(-90 22 226)" textAnchor="middle">OPERACIONAL</text>
      <line x1={32} y1={PAD + 4} x2={32} y2={PAD + H - 4} stroke="hsl(var(--border))" strokeWidth={1} />
      {slices.map(({ k, yTop, yBot, pts }) => {
        const cy = (yTop + yBot) / 2 + (k === 5 ? 8 : 0);
        return (
          <g key={k} onClick={() => onSel(k)} className="cursor-pointer transition-opacity hover:opacity-90">
            <polygon points={pts} fill={NIVEL_COR[k - 1]} stroke={sel === k ? "hsl(var(--foreground))" : "transparent"} strokeWidth={2} />
            <circle cx={CX} cy={cy} r={12} fill="none" stroke="white" strokeWidth={1.4} />
            <text x={CX} y={cy + 3.5} fontSize={11} fontWeight={700} fill="white" textAnchor="middle">{k}</text>
            {k === NIVEL_ATUAL && (
              <g>
                <rect x={CX - 52} y={yBot - 15} width={104} height={14} rx={7} fill="hsl(var(--success))" />
                <text x={CX} y={yBot - 5} fontSize={8} fontWeight={700} letterSpacing={1} fill="white" textAnchor="middle">VOCÊ ESTÁ AQUI</text>
              </g>
            )}
          </g>
        );
      })}
      <text x={CX} y={PAD + H + 26} fontSize={9.5} fontWeight={700} letterSpacing={1.6} fill="hsl(var(--muted-foreground))" textAnchor="middle">BASE: FUNDAÇÃO OPERACIONAL</text>
    </svg>
  );
}

// Pirâmide truncada das obrigações macro (3 faixas). Clique numa faixa.
function PiramideMacro({ sel, onSel }: { sel: number; onSel: (i: number) => void }) {
  const CX = 232, yTop = 34, H = 244, GAP = 5, topHalf = 74, botHalf = 205;
  const halfAt = (y: number) => topHalf + (botHalf - topHalf) * ((y - yTop) / H);
  const bandH = (H - GAP * 2) / 3;
  return (
    <svg viewBox="0 0 464 322" className="mx-auto w-full max-w-[440px]">
      <text x={18} y={yTop + bandH} fontSize={8.5} letterSpacing={2} fill="hsl(var(--muted-foreground))" transform={`rotate(-90 18 ${yTop + bandH})`} textAnchor="middle">LIDERADO PELO CFO</text>
      <text x={452} y={yTop + H - bandH} fontSize={8.5} letterSpacing={2} fill="hsl(var(--muted-foreground))" transform={`rotate(-90 452 ${yTop + H - bandH})`} textAnchor="middle">LIDERADO PELO CONTROLLER</text>
      {[0, 1, 2].map((k) => {
        const yA = yTop + k * (bandH + GAP), yB = yA + bandH;
        const ha = halfAt(yA), hb = halfAt(yB);
        const pts = `${CX - ha},${yA} ${CX + ha},${yA} ${CX + hb},${yB} ${CX - hb},${yB}`;
        const m = OBRIGACOES_MACRO[k];
        const cy = (yA + yB) / 2;
        return (
          <g key={k} onClick={() => onSel(k)} className="cursor-pointer transition-opacity hover:opacity-90">
            <polygon points={pts} fill={MACRO_COR[k]} stroke={sel === k ? "hsl(var(--foreground))" : "transparent"} strokeWidth={2} />
            <text x={CX} y={cy - 3} fontSize={8.5} letterSpacing={1.5} fontWeight={600} fill="rgba(255,255,255,.75)" textAnchor="middle">{m.eyebrow}</text>
            <text x={CX} y={cy + 12} fontSize={k === 2 ? 11 : 14} fontWeight={700} fill="white" textAnchor="middle">{m.role}</text>
          </g>
        );
      })}
    </svg>
  );
}

// CSS do organograma recursivo (conectores por pseudo-elementos). Linhas mais
// visíveis que o --border padrão (usa muted-foreground com opacidade).
const ORG_LINE = "hsl(var(--muted-foreground) / 0.5)";
const ORG_TREE_CSS = `
.org-tree, .org-tree ul { list-style:none; margin:0; padding:0; }
.org-tree { display:inline-flex; }
.org-tree ul { display:flex; justify-content:center; padding-top:24px; position:relative; }
.org-tree li { position:relative; padding:24px 16px 0; display:flex; flex-direction:column; align-items:center; box-sizing:border-box; }
.org-tree li::before, .org-tree li::after { content:""; position:absolute; top:0; right:50%; width:50%; height:24px; border-top:2px solid ${ORG_LINE}; box-sizing:border-box; }
.org-tree li::after { right:auto; left:50%; border-left:2px solid ${ORG_LINE}; }
.org-tree li:only-child { padding-top:0; }
.org-tree li:only-child::before, .org-tree li:only-child::after { display:none; }
.org-tree li:first-child::before, .org-tree li:last-child::after { border:0 none; }
.org-tree li:last-child::before { border-right:2px solid ${ORG_LINE}; }
.org-tree ul::before { content:""; position:absolute; top:0; left:50%; width:0; height:24px; border-left:2px solid ${ORG_LINE}; }
.org-tree > li { padding-top:0; }
.org-tree > li::before, .org-tree > li::after { display:none; }
`;

// Nó recursivo do organograma (renderiza qualquer profundidade).
function Ramo({ cargo, all, selId, onSel }: { cargo: Cargo; all: Cargo[]; selId: string | null; onSel: (id: string) => void }) {
  const kids = all.filter((c) => c.parent_id === cargo.id).sort((a, b) => a.ordem - b.ordem);
  return (
    <li>
      <CargoCard c={cargo} selected={selId === cargo.id} onClick={() => onSel(cargo.id)} />
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => <Ramo key={k.id} cargo={k} all={all} selId={selId} onSel={onSel} />)}
        </ul>
      )}
    </li>
  );
}

/* ================================ componente ================================ */
export default function TimeFinanceiro() {
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [passos, setPassos] = useState<Passo[]>([]);
  const [rituais, setRituais] = useState<Ritual[]>([]);
  const [escopos, setEscopos] = useState<Escopo[]>([]);
  const [autoNiveis, setAutoNiveis] = useState<{ nivel: number | null; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("org");
  const [ano, setAno] = useState<number>(2026);
  const [selCargoId, setSelCargoId] = useState<string | null>(null);
  const [nivelSel, setNivelSel] = useState(NIVEL_ATUAL);
  const [macroSel, setMacroSel] = useState(0);
  const [novoPasso, setNovoPasso] = useState("");

  // Estrutura padrão: todos os grupos abrem por padrão sempre que a página carrega.
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(() => {
    const s = new Set<string>();
    PILARES.forEach((p) => p.grupos.forEach((g) => s.add(`${p.nome}::${g.titulo}`)));
    return s;
  });
  const toggleGrupo = (key: string) =>
    setGruposAbertos((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // diálogo de cargo/vaga (criar + editar)
  const vazio = { titulo: "", pessoa: "", senioridade: "Pleno", status: "vaga_aberta" as Status, prioridade: "Alta", custo_mensal: "", alvo: "", parent_id: "" };
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(vazio);
  const [salvando, setSalvando] = useState(false);

  // editor de atribuições (blocos/itens) + "puxar de outro cargo"
  const [atbDlgOpen, setAtbDlgOpen] = useState(false);
  const [atbCargoId, setAtbCargoId] = useState<string | null>(null);
  const [atbDraft, setAtbDraft] = useState<AtribGrupo[]>([]);
  const [salvandoAtb, setSalvandoAtb] = useState(false);
  const [pullSourceId, setPullSourceId] = useState("");
  const [pullSel, setPullSel] = useState<Set<string>>(new Set());
  const [pullMode, setPullMode] = useState<"copiar" | "mover">("copiar");
  const [origensAlteradas, setOrigensAlteradas] = useState<Record<string, AtribGrupo[]>>({});

  // diálogo de ritual/reunião
  const rituVazio = { titulo: "", tipo: "Tática", periodicidade: "Semanal", descricao: "", pauta: [] as string[] };
  const [rituDlgOpen, setRituDlgOpen] = useState(false);
  const [rituEditId, setRituEditId] = useState<string | null>(null);
  const [rituForm, setRituForm] = useState(rituVazio);
  const [salvandoRitu, setSalvandoRitu] = useState(false);

  // diálogo de escopo/competência + filtros e seleção da trilha
  const escVazio = { pilar: "Tesouraria", titulo: "", descricao: "", status: "futuro" as EscopoStatus, horizonte: "curto", parent_id: "", responsavel: "" };
  const [escDlgOpen, setEscDlgOpen] = useState(false);
  const [escEditId, setEscEditId] = useState<string | null>(null);
  const [escForm, setEscForm] = useState(escVazio);
  const [salvandoEsc, setSalvandoEsc] = useState(false);
  const [escBusca, setEscBusca] = useState("");
  const [escPilarFiltro, setEscPilarFiltro] = useState("");   // "" = todos
  const [escRespFiltro, setEscRespFiltro] = useState("");      // "" = todos · "__sem" = sem responsável
  const [escSelId, setEscSelId] = useState<string | null>(null); // nó destacado (corrente de dependências)
  const [escRecolhidos, setEscRecolhidos] = useState<Set<string>>(new Set()); // pilares recolhidos na árvore
  const toggleEscPilar = (nome: string) =>
    setEscRecolhidos((prev) => { const n = new Set(prev); n.has(nome) ? n.delete(nome) : n.add(nome); return n; });

  async function carregar() {
    const [{ data: cs, error: e1 }, { data: ps, error: e2 }, { data: rs, error: e3 }, { data: au }, { data: es, error: e5 }] = await Promise.all([
      sb.from("time_cargos").select("*").order("ordem", { ascending: true }),
      sb.from("time_passos").select("*").order("ordem", { ascending: true }),
      sb.from("time_rituais").select("*").order("ordem", { ascending: true }),
      sb.from("automacoes_catalogo").select("nivel,status"),
      sb.from("time_escopos").select("*").order("ordem", { ascending: true }),
    ]);
    if (e1 || e2 || e3 || e5) toast.error("Falha ao carregar o time: " + (e1?.message ?? e2?.message ?? e3?.message ?? e5?.message));
    setCargos((cs ?? []) as Cargo[]);
    setPassos((ps ?? []) as Passo[]);
    setRituais((rs ?? []) as Ritual[]);
    setAutoNiveis((au ?? []) as { nivel: number | null; status: string }[]);
    setEscopos((es ?? []) as Escopo[]);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, []);

  // Cargos do ano selecionado (o organograma/KPIs/funções/vagas são por ano).
  // Um cargo com "alvo" (ano) definido só aparece no snapshot daquele ano; sem alvo (time
  // efetivo/permanente) aparece em todos os anos. As cópias por linhagem existem em cada ano
  // — o alvo esconde as dos anos que não são o dele.
  const cargosDoAno = useMemo(
    () => cargos.filter((c) => {
      if (c.ano !== ano) return false;
      const av = c.alvo ? Number(c.alvo) : null;
      return av == null || Number.isNaN(av) || av === ano;
    }),
    [cargos, ano],
  );
  const anoAnterior = ano - 1;
  const temAnoAnterior = cargos.some((c) => c.ano === anoAnterior);

  const raiz = cargosDoAno.find((c) => !c.parent_id);
  const selCargo = cargosDoAno.find((c) => c.id === selCargoId) ?? null;

  /* ---- Escopo do financeiro (skill tree): agrupamento + cobertura ---- */
  const escKpi = useMemo(() => {
    const hoje = escopos.filter((e) => e.status === "hoje").length;
    const constr = escopos.filter((e) => e.status === "construindo").length;
    const fut = escopos.filter((e) => e.status === "futuro").length;
    const total = escopos.length;
    const cobertura = total ? Math.round((100 * escopos.reduce((a, e) => a + escScore(e.status), 0)) / total) : 0;
    return { hoje, constr, fut, total, cobertura };
  }, [escopos]);
  const coberturaPilar = (pilar: string) => {
    const nos = escopos.filter((e) => e.pilar === pilar);
    if (!nos.length) return { pct: 0, hoje: 0, total: 0 };
    return {
      pct: Math.round((100 * nos.reduce((a, e) => a + escScore(e.status), 0)) / nos.length),
      hoje: nos.filter((e) => e.status === "hoje").length,
      total: nos.length,
    };
  };
  // Pré-requisitos válidos no editor: mesmo pilar, sem o próprio nó nem seus descendentes (evita ciclo).
  const escParentOpts = useMemo(() => {
    if (!escEditId) return escopos.filter((e) => e.pilar === escForm.pilar);
    const bloq = new Set<string>([escEditId]);
    const walk = (pid: string) => escopos.filter((e) => e.parent_id === pid).forEach((c) => { if (!bloq.has(c.id)) { bloq.add(c.id); walk(c.id); } });
    walk(escEditId);
    return escopos.filter((e) => e.pilar === escForm.pilar && !bloq.has(e.id));
  }, [escopos, escEditId, escForm.pilar]);

  // Folhas = competências (os troncos são as "trilhas"). Responsáveis distintos p/ os chips.
  const escFolhas = useMemo(() => escopos.filter((e) => e.parent_id), [escopos]);
  const escById = useMemo(() => new Map(escopos.map((e) => [e.id, e])), [escopos]);
  const respExistentes = useMemo(
    () => [...new Set(escFolhas.map((e) => e.responsavel).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [escFolhas],
  );
  const escFiltroAtivo = !!escBusca.trim() || !!escPilarFiltro || !!escRespFiltro;
  // Passa nos filtros de busca/pilar/responsável? (aplicado às folhas)
  const escPassa = (e: Escopo) => {
    if (escPilarFiltro && e.pilar !== escPilarFiltro) return false;
    if (escRespFiltro === "__sem" ? !!e.responsavel : escRespFiltro && e.responsavel !== escRespFiltro) return false;
    if (escBusca.trim() && !normalize(e.titulo).includes(normalize(escBusca))) return false;
    return true;
  };
  const escFolhasVisiveis = useMemo(() => escFolhas.filter(escPassa), [escFolhas, escBusca, escPilarFiltro, escRespFiltro]);
  const semResp = useMemo(() => escFolhas.filter((e) => !e.responsavel).length, [escFolhas]);

  // Corrente de dependências do nó selecionado (ele + ancestrais + descendentes).
  const escChain = useMemo(() => {
    if (!escSelId) return null;
    const ids = new Set<string>([escSelId]);
    let cur = escById.get(escSelId);
    while (cur?.parent_id) { ids.add(cur.parent_id); cur = escById.get(cur.parent_id); }
    const desc = (pid: string) => escopos.filter((e) => e.parent_id === pid).forEach((c) => { if (!ids.has(c.id)) { ids.add(c.id); desc(c.id); } });
    desc(escSelId);
    return ids;
  }, [escSelId, escopos, escById]);

  // "Próximo a desbloquear": competências em construção, priorizando as com tronco já dominado.
  const escProximos = useMemo(() => {
    const pIdx = (nome: string) => PILARES_ESCOPO.findIndex((p) => p.nome === nome);
    return escFolhas
      .filter((e) => e.status === "construindo")
      .sort((a, b) => {
        const pa = escById.get(a.parent_id!)?.status === "hoje" ? 0 : 1;
        const pb = escById.get(b.parent_id!)?.status === "hoje" ? 0 : 1;
        return pa - pb || pIdx(a.pilar) - pIdx(b.pilar) || a.ordem - b.ordem;
      })
      .slice(0, 5);
  }, [escFolhas, escById]);

  /* ------------------------------ ações ------------------------------ */
  function abrirNovo(status: Status = "vaga_aberta") {
    setEditId(null);
    setForm({ ...vazio, status, parent_id: raiz?.id ?? "" });
    setDlgOpen(true);
  }
  function abrirEdicao(c: Cargo) {
    setEditId(c.id);
    setForm({
      titulo: c.titulo, pessoa: c.pessoa ?? "", senioridade: c.senioridade ?? "",
      status: c.status, prioridade: c.prioridade ?? "", custo_mensal: c.custo_mensal != null ? String(c.custo_mensal) : "",
      alvo: c.alvo ?? "", parent_id: c.parent_id ?? "",
    });
    setDlgOpen(true);
  }

  // Ao virar efetivo, os itens que estavam sinalizados "vão para este cargo" saem em
  // definitivo das origens (no mesmo ano).
  async function finalizarTransferencias(destId: string, anoC: number) {
    const afetados = cargos.filter((src) => src.ano === anoC && src.atribuicoes.some((g) => g.itens.some((it) => itransf(it)?.paraId === destId)));
    for (const src of afetados) {
      const nova = src.atribuicoes.map((g) => ({ ...g, itens: g.itens.filter((it) => itransf(it)?.paraId !== destId) }));
      await sb.from("time_cargos").update({ atribuicoes: nova, atualizado_em: new Date().toISOString() }).eq("id", src.id);
    }
  }

  async function salvarCargo() {
    if (!form.titulo.trim()) { toast.error("Informe o título do cargo."); return; }
    setSalvando(true);
    const meta = {
      titulo: form.titulo.trim(),
      pessoa: form.pessoa.trim() || null,
      senioridade: form.senioridade.trim() || null,
      prioridade: form.prioridade.trim() || null,
      custo_mensal: form.custo_mensal ? parseFloat(form.custo_mensal.replace(/\./g, "").replace(",", ".")) : null,
      alvo: form.alvo.trim() || null,
    };
    const parentChave = form.parent_id ? cargos.find((c) => c.id === form.parent_id)?.chave ?? null : null;
    const parentNoAno = (a: number) => (parentChave ? cargos.find((c) => c.chave === parentChave && c.ano === a)?.id ?? null : null);

    let error: any = null;
    if (editId) {
      const alvo = cargos.find((c) => c.id === editId)!;
      ({ error } = await sb.from("time_cargos").update({ ...meta, status: form.status, parent_id: form.parent_id || null, atualizado_em: new Date().toISOString() }).eq("id", editId));
      if (!error) {
        // desacopla se herda de ano anterior; propaga metadados (não status) para anos seguintes acoplados
        if (cargos.some((c) => c.chave === alvo.chave && c.ano < alvo.ano)) {
          await sb.from("time_cargos").update({ desacoplado: true }).eq("id", editId);
        }
        for (const s of cargos.filter((c) => c.chave === alvo.chave && c.ano > alvo.ano && !c.desacoplado)) {
          await sb.from("time_cargos").update({ ...meta, parent_id: parentNoAno(s.ano), atualizado_em: new Date().toISOString() }).eq("id", s.id);
        }
        // O "ano do card" (alvo) é uma propriedade da linhagem inteira — sincroniza em TODAS
        // as cópias (inclusive anteriores/desacopladas), pra "mudar de ano" mover o card de
        // fato, sem deixar cópia órfã presa em outro ano.
        await sb.from("time_cargos").update({ alvo: meta.alvo }).eq("chave", alvo.chave);
        // Garante que exista a cópia no ano-alvo (senão o card sumiria de todos os anos).
        const alvoAno = meta.alvo && ANOS.includes(Number(meta.alvo)) ? Number(meta.alvo) : null;
        if (alvoAno && !cargos.some((c) => c.chave === alvo.chave && c.ano === alvoAno)) {
          await sb.from("time_cargos").insert([{
            ...meta, status: form.status, parent_id: parentNoAno(alvoAno),
            atribuicoes: alvo.atribuicoes, ordem: alvo.ordem, ano: alvoAno, chave: alvo.chave, desacoplado: false,
          }]);
        }
        if (form.status === "efetivo" && alvo.status !== "efetivo") await finalizarTransferencias(editId, alvo.ano);
      }
    } else {
      // Cria a linhagem. Sem alvo, o cargo existe do ano atual em diante (papel novo que
      // passa a existir agora). Com alvo, garante cópia desde o ano-alvo (mesmo anterior ao
      // atual) até 2028 — assim o card aparece no ano marcado, independentemente de onde foi
      // criado. parentNoAno(ano) resolve para o próprio parent escolhido no ano atual.
      const chave = crypto.randomUUID();
      const alvoAno = meta.alvo && ANOS.includes(Number(meta.alvo)) ? Number(meta.alvo) : null;
      const desde = alvoAno ? Math.min(ano, alvoAno) : ano;
      const rows: any[] = ANOS.filter((a) => a >= desde).map((L) => ({
        ...meta, status: form.status, parent_id: parentNoAno(L),
        atribuicoes: [], ordem: cargosDoAno.length, ano: L, chave, desacoplado: false,
      }));
      ({ error } = await sb.from("time_cargos").insert(rows));
    }
    setSalvando(false);
    if (error) { toast.error("Falha ao salvar: " + error.message); return; }
    toast.success(editId ? "Cargo atualizado." : `Cargo criado${ano < 2028 ? " (propagado para os anos seguintes)" : ""}.`);
    setDlgOpen(false);
    carregar();
  }

  // Herda a estrutura de um ano para outro preservando a LINHAGEM (só traz chaves que
  // ainda não existem no destino). Usado quando um ano foi esvaziado.
  async function duplicarAno(origem: number, destino: number) {
    const fonte = cargos.filter((c) => c.ano === origem).sort((a, b) => a.ordem - b.ordem);
    if (!fonte.length) { toast.error(`Sem estrutura em ${origem} para herdar.`); return; }
    const jaNoDestino = new Set(cargos.filter((c) => c.ano === destino).map((c) => c.chave));
    const criar = fonte.filter((c) => !jaNoDestino.has(c.chave));
    if (!criar.length) { toast.message(`${destino} já herda tudo de ${origem}.`); return; }
    const idMap = new Map<string, string>();
    criar.forEach((c) => idMap.set(c.id, crypto.randomUUID()));
    const parentNoDestino = (c: Cargo): string | null => {
      if (!c.parent_id) return null;
      const pchave = cargos.find((x) => x.id === c.parent_id)?.chave;
      const jaExiste = cargos.find((x) => x.ano === destino && x.chave === pchave);
      if (jaExiste) return jaExiste.id;
      const pLote = criar.find((x) => x.chave === pchave);
      return pLote ? idMap.get(pLote.id) ?? null : null;
    };
    const novos = criar.map((c) => ({
      id: idMap.get(c.id), titulo: c.titulo, pessoa: c.pessoa, senioridade: c.senioridade, status: c.status,
      acumulo: c.acumulo, prioridade: c.prioridade, custo_mensal: c.custo_mensal, alvo: c.alvo,
      parent_id: parentNoDestino(c), atribuicoes: c.atribuicoes, ordem: c.ordem, ano: destino, chave: c.chave, desacoplado: false,
    }));
    const { error } = await sb.from("time_cargos").insert(novos);
    if (error) { toast.error("Falha ao herdar: " + error.message); return; }
    toast.success(`Estrutura de ${origem} herdada para ${destino}.`);
    carregar();
  }

  async function excluirCargo() {
    if (!editId) return;
    if (!window.confirm("Excluir este cargo/vaga?")) return;
    const { error } = await sb.from("time_cargos").delete().eq("id", editId);
    if (error) { toast.error("Falha ao excluir: " + error.message); return; }
    toast.success("Cargo excluído.");
    setDlgOpen(false);
    if (selCargoId === editId) setSelCargoId(null);
    carregar();
  }

  async function moverStatus(c: Cargo, status: Status) {
    const { error } = await sb.from("time_cargos").update({ status, atualizado_em: new Date().toISOString() }).eq("id", c.id);
    if (error) { toast.error("Falha ao mover: " + error.message); return; }
    if (status === "efetivo") await finalizarTransferencias(c.id, c.ano);
    carregar();
  }

  /* ---------------------- editor de atribuições ---------------------- */
  function abrirAtribuicoes(c: Cargo) {
    setAtbCargoId(c.id);
    setAtbDraft(JSON.parse(JSON.stringify(c.atribuicoes ?? [])));
    setPullSourceId(""); setPullSel(new Set()); setPullMode("copiar"); setOrigensAlteradas({});
    setAtbDlgOpen(true);
  }
  const cloneDraft = () => atbDraft.map((g) => ({ ...g, itens: [...g.itens] }));
  const addBloco = () => setAtbDraft([...cloneDraft(), { titulo: "Novo bloco", itens: [] }]);
  const setBlocoTitulo = (i: number, v: string) => { const d = cloneDraft(); d[i].titulo = v; setAtbDraft(d); };
  const removeBloco = (i: number) => setAtbDraft(cloneDraft().filter((_, k) => k !== i));
  const addItem = (i: number) => { const d = cloneDraft(); d[i].itens.push(""); setAtbDraft(d); };
  const setItem = (i: number, j: number, v: string) => {
    const d = cloneDraft(); const old = d[i].itens[j];
    d[i].itens[j] = typeof old === "object" && old ? { ...old, texto: v } : v; // preserva flag de transferência
    setAtbDraft(d);
  };
  const removeItem = (i: number, j: number) => { const d = cloneDraft(); d[i].itens = d[i].itens.filter((_, k) => k !== j); setAtbDraft(d); };
  const togglePull = (key: string) => setPullSel((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  function aplicarPull(displaySource: AtribGrupo[]) {
    if (!pullSourceId || !pullSel.size) return;
    const destinoEfetivo = atbCargo?.status === "efetivo";
    const trazer = new Map<string, string[]>();
    displaySource.forEach((g, gi) => g.itens.forEach((it, ii) => {
      if (pullSel.has(`${gi}:${ii}`)) { const arr = trazer.get(g.titulo) ?? []; arr.push(itxt(it)); trazer.set(g.titulo, arr); }
    }));
    // funde no cargo alvo, agrupando por título de bloco (evita duplicar)
    const novo = cloneDraft();
    trazer.forEach((items, titulo) => {
      const alvo = novo.find((g) => g.titulo.trim().toLowerCase() === titulo.trim().toLowerCase());
      const existentes = new Set((alvo?.itens ?? []).map(itxt));
      const add = items.filter((t) => !existentes.has(t));
      if (alvo) alvo.itens.push(...add);
      else if (add.length) novo.push({ titulo, itens: Array.from(new Set(add)) });
    });
    setAtbDraft(novo);
    if (pullMode === "mover") {
      const novaOrigem = displaySource.map((g, gi) => ({
        ...g,
        itens: g.itens
          // destino efetivo → tira da origem já; destino ainda não efetivo → mantém sinalizado
          .filter((it, ii) => destinoEfetivo ? !pullSel.has(`${gi}:${ii}`) : true)
          .map((it, ii) => (!destinoEfetivo && pullSel.has(`${gi}:${ii}`))
            ? { texto: itxt(it), transfPara: atbCargoId!, transfParaNome: atbCargo?.titulo }
            : it),
      }));
      setOrigensAlteradas((prev) => ({ ...prev, [pullSourceId]: novaOrigem }));
    }
    const total = Array.from(trazer.values()).reduce((a, arr) => a + arr.length, 0);
    setPullSel(new Set());
    toast.success(
      pullMode === "copiar" ? `${total} responsabilidade(s) copiada(s).`
      : destinoEfetivo ? `${total} responsabilidade(s) movida(s).`
      : `${total} responsabilidade(s) marcada(s) para transferência (saem da origem quando o cargo virar efetivo).`,
    );
  }

  // Limpa/normaliza itens preservando a flag de transferência.
  const limparAtb = (arr: AtribGrupo[]) => arr.map((g) => ({
    titulo: g.titulo.trim(),
    itens: g.itens
      .map((it) => (typeof it === "object" && it ? { ...it, texto: it.texto.trim() } : String(it).trim()))
      .filter((it) => itxt(it)),
  }));

  async function salvarAtribuicoes() {
    if (!atbCargoId) return;
    setSalvandoAtb(true);
    const alvo = cargos.find((c) => c.id === atbCargoId);
    const novaAtb = limparAtb(atbDraft);
    const updates = [sb.from("time_cargos").update({ atribuicoes: novaAtb, atualizado_em: new Date().toISOString() }).eq("id", atbCargoId)];
    // desacopla o cargo editado se ele herda de um ano anterior; propaga para os anos seguintes ainda acoplados
    if (alvo) {
      if (cargos.some((c) => c.chave === alvo.chave && c.ano < alvo.ano)) {
        updates.push(sb.from("time_cargos").update({ desacoplado: true }).eq("id", alvo.id));
      }
      cargos.filter((c) => c.chave === alvo.chave && c.ano > alvo.ano && !c.desacoplado).forEach((s) => {
        updates.push(sb.from("time_cargos").update({ atribuicoes: novaAtb, atualizado_em: new Date().toISOString() }).eq("id", s.id));
      });
    }
    Object.entries(origensAlteradas).forEach(([sid, atb]) => {
      updates.push(sb.from("time_cargos").update({ atribuicoes: limparAtb(atb), atualizado_em: new Date().toISOString() }).eq("id", sid));
    });
    const results = await Promise.all(updates);
    setSalvandoAtb(false);
    const err = (results as any[]).find((r) => r.error);
    if (err) { toast.error("Falha ao salvar: " + err.error.message); return; }
    toast.success("Atribuições salvas.");
    setAtbDlgOpen(false);
    carregar();
  }

  /* ---------------------- rituais / reuniões ---------------------- */
  function abrirNovoRitual() {
    setRituEditId(null);
    setRituForm({ ...rituVazio });
    setRituDlgOpen(true);
  }
  function abrirEdicaoRitual(r: Ritual) {
    setRituEditId(r.id);
    setRituForm({ titulo: r.titulo, tipo: r.tipo ?? "", periodicidade: r.periodicidade ?? "", descricao: r.descricao ?? "", pauta: [...(r.pauta ?? [])] });
    setRituDlgOpen(true);
  }
  const setPautaItem = (i: number, v: string) => setRituForm((f) => { const p = [...f.pauta]; p[i] = v; return { ...f, pauta: p }; });
  const addPautaItem = () => setRituForm((f) => ({ ...f, pauta: [...f.pauta, ""] }));
  const removePautaItem = (i: number) => setRituForm((f) => ({ ...f, pauta: f.pauta.filter((_, k) => k !== i) }));

  async function salvarRitual() {
    if (!rituForm.titulo.trim()) { toast.error("Informe o título do ritual."); return; }
    setSalvandoRitu(true);
    const payload = {
      titulo: rituForm.titulo.trim(),
      tipo: rituForm.tipo.trim() || null,
      periodicidade: rituForm.periodicidade.trim() || null,
      descricao: rituForm.descricao.trim() || null,
      pauta: rituForm.pauta.map((s) => s.trim()).filter(Boolean),
    };
    const { error } = rituEditId
      ? await sb.from("time_rituais").update(payload).eq("id", rituEditId)
      : await sb.from("time_rituais").insert({ ...payload, ordem: rituais.length });
    setSalvandoRitu(false);
    if (error) { toast.error("Falha ao salvar: " + error.message); return; }
    toast.success(rituEditId ? "Ritual atualizado." : "Ritual criado.");
    setRituDlgOpen(false);
    carregar();
  }
  async function excluirRitual() {
    if (!rituEditId) return;
    if (!window.confirm("Excluir este ritual?")) return;
    const { error } = await sb.from("time_rituais").delete().eq("id", rituEditId);
    if (error) { toast.error("Falha ao excluir: " + error.message); return; }
    toast.success("Ritual excluído.");
    setRituDlgOpen(false);
    carregar();
  }

  /* ------------------------------ escopo ------------------------------ */
  function abrirNovoEscopo(pilar: string, parentId = "") {
    setEscEditId(null);
    setEscForm({ ...escVazio, pilar, parent_id: parentId });
    setEscDlgOpen(true);
  }
  function abrirEdicaoEscopo(e: Escopo) {
    setEscEditId(e.id);
    setEscForm({ pilar: e.pilar, titulo: e.titulo, descricao: e.descricao ?? "", status: e.status, horizonte: e.horizonte ?? "curto", parent_id: e.parent_id ?? "", responsavel: e.responsavel ?? "" });
    setEscDlgOpen(true);
  }
  const toggleEscSel = (id: string) => setEscSelId((prev) => (prev === id ? null : id));
  async function salvarEscopo() {
    if (!escForm.titulo.trim()) { toast.error("Informe o título da competência."); return; }
    setSalvandoEsc(true);
    const payload = {
      pilar: escForm.pilar, titulo: escForm.titulo.trim(),
      descricao: escForm.descricao.trim() || null, status: escForm.status,
      horizonte: escForm.status === "futuro" ? escForm.horizonte : null,
      parent_id: escForm.parent_id || null, responsavel: escForm.responsavel.trim() || null,
    };
    let error: any = null;
    if (escEditId) {
      ({ error } = await sb.from("time_escopos").update({ ...payload, atualizado_em: new Date().toISOString() }).eq("id", escEditId));
    } else {
      const ordem = escopos.filter((e) => e.pilar === escForm.pilar && (e.parent_id ?? "") === (escForm.parent_id || "")).length;
      ({ error } = await sb.from("time_escopos").insert([{ ...payload, ordem }]));
    }
    setSalvandoEsc(false);
    if (error) { toast.error("Falha ao salvar: " + error.message); return; }
    toast.success(escEditId ? "Competência atualizada." : "Competência adicionada.");
    setEscDlgOpen(false);
    carregar();
  }
  async function excluirEscopo() {
    if (!escEditId) return;
    if (!window.confirm("Excluir esta competência e as que dependem dela?")) return;
    const { error } = await sb.from("time_escopos").delete().eq("id", escEditId);
    if (error) { toast.error("Falha ao excluir: " + error.message); return; }
    toast.success("Competência excluída.");
    setEscDlgOpen(false);
    carregar();
  }
  // Avança na maturidade: futuro → em construção → hoje (o "desbloquear").
  async function avancarEscopo(e: Escopo) {
    const prox: EscopoStatus = e.status === "futuro" ? "construindo" : "hoje";
    setEscopos((prev) => prev.map((x) => (x.id === e.id ? { ...x, status: prox } : x)));
    const { error } = await sb.from("time_escopos").update({ status: prox, atualizado_em: new Date().toISOString() }).eq("id", e.id);
    if (error) { toast.error("Falha ao atualizar: " + error.message); carregar(); }
  }

  async function addPasso() {
    const texto = novoPasso.trim();
    if (!texto) return;
    setNovoPasso("");
    const { error } = await sb.from("time_passos").insert({ texto, ordem: passos.length });
    if (error) toast.error("Falha ao adicionar: " + error.message);
    carregar();
  }
  async function togglePasso(p: Passo) {
    await sb.from("time_passos").update({ done: !p.done }).eq("id", p.id);
    carregar();
  }
  async function removerPasso(p: Passo) {
    await sb.from("time_passos").delete().eq("id", p.id);
    carregar();
  }

  /* ------------------------------ render ------------------------------ */
  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando o time…
      </div>
    );
  }

  const nivel = NIVEIS.find((n) => n.n === nivelSel)!;
  const autosNivel = autoNiveis.filter((a) => a.nivel === nivelSel && a.status === "Rodando").length;

  const atbCargo = cargos.find((c) => c.id === atbCargoId) ?? null;
  const pullSource = cargos.find((c) => c.id === pullSourceId) ?? null;
  const displaySource: AtribGrupo[] = pullSource ? (origensAlteradas[pullSource.id] ?? pullSource.atribuicoes) : [];

  const KANBAN: { status: Status; label: string; vazio: React.ReactNode }[] = [
    { status: "planejado", label: "Planejado", vazio: <>Nenhum cargo planejado — clique em “Novo cargo”.</> },
    { status: "vaga_aberta", label: "Vaga aberta", vazio: <>Nenhuma vaga aberta.</> },
    { status: "entrevista", label: "Em entrevista", vazio: <>Nenhum processo em andamento.</> },
    { status: "contratado", label: "Contratado", vazio: <>Contratações concluídas aparecem aqui.</> },
  ];
  const ACAO: Partial<Record<Status, { rotulo: string; prox: Status }>> = {
    planejado: { rotulo: "Abrir vaga", prox: "vaga_aberta" },
    vaga_aberta: { rotulo: "Mover p/ entrevista", prox: "entrevista" },
    entrevista: { rotulo: "Marcar contratado", prox: "contratado" },
    contratado: { rotulo: "Tornar efetivo", prox: "efetivo" },
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* ---------------- Cabeçalho ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Time Financeiro</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Estrutura atual e planejamento do time — o financeiro de hoje e o de daqui a 5 anos.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
            {ANOS.map((a) => (
              <button
                key={a}
                onClick={() => { setAno(a); setSelCargoId(null); }}
                className={cn(
                  "num rounded px-3 py-1.5 text-[12.5px] font-semibold transition",
                  ano === a ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {a}
              </button>
            ))}
          </div>
          <button
            onClick={() => abrirNovo("vaga_aberta")}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Novo cargo / vaga
          </button>
        </div>
      </div>

      {/* ---------------- Abas ---------------- */}
      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-secondary/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition",
              tab === t.key ? "border border-border bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* ---------------- Organograma ---------------- */}
      {tab === "org" && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="card-surface p-5">
            <style>{ORG_TREE_CSS}</style>
            {raiz ? (
              <div className="flex flex-col items-center">
                <div className="w-full overflow-x-auto pb-2">
                  <div className="flex min-w-full justify-center">
                    <ul className="org-tree">
                      <Ramo cargo={raiz} all={cargosDoAno} selId={selCargoId} onSel={setSelCargoId} />
                    </ul>
                  </div>
                </div>
                <button
                  onClick={() => abrirNovo("planejado")}
                  className="mt-6 flex w-[230px] flex-col items-center gap-1 rounded-lg border-2 border-dashed border-border p-4 text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                  <span className="text-[12px]">Adicionar cargo em {ano}</span>
                </button>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-primary" /> Efetivo</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border-2 border-primary" /> Vaga aberta / entrevista</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border-2 border-dashed border-muted-foreground" /> Planejado (futuro)</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Network className="h-8 w-8 text-muted-foreground/40" />
                <div className="text-[13px] text-muted-foreground">Nenhuma estrutura para <span className="font-semibold text-foreground">{ano}</span> ainda.</div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {temAnoAnterior && (
                    <button onClick={() => duplicarAno(anoAnterior, ano)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-foreground transition hover:brightness-110">
                      <Copy className="h-4 w-4" /> Herdar estrutura de {anoAnterior}
                    </button>
                  )}
                  <button onClick={() => abrirNovo("efetivo")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[12.5px] font-medium text-foreground transition hover:bg-muted">
                    <Plus className="h-4 w-4" /> Criar do zero
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Painel de atribuições */}
          <div className="card-surface flex flex-col p-4">
            {selCargo ? (
              <>
                <div className="flex items-center gap-2.5 border-b border-border/60 pb-3">
                  <Avatar cargo={selCargo} />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold">{selCargo.titulo}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{subtitulo(selCargo)}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => abrirAtribuicoes(selCargo)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Gerenciar atribuições">
                      <ListChecks className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => abrirEdicao(selCargo)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Editar cargo">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {selCargo.atribuicoes.length ? selCargo.atribuicoes.map((g, i) => (
                    <div key={i}>
                      <div className="flex items-baseline gap-2">
                        <span className="num text-[11px] font-bold text-primary">{String(i + 1).padStart(2, "0")}</span>
                        <span className="text-[12.5px] font-semibold text-foreground">{g.titulo}</span>
                      </div>
                      {g.itens.length > 0 && (
                        <ul className="mt-1 space-y-0.5 pl-6">
                          {g.itens.map((it, j) => <ItemLinha key={j} it={it} />)}
                        </ul>
                      )}
                    </div>
                  )) : (
                    <p className="text-[12px] text-muted-foreground">Sem atribuições ainda — use “Gerenciar atribuições” para criar ou puxar de outro cargo.</p>
                  )}
                </div>
                <button
                  onClick={() => abrirAtribuicoes(selCargo)}
                  className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-[12.5px] font-semibold text-primary transition hover:bg-primary/10"
                >
                  <ListChecks className="h-3.5 w-3.5" /> Gerenciar atribuições
                </button>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
                <Network className="h-8 w-8 text-muted-foreground/40" />
                <p className="max-w-[220px] text-[12.5px] text-muted-foreground">
                  Clique num cargo para ver as atribuições completas. Cargos <span className="font-semibold">pontilhados</span> são planejamento futuro.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Funções ---------------- */}
      {tab === "funcoes" && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {!cargosDoAno.length && (
            <div className="card-surface col-span-full p-8 text-center text-[13px] text-muted-foreground">Nenhum cargo em {ano}.</div>
          )}
          {cargosDoAno.map((c) => (
            <div key={c.id} className="card-surface p-4">
              <div className="flex items-center gap-2.5 border-b border-border/60 pb-3">
                <Avatar cargo={c} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">{c.titulo}</div>
                  <div className="truncate text-[11.5px] text-muted-foreground">{subtitulo(c)}</div>
                </div>
                <span className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider", STATUS_META[c.status].badge)}>
                  {STATUS_META[c.status].label}
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {c.atribuicoes.map((g, i) => (
                  <div key={i}>
                    <div className="flex items-baseline gap-2">
                      <span className="num text-[11px] font-bold text-primary">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-[13px] font-semibold text-foreground">{g.titulo}</span>
                    </div>
                    {g.itens.length > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-6">
                        {g.itens.map((it, j) => <ItemLinha key={j} it={it} />)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Vagas & Expansão ---------------- */}
      {tab === "vagas" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {KANBAN.map((col) => {
            const items = cargosDoAno.filter((c) => c.status === col.status);
            return (
              <div key={col.status} className="card-surface flex flex-col p-3">
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className={cn("text-[10.5px] font-bold uppercase tracking-wider", col.status === "vaga_aberta" ? "text-primary" : col.status === "contratado" ? "text-success" : "text-muted-foreground")}>
                    {col.label}
                  </span>
                  <span className="num rounded border border-border px-1.5 text-[10px] text-muted-foreground">{items.length}</span>
                </div>
                <div className={cn("flex-1 space-y-2 rounded-lg", !items.length && "flex min-h-[200px] items-center justify-center border-2 border-dashed border-border/60 p-3")}>
                  {items.length ? items.map((c) => {
                    const acao = ACAO[c.status];
                    return (
                      <div key={c.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold text-foreground">{c.titulo}</div>
                            {c.alvo && <div className="text-[11px] text-muted-foreground">Alvo {c.alvo}</div>}
                          </div>
                          <button onClick={() => abrirEdicao(c)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Editar">
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {c.prioridade && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{c.prioridade}</span>}
                          {c.senioridade && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{c.senioridade}</span>}
                          {c.custo_mensal != null && <span className="num rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold">{fmtBRL0(c.custo_mensal)}</span>}
                        </div>
                        {acao && (
                          <button
                            onClick={() => {
                              if (acao.prox === "efetivo" && !c.pessoa) { toast.message("Preencha quem foi contratado antes de efetivar."); abrirEdicao(c); return; }
                              moverStatus(c, acao.prox);
                            }}
                            className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-[11.5px] font-semibold text-primary transition hover:bg-primary/10"
                          >
                            {acao.rotulo} <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  }) : (
                    <p className="px-2 text-center text-[11.5px] text-muted-foreground">{col.vazio}</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Próximos passos */}
          <div className="card-surface p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-[13.5px] font-semibold">Próximos passos do time</span>
            </div>
            <div className="mt-3 space-y-2">
              {passos.map((p) => (
                <div key={p.id} className="group flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={p.done}
                    onChange={() => togglePasso(p)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                  />
                  <span className={cn("flex-1 text-[12.5px] leading-snug", p.done ? "text-muted-foreground line-through" : "text-foreground")}>{p.texto}</span>
                  <button onClick={() => removerPasso(p)} className="rounded p-0.5 text-muted-foreground/50 opacity-0 transition hover:text-destructive group-hover:opacity-100" title="Remover">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {!passos.length && <p className="text-[12px] text-muted-foreground">Nenhum passo — adicione abaixo.</p>}
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <input
                value={novoPasso}
                onChange={(e) => setNovoPasso(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPasso()}
                placeholder="Novo passo… (Enter)"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-[12px] outline-none focus:ring-1 focus:ring-primary"
              />
              <button onClick={addPasso} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:brightness-110">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Rituais ---------------- */}
      {tab === "rituais" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[14px] font-semibold text-foreground">Rituais e reuniões</div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Cadência mensal do financeiro + reuniões táticas e estratégicas (tipo, periodicidade e pauta).</p>
            </div>
            <button onClick={abrirNovoRitual} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12.5px] font-semibold text-primary-foreground shadow-sm transition hover:brightness-110">
              <Plus className="h-4 w-4" /> Novo ritual / reunião
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rituais.map((r) => (
              <div key={r.id} className="card-surface group flex flex-col border-t-2 border-t-primary p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", tipoRitualBadge(r.tipo))}>
                    {r.tipo || "Ritual"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {r.periodicidade && <span className="text-[11px] font-medium text-muted-foreground">{r.periodicidade}</span>}
                    <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => abrirEdicaoRitual(r)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Editar"><Pencil className="h-3 w-3" /></button>
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[14px] font-semibold text-foreground">{r.titulo}</div>
                {r.descricao && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{r.descricao}</p>}
                {r.pauta.length > 0 && (
                  <div className="mt-2.5 border-t border-border/50 pt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">Pauta</div>
                    <ul className="mt-1 space-y-0.5">
                      {r.pauta.map((it, j) => (
                        <li key={j} className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/60" />{it}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
            {!rituais.length && (
              <div className="card-surface col-span-full p-8 text-center text-[13px] text-muted-foreground">
                Nenhum ritual — clique em “Novo ritual / reunião”.
              </div>
            )}
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-[12.5px] leading-relaxed text-foreground">
              <span className="font-semibold">Cadência mensal do financeiro</span> — cada semana tem um ritual fixo; os cortes de caixa dos dias 15, 20 e 25 e o fechamento acumulado atravessam todas as semanas.
            </p>
          </div>
        </div>
      )}

      {/* ---------------- IA & Automação ---------------- */}
      {tab === "ia" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,440px)_1fr]">
            <div className="card-surface bg-secondary/30 p-5">
              <div className="text-center">
                <div className="text-[14px] font-bold tracking-wide text-foreground">PIRÂMIDE DE MATURIDADE FINANCEIRA</div>
                <div className="text-[11.5px] text-primary">Roadmap de Implementação de IA no Financeiro</div>
              </div>
              <div className="mt-3">
                <Piramide sel={nivelSel} onSel={setNivelSel} />
              </div>
            </div>

            <div className="card-surface flex flex-col p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-bold text-white" style={{ background: NIVEL_COR[nivel.n - 1] }}>
                  {nivel.n}
                </span>
                <span className="text-[16px] font-semibold text-foreground">Nível {nivel.n} — {nivel.nome}</span>
                {nivel.n === NIVEL_ATUAL && (
                  <span className="ml-auto rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-success">NÍVEL ATUAL DO TIME</span>
                )}
              </div>
              <ul className="mt-4 space-y-2 pl-5">
                {nivel.bullets.map((b, i) => (
                  <li key={i} className="list-disc text-[13px] leading-relaxed text-foreground">{b}</li>
                ))}
              </ul>
              <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3 text-[12.5px] text-muted-foreground">
                <Zap className="h-4 w-4 text-primary" />
                {autosNivel > 0
                  ? <>{autosNivel} automações deste nível já rodando no Hub</>
                  : <>Nenhuma automação deste nível em produção ainda</>}
              </div>
            </div>
          </div>

          {/* Roadmap & Catálogo de Automações (antes era o menu "Catálogo") */}
          <div className="card-surface p-4">
            <AutomacoesCatalogo embedded />
          </div>
        </div>
      )}

      {/* ---------------- Padrão de Mercado ---------------- */}
      {tab === "padrao" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Pirâmide de obrigações macro */}
            <div className="card-surface bg-secondary/30 p-5">
              <div className="text-center">
                <div className="text-[14px] font-bold tracking-wide text-foreground">OBRIGAÇÕES MACRO DO DEPARTAMENTO FINANCEIRO</div>
                <div className="text-[11.5px] text-primary">Referência de mercado — quem responde por quê</div>
              </div>
              <div className="mt-3"><PiramideMacro sel={macroSel} onSel={setMacroSel} /></div>
              <p className="mt-1 text-center text-[11.5px] text-muted-foreground">Clique em uma camada para ver as obrigações</p>
            </div>

            {/* Detalhe da camada selecionada */}
            {(() => {
              const m = OBRIGACOES_MACRO[macroSel];
              return (
                <div className="card-surface flex flex-col p-5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="rounded px-2 py-0.5 text-[10px] font-bold tracking-wider text-white" style={{ background: MACRO_COR[macroSel] }}>{m.eyebrow}</span>
                    <span className="text-[17px] font-bold text-foreground">{m.role}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{m.subtitle}</p>
                  <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {m.bullets.map((b, i) => (
                      <div key={i} className="flex items-start gap-2 text-[13px] text-foreground">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: MACRO_COR[macroSel] }} />
                        {b}
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3 text-[12.5px] text-muted-foreground">
                    <ShieldCheck className="h-4 w-4" style={{ color: MACRO_COR[macroSel] }} /> {m.footer}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Estrutura padrão em 3 pilares */}
          <div className="card-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                <span className="text-[14px] font-semibold">Estrutura padrão de um departamento financeiro</span>
              </div>
              <span className="text-[11.5px] text-muted-foreground">Diretoria Financeira → 3 pilares · clique para abrir as atribuições</span>
            </div>
            <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
              {PILARES.map((p) => (
                <div key={p.nome} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex items-center justify-between border-b-2 border-primary px-3 py-2.5">
                    <span className="text-[13.5px] font-bold text-primary">{p.nome}</span>
                    <span className="num rounded bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">{p.grupos.length}</span>
                  </div>
                  <div className="space-y-2 p-2.5">
                    {p.grupos.map((g) => {
                      const key = `${p.nome}::${g.titulo}`;
                      const aberto = gruposAbertos.has(key);
                      return (
                        <div key={key} className="overflow-hidden rounded-lg border border-primary/15">
                          <button onClick={() => toggleGrupo(key)} className="flex w-full items-center gap-2 bg-primary/5 px-2.5 py-2 text-left transition-colors hover:bg-primary/10">
                            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-primary transition-transform", !aberto && "-rotate-90")} />
                            <span className="text-[12.5px] font-semibold text-foreground">{g.titulo}</span>
                          </button>
                          {aberto && (
                            <ul className="space-y-1 px-3 py-2">
                              {g.itens.map((it, j) => (
                                <li key={j} className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
                                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                                  {it}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Escopo do Financeiro (matriz de trilhas) ---------------- */}
      {tab === "escopo" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[16px] font-semibold text-foreground">Árvore de competências do financeiro</div>
              <p className="mt-0.5 max-w-2xl text-[12px] text-muted-foreground">
                Cada trilha corre da esquerda para a direita: o que já roda hoje, o que estamos desbloqueando e o que fica para os próximos anos. Clique num nó para acender a corrente de dependências dele.
              </p>
            </div>
            <button onClick={() => abrirNovoEscopo(PILARES_ESCOPO[0].nome)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12.5px] font-semibold text-primary-foreground shadow-sm transition hover:brightness-110">
              <Plus className="h-4 w-4" /> Nova competência
            </button>
          </div>

          {/* Resumo de cobertura */}
          <div className="card-surface flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
            <div className="flex items-center gap-3">
              <div className="num text-[34px] font-bold leading-none text-foreground">{escKpi.cobertura}%</div>
              <div className="flex h-2.5 w-40 overflow-hidden rounded-full bg-muted sm:w-64">
                <div className="h-full bg-success" style={{ width: `${(100 * escKpi.hoje) / (escKpi.total || 1)}%` }} />
                <div className="h-full bg-amber-500" style={{ width: `${(100 * escKpi.constr) / (escKpi.total || 1)}%` }} />
                <div className="h-full bg-muted-foreground/25" style={{ width: `${(100 * escKpi.fut) / (escKpi.total || 1)}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /><b className="text-foreground">{escKpi.hoje}</b> dominadas</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /><b className="text-foreground">{escKpi.constr}</b> em construção</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground/40" /><b className="text-foreground">{escKpi.fut}</b> ambições futuras</span>
              <span>· {escKpi.total} competências no escopo · em construção conta meio ponto</span>
            </div>
          </div>

          {/* Filtros */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={escBusca}
                  onChange={(e) => setEscBusca(e.target.value)}
                  placeholder="Buscar competência…"
                  className="h-8 w-52 rounded-md border border-border bg-card pl-7 pr-2 text-[12px] outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <Chip active={!escPilarFiltro} onClick={() => setEscPilarFiltro("")}>Todos os pilares</Chip>
              {PILARES_ESCOPO.map((p) => (
                <Chip key={p.nome} active={escPilarFiltro === p.nome} onClick={() => setEscPilarFiltro(escPilarFiltro === p.nome ? "" : p.nome)}>{p.nome}</Chip>
              ))}
              <span className="ml-auto text-[11.5px] text-muted-foreground">{escFolhasVisiveis.length} de {escFolhas.length} competências visíveis</span>
            </div>
            {respExistentes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip active={!escRespFiltro} onClick={() => setEscRespFiltro("")}>Todos</Chip>
                {respExistentes.map((r) => (
                  <Chip key={r} active={escRespFiltro === r} onClick={() => setEscRespFiltro(escRespFiltro === r ? "" : r)}>{r}</Chip>
                ))}
                <Chip active={escRespFiltro === "__sem"} onClick={() => setEscRespFiltro(escRespFiltro === "__sem" ? "" : "__sem")}>Sem responsável</Chip>
              </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
            {/* Matriz de trilhas */}
            <div className="card-surface overflow-hidden p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[900px]">
                  {/* Cabeçalho dos horizontes */}
                  <div className="grid grid-cols-[168px_repeat(4,minmax(180px,1fr))] border-b border-border bg-secondary/40">
                    <div className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trilha</div>
                    {HORIZONTES.map((h, i) => {
                      const count = escFolhasVisiveis.filter(h.match).length;
                      const dot = i === 0 ? "bg-success" : i === 1 ? "bg-amber-500" : "bg-muted-foreground/50";
                      return (
                        <div key={h.key} className="border-l border-border/60 p-3">
                          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                            <span className={cn("h-2 w-2 rounded-full", dot)} /> {h.label}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{h.sub} · {count} {count === 1 ? "item" : "itens"}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Pilares e trilhas */}
                  {PILARES_ESCOPO.map((p) => {
                    if (escPilarFiltro && escPilarFiltro !== p.nome) return null;
                    const nos = escopos.filter((e) => e.pilar === p.nome);
                    const troncos = nos.filter((e) => !e.parent_id).sort((a, b) => a.ordem - b.ordem);
                    const troncosShow = troncos.filter((t) => !escFiltroAtivo || nos.some((x) => x.parent_id === t.id && escPassa(x)));
                    if (!troncosShow.length) return null;
                    const cob = coberturaPilar(p.nome);
                    const recolhido = escRecolhidos.has(p.nome);
                    return (
                      <div key={p.nome}>
                        {/* Faixa do pilar (clique recolhe/expande as trilhas) */}
                        <div className="flex items-center gap-2 border-b border-border/60 bg-secondary/20 px-3 py-2">
                          <button onClick={() => toggleEscPilar(p.nome)} className="flex min-w-0 items-center gap-2 text-left" title={recolhido ? "Expandir" : "Recolher"}>
                            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", recolhido && "-rotate-90")} />
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white" style={{ background: p.cor }}>
                              <p.Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-[13px] font-semibold text-foreground">{p.nome}</span>
                            <span className="hidden text-[11px] text-muted-foreground sm:inline">· {recolhido ? `${troncosShow.length} trilhas` : p.sub}</span>
                          </button>
                          <div className="ml-auto flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full" style={{ width: `${cob.pct}%`, background: p.cor }} />
                            </div>
                            <span className="num text-[10.5px] font-semibold text-muted-foreground">{cob.hoje}/{cob.total}</span>
                            <button onClick={() => abrirNovoEscopo(p.nome)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary" title={`Nova trilha em ${p.nome}`}><Plus className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>

                        {/* Uma linha por trilha (tronco) */}
                        {!recolhido && troncosShow.map((t) => {
                          const folhas = nos.filter((x) => x.parent_id === t.id).sort((a, b) => a.ordem - b.ordem);
                          const folhasVis = folhas.filter((f) => !escFiltroAtivo || escPassa(f));
                          const feitos = folhas.filter((f) => f.status === "hoje").length;
                          const tm = ESCOPO_META[t.status];
                          const dimT = !!escChain && !escChain.has(t.id);
                          return (
                            <div key={t.id} className="grid grid-cols-[168px_repeat(4,minmax(180px,1fr))] border-b border-border/40 last:border-b-0">
                              <div className={cn("group/tr flex items-start gap-1.5 p-2.5 transition", dimT && "opacity-30")}>
                                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", tm.dot)} />
                                <button onClick={() => toggleEscSel(t.id)} className="min-w-0 flex-1 text-left" title="Acender a corrente de dependências">
                                  <div className="text-[12px] font-semibold leading-tight text-foreground">{t.titulo}</div>
                                </button>
                                <button onClick={() => abrirNovoEscopo(p.nome, t.id)} className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-primary group-hover/tr:opacity-100" title="Adicionar competência nesta trilha"><Plus className="h-3 w-3" /></button>
                                <span className="num shrink-0 rounded bg-muted px-1 py-0.5 text-[9.5px] font-semibold text-muted-foreground">{feitos}/{folhas.length}</span>
                              </div>
                              {HORIZONTES.map((h) => (
                                <div key={h.key} className="space-y-1.5 border-l border-border/40 p-2">
                                  {folhasVis.filter(h.match).map((e) => (
                                    <EscopoCard key={e.id} e={e} dim={!!escChain && !escChain.has(e.id)} selected={escSelId === e.id} onSel={toggleEscSel} onEdit={abrirEdicaoEscopo} onAvancar={avancarEscopo} />
                                  ))}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {!escFolhasVisiveis.length && (
                    <div className="p-10 text-center text-[12.5px] text-muted-foreground">Nenhuma competência bate com os filtros.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Painel lateral */}
            <div className="space-y-3">
              <div className="card-surface p-4">
                <div className="eyebrow">Próximo a desbloquear</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">As competências em construção com dependência já dominada — são as que dão retorno mais rápido.</p>
                <div className="mt-3 space-y-2">
                  {escProximos.map((e, i) => (
                    <button key={e.id} onClick={() => { setEscSelId(e.id); setEscPilarFiltro(""); setEscRespFiltro(""); }} className="flex w-full items-start gap-2 rounded-md border border-border/70 p-2 text-left transition hover:border-primary/40 hover:bg-muted/40">
                      <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-600 dark:text-amber-400">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-foreground">{e.titulo}</div>
                        <div className="truncate text-[10.5px] text-muted-foreground">{e.pilar} · {escById.get(e.parent_id!)?.titulo ?? "—"} · {e.responsavel ?? "sem responsável"}</div>
                      </div>
                    </button>
                  ))}
                  {!escProximos.length && <div className="text-[11.5px] text-muted-foreground">Nada em construção agora.</div>}
                </div>
              </div>

              <div className="card-surface p-4">
                <div className="eyebrow">Sem responsável</div>
                <div className="num mt-1 text-[28px] font-bold leading-none text-foreground">{semResp}<span className="text-[13px] font-medium text-muted-foreground"> de {escFolhas.length} competências</span></div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">Nenhum dono definido — a maioria delas está em 1–2 e 3–5 anos. Vale nomear um responsável antes de virar meta.</p>
                <button onClick={() => setEscRespFiltro(escRespFiltro === "__sem" ? "" : "__sem")} className="mt-3 w-full rounded-md border border-border py-1.5 text-[12px] font-semibold text-foreground transition hover:bg-muted">
                  {escRespFiltro === "__sem" ? "Mostrar todas" : "Ver só as sem responsável"}
                </button>
              </div>

              <div className="card-surface p-4">
                <div className="eyebrow">Como ler</div>
                <div className="mt-2 space-y-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  <p>A coluna da esquerda é a trilha; os nós andam para a direita conforme o horizonte.</p>
                  <p>O contorno tracejado marca o que ainda não existe.</p>
                  <p>Clique num nó para acender a corrente de dependências dele.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Dialog: novo/editar cargo ---------------- */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar cargo / vaga" : "Novo cargo / vaga"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[12px]">Título do cargo *</Label>
              <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="ex.: Analista FP&A" className="mt-1 h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px]">Pessoa (se ocupado)</Label>
                <Input value={form.pessoa} onChange={(e) => setForm({ ...form, pessoa: e.target.value })} placeholder="ex.: Júlia" className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-[12px]">Senioridade</Label>
                <Input value={form.senioridade} onChange={(e) => setForm({ ...form, senioridade: e.target.value })} placeholder="Pleno" className="mt-1 h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px]">Status</Label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as Status })}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="planejado">Planejado (futuro)</option>
                  <option value="vaga_aberta">Vaga aberta</option>
                  <option value="entrevista">Em entrevista</option>
                  <option value="contratado">Contratado</option>
                  <option value="efetivo">Efetivo</option>
                </select>
              </div>
              <div>
                <Label className="text-[12px]">Prioridade</Label>
                <select
                  value={form.prioridade}
                  onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">—</option>
                  <option value="Alta">Alta</option>
                  <option value="Média">Média</option>
                  <option value="Baixa">Baixa</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px]">Custo mensal (R$)</Label>
                <Input value={form.custo_mensal} onChange={(e) => setForm({ ...form, custo_mensal: e.target.value })} placeholder="8000" className="mt-1 h-9" inputMode="decimal" />
              </div>
              <div>
                <Label className="text-[12px]">Ano do card</Label>
                <select
                  value={form.alvo}
                  onChange={(e) => setForm({ ...form, alvo: e.target.value })}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Todos os anos</option>
                  {ANOS.map((a) => <option key={a} value={String(a)}>{a}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-[12px]">Reporta a</Label>
              <select
                value={form.parent_id}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— (topo do organograma)</option>
                {cargosDoAno.filter((c) => c.id !== editId).map((c) => (
                  <option key={c.id} value={c.id}>{c.titulo}{c.pessoa ? ` (${c.pessoa})` : ""}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between pt-1">
              {editId ? (
                <button onClick={excluirCargo} className="inline-flex items-center gap-1 text-[12px] text-destructive hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={() => setDlgOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted">
                  Cancelar
                </button>
                <button onClick={salvarCargo} disabled={salvando} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-60">
                  {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------- Dialog: gerenciar atribuições ---------------- */}
      <Dialog open={atbDlgOpen} onOpenChange={setAtbDlgOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Atribuições — {atbCargo?.titulo}</DialogTitle>
          </DialogHeader>

          <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
            {/* Puxar de outro cargo */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                <Download className="h-4 w-4 text-primary" /> Puxar responsabilidades de outro cargo
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={pullSourceId}
                  onChange={(e) => { setPullSourceId(e.target.value); setPullSel(new Set()); }}
                  className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Escolher cargo de origem…</option>
                  {cargosDoAno.filter((c) => c.id !== atbCargoId).map((c) => (
                    <option key={c.id} value={c.id}>{c.titulo}{c.pessoa ? ` (${c.pessoa})` : ""}</option>
                  ))}
                </select>
                {pullSourceId && (
                  <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
                    {(["copiar", "mover"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setPullMode(m)}
                        className={cn("rounded px-2.5 py-1 text-[11.5px] font-medium transition", pullMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                        title={m === "copiar" ? "Mantém no cargo de origem" : "Remove do cargo de origem"}
                      >
                        {m === "copiar" ? "Copiar" : "Mover"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {pullSourceId && (
                <>
                  <div className="mt-2 max-h-44 space-y-2 overflow-y-auto rounded-md border border-border bg-card p-2">
                    {displaySource.length ? displaySource.map((g, gi) => (
                      <div key={gi}>
                        <div className="text-[11.5px] font-semibold text-foreground">{g.titulo}</div>
                        {g.itens.length ? g.itens.map((it, ii) => {
                          const key = `${gi}:${ii}`;
                          return (
                            <label key={ii} className="flex cursor-pointer items-start gap-2 py-0.5 pl-2 text-[12px] text-muted-foreground hover:text-foreground">
                              <input type="checkbox" checked={pullSel.has(key)} onChange={() => togglePull(key)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary" />
                              {itxt(it)}
                            </label>
                          );
                        }) : <div className="pl-2 text-[11px] text-muted-foreground/60">(sem itens)</div>}
                      </div>
                    )) : <div className="text-[12px] text-muted-foreground">Nada para puxar.</div>}
                  </div>
                  <button
                    onClick={() => aplicarPull(displaySource)}
                    disabled={!pullSel.size}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
                  >
                    {pullMode === "copiar" ? <Copy className="h-3.5 w-3.5" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                    {pullMode === "copiar" ? "Copiar" : "Mover"} {pullSel.size || ""} para {atbCargo?.titulo}
                  </button>
                </>
              )}
            </div>

            {/* Blocos editáveis */}
            <div className="space-y-3">
              {atbDraft.map((g, i) => (
                <div key={i} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="num text-[11px] font-bold text-primary">{String(i + 1).padStart(2, "0")}</span>
                    <input
                      value={g.titulo}
                      onChange={(e) => setBlocoTitulo(i, e.target.value)}
                      placeholder="Título do bloco"
                      className="h-8 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] font-semibold outline-none hover:border-border focus:border-primary focus:bg-card"
                    />
                    <button onClick={() => removeBloco(i)} className="rounded p-1 text-muted-foreground hover:text-destructive" title="Remover bloco">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 space-y-1 pl-6">
                    {g.itens.map((it, j) => {
                      const tr = itransf(it);
                      return (
                        <div key={j} className="flex items-center gap-1.5">
                          <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                          <input
                            value={itxt(it)}
                            onChange={(e) => setItem(i, j, e.target.value)}
                            placeholder="Responsabilidade"
                            className="h-7 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[12px] outline-none hover:border-border focus:border-primary focus:bg-card"
                          />
                          {tr && (
                            <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded bg-amber-500/15 px-1 text-[9.5px] font-semibold text-amber-600 dark:text-amber-400" title={`A caminho de ${tr.paraNome ?? "outro cargo"}`}>
                              <ArrowRightLeft className="h-2.5 w-2.5" /> {tr.paraNome ?? "transf."}
                            </span>
                          )}
                          <button onClick={() => removeItem(i, j)} className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive" title="Remover item">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    <button onClick={() => addItem(i)} className="inline-flex items-center gap-1 pl-1 text-[11.5px] text-primary hover:underline">
                      <Plus className="h-3 w-3" /> adicionar item
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={addBloco} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-[12px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
                <Plus className="h-3.5 w-3.5" /> Adicionar bloco
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button onClick={() => setAtbDlgOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted">Cancelar</button>
            <button onClick={salvarAtribuicoes} disabled={salvandoAtb} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-60">
              {salvandoAtb && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar atribuições
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------- Dialog: novo/editar ritual ---------------- */}
      <Dialog open={rituDlgOpen} onOpenChange={setRituDlgOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{rituEditId ? "Editar ritual / reunião" : "Novo ritual / reunião"}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
            <div>
              <Label className="text-[12px]">Título *</Label>
              <Input value={rituForm.titulo} onChange={(e) => setRituForm({ ...rituForm, titulo: e.target.value })} placeholder="ex.: Reunião Tática Semanal" className="mt-1 h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px]">Tipo</Label>
                <Input value={rituForm.tipo} onChange={(e) => setRituForm({ ...rituForm, tipo: e.target.value })} placeholder="Tática / Estratégica" list="tipos-ritual" className="mt-1 h-9" />
                <datalist id="tipos-ritual">
                  <option value="Tática" /><option value="Estratégica" /><option value="Operacional" /><option value="Cadência mensal" />
                </datalist>
              </div>
              <div>
                <Label className="text-[12px]">Periodicidade</Label>
                <Input value={rituForm.periodicidade} onChange={(e) => setRituForm({ ...rituForm, periodicidade: e.target.value })} placeholder="Semanal / Mensal" list="periodos-ritual" className="mt-1 h-9" />
                <datalist id="periodos-ritual">
                  <option value="Semanal" /><option value="Quinzenal" /><option value="Mensal" /><option value="Trimestral" /><option value="Semana 1" /><option value="Semana 2" /><option value="Semana 3" /><option value="Semana 4" />
                </datalist>
              </div>
            </div>
            <div>
              <Label className="text-[12px]">Descrição</Label>
              <Input value={rituForm.descricao} onChange={(e) => setRituForm({ ...rituForm, descricao: e.target.value })} placeholder="Resumo do objetivo da reunião" className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-[12px]">Pauta</Label>
              <div className="mt-1 space-y-1.5">
                {rituForm.pauta.map((it, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    <Input value={it} onChange={(e) => setPautaItem(i, e.target.value)} placeholder={`Tópico ${i + 1}`} className="h-8 flex-1" />
                    <button onClick={() => removePautaItem(i)} className="rounded p-1 text-muted-foreground/60 hover:text-destructive" title="Remover"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                <button onClick={addPautaItem} className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline">
                  <Plus className="h-3 w-3" /> adicionar tópico
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              {rituEditId ? (
                <button onClick={excluirRitual} className="inline-flex items-center gap-1 text-[12px] text-destructive hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={() => setRituDlgOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted">Cancelar</button>
                <button onClick={salvarRitual} disabled={salvandoRitu} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-60">
                  {salvandoRitu && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------- Dialog: nova/editar competência (escopo) ---------------- */}
      <Dialog open={escDlgOpen} onOpenChange={setEscDlgOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{escEditId ? "Editar competência" : "Nova competência"}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
            <div>
              <Label className="text-[12px]">Título *</Label>
              <Input value={escForm.titulo} onChange={(e) => setEscForm({ ...escForm, titulo: e.target.value })} placeholder="ex.: Contas a receber estruturado" className="mt-1 h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px]">Pilar</Label>
                <select value={escForm.pilar} onChange={(e) => setEscForm({ ...escForm, pilar: e.target.value, parent_id: "" })} className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary">
                  {PILARES_ESCOPO.map((p) => <option key={p.nome} value={p.nome}>{p.nome}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[12px]">Status</Label>
                <select value={escForm.status} onChange={(e) => setEscForm({ ...escForm, status: e.target.value as EscopoStatus })} className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary">
                  <option value="hoje">Hoje (dominado)</option>
                  <option value="construindo">Em construção</option>
                  <option value="futuro">Futuro (a desbloquear)</option>
                </select>
              </div>
            </div>
            {escForm.status === "futuro" && (
              <div>
                <Label className="text-[12px]">Horizonte</Label>
                <select value={escForm.horizonte} onChange={(e) => setEscForm({ ...escForm, horizonte: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary">
                  <option value="curto">1–2 anos (próxima fronteira)</option>
                  <option value="longo">3–5 anos (ambição de longo prazo)</option>
                </select>
              </div>
            )}
            <div>
              <Label className="text-[12px]">Depende de</Label>
              <select value={escForm.parent_id} onChange={(e) => setEscForm({ ...escForm, parent_id: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-[13px] outline-none focus:ring-1 focus:ring-primary">
                <option value="">— (tronco do pilar)</option>
                {escParentOpts.map((e) => <option key={e.id} value={e.id}>{e.parent_id ? "↳ " : ""}{e.titulo}</option>)}
              </select>
              <p className="mt-1 text-[10.5px] text-muted-foreground">Pendure a competência num tronco (ex.: Gestão de Caixa) ou deixe como tronco do pilar.</p>
            </div>
            <div>
              <Label className="text-[12px]">Descrição</Label>
              <Input value={escForm.descricao} onChange={(e) => setEscForm({ ...escForm, descricao: e.target.value })} placeholder="O que essa competência envolve" className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-[12px]">Responsável (opcional)</Label>
              <Input value={escForm.responsavel} onChange={(e) => setEscForm({ ...escForm, responsavel: e.target.value })} placeholder="ex.: Júlia" className="mt-1 h-9" />
            </div>
            <div className="flex items-center justify-between pt-1">
              {escEditId ? (
                <button onClick={excluirEscopo} className="inline-flex items-center gap-1 text-[12px] text-destructive hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={() => setEscDlgOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted">Cancelar</button>
                <button onClick={salvarEscopo} disabled={salvandoEsc} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-60">
                  {salvandoEsc && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
