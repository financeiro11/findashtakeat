import { describe, it, expect } from "vitest";
import { ehSuperficieDeCelular } from "./use-mobile";

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

  it("no computador vale a largura da janela — estreitar o navegador ainda mostra o app", () => {
    expect(ehSuperficieDeCelular(500, 900, MOUSE)).toBe(true);
    expect(ehSuperficieDeCelular(1440, 900, MOUSE)).toBe(false);
  });

  it("janela baixa e larga no computador não é celular", () => {
    expect(ehSuperficieDeCelular(1400, 600, MOUSE)).toBe(false);
  });
});
