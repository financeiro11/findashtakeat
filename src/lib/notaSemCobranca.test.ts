import { describe, expect, it } from "vitest";
import {
  docValido, lerValorBRL, tomadorDoAsaas, tomadorParaAsaas, faltasDaNota, TOMADOR_VAZIO, mesclarConsulta,
} from "./notaSemCobranca";

describe("mesclarConsulta", () => {
  const achado = { nome: "Café dos Eventos", cep: "29050000", endereco: "RUA X", cidade: "Vitória", uf: "ES" };

  it("CNPJ digitado: preenche tudo o que achou, e o documento não muda", () => {
    const t = mesclarConsulta({ ...TOMADOR_VAZIO, doc: "11222333000181", nome: "rascunho" }, achado, { sobrescrever: true });
    expect(t.nome).toBe("Café dos Eventos");
    expect(t.endereco).toBe("RUA X");
    expect(t.doc).toBe("11222333000181");
  });

  it("sem sobrescrever, só preenche buraco — o que a pessoa digitou fica", () => {
    const t = mesclarConsulta({ ...TOMADOR_VAZIO, nome: "Meu nome", numero: "10" }, achado, { sobrescrever: false });
    expect(t.nome).toBe("Meu nome");
    expect(t.cidade).toBe("Vitória");
    expect(t.numero).toBe("10");
  });

  it("valor vazio no achado não apaga o formulário", () => {
    const t = mesclarConsulta({ ...TOMADOR_VAZIO, email: "a@b.com" }, { email: "  " }, { sobrescrever: true });
    expect(t.email).toBe("a@b.com");
  });

  it("trocar de CNPJ limpa o que a consulta anterior tinha preenchido", () => {
    const antes = { ...TOMADOR_VAZIO, doc: "11222333000181", nome: "Cliente A", bairro: "Centro", numero: "99" };
    const t = mesclarConsulta(antes, { nome: "Cliente B" }, { sobrescrever: true, herdados: ["nome", "bairro", "numero"] });
    expect(t.nome).toBe("Cliente B");
    expect(t.bairro).toBe("");
    expect(t.numero).toBe("");
  });
});

describe("docValido", () => {
  it("aceita CNPJ e CPF com dígito certo, pontuados ou não", () => {
    expect(docValido("11.222.333/0001-81")).toBe(true);
    expect(docValido("11222333000181")).toBe(true);
    expect(docValido("529.982.247-25")).toBe(true);
  });
  it("recusa dígito errado, repetição e tamanho errado", () => {
    expect(docValido("11222333000182")).toBe(false);
    expect(docValido("52998224724")).toBe(false);
    expect(docValido("00000000000")).toBe(false);
    expect(docValido("11111111111111")).toBe(false);
    expect(docValido("1234")).toBe(false);
  });
});

describe("lerValorBRL", () => {
  it("lê o formato brasileiro", () => {
    expect(lerValorBRL("R$ 1.234,56")).toBe(1234.56);
    expect(lerValorBRL("350")).toBe(350);
    expect(lerValorBRL("350,5")).toBe(350.5);
  });
  it("ponto com três dígitos depois é milhar, não decimal", () => {
    expect(lerValorBRL("1.500")).toBe(1500);
    expect(lerValorBRL("52.855.160")).toBe(52855160);
  });
  it("ponto sem vírgula e sem três dígitos é decimal", () => {
    expect(lerValorBRL("1234.56")).toBe(1234.56);
  });
  it("recusa lixo, zero e negativo", () => {
    expect(lerValorBRL("")).toBeNull();
    expect(lerValorBRL("abc")).toBeNull();
    expect(lerValorBRL("0")).toBeNull();
    expect(lerValorBRL("-10")).toBeNull();
    expect(lerValorBRL("1.2.3")).toBeNull();
  });
});

describe("tomador ida e volta", () => {
  it("o que vem do Asaas volta no mesmo formato que o cadastro do Omie lê", () => {
    const asaas = {
      name: "Café dos Eventos", cpfCnpj: "11222333000181", email: "a@b.com.br, c@d.com",
      mobilePhone: "(27) 99999-0000", postalCode: "29050-000", address: "Rua X",
      addressNumber: "10", complement: "", province: "Centro", cityName: "Vitória", state: "es",
    };
    const t = tomadorDoAsaas(asaas);
    expect(t.email).toBe("a@b.com.br");
    expect(t.uf).toBe("ES");
    expect(t.cep).toBe("29050000");
    const volta = tomadorParaAsaas(t);
    expect(volta.cpfCnpj).toBe("11222333000181");
    expect(volta.cityName).toBe("Vitória");
    expect(volta.mobilePhone).toBe("27999990000");
  });
});

describe("faltasDaNota", () => {
  const completo = {
    tomador: {
      ...TOMADOR_VAZIO, doc: "11222333000181", nome: "Cliente", email: "x@y.com", cep: "29050000",
      endereco: "Rua X", numero: "10", bairro: "Centro", cidade: "Vitória", uf: "ES",
    },
    valor: "350,00", descricao: "Consultoria de implantação", vencimento: "2026-09-14",
  };

  it("formulário completo não tem falta", () => {
    expect(faltasDaNota(completo, { temCadastroOmie: false })).toEqual([]);
  });

  it("sem cadastro no Omie, exige endereço e e-mail", () => {
    const f = { ...completo, tomador: { ...completo.tomador, email: "", numero: "", cep: "123" } };
    const faltas = faltasDaNota(f, { temCadastroOmie: false });
    expect(faltas.some((x) => x.startsWith("e-mail"))).toBe(true);
    expect(faltas.some((x) => x.startsWith("número"))).toBe(true);
    expect(faltas.some((x) => x.startsWith("CEP"))).toBe(true);
  });

  it("com cadastro no Omie, o endereço não é pedido — mas documento, valor e descrição sim", () => {
    const f = {
      ...completo,
      tomador: { ...TOMADOR_VAZIO, doc: "11222333000181", nome: "Cliente" },
    };
    expect(faltasDaNota(f, { temCadastroOmie: true })).toEqual([]);
    expect(faltasDaNota({ ...f, valor: "0" }, { temCadastroOmie: true })).toEqual(["valor da nota"]);
  });

  it("descrição acima de 200 caracteres é falta, não corte silencioso", () => {
    const f = { ...completo, descricao: "a".repeat(201) };
    expect(faltasDaNota(f, { temCadastroOmie: false })).toEqual(["descrição com até 200 caracteres"]);
  });
});
