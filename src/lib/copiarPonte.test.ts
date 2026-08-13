import { describe, it, expect } from "vitest";
import { abreviar, textoDaPonte } from "@/lib/copiarPonte";
import { montarPonte, type LancamentoDaPonte } from "@/lib/ponteVariacao";

/* Os números são os da célula "Viagens & Transportes Mkt · Jul 26" que originou
   o pedido — é contra o comentário escrito à mão naquele fechamento que este
   texto tem de bater. */

const l = (contraparte: string, valor: number): LancamentoDaPonte => ({
  data: "2026-07-01", titulo: null, documento: null, contraparte, cnpj_cpf: null,
  categoria_codigo: null, categoria_descricao: null, status: null, valor, cod_titulo: null,
});

const ponteDespesa = () => montarPonte(
  [
    l("Ana Júlia Mendonça Vieira", -9610.27),
    l("Pedro Faro", -22500),
    l("Renan Brandolini", -2145.16),
    l("Sofia", -500),
  ],
  [
    l("Ana Júlia Mendonça Vieira", -4600),
    l("Pedro Faro", -20000),
    l("Sofia", -531),
    l("Marcelo", -1200),
  ],
  { mes: "Jul-26", mesAnterior: "Jun-26", nomeDe: (x) => x.contraparte ?? "" },
);

describe("abreviar", () => {
  it("escreve como o tracker escreve", () => {
    expect(abreviar(2500)).toBe("2,5k");
    expect(abreviar(2145.16)).toBe("2,1k");
    expect(abreviar(2000)).toBe("2k");
    expect(abreviar(850)).toBe("850");
    expect(abreviar(-1_250_000)).toBe("1,3M");
  });
});

describe("textoDaPonte · completo", () => {
  const texto = textoDaPonte(ponteDespesa(), { formato: "completo", bloco: "piora" });

  it("abre com VAR e o total do bloco", () => {
    expect(texto.split("\n")[0]).toBe("VAR R$ 9.655,43");
  });

  it("escreve o fornecedor como no comentário: dois meses cheios, delta abreviado", () => {
    expect(texto).toContain("Ana Júlia Mendonça Vieira R$ 4.600,00 → R$ 9.610,27 (+5k)");
    expect(texto).toContain("Pedro Faro R$ 20.000,00 → R$ 22.500,00 (+2,5k)");
  });

  it("quem entrou agora sai com zero do lado de lá, não com um traço", () => {
    expect(texto).toContain("Renan Brandolini R$ 0,00 → R$ 2.145,16 (+2,1k)");
  });

  it("não leva sinal negativo nos valores — a direção é o bloco que diz", () => {
    expect(texto).not.toContain("-R$");
  });

  it("ordena do que mais pesou para o que menos, sem cortar ninguém", () => {
    const nomes = texto.split("\n").slice(2).map((x) => x.split(" R$")[0]);
    expect(nomes).toEqual(["Ana Júlia Mendonça Vieira", "Pedro Faro", "Renan Brandolini"]);
  });

  it("a soma dos deltas do texto é a variação do bloco", () => {
    const p = ponteDespesa();
    expect(p.totalPiora).toBeCloseTo(-9655.43, 2);
  });
});

describe("textoDaPonte · o outro lado e os dois juntos", () => {
  it("o bloco que economizou se identifica — senão VAR seria lido como gasto", () => {
    const t = textoDaPonte(ponteDespesa(), { formato: "completo", bloco: "melhora" });
    expect(t.split("\n")[0]).toBe("VAR R$ 1.231,00 (economizou)");
    expect(t).toContain("Sofia R$ 531,00 → R$ 500,00 (-31)");
    expect(t).toContain("Marcelo R$ 1.200,00 → R$ 0,00 (-1,2k)");
  });

  it("com os dois lados, cada lista ganha subtítulo e subtotal", () => {
    const t = textoDaPonte(ponteDespesa(), { formato: "completo", bloco: "ambos" });
    expect(t.split("\n")[0]).toBe("VAR R$ 8.424,43 (gastou a mais)");
    expect(t).toContain("GASTOU A MAIS (R$ 9.655,43)");
    expect(t).toContain("ECONOMIZOU (R$ 1.231,00)");
  });

  it("quem repetiu o valor entra sem total — R$ 0,00 não informa nada", () => {
    const p = montarPonte(
      [l("Fixo", -1000), l("Subiu", -300)],
      [l("Fixo", -1000), l("Subiu", -100)],
      { mes: "Jul-26", mesAnterior: "Jun-26", nomeDe: (x) => x.contraparte ?? "" },
    );
    const t = textoDaPonte(p, { formato: "completo", bloco: "tudo" });
    expect(t).toContain("REPETIRAM O VALOR\nFixo R$ 1.000,00 → R$ 1.000,00 (igual)");
    expect(t).not.toContain("REPETIRAM O VALOR (");
  });
});

describe("textoDaPonte · enxuto e com contexto", () => {
  it("enxuto abre com a frase e marca quem é novo", () => {
    const t = textoDaPonte(ponteDespesa(), {
      formato: "enxuto", bloco: "piora", rubrica: "Viagens & Transportes Mkt", mesLabel: "Jul 26",
    });
    expect(t.split("\n")[0]).toBe("Aumento de 9,7k em Viagens & Transportes Mkt (Jul 26).");
    expect(t).toContain("Ana Júlia Mendonça Vieira +5k");
    expect(t).toContain("Renan Brandolini +2,1k (novo)");
  });

  it("com contexto, o texto diz de onde o número saiu", () => {
    const t = textoDaPonte(ponteDespesa(), {
      formato: "contexto", bloco: "piora", rubrica: "Viagens & Transportes Mkt", mesLabel: "Jul 26",
    });
    const [primeira, segunda, terceira] = t.split("\n");
    expect(primeira).toBe("Viagens & Transportes Mkt · Jun 26 → Jul 26");
    expect(segunda).toBe("R$ 26.331,00 → R$ 34.755,43 (+32%)");
    expect(terceira).toBe("VAR R$ 9.655,43 · 3 gastaram a mais, 2 economizaram");
  });
});

describe("textoDaPonte · receita", () => {
  it("numa linha de receita as palavras mudam, o resto não", () => {
    const p = montarPonte(
      [l("Cliente A", 8000)],
      [l("Cliente A", 10000)],
      { mes: "Jul-26", mesAnterior: "Jun-26", nomeDe: (x) => x.contraparte ?? "" },
    );
    expect(textoDaPonte(p, { formato: "completo", bloco: "piora" }))
      .toBe("VAR R$ 2.000,00\n\nCliente A R$ 10.000,00 → R$ 8.000,00 (-2k)");
    expect(textoDaPonte(p, { formato: "enxuto", bloco: "piora" }).split("\n")[0])
      .toBe("Queda de 2k (Jul 26).");
  });
});

describe("textoDaPonte · bloco vazio", () => {
  it("devolve vazio em vez de um cabeçalho sozinho", () => {
    const p = montarPonte(
      [l("Fixo", -1000)], [l("Fixo", -1000)],
      { mes: "Jul-26", mesAnterior: "Jun-26", nomeDe: (x) => x.contraparte ?? "" },
    );
    expect(textoDaPonte(p, { formato: "completo", bloco: "piora" })).toBe("");
  });
});
