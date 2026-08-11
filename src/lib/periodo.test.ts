import { describe, it, expect } from "vitest";
import { resolverPeriodo, periodoDoMes, somarNoPeriodo } from "./periodo";

/** Jan-26 a Set-26 com dado; out/nov/dez ainda não fecharam. */
const DISPONIVEIS = [
  "Jul-25", "Aug-25", "Sep-25", "Oct-25", "Nov-25", "Dec-25",
  "Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26",
];

describe("resolverPeriodo", () => {
  it("mês é ele mesmo", () => {
    const p = resolverPeriodo("mes", "Jul-26", DISPONIVEIS);
    expect(p.meses).toEqual(["Jul-26"]);
    expect(p.rotulo).toBe("Jul/26");
    expect(p.parcial).toBe(false);
  });

  it("trimestre pega a fatia do CALENDÁRIO, não os três meses anteriores", () => {
    const p = resolverPeriodo("trimestre", "Sep-26", DISPONIVEIS);
    expect(p.meses).toEqual(["Jul-26", "Aug-26", "Sep-26"]);
    expect(p.rotulo).toBe("3T26");
    expect(p.mesFoco).toBe("Sep-26");
  });

  it("trimestre pedido no meio dele para no mês em foco e se declara parcial", () => {
    const p = resolverPeriodo("trimestre", "Aug-26", DISPONIVEIS);
    expect(p.meses).toEqual(["Jul-26", "Aug-26"]);
    expect(p.parcial).toBe(true);
    // O rótulo continua sendo o do trimestre — é onde a reunião está.
    expect(p.rotulo).toBe("3T26");
  });

  it("semestre e ano seguem a mesma regra", () => {
    expect(resolverPeriodo("semestre", "Jun-26", DISPONIVEIS).meses).toEqual([
      "Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26",
    ]);
    expect(resolverPeriodo("semestre", "Jun-26", DISPONIVEIS).rotulo).toBe("1S26");
    const ano = resolverPeriodo("ano", "Sep-26", DISPONIVEIS);
    expect(ano.meses).toHaveLength(9);
    expect(ano.rotulo).toBe("2026 · até Set");
    expect(ano.parcial).toBe(true);
  });

  it("ano fechado perde o 'até'", () => {
    const p = resolverPeriodo("ano", "Dec-25", DISPONIVEIS.concat());
    // Só Jul–Dez/25 existem na lista, então ele continua parcial e diz até onde foi.
    expect(p.rotulo).toBe("2025 · até Dez");
    expect(p.meses).toEqual(["Jul-25", "Aug-25", "Sep-25", "Oct-25", "Nov-25", "Dec-25"]);
  });

  it("últimos 12 é janela MÓVEL e termina no mês em foco", () => {
    const p = resolverPeriodo("ultimos12", "Jul-26", DISPONIVEIS);
    expect(p.meses).toHaveLength(12);
    expect(p.meses[0]).toBe("Aug-25");
    expect(p.meses.at(-1)).toBe("Jul-26");
    expect(p.rotulo).toBe("Últimos 12 meses · Ago/25 a Jul/26");
    expect(p.parcial).toBe(false);
  });

  it("últimos 12 com histórico curto devolve o que existe, e diz que é parcial", () => {
    const p = resolverPeriodo("ultimos12", "Sep-25", DISPONIVEIS);
    expect(p.meses).toEqual(["Jul-25", "Aug-25", "Sep-25"]);
    expect(p.parcial).toBe(true);
    expect(p.rotulo).toContain("Últimos 3 meses");
  });

  it("nunca devolve janela vazia — nem para mês fora da lista", () => {
    const p = resolverPeriodo("trimestre", "Dec-99", DISPONIVEIS);
    expect(p.meses.length).toBeGreaterThan(0);
    const q = resolverPeriodo("trimestre", "Conta", DISPONIVEIS);
    expect(q.meses).toEqual(["Conta"]);
    expect(q.tipo).toBe("mes");
  });

  it("mesFoco é o ÚLTIMO mês com dado da janela, não o pedido", () => {
    // Card mensal desenha o fechamento; se outubro não fechou, é setembro.
    const p = resolverPeriodo("trimestre", "Oct-26", [...DISPONIVEIS]);
    expect(p.mesFoco).toBe("Oct-26");
    const q = resolverPeriodo("trimestre", "Sep-26", DISPONIVEIS);
    expect(q.mesFoco).toBe("Sep-26");
  });
});

describe("periodoDoMes", () => {
  it("é o padrão de uma apresentação nova", () => {
    expect(periodoDoMes("Jul-26")).toEqual({
      tipo: "mes", meses: ["Jul-26"], mesFoco: "Jul-26", rotulo: "Jul/26", parcial: false,
    });
  });
});

describe("somarNoPeriodo", () => {
  const p = resolverPeriodo("trimestre", "Sep-26", DISPONIVEIS);

  it("soma a janela", () => {
    expect(somarNoPeriodo(p, () => 10)).toBe(30);
  });

  it("mês sem valor é BURACO, não zero", () => {
    expect(somarNoPeriodo(p, (m) => (m === "Aug-26" ? null : 10))).toBe(20);
  });

  it("janela inteira sem valor devolve null, e não um zero com cara de resultado", () => {
    expect(somarNoPeriodo(p, () => null)).toBeNull();
  });
});
