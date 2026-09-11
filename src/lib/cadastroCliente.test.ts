import { describe, it, expect } from "vitest";
import {
  CAMPOS_CADASTRO, cidadeSemUf, listaDeEmails, normalizarCampo, erroDoCampo,
  errosDoCadastro, mudancas, mudancasNoAsaas, camposAEnviar,
  type ValoresCadastro,
} from "./cadastroCliente";

/** O cadastro do Omie de um cliente que emite — a base de comparação. */
const atual: ValoresCadastro = {
  razao_social: "SUNFLOWER COMERCIO DE ALIMENTOS LTDA",
  nome_fantasia: "Sunflower - Brasilia",
  email: "",
  telefone: "6132451122",
  endereco: "SCLN 210 BLOCO B",
  endereco_numero: "31",
  complemento: "",
  bairro: "Asa Norte",
  cidade: "BRASILIA (DF)",
  estado: "DF",
  cep: "70862520",
};

describe("normalizarCampo", () => {
  it("guarda só os dígitos de CEP e telefone", () => {
    expect(normalizarCampo("cep", "70862-520")).toBe("70862520");
    expect(normalizarCampo("telefone", "(61) 3245-1122")).toBe("6132451122");
  });

  it("corta o CEP no oitavo dígito em vez de aceitar lixo colado", () => {
    expect(normalizarCampo("cep", "70862520123")).toBe("70862520");
  });

  it("põe a UF em duas letras maiúsculas", () => {
    expect(normalizarCampo("estado", "df")).toBe("DF");
    expect(normalizarCampo("estado", "Espírito Santo")).toBe("ES");
  });

  it("não mexe na caixa do e-mail — a parte antes do @ é sensível a ela", () => {
    expect(normalizarCampo("email", " Financeiro@Takeat.app ")).toBe("Financeiro@Takeat.app");
  });

  it("junta vários e-mails com ponto-e-vírgula, que é como o Omie guarda", () => {
    expect(normalizarCampo("email", "a@x.com, b@y.com")).toBe("a@x.com;b@y.com");
  });

  it("tira a UF que veio colada na cidade", () => {
    expect(normalizarCampo("cidade", "BRASILIA (DF)")).toBe("BRASILIA");
    expect(cidadeSemUf("Vila Velha (ES)")).toBe("Vila Velha");
    // Parêntese que não é UF fica: "Santana (do Livramento)" não é sufixo de UF.
    expect(cidadeSemUf("Santana (do Livramento)")).toBe("Santana (do Livramento)");
  });

  it("respeita o limite de cada campo do Omie", () => {
    const longo = "A".repeat(80);
    expect(normalizarCampo("razao_social", longo)).toHaveLength(60);
    expect(normalizarCampo("endereco_numero", "1234567890123")).toHaveLength(10);
  });
});

describe("erroDoCampo", () => {
  it("deixa passar o campo vazio — vazio é 'não mexi', não é erro", () => {
    for (const d of CAMPOS_CADASTRO) expect(erroDoCampo(d.campo, "")).toBeNull();
  });

  it("recusa CEP incompleto e telefone curto", () => {
    expect(erroDoCampo("cep", "7086")).toMatch(/8 d/);
    expect(erroDoCampo("telefone", "32451122")).toMatch(/DDD/);
    expect(erroDoCampo("telefone", "6132451122")).toBeNull();
    expect(erroDoCampo("telefone", "61932451122")).toBeNull();
  });

  it("recusa e-mail sem arroba, sem ponto no domínio ou com espaço no meio", () => {
    expect(erroDoCampo("email", "geniani.yahoo.com.br")).toMatch(/inválido/);
    expect(erroDoCampo("email", "geniani@yahoo")).toMatch(/inválido/);
    expect(erroDoCampo("email", "geniani @yahoo.com.br")).toMatch(/inválido/);
    expect(erroDoCampo("email", "geniani@yahoo.com.br")).toBeNull();
  });

  it("aponta qual dos vários e-mails está torto", () => {
    const erro = erroDoCampo("email", "bom@x.com; ruim@; outro@y.com.br");
    expect(erro).toContain("ruim@");
    expect(erro).not.toContain("bom@x.com");
  });

  it("errosDoCadastro junta tudo para a tela decidir o botão", () => {
    const erros = errosDoCadastro({ email: "sem-arroba", cep: "123", bairro: "Centro" });
    expect(Object.keys(erros).sort()).toEqual(["cep", "email"]);
  });
});

describe("mudancas", () => {
  it("é o caso que trouxe a pessoa aqui: o e-mail que falta", () => {
    const m = mudancas(atual, { ...atual, email: "isabellibea18@gmail.com" });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      campo: "email", de: "", para: "isabellibea18@gmail.com", vazio: true, noAsaas: true,
    });
  });

  it("campo em branco NÃO apaga o que está no cadastro", () => {
    const m = mudancas(atual, { ...atual, bairro: "", razao_social: "", telefone: "" });
    expect(m).toEqual([]);
  });

  it("ignora diferença que não é diferença: acento, caixa, pontuação", () => {
    const m = mudancas(atual, {
      ...atual,
      cidade: "Brasília",            // o Omie guarda "BRASILIA (DF)"
      telefone: "(61) 3245-1122",
      cep: "70862-520",
      bairro: "ASA NORTE",
    });
    expect(m).toEqual([]);
  });

  it("a cidade compara sem a UF que o Omie cola nela", () => {
    const m = mudancas(atual, { ...atual, cidade: "Taguatinga" });
    expect(m.map((x) => x.campo)).toEqual(["cidade"]);
    expect(m[0].de).toBe("BRASILIA");
  });

  it("separa preencher buraco de substituir valor — o risco não é o mesmo", () => {
    const m = mudancas(atual, { ...atual, email: "novo@x.com", endereco_numero: "45" });
    expect(m.find((x) => x.campo === "email")?.vazio).toBe(true);
    expect(m.find((x) => x.campo === "endereco_numero")?.vazio).toBe(false);
  });

  it("marca quais mudanças chegam ao Asaas — razão social e cidade não chegam", () => {
    const m = mudancas(atual, {
      ...atual, razao_social: "OUTRA RAZAO LTDA", cidade: "Taguatinga",
      email: "novo@x.com", cep: "72010010",
    });
    expect(m.map((x) => x.campo).sort()).toEqual(["cep", "cidade", "email", "razao_social"]);
    expect(mudancasNoAsaas(m).map((x) => x.campo).sort()).toEqual(["cep", "email"]);
  });

  it("o corpo enviado leva só o que mudou, já normalizado", () => {
    const m = mudancas(atual, { ...atual, email: " novo@X.com ", cep: "72010-010" });
    expect(camposAEnviar(m)).toEqual({ email: "novo@X.com", cep: "72010010" });
  });

  it("cadastro sem nada preenchido: tudo que a pessoa digitar é mudança", () => {
    const m = mudancas({}, { email: "a@b.com", cidade: "Vitória", estado: "es" });
    expect(m.map((x) => x.campo).sort()).toEqual(["cidade", "email", "estado"]);
    expect(m.every((x) => x.vazio)).toBe(true);
    expect(m.find((x) => x.campo === "estado")?.para).toBe("ES");
  });
});

describe("listaDeEmails", () => {
  it("aceita ponto-e-vírgula e vírgula, e descarta os vazios", () => {
    expect(listaDeEmails("a@x.com;; b@y.com, ")).toEqual(["a@x.com", "b@y.com"]);
  });
});
