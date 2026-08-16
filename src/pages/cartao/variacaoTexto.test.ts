import { describe, it, expect } from "vitest";
import { analisar, type Fatura, type Lancamento } from "./analise";
import {
  quantasLinhas, recortar, textoDaVariacao, variacaoDaFatura,
} from "./variacaoTexto";

/* Os números são os da mensagem que originou o pedido — META ADS +17,8k,
   DATADOG +49,4k, GOOGLE ADS +10,7k, SYMPLA +15,8k. É contra ela que este
   texto tem de bater. */

const fatura = (competencia: string, mes_label: string): Fatura =>
  ({ competencia, mes_label, fechamento: null, arquivo: null });

let seq = 0;
const g = (competencia: string, estabelecimento: string, valor: number, categoria = "Marketing"): Lancamento => ({
  id: `l${++seq}`,
  competencia,
  data: competencia,
  estabelecimento,
  categoria,
  descricao: null,
  parcela: null,
  cidade: null,
  valor,
  tipo: "gasto",
});

const JUL = "2026-07-01";
const AGO = "2026-08-01";
const JUN = "2026-06-01";

const analiseDuasFaturas = () => analisar(
  [fatura(JUL, "jul/26"), fatura(AGO, "ago/26")],
  [
    g(JUL, "META ADS", 40_000), g(AGO, "META ADS", 57_800),
    g(JUL, "DATADOG", 10_000, "Tecnologia"), g(AGO, "DATADOG", 59_400, "Tecnologia"),
    g(JUL, "GOOGLE ADS", 20_000), g(AGO, "GOOGLE ADS", 30_700),
    g(AGO, "SYMPLA", 15_800, "Eventos"),                       // novo
    g(AGO, "IFOOD", 300, "Alimentação"),                       // novo, abaixo do corte
    g(JUL, "UBER", 5_000, "Transporte"), g(AGO, "UBER", 4_700, "Transporte"),
    g(JUL, "ZOOM", 2_000, "Tecnologia"),                       // saiu
  ],
);

const nomeDe = (chave: string) =>
  chave === "SYMPLA" ? { nome: "SYMPLA", oQueE: "Ingressos para Ifood e JojaJá" }
  : chave === "META ADS" ? { nome: "Meta Ads", oQueE: null }
  : null;

const variacao = (eixo: "estabelecimento" | "categoria" = "estabelecimento") =>
  variacaoDaFatura(analiseDuasFaturas(), eixo, nomeDe)!;

/* ------------------------------------------------------------------ */

describe("variacaoDaFatura", () => {
  it("não existe sem uma fatura anterior para comparar", () => {
    const so = analisar([fatura(AGO, "ago/26")], [g(AGO, "META ADS", 57_800)]);
    expect(variacaoDaFatura(so, "estabelecimento")).toBeNull();
  });

  it("separa os dois lados e ordena pelo que mais pesou", () => {
    const v = variacao();
    expect(v.subiu.map((p) => p.chave)).toEqual(["DATADOG", "META ADS", "SYMPLA", "GOOGLE ADS", "IFOOD"]);
    expect(v.caiu.map((p) => p.chave)).toEqual(["ZOOM", "UBER"]);
  });

  it("os dois lados somam exatamente a variação da fatura", () => {
    const v = variacao();
    const soma = [...v.subiu, ...v.caiu].reduce((s, p) => s + p.delta, 0);
    expect(soma).toBeCloseTo(v.delta, 2);
    expect(v.delta).toBeCloseTo(v.soma - v.somaAnterior, 2);
  });

  it("marca quem entrou agora e quem parou de vir", () => {
    const v = variacao();
    expect(v.subiu.find((p) => p.chave === "SYMPLA")?.movimento).toBe("entrou");
    expect(v.caiu.find((p) => p.chave === "ZOOM")?.movimento).toBe("saiu");
  });

  it("quem já tinha aparecido antes voltou — não é novo", () => {
    const a = analisar(
      [fatura(JUN, "jun/26"), fatura(JUL, "jul/26"), fatura(AGO, "ago/26")],
      [g(JUN, "SPOTIFY", 500, "Tecnologia"), g(AGO, "SPOTIFY", 700, "Tecnologia")],
    );
    expect(variacaoDaFatura(a, "estabelecimento")!.subiu[0].movimento).toBe("voltou");
  });

  it("usa o nome que a tela mostra, guardando o nome cru do banco", () => {
    const meta = variacao().subiu.find((p) => p.chave === "META ADS")!;
    expect(meta.nome).toBe("Meta Ads");
    expect(meta.chave).toBe("META ADS");
  });
});

/* ------------------------------------------------------------------ */

describe("recortar", () => {
  const v = variacao();

  it("deixa de fora quem se mexeu menos que o corte", () => {
    const { levadas, fora } = recortar(v.subiu, 1_000);
    expect(levadas.map((p) => p.chave)).toEqual(["DATADOG", "META ADS", "SYMPLA", "GOOGLE ADS"]);
    expect(fora.map((p) => p.chave)).toEqual(["IFOOD"]);
  });

  it("corte zero leva todo mundo", () => {
    expect(recortar(v.subiu, 0).levadas).toHaveLength(5);
  });

  it("nunca esvazia a lista — o maior fica mesmo abaixo do corte", () => {
    const { levadas, fora } = recortar(v.caiu, 1_000_000);
    expect(levadas.map((p) => p.chave)).toEqual(["ZOOM"]);
    expect(fora.map((p) => p.chave)).toEqual(["UBER"]);
  });
});

/* ------------------------------------------------------------------ */

describe("textoDaVariacao · enxuto", () => {
  const texto = textoDaVariacao(variacao(), { formato: "enxuto", bloco: "subiu", corte: 1_000 });

  it("abre dizendo de que fatura se está falando", () => {
    expect(texto.split("\n")[0]).toBe("Cartão ago/26: quem gastou a mais que jul/26 (+94k).");
  });

  it("escreve nome e quanto se mexeu, como na mensagem", () => {
    expect(texto).toContain("DATADOG +49,4k");
    expect(texto).toContain("Meta Ads +17,8k");
    expect(texto).toContain("GOOGLE ADS +10,7k");
  });

  it("leva o 'o que é' do cadastro — é a pergunta seguinte de quem lê", () => {
    expect(texto).toContain("SYMPLA (Ingressos para Ifood e JojaJá) +15,8k (novo)");
  });

  it("quem ficou abaixo do corte vira uma linha só, com a soma", () => {
    expect(texto.trim().split("\n").pop()).toBe("+ mais 1 estabelecimento (+300)");
  });

  it("não deixa espaço rígido no meio do valor", () => {
    expect(texto).not.toContain("\u00a0");
  });

  it("frase comprida do cadastro fica de fora — a linha é de um número, não de uma explicação", () => {
    const longo = variacaoDaFatura(analiseDuasFaturas(), "estabelecimento", (c) =>
      c === "SYMPLA"
        ? { nome: "SYMPLA", oQueE: "Plataforma de venda de ingressos usada nos eventos de parceiros e clientes" }
        : null)!;
    expect(textoDaVariacao(longo, { formato: "enxuto", bloco: "subiu", corte: 1_000 })).toContain("SYMPLA +15,8k");
  });
});

describe("textoDaVariacao · os dois lados", () => {
  const texto = textoDaVariacao(variacao(), { formato: "enxuto", bloco: "ambos", corte: 1_000 });

  it("abre pelo total da fatura", () => {
    expect(texto.split("\n")[0]).toBe("Cartão ago/26: aumento de 91,7k vs jul/26.");
  });

  it("dá título a cada lado, com o que o lado inteiro somou", () => {
    expect(texto).toContain("GASTOU A MAIS (R$ 94.000,00)");
    expect(texto).toContain("GASTOU A MENOS (R$ 2.300,00)");
  });

  it("mostra os dois lados sem sinal negativo dentro do valor cheio", () => {
    expect(texto).toContain("ZOOM -2k (saiu)");
    expect(texto).not.toContain("-R$");
  });
});

describe("textoDaVariacao · como no tracker", () => {
  const texto = textoDaVariacao(variacao(), { formato: "completo", bloco: "subiu", corte: 1_000 });

  it("abre com VAR, o total e os dois meses", () => {
    expect(texto.split("\n")[0]).toBe("VAR R$ 94.000,00 (gastou a mais) · cartão jul/26 → ago/26");
  });

  it("escreve os dois meses cheios e a diferença abreviada", () => {
    expect(texto).toContain("DATADOG R$ 10.000,00 → R$ 59.400,00 (+49,4k)");
  });

  it("quem entrou agora sai com zero do lado de lá, não com um traço", () => {
    expect(texto).toContain("SYMPLA R$ 0,00 → R$ 15.800,00 (+15,8k)");
  });

  it("aqui o parêntese é o nome cru — é o que se procura na fatura e no Omie", () => {
    expect(texto).toContain("Meta Ads (META ADS) R$ 40.000,00 → R$ 57.800,00 (+17,8k)");
  });
});

describe("textoDaVariacao · com contexto", () => {
  const texto = textoDaVariacao(variacao(), { formato: "contexto", bloco: "ambos", corte: 1_000 });

  it("situa a fatura antes da lista", () => {
    expect(texto.split("\n").slice(0, 3)).toEqual([
      "Cartão corporativo · jul/26 → ago/26",
      "R$ 77.000,00 → R$ 168.700,00 (+119%)",
      "VAR R$ 91.700,00 (5 estabelecimentos a mais, 2 a menos)",
    ]);
  });
});

describe("textoDaVariacao · por categoria", () => {
  const texto = textoDaVariacao(variacao("categoria"), { formato: "enxuto", bloco: "subiu", corte: 1_000 });

  it("diz que o eixo mudou e conta categorias, não estabelecimentos", () => {
    expect(texto.split("\n")[0]).toContain("Cartão ago/26 por categoria:");
    expect(texto).toContain("Tecnologia +47,4k");
    expect(texto).toContain("Marketing +28,5k");
    expect(texto).toContain("Eventos +15,8k (novo)");
  });
});

describe("quantasLinhas", () => {
  it("conta os nomes que vão no texto, mais a linha do resto", () => {
    const v = variacao();
    expect(quantasLinhas(v, "subiu", 1_000)).toBe(5);   // 4 nomes + "mais 1"
    expect(quantasLinhas(v, "subiu", 0)).toBe(5);
    expect(quantasLinhas(v, "ambos", 1_000)).toBe(7);   // 5 acima + 2 do outro lado
  });

  it("bloco vazio não vira texto", () => {
    const a = analisar([fatura(JUL, "jul/26"), fatura(AGO, "ago/26")], [g(AGO, "SYMPLA", 15_800)]);
    const v = variacaoDaFatura(a, "estabelecimento")!;
    expect(textoDaVariacao(v, { formato: "enxuto", bloco: "caiu", corte: 0 })).toBe("");
  });
});