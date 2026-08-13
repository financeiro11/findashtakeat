import { describe, it, expect } from "vitest";
import {
  extrairTracker, colunasFechadas, colunasDoEscopo, opcoesDeEscopo,
  corpoDoImport, resumoMeses, ptLabelFromKey, colKey, toNum,
} from "./importarTracker";

/* Uma planilha de tracker em miniatura: cabeçalho de meses, bloco de DRE e,
   abaixo, o de DFC. Abr/24 vem em branco — é o mês ainda não fechado. */
const MATRIZ: unknown[][] = [
  ["", "Data", "jan/24", "fev/24", "mar/24", "abr/24"],
  ["", "Demonstrativo de Resultado", "", "", "", ""],
  ["", "Receita Líquida", 100, 200, 300, ""],
  ["", "(-) Custos", "-10", "(20)", "R$ -30", ""],
  ["", "EBITDA", 90, 180, 270, ""],
  ["", "Fluxo de Caixa", "", "", "", ""],
  ["", "Recebimentos", 50, 60, 70, ""],
  ["", "Pagamentos", -5, -6, -7, ""],
  ["", "Fluxo de Caixa Líquido", 45, 54, 63, ""],
];

describe("helpers de mês", () => {
  it("converte rótulo pt-BR em chave de coluna e de volta", () => {
    expect(colKey("jan/24")).toBe("Jan-24");
    expect(colKey("Ago 2026")).toBe("Aug-26");
    expect(colKey("Receita")).toBeNull();
    expect(ptLabelFromKey("Aug-26")).toBe("Ago/26");
  });
  it("lê número em formato BR, com parênteses e R$", () => {
    expect(toNum("1.234,50")).toBe(1234.5);
    expect(toNum("(20)")).toBe(-20);
    expect(toNum("R$ -30")).toBe(-30);
    expect(toNum("")).toBeNull();
    expect(toNum("-")).toBeNull();
  });
});

describe("extrairTracker", () => {
  const t = extrairTracker(MATRIZ, "tracker.xlsx");

  it("separa DRE e DFC pelos títulos das seções", () => {
    expect(t.dreRows.map((r) => r.Conta)).toEqual(["Receita Líquida", "(-) Custos", "EBITDA"]);
    expect(t.dfcRows.map((r) => r.Conta)).toEqual(["Recebimentos", "Pagamentos", "Fluxo de Caixa Líquido"]);
  });

  it("põe os meses em ordem cronológica e converte os valores", () => {
    expect(t.cols).toEqual(["Jan-24", "Feb-24", "Mar-24", "Apr-24"]);
    expect(t.dreRows[1]["Feb-24"]).toBe(-20);
    expect(t.dreRows[1]["Mar-24"]).toBe(-30);
  });

  it("só considera fechado o mês com dado substancial", () => {
    expect(t.fechadas).toEqual(["Jan-24", "Feb-24", "Mar-24"]);
    expect(t.ignoradas).toEqual(["Apr-24"]);
  });

  it("recusa arquivo sem cabeçalho de meses", () => {
    expect(() => extrairTracker([["Conta", "Valor"], ["Receita", 10]]))
      .toThrow(/cabeçalho de meses/);
  });
});

describe("colunasFechadas", () => {
  const cols = ["Jan-24", "Feb-24", "Mar-24"];
  const depois = new Date(2026, 7, 12); // 12/08/26: tudo de 2024 já fechou
  it("para no primeiro mês que não bate o critério, sem pular buracos", () => {
    const rows = [
      { Conta: "a", "Jan-24": 1, "Feb-24": "", "Mar-24": 3 },
      { Conta: "b", "Jan-24": 1, "Feb-24": "", "Mar-24": 3 },
      { Conta: "c", "Jan-24": 1, "Feb-24": "", "Mar-24": 3 },
    ];
    expect(colunasFechadas(rows, cols, depois)).toEqual(["Jan-24"]);
  });
  it("devolve vazio quando não há número nenhum", () => {
    expect(colunasFechadas([{ Conta: "a", "Jan-24": "" }], cols, depois)).toEqual([]);
  });

  /* Ago/26 chegou preenchido — e invertido, porque a aba automática calcula o mês
     em curso por estorno. Passou no critério de "tem dado", travou, e deixou a DFC
     com Cashburn de +753.602 na última coluna. Mês que não acabou não fecha. */
  it("não fecha o mês corrente, mesmo cheio de número", () => {
    const rows = [
      { Conta: "a", "Jun-26": 1, "Jul-26": 2, "Aug-26": 3 },
      { Conta: "b", "Jun-26": 1, "Jul-26": 2, "Aug-26": 3 },
      { Conta: "c", "Jun-26": 1, "Jul-26": 2, "Aug-26": 3 },
    ];
    const emAgosto = new Date(2026, 7, 12);
    expect(colunasFechadas(rows, ["Jun-26", "Jul-26", "Aug-26"], emAgosto)).toEqual(["Jun-26", "Jul-26"]);
    // Vira o mês e Ago/26 fecha sozinho.
    const emSetembro = new Date(2026, 8, 2);
    expect(colunasFechadas(rows, ["Jun-26", "Jul-26", "Aug-26"], emSetembro))
      .toEqual(["Jun-26", "Jul-26", "Aug-26"]);
  });
});

describe("escopo do import", () => {
  const fechadas = ["Jan-24", "Feb-24", "Mar-24"];

  it("recorta os meses conforme o escopo", () => {
    const travados = new Set(["Jan-24", "Feb-24"]);
    expect(colunasDoEscopo(fechadas, travados, "ultimo")).toEqual(["Mar-24"]);
    expect(colunasDoEscopo(fechadas, travados, "abertos")).toEqual(["Mar-24"]);
    expect(colunasDoEscopo(fechadas, travados, "todos")).toEqual(fechadas);
  });

  it("import mensal: o único mês em aberto é o último, então não repete a opção", () => {
    const { opcoes, padrao } = opcoesDeEscopo(fechadas, new Set(["Jan-24", "Feb-24"]));
    expect(opcoes.map((o) => o.escopo)).toEqual(["ultimo", "todos"]);
    expect(padrao).toBe("ultimo");
  });

  it("dois meses em aberto: as três opções, e o padrão é o conservador", () => {
    const { opcoes, padrao } = opcoesDeEscopo(fechadas, new Set(["Jan-24"]));
    expect(opcoes.map((o) => o.escopo)).toEqual(["abertos", "ultimo", "todos"]);
    expect(opcoes[0].meses).toEqual(["Feb-24", "Mar-24"]);
    expect(padrao).toBe("abertos");
  });

  it("tudo já travado: sobra reimportar o último mês ou o arquivo inteiro", () => {
    const { opcoes, padrao } = opcoesDeEscopo(fechadas, new Set(fechadas));
    expect(opcoes.map((o) => o.escopo)).toEqual(["ultimo", "todos"]);
    expect(padrao).toBe("ultimo");
  });

  it("arquivo com um mês só: uma opção, sem escolha falsa", () => {
    const { opcoes, padrao } = opcoesDeEscopo(["Mar-24"], new Set());
    expect(opcoes.map((o) => o.escopo)).toEqual(["todos"]);
    expect(padrao).toBe("todos");
  });

  it("arquivo vazio não oferece nada", () => {
    expect(opcoesDeEscopo([], new Set()).opcoes).toEqual([]);
  });

  it("o texto da opção nomeia os meses", () => {
    const { opcoes } = opcoesDeEscopo(fechadas, new Set(["Jan-24", "Feb-24"]));
    expect(opcoes[0].descricao).toContain("Mar/24");
    expect(opcoes[1].descricao).toContain("Jan/24, Fev/24 e Mar/24");
  });
});

describe("resumoMeses", () => {
  it("lista até três meses e resume o resto por intervalo", () => {
    expect(resumoMeses(["Mar-24"])).toBe("Mar/24");
    expect(resumoMeses(["Feb-24", "Mar-24"])).toBe("Fev/24 e Mar/24");
    expect(resumoMeses(["Jan-24", "Feb-24", "Mar-24"])).toBe("Jan/24, Fev/24 e Mar/24");
    expect(resumoMeses(["Jan-24", "Feb-24", "Mar-24", "Apr-24"])).toBe("Jan/24 → Abr/24 (4 meses)");
    expect(resumoMeses([])).toBe("nenhum mês");
  });
});

describe("corpoDoImport", () => {
  const t = extrairTracker(MATRIZ, "tracker.xlsx");

  it("manda só as colunas do escopo, nos dois demonstrativos", () => {
    const { body, meses } = corpoDoImport(t, ["Mar-24"]);
    expect(body.dre?.columns).toEqual(["Conta", "Mar-24"]);
    expect(body.dfc?.columns).toEqual(["Conta", "Mar-24"]);
    expect(body.dre?.rows).toHaveLength(3);
    expect(meses).toEqual(["Mar-24"]);
  });

  it("nunca manda mês que o arquivo não trouxe fechado", () => {
    const { body, meses } = corpoDoImport(t, ["Mar-24", "Apr-24"]);
    expect(body.dre?.columns).toEqual(["Conta", "Mar-24"]);
    expect(meses).toEqual(["Mar-24"]);
  });

  it("omite o DFC quando o arquivo não tem a seção", () => {
    const soDre = extrairTracker(MATRIZ.slice(0, 5), "so-dre.xlsx");
    const { body } = corpoDoImport(soDre, soDre.fechadas);
    expect(body.dre).toBeDefined();
    expect(body.dfc).toBeUndefined();
  });

  it("escopo sem interseção não gera corpo nenhum", () => {
    const { body, meses } = corpoDoImport(t, ["Dec-23"]);
    expect(body.dre).toBeUndefined();
    expect(body.dfc).toBeUndefined();
    expect(meses).toEqual([]);
  });
});
