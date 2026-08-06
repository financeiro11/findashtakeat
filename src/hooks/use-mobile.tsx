import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // Valor já na primeira renderização: quem decide qual shell montar (App.tsx) não pode
  // começar em `false` e corrigir no efeito — isso pisca o layout de desktop inteiro no
  // celular a cada abertura do app.
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
