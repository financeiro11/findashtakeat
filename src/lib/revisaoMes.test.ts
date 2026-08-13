import { describe, it, expect } from "vitest";
import { lerDre } from "@/lib/analisesDre";
import {
  espinhaDre, cascata, pareto, acimaDoCorte, confrontar, ebitdaDoPlano,
  blocoCaixa, proximoMes, mesSeguinte, montarSinal, aplicarEdicao, sinalMudou,
  rubricasDoPareto, lerDfc, planoDaDre, mesesDoAno, atingimento,
  RECEITA_BRUTA, RECEITA_RECORRENTE, PESSOAL, MKT, ADM, DEDUCOES,
  type Plano, type Leitura, type Sinal,
} from "@/lib/revisaoMes";
import { lerBpAnual, type BpAnual } from "@/lib/bpAnual";
import { RL, EBITDA, SGA, CUSTOS_OP } from "@/lib/analisesDre";

/* ---------------------------------------------------------------------------
 * Um mês inteiro de DRE, montado à mão.
 *
 * DESPESA NEGATIVA, que é como o omie-sync grava — é o caso em que o sinal do
 * mês precisa ser descoberto, e é onde os bugs de sinal aparecem. As folhas
 * somam os pais de propósito: a regra da tela é pai = soma dos filhos.
 *
 *   Receita bruta   1.487.300   (recorrente 1.238.900 + spot 248.400)
 *   Deduções         -134.900
 *   Receita líquida  1.352.400
 *   Custos op.       -213.700
 *   Margem contrib.  1.138.700
 *   Pessoal          -742.300
 *   Adm              -366.400
 *   Marketing        -214.600
 *   SG&A            -1.323.300
 *   EBITDA           -184.600
 * ------------------------------------------------------------------------- */
const COLS = ["May-26", "Jun-26", "Jul-26"];

const linha = (conta: string, mai: number, jun: number, jul: number) =>
  ({ Conta: conta, "May-26": mai, "Jun-26": jun, "Jul-26": jul });

const DRE_ROWS = [
  linha("Receita de Assinaturas", 1_150_000, 1_180_000, 1_200_000),
  linha("Enterprise", 30_000, 35_800, 38_900),
  linha("Receita com Materiais", 120_000, 130_000, 140_000),
  linha("Receita Markup", 50_000, 55_400, 58_400),
  linha("Serviços para Clientes", 45_000, 50_000, 50_000),
  linha("Simples Nacional", -120_000, -128_000, -134_900),
  linha("Receita Líquida", 1_275_000, 1_323_200, 1_352_400),
  linha("Servidor", -90_000, -95_000, -96_400),
  linha("Meios de Pagamento", -100_000, -103_400, -117_300),
  linha("Margem de contribuição", 1_085_000, 1_124_800, 1_138_700),
  linha("Equipe Tecnologia", -300_000, -305_000, -342_300),
  linha("Equipe Comercial", -200_000, -203_900, -210_000),
  linha("Encargos Sociais", -180_000, -190_000, -190_000),
  linha("Ocupação & Escritório", -180_000, -178_700, -186_400),
  linha("Softwares Administrativos", -180_000, -180_000, -180_000),
  linha("Campanhas de Mídia Paga", -150_000, -163_300, -214_600),
  linha("EBITDA", -125_000, -151_900, -184_600),
];

/* O plano: só o que a reunião confronta. Despesa POSITIVA aqui, para provar que
   o módulo não depende do sinal da planilha da diretoria. */
const PLANO_JUL: Record<string, number> = {
  [RECEITA_BRUTA]: 1_560_000,
  [RECEITA_RECORRENTE]: 1_302_000,
  "Receita Spot": 258_000,
  [DEDUCOES]: 141_500,
  [RL]: 1_418_500,
  [CUSTOS_OP]: 206_000,
  [SGA]: 1_354_500,
  [PESSOAL]: 688_000,
  [ADM]: 498_500,
  [MKT]: 168_000,
  [EBITDA]: -142_000,
  "Equipe Tecnologia": 300_000,
  "Equipe Comercial": 200_000,
  "Encargos Sociais": 188_000,
  "Ocupação & Escritório": 190_000,
  "Softwares Administrativos": 308_500,
  "Campanhas de Mídia Paga": 168_000,
  Servidor: 90_000,
  "Meios de Pagamento": 116_000,
  "Receita de Assinaturas": 1_260_000,
  Enterprise: 42_000,
  "Simples Nacional": 141_500,
};

/* O mesmo plano em todos os meses: a repetição do desvio é o que a contagem de
   "meses ruins" mede, e ela precisa de mais de um mês para significar algo. */
const plano: Plano = (label, col) => (COLS.includes(col) ? PLANO_JUL[label] ?? null : null);
const semPlano: Plano = () => null;

const leitor = lerDre(DRE_ROWS, COLS);
const MES = "Jul-26";
const ANTERIOR = "Jun-26";

/* ============================================================
 *  Leitura e sinal
 * ============================================================ */

describe("leitura da DRE", () => {
  it("soma os filhos e devolve despesa como magnitude positiva", () => {
    expect(leitor.receita(RECEITA_BRUTA, MES)).toBe(1_487_300);
    expect(leitor.receita(RECEITA_RECORRENTE, MES)).toBe(1_238_900);
    expect(leitor.custo(PESSOAL, MES)).toBe(742_300);
    expect(leitor.custo(SGA, MES)).toBe(742_300 + 366_400 + 214_600);
  });

  it("EBITDA sai COM SINAL — um mês negativo não pode virar positivo", () => {
    const [ebitda] = espinhaDre(leitor, plano, MES, ANTERIOR).filter((l) => l.rubrica === EBITDA);
    expect(ebitda.realizado).toBe(-184_600);
    expect(ebitda.orcado).toBe(-142_000);
    // Piorou 42,6 mil contra um plano que já era negativo.
    expect(ebitda.impacto).toBe(-42_600);
  });
});

describe("confrontar", () => {
  it("receita abaixo do plano tira do EBITDA", () => {
    const c = confrontar(leitor, plano, RECEITA_RECORRENTE, "receita", MES, ANTERIOR);
    expect(c.realizado).toBe(1_238_900);
    expect(c.orcado).toBe(1_302_000);
    expect(c.impacto).toBe(-63_100);
    expect(c.desvioPct).toBeCloseTo(-63_100 / 1_302_000, 8);
  });

  it("despesa acima do plano tira do EBITDA, e o desvio% é lido como 'gastou mais'", () => {
    const c = confrontar(leitor, plano, PESSOAL, "despesa", MES, ANTERIOR);
    expect(c.realizado).toBe(742_300);
    expect(c.orcado).toBe(688_000);
    expect(c.impacto).toBe(-54_300);          // gastou 54,3 mil a mais
    expect(c.desvioPct).toBeCloseTo(54_300 / 688_000, 8);  // positivo = gastou mais
  });

  it("sem janela de YTD as duas colunas ficam nulas, não zeradas", () => {
    const c = confrontar(leitor, plano, PESSOAL, "despesa", MES, ANTERIOR);
    expect(c.ytd).toBeNull();
    expect(c.ytdOrcado).toBeNull();
  });

  it("despesa ABAIXO do plano soma ao EBITDA", () => {
    const c = confrontar(leitor, plano, ADM, "despesa", MES, ANTERIOR);
    expect(c.realizado).toBe(366_400);
    expect(c.orcado).toBe(498_500);
    expect(c.impacto).toBe(132_100);
    expect(c.desvioPct).toBeLessThan(0);
  });

  it("sem plano no BP, o impacto é null em vez de zero", () => {
    const c = confrontar(leitor, semPlano, PESSOAL, "despesa", MES, ANTERIOR);
    expect(c.orcado).toBeNull();
    expect(c.impacto).toBeNull();
    expect(c.realizado).toBe(742_300);   // o realizado continua lá
  });
});

describe("ebitdaDoPlano", () => {
  it("usa a linha do BP quando ela existe", () => {
    expect(ebitdaDoPlano(plano, MES)).toBe(-142_000);
  });

  it("sem a linha, monta da estrutura do plano e ignora o sinal da planilha", () => {
    const parcial: Plano = (label) =>
      label === RL ? 1_418_500 : label === CUSTOS_OP ? -206_000 : label === SGA ? -1_354_500 : null;
    expect(ebitdaDoPlano(parcial, MES)).toBe(1_418_500 - 206_000 - 1_354_500);
  });

  it("sem BP nenhum, é null — e não zero", () => {
    expect(ebitdaDoPlano(semPlano, MES)).toBeNull();
    expect(ebitdaDoPlano(null, MES)).toBeNull();
  });
});

/* ============================================================
 *  Cascata
 * ============================================================ */

describe("cascata", () => {
  const degraus = cascata(leitor, plano, MES);

  it("vai da receita bruta ao EBITDA, um degrau por bloco", () => {
    expect(degraus.map((d) => d.rubrica)).toEqual([
      RECEITA_BRUTA, DEDUCOES, CUSTOS_OP, PESSOAL, ADM, MKT, EBITDA,
    ]);
  });

  it("despesa desce e receita sobe — o sinal é o do EFEITO", () => {
    expect(degraus[0].valor).toBe(1_487_300);
    expect(degraus[3].valor).toBe(-742_300);
    expect(degraus[3].orcado).toBe(-688_000);
  });

  it("as bases encadeiam: cada barra começa onde a anterior terminou", () => {
    let esperado = 1_487_300;
    for (const d of degraus.slice(1, -1)) {
      expect(d.base).toBe(esperado);
      esperado += d.valor;
    }
    // Fecha no EBITDA da própria DRE (a diferença, quando houver, é o resíduo).
    expect(esperado).toBe(-184_600);
    expect(degraus[degraus.length - 1].valor).toBe(-184_600);
    expect(degraus[degraus.length - 1].base).toBe(0);
  });
});

/* ============================================================
 *  Pareto
 * ============================================================ */

describe("pareto", () => {
  const p = pareto({
    leitor, plano, mes: MES, mesAnterior: ANTERIOR,
    mesesFechados: COLS, detalhe: "bloco",
  });

  it("ordena pelo estrago no EBITDA, receita e despesa na mesma lista", () => {
    expect(p.ofensores.map((o) => o.rubrica)).toEqual([
      RECEITA_RECORRENTE,  // -63.100  (receita abaixo do plano)
      PESSOAL,             // -54.300  (despesa acima)
      MKT,                 // -46.600
      "Receita Spot",      //  -9.600
      CUSTOS_OP,           //  -7.700
    ]);
    expect(p.ofensores[0].impacto).toBe(-63_100);
    expect(p.ofensores[0].posicao).toBe(1);
  });

  it("as fatias somam 100% e o acumulado termina em 1", () => {
    expect(p.desfavoravel).toBe(63_100 + 54_300 + 46_600 + 9_600 + 7_700);
    expect(p.ofensores.reduce((s, o) => s + o.fatia, 0)).toBeCloseTo(1, 8);
    expect(p.ofensores[p.ofensores.length - 1].acumulado).toBeCloseTo(1, 8);
  });

  it("o que veio abaixo do plano vira amortecedor, não some", () => {
    expect(p.amortecedores.map((o) => o.rubrica)).toEqual([ADM, DEDUCOES]);
    expect(p.favoravel).toBe(132_100 + (141_500 - 134_900));
  });

  it("a decomposição fecha com o gap do EBITDA — o resto é publicado", () => {
    expect(p.gapEbitda).toBe(-42_600);
    // -63.100 -54.300 -46.600 -9.600 -7.700 +132.100 +6.600 = -42.600
    expect(p.residuo).toBeCloseTo(0, 6);
  });

  it("conta em quantos meses anteriores a rubrica já tinha ficado do lado ruim", () => {
    const pessoal = p.ofensores.find((o) => o.rubrica === PESSOAL)!;
    // Mai (-680.000 contra 688.000) ficou dentro do plano; Jun (-698.900) estourou.
    expect(pessoal.mesesConferidos).toBe(2);
    expect(pessoal.mesesRuins).toBe(1);
    expect(pessoal.historico.map((h) => h.mes)).toEqual(COLS);
  });

  it("rubrica com realizado e sem plano é publicada, não escondida", () => {
    const semBp = pareto({
      leitor, plano: semPlano, mes: MES, mesAnterior: ANTERIOR,
      mesesFechados: COLS, detalhe: "bloco",
    });
    expect(semBp.ofensores).toHaveLength(0);
    expect(semBp.semPlano).toContain(PESSOAL);
    expect(semBp.gapEbitda).toBeNull();
    expect(semBp.residuo).toBeNull();
  });

  it("no detalhe por rubrica, os blocos abrem nas folhas do esquema", () => {
    const fino = pareto({
      leitor, plano, mes: MES, mesAnterior: ANTERIOR,
      mesesFechados: COLS, detalhe: "rubrica",
    });
    const nomes = fino.ofensores.map((o) => o.rubrica);
    expect(nomes).toContain("Campanhas de Mídia Paga");
    expect(nomes).not.toContain(MKT);
    expect(fino.ofensores.find((o) => o.rubrica === "Equipe Tecnologia")?.bloco).toBe(PESSOAL);
  });
});

/* ============================================================
 *  O plano: casamento com a planilha do BP
 * ============================================================
 * Os rótulos abaixo são os do BP 2026 de verdade, com a numeração de tópico e a
 * grafia da diretoria. É contra eles que o de-para tem de funcionar. */
describe("planoDaDre", () => {
  const doBp = (rotulos: Record<string, number>): Map<number, BpAnual> => {
    const linhas = [
      { A: "Mês Calendário", ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`M${i}`, i + 1])) },
      ...Object.entries(rotulos).map(([rotulo, valor]) => ({
        A: rotulo,
        ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`M${i}`, valor])),
      })),
    ];
    return new Map([[2026, lerBpAnual(linhas)]]);
  };

  const BP_REAL = doBp({
    "1.Receita": 1_560_000,
    "1.1.Receita Recorrente Assinaturas": 1_302_000,
    "1.2.Receitas Spot": 258_000,
    "2.Deduções da Receita": 141_500,
    "Receita Líquida": 1_418_500,
    "3.Custo Operacional": 206_000,
    "3.2.Premiação Operacional": 4_000,
    "3.5.Infraestrutura": 90_000,
    "Margem de contribuição": 1_212_500,
    "(-) SG&A": 1_354_500,
    "4.Pessoal": 688_000,
    "5.Despesas Administrativas": 498_500,
    "5.4.Viagens & Transportes": 12_000,
    "6.Despesas Marketing & Vendas": 168_000,
    EBITDA: -142_000,
  });

  const p = planoDaDre(BP_REAL);

  it("acha a recorrência CERTA — não a receita total", () => {
    // O `bestKey` de lib/bpAnual devolvia 1.560.000 aqui: "receita" (7 letras)
    // fica mais perto de "receita recorrente" (18) do que a linha correta (30).
    expect(p(RECEITA_RECORRENTE, "Jul-26")).toBe(1_302_000);
    expect(p(RECEITA_BRUTA, "Jul-26")).toBe(1_560_000);
    expect(p("Receita Spot", "Jul-26")).toBe(258_000);
  });

  it("casa o plural da DRE com o singular do BP", () => {
    expect(p(CUSTOS_OP, "Jul-26")).toBe(206_000);
    expect(p("Premiações Operacionais", "Jul-26")).toBe(4_000);
    expect(p("Servidor", "Jul-26")).toBe(90_000);          // BP: "Infraestrutura"
    expect(p("Viagens & Transportes Adm", "Jul-26")).toBe(12_000);
  });

  it("os rótulos que já batem passam sem de-para", () => {
    expect(p(RL, "Jul-26")).toBe(1_418_500);
    expect(p(SGA, "Jul-26")).toBe(1_354_500);
    expect(p(PESSOAL, "Jul-26")).toBe(688_000);
    expect(p(ADM, "Jul-26")).toBe(498_500);
    expect(p(MKT, "Jul-26")).toBe(168_000);
    expect(p(DEDUCOES, "Jul-26")).toBe(141_500);
    expect(p(EBITDA, "Jul-26")).toBe(-142_000);
  });

  it("rubrica que o BP não tem é NULL, não um vizinho parecido", () => {
    // O BP não abre "Encargos Sociais" nem "Equipe Parcerias"; e "Receita de
    // Assinaturas" casava com a linha "1.Receita" no algoritmo aproximado.
    expect(p("Encargos Sociais", "Jul-26")).toBeNull();
    expect(p("Equipe Parcerias", "Jul-26")).toBeNull();
    expect(p("Receita de Assinaturas", "Jul-26")).toBeNull();
    expect(p("Campanhas de Mídia Paga", "Jul-26")).toBeNull();
  });

  it("ano sem BP não cai no BP do ano errado", () => {
    expect(p(RECEITA_BRUTA, "Jul-25")).toBeNull();
    expect(p(RECEITA_BRUTA, "Conta")).toBeNull();
  });

  it("o mês certo da série de 12", () => {
    const porMes = doBp({ "1.Receita": 0 });
    const linhas = [
      { A: "Mês Calendário", ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`M${i}`, i + 1])) },
      { A: "1.Receita", ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`M${i}`, (i + 1) * 1000])) },
    ];
    const p2 = planoDaDre(new Map([[2026, lerBpAnual(linhas)]]));
    expect(p2(RECEITA_BRUTA, "Jan-26")).toBe(1000);
    expect(p2(RECEITA_BRUTA, "Jul-26")).toBe(7000);
    expect(p2(RECEITA_BRUTA, "Dec-26")).toBe(12000);
    expect(porMes).toBeDefined();
  });
});

describe("rubricasDoPareto", () => {
  it("os sete blocos particionam o EBITDA — nem repetição, nem buraco", () => {
    const blocos = rubricasDoPareto("bloco").map((r) => r.rubrica);
    expect(blocos).toEqual([
      RECEITA_RECORRENTE, "Receita Spot", DEDUCOES, CUSTOS_OP, PESSOAL, ADM, MKT,
    ]);
    expect(new Set(blocos).size).toBe(blocos.length);
  });

  it("cada rubrica fina sabe de que bloco desceu, e nenhuma aparece duas vezes", () => {
    const finas = rubricasDoPareto("rubrica");
    expect(new Set(finas.map((r) => r.rubrica)).size).toBe(finas.length);
    expect(finas.find((r) => r.rubrica === "Benefícios")?.bloco).toBe(PESSOAL);
    expect(finas.find((r) => r.rubrica === "Enterprise")?.natureza).toBe("receita");
  });
});

describe("acimaDoCorte", () => {
  const p = pareto({
    leitor, plano, mes: MES, mesAnterior: ANTERIOR,
    mesesFechados: COLS, detalhe: "bloco",
  });

  it("inclui a rubrica que ATRAVESSA o corte", () => {
    // acumulado: 34,8% · 64,8% · 90,5% · 95,8% · 100%
    expect(acimaDoCorte(p.ofensores, 0.8)).toBe(3);
    expect(acimaDoCorte(p.ofensores, 0.5)).toBe(2);
    expect(acimaDoCorte(p.ofensores, 0.99)).toBe(5);
  });

  it("lista vazia não vira 'um item'", () => {
    expect(acimaDoCorte([], 0.8)).toBe(0);
  });
});

/* ============================================================
 *  YTD — o acumulado do ano na tabela do bloco 2
 * ============================================================ */

describe("mesesDoAno", () => {
  it("recorta a janela no ano do mês em foco", () => {
    const janela = ["Nov-25", "Dec-25", "May-26", "Jun-26", "Jul-26"];
    expect(mesesDoAno(janela, "Jul-26")).toEqual(["May-26", "Jun-26", "Jul-26"]);
  });

  it("para NO mês da reunião — o acumulado não olha para a frente", () => {
    const janela = ["May-26", "Jun-26", "Jul-26"];
    expect(mesesDoAno(janela, "Jun-26")).toEqual(["May-26", "Jun-26"]);
  });

  it("em janeiro sobra o próprio mês, e isso é o YTD certo", () => {
    expect(mesesDoAno(["Jan-26"], "Jan-26")).toEqual(["Jan-26"]);
  });
});

describe("espinhaDre · YTD", () => {
  const YTD = ["May-26", "Jun-26", "Jul-26"];
  const linhaDe = (rubrica: string) =>
    espinhaDre(leitor, plano, MES, ANTERIOR, YTD).find((l) => l.rubrica === rubrica)!;

  it("soma o realizado dos meses da janela", () => {
    // Assinaturas + Enterprise em mai · jun · jul.
    expect(linhaDe(RECEITA_RECORRENTE).ytd).toBe(1_180_000 + 1_215_800 + 1_238_900);
    // Despesa entra como magnitude positiva, mês a mês.
    expect(linhaDe(PESSOAL).ytd).toBe(680_000 + 698_900 + 742_300);
  });

  it("o orçado acumula o plano dos mesmos meses", () => {
    expect(linhaDe(PESSOAL).ytdOrcado).toBe(688_000 * 3);
    expect(linhaDe(RECEITA_RECORRENTE).ytdOrcado).toBe(1_302_000 * 3);
  });

  it("o EBITDA acumula COM SINAL, e o orçado é derivado mês a mês", () => {
    const ebitda = linhaDe(EBITDA);
    expect(ebitda.ytd).toBe(-125_000 - 151_900 - 184_600);
    expect(ebitda.ytdOrcado).toBe(-142_000 * 3);
  });

  it("o módulo da despesa é por mês — dois meses de sinal trocado não se cancelam", () => {
    /* A planilha da diretoria escreve despesa ora negativa, ora positiva. Somar
       antes de tirar o módulo zerava a rubrica no acumulado. */
    const planoOscilante: Plano = (label, col) =>
      label !== PESSOAL ? null : col === "May-26" ? -688_000 : col === "Jun-26" ? 688_000 : -688_000;
    const l = espinhaDre(leitor, planoOscilante, MES, ANTERIOR, YTD)
      .find((x) => x.rubrica === PESSOAL)!;
    expect(l.ytdOrcado).toBe(688_000 * 3);
  });

  it("mês sem plano não zera o acumulado — soma o que existe", () => {
    const planoFurado: Plano = (label, col) => (col === "May-26" ? null : plano(label, col));
    const l = espinhaDre(leitor, planoFurado, MES, ANTERIOR, YTD)
      .find((x) => x.rubrica === PESSOAL)!;
    expect(l.ytdOrcado).toBe(688_000 * 2);
  });

  it("sem BP o acumulado orçado é nulo e o realizado continua de pé", () => {
    const l = espinhaDre(leitor, semPlano, MES, ANTERIOR, YTD).find((x) => x.rubrica === PESSOAL)!;
    expect(l.ytdOrcado).toBeNull();
    expect(l.ytd).toBe(680_000 + 698_900 + 742_300);
  });

  it("o impacto do ano segue a mesma régua do mês", () => {
    // Despesa acima do plano no acumulado: tirou do EBITDA.
    const pessoal = linhaDe(PESSOAL);
    expect(pessoal.impactoYtd).toBe(688_000 * 3 - (680_000 + 698_900 + 742_300));
    expect(pessoal.impactoYtd!).toBeLessThan(0);
    // Receita abaixo do plano no acumulado: também tirou.
    expect(linhaDe(RECEITA_RECORRENTE).impactoYtd!).toBeLessThan(0);
  });
});

/* ============================================================
 *  A barra de atingimento do orçado
 * ============================================================
 * Números reais do acumulado Jan–Jul/26, que é o que a barra mostra hoje.
 */
describe("atingimento", () => {
  /** Como a página chama: o impacto sai da natureza da rubrica. */
  const daReceita = (ytd: number, orc: number) => atingimento(ytd, orc, ytd - orc);
  const daDespesa = (ytd: number, orc: number) => atingimento(ytd, orc, orc - ytd);

  it("despesa 2% acima do plano NÃO fica verde, mesmo mostrando 102%", () => {
    const a = daDespesa(7_400_180, 7_248_501)!;   // SG&A do ano
    expect(Math.round(a.fracao * 100)).toBe(102);
    expect(a.faixa).toBe("amarelo");
  });

  it("despesa abaixo do plano é verde", () => {
    const a = daDespesa(1_689_932, 1_735_469)!;   // Custos operacionais do ano
    expect(Math.round(a.fracao * 100)).toBe(97);
    expect(a.faixa).toBe("verde");
  });

  it("receita quase no plano é amarela; bem abaixo é vermelha", () => {
    expect(daReceita(6_814_375, 6_977_734)!.faixa).toBe("amarelo");   // −2,3%
    expect(daReceita(6_000_000, 6_977_734)!.faixa).toBe("vermelho");  // −14,0%
  });

  it("EBITDA pior que um plano já negativo é vermelho", () => {
    const a = atingimento(-2_275_737, -2_006_236, -2_275_737 - -2_006_236)!;
    expect(Math.round(a.fracao * 100)).toBe(113);   // queimou 13% a mais que o plano
    expect(a.faixa).toBe("vermelho");
  });

  it("bater o plano em cima é verde, e a folga de 2% é dos dois lados", () => {
    expect(daReceita(1_000_000, 1_000_000)!.faixa).toBe("verde");
    expect(daReceita(1_100_000, 1_000_000)!.faixa).toBe("verde");   // superou
    expect(daReceita(985_000, 1_000_000)!.faixa).toBe("verde");     // −1,5%, ruído
    expect(daReceita(975_000, 1_000_000)!.faixa).toBe("amarelo");   // −2,5%
  });

  it("a barra não passa de cheia nem fica negativa", () => {
    expect(daDespesa(2_000_000, 1_000_000)!.preenchimento).toBe(1);
    // Realizado positivo contra orçado negativo: fração negativa, barra vazia.
    const virou = atingimento(400_000, -1_000_000, 400_000 - -1_000_000)!;
    expect(virou.fracao).toBeLessThan(0);
    expect(virou.preenchimento).toBe(0);
    expect(virou.faixa).toBe("verde");   // ficou MELHOR que o plano
  });

  it("sem plano não há barra — e orçado zero não vira divisão por zero", () => {
    expect(atingimento(100, null, null)).toBeNull();
    expect(atingimento(null, 100, null)).toBeNull();
    expect(atingimento(100, 0, 100)).toBeNull();
  });
});

/* ============================================================
 *  Caixa
 * ============================================================ */

const DFC_ROWS = [
  // Na DFC o recebimento entra inteiro em "Entrada de Receita" — o tracker não
  // separa a receita por produto como a DRE separa.
  linha("Entrada de Receita", 1_300_000, 1_350_000, 1_412_100),
  linha("Simples Nacional", -120_000, -125_000, -130_000),
  linha("Equipe Tecnologia", -300_000, -305_000, -342_300),
  linha("Servidor", -90_000, -95_000, -96_400),
  linha("Ocupação & Escritório", -180_000, -178_700, -186_400),
  linha("Campanhas de Mídia Paga", -150_000, -163_300, -214_600),
  linha("(-) Compra de Equipamentos", 0, 0, -74_900),
  /* Uma linha que de fato mora em Financiamento. A antecipação de recebível já
     esteve aqui e foi para as Entradas, onde o tracker a lança — ver
     `demonstracoes-schema.ts`. */
  linha("(+) Novos Empréstimos & Financiamentos", 150_000, 160_000, 176_000),
];

describe("blocoCaixa", () => {
  const caixa = blocoCaixa({
    dfcRows: DFC_ROWS,
    dfcColumns: COLS,
    planoDfc: [
      { chave: "fluxo de caixa operacional", meses: [null, null, null, null, null, null, -212_000, null, null, null, null, null] },
      { chave: "fluxo de caixa livre", meses: [null, null, null, null, null, null, -36_000, null, null, null, null, null] },
    ],
    mes: MES,
    mesesFechados: COLS,
    saldo: 3_412_800,
    saldoEm: "2026-08-04T10:12:00Z",
  });

  it("soma as folhas da DFC — a linha-pai do blob quase nunca está preenchida", () => {
    // 1.412.100 − 130.000 − 342.300 − 96.400 − 186.400 − 214.600
    expect(caixa.fco).toBe(442_400);
    expect(caixa.fci).toBe(-74_900);
    expect(caixa.fcf).toBe(176_000);
    expect(caixa.livre).toBe(442_400 - 74_900 + 176_000);
  });

  it("pega o orçado do mês certo da série de 12 do BP", () => {
    const fcoLinha = caixa.linhas.find((l) => l.rubrica.startsWith("FCO"))!;
    expect(fcoLinha.orcado).toBe(-212_000);
    expect(caixa.livreOrcado).toBe(-36_000);
  });

  it("o saldo é a foto do Omie, com a data — não um fechamento reconstituído", () => {
    expect(caixa.saldo).toBe(3_412_800);
    expect(caixa.saldoEm).toBe("2026-08-04T10:12:00Z");
  });

  it("gerando caixa, o runway não vira número absurdo", () => {
    expect(caixa.runway?.gerandoCaixa).toBe(true);
    expect(caixa.runway?.meses).toBeNull();
    expect(caixa.burn3m).toBeLessThan(0);   // negativo = não queima
  });

  it("a janela do runway para NO mês da reunião", () => {
    const emMaio = blocoCaixa({
      dfcRows: DFC_ROWS, dfcColumns: COLS, planoDfc: [],
      mes: "May-26", mesesFechados: COLS, saldo: 1_000_000, saldoEm: null,
    });
    expect(emMaio.runway?.base).toBe(1);
  });

  it("a linha de cashburn é o fluxo livre sem a captação", () => {
    const cb = caixa.linhas.find((l) => l.rubrica.startsWith("Cashburn"))!;
    expect(cb.realizado).toBe(543_500 - 176_000);
    expect(caixa.cashburn).toBe(cb.realizado);
    // Vem DEPOIS do fluxo livre, como na grade da DFC.
    expect(caixa.linhas.at(-1)).toBe(cb);
    expect(caixa.linhas.at(-2)!.rubrica).toBe("Fluxo livre do mês");
  });

  it("o orçado do cashburn é o do fluxo livre — o BP não orça captação", () => {
    const cb = caixa.linhas.find((l) => l.rubrica.startsWith("Cashburn"))!;
    expect(cb.orcado).toBe(-36_000);
    expect(cb.orcado).toBe(caixa.livreOrcado);
  });
});

/* O caso que motivou trocar a base do runway: o mês do empréstimo. É o Jul/26
   real em escala menor — entrou captação, o fluxo livre virou positivo e o
   caixa queimou do mesmo jeito. */
describe("blocoCaixa · o mês do empréstimo", () => {
  const DFC_CAPTACAO = [
    linha("Entrada de Receita", 1_000_000, 1_000_000, 1_000_000),
    linha("Equipe Tecnologia", -1_200_000, -1_200_000, -1_200_000),
    linha("(+) Novos Empréstimos & Financiamentos", 0, 0, 500_000),
  ];
  const caixa = blocoCaixa({
    dfcRows: DFC_CAPTACAO, dfcColumns: COLS, planoDfc: [],
    mes: MES, mesesFechados: COLS, saldo: 3_600_000, saldoEm: null,
  });

  it("o fluxo livre fica positivo e a queima aparece embaixo dele", () => {
    expect(caixa.livre).toBe(300_000);
    expect(caixa.cashburn).toBe(-200_000);
  });

  it("o runway mede a queima, não a captação", () => {
    // Pelo fluxo livre a média dos 3 meses seria −33,3 mil e o caixa "duraria"
    // 108 meses. Pela queima, são 200 mil por mês e 18 meses de caixa.
    expect(caixa.burn3m).toBe(200_000);
    expect(caixa.runway?.queima).toBe(200_000);
    expect(caixa.runway?.meses).toBeCloseTo(18, 6);
    expect(caixa.runway?.gerandoCaixa).toBe(false);
  });
});

describe("lerDfc", () => {
  it("não empresta o esquema da DRE — 'Investimentos' só existe na DFC", () => {
    const ler = lerDfc(DFC_ROWS, COLS);
    expect(ler("Investimentos", MES)).toBe(-74_900);
    expect(ler("Financiamento", MES)).toBe(176_000);
  });
});

/* ============================================================
 *  Próximo mês
 * ============================================================ */

describe("mesSeguinte", () => {
  it("anda um mês, inclusive na virada do ano", () => {
    expect(mesSeguinte("Jul-26")).toBe("Aug-26");
    expect(mesSeguinte("Dec-26")).toBe("Jan-27");
    expect(mesSeguinte("Conta")).toBeNull();
  });
});

describe("proximoMes", () => {
  const planoAgo: Plano = (label, col) =>
    col !== "Aug-26" ? null
    : label === RECEITA_BRUTA ? 1_618_000
    : label === RL ? 1_471_000
    : label === SGA ? 604_000
    : label === EBITDA ? -96_000
    : null;

  const prox = proximoMes({
    plano: planoAgo,
    ebitdaRealizado: -184_600,
    mes: MES,
    metaClientes: {
      clientes_eop: 1_958,
      perdidos: 39,
      churn_pct: 2.0,
      mrr_recorrente: 715_000,
      // O GG sem linha de ticket é de propósito: é assim que algumas versões da
      // aba vêm, e o ticket orçado tem de sair do próprio bloco.
      portes: [
        { nivel: "P", clientes_eop: 640, mrr: 135_000, ticket: 211 },
        { nivel: "GG", clientes_eop: 240, mrr: 580_000 },
      ],
    },
    carteira: [
      { nivel: "P", clientes: 612, mrr: 128_000, tm: 209 },
      { nivel: "XG", clientes: 221, mrr: 543_000, tm: 2_457 },
    ],
    clientesAtivos: 1_842,
    mrr: 1_238_900,
    ticket: 672,
    churn: { qtd: 38, valor: 26_100, pct: 2.1 },
  });

  it("o gap é quanto o EBITDA precisa melhorar de um mês para o outro", () => {
    expect(prox?.mes).toBe("Aug-26");
    expect(prox?.gap).toBe(-96_000 - -184_600);   // +88.600
  });

  it("novos necessários = ganho líquido MAIS o churn que o próprio plano espera", () => {
    expect(prox?.liquidosNecessarios).toBe(116);
    expect(prox?.churnEsperado).toBe(39);
    expect(prox?.novosNecessarios).toBe(155);
  });

  it("casa o XG do Asaas com o GG do BP — é o mesmo porte com dois nomes", () => {
    const xg = prox?.carteira.find((c) => c.nivel === "XG");
    expect(xg?.clientesOrcado).toBe(240);
    expect(xg?.mrrOrcado).toBe(580_000);
  });

  it("o ticket orçado é o da planilha e, na falta dele, o do próprio bloco", () => {
    expect(prox?.carteira.find((c) => c.nivel === "P")?.ticketOrcado).toBe(211);
    expect(prox?.carteira.find((c) => c.nivel === "XG")?.ticketOrcado)
      .toBeCloseTo(580_000 / 240, 6);
  });

  it("o mix é sobre a carteira informada, e soma 1", () => {
    expect(prox?.carteira.reduce((s, c) => s + c.mix, 0)).toBeCloseTo(1, 8);
  });

  it("o mix orçado é a fatia do porte na carteira DO BP, não na de hoje", () => {
    const xg = prox?.carteira.find((c) => c.nivel === "XG");
    expect(xg?.mixOrcado).toBeCloseTo(240 / (640 + 240), 8);
  });

  it("o total tem alvo próprio: o MRR recorrente do BP e o ticket que ele implica", () => {
    expect(prox?.mrrMeta).toBe(715_000);
    expect(prox?.ticketMeta).toBeCloseTo(715_000 / 1_958, 6);
  });

  it("sem BP e sem snapshot, devolve as metas em null em vez de zero", () => {
    const vazio = proximoMes({ plano: null, ebitdaRealizado: null, mes: MES });
    expect(vazio?.receitaOrcada).toBeNull();
    expect(vazio?.gap).toBeNull();
    expect(vazio?.novosNecessarios).toBeNull();
    expect(vazio?.mrrMeta).toBeNull();
    expect(vazio?.ticketMeta).toBeNull();
    expect(vazio?.carteira).toEqual([]);
  });
});

/* ============================================================
 *  Sinal e edição
 * ============================================================ */

describe("montarSinal", () => {
  const p = pareto({
    leitor, plano, mes: MES, mesAnterior: ANTERIOR,
    mesesFechados: COLS, detalhe: "bloco",
  });
  const sinal = montarSinal({
    mes: MES,
    detalhe: "bloco",
    espinha: espinhaDre(leitor, plano, MES, ANTERIOR),
    pareto: p,
    caixa: blocoCaixa({
      dfcRows: DFC_ROWS, dfcColumns: COLS, planoDfc: [],
      mes: MES, mesesFechados: COLS, saldo: 3_412_800, saldoEm: null,
    }),
    proximo: null,
    justificativas: new Map([[PESSOAL, "Três contratações de setembro foram antecipadas."]]),
    quantos: 3,
  });

  it("manda número FORMATADO — a IA copia, não calcula", () => {
    expect(sinal.fmtEbitda).toBe("-R$ 184,6 k");
    expect(sinal.fmtEbitdaOrcado).toBe("-R$ 142,0 k");
    expect(sinal.fmtGapEbitda).toBe("-R$ 42,6 k");
    expect(sinal.fmtReceita).toBe("R$ 1,49 M");
    expect(sinal.fmtMargem).toBe("-13,6%");
  });

  it("leva só os ofensores do corte, mais os amortecedores, com a justificativa junto", () => {
    const ofensores = sinal.rubricas.filter((r) => r.lado === "ofensor");
    expect(ofensores).toHaveLength(3);
    expect(ofensores[0].rubrica).toBe(RECEITA_RECORRENTE);
    expect(sinal.rubricas.find((r) => r.rubrica === PESSOAL)?.justificativa)
      .toBe("Três contratações de setembro foram antecipadas.");
    expect(sinal.rubricas.some((r) => r.lado === "amortecedor")).toBe(true);
  });

  it("a repetição vai em português, contada pelo código", () => {
    const pessoal = sinal.rubricas.find((r) => r.rubrica === PESSOAL)!;
    expect(pessoal.repeticao).toBe(
      "1 dos 2 meses fechados anteriores também ficaram do lado ruim do plano",
    );
  });
});

describe("aplicarEdicao", () => {
  const gerado: Leitura = {
    veredicto_nivel: "atencao",
    veredicto_titulo: "Recorrência perdeu ritmo",
    veredicto_resumo: "Quatro rubricas explicam o desvio.",
    destaques: [{ nivel: "critico", area: "DRE", titulo: "t", texto: "x" }],
    rubricas: [
      { rubrica: PESSOAL, impacto: "impacto da máquina", acao: "ação da máquina" },
      { rubrica: MKT, impacto: "mkt impacto", acao: "mkt ação" },
    ],
    decisoes: ["a", "b"],
    fecho: "fecho da máquina",
  };

  it("sem edição, vale o que a máquina escreveu", () => {
    expect(aplicarEdicao(gerado, null)).toEqual(gerado);
  });

  it("a reescrita é um PATCH: corrigir uma frase não congela as outras", () => {
    const out = aplicarEdicao(gerado, { veredicto_titulo: "Título do Henrique" });
    expect(out.veredicto_titulo).toBe("Título do Henrique");
    expect(out.veredicto_resumo).toBe("Quatro rubricas explicam o desvio.");
    expect(out.fecho).toBe("fecho da máquina");
  });

  it("em rubricas o merge é por rubrica e campo a campo", () => {
    const out = aplicarEdicao(gerado, {
      rubricas: [{ rubrica: PESSOAL, impacto: "", acao: "Congelar as duas vagas" }],
    });
    const pessoal = out.rubricas.find((r) => r.rubrica === PESSOAL)!;
    expect(pessoal.acao).toBe("Congelar as duas vagas");
    expect(pessoal.impacto).toBe("impacto da máquina");   // não foi apagado
    expect(out.rubricas.find((r) => r.rubrica === MKT)?.acao).toBe("mkt ação");
  });

  it("em destaques o merge é por posição e campo a campo", () => {
    const tres: Leitura = {
      ...gerado,
      destaques: [
        { nivel: "critico", area: "DRE · Receita", titulo: "t1", texto: "x1" },
        { nivel: "atencao", area: "DRE · Pessoal", titulo: "t2", texto: "x2" },
        { nivel: "info", area: "Caixa", titulo: "t3", texto: "x3" },
      ],
    };
    // Só o texto do segundo card foi reescrito.
    const out = aplicarEdicao(tres, {
      destaques: [
        { nivel: "critico", area: "", titulo: "", texto: "" },
        { nivel: "atencao", area: "", titulo: "", texto: "reescrito à mão" },
      ],
    });
    expect(out.destaques).toHaveLength(3);
    expect(out.destaques[1].texto).toBe("reescrito à mão");
    expect(out.destaques[1].titulo).toBe("t2");        // não foi apagado
    expect(out.destaques[0].texto).toBe("x1");         // o vizinho não congelou
    expect(out.destaques[2].texto).toBe("x3");
  });

  /* O "por que aconteceu" não é escrito pela IA — ele vem do comentário da
     célula da DRE, e o campo só existe aqui quando alguém trocou a frase. */
  it("o 'por que' reescrito à mão sobrevive ao merge, sem tocar no resto", () => {
    const out = aplicarEdicao(gerado, {
      rubricas: [{ rubrica: PESSOAL, impacto: "", acao: "", porque: "46K atrasados no Datadog" }],
    });
    const pessoal = out.rubricas.find((r) => r.rubrica === PESSOAL)!;
    expect(pessoal.porque).toBe("46K atrasados no Datadog");
    expect(pessoal.impacto).toBe("impacto da máquina");
    expect(pessoal.acao).toBe("ação da máquina");
  });

  it("'por que' vazio devolve o comentário da DRE — quem lê é a tela, e ela cai no fallback", () => {
    const out = aplicarEdicao(gerado, {
      rubricas: [{ rubrica: PESSOAL, impacto: "", acao: "", porque: "" }],
    });
    expect(out.rubricas.find((r) => r.rubrica === PESSOAL)?.porque).toBe("");
  });

  it("rubrica que só existe na edição entra na lista", () => {
    const out = aplicarEdicao(gerado, {
      rubricas: [{ rubrica: ADM, impacto: "escrito à mão", acao: "manter" }],
    });
    expect(out.rubricas).toHaveLength(3);
    expect(out.rubricas.find((r) => r.rubrica === ADM)?.impacto).toBe("escrito à mão");
  });

  it("sem nada gerado ainda, a edição sozinha já vale", () => {
    const out = aplicarEdicao(null, { decisoes: ["Congelar vagas"] });
    expect(out.decisoes).toEqual(["Congelar vagas"]);
    expect(out.veredicto_titulo).toBe("");
  });
});

/* ============================================================
 *  Jun/26 de verdade
 * ============================================================
 * Números tirados da base de produção: o blob da DRE e o BP 2026, no último mês
 * fechado. O fixture sintético acima prova as regras uma a uma; este prova a
 * CADEIA inteira contra dado real — soma dos filhos, descoberta do sinal do mês,
 * de-para do BP e fechamento do Pareto. É o teste que quebra quando alguém mexe
 * numa peça achando que as outras não dependem dela.
 *
 * Jun/26 BATEU O PLANO (EBITDA -364,7 mil contra -444,8 mil orçado). O caso
 * "melhor que o orçado" precisa estar coberto justamente porque não é o caso do
 * print de onde a tela nasceu.
 */
describe("Jun/26 · dado de produção", () => {
  const COLS_REAIS = ["Jun-26"];
  const r = (conta: string, jun: number | string) => ({ Conta: conta, "Jun-26": jun });

  const DRE_REAL = [
    // Receita Bruta = Recorrente (Assinaturas + Enterprise) + Spot
    r("Receita de Assinaturas", 1_080_613), r("Enterprise", 52_588),
    r("Receita com Materiais", 4_996), r("Receita Markup", 17_977), r("Serviços para Clientes", ""),
    // Deduções: a DRE só tem quatro das sete
    r("PIS", -7_515), r("COFINS", -34_685), r("ISS", -23_123), r("Devoluções", -25_305),
    // Custos operacionais
    r("Equipe Operacional", -73_610), r("Premiações Operacionais", -8_340),
    r("Meios de Pagamento", -21_063), r("CMV Materiais", -5_780), r("Servidor", -105_077),
    r("Softwares Operacionais", -47_105), r("Outros Custos", -1_139),
    // Pessoal
    r("Equipe Administrativa", -110_392), r("Equipe Marketing", -28_150),
    r("Equipe Comercial", -163_391), r("Equipe Onboarding", -53_768),
    r("Equipe Tecnologia", -127_850), r("Benefícios", -56_210), r("Encargos Sociais", -1_519),
    // Administrativas
    r("Ocupação & Escritório", -62_005), r("Assessorias & Consultorias", -32_123),
    r("Softwares Administrativos", -6_177), r("Viagens & Transportes Adm", -796),
    r("Outras despesas Adm", -13_950),
    // Marketing & Vendas
    r("Campanhas de Mídia Paga", -151_089), r("Campanhas de Outros Canais", -13_000),
    r("Comissões Consultores / Parceiros", -5_278), r("Premiações", -113_665), r("MGM", -4_000),
    r("Softwares Marketing & Vendas", -38_282), r("Agências & Consultorias", ""),
    r("Viagens & Transportes Mkt", -47_188), r("Eventos e Feiras", -139_035),
    r("Outras despesas Mkt", -256),
    // Totais gravados pelo tracker
    r("Receita Bruta", 1_156_175), r("Receita Recorrente", 1_133_201), r("Receita Spot", 22_973),
    r("(-) Deduções da receita", -90_629), r("Receita Líquida", 1_065_546),
    r("(-) Custos Operacionais", -262_115), r("Margem de contribuição", 803_431),
    r("(-) SG&A", -1_168_122), r("Pessoal", -541_280),
    r("Despesas Administrativas", -115_050), r("Despesas Marketing & Vendas", -511_792),
    r("EBITDA", -364_691),
  ];

  /** A coluna de junho do BP 2026, com os rótulos da diretoria. */
  const BP_JUN: Record<string, number> = {
    "1.Receita": 1_144_818,
    "1.1.Receita Recorrente Assinaturas": 1_131_196,
    "1.2.Receitas Spot": 13_622,
    "2.Deduções da Receita": -87_306.137,
    "Receita Líquida": 1_057_511.86,
    "3.Custo Operacional": -283_304.186,
    "Margem de contribuição": 774_207.68,
    "(-) SG&A": -1_218_974.4994,
    "4.Pessoal": -592_910,
    "5.Despesas Administrativas": -114_993.73,
    "6.Despesas Marketing & Vendas": -511_070.77,
    EBITDA: -444_766.822,
  };

  const bp = new Map([[2026, lerBpAnual([
    { A: "Mês Calendário", ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`M${i}`, i + 1])) },
    ...Object.entries(BP_JUN).map(([rotulo, v]) => ({
      A: rotulo,
      // Só junho preenchido: é a única coluna que este teste confere.
      ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`M${i}`, i === 5 ? v : null])),
    })),
  ])]]);

  const leitorReal = lerDre(DRE_REAL, COLS_REAIS);
  const planoReal = planoDaDre(bp);
  const MES_REAL = "Jun-26";

  it("o pai é a soma dos filhos, e bate com o total que o tracker gravou", () => {
    expect(leitorReal.receita(RECEITA_BRUTA, MES_REAL)).toBe(1_156_174);   // gravado: 1.156.175
    expect(leitorReal.receita(RECEITA_RECORRENTE, MES_REAL)).toBe(1_133_201);
    expect(leitorReal.custo(PESSOAL, MES_REAL)).toBe(541_280);
    expect(leitorReal.custo(CUSTOS_OP, MES_REAL)).toBe(262_114);           // gravado: 262.115
    expect(leitorReal.custo(MKT, MES_REAL)).toBe(511_793);                 // gravado: 511.792
  });

  it("o plano sai do BP pelos rótulos da diretoria", () => {
    expect(planoReal(RECEITA_RECORRENTE, MES_REAL)).toBe(1_131_196);
    expect(planoReal(CUSTOS_OP, MES_REAL)).toBeCloseTo(-283_304.186, 3);
    expect(planoReal(EBITDA, MES_REAL)).toBeCloseTo(-444_766.822, 3);
  });

  it("junho ficou ACIMA do plano — e o Pareto sabe disso", () => {
    const p = pareto({
      leitor: leitorReal, plano: planoReal, mes: MES_REAL, mesAnterior: null,
      mesesFechados: COLS_REAIS, detalhe: "bloco",
    });
    expect(p.gapEbitda).toBeCloseTo(80_075.82, 2);
    expect(p.favoravel).toBeGreaterThan(p.desfavoravel);
    // Pessoal segurou o mês: R$ 51,6 mil abaixo do orçado.
    expect(p.amortecedores[0].rubrica).toBe(PESSOAL);
    expect(p.amortecedores[0].impacto).toBeCloseTo(51_630, 0);
    // O que estourou foi pouco, e Deduções está entre eles.
    expect(p.ofensores.map((o) => o.rubrica)).toContain(DEDUCOES);
  });

  it("a decomposição FECHA: a soma dos sete blocos é o gap do EBITDA", () => {
    const p = pareto({
      leitor: leitorReal, plano: planoReal, mes: MES_REAL, mesAnterior: null,
      mesesFechados: COLS_REAIS, detalhe: "bloco",
    });
    // Sobra só o arredondamento do próprio blob (os totais do tracker divergem
    // das folhas em R$ 1 aqui e ali). Acima disso é rubrica fora do esquema.
    expect(Math.abs(p.residuo ?? 0)).toBeLessThan(5);
    expect(p.semPlano).toEqual([]);
  });

  it("a cascata encadeia da receita bruta ao EBITDA gravado", () => {
    const d = cascata(leitorReal, planoReal, MES_REAL);
    const fim = d.slice(0, -1).reduce((s, x) => s + x.valor, 0);
    // A cascata soma -364.692 e a DRE gravou -364.691: um real de arredondamento,
    // que é exatamente o que o `residuo` do Pareto publica.
    expect(Math.abs(fim - (d[d.length - 1].valor))).toBeLessThan(5);
  });
});

describe("sinalMudou", () => {
  const atual = { fmtReceita: "R$ 1,49 M", fmtEbitda: "-R$ 184,6 k", fmtGapEbitda: "-R$ 42,6 k", fmtDesfavoravel: "R$ 171,7 k" } as Sinal;

  it("sem sinal gravado, nada envelheceu", () => {
    expect(sinalMudou(null, atual)).toBe(false);
  });

  it("mesmos números, mesmo texto", () => {
    expect(sinalMudou({ ...atual }, atual)).toBe(false);
  });

  it("o EBITDA mudou depois do texto — a tela precisa dizer", () => {
    expect(sinalMudou({ ...atual, fmtEbitda: "-R$ 160,0 k" }, atual)).toBe(true);
  });

  it("campo que o sinal antigo nem tinha não conta como mudança", () => {
    expect(sinalMudou({ fmtEbitda: "-R$ 184,6 k" }, atual)).toBe(false);
  });
});
