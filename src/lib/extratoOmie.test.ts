import { describe, it, expect } from "vitest";
import { classificaAsaas, taxaEstornada, type AsaasKey } from "./extratoAsaas";
import {
  classificar,
  agruparPorDia,
  categoriaDe,
  codIntLanc,
  contrapartidasNoPago,
  linhasParaOmie,
  dataOmie,
  liquidoDe,
  CATEGORIA_ENTRADA,
  CATEGORIA_SAIDA,
  NCODCC_ASAAS_PAGO,
  type LinhaExtrato,
  type Natureza,
} from "../../supabase/functions/_shared/extrato-omie.ts";

/* As frases são as REAIS do `asaas_extrato` (levantadas em 10/09/2026, 13.220
   linhas): não há uma única linha no espelho que caia fora destes formatos. */
const REAIS: [string, Natureza][] = [
  ["Cobrança recebida - fatura nr. 573236590 Maria Bolaria", "recebimento"],
  ["Taxa de mensageria - fatura nr. 590536267 Torteria - Higienopolis", "taxa_cobranca"],
  ["Taxa de emissão da nota fiscal de serviço nr. 14939 - fatura nr. 843173536 - Nosso Rancho", "taxa_nf"],
  ["Taxa de cartão - fatura nr. 573236590 Maria Bolaria", "taxa_meios"],
  ["Taxa do Pix - fatura nr. 732614167 Andorinha Cozinha Afetiva", "taxa_meios"],
  ["Taxa de boleto - fatura nr. 719324432 Ze Steak & Fire", "taxa_meios"],
  ["Taxa de notificação por WhatsApp da cobrança 844795652 Sorveteria do Alemão", "taxa_cobranca"],
  ["Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA", "transferencia"],
  ["Estorno - fatura nr. 590536267 Torteria - Higienopolis", "estorno"],
  ["Bloqueio de saldo devido ao chargeback - fatura nr. 807959851", "estorno"],
  ["Cancelamento do bloqueio de saldo devido ao chargeback - fatura nr. 807959851", "estorno"],
  // O estorno de taxa volta para o balde da PRÓPRIA taxa, para abatê-la.
  ["Estorno da taxa de cartão - fatura nr. 806070082 Sugar Club Confeitaria", "taxa_meios"],
  ["Estorno da taxa de mensageria - fatura nr. 123 Bar do Zé", "taxa_cobranca"],
];

describe("classificar — a natureza sai do começo da frase", () => {
  it.each(REAIS)("%s", (historico, esperado) => {
    expect(classificar(historico)).toBe(esperado);
  });

  it("a armadilha do 'coNFeitaria' — cobrança não vira taxa de NF", () => {
    expect(classificar("Cobrança recebida - fatura nr. 821395843 Lai Comfeitaria e Café")).toBe("recebimento");
    expect(classificar("Taxa de cartão - fatura nr. 1 Confeitaria Vista Alegre")).toBe("taxa_meios");
  });

  it("a armadilha da varrida de saldo — transferência não vira taxa do Pix", () => {
    expect(classificar("Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA")).toBe("transferencia");
  });

  it("tipo de taxa novo continua somando, em 'meios de pagamento'", () => {
    expect(classificar("Taxa de antecipação inventada - fatura nr. 9")).toBe("taxa_meios");
  });

  it("frase vazia ou nula não derruba a classificação", () => {
    expect(classificar(null)).toBe("outros");
    expect(classificar("")).toBe("outros");
  });
});

/* ------------------------------------------------------------------------- *
 * O ESPELHO. `src/lib/extratoAsaas.ts` pinta o painel da conta corrente e este
 * módulo escreve no Omie. Se as duas réguas divergirem, a tela e o ERP passam a
 * discordar sobre o mesmo lançamento — e a divergência seria silenciosa.
 * ------------------------------------------------------------------------- */
const DO_PAINEL: Record<AsaasKey, Natureza> = {
  cobranca: "recebimento",
  mensageria: "taxa_cobranca",
  whatsapp: "taxa_cobranca",
  nf: "taxa_nf",
  cartao: "taxa_meios",
  pix: "taxa_meios",
  boleto: "taxa_meios",
  taxa: "taxa_meios",
  transferencia: "transferencia",
  estorno: "estorno",
  chargeback: "estorno",
  outros: "outros",
};

describe("as duas réguas não podem divergir", () => {
  it.each(REAIS.map(([h]) => h))("%s", (historico) => {
    // O painel trata o estorno de taxa em duas peças (classifica como estorno e
    // devolve a taxa abatida em `taxaEstornada`); aqui é uma peça só.
    const devolvida = taxaEstornada(historico);
    const esperado = devolvida ? DO_PAINEL[devolvida] : DO_PAINEL[classificaAsaas(historico)];
    expect(classificar(historico)).toBe(esperado);
  });
});

/* ------------------------------------------------------------------------- */

const linha = (
  id: string,
  dia: string,
  tipo: "credito" | "debito",
  valor: number,
  historico: string,
): LinhaExtrato => ({ id_transacao: id, data_movimento: dia, tipo, valor, historico });

describe("agruparPorDia", () => {
  it("resume um dia inteiro em um lançamento por natureza", () => {
    const out = agruparPorDia([
      linha("a", "2026-09-03", "credito", 449, "Cobrança recebida - fatura nr. 1 GoJuice"),
      linha("b", "2026-09-03", "credito", 313.25, "Cobrança recebida - fatura nr. 2 A Varanda"),
      linha("c", "2026-09-03", "debito", 1.99, "Taxa de boleto - fatura nr. 1 GoJuice"),
      linha("d", "2026-09-03", "debito", 0.89, "Taxa de mensageria - fatura nr. 2 A Varanda"),
    ]);

    expect(out).toHaveLength(3);
    const rec = out.find((l) => l.natureza === "recebimento")!;
    expect(rec.valor).toBe(762.25);
    expect(rec.lancamentos).toBe(2);
    expect(rec.categoria).toBe(CATEGORIA_ENTRADA);

    expect(out.find((l) => l.natureza === "taxa_meios")!.valor).toBe(-1.99);
    expect(out.find((l) => l.natureza === "taxa_cobranca")!.valor).toBe(-0.89);
  });

  it("o valor é o LÍQUIDO: o estorno da taxa abate a taxa do dia", () => {
    const out = agruparPorDia([
      linha("a", "2026-09-03", "debito", 11.97, "Taxa de cartão - fatura nr. 1 Boteco"),
      linha("b", "2026-09-03", "credito", 5.51, "Estorno da taxa de cartão - fatura nr. 1 Boteco"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].natureza).toBe("taxa_meios");
    expect(out[0].valor).toBe(-6.46);
    expect(out[0].lancamentos).toBe(2);
    // Dia devedor: segue na categoria real, que é o que soma em "Meios de Pagamento".
    expect(out[0].categoria).toBe("2.01.03");
  });

  it("dia de taxa que fecha CREDOR sai pela categoria de entrada", () => {
    /* O Omie tira a direção da categoria, não do sinal do valor — categoria de
       despesa com dinheiro entrando lançaria para o lado errado e o saldo
       divergiria calado. Ver `categoriaDe`. */
    const out = agruparPorDia([
      linha("a", "2026-09-03", "debito", 5, "Taxa de cartão - fatura nr. 1 Boteco"),
      linha("b", "2026-09-03", "credito", 12, "Estorno da taxa de cartão - fatura nr. 1 Boteco"),
    ]);
    expect(out[0].valor).toBe(7);
    expect(out[0].categoria).toBe(CATEGORIA_ENTRADA);
  });

  it("dia que se anula não vira lançamento", () => {
    const out = agruparPorDia([
      linha("a", "2026-09-03", "debito", 11.97, "Taxa de cartão - fatura nr. 1 Boteco"),
      linha("b", "2026-09-03", "credito", 11.97, "Estorno da taxa de cartão - fatura nr. 1 Boteco"),
    ]);
    expect(out).toEqual([]);
  });

  it("a saída de saldo para o banco entra como transferência de saída", () => {
    const out = agruparPorDia([
      linha("a", "2026-09-04", "debito", 60000, "Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA"),
    ]);
    expect(out[0].categoria).toBe(CATEGORIA_SAIDA);
    expect(out[0].valor).toBe(-60000);
  });

  it("o líquido do período é a soma assinada — é o que o saldo do Omie tem de andar", () => {
    const out = agruparPorDia([
      linha("a", "2026-09-03", "credito", 1000, "Cobrança recebida - fatura nr. 1 X"),
      linha("b", "2026-09-03", "debito", 20, "Taxa de cartão - fatura nr. 1 X"),
      linha("c", "2026-09-04", "debito", 900, "Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA"),
    ]);
    expect(liquidoDe(out)).toBe(80);
  });

  it("ignora linha sem data válida ou sem valor, sem derrubar o resto", () => {
    const out = agruparPorDia([
      linha("a", "", "credito", 100, "Cobrança recebida - fatura nr. 1 X"),
      linha("b", "2026-09-03", "credito", 0, "Cobrança recebida - fatura nr. 2 X"),
      linha("c", "2026-09-03", "credito", 50, "Cobrança recebida - fatura nr. 3 X"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].valor).toBe(50);
    expect(out[0].lancamentos).toBe(1);
  });

  it("a ordem é estável: por dia, depois por sigla", () => {
    const dias = agruparPorDia([
      linha("a", "2026-09-04", "debito", 1, "Taxa de cartão - fatura nr. 1 X"),
      linha("b", "2026-09-03", "credito", 1, "Cobrança recebida - fatura nr. 1 X"),
      linha("c", "2026-09-03", "debito", 1, "Taxa de cartão - fatura nr. 2 X"),
    ]).map((l) => l.cod_int_lanc);
    expect(dias).toEqual(["ASAAS-20260903-REC", "ASAAS-20260903-TXM", "ASAAS-20260904-TXM"]);
  });
});

describe("a chave de idempotência cabe no campo do Omie", () => {
  it("cCodIntLanc tem no máximo 20 caracteres", () => {
    for (const nat of ["recebimento", "taxa_meios", "taxa_cobranca", "taxa_nf", "transferencia", "estorno", "outros"] as Natureza[]) {
      const cod = codIntLanc("2026-12-31", nat);
      expect(cod.length).toBeLessThanOrEqual(20);
      expect(cod).toMatch(/^ASAAS-\d{8}-[A-Z]{3}$/);
    }
  });

  it("o mesmo dia e a mesma natureza dão sempre a mesma chave", () => {
    expect(codIntLanc("2026-09-03", "recebimento")).toBe(codIntLanc("2026-09-03", "recebimento"));
    expect(codIntLanc("2026-09-03", "recebimento")).not.toBe(codIntLanc("2026-09-03", "taxa_meios"));
  });
});

describe("linhasParaOmie — o espelho linha a linha que a contabilidade exige", () => {
  const bruto = [
    linha("ftn_000000000001", "2026-09-03", "credito", 449, "Cobrança recebida - fatura nr. 1 GoJuice"),
    linha("ftn_000000000002", "2026-09-03", "debito", 1.99, "Taxa de boleto - fatura nr. 1 GoJuice"),
    linha("ftn_000000000003", "2026-09-04", "debito", 60000, "Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA"),
  ];

  it("uma linha do extrato vira um lançamento, com a chave do próprio Asaas", () => {
    const ls = linhasParaOmie(bruto);
    expect(ls).toHaveLength(3);
    expect(ls[0].id_transacao).toBe("ftn_000000000001");
    expect(ls[0].id_transacao.length).toBeLessThanOrEqual(20);
  });

  it("o valor é assinado pelo tipo, e a categoria sai da mesma escada de sempre", () => {
    const [rec, taxa, transf] = linhasParaOmie(bruto);
    expect(rec.valor).toBe(449);
    expect(rec.categoria).toBe(CATEGORIA_ENTRADA);
    expect(taxa.valor).toBe(-1.99);
    expect(taxa.categoria).toBe("2.01.03");
    expect(transf.valor).toBe(-60000);
    expect(transf.categoria).toBe(CATEGORIA_SAIDA);
  });

  it("o histórico original vai inteiro para a observação — é o 'mesmas informações'", () => {
    expect(linhasParaOmie(bruto)[0].observacao)
      .toBe("Cobrança recebida - fatura nr. 1 GoJuice");
  });

  /* O Asaas escreve parte dos nomes na forma DECOMPOSTA: "Café" chega como
     `Cafe` + U+0301 (acento combinante). Visualmente igual, em bytes não — e o
     Omie responde "Parâmetro informado não é um hash válido! => null", que não
     fala em acento nenhum. Dez linhas do mesmo cliente travaram o backfill
     inteiro por 6h23 em 11/09/2026. */
  it("acento DECOMPOSTO do Asaas vira precomposto antes de ir ao Omie", () => {
    const decomposto = "Cobranca recebida - fatura nr. 9 Santa Clara Padoca e Cafe\u0301";
    const [l] = linhasParaOmie([linha("ftn_nfc", "2026-04-24", "credito", 648, decomposto)]);

    // O que o Asaas mandou tem um caractere a mais que o que sai daqui.
    expect(decomposto.length).toBe(l.observacao.length + 1);
    expect(l.observacao).toBe(decomposto.normalize("NFC"));
    expect(l.observacao.endsWith("Café")).toBe(true);
    expect(/[\u0300-\u036f]/.test(l.observacao)).toBe(false);
  });

  it("o total linha a linha bate com o total do resumo diário", () => {
    const porLinha = linhasParaOmie(bruto).reduce((s, l) => s + l.valor, 0);
    expect(Math.round(porLinha * 100) / 100).toBe(liquidoDe(agruparPorDia(bruto)));
  });

  it("descarta o que não dá para espelhar, sem derrubar o resto", () => {
    const ls = linhasParaOmie([
      linha("", "2026-09-03", "credito", 10, "Cobrança recebida - fatura nr. 1 X"),
      linha("ftn_x", "", "credito", 10, "Cobrança recebida - fatura nr. 2 X"),
      linha("ftn_y", "2026-09-03", "credito", 0, "Cobrança recebida - fatura nr. 3 X"),
      linha("ftn_z", "2026-09-03", "credito", 10, "Cobrança recebida - fatura nr. 4 X"),
    ]);
    expect(ls.map((l) => l.id_transacao)).toEqual(["ftn_z"]);
  });

  it("a ordem é estável: por dia, depois por id", () => {
    const ids = linhasParaOmie([...bruto].reverse()).map((l) => l.id_transacao);
    expect(ids).toEqual(["ftn_000000000001", "ftn_000000000002", "ftn_000000000003"]);
  });
});

describe("contrapartidasNoPago — o que entra na Disponível sai da Pago", () => {
  const dia = () => agruparPorDia([
    linha("a", "2026-09-03", "credito", 449, "Cobrança recebida - fatura nr. 1 GoJuice"),
    linha("b", "2026-09-03", "credito", 313.25, "Cobrança recebida - fatura nr. 2 A Varanda"),
    linha("c", "2026-09-03", "debito", 1.99, "Taxa de boleto - fatura nr. 1 GoJuice"),
    linha("d", "2026-09-03", "debito", 60000, "Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA"),
    linha("e", "2026-09-03", "debito", 10, "Estorno - fatura nr. 3 X"),
  ]);

  it("espelha o recebimento como saída, na conta certa", () => {
    const [c] = contrapartidasNoPago(dia());
    expect(c.ncodcc).toBe(NCODCC_ASAAS_PAGO);
    expect(c.cod_int_lanc).toBe("ASAAS-20260903-SPG");
    expect(c.valor).toBe(-762.25);
    expect(c.categoria).toBe(CATEGORIA_SAIDA);
  });

  /* Taxa, varrida para o banco e estorno acontecem DEPOIS que o dinheiro já está
     disponível. Dar perna a eles mexeria no faturado por evento que não é
     faturamento — e o resíduo da conta deixaria de significar o que significa. */
  it("só o recebimento gera contrapartida", () => {
    expect(contrapartidasNoPago(dia())).toHaveLength(1);
  });

  it("o total das contrapartidas é o total recebido, com sinal trocado", () => {
    const ls = dia();
    const recebido = ls.filter((l) => l.natureza === "recebimento").reduce((s, l) => s + l.valor, 0);
    expect(liquidoDe(contrapartidasNoPago(ls))).toBe(-recebido);
  });

  it("dia sem recebimento não gera perna nenhuma", () => {
    const so_taxa = agruparPorDia([linha("a", "2026-09-03", "debito", 5, "Taxa de cartão - fatura nr. 1 X")]);
    expect(contrapartidasNoPago(so_taxa)).toEqual([]);
  });

  it("a chave não colide com a do recebimento do mesmo dia", () => {
    const ls = dia();
    const rec = ls.find((l) => l.natureza === "recebimento")!;
    expect(contrapartidasNoPago(ls)[0].cod_int_lanc).not.toBe(rec.cod_int_lanc);
    expect(contrapartidasNoPago(ls)[0].cod_int_lanc.length).toBeLessThanOrEqual(20);
  });
});

describe("categoriaDe / dataOmie", () => {
  it("natureza neutra escolhe a categoria pelo sinal", () => {
    expect(categoriaDe("recebimento", 100)).toBe(CATEGORIA_ENTRADA);
    expect(categoriaDe("estorno", -100)).toBe(CATEGORIA_SAIDA);
    expect(categoriaDe("estorno", 100)).toBe(CATEGORIA_ENTRADA);
  });

  it("a taxa devedora vai na categoria real; a credora, na de entrada", () => {
    expect(categoriaDe("taxa_nf", -1)).toBe("2.01.93");
    expect(categoriaDe("taxa_meios", -1)).toBe("2.01.03");
    expect(categoriaDe("taxa_cobranca", -1)).toBe("2.01.92");
    // Categoria de despesa com dinheiro entrando lançaria para o lado errado.
    expect(categoriaDe("taxa_nf", 1)).toBe(CATEGORIA_ENTRADA);
  });

  it("a data sai no formato que o Omie lê", () => {
    expect(dataOmie("2026-09-03")).toBe("03/09/2026");
  });
});
