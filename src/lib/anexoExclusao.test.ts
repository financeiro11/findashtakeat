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
  achadoSemComprovante,
  anexosParaEscolher,
  leituraDoTitulo,
  nomeDoCaminho,
  nomesDoHubNoOmie,
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
    // o id vai para a tela e volta na exclusão — é o que evita reler o título
    expect(lista.map((a) => a.id)).toEqual(["1", "2"]);
  });
  it("aponta nome repetido e anexo sem id", () => {
    const lista = anexosParaEscolher(
      [{ id: "1", nome: "a.pdf" }, { id: "2", nome: "a.pdf" }, { id: null, nome: "b.pdf" }],
      null,
    );
    expect(lista.map((a) => [a.repetido, a.sem_id])).toEqual([[true, false], [true, false], [false, true]]);
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

describe("achadoSemComprovante", () => {
  it("o reprovado COM NF volta para SEM NF e Pendente (o caso do Mage Burger)", () => {
    expect(achadoSemComprovante({ status: "Reprovado", categoria: "COM NF" })).toEqual({
      status: "Pendente",
      categoria: "SEM NF",
      mudancas: ["categoria → SEM NF", "status → Pendente"],
    });
  });
  it("aprovação de gente também cai", () => {
    expect(achadoSemComprovante({ status: "Aprovado", categoria: "A CONFERIR" }).status).toBe("Pendente");
  });
  it("FORA DE ESCOPO continua fora de escopo", () => {
    expect(achadoSemComprovante({ status: "Aprovado", categoria: "FORA DE ESCOPO" }).categoria).toBe("FORA DE ESCOPO");
  });
  it("já na fila, não inventa mudança para a trilha", () => {
    expect(achadoSemComprovante({ status: "Pendente", categoria: "SEM NF" }).mudancas).toEqual([]);
  });
});
