import { describe, expect, it } from "vitest";
import { fotoAtrasada, lidoDoAsaas, tituloLidoDoAsaas } from "./asaasFrescor";

describe("lidoDoAsaas", () => {
  it("vale o mais recente entre o aviso e a varredura", () => {
    const l = lidoDoAsaas([
      { escopo: "payment:janela", ultima_incremental: "2026-09-16T20:07:00Z" },
      { escopo: "webhook", ultima_incremental: "2026-09-16T20:40:00Z" },
    ]);
    expect(l).toEqual({
      em: "2026-09-16T20:40:00Z", aviso: "2026-09-16T20:40:00Z", varredura: "2026-09-16T20:07:00Z",
    });
  });

  it("a varredura mais nova que o último aviso também vale (aviso parado é sinal, não certeza)", () => {
    const l = lidoDoAsaas([
      { escopo: "webhook", ultima_incremental: "2026-09-16T08:00:00Z" },
      { escopo: "payment:2026-09", ultima_incremental: "2026-09-16T15:30:00Z" },
    ]);
    expect(l?.em).toBe("2026-09-16T15:30:00Z");
  });

  it("sem nenhuma marca legível, não inventa horário", () => {
    expect(lidoDoAsaas([])).toBeNull();
    expect(lidoDoAsaas([{ escopo: "webhook", ultima_incremental: null }])).toBeNull();
    expect(lidoDoAsaas([{ escopo: "webhook", ultima_incremental: "ontem" }])).toBeNull();
  });

  it("o título diz as duas fontes", () => {
    const t = tituloLidoDoAsaas({ em: "2026-09-16T20:40:00Z", aviso: "2026-09-16T20:40:00Z", varredura: null });
    expect(t).toMatch(/Último aviso do Asaas/);
    expect(t).not.toMatch(/Última varredura/);
  });
});

describe("fotoAtrasada", () => {
  const lido = { em: "2026-09-16T20:40:00Z", aviso: "2026-09-16T20:40:00Z", varredura: null };
  it("recalcula só quando algo chegou depois da foto", () => {
    expect(fotoAtrasada("2026-09-16T20:00:00Z", lido)).toBe(true);
    expect(fotoAtrasada("2026-09-16T20:41:00Z", lido)).toBe(false);
  });
  it("sem marca do Asaas, não há o que recalcular", () => {
    expect(fotoAtrasada("2026-09-16T20:00:00Z", null)).toBe(false);
  });
});
