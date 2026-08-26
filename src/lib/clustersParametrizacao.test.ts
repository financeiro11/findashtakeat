import { describe, expect, it } from "vitest";
import { chaveContraparte, type Candidato } from "@/lib/apelidos";
import {
  agruparGrafias, chaveGrafia, dominioDe, lojistaDe, ordenarGrupos,
  palavrasUteis, pior, totalDoGrupo,
} from "@/lib/clustersParametrizacao";

/* Os casos abaixo saíram todos da fila de verdade (12 meses, agosto de 2026) —
   não são exemplos inventados para o teste passar. */

const c = (p: Partial<Candidato> & { nome: string }): Candidato => ({
  origem: "cartao",
  documento: null,
  categoria: "Outros (diversos)",
  cidade: null,
  lancamentos: 1,
  total: 100,
  primeira: null,
  ultima: null,
  ...p,
});

const nomesDo = (g: { grafias: Candidato[] }) => g.grafias.map((x) => x.nome).sort();
const grupoCom = <T extends { grafias: Candidato[] }>(grupos: T[], nome: string) =>
  grupos.find((g) => g.grafias.some((x) => x.nome === nome))!;

describe("pedaços do nome", () => {
  it("acha o domínio e ignora o que só tem ponto", () => {
    expect(dominioDe("DL*BOOKING.COM")).toBe("BOOKING");
    expect(dominioDe("JIM.COM GRUPO SOUZA")).toBe("JIM");
    expect(dominioDe("CAFE.EXPRESS")).toBe("");
    expect(dominioDe("BANCO BTG PACTUAL S.A.")).toBe("");
  });

  it("pega o lojista antes do asterisco, mas não a bandeira do adquirente", () => {
    expect(lojistaDe("FACEBK *ADS AB12X9")).toBe("FACEBK");
    expect(lojistaDe("GOOGLE *GSUITE_TAKEAT")).toBe("GOOGLE");
    expect(lojistaDe("DL*BOOKING.COM")).toBe(""); // "DL" é a maquininha
    expect(lojistaDe("AIRBNB")).toBe("");
  });

  it("tira as palavras que não identificam ninguém", () => {
    expect(palavrasUteis("ACABAMENTO MATERIAL DE CONSTRUCAO LTDA"))
      .toEqual(["ACABAMENTO", "MATERIAL", "CONSTRUCAO"]);
    expect(palavrasUteis("BANCO BTG PACTUAL S.A.")).toEqual(["BANCO", "BTG", "PACTUAL"]);
  });

  it("a confiança do grupo é a pior das pontas", () => {
    expect(pior("alta", "baixa")).toBe("baixa");
    expect(pior("media", "alta")).toBe("media");
    expect(pior("alta", "alta")).toBe("alta");
  });
});

describe("agruparGrafias", () => {
  it("junta o que o OFX cortou no meio da palavra", () => {
    const grupos = agruparGrafias([
      c({ nome: "AFIXCODE SOLU" }),
      c({ nome: "AFIXCODE SOLUCOE" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe("corte do extrato");
    expect(nomesDo(grupos[0])).toEqual(["AFIXCODE SOLU", "AFIXCODE SOLUCOE"]);
  });

  it("junta o que o adquirente colou sem espaço", () => {
    const grupos = agruparGrafias([
      c({ nome: "BONES VIX", lancamentos: 15 }),
      c({ nome: "BONESVIXCOMERCIO", lancamentos: 2 }),
    ]);
    expect(grupos).toHaveLength(1);
    // A que aparece mais dá o nome ao cadastro.
    expect(grupos[0].grafias[0].nome).toBe("BONES VIX");
  });

  it("junta pelo CNPJ mesmo com a grafia diferente, e a linha com documento lidera", () => {
    const grupos = agruparGrafias([
      c({ origem: "omie", nome: "Banestes", documento: "28.127.603/0001-78", lancamentos: 4, categoria: "Tarifas" }),
      c({ origem: "omie", nome: "TARIFAS DE COBRANCA", documento: "28127603000178", lancamentos: 10, categoria: "Tarifas" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe("CNPJ igual");
    // A que aparece mais tem documento também; entre iguais, ganha a de mais lançamentos.
    expect(grupos[0].grafias[0].nome).toBe("TARIFAS DE COBRANCA");
  });

  it("o grupo vale pela junção mais frouxa que tem dentro", () => {
    // CNPJ é certeza; "mesma marca" é palpite. Um palpite dentro do grupo já
    // basta para o grupo inteiro pedir leitura.
    const grupos = agruparGrafias([
      c({ origem: "omie", nome: "Banestes", documento: "28.127.603/0001-78", lancamentos: 10 }),
      c({ origem: "omie", nome: "BANESTES TARIFAS", documento: "28127603000178", lancamentos: 4 }),
      c({ nome: "BANESTES CARTAO", lancamentos: 99 }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe("mesma marca");
    expect(grupos[0].grafias[0].documento).toBeTruthy();
  });

  it("junta pelo domínio e pelo lojista do cartão", () => {
    const grupos = agruparGrafias([
      c({ nome: "DL*BOOKING.COM" }),
      c({ nome: "DL*BOOKING.COM AMSTE" }),
      c({ nome: "FACEBK *ADS AB12X9" }),
      c({ nome: "FACEBK *ADS 9KQ2LM" }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupoCom(grupos, "DL*BOOKING.COM").motivo).toBe("mesmo domínio");
    expect(grupoCom(grupos, "FACEBK *ADS AB12X9").motivo).toBe("mesmo lojista");
  });

  it("junta pelo começo do nome quando nenhuma é prefixo da outra", () => {
    const grupos = agruparGrafias([
      c({ nome: "AGUIA BRANCA PASSA" }),
      c({ nome: "AGUIA BRANCA PV" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe("mesmo começo");
    expect(grupos[0].conf).toBe("baixa"); // junção média, e nenhum nome se explica
  });

  it("NÃO junta xarás — primeiro nome igual não é a mesma pessoa", () => {
    const grupos = agruparGrafias([
      c({ origem: "omie", nome: "ANA CLARA ROSSI MONGIN", categoria: "3.1.1.1. Pessoal" }),
      c({ origem: "omie", nome: "ANA JULIA MENDONCA VIEIRA", categoria: "3.1.1.1. Pessoal" }),
      c({ origem: "omie", nome: "ANA BEATRIZ FRANCA INACIO", categoria: "3.1.1.1. Pessoal" }),
      c({ origem: "omie", nome: "BRUNO DE PADUA FISCHER", categoria: "3.1.1.1. Pessoal" }),
      c({ origem: "omie", nome: "BRUNO DE SOUZA BARTZ", categoria: "3.1.1.1. Pessoal" }),
    ]);
    expect(grupos).toHaveLength(5);
  });

  it("NÃO junta pelo substantivo do ramo, mesmo aparecendo duas vezes só", () => {
    const grupos = agruparGrafias([
      c({ origem: "omie", nome: "ADRIANA RIOS TREINAMENTOS E CONSULTORIA LTDA" }),
      c({ origem: "omie", nome: "ANA BROWNIE CURSOS E CONSULTORIA" }),
    ]);
    expect(grupos).toHaveLength(2);
  });

  it("junta a marca com as lojas dela", () => {
    const grupos = agruparGrafias([
      c({ nome: "KABUM", lancamentos: 9 }),
      c({ nome: "KABUM ALPHAPR" }),
      c({ nome: "KABUM RAICROM" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe("mesma marca");
    expect(grupos[0].grafias).toHaveLength(3);
  });

  it("a marca só engole quem não diz o que é", () => {
    // "PATRICIA" no cartão pode ser qualquer uma; a do Omie tem rubrica própria.
    const grupos = agruparGrafias([
      c({ nome: "PATRICIA" }),
      c({ origem: "omie", nome: "PATRICIA ALVES DA SILVA BARBOSA GOIS", categoria: "6.1 Estorno de cliente ASAAS" }),
    ]);
    expect(grupos).toHaveLength(2);
  });

  it("palavra solta de oito letras não basta; com duas palavras, basta", () => {
    expect(agruparGrafias([c({ nome: "LOCALIZA" }), c({ nome: "LOCALIZA RAC" })])).toHaveLength(1);
    expect(agruparGrafias([c({ nome: "BONES VIX" }), c({ nome: "BONESVIXCOMERCIO" })])).toHaveLength(1);
  });

  it("junta o sublojista carimbado pelo adquirente", () => {
    const grupos = agruparGrafias([
      c({ nome: "JIM COM L G DA SILVA" }),
      c({ nome: "JIM COM LAISE GONZAG" }),
      c({ nome: "JIM COM 52833715 LEA" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe("mesmo começo");
  });

  it("NÃO junta pela palavra do ramo, mesmo sendo o começo dos dois nomes", () => {
    // Medido contra a fila de verdade: juntar por palavra em comum acertava
    // KABUM e errava estes. Ver o comentário em `clustersParametrizacao.ts`.
    const grupos = agruparGrafias([
      c({ nome: "CENTRAL DE AVIAMENTO" }),
      c({ nome: "CENTRAL DE UTILID" }),
      c({ nome: "SUPERMERCADO NOBRE" }),
      c({ nome: "SUPERMERCADO PERIM" }),
      c({ nome: "POSTO IPIRANGA VIX" }),
      c({ nome: "AUTO POSTO PORTAL" }),
    ]);
    expect(grupos).toHaveLength(6);
  });

  it("nome que já se explica sozinho vem com sugestão e alta confiança", () => {
    const grupos = agruparGrafias([c({ nome: "ANTHROPIC", categoria: "Software / SaaS" })]);
    expect(grupos[0].motivo).toBe("nome já serve");
    expect(grupos[0].conf).toBe("alta");
    expect(grupos[0].sugestao).toBe("Anthropic");
  });

  it("nome enigmático e sozinho fica em branco — sugerir seria repetir a pergunta", () => {
    const grupos = agruparGrafias([c({ nome: "1CALLWAY" })]);
    expect(grupos[0].motivo).toBe("sem par");
    expect(grupos[0].conf).toBe("baixa");
    expect(grupos[0].sugestao).toBe("");
  });

  it("a planilha manda no nome, e por CNPJ vale como alta", () => {
    const propostas = new Map([
      [chaveContraparte("KNDTEC"), { apelido: "KND Tecnologia", forte: true, fonte: "Compras" }],
    ]);
    const grupos = agruparGrafias([c({ nome: "KNDTEC" })], { propostas });
    expect(grupos[0].sugestao).toBe("KND Tecnologia");
    expect(grupos[0].conf).toBe("alta");
    expect(grupos[0].motivo).toBe("planilha Compras");
  });

  it("junção certa com nome impossível cai para 'precisa ler'", () => {
    // Mesmo CNPJ não deixa dúvida de que são a mesma; o nome continua sem dizer nada.
    const grupos = agruparGrafias([
      c({ origem: "omie", nome: "FPANAPRATI", documento: "11.111.111/0001-11" }),
      c({ origem: "omie", nome: "FPANAPRATI SERV", documento: "11.111.111/0001-11" }),
    ]);
    expect(grupos[0].motivo).toBe("CNPJ igual");
    expect(grupos[0].conf).toBe("baixa");
    expect(grupos[0].sugestao).toBe("");
  });

  it("desligado o agrupamento, cada grafia é uma linha", () => {
    const grupos = agruparGrafias(
      [c({ nome: "AFIXCODE SOLU" }), c({ nome: "AFIXCODE SOLUCOE" })],
      { agrupar: false },
    );
    expect(grupos).toHaveLength(2);
  });

  it("junta a razão social inteira com a versão que o cartão cortou", () => {
    // Nenhum dos dois é prefixo do outro por palavra; por caractere, é.
    const grupos = agruparGrafias([
      c({ nome: "JCM NITEROI REFRIGER" }),
      c({ origem: "omie", nome: "J. C. M. NITEROI REFRIGERACAO LTDA", documento: "08824171004304",
          categoria: "Construção, Reformas e Melhorias" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe("corte do extrato");
  });
});

describe("separar uma grafia", () => {
  const grupo = agruparGrafias([
    c({ nome: "AFIXCODE SOLU", lancamentos: 3, total: 290 }),
    c({ nome: "AFIXCODE SOLUCOE", lancamentos: 1, total: 216 }),
  ])[0];

  it("tira da conta sem tirar da lista", () => {
    const solta = chaveGrafia(grupo.grafias[1]);
    const t = totalDoGrupo(grupo, [solta]);
    expect(t.grafias).toHaveLength(1);
    expect(t.lancamentos).toBe(3);
    expect(t.total).toBe(290);
    expect(grupo.grafias).toHaveLength(2);
  });

  it("sem separação, soma tudo", () => {
    expect(totalDoGrupo(grupo).total).toBe(506);
  });
});

describe("ordenarGrupos", () => {
  it("alta primeiro; dentro da faixa, o dinheiro maior", () => {
    const grupos = agruparGrafias([
      c({ nome: "1CALLWAY", total: 90_000 }),
      c({ nome: "ADOBE", categoria: "Software / SaaS", total: 5_000 }),
      c({ nome: "CANVA", categoria: "Software / SaaS", total: 9_000 }),
    ]);
    const ordem = ordenarGrupos(grupos, (g) => g.total).map((g) => g.grafias[0].nome);
    expect(ordem).toEqual(["CANVA", "ADOBE", "1CALLWAY"]);
  });

  it('em "recente", a última movimentação manda e a confiança sai do critério', () => {
    // 1CALLWAY é a que menos se explica (vinha por último em "valor"), mas é a
    // que apareceu na semana passada — é ela que volta na DRE da reunião.
    const grupos = agruparGrafias([
      c({ nome: "1CALLWAY", total: 90_000, ultima: "2026-08-19" }),
      c({ nome: "ADOBE", categoria: "Software / SaaS", total: 5_000, ultima: "2026-05-02" }),
      c({ nome: "CANVA", categoria: "Software / SaaS", total: 9_000, ultima: "2026-07-30" }),
    ]);
    const ordem = ordenarGrupos(grupos, (g) => g.total, "recente").map((g) => g.grafias[0].nome);
    expect(ordem).toEqual(["1CALLWAY", "CANVA", "ADOBE"]);
  });

  it('em "recente", quem não tem data vai para o fim e o empate se desfaz pelo dinheiro', () => {
    const grupos = agruparGrafias([
      c({ nome: "ADOBE", total: 5_000, ultima: null }),
      c({ nome: "CANVA", total: 9_000, ultima: "2026-07-30" }),
      c({ nome: "KABUM", total: 20_000, ultima: "2026-07-30" }),
    ]);
    const ordem = ordenarGrupos(grupos, (g) => g.total, "recente").map((g) => g.grafias[0].nome);
    expect(ordem).toEqual(["KABUM", "CANVA", "ADOBE"]);
  });
});
