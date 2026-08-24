import { describe, it, expect } from "vitest";
import { canonResp, respCobre, respExistentes, contarPorResp, AMBOS, SEM_RESP } from "./responsavel";

describe("canonResp", () => {
  it("junta as grafias que existiam no banco", () => {
    // As sete formas que a migration 20260824120000 encontrou em produção.
    expect(canonResp("Henrique")).toBe("Henrique");
    expect(canonResp("Henrique ")).toBe("Henrique");
    expect(canonResp("Júlia")).toBe("Júlia");
    expect(canonResp("Julia")).toBe("Júlia");
    expect(canonResp("Julia ")).toBe("Júlia");
    expect(canonResp("Júlia ")).toBe("Júlia");
  });

  it("trata vazio e nulo como sem responsável", () => {
    expect(canonResp(null)).toBeNull();
    expect(canonResp(undefined)).toBeNull();
    expect(canonResp("   ")).toBeNull();
  });

  it("não mexe em quem não é erro de digitação", () => {
    // RPA e VPX são respostas legítimas, não variantes de nome de gente.
    expect(canonResp("RPA")).toBe("RPA");
    expect(canonResp("VPX")).toBe("VPX");
  });

  it("não confunde Juliane com Júlia", () => {
    // O normalizeResp de /tarefas casa por prefixo ("juli") e erraria aqui —
    // há uma Juliane em lib_colaboradores.
    expect(canonResp("Juliane")).toBe("Juliane");
    expect(canonResp("Juliana Silva")).toBe("Juliana Silva");
  });
});

describe("respCobre", () => {
  it("filtro vazio deixa tudo passar", () => {
    expect(respCobre("Henrique", "")).toBe(true);
    expect(respCobre(null, "")).toBe(true);
  });

  it("casa a pessoa mesmo com a grafia velha", () => {
    expect(respCobre("Julia ", "Júlia")).toBe(true);
    expect(respCobre("Henrique ", "Henrique")).toBe(true);
    expect(respCobre("Henrique", "Júlia")).toBe(false);
  });

  it("Ambos aparece na fila das duas pessoas", () => {
    expect(respCobre(AMBOS, "Henrique")).toBe(true);
    expect(respCobre(AMBOS, "Júlia")).toBe(true);
  });

  it("Ambos não cobre quem não é pessoa", () => {
    expect(respCobre(AMBOS, "RPA")).toBe(false);
  });

  it("sem responsável é um filtro próprio", () => {
    expect(respCobre(null, SEM_RESP)).toBe(true);
    expect(respCobre("  ", SEM_RESP)).toBe(true);
    expect(respCobre("Henrique", SEM_RESP)).toBe(false);
    expect(respCobre(null, "Henrique")).toBe(false);
  });
});

describe("respExistentes", () => {
  it("põe as duas pessoas na frente mesmo sem linha nenhuma", () => {
    // Chip vazio é informação: ninguém pegou nada ainda.
    expect(respExistentes([])).toEqual(["Henrique", "Júlia"]);
  });

  it("acrescenta o que mais existir, em ordem, sem repetir", () => {
    expect(respExistentes(["VPX", "RPA", "Julia", "Henrique ", "RPA"]))
      .toEqual(["Henrique", "Júlia", "RPA", "VPX"]);
  });

  it("não dá chip próprio ao Ambos", () => {
    // Ele já está embutido nos dois chips de pessoa; um terceiro faria a mesma
    // automação ser contada em três lugares.
    expect(respExistentes([AMBOS, "Henrique"])).toEqual(["Henrique", "Júlia"]);
  });
});

describe("contarPorResp", () => {
  it("conta o Ambos dos dois lados", () => {
    const linhas = ["Henrique", "Júlia", AMBOS, "Julia ", null];
    expect(contarPorResp(linhas, "Henrique")).toBe(2); // Henrique + Ambos
    expect(contarPorResp(linhas, "Júlia")).toBe(3);    // Júlia + Julia  + Ambos
    expect(contarPorResp(linhas, SEM_RESP)).toBe(1);
  });
});
