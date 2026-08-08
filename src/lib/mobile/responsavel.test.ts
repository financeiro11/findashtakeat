import { describe, it, expect } from "vitest";
import {
  chavePessoa, iniciais, mesmaPessoa, normalizaResponsavel, pessoasConhecidas, rotuloResponsavel,
} from "./responsavel";

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

describe("pessoasConhecidas", () => {
  it("junta as cinco grafias numa entrada só", () => {
    const pessoas = pessoasConhecidas([...GRAFIAS_JULIA, "Henrique", "Henrique"]);
    expect(pessoas.map((p) => p.chave)).toEqual(["henrique", "julia"]);
    // "Julia" (sem acento) aparece duas vezes nessas cinco grafias e por isso vence: a
    // regra é frequência, não gosto. O acento só desempata (ver o caso abaixo).
    expect(pessoas.find((p) => p.chave === "julia")!.valor).toBe("Julia");
  });

  it("grava a grafia que mais aparece, em vez de inventar uma sexta", () => {
    const pessoas = pessoasConhecidas(["Julia", "Julia", "Júlia · Financeiro"]);
    expect(pessoas[0].valor).toBe("Julia");
  });

  it("no empate prefere a forma acentuada — é a escrita correta em pt-BR", () => {
    expect(pessoasConhecidas(["Julia", "Júlia"])[0].valor).toBe("Júlia");
  });

  it("ignora nulo, vazio e só-espaço: 'sem responsável' não é uma pessoa", () => {
    expect(pessoasConhecidas([null, undefined, "", "   "])).toEqual([]);
  });

  it("espaço sobrando não vira pessoa separada", () => {
    expect(pessoasConhecidas(["Julia ", " Julia", "Julia"])).toHaveLength(1);
  });
});
