import { describe, it, expect } from "vitest";
import { calcIdade, explicaIdade } from "./idade";

const DIA = 86_400_000;
const AGORA = new Date("2026-08-10T12:00:00Z").getTime();
const iso = (diasAtras: number) => new Date(AGORA - diasAtras * DIA).toISOString();

// O quadro real: Backlog e Acompanhamento não contam idade; o resto conta.
const pausa = (s: string) => s === "Backlog" || s === "Acompanhamento";

describe("calcIdade", () => {
  it("conta normal quando a tarefa nunca parou", () => {
    const i = calcIdade({ created_at: iso(10), status: "Em andamento", status_desde: iso(10), pausado_ms: 0 }, pausa, AGORA);
    expect(i.dias).toBe(10);
    expect(i.pausada).toBe(false);
    expect(i.diasPausados).toBe(0);
  });

  it("desconta o tempo já fechado em coluna pausada", () => {
    // nasceu há 20d, dos quais 8 ficaram parados antes de voltar para Em andamento
    const i = calcIdade(
      { created_at: iso(20), status: "Em andamento", status_desde: iso(2), pausado_ms: 8 * DIA },
      pausa, AGORA,
    );
    expect(i.dias).toBe(12);
    expect(i.diasPausados).toBe(8);
  });

  it("congela enquanto o card está parado: o trecho corrente não vira idade", () => {
    // 5 dias de trabalho e depois 10 no Acompanhamento — continua 5, não 15
    const t = { created_at: iso(15), status: "Acompanhamento", status_desde: iso(10), pausado_ms: 0 };
    expect(calcIdade(t, pausa, AGORA).dias).toBe(5);
    // e um dia depois continua 5
    expect(calcIdade(t, pausa, AGORA + DIA).dias).toBe(5);
  });

  it("volta a correr quando o card sai da coluna pausada", () => {
    // mesmo card do teste acima depois de voltar: os 10 dias parados foram bancados
    const t = { created_at: iso(15), status: "Em andamento", status_desde: iso(0), pausado_ms: 10 * DIA };
    expect(calcIdade(t, pausa, AGORA).dias).toBe(5);
    expect(calcIdade(t, pausa, AGORA + 3 * DIA).dias).toBe(8);
  });

  it("card que nasceu no Backlog e nunca saiu tem idade zero", () => {
    const i = calcIdade({ created_at: iso(21), status: "Backlog", status_desde: iso(21), pausado_ms: 0 }, pausa, AGORA);
    expect(i.dias).toBe(0);
    expect(i.pausada).toBe(true);
    expect(i.diasNoStatus).toBe(21);
  });

  it("acumula pausas de várias idas e vindas", () => {
    // 30d de vida: 6 num Backlog anterior, 4 num Acompanhamento anterior, e parado de novo há 5
    const i = calcIdade(
      { created_at: iso(30), status: "Backlog", status_desde: iso(5), pausado_ms: 10 * DIA },
      pausa, AGORA,
    );
    expect(i.dias).toBe(15);
    expect(i.diasPausados).toBe(15);
  });

  it("mudar a regra da coluna muda o número na hora", () => {
    const t = { created_at: iso(12), status: "Stand-by", status_desde: iso(12), pausado_ms: 0 };
    expect(calcIdade(t, pausa, AGORA).dias).toBe(12);
    expect(calcIdade(t, (s) => pausa(s) || s === "Stand-by", AGORA).dias).toBe(0);
  });

  it("aguenta tarefa antiga sem status_desde (anterior à migração)", () => {
    const i = calcIdade({ created_at: iso(9), status: "Revisão", status_desde: null, pausado_ms: null }, pausa, AGORA);
    expect(i.dias).toBe(9);
  });

  it("não devolve número negativo se o relógio do banco estiver à frente", () => {
    const i = calcIdade({ created_at: iso(3), status: "Em andamento", status_desde: iso(-1), pausado_ms: 99 * DIA }, pausa, AGORA);
    expect(i.dias).toBe(0);
  });

  it("data inválida vira zero em vez de NaN na tela", () => {
    expect(calcIdade({ created_at: "sei lá", status: "Backlog" }, pausa, AGORA).dias).toBe(0);
  });
});

describe("explicaIdade", () => {
  it("diz há quanto tempo está parada e quanto ficou fora da conta", () => {
    const t = { created_at: iso(20), status: "Acompanhamento", status_desde: iso(6), pausado_ms: 3 * DIA };
    const txt = explicaIdade(t, calcIdade(t, pausa, AGORA));
    expect(txt).toContain('Parada em "Acompanhamento" há 6d');
    expect(txt).toContain("9d fora da conta");
  });

  it("em coluna que conta, só mostra a criação", () => {
    const t = { created_at: iso(4), status: "Em andamento", status_desde: iso(4), pausado_ms: 0 };
    const txt = explicaIdade(t, calcIdade(t, pausa, AGORA));
    expect(txt).toBe("Criada em 06/08/2026");
  });
});
