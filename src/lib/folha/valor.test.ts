/**
 * Leitura do valor digitado na correção de salário.
 *
 * O campo é livre porque quem opera digita como está acostumado — às vezes
 * "2.400,00", às vezes "2400". Ler "2.400" como dois mil e quatrocentos ou como
 * dois inteiros e quatro décimos é a diferença entre pagar certo e pagar mil
 * vezes menos.
 */

import { describe, expect, it } from "vitest";
import { lerValor } from "./valor";

describe("lerValor", () => {
  it("lê o formato brasileiro, com milhar e centavos", () => {
    expect(lerValor("2.400,00")).toBe(2400);
    expect(lerValor("24.000,50")).toBe(24000.5);
    expect(lerValor("1.234.567,89")).toBe(1234567.89);
  });

  it("com vírgula, o ponto é SEMPRE separador de milhar", () => {
    // "2.400,00" não pode virar 2,4.
    expect(lerValor("2.400,00")).toBe(2400);
    expect(lerValor("3.700,00")).toBe(3700);
  });

  it("sem vírgula, o ponto é decimal — é como o teclado numérico manda", () => {
    expect(lerValor("2400.5")).toBe(2400.5);
    expect(lerValor("7500")).toBe(7500);
  });

  it("ignora R$ e espaços", () => {
    expect(lerValor(" R$ 2.400,00 ")).toBe(2400);
    expect(lerValor("R$7500")).toBe(7500);
  });

  it("vazio é null — é assim que se remove a correção", () => {
    expect(lerValor("")).toBeNull();
    expect(lerValor("   ")).toBeNull();
  });

  it("texto que não é número é null, não zero", () => {
    // Virar 0 seria pior: zero passa por valor e tira a pessoa da folha.
    expect(lerValor("abc")).toBeNull();
    expect(lerValor("--")).toBeNull();
  });

  it("os valores reais da folha de julho voltam iguais", () => {
    for (const [texto, esperado] of [
      ["2.400,00", 2400], ["3.700,00", 3700], ["7.500,00", 7500],
      ["10.000,00", 10000], ["27.500,00", 27500], ["3.640,00", 3640],
    ] as [string, number][]) {
      expect(lerValor(texto), texto).toBe(esperado);
    }
  });
});
