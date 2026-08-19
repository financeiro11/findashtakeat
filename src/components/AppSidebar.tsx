import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Search, ChevronDown, Wrench, Star, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import takeatLogo from "@/assets/takeat-logo.png";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar, SidebarContent, useSidebar } from "@/components/ui/sidebar";
import { CommandMenu } from "@/components/CommandMenu";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { moduleAccess, currentModule } from "@/lib/modules";
// Os itens de menu moram em @/lib/navegacao — a busca (⌘K) lê o MESMO catálogo.
import { gruposVisiveis, itensDe, type NavGrupo, type NavItem } from "@/lib/navegacao";

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

/**
 * Menu recolhido: a linha vira só o ícone, e o nome — com o grupo na frente, porque
 * fora do grupo "Cartão" pode ser três telas diferentes — vai para o tooltip. A estrela
 * de favorito fica de fora: não cabe, e o que ela organiza (a ordem do menu) já está
 * aplicado aqui, com os favoritos no topo.
 */
function RailItem({ grupo, item, active }: { grupo: string; item: NavItem; active: boolean }) {
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={item.url}
            className={`relative flex h-8 items-center justify-center rounded-md transition-colors ${
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            }`}
          >
            {active && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[2px] rounded-r bg-sidebar-primary" />}
            <item.icon className="h-4 w-4 shrink-0" />
            {/* O selo (OMIE, OFX, IA) não cabe escrito; vira um ponto que só diz "tem algo aqui". */}
            {item.badge && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-[12px]">
          <span className="text-muted-foreground">{grupo} · </span>
          {item.title}
          {item.badge && <span className="ml-1 text-muted-foreground">({item.badge})</span>}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function Rail({ blocos, pathname }: { blocos: NavGrupo[]; pathname: string }) {
  return (
    // Rola, mas sem barra à vista: numa tira de 56px ela come um sexto da largura.
    <div className="flex-1 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {blocos.map((g, i) => (
        <div key={g.label}>
          {/* Sem o rótulo do grupo, é o filete que diz onde um assunto acaba e o outro começa. */}
          {i > 0 && <div className="mx-3 my-1.5 h-px bg-sidebar-border" />}
          <ul className="space-y-0.5 px-2">
            {g.items.map((item) => (
              <RailItem key={g.label + item.url} grupo={g.label} item={item} active={pathname === item.url} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BotaoRecolher({ recolhido, onClick }: { recolhido: boolean; onClick: () => void }) {
  const Icone = recolhido ? PanelLeftOpen : PanelLeftClose;
  const texto = recolhido ? "Expandir menu" : "Recolher menu";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={texto}
          className={`flex h-7 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground ${
            recolhido ? "w-full" : "ml-auto w-7 shrink-0"
          }`}
        >
          <Icone className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={recolhido ? "right" : "bottom"} className="text-[12px]">
        {texto} <span className="text-muted-foreground">· ⌘B</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const { user, profile } = useAuth();
  const [cmdOpen, setCmdOpen] = useState(false);
  // O estado (e o atalho ⌘B) vêm do SidebarProvider; quem persiste é o AppLayout.
  const { open, toggleSidebar } = useSidebar();
  const recolhido = !open;
  const initials = profile?.nome.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase() ?? "U";

  const access = moduleAccess(profile?.cargo);
  const mod = access.facilitiesOnly ? "facilities" : currentModule(pathname);
  const { favoritos, toggle: toggleFavorito } = useFavoritos(user?.id);

  const grupos = gruposVisiveis(access, mod);

  // Pool de itens favoritáveis: só os do módulo/acesso atualmente visível, pra não
  // listar (nem deixar favoritar) rotas que este usuário não enxerga no menu. Sai dos
  // mesmos grupos que são renderizados — quando era uma lista à parte, estrelar
  // "Revisão Mensal" ou um BP não fazia nada, porque esses dois grupos ficaram de fora.
  const pool: NavItem[] = access.parceriasOnly ? [] : itensDe(grupos);
  const favoritosItems = pool.filter((i) => favoritos.has(i.url));

  // Recolhido, a barra é uma tira de ícones — favoritos primeiro, depois os grupos na
  // mesma ordem do menu aberto, para que o lugar de cada tela continue sendo o mesmo.
  const blocosRail: NavGrupo[] = favoritosItems.length > 0
    ? [{ label: "Favoritos", items: favoritosItems }, ...grupos]
    : grupos;

  return (
    <Sidebar
      collapsible="none"
      className={`sticky top-0 h-screen border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out ${
        recolhido ? "w-[56px]" : "w-[212px]"
      }`}
    >
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <SidebarContent className="flex flex-col bg-sidebar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Header */}
        {/* Altura fixa: recolhida, a logo encolhe — a linha de baixo não pode subir junto. */}
        <div className={`flex h-12 items-center border-b border-sidebar-border ${recolhido ? "justify-center px-2" : "gap-2 px-3"}`}>
          <img
            src={takeatLogo}
            alt="Takeat"
            className={`object-contain brightness-0 invert ${recolhido ? "h-5 w-full" : "h-6 w-auto"}`}
          />
          {!recolhido && (
            <>
              <span className="ml-1 truncate text-[12.5px] font-medium text-sidebar-foreground/70">· Hub {mod === "facilities" ? "Facilities" : "Financeiro"}</span>
              <BotaoRecolher recolhido={false} onClick={toggleSidebar} />
            </>
          )}
        </div>

        {/* Recolhido, o botão de expandir toma o lugar do seletor de módulo. */}
        {recolhido && (
          <div className="px-2 pt-2">
            <BotaoRecolher recolhido onClick={toggleSidebar} />
          </div>
        )}

        {/* Seletor de módulo (admins) ou selo estático (usuário exclusivo de Facilities) */}
        {access.canSwitch ? (
          <div className="px-2 pt-2">
            <ModuleSwitcher current={mod} access={access} compacto={recolhido} />
          </div>
        ) : access.facilitiesOnly ? (
          <div className="px-2 pt-2">
            <div
              className={`flex items-center rounded-md border border-sidebar-border bg-sidebar-accent/40 text-[12.5px] text-sidebar-foreground ${
                recolhido ? "justify-center px-2 py-2" : "gap-2 px-2.5 py-2"
              }`}
              title={recolhido ? "Módulo · Facilities" : undefined}
            >
              <Wrench className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
              {!recolhido && (
                <span><span className="text-sidebar-foreground/60">Módulo · </span><span className="font-semibold">Facilities</span></span>
              )}
            </div>
          </div>
        ) : null}

        {/* Search */}
        <div className="px-2 py-2">
          {recolhido ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCmdOpen(true)}
                  aria-label="Buscar ou ir para…"
                  className="flex h-8 w-full items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-[12px]">
                Buscar ou ir para… <span className="text-muted-foreground">· ⌘K</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => setCmdOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-[12px] text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1 truncate text-left">Buscar ou ir para…</span>
              <kbd className="num rounded border border-sidebar-border bg-sidebar-accent/60 px-1 text-[10px]">⌘K</kbd>
            </button>
          )}
        </div>

        {recolhido ? (
          <Rail blocos={blocosRail} pathname={pathname} />
        ) : (
          <div className="flex-1 overflow-y-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
            {grupos.map((g) => (
              <Group
                key={g.label}
                label={g.label}
                items={g.items}
                pathname={pathname}
                // Quem só enxerga Parceiros não tem o que organizar: sem estrela.
                favoritos={access.parceriasOnly ? undefined : favoritos}
                onToggleFavorito={access.parceriasOnly ? undefined : toggleFavorito}
              />
            ))}
          </div>
        )}

      </SidebarContent>
    </Sidebar>
  );
}
