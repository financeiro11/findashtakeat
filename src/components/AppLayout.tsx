import { useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { PageHeader } from "@/components/PageHeader";
import { ProfileMenu } from "@/components/ProfileMenu";
import { AIAssistant } from "@/components/AIAssistant";
import { NovaVersao } from "@/components/NovaVersao";
import { useAuth } from "@/hooks/useAuth";
import { moduleAccess, currentModule } from "@/lib/modules";

// Menu lateral recolhido. Quem guarda é esta camada: o SidebarProvider escreve um
// cookie que ele mesmo nunca lê de volta, então sem isto a escolha se perderia a cada
// recarga — e o menu recolhido é uma preferência de quem está na tela, não da sessão.
const MENU_KEY = "sidebar:recolhido";

export default function AppLayout() {
  const { user, profile, loading } = useAuth();
  const { pathname } = useLocation();
  const [menuAberto, setMenuAberto] = useState(() => {
    try { return localStorage.getItem(MENU_KEY) !== "1"; } catch { return true; }
  });
  const trocarMenu = (aberto: boolean) => {
    setMenuAberto(aberto);
    try { localStorage.setItem(MENU_KEY, aberto ? "0" : "1"); } catch { /* localStorage indisponível */ }
  };
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;

  const access = moduleAccess(profile?.cargo);

  // Parcerias: travado na área de parceiros (comportamento existente).
  if (access.parceriasOnly && !pathname.startsWith("/operacional/parceiros")) {
    return <Navigate to="/operacional/parceiros" replace />;
  }
  // Usuário exclusivo de Facilities: travado no módulo Facilities.
  if (access.facilitiesOnly && !pathname.startsWith("/facilities")) {
    return <Navigate to="/facilities" replace />;
  }
  // Sem acesso ao módulo Facilities: volta ao Hub Financeiro.
  if (pathname.startsWith("/facilities") && !access.modules.includes("facilities")) {
    return <Navigate to="/" replace />;
  }
  const isParcerias = access.parceriasOnly;
  const emFacilities = access.facilitiesOnly || currentModule(pathname) === "facilities";

  return (
    <SidebarProvider
      open={menuAberto}
      onOpenChange={trocarMenu}
      style={{ "--sidebar-width": menuAberto ? "212px" : "56px", "--sidebar-width-icon": "56px" } as React.CSSProperties}
    >
      {/* `data-chrome` marca o que é moldura do Hub, e não conteúdo da página.
          Quem imprime (hoje, a Revisão do Mês) esconde tudo isso para o PDF sair
          com o demonstrativo e nada em volta — ver o bloco @media print em
          index.css. Marcar aqui evita que cada página que queira imprimir tenha
          de conhecer a estrutura do layout por fora. */}
      <div className="flex min-h-screen w-full bg-background">
        <div data-chrome="sidebar" className="contents"><AppSidebar /></div>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Acima do cabeçalho e fora do `main`: o aviso não rola junto com a
              página nem entra no PDF de quem imprime (ver `data-chrome`). */}
          <div data-chrome="nova-versao" className="contents"><NovaVersao /></div>
          <div data-chrome="header" className="sticky top-0 z-30 flex items-center border-b border-border bg-card/95 backdrop-blur">
            <div className="flex-1"><PageHeader /></div>
            <div className="px-3"><ProfileMenu /></div>
          </div>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
        {!isParcerias && !emFacilities && (
          <div data-chrome="assistente" className="contents"><AIAssistant /></div>
        )}
      </div>
    </SidebarProvider>
  );
}
