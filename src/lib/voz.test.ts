import { describe, it, expect } from "vitest";
import { escolherVoz, prepararParaFala } from "./voz";

// Molde mínimo de SpeechSynthesisVoice — só os campos que `escolherVoz` lê.
const voz = (name: string, lang = "pt-BR") =>
  ({ name, lang, localService: false, default: false, voiceURI: name }) as SpeechSynthesisVoice;

describe("escolherVoz", () => {
  it("prefere a Thalita quando o Edge a oferece", () => {
    const vozes = [
      voz("Google português do Brasil"),
      voz("Microsoft Thalita Multilingual Online (Natural) - Portuguese (Brazil)"),
      voz("Microsoft Maria - Portuguese (Brazil)"),
    ];
    expect(escolherVoz(vozes)?.name).toMatch(/Thalita/);
  });

  it("cai para a voz do Google no Chrome, onde não há Thalita", () => {
    const vozes = [voz("Microsoft Maria - Portuguese (Brazil)"), voz("Google português do Brasil")];
    expect(escolherVoz(vozes)?.name).toBe("Google português do Brasil");
  });

  it("ignora vozes que não são em português", () => {
    const vozes = [voz("Microsoft Thalita Online (Natural)", "en-US"), voz("Microsoft Maria")];
    expect(escolherVoz(vozes)?.name).toBe("Microsoft Maria");
  });

  it("devolve null quando não há nenhuma voz em português", () => {
    expect(escolherVoz([voz("Microsoft David", "en-US")])).toBeNull();
    expect(escolherVoz([])).toBeNull();
  });
});

describe("prepararParaFala", () => {
  it("converte dinheiro para a forma falada", () => {
    expect(prepararParaFala("O caixa fechou em R$ 128.412,00.")).toBe(
      "O caixa fechou em 128 mil reais.",
    );
  });

  it("usa uma casa decimal só quando ela informa algo", () => {
    expect(prepararParaFala("R$ 1.250.000,00")).toBe("1,3 milhões de reais");
    expect(prepararParaFala("R$ 3.000.000,00")).toBe("3 milhões de reais");
  });

  it("não põe preposição depois de mil", () => {
    expect(prepararParaFala("R$ 128.412,00")).toBe("128 mil reais");
  });

  it("mantém valores pequenos exatos", () => {
    expect(prepararParaFala("R$ 847,00")).toBe("847 reais");
    expect(prepararParaFala("R$ 1,00")).toBe("1 real");
  });

  it("descarta casas decimais nulas do percentual", () => {
    expect(prepararParaFala("caiu 10,00% no mês")).toBe("caiu 10 por cento no mês");
    expect(prepararParaFala("margem de 18,50%")).toBe("margem de 18,5 por cento");
  });

  it("lê competência e data por extenso", () => {
    expect(prepararParaFala("DRE Omie, comp. 07/2026")).toBe("DRE Omie, comp. julho de 2026");
    expect(prepararParaFala("vence em 05/08/2026")).toBe("vence em 5 de agosto de 2026");
  });

  it("não mexe em texto sem número", () => {
    const t = "Júlia, sua reunião com o Henrique começa em breve.";
    expect(prepararParaFala(t)).toBe(t);
  });
});
