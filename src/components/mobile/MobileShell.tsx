import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { WifiOff } from "lucide-react";
import takeatSymbol from "@/assets/takeat-symbol-white.png";
import { MobileBottomNav, tituloDaAba } from "./MobileBottomNav";
import { InstalarBanner } from "./InstalarBanner";
import { NovaVersao } from "@/components/NovaVersao";

/**
 * Moldura do app no celular: cabeçalho fino, conteúdo e a barra de cinco abas.
 *
 * A altura é `100dvh` (não `vh`) e a barra é um irmão do conteúdo em flex — não é
 * `position: fixed`. Assim a barra nunca cobre o final da lista, e quando o teclado sobe
 * o conteúdo encolhe em vez de a barra flutuar no meio da tela.
 */
export function MobileShell() {
  const { pathname } = useLocation();
  const online = useOnline();

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

      {/* Nada de dado financeiro fica no aparelho (Supabase é NetworkOnly, ver
          vite.config.ts): sem rede o app abre pelo cache do código e TODA tela falha, uma
          consulta de cada vez. Sem este aviso, isso se lê como app quebrado. */}
      {!online && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Sem conexão — os dados só carregam online.
        </div>
      )}

      <NovaVersao />
      <InstalarBanner />

      {/* min-h-0 é o que permite ao filho rolar dentro do flex em vez de esticar a página. */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        <Outlet />
      </main>

      <MobileBottomNav />
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    const ligou = () => setOnline(true);
    const caiu = () => setOnline(false);
    window.addEventListener("online", ligou);
    window.addEventListener("offline", caiu);
    return () => {
      window.removeEventListener("online", ligou);
      window.removeEventListener("offline", caiu);
    };
  }, []);

  return online;
}

export default MobileShell;
