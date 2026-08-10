import { describe, it, expect } from "vitest";
import {
  calcular, media, mesReferencia, rubricasOrfas, classificacaoPadrao,
  rotuloCurto, rotuloLongo, sortKey, colunaDoMes, type Bucket,
} from "./pontoEquilibrio";

/* DRE mínima: receita 100k, variável 20k, fixo 40k.
   MC% = 80% → PE = 40k / 0,8 = 50k. */
const COLS = ["Jun-26"];
const ROWS = [
  { Conta: "Receita de Assinaturas", "Jun-26": 100_000 },
  { Conta: "Meios de Pagamento", "Jun-26": -20_000 },
  { Conta: "Equipe Administrativa", "Jun-26": -40_000 },
  { Conta: "EBITDA", "Jun-26": 40_000 }, // linha de total: não pode entrar na conta
];
const CLASSIF: Record<string, Bucket> = {
  "Meios de Pagamento": "variavel",
  "Equipe Administrativa": "fixo",
};

describe("calcular", () => {
  it("aplica fixos / margem de contribuição", () => {
    const [m] = calcular(ROWS, COLS, CLASSIF);
    expect(m.receita).toBe(100_000);
    expect(m.variaveis).toBe(20_000);
    expect(m.fixos).toBe(40_000);
    expect(m.mcPct).toBeCloseTo(80, 6);
    expect(m.pe).toBeCloseTo(50_000, 6);
    expect(m.margemSeguranca).toBeCloseTo(50_000, 6);
    expect(m.msPct).toBeCloseTo(50, 6);
    expect(m.resultado).toBeCloseTo(40_000, 6);
  });

  it("ignora linhas de total e rubricas não classificadas", () => {
    const [m] = calcular(ROWS, COLS, CLASSIF);
    // EBITDA (40k) está no blob mas não pode virar custo nem receita
    expect(m.fixos).toBe(40_000);
  });

  it("chega no mesmo número com despesa gravada positiva (import do tracker)", () => {
    const positivo = ROWS.map((r) =>
      r.Conta === "Receita de Assinaturas" || r.Conta === "EBITDA"
        ? r
        : { ...r, "Jun-26": Math.abs(r["Jun-26"] as number) },
    );
    const [m] = calcular(positivo, COLS, CLASSIF);
    expect(m.variaveis).toBe(20_000);
    expect(m.fixos).toBe(40_000);
    expect(m.pe).toBeCloseTo(50_000, 6);
  });

  it("mantém crédito abatendo em vez de somar", () => {
    // Estorno positivo no meio de despesas negativas reduz o custo fixo.
    const comCredito = [...ROWS, { Conta: "(-) Estorno de Compras", "Jun-26": 10_000 }];
    const [m] = calcular(comCredito, COLS, { ...CLASSIF, "(-) Estorno de Compras": "fixo" });
    expect(m.fixos).toBe(30_000);
  });

  it("não devolve ponto de equilíbrio quando a margem de contribuição é negativa", () => {
    const rows = [
      { Conta: "Receita de Assinaturas", "Jun-26": 100_000 },
      { Conta: "Meios de Pagamento", "Jun-26": -120_000 },
      { Conta: "Equipe Administrativa", "Jun-26": -40_000 },
    ];
    const [m] = calcular(rows, COLS, CLASSIF);
    expect(m.mcPct).toBeLessThan(0);
    expect(m.pe).toBeNull();
    expect(m.margemSeguranca).toBeNull();
  });

  it("mês sem receita não vira ponto de equilíbrio infinito", () => {
    const [m] = calcular([{ Conta: "Equipe Administrativa", "Jun-26": -40_000 }], COLS, CLASSIF);
    expect(m.mcPct).toBeNull();
    expect(m.pe).toBeNull();
  });

  it("rubrica marcada 'fora' sai da conta", () => {
    const [m] = calcular(ROWS, COLS, { ...CLASSIF, "Equipe Administrativa": "fora" });
    expect(m.fixos).toBe(0);
    expect(m.pe).toBe(0);
  });
});

describe("media", () => {
  it("pondera pelos totais, não pela média simples dos PEs", () => {
    // Mês A: receita 100k / var 20k / fixo 40k. Mês B: receita 0 / var 0 / fixo 40k.
    // Média simples seria impossível (o PE de B não existe); a ponderada dá
    // receita 50k, var 10k, fixo 40k → MC 80% → PE 50k.
    const meses = calcular(
      [
        { Conta: "Receita de Assinaturas", "Jun-26": 100_000, "Jul-26": 0 },
        { Conta: "Meios de Pagamento", "Jun-26": -20_000, "Jul-26": 0 },
        { Conta: "Equipe Administrativa", "Jun-26": -40_000, "Jul-26": -40_000 },
      ],
      ["Jun-26", "Jul-26"],
      CLASSIF,
    );
    const m = media(meses, "3m")!;
    expect(m.receita).toBe(50_000);
    expect(m.fixos).toBe(40_000);
    expect(m.pe).toBeCloseTo(50_000, 6);
  });

  it("devolve null sem meses", () => {
    expect(media([])).toBeNull();
  });
});

describe("mesReferencia", () => {
  const cols = ["Abr-26", "Mai-26", "Jun-26", "Jul-26"];
  const res = cols.map((c) => ({ mes: c, receita: 100 } as any));

  it("usa o último mês travado", () => {
    expect(mesReferencia(cols, new Set(["Abr-26", "Jun-26"]), res, "Jul-26")).toBe("Jun-26");
  });

  it("sem travas, pula o mês corrente", () => {
    expect(mesReferencia(cols, new Set(), res, "Jul-26")).toBe("Jun-26");
  });

  it("sem travas, pula meses sem receita", () => {
    const semReceita = res.map((r) => (r.mes === "Jun-26" ? { ...r, receita: 0 } : r));
    expect(mesReferencia(cols, new Set(), semReceita, "Jul-26")).toBe("Mai-26");
  });

  it("devolve null quando não há mês elegível", () => {
    expect(mesReferencia(["Jul-26"], new Set(), [{ mes: "Jul-26", receita: 0 } as any], "Jul-26")).toBeNull();
  });
});

describe("rubricasOrfas / classificacaoPadrao", () => {
  it("acusa rubrica fora do catálogo e não confunde com total", () => {
    const rows = [
      { Conta: "Receita de Assinaturas" },
      { Conta: "EBITDA" },
      { Conta: "% Margem EBITDA Ajustado" },
      { Conta: "Equipe Administrativa" },
      { Conta: "Fretes e Logística" },
    ];
    expect(rubricasOrfas(rows)).toEqual(["Fretes e Logística"]);
  });

  it("órfã nasce fora da conta e o catálogo nasce fixo salvo exceção", () => {
    const c = classificacaoPadrao([{ Conta: "Fretes e Logística" }]);
    expect(c["Fretes e Logística"]).toBe("fora");
    expect(c["Equipe Administrativa"]).toBe("fixo");
    expect(c["Meios de Pagamento"]).toBe("variavel");
    expect(c["IRPJ"]).toBe("fora");
  });
});

describe("rótulos de mês", () => {
  it("formata curto e longo em pt-BR", () => {
    expect(rotuloCurto("Jun-26")).toBe("Jun/26");
    expect(rotuloLongo("Jun-26")).toBe("Junho 2026");
    expect(rotuloLongo("Mar-25")).toBe("Março 2025");
  });

  it("ordena cruzando o ano", () => {
    const cols = ["Jan-26", "Dec-25", "Feb-26"];
    expect([...cols].sort((a, b) => sortKey(a) - sortKey(b))).toEqual(["Dec-25", "Jan-26", "Feb-26"]);
  });

  it("colunaDoMes usa o mês corrente", () => {
    expect(colunaDoMes(new Date(2026, 7, 10))).toBe("Aug-26");
  });
});
