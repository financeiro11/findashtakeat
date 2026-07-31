import { describe, it, expect } from "vitest";
import { montarLayout, correnteDe, destravadasPor, type Automacao } from "./arvore-layout";

/* A árvore precisa nascer legível com o catálogo como ele está hoje: quase tudo
   sem nível e sem pré-requisito. Cobre o desenho nesse estado e no estado
   "completo" (níveis e correntes preenchidos). */

const auto = (p: Partial<Automacao> & { id: string }): Automacao => ({
  automacao: p.id, categoria: "IA & Categorização", nivel: null, status: "Rodando",
  horas_mes: 0, ferramentas: null, responsavel: null, impacto: null, depende_de: null, ordem: 0,
  ...p,
});

/* ------------------------------ layout ------------------------------ */
describe("montarLayout", () => {
  it("desenha um nó por automação", () => {
    const rows = [auto({ id: "a" }), auto({ id: "b" }), auto({ id: "c", categoria: "Notas Fiscais" })];
    expect(montarLayout(rows).nos).toHaveLength(3);
  });

  it("não sobrepõe nós — nem com muitos na mesma trilha e banda", () => {
    // pior caso real hoje: Comunicação Interna com 10 automações, todas sem nível
    const rows = Array.from({ length: 10 }, (_, i) =>
      auto({ id: `n${i}`, automacao: `Automação ${i}`, categoria: "Comunicação Interna" }),
    );
    const { nos } = montarLayout(rows);
    const pontos = nos.map((n) => `${n.x}|${n.y}`);
    expect(new Set(pontos).size).toBe(nos.length);
  });

  it("só cria as bandas que têm automação", () => {
    const rows = [auto({ id: "a", nivel: 2 }), auto({ id: "b", nivel: null })];
    const labels = montarLayout(rows).faixas.map((f) => f.label);
    expect(labels).toContain("N2 · CONTROLES");
    expect(labels).toContain("SEM NÍVEL AINDA");
    expect(labels).not.toContain("N1 · FUNDAÇÃO");
    expect(labels).not.toContain("N5 · AUTONOMIA");
  });

  it("empilha os níveis de baixo para cima (N1 na base, sem nível no topo)", () => {
    const rows = [auto({ id: "n1", nivel: 1 }), auto({ id: "n3", nivel: 3 }), auto({ id: "sem", nivel: null })];
    const { nos } = montarLayout(rows);
    const y = (id: string) => nos.find((n) => n.r.id === id)!.y;
    // y menor = mais alto na tela
    expect(y("n1")).toBeGreaterThan(y("n3"));
    expect(y("n3")).toBeGreaterThan(y("sem"));
  });

  it("mantém todo nó dentro do canvas e acima do hub", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      auto({ id: `n${i}`, categoria: i % 3 === 0 ? "Notas Fiscais" : "Reportes & DRE", nivel: (i % 5) + 1 }),
    );
    const L = montarLayout(rows);
    for (const n of L.nos) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(L.W);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(L.hubY); // nunca desenha em cima do hub
    }
  });

  it("ordena por status dentro da célula — o que roda vem antes do que é ideia", () => {
    const rows = [
      auto({ id: "ideia", automacao: "AAA ideia", status: "Ideias" }),
      auto({ id: "rodando", automacao: "ZZZ rodando", status: "Rodando" }),
    ];
    const { nos } = montarLayout(rows);
    // "Rodando" fica mais perto do hub (y maior) apesar do nome vir depois no alfabeto
    expect(nos.find((n) => n.r.id === "rodando")!.y).toBeGreaterThanOrEqual(nos.find((n) => n.r.id === "ideia")!.y);
  });

  it("aguenta catálogo vazio sem quebrar", () => {
    const L = montarLayout([]);
    expect(L.nos).toHaveLength(0);
    expect(L.faixas).toHaveLength(0);
    expect(Number.isFinite(L.W) && Number.isFinite(L.H)).toBe(true);
  });
});

/* ---------------------------- correntes ---------------------------- */
describe("correnteDe", () => {
  const rows = [
    auto({ id: "a" }),
    auto({ id: "b", depende_de: "a" }),
    auto({ id: "c", depende_de: "b" }),
    auto({ id: "solto" }),
  ];

  it("acende o nó, os pré-requisitos acima e o que ele destrava abaixo", () => {
    expect([...correnteDe(rows, "b")!].sort()).toEqual(["a", "b", "c"]);
  });

  it("retorna null sem seleção", () => {
    expect(correnteDe(rows, null)).toBeNull();
  });

  it("não trava com ciclo no dado", () => {
    const ciclo = [auto({ id: "x", depende_de: "y" }), auto({ id: "y", depende_de: "x" })];
    expect([...correnteDe(ciclo, "x")!].sort()).toEqual(["x", "y"]);
  });
});

describe("destravadasPor", () => {
  const rows = [
    auto({ id: "a" }),
    auto({ id: "b", depende_de: "a", horas_mes: 4 }),
    auto({ id: "c", depende_de: "b", horas_mes: 6 }),
    auto({ id: "solto", horas_mes: 99 }),
  ];

  it("soma toda a cadeia abaixo, sem contar o próprio nó", () => {
    const { ids, horas } = destravadasPor(rows, "a");
    expect([...ids].sort()).toEqual(["b", "c"]);
    expect(horas).toBe(10);
  });

  it("devolve vazio quando ninguém depende do nó", () => {
    expect(destravadasPor(rows, "solto").ids.size).toBe(0);
  });

  it("não trava com ciclo no dado", () => {
    const ciclo = [auto({ id: "x", depende_de: "y" }), auto({ id: "y", depende_de: "x" })];
    expect(destravadasPor(ciclo, "x").ids.size).toBeLessThanOrEqual(2);
  });
});
