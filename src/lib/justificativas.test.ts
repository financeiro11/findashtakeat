import { describe, it, expect } from "vitest";
import {
  ausenciasDoMes, celulasCandidatas, criarValorEm, fontesDaCelula, fraseDaAusencia,
  mesTemDadoSuficiente,
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

const candidatas = (
  rows: Record<string, unknown>[], mes = "Jul-26", anterior = "Jun-26", cols = COLS,
) =>
  celulasCandidatas({
    schema: SCHEMA, mes, mesAnterior: anterior, colunas: cols,
    valorEm: criarValorEm(rows, cols),
  });

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

/* ---------------------------------------------------------------------------
 * As duas réguas novas: a rubrica que sumiu e a que variou pouco em % mas muito
 * para o padrão dela. Um par de meses não enxerga nenhuma das duas.
 * ------------------------------------------------------------------------- */

const ANO = ["Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26"];

/** Uma linha do blob a partir dos valores mês a mês. */
const linha = (conta: string, vs: (number | string)[]) =>
  Object.fromEntries([["Conta", conta], ...ANO.map((c, i) => [c, vs[i] ?? ""])]) as Record<string, unknown>;

describe("ausência de rubrica recorrente", () => {
  /* O caso real: "(+) Receita financeira" na DFC, com valor em todo mês e
     zerada em agosto. Aqui na pele de "Enterprise", que é folha no esquema. */
  const RECEITA = [9_000, 11_000, 8_440, 12_142, 35_215, 18_067, 17_014, 0];

  it("a rubrica que vinha todo mês e agora está zerada vira candidata", () => {
    const c = candidatas([linha("Enterprise", RECEITA)], "Aug-26", "Jul-26", ANO)
      .find((x) => x.rubrica === "Enterprise");
    expect(c?.motivo).toBe("ausencia");
    expect(c?.serie?.mediana).toBe(12_142);
    expect(c?.serie?.zerada).toBe(true);
    expect(c?.serie?.ultimoMes).toBe("Jul-26");
    // O delta continua sendo o do par de meses: é o número que o comentário cita
    // e o que a função compara para saber se já envelheceu.
    expect(c?.delta).toBe(-17_014);
  });

  it("a ausência é o ÚNICO caso em que célula vazia vira comentário", () => {
    // Sem histórico recorrente, vazio continua sendo "ainda não preencheram".
    const c = candidatas(
      [linha("Enterprise", ["", "", "", "", "", "", 17_014, ""])], "Aug-26", "Jul-26", ANO,
    );
    expect(c.some((x) => x.rubrica === "Enterprise")).toBe(false);
  });

  it("a notícia é da FOLHA — o bloco e o total que somem junto não repetem", () => {
    // Enterprise zerando leva "Receita Recorrente" e "Receita Bruta" a zero
    // junto, porque linha com filhos vale a soma dos filhos. Sem o corte, a
    // mesma frase sairia três vezes.
    const c = candidatas([linha("Enterprise", RECEITA)], "Aug-26", "Jul-26", ANO)
      .filter((x) => x.motivo === "ausencia");
    expect(c.map((x) => x.rubrica)).toEqual(["Enterprise"]);
  });

  it("o bloco entra quando a ausência é DELE, e não de um filho", () => {
    // Duas folhas de R$ 700 cada: nenhuma passa sozinha no piso de R$ 1.000,
    // mas o bloco soma 1.400 e some inteiro.
    const c = candidatas([
      linha("Receita de Assinaturas", [700, 700, 700, 700, 700, 700, 700, 0]),
      linha("Enterprise", [700, 700, 700, 700, 700, 700, 700, 0]),
    ], "Aug-26", "Jul-26", ANO).filter((x) => x.motivo === "ausencia");
    expect(c.map((x) => x.rubrica)).toEqual(["Receita Recorrente"]);
  });

  it("a ausência vem na frente, mesmo com delta menor que o das variações", () => {
    const c = candidatas([
      linha("Enterprise", RECEITA),
      linha("Servidor", [-100_000, -100_000, -100_000, -100_000, -100_000, -100_000, -100_000, -400_000]),
    ], "Aug-26", "Jul-26", ANO);
    expect(c[0].rubrica).toBe("Enterprise");
    expect(c[0].delta).toBe(-17_014);        // menor em módulo que os 300k do Servidor
    // A variação do Servidor continua na lista, atrás — e o bloco que o soma
    // também, como sempre foi: no tracker se comenta muito em linha somada.
    expect(c.slice(1).map((x) => x.rubrica)).toContain("Servidor");
  });
});

describe("segunda régua: atípico contra a própria série", () => {
  it("pega a queda grande em R$ que não chega a 10%", () => {
    // 550k estável, cai para 520k: -5,5%. Passava batido pelo limiar percentual.
    const c = candidatas(
      [linha("Servidor", [-550_000, -552_000, -548_000, -551_000, -549_000, -550_500, -550_000, -520_000])],
      "Aug-26", "Jul-26", ANO,
    ).find((x) => x.rubrica === "Servidor");
    expect(c?.motivo).toBe("atipica");
    expect(c?.serie?.extremo).toBe("menor");
  });

  it("não inventa candidata na rubrica que oscila muito por natureza", () => {
    const c = candidatas(
      [linha("Servidor", [-100_000, -130_000, -90_000, -140_000, -85_000, -120_000, -110_000, -103_000])],
      "Aug-26", "Jul-26", ANO,
    );
    expect(c).toHaveLength(0);
  });

  it("o piso em R$ vale para a régua nova também", () => {
    const c = candidatas(
      [linha("Servidor", [-5_000, -5_010, -4_990, -5_005, -4_995, -5_000, -5_000, -4_600])],
      "Aug-26", "Jul-26", ANO,
    );
    expect(c).toHaveLength(0);   // 400 de diferença: atípico, mas irrelevante
  });
});

describe("ausenciasDoMes (a varredura do mês ABERTO)", () => {
  const valores: Record<string, (number | null)[]> = {
    Enterprise: [9_000, 11_000, 8_440, 12_142, 35_215, 18_067, 17_014, 0],
    "Receita de Assinaturas": [1_000_000, 1_010_000, 1_020_000, 1_030_000, 1_040_000, 1_050_000, 1_060_000, 1_070_000],
  };
  /* A leitura da PÁGINA, não a do blob: é o contrato da função. */
  const valorDaLinha = (node: Node, col: string) =>
    valores[node.label]?.[ANO.indexOf(col)] ?? null;

  it("acha a rubrica que não veio no mês em aberto", () => {
    const as = ausenciasDoMes({ schema: SCHEMA, colunas: ANO, mes: "Aug-26", valorDaLinha });
    expect(as.map((a) => a.rubrica)).toEqual(["Enterprise"]);
    expect(as[0].serie.meses).toBe(7);
  });

  it("cala no primeiro mês da base — sem história não há ausência", () => {
    expect(ausenciasDoMes({ schema: SCHEMA, colunas: ANO, mes: "Jan-26", valorDaLinha })).toHaveLength(0);
  });

  it("cala no mês que mal começou — senão o mês inteiro vira 'ausência'", () => {
    /* Regressão do ensaio contra a produção (01/09/2026): `Sep-26` da DRE tinha
       12 de 61 células preenchidas — o tracker traz meses à frente pela metade —
       e a varredura acusava 45 rubricas "que não vieram". Pior: o corte de
       colunas vazias das páginas não pega esse caso, porque exige a coluna
       INTEIRA zerada e essas 12 células a salvam. */
    const cols = [...ANO, "Sep-26"];
    const meio: Record<string, (number | null)[]> = {
      Enterprise: [...valores.Enterprise, null],
      "Receita de Assinaturas": [...valores["Receita de Assinaturas"], null],
      Servidor: [-90_000, -90_000, -90_000, -90_000, -90_000, -90_000, -90_000, -90_000, -1_000],
    };
    const ler = (node: Node, col: string) => meio[node.label]?.[cols.indexOf(col)] ?? null;
    expect(ausenciasDoMes({ schema: SCHEMA, colunas: cols, mes: "Sep-26", valorDaLinha: ler })).toHaveLength(0);
    // ...e o mês cheio de verdade continua sendo lido.
    expect(ausenciasDoMes({ schema: SCHEMA, colunas: cols, mes: "Aug-26", valorDaLinha: ler })
      .map((a) => a.rubrica)).toEqual(["Enterprise"]);
  });

  it("a frase é a mesma que vira pergunta sugerida", () => {
    const [a] = ausenciasDoMes({ schema: SCHEMA, colunas: ANO, mes: "Aug-26", valorDaLinha });
    const frase = fraseDaAusencia(a, (k) => k);
    expect(frase).toContain("nos 7 meses anteriores");
    expect(frase).toContain("Jul-26");
    expect(frase).toContain("está zerada");
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
