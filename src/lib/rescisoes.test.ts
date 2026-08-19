import { describe, it, expect } from "vitest";
import {
  conferir, custoDe, prazo, resumoAno, tempoDeCasa, agruparVerbas, filtrar,
  alertasDe, encargosDe, fontesDe, rotuloRemuneracao, temEncargos, paraAOA, MOTIVOS,
  type Rescisao, type Verba, type TipoVerba,
} from "./rescisoes";

/* Uma rescisão de verdade em miniatura: 15 dias de saldo + aviso indenizado,
   INSS descontado, multa de 40% do FGTS por fora. */
function resc(over: Partial<Rescisao> = {}): Rescisao {
  return {
    id: "r1", chave: "joao|2026-08-15", colaborador: "João da Silva",
    colaborador_id: null, cpf: null, matricula: null,
    cargo: "Analista", departamento: "Operações", centro_custo: null, vinculo: "clt",
    admissao: "2024-03-01", aviso_em: "2026-08-01", desligamento: "2026-08-15",
    motivo: "sem_justa_causa", aviso_previo: "indenizado", aviso_dias: 33,
    salario_base: 5000,
    total_proventos: 8000, total_descontos: 225, liquido: 7775,
    fgts_base_multa: 8000, fgts_multa: 3200, fgts_recolher: 400, encargos: null,
    custo_empresa: 11375,
    data_pagamento_prevista: "2026-08-25", data_pagamento: null,
    situacao: "calculada",
    memoria_md: null, observacao: null,
    fonte: "Cálculo de Rescisão", skill_versao: "1.0", calculado_em: null, arquivo: null,
    registrado_em: "2026-08-18T10:00:00Z", atualizado_em: "2026-08-18T10:00:00Z",
    tipo_desligamento: null, motivo_texto: null, fonte_remuneracao: null,
    dias_ferias_tirados: null, meses_trabalhados: null,
    dias_trabalhados_mes: null, dias_mes_saida: null, flash_mensal: null,
    fontes: [], alertas: [], texto_resposta: null,
    ...over,
  };
}

/* A rescisão que a skill "Rescisão PJ" produz de verdade — o exemplo da própria
   documentação dela: João, 10/03/2024 a 15/05/2026, R$ 8.000, 30 dias de férias
   tirados, variável de R$ 1.500, desligamento involuntário. */
function pj(over: Partial<Rescisao> = {}): Rescisao {
  return resc({
    colaborador: "João Silva", vinculo: "pj",
    admissao: "2024-03-10", desligamento: "2026-05-15",
    motivo: "involuntario", tipo_desligamento: "involuntario",
    motivo_texto: "performance abaixo da meta",
    aviso_previo: null, aviso_dias: null, aviso_em: null,
    salario_base: 8000, fonte_remuneracao: "planilha",
    meses_trabalhados: 26, dias_ferias_tirados: 30,
    dias_trabalhados_mes: 15, dias_mes_saida: 31,
    // 17.333,33 + 3.870,97 + 1.500 + 8.000 = 30.704,30 de proventos
    total_proventos: 30704.30, total_descontos: 8258.06, liquido: 22446.24,
    fgts_base_multa: null, fgts_multa: null, fgts_recolher: null, encargos: null,
    custo_empresa: null,
    fonte: "Rescisão PJ",
    ...over,
  });
}

const VERBAS_PJ = [
  verba("provento", "Férias proporcionais", 17333.33, 0),
  verba("desconto", "Férias já tiradas", 8000, 1),
  verba("provento", "Proporcional do mês de saída", 3870.97, 2),
  verba("provento", "Variável / comissão", 1500, 3),
  verba("provento", "Multa de rescisão", 8000, 4),
  verba("desconto", "Benefício Flash não usufruído", 258.06, 5),
];

function verba(tipo: TipoVerba, rubrica: string, valor: number, ordem = 0): Verba {
  return {
    id: `${rubrica}-${valor}`, rescisao_id: "r1", ordem, tipo, rubrica,
    referencia: null, base: null, valor, formula: null, fundamento: null,
    incide_inss: null, incide_irrf: null, incide_fgts: null,
  };
}

const VERBAS_OK = [
  verba("provento", "Saldo de salário", 2500, 0),
  verba("provento", "Aviso prévio indenizado", 5500, 1),
  verba("desconto", "INSS", 225, 2),
  verba("fgts", "Multa de 40%", 3200, 3),
  verba("informativo", "Saldo do FGTS", 8000, 4),
];

describe("conferir", () => {
  it("fecha quando as verbas somam o total que a skill declarou", () => {
    const c = conferir(resc(), VERBAS_OK);
    expect(c.proventos).toBe(8000);
    expect(c.descontos).toBe(225);
    expect(c.liquido).toBe(7775);
    expect(c.difLiquido).toBe(0);
    expect(c.fecha).toBe(true);
  });

  it("deixa FGTS e informativo FORA do líquido — somá-los estouraria em 40%", () => {
    const c = conferir(resc(), VERBAS_OK);
    expect(c.fgts).toBe(3200);
    // 8000 − 225 = 7775, e não 7775 + 3200 + 8000.
    expect(c.liquido).toBe(7775);
  });

  it("acusa a divergência em vez de recalcular por cima", () => {
    // O caso do teste de fumaça: a skill declarou 9.000 e as verbas dão 7.775.
    const c = conferir(resc({ liquido: 9000 }), VERBAS_OK);
    expect(c.fecha).toBe(false);
    expect(c.difLiquido).toBe(1225);
  });

  it("um centavo de diferença de arredondamento não vira divergência", () => {
    const c = conferir(resc({ liquido: 7775.004 }), VERBAS_OK);
    expect(c.fecha).toBe(true);
  });

  it("sem verba gravada não é 'fecha' — é 'não deu para conferir'", () => {
    const c = conferir(resc(), []);
    expect(c.semVerbas).toBe(true);
    expect(c.fecha).toBe(false);
  });
});

describe("prazo (art. 477 §6º)", () => {
  const hoje = new Date(2026, 7, 20, 9, 0, 0); // 20/08/2026

  it("conta os dias até o prazo previsto", () => {
    const p = prazo(resc(), hoje);
    expect(p.estado).toBe("no_prazo");
    expect(p.dias).toBe(5);
    expect(p.texto).toBe("vence em 5 dias");
  });

  it("acusa atraso quando o prazo já passou", () => {
    const p = prazo(resc({ data_pagamento_prevista: "2026-08-17" }), hoje);
    expect(p.estado).toBe("atrasado");
    expect(p.texto).toBe("atrasada 3 dias");
  });

  it("vence hoje é seu próprio estado — não é atraso nem folga", () => {
    expect(prazo(resc({ data_pagamento_prevista: "2026-08-20" }), hoje).estado).toBe("hoje");
  });

  it("pagamento registrado encerra a contagem", () => {
    const p = prazo(resc({ situacao: "paga", data_pagamento: "2026-08-19" }), hoje);
    expect(p.estado).toBe("pago");
    expect(p.texto).toContain("19/08/2026");
  });

  it("data de pagamento vale mesmo se a situação ficou atrás", () => {
    // Marcou a data e esqueceu de mudar a situação: não pode aparecer como atrasada.
    expect(prazo(resc({ data_pagamento: "2026-08-19" }), hoje).estado).toBe("pago");
  });

  it("cancelada não tem prazo a cobrar", () => {
    expect(prazo(resc({ situacao: "cancelada" }), hoje).estado).toBe("cancelada");
  });
});

describe("tempoDeCasa", () => {
  it("conta anos e meses até o desligamento", () => {
    expect(tempoDeCasa("2024-03-01", "2026-08-15")?.texto).toBe("2a 5m");
  });

  it("menos de um ano sai em meses", () => {
    expect(tempoDeCasa("2026-01-10", "2026-08-15")?.texto).toBe("7 meses");
  });

  it("menos de um mês sai em dias — contrato de experiência curto", () => {
    expect(tempoDeCasa("2026-08-01", "2026-08-15")?.texto).toBe("14 dias");
  });

  it("sem admissão não inventa tempo de casa", () => {
    expect(tempoDeCasa(null, "2026-08-15")).toBeNull();
  });
});

describe("custoDe", () => {
  it("usa o custo declarado pela skill", () => {
    expect(custoDe(resc())).toBe(11375);
  });

  it("na falta dele, monta o que sai do caixa (sem a base da multa)", () => {
    const r = resc({ custo_empresa: null });
    // 7775 + 3200 + 400 — os 8.000 de fgts_base_multa NÃO entram: são base.
    expect(custoDe(r)).toBe(11375);
  });
});

describe("resumoAno", () => {
  const hoje = new Date(2026, 7, 20, 9, 0, 0);

  it("soma custo e separa o que está a pagar", () => {
    const r = resumoAno([
      resc(),
      resc({ id: "r2", chave: "b", colaborador: "Maria", situacao: "paga", data_pagamento: "2026-07-10", desligamento: "2026-07-01" }),
    ], hoje);
    expect(r.qtd).toBe(2);
    expect(r.custo).toBe(22750);
    expect(r.medio).toBe(11375);
    expect(r.qtdAPagar).toBe(1);
    expect(r.aPagar).toBe(7775);
    expect(r.atrasadas).toBe(0);
  });

  it("cancelada fica na lista mas fora de toda soma", () => {
    const r = resumoAno([resc(), resc({ id: "r2", chave: "b", situacao: "cancelada" })], hoje);
    expect(r.qtd).toBe(1);
    expect(r.custo).toBe(11375);
    expect(r.canceladas).toBe(1);
  });

  it("conta as que estouraram o prazo e quanto elas valem", () => {
    const r = resumoAno([resc({ data_pagamento_prevista: "2026-08-10" })], hoje);
    expect(r.atrasadas).toBe(1);
    expect(r.valorAtrasado).toBe(7775);
  });

  it("ordena os motivos pelo custo, não pela contagem", () => {
    const r = resumoAno([
      resc({ id: "a", chave: "a", motivo: "pedido_demissao", custo_empresa: 1000 }),
      resc({ id: "b", chave: "b", motivo: "pedido_demissao", custo_empresa: 1000 }),
      resc({ id: "c", chave: "c", motivo: "sem_justa_causa", custo_empresa: 9000 }),
    ], hoje);
    expect(r.porMotivo[0].motivo).toBe("sem_justa_causa");
    expect(r.porMotivo[0].custo).toBe(9000);
    expect(r.porMotivo[1].qtd).toBe(2);
  });
});

describe("agruparVerbas", () => {
  it("segue a ordem do espelho e não soma informativo", () => {
    const g = agruparVerbas(VERBAS_OK);
    expect(g.map((x) => x.tipo)).toEqual(["provento", "desconto", "fgts", "informativo"]);
    expect(g[0].total).toBe(8000);
    expect(g[3].total).toBe(0);
  });

  it("grupo vazio não aparece", () => {
    const g = agruparVerbas([verba("provento", "Saldo", 100)]);
    expect(g).toHaveLength(1);
  });
});

describe("rescisão PJ", () => {
  it("as seis parcelas fecham com o total a receber", () => {
    const c = conferir(pj(), VERBAS_PJ);
    expect(c.proventos).toBeCloseTo(30704.30, 2);
    expect(c.descontos).toBeCloseTo(8258.06, 2);
    expect(c.liquido).toBeCloseTo(22446.24, 2);
    expect(c.fecha).toBe(true);
  });

  it("sem FGTS, o custo da empresa É o total a receber", () => {
    expect(encargosDe(pj())).toBe(0);
    expect(custoDe(pj())).toBe(22446.24);
  });

  it("uma lista só de PJ não mostra coluna de encargos", () => {
    expect(temEncargos([pj(), pj({ id: "b", chave: "b" })])).toBe(false);
    // Basta uma celetista no período para a coluna voltar a fazer sentido.
    expect(temEncargos([pj(), resc({ id: "c", chave: "c" })])).toBe(true);
  });

  it("PJ tem remuneração; CLT tem salário base", () => {
    expect(rotuloRemuneracao("pj")).toBe("Remuneração");
    expect(rotuloRemuneracao("clt")).toBe("Salário base");
  });

  it("a etiqueta diz de quem partiu a iniciativa", () => {
    expect(MOTIVOS.involuntario.curto).toBe("Involuntário");
    expect(MOTIVOS.involuntario.tom).toBe("neg");
    expect(MOTIVOS.voluntario.tom).toBe("neu");
  });

  it("o custo do período soma os totais a receber", () => {
    const r = resumoAno([pj(), pj({ id: "b", chave: "b", liquido: 1000, custo_empresa: null })]);
    expect(r.custo).toBeCloseTo(23446.24, 2);
    expect(r.porMotivo[0].motivo).toBe("involuntario");
  });
});

describe("fontes e alertas", () => {
  it("aceita fonte em texto e em objeto, e descarta vazia", () => {
    const f = fontesDe(pj({
      fontes: [
        "Planilha RH (aba PJs)",
        { texto: "E-mail de desligamento", url: "https://mail.google.com/x" },
        { texto: "  " },
      ],
    }));
    expect(f).toHaveLength(2);
    expect(f[0]).toEqual({ texto: "Planilha RH (aba PJs)" });
    expect(f[1].url).toBe("https://mail.google.com/x");
  });

  it("sem fontes não quebra", () => {
    expect(fontesDe(pj({ fontes: null }))).toEqual([]);
    expect(alertasDe(pj({ alertas: null }))).toEqual([]);
  });

  it("guarda a ressalva que a skill deu em voz alta", () => {
    const a = alertasDe(pj({ alertas: ["Variável não informado no e-mail", "  "] }));
    expect(a).toEqual(["Variável não informado no e-mail"]);
  });
});

describe("paraAOA", () => {
  it("omite as colunas de FGTS quando a exportação é toda PJ", () => {
    const [cab] = paraAOA([pj()]);
    expect(cab).not.toContain("FGTS multa");
    expect(cab).toContain("Total a receber");
    expect(cab).toContain("Motivo (e-mail)");
  });

  it("traz as colunas de FGTS quando há celetista na lista", () => {
    const [cab] = paraAOA([pj(), resc({ id: "c", chave: "c" })]);
    expect(cab).toContain("FGTS multa");
    expect(cab).toContain("Custo da empresa");
  });

  it("cabeçalho e linha têm o mesmo número de colunas", () => {
    const [cab, linha] = paraAOA([pj()]);
    expect(linha).toHaveLength(cab.length);
  });
});

describe("filtrar", () => {
  it("acha pelo que está escrito na linha — nome, cargo, área e motivo", () => {
    const l = [resc(), resc({ id: "r2", chave: "b", colaborador: "Maria Souza", cargo: "Vendedora", departamento: "Comercial" })];
    expect(filtrar(l, "operações")).toHaveLength(1);
    expect(filtrar(l, "maria")[0].colaborador).toBe("Maria Souza");
    expect(filtrar(l, "sem justa causa")).toHaveLength(2);
    expect(filtrar(l, "")).toHaveLength(2);
  });

  it("acha pelo motivo que o gestor escreveu no e-mail", () => {
    // O texto está NA LINHA da tela: procurar por ele não pode devolver vazio.
    expect(filtrar([pj(), resc({ id: "x", chave: "x" })], "performance")).toHaveLength(1);
  });
});
