import { describe, it, expect } from "vitest";
import {
  conferir, centavos, rotuloNaoPagavel, chaveDocumento,
  parcelaDoMemo, candidatosDaParcela, baseDaParcela, chaveDoParcelamento,
  carneDe, outraParcelaDoCarne, pedacoUsado,
  type Leitura, type Lancamento,
} from "../../supabase/functions/_shared/conferencia-comprovante.ts";

/* As transcrições abaixo são REAIS: saíram do Gemini lendo os 21 comprovantes que
 * estavam parados em "Em análise · COM NF" na competência de agosto/26 — recibos de
 * bilhete GOL e LATAM, NF-e da Central de Aviamentos, fatura da Hostinger, foto de
 * WhatsApp da Japate. Os campos de julgamento (`fornecedor_confere`,
 * `cobranca_explicada`, `item_rotulo`) são o ponteiro que se espera da IA para cada
 * caso; o que está sob teste aqui é a REGRA que decide em cima deles. */

const base: Leitura = {
  legivel: true,
  tipo_documento: "NF-e",
  emitente_nome: "FORNECEDOR LTDA",
  emitente_cnpj: "00.000.000/0001-00",
  valor_total: 100,
  valores: [{ rotulo: "Total", valor: 100 }],
  data_documento: "2026-07-15",
  numero_documento: "123",
  descricao: "compra",
  fornecedor_confere: "sim",
  cobranca_explicada: "total",
};
const ler = (p: Partial<Leitura>): Leitura => ({ ...base, ...p });
const gasto = (valor: number, titulo: string, data = "2026-07-15", extra: Partial<Lancamento> = {}): Lancamento =>
  ({ titulo, valor, data, ...extra });

describe("centavos", () => {
  it("compara dinheiro sem o erro do float", () => {
    expect(centavos(0.1 + 0.2)).toBe(30);
    expect(centavos(53.96)).toBe(5396);
    expect(centavos("119.61")).toBe(11961);
    // Estorno vem negativo do extrato; o que importa é o módulo.
    expect(centavos(-45.79)).toBe(4579);
  });
  it("devolve null para o que não é número", () => {
    expect(centavos(null)).toBeNull();
    expect(centavos(undefined)).toBeNull();
    expect(centavos("abc")).toBeNull();
    expect(centavos(Infinity)).toBeNull();
  });
});

describe("aprova quando o total do documento bate", () => {
  it("COMARELLA PIZZA BURG · NF-e de R$ 695,00 para cobrança de R$ 695,00", () => {
    const v = conferir(
      gasto(695, "COMARELLA PIZZA BURG VITORIA", "2026-07-22"),
      ler({
        emitente_nome: "COMARELLA PIZZA & BURGUER JARDIM CAMBURI LTDA",
        emitente_cnpj: "37.334.447/0001-07",
        valor_total: 695,
        valores: [
          { rotulo: "Base de Cálculo do ICMS", valor: 568 },
          { rotulo: "Valor do ICMS", valor: 18.18 },
          { rotulo: "Valor Total dos Produtos", valor: 670 },
          { rotulo: "Valor do Frete", valor: 25 },
          { rotulo: "Valor Total da Nota", valor: 695 },
        ],
        data_documento: "2026-07-22",
      }),
    );
    expect(v.veredito).toBe("aprovar");
    expect(v.como).toBe("total");
    expect(v.valor_casado).toBe(695);
  });

  it("DM *hostingercom · o memo não parece com o emitente, mas a IA confirma", () => {
    const v = conferir(
      gasto(329.99, "DM *hostingercom Lanarca", "2026-07-30"),
      ler({
        tipo_documento: "fatura",
        emitente_nome: "Hostinger International Ltd.",
        emitente_cnpj: "",
        valor_total: 329.99,
        valores: [{ rotulo: "Amount (BRL)", valor: 329.99 }, { rotulo: "VAT", valor: 0 }],
        data_documento: "2026-07-30",
        descricao: "Hospedagem de servidor KVM 8",
      }),
    );
    expect(v.veredito).toBe("aprovar");
  });

  it("ZIG*Fazenda Churrasc · quem emite é a razão social por trás da maquininha", () => {
    const v = conferir(
      gasto(319.79, "ZIG*Fazenda Churrasc Sao Paulo", "2026-07-23"),
      ler({
        tipo_documento: "NFC-e",
        emitente_nome: "FC COMERCIO DE ALIMENTOS E BEBIDAS LTDA",
        emitente_cnpj: "36.017.007/0001-63",
        valor_total: 319.79,
        valores: [
          { rotulo: "CHOPP", valor: 120 },
          { rotulo: "Gorjeta", valor: 36.79 },
          { rotulo: "Valor Total", valor: 319.79 },
          { rotulo: "Trib. aprox. Federal", valor: 47.32 },
        ],
        data_documento: "2026-07-23",
      }),
    );
    expect(v.veredito).toBe("aprovar");
  });

  it("LATAM AIR*0000V · bilhete cobrado inteiro, R$ 613,99", () => {
    const v = conferir(
      gasto(613.99, "LATAM AIR*0000V SAO PAULO", "2026-07-31"),
      ler({
        tipo_documento: "Bilhete Aéreo",
        emitente_nome: "TAM Linhas Aéreas S.A.",
        emitente_cnpj: "02.012.862/0001-60",
        valor_total: 613.99,
        valores: [
          { rotulo: "Voo", valor: 559.9 },
          { rotulo: "Taxas e/ou impostos(1)", valor: 54.09 },
          { rotulo: "Total pago", valor: 613.99 },
        ],
        data_documento: "2026-07-31",
      }),
    );
    expect(v.veredito).toBe("aprovar");
  });
});

describe("aprova pela LINHA quando a fatura cobra só um pedaço do documento", () => {
  /* O caso que obrigou a olhar linha a linha: a fatura do cartão lança a taxa de
   * embarque como uma cobrança separada da tarifa, e o recibo do bilhete traz as
   * duas. O total do recibo nunca vai bater com os R$ 53,96. */
  it("TAXA DE EMBARQUE GOL · recibo de R$ 674,10 com a taxa de R$ 53,96", () => {
    const v = conferir(
      gasto(53.96, "TAXA DE EMBARQUE GOL SAO PAULO", "2026-07-31"),
      ler({
        tipo_documento: "Bilhete Aéreo",
        emitente_nome: "GOL LINHAS AEREAS",
        emitente_cnpj: "07.575.651/0001-59",
        valor_total: 674.1,
        valores: [
          { rotulo: "Tarifa", valor: 620.14 },
          { rotulo: "Taxa de Embarque", valor: 53.96 },
          { rotulo: "Tarifa total", valor: 674.1 },
        ],
        data_documento: "2026-07-31",
        cobranca_explicada: "item",
        item_rotulo: "Taxa de Embarque",
      }),
    );
    expect(v.veredito).toBe("aprovar");
    expect(v.como).toBe("item");
    expect(v.item_rotulo).toBe("Taxa de Embarque");
    expect(v.valor_casado).toBe(53.96);
  });

  it("o mesmo, com o rótulo escrito de outro jeito no recibo", () => {
    const v = conferir(
      gasto(53.96, "TAXA DE EMBARQUE GOL SAO PAULO", "2026-07-31"),
      ler({
        emitente_nome: "GOL LINHAS AEREAS",
        valor_total: 382.1,
        valores: [
          { rotulo: "Tarifa", valor: 328.14 },
          { rotulo: "Tarifas / taxas / encargos", valor: 53.96 },
          { rotulo: "Tarifa total", valor: 382.1 },
        ],
        data_documento: "2026-07-31",
        cobranca_explicada: "item",
        item_rotulo: "Tarifas / taxas / encargos",
      }),
    );
    expect(v.veredito).toBe("aprovar");
    expect(v.valor_casado).toBe(53.96);
  });

  it("rótulo apontado não existe, mas uma linha vale exatamente a cobrança", () => {
    const v = conferir(
      gasto(53.96, "TAXA DE EMBARQUE GOL SAO PAULO", "2026-07-31"),
      ler({
        emitente_nome: "GOL LINHAS AEREAS",
        valor_total: 382.1,
        valores: [
          { rotulo: "Tarifa", valor: 328.14 },
          { rotulo: "Tarifas / taxas / encargos", valor: 53.96 },
        ],
        data_documento: "2026-07-31",
        cobranca_explicada: "item",
        item_rotulo: "Taxa de embarque (rótulo que o recibo não usa)",
      }),
    );
    expect(v.veredito).toBe("aprovar");
    expect(v.item_rotulo).toBe("Tarifas / taxas / encargos");
  });
});

/* ---------------------------------------------------------------------------
 * Parcelamento
 *
 * As duas leituras abaixo são as que estão gravadas em `auditoria.ia_leitura` dos
 * achados 428 e 429 (fatura de agosto/26): duas compras na Central de Aviamentos
 * feitas em 30/07, cada uma dividida em 2× pela maquininha. O MEMO das duas é
 * "CENTRAL DE AVIAMENTO  01/02   VITORIA" — mesmo lojista, mesmo marcador, notas
 * e valores diferentes. É o par que obriga o casamento a ser por VALOR, e não só
 * por fornecedor.
 * ------------------------------------------------------------------------- */

const MEMO_AVIAMENTO = "CENTRAL DE AVIAMENTO  01/02   VITORIA";

/** NF-e 178110 · R$ 251,31 · cobrada como 2× de R$ 125,66 / R$ 125,65. */
const nf178110 = ler({
  tipo_documento: "NF-E",
  emitente_nome: "CENTRAL DE AVIAMENTOS LTDA",
  emitente_cnpj: "32.424.350/0001-71",
  numero_documento: "178110",
  valor_total: 251.31,
  valores: [
    { rotulo: "BASE DE CÁLCULO DO ICMS", valor: 96.87 },
    { rotulo: "VALOR DO ICMS", valor: 16.46 },
    { rotulo: "VALOR TOTAL DOS PRODUTOS", valor: 253.03 },
    { rotulo: "VALOR DO FRETE", valor: 16 },
    { rotulo: "DESCONTO", valor: 17.72 },
    { rotulo: "VALOR TOTAL DA NOTA", valor: 251.31 },
  ],
  data_documento: "2026-07-30",
  descricao: "Compra de artigos de festa e decoração",
  cobranca_explicada: "nao",
  fornecedor_confere: "sim",
});

/** NF 178121 · R$ 78,25 · cobrada como 2× de R$ 39,13 / R$ 39,12. */
const nf178121 = ler({
  emitente_nome: "CENTRAL DE AVIAMENTOS LTDA",
  emitente_cnpj: "32.424.350/0001-71",
  numero_documento: "178121",
  valor_total: 78.25,
  valores: [
    { rotulo: "VALOR TOTAL DOS PRODUTOS", valor: 84.14 },
    { rotulo: "DESCONTO", valor: 5.89 },
    { rotulo: "VALOR TOTAL DA NOTA", valor: 78.25 },
  ],
  data_documento: "2026-07-30",
  cobranca_explicada: "nao",
  fornecedor_confere: "sim",
});

const parc1 = (valor: number, memo = MEMO_AVIAMENTO, comp = "2026-08-01") =>
  gasto(valor, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30", { memo, competencia: comp });

describe("parcelaDoMemo — o marcador que o Sicoob mantém na fatura", () => {
  it("lê os memos como eles chegam", () => {
    expect(parcelaDoMemo(MEMO_AVIAMENTO)).toEqual({ n: 1, de: 2 });
    expect(parcelaDoMemo("MP*MERCADOLIVREV      08/12   SAO PAULO")).toEqual({ n: 8, de: 12 });
    // A anuidade traz o final do cartão antes do marcador.
    expect(parcelaDoMemo("ANUIDADE VISA C      (3485) 08/12")).toEqual({ n: 8, de: 12 });
    // Formato antigo do n8n, com a anotação concatenada depois da barra vertical.
    expect(parcelaDoMemo("AIRBNB * HM894SYV 01/06 SAO PAULO | Tem comprovante, mas valor cheio x parcela")).toEqual({ n: 1, de: 6 });
  });
  it("o que não é parcela de cartão não vira parcela", () => {
    expect(parcelaDoMemo("MERCADOLIVRE*MERCADO  SAO VICENTE")).toBeNull();
    expect(parcelaDoMemo("COMPRA 30/07 VITORIA")).toBeNull();   // data: n > de
    expect(parcelaDoMemo("PARCELADO 01/36 SAO PAULO")).toBeNull(); // acima do teto
    expect(parcelaDoMemo("ALGO 01/01 VITORIA")).toBeNull();     // "1 de 1" é à vista
    expect(parcelaDoMemo(null)).toBeNull();
  });
});

describe("candidatosDaParcela — a sobra de centavos cai em algum lugar", () => {
  it("251,31 em 2 vezes é 125,66 + 125,65", () => {
    // Em 2× as duas convenções dão no mesmo: o centavo que sobra vai para a 1ª.
    expect(candidatosDaParcela(25131, 2, 1)).toEqual([12566]);
    expect(candidatosDaParcela(25131, 2, 2)).toEqual([12565]);
  });
  it("100,00 em 3 vezes: a última é a diferente", () => {
    expect(candidatosDaParcela(10000, 3, 1)).toContain(3334);
    expect(candidatosDaParcela(10000, 3, 3)).toContain(3332);
  });
  it("o que não é parcelamento não tem candidato", () => {
    expect(candidatosDaParcela(10000, 1, 1)).toEqual([]);
    expect(candidatosDaParcela(10000, 2, 3)).toEqual([]);
    expect(candidatosDaParcela(0, 2, 1)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * O bilhete aéreo parcelado
 *
 * Os três achados da fatura de agosto/26 (393, 394 e 396) que ficaram parados em
 * "Em análise" com a frase "R$ 182,38 × 3 não dá o total do documento
 * (R$ 601,10)". A GOL parcela a TARIFA e cobra a taxa de embarque à parte, no
 * mesmo dia: 547,14 ÷ 3 = 182,38, e os R$ 53,96 viram outro lançamento — que já
 * era aprovado sozinho, pela linha.
 * ------------------------------------------------------------------------- */

/** Recibo nº 1272309021809 · tarifa R$ 547,14 + taxa R$ 53,96 = R$ 601,10. */
const bilheteGol = ler({
  tipo_documento: "Bilhete Aéreo",
  emitente_nome: "GOL Linhas Aéreas S.A",
  emitente_cnpj: "07.575.651/0001-59",
  numero_documento: "1272309021809",
  valor_total: 601.1,
  valores: [
    { rotulo: "Tarifa", valor: 547.14 },
    { rotulo: "Taxa de Embarque", valor: 53.96 },
    { rotulo: "Tarifa total", valor: 601.1 },
  ],
  data_documento: "2026-07-31",
  descricao: "Passagem aérea de Florianópolis para Vitória",
  parcelas_total: 3,
  cobranca_explicada: "parcela",
});

const MEMO_GOL = "GOL LINHAS A*GYVUV    01/03   SAO PAULO";
const gol = (valor: number, memo = MEMO_GOL, comp = "2026-08-01") =>
  gasto(valor, "GOL LINHAS A*GYVUV SAO PAULO", "2026-07-31", { memo, competencia: comp });

describe("baseDaParcela — nem sempre é o total que foi dividido", () => {
  it("acha a linha que fecha a conta quando o total não fecha", () => {
    expect(baseDaParcela(bilheteGol, 3, 1, 182.38)).toEqual({ valor: 547.14, rotulo: "Tarifa", n: 1 });
  });
  it("o total continua vindo primeiro", () => {
    expect(baseDaParcela(bilheteGol, 3, 1, 200.37)).toEqual({ valor: 601.1, rotulo: null, n: 1 });
  });
  it("a sobra de centavos cabe na folga: 839,14 em 3× = 279,72", () => {
    const outro = ler({ valor_total: 893.1, valores: [{ rotulo: "Tarifa", valor: 839.14 }, { rotulo: "Taxa de embarque", valor: 53.96 }] });
    expect(baseDaParcela(outro, 3, 1, 279.72)?.rotulo).toBe("Tarifa");
  });
  it("imposto e desconto não são base de parcelamento", () => {
    // 16,46 é o ICMS destacado da NF-e 178110; 8,23 seria "metade do imposto".
    expect(baseDaParcela(nf178110, 2, 1, 8.23)).toBeNull();
  });
  it("nada do papel dividido dá a cobrança", () => {
    expect(baseDaParcela(bilheteGol, 3, 1, 99.9)).toBeNull();
    expect(baseDaParcela(bilheteGol, 1, 1, 601.1)).toBeNull();  // "1 vez" não é parcelamento
    expect(baseDaParcela(null, 3, 1, 182.38)).toBeNull();
  });
});

describe("aprova a parcela de uma LINHA do documento", () => {
  it("GOL · R$ 182,38 é a tarifa de R$ 547,14 em 3×, e a fatura marca 01/03", () => {
    const v = conferir(gol(182.38), bilheteGol);
    expect(v.veredito).toBe("aprovar");
    expect(v.como).toBe("parcela");
    expect(v.parcela).toEqual({ n: 1, de: 3 });
    expect(v.parcela_base).toBe(547.14);
    expect(v.item_rotulo).toBe("Tarifa");
    // A frase tem de dizer QUE linha foi dividida — senão a conta não fecha na
    // cabeça de quem lê: R$ 601,10 ÷ 3 é R$ 200,37, não R$ 182,38.
    expect(v.motivo).toContain("Tarifa");
    expect(v.motivo).toContain("R$ 547,14");
    expect(v.motivo).toContain("parcela 1/3");
  });

  it("a taxa de embarque do MESMO bilhete continua aprovada pela linha", () => {
    const v = conferir(
      gasto(53.96, "TAXA DE EMBARQUE GOL SAO PAULO", "2026-07-31"),
      { ...bilheteGol, cobranca_explicada: "item", item_rotulo: "Taxa de Embarque" },
    );
    expect(v.veredito).toBe("aprovar");
    expect(v.como).toBe("item");
  });

  it("são pedaços diferentes do mesmo papel — a trava de nota repetida não pega", () => {
    const taxa = gasto(53.96, "TAXA DE EMBARQUE GOL SAO PAULO", "2026-07-31");
    const leituraTaxa: Leitura = { ...bilheteGol, cobranca_explicada: "item", item_rotulo: "Taxa de Embarque" };
    // Para a trava é o mesmo papel: mesmo emitente, mesmo número, mesmo total.
    expect(chaveDocumento(leituraTaxa)).toBe(chaveDocumento(bilheteGol));
    // O que separa os dois lançamentos é a parte do documento que cada um gastou.
    expect(pedacoUsado(taxa, leituraTaxa)).not.toBe(pedacoUsado(gol(182.38), bilheteGol));
  });

  it("o carnê leva a TARIFA, não o total: 02/03 chega em setembro por R$ 182,38", () => {
    const carne = carneDe(gol(182.38), bilheteGol)!;
    expect(carne.base).toBe(547.14);
    const set = gol(182.38, "GOL LINHAS A*GYVUV    02/03   SAO PAULO", "2026-09-01");
    expect(outraParcelaDoCarne(carne, set)).toEqual({ n: 2, de: 3 });
    // Com o total no lugar da tarifa, a parcela de setembro seria R$ 200,37.
    expect(outraParcelaDoCarne(carne, gol(200.37, "GOL LINHAS A*GYVUV    02/03   SAO PAULO", "2026-09-01"))).toBeNull();
  });
});

describe("pedacoUsado — a mesma nota, partes diferentes", () => {
  const taxa = gasto(53.96, "TAXA DE EMBARQUE GOL SAO PAULO", "2026-07-31");
  it("nomeia o pedaço por como a cobrança casou", () => {
    expect(pedacoUsado(gasto(100, "F"), ler({}))).toBe("total");
    expect(pedacoUsado(taxa, ler({ ...bilheteGol, cobranca_explicada: "item", item_rotulo: "Taxa de Embarque" })))
      .toBe("linha|TAXA DE EMBARQUE");
    expect(pedacoUsado(gol(182.38), bilheteGol)).toBe("parcela|1/3|TARIFA");
    expect(pedacoUsado(parc1(125.66), nf178110)).toBe("parcela|1/2");
  });
  it("parcelas diferentes da mesma compra são pedaços diferentes", () => {
    const p2 = gasto(125.65, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30", {
      memo: "CENTRAL DE AVIAMENTO  02/02   VITORIA", competencia: "2026-09-01",
    });
    expect(pedacoUsado(p2, nf178110)).toBe("parcela|2/2");
  });
  it("sem casamento nenhum, o pedaço é o valor cobrado — nota repetida continua trancada", () => {
    const solto = ler({ valor_total: 500, valores: [{ rotulo: "Total", valor: 500 }], cobranca_explicada: "nao" });
    expect(pedacoUsado(gasto(77, "F"), solto)).toBe("valor|7700");
    expect(pedacoUsado(gasto(77, "OUTRO"), solto)).toBe("valor|7700");
  });
});

describe("aprova pela PARCELA quando a fatura cobra a nota em vezes", () => {
  it("CENTRAL DE AVIAMENTOS · R$ 125,66 é metade da NF-e 178110 e a fatura marca 01/02", () => {
    const v = conferir(parc1(125.66), nf178110);
    expect(v.veredito).toBe("aprovar");
    expect(v.como).toBe("parcela");
    expect(v.parcela).toEqual({ n: 1, de: 2 });
    expect(v.valor_casado).toBe(125.66);
    expect(v.motivo).toContain("parcela 1/2");
    expect(v.motivo).toContain("R$ 251,31");
  });

  it("a outra compra do mesmo dia, no mesmo lojista: R$ 39,13 da NF 178121", () => {
    const v = conferir(parc1(39.13), nf178121);
    expect(v.veredito).toBe("aprovar");
    expect(v.como).toBe("parcela");
  });

  it("a 2ª parcela, que vem com o centavo a menos", () => {
    const v = conferir(
      gasto(125.65, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30", {
        memo: "CENTRAL DE AVIAMENTO  02/02   VITORIA", competencia: "2026-09-01",
      }),
      nf178110,
    );
    expect(v.veredito).toBe("aprovar");
    expect(v.parcela).toEqual({ n: 2, de: 2 });
  });

  it("quando o marcador não veio, o documento pode dizer de si mesmo", () => {
    const v = conferir(
      gasto(125.66, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30"),
      { ...nf178110, parcelas_total: 2, cobranca_explicada: "parcela" },
    );
    expect(v.veredito).toBe("aprovar");
    expect(v.como).toBe("parcela");
  });

  it("o modelo aponta 'total' e erra — a parcela é a rede embaixo", () => {
    const v = conferir(parc1(125.66), { ...nf178110, cobranca_explicada: "total" });
    expect(v.veredito).toBe("aprovar");
    expect(v.como).toBe("parcela");
  });

  it("a nota inteira continua valendo pelo total, não pela parcela", () => {
    // Marcador na fatura e cobrança do valor cheio: é o total que bate.
    const v = conferir(
      parc1(251.31),
      { ...nf178110, cobranca_explicada: "total" },
    );
    expect(v.como).toBe("total");
  });
});

describe("a parcela não afrouxa nenhuma das outras travas", () => {
  it("a conta tem de fechar: R$ 90,00 em 2 vezes não dá R$ 251,31", () => {
    const v = conferir(parc1(90), nf178110);
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("2 vezes");
    expect(v.motivo).toContain("R$ 251,31");
  });

  it("linha de imposto continua sendo imposto, mesmo com marcador de parcela", () => {
    // R$ 16,46 é o ICMS destacado da 178110. A fatura marca 01/02, mas quem
    // explica o caso é a linha apontada — não a conta de parcelas.
    const v = conferir(parc1(16.46), { ...nf178110, cobranca_explicada: "item", item_rotulo: "VALOR DO ICMS" });
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("imposto");
  });

  it("fornecedor que não se confirma derruba a parcela", () => {
    const v = conferir(parc1(125.66), { ...nf178110, fornecedor_confere: "incerto" });
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("fornecedor não se confirma");
    // O que já casou fica registrado: a tela mostra a parcela conferida.
    expect(v.como).toBe("parcela");
    expect(v.valor_casado).toBe(125.66);
  });

  it("nota velha demais derruba a parcela", () => {
    const v = conferir(
      gasto(125.66, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30", { memo: MEMO_AVIAMENTO }),
      { ...nf178110, data_documento: "2025-11-01" },
    );
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("2025-11-01");
  });

  it("print de tela não vira parcela", () => {
    const v = conferir(parc1(125.66), { ...nf178110, legivel: false });
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("não é um comprovante");
  });
});

describe("o carnê — a nota da 1ª parcela resolve a fatura seguinte", () => {
  const carne = carneDe(parc1(125.66), nf178110)!;
  /** A 2ª parcela como ela chega na fatura de setembro. */
  const setembro = (valor: number, memo = "CENTRAL DE AVIAMENTO  02/02   VITORIA", comp = "2026-09-01") =>
    gasto(valor, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30", { memo, competencia: comp });

  it("abre o carnê a partir da parcela conferida", () => {
    expect(carne).not.toBeNull();
    expect(carne.parcela).toEqual({ n: 1, de: 2 });
    expect(carne.base).toBe(251.31);
    expect(carne.competencia).toBe("2026-08-01");
    expect(chaveDoParcelamento(MEMO_AVIAMENTO, 2)).toBe("CENTRAL DE AVIAMENTO VITORIA|2");
    // O marcador é o único pedaço que muda entre uma fatura e a seguinte.
    expect(chaveDoParcelamento("CENTRAL DE AVIAMENTO  02/02   VITORIA", 2)).toBe(carne.chave);
  });

  it("reconhece a 2ª parcela na fatura seguinte, com o centavo a menos", () => {
    expect(outraParcelaDoCarne(carne, setembro(125.65))).toEqual({ n: 2, de: 2 });
  });

  it("não pega a compra NOVA do mesmo lojista pelo mesmo valor", () => {
    // Outubro, não setembro: a 2ª parcela vem UMA fatura depois da 1ª.
    expect(outraParcelaDoCarne(carne, setembro(125.65, "CENTRAL DE AVIAMENTO  02/02   VITORIA", "2026-10-01"))).toBeNull();
    // Mesmo lojista, mesma fatura, outro marcador de compra à vista.
    expect(outraParcelaDoCarne(carne, setembro(125.65, "CENTRAL DE AVIAMENTO   VITORIA"))).toBeNull();
    // Uma compra nova, também em 2×, mas de outro valor.
    expect(outraParcelaDoCarne(carne, setembro(80))).toBeNull();
    // A própria 1ª parcela não se resolve sozinha.
    expect(outraParcelaDoCarne(carne, setembro(125.66, MEMO_AVIAMENTO, "2026-08-01"))).toBeNull();
  });

  it("não confunde os dois carnês do mesmo lojista e da mesma fatura", () => {
    const outro = carneDe(parc1(39.13), nf178121)!;
    expect(outro.chave).toBe(carne.chave);            // mesmo lojista, mesmo 01/02
    expect(outraParcelaDoCarne(outro, setembro(125.65))).toBeNull();  // o valor separa
    expect(outraParcelaDoCarne(outro, setembro(39.12))).toEqual({ n: 2, de: 2 });
  });

  it("sem memo ou sem competência não há carnê", () => {
    expect(carneDe(gasto(125.66, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30"), nf178110)).toBeNull();
    expect(carneDe(parc1(125.66, MEMO_AVIAMENTO, ""), nf178110)).toBeNull();
    // Conferência que não casou por parcela não abre carnê nenhum.
    expect(carneDe(parc1(251.31), { ...nf178110, cobranca_explicada: "total" })).toBeNull();
  });

  it("uma compra em 12× resolve as onze faturas seguintes, uma por mês", () => {
    const memo = (n: number) => `MP*MERCADOLIVREV      ${String(n).padStart(2, "0")}/12   SAO PAULO`;
    const doze = carneDe(
      gasto(99.92, "MERCADOLIVREV SAO PAULO", "2026-07-13", { memo: memo(1), competencia: "2026-08-01" }),
      ler({ emitente_nome: "MERCADO LIVRE", valor_total: 1199.04, valores: [{ rotulo: "Total", valor: 1199.04 }], data_documento: "2026-07-13", cobranca_explicada: "nao" }),
    )!;
    expect(doze.parcela.de).toBe(12);
    expect(outraParcelaDoCarne(doze, gasto(99.92, "x", "2026-07-13", { memo: memo(2), competencia: "2026-09-01" }))).toEqual({ n: 2, de: 12 });
    expect(outraParcelaDoCarne(doze, gasto(99.92, "x", "2026-07-13", { memo: memo(12), competencia: "2027-07-01" }))).toEqual({ n: 12, de: 12 });
    // A 12ª parcela na fatura errada não passa.
    expect(outraParcelaDoCarne(doze, gasto(99.92, "x", "2026-07-13", { memo: memo(12), competencia: "2027-06-01" }))).toBeNull();
  });
});

describe("manda revisar quando o valor não fecha", () => {
  it("GOL LINHAS A*WOOSV · R$ 109,38 não está em lugar nenhum do recibo", () => {
    const v = conferir(
      gasto(109.38, "GOL LINHAS A*WOOSV SAO PAULO", "2026-07-31"),
      ler({
        emitente_nome: "GOL LINHAS AEREAS",
        valor_total: 382.1,
        valores: [
          { rotulo: "Tarifa", valor: 328.14 },
          { rotulo: "Tarifas / taxas / encargos", valor: 53.96 },
          { rotulo: "Tarifa total", valor: 382.1 },
        ],
        data_documento: "2026-07-31",
        cobranca_explicada: "nao",
      }),
    );
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("R$ 109,38");
    expect(v.motivo).toContain("R$ 382,10");
  });

  it("MERCADOLIVRE · cobrança de R$ 34,18 com nota de R$ 205,10", () => {
    const v = conferir(
      gasto(34.18, "MERCADOLIVREV SO PAULO", "2026-07-23"),
      ler({
        emitente_nome: "Loja da Ceci",
        valor_total: 205.1,
        valores: [{ rotulo: "Valor Total da Nota", valor: 205.1 }],
        data_documento: "2026-07-23",
        cobranca_explicada: "nao",
      }),
    );
    expect(v.veredito).toBe("revisar");
  });

  it("CENTRAL DE AVIAMENTOS · metade da nota SEM nada dizer que foi parcelado", () => {
    /* 39,13 × 2 = 78,26 e a nota é 78,25. A conta fecha, mas conta não é prova:
       sem o marcador na fatura e sem parcela no documento, isto continua com a
       pessoa — o que muda é que a frase agora diz o que foi visto. */
    const v = conferir(
      gasto(39.13, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30"),
      ler({
        emitente_nome: "CENTRAL DE AVIAMENTOS LTDA",
        valor_total: 78.25,
        valores: [
          { rotulo: "Valor Total dos Produtos", valor: 84.14 },
          { rotulo: "Desconto", valor: 5.89 },
          { rotulo: "Valor Total da Nota", valor: 78.25 },
        ],
        data_documento: "2026-07-30",
        cobranca_explicada: "nao",
      }),
    );
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("1/2");
    expect(v.motivo).toContain("nem a fatura nem o documento");
  });

  it("a IA afirma que o total bate, mas o total não bate — a conta é refeita aqui", () => {
    const v = conferir(
      gasto(403.09, "LATAM AIR*EMFHFKV SAO PAULO", "2026-07-01"),
      ler({
        emitente_nome: "TAM Linhas Aéreas S.A.",
        valor_total: 1612.34,
        valores: [{ rotulo: "Total pago", valor: 1612.34 }],
        data_documento: "2026-07-01",
        cobranca_explicada: "total", // ponteiro errado de propósito
      }),
    );
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("R$ 1.612,34");
  });

  it("a IA aponta uma linha que o documento não tem", () => {
    const v = conferir(
      gasto(119.61, "LATAM AIR*ASTWZSV SAO PAULO", "2026-07-31"),
      ler({
        emitente_nome: "TAM Linhas Aéreas S.A.",
        valor_total: 478.42,
        valores: [
          { rotulo: "Voo", valor: 424.33 },
          { rotulo: "Taxas e/ou impostos(1)", valor: 54.09 },
        ],
        data_documento: "2026-07-31",
        cobranca_explicada: "item",
        item_rotulo: "Taxa de embarque",
      }),
    );
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("R$ 119,61");
  });
});

describe("linha de imposto e desconto não é o que se paga", () => {
  it("cobrança igual ao ICMS destacado da nota não passa", () => {
    // A NF-e 429 da Central de Aviamentos tem onze valores; um deles é o ICMS.
    const v = conferir(
      gasto(16.46, "CENTRAL DE AVIAMENTO VITORIA", "2026-07-30"),
      ler({
        emitente_nome: "CENTRAL DE AVIAMENTOS LTDA",
        valor_total: 251.31,
        valores: [
          { rotulo: "Base de cálculo do ICMS", valor: 96.87 },
          { rotulo: "Valor do ICMS", valor: 16.46 },
          { rotulo: "Valor total dos produtos", valor: 253.03 },
          { rotulo: "Desconto", valor: 17.72 },
          { rotulo: "Valor total da nota", valor: 251.31 },
        ],
        data_documento: "2026-07-30",
        cobranca_explicada: "item",
        item_rotulo: "Valor do ICMS",
      }),
    );
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("imposto");
  });

  it("mas 'Taxas e/ou impostos' do bilhete aéreo É pagável", () => {
    expect(rotuloNaoPagavel("Taxas e/ou impostos(1)")).toBe(false);
    expect(rotuloNaoPagavel("Taxa de Embarque")).toBe(false);
    expect(rotuloNaoPagavel("Tarifas / taxas / encargos")).toBe(false);
    expect(rotuloNaoPagavel("Valor do Frete")).toBe(false);
    expect(rotuloNaoPagavel("Gorjeta")).toBe(false);
  });

  it("linha contábil é reconhecida pelo rótulo", () => {
    expect(rotuloNaoPagavel("Valor do ICMS")).toBe(true);
    expect(rotuloNaoPagavel("Base de Cálculo do ICMS")).toBe(true);
    expect(rotuloNaoPagavel("Trib. aprox. Federal")).toBe(true);
    expect(rotuloNaoPagavel("Desconto")).toBe(true);
    expect(rotuloNaoPagavel("Valor do IPI")).toBe(true);
    expect(rotuloNaoPagavel("")).toBe(true);
  });
});

describe("o que não é comprovante nunca é aprovado", () => {
  it("GOOGLE WhatsA · veio um print do Meta Business Manager", () => {
    const v = conferir(
      gasto(55, "GOOGLE WhatsA SAO PAULO", "2026-07-04"),
      ler({
        legivel: false,
        tipo_documento: "N/A",
        emitente_nome: "",
        valor_total: 0,
        valores: [],
        data_documento: "",
        descricao: "captura de tela do Meta Business Manager",
        observacao: "não é nota fiscal, fatura, recibo ou comprovante",
        cobranca_explicada: "nao",
      }),
    );
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("não é um comprovante");
  });

  it("documento legível mas sem emitente identificável", () => {
    const v = conferir(gasto(100, "QUALQUER COISA"), ler({ emitente_nome: "  " }));
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("quem emitiu");
  });
});

describe("o fornecedor precisa se confirmar", () => {
  it("AlessandroGomesDa · o valor bate, o emitente é outro nome", () => {
    const v = conferir(
      gasto(275, "AlessandroGomesDa MACEIO", "2026-07-29"),
      ler({
        tipo_documento: "Comprovante de Pedido",
        emitente_nome: "Rôof",
        emitente_cnpj: "053.799.144-11",
        valor_total: 275,
        valores: [{ rotulo: "Total", valor: 275 }],
        data_documento: "2026-07-29",
        fornecedor_confere: "incerto",
        fornecedor_motivo: "o pedido não nomeia o vendedor do memo",
      }),
    );
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("fornecedor não se confirma");
    // O valor casado é preservado: a tela mostra o que já foi conferido.
    expect(v.valor_casado).toBe(275);
    expect(v.como).toBe("total");
  });

  it("fornecedor negado derruba mesmo com o total idêntico", () => {
    const v = conferir(gasto(100, "PADARIA X"), ler({ fornecedor_confere: "nao" }));
    expect(v.veredito).toBe("revisar");
  });
});

describe("a data do documento tem de caber no gasto", () => {
  it("nota emitida meio ano antes do gasto sai do automático", () => {
    const v = conferir(gasto(100, "FORNECEDOR", "2026-07-15"), ler({ data_documento: "2025-12-01" }));
    expect(v.veredito).toBe("revisar");
    expect(v.motivo).toContain("2025-12-01");
  });
  it("nota emitida depois do gasto sai do automático", () => {
    const v = conferir(gasto(100, "FORNECEDOR", "2026-07-15"), ler({ data_documento: "2026-08-20" }));
    expect(v.veredito).toBe("revisar");
  });
  it("dentro da janela, passa", () => {
    expect(conferir(gasto(100, "F", "2026-07-15"), ler({ data_documento: "2026-07-14" })).veredito).toBe("aprovar");
    expect(conferir(gasto(100, "F", "2026-07-15"), ler({ data_documento: "2026-05-30" })).veredito).toBe("aprovar");
  });
  it("documento sem data não é motivo para reprovar", () => {
    expect(conferir(gasto(100, "F"), ler({ data_documento: null })).veredito).toBe("aprovar");
    expect(conferir(gasto(100, "F"), ler({ data_documento: "" })).veredito).toBe("aprovar");
  });
});

describe("lançamento sem valor", () => {
  it("não há o que conferir", () => {
    expect(conferir(gasto(0, "F"), ler({})).veredito).toBe("revisar");
    expect(conferir({ titulo: "F", valor: NaN, data: "2026-07-15" }, ler({})).veredito).toBe("revisar");
  });
});

describe("chaveDocumento — a mesma nota usada duas vezes", () => {
  it("monta a chave com CNPJ, número e total", () => {
    expect(chaveDocumento(ler({ emitente_cnpj: "37.334.447/0001-07", numero_documento: "1234", valor_total: 695 })))
      .toBe("37334447000107|1234|69500");
  });
  it("sem CNPJ, cai no nome do emitente", () => {
    expect(chaveDocumento(ler({ emitente_cnpj: "", emitente_nome: "Hostinger International Ltd.", numero_documento: "H-47701905", valor_total: 329.99 })))
      .toBe("HOSTINGER INTERNATIONAL LTD|H 47701905|32999");
  });
  it("sem número de documento não dá para afirmar nada", () => {
    expect(chaveDocumento(ler({ numero_documento: "" }))).toBeNull();
    expect(chaveDocumento(ler({ numero_documento: null }))).toBeNull();
  });
  it("os quatro recibos de R$ 53,96 da GOL são documentos distintos", () => {
    const a = chaveDocumento(ler({ emitente_cnpj: "07.575.651/0001-59", numero_documento: "ANDRE-1", valor_total: 674.1 }));
    const b = chaveDocumento(ler({ emitente_cnpj: "07.575.651/0001-59", numero_documento: "MIGUEL-1", valor_total: 674.1 }));
    expect(a).not.toBe(b);
  });
});
