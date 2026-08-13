import { describe, it, expect } from "vitest";
import {
  lerDre, mesesComDado, alavancagem, pessoalSobreReceita, serieArr,
  regraDos40, calcularRunway, ponteEbitda, mesmoMesAnoPassado, fluxoLivreDaDfc, cashburnDaDfc,
  RL, EBITDA, SGA, CUSTOS_OP, PESSOAL_SGA,
  type LinhaBlob,
} from "@/lib/analisesDre";
import { lerBpAnual, planoPorColuna, normLabel } from "@/lib/bpAnual";

/* ------------------------------------------------------------------ *
 *  Um blob de DRE de brinquedo, com a forma real: linha "Conta" + uma
 *  coluna por mês. Dois anos para o cálculo ano-contra-ano ter par.
 * ------------------------------------------------------------------ */

const COLS = ["Jan-25", "Feb-25", "Jan-26", "Feb-26"];

/** Monta uma linha do blob. `sinal` diz se a planilha grava despesa negativa. */
const linha = (conta: string, valores: (number | null)[]): LinhaBlob => {
  const r: LinhaBlob = { Conta: conta };
  COLS.forEach((c, i) => { r[c] = valores[i]; });
  return r;
};

/* Despesa NEGATIVA — convenção do omie-sync. */
const BLOB_NEG: LinhaBlob[] = [
  linha("Receita de Assinaturas", [800, 900, 1000, 1100]),
  linha("Enterprise", [200, 100, 200, 300]),
  linha("Receita Líquida", [1000, 1000, 1200, 1400]),
  // custos operacionais (filhos do bloco "(-) Custos Operacionais")
  linha("Equipe Operacional", [-100, -100, -110, -120]),
  linha("Premiações Operacionais", [-20, -20, -20, -20]),
  linha("Servidor", [-80, -80, -90, -100]),
  // SG&A > Pessoal
  linha("Equipe Administrativa", [-200, -200, -220, -230]),
  linha("Equipe Comercial", [-100, -100, -110, -120]),
  linha("Encargos Sociais", [-50, -50, -55, -60]),
  // SG&A > Despesas Administrativas
  linha("Ocupação & Escritório", [-60, -60, -65, -70]),
  // SG&A > Despesas Marketing & Vendas
  linha("Campanhas de Mídia Paga", [-90, -90, -100, -110]),
  linha("EBITDA", [300, 300, 430, 570]),
];

/* Mesmo mês, despesa POSITIVA — convenção do import do tracker em Excel. */
const BLOB_POS: LinhaBlob[] = BLOB_NEG.map((r) => {
  const conta = String(r.Conta);
  if (["Receita de Assinaturas", "Enterprise", "Receita Líquida", "EBITDA"].includes(conta)) return r;
  const out: LinhaBlob = { Conta: conta };
  COLS.forEach((c) => { out[c] = r[c] == null ? null : -(r[c] as number); });
  return out;
});

describe("lerDre — sinal e hierarquia", () => {
  it("lê a despesa como magnitude positiva venha ela negativa ou positiva do blob", () => {
    const neg = lerDre(BLOB_NEG, COLS);
    const pos = lerDre(BLOB_POS, COLS);
    // SG&A = Pessoal(200+100+50) + Adm(60) + Mkt(90) = 500
    expect(neg.custo(SGA, "Jan-25")).toBe(500);
    expect(pos.custo(SGA, "Jan-25")).toBe(500);
    expect(neg.custo(PESSOAL_SGA, "Jan-25")).toBe(350);
    expect(pos.custo(PESSOAL_SGA, "Jan-25")).toBe(350);
  });

  it("soma os filhos em vez de ler o pai — o pai do blob fica para trás no omie-sync", () => {
    // O blob nem tem linha "(-) Custos Operacionais"; ela sai dos filhos.
    const d = lerDre(BLOB_NEG, COLS);
    expect(d.custo(CUSTOS_OP, "Jan-25")).toBe(200); // 100 + 20 + 80
  });

  it("pai desatualizado no blob perde para a soma dos filhos", () => {
    const comPaiErrado = [...BLOB_NEG, linha("Pessoal", [-9, -9, -9, -9])];
    const d = lerDre(comPaiErrado, COLS);
    expect(d.custo(PESSOAL_SGA, "Jan-25")).toBe(350);
  });

  it("receita vem em módulo e rubrica ausente vem null, não zero", () => {
    const d = lerDre(BLOB_NEG, COLS);
    expect(d.receita(RL, "Jan-25")).toBe(1000);
    expect(d.bruto("Rubrica Que Não Existe", "Jan-25")).toBeNull();
  });
});

describe("mesesComDado", () => {
  it("corta o mês corrente ainda aberto — custo cheio com receita pela metade", () => {
    const d = lerDre(BLOB_NEG, COLS);
    const abertos = mesesComDado(d, COLS, new Set(), "Feb-26");
    expect(abertos).toEqual(["Jan-25", "Feb-25", "Jan-26"]);
  });

  it("mês corrente já travado entra — está fechado", () => {
    const d = lerDre(BLOB_NEG, COLS);
    expect(mesesComDado(d, COLS, new Set(["Feb-26"]), "Feb-26")).toEqual(COLS);
  });

  it("mês sem receita fica de fora", () => {
    const vazio = [...BLOB_NEG.filter((r) => r.Conta !== "Receita Líquida"),
      linha("Receita Líquida", [1000, 0, 1200, 1400])];
    const d = lerDre(vazio, COLS);
    expect(mesesComDado(d, COLS, new Set(), "Mar-26")).toEqual(["Jan-25", "Jan-26", "Feb-26"]);
  });
});

describe("alavancagem — a receita cresce mais rápido que a estrutura?", () => {
  const d = lerDre(BLOB_NEG, COLS);

  it("indexa as duas curvas em 100 no primeiro mês", () => {
    const a = alavancagem(d, COLS);
    expect(a.serie[0].receitaIdx).toBe(100);
    expect(a.serie[0].sgaIdx).toBe(100);
    // receita 1000 → 1400 = 140; SG&A 500 → 590 = 118
    expect(a.serie[3].receitaIdx).toBeCloseTo(140, 6);
    expect(a.serie[3].sgaIdx).toBeCloseTo(118, 6);
  });

  it("a tesoura é a diferença dos crescimentos — positiva quando a receita ganha", () => {
    const a = alavancagem(d, COLS);
    expect(a.cresceReceita).toBeCloseTo(0.4, 6);
    expect(a.cresceSga).toBeCloseTo(0.18, 6);
    expect(a.tesoura).toBeCloseTo(0.22, 6);
  });

  it("o peso do SG&A sobre a receita cai quando há alavancagem", () => {
    const a = alavancagem(d, COLS);
    expect(a.pesoInicio).toBeCloseTo(50, 6);       // 500/1000
    expect(a.pesoFim).toBeCloseTo(42.142857, 4);   // 590/1400
  });

  it("dá o mesmo resultado com o blob de sinal invertido", () => {
    const a = alavancagem(lerDre(BLOB_POS, COLS), COLS);
    expect(a.tesoura).toBeCloseTo(0.22, 6);
    expect(a.pesoFim).toBeCloseTo(42.142857, 4);
  });
});

describe("pessoal sobre receita líquida", () => {
  it("separa estrutura (SG&A) de custo de servir (operação)", () => {
    const s = pessoalSobreReceita(lerDre(BLOB_NEG, COLS), COLS);
    // Jan-25: estrutura 350, operação 120 → total 470, sobre receita 1000
    expect(s[0].estrutura).toBe(350);
    expect(s[0].total).toBe(470);
    expect(s[0].estruturaPct).toBeCloseTo(35, 6);
    expect(s[0].totalPct).toBeCloseTo(47, 6);
  });

  it("cair é ficar mais produtivo", () => {
    const s = pessoalSobreReceita(lerDre(BLOB_NEG, COLS), COLS);
    // Feb-26: estrutura 410 sobre 1400 = 29,3%
    expect(s[3].estruturaPct!).toBeLessThan(s[0].estruturaPct!);
  });
});

describe("ARR", () => {
  it("é a receita recorrente do mês vezes 12", () => {
    const a = serieArr(lerDre(BLOB_NEG, COLS), COLS);
    expect(a[0].mrr).toBe(1000);       // 800 assinaturas + 200 enterprise
    expect(a[0].arr).toBe(12000);
  });

  it("o a/a compara com o mesmo mês do ano anterior, não com o mês anterior", () => {
    const a = serieArr(lerDre(BLOB_NEG, COLS), COLS);
    expect(a[0].yoy).toBeNull();                  // Jan-25 não tem Jan-24
    expect(a[2].yoy).toBeCloseTo(0.2, 6);         // Jan-26 1200 vs Jan-25 1000
    expect(a[3].yoy).toBeCloseTo(0.4, 6);         // Feb-26 1400 vs Feb-25 1000
  });
});

describe("regra dos 40", () => {
  it("soma crescimento a/a da receita com a margem EBITDA", () => {
    const r = regraDos40(lerDre(BLOB_NEG, COLS), COLS);
    // Jan-26: receita 1200 vs 1000 = +20%; EBITDA 430/1200 = 35,83%
    expect(r[2].crescimento).toBeCloseTo(20, 6);
    expect(r[2].margem).toBeCloseTo(35.8333, 3);
    expect(r[2].regra).toBeCloseTo(55.8333, 3);
  });

  it("mês sem par no ano anterior fica null em vez de inventar base", () => {
    const r = regraDos40(lerDre(BLOB_NEG, COLS), COLS);
    expect(r[0].crescimento).toBeNull();
    expect(r[0].regra).toBeNull();
    expect(r[0].margem).toBeCloseTo(30, 6);
  });
});

describe("runway", () => {
  it("divide o caixa pela queima média dos últimos meses", () => {
    const r = calcularRunway(600, [-100, -200, -300], 3);
    expect(r.queima).toBe(200);
    expect(r.meses).toBe(3);
    expect(r.base).toBe(3);
  });

  it("um mês de 13º não domina a conta — a janela é média, não último mês", () => {
    const r = calcularRunway(600, [-100, -100, -400], 3);
    expect(r.queima).toBeCloseTo(200, 6);
  });

  it("gerando caixa não tem runway, e a tela precisa saber disso", () => {
    const r = calcularRunway(600, [100, 200, 300], 3);
    expect(r.gerandoCaixa).toBe(true);
    expect(r.meses).toBeNull();
  });

  it("sem fluxo livre nenhum não inventa número", () => {
    const r = calcularRunway(600, [null, null], 3);
    expect(r.meses).toBeNull();
    expect(r.base).toBe(0);
  });
});

describe("fluxo livre da DFC", () => {
  /* O blob da DFC que o omie-sync escreve: folhas preenchidas, linhas de total
     em branco. É o caso que fazia o runway sumir. */
  const DFC_SEM_TOTAIS: LinhaBlob[] = [
    linha("Entrada de Receita", [1000, 1000, 1000, 1000]),       // Entradas Operacionais
    linha("Simples Nacional", [-50, -50, -50, -50]),             // Saídas > Impostos & Deduções
    linha("Equipe Administrativa", [-700, -700, -700, -700]),    // Saídas > Pessoal
    linha("(-) Compra de Equipamentos", [-100, 0, 0, 0]),        // Investimentos
    linha("(+) Novos Empréstimos & Financiamentos", [0, 0, 500, 0]), // Financiamento
  ];

  it("soma as folhas quando o blob não traz a linha de total", () => {
    const f = fluxoLivreDaDfc(DFC_SEM_TOTAIS, COLS);
    // Jan: 1000 − 50 − 700 = 250 operacional; −100 de investimento → 150
    expect(f["Jan-25"]).toBe(150);
    expect(f["Feb-25"]).toBe(250);
    expect(f["Jan-26"]).toBe(750);   // 250 + 500 de financiamento
  });

  it("respeita a linha de total quando ela existe", () => {
    const comTotal = [...DFC_SEM_TOTAIS, linha("Fluxo Livre", [-42, -42, -42, -42])];
    expect(fluxoLivreDaDfc(comTotal, COLS)["Jan-25"]).toBe(-42);
  });

  it("alimenta o runway de ponta a ponta", () => {
    const gastando: LinhaBlob[] = [
      linha("Entrada de Receita", [1000, 1000, 1000, 1000]),
      linha("Equipe Administrativa", [-1200, -1300, -1400, -1500]),
    ];
    const f = fluxoLivreDaDfc(gastando, COLS);
    const r = calcularRunway(3600, COLS.map((c) => f[c]), 3);
    expect(r.queima).toBeCloseTo(400, 6);   // média de 300, 400, 500
    expect(r.meses).toBeCloseTo(9, 6);
  });

  /* A mesma DFC lida como QUEIMA: o empréstimo de 500 em Jan-26 sai da conta. */
  describe("cashburn", () => {
    it("tira a captação do fluxo livre", () => {
      const cb = cashburnDaDfc(DFC_SEM_TOTAIS, COLS);
      expect(cb["Feb-25"]).toBe(250);          // mês sem empréstimo: igual ao livre
      expect(cb["Jan-26"]).toBe(250);          // livre 750 − 500 de empréstimo
    });

    it("respeita a linha gravada — é o que a grade da DFC mostra", () => {
      const comLinha = [...DFC_SEM_TOTAIS, linha("Cashburn", [-42, -42, -42, -42])];
      expect(cashburnDaDfc(comLinha, COLS)["Jan-26"]).toBe(-42);
    });

    it("o empréstimo não pode virar runway: livre positivo, queima real", () => {
      const comCaptacao: LinhaBlob[] = [
        linha("Entrada de Receita", [1000, 1000, 1000, 1000]),
        linha("Equipe Administrativa", [-1200, -1200, -1200, -1200]),
        linha("(+) Novos Empréstimos & Financiamentos", [0, 0, 500, 0]),
      ];
      const livre = fluxoLivreDaDfc(comCaptacao, COLS);
      const queima = cashburnDaDfc(comCaptacao, COLS);
      expect(livre["Jan-26"]).toBe(300);       // positivo por causa da captação
      expect(queima["Jan-26"]).toBe(-200);     // e o caixa queimou 200 assim mesmo

      /* Mesmos 3.600 de saldo e a mesma janela de três meses: contando o
         empréstimo o caixa "dura" nove anos; medindo a queima, um ano e meio. */
      expect(calcularRunway(3600, COLS.map((c) => livre[c]), 3).meses).toBeCloseTo(108, 6);
      expect(calcularRunway(3600, COLS.map((c) => queima[c]), 3).meses).toBeCloseTo(18, 6);
    });
  });
});

describe("ponte do EBITDA", () => {
  const d = lerDre(BLOB_NEG, COLS);
  const p = ponteEbitda(
    (l) => d.bruto(l, "Jan-26"),
    (l) => d.bruto(l, "Feb-26"),
    (l) => d.custo(l, "Jan-26"),
    (l) => d.custo(l, "Feb-26"),
  );

  it("fecha: a soma dos degraus leva do EBITDA velho ao novo", () => {
    expect(p.de).toBe(430);
    expect(p.para).toBe(570);
    const soma = p.degraus.reduce((s, x) => s + x.delta, 0);
    expect(soma).toBeCloseTo(p.para - p.de, 6);
    expect(p.residuo).toBeCloseTo(0, 6);
  });

  it("gastar mais tira do EBITDA — em despesa a contribuição é o negativo da variação", () => {
    const mkt = p.degraus.find((x) => x.rubrica === "Marketing & vendas")!;
    expect(mkt.delta).toBe(-10);           // 100 → 110
    const receita = p.degraus.find((x) => x.rubrica === "Receita líquida")!;
    expect(receita.delta).toBe(200);       // 1200 → 1400
  });

  it("publica o resíduo em vez de escondê-lo quando a DRE ganha linha fora do esquema", () => {
    const comLinhaSolta = [...BLOB_NEG.filter((r) => r.Conta !== "EBITDA"),
      linha("EBITDA", [300, 300, 430, 500])];
    const e = lerDre(comLinhaSolta, COLS);
    const q = ponteEbitda(
      (l) => e.bruto(l, "Jan-26"), (l) => e.bruto(l, "Feb-26"),
      (l) => e.custo(l, "Jan-26"), (l) => e.custo(l, "Feb-26"),
    );
    expect(q.residuo).toBeCloseTo(-70, 6);
  });
});

/* ------------------------------------------------------------------ *
 *  BP — a planilha da diretoria, com o layout real: uma linha
 *  "Mês Calendário" apontando as colunas dos meses e rótulos com
 *  numeração de tópico.
 * ------------------------------------------------------------------ */

/** Uma linha da planilha: rótulo + 12 colunas de mês + a coluna de total. */
const linhaBp = (rotulo: string, base: number, passo: number) => {
  const r: Record<string, unknown> = { Imagem: rotulo };
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    const v = base + passo * i;
    r[`C${i + 1}`] = v;
    soma += v;
  }
  r.Total = soma;
  return r;
};

const LINHA_MESES: Record<string, unknown> = { Imagem: "Mês Calendário", Total: null };
for (let i = 0; i < 12; i++) LINHA_MESES[`C${i + 1}`] = i + 1;

const PLANILHA_BP = [
  LINHA_MESES,
  linhaBp("1. Receita Líquida", 1100, 100),
  linhaBp("3. (-) SG&A", -520, -10),
  linhaBp("Receita Recorrente", 1000, 50),
  /* Os blocos auxiliares que vêm depois do plano na planilha de verdade: um
     com o sinal trocado (alimenta gráfico) e um deslocado um mês ("período
     anterior"). Somar os três fazia fev sair com o número de janeiro. */
  linhaBp("(-) SG&A", 520, 10),
  linhaBp("(-) SG&A", -510, -10),
];

describe("leitura do BP", () => {
  it("acha as colunas dos meses pela linha 'Mês Calendário'", () => {
    const bp = lerBpAnual(PLANILHA_BP);
    expect(bp.vazio).toBe(false);
    expect(bp.porRubrica[normLabel("Receita Líquida")]?.slice(0, 3)).toEqual([1100, 1200, 1300]);
  });

  it("derruba a numeração de tópico e o sinal contábil do rótulo", () => {
    const bp = lerBpAnual(PLANILHA_BP);
    expect(Object.keys(bp.porRubrica)).toContain("sg&a");
    expect(Object.keys(bp.porRubrica)).toContain("receita liquida");
  });

  it("vale o primeiro bloco: os auxiliares não entram na soma", () => {
    const bp = lerBpAnual(PLANILHA_BP);
    // Somando os três daria -510/-520/-530: o bloco deslocado, que é o mês errado.
    expect(bp.porRubrica["sg&a"].slice(0, 3)).toEqual([-520, -530, -540]);
    expect(bp.porRubrica["sg&a"]).toHaveLength(12);
  });

  it("acusa os rótulos repetidos em vez de descartá-los calado", () => {
    expect(lerBpAnual(PLANILHA_BP).duplicadas).toEqual(["sg&a"]);
  });

  it("planoPorColuna casa o mês da DRE com o mês do plano", () => {
    const plano = planoPorColuna(new Map([[2026, lerBpAnual(PLANILHA_BP)]]));
    expect(plano(RL, "Jan-26")).toBe(1100);
    expect(plano(RL, "Feb-26")).toBe(1200);
    expect(plano(SGA, "Jan-26")).toBe(-520);
  });

  it("ano sem plano devolve null em vez de cair no BP do ano errado", () => {
    const plano = planoPorColuna(new Map([[2026, lerBpAnual(PLANILHA_BP)]]));
    expect(plano(RL, "Jan-25")).toBeNull();
  });

  it("BP vazio não derruba a alavancagem — as linhas de plano ficam null", () => {
    const plano = planoPorColuna(new Map());
    const a = alavancagem(lerDre(BLOB_NEG, COLS), COLS, plano);
    expect(a.serie.every((p) => p.receitaBpIdx === null)).toBe(true);
    expect(a.cresceReceita).toBeCloseTo(0.4, 6);
  });

  it("com plano, a curva do BP também sai indexada em 100", () => {
    const plano = planoPorColuna(new Map([[2026, lerBpAnual(PLANILHA_BP)]]));
    const a = alavancagem(lerDre(BLOB_NEG, COLS), ["Jan-26", "Feb-26"], plano);
    expect(a.serie[0].receitaBpIdx).toBe(100);
    expect(a.serie[1].receitaBpIdx).toBeCloseTo((1200 / 1100) * 100, 6);
    // SG&A do plano é negativo na planilha e mesmo assim indexa positivo
    expect(a.serie[1].sgaBpIdx).toBeCloseTo((530 / 520) * 100, 6);
  });
});

describe("mesmoMesAnoPassado", () => {
  it("anda 12 meses para trás sem escorregar de mês", () => {
    expect(mesmoMesAnoPassado("Jul-26")).toBe("Jul-25");
    expect(mesmoMesAnoPassado("Jan-26")).toBe("Jan-25");
    expect(mesmoMesAnoPassado("Mar-25")).toBe("Mar-24");
  });
});
