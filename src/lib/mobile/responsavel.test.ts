import { describe, it, expect } from "vitest";
import { chavePessoa, iniciais, mesmaPessoa, normalizaResponsavel, rotuloResponsavel } from "./responsavel";

/* As grafias abaixo são as que existem hoje na coluna `tarefas.responsavel`. */
const GRAFIAS_JULIA = ["Júlia", "Julia", "Julia ", "Júlia · Financeiro", " júlia "];

describe("normalizaResponsavel", () => {
  it("tira acento, espaço e o sufixo depois de ·", () => {
    for (const g of GRAFIAS_JULIA) expect(normalizaResponsavel(g)).toBe("julia");
  });

  it("devolve vazio para nulo, indefinido e string vazia", () => {
    expect(normalizaResponsavel(null)).toBe("");
    expect(normalizaResponsavel(undefined)).toBe("");
    expect(normalizaResponsavel("   ")).toBe("");
  });
});

describe("mesmaPessoa", () => {
  it("casa o nome completo do profile com o primeiro nome da tarefa", () => {
    for (const g of GRAFIAS_JULIA) expect(mesmaPessoa(g, "Júlia Rodrigues")).toBe(true);
    expect(mesmaPessoa("Henrique", "Henrique Moura")).toBe(true);
  });

  it("não confunde pessoas diferentes", () => {
    expect(mesmaPessoa("Júlia", "Henrique Moura")).toBe(false);
    expect(mesmaPessoa("Julia · Financeiro", "Henrique")).toBe(false);
  });

  it("responsável vazio nunca casa — senão o filtro 'Minhas' pegaria os órfãos", () => {
    expect(mesmaPessoa(null, "Henrique Moura")).toBe(false);
    expect(mesmaPessoa("", "")).toBe(false);
    expect(mesmaPessoa("Henrique", null)).toBe(false);
  });
});

describe("rótulos", () => {
  it("mostra só o primeiro nome, capitalizado", () => {
    expect(rotuloResponsavel("Júlia · Financeiro")).toBe("Júlia");
    expect(rotuloResponsavel("julia ")).toBe("Julia");
    expect(rotuloResponsavel(null)).toBe("Sem responsável");
  });

  it("iniciais usam no máximo dois nomes", () => {
    expect(iniciais("Henrique Moura")).toBe("HM");
    expect(iniciais("Júlia")).toBe("J");
    expect(iniciais(null)).toBe("—");
  });

  it("chavePessoa é o primeiro nome normalizado", () => {
    expect(chavePessoa("Júlia · Financeiro")).toBe("julia");
    expect(chavePessoa("Henrique Moura")).toBe("henrique");
  });
});
