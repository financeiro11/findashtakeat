/**
 * A regra do lote da folha.
 *
 * O que este teste prende é o dinheiro: quem entra no mês, por quantos dias, e
 * a chave que impede a mesma pessoa de ser paga duas vezes na mesma
 * competência. Um erro aqui não é uma linha torta na tela — é cem títulos
 * duplicados no ERP.
 */

import { describe, expect, it } from "vitest";
import {
  DIAS_DO_MES_COMERCIAL, ENVIO_FOLHA_LIBERADO, MARCO_FOLHA_FORA_DO_HUB, bloqueioDaFolha,
  FINALIDADE_PIX_FOLHA, FORMA_PAGAMENTO_FOLHA, TITULOS_POR_LOTE, VARIACAO_QUE_CHAMA_ATENCAO,
  resolvedorDeCategoria,
  fatiarEmLotes, montarLoteParaOmie, montarTituloFolha,
  diasTrabalhados, integracaoFolhaDe, montarLote, parseISO, pendenciasDoLote, previsaoDe, recusaDaFolha,
  type ResolveDePara, type TituloDaFolha,
  registroDa, vencimentoDa,
  type ColaboradorDaFolha,
} from "../../../supabase/functions/_shared/folha-envio.ts";

const pessoa = (over: Partial<ColaboradorDaFolha> = {}): ColaboradorDaFolha => ({
  id: "1",
  codigo: "COL-003057",
  nome: "Ádrian Coradini",
  cnpj: "66.744.328/0001-20",
  razao: "ADRIAN CORADINI SERVICOS LTDA",
  valor: 7500,
  inicio: "2025-03-12",
  datadesl: null,
  ...over,
});

const dias = (inicio: string | null, comp = "2026-09") =>
  diasTrabalhados(parseISO(inicio), Number(comp.slice(0, 4)), Number(comp.slice(5, 7)) - 1);

describe("diasTrabalhados", () => {
  it("quem atravessa o mês inteiro recebe os 30 dias comerciais", () => {
    expect(dias("2025-03-12")).toEqual({ dias: 30, motivo: "cheio" });
  });

  it("admissão conta do dia da entrada até o fim do mês, inclusive", () => {
    // Entrou dia 1 → mês cheio. Entrou dia 30 → um dia só.
    expect(dias("2026-09-01")).toEqual({ dias: 30, motivo: "admissao" });
    expect(dias("2026-09-11")).toEqual({ dias: 20, motivo: "admissao" });
    expect(dias("2026-09-30")).toEqual({ dias: 1, motivo: "admissao" });
  });

  it("quem entrou em outro mês não é rateado", () => {
    expect(dias("2026-08-31")).toEqual({ dias: 30, motivo: "cheio" });
    expect(dias(null)).toEqual({ dias: 30, motivo: "cheio" });
  });
});

describe("as três datas do título", () => {
  it("o registro é o último dia da competência — a âncora da DRE", () => {
    // O caso que o financeiro deu: folha de julho registra em 31/07.
    expect(registroDa("2026-07")).toBe("2026-07-31");
    expect(registroDa("2026-08")).toBe("2026-08-31");
    // Meses curtos e fevereiro bissexto não podem virar dia 30 nem 01 do seguinte.
    expect(registroDa("2026-09")).toBe("2026-09-30");
    expect(registroDa("2026-02")).toBe("2026-02-28");
    expect(registroDa("2028-02")).toBe("2028-02-29");
  });

  it("o vencimento é dia 5 do mês SEGUINTE ao da competência", () => {
    expect(vencimentoDa("2026-07")).toBe("2026-08-05");
    expect(vencimentoDa("2026-08")).toBe("2026-09-05");
    // Virada de ano: competência dez/26 vence em jan/27.
    expect(vencimentoDa("2026-12")).toBe("2027-01-05");
  });

  it("a previsão anda para segunda quando o dia 5 cai no fim de semana", () => {
    // 05/09/2026 é sábado → 07/09 (segunda).
    expect(previsaoDe("2026-09-05")).toBe("2026-09-07");
    // 05/07/2026 é domingo → 06/07 (segunda).
    expect(previsaoDe("2026-07-05")).toBe("2026-07-06");
  });

  it("em dia útil a previsão é o próprio vencimento", () => {
    // 05/08/2026 é quarta.
    expect(previsaoDe("2026-08-05")).toBe("2026-08-05");
  });

  /* Mês de exceção existe. Setembro/2026 antecipou o pagamento da segunda para
     a sexta anterior — e isso NÃO pode virar regra no código. */
  it("a exceção da competência substitui a previsão da regra", () => {
    const lote = montarLote([pessoa()], "2026-08", () => null, "2026-09-04");
    expect(lote).toMatchObject({
      vencimento: "2026-09-05",   // o vencimento NÃO muda
      previsaoRegra: "2026-09-07", // o que a regra daria
      previsao: "2026-09-04",      // o que vai valer
      previsaoExcepcional: true,
    });
  });

  it("sem exceção, previsão e regra são a mesma coisa", () => {
    const lote = montarLote([pessoa()], "2026-08");
    expect(lote.previsao).toBe(lote.previsaoRegra);
    expect(lote.previsaoExcepcional).toBe(false);
  });

  it("exceção igual à regra não é exceção", () => {
    // Registrar 07/09 quando a regra já dá 07/09 não pode acender o aviso.
    const lote = montarLote([pessoa()], "2026-08", () => null, "2026-09-07");
    expect(lote.previsaoExcepcional).toBe(false);
  });

  it("data inválida na exceção é ignorada — a regra prevalece", () => {
    for (const lixo of ["", "amanhã", null]) {
      const lote = montarLote([pessoa()], "2026-08", () => null, lixo);
      expect(lote.previsao, String(lixo)).toBe("2026-09-07");
    }
  });

  it("o lote carrega as três datas prontas para a prévia", () => {
    const lote = montarLote([pessoa()], "2026-08");
    expect(lote).toMatchObject({
      competencia: "2026-08",
      registro: "2026-08-31",
      vencimento: "2026-09-05",
      previsao: "2026-09-07", // 05/09/2026 é sábado
    });
  });
});

describe("montarLote", () => {
  it("ativo de casa entra pelo salário cheio", () => {
    const { itens, total } = montarLote([pessoa()], "2026-09");
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ dias: 30, motivo: "cheio", valor: 7500 });
    expect(total).toBe(7500);
  });

  it("quem entrou no meio do mês entra rateado", () => {
    const { itens } = montarLote([pessoa({ inicio: "2026-09-11" })], "2026-09");
    // 7500 / 30 × 20
    expect(itens[0]).toMatchObject({ dias: 20, motivo: "admissao", valor: 5000 });
  });

  /* Desligado é pago pelo processo de rescisão, em /governanca/rescisoes.
     Decidido com o financeiro em 26/08/2026: provisionar aqui pagaria os
     mesmos dias duas vezes. */
  it("quem saiu no mês NÃO entra no lote", () => {
    const { itens, fora } = montarLote(
      [pessoa({ nome: "Pedro Henrique", inicio: "2026-09-03", datadesl: "2026-09-07" })],
      "2026-09",
    );
    expect(itens).toHaveLength(0);
    expect(fora[0].motivo).toMatch(/07\/09\/2026.*rescis/i);
  });

  it("quem saiu ANTES da competência também fica de fora", () => {
    const { itens, fora } = montarLote([pessoa({ datadesl: "2026-08-20" })], "2026-09");
    expect(itens).toHaveLength(0);
    expect(fora[0].motivo).toMatch(/rescis/i);
  });

  it("mas quem sai DEPOIS da competência recebe o mês cheio", () => {
    // Trabalhou setembro inteiro e só saiu em outubro: a folha de setembro é
    // dele. Cortar por "tem data de desligamento" tiraria um mês devido.
    const { itens, fora } = montarLote([pessoa({ datadesl: "2026-10-05" })], "2026-09");
    expect(fora).toHaveLength(0);
    expect(itens[0]).toMatchObject({ dias: 30, motivo: "cheio", valor: 7500 });
  });

  it("sair no último dia da competência ainda é rescisão", () => {
    const { itens } = montarLote([pessoa({ datadesl: "2026-09-30" })], "2026-09");
    expect(itens).toHaveLength(0);
  });

  it("arredonda para centavos", () => {
    // 3333 / 30 × 7 = 777,70
    const { itens } = montarLote([pessoa({ valor: 3333, inicio: "2026-09-24" })], "2026-09");
    expect(itens[0]).toMatchObject({ dias: 7, valor: 777.7 });
  });

  it("ninguém some calado — cada exclusão diz o motivo", () => {
    const { itens, fora } = montarLote(
      [
        pessoa({ id: "a", nome: "Entrou depois", inicio: "2026-10-01" }),
        pessoa({ id: "b", nome: "Saiu antes", datadesl: "2026-08-31" }),
        pessoa({ id: "c", nome: "Sem salário", valor: 0 }),
        pessoa({ id: "d", nome: "Sem início", inicio: null }),
        pessoa({ id: "e", nome: "Fica" }),
      ],
      "2026-09",
    );
    expect(itens.map((i) => i.nome)).toEqual(["Fica"]);
    expect(fora.map((f) => f.nome)).toEqual(["Entrou depois", "Saiu antes", "Sem início", "Sem salário"]);
    expect(fora.every((f) => f.motivo.length > 0)).toBe(true);
  });

  it("sai em ordem de nome, para conferir a prévia de cima a baixo", () => {
    const { itens } = montarLote(
      [pessoa({ id: "1", nome: "Zeca" }), pessoa({ id: "2", nome: "Ana" }), pessoa({ id: "3", nome: "Ádrian" })],
      "2026-09",
    );
    expect(itens.map((i) => i.nome)).toEqual(["Ádrian", "Ana", "Zeca"]);
  });
});

/* O setor do RH é texto livre e não entra no provisionamento; departamento e
   categoria vêm do de-para, por pessoa. */
describe("os dois de-para", () => {
  const dePara: ResolveDePara = (codigo) =>
    codigo === "COL-003057"
      ? { departamento: "Tecnologia", categoria: "3.1.1.4. Pessoal - Tecnologia" }
      : null;

  it("carimba departamento e categoria na linha", () => {
    const { itens } = montarLote([pessoa()], "2026-09", dePara);
    expect(itens[0]).toMatchObject({
      departamento: "Tecnologia",
      categoria: "3.1.1.4. Pessoal - Tecnologia",
    });
  });

  it("quem não está no de-para CONTINUA no lote, com os campos vazios", () => {
    // Sumir da prévia seria pior: folha com uma pessoa a menos não dá erro.
    const { itens, fora } = montarLote([pessoa({ codigo: "COL-999999" })], "2026-09", dePara);
    expect(fora).toHaveLength(0);
    expect(itens[0]).toMatchObject({ departamento: "", categoria: "" });
  });

  it("e é a pendência que barra o envio dessa pessoa", () => {
    const { itens } = montarLote([pessoa({ codigo: "COL-999999" })], "2026-09", dePara);
    expect(pendenciasDoLote(itens.map((i) => ({
      cnpj: i.cnpj, codigoFornecedor: 1, codigoCategoria: i.categoria,
    })))).toMatch(/sem categoria/);
  });

  it("sem de-para nenhum, o lote inteiro fica pendente", () => {
    const { itens } = montarLote([pessoa()], "2026-09");
    expect(itens[0].categoria).toBe("");
  });
});

/* A trava que existe por causa do caso real: o espelho do RH trazia R$ 24.000
   para quem a folha de julho pagou R$ 2.400. */
describe("variação contra o valor de referência", () => {
  const comRef = (valorReferencia: number | null): ResolveDePara => () => ({
    departamento: "Onboarding e Setup",
    categoria: "3.2.7.1. Pessoal - Onboarding",
    valorReferencia,
  });

  it("marca o dígito a mais — 2.400 virando 24.000", () => {
    const { itens } = montarLote([pessoa({ valor: 24000 })], "2026-09", comRef(2400));
    expect(itens[0]).toMatchObject({ valorReferencia: 2400, chamaAtencao: true });
    expect(itens[0].variacao).toBeCloseTo(9, 5); // +900%
  });

  it("deixa passar reajuste pequeno", () => {
    const { itens } = montarLote([pessoa({ valor: 2500 })], "2026-09", comRef(2400));
    expect(itens[0].chamaAtencao).toBe(false);
    expect(itens[0].variacao).toBeCloseTo(0.041666, 4);
  });

  it("marca nos dois sentidos — corte também é erro em potencial", () => {
    expect(montarLote([pessoa({ valor: 2000 })], "2026-09", comRef(2400)).itens[0].chamaAtencao).toBe(true);
    expect(montarLote([pessoa({ valor: 2900 })], "2026-09", comRef(2400)).itens[0].chamaAtencao).toBe(true);
  });

  it("o limite é inclusivo", () => {
    const noLimite = 2400 * (1 + VARIACAO_QUE_CHAMA_ATENCAO);
    expect(montarLote([pessoa({ valor: noLimite })], "2026-09", comRef(2400)).itens[0].chamaAtencao).toBe(true);
  });

  it("quem nunca entrou numa folha não é marcado", () => {
    // Admitido em agosto: não há contra o que comparar, e marcar todo mundo
    // novo faria a marcação virar ruído.
    for (const semRef of [null, 0]) {
      const { itens } = montarLote([pessoa({ valor: 9999 })], "2026-09", comRef(semRef));
      expect(itens[0]).toMatchObject({ valorReferencia: null, variacao: null, chamaAtencao: false });
    }
  });

  it("compara o salário CHEIO, não o rateado", () => {
    // Entrou dia 21 e recebe um terço. Comparar o terço com o mês inteiro
    // marcaria toda admissão como suspeita.
    const { itens } = montarLote(
      [pessoa({ valor: 2400, inicio: "2026-09-21" })], "2026-09", comRef(2400),
    );
    expect(itens[0].dias).toBe(10);
    expect(itens[0].valor).toBe(800);
    expect(itens[0].chamaAtencao).toBe(false);
  });
});

/* Correção de salário feita no Hub, por cima do espelho do RH. O espelho é
   reescrito a cada sync, então a correção não pode morar lá. */
describe("valor ajustado no Hub", () => {
  const ajuste = (valorAjustado: number | null, valorReferencia: number | null = 2400): ResolveDePara =>
    () => ({
      departamento: "Onboarding e Setup",
      categoria: "3.2.7.1. Pessoal - Onboarding",
      valorReferencia,
      valorAjustado,
    });

  it("o ajuste manda na folha, e o valor do RH continua visível", () => {
    // O caso real: o espelho trazia 24.000 para quem ganha 2.400.
    const { itens } = montarLote([pessoa({ valor: 24000 })], "2026-09", ajuste(2400));
    expect(itens[0]).toMatchObject({ valorRh: 24000, valorAjustado: 2400, valorBase: 2400, valor: 2400 });
  });

  it("sem ajuste, vale o espelho", () => {
    const { itens } = montarLote([pessoa({ valor: 7500 })], "2026-09", ajuste(null, 7500));
    expect(itens[0]).toMatchObject({ valorRh: 7500, valorAjustado: null, valorBase: 7500 });
  });

  it("a variação compara o valor QUE VAI SER PAGO, não o do espelho", () => {
    // Corrigir 24.000 para 2.400 tem de APAGAR a marcação, não mantê-la.
    const { itens } = montarLote([pessoa({ valor: 24000 })], "2026-09", ajuste(2400, 2400));
    expect(itens[0].chamaAtencao).toBe(false);
    expect(itens[0].variacao).toBe(0);
  });

  it("o rateio de quem entrou no mês usa o valor ajustado", () => {
    const { itens } = montarLote(
      [pessoa({ valor: 24000, inicio: "2026-09-21" })], "2026-09", ajuste(2400),
    );
    expect(itens[0]).toMatchObject({ dias: 10, valor: 800 });
  });

  it("marca como redundante quando o RH já se corrigiu", () => {
    const { itens } = montarLote([pessoa({ valor: 2400 })], "2026-09", ajuste(2400));
    expect(itens[0].ajusteRedundante).toBe(true);
  });

  it("ajuste zero ou negativo é ignorado — tirar da folha se faz pelo desligamento", () => {
    for (const invalido of [0, -100, null]) {
      const { itens } = montarLote([pessoa({ valor: 7500 })], "2026-09", ajuste(invalido));
      expect(itens[0], String(invalido)).toMatchObject({ valorAjustado: null, valorBase: 7500 });
    }
  });

  it("ajuste salva quem o espelho zerou", () => {
    // Sem ajuste sairia do lote por "sem valor mensal".
    const { itens, fora } = montarLote([pessoa({ valor: 0 })], "2026-09", ajuste(3000));
    expect(fora).toHaveLength(0);
    expect(itens[0]).toMatchObject({ valorRh: 0, valorAjustado: 3000, valor: 3000 });
  });

  it("arredonda o ajuste para centavos", () => {
    const { itens } = montarLote([pessoa()], "2026-09", ajuste(2777.7666));
    expect(itens[0].valorAjustado).toBe(2777.77);
  });
});

describe("integracaoFolhaDe", () => {
  it("a chave é o código do RH, e sobrevive a espaço e caixa", () => {
    const a = integracaoFolhaDe("COL-003057", "2026-09");
    expect(a).toBe("FOLHA-COL-003057-2026-09");
    expect(integracaoFolhaDe(" col-003057 ", "2026-09-01")).toBe(a);
  });

  it("competências diferentes são chaves diferentes", () => {
    expect(integracaoFolhaDe("COL-003057", "2026-09"))
      .not.toBe(integracaoFolhaDe("COL-003057", "2026-10"));
  });

  /* O caso real que derrubou a primeira versão desta chave: em 26/08/2026 o
     espelho do RH tinha QUATRO pessoas ativas com o CNPJ 37.511.891/0001-50.
     Com o CNPJ na chave, o Omie pagaria uma e recusaria três por duplicidade. */
  it("quatro pessoas com o MESMO CNPJ ainda têm chaves distintas", () => {
    const mesmoCnpj = "37.511.891/0001-50";
    const { itens } = montarLote(
      [
        pessoa({ id: "a", codigo: "COL-000001", nome: "André Luis Rocon", cnpj: mesmoCnpj, valor: 3000 }),
        pessoa({ id: "b", codigo: "COL-000002", nome: "Caio Caiado", cnpj: mesmoCnpj, valor: 2500 }),
        pessoa({ id: "c", codigo: "COL-000003", nome: "Kelly Travieso", cnpj: mesmoCnpj, valor: 3700 }),
        pessoa({ id: "d", codigo: "COL-000004", nome: "Wericles Silva", cnpj: mesmoCnpj, valor: 4500 }),
      ],
      "2026-09",
    );
    expect(itens).toHaveLength(4);
    expect(new Set(itens.map((i) => i.integracao)).size).toBe(4);
  });

  it("sem código do RH a pessoa fica FORA do lote, não com chave torta", () => {
    const { itens, fora } = montarLote([pessoa({ codigo: null })], "2026-09");
    expect(itens).toHaveLength(0);
    expect(fora[0].motivo).toMatch(/código/i);
  });

  it("é a mesma chave que o lote carimba na linha", () => {
    const { itens } = montarLote([pessoa()], "2026-09");
    expect(itens[0].integracao).toBe(integracaoFolhaDe("COL-003057", "2026-09"));
  });
});

describe("recusaDaFolha", () => {
  const ok: Parameters<typeof recusaDaFolha>[0] = {
    competencia: "2026-09",
    estado: null,
    itens: [{ cnpj: "66744328000120", codigoFornecedor: 5470888220, codigoCategoria: "2.01.01" }],
  };

  /* Os dois estados são cobrados, como em `cartao/envio.test.ts`: virar a chave
     nunca deixa a suíte "sem opinião". Desligada, o que importa é que NADA
     passe; ligada, que cada trava específica continue barrando. */

  it("desligada, recusa tudo — inclusive o lote perfeito", () => {
    if (ENVIO_FOLHA_LIBERADO) return;
    expect(bloqueioDaFolha()).toContain("desligado");
    expect(recusaDaFolha({ ...ok })).toContain("desligado");
  });

  it("ligada, deixa passar o lote em ordem", () => {
    if (!ENVIO_FOLHA_LIBERADO) return;
    expect(bloqueioDaFolha()).toBeNull();
    expect(recusaDaFolha({ ...ok })).toBeNull();
  });

  it("ligada, barra competência até o marco e libera a seguinte", () => {
    if (!ENVIO_FOLHA_LIBERADO) return;
    const marco = MARCO_FOLHA_FORA_DO_HUB.slice(0, 7);
    const seguinte = proximaCompetencia(marco);
    expect(recusaDaFolha({ ...ok, competencia: marco })).toMatch(/à mão/);
    expect(recusaDaFolha({ ...ok, competencia: seguinte })).toBeNull();
  });

  it("ligada, barra competência já enviada ou lançada fora do Hub", () => {
    if (!ENVIO_FOLHA_LIBERADO) return;
    expect(recusaDaFolha({ ...ok, estado: "enviado" })).toMatch(/já foi enviada/);
    expect(recusaDaFolha({ ...ok, estado: "fora_do_hub" })).toMatch(/fora do Hub/);
    expect(recusaDaFolha({ ...ok, estado: "pendente" })).toBeNull();
  });

  it("ligada, barra colaborador sem fornecedor no Omie, dizendo quantos", () => {
    if (!ENVIO_FOLHA_LIBERADO) return;
    const r = recusaDaFolha({
      ...ok,
      itens: [
        { cnpj: "11111111000111", codigoFornecedor: 1, codigoCategoria: "2.01.01" },
        { cnpj: "22222222000122", codigoFornecedor: null, codigoCategoria: "2.01.01" },
        { cnpj: "33333333000133", codigoFornecedor: null, codigoCategoria: "2.01.01" },
      ],
    });
    expect(r).toMatch(/^2 colaborador/);
  });

  it("ligada, exige competência e repassa as pendências das linhas", () => {
    if (!ENVIO_FOLHA_LIBERADO) return;
    expect(recusaDaFolha({ ...ok, competencia: "" })).toMatch(/Competência/);
    expect(recusaDaFolha({ ...ok, itens: [] })).toMatch(/ninguém no lote/);
  });
});

/* As pendências de linha não dependem da chave nem do marco — são testáveis
   agora, com o envio desligado. Todos os casos abaixo são defeitos REAIS lidos
   no espelho do RH em 26/08/2026, não hipóteses. */
describe("pendenciasDoLote", () => {
  const linha = (over: Partial<Parameters<typeof pendenciasDoLote>[0][0]> = {}) => ({
    cnpj: "66744328000120",
    codigoFornecedor: 5470888220 as number | null,
    codigoCategoria: "3.1.1.4. Pessoal - Tecnologia" as string | null,
    ...over,
  });

  it("deixa passar a linha completa", () => {
    expect(pendenciasDoLote([linha()])).toBeNull();
  });

  it("barra CNPJ dividido por mais de uma pessoa", () => {
    // Os quatro do CNPJ 37.511.891/0001-50 iriam para o mesmo fornecedor.
    const mesmo = "37511891000150";
    expect(pendenciasDoLote([linha({ cnpj: mesmo }), linha({ cnpj: mesmo })]))
      .toMatch(/mesmo fornecedor/);
  });

  it("barra CNPJ truncado ou vazio — os casos reais do espelho", () => {
    for (const cnpj of ["61107569", "58313176", "6500769400134", "5208619200012", ""]) {
      expect(
        pendenciasDoLote([linha({ cnpj })]),
        `CNPJ ${cnpj || "(vazio)"} deveria ser barrado`,
      ).toMatch(/ausente ou incompleto/);
    }
  });

  it("barra quem não achou fornecedor no Omie, dizendo quantos", () => {
    expect(pendenciasDoLote([
      linha({ cnpj: "11111111000111" }),
      linha({ cnpj: "22222222000122", codigoFornecedor: null }),
      linha({ cnpj: "33333333000133", codigoFornecedor: null }),
    ])).toMatch(/^2 colaborador/);
  });

  it("barra quem está sem categoria", () => {
    expect(pendenciasDoLote([linha({ codigoCategoria: "" })])).toMatch(/sem categoria/);
    expect(pendenciasDoLote([linha({ codigoCategoria: null })])).toMatch(/sem categoria/);
  });

  it("barra lote vazio", () => {
    expect(pendenciasDoLote([])).toMatch(/ninguém no lote/);
  });
});

/** '2026-08' → '2026-09'. Só para o teste do marco não depender de data fixa. */
function proximaCompetencia(comp: string): string {
  const [a, m] = comp.split("-").map(Number);
  const d = new Date(a, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------
 * O payload
 * ------------------------------------------------------------------
 * Preso à planilha de importação da folha de julho/2026 ("Provisão pag
 * junho.xlsx") e ao fluxo n8n de conta a pagar de parceiro. É esse par que
 * define o que "certo" significa aqui — não a documentação do Omie, que não
 * diz qual campo a empresa usa para quê.
 */

const TITULO: TituloDaFolha = {
  integracao: "FOLHA-COL-592355-2026-07",
  codigoFornecedor: 5470888220,
  idContaCorrente: 1234567890,
  codigoCategoria: "3.1.1.4. Pessoal - Tecnologia",
  codigoDepartamento: "TEC",
  valor: 7500,
  registro: "2026-07-31",
  vencimento: "2026-08-05",
  previsao: "2026-08-05",
  nome: "Ádrian Coradini da Silva",
  chavePix: "66744328000120",
  cnpj: "66.744.328/0001-20",
  razao: "ADRIAN CORADINI SERVICOS LTDA",
};

describe("montarTituloFolha", () => {
  it("ancora a DRE no último dia da competência, não no dia do pagamento", () => {
    // Col. J da planilha = 31/07/2026; col. K = 05/08/2026. Trocar isto joga a
    // folha de julho para a DRE de agosto.
    const p = montarTituloFolha(TITULO);
    expect(p.data_entrada).toBe("31/07/2026");
    expect(p.data_vencimento).toBe("05/08/2026");
    expect(p.data_previsao).toBe("05/08/2026");
  });

  it("a previsão anda sozinha quando o vencimento cai no fim de semana", () => {
    const p = montarTituloFolha({ ...TITULO, vencimento: "2026-09-05", previsao: "2026-09-07" });
    expect(p.data_vencimento).toBe("05/09/2026");
    expect(p.data_previsao).toBe("07/09/2026");
  });

  it("leva o NOME da pessoa na observação — col. S da planilha", () => {
    expect(montarTituloFolha(TITULO).observacao).toBe("Ádrian Coradini da Silva");
  });

  it("distribui 100% num departamento só — col. AX 'Departamento (100%)'", () => {
    expect(montarTituloFolha(TITULO).departamentos).toEqual([{ cCodDep: "TEC", nPerc: 100 }]);
  });

  it("manda o CNAB fixo das colunas AA e AJ", () => {
    const cnab = montarTituloFolha(TITULO).cnab_integracao_bancaria as Record<string, unknown>;
    expect(cnab.codigo_forma_pagamento).toBe(FORMA_PAGAMENTO_FOLHA);   // "Transferência Bancária"
    expect(cnab.finalidade_transferencia).toBe(FINALIDADE_PIX_FOLHA);  // "Transferência por Chave PIX"
    expect(cnab.cpf_cnpj_transferencia).toBe("66744328000120");
    expect(cnab.nome_transferencia).toBe("ADRIAN CORADINI SERVICOS LTDA");
  });

  it("sem chave PIX cadastrada, usa o CNPJ — como o fluxo de parceiro já faz", () => {
    for (const pix of [null, "", "   "]) {
      const cnab = montarTituloFolha({ ...TITULO, chavePix: pix })
        .cnab_integracao_bancaria as Record<string, unknown>;
      expect(cnab.pix_qrcode).toBe("66744328000120");
    }
  });

  it("sem razão social, o titular da transferência é o nome da pessoa", () => {
    const cnab = montarTituloFolha({ ...TITULO, razao: null })
      .cnab_integracao_bancaria as Record<string, unknown>;
    expect(cnab.nome_transferencia).toBe("Ádrian Coradini da Silva");
  });

  it("arredonda o valor para centavos", () => {
    expect(montarTituloFolha({ ...TITULO, valor: 2777.7666 }).valor_documento).toBe(2777.77);
  });

  it("SEMPRE manda o código de integração — a coluna que ficava vazia na mão", () => {
    // Sem ele o Omie aceita o mesmo lote duas vezes e cria a folha em dobro.
    expect(montarTituloFolha(TITULO).codigo_lancamento_integracao).toBe("FOLHA-COL-592355-2026-07");
  });

  it("não manda o que ficava em branco nas 103 linhas da planilha", () => {
    const p = montarTituloFolha(TITULO);
    // Folha não tem nota fiscal: nada de tipo/número de documento nem parcela.
    for (const campo of [
      "codigo_tipo_documento", "numero_documento", "numero_parcela",
      "data_emissao", "data_pagamento", "valor_pagamento",
    ]) {
      expect(p[campo], `${campo} deveria ficar de fora`).toBeUndefined();
    }
  });
});

/* As dez categorias da folha, com o código REAL lido do Omie em 26/08/2026
   (`ListarCategorias`, 177 categorias). A tabela existe para prender o par:
   a descrição carrega a numeração contábil interna ("3.1.1.4.") e o código do
   Omie é outro ("2.03.13"). Deduzir um do outro já esteve errado aqui. */
const CATEGORIAS_REAIS: [string, string][] = [
  ["3.1.1.1. Pessoal - Administrativo", "2.03.10"],
  ["3.1.1.10 Pessoal - Novos Canais", "2.03.08"],
  ["3.1.1.14 Pessoal - Automações", "2.03.05"],
  ["3.1.1.2. Pessoal - Comercial", "2.03.11"],
  ["3.1.1.3. Pessoal - Marketing", "2.03.12"],
  ["3.1.1.4. Pessoal - Tecnologia", "2.03.13"],
  ["3.2.22 Diretores - Administrativo", "2.04.95"],
  ["3.2.7.1. Pessoal - Onboarding", "2.02.92"],
  ["3.2.7.2. Pessoal - Suporte", "2.01.98"],
  ["3.2.7.3. Pessoal - Sucesso", "2.01.97"],
];

describe("resolvedorDeCategoria", () => {
  const catalogo = CATEGORIAS_REAIS.map(([descricao, codigo]) => ({ codigo, descricao }));
  const resolver = resolvedorDeCategoria(catalogo);

  it("resolve as dez categorias da folha pelo catálogo do Omie", () => {
    for (const [descricao, codigo] of CATEGORIAS_REAIS) {
      expect(resolver(descricao), descricao).toBe(codigo);
    }
  });

  it("NÃO confunde a numeração interna da descrição com o código do Omie", () => {
    // O erro que este teste existe para impedir: mandar "3.1.1.4" onde o Omie
    // espera "2.03.13" põe a folha inteira na categoria errada da DRE.
    expect(resolver("3.1.1.4. Pessoal - Tecnologia")).toBe("2.03.13");
    expect(resolver("3.1.1.4. Pessoal - Tecnologia")).not.toBe("3.1.1.4");
  });

  it("aguenta acento, caixa e espaço sobrando", () => {
    expect(resolver("  3.1.1.14   pessoal - automacoes ")).toBe("2.03.05");
    expect(resolver("3.1.1.14 PESSOAL - AUTOMAÇÕES")).toBe("2.03.05");
  });

  it("devolve null para o que não existe no cadastro — vira pendência, não chute", () => {
    expect(resolver("3.9.9.9 Pessoal - Inventado")).toBeNull();
    expect(resolver("")).toBeNull();
  });

  it("ignora categoria inativa do Omie", () => {
    const r = resolvedorDeCategoria([
      { codigo: "9.99", descricao: "3.1.1.4. Pessoal - Tecnologia", conta_inativa: true },
    ]);
    expect(r("3.1.1.4. Pessoal - Tecnologia")).toBeNull();
  });
});

describe("o lote", () => {
  it("embrulha os títulos como o IncluirContaPagarPorLote espera", () => {
    const lote = montarLoteParaOmie([TITULO, { ...TITULO, integracao: "FOLHA-COL-000001-2026-07" }], 7);
    expect(lote.lote).toBe(7);
    const itens = lote.conta_pagar_cadastro as Record<string, unknown>[];
    expect(itens).toHaveLength(2);
    expect(itens[0].codigo_lancamento_integracao).toBe("FOLHA-COL-592355-2026-07");
    expect(itens[1].codigo_lancamento_integracao).toBe("FOLHA-COL-000001-2026-07");
  });

  it("cada item do lote é o MESMO payload do título avulso", () => {
    const lote = montarLoteParaOmie([TITULO], 1);
    expect((lote.conta_pagar_cadastro as unknown[])[0]).toEqual(montarTituloFolha(TITULO));
  });

  it("fatia a folha inteira em lotes do tamanho aceito", () => {
    const muitos = Array.from({ length: 103 }, (_, i) => ({ ...TITULO, integracao: `FOLHA-X-${i}` }));
    const lotes = fatiarEmLotes(muitos);
    expect(lotes.map((l) => l.length)).toEqual([TITULOS_POR_LOTE, 3]);
    // Ninguém pode sumir nem aparecer duas vezes no fatiamento.
    const chaves = lotes.flat().map((t) => t.integracao);
    expect(chaves).toHaveLength(103);
    expect(new Set(chaves).size).toBe(103);
  });

  it("lote vazio não vira chamada", () => {
    expect(fatiarEmLotes([])).toEqual([]);
  });
});
