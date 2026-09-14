import { describe, it, expect } from "vitest";
import { dentroDoIntervalo, intervaloDoPeriodo } from "./periodoExtrato";

const HOJE = "2026-09-14";

describe("intervaloDoPeriodo", () => {
  it("atalhos abrem só o começo", () => {
    expect(intervaloDoPeriodo("tudo", HOJE)).toEqual({ de: "", ate: "" });
    expect(intervaloDoPeriodo("hoje", HOJE)).toEqual({ de: HOJE, ate: "" });
    expect(intervaloDoPeriodo("7d", HOJE)).toEqual({ de: "2026-09-07", ate: "" });
    expect(intervaloDoPeriodo("30d", HOJE)).toEqual({ de: "2026-08-15", ate: "" });
    expect(intervaloDoPeriodo("mes", HOJE)).toEqual({ de: "2026-09-01", ate: "" });
  });

  it("personalizado usa as datas escolhidas, e desinverte", () => {
    expect(intervaloDoPeriodo("personalizado", HOJE, { de: "2026-08-01", ate: "2026-08-31" }))
      .toEqual({ de: "2026-08-01", ate: "2026-08-31" });
    expect(intervaloDoPeriodo("personalizado", HOJE, { de: "2026-08-31", ate: "2026-08-01" }))
      .toEqual({ de: "2026-08-01", ate: "2026-08-31" });
    expect(intervaloDoPeriodo("personalizado", HOJE, { de: "2026-08-10" }))
      .toEqual({ de: "2026-08-10", ate: "" });
  });
});

describe("dentroDoIntervalo", () => {
  const ago = { de: "2026-08-01", ate: "2026-08-31" };
  it("inclui as duas pontas", () => {
    expect(dentroDoIntervalo("2026-08-01", ago)).toBe(true);
    expect(dentroDoIntervalo("2026-08-31", ago)).toBe(true);
    expect(dentroDoIntervalo("2026-07-31", ago)).toBe(false);
    expect(dentroDoIntervalo("2026-09-01", ago)).toBe(false);
  });
  it("lado vazio é aberto", () => {
    expect(dentroDoIntervalo("1999-01-01", { de: "", ate: "2026-08-31" })).toBe(true);
    expect(dentroDoIntervalo("2099-01-01", { de: "2026-08-01", ate: "" })).toBe(true);
  });
});
