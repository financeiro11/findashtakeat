import { describe, it, expect } from "vitest";
import { ordemDaVarredura } from "../../supabase/functions/_shared/varredura.ts";

/* Duas consultas seguidas que não retornam nada o Omie recusa como redundantes —
   mesmo com `nCodCC` diferente e mesmo com tamanho de página diferente. Medido
   três vezes em 10/09/2026, sempre na SEGUNDA conta vazia consecutiva. Daí a
   regra: no máximo uma conta possivelmente vazia por varredura. */

const CONTAS = ["sicoob", "adiantamento", "btg", "banestes_morta", "omiecash_morta"];
const ATIVAS = new Set(["sicoob", "adiantamento", "btg"]);
const DIA = 86_400_000;

describe("ordemDaVarredura", () => {
  it("as ativas vão primeiro, e entra UMA dormente só", () => {
    const ordem = ordemDaVarredura(CONTAS, ATIVAS, 10 * DIA);
    expect(ordem.slice(0, 3)).toEqual(["sicoob", "adiantamento", "btg"]);
    expect(ordem).toHaveLength(4);
  });

  it("a dormente rodizia por dia — nenhuma fica sem ser olhada", () => {
    const vistas = new Set<string>();
    for (let d = 0; d < 6; d++) vistas.add(ordemDaVarredura(CONTAS, ATIVAS, d * DIA)[3]);
    expect([...vistas].sort()).toEqual(["banestes_morta", "omiecash_morta"]);
  });

  it("no mesmo dia a ordem é a mesma — varredura é reprodutível", () => {
    expect(ordemDaVarredura(CONTAS, ATIVAS, 7 * DIA))
      .toEqual(ordemDaVarredura(CONTAS, ATIVAS, 7 * DIA + 3600_000));
  });

  it("primeira varredura, sem mapa nenhum: vai tudo", () => {
    // No pior caso ela falha uma vez, cai no fallback da varredura única, e a
    // rodada seguinte já tem o mapa. Devolver lista vazia seria pior: DRE sem nada.
    expect(ordemDaVarredura(CONTAS, new Set(), 0)).toEqual(CONTAS);
  });

  it("sem dormentes, ninguém é deixado de fora", () => {
    const todas = new Set(CONTAS);
    expect(ordemDaVarredura(CONTAS, todas, 0)).toEqual(CONTAS);
  });

  it("nunca devolve a mesma conta duas vezes", () => {
    const ordem = ordemDaVarredura(CONTAS, ATIVAS, 3 * DIA);
    expect(new Set(ordem).size).toBe(ordem.length);
  });
});
