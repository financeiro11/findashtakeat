import { describe, it, expect } from "vitest";
import {
  roteiroPadrao, sanear, foraDoRoteiro, removerPeca, inserirPeca, moverPeca,
  novaFolha, removerFolha, renomearFolha, moverFolha, aplicarComandos, contarPecas,
  nomeLivre,
  type ItemCatalogo, type Roteiro, type Comando,
} from "./apresentacao";

const CATALOGO: ItemCatalogo[] = [
  { chave: "resumo.cabecalho", rotulo: "Cabeçalho do Resumo", bloco: "Resumo" },
  { chave: "resumo.veredicto", rotulo: "Veredicto", bloco: "Resumo" },
  { chave: "resumo.kpis", rotulo: "KPIs do resultado", bloco: "Resumo" },
  { chave: "dre.cascata", rotulo: "Cascata do resultado", bloco: "DRE" },
  { chave: "dre.tabela", rotulo: "DRE vs. orçado", bloco: "DRE" },
  { chave: "caixa.dfc", rotulo: "DFC simplificada", bloco: "Caixa" },
  { chave: "metas.decisoes", rotulo: "O que a reunião decide", bloco: "Metas", vazio: true },
];

const chaves = (r: Roteiro) =>
  r.folhas.map((f) => [f.titulo, f.pecas.map((p) => (p.tipo === "card" ? p.chave : p.titulo))]);

describe("roteiroPadrao", () => {
  it("abre uma folha por bloco, na ordem do catálogo", () => {
    const r = roteiroPadrao(CATALOGO);
    expect(r.folhas.map((f) => f.titulo)).toEqual(["Resumo", "DRE", "Caixa"]);
    expect(r.folhas[0].pecas).toHaveLength(3);
  });

  it("card sem o que mostrar fica de fora, e folha que sobrou vazia não nasce", () => {
    const r = roteiroPadrao(CATALOGO);
    expect(r.folhas.some((f) => f.titulo === "Metas")).toBe(false);
    // …mas continua no catálogo, para poder ser puxado de volta.
    expect(foraDoRoteiro(r, CATALOGO).map((c) => c.chave)).toEqual(["metas.decisoes"]);
  });

  it("é determinístico: montar duas vezes dá exatamente o mesmo roteiro", () => {
    expect(roteiroPadrao(CATALOGO)).toEqual(roteiroPadrao(CATALOGO));
  });
});

describe("operações", () => {
  const base = roteiroPadrao(CATALOGO);

  it("remover não mexe no roteiro original", () => {
    const id = base.folhas[0].pecas[1].id;
    const novo = removerPeca(base, id);
    expect(contarPecas(novo)).toBe(contarPecas(base) - 1);
    expect(contarPecas(base)).toBe(6);
  });

  it("mover para outra folha tira de uma e põe na outra", () => {
    const id = base.folhas[0].pecas[2].id; // resumo.kpis
    const novo = moverPeca(base, id, base.folhas[1].id, 0);
    expect(chaves(novo)[0][1]).toEqual(["resumo.cabecalho", "resumo.veredicto"]);
    expect(chaves(novo)[1][1]).toEqual(["resumo.kpis", "dre.cascata", "dre.tabela"]);
  });

  it("mover para baixo DENTRO da folha conta o índice sem a peça", () => {
    const f = base.folhas[0];
    const novo = moverPeca(base, f.pecas[0].id, f.id, 2);
    expect(chaves(novo)[0][1]).toEqual(["resumo.veredicto", "resumo.kpis", "resumo.cabecalho"]);
  });

  it("inserir grampeia o índice em vez de furar a lista", () => {
    const peca = { id: "px", tipo: "texto" as const, titulo: "Recado", corpo: "..." };
    const novo = inserirPeca(base, base.folhas[1].id, 99, peca);
    expect(chaves(novo)[1][1]).toEqual(["dre.cascata", "dre.tabela", "Recado"]);
  });

  it("folha nova entra depois da indicada, e não no fim", () => {
    const novo = novaFolha(base, "Churn", base.folhas[0].id);
    expect(novo.folhas.map((f) => f.titulo)).toEqual(["Resumo", "Churn", "DRE", "Caixa"]);
  });

  it("renomear e reordenar folha", () => {
    let r = renomearFolha(base, base.folhas[2].id, "Caixa e runway");
    r = moverFolha(r, r.folhas[2].id, 0);
    expect(r.folhas.map((f) => f.titulo)).toEqual(["Caixa e runway", "Resumo", "DRE"]);
    expect(removerFolha(r, r.folhas[0].id).folhas).toHaveLength(2);
  });
});

describe("sanear", () => {
  it("tira o card que sumiu do catálogo e diz qual foi", () => {
    const base = roteiroPadrao(CATALOGO);
    const semDfc = CATALOGO.filter((c) => c.chave !== "caixa.dfc");
    const { roteiro, removidas } = sanear(base, semDfc);
    expect(removidas).toEqual(["caixa.dfc"]);
    expect(contarPecas(roteiro)).toBe(contarPecas(base) - 1);
  });

  it("não encosta em texto nem em série — eles não dependem do catálogo", () => {
    const base = inserirPeca(roteiroPadrao(CATALOGO), "f1", 0, {
      id: "px", tipo: "serie", titulo: "EBITDA 12m", rubrica: "EBITDA", meses: 12, formato: "barra",
    });
    const { roteiro, removidas } = sanear(base, []);
    expect(removidas).toHaveLength(6);
    expect(contarPecas(roteiro)).toBe(1);
  });
});

describe("aplicarComandos", () => {
  const base = roteiroPadrao(CATALOGO);

  it("entende folha e peça pelo NOME, não só pelo id", () => {
    const cmds: Comando[] = [
      { acao: "remover", alvo: "caixa.dfc" },
      { acao: "mover", alvo: "dre.cascata", folha: "Resumo", posicao: 0 },
    ];
    const r = aplicarComandos(base, cmds, CATALOGO);
    expect(r.recusados).toEqual([]);
    expect(chaves(r.roteiro)[0][1]).toEqual([
      "dre.cascata", "resumo.cabecalho", "resumo.veredicto", "resumo.kpis",
    ]);
    expect(r.aplicados).toHaveLength(2);
  });

  it("recusa o que não existe e SEGUE com o resto", () => {
    const cmds: Comando[] = [
      { acao: "adicionar", chave: "churn.porte" },
      { acao: "remover", alvo: "caixa.dfc" },
    ];
    const r = aplicarComandos(base, cmds, CATALOGO);
    expect(r.recusados).toHaveLength(1);
    expect(r.recusados[0]).toContain("churn.porte");
    // O segundo comando não pagou pelo erro do primeiro.
    expect(r.aplicados).toHaveLength(1);
    expect(foraDoRoteiro(r.roteiro, CATALOGO).map((c) => c.chave)).toContain("caixa.dfc");
  });

  it("não deixa o mesmo card entrar duas vezes", () => {
    const r = aplicarComandos(base, [{ acao: "adicionar", chave: "dre.tabela" }], CATALOGO);
    expect(r.recusados[0]).toContain("já está");
    expect(contarPecas(r.roteiro)).toBe(contarPecas(base));
  });

  it("puxa de volta o card que estava fora", () => {
    const r = aplicarComandos(base, [{ acao: "adicionar", chave: "metas.decisoes", folha: "DRE" }], CATALOGO);
    expect(r.recusados).toEqual([]);
    expect(chaves(r.roteiro)[1][1]).toEqual(["dre.cascata", "dre.tabela", "metas.decisoes"]);
  });

  it("cria folha, põe texto e série nela", () => {
    const cmds: Comando[] = [
      { acao: "nova-folha", titulo: "Tendência", depoisDe: "Resumo" },
      { acao: "serie", rubrica: "EBITDA", meses: 12, folha: "Tendência" },
      { acao: "texto", titulo: "Recado", corpo: "Congelar as vagas.", folha: "Tendência" },
    ];
    const r = aplicarComandos(base, cmds, CATALOGO);
    expect(r.recusados).toEqual([]);
    expect(r.roteiro.folhas.map((f) => f.titulo)).toEqual(["Resumo", "Tendência", "DRE", "Caixa"]);
    expect(chaves(r.roteiro)[1][1]).toEqual(["EBITDA — últimos meses", "Recado"]);
  });

  it("a série tem os meses grampeados numa faixa que dá para desenhar", () => {
    const r = aplicarComandos(base, [{ acao: "serie", rubrica: "EBITDA", meses: 500 }], CATALOGO);
    const p = r.roteiro.folhas.at(-1)!.pecas.at(-1)!;
    expect(p.tipo === "serie" && p.meses).toBe(24);
  });

  it("peça nova sem folha indicada cai na última folha", () => {
    const r = aplicarComandos(base, [{ acao: "texto", titulo: "Fecho", corpo: "..." }], CATALOGO);
    expect(chaves(r.roteiro).at(-1)![1]).toEqual(["caixa.dfc", "Fecho"]);
  });

  it("ids novos não colidem com os que já existem", () => {
    const r = aplicarComandos(base, [
      { acao: "texto", titulo: "A", corpo: "1" },
      { acao: "texto", titulo: "B", corpo: "2" },
    ], CATALOGO);
    const ids = r.roteiro.folhas.flatMap((f) => f.pecas.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("nomeLivre", () => {
  it("devolve a base quando ela está livre", () => {
    expect(nomeLivre("Conselho 3T26", ["Tracker CEO"])).toBe("Conselho 3T26");
  });

  it("numera a partir de 2, e não de 1", () => {
    expect(nomeLivre("Conselho 3T26", ["Conselho 3T26"])).toBe("Conselho 3T26 (2)");
  });

  it("pula os números já tomados em vez de parar no primeiro", () => {
    const usados = ["Conselho", "Conselho (2)", "Conselho (3)"];
    expect(nomeLivre("Conselho", usados)).toBe("Conselho (4)");
  });

  it("não se confunde com um buraco no meio", () => {
    // A (3) foi excluída: o próximo livre é ela, não o (4).
    expect(nomeLivre("A", ["A", "A (2)", "A (4)"])).toBe("A (3)");
  });

  it("aceita qualquer iterável — Set inclusive", () => {
    expect(nomeLivre("A", new Set(["A"]))).toBe("A (2)");
  });
});
