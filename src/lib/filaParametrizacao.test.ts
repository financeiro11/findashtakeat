import { describe, expect, it } from "vitest";
import type { Candidato } from "@/lib/apelidos";
import {
  alternarNoSet, categoriaDaContraparte, categoriasDaFila, colunaFiltrada,
  filtrarFila, filtroFilaInicial, lerNumero, limparColuna, mesesDaFila,
  quantasColunasFiltradas, rotuloMes, SEM_CATEGORIA,
  type EstadoPlanilha, type FiltroFila,
} from "@/lib/filaParametrizacao";

const c = (p: Partial<Candidato>): Candidato => ({
  origem: "omie", nome: "X", documento: null, categoria: null, cidade: null,
  lancamentos: 1, total: 100, primeira: "2026-05-10", ultima: "2026-07-20", ...p,
});

/** Ninguém tem evidência, salvo quando o teste disser o contrário. */
const nada = (): EstadoPlanilha => "nada";

const com = (p: Partial<FiltroFila>): FiltroFila => ({ ...filtroFilaInicial(), ...p });

describe("filtroFilaInicial", () => {
  it("devolve conjuntos novos a cada chamada", () => {
    // Se fosse constante de módulo, marcar aqui vazaria para a próxima tela.
    const a = filtroFilaInicial();
    a.categorias.add("Softwares");
    expect(filtroFilaInicial().categorias.size).toBe(0);
  });

  it("não corta nada", () => {
    const fila = [c({ nome: "A" }), c({ nome: "B" })];
    expect(filtrarFila(fila, filtroFilaInicial(), nada)).toHaveLength(2);
    expect(quantasColunasFiltradas(filtroFilaInicial())).toBe(0);
  });
});

describe("categoria", () => {
  it("contraparte sem categoria cai num balde filtrável", () => {
    expect(categoriaDaContraparte(c({ categoria: null }))).toBe(SEM_CATEGORIA);
    expect(categoriaDaContraparte(c({ categoria: "   " }))).toBe(SEM_CATEGORIA);
    expect(categoriaDaContraparte(c({ categoria: " Softwares " }))).toBe("Softwares");
  });

  it("as opções vêm ordenadas pelo que mais pesa, com o balde junto", () => {
    const fila = [
      c({ nome: "A", categoria: "Softwares", total: 100 }),
      c({ nome: "B", categoria: null, total: 900 }),
      c({ nome: "C", categoria: "Softwares", total: 300 }),
    ];
    expect(categoriasDaFila(fila)).toEqual([
      { valor: SEM_CATEGORIA, lancamentos: 1, total: 900 },
      { valor: "Softwares", lancamentos: 2, total: 400 },
    ]);
  });

  it("marcar categoria deixa passar só ela; vazio é 'todas', não 'nenhuma'", () => {
    const fila = [c({ nome: "A", categoria: "Softwares" }), c({ nome: "B", categoria: "Fretes" })];
    expect(filtrarFila(fila, com({ categorias: new Set(["Softwares"]) }), nada).map((x) => x.nome))
      .toEqual(["A"]);
    expect(filtrarFila(fila, com({ categorias: new Set() }), nada)).toHaveLength(2);
  });
});

describe("faixas de número", () => {
  it("lado nulo é lado aberto", () => {
    const fila = [c({ nome: "A", total: 50 }), c({ nome: "B", total: 5000 })];
    expect(filtrarFila(fila, com({ totalMin: 1000 }), nada).map((x) => x.nome)).toEqual(["B"]);
    expect(filtrarFila(fila, com({ totalMax: 1000 }), nada).map((x) => x.nome)).toEqual(["A"]);
    expect(filtrarFila(fila, com({ totalMin: 40, totalMax: 60 }), nada).map((x) => x.nome)).toEqual(["A"]);
  });

  it("os limites entram na faixa", () => {
    const fila = [c({ nome: "A", lancamentos: 3 })];
    expect(filtrarFila(fila, com({ lctosMin: 3, lctosMax: 3 }), nada)).toHaveLength(1);
  });
});

describe("período", () => {
  /* O ponto do módulo: a contraparte tem INTERVALO, não data. */
  const fila = [
    c({ nome: "recorrente", primeira: "2026-05-02", ultima: "2026-07-28" }),
    c({ nome: "so-maio", primeira: "2026-05-02", ultima: "2026-05-09" }),
    c({ nome: "so-julho", primeira: "2026-07-03", ultima: "2026-07-03" }),
  ];

  it("um corte de julho pega quem atravessou mai–jul", () => {
    expect(filtrarFila(fila, com({ mesDe: "2026-07", mesAte: "2026-07" }), nada).map((x) => x.nome))
      .toEqual(["recorrente", "so-julho"]);
  });

  it("'a partir de junho' descarta quem morreu em maio", () => {
    expect(filtrarFila(fila, com({ mesDe: "2026-06" }), nada).map((x) => x.nome))
      .toEqual(["recorrente", "so-julho"]);
  });

  it("'até maio' descarta quem só nasceu em julho", () => {
    expect(filtrarFila(fila, com({ mesAte: "2026-05" }), nada).map((x) => x.nome))
      .toEqual(["recorrente", "so-maio"]);
  });

  it("sem data legível fica de fora do corte — e dentro quando não há corte", () => {
    const sem = [c({ nome: "?", primeira: null, ultima: null })];
    expect(filtrarFila(sem, com({ mesDe: "2026-07" }), nada)).toHaveLength(0);
    expect(filtrarFila(sem, filtroFilaInicial(), nada)).toHaveLength(1);
  });

  it("lista os meses que a fila toca, do mais antigo ao mais novo", () => {
    expect(mesesDaFila(fila)).toEqual(["2026-05", "2026-07"]);
  });
});

describe("o que a planilha diz", () => {
  it("filtra pelo estado que a função de fora informa", () => {
    const fila = [c({ nome: "A" }), c({ nome: "B" }), c({ nome: "C" })];
    const estado = (x: Candidato): EstadoPlanilha =>
      x.nome === "A" ? "proposta" : x.nome === "B" ? "sem_nome" : "nada";
    expect(filtrarFila(fila, com({ planilha: new Set(["proposta"] as EstadoPlanilha[]) }), estado)
      .map((x) => x.nome)).toEqual(["A"]);
    expect(filtrarFila(fila, com({ planilha: new Set(["sem_nome", "nada"] as EstadoPlanilha[]) }), estado)
      .map((x) => x.nome)).toEqual(["B", "C"]);
  });
});

describe("estado dos filtros", () => {
  it("cada coluna acende sozinha e limpa sozinha", () => {
    const f = com({ categorias: new Set(["Softwares"]), totalMin: 10, mesDe: "2026-07" });
    expect(quantasColunasFiltradas(f)).toBe(3);
    expect(colunaFiltrada(f, "categoria")).toBe(true);
    expect(colunaFiltrada(f, "lancamentos")).toBe(false);

    const semTotal = limparColuna(f, "total");
    expect(colunaFiltrada(semTotal, "total")).toBe(false);
    // Limpar uma coluna não pode derrubar as outras.
    expect(colunaFiltrada(semTotal, "categoria")).toBe(true);
    expect(colunaFiltrada(semTotal, "periodo")).toBe(true);
  });

  it("alternar devolve conjunto novo, sem mexer no original", () => {
    const antes = new Set(["a"]);
    expect([...alternarNoSet(antes, "b")]).toEqual(["a", "b"]);
    expect([...alternarNoSet(antes, "a")]).toEqual([]);
    expect([...antes]).toEqual(["a"]);
  });
});

describe("lerNumero", () => {
  it("aceita o número como se lê na tela", () => {
    expect(lerNumero("1200")).toBe(1200);
    // O caso que motivou o parser: Number("1.200") daria 1,2.
    expect(lerNumero("1.200")).toBe(1200);
    expect(lerNumero("1.200.500")).toBe(1200500);
    expect(lerNumero("1.200,50")).toBe(1200.5);
    expect(lerNumero("1200.50")).toBe(1200.5);
    expect(lerNumero("R$ 5.000")).toBe(5000);
  });

  it("devolve null no vazio e no lixo", () => {
    expect(lerNumero("")).toBeNull();
    expect(lerNumero("   ")).toBeNull();
    expect(lerNumero("abc")).toBeNull();
  });

  it("mantém o texto meio digitado significando o mesmo valor", () => {
    // É disto que depende o campo não se reescrever no meio da digitação.
    expect(lerNumero("1.")).toBe(1);
  });
});

describe("rotuloMes", () => {
  it("escreve o mês como a coluna Período escreve", () => {
    expect(rotuloMes("2026-07")).toBe("jul 26");
    expect(rotuloMes("2026-01")).toBe("jan 26");
  });
});
