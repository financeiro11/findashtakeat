/* ============================================================================
 * Revisão do Mês — a conta por trás da reunião de tracker com o CEO.
 *
 * Tudo aqui é função pura sobre os blobs que a DRE e a DFC já carregam, mais o
 * BP do ano. O componente `pages/RevisaoMes.tsx` só busca dado e desenha, e a
 * edge function `demonstracoes-revisao` recebe o resultado pronto para redigir.
 *
 * QUATRO DECISÕES QUE MOLDAM O ARQUIVO INTEIRO:
 *
 *  1. A UNIDADE DE MEDIDA É O EBITDA. Cada rubrica entra pelo que ela FEZ com o
 *     resultado, não pelo tamanho do próprio desvio: receita abaixo do plano e
 *     despesa acima do plano são as duas coisas ruins, e precisam somar na mesma
 *     direção para o Pareto significar alguma coisa. Por isso `impacto` é
 *     `real − orçado` na receita e `orçado − real` na despesa — em ambos,
 *     negativo = tirou do EBITDA.
 *
 *  2. TRÊS NATUREZAS, NÃO DUAS. Receita sai em módulo, despesa sai como
 *     magnitude positiva, e RESULTADO (Receita Líquida, Margem de contribuição,
 *     EBITDA) sai COM SINAL. Sem a terceira, o EBITDA de −184,6 mil viraria
 *     +184,6 mil no `Math.abs` da receita e a reunião inteira leria um mês
 *     lucrativo que não existiu.
 *
 *  3. A CONTA É A MESMA DA TELA DA DRE. `lerDre` (analisesDre) traz a regra do
 *     pai = soma dos filhos e a descoberta do sinal do mês, que são o que faz o
 *     número daqui bater com o número que está à vista na grade. A DFC tem
 *     leitor próprio (`lerDfc`), porque o esquema é outro e o sinal dela é o do
 *     fluxo, não o da despesa.
 *
 *  4. O QUE NÃO FECHA APARECE. A soma dos impactos das rubricas raramente bate
 *     exatamente o gap do EBITDA — o BP tem rubrica que a DRE não tem, e
 *     vice-versa. Esse resto sai em `residuo` e vai para a tela, em vez de ser
 *     diluído numa barra "outros", que é o jeito de nunca descobrir.
 *
 * O que este módulo NÃO faz: escrever. Impacto em português, ação sugerida e
 * veredicto são redação, e vivem na edge function — aqui só sai o sinal.
 * ========================================================================== */

import {
  DRE_SCHEMA, DFC_SCHEMA, indexarCelulas, parseColuna, type Node,
} from "@/lib/demonstracoes-schema";
import {
  lerDre, fluxoLivreDaDfc, rotuloMes, calcularRunway,
  RL, EBITDA, SGA, CUSTOS_OP,
  type Leitor, type LinhaBlob, type Runway,
} from "@/lib/analisesDre";
import { normLabel, type BpAnual } from "@/lib/bpAnual";

export { rotuloMes };
export type { Leitor, LinhaBlob };

/** `(rubrica, "Jul-26") → valor do plano`. */
export type Plano = (label: string, col: string) => number | null;

/** Como a rubrica se comporta na conta do resultado. Ver a decisão 2 no topo. */
export type Natureza = "receita" | "despesa" | "resultado";

/* ------------------------------------------------------------------ *
 *  A espinha da DRE — as linhas que a reunião lê em voz alta
 * ------------------------------------------------------------------ */

export const RECEITA_BRUTA = "Receita Bruta";
export const RECEITA_RECORRENTE = "Receita Recorrente";
export const RECEITA_SPOT = "Receita Spot";
export const DEDUCOES = "(-) Deduções da receita";
export const MARGEM_CONTRIB = "Margem de contribuição";
export const PESSOAL = "Pessoal";
export const ADM = "Despesas Administrativas";
export const MKT = "Despesas Marketing & Vendas";

/** Ordem fixa: é a cascata do resultado, e ela não é alfabética. */
const ESPINHA: { label: string; nivel: 0 | 1; natureza: Natureza; total?: boolean }[] = [
  { label: RECEITA_BRUTA, nivel: 0, natureza: "receita" },
  { label: RECEITA_RECORRENTE, nivel: 1, natureza: "receita" },
  { label: RECEITA_SPOT, nivel: 1, natureza: "receita" },
  { label: DEDUCOES, nivel: 0, natureza: "despesa" },
  { label: RL, nivel: 0, natureza: "resultado", total: true },
  { label: CUSTOS_OP, nivel: 0, natureza: "despesa" },
  { label: MARGEM_CONTRIB, nivel: 0, natureza: "resultado", total: true },
  { label: SGA, nivel: 0, natureza: "despesa" },
  { label: PESSOAL, nivel: 1, natureza: "despesa" },
  { label: ADM, nivel: 1, natureza: "despesa" },
  { label: MKT, nivel: 1, natureza: "despesa" },
  { label: EBITDA, nivel: 0, natureza: "resultado", total: true },
];

/**
 * Os sete blocos que PARTICIONAM o EBITDA.
 *
 * EBITDA = (Recorrente + Spot) − Deduções − Custos Operacionais
 *          − Pessoal − Adm − Marketing. Nenhum real entra duas vezes e nenhum
 * fica de fora — é o que permite ao Pareto somar 100% e é o que faz o `residuo`
 * significar "a DRE ganhou linha fora do esquema", e não "a conta está torta".
 */
const BLOCOS: { label: string; natureza: Natureza }[] = [
  { label: RECEITA_RECORRENTE, natureza: "receita" },
  { label: RECEITA_SPOT, natureza: "receita" },
  { label: DEDUCOES, natureza: "despesa" },
  { label: CUSTOS_OP, natureza: "despesa" },
  { label: PESSOAL, natureza: "despesa" },
  { label: ADM, natureza: "despesa" },
  { label: MKT, natureza: "despesa" },
];

/** Granularidade do Pareto: os sete blocos, ou as rubricas dentro deles. */
export type Detalhe = "bloco" | "rubrica";

function acharNo(nodes: Node[], label: string): Node | null {
  const alvo = label.toLowerCase();
  for (const n of nodes) {
    if (n.label.toLowerCase() === alvo) return n;
    const dentro = n.children ? acharNo(n.children, label) : null;
    if (dentro) return dentro;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  O plano: como a rubrica da DRE se chama no BP
 * ------------------------------------------------------------------ */

/**
 * De-para DRE → planilha do BP, para as rubricas em que os dois divergem.
 *
 * A planilha da diretoria tem plano de contas próprio, com numeração de tópico
 * ("3.5.Infraestrutura") e nomes no singular. Onde o nome bate, não há entrada
 * aqui — a lista é só o que diverge.
 */
export const APELIDOS_BP: Record<string, string> = {
  [RECEITA_BRUTA]: "Receita",
  "Receita Recorrente": "Receita Recorrente Assinaturas",
  "Receita Spot": "Receitas Spot",
  [CUSTOS_OP]: "Custo Operacional",
  "Premiações Operacionais": "Premiação Operacional",
  Servidor: "Infraestrutura",
  "Viagens & Transportes Adm": "Viagens & Transportes",
};

const EN_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * O plano de uma rubrica da DRE, por CASAMENTO EXATO do rótulo normalizado.
 *
 * Existe em vez de `planoPorColuna` (lib/bpAnual) porque o `bestKey` dele é
 * aproximado, e aproximado aqui não é "um pouco errado": é errado com cara de
 * certo. Neste BP, "receita recorrente" casava com a linha "1.Receita" — o
 * desempate do `bestKey` é a diferença de comprimento, e "receita" (7) está mais
 * perto de "receita recorrente" (18) do que "receita recorrente assinaturas"
 * (30). O plano da recorrência saía sendo o da receita TOTAL, cinco vezes maior,
 * e o Pareto declarava a maior rubrica da empresa como o maior ofensor do mês
 * todo mês. "Custos operacionais" (plural) não casava com "custo operacional" e
 * sumia da conta sem avisar.
 *
 * Aqui é exato ou nulo. Rubrica que o BP não tem sai como "sem plano" e vai
 * publicada na tela — o que é uma informação de verdade sobre o plano de contas,
 * e não um número inventado.
 */
export function planoDaDre(porAno: Map<number, BpAnual>): Plano {
  const cache = new Map<string, number | null>();
  return (label, col) => {
    const m = /^([A-Za-z]{3})-(\d{2})$/.exec(col ?? "");
    if (!m) return null;
    const chaveCache = `${label}|${col}`;
    if (cache.has(chaveCache)) return cache.get(chaveCache) ?? null;

    const ano = 2000 + parseInt(m[2], 10);
    const bp = porAno.get(ano);
    const mes = EN_ORDER.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
    let valor: number | null = null;
    if (bp && !bp.vazio && mes >= 0) {
      const chave = normLabel(APELIDOS_BP[label] ?? label);
      valor = bp.porRubrica[chave]?.[mes] ?? null;
    }
    cache.set(chaveCache, valor);
    return valor;
  };
}

export type RubricaDoPareto = { rubrica: string; bloco: string; natureza: Natureza };

/** As rubricas que o Pareto ranqueia, cada uma sabendo de que bloco desceu. */
export function rubricasDoPareto(detalhe: Detalhe): RubricaDoPareto[] {
  const out: RubricaDoPareto[] = [];
  for (const b of BLOCOS) {
    const no = acharNo(DRE_SCHEMA, b.label);
    const filhos = detalhe === "rubrica" ? (no?.children ?? []) : [];
    if (!filhos.length) {
      out.push({ rubrica: b.label, bloco: b.label, natureza: b.natureza });
      continue;
    }
    for (const f of filhos) out.push({ rubrica: f.label, bloco: b.label, natureza: b.natureza });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Confronto: uma rubrica contra o plano e contra o mês anterior
 * ------------------------------------------------------------------ */

export type Confronto = {
  rubrica: string;
  natureza: Natureza;
  realizado: number | null;
  orcado: number | null;
  anterior: number | null;
  /** Efeito no EBITDA. Negativo = tirou do resultado, em receita ou em despesa. */
  impacto: number | null;
  /**
   * Desvio contra o plano em %, na convenção de quem lê: em despesa, positivo
   * quer dizer "gastou mais". Em receita, positivo quer dizer "vendeu mais".
   */
  desvioPct: number | null;
  /** A mesma convenção, contra o mês anterior. */
  mom: number | null;
};

/**
 * Realizado, orçado e as duas variações de UMA rubrica.
 *
 * O plano de receita e de despesa vem em MÓDULO: a planilha da diretoria
 * escreve despesa ora negativa, ora positiva, e o sinal dela não é informação.
 * Já o plano de resultado vem com sinal — um EBITDA orçado de −142 mil não é
 * um EBITDA orçado de +142 mil.
 */
export function confrontar(
  leitor: Leitor,
  plano: Plano | null,
  rubrica: string,
  natureza: Natureza,
  mes: string,
  mesAnterior: string | null,
  /** Sobrescreve a leitura do plano (o EBITDA do BP vem de `ebitdaDoPlano`). */
  orcadoDireto?: number | null,
): Confronto {
  const ler = (col: string): number | null =>
    natureza === "receita" ? leitor.receita(rubrica, col)
    : natureza === "despesa" ? leitor.custo(rubrica, col)
    : leitor.bruto(rubrica, col);

  const realizado = ler(mes);
  const anterior = mesAnterior ? ler(mesAnterior) : null;

  let orcado: number | null;
  if (orcadoDireto !== undefined) {
    orcado = orcadoDireto;
  } else {
    const cru = plano ? plano(rubrica, mes) : null;
    orcado = cru == null ? null : (natureza === "resultado" ? cru : Math.abs(cru));
  }

  const variacao = (base: number | null): number | null => {
    if (realizado == null || base == null || base === 0) return null;
    return (realizado - base) / Math.abs(base);
  };

  const impacto =
    realizado == null || orcado == null
      ? null
      : natureza === "despesa"
        ? orcado - realizado
        : realizado - orcado;

  return {
    rubrica,
    natureza,
    realizado,
    orcado,
    anterior,
    impacto,
    desvioPct: variacao(orcado),
    mom: variacao(anterior),
  };
}

export type LinhaEspinha = Confronto & { nivel: 0 | 1; total: boolean };

/**
 * A tabela "DRE vs. orçado" do bloco 2.
 *
 * As três linhas de total não têm filhos no esquema, então saem da própria linha
 * do blob — a mesma coisa que a grade da DRE mostra. Em mês travado isso é o
 * número do tracker; em mês destravado pode estar atrás das folhas, e a tela
 * avisa em vez de corrigir por conta própria (corrigir aqui faria a Revisão
 * divergir da DRE, que é o único jeito de nenhuma das duas ser confiável).
 */
export function espinhaDre(
  leitor: Leitor,
  plano: Plano | null,
  mes: string,
  mesAnterior: string | null,
): LinhaEspinha[] {
  return ESPINHA.map((e) => {
    const c = confrontar(
      leitor, plano, e.label, e.natureza, mes, mesAnterior,
      e.label === EBITDA ? ebitdaDoPlano(plano, mes) : undefined,
    );
    return { ...c, nivel: e.nivel, total: !!e.total };
  });
}

/* ------------------------------------------------------------------ *
 *  EBITDA do plano
 * ------------------------------------------------------------------ */

/**
 * O BP nem sempre traz a linha pronta; quando não traz, ela sai da própria
 * estrutura do plano (receita líquida − custos − SG&A), que é como a DRE a
 * define. Mesma queda de `Analises`, e pelo mesmo motivo: sem ela a comparação
 * inteira do bloco fica em branco justamente na linha que a reunião discute.
 */
export function ebitdaDoPlano(plano: Plano | null, mes: string): number | null {
  if (!plano) return null;
  const direto = plano(EBITDA, mes);
  if (direto != null) return direto;
  const rl = plano(RL, mes);
  const custos = plano(CUSTOS_OP, mes);
  const sga = plano(SGA, mes);
  if (rl == null && custos == null && sga == null) return null;
  return Math.abs(rl ?? 0) - Math.abs(custos ?? 0) - Math.abs(sga ?? 0);
}

/* ------------------------------------------------------------------ *
 *  Cascata do resultado
 * ------------------------------------------------------------------ */

export type DegrauCascata = {
  rubrica: string;
  /** Com o sinal do EFEITO: receita soma, despesa desce. */
  valor: number;
  orcado: number | null;
  /** A barra vai de `base` a `base + valor`. */
  base: number;
  /** Barras de total (Receita Bruta e EBITDA) partem do zero. */
  total: boolean;
};

/**
 * Da receita bruta ao EBITDA, um degrau por bloco.
 *
 * Desenhada como FAIXA [de, até] e não como pilha, pelo mesmo motivo da ponte da
 * aba Análises: empilhamento joga negativo para baixo do zero e um mês de EBITDA
 * negativo — que é o caso da Takeat — desmontaria a cascata.
 */
export function cascata(leitor: Leitor, plano: Plano | null, mes: string): DegrauCascata[] {
  const receitaBruta = leitor.receita(RECEITA_BRUTA, mes) ?? 0;
  const receitaOrcada = plano ? plano(RECEITA_BRUTA, mes) : null;

  const out: DegrauCascata[] = [{
    rubrica: RECEITA_BRUTA,
    valor: receitaBruta,
    orcado: receitaOrcada == null ? null : Math.abs(receitaOrcada),
    base: 0,
    total: true,
  }];

  let base = receitaBruta;
  for (const label of [DEDUCOES, CUSTOS_OP, PESSOAL, ADM, MKT]) {
    const custo = leitor.custo(label, mes) ?? 0;
    const orc = plano ? plano(label, mes) : null;
    out.push({
      rubrica: label,
      valor: -custo,
      orcado: orc == null ? null : -Math.abs(orc),
      base,
      total: false,
    });
    base -= custo;
  }

  /* O EBITDA vem da linha da DRE (o mesmo número da grade), e não do fim da
     cascata: quando os dois divergem, a diferença é justamente o que o esquema
     não cobre, e ela aparece no `residuo` do Pareto — não escondida aqui. */
  const ebitda = leitor.bruto(EBITDA, mes) ?? base;
  out.push({
    rubrica: EBITDA,
    valor: ebitda,
    orcado: ebitdaDoPlano(plano, mes),
    base: 0,
    total: true,
  });
  return out;
}

/* ------------------------------------------------------------------ *
 *  Pareto do desvio
 * ------------------------------------------------------------------ */

export type PontoHistorico = {
  mes: string;
  rotulo: string;
  realizado: number | null;
  orcado: number | null;
  impacto: number | null;
};

export type Ofensor = Confronto & {
  posicao: number;
  bloco: string;
  /** |impacto| sobre o total do mesmo lado (desfavorável ou favorável). */
  fatia: number;
  /** Acumulado do Pareto até esta linha, de 0 a 1. */
  acumulado: number;
  /**
   * Em quantos dos meses fechados anteriores esta rubrica também ficou do lado
   * ruim do plano. É o sinal determinístico de "isto se repete" — a IA usa para
   * separar desvio recorrente de evento pontual, mas quem CONTA é o código.
   */
  mesesRuins: number;
  mesesConferidos: number;
  historico: PontoHistorico[];
};

export type Pareto = {
  detalhe: Detalhe;
  /** Soma, em módulo, dos impactos negativos. */
  desfavoravel: number;
  /** Soma dos impactos positivos. */
  favoravel: number;
  ofensores: Ofensor[];
  amortecedores: Ofensor[];
  /** Rubricas com realizado mas sem plano no BP — publicadas, não silenciadas. */
  semPlano: string[];
  /** Gap do EBITDA (real − plano) e o que a decomposição não explicou. */
  gapEbitda: number | null;
  residuo: number | null;
  corte: number;
};

/** Quantos meses de histórico entram na faixa e na contagem de repetição. */
export const JANELA_HISTORICO = 4;

/**
 * Ranqueia as rubricas pelo estrago (e pelo socorro) que fizeram no EBITDA.
 *
 * `corte` é o acumulado em que a lista para de merecer parágrafo (0,8 = as
 * rubricas que explicam 80% do desvio). Ele não descarta nada: só marca até onde
 * a leitura detalhada vai — o resto continua somando e continua na tela, numa
 * linha só. Esconder a cauda seria transformar "80% do desvio" em "o desvio".
 */
export function pareto(opts: {
  leitor: Leitor;
  plano: Plano | null;
  mes: string;
  mesAnterior: string | null;
  /** Meses fechados, do mais antigo ao mais recente, incluindo `mes`. */
  mesesFechados: string[];
  detalhe: Detalhe;
  corte?: number;
}): Pareto {
  const { leitor, plano, mes, mesAnterior, mesesFechados, detalhe } = opts;
  const corte = opts.corte ?? 0.8;

  const semPlano: string[] = [];
  const confrontos = rubricasDoPareto(detalhe).map((r) => {
    const c = confrontar(leitor, plano, r.rubrica, r.natureza, mes, mesAnterior);
    if (c.orcado == null && c.realizado != null) semPlano.push(r.rubrica);
    return { ...c, bloco: r.bloco };
  });

  /* Histórico: os meses fechados ANTES deste, limitados à janela. Sem o corte,
     uma janela de 30 meses faria "12 de 30" parecer eventual — a pergunta da
     reunião é sobre o passado recente. */
  const anteriores = mesesFechados.filter((m) => m !== mes);
  const janela = anteriores.slice(-(JANELA_HISTORICO - 1));

  const enriquecer = (c: (typeof confrontos)[number]) => {
    let mesesRuins = 0;
    let mesesConferidos = 0;
    const historico: PontoHistorico[] = [...janela, mes].map((m) => {
      const h = m === mes
        ? c
        : confrontar(leitor, plano, c.rubrica, c.natureza, m, null);
      if (m !== mes && h.impacto != null) {
        mesesConferidos++;
        if (h.impacto < 0) mesesRuins++;
      }
      return { mes: m, rotulo: rotuloMes(m), realizado: h.realizado, orcado: h.orcado, impacto: h.impacto };
    });
    return { ...c, mesesRuins, mesesConferidos, historico };
  };

  const comImpacto = confrontos.filter((c) => c.impacto != null);
  const negativos = comImpacto
    .filter((c) => (c.impacto as number) < 0)
    .sort((a, b) => (a.impacto as number) - (b.impacto as number));
  const positivos = comImpacto
    .filter((c) => (c.impacto as number) > 0)
    .sort((a, b) => (b.impacto as number) - (a.impacto as number));

  const desfavoravel = negativos.reduce((s, c) => s + Math.abs(c.impacto as number), 0);
  const favoravel = positivos.reduce((s, c) => s + (c.impacto as number), 0);

  const montar = (lista: typeof negativos, total: number): Ofensor[] => {
    let acc = 0;
    return lista.map((c, i) => {
      const fatia = total > 0 ? Math.abs(c.impacto as number) / total : 0;
      acc += fatia;
      return { ...enriquecer(c), posicao: i + 1, fatia, acumulado: acc };
    });
  };

  const ofensores = montar(negativos, desfavoravel);
  const amortecedores = montar(positivos, favoravel);

  const ebitdaReal = leitor.bruto(EBITDA, mes);
  const ebitdaPlano = ebitdaDoPlano(plano, mes);
  const gapEbitda = ebitdaReal == null || ebitdaPlano == null ? null : ebitdaReal - ebitdaPlano;

  return {
    detalhe,
    desfavoravel,
    favoravel,
    ofensores,
    amortecedores,
    semPlano,
    gapEbitda,
    residuo: gapEbitda == null ? null : gapEbitda - (favoravel - desfavoravel),
    corte,
  };
}

/** Quantos ofensores ficam acima do corte (pelo menos um, quando houver). */
export function acimaDoCorte(ofensores: Ofensor[], corte: number): number {
  if (!ofensores.length) return 0;
  const i = ofensores.findIndex((o) => o.acumulado >= corte);
  return i < 0 ? ofensores.length : i + 1;
}

/* ------------------------------------------------------------------ *
 *  Caixa — o bloco 4
 * ------------------------------------------------------------------ */

/**
 * Leitor do blob da DFC.
 *
 * Separado do da DRE de propósito: o esquema é outro (`DFC_SCHEMA`) e o sinal
 * também. Aqui não existe "descobrir se a planilha grava despesa negativa" — a
 * DFC grava SAÍDA negativa por definição, e é somando que a coluna fecha na
 * variação do caixa. Usar o `lerDre` aqui devolvia a linha-pai crua do blob,
 * que quase nunca está preenchida, e o bloco inteiro saía em branco.
 */
export function lerDfc(rows: LinhaBlob[], columns: string[]) {
  const celulas = indexarCelulas(rows as Record<string, unknown>[], columns);
  const val = (label: string, col: string): number | null =>
    celulas.get(label.toLowerCase())?.[col] ?? null;

  const somaFilhos = (node: Node, col: string): number | null => {
    if (!node.children?.length) return val(node.src ?? node.label, col);
    let total: number | null = null;
    for (const f of node.children) {
      const v = somaFilhos(f, col);
      if (v != null) total = (total ?? 0) + v;
    }
    return total ?? val(node.src ?? node.label, col);
  };

  return (label: string, col: string): number | null => {
    const no = acharNo(DFC_SCHEMA, label);
    return no ? somaFilhos(no, col) : val(label, col);
  };
}

export type LinhaDfc = {
  rubrica: string;
  nivel: 0 | 1;
  realizado: number | null;
  orcado: number | null;
  /** Linha de bloco (FCO/FCI/FCF/livre) — destacada na tabela. */
  bloco: boolean;
};

export type BlocoCaixa = {
  /** Saldo consolidado do Omie. É a foto de HOJE, não o fechamento do mês. */
  saldo: number | null;
  saldoEm: string | null;
  linhas: LinhaDfc[];
  fco: number | null;
  fcoOrcado: number | null;
  fci: number | null;
  fcf: number | null;
  livre: number | null;
  livreOrcado: number | null;
  /** Os mesmos dois no mês anterior, para o KPI do Resumo comparar. */
  fcoAnterior: number | null;
  livreAnterior: number | null;
  /** Média dos últimos três meses fechados de fluxo livre (positiva = queima). */
  burn3m: number | null;
  runway: Runway | null;
};

/* Rubrica da DFC → rótulo da seção "Fluxo de Caixa" do BP, já como
   `parsearPlano` normaliza ("(+) Entradas" → "entradas"). Casamento exato, pelo
   mesmo motivo do `planoDaDre`: a seção repete os rótulos da DRE inteira, e uma
   busca aproximada acharia "Receita Recorrente Assinaturas" para "Entradas". */
const DFC_PLANO: Record<string, string[]> = {
  "Entradas Operacionais": ["entradas"],
  "Saídas Operacionais": ["saidas"],
  "Fluxo de Caixa Operacional": ["fluxo de caixa operacional"],
  Investimentos: ["fluxo de caixa de investimentos"],
  Financiamento: ["fluxo de financiamento"],
  "Fluxo Livre": ["fluxo de caixa livre"],
};

/**
 * O bloco de caixa: a DFC do mês, o fluxo livre e o runway.
 *
 * NÃO tem saldo de fechamento do mês, e é de propósito. O Omie devolve a foto do
 * saldo de HOJE; reconstituir o de 31/jul andando para trás pelos fluxos livres
 * somaria três aproximações para produzir um número que passaria por extrato.
 * Melhor dizer o saldo que existe, com a data dele, e pôr o fluxo do mês ao lado.
 */
export function blocoCaixa(opts: {
  dfcRows: LinhaBlob[];
  dfcColumns: string[];
  /** Linhas da seção "Fluxo de Caixa" do BP (`parsearPlano(...).dfc`). */
  planoDfc: { chave: string; meses: (number | null)[] }[];
  mes: string;
  /** O mês fechado imediatamente anterior, para o comparativo do Resumo. */
  mesAnterior?: string | null;
  mesesFechados: string[];
  saldo: number | null;
  saldoEm: string | null;
}): BlocoCaixa {
  const { dfcRows, dfcColumns, planoDfc, mes, mesAnterior, mesesFechados, saldo, saldoEm } = opts;
  const ler = lerDfc(dfcRows, dfcColumns);
  const c = parseColuna(mes);

  const doPlano = (rubrica: string): number | null => {
    if (!c) return null;
    for (const chave of DFC_PLANO[rubrica] ?? []) {
      const linha = planoDfc.find((l) => l.chave === chave);
      const v = linha?.meses[c.mes - 1];
      if (v != null) return v;
    }
    return null;
  };

  /** FCO e fluxo livre de qualquer mês — o do foco e o anterior usam a mesma conta. */
  const fluxosDe = (col: string) => {
    const entradas = ler("Entradas Operacionais", col);
    const saidas = ler("Saídas Operacionais", col);
    const fco = entradas == null && saidas == null ? null : (entradas ?? 0) + (saidas ?? 0);
    const fci = ler("Investimentos", col);
    const fcf = ler("Financiamento", col);
    return { entradas, saidas, fco, fci, fcf, livre: fco == null ? null : fco + (fci ?? 0) + (fcf ?? 0) };
  };

  const { entradas, saidas, fco, fci, fcf, livre } = fluxosDe(mes);
  const anterior = mesAnterior ? fluxosDe(mesAnterior) : null;

  const linhas: LinhaDfc[] = [
    { rubrica: "Entradas operacionais", nivel: 1, realizado: entradas, orcado: doPlano("Entradas Operacionais"), bloco: false },
    { rubrica: "Saídas operacionais", nivel: 1, realizado: saidas, orcado: doPlano("Saídas Operacionais"), bloco: false },
    { rubrica: "FCO · operacional", nivel: 0, realizado: fco, orcado: doPlano("Fluxo de Caixa Operacional"), bloco: true },
    { rubrica: "FCI · investimento", nivel: 0, realizado: fci, orcado: doPlano("Investimentos"), bloco: true },
    { rubrica: "FCF · financiamento", nivel: 0, realizado: fcf, orcado: doPlano("Financiamento"), bloco: true },
    { rubrica: "Fluxo livre do mês", nivel: 0, realizado: livre, orcado: doPlano("Fluxo Livre"), bloco: true },
  ];

  /* Runway pelo fluxo livre dos meses FECHADOS até o mês em foco, como na aba
     Análises: um mês com 13º ou uma antecipação sozinha daria runway de mentira.
     A janela para NO mês da reunião — usar meses posteriores faria a pauta de
     julho falar do caixa de setembro. */
  const serieLivre = fluxoLivreDaDfc(dfcRows, dfcColumns);
  const i = mesesFechados.indexOf(mes);
  const ateAqui = i >= 0 ? mesesFechados.slice(0, i + 1) : mesesFechados;
  const ultimos = ateAqui.map((m) => serieLivre[m] ?? null);
  const validos = ultimos.filter((v): v is number => v != null).slice(-3);
  const medio = validos.length ? validos.reduce((s, v) => s + v, 0) / validos.length : null;

  return {
    saldo,
    saldoEm,
    linhas,
    fco,
    fcoOrcado: doPlano("Fluxo de Caixa Operacional"),
    fci,
    fcf,
    livre,
    livreOrcado: doPlano("Fluxo Livre"),
    fcoAnterior: anterior?.fco ?? null,
    livreAnterior: anterior?.livre ?? null,
    burn3m: medio == null ? null : -medio,
    runway: saldo == null ? null : calcularRunway(saldo, ultimos, 3),
  };
}

/* ------------------------------------------------------------------ *
 *  Próximo mês — o bloco 5
 * ------------------------------------------------------------------ */

const NOMES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** "Jul-26" → "Aug-26". Anda em meses absolutos, como o `mesAtras` do esquema. */
export function mesSeguinte(col: string): string | null {
  const c = parseColuna(col);
  if (!c) return null;
  const i = c.ano * 12 + c.mes;
  return `${EN_ORDER[i % 12]}-${String(Math.floor(i / 12) % 100).padStart(2, "0")}`;
}

/** "Jul-26" → "Julho/26", para o título do bloco. */
export function mesPorExtenso(col: string): string {
  const c = parseColuna(col);
  if (!c) return col;
  return `${NOMES_PT[c.mes - 1]}/${String(c.ano % 100).padStart(2, "0")}`;
}

export type CarteiraNivel = {
  nivel: string;
  clientes: number;
  mrr: number;
  ticket: number;
  /** Fatia da carteira, de 0 a 1. */
  mix: number;
  clientesOrcado: number | null;
  mrrOrcado: number | null;
};

export type MetaOperacao = {
  clientes_eop: number;
  perdidos: number;
  churn_pct: number | null;
  portes: { nivel: string; clientes_eop: number; mrr: number }[];
};

export type ProximoMes = {
  mes: string;
  rotulo: string;
  receitaOrcada: number | null;
  ebitdaOrcado: number | null;
  sgaOrcado: number | null;
  /** SG&A orçado sobre receita líquida orçada. */
  sgaPeso: number | null;
  margemOrcada: number | null;
  /** Quanto o EBITDA precisa melhorar do mês em foco para o próximo. */
  gap: number | null;
  clientesMeta: number | null;
  clientesHoje: number | null;
  liquidosNecessarios: number | null;
  churnEsperado: number | null;
  novosNecessarios: number | null;
  carteira: CarteiraNivel[];
  mrr: number | null;
  ticket: number | null;
  churnMesQtd: number | null;
  churnMesValor: number | null;
  churnMesPct: number | null;
};

/**
 * As metas do mês seguinte e a carteira de onde elas têm de sair.
 *
 * A meta vem do BP; a carteira vem do Asaas (`assinaturas_snapshot`) e o churn
 * da planilha da diretoria (`churn_snapshot`). Os três podem faltar
 * independentemente — sem BP a coluna de meta some, sem snapshot a carteira
 * some, e o bloco continua de pé com o que houver.
 */
export function proximoMes(opts: {
  plano: Plano | null;
  ebitdaRealizado: number | null;
  mes: string;
  /** Linha do mês SEGUINTE na aba "Operação" do BP (`parsearOperacao`). */
  metaClientes?: MetaOperacao | null;
  /** Mix por nível de hoje (`assinaturas_snapshot.dados.mix_nivel`). */
  carteira?: { nivel: string; clientes: number; mrr: number; tm: number }[] | null;
  clientesAtivos?: number | null;
  mrr?: number | null;
  ticket?: number | null;
  churn?: { qtd: number; valor: number; pct: number } | null;
}): ProximoMes | null {
  const proximo = mesSeguinte(opts.mes);
  if (!proximo) return null;
  const { plano } = opts;

  const abs = (v: number | null | undefined) => (v == null ? null : Math.abs(v));
  const receitaOrcada = abs(plano?.(RECEITA_BRUTA, proximo) ?? null);
  const rlOrcada = abs(plano?.(RL, proximo) ?? null);
  const sgaOrcado = abs(plano?.(SGA, proximo) ?? null);
  const ebitdaOrcado = ebitdaDoPlano(plano ?? null, proximo);

  const meta = opts.metaClientes ?? null;
  const clientesHoje = opts.clientesAtivos ?? null;
  const clientesMeta = meta?.clientes_eop ?? null;
  const liquidos = clientesMeta == null || clientesHoje == null ? null : clientesMeta - clientesHoje;
  const churnEsperado = meta?.perdidos ?? null;

  const totalClientes = (opts.carteira ?? []).reduce((s, n) => s + n.clientes, 0);
  const carteira: CarteiraNivel[] = (opts.carteira ?? []).map((n) => {
    // O BP chama de "GG" o porte que a base do Asaas chama de "XG".
    const doBp = meta?.portes.find((p) => p.nivel === (n.nivel === "XG" ? "GG" : n.nivel));
    return {
      nivel: n.nivel,
      clientes: n.clientes,
      mrr: n.mrr,
      ticket: n.tm,
      mix: totalClientes ? n.clientes / totalClientes : 0,
      clientesOrcado: doBp?.clientes_eop ?? null,
      mrrOrcado: doBp?.mrr ?? null,
    };
  });

  return {
    mes: proximo,
    rotulo: mesPorExtenso(proximo),
    receitaOrcada,
    ebitdaOrcado,
    sgaOrcado,
    sgaPeso: sgaOrcado == null || !rlOrcada ? null : sgaOrcado / rlOrcada,
    margemOrcada: ebitdaOrcado == null || !rlOrcada ? null : ebitdaOrcado / rlOrcada,
    gap: ebitdaOrcado == null || opts.ebitdaRealizado == null ? null : ebitdaOrcado - opts.ebitdaRealizado,
    clientesMeta,
    clientesHoje,
    liquidosNecessarios: liquidos,
    churnEsperado,
    /* Ganho LÍQUIDO mais o churn que o próprio plano espera: para a base subir
       116 com 39 saindo, é preciso VENDER 155. Somar o churn é a diferença
       entre a meta que o comercial persegue e a que a planilha exibe. */
    novosNecessarios: liquidos == null ? null : liquidos + (churnEsperado ?? 0),
    carteira,
    mrr: opts.mrr ?? null,
    ticket: opts.ticket ?? null,
    churnMesQtd: opts.churn?.qtd ?? null,
    churnMesValor: opts.churn?.valor ?? null,
    churnMesPct: opts.churn?.pct ?? null,
  };
}

/* ------------------------------------------------------------------ *
 *  O sinal — o que a edge function recebe para redigir
 * ------------------------------------------------------------------ */

export type SinalRubrica = {
  rubrica: string;
  bloco: string;
  natureza: Natureza;
  lado: "ofensor" | "amortecedor";
  posicao: number;
  /* Números JÁ FORMATADOS. A IA não faz conta nenhuma — ela copia. Mandar o
     número cru é convidá-la a arredondar, converter para milhar e errar. */
  fmtRealizado: string;
  fmtOrcado: string;
  fmtImpacto: string;
  fmtDesvioPct: string;
  fmtMoM: string;
  fatiaPct: string;
  /** "3 dos 3 meses fechados anteriores também ficaram do lado ruim do plano" */
  repeticao: string;
  /** O comentário que a DRE já tem para esta rubrica neste mês, se houver. */
  justificativa: string | null;
};

export type Sinal = {
  mes: string;
  rotuloMes: string;
  proximoMes: string;
  detalhe: Detalhe;
  fmtReceita: string;
  fmtEbitda: string;
  fmtEbitdaOrcado: string;
  fmtGapEbitda: string;
  fmtMargem: string;
  fmtMargemOrcada: string;
  fmtDesfavoravel: string;
  fmtFavoravel: string;
  fmtSaldoCaixa: string;
  fmtFluxoLivre: string;
  fmtRunway: string;
  fmtGapProximoMes: string;
  fmtNovosClientes: string;
  rubricas: SinalRubrica[];
};

/** `-42600` → `"-R$ 42,6 k"`, na mesma abreviação da tela. */
export const abreviado = (n: number | null | undefined): string => {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sinal = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sinal}R$ ${(abs / 1_000_000).toFixed(2).replace(".", ",")} M`;
  if (abs >= 1_000) return `${sinal}R$ ${(abs / 1_000).toFixed(1).replace(".", ",")} k`;
  return `${sinal}R$ ${abs.toFixed(0)}`;
};

/** Fração (−0,047) → "-4,7%". */
export const fracPct = (n: number | null | undefined, casas = 1): string =>
  n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(casas).replace(".", ",")}%`;

/**
 * Empacota o que a IA precisa para redigir — e nada além disso.
 *
 * Todo número vai FORMATADO, do jeito que aparece na tela. É a mesma regra do
 * `cartao-recomendar`: a IA copia o que recebe. Um número que ela recalcule é um
 * número que ninguém consegue conferir contra a grade.
 */
export function montarSinal(opts: {
  mes: string;
  detalhe: Detalhe;
  espinha: LinhaEspinha[];
  pareto: Pareto;
  caixa: BlocoCaixa;
  proximo: ProximoMes | null;
  /** rubrica → comentário já gerado/conferido na DRE, quando existe. */
  justificativas?: Map<string, string>;
  /** Quantos ofensores entram na redação (os que o corte selecionou). */
  quantos: number;
}): Sinal {
  const { mes, pareto: p, caixa, proximo, espinha, justificativas } = opts;
  const acha = (rubrica: string) => espinha.find((l) => l.rubrica === rubrica);
  const receita = acha(RECEITA_BRUTA);
  const ebitda = acha(EBITDA);
  const rl = acha(RL);

  const margem = (v: number | null | undefined, base: number | null | undefined) =>
    v == null || !base ? null : v / base;

  const linha = (o: Ofensor, lado: "ofensor" | "amortecedor"): SinalRubrica => ({
    rubrica: o.rubrica,
    bloco: o.bloco,
    natureza: o.natureza,
    lado,
    posicao: o.posicao,
    fmtRealizado: abreviado(o.realizado),
    fmtOrcado: abreviado(o.orcado),
    fmtImpacto: `${(o.impacto ?? 0) >= 0 ? "+" : ""}${abreviado(o.impacto)}`,
    fmtDesvioPct: fracPct(o.desvioPct),
    fmtMoM: fracPct(o.mom),
    fatiaPct: `${(o.fatia * 100).toFixed(1).replace(".", ",")}%`,
    repeticao: o.mesesConferidos
      ? `${o.mesesRuins} dos ${o.mesesConferidos} meses fechados anteriores também ficaram do lado ruim do plano`
      : "sem mês fechado anterior para comparar",
    justificativa: justificativas?.get(o.rubrica) ?? null,
  });

  return {
    mes,
    rotuloMes: rotuloMes(mes),
    proximoMes: proximo?.rotulo ?? "—",
    detalhe: opts.detalhe,
    fmtReceita: abreviado(receita?.realizado),
    fmtEbitda: abreviado(ebitda?.realizado),
    fmtEbitdaOrcado: abreviado(ebitda?.orcado),
    fmtGapEbitda: `${(p.gapEbitda ?? 0) >= 0 ? "+" : ""}${abreviado(p.gapEbitda)}`,
    fmtMargem: fracPct(margem(ebitda?.realizado, rl?.realizado)),
    fmtMargemOrcada: fracPct(margem(ebitda?.orcado, rl?.orcado)),
    fmtDesfavoravel: abreviado(p.desfavoravel),
    fmtFavoravel: abreviado(p.favoravel),
    fmtSaldoCaixa: abreviado(caixa.saldo),
    fmtFluxoLivre: abreviado(caixa.livre),
    fmtRunway:
      caixa.runway == null ? "—"
      : caixa.runway.gerandoCaixa ? "gera caixa"
      : caixa.runway.meses == null ? "—"
      : `${caixa.runway.meses.toFixed(1).replace(".", ",")} meses`,
    fmtGapProximoMes: abreviado(proximo?.gap ?? null),
    fmtNovosClientes: proximo?.novosNecessarios == null ? "—" : String(proximo.novosNecessarios),
    rubricas: [
      ...p.ofensores.slice(0, opts.quantos).map((o) => linha(o, "ofensor")),
      ...p.amortecedores.slice(0, 3).map((o) => linha(o, "amortecedor")),
    ],
  };
}

/* ------------------------------------------------------------------ *
 *  O texto gravado — o que a edge function devolve
 * ------------------------------------------------------------------ */

export type TextoRubrica = { rubrica: string; impacto: string; acao: string };
export type Destaque = {
  nivel: "critico" | "atencao" | "info";
  area: string;
  titulo: string;
  texto: string;
};

export type Leitura = {
  veredicto_nivel: "critico" | "atencao" | "ok";
  veredicto_titulo: string;
  veredicto_resumo: string;
  destaques: Destaque[];
  rubricas: TextoRubrica[];
  decisoes: string[];
  fecho: string;
};

export const LEITURA_VAZIA: Leitura = {
  veredicto_nivel: "atencao",
  veredicto_titulo: "",
  veredicto_resumo: "",
  destaques: [],
  rubricas: [],
  decisoes: [],
  fecho: "",
};

/**
 * O que a IA escreveu, com o que a pessoa reescreveu por cima.
 *
 * A reescrita é um PATCH PARCIAL, não uma segunda cópia do documento. É o que
 * faz cada card ser editável sozinho: corrigir o veredicto não pode congelar os
 * outros nove textos contra o próximo "Regerar". Por isso o merge desce até o
 * campo:
 *
 *   · texto solto → vale a edição quando ela não está vazia
 *   · rubricas    → por RUBRICA e campo a campo (reescrever a ação de Pessoal
 *                   não mexe no impacto dela nem em nada de Marketing)
 *   · destaques   → por POSIÇÃO e campo a campo, mesma ideia
 *   · decisoes    → a lista INTEIRA, porque editar uma pauta é reordenar,
 *                   acrescentar e remover; casar item a item por índice daria
 *                   merge errado no primeiro item inserido no meio
 */
export function aplicarEdicao(
  gerado: Partial<Leitura> | null,
  editado: Partial<Leitura> | null,
): Leitura {
  const base: Leitura = { ...LEITURA_VAZIA, ...(gerado ?? {}) };
  if (!editado) return base;

  const texto = (a: string | undefined, b: string) => (a?.trim() ? a : b);

  const porRubrica = new Map(base.rubricas.map((r) => [r.rubrica, { ...r }]));
  for (const r of editado.rubricas ?? []) {
    const atual = porRubrica.get(r.rubrica) ?? { rubrica: r.rubrica, impacto: "", acao: "" };
    porRubrica.set(r.rubrica, {
      rubrica: r.rubrica,
      impacto: texto(r.impacto, atual.impacto),
      acao: texto(r.acao, atual.acao),
    });
  }

  const quantos = Math.max(base.destaques.length, editado.destaques?.length ?? 0);
  const destaques: Destaque[] = [];
  for (let i = 0; i < quantos; i++) {
    const b = base.destaques[i];
    const e = editado.destaques?.[i];
    if (!b && !e) continue;
    if (!b) { destaques.push(e as Destaque); continue; }
    if (!e) { destaques.push(b); continue; }
    destaques.push({
      nivel: e.nivel ?? b.nivel,
      area: texto(e.area, b.area),
      titulo: texto(e.titulo, b.titulo),
      texto: texto(e.texto, b.texto),
    });
  }

  return {
    veredicto_nivel: editado.veredicto_nivel ?? base.veredicto_nivel,
    veredicto_titulo: texto(editado.veredicto_titulo, base.veredicto_titulo),
    veredicto_resumo: texto(editado.veredicto_resumo, base.veredicto_resumo),
    destaques,
    rubricas: [...porRubrica.values()],
    decisoes: editado.decisoes?.length ? editado.decisoes : base.decisoes,
    fecho: texto(editado.fecho, base.fecho),
  };
}

/**
 * O texto envelheceu?
 *
 * Mesma pergunta que a marca de justificativa faz na célula da DRE: o texto fala
 * do número contra o qual foi escrito, e o sinal congelado existe justamente
 * para dar para perceber quando ele deixou de valer. A comparação é sobre o
 * TEXTO dos números, não sobre os números: é o texto que a pessoa lê, e um
 * centavo que não muda a exibição não envelhece a leitura.
 */
export function sinalMudou(gravado: Partial<Sinal> | null, atual: Sinal): boolean {
  if (!gravado) return false;
  const campos: (keyof Sinal)[] = ["fmtReceita", "fmtEbitda", "fmtGapEbitda", "fmtDesfavoravel"];
  return campos.some((c) => gravado[c] != null && gravado[c] !== atual[c]);
}
