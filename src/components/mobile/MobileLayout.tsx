import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { moduleAccess } from "@/lib/modules";
import { observarTema } from "@/lib/tema";
import { MobileShell } from "./MobileShell";
import { DesktopOnly } from "./DesktopOnly";

/**
 * Porta de entrada do app no celular. Espelha as regras do AppLayout do desktop — sem
 * sessão vai para /login — e aplica o tema escolhido na aba Perfil.
 *
 * Cargos travados num módulo (parcerias, facilities) não têm app: as telas deles são
 * justamente as que ficaram no computador, e as cinco abas daqui mostram briefing e KPIs
 * do financeiro. Melhor dizer "abra no computador" do que abrir um app onde a única aba
 * útil é Perfil — ou, pior, mostrar número de caixa para quem não deveria ver.
 */
export default function MobileLayout() {
  const { user, profile, loading } = useAuth();

  useEffect(() => observarTema(), []);

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  const acesso = moduleAccess(profile?.cargo);
  if (acesso.parceriasOnly || acesso.facilitiesOnly) {
    return (
      <div className="h-[100dvh] overflow-y-auto bg-background">
        <DesktopOnly
          titulo={acesso.parceriasOnly ? "A área de Parceiros" : "O módulo Facilities"}
          mostrarVoltar={false}
        />
      </div>
    );
  }

  return <MobileShell />;
}
