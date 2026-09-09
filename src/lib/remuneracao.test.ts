import { describe, it, expect } from "vitest";
import {
  degrausDoFixo, resumoDaPessoa, filtrarPessoas, totaisDoMes, paraCsv, matrizParaPlanilha,
  rotuloMes, distanciaEmMeses, ultimaCompetenciaFechada, mudancasDeArea, areaAtual,
  fixoDeReferencia, compararComPares, custoPorArea, competenciasFechadas, abasDaPlanilha,
  FILTROS_VAZIOS, filtrosLigados, montarLinhas, filtrarPorFaixa, ordenarLinhas,
  recortarAte,
  type MesRemuneracao, type PessoaRemuneracao,
} from "./remuneracao";

const mes = (
  competencia: string, fixo: number, premiacao = 0, area: string | null = "Comercial",
  prolabore = 0,
): MesRemuneracao => ({
  competencia, fixo, prolabore, premiacao, escala: 0, outro: 0,
  total: fixo + prolabore + premiacao, fontes: "omie", area,
});

/** "2026-04:5600 2026-05:2800" → série de meses só com fixo. Para colar uma
    trajetória real do banco num teste sem escrever trinta chamadas de `mes`. */
const serieCrua = (s: string): MesRemuneracao[] =>
  s.split(" ").filter(Boolean).map((par) => {
    const [ym, v] = par.split(":");
    return mes(`${ym}-01`, Number(v));
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

  /* O acerto de contas de quem sai soma férias, 13º e o resto do salário: o
     último mês fica MAIOR, não menor. Com o histórico de 2025 no painel isso
     virou regra — 34 das 65 pessoas que saíram terminam num mês inflado. */
  it("não conta o acerto de contas de quem saiu como reajuste", () => {
    const serie = [
      mes("2025-06-01", 4000), mes("2025-07-01", 4000), mes("2025-09-01", 8000),
    ];
    // Sem referência não dá para saber que ela saiu — o degrau aparece.
    expect(degrausDoFixo(serie)).toHaveLength(1);
    // Com o painel indo até ago/26, set/25 é fim de emprego, não borda do dado.
    expect(degrausDoFixo(serie, "2026-08-01")).toHaveLength(0);
  });

  /* A guarda vale só para quem parou antes da referência. Quem recebeu no mês
     mais novo do painel está ativo, e um aumento ali é aumento de verdade. */
  it("mantém o reajuste no último mês de quem continua", () => {
    const d = degrausDoFixo([
      mes("2026-06-01", 4000), mes("2026-07-01", 4000), mes("2026-08-01", 8000),
    ], "2026-08-01");
    expect(d).toHaveLength(1);
    expect(d[0].competencia).toBe("2026-08-01");
  });

  it("série curta demais não tem degrau", () => {
    expect(degrausDoFixo([])).toHaveLength(0);
    expect(degrausDoFixo([mes("2026-03-01", 6000)])).toHaveLength(0);
  });

  /* Dois títulos na mesma competência porque o lançamento no ERP escorregou de
     mês: o vizinho fica sem fixo, e como a função compara meses PAGOS o buraco
     some. O que resta é 2.800 → 5.600 → 2.800, que não é aumento nem corte.
     Em 09/09/2026 eram oito pessoas assim — o Diogo é esta série exata. */
  it("não conta o mês de dois salários como reajuste", () => {
    const d = degrausDoFixo([
      mes("2026-02-01", 2800), mes("2026-04-01", 5600), mes("2026-05-01", 2800),
      mes("2026-06-01", 2800),
    ], "2026-08-01");
    expect(d).toHaveLength(0);
  });

  /* A régua exige as TRÊS condições. Aqui o valor sobe e desce, mas não volta
     ao mesmo patamar: é um aumento de verdade com um mês cheio no meio, e some
     se a guarda olhar só a forma do pico. */
  it("mantém o reajuste quando a volta é para outro patamar", () => {
    const d = degrausDoFixo([
      mes("2026-01-01", 2800), mes("2026-02-01", 2800), mes("2026-03-01", 5600),
      mes("2026-04-01", 4000), mes("2026-05-01", 4000),
    ], "2026-08-01");
    expect(d.map((x) => x.competencia)).toEqual(["2026-03-01", "2026-04-01"]);
  });

  /* A ficha passa `pessoa.meses` cru. Hoje a RPC devolve ordenado, mas as três
     guardas dependem inteiramente da ordem — se um dia vier trocado, o "último
     mês" seria outro e a saída proporcional voltaria a virar reajuste. */
  /* Duas séries REAIS, de `vw_remuneracao_mensal` em 09/09/2026. A do Diogo é o
     pico limpo — 2.800 → 5.600 → 2.800 com abril/26 recebendo o título que
     faltou em março —, e ela precisa perder os dois degraus falsos SEM perder
     os cinco reajustes de verdade que ele teve em dois anos. A do Luiz Paulo é
     o contrário: 33 meses de trajetória de R$ 3.400 a R$ 22.500, com um pico em
     mai/2024 no meio. Se a guarda ficar larga, é aqui que ela come um aumento. */
  it("some com o pico e mantém os reajustes reais (Diogo, série real)", () => {
    const s = "2024-09:800 2024-10:1703 2024-11:2200 2024-12:2200 2025-01:2200 2025-02:2200 " +
      "2025-03:2200 2025-04:2400 2025-05:2400 2025-06:2400 2025-07:2400 2025-08:2400 " +
      "2025-09:2600 2025-10:2600 2025-11:2600 2025-12:2600 2026-01:2800 2026-02:2800 " +
      "2026-04:5600 2026-05:2800 2026-06:3000 2026-07:3000 2026-08:3000";
    const d = degrausDoFixo(serieCrua(s), "2026-08-01");
    expect(d.map((x) => x.competencia)).not.toContain("2026-04-01"); // a subida
    expect(d.map((x) => x.competencia)).not.toContain("2026-05-01"); // a descida
    expect(d.map((x) => x.para)).toEqual([2200, 2400, 2600, 2800, 3000]);
  });

  it("atravessa 33 meses sem comer aumento (Luiz Paulo, série real)", () => {
    const s = "2023-12:3400 2024-01:3400 2024-02:3400 2024-03:4400 2024-04:4400 2024-05:7233 " +
      "2024-06:4400 2024-07:4400 2024-08:4400 2024-09:4400 2024-10:10000 2024-11:10000 " +
      "2024-12:10000 2025-01:11000 2025-02:11000 2025-03:11000 2025-04:12000 2025-05:12000 " +
      "2025-06:12000 2025-07:12000 2025-08:12000 2025-09:13000 2025-10:13000 2025-11:13000 " +
      "2025-12:13000 2026-01:20000 2026-02:20000 2026-03:20000 2026-04:20000 2026-05:20000 " +
      "2026-06:20000 2026-07:22500 2026-08:22500";
    const d = degrausDoFixo(serieCrua(s), "2026-08-01");
    expect(d.map((x) => x.para)).toEqual([4400, 10000, 11000, 12000, 13000, 20000, 22500]);
  });

  it("ordena a série antes de comparar", () => {
    const d = degrausDoFixo([
      mes("2026-05-01", 6000), mes("2026-03-01", 4000), mes("2026-04-01", 4000),
    ], "2026-05-01");
    // Fora de ordem, o primeiro par seria 6000 → 4000: uma queda de 33% em
    // março que nunca existiu, e o aumento de maio sumia.
    expect(d).toHaveLength(1);
    expect(d[0].competencia).toBe("2026-05-01");
    expect(d[0].de).toBe(4000);
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

  /* `eh_pessoa = false` diz "não compare com gente", nunca "não custou". Em
     2024 o extrato escreveu o time no lugar do nome em 83 linhas, que viraram
     balde de área justamente para entrar nesta conta: pulá-las tirava R$ 17.365
     de março/2024 — 15% do mês. */
  it("soma o dinheiro de quem não é pessoa, sem contá-lo como cabeça", () => {
    const linhas = custoPorArea([
      pessoa({ id: "a", meses: [mes("2026-06-01", 3000, 0, "Suporte")] }),
      pessoa({
        id: "balde", nome: "Sem nome no extrato (Suporte)", eh_pessoa: false,
        meses: [mes("2026-06-01", 1200, 0, "Suporte")],
      }),
    ], meses, "2026-06-01");
    const suporte = linhas.find((l) => l.area === "Suporte")!;
    expect(suporte.serie[0]).toBe(4200);
    expect(suporte.pessoasNoMes).toBe(1);
  });
});

describe("filtro de pessoas", () => {
  const base = FILTROS_VAZIOS;
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
    const r = filtrarPessoas([ativo, outro], { ...base, setores: ["Tecnologia"] }, "2026-08-01");
    expect(r.map((p) => p.id)).toEqual(["e"]);
  });

  /* "Suporte E Onboarding" é uma pergunta real — o filtro de um setor só
     obrigava a exportar duas vezes e juntar no Excel. */
  it("aceita vários setores de uma vez", () => {
    const tec = pessoa({ id: "e", setor: "Tecnologia", meses: [mes("2026-08-01", 9000)] });
    const sup = pessoa({ id: "f", setor: "Suporte", meses: [mes("2026-08-01", 3000)] });
    const r = filtrarPessoas([ativo, tec, sup], { ...base, setores: ["Tecnologia", "Suporte"] }, "2026-08-01");
    expect(r.map((p) => p.id).sort()).toEqual(["e", "f"]);
  });

  it("filtra por cargo, ignorando caixa e espaço", () => {
    const head = pessoa({ id: "h", cargo: " HEAD  de Produto ", meses: [mes("2026-08-01", 9000)] });
    const r = filtrarPessoas([ativo, head], { ...base, cargos: ["Head de Produto"] }, "2026-08-01");
    expect(r.map((p) => p.id)).toEqual(["h"]);
  });

  it("setor vazio quer dizer todos", () => {
    expect(filtrarPessoas([ativo], { ...base, setores: [] }, "2026-08-01")).toHaveLength(1);
  });

  /* Olhando um mês passado, quem nunca recebeu nada não estava lá. Era esta a
     porta pela qual a lista de dezembro/25 vinha igual à de agosto/26. */
  it("num mês passado, quem não recebeu nada até ali não aparece", () => {
    const novato = pessoa({ id: "z", nome: "Joel Recém-Chegado", meses: [] });
    expect(filtrarPessoas([novato], base, "2025-12-01", false)).toHaveLength(0);
    expect(filtrarPessoas([novato], base, "2025-12-01", true)).toHaveLength(1);
  });

  /* Quem saiu em julho/26 ESTAVA aqui em dezembro/25. Sem isto, viajar no tempo
     mostrava a folha do passado com o time de hoje. */
  it("desligamento posterior ao mês em foco não esconde a pessoa", () => {
    const saiuEmJulho = pessoa({
      id: "j", datadesl: "2026-07-15", meses: [mes("2025-12-01", 5000)],
    });
    expect(filtrarPessoas([saiuEmJulho], base, "2025-12-01", false).map((p) => p.id))
      .toEqual(["j"]);
    // No presente ele continua fora: já foi embora.
    expect(filtrarPessoas([saiuEmJulho], base, "2026-08-01")).toHaveLength(0);
  });

  /* Saída no PRÓPRIO mês de referência é saída: quem saiu dia 20 de agosto não
     está na lista de agosto. O corte é por mês, não por dia. */
  it("desligamento no mês de referência conta como saída", () => {
    const saiuEmAgosto = pessoa({
      id: "k", datadesl: "2026-08-20", meses: [mes("2026-08-01", 5000)],
    });
    expect(filtrarPessoas([saiuEmAgosto], base, "2026-08-01")).toHaveLength(0);
  });
});

describe("recorte no tempo", () => {
  const gente = [
    pessoa({
      id: "veterano", nome: "Vera Veterana",
      meses: [mes("2025-12-01", 5000), mes("2026-04-01", 5000), mes("2026-08-01", 8000)],
    }),
    pessoa({
      id: "novo", nome: "Nelson Novo", inicio: "2026-04-01",
      meses: [mes("2026-04-01", 27500), mes("2026-08-01", 27500)],
    }),
  ];

  it("corta a série de cada pessoa no mês pedido", () => {
    const r = recortarAte(gente, "2025-12-01");
    expect(r.find((p) => p.id === "veterano")!.meses.map((m) => m.competencia))
      .toEqual(["2025-12-01"]);
    expect(r.find((p) => p.id === "novo")!.meses).toEqual([]);
  });

  it("sem mês, devolve tudo como veio", () => {
    expect(recortarAte(gente, null)).toBe(gente);
  });

  it("não toca no painel original", () => {
    recortarAte(gente, "2025-12-01");
    expect(gente[0].meses).toHaveLength(3);
  });

  /* O problema que originou tudo: dezembro/25 mostrava o Thayrone, que só
     entrou em abril/26, com o fixo de agora. */
  it("quem ainda não tinha entrado some do mês passado", () => {
    const dezembro = filtrarPessoas(
      recortarAte(gente, "2025-12-01"), FILTROS_VAZIOS, "2025-12-01", false,
    );
    expect(dezembro.map((p) => p.id)).toEqual(["veterano"]);
  });

  /* E o fixo mostrado passa a ser o do mês, não o de hoje. */
  it("o fixo do recorte é o do mês em foco", () => {
    const [vera] = recortarAte(gente, "2025-12-01");
    expect(resumoDaPessoa(vera).fixoAtual).toBe(5000);
    expect(resumoDaPessoa(gente[0]).fixoAtual).toBe(8000);
  });

  /* Tempo de casa também é do mês em foco — e quem ainda não tinha entrado não
     tem tempo de casa negativo, tem nenhum. */
  it("tempo de casa negativo vira nulo", () => {
    const l = montarLinhas(gente, new Map(), new Date("2025-12-15"));
    expect(l.find((x) => x.pessoa.id === "novo")!.tempoDeCasa).toBeNull();
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

describe("faixa e ordenação da tabela", () => {
  const meses = ["2026-07-01", "2026-08-01"];
  const gente = [
    pessoa({ id: "alta", nome: "Alta", cargo: "Head", inicio: "2020-08-01",
             meses: [mes("2026-07-01", 20000), mes("2026-08-01", 20000)] }),
    pessoa({ id: "media", nome: "Media", cargo: "Head", inicio: "2025-08-01",
             meses: [mes("2026-07-01", 8000, 2000), mes("2026-08-01", 9000, 2000)] }),
    pessoa({ id: "baixa", nome: "Baixa", cargo: "Head", inicio: "2026-06-01",
             meses: [mes("2026-07-01", 3000), mes("2026-08-01", 3000)] }),
    pessoa({ id: "sem", nome: "Sem nada", cargo: "Head", inicio: null, meses: [] }),
  ];
  const linhas = () => montarLinhas(gente, compararComPares(gente, meses), new Date("2026-08-15"));

  it("calcula o tempo de casa em meses", () => {
    const l = linhas().find((x) => x.pessoa.id === "media")!;
    expect(l.tempoDeCasa).toBe(12);
    expect(linhas().find((x) => x.pessoa.id === "sem")!.tempoDeCasa).toBeNull();
  });

  it("a faixa corta pelo valor calculado, não pelo que veio do banco", () => {
    const r = filtrarPorFaixa(linhas(), { fixo: { min: 5000, max: null } });
    expect(r.map((l) => l.pessoa.id).sort()).toEqual(["alta", "media"]);
  });

  it("faixa fechada dos dois lados", () => {
    const r = filtrarPorFaixa(linhas(), { fixo: { min: 5000, max: 10000 } });
    expect(r.map((l) => l.pessoa.id)).toEqual(["media"]);
  });

  /* "Quem ganha acima de 5.000" não inclui quem não recebeu nada — deixar o nulo
     passar encheria o resultado de linhas em branco. */
  it("quem não tem valor não passa na faixa", () => {
    const r = filtrarPorFaixa(linhas(), { fixo: { min: 0, max: null } });
    expect(r.map((l) => l.pessoa.id)).not.toContain("sem");
  });

  it("faixas de colunas diferentes se somam", () => {
    const r = filtrarPorFaixa(linhas(), {
      fixo: { min: 3000, max: null }, tempoDeCasa: { min: 24, max: null },
    });
    expect(r.map((l) => l.pessoa.id)).toEqual(["alta"]);
  });

  it("faixa vazia não filtra nada", () => {
    expect(filtrarPorFaixa(linhas(), { fixo: { min: null, max: null } })).toHaveLength(4);
    expect(filtrarPorFaixa(linhas(), {})).toHaveLength(4);
  });

  it("ordena por valor, crescente e decrescente", () => {
    const desc = ordenarLinhas(linhas(), { coluna: "fixo", desc: true });
    expect(desc.map((l) => l.pessoa.id)).toEqual(["alta", "media", "baixa", "sem"]);
    const asc = ordenarLinhas(linhas(), { coluna: "fixo", desc: false });
    expect(asc.map((l) => l.pessoa.id)).toEqual(["baixa", "media", "alta", "sem"]);
  });

  /* Nulo por último nos DOIS sentidos: decrescente por "fixo hoje" com o nulo no
     topo poria quem não recebeu nada acima de quem mais ganha. */
  it("quem não tem valor fica no fim, subindo ou descendo", () => {
    for (const desc of [true, false]) {
      const r = ordenarLinhas(linhas(), { coluna: "fixo", desc });
      expect(r[r.length - 1].pessoa.id).toBe("sem");
    }
  });

  it("ordena por nome respeitando acento", () => {
    const r = ordenarLinhas(linhas(), { coluna: "nome", desc: false });
    expect(r.map((l) => l.pessoa.nome)).toEqual(["Alta", "Baixa", "Media", "Sem nada"]);
  });

  it("conta quantos filtros estão ligados", () => {
    expect(filtrosLigados(FILTROS_VAZIOS)).toBe(0);
    expect(filtrosLigados({ ...FILTROS_VAZIOS, busca: "ana", setores: ["Suporte"] })).toBe(2);
    expect(filtrosLigados({ ...FILTROS_VAZIOS, faixas: { fixo: { min: 1, max: null } } })).toBe(1);
    // Faixa declarada mas vazia não conta — senão o botão de limpar acende sozinho.
    expect(filtrosLigados({ ...FILTROS_VAZIOS, faixas: { fixo: { min: null, max: null } } })).toBe(0);
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

  /* Mesma divisão de `custoPorArea`: o balde de área custou, mas não é mais uma
     pessoa no mês. Sem isso o KPI "Custo de pessoas" não bate com a DRE; com o
     balde contado como cabeça, o de "Pessoas no mês" passa a não bater com o RH. */
  it("conta o dinheiro de quem não é pessoa, mas não a cabeça", () => {
    const t = totaisDoMes(
      [
        pessoa({ id: "a", meses: [mes("2026-07-01", 6000)] }),
        pessoa({ id: "b", eh_pessoa: false, meses: [mes("2026-07-01", 1500)] }),
      ],
      "2026-07-01",
    );
    expect(t.fixo).toBe(7500);
    expect(t.total).toBe(7500);
    expect(t.gente).toBe(1);
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

  /* A planilha discordava da tela justamente na pessoa que se exporta sozinha.
     Deduzindo a referência do recorte, quem saiu virava a própria referência,
     `saiu` dava `false` e o acerto de contas reaparecia como reajuste — numa
     linha que a tela mostra como "nenhum". Eram 52 pessoas na base, e o botão
     "Exportar histórico" da ficha manda exatamente uma por vez. */
  it("usa a referência do PAINEL, não a do recorte exportado", () => {
    const saiu = pessoa({
      id: "s", nome: "Quem Saiu", cargo: "Analista",
      meses: [
        mes("2025-05-01", 4000), mes("2025-06-01", 4000), mes("2025-07-01", 9000),
      ],
    });
    const so = ["2025-05-01", "2025-06-01", "2025-07-01"];
    const iReajuste = (a: ReturnType<typeof abasDaPlanilha>[number]) =>
      a.linhas[0].indexOf("Último reajuste");

    const sozinha = abasDaPlanilha([saiu], so, new Map())[0];
    expect(sozinha.linhas[1][iReajuste(sozinha)]).toBe("jul/25");

    const comPainel = abasDaPlanilha([saiu], so, new Map(), "2026-08-01")[0];
    expect(comPainel.linhas[1][iReajuste(comPainel)]).toBeNull();
  });

  /* "Mês fechado" mede se o variável DA EMPRESA já foi lançado. Medido na
     comissão de uma pessoa só, o mês em que ela não vendeu vira "não fechado"
     para todo mundo que abrir a planilha. */
  it("aceita as competências fechadas de fora", () => {
    const soUm = [pessoa({ id: "u", meses: [
      mes("2026-07-01", 5000, 9000), mes("2026-08-01", 5000, 0),
    ] })];
    const iFechado = (a: ReturnType<typeof abasDaPlanilha>[number]) =>
      a.linhas[0].indexOf("Mês fechado");

    const sozinha = abasDaPlanilha(soUm, meses, new Map())[1];
    expect(sozinha.linhas[2][iFechado(sozinha)]).toBe("não");

    const doPainel = abasDaPlanilha(
      soUm, meses, new Map(), "2026-08-01", new Set(meses),
    )[1];
    expect(doPainel.linhas[2][iFechado(doPainel)]).toBe("sim");
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

  /* A contagem de gente é do último mês FECHADO — pelo último da série ela
     seria a do mês corrente, que tem avulsos e nenhuma folha, e sairia zerada
     em toda linha. O cabeçalho diz de que mês ela é. */
  it("a Por área tem uma coluna por mês e a variação", () => {
    const porArea = abas()[2];
    expect(porArea.linhas[0]).toEqual(
      ["Área", "jul/26", "ago/26", "Total", "Variação %", "Pessoas em jul/26"],
    );
  });

  it("conta a gente no mês pedido, não no último da série", () => {
    const meses = ["2026-07-01", "2026-08-01"];
    const emJulho = custoPorArea(time, meses, "2026-07-01");
    expect(emJulho.find((a) => a.area === "Suporte")!.pessoasNoMes).toBe(2);
    const emAgosto = custoPorArea(time, meses, "2026-08-01");
    expect(emAgosto.find((a) => a.area === "Suporte")!.pessoasNoMes).toBe(0);
    // Mês em que ninguém foi pago conta zero, e não o mês mais próximo.
    expect(custoPorArea(time, meses, "2020-01-01").find((a) => a.area === "Suporte")!.pessoasNoMes)
      .toBe(0);
  });

  /* A série dos gráficos para no último mês FECHADO — senão o mês corrente,
     que tem avulsos e nenhuma folha, desenha um despenhadeiro no fim de toda
     sparkline. Mas é o corrente que a tela conta quando alguém o põe em foco,
     e por índice a contagem caía calada no mês anterior: a linha dizia "2 em
     agosto" mostrando o time de julho. */
  it("conta num mês que ficou de fora da série", () => {
    const soJulho = ["2026-07-01"];
    const linhas = custoPorArea(time, soJulho, "2026-08-01");
    expect(linhas.find((a) => a.area === "Suporte")!.serie).toEqual([13000]);
    expect(linhas.find((a) => a.area === "Suporte")!.pessoasNoMes).toBe(0);
    // A Ana estava em Onboarding em agosto — área que a série de julho nem tem.
    expect(linhas.find((a) => a.area === "Onboarding")).toBeUndefined();
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

  /* Os índices de moeda são escritos à mão. Este teste é o que impede que
     acrescentar uma coluna no meio ponha "R$" no percentil. */
  it("as colunas marcadas como moeda são mesmo de dinheiro", () => {
    for (const aba of abas()) {
      for (const i of aba.moeda) {
        expect(aba.linhas[0][i]).toMatch(
          /Fixo|Pró-labore|Variável|Escala|Total|Reajuste R\$|Mediana|Contra a mediana|Contrato|jul\/26|ago\/26/,
        );
      }
      for (const i of aba.percentual) expect(String(aba.linhas[0][i])).toContain("%");
    }
  });

  /* A divisão que o diretor pediu: quanto do que a pessoa recebeu é salário,
     quanto é comissão, quanto é escala — somado no período, sem pivotar nada. */
  it("o Resumo separa fixo, variável e escala no período", () => {
    const [resumo] = abas();
    const cab = resumo.linhas[0];
    const ana = resumo.linhas[1];
    expect(ana[cab.indexOf("Fixo no período")]).toBe(10000);
    expect(ana[cab.indexOf("Variável no período")]).toBe(1000);
    expect(ana[cab.indexOf("Total no período")]).toBe(11000);
    expect(ana[cab.indexOf("Meses pagos")]).toBe(2);
    // 1.000 de 11.000
    expect(ana[cab.indexOf("% variável")]).toBeCloseTo(9.1, 1);
  });

  it("quem não tem escala nem pró-labore fica com célula vazia, não zero", () => {
    const [resumo] = abas();
    const cab = resumo.linhas[0];
    expect(resumo.linhas[1][cab.indexOf("Escala no período")]).toBeNull();
    expect(resumo.linhas[1][cab.indexOf("Pró-labore no período")]).toBeNull();
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
