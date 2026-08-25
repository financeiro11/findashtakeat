/**
 * A fatura sintética do cartão — gerar, conferir, enviar ao Omie e apagar.
 *
 *   npm run cartao:teste -- gerar     # escreve scripts/TESTE_HUB.ofx
 *   npm run cartao:teste -- previa    # o que iria ao Omie, sem tocar no ERP
 *   npm run cartao:teste -- enviar    # cria os títulos de verdade
 *   npm run cartao:teste -- limpar    # apaga do Omie tudo que este teste criou
 *
 * PARA QUE ISTO EXISTE
 * O caminho de escrita do cartão foi construído contra as 9 faturas reais, mas
 * nenhuma delas pode ser enviada: as até ago/26 foram lançadas à mão e o banco
 * as trava. Testar contra a fatura de verdade seria testar em produção com um
 * mês de despesa em jogo. Então a fatura de teste é feita à mão, pequena, e
 * cobre UM exemplo de cada caso que uma fatura do Sicoob sabe produzir — a
 * tabela `LINHAS` abaixo é a lista desses casos, e é ela que se lê para saber o
 * que está sendo exercitado.
 *
 * RASTRO
 * Todo FITID começa com `TESTEHUB`. Isso atravessa o parser, vira
 * `CARTAO-TESTEHUB…` no `codigo_lancamento_integracao`, faz `montarTitulo`
 * carimbar "[TESTE HUB]" na observação e "TESTE-HUB" no número do documento, e
 * é por esse prefixo que `limpar` acha o que apagar. Nada disso depende de
 * alguém lembrar de marcar uma caixinha.
 *
 * DATAS
 * Ciclo fechando em 30/11/2026 → fatura de dez/26, compras em novembro. Longe
 * do fechamento em curso e depois do marco de ago/26, que é o que o banco
 * exige. Valores todos abaixo de R$ 100 e com centavos repetidos (11,11 · 22,22)
 * para não se confundirem com despesa de verdade em lista nenhuma.
 */

import fs from "node:fs";
import path from "node:path";
import { parseOfx, rotuloMes } from "@/lib/cartao/ofx";
import { agrupar, expandir, separar } from "@/lib/cartao/provisionar";
import { montarTitulo, titulosDaFatura } from "@/lib/cartao/envio";

/* ------------------------------------------------------------------
 * A fatura
 * ------------------------------------------------------------------ */

const ARQUIVO = path.join(import.meta.dirname ?? __dirname, "TESTE_HUB.ofx");

const FECHAMENTO = "20261130";
const CONTA = "3485";
/** Vencimento da fatura de dez/26. O OFX não o traz — na tela ele é digitado. */
const VENCIMENTO = "2026-12-10";
const COMPETENCIA = "2026-12-01";

/**
 * O MEMO do Sicoob é um relatório de LARGURA FIXA (ver `src/lib/cartao/ofx.ts`):
 * 22 colunas de nome, a parcela `NN/MM` na coluna 23, a cidade ou a cauda
 * internacional a partir da coluna 31. Montar isso à mão erra por um espaço e o
 * teste passaria a testar o erro — por isso o arquivo é gerado, não escrito.
 */
const memo = (nome: string, parcela: string | null, cauda: string): string =>
  nome.slice(0, 22).padEnd(22) + (parcela ?? "     ") + "   " + cauda;

/** MEMO sem gabarito nenhum: descrição curta do próprio emissor. */
const solto = (texto: string) => texto;

type Linha = {
  fitid: string;
  data: string;                 // 'YYYYMMDD'
  valor: number;                // sempre positivo
  credito?: boolean;
  memo: string;
  /** O caso que esta linha existe para exercitar. Sai no `previa`. */
  caso: string;
};

const LINHAS: Linha[] = [
  {
    fitid: "TESTEHUB0001", data: "20261103", valor: 11.11,
    memo: memo("MP*MERCADOLIVREV", null, "VITORIA"),
    caso: "à vista · adquirente ANTES do '*' (MP) e o 'V' do emissor no fim → chave MERCADOLIVRE",
  },
  {
    fitid: "TESTEHUB0002", data: "20261105", valor: 22.22,
    memo: memo("NET MICRO INFORMATIC", "01/03", "VILA VELHA"),
    caso: "1ª de 3 → vira 3 títulos, um por mês · cidade com espaço no meio",
  },
  {
    fitid: "TESTEHUB0003", data: "20260714", valor: 33.33,
    memo: memo("LOJA DAS FERRAMENTAS", "05/12", "SERRA"),
    caso: "parcela 5 de 12, datada da compra original (julho) → IGNORADA, já foi provisionada",
  },
  {
    fitid: "TESTEHUB0004", data: "20261107", valor: 44.44,
    memo: memo("ANTHROPICV", null, "ANTHROPIC.COM - US$ 8,00    U$ 8,00    V.DOL 5,5550"),
    caso: "compra internacional · a cauda traz domínio, valor em dólar e cotação",
  },
  {
    fitid: "TESTEHUB0005", data: "20261107", valor: 5.55,
    memo: solto("IOF OPERACAO EXTERIOR"),
    caso: "tarifa do cartão · MEMO curto, sem colunas — o texto inteiro é o nome",
  },
  {
    fitid: "TESTEHUB0006", data: "20260520", valor: 66.66,
    memo: "ANUIDADE VISA C      (3485) 07/12",
    caso: "anuidade · a única linha com a parcela FORA da coluna, atrás do final do cartão",
  },
  {
    fitid: "TESTEHUB0007", data: "20261110", valor: 14.00, credito: true,
    memo: solto("DESC ANUIDADE POR USO"),
    caso: "crédito · abate a fatura e não vira título",
  },
  {
    fitid: "TESTEHUB0008", data: "20261110", valor: 999.99, credito: true,
    memo: solto("PAGAMENTO-BOLETO BANCARIO"),
    caso: "pagamento da fatura anterior · não é despesa",
  },
  {
    fitid: "TESTEHUB0009", data: "20261111", valor: 7.77,
    memo: memo("DL *UBER*RIDES", null, "SAO PAULO"),
    caso: "adquirente em cascata (DL e depois UBER*) → chave UBER",
  },
  {
    fitid: "TESTEHUB0010", data: "20261112", valor: 88.88,
    memo: memo("AIRBNB * HMKWDSP", null, "SAO PAULO"),
    caso: "lojista DEPOIS do '*' é código de reserva → o nome é o que vem antes",
  },
  {
    fitid: "TESTEHUB0011", data: "20261113", valor: 9.99,
    memo: memo("Google CLOUD VXBS4C", null, "INTERNET"),
    caso: "código opaco de pedido no fim do nome → cortado, sem virar fornecedor novo",
  },
  {
    fitid: "TESTEHUB0012", data: "20261117", valor: 12.34,
    memo: memo("American Air00150106", "01/04", "MIAMI"),
    caso: "dígitos grudados no nome · 1ª de 4, e a série atravessa a virada do ano",
  },
  {
    fitid: "TESTEHUB0013", data: "20261119", valor: 21.21,
    memo: memo("MERCEARIA DO SEU JOAOZ", "01/02", "VITORIA"),
    caso: "nome truncado em exatos 22 caracteres — sem separador antes da parcela",
  },
  {
    fitid: "TESTEHUB0014", data: "20261121", valor: 13.13,
    memo: memo("RESTAURANTE AÇAÍ", null, "VITÓRIA"),
    caso: "acento · o arquivo é windows-1252, não UTF-8",
  },
  {
    fitid: "TESTEHUB0015", data: "20261124", valor: 11.11, credito: true,
    memo: solto("ESTORNO DE COMPRA"),
    caso: "estorno · crédito que não é pagamento de fatura",
  },
  {
    fitid: "TESTEHUB0016", data: "20261126", valor: 6.66,
    memo: memo("MERCADOLIVRE*MERCADO", null, "VITORIA"),
    caso: "o MESMO lojista da linha 1 escrito de outro jeito → mesma chave, título separado",
  },
];

/* ------------------------------------------------------------------
 * Gerar
 * ------------------------------------------------------------------ */

function gerar(): string {
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

  return [
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
    `<DTSTART>${dt("20261101")}`,
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
}

/* ------------------------------------------------------------------
 * Ler o que foi gerado, do mesmo jeito que a tela lê
 * ------------------------------------------------------------------ */

/** A categoria de teste: a mesma que os títulos de cartão já usam no Omie. */
const CATEGORIA = { codigo: "2.04.06", descricao: "3.1.2.11 Materiais de Escritório - Administrativo" };

function ler() {
  if (!fs.existsSync(ARQUIVO)) {
    console.error(`${ARQUIVO} não existe. Rode primeiro: npm run cartao:teste -- gerar`);
    process.exit(1);
  }
  // windows-1252 como a tela faz — ler como UTF-8 quebraria o acento no meio de
  // uma coluna que é posicional.
  const texto = new TextDecoder("windows-1252").decode(fs.readFileSync(ARQUIVO));
  const fatura = parseOfx(texto);
  const separacao = separar(fatura.linhas);
  const provisoes = expandir(separacao.linhas, COMPETENCIA, VENCIMENTO);
  const titulos = titulosDaFatura(provisoes, () => CATEGORIA);
  return { fatura, separacao, provisoes, titulos };
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function previa() {
  const { fatura, separacao, titulos } = ler();

  console.log(`arquivo    ${path.basename(ARQUIVO)}`);
  console.log(`fechamento ${fatura.fechamento} · fatura de ${rotuloMes(fatura.competencia)} · conta ${fatura.conta}`);
  console.log(`competência confiável: ${fatura.competenciaConfiavel ? "sim" : "NÃO"}\n`);

  console.log("caso a caso — o que o parser entendeu de cada linha:");
  for (const l of LINHAS) {
    const c = separacao.linhas.find((x) => x.fitid === l.fitid)!;
    console.log(`\n  ${l.fitid}  ${brl(c.valor).padStart(11)}  [${c.balde}]`);
    console.log(`    caso     ${l.caso}`);
    console.log(`    memo     "${c.memo}"`);
    console.log(`    lojista  ${c.estabelecimento}  →  chave ${c.chave}`);
    if (c.parcela) console.log(`    parcela  ${c.parcela.n}/${c.parcela.de}`);
    if (c.cidade) console.log(`    cidade   ${c.cidade}`);
    if (c.exterior) {
      console.log(`    exterior ${c.exterior.dominio} · ${c.exterior.originalTexto} · `
        + `US$ ${c.exterior.valorUsd} · cotação ${c.exterior.cotacao}`);
    }
    console.log(`    motivo   ${c.motivo}`);
  }

  console.log("\n\nseparação:");
  for (const [balde, linhas] of Object.entries(separacao.porBalde)) {
    console.log(`  ${balde.padEnd(15)} ${String(linhas.length).padStart(2)} linha(s)  ` +
      `${brl(separacao.totais[balde as keyof typeof separacao.totais]).padStart(12)}`);
  }
  console.log(`  ${"".padEnd(15)} gastos ${brl(separacao.totalFatura)} − já provisionado ` +
    `${brl(separacao.totais.ignorar)} = a provisionar ${brl(separacao.totalAProvisionar)}`);

  console.log(`\nlojistas na conferência: ${agrupar([...separacao.porBalde.avista, ...separacao.porBalde.primeira]).length}`);
  console.log(`títulos que serão criados no Omie: ${titulos.length} · ${brl(titulos.reduce((a, t) => a + t.valor, 0))}`);

  console.log("\npayload do primeiro parcelado (as três parcelas):");
  const serie = titulos.filter((t) => t.fitid === "TESTEHUB0002");
  for (const t of serie) console.log("  " + JSON.stringify(montarTitulo(t)));
  console.log("\n  ↑ repare: `data_entrada` é a data da COMPRA nas três — é ela que ancora a DRE.");
  console.log("    Só `data_vencimento` anda mês a mês.");
}

/* ------------------------------------------------------------------
 * Falar com a Edge Function
 * ------------------------------------------------------------------ */

const SUPABASE_URL = "https://lgcxyxyidoirqmbdlldh.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const TOKEN = process.env.CARTAO_TESTE_TOKEN ?? "";

async function chamar(body: Record<string, unknown>) {
  if (!ANON || !TOKEN) {
    console.error(
      "Faltam credenciais. Exporte SUPABASE_ANON_KEY (a chave pública do projeto) e\n" +
      "CARTAO_TESTE_TOKEN (o token 'cartao-omie-enviar' de internal_cron_tokens).",
    );
    process.exit(1);
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/cartao-omie-enviar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "x-cron-token": TOKEN,
    },
    body: JSON.stringify(body),
  });
  const texto = await r.text();
  try { return JSON.parse(texto); } catch { return { status: "erro", erro: texto.slice(0, 500) }; }
}

async function enviar() {
  const { titulos } = ler();
  console.log(`enviando ${titulos.length} títulos da fatura de teste (competência ${COMPETENCIA})…`);

  // Mesmo laço da tela: a função devolve `restantes` quando o tempo acaba.
  for (let volta = 1; volta <= 20; volta++) {
    const r = await chamar({ action: "enviar", competencia: COMPETENCIA, titulos });
    console.log(`  lote ${volta}: ` + JSON.stringify(r, null, 1).replace(/\n\s*/g, " "));
    if (r.status === "erro" || !r.restantes) break;
  }

  const conf = await chamar({ action: "conferir", competencia: COMPETENCIA });
  const envios = (conf.envios ?? []) as { cod_titulo: string; estabelecimento: string; valor: string; status: string }[];
  console.log(`\nno Omie agora (${envios.length}):`);
  for (const e of envios) {
    console.log(`  ${String(e.cod_titulo).padStart(12)}  ${brl(Number(e.valor)).padStart(11)}  ` +
      `${e.status.padEnd(8)} ${e.estabelecimento}`);
  }
}

async function limpar() {
  const r = await chamar({ action: "limpar-teste" });
  console.log(JSON.stringify(r, null, 2));
}

/* ---------------------------------------------------------------------- CLI */

const cmd = process.argv[2];

if (cmd === "gerar") {
  // latin1 == windows-1252 para os acentos que este arquivo usa, e é assim que
  // o Sicoob exporta de verdade.
  fs.writeFileSync(ARQUIVO, Buffer.from(gerar(), "latin1"));
  console.log(`${ARQUIVO}: ${LINHAS.length} lançamentos, fechamento ${FECHAMENTO}.`);
  console.log("Confira com: npm run cartao:teste -- previa");
} else if (cmd === "previa") {
  previa();
} else if (cmd === "enviar") {
  await enviar();
} else if (cmd === "limpar") {
  await limpar();
} else {
  console.error("uso: npm run cartao:teste -- gerar | previa | enviar | limpar");
  process.exit(1);
}
