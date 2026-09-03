import { describe, expect, it } from "vitest";
import {
  classeDe, detalheDe, diaLocal, excecaoVencida, modoDe, periodoDe, periodoManual,
  resumir, resumirExcecoes, rotuloDe, valorLancado,
  type Excecao, type Execucao,
} from "./thetys";

/* Uma execução do jeito que o runtime da TETS grava — os formatos aqui foram
   copiados de linhas reais de `agente_execucoes`, não inventados. */
function exec(over: Partial<Execucao> = {}): Execucao {
  return {
    id: "e1",
    agente_id: "thetys",
    tarefa: "criar_conta_pagar",
    entidade: "conta_pagar",
    entidade_id: null,
    regra_id: null,
    entrada: { _modo: "teste", valor: 348, vencimento: "31/08/2026", fornecedor_id: "f-1" },
    saida: { status: "pendente", codigo_omie: "5515443850" },
    confianca: null,
    alcada: "verde",
    resultado: "executado",
    corrigido_por_humano: false,
    correcao: null,
    corrigido_em: null,
    latencia_ms: null,
    erro: null,
    executado_em: "2026-08-31T14:00:00.000Z",
    ...over,
  };
}

function excecao(over: Partial<Excecao> = {}): Excecao {
  return {
    id: "x1",
    agente_id: "thetys",
    execucao_id: null,
    tipo: "fornecedor_nao_liberado",
    titulo: "Fornecedor sem liberação",
    descricao: null,
    severidade: "media",
    valor: null,
    entidade: null,
    entidade_id: null,
    sla_horas: 24,
    vence_em: "2026-09-01T12:00:00.000Z",
    status: "aberta",
    resolucao: null,
    resolvido_em: null,
    criado_em: "2026-08-31T12:00:00.000Z",
    ...over,
  };
}

describe("classificação das tarefas", () => {
  it("separa o que muda algo do que só consulta", () => {
    expect(classeDe(exec({ tarefa: "criar_conta_pagar" }))).toBe("escrita");
    expect(classeDe(exec({ tarefa: "consultar_fornecedor" }))).toBe("leitura");
  });

  it("conferir_fixos_do_dia só é escrita quando ela de fato lança", () => {
    const ensaio = exec({ tarefa: "conferir_fixos_do_dia", entrada: { lancar: false } });
    const valendo = exec({ tarefa: "conferir_fixos_do_dia", entrada: { lancar: true } });
    expect(classeDe(ensaio)).toBe("leitura");
    expect(classeDe(valendo)).toBe("escrita");
  });

  it("tarefa que o dicionário não conhece não vira leitura por omissão", () => {
    const nova = exec({ tarefa: "pagar_boleto_sozinha" });
    expect(classeDe(nova)).toBe("desconhecida");
    expect(rotuloDe(nova)).toBe("Pagar boleto sozinha");
  });
});

describe("valor lançado", () => {
  it("conta o valor da conta a pagar que ela criou", () => {
    expect(valorLancado(exec())).toBe(348);
  });

  it("NÃO conta o total de uma consulta de gasto por categoria", () => {
    const consulta = exec({
      tarefa: "gasto_por_categoria",
      entrada: { de: "2026-08-01", ate: "2026-08-31" },
      saida: { titulos: 963, total_pago: 2738465.24 },
    });
    expect(valorLancado(consulta)).toBeNull();
  });

  it("não conta o que falhou — falhar não lança dinheiro nenhum", () => {
    expect(valorLancado(exec({ resultado: "falhou" }))).toBeNull();
  });

  it("aguenta JSON fora do formato sem quebrar", () => {
    expect(valorLancado(exec({ entrada: "não é objeto" }))).toBeNull();
    expect(valorLancado(exec({ entrada: null }))).toBeNull();
  });
});

describe("modo", () => {
  it("lê o carimbo _modo da entrada", () => {
    expect(modoDe(exec())).toBe("teste");
  });

  it("sem carimbo é produção — é assim que o runtime vai gravar quando virar a chave", () => {
    expect(modoDe(exec({ entrada: { valor: 10 } }))).toBe("producao");
  });
});

describe("detalhe em português", () => {
  it("usa o nome do fornecedor em vez do uuid", () => {
    const texto = detalheDe(exec(), (id) => (id === "f-1" ? "Central Lola" : null));
    expect(texto).toContain("Central Lola");
    expect(texto).toContain("R$ 348,00");
    expect(texto).toContain("venc. 31/08/2026");
  });

  it("cai no id abreviado quando o fornecedor não está no cadastro", () => {
    expect(detalheDe(exec({ entrada: { fornecedor_id: "abcdef12-3456" } }))).toContain("abcdef12");
  });
});

describe("resumo", () => {
  const lista = [
    exec({ id: "a", tarefa: "criar_conta_pagar", entrada: { valor: 100 } }),
    exec({ id: "b", tarefa: "criar_conta_pagar", entrada: { valor: 250 } }),
    exec({ id: "c", tarefa: "criar_conta_pagar", entrada: { valor: 999 }, resultado: "falhou" }),
    exec({ id: "d", tarefa: "consultar_fornecedor", entrada: {}, saida: {} }),
    exec({ id: "e", tarefa: "consultar_fornecedor", entrada: {}, saida: {} }),
    exec({ id: "f", tarefa: "gasto_por_categoria", entrada: {}, saida: { total_pago: 2738465 } }),
  ];

  it("conta escrita e leitura em separado", () => {
    const r = resumir(lista);
    expect(r.total).toBe(6);
    expect(r.escritas).toBe(3);
    expect(r.leituras).toBe(3);
    expect(r.falhas).toBe(1);
  });

  it("soma só o que ela lançou de verdade", () => {
    const r = resumir(lista);
    expect(r.lancamentos.n).toBe(2);
    expect(r.lancamentos.valor).toBe(350);
  });

  it("põe as escritas na frente das leituras", () => {
    const r = resumir(lista);
    expect(r.porTarefa[0].tarefa).toBe("criar_conta_pagar");
    expect(r.porTarefa.at(-1)?.classe).toBe("leitura");
  });

  it("lista vazia não quebra", () => {
    const r = resumir([]);
    expect(r.total).toBe(0);
    expect(r.porTarefa).toEqual([]);
    expect(r.lancamentos.valor).toBe(0);
  });
});

describe("o dia é o dia daqui, não o de Greenwich", () => {
  it("uma ação das 23h30 fica no dia local, não no seguinte", () => {
    expect(diaLocal(new Date(2026, 8, 2, 23, 30))).toBe("2026-09-02");
  });

  it("agrupa por dia local", () => {
    const r = resumir([
      exec({ id: "1", executado_em: new Date(2026, 8, 1, 22, 0).toISOString() }),
      exec({ id: "2", executado_em: new Date(2026, 8, 2, 3, 0).toISOString() }),
    ]);
    expect(r.porDia.map((d) => d.dia)).toEqual(["2026-09-01", "2026-09-02"]);
  });
});

describe("períodos", () => {
  const hoje = new Date(2026, 8, 2, 10, 30); // 02/09/2026, quarta

  it("ontem é o dia inteiro de ontem", () => {
    const p = periodoDe("ontem", hoje);
    expect(diaLocal(p.de)).toBe("2026-09-01");
    expect(diaLocal(p.ate)).toBe("2026-09-01");
    expect(p.ate.getHours()).toBe(23);
  });

  it("7 dias são sete dias FECHADOS, terminando ontem", () => {
    const p = periodoDe("7dias", hoje);
    // 26/08 a 01/09 inclusive = sete dias; o de hoje, pela metade, fica de fora.
    expect(diaLocal(p.de)).toBe("2026-08-26");
    expect(diaLocal(p.ate)).toBe("2026-09-01");
  });

  it("este mês vai do dia 1º até hoje", () => {
    const p = periodoDe("mes", hoje);
    expect(diaLocal(p.de)).toBe("2026-09-01");
    expect(diaLocal(p.ate)).toBe("2026-09-02");
  });

  it("mês passado é o mês fechado inteiro", () => {
    const p = periodoDe("mes_passado", hoje);
    expect(diaLocal(p.de)).toBe("2026-08-01");
    expect(diaLocal(p.ate)).toBe("2026-08-31");
  });

  it("período manual aceita as datas trocadas", () => {
    const p = periodoManual("2026-09-02", "2026-08-30");
    expect(diaLocal(p!.de)).toBe("2026-08-30");
    expect(diaLocal(p!.ate)).toBe("2026-09-02");
  });

  it("data inválida devolve nulo em vez de um período torto", () => {
    expect(periodoManual("", "2026-08-30")).toBeNull();
  });
});

describe("exceções", () => {
  const agora = new Date("2026-09-02T12:00:00.000Z");

  it("vencida é a que passou do SLA e ainda está aberta", () => {
    expect(excecaoVencida(excecao(), agora)).toBe(true);
    expect(excecaoVencida(excecao({ status: "resolvida" }), agora)).toBe(false);
    expect(excecaoVencida(excecao({ vence_em: "2026-09-09T00:00:00.000Z" }), agora)).toBe(false);
  });

  it("conta abertas, vencidas e as resolvidas dentro do período", () => {
    const r = resumirExcecoes(
      [
        excecao({ id: "1" }),
        excecao({ id: "2", tipo: "categoria_incerta", vence_em: "2026-09-30T00:00:00.000Z" }),
        excecao({ id: "3", status: "resolvida", resolvido_em: "2026-09-01T10:00:00.000Z" }),
        excecao({ id: "4", status: "resolvida", resolvido_em: "2026-07-01T10:00:00.000Z" }),
      ],
      { de: new Date(2026, 7, 1), ate: new Date(2026, 8, 2, 23, 59) },
      agora,
    );
    expect(r.abertas).toBe(2);
    expect(r.vencidas).toBe(1);
    expect(r.resolvidasNoPeriodo).toBe(1);
    // Empatadas em 1, desempata pelo nome do tipo — ordem estável entre leituras.
    expect(r.porTipo).toEqual([
      { tipo: "categoria_incerta", n: 1 },
      { tipo: "fornecedor_nao_liberado", n: 1 },
    ]);
  });
});
