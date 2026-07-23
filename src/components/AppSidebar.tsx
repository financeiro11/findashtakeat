import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Wallet, CreditCard, Users, Handshake, ListTree,
  Percent, BookOpen, UserCog, Smartphone, Plane, Settings,
  FolderKanban, FileBarChart, FileText, Scale, TrendingUp, Brain, Target, Home, Search, Sparkles, Gavel, CheckSquare, ChevronDown, BookOpenCheck, PieChart, Handshake as HandshakeIcon, CheckCircle2, Receipt, Undo2, Wallet2, ShieldCheck, Landmark,
  LayoutDashboard, Kanban, FileSpreadsheet, Truck, History, FileSignature, Wrench, Star,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import takeatLogo from "@/assets/takeat-logo.png";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { CommandMenu } from "@/components/CommandMenu";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { moduleAccess, currentModule } from "@/lib/modules";

type NavItem = { title: string; url: string; icon: any; badge?: string };

const inicio: NavItem[] = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Briefing", url: "/briefing", icon: Sparkles },
  { title: "Tarefas", url: "/tarefas", icon: CheckSquare },
  { title: "Caixa", url: "/caixa", icon: Landmark, badge: "OMIE" },
  { title: "Anotações", url: "/playbook", icon: BookOpenCheck },
  { title: "Projetos", url: "/automacoes/projetos", icon: FolderKanban },
];

const operacional: NavItem[] = [
  { title: "Asaas", url: "/asaas", icon: CreditCard },
  { title: "Parceiros", url: "/operacional/parceiros", icon: HandshakeIcon },
  { title: "Variável", url: "/operacional/variavel", icon: Percent },
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

const facilities: NavItem[] = [
  { title: "Dashboard", url: "/facilities", icon: LayoutDashboard },
  { title: "Solicitações", url: "/facilities/solicitacoes", icon: Kanban },
  { title: "Cotações", url: "/facilities/cotacoes", icon: FileSpreadsheet },
  { title: "Fornecedores", url: "/facilities/fornecedores", icon: Truck },
  { title: "Histórico", url: "/facilities/historico", icon: History },
  { title: "Contratos", url: "/facilities/contratos", icon: FileSignature },
];

const editais: NavItem[] = [
  { title: "Radar de Editais", url: "/editais", icon: Gavel },
  { title: "Projetos Aprovados", url: "/editais/projetos-aprovados", icon: CheckCircle2 },
];

const investimentos: NavItem[] = [
  { title: "Captable", url: "/captable", icon: PieChart },
  { title: "Takeat LTD/LLC", url: "/investimentos", icon: TrendingUp },
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

const FAVORITOS_KEY_PREFIX = "sidebar:favoritos:";

function useFavoritos(userId: string | undefined) {
  const key = FAVORITOS_KEY_PREFIX + (userId ?? "anon");
  const [favoritos, setFavoritos] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(key);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });

  const toggle = (url: string) => {
    setFavoritos((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* localStorage indisponível */ }
      return next;
    });
  };

  return { favoritos, toggle };
}

function Group({
  label, items, pathname, favoritos, onToggleFavorito, defaultOpen,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  favoritos?: Set<string>;
  onToggleFavorito?: (url: string) => void;
  defaultOpen?: boolean;
}) {
  const hasActive = items.some(i => pathname === i.url || pathname.startsWith(i.url + "/"));
  const [open, setOpen] = useState(defaultOpen ?? hasActive);

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
            const isFav = favoritos?.has(item.url) ?? false;
            return (
              <li key={item.url} className="group/item relative">
                <NavLink
                  to={item.url}
                  className={`group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  } ${onToggleFavorito ? "pr-7" : ""}`}
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
                {onToggleFavorito && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorito(item.url); }}
                    className={`absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded transition-opacity hover:bg-sidebar-accent/80 ${
                      isFav ? "opacity-100" : "opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
                    }`}
                    title={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                  >
                    <Star className={`h-3 w-3 ${isFav ? "fill-sidebar-primary text-sidebar-primary" : "text-sidebar-foreground/50"}`} />
                  </button>
                )}
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
  const { user, profile } = useAuth();
  const [cmdOpen, setCmdOpen] = useState(false);
  const initials = profile?.nome.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase() ?? "U";

  const access = moduleAccess(profile?.cargo);
  const mod = access.facilitiesOnly ? "facilities" : currentModule(pathname);
  const { favoritos, toggle: toggleFavorito } = useFavoritos(user?.id);

  // Pool de itens favoritáveis: só os do módulo/acesso atualmente visível, pra não
  // listar (nem deixar favoritar) rotas que este usuário não enxerga no menu.
  const pool: NavItem[] = access.parceriasOnly
    ? []
    : mod === "facilities"
    ? facilities
    : [...inicio, ...operacional, ...recargas, ...automacoes, ...editais, ...investimentos, ...demonstracoes, ...analise, ...governanca, ...config];
  const favoritosItems = pool.filter((i) => favoritos.has(i.url));

  return (
    <Sidebar collapsible="none" className="sticky top-0 h-screen border-r border-sidebar-border w-[212px] bg-sidebar text-sidebar-foreground">
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <SidebarContent className="flex flex-col bg-sidebar">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-sidebar-border px-3 py-3">
          <img src={takeatLogo} alt="Takeat" className="h-6 w-auto object-contain brightness-0 invert" />
          <span className="ml-1 text-[12.5px] font-medium text-sidebar-foreground/70">· Hub {mod === "facilities" ? "Facilities" : "Financeiro"}</span>
        </div>

        {/* Seletor de módulo (admins) ou selo estático (usuário exclusivo de Facilities) */}
        {access.canSwitch ? (
          <div className="px-2 pt-2">
            <ModuleSwitcher current={mod} access={access} />
          </div>
        ) : access.facilitiesOnly ? (
          <div className="px-2 pt-2">
            <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-[12.5px] text-sidebar-foreground">
              <Wrench className="h-4 w-4 text-sidebar-foreground/70" />
              <span><span className="text-sidebar-foreground/60">Módulo · </span><span className="font-semibold">Facilities</span></span>
            </div>
          </div>
        ) : null}

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
          {favoritosItems.length > 0 && (
            <Group
              label="Favoritos"
              items={favoritosItems}
              pathname={pathname}
              favoritos={favoritos}
              onToggleFavorito={toggleFavorito}
              defaultOpen
            />
          )}
          {access.parceriasOnly ? (
            <Group label="Operacional" items={operacional.filter(i => i.url === "/operacional/parceiros")} pathname={pathname} />
          ) : mod === "facilities" ? (
            <Group label="Facilities" items={facilities} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
          ) : (
            <>
              <Group label="Início" items={inicio} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Operacional" items={operacional} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Recargas" items={recargas} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Automações" items={automacoes} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Editais" items={editais} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Investimentos" items={investimentos} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Demonstrações" items={demonstracoes} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Análise Preditiva" items={analise} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Governança" items={governanca} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
              <Group label="Configurações" items={config} pathname={pathname} favoritos={favoritos} onToggleFavorito={toggleFavorito} />
            </>
          )}
        </div>

      </SidebarContent>
    </Sidebar>
  );
}
