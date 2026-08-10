import { describe, it, expect } from "vitest";
import {
  chavePessoa,
  montarMapaPessoas,
  pessoaDe,
  pessoasNoTexto,
  jaMapeado,
  sugestaoDeNome,
} from "@/lib/pessoasPJ";

/* Os casos vieram do comentário real que motivou o recurso — o de Equipe
   Comercial em Jul/26, que citava DALBER NEGOCIOS, C M SOLUCOES E SERVICOS LTDA
   e R M DA SILVA CONSULTORIA COMERCIAL como se fossem empresas. */

const MAPA = montarMapaPessoas([
  { nome: "DALBER NEGOCIOS", pessoa: "Dalber" },
  { nome: "C M SOLUCOES E SERVICOS LTDA", pessoa: "Carla Mendes" },
  { nome: "R M DA SILVA CONSULTORIA COMERCIAL", pessoa: "Rafael Silva" },
]);

describe("chavePessoa", () => {
  it("ignora caixa, acento e pontuação", () => {
    expect(chavePessoa("C M Soluções e Serviços Ltda.")).toBe(chavePessoa("C M SOLUCOES E SERVICOS LTDA"));
  });

  it("descarta o sufixo societário, inclusive empilhado", () => {
    expect(chavePessoa("FULANO SERVICOS LTDA ME")).toBe("FULANO SERVICOS");
    expect(chavePessoa("FULANO SERVICOS EIRELI")).toBe("FULANO SERVICOS");
    expect(chavePessoa("FULANO SERVICOS S/A")).toBe("FULANO SERVICOS");
  });

  it("descarta CNPJ colado na razão social", () => {
    expect(chavePessoa("12.345.678/0001-99 DALBER NEGOCIOS")).toBe("DALBER NEGOCIOS");
  });

  it("não come palavra que só PARECE sufixo no meio do nome", () => {
    expect(chavePessoa("ME CONSULTORIA DIGITAL")).toBe("ME CONSULTORIA DIGITAL");
  });
});

describe("pessoaDe", () => {
  it("troca a razão social cadastrada pelo nome da pessoa", () => {
    expect(pessoaDe(MAPA, "DALBER NEGOCIOS")).toBe("Dalber");
    expect(pessoaDe(MAPA, "C M SOLUCOES E SERVICOS LTDA")).toBe("Carla Mendes");
  });

  it("casa a mesma empresa escrita de outro jeito", () => {
    expect(pessoaDe(MAPA, "C M Soluções e Serviços")).toBe("Carla Mendes");
    expect(pessoaDe(MAPA, "DALBER NEGOCIOS LTDA")).toBe("Dalber");
  });

  it("devolve intacto quem não está no de-para", () => {
    expect(pessoaDe(MAPA, "GOOGLE CLOUD BRASIL")).toBe("GOOGLE CLOUD BRASIL");
    expect(pessoaDe(MAPA, "")).toBe("");
  });
});

describe("pessoasNoTexto", () => {
  it("corrige o comentário inteiro sem estragar o resto da frase", () => {
    const antes =
      "A queda de R$ 14,7k na equipe comercial em Jul/26 vem principalmente da saída de "
      + "DALBER NEGOCIOS (-R$ 27,2k) e C M SOLUCOES E SERVICOS LTDA (-R$ 3,0k), além da "
      + "R M DA SILVA CONSULTORIA COMERCIAL (-R$ 2,7k).";
    expect(pessoasNoTexto(MAPA, antes)).toBe(
      "A queda de R$ 14,7k na equipe comercial em Jul/26 vem principalmente da saída de "
      + "Dalber (-R$ 27,2k) e Carla Mendes (-R$ 3,0k), além da "
      + "Rafael Silva (-R$ 2,7k).",
    );
  });

  it("pega a grafia que o modelo reescreveu com acento e caixa mista", () => {
    expect(pessoasNoTexto(MAPA, "o gasto com C M Soluções e Serviços subiu")).toBe(
      "o gasto com Carla Mendes subiu",
    );
  });

  it("prefere a correspondência mais longa", () => {
    const m = montarMapaPessoas([
      { nome: "DALBER", pessoa: "Dalber (só o nome)" },
      { nome: "DALBER NEGOCIOS", pessoa: "Dalber" },
    ]);
    expect(pessoasNoTexto(m, "saída de DALBER NEGOCIOS no mês")).toBe("saída de Dalber no mês");
  });

  it("não mexe em texto sem nenhuma razão social cadastrada", () => {
    const t = "Número elevado devido ao pagamento da AWS e do Ingram (24k e 57k).";
    expect(pessoasNoTexto(MAPA, t)).toBe(t);
  });

  it("é inerte com mapa vazio", () => {
    const vazio = montarMapaPessoas([]);
    expect(pessoasNoTexto(vazio, "DALBER NEGOCIOS caiu")).toBe("DALBER NEGOCIOS caiu");
  });

  it("aguenta nulo e string vazia", () => {
    expect(pessoasNoTexto(MAPA, null)).toBe("");
    expect(pessoasNoTexto(MAPA, "")).toBe("");
  });
});

describe("montarMapaPessoas", () => {
  it("recusa chave curta demais, que casaria palavra comum", () => {
    const m = montarMapaPessoas([{ nome: "SA", pessoa: "Fulano" }, { nome: "EI", pessoa: "Beltrano" }]);
    expect(m.porChave.size).toBe(0);
  });

  it("recusa linha sem nome ou sem pessoa", () => {
    const m = montarMapaPessoas([
      { nome: "DALBER NEGOCIOS", pessoa: "" },
      { nome: "", pessoa: "Dalber" },
    ]);
    expect(m.porChave.size).toBe(0);
  });

  it("a primeira grafia ganha quando duas caem na mesma chave", () => {
    const m = montarMapaPessoas([
      { nome: "DALBER NEGOCIOS", pessoa: "Dalber" },
      { nome: "DALBER NEGOCIOS LTDA", pessoa: "Outro" },
    ]);
    expect(pessoaDe(m, "DALBER NEGOCIOS")).toBe("Dalber");
  });
});

describe("jaMapeado", () => {
  it("reconhece a razão social já cadastrada, em qualquer grafia", () => {
    expect(jaMapeado(MAPA, "dalber negocios ltda")).toBe(true);
    expect(jaMapeado(MAPA, "GOOGLE CLOUD")).toBe(false);
  });
});

describe("sugestaoDeNome", () => {
  it("arruma a caixa para quem for digitar não começar do vazio", () => {
    expect(sugestaoDeNome("DALBER NEGOCIOS")).toBe("Dalber Negocios");
    expect(sugestaoDeNome("C M SOLUCOES E SERVICOS LTDA")).toBe("C M Solucoes E Servicos");
  });
});
