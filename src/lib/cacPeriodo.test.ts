import { describe, expect, it } from "vitest";
import { ultimoMesFechado, mesesDoPeriodo, desvioVsMedia, seloDaLinha } from "./cac";

/* Meio-dia para o fuso não empurrar a data para o dia anterior. */
const em = (iso: string) => new Date(`${iso}T12:00:00`);

describe("ultimoMesFechado", () => {
  it("o mês corrente não conta — em agosto, o último fechado é julho", () => {
    expect(ultimoMesFechado(2026, em("2026-08-26"))).toBe(6);
  });

  it("ano passado fecha em dezembro", () => {
    expect(ultimoMesFechado(2025, em("2026-08-26"))).toBe(11);
  });

  it("ano que vem não tem mês fechado", () => {
    expect(ultimoMesFechado(2027, em("2026-08-26"))).toBe(-1);
  });

  it("em janeiro o ano corrente ainda não fechou mês nenhum", () => {
    expect(ultimoMesFechado(2026, em("2026-01-15"))).toBe(-1);
  });
});

describe("mesesDoPeriodo", () => {
  it("12 meses é o ano inteiro", () => {
    expect(mesesDoPeriodo("12m", 6)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("o trimestre termina no último mês fechado, não no corrente", () => {
    // Ago está em andamento; incluí-lo mostraria meio mês ao lado de dois inteiros.
    expect(mesesDoPeriodo("tri", 6)).toEqual([4, 5, 6]);
  });

  it("o mês é só o último fechado", () => {
    expect(mesesDoPeriodo("mes", 6)).toEqual([6]);
  });

  it("no começo do ano o trimestre encolhe em vez de pegar mês negativo", () => {
    expect(mesesDoPeriodo("tri", 1)).toEqual([0, 1]);
  });

  it("sem mês fechado, qualquer recorte cai no ano cheio", () => {
    expect(mesesDoPeriodo("mes", -1)).toHaveLength(12);
    expect(mesesDoPeriodo("tri", -1)).toHaveLength(12);
  });
});

describe("desvioVsMedia", () => {
  it("mede a distância para a média dos 3 anteriores", () => {
    const m = [100, 100, 100, 150, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(desvioVsMedia(m, 3)).toEqual({ media: 100, desvio: 0.5 });
  });

  it("mês zerado no meio não puxa a média para baixo", () => {
    // A linha só começou em fevereiro: jan = 0 não é "gastou zero", é "não existia".
    const m = [0, 100, 200, 150, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(desvioVsMedia(m, 3)?.media).toBe(150);
  });

  it("menos de dois meses de base não dá comparação", () => {
    const m = [0, 0, 100, 150, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(desvioVsMedia(m, 3)).toBeNull();
  });

  it("mês sem valor não tem desvio", () => {
    const m = [100, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(desvioVsMedia(m, 3)).toBeNull();
  });

  it("queda vira desvio negativo", () => {
    const m = [200, 200, 200, 100, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(desvioVsMedia(m, 3)?.desvio).toBeCloseTo(-0.5);
  });
});

describe("seloDaLinha", () => {
  it("sem departamento nem categoria é sem regra, mesmo zerada", () => {
    // "zero" faria parecer que ninguém recebeu; o problema é a regra em branco.
    expect(seloDaLinha(null, false, 0)).toBe("semregra");
  });

  it("a nota CONFERIR vence o resto", () => {
    expect(seloDaLinha("CONFERIR: apontado por semelhança de nome", true, 5000)).toBe("conferir");
  });

  it("regra preenchida e total zerado é zero", () => {
    expect(seloDaLinha("Folha de quem está em MGM.", true, 0)).toBe("zero");
  });

  it("regra preenchida, nota comum e dinheiro na linha é conferido", () => {
    expect(seloDaLinha("Fecha exato em Jul/26.", true, 71612.5)).toBe("ok");
  });
});
