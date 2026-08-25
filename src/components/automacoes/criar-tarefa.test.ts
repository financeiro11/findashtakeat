import { describe, it, expect } from "vitest";
import { EMBED_TAREFA, tarefaDe, tarefaViva, type TarefaVinculada } from "./criar-tarefa";

/* ---------------------------------------------------------------------------
 * O vínculo automação ↔ tarefa visto do lado da leitura.
 *
 * É a regra que decide se a ficha oferece "ver a tarefa" ou "começar de novo".
 * Errar para o lado do "viva" manda a pessoa procurar uma tarefa que sumiu do
 * quadro; errar para o lado do "morta" abre uma segunda tarefa em cima da
 * primeira. Nenhum dos dois dá erro na tela — por isso está testado.
 * ------------------------------------------------------------------------- */

const viva: TarefaVinculada = { id: "t1", status: "Backlog", arquivada_em: null };

describe("tarefaViva", () => {
  it("tarefa no quadro conta", () => {
    expect(tarefaViva(viva)).toBe(true);
    expect(tarefaViva({ ...viva, status: "Em andamento" })).toBe(true);
  });

  // O caso do pedido: arquivar em /tarefas devolve a automação para a fila.
  // `/tarefas` NÃO apaga (o delete virou update de `arquivada_em`), então o
  // `on delete set null` da FK nunca dispara e o `tarefa_id` continua lá.
  it("arquivada solta o vínculo, mesmo com o status vivo", () => {
    expect(tarefaViva({ ...viva, arquivada_em: "2026-08-25T12:00:00Z" })).toBe(false);
  });

  it("concluída solta o vínculo — retomar meses depois é caso real", () => {
    expect(tarefaViva({ ...viva, status: "Concluído" })).toBe(false);
  });

  it("sem tarefa é sem tarefa", () => {
    expect(tarefaViva(null)).toBe(false);
    expect(tarefaViva(undefined)).toBe(false);
  });

  /* A grafia vem do banco e é conferida contra o mesmo literal da RPC
     (`t.status <> 'Concluído'`). Sem acento, ou "Concluida", a tarefa concluída
     passaria por viva e a automação ficaria presa a ela para sempre. */
  it("o status morto é exatamente 'Concluído', com acento", () => {
    expect(tarefaViva({ ...viva, status: "Concluido" })).toBe(true);
  });
});

describe("tarefaDe", () => {
  it("aceita o objeto que o PostgREST devolve no embed um-para-um", () => {
    expect(tarefaDe({ tarefa: viva })).toEqual(viva);
  });

  // Defesa: versões do PostgREST já devolveram lista aqui, e ler "não tem
  // tarefa" de um vínculo que existe abriria uma tarefa duplicada em silêncio.
  it("aceita lista, e devolve o primeiro", () => {
    expect(tarefaDe({ tarefa: [viva] })).toEqual(viva);
    expect(tarefaDe({ tarefa: [] })).toBeNull();
  });

  it("vínculo vazio devolve null", () => {
    expect(tarefaDe({ tarefa: null })).toBeNull();
    expect(tarefaDe({})).toBeNull();
  });
});

describe("EMBED_TAREFA", () => {
  /* O select tem que trazer as duas colunas que a regra lê. Tirar uma delas do
     embed não quebra nada na hora: o campo chega `undefined`, `arquivada_em`
     vira "não arquivada" e toda tarefa arquivada volta a parecer viva. */
  it("pede as colunas que tarefaViva usa", () => {
    for (const col of ["id", "status", "arquivada_em"]) {
      expect(EMBED_TAREFA).toContain(col);
    }
    expect(EMBED_TAREFA.startsWith("tarefa:tarefas(")).toBe(true);
  });
});
