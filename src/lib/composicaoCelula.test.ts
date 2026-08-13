import { describe, it, expect } from "vitest";
import {
  composicaoDaCelula, temComposicao, TOTAIS_DRE, TOTAIS_DFC, noDaRubrica,
  type LeitorDaCelula, type TipoDemonstracao,
} from "./composicaoCelula";
import { DFC_SCHEMA } from "./demonstracoes-schema";

/* Os números são os reais de Jun/Jul-26 da Takeat, inclusive os ERRADOS: o
   valor do blob logo depois do import que estourou a Margem de contribuição.
   Testar com o número redondo do exemplo esconderia justamente a diferença de
   centavos que denuncia o total que ficou para trás. */

/** Blob plano → leitor, com a regra da tela: linha com filhos é a soma dos filhos. */
function leitor(
  blob: Record<string, number | null>,
  tipo: TipoDemonstracao = "dre",
): LeitorDaCelula {
  const guardado = (r: string) => (r in blob ? blob[r] : null);
  const naTela = (r: string): number | null => {
    const no = noDaRubrica(r, tipo);
    if (!no?.children?.length) return guardado(r);
    const vs = no.children.map((c) => naTela(c.label));
    return vs.some((v) => v != null) ? vs.reduce<number>((s, v) => s + (v ?? 0), 0) : guardado(r);
  };
  return { tipo, naTela, guardado };
}

/** Jul-26 como o TRACKER manda — a demonstração fechada, que tem que fechar. */
const TRACKER_JUL26: Record<string, number | null> = {
  "Receita de Assinaturas": 1180342, "Enterprise": 52588, "Receita Recorrente": 1232930,
  "Receita com Materiais": 2113, "Receita Markup": 19396, "Serviços para Clientes": null,
  "Receita Spot": 21509, "Receita Bruta": 1254439,
  "PIS": -7202, "COFINS": -33238, "ISS": -22159, "Devoluções": -23973,
  "(-) Deduções da receita": -86572,
  "Receita Líquida": 1167867,
  "Equipe Operacional": -72385, "Premiações Operacionais": -22448, "Meios de Pagamento": -20866,
  "CMV Materiais": -4063, "Servidor": -140003, "Softwares Operacionais": -53199, "Outros Custos": -257,
  "(-) Custos Operacionais": -313222,
  "Margem de contribuição": 854646,
  "% Margem de contribuição": 73.18,
};

/** O mesmo mês como o blob ficou DEPOIS do import bugado (delta ressomado). */
const BLOB_ERRADO_JUL26: Record<string, number | null> = {
  ...TRACKER_JUL26,
  "Receita Spot": 24384.05,
  "Receita Bruta": 1257314.05,
  "(-) Deduções da receita": -101927.7,
  "Receita Líquida": 1155386.35,
  "Meios de Pagamento": -20866.1,
  "(-) Custos Operacionais": -313479.1,
  "Margem de contribuição": 841908.25,
};

describe("composicaoDaCelula · cascata", () => {
  it("mostra as parcelas do total e confirma quando bate", () => {
    const c = composicaoDaCelula("Margem de contribuição", leitor(TRACKER_JUL26))!;

    expect(c.tipo).toBe("cascata");
    expect(c.parcelas.map((p) => p.rotulo)).toEqual(["Receita Líquida", "(-) Custos Operacionais"]);
    /* A parcela é o número QUE ESTÁ NA TELA: o bloco de custos aparece somando
       as suas rubricas (-313.221), não o -313.222 gravado. A conferência tem que
       falar dos números à vista, senão explica uma conta que ninguém vê. */
    expect(c.parcelas.map((p) => p.valor)).toEqual([1167867, -313221]);
    expect(c.calculado).toBe(854646);
    expect(c.guardado).toBe(854646);
    expect(c.divergente).toBe(false);
  });

  /* Jun-26 fechado à mão contra a fórmula da célula no tracker:
     `=SOMA(AJ74; AJ77:AJ78; AJ82:AJ85)`. As parcelas têm que sair na mesma
     ordem e com os mesmos valores — em especial a depreciação SEPARADA do
     resultado financeiro, que é irmã dela e não a contém. */
  it("o Lucro Líquido do tracker não desconta o IRF — e isso aparece", () => {
    const jun: Record<string, number | null> = {
      "EBITDA": -364591,
      "(-) Depreciação & Amortização": -5488, "(-) Juros": null, "(-) IOF": -2342,
      "(+) Receita financeira": 18067, "(+/-) Resultado Financeiro": 15726,
      "(+) Resultado Não Operacional": 10085, "Despesas Não Operacionais": null,
      "(-) Estorno de Compras": null,
      // A linha "(-) Impostos" do tracker fica VAZIA: o IRF está logo abaixo
      // dela e nunca é somado — é exatamente o que a divergência denuncia.
      "(-) Impostos": null, "IRPJ": null, "CSLL": null, "IRF": -3601,
      "Lucro Líquido": -344268,
    };
    const c = composicaoDaCelula("Lucro Líquido", leitor(jun))!;

    expect(c.parcelas.map((p) => p.rotulo)).toEqual([
      "EBITDA", "(-) Depreciação & Amortização", "(+/-) Resultado Financeiro",
      "(+/-) Resultado Não Operacional", "(-) Impostos",
    ]);
    expect(c.parcelas.map((p) => p.valor)).toEqual([-364591, -5488, 15725, 10085, -3601]);
    expect(c.guardado).toBe(-344268);
    expect(c.divergente).toBe(true);
    // Sem o IRF a conta fecha: -364591 -5488 +15725 +10085 = -344269, o gravado.
    expect((c.calculado ?? 0) - (c.parcelas[4].valor ?? 0)).toBe(-344269);
    expect(c.diferenca).toBe(3602); // o IRF do mês, mais R$ 1 de arredondamento
  });

  it("o resultado financeiro é Juros + IOF + Receita financeira, sem a depreciação", () => {
    const c = composicaoDaCelula("(+/-) Resultado Financeiro", leitor({
      "(-) Juros": null, "(-) IOF": -4909, "(+) Receita financeira": 17014,
      "(+/-) Resultado Financeiro": 12105, // o que o tracker grava na linha
      "(-) Depreciação & Amortização": -5488,
    }))!;

    expect(c.parcelas.map((p) => p.rotulo)).toEqual(["(-) Juros", "(-) IOF", "(+) Receita financeira"]);
    expect(c.calculado).toBe(12105);
    expect(c.divergente).toBe(false); // com a depreciação dentro dava 6.617
  });
});

describe("composicaoDaCelula · filhos", () => {
  it("no blob são as rubricas de dentro, e o pai desatualizado é acusado", () => {
    const c = composicaoDaCelula("Receita Spot", leitor(BLOB_ERRADO_JUL26))!;

    expect(c.tipo).toBe("filhos");
    expect(c.parcelas.map((p) => p.rotulo))
      .toEqual(["Receita com Materiais", "Receita Markup", "Serviços para Clientes"]);
    expect(c.calculado).toBe(21509);
    expect(c.guardado).toBe(24384.05);
    expect(c.divergente).toBe(true);
    expect(c.diferenca).toBeCloseTo(2875.05, 2);
  });

  it("pega o bloco inteiro que saiu do lugar", () => {
    const c = composicaoDaCelula("(-) Deduções da receita", leitor(BLOB_ERRADO_JUL26))!;
    expect(c.calculado).toBe(-86572);
    expect(c.guardado).toBe(-101927.7);
    expect(c.divergente).toBe(true);
  });

  it("no blob correto o bloco fecha com as rubricas", () => {
    const c = composicaoDaCelula("(-) Deduções da receita", leitor(TRACKER_JUL26))!;
    expect(c.calculado).toBe(-86572);
    expect(c.divergente).toBe(false);
  });

  /* R$ 1 por parcela é arredondamento do tracker; o teto tem que ser esse, e não
     um percentual — 0,1% da Receita Bruta seria R$ 1,2 mil de erro tolerado. */
  it("tolera o arredondamento do tracker, mas não um valor de verdade", () => {
    const base = { ...TRACKER_JUL26, "(-) Custos Operacionais": -313225 };
    expect(composicaoDaCelula("(-) Custos Operacionais", leitor(base))!.divergente).toBe(false);
    const fora = { ...TRACKER_JUL26, "(-) Custos Operacionais": -313500 };
    expect(composicaoDaCelula("(-) Custos Operacionais", leitor(fora))!.divergente).toBe(true);
  });
});

describe("composicaoDaCelula · percentual", () => {
  it("diz qual número dividiu qual", () => {
    const c = composicaoDaCelula("% Margem de contribuição", leitor(TRACKER_JUL26))!;

    expect(c.tipo).toBe("percentual");
    expect(c.numerador).toMatchObject({ rotulo: "Margem de contribuição", valor: 854646 });
    expect(c.denominador).toMatchObject({ rotulo: "Receita Líquida", valor: 1167867 });
    expect(c.calculado).toBeCloseTo(0.7318, 4);
    expect(c.guardado).toBeCloseTo(0.7318, 4); // o tracker grava "73,18"
    expect(c.divergente).toBe(false);
  });

  it("acusa a margem que não corresponde mais aos seus dois números", () => {
    const c = composicaoDaCelula("% Margem de contribuição", leitor(BLOB_ERRADO_JUL26))!;
    expect(c.calculado).toBeCloseTo(0.7287, 4);
    expect(c.divergente).toBe(true);
  });

  it("a margem do EBITDA Ajustado divide o EBITDA AJUSTADO, não o EBITDA", () => {
    const c = composicaoDaCelula("% Margem EBITDA Ajustado", {
      tipo: "dre",
      naTela: (r) => ({ "EBITDA": -378331, "EBITDA Ajustado": -344831, "Receita Líquida": 1167867 })[r] ?? null,
      guardado: () => null,
    })!;
    expect(c.numerador?.rotulo).toBe("EBITDA Ajustado");
    expect(c.calculado).toBeCloseTo(-0.2953, 4);
  });

  it("denominador zerado não vira Infinity", () => {
    const c = composicaoDaCelula("% Margem EBITDA", {
      tipo: "dre",
      naTela: (r) => (r === "EBITDA" ? -100 : 0),
      guardado: () => null,
    })!;
    expect(c.calculado).toBeNull();
    expect(c.divergente).toBe(false);
  });
});

describe("temComposicao", () => {
  it("vale para total, bloco e percentual", () => {
    expect(temComposicao("Margem de contribuição", "dre")).toBe(true);
    expect(temComposicao("(-) SG&A", "dre")).toBe(true);
    expect(temComposicao("Pessoal", "dre")).toBe(true);
    expect(temComposicao("% Margem Líquida", "dre")).toBe(true);
  });

  it("não vale para folha — folha abre lançamento, não conta", () => {
    expect(temComposicao("Servidor", "dre")).toBe(false);
    expect(temComposicao("Equipe Comercial", "dre")).toBe(false);
    expect(temComposicao("(+) Ajustes de EBITDA", "dre")).toBe(false);
    expect(composicaoDaCelula("Servidor", leitor(TRACKER_JUL26))).toBeNull();
  });

  it("rubrica fora do esquema não inventa conta", () => {
    expect(temComposicao("Não existe", "dre")).toBe(false);
    expect(composicaoDaCelula("Não existe", leitor(TRACKER_JUL26))).toBeNull();
  });
});

describe("TOTAIS_DRE", () => {
  it("só cita rubricas que existem no esquema", () => {
    for (const [total, parcelas] of Object.entries(TOTAIS_DRE)) {
      expect(noDaRubrica(total, "dre"), total).toBeDefined();
      for (const p of parcelas) expect(noDaRubrica(p, "dre"), `${total} → ${p}`).toBeDefined();
    }
  });

  it("cobre todas as linhas de total da DRE", () => {
    // Se alguém acrescentar um total ao esquema, ele tem que ganhar fórmula aqui
    // — senão nasce como a Margem: um número que ninguém consegue conferir.
    const totais = ["Receita Líquida", "Margem de contribuição", "EBITDA", "EBITDA Ajustado", "Lucro Líquido"];
    expect(Object.keys(TOTAIS_DRE).sort()).toEqual(totais.sort());
  });
});

/* ==========================================================================
 *  DFC — a mesma conferência, outra cascata
 * ======================================================================== */

/** Um mês de DFC como o tracker fecha: blocos e totais batendo.
    Os blocos de saída aparecem só no nível do bloco (é assim que o tracker
    fecha quando as folhas ainda não vieram do Omie) — a leitura cai no valor
    gravado quando nenhum filho tem número. */
const DFC_FECHADO: Record<string, number | null> = {
  // O recebimento entra inteiro em "Entrada de Receita": a DFC do tracker não
  // separa a receita por produto como a DRE separa.
  "Entrada de Receita": 1173600, "Antecipação da Receita": 45000,
  "Receita de Serviços": null, "Receita Markup": 19400,
  "(+) Receita financeira": 18067,
  "Entradas Operacionais": 1256067,
  "Impostos & Deduções": -86572, "Custos de Operação": -218388, "Pessoal": -557477,
  "Despesas Administrativas": -84200, "Despesas Marketing & Vendas": -96310,
  "Financeiras & Impostos sobre o Lucro": -7251,
  "Saídas Operacionais": -1050198,
  "Fluxo de Caixa Operacional": 205869,
  "(+) Resultado Não Operacional": 10085, "(-) Compra de Equipamentos": -12400,
  "Investimentos": -2315,
  "(-) Amortização de Financiamentos": -30000, "Financiamento": -30000,
  "Fluxo Livre": 173554,
};

describe("composicaoDaCelula · DFC", () => {
  it("o fluxo operacional é entradas + saídas — as saídas já vêm negativas", () => {
    const c = composicaoDaCelula("Fluxo de Caixa Operacional", leitor(DFC_FECHADO, "dfc"))!;

    expect(c.tipo).toBe("cascata");
    expect(c.parcelas.map((p) => p.rotulo)).toEqual(["Entradas Operacionais", "Saídas Operacionais"]);
    expect(c.parcelas.map((p) => p.valor)).toEqual([1256067, -1050198]);
    expect(c.calculado).toBe(205869);
    expect(c.divergente).toBe(false);
  });

  /* O caso que motivou o Σ: quem escreve o blob mexe nas rubricas e deixa o
     total para trás. Na DFC isso é pior que na DRE — o fluxo operacional é o
     número que decide se o mês queimou ou gerou caixa. */
  it("acusa o total que ficou para trás das suas rubricas", () => {
    const c = composicaoDaCelula(
      "Fluxo de Caixa Operacional",
      leitor({ ...DFC_FECHADO, "Fluxo de Caixa Operacional": 193127 }, "dfc"),
    )!;

    expect(c.calculado).toBe(205869);
    expect(c.guardado).toBe(193127);
    expect(c.diferenca).toBe(-12742);
    expect(c.divergente).toBe(true);
  });

  it("o fluxo livre soma o operacional com investimento e financiamento", () => {
    const c = composicaoDaCelula("Fluxo Livre", leitor(DFC_FECHADO, "dfc"))!;

    expect(c.parcelas.map((p) => p.rotulo))
      .toEqual(["Fluxo de Caixa Operacional", "Investimentos", "Financiamento"]);
    expect(c.parcelas.map((p) => p.valor)).toEqual([205869, -2315, -30000]);
    expect(c.calculado).toBe(173554);
    expect(c.divergente).toBe(false);
  });

  it("o bloco de saídas abre nas suas rubricas", () => {
    const c = composicaoDaCelula("Saídas Operacionais", leitor(DFC_FECHADO, "dfc"))!;

    expect(c.tipo).toBe("filhos");
    expect(c.parcelas[0].rotulo).toBe("Impostos & Deduções");
    expect(c.calculado).toBe(-1050198);
    expect(c.divergente).toBe(false);
  });

  /* Cashburn é fluxo livre MENOS a captação extraordinária: subtração não cabe
     num modelo que só soma parcelas, e abrir mostrando uma soma seria mostrar
     uma conta que não é a dele. */
  it("Cashburn não finge ter parcelas", () => {
    expect(temComposicao("Cashburn", "dfc")).toBe(false);
    expect(composicaoDaCelula("Cashburn", leitor(DFC_FECHADO, "dfc"))).toBeNull();
  });

  it("rubrica da DRE não vaza para o leitor da DFC", () => {
    expect(temComposicao("Margem de contribuição", "dfc")).toBe(false);
    expect(composicaoDaCelula("EBITDA", leitor(DFC_FECHADO, "dfc"))).toBeNull();
  });
});

describe("TOTAIS_DFC", () => {
  it("só cita rubricas que existem no esquema", () => {
    for (const [total, parcelas] of Object.entries(TOTAIS_DFC)) {
      expect(noDaRubrica(total, "dfc"), total).toBeDefined();
      for (const p of parcelas) expect(noDaRubrica(p, "dfc"), `${total} → ${p}`).toBeDefined();
    }
  });

  /* Total novo no esquema tem que ganhar fórmula aqui — senão nasce como a
     Margem: um número que ninguém consegue conferir. O Cashburn é a única
     exceção declarada. */
  it("todo total da DFC tem fórmula, menos o Cashburn", () => {
    const totais = DFC_SCHEMA.filter((n) => n.kind === "total").map((n) => n.label);
    expect(totais.filter((l) => !(l in TOTAIS_DFC))).toEqual(["Cashburn"]);
  });
});
