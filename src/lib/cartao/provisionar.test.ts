import { describe, expect, it } from "vitest";
import type { LinhaOfx } from "./ofx";
import { agrupar, classificar, expandir, separar, vencimentoDe } from "./provisionar";

const linha = (over: Partial<LinhaOfx> & { memo: string; valor: number }): LinhaOfx => ({
  fitid: over.memo.slice(0, 8) + over.valor,
  data: "2026-06-12",
  sinal: "debito",
  estabelecimento: over.memo.slice(0, 22).trim(),
  chave: over.memo.slice(0, 8).toUpperCase(),
  parcela: null,
  cidade: null,
  exterior: null,
  tarifa: false,
  ...over,
});

describe("classificar", () => {
  it("ignora parcela de 2 em diante — já foi provisionada", () => {
    const r = classificar(linha({ memo: "MP*MERCADOLIVREV      07/12   ITU", valor: 80.77, parcela: { n: 7, de: 12 } }));
    expect(r.balde).toBe("ignorar");
    expect(r.motivo).toContain("7/12");
  });

  it("manda a 1ª parcela para o balde que gera as demais", () => {
    expect(classificar(linha({ memo: "LATAM AIR*EENRZOV     01/04", valor: 218.03, parcela: { n: 1, de: 4 } })).balde)
      .toBe("primeira");
  });

  it("compra sem marcador é crédito à vista", () => {
    expect(classificar(linha({ memo: "ANTHROPICV", valor: 550 })).balde).toBe("avista");
  });

  it("IOF entra como despesa do mês, marcado como tarifa", () => {
    const r = classificar(linha({ memo: "IOF OPERACAO EXTERIOR", valor: 19.25, tarifa: true }));
    expect(r.balde).toBe("avista");
    expect(r.motivo).toContain("Tarifa");
  });

  it("tira da despesa o pagamento da fatura e os estornos", () => {
    expect(classificar(linha({ memo: "PAGAMENTO-BOLETO BANCARIO", valor: 52000, sinal: "credito" })).balde)
      .toBe("nao-financeiro");
    expect(classificar(linha({ memo: "LATAM AIR*0000V", valor: 644.12, sinal: "credito" })).balde)
      .toBe("nao-financeiro");
  });

  it("a parcela manda, não a data — a 7ª de dezembro chega datada de dezembro", () => {
    const antiga = linha({
      memo: "MP*MERCADOLIVREV      07/12", valor: 80.77,
      data: "2025-12-03", parcela: { n: 7, de: 12 },
    });
    // Uma compra à vista feita no mesmo dia da compra antiga cairia no mesmo
    // lado se a separação fosse por data.
    expect(classificar(antiga).balde).toBe("ignorar");
    expect(classificar({ ...antiga, parcela: null }).balde).toBe("avista");
  });
});

describe("separar", () => {
  const s = separar([
    linha({ memo: "ANTHROPICV", valor: 550 }),
    linha({ memo: "IOF OPERACAO EXTERIOR", valor: 19.25, tarifa: true }),
    linha({ memo: "LATAM AIR*EENRZOV     01/04", valor: 218.03, parcela: { n: 1, de: 4 } }),
    linha({ memo: "MP*MERCADOLIVREV      07/12", valor: 80.77, parcela: { n: 7, de: 12 } }),
    linha({ memo: "PAGAMENTO-BOLETO BANCARIO", valor: 52000, sinal: "credito" }),
  ]);

  it("soma cada balde", () => {
    expect(s.totais.avista).toBeCloseTo(569.25);
    expect(s.totais.primeira).toBeCloseTo(218.03);
    expect(s.totais.ignorar).toBeCloseTo(80.77);
  });

  it("o total da fatura inclui as parcelas antigas; o a provisionar, não", () => {
    // A diferença entre os dois é exatamente o que hoje se duplica à mão.
    expect(s.totalFatura).toBeCloseTo(868.05);
    expect(s.totalAProvisionar).toBeCloseTo(787.28);
    expect(s.totalFatura - s.totalAProvisionar).toBeCloseTo(s.totais.ignorar);
  });

  it("o pagamento da fatura fica fora dos dois totais", () => {
    expect(s.totalFatura).toBeLessThan(52000);
  });
});

describe("expandir", () => {
  const provisoes = expandir(
    separar([
      linha({ memo: "ANTHROPICV", valor: 550 }),
      linha({ memo: "LATAM AIR*EENRZOV     01/04", valor: 218.03, parcela: { n: 1, de: 4 } }),
      linha({ memo: "MP*MERCADOLIVREV      07/12", valor: 80.77, parcela: { n: 7, de: 12 } }),
    ]).linhas,
    "2026-07-01",
    "2026-07-10",
  );

  it("uma compra à vista vira um título; a 1ª de 4 vira quatro", () => {
    expect(provisoes).toHaveLength(5);
    expect(provisoes.filter((p) => p.parcela)).toHaveLength(4);
  });

  it("as parcelas caem em meses consecutivos a partir da fatura atual", () => {
    const parceladas = provisoes.filter((p) => p.parcela);
    expect(parceladas.map((p) => p.competencia)).toEqual([
      "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01",
    ]);
    expect(parceladas.map((p) => p.vencimento)).toEqual([
      "2026-07-10", "2026-08-10", "2026-09-10", "2026-10-10",
    ]);
  });

  it("não gera nada para o que foi ignorado", () => {
    expect(provisoes.some((p) => p.memo.includes("07/12"))).toBe(false);
  });

  it("cada parcela tem chave de idempotência própria", () => {
    const chaves = provisoes.map((p) => p.integracao);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(chaves.some((c) => c.endsWith("-04"))).toBe(true);
  });

  it("avisa que o valor das parcelas seguintes é repetição da primeira", () => {
    const parceladas = provisoes.filter((p) => p.parcela);
    expect(parceladas.map((p) => p.valorEstimado)).toEqual([false, true, true, true]);
  });
});

describe("agrupar", () => {
  const grupos = agrupar(separar([
    linha({ memo: "UBER * PENDING", valor: 30, chave: "UBER", estabelecimento: "UBER * PENDING" }),
    linha({ memo: "UBER * PENDINGV", valor: 25, chave: "UBER", estabelecimento: "UBER * PENDING" }),
    linha({ memo: "UBER* TRIPV", valor: 18, chave: "UBER", estabelecimento: "UBER* TRIP" }),
    linha({ memo: "LATAM AIR*EENRZOV 01/04", valor: 218.03, chave: "LATAM AIR", parcela: { n: 1, de: 4 } }),
  ]).linhas);

  it("junta as variantes do mesmo lojista e ordena pelo maior", () => {
    expect(grupos.map((g) => g.chave)).toEqual(["LATAM AIR", "UBER"]);
    expect(grupos[1].linhas).toHaveLength(3);
    expect(grupos[1].total).toBeCloseTo(73);
  });

  it("mostra o nome mais frequente do grupo", () => {
    expect(grupos[1].estabelecimento).toBe("UBER * PENDING");
  });

  it("conta os títulos que o grupo vai gerar, não as linhas", () => {
    // Uma 1ª de 4 é uma linha na fatura e quatro títulos no Omie.
    expect(grupos[0].linhas).toHaveLength(1);
    expect(grupos[0].titulos).toBe(4);
  });
});

describe("vencimentoDe", () => {
  it("mantém o dia do vencimento nos meses à frente", () => {
    expect(vencimentoDe("2026-07-01", "2026-07-10", "2026-07-01")).toBe("2026-07-10");
    expect(vencimentoDe("2027-01-01", "2026-07-10", "2026-07-01")).toBe("2027-01-10");
  });

  it("encolhe o dia que não existe no mês", () => {
    expect(vencimentoDe("2027-02-01", "2026-07-31", "2026-07-01")).toBe("2027-02-28");
    expect(vencimentoDe("2028-02-01", "2026-07-31", "2026-07-01")).toBe("2028-02-29");
  });

  it("preserva a distância entre competência e vencimento", () => {
    // Fatura de julho vencendo em agosto: toda parcela vence um mês depois da
    // sua competência. Assumir "mesmo mês" adiantaria a série inteira.
    expect(vencimentoDe("2026-09-01", "2026-08-05", "2026-07-01")).toBe("2026-10-05");
  });
});
