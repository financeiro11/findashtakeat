import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const CHAVE_FORCAR = "mobile:forcado";

/**
 * Maior lado que uma tela de mão pode ter, em px de CSS. Serve para conferir a conversão
 * lá embaixo: iPhone Pro Max dá 956 e dobrável aberto fica na casa dos 900, então nada
 * acima disto é telefone — é monitor.
 */
const TELA_DE_MAO_MAX = 1100;

export type Superficie = {
  /** `screen.width`/`screen.height`: a TELA do aparelho, que não muda quando a janela muda. */
  telaLargura: number;
  telaAltura: number;
  /** `innerWidth`/`innerHeight`: a janela. */
  janelaLargura: number;
  janelaAltura: number;
  /** `devicePixelRatio`: quantos pixels do aparelho cabem em 1px de CSS. */
  dpr: number;
  /** Existe dedo neste aparelho. */
  toque: boolean;
  /** Não existe hover — passar o ponteiro por cima não é um gesto possível. */
  semHover: boolean;
};

/**
 * O menor lado da tela em px de CSS, que é a unidade em que "768" quer dizer alguma coisa.
 *
 * `screen.width` DEVERIA vir em CSS, mas há navegador de celular que devolve o número do
 * aparelho: 1080 numa tela que tem 384 de CSS. Aí o telefone passa por tela de computador
 * e o Hub inteiro abre no celular — que é exatamente o que se via.
 *
 * Converter na marra seria pior: no note, `screen` já vem em CSS (1536 numa tela de 1920 a
 * 125%), e dividir de novo daria 1229×691 — menor lado abaixo de 768, e o computador
 * viraria celular. Por isso só se converte com prova de que o número é do aparelho:
 *
 * 1. a janela, medida em px do aparelho, ENCOSTA na borda do lado curto da tela;
 * 2. e CABE no lado longo — janela maior que a tela é sinal de que a leitura está errada;
 * 3. a tela anunciada é maior que a janela (se fosse CSS com a janela cheia, seriam iguais);
 * 4. e o que sobra depois de dividir ainda é uma tela de mão.
 *
 * No note de tela dividida a conta trava logo no item 1: 748 × 1,25 dá 935 contra os 864 do
 * lado curto — 71px de diferença, longe de qualquer arredondamento.
 */
export function menorLadoDaTelaEmCss(s: Superficie): number {
  const telaMenor = Math.min(s.telaLargura, s.telaAltura);
  const telaMaior = Math.max(s.telaLargura, s.telaAltura);
  const dpr = s.dpr > 1 ? s.dpr : 1;
  if (dpr === 1 || telaMenor <= 0) return telaMenor;

  // `innerWidth` é inteiro e o dpr é quebrado (2,75; 3,5): a conta nunca fecha no ponto.
  // A folga é de 2px de CSS, convertidos — no note a diferença é de dezenas.
  const folga = Math.max(2, 2 * dpr);
  const janelaMenor = Math.min(s.janelaLargura, s.janelaAltura);
  const janelaMaior = Math.max(s.janelaLargura, s.janelaAltura);

  const anunciaPxDoAparelho =
    Math.abs(janelaMenor * dpr - telaMenor) <= folga &&
    janelaMaior * dpr <= telaMaior + folga &&
    telaMenor > janelaMenor + folga &&
    telaMaior / dpr < TELA_DE_MAO_MAX;

  return anunciaPxDoAparelho ? telaMenor / dpr : telaMenor;
}

/**
 * "É uma superfície de celular?" — o que decide, em App.tsx, montar o app das cinco abas
 * em vez do Hub de desktop.
 *
 * Quem manda é o tamanho da TELA do aparelho, não o da janela. Três coisas quebraram aqui,
 * e o histórico das três é o que justifica a regra:
 *
 * 1. Enquanto valia a largura da JANELA, dividir a tela do note derrubava o Hub inteiro:
 *    metade de uma tela de 1920 com escala de 125% dá ~768px de CSS, o limite raspando por
 *    baixo, e no lugar do Hub aparecia o app de celular espremido no computador. A tela do
 *    note continua sendo a mesma tela grande com a janela em qualquer tamanho — por isso
 *    ela, e não a janela, é o que se mede.
 * 2. Trocar isso por `(pointer: coarse) && (hover: none)` mandou o celular de verdade para
 *    o Hub de desktop: em Android com caneta esses valores viram `fine`/`hover` e o
 *    aparelho deixa de se declarar celular. Media query de ponteiro não serve de porteiro.
 * 3. Medir a tela sem olhar a unidade repetiu o item 2 por outro caminho: o navegador que
 *    anuncia `screen.width` em px do aparelho dá 1080, o telefone "tem tela de computador"
 *    e cai no Hub. A rede de segurança de antes não salvava, porque dependia de não haver
 *    hover — e caneta, mouse pareado ou teclado com trackpad fazem o hover existir. Quem
 *    resolve agora é `menorLadoDaTelaEmCss`, que não pergunta nada ao ponteiro.
 *
 * Num aparelho de toque a conta é sobre o MENOR lado, não sobre a largura: um iPhone
 * deitado tem 844px de largura e passava a valer como desktop, então girar o telefone no
 * meio do uso trocava o app inteiro — a tela some, a rota some, o que estava sendo
 * digitado some.
 */
export function ehSuperficieDeCelular(s: Superficie): boolean {
  // Sem dedo não é celular, e isso sozinho já tira qualquer computador da conta.
  if (!s.toque) return false;

  const menorLadoDaTela = menorLadoDaTelaEmCss(s);
  if (menorLadoDaTela > 0 && menorLadoDaTela < MOBILE_BREAKPOINT) return true;

  // Última rede: aparelho que anuncia a tela de um jeito que não dá para converter (ou não
  // anuncia nada). Aqui a janela volta a valer, mas só onde hover não existe — é o que
  // impede o note de tela dividida, que tem trackpad e portanto tem hover, de cair no app
  // de celular. Vale menos que antes, porque a conversão acima já cobre o caso comum.
  return s.semHover && Math.min(s.janelaLargura, s.janelaAltura) < MOBILE_BREAKPOINT;
}

/** O que este aparelho está dizendo de si agora. Também é o que a barra de oferta mostra. */
export function superficieAtual(): Superficie {
  return {
    telaLargura: window.screen?.width ?? 0,
    telaAltura: window.screen?.height ?? 0,
    janelaLargura: window.innerWidth,
    janelaAltura: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    // `maxTouchPoints` primeiro: é um número, não uma media query, e nenhum celular o
    // devolve zerado. `any-pointer` (não `pointer`) fica de reserva — vale se QUALQUER
    // entrada for grossa, então caneta ou mouse pareado não apagam o dedo.
    toque:
      (navigator.maxTouchPoints ?? 0) > 0 ||
      (window.matchMedia?.("(any-pointer: coarse)").matches ?? false),
    semHover: window.matchMedia?.("(any-hover: none)").matches ?? false,
  };
}

/**
 * A escolha manual: `?mobile=1` na URL liga o app do celular, `?mobile=0` devolve o Hub.
 * É o atalho para testar no computador — e, no celular, a saída de emergência de quando a
 * regra automática erra. Como é saída de emergência, ela GRUDA no aparelho (localStorage):
 * de nada adiantaria uma tábua de salvação que some ao fechar o app.
 *
 * `null` = ninguém pediu nada, vale a regra normal.
 */
export function escolhaForcada(naUrl: string | null, salvo: string | null): boolean | null {
  const valor = naUrl === "1" || naUrl === "0" ? naUrl : salvo;
  return valor === "1" ? true : valor === "0" ? false : null;
}

/** Grava a escolha manual. `null` devolve o aparelho à regra automática. */
export function definirModoCelular(valor: boolean | null) {
  try {
    if (valor === null) {
      localStorage.removeItem(CHAVE_FORCAR);
      sessionStorage.removeItem(CHAVE_FORCAR);
    } else {
      localStorage.setItem(CHAVE_FORCAR, valor ? "1" : "0");
    }
  } catch {
    /* armazenamento bloqueado (aba anônima com cookies travados): resta a URL */
  }
}

function forcado(): boolean | null {
  try {
    const naUrl = new URLSearchParams(window.location.search).get("mobile");
    if (naUrl === "1" || naUrl === "0") definirModoCelular(naUrl === "1");
    // `sessionStorage` continua sendo lido por causa de quem estava com a aba aberta desde
    // antes de a escolha passar a ser gravada no aparelho.
    const salvo = localStorage.getItem(CHAVE_FORCAR) ?? sessionStorage.getItem(CHAVE_FORCAR);
    return escolhaForcada(naUrl, salvo);
  } catch {
    return null;
  }
}

function ehCelular(): boolean {
  if (typeof window === "undefined") return false;
  const forcar = forcado();
  if (forcar !== null) return forcar;
  return ehSuperficieDeCelular(superficieAtual());
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
