import { describe, it, expect } from "vitest";
import {
  parseColuna, colunasDe, indexar, valorBruto, valorDoNo, valorNoPeriodo,
  ultimoMesFechado, variacao, rotulosDeDespesa, flattenLabels, chaveRubrica,
  celulaNumero, indexarCelulas, valorComAlias,
  DRE_SCHEMA, DFC_SCHEMA, type LinhaBase, type Node,
} from "./demonstracoes-schema";
import {
  DRE_SCHEMA as DRE_SERVIDOR,
  DFC_SCHEMA as DFC_SERVIDOR,
  alvosDoAjuste,
} from "../../supabase/functions/_shared/demonstracoes-schema.ts";

/* A base congelada é um blob plano; toda a leitura passa por aqui. Os números
   dos testes são os reais da Takeat (2024/2025), para o cálculo não divergir
   em silêncio do que a DRE já mostra. */

describe("parseColuna", () => {
  it("entende o formato da base", () => {
    expect(parseColuna("Jan-24")).toEqual({ col: "Jan-24", ano: 2024, mes: 1 });
    expect(parseColuna("Dec-25")).toEqual({ col: "Dec-25", ano: 2025, mes: 12 });
    expect(parseColuna("Jun-26")).toEqual({ col: "Jun-26", ano: 2026, mes: 6 });
  });

  it("ignora a coluna de rótulo e lixo", () => {
    expect(parseColuna("Conta")).toBeNull();
    expect(parseColuna("Total")).toBeNull();
    expect(parseColuna("Xyz-24")).toBeNull();
  });

  it("colunasDe filtra só os meses, na ordem", () => {
    const cols = colunasDe(["Conta", "Jan-24", "Feb-24", "Total"]);
    expect(cols.map((c) => c.col)).toEqual(["Jan-24", "Feb-24"]);
  });
});

describe("indexar / valorBruto", () => {
  const rows: LinhaBase[] = [
    { Conta: "Receita Bruta", "Jan-24": 250997, "Feb-24": "" },
    { Conta: "Encargos sociais", "Jan-24": -1000 },
  ];
  const idx = indexar(rows);

  it("lê valor por rótulo", () => {
    expect(valorBruto(idx, "Receita Bruta", "Jan-24")).toBe(250997);
  });

  it("célula vazia vale zero", () => {
    expect(valorBruto(idx, "Receita Bruta", "Feb-24")).toBe(0);
    expect(valorBruto(idx, "Receita Bruta", "Mar-24")).toBe(0);
  });

  it("casa mesmo com caixa/acento diferentes — a base mistura as duas grafias", () => {
    expect(valorBruto(idx, "Encargos Sociais", "Jan-24")).toBe(-1000);
  });

  it("rótulo inexistente vale zero, não quebra", () => {
    expect(valorBruto(idx, "Não existe", "Jan-24")).toBe(0);
  });
});

describe("valorDoNo", () => {
  const rows: LinhaBase[] = [
    { Conta: "Receita de Assinaturas", "Jan-24": 100 },
    { Conta: "Enterprise", "Jan-24": 20 },
    { Conta: "Receita com Materiais", "Jan-24": 5 },
    { Conta: "Receita Markup", "Jan-24": 3 },
    { Conta: "Serviços para Clientes", "Jan-24": 2 },
    { Conta: "Receita Bruta", "Jan-24": 999999 }, // valor próprio da base: deve ser ignorado
    { Conta: "EBITDA", "Jan-24": -4321 },
  ];
  const idx = indexar(rows);
  const receitaBruta = DRE_SCHEMA.find((n) => n.label === "Receita Bruta")!;
  const ebitda = DRE_SCHEMA.find((n) => n.label === "EBITDA")!;

  it("nó com filhos soma os filhos, não lê a própria linha", () => {
    // 100+20 (recorrente) + 5+3+2 (spot) = 130 — e não 999999
    expect(valorDoNo(idx, receitaBruta, "Jan-24")).toBe(130);
  });

  it("nó sem filhos lê a própria linha", () => {
    expect(valorDoNo(idx, ebitda, "Jan-24")).toBe(-4321);
  });

  it("soma ao longo do período", () => {
    const rows2: LinhaBase[] = [{ Conta: "EBITDA", "Jan-24": 10, "Feb-24": 20, "Mar-24": 30 }];
    const idx2 = indexar(rows2);
    const cols = colunasDe(["Jan-24", "Feb-24", "Mar-24"]);
    expect(valorNoPeriodo(idx2, ebitda, cols)).toBe(60);
    expect(valorNoPeriodo(idx2, ebitda, cols.slice(0, 2))).toBe(30); // YTD
  });
});

describe("ultimoMesFechado", () => {
  const cols = colunasDe(["Jan-26", "Feb-26", "Mar-26"]);

  it("descarta o mês em aberto com meia dúzia de linhas soltas", () => {
    // Mar-26 imita o Jul-26 real: quase tudo vazio e um "1" solto
    const rows: LinhaBase[] = Array.from({ length: 20 }, (_, i) => ({
      Conta: `L${i}`, "Jan-26": 10, "Feb-26": 10, "Mar-26": i === 0 ? 1 : "",
    }));
    expect(ultimoMesFechado(rows, cols)?.col).toBe("Feb-26");
  });

  it("mantém o mês quando ele está de fato cheio", () => {
    const rows: LinhaBase[] = Array.from({ length: 20 }, (_, i) => ({
      Conta: `L${i}`, "Jan-26": 10, "Feb-26": 10, "Mar-26": 10,
    }));
    expect(ultimoMesFechado(rows, cols)?.col).toBe("Mar-26");
  });

  it("base vazia devolve null em vez de quebrar", () => {
    expect(ultimoMesFechado([], cols)).toBeNull();
    expect(ultimoMesFechado([{ Conta: "L" }], cols)).toBeNull();
  });
});

describe("variacao", () => {
  it("receita: sinal normal, subir é bom (Receita Bruta 24→25 = +95%)", () => {
    const v = variacao(4258228, 8313700)!;
    expect(Math.round(v.pct * 100)).toBe(95);
    expect(v.sobe).toBe(true);
    expect(v.bom).toBe(true);
  });

  it("despesa: compara o módulo e subir é ruim (Custos 24→25 = +19%)", () => {
    const v = variacao(-996462, -1180920, { despesa: true })!;
    expect(Math.round(v.pct * 100)).toBe(19);
    expect(v.sobe).toBe(true);
    expect(v.bom).toBe(false); // gastou mais
  });

  it("resultado que vira negativo cai, não 'gasta mais' (EBITDA 24→25 = -279%)", () => {
    const v = variacao(60336, -107752)!;
    expect(Math.round(v.pct * 100)).toBe(-279);
    expect(v.sobe).toBe(false);
    expect(v.bom).toBe(false);
  });

  it("percentual varia em pontos percentuais, não em %", () => {
    const v = variacao(0.743, 0.843, { percentual: true })!;
    expect(v.pp).toBeCloseTo(10, 1);
  });

  it("base zero não vira infinito", () => {
    expect(variacao(0, 100)).toBeNull();
    expect(variacao(0, 0)).toBeNull();
  });
});

describe("rotulosDeDespesa", () => {
  const despesas = rotulosDeDespesa(DRE_SCHEMA);

  it("marca o bloco (-) e tudo que desce dele", () => {
    expect(despesas.has("(-) SG&A")).toBe(true);
    expect(despesas.has("Pessoal")).toBe(true);              // filho de (-) SG&A
    expect(despesas.has("Equipe Administrativa")).toBe(true); // neto
    expect(despesas.has("(-) Custos Operacionais")).toBe(true);
  });

  it("não marca receita nem linha de resultado", () => {
    expect(despesas.has("Receita Bruta")).toBe(false);
    expect(despesas.has("Receita Recorrente")).toBe(false);
    expect(despesas.has("EBITDA")).toBe(false);
    expect(despesas.has("Lucro Líquido")).toBe(false);
  });
});

describe("esquemas", () => {
  it("DRE e DFC têm os totais que os KPIs leem", () => {
    const dre = flattenLabels(DRE_SCHEMA);
    for (const l of ["Receita Bruta", "Receita Líquida", "EBITDA", "Lucro Líquido"]) {
      expect(dre).toContain(l);
    }
    expect(flattenLabels(DFC_SCHEMA)).toContain("Fluxo de Caixa Operacional");
  });

  it("nenhum rótulo repetido dentro do mesmo esquema (quebraria o índice)", () => {
    for (const esquema of [DRE_SCHEMA, DFC_SCHEMA]) {
      const labels = flattenLabels(esquema as Node[]);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

/* --------- colisão de chave: o bug do "Margem de contribuição = 73" --------- */
describe("chaveRubrica", () => {
  it("NÃO confunde a linha de percentual com a de reais", () => {
    // era isto que fazia a margem aparecer como 73 em vez de R$ 182 mil
    expect(chaveRubrica("% Margem de contribuição")).not.toBe(chaveRubrica("Margem de contribuição"));
    expect(chaveRubrica("% Margem EBITDA")).not.toBe(chaveRubrica("EBITDA"));
  });

  it("preserva os sinais que distinguem rubrica", () => {
    expect(chaveRubrica("(+) Receita financeira")).not.toBe(chaveRubrica("(-) Receita financeira"));
    expect(chaveRubrica("(-) Juros")).not.toBe(chaveRubrica("Juros"));
  });

  it("segue tolerante a acento e caixa — a base mistura as duas grafias", () => {
    expect(chaveRubrica("Encargos sociais")).toBe(chaveRubrica("Encargos Sociais"));
    expect(chaveRubrica("Outras Despesas Adm")).toBe(chaveRubrica("Outras despesas Adm"));
    expect(chaveRubrica("Deduções")).toBe(chaveRubrica("DEDUCOES"));
  });
});

describe("indexar com rubricas repetidas", () => {
  it("soma as duas grafias em vez de descartar uma", () => {
    const idx = indexar([
      { Conta: "Encargos sociais", "Jan-24": -100 },
      { Conta: "Encargos Sociais", "Jan-24": -250 },
    ]);
    expect(valorBruto(idx, "Encargos Sociais", "Jan-24")).toBe(-350);
  });

  it("mantém separadas a linha de valor e a de percentual", () => {
    const idx = indexar([
      { Conta: "Margem de contribuição", "Jan-24": 182248 },
      { Conta: "% Margem de contribuição", "Jan-24": 73 },
    ]);
    expect(valorBruto(idx, "Margem de contribuição", "Jan-24")).toBe(182248);
    expect(valorBruto(idx, "% Margem de contribuição", "Jan-24")).toBe(73);
  });
});

describe("linhas percentuais apontam para uma rubrica que existe", () => {
  const idx = indexar([
    { Conta: "Receita Líquida", "Jan-24": 1000 },
    { Conta: "Margem de contribuição", "Jan-24": 700 },
    { Conta: "EBITDA", "Jan-24": -50 },
    { Conta: "Lucro Líquido", "Jan-24": -80 },
  ]);
  const achar = (label: string): Node => {
    let r: Node | null = null;
    const walk = (ns: Node[]) => ns.forEach((n) => { if (n.label === label) r = n; if (n.children) walk(n.children); });
    walk(DRE_SCHEMA);
    return r!;
  };

  it("cada linha de % tem src e o src existe na base", () => {
    for (const label of ["% Margem de contribuição", "% Margem EBITDA", "% Margem Líquida"]) {
      const n = achar(label);
      expect(n.src, `${label} sem src`).toBeTruthy();
      expect(valorBruto(idx, n.src!, "Jan-24"), `${label} → ${n.src} não existe na base`).not.toBe(0);
    }
  });

  it("o denominador também existe", () => {
    for (const label of ["% Margem de contribuição", "% Margem EBITDA", "% Margem Líquida"]) {
      expect(valorBruto(idx, achar(label).pctOf!, "Jan-24")).toBe(1000);
    }
  });
});

/* --------- o índice das telas de DRE/DFC: grafias que se somam --------- */
describe("indexarCelulas", () => {
  const cols = ["Apr-26", "May-26", "Jun-26", "Jul-26"];

  /* O caso real que motivou: na DFC o tracker escreve "Outras despesas Adm" e o
     DE_PARA do Omie escreve "Outras Despesas Adm". Sobrescrevendo, Jul/26
     aparecia VAZIO na tela com R$ 26 mil e 54 lançamentos por trás. */
  it("soma as duas grafias da mesma rubrica em vez de uma apagar a outra", () => {
    const idx = indexarCelulas([
      { Conta: "Outras despesas Adm", "Apr-26": -8105, "May-26": -14031, "Jun-26": -16518, "Jul-26": "" },
      { Conta: "Outras Despesas Adm", "Apr-26": "", "May-26": "", "Jun-26": "", "Jul-26": -26341.62 },
    ], cols);

    const linha = idx.get("outras despesas adm")!;
    expect(linha["Jun-26"]).toBe(-16518);
    expect(linha["Jul-26"]).toBe(-26341.62);
  });

  it("mês em que as duas grafias têm valor soma os dois", () => {
    const idx = indexarCelulas([
      { Conta: "Encargos sociais", "Apr-26": -100 },
      { Conta: "Encargos Sociais", "Apr-26": -250 },
    ], ["Apr-26"]);
    expect(idx.get("encargos sociais")!["Apr-26"]).toBe(-350);
  });

  it("vazio nas duas continua vazio — '—' não vira R$ 0,00", () => {
    const idx = indexarCelulas([
      { Conta: "Servidor", "Apr-26": "" },
      { Conta: "servidor", "Apr-26": null },
    ], ["Apr-26"]);
    expect(idx.get("servidor")!["Apr-26"]).toBeNull();
  });

  it("zero de verdade não é confundido com vazio", () => {
    const idx = indexarCelulas([{ Conta: "IOF", "Apr-26": 0 }], ["Apr-26"]);
    expect(idx.get("iof")!["Apr-26"]).toBe(0);
  });

  it("linha sem rótulo é ignorada", () => {
    const idx = indexarCelulas([{ Conta: "  ", "Apr-26": -1 }], ["Apr-26"]);
    expect(idx.size).toBe(0);
  });
});

describe("celulaNumero", () => {
  it("preserva o vazio e lê o formato da planilha", () => {
    expect(celulaNumero("")).toBeNull();
    expect(celulaNumero(null)).toBeNull();
    expect(celulaNumero("-")).toBeNull();
    expect(celulaNumero(-16518)).toBe(-16518);
    expect(celulaNumero("(1.234,50)")).toBe(-1234.5);
    expect(celulaNumero("R$ 1.234,50")).toBe(1234.5);
  });
});

/* O esquema é copiado para supabase/functions/_shared porque Edge Function é Deno
   e não enxerga `src/`. Cópia envelhece calada — rubrica nova só na tela ficaria
   de fora da conta do total do valor manual. Este teste é o alarme. */
describe("espelho do esquema no servidor", () => {
  it("a DRE do servidor é idêntica à da tela", () => {
    expect(DRE_SERVIDOR).toEqual(DRE_SCHEMA);
  });

  it("a DFC do servidor é idêntica à da tela", () => {
    expect(DFC_SERVIDOR).toEqual(DFC_SCHEMA);
  });
});

describe("alvosDoAjuste", () => {
  it("leva a rubrica de custo até o lucro, passando pelo bloco", () => {
    expect(alvosDoAjuste("dre", "Servidor")).toEqual({
      ancestrais: ["(-) Custos Operacionais"],
      totais: ["Margem de contribuição", "EBITDA", "Lucro Líquido"],
    });
  });

  it("não deixa o resultado financeiro mexer no EBITDA", () => {
    expect(alvosDoAjuste("dre", "(-) Depreciação & Amortização").totais).toEqual(["Lucro Líquido"]);
  });

  it("sobe a cadeia inteira quando a rubrica é neta", () => {
    expect(alvosDoAjuste("dre", "Equipe Marketing")).toEqual({
      ancestrais: ["(-) SG&A", "Pessoal"],
      totais: ["EBITDA", "Lucro Líquido"],
    });
  });

  it("acha a rubrica sem depender da caixa", () => {
    expect(alvosDoAjuste("dre", "encargos sociais").ancestrais).toEqual(["(-) SG&A", "Pessoal"]);
  });

  it("rubrica fora do esquema não repercute em nada", () => {
    expect(alvosDoAjuste("dre", "Conta que não existe")).toEqual({ ancestrais: [], totais: [] });
  });
});

describe("bloco Não Operacional", () => {
  it("inclui a rubrica onde o valor realmente mora", () => {
    // a base guarda o total em "(+) Resultado Não Operacional"; sem esse filho o
    // bloco somava zero e a tela mostrava "–" com R$ 17 mil escondidos
    const bloco = DRE_SCHEMA.find((n) => n.label === "(+/-) Resultado Não Operacional")!;
    const filhos = (bloco.children ?? []).map((c) => c.label);
    expect(filhos).toContain("(+) Resultado Não Operacional");

    const idx = indexar([{ Conta: "(+) Resultado Não Operacional", "Jan-24": 17043 }]);
    expect(valorDoNo(idx, bloco, "Jan-24")).toBe(17043);
  });
});

/* ==========================================================================
 *  A DFC segue o TRACKER — é a demonstração que a diretoria assina.
 *
 *  Cada caso aqui é uma diferença real que foi encontrada comparando o CSV do
 *  Tracker vOMIE com a tela, em 11/08/2026. Sem estes testes, cada um deles
 *  volta na próxima mexida no esquema — e volta calado.
 * ======================================================================== */
describe("DFC × tracker", () => {
  const bloco = (label: string): Node =>
    [...DFC_SCHEMA, ...DFC_SCHEMA.flatMap((n) => n.children ?? [])].find((n) => n.label === label)!;
  const filhos = (label: string) => flattenLabels(bloco(label).children ?? []);

  /* A DFC do tracker, linha por linha e na ordem em que a diretoria a lê. As
     folhas do esquema têm que ser ESTA lista — nem uma a mais (linha inventada
     vira "—" eterno na tela) nem uma a menos (rubrica sem casa some da conta).
     Copiado do CSV "Takeat - Tracker de Orçamento - vOMIE Automática". */
  const TRACKER = [
    // Entradas
    "Entrada de Receita", "Antecipação da Receita", "Receita de Serviços",
    "Receita Markup", "(+) Receita financeira",
    // Saídas · impostos e deduções
    "Simples Nacional", "PIS", "COFINS", "ISS", "ICMS", "Inadimplência",
    "Abatimento de Antecipação da Receita", "Parcelamento de Impostos",
    "Devoluções", "Retenção de Contribuição",
    // Saídas · custos de operação
    "Equipe Operacional", "CMV Materiais", "Meios de Pagamento",
    "Premiações Operacionais", "Servidor", "Softwares Operacionais", "Outros Custos",
    // Saídas · pessoal
    "Equipe Administrativa", "Equipe Marketing", "Equipe Parcerias", "Equipe Comercial",
    "Equipe Onboarding", "Equipe Tecnologia", "Benefícios", "Encargos Sociais",
    // Saídas · administrativas
    "Ocupação & Escritório", "Assessorias & Consultorias", "Softwares Administrativos",
    "Viagens & Transportes Adm", "Outras despesas Adm",
    // Saídas · marketing & vendas
    "Campanhas de Mídia Paga", "Campanhas de Outros Canais",
    "Comissões Consultores / Parceiros", "Premiações", "MGM",
    "Softwares Marketing & Vendas", "Agências & Consultorias",
    "Viagens & Transportes Mkt", "Eventos e Feiras", "Outras despesas Mkt",
    // Saídas · financeiras e imposto sobre o lucro
    "(-) Juros", "(-) IOF", "IRPJ", "CSLL",
    // Investimentos
    "(+) Resultado Não Operacional", "(-) Compra de Equipamentos",
    "(-) Investimentos em Estrutura", "(-) Compra de Participação", "Depósitos e Caução",
    // Financiamento
    "(+) Novos Empréstimos & Financiamentos", "(-) Amortização de Financiamentos",
    "(-) Dividendos", "(-) Rodada de Investimentos",
    // Conferência do tracker, abaixo da demonstração
    "Fluxo de Caixa Livre - Banco", "Diferença de Saldos",
  ];

  const folhas = (ns: Node[]): string[] =>
    ns.flatMap((n) => (n.children?.length ? folhas(n.children) : n.label));

  it("as folhas são exatamente as linhas do tracker, na ordem dele", () => {
    // Fora as linhas de conta (Entradas/Saídas/FCO/Fluxo Livre/Cashburn…), que
    // são somas e não rubricas.
    const CALCULADAS = new Set([
      "Fluxo de Caixa Operacional", "Fluxo Livre", "Cashburn",
    ]);
    expect(folhas(DFC_SCHEMA).filter((l) => !CALCULADAS.has(l))).toEqual(TRACKER);
  });

  /* As duas que motivaram o acerto: a DFC do tracker não separa o recebimento
     por produto — assinatura e material entram inteiros em "Entrada de Receita".
     Estavam no esquema e apareciam na tela como um "—" em todos os meses. */
  it("não tem linha de receita que o tracker não tem", () => {
    const todas = flattenLabels(DFC_SCHEMA);
    expect(todas).not.toContain("Receita de Assinaturas");
    expect(todas).not.toContain("Receita com Materiais");
    expect(filhos("Entradas Operacionais")).toContain("Entrada de Receita");
  });

  it("nem rubrica de despesa inventada", () => {
    const todas = flattenLabels(DFC_SCHEMA);
    expect(todas).not.toContain("(-) Depesas Financeiras"); // typo que nunca existiu no tracker
    expect(todas).not.toContain("IRF");                     // é linha da DRE, não da DFC
  });

  it("Equipe Parcerias existe no Pessoal — R$ 27,7 mil de jan–mar/26 não apareciam", () => {
    expect(filhos("Pessoal")).toContain("Equipe Parcerias");
  });

  it("o não operacional entra em Investimentos, como no tracker", () => {
    // Estava nas Entradas e inflava o fluxo operacional em R$ 12,8 mil (jul/26).
    expect(filhos("Investimentos")).toContain("(+) Resultado Não Operacional");
    expect(filhos("Entradas Operacionais")).not.toContain("(+) Resultado Não Operacional");
  });

  it("antecipação de recebível é caixa operacional, não financiamento", () => {
    expect(filhos("Entradas Operacionais")).toContain("Antecipação da Receita");
    expect(filhos("Financiamento")).not.toContain("Antecipação da Receita");
    expect(filhos("Saídas Operacionais")).toContain("Abatimento de Antecipação da Receita");
  });

  it("os apelidos cobrem os nomes que o tracker usa", () => {
    const apelido = (label: string) => bloco(label).alias ?? [];
    expect(apelido("Entradas Operacionais")).toContain("Entradas");
    expect(apelido("Saídas Operacionais")).toContain("Saídas");
    expect(apelido("Investimentos")).toContain("Fluxo de Caixa de Investimentos");
    expect(apelido("Financiamento")).toContain("Fluxo de Financiamento");
    expect(DFC_SCHEMA.find((n) => n.label === "Fluxo Livre")!.alias)
      .toContain("Fluxo de Caixa Livre");
  });

  /* Grupo renomeado guarda o nome antigo: o blob já tem as linhas "Impostos" e
     "Financeiras" escritas pelo `derivadas`, e sem o apelido nasceria uma linha
     nova ao lado da velha — duas somas para o mesmo bloco. */
  it("grupo renomeado continua escrevendo na linha que já existe", () => {
    const apelido = (label: string) => bloco(label).alias ?? [];
    expect(apelido("Impostos & Deduções")).toContain("Impostos");
    expect(apelido("Financeiras & Impostos sobre o Lucro")).toContain("Financeiras");
  });
});

describe("valorComAlias", () => {
  const entradas = DFC_SCHEMA[0]; // "Entradas Operacionais", apelido "Entradas"

  it("acha a linha pelo nome do tracker", () => {
    expect(valorComAlias(entradas, (r) => (r === "Entradas" ? 1_061_185 : null))).toBe(1_061_185);
  });

  /* O mês em que as DUAS grafias existem — o tracker importou "Entradas" e o
     omie-sync gravou "Entradas Operacionais" — contaria em dobro se somasse. */
  it("nunca soma os dois nomes: o rótulo do esquema ganha", () => {
    expect(valorComAlias(entradas, (r) => (r === "Entradas Operacionais" ? 7 : 10))).toBe(7);
  });

  it("sem nenhum dos nomes, devolve vazio — não zero", () => {
    expect(valorComAlias(entradas, () => null)).toBeNull();
  });
});
