import { describe, expect, it } from "vitest";
import {
  baseDoTipo, chaveDoMes, lerAlvoDaUrl, limparAlvoDaUrl, linkCelula, linkPlanoContas, mesDaChave, tipoDaBase,
} from "./linksPlanoContas";
import { leitorDaDemonstracao, montarConferencia, resumirSaude, type SaudeDePara } from "./conferenciaDemonstracao";
import type { CategoriaPlano, CelulaMensal } from "./planoContas";

describe("mês da demonstração", () => {
  it("vira chave em INGLÊS — 'Ago-26' devolve vazio nas RPCs", () => {
    expect(chaveDoMes("2026-08")).toBe("Aug-26");
    expect(chaveDoMes("2026-02")).toBe("Feb-26");
    expect(chaveDoMes("Sep-26")).toBe("Sep-26");
  });

  it("volta da chave, aceitando o português por engano", () => {
    expect(mesDaChave("Aug-26")).toBe("2026-08");
    expect(mesDaChave("Ago-26")).toBe("2026-08");
    expect(mesDaChave("Xyz-26")).toBeNull();
  });

  it("DRE é competência, DFC é caixa", () => {
    expect(baseDoTipo("dre")).toBe("competencia");
    expect(tipoDaBase("caixa")).toBe("dfc");
  });
});

describe("links", () => {
  it("a célula leva rubrica, mês em inglês e as categorias", () => {
    const url = linkCelula({ tipo: "dre", rubrica: "Viagens & Transportes Mkt", mes: "2026-08", categorias: ["2.02.98", "2.11.96"] });
    const [rota, q] = url.split("?");
    expect(rota).toBe("/demonstracoes/dre");
    const p = new URLSearchParams(q);
    expect(p.get("rubrica")).toBe("Viagens & Transportes Mkt");
    expect(p.get("mes")).toBe("Aug-26");
    expect(p.get("categoria")).toBe("2.02.98,2.11.96");
  });

  it("o plano de contas só leva o que foi pedido", () => {
    expect(linkPlanoContas({ categoria: "2.04.07", base: "caixa" })).toBe("/governanca/plano-de-contas?categoria=2.04.07&base=caixa");
    expect(linkPlanoContas({})).toBe("/governanca/plano-de-contas");
  });

  it("ida e volta: o que a DRE lê é o que o plano de contas escreveu", () => {
    const url = linkCelula({ tipo: "dfc", rubrica: "Servidor", mes: "Jul-26", categorias: ["2.01.99"] });
    const alvo = lerAlvoDaUrl(new URLSearchParams(url.split("?")[1]));
    expect(alvo).toEqual({ rubrica: "Servidor", mes: "Jul-26", categorias: ["2.01.99"] });
  });

  it("link incompleto não abre nada, e o mês em português é corrigido", () => {
    expect(lerAlvoDaUrl(new URLSearchParams("rubrica=Servidor"))).toBeNull();
    expect(lerAlvoDaUrl(new URLSearchParams("rubrica=Servidor&mes=Ago-26"))?.mes).toBe("Aug-26");
  });

  it("limpar tira só o pedido de célula", () => {
    const p = limparAlvoDaUrl(new URLSearchParams("rubrica=X&mes=Aug-26&categoria=1&outro=2"));
    expect(p.toString()).toBe("outro=2");
  });
});

const cat = (codigo: string, rubrica_dre: string | null, extra: Partial<CategoriaPlano> = {}): CategoriaPlano => ({
  codigo, descricao: codigo, superior: null, totalizadora: false, inativa: false, despesa: true, receita: false,
  rubrica_dre, rubrica_dfc: null, regra_nota: null, folha: false, usos: 1, ultimo_uso: null, ...extra,
});

describe("conferência Omie × demonstração", () => {
  // Blob de mentira: "Servidor" é folha da DRE; "(-) Custos Operacionais" é pai e o
  // blob guarda um número velho para ele, que a leitura NÃO pode usar.
  const rows = [
    { Conta: "Servidor", "Jul-26": -1000, "Aug-26": -1200 },
    { Conta: "Softwares Operacionais", "Jul-26": -500, "Aug-26": -900 },
    { Conta: "(-) Custos Operacionais", "Jul-26": -1, "Aug-26": -1 },
    { Conta: "PIS", "Jul-26": -300, "Aug-26": null },
  ];
  const ler = leitorDaDemonstracao(rows, ["Jul-26", "Aug-26"], "dre");

  it("lê a rubrica como a tela: o pai soma os filhos, não o blob velho", () => {
    expect(ler("Servidor", "Aug-26")).toBe(-1200);
    const filhos = ler("(-) Custos Operacionais", "Jul-26");
    expect(filhos).not.toBe(-1);
    expect(filhos).toBe(-1500);
  });

  it("classifica: bate, digitado, travado e o que diverge sem explicação", () => {
    const categorias = [cat("2.01.99", "Servidor"), cat("2.07.01", "Softwares Operacionais"), cat("2.06.03", "PIS"), cat("2.10.96", null)];
    const mensal: CelulaMensal[] = [
      ["2.01.99", "2026-07", -1000, 3, 1],   // bate
      ["2.01.99", "2026-08", -1200.4, 3, 1], // bate (dentro de R$ 1)
      ["2.07.01", "2026-07", -800, 5, 2],    // diverge, mas julho está travado
      ["2.07.01", "2026-08", -700, 5, 2],    // diverge sem explicação
      ["2.06.03", "2026-07", -100, 1, 1],    // valor digitado
      ["2.10.96", "2026-08", -9999, 1, 1],   // fora do DE-PARA: não entra
    ];
    const c = montarConferencia({
      tipo: "dre", categorias, mensal, meses: ["2026-07", "2026-08"], lerDemonstracao: ler,
      travados: new Set(["Jul-26"]), manuais: new Set(["pis|Jul-26"]),
    });
    const sit = Object.fromEntries(c.linhas.map((l) => [l.rubrica, l.celulas.map((x) => x.situacao)]));
    expect(sit).toEqual({
      "Softwares Operacionais": ["travado", "diverge"],
      Servidor: ["bate", "bate"],
      PIS: ["manual", "bate"],
    });
    expect(c.linhas[0].rubrica).toBe("Softwares Operacionais"); // a que diverge sobe
    expect(c.linhas[0].valorDivergente).toBe(200);
    expect(c.resumo).toMatchObject({ bate: 3, manual: 1, travado: 1, diverge: 1, valorDivergente: 200 });
  });

  it("célula vazia na demonstração com Omie zerado bate; com valor no Omie, diverge", () => {
    const c = montarConferencia({
      tipo: "dre",
      categorias: [cat("2.06.03", "PIS")],
      mensal: [["2.06.03", "2026-08", -50, 1, 1]],
      meses: ["2026-08"], lerDemonstracao: ler, travados: new Set(), manuais: new Set(),
    });
    expect(c.linhas[0].celulas[0]).toMatchObject({ demonstracao: null, diferenca: 50, situacao: "diverge" });
  });
});

describe("saúde do DE-PARA", () => {
  const linha = (extra: Partial<SaudeDePara>): SaudeDePara => ({
    id: "x", codigo_categoria: "x", rubrica: "R", demonstrativo: "dre", codigo: null, inativa: null,
    sugestao_codigo: null, sugestao_descricao: null, sugestao_motivo: null, sugestao_ja_mapeada: null, ...extra,
  });

  it("separa conserto certo, duplicata, a conferir e sem par — só entre as órfãs do demonstrativo", () => {
    const r = resumirSaude([
      linha({ codigo: "2.04.07" }),
      linha({ sugestao_codigo: "2.01.02", sugestao_motivo: "pontuacao", sugestao_ja_mapeada: false }),
      linha({ sugestao_codigo: "2.04.07", sugestao_motivo: "numero", sugestao_ja_mapeada: true }),
      linha({ sugestao_codigo: "2.01.97", sugestao_motivo: "numero", sugestao_ja_mapeada: false }),
      linha({}),
      linha({ demonstrativo: "dfc" }),
    ], "dre");
    expect(r).toMatchObject({ apontaveis: 1, duplicadas: 1, aConferir: 1, semPar: 1 });
    expect(r.orfas).toHaveLength(4);
  });
});
