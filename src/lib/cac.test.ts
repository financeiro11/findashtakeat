import { describe, expect, it } from "vitest";
import {
  montarMatriz, agruparMatriz, totalGeral, agruparPorPessoa,
  resumirCelula, matrizParaAOA, conferir, parseValorBR, parsePainelAOA,
  planoDeImportacao, seloDaLinha, linhaTemRegra, conflitosDeRegra,
  colunaDoMes, mesAnteriorDe, lancamentosParaPonte, conferenciaDoMes,
  type PainelRow, type Lancamento, type Linha, type ConferenciaDre,
} from "./cac";
import { montarPonte } from "./ponteVariacao";
import { mesCurto } from "./demonstracoes-schema";

const linha = (over: Partial<PainelRow>): PainelRow => ({
  linha_id: "a", grupo: "Equipes", rotulo: "Inside Sales", ordem: 80,
  regra_nota: null, mes: 1, valor: 0, origem: "omie", ...over,
});

const regra = (over: Partial<Linha>): Linha => ({
  id: "x", grupo: "Equipes", rotulo: "Linha", ordem: 1,
  departamentos: [], categorias: [], categorias_inteiras: [], categorias_sem_cadastro: [],
  manual: false, regra_nota: null, ativo: true, ...over,
});

/* -------------------------------------------------------------------------
 * Selo e conflito de regra
 * ----------------------------------------------------------------------- */

describe("seloDaLinha", () => {
  it("linha manual é manual, não 'sem regra'", () => {
    // Agência, Contadores e Comissão de MGM não têm regra de propósito — a
    // skill manda digitar. Pintá-las de vermelho acusaria defeito que não há.
    expect(seloDaLinha(null, false, 0, true)).toBe("manual");
  });

  it("sem regra vem antes de zero, e CONFERIR antes dos dois", () => {
    expect(seloDaLinha(null, false, 0)).toBe("semregra");
    expect(seloDaLinha("CONFERIR: x", true, 0)).toBe("conferir");
    expect(seloDaLinha(null, true, 0)).toBe("zero");
    expect(seloDaLinha(null, true, 10)).toBe("ok");
  });
});

describe("linhaTemRegra", () => {
  it("uma lista de categoria inteira ou sem cadastro já é regra", () => {
    expect(linhaTemRegra(regra({}))).toBe(false);
    expect(linhaTemRegra(regra({ categorias_inteiras: ["2.01.98"] }))).toBe(true);
    expect(linhaTemRegra(regra({ categorias_sem_cadastro: ["2.03.11"] }))).toBe(true);
  });
});

describe("conflitosDeRegra", () => {
  const FOLHA = ["2.03.11", "2.01.98"];

  it("a regra da skill não tem conflito", () => {
    const ls = [
      regra({ rotulo: "Field Sales", departamentos: ["Field Sales"], categorias: ["2.03.11"], categorias_sem_cadastro: ["2.03.11"] }),
      regra({ rotulo: "Inside Sales", departamentos: ["Inside Sales"], categorias: ["2.03.11"] }),
      regra({ rotulo: "Suporte", departamentos: ["Suporte"], categorias: ["2.03.11"], categorias_inteiras: ["2.01.98"] }),
      regra({ grupo: "Investimentos", rotulo: "Eventos", categorias: ["2.02.94"] }),
    ];
    expect(conflitosDeRegra(ls)).toEqual([]);
  });

  it("acusa a categoria inteira que ficou na folha de outra linha", () => {
    // Foi o que a migration precisou evitar: 3.2.7.2 inteira em Suporte e ainda
    // na lista de Onboarding contaria o salário duas vezes.
    const ls = [
      regra({ rotulo: "Onboarding", departamentos: ["Onboarding e Setup"], categorias: FOLHA }),
      regra({ rotulo: "Suporte", departamentos: ["Suporte"], categorias_inteiras: ["2.01.98"] }),
    ];
    const [c] = conflitosDeRegra(ls);
    expect(c.categoria).toBe("2.01.98");
    expect(c.linhas).toEqual(["Equipes › Onboarding", "Equipes › Suporte"]);
  });

  it("acusa o mesmo fallback em duas linhas", () => {
    const ls = [
      regra({ rotulo: "A", categorias_sem_cadastro: ["2.03.11"] }),
      regra({ rotulo: "B", categorias_sem_cadastro: ["2.03.11"] }),
    ];
    expect(conflitosDeRegra(ls)).toHaveLength(1);
  });

  it("acusa o mesmo departamento em duas linhas com categoria em comum", () => {
    const ls = [
      regra({ rotulo: "Franquia", departamentos: ["Franquia", "Franquias"], categorias: ["2.03.11"] }),
      regra({ rotulo: "Outra", departamentos: ["Franquias"], categorias: ["2.03.11"] }),
    ];
    expect(conflitosDeRegra(ls)[0].motivo).toContain("Franquias");
  });

  it("ignora linha manual e linha inativa", () => {
    const ls = [
      regra({ rotulo: "A", categorias: ["2.02.02"] }),
      regra({ rotulo: "B", categorias: ["2.02.02"], manual: true }),
      regra({ rotulo: "C", categorias: ["2.02.02"], ativo: false }),
    ];
    expect(conflitosDeRegra(ls)).toEqual([]);
  });
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

describe("a ponte da célula", () => {
  it("a chave do mês é a que a DRE entende, e janeiro olha dezembro", () => {
    expect(colunaDoMes(2026, 8)).toBe("Aug-26");
    expect(mesCurto(colunaDoMes(2026, 8))).not.toBe("Aug-26");
    expect(mesAnteriorDe(2026, 1)).toEqual({ ano: 2025, mes: 12 });
    expect(mesAnteriorDe(2026, 8)).toEqual({ ano: 2026, mes: 7 });
  });

  it("quem saiu e quem entrou somam a variação inteira, como custo", () => {
    // Canais Indiretos jul → ago/26: a Ingra sai, a Rita repete, o Lucas entra.
    const jul = [
      lanc({ cod_titulo: 1, cnpj: "1", pessoa: "Rita", valor: 5500 }),
      lanc({ cod_titulo: 2, cnpj: "2", pessoa: "Ingra", valor: 3225 }),
    ];
    const ago = [
      lanc({ cod_titulo: 3, cnpj: "1", pessoa: "Rita", valor: 5500 }),
      lanc({ cod_titulo: 4, cnpj: "3", pessoa: "Lucas", valor: 4500 }),
      lanc({ tipo: "sem_pagamento", cnpj: "9", pessoa: "Ausente", natureza: null, valor: 2000 }),
    ];
    const p = montarPonte(lancamentosParaPonte(ago), lancamentosParaPonte(jul), {
      mes: "Aug-26", mesAnterior: "Jul-26", nomeDe: (l) => l.contraparte ?? "",
    });
    expect(p.despesa).toBe(true);
    expect(p.delta).toBeCloseTo(-(10000 - 8725), 2);      // custou R$ 1.275 a mais
    expect(p.totalPiora + p.totalMelhora).toBeCloseTo(p.delta, 2);
    expect(p.piora.map((x) => [x.nome, x.movimento])).toEqual([["Lucas", "entrou"]]);
    expect(p.melhora.map((x) => [x.nome, x.movimento])).toEqual([["Ingra", "saiu"]]);
    expect(p.iguais.map((x) => x.nome)).toEqual(["Rita"]);
  });
});

describe("conferenciaDoMes", () => {
  const conf = (over: Partial<ConferenciaDre>): ConferenciaDre => ({
    rubrica: "Eventos e Feiras", mes: 8, dre: 0, omie: 0, no_cac: 0, fora_do_cac: 0,
    valor_manual_na_dre: false, mes_travado: false, ...over,
  });

  it("agosto/26 de Eventos: a DRE e a base batem, e o CAC pega tudo", () => {
    const r = conferenciaDoMes([
      conf({ rubrica: "Eventos e Feiras", dre: 85879.02, omie: 85879.02, no_cac: 85879.02 }),
      conf({ rubrica: "Viagens & Transportes Mkt", dre: 40642.54, omie: 40642.54, no_cac: 40642.54 }),
      conf({ rubrica: "Equipe Tecnologia", mes: 7, dre: 1, omie: 1 }),
    ], 8);
    expect(r.linhas.map((l) => l.rubrica)).toEqual(["Eventos e Feiras", "Viagens & Transportes Mkt"]);
    expect(r.noCac).toBeCloseTo(126521.56, 2);
    expect(r.linhas.every((l) => !l.inexplicada)).toBe(true);
  });

  it("diferença só é alerta quando nem valor digitado nem mês travado a explicam", () => {
    const r = conferenciaDoMes([
      conf({ rubrica: "MGM", dre: 4700, omie: 1300, valor_manual_na_dre: true }),
      conf({ rubrica: "Premiações", dre: 76649, omie: 76294.4, mes_travado: true }),
      conf({ rubrica: "Equipe Comercial", dre: 144969, omie: 140000 }),
    ], 8);
    expect(r.linhas.filter((l) => l.inexplicada).map((l) => l.rubrica)).toEqual(["Equipe Comercial"]);
  });

  it("some a rubrica que não tem nada no mês", () => {
    expect(conferenciaDoMes([conf({ dre: null, omie: 0 })], 8).linhas).toEqual([]);
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
    regra({ id: "eq-ev", grupo: "Equipes", rotulo: "Eventos", ordem: 60, departamentos: ["Eventos"] }),
    regra({ id: "in-ev", grupo: "Investimentos", rotulo: "Eventos", ordem: 200, categorias: ["2.02.94"] }),
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
