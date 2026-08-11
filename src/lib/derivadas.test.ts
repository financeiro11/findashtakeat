import { describe, it, expect } from "vitest";
import { recalcularDerivadas, type Dados } from "../../supabase/functions/_shared/derivadas.ts";
import { CASCATA as CASCATA_SERVIDOR } from "../../supabase/functions/_shared/demonstracoes-schema.ts";
import { CASCATA as CASCATA_CLIENTE } from "./demonstracoes-schema";

/* Os números são os reais da Takeat em 2026, inclusive os ERRADOS: é o blob como
   ele estava depois de reimportar o tracker, com o Lucro Líquido que não somava
   as próprias parcelas. */

/* Um Set que aceita qualquer mês — nos testes de conta, o escopo não é o assunto.
   Quem cuida do escopo é o bloco "mês fechado não se toca", no fim. */
const TODOS: Set<string> = { has: () => true } as unknown as Set<string>;

const cel = (d: Dados, conta: string, col: string) =>
  d.rows.find((r) => r.Conta === conta)?.[col] ?? null;

const linha = (Conta: string, vals: Record<string, number | null>): Record<string, unknown> => {
  const r: Record<string, unknown> = { Conta };
  for (const [k, v] of Object.entries(vals)) if (v !== null) r[k] = v;
  return r;
};

/** Jul-26 da DRE como o tracker escreveu — folhas certas, totais se contradizendo. */
const dreJul = (): Dados => ({
  columns: ["Conta", "Jul-26"],
  rows: [
    linha("Receita de Assinaturas", { "Jul-26": 1180342 }),
    linha("Enterprise", { "Jul-26": 52588 }),
    linha("Receita Recorrente", { "Jul-26": 1232930 }),
    linha("Receita com Materiais", { "Jul-26": 2113 }),
    linha("Receita Markup", { "Jul-26": 19396 }),
    linha("Receita Spot", { "Jul-26": 21509 }),
    linha("Receita Bruta", { "Jul-26": 1254439 }),
    linha("PIS", { "Jul-26": -7202 }),
    linha("COFINS", { "Jul-26": -33238 }),
    linha("ISS", { "Jul-26": -22159 }),
    linha("Devoluções", { "Jul-26": -23973 }),
    linha("(-) Deduções da receita", { "Jul-26": -86572 }),
    linha("Receita Líquida", { "Jul-26": 1167867 }),
    linha("Equipe Operacional", { "Jul-26": -72385 }),
    linha("Premiações Operacionais", { "Jul-26": -22448 }),
    linha("Meios de Pagamento", { "Jul-26": -20866 }),
    linha("CMV Materiais", { "Jul-26": -4063 }),
    linha("Servidor", { "Jul-26": -140003 }),
    linha("Softwares Operacionais", { "Jul-26": -53199 }),
    linha("Outros Custos", { "Jul-26": -257 }),
    linha("(-) Custos Operacionais", { "Jul-26": -313222 }),
    linha("Margem de contribuição", { "Jul-26": 854646 }),
    // Os blocos do SG&A vêm agregados do tracker, sem as equipes por baixo —
    // é o caso "não há de onde derivar", e eles têm que sobreviver inteiros.
    linha("Pessoal", { "Jul-26": -556067 }),
    linha("Despesas Administrativas", { "Jul-26": -144086 }),
    linha("Despesas Marketing & Vendas", { "Jul-26": -532824 }),
    linha("(-) SG&A", { "Jul-26": -1232977 }),
    linha("EBITDA", { "Jul-26": -378331 }),
    linha("(-) Depreciação & Amortização", { "Jul-26": -5488 }),
    linha("(-) IOF", { "Jul-26": -4909 }),
    linha("(+) Receita financeira", { "Jul-26": 17014 }),
    linha("(+/-) Resultado Financeiro", { "Jul-26": 12105 }),
    linha("(+) Resultado Não Operacional", { "Jul-26": 13946 }),
    linha("IRF", { "Jul-26": -1392 }),
    // A linha do tracker fica VAZIA e o IRF logo abaixo nunca é somado:
    // é este o R$ 1.391 que a tela acusava e ninguém conseguia derrubar.
    linha("Lucro Líquido", { "Jul-26": -357769 }),
    linha("% Margem Líquida", { "Jul-26": -30.63 }),
  ],
});

describe("recalcularDerivadas · DRE", () => {
  it("o total passa a ser a soma das parcelas, com o IRF dentro", () => {
    const d = recalcularDerivadas("dre", dreJul(), TODOS);

    // A folha não se mexe — é o dado.
    expect(cel(d, "Servidor", "Jul-26")).toBe(-140003);
    expect(cel(d, "IRF", "Jul-26")).toBe(-1392);

    // O bloco que o tracker não tinha nasce da soma dos filhos.
    expect(cel(d, "(-) Impostos", "Jul-26")).toBe(-1392);
    expect(cel(d, "(+/-) Resultado Não Operacional", "Jul-26")).toBe(13946);

    // E o Lucro Líquido deixa de ser -357.769: agora desconta o IRF.
    expect(cel(d, "Lucro Líquido", "Jul-26")).toBe(-359160);
  });

  it("o resultado financeiro é dos filhos, sem a depreciação", () => {
    const d = recalcularDerivadas("dre", dreJul(), TODOS);
    expect(cel(d, "(+/-) Resultado Financeiro", "Jul-26")).toBe(12105);
    expect(cel(d, "(-) Depreciação & Amortização", "Jul-26")).toBe(-5488);
  });

  it("refaz a margem em pontos percentuais, a partir do total novo", () => {
    const d = recalcularDerivadas("dre", dreJul(), TODOS);
    // -359.160 / 1.167.867 = -30,75% (o tracker guardava -30,63%, do total velho)
    expect(cel(d, "% Margem Líquida", "Jul-26")).toBeCloseTo(-30.75, 2);
    expect(cel(d, "% Margem de contribuição", "Jul-26")).toBeCloseTo(73.18, 2);
  });

  it("é idempotente — rodar de novo não muda mais nada", () => {
    const uma = recalcularDerivadas("dre", dreJul(), TODOS);
    const duas = recalcularDerivadas("dre", uma, TODOS);
    expect(duas).toEqual(uma);
  });

  it("bloco desatualizado no arquivo perde para os filhos", () => {
    const base = dreJul();
    // O import bugado tinha deixado Receita Bruta 2.875 acima das suas rubricas.
    base.rows.find((r) => r.Conta === "Receita Bruta")!["Jul-26"] = 1257314.05;
    const d = recalcularDerivadas("dre", base, TODOS);
    expect(cel(d, "Receita Bruta", "Jul-26")).toBe(1254439);
    expect(cel(d, "Receita Líquida", "Jul-26")).toBe(1167867);
  });
});

describe("recalcularDerivadas · mês sem dado", () => {
  /* A âncora (primeira parcela da cascata) é o que impede um mês vazio de ganhar
     total. Sem isso, Ago-26 nasceria com um Lucro Líquido feito só de imposto e
     a série teria um número que não existe. */
  it("não inventa total onde não há a âncora", () => {
    const d = recalcularDerivadas("dre", {
      columns: ["Conta", "Aug-26"],
      rows: [linha("IRF", { "Aug-26": -900 })],
    }, TODOS);
    // Sem EBITDA, um Lucro Líquido de -900 seria um resultado feito só de
    // imposto. A linha simplesmente não nasce.
    expect(d.rows.find((r) => r.Conta === "Lucro Líquido")).toBeUndefined();
    expect(cel(d, "IRF", "Aug-26")).toBe(-900);
  });

  /* Derivar o que dá, nunca destruir o que não dá: mês antigo em que só existe o
     agregado (bloco sem nenhuma folha embaixo) tem que sair daqui intacto —
     apagar seria trocar o único número que existe por nada. */
  it("preserva o agregado quando não há parcela de onde derivar", () => {
    const d = recalcularDerivadas("dre", {
      columns: ["Conta", "Jan-24"],
      rows: [
        linha("(-) SG&A", { "Jan-24": -400000 }),
        linha("Margem de contribuição", { "Jan-24": 500000 }),
        linha("EBITDA", { "Jan-24": 100000 }),
      ],
    }, TODOS);
    expect(cel(d, "(-) SG&A", "Jan-24")).toBe(-400000);
    expect(cel(d, "Margem de contribuição", "Jan-24")).toBe(500000);
    // O EBITDA aqui é derivável (tem as duas parcelas) e continua batendo.
    expect(cel(d, "EBITDA", "Jan-24")).toBe(100000);
  });

  it("linha órfã do Omie, fora do esquema, fica intacta", () => {
    const d = recalcularDerivadas("dre", {
      columns: ["Conta", "Jul-26"],
      rows: [linha("Conta que o Omie inventou", { "Jul-26": 4242 })],
    }, TODOS);
    expect(cel(d, "Conta que o Omie inventou", "Jul-26")).toBe(4242);
  });
});

describe("recalcularDerivadas · DFC", () => {
  const dfc = (): Dados => ({
    columns: ["Conta", "Jun-26", "Jul-26"],
    rows: [
      linha("Entrada de Receita", { "Jun-26": 1000000, "Jul-26": 1107943 }),
      linha("(+) Receita financeira", { "Jun-26": 18067, "Jul-26": 17014 }),
      linha("PIS", { "Jun-26": -7000, "Jul-26": -7202 }),
      linha("Servidor", { "Jun-26": -140000, "Jul-26": -140003 }),
      linha("(-) Compra de Equipamentos", { "Jun-26": -5000, "Jul-26": -3000 }),
      linha("Antecipação da Receita", { "Jun-26": 20000, "Jul-26": 10000 }),
      // Os totais que estavam no banco, um milhão fora do lugar.
      linha("Fluxo de Caixa Operacional", { "Jun-26": 800000, "Jul-26": 713634.83 }),
      linha("Fluxo Livre", { "Jun-26": 815000, "Jul-26": 720634.83 }),
    ],
  });

  it("refaz os dois fluxos a partir dos blocos", () => {
    const d = recalcularDerivadas("dfc", dfc(), TODOS);
    // A antecipação de recebível é ENTRADA operacional (o tracker lança ali):
    // 1.107.943 + 17.014 + 10.000.
    expect(cel(d, "Entradas Operacionais", "Jul-26")).toBe(1134957);
    expect(cel(d, "Saídas Operacionais", "Jul-26")).toBe(-147205);
    expect(cel(d, "Fluxo de Caixa Operacional", "Jul-26")).toBe(987752);
    expect(cel(d, "Fluxo Livre", "Jul-26")).toBe(984752); // 987.752 - 3.000
  });

  /* Cashburn é a queima do MÊS: fluxo livre menos a captação extraordinária.
     Um mês com R$ 1,6 M de empréstimo tem fluxo livre positivo e queima alta —
     é a queima que diz quanto tempo o caixa aguenta. */
  it("Cashburn é o fluxo livre sem o empréstimo novo", () => {
    const base = dfc();
    base.rows.push(linha("(+) Novos Empréstimos & Financiamentos", { "Jul-26": 500000 }));
    const d = recalcularDerivadas("dfc", base, TODOS);
    const fl = Number(cel(d, "Fluxo Livre", "Jul-26"));
    expect(cel(d, "Cashburn", "Jul-26")).toBe(fl - 500000);
    // Sem captação no mês, queima e fluxo livre são o mesmo número.
    expect(cel(d, "Cashburn", "Jun-26")).toBe(Number(cel(d, "Fluxo Livre", "Jun-26")));
  });

  /* O tracker batiza várias linhas da DFC diferente do esquema. Escrever pelo
     rótulo do esquema criava uma linha NOVA ao lado da do arquivo — duas linhas
     para a mesma rubrica, que foi o que eu deixei acontecer em produção. */
  it("grava na linha que o tracker já tinha, sem duplicar pelo apelido", () => {
    const d = recalcularDerivadas("dfc", {
      columns: ["Conta", "Jul-26"],
      rows: [
        linha("Entrada de Receita", { "Jul-26": 1000 }),
        linha("Entradas", { "Jul-26": 999 }),        // o nome do tracker
        linha("PIS", { "Jul-26": -100 }),
        linha("Saídas", { "Jul-26": -1 }),
      ],
    }, TODOS);

    expect(d.rows.filter((r) => String(r.Conta).startsWith("Entradas"))).toHaveLength(1);
    expect(cel(d, "Entradas", "Jul-26")).toBe(1000);
    expect(d.rows.find((r) => r.Conta === "Entradas Operacionais")).toBeUndefined();
    expect(cel(d, "Saídas", "Jul-26")).toBe(-100);
  });
});

describe("a cascata é uma só", () => {
  /* Duas cópias porque o cliente é bundle do browser e o servidor roda em Deno.
     Se divergirem, a tela confere a conta com uma fórmula e o banco grava com
     outra — que é exatamente o bug que este módulo veio resolver. */
  it("cliente e servidor descrevem a mesma conta", () => {
    expect(CASCATA_CLIENTE).toEqual(CASCATA_SERVIDOR);
  });
});

/* --------------------------------------------------------------------------
 * O mês fechado.
 *
 * Este bloco existe porque eu errei exatamente aqui: recalculei a base INTEIRA e
 * reescrevi 24 meses de 2024/2025 que a diretoria já tinha fechado. A promessa
 * do sistema é que mês travado só muda quando alguém REIMPORTA aquele mês.
 * `colunas` é o que carrega essa promessa — e é o que estes testes seguram.
 * ------------------------------------------------------------------------ */
describe("mês fechado não se toca", () => {
  const doisMeses = (): Dados => ({
    columns: ["Conta", "Jun-26", "Jul-26"],
    rows: [
      linha("Receita Bruta", { "Jun-26": 1200000, "Jul-26": 1254439 }),
      linha("(-) Deduções da receita", { "Jun-26": -80000, "Jul-26": -86572 }),
      // Os dois meses têm o mesmo defeito: o total não bate com as parcelas.
      linha("Receita Líquida", { "Jun-26": 999999, "Jul-26": 999999 }),
      linha("IRF", { "Jun-26": -3601, "Jul-26": -1392 }),
    ],
  });

  it("só a coluna pedida é refeita — a vizinha fica exatamente como estava", () => {
    const d = recalcularDerivadas("dre", doisMeses(), new Set(["Jul-26"]));
    expect(cel(d, "Receita Líquida", "Jul-26")).toBe(1167867); // refeita
    expect(cel(d, "Receita Líquida", "Jun-26")).toBe(999999);  // intocada
  });

  it("nem linha nova nasce no mês que não foi pedido", () => {
    const d = recalcularDerivadas("dre", doisMeses(), new Set(["Jul-26"]));
    const impostos = d.rows.find((r) => r.Conta === "(-) Impostos");
    expect(impostos?.["Jul-26"]).toBe(-1392);
    expect(impostos?.["Jun-26"]).toBeUndefined();
  });

  it("escopo vazio não mexe em absolutamente nada", () => {
    const antes = doisMeses();
    expect(recalcularDerivadas("dre", antes, new Set())).toEqual(antes);
  });

  it("a DFC também respeita o escopo, até no Cashburn", () => {
    const d = recalcularDerivadas("dfc", {
      columns: ["Conta", "Jun-26", "Jul-26"],
      rows: [
        linha("Entrada de Receita", { "Jun-26": 100, "Jul-26": 200 }),
        linha("Fluxo Livre", { "Jun-26": 111, "Jul-26": 999 }),
        linha("Cashburn", { "Jun-26": 111, "Jul-26": 777 }),
      ],
    }, new Set(["Jul-26"]));
    expect(cel(d, "Fluxo Livre", "Jul-26")).toBe(200);
    expect(cel(d, "Cashburn", "Jul-26")).toBe(200);
    // Junho está fechado: nem o fluxo nem a queima dele são reescritos.
    expect(cel(d, "Fluxo Livre", "Jun-26")).toBe(111);
    expect(cel(d, "Cashburn", "Jun-26")).toBe(111);
  });
});
