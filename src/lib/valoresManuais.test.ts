import { describe, it, expect } from "vitest";
import { paraNumero } from "./valoresManuais";
import {
  aplicarManuaisNoBlob,
  type Dados,
  type ValorManual,
} from "../../supabase/functions/_shared/valores-manuais.ts";

describe("paraNumero", () => {
  it("lê o que sai do teclado do financeiro", () => {
    expect(paraNumero("-5.488,00")).toBe(-5488);
    expect(paraNumero("R$ 5.488,75")).toBe(5488.75);
    expect(paraNumero("(5.488)")).toBe(-5488);
    expect(paraNumero("5488")).toBe(5488);
    expect(paraNumero("5488.75")).toBe(5488.75);
  });

  it("trata ponto com três dígitos como milhar, que é o que o Excel pt-BR exporta", () => {
    expect(paraNumero("1.234")).toBe(1234);
    expect(paraNumero("1.234.567")).toBe(1234567);
    // Sem grupo de três, ponto é decimal.
    expect(paraNumero("1.5")).toBe(1.5);
  });

  it("devolve null no que não é número", () => {
    expect(paraNumero("")).toBeNull();
    expect(paraNumero("  ")).toBeNull();
    expect(paraNumero("abc")).toBeNull();
  });
});

/* --------------------------------------------------------------------------
 * Aplicação no blob. O que se testa aqui é o que quebraria em silêncio: o total
 * que não acompanha a rubrica, e o valor que dobra a cada reaplicação.
 * ------------------------------------------------------------------------ */

const blob = (): Dados => ({
  columns: ["Conta", "May-26", "Jun-26"],
  rows: [
    { Conta: "Servidor", "May-26": -95366, "Jun-26": -105077 },
    { Conta: "(-) Custos Operacionais", "May-26": -263257, "Jun-26": -262115 },
    { Conta: "(+/-) Resultado Financeiro", "May-26": 20220, "Jun-26": 15726 },
    { Conta: "Margem de contribuição", "May-26": 750368, "Jun-26": 803431 },
    { Conta: "EBITDA", "May-26": -491219, "Jun-26": -364691 },
    { Conta: "Lucro Líquido", "May-26": -445269, "Jun-26": -344368 },
  ],
});

const manual = (over: Partial<ValorManual> = {}): ValorManual => ({
  id: "m1",
  tipo: "dre",
  rubrica: "(-) Juros",
  col_key: "May-26",
  modo: "substitui",
  valor: -1000,
  valor_base: null,
  valor_aplicado: null,
  ...over,
});

const celula = (d: Dados, conta: string, col: string) =>
  d.rows.find((r) => r.Conta === conta)?.[col] ?? null;

describe("aplicarManuaisNoBlob", () => {
  it("cria a rubrica que não existia e leva o ajuste ao bloco e ao lucro", () => {
    const { dados, updates } = aplicarManuaisNoBlob("dre", blob(), [manual()], new Set());

    expect(celula(dados, "(-) Juros", "May-26")).toBe(-1000);
    expect(celula(dados, "(+/-) Resultado Financeiro", "May-26")).toBe(19220);
    expect(celula(dados, "Lucro Líquido", "May-26")).toBe(-446269);
    // Resultado financeiro está abaixo do EBITDA: não pode mexer nele.
    expect(celula(dados, "EBITDA", "May-26")).toBe(-491219);
    // Mês vizinho intocado.
    expect(celula(dados, "Lucro Líquido", "Jun-26")).toBe(-344368);
    expect(updates).toEqual([{ id: "m1", valor_base: null, valor_aplicado: -1000 }]);
  });

  it("substitui o valor do Omie e desconta só a diferença do total", () => {
    const m = manual({ rubrica: "Servidor", valor: -100000 });
    const { dados } = aplicarManuaisNoBlob("dre", blob(), [m], new Set());

    expect(celula(dados, "Servidor", "May-26")).toBe(-100000);
    // delta = -4634, não -100000
    expect(celula(dados, "(-) Custos Operacionais", "May-26")).toBe(-267891);
    expect(celula(dados, "Margem de contribuição", "May-26")).toBe(745734);
    expect(celula(dados, "EBITDA", "May-26")).toBe(-495853);
    expect(celula(dados, "Lucro Líquido", "May-26")).toBe(-449903);
  });

  it("soma ao que veio do Omie em vez de trocar", () => {
    const m = manual({ rubrica: "Servidor", modo: "soma", valor: -5000 });
    const { dados } = aplicarManuaisNoBlob("dre", blob(), [m], new Set());

    expect(celula(dados, "Servidor", "May-26")).toBe(-100366);
    expect(celula(dados, "EBITDA", "May-26")).toBe(-496219);
  });

  it("reaplicar em mês travado não dobra o valor nem o total", () => {
    const primeira = aplicarManuaisNoBlob("dre", blob(), [manual()], new Set());
    // Mês travado: o sync não reescreveu a coluna, então o blob que chega já tem
    // o manual dentro. É aqui que a versão ingênua somaria de novo.
    const guardado = manual({ valor_base: null, valor_aplicado: -1000 });
    const segunda = aplicarManuaisNoBlob("dre", primeira.dados, [guardado], new Set());

    expect(celula(segunda.dados, "(-) Juros", "May-26")).toBe(-1000);
    expect(celula(segunda.dados, "(+/-) Resultado Financeiro", "May-26")).toBe(19220);
    expect(celula(segunda.dados, "Lucro Líquido", "May-26")).toBe(-446269);
    expect(segunda.updates).toEqual([]); // nada mudou, nada a regravar
  });

  it("em mês destravado a base volta a ser o que o sync trouxe", () => {
    // O sync refez May-26 do zero (o blob volta sem o manual) e avisa qual coluna
    // reescreveu — o delta entra uma vez só, sobre o número novo.
    const guardado = manual({ rubrica: "Servidor", valor: -100000, valor_base: -95366, valor_aplicado: -100000 });
    const novo = blob();
    novo.rows[0]["May-26"] = -97000; // Omie trouxe outro valor nesta sync
    const { dados, updates } = aplicarManuaisNoBlob("dre", novo, [guardado], new Set(["May-26"]));

    expect(celula(dados, "Servidor", "May-26")).toBe(-100000);
    expect(celula(dados, "EBITDA", "May-26")).toBe(-494219); // -491219 - 3000
    expect(updates).toEqual([{ id: "m1", valor_base: -97000, valor_aplicado: -100000 }]);
  });

  /* O caso oposto do de cima, e o que passava batido: a rubrica que o Omie NÃO
     tem — que é a razão de alguém digitar à mão. O sync refaz a coluna e
     recalcula os totais sem o manual, mas não escreve nada na célula dela, então
     o manual continua lá. Lendo a célula como base, o delta dava zero e o total
     ficava sem o ajuste — a rubrica aparecia na tela e o EBITDA não mexia. */
  it("em mês destravado, rubrica que o Omie não tem mantém o ajuste no total", () => {
    const guardado = manual({ valor_base: null, valor_aplicado: -1000 });
    // O sync refez May-26: totais no automático, célula do manual intocada.
    const posSync = blob();
    posSync.rows.push({ Conta: "(-) Juros", "May-26": -1000 });

    const { dados } = aplicarManuaisNoBlob("dre", posSync, [guardado], new Set(["May-26"]));

    expect(celula(dados, "(-) Juros", "May-26")).toBe(-1000);
    expect(celula(dados, "(+/-) Resultado Financeiro", "May-26")).toBe(19220);
    expect(celula(dados, "Lucro Líquido", "May-26")).toBe(-446269);
  });

  it("dois syncs seguidos não acumulam o ajuste no total", () => {
    const guardado = manual({ valor_base: null, valor_aplicado: -1000 });
    const umSync = () => {
      const posSync = blob(); // sync sempre devolve os totais no automático
      posSync.rows.push({ Conta: "(-) Juros", "May-26": -1000 });
      return aplicarManuaisNoBlob("dre", posSync, [guardado], new Set(["May-26"])).dados;
    };

    umSync();
    const segunda = umSync();

    expect(celula(segunda, "(-) Juros", "May-26")).toBe(-1000);
    expect(celula(segunda, "Lucro Líquido", "May-26")).toBe(-446269); // não -447269
  });

  /* O bug que fazia a Margem de contribuição nascer errada logo depois de
     importar o tracker. O arquivo é a fonte de verdade: chega com a rubrica JÁ
     no valor que alguém digitou à mão e com os totais já batendo com ela. Como a
     célula coincidia com `valor_aplicado`, a heurística de "o sync não passou
     aqui" ligava, a base virava o `valor_base` velho do Omie e o delta contra
     ele era ressomado em cima de totais que já estavam certos. */
  it("import de tracker não ressoma o delta nos totais que já vieram certos", () => {
    const guardado = manual({ rubrica: "Servidor", valor: -100000, valor_base: -95366, valor_aplicado: -100000 });
    // O tracker traz a rubrica no valor digitado e os totais coerentes com ela.
    const doTracker = blob();
    doTracker.rows[0]["May-26"] = -100000;
    doTracker.rows[1]["May-26"] = -267891;  // (-) Custos Operacionais
    doTracker.rows[3]["May-26"] = 745734;   // Margem de contribuição
    doTracker.rows[4]["May-26"] = -495853;  // EBITDA

    const { dados } = aplicarManuaisNoBlob(
      "dre", doTracker, [guardado], new Set(["May-26"]), [], new Set(["May-26"]),
    );

    expect(celula(dados, "Servidor", "May-26")).toBe(-100000);
    expect(celula(dados, "(-) Custos Operacionais", "May-26")).toBe(-267891);
    expect(celula(dados, "Margem de contribuição", "May-26")).toBe(745734);
    expect(celula(dados, "EBITDA", "May-26")).toBe(-495853);
  });

  it("import de tracker ainda aplica o manual que o arquivo não traz", () => {
    // O tracker não tem "(-) Juros": o manual continua valendo e o total desce.
    const guardado = manual({ valor_base: null, valor_aplicado: -1000 });
    const { dados } = aplicarManuaisNoBlob(
      "dre", blob(), [guardado], new Set(["May-26"]), [], new Set(["May-26"]),
    );

    expect(celula(dados, "(-) Juros", "May-26")).toBe(-1000);
    expect(celula(dados, "Lucro Líquido", "May-26")).toBe(-446269);
  });

  it("remover devolve a célula e o total ao automático", () => {
    const aplicado = aplicarManuaisNoBlob("dre", blob(), [manual()], new Set());
    const removido = manual({ valor_base: null, valor_aplicado: -1000 });
    const { dados } = aplicarManuaisNoBlob("dre", aplicado.dados, [], new Set(), [removido]);

    // A linha só tinha esta célula: sai do blob inteira.
    expect(dados.rows.find((r) => r.Conta === "(-) Juros")).toBeUndefined();
    expect(celula(dados, "(+/-) Resultado Financeiro", "May-26")).toBe(20220);
    expect(celula(dados, "Lucro Líquido", "May-26")).toBe(-445269);
  });

  it("não inventa total onde o mês ainda não tem linha de total", () => {
    const vazio: Dados = { columns: ["Conta", "May-26"], rows: [{ Conta: "Servidor", "May-26": -1000 }] };
    const { dados } = aplicarManuaisNoBlob("dre", vazio, [manual({ rubrica: "Servidor", valor: -2000 })], new Set());

    expect(celula(dados, "Servidor", "May-26")).toBe(-2000);
    expect(dados.rows.find((r) => r.Conta === "EBITDA")).toBeUndefined();
  });

  it("respeita a grafia que já está na base em vez de criar linha irmã", () => {
    const base: Dados = {
      columns: ["Conta", "May-26"],
      rows: [{ Conta: "Encargos sociais", "May-26": -1559 }],
    };
    const { dados } = aplicarManuaisNoBlob(
      "dre", base, [manual({ rubrica: "Encargos Sociais", valor: -2000 })], new Set(),
    );

    expect(dados.rows).toHaveLength(1);
    expect(dados.rows[0].Conta).toBe("Encargos sociais");
    expect(dados.rows[0]["May-26"]).toBe(-2000);
  });

  it("aceita mês que ainda não existia no blob, na ordem certa", () => {
    const { dados } = aplicarManuaisNoBlob(
      "dre", blob(), [manual({ col_key: "Jul-26", valor: -500 })], new Set(),
    );

    expect(dados.columns).toEqual(["Conta", "May-26", "Jun-26", "Jul-26"]);
    expect(celula(dados, "(-) Juros", "Jul-26")).toBe(-500);
  });
});

/* --------------------------------------------------------------------------
 * O caso real, com os números de Jul-26 que estavam no banco.
 *
 * Reproduz o import do "Tracker vOMIE Automática (Realizado)" com as dez linhas
 * de `demonstracoes_valor_manual` que existiam para o mês. O primeiro teste
 * congela o BUG (a Margem que apareceu na tela) para que, se a heurística
 * voltar, a suíte diga exatamente qual número volta a sair errado.
 * ------------------------------------------------------------------------ */

const JUL = "Jul-26";
const manualJul = (rubrica: string, valor: number, valor_base: number | null): ValorManual => ({
  id: rubrica, tipo: "dre", rubrica, col_key: JUL, modo: "substitui", valor, valor_base, valor_aplicado: valor,
});

const MANUAIS_JUL26 = [
  manualJul("Campanhas de Outros Canais", -13000, -13000),
  manualJul("COFINS", -33238, -36587.87),
  manualJul("Comissões Consultores / Parceiros", -4529, -6222.18),
  manualJul("Devoluções", -23973, -2309),
  manualJul("ISS", -22159, -24392.06),
  manualJul("Meios de Pagamento", -20866.1, -20866),
  manualJul("MGM", -1700, -400),
  manualJul("Outros Custos", -257, null),
  manualJul("PIS", -7202, -7927.37),
  manualJul("Receita Markup", 19396, 16520.95),
];

/** Jul-26 como o arquivo do tracker manda — a demonstração fechada. */
const doTracker = (): Dados => ({
  columns: ["Conta", JUL],
  rows: ([
    ["Receita de Assinaturas", 1180342], ["Enterprise", 52588], ["Receita Recorrente", 1232930],
    ["Receita com Materiais", 2113], ["Receita Markup", 19396], ["Receita Spot", 21509],
    ["Receita Bruta", 1254439],
    ["PIS", -7202], ["COFINS", -33238], ["ISS", -22159], ["Devoluções", -23973],
    ["(-) Deduções da receita", -86572], ["Receita Líquida", 1167867],
    ["Equipe Operacional", -72385], ["Premiações Operacionais", -22448], ["Meios de Pagamento", -20866],
    ["CMV Materiais", -4063], ["Servidor", -140003], ["Softwares Operacionais", -53199], ["Outros Custos", -257],
    ["(-) Custos Operacionais", -313222], ["Margem de contribuição", 854646],
    ["Pessoal", -556067], ["Despesas Administrativas", -144086],
    ["Campanhas de Outros Canais", -13000], ["Comissões Consultores / Parceiros", -4529], ["MGM", -1700],
    ["Despesas Marketing & Vendas", -532824], ["(-) SG&A", -1232977],
    ["EBITDA", -378331], ["Lucro Líquido", -357769],
  ] as [string, number][]).map(([Conta, v]) => ({ Conta, [JUL]: v })),
});

describe("import do tracker · Jul-26 real", () => {
  it("sem a marca de coluna reescrita, sai o mês errado que apareceu na tela", () => {
    const { dados } = aplicarManuaisNoBlob("dre", doTracker(), MANUAIS_JUL26, new Set([JUL]));
    expect(celula(dados, "Margem de contribuição", JUL)).toBe(841908.25);
    expect(celula(dados, "EBITDA", JUL)).toBe(-390675.57);
  });

  it("com ela, o mês é o do tracker de ponta a ponta", () => {
    const { dados } = aplicarManuaisNoBlob(
      "dre", doTracker(), MANUAIS_JUL26, new Set([JUL]), [], new Set([JUL]),
    );
    expect(celula(dados, "Receita Bruta", JUL)).toBe(1254439);
    expect(celula(dados, "(-) Deduções da receita", JUL)).toBe(-86572);
    expect(celula(dados, "Receita Líquida", JUL)).toBe(1167867);
    expect(celula(dados, "(-) SG&A", JUL)).toBe(-1232977);
    // Os R$ 0,10 são o único manual que de fato diverge do arquivo: alguém
    // digitou -20.866,10 em Meios de Pagamento e o tracker traz -20.866.
    expect(celula(dados, "Margem de contribuição", JUL)).toBe(854645.9);
    expect(celula(dados, "EBITDA", JUL)).toBe(-378331.1);
    expect(celula(dados, "Lucro Líquido", JUL)).toBe(-357769.1);
  });
});
