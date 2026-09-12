import { describe, expect, it } from "vitest";
import { lerPrazo, prazoAtrasado } from "./prazo";

// Uma sexta-feira, a mesma do card que sumiu.
const HOJE = new Date(2026, 8, 11);

describe("lerPrazo", () => {
  it("hoje é 'hoje', não uma data qualquer", () => {
    const p = lerPrazo("2026-09-11", { hoje: HOJE });
    expect(p.tom).toBe("hoje");
    expect(p.dias).toBe(0);
    expect(p.distancia).toBe("hoje");
    expect(p.curta).toBe("11/09");
  });

  it("separa futuro de passado pelo tom e pela distância", () => {
    expect(lerPrazo("2026-09-18", { hoje: HOJE }).tom).toBe("futuro");
    expect(lerPrazo("2026-09-18", { hoje: HOJE }).distancia).toBe("em 7 d");
    expect(lerPrazo("2026-09-12", { hoje: HOJE }).tom).toBe("amanha");
    expect(lerPrazo("2026-09-08", { hoje: HOJE }).tom).toBe("atrasado");
    expect(lerPrazo("2026-09-08", { hoje: HOJE }).distancia).toBe("há 3 d");
    expect(lerPrazo("2026-09-10", { hoje: HOJE }).distancia).toBe("ontem");
  });

  /* A data vem como `date` do Postgres. `new Date("2026-09-11")` seria meia-noite
     UTC — 21h do dia 10 em Brasília — e o card de hoje nasceria "atrasado". */
  it("não desloca o dia pelo fuso", () => {
    expect(lerPrazo("2026-09-11", { hoje: new Date(2026, 8, 11, 23, 59) }).tom).toBe("hoje");
    expect(lerPrazo("2026-09-11", { hoje: new Date(2026, 8, 11, 0, 1) }).tom).toBe("hoje");
  });

  it("concluída não fica vermelha, mas denuncia o fechamento adiantado", () => {
    const cedo = lerPrazo("2026-09-18", { hoje: HOJE, concluida: true });
    expect(cedo.tom).toBe("concluida");
    expect(cedo.dias).toBe(7);
    expect(cedo.titulo).toContain("antes do prazo");

    const noDia = lerPrazo("2026-09-11", { hoje: HOJE, concluida: true });
    expect(noDia.titulo).not.toContain("antes do prazo");
  });

  it("mostra o ano só quando não é o corrente", () => {
    expect(lerPrazo("2026-10-31", { hoje: HOJE }).curta).toBe("31/10");
    expect(lerPrazo("2027-01-05", { hoje: HOJE }).curta).toBe("05/01/27");
  });

  it("sem prazo não inventa distância", () => {
    const p = lerPrazo(null, { hoje: HOJE });
    expect(p.tom).toBe("sem");
    expect(p.dias).toBeNull();
    expect(p.data).toBe("—");
    expect(p.distancia).toBe("");
  });
});

describe("prazoAtrasado", () => {
  it("concluída nunca está atrasada", () => {
    expect(prazoAtrasado("2026-09-08", false, HOJE)).toBe(true);
    expect(prazoAtrasado("2026-09-08", true, HOJE)).toBe(false);
    expect(prazoAtrasado("2026-09-11", false, HOJE)).toBe(false);
    expect(prazoAtrasado(null, false, HOJE)).toBe(false);
  });
});
