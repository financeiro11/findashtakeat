import { describe, expect, it } from "vitest";
import { avisoDeConclusao, textoDoAviso } from "./conclusao";

const hoje = "2026-09-18";

describe("avisoDeConclusao — só pergunta quando há o que perguntar", () => {
  it("prazo vencido não pergunta nada", () => {
    // O caso que motivou a reescrita: o card do "Relatório Caixa Semanal" venceu
    // ontem. Concluir uma tarefa atrasada é o curso normal das coisas.
    expect(avisoDeConclusao({ titulo: "Relatório Caixa Semanal", prazoAntes: "2026-09-17", hoje }))
      .toBeNull();
  });

  it("prazo de hoje não pergunta nada", () => {
    expect(avisoDeConclusao({ titulo: "Estornos", prazoAntes: "2026-09-18", hoje })).toBeNull();
  });

  it("sem prazo não pergunta nada", () => {
    expect(avisoDeConclusao({ titulo: "Avulsa", prazoAntes: null, hoje })).toBeNull();
  });

  it("prazo no futuro pergunta, citando a data e a distância por extenso", () => {
    const a = avisoDeConclusao({ titulo: "Pauta <> Weekly", prazoAntes: "2026-09-21", hoje })!;
    expect(a.titulo).toBe("Concluir antes do prazo?");
    expect(a.linhas[0]).toBe("“Pauta <> Weekly” vence em 21/09/2026 — daqui a 3 dias.");
    expect(a.confirmar).toBe("Concluir mesmo assim");
  });

  it("amanhã é 'amanhã', não 'daqui a 1 dias'", () => {
    const a = avisoDeConclusao({ titulo: "X", prazoAntes: "2026-09-19", hoje })!;
    expect(a.linhas[0]).toContain("amanhã");
  });
});

describe("avisoDeConclusao — a data nova nunca aparece sozinha", () => {
  it("diz que o prazo está mudando no mesmo salvamento", () => {
    // Não se pergunta sobre um número que a pessoa está vendo pela primeira vez:
    // o cartão mostrava 17/09 e o salvar levaria 21/09.
    const a = avisoDeConclusao({
      titulo: "Relatório Caixa Semanal",
      prazoAntes: "2026-09-17",
      prazoDepois: "2026-09-21",
      hoje,
    })!;
    expect(a.linhas[0]).toContain("21/09/2026");
    expect(a.linhas[1]).toBe(
      "Atenção: neste mesmo salvamento o prazo está mudando de 17/09/2026 para 21/09/2026.",
    );
  });

  it("prazo inalterado não ganha a linha da mudança", () => {
    const a = avisoDeConclusao({
      titulo: "X", prazoAntes: "2026-09-21", prazoDepois: "2026-09-21", hoje,
    })!;
    expect(a.linhas.some(l => l.startsWith("Atenção:"))).toBe(false);
  });

  it("quem decide é o prazo QUE VAI SER GRAVADO", () => {
    // Mudar a data para o passado e concluir no mesmo salvar não é adiantamento.
    expect(avisoDeConclusao({
      titulo: "X", prazoAntes: "2026-09-21", prazoDepois: "2026-09-16", hoje,
    })).toBeNull();
  });
});

describe("avisoDeConclusao — rotina", () => {
  it("avisa que a ocorrência seguinte não se perde", () => {
    const a = avisoDeConclusao({ titulo: "X", prazoAntes: "2026-09-21", rotina: true, hoje })!;
    expect(a.linhas.at(-1)).toContain("ainda vai nascer");
  });

  it("tarefa comum não fala de rotina", () => {
    const a = avisoDeConclusao({ titulo: "X", prazoAntes: "2026-09-21", hoje })!;
    expect(a.linhas.join(" ")).not.toContain("rotina");
  });
});

describe("textoDoAviso", () => {
  it("serve o mesmo conteúdo em texto corrido para o confirm() do celular", () => {
    const a = avisoDeConclusao({ titulo: "X", prazoAntes: "2026-09-21", hoje })!;
    const t = textoDoAviso(a);
    expect(t.startsWith("Concluir antes do prazo?")).toBe(true);
    a.linhas.forEach(l => expect(t).toContain(l));
  });
});
