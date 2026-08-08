import { describe, it, expect } from "vitest";
import { marcarFalha, tirarPerguntaFalha } from "./chat";
import type { MsgAssistente } from "@/lib/assistente";

const pergunta = (content: string, erro?: boolean): MsgAssistente => ({ role: "user", content, erro });
const resposta = (content: string): MsgAssistente => ({ role: "assistant", content });

describe("marcarFalha", () => {
  it("tira a bolha vazia do assistente e marca a pergunta", () => {
    const saida = marcarFalha([pergunta("Qual foi o caixa?"), resposta("")]);
    expect(saida).toHaveLength(1);
    expect(saida[0]).toMatchObject({ role: "user", erro: true });
  });

  it("falha antes de a bolha nascer: marca a pergunta direto", () => {
    const saida = marcarFalha([pergunta("Qual foi o caixa?")]);
    expect(saida).toHaveLength(1);
    expect(saida[0].erro).toBe(true);
  });

  it("resposta que chegou pela metade fica na tela — o que veio vale", () => {
    const saida = marcarFalha([pergunta("Qual foi o caixa?"), resposta("O caixa de julho")]);
    expect(saida).toHaveLength(2);
    expect(saida[1].content).toBe("O caixa de julho");
    expect(saida.some((m) => m.erro)).toBe(false);
  });

  it("não mexe nas mensagens anteriores da conversa", () => {
    const saida = marcarFalha([pergunta("primeira"), resposta("ok"), pergunta("segunda"), resposta("")]);
    expect(saida.map((m) => m.content)).toEqual(["primeira", "ok", "segunda"]);
    expect(saida[0].erro).toBeUndefined();
    expect(saida[2].erro).toBe(true);
  });
});

describe("tirarPerguntaFalha", () => {
  it("remove a pergunta marcada antes do reenvio", () => {
    expect(tirarPerguntaFalha([resposta("ok"), pergunta("de novo", true)])).toHaveLength(1);
  });

  it("não remove pergunta que não falhou", () => {
    expect(tirarPerguntaFalha([pergunta("normal")])).toHaveLength(1);
  });

  it("ida e volta não duplica a pergunta", () => {
    const depoisDaFalha = marcarFalha([pergunta("Qual foi o caixa?"), resposta("")]);
    expect(tirarPerguntaFalha(depoisDaFalha)).toHaveLength(0);
  });
});
