import { describe, it, expect } from "vitest";
import { lerParcela, fitidDoCartao, mesesEntre, janelaDasIrmas, acharIrmas, type TituloOmie } from "./parcelas";

/** Uma série de N parcelas mensais iguais, como o Omie devolve. */
function serie(opts: { cod0: number; cli: string; valor: number; de: number; venc0: string; integracao?: (n: number) => string }): TituloOmie[] {
  const [y, m, d] = opts.venc0.split("-").map(Number);
  return Array.from({ length: opts.de }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1 + i, d));
    return {
      cod: opts.cod0 + i,
      parc: `${String(i + 1).padStart(3, "0")}/${String(opts.de).padStart(3, "0")}`,
      cli: opts.cli,
      valor: opts.valor,
      venc: dt.toISOString().slice(0, 10),
      integracao: opts.integracao?.(i + 1) ?? null,
    };
  });
}

describe("lerParcela", () => {
  it("lê o formato do Omie", () => {
    expect(lerParcela("004/008")).toEqual({ n: 4, de: 8 });
    expect(lerParcela("1/3")).toEqual({ n: 1, de: 3 });
  });
  it("à vista não é parcela", () => {
    expect(lerParcela(null)).toBeNull();
    expect(lerParcela("")).toBeNull();
    expect(lerParcela("001/001")).toBeNull(); // 1x é à vista disfarçado
  });
  it("recusa dado corrompido em vez de inventar", () => {
    expect(lerParcela("009/003")).toBeNull(); // parcela 9 de 3 não existe
    expect(lerParcela("abc")).toBeNull();
  });
});

describe("fitidDoCartao", () => {
  it("extrai a compra de dentro da chave que o Hub grava", () => {
    expect(fitidDoCartao("CARTAO-20260811001-03")).toBe("20260811001");
  });
  it("ignora chave de outra origem", () => {
    expect(fitidDoCartao("FOLHA-123-01")).toBeNull();
    expect(fitidDoCartao(null)).toBeNull();
  });
});

describe("janelaDasIrmas — olha para trás, não só para a frente", () => {
  it("cobre as parcelas anteriores e as seguintes", () => {
    // 4/8 vencendo em agosto: a série vai de maio a dezembro.
    const j = janelaDasIrmas("2026-08-10", { n: 4, de: 8 });
    expect(j.de <= "2026-04-01").toBe(true);  // 3 antes + folga
    expect(j.ate >= "2026-12-31").toBe(true); // 4 depois + folga
  });
  it("a primeira parcela ainda olha um pouco para trás, por causa da folga", () => {
    const j = janelaDasIrmas("2026-08-10", { n: 1, de: 3 });
    expect(j.de <= "2026-07-01").toBe(true);
  });
});

describe("mesesEntre", () => {
  it("conta pelo calendário, não por dias", () => {
    expect(mesesEntre("2026-01-31", "2026-02-01")).toBe(1);
    expect(mesesEntre("2026-08-10", "2027-02-10")).toBe(6);
  });
});

describe("acharIrmas — caminho exato (cartão criado pelo Hub)", () => {
  it("agrupa pelo fitid, sem depender de valor nem de data", () => {
    const s = serie({ cod0: 100, cli: "999", valor: 250, de: 3, venc0: "2026-09-11", integracao: (n) => `CARTAO-FIT77-${String(n).padStart(2, "0")}` });
    // Ruído: outra compra do MESMO fornecedor, mesmo valor e mesmo plano.
    const outra = serie({ cod0: 200, cli: "999", valor: 250, de: 3, venc0: "2026-09-11", integracao: (n) => `CARTAO-FIT88-${String(n).padStart(2, "0")}` });

    const g = acharIrmas(s[1], [...s, ...outra]);
    expect(g.confianca).toBe("exata");
    expect(g.irmas.map((t) => t.cod)).toEqual([100, 101, 102]);
    expect(g.motivo).toMatch(/FIT77/);
  });
});

describe("acharIrmas — caminho por evidência (lançamento manual)", () => {
  const s = serie({ cod0: 10, cli: "5467841164", valor: 1343.57, de: 8, venc0: "2026-05-10" });

  it("acha a série inteira a partir de qualquer parcela", () => {
    const g = acharIrmas(s[3], s);
    expect(g.confianca).toBe("alta");
    expect(g.achadas).toBe(8);
    expect(g.total).toBe(8);
    expect(g.motivo).toMatch(/série completa/);
  });

  it("não mistura fornecedor diferente", () => {
    const outro = serie({ cod0: 90, cli: "OUTRO", valor: 1343.57, de: 8, venc0: "2026-05-10" });
    const g = acharIrmas(s[0], [...s, ...outro]);
    expect(g.irmas.every((t) => t.cli === "5467841164")).toBe(true);
  });

  it("não mistura valor diferente, nem por um real", () => {
    // Os 8 grupos que variam de valor nesta base variam MUITO — são compras
    // distintas. Tolerar centavos só as fundiria.
    const parecida = serie({ cod0: 80, cli: "5467841164", valor: 1344.57, de: 8, venc0: "2026-05-10" });
    const g = acharIrmas(s[0], [...s, ...parecida]);
    expect(g.achadas).toBe(8);
    expect(g.irmas.every((t) => t.valor === 1343.57)).toBe(true);
  });

  it("não mistura plano diferente (8x com 6x)", () => {
    const seisVezes = serie({ cod0: 70, cli: "5467841164", valor: 1343.57, de: 6, venc0: "2026-05-10" });
    const g = acharIrmas(s[0], [...s, ...seisVezes]);
    expect(g.achadas).toBe(8);
    expect(g.irmas.every((t) => t.parc?.endsWith("/008"))).toBe(true);
  });

  it("avisa quando a série está incompleta em vez de fingir que achou tudo", () => {
    const g = acharIrmas(s[0], s.slice(0, 3));
    expect(g.achadas).toBe(3);
    expect(g.total).toBe(8);
    expect(g.motivo).toMatch(/fora da janela/);
  });
});

describe("acharIrmas — o que NÃO pode ser anexado sozinho", () => {
  it("duas compras idênticas do mesmo fornecedor vão para revisão", () => {
    // O caso real da base: mesmo fornecedor, mesmo valor, mesmo dia, mesmo
    // plano — os números de parcela repetem ([1,1,2,2,3,3]).
    const a = serie({ cod0: 300, cli: "5470888220", valor: 361.08, de: 3, venc0: "2026-08-11" });
    const b = serie({ cod0: 400, cli: "5470888220", valor: 361.08, de: 3, venc0: "2026-08-11" });
    const g = acharIrmas(a[0], [...a, ...b]);
    expect(g.confianca).toBe("ambigua");
    expect(g.motivo).toMatch(/se repetem/);
  });

  it("série com vencimento fora do passo mensal vira revisão", () => {
    const s = serie({ cod0: 500, cli: "77", valor: 100, de: 3, venc0: "2026-05-10" });
    s[2].venc = "2026-11-10"; // salto de 6 meses para a 3ª parcela
    const g = acharIrmas(s[0], s);
    expect(g.confianca).toBe("ambigua");
    expect(g.motivo).toMatch(/não avançam um mês/);
  });

  it("título à vista não inventa irmã", () => {
    const g = acharIrmas({ cod: 1, parc: null, cli: "1", valor: 50, venc: "2026-08-01" }, []);
    expect(g.confianca).toBe("exata");
    expect(g.irmas).toHaveLength(1);
    expect(g.motivo).toMatch(/à vista/);
  });
});
