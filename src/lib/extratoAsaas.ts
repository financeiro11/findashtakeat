/* ============================================================================
 * Natureza do lançamento do Asaas — e o acumulado de taxas que sai dela.
 *
 * `asaas_extrato` não tem coluna de categoria: o que chega é a frase que a API
 * de financialTransactions escreve. A boa notícia é que essa frase é gerada por
 * evento, então ela é PADRONIZADA e sempre começa pelo tipo do lançamento:
 *
 *   "Cobrança recebida - fatura nr. 847174650 Varanda Café e prosa"
 *   "Taxa do Pix - fatura nr. 847174650 Varanda Café e prosa"
 *   "Taxa de emissão da nota fiscal de serviço nr. 16783 - fatura nr. 848311865 …"
 *   "Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA"
 *
 * Daí o teste ser ancorado no COMEÇO da frase. Ler por "contém" derrubava a
 * conta de duas maneiras, as duas caras:
 *
 *   - "Transação via Pix com chave para TAKEAT TECNOLOGIA LTDA" — a varrida do
 *     saldo para o banco, R$ 781 mil no acumulado — entrava como taxa do Pix, e
 *     o painel dizia que as taxas custavam 227% do que foi recebido;
 *   - "Taxa de cartão … Confeitaria Vista Alegre" entrava como NF, porque
 *     "co-NF-eitaria" contém "nf".
 *
 * Mora fora da tela para poder ser testado sem montar o componente.
 * A classificação do Sicoob é outra e mora em src/lib/extratoNatureza.ts — os
 * dois extratos falam línguas diferentes.
 * ========================================================================== */

import { normalize } from "@/lib/normalize";
import { eCredito } from "@/lib/extratoNatureza";

export type AsaasKey =
  // taxas cobradas pelo Asaas (débito)
  | "cartao" | "pix" | "mensageria" | "nf" | "boleto" | "whatsapp" | "taxa"
  // o dinheiro que entra
  | "cobranca"
  // saídas que NÃO são taxa
  | "transferencia" | "estorno" | "chargeback" | "outros";

/** As taxas, na ordem de desempate quando duas pesam igual. */
export const TAXAS_ASAAS = ["cartao", "pix", "mensageria", "nf", "boleto", "whatsapp", "taxa"] as const;
export type TaxaAsaas = (typeof TAXAS_ASAAS)[number];

const SET_TAXAS: ReadonlySet<string> = new Set(TAXAS_ASAAS);
export const ehTaxa = (k: AsaasKey): k is TaxaAsaas => SET_TAXAS.has(k);

export const ASAAS_META: Record<AsaasKey, { rot: string; dot: string }> = {
  cartao:        { rot: "Taxa de cartão",            dot: "bg-violet-500" },
  pix:           { rot: "Taxa do Pix",               dot: "bg-sky-500" },
  mensageria:    { rot: "Taxa de mensageria",        dot: "bg-amber-500" },
  nf:            { rot: "Emissão de NF de serviço",  dot: "bg-teal-500" },
  boleto:        { rot: "Taxa de boleto",            dot: "bg-indigo-500" },
  whatsapp:      { rot: "Notificação por WhatsApp",  dot: "bg-lime-500" },
  taxa:          { rot: "Outras taxas",              dot: "bg-zinc-500" },
  cobranca:      { rot: "Cobrança recebida",         dot: "bg-pos" },
  transferencia: { rot: "Transferências",            dot: "bg-cyan-600" },
  estorno:       { rot: "Estornos",                  dot: "bg-red-500" },
  chargeback:    { rot: "Chargebacks",               dot: "bg-rose-600" },
  outros:        { rot: "Outros",                    dot: "bg-muted-foreground/50" },
};

/**
 * A ordem dos testes é a regra: o específico vem antes do genérico. O
 * "TAXA" solto no fim é de propósito — um tipo de taxa novo do Asaas cai em
 * "Outras taxas" e continua somando no total, em vez de sumir da conta.
 */
export function classificaAsaas(historico: string | null | undefined): AsaasKey {
  // normalize devolve MAIÚSCULAS, sem acento e sem pontuação.
  const s = normalize(historico ?? "");
  const comeca = (...p: string[]) => p.some((x) => s.startsWith(x));

  if (comeca("COBRANCA RECEBIDA", "RECEBIMENTO DA COBRANCA")) return "cobranca";

  if (comeca("TAXA DE MENSAGERIA")) return "mensageria";
  if (comeca("TAXA DO PIX", "TAXA DE PIX")) return "pix";
  if (comeca("TAXA DE CARTAO", "TAXA DO CARTAO")) return "cartao";
  if (comeca("TAXA DE BOLETO", "TAXA DO BOLETO")) return "boleto";
  if (comeca("TAXA DE EMISSAO DA NOTA FISCAL", "TAXA DE EMISSAO DE NOTA FISCAL")) return "nf";
  if (comeca("TAXA DE NOTIFICACAO POR WHATSAPP", "TAXA DE NOTIFICACAO VIA WHATSAPP")) return "whatsapp";
  if (comeca("TAXA")) return "taxa";

  // Saída de saldo para conta bancária — o oposto de uma taxa, e o valor que
  // mais engana quem soma: são poucos lançamentos e são os maiores do extrato.
  if (comeca("TRANSACAO VIA PIX", "TRANSACAO VIA TED", "TRANSFERENCIA", "SAQUE")) return "transferencia";

  if (s.includes("CHARGEBACK")) return "chargeback";
  if (comeca("ESTORNO")) return "estorno";
  return "outros";
}

/**
 * "Estorno da taxa de cartão - fatura nr. …" é um CRÉDITO que devolve uma taxa
 * já cobrada. Devolve qual taxa é, para abatê-la; null quando o estorno é de
 * outra coisa (o estorno da cobrança em si, por exemplo).
 */
export function taxaEstornada(historico: string | null | undefined): TaxaAsaas | null {
  const s = normalize(historico ?? "");
  if (!s.startsWith("ESTORNO DA TAXA")) return null;
  const k = classificaAsaas(s.replace(/^ESTORNO DA /, ""));
  return ehTaxa(k) ? k : null;
}

/* ------------------------------ acumulado ------------------------------ */

export type LancamentoAsaas = {
  tipo: string | null;
  /** Sempre positivo; o sinal está em `tipo`. */
  valor: number | string | null;
  historico: string | null;
};

export type LinhaResumo = { key: AsaasKey; rot: string; dot: string; v: number; q: number };

export type ResumoAsaas = {
  /** As taxas presentes, da que mais pesa para a que menos pesa. */
  taxas: LinhaResumo[];
  totalTaxas: number;
  qtdTaxas: number;
  /** Cobranças recebidas — a base sobre a qual a taxa é um custo. */
  recebido: { v: number; q: number };
  custoPct: number;
  /** Saídas que não são taxa (transferência, estorno, chargeback). */
  fora: LinhaResumo[];
};

export function resumirAsaas(lancamentos: LancamentoAsaas[]): ResumoAsaas {
  const acc = new Map<AsaasKey, { v: number; q: number }>();
  const soma = (k: AsaasKey, v: number, q: number) => {
    const c = acc.get(k) ?? { v: 0, q: 0 };
    c.v += v;
    c.q += q;
    acc.set(k, c);
  };
  const recebido = { v: 0, q: 0 };

  for (const l of lancamentos) {
    const v = Math.abs(Number(l.valor) || 0);
    const k = classificaAsaas(l.historico);
    if (eCredito(l.tipo)) {
      if (k === "cobranca") { recebido.v += v; recebido.q++; continue; }
      // A devolução abate a taxa que a gerou, sem contar como cobrança nova.
      const devolvida = taxaEstornada(l.historico);
      if (devolvida) soma(devolvida, -v, 0);
      continue;
    }
    soma(k, v, 1);
  }

  const linha = (k: AsaasKey): LinhaResumo => ({ key: k, ...ASAAS_META[k], ...acc.get(k)! });
  const peso = (a: LinhaResumo, b: LinhaResumo) => b.v - a.v;

  const taxas = [...acc.keys()].filter(ehTaxa).map(linha).sort(peso);
  const fora = [...acc.keys()].filter((k) => !ehTaxa(k) && k !== "cobranca").map(linha).sort(peso);
  const totalTaxas = taxas.reduce((s, t) => s + t.v, 0);
  const qtdTaxas = taxas.reduce((s, t) => s + t.q, 0);

  return {
    taxas,
    totalTaxas,
    qtdTaxas,
    recebido,
    custoPct: recebido.v > 0 ? (totalTaxas / recebido.v) * 100 : 0,
    fora,
  };
}