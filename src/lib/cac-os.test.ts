import { describe, expect, it } from "vitest";
import { conferirComOS, mesesComCusto, type CustoOSMes } from "./cac-os";
import type { PainelRow } from "./cac";

const row = (grupo: string, rotulo: string, mes: number, valor: number, ordem = 0): PainelRow =>
  ({ linha_id: `${grupo}-${rotulo}`, grupo, rotulo, ordem, regra_nota: null, mes, valor, origem: "omie" } as PainelRow);
const os = (grupo: string, categoria: string, mes: number, valor: number | null): CustoOSMes =>
  ({ competencia: `2026-${String(mes).padStart(2, "0")}-01`, grupo, categoria, valor });

// Os números reais de ago/26 (18/09/2026).
const rows = [
  row("Equipes", "Branding e Conteúdo", 8, 36692.49, 10),
  row("Equipes", "Onboarding e Setup", 8, 48827.75, 20),
  row("Equipes", "Suporte", 8, 67145.14, 30),
  row("Equipes", "Field Sales", 8, 77093.38, 5),
  row("Comissões", "Contadores", 8, 0, 1),
  row("Investimentos", "Eventos", 8, 125777.83, 1),
  row("Equipes", "Field Sales", 7, 1, 5),
];
const custos = [
  os("Equipes", "Branding e Conteúdo", 8, 37692.49),
  os("Equipes", "Onboarding e Setup", 8, 47897.75),
  os("Equipes", "Suporte", 8, 63830.14),
  os("Equipes", "field sales", 8, 77093.38), // caixa diferente casa igual
  os("Investimentos", "Eventos", 8, 125777.83),
  os("Comissões", "Agência de Marketing", 8, 500), // só no OS
];

describe("conferirComOS", () => {
  const l = conferirComOS(rows, custos, 2026, 8);
  const de = (r: string) => l.find((x) => x.rotulo.toLowerCase() === r.toLowerCase())!;

  it("acha as três divergências de ago/26, com o sinal OS − Hub", () => {
    expect(de("Branding e Conteúdo")).toMatchObject({ bate: false });
    expect(de("Branding e Conteúdo").diferenca).toBeCloseTo(1000);
    expect(de("Onboarding e Setup").diferenca).toBeCloseTo(-930);
    expect(de("Suporte").diferenca).toBeCloseTo(-3315);
  });
  it("casa sem olhar caixa e acento", () => {
    expect(de("Field Sales")).toMatchObject({ bate: true });
  });
  it("linha zerada no Hub e ausente no OS bate; linha só no OS aparece", () => {
    expect(de("Contadores")).toMatchObject({ os: null, bate: true });
    expect(de("Agência de Marketing")).toMatchObject({ hub: 0, os: 500, bate: false });
  });
  it("ordena Equipes → Investimentos → Comissões e respeita a ordem do painel", () => {
    expect(l[0].rotulo).toBe("Field Sales");
    expect(l.findIndex((x) => x.grupo === "Investimentos")).toBeLessThan(l.findIndex((x) => x.grupo === "Comissões"));
  });
  it("só olha o mês pedido", () => {
    expect(conferirComOS(rows, custos, 2026, 7)).toHaveLength(1);
  });
});

describe("mesesComCusto", () => {
  it("junta os meses dos dois lados", () => {
    expect(mesesComCusto(rows, [...custos, os("Equipes", "Suporte", 9, 10)], 2026)).toEqual([7, 8, 9]);
  });
});
