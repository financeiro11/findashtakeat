import { describe, it, expect } from "vitest";
import {
  parseColuna, colunasDe, indexar, valorBruto, valorDoNo, valorNoPeriodo,
  ultimoMesFechado, variacao, rotulosDeDespesa, flattenLabels,
  DRE_SCHEMA, DFC_SCHEMA, type LinhaBase, type Node,
} from "./demonstracoes-schema";

/* A base congelada é um blob plano; toda a leitura passa por aqui. Os números
   dos testes são os reais da Takeat (2024/2025), para o cálculo não divergir
   em silêncio do que a DRE já mostra. */

describe("parseColuna", () => {
  it("entende o formato da base", () => {
    expect(parseColuna("Jan-24")).toEqual({ col: "Jan-24", ano: 2024, mes: 1 });
    expect(parseColuna("Dec-25")).toEqual({ col: "Dec-25", ano: 2025, mes: 12 });
    expect(parseColuna("Jun-26")).toEqual({ col: "Jun-26", ano: 2026, mes: 6 });
  });

  it("ignora a coluna de rótulo e lixo", () => {
    expect(parseColuna("Conta")).toBeNull();
    expect(parseColuna("Total")).toBeNull();
    expect(parseColuna("Xyz-24")).toBeNull();
  });

  it("colunasDe filtra só os meses, na ordem", () => {
    const cols = colunasDe(["Conta", "Jan-24", "Feb-24", "Total"]);
    expect(cols.map((c) => c.col)).toEqual(["Jan-24", "Feb-24"]);
  });
});

describe("indexar / valorBruto", () => {
  const rows: LinhaBase[] = [
    { Conta: "Receita Bruta", "Jan-24": 250997, "Feb-24": "" },
    { Conta: "Encargos sociais", "Jan-24": -1000 },
  ];
  const idx = indexar(rows);

  it("lê valor por rótulo", () => {
    expect(valorBruto(idx, "Receita Bruta", "Jan-24")).toBe(250997);
  });

  it("célula vazia vale zero", () => {
    expect(valorBruto(idx, "Receita Bruta", "Feb-24")).toBe(0);
    expect(valorBruto(idx, "Receita Bruta", "Mar-24")).toBe(0);
  });

  it("casa mesmo com caixa/acento diferentes — a base mistura as duas grafias", () => {
    expect(valorBruto(idx, "Encargos Sociais", "Jan-24")).toBe(-1000);
  });

  it("rótulo inexistente vale zero, não quebra", () => {
    expect(valorBruto(idx, "Não existe", "Jan-24")).toBe(0);
  });
});

describe("valorDoNo", () => {
  const rows: LinhaBase[] = [
    { Conta: "Receita de Assinaturas", "Jan-24": 100 },
    { Conta: "Enterprise", "Jan-24": 20 },
    { Conta: "Receita com Materiais", "Jan-24": 5 },
    { Conta: "Receita Markup", "Jan-24": 3 },
    { Conta: "Serviços para Clientes", "Jan-24": 2 },
    { Conta: "Receita Bruta", "Jan-24": 999999 }, // valor próprio da base: deve ser ignorado
    { Conta: "EBITDA", "Jan-24": -4321 },
  ];
  const idx = indexar(rows);
  const receitaBruta = DRE_SCHEMA.find((n) => n.label === "Receita Bruta")!;
  const ebitda = DRE_SCHEMA.find((n) => n.label === "EBITDA")!;

  it("nó com filhos soma os filhos, não lê a própria linha", () => {
    // 100+20 (recorrente) + 5+3+2 (spot) = 130 — e não 999999
    expect(valorDoNo(idx, receitaBruta, "Jan-24")).toBe(130);
  });

  it("nó sem filhos lê a própria linha", () => {
    expect(valorDoNo(idx, ebitda, "Jan-24")).toBe(-4321);
  });

  it("soma ao longo do período", () => {
    const rows2: LinhaBase[] = [{ Conta: "EBITDA", "Jan-24": 10, "Feb-24": 20, "Mar-24": 30 }];
    const idx2 = indexar(rows2);
    const cols = colunasDe(["Jan-24", "Feb-24", "Mar-24"]);
    expect(valorNoPeriodo(idx2, ebitda, cols)).toBe(60);
    expect(valorNoPeriodo(idx2, ebitda, cols.slice(0, 2))).toBe(30); // YTD
  });
});

describe("ultimoMesFechado", () => {
  const cols = colunasDe(["Jan-26", "Feb-26", "Mar-26"]);

  it("descarta o mês em aberto com meia dúzia de linhas soltas", () => {
    // Mar-26 imita o Jul-26 real: quase tudo vazio e um "1" solto
    const rows: LinhaBase[] = Array.from({ length: 20 }, (_, i) => ({
      Conta: `L${i}`, "Jan-26": 10, "Feb-26": 10, "Mar-26": i === 0 ? 1 : "",
    }));
    expect(ultimoMesFechado(rows, cols)?.col).toBe("Feb-26");
  });

  it("mantém o mês quando ele está de fato cheio", () => {
    const rows: LinhaBase[] = Array.from({ length: 20 }, (_, i) => ({
      Conta: `L${i}`, "Jan-26": 10, "Feb-26": 10, "Mar-26": 10,
    }));
    expect(ultimoMesFechado(rows, cols)?.col).toBe("Mar-26");
  });

  it("base vazia devolve null em vez de quebrar", () => {
    expect(ultimoMesFechado([], cols)).toBeNull();
    expect(ultimoMesFechado([{ Conta: "L" }], cols)).toBeNull();
  });
});

describe("variacao", () => {
  it("receita: sinal normal, subir é bom (Receita Bruta 24→25 = +95%)", () => {
    const v = variacao(4258228, 8313700)!;
    expect(Math.round(v.pct * 100)).toBe(95);
    expect(v.sobe).toBe(true);
    expect(v.bom).toBe(true);
  });

  it("despesa: compara o módulo e subir é ruim (Custos 24→25 = +19%)", () => {
    const v = variacao(-996462, -1180920, { despesa: true })!;
    expect(Math.round(v.pct * 100)).toBe(19);
    expect(v.sobe).toBe(true);
    expect(v.bom).toBe(false); // gastou mais
  });

  it("resultado que vira negativo cai, não 'gasta mais' (EBITDA 24→25 = -279%)", () => {
    const v = variacao(60336, -107752)!;
    expect(Math.round(v.pct * 100)).toBe(-279);
    expect(v.sobe).toBe(false);
    expect(v.bom).toBe(false);
  });

  it("percentual varia em pontos percentuais, não em %", () => {
    const v = variacao(0.743, 0.843, { percentual: true })!;
    expect(v.pp).toBeCloseTo(10, 1);
  });

  it("base zero não vira infinito", () => {
    expect(variacao(0, 100)).toBeNull();
    expect(variacao(0, 0)).toBeNull();
  });
});

describe("rotulosDeDespesa", () => {
  const despesas = rotulosDeDespesa(DRE_SCHEMA);

  it("marca o bloco (-) e tudo que desce dele", () => {
    expect(despesas.has("(-) SG&A")).toBe(true);
    expect(despesas.has("Pessoal")).toBe(true);              // filho de (-) SG&A
    expect(despesas.has("Equipe Administrativa")).toBe(true); // neto
    expect(despesas.has("(-) Custos Operacionais")).toBe(true);
  });

  it("não marca receita nem linha de resultado", () => {
    expect(despesas.has("Receita Bruta")).toBe(false);
    expect(despesas.has("Receita Recorrente")).toBe(false);
    expect(despesas.has("EBITDA")).toBe(false);
    expect(despesas.has("Lucro Líquido")).toBe(false);
  });
});

describe("esquemas", () => {
  it("DRE e DFC têm os totais que os KPIs leem", () => {
    const dre = flattenLabels(DRE_SCHEMA);
    for (const l of ["Receita Bruta", "Receita Líquida", "EBITDA", "Lucro Líquido"]) {
      expect(dre).toContain(l);
    }
    expect(flattenLabels(DFC_SCHEMA)).toContain("Fluxo de Caixa Operacional");
  });

  it("nenhum rótulo repetido dentro do mesmo esquema (quebraria o índice)", () => {
    for (const esquema of [DRE_SCHEMA, DFC_SCHEMA]) {
      const labels = flattenLabels(esquema as Node[]);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
