/**
 * A decisão de cadastrar colaborador como fornecedor no Omie.
 *
 * O que este teste prende é para ONDE o salário vai. A chave PIX é o destino
 * do dinheiro: gravar a errada, ou sobrescrever a certa, manda o pagamento
 * para outro lugar sem dar erro em canto nenhum.
 *
 * Os casos usam dados reais do espelho do RH lido em 26/08/2026 — inclusive os
 * defeitos: CNPJ truncado, CNPJ em branco e o 37.511.891/0001-50 dividido por
 * quatro pessoas.
 */

import { describe, expect, it } from "vitest";
import {
  chavePixDe, cnpjsRepetidos, decidirCadastro, integracaoClienteDe, mesmaChavePix,
  montarAlterarPix, montarIncluirCliente,
  type ClienteDoOmie, type ColaboradorParaOmie,
} from "../../../supabase/functions/_shared/colaborador-omie.ts";

const pessoa = (over: Partial<ColaboradorParaOmie> = {}): ColaboradorParaOmie => ({
  codigo: "COL-592355",
  nome: "Ádrian Coradini da Silva",
  cnpj: "66.744.328/0001-20",
  razao: "ADRIAN CORADINI SERVICOS LTDA",
  pix: "66.744.328/0001-20",
  ...over,
});

const noOmie = (over: Partial<ClienteDoOmie> = {}): ClienteDoOmie => ({
  codigo_cliente_omie: 4214850,
  cnpj_cpf: "66744328000120",
  razao_social: "ADRIAN CORADINI SERVICOS LTDA",
  dadosBancarios: { cChavePix: "66744328000120" },
  ...over,
});

describe("chavePixDe", () => {
  it("a chave do RH vem primeiro — ela nem sempre é o CNPJ", () => {
    // Casos reais do espelho: e-mail, CPF e CNPJ convivem na mesma coluna.
    expect(chavePixDe(pessoa({ pix: "amanda.takeat@gmail.com" }))).toBe("amanda.takeat@gmail.com");
    expect(chavePixDe(pessoa({ pix: "15447902797" }))).toBe("15447902797");
    expect(chavePixDe(pessoa({ pix: "44677428000149" }))).toBe("44677428000149");
  });

  it("sem chave no RH, cai para o CNPJ", () => {
    for (const vazio of [null, "", "   "]) {
      expect(chavePixDe(pessoa({ pix: vazio }))).toBe("66744328000120");
    }
  });
});

describe("mesmaChavePix", () => {
  it("o mesmo documento escrito de jeitos diferentes é a mesma chave", () => {
    expect(mesmaChavePix("66.744.328/0001-20", "66744328000120")).toBe(true);
    expect(mesmaChavePix(" 66744328000120 ", "66.744.328/0001-20")).toBe(true);
  });

  it("e-mail compara como texto, sem virar dígito", () => {
    expect(mesmaChavePix("Amanda@Takeat.com", "amanda@takeat.com")).toBe(true);
    expect(mesmaChavePix("amanda@takeat.com", "outra@takeat.com")).toBe(false);
  });

  it("documentos diferentes não se confundem", () => {
    expect(mesmaChavePix("66744328000120", "37511891000150")).toBe(false);
  });

  it("chave vazia nunca casa com nada", () => {
    expect(mesmaChavePix("", "66744328000120")).toBe(false);
    expect(mesmaChavePix("66744328000120", "")).toBe(false);
  });
});

describe("decidirCadastro", () => {
  it("quem não existe no Omie é criado, com a chave do RH", () => {
    const d = decidirCadastro(pessoa({ pix: "amanda.takeat@gmail.com" }), []);
    expect(d).toMatchObject({ acao: "criar", chavePix: "amanda.takeat@gmail.com" });
  });

  it("quem existe sem chave PIX ganha a chave", () => {
    const d = decidirCadastro(pessoa(), [noOmie({ dadosBancarios: { cChavePix: "" } })]);
    expect(d).toMatchObject({ acao: "alterar_pix", codigoClienteOmie: 4214850 });
  });

  it("quem existe com a MESMA chave não é tocado", () => {
    expect(decidirCadastro(pessoa(), [noOmie()])).toMatchObject({ acao: "ja_ok" });
  });

  it("PIX divergente NÃO é sobrescrito — bloqueia e avisa", () => {
    // Trocar chave PIX em silêncio é mudar para onde o salário vai.
    const d = decidirCadastro(
      pessoa({ pix: "amanda.takeat@gmail.com" }),
      [noOmie({ dadosBancarios: { cChavePix: "66744328000120" } })],
    );
    expect(d.acao).toBe("bloqueado");
    expect(d.motivo).toMatch(/difere/i);
    expect(d.codigoClienteOmie).toBe(4214850);
  });

  it("entre vários cadastros, prefere o que já tem chave PIX", () => {
    const d = decidirCadastro(pessoa(), [
      noOmie({ codigo_cliente_omie: 111, dadosBancarios: { cChavePix: "" } }),
      noOmie({ codigo_cliente_omie: 222, dadosBancarios: { cChavePix: "66744328000120" } }),
    ]);
    expect(d).toMatchObject({ acao: "ja_ok", codigoClienteOmie: 222 });
  });

  it("CNPJ truncado ou vazio bloqueia — os casos reais do espelho", () => {
    for (const [cnpj, esperado] of [
      ["61107569", /incompleto/i],
      ["58313176", /incompleto/i],
      ["6500769400134", /incompleto/i],
      ["5208619200012", /incompleto/i],
      ["", /Sem CNPJ/i],
      [null, /Sem CNPJ/i],
    ] as [string | null, RegExp][]) {
      const d = decidirCadastro(pessoa({ cnpj }), []);
      expect(d.acao, String(cnpj)).toBe("bloqueado");
      expect(d.motivo, String(cnpj)).toMatch(esperado);
    }
  });
});

describe("cnpjsRepetidos", () => {
  it("acha o CNPJ dividido por quatro pessoas", () => {
    const mesmo = "37.511.891/0001-50";
    const repetidos = cnpjsRepetidos([
      pessoa({ codigo: "COL-156813", nome: "André Luis Rocon", cnpj: mesmo }),
      pessoa({ codigo: "COL-895495", nome: "Caio Caiado", cnpj: mesmo }),
      pessoa({ codigo: "COL-060990", nome: "Kelly Travieso", cnpj: mesmo }),
      pessoa({ codigo: "COL-352154", nome: "Wericles Silva", cnpj: mesmo }),
      pessoa(),
    ]);
    expect(repetidos).toEqual(["37511891000150"]);
  });

  it("não confunde CNPJ truncado com repetição", () => {
    expect(cnpjsRepetidos([pessoa({ cnpj: "61107569" }), pessoa({ cnpj: "58313176" })])).toEqual([]);
  });

  it("lote sem repetição devolve vazio", () => {
    expect(cnpjsRepetidos([pessoa(), pessoa({ cnpj: "39.988.921/0001-40" })])).toEqual([]);
  });
});

describe("os payloads", () => {
  it("IncluirCliente espelha o fluxo n8n, com a chave do RH", () => {
    const p = montarIncluirCliente(pessoa({ pix: "amanda.takeat@gmail.com" }));
    expect(p).toEqual({
      codigo_cliente_integracao: "COLAB-66744328000120",
      razao_social: "ADRIAN CORADINI SERVICOS LTDA",
      nome_fantasia: "Ádrian Coradini da Silva",
      cnpj_cpf: "66744328000120",
      dadosBancarios: { cChavePix: "amanda.takeat@gmail.com" },
    });
  });

  it("sem razão social, a razão vira o nome da pessoa", () => {
    expect(montarIncluirCliente(pessoa({ razao: null })).razao_social)
      .toBe("Ádrian Coradini da Silva");
  });

  it("o código de integração é o mesmo para o CNPJ escrito de qualquer jeito", () => {
    // É ele que faz o Omie recusar o segundo cadastro da mesma PJ.
    expect(integracaoClienteDe("66.744.328/0001-20")).toBe("COLAB-66744328000120");
    expect(integracaoClienteDe("66744328000120")).toBe("COLAB-66744328000120");
  });

  it("AlterarCliente toca SÓ a chave PIX", () => {
    const p = montarAlterarPix(4214850, "amanda.takeat@gmail.com");
    // Nada de razão social nem CNPJ: alterar cadastro inteiro apagaria campos
    // que o Omie não recebeu de volta.
    expect(p).toEqual({
      codigo_cliente_omie: 4214850,
      dadosBancarios: { cChavePix: "amanda.takeat@gmail.com" },
    });
  });
});
