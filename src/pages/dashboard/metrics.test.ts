/* ==========================================================================
 *  Cashburn e runway do Dashboard
 *
 *  O cenário dos testes é jul/26 em produção, e não um exemplo inventado: é o
 *  mês em que entrou um empréstimo de R$ 814,98 mil e em que o card mostrou
 *  −R$ 1.033.275 no lugar da queima real de −R$ 512.760,10.
 *
 *  Duas armadilhas que moram no blob da DFC e que estes testes guardam:
 *
 *  1. o blob tem DUAS linhas de fluxo livre — "Fluxo Livre" (o total canônico
 *     do esquema) e "Fluxo de Caixa Livre" (o rótulo antigo, mantido como
 *     alias). Em jul/26 a antiga ficou em −218,3 mil enquanto o total é
 *     +302,2 mil, e ler a antiga primeiro contaminava tudo;
 *  2. a DFC já mantém a linha "Cashburn" preenchida mês a mês. Derivá-la de
 *     novo por cima de um fluxo livre defasado descontava a captação DUAS
 *     vezes — a diferença de meio milhão entre os dois números acima.
 * ========================================================================== */

import { describe, it, expect } from "vitest";
import { calcMetricas, type HFRow } from "./metrics";

const JUL26 = { ano: 2026, mes: 7 };

/** Os valores de jul/26, jun/26 e mai/26 como estão no blob da DFC. */
function linhasReais(): HFRow[] {
  return [
    // jul/26 — o mês do empréstimo
    { metrica: "Fluxo de Caixa Livre", ano: 2026, mes: 7, valor: -218294 }, // linha velha, defasada
    { metrica: "Fluxo Livre", ano: 2026, mes: 7, valor: 302220.99 },        // FCO + FCI + FCF
    { metrica: "(+) Novos Empréstimos & Financiamentos", ano: 2026, mes: 7, valor: 814981.09 },
    { metrica: "Cashburn", ano: 2026, mes: 7, valor: -512760.1 },
    // jun/26 e mai/26 — meses sem captação, só a linha antiga tem valor
    { metrica: "Fluxo de Caixa Livre", ano: 2026, mes: 6, valor: -510360 },
    { metrica: "Cashburn", ano: 2026, mes: 6, valor: -510360 },
    { metrica: "Fluxo de Caixa Livre", ano: 2026, mes: 5, valor: -593330 },
    { metrica: "Cashburn", ano: 2026, mes: 5, valor: -593330 },
  ];
}

describe("cashburn do dashboard", () => {
  it("usa a linha Cashburn gravada na DFC, não a fórmula por cima do fluxo livre", () => {
    const m = calcMetricas(linhasReais(), JUL26);
    expect(m.cashburn).toBeCloseTo(-512760.1, 2);
    // o número que o card mostrava antes, descontando o empréstimo duas vezes
    expect(m.cashburn).not.toBeCloseTo(-1033275.09, 2);
  });

  it("sem a linha gravada, deriva do total canônico e não do rótulo antigo", () => {
    const semGravado = linhasReais().filter((r) => r.metrica !== "Cashburn");
    const m = calcMetricas(semGravado, JUL26);
    // 302.220,99 − 814.981,09; ler "Fluxo de Caixa Livre" daria −1.033.275,09
    expect(m.cashburn).toBeCloseTo(-512760.1, 2);
  });

  it("cai para o rótulo antigo no mês em que o total canônico não existe", () => {
    const so = linhasReais().filter((r) => r.ano === 2026 && r.mes === 6);
    const m = calcMetricas(so, { ano: 2026, mes: 6 });
    expect(m.fcl).toBe(-510360);
  });

  it("a média de 3 meses é a mesma queima na janela que termina no período", () => {
    const m = calcMetricas(linhasReais(), JUL26);
    // (−512.760,10 + −510.360 + −593.330) / 3
    expect(m.burnMedio3m).toBeCloseTo(-538816.7, 2);
    // com o cashburn errado a média saía em −712.321,70
    expect(m.burnMedio3m).not.toBeCloseTo(-712321.7, 2);
  });
});

describe("runway do dashboard", () => {
  it("divide o saldo consolidado do Omie pela queima média", () => {
    const m = calcMetricas(linhasReais(), JUL26, 0, 80226.72);
    expect(m.saldoReal).toBe(80226.72);
    expect(m.saldoRunway).toBe(80226.72);
    expect(m.runwayMeses).toBeCloseTo(80226.72 / 538816.7, 4);
  });

  it("sem snapshot do Omie, cai para o saldo estimado em vez de sumir", () => {
    const m = calcMetricas(linhasReais(), JUL26, 1_000_000);
    expect(m.saldoReal).toBeNull();
    expect(m.saldoRunway).toBe(m.saldoCaixa);
    expect(Number.isFinite(m.runwayMeses)).toBe(true);
  });

  it("gerando caixa não tem runway", () => {
    const gerando: HFRow[] = [
      { metrica: "Cashburn", ano: 2026, mes: 7, valor: 100_000 },
      { metrica: "Cashburn", ano: 2026, mes: 6, valor: 100_000 },
      { metrica: "Cashburn", ano: 2026, mes: 5, valor: 100_000 },
    ];
    const m = calcMetricas(gerando, JUL26, 0, 80226.72);
    expect(m.runwayMeses).toBe(Infinity);
  });
});
