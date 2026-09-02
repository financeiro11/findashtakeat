import { describe, expect, it } from "vitest";
import {
  fraseDoResultado, itensAplicaveis, lerAcao, motivoSemBotao, paraLote, tituloDaAcao, totalDosItens,
  type AcaoTrocarCategoria, type ItemAcao,
} from "@/lib/acaoCelula";

/* A proposta chega do banco como `jsonb` e vira um botão que altera o ERP. As
   duas pontas desse caminho são o que se testa aqui: o que se aceita ler, e o
   que se deixa clicar. */

const item = (over: Partial<ItemAcao> = {}): ItemAcao => ({
  cod_titulo: "5491784664",
  data: "2026-08-12",
  mes: "Ago-26",
  contraparte: "PAYTIME",
  valor: 8204.1,
  grupo: "CONTA_A_RECEBER",
  categoria_codigo: "1.01.09",
  categoria_descricao: "1.1.9. Receita financeira",
  rubrica_atual: "(+) Receita financeira",
  ...over,
});

const troca = (over: Partial<AcaoTrocarCategoria> = {}): AcaoTrocarCategoria => ({
  tipo: "trocar_categoria",
  resumo: null,
  motivo: "É da Paytime, entra em markup.",
  categoria: { codigo: "1.01.02", descricao: "1.1.3. Receita Markup" },
  rubrica_destino: "Receita Markup",
  itens: [item()],
  recusados: [],
  total: 8204.1,
  ...over,
});

describe("lerAcao", () => {
  it("recusa o que não é proposta", () => {
    expect(lerAcao(null)).toBeNull();
    expect(lerAcao("trocar")).toBeNull();
    expect(lerAcao({})).toBeNull();
    expect(lerAcao({ tipo: "apagar_tudo" })).toBeNull();
  });

  /* A linha pode ter sido gravada por uma versão anterior da Edge Function. Um
     `acao.itens.map` num campo que virou objeto derruba a página inteira da
     DRE — não só o balão da célula. */
  it("sobrevive a uma proposta malformada", () => {
    expect(lerAcao({ tipo: "trocar_categoria" })).toBeNull();
    expect(lerAcao({ tipo: "trocar_categoria", categoria: {} })).toBeNull();
    const semItens = lerAcao({ tipo: "trocar_categoria", categoria: { codigo: "1.01.02" }, itens: "nada" });
    expect(semItens).toMatchObject({ itens: [], recusados: [] });
  });

  it("lê as três formas de correção", () => {
    expect(lerAcao(troca())).toMatchObject({ tipo: "trocar_categoria", rubrica_destino: "Receita Markup" });
    expect(lerAcao({ tipo: "apelido", nome: "JIM.COM GRUPO SOUZA", apelido: "Café dos eventos" }))
      .toMatchObject({ tipo: "apelido", apelido: "Café dos eventos" });
    expect(lerAcao({ tipo: "tarefa", titulo: "Conferir com a contabilidade" }))
      .toMatchObject({ tipo: "tarefa", titulo: "Conferir com a contabilidade" });
  });

  it("exige os campos que o botão vai usar", () => {
    expect(lerAcao({ tipo: "apelido", nome: "PAYTIME" })).toBeNull();
    expect(lerAcao({ tipo: "tarefa" })).toBeNull();
  });
});

describe("itensAplicaveis", () => {
  /* O servidor já barra estes, mas a tela não pode OFERECER o que o ERP vai
     recusar — se a peneira do servidor mudar, o botão continua contando certo. */
  it("deixa de fora previsão de OS e perna bancária", () => {
    const a = troca({
      itens: [
        item({ cod_titulo: "1" }),
        item({ cod_titulo: "2", grupo: "PREVISAO_ORDEM_SERVICO" }),
        item({ cod_titulo: "3", grupo: "CONTA_CORRENTE_CREDITO" }),
        item({ cod_titulo: "4", grupo: "CONTA_A_PAGAR" }),
      ],
    });
    expect(itensAplicaveis(a).map((i) => i.cod_titulo)).toEqual(["1", "4"]);
  });

  it("respeita o que a pessoa desmarcou", () => {
    const a = troca({ itens: [item({ cod_titulo: "1" }), item({ cod_titulo: "2" })] });
    expect(itensAplicaveis(a, new Set(["2"])).map((i) => i.cod_titulo)).toEqual(["2"]);
  });
});

describe("motivoSemBotao", () => {
  it("cala quando há o que aplicar", () => {
    expect(motivoSemBotao(troca())).toBeNull();
  });

  /* "A IA quis mover quatro títulos e nenhum pode ser mexido" é informação.
     Engolir isso deixaria a resposta prometendo uma correção que sumiu. */
  it("explica quando nada sobrou, sem repetir o mesmo motivo", () => {
    const a = troca({
      itens: [item({ grupo: "PREVISAO_CONTRATO" })],
      recusados: [
        { cod_titulo: "1", motivo: "já está nessa categoria" },
        { cod_titulo: "2", motivo: "já está nessa categoria" },
      ],
    });
    const msg = motivoSemBotao(a)!;
    expect(msg).toContain("Os 2 lançamentos apontados não podem");
    expect(msg.match(/já está nessa categoria/g)).toHaveLength(1);
  });

  it("não fala de botão em proposta que não é de categoria", () => {
    expect(motivoSemBotao({ tipo: "tarefa", resumo: null, motivo: null, titulo: "x", responsavel: null })).toBeNull();
  });
});

describe("tituloDaAcao", () => {
  it("prefere o resumo que a IA escreveu", () => {
    expect(tituloDaAcao(troca({ resumo: "3 lançamentos da Paytime → Receita Markup" })))
      .toBe("3 lançamentos da Paytime → Receita Markup");
  });

  /* Um cartão sem título é um botão sem legenda — e este botão altera o ERP. */
  it("nunca fica em branco, e concorda em número", () => {
    expect(tituloDaAcao(troca())).toBe("Mover 1 lançamento para Receita Markup");
    expect(tituloDaAcao(troca({ itens: [item({ cod_titulo: "1" }), item({ cod_titulo: "2" })] })))
      .toBe("Mover 2 lançamentos para Receita Markup");
  });

  it("cai na categoria quando o destino está fora do DE-PARA", () => {
    expect(tituloDaAcao(troca({ rubrica_destino: null }))).toBe("Mover 1 lançamento para 1.1.3. Receita Markup");
  });
});

describe("totalDosItens e paraLote", () => {
  it("soma com o sinal da demonstração", () => {
    expect(totalDosItens([item({ valor: 100 }), item({ valor: -30 })])).toBe(70);
  });

  it("traduz para o laço que já existe", () => {
    expect(paraLote([item()])[0]).toEqual({
      codTitulo: "5491784664",
      contraparte: "PAYTIME",
      valor: 8204.1,
      categoriaCodigo: "1.01.09",
      categoriaDescricao: "1.1.9. Receita financeira",
    });
  });
});

describe("fraseDoResultado", () => {
  it("conta o que foi e o que não foi", () => {
    expect(fraseDoResultado({ tipo: "trocar_categoria", ok: 3 })).toBe("3 lançamentos alterados no Omie.");
    expect(fraseDoResultado({ tipo: "trocar_categoria", ok: 1 })).toBe("1 lançamento alterado no Omie.");
    expect(fraseDoResultado({
      tipo: "trocar_categoria", ok: 2, falhas: [{ cod_titulo: "9", erro: "período fechado" }], naoTentados: 5,
    })).toBe("2 alterados, 1 recusado(s), 5 não tentado(s).");
    expect(fraseDoResultado({
      tipo: "trocar_categoria", ok: 0, falhas: [{ cod_titulo: "9", erro: "período fechado" }],
    })).toBe("Nenhum lançamento foi alterado — 1 recusado(s).");
  });

  it("fala a língua de cada tipo de correção", () => {
    expect(fraseDoResultado({ tipo: "apelido", ok: 1 })).toBe("Apelido cadastrado.");
    expect(fraseDoResultado({ tipo: "tarefa", ok: 1 })).toBe("Subtarefa criada no card Fechamento.");
  });
});
