import { Outlet, Navigate, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { PageHeader } from "@/components/PageHeader";
import { ProfileMenu } from "@/components/ProfileMenu";
import { AIAssistant } from "@/components/AIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { moduleAccess, currentModule } from "@/lib/modules";

export default function AppLayout() {
  const { user, profile, loading } = useAuth();
  const { pathname } = useLocation();
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
    <SidebarProvider style={{ "--sidebar-width": "212px", "--sidebar-width-icon": "212px" } as React.CSSProperties}>
      {/* `data-chrome` marca o que é moldura do Hub, e não conteúdo da página.
          Quem imprime (hoje, a Revisão do Mês) esconde tudo isso para o PDF sair
          com o demonstrativo e nada em volta — ver o bloco @media print em
          index.css. Marcar aqui evita que cada página que queira imprimir tenha
          de conhecer a estrutura do layout por fora. */}
      <div className="flex min-h-screen w-full bg-background">
        <div data-chrome="sidebar" className="contents"><AppSidebar /></div>
        <div className="flex min-w-0 flex-1 flex-col">
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
