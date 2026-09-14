import { describe, expect, it } from "vitest";
import { aoParar, retirarUltimaPergunta } from "./assistente-conversa";
import type { MsgAssistente } from "./assistente";

const u = (content: string): MsgAssistente => ({ role: "user", content });
const a = (content: string, extra: Partial<MsgAssistente> = {}): MsgAssistente =>
  ({ role: "assistant", content, ...extra });

describe("retirarUltimaPergunta", () => {
  it("tira a pergunta e a resposta dela", () => {
    const r = retirarUltimaPergunta([u("caixa de julho"), a("R$ 10"), u("e agosto?"), a("R$ 12")]);
    expect(r.mensagens.map((m) => m.content)).toEqual(["caixa de julho", "R$ 10"]);
    expect(r.pergunta).toBe("e agosto?");
    expect(r.removidas).toEqual(["e agosto?", "R$ 12"]);
  });

  it("tira a pergunta que ainda não teve resposta", () => {
    const r = retirarUltimaPergunta([u("caixa de julho"), a("R$ 10"), u("O q")]);
    expect(r.mensagens).toHaveLength(2);
    expect(r.pergunta).toBe("O q");
  });

  it("leva junto o aviso de erro, que não é conteúdo", () => {
    const r = retirarUltimaPergunta([u("e agosto?"), a("Falhou.", { erro: true })]);
    expect(r.mensagens).toEqual([]);
    expect(r.removidas).toEqual(["e agosto?", "Falhou."]);
  });

  it("conversa sem pergunta nenhuma não muda", () => {
    const msgs = [a("Bom dia.")];
    const r = retirarUltimaPergunta(msgs);
    expect(r.mensagens).toBe(msgs);
    expect(r.pergunta).toBeNull();
    expect(r.removidas).toEqual([]);
  });

  it("não manda conteúdo vazio para o apagar do banco", () => {
    // Um `in ("")` apagaria toda mensagem vazia da conversa, não só esta.
    const r = retirarUltimaPergunta([u("foto da nota"), a("")]);
    expect(r.removidas).toEqual(["foto da nota"]);
  });
});

describe("aoParar", () => {
  it("resposta já começou: nada se perde", () => {
    const msgs = [u("por que o EBITDA caiu?"), a("Caiu por causa de…")];
    const r = aoParar(msgs);
    expect(r.mensagens).toBe(msgs);
    expect(r.pergunta).toBeNull();
  });

  it("nada chegou: a bolha vazia sai e a pergunta volta para a caixa", () => {
    const r = aoParar([u("caixa de julho"), a("R$ 10"), u("O q"), a("")]);
    expect(r.mensagens.map((m) => m.content)).toEqual(["caixa de julho", "R$ 10"]);
    expect(r.pergunta).toBe("O q");
    expect(r.removidas).toEqual(["O q"]);
  });

  it("parar antes de a bolha nascer também devolve a pergunta", () => {
    const r = aoParar([u("O q")]);
    expect(r.mensagens).toEqual([]);
    expect(r.pergunta).toBe("O q");
  });

  it("bolha só com espaços conta como vazia", () => {
    const r = aoParar([u("O q"), a("   ")]);
    expect(r.pergunta).toBe("O q");
  });
});
