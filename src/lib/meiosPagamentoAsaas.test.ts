import { describe, it, expect } from "vitest";
import {
  colKeyDoMes,
  decidirMeses,
  aplicaveis,
  RUBRICA_MEIOS_PAGAMENTO,
  type TaxaDoMes,
} from "../../supabase/functions/_shared/meios-pagamento-asaas.ts";

/* Os números são os reais do extrato do Asaas em 2026 — inclusive o que faz o
   teste existir: julho tem R$ 5.682,81 porque o espelho só começou no dia 25.
   Escrever isso na célula que hoje diz R$ 20.866 seria trocar o mês inteiro por
   sete dias dele, com um número plausível o bastante para ninguém desconfiar. */

const mes = (p: Partial<TaxaDoMes> & { mes: string }): TaxaDoMes => ({
  total: 0, lancamentos: 0, detalhe: null, de: null, ate: null, coberto: true, ...p,
});

const jul = mes({
  mes: "2026-07", total: 5682.81, lancamentos: 2496, coberto: false,
  de: "2026-07-25", ate: "2026-07-31",
  detalhe: { cartao: 3221.65, nf: 1340, pix: 445.76, mensageria: 384.48, boleto: 234.82, whatsapp: 56.1 },
});
const ago = mes({
  mes: "2026-08", total: 21012.86, lancamentos: 5397, coberto: true,
  de: "2026-08-01", ate: "2026-08-31",
  detalhe: { cartao: 16074.06, mensageria: 1402.64, pix: 1307.43, nf: 1090, boleto: 1008.93, whatsapp: 129.8 },
});
const set = mes({
  mes: "2026-09", total: 2071.39, lancamentos: 476, coberto: true,
  de: "2026-09-01", ate: "2026-09-03",
});

const HOJE = "2026-09-03";
const ESPELHO = "2026-07-25";

describe("colKeyDoMes", () => {
  it("usa o mês em INGLÊS, como a coluna do blob", () => {
    expect(colKeyDoMes("2026-08")).toBe("Aug-26");
    expect(colKeyDoMes("2026-09")).toBe("Sep-26");
    // 'Ago-26' e 'Set-26' criariam colunas que a tela nunca lê.
    expect(colKeyDoMes("2026-08")).not.toBe("Ago-26");
    expect(colKeyDoMes("2026-09")).not.toBe("Set-26");
  });

  it("cobre a volta do ano e recusa o que não é mês", () => {
    expect(colKeyDoMes("2026-01")).toBe("Jan-26");
    expect(colKeyDoMes("2026-12")).toBe("Dec-26");
    expect(colKeyDoMes("2026-13")).toBeNull();
    expect(colKeyDoMes("2026-00")).toBeNull();
    expect(colKeyDoMes("ago/26")).toBeNull();
    expect(colKeyDoMes("")).toBeNull();
  });
});

describe("decidirMeses", () => {
  it("escreve o mês fechado que o espelho cobre inteiro, com a despesa negativa", () => {
    const d = aplicaveis(decidirMeses([ago], HOJE, ESPELHO));
    expect(d).toHaveLength(1);
    expect(d[0].col_key).toBe("Aug-26");
    expect(d[0].valor).toBe(-21012.86);
    expect(d[0].lancamentos).toBe(5397);
    expect(d[0].parcial).toBe(false);
  });

  it("PULA o mês que o espelho não cobre desde o dia 1, e diz por quê", () => {
    const [d] = decidirMeses([jul], HOJE, ESPELHO);
    expect(d.aplicar).toBe(false);
    if (d.aplicar) return;
    expect(d.motivo).toContain("25/07/2026");
    expect(d.motivo).toContain("31/07/2026");
  });

  it("escreve o mês corrente, marcado como parcial", () => {
    const [d] = decidirMeses([set], HOJE, ESPELHO);
    expect(d.aplicar).toBe(true);
    if (!d.aplicar) return;
    expect(d.col_key).toBe("Sep-26");
    expect(d.parcial).toBe(true);
  });

  it("não cria coluna no futuro quando uma data do extrato vem errada", () => {
    const [d] = decidirMeses([mes({ mes: "2026-11", total: 900, coberto: true })], HOJE, ESPELHO);
    expect(d.aplicar).toBe(false);
    if (d.aplicar) return;
    expect(d.motivo).toBe("mês no futuro");
  });

  it("não escreve zero: mês com cobrança tem taxa, então zero é extrato faltando", () => {
    const [d] = decidirMeses([mes({ mes: "2026-08", total: 0, coberto: true })], HOJE, ESPELHO);
    expect(d.aplicar).toBe(false);
    if (d.aplicar) return;
    expect(d.motivo).toBe("nenhuma taxa no mês");
  });

  it("devolve os três meses em ordem, decidindo cada um por conta própria", () => {
    const d = decidirMeses([set, jul, ago], HOJE, ESPELHO);
    expect(d.map((x) => x.mes)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(d.map((x) => x.aplicar)).toEqual([false, true, true]);
  });

  it("a rubrica é a mesma dos dois esquemas", () => {
    expect(RUBRICA_MEIOS_PAGAMENTO).toBe("Meios de Pagamento");
  });
});
