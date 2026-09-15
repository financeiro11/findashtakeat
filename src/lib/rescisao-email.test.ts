/**
 * A leitura do e-mail de desligamento.
 *
 * O que este teste prende é o que a IA NÃO decide. O modelo copia o motivo como
 * o gestor escreveu; quem diz se aquilo custa uma remuneração de multa ou zero
 * é `classificarMotivo`, aqui, determinístico — e o caso ambíguo ("saída
 * acordada") tem que sair nulo, porque nulo vira pergunta na tela e o chute
 * viraria um mês de salário a mais ou a menos.
 *
 * Prende também o typo: "Delisgamento" é como saiu boa parte dos e-mails
 * antigos, e procurar só a grafia certa perde o histórico inteiro.
 */

import { describe, expect, it } from "vitest";
import {
  classificarMotivo, consultasDoDesligamento, escolherEmail, normalizarExtracao,
  pontuarAssunto,
} from "../../supabase/functions/_shared/rescisao-email.ts";

describe("busca na caixa", () => {
  it("procura as duas grafias, a certa e o typo", () => {
    const [exata] = consultasDoDesligamento("Maria Silva");
    expect(exata).toContain('subject:"Desligamento Maria Silva"');
    expect(exata).toContain('subject:"Delisgamento Maria Silva"');
  });

  it("tem uma segunda consulta, mais aberta, para o assunto que só traz o primeiro nome", () => {
    const consultas = consultasDoDesligamento("Maria Silva");
    expect(consultas).toHaveLength(2);
    expect(consultas[1]).toContain('"Maria"');
  });

  it("nome vazio não vira busca", () => {
    expect(consultasDoDesligamento("  ")).toHaveLength(0);
  });
});

describe("qual e-mail é o da pessoa", () => {
  it("pontua pela fração dos nomes que aparecem no assunto", () => {
    expect(pontuarAssunto("Maria Silva", "Desligamento Maria Silva")).toBe(1);
    expect(pontuarAssunto("Maria Silva", "Desligamento Maria")).toBe(0.5);
    expect(pontuarAssunto("Maria Silva", "Desligamento João Souza")).toBe(0);
  });

  it("ignora acento e caixa", () => {
    expect(pontuarAssunto("João Inácio", "DELISGAMENTO JOAO INACIO")).toBe(1);
  });

  it("partículas não contam — 'de' casaria com meio mundo", () => {
    expect(pontuarAssunto("Ana de Souza", "Desligamento de alguém")).toBe(0);
  });

  it("escolhe o de maior pontuação", () => {
    const { escolhido } = escolherEmail("Maria Silva", [
      { id: "a", assunto: "Desligamento Maria", data: "2026-07-01" },
      { id: "b", assunto: "Desligamento Maria Silva", data: "2026-07-02" },
    ]);
    expect(escolhido?.id).toBe("b");
  });

  it("homônimo com datas diferentes volta para alguém escolher", () => {
    const { escolhido, ambiguos } = escolherEmail("Maria Silva", [
      { id: "a", assunto: "Desligamento Maria Silva", data: "2025-03-01" },
      { id: "b", assunto: "Desligamento Maria Silva", data: "2026-07-02" },
    ]);
    expect(escolhido).toBeNull();
    expect(ambiguos.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("a mesma data em duplicata é o mesmo desligamento, e passa", () => {
    const { escolhido } = escolherEmail("Maria Silva", [
      { id: "a", assunto: "Desligamento Maria Silva", data: "2026-07-02" },
      { id: "b", assunto: "RES: Desligamento Maria Silva", data: "2026-07-02" },
    ]);
    expect(escolhido).not.toBeNull();
  });

  it("assunto de outra pessoa não é escolhido por falta de opção", () => {
    const { escolhido } = escolherEmail("Maria Silva", [
      { id: "a", assunto: "Desligamento João Souza", data: "2026-07-02" },
    ]);
    expect(escolhido).toBeNull();
  });
});

describe("classificação do motivo", () => {
  it("reconhece o voluntário", () => {
    expect(classificarMotivo("Pedido de demissão")).toBe("voluntario");
    expect(classificarMotivo("Recebeu proposta de outra empresa")).toBe("voluntario");
    expect(classificarMotivo("Mudança de carreira")).toBe("voluntario");
    expect(classificarMotivo("Nova oportunidade")).toBe("voluntario");
  });

  it("reconhece o involuntário", () => {
    expect(classificarMotivo("Baixo desempenho")).toBe("involuntario");
    expect(classificarMotivo("Reestruturação estratégica")).toBe("involuntario");
    expect(classificarMotivo("Metas não atingidas")).toBe("involuntario");
    expect(classificarMotivo("Reprovação no período de experiência")).toBe("involuntario");
    expect(classificarMotivo("Fit cultural")).toBe("involuntario");
  });

  it("o ambíguo sai nulo — é ele que vira pergunta em vez de multa chutada", () => {
    expect(classificarMotivo("Saída acordada")).toBeNull();
    expect(classificarMotivo("Não está mais na empresa")).toBeNull();
    expect(classificarMotivo("")).toBeNull();
    expect(classificarMotivo(null)).toBeNull();
  });

  it("motivo que puxa para os dois lados também sai nulo", () => {
    expect(classificarMotivo("Pedido de demissão após conversa sobre performance")).toBeNull();
  });
});

describe("normalização do que a IA devolveu", () => {
  it("os sentinelas do prompt voltam a ser 'não informado'", () => {
    const c = normalizarExtracao({
      ultimoDia: "", remuneracao: 0, variavel: -1, diasDeFeriasTirados: -1, motivo: "",
    });
    expect(c).toEqual({
      ultimoDia: null, remuneracao: null, variavel: null, diasDeFeriasTirados: null, motivo: null,
    });
  });

  it("zero dias de férias é resposta, não ausência", () => {
    const c = normalizarExtracao({ diasDeFeriasTirados: 0 });
    expect(c.diasDeFeriasTirados).toBe(0);
  });

  it("variável zero é o gestor dizendo que não há variável", () => {
    expect(normalizarExtracao({ variavel: 0 }).variavel).toBe(0);
  });

  it("variável -1 é o e-mail calado sobre variável — e não pode virar R$ 0 informado", () => {
    expect(normalizarExtracao({ variavel: -1 }).variavel).toBeNull();
  });

  it("aceita a data no formato brasileiro se o modelo escorregar", () => {
    expect(normalizarExtracao({ ultimoDia: "18/07/2026" }).ultimoDia).toBe("2026-07-18");
    expect(normalizarExtracao({ ultimoDia: "2026-07-18" }).ultimoDia).toBe("2026-07-18");
    expect(normalizarExtracao({ ultimoDia: "julho" }).ultimoDia).toBeNull();
  });

  it("dinheiro escrito como texto vira número", () => {
    expect(normalizarExtracao({ remuneracao: "R$ 3.700,00" }).remuneracao).toBe(3700);
  });

  it("objeto vazio não quebra", () => {
    expect(normalizarExtracao(null).motivo).toBeNull();
  });
});
