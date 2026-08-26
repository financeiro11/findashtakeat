/**
 * A conferência do que chega do Portal RH.
 *
 * Todos os casos abaixo são REAIS, lidos do espelho em 26/08/2026 — inclusive
 * os que parecem improváveis. É por isso que a conferência existe: nada disso
 * dá erro em lugar nenhum, vira pagamento para a conta errada.
 */

import { describe, expect, it } from "vitest";
import {
  CNPJ_TAKEAT, chavePermitida, cnpjValido, conferir, cpfValido, distanciaDeUmDigito,
  ehEstagiario, medianasPorDepartamento, tipoDeChavePix,
  type PessoaParaConferir,
} from "./conferencia";

const pessoa = (over: Partial<PessoaParaConferir> = {}): PessoaParaConferir => ({
  nome: "Fulano de Tal",
  cargo: "Analista",
  documento: "66744328000120",
  pix: "66744328000120",
  valor: 3000,
  departamento: "Suporte",
  ...over,
});

const erros = (p: PessoaParaConferir, m?: Parameters<typeof conferir>[1]) =>
  conferir(p, m).filter((a) => a.gravidade === "erro");

describe("cnpjValido", () => {
  it("aceita os CNPJs reais da folha", () => {
    for (const ok of ["66744328000120", "39988921000140", "44677428000149", "62563437000190"]) {
      expect(cnpjValido(ok), ok).toBe(true);
    }
  });

  it("recusa dígito verificador errado, mesmo com 14 dígitos", () => {
    // O caso perigoso: tem o tamanho certo, então passa em qualquer checagem
    // que só conte caracteres.
    expect(cnpjValido("66744328000121")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
  });

  it("recusa os truncados do espelho", () => {
    for (const ruim of ["58313176", "6500769400134", "5208619200012", ""]) {
      expect(cnpjValido(ruim), ruim).toBe(false);
    }
  });
});

describe("cpfValido", () => {
  it("aceita o CPF do estagiário", () => {
    expect(cpfValido("16146305774")).toBe(true);
  });

  it("recusa dígito errado e sequência repetida", () => {
    expect(cpfValido("16146305775")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });
});

describe("tipoDeChavePix", () => {
  it("reconhece os tipos que existem no cadastro", () => {
    expect(tipoDeChavePix("66.744.328/0001-20")).toBe("cnpj");
    expect(tipoDeChavePix("amanda.takeat@gmail.com")).toBe("email");
    expect(tipoDeChavePix("16146305774")).toBe("cpf");
    expect(tipoDeChavePix("93c94e57-d72a-4513-b2f0-ed195fcd1ff2")).toBe("aleatoria");
    expect(tipoDeChavePix("")).toBe("vazia");
  });

  /* `scaetano.takeat@gnm` está no cadastro. "gnm" não é um domínio: falta o
     TLD, e um PIX assim não recebe nada. */
  it("pega o e-mail sem TLD que está no cadastro", () => {
    expect(tipoDeChavePix("scaetano.takeat@gnm")).toBe("email_invalido");
    expect(tipoDeChavePix("pedro.faro@takeat.app")).toBe("email");
  });

  /* Os quatro de 13 dígitos do espelho não são telefone: são CNPJ que perdeu
     um dígito. Chamá-los de telefone mandaria alguém procurar um problema que
     não existe. */
  it("13 dígitos é CNPJ incompleto, não telefone", () => {
    for (const d of ["6500769400134", "5208619200012", "6597564900173", "3181758200127"]) {
      expect(tipoDeChavePix(d), d).toBe("documento_incompleto");
    }
  });

  it("celular de verdade é telefone, e não CPF", () => {
    expect(tipoDeChavePix("27998814130")).toBe("telefone"); // DDD 27 + 9
    expect(tipoDeChavePix("+5527998814130")).toBe("telefone");
    expect(tipoDeChavePix("16146305774")).toBe("cpf");      // não começa com 9 depois do DDD
  });
});

describe("chavePermitida", () => {
  it("CNPJ e e-mail passam sempre", () => {
    expect(chavePermitida("cnpj", false)).toBe(true);
    expect(chavePermitida("email", false)).toBe(true);
  });

  it("CPF só para estagiário", () => {
    expect(chavePermitida("cpf", true)).toBe(true);
    expect(chavePermitida("cpf", false)).toBe(false);
  });

  it("aleatória nunca, nem para estagiário", () => {
    expect(chavePermitida("aleatoria", true)).toBe(false);
    expect(chavePermitida("telefone", true)).toBe(false);
  });
});

describe("ehEstagiario", () => {
  it("pega o cargo como está escrito no cadastro", () => {
    expect(ehEstagiario("Estagiário Dev Fullstack")).toBe(true);
    expect(ehEstagiario("ESTAGIARIO")).toBe(true);
    expect(ehEstagiario("Dev FullStack")).toBe(false);
  });
});

describe("conferir · documento", () => {
  /* O caso que motivou tudo: quatro pessoas com o CNPJ da própria Takeat. */
  it("acusa quem está com o CNPJ da Takeat", () => {
    const a = erros(pessoa({ documento: CNPJ_TAKEAT }));
    expect(a.some((x) => x.campo === "documento" && /CNPJ da Takeat/.test(x.mensagem))).toBe(true);
  });

  /* Kelly e Caio, no espelho real: o documento é o CNPJ da Takeat e o PIX é o
     CNPJ verdadeiro delas — a planilha confirmou os dois. Dizer só "CNPJ
     diferente" mandaria alguém procurar o documento certo que já está ali. */
  it("quando o documento é o da Takeat, aponta o PIX como o CNPJ provável", () => {
    const a = erros(pessoa({ documento: CNPJ_TAKEAT, pix: "29047247000145" }));
    expect(a.some((x) => x.campo === "pix" && /parece ser o CNPJ correto/.test(x.mensagem))).toBe(true);
  });

  it("acusa documento inválido mesmo com 14 dígitos", () => {
    expect(erros(pessoa({ documento: "66744328000121" }))[0].mensagem).toMatch(/inválido/);
  });

  it("acusa documento truncado, dizendo quantos dígitos tem", () => {
    expect(erros(pessoa({ documento: "58313176" }))[0].mensagem).toMatch(/8 dígitos/);
  });

  it("CPF de estagiário passa; de não-estagiário vira aviso", () => {
    const estag = conferir(pessoa({
      documento: "16146305774", pix: "16146305774", cargo: "Estagiário Dev Fullstack",
    }));
    expect(estag).toHaveLength(0);

    const outro = conferir(pessoa({
      documento: "16146305774", pix: "16146305774", cargo: "Vendedor",
    }));
    expect(outro.some((x) => /sem ser estagi/i.test(x.mensagem))).toBe(true);
  });
});

describe("conferir · chave PIX", () => {
  it("barra a chave aleatória — são duas no cadastro", () => {
    const a = erros(pessoa({ pix: "93c94e57-d72a-4513-b2f0-ed195fcd1ff2" }));
    expect(a[0].mensagem).toMatch(/aleatória/);
  });

  it("barra o e-mail sem TLD", () => {
    expect(erros(pessoa({ pix: "scaetano.takeat@gnm" }))[0].mensagem).toMatch(/não é um e-mail/);
  });

  it("barra CPF como chave de quem não é estagiário", () => {
    expect(erros(pessoa({ pix: "16146305774", cargo: "Coordenador" }))[0].mensagem)
      .toMatch(/só vale para estagi/);
  });

  /* A empresa não paga em CNPJ de terceiro — confirmado em 26/08/2026. */
  it("barra PIX de outro CNPJ", () => {
    const a = erros(pessoa({ documento: "66744328000120", pix: "39988921000140" }));
    expect(a.some((x) => /não paga em CNPJ de terceiro/.test(x.mensagem))).toBe(true);
  });

  /* Stheferson e Emanuelle, no espelho real: um dígito trocado. Chamar isso de
     "CNPJ de terceiro" faria alguém procurar uma segunda empresa que não
     existe. */
  it("distingue digitação de CNPJ de terceiro", () => {
    const a = erros(pessoa({ documento: "45026075000180", pix: "42026075000180" }));
    expect(a.some((x) => /difere do documento em 1 dígito/.test(x.mensagem))).toBe(true);
  });

  it("mostra o CPF na mensagem — quem cobra o DH precisa dizer qual é", () => {
    const a = erros(pessoa({ pix: "16146305774", cargo: "Coordenador" }));
    expect(a[0].mensagem).toContain("161.463.057-74");
  });

  it("chave vazia é aviso, não erro — dá para pagar corrigindo antes", () => {
    const a = conferir(pessoa({ pix: "" }));
    expect(a).toHaveLength(1);
    expect(a[0].gravidade).toBe("aviso");
  });

  it("a pessoa em ordem não gera achado nenhum", () => {
    expect(conferir(pessoa())).toHaveLength(0);
  });
});

describe("medianasPorDepartamento", () => {
  /* Mediana e não média: um diretor de 22.500 num time de 2.400 puxaria a
     média e faria o time inteiro parecer mal pago. */
  it("ignora o extremo que a média não ignoraria", () => {
    const m = medianasPorDepartamento([
      { departamento: "Suporte", valor: 2400 },
      { departamento: "Suporte", valor: 2400 },
      { departamento: "Suporte", valor: 2600 },
      { departamento: "Suporte", valor: 22500 },
    ]);
    expect(m.get("Suporte")).toEqual({ mediana: 2500, n: 4 });
  });

  it("ignora quem não tem departamento ou valor", () => {
    const m = medianasPorDepartamento([
      { departamento: null, valor: 5000 },
      { departamento: "Suporte", valor: 0 },
    ]);
    expect(m.size).toBe(0);
  });
});

describe("conferir · salário", () => {
  const medianas = medianasPorDepartamento(
    Array.from({ length: 6 }, () => ({ departamento: "Onboarding e Setup", valor: 2400 })),
  );

  /* O caso real: o espelho trazia R$ 24.000 para quem ganha R$ 2.400. */
  it("acusa o dígito a mais", () => {
    const a = conferir(pessoa({ departamento: "Onboarding e Setup", valor: 24000 }), medianas);
    expect(a.some((x) => /10,0× a mediana/.test(x.mensagem))).toBe(true);
  });

  it("acusa o valor absurdamente baixo também", () => {
    const a = conferir(pessoa({ departamento: "Onboarding e Setup", valor: 240 }), medianas);
    expect(a.some((x) => /abaixo da mediana/.test(x.mensagem))).toBe(true);
  });

  it("não acusa variação normal", () => {
    for (const v of [2400, 3000, 5000, 1200]) {
      const a = conferir(pessoa({ departamento: "Onboarding e Setup", valor: v }), medianas);
      expect(a.filter((x) => x.campo === "valor"), String(v)).toHaveLength(0);
    }
  });

  /* Com duas pessoas a "mediana" é a média delas, e qualquer diferença vira
     alarme. Departamento pequeno demais não é comparável. */
  it("não compara departamento com menos de 4 pessoas", () => {
    const poucos = medianasPorDepartamento([
      { departamento: "Receita", valor: 2000 },
      { departamento: "Receita", valor: 2000 },
    ]);
    const a = conferir(pessoa({ departamento: "Receita", valor: 22500 }), poucos);
    expect(a.filter((x) => x.campo === "valor")).toHaveLength(0);
  });

  it("sem mediana nenhuma, não inventa comparação", () => {
    expect(conferir(pessoa({ valor: 99999 }))).toHaveLength(0);
  });
});

describe("distanciaDeUmDigito", () => {
  it("reconhece os dois casos reais de digitação", () => {
    expect(distanciaDeUmDigito("45026075000180", "42026075000180")).toBe(true);
    expect(distanciaDeUmDigito("50562257000105", "50564257000105")).toBe(true);
  });

  it("dois documentos de empresas diferentes não são digitação", () => {
    expect(distanciaDeUmDigito("66744328000120", "39988921000140")).toBe(false);
  });

  it("iguais não contam, e tamanhos diferentes não se comparam", () => {
    expect(distanciaDeUmDigito("66744328000120", "66744328000120")).toBe(false);
    expect(distanciaDeUmDigito("66744328000120", "6674432800012")).toBe(false);
  });
});
