import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Wallet, CreditCard, Users, Handshake, ListTree,
  Percent, BookOpen, UserCog, Smartphone, Plane, Settings,
  FolderKanban, FileBarChart, FileText, Scale, TrendingUp, Brain, Target, Home, Search, Sparkles, Gavel, CheckSquare, ChevronDown, BookOpenCheck, PieChart, Handshake as HandshakeIcon, CheckCircle2, Receipt, Undo2, Wallet2, ShieldCheck,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import takeatLogo from "@/assets/takeat-logo.png";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { CommandMenu } from "@/components/CommandMenu";

type NavItem = { title: string; url: string; icon: any; badge?: string };

const inicio: NavItem[] = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Tarefas", url: "/tarefas", icon: CheckSquare },
  { title: "Playbook", url: "/playbook", icon: BookOpenCheck },
  { title: "Projetos", url: "/automacoes/projetos", icon: FolderKanban },
];

const operacional: NavItem[] = [
  { title: "Asaas", url: "/asaas", icon: CreditCard },
  { title: "Planilhamento", url: "/planilhamento/conta-corrente", icon: Wallet },
  { title: "Parceiros", url: "/operacional/parceiros", icon: HandshakeIcon },
  { title: "Reembolsos", url: "/operacional/reembolsos", icon: Receipt },
  { title: "Estornos", url: "/operacional/estornos", icon: Undo2 },
];

const recargas: NavItem[] = [
  { title: "Celulares", url: "/recargas/celulares", icon: Smartphone },
  { title: "Viagens", url: "/recargas/viagens", icon: Plane },
];

const automacoes: NavItem[] = [
  { title: "Proporcionais", url: "/automacoes/proporcionais", icon: Percent },
  { title: "Catálogo", url: "/automacoes/catalogo", icon: BookOpen },
];

const editais: NavItem[] = [
  { title: "Radar de Editais", url: "/editais", icon: Gavel },
  { title: "Projetos Aprovados", url: "/editais/projetos-aprovados", icon: CheckCircle2 },
];

const investimentos: NavItem[] = [
  { title: "Captable", url: "/captable", icon: PieChart },
];

const demonstracoes: NavItem[] = [
  { title: "DRE", url: "/demonstracoes/dre", icon: FileBarChart },
  { title: "DFC", url: "/demonstracoes/dfc", icon: TrendingUp },
  { title: "Balancete", url: "/demonstracoes/balancete", icon: FileText },
  { title: "Balanço", url: "/demonstracoes/balanco", icon: Scale },
];

const analise: NavItem[] = [
  { title: "Cenários", url: "/analise/cenarios", icon: Target },
  { title: "BP Anual", url: "/analise/bp", icon: FileBarChart },
  { title: "Histórico Multianual", url: "/analise/historico", icon: TrendingUp },
];

const governanca: NavItem[] = [
  { title: "Orçamento", url: "/orcamento", icon: Wallet2 },
  { title: "Auditoria", url: "/governanca/auditoria", icon: ShieldCheck },
];

const config: NavItem[] = [
  { title: "Usuários", url: "/usuarios", icon: UserCog },
  { title: "Biblioteca", url: "/analise/conhecimento", icon: Brain },
];

function Group({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
  const hasActive = items.some(i => pathname === i.url || pathname.startsWith(i.url + "/"));
  const [open, setOpen] = useState(hasActive);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="px-2 py-1">
      <CollapsibleTrigger className="group/trigger flex w-full items-center justify-between rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors">
        <span>{label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <ul className="space-y-0.5 mt-1">
          {items.map((item) => {
            const active = pathname === item.url;
            return (
              <li key={item.url}>
                <NavLink
                  to={item.url}
                  className={`group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[2px] rounded-r bg-sidebar-primary" />
                  )}
                  <item.icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground"}`} />
                  <span className="truncate">{item.title}</span>
                  {item.badge && (
                    <span className="num ml-auto rounded bg-sidebar-accent/70 px-1.5 text-[10px] font-semibold text-sidebar-accent-foreground">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const { profile } = useAuth();
  const [cmdOpen, setCmdOpen] = useState(false);
  const initials = profile?.nome.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase() ?? "U";

  return (
    <Sidebar collapsible="none" className="sticky top-0 h-screen border-r border-sidebar-border w-[212px] bg-sidebar text-sidebar-foreground">
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <SidebarContent className="flex flex-col bg-sidebar">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-sidebar-border px-3 py-3">
          <img src={takeatLogo} alt="Takeat" className="h-6 w-auto object-contain brightness-0 invert" />
          <span className="ml-1 text-[12.5px] font-medium text-sidebar-foreground/70">· Hub Financeiro</span>
        </div>

        {/* Search */}
        <div className="px-2 py-2">
          <button
            onClick={() => setCmdOpen(true)}
            className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-[12px] text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 truncate text-left">Buscar ou ir para…</span>
            <kbd className="num rounded border border-sidebar-border bg-sidebar-accent/60 px-1 text-[10px]">⌘K</kbd>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-3">
          {(profile?.cargo ?? "").trim().toLowerCase() === "parcerias" ? (
            <Group label="Operacional" items={operacional.filter(i => i.url === "/operacional/parceiros")} pathname={pathname} />
          ) : (
            <>
              <Group label="Início" items={inicio} pathname={pathname} />
              <Group label="Operacional" items={operacional} pathname={pathname} />
              <Group label="Recargas" items={recargas} pathname={pathname} />
              <Group label="Automações" items={automacoes} pathname={pathname} />
              <Group label="Editais" items={editais} pathname={pathname} />
              <Group label="Investimentos" items={investimentos} pathname={pathname} />
              <Group label="Demonstrações" items={demonstracoes} pathname={pathname} />
              <Group label="Análise Preditiva" items={analise} pathname={pathname} />
              <Group label="Governança" items={governanca} pathname={pathname} />
              <Group label="Configurações" items={config} pathname={pathname} />
            </>
          )}
        </div>

      </SidebarContent>
    </Sidebar>
  );
}
