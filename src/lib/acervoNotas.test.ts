import { describe, expect, it } from "vitest";
import {
  fraseDaJanela, totalParado, MOTIVO, MOTIVOS_PARADOS,
  type PorQueParou,
} from "./acervoNotas";

const quadro = (m: PorQueParou["motivos"]): PorQueParou =>
  ({ motivos: m, arquivado_por: {}, janela_erp: null });

describe("totalParado", () => {
  it("soma só o que pede gente — a fila da máquina fica de fora", () => {
    const p = quadro({
      sem_candidato: { docs: 661, valor: 2_521_280 },
      disputado: { docs: 398, valor: 1_279_352 },
      varios_alvos: { docs: 184, valor: 181_796 },
      // as três abaixo NÃO entram: são fila da máquina, não trabalho de gente
      sobe_sozinha: { docs: 458, valor: 1_805_176 },
      na_fila: { docs: 2, valor: 1_042 },
      no_erp: { docs: 412, valor: 836_396 },
    });
    expect(totalParado(p).docs).toBe(1243);
    expect(totalParado(p).valor).toBe(2_521_280 + 1_279_352 + 181_796);
  });

  it("o número não pode crescer quando o Hub resolve mais", () => {
    const antes = quadro({ disputado: { docs: 500, valor: 1000 }, sobe_sozinha: { docs: 10, valor: 50 } });
    const depois = quadro({ disputado: { docs: 100, valor: 200 }, sobe_sozinha: { docs: 410, valor: 850 } });
    expect(totalParado(depois).docs).toBeLessThan(totalParado(antes).docs);
  });

  it("sem quadro, zero — e não explode", () => {
    expect(totalParado(null)).toEqual({ docs: 0, valor: 0 });
    expect(totalParado(quadro({}))).toEqual({ docs: 0, valor: 0 });
  });
});

describe("MOTIVO", () => {
  it("todo motivo que pede gente é lido como falta — motivo sem saída vira monte", () => {
    for (const m of MOTIVOS_PARADOS) {
      expect(MOTIVO[m].tom, `${m} pede gente e tem de aparecer como falta`).toBe("falta");
      expect(MOTIVO[m].ajuda.length, `${m} precisa dizer o que fazer`).toBeGreaterThan(0);
    }
  });

  it("o que anda sozinho não pede nada de ninguém", () => {
    expect(MOTIVO.sobe_sozinha.tom).toBe("ok");
    expect(MOTIVO.na_fila.tom).toBe("ok");
    expect(MOTIVO.no_erp.tom).toBe("ok");
  });
});

describe("fraseDaJanela", () => {
  it("diz a data em que o contas a pagar do Hub começa", () => {
    const f = fraseDaJanela({ id: 1, inicio: "2026-04-02", titulos: 5013, atualizado_em: "x" });
    expect(f).toContain("02/04/2026");
    expect(f).toContain("5.013");
  });

  /* Vazio, e não `null`, de propósito: a tela testa com `!!` antes de renderizar,
   * e um null aqui viraria a string "null" na tela numa refatoração futura. */
  it("sem janela medida, não inventa frase", () => {
    expect(fraseDaJanela(null)).toBe("");
    expect(fraseDaJanela({ id: 1, inicio: null, titulos: null, atualizado_em: "x" })).toBe("");
  });
});
