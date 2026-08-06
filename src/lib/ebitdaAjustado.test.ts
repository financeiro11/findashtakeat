import { describe, it, expect } from "vitest";
import {
  rubricasDoEbitda, addBack, somaAjustes, precisaRecalcular, LINHAS_DO_AJUSTE,
  repartirAjuste, erroDoAjuste, ehParcial,
} from "./ebitdaAjustado";
import { DRE_SCHEMA } from "./demonstracoes-schema";
import {
  aplicarAjustesNoBlob,
  LINHA_AJUSTES,
  LINHA_EBITDA_AJUSTADO,
  repartirAjuste as repartirNoServidor,
  erroDoAjuste as erroNoServidor,
  type Dados,
} from "../../supabase/functions/_shared/ebitda-ajustado.ts";

/* --------------------------------------------------------------------------
 * O corte que define a linha: só entra o que já estava DENTRO do EBITDA.
 * ------------------------------------------------------------------------ */

describe("rubricasDoEbitda", () => {
  const rubricas = rubricasDoEbitda();

  it("pega receita, dedução, custo e SG&A", () => {
    for (const r of ["Receita de Assinaturas", "Simples Nacional", "Servidor", "Equipe Marketing"]) {
      expect(rubricas).toContain(r);
    }
  });

  it("NÃO pega nada que mora abaixo do EBITDA", () => {
    // somar juros ou depreciação de volta seria devolver ao EBITDA algo que ele nunca teve
    for (const r of ["(-) Juros", "(-) Depreciação & Amortização", "IRPJ", "(-) Estorno de Compras"]) {
      expect(rubricas).not.toContain(r);
    }
  });

  it("não devolve bloco nem subtotal — só folha, que é o que o DE_PARA preenche", () => {
    for (const r of ["(-) SG&A", "Pessoal", "Receita Bruta", "Receita Recorrente"]) {
      expect(rubricas).not.toContain(r);
    }
  });

  it("nem as linhas de total e percentual", () => {
    for (const r of ["Receita Líquida", "Margem de contribuição", "% Margem de contribuição", "EBITDA"]) {
      expect(rubricas).not.toContain(r);
    }
  });

  it("as três linhas derivadas ficam fora da lista de rubricas auditáveis", () => {
    for (const l of LINHAS_DO_AJUSTE) expect(rubricas).not.toContain(l);
  });

  it("as três linhas derivadas existem no esquema, com o mesmo rótulo", () => {
    const labels = DRE_SCHEMA.map((n) => n.label);
    for (const l of LINHAS_DO_AJUSTE) expect(labels).toContain(l);
  });
});

describe("addBack", () => {
  it("despesa não recorrente devolve valor ao EBITDA", () => {
    expect(addBack(-48000)).toBe(48000);
  });

  it("receita não recorrente sai do EBITDA", () => {
    expect(addBack(30000)).toBe(-30000);
  });
});

/* --------------------------------------------------------------------------
 * Ajuste parcial. O caso que motivou: fatura do Datadog de R$ 40 mil em Jul-26
 * trazendo meses atrasados — a competência de julho ali dentro era R$ 6,5 mil.
 * ------------------------------------------------------------------------ */

describe("repartirAjuste", () => {
  it("devolve só o atraso e deixa a competência do mês", () => {
    const { valor, fica } = repartirAjuste(-40000, 33500);
    expect(valor).toBe(33500);   // add-back
    expect(fica).toBe(-6500);    // continua sendo custo de julho, no sinal do blob
  });

  it("os dois pedaços somam o lançamento inteiro — a conta da tela sempre fecha", () => {
    const { valor, fica } = repartirAjuste(-40000, 12345.67);
    expect(Math.abs(valor) + Math.abs(fica)).toBeCloseTo(40000, 2);
  });

  it("parte igual ao lançamento é o ajuste cheio, sem sobra", () => {
    expect(repartirAjuste(-40000, 40000)).toEqual({ valor: 40000, fica: 0 });
  });

  it("não deixa devolver mais do que o lançamento tem", () => {
    // teto no próprio lançamento: acima disso o EBITDA Ajustado ficaria melhor
    // que a realidade, que é o oposto do que a linha existe para fazer
    expect(repartirAjuste(-40000, 999999)).toEqual({ valor: 40000, fica: 0 });
  });

  it("receita não recorrente reparte ao contrário", () => {
    const { valor, fica } = repartirAjuste(30000, 20000);
    expect(valor).toBe(-20000);  // tira do EBITDA
    expect(fica).toBe(10000);    // o resto era receita normal do mês
  });

  it("o módulo digitado vale — quem preenche não precisa saber o sinal do blob", () => {
    expect(repartirAjuste(-40000, -33500).valor).toBe(33500);
  });

  it("arredonda em centavos, como o blob", () => {
    expect(repartirAjuste(-40000, 6666.666).valor).toBe(6666.67);
  });
});

describe("erroDoAjuste", () => {
  it("parcial dentro do lançamento passa", () => {
    expect(erroDoAjuste(-40000, 33500)).toBeNull();
  });

  it("ajuste cheio passa", () => {
    expect(erroDoAjuste(-40000, 40000)).toBeNull();
  });

  it("zero não é ajuste — é recusa, e tem botão próprio", () => {
    expect(erroDoAjuste(-40000, 0)).toMatch(/não pode ser zero/i);
  });

  it("não deixa passar do lançamento", () => {
    expect(erroDoAjuste(-40000, 45000)).toMatch(/não pode passar/i);
  });

  it("centavo de arredondamento não vira erro", () => {
    expect(erroDoAjuste(-40000, 40000.009)).toBeNull();
  });

  it("sinal trocado em despesa é erro, não ajuste negativo", () => {
    expect(erroDoAjuste(-40000, -1000)).toMatch(/despesa/i);
  });

  it("sinal trocado em receita também", () => {
    expect(erroDoAjuste(30000, 1000)).toMatch(/receita/i);
  });

  it("ajuste avulso não tem lançamento para comparar — só não pode ser zero", () => {
    expect(erroDoAjuste(null, 999999)).toBeNull();
    expect(erroDoAjuste(null, 0)).toMatch(/não pode ser zero/i);
  });
});

/* A regra vive em dois lugares de propósito (a tela precisa dela para desabilitar
   o botão enquanto se digita; o servidor porque validação só no cliente não
   existe). Isto é o que impede as duas cópias de divergirem em silêncio. */
describe("cliente e servidor concordam", () => {
  const casos: [number | null, number][] = [
    [-40000, 33500], [-40000, 40000], [-40000, 45000], [-40000, -1000], [-40000, 0],
    [30000, -20000], [30000, 1000], [null, 5000], [null, 0], [-40000, 40000.009],
  ];

  it("erroDoAjuste dá o mesmo veredito nos dois lados", () => {
    for (const [lanc, valor] of casos) {
      expect(erroDoAjuste(lanc, valor)).toBe(erroNoServidor(lanc, valor));
    }
  });

  it("repartirAjuste devolve os mesmos números nos dois lados", () => {
    for (const [lanc, valor] of casos) {
      if (lanc == null) continue;
      expect(repartirAjuste(lanc, valor)).toEqual(repartirNoServidor(lanc, valor));
    }
  });
});

describe("ehParcial", () => {
  it("reconhece o pedaço", () => {
    expect(ehParcial(-40000, 33500)).toBe(true);
  });

  it("ajuste cheio não é parcial", () => {
    expect(ehParcial(-40000, 40000)).toBe(false);
  });

  it("avulso não é parcial — não há inteiro do qual ser parte", () => {
    expect(ehParcial(null, 5000)).toBe(false);
  });
});

describe("somaAjustes", () => {
  it("soma os aceitos", () => {
    expect(somaAjustes([{ valor: 48000 }, { valor: -30000 }, { valor: 1200.5 }])).toBe(19200.5);
  });

  it("lista vazia é zero, não NaN", () => {
    expect(somaAjustes([])).toBe(0);
  });
});

/* --------------------------------------------------------------------------
 * A conferência que a tela faz: quem escreveu o blob deixou a linha para trás?
 * ------------------------------------------------------------------------ */

describe("precisaRecalcular", () => {
  const cols = ["May-26", "Jun-26"];
  const eb = { "May-26": -491219, "Jun-26": -364691 };

  const chamar = (
    ajustado: Record<string, number | null>,
    ajustes: Record<string, { valor: number }[]> = {},
  ) => precisaRecalcular(cols, (c) => eb[c] ?? null, (c) => ajustado[c] ?? null, (c) => ajustes[c] ?? []);

  it("linha em dia não dispara nada", () => {
    expect(chamar({ "May-26": -491219, "Jun-26": -304691 }, { "Jun-26": [{ valor: 60000 }] })).toBe(false);
  });

  it("o sync mexeu no EBITDA e a linha ficou com o número velho", () => {
    expect(chamar({ "May-26": -491219, "Jun-26": -400000 })).toBe(true);
  });

  it("mês com EBITDA e sem a linha ajustada também conta como atrasado", () => {
    expect(chamar({ "May-26": -491219 })).toBe(true);
  });

  it("centavo de arredondamento não vira recálculo", () => {
    expect(chamar({ "May-26": -491219.004, "Jun-26": -364691 })).toBe(false);
  });

  it("mês sem EBITDA é ignorado — ele não tem linha ajustada por definição", () => {
    expect(precisaRecalcular(["Jul-26"], () => null, () => null, () => [])).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Aplicação no blob. Os números são os reais da Takeat (Mai/Jun-26).
 * ------------------------------------------------------------------------ */

const blob = (): Dados => ({
  columns: ["Conta", "May-26", "Jun-26"],
  rows: [
    { Conta: "Receita Líquida", "May-26": 1013625, "Jun-26": 1065546 },
    { Conta: "EBITDA", "May-26": -491219, "Jun-26": -364691 },
    { Conta: "Lucro Líquido", "May-26": -445269, "Jun-26": -344368 },
  ],
});

const celula = (d: Dados, conta: string, col: string) =>
  d.rows.find((r) => r.Conta === conta)?.[col];

describe("aplicarAjustesNoBlob", () => {
  it("soma o ajuste ao EBITDA do mês e escreve a linha de ajustes", () => {
    const d = aplicarAjustesNoBlob(blob(), [{ col_key: "Jun-26", valor: 60000 }]);
    expect(celula(d, LINHA_AJUSTES, "Jun-26")).toBe(60000);
    expect(celula(d, LINHA_EBITDA_AJUSTADO, "Jun-26")).toBe(-304691); // -364691 + 60000
  });

  it("mês sem ajuste continua na série, com o ajustado igual ao EBITDA", () => {
    // linha furada no meio do ano leria como dado faltando, não como "não houve ajuste"
    const d = aplicarAjustesNoBlob(blob(), [{ col_key: "Jun-26", valor: 60000 }]);
    expect(celula(d, LINHA_EBITDA_AJUSTADO, "May-26")).toBe(-491219);
    expect(celula(d, LINHA_AJUSTES, "May-26")).toBeUndefined(); // "—", não R$ 0,00
  });

  it("vários ajustes no mesmo mês somam", () => {
    const d = aplicarAjustesNoBlob(blob(), [
      { col_key: "Jun-26", valor: 60000 },
      { col_key: "Jun-26", valor: 12500 },
      { col_key: "Jun-26", valor: -30000 }, // receita não recorrente
    ]);
    expect(celula(d, LINHA_AJUSTES, "Jun-26")).toBe(42500);
    expect(celula(d, LINHA_EBITDA_AJUSTADO, "Jun-26")).toBe(-322191);
  });

  it("NÃO mexe no EBITDA nem no Lucro Líquido — é linha de memória", () => {
    const d = aplicarAjustesNoBlob(blob(), [{ col_key: "Jun-26", valor: 60000 }]);
    expect(celula(d, "EBITDA", "Jun-26")).toBe(-364691);
    expect(celula(d, "Lucro Líquido", "Jun-26")).toBe(-344368);
  });

  /* Roda a cada sync, a cada import e a cada decisão. Se acumulasse, o ajustado
     subiria sozinho a cada clique — o bug que os valores manuais tiveram. */
  it("reaplicar não acumula", () => {
    const ajustes = [{ col_key: "Jun-26", valor: 60000 }];
    const uma = aplicarAjustesNoBlob(blob(), ajustes);
    const duas = aplicarAjustesNoBlob(uma, ajustes);
    const tres = aplicarAjustesNoBlob(duas, ajustes);
    expect(celula(tres, LINHA_EBITDA_AJUSTADO, "Jun-26")).toBe(-304691);
    expect(celula(tres, LINHA_AJUSTES, "Jun-26")).toBe(60000);
  });

  it("ajuste removido limpa a célula em vez de deixar o número velho", () => {
    const com = aplicarAjustesNoBlob(blob(), [{ col_key: "Jun-26", valor: 60000 }]);
    const sem = aplicarAjustesNoBlob(com, []);
    expect(celula(sem, LINHA_AJUSTES, "Jun-26")).toBeUndefined();
    expect(celula(sem, LINHA_EBITDA_AJUSTADO, "Jun-26")).toBe(-364691);
  });

  it("mês sem EBITDA não ganha linha nenhuma — ajustado sem EBITDA seria só o ajuste", () => {
    const d = aplicarAjustesNoBlob(
      { columns: ["Conta", "Jul-26"], rows: [{ Conta: "Receita Líquida", "Jul-26": 900000 }] },
      [{ col_key: "Jul-26", valor: 60000 }],
    );
    expect(celula(d, LINHA_EBITDA_AJUSTADO, "Jul-26")).toBeUndefined();
    expect(d.rows.find((r) => r.Conta === LINHA_AJUSTES)).toBeUndefined();
  });

  it("blob sem EBITDA nenhum não cria linha vazia", () => {
    const d = aplicarAjustesNoBlob({ columns: ["Conta", "Jun-26"], rows: [] }, []);
    expect(d.rows).toHaveLength(0);
  });

  it("ajuste em mês que não está no blob é ignorado, não inventa coluna", () => {
    const d = aplicarAjustesNoBlob(blob(), [{ col_key: "Dec-27", valor: 10000 }]);
    expect(d.columns).toEqual(["Conta", "May-26", "Jun-26"]);
    expect(celula(d, LINHA_EBITDA_AJUSTADO, "Jun-26")).toBe(-364691);
  });
});
