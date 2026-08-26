/**
 * A escolha de quem vai no teste de dois títulos.
 *
 * O teste existe para responder UMA pergunta: o endpoint em lote aceita
 * `departamentos` e `cnab_integracao_bancaria`? Se os dois escolhidos
 * trouxerem outro problema junto — CNPJ dividido, cadastro incompleto — a
 * recusa do Omie vira ambígua e o teste responde a pergunta errada.
 */

import { describe, expect, it } from "vitest";
import { doisParaTestar, type Candidato } from "./teste";

const c = (over: Partial<Candidato> = {}): Candidato => ({
  codigo: "COL-000001",
  nome: "Fulano",
  valor: 3000,
  cnpj: "66744328000120",
  pronto: true,
  ...over,
});

describe("doisParaTestar", () => {
  it("pega os dois primeiros que estão prontos", () => {
    const escolhidos = doisParaTestar([
      c({ codigo: "A", cnpj: "11111111000111" }),
      c({ codigo: "B", cnpj: "22222222000122" }),
      c({ codigo: "C", cnpj: "33333333000133" }),
    ]);
    expect(escolhidos.map((x) => x.codigo)).toEqual(["A", "B"]);
  });

  it("descarta quem não está pronto", () => {
    const escolhidos = doisParaTestar([
      c({ codigo: "A", cnpj: "11111111000111", pronto: false }),
      c({ codigo: "B", cnpj: "22222222000122" }),
      c({ codigo: "C", cnpj: "33333333000133" }),
    ]);
    expect(escolhidos.map((x) => x.codigo)).toEqual(["B", "C"]);
  });

  /* O caso real: quatro pessoas dividem o 37.511.891/0001-50. Mandar duas
     delas faria o Omie recusar a segunda por duplicidade, e a recusa seria
     lida como "o lote não aceita os blocos aninhados". */
  it("descarta quem divide CNPJ com outra pessoa do lote", () => {
    const mesmo = "37511891000150";
    const escolhidos = doisParaTestar([
      c({ codigo: "A", cnpj: mesmo }),
      c({ codigo: "B", cnpj: mesmo }),
      c({ codigo: "C", cnpj: "33333333000133" }),
      c({ codigo: "D", cnpj: "44444444000144" }),
    ]);
    expect(escolhidos.map((x) => x.codigo)).toEqual(["C", "D"]);
  });

  it("descarta CNPJ truncado — os casos reais do espelho", () => {
    const escolhidos = doisParaTestar([
      c({ codigo: "A", cnpj: "61107569" }),
      c({ codigo: "B", cnpj: "58313176" }),
      c({ codigo: "C", cnpj: "33333333000133" }),
    ]);
    expect(escolhidos.map((x) => x.codigo)).toEqual(["C"]);
  });

  it("sem ninguém elegível devolve lista vazia, não uma escolha ruim", () => {
    expect(doisParaTestar([c({ pronto: false }), c({ cnpj: "123" })])).toEqual([]);
    expect(doisParaTestar([])).toEqual([]);
  });

  it("dá para pedir mais de dois", () => {
    const muitos = Array.from({ length: 5 }, (_, i) =>
      c({ codigo: `C${i}`, cnpj: `1111111100011${i}` }));
    expect(doisParaTestar(muitos, 3)).toHaveLength(3);
  });
});
