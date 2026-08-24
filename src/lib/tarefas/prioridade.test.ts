import { describe, it, expect } from "vitest";
import { comparaPrioridade, ordenarPorPrioridade, PRIO_OPTS } from "./prioridade";

const t = (prioridade: string, prazo?: string | null, id = "") => ({ prioridade, prazo, id });

describe("comparaPrioridade", () => {
  it("põe a mais urgente na frente", () => {
    expect(comparaPrioridade(t("Urgente"), t("Baixa"))).toBeLessThan(0);
    expect(comparaPrioridade(t("Baixa"), t("Urgente"))).toBeGreaterThan(0);
    expect(comparaPrioridade(t("Alta"), t("Média"))).toBeLessThan(0);
  });

  it("mesma prioridade: o prazo mais próximo vem antes", () => {
    expect(comparaPrioridade(t("Média", "2026-08-21"), t("Média", "2026-08-28"))).toBeLessThan(0);
  });

  it("sem prazo vai para o fim do próprio degrau", () => {
    expect(comparaPrioridade(t("Média", null), t("Média", "2026-08-28"))).toBeGreaterThan(0);
    expect(comparaPrioridade(t("Média", "2026-08-28"), t("Média", null))).toBeLessThan(0);
  });

  it("sem prazo dos dois lados é empate", () => {
    expect(comparaPrioridade(t("Média", null), t("Média", undefined))).toBe(0);
  });

  it("prioridade fora da escala cai para o fim, não para o meio", () => {
    // Um valor digitado errado tem que aparecer no rodapé, onde se percebe.
    expect(comparaPrioridade(t("Urgentíssima"), t("Baixa"))).toBeGreaterThan(0);
  });
});

describe("ordenarPorPrioridade", () => {
  it("ordena a coluna do print (BACKLOG) como se espera", () => {
    const backlog = [
      t("Baixa", "2026-08-21", "acerto-nfs"),
      t("Média", "2026-08-21", "layout-cac"),
      t("Média", "2026-08-28", "revisao-nfs"),
      t("Média", "2026-08-24", "contrato-solvit"),
      t("Alta", "2026-08-25", "orcamento-rh"),
    ];
    expect(ordenarPorPrioridade(backlog).map(x => x.id)).toEqual([
      "orcamento-rh",     // Alta
      "layout-cac",       // Média 21/08
      "contrato-solvit",  // Média 24/08
      "revisao-nfs",      // Média 28/08
      "acerto-nfs",       // Baixa
    ]);
  });

  it("empate real preserva a ordem anterior (sort estável)", () => {
    const iguais = [
      t("Alta", "2026-08-25", "primeiro"),
      t("Alta", "2026-08-25", "segundo"),
      t("Alta", "2026-08-25", "terceiro"),
    ];
    expect(ordenarPorPrioridade(iguais).map(x => x.id))
      .toEqual(["primeiro", "segundo", "terceiro"]);
  });

  it("não mexe no array recebido", () => {
    const original = [t("Baixa", "2026-08-21", "a"), t("Urgente", "2026-08-30", "b")];
    const copia = [...original];
    ordenarPorPrioridade(original);
    expect(original).toEqual(copia);
  });
});

describe("PRIO_OPTS", () => {
  it("é a escala que o seletor mostra, do menor para o maior", () => {
    // Se mudar aqui, o select do TaskDialog muda junto — ele reexporta esta lista.
    expect(PRIO_OPTS).toEqual(["Baixa", "Média", "Alta", "Urgente"]);
  });
});
