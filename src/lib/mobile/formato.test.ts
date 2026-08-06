import { describe, it, expect } from "vitest";
import { desatualizado, fmtBRL, fmtData, fmtInt, fmtPct } from "./formato";

/* O Intl separa "R$" do número com espaço fixo; aqui só o formato importa. */
const espacos = (s: string) => s.replace(/\s/g, " ");

describe("moeda e números", () => {
  it("moeda em formato BR, sempre com dois decimais", () => {
    expect(espacos(fmtBRL(1234.56))).toBe("R$ 1.234,56");
    expect(espacos(fmtBRL(0))).toBe("R$ 0,00");
    expect(espacos(fmtBRL(-98.7))).toBe("-R$ 98,70");
  });

  it("nulo vira zero em vez de NaN na tela", () => {
    expect(espacos(fmtBRL(null))).toBe("R$ 0,00");
    expect(fmtInt(undefined)).toBe("0");
  });

  it("inteiro com separador de milhar e percentual com uma casa", () => {
    expect(fmtInt(1234)).toBe("1.234");
    expect(fmtPct(3.456)).toBe("3,5%");
  });
});

describe("datas", () => {
  it("DATE do Postgres vira DD/MM/AAAA sem deslocar por fuso", () => {
    expect(fmtData("2026-08-06")).toBe("06/08/2026");
    expect(fmtData("2026-01-31T23:30:00Z")).toBe("31/01/2026");
  });

  it("vazio e lixo viram travessão", () => {
    expect(fmtData(null)).toBe("—");
    expect(fmtData("")).toBe("—");
  });
});

describe("desatualizado", () => {
  const agora = Date.parse("2026-08-06T12:00:00Z");

  it("dentro da janela não alerta", () => {
    expect(desatualizado("2026-08-05T12:00:00Z", 48, agora)).toBe(false);
  });

  it("fora da janela alerta", () => {
    expect(desatualizado("2026-08-03T11:00:00Z", 48, agora)).toBe(true);
  });

  it("sem data é tratado como velho — silêncio aqui seria pior", () => {
    expect(desatualizado(null, 48, agora)).toBe(true);
    expect(desatualizado("não é data", 48, agora)).toBe(true);
  });
});
