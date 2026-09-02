import { describe, it, expect } from "vitest";
import {
  analisarSerie, atipicaNaSerie, desvioMediano, mediana, type PontoSerie,
} from "./serieRubrica";

/* ---------------------------------------------------------------------------
 * A régua que olha a HISTÓRIA da rubrica, e não só o mês anterior.
 *
 * O primeiro bloco é o caso que motivou o arquivo: "(+) Receita financeira" na
 * DFC, com valor em todo mês de 2026 e zerada em agosto. São os números reais
 * da tela.
 * ------------------------------------------------------------------------- */

const serie = (vs: (number | null)[], inicio = 3): PontoSerie[] =>
  vs.map((valor, i) => ({ mes: `M${inicio + i}-26`, valor }));

describe("mediana e MAD", () => {
  it("mediana de lista par é a média dos dois do meio", () => {
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(mediana([3, 1, 4, 2])).toBe(2.5);   // ordena antes
    expect(mediana([])).toBe(0);
  });

  it("um único mês fora da curva não desloca a mediana — é o ponto do método", () => {
    // Folha estável com um mês de 13º. A média iria de 100 para ~117.
    const xs = [100, 100, 102, 98, 200];
    expect(mediana(xs)).toBe(100);
    expect(desvioMediano(xs)).toBe(2);
  });
});

describe("ausência de rubrica recorrente", () => {
  /* Mar–Jul/26 de "(+) Receita financeira" na DFC, como estão na grade. */
  const RECEITA_FINANCEIRA = [8_440, 12_142, 35_215, 18_067, 17_014];

  it("acusa a receita financeira zerada em agosto", () => {
    const a = analisarSerie({
      historico: serie(RECEITA_FINANCEIRA),
      atual: 0,
      despesa: false,
    });
    expect(a.ausente).toBe(true);
    expect(a.zerada).toBe(true);
    expect(a.recorrente).toBe(true);
    expect(a.mediana).toBe(17_014);
    expect(a.ultimoMes).toBe("M7-26");
    expect(a.ultimoValor).toBe(17_014);
  });

  it("acusa também a célula vazia, não só a que traz zero", () => {
    const a = analisarSerie({ historico: serie(RECEITA_FINANCEIRA), atual: null, despesa: false });
    expect(a.ausente).toBe(true);
    // ...mas registra qual dos dois casos é: "veio zero" e "não veio linha" se
    // conferem em lugares diferentes do Omie.
    expect(a.zerada).toBe(false);
  });

  it("rubrica esporádica não vira ausência", () => {
    // Aparece em 2 de 6 meses: faltar é o comportamento normal dela.
    const a = analisarSerie({
      historico: serie([null, 40_000, null, null, 35_000, null]),
      atual: 0,
      despesa: false,
    });
    expect(a.recorrente).toBe(false);
    expect(a.ausente).toBe(false);
  });

  it("rubrica de trocado não vira ausência", () => {
    // Recorrente, mas de R$ 300: faltar não é notícia de fechamento.
    const a = analisarSerie({
      historico: serie([300, 280, 310, 295, 305]),
      atual: 0,
      despesa: false,
    });
    expect(a.recorrente).toBe(true);
    expect(a.ausente).toBe(false);
  });

  it("despesa é lida em módulo, como no comentário", () => {
    const a = analisarSerie({
      historico: serie([-140_000, -138_000, -142_000, -139_000, -141_000]),
      atual: 0,
      despesa: true,
    });
    expect(a.ausente).toBe(true);
    expect(a.mediana).toBe(140_000);
    expect(a.ultimoValor).toBe(141_000);
  });

  it("mês com valor nunca é ausência, por mais que tenha caído", () => {
    const a = analisarSerie({ historico: serie(RECEITA_FINANCEIRA), atual: 900, despesa: false });
    expect(a.ausente).toBe(false);
  });
});

describe("atípico contra a própria série", () => {
  it("pega a queda grande em R$ que é pequena em % — o furo do piso de 10%", () => {
    // Rubrica estável de ~550k oscilando 5k. Cair 30k é 5,5%: passa longe do
    // limiar percentual, e é seis vezes a oscilação normal da linha.
    const a = analisarSerie({
      historico: serie([550_000, 552_000, 548_000, 551_000, 549_000, 550_500]),
      atual: 520_000,
      despesa: false,
    });
    expect(atipicaNaSerie(a)).toBe(true);
    expect(a.z! < 0).toBe(true);
    expect(a.extremo).toBe("menor");
  });

  it("não acusa a oscilação normal da própria rubrica", () => {
    const a = analisarSerie({
      historico: serie([100_000, 130_000, 90_000, 140_000, 85_000, 120_000]),
      atual: 145_000,
      despesa: false,
    });
    expect(atipicaNaSerie(a)).toBe(false);
  });

  it("série constante não produz z — MAD zero divide por nada", () => {
    // Sem esta guarda, R$ 1 de diferença numa linha travada em 10.000 sairia
    // como "infinitamente atípico".
    const a = analisarSerie({
      historico: serie([10_000, 10_000, 10_000, 10_000, 10_000]),
      atual: 10_001,
      despesa: false,
    });
    expect(a.mad).toBe(0);
    expect(a.z).toBeNull();
    expect(atipicaNaSerie(a)).toBe(false);
  });

  it("história curta não fala: sem amostra não há régua", () => {
    const a = analisarSerie({ historico: serie([100_000, 110_000]), atual: 400_000, despesa: false });
    expect(a.z).toBeNull();
    expect(a.extremo).toBeNull();
    expect(atipicaNaSerie(a)).toBe(false);
  });

  it("extremo olha a janela inteira, e o mês em foco fica FORA da amostra", () => {
    const a = analisarSerie({
      historico: serie([100_000, 130_000, 90_000, 140_000]),
      atual: 190_000,
      despesa: false,
    });
    expect(a.extremo).toBe("maior");
    // Se o mês entrasse na própria amostra, ele puxaria a mediana e se
    // explicaria sozinho.
    expect(a.mediana).toBe(115_000);
  });

  it("a janela corta o histórico antigo pelo fim mais recente", () => {
    const a = analisarSerie({
      historico: serie([999_999, 1, 1, 100, 100, 100]),
      atual: 100,
      despesa: false,
      janela: 3,
    });
    expect(a.janela).toBe(3);
    expect(a.mediana).toBe(100);
  });
});
