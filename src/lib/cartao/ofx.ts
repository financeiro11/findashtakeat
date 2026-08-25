/**
 * Leitura do OFX da fatura do cartão Sicoob.
 *
 * Este módulo NÃO decide nada de contabilidade — ele só desembrulha o arquivo.
 * Quem separa o que vai para o Omie é `provisionar.ts`.
 *
 * O FORMATO, conferido contra as 9 faturas reais (dez/25 → ago/26):
 *
 *   <MEMO>MP*MERCADOLIVREV      07/12   ITU</MEMO>
 *         |                   | |   |   |
 *         0                  21 22 26   30
 *
 * O MEMO é um relatório de LARGURA FIXA, não texto livre: 22 colunas de nome do
 * estabelecimento, a parcela `NN/MM` na coluna 23 (índice 22) e, a partir da
 * coluna 31 (índice 30), a cidade — ou, nas compras internacionais, a cauda com
 * domínio, valor em dólar e cotação. Nas 3.415 linhas das nove faturas a parcela
 * caiu no índice 22 em TODAS menos uma por arquivo (a anuidade, que traz o final
 * do cartão antes: `ANUIDADE VISA C      (3485) 07/12`), tratada no fallback.
 *
 * Isso importa porque o corte por coluna é exato e o corte por regex não seria:
 * "MP*MERCADOLIVREV" e "MERCADOLIVRE*MERCADO" têm asteriscos em lugares
 * diferentes, cidades têm espaço no meio e há nome truncado exatamente em 22
 * caracteres, sem separador nenhum antes da parcela.
 */

import { normalize } from "@/lib/normalize";
/* O leitor de MEMO mora em `supabase/functions/_shared/cartao-memo.ts`: o mesmo
   texto precisa ser lido também numa Edge Function (para escrever o nome do
   lojista de volta no Omie), e um segundo leitor faria as telas discordarem
   sobre o nome do mesmo lojista. Aqui só se reexporta. */
import {
  COL_CAUDA, COL_PARCELA, lerMemo, limparNome, numeroBR,
  type Exterior, type Memo,
} from "../../../supabase/functions/_shared/cartao-memo";

export { lerMemo, numeroBR };
export type { Exterior, Memo };

/* ------------------------------------------------------------------ */

export type SinalLinha = "debito" | "credito";

export type LinhaOfx = {
  /** Id do OFX. É o que impede lançar a mesma compra duas vezes no Omie. */
  fitid: string;
  /**
   * Data ORIGINAL da compra — e não a da fatura. O Sicoob repete a data de
   * origem em toda parcela: a 7ª parcela de uma compra de dezembro chega na
   * fatura de julho ainda datada de dezembro. É o que permite conferir a
   * separação por parcela contra a data.
   */
  data: string;                       // 'YYYY-MM-DD'
  /** Sempre positivo; o sinal do OFX vira `sinal`. */
  valor: number;
  sinal: SinalLinha;
  /** MEMO cru, para auditar tudo o que este módulo inferiu. */
  memo: string;
  /** Nome como a fatura o traz, só limpo de marcador e final de cartão. */
  estabelecimento: string;
  /**
   * Chave de agrupamento — é por ela que o de-para acha a categoria.
   * Funde as variantes do mesmo lojista ("MP*MERCADOLIVREV", "EC *MERCADOLIVREV"
   * e "MERCADOLIVRE*MERCADO" viram MERCADOLIVRE). Ver `chaveDe`.
   */
  chave: string;
  parcela: { n: number; de: number } | null;
  cidade: string | null;
  exterior: Exterior | null;
  /** IOF, anuidade, tarifa: despesa do cartão, não compra de fornecedor. */
  tarifa: boolean;
};

export type FaturaOfx = {
  /** Último dia do ciclo (DTASOF do LEDGERBAL). */
  fechamento: string | null;
  /**
   * 1º dia do mês DA FATURA = mês seguinte ao fechamento. O ciclo que fecha em
   * 30/06 é a fatura de julho — mesma convenção da tabela `cartao_faturas`.
   */
  competencia: string;
  mesLabel: string;
  /**
   * O DTASOF é o último dia do mês, como manda um fim de ciclo?
   *
   * Nem sempre: nos arquivos exportados antes de abr/26 ele traz a data em que o
   * extrato foi GERADO (10/01, 08/03), e aí a fatura de dezembro e a de janeiro
   * são inferidas como o mesmo mês. Falso aqui não invalida o arquivo — invalida
   * o palpite do mês, e quem importa precisa confirmar em vez de descobrir
   * depois que provisionou tudo na competência errada.
   */
  competenciaConfiavel: boolean;
  conta: string | null;               // ACCTID (final do cartão)
  linhas: LinhaOfx[];
};

/* ------------------------------------------------------------------
 * Leitura do SGML
 * ------------------------------------------------------------------ */

/**
 * OFX 1.x é SGML, não XML: em muitos emissores as tags de valor não fecham. O
 * Sicoob fecha, mas ler "do `<TAG>` até o próximo `<` ou fim de linha" funciona
 * nos dois casos e evita depender de um parser de XML que rejeitaria o arquivo.
 *
 * `trimEnd` e não `trim`: no MEMO os espaços da ESQUERDA nunca existem, mas os
 * do meio são o gabarito das colunas e não podem ser tocados.
 */
function campo(bloco: string, tag: string): string | null {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  if (!m) return null;
  const v = m[1].replace(/\s+$/, "");
  return v === "" ? null : v;
}

/** `20260715120000[-3:BRT]` → `2026-07-15`. */
function dataOfx(v: string | null): string | null {
  const m = (v ?? "").match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "2.600,41" → 2600.41 · "5,0297" → 5.0297 */
/* ------------------------------------------------------------------
 * O MEMO
 * ------------------------------------------------------------------ */

/**
 * Gateways e adquirentes que carimbam o próprio nome na frente do lojista.
 * Listados porque a regra de qual lado do `*` é o lojista depende disto:
 * em "MP*MERCADOLIVRE" o lojista está DEPOIS; em "AIRBNB * HMKWDSP", ANTES.
 */
const ADQUIRENTES = new Set([
  "MP", "MLP", "DL", "EBN", "PG", "ZP", "EC", "HTM", "BR1", "PAY",
  "PAYPAL", "ASAAS", "KIWIFY", "VINDI", "MERCADOPAGO", "PAGSEGURO", "SUMUP",
]);

/**
 * Código opaco de pedido/reserva no fim do nome: "328G5F", "VXBS4C", "KLRC2G".
 * Exige letra E dígito juntos, que é o que separa um código de uma palavra do
 * produto — sem isso, "GOOGLE CLOUD" viraria "GOOGLE" e "GOOGLE ADS" também,
 * fundindo infraestrutura com mídia em cima do mesmo de-para.
 */
const CODIGO_OPACO = /^(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,}$/;

const ehTarifa = (nome: string) =>
  /^(IOF|ANUIDADE|DESC ANUIDADE|TARIFA|JUROS|MULTA|ENCARGOS|SEGURO|MENSALIDADE)\b/i.test(nome.trim());

/**
 * Chave de agrupamento do lojista.
 *
 * A fatura escreve o mesmo lojista de várias formas, e o de-para de categoria só
 * é utilizável se elas colapsarem. As três regras, nesta ordem:
 *
 *   1. Tem `*`? O lojista é o lado que NÃO é adquirente:
 *      "MP*MERCADOLIVRE" → MERCADOLIVRE   (MP é adquirente, fica o depois)
 *      "AIRBNB * HMKWDSP" → AIRBNB        (AIRBNB não é, fica o antes)
 *   2. Cauda de código de pedido/reserva: "American Air00150106" → AMERICAN AIR,
 *      "Google CLOUD VXBS4C" → GOOGLE CLOUD. São milhares de códigos únicos para
 *      o mesmo fornecedor — sem cortar, o de-para nunca aprenderia nada.
 *   3. `normalize` para tirar acento, caixa e pontuação.
 *
 * O corte é DELIBERADAMENTE conservador. Fundir demais erra calado (Google Ads,
 * Google Cloud e Google Workspace virariam "GOOGLE" e cairiam todos na mesma
 * rubrica); fundir de menos só custa um de-para a mais, uma vez. Por isso
 * "AZULNRS63R" e "GOOGLE CLOUD XCV", cujos códigos vêm grudados ou sem dígito,
 * continuam com chave própria em vez de arriscar o palpite.
 */
export function chaveDe(nome: string): string {
  let s = limparNome(nome);

  // (1) duas passadas: "DL *UBER*RIDES" tem adquirente em cascata.
  for (let i = 0; i < 2 && s.includes("*"); i++) {
    const corte = s.indexOf("*");
    const antes = s.slice(0, corte).trim();
    const depois = s.slice(corte + 1).trim();
    if (!antes || !depois) { s = antes || depois; break; }
    s = ADQUIRENTES.has(normalize(antes).replace(/ /g, "")) ? depois : antes;
  }

  // (2) dígitos grudados ("Air00150106", "ADS786089") e código opaco solto.
  const corta = (candidato: string) => {
    if (normalize(candidato).length >= 3) s = candidato;
  };
  corta(s.replace(/\d{3,}$/, "").trimEnd());
  const partes = s.split(/\s+/);
  if (partes.length > 1 && CODIGO_OPACO.test(partes[partes.length - 1])) {
    corta(partes.slice(0, -1).join(" "));
  }

  return normalize(s);
}

/* ------------------------------------------------------------------
 * A fatura
 * ------------------------------------------------------------------ */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** '2026-07-01' → 'jul/26' */
export function rotuloMes(iso: string): string {
  const [a, m] = iso.split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
}

/** Soma meses a um 'YYYY-MM-01' sem passar por Date (fuso já nos mordeu antes). */
export function somarMeses(competencia: string, n: number): string {
  const [a, m] = competencia.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export function parseOfx(texto: string): FaturaOfx {
  const fechamento = dataOfx(campo(texto.slice(texto.indexOf("<LEDGERBAL>")), "DTASOF"));
  const conta = campo(texto, "ACCTID");

  // A fatura é o mês SEGUINTE ao fechamento: o ciclo que fecha em 30/06 vence e
  // é lançado em julho. Sem DTASOF não há como inferir — quem chamou decide.
  const competencia = fechamento
    ? somarMeses(`${fechamento.slice(0, 7)}-01`, 1)
    : "";

  const linhas: LinhaOfx[] = [];
  for (const bloco of texto.split(/<STMTTRN>/i).slice(1)) {
    const corpo = bloco.split(/<\/STMTTRN>/i)[0];
    const memo = campo(corpo, "MEMO");
    const data = dataOfx(campo(corpo, "DTPOSTED"));
    const bruto = Number(campo(corpo, "TRNAMT") ?? NaN);
    if (!memo || !data || !Number.isFinite(bruto)) continue;

    const m = lerMemo(memo);
    linhas.push({
      fitid: campo(corpo, "FITID") ?? `${data}-${bruto}-${linhas.length}`,
      data,
      valor: Math.abs(bruto),
      sinal: bruto < 0 ? "debito" : "credito",
      memo,
      estabelecimento: m.estabelecimento,
      chave: chaveDe(m.estabelecimento),
      parcela: m.parcela,
      cidade: m.cidade,
      exterior: m.exterior,
      tarifa: ehTarifa(m.estabelecimento),
    });
  }

  const fimDeMes = fechamento
    ? Number(fechamento.slice(8, 10)) ===
      new Date(Date.UTC(Number(fechamento.slice(0, 4)), Number(fechamento.slice(5, 7)), 0)).getUTCDate()
    : false;

  return {
    fechamento,
    competencia,
    mesLabel: competencia ? rotuloMes(competencia) : "",
    competenciaConfiavel: fimDeMes,
    conta,
    linhas,
  };
}
