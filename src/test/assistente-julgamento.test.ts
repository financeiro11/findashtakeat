import { describe, it, expect } from "vitest";
import {
  compararComPlano, indexarBP, julgarSerie, planejado,
} from "../../supabase/functions/_shared/assistente/julgamento";

describe("julgarSerie", () => {
  it("não julga com série curta demais", () => {
    // Com 3 pontos o desvio-padrão é ruído. Chamar isso de "fora do padrão" seria
    // chute com aparência de estatística.
    const v = julgarSerie([100, 110, 90], 500);
    expect(v.padrao).toBe("sem histórico");
    expect(v.z).toBeNull();
  });

  it("reconhece valor dentro da variação normal", () => {
    const v = julgarSerie([100, 110, 90, 105, 95, 100], 103);
    expect(v.padrao).toBe("dentro do padrão");
    expect(v.media).toBeCloseTo(100, 1);
  });

  it("acusa valor acima de dois desvios", () => {
    const v = julgarSerie([100, 102, 98, 101, 99, 100], 130);
    expect(v.padrao).toBe("recorde"); // maior que todos os anteriores
    expect(v.z!).toBeGreaterThan(2);
  });

  it("distingue recorde de apenas alto", () => {
    // 118 é alto mas não supera o 120 já visto — não é recorde.
    const v = julgarSerie([100, 120, 98, 101, 99, 100], 118);
    expect(v.padrao).not.toBe("recorde");
  });

  it("acusa valor anormalmente baixo", () => {
    const v = julgarSerie([100, 102, 98, 101, 99, 100], 60);
    // Menor que todos em módulo? Não — |60| < |100|, então cai em "recorde" só se for
    // maior em módulo. Aqui tem que ser "abaixo do padrão".
    expect(v.padrao).toBe("abaixo do padrão");
    expect(v.z!).toBeLessThan(-2);
  });

  it("lida com série constante sem dividir por zero", () => {
    const v = julgarSerie([50, 50, 50, 50], 50);
    expect(v.padrao).toBe("dentro do padrão");
    expect(v.z).toBeNull();
    expect(Number.isFinite(v.desvio!)).toBe(true);
  });
});

describe("indexarBP + planejado", () => {
  // Formato real do bp_anual.dados: planilha serializada, com a linha "Mês Calendário"
  // dizendo qual coluna é qual mês.
  const BP = [{
    ano: 2026,
    dados: [
      { Conta: "Mês Calendário", jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 },
      { Conta: "4.3.Equipe Comercial", jan: 100, fev: 110, mar: 120, abr: 0, mai: 0, jun: 0, jul: 200, ago: 0, set: 0, out: 0, nov: 0, dez: 0 },
      { Conta: "EBITDA", jan: 50, fev: 60, mar: 70, abr: 0, mai: 0, jun: 0, jul: 80, ago: 0, set: 0, out: 0, nov: 0, dez: 0 },
      { Conta: "Ano", jan: 2026, fev: 2026, mar: 2026, abr: 2026, mai: 2026, jun: 2026, jul: 2026, ago: 2026, set: 2026, out: 2026, nov: 2026, dez: 2026 },
    ],
  }];

  it("mapeia a rubrica do DRE para o rótulo numerado do BP", () => {
    const idx = indexarBP(BP);
    expect(planejado(idx, "Equipe Comercial", { ano: 2026, mes: 7 })).toBe(200);
  });

  it("encontra rubrica cujo nome é igual nos dois lados", () => {
    const idx = indexarBP(BP);
    expect(planejado(idx, "EBITDA", { ano: 2026, mes: 3 })).toBe(70);
  });

  it("devolve null para rubrica fora do plano, em vez de zero", () => {
    // Zero significaria "planejado nada"; null significa "não está no plano". Confundir
    // os dois faria o assistente acusar desvio de 100% em rubrica não orçada.
    const idx = indexarBP(BP);
    expect(planejado(idx, "Eventos e Feiras", { ano: 2026, mes: 7 })).toBeNull();
  });

  it("ignora linhas estruturais da planilha", () => {
    const idx = indexarBP(BP);
    expect(planejado(idx, "Ano", { ano: 2026, mes: 1 })).toBeNull();
    expect(planejado(idx, "Mês Calendário", { ano: 2026, mes: 1 })).toBeNull();
  });
});

describe("compararComPlano", () => {
  const idx = indexarBP([{
    ano: 2026,
    dados: [
      { Conta: "Mês Calendário", jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 },
      { Conta: "4.3.Equipe Comercial", jan: 0, fev: 0, mar: 0, abr: 0, mai: 0, jun: 0, jul: 200, ago: 0, set: 0, out: 0, nov: 0, dez: 0 },
    ],
  }]);

  it("calcula desvio absoluto e percentual", () => {
    const r = compararComPlano(idx, "Equipe Comercial", { ano: 2026, mes: 7 }, 250)!;
    expect(r.planejado).toBe(200);
    expect(r.desvio).toBe(50);
    expect(r.desvioPct).toBeCloseTo(25, 2);
  });

  it("marca gasto abaixo do plano com desvio negativo", () => {
    const r = compararComPlano(idx, "Equipe Comercial", { ano: 2026, mes: 7 }, 150)!;
    expect(r.desvio).toBe(-50);
    expect(r.desvioPct).toBeCloseTo(-25, 2);
  });

  it("não compara o que não está no plano", () => {
    expect(compararComPlano(idx, "Eventos e Feiras", { ano: 2026, mes: 7 }, 999)).toBeNull();
  });
});
