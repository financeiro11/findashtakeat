import { describe, it, expect } from "vitest";
import { agrupar, aplicarFiltro, estaAtrasada, ordenar, type TarefaMin } from "./tarefas";

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
    t({ id: "exotico", status: "Tasks - RPA" }),
  ];
  const grupos = agrupar(linhas, HOJE);

  it("abre com 'Precisa de atenção'", () => {
    expect(grupos[0].chave).toBe("__atencao__");
    expect(grupos[0].itens.map((x) => x.id).sort()).toEqual(["atrasada", "urgente"]);
  });

  it("respeita a ordem dos status conhecidos e joga o desconhecido para o fim", () => {
    expect(grupos.map((g) => g.chave)).toEqual([
      "__atencao__", "Em andamento", "Revisão", "Backlog", "Tasks - RPA",
    ]);
  });

  it("não repete a mesma tarefa em dois blocos", () => {
    const ids = grupos.flatMap((g) => g.itens.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("deixa 'Concluído' de fora (é carregado à parte, paginado)", () => {
    expect(grupos.flatMap((g) => g.itens.map((x) => x.id))).not.toContain("concluida");
  });
});
