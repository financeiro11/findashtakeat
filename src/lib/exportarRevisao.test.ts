import { describe, it, expect } from "vitest";
import { paginar, alturaDoItem, type BlocoMedido, type PecaMedida } from "./exportarRevisao";

/** Uma folha de 800px de altura útil e gap de 14px entre peças. */
const H = 800;
const OPC = { gap: 14, escalaMinima: 0.55, viuvaAte: 0.22 };

const bloco = (n: number, titulo: string, pecas: PecaMedida[]): BlocoMedido => ({ n, titulo, pecas });
const peca = (i: number, altura: number, pilha?: PecaMedida["pilha"]): PecaMedida => ({ i, altura, pilha });

describe("paginar", () => {
  it("bloco que cabe inteiro sai numa folha só, sem redução", () => {
    const p = paginar([bloco(0, "Resumo", [peca(0, 60), peca(1, 200), peca(2, 300)])], H, OPC);
    expect(p).toHaveLength(1);
    expect(p[0].itens.map((x) => x.i)).toEqual([0, 1, 2]);
    expect(p[0].escala).toBe(1);
    expect(p[0].partes).toBe(1);
  });

  it("nunca junta dois blocos na mesma folha", () => {
    const p = paginar(
      [bloco(0, "Resumo", [peca(0, 60)]), bloco(1, "DRE", [peca(0, 60)])],
      H,
      OPC,
    );
    expect(p).toHaveLength(2);
    expect(p.map((x) => x.bloco)).toEqual([0, 1]);
  });

  it("abre folha nova em vez de cortar a peça que não cabe", () => {
    const p = paginar([bloco(0, "DRE", [peca(0, 60), peca(1, 600), peca(2, 400)])], H, OPC);
    expect(p).toHaveLength(2);
    expect(p[0].itens.map((x) => x.i)).toEqual([0, 1]);
    expect(p[1].itens.map((x) => x.i)).toEqual([2]);
    expect(p.every((x) => x.escala === 1)).toBe(true);
    expect(p[1].parte).toBe(2);
    expect(p[1].partes).toBe(2);
  });

  it("peça mais alta que a folha é reduzida — nunca cortada", () => {
    const p = paginar([bloco(0, "DRE", [peca(0, 60), peca(1, 1200), peca(2, 100)])], H, OPC);
    const gigante = p.find((x) => x.itens.some((i) => i.i === 1))!;
    // Vai com o cabeçalho (que não fica órfão) e mais nada.
    expect(gigante.itens.map((x) => x.i)).toEqual([0, 1]);
    expect(gigante.escala).toBeCloseTo(800 / (60 + 14 + 1200), 2);
    // As outras peças não pagam pela redução da gigante.
    expect(p.filter((x) => x !== gigante).every((x) => x.escala === 1)).toBe(true);
  });

  it("nunca reduz abaixo do piso legível", () => {
    const p = paginar([bloco(0, "DRE", [peca(0, 5000)])], H, { ...OPC, escalaMinima: 0.55 });
    expect(p[0].escala).toBe(0.55);
  });

  it("reparte a pilha entre folhas, sempre em card inteiro", () => {
    const alturas = [200, 200, 200, 200, 200, 200];
    const p = paginar(
      [bloco(2, "Pareto", [peca(0, 60), peca(1, 1274, { alturas, gap: 8 })])],
      H,
      OPC,
    );
    expect(p.length).toBeGreaterThan(1);
    const fatias = p.flatMap((x) => x.itens.filter((i) => i.i === 1));
    // Toda a pilha foi distribuída, em ordem e sem repetir nem pular card.
    expect(fatias[0].de).toBe(0);
    expect(fatias[fatias.length - 1].ate).toBe(alturas.length);
    fatias.forEach((f, k) => { if (k) expect(f.de).toBe(fatias[k - 1].ate); });
    // E nenhuma folha estourou.
    for (const pag of p) {
      const h = pag.itens.reduce(
        (s, it, k) => s + alturaDoItem([peca(0, 60), peca(1, 1274, { alturas, gap: 8 })], it) + (k ? 14 : 0),
        0,
      );
      expect(h).toBeLessThanOrEqual(H + 0.5);
    }
  });

  it("a pilha aproveita o espaço que sobrou na folha em vez de pular para a seguinte", () => {
    // 60 + 14 + 300 = 374 usados; sobram 426 para cards de 200.
    const p = paginar(
      [bloco(2, "Pareto", [peca(0, 60), peca(1, 300), peca(2, 824, { alturas: [200, 200, 200, 200], gap: 8 })])],
      H,
      OPC,
    );
    const primeira = p[0].itens.find((i) => i.i === 2);
    expect(primeira).toBeDefined();
    expect(primeira!.de).toBe(0);
    expect(primeira!.ate).toBe(2);
  });

  it("encolhe um tico para ganhar uma folha, em vez de deixar meia folha vazia", () => {
    // 400+14+400 = 814: estoura a folha por 14px. Sem a busca por escala, isto
    // vira TRÊS folhas de um card cada.
    const p = paginar([bloco(0, "Pareto", [peca(0, 400), peca(1, 400), peca(2, 400)])], H, OPC);
    expect(p).toHaveLength(2);
    expect(p[0].itens.map((x) => x.i)).toEqual([0, 1]);
    expect(p[0].escala).toBeGreaterThan(0.97);
  });

  it("mas não encolhe quando isso não economiza folha nenhuma", () => {
    const p = paginar([bloco(0, "DRE", [peca(0, 700), peca(1, 700)])], H, OPC);
    expect(p).toHaveLength(2);
    expect(p.every((x) => x.escala === 1)).toBe(true);
  });

  it("cabeçalho de bloco não fica sozinho numa folha", () => {
    const p = paginar([bloco(1, "DRE", [peca(0, 60), peca(1, 780)])], H, OPC);
    expect(p).toHaveLength(1);
    expect(p[0].itens.map((x) => x.i)).toEqual([0, 1]);
    // Coube por redução, e é isso mesmo: melhor 6% menor que uma folha de capa.
    expect(p[0].escala).toBeLessThan(1);
    expect(p[0].escala).toBeGreaterThan(0.9);
  });

  it("item pequeno sozinho na última folha volta para a anterior", () => {
    const p = paginar([bloco(0, "Resumo", [peca(0, 60), peca(1, 700), peca(2, 60)])], H, OPC);
    expect(p).toHaveLength(1);
    expect(p[0].itens.map((x) => x.i)).toEqual([0, 1, 2]);
    expect(p[0].escala).toBeGreaterThan(0.82);
  });

  it("mas não arrasta a viúva se o preço for encolher demais", () => {
    const p = paginar([bloco(0, "Resumo", [peca(0, 60), peca(1, 790), peca(2, 150)])], H, OPC);
    expect(p).toHaveLength(2);
    expect(p[1].itens.map((x) => x.i)).toEqual([2]);
  });

  it("bloco vazio não vira folha em branco", () => {
    const p = paginar([bloco(0, "Resumo", []), bloco(1, "DRE", [peca(0, 100)])], H, OPC);
    expect(p).toHaveLength(1);
    expect(p[0].bloco).toBe(1);
  });
});

describe("alturaDoItem", () => {
  const pecas = [peca(0, 60), peca(1, 640, { alturas: [200, 200, 200], gap: 20 })];

  it("peça inteira devolve a altura medida", () => {
    expect(alturaDoItem(pecas, { i: 0 })).toBe(60);
  });

  it("fatia de pilha soma os filhos com os espaços entre eles", () => {
    expect(alturaDoItem(pecas, { i: 1, de: 0, ate: 2 })).toBe(420);
    expect(alturaDoItem(pecas, { i: 1, de: 2, ate: 3 })).toBe(200);
  });
});
