import { describe, it, expect } from "vitest";
import {
  estruturar, mesesFechados, montarColuna, parseColuna, toNum, valorDe,
} from "../../supabase/functions/_shared/assistente/dre";
import {
  fecha, panoramaDoMes, rubricaDoMes, variacaoEbitda,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSupabase(porTabela: Record<string, unknown>): { from: (t: string) => any } {
  return { from: (t: string) => encadeador(porTabela[t] ?? { data: null, error: null }) };
}

/** DRE coerente: Receita − Custos − SG&A reproduz o EBITDA nos dois meses. */
const DRE_COERENTE = {
  data: {
    updated_at: "2026-08-01T00:00:00Z",
    dados: {
      columns: ["Conta", "Jun-26", "Jul-26"],
      rows: [
        { Conta: "Receita Líquida", "Jun-26": 1000, "Jul-26": 900 },
        { Conta: "(-) Custos Operacionais", "Jun-26": 300, "Jul-26": 300 },
        { Conta: "(-) SG&A", "Jun-26": 400, "Jul-26": 500 },
        { Conta: "EBITDA", "Jun-26": 300, "Jul-26": 100 },
        { Conta: "Equipe Comercial", "Jun-26": 100, "Jul-26": 200 },
        { Conta: "% Margem EBITDA", "Jun-26": 30, "Jul-26": 11 },
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
    expect(d.valores.has("% Margem EBITDA")).toBe(false);
    expect(valorDe(d, "EBITDA", { ano: 2026, mes: 7 })).toBe(100);
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
            { Conta: "(-) Custos Operacionais", "Jun-26": 300, "Jul-26": 300 },
            { Conta: "(-) SG&A", "Jun-26": 400, "Jul-26": 500 },
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
            { Conta: "(-) Custos Operacionais", "Jun-26": -300, "Jul-26": -300 },
            { Conta: "(-) SG&A", "Jun-26": -400, "Jul-26": -500 },
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
});
