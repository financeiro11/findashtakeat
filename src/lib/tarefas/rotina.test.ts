import { describe, it, expect } from "vitest";
import {
  Cadencia, ajustarPrazoACadencia, datasDaCadencia, deIso, descreverCadencia,
  descreverCadenciaLonga, ehDataDaCadencia, iso, lerCadencia, proximaData,
} from "./rotina";

const datas = (c: Cadencia, de: string, ate: string) =>
  datasDaCadencia(c, deIso(de), deIso(ate)).map(iso);

describe("datasDaCadencia — mensal", () => {
  it("pega os dias marcados dentro do intervalo", () => {
    expect(datas({ tipo: "mensal", dias: [5, 20] }, "2026-09-01", "2026-10-31"))
      .toEqual(["2026-09-05", "2026-09-20", "2026-10-05", "2026-10-20"]);
  });

  it("dia 31 simplesmente não acontece em fevereiro", () => {
    expect(datas({ tipo: "mensal", dias: [31] }, "2027-01-01", "2027-04-30"))
      .toEqual(["2027-01-31", "2027-03-31"]);
  });

  it("último dia do mês é opção à parte — e acerta fevereiro bissexto", () => {
    expect(datas({ tipo: "mensal", dias: [], ultimo_dia: true }, "2028-01-01", "2028-03-31"))
      .toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
  });

  it("antecipa o fim de semana para a sexta", () => {
    // 05/09/2026 é sábado, 20/09/2026 é domingo.
    expect(datas({ tipo: "mensal", dias: [5, 20], ajuste_fds: "antecipar" }, "2026-09-01", "2026-09-30"))
      .toEqual(["2026-09-04", "2026-09-18"]);
  });

  it("adia o fim de semana para a segunda", () => {
    expect(datas({ tipo: "mensal", dias: [5, 20], ajuste_fds: "adiar" }, "2026-09-01", "2026-09-30"))
      .toEqual(["2026-09-07", "2026-09-21"]);
  });

  it("duas datas empurradas para o mesmo dia útil viram uma só", () => {
    // 05/09 (sáb) e 06/09 (dom) de 2026, ambos antecipados para sexta 04/09.
    expect(datas({ tipo: "mensal", dias: [5, 6], ajuste_fds: "antecipar" }, "2026-09-01", "2026-09-30"))
      .toEqual(["2026-09-04"]);
  });

  it("a data ajustada entra mesmo quando a original cai fora da janela", () => {
    // 01/11/2026 é domingo; adiada para 02/11. Pedindo só novembro, a original
    // está dentro — o caso inverso: pedir a partir de 02/11 com 'antecipar' numa
    // data que sai da janela não deve aparecer.
    expect(datas({ tipo: "mensal", dias: [1], ajuste_fds: "adiar" }, "2026-11-02", "2026-11-30"))
      .toEqual(["2026-11-02"]);
  });
});

describe("datasDaCadencia — semanal e diária", () => {
  it("toda segunda", () => {
    expect(datas({ tipo: "semanal", dias: [1] }, "2026-08-31", "2026-09-21"))
      .toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
  });

  it("segunda e quarta", () => {
    expect(datas({ tipo: "semanal", dias: [1, 3] }, "2026-08-31", "2026-09-06"))
      .toEqual(["2026-08-31", "2026-09-02"]);
  });

  it("todo dia útil pula sábado e domingo", () => {
    expect(datas({ tipo: "diaria", somente_uteis: true }, "2026-09-04", "2026-09-08"))
      .toEqual(["2026-09-04", "2026-09-07", "2026-09-08"]);
  });

  it("todo dia é todo dia", () => {
    expect(datas({ tipo: "diaria" }, "2026-09-04", "2026-09-06"))
      .toEqual(["2026-09-04", "2026-09-05", "2026-09-06"]);
  });
});

describe("proximaData", () => {
  it("conta a partir de hoje, inclusive", () => {
    expect(iso(proximaData({ tipo: "mensal", dias: [5] }, deIso("2026-09-05"))!)).toBe("2026-09-05");
    expect(iso(proximaData({ tipo: "mensal", dias: [5] }, deIso("2026-09-06"))!)).toBe("2026-10-05");
  });

  it("cadência incompleta não tem próxima data", () => {
    expect(proximaData({ tipo: "semanal", dias: [] } as Cadencia, deIso("2026-09-01"))).toBeNull();
    expect(proximaData(null, deIso("2026-09-01"))).toBeNull();
  });
});

describe("ajustarPrazoACadencia — a data da tarefa não pode contradizer a regra", () => {
  const hoje = deIso("2026-08-31");

  it("puxa para o dia da cadência mais próximo A PARTIR do prazo escrito", () => {
    // Caso real: "Relatório Caixa Semanal", dias 6/16/21/26/31, prazo 05/09.
    // Quem escreveu 05/09 queria o dia 6 — não o próximo contado de hoje (31/08).
    const c: Cadencia = { tipo: "mensal", dias: [6, 16, 21, 26, 31] };
    expect(ajustarPrazoACadencia(c, "2026-09-05", hoje)).toBe("2026-09-06");
  });

  it("dia 31 num mês que não tem 31 vai para o próximo mês que tem", () => {
    // Caso real: "Boleto e NF <> Banestes", todo dia 31, prazo 30/09.
    // Setembro não tem 31 — e é assim que a confusão com "último dia" aparece.
    const c: Cadencia = { tipo: "mensal", dias: [31] };
    expect(ajustarPrazoACadencia(c, "2026-09-30", hoje)).toBe("2026-10-31");
  });

  it("prazo que já bate com a regra fica como está", () => {
    const c: Cadencia = { tipo: "mensal", dias: [5, 10, 15, 20, 25, 30], ajuste_fds: "adiar" };
    expect(ajustarPrazoACadencia(c, "2026-09-10", hoje)).toBeNull();
  });

  it("ATRASO NÃO É DIVERGÊNCIA: data válida vencida fica onde está", () => {
    // Empurrar para a próxima apagaria o atraso, que é o que o cartão precisa
    // gritar. 15/07 é dia de cadência; a ocorrência está atrasada, não errada.
    const c: Cadencia = { tipo: "mensal", dias: [15] };
    expect(ajustarPrazoACadencia(c, "2026-07-15", hoje)).toBeNull();
  });

  it("prazo torto E vencido recomeça a conta de hoje, não do passado", () => {
    const c: Cadencia = { tipo: "mensal", dias: [15] };
    expect(ajustarPrazoACadencia(c, "2026-07-08", hoje)).toBe("2026-09-15");
  });

  it("prazo vazio recebe a próxima data", () => {
    expect(ajustarPrazoACadencia({ tipo: "semanal", dias: [1] }, "", hoje)).toBe("2026-08-31");
  });

  it("sem cadência não há o que ajustar", () => {
    expect(ajustarPrazoACadencia(null, "2026-09-05", hoje)).toBeNull();
    expect(ajustarPrazoACadencia({ tipo: "mensal", dias: [] }, "2026-09-05", hoje)).toBeNull();
  });

  it("o ajuste de fim de semana entra na conta do que 'bate'", () => {
    // 05/09/2026 é sábado; com "adiar", a data válida é 07/09.
    const c: Cadencia = { tipo: "mensal", dias: [5], ajuste_fds: "adiar" };
    expect(ajustarPrazoACadencia(c, "2026-09-05", hoje)).toBe("2026-09-07");
    expect(ajustarPrazoACadencia(c, "2026-09-07", hoje)).toBeNull();
  });
});

describe("ehDataDaCadencia", () => {
  it("reconhece a data produzida pela própria regra", () => {
    const c: Cadencia = { tipo: "mensal", dias: [6, 16, 21, 26, 31] };
    expect(ehDataDaCadencia(c, deIso("2026-09-06"))).toBe(true);
    expect(ehDataDaCadencia(c, deIso("2026-09-05"))).toBe(false);
    expect(ehDataDaCadencia(c, deIso("2026-09-31"))).toBe(false); // não existe
  });
});

describe("descreverCadencia", () => {
  it("escreve o que se lê no card", () => {
    expect(descreverCadencia({ tipo: "semanal", dias: [1] })).toBe("toda segunda");
    expect(descreverCadencia({ tipo: "semanal", dias: [3, 1, 5] })).toBe("segunda, quarta e sexta");
    expect(descreverCadencia({ tipo: "mensal", dias: [31] })).toBe("todo dia 31");
    expect(descreverCadencia({ tipo: "mensal", dias: [5, 10, 20] })).toBe("dias 5, 10 e 20");
    expect(descreverCadencia({ tipo: "mensal", dias: [], ultimo_dia: true })).toBe("último dia do mês");
    expect(descreverCadencia({ tipo: "mensal", dias: [5], ultimo_dia: true })).toBe("todo dia 5 e último dia do mês");
    expect(descreverCadencia({ tipo: "diaria", somente_uteis: true })).toBe("todo dia útil");
    expect(descreverCadencia(null)).toBe("");
  });

  it("a versão longa explica o ajuste de fim de semana", () => {
    expect(descreverCadenciaLonga({ tipo: "mensal", dias: [5], ajuste_fds: "antecipar" }))
      .toBe("todo dia 5 (se cair no fim de semana, antecipa para a sexta)");
    expect(descreverCadenciaLonga({ tipo: "semanal", dias: [1] })).toBe("toda segunda");
  });
});

describe("lerCadencia", () => {
  it("aceita o que o banco grava", () => {
    expect(lerCadencia({ tipo: "mensal", dias: [5, 20], ultimo_dia: false, ajuste_fds: "antecipar" }))
      .toEqual({ tipo: "mensal", dias: [5, 20], ultimo_dia: false, ajuste_fds: "antecipar" });
  });

  it("recusa lixo em vez de deixar a tela quebrar", () => {
    expect(lerCadencia(null)).toBeNull();
    expect(lerCadencia("toda segunda")).toBeNull();
    expect(lerCadencia({ tipo: "anual", mes: 3 })).toBeNull();
    expect(lerCadencia({ tipo: "semanal", dias: [] })).toBeNull();
    expect(lerCadencia({ tipo: "mensal", dias: [] })).toBeNull();
    expect(lerCadencia({ tipo: "semanal", dias: [1, 9, "x"] })).toEqual({ tipo: "semanal", dias: [1] });
  });
});
