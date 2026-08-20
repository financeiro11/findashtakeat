import { describe, it, expect } from "vitest";
import { ehSuperficieDeCelular, escolhaForcada, type Superficie } from "./use-mobile";

// Este predicado decide, em App.tsx, se o que monta é o app das cinco abas ou o Hub de
// desktop inteiro. Errar aqui não deixa a tela feia: troca o aplicativo inteiro — já
// aconteceu nos dois sentidos (note de tela dividida virando app de celular, celular
// virando Hub espremido), e é por isso que cada aparelho abaixo tem um teste.
const CELULAR: Superficie = {
  telaLargura: 385, telaAltura: 854,
  janelaLargura: 385, janelaAltura: 780,
  toque: true, semHover: true,
};
const NOTE: Superficie = {
  telaLargura: 1536, telaAltura: 864,
  janelaLargura: 1536, janelaAltura: 760,
  toque: false, semHover: false,
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
      telaLargura: 834, telaAltura: 1194, janelaLargura: 834, janelaAltura: 1100,
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

  it("celular que mente o tamanho da tela ainda é celular", () => {
    // Navegador que devolve screen.width em pixels do aparelho (1080) e não em CSS (385):
    // a janela estreita sem hover é o que sobra para reconhecê-lo.
    expect(ehSuperficieDeCelular(com(CELULAR, {
      telaLargura: 1080, telaAltura: 2400,
    }))).toBe(true);
  });

  it("tela zerada não conta como tela minúscula", () => {
    expect(ehSuperficieDeCelular(com(NOTE, {
      telaLargura: 0, telaAltura: 0, janelaLargura: 748, toque: true,
    }))).toBe(false);
  });
});

// O único jeito de ver o app do celular no computador depois que a largura deixou de
// contar. Se a escolha não sobreviver à navegação, o teste dura um clique.
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
