/* ============================================================================
 * Ler sentido do texto que o banco manda: a natureza do lançamento e quem está
 * do outro lado dele.
 *
 * Nem `sicoob_extrato` nem `asaas_extrato` têm coluna de categoria: a automação
 * que os alimenta grava o que o banco manda, e o que o banco manda é uma frase
 * ("PIX RECEBIDO - FULANO", "TARIFA PACOTE DE SERVICOS"). Não existe de-para de
 * extrato bancário para categoria do Omie — então "categoria" aqui é sempre
 * inferida, e é honesto chamá-la de natureza.
 *
 * Mora fora da tela porque agora são DUAS telas: a conta corrente do desktop e a
 * aba Extratos do celular. Duas cópias da mesma heurística divergem no primeiro
 * ajuste de palavra-chave, e aí o mesmo lançamento vira "folha" num aparelho e
 * "outras saídas" no outro.
 * ========================================================================== */

import { normalize } from "@/lib/normalize";

export type SicKey =
  | "pix_in" | "ted_in" | "pix_out" | "boleto"
  | "folha" | "imposto" | "tarifa" | "outros_in" | "outros_out";

export const SIC_META: Record<SicKey, { rot: string; selo: string; dot: string; chip: string }> = {
  pix_in:    { rot: "Pix recebido",       selo: "Pix recebido",  dot: "bg-emerald-500", chip: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" },
  ted_in:    { rot: "TED recebida",       selo: "TED recebida",  dot: "bg-teal-500",    chip: "border-teal-500/40 text-teal-700 dark:text-teal-400" },
  pix_out:   { rot: "Pix enviado",        selo: "Pix enviado",   dot: "bg-sky-500",     chip: "border-sky-500/40 text-sky-700 dark:text-sky-400" },
  boleto:    { rot: "Boletos pagos",      selo: "Boleto pago",   dot: "bg-violet-500",  chip: "border-violet-500/40 text-violet-700 dark:text-violet-400" },
  folha:     { rot: "Folha e benefícios", selo: "Folha",         dot: "bg-amber-500",   chip: "border-amber-500/40 text-amber-700 dark:text-amber-400" },
  imposto:   { rot: "Impostos",           selo: "Imposto",       dot: "bg-red-500",     chip: "border-red-500/40 text-red-700 dark:text-red-400" },
  tarifa:    { rot: "Tarifas bancárias",  selo: "Tarifa banc.",  dot: "bg-zinc-500",    chip: "border-zinc-400/50 text-muted-foreground" },
  outros_in: { rot: "Outras entradas",    selo: "Entrada",       dot: "bg-emerald-400", chip: "border-emerald-400/40 text-emerald-700 dark:text-emerald-400" },
  outros_out:{ rot: "Outras saídas",      selo: "Saída",         dot: "bg-muted-foreground/60", chip: "border-border text-muted-foreground" },
};

export const ORDEM_SIC: SicKey[] = [
  "pix_in", "ted_in", "pix_out", "boleto", "folha", "imposto", "tarifa", "outros_in", "outros_out",
];

/** Crédito ou débito. A coluna `tipo` vem 'credito'/'debito'; `valor` é sempre positivo. */
export const eCredito = (t: string | null | undefined) => (t ?? "").toLowerCase().startsWith("cred");

/**
 * A ordem dos testes é a regra: tarifa e imposto ganham de "pix" porque um DARF
 * pago via Pix é imposto, não "Pix enviado" — quem procura o que saiu de dinheiro
 * no mês quer ver o tributo separado do fornecedor.
 */
export function classificaSicoob(h: string | null | undefined, credito: boolean): SicKey {
  const s = (h ?? "").toLowerCase();
  const tem = (...t: string[]) => t.some((x) => s.includes(x));
  if (tem("tarifa", "pacote de serv", "cesta", "manutenção de conta", "manutencao de conta")) return "tarifa";
  if (tem("imposto", "darf", "das ", "fgts", "inss", "iss", "tribut", "gps", "gare")) return "imposto";
  if (tem("folha", "salário", "salario", "sal.", "vale", "benefíc", "benefic", "rescis", "13º", "adiantamento")) return "folha";
  if (tem("boleto", "titulo", "título", "fatura", "cobrança bancária", "cobranca bancaria")) return "boleto";
  if (tem("pix")) return credito ? "pix_in" : "pix_out";
  if (tem("ted", "doc ", "transf")) return credito ? "ted_in" : "outros_out";
  return credito ? "outros_in" : "outros_out";
}

/* ------------------------- quem está do outro lado ------------------------- */

/**
 * `sicoob_extrato.contraparte_nome` não é um nome: é um registro inteiro embutido
 * numa string, com os campos separados por `|@` e o texto QUEBRADO A CADA 40
 * CARACTERES — a largura do campo no sistema de origem.
 *
 *   "Recebimento Pix|@TAKEAT TECNOLOGIA LTDA|@37.511.891 0001-50|@"
 *   "Pagamento Pix|@08.335.789 0001-43|@coffe festa junina"
 *   "Pagamento Pix|@37.811.865 0001-48|@Formacao AI Builder Turma 03 da Kairu La|@bs 2 alunos…"
 *
 * Jogar isso como título de um card do celular é ilegível, e é a informação que
 * mais importa na tela: o "coffe festa junina" é a resposta para "o que foi esse
 * Pix de R$ 1.160?". Daí o parser.
 *
 * A coluna `contraparte_documento` existe mas vem sempre nula — o CNPJ está aqui
 * dentro, e é daqui que ele sai.
 */
export type Contraparte = {
  /** O nome ou a descrição — o que vai no título do card. Null quando não há. */
  nome: string | null;
  /** "Pagamento Pix", "Recebimento Pix" — o rótulo da operação, quando genérico. */
  operacao: string | null;
  /** CNPJ/CPF achado no meio do texto (o CPF vem mascarado pelo banco). */
  documento: string | null;
};

const LARGURA = 40;

/** Rótulos que descrevem a operação, não a pessoa — o histórico já os repete. */
const ROTULOS_GENERICOS = new Set([
  "PAGAMENTO PIX", "RECEBIMENTO PIX", "ESTORNO PIX", "TRANSFERENCIA PIX", "TRANSFERENCIA",
  "PAGAMENTO DE CARTAO DE CREDITO", "PAGAMENTO DE BOLETO", "PAGAMENTO DE CONTA",
  "PAGAMENTO DE TRIBUTO", "APLICACAO", "RESGATE",
]);

const soDigitos = (s: string) => s.replace(/\D/g, "");

/** CNPJ ("37.511.891 0001-50"), CPF, ou o CPF mascarado que o banco devolve ("***.423.116-**"). */
function ehDocumento(s: string): boolean {
  if (!/^[\d.*\-/ ]+$/.test(s)) return false;
  if (s.includes("*")) return soDigitos(s).length >= 6;
  const n = soDigitos(s).length;
  return n === 11 || n === 14;
}

/**
 * Desfaz a quebra de 40 caracteres. Um pedaço de largura cheia foi cortado no meio
 * da palavra ("…Kairu La" + "bs 2 alunos…"), então emenda sem espaço; o pedaço
 * seguinte perdeu só o espaço final, então esse volta. Fora de uma quebra, cada
 * pedaço é um campo próprio e não se emenda com nada.
 */
function remontar(pedacos: string[]): string[] {
  const out: string[] = [];
  let atual: string | null = null;
  let anterior = 0;

  for (const bruto of pedacos) {
    const p = bruto.trim();
    const tam = bruto.length;
    if (atual !== null) {
      atual += (anterior >= LARGURA ? "" : " ") + p;
      // Largura cheia (ou cheia menos o espaço aparado) = o texto continua.
      if (tam >= LARGURA - 1) { anterior = tam; continue; }
      out.push(atual.trim());
      atual = null;
      continue;
    }
    if (!p) continue;
    if (tam >= LARGURA) { atual = p; anterior = tam; continue; }
    out.push(p);
  }
  if (atual !== null) out.push(atual.trim());
  return out.filter(Boolean);
}

/** Lê o pacote. Devolve tudo nulo quando não há o que ler. */
export function lerContraparte(bruto: string | null | undefined): Contraparte {
  const partes = remontar((bruto ?? "").split("|@"));
  if (!partes.length) return { nome: null, operacao: null, documento: null };

  const documento = partes.find(ehDocumento) ?? null;
  const textos = partes
    .filter((p) => p !== documento && !ehDocumento(p))
    .map((p) => p.replace(/^FAV\.?:\s*/i, "").trim()) // "FAV.: FULANO LTDA" → "FULANO LTDA"
    .filter(Boolean);

  // O rótulo só é descartado como título quando sobra outra coisa para pôr no lugar:
  // em "Nayara Evangelista" a primeira parte É o nome, e engolir isso deixaria o card mudo.
  let operacao: string | null = null;
  let resto = textos;
  if (textos.length > 1 && ROTULOS_GENERICOS.has(normalize(textos[0]))) {
    operacao = textos[0];
    resto = textos.slice(1);
  }

  return { nome: resto.join(" · ") || null, operacao, documento };
}
