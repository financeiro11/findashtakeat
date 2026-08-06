import { Outlet, useLocation } from "react-router-dom";
import takeatSymbol from "@/assets/takeat-symbol-white.png";
import { MobileBottomNav, tituloDaAba } from "./MobileBottomNav";
import { InstalarBanner } from "./InstalarBanner";

/**
 * Moldura do app no celular: cabeçalho fino, conteúdo e a barra de cinco abas.
 *
 * A altura é `100dvh` (não `vh`) e a barra é um irmão do conteúdo em flex — não é
 * `position: fixed`. Assim a barra nunca cobre o final da lista, e quando o teclado sobe
 * o conteúdo encolhe em vez de a barra flutuar no meio da tela.
 */
export function MobileShell() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-card pt-[env(safe-area-inset-top)]">
        <div className="flex h-12 items-center gap-2.5 px-4">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
            <img src={takeatSymbol} alt="Takeat" className="h-4 w-4 object-contain" />
          </div>
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            {tituloDaAba(pathname)}
          </h1>
        </div>
      </header>

      <InstalarBanner />

      {/* min-h-0 é o que permite ao filho rolar dentro do flex em vez de esticar a página. */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        <Outlet />
      </main>

      <MobileBottomNav />
    </div>
  );
}

export default MobileShell;
