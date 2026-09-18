import { describe, expect, it } from "vitest";
import {
  concentracao, dataCurta, fimDoMes, inicioDosDados, mesesDoPeriodo, mesesEntre, montarArvore, montarRecorte,
  nosDaArvore, periodoAnterior, porStatus, rotuloPeriodo, sinaisDaCategoria, somarMes, temBase,
  type CategoriaPlano, type CelulaMensal, type LancamentoPlano, type ResumoPlano,
} from "./planoContas";

const cat = (codigo: string, descricao: string, extra: Partial<CategoriaPlano> = {}): CategoriaPlano => ({
  codigo, descricao,
  superior: codigo.split(".").length === 3 ? codigo.split(".").slice(0, 2).join(".") : codigo.split(".")[0],
  totalizadora: codigo.split(".").length === 2,
  inativa: false,
  despesa: codigo.startsWith("2"),
  receita: codigo.startsWith("1"),
  rubrica_dre: "Rubrica",
  rubrica_dfc: "Rubrica",
  regra_nota: null,
  folha: false,
  usos: 0,
  ultimo_uso: null,
  ...extra,
});

const lanc = (data: string, valor: number, contraparte: string, extra: Partial<LancamentoPlano> = {}): LancamentoPlano => ({
  data, valor, contraparte,
  vencimento: null, pagamento: null, titulo: null, documento: null, parcela: null,
  cod_cliente: null, cnpj_cpf: null, categoria: "2.04.07", grupo: "CONTA_A_PAGAR",
  status: "PAGO", origem: null, cod_titulo: null, observacao: null, nota: null,
  ...extra,
});

describe("meses", () => {
  it("soma mês atravessando o ano", () => {
    expect(somarMes("2026-01", -1)).toBe("2025-12");
    expect(somarMes("2025-12", 1)).toBe("2026-01");
    expect(somarMes("2026-08", -12)).toBe("2025-08");
  });

  it("lista os meses inclusive nas duas pontas", () => {
    expect(mesesEntre("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(mesesEntre("2026-03", "2026-02")).toEqual([]);
  });

  it("acha o último dia do mês, fevereiro e ano bissexto inclusive", () => {
    expect(fimDoMes("2026-02")).toBe("2026-02-28");
    expect(fimDoMes("2028-02")).toBe("2028-02-29");
    expect(fimDoMes("2026-12")).toBe("2026-12-31");
  });

  it("encurta data e timestamp do mesmo jeito", () => {
    expect(dataCurta("2026-08-10")).toBe("10/08/26");
    expect(dataCurta("2026-09-11T19:14:39.961005+00:00")).toBe("11/09/26");
    expect(dataCurta(null)).toBe("—");
  });

  it("rotula o período sem repetir o ano", () => {
    expect(rotuloPeriodo(["2026-06", "2026-07", "2026-08"])).toBe("jun–ago/26");
    expect(rotuloPeriodo(["2025-12", "2026-01"])).toBe("dez/25–jan/26");
    expect(rotuloPeriodo(["2026-08"])).toBe("ago/26");
  });
});

describe("período", () => {
  const hoje = "2026-09-15";

  it("termina no último mês FECHADO — setembro em andamento não entra na conta", () => {
    expect(mesesDoPeriodo("mes", hoje)).toEqual(["2026-08"]);
    expect(mesesDoPeriodo("3m", hoje)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(mesesDoPeriodo("ano", hoje)).toHaveLength(8);
  });

  it("em janeiro, 'no ano' é o ano anterior inteiro", () => {
    expect(mesesDoPeriodo("ano", "2027-01-10")).toEqual(mesesEntre("2026-01", "2026-12"));
  });

  it("compara 'no ano' com os mesmos meses do ano passado, e o resto com a janela anterior", () => {
    expect(periodoAnterior("ano", ["2026-01", "2026-02"])).toEqual(["2025-01", "2025-02"]);
    expect(periodoAnterior("3m", ["2026-06", "2026-07", "2026-08"])).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("acha o começo real dos dados, ignorando o punhado de títulos antigos", () => {
    // O cache de 14/09/2026: 4 em mai/25, 261 em mar/26, >1.000 a partir de abr/26.
    const mensal: CelulaMensal[] = [
      ["2.04.07", "2025-05", -10, 4, 1],
      ["2.04.07", "2026-03", -10, 261, 1],
      ["2.04.07", "2026-04", -10, 1292, 1],
      ["2.04.07", "2026-09", -10, 2148, 1],
    ];
    expect(inicioDosDados(mensal)).toBe("2026-04");
  });

  it("o mês corrente, ainda cheio de A VENCER, não decide onde os dados começam", () => {
    const mensal: CelulaMensal[] = [
      ["x", "2026-04", 0, 300, 0],
      ["x", "2026-05", 0, 1000, 0],
      ["x", "2026-09", 0, 9000, 0],
    ];
    // Sem corte, o mês corrente vira o "mais cheio" e empurra o começo para ele mesmo —
    // é por isso que `montarRecorte` passa o último mês fechado.
    expect(inicioDosDados(mensal)).toBe("2026-09");
    expect(inicioDosDados(mensal, "2026-08")).toBe("2026-04");
  });

  it("sem o período anterior inteiro dentro dos dados, não há comparação", () => {
    expect(temBase(["2026-03", "2026-04", "2026-05"], "2026-04")).toBe(false);
    expect(temBase(["2026-04", "2026-05"], "2026-04")).toBe(true);
    expect(temBase(["2026-04"], null)).toBe(false);
  });
});

describe("árvore", () => {
  const resumo: ResumoPlano = {
    base: "competencia",
    hoje: "2026-09-15",
    categorias_atualizado_em: null,
    movimentos_atualizado_em: null,
    categorias: [
      cat("1.01", "Receitas Diretas"),
      cat("1.01.03", "1.1.1. Receita Assinaturas"),
      cat("2.04", "Despesas Administrativas"),
      cat("2.04.07", "3.1.2.19 Outros - Administrativo"),
      cat("2.04.09", "3.1.2.3 Consultorias - Administrativo", { rubrica_dre: null }),
    ],
    mensal: [
      ["1.01.03", "2026-03", 800, 900, 1],
      ["1.01.03", "2026-04", 1000, 1000, 1],
      ["1.01.03", "2026-05", 1000, 1000, 1],
      ["1.01.03", "2026-06", 1000, 1000, 1],
      ["1.01.03", "2026-07", 1200, 1000, 1],
      ["1.01.03", "2026-08", 1500, 1000, 1],
      ["1.01.03", "2026-09", 400, 1000, 1],
      // despesa vem negativa do Omie; um estorno (positivo) abate
      ["2.04.07", "2026-08", -3000, 3, 2],
      ["2.04.07", "2026-07", 200, 1, 1],
      ["2.04.09", "2026-08", -500, 1, 1],
      // código que o cadastro não conhece mais
      ["2.99.01", "2026-08", -70, 1, 1],
    ],
  };

  const recorte = montarRecorte(resumo, "3m");
  const secoes = montarArvore(resumo, recorte);
  const no = (codigo: string) => nosDaArvore(secoes).find((n) => n.codigo === codigo)!;

  it("põe receitas antes de despesas", () => {
    expect(secoes.map((s) => s.titulo)).toEqual(["Receitas", "Despesas"]);
  });

  it("lê despesa em módulo e deixa o estorno abater", () => {
    expect(no("2.04.07").stats.total).toBe(2800);
    expect(no("2.04.09").stats.total).toBe(500);
  });

  it("o grupo é a soma dos filhos, e a seção a dos grupos", () => {
    expect(no("2.04").stats.total).toBe(3300);
    expect(secoes[1].stats.total).toBe(3370); // + a órfã
    expect(no("2.04").stats.lancamentos).toBe(5);
  });

  it("categoria com movimento e fora do cadastro não some", () => {
    const orfa = no("2.99.01");
    expect(orfa.categoria).toBeNull();
    expect(orfa.stats.total).toBe(70);
  });

  it("compara com o trimestre anterior quando ele está dentro dos dados", () => {
    // jun–ago contra mar–mai; o início dos dados é abr (mar tem 900 ≥ 20%… da maior)
    const r = no("1.01.03");
    expect(recorte.meses).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(r.stats.total).toBe(3700);
    expect(r.stats.anterior).toBe(2800);
    expect(r.stats.variacao).toBeCloseTo(900 / 2800, 6);
  });

  it("sem base, a variação é nula — não '+∞%'", () => {
    const r6 = montarRecorte(resumo, "6m");
    expect(r6.comBase).toBe(false);
    const n = nosDaArvore(montarArvore(resumo, r6)).find((x) => x.codigo === "1.01.03")!;
    expect(n.stats.anterior).toBeNull();
    expect(n.stats.variacao).toBeNull();
  });

  it("a série do gráfico vai até o mês corrente", () => {
    expect(recorte.serieMeses[recorte.serieMeses.length - 1]).toBe("2026-09");
    const r = no("1.01.03");
    expect(r.stats.serie[r.stats.serie.length - 1]).toBe(400);
  });
});

describe("concentração", () => {
  const meses = ["2026-07", "2026-08"];
  const anteriores = ["2026-05", "2026-06"];
  const lancs = [
    lanc("2026-08-10", -600, "Datadog"),
    lanc("2026-07-10", -400, "Datadog"),
    lanc("2026-06-10", -500, "Datadog"),
    lanc("2026-08-02", -300, "OpenAI"),
    lanc("2026-05-02", -250, "Figma"),
    lanc("2026-04-02", -999, "Fora da janela"),
  ];
  const linhas = concentracao(lancs, (l) => l.contraparte ?? "", true, meses, anteriores);

  it("ordena pelo total e fecha a participação em 100%", () => {
    expect(linhas.map((l) => l.nome)).toEqual(["Datadog", "OpenAI", "Figma"]);
    expect(linhas[0].participacao).toBeCloseTo(1000 / 1300, 6);
    expect(linhas[1].acumulado).toBeCloseTo(1, 6);
  });

  it("carimba subiu, novo e sumiu contra o período anterior", () => {
    expect(linhas.find((l) => l.nome === "Datadog")!.situacao).toBe("subiu");
    expect(linhas.find((l) => l.nome === "OpenAI")!.situacao).toBe("novo");
    const figma = linhas.find((l) => l.nome === "Figma")!;
    expect(figma.situacao).toBe("sumiu");
    expect(figma.total).toBe(0);
  });

  it("conta em quantos meses a contraparte apareceu", () => {
    expect(linhas[0].mesesPresente).toBe(2);
  });

  it("sem base de comparação, não carimba nada nem traz quem sumiu", () => {
    const sem = concentracao(lancs, (l) => l.contraparte ?? "", true, meses, null);
    expect(sem.map((l) => l.nome)).toEqual(["Datadog", "OpenAI"]);
    expect(sem.every((l) => l.situacao === null && l.anterior === null)).toBe(true);
  });

  it("junta pelo nome exibido sem diferenciar caixa, e nada além disso", () => {
    const l = concentracao(
      [lanc("2026-08-01", -1, "UBER"), lanc("2026-08-02", -1, "Uber"), lanc("2026-08-03", -1, "Uber Eats")],
      (x) => x.contraparte ?? "", true, meses, null,
    );
    expect(l.map((x) => x.lancamentos)).toEqual([2, 1]);
  });
});

describe("status", () => {
  it("separa o que já saiu do que está em aberto, no período", () => {
    const s = porStatus(
      [
        lanc("2026-08-01", -100, "a"),
        lanc("2026-08-02", -50, "b", { status: "A VENCER" }),
        lanc("2026-01-02", -999, "c", { status: "A VENCER" }),
      ],
      true,
      ["2026-08"],
    );
    expect(s).toEqual([
      { status: "PAGO", total: 100, n: 1 },
      { status: "A VENCER", total: 50, n: 1 },
    ]);
  });
});

describe("sinais", () => {
  const fmt = (v: number) => `R$ ${v}`;
  const no = (c: CategoriaPlano, total: number, anterior: number | null = null) => ({
    codigo: c.codigo, descricao: c.descricao, categoria: c, despesa: true, filhos: [],
    stats: {
      total, anterior, lancamentos: 4, serie: [],
      variacao: anterior ? (total - anterior) / Math.abs(anterior) : null,
    },
  });

  it("acusa categoria com valor fora do DE-PARA da demonstração em foco", () => {
    const c = cat("2.04.09", "Consultorias", { rubrica_dre: null, rubrica_dfc: "Consultorias" });
    expect(sinaisDaCategoria(no(c, 500), "competencia", null, fmt).map((s) => s.tipo)).toContain("sem_de_para");
    expect(sinaisDaCategoria(no(c, 500), "caixa", null, fmt).map((s) => s.tipo)).not.toContain("sem_de_para");
  });

  it("categoria marcada como fora de propósito não é acusada de estar fora do DE-PARA", () => {
    const c = cat("1.04.94", "Transferência de Entrada*", { rubrica_dre: null });
    expect(sinaisDaCategoria(no(c, 500), "competencia", null, fmt, true).map((s) => s.tipo)).not.toContain("sem_de_para");
  });

  it("não acusa nada em categoria zerada", () => {
    const c = cat("2.04.09", "3.1.2.19 Outros", { rubrica_dre: null, inativa: true });
    expect(sinaisDaCategoria(no(c, 0), "competencia", null, fmt)).toEqual([]);
  });

  it("variação só vira sinal acima de 30% E de R$ 1.000", () => {
    const c = cat("2.04.01", "Aluguel");
    expect(sinaisDaCategoria(no(c, 1300, 1000), "competencia", null, fmt)).toEqual([]);
    expect(sinaisDaCategoria(no(c, 14000, 10000), "competencia", null, fmt).map((s) => s.tipo)).toEqual(["variacao"]);
  });

  it("marca o nome genérico como candidato a separar", () => {
    const c = cat("2.04.07", "3.1.2.19 Outros - Administrativo");
    expect(sinaisDaCategoria(no(c, 800), "competencia", null, fmt).map((s) => s.tipo)).toEqual(["generica"]);
    // "Outsourcing" não é "outros"
    const d = cat("2.04.08", "Outsourcing de TI");
    expect(sinaisDaCategoria(no(d, 800), "competencia", null, fmt)).toEqual([]);
  });

  it("concentração: uma contraparte com 60% ou mais, havendo ao menos três", () => {
    const c = cat("2.07.01", "Softwares - Tecnologia");
    const linhas = concentracao(
      [lanc("2026-08-01", -700, "AWS"), lanc("2026-08-01", -200, "Datadog"), lanc("2026-08-01", -100, "Figma")],
      (l) => l.contraparte ?? "", true, ["2026-08"], null,
    );
    expect(sinaisDaCategoria(no(c, 1000), "competencia", linhas, fmt).map((s) => s.tipo)).toEqual(["concentrada"]);
  });
});
