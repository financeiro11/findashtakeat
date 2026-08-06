import { describe, it, expect } from "vitest";
import { montarPergunta, MESES_DE_SERIE } from "./perguntas";
import type { Node } from "./demonstracoes-schema";

/* ---------------------------------------------------------------------------
 * O dossiê que acompanha a pergunta feita numa célula.
 *
 * O que se fixa aqui é o contrato com a tela: os números que vão para a IA são
 * os que a grade mostra, e as fontes são as folhas de onde saem os lançamentos.
 * Errar qualquer um dos dois não dá erro — dá uma resposta segura sobre o número
 * errado, que é pior.
 * ------------------------------------------------------------------------- */

const COLS = ["Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26", "Jul-26"];

const SCHEMA: Node[] = [
  { label: "Receita Líquida", kind: "total" },
  { label: "(-) SG&A", kind: "header", children: [
    { label: "Pessoal", kind: "child", children: [
      { label: "Equipe Comercial", kind: "leaf" },
      { label: "Equipe Tecnologia", kind: "leaf" },
    ]},
  ]},
  { label: "% Margem EBITDA", kind: "percent", pctOf: "Receita Líquida" },
];

/** A leitura da página: linha com filhos vale a SOMA dos filhos. */
const tabela: Record<string, Record<string, number>> = {
  "Receita Líquida": { "Jun-26": 1_000_000, "Jul-26": 1_100_000 },
  "Equipe Comercial": { "Jun-26": -200_000, "Jul-26": -205_000 },
  "Equipe Tecnologia": { "Jun-26": -300_000, "Jul-26": -292_000 },
  "% Margem EBITDA": { "Jun-26": 0.21, "Jul-26": 0.19 },
};
const valorDaLinha = (node: Node, col: string): number | null => {
  if (node.children?.length) {
    let t: number | null = null;
    for (const c of node.children) {
      const v = valorDaLinha(c, col);
      if (v != null) t = (t ?? 0) + v;
    }
    return t;
  }
  return tabela[node.label]?.[col] ?? null;
};

const montar = (rubrica: string, mes = "Jul-26", despesa = true) =>
  montarPergunta({
    tipo: "dre", schema: SCHEMA, rubrica, mes, colunas: COLS,
    valorDaLinha, despesa, travado: true,
  });

describe("montarPergunta", () => {
  it("numa linha somada, manda a soma dos filhos e as folhas como fonte", () => {
    // O DE-PARA do Omie aponta para "Equipe Comercial", nunca para "Pessoal":
    // sem as folhas, a pergunta chegaria ao servidor sem lançamento nenhum.
    const p = montar("Pessoal")!;
    expect(p.valor).toBe(-497_000);
    expect(p.valorAnterior).toBe(-500_000);
    expect(p.fontes).toEqual(expect.arrayContaining(["Pessoal", "Equipe Comercial", "Equipe Tecnologia"]));
  });

  it("a quebra por linha filha vem dos dois meses", () => {
    const p = montar("Pessoal")!;
    expect(p.filhos).toEqual([
      { rubrica: "Equipe Comercial", valor: -205_000, valorAnterior: -200_000 },
      { rubrica: "Equipe Tecnologia", valor: -292_000, valorAnterior: -300_000 },
    ]);
  });

  it("a série termina no mês perguntado e não passa do teto", () => {
    // Mandar meses posteriores faria a resposta descrever um futuro que a
    // pessoa não está olhando.
    const p = montar("Pessoal", "Mar-26")!;
    expect(p.serie.map((s) => s.mes)).toEqual(["Jan-26", "Feb-26", "Mar-26"]);
    expect(p.mesAnterior).toBe("Feb-26");
    expect(montar("Pessoal").serie.length).toBeLessThanOrEqual(MESES_DE_SERIE);
  });

  it("no primeiro mês da base não há mês anterior", () => {
    const p = montar("Pessoal", "Jan-26")!;
    expect(p.mesAnterior).toBeNull();
    expect(p.valorAnterior).toBeNull();
  });

  it("linha de percentual é marcada, e nenhuma delas entra no resumo do mês", () => {
    // O valor de uma linha de % é razão: no meio de uma lista de reais viraria
    // "R$ 0,19" e a resposta falaria de dezenove centavos de margem.
    const p = montar("% Margem EBITDA", "Jul-26", false)!;
    expect(p.percentual).toBe(true);
    expect(p.valor).toBe(0.19);
    expect(p.resumoMes.map((r) => r.rubrica)).toEqual(["Receita Líquida", "(-) SG&A"]);
  });

  it("rubrica fora do esquema não vira pergunta", () => {
    expect(montar("Rubrica Que Não Existe")).toBeNull();
  });
});
