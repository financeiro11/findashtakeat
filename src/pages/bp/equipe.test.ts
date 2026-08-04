import { describe, expect, it } from "vitest";
import { parsearEquipe, recortar, type Celula } from "./equipe";

/**
 * Fixture no formato real da aba Equipe: rótulo na 1ª coluna, premissas do
 * cargo nas colunas 2..6 (Rem. Base, Quantidade, Início, Modelo, Tipo) e os 12
 * meses a partir da coluna 8. Reproduz as armadilhas da planilha de verdade —
 * o mini-quadro de "Modelos de contratação" que repete os cabeçalhos, cargo com
 * quantidade fixa que só entra no meio do ano, cargo "var." com a quantidade na
 * sub-linha de baixo, e o bloco "Headcount Equipes" no fim.
 */
function linha(rotulo: string, premissas: Celula[] = [], meses: (number | null)[] = []): Celula[] {
  const l: Celula[] = Array(20).fill(null);
  l[0] = rotulo;
  premissas.forEach((v, i) => { l[2 + i] = v ?? null; });
  meses.forEach((v, i) => { l[8 + i] = v ?? null; });
  return l;
}
const doze = (v: number) => Array(12).fill(v) as number[];
const aPartirDe = (mes: number, v: number) => Array.from({ length: 12 }, (_, i) => (i >= mes ? v : 0));

const modelosDeContratacao = () => {
  // Só dois dos cinco cabeçalhos, e em colunas diferentes: não pode ser
  // confundido com a linha de premissas do cargo.
  const l = linha("Modelos de contratação");
  l[4] = "Modelo";
  l[5] = "Início";
  l[6] = "Multiplicador";
  return l;
};

const PLANILHA: Celula[][] = [
  linha("Data", [], doze(46023)),
  linha("Ano Calendário", [], doze(2026)),
  linha("Mês Calendário", [], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  linha("Premissas de Despesas e Custos com Pessoal", ["Rem. Base", "Quantidade", "Início", "Modelo", "Tipo"], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  linha("# Headcount", [], doze(10)),
  modelosDeContratacao(),
  linha("PJ", [null, null, "PJ", 0, 1], doze(1)),
  linha("Custo Total Equipe", [], doze(40000)),

  linha("4.1.Equipe Administrativa", [], doze(-30000)),
  linha("Executivos", [], doze(-25000)),
  linha("CEO", [25000, 1, 1, "PJ", "diretoria"], doze(-25000)),
  linha("CFO", [0, 0, 100, "PJ", "diretoria"], doze(0)),
  linha("Backoffice", [], doze(-5000)),
  linha("Head Pessoas", [10000, 1, 2, "PJ", "key"], aPartirDe(1, -10000)),
  linha("Analista Automações", [4750, "var.", 0, "PJ", "base"], [...Array(6).fill(-9500), ...Array(6).fill(-14250)]),
  linha("# Quantidade", [null, null, null, null, "Min."], [...Array(6).fill(2), ...Array(6).fill(3)]),
  linha("# MRR", [null, null, null, null, "Max."], doze(500000)),

  linha("4.5.Equipe Tecnologia", [], doze(-3500)),
  linha("Tech", [], doze(-3500)),
  // "var." sem sub-linha "# Quantidade": a quantidade sai do custo ÷ rem. base.
  linha("Estagiário", [1750, "var.", 0, "Estag", "base"], doze(-3500)),

  linha("4.6.Benefícios", [], doze(-5200)),
  linha("$ Incremental por Trigger Extra", [], doze(520)),
  linha("Kit Novos Colaboradores", [], doze(-4500)),
  linha("$ Incremental por Trigger Extra", [], doze(4500)),

  linha("Headcount Geral", [], doze(10)),
  linha("Contratações", [], [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
  linha("Headcount Equipes", [], doze(10)),
  linha("Administrativo", [], [4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6]),
];

describe("parsearEquipe", () => {
  const eq = parsearEquipe(PLANILHA)!;
  const achar = (cargo: string) => eq.quadro.find((c) => c.cargo === cargo)!;

  it("lê o quadro de todas as áreas, não só da primeira", () => {
    expect([...new Set(eq.quadro.map((c) => c.area))]).toEqual(["Administrativo", "Tecnologia"]);
    expect(eq.quadro).toHaveLength(5);
  });

  it("guarda a área e o grupo de cada cargo", () => {
    expect(achar("CEO")).toMatchObject({ area: "Administrativo", grupo: "Executivos" });
    expect(achar("Head Pessoas")).toMatchObject({ area: "Administrativo", grupo: "Backoffice" });
    expect(achar("Estagiário")).toMatchObject({ area: "Tecnologia", grupo: "Tech" });
  });

  it("lê remuneração, modelo e índice de reajuste", () => {
    expect(achar("CEO")).toMatchObject({ remBase: 25_000, modelo: "PJ", reajuste: "diretoria" });
    expect(achar("Estagiário").modelo).toBe("Estágio");
    expect(achar("Analista Automações").reajuste).toBe("base");
  });

  it("quantidade fixa só entra no mês de Início", () => {
    const head = achar("Head Pessoas");
    expect(head.qtdJan).toBe(0);
    expect(head.qtdMes[1]).toBe(1);
    expect(head.qtdDez).toBe(1);
    expect(head.entrada).toBe(1);
  });

  it("cargo que não abre no ano fica zerado, sem mês de entrada", () => {
    expect(achar("CFO")).toMatchObject({ qtdJan: 0, qtdDez: 0, entrada: null, remBase: null });
  });

  it("quantidade 'var.' vem da sub-linha # Quantidade", () => {
    expect(achar("Analista Automações").qtdMes).toEqual([2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
  });

  it("sem sub-linha, deriva a quantidade do custo ÷ remuneração base", () => {
    expect(achar("Estagiário").qtdMes).toEqual(doze(2));
  });

  it("não confunde o mini-quadro de modelos de contratação com um cargo", () => {
    expect(eq.quadro.some((c) => c.cargo === "PJ")).toBe(false);
    expect(eq.quadro.some((c) => c.cargo === "Custo Total Equipe")).toBe(false);
  });

  it("soma o custo do ano sempre positivo", () => {
    expect(achar("CEO").custoAno).toBe(25_000 * 12);
    expect(achar("Head Pessoas").custoAno).toBe(10_000 * 11);
  });

  it("lê headcount por área do bloco final", () => {
    expect(eq.headcountPorArea.Administrativo).toEqual([4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6]);
  });

  it("área ausente no bloco final sai da soma do quadro", () => {
    expect(eq.headcountPorArea.Tecnologia).toEqual(doze(2));
    expect(eq.headcountPorArea.Comercial).toEqual(doze(0));
  });

  it("lê headcount geral, contratações, benefício e kit", () => {
    expect(eq.headcountGeral).toEqual(doze(10));
    expect(eq.contratacoes).toEqual([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(eq.beneficioPorPessoa).toBe(520);
    expect(eq.custoKitOnboarding).toBe(4_500);
  });

  it("devolve null quando a aba não é a Equipe", () => {
    expect(parsearEquipe(null)).toBeNull();
    expect(parsearEquipe([])).toBeNull();
    expect(parsearEquipe([[linha("Receita Bruta", [], doze(1000))]])).toBeNull();
  });
});

describe("recortar", () => {
  it("corta linhas e colunas vazias das bordas", () => {
    // A aba Operação declara milhares de colunas de nada; sem o recorte a
    // planilha inteira não caberia no banco.
    expect(recortar([["a", 1, null, null], [null, null, null, null], ["b", 2, null, null]]))
      .toEqual([["a", 1], [null, null], ["b", 2]]);
  });

  it("preenche buraco de linha curta com null e aguenta entrada inválida", () => {
    expect(recortar([["a", 1, 2], ["b"]])).toEqual([["a", 1, 2], ["b", null, null]]);
    expect(recortar(null)).toEqual([]);
    expect(recortar([[], [null]])).toEqual([]);
  });
});
