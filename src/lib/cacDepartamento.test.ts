import { describe, expect, it } from "vitest";
import {
  marcasDepartamento, agruparSuspeitas, leituraDoGrupo, linhaDaMarca, chaveMarcaDepartamento,
  type SuspeitaDepartamento,
} from "./cac";

const s = (over: Partial<SuspeitaDepartamento>): SuspeitaDepartamento => ({
  cod_titulo: 1, mes: 8, cnpj: "11", pessoa: "Leonardo", departamento: "Onboarding e Setup",
  departamento_rh: null, familias_rh: null,
  categoria: "2.01.98", categoria_descricao: "3.2.7.2. Pessoal - Suporte",
  familia: "Suporte", familias_esperadas: ["Onboarding"], valor: 1000,
  linha_id: "sup", linha_rotulo: "Suporte", linha_propria_id: "onb", linha_propria_rotulo: "Onboarding e Setup",
  hist_lancamentos: 0, hist_esperados: 0, severidade: "alta", mes_travado: false,
  decisao_id: null, decisao_escopo: null, decisao_motivo: null,
  ...over,
});

describe("marcasDepartamento", () => {
  it("marca a linha onde o dinheiro caiu, somando e herdando a pior severidade", () => {
    const m = marcasDepartamento([
      s({ cod_titulo: 1, valor: 1000, severidade: "baixa" }),
      s({ cod_titulo: 2, valor: 500, severidade: "alta" }),
    ]);
    expect(m.get(chaveMarcaDepartamento("sup", 8))).toEqual({ alertas: 2, severidade: "alta", valorTotal: 1500 });
    expect(m.has(chaveMarcaDepartamento("onb", 8))).toBe(false);
  });

  it("sem linha que conte, marca a linha de onde o dinheiro faltou", () => {
    // Categoria que o CAC não conta: a matriz tem de dizer que Onboarding está baixo por isso.
    const x = s({ linha_id: null, linha_rotulo: null });
    expect(linhaDaMarca(x)).toBe("onb");
    expect(marcasDepartamento([x]).has(chaveMarcaDepartamento("onb", 8))).toBe(true);
  });

  it("o que alguém deu por normal não marca", () => {
    expect(marcasDepartamento([s({ decisao_id: "d", decisao_escopo: "pessoa" })]).size).toBe(0);
  });
});

describe("agruparSuspeitas", () => {
  it("pessoa × família é um caso, com os meses em ordem", () => {
    const g = agruparSuspeitas([
      s({ cod_titulo: 1, mes: 7 }),
      s({ cod_titulo: 2, mes: 3 }),
      s({ cod_titulo: 3, mes: 7 }),
      s({ cod_titulo: 4, familia: "Sucesso" }),
    ]);
    expect(g).toHaveLength(2);
    const suporte = g.find((x) => x.familia === "Suporte")!;
    expect(suporte.meses).toEqual([3, 7]);
    expect(suporte.valor).toBe(3000);
  });

  it("alta vem antes de baixa mesmo valendo menos", () => {
    const g = agruparSuspeitas([
      s({ cnpj: "a", valor: 50_000, severidade: "baixa" }),
      s({ cnpj: "b", valor: 100, severidade: "alta" }),
    ]);
    expect(g.map((x) => x.cnpj)).toEqual(["b", "a"]);
  });

  it("abertas e ignoradas não se misturam", () => {
    const lista = [s({ cod_titulo: 1 }), s({ cod_titulo: 2, decisao_id: "d" })];
    expect(agruparSuspeitas(lista)[0].lancamentos.map((l) => l.cod_titulo)).toEqual([1]);
    expect(agruparSuspeitas(lista, true)[0].lancamentos.map((l) => l.cod_titulo)).toEqual([2]);
  });
});

describe("leituraDoGrupo", () => {
  it("diz para qual linha o dinheiro foi e de qual saiu", () => {
    const frases = leituraDoGrupo(agruparSuspeitas([s({})])[0]);
    expect(frases.join(" ")).toContain("contam na linha Suporte, e não em Onboarding e Setup");
  });

  it("quem não é de aquisição entrando no CAC é dito como tal", () => {
    const frases = leituraDoGrupo(agruparSuspeitas([
      s({ departamento: "Produto", familias_esperadas: ["Tecnologia"], linha_propria_id: null, linha_propria_rotulo: null }),
    ])[0]);
    expect(frases.join(" ")).toContain("a pessoa não é de aquisição");
  });

  it("lançamento que não muda a linha avisa que o CAC está certo e a DRE não", () => {
    const frases = leituraDoGrupo(agruparSuspeitas([
      s({ categoria: "2.01.96", linha_id: "onb", linha_rotulo: "Onboarding e Setup", severidade: "baixa" }),
    ])[0]);
    expect(frases.join(" ")).toContain("O número do CAC não muda");
    expect(frases.join(" ")).not.toContain("contam na linha");
  });

  it("fora do hábito cita o histórico, e o RH que concorda aponta para o cadastro", () => {
    const frases = leituraDoGrupo(agruparSuspeitas([
      s({
        severidade: "media", hist_lancamentos: 6, hist_esperados: 6,
        departamento_rh: "Suporte", familias_rh: ["Suporte"],
      }),
    ])[0]);
    const texto = frases.join(" ");
    expect(texto).toContain("6 de 6");
    expect(texto).toContain("talvez o desatualizado seja o cadastro");
  });
});
