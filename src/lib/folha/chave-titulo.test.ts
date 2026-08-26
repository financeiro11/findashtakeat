import { describe, expect, it } from "vitest";
import { chaveDoTitulo } from "../../../supabase/functions/_shared/folha-envio";

const CNPJ = "65134410000170";
const cad = (chave: string, existe = true) => ({ chave, existe });

describe("chaveDoTitulo — a chave é sempre a do cadastro do Omie", () => {
  it("devolve a chave do cadastro, LITERAL", () => {
    expect(chaveDoTitulo({ documento: CNPJ, cadastro: cad(CNPJ), estagiario: false }))
      .toEqual({ chave: CNPJ });
  });

  it("não normaliza o +55 do telefone — normalizar recria a divergência", () => {
    const r = chaveDoTitulo({
      documento: "66296259000130", cadastro: cad("+5527998814130"), estagiario: false,
    });
    expect(r.chave).toBe("+5527998814130");
  });

  it("não tira a pontuação do CNPJ cadastrado", () => {
    const r = chaveDoTitulo({
      documento: CNPJ, cadastro: cad("65.134.410/0001-70"), estagiario: false,
    });
    expect(r.chave).toBe("65.134.410/0001-70");
  });

  it("e-mail cadastrado vale, mesmo com o CNPJ à mão", () => {
    const r = chaveDoTitulo({
      documento: "62457707000189", cadastro: cad("arturevangelistaoliveira@gmail.com"), estagiario: false,
    });
    expect(r.chave).toBe("arturevangelistaoliveira@gmail.com");
  });

  it("estagiário paga no CPF do cadastro", () => {
    const r = chaveDoTitulo({
      documento: "16146305774", cadastro: cad("16146305774"), estagiario: true,
    });
    expect(r.chave).toBe("16146305774");
  });
});

describe("chaveDoTitulo — bloqueia em vez de substituir", () => {
  it("sem fornecedor no Omie", () => {
    const r = chaveDoTitulo({ documento: CNPJ, cadastro: cad("", false), estagiario: false });
    expect(r.bloqueio).toContain("não tem fornecedor");
  });

  it("cadastro null é o mesmo que não achado", () => {
    expect(chaveDoTitulo({ documento: CNPJ, cadastro: null, estagiario: false }).bloqueio)
      .toBeTruthy();
  });

  it("fornecedor sem chave manda cadastrar lá, não aqui", () => {
    const r = chaveDoTitulo({ documento: CNPJ, cadastro: cad(""), estagiario: false });
    expect(r.bloqueio).toContain("sem chave PIX");
    expect(r.chave).toBeUndefined();
  });

  it("chave aleatória no cadastro bloqueia — a empresa não paga nesse tipo", () => {
    const r = chaveDoTitulo({
      documento: "65522549000191",
      cadastro: cad("93c94e57-d72a-4513-b2f0-ed195fcd1ff2"),
      estagiario: false,
    });
    expect(r.bloqueio).toContain("aleatória");
  });

  it("NÃO cai para o documento quando a chave cadastrada é ruim", () => {
    const r = chaveDoTitulo({
      documento: CNPJ, cadastro: cad("chave-que-nao-existe"), estagiario: false,
    });
    expect(r.chave).toBeUndefined();
  });

  it("CPF cadastrado para quem não é estagiário", () => {
    const r = chaveDoTitulo({
      documento: "15447902797", cadastro: cad("15447902797"), estagiario: false,
    });
    expect(r.bloqueio).toContain("só estagiário");
  });

  it("estagiário cadastrado com CNPJ", () => {
    const r = chaveDoTitulo({
      documento: CNPJ, cadastro: cad(CNPJ), estagiario: true,
    });
    expect(r.bloqueio).toContain("recebe no CPF");
  });

  it("CNPJ de terceiro no cadastro não paga", () => {
    const r = chaveDoTitulo({
      documento: CNPJ, cadastro: cad("37511891000150"), estagiario: false,
    });
    expect(r.bloqueio).toContain("terceiro");
  });

  it("telefone sem +55 bloqueia — o Omie recusa", () => {
    const r = chaveDoTitulo({
      documento: "65677373000147", cadastro: cad("11957054393"), estagiario: false,
    });
    expect(r.bloqueio).toContain("+55");
  });

  it("e-mail sem TLD bloqueia", () => {
    const r = chaveDoTitulo({
      documento: "66395343000100", cadastro: cad("scaetano.takeat@gnm"), estagiario: false,
    });
    expect(r.bloqueio).toContain("e-mail");
  });

  it("a mensagem sempre aponta para o cadastro do Omie, não para o RH", () => {
    for (const chave of ["", "93c94e57-fbb4-4d31-b740-2b0c2a38fb07", "11957054393", "x@y"]) {
      const r = chaveDoTitulo({ documento: CNPJ, cadastro: cad(chave), estagiario: false });
      expect(r.bloqueio?.toLowerCase()).toContain("omie");
    }
  });
});
