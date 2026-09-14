/**
 * Excluir comprovante errado: qual arquivo sai, e o que volta atrás.
 *
 * Por que este teste existe: apagar anexo no Omie não tem desfazer. O Hub
 * sobe o arquivo com o nome "seguro" (sem acento, foto vira .pdf), e comparar
 * só com o nome original deixaria de pré-marcar o arquivo certo — ou, pior,
 * com um casamento frouxo, marcaria a nota boa que alguém anexou à mão.
 */
import { describe, expect, it } from "vitest";
import {
  anexosParaEscolher,
  desfazerAprovacao,
  leituraDoTitulo,
  nomeDoCaminho,
  nomesDoHubNoOmie,
  resolverExclusao,
} from "../../supabase/functions/_shared/anexo-exclusao";

describe("nomeDoCaminho", () => {
  it("tira a pasta e o carimbo de tempo do caminho no bucket", () => {
    expect(nomeDoCaminho("hub/ACH-202609-1/1787000000000_nota fiscal.pdf")).toBe("nota fiscal.pdf");
  });
  it("não inventa nome para URL do Drive", () => {
    expect(nomeDoCaminho("https://drive.google.com/file/d/abc/view")).toBeNull();
  });
  it("vazio é nulo", () => {
    expect(nomeDoCaminho(null)).toBeNull();
    expect(nomeDoCaminho("  ")).toBeNull();
  });
});

describe("nomesDoHubNoOmie", () => {
  it("reconhece o nome sem acento e a foto que virou PDF", () => {
    const nomes = nomesDoHubNoOmie("foto açaí.jpg");
    expect(nomes.has("foto açaí.jpg")).toBe(true);
    expect(nomes.has("foto_acai.pdf")).toBe(true);
  });
  it("sem nome, nada casa", () => {
    expect(nomesDoHubNoOmie(null).size).toBe(0);
  });
});

describe("anexosParaEscolher", () => {
  it("marca como do Hub só o arquivo que o Hub mandou", () => {
    const lista = anexosParaEscolher(
      [{ id: "1", nome: "nota_errada.pdf" }, { id: "2", nome: "NF 123 posta a mao.pdf" }],
      "nota errada.pdf",
    );
    expect(lista.map((a) => a.do_hub)).toEqual([true, false]);
  });
  it("aponta nome repetido e anexo sem id", () => {
    const lista = anexosParaEscolher(
      [{ id: "1", nome: "a.pdf" }, { id: "2", nome: "a.pdf" }, { id: null, nome: "b.pdf" }],
      null,
    );
    expect(lista.map((a) => [a.repetido, a.sem_id])).toEqual([[true, false], [true, false], [false, true]]);
  });
});

describe("resolverExclusao", () => {
  const anexos = [
    { id: "10", nome: "certo.pdf" },
    { id: "11", nome: "dup.pdf" },
    { id: "12", nome: "dup.pdf" },
    { id: null, nome: "sem-id.pdf" },
  ];
  it("apaga o que é único e recusa o resto com o motivo", () => {
    const r = resolverExclusao(anexos, ["certo.pdf", "dup.pdf", "sem-id.pdf", "sumiu.pdf"]);
    expect(r.apagar).toEqual([{ nome: "certo.pdf", id: "10" }]);
    expect(r.recusas).toEqual([
      { nome: "dup.pdf", motivo: "nome_repetido" },
      { nome: "sem-id.pdf", motivo: "sem_id" },
      { nome: "sumiu.pdf", motivo: "nao_achei" },
    ]);
  });
  it("pedido repetido não vira duas exclusões", () => {
    expect(resolverExclusao(anexos, ["certo.pdf", "certo.pdf", " "]).apagar).toHaveLength(1);
  });
});

describe("leituraDoTitulo", () => {
  it("sem anexo: parece_nota é nulo, não falso", () => {
    expect(leituraDoTitulo([])).toEqual({ qtd: 0, parece_nota: null, classe: null });
  });
  it("a melhor classe vale", () => {
    const r = leituraDoTitulo([{ id: "1", nome: "print.png" }, { id: "2", nome: "nota fiscal 123.pdf" }]);
    expect(r.qtd).toBe(2);
    expect(r.classe).toBe("nota");
    expect(r.parece_nota).toBe(true);
  });
});

describe("desfazerAprovacao", () => {
  const link = "hub/ACH-1/1787000000000_errado.pdf";
  const aprovadoPelaIa = {
    status: "Aprovado",
    ia_aprovado_em: "2026-09-10T10:00:00Z",
    ia_arquivo: link,
    trilha: [
      { tipo: "comprovante_anexado" },
      { tipo: "aprovacao_automatica", de: "Em análise", para: "Aprovado" },
    ],
  };
  it("volta para o status de antes da aprovação automática", () => {
    expect(desfazerAprovacao(aprovadoPelaIa, link)).toEqual({ status: "Em análise" });
  });
  it("sem registro na trilha, volta para Pendente", () => {
    expect(desfazerAprovacao({ ...aprovadoPelaIa, trilha: [] }, link)).toEqual({ status: "Pendente" });
  });
  it("não mexe em aprovação de gente", () => {
    expect(desfazerAprovacao({ ...aprovadoPelaIa, ia_aprovado_em: null }, link)).toBeNull();
  });
  it("não mexe em aprovação que leu outro arquivo", () => {
    expect(desfazerAprovacao({ ...aprovadoPelaIa, ia_arquivo: "hub/ACH-1/outro.pdf" }, link)).toBeNull();
  });
});
