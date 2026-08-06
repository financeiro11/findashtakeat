import { describe, it, expect } from "vitest";
import {
  celulasCandidatas, criarValorEm, fontesDaCelula, mesTemDadoSuficiente,
} from "./justificativas";
import type { Node } from "./demonstracoes-schema";

/* ---------------------------------------------------------------------------
 * A regra que decide o que vira comentário na DRE/DFC.
 *
 * Os dois primeiros testes são regressão de comentários que foram parar na
 * tela: "Receita Recorrente caiu -1,13M (-100%)" numa célula que mostrava
 * 1,23M. Os dois motivos estão fixados aqui porque nenhum deles dá erro — dão
 * um número errado, que é pior.
 * ------------------------------------------------------------------------- */

const COLS = ["May-26", "Jun-26", "Jul-26"];

const SCHEMA: Node[] = [
  { label: "Receita Bruta", kind: "header", children: [
    { label: "Receita Recorrente", kind: "child", children: [
      { label: "Receita de Assinaturas", kind: "leaf" },
      { label: "Enterprise", kind: "leaf" },
    ]},
  ]},
  { label: "(-) Custos", kind: "header", children: [
    { label: "Servidor", kind: "child" },
  ]},
];

const candidatas = (rows: Record<string, unknown>[], mes = "Jul-26", anterior = "Jun-26") =>
  celulasCandidatas({ schema: SCHEMA, mes, mesAnterior: anterior, valorEm: criarValorEm(rows, COLS) });

describe("celulasCandidatas", () => {
  it("linha com filhos vale a SOMA dos filhos, não a linha-pai do blob", () => {
    // O blob guarda a linha-pai vazia (o omie-sync escreve nas folhas e deixa o
    // pai para trás). Lendo o pai, a célula "sumia" e virava queda de 100%.
    const rows = [
      { Conta: "Receita Recorrente", "Jun-26": 1_133_201, "Jul-26": "" },
      { Conta: "Receita de Assinaturas", "Jun-26": 1_100_000, "Jul-26": 1_300_000 },
      { Conta: "Enterprise", "Jun-26": 33_201, "Jul-26": 30_000 },
    ];
    const c = candidatas(rows).find((x) => x.rubrica === "Receita Recorrente");
    expect(c?.valor).toBe(1_330_000);
    expect(c?.valorAnterior).toBe(1_133_201);
    expect(c?.delta).toBe(196_799);
  });

  it("célula sem número no mês não vira comentário", () => {
    // Ausência de dado não é queda: era isto que produzia "caiu 100%".
    const rows = [
      { Conta: "Servidor", "Jun-26": -140_000, "Jul-26": "" },
    ];
    expect(candidatas(rows).some((c) => c.rubrica === "Servidor")).toBe(false);
  });

  it("duas grafias da mesma rubrica somam, como na tela", () => {
    const rows = [
      { Conta: "Servidor", "Jun-26": -100_000, "Jul-26": -60_000 },
      { Conta: "servidor", "Jun-26": 0, "Jul-26": -60_000 },
    ];
    const c = candidatas(rows).find((x) => x.rubrica === "Servidor");
    expect(c?.valor).toBe(-120_000);
    // Despesa: subir é gastar mais, então o delta compara o módulo.
    expect(c?.delta).toBe(20_000);
  });

  it("variação abaixo do piso em R$ não vira comentário", () => {
    const rows = [
      { Conta: "Servidor", "Jun-26": -1_000, "Jul-26": -1_500 },
    ];
    expect(candidatas(rows)).toHaveLength(0);
  });

  it("base zero vira comentário e fica sem percentual", () => {
    const rows = [
      { Conta: "Enterprise", "Jun-26": "", "Jul-26": 50_000 },
    ];
    const c = candidatas(rows).find((x) => x.rubrica === "Enterprise");
    expect(c?.deltaPct).toBeNull();
    expect(c?.delta).toBe(50_000);
  });
});

describe("fontesDaCelula", () => {
  it("linha somada procura lançamento pelas folhas, e por ela mesma", () => {
    // O DE-PARA do Omie aponta para "Receita de Assinaturas"; procurar por
    // "Receita Recorrente" não achava contraparte nenhuma.
    const no = SCHEMA[0].children![0];
    expect(fontesDaCelula(no).sort()).toEqual(
      ["Enterprise", "Receita Recorrente", "Receita de Assinaturas"].sort(),
    );
  });

  it("folha procura só por ela mesma", () => {
    expect(fontesDaCelula({ label: "Servidor", kind: "child" })).toEqual(["Servidor"]);
  });
});

describe("mesTemDadoSuficiente", () => {
  const cheio = (mes: string) =>
    Array.from({ length: 20 }, (_, i) => ({ Conta: `Linha ${i}`, [mes]: 1_000 + i }));

  it("reprova o mês em aberto, com meia dúzia de linhas soltas", () => {
    const rows = [
      ...cheio("May-26").map((r, i) => ({ ...r, "Jun-26": 1_000 + i, "Jul-26": i < 2 ? 1 : "" })),
    ];
    expect(mesTemDadoSuficiente(rows, COLS, "Jun-26")).toBe(true);
    expect(mesTemDadoSuficiente(rows, COLS, "Jul-26")).toBe(false);
  });

  it("aprova o primeiro mês da base, que não tem com o que ser comparado", () => {
    expect(mesTemDadoSuficiente(cheio("May-26"), COLS, "May-26")).toBe(true);
  });
});
