import { describe, expect, it } from "vitest";
import { parsearPlano, parsearRealizado, ehStub } from "./parse";

/**
 * Fixture no formato real da aba Consolidado do BP:
 * coluna "Imagem" é o rótulo, __EMPTY_2..13 são os meses 1..12 e __EMPTY_15 é o
 * total do ano. Reproduz as armadilhas da planilha de verdade — linhas de
 * metadados antes da DRE, subtotais sem numeração, linhas de percentual, filhos
 * sem número e os mesmos rótulos repetidos nas três seções.
 */
function linha(rotulo: string, meses: (number | "")[], total?: number) {
  const l: Record<string, unknown> = { Imagem: rotulo, __EMPTY: "", __EMPTY_1: "" };
  meses.forEach((v, i) => { l[`__EMPTY_${i + 2}`] = v; });
  l.__EMPTY_14 = "";
  l.__EMPTY_15 = total ?? "";
  return l;
}
const doze = (v: number) => Array(12).fill(v) as number[];

const PLANILHA = [
  linha("Data", doze(46023)),
  linha("Ano Calendário", doze(2026)),
  linha("Mês Calendário", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  linha("Projeções financeiras", Array(12).fill("") as ""[]),

  linha("Demonstrativo de resultado", Array(12).fill("") as ""[]),
  linha("1.Receita", doze(100), 1200),
  linha("1.1.Receita Recorrente Assinaturas", doze(90), 1080),
  linha("1.2.Receitas Spot", doze(10), 120),
  linha("2.Deduções da Receita", doze(-10), -120),
  linha("2.1.PIS", doze(-4), -48),
  linha("Receita Líquida", doze(90), 1080),
  linha("3.Custo Operacional", doze(-30), -360),
  linha("3.1.Equipe Operacional", doze(-20), -240),
  linha("Margem de contribuição", doze(60), 720),
  linha("% Margem de contribuição", doze(0.6667)),
  linha("(-) SG&A", doze(-80), -960),
  linha("6.Despesas Marketing & Vendas", doze(-25), -300),
  linha("6.1.Aquisição de Clientes", doze(-20), -240),
  linha("Geração de Leads | Inbound", doze(-12), -144),
  linha("Geração de Leads | Eventos", doze(-8), -96),
  linha("EBITDA", doze(-20), -240),
  linha("Lucro Líquido", doze(-20), -240),

  linha("Balanço Patrimonial", Array(12).fill("") as ""[]),
  linha("Ativo Total", doze(500)),
  linha("Caixa", doze(-300)),
  // Mesmo rótulo da DRE, valor diferente: não pode vazar entre seções.
  linha("3.1.Equipe Operacional", doze(999)),
  linha("Patrimônio Líquido", doze(-200)),

  linha("Fluxo de Caixa", Array(12).fill("") as ""[]),
  linha("Fluxo de Caixa Operacional", doze(-20), -240),
  linha("(+) Entradas", doze(100), 1200),
  linha("(-) Saídas", doze(-120), -1440),
  linha("Fluxo de Caixa Livre", doze(-45), -540),
  linha("Saldo Final", doze(-300)),
];

describe("parsearPlano", () => {
  const secoes = parsearPlano(PLANILHA);
  const acharDre = (chave: string) => secoes.dre.find((l) => l.chave === chave);

  it("ignora os metadados antes do marcador da DRE", () => {
    expect(acharDre("data")).toBeUndefined();
    expect(acharDre("mes calendario")).toBeUndefined();
    expect(acharDre("ano calendario")).toBeUndefined();
  });

  it("separa as três seções pelos marcadores", () => {
    expect(secoes.dre.length).toBeGreaterThan(0);
    expect(secoes.balanco.length).toBeGreaterThan(0);
    expect(secoes.dfc.length).toBeGreaterThan(0);
    // "Fluxo de Caixa Operacional" não pode reabrir a seção "Fluxo de Caixa".
    expect(secoes.dfc.find((l) => l.chave === "fluxo de caixa operacional")).toBeDefined();
  });

  it("não deixa rótulo repetido vazar entre seções", () => {
    expect(acharDre("equipe operacional")?.meses[0]).toBe(-20);
    expect(secoes.balanco.find((l) => l.chave === "equipe operacional")?.meses[0]).toBe(999);
  });

  it("deriva a profundidade da numeração", () => {
    expect(acharDre("receita")?.depth).toBe(0);
    expect(acharDre("receita recorrente assinaturas")?.depth).toBe(1);
    expect(acharDre("pis")?.depth).toBe(1);
  });

  it("liga filho ao pai pela numeração", () => {
    const pai = acharDre("receita");
    expect(acharDre("receita recorrente assinaturas")?.paiId).toBe(pai?.id);
    expect(pai?.temFilhos).toBe(true);
  });

  it("pendura linha sem número na última numerada", () => {
    const aquisicao = acharDre("aquisicao de clientes");
    const inbound = acharDre("geracao de leads inbound");
    expect(inbound?.paiId).toBe(aquisicao?.id);
    expect(inbound?.depth).toBe(2);
    expect(aquisicao?.temFilhos).toBe(true);
  });

  it("classifica subtotais e percentuais", () => {
    expect(acharDre("receita liquida")?.tipo).toBe("total");
    expect(acharDre("margem de contribuicao")?.tipo).toBe("total");
    expect(acharDre("ebitda")?.tipo).toBe("total");
    expect(acharDre("sg a")?.tipo).toBe("total");
  });

  it("não confunde a linha de % com o subtotal de mesmo nome", () => {
    // normRotulo remove o "%", então "% Margem de contribuição" e
    // "Margem de contribuição" caem na mesma chave: a de percentual não pode
    // ser classificada como total, e buscar() tem que devolver o subtotal.
    const mesmas = secoes.dre.filter((l) => l.chave === "margem de contribuicao");
    expect(mesmas).toHaveLength(2);
    expect(mesmas[0].tipo).toBe("total");
    expect(mesmas[0].meses[0]).toBe(60);
    expect(mesmas[1].tipo).toBe("percent");
    expect(mesmas[1].meses[0]).toBeCloseTo(0.6667);
  });

  it("separa numeração do texto exibido", () => {
    expect(acharDre("pis")?.numero).toBe("2.1");
    expect(acharDre("pis")?.texto).toBe("PIS");
    expect(acharDre("receita liquida")?.numero).toBeNull();
  });

  it("prefere o total da planilha e cai pra soma dos meses", () => {
    expect(acharDre("receita")?.total).toBe(1200);
    // Sem coluna de total, soma os 12 meses.
    expect(secoes.balanco.find((l) => l.chave === "ativo total")?.total).toBe(500 * 12);
  });

  it("lê os 12 meses pela linha Mês Calendário", () => {
    expect(acharDre("receita")?.meses).toHaveLength(12);
    expect(acharDre("receita")?.meses.every((v) => v === 100)).toBe(true);
  });
});

describe("parsearRealizado", () => {
  const dados = {
    columns: ["Conta", "Jan-26", "Feb-26"],
    rows: [
      { Conta: "Receita Bruta", "Jan-26": 873619, "Feb-26": 919273, "Jan-25": 700000 },
      { Conta: "(-) Custos Operacionais", "Jan-26": -213327, "Feb-26": "" },
      { Conta: "EBITDA", "Jan-26": -154172, "Feb-26": -160000 },
    ],
  };

  it("indexa por rótulo normalizado e só pega o ano pedido", () => {
    const mapa = parsearRealizado(dados, 2026);
    expect(mapa["receita bruta"]?.[0]).toBe(873619);
    expect(mapa["receita bruta"]?.[1]).toBe(919273);
    expect(mapa["receita bruta"]?.[2]).toBeNull();
    // "(-)" sai do rótulo normalizado.
    expect(mapa["custos operacionais"]?.[0]).toBe(-213327);
  });

  it("aceita o formato antigo em array", () => {
    const mapa = parsearRealizado(dados.rows, 2026);
    expect(mapa["ebitda"]?.[0]).toBe(-154172);
  });
});

describe("ehStub", () => {
  it("trata mês aberto como não realizado", () => {
    // Jul-26 veio com Receita Bruta = 1 nas Demonstrações: mês ainda não fechou.
    expect(ehStub(1)).toBe(true);
    expect(ehStub(null)).toBe(true);
    expect(ehStub(873619)).toBe(false);
  });
});
