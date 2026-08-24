import { describe, it, expect } from "vitest";
import { buscarAutomacoes, grifar, unirFaixas, palavrasDe, achatar, MIN_TERMO } from "./arvore-busca";
import { type Automacao, type Nivel } from "./arvore-layout";

/* A busca existe para responder "onde está a X" sem caçar bolinha na árvore.
   O que os testes seguram: achar sem acento, achar por característica (e não só
   por nome), exigir TODAS as palavras digitadas, e explicar por que a linha
   apareceu quando o casamento foi fora do nome. */

const auto = (p: Partial<Automacao> & { id: string }): Automacao => ({
  automacao: p.id, categoria: "IA & Categorização", nivel: null, status: "Rodando",
  horas_mes: 0, ferramentas: null, responsavel: null, impacto: null, esforco: null,
  dor: null, solucao: null, observacao: null, upgrade: null, depende_de: null,
  pos_x: null, pos_y: null, icone: null, ordem: 0,
  ...p,
});

const NIVEIS: Nivel[] = [
  { n: 1, nome: "Fundação Operacional" },
  { n: 2, nome: "Controles & Auditoria" },
];

/* ------------------------------ o básico ------------------------------ */
describe("buscarAutomacoes", () => {
  const rows = [
    auto({ id: "a", automacao: "Conciliação Bancária", ferramentas: "Omie, n8n", responsavel: "Júlia Reis", nivel: 1 }),
    auto({ id: "b", automacao: "Radar de Editais", categoria: "Editais", status: "Em teste", responsavel: "Guilherme" }),
    auto({ id: "c", automacao: "Comentários no Tracker", categoria: "Reportes & DRE", nivel: 2, solucao: "A IA escreve o comentário da variação no Tracker" }),
  ];

  it("fica calada com termo curto demais", () => {
    expect(buscarAutomacoes(rows, "", NIVEIS)).toBeNull();
    expect(buscarAutomacoes(rows, "c", NIVEIS)).toBeNull();
    expect("co".length).toBe(MIN_TERMO);
    expect(buscarAutomacoes(rows, "co", NIVEIS)).not.toBeNull();
  });

  it("acha pelo nome sem se importar com acento nem caixa", () => {
    const r = buscarAutomacoes(rows, "conciliacao", NIVEIS)!;
    expect(r.map((x) => x.r.id)).toEqual(["a"]);
    expect(buscarAutomacoes(rows, "CONCILIAÇÃO", NIVEIS)!.map((x) => x.r.id)).toEqual(["a"]);
  });

  it("acha por característica: ferramenta, responsável, status, categoria e nível", () => {
    expect(buscarAutomacoes(rows, "n8n", NIVEIS)!.map((x) => x.r.id)).toEqual(["a"]);
    expect(buscarAutomacoes(rows, "julia", NIVEIS)!.map((x) => x.r.id)).toEqual(["a"]);
    expect(buscarAutomacoes(rows, "em teste", NIVEIS)!.map((x) => x.r.id)).toEqual(["b"]);
    expect(buscarAutomacoes(rows, "editais", NIVEIS)!.map((x) => x.r.id)).toEqual(["b"]);
    expect(buscarAutomacoes(rows, "auditoria", NIVEIS)!.map((x) => x.r.id)).toEqual(["c"]);
  });

  it("exige TODAS as palavras — E entre elas, OU entre os campos", () => {
    expect(buscarAutomacoes(rows, "julia omie", NIVEIS)!.map((x) => x.r.id)).toEqual(["a"]);
    expect(buscarAutomacoes(rows, "julia editais", NIVEIS)).toEqual([]);
  });

  it("nada bate devolve lista vazia, não null — é diferente de busca desligada", () => {
    expect(buscarAutomacoes(rows, "jabuticaba", NIVEIS)).toEqual([]);
  });

  it("bater no nome vale mais do que bater no texto do meio", () => {
    const r = buscarAutomacoes(rows, "tracker", NIVEIS)!;
    expect(r[0].r.id).toBe("c");
    expect(r[0].onde[0]).toBe("nome");
  });

  it("explica por que apareceu quando o casamento foi fora do nome", () => {
    const [achado] = buscarAutomacoes(rows, "n8n", NIVEIS)!;
    expect(achado.nome).toEqual([]);                    // nada a grifar no nome
    expect(achado.trecho?.rotulo).toBe("ferramenta");
    expect(achado.trecho?.texto).toContain("n8n");
    expect(achado.onde).toContain("ferramenta");
  });

  it("grifa o pedaço certo do nome", () => {
    const [achado] = buscarAutomacoes(rows, "radar", NIVEIS)!;
    expect(achado.nome).toEqual([{ de: 0, ate: 5 }]);
    expect(grifar(achado.r.automacao, achado.nome)).toEqual([
      { texto: "Radar", forte: true },
      { texto: " de Editais", forte: false },
    ]);
  });

  it("recorta o trecho longo em volta do casamento", () => {
    const longa = auto({
      id: "d",
      automacao: "Fechamento",
      observacao: "x".repeat(200) + " balancete " + "y".repeat(200),
    });
    const [achado] = buscarAutomacoes([longa], "balancete", NIVEIS)!;
    expect(achado.trecho!.texto.length).toBeLessThan(150);
    expect(achado.trecho!.texto.startsWith("…")).toBe(true);
    expect(achado.trecho!.texto.endsWith("…")).toBe(true);
    // a faixa realinhada tem que cair mesmo em cima da palavra
    const { de, ate } = achado.trecho!.faixas[0];
    expect(achado.trecho!.texto.slice(de, ate)).toBe("balancete");
  });

  it("acha pelos marcadores — upgrade sugerido e linha de produção", () => {
    const comUp = [auto({ id: "u", automacao: "Categorizar", upgrade: "dá para ela pegar o centro de custo" })];
    expect(buscarAutomacoes(comUp, "upgrade", NIVEIS)!.map((x) => x.r.id)).toEqual(["u"]);
  });
});

/* --------------------------- as peças soltas --------------------------- */
describe("achatar", () => {
  it("preserva os índices — é o que faz o grifo cair no lugar", () => {
    const s = "Conciliação Bancária";
    expect(achatar(s).length).toBe(s.length);
    expect(achatar(s)).toBe("CONCILIACAO BANCARIA");
  });
});

describe("palavrasDe", () => {
  it("solta a pontuação das pontas e mantém a do meio", () => {
    expect(palavrasDe("  omie, n8n  ")).toEqual(["OMIE", "N8N"]);
    expect(palavrasDe("fp&a")).toEqual(["FP&A"]);
    expect(palavrasDe(" — ")).toEqual([]);
  });
});

describe("unirFaixas", () => {
  it("junta o que se toca e ordena", () => {
    expect(unirFaixas([{ de: 5, ate: 8 }, { de: 0, ate: 3 }, { de: 2, ate: 6 }]))
      .toEqual([{ de: 0, ate: 8 }]);
  });
});

describe("grifar", () => {
  it("sem faixa, devolve o texto inteiro fraco", () => {
    expect(grifar("Radar", [])).toEqual([{ texto: "Radar", forte: false }]);
  });
});
