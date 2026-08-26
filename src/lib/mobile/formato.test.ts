import { describe, it, expect } from "vitest";
import { desatualizado, emDias, fmtBRL, fmtBRLCurto, fmtData, fmtInt, fmtPct } from "./formato";

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

  it("valor curto abrevia só quando abreviar economiza espaço", () => {
    expect(espacos(fmtBRLCurto(105807.17))).toBe("R$ 105,8 mil");
    expect(espacos(fmtBRLCurto(1_240_000))).toBe("R$ 1,2 mi");
    expect(espacos(fmtBRLCurto(-23622.1))).toBe("-R$ 23,6 mil");
    // Abaixo de mil não há o que abreviar, e o centavo ainda importa.
    expect(espacos(fmtBRLCurto(900))).toBe("R$ 900,00");
    expect(espacos(fmtBRLCurto(4.5))).toBe("R$ 4,50");
    expect(espacos(fmtBRLCurto(null))).toBe("R$ 0,00");
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

// É o que os atalhos "Hoje / Amanhã / +1 semana" gravam em `tarefas.prazo`.
describe("emDias", () => {
  it("zero é o próprio dia", () => {
    expect(emDias(0, "2026-08-06")).toBe("2026-08-06");
  });

  it("vira o mês e o ano sem ajuda", () => {
    expect(emDias(1, "2026-08-31")).toBe("2026-09-01");
    expect(emDias(7, "2026-12-28")).toBe("2027-01-04");
  });

  it("atravessa a virada do horário de verão sem perder o dia", () => {
    // A conta é em UTC justamente para não depender de o aparelho estar em Brasília.
    expect(emDias(7, "2026-10-15")).toBe("2026-10-22");
    expect(emDias(1, "2026-02-28")).toBe("2026-03-01"); // 2026 não é bissexto
  });

  it("aceita voltar no tempo", () => {
    expect(emDias(-1, "2026-01-01")).toBe("2025-12-31");
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
