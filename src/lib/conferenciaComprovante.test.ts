import { describe, it, expect } from "vitest";
import {
  conferir, centavos, rotuloNaoPagavel, chaveDocumento,
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
const gasto = (valor: number, titulo: string, data = "2026-07-15"): Lancamento => ({ titulo, valor, data });

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

  it("CENTRAL DE AVIAMENTOS · cobrança é quase a metade da nota, e quase não basta", () => {
    // 39,13 × 2 = 78,26 e a nota é 78,25. Parcelamento provável, casamento nenhum.
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
