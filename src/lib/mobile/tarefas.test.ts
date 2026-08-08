import { describe, it, expect } from "vitest";
import {
  agrupar, aplicarFiltro, estaAtrasada, ordenar, statusDisponiveis,
  ORDEM_STATUS, STATUS_CONCLUIDO, type TarefaMin,
  adicionarSubtarefa, removerSubtarefa, alternarSubtarefa, descreverChecklist, type Subtarefa,
} from "./tarefas";

const HOJE = "2026-08-06";

const t = (over: Partial<TarefaMin> & { id: string }): TarefaMin => ({
  titulo: `Tarefa ${over.id}`,
  responsavel: "Henrique",
  status: "Backlog",
  prioridade: "Média",
  prazo: null,
  ...over,
});

describe("estaAtrasada", () => {
  it("prazo vencido e tarefa aberta", () => {
    expect(estaAtrasada(t({ id: "1", prazo: "2026-08-05" }), HOJE)).toBe(true);
  });
  it("prazo de hoje ainda não está atrasado", () => {
    expect(estaAtrasada(t({ id: "2", prazo: HOJE }), HOJE)).toBe(false);
  });
  it("concluída nunca conta como atrasada", () => {
    expect(estaAtrasada(t({ id: "3", prazo: "2026-01-01", status: "Concluído" }), HOJE)).toBe(false);
  });
  it("sem prazo não conta", () => {
    expect(estaAtrasada(t({ id: "4" }), HOJE)).toBe(false);
  });
});

describe("aplicarFiltro", () => {
  const linhas = [
    t({ id: "a", responsavel: "Júlia · Financeiro" }),
    t({ id: "b", responsavel: "Julia " }),
    t({ id: "c", responsavel: "Henrique", prazo: "2026-07-01" }),
    t({ id: "d", responsavel: null }),
  ];

  it("'minhas' junta as grafias da mesma pessoa", () => {
    expect(aplicarFiltro(linhas, "minhas", "Júlia Rodrigues", HOJE).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("'atrasadas' ignora o responsável", () => {
    expect(aplicarFiltro(linhas, "atrasadas", "Júlia Rodrigues", HOJE).map((x) => x.id)).toEqual(["c"]);
  });
  it("'todas' devolve tudo", () => {
    expect(aplicarFiltro(linhas, "todas", "Júlia Rodrigues", HOJE)).toHaveLength(4);
  });
});

describe("ordenar", () => {
  it("prioridade primeiro, depois o prazo mais próximo", () => {
    const linhas = [
      t({ id: "baixa", prioridade: "Baixa", prazo: "2026-08-01" }),
      t({ id: "urgente", prioridade: "Urgente", prazo: "2026-12-01" }),
      t({ id: "alta-longe", prioridade: "Alta", prazo: "2026-09-01" }),
      t({ id: "alta-perto", prioridade: "Alta", prazo: "2026-08-07" }),
    ];
    expect(ordenar(linhas).map((x) => x.id)).toEqual(["urgente", "alta-perto", "alta-longe", "baixa"]);
  });

  it("sem prazo vai para o fim do próprio nível", () => {
    const linhas = [t({ id: "sem", prioridade: "Alta" }), t({ id: "com", prioridade: "Alta", prazo: "2026-08-20" })];
    expect(ordenar(linhas).map((x) => x.id)).toEqual(["com", "sem"]);
  });
});

describe("agrupar", () => {
  const linhas = [
    t({ id: "atrasada", status: "Backlog", prazo: "2026-08-01" }),
    t({ id: "urgente", status: "Backlog", prioridade: "Urgente" }),
    t({ id: "andamento", status: "Em andamento" }),
    t({ id: "backlog", status: "Backlog" }),
    t({ id: "revisao", status: "Revisão" }),
    t({ id: "concluida", status: "Concluído" }),
    t({ id: "exotico", status: "Coluna nova do desktop" }),
  ];
  const grupos = agrupar(linhas, HOJE);

  it("o bloco é o status, e é ele que decide onde o card aparece", () => {
    expect(grupos.map((g) => g.chave)).toEqual([
      "Em andamento", "Revisão", "Backlog", "Coluna nova do desktop",
    ]);
    expect(grupos.find((g) => g.chave === "Backlog")!.itens.map((x) => x.id))
      .toEqual(["urgente", "atrasada", "backlog"]);
  });

  it("mudar o status move o card de bloco — é o bug que motivou o agrupamento por status", () => {
    const antes = agrupar(linhas, HOJE);
    expect(antes.find((g) => g.chave === "Backlog")!.itens.map((x) => x.id)).toContain("atrasada");

    // A tarefa continua vencida: antes ela ficava presa em "Precisa de atenção" e a
    // troca de status não tinha efeito visível nenhum.
    const depois = agrupar(
      linhas.map((x) => (x.id === "atrasada" ? { ...x, status: "Em andamento" } : x)),
      HOJE,
    );
    expect(depois.find((g) => g.chave === "Backlog")!.itens.map((x) => x.id)).not.toContain("atrasada");
    expect(depois.find((g) => g.chave === "Em andamento")!.itens.map((x) => x.id)).toContain("atrasada");
  });

  it("conta quantas do bloco precisam de atenção sem tirá-las dele", () => {
    const backlog = grupos.find((g) => g.chave === "Backlog")!;
    expect(backlog.itens).toHaveLength(3);
    expect(backlog.nAtencao).toBe(2); // a vencida e a urgente
    expect(grupos.find((g) => g.chave === "Revisão")!.nAtencao).toBe(0);
  });

  it("não repete a mesma tarefa em dois blocos", () => {
    const ids = grupos.flatMap((g) => g.itens.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("deixa 'Concluído' de fora (é carregado à parte, paginado)", () => {
    expect(grupos.map((g) => g.chave)).not.toContain(STATUS_CONCLUIDO);
    expect(grupos.flatMap((g) => g.itens.map((x) => x.id))).not.toContain("concluida");
  });
});

describe("statusDisponiveis", () => {
  it("sempre oferece as colunas padrão, com 'Concluído' por último", () => {
    const lista = statusDisponiveis([]);
    expect(lista.slice(0, ORDEM_STATUS.length)).toEqual(ORDEM_STATUS);
    expect(lista[lista.length - 1]).toBe(STATUS_CONCLUIDO);
  });

  it("descobre coluna criada no Kanban do desktop pelos dados", () => {
    const lista = statusDisponiveis([t({ id: "x", status: "Aguardando NF" })]);
    expect(lista).toContain("Aguardando NF");
    expect(lista.indexOf("Aguardando NF")).toBeGreaterThan(lista.indexOf("Backlog"));
  });

  it("inclui o status da tarefa aberta mesmo que nenhuma outra linha o use", () => {
    expect(statusDisponiveis([], "Coluna esquecida")).toContain("Coluna esquecida");
  });

  it("nunca duplica 'Concluído' quando ele vem dos dados", () => {
    const lista = statusDisponiveis([t({ id: "c", status: STATUS_CONCLUIDO })]);
    expect(lista.filter((s) => s === STATUS_CONCLUIDO)).toHaveLength(1);
  });
});

/* ------------------------------ checklist ------------------------------ */
const s = (id: string, done = false, titulo = `Item ${id}`): Subtarefa => ({
  id, titulo, responsavel: null, done,
});

describe("adicionarSubtarefa", () => {
  it("acrescenta no fim, sem marcar e sem responsável", () => {
    const r = adicionarSubtarefa([s("1")], "Ligar para o contador", () => "novo");
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ id: "novo", titulo: "Ligar para o contador", responsavel: null, done: false });
  });

  it("apara espaços do título", () => {
    expect(adicionarSubtarefa([], "  conferir NF  ", () => "x")[0].titulo).toBe("conferir NF");
  });

  it("título vazio ou só espaço não cria item", () => {
    expect(adicionarSubtarefa([s("1")], "   ", () => "x")).toHaveLength(1);
  });

  it("não altera o array recebido — o original serve para desfazer se o UPDATE falhar", () => {
    const original = [s("1")];
    adicionarSubtarefa(original, "novo item", () => "x");
    expect(original).toHaveLength(1);
  });
});

describe("removerSubtarefa", () => {
  it("tira só o item pedido", () => {
    expect(removerSubtarefa([s("1"), s("2"), s("3")], "2").map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("id inexistente não mexe na lista", () => {
    expect(removerSubtarefa([s("1")], "9")).toHaveLength(1);
  });
});

describe("alternarSubtarefa", () => {
  it("marca e desmarca o mesmo item", () => {
    const marcado = alternarSubtarefa([s("1"), s("2")], "1");
    expect(marcado[0].done).toBe(true);
    expect(marcado[1].done).toBe(false);
    expect(alternarSubtarefa(marcado, "1")[0].done).toBe(false);
  });

  it("não altera o array recebido", () => {
    const original = [s("1")];
    alternarSubtarefa(original, "1");
    expect(original[0].done).toBe(false);
  });
});

describe("descreverChecklist", () => {
  it("mudou a quantidade: a frase é sobre quantidade", () => {
    expect(descreverChecklist([s("1")], [s("1"), s("2")])).toBe("checklist: 1 → 2 itens");
  });

  it("mesma quantidade: a frase é sobre concluídos", () => {
    expect(descreverChecklist([s("1"), s("2")], [s("1", true), s("2")])).toBe("checklist: 1/2 concluídos");
  });

  it("removeu item — continua sendo sobre quantidade", () => {
    expect(descreverChecklist([s("1"), s("2")], [s("1")])).toBe("checklist: 2 → 1 itens");
  });
});
