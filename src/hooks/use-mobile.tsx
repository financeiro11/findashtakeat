import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const CHAVE_FORCAR = "mobile:forcado";

export type Superficie = {
  /** `screen.width`/`screen.height`: a TELA do aparelho, que não muda quando a janela muda. */
  telaLargura: number;
  telaAltura: number;
  /** `innerWidth`/`innerHeight`: a janela. Só entra na rede de segurança lá embaixo. */
  janelaLargura: number;
  janelaAltura: number;
  /** Existe dedo neste aparelho. */
  toque: boolean;
  /** Não existe hover — passar o ponteiro por cima não é um gesto possível. */
  semHover: boolean;
};

/**
 * "É uma superfície de celular?" — o que decide, em App.tsx, montar o app das cinco abas
 * em vez do Hub de desktop.
 *
 * Quem manda é o tamanho da TELA do aparelho, não o da janela. Duas coisas quebraram aqui,
 * e o histórico das duas é o que justifica a regra:
 *
 * 1. Enquanto valia a largura da JANELA, dividir a tela do note derrubava o Hub inteiro:
 *    metade de uma tela de 1920 com escala de 125% dá ~768px de CSS, o limite raspando por
 *    baixo, e no lugar do Hub aparecia o app de celular espremido no computador. A tela do
 *    note continua sendo a mesma tela grande com a janela em qualquer tamanho — por isso
 *    ela, e não a janela, é o que se mede.
 * 2. Trocar isso por `(pointer: coarse) && (hover: none)` mandou o celular de verdade para
 *    o Hub de desktop: em Android com caneta esses valores viram `fine`/`hover` e o
 *    aparelho deixa de se declarar celular. Media query de ponteiro não serve de porteiro.
 *
 * Num aparelho de toque a conta é sobre o MENOR lado, não sobre a largura: um iPhone
 * deitado tem 844px de largura e passava a valer como desktop, então girar o telefone no
 * meio do uso trocava o app inteiro — a tela some, a rota some, o que estava sendo
 * digitado some.
 */
export function ehSuperficieDeCelular(s: Superficie): boolean {
  // Sem dedo não é celular, e isso sozinho já tira qualquer computador da conta.
  if (!s.toque) return false;

  const menorLadoDaTela = Math.min(s.telaLargura, s.telaAltura);
  if (menorLadoDaTela > 0 && menorLadoDaTela < MOBILE_BREAKPOINT) return true;

  // Rede de segurança para o aparelho que mente o tamanho da tela (navegador antigo que
  // devolve `screen.width` em pixels do aparelho, não em CSS: 1080 no lugar de 385). Aqui
  // a janela volta a valer, mas só onde hover não existe — é o que impede o note de tela
  // dividida, que tem trackpad e portanto tem hover, de cair de novo no app de celular.
  return s.semHover && Math.min(s.janelaLargura, s.janelaAltura) < MOBILE_BREAKPOINT;
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

function ehCelular(): boolean {
  if (typeof window === "undefined") return false;
  const forcar = forcado();
  if (forcar !== null) return forcar;

  return ehSuperficieDeCelular({
    telaLargura: window.screen?.width ?? 0,
    telaAltura: window.screen?.height ?? 0,
    janelaLargura: window.innerWidth,
    janelaAltura: window.innerHeight,
    // `maxTouchPoints` primeiro: é um número, não uma media query, e nenhum celular o
    // devolve zerado. `any-pointer` (não `pointer`) fica de reserva — vale se QUALQUER
    // entrada for grossa, então caneta ou mouse pareado não apagam o dedo.
    toque:
      (navigator.maxTouchPoints ?? 0) > 0 ||
      (window.matchMedia?.("(any-pointer: coarse)").matches ?? false),
    semHover: window.matchMedia?.("(any-hover: none)").matches ?? false,
  });
}

export function useIsMobile() {
  // Valor já na primeira renderização: quem decide qual shell montar (App.tsx) não pode
  // começar em `false` e corrigir no efeito — isso pisca o layout de desktop inteiro no
  // celular a cada abertura do app.
  const [isMobile, setIsMobile] = React.useState<boolean>(ehCelular);

  React.useEffect(() => {
    // Girar o aparelho troca largura por altura, e monitor externo troca a tela inteira.
    // Nenhum dos dois muda media query de largura mínima, daí `resize` e não matchMedia.
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
