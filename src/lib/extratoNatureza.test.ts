import { describe, it, expect } from "vitest";
import { classificaSicoob, eCredito, lerContraparte } from "./extratoNatureza";

// Todos os `contraparte_nome` abaixo são valores reais de `sicoob_extrato`.
describe("lerContraparte", () => {
  it("separa rótulo, nome e CNPJ", () => {
    expect(lerContraparte("Recebimento Pix|@TAKEAT TECNOLOGIA LTDA|@37.511.891 0001-50|@")).toEqual({
      operacao: "Recebimento Pix",
      nome: "TAKEAT TECNOLOGIA LTDA",
      documento: "37.511.891 0001-50",
    });
  });

  it("quando não há nome, a descrição do Pix vira o título", () => {
    expect(lerContraparte("Pagamento Pix|@08.335.789 0001-43|@coffe festa junina")).toEqual({
      operacao: "Pagamento Pix",
      nome: "coffe festa junina",
      documento: "08.335.789 0001-43",
    });
  });

  it("reconhece o CPF mascarado que o banco devolve", () => {
    const c = lerContraparte("Pagamento Pix|@***.866.877-**|@reembolso panos de chao nalva");
    expect(c.documento).toBe("***.866.877-**");
    expect(c.nome).toBe("reembolso panos de chao nalva");
  });

  it("remonta o texto quebrado a cada 40 caracteres", () => {
    const c = lerContraparte(
      "Pagamento Pix|@37.811.865 0001-48|@Formacao AI Builder Turma 03 da Kairu La|@bs 2 alunos Vinicius Buteri e Alexandre|@Pirino Pagamento unico",
    );
    // "Kairu La" + "bs" emenda sem espaço; "Alexandre" + "Pirino" recupera o espaço aparado.
    expect(c.nome).toBe(
      "Formacao AI Builder Turma 03 da Kairu Labs 2 alunos Vinicius Buteri e Alexandre Pirino Pagamento unico",
    );
    expect(c.documento).toBe("37.811.865 0001-48");
  });

  it("remonta um nome de fornecedor cortado e tira o 'FAV.:'", () => {
    expect(lerContraparte("FAV.: VIMERCATI MATERIAL DE CONSTRUCAO L|@TDA").nome)
      .toBe("VIMERCATI MATERIAL DE CONSTRUCAO LTDA");
  });

  it("uma parte só: ela É o nome, mesmo parecendo rótulo", () => {
    expect(lerContraparte("Nayara Evangelista Curitiba Donato").nome).toBe("Nayara Evangelista Curitiba Donato");
    // Sem outra parte para pôr no lugar, o rótulo não é engolido — senão o card fica mudo.
    expect(lerContraparte("Pagamento Pix").nome).toBe("Pagamento Pix");
    expect(lerContraparte("PIS").nome).toBe("PIS");
  });

  it("vazio e nulo não quebram", () => {
    expect(lerContraparte(null)).toEqual({ nome: null, operacao: null, documento: null });
    expect(lerContraparte("")).toEqual({ nome: null, operacao: null, documento: null });
    expect(lerContraparte("|@|@")).toEqual({ nome: null, operacao: null, documento: null });
  });
});

describe("classificaSicoob", () => {
  it("tarifa e imposto ganham de pix — um DARF pago por Pix é imposto", () => {
    expect(classificaSicoob("PAGAMENTO DARF VIA PIX", false)).toBe("imposto");
    expect(classificaSicoob("TARIFA PACOTE DE SERVICOS", false)).toBe("tarifa");
    expect(classificaSicoob("PIX EMITIDO OUTRA IF", false)).toBe("pix_out");
    expect(classificaSicoob("PIX RECEBIDO - OUTRA IF", true)).toBe("pix_in");
  });

  it("o mesmo texto muda de lado conforme crédito ou débito", () => {
    expect(classificaSicoob("TED", true)).toBe("ted_in");
    expect(classificaSicoob("TED", false)).toBe("outros_out");
    expect(classificaSicoob("APLICAÇÃO RDC", false)).toBe("outros_out");
  });

  it("eCredito lê a coluna tipo", () => {
    expect(eCredito("credito")).toBe(true);
    expect(eCredito("debito")).toBe(false);
    expect(eCredito(null)).toBe(false);
  });
});
