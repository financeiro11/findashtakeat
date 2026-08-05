import { describe, expect, it } from "vitest";
import { analisar, type Fatura, type Lancamento, type Marcacao } from "./analise";

const faturas: Fatura[] = [
  { competencia: "2026-06-01", mes_label: "jun/26", fechamento: "2026-05-30", arquivo: "jun.ofx" },
  { competencia: "2026-07-01", mes_label: "jul/26", fechamento: "2026-06-30", arquivo: "jul.ofx" },
  { competencia: "2026-08-01", mes_label: "ago/26", fechamento: "2026-07-30", arquivo: "ago.ofx" },
];

let seq = 0;
const l = (
  competencia: string, estabelecimento: string, categoria: string, valor: number,
  tipo: Lancamento["tipo"] = "gasto",
): Lancamento => ({
  id: `l${seq++}`, competencia, data: `${competencia.slice(0, 8)}15`,
  estabelecimento, categoria, descricao: null, parcela: null, cidade: null, valor, tipo,
});

/* META ADS sobe sempre; ZIG é constante; BOOKING some na última; CURSOR nasce nela. */
const lancamentos: Lancamento[] = [
  l("2026-06-01", "META ADS", "Mídia / Tráfego pago", 20_000),
  l("2026-06-01", "ZIG", "Software / SaaS / Nuvem", 1_300),
  l("2026-06-01", "BOOKING", "Viagem – Hospedagem", 2_000),
  l("2026-06-01", "PAGAMENTO-BOLETO", "Taxas e tarifas", 23_000, "pagamento"),

  l("2026-07-01", "META ADS", "Mídia / Tráfego pago", 30_000),
  l("2026-07-01", "ZIG", "Software / SaaS / Nuvem", 1_300),
  l("2026-07-01", "BOOKING", "Viagem – Hospedagem", 3_000),

  l("2026-08-01", "META ADS", "Mídia / Tráfego pago", 40_000),
  l("2026-08-01", "ZIG", "Software / SaaS / Nuvem", 1_300),
  l("2026-08-01", "CURSOR", "Software / SaaS / Nuvem", 890),
  l("2026-08-01", "DESC ANUIDADE", "Taxas e tarifas", 120, "estorno"),
];

describe("analisar", () => {
  const a = analisar(faturas, lancamentos);

  it("soma só os gastos no total do mês — pagamento e estorno ficam de fora", () => {
    // jun tem R$ 23k de pagamento de boleto, que NÃO é gasto.
    expect(a.kpis[0].gastos).toBe(23_300);
    expect(a.kpis[0].pagamentos).toBe(23_000);
    expect(a.kpis[2].gastos).toBe(42_190);
    expect(a.kpis[2].estornos).toBe(120);
  });

  it("conta lançamentos e ticket médio só sobre gastos", () => {
    expect(a.kpis[0].lancamentos).toBe(3);
    expect(a.kpis[2].lancamentos).toBe(3);
    expect(a.kpis[2].ticket).toBeCloseTo(42_190 / 3, 6);
  });

  it("calcula a variação da última fatura contra a anterior", () => {
    expect(a.penultimo?.label).toBe("jul/26");
    expect(a.deltaUltimo).toBe(42_190 - 34_300);
    expect(a.pctUltimo).toBeCloseTo(7_890 / 34_300, 9);
  });

  it("acha pico, vale e média do período", () => {
    expect(a.pico?.label).toBe("ago/26");
    expect(a.vale?.label).toBe("jun/26");
    expect(a.mediaMensal).toBeCloseTo((23_300 + 34_300 + 42_190) / 3, 6);
  });

  it("ordena a matriz pelo total do período, não pelo valor da última fatura", () => {
    // BOOKING (5k somados) fica acima de ZIG (3,9k) mesmo tendo zerado em ago/26.
    expect(a.estabelecimentos.map((e) => e.chave)).toEqual(["META ADS", "BOOKING", "ZIG", "CURSOR"]);
  });

  it("marca como novo quem só aparece na última fatura", () => {
    const cursor = a.estabelecimentos.find((e) => e.chave === "CURSOR")!;
    expect(cursor.novo).toBe(true);
    expect(cursor.sumiu).toBe(false);
    // Sem base para comparar, a variação percentual não existe — vira "novo" na tela.
    expect(cursor.pctPrimeiro).toBeNull();
    expect(cursor.deltaPenultimo).toBe(890);
  });

  it("marca como sumido quem tinha gasto e não veio na última", () => {
    const booking = a.estabelecimentos.find((e) => e.chave === "BOOKING")!;
    expect(booking.sumiu).toBe(true);
    expect(booking.novo).toBe(false);
    expect(booking.deltaPenultimo).toBe(-3_000);
  });

  it("uma linha constante tem delta zero nas duas pontas", () => {
    const zig = a.estabelecimentos.find((e) => e.chave === "ZIG")!;
    expect(zig.deltaPrimeiro).toBe(0);
    expect(zig.deltaPenultimo).toBe(0);
    expect(zig.total).toBe(3_900);
  });

  it("a matriz de categoria fecha com o total do período", () => {
    const soma = a.categorias.reduce((s, c) => s + c.total, 0);
    expect(soma).toBe(a.totalPeriodo);
    expect(a.totalPeriodo).toBe(23_300 + 34_300 + 42_190);
  });

  it("aponta quem puxou o aumento e o peso dele na variação", () => {
    // META ADS subiu 10k numa fatura que subiu 7,89k — mais de 40%, então é crítico.
    const motor = a.destaques.find((d) => d.titulo.includes("puxou o aumento"));
    expect(motor?.nivel).toBe("critico");
    expect(motor?.titulo).toContain("META ADS");
  });

  it("levanta o fornecedor novo e o que sumiu", () => {
    expect(a.destaques.some((d) => d.titulo === "CURSOR apareceu pela primeira vez")).toBe(true);
    expect(a.destaques.some((d) => d.titulo === "BOOKING não veio nesta fatura")).toBe(true);
  });

  it("põe a marca humana na frente dos destaques calculados", () => {
    const marcacoes: Marcacao[] = [
      { estabelecimento: "META ADS", nota: "Conferir com o time de mídia.", marcado_em: "2026-08-02T12:00:00Z" },
    ];
    const comMarca = analisar(faturas, lancamentos, marcacoes);
    expect(comMarca.destaques[0].titulo).toBe("META ADS está marcado para revisão");
    expect(comMarca.destaques[0].detalhe).toContain("Conferir com o time de mídia.");
  });

  it("não repete o fornecedor novo que já está marcado à mão", () => {
    const comMarca = analisar(faturas, lancamentos, [
      { estabelecimento: "CURSOR", nota: null, marcado_em: "2026-08-02T12:00:00Z" },
    ]);
    expect(comMarca.destaques.filter((d) => d.titulo.startsWith("CURSOR")).length).toBe(1);
  });

  it("escreve a leitura rápida com os números do período", () => {
    expect(a.leitura[0]).toContain("jun/26");
    expect(a.leitura[0]).toContain("ago/26");
    // Template literal: se algum formatador devolvesse ReactNode, sairia [object Object].
    expect(a.leitura.join(" ")).not.toContain("[object Object]");
    expect(a.leitura.some((t) => t.includes("Maior crescimento no período: META ADS"))).toBe(true);
  });
});

describe("analisar em casos de borda", () => {
  it("não quebra sem fatura nenhuma", () => {
    const vazio = analisar([], []);
    expect(vazio.ultimo).toBeNull();
    expect(vazio.totalPeriodo).toBe(0);
    expect(vazio.leitura).toEqual([]);
    expect(vazio.destaques).toEqual([]);
  });

  it("com uma fatura só, não inventa comparação", () => {
    const uma = analisar([faturas[2]], lancamentos.filter((x) => x.competencia === "2026-08-01"));
    expect(uma.penultimo).toBeNull();
    expect(uma.deltaUltimo).toBe(0);
    // Sem mês anterior, ninguém é "novo" nem "sumiu" — não há do que ser novo.
    expect(uma.estabelecimentos.every((e) => !e.novo && !e.sumiu)).toBe(true);
    expect(uma.leitura.some((t) => t.includes("Da fatura anterior"))).toBe(false);
  });
});
