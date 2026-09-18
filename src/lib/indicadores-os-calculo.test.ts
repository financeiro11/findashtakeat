import { describe, expect, it } from "vitest";
import {
  avaliar, completarMensal, ehSomaPura, idsSensiveis, parseFormula, refsDe,
  type AssinaturaOS, type CustoOS,
} from "./indicadores-os-calculo";
import type { IndicadorOS, LinhaMensalOS } from "./indicadores-os";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

describe("parseFormula", () => {
  it("lê o formato do OS, com espaços duplos e custo", () => {
    const no = parseFormula(" (  [cost:4795d14c-485d-4df5-b764-03b2cb9f74e5] +  [" + U(1) + "] )  /  [" + U(2) + "]");
    expect(refsDe(no)).toEqual({ refs: [U(1), U(2)], custos: ["4795d14c-485d-4df5-b764-03b2cb9f74e5"] });
    expect(avaliar(no, (id) => (id === U(1) ? 100 : 4), () => 300)).toBe(100);
  });
  it("precedência e número literal (LTV)", () => {
    const f = `[${U(1)}] * ( 1 / ( [${U(2)}] / 100 ) ) * ( [${U(3)}] / 100 )`;
    const v = avaliar(parseFormula(f), (id) => ({ [U(1)]: 400, [U(2)]: 4, [U(3)]: 75 })[id] ?? null, () => null);
    expect(v).toBeCloseTo(7500); // 400 × 25 × 0,75
  });
  it("null contagia e divisão por zero é null", () => {
    const no = parseFormula(`[${U(1)}] / [${U(2)}]`);
    expect(avaliar(no, (id) => (id === U(1) ? 5 : null), () => null)).toBeNull();
    expect(avaliar(no, (id) => (id === U(1) ? 5 : 0), () => null)).toBeNull();
  });
  it("recusa fórmula com lixo", () => {
    expect(() => parseFormula("[abc] + 1")).toThrow();
    expect(() => parseFormula(`([${U(1)}]`)).toThrow();
  });
  it("soma pura", () => {
    expect(ehSomaPura(parseFormula(`[${U(1)}] +  [${U(2)}] + [${U(3)}]`))).toBe(true);
    expect(ehSomaPura(parseFormula(`[${U(1)}] / [${U(2)}]`))).toBe(false);
  });
});

/* ------------------------------ um mês de mentira, com a forma do OS ------------------------------ */
const ind = (id: string, canal: string, indicador: string, extra: Partial<IndicadorOS> = {}): IndicadorOS => ({
  id, departamento: "Aquisição", canal, indicador, unidade: "BRL", sensivel: false, e_formula: false,
  north_star: false, menor_e_melhor: null, ativo: true, no_painel: true, ordem: 0, formula: null, ...extra,
});
const f = (id: string, canal: string, indicador: string, formula: string, extra: Partial<IndicadorOS> = {}) =>
  ind(id, canal, indicador, { e_formula: true, formula, ...extra });

const MRR_IS = U(1), MRR_COM = U(2), NOV_IS = U(3), NOV_COM = U(4), ADS = U(5), MARGEM = U(6), CHURN = U(7);
const MRR_TOT = U(10), NOV_TOT = U(11), TM = U(12), LTV = U(13), CAC = U(14), CAC_MKT = U(15), PAYBACK = U(16);
const TOT_CLI = U(20), ENG = U(21), TAXA_ENG = U(22), AT_Q = U(23), AT_PC = U(24), FS_CAC = U(25), FS_NOV = U(26);

const indicadores: IndicadorOS[] = [
  ind(MRR_IS, "Inside Sales", "Novo MRR"), ind(MRR_COM, "Comunidade", "Novo MRR"),
  ind(NOV_IS, "Inside Sales", "Novos Clientes", { unidade: "count" }), ind(NOV_COM, "Comunidade", "Novos Clientes", { unidade: "count" }),
  ind(FS_NOV, "Field Sales", "Novos Clientes", { unidade: "count" }),
  ind(ADS, "Performance", "Investimento ADS Field Sales"),
  ind(MARGEM, "Consolidado", "Margem de Contribuição", { unidade: "percent", sensivel: true }),
  ind(CHURN, "Consolidado", "% Churn Revenue Total", { departamento: "Operação", unidade: "percent" }),
  f(MRR_TOT, "Consolidado", "Novo MRR Total", `[${MRR_IS}] + [${MRR_COM}]`),
  f(NOV_TOT, "Consolidado", "Novos Clientes Total", `[${NOV_IS}] +  [${NOV_COM}] + [${FS_NOV}]`, { unidade: "count" }),
  f(TM, "Consolidado", "TM MRR", `[${MRR_TOT}] /  [${NOV_TOT}]`),
  f(LTV, "Consolidado", "LTV", `[${TM}] * ( 1 / ( [${CHURN}] / 100 ) ) * ( [${MARGEM}] / 100 )`),
  f(CAC, "Consolidado", "CAC",
    `( [cost:c0ca2b38-99d3-4335-ab96-1bab3f1f1bbf] + [cost:4e520604-5143-4cab-ba2d-ba2bb7dd50f5] + [${ADS}] ) / [${NOV_TOT}]`),
  f(CAC_MKT, "Consolidado", "CAC MKT", `( [${ADS}] + [cost:6849b020-9833-404d-ad37-3fa838975cd6] ) / [${NOV_TOT}]`),
  f(PAYBACK, "Consolidado", "CAC Payback", `[${CAC}] / ( [${MARGEM}] / 100 * [${TM}] )`, { unidade: "count" }),
  ind(TOT_CLI, "Consolidado", "Total Clientes", { departamento: "Backoffice", ativo: false, unidade: "count" }),
  ind(ENG, "MGM", "Clientes Engajados", { unidade: "count" }),
  f(TAXA_ENG, "MGM", "Taxa de Engajamento", `( [${ENG}] / [${TOT_CLI}] )  *  100`, { unidade: "percent" }),
  ind(AT_Q, "Ativação", "Customer Churn", { departamento: "Operação", unidade: "count" }),
  ind(AT_PC, "Ativação", "% Customer Churn", { departamento: "Operação", unidade: "percent" }),
  f(FS_CAC, "Field Sales", "CAC", `[cost:4e520604-5143-4cab-ba2d-ba2bb7dd50f5] /  [${FS_NOV}]`),
];

const AGO = "2026-08-01";
const l = (id: string, realizado: number | null, orcado: number | null = null): LinhaMensalOS =>
  ({ indicator_id: id, ano: 2026, mes: 8, competencia: AGO, orcado, realizado });

const linhas: LinhaMensalOS[] = [
  l(MRR_IS, 95264.06), l(MRR_COM, null), l(NOV_IS, 217), l(NOV_COM, null), l(FS_NOV, 34),
  l(ADS, 5000), l(MARGEM, 76.5), l(CHURN, 4.27),
  l(MRR_TOT, null, 154040.5), l(NOV_TOT, null, 350), l(TM, null), l(LTV, null), l(CAC, null),
  l(CAC_MKT, null), l(PAYBACK, null), l(ENG, 30), l(TAXA_ENG, null), l(AT_PC, 2.3), l(AT_Q, null), l(FS_CAC, null),
];

const custos: CustoOS[] = [
  { competencia: AGO, grupo: "Equipes", categoria: "Field Sales", valor: 77093.38 },
  { competencia: AGO, grupo: "Equipes", categoria: "Inside Sales", valor: 78974.64 },
  { competencia: AGO, grupo: "Equipes", categoria: "Sucesso", valor: 23800 },
  { competencia: AGO, grupo: "Equipes", categoria: "Suporte", valor: 63830.14 },
  { competencia: AGO, grupo: "Equipes", categoria: "Liderança OPS", valor: 21440.86 },
  { competencia: AGO, grupo: "Investimentos", categoria: "Eventos", valor: 125777.83 },
  { competencia: AGO, grupo: "Comissões", categoria: "Consultores", valor: 11827.92 },
];
const assinaturas: AssinaturaOS[] = [
  { competencia: "2026-07-01", clientes: 2961 },
  { competencia: AGO, clientes: 3000 },
];

const saida = completarMensal(indicadores, linhas, custos, assinaturas);
const de = (id: string) => saida.find((x) => x.indicator_id === id && x.competencia === AGO)!;

describe("idsSensiveis", () => {
  it("herda a marca por dependência, em cadeia", () => {
    const LTV_CAC = U(30);
    const comDerivado = [...indicadores, f(LTV_CAC, "Consolidado", "LTV/CAC", `[${LTV}] / [${CAC}]`), ];
    const sens = idsSensiveis(comDerivado);
    expect(sens.has(MARGEM)).toBe(true);        // marcado pelo OS
    expect(sens.has(LTV)).toBe(true);           // usa Margem
    expect(sens.has(PAYBACK)).toBe(true);       // usa Margem
    expect(sens.has(LTV_CAC)).toBe(true);       // usa LTV, que usa Margem
    expect(sens.has(CAC)).toBe(false);
    expect(sens.has(TM)).toBe(false);
  });
});

describe("completarMensal", () => {
  it("nunca sobrescreve o OS", () => {
    expect(de(MRR_IS)).toMatchObject({ realizado: 95264.06, origem: "os" });
    const comValor = completarMensal(indicadores, [...linhas.filter((x) => x.indicator_id !== TM), l(TM, 999)], custos, assinaturas);
    expect(comValor.find((x) => x.indicator_id === TM)).toMatchObject({ realizado: 999, origem: "os" });
  });

  it("soma com canal faltando sai parcial, dizendo quem faltou, e mantém o orçado", () => {
    expect(de(MRR_TOT)).toMatchObject({ realizado: 95264.06, origem: "hub_parcial", orcado: 154040.5 });
    expect(de(MRR_TOT).nota).toContain("Comunidade");
    expect(de(NOV_TOT)).toMatchObject({ realizado: 251, origem: "hub_parcial" });
  });

  it("o que depende de parcial herda a marca (TM, LTV)", () => {
    expect(de(TM).realizado).toBeCloseTo(95264.06 / 251);
    expect(de(TM).origem).toBe("hub_parcial");
    expect(de(LTV).realizado).toBeCloseTo((95264.06 / 251) * (100 / 4.27) * 0.765);
    expect(de(LTV).origem).toBe("hub_parcial");
  });

  it("CAC consolidado: custos menos Sucesso/Suporte/Liderança OPS, mais ADS", () => {
    const aquisicao = 77093.38 + 78974.64 + 125777.83 + 11827.92;
    expect(de(CAC).realizado).toBeCloseTo((aquisicao + 5000) / 251);
    expect(de(CAC).nota).toContain("Sucesso");
  });

  it("CAC MKT: Investimentos + Comissões + ADS, estimado", () => {
    expect(de(CAC_MKT).realizado).toBeCloseTo((125777.83 + 11827.92 + 5000) / 251);
    expect(["hub_estimado", "hub_parcial"]).toContain(de(CAC_MKT).origem);
  });

  it("CAC de canal com custo identificado usa o os_custos do mês", () => {
    expect(de(FS_CAC)).toMatchObject({ origem: "hub" });
    expect(de(FS_CAC).realizado).toBeCloseTo(77093.38 / 34);
  });

  it("Payback encadeia CAC e TM MRR", () => {
    const esperado = de(CAC).realizado! / (0.765 * de(TM).realizado!);
    expect(de(PAYBACK).realizado).toBeCloseTo(esperado);
  });

  it("Total Clientes vem da carteira do OS e destrava a Taxa de Engajamento", () => {
    expect(de(TOT_CLI)).toMatchObject({ realizado: 3000, origem: "hub" });
    expect(de(TAXA_ENG).realizado).toBeCloseTo(1);
  });

  it("churn de Ativação sem contagem: % × clientes da base do mês anterior", () => {
    expect(de(AT_Q)).toMatchObject({ realizado: Math.round(0.023 * 2961), origem: "hub_estimado" });
  });

  it("o total anual do OS (mes 13, sem competência) é ignorado, não derruba o cálculo", () => {
    const anual = { indicator_id: CAC, ano: 2026, mes: 13, competencia: null as unknown as string, orcado: 3000, realizado: null };
    expect(() => completarMensal(indicadores, [...linhas, anual], custos, assinaturas)).not.toThrow();
  });

  it("mês sem custo nenhum não inventa CAC", () => {
    const semCusto = completarMensal(indicadores, linhas, [], assinaturas);
    expect(semCusto.find((x) => x.indicator_id === CAC)?.realizado).toBeNull();
    expect(semCusto.find((x) => x.indicator_id === FS_CAC)?.realizado).toBeNull();
  });
});
