import { describe, it, expect } from "vitest";
import {
  parseCsv, emRegistros, numeroBR, dataDaPlanilha, cnpjsEm, nomeProprio,
  siteComoApelido, juntarDetalhes, maisComum,
  candidatosDeNfsColaboradores, candidatosDeEventos, candidatosDeReembolsos,
  candidatosDeCompras,
} from "@/lib/planilhasApelidos";

/* Os casos abaixo NÃO são inventados: cada um saiu de uma linha real das quatro
   planilhas, conferida em 13/08/2026. É por isso que o parser é um módulo à
   parte — essas sujeiras só aparecem olhando o arquivo. */

describe("CSV", () => {
  it("respeita vírgula e quebra de linha dentro do campo", () => {
    const csv = 'a,b\n"vem, com vírgula","tem\nduas linhas"\n';
    expect(parseCsv(csv)).toEqual([["a", "b"], ["vem, com vírgula", "tem\nduas linhas"]]);
  });

  it("descarta linha totalmente vazia", () => {
    expect(emRegistros("a,b\n1,2\n,\n")).toEqual([{ a: "1", b: "2" }]);
  });
});

describe("valor", () => {
  // "apenas números e vírgula", pediu o formulário. Recebeu de tudo.
  it("lê o formato brasileiro", () => {
    expect(numeroBR("1.616,56")).toBe(1616.56);
    expect(numeroBR("2.921,25")).toBe(2921.25);
    expect(numeroBR("145")).toBe(145);
  });

  // Alguém digitou "R$ 127.39" com PONTO decimal. Sem a regra do ponto isso
  // viraria R$ 12.739 e casaria com a fatura errada.
  it("entende ponto decimal quando não há vírgula", () => {
    expect(numeroBR("R$ 127.39 ")).toBe(127.39);
    expect(numeroBR("90.00")).toBe(90);
  });

  // A parcela vem de uma divisão feita pelo próprio formulário.
  it("arredonda a dízima da parcela para as duas casas da fatura", () => {
    expect(numeroBR("237.6633333")).toBe(237.66);
    expect(numeroBR("1020.173333")).toBe(1020.17);
  });

  it("recusa vazio, zero e texto", () => {
    for (const v of ["", "  ", "0", "abc", null]) expect(numeroBR(v)).toBeNull();
  });
});

describe("data", () => {
  it("lê dd/mm/aaaa com hora", () => {
    expect(dataDaPlanilha("30/09/2025 13:23:02")).toBe("2025-09-30");
  });

  // A planilha de Reembolsos veio com locale americano.
  it("lê mm/dd/aaaa quando avisado", () => {
    expect(dataDaPlanilha("11/19/2024 12:27:13", "mdy")).toBe("2024-11-19");
  });

  it("recusa mês impossível e lixo", () => {
    expect(dataDaPlanilha("30/09/2025", "mdy")).toBeNull();
    expect(dataDaPlanilha("sem data")).toBeNull();
  });
});

describe("CNPJ em texto livre", () => {
  // Metade dos CNPJs da planilha de Eventos está enterrada na observação.
  it("acha o CNPJ no meio da frase, com e sem pontuação", () => {
    expect(cnpjsEm("PIX para pagamento 34723501000118 Cuer negócios")).toEqual(["34723501000118"]);
    expect(cnpjsEm("Pix 47.077.349/0001-95")).toEqual(["47077349000195"]);
  });

  it("não confunde telefone nem chave pix aleatória", () => {
    expect(cnpjsEm("pix celular 51993914046")).toEqual([]);
    expect(cnpjsEm("Chave pix aleatória - ff1835ac-1d93-44a7-bee6-1b09c4df012")).toEqual([]);
  });
});

describe("nome próprio", () => {
  it("arruma o que veio gritado", () => {
    expect(nomeProprio("MICHAEL CARDOSO THOMÉ")).toBe("Michael Cardoso Thomé");
    expect(nomeProprio("JULYAN RIBEIRO")).toBe("Julyan Ribeiro");
  });

  it("deixa em paz quem já veio com capricho", () => {
    expect(nomeProprio("Leonardo Carvalho E Moura")).toBe("Leonardo Carvalho E Moura");
  });

  it("mantém a preposição minúscula", () => {
    expect(nomeProprio("MAURO SÉRGIO DE ANDRADE DA SILVA")).toBe("Mauro Sérgio de Andrade da Silva");
  });
});

describe("site como apelido", () => {
  it("aceita nome de loja", () => {
    expect(siteComoApelido("Kabum")).toBe("Kabum");
    expect(siteComoApelido("Mercado Livre")).toBe("Mercado Livre");
  });

  it("descarta o 'não foi compra online'", () => {
    expect(siteComoApelido("Não foi uma compra online")).toBeNull();
  });

  // Uma resposta real tinha 300 caracteres de utm_campaign.
  it("de URL fica só o domínio", () => {
    expect(siteComoApelido("https://cmosummit.com.br/?utm_source=google&utm_medium=cpc&gclid=Cj0KC"))
      .toBe("Cmosummit.com.br");
    expect(siteComoApelido("buser.com.br")).toBe("Buser.com.br");
  });

  // "Compra foi no Hubspot, em Dólares. U$145.80" é frase, não rótulo.
  it("descarta frase no lugar do nome", () => {
    expect(siteComoApelido("Compra foi no Hubspot, em Dólares. U$145.80")).toBeNull();
    expect(siteComoApelido("link de pagamento")).toBeNull();
  });
});

describe("juntar detalhes", () => {
  it("tira repetido e começa pelas frases curtas", () => {
    expect(juntarDetalhes(["Café - Quarta", "café - quarta", "Bolos da Reunião Geral"]))
      .toBe("Café - Quarta · Bolos da Reunião Geral");
  });

  it("respeita o teto sem devolver vazio", () => {
    const r = juntarDetalhes(["x".repeat(500)], 100);
    expect(r).toHaveLength(100);
  });

  it("devolve nulo quando não há frase", () => {
    expect(juntarDetalhes([null, "", "   "])).toBeNull();
  });
});

describe("mais comum", () => {
  it("escolhe o que mais aparece", () => {
    expect(maisComum(["RH", "RH", "Comercial"])).toBe("RH");
    expect(maisComum([null, ""])).toBeNull();
  });
});

/* ------------------------------------------------------------------ fontes */

describe("NFs Colaboradores", () => {
  const csv = [
    "Carimbo de data/hora,Nome completo,Número CNPJ (sem pontos ou traços),Setor,A nota se refere a: ,Valor",
    '28/04/2026 19:03:22,Michael Cardoso Thomé,46.148.025/0001-38,Comercial,Remuneração,"R$ 9.500,00"',
    '28/04/2026 19:10:20,Michael Cardoso Thomé,46.148.025/0001-38,Comercial,Comissão,"R$ 500,00"',
    '29/04/2026 15:06:37,Karolyne de Oliveira Araujo,56794388000102,Sucesso,Remuneração,"R$ 2.800,00"',
  ].join("\n");

  it("agrupa por CNPJ e responde 'o que é'", () => {
    const c = candidatosDeNfsColaboradores(csv);
    expect(c).toHaveLength(2);
    const michael = c.find((x) => x.cnpj === "46148025000138")!;
    expect(michael.apelido).toBe("Michael Cardoso Thomé");
    expect(michael.chaveTipo).toBe("cnpj");
    // Duas notas, "Remuneração" e "Comissão" — vence a que mais aparece; empate
    // fica com a primeira, e as duas respondem a pergunta igual.
    expect(michael.oQueE).toMatch(/Comercial$/);
  });

  it("aceita CNPJ com e sem pontuação", () => {
    expect(candidatosDeNfsColaboradores(csv).map((c) => c.cnpj).sort())
      .toEqual(["46148025000138", "56794388000102"]);
  });
});

describe("Eventos & Parcerias", () => {
  const csv = [
    "Timestamp,Nome da consultoria/Cliente/Garçom,Canal,Valor da NF,Beneficiário,Observações (Opcional),CNPJ do Beneficiário",
    "04/12/2024,Laiana Cuer,Consultor e Influenciador,,,PIX para pagamento 34723501000118 Cuer negócios,",
    "10/03/2025,Fabiano Dias,Influencer (Variável),,,,",
    "11/03/2025,Fabiano Dias,Influencer (Variável),,,,",
  ].join("\n");

  it("com CNPJ na observação vira casamento por CNPJ", () => {
    const laiana = candidatosDeEventos(csv).find((c) => c.apelido === "Laiana Cuer")!;
    expect(laiana.chaveTipo).toBe("cnpj");
    expect(laiana.cnpj).toBe("34723501000118");
  });

  it("sem CNPJ sobra o nome, e o nome não é identidade", () => {
    const fabiano = candidatosDeEventos(csv).find((c) => c.apelido === "Fabiano Dias")!;
    expect(fabiano.chaveTipo).toBe("nome");
    expect(fabiano.oQueE).toBe("Influencer (Variável)");
  });

  it("ignora as linhas em que o nome é só 'Cliente'", () => {
    const csv2 = "Timestamp,Nome da consultoria/Cliente/Garçom,Canal\n18/03/2025,Cliente,Indique e Ganhe";
    expect(candidatosDeEventos(csv2)).toHaveLength(0);
  });
});

describe("Reembolsos", () => {
  const csv = [
    "Timestamp,Nome completo,Setor,Valor total do reembolso,Motivo do reembolso,CNPJ",
    "11/19/2024 15:17:47,Amanda Rodrigues Zuccolotto,Administrativo,22.54,Entrega Moto Flash - Camisas Takeat,",
    "11/21/2024 15:46:01,Amanda Rodrigues Zuccolotto,Administrativo,182.00,Confraternização,",
    "11/25/2024 15:50:55,Lucas Segatto,Comercial,127.39,Almoço,",
  ].join("\n");

  // O reembolso é pago À PESSOA: no Omie a contraparte é o colaborador, e o que
  // esta planilha entrega é o que aquele PIX foi.
  it("agrupa por pessoa e resume os motivos", () => {
    const c = candidatosDeReembolsos(csv);
    expect(c).toHaveLength(2);
    const amanda = c.find((x) => x.apelido === "Amanda Rodrigues Zuccolotto")!;
    expect(amanda.oQueE).toContain("Reembolsos · Administrativo");
    expect(amanda.oQueE).toContain("Confraternização");
    expect(amanda.detalhe).toBe("2 reembolso(s) pedido(s) pelo formulário");
  });

  it("sem CNPJ casa por nome", () => {
    expect(candidatosDeReembolsos(csv).every((c) => c.chaveTipo === "nome")).toBe(true);
  });
});

describe("Compras", () => {
  const csv = [
    "Carimbo de data/hora,Nome Completo,Setor,Tipo de Compra,Valor (Apenas números e vírgula),Forma de Pagamento,Número de Parcelas,Valor da Parcela,Caso tenha sido uma compra online indique o site em que foi realizada,Descreva aqui a justificativa desta compra",
    '30/09/2025 13:23:02,Henrique,Financeiro,Equipamentos,"1616,56",Cartão de Crédito,12,"134,71",Kabum,Memórias RAM para os notebooks',
    '01/10/2025 12:13:46,Amanda,RH,Materiais de Escritório,"143,45",Cartão de Crédito,1,"143,45",Não foi uma compra online,Mouse e mouse pad',
    '13/02/2026 00:00:00,Ninguém,RH,Nada,,Pix,,,,',
  ].join("\n");

  // O total é 1616,56 e a fatura mostra 134,71. Casar pelo total achava 31
  // lojistas; pela parcela acha 48.
  it("devolve o valor da PARCELA, que é o que está na fatura", () => {
    const c = candidatosDeCompras(csv);
    expect(c[0].valor).toBe(134.71);
    expect(c[0].data).toBe("2025-09-30");
    expect(c[0].apelido).toBe("Kabum");
  });

  it("compra presencial fica sem apelido mas mantém a justificativa", () => {
    const presencial = candidatosDeCompras(csv)[1];
    expect(presencial.apelido).toBe("");
    expect(presencial.detalhe).toBe("Mouse e mouse pad");
    expect(presencial.oQueE).toBe("Materiais de Escritório");
  });

  it("descarta linha sem valor ou sem data", () => {
    expect(candidatosDeCompras(csv)).toHaveLength(2);
  });
});
