import { describe, expect, it } from "vitest";
import { desvio, parsearOperacao } from "./orcadoBp";

/**
 * Fixture no formato da aba "Operação": rótulo na coluna A, doze meses nas colunas D..O
 * (índices 3..14). Espelha as armadilhas do arquivo real — rótulos do consolidado
 * repetidos dentro de cada bloco de porte, clientes perdidos negativos, churn de janeiro
 * vazio e a linha "# Churn Mensal" com lixo nessa coluna.
 */
const l = (rotulo: string, meses: (number | null)[], c: unknown = null) =>
  [rotulo, null, c, ...meses] as unknown[];

const doze = (v: number) => Array<number>(12).fill(v);

const ABA: unknown[][] = [
  [null, null, null],
  l("Mês Calendário", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  [null, null, null],
  l("$ Receita Bruta", doze(1_000)),
  l("$ MRR", [900, 900, 900, 900, 900, 950, 1_000, 900, 900, 900, 900, 900]),
  l("$ Receita Spot", doze(100)),
  l("# Ticket Médio Total", doze(379.18)),
  l("# Número de Clientes BoP", [100, 110, 120, 130, 140, 150, 150, 160, 170, 180, 190, 200]),
  l("# Número de novos Clientes", doze(20)),
  // Na planilha os perdidos vêm negativos.
  l("# Número de Clientes perdidos", [-10, -10, -10, -10, -10, -10, -12, -10, -10, -10, -10, -10]),
  l("# Número de Clientes EoP", [110, 120, 130, 140, 150, 150, 160, 170, 180, 190, 200, 210]),
  l("# Novo MRR", doze(50)),
  // Janeiro carrega lixo aqui e vazio no "%": o mês fica sem churn orçado.
  l("# Churn Mensal", [0.045, 30, 30, 30, 30, 30, 40, 30, 30, 30, 30, 30]),
  l("% Churn Mensal", [null, 0.03, 0.03, 0.03, 0.03, 0.03, 0.04, 0.03, 0.03, 0.03, 0.03, 0.03]),
  [null, null, null],

  l("Receita Recorrente Clientes P", doze(100), 0.2854),
  l("# Número de Clientes BoP", doze(40)),
  l("# Número de novos Clientes", doze(5)),
  l("# Número de Clientes perdidos", doze(-4)),
  l("# Número de Clientes EoP", doze(41)),
  l("$ Ticket médio por cliente", doze(183), 0.25),
  l("% Churn", doze(0.071)),

  l("Receita Recorrente Clientes M", doze(200), 0.2387),
  l("# Número de Clientes BoP", doze(30)),
  l("# Número de novos Clientes", doze(5)),
  l("# Número de Clientes perdidos", doze(-3)),
  l("# Número de Clientes EoP", doze(32)),
  l("$ Ticket médio por cliente", doze(299), 0.25),
  l("% Churn", doze(0.04)),

  l("Receita Recorrente Clientes G", doze(300), 0.3192),
  l("# Número de Clientes BoP", doze(50)),
  l("# Número de novos Clientes", doze(6)),
  l("# Número de Clientes perdidos", doze(-2)),
  l("# Número de Clientes EoP", doze(52)),
  l("$ Ticket médio por cliente", doze(436), 0.25),
  l("% Churn", doze(0.0368)),

  l("Receita Recorrente Clientes GG", doze(250), 0.1567),
  l("# Número de Clientes BoP", doze(20)),
  l("# Número de novos Clientes", doze(4)),
  l("# Número de Clientes perdidos", doze(-1)),
  l("# Número de Clientes EoP", doze(25)),
  l("$ Ticket médio por cliente", doze(721), 0.25),
  l("% Churn", doze(0.021)),

  l("Receita Banestes", doze(50)),
];

const mapa = parsearOperacao(ABA, 2026);
const jul = mapa.get("2026-07-01")!;
const jan = mapa.get("2026-01-01")!;

describe("parsearOperacao", () => {
  it("indexa por competência", () => {
    expect(mapa.size).toBe(12);
    expect(jul.mes).toBe(7);
    expect(jul.mes_nome).toBe("Julho");
  });

  it("lê o consolidado do bloco do topo, não dos blocos de porte", () => {
    // Se pegasse o bloco de porte, viria 40/41 em vez de 150/160.
    expect(jul.clientes_bop).toBe(150);
    expect(jul.clientes_eop).toBe(160);
  });

  it("converte clientes perdidos para positivo", () => {
    expect(jul.perdidos).toBe(12);
    expect(jul.portes.find((p) => p.nivel === "P")!.perdidos).toBe(4);
  });

  it("soma os quatro portes no MRR recorrente, sem Banestes", () => {
    expect(jul.mrr_recorrente).toBe(850); // 100 + 200 + 300 + 250
    expect(jul.mrr_bp).toBe(1_000); // a linha "$ MRR" crua, que inclui Banestes
    expect(jul.banestes).toBe(50);
  });

  it("deriva o ticket do MRR recorrente sobre os clientes EoP", () => {
    expect(jul.ticket).toBeCloseTo(850 / 160, 6);
  });

  it("deixa janeiro sem churn orçado e não deixa o lixo da célula vazar", () => {
    expect(jan.churn_pct).toBeNull();
    expect(jan.churn_valor).toBeNull();
  });

  it("converte os percentuais de churn para pontos", () => {
    expect(jul.churn_pct).toBeCloseTo(4, 6);
    expect(jul.portes.find((p) => p.nivel === "P")!.churn_pct).toBeCloseTo(7.1, 6);
    expect(jul.portes.find((p) => p.nivel === "GG")!.churn_pct).toBeCloseTo(2.1, 6);
  });

  it("detecta o mês da reancoragem pelo BoP igual ao EoP", () => {
    // Junho: BoP 150 = EoP 150.
    expect(mapa.get("2026-06-01")!.ancora).toBe(true);
    expect(mapa.get("2026-05-01")!.pre_revisao).toBe(true);
    expect(jul.pre_revisao).toBe(false);
    expect(jul.ancora).toBe(false);
  });

  it("devolve mapa vazio quando a aba não existe", () => {
    expect(parsearOperacao(undefined, 2026).size).toBe(0);
    expect(parsearOperacao([], 2026).size).toBe(0);
  });
});

describe("desvio", () => {
  it("compara realizado contra orçado", () => {
    const d = desvio(110, 100)!;
    expect(d.abs).toBe(10);
    expect(d.pct).toBeCloseTo(10, 6);
    expect(d.acima).toBe(true);
  });

  it("é nulo sem orçado e sem percentual quando o orçado é zero", () => {
    expect(desvio(10, null)).toBeNull();
    expect(desvio(10, undefined)).toBeNull();
    expect(desvio(10, 0)!.pct).toBeNull();
  });
});
