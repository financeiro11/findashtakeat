import { describe, expect, it } from "vitest";
import {
  agruparEmEpisodios, classeDe, detalheDe, diaLocal, excecaoVencida, modoDe, narrativaDe,
  periodoDe, periodoManual, porQueDe, resumir, resumirExcecoes, rotuloDe, valorLancado,
  TAREFAS,
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

describe("a frase em português", () => {
  it("toda tarefa do dicionário explica para que serve", () => {
    for (const [tarefa, v] of Object.entries(TAREFAS)) {
      expect(v.porQue.length, `${tarefa} sem porQue`).toBeGreaterThan(40);
    }
  });

  it("conta o lançamento com fornecedor, valor e vencimento", () => {
    const texto = narrativaDe(exec(), (id) => (id === "f-1" ? "Central Lola" : null));
    expect(texto).toContain("Central Lola");
    expect(texto).toContain("R$ 348,00");
    expect(texto).toContain("31/08/2026");
    expect(texto).toContain("5515443850");
  });

  it("diz que travou no freio de duplicidade em vez de dizer que lançou", () => {
    const texto = narrativaDe(exec({
      resultado: "escalado",
      entrada: { valor: 1574.13, vencimento: "31/08/2026", fornecedor_id: "f-1" },
      saida: { existentes: [5514033403, 5514043490], bloqueado_por_duplicidade: true },
    }));
    expect(texto).toContain("duplicidade");
    expect(texto).toContain("5514033403");
    expect(texto).not.toMatch(/^Lançou/);
  });

  /* Foi o pico de 03/09: 102 edições em quatro minutos, e nenhuma mudou nada.
     Quem lê a trilha precisa ver isso escrito na linha, não deduzir comparando
     duas datas iguais no telegrama. */
  it("acusa a edição que foi ao Omie e não mudou nada", () => {
    const semEfeito = narrativaDe(exec({
      tarefa: "editar_lancamento_omie",
      entrada: { codigo_lancamento: "5479711085", novo_vencimento: "04/09/2026" },
      saida: { alterado: true, vencimento_anterior: "04/09/2026" },
    }));
    expect(semEfeito).toContain("não mudou nada");

    const comEfeito = narrativaDe(exec({
      tarefa: "editar_lancamento_omie",
      entrada: { codigo_lancamento: "5479711085", novo_vencimento: "04/09/2026" },
      saida: { alterado: true, vencimento_anterior: "05/09/2026" },
    }));
    expect(comEfeito).toContain("de 05/09/2026 para 04/09/2026");
    expect(comEfeito).not.toContain("não mudou nada");
  });

  /* A ORION dá "não existe no Omie" procurada pelo nome e "existe" procurada pelo
     CNPJ, minutos depois. Sem a ressalva, a linha mente para quem lê. */
  it("ressalva a busca por nome, e só quando ela não achou", () => {
    const porNome = narrativaDe(exec({
      tarefa: "consultar_fornecedor",
      entrada: { cnpj: null, nome: "Orion" },
      saida: { existe_no_omie: false, tem_governanca: true },
    }));
    expect(porNome).toContain("não é prova");

    const porCnpj = narrativaDe(exec({
      tarefa: "consultar_fornecedor",
      entrada: { cnpj: "03.963.421/0001-06", nome: "ORION COMERCIO E INFORMATICA LTDA" },
      saida: { existe_no_omie: true, tem_governanca: true },
    }));
    expect(porCnpj).toContain("03.963.421/0001-06");
    expect(porCnpj).not.toContain("não é prova");
  });

  it("não inventa frase para tarefa que o dicionário não conhece", () => {
    expect(narrativaDe(exec({ tarefa: "pagar_boleto_sozinha" }))).toBe("");
    expect(porQueDe(exec({ tarefa: "pagar_boleto_sozinha" }))).toBe("");
  });

  it("aguenta JSON fora do formato sem quebrar a linha", () => {
    expect(narrativaDe(exec({ entrada: "não é objeto", saida: null }))).toContain("conta a pagar");
    expect(() => narrativaDe(exec({ entrada: null, saida: null }))).not.toThrow();
  });

  /* O pedaço vindo do JSON já traz o artigo ("o CNPJ 179…"), porque quem o monta
     não sabe qual preposição virá antes. Sem a contração, sai "de o CNPJ". */
  it("contrai a preposição com o artigo", () => {
    const texto = narrativaDe(exec({
      tarefa: "consultar_regra_categoria",
      entrada: { documento_norm: "17990627000130" },
      saida: { encontrada: true },
    }));
    expect(texto).toContain("do CNPJ 17990627000130");
    expect(texto).not.toContain("de o ");
  });

  it("não dobra o ponto quando o texto de gente já vem com um", () => {
    const texto = narrativaDe(exec({
      tarefa: "resolver_excecao",
      entrada: { resolucao: "Fornecedor conferido e liberado." },
      saida: { tipo: "categoria_incerta", titulo: "Confiança abaixo do mínimo" },
    }));
    expect(texto).not.toContain('".');
    expect(texto.endsWith('"')).toBe(true);
  });

  it("não deixa buraco de pontuação quando o campo falta", () => {
    const semNada = narrativaDe(exec({
      tarefa: "listar_emails_novos", entrada: {}, saida: { encontrados: 0 },
    }));
    expect(semNada).toBe("Verificação de rotina da caixa de entrada: não havia nada novo para tratar.");
  });
});

describe("episódios — a rotina, não o passo", () => {
  const em = (min: number, seg = 0) =>
    new Date(2026, 8, 3, 19, min, seg).toISOString();

  const corrente = [
    exec({ id: "1", tarefa: "conferir_fixos_do_dia", entrada: { data: "2026-09-03", lancar: false }, saida: { pendentes: 1 }, executado_em: em(4, 10) }),
    exec({ id: "2", tarefa: "ler_documento_email", entrada: { uid: "13728", nome_anexo: "boleto.pdf" }, saida: { caracteres_extraidos: 1599 }, executado_em: em(4, 14) }),
    exec({ id: "3", tarefa: "consultar_fornecedor", entrada: { cnpj: "03.963.421/0001-06" }, saida: { existe_no_omie: true }, executado_em: em(4, 20) }),
    exec({ id: "4", tarefa: "criar_conta_pagar", entrada: { valor: 870, vencimento: "15/09/2026", fornecedor_id: "f-1" }, saida: { codigo_omie: "5517219954" }, executado_em: em(5, 3) }),
    exec({ id: "5", tarefa: "marcar_email_processado", entrada: { uid: "13728" }, saida: { marcado: true }, executado_em: em(5, 17) }),
    exec({ id: "6", tarefa: "conferir_fixos_do_dia", entrada: { data: "2026-09-03", lancar: false }, saida: { pendentes: 1 }, executado_em: em(49, 2) }),
  ];

  it("junta a corrente de trabalho e corta quando ela para", () => {
    const eps = agruparEmEpisodios(corrente);
    expect(eps).toHaveLength(2);
    // Mais novo primeiro — a ordem da tela.
    expect(eps[0].acoes.map((a) => a.id)).toEqual(["6"]);
    expect(eps[1].acoes.map((a) => a.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("dá à corrente o nome da rotina, não o da tarefa mais frequente", () => {
    const [, ciclo] = agruparEmEpisodios(corrente);
    expect(ciclo.titulo).toBe("Documento que chegou por e-mail");
    expect(ciclo.porQue).toContain("caixa de entrada");
  });

  it("o desfecho conta o dinheiro que a corrente lançou", () => {
    const [ronda, ciclo] = agruparEmEpisodios(corrente);
    expect(ciclo.desfecho).toContain("lançou R$ 870,00");
    expect(ronda.desfecho).toBe("só consulta — nada mudou de lado nenhum");
  });

  /* Fechar o e-mail é o fim do ciclo. Sem esta regra, dois e-mails tratados em
     seguida viram uma corrente só e a história fica ilegível. */
  it("marcar o e-mail como lido fecha a corrente", () => {
    const doisEmails = [
      exec({ id: "a", tarefa: "ler_documento_email", entrada: { uid: "1" }, executado_em: em(4, 0) }),
      exec({ id: "b", tarefa: "marcar_email_processado", entrada: { uid: "1" }, executado_em: em(4, 30) }),
      exec({ id: "c", tarefa: "ler_documento_email", entrada: { uid: "2" }, executado_em: em(5, 20) }),
    ];
    const eps = agruparEmEpisodios(doisEmails);
    expect(eps.map((e) => e.acoes.map((a) => a.id))).toEqual([["c"], ["a", "b"]]);
  });

  it("aceita a lista fora de ordem e devolve a história na ordem certa", () => {
    const eps = agruparEmEpisodios([...corrente].reverse());
    expect(eps[1].acoes.map((a) => a.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("lista vazia não quebra", () => {
    expect(agruparEmEpisodios([])).toEqual([]);
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
