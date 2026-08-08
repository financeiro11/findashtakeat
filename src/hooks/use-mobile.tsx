import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * "É uma superfície de celular?" — o que decide, em App.tsx, montar o app das cinco abas
 * em vez do Hub de desktop.
 *
 * Num aparelho de toque a conta é sobre o MENOR lado da tela, não sobre a largura: um
 * iPhone deitado tem 844px de largura e passava a valer como desktop, então girar o
 * telefone no meio do uso trocava o app inteiro pelo Hub espremido — a tela some, a rota
 * some, o que estava sendo digitado some. No computador continua sendo a largura da
 * janela, que é o que permite testar o app do celular estreitando o navegador.
 */
export function ehSuperficieDeCelular(largura: number, altura: number, toque: boolean): boolean {
  return toque ? Math.min(largura, altura) < MOBILE_BREAKPOINT : largura < MOBILE_BREAKPOINT;
}

function ehCelular(): boolean {
  if (typeof window === "undefined") return false;
  return ehSuperficieDeCelular(
    window.innerWidth,
    window.innerHeight,
    window.matchMedia?.("(pointer: coarse)").matches ?? false,
  );
}

export function useIsMobile() {
  // Valor já na primeira renderização: quem decide qual shell montar (App.tsx) não pode
  // começar em `false` e corrigir no efeito — isso pisca o layout de desktop inteiro no
  // celular a cada abertura do app.
  const [isMobile, setIsMobile] = React.useState<boolean>(ehCelular);

  React.useEffect(() => {
    // `resize` e não matchMedia: a conta depende da altura e da orientação, e girar o
    // aparelho não muda nenhuma media query de largura mínima.
    const onChange = () => setIsMobile(ehCelular());
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    onChange();
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);

  return isMobile;
}
