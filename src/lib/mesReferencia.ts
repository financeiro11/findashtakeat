/* ============================================================================
 * Qual mês os KPIs do topo estão lendo.
 *
 * Os cartões mostram UM mês e a variação contra o anterior. Escolher esse mês
 * parece trivial e não é: a última coluna da base quase nunca é o mês que a
 * pessoa quer ver.
 *
 * O erro que este módulo existe para não repetir: usar "travado" como sinônimo
 * de "fechado". `demonstracoes_mes_trancado` marca todo mês que veio num import,
 * e o arquivo do tracker traz COLUNAS FUTURAS — Ago/26 chegou com 19 células
 * preenchidas contra 63 de Jul/26 e sem Receita Líquida nenhuma. Travado, sim;
 * fechado, não. Os cartões liam esse mês e mostravam "—" na receita, um EBITDA
 * que era só o SG&A parcial, e um "▲ 79,6%" contra Julho inteiro.
 *
 * A regra aqui é semântica, não um limiar: um mês só tem demonstração para ler
 * se a ÂNCORA dela está preenchida — o TOPO da cascata (ver `ANCORA` abaixo).
 * Entre os meses que passam nesse teste, prefere-se os travados (fechados de
 * verdade, conferidos contra o tracker); se não houver dois, usa-se o que tem.
 * ========================================================================== */

import { DRE_SCHEMA, DFC_SCHEMA, type Node } from "./demonstracoes-schema";

export type LinhaBlob = Record<string, unknown>;

/**
 * A rubrica sem a qual o mês não é legível: o TOPO da cascata de cada
 * demonstração. Não é o total final — "Fluxo de Caixa Operacional" existia em
 * Ago/26 com R$ 394 mil de saídas positivas e nenhuma entrada, resto de um sync
 * parcial do Omie. O topo é o que só aparece quando o mês de fato começou.
 */
const ANCORA: Record<"dre" | "dfc", string> = {
  dre: "Receita Líquida",
  dfc: "Entradas Operacionais",
};

/** Os nomes sob os quais a âncora pode estar gravada (o tracker usa apelidos). */
function nomesDaAncora(tipo: "dre" | "dfc"): string[] {
  const alvo = ANCORA[tipo];
  const achar = (nodes: Node[]): Node | undefined => {
    for (const n of nodes) {
      if (n.label === alvo) return n;
      const dentro = n.children ? achar(n.children) : undefined;
      if (dentro) return dentro;
    }
    return undefined;
  };
  const no = achar(tipo === "dre" ? DRE_SCHEMA : DFC_SCHEMA);
  return [alvo, ...(no?.alias ?? [])];
}

const chave = (s: string) => (s ?? "").trim().toLowerCase();

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export type MesesDeReferencia = {
  /** O mês do número grande. `null` quando não há demonstração nenhuma. */
  lastCol: string | null;
  /** Contra quem a variação é calculada. `null` quando só existe um mês. */
  prevCol: string | null;
};

/**
 * Os dois meses que os KPIs comparam.
 *
 * @param columns  colunas do blob, já em ordem cronológica (com ou sem "Conta")
 * @param rows     linhas do blob
 * @param travados meses fechados por import
 * @param tipo     qual demonstração — define a âncora (ver ANCORA)
 */
export function mesesDeReferencia(
  columns: string[],
  rows: LinhaBlob[],
  travados: Set<string>,
  tipo: "dre" | "dfc",
): MesesDeReferencia {
  const meses = columns.filter((c) => c !== "Conta");
  const nomes = nomesDaAncora(tipo).map(chave);
  const linhasAncora = rows.filter((r) => nomes.includes(chave(String(r["Conta"] ?? ""))));

  /* Filtro duro: sem a âncora não há demonstração. Um mês que o Omie começou a
     preencher tem dezenas de folhas e nenhum topo de cascata — e é justamente
     ele que não pode virar manchete. */
  const comDemonstracao = meses.filter((c) => linhasAncora.some((l) => num(l[c]) !== null));

  /* Entre os legíveis, os fechados são melhores: já foram conferidos contra o
     tracker. Mas só valem se houver DOIS — comparar um mês fechado com um mês
     aberto daria a variação sem sentido que se quer evitar. */
  const fechados = comDemonstracao.filter((c) => travados.has(c));
  const base = fechados.length >= 2 ? fechados : comDemonstracao;

  return {
    lastCol: base[base.length - 1] ?? null,
    prevCol: base.length >= 2 ? base[base.length - 2] : null,
  };
}
