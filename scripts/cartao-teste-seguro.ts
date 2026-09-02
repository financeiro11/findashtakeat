/**
 * Fatura sintética SEGURA para exercitar a tela sem consequência nenhuma.
 *
 * Difere da `scripts/TESTE_HUB.ofx` em duas coisas, e as duas são de propósito:
 *
 *  1. COMPETÊNCIA ago/26 — ANTES do marco (`MARCO_FORA_DO_HUB = 2026-08-01`).
 *     O botão de enviar nasce desabilitado, e por duas travas independentes: o
 *     marco e a linha de `cartao_faturas` que marca ago/26 como `fora_do_hub`.
 *     A de dez/26 está depois do marco e tem o envio LIBERADO — ótima para o
 *     teste ponta a ponta, perigosa para clicar sem querer.
 *
 *  2. NOMES QUE NÃO EXISTEM. A outra usa MERCADOLIVRE, ANTHROPIC, UBER, AIRBNB —
 *     lojistas REAIS, que estão no `cartao_omie_map`. Escolher categoria neles
 *     durante um teste gravaria `origem='manual'` por cima da entrada de
 *     verdade, e manual nunca mais é sobrescrito pelo aprendizado do histórico.
 *     Aqui todo lojista começa com "ZZTESTE", que não casa com nada.
 */

import fs from "node:fs";

const FECHAMENTO = "20260731";   // fatura de ago/26 → antes do marco
const CONTA = "3485";

/** 22 colunas de nome, parcela em 22..26, cauda a partir da 30. */
const memo = (nome: string, parcela: string | null, cauda: string): string =>
  nome.slice(0, 22).padEnd(22) + (parcela ?? "     ") + "   " + cauda;

const solto = (t: string) => t;

type Linha = {
  fitid: string; data: string; valor: number; credito?: boolean;
  memo: string; caso: string;
};

const LINHAS: Linha[] = [
  {
    fitid: "TESTEHUB9001", data: "20260703", valor: 11.11,
    memo: memo("ZZTESTE LOJA UM", null, "VITORIA"),
    caso: "à vista simples",
  },
  {
    fitid: "TESTEHUB9002", data: "20260705", valor: 6.66,
    memo: memo("EC *ZZTESTE LOJA UM", null, "SERRA"),
    caso: "o MESMO lojista com outra grafia → mesma chave, título separado",
  },
  {
    fitid: "TESTEHUB9003", data: "20260708", valor: 22.22,
    memo: memo("ZZTESTE PARCELADO SA", "01/03", "VILA VELHA"),
    caso: "1ª de 3 → vira 3 títulos, um por mês",
  },
  {
    fitid: "TESTEHUB9004", data: "20260212", valor: 33.33,
    memo: memo("ZZTESTE COMPRA VELHA", "05/12", "SERRA"),
    caso: "parcela 5/12, datada da compra original → IGNORADA, já provisionada",
  },
  {
    fitid: "TESTEHUB9005", data: "20260710", valor: 44.44,
    memo: memo("ZZTESTE EXTERIORV", null, "ZZTESTE.COM - US$ 8,00    U$ 8,00    V.DOL 5,5550"),
    caso: "internacional · a cauda traz domínio, dólar e cotação · o 'V' do emissor cai",
  },
  {
    fitid: "TESTEHUB9006", data: "20260712", valor: 7.77,
    memo: memo("MP*ZZTESTE ADQUIRENT", null, "SAO PAULO"),
    caso: "adquirente antes do '*' → o lojista é o que vem depois",
  },
  {
    fitid: "TESTEHUB9007", data: "20260714", valor: 5.55,
    memo: solto("ZZTESTE TARIFA CURTA"),
    caso: "MEMO curto, sem colunas — o texto inteiro é o nome",
  },
  {
    fitid: "TESTEHUB9008", data: "20260716", valor: 13.13,
    memo: memo("ZZTESTE ACENTO AÇAÍ", null, "VITÓRIA"),
    caso: "acento · o arquivo é windows-1252, não UTF-8",
  },
  {
    fitid: "TESTEHUB9009", data: "20260718", valor: 9.99, credito: true,
    memo: solto("ESTORNO DE COMPRA ZZTESTE"),
    caso: "crédito/estorno → abate a fatura, não vira título",
  },
  {
    fitid: "TESTEHUB9010", data: "20260720", valor: 500.00, credito: true,
    memo: solto("PAGAMENTO-BOLETO BANCARIO"),
    caso: "pagamento da fatura anterior → não é despesa",
  },
];

const dt = (d: string) => `${d}120000[-3:BRT]`;

const transacoes = LINHAS.map((l) => [
  "<STMTTRN>",
  `<TRNTYPE>${l.credito ? "CREDIT" : "DEBIT"}`,
  `<DTPOSTED>${dt(l.data)}`,
  `<TRNAMT>${(l.credito ? l.valor : -l.valor).toFixed(2)}`,
  `<FITID>${l.fitid}`,
  `<MEMO>${l.memo}`,
  "</STMTTRN>",
].join("\n")).join("\n");

const saldo = LINHAS.reduce((a, l) => a + (l.credito ? l.valor : -l.valor), 0);

const ofx = [
  "OFXHEADER:100", "DATA:OFXSGML", "VERSION:102", "SECURITY:NONE",
  "ENCODING:USASCII", "CHARSET:1252", "COMPRESSION:NONE",
  "OLDFILEUID:NONE", "NEWFILEUID:NONE", "",
  "<OFX>",
  "<SIGNONMSGSRSV1><SONRS>",
  "<STATUS><CODE>0<SEVERITY>INFO</STATUS>",
  `<DTSERVER>${dt(FECHAMENTO)}`,
  "<LANGUAGE>POR",
  "</SONRS></SIGNONMSGSRSV1>",
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS>",
  "<TRNUID>1",
  "<STATUS><CODE>0<SEVERITY>INFO</STATUS>",
  "<CCSTMTRS>",
  "<CURDEF>BRL",
  `<CCACCTFROM><ACCTID>${CONTA}</CCACCTFROM>`,
  "<BANKTRANLIST>",
  `<DTSTART>${dt("20260701")}`,
  `<DTEND>${dt(FECHAMENTO)}`,
  transacoes,
  "</BANKTRANLIST>",
  "<LEDGERBAL>",
  `<BALAMT>${saldo.toFixed(2)}`,
  `<DTASOF>${dt(FECHAMENTO)}`,
  "</LEDGERBAL>",
  "</CCSTMTRS>",
  "</CCSTMTTRNRS></CREDITCARDMSGSRSV1>",
  "</OFX>", "",
].join("\n");

const destino = process.argv[2];
fs.writeFileSync(destino, Buffer.from(ofx, "latin1"));
console.log(`${destino}: ${LINHAS.length} lançamentos, fechamento ${FECHAMENTO}`);
for (const l of LINHAS) console.log(`  ${l.fitid}  ${l.caso}`);
