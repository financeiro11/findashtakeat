/* ============================================================================
 * O fornecedor desta linha é novo? Gastou mais ou menos que no mês passado?
 *
 * O drill-down da DRE/DFC lista lançamento a lançamento. A pergunta que se faz
 * olhando para a lista, porém, é sobre o FORNECEDOR: "isso já estava aqui mês
 * passado?", "esses R$ 49 mil apareceram agora?". A resposta é o mesmo corte um
 * mês atrás, e quem faz esse corte é a RPC `demonstracoes_contrapartes`.
 *
 * Este módulo só transforma as linhas dela em veredito. Fica separado da tela
 * (e testado) porque as três decisões abaixo são justamente onde um comparativo
 * mente com cara de certeza:
 *
 * 1. SUBIU/CAIU É EM MÓDULO. Despesa vem negativa: -81.194 → -79.450 é um
 *    número MAIOR e um gasto MENOR. Comparar o valor com sinal diria "subiu"
 *    sobre a rubrica que economizou. Comparamos |valor|, e guardamos à parte se
 *    a mudança foi favorável ao caixa — que é o que decide a cor.
 *
 * 2. "NOVO" É UMA AFIRMAÇÃO FORTE. Fornecedor trimestral não é novo, e chamá-lo
 *    de novo faria a tela gritar em todo trimestre. Por isso a janela tem vários
 *    meses: ausente no mês anterior mas presente antes é "voltou", com a data da
 *    última vez. E "novo" vale só dentro da janela pedida — quem escreve o texto
 *    na tela precisa dizer isso.
 *
 * 3. QUEM SUMIU TAMBÉM CONTA. O fornecedor que estava no mês anterior e não está
 *    mais não tem linha nenhuma no drill-down para pendurar um aviso — e é
 *    metade da explicação de uma rubrica que caiu. Ele entra na lista com valor
 *    zero no mês em foco.
 * ========================================================================== */

import { mesAtras, mesCurto } from "@/lib/demonstracoes-schema";

/** Uma linha da RPC `demonstracoes_contrapartes`. */
export type LinhaContraparte = {
  mes: string;
  contraparte: string;
  categoria?: string | null;
  valor: number | string | null;
  lancamentos?: number | null;
  /** `nCodTitulo` dos lançamentos que compõem a linha — o vínculo com a lista. */
  cods?: string[] | null;
};

export type Situacao = "novo" | "voltou" | "subiu" | "caiu" | "igual" | "sumiu";

export type Fornecedor = {
  contraparte: string;
  situacao: Situacao;
  /** Total do fornecedor NESTA rubrica no mês em foco (0 quando sumiu). */
  valor: number;
  lancamentos: number;
  /** Total no mês anterior (0 quando é novo ou voltou). */
  valorAnterior: number;
  lancamentosAnteriores: number;
  /** Quanto pesou a mais (ou a menos), em módulo: "gastou R$ X a mais". */
  delta: number;
  /** delta ÷ |valor anterior|. null quando não havia base — não é 0%, é "não dá". */
  pct: number | null;
  /** A mudança foi boa para o caixa (entrou mais / saiu menos)? Decide a cor. */
  favoravel: boolean;
  /** Mês mais recente, antes do anterior, em que apareceu. Só em "voltou". */
  visto: string | null;
  /** Histórico na janela, para o hover: chave de mês → valor. */
  meses: Record<string, number>;
};

export type Comparativo = {
  mes: string;
  mesAnterior: string;
  /** A janela inteira consultada, do mais recente para o mais antigo. */
  janela: string[];
  /** Todos os fornecedores dos dois meses, do que mais mexeu para o que menos. */
  fornecedores: Fornecedor[];
  /** Vínculo exato: `cod_titulo` do mês em foco → fornecedor. */
  porTitulo: Map<string, Fornecedor>;
  /** Rede de segurança para a linha cujo título não veio na RPC. */
  porContraparte: Map<string, Fornecedor>;
  novos: number;
  sumidos: number;
  /**
   * Existe algum mês anterior com lançamento nesta rubrica?
   *
   * Falso significa "não dá para comparar" — a rubrica começou agora ou o cache
   * do Omie não alcança tão para trás (ele guarda do 1º de janeiro do ano
   * passado em diante). Sem isso, abrir o mês mais antigo do cache carimbaria
   * "novo" em TODOS os fornecedores, que é uma afirmação que os dados não
   * sustentam. Quem desenha a tela usa isto para calar em vez de chutar.
   */
  temHistorico: boolean;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Diferença abaixo de um centavo é o mesmo valor — não é "subiu 0,00". */
const CENTAVO = 0.005;

/**
 * A janela a pedir para a RPC: o mês em foco na frente, depois os `n` anteriores.
 * Ordem decrescente de propósito — é nela que se procura "a última vez que
 * apareceu", parando no primeiro achado.
 */
export function janelaDeMeses(mes: string, n = 12): string[] {
  const antes: string[] = [];
  for (let i = 1; i <= n; i++) {
    const m = mesAtras(mes, i);
    if (!m) break;
    antes.push(m);
  }
  return [mes, ...antes];
}

/**
 * Monta o comparativo de uma rubrica a partir das linhas da RPC.
 *
 * `linhas` pode vir com outras rubricas dentro (a RPC devolve o que foi pedido);
 * filtrar é de quem chama, porque só ele sabe qual rubrica está na tela.
 */
export function montarComparativo(linhas: LinhaContraparte[], mes: string, meses = 12): Comparativo {
  const janela = janelaDeMeses(mes, meses);
  const mesAnterior = janela[1] ?? mes;
  const naJanela = new Set(janela);

  /* Agrupa por fornecedor. O nome é a chave porque é o que a RPC já unificou —
     inclusive o lojista por trás do balde da fatura do cartão. */
  type Acumulado = { meses: Record<string, number>; lancs: Record<string, number>; cods: string[] };
  const porNome = new Map<string, Acumulado>();

  for (const l of linhas) {
    if (!naJanela.has(l.mes)) continue;
    const nome = l.contraparte?.trim() || "Sem contraparte";
    let a = porNome.get(nome);
    if (!a) { a = { meses: {}, lancs: {}, cods: [] }; porNome.set(nome, a); }
    // Soma em vez de atribuir: a RPC devolve uma linha por (contraparte, mês),
    // mas duas grafias que caem no mesmo nome limpo não podem apagar uma à outra.
    a.meses[l.mes] = (a.meses[l.mes] ?? 0) + num(l.valor);
    a.lancs[l.mes] = (a.lancs[l.mes] ?? 0) + num(l.lancamentos);
    if (l.mes === mes) a.cods.push(...(l.cods ?? []));
  }

  const fornecedores: Fornecedor[] = [];
  const porTitulo = new Map<string, Fornecedor>();
  const porContraparte = new Map<string, Fornecedor>();

  for (const [contraparte, a] of porNome) {
    const valor = a.meses[mes] ?? 0;
    const valorAnterior = a.meses[mesAnterior] ?? 0;
    const temAgora = mes in a.meses;
    const temAntes = mesAnterior in a.meses;
    // Só interessa quem está num dos dois meses: quem apareceu apenas lá atrás
    // não explica nem o número de agora nem a variação.
    if (!temAgora && !temAntes) continue;

    const delta = Math.abs(valor) - Math.abs(valorAnterior);

    let situacao: Situacao;
    let visto: string | null = null;
    if (!temAgora) {
      situacao = "sumiu";
    } else if (!temAntes) {
      // Do mês anterior para trás, o primeiro em que apareceu — a janela está
      // em ordem decrescente, então o primeiro achado é o mais recente.
      visto = janela.slice(2).find((m) => m in a.meses) ?? null;
      situacao = visto ? "voltou" : "novo";
    } else {
      situacao = Math.abs(delta) < CENTAVO ? "igual" : delta > 0 ? "subiu" : "caiu";
    }

    const f: Fornecedor = {
      contraparte,
      situacao,
      valor,
      lancamentos: a.lancs[mes] ?? 0,
      valorAnterior,
      lancamentosAnteriores: a.lancs[mesAnterior] ?? 0,
      delta,
      pct: Math.abs(valorAnterior) > CENTAVO ? delta / Math.abs(valorAnterior) : null,
      // Compara COM sinal: para despesa (negativa) gastar menos aumenta o valor.
      favoravel: valor - valorAnterior >= 0,
      visto,
      meses: a.meses,
    };

    fornecedores.push(f);
    porContraparte.set(contraparte, f);
    for (const cod of a.cods) porTitulo.set(String(cod), f);
  }

  // O que mais mexeu primeiro: é a ordem em que se lê "por que a rubrica mudou".
  fornecedores.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  return {
    mes,
    mesAnterior,
    janela,
    fornecedores,
    porTitulo,
    porContraparte,
    novos: fornecedores.filter((f) => f.situacao === "novo").length,
    sumidos: fornecedores.filter((f) => f.situacao === "sumiu").length,
    temHistorico: linhas.some((l) => l.mes !== mes && naJanela.has(l.mes)),
  };
}

/** O rótulo curto do chip. Sem valores — quem formata dinheiro é a tela. */
export function rotuloSituacao(f: Fornecedor): string {
  switch (f.situacao) {
    case "novo":   return "novo";
    case "voltou": return `voltou · ${f.visto ? mesCurto(f.visto) : "—"}`;
    case "sumiu":  return "sumiu";
    case "igual":  return "igual";
    default:       return f.pct == null ? (f.situacao === "subiu" ? "subiu" : "caiu")
                                        : `${f.situacao === "subiu" ? "+" : "−"}${Math.round(Math.abs(f.pct) * 100)}%`;
  }
}

/**
 * A faixa de resumo: "4 fornecedores · 1 novo · 1 sumiu".
 *
 * O total conta quem TEM lançamento no mês em foco — quem sumiu não é
 * fornecedor da rubrica neste mês, é a explicação de um pedaço da queda.
 */
export function resumoComparativo(c: Comparativo): string {
  const nsituacao = (s: string) => c.fornecedores.filter((f) => f.situacao === s).length;
  const total = c.fornecedores.length - c.sumidos;
  const voltaram = nsituacao("voltou");

  const partes = [`${total} ${total === 1 ? "fornecedor" : "fornecedores"}`];
  if (c.novos) partes.push(`${c.novos} ${c.novos === 1 ? "novo" : "novos"}`);
  if (voltaram) partes.push(`${voltaram} ${voltaram === 1 ? "voltou" : "voltaram"}`);
  if (c.sumidos) partes.push(`${c.sumidos} ${c.sumidos === 1 ? "sumiu" : "sumiram"}`);
  return partes.join(" · ");
}

/**
 * A frase inteira, para o hover — é ela que impede o chip de mentir por omissão:
 * o chip resume o FORNECEDOR na rubrica, não a linha em que está pousado.
 */
export function explicarFornecedor(f: Fornecedor, c: Comparativo, moeda: (n: number) => string): string {
  const atual = mesCurto(c.mes);
  const anterior = mesCurto(c.mesAnterior);
  const lanc = (n: number) => `${n} ${n === 1 ? "lançamento" : "lançamentos"}`;

  if (f.situacao === "novo") {
    return `${f.contraparte} não aparece nesta rubrica em nenhum dos ${c.janela.length - 1} meses anteriores. `
      + `${atual}: ${moeda(f.valor)} em ${lanc(f.lancamentos)}.`;
  }
  if (f.situacao === "voltou") {
    return `${f.contraparte} não teve lançamento em ${anterior}; a última vez foi em `
      + `${mesCurto(f.visto as string)} (${moeda(f.meses[f.visto as string])}). `
      + `${atual}: ${moeda(f.valor)} em ${lanc(f.lancamentos)}.`;
  }
  if (f.situacao === "sumiu") {
    return `${f.contraparte} teve ${moeda(f.valorAnterior)} em ${anterior} `
      + `(${lanc(f.lancamentosAnteriores)}) e nenhum lançamento em ${atual}.`;
  }

  const base = `${f.contraparte} nesta rubrica: ${anterior} ${moeda(f.valorAnterior)} → ${atual} ${moeda(f.valor)}`;
  if (f.situacao === "igual") return `${base} — mesmo valor.`;
  const pct = f.pct == null ? "" : ` (${Math.round(Math.abs(f.pct) * 100)}%)`;
  return `${base} — ${f.situacao === "subiu" ? "subiu" : "caiu"} ${moeda(Math.abs(f.delta))}${pct}.`;
}
