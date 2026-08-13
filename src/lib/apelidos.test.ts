import { describe, it, expect } from "vitest";
import {
  montarMapaApelidos, apelidoDe, nomeExibido, apelidosNoTexto, jaTemApelido,
  sugestaoDeApelido, enigmatica, presenca, filaDeAnonimos, cobertura,
  intervaloDaJanela, rotuloMesFechado, planoNomeQueJaServe,
  MAPA_APELIDOS_VAZIO, type Apelido, type Candidato,
} from "@/lib/apelidos";

const cafe: Apelido = {
  id: "f1",
  nome: "JIM COM GRUPO SOUZA",
  apelido: "Café dos eventos",
  oQueE: "Coffee break dos eventos presenciais",
  dono: "Luiza Freitas",
  origem: "cartao",
};

const dalber: Apelido = {
  id: "f2",
  nome: "DALBER NEGOCIOS LTDA",
  apelido: "Dalber",
  documento: "45.462.019/0001-98",
  origem: "omie",
};

const mapa = montarMapaApelidos([cafe, dalber], [
  { fornecedor_id: "f1", alias: "JIM.COM GRUPO SOUZA" },
  { fornecedor_id: "f1", alias: "GRUPO SOUZA MOGI" },
]);

describe("casamento do nome", () => {
  it("acha pela grafia canônica", () => {
    expect(apelidoDe(mapa, "JIM COM GRUPO SOUZA")?.apelido).toBe("Café dos eventos");
  });

  // O drill-down mostra "JIM.COM" (do memo do OFX) e a tabela do cartão guarda
  // "JIM COM" (o ponto cai no `limparNome`). Tem de ser a mesma coisa.
  it("ignora pontuação, acento e caixa", () => {
    expect(nomeExibido(mapa, "JIM.COM GRUPO SOUZA")).toBe("Café dos eventos");
    expect(nomeExibido(mapa, "jim com grupo souza")).toBe("Café dos eventos");
  });

  it("ignora o sufixo societário", () => {
    expect(nomeExibido(mapa, "DALBER NEGOCIOS")).toBe("Dalber");
    expect(nomeExibido(mapa, "Dalber Negócios Ltda.")).toBe("Dalber");
  });

  it("acha por uma grafia alternativa cadastrada", () => {
    expect(nomeExibido(mapa, "GRUPO SOUZA MOGI")).toBe("Café dos eventos");
  });

  it("acha pelo documento mesmo quando o nome não bate", () => {
    expect(apelidoDe(mapa, "NOME QUE NINGUEM CADASTROU", "45462019000198")?.apelido).toBe("Dalber");
  });

  it("devolve o nome cru quando não conhece", () => {
    expect(nomeExibido(mapa, "PADARIA DO ZE")).toBe("PADARIA DO ZE");
    expect(jaTemApelido(mapa, "PADARIA DO ZE")).toBe(false);
  });

  it("não quebra com mapa vazio nem com nome nulo", () => {
    expect(nomeExibido(MAPA_APELIDOS_VAZIO, "QUALQUER")).toBe("QUALQUER");
    expect(nomeExibido(mapa, null)).toBe("");
    expect(apelidoDe(null, "JIM COM GRUPO SOUZA")).toBeNull();
  });

  // Uma chave de 2 ou 3 letras casaria palavra comum no meio de uma frase e
  // trocaria o nome de quem não devia.
  it("recusa chave curta demais", () => {
    const curto = montarMapaApelidos([{ id: "x", nome: "ASA", apelido: "Asa Locadora" }]);
    expect(nomeExibido(curto, "ASA")).toBe("ASA");
  });

  it("ignora cadastro sem apelido preenchido", () => {
    const semNome = montarMapaApelidos([{ id: "y", nome: "NINECOMERCIO", apelido: "  " }]);
    expect(nomeExibido(semNome, "NINECOMERCIO")).toBe("NINECOMERCIO");
  });

  // Alias cujo fornecedor ainda não tem apelido não pode virar entrada solta no
  // mapa: apontaria para um cadastro que não existe.
  it("descarta alias de fornecedor fora do cadastro", () => {
    const orfao = montarMapaApelidos([cafe], [{ fornecedor_id: "inexistente", alias: "OUTRA COISA" }]);
    expect(nomeExibido(orfao, "OUTRA COISA")).toBe("OUTRA COISA");
  });
});

describe("troca dentro do texto", () => {
  it("troca preservando o resto da frase", () => {
    const t = apelidosNoTexto(mapa, "A saída de DALBER NEGOCIOS (-R$ 27,2k) explica a variação.");
    expect(t).toBe("A saída de Dalber (-R$ 27,2k) explica a variação.");
  });

  it("troca também a grafia alternativa", () => {
    expect(apelidosNoTexto(mapa, "Pagamento a JIM.COM GRUPO SOUZA em julho."))
      .toBe("Pagamento a Café dos eventos em julho.");
  });

  it("não mexe no texto quando não há o que trocar", () => {
    expect(apelidosNoTexto(mapa, "Sem contraparte conhecida.")).toBe("Sem contraparte conhecida.");
  });
});

describe("sugestão do campo", () => {
  it("arruma a caixa sem inventar significado", () => {
    expect(sugestaoDeApelido("JIM COM GRUPO SOUZA")).toBe("Jim Com Grupo Souza");
    expect(sugestaoDeApelido("DALBER NEGOCIOS LTDA")).toBe("Dalber Negocios");
  });

  it("devolve vazio para entrada vazia", () => {
    expect(sugestaoDeApelido("")).toBe("");
    expect(sugestaoDeApelido(null)).toBe("");
  });
});

describe("ordem da fila", () => {
  const c = (
    nome: string, lancamentos: number, total: number,
    categoria = "Software / SaaS", origem = "cartao",
  ): Candidato => ({
    origem, nome, documento: null, categoria, cidade: null,
    lancamentos, total, primeira: null, ultima: null,
  });

  it("categoria genérica é enigmática; categoria que diz o que é, não", () => {
    expect(enigmatica(c("KNDTEC", 15, 16_835, "Outros (diversos)"))).toBe(true);
    expect(enigmatica(c("KNDTEC", 15, 16_835, "Equipamentos / TI"))).toBe(false);
  });

  // "COMARELLA PIZZA BURG" tem exatamente 20 caracteres porque o OFX cortou.
  it("lojista de cartão cortado no limite do OFX é enigmático", () => {
    expect(enigmatica(c("COMARELLA PIZZA BURG", 8, 6_615, "Viagem / Transporte"))).toBe(true);
    // Do lado do Omie não há corte: 20 caracteres ali é coincidência, e
    // "LUCAS SEGATTO SOARES" não é um nome pela metade.
    expect(enigmatica(c("LUCAS SEGATTO SOARES", 31, 57_725, "3.1.1.2. Pessoal", "omie"))).toBe(false);
  });

  // A regra de "nome curto" existia e foi retirada: jogava marca legível para o
  // topo. Este teste é o que impede alguém de recolocá-la.
  it("nome curto de marca conhecida NÃO é enigmático", () => {
    for (const marca of ["UBER", "GOL", "DELL", "AZUL", "99"]) {
      expect(enigmatica(c(marca, 100, 20_000, "Viagem / Transporte"))).toBe(false);
    }
  });

  /* O caso que quebrou a primeira versão: a tela abriu com transferência entre
     contas próprias e pagamento de fatura no topo. Aqueles dois saem antes, no
     SQL; o que sobrava eram os grandes e legíveis — e o critério do nome tem de
     colocá-los ATRÁS do KNDTEC mesmo valendo 55x mais. */
  it("o gasto ilegível vem antes do gasto grande e óbvio", () => {
    const fila = filaDeAnonimos([
      c("META ADS", 82, 922_181, "Mídia / Tráfego pago"),
      c("HUBSPOT", 18, 211_394, "Software / SaaS"),
      c("KNDTEC", 15, 16_835, "Outros (diversos)"),
      c("BONES VIX", 15, 8_123, "Outros (diversos)"),
    ], null);
    expect(fila.map((f) => f.nome)).toEqual(["KNDTEC", "BONES VIX", "META ADS", "HUBSPOT"]);
  });

  it("dentro do mesmo tier, quem aparece mais vem antes", () => {
    const fila = filaDeAnonimos([
      c("FPANAPRATI", 16, 1_963, "Outros (diversos)"),
      c("BR DID TELEFONIA", 89, 2_821, "Outros (diversos)"),
    ], null);
    expect(fila[0].nome).toBe("BR DID TELEFONIA");
  });

  // Em log o valor ordena mas não manda: senão um fornecedor grande atravessa
  // o critério do nome, que é o que se quer evitar.
  it("o valor pesa pouco no desempate", () => {
    const grande = c("A", 10, 900_000, "Outros (diversos)");
    const pequeno = c("B", 10, 17_000, "Outros (diversos)");
    expect(presenca(grande) / presenca(pequeno)).toBeLessThan(1.5);
  });

  it("tira da fila quem já tem apelido", () => {
    const fila = filaDeAnonimos(
      [c("JIM COM GRUPO SOUZA", 2, 4_292), c("KNDTEC", 15, 16_835, "Outros (diversos)")],
      mapa,
    );
    expect(fila.map((f) => f.nome)).toEqual(["KNDTEC"]);
  });

  it("aguenta contraparte sem número", () => {
    expect(presenca(c("VAZIO", 0, 0))).toBe(0);
  });
});

describe("janela de tempo", () => {
  const emAgosto = new Date(2026, 7, 13);   // 13/08/2026

  it("mês fechado é o mês anterior inteiro", () => {
    expect(intervaloDaJanela("fechado", emAgosto)).toEqual({ de: "2026-07-01", ate: "2026-07-31" });
    expect(rotuloMesFechado(emAgosto)).toBe("Jul 26");
  });

  // Dia 0 do mês corrente = último dia do anterior. Fevereiro e bissexto saem
  // certos sem tabela de dias — é por isso que a conta é assim.
  it("acerta fevereiro e ano bissexto", () => {
    expect(intervaloDaJanela("fechado", new Date(2026, 2, 10))).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(intervaloDaJanela("fechado", new Date(2028, 2, 10))).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
  });

  it("vira o ano para trás em janeiro", () => {
    expect(intervaloDaJanela("fechado", new Date(2026, 0, 5))).toEqual({ de: "2025-12-01", ate: "2025-12-31" });
    expect(rotuloMesFechado(new Date(2026, 0, 5))).toBe("Dez 25");
  });

  it("janela móvel conta para trás e fica aberta na frente", () => {
    expect(intervaloDaJanela("3m", emAgosto)).toEqual({ de: "2026-05-13", ate: null });
    expect(intervaloDaJanela("12m", emAgosto)).toEqual({ de: "2025-08-13", ate: null });
  });

  it("'tudo' não corta nada", () => {
    expect(intervaloDaJanela("tudo", emAgosto)).toEqual({ de: null, ate: null });
  });
});

describe("cobertura", () => {
  // Medida em valor: nomear 300 lojistas de R$ 50 não muda uma reunião.
  it("mede o dinheiro, não a contagem", () => {
    const candidatos: Candidato[] = [
      { origem: "cartao", nome: "JIM COM GRUPO SOUZA", documento: null, categoria: null, cidade: null, lancamentos: 2, total: 900, primeira: null, ultima: null },
      { origem: "cartao", nome: "ANONIMO A", documento: null, categoria: null, cidade: null, lancamentos: 1, total: 50, primeira: null, ultima: null },
      { origem: "cartao", nome: "ANONIMO B", documento: null, categoria: null, cidade: null, lancamentos: 1, total: 50, primeira: null, ultima: null },
    ];
    const r = cobertura(candidatos, mapa);
    expect(r.nomeadas).toBe(1);
    expect(r.total).toBe(3);
    expect(r.pct).toBeCloseTo(0.9, 5);
  });

  it("não divide por zero sem candidatos", () => {
    expect(cobertura([], mapa).pct).toBe(0);
  });
});
describe("o nome que já serve", () => {
  const c = (nome: string, origem = "cartao"): Candidato => ({
    origem, nome, documento: null, categoria: null, cidade: null,
    lancamentos: 1, total: 100, primeira: null, ultima: null,
  });

  // A grafia gravada é a arrumada, não o berro do extrato: é este texto que a
  // DRE vai mostrar.
  it("grava com a caixa arrumada e sem sufixo societário", () => {
    const p = planoNomeQueJaServe([c("JUSBRASIL"), c("MOVIDA LOCACAO LTDA", "omie")]);
    expect(p.gravar.map((g) => g.apelido)).toEqual(["Jusbrasil", "Movida Locacao"]);
  });

  // A mesma contraparte pode vir duas vezes — uma linha do cartão e outra do
  // Omie. Gravar as duas criaria dois cadastros com a mesma chave; a segunda sai
  // da fila junto com a primeira, porque é a chave que a tira de lá.
  it("grava uma vez só quando a mesma contraparte vem pelos dois lados", () => {
    const p = planoNomeQueJaServe([c("UBER"), c("Uber Ltda", "omie")]);
    expect(p.gravar).toHaveLength(1);
    expect(p.repetidas).toHaveLength(1);
  });

  // Nome curto casaria palavra comum no meio de uma frase. Em lote a recusa
  // precisa vir antes, senão some no meio do gesto.
  it("separa o que é curto demais para casar sozinho", () => {
    const p = planoNomeQueJaServe([c("DM"), c("JUSBRASIL")]);
    expect(p.curtas.map((x) => x.nome)).toEqual(["DM"]);
    expect(p.gravar.map((g) => g.apelido)).toEqual(["Jusbrasil"]);
  });

  it("não quebra com lista vazia", () => {
    expect(planoNomeQueJaServe([])).toEqual({ gravar: [], repetidas: [], curtas: [] });
  });
});
