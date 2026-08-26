import { describe, expect, it } from "vitest";
import { chaveComparavel, compararChavePix } from "./chaves-pix";

const omie = (chaveOmie: string, extra: Partial<Parameters<typeof compararChavePix>[1]> = {}) =>
  ({ chaveOmie, existe: true, ...extra });

describe("chaveComparavel", () => {
  it("ignora a pontuação do CNPJ — o RH grava com, o Omie sem", () => {
    expect(chaveComparavel("65.134.410/0001-70")).toBe("65134410000170");
    expect(chaveComparavel("65134410000170")).toBe("65134410000170");
  });

  it("não reduz e-mail a dígitos só porque tem número no meio", () => {
    expect(chaveComparavel("thyagojuliano0@gmail.com")).toBe("thyagojuliano0@gmail.com");
  });

  it("normaliza caixa do e-mail", () => {
    expect(chaveComparavel("Jor.Mello2@Hotmail.com")).toBe("jor.mello2@hotmail.com");
  });

  it("preserva a chave aleatória inteira", () => {
    const evp = "9d5bdd04-fbb4-4d31-b740-2b0c2a38fb07";
    expect(chaveComparavel(evp)).toBe(evp);
  });

  it("vazio e nulo dão a mesma coisa", () => {
    expect(chaveComparavel(null)).toBe("");
    expect(chaveComparavel("  ")).toBe("");
  });
});

describe("compararChavePix", () => {
  it("mesma chave com pontuação diferente não é divergência", () => {
    const r = compararChavePix("65.134.410/0001-70", omie("65134410000170"));
    expect(r.situacao).toBe("iguais");
    expect(r.ok).toBe(true);
  });

  it("o +55 que falta no RH é aviso, não erro — o Omie tem a chave certa", () => {
    const r = compararChavePix("27992360017", omie("+5527992360017"));
    expect(r.situacao).toBe("so_ddi");
    expect(r.gravidade).toBe("aviso");
    expect(r.mensagem).toContain("+5527992360017");
  });

  it("CPF no RH contra CNPJ no Omie é divergência, e mostra as duas", () => {
    const r = compararChavePix("15447902797", omie("62563437000190"));
    expect(r.situacao).toBe("divergente");
    expect(r.mensagem).toContain("15447902797");
    expect(r.mensagem).toContain("62563437000190");
  });

  it("divergência não trava: o envio cai para a chave do fornecedor", () => {
    expect(compararChavePix("6500769400134", omie("65007694000134")).gravidade).toBe("aviso");
  });

  it("fornecedor sem chave no Omie é erro — não há por onde pagar", () => {
    const r = compararChavePix("52793318000170", omie(""));
    expect(r.situacao).toBe("omie_sem_chave");
    expect(r.gravidade).toBe("erro");
  });

  it("fornecedor que não existe no Omie é erro", () => {
    const r = compararChavePix("scaetano.takeat@gnm", omie("", { existe: false }));
    expect(r.situacao).toBe("sem_fornecedor");
    expect(r.gravidade).toBe("erro");
  });

  it("sem chave dos dois lados é erro", () => {
    expect(compararChavePix("", omie("")).situacao).toBe("sem_chave_nos_dois");
  });

  it("consulta que falhou não vira acusação de cadastro", () => {
    const r = compararChavePix("x@y.com", omie("", { existe: false, erro: "timeout" }));
    expect(r.situacao).toBe("erro");
    expect(r.mensagem).toContain("timeout");
  });

  it("55 no começo de e-mail não é DDI", () => {
    const r = compararChavePix("55fulano@gmail.com", omie("fulano@gmail.com"));
    expect(r.situacao).toBe("divergente");
  });

  it("RH vazio com Omie cadastrado diz de onde sai o pagamento", () => {
    const r = compararChavePix("", omie("65134410000170"));
    expect(r.situacao).toBe("divergente");
    expect(r.mensagem).toContain("sem chave no RH");
  });
});
