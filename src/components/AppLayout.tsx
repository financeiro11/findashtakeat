import { Outlet, Navigate, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { PageHeader } from "@/components/PageHeader";
import { ProfileMenu } from "@/components/ProfileMenu";
import { AIAssistant } from "@/components/AIAssistant";
import { useAuth } from "@/hooks/useAuth";

export default function AppLayout() {
  const { user, profile, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;

  const isParcerias = (profile?.cargo ?? "").trim().toLowerCase() === "parcerias";
  if (isParcerias && !pathname.startsWith("/operacional/parceiros")) {
    return <Navigate to="/operacional/parceiros" replace />;
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": "212px", "--sidebar-width-icon": "212px" } as React.CSSProperties}>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-30 flex items-center border-b border-border bg-card/95 backdrop-blur">
            <div className="flex-1"><PageHeader /></div>
            <div className="px-3"><ProfileMenu /></div>
          </div>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
        {!isParcerias && <AIAssistant />}
      </div>
    </SidebarProvider>
  );
}
