import { describe, it, expect } from "vitest";
import {
  degrausDoFixo, resumoDaPessoa, filtrarPessoas, totaisDoMes, paraCsv, matrizParaPlanilha,
  rotuloMes, distanciaEmMeses, ultimaCompetenciaFechada, mudancasDeArea, areaAtual,
  fixoDeReferencia, compararComPares, custoPorArea, competenciasFechadas, abasDaPlanilha,
  type MesRemuneracao, type PessoaRemuneracao,
} from "./remuneracao";

const mes = (
  competencia: string, fixo: number, premiacao = 0, area: string | null = "Comercial",
  prolabore = 0,
): MesRemuneracao => ({
  competencia, fixo, prolabore, premiacao, escala: 0, outro: 0,
  total: fixo + prolabore + premiacao, fontes: "omie", area,
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

  /* O fixo do Miguel em jun/26 é R$ 20.101 e não R$ 20.100 por causa de um
     título solto de R$ 1,00 no ERP. Isso não é reajuste. */
  it("centavo de ruído não vira reajuste", () => {
    const d = degrausDoFixo([
      mes("2026-05-01", 20100), mes("2026-06-01", 20101),
      mes("2026-07-01", 22500), mes("2026-08-01", 22500),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].competencia).toBe("2026-07-01");
    expect(d[0].de).toBe(20101);
  });

  it("reajuste pequeno de verdade continua contando", () => {
    const d = degrausDoFixo([
      mes("2026-05-01", 3000), mes("2026-06-01", 3060), mes("2026-07-01", 3060),
    ]);
    expect(d).toHaveLength(1); // +2%
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

describe("trajetória pelos times", () => {
  /* O caso real do Levi Monteiro: Suporte → Onboarding em junho, e de volta
     para Suporte em julho. As duas pernas têm de aparecer. */
  it("acha as trocas de área, inclusive a volta", () => {
    const m = mudancasDeArea([
      mes("2026-04-01", 3000, 0, "Suporte"),
      mes("2026-05-01", 3000, 0, "Suporte"),
      mes("2026-06-01", 3000, 0, "Onboarding"),
      mes("2026-07-01", 3000, 0, "Suporte"),
    ]);
    expect(m).toEqual([
      { competencia: "2026-06-01", de: "Suporte", para: "Onboarding" },
      { competencia: "2026-07-01", de: "Onboarding", para: "Suporte" },
    ]);
  });

  it("quem nunca trocou de time não tem mudança", () => {
    expect(mudancasDeArea([mes("2026-04-01", 3000), mes("2026-05-01", 9000)])).toHaveLength(0);
  });

  /* Pro Labore não tem área. O mês dele não pode virar uma "saída do time"
     seguida de um "retorno" — seriam duas movimentações inventadas. */
  it("pula o mês sem área em vez de inventar ida e volta", () => {
    const m = mudancasDeArea([
      mes("2026-04-01", 3000, 0, "Tecnologia"),
      mes("2026-05-01", 4000, 0, null),
      mes("2026-06-01", 3000, 0, "Tecnologia"),
    ]);
    expect(m).toHaveLength(0);
  });

  it("a área atual é a do último mês pago", () => {
    expect(areaAtual([
      mes("2026-04-01", 3000, 0, "Suporte"),
      mes("2026-06-01", 3000, 0, "Sucesso"),
    ])).toBe("Sucesso");
    expect(areaAtual([])).toBeNull();
    expect(areaAtual([mes("2026-04-01", 3000, 0, null)])).toBeNull();
  });

  it("entra no resumo da pessoa", () => {
    const r = resumoDaPessoa(pessoa({
      meses: [mes("2026-04-01", 3000, 0, "Suporte"), mes("2026-05-01", 3000, 0, "Onboarding")],
    }));
    expect(r.area).toBe("Onboarding");
    expect(r.mudancas).toHaveLength(1);
  });
});

describe("fixo de referência", () => {
  it("é o fixo cheio, não o do último mês", () => {
    // Saída no dia 10: o último mês é proporcional e não pode virar o salário.
    expect(fixoDeReferencia([
      mes("2026-06-01", 6000), mes("2026-07-01", 6000), mes("2026-08-01", 1800),
    ])).toBe(6000);
  });

  it("ignora o mês de entrada proporcional", () => {
    expect(fixoDeReferencia([
      mes("2026-06-01", 1200), mes("2026-07-01", 6000), mes("2026-08-01", 6000),
    ])).toBe(6000);
  });

  it("um reajuste recente vence, porque é o maior", () => {
    expect(fixoDeReferencia([
      mes("2026-06-01", 6000), mes("2026-07-01", 6000), mes("2026-08-01", 7500),
    ])).toBe(7500);
  });

  /* Só os três últimos: um salário de um ano atrás não é o de hoje. */
  it("olha só os três últimos meses pagos", () => {
    expect(fixoDeReferencia([
      mes("2026-03-01", 20000), mes("2026-06-01", 6000),
      mes("2026-07-01", 6000), mes("2026-08-01", 6000),
    ])).toBe(6000);
  });

  it("sem mês pago, não há referência", () => {
    expect(fixoDeReferencia([])).toBeNull();
    expect(fixoDeReferencia([mes("2026-08-01", 0)])).toBeNull();
  });
});

describe("meses com o variável fechado", () => {
  /* Em 04/09/2026 a competência de agosto tinha 4 títulos de variável contra 60
     a 82 dos meses anteriores: a comissão ainda não tinha sido lançada. */
  const meses = ["2026-06-01", "2026-07-01", "2026-08-01"];
  const time = [
    pessoa({ id: "a", meses: [
      mes("2026-06-01", 3000, 5000), mes("2026-07-01", 3000, 6000), mes("2026-08-01", 3000, 0),
    ] }),
    pessoa({ id: "b", meses: [
      mes("2026-06-01", 3000, 4000), mes("2026-07-01", 3000, 5000), mes("2026-08-01", 3000, 0),
    ] }),
  ];

  it("descarta o mês cujo variável ainda não entrou", () => {
    const f = competenciasFechadas(time, meses);
    expect(f.has("2026-06-01")).toBe(true);
    expect(f.has("2026-07-01")).toBe(true);
    expect(f.has("2026-08-01")).toBe(false);
  });

  /* Mês fraco de comissão continua sendo um mês real. O piso é um quarto da
     mediana anterior, não "parecido com os outros". */
  it("mês de comissão fraca continua fechado", () => {
    const fraco = [
      pessoa({ id: "a", meses: [
        mes("2026-06-01", 3000, 8000), mes("2026-07-01", 3000, 8000), mes("2026-08-01", 3000, 3000),
      ] }),
    ];
    expect(competenciasFechadas(fraco, meses).has("2026-08-01")).toBe(true);
  });

  it("o primeiro mês não tem contra o que ser medido e entra", () => {
    expect(competenciasFechadas(time, meses).has("2026-06-01")).toBe(true);
  });
});

describe("comparação com os pares", () => {
  const meses = ["2026-06-01", "2026-07-01"];
  /** Alguém com fixo estável e variável estável nos dois meses fechados. */
  const par = (id: string, cargo: string | null, fixo: number, variavel = 0) =>
    pessoa({ id, cargo, meses: [mes("2026-06-01", fixo, variavel), mes("2026-07-01", fixo, variavel)] });

  it("compara por cargo e devolve mediana e percentil", () => {
    const m = compararComPares([
      par("a", "Analista de Suporte", 2000),
      par("b", "Analista de Suporte", 3000),
      par("c", "Analista de Suporte", 4000),
    ], meses);
    expect(m.get("b")?.mediana).toBe(3000);
    expect(m.get("b")?.quantos).toBe(3);
    expect(m.get("a")?.contraMediana).toBe(-1000);
    expect(m.get("c")?.contraMediana).toBe(1000);
  });

  /* O caso do comercial, que motivou a correção: mesmo fixo para todo mundo, e
     a diferença inteira na comissão. Comparar por fixo diria que os três estão
     na mediana; comparar pela remuneração inteira mostra a distância real. */
  it("compara a remuneração INTEIRA, não só o fixo", () => {
    const m = compararComPares([
      par("luiza", "Vendedor", 3000, 23300),
      par("thayrone", "Vendedor", 3000, 4900),
      par("israel", "Vendedor", 3000, 3800),
    ], meses);
    expect(m.get("luiza")?.percentil).toBe(83);
    expect(m.get("israel")?.percentil).toBe(17);
    expect(m.get("luiza")!.contraMediana).toBeGreaterThan(15000);
  });

  it("diz quanto da remuneração é variável", () => {
    const m = compararComPares([
      par("vendedor", "Vendedor", 3000, 9000),
      par("b", "Vendedor", 3000, 9000),
      par("c", "Vendedor", 3000, 9000),
    ], meses);
    expect(m.get("vendedor")?.parteVariavel).toBeCloseTo(0.75, 2);
  });

  it("não mistura cargos diferentes", () => {
    const m = compararComPares([
      par("a", "Analista", 3000), par("b", "Analista", 3000),
      par("c", "Analista", 3000), par("d", "Head", 20000),
    ], meses);
    expect(m.get("a")?.mediana).toBe(3000);
    expect(m.has("d")).toBe(false); // grupo de 1
  });

  it("cargo escrito com caixa e espaço diferentes é o mesmo grupo", () => {
    const m = compararComPares([
      par("a", "Analista de Suporte", 2000),
      par("b", "ANALISTA  DE SUPORTE", 3000),
      par("c", " analista de suporte ", 4000),
    ], meses);
    expect(m.get("a")?.quantos).toBe(3);
  });

  /* Mediana de dois é a média dos dois — "percentil 50 de um grupo de 2" é
     ruído com cara de dado. */
  it("grupo pequeno demais fica de fora", () => {
    const m = compararComPares([par("a", "Raro", 5000), par("b", "Raro", 6000)], meses);
    expect(m.size).toBe(0);
  });

  it("quem não tem cargo no RH fica de fora", () => {
    const m = compararComPares([
      par("a", null, 3000), par("b", null, 4000), par("c", null, 5000),
    ], meses);
    expect(m.size).toBe(0);
  });

  /* Três pessoas no mesmo salário não podem cair no percentil 0 — pareceriam as
     piores pagas do próprio grupo. */
  it("empate cai no meio, não no fundo", () => {
    const m = compararComPares([
      par("a", "Igual", 5000), par("b", "Igual", 5000), par("c", "Igual", 5000),
    ], meses);
    expect(m.get("a")?.percentil).toBe(50);
  });

  /* Mediana e não média: o mês proporcional de saída fica de fora sozinho. */
  it("um mês proporcional não afunda a pessoa", () => {
    const tres = ["2026-05-01", "2026-06-01", "2026-07-01"];
    const saindo = pessoa({
      id: "x", cargo: "Analista",
      meses: [mes("2026-05-01", 6000), mes("2026-06-01", 6000), mes("2026-07-01", 900)],
    });
    const outro = (id: string) => pessoa({ id, cargo: "Analista", meses: [
      mes("2026-05-01", 6000), mes("2026-06-01", 6000), mes("2026-07-01", 6000),
    ] });
    const m = compararComPares([saindo, outro("y"), outro("z")], tres);
    expect(m.get("x")?.valor).toBe(6000);
    expect(m.get("x")?.contraMediana).toBe(0);
  });
});

describe("custo por área", () => {
  const meses = ["2026-06-01", "2026-07-01", "2026-08-01"];

  it("soma por área e por mês", () => {
    const linhas = custoPorArea([
      pessoa({ id: "a", meses: [mes("2026-06-01", 3000, 0, "Suporte"), mes("2026-07-01", 3000, 0, "Suporte")] }),
      pessoa({ id: "b", meses: [mes("2026-06-01", 5000, 1000, "Tecnologia")] }),
    ], meses);
    const suporte = linhas.find((l) => l.area === "Suporte")!;
    expect(suporte.serie).toEqual([3000, 3000, 0]);
    expect(linhas.find((l) => l.area === "Tecnologia")!.total).toBe(6000);
  });

  /* Quem trocou de time em julho custou para o time antigo até junho. Atribuir
     o passado inteiro ao time novo reescreveria a história dos dois. */
  it("usa a área do MÊS, não a área atual da pessoa", () => {
    const linhas = custoPorArea([
      pessoa({ id: "a", meses: [
        mes("2026-06-01", 3000, 0, "Suporte"),
        mes("2026-07-01", 3000, 0, "Onboarding"),
      ] }),
    ], meses);
    expect(linhas.find((l) => l.area === "Suporte")!.serie).toEqual([3000, 0, 0]);
    expect(linhas.find((l) => l.area === "Onboarding")!.serie).toEqual([0, 3000, 0]);
  });

  it("ordena pela maior conta e mede a variação do período", () => {
    const linhas = custoPorArea([
      pessoa({ id: "a", meses: [mes("2026-06-01", 1000, 0, "Pequena")] }),
      pessoa({ id: "b", meses: [mes("2026-06-01", 5000, 0, "Grande"), mes("2026-08-01", 7500, 0, "Grande")] }),
    ], meses);
    expect(linhas[0].area).toBe("Grande");
    expect(linhas[0].variacao).toBeCloseTo(0.5, 4);
    expect(linhas[1].variacao).toBeNull(); // um mês só, não há o que comparar
  });

  it("mês sem área vira 'Sem área' em vez de sumir da conta", () => {
    const linhas = custoPorArea([
      pessoa({ id: "a", meses: [mes("2026-06-01", 4361, 0, null)] }),
    ], meses);
    expect(linhas[0].area).toBe("Sem área");
    expect(linhas[0].total).toBe(4361);
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

describe("pró-labore", () => {
  /* O Miguel recebe as duas coisas no mesmo mês: R$ 22.500 de salário como CEO
     e R$ 4.361 de pró-labore. Somar num balde só apagaria a distinção. */
  it("soma no total sem se misturar com o fixo", () => {
    const ceo = pessoa({ meses: [mes("2026-08-01", 22500, 0, "Administrativo", 4361)] });
    const r = resumoDaPessoa(ceo);
    expect(r.fixoAtual).toBe(22500);
    expect(r.totalPeriodo).toBe(26861);
  });

  it("entra nos totais do mês em coluna própria", () => {
    const t = totaisDoMes(
      [pessoa({ id: "a", meses: [mes("2026-08-01", 22500, 0, "Adm", 4361)] })],
      "2026-08-01",
    );
    expect(t.fixo).toBe(22500);
    expect(t.prolabore).toBe(4361);
    expect(t.total).toBe(26861);
  });

  /* Quem não recebe pró-labore não pode ganhar uma coluna de zeros. */
  it("é zero para quem não recebe", () => {
    const t = totaisDoMes(
      [pessoa({ id: "b", meses: [mes("2026-08-01", 6000)] })],
      "2026-08-01",
    );
    expect(t.prolabore).toBe(0);
  });

  it("vai para a planilha em coluna própria", () => {
    const ceo = pessoa({ nome: "Miguel", meses: [mes("2026-08-01", 22500, 0, "Adm", 4361)] });
    const [cab, linha] = matrizParaPlanilha([ceo], ["2026-08-01"]);
    expect(linha[cab.indexOf("ago/26 pró-labore")]).toBe(4361);
    expect(linha[cab.indexOf("ago/26 fixo")]).toBe(22500);
    expect(linha[cab.indexOf("ago/26 total")]).toBe(26861);
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

describe("as três abas da planilha", () => {
  const meses = ["2026-07-01", "2026-08-01"];
  const time = [
    pessoa({
      id: "a", nome: "Ana", cargo: "Analista",
      meses: [mes("2026-07-01", 5000, 1000, "Suporte"), mes("2026-08-01", 5000, 0, "Onboarding")],
    }),
    pessoa({
      id: "b", nome: "Bruno", cargo: "Analista",
      meses: [mes("2026-07-01", 7000, 0, "Suporte")],
    }),
  ];
  const abas = () => abasDaPlanilha(time, meses, compararComPares(time, meses));

  it("entrega Resumo, Mês a mês e Por área", () => {
    expect(abas().map((a) => a.nome)).toEqual(["Resumo", "Mês a mês", "Por área"]);
  });

  it("o Resumo é uma linha por pessoa", () => {
    const [resumo] = abas();
    expect(resumo.linhas).toHaveLength(3); // cabeçalho + 2
    expect(resumo.linhas[1][0]).toBe("Ana");
  });

  /* Formato LONGO: é o que vira tabela dinâmica sem desempilhar antes. */
  it("o Mês a mês é uma linha por pessoa E mês", () => {
    const mesAMes = abas()[1];
    expect(mesAMes.linhas).toHaveLength(4); // cabeçalho + 2 meses da Ana + 1 do Bruno
    const cab = mesAMes.linhas[0];
    expect(cab).toContain("Competência");
    expect(cab).toContain("Mês fechado");
  });

  /* Sem essa coluna, quem somar o mês corrente conclui que a comissão caiu —
     quando ela só não foi lançada ainda. */
  it("marca qual mês já teve o variável lançado", () => {
    const mesAMes = abas()[1];
    const iFechado = mesAMes.linhas[0].indexOf("Mês fechado");
    expect(mesAMes.linhas.slice(1).map((l) => l[iFechado])).toContain("sim");
  });

  it("a Por área tem uma coluna por mês e a variação", () => {
    const porArea = abas()[2];
    expect(porArea.linhas[0]).toEqual(
      ["Área", "jul/26", "ago/26", "Total", "Variação %", "Pessoas no último mês"],
    );
  });

  /* A tela usa esses índices para aplicar o formato de moeda. Se saírem do
     lugar, a planilha ganha "R$" numa coluna de percentil. */
  it("aponta as colunas de dinheiro dentro da faixa", () => {
    for (const aba of abas()) {
      const largura = aba.linhas[0].length;
      for (const i of [...aba.moeda, ...aba.percentual]) {
        expect(i).toBeLessThan(largura);
        expect(i).toBeGreaterThanOrEqual(0);
      }
      expect(aba.larguras).toHaveLength(largura);
    }
  });

  it("as colunas marcadas como moeda são mesmo de dinheiro", () => {
    const [resumo] = abas();
    for (const i of resumo.moeda) expect(String(resumo.linhas[0][i])).not.toMatch(/Percentil|Nome|Cargo/);
    expect(resumo.linhas[0][resumo.percentual[0]]).toBe("Reajuste %");
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

  it("põe cinco colunas por mês, com ponto decimal", () => {
    const [cab, linha] = paraCsv([p], meses).split("\n");
    for (const c of ["jul/26 fixo", "jul/26 variável", "jul/26 escala", "jul/26 total", "jul/26 área"]) {
      expect(cab).toContain(c);
    }
    expect(linha).toContain("6000.00");
    expect(linha).toContain("500.00");
    // Sem símbolo de moeda em lugar nenhum — senão não vira número.
    expect(linha).not.toContain("R$");
  });

  it("deixa as cinco células vazias quando o mês não existe para a pessoa", () => {
    const so1 = pessoa({ nome: "Só Julho", meses: [mes("2026-07-01", 6000)] });
    const [cab, linha] = paraCsv([so1], meses).split("\n");
    const cols = cab.split(";");
    const cels = linha.split(";");
    for (const c of ["ago/26 fixo", "ago/26 variável", "ago/26 escala", "ago/26 total", "ago/26 área"]) {
      expect(cels[cols.indexOf(c)]).toBe("");
    }
  });

  /* A trajetória inteira numa célula é o que se lê de relance na planilha. */
  it("resume as trocas de time numa coluna só", () => {
    const andarilho = pessoa({
      meses: [
        mes("2026-07-01", 3000, 0, "Suporte"),
        mes("2026-08-01", 3000, 0, "Onboarding"),
      ],
    });
    const [cab, linha] = paraCsv([andarilho], meses).split("\n");
    expect(linha.split(";")[cab.split(";").indexOf("Trocas de time")]).toBe("Suporte → Onboarding");
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
