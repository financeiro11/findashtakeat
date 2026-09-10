import { describe, expect, it } from "vitest";
import { ehCategoriaSoftware } from "./utils";

/* As cinco contas são as que existiam no Omie em 10/09/2026 — e o teste guarda
   as GRAFIAS, não os códigos: é o singular/plural e o acento que quebrariam a
   regra, e a numeração é justamente o que se espera que mude. */
describe("ehCategoriaSoftware", () => {
  it("pega as cinco contas de software do plano de contas", () => {
    for (const c of [
      "3.1.2.1 Softwares - Administrativo",
      "3.2.5. Software - Operação",
      "3.1.5.1 Softwares - Tecnologia",
      "3.1.3.1 Softwares - Marketing",
      "3.1.4.1 Softwares - Comercial",
    ]) {
      expect(ehCategoriaSoftware(c), c).toBe(true);
    }
  });

  it("não depende do código da conta — renumerar não pode desligar a regra", () => {
    expect(ehCategoriaSoftware("9.9.9 Softwares - Administrativo")).toBe(true);
    expect(ehCategoriaSoftware("Softwares")).toBe(true);
  });

  it("ignora caixa e acento", () => {
    expect(ehCategoriaSoftware("SOFTWARE - OPERAÇÃO")).toBe(true);
    expect(ehCategoriaSoftware("software - operação")).toBe(true);
  });

  it("deixa passar o que não é software", () => {
    for (const c of [
      "3.1.3.4 Transportes e Viagens - Marketing",
      "3.1.2.6 Confraternizações - Administrativo",
      "3.2.4. Servidor - Tecnologia",
      "3.4.1 CAPEX Equipamentos",
      "Alimentação",
    ]) {
      expect(ehCategoriaSoftware(c), c).toBe(false);
    }
  });

  /* Sem categoria é "ainda não sei o que é", e isso continua sendo trabalho:
     tratar como software esconderia justamente a linha que ninguém olhou. */
  it("categoria vazia não é software", () => {
    expect(ehCategoriaSoftware(null)).toBe(false);
    expect(ehCategoriaSoftware(undefined)).toBe(false);
    expect(ehCategoriaSoftware("")).toBe(false);
    expect(ehCategoriaSoftware("   ")).toBe(false);
  });
});
