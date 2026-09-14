import { describe, it, expect } from "vitest";
import {
  fmtDias, fmtHoras, filtrarRecorte, lerHoras, mediana, ordenarRecorte, percentual,
  pertenceAoRecorte, resumoDoRecorte, valorDaMedida, type TarefaDaSemana,
} from "./recorte";

function t(p: Partial<TarefaDaSemana> & { id: string }): TarefaDaSemana {
  return {
    titulo: p.id, natureza: "Operacional", area: "Tesouraria", rotina: false,
    cat_origem: "auto", pessoa: "Júlia", prioridade: "Média", subtarefas: 0,
    lead_dias: 1, peso: 30, horas: 2, horas_apontadas: null, horas_board: 2,
    horas_abertas: 2, horas_paradas: 0, familia: "remessa",
    ...p,
  };
}

describe("pertenceAoRecorte", () => {
  const linha = t({ id: "a", area: "Tesouraria", natureza: "Automação", pessoa: "Henrique", rotina: true });

  it("casa pelo valor do eixo", () => {
    expect(pertenceAoRecorte(linha, { eixo: "area", valor: "Tesouraria", titulo: "" })).toBe(true);
    expect(pertenceAoRecorte(linha, { eixo: "area", valor: "Fechamento", titulo: "" })).toBe(false);
    expect(pertenceAoRecorte(linha, { eixo: "pessoa", valor: "Henrique", titulo: "" })).toBe(true);
    expect(pertenceAoRecorte(linha, { eixo: "natureza", valor: "Automação", titulo: "" })).toBe(true);
    expect(pertenceAoRecorte(linha, { eixo: "rotina", titulo: "" })).toBe(true);
  });

  /* O payload grava `area: null` para tarefa sem classificação, e o card
     correspondente é clicável do mesmo jeito. Se nulo e "" não casassem, esse
     card abriria vazio — que é exatamente o caso que a pessoa quer inspecionar. */
  it("trata nulo, vazio e ausente como o mesmo rótulo", () => {
    const semArea = t({ id: "b", area: null });
    expect(pertenceAoRecorte(semArea, { eixo: "area", valor: null, titulo: "" })).toBe(true);
    expect(pertenceAoRecorte(semArea, { eixo: "area", valor: "", titulo: "" })).toBe(true);
    expect(pertenceAoRecorte(semArea, { eixo: "area", valor: "Tesouraria", titulo: "" })).toBe(false);
  });

  it("os eixos de ordenação não filtram — são a semana inteira", () => {
    for (const eixo of ["todas", "lead", "horas", "peso"] as const) {
      expect(pertenceAoRecorte(linha, { eixo, titulo: "" })).toBe(true);
    }
  });
});

describe("ordenarRecorte", () => {
  const linhas = [
    t({ id: "leve",  horas: 1,  peso: 10, lead_dias: 9 }),
    t({ id: "longa", horas: 40, peso: 20, lead_dias: 2 }),
    t({ id: "pesada", horas: 5, peso: 99, lead_dias: 1 }),
  ];

  it("lead ordena por arrasto, peso por complexidade, o resto por tempo", () => {
    expect(ordenarRecorte(linhas, "lead").map((l) => l.id)).toEqual(["leve", "longa", "pesada"]);
    expect(ordenarRecorte(linhas, "peso").map((l) => l.id)).toEqual(["pesada", "longa", "leve"]);
    expect(ordenarRecorte(linhas, "todas").map((l) => l.id)).toEqual(["longa", "pesada", "leve"]);
  });

  it("não mexe no array recebido", () => {
    const antes = linhas.map((l) => l.id);
    ordenarRecorte(linhas, "peso");
    expect(linhas.map((l) => l.id)).toEqual(antes);
  });

  /* Empate sem desempate estável faria a lista trocar de ordem a cada
     re-render — e o painel re-renderiza a cada hora apontada. */
  it("desempata pelo título", () => {
    const iguais = [t({ id: "z", titulo: "Zebra" }), t({ id: "a", titulo: "Abacate" })];
    expect(ordenarRecorte(iguais, "todas").map((l) => l.titulo)).toEqual(["Abacate", "Zebra"]);
  });
});

describe("filtrarRecorte", () => {
  it("filtra e ordena numa passada", () => {
    const linhas = [
      t({ id: "1", area: "Tesouraria", horas: 3 }),
      t({ id: "2", area: "Fechamento", horas: 9 }),
      t({ id: "3", area: "Tesouraria", horas: 8 }),
    ];
    expect(filtrarRecorte(linhas, { eixo: "area", valor: "Tesouraria", titulo: "" }).map((l) => l.id))
      .toEqual(["3", "1"]);
  });
});

describe("mediana", () => {
  /* Tem de ser a mesma conta do `percentile_cont(0.5)` do Postgres, que
     interpola entre os dois centrais: com 4 valores o card mostra 4.5 e o
     painel precisa mostrar 4.5, senão a conferência acusa erro inexistente. */
  it("interpola entre os dois centrais, como o Postgres", () => {
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(mediana([4, 5])).toBe(4.5);
    expect(mediana([7])).toBe(7);
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([])).toBe(0);
  });
});

describe("resumoDoRecorte", () => {
  it("soma o que o card mostra e conta quantas horas são apontadas", () => {
    const r = resumoDoRecorte([
      t({ id: "1", horas: 2.5, peso: 30, lead_dias: 1, rotina: true, horas_apontadas: 2.5 }),
      t({ id: "2", horas: 0.2, peso: 45, lead_dias: 4 }),
      t({ id: "3", horas: 0.1, peso: 15, lead_dias: 2, rotina: true }),
    ]);
    expect(r.n).toBe(3);
    expect(r.peso).toBe(90);
    expect(r.rotinas).toBe(2);
    expect(r.leadMediana).toBe(2);
    expect(r.apontadas).toBe(1);
    expect(r.horasApontadas).toBe(2.5);
    /* 2.5 + 0.2 + 0.1 dá 2.8000000000000003 em ponto flutuante, e o painel
       escreveria isso ao lado do 2,8 do card. */
    expect(r.horas).toBe(2.8);
  });

  it("aguenta lista vazia", () => {
    expect(resumoDoRecorte([])).toMatchObject({ n: 0, horas: 0, leadMediana: 0, apontadas: 0 });
  });
});

describe("medida e percentual", () => {
  it("troca o denominador sem trocar o item", () => {
    const item = { n: 6, horas: 12.5 };
    expect(valorDaMedida(item, "tarefas")).toBe(6);
    expect(valorDaMedida(item, "tempo")).toBe(12.5);
    /* Recorte antigo, gravado antes de a hora existir no payload: vale zero em
       tempo, e não NaN — que viraria barra de largura "NaN%" na tela. */
    expect(valorDaMedida({ n: 3 }, "tempo")).toBe(0);
  });

  it("percentual arredonda e não divide por zero", () => {
    expect(percentual(1, 3)).toBe(33);
    expect(percentual(2, 0)).toBe(0);
  });
});

describe("lerHoras", () => {
  it("aceita vírgula, ponto e o 'h' de quem digita a unidade", () => {
    expect(lerHoras("1,5")).toBe(1.5);
    expect(lerHoras("1.5")).toBe(1.5);
    expect(lerHoras(" 2h ")).toBe(2);
    expect(lerHoras("0.25")).toBe(0.3);
  });

  it("campo vazio apaga o apontamento (volta à estimativa)", () => {
    expect(lerHoras("")).toBeNull();
    expect(lerHoras("   ")).toBeNull();
  });

  /* `undefined` e `null` precisam ser distintos: se o texto ilegível virasse
     "apagar", um dedo errado tiraria a hora que alguém apontou. */
  it("recusa o que não é número, sem apagar nada", () => {
    expect(lerHoras("abc")).toBeUndefined();
    expect(lerHoras("-3")).toBeUndefined();
    expect(lerHoras("5000")).toBeUndefined();
  });
});

describe("formatação", () => {
  it("escreve o tempo como se fala", () => {
    expect(fmtHoras(45.2)).toBe("45h");
    expect(fmtHoras(8.25)).toBe("8,3h");
    expect(fmtHoras(0.5)).toBe("30min");
    expect(fmtHoras(0)).toBe("0h");
    expect(fmtHoras(null)).toBe("0h");
  });

  it("o dia sai com a vírgula do pt-BR", () => {
    expect(fmtDias(2)).toBe("2d");
    expect(fmtDias(4.5)).toBe("4,5d");
  });
});
