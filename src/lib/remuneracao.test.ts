import { describe, it, expect } from "vitest";
import {
  degrausDoFixo, resumoDaPessoa, filtrarPessoas, totaisDoMes, paraCsv, matrizParaPlanilha,
  rotuloMes, distanciaEmMeses, ultimaCompetenciaFechada,
  type MesRemuneracao, type PessoaRemuneracao,
} from "./remuneracao";

const mes = (competencia: string, fixo: number, premiacao = 0): MesRemuneracao => ({
  competencia, fixo, premiacao, escala: 0, outro: 0,
  total: fixo + premiacao, fontes: "omie",
});

const pessoa = (over: Partial<PessoaRemuneracao> = {}): PessoaRemuneracao => ({
  id: "p1", nome: "Fulano de Tal", codigo_rh: "COL-1", doc: "12345678000199",
  eh_pessoa: true, cargo: "Vendedor", setor: "Inside Sales", modalidade: "PJ",
  inicio: "2025-03-01", datadesl: null, valor_contrato: 6000,
  meses: [], ...over,
});

describe("rótulo e distância de mês", () => {
  it("traduz a competência ISO", () => {
    expect(rotuloMes("2026-03-01")).toBe("mar/26");
    expect(rotuloMes("2026-12-01")).toBe("dez/26");
  });

  it("devolve o que veio quando não é competência", () => {
    expect(rotuloMes("")).toBe("—");
    expect(rotuloMes("qualquer coisa")).toBe("qualquer coisa");
  });

  it("conta meses atravessando o ano", () => {
    expect(distanciaEmMeses("2025-11-01", "2026-02-01")).toBe(3);
    expect(distanciaEmMeses("2026-07-01", "2026-07-01")).toBe(0);
    expect(distanciaEmMeses("torto", "2026-07-01")).toBeNull();
  });
});

describe("degraus do fixo", () => {
  it("acha o reajuste e calcula a variação", () => {
    const d = degrausDoFixo([
      mes("2026-03-01", 20000), mes("2026-04-01", 20000),
      mes("2026-05-01", 20000), mes("2026-06-01", 20000),
      mes("2026-07-01", 22500), mes("2026-08-01", 22500),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].competencia).toBe("2026-07-01");
    expect(d[0].de).toBe(20000);
    expect(d[0].para).toBe(22500);
    expect(d[0].variacao).toBeCloseTo(0.125, 4);
  });

  it("acha dois reajustes na mesma série", () => {
    const d = degrausDoFixo([
      mes("2026-03-01", 6000), mes("2026-04-01", 6000),
      mes("2026-05-01", 12382.98), mes("2026-06-01", 12382.98),
      mes("2026-07-01", 14382.98), mes("2026-08-01", 14382.98),
    ]);
    expect(d.map((x) => x.competencia)).toEqual(["2026-05-01", "2026-07-01"]);
  });

  /* Mês de entrada é proporcional aos dias trabalhados. Sem esta regra, quem
     entrou dia 20 apareceria com "aumento de 200%" no mês seguinte. */
  it("não conta o mês de entrada proporcional como reajuste", () => {
    const d = degrausDoFixo([
      mes("2026-03-01", 2000), mes("2026-04-01", 6000), mes("2026-05-01", 6000),
    ]);
    expect(d).toHaveLength(0);
  });

  it("não conta o mês de saída proporcional como corte", () => {
    const d = degrausDoFixo([
      mes("2026-03-01", 6000), mes("2026-04-01", 6000), mes("2026-05-01", 1800),
    ]);
    expect(d).toHaveLength(0);
  });

  /* Uma queda no MEIO da série é real — redução de escopo, troca de contrato —
     e alguém precisa ver. */
  it("mantém a queda que acontece no meio", () => {
    const d = degrausDoFixo([
      mes("2026-03-01", 6000), mes("2026-04-01", 4000),
      mes("2026-05-01", 4000), mes("2026-06-01", 4000),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].variacao).toBeCloseTo(-1 / 3, 4);
  });

  /* Quem ficou um mês sem receber e voltou no mesmo valor não teve reajuste. */
  it("compara meses PAGOS, pulando o buraco", () => {
    const d = degrausDoFixo([
      mes("2026-03-01", 6000), mes("2026-04-01", 0), mes("2026-05-01", 6000),
      mes("2026-06-01", 6000),
    ]);
    expect(d).toHaveLength(0);
  });

  it("série curta demais não tem degrau", () => {
    expect(degrausDoFixo([])).toHaveLength(0);
    expect(degrausDoFixo([mes("2026-03-01", 6000)])).toHaveLength(0);
  });
});

describe("resumo da pessoa", () => {
  const p = pessoa({
    valor_contrato: 20000,
    meses: [
      mes("2026-03-01", 20000), mes("2026-04-01", 20000, 3000),
      mes("2026-05-01", 20000), mes("2026-06-01", 20000, 1000),
      mes("2026-07-01", 22500), mes("2026-08-01", 22500),
    ],
  });

  it("lê o fixo do último mês pago", () => {
    expect(resumoDaPessoa(p).fixoAtual).toBe(22500);
    expect(resumoDaPessoa(p).ultimoMes).toBe("2026-08-01");
  });

  it("faz a média da premiação só nos meses em que houve", () => {
    const r = resumoDaPessoa(p);
    expect(r.mesesComPremiacao).toBe(2);
    expect(r.premiacaoMedia).toBe(2000);
  });

  it("conta os meses desde o último reajuste", () => {
    const r = resumoDaPessoa(p);
    expect(r.ultimoReajuste?.competencia).toBe("2026-07-01");
    expect(r.mesesSemReajuste).toBe(1);
  });

  /* O Omie manda. Foi o caso do próprio diretor de receita: contrato de 20.000
     no Portal RH, pagamento de 22.500 desde julho. O painel mostra 22.500 e
     acusa que a ficha do RH é que está atrasada. */
  it("mostra o pago pelo Omie e acusa a ficha do RH atrasada", () => {
    expect(resumoDaPessoa(p).fixoAtual).toBe(22500);
    expect(resumoDaPessoa(p).divergenciaContrato).toBe(2500);
  });

  it("não inventa divergência quando não há contrato", () => {
    const semContrato = pessoa({ valor_contrato: null, meses: [mes("2026-03-01", 5000)] });
    expect(resumoDaPessoa(semContrato).divergenciaContrato).toBeNull();
  });

  it("ordena os meses antes de ler, mesmo se vierem embaralhados", () => {
    const bagunca = pessoa({
      meses: [mes("2026-08-01", 9000), mes("2026-03-01", 6000), mes("2026-05-01", 6000)],
    });
    expect(resumoDaPessoa(bagunca).ultimoMes).toBe("2026-08-01");
    expect(resumoDaPessoa(bagunca).fixoAtual).toBe(9000);
  });

  it("aguenta pessoa sem mês nenhum", () => {
    const r = resumoDaPessoa(pessoa({ meses: [] }));
    expect(r.fixoAtual).toBeNull();
    expect(r.mesesSemReajuste).toBeNull();
    expect(r.totalPeriodo).toBe(0);
  });
});

describe("última competência fechada", () => {
  const meses = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];

  /* O bug de 03/09/2026: 1 lançamento avulso de setembro contra 107 pessoas
     pagas em agosto. Tomando setembro como referência, as 107 sumiam da tela —
     o painel mostrava 30 pessoas, todas sem valor nenhum. */
  it("ignora o mês corrente, que ainda está aberto", () => {
    expect(ultimaCompetenciaFechada(meses, new Date("2026-09-03T12:00:00"))).toBe("2026-08-01");
  });

  it("no mês seguinte, o mês antes fechado vira a referência", () => {
    expect(ultimaCompetenciaFechada(meses, new Date("2026-10-01T12:00:00"))).toBe("2026-09-01");
  });

  it("sem nenhum mês fechado, usa o que há", () => {
    expect(ultimaCompetenciaFechada(["2026-09-01"], new Date("2026-09-03T12:00:00"))).toBe("2026-09-01");
  });

  it("sem mês nenhum, devolve nulo", () => {
    expect(ultimaCompetenciaFechada([], new Date("2026-09-03T12:00:00"))).toBeNull();
  });
});

describe("filtro de pessoas", () => {
  const base = { busca: "", incluirSaidas: false, incluirNaoPessoas: false, soComFichaRh: false, setor: null };
  const ativo = pessoa({ id: "a", nome: "Ana Ativa", meses: [mes("2026-08-01", 5000)] });
  const saiu = pessoa({
    id: "b", nome: "Bruno Saiu", codigo_rh: null,
    meses: [mes("2026-04-01", 5000)],
  });
  const desligado = pessoa({ id: "c", nome: "Carla Desligada", datadesl: "2026-06-30", meses: [mes("2026-08-01", 5000)] });
  const empresa = pessoa({ id: "d", nome: "Ecoesfera Inova Simples", eh_pessoa: false, meses: [mes("2026-08-01", 4800)] });
  const todas = [ativo, saiu, desligado, empresa];

  it("por padrão mostra só quem está ativo e é gente", () => {
    const r = filtrarPessoas(todas, base, "2026-08-01");
    expect(r.map((p) => p.id)).toEqual(["a"]);
  });

  /* Quem parou de receber antes do último mês saiu — mesmo sem o Portal RH ter
     registrado. São as 50 pessoas que sumiram do espelho ao sair. */
  it("trata quem parou de receber como saída, mesmo sem data de desligamento", () => {
    expect(filtrarPessoas([saiu], base, "2026-08-01")).toHaveLength(0);
    expect(filtrarPessoas([saiu], { ...base, incluirSaidas: true }, "2026-08-01")).toHaveLength(1);
  });

  it("inclui desligados e empresas quando pedido", () => {
    const r = filtrarPessoas(todas, { ...base, incluirSaidas: true, incluirNaoPessoas: true }, "2026-08-01");
    expect(r).toHaveLength(4);
  });

  it("exige ficha no RH quando pedido", () => {
    const r = filtrarPessoas(todas, { ...base, incluirSaidas: true, soComFichaRh: true }, "2026-08-01");
    expect(r.map((p) => p.id)).not.toContain("b");
  });

  it("busca por nome, cargo, setor e código", () => {
    const f = (busca: string) => filtrarPessoas(todas, { ...base, busca, incluirSaidas: true }, "2026-08-01");
    expect(f("ana").map((p) => p.id)).toEqual(["a"]);
    expect(f("inside sales").length).toBe(3);
    // A empresa fica de fora mesmo casando o código: `incluirNaoPessoas` é false.
    expect(f("COL-1").map((p) => p.id)).toEqual(["a", "c"]);
    expect(f("ninguém")).toHaveLength(0);
  });

  /* A regressão que esvaziou a tela: quem recebeu no último mês FECHADO está
     ativo. Só some quem parou antes disso. */
  it("mantém quem recebeu no mês de referência", () => {
    const pagoEmAgosto = pessoa({ id: "x", meses: [mes("2026-07-01", 5000), mes("2026-08-01", 5000)] });
    const parouEmJunho = pessoa({ id: "y", meses: [mes("2026-06-01", 5000)] });
    const r = filtrarPessoas([pagoEmAgosto, parouEmJunho], base, "2026-08-01");
    expect(r.map((p) => p.id)).toEqual(["x"]);
  });

  /* O contratado que começa semana que vem já está no Portal RH e ainda não tem
     lançamento nenhum — tem de aparecer, não ser lido como saída. */
  it("mantém quem ainda não recebeu nada", () => {
    const novato = pessoa({ id: "z", nome: "Joel Recém-Chegado", meses: [] });
    expect(filtrarPessoas([novato], base, "2026-08-01").map((p) => p.id)).toEqual(["z"]);
  });

  it("filtra por setor", () => {
    const outro = pessoa({ id: "e", setor: "Tecnologia", meses: [mes("2026-08-01", 9000)] });
    const r = filtrarPessoas([ativo, outro], { ...base, setor: "Tecnologia" }, "2026-08-01");
    expect(r.map((p) => p.id)).toEqual(["e"]);
  });
});

describe("totais do mês", () => {
  it("soma só quem tem o mês", () => {
    const t = totaisDoMes(
      [
        pessoa({ id: "a", meses: [mes("2026-07-01", 6000, 1000)] }),
        pessoa({ id: "b", meses: [mes("2026-07-01", 4000)] }),
        pessoa({ id: "c", meses: [mes("2026-06-01", 9999)] }),
      ],
      "2026-07-01",
    );
    expect(t.gente).toBe(2);
    expect(t.fixo).toBe(10000);
    expect(t.premiacao).toBe(1000);
    expect(t.total).toBe(11000);
  });
});

describe("planilha", () => {
  const meses = ["2026-07-01", "2026-08-01"];
  const p = pessoa({
    nome: 'Empresa "X"; Ltda',
    meses: [mes("2026-07-01", 6000, 500), mes("2026-08-01", 7000)],
  });

  it("abre com BOM, para o Excel não estragar o acento", () => {
    expect(paraCsv([p], meses).startsWith("﻿")).toBe(true);
  });

  it("escapa aspas e o separador dentro do nome", () => {
    const linha = paraCsv([p], meses).split("\n")[1];
    expect(linha.startsWith('"Empresa ""X""; Ltda"')).toBe(true);
  });

  it("põe três colunas por mês, com ponto decimal", () => {
    const [cab, linha] = paraCsv([p], meses).split("\n");
    expect(cab).toContain("jul/26 fixo");
    expect(cab).toContain("ago/26 total");
    expect(linha).toContain("6000.00");
    expect(linha).toContain("500.00");
    // Sem símbolo de moeda em lugar nenhum — senão não vira número.
    expect(linha).not.toContain("R$");
  });

  it("deixa a célula vazia quando o mês não existe para a pessoa", () => {
    const so1 = pessoa({ nome: "Só Julho", meses: [mes("2026-07-01", 6000)] });
    const linha = paraCsv([so1], meses).split("\n")[1];
    expect(linha.endsWith(";;;")).toBe(true);
  });

  /* No .xlsx o valor tem de chegar como número, senão quem receber o arquivo
     não consegue somar nem ordenar a coluna. */
  it("a matriz entrega número, não texto formatado", () => {
    const [cab, linha] = matrizParaPlanilha([p], meses);
    expect(cab[0]).toBe("Nome");
    const iFixoJul = cab.indexOf("jul/26 fixo");
    expect(linha[iFixoJul]).toBe(6000);
    expect(typeof linha[iFixoJul]).toBe("number");
  });

  /* Mês em que a pessoa não estava na empresa é `null`, não zero: zero entra
     numa média e puxa o número para baixo como se ela tivesse ganhado nada. */
  it("mês sem pagamento é nulo, não zero", () => {
    const so1 = pessoa({ nome: "Só Julho", meses: [mes("2026-07-01", 6000)] });
    const [cab, linha] = matrizParaPlanilha([so1], meses);
    expect(linha[cab.indexOf("ago/26 fixo")]).toBeNull();
  });
});
