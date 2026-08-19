import { describe, it, expect } from "vitest";
import { ehSuperficieDeCelular, escolhaForcada } from "./use-mobile";

// Este predicado decide, em App.tsx, se o que monta é o app das cinco abas ou o Hub de
// desktop inteiro. Errar aqui não deixa a tela feia: troca o aplicativo no meio do uso.
describe("ehSuperficieDeCelular", () => {
  const TOQUE = true;
  const MOUSE = false;

  it("celular em pé é celular", () => {
    expect(ehSuperficieDeCelular(390, 844, TOQUE)).toBe(true);
  });

  it("celular deitado continua celular — é o caso que trocava o app ao girar", () => {
    expect(ehSuperficieDeCelular(844, 390, TOQUE)).toBe(true);
  });

  it("tablet não vira celular em nenhuma orientação", () => {
    expect(ehSuperficieDeCelular(768, 1024, TOQUE)).toBe(false);
    expect(ehSuperficieDeCelular(1024, 768, TOQUE)).toBe(false);
  });

  it("meia tela do note não vira celular — 1920 a 125% dá ~768px por metade", () => {
    expect(ehSuperficieDeCelular(760, 980, MOUSE)).toBe(false);
  });

  it("no computador nenhuma largura vira celular, por mais estreita que seja", () => {
    expect(ehSuperficieDeCelular(500, 900, MOUSE)).toBe(false);
    expect(ehSuperficieDeCelular(320, 900, MOUSE)).toBe(false);
    expect(ehSuperficieDeCelular(1440, 900, MOUSE)).toBe(false);
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
