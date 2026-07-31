import { describe, it, expect } from "vitest";
import {
  montarLayout, correnteDe, destravadasPor, resumoTrilhas, alvosValidos, trilhaDe, bandaNoY,
  type Automacao,
} from "./arvore-layout";
import { iconeDe, nomeIconeDe, ICONES } from "./arvore-icones";

/* A árvore precisa nascer legível com o catálogo como ele está hoje: quase tudo
   sem nível e sem pré-requisito. Cobre esse estado, o estado "completo" (níveis
   e correntes preenchidos) e as posições salvas pelo arraste. */

const auto = (p: Partial<Automacao> & { id: string }): Automacao => ({
  automacao: p.id, categoria: "IA & Categorização", nivel: null, status: "Rodando",
  horas_mes: 0, ferramentas: null, responsavel: null, impacto: null,
  dor: null, solucao: null, observacao: null, depende_de: null, pos_x: null, pos_y: null, icone: null, ordem: 0,
  ...p,
});

/* ------------------------------ trilhas ------------------------------ */
describe("trilhaDe", () => {
  it("agrupa categorias afins na mesma trilha", () => {
    expect(trilhaDe("Pagamentos & Cobrança")).toBe("Pagamentos & Notas");
    expect(trilhaDe("Notas Fiscais")).toBe("Pagamentos & Notas");
    expect(trilhaDe("Comunicação Interna")).toBe("Comunicação & Radar");
  });

  it("categoria desconhecida vira uma trilha própria (galho novo)", () => {
    expect(trilhaDe("Tesouraria Preditiva")).toBe("Tesouraria Preditiva");
    expect(trilhaDe(null)).toBe("Sem categoria");
  });
});

describe("resumoTrilhas", () => {
  it("conta rodando/total por trilha e lista as categorias que a compõem", () => {
    const rows = [
      auto({ id: "a", categoria: "Pagamentos & Cobrança", status: "Rodando" }),
      auto({ id: "b", categoria: "Notas Fiscais", status: "Ideias" }),
      auto({ id: "c", categoria: "Notas Fiscais", status: "Rodando" }),
    ];
    const [tr] = resumoTrilhas(rows);
    expect(tr.nome).toBe("Pagamentos & Notas");
    expect(tr.on).toBe(2);
    expect(tr.total).toBe(3);
    expect(tr.categorias.sort()).toEqual(["Notas Fiscais", "Pagamentos & Cobrança"]);
  });
});

/* ------------------------------ layout ------------------------------ */
describe("montarLayout", () => {
  it("desenha um nó por automação", () => {
    const rows = [auto({ id: "a" }), auto({ id: "b" }), auto({ id: "c", categoria: "Notas Fiscais" })];
    expect(montarLayout(rows).nos).toHaveLength(3);
  });

  it("não sobrepõe nós — nem com muitos na mesma trilha e banda", () => {
    // pior caso real hoje: Comunicação & Radar com 11 automações, todas sem nível
    const rows = Array.from({ length: 11 }, (_, i) =>
      auto({ id: `n${i}`, automacao: `Automação ${i}`, categoria: "Comunicação Interna" }),
    );
    const pontos = montarLayout(rows).nos.map((n) => `${n.x}|${n.y}`);
    expect(new Set(pontos).size).toBe(11);
  });

  it("só cria as bandas que têm automação", () => {
    const rows = [auto({ id: "a", nivel: 2 }), auto({ id: "b", nivel: null })];
    const labels = montarLayout(rows).faixas.map((f) => f.label);
    expect(labels).toContain("N2 · CONTROLES & AUDITORIA");
    expect(labels).toContain("SEM NÍVEL AINDA");
    expect(labels).not.toContain("N1 · FUNDAÇÃO OPERACIONAL");
  });

  it("empilha os níveis de baixo para cima (N1 na base, sem nível no topo)", () => {
    const rows = [auto({ id: "n1", nivel: 1 }), auto({ id: "n3", nivel: 3 }), auto({ id: "sem", nivel: null })];
    const { nos } = montarLayout(rows);
    const y = (id: string) => nos.find((n) => n.r.id === id)!.y;
    expect(y("n1")).toBeGreaterThan(y("n3")); // y menor = mais alto na tela
    expect(y("n3")).toBeGreaterThan(y("sem"));
  });

  it("respeita a posição salva pelo arraste e marca o nó como fixo", () => {
    const rows = [auto({ id: "a" }), auto({ id: "b", pos_x: 1234, pos_y: 567 })];
    const { nos } = montarLayout(rows);
    const b = nos.find((n) => n.r.id === "b")!;
    expect([b.x, b.y]).toEqual([1234, 567]);
    expect(b.fixo).toBe(true);
    expect(nos.find((n) => n.r.id === "a")!.fixo).toBe(false);
  });

  it("cresce o canvas para caber um nó arrastado para fora", () => {
    const semArrasto = montarLayout([auto({ id: "a" })]);
    const comArrasto = montarLayout([auto({ id: "a", pos_x: 5000, pos_y: 4000 })]);
    expect(comArrasto.W).toBeGreaterThan(semArrasto.W);
    expect(comArrasto.H).toBeGreaterThan(semArrasto.H);
  });

  it("mantém todo nó automático dentro do canvas e acima do hub", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      auto({ id: `n${i}`, categoria: i % 3 === 0 ? "Notas Fiscais" : "Reportes & DRE", nivel: (i % 5) + 1 }),
    );
    const L = montarLayout(rows);
    for (const n of L.nos) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(L.W);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(L.hubY);
    }
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
    auto({ id: "a" }), auto({ id: "b", depende_de: "a" }),
    auto({ id: "c", depende_de: "b" }), auto({ id: "solto" }),
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
    auto({ id: "a" }), auto({ id: "b", depende_de: "a", horas_mes: 4 }),
    auto({ id: "c", depende_de: "b", horas_mes: 6 }), auto({ id: "solto", horas_mes: 99 }),
  ];

  it("soma toda a cadeia abaixo, sem contar o próprio nó", () => {
    const { ids, horas } = destravadasPor(rows, "a");
    expect([...ids].sort()).toEqual(["b", "c"]);
    expect(horas).toBe(10);
  });

  it("devolve vazio quando ninguém depende do nó", () => {
    expect(destravadasPor(rows, "solto").ids.size).toBe(0);
  });
});

/* ------------------- ligar pré-requisito sem ciclo ------------------- */
describe("alvosValidos", () => {
  const rows = [
    auto({ id: "a" }), auto({ id: "b", depende_de: "a" }),
    auto({ id: "c", depende_de: "b" }), auto({ id: "solto" }),
  ];

  it("exclui o próprio nó e quem já depende dele", () => {
    // "a" não pode passar a depender de b nem de c (viraria ciclo)
    expect(alvosValidos(rows, "a").map((r) => r.id)).toEqual(["solto"]);
  });

  it("permite qualquer um que não esteja na descendência", () => {
    expect(alvosValidos(rows, "solto").map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });
});

/* --------------- níveis dinâmicos e barreira do arraste --------------- */
describe("níveis vindos do banco", () => {
  const niveis = [
    { n: 1, nome: "Fundação Operacional" },
    { n: 2, nome: "Controles & Auditoria" },
    { n: 6, nome: "Tesouraria Preditiva" }, // nível criado pelo usuário
  ];

  it("cria a faixa de um nível novo sem tocar em código", () => {
    const rows = [auto({ id: "a", nivel: 1 }), auto({ id: "b", nivel: 6 })];
    const labels = montarLayout(rows, niveis).faixas.map((f) => f.label);
    expect(labels).toContain("N6 · TESOURARIA PREDITIVA");
  });

  it("nível que não existe mais cai na faixa 'sem nível'", () => {
    const rows = [auto({ id: "a", nivel: 4 })]; // 4 não está na lista
    const { nos } = montarLayout(rows, niveis);
    expect(nos[0].banda).toBe(0);
  });
});

describe("bandaNoY", () => {
  const rows = [auto({ id: "a", nivel: 1 }), auto({ id: "b", nivel: 2 }), auto({ id: "c", nivel: 3 })];
  const { faixas, nos } = montarLayout(rows);
  const noDe = (id: string) => nos.find((n) => n.r.id === id)!;

  it("acha a faixa em que o ponto caiu", () => {
    expect(bandaNoY(faixas, noDe("a").y)!.k).toBe(1);
    expect(bandaNoY(faixas, noDe("c").y)!.k).toBe(3);
  });

  it("detecta a subida de nível ao cruzar a barreira", () => {
    // arrastar o nó de N1 até a altura do nó de N3 tem que acusar N3
    expect(bandaNoY(faixas, noDe("c").y)!.k).not.toBe(noDe("a").banda);
  });

  it("arrastar para fora do topo/base gruda na faixa extrema, não vira 'sem nível'", () => {
    expect(bandaNoY(faixas, -9999)!.k).toBe(3);
    expect(bandaNoY(faixas, 99999)!.k).toBe(1);
  });

  it("sem faixas não quebra", () => {
    expect(bandaNoY([], 100)).toBeNull();
  });
});

/* ------------------------------ ícones ------------------------------ */
describe("iconeDe", () => {
  it("usa o ícone escolhido à mão", () => {
    expect(iconeDe({ icone: "Crown", automacao: "qualquer coisa" })).toBe(ICONES.Crown);
  });

  it("deduz pelo nome quando não há escolha — nada de ícone genérico por categoria", () => {
    expect(iconeDe({ automacao: "Backup NF --> Drive" })).toBe(ICONES.Archive);
    expect(iconeDe({ automacao: "Relatório de Erros de Emissão" })).toBe(ICONES.AlertTriangle);
    expect(iconeDe({ automacao: "Cálculo de Rescisão" })).toBe(ICONES.Calculator);
    expect(iconeDe({ automacao: "Forecast de Caixa com IA" })).toBe(ICONES.TrendingUp);
  });

  it("ignora acento na dedução", () => {
    expect(iconeDe({ automacao: "CALENDARIO AUTOMATICO" })).toBe(ICONES.CalendarCheck);
  });

  it("cai no raio quando nada casa", () => {
    expect(iconeDe({ automacao: "xyz" })).toBe(ICONES.Zap);
  });

  it("nomeIconeDe devolve um nome que existe no registro", () => {
    const nome = nomeIconeDe({ automacao: "Anexos da NF no Omie" });
    expect(ICONES[nome]).toBeDefined();
    expect(nome).toBe("Paperclip");
  });
});
