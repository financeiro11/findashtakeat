import { describe, expect, it } from "vitest";
import { faixaDeMeses, nomeDoMes } from "./meses";

describe("nomeDoMes", () => {
  it("traduz a competência do RPC", () => {
    expect(nomeDoMes("2026-08-01")).toBe("Agosto de 2026");
    expect(nomeDoMes("2026-03-01")).toBe("Março de 2026");
  });
});

describe("faixaDeMeses", () => {
  it("volta vazio quando não falta mês nenhum", () => {
    expect(faixaDeMeses([])).toBe("");
  });

  it("um mês só", () => {
    expect(faixaDeMeses(["07/2026"])).toBe("julho de 2026");
  });

  // O caso real de 03/09/2026: o extrato tem jan–ago, e só junho e agosto foram
  // rateados por cartão.
  it("colapsa a sequência e junta o mês solto", () => {
    expect(faixaDeMeses(["01/2026", "02/2026", "03/2026", "04/2026", "05/2026", "07/2026"]))
      .toBe("janeiro a maio e julho de 2026");
  });

  it("aceita fora de ordem e com repetição", () => {
    expect(faixaDeMeses(["07/2026", "01/2026", "07/2026", "02/2026"]))
      .toBe("janeiro, fevereiro e julho de 2026");
  });

  it("mês solto no meio da faixa não engole os vizinhos", () => {
    expect(faixaDeMeses(["01/2026", "02/2026", "03/2026", "08/2026"]))
      .toBe("janeiro a março e agosto de 2026");
  });

  // Par seguido não vira faixa: "abril e maio" lê melhor que "abril a maio".
  it("dois meses seguidos ficam na lista, faixa só a partir de três", () => {
    expect(faixaDeMeses(["04/2026", "05/2026"])).toBe("abril e maio de 2026");
    expect(faixaDeMeses(["04/2026", "05/2026", "06/2026"])).toBe("abril a junho de 2026");
  });

  // Virada de ano: dezembro e janeiro são seguidos, e o ano deixa de ser sufixo único.
  it("carrega o ano em cada ponta quando cruza o ano", () => {
    expect(faixaDeMeses(["12/2025", "01/2026", "02/2026"]))
      .toBe("dezembro de 2025 a fevereiro de 2026");
    expect(faixaDeMeses(["11/2025", "03/2026"]))
      .toBe("novembro de 2025 e março de 2026");
  });

  it("ignora chave fora do formato MM/AAAA", () => {
    expect(faixaDeMeses(["2026-07-01", "07/2026"])).toBe("julho de 2026");
  });
});
