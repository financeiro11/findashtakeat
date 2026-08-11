import { describe, it, expect } from "vitest";
import { mesesDeReferencia, type LinhaBlob } from "./mesReferencia";

/* O caso real: o tracker de Jul/26 foi importado com uma coluna de Ago/26 quase
   vazia — 19 células contra 63, e nenhuma Receita Líquida. O import trancou as
   duas, e os cartões passaram a ler Agosto: receita "—", EBITDA que era só um
   pedaço do SG&A, e "▲ 79,6%" contra Julho inteiro. */

const COLS = ["Conta", "May-26", "Jun-26", "Jul-26", "Aug-26"];
const TRAVADOS = new Set(COLS.slice(1));

const blob = (): LinhaBlob[] => [
  { Conta: "Receita Líquida", "May-26": 1013625, "Jun-26": 1065546, "Jul-26": 1167867 },
  { Conta: "(-) SG&A", "May-26": -1241588, "Jun-26": -1168022, "Jul-26": -1232974, "Aug-26": -77010 },
  { Conta: "EBITDA", "May-26": -491220, "Jun-26": -364592, "Jul-26": -378328, "Aug-26": -77010 },
];

describe("mesesDeReferencia", () => {
  it("ignora o mês que está travado mas não tem demonstração", () => {
    const r = mesesDeReferencia(COLS, blob(), TRAVADOS, "dre");
    expect(r.lastCol).toBe("Jul-26");
    expect(r.prevCol).toBe("Jun-26");
  });

  it("uma coluna vazia no meio não vira o comparativo", () => {
    const rows = blob();
    // Jun sem receita (mês que o Omie ainda não fechou): pula para Mai.
    delete (rows[0] as Record<string, unknown>)["Jun-26"];
    const r = mesesDeReferencia(COLS, rows, TRAVADOS, "dre");
    expect(r.lastCol).toBe("Jul-26");
    expect(r.prevCol).toBe("May-26");
  });

  /* Instalação nova, antes do primeiro import: nada travado. Os cartões não
     podem ficar vazios só por isso — vale o que tem demonstração. */
  it("sem nenhum mês travado, usa os que têm âncora", () => {
    const r = mesesDeReferencia(COLS, blob(), new Set(), "dre");
    expect(r.lastCol).toBe("Jul-26");
    expect(r.prevCol).toBe("Jun-26");
  });

  it("com um só mês travado, não compara fechado com aberto", () => {
    // Só Jul travado: os dois travados exigidos não existem, então vale a régua
    // da âncora — e Jun continua sendo a comparação certa, não Ago.
    const r = mesesDeReferencia(COLS, blob(), new Set(["Jul-26"]), "dre");
    expect(r.lastCol).toBe("Jul-26");
    expect(r.prevCol).toBe("Jun-26");
  });

  it("um mês só: mostra o número e não inventa variação", () => {
    const r = mesesDeReferencia(["Conta", "Jul-26"], blob(), TRAVADOS, "dre");
    expect(r.lastCol).toBe("Jul-26");
    expect(r.prevCol).toBeNull();
  });

  it("base sem a âncora em lugar nenhum não escolhe mês", () => {
    const r = mesesDeReferencia(COLS, [{ Conta: "Servidor", "Jul-26": -1 }], TRAVADOS, "dre");
    expect(r.lastCol).toBeNull();
    expect(r.prevCol).toBeNull();
  });

  it("acha a âncora sem depender da caixa nem de espaço", () => {
    const r = mesesDeReferencia(COLS, [{ Conta: " receita líquida ", "Jul-26": 10 }], TRAVADOS, "dre");
    expect(r.lastCol).toBe("Jul-26");
  });

  it("na DFC, ancora nas entradas — e acha a linha pelo apelido", () => {
    /* A âncora da DFC é o TOPO (entradas), não o fluxo operacional: Ago/26 tinha
       um FCO de R$ 394 mil feito só de saídas positivas de um sync parcial. E o
       tracker grava a linha como "Entradas", que é apelido de "Entradas
       Operacionais" no esquema. */
    const dfc: LinhaBlob[] = [
      { Conta: "Fluxo de Caixa Operacional", "Jun-26": -441511, "Jul-26": -308060, "Aug-26": 394527 },
      { Conta: "Entradas", "Jun-26": 1061185, "Jul-26": 1142573 },
    ];
    const r = mesesDeReferencia(COLS, dfc, TRAVADOS, "dfc");
    expect(r.lastCol).toBe("Jul-26");
    expect(r.prevCol).toBe("Jun-26");
  });
});
