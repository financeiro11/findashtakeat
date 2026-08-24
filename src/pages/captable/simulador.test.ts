import { describe, it, expect } from "vitest";
import { simular, simularRodada, sinaisDaSimulacao, type PosicaoBase, type RodadaSimulada } from "./simulador";

// A base é a foto do fechamento da Series A, encurtada: o que importa para a
// conta é quanto é pool e quanto não é.
const BASE: PosicaoBase[] = [
  { id: "miguel", nome: "Miguel Carvalho", acoes: 42_969 },
  { id: "dgf", nome: "DGF", acoes: 24_000 },
  { id: "sop", nome: "Pool de opções (SOP)", acoes: 11_566, ehPool: true },
  { id: "outros", nome: "Demais investidores", acoes: 21_465 },
];

const rodada = (over: Partial<RodadaSimulada> = {}): RodadaSimulada => ({
  id: "r1",
  nome: "Series B",
  moeda: "BRL",
  valuation: 100_000_000,
  baseValuation: "pre",
  tickets: [{ id: "t1", nome: "Fundo Novo", valor: 25_000_000 }],
  poolAlvoPct: 0,
  momentoPool: "nenhum",
  ...over,
});

const perto = (a: number, b: number, casas = 2) => expect(a).toBeCloseTo(b, casas);

describe("simularRodada — sem mexer no pool", () => {
  const r = simularRodada(BASE, rodada());

  it("divide o pre-money pelas ações que já existem", () => {
    perto(r.precoPorAcao, 1000, 6);          // 100M ÷ 100.000 ações
    perto(r.acoesInvestidores, 25_000, 6);   // 25M ÷ 1.000
    perto(r.acoesDepois, 125_000, 6);
    perto(r.postMoney, 125_000_000, 6);
  });

  it("dá ao investidor a fatia que o dinheiro comprou", () => {
    perto(r.pctInvestidores, 20);
    const novo = r.posicoes.find((p) => p.nome === "Fundo Novo")!;
    perto(novo.pct, 20);
    expect(novo.novo).toBe(true);
  });

  it("dilui todo mundo na mesma proporção", () => {
    const miguel = r.posicoes.find((p) => p.id === "miguel")!;
    perto(miguel.pctAntes, 42.969);
    perto(miguel.pct, 34.3752);
    expect(miguel.deltaPct).toBeLessThan(0);
  });
});

describe("simularRodada — pool PRÉ-money", () => {
  const r = simularRodada(BASE, rodada({ poolAlvoPct: 15, momentoPool: "pre" }));

  it("faz o pool caber dentro do pre-money — o preço por ação cai", () => {
    perto(r.acoesDepois, 136_052.3077, 3);   // 88.434 ÷ (1 − 20% − 15%)
    perto(r.precoPorAcao, 918.7639, 3);      // menor que os 1.000 sem pool
    perto(r.acoesPoolNovas, 8_841.846, 2);
  });

  it("o investidor entra com a fatia cheia, sem pagar pelo pool", () => {
    perto(r.pctInvestidores, 20);
    perto(r.pctPool, 15);
  });

  it("quem já estava paga a conta do pool", () => {
    const miguel = r.posicoes.find((p) => p.id === "miguel")!;
    perto(miguel.pct, 31.5825, 3);           // contra 34,3752% sem pool
  });
});

describe("simularRodada — pool PÓS-money", () => {
  const r = simularRodada(BASE, rodada({ poolAlvoPct: 15, momentoPool: "pos" }));

  it("mantém o preço da rodada e dilui todos, inclusive o investidor novo", () => {
    perto(r.precoPorAcao, 1000, 6);
    perto(r.acoesPoolNovas, 8_451.7647, 3);
    perto(r.pctPool, 15);
    const novo = r.posicoes.find((p) => p.nome === "Fundo Novo")!;
    expect(novo.pct).toBeLessThan(20);       // pagou pelo pool junto com os outros
    perto(novo.pct, 18.7333, 3);
  });

  it("custa menos ao fundador do que o pool pré-money", () => {
    const pos = simularRodada(BASE, rodada({ poolAlvoPct: 15, momentoPool: "pos" }));
    const pre = simularRodada(BASE, rodada({ poolAlvoPct: 15, momentoPool: "pre" }));
    const mPos = pos.posicoes.find((p) => p.id === "miguel")!.pct;
    const mPre = pre.posicoes.find((p) => p.id === "miguel")!.pct;
    expect(mPos).toBeGreaterThan(mPre);
  });
});

describe("simularRodada — entradas do formulário", () => {
  it("aceita valuation informado como post-money", () => {
    const r = simularRodada(BASE, rodada({ valuation: 125_000_000, baseValuation: "post" }));
    perto(r.preMoney, 100_000_000, 6);
    perto(r.precoPorAcao, 1000, 6);
  });

  it("soma o cheque de quem já está na base na linha que já existe", () => {
    const r = simularRodada(BASE, rodada({
      tickets: [
        { id: "t1", nome: "Fundo Novo", valor: 20_000_000 },
        { id: "t2", nome: "DGF", valor: 5_000_000 },   // pro-rata do lead atual
      ],
    }));
    const dgf = r.posicoes.filter((p) => p.nome === "DGF");
    expect(dgf).toHaveLength(1);
    perto(dgf[0].acoes, 29_000, 6);                    // 24.000 + 5.000
    perto(dgf[0].investido, 5_000_000, 6);
  });

  it("recusa a conta quando investidores e pool passam de 100%", () => {
    const r = simularRodada(BASE, rodada({ valuation: 10_000_000, poolAlvoPct: 60, momentoPool: "pre" }));
    expect(r.erro).toBeTruthy();
  });

  it("recusa post-money menor que o captado", () => {
    const r = simularRodada(BASE, rodada({ valuation: 10_000_000, baseValuation: "post" }));
    expect(r.erro).toBeTruthy();
  });
});

describe("simular — rodadas encadeadas", () => {
  const res = simular(BASE, [
    rodada({ id: "b", nome: "Series B" }),
    rodada({ id: "c", nome: "Series C", valuation: 300_000_000, tickets: [{ id: "t", nome: "Growth Fund", valor: 60_000_000 }] }),
  ]);

  it("usa a saída de uma rodada como base da seguinte", () => {
    expect(res).toHaveLength(2);
    perto(res[1].acoesAntes, res[0].acoesDepois, 6);
  });

  it("acumula a diluição do fundador", () => {
    const m1 = res[0].posicoes.find((p) => p.id === "miguel")!.pct;
    const m2 = res[1].posicoes.find((p) => p.id === "miguel")!.pct;
    expect(m2).toBeLessThan(m1);
    perto(m2, 28.646, 2);                    // 34,3752% × (300 ÷ 360), o pre-money sobre o post
  });

  it("para de encadear quando uma rodada não fecha a conta", () => {
    const r = simular(BASE, [rodada({ valuation: 0 }), rodada({ id: "c" })]);
    expect(r).toHaveLength(1);
    expect(r[0].erro).toBeTruthy();
  });
});

describe("sinaisDaSimulacao", () => {
  it("acusa quando o fundador cruza a maioria simples", () => {
    const base: PosicaoBase[] = [
      { id: "m", nome: "Miguel Carvalho", acoes: 55_000 },
      { id: "o", nome: "Outros", acoes: 45_000 },
    ];
    const r = simular(base, [rodada({ valuation: 100_000_000, tickets: [{ id: "t", nome: "Fundo", valor: 25_000_000 }] })]);
    const sinais = sinaisDaSimulacao(r, { nomeFundador: "Miguel Carvalho" });
    expect(sinais.some((s) => s.chave.includes("controle-50") && s.gravidade === "alerta")).toBe(true);
  });

  it("marca down round quando o preço fica abaixo do da Series A", () => {
    const r = simular(BASE, [rodada({ moeda: "USD", valuation: 5_000_000, tickets: [{ id: "t", nome: "Fundo", valor: 1_000_000 }] })]);
    const sinais = sinaisDaSimulacao(r, { precoAnterior: 90.76, moedaPrecoAnterior: "USD" });
    const s = sinais.find((x) => x.chave === "preco-vs-anterior")!;
    expect(s.gravidade).toBe("alerta");
    expect(s.titulo).toContain("down round");
  });

  it("não inventa sinal quando a rodada não fecha", () => {
    const r = simular(BASE, [rodada({ valuation: 0 })]);
    expect(sinaisDaSimulacao(r)).toHaveLength(0);
  });
});
