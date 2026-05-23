import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Radar, Kanban, CalendarDays, History, Settings, Sparkles, Activity, Filter, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/editais", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/editais/radar", label: "Radar", icon: Radar },
  { to: "/editais/triagem", label: "Triagem", icon: Filter },
  { to: "/editais/pipeline", label: "Pipeline", icon: Kanban },
  { to: "/editais/projetos-aprovados", label: "Radar de Editais", icon: CheckCircle2 },
  { to: "/editais/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/editais/historico", label: "Histórico", icon: History },
  { to: "/editais/monitor", label: "Monitor", icon: Activity },
  { to: "/editais/configuracoes", label: "Configurações", icon: Settings },
];

export default function EditaisLayout() {
  const { pathname } = useLocation();
  const current = items.find(i => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  const hideTopBar = pathname.startsWith("/editais/projetos-aprovados");

  return (
    <div className="min-h-[calc(100vh-49px)] flex flex-col">
      {/* Top bar com brand + tabs */}
      {!hideTopBar && (
      <div className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="px-6 pt-3 pb-0 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-primary to-primary/60 grid place-items-center text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight">Editais</span>
              <span className="text-[10px] uppercase tracking-wider text-rose-600 font-semibold bg-rose-500/10 px-1.5 py-0.5 rounded">Radar IA</span>
            </div>
            <div className="text-xs text-muted-foreground ml-2">/ {current?.label ?? "Editais"}</div>
          </div>
        </div>

        <nav className="px-4 mt-2 flex items-center gap-0 overflow-x-auto">
          {items.map(it => {
            const Icon = it.icon;
            return (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) => cn(
                  "relative flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors whitespace-nowrap border-b-2 -mb-px",
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
      </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
