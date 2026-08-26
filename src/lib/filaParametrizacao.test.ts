import { describe, expect, it } from "vitest";
import type { Candidato } from "@/lib/apelidos";
import {
  alternarNoSet, categoriaDaContraparte, categoriasDaFila, colunaFiltrada,
  FAIXA_PADRAO, FAIXAS_RECENTES, filtrarFila, filtroFilaInicial, haQuantoTempo,
  lerNumero, limparColuna, mesesDaFila, mesesDesde, quantasColunasFiltradas,
  recenciaDe, recenciasDaFila, rotuloMes, SEM_CATEGORIA,
  type EstadoPlanilha, type FiltroFila,
} from "@/lib/filaParametrizacao";

const c = (p: Partial<Candidato>): Candidato => ({
  origem: "omie", nome: "X", documento: null, categoria: null, cidade: null,
  lancamentos: 1, total: 100, primeira: "2026-05-10", ultima: "2026-07-20", ...p,
});

/** Ninguém tem evidência, salvo quando o teste disser o contrário. */
const nada = (): EstadoPlanilha => "nada";

const com = (p: Partial<FiltroFila>): FiltroFila => ({ ...filtroFilaInicial(), ...p });

describe("filtroFilaInicial", () => {
  it("devolve conjuntos novos a cada chamada", () => {
    // Se fosse constante de módulo, marcar aqui vazaria para a próxima tela.
    const a = filtroFilaInicial();
    a.categorias.add("Softwares");
    expect(filtroFilaInicial().categorias.size).toBe(0);
  });

  it("não corta nada", () => {
    const fila = [c({ nome: "A" }), c({ nome: "B" })];
    expect(filtrarFila(fila, filtroFilaInicial(), nada)).toHaveLength(2);
    expect(quantasColunasFiltradas(filtroFilaInicial())).toBe(0);
  });
});

describe("categoria", () => {
  it("contraparte sem categoria cai num balde filtrável", () => {
    expect(categoriaDaContraparte(c({ categoria: null }))).toBe(SEM_CATEGORIA);
    expect(categoriaDaContraparte(c({ categoria: "   " }))).toBe(SEM_CATEGORIA);
    expect(categoriaDaContraparte(c({ categoria: " Softwares " }))).toBe("Softwares");
  });

  it("as opções vêm ordenadas pelo que mais pesa, com o balde junto", () => {
    const fila = [
      c({ nome: "A", categoria: "Softwares", total: 100 }),
      c({ nome: "B", categoria: null, total: 900 }),
      c({ nome: "C", categoria: "Softwares", total: 300 }),
    ];
    expect(categoriasDaFila(fila)).toEqual([
      { valor: SEM_CATEGORIA, lancamentos: 1, total: 900 },
      { valor: "Softwares", lancamentos: 2, total: 400 },
    ]);
  });

  it("marcar categoria deixa passar só ela; vazio é 'todas', não 'nenhuma'", () => {
    const fila = [c({ nome: "A", categoria: "Softwares" }), c({ nome: "B", categoria: "Fretes" })];
    expect(filtrarFila(fila, com({ categorias: new Set(["Softwares"]) }), nada).map((x) => x.nome))
      .toEqual(["A"]);
    expect(filtrarFila(fila, com({ categorias: new Set() }), nada)).toHaveLength(2);
  });
});

describe("faixas de número", () => {
  it("lado nulo é lado aberto", () => {
    const fila = [c({ nome: "A", total: 50 }), c({ nome: "B", total: 5000 })];
    expect(filtrarFila(fila, com({ totalMin: 1000 }), nada).map((x) => x.nome)).toEqual(["B"]);
    expect(filtrarFila(fila, com({ totalMax: 1000 }), nada).map((x) => x.nome)).toEqual(["A"]);
    expect(filtrarFila(fila, com({ totalMin: 40, totalMax: 60 }), nada).map((x) => x.nome)).toEqual(["A"]);
  });

  it("os limites entram na faixa", () => {
    const fila = [c({ nome: "A", lancamentos: 3 })];
    expect(filtrarFila(fila, com({ lctosMin: 3, lctosMax: 3 }), nada)).toHaveLength(1);
  });
});

describe("período", () => {
  /* O ponto do módulo: a contraparte tem INTERVALO, não data. */
  const fila = [
    c({ nome: "recorrente", primeira: "2026-05-02", ultima: "2026-07-28" }),
    c({ nome: "so-maio", primeira: "2026-05-02", ultima: "2026-05-09" }),
    c({ nome: "so-julho", primeira: "2026-07-03", ultima: "2026-07-03" }),
  ];

  it("um corte de julho pega quem atravessou mai–jul", () => {
    expect(filtrarFila(fila, com({ mesDe: "2026-07", mesAte: "2026-07" }), nada).map((x) => x.nome))
      .toEqual(["recorrente", "so-julho"]);
  });

  it("'a partir de junho' descarta quem morreu em maio", () => {
    expect(filtrarFila(fila, com({ mesDe: "2026-06" }), nada).map((x) => x.nome))
      .toEqual(["recorrente", "so-julho"]);
  });

  it("'até maio' descarta quem só nasceu em julho", () => {
    expect(filtrarFila(fila, com({ mesAte: "2026-05" }), nada).map((x) => x.nome))
      .toEqual(["recorrente", "so-maio"]);
  });

  it("sem data legível fica de fora do corte — e dentro quando não há corte", () => {
    const sem = [c({ nome: "?", primeira: null, ultima: null })];
    expect(filtrarFila(sem, com({ mesDe: "2026-07" }), nada)).toHaveLength(0);
    expect(filtrarFila(sem, filtroFilaInicial(), nada)).toHaveLength(1);
  });

  it("lista os meses que a fila toca, do mais antigo ao mais novo", () => {
    expect(mesesDaFila(fila)).toEqual(["2026-05", "2026-07"]);
  });
});

describe("o que a planilha diz", () => {
  it("filtra pelo estado que a função de fora informa", () => {
    const fila = [c({ nome: "A" }), c({ nome: "B" }), c({ nome: "C" })];
    const estado = (x: Candidato): EstadoPlanilha =>
      x.nome === "A" ? "proposta" : x.nome === "B" ? "sem_nome" : "nada";
    expect(filtrarFila(fila, com({ planilha: new Set(["proposta"] as EstadoPlanilha[]) }), estado)
      .map((x) => x.nome)).toEqual(["A"]);
    expect(filtrarFila(fila, com({ planilha: new Set(["sem_nome", "nada"] as EstadoPlanilha[]) }), estado)
      .map((x) => x.nome)).toEqual(["B", "C"]);
  });
});

describe("estado dos filtros", () => {
  it("cada coluna acende sozinha e limpa sozinha", () => {
    const f = com({ categorias: new Set(["Softwares"]), totalMin: 10, mesDe: "2026-07" });
    expect(quantasColunasFiltradas(f)).toBe(3);
    expect(colunaFiltrada(f, "categoria")).toBe(true);
    expect(colunaFiltrada(f, "lancamentos")).toBe(false);

    const semTotal = limparColuna(f, "total");
    expect(colunaFiltrada(semTotal, "total")).toBe(false);
    // Limpar uma coluna não pode derrubar as outras.
    expect(colunaFiltrada(semTotal, "categoria")).toBe(true);
    expect(colunaFiltrada(semTotal, "periodo")).toBe(true);
  });

  it("alternar devolve conjunto novo, sem mexer no original", () => {
    const antes = new Set(["a"]);
    expect([...alternarNoSet(antes, "b")]).toEqual(["a", "b"]);
    expect([...alternarNoSet(antes, "a")]).toEqual([]);
    expect([...antes]).toEqual(["a"]);
  });
});

describe("lerNumero", () => {
  it("aceita o número como se lê na tela", () => {
    expect(lerNumero("1200")).toBe(1200);
    // O caso que motivou o parser: Number("1.200") daria 1,2.
    expect(lerNumero("1.200")).toBe(1200);
    expect(lerNumero("1.200.500")).toBe(1200500);
    expect(lerNumero("1.200,50")).toBe(1200.5);
    expect(lerNumero("1200.50")).toBe(1200.5);
    expect(lerNumero("R$ 5.000")).toBe(5000);
  });

  it("devolve null no vazio e no lixo", () => {
    expect(lerNumero("")).toBeNull();
    expect(lerNumero("   ")).toBeNull();
    expect(lerNumero("abc")).toBeNull();
  });

  it("mantém o texto meio digitado significando o mesmo valor", () => {
    // É disto que depende o campo não se reescrever no meio da digitação.
    expect(lerNumero("1.")).toBe(1);
  });
});

describe("rotuloMes", () => {
  it("escreve o mês como a coluna Período escreve", () => {
    expect(rotuloMes("2026-07")).toBe("jul 26");
    expect(rotuloMes("2026-01")).toBe("jan 26");
  });
});

/* 25 de agosto de 2026 — o dia em que a coluna "Último" foi ao ar. */
const HOJE = new Date(2026, 7, 25);

describe("recência", () => {
  it("conta meses de calendário, não dias", () => {
    // O dia do mês não pode mudar a faixa: 31 de julho e 1º de julho são ambos
    // "mês passado" olhando de agosto.
    expect(mesesDesde("2026-08-01", HOJE)).toBe(0);
    expect(mesesDesde("2026-07-31", HOJE)).toBe(1);
    expect(mesesDesde("2026-07-01", HOJE)).toBe(1);
    expect(mesesDesde("2025-08-30", HOJE)).toBe(12);
    expect(mesesDesde(null, HOJE)).toBeNull();
  });

  it("as faixas são disjuntas e cobrem a janela inteira", () => {
    expect(recenciaDe("2026-08-19", HOJE)).toBe("mes");
    expect(recenciaDe("2026-07-31", HOJE)).toBe("passado");
    expect(recenciaDe("2026-07-01", HOJE)).toBe("passado");
    expect(recenciaDe("2026-06-30", HOJE)).toBe("trimestre");
    expect(recenciaDe("2026-05-10", HOJE)).toBe("trimestre");
    expect(recenciaDe("2026-04-30", HOJE)).toBe("semestre");
    expect(recenciaDe("2026-02-01", HOJE)).toBe("semestre");
    expect(recenciaDe("2026-01-31", HOJE)).toBe("parado");
  });

  it("o mês passado tem faixa só dele — é por onde a tela abre", () => {
    // Se ele voltasse a morar dentro de "1 a 3 meses", o padrão da tela traria
    // maio junto e a fila do fechamento deixaria de ser a fila do fechamento.
    expect(FAIXA_PADRAO).toBe("passado");
    expect(recenciaDe("2026-07-20", HOJE)).toBe(FAIXA_PADRAO);
    expect(recenciaDe("2026-05-20", HOJE)).not.toBe(FAIXA_PADRAO);
    expect(FAIXAS_RECENTES).toEqual(["mes", "passado", "trimestre"]);
  });

  it("sem data é balde, não buraco", () => {
    expect(recenciaDe(null, HOJE)).toBe("sem_data");
    expect(recenciaDe("", HOJE)).toBe("sem_data");
  });

  it("data no futuro conta como este mês", () => {
    // O extrato adianta lançamento programado; a linha está viva, não no ano que vem.
    expect(recenciaDe("2026-09-10", HOJE)).toBe("mes");
  });

  it("escreve o tempo como se fala", () => {
    expect(haQuantoTempo("2026-08-19", HOJE)).toBe("este mês");
    expect(haQuantoTempo("2026-07-01", HOJE)).toBe("mês passado");
    expect(haQuantoTempo("2026-04-30", HOJE)).toBe("há 4 meses");
    expect(haQuantoTempo(null, HOJE)).toBe("sem data");
  });
});

describe("recenciasDaFila", () => {
  const itens = [
    { ultima: "2026-08-19", total: 200 },
    { ultima: "2026-08-02", total: 100 },
    { ultima: "2026-07-15", total: 400 },
    { ultima: "2026-06-30", total: 900 },
    { ultima: "2025-11-04", total: 50 },
  ];

  it("vem da mais quente para a mais fria, com o peso de cada uma", () => {
    expect(recenciasDaFila(itens, HOJE)).toEqual([
      { valor: "mes", rotulo: "Este mês", itens: 2, total: 300 },
      { valor: "passado", rotulo: "Mês passado", itens: 1, total: 400 },
      { valor: "trimestre", rotulo: "Há 2 a 3 meses", itens: 1, total: 900 },
      { valor: "parado", rotulo: "Há mais de 6 meses", itens: 1, total: 50 },
    ]);
  });

  it("faixa vazia não vira opção", () => {
    // "Há 4 a 6 meses" não tem ninguém aqui — oferecer o clique seria prometer
    // uma lista que volta em branco.
    expect(recenciasDaFila(itens, HOJE).map((o) => o.valor)).not.toContain("semestre");
  });
});
