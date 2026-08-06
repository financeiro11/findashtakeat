import { describe, it, expect } from "vitest";
import {
  estruturar, mesesFechados, montarColuna, parseColuna, toNum, valorDe, valorDoNo,
} from "../../supabase/functions/_shared/assistente/dre";
import { acharNo } from "../../supabase/functions/_shared/assistente/schema-dre";
import {
  fecha, lancamentosDaRubrica, panoramaDoMes, rubricaDoMes, variacaoEbitda,
} from "../../supabase/functions/_shared/assistente/consultas";

// ---------------------------------------------------------------------------
// Mock mínimo do cliente Supabase.
//
// O código de consulta usa duas formas: `.select().eq().eq().maybeSingle()` e
// `.select()` aguardado direto. Por isso o encadeador é thenable além de ter maybeSingle.
// ---------------------------------------------------------------------------
function encadeador(resultado: unknown) {
  const obj: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "order", "limit"]) obj[m] = () => obj;
  obj.maybeSingle = async () => resultado;
  obj.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(resultado).then(ok, err);
  return obj;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeSupabase(
  porTabela: Record<string, unknown>,
  rpc?: unknown,
): { from: (t: string) => any; rpc: (f: string, p: Record<string, unknown>) => any } {
  return {
    from: (t: string) => encadeador(porTabela[t] ?? { data: null, error: null }),
    rpc: async () => rpc ?? { data: [], error: null },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * DRE coerente: Receita − Custos − SG&A reproduz o EBITDA nos dois meses.
 *
 * Os valores vivem nas FOLHAS, não nos blocos: "(-) Custos Operacionais" e "(-) SG&A" têm
 * filhos na árvore e são calculados somando-os. Um valor gravado no pai seria ignorado —
 * é exatamente o bug que o Hub já corrigiu nas telas ("ler o pai do blob era o bug").
 *
 *   Custos  = Equipe Operacional                              = 300 / 300
 *   SG&A    = Equipe Administrativa + Equipe Comercial        = 400 / 500
 *   EBITDA  = 1000 − 300 − 400 = 300     |    900 − 300 − 500 = 100
 */
const DRE_COERENTE = {
  data: {
    updated_at: "2026-08-01T00:00:00Z",
    dados: {
      columns: ["Conta", "Jun-26", "Jul-26"],
      rows: [
        { Conta: "Receita Líquida", "Jun-26": 1000, "Jul-26": 900 },
        { Conta: "Equipe Operacional", "Jun-26": 300, "Jul-26": 300 },
        { Conta: "Equipe Administrativa", "Jun-26": 300, "Jul-26": 300 },
        { Conta: "Equipe Comercial", "Jun-26": 100, "Jul-26": 200 },
        { Conta: "EBITDA", "Jun-26": 300, "Jul-26": 100 },
        { Conta: "% Margem EBITDA", "Jun-26": 30, "Jul-26": 11 },
        // Valor gravado no PAI, propositalmente errado: tem que ser ignorado em favor
        // da soma dos filhos. Se voltar a ser lido, os testes de variação quebram.
        { Conta: "(-) SG&A", "Jun-26": 99999, "Jul-26": 99999 },
      ],
    },
  },
  error: null,
};

const TRAVAS_DOIS_MESES = { data: [{ col_key: "Jun-26" }, { col_key: "Jul-26" }], error: null };

describe("dre — parsing do blob", () => {
  it("trata parênteses como negativo (notação contábil)", () => {
    // Se isto quebrar, despesas inteiras entram com o sinal invertido.
    expect(toNum("(1.234,56)")).toBe(-1234.56);
    expect(toNum("1.234,56")).toBe(1234.56);
    expect(toNum("R$ 1.234,56")).toBe(1234.56);
  });

  it("devolve null para célula vazia, em vez de zero", () => {
    // Zero é um valor; ausência não é. Confundir os dois inventaria dado.
    expect(toNum("")).toBeNull();
    expect(toNum("-")).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum(0)).toBe(0);
  });

  it("converte chave de mês nos dois sentidos", () => {
    expect(parseColuna("Apr-26")).toEqual({ ano: 2026, mes: 4 });
    expect(montarColuna({ ano: 2026, mes: 4 })).toBe("Apr-26");
    expect(parseColuna("Conta")).toBeNull();
  });

  it("descarta linhas de percentual, que são derivadas", () => {
    const d = estruturar(DRE_COERENTE.data.dados);
    expect(d.valores.has("% margem ebitda")).toBe(false);
    expect(valorDe(d, "EBITDA", { ano: 2026, mes: 7 })).toBe(100);
  });

  it("soma a mesma rubrica escrita em duas linhas", () => {
    // Acontece de verdade: uma linha com a grafia do tracker e outra com a do DE_PARA
    // do Omie. Sobrescrever (o comportamento antigo) subestimava a rubrica em silêncio.
    const d = estruturar({
      columns: ["Conta", "Jul-26"],
      rows: [
        { Conta: "Equipe Comercial", "Jul-26": 100 },
        { Conta: "equipe comercial", "Jul-26": 50 },
      ],
    });
    expect(valorDe(d, "Equipe Comercial", { ano: 2026, mes: 7 })).toBe(150);
  });

  it("soma os filhos em vez de ler o valor gravado no pai", () => {
    // O blob traz "(-) SG&A" = 99999, que está desatualizado; o certo é
    // Equipe Administrativa (300) + Equipe Comercial (200) = 500.
    const d = estruturar(DRE_COERENTE.data.dados);
    const sga = acharNo("(-) SG&A")!;
    expect(valorDoNo(d, sga, { ano: 2026, mes: 7 })).toBe(500);
    expect(valorDe(d, "(-) SG&A", { ano: 2026, mes: 7 })).toBe(99999); // leitura crua
  });

  it("devolve null quando nenhuma folha do nó tem valor", () => {
    // Ausência não é zero: um bloco sem nenhum filho preenchido não vale R$ 0,00.
    const d = estruturar({ columns: ["Conta", "Jul-26"], rows: [{ Conta: "EBITDA", "Jul-26": 10 }] });
    expect(valorDoNo(d, acharNo("(-) Custos Operacionais")!, { ano: 2026, mes: 7 })).toBeNull();
  });

  it("considera fechado apenas o mês travado", () => {
    const d = estruturar(DRE_COERENTE.data.dados);
    expect(mesesFechados(d, ["Jun-26"])).toEqual([{ ano: 2026, mes: 6 }]);
    expect(mesesFechados(d, [])).toEqual([]);
  });
});

describe("fecha — conferência de soma", () => {
  it("aceita diferença de arredondamento", () => {
    expect(fecha([100.004, 200], 300)).toBe(true);
  });

  it("rejeita rubrica faltando", () => {
    expect(fecha([100, 200], 500)).toBe(false);
  });
});

describe("variacaoEbitda", () => {
  it("decompõe a variação quando as somas fecham", async () => {
    const r = await variacaoEbitda(fakeSupabase({
      demonstracoes_contabeis: DRE_COERENTE,
      demonstracoes_mes_trancado: TRAVAS_DOIS_MESES,
    }));

    expect(r.ok).toBe(true);
    const variacao = r.numeros.find((n) => n.rotulo === "Variação");
    expect(variacao?.valor).toBe(-200); // 100 − 300

    // A rubrica que subiu tem que aparecer com efeito NEGATIVO sobre o EBITDA.
    const comercial = r.numeros.find((n) => n.rotulo.includes("Equipe Comercial"));
    expect(comercial?.valor).toBe(-100);

    // O bloco entregue ao modelo precisa carregar o limite do dado.
    expect(r.paraModelo).toContain("LIMITE DESTES DADOS");
  });

  it("recusa comparar quando só há um mês fechado", async () => {
    const r = await variacaoEbitda(fakeSupabase({
      demonstracoes_contabeis: DRE_COERENTE,
      demonstracoes_mes_trancado: { data: [{ col_key: "Jul-26" }], error: null },
    }));

    expect(r.ok).toBe(false);
    expect(r.numeros).toHaveLength(0);
    expect(r.avisos.join(" ")).toMatch(/dois meses travados/i);
  });

  it("recusa decompor quando os blocos não reproduzem o EBITDA", async () => {
    // EBITDA salvo não corresponde a Receita − Custos − SG&A em nenhuma convenção de
    // sinal: sintoma de rubrica renomeada ou faltando. A resposta certa é não responder.
    const incoerente = {
      data: {
        updated_at: null,
        dados: {
          columns: ["Conta", "Jun-26", "Jul-26"],
          rows: [
            { Conta: "Receita Líquida", "Jun-26": 1000, "Jul-26": 900 },
            { Conta: "Equipe Operacional", "Jun-26": 300, "Jul-26": 300 },
            { Conta: "Equipe Administrativa", "Jun-26": 400, "Jul-26": 500 },
            { Conta: "EBITDA", "Jun-26": 999, "Jul-26": 777 },
          ],
        },
      },
      error: null,
    };

    const r = await variacaoEbitda(fakeSupabase({
      demonstracoes_contabeis: incoerente,
      demonstracoes_mes_trancado: TRAVAS_DOIS_MESES,
    }));

    expect(r.ok).toBe(false);
    expect(r.numeros).toHaveLength(0);
    expect(r.avisos.join(" ")).toMatch(/sinal/i);
  });

  it("entende despesas gravadas já com sinal negativo", async () => {
    // Mesma empresa, outra convenção de gravação: custos e SG&A negativos.
    const negativos = {
      data: {
        updated_at: null,
        dados: {
          columns: ["Conta", "Jun-26", "Jul-26"],
          rows: [
            { Conta: "Receita Líquida", "Jun-26": 1000, "Jul-26": 900 },
            { Conta: "Equipe Operacional", "Jun-26": -300, "Jul-26": -300 },
            { Conta: "Equipe Administrativa", "Jun-26": -300, "Jul-26": -300 },
            { Conta: "Equipe Comercial", "Jun-26": -100, "Jul-26": -200 },
            { Conta: "EBITDA", "Jun-26": 300, "Jul-26": 100 },
          ],
        },
      },
      error: null,
    };

    const r = await variacaoEbitda(fakeSupabase({
      demonstracoes_contabeis: negativos,
      demonstracoes_mes_trancado: TRAVAS_DOIS_MESES,
    }));

    expect(r.ok).toBe(true);
    expect(r.numeros.find((n) => n.rotulo === "Variação")?.valor).toBe(-200);
  });

  it("não inventa resposta quando o DRE não existe", async () => {
    const r = await variacaoEbitda(fakeSupabase({
      demonstracoes_contabeis: { data: null, error: null },
      demonstracoes_mes_trancado: { data: [], error: null },
    }));

    expect(r.ok).toBe(false);
    expect(r.numeros).toHaveLength(0);
  });
});

describe("panoramaDoMes", () => {
  const fonte = () => fakeSupabase({
    demonstracoes_contabeis: DRE_COERENTE,
    demonstracoes_mes_trancado: TRAVAS_DOIS_MESES,
  });

  it("recalcula a margem em vez de ler a linha de % salva", async () => {
    const r = await panoramaDoMes(fonte(), { ano: 2026, mes: 7 });
    expect(r.ok).toBe(true);

    // O blob traz "% Margem EBITDA: 11" para Jul; o correto é 100/900 = 11,11%.
    const margem = r.numeros.find((n) => n.rotulo === "Margem EBITDA");
    expect(margem?.valor).toBeCloseTo(11.11, 2);
    expect(margem?.fonte).toContain("calculada");
  });

  it("avisa quando o mês pedido ainda está aberto", async () => {
    // Ago-26 não existe no blob nem nas travas.
    const r = await panoramaDoMes(fakeSupabase({
      demonstracoes_contabeis: DRE_COERENTE,
      demonstracoes_mes_trancado: { data: [{ col_key: "Jun-26" }], error: null },
    }), { ano: 2026, mes: 7 });

    expect(r.avisos.join(" ")).toMatch(/não está fechado/i);
  });

  it("usa o último mês fechado quando nenhum é pedido", async () => {
    const r = await panoramaDoMes(fonte(), null);
    expect(r.ok).toBe(true);
    expect(r.numeros[0].competencia).toBe("07/2026");
  });
});

describe("rubricaDoMes", () => {
  const fonte = () => fakeSupabase({
    demonstracoes_contabeis: DRE_COERENTE,
    demonstracoes_mes_trancado: TRAVAS_DOIS_MESES,
  });

  it("encontra a rubrica sem acento e sem caixa exata", async () => {
    const r = await rubricaDoMes(fonte(), "equipe comercial", { ano: 2026, mes: 7 });
    expect(r.ok).toBe(true);
    expect(r.numeros[0].rotulo).toBe("Equipe Comercial");
    expect(r.numeros[0].valor).toBe(200);
  });

  it("casa 'margem de contribuicao' com a rubrica acentuada", async () => {
    const dre = {
      data: {
        updated_at: null,
        dados: {
          columns: ["Conta", "Jul-26"],
          rows: [{ Conta: "Margem de contribuição", "Jul-26": 600 }],
        },
      },
      error: null,
    };
    const r = await rubricaDoMes(fakeSupabase({
      demonstracoes_contabeis: dre,
      demonstracoes_mes_trancado: { data: [{ col_key: "Jul-26" }], error: null },
    }), "margem de contribuicao", null);

    expect(r.ok).toBe(true);
    expect(r.numeros[0].valor).toBe(600);
  });

  it("traz a variação contra o mês fechado anterior", async () => {
    const r = await rubricaDoMes(fonte(), "Equipe Comercial", { ano: 2026, mes: 7 });
    expect(r.numeros.find((n) => n.rotulo === "Variação")?.valor).toBe(100); // 200 − 100
  });

  it("diz que não achou, em vez de chutar uma rubrica parecida", async () => {
    const r = await rubricaDoMes(fonte(), "gastos com cafezinho", null);
    expect(r.ok).toBe(false);
    expect(r.numeros).toHaveLength(0);
    expect(r.avisos.join(" ")).toMatch(/não encontrei/i);
  });

  it("soma os filhos ao pedirem um bloco, ignorando o valor do pai", async () => {
    // O blob grava "(-) SG&A" = 99999; o certo é 300 + 200 = 500.
    const r = await rubricaDoMes(fonte(), "SG&A", { ano: 2026, mes: 7 });
    expect(r.ok).toBe(true);
    expect(r.numeros[0].valor).toBe(500);
  });
});

describe("lancamentosDaRubrica", () => {
  const LANCAMENTOS = {
    data: [
      { data: "2026-07-03", contraparte: "Fulano Consultoria", categoria_descricao: "Comissão", valor: 120, status: "PAGO" },
      { data: "2026-07-10", contraparte: "Fulano Consultoria", categoria_descricao: "Comissão", valor: 50, status: "PAGO" },
      { data: "2026-07-20", contraparte: "Beltrano ME", categoria_descricao: "Comissão", valor: 30, status: "PAGO" },
    ],
    error: null,
  };

  const fonte = (rpc: unknown = LANCAMENTOS) => fakeSupabase({
    demonstracoes_contabeis: DRE_COERENTE,
    demonstracoes_mes_trancado: TRAVAS_DOIS_MESES,
  }, rpc);

  it("agrupa por contraparte, somando os lançamentos de cada uma", async () => {
    const r = await lancamentosDaRubrica(fonte(), "Equipe Comercial", { ano: 2026, mes: 7 });
    expect(r.ok).toBe(true);
    expect(r.numeros.find((n) => n.rotulo === "Fulano Consultoria")?.valor).toBe(170);
    expect(r.numeros.find((n) => n.rotulo === "Beltrano ME")?.valor).toBe(30);
  });

  it("avisa quando os lançamentos não fecham com a célula do DRE", async () => {
    // Somam 200 e a célula de Equipe Comercial em Jul-26 é 200 — coerente. Aqui,
    // trocando um valor, a divergência tem que aparecer em vez de passar batida.
    const divergente = {
      data: [{ data: "2026-07-03", contraparte: "X", categoria_descricao: "Y", valor: 999, status: "PAGO" }],
      error: null,
    };
    const r = await lancamentosDaRubrica(fonte(divergente), "Equipe Comercial", { ano: 2026, mes: 7 });
    expect(r.avisos.join(" ")).toMatch(/célula do DRE/i);
  });

  it("recusa rubrica que é soma de outras, e sugere as filhas", async () => {
    // "(-) SG&A" não tem lançamento próprio — o detalhe está nas folhas.
    const r = await lancamentosDaRubrica(fonte(), "SG&A", { ano: 2026, mes: 7 });
    expect(r.ok).toBe(false);
    expect(r.avisos.join(" ")).toMatch(/Pessoal/);
  });

  it("não inventa nada quando não há lançamento", async () => {
    const r = await lancamentosDaRubrica(fonte({ data: [], error: null }), "Equipe Comercial", null);
    expect(r.ok).toBe(false);
    expect(r.numeros).toHaveLength(0);
  });
});
