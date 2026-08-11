import { describe, it, expect } from "vitest";
import { categoriasDaCelula, type LinhaFiltravel } from "@/lib/filtroLancamentos";
import {
  montarComposicao, categoriaMarcada, alternarCategoriaNoFiltro,
  resumoComposicao, explicarCategoria, type LinhaCategoriaMes,
} from "@/lib/composicaoCategorias";

/* A célula do print: Assessorias & Consultorias, Jul 26, -R$ 26.015,59. */
const lanc = (
  codigo: string, descricao: string, valor: number,
): LinhaFiltravel => ({
  contraparte: "X", cnpj_cpf: null, titulo: null, documento: null,
  categoria_codigo: codigo, categoria_descricao: descricao, valor,
});

const CELULA: LinhaFiltravel[] = [
  lanc("2.07.03", "Consultorias - Tecnologia", -2815.0),
  lanc("2.04.11", "Advocacia - Administrativo", -5999.99),
  lanc("2.07.03", "Consultorias - Tecnologia", -2186.7),
  lanc("2.04.09", "Consultorias - Administrativo", -2057.91),
  lanc("2.04.09", "Consultorias - Administrativo", -11262.0),
  lanc("2.04.10", "Contabilidade - Administrativo", -1693.99),
];

const hist = (mes: string, categoria: string, valor: number, lancamentos = 1): LinhaCategoriaMes =>
  ({ mes, categoria, valor, lancamentos });

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

describe("montarComposicao", () => {
  it("soma exatamente a célula — a composição é a mesma lista que está na tela", () => {
    const c = montarComposicao(categoriasDaCelula(CELULA), [], "Jul-26");
    const soma = c.categorias.reduce((s, x) => s + x.valor, 0);
    expect(soma).toBeCloseTo(-26015.59, 2);
    expect(c.quantas).toBe(4);
  });

  it("ordena pela fatia, e as fatias somam 100%", () => {
    const c = montarComposicao(categoriasDaCelula(CELULA), [], "Jul-26");
    expect(c.categorias.map((x) => x.descricao)).toEqual([
      "Consultorias - Administrativo",   // -13.319,91
      "Advocacia - Administrativo",      //  -5.999,99
      "Consultorias - Tecnologia",       //  -5.001,70
      "Contabilidade - Administrativo",  //  -1.693,99
    ]);
    expect(c.categorias[0].peso).toBeCloseTo(13319.91 / 26015.59, 6);
    expect(c.categorias.reduce((s, x) => s + x.peso, 0)).toBeCloseTo(1, 6);
  });

  it("junta lançamentos da mesma categoria e guarda quantos são", () => {
    const c = montarComposicao(categoriasDaCelula(CELULA), [], "Jul-26");
    const tec = c.categorias.find((x) => x.descricao === "Consultorias - Tecnologia")!;
    expect(tec.lancamentos).toBe(2);
    expect(tec.valor).toBeCloseTo(-5001.7, 2);
    expect(tec.codigos).toEqual(["2.07.03"]);
  });

  it("sem histórico não inventa veredito: nada é 'novo' na primeira vez que se olha", () => {
    const c = montarComposicao(categoriasDaCelula(CELULA), [], "Jul-26");
    expect(c.temHistorico).toBe(false);
    expect(c.novas).toBe(0);
    expect(c.sumidas).toBe(0);
    expect(resumoComposicao(c)).toBe("4 categorias");
  });

  it("descarta o mês em foco que vier na RPC — a célula é a fonte", () => {
    // A RPC diz -99 mil para Advocacia em Jul; a lista diz -5.999,99. Vence a lista.
    const c = montarComposicao(
      categoriasDaCelula(CELULA),
      [hist("Jul-26", "Advocacia - Administrativo", -99000), hist("Jun-26", "Advocacia - Administrativo", -5999.99)],
      "Jul-26",
    );
    const adv = c.categorias.find((x) => x.descricao === "Advocacia - Administrativo")!;
    expect(adv.valor).toBeCloseTo(-5999.99, 2);
    expect(adv.situacao).toBe("igual");
  });

  it("categoria que caiu é favorável: gastar menos é bom, mesmo com o número subindo", () => {
    const c = montarComposicao(
      categoriasDaCelula(CELULA),
      [hist("Jun-26", "Consultorias - Tecnologia", -18000, 3)],
      "Jul-26",
    );
    const tec = c.categorias.find((x) => x.descricao === "Consultorias - Tecnologia")!;
    expect(tec.situacao).toBe("caiu");
    expect(tec.favoravel).toBe(true);
    expect(Math.round((tec.pct ?? 0) * -100)).toBe(72);
  });

  it("categoria que sumiu entra na tabela, sem fatia e sem chave de filtro", () => {
    const c = montarComposicao(
      categoriasDaCelula(CELULA),
      [hist("Jun-26", "Auditoria - Administrativo", -40000, 1)],
      "Jul-26",
    );
    const sumida = c.categorias.find((x) => x.descricao === "Auditoria - Administrativo")!;
    expect(sumida.situacao).toBe("sumiu");
    expect(sumida.valor).toBe(0);
    expect(sumida.peso).toBe(0);
    expect(sumida.chaves).toEqual([]);
    // Vai para o fim: não compõe a linha, explica a queda dela.
    expect(c.categorias.at(-1)?.descricao).toBe("Auditoria - Administrativo");
    expect(c.quantas).toBe(4);
    expect(c.sumidas).toBe(1);
  });

  it("categoria anual é 'voltou', não 'nova'", () => {
    const c = montarComposicao(
      categoriasDaCelula(CELULA),
      [
        hist("Jun-26", "Consultorias - Tecnologia", -1000),
        hist("Aug-25", "Contabilidade - Administrativo", -1500),
      ],
      "Jul-26",
    );
    const cont = c.categorias.find((x) => x.descricao === "Contabilidade - Administrativo")!;
    expect(cont.situacao).toBe("voltou");
    expect(cont.visto).toBe("Aug-25");
  });

  it("dois códigos com a mesma descrição viram uma linha só, com as duas chaves", () => {
    const mistura = [...CELULA, lanc("2.04.99", "Consultorias - Administrativo", -1000)];
    const c = montarComposicao(categoriasDaCelula(mistura), [], "Jul-26");
    const adm = c.categorias.find((x) => x.descricao === "Consultorias - Administrativo")!;
    expect(adm.valor).toBeCloseTo(-14319.91, 2);
    expect(adm.chaves.sort()).toEqual(["2.04.09", "2.04.99"]);
    expect(adm.codigos.sort()).toEqual(["2.04.09", "2.04.99"]);
  });

  it("estorno não faz a fatia estourar 100%", () => {
    const comEstorno = [...CELULA, lanc("2.04.50", "Estorno", 30000)];
    const c = montarComposicao(categoriasDaCelula(comEstorno), [], "Jul-26");
    for (const x of c.categorias) expect(x.peso).toBeLessThanOrEqual(1);
    expect(c.categorias.reduce((s, x) => s + x.peso, 0)).toBeCloseTo(1, 6);
  });
});

describe("filtro a partir da composição", () => {
  it("marca e desmarca as duas chaves da mesma descrição de uma vez", () => {
    const mistura = [...CELULA, lanc("2.04.99", "Consultorias - Administrativo", -1000)];
    const c = montarComposicao(categoriasDaCelula(mistura), [], "Jul-26");
    const adm = c.categorias.find((x) => x.descricao === "Consultorias - Administrativo")!;

    const marcadas = alternarCategoriaNoFiltro(adm, new Set());
    expect([...marcadas].sort()).toEqual(["2.04.09", "2.04.99"]);
    expect(categoriaMarcada(adm, marcadas)).toBe(true);
    expect(alternarCategoriaNoFiltro(adm, marcadas).size).toBe(0);
  });

  it("quem sumiu não mexe no filtro — filtrar por ela esvaziaria a lista", () => {
    const c = montarComposicao(
      categoriasDaCelula(CELULA),
      [hist("Jun-26", "Auditoria - Administrativo", -40000)],
      "Jul-26",
    );
    const sumida = c.categorias.find((x) => x.descricao === "Auditoria - Administrativo")!;
    const antes = new Set(["2.04.09"]);
    expect(alternarCategoriaNoFiltro(sumida, antes)).toBe(antes);
    expect(categoriaMarcada(sumida, new Set())).toBe(false);
  });
});

describe("resumo e hover", () => {
  it("conta só quem compõe a célula, e diz quem entrou e quem saiu", () => {
    const c = montarComposicao(
      categoriasDaCelula(CELULA),
      [
        hist("Jun-26", "Auditoria - Administrativo", -40000),
        hist("Jun-26", "Advocacia - Administrativo", -5999.99),
      ],
      "Jul-26",
    );
    expect(resumoComposicao(c)).toBe("4 categorias · 3 novas · 1 sumiu");
  });

  it("o hover diz os dois meses — o chip sozinho não informa sobre o quê", () => {
    const c = montarComposicao(
      categoriasDaCelula(CELULA),
      [hist("Jun-26", "Consultorias - Tecnologia", -18000, 3)],
      "Jul-26",
    );
    const tec = c.categorias.find((x) => x.descricao === "Consultorias - Tecnologia")!;
    const texto = explicarCategoria(tec, c, moeda);
    expect(texto).toContain("Jun 26");
    expect(texto).toContain("Jul 26");
    expect(texto).toContain("caiu");
    expect(texto).toContain("do movimento da linha");
  });
});
