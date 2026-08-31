import { describe, it, expect } from "vitest";
import {
  avaliar, calcularBanda, mad, mediana,
  diasUteisAte, dataDoNesimoDiaUtil, iso, MIN_HISTORICO,
} from "../../../supabase/functions/_shared/sinais-banda";

/**
 * As séries são REAIS: saíram de `notas_fiscais_resumo` em 31/08/2026, mês a mês
 * de março a agosto. Estão aqui porque cada uma prova uma decisão do motor — e
 * porque uma banda calibrada em número inventado é uma banda calibrada em nada.
 *
 *   mês  cobranças  emitida_asaas  emitida_omie  falta
 *   mar      2305           2043             0    186
 *   abr      2234           2045             0    106
 *   mai      2241           2048             3     92
 *   jun      2540           2317            24     83
 *   jul      2924           2345            49    332
 *   ago      4408              0           408   3320
 */

/** Emitidas ÷ as que exigem nota. É a série que o vigia realmente observa. */
const COBERTURA = {
  mar: 2043 / (2305 - 73 - 3),
  abr: 2045 / (2234 - 75 - 6),
  mai: (2048 + 3) / (2241 - 91 - 6),
  jun: (2317 + 24) / (2540 - 89 - 9),
  jul: (2345 + 49) / (2924 - 177 - 4),
  ago: 408 / (4408 - 637 - 9),
};
const COBERTURA_HIST = [COBERTURA.mar, COBERTURA.abr, COBERTURA.mai, COBERTURA.jun, COBERTURA.jul];

describe("estatística robusta", () => {
  it("mediana ignora o extremo que a média persegue", () => {
    expect(mediana([83, 92, 106, 186, 332])).toBe(106);
    // a média do mesmo conjunto é 159,8 — 50% acima da mediana, puxada só por julho
  });

  it("mediana de conjunto par é a do meio", () => {
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
  });

  it("mediana não muta a entrada", () => {
    const xs = [3, 1, 2];
    mediana(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("mad de série constante é zero", () => {
    expect(mad([5, 5, 5, 5])).toBe(0);
  });
});

describe("decisão 1 — mediana+MAD pega o que média+desvio deixaria passar", () => {
  /* A série `falta` de mar–jul tem julho (332) como outlier. Com média e
     desvio-padrão o teto sairia em ~473; com mediana e MAD sai em ~208. Um mês
     com 400 faltas é exatamente o caso que a escolha decide. */
  const FALTA_HIST = [186, 106, 92, 83, 332];

  it("400 faltas dispara na banda robusta", () => {
    const v = avaliar(400, FALTA_HIST, { direcao: "acima" });
    expect(v.disparou).toBe(true);
    expect(v.banda.teto).toBeLessThan(250);
  });

  it("o outlier de julho não alarga a banda a ponto de cegá-la", () => {
    const b = calcularBanda(FALTA_HIST);
    expect(b.centro).toBe(106);
    // média+3σ daria ~473; a robusta fica bem abaixo disso
    expect(b.teto).toBeLessThan(473);
  });
});

describe("decisão 2 — piso de dispersão impede que série estável vire histérica", () => {
  /* Cobertura quase imóvel: o MAD sai perto de 0,0015. Sem piso, a banda teria
     largura de 0,004 e uma queda de meio ponto percentual — irrelevante para
     quem lê — dispararia. */
  const ESTAVEL = [0.95, 0.951, 0.949, 0.95, 0.952];

  it("queda de 0,5 p.p. numa série imóvel NÃO dispara", () => {
    const v = avaliar(0.945, ESTAVEL, { direcao: "abaixo" });
    expect(v.disparou).toBe(false);
    expect(v.motivo).toBe("dentro");
  });

  it("a dispersão usada é o piso, não o MAD cru", () => {
    const b = calcularBanda(ESTAVEL);
    expect(mad(ESTAVEL)).toBeLessThan(0.01);
    expect(b.dispersao).toBeCloseTo(0.95 * 0.03, 6);
  });

  it("nunca é zero, nem em série perfeitamente constante", () => {
    expect(calcularBanda([4, 4, 4, 4]).dispersao).toBeGreaterThan(0);
  });
});

describe("decisão 3 — variação pequena não vira sinal", () => {
  it("fora da banda mas com variação abaixo do piso relativo é engolido", () => {
    const v = avaliar(0.9, [1.0, 1.0, 1.0, 1.0, 1.0], { direcao: "abaixo", minRelativo: 0.15 });
    expect(v.disparou).toBe(false);
    expect(v.motivo).toBe("variacao_pequena");
    expect(v.relativo).toBeCloseTo(-0.1, 6);
  });

  it("a mesma queda dispara se o piso relativo for menor", () => {
    const v = avaliar(0.9, [1.0, 1.0, 1.0, 1.0, 1.0], { direcao: "abaixo", minRelativo: 0.05 });
    expect(v.disparou).toBe(true);
  });
});

describe("decisão 4 — sem histórico é 'não sei', não 'está normal'", () => {
  it(`abaixo de ${MIN_HISTORICO} competências não há veredito`, () => {
    const v = avaliar(0.1, [0.95, 0.94, 0.96]);
    expect(v.disparou).toBe(false);
    expect(v.motivo).toBe("sem_historico");
  });

  it("com o mínimo já avalia", () => {
    const v = avaliar(0.1, [0.95, 0.94, 0.96, 0.95], { direcao: "abaixo" });
    expect(v.motivo).toBe("fora");
    expect(v.disparou).toBe(true);
  });
});

describe("agosto/2026 — o mês que o sino existe para ter avisado", () => {
  it("a cobertura despencando de ~95% para ~11% dispara", () => {
    const v = avaliar(COBERTURA.ago, COBERTURA_HIST, { direcao: "abaixo" });
    expect(v.disparou).toBe(true);
    expect(v.relativo).toBeLessThan(-0.8);
    expect(v.z).toBeLessThan(-10);
  });

  it("a cobertura de julho, mais fraca mas plausível, NÃO dispara", () => {
    const hist = [COBERTURA.mar, COBERTURA.abr, COBERTURA.mai, COBERTURA.jun];
    const v = avaliar(COBERTURA.jul, hist, { direcao: "abaixo" });
    expect(v.disparou).toBe(false);
  });
});

describe("a armadilha da mudança de regime", () => {
  /* Este teste guarda uma DECISÃO DE PROJETO, não um comportamento desejado:
     `emitida_asaas` caiu de 2345 para 0 em agosto por causa do `data_corte` da
     virada Asaas→Omie, e não porque algo quebrou. A banda dispara — e está certa
     em disparar, porque o número mudou mesmo. A conclusão é que ESTA SÉRIE NÃO
     PODE SER VIGIADA: quem vigia contagem por regime está vigiando o regime.
     Por isso o vigia observa a cobertura, que é indiferente a qual sistema
     emitiu. Se alguém um dia cadastrar `emitida_asaas` como série, este teste
     explica o alarme que vai chegar. */
  it("contagem por regime dispararia num falso positivo", () => {
    const v = avaliar(0, [2043, 2045, 2048, 2317, 2345], { direcao: "abaixo" });
    expect(v.disparou).toBe(true);
    expect(v.relativo).toBeCloseTo(-1, 6);
  });

  it("a cobertura dos mesmos meses é estável apesar da virada", () => {
    // mar–jun: Asaas emitindo. A troca de motor não aparece na cobertura.
    const b = calcularBanda([COBERTURA.mar, COBERTURA.abr, COBERTURA.mai, COBERTURA.jun]);
    expect(b.centro).toBeGreaterThan(0.9);
    expect(b.dispersao).toBeLessThan(0.05);
  });
});

describe("direção", () => {
  it("cobertura que SOBE não é notícia", () => {
    const v = avaliar(0.99, [0.5, 0.52, 0.48, 0.51, 0.5], { direcao: "abaixo" });
    expect(v.disparou).toBe(false);
    expect(v.motivo).toBe("direcao_ignorada");
  });

  it("a mesma subida dispara quando a série é vigiada nos dois lados", () => {
    const v = avaliar(0.99, [0.5, 0.52, 0.48, 0.51, 0.5], { direcao: "ambos" });
    expect(v.disparou).toBe(true);
  });
});

describe("folga — o que o botão 'isso é normal' faz", () => {
  const HIST = [100, 102, 98, 101, 99];

  it("o que disparava com folga 1 cala com folga 3", () => {
    expect(avaliar(85, HIST, { direcao: "abaixo" }).disparou).toBe(true);
    expect(avaliar(85, HIST, { direcao: "abaixo", folga: 3 }).disparou).toBe(false);
  });

  it("folga alarga, mas não cega: a queda maior ainda passa", () => {
    expect(avaliar(20, HIST, { direcao: "abaixo", folga: 3 }).disparou).toBe(true);
  });
});

describe("guardas numéricas", () => {
  it("centro zero não produz relativo infinito", () => {
    const v = avaliar(5, [0, 0, 0, 0, 0]);
    expect(Number.isFinite(v.relativo)).toBe(true);
    expect(v.relativo).toBe(0);
  });

  it("centro zero: sem variação relativa, não dispara", () => {
    expect(avaliar(5, [0, 0, 0, 0, 0]).disparou).toBe(false);
  });
});

describe("dia útil — a régua que faz mês parcial comparar com mês parcial", () => {
  // 01/08/2026 é sábado; 31/08/2026 é segunda. Agosto tem 21 dias úteis.
  it("conta os dias úteis corridos do mês", () => {
    expect(diasUteisAte(new Date(Date.UTC(2026, 7, 31)))).toBe(21);
    expect(diasUteisAte(new Date(Date.UTC(2026, 7, 3)))).toBe(1);  // 1º e 2 são fim de semana
    expect(diasUteisAte(new Date(Date.UTC(2026, 7, 2)))).toBe(0);
  });

  it("acha a data do n-ésimo dia útil", () => {
    expect(iso(dataDoNesimoDiaUtil(2026, 7, 1))).toBe("2026-08-03");
    expect(iso(dataDoNesimoDiaUtil(2026, 7, 21))).toBe("2026-08-31");
  });

  it("recorta o mês anterior no mesmo ponto do atual", () => {
    // o 21º dia útil de julho/2026 é 29/07 — é até aí que julho deve ser somado
    // para comparar com agosto no 21º dia útil.
    expect(iso(dataDoNesimoDiaUtil(2026, 6, 21))).toBe("2026-07-29");
  });

  it("mês curto demais devolve o último dia, sem estourar", () => {
    expect(iso(dataDoNesimoDiaUtil(2026, 1, 99))).toBe("2026-02-28");
  });
});
