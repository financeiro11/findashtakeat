import { describe, it, expect } from "vitest";
import { agruparPorNome, linhasEconomizadas, periodoDoGrupo } from "@/lib/agruparLancamentos";

type L = { nome: string; valor: number; data: string | null };

const linha = (nome: string, valor: number, data: string | null = "2026-07-01"): L => ({ nome, valor, data });

const agrupar = (linhas: L[], ordem?: "data" | "maior" | "menor") =>
  agruparPorNome(linhas, { nomeDe: (l) => l.nome, valorDe: (l) => l.valor, ordem });

describe("agruparPorNome", () => {
  it("junta o mesmo fornecedor e soma", () => {
    const g = agrupar([
      linha("LATAM AIR*EMFHFK", -403.09),
      linha("DL*UberRides", -97.46),
      linha("LATAM AIR*EMFHFK", -403.09),
      linha("LATAM AIR*EMFHFK", -403.09),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].nome).toBe("LATAM AIR*EMFHFK");
    expect(g[0].itens).toHaveLength(3);
    expect(g[0].total).toBeCloseTo(-1209.27, 2);
  });

  it("a soma dos grupos é a soma da lista", () => {
    const linhas = [linha("A", -10), linha("B", -3.33), linha("A", -1.67), linha("C", 5)];
    const total = agrupar(linhas).reduce((s, g) => s + g.total, 0);
    expect(total).toBeCloseTo(-10, 2);
  });

  it("ignora caixa e pontuação na chave, mas escreve o primeiro jeito que viu", () => {
    const g = agrupar([linha("Airbnb * HM4Z", -900), linha("AIRBNB HM4Z", -450)]);
    expect(g).toHaveLength(1);
    expect(g[0].nome).toBe("Airbnb * HM4Z");
    expect(g[0].total).toBeCloseTo(-1350, 2);
  });

  it("não junta por semelhança — grafias diferentes são fornecedores diferentes", () => {
    expect(agrupar([linha("DL*UberRides", -97.46), linha("DL *UberRid", -26.95)])).toHaveLength(2);
  });

  it("sem nome vira um grupo só, e não um por linha", () => {
    const g = agrupar([linha("", -10), linha("   ", -20)]);
    expect(g).toHaveLength(1);
    expect(g[0].nome).toBe("Sem contraparte");
  });

  it("em 'data' mantém a ordem de primeira aparição", () => {
    const g = agrupar([linha("C", -1), linha("A", -900), linha("C", -1)], "data");
    expect(g.map((x) => x.nome)).toEqual(["C", "A"]);
  });

  it("em 'maior' ordena pelo TOTAL do grupo, não pelo maior item", () => {
    const g = agrupar([linha("Passagem", -400), ...Array.from({ length: 18 }, () => linha("Uber", -30))], "maior");
    expect(g[0].nome).toBe("Uber");
    expect(g[0].total).toBeCloseTo(-540, 2);
  });

  it("ordena por tamanho, ignorando o sinal", () => {
    const g = agrupar([linha("Gasto", -50), linha("Estorno", 900)], "maior");
    expect(g.map((x) => x.nome)).toEqual(["Estorno", "Gasto"]);
    expect(agrupar([linha("Gasto", -50), linha("Estorno", 900)], "menor").map((x) => x.nome))
      .toEqual(["Gasto", "Estorno"]);
  });
});

describe("linhasEconomizadas", () => {
  it("é zero quando cada fornecedor aparece uma vez", () => {
    expect(linhasEconomizadas(agrupar([linha("A", -1), linha("B", -2)]))).toBe(0);
  });

  it("conta o que sai da tela", () => {
    expect(linhasEconomizadas(agrupar([linha("A", -1), linha("A", -1), linha("A", -1), linha("B", -2)]))).toBe(2);
  });
});

describe("periodoDoGrupo", () => {
  it("acha o primeiro e o último, e aguenta lançamento sem data", () => {
    expect(periodoDoGrupo([{ data: "2026-07-15" }, { data: null }, { data: "2026-07-02" }]))
      .toEqual({ de: "2026-07-02", ate: "2026-07-15" });
  });

  it("sem data nenhuma, não inventa", () => {
    expect(periodoDoGrupo([{ data: null }])).toEqual({ de: null, ate: null });
  });
});