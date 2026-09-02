import { describe, it, expect } from "vitest";
import { contarPorFrente, mesEmFechamento, montarFechamento } from "./fechamento";
import type { Ausencia, Recorde } from "./justificativas";

/* ---------------------------------------------------------------------------
 * A lista de pendências do mês em curso.
 *
 * O que os testes protegem, nesta ordem de importância:
 *   1. O painel apontar para o mês certo — o último com dado de gente, não a
 *      última coluna (o tracker traz meses à frente pela metade).
 *   2. A categoria órfã NOVA não se misturar com a de sempre. Sem isso o painel
 *      repete R$ 1,6 M de "Transferência de Entrada*" todo mês e é desligado.
 *   3. A ordem ser severidade e depois dinheiro.
 * ------------------------------------------------------------------------- */

const serie = (over: Partial<Ausencia["serie"]> = {}): Ausencia["serie"] => ({
  janela: 12, meses: 12, mediana: 17_014, mad: 4_000, z: null,
  extremo: null, maximo: 35_215, minimo: 3_825, recorrente: true,
  ausente: true, zerada: true, ultimoMes: "Jul-26", ultimoValor: 17_014,
  ...over,
});

/* `toLocaleString` de moeda em pt-BR mete espaço RÍGIDO depois de "R$". Isso é
   certo na tela (é o que o idioma faz) e invisível num teste: comparar com
   espaço comum falha sem que se entenda por quê. */
const semRigido = (s: string) => s.replace(/ /g, " ");

const vazio = {
  mes: "Aug-26",
  rotuloMes: (k: string) => k,
  ausencias: [] as Ausencia[],
  orfas: [],
  suspeitas: [],
  totais: [],
  recordes: [] as Recorde[],
};

describe("montarFechamento", () => {
  it("a ausência vira pendência alta, com o que a rubrica costuma trazer", () => {
    const [p] = montarFechamento({
      ...vazio,
      ausencias: [{ rubrica: "(+) Receita financeira", mes: "Aug-26", despesa: false, serie: serie() }],
    });
    expect(p.frente).toBe("ausencia");
    expect(p.severidade).toBe("alta");
    expect(p.rubrica).toBe("(+) Receita financeira");
    expect(p.valor).toBe(17_014);
    expect(p.detalhe).toContain("nos 12 meses anteriores");
    expect(p.detalhe).toContain("Jul-26");
  });

  it("categoria órfã NOVA é alta; a de sempre é média — é o que salva o painel", () => {
    /* Números reais de Jul/26: "Transferência de Entrada*" vem há 3 meses e está
       certa onde está (transferência entre contas próprias não é resultado);
       "3.2.2. Frete - Operação" apareceu agora e ninguém decidiu nada sobre ela. */
    const ps = montarFechamento({
      ...vazio,
      mes: "Jul-26",
      orfas: [
        { mes: "Jul-26", categoria: "Transferência de Entrada*", quantidade: 32, valor: 1_284_259, meses_antes: 3 },
        { mes: "Jul-26", categoria: "3.2.2. Frete - Operação", quantidade: 27, valor: -1_139, meses_antes: 0 },
      ],
    });
    const nova = ps.find((p) => p.titulo.includes("Frete"))!;
    const sempre = ps.find((p) => p.titulo.includes("Transferência"))!;
    expect(nova.severidade).toBe("alta");
    expect(sempre.severidade).toBe("media");
    expect(nova.titulo).toContain("Categoria nova");
    expect(sempre.detalhe).toContain("3 dos 6 meses anteriores");
    // E a nova vem PRIMEIRO, apesar de valer mil vezes menos.
    expect(ps[0]).toBe(nova);
  });

  it("dentro da mesma severidade, manda o dinheiro", () => {
    const ps = montarFechamento({
      ...vazio,
      ausencias: [
        { rubrica: "Pequena", mes: "Aug-26", despesa: false, serie: serie({ mediana: 2_000 }) },
        { rubrica: "Grande", mes: "Aug-26", despesa: false, serie: serie({ mediana: 900_000 }) },
      ],
    });
    expect(ps.map((p) => p.rubrica)).toEqual(["Grande", "Pequena"]);
  });

  it("ignora o que é de outro mês", () => {
    expect(montarFechamento({
      ...vazio,
      ausencias: [{ rubrica: "X", mes: "Jul-26", despesa: false, serie: serie() }],
    })).toHaveLength(0);
  });

  it("o recorde diz contra o que está batendo", () => {
    const [p] = montarFechamento({
      ...vazio,
      recordes: [{
        rubrica: "Servidor", mes: "Aug-26", despesa: true, valor: -190_000,
        serie: serie({ extremo: "maior", maximo: 140_000, mediana: 115_000, ausente: false, zerada: false }),
      }],
    });
    expect(p.frente).toBe("recorde");
    expect(p.severidade).toBe("media");
    expect(p.titulo).toContain("maior valor em 12 meses");
    // Despesa chega negativa do blob; o texto lê em módulo, como o comentário.
    expect(semRigido(p.detalhe)).toContain("R$ 190.000");
    expect(semRigido(p.detalhe)).toContain("R$ 140.000");
  });

  it("o total que não fecha é alta, e vale a DIFERENÇA e não o total", () => {
    const [p] = montarFechamento({
      ...vazio,
      totais: [{ rubrica: "EBITDA", mes: "Aug-26", calculado: 812_000, guardado: 833_000, diferenca: 21_000 }],
    });
    expect(p.severidade).toBe("alta");
    expect(p.valor).toBe(21_000);
  });
});

describe("contarPorFrente", () => {
  it("agrupa e ordena por dinheiro", () => {
    const ps = montarFechamento({
      ...vazio,
      ausencias: [{ rubrica: "A", mes: "Aug-26", despesa: false, serie: serie({ mediana: 5_000 }) }],
      orfas: [{ mes: "Aug-26", categoria: "T*", quantidade: 1, valor: 900_000, meses_antes: 4 }],
    });
    expect(contarPorFrente(ps).map((c) => c.frente)).toEqual(["sem_de_para", "ausencia"]);
  });
});

describe("mesEmFechamento", () => {
  const cols = ["Mar-26", "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26"];

  it("pula o mês que o tracker trouxe pela metade", () => {
    // O caso real: Sep-26 da DRE com 12 de 61 células. É a última coluna, e não
    // é o mês que está fechando.
    const cheias: Record<string, number> = {
      "Mar-26": 60, "Apr-26": 61, "May-26": 60, "Jun-26": 62, "Jul-26": 64, "Aug-26": 55, "Sep-26": 12,
    };
    expect(mesEmFechamento(cols, (c) => cheias[c] ?? 0)).toBe("Aug-26");
  });

  it("quando o último mês está cheio, é ele mesmo", () => {
    expect(mesEmFechamento(cols, () => 60)).toBe("Sep-26");
  });

  it("base de um mês só devolve o que tem", () => {
    expect(mesEmFechamento(["Jan-26"], () => 3)).toBe("Jan-26");
    expect(mesEmFechamento([], () => 0)).toBeNull();
  });
});
