import { describe, expect, it } from "vitest";
import {
  montarMatriz, agruparMatriz, totalGeral, agruparPorPessoa,
  resumirCelula, matrizParaAOA, conferir, parseValorBR, parsePainelAOA,
  planoDeImportacao,
  type PainelRow, type Lancamento, type Linha,
} from "./cac";

const linha = (over: Partial<PainelRow>): PainelRow => ({
  linha_id: "a", grupo: "Equipes", rotulo: "Inside Sales", ordem: 80,
  regra_nota: null, mes: 1, valor: 0, origem: "omie", ...over,
});

describe("montarMatriz", () => {
  it("espalha as células nos 12 meses e soma o ano", () => {
    const [m] = montarMatriz([
      linha({ mes: 1, valor: 100 }),
      linha({ mes: 7, valor: 250 }),
    ]);
    expect(m.meses[0]).toBe(100);
    expect(m.meses[6]).toBe(250);
    expect(m.meses[1]).toBe(0);
    expect(m.total).toBe(350);
  });

  it("guarda a origem de cada célula separadamente", () => {
    const [m] = montarMatriz([
      linha({ mes: 1, valor: 100, origem: "manual" }),
      linha({ mes: 2, valor: 200, origem: "omie" }),
    ]);
    expect(m.origens[0]).toBe("manual");
    expect(m.origens[1]).toBe("omie");
  });

  it("o total do ano inclui o que foi digitado à mão", () => {
    // Jan–Mar virão do painel antigo; se o total os ignorasse, a coluna
    // Total Ano mentiria para sempre.
    const [m] = montarMatriz([
      linha({ mes: 1, valor: 1000, origem: "manual" }),
      linha({ mes: 4, valor: 500, origem: "omie" }),
    ]);
    expect(m.total).toBe(1500);
  });

  it("ordena as linhas por ordem, não por chegada", () => {
    const ms = montarMatriz([
      linha({ linha_id: "z", rotulo: "Suporte", ordem: 120, mes: 1, valor: 1 }),
      linha({ linha_id: "a", rotulo: "Performance", ordem: 20, mes: 1, valor: 1 }),
    ]);
    expect(ms.map((m) => m.rotulo)).toEqual(["Performance", "Suporte"]);
  });
});

describe("agruparMatriz", () => {
  it("respeita a ordem Equipes → Investimentos → Comissões", () => {
    const gs = agruparMatriz(montarMatriz([
      linha({ linha_id: "c", grupo: "Comissões", rotulo: "Consultores", ordem: 320, mes: 1, valor: 10 }),
      linha({ linha_id: "a", grupo: "Equipes", rotulo: "Inside Sales", ordem: 80, mes: 1, valor: 10 }),
      linha({ linha_id: "b", grupo: "Investimentos", rotulo: "Eventos", ordem: 200, mes: 1, valor: 10 }),
    ]));
    expect(gs.map((g) => g.grupo)).toEqual(["Equipes", "Investimentos", "Comissões"]);
  });

  it("um grupo desconhecido vai para o fim em vez de sumir", () => {
    const gs = agruparMatriz(montarMatriz([
      linha({ linha_id: "a", grupo: "Equipes", ordem: 80, mes: 1, valor: 10 }),
      linha({ linha_id: "x", grupo: "Grupo Novo", rotulo: "Coisa", ordem: 999, mes: 1, valor: 5 }),
    ]));
    expect(gs.map((g) => g.grupo)).toEqual(["Equipes", "Grupo Novo"]);
  });

  it("subtotaliza o grupo mês a mês", () => {
    const [g] = agruparMatriz(montarMatriz([
      linha({ linha_id: "a", rotulo: "Inside", ordem: 80, mes: 3, valor: 100 }),
      linha({ linha_id: "b", rotulo: "Field", ordem: 90, mes: 3, valor: 50 }),
    ]));
    expect(g.meses[2]).toBe(150);
    expect(g.total).toBe(150);
  });
});

describe("totalGeral", () => {
  it("soma todos os grupos", () => {
    const gs = agruparMatriz(montarMatriz([
      linha({ linha_id: "a", grupo: "Equipes", ordem: 80, mes: 1, valor: 100 }),
      linha({ linha_id: "b", grupo: "Comissões", rotulo: "Consultores", ordem: 320, mes: 1, valor: 25 }),
    ]));
    expect(totalGeral(gs).meses[0]).toBe(125);
    expect(totalGeral(gs).total).toBe(125);
  });
});

/* -------------------------------------------------------------------------
 * Drill-down
 * ----------------------------------------------------------------------- */

const lanc = (over: Partial<Lancamento>): Lancamento => ({
  tipo: "lancamento", cod_titulo: 1, data_pagamento: "2026-07-05",
  cnpj: "11111111111111", pessoa: "Fulano", favorecido: "FULANO LTDA",
  departamento: "Inside Sales", categoria: "2.03.11",
  categoria_descricao: "3.1.1.2. Pessoal - Comercial", natureza: "folha",
  valor: 3000, ...over,
});

describe("agruparPorPessoa", () => {
  it("junta pela mesma pessoa mesmo com o nome escrito de formas diferentes", () => {
    // O Omie grafa o mesmo CNPJ ora "LUCAS SEGATTO SOARES 18591953770",
    // ora "48.938.085 ISRAEL CARRE LEITAO", ora limpo. Só o CNPJ agrupa.
    const ps = agruparPorPessoa([
      lanc({ cod_titulo: 1, favorecido: "LUCAS SEGATTO SOARES 18591953770", valor: 7000 }),
      lanc({ cod_titulo: 2, favorecido: "Lucas Segatto Soares", valor: 4417.5, natureza: "comissão" }),
    ]);
    expect(ps).toHaveLength(1);
    expect(ps[0].folha).toBe(7000);
    expect(ps[0].comissao).toBe(4417.5);
    expect(ps[0].total).toBe(11417.5);
  });

  it("separa CNPJs diferentes e ordena pelo maior total", () => {
    const ps = agruparPorPessoa([
      lanc({ cnpj: "1", pessoa: "A", valor: 100 }),
      lanc({ cnpj: "2", pessoa: "B", valor: 900 }),
    ]);
    expect(ps.map((p) => p.pessoa)).toEqual(["B", "A"]);
  });

  it("ignora as linhas de quem não foi pago", () => {
    const ps = agruparPorPessoa([
      lanc({ valor: 100 }),
      lanc({ tipo: "sem_pagamento", cnpj: "9", pessoa: "Ausente", natureza: null, valor: 2500 }),
    ]);
    expect(ps).toHaveLength(1);
    expect(ps[0].total).toBe(100);
  });
});

describe("resumirCelula", () => {
  it("separa folha de comissão", () => {
    const r = resumirCelula([
      lanc({ valor: 27000, natureza: "folha" }),
      lanc({ valor: 39612.5, natureza: "comissão" }),
    ]);
    expect(r.folha).toBe(27000);
    expect(r.comissao).toBe(39612.5);
    expect(r.total).toBe(66612.5);
  });

  it("lista quem não recebeu e quanto era esperado", () => {
    // Foi exatamente isto que explicou os R$ 5.000 que faltavam em Inside
    // Sales em Jul/26 — duas pessoas sem pagamento na janela.
    const r = resumirCelula([
      lanc({ valor: 3000 }),
      lanc({ tipo: "sem_pagamento", cnpj: "8", pessoa: "Vitor", natureza: null, valor: 2500 }),
      lanc({ tipo: "sem_pagamento", cnpj: "9", pessoa: "Rodrigo", natureza: null, valor: 2500 }),
    ]);
    expect(r.total).toBe(3000);
    expect(r.semPagamento).toHaveLength(2);
    expect(r.semPagamentoEsperado).toBe(5000);
  });

  it("natureza nula conta como folha, não some da soma", () => {
    const r = resumirCelula([lanc({ natureza: null, valor: 800 })]);
    expect(r.folha).toBe(800);
    expect(r.total).toBe(800);
  });
});

/* -------------------------------------------------------------------------
 * Exportação
 * ----------------------------------------------------------------------- */

describe("matrizParaAOA", () => {
  const gs = agruparMatriz(montarMatriz([
    linha({ linha_id: "a", grupo: "Equipes", rotulo: "Inside Sales", ordem: 80, mes: 7, valor: 71651 }),
  ]));

  it("põe cabeçalho, grupo, detalhe e total geral", () => {
    const aoa = matrizParaAOA(gs, 2026);
    expect(aoa[0][0]).toBe("Painel CAC 2026");
    expect(aoa[2]).toEqual(["Categoria", "Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez", "Total Ano"]);
    expect(aoa[3][0]).toBe("Equipes");
    expect(aoa[4][0]).toBe("Inside Sales");
    expect(aoa[aoa.length - 1][0]).toBe("Total Geral");
  });

  it("exporta NÚMERO, não texto formatado", () => {
    // O destino é o import de outro sistema: "R$ 71.651,00" chegaria como
    // texto e não somaria do lado de lá.
    const aoa = matrizParaAOA(gs, 2026);
    const detalhe = aoa[4];
    expect(detalhe[7]).toBe(71651);
    expect(typeof detalhe[7]).toBe("number");
    expect(detalhe[13]).toBe(71651);   // 0 = rótulo, 1..12 = meses, 13 = Total Ano
  });
});

/* -------------------------------------------------------------------------
 * Conferência
 * ----------------------------------------------------------------------- */

describe("conferir", () => {
  const gs = agruparMatriz(montarMatriz([
    linha({ linha_id: "a", grupo: "Equipes", rotulo: "Inside Sales", ordem: 80, mes: 7, valor: 71612.5 }),
  ]));

  it("não acusa diferença de centavos", () => {
    const digitados = new Map([["Equipes|Inside Sales", [0,0,0,0,0,0, 71612.9, 0,0,0,0,0]]]);
    expect(conferir(gs, digitados)).toEqual([]);
  });

  it("acusa a diferença real e mede o desvio", () => {
    const digitados = new Map([["Equipes|Inside Sales", [0,0,0,0,0,0, 71651, 0,0,0,0,0]]]);
    const [d] = conferir(gs, digitados);
    expect(d.mes).toBe(7);
    expect(d.delta).toBeCloseTo(-38.5, 2);
    expect(d.desvio).toBeLessThan(0.001);
  });

  it("ignora a linha que não tem valor digitado para comparar", () => {
    expect(conferir(gs, new Map())).toEqual([]);
  });

  it("mês zerado dos dois lados não é divergência", () => {
    const digitados = new Map([["Equipes|Inside Sales", Array(12).fill(0)]]);
    const ds = conferir(gs, digitados);
    // Só julho diverge (71612,5 contra 0); os outros 11 meses ficam de fora.
    expect(ds).toHaveLength(1);
    expect(ds[0].mes).toBe(7);
  });
});

/* -------------------------------------------------------------------------
 * Importação do painel antigo
 * ----------------------------------------------------------------------- */

describe("parseValorBR", () => {
  it("lê o formato brasileiro sem trocar milhar por decimal", () => {
    // Se o ponto virasse decimal, R$ 286.355,44 daria 286,35544 — um número
    // plausível o bastante para o erro passar batido.
    expect(parseValorBR("R$ 286.355,44")).toBe(286355.44);
    expect(parseValorBR("1.234,56")).toBe(1234.56);
    expect(parseValorBR("R$ 0,00")).toBe(0);
  });

  it("vazio, travessão e hífen viram zero", () => {
    expect(parseValorBR("-")).toBe(0);
    expect(parseValorBR("—")).toBe(0);
    expect(parseValorBR("")).toBe(0);
    expect(parseValorBR(null)).toBe(0);
  });

  it("número já numérico passa direto", () => {
    expect(parseValorBR(71651)).toBe(71651);
  });
});

describe("parsePainelAOA", () => {
  const planilha: unknown[][] = [
    ["Painel CAC 2026"],
    [],
    ["Categoria","Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez","Total Ano"],
    ["Equipes","R$ 286.355,44","-","-","-","-","-","-","-","-","-","-","-","R$ 286.355,44"],
    ["Eventos","R$ 7.800,00","-","-","-","-","-","-","-","-","-","-","-","R$ 7.800,00"],
    ["Inside Sales","R$ 43.993,94","-","-","-","-","-","-","-","-","-","-","-","R$ 43.993,94"],
    ["Investimentos","R$ 62.910,43","-","-","-","-","-","-","-","-","-","-","-","R$ 62.910,43"],
    ["Eventos","R$ 57.910,43","-","-","-","-","-","-","-","-","-","-","-","R$ 57.910,43"],
    ["Total Geral","R$ 363.462,92","-","-","-","-","-","-","-","-","-","-","-",""],
  ];

  it("separa os dois Eventos pelo grupo em que cada um está", () => {
    // "Eventos" é o TIME em Equipes e a verba de feira em Investimentos.
    // Casar só pelo rótulo faria um sobrescrever o outro sem erro nenhum.
    const lidas = parsePainelAOA(planilha);
    const eventos = lidas.filter((l) => l.rotulo === "Eventos");
    expect(eventos).toHaveLength(2);
    expect(eventos.find((e) => e.grupo === "Equipes")?.meses[0]).toBe(7800);
    expect(eventos.find((e) => e.grupo === "Investimentos")?.meses[0]).toBe(57910.43);
  });

  it("descarta título, cabeçalho, linhas de grupo e o total geral", () => {
    const rotulos = parsePainelAOA(planilha).map((l) => l.rotulo);
    expect(rotulos).toEqual(["Eventos", "Inside Sales", "Eventos"]);
  });

  it("ignora a coluna de Total Ano, que é derivada", () => {
    const [primeira] = parsePainelAOA(planilha);
    expect(primeira.meses).toHaveLength(12);
    expect(primeira.meses[0]).toBe(7800);
    expect(primeira.meses.slice(1).every((v) => v === 0)).toBe(true);
  });

  it("pula linha inteiramente zerada", () => {
    const lidas = parsePainelAOA([
      ["Categoria","Jan"],
      ["Equipes"],
      ["MGM","-","-","-","-","-","-","-","-","-","-","-","-"],
    ]);
    expect(lidas).toEqual([]);
  });
});

describe("planoDeImportacao", () => {
  const linhas: Linha[] = [
    { id: "eq-ev", grupo: "Equipes", rotulo: "Eventos", ordem: 60, departamentos: ["Eventos"], categorias: [], regra_nota: null, ativo: true },
    { id: "in-ev", grupo: "Investimentos", rotulo: "Eventos", ordem: 200, departamentos: [], categorias: ["2.02.94"], regra_nota: null, ativo: true },
  ];

  const importadas = [
    { grupo: "Equipes", rotulo: "Eventos", meses: [7800, 7800, 9742.96, ...Array(9).fill(0)] },
    { grupo: "Investimentos", rotulo: "Eventos", meses: [57910.43, 0, 0, ...Array(9).fill(0)] },
    { grupo: "Comissões", rotulo: "Linha Que Não Existe", meses: [100, ...Array(11).fill(0)] },
  ];

  it("manda cada Eventos para a sua própria linha", () => {
    const { casadas } = planoDeImportacao(importadas, linhas, [1]);
    expect(casadas.find((c) => c.linha_id === "eq-ev")?.valor).toBe(7800);
    expect(casadas.find((c) => c.linha_id === "in-ev")?.valor).toBe(57910.43);
  });

  it("restringe aos meses escolhidos", () => {
    const { casadas } = planoDeImportacao(importadas, linhas, [1, 2, 3]);
    const doTime = casadas.filter((c) => c.linha_id === "eq-ev");
    expect(doTime.map((c) => c.mes)).toEqual([1, 2, 3]);
    expect(doTime.map((c) => c.valor)).toEqual([7800, 7800, 9742.96]);
  });

  it("relata o que não casou em vez de descartar calado", () => {
    const { semCasar } = planoDeImportacao(importadas, linhas, [1]);
    expect(semCasar).toEqual(["Comissões › Linha Que Não Existe"]);
  });
});
