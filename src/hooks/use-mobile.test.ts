import { describe, it, expect } from "vitest";
import { ehSuperficieDeCelular, escolhaForcada, menorLadoDaTelaEmCss, type Superficie } from "./use-mobile";

// Este predicado decide, em App.tsx, se o que monta é o app das cinco abas ou o Hub de
// desktop inteiro. Errar aqui não deixa a tela feia: troca o aplicativo inteiro — já
// aconteceu nos dois sentidos (note de tela dividida virando app de celular, celular
// virando Hub espremido), e é por isso que cada aparelho abaixo tem um teste.
const CELULAR: Superficie = {
  telaLargura: 385, telaAltura: 854,
  janelaLargura: 385, janelaAltura: 780,
  dpr: 3,
  toque: true, semHover: true,
};
const NOTE: Superficie = {
  telaLargura: 1536, telaAltura: 864,
  janelaLargura: 1536, janelaAltura: 760,
  dpr: 1.25,
  toque: false, semHover: false,
};
// O aparelho do print que reabriu o assunto: 1080 físicos numa tela de 384 de CSS, e o
// navegador anuncia a tela em pixels do APARELHO. Sem converter, ele "tem tela de
// computador" e o Hub abre inteiro num telefone.
const CELULAR_QUE_MENTE: Superficie = {
  telaLargura: 1080, telaAltura: 2400,
  janelaLargura: 384, janelaAltura: 820,
  dpr: 2.8125,
  toque: true, semHover: true,
};

const com = (base: Superficie, mudanca: Partial<Superficie>): Superficie => ({ ...base, ...mudanca });

describe("ehSuperficieDeCelular", () => {
  it("celular em pé é celular", () => {
    expect(ehSuperficieDeCelular(CELULAR)).toBe(true);
  });

  it("celular deitado continua celular — é o caso que trocava o app ao girar", () => {
    expect(ehSuperficieDeCelular(com(CELULAR, {
      telaLargura: 854, telaAltura: 385, janelaLargura: 854, janelaAltura: 340,
    }))).toBe(true);
  });

  it("celular com caneta continua celular — hover mentiroso não decide nada", () => {
    // O Android com S Pen reporta hover/ponteiro fino e foi assim que o telefone caiu no
    // Hub de desktop. O tamanho da tela não muda por causa da caneta.
    expect(ehSuperficieDeCelular(com(CELULAR, { semHover: false }))).toBe(true);
  });

  it("tablet não vira celular em nenhuma orientação", () => {
    const tablet = com(CELULAR, {
      telaLargura: 834, telaAltura: 1194, janelaLargura: 834, janelaAltura: 1100, dpr: 2,
    });
    expect(ehSuperficieDeCelular(tablet)).toBe(false);
    expect(ehSuperficieDeCelular(com(tablet, {
      telaLargura: 1194, telaAltura: 834, janelaLargura: 1194, janelaAltura: 780,
    }))).toBe(false);
  });

  it("meia tela do note não vira celular — 1920 a 125% dá ~768px por metade", () => {
    expect(ehSuperficieDeCelular(com(NOTE, { janelaLargura: 748 }))).toBe(false);
  });

  it("nem meia tela de note COM tela de toque — a tela do aparelho é que conta", () => {
    expect(ehSuperficieDeCelular(com(NOTE, { janelaLargura: 748, toque: true }))).toBe(false);
  });

  it("no computador nenhuma janela vira celular, por mais estreita que seja", () => {
    expect(ehSuperficieDeCelular(com(NOTE, { janelaLargura: 320 }))).toBe(false);
  });

  it("celular que anuncia a tela em px do aparelho é celular", () => {
    expect(ehSuperficieDeCelular(CELULAR_QUE_MENTE)).toBe(true);
  });

  it("e continua celular deitado, e com caneta — as duas coisas juntas", () => {
    // A combinação que sobrava sem saída: a tela anunciada passa de 768 E existe hover,
    // que era a única coisa que ainda segurava esse aparelho no app do celular.
    expect(ehSuperficieDeCelular(com(CELULAR_QUE_MENTE, { semHover: false }))).toBe(true);
    expect(ehSuperficieDeCelular(com(CELULAR_QUE_MENTE, {
      telaLargura: 2400, telaAltura: 1080, janelaLargura: 853, janelaAltura: 384, semHover: false,
    }))).toBe(true);
  });

  it("tela zerada não conta como tela minúscula", () => {
    expect(ehSuperficieDeCelular(com(NOTE, {
      telaLargura: 0, telaAltura: 0, janelaLargura: 748, toque: true,
    }))).toBe(false);
  });
});

// A conversão é a parte perigosa: aplicada onde não devia, ela encolhe a tela do note para
// 1229×691 e o computador vira celular. Estes casos são as travas.
describe("menorLadoDaTelaEmCss", () => {
  it("tela já anunciada em CSS fica como está", () => {
    expect(menorLadoDaTelaEmCss(CELULAR)).toBe(385);
    expect(menorLadoDaTelaEmCss(NOTE)).toBe(864);
  });

  it("tela anunciada em px do aparelho volta para CSS", () => {
    expect(menorLadoDaTelaEmCss(CELULAR_QUE_MENTE)).toBeCloseTo(384, 0);
  });

  it("note com janela do tamanho exato da conta não é convertido", () => {
    // 691 × 1,25 dá justamente os 864 do lado curto: a coincidência que faria a tela do
    // note virar 1229×691 e cair abaixo de 768. O que barra é o lado longo — 1229px de
    // CSS não é tela de mão.
    const coincidencia = com(NOTE, { janelaLargura: 691, toque: true });
    expect(menorLadoDaTelaEmCss(coincidencia)).toBe(864);
    expect(ehSuperficieDeCelular(coincidencia)).toBe(false);
  });

  it("janela que não encosta na borda não é convertida", () => {
    expect(menorLadoDaTelaEmCss(com(CELULAR_QUE_MENTE, { janelaLargura: 300 }))).toBe(1080);
  });
});

// O único jeito de ver o app do celular no computador depois que a largura deixou de
// contar — e, no celular, a saída de quando a regra automática erra. Se a escolha não
// sobreviver à navegação, o teste dura um clique.
describe("escolhaForcada", () => {
  it("sem pedido nenhum, vale a regra normal", () => {
    expect(escolhaForcada(null, null)).toBe(null);
    expect(escolhaForcada("sim", null)).toBe(null);
  });

  it("?mobile=1 liga e ?mobile=0 desliga", () => {
    expect(escolhaForcada("1", null)).toBe(true);
    expect(escolhaForcada("0", null)).toBe(false);
  });

  it("o guardado vale quando a URL não pede nada — navegar não desfaz o teste", () => {
    expect(escolhaForcada(null, "1")).toBe(true);
    expect(escolhaForcada(null, "0")).toBe(false);
  });

  it("a URL manda mais que o guardado — ?mobile=0 sai do modo celular", () => {
    expect(escolhaForcada("0", "1")).toBe(false);
    expect(escolhaForcada("1", "0")).toBe(true);
  });
});
