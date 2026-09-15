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
  rescisaoParaRH,
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

describe("variável e acerto do RH", () => {
  it("a linha da variável existe mesmo zerada, com o aviso", () => {
    const r = calcularRescisao(ficha(), { diasDeFeriasTirados: 0 })!;
    expect(r.linhas.some((l) => l.chave === "variavel")).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/Variável/);
  });

  it("valor_liberalidade é o acerto que o RH já calculou — NÃO entra na soma", () => {
    const sem = calcularRescisao(ficha(), completo)!;
    const com = calcularRescisao(ficha({ valor_liberalidade: 1500 }), completo)!;
    perto(com.total, sem.total);
    expect(com.linhas.some((l) => l.chave === "liberalidade")).toBe(false);
    expect(com.acertoDoRH).toBe(1500);
    perto(com.diferencaDoRH!, 1500 - sem.total);
    expect(com.avisos.join(" ")).toMatch(/RH lançou/);
  });

  it("bate no centavo com o acerto do RH quando os dois consideram as mesmas coisas", () => {
    // Caso real de 03/08/2026, sem nome: involuntário, R$ 3.700, entrou em 14/04.
    const r = calcularRescisao(
      ficha({ inicio: "2026-04-14", datadesl: "2026-08-03", valor: 3700, valor_liberalidade: 4839.78 }),
      completo,
    )!;
    perto(r.total, 4839.78);
    perto(r.diferencaDoRH!, 0);
    expect(r.avisos.join(" ")).not.toMatch(/RH lançou/);
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

describe("o que o e-mail sobrepõe", () => {
  it("a remuneração do e-mail manda mais que a da ficha, com aviso", () => {
    const r = calcularRescisao(ficha(), { ...completo, remuneracao: 7000 })!;
    expect(r.valor).toBe(7000);
    expect(r.multa).toBe(7000);
    expect(r.avisos.join(" ")).toMatch(/e-mail diz/);
  });

  it("o último dia do e-mail manda mais que `datadesl`, com aviso", () => {
    const r = calcularRescisao(ficha({ datadesl: "2026-07-31" }), {
      ...completo,
      ultimoDia: "2026-07-18",
    })!;
    expect(r.ultimoDia).toBe("2026-07-18");
    expect(r.diasTrabalhadosNoMes).toBe(18);
    expect(r.avisos.join(" ")).toMatch(/último dia/);
  });

  it("valores iguais aos da ficha não geram aviso nenhum", () => {
    const r = calcularRescisao(ficha(), {
      ...completo,
      remuneracao: 6000,
      ultimoDia: "2026-07-18",
    })!;
    expect(r.avisos.join(" ")).not.toMatch(/e-mail diz|último dia/);
  });
});

describe("texto para o chat do RH", () => {
  const ricardo = () =>
    calcularRescisao(
      ficha({ inicio: "2026-08-03", datadesl: "2026-09-10", valor: 3700, tipodesl: "Voluntário" }),
      { diasDeFeriasTirados: 0, variavel: 1000 },
    )!;

  it("sai no formato que o financeiro já mandava, coluna por coluna", () => {
    // O acerto de 09/2026 que o RH lançou (R$ 2.208,33), com o nome trocado.
    expect(rescisaoParaRH("Maria Silva ", ricardo())).toBe(
      [
        "RESCISÃO — MARIA SILVA",
        "",
        "Período trabalhado: 03/08/2026 a 10/09/2026 (39 dias)",
        "Remuneração de referência: R$ 3.700,00",
        "Tipo de desligamento: Voluntário",
        "",
        "Férias proporcionais (1 mês)" + ".".repeat(14) + " R$   308,33",
        "Proporcional do mês de saída (10/30)" + ".".repeat(6) + " R$ 1.233,33",
        "Variável / Comissão" + ".".repeat(23) + " R$ 1.000,00",
        "(-) Desconto Flash (20 dias)" + ".".repeat(13) + " (R$   333,33)",
        " ".repeat(42) + "-".repeat(12),
        "TOTAL A RECEBER" + ".".repeat(27) + " R$ 2.208,33",
      ].join("\n"),
    );
  });

  it("os números caem na mesma coluna, com desconto ou sem", () => {
    const linhas = rescisaoParaRH("Maria Silva", ricardo())
      .split("\n")
      .filter((l) => l.includes("R$ ") && l.includes("..."));
    const fimDoNumero = linhas.map((l) => l.replace(/\)$/, "").length);
    expect(new Set(fimDoNumero).size).toBe(1);
  });

  it("o total do texto é a soma das linhas escritas nele, no centavo", () => {
    const r = calcularRescisao(ficha({ datadesl: "2026-07-18" }), { diasDeFeriasTirados: 5, variavel: 800 })!;
    const soma = r.linhas.reduce((s, l) => s + (l.desconto ? -l.valor : l.valor), 0);
    expect(Math.round(soma * 100)).toBe(Math.round(r.total * 100));
  });

  it("multa só no involuntário; férias tiradas só quando há", () => {
    const inv = rescisaoParaRH("X", calcularRescisao(ficha(), { diasDeFeriasTirados: 5, variavel: 0 })!);
    expect(inv).toContain("Multa de rescisão (1 remuneração)");
    expect(inv).toContain("(-) Férias já tiradas (5 dias)");
    expect(inv).toContain("Tipo de desligamento: Involuntário");
    const vol = rescisaoParaRH("X", ricardo());
    expect(vol).not.toContain("Multa");
    expect(vol).not.toContain("Férias já tiradas");
  });

  it("a variável aparece mesmo zerada; o Flash some quando não há o que devolver", () => {
    const t = rescisaoParaRH("X", calcularRescisao(ficha({ datadesl: "2026-07-31" }), completo)!);
    expect(t).toContain("Variável / Comissão");
    expect(t).not.toContain("Flash");
  });

  it("com pendência, o total sai 'a definir' e o tipo 'a classificar'", () => {
    const t = rescisaoParaRH("X", calcularRescisao(ficha({ tipodesl: "" }), completo)!);
    expect(t).toContain("Tipo de desligamento: a classificar");
    expect(t).toMatch(/TOTAL A RECEBER\.+ a definir$/);
  });

  it("não leva avisos, fontes nem a conferência com o RH — é texto para lançar", () => {
    const t = rescisaoParaRH("X", calcularRescisao(ficha({ valor_liberalidade: 9999 }), completo)!);
    expect(t).not.toMatch(/Fontes|Aviso|RH lançou|Pendência/);
  });
});
