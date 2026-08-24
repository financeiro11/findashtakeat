import { describe, expect, it } from "vitest";
import { contarNaoLidos, metaDoTipo, rotuloDoDia, ultimoDiaComItem, type DiaNovidades } from "./novidades";

const dia = (d: string, itens: { tipo: string }[]): DiaNovidades => ({
  dia: d,
  resumo: null,
  itens: itens.map((i, n) => ({
    titulo: `item ${n}`, o_que_muda: "", tipo: i.tipo, area: "Tarefas", rota: "/tarefas", commits: [`sha${n}`], hora: "10:00",
  })),
  commits: [],
  n_commits: itens.length,
  redigido_por: "ia",
  gerado_em: `${d}T12:00:00Z`,
});

describe("rotuloDoDia", () => {
  it("chama o dia de hoje de hoje e o anterior de ontem", () => {
    expect(rotuloDoDia("2026-08-24", "2026-08-24")).toBe("hoje");
    expect(rotuloDoDia("2026-08-23", "2026-08-24")).toBe("ontem");
  });

  it("atravessa a virada do mês sem chamar o dia 31 de 'ontem' errado", () => {
    expect(rotuloDoDia("2026-07-31", "2026-08-01")).toBe("ontem");
    expect(rotuloDoDia("2026-07-30", "2026-08-01")).toBe("quinta-feira, 30/07");
  });
});

describe("contarNaoLidos", () => {
  const dias = [dia("2026-08-24", [{ tipo: "novidade" }, { tipo: "bastidor" }]), dia("2026-08-23", [{ tipo: "melhoria" }])];

  it("conta só o que veio depois da última leitura", () => {
    expect(contarNaoLidos(dias, "2026-08-23")).toBe(1); // o bastidor do dia 24 não conta
  });

  it("na primeira visita conta tudo o que aparece na tela", () => {
    expect(contarNaoLidos(dias, null)).toBe(2);
  });

  it("não conta nada quando já leu o dia mais novo", () => {
    expect(contarNaoLidos(dias, "2026-08-24")).toBe(0);
  });
});

describe("ultimoDiaComItem", () => {
  it("ignora dia sem novidade nenhuma — marcar como lido não pode pular o que ainda não saiu", () => {
    expect(ultimoDiaComItem([dia("2026-08-24", []), dia("2026-08-23", [{ tipo: "melhoria" }])])).toBe("2026-08-23");
  });

  it("devolve null quando não há nada", () => {
    expect(ultimoDiaComItem([])).toBeNull();
  });
});

describe("metaDoTipo", () => {
  it("cai em melhoria quando o tipo vem torto do modelo", () => {
    expect(metaDoTipo("correcao").rotulo).toBe("correção");
    expect(metaDoTipo("qualquer-coisa").rotulo).toBe("melhoria");
  });
});
