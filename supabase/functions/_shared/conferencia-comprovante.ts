/* ---------------------------------------------------------------------------
 * A regra que decide se o comprovante enviado explica o gasto.
 *
 * A IA LÊ o documento; quem APROVA é este módulo. A separação não é preciosismo:
 * o veredito da IA vale apenas como um ponteiro ("o que foi cobrado é o total" /
 * "é a linha Taxa de Embarque"), e aqui a conta é refeita em cima do que ela
 * própria transcreveu. Se a IA disser que confere e nenhum número transcrito
 * bater com o lançamento, o veredito vira "revisar" — ela não consegue aprovar
 * por afirmação, só transcrevendo um valor que de fato é igual à cobrança.
 *
 * Todo o dinheiro é comparado em CENTAVOS inteiros. Comparar float de dinheiro
 * erra em 0,01 e some — mesmo cuidado do de-para do cartão.
 *
 * As regras nasceram das 21 notas que estavam na fila de "Em análise · COM NF"
 * em ago/26. Os casos que moldaram cada uma estão comentados abaixo, e viram
 * teste em src/lib/conferenciaComprovante.test.ts.
 * ------------------------------------------------------------------------- */

/** Um valor monetário transcrito do documento, com o rótulo que o acompanha. */
export type ValorLido = { rotulo: string; valor: number };

/** O que a IA devolve por documento: primeiro a transcrição, depois o palpite. */
export type Leitura = {
  /* --- transcrição (o que está escrito no papel) --- */
  legivel: boolean;
  tipo_documento: string;
  emitente_nome: string;
  emitente_cnpj?: string | null;
  valor_total: number;
  valores: ValorLido[];
  data_documento?: string | null;
  numero_documento?: string | null;
  descricao: string;
  observacao?: string | null;
  /* --- julgamento (o ponteiro, conferido aqui) --- */
  fornecedor_confere: "sim" | "nao" | "incerto";
  fornecedor_motivo?: string | null;
  cobranca_explicada: "total" | "item" | "nao";
  item_rotulo?: string | null;
};

export type Lancamento = {
  /** O MEMO da fatura, como o Sicoob mandou: "LATAM AIR*0000V SAO PAULO". */
  titulo: string;
  valor: number;
  /** Data do gasto, AAAA-MM-DD. */
  data: string;
};

export type Como = "total" | "item" | "nenhum";

export type Veredito = {
  veredito: "aprovar" | "revisar";
  /** Uma frase em português dizendo por quê — é o que a tela mostra. */
  motivo: string;
  como: Como;
  /** O número do documento que casou com a cobrança, quando casou. */
  valor_casado: number | null;
  item_rotulo: string | null;
};

/** As marcas de acento que a decomposição NFD solta (U+0300–U+036F). Montada a
 *  partir de texto ASCII de propósito: escrita como classe literal, a faixa vira
 *  caractere combinante invisível no fonte e some no primeiro reencode. */
const ACENTOS = new RegExp("[\\u0300-\\u036f]", "g");

const norm = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(ACENTOS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Dinheiro em centavos inteiros. Devolve null para o que não é número.
 *
 *  O `v == null` e o teste de string vazia não são zelo: `Number(null)` e
 *  `Number("")` são 0, e 0 é finito. Sem eles, um campo que a IA não conseguiu
 *  preencher viraria "R$ 0,00" e passaria a comparar como um valor de verdade. */
export function centavos(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n) * 100);
}

const brl = (v: number): string =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Linhas que aparecem na nota mas ninguém paga separado: base de cálculo,
 * imposto destacado, desconto. Elas existem para o fisco, não para o cartão.
 *
 * A nota 429 (Central de Aviamentos) traz onze valores, entre eles "Valor do
 * ICMS = 16,46". Sem esta lista, uma cobrança de R$ 16,46 casaria com o imposto
 * destacado e seria aprovada sozinha.
 *
 * Cuidado ao mexer: "Taxas e/ou impostos" do bilhete LATAM É pagável — é a
 * parcela que a companhia cobra em separado. Por isso a exclusão é por TOKEN
 * exato (ICMS, IPI, PIS...) e por frase inteira ("BASE DE CALCULO"), nunca por
 * pedaço solto de palavra. */
const TOKENS_NAO_PAGAVEIS = new Set([
  "ICMS", "IPI", "PIS", "COFINS", "CSLL", "IRRF", "INSS", "ISS", "ST",
  "DESCONTO", "DESCONTOS", "TROCO",
]);
const FRASES_NAO_PAGAVEIS = [
  "BASE DE CALCULO", "BASE CALCULO", "TRIB APROX", "TRIBUTOS APROX",
  "APROX DOS TRIBUTOS", "VALOR APROXIMADO", "TOTAL DE TRIBUTOS",
];

/** true quando o rótulo é linha contábil, não uma parcela que alguém paga. */
export function rotuloNaoPagavel(rotulo: string): boolean {
  const n = norm(rotulo);
  if (!n) return true;
  if (FRASES_NAO_PAGAVEIS.some((f) => n.includes(f))) return true;
  return n.split(" ").some((t) => TOKENS_NAO_PAGAVEIS.has(t));
}

/* Janela entre a data do documento e a data do gasto.
 *
 * Larga de propósito para trás (a nota pode ser emitida bem antes da compra
 * cair na fatura) e curta para frente (nota emitida DEPOIS do gasto que ela
 * deveria explicar é o sinal de nota reaproveitada). Fora da janela não reprova
 * nada — só tira do automático e devolve para o olho humano. */
const DIAS_ANTES = 120;
const DIAS_DEPOIS = 15;

function diffDias(docISO: string, gastoISO: string): number | null {
  const a = Date.parse(`${docISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${gastoISO.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

/**
 * O veredito de um comprovante contra o lançamento que ele deveria explicar.
 *
 * Só devolve "aprovar" quando TUDO abaixo é verdade — qualquer dúvida cai para
 * "revisar", que é o estado em que a pessoa continua decidindo:
 *   1. o documento é legível e é um comprovante;
 *   2. dá para dizer quem emitiu;
 *   3. o fornecedor do documento é o mesmo do lançamento (julgamento da IA);
 *   4. um número transcrito bate CENTAVO A CENTAVO com a cobrança — o total do
 *      documento, ou uma linha pagável dele;
 *   5. a data do documento é compatível com a data do gasto.
 */
export function conferir(lanc: Lancamento, leitura: Leitura): Veredito {
  const nada = { como: "nenhum" as Como, valor_casado: null, item_rotulo: null };
  const revisar = (motivo: string, extra: Partial<Veredito> = {}): Veredito => ({
    veredito: "revisar", motivo, ...nada, ...extra,
  });

  const alvo = centavos(lanc?.valor);
  if (alvo === null || alvo === 0) {
    return revisar("O lançamento não tem valor para conferir.");
  }

  if (!leitura?.legivel) {
    // Caso real: o print do Meta Business Manager mandado no lugar da fatura do
    // WhatsApp (GOOGLE WhatsA, R$ 55,00). A IA acusa, e ninguém aprova um print.
    const obs = String(leitura?.observacao || leitura?.descricao || "").trim();
    return revisar(obs ? `O arquivo não é um comprovante legível: ${obs}` : "O arquivo não é um comprovante legível.");
  }

  if (!norm(leitura.emitente_nome)) {
    return revisar("Não deu para identificar quem emitiu o documento.");
  }

  /* ---- 1) o número: a IA aponta, a conta é refeita aqui ---- */
  let como: Como = "nenhum";
  let valorCasado: number | null = null;
  let itemRotulo: string | null = null;

  if (leitura.cobranca_explicada === "total") {
    const tot = centavos(leitura.valor_total);
    if (tot === null || tot !== alvo) {
      return revisar(
        `O documento é de ${brl(Number(leitura.valor_total) || 0)} e a cobrança é de ${brl(lanc.valor)}.`,
      );
    }
    como = "total";
    valorCasado = Number(leitura.valor_total);
  } else if (leitura.cobranca_explicada === "item") {
    /* O bilhete aéreo é o caso que obriga a olhar linha a linha: a fatura cobra
     * "TAXA DE EMBARQUE GOL R$ 53,96" e o recibo do bilhete é de R$ 382,10, com
     * a taxa como uma das linhas. O total nunca vai bater; a linha bate. */
    const rot = String(leitura.item_rotulo ?? "");
    const lista = Array.isArray(leitura.valores) ? leitura.valores : [];
    const alvoRot = norm(rot);
    const achado =
      lista.find((v) => norm(v?.rotulo) === alvoRot && centavos(v?.valor) === alvo) ??
      lista.find((v) => centavos(v?.valor) === alvo);

    if (!achado) {
      return revisar(
        rot
          ? `A leitura apontou "${rot}", mas nenhuma linha do documento vale ${brl(lanc.valor)}.`
          : `Nenhuma linha do documento vale ${brl(lanc.valor)}.`,
      );
    }
    if (rotuloNaoPagavel(achado.rotulo)) {
      return revisar(
        `A única linha de ${brl(lanc.valor)} é "${achado.rotulo}", que é linha de imposto/desconto — não é o que se paga.`,
      );
    }
    como = "item";
    valorCasado = Number(achado.valor);
    itemRotulo = String(achado.rotulo);
  } else {
    const tot = Number(leitura.valor_total) || 0;
    return revisar(
      tot
        ? `A cobrança de ${brl(lanc.valor)} não aparece no documento (o documento é de ${brl(tot)}).`
        : `A cobrança de ${brl(lanc.valor)} não aparece no documento.`,
    );
  }

  const casou = { como, valor_casado: valorCasado, item_rotulo: itemRotulo };

  /* ---- 2) o fornecedor ---- */
  if (leitura.fornecedor_confere !== "sim") {
    const porque = String(leitura.fornecedor_motivo || "").trim();
    return revisar(
      `O valor bate, mas o fornecedor não se confirma: ${leitura.emitente_nome} × "${lanc.titulo}"${porque ? ` — ${porque}` : ""}.`,
      casou,
    );
  }

  /* ---- 3) a data ---- */
  if (leitura.data_documento) {
    const d = diffDias(String(leitura.data_documento), String(lanc.data));
    if (d !== null && (d < -DIAS_ANTES || d > DIAS_DEPOIS)) {
      return revisar(
        `O valor e o fornecedor batem, mas o documento é de ${String(leitura.data_documento).slice(0, 10)} e o gasto é de ${String(lanc.data).slice(0, 10)}.`,
        casou,
      );
    }
  }

  const onde = como === "total"
    ? `total do documento (${brl(valorCasado!)})`
    : `linha "${itemRotulo}" (${brl(valorCasado!)})`;
  return {
    veredito: "aprovar",
    motivo: `${leitura.emitente_nome} · ${onde} bate com a cobrança de ${brl(lanc.valor)}.`,
    ...casou,
  };
}

/**
 * A mesma nota usada duas vezes.
 *
 * Quatro achados de R$ 53,96 "TAXA DE EMBARQUE GOL" são legítimos — são quatro
 * passageiros, cada um com o seu recibo. O que não é legítimo é o MESMO
 * documento (mesmo emitente, mesmo número, mesmo valor) explicando dois gastos.
 * Sem número de documento não dá para afirmar nada, e aí não se acusa.
 */
export function chaveDocumento(leitura: Leitura): string | null {
  const num = norm(leitura?.numero_documento);
  const cnpj = String(leitura?.emitente_cnpj ?? "").replace(/\D/g, "");
  const emit = cnpj || norm(leitura?.emitente_nome);
  const tot = centavos(leitura?.valor_total);
  if (!num || !emit || tot === null || tot === 0) return null;
  return `${emit}|${num}|${tot}`;
}
