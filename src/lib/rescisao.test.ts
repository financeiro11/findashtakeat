/**
 * A conta do acerto de saída.
 *
 * O que este teste prende é dinheiro que sai uma vez e não volta: a multa de um
 * mês inteiro que depende de um campo em branco, os meses de férias que a regra
 * do "mês cheio" concede ou não, e o proporcional em dias reais do mês — 31 dias
 * em julho, 28 em fevereiro. Errar o denominador é errar todo mês de saída.
 */

import { describe, expect, it } from "vitest";
import {
  FLASH_MENSAL,
  calcularRescisao,
  classificacaoDoRH,
  mesesParaFerias,
  parseISO,
  rescisaoEmTexto,
  type EntradasDaRescisao,
  type FichaDoDesligado,
} from "./rescisao";

const ficha = (over: Partial<FichaDoDesligado> = {}): FichaDoDesligado => ({
  inicio: "2026-01-06",
  datadesl: "2026-07-18",
  valor: 6000,
  tipodesl: "Involuntário",
  flash: 500,
  valor_liberalidade: 0,
  ...over,
});

/** O caso completo: nada pendente, para poder olhar os números. */
const completo: EntradasDaRescisao = {
  diasDeFeriasTirados: 0,
  variavel: 0,
  classificacao: null,
};

const perto = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe("classificação do desligamento", () => {
  it("lê o campo do RH com e sem acento", () => {
    expect(classificacaoDoRH("Involuntário")).toBe("involuntario");
    expect(classificacaoDoRH("involuntario")).toBe("involuntario");
    expect(classificacaoDoRH("Voluntário")).toBe("voluntario");
  });

  it("não adivinha o ambíguo — vazio e 'saída acordada' ficam sem classificação", () => {
    expect(classificacaoDoRH("")).toBeNull();
    expect(classificacaoDoRH(null)).toBeNull();
    expect(classificacaoDoRH("Saída acordada")).toBeNull();
    expect(classificacaoDoRH("Não está mais na empresa")).toBeNull();
  });
});

describe("meses de férias — regra do mês cheio", () => {
  const meses = (i: string, d: string) => mesesParaFerias(parseISO(i)!, parseISO(d)!);

  it("conta o mês de admissão quando entrou até o dia 15", () => {
    expect(meses("2026-01-15", "2026-03-10")).toBe(2); // jan + fev
    expect(meses("2026-01-16", "2026-03-10")).toBe(1); // só fev
  });

  it("conta o mês de saída quando saiu no dia 16 ou depois", () => {
    expect(meses("2026-01-06", "2026-03-16")).toBe(3); // jan + fev + mar
    expect(meses("2026-01-06", "2026-03-15")).toBe(2); // jan + fev
  });

  it("os meses do meio contam sempre", () => {
    expect(meses("2026-01-20", "2026-04-10")).toBe(2); // fev + mar
  });

  it("quem entrou e saiu no mesmo mês só ganha o mês se passou de 15 dias", () => {
    expect(meses("2026-03-01", "2026-03-16")).toBe(1); // 16 dias
    expect(meses("2026-03-01", "2026-03-15")).toBe(0); // 15 dias
  });
});

describe("proporcional do mês da saída", () => {
  it("usa os dias reais do mês, não 30 fixo", () => {
    // Julho tem 31 dias: 6000 × 18/31, e não 6000 ÷ 30 × 18.
    const jul = calcularRescisao(ficha({ datadesl: "2026-07-18" }), completo)!;
    perto(jul.proporcional, 6000 * (18 / 31));
    expect(jul.diasDoMes).toBe(31);

    // Fevereiro de 2026 tem 28.
    const fev = calcularRescisao(ficha({ datadesl: "2026-02-18" }), completo)!;
    perto(fev.proporcional, 6000 * (18 / 28));
  });

  it("quem entrou e saiu no mesmo mês só recebe o pedaço entre as datas", () => {
    const r = calcularRescisao(ficha({ inicio: "2026-07-10", datadesl: "2026-07-18" }), completo)!;
    expect(r.diasTrabalhadosNoMes).toBe(9);
    perto(r.proporcional, 6000 * (9 / 31));
  });
});

describe("multa de rescisão", () => {
  it("involuntário paga uma remuneração, sem carência de tempo de casa", () => {
    const novato = calcularRescisao(
      ficha({ inicio: "2026-07-01", datadesl: "2026-07-20" }),
      completo,
    )!;
    expect(novato.multa).toBe(6000);
    expect(novato.linhas.some((l) => l.chave === "multa")).toBe(true);
  });

  it("voluntário não paga multa e a linha some", () => {
    const r = calcularRescisao(ficha({ tipodesl: "Voluntário" }), completo)!;
    expect(r.multa).toBe(0);
    expect(r.linhas.some((l) => l.chave === "multa")).toBe(false);
  });

  it("campo em branco vira pendência em vez de multa zerada por omissão", () => {
    const r = calcularRescisao(ficha({ tipodesl: "" }), completo)!;
    expect(r.classificacao).toBeNull();
    expect(r.pendencias.join(" ")).toMatch(/oluntário/);
  });

  it("a escolha do usuário resolve a pendência", () => {
    const r = calcularRescisao(ficha({ tipodesl: "" }), { ...completo, classificacao: "involuntario" })!;
    expect(r.multa).toBe(6000);
    expect(r.origemDaClassificacao).toBe("usuario");
    expect(r.pendencias).toHaveLength(0);
  });

  it("avisa quando o usuário contraria o campo do RH", () => {
    const r = calcularRescisao(ficha({ tipodesl: "Voluntário" }), {
      ...completo,
      classificacao: "involuntario",
    })!;
    expect(r.avisos.join(" ")).toMatch(/ficha do RH/);
  });
});

describe("férias já tiradas", () => {
  it("desconta em base de 30 dias", () => {
    const r = calcularRescisao(ficha(), { ...completo, diasDeFeriasTirados: 10 })!;
    perto(r.descontoDeFerias, (6000 / 30) * 10);
    expect(r.linhas.find((l) => l.chave === "ferias-tiradas")?.desconto).toBe(true);
  });

  it("omite a linha quando ninguém tirou férias", () => {
    const r = calcularRescisao(ficha(), completo)!;
    expect(r.linhas.some((l) => l.chave === "ferias-tiradas")).toBe(false);
  });

  it("com mais de 6 meses de casa, não informar vira pendência — nunca zero chutado", () => {
    const r = calcularRescisao(ficha({ inicio: "2025-10-06" }), { variavel: 0 })!; // 9 meses de casa
    expect(r.mesesDeCasa).toBeGreaterThan(6);
    expect(r.pendencias.join(" ")).toMatch(/férias/);
  });

  it("com até 6 meses de casa, assume zero e avisa", () => {
    const r = calcularRescisao(ficha({ inicio: "2026-05-06" }), { variavel: 0 })!;
    expect(r.pendencias.join(" ")).not.toMatch(/férias/);
    expect(r.avisos.join(" ")).toMatch(/férias já tirados/);
  });

  it("avisa a antecipação quando tirou mais do que tinha direito", () => {
    const r = calcularRescisao(ficha(), { ...completo, diasDeFeriasTirados: 30 })!;
    expect(r.avisos.join(" ")).toMatch(/antecipação/);
  });
});

describe("devolução do Flash", () => {
  it("devolve a sobra do mês em dias reais", () => {
    const r = calcularRescisao(ficha({ datadesl: "2026-07-18" }), completo)!;
    perto(r.descontoFlash, FLASH_MENSAL * (13 / 31)); // 31 − 18 não trabalhados
  });

  it("quem não tem Flash não devolve nada", () => {
    const r = calcularRescisao(ficha({ flash: 0 }), completo)!;
    expect(r.descontoFlash).toBe(0);
    expect(r.linhas.some((l) => l.chave === "flash")).toBe(false);
  });

  it("sai do último dia do mês sem devolver nada", () => {
    const r = calcularRescisao(ficha({ datadesl: "2026-07-31" }), completo)!;
    expect(r.descontoFlash).toBe(0);
  });
});

describe("variável e liberalidade", () => {
  it("a linha da variável existe mesmo zerada, com o aviso", () => {
    const r = calcularRescisao(ficha(), { diasDeFeriasTirados: 0 })!;
    expect(r.linhas.some((l) => l.chave === "variavel")).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/Variável/);
  });

  it("a liberalidade da ficha entra somando", () => {
    const r = calcularRescisao(ficha({ valor_liberalidade: 1500 }), completo)!;
    expect(r.linhas.find((l) => l.chave === "liberalidade")?.valor).toBe(1500);
  });
});

describe("total", () => {
  it("soma férias − tiradas + proporcional + variável + multa − Flash", () => {
    const r = calcularRescisao(ficha(), {
      diasDeFeriasTirados: 5,
      variavel: 800,
      classificacao: null,
    })!;
    // Início 06/01, saída 18/07: jan..jun contam, julho não (saiu no dia 18? sim, >15).
    const esperado =
      (6000 / 12) * r.mesesDeFerias -
      (6000 / 30) * 5 +
      6000 * (18 / 31) +
      800 +
      6000 -
      FLASH_MENSAL * (13 / 31);
    perto(r.total, esperado);
  });

  it("sem data de saída ou sem valor não há conta", () => {
    expect(calcularRescisao(ficha({ datadesl: null }))).toBeNull();
    expect(calcularRescisao(ficha({ valor: 0 }))).toBeNull();
  });
});

describe("texto para auditoria", () => {
  it("discrimina componente a componente e lista a fonte", () => {
    const r = calcularRescisao(ficha(), completo)!;
    const t = rescisaoEmTexto("Maria Silva", r, "2026-07-18");
    expect(t).toContain("Rescisão — Maria Silva");
    expect(t).toContain("18/07/2026");
    expect(t).toContain("Multa de rescisão");
    expect(t).toContain("TOTAL:");
    expect(t).toContain("Fontes:");
  });
});
