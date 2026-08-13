import { describe, it, expect } from "vitest";
import {
  montarPonte, rotuloGrupo, resumoPonte, explicarPeca,
  type LancamentoDaPonte,
} from "./ponteVariacao";

/* Os lançamentos abaixo são os de "Eventos e Feiras" em Jun/Jul-26, com os
   nomes que a tela mostra — inclusive os três PRINTI idênticos de 241,27, que é
   o caso que a ponte existe para explicar: o fornecedor não é novo, a PARCELA é
   que triplicou. */

let seq = 0;
const l = (
  contraparte: string,
  valor: number,
  extra: Partial<LancamentoDaPonte> = {},
): LancamentoDaPonte => ({
  data: "2026-07-01",
  titulo: null,
  documento: null,
  contraparte,
  cnpj_cpf: null,
  categoria_codigo: "3.1.3.8",
  categoria_descricao: "Eventos e Feiras - Marketing",
  status: "A VENCER",
  valor,
  cod_titulo: String(++seq),
  ...extra,
});

/** O nome exibível padrão: a contraparte crua. O cartão tem teste próprio. */
const pelaContraparte = (x: LancamentoDaPonte) => x.contraparte ?? "Sem contraparte";

const opcoes = { mes: "Jul-26", mesAnterior: "Jun-26", nomeDe: pelaContraparte };

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const mesCurto = (m: string) => m.replace("-", " ");

describe("montarPonte", () => {
  it("a soma dos deltas é exatamente a variação da célula", () => {
    const jun = [l("PRINTI", -241.27), l("CLUSTER EVENTOS", -8400), l("SUMIU LTDA", -1234.56)];
    const jul = [
      l("PRINTI", -241.27), l("PRINTI", -241.27), l("PRINTI", -241.27),
      l("CLUSTER EVENTOS", -3955),
      l("JIM.COM GRUPO SOUZA", -2192.07),
    ];

    const p = montarPonte(jul, jun, opcoes);

    const somaDosDeltas = [...p.piora, ...p.melhora, ...p.iguais]
      .reduce((s, x) => s + x.delta, 0);
    // O centavo é o ponto: 3×241,27 não é um número redondo, e é justamente
    // onde um comparativo por módulo perde a conta.
    expect(somaDosDeltas).toBeCloseTo(p.delta, 6);
    expect(p.delta).toBeCloseTo(p.soma - p.somaAnterior, 6);
    expect(p.soma).toBeCloseTo(-6_870.88, 2);          // 3×241,27 + 3.955 + 2.192,07
    expect(p.somaAnterior).toBeCloseTo(-9_875.83, 2);   // 241,27 + 8.400 + 1.234,56
  });

  it("separa quem gastou a mais de quem economizou pelo SINAL do delta", () => {
    const jun = [l("PRINTI", -241.27), l("CLUSTER EVENTOS", -8400)];
    const jul = [l("PRINTI", -723.81), l("CLUSTER EVENTOS", -3955)];

    const p = montarPonte(jul, jun, opcoes);

    expect(p.piora.map((x) => x.nome)).toEqual(["PRINTI"]);
    expect(p.melhora.map((x) => x.nome)).toEqual(["CLUSTER EVENTOS"]);
    // Gastar 482,54 A MAIS é um delta NEGATIVO — despesa é negativa.
    expect(p.piora[0].delta).toBeCloseTo(-482.54, 2);
    expect(p.piora[0].deltaModulo).toBeCloseTo(482.54, 2);
    expect(p.piora[0].favoravel).toBe(false);
    expect(p.melhora[0].delta).toBeCloseTo(4445, 2);
    expect(p.melhora[0].favoravel).toBe(true);
    expect(p.totalPiora).toBeCloseTo(-482.54, 2);
    expect(p.totalMelhora).toBeCloseTo(4445, 2);
  });

  it("o percentual é em módulo: triplicar a parcela é +200%, não −200%", () => {
    const p = montarPonte([l("PRINTI", -723.81)], [l("PRINTI", -241.27)], opcoes);
    expect(p.piora[0].movimento).toBe("aumentou");
    expect(p.piora[0].pct).toBeCloseTo(2, 3);
  });

  it("classifica entrou, saiu, aumentou, reduziu e igual", () => {
    const jun = [l("SAIU", -100), l("MEXEU", -100), l("CAIU", -100), l("PARADO", -100)];
    const jul = [l("ENTROU", -50), l("MEXEU", -180), l("CAIU", -40), l("PARADO", -100)];

    const p = montarPonte(jul, jun, opcoes);
    const por = new Map([...p.piora, ...p.melhora, ...p.iguais].map((x) => [x.nome, x]));

    expect(por.get("ENTROU")!.movimento).toBe("entrou");
    expect(por.get("SAIU")!.movimento).toBe("saiu");
    expect(por.get("MEXEU")!.movimento).toBe("aumentou");
    expect(por.get("CAIU")!.movimento).toBe("reduziu");
    expect(por.get("PARADO")!.movimento).toBe("igual");
    expect(p.iguais.map((x) => x.nome)).toEqual(["PARADO"]);
  });

  it("guarda os lançamentos dos DOIS meses — é o que responde '1 parcela virou 3'", () => {
    const jun = [l("PRINTI", -241.27)];
    const jul = [l("PRINTI", -241.27), l("PRINTI", -241.27), l("PRINTI", -241.27)];

    const p = montarPonte(jul, jun, opcoes);
    expect(p.piora[0].anteriores).toHaveLength(1);
    expect(p.piora[0].lancamentos).toHaveLength(3);
  });

  it("ordena pelo que mais pesou, e não pelo maior valor", () => {
    const jun = [l("GRANDE PARADO", -50000), l("PEQUENO QUE MEXEU", -100)];
    const jul = [l("GRANDE PARADO", -50000), l("PEQUENO QUE MEXEU", -9000)];

    const p = montarPonte(jul, jun, opcoes);
    expect(p.piora[0].nome).toBe("PEQUENO QUE MEXEU");
    expect(p.iguais[0].nome).toBe("GRANDE PARADO");
  });

  it("agrupa pelo nome que a TELA mostra — no cartão, o lojista da observação", () => {
    // Os dois meses chegam com a mesma contraparte-balde; quem separa é `nomeDe`.
    const jun = [l("Lancamento Fatura Cartao", -525), l("Lancamento Fatura Cartao", -241.27)];
    const jul = [l("Lancamento Fatura Cartao", -1050), l("Lancamento Fatura Cartao", -241.27)];
    const lojista = new Map<string, string>([
      [jun[0].cod_titulo!, "OPENAI"], [jun[1].cod_titulo!, "PRINTI"],
      [jul[0].cod_titulo!, "OPENAI"], [jul[1].cod_titulo!, "PRINTI"],
    ]);

    const p = montarPonte(jul, jun, {
      ...opcoes,
      nomeDe: (x) => lojista.get(x.cod_titulo!) ?? x.contraparte ?? "",
    });

    expect(p.piora.map((x) => x.nome)).toEqual(["OPENAI"]);
    expect(p.iguais.map((x) => x.nome)).toEqual(["PRINTI"]);
    // Sem o lojista, os quatro cairiam num balde só e a ponte não veria nada.
    expect(p.fornecedores).toBe(2);
  });

  it("a chave ignora acento e caixa: a mesma grafia nos dois meses é um fornecedor só", () => {
    const p = montarPonte([l("Serviços Gráficos LTDA", -300)], [l("SERVICOS GRAFICOS LTDA", -200)], opcoes);
    expect(p.piora).toHaveLength(1);
    expect(p.piora[0].delta).toBeCloseTo(-100, 2);
  });

  it("mês anterior vazio: tudo entrou, e a conta continua fechando", () => {
    const jul = [l("A", -100), l("B", -50)];
    const p = montarPonte(jul, [], opcoes);

    expect(p.piora).toHaveLength(2);
    expect(p.piora.every((x) => x.movimento === "entrou")).toBe(true);
    expect(p.piora.every((x) => x.pct === null)).toBe(true);  // sem base, não é 0%
    expect(p.piora.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(p.delta, 6);
    expect(p.fornecedoresAnteriores).toBe(0);
  });

  it("compra e estorno no mesmo mês somam zero sem virar 'saiu'", () => {
    // O fornecedor ESTÁ na tela, com dois lançamentos que se anulam. Dizer
    // "saiu" mandaria procurar um gasto que está logo abaixo, na lista.
    const jul = [l("ESTORNADO", -900), l("ESTORNADO", 900)];
    const p = montarPonte(jul, [l("ESTORNADO", -900)], opcoes);

    expect(p.melhora[0].movimento).toBe("reduziu");
    expect(p.melhora[0].lancamentos).toHaveLength(2);
    expect(p.melhora[0].delta).toBeCloseTo(900, 2);
  });

  it("receita: entrar mais é favorável, e a conta fecha do mesmo jeito", () => {
    const jun = [l("CLIENTE A", 1000), l("CLIENTE B", 500)];
    const jul = [l("CLIENTE A", 1400), l("CLIENTE B", 300)];

    const p = montarPonte(jul, jun, opcoes);
    expect(p.despesa).toBe(false);
    expect(p.melhora.map((x) => x.nome)).toEqual(["CLIENTE A"]);
    expect(p.piora.map((x) => x.nome)).toEqual(["CLIENTE B"]);
    expect(p.delta).toBeCloseTo(200, 2);
    expect([...p.piora, ...p.melhora].reduce((s, x) => s + x.delta, 0)).toBeCloseTo(200, 6);
  });

  it("rubrica de despesa que ficou vazia continua sendo de despesa", () => {
    const p = montarPonte([], [l("A", -100)], opcoes);
    expect(p.despesa).toBe(true);
    expect(rotuloGrupo(p, true)).toBe("Economizou");
    expect(p.melhora[0].movimento).toBe("saiu");
  });
});

describe("as palavras", () => {
  it("trocam entre despesa e receita", () => {
    const despesa = montarPonte([l("A", -100)], [l("A", -50)], opcoes);
    expect(rotuloGrupo(despesa, false)).toBe("Gastou a mais");
    expect(rotuloGrupo(despesa, true)).toBe("Economizou");
    expect(resumoPonte(despesa)).toBe("gastou a mais");

    const receita = montarPonte([l("A", 100)], [l("A", 150)], opcoes);
    expect(rotuloGrupo(receita, false)).toBe("Entrou a menos");
    expect(rotuloGrupo(receita, true)).toBe("Entrou a mais");
    expect(resumoPonte(receita)).toBe("entrou menos");
  });

  it("calam quando a célula não mudou", () => {
    expect(resumoPonte(montarPonte([l("A", -100)], [l("A", -100)], opcoes))).toBeNull();
  });

  it("o hover diz os dois meses inteiros, com quantidade", () => {
    const p = montarPonte(
      [l("PRINTI", -241.27), l("PRINTI", -241.27), l("PRINTI", -241.27)],
      [l("PRINTI", -241.27)],
      opcoes,
    );
    const frase = explicarPeca(p.piora[0], p, moeda, mesCurto);
    expect(frase).toContain("Jun 26");
    expect(frase).toContain("Jul 26");
    expect(frase).toContain("1 lançamento");
    expect(frase).toContain("3 lançamentos");
    expect(frase).toContain("200%");
  });

  it("quem entrou não ganha frase de percentual", () => {
    const p = montarPonte([l("NOVO", -100)], [l("OUTRO", -100)], opcoes);
    const novo = p.piora.find((x) => x.nome === "NOVO")!;
    expect(explicarPeca(novo, p, moeda, mesCurto)).toContain("não tem lançamento nesta rubrica em Jun 26");
  });
});