/* ============================================================================
 * Trocar a categoria de VÁRIOS lançamentos de uma vez.
 *
 * O erro de classificação quase nunca é de um lançamento só: a assinatura do
 * Claude caiu seis vezes em "Softwares - Administrativo" no mesmo mês, e o
 * Datadog, seis. Corrigir um por um é o mesmo clique repetido — e é onde a
 * pessoa desiste no meio e deixa a rubrica pela metade.
 *
 * O lote é um LAÇO NO CLIENTE sobre a mesma Edge Function de sempre
 * (`omie-trocar-categoria`), não uma função nova no servidor. Três razões:
 *
 *   1. A API do Omie recusa chamadas simultâneas do mesmo método — o lote seria
 *      sequencial de qualquer jeito. Uma função em lote no servidor só mudaria
 *      ONDE o laço roda, e cobraria uma segunda cópia da regra (alterar no ERP →
 *      confirmar → espelhar no cache → gravar trilha) que hoje existe uma vez só.
 *   2. Cada título vira um resultado próprio, com o texto de recusa do ERP. Em
 *      lote no servidor a pessoa receberia "6 falharam" sem saber de quê.
 *   3. O que já foi alterado está alterado. Fechar o painel no meio não desfaz
 *      nada, e a tela precisa poder dizer isso — este módulo devolve o
 *      resultado de cada item, sempre, inclusive quando para no meio.
 *
 * A regra mais importante daqui é a PARADA POR RECUSA REPETIDA: quando o ERP diz
 * três vezes seguidas a mesma coisa ("período contábil fechado"), a quarta não
 * vai ser diferente. Insistir em 40 títulos gasta minutos de API para produzir
 * 40 cópias do mesmo erro.
 * ========================================================================== */

/** `cGrupo` do movimento. Só título financeiro de verdade tem categoria própria. */
const GRUPOS_ALTERAVEIS = new Set(["CONTA_A_PAGAR", "CONTA_A_RECEBER"]);

/**
 * Este lançamento pode ter a categoria trocada?
 *
 * Espelha `CADASTRO` de `supabase/functions/_shared/omie.ts` — o servidor recusa
 * o resto de qualquer jeito. A cópia aqui existe para a tela não OFERECER o que
 * vai ser recusado: previsão de OS/contrato (a categoria mora no documento de
 * origem) e perna bancária (não tem classificação própria).
 */
export const podeTrocarCategoria = (grupo: string | null | undefined): boolean =>
  !!grupo && GRUPOS_ALTERAVEIS.has(grupo);

export const motivoNaoAlteravel = (grupo: string | null | undefined): string =>
  grupo?.startsWith("PREVISAO")
    ? "Previsão gerada por ordem de serviço/contrato: a categoria vem do documento de origem."
    : grupo?.startsWith("CONTA_CORRENTE")
      ? "Perna bancária de um título — não tem classificação própria."
      : "Este lançamento não tem categoria alterável pelo Hub.";

export type ItemLote = {
  codTitulo: string;
  contraparte: string | null;
  valor: number | null;
  categoriaCodigo: string | null;
  categoriaDescricao: string | null;
};

export type ResultadoItem = {
  item: ItemLote;
  ok: boolean;
  /** Texto de recusa do ERP, tal como veio — é o que a pessoa precisa ler. */
  erro?: string;
  /** O Omie já estava na categoria de destino; só o Hub estava atrasado. */
  jaEstava?: boolean;
};

export type ResultadoLote = {
  resultados: ResultadoItem[];
  /** Quem nem chegou a ser tentado, porque o laço parou antes. */
  naoTentados: ItemLote[];
  /** Mensagem que se repetiu e fez o laço parar, quando foi o caso. */
  interrompidoPor: string | null;
  /** A pessoa mandou parar. */
  cancelado: boolean;
};

/** Recusas iguais seguidas que bastam para desistir do resto. */
export const RECUSAS_ATE_DESISTIR = 3;

const mesmaRecusa = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Roda a troca item a item, em ordem, sem sobreposição.
 *
 * `trocar` é injetado (na tela, é o `functions.invoke`) para esta regra poder
 * ser testada sem rede — e para que o laço não saiba nada sobre HTTP.
 */
export async function trocarEmLote(
  itens: ItemLote[],
  trocar: (item: ItemLote) => Promise<{ ok: boolean; erro?: string; jaEstava?: boolean }>,
  opts: {
    onProgresso?: (feitos: number, total: number, ultimo: ResultadoItem) => void;
    /** Consultado antes de cada item: a parada respeita o que já começou. */
    cancelado?: () => boolean;
  } = {},
): Promise<ResultadoLote> {
  const resultados: ResultadoItem[] = [];
  let interrompidoPor: string | null = null;
  let cancelado = false;
  let i = 0;

  for (; i < itens.length; i++) {
    if (opts.cancelado?.()) { cancelado = true; break; }

    const item = itens[i];
    let r: ResultadoItem;
    try {
      const resposta = await trocar(item);
      r = { item, ok: resposta.ok, erro: resposta.erro, jaEstava: resposta.jaEstava };
    } catch (e) {
      // Rede caiu, função morreu: é falha DESTE item, não do lote. O laço segue
      // e a lista de resultados conta a história inteira no fim.
      r = { item, ok: false, erro: e instanceof Error ? e.message : String(e) };
    }

    resultados.push(r);
    opts.onProgresso?.(resultados.length, itens.length, r);

    // Três recusas iguais em sequência: o ERP não está discordando deste título,
    // está discordando de todos. Só vale como interrupção se ainda houver o que
    // pular — a trinca no ÚLTIMO item não interrompeu nada, e dizer que
    // interrompeu faria a tela inventar um "resto" que não existe.
    const ultimas = resultados.slice(-RECUSAS_ATE_DESISTIR);
    const desistir =
      ultimas.length === RECUSAS_ATE_DESISTIR &&
      ultimas.every((x) => !x.ok) &&
      ultimas.every((x) => mesmaRecusa(x.erro, ultimas[0].erro));
    if (desistir && i + 1 < itens.length) {
      interrompidoPor = ultimas[0].erro ?? "recusa repetida";
      i++;
      break;
    }
  }

  return { resultados, naoTentados: itens.slice(i), interrompidoPor, cancelado };
}

/** Contagem para o toast e para a faixa de resultado. */
export function resumoLote(r: ResultadoLote) {
  const ok = r.resultados.filter((x) => x.ok).length;
  const falhas = r.resultados.filter((x) => !x.ok);
  return {
    ok,
    falhas: falhas.length,
    naoTentados: r.naoTentados.length,
    /** Uma linha, no tom de quem tem que decidir o que fazer agora. */
    frase:
      ok && !falhas.length && !r.naoTentados.length
        ? `${ok} ${ok === 1 ? "lançamento alterado" : "lançamentos alterados"} no Omie.`
        : ok
          ? `${ok} ${ok === 1 ? "alterado" : "alterados"}, ${falhas.length} recusado(s)` +
            (r.naoTentados.length ? `, ${r.naoTentados.length} não tentado(s).` : ".")
          : `Nenhum lançamento foi alterado — ${falhas.length} recusado(s)` +
            (r.naoTentados.length ? `, ${r.naoTentados.length} não tentado(s).` : "."),
  };
}

/** As categorias de origem da seleção, para a confirmação dizer o "de". */
export function categoriasDaSelecao(itens: ItemLote[]): { codigo: string; descricao: string; n: number }[] {
  const m = new Map<string, { codigo: string; descricao: string; n: number }>();
  for (const it of itens) {
    const codigo = it.categoriaCodigo ?? "—";
    const c = m.get(codigo) ?? { codigo, descricao: it.categoriaDescricao ?? codigo, n: 0 };
    c.n++;
    m.set(codigo, c);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
