import { describe, it, expect } from "vitest";
import {
  filtrarLancamentos,
  categoriasDaCelula,
  chaveCategoria,
  casaBusca,
  textoDaLinha,
  filtroVazio,
  filtroInicial,
  type Filtro,
  type LinhaFiltravel,
} from "./filtroLancamentos";

const l = (
  contraparte: string | null,
  valor: number,
  categoria_descricao: string,
  categoria_codigo: string | null = null,
  extra: Partial<LinhaFiltravel> = {},
): LinhaFiltravel => ({
  contraparte, valor, categoria_descricao, categoria_codigo,
  cnpj_cpf: null, titulo: null, documento: null, ...extra,
});

/* Uma célula de verdade: obra, aluguel e o gasto que veio pelo cartão — este
   com a contraparte-balde do ERP, como chega do Omie. */
const CELULA: LinhaFiltravel[] = [
  l("INGRAM MICRO BRASIL LTDA", -79450.54, "4.1.1. Obras", "4.1.1"),
  l("CONSTRUTORA ALFA", -12000, "4.1.1. Obras", "4.1.1"),
  l("IMOBILIARIA BETA", -8500.5, "4.2.1. Aluguel", "4.2.1"),
  l("Lancamento Fatura Cartao", -1500, "4.1.1. Obras", "4.1.1"),
  l(null, 2000, "4.2.1. Aluguel", "4.2.1", { cnpj_cpf: "12345678000199" }),
];

const filtro = (p: Partial<Filtro> = {}): Filtro => ({ ...filtroInicial(), ...p });

describe("busca", () => {
  it("acha por parte do nome, em qualquer ordem de palavras", () => {
    const r = filtrarLancamentos(CELULA, filtro({ busca: "ingram brasil" }));
    expect(r).toHaveLength(1);
    expect(r[0].contraparte).toBe("INGRAM MICRO BRASIL LTDA");
  });

  it("ignora acento e caixa — ninguém digita acento procurando fornecedor", () => {
    const r = filtrarLancamentos([l("IMOBILIÁRIA BETA", -1, "x")], filtro({ busca: "imobiliaria" }));
    expect(r).toHaveLength(1);
  });

  it("varre também o texto que só a tela conhece: o lojista do cartão", () => {
    // No ERP a linha se chama "Lancamento Fatura Cartao"; "Datadog" só existe
    // na observação do título, que a tela lê e passa aqui.
    const extra = (x: LinhaFiltravel) => (x.contraparte === "Lancamento Fatura Cartao" ? "DATADOG" : null);
    const r = filtrarLancamentos(CELULA, filtro({ busca: "datadog" }), extra);
    expect(r).toHaveLength(1);
    expect(r[0].valor).toBe(-1500);
  });

  it("acha pelo documento e pela categoria, não só pelo nome", () => {
    expect(filtrarLancamentos(CELULA, filtro({ busca: "12345678" }))).toHaveLength(1);
    expect(filtrarLancamentos(CELULA, filtro({ busca: "aluguel" }))).toHaveLength(2);
  });

  it("busca em branco não esconde nada", () => {
    expect(filtrarLancamentos(CELULA, filtro({ busca: "   " }))).toHaveLength(CELULA.length);
    expect(casaBusca(textoDaLinha(CELULA[0]), "")).toBe(true);
  });

  it("termo que não existe devolve lista vazia — e não a lista inteira", () => {
    expect(filtrarLancamentos(CELULA, filtro({ busca: "netflix" }))).toHaveLength(0);
  });
});

describe("categorias", () => {
  it("lista o que compõe a célula, da que mais pesa para a que menos pesa", () => {
    const cats = categoriasDaCelula(CELULA);
    expect(cats.map((c) => c.chave)).toEqual(["4.1.1", "4.2.1"]);
    expect(cats[0].lancamentos).toBe(3);
    expect(cats[0].total).toBeCloseTo(-92950.54, 2);
    expect(cats[1].total).toBeCloseTo(-6500.5, 2);
  });

  it("categoria sem código se identifica pela descrição", () => {
    expect(chaveCategoria(l("A", -1, "Sem código no Omie"))).toBe("Sem código no Omie");
  });

  it("nenhuma marcada quer dizer TODAS, não nenhuma", () => {
    expect(filtrarLancamentos(CELULA, filtro({ categorias: new Set() }))).toHaveLength(5);
  });

  it("marcada uma, sobra só ela", () => {
    const r = filtrarLancamentos(CELULA, filtro({ categorias: new Set(["4.2.1"]) }));
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.categoria_codigo === "4.2.1")).toBe(true);
  });

  it("busca e categoria se somam, não se substituem", () => {
    const r = filtrarLancamentos(CELULA, filtro({ busca: "beta", categorias: new Set(["4.2.1"]) }));
    expect(r).toHaveLength(1);
    expect(r[0].contraparte).toBe("IMOBILIARIA BETA");
  });
});

describe("ordenação", () => {
  it("por padrão não reordena: a ordem do RPC é por data, e é ela que se confere", () => {
    expect(filtrarLancamentos(CELULA, filtro()).map((x) => x.valor))
      .toEqual(CELULA.map((x) => x.valor));
  });

  it("'maior' é por TAMANHO — despesa é negativa e o maior gasto tem que vir na frente", () => {
    expect(filtrarLancamentos(CELULA, filtro({ ordem: "maior" })).map((x) => x.valor))
      .toEqual([-79450.54, -12000, -8500.5, 2000, -1500]);
  });

  it("'menor' é o inverso exato", () => {
    expect(filtrarLancamentos(CELULA, filtro({ ordem: "menor" })).map((x) => x.valor))
      .toEqual([-1500, 2000, -8500.5, -12000, -79450.54]);
  });

  it("empate mantém a ordem de origem — a lista não pode dançar a cada render", () => {
    const iguais = [l("A", -100, "x"), l("B", 100, "x"), l("C", -100, "x")];
    expect(filtrarLancamentos(iguais, filtro({ ordem: "maior" })).map((x) => x.contraparte))
      .toEqual(["A", "B", "C"]);
  });

  it("ordena o que sobrou do filtro, não a lista inteira", () => {
    const r = filtrarLancamentos(CELULA, filtro({ categorias: new Set(["4.1.1"]), ordem: "menor" }));
    expect(r.map((x) => x.valor)).toEqual([-1500, -12000, -79450.54]);
  });
});

describe("filtroVazio", () => {
  it("reconhece o estado de partida — é ele que decide mostrar o 'limpar'", () => {
    expect(filtroVazio(filtroInicial())).toBe(true);
    expect(filtroVazio(filtro({ busca: " " }))).toBe(true);
    expect(filtroVazio(filtro({ busca: "a" }))).toBe(false);
    expect(filtroVazio(filtro({ ordem: "maior" }))).toBe(false);
    expect(filtroVazio(filtro({ categorias: new Set(["4.1.1"]) }))).toBe(false);
  });
});
