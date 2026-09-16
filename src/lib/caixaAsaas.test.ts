import { describe, expect, it } from "vitest";
import { comAsaasAoVivo, type FluxoProjetado } from "./caixaAsaas";

const ponto = (data: string, semAsaas: number, asaas = 0, acumuladoAsaas = 0) => ({
  data, saldo: semAsaas + acumuladoAsaas, entradas: 0, saidas: 0,
  entradas_asaas: asaas, asaas_a_vencer: asaas, asaas_confirmado: 0, asaas_qtd: asaas ? 1 : 0,
  saldo_sem_asaas: semAsaas,
});

const foto = (): FluxoProjetado => ({
  menor: { valor: 900, data: "2026-09-17" },
  maior_desembolso: { valor: 100, data: "2026-09-17" },
  saldo_final: { data: "2026-09-18", saldo: 950 },
  saldo_atual: 1000,
  asaas: { total: 50, a_vencer: 50, confirmado: 0, cobrancas: 1, origem: "espelho", atualizado_em: "2026-09-16T10:00:00Z" },
  pontos: [
    ponto("2026-09-16", 1000),
    ponto("2026-09-17", 900, 50, 50),
    ponto("2026-09-18", 900, 0, 50),
  ],
});

describe("comAsaasAoVivo", () => {
  it("refaz o saldo como a base sem Asaas mais o acumulado lido agora", () => {
    const f = comAsaasAoVivo(foto(), [
      { data: "2026-09-16", valor: "200", qtd: 2, a_vencer: "200", confirmado: 0 },
      { data: "2026-09-18", valor: 30, qtd: 1, a_vencer: 0, confirmado: 30 },
    ], "2026-09-16T15:00:00Z");
    expect(f.pontos.map((p) => p.saldo)).toEqual([1200, 1100, 1130]);
    expect(f.pontos[1].entradas_asaas).toBe(0);
    expect(f.menor).toEqual({ valor: 1100, data: "2026-09-17" });
    expect(f.saldo_final.saldo).toBe(1130);
    expect(f.asaas).toMatchObject({ total: 230, a_vencer: 200, confirmado: 30, cobrancas: 3, origem: "espelho", ao_vivo: true });
    expect(f.asaas?.atualizado_em).toBe("2026-09-16T15:00:00Z");
    // O que é do Omie fica como a foto disse.
    expect(f.maior_desembolso).toEqual(foto().maior_desembolso);
  });

  it("sem cobrança nenhuma, a série volta a ser só o Omie e diz que veio vazia", () => {
    const f = comAsaasAoVivo(foto(), [], null);
    expect(f.pontos.map((p) => p.saldo)).toEqual([1000, 900, 900]);
    expect(f.asaas?.origem).toBe("vazio");
    expect(f.asaas?.atualizado_em).toBe("2026-09-16T10:00:00Z");
  });

  it("foto sem a linha de base volta intacta", () => {
    const velha = foto();
    velha.pontos = velha.pontos.map(({ saldo_sem_asaas: _s, ...p }) => p);
    expect(comAsaasAoVivo(velha, [{ data: "2026-09-16", valor: 1, qtd: 1, a_vencer: 1, confirmado: 0 }], null)).toBe(velha);
  });
});
