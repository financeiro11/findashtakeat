import { NavLink } from "react-router-dom";
import { Home, CheckSquare, Receipt, FileText, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { podeVerRota, type Acesso } from "@/lib/modules";

/** As seis abas do app. A ordem aqui é a ordem na barra. */
export const ABAS = [
  { url: "/", titulo: "Início", curto: "Início", icone: Home },
  { url: "/tarefas", titulo: "Tarefas", curto: "Tarefas", icone: CheckSquare },
  { url: "/extratos", titulo: "Extratos", curto: "Extratos", icone: Receipt },
  { url: "/notas", titulo: "Notas", curto: "Notas", icone: FileText },
  { url: "/chat", titulo: "Assistente", curto: "Chat", icone: Sparkles },
  { url: "/perfil", titulo: "Perfil", curto: "Perfil", icone: User },
] as const;

export type Aba = (typeof ABAS)[number];

/* As abas passam pelo MESMO portão do desktop (lib/modules), pela URL de cada uma
   — Extratos é `conciliacao`, Tarefas e Notas são `time`, Início é `metricas`.
   Chat e Perfil não têm entrada no portão e sobram para todo mundo, que é o
   certo: sem elas a barra ficaria vazia para quem só tem uma capacidade. */
export function abasVisiveis(acesso: Acesso): readonly Aba[] {
  return ABAS.filter((a) => podeVerRota(acesso, a.url));
}

/** Onde este perfil pousa no celular — a primeira aba que ele alcança. */
export function primeiraAbaDe(acesso: Acesso): string {
  return abasVisiveis(acesso)[0]?.url ?? "/perfil";
}

export function tituloDaAba(pathname: string): string {
  const aba = ABAS.find((a) => (a.url === "/" ? pathname === "/" : pathname.startsWith(a.url)));
  return aba?.titulo ?? "Hub Financeiro";
}

export function MobileBottomNav({ acesso }: { acesso: Acesso }) {
  const abas = abasVisiveis(acesso);
  return (
    <nav
      className="shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
      aria-label="Navegação principal"
    >
      <ul className="flex h-14 items-stretch">
        {abas.map((aba) => (
          <li key={aba.url} className="flex-1">
            <NavLink
              to={aba.url}
              end={aba.url === "/"}
              className={({ isActive }) =>
                cn(
                  // 44px é o mínimo de alvo de toque; a célula inteira é clicável.
                  "flex h-full min-h-[44px] w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <aba.icone className={cn("h-5 w-5 shrink-0", isActive && "stroke-[2.5]")} />
                  {/* Com seis células, "Extratos" encosta nas bordas num aparelho de 320px. */}
                  <span className="w-full truncate px-0.5 text-center">{aba.curto}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
