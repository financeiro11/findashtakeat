/**
 * A leitura do e-mail de desligamento.
 *
 * Os formatos daqui são os que a caixa financeiro@ recebe de verdade (lidos em
 * 15/09/2026), com nomes trocados: o assunto sem nome ("Solicitação de
 * Desligamento"), a linha "Nome do colaborador;" com ponto e vírgula, o
 * "*Nome: *" do Gmail em negrito, a grafia do gestor diferente da ficha, e a
 * resposta que cita o formulário original com ">".
 *
 * O que este teste mais prende é o que a IA NÃO decide: se o desligamento
 * custa uma remuneração de multa ou zero. E o caso em que nenhum lado se
 * escolhe — tipo e motivo discordando — tem que sair nulo, porque nulo vira
 * pergunta na tela.
 */

import { describe, expect, it } from "vitest";
import {
  classificarDesligamento, classificarMotivo, consultaDoDesligamento, nomesDeclarados,
  normalizarExtracao, reconhecerPessoa, textoParaExtracao, tipoEscrito, triarConversas,
} from "../../supabase/functions/_shared/rescisao-email.ts";

describe("busca na caixa", () => {
  it("procura as duas grafias no assunto, sem o nome", () => {
    const q = consultaDoDesligamento(null);
    expect(q).toContain("subject:Desligamento");
    expect(q).toContain("subject:Delisgamento");
    expect(q).not.toContain("after:");
  });

  it("recorta 30 dias antes e 60 depois da saída — o e-mail já chegou um mês atrasado", () => {
    const q = consultaDoDesligamento("2026-09-10");
    expect(q).toContain("after:2026/08/11");
    expect(q).toContain("before:2026/11/10");
  });
});

describe("quem é a pessoa", () => {
  it("lê as linhas de nome nos formatos que os gestores usam", () => {
    expect(nomesDeclarados("-Nome do colaborador; Caio Guillermo\n-Cargo; Suporte")).toEqual(["Caio Guillermo"]);
    expect(nomesDeclarados("*Nome: *Gabriela Pires Trindade\n*Cargo:* Gerente")).toEqual(["Gabriela Pires Trindade"]);
    expect(nomesDeclarados("> Nome: Marcelo Antunes\n> Cargo: Executivo")).toEqual(["Marcelo Antunes"]);
    expect(nomesDeclarados("Nome da empresa: Takeat")).toEqual([]);
  });

  it("primeiro nome e sobrenome é a pessoa, mesmo com nome do meio faltando", () => {
    expect(reconhecerPessoa("Marcelo Ramires Antunes", "Nome: Marcelo Antunes")).toBe("certo");
  });

  it("só o primeiro nome não basta — outro Marcelo não é este", () => {
    expect(reconhecerPessoa("Marcelo Ramires Antunes", "Nome: José Marcelo Fiaes")).toBe("so-primeiro-nome");
  });

  it("aceita a grafia do gestor a uma letra da ficha", () => {
    expect(reconhecerPessoa("Caio Calmon Baptisti", "-Nome do colaborador; Caio Baptista")).toBe("certo");
  });

  it("mas não em nome curto, onde uma letra já é outra pessoa", () => {
    expect(reconhecerPessoa("Rui Luz Mota", "Nome: Rui Lu")).toBe("so-primeiro-nome");
  });

  it("com linha de nome, a assinatura de quem responde não conta", () => {
    const texto = "Nome: Pedro Lima\nCargo: Analista\n\nAtt,\nAna Clara Mongin\nRH";
    expect(reconhecerPessoa("Ana Clara Souza", texto)).toBe("nao");
  });

  it("sem linha de nome, procura no texto todo", () => {
    expect(reconhecerPessoa("Gabriela Pires", "Desligamento Voluntário Gabriela Pires Trindade")).toBe("certo");
  });
});

describe("quais conversas ler", () => {
  const conv = (threadId: string, data: string, texto: string) => ({
    threadId, data, texto, assunto: "Solicitação de Desligamento", remetente: "gestor@takeat.app",
  });

  it("separa a pessoa certa do homônimo de primeiro nome", () => {
    const { certas, duvidosas } = triarConversas("Marcelo Ramires Antunes", "2026-09-10", [
      conv("a", "2026-08-06", "Nome: José Marcelo Fiaes\nCargo: Executivo"),
      conv("b", "2026-09-11", "Corrigindo: é voluntário.\n\n> Nome: Marcelo Antunes\n> Cargo: Executivo"),
    ]);
    expect(certas.map((c) => c.threadId)).toEqual(["b"]);
    expect(duvidosas.map((c) => c.threadId)).toEqual(["a"]);
  });

  it("fica com as três mais perto da saída, em ordem cronológica", () => {
    const nome = "Nome: Julia Schaider";
    const { certas } = triarConversas("Julia Schaider Alexandre", "2026-08-07", [
      conv("longe", "2026-06-01", nome),
      conv("depois", "2026-08-16", nome),
      conv("antes", "2026-08-05", nome),
      conv("dia", "2026-08-07", nome),
    ]);
    expect(certas.map((c) => c.threadId)).toEqual(["antes", "dia", "depois"]);
  });
});

describe("classificação", () => {
  it("o motivo voluntário, inclusive como o gestor escreve de verdade", () => {
    expect(classificarMotivo("Pedido de demissão")).toBe("voluntario");
    expect(classificarMotivo("Mudança de carreira")).toBe("voluntario");
    expect(classificarMotivo("O mesmo está passando problemas pessoais e ele mesmo pediu desligamento.")).toBe("voluntario");
    expect(classificarMotivo("Vai evoluir num projeto pessoal, da empresa que ele tem")).toBe("voluntario");
  });

  it("o motivo involuntário", () => {
    expect(classificarMotivo("Baixo desempenho")).toBe("involuntario");
    expect(classificarMotivo("Reestruturação estratégica")).toBe("involuntario");
    expect(classificarMotivo("Reprovação no período de experiência")).toBe("involuntario");
  });

  it("'involuntário' escrito no motivo não puxa para os dois lados — ele contém 'voluntário'", () => {
    expect(classificarMotivo("Desligamento involuntário")).toBe("involuntario");
  });

  it("o ambíguo sai nulo", () => {
    expect(classificarMotivo("Saída acordada")).toBeNull();
    expect(classificarMotivo("Não está mais na empresa")).toBeNull();
    expect(classificarMotivo("")).toBeNull();
  });

  it("lê o campo de tipo nos formatos do formulário", () => {
    expect(tipoEscrito("-Voluntário")).toBe("voluntario");
    expect(tipoEscrito("Involuntário.")).toBe("involuntario");
    expect(tipoEscrito("")).toBeNull();
  });

  it("tipo e motivo concordando, ou só um falando, vale o que falou", () => {
    expect(classificarDesligamento("Involuntário", "Desempenho comportamental"))
      .toEqual({ classificacao: "involuntario", conflito: false });
    expect(classificarDesligamento("Voluntário", "Vai viajar por três meses"))
      .toEqual({ classificacao: "voluntario", conflito: false });
    expect(classificarDesligamento("", "Pedido de demissão"))
      .toEqual({ classificacao: "voluntario", conflito: false });
  });

  it("tipo e motivo discordando não escolhem lado — a tela pergunta", () => {
    expect(classificarDesligamento("Voluntário", "Desempenho comportamental"))
      .toEqual({ classificacao: null, conflito: true });
  });
});

describe("o que vai para a IA", () => {
  it("monta as conversas em ordem, com remetente e data de cada mensagem", () => {
    const t = textoParaExtracao("Marcelo Ramires Antunes", [
      {
        assunto: "Desligamento - Eventos",
        mensagens: [
          { data: "2026-08-05", remetente: "Gestora", corpo: "Data da rescisão: 31/08/2026" },
          { data: "2026-08-16", remetente: "Gestora", corpo: "Data da rescisão: 16/08/2026" },
        ],
      },
    ]);
    expect(t).toContain("Colaborador: Marcelo Ramires Antunes");
    expect(t.indexOf("31/08/2026")).toBeLessThan(t.indexOf("16/08/2026"));
    expect(t).toContain("--- Mensagem de Gestora, em 2026-08-16 ---");
  });
});

describe("normalização do que a IA devolveu", () => {
  it("os sentinelas do prompt voltam a ser 'não informado'", () => {
    const c = normalizarExtracao({
      nomeNoEmail: "", ultimoDia: "", remuneracao: 0, variavel: -1, variavelTexto: "",
      diasDeFeriasTirados: -1, feriasTexto: "", tipo: "", motivo: "",
    });
    expect(c).toEqual({
      nomeNoEmail: null, ultimoDia: null, remuneracao: null, variavel: null, variavelTexto: null,
      diasDeFeriasTirados: null, feriasTexto: null, tipo: null, motivo: null,
    });
  });

  it("zero é resposta, não ausência", () => {
    expect(normalizarExtracao({ diasDeFeriasTirados: 0 }).diasDeFeriasTirados).toBe(0);
    expect(normalizarExtracao({ variavel: 0 }).variavel).toBe(0);
  });

  it("guarda o que o e-mail escreveu, para quem confere", () => {
    const c = normalizarExtracao({ variavel: 606, variavelTexto: "396 (comissão) + 210,00\n(plantão)" });
    expect(c.variavel).toBe(606);
    expect(c.variavelTexto).toBe("396 (comissão) + 210,00 (plantão)");
  });

  it("texto com mais de um número não vira um número colado", () => {
    expect(normalizarExtracao({ variavel: "396 + 210,00" }).variavel).toBeNull();
  });

  it("dinheiro e data escritos à brasileira", () => {
    expect(normalizarExtracao({ remuneracao: "R$ 3.700,00" }).remuneracao).toBe(3700);
    expect(normalizarExtracao({ ultimoDia: "16/08/2026" }).ultimoDia).toBe("2026-08-16");
    expect(normalizarExtracao({ ultimoDia: "31/08" }).ultimoDia).toBeNull();
  });

  it("objeto vazio não quebra", () => {
    expect(normalizarExtracao(null).motivo).toBeNull();
  });
});
