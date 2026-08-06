import { describe, it, expect } from "vitest";
import {
  janelaDeMeses,
  montarComparativo,
  rotuloSituacao,
  explicarFornecedor,
  resumoComparativo,
  type LinhaContraparte,
} from "./comparativoFornecedores";
import { mesAtras, mesCurto } from "./demonstracoes-schema";

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

/** Atalho: uma linha da RPC. Despesa é negativa, como vem do Omie. */
const linha = (mes: string, contraparte: string, valor: number, lancamentos = 1, cods: string[] = []): LinhaContraparte =>
  ({ mes, contraparte, valor, lancamentos, cods });

/* Servidor em Jul-26, o caso que motivou a tela (ver a migration
   20260806180000): a rubrica quase não se mexeu no total, mas por dentro o
   Datadog entrou com 49k e o Google Cloud caiu pela metade. */
const SERVIDOR: LinhaContraparte[] = [
  linha("Jul-26", "INGRAM MICRO BRASIL LTDA", -79450.54, 1, ["5502610063"]),
  linha("Jul-26", "DATADOG", -49443.10, 6, ["5504196719", "5504196718"]),
  linha("Jul-26", "GOOGLE CLOUD", -10959.68, 2, ["5504196482"]),
  linha("Jul-26", "SENTRY", -150.12, 1, ["5504196505"]),
  linha("Jun-26", "INGRAM MICRO BRASIL LTDA", -81194.42, 1),
  linha("Jun-26", "GOOGLE CLOUD", -23736.19, 3),
  linha("Jun-26", "Cartão (lojista não identificado)", -146.65, 1),
  linha("May-26", "INGRAM MICRO BRASIL LTDA", -79490.59, 1),
  linha("May-26", "GOOGLE CLOUD", -10730.62, 2),
  linha("May-26", "SENTRY", -144.67, 1),
];

describe("janelaDeMeses", () => {
  it("põe o mês em foco na frente e desce a partir dele", () => {
    expect(janelaDeMeses("Jul-26", 3)).toEqual(["Jul-26", "Jun-26", "May-26", "Apr-26"]);
  });

  it("vira o ano para trás sem tropeçar em janeiro", () => {
    expect(janelaDeMeses("Jan-26", 2)).toEqual(["Jan-26", "Dec-25", "Nov-25"]);
    expect(mesAtras("Jan-26", 13)).toBe("Dec-24");
  });

  it("mês de 31 dias não puxa o mês errado (a chave não tem dia)", () => {
    expect(mesAtras("Jul-26")).toBe("Jun-26");
    expect(mesAtras("Mar-26")).toBe("Feb-26");
  });
});

describe("montarComparativo — a situação de cada fornecedor", () => {
  const c = montarComparativo(SERVIDOR, "Jul-26", 3);
  const de = (nome: string) => c.porContraparte.get(nome)!;

  it("fornecedor que nunca apareceu na janela é NOVO", () => {
    expect(de("DATADOG").situacao).toBe("novo");
    expect(c.novos).toBe(1);
  });

  it("despesa que ENCOLHEU não é 'subiu', mesmo com o número maior", () => {
    // -81.194,42 → -79.450,54: o valor com sinal subiu, o gasto caiu.
    const ingram = de("INGRAM MICRO BRASIL LTDA");
    expect(ingram.situacao).toBe("caiu");
    expect(ingram.delta).toBeCloseTo(-1743.88, 2);
    expect(ingram.favoravel).toBe(true);
  });

  it("gasto que dobra é 'subiu' e a cor é desfavorável", () => {
    const c2 = montarComparativo(
      [linha("Jul-26", "AWS", -2000), linha("Jun-26", "AWS", -1000)], "Jul-26", 3);
    const aws = c2.porContraparte.get("AWS")!;
    expect(aws.situacao).toBe("subiu");
    expect(aws.delta).toBeCloseTo(1000, 2);
    expect(aws.pct).toBeCloseTo(1, 5);
    expect(aws.favoravel).toBe(false);
  });

  it("receita que cresce é 'subiu' e é favorável", () => {
    const c2 = montarComparativo(
      [linha("Jul-26", "CLIENTE X", 500), linha("Jun-26", "CLIENTE X", 400)], "Jul-26", 3);
    const x = c2.porContraparte.get("CLIENTE X")!;
    expect(x.situacao).toBe("subiu");
    expect(x.favoravel).toBe(true);
  });

  it("quem estava no mês anterior e não está mais entra como SUMIU", () => {
    const sumido = de("Cartão (lojista não identificado)");
    expect(sumido.situacao).toBe("sumiu");
    expect(sumido.valor).toBe(0);
    expect(sumido.valorAnterior).toBeCloseTo(-146.65, 2);
    expect(c.sumidos).toBe(1);
  });

  it("ausente no mês anterior mas presente antes é VOLTOU, com a última vez", () => {
    const sentry = de("SENTRY");
    expect(sentry.situacao).toBe("voltou");
    expect(sentry.visto).toBe("May-26");
    expect(rotuloSituacao(sentry)).toBe("voltou · Mai 26");
  });

  it("mesmo valor até o centavo é IGUAL, não uma variação de 0%", () => {
    const c2 = montarComparativo(
      [linha("Jul-26", "SLACK", -5325), linha("Jun-26", "SLACK", -5325.004)], "Jul-26", 3);
    expect(c2.porContraparte.get("SLACK")!.situacao).toBe("igual");
    expect(rotuloSituacao(c2.porContraparte.get("SLACK")!)).toBe("igual");
  });

  it("quem só aparece em meses antigos fica de fora — não explica nem o mês nem a variação", () => {
    const c2 = montarComparativo(
      [linha("Jul-26", "A", -10), linha("Apr-26", "VELHO", -999)], "Jul-26", 6);
    expect(c2.porContraparte.has("VELHO")).toBe(false);
  });

  it("sem nenhum mês anterior na janela, avisa que não dá para comparar", () => {
    // O mês mais antigo do cache do Omie: chamar todo mundo de "novo" ali seria
    // afirmar o que os dados não sustentam.
    const so = montarComparativo([linha("Jul-26", "A", -10), linha("Jul-26", "B", -20)], "Jul-26", 12);
    expect(so.temHistorico).toBe(false);
    expect(montarComparativo(SERVIDOR, "Jul-26", 3).temHistorico).toBe(true);
  });

  it("ordena pelo que mais mexeu, que é a ordem de leitura da variação", () => {
    expect(c.fornecedores[0].contraparte).toBe("DATADOG");
    expect(c.fornecedores[1].contraparte).toBe("GOOGLE CLOUD");
  });

  it("janela curta demais transforma 'voltou' em 'novo' — por isso a tela diz o tamanho dela", () => {
    // Com um mês só de histórico, SENTRY não tem onde ter aparecido antes.
    const c1 = montarComparativo(SERVIDOR, "Jul-26", 1);
    expect(c1.porContraparte.get("SENTRY")!.situacao).toBe("novo");
  });
});

describe("montarComparativo — o vínculo com a lista de lançamentos", () => {
  const c = montarComparativo(SERVIDOR, "Jul-26", 3);

  it("liga cada cod_titulo do mês em foco ao seu fornecedor", () => {
    expect(c.porTitulo.get("5504196719")!.contraparte).toBe("DATADOG");
    expect(c.porTitulo.get("5502610063")!.contraparte).toBe("INGRAM MICRO BRASIL LTDA");
  });

  it("não indexa título de mês anterior — o chip é sobre a linha que está na tela", () => {
    const c2 = montarComparativo(
      [linha("Jul-26", "A", -1, 1, ["111"]), linha("Jun-26", "A", -1, 1, ["222"])], "Jul-26", 3);
    expect(c2.porTitulo.has("111")).toBe(true);
    expect(c2.porTitulo.has("222")).toBe(false);
  });

  it("valor vindo como string (numeric do Postgres) vira número", () => {
    const c2 = montarComparativo(
      [{ mes: "Jul-26", contraparte: "A", valor: "-1234.56", lancamentos: 2, cods: null }], "Jul-26", 3);
    expect(c2.porContraparte.get("A")!.valor).toBeCloseTo(-1234.56, 2);
  });

  it("duas linhas do mesmo nome no mesmo mês somam, não se sobrescrevem", () => {
    const c2 = montarComparativo(
      [linha("Jul-26", "A", -10, 1, ["1"]), linha("Jul-26", "A", -5, 2, ["2"])], "Jul-26", 3);
    const a = c2.porContraparte.get("A")!;
    expect(a.valor).toBeCloseTo(-15, 2);
    expect(a.lancamentos).toBe(3);
    expect(c2.porTitulo.get("2")).toBe(a);
  });
});

describe("resumoComparativo", () => {
  it("conta os fornecedores DO MÊS — quem sumiu não é fornecedor da rubrica agora", () => {
    // Servidor Jul-26: Ingram, Datadog, Google Cloud e Sentry (o cartão sumiu).
    expect(resumoComparativo(montarComparativo(SERVIDOR, "Jul-26", 3)))
      .toBe("4 fornecedores · 1 novo · 1 voltou · 1 sumiu");
  });

  it("cala o que não aconteceu, em vez de anunciar zeros", () => {
    const c = montarComparativo(
      [linha("Jul-26", "A", -10), linha("Jun-26", "A", -20)], "Jul-26", 3);
    expect(resumoComparativo(c)).toBe("1 fornecedor");
  });

  it("plural certo quando é mais de um", () => {
    const c = montarComparativo(
      [linha("Jul-26", "A", -10), linha("Jul-26", "B", -20), linha("Jun-26", "C", -5), linha("Jun-26", "D", -5)],
      "Jul-26", 3);
    expect(resumoComparativo(c)).toBe("2 fornecedores · 2 novos · 2 sumiram");
  });
});

describe("explicarFornecedor", () => {
  const c = montarComparativo(SERVIDOR, "Jul-26", 3);

  it("no hover diz que o número é do FORNECEDOR na rubrica, com os dois meses", () => {
    const t = explicarFornecedor(c.porContraparte.get("GOOGLE CLOUD")!, c, moeda);
    expect(t).toContain("Jun 26");
    expect(t).toContain("Jul 26");
    expect(t).toContain("caiu");
  });

  it("no novo, diz em quantos meses ele não aparece — 'novo' sozinho seria forte demais", () => {
    expect(explicarFornecedor(c.porContraparte.get("DATADOG")!, c, moeda)).toContain("3 meses anteriores");
  });

  it("no sumido, o texto é sobre o mês anterior, porque agora não há lançamento", () => {
    const t = explicarFornecedor(c.porContraparte.get("Cartão (lojista não identificado)")!, c, moeda);
    expect(t).toContain("nenhum lançamento em Jul 26");
  });

  it("mês em português curto, como no resto da tela", () => {
    expect(mesCurto("May-26")).toBe("Mai 26");
    expect(mesCurto("Dec-25")).toBe("Dez 25");
  });
});
