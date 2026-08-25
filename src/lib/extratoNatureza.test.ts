import { describe, it, expect } from "vitest";
import {
  classificaSicoob, comNomeDoCadastro, eCredito, fmtDocumento, lerContraparte, tituloDoExtrato,
} from "./extratoNatureza";

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

  it("uma parte só que não é rótulo: ela É o nome", () => {
    expect(lerContraparte("Nayara Evangelista Curitiba Donato").nome).toBe("Nayara Evangelista Curitiba Donato");
    expect(lerContraparte("PIS").nome).toBe("PIS");
  });

  it("rótulo genérico nunca é nome — nem quando é a única coisa escrita", () => {
    // É o caso mais comum do Sicoob: rótulo da operação + CNPJ e mais nada. Devolver
    // "Pagamento Pix" como NOME fazia a tela do celular repetir isso em 248 linhas do mês.
    expect(lerContraparte("Pagamento Pix|@62.457.707 0001-89|@")).toEqual({
      operacao: "Pagamento Pix",
      nome: null,
      documento: "62.457.707 0001-89",
    });
    // Sem contraparte nenhuma o rótulo sobrevive em `operacao`, que é de onde o título do
    // card sai — o card não fica mudo.
    expect(lerContraparte("Pagamento Pix")).toEqual({
      operacao: "Pagamento Pix",
      nome: null,
      documento: null,
    });
  });

  it("vazio e nulo não quebram", () => {
    expect(lerContraparte(null)).toEqual({ nome: null, operacao: null, documento: null });
    expect(lerContraparte("")).toEqual({ nome: null, operacao: null, documento: null });
    expect(lerContraparte("|@|@")).toEqual({ nome: null, operacao: null, documento: null });
  });
});

describe("tituloDoExtrato", () => {
  it("a contraparte ganha do rótulo, e o rótulo ganha do histórico", () => {
    const cp = lerContraparte("Pagamento Pix|@08.335.789 0001-43|@coffe festa junina");
    expect(tituloDoExtrato(cp, "PIX EMITIDO OUTRA IF")).toBe("coffe festa junina");
  });

  it("sem contraparte, o rótulo da operação — que é o que a pessoa reconhece", () => {
    const cp = lerContraparte("Pagamento Pix|@62.457.707 0001-89|@");
    expect(tituloDoExtrato(cp, "PIX EMITIDO OUTRA IF")).toBe("Pagamento Pix");
  });

  it("sem pacote nenhum sobra o histórico — é o caso do Asaas, que nunca traz contraparte", () => {
    expect(tituloDoExtrato(lerContraparte(null), "TAXA DE MENSAGERIA")).toBe("TAXA DE MENSAGERIA");
    // Vazio, e não um texto de último caso: cada tela escolhe o dela.
    expect(tituloDoExtrato(lerContraparte(null), null)).toBe("");
  });
});

describe("comNomeDoCadastro", () => {
  it("apelido em cima, nome cru embaixo — é o cru que se procura no Omie", () => {
    expect(comNomeDoCadastro("JIM.COM GRUPO SOUZA", "12.345.678/0001-90", "Café dos eventos")).toEqual({
      titulo: "Café dos eventos",
      apoio: "JIM.COM GRUPO SOUZA",
      trocado: true,
    });
  });

  it("quando o título era só o rótulo da operação, a linha de apoio fica como estava", () => {
    // Não há nome cru a preservar: quem identifica a linha é o documento que já está lá.
    expect(comNomeDoCadastro("Pagamento Pix", "46.235.634/0001-24", "Flash App")).toEqual({
      titulo: "Flash App",
      apoio: "46.235.634/0001-24",
      trocado: true,
    });
  });

  it("cadastro que não conhece, ou que repete o nome, não mexe na linha", () => {
    expect(comNomeDoCadastro("INGRAM MICRO BRASIL LTDA", null, null).trocado).toBe(false);
    expect(comNomeDoCadastro("INGRAM MICRO BRASIL LTDA", null, "  ").trocado).toBe(false);
    // Mesma coisa escrita de outro jeito não é troca — evita piscar a linha à toa.
    expect(comNomeDoCadastro("INGRAM MICRO BRASIL LTDA", null, "ingram micro brasil ltda").trocado).toBe(false);
  });
});

describe("fmtDocumento", () => {
  it("põe a barra que o Sicoob manda como espaço", () => {
    expect(fmtDocumento("37.511.891 0001-50")).toBe("37.511.891/0001-50");
    expect(fmtDocumento("11222333000144")).toBe("11.222.333/0001-44");
    expect(fmtDocumento("12345678901")).toBe("123.456.789-01");
  });

  it("CPF mascarado vai como veio", () => {
    expect(fmtDocumento("***.866.877-**")).toBe("***.866.877-**");
    expect(fmtDocumento(null)).toBeNull();
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
