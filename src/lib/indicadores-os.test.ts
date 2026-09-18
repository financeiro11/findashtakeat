import { describe, expect, it } from "vitest";
import {
  atingimento, farol, fmtValorStr, fmtValorCurtoStr, mesPadrao, montarPainel, resumoFarois, sentidoDe,
  type IndicadorOS, type LinhaMensalOS,
} from "./indicadores-os";

const ind = (p: Partial<IndicadorOS>): IndicadorOS => ({
  id: "x", departamento: "Aquisição", canal: "Inside Sales", indicador: "Novo MRR", unidade: "BRL",
  sensivel: false, e_formula: false, north_star: false, menor_e_melhor: null, ativo: true, no_painel: true,
  ordem: 0, ...p,
});

describe("sentidoDe", () => {
  it("churn é menor-é-melhor mesmo sem a marca do OS", () => {
    // Estado real do OS em 18/09/2026: nenhum indicador de churn vem com menor_e_melhor.
    expect(sentidoDe({ indicador: "% Customer Churn", menor_e_melhor: null })).toBe("menor");
    expect(sentidoDe({ indicador: "Receita Churn Total", menor_e_melhor: false })).toBe("menor");
    expect(sentidoDe({ indicador: "Clientes Cancelados", menor_e_melhor: null })).toBe("menor");
    expect(sentidoDe({ indicador: "CAC MKT Payback", menor_e_melhor: null })).toBe("menor");
    expect(sentidoDe({ indicador: "CPL Meta ADS", menor_e_melhor: null })).toBe("menor");
  });
  it("a marca do OS vale sozinha", () => {
    expect(sentidoDe({ indicador: "Tempo médio resolução", menor_e_melhor: true })).toBe("menor");
    expect(sentidoDe({ indicador: "Qualquer coisa", menor_e_melhor: true })).toBe("menor");
  });
  it("LTV/CAC é maior-é-melhor, apesar do 'CAC' no nome", () => {
    expect(sentidoDe({ indicador: "LTV/CAC", menor_e_melhor: null })).toBe("maior");
    expect(sentidoDe({ indicador: "LTV", menor_e_melhor: null })).toBe("maior");
  });
  it("investimento é neutro; o resto é maior-é-melhor", () => {
    expect(sentidoDe({ indicador: "Investimento Meta ADS", menor_e_melhor: null })).toBe("neutro");
    expect(sentidoDe({ indicador: "Novo MRR", menor_e_melhor: null })).toBe("maior");
    expect(sentidoDe({ indicador: "Upsell", menor_e_melhor: null })).toBe("maior");
    // "cac" como palavra, não como pedaço: nada de pegar outro nome por acaso.
    expect(sentidoDe({ indicador: "Taxa de Conversão", menor_e_melhor: null })).toBe("maior");
  });
});

describe("atingimento e farol", () => {
  it("orçado nulo, zero ou negativo não é meta", () => {
    expect(atingimento(10, null)).toBeNull();
    expect(atingimento(10, 0)).toBeNull();
    expect(atingimento(26393, -7040.5)).toBeNull(); // Revenue Churn de ago/26 no OS
    expect(farol(10, 0, "maior")).toBe("sem_meta");
  });
  it("sem realizado é sem dado, antes de tudo", () => {
    expect(farol(null, 100, "maior")).toBe("sem_dado");
    expect(farol(undefined, 100, "neutro")).toBe("sem_dado");
  });
  it("maior-é-melhor: 100% bom, 85% atenção, abaixo ruim", () => {
    expect(farol(95264.06, 105000, "maior")).toBe("atencao"); // Inside Sales ago/26: 90,7%
    expect(farol(7217.3, 6375, "maior")).toBe("bom");
    expect(farol(543, 1875, "maior")).toBe("ruim");
  });
  it("menor-é-melhor: o 230% do OS é vermelho", () => {
    // % Customer Churn (Ativação) ago/26: realizado 2,3 contra orçado 1.
    expect(farol(2.3, 1, "menor")).toBe("ruim");
    expect(farol(3.11, 3, "menor")).toBe("atencao");
    expect(farol(0.8, 1, "menor")).toBe("bom");
  });
  it("neutro não ganha cor", () => {
    expect(farol(5000, 1000, "neutro")).toBe("neutro");
  });
});

describe("formatação", () => {
  it("por unidade", () => {
    expect(fmtValorStr(1348521.34, "BRL")).toBe("R$ 1.348.521");
    expect(fmtValorStr(375.5, "BRL")).toBe("R$ 375,50");
    expect(fmtValorStr(2.3, "percent")).toBe("2,30%");
    expect(fmtValorStr(90, "percent")).toBe("90%");
    expect(fmtValorStr(217, "count")).toBe("217");
    expect(fmtValorStr(3.5, "count")).toBe("3,50");
    expect(fmtValorStr(null, "BRL")).toBe("—");
  });
  it("curta", () => {
    expect(fmtValorCurtoStr(1348521.34, "BRL")).toBe("R$ 1,35 M");
    expect(fmtValorCurtoStr(95264.06, "BRL")).toBe("R$ 95 k");
    expect(fmtValorCurtoStr(9357.33, "BRL")).toBe("R$ 9.357");
  });
});

describe("mesPadrao", () => {
  it("abre no último mês fechado, não no corrente", () => {
    const comps = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-12-01"];
    expect(mesPadrao(comps, new Date(2026, 8, 18))).toBe("2026-08-01");
  });
  it("sem mês fechado, cai no mais recente", () => {
    expect(mesPadrao(["2026-09-01"], new Date(2026, 8, 18))).toBe("2026-09-01");
    expect(mesPadrao([], new Date(2026, 8, 18))).toBeNull();
  });
});

describe("montarPainel", () => {
  const inds = [
    ind({ id: "c1", canal: "Consolidado", indicador: "Novo MRR Total", ordem: 1 }),
    ind({ id: "a1", canal: "Inside Sales", indicador: "Novo MRR", ordem: 2 }),
    ind({ id: "a2", canal: "Inside Sales", indicador: "Leads", unidade: "count", ordem: 3 }),
    ind({ id: "x1", canal: "Inside Sales", indicador: "Velho", ativo: false, ordem: 4 }),
    ind({ id: "o1", departamento: "Operação", canal: "Sucesso", indicador: "Upsell", ordem: 5 }),
  ];
  const linhas: LinhaMensalOS[] = [
    { indicator_id: "a1", ano: 2026, mes: 8, competencia: "2026-08-01", orcado: 105000, realizado: 95264.06 },
    { indicator_id: "a1", ano: 2026, mes: 7, competencia: "2026-07-01", orcado: 100000, realizado: 108799.9 },
    { indicator_id: "c1", ano: 2026, mes: 8, competencia: "2026-08-01", orcado: 154040.5, realizado: null },
  ];

  it("filtra o departamento, tira inativo e põe o Consolidado por último", () => {
    const blocos = montarPainel(inds, linhas, "Aquisição", "2026-08-01", "2026-07-01");
    expect(blocos.map((b) => b.canal)).toEqual(["Inside Sales", "Consolidado"]);
    expect(blocos[0].itens.map((i) => i.ind.id)).toEqual(["a1", "a2"]);
    const a1 = blocos[0].itens[0];
    expect(a1.anterior).toBe(108799.9);
    expect(a1.farol).toBe("atencao");
    expect(Math.round(a1.pct!)).toBe(91);
  });

  it("linha de total anual (mes 13, competência nula) não derruba o painel", () => {
    const anual = { indicator_id: "a1", ano: 2026, mes: 13, competencia: null as unknown as string, orcado: 1, realizado: null };
    expect(() => montarPainel(inds, [...linhas, anual], "Aquisição", "2026-08-01", null)).not.toThrow();
  });

  it("consolidado sem realizado aparece como sem dado, não some", () => {
    // Ago/26 real: o Novo MRR Total veio null porque um canal (Comunidade) estava null.
    const blocos = montarPainel(inds, linhas, "Aquisição", "2026-08-01", null);
    const c1 = blocos.find((b) => b.canal === "Consolidado")!.itens[0];
    expect(c1.farol).toBe("sem_dado");
    expect(c1.orcado).toBe(154040.5);
    const r = resumoFarois(blocos);
    expect(r.sem_dado).toBe(2);
    expect(r.atencao).toBe(1);
  });
});
