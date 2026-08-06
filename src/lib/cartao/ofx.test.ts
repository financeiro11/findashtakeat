import { describe, expect, it } from "vitest";
import { chaveDe, lerMemo, numeroBR, parseOfx, rotuloMes, somarMeses } from "./ofx";

/* Todas as MEMO abaixo são linhas REAIS das faturas de dez/25 a ago/26, com o
   espaçamento original — é ele que carrega a informação. */

describe("lerMemo — o corte por coluna", () => {
  it("separa nome, parcela e cidade", () => {
    const m = lerMemo("MP*MERCADOLIVREV      07/12   ITU");
    expect(m.estabelecimento).toBe("MP*MERCADOLIVRE");
    expect(m.parcela).toEqual({ n: 7, de: 12 });
    expect(m.cidade).toBe("ITU");
  });

  it("aceita a coluna da parcela em branco", () => {
    const m = lerMemo("LATAM AIR*0000V               SAO PAULO");
    expect(m.parcela).toBeNull();
    expect(m.estabelecimento).toBe("LATAM AIR*0000");
    expect(m.cidade).toBe("SAO PAULO");
  });

  it("lê a cauda de câmbio das compras internacionais", () => {
    const m = lerMemo("ANTHROPIC* CLAUDE SU          ANTHROPIC.COM - R$ 550,00    U$ 109,35    V.DOL 5,0297");
    expect(m.cidade).toBeNull();
    expect(m.exterior).toEqual({
      dominio: "ANTHROPIC.COM",
      originalTexto: "R$ 550,00",
      valorUsd: 109.35,
      cotacao: 5.0297,
    });
  });

  it("acha a parcela da anuidade, que sai da coluna", () => {
    // Único caso fora do gabarito — aparece uma vez por fatura, nas nove.
    const m = lerMemo("ANUIDADE VISA C      (3485) 07/12");
    expect(m.parcela).toEqual({ n: 7, de: 12 });
    expect(m.estabelecimento).toBe("ANUIDADE VISA C");   // sem o final do cartão
  });

  it("não inventa colunas em descrição curta do emissor", () => {
    // 25 caracteres: passa da coluna da parcela mas não chega na da cidade.
    // Cortar em 22 aqui devolveria "PAGAMENTO-BOLETO BANCA".
    expect(lerMemo("PAGAMENTO-BOLETO BANCARIO").estabelecimento).toBe("PAGAMENTO-BOLETO BANCARIO");
    expect(lerMemo("IOF OPERACAO EXTERIOR").estabelecimento).toBe("IOF OPERACAO EXTERIOR");
  });

  it("mantém o nome truncado em 22 colunas sem separador", () => {
    const m = lerMemo("MERCADOLIVRE*MERCADO  04/12   SAO PAULO");
    expect(m.estabelecimento).toBe("MERCADOLIVRE*MERCADO");
    expect(m.parcela).toEqual({ n: 4, de: 12 });
  });
});

describe("chaveDe — funde as variantes do mesmo lojista", () => {
  it("tira o 'V' que o emissor carimba no fim", () => {
    // "ANTHROPICV" e "ANTHROPIC" convivem na MESMA fatura.
    expect(chaveDe("ANTHROPICV")).toBe("ANTHROPIC");
    expect(chaveDe("ANTHROPIC")).toBe("ANTHROPIC");
    expect(chaveDe("AMERICANAS SAV")).toBe("AMERICANAS SA");
  });

  it("escolhe o lado certo do asterisco", () => {
    // MP é adquirente: o lojista está depois.
    expect(chaveDe("MP*MERCADOLIVREV")).toBe("MERCADOLIVRE");
    expect(chaveDe("EC *MERCADOLIVREV")).toBe("MERCADOLIVRE");
    expect(chaveDe("MERCADOLIVRE*MERCADO")).toBe("MERCADOLIVRE");
    // AIRBNB não é: o lojista está antes, e o resto é código da reserva.
    expect(chaveDe("AIRBNB * HMKWDSPV")).toBe("AIRBNB");
    expect(chaveDe("AIRBNB * HMPEFDSV")).toBe("AIRBNB");
    expect(chaveDe("LATAM AIR*GDXFZFV")).toBe("LATAM AIR");
  });

  it("desfaz adquirente em cascata", () => {
    expect(chaveDe("DL     *UBER*RIDESV")).toBe("UBER");
    expect(chaveDe("UBER * PENDING")).toBe("UBER");
    expect(chaveDe("UBER* TRIPV")).toBe("UBER");
  });

  it("corta o código do pedido, grudado ou solto", () => {
    expect(chaveDe("American Air00150106")).toBe("AMERICAN AIR");
    expect(chaveDe("Google CLOUD VXBS4CV")).toBe("GOOGLE CLOUD");
    expect(chaveDe("DL *GOOGLE ADS786089")).toBe("GOOGLE ADS");
  });

  it("NÃO funde produtos diferentes do mesmo fornecedor", () => {
    // O erro caro: Ads é mídia, Cloud é infraestrutura, Workspace é software.
    // Se os três virassem "GOOGLE", cairiam todos na mesma rubrica da DRE.
    const chaves = new Set([
      chaveDe("DL *GOOGLE ADS786089"),
      chaveDe("Google CLOUD VXBS4CV"),
      chaveDe("DL *GOOGLE Workspace"),
    ]);
    expect(chaves.size).toBe(3);
  });

  it("não corta quando não sobraria nome", () => {
    expect(chaveDe("99*V")).toBe("99");
  });
});

describe("parseOfx", () => {
  const ofx = `
<CCACCTFROM><ACCTID>7563010741924</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>PAYMENT</TRNTYPE>
<DTPOSTED>20260612120000[-3:BRT]</DTPOSTED>
<TRNAMT>-218.03</TRNAMT>
<FITID>202606122180301</FITID>
<MEMO>LATAM AIR*EENRZOV     01/04   SAO PAULO</MEMO>
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260611120000[-3:BRT]</DTPOSTED>
<TRNAMT>8980.90</TRNAMT>
<FITID>202606118980901</FITID>
<MEMO>PAGAMENTO-BOLETO BANCARIO</MEMO>
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-334427.93</BALAMT>
<DTASOF>20260630120000[-3:BRT]</DTASOF>
</LEDGERBAL>`;

  const f = parseOfx(ofx);

  it("a fatura é o mês SEGUINTE ao fechamento", () => {
    // O ciclo que fecha em 30/06 é a fatura de julho — mesma convenção da
    // tabela cartao_faturas e do nome do arquivo que o financeiro recebe.
    expect(f.fechamento).toBe("2026-06-30");
    expect(f.competencia).toBe("2026-07-01");
    expect(f.mesLabel).toBe("jul/26");
    expect(f.conta).toBe("7563010741924");
    expect(f.competenciaConfiavel).toBe(true);
  });

  it("desconfia do mês quando o fechamento não é fim de mês", () => {
    // Os arquivos exportados antes de abr/26 trazem no DTASOF a data de GERAÇÃO
    // (10/01, 08/03) — a fatura de dezembro e a de janeiro sairiam no mesmo mês.
    const gerado = parseOfx(ofx.replace("20260630120000", "20260110120000"));
    expect(gerado.competencia).toBe("2026-02-01");
    expect(gerado.competenciaConfiavel).toBe(false);
  });

  it("guarda o valor sempre positivo e o sinal à parte", () => {
    expect(f.linhas[0]).toMatchObject({ valor: 218.03, sinal: "debito" });
    expect(f.linhas[1]).toMatchObject({ valor: 8980.9, sinal: "credito" });
  });

  it("preserva a data ORIGINAL da compra e o MEMO cru", () => {
    expect(f.linhas[0].data).toBe("2026-06-12");
    expect(f.linhas[0].memo).toContain("01/04");
    expect(f.linhas[0].parcela).toEqual({ n: 1, de: 4 });
  });

  it("marca tarifa do cartão", () => {
    expect(f.linhas[0].tarifa).toBe(false);
    expect(parseOfx(ofx.replace("LATAM AIR*EENRZOV     01/04   SAO PAULO", "IOF OPERACAO EXTERIOR"))
      .linhas[0].tarifa).toBe(true);
  });
});

describe("utilitários de data e número", () => {
  it("soma meses sem passar por Date", () => {
    expect(somarMeses("2026-07-01", 0)).toBe("2026-07-01");
    expect(somarMeses("2026-07-01", 5)).toBe("2026-12-01");
    expect(somarMeses("2026-07-01", 6)).toBe("2027-01-01");
    expect(somarMeses("2026-07-01", 17)).toBe("2027-12-01");
  });

  it("lê número no formato brasileiro", () => {
    expect(numeroBR("2.600,41")).toBe(2600.41);
    expect(numeroBR("5,0297")).toBe(5.0297);
    expect(numeroBR("109,35")).toBe(109.35);
  });

  it("rotula o mês", () => {
    expect(rotuloMes("2026-07-01")).toBe("jul/26");
    expect(rotuloMes("2026-01-01")).toBe("jan/26");
  });
});
