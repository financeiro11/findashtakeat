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
  /** Em quantas vezes o DOCUMENTO diz que a compra foi paga (duplicatas da NF-e,
   *  "2x de R$ 125,66" do recibo). Vazio quando o papel não fala em parcela. */
  parcelas_total?: number | null;
  parcela_numero?: number | null;
  /** NÃO vem do modelo: quem gravou foi a ação "transcrever", que lê o documento
   *  sem julgar nada. Marca uma leitura que existe só para a Parametrização
   *  aproveitar o CNPJ e a razão social do emitente — atrás dela não há veredito
   *  nenhum, então ela não aprova, não vira fonte de carnê e não tranca nota
   *  repetida. Ver o cabeçalho de `auditoria-conferir-comprovante`. */
  transcricao_apenas?: boolean;
  /* --- julgamento (o ponteiro, conferido aqui) --- */
  fornecedor_confere: "sim" | "nao" | "incerto";
  fornecedor_motivo?: string | null;
  cobranca_explicada: "total" | "item" | "parcela" | "nao";
  item_rotulo?: string | null;
};

export type Lancamento = {
  /** O MEMO da fatura, como o Sicoob mandou: "LATAM AIR*0000V SAO PAULO". */
  titulo: string;
  valor: number;
  /** Data do gasto, AAAA-MM-DD. */
  data: string;
  /** O MEMO cru do extrato, com o marcador de parcela: "CENTRAL DE AVIAMENTO
   *  01/02   VITORIA". É a coluna `descricao` do achado. Sem ele a conferência
   *  funciona como sempre funcionou — só perde a prova de parcelamento. */
  memo?: string | null;
  /** Mês da fatura em que a cobrança caiu, AAAA-MM-DD. Usado só pelo carnê. */
  competencia?: string | null;
};

export type Como = "total" | "item" | "parcela" | "nenhum";

/** "01/02" — a parcela `n` de um total de `de`. */
export type Parcela = { n: number; de: number };

export type Veredito = {
  veredito: "aprovar" | "revisar";
  /** Uma frase em português dizendo por quê — é o que a tela mostra. */
  motivo: string;
  como: Como;
  /** O número do documento que casou com a cobrança, quando casou. */
  valor_casado: number | null;
  item_rotulo: string | null;
  /** Preenchido quando `como === "parcela"`: qual parcela de quantas. */
  parcela: Parcela | null;
  /** Preenchido quando `como === "parcela"`: o valor do documento que foi
   *  dividido em vezes. É o total da nota, ou a linha dela que a fatura
   *  parcelou sozinha (`item_rotulo` diz qual). */
  parcela_base: number | null;
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

/* ---------------------------------------------------------------------------
 * Parcelamento
 *
 * A NOTA É DO TOTAL, A FATURA COBRA UM PEDAÇO POR MÊS. A NF-e 178110 da Central
 * de Aviamentos é de R$ 251,31 e na fatura de agosto/26 apareceu R$ 125,66 —
 * metade. O total nunca vai bater, nenhuma linha do documento vale 125,66, e até
 * aqui isso caía em "revisar" com a frase "a cobrança não aparece no documento",
 * que é verdade e não ajuda ninguém.
 *
 * A PROVA ESTÁ NO MEMO. O Sicoob mantém o marcador `NN/MM` na fatura, e ele
 * chega ao achado na coluna `descricao`: "CENTRAL DE AVIAMENTO  01/02   VITORIA".
 * Não é palpite da IA — é o banco dizendo em que vezes a compra foi dividida. Em
 * ago/26 são 46 dos 137 achados. Quando o marcador não veio (os 120 achados de
 * julho estão sem `descricao`), vale o que o DOCUMENTO diz de si mesmo: as
 * duplicatas da NF-e, o "2x de R$ 125,66" do recibo.
 *
 * Sem nenhuma das duas provas a aritmética sozinha NÃO aprova: metade de uma nota
 * é metade de uma nota, e "parece parcelamento" não é o mesmo que ser. Nesse caso
 * a frase do "revisar" passa a dizer o que foi visto, e a pessoa decide.
 *
 * NEM SEMPRE É O TOTAL QUE FOI DIVIDIDO. A companhia aérea parcela a TARIFA e
 * cobra a taxa de embarque à parte, no mesmo dia: o bilhete de R$ 601,10 chega
 * como 3× de R$ 182,38 (a tarifa de R$ 547,14 dividida) mais um lançamento
 * avulso de R$ 53,96. Dividir o total daria R$ 200,37 e a conta jamais fecharia
 * — era o que mandava os bilhetes da GOL para o olho humano toda fatura, com a
 * frase "R$ 182,38 × 3 não dá o total do documento", verdadeira e inútil. Por
 * isso a divisão é tentada contra o total E contra cada linha pagável do papel.
 * ------------------------------------------------------------------------- */

/** Teto de vezes que se aceita como parcelamento de cartão. */
const MAX_PARCELAS = 24;

/* O marcador vem no meio do MEMO, cercado por espaço, e o resto da linha é nome
 * de estabelecimento e cidade — nunca número com barra. As duas guardas laterais
 * (`(?<!\d)` / `(?!\d)`) existem para não picar um número maior no meio. */
const MARCADOR = /(?<!\d)(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/;

/**
 * A parcela que o MEMO da fatura declara, ou null.
 *
 * Descarta o que não pode ser parcela de cartão: `de` menor que 2 (compra à
 * vista não é parcelada), `de` acima de 24, e `n` maior que `de` — é assim que
 * uma data solta no meio do texto ("30/07") se elimina sozinha.
 */
export function parcelaDoMemo(memo: unknown): Parcela | null {
  const m = String(memo ?? "").match(MARCADOR);
  if (!m) return null;
  const n = Number(m[1]);
  const de = Number(m[2]);
  if (!(de >= 2 && de <= MAX_PARCELAS)) return null;
  if (!(n >= 1 && n <= de)) return null;
  return { n, de };
}

/**
 * Quanto vale a parcela `n` de `de` de um documento de `totalCent` centavos.
 *
 * São dois valores possíveis porque há duas convenções de arredondamento e o
 * documento não diz qual foi usada: a sobra de centavos cai na ÚLTIMA parcela
 * (251,31 em 2 = 125,66 + 125,65) ou na PRIMEIRA. Devolve as duas — casar com
 * qualquer uma basta.
 */
export function candidatosDaParcela(totalCent: number, de: number, n: number): number[] {
  if (!Number.isFinite(totalCent) || totalCent <= 0) return [];
  if (!Number.isInteger(de) || de < 2 || de > MAX_PARCELAS) return [];
  if (!Number.isInteger(n) || n < 1 || n > de) return [];
  const teto = Math.ceil(totalCent / de);   // sobra na última
  const piso = Math.floor(totalCent / de);  // sobra na primeira
  const cands = new Set<number>([
    n === de ? totalCent - (de - 1) * teto : teto,
    n === 1 ? totalCent - (de - 1) * piso : piso,
  ]);
  return [...cands].filter((c) => c > 0);
}

/* Um centavo de folga sobre os candidatos. Não é para acomodar palpite: é para o
 * caso de a maquininha ter distribuído a sobra de um jeito que não é nenhuma das
 * duas convenções. Continua um alvo de 4 centavos numa nota de R$ 251,31. */
const FOLGA_CENTAVOS = 1;

const bateComParcela = (totalCent: number, de: number, n: number, alvo: number): boolean =>
  candidatosDaParcela(totalCent, de, n).some((c) => Math.abs(c - alvo) <= FOLGA_CENTAVOS);

/** De onde veio a informação de que a compra foi parcelada. */
type Evidencia = { de: number; n: number | null; fonte: "fatura" | "documento" };

function evidenciaDeParcelamento(lanc: Lancamento, leitura: Leitura): Evidencia | null {
  // O marcador da fatura vem primeiro: ele descreve como o CARTÃO cobrou, que é
  // exatamente a pergunta. O documento pode ter sido emitido à vista e a loja ter
  // parcelado na maquininha — aí só o memo sabe.
  const doMemo = parcelaDoMemo(lanc?.memo);
  if (doMemo) return { ...doMemo, fonte: "fatura" };

  const de = Number(leitura?.parcelas_total);
  if (Number.isInteger(de) && de >= 2 && de <= MAX_PARCELAS) {
    const n = Number(leitura?.parcela_numero);
    return { de, n: Number.isInteger(n) && n >= 1 && n <= de ? n : null, fonte: "documento" };
  }
  return null;
}

/** Um valor do documento que pode ter sido dividido em vezes. */
type Base = { cent: number; valor: number; rotulo: string | null };

/** O mínimo que se lê do documento para fazer conta de parcela. Frouxo de
 *  propósito: a tela guarda a mesma leitura num tipo só dela, e o que importa é
 *  ter o total e as linhas. */
type DocumentoValores = { valor_total?: unknown; valores?: unknown } | null | undefined;

/** Os candidatos a base, na ordem em que se olha: primeiro o total (o caso
 *  normal — a nota inteira parcelada), depois cada linha pagável.
 *
 *  Sem repetir número: "Tarifa total" e o total são o mesmo valor escrito duas
 *  vezes, e quem responde é a primeira aparição — assim o motivo sai falando do
 *  documento, e não de uma linha que é o documento. Imposto e desconto ficam de
 *  fora pelo mesmo motivo de sempre: ninguém parcela ICMS destacado. */
function basesDoDocumento(leitura: DocumentoValores): Base[] {
  const out: Base[] = [];
  const vistos = new Set<number>();
  const juntar = (v: unknown, rotulo: string | null) => {
    const cent = centavos(v);
    if (cent === null || cent === 0 || vistos.has(cent)) return;
    vistos.add(cent);
    out.push({ cent, valor: Number(v), rotulo });
  };
  juntar(leitura?.valor_total, null);
  const linhas = Array.isArray(leitura?.valores) ? (leitura.valores as ValorLido[]) : [];
  for (const l of linhas) {
    const rotulo = String(l?.rotulo ?? "");
    if (!rotuloNaoPagavel(rotulo)) juntar(l?.valor, rotulo);
  }
  return out;
}

/**
 * O pedaço do documento que, dividido em `de` vezes, dá o valor cobrado — e em
 * qual parcela a cobrança caiu. Devolve null quando nada do papel fecha a conta.
 *
 * `rotulo` null quer dizer "foi o total do documento"; preenchido, é a linha que
 * a fatura parcelou sozinha (a tarifa do bilhete, sem a taxa de embarque).
 *
 * `n` entra null quando não se sabe qual parcela é — aí vale qualquer uma, que
 * em parcelamento de valores iguais dá no mesmo. Quem diz que houve
 * parcelamento é quem chama: aqui só se faz a conta.
 */
export function baseDaParcela(
  leitura: DocumentoValores,
  de: number,
  n: number | null,
  valorCobrado: unknown,
): { valor: number; rotulo: string | null; n: number } | null {
  const alvo = centavos(valorCobrado);
  if (alvo === null || alvo === 0) return null;
  if (!Number.isInteger(de) || de < 2 || de > MAX_PARCELAS) return null;
  const numeros = Number.isInteger(n) && (n as number) >= 1 && (n as number) <= de
    ? [n as number]
    : Array.from({ length: de }, (_, i) => i + 1);
  for (const b of basesDoDocumento(leitura)) {
    const achou = numeros.find((k) => bateComParcela(b.cent, de, k, alvo));
    if (achou !== undefined) return { valor: b.valor, rotulo: b.rotulo, n: achou };
  }
  return null;
}

/** Em quantas vezes o valor cobrado divide o total do documento, se dividir.
 *  Só serve para ESCREVER o motivo do "revisar" — não aprova nada. */
function pareceParcelamento(totalCent: number, alvo: number): number | null {
  for (let de = 2; de <= 12; de++) {
    if (Math.abs(de * alvo - totalCent) <= de) return de;
  }
  return null;
}

/** O casamento entre a cobrança e um número do documento, ou a frase da recusa. */
type Casamento = {
  como: Como; valor_casado: number; item_rotulo: string | null;
  parcela: Parcela | null; parcela_base: number | null;
};

/** A frase de quando o valor cobrado simplesmente não está no papel. */
function naoAparece(lanc: Lancamento, leitura: Leitura): string {
  const tot = Number(leitura.valor_total) || 0;
  return tot
    ? `A cobrança de ${brl(lanc.valor)} não aparece no documento (o documento é de ${brl(tot)}).`
    : `A cobrança de ${brl(lanc.valor)} não aparece no documento.`;
}

/** Os dois caminhos antigos: a cobrança é o total do documento, ou é uma linha dele. */
function casarPonteiro(lanc: Lancamento, leitura: Leitura, alvo: number): Casamento | string {
  if (leitura.cobranca_explicada === "total") {
    const tot = centavos(leitura.valor_total);
    if (tot === null || tot !== alvo) {
      return `O documento é de ${brl(Number(leitura.valor_total) || 0)} e a cobrança é de ${brl(lanc.valor)}.`;
    }
    return { como: "total", valor_casado: Number(leitura.valor_total), item_rotulo: null, parcela: null, parcela_base: null };
  }

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
    return rot
      ? `A leitura apontou "${rot}", mas nenhuma linha do documento vale ${brl(lanc.valor)}.`
      : `Nenhuma linha do documento vale ${brl(lanc.valor)}.`;
  }
  if (rotuloNaoPagavel(achado.rotulo)) {
    return `A única linha de ${brl(lanc.valor)} é "${achado.rotulo}", que é linha de imposto/desconto — não é o que se paga.`;
  }
  return { como: "item", valor_casado: Number(achado.valor), item_rotulo: String(achado.rotulo), parcela: null, parcela_base: null };
}

function casarParcela(lanc: Lancamento, leitura: Leitura, alvo: number): Casamento | string {
  const tot = centavos(leitura?.valor_total);
  const ev = evidenciaDeParcelamento(lanc, leitura);

  if (!ev) {
    const de = tot ? pareceParcelamento(tot, alvo) : null;
    return de
      ? `A cobrança de ${brl(lanc.valor)} não aparece no documento (o documento é de ${brl(Number(leitura.valor_total) || 0)}) — é exatamente 1/${de} dele, mas nem a fatura nem o documento dizem que a compra foi parcelada.`
      : "";  // sem evidência nenhuma: quem fala é a recusa do caminho principal
  }

  const onde = ev.fonte === "fatura" ? "a fatura marca" : "o documento diz";
  if (tot === null || tot === 0) {
    return `${onde === "a fatura marca" ? "A fatura marca" : "O documento diz"} que a compra foi parcelada em ${ev.de} vezes, mas não deu para ler o total do documento.`;
  }

  /* O total primeiro e, se ele não fechar, as linhas do papel: a companhia aérea
     parcela só a tarifa. Sem saber QUAL parcela é, `baseDaParcela` testa todas —
     em parcelamento de valores iguais dá no mesmo, e é o preço de o documento
     não numerar a parcela. */
  const b = baseDaParcela(leitura, ev.de, ev.n, lanc.valor);
  if (!b) {
    return `${onde} parcelamento em ${ev.de} vezes, mas ${brl(lanc.valor)} × ${ev.de} não dá o total do documento (${brl(Number(leitura.valor_total) || 0)}) nem nenhuma linha dele.`;
  }
  return {
    como: "parcela", valor_casado: Number(lanc.valor), item_rotulo: b.rotulo,
    parcela: { n: b.n, de: ev.de }, parcela_base: b.valor,
  };
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
 *      documento, uma linha pagável dele, ou a parcela declarada na fatura;
 *   5. a data do documento é compatível com a data do gasto.
 */
export function conferir(lanc: Lancamento, leitura: Leitura): Veredito {
  const nada = { como: "nenhum" as Como, valor_casado: null, item_rotulo: null, parcela: null, parcela_base: null };
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
  const apontou = leitura.cobranca_explicada === "total" || leitura.cobranca_explicada === "item";

  /* A parcela é a rede embaixo dos outros caminhos, não um quarto caminho: o
     modelo que erra o ponteiro ("total", quando é metade) não pode custar a
     conferência. Só entra quando o principal falhou — nota que bate inteira é
     nota que bate inteira. */
  const principal = apontou ? casarPonteiro(lanc, leitura, alvo) : casarParcela(lanc, leitura, alvo);
  const casado = apontou && typeof principal === "string" ? casarParcela(lanc, leitura, alvo) : principal;

  if (typeof casado === "string") {
    /* Duas recusas na mão. Se o modelo APONTOU um número e o número não serve, é
       a recusa dele que explica o caso — "a linha de R$ 16,46 é o ICMS" diz mais
       do que qualquer conta sobre parcelas. Sem ponteiro, quem fala é a parcela,
       e ela devolve "" quando não tem nada a dizer. */
    return revisar(apontou ? String(principal) : (casado || naoAparece(lanc, leitura)));
  }

  const { como, valor_casado: valorCasado, item_rotulo: itemRotulo } = casado;
  const casou = casado;

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

  /* Em parcela por LINHA a frase precisa dizer de que linha se trata: sem isso o
     motivo continuaria falando de um total que não é o número que foi dividido,
     e quem lê teria de refazer a conta na mão para acreditar. */
  const doQue = itemRotulo
    ? `da linha "${itemRotulo}" (${brl(casado.parcela_base ?? 0)}) do documento de ${brl(Number(leitura.valor_total) || 0)}`
    : `do documento de ${brl(Number(leitura.valor_total) || 0)}`;
  const onde = como === "total"
    ? `total do documento (${brl(valorCasado!)})`
    : como === "parcela"
      ? `parcela ${casado.parcela!.n}/${casado.parcela!.de} ${doQue}`
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
 * documento (mesmo emitente, mesmo número, mesmo valor) explicando dois gastos
 * pela MESMA parte. Esta chave identifica o papel; qual parte dele cada cobrança
 * gastou é `pedacoUsado`, logo abaixo — e as duas juntas é que fazem a trava.
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

/**
 * Qual PEDAÇO do documento esta cobrança consumiu.
 *
 * Uma nota não se gasta inteira de uma vez. O bilhete da GOL nº 1272309021809
 * explica DUAS cobranças da mesma fatura de agosto/26 — a taxa de embarque de
 * R$ 53,96, avulsa, e a tarifa de R$ 547,14 parcelada em 3× de R$ 182,38. Mesmo
 * emitente, mesmo número, mesmo total: para `chaveDocumento` é o mesmo papel, e
 * a trava de nota repetida derrubava a segunda aprovação sem ter razão.
 *
 * O que não pode repetir é o mesmo PEDAÇO: a mesma linha, a mesma parcela, o
 * total inteiro. Duas cobranças que casaram com partes diferentes do documento
 * são duas cobranças legítimas do mesmo documento.
 *
 * Quando a regra não consegue dizer qual pedaço foi (leitura velha, aprovação
 * feita na mão) vale o valor cobrado: duas cobranças do MESMO valor contra a
 * mesma nota continuam sendo a nota usada duas vezes.
 */
export function pedacoUsado(lanc: Lancamento, leitura: Leitura, v?: Veredito): string {
  const conf = v ?? conferir(lanc, leitura);
  const rot = norm(conf.item_rotulo);
  if (conf.como === "parcela" && conf.parcela) {
    return `parcela|${conf.parcela.n}/${conf.parcela.de}${rot ? `|${rot}` : ""}`;
  }
  if (conf.como === "item") return `linha|${rot}`;
  if (conf.como === "total") return "total";
  const p = parcelaDoMemo(lanc?.memo);
  return p ? `parcela|${p.n}/${p.de}` : `valor|${centavos(lanc?.valor) ?? 0}`;
}

/* ---------------------------------------------------------------------------
 * O carnê: a nota conferida hoje vale para as faturas que vêm
 *
 * Conferida a 1ª parcela, a 2ª não é um caso novo — é a MESMA compra, com a
 * MESMA nota, chegando no mês seguinte. Cobrar o comprovante de novo é cobrar
 * duas vezes o mesmo documento, e é isso que fazia a Central de Aviamentos voltar
 * para a fila de "SEM NF" toda fatura.
 *
 * O que liga as duas linhas é o MEMO: entre uma fatura e a seguinte muda só o
 * marcador ("CENTRAL DE AVIAMENTO  01/02" → "  02/02"), o resto do texto é
 * idêntico. A chave é esse texto sem o marcador, mais em quantas vezes a compra
 * foi dividida.
 *
 * As três amarras que impedem uma compra NOVA do mesmo lojista de ser tomada por
 * parcela — o mesmo Mercado Livre aparece seis vezes na fatura de agosto:
 *   • o número da parcela tem de ser outro (2/2 não casa com 1/2);
 *   • o valor tem de ser o que sobra do total do documento naquela parcela;
 *   • a distância em MESES entre as faturas tem de ser a distância entre as
 *     parcelas: a 2ª vem uma fatura depois da 1ª, não três.
 * ------------------------------------------------------------------------- */

/** O texto do MEMO sem o marcador de parcela e sem a anotação que o n8n concatena
 *  depois de " | " ("… | Cobrar comprovante de Miguel M C Filho"). */
export function chaveDoParcelamento(memo: unknown, de: number): string | null {
  const cru = String(memo ?? "").split("|")[0];
  const semMarcador = norm(cru.replace(MARCADOR, " "));
  if (!semMarcador || !(de >= 2 && de <= MAX_PARCELAS)) return null;
  return `${semMarcador}|${de}`;
}

/** Uma compra parcelada já conferida contra a sua nota. */
export type Carne = {
  chave: string;
  /** A parcela que foi conferida (quase sempre a 1ª — é a que gera achado). */
  parcela: Parcela;
  /** O valor que foi dividido em vezes, em reais: o total da nota ou a linha
   *  dela que a fatura parcelou sozinha. É dele que sai o valor esperado das
   *  outras parcelas — com o total no lugar da tarifa do bilhete, a parcela do
   *  mês seguinte não seria reconhecida. */
  base: number;
  /** Fatura em que a parcela conferida caiu, AAAA-MM-DD. */
  competencia: string;
};

/**
 * O carnê que este lançamento conferido abre, ou null.
 *
 * Devolve algo só quando a conferência casou POR PARCELA e o lançamento traz
 * memo e competência — sem os dois não há como reconhecer a parcela seguinte.
 * Quem decide se o carnê vale (veredito da regra ou aprovação de gente) é quem
 * chama; aqui é só a forma.
 */
export function carneDe(lanc: Lancamento, leitura: Leitura): Carne | null {
  const v = conferir(lanc, leitura);
  if (v.como !== "parcela" || !v.parcela) return null;
  const chave = chaveDoParcelamento(lanc?.memo, v.parcela.de);
  const base = Number(v.parcela_base ?? leitura?.valor_total) || 0;
  const comp = String(lanc?.competencia ?? "").slice(0, 10);
  if (!chave || !base || !/^\d{4}-\d{2}/.test(comp)) return null;
  return { chave, parcela: v.parcela, base, competencia: comp };
}

const emMeses = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/**
 * A parcela que `alvo` é dentro de `carne` — ou null quando não é a mesma compra.
 *
 * É a pergunta "esta cobrança da fatura nova já está explicada pela nota do mês
 * passado?". Responder "sim" aqui resolve o achado sem pedir comprovante nenhum.
 */
export function outraParcelaDoCarne(carne: Carne, alvo: Lancamento): Parcela | null {
  const p = parcelaDoMemo(alvo?.memo);
  if (!p || p.de !== carne.parcela.de) return null;
  if (p.n === carne.parcela.n) return null;
  if (chaveDoParcelamento(alvo?.memo, p.de) !== carne.chave) return null;

  const alvoCent = centavos(alvo?.valor);
  const baseCent = centavos(carne.base);
  if (alvoCent === null || baseCent === null) return null;
  if (!bateComParcela(baseCent, p.de, p.n, alvoCent)) return null;

  const comp = String(alvo?.competencia ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}/.test(comp)) return null;
  if (emMeses(comp) - emMeses(carne.competencia) !== p.n - carne.parcela.n) return null;

  return p;
}
