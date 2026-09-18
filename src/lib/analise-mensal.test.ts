import { describe, expect, it } from "vitest";
import {
  CATALOGO, mesAnterior, montarAnalise, piorStatus, type Fontes,
} from "../../supabase/functions/_shared/analise-mensal.ts";

// Números reais de jul–ago/26 (18/09/2026), para os testes contarem a história de verdade.
const DRE: Record<string, Record<string, number>> = {
  "Receita Bruta": { "2026-07-01": 1254934.95, "2026-08-01": 1361468.25 },
  "Receita Recorrente": { "2026-06-01": 1133201, "2026-07-01": 1233180.85, "2026-08-01": 1338254, "2025-08-01": 500000 },
  "Receita Líquida": { "2026-07-01": 1168362.95, "2026-08-01": 1260889.25 },
  "Margem de contribuição": { "2026-07-01": 855846.52, "2026-08-01": 961643.35 },
  "Despesas Marketing & Vendas": { "2026-07-01": -543156.34, "2026-08-01": -445374.29 },
  "Pessoal": { "2026-08-01": -531883.02 },
  "(-) SG&A": { "2026-08-01": -1103827.33 },
  "EBITDA": { "2026-07-01": -377295.73, "2026-08-01": -142183.98 },
  "Lucro Líquido": { "2026-08-01": -121791.2 },
};
const DFC: Record<string, Record<string, number>> = {
  "Cashburn": { "2026-06-01": -510360, "2026-07-01": -512760.1, "2026-08-01": -568536.71 },
  "Fluxo de Caixa Operacional": { "2026-08-01": -419692.77 },
  "(+) Novos Empréstimos & Financiamentos": { "2026-07-01": 814981.09, "2026-08-01": 514100 },
  "Fluxo Livre": { "2026-05-01": -400000 },
};
const TRAVADOS = new Set(["2026-06-01", "2026-07-01", "2025-08-01", "2026-05-01"]);
const OS: Record<string, { realizado: number | null; orcado: number | null; origem: string | null; nota: string | null }> = {
  "Aquisição|Novos Clientes Total|2026-08-01": { realizado: 263, orcado: 350, origem: "hub_parcial", nota: "sem Comunidade" },
  "Aquisição|Novo MRR Total|2026-08-01": { realizado: 113147.05, orcado: 154040.5, origem: "hub_parcial", nota: null },
  "Aquisição|CAC|2026-08-01": { realizado: 2424.17, orcado: null, origem: "hub_parcial", nota: null },
  "Aquisição|LTV/CAC|2026-08-01": { realizado: 3.18, orcado: 3, origem: "hub_parcial", nota: null },
  "Operação|% Churn Revenue Total|2026-08-01": { realizado: 4.27, orcado: 3.2, origem: "os", nota: null },
};
const CARTEIRA: Record<string, { mrr: number; clientes: number }> = {
  "2026-07-01": { mrr: 1179472.03, clientes: 2961 },
  "2026-08-01": { mrr: 1285666.34, clientes: 3000 },
};

const fontes: Fontes = {
  dre: (r, c) => DRE[r]?.[c] ?? null,
  dfc: (r, c) => DFC[r]?.[c] ?? null,
  travado: (c) => TRAVADOS.has(c),
  os: (d, _canal, i, c) => OS[`${d}|${i}|${c}`] ?? null,
  carteira: (c) => CARTEIRA[c] ?? null,
  gastoAquisicao: (c) => (c === "2026-08-01" ? 553566.19 : null),
  estornos: (c) => (c === "2026-08-01" ? { churnReal: 30000, estornado: 35000 } : null),
  churnBruto: (c) => (c === "2026-08-01" ? { cancelValor: 57413.61, downsellValor: 1889, base: 1179472.03 } : null),
  bp: (r, c) => ({ "receita|2026-08-01": 1315851.63, "ebitda|2026-08-01": -231198.55, "receita liquida|2026-08-01": 1215501.6 } as Record<string, number>)[`${r}|${c}`] ?? null,
  bpOperacao: (campo, c) => ({ "novos|2026-08-01": 336, "clientes_eop|2026-08-01": 3190, "mrr_recorrente|2026-08-01": 1247365.47, "mrr_recorrente|2026-07-01": 1180000 } as Record<string, number>)[`${campo}|${c}`] ?? null,
  bpPreRevisao: (c) => c < "2026-06-01",
};

const linhas = montarAnalise(fontes, ["2026-08-01"]);
const de = (m: string) => linhas.find((l) => l.metrica === m)!;

describe("montarAnalise", () => {
  it("devolve só os meses pedidos, uma linha por métrica do catálogo", () => {
    expect(new Set(linhas.map((l) => l.competencia))).toEqual(new Set(["2026-08-01"]));
    expect(linhas).toHaveLength(CATALOGO.length);
    expect(new Set(CATALOGO.map((d) => d.metrica)).size).toBe(CATALOGO.length); // nome repetido quebraria a chave
  });

  it("DRE de mês não travado sai 'mes_aberto', com o plano do BP de mesma definição", () => {
    expect(de("receita_bruta")).toMatchObject({ valor: 1361468.25, plano: 1315851.63, status: "mes_aberto", fonte: "DRE", regime: "competencia" });
    expect(de("receita_bruta").nota).toContain("não travado");
    expect(de("ebitda").plano).toBeCloseTo(-231198.55);
  });

  it("OS incompleto propaga para as derivadas (CAC Omie = gasto ÷ novos)", () => {
    expect(de("novos_clientes")).toMatchObject({ valor: 263, meta: 350, plano: 336, status: "incompleto" });
    expect(de("cac_omie").valor).toBeCloseTo(553566.19 / 263);
    expect(de("cac_omie").status).toBe("incompleto");
  });

  it("carteira: MRR líquido novo, crescimento e ticket", () => {
    expect(de("mrr_liquido_novo").valor).toBeCloseTo(1285666.34 - 1179472.03);
    expect(de("mrr_liquido_novo").plano).toBeCloseTo(1247365.47 - 1180000);
    expect(de("crescimento_mrr_pct").valor).toBeCloseTo(((1285666.34 - 1179472.03) / 1179472.03) * 100);
    expect(de("ticket_medio").valor).toBeCloseTo(1285666.34 / 3000);
  });

  it("burn multiple = |cashburn| ÷ MRR líquido novo; burn 3m é a média de 3 cashburns", () => {
    expect(de("burn_multiple").valor).toBeCloseTo(568536.71 / (1285666.34 - 1179472.03));
    expect(de("burn_medio_3m").valor).toBeCloseTo((-510360 - 512760.1 - 568536.71) / 3);
    expect(de("burn_medio_3m").status).toBe("mes_aberto"); // agosto aberto contamina a média
  });

  it("magic number usa o marketing do mês ANTERIOR", () => {
    expect(de("magic_number").valor).toBeCloseTo(((1285666.34 - 1179472.03) * 12) / 543156.34);
  });

  it("do vendido ao faturado: Δ receita recorrente ÷ novo MRR", () => {
    expect(de("conversao_vendido_faturado").valor).toBeCloseTo(((1338254 - 1233180.85) / 113147.05) * 100);
  });

  it("regra dos 40 comparando com 2025 avisa do regime de caixa", () => {
    // ago/25 está travado, mas é 2025 → regime_caixa; ago/26 aberto → mes_aberto vence.
    expect(de("regra_dos_40").status).toBe("mes_aberto");
    expect(de("regra_dos_40").nota).toContain("regime de caixa"); // os dois avisos juntos
    const julho = montarAnalise({ ...fontes, travado: (c) => c !== "2026-08-01" }, ["2026-08-01"]).find((l) => l.metrica === "regra_dos_40")!;
    expect(julho.valor).not.toBeNull();
  });

  it("retenção: NRR = 100 − churn líquido; GRR usa o bruto da carteira e é estimado", () => {
    expect(de("nrr_mensal_pct").valor).toBeCloseTo(95.73);
    expect(de("grr_mensal_pct").valor).toBeCloseTo(100 - ((57413.61 + 1889) / 1179472.03) * 100);
    expect(de("grr_mensal_pct").status).toBe("estimado");
  });

  it("sem dado não vira zero", () => {
    expect(de("upsell")).toMatchObject({ valor: null, status: "sem_dado" });
    expect(de("fco").valor).toBeCloseTo(-419692.77);
  });

  it("sensível: margem, LTV e derivados de margem", () => {
    expect(de("margem_contribuicao").sensivel).toBe(true);
    expect(de("ltv_cac").sensivel).toBe(true);
    expect(de("cac_os").sensivel).toBe(false);
  });

  it("plano antes da reancoragem do BP ganha nota", () => {
    const maio = montarAnalise(fontes, ["2026-05-01"]).find((l) => l.metrica === "cashburn")!;
    expect(maio.valor).toBeCloseTo(-400000); // sem a linha Cashburn: Fluxo Livre − empréstimos (0)
    expect(maio.nota).toContain("Fluxo Livre");
  });
});

describe("utilitários", () => {
  it("mesAnterior atravessa o ano", () => {
    expect(mesAnterior("2026-01-01")).toBe("2025-12-01");
    expect(mesAnterior("2026-08-01", 12)).toBe("2025-08-01");
  });
  it("piorStatus", () => {
    expect(piorStatus("ok", "mes_aberto", "regime_caixa")).toBe("mes_aberto");
    expect(piorStatus("estimado", "incompleto")).toBe("incompleto");
  });
});
