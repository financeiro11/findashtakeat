import { describe, expect, it } from "vitest";
import { aprender, casar, cobertura, sugerir, type LinhaHistorico, type TituloOmie } from "./depara";

const linha = (chave: string, data: string, valor: number, estabelecimento = chave): LinhaHistorico =>
  ({ chave, data, valor, estabelecimento });

const titulo = (
  codTitulo: string, data: string, valor: number, cat: string | null, desc: string | null = cat,
): TituloOmie => ({ codTitulo, data, valor, codigoCategoria: cat, descricaoCategoria: desc });

describe("casar", () => {
  it("casa por valor exato dentro da janela de datas", () => {
    const pares = casar(
      [linha("ANTHROPIC", "2026-06-12", 550)],
      [titulo("t1", "2026-07-08", 550, "2.01.03", "Software / SaaS")],
    );
    expect(pares).toHaveLength(1);
    expect(pares[0].titulo.codTitulo).toBe("t1");
  });

  it("não casa fora da janela", () => {
    // O título é lançado quando a fatura chega, não quando a compra aconteceu —
    // mas seis meses depois já é outra coisa.
    expect(casar(
      [linha("ANTHROPIC", "2026-01-12", 550)],
      [titulo("t1", "2026-07-08", 550, "2.01.03")],
    )).toHaveLength(0);
  });

  it("centavos não se perdem em float", () => {
    expect(casar(
      [linha("X", "2026-06-12", 0.1 + 0.2)],
      [titulo("t1", "2026-06-20", 0.3, "2.01.03")],
    )).toHaveLength(1);
  });

  it("desiste quando o empate de valor muda a resposta", () => {
    // Dois títulos de R$ 19,25 em categorias diferentes: não dá para saber qual
    // é qual, e chutar contaminaria o de-para de um lojista inteiro.
    expect(casar(
      [linha("IOF OPERACAO EXTERIOR", "2026-06-12", 19.25)],
      [titulo("t1", "2026-07-08", 19.25, "2.01.03"), titulo("t2", "2026-07-08", 19.25, "3.02.01")],
    )).toHaveLength(0);
  });

  it("aceita o empate quando todos apontam a mesma categoria", () => {
    // 82 linhas de IOF na fatura de julho, todas em despesas bancárias: a
    // categoria é certa mesmo sem saber qual título é qual.
    const pares = casar(
      [linha("IOF OPERACAO EXTERIOR", "2026-06-12", 19.25)],
      [titulo("t1", "2026-07-08", 19.25, "2.01.03"), titulo("t2", "2026-07-09", 19.25, "2.01.03")],
    );
    expect(pares).toHaveLength(1);
    expect(pares[0].candidatos).toBe(2);
  });

  it("ignora título sem categoria", () => {
    expect(casar([linha("X", "2026-06-12", 550)], [titulo("t1", "2026-06-20", 550, null)])).toHaveLength(0);
  });
});

describe("aprender", () => {
  const titulos = [
    titulo("t1", "2026-05-08", 550, "2.01.03", "Software / SaaS"),
    titulo("t2", "2026-06-08", 551, "2.01.03", "Software / SaaS"),
    titulo("t3", "2026-07-08", 552, "2.01.03", "Software / SaaS"),
    titulo("t4", "2026-07-09", 900, "4.01.01", "Mídia / Tráfego pago"),
  ];

  it("elege a categoria dominante do lojista", () => {
    const mapa = aprender(casar(
      [
        linha("ANTHROPIC", "2026-05-01", 550, "ANTHROPICV"),
        linha("ANTHROPIC", "2026-06-01", 551, "ANTHROPIC* CLAUDE SU"),
        linha("ANTHROPIC", "2026-07-01", 552, "ANTHROPIC"),
      ],
      titulos,
    ));
    const e = mapa.get("ANTHROPIC")!;
    expect(e.codigoCategoria).toBe("2.01.03");
    expect(e.votos).toBe(3);
    expect(e.examinados).toBe(3);
    expect(e.origem).toBe("historico");
    // Os três nomes crus que a fusão juntou ficam à vista para conferência.
    expect(e.exemplos).toHaveLength(3);
  });

  it("no empate, vale a decisão mais recente", () => {
    // Fornecedor que trocou de rubrica no meio do ano: a rubrica nova ganha.
    const mapa = aprender(casar(
      [linha("X", "2026-05-01", 550), linha("X", "2026-07-01", 900)],
      titulos,
    ));
    expect(mapa.get("X")!.codigoCategoria).toBe("4.01.01");
  });
});

describe("sugerir", () => {
  const mapa = aprender(casar(
    [
      linha("ANTHROPIC", "2026-05-01", 550),
      linha("ANTHROPIC", "2026-06-01", 551),
      linha("ANTHROPIC", "2026-07-01", 552),
      linha("SOZINHO", "2026-07-01", 900),
    ],
    [
      titulo("t1", "2026-05-08", 550, "2.01.03"),
      titulo("t2", "2026-06-08", 551, "2.01.03"),
      titulo("t3", "2026-07-08", 552, "2.01.03"),
      titulo("t4", "2026-07-09", 900, "4.01.01"),
    ],
  ));

  it("histórico unânime e repetido é confiança alta", () => {
    expect(sugerir(mapa, "ANTHROPIC")!.confianca).toBe("alta");
  });

  it("um lançamento só não vira confiança alta", () => {
    expect(sugerir(mapa, "SOZINHO")!.confianca).toBe("baixa");
  });

  it("lojista desconhecido não recebe sugestão", () => {
    expect(sugerir(mapa, "LOJA NOVA")).toBeNull();
  });

  it("escolha manual sempre vence", () => {
    const m = new Map(mapa);
    m.set("ANTHROPIC", { ...m.get("ANTHROPIC")!, origem: "manual", codigoCategoria: "9.99.99" });
    const s = sugerir(m, "ANTHROPIC")!;
    expect(s.codigoCategoria).toBe("9.99.99");
    expect(s.confianca).toBe("alta");
  });
});

describe("cobertura", () => {
  it("conta lojistas distintos, não lançamentos", () => {
    const mapa = aprender(casar(
      [linha("ANTHROPIC", "2026-07-01", 550)],
      [titulo("t1", "2026-07-08", 550, "2.01.03")],
    ));
    const c = cobertura(mapa, ["ANTHROPIC", "ANTHROPIC", "ANTHROPIC", "LOJA NOVA"]);
    expect(c).toEqual({ total: 2, cobertas: 1, faltando: ["LOJA NOVA"] });
  });
});
