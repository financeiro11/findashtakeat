import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const CHAVE_FORCAR = "mobile:forcado";

/**
 * "É uma superfície de celular?" — o que decide, em App.tsx, montar o app das cinco abas
 * em vez do Hub de desktop.
 *
 * Quem manda é o ponteiro, não a largura. Enquanto a conta era só a largura da janela,
 * dividir a tela do note derrubava o Hub inteiro: metade de uma tela de 1920 com escala
 * de 125% dá ~768px de CSS, ou seja, o limite raspando por baixo — e no lugar do Hub
 * aparecia o app de celular espremido no meio do computador. No computador, janela
 * estreita é janela estreita: o layout se ajusta, o aplicativo não muda.
 *
 * Num aparelho de toque a conta é sobre o MENOR lado da tela, não sobre a largura: um
 * iPhone deitado tem 844px de largura e passava a valer como desktop, então girar o
 * telefone no meio do uso trocava o app inteiro pelo Hub espremido — a tela some, a rota
 * some, o que estava sendo digitado some.
 */
export function ehSuperficieDeCelular(largura: number, altura: number, toque: boolean): boolean {
  return toque && Math.min(largura, altura) < MOBILE_BREAKPOINT;
}

/**
 * O atalho para ver o app do celular no computador: `?mobile=1` na URL liga, `?mobile=0`
 * desliga. Sem ele não haveria como testar o app sem um aparelho na mão, já que estreitar
 * o navegador deixou de bastar.
 *
 * A escolha fica guardada na aba porque navegar troca a URL — sem isso o app voltaria a
 * ser o de desktop no primeiro clique. `null` = ninguém pediu nada, vale a regra normal.
 */
export function escolhaForcada(naUrl: string | null, salvo: string | null): boolean | null {
  const valor = naUrl === "1" || naUrl === "0" ? naUrl : salvo;
  return valor === "1" ? true : valor === "0" ? false : null;
}

function forcado(): boolean | null {
  try {
    const naUrl = new URLSearchParams(window.location.search).get("mobile");
    if (naUrl === "1" || naUrl === "0") sessionStorage.setItem(CHAVE_FORCAR, naUrl);
    return escolhaForcada(naUrl, sessionStorage.getItem(CHAVE_FORCAR));
  } catch {
    // sessionStorage bloqueado (aba anônima com cookies travados): a URL ainda vale.
    return null;
  }
}

function temToque(): boolean {
  // `any-pointer: coarse` não serve: um note com tela sensível casa com ele e cairia no
  // app de celular. O que interessa é o ponteiro PRINCIPAL ser o dedo — e, junto, não
  // existir hover, que é justamente o que separa o celular do note com tela de toque.
  return (
    (window.matchMedia?.("(pointer: coarse)").matches ?? false) &&
    (window.matchMedia?.("(hover: none)").matches ?? false)
  );
}

function ehCelular(): boolean {
  if (typeof window === "undefined") return false;
  const forcar = forcado();
  if (forcar !== null) return forcar;
  return ehSuperficieDeCelular(window.innerWidth, window.innerHeight, temToque());
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
