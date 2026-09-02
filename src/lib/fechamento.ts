/* ============================================================================
 * O QUE AINDA NÃO FECHA — a lista de pendências do mês em curso.
 *
 * POR QUE ISTO É UM OBJETO DIFERENTE DO COMENTÁRIO. A justificativa automática
 * só sai em mês TRAVADO, e a regra é boa: texto escrito sobre um mês pela metade
 * envelhece congelado e, quando o mês fecha de verdade, o que aparece é a frase
 * velha falando de números que não existem mais. Só que o fechamento acontece no
 * mês ABERTO — é ali que se descobre que a receita financeira não entrou, e ali
 * não havia nada olhando.
 *
 * A saída não é afrouxar aquela regra: é outro objeto, com outro contrato.
 *
 *   · A pendência é VOLÁTIL. Nada aqui é gravado. Recalcula a cada abertura da
 *     página e some sozinha quando o lançamento entra. Não há o que envelhecer,
 *     e por isso ela pode existir no mês em curso.
 *   · A pendência é uma CONSTATAÇÃO, não uma explicação. "Esta rubrica não veio"
 *     é verificável na hora; "não veio porque a Paytime não repassou" é hipótese,
 *     e hipótese é trabalho do comentário — que continua esperando o mês fechar.
 *   · Tudo é DETERMINÍSTICO. Nenhuma chamada de IA monta esta lista. O caminho
 *     para a IA continua sendo o "?" da célula, um clique depois, quando alguém
 *     quer saber o porquê de UMA delas.
 *
 * A ORDEM É O DINHEIRO. Cinco checagens produzem dezenas de itens e ninguém lê
 * lista longa no meio de um fechamento; o que decide o que se olha primeiro é
 * quanto está em jogo, não a categoria da checagem.
 * ========================================================================== */

import type { Ausencia, Recorde } from "@/lib/justificativas";

/** De onde a pendência veio. A ordem do enum não manda em nada — o valor manda. */
export type Frente =
  | "ausencia"        // rubrica recorrente que não veio
  | "sem_de_para"     // categoria do Omie que a demonstração não enxerga
  | "classificacao"   // lançamento fora da rubrica habitual do fornecedor
  | "total"           // o total gravado não bate com a soma das parcelas
  | "recorde";        // maior/menor valor de 12 meses, por margem relevante

export type Pendencia = {
  chave: string;
  frente: Frente;
  /** A célula para onde a tela leva. `null` quando não há célula (categoria órfã). */
  rubrica: string | null;
  mes: string;
  titulo: string;
  detalhe: string;
  /** O dinheiro em jogo, em módulo. É o que ordena a lista inteira. */
  valor: number;
  /** `alta` = quase certamente erro. `media` = merece olhar. */
  severidade: "alta" | "media";
};

export const FRENTES: Record<Frente, { rotulo: string; nota: string }> = {
  ausencia: {
    rotulo: "Não veio",
    nota: "Rubrica com valor em quase todo mês que neste mês está zerada ou sem linha.",
  },
  sem_de_para: {
    rotulo: "Fora da demonstração",
    nota: "Categoria do Omie sem DE-PARA: o lançamento existe e a demonstração não o enxerga.",
  },
  classificacao: {
    rotulo: "Classificação suspeita",
    nota: "Lançamento numa rubrica diferente da que aquele fornecedor vinha usando.",
  },
  total: {
    rotulo: "Total que não fecha",
    nota: "O número gravado na linha de resultado não bate com a soma das parcelas dela.",
  },
  recorde: {
    rotulo: "Recorde de 12 meses",
    nota: "Maior (ou menor) valor da rubrica em doze meses, por uma margem acima da oscilação normal dela.",
  },
};

const brl = (n: number) =>
  Math.abs(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/* ============================================================
 *  As entradas, na forma em que a página as tem
 * ============================================================ */

/** Uma linha de `demonstracoes_sem_de_para`. */
export type CategoriaOrfa = {
  mes: string;
  categoria: string;
  quantidade: number;
  valor: number;
  /** Em quantos dos 6 meses anteriores a categoria já vinha órfã. 0 = novidade. */
  meses_antes: number;
};

/** O alerta de reclassificação de uma célula, como a grade já o tem. */
export type ClassificacaoSuspeita = {
  rubrica: string;
  mes: string;
  alertas: number;
  valor: number;
};

/** Uma linha de resultado cuja soma não bate com o gravado. */
export type TotalDivergente = {
  rubrica: string;
  mes: string;
  calculado: number | null;
  guardado: number | null;
  diferenca: number;
};

/* ============================================================
 *  A montagem
 * ============================================================ */

export function montarFechamento(opts: {
  mes: string;
  rotuloMes: (k: string) => string;
  ausencias: Ausencia[];
  orfas: CategoriaOrfa[];
  suspeitas: ClassificacaoSuspeita[];
  totais: TotalDivergente[];
  recordes: Recorde[];
}): Pendencia[] {
  const { mes, rotuloMes } = opts;
  const out: Pendencia[] = [];

  for (const a of opts.ausencias) {
    if (a.mes !== mes) continue;
    const quantos = a.serie.meses >= a.serie.janela
      ? `nos ${a.serie.janela} meses anteriores`
      : `em ${a.serie.meses} dos ${a.serie.janela} meses anteriores`;
    out.push({
      chave: `ausencia|${a.rubrica}`,
      frente: "ausencia",
      rubrica: a.rubrica,
      mes,
      titulo: `${a.rubrica} não veio`,
      detalhe: `Teve valor ${quantos} — costuma trazer ${brl(a.serie.mediana)}`
        + (a.serie.ultimoMes && a.serie.ultimoValor != null
          ? `, último ${brl(a.serie.ultimoValor)} em ${rotuloMes(a.serie.ultimoMes)}` : "")
        + `. Agora está ${a.serie.zerada ? "zerada" : "sem linha"}.`,
      valor: Math.abs(a.serie.mediana),
      severidade: "alta",
    });
  }

  for (const o of opts.orfas) {
    if (o.mes !== mes) continue;
    /* A categoria que já vinha órfã é o de sempre — transferência entre contas
       próprias, CAPEX, aporte —, e está certa onde está. Só a NOVA pede decisão:
       alguém começou a lançar numa conta que o mapa não conhece. Sem esta
       distinção o painel repetiria R$ 1,6 M todo mês e seria desligado. */
    const nova = o.meses_antes === 0;
    out.push({
      chave: `orfa|${o.categoria}`,
      frente: "sem_de_para",
      rubrica: null,
      mes,
      titulo: nova
        ? `Categoria nova sem DE-PARA: ${o.categoria}`
        : `Fora da demonstração: ${o.categoria}`,
      detalhe: `${o.quantidade} lançamento(s), ${brl(o.valor)}. `
        + (nova
          ? "Não aparecia nos meses anteriores — decida se entra na demonstração ou fique com ela fora de propósito."
          : `Já vinha assim em ${o.meses_antes} dos 6 meses anteriores.`),
      valor: Math.abs(o.valor),
      severidade: nova ? "alta" : "media",
    });
  }

  for (const s of opts.suspeitas) {
    if (s.mes !== mes) continue;
    out.push({
      chave: `classificacao|${s.rubrica}`,
      frente: "classificacao",
      rubrica: s.rubrica,
      mes,
      titulo: `${s.rubrica}: ${s.alertas} lançamento(s) em rubrica incomum`,
      detalhe: `${brl(s.valor)} caíram aqui vindos de fornecedores que costumavam cair noutra linha. `
        + "Abra a célula para confirmar ou ignorar.",
      valor: Math.abs(s.valor),
      severidade: "media",
    });
  }

  for (const t of opts.totais) {
    if (t.mes !== mes) continue;
    out.push({
      chave: `total|${t.rubrica}`,
      frente: "total",
      rubrica: t.rubrica,
      mes,
      titulo: `${t.rubrica} não fecha com as parcelas`,
      detalhe: `Gravado ${brl(t.guardado ?? 0)}, parcelas somam ${brl(t.calculado ?? 0)} `
        + `— diferença de ${brl(t.diferenca)}.`,
      valor: Math.abs(t.diferenca),
      severidade: "alta",
    });
  }

  for (const r of opts.recordes) {
    if (r.mes !== mes) continue;
    const anterior = r.serie.extremo === "maior" ? r.serie.maximo : r.serie.minimo;
    out.push({
      chave: `recorde|${r.rubrica}`,
      frente: "recorde",
      rubrica: r.rubrica,
      mes,
      titulo: `${r.rubrica}: ${r.serie.extremo === "maior" ? "maior" : "menor"} valor em ${r.serie.janela} meses`,
      detalhe: `${brl(r.valor)} contra ${brl(anterior)}, que era o ${r.serie.extremo === "maior" ? "teto" : "piso"} `
        + `— a rubrica costuma ficar em ${brl(r.serie.mediana)}.`,
      valor: Math.abs(r.valor),
      severidade: "media",
    });
  }

  /* Grave primeiro, depois o dinheiro. A severidade vem antes porque um total
     que não fecha em R$ 3 mil é conserto certo, e um recorde de R$ 300 mil pode
     ser só um mês bom — inverter poria o "pode ser nada" no topo da lista. */
  const peso = (p: Pendencia) => (p.severidade === "alta" ? 1 : 0);
  return out.sort((a, b) => (peso(b) - peso(a)) || (b.valor - a.valor));
}

/** Quantas pendências por frente — o cabeçalho do painel. */
export function contarPorFrente(ps: Pendencia[]): { frente: Frente; quantas: number; valor: number }[] {
  const m = new Map<Frente, { quantas: number; valor: number }>();
  for (const p of ps) {
    const a = m.get(p.frente) ?? { quantas: 0, valor: 0 };
    a.quantas++;
    a.valor += p.valor;
    m.set(p.frente, a);
  }
  return [...m.entries()]
    .map(([frente, v]) => ({ frente, ...v }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * O mês que está fechando: o último da grade com dado de gente dentro.
 *
 * NÃO é simplesmente a última coluna. O tracker traz meses à frente pela metade
 * — `Sep-26` da DRE tem 12 de 61 células —, e apontar o painel para um mês que
 * nem começou faria dele um alarme sobre o nada. Mesma régua dos 40% usada em
 * `mesTemDadoSuficiente` e em `ausenciasDoMes`, aqui em cima da contagem que a
 * página já sabe fazer.
 */
export function mesEmFechamento(
  colunas: string[], preenchidas: (col: string) => number, fracao = 0.4,
): string | null {
  if (!colunas.length) return null;
  for (let i = colunas.length - 1; i >= 0; i--) {
    const antes = colunas.slice(Math.max(0, i - 6), i).map(preenchidas);
    const cheio = antes.length ? Math.max(...antes) : 0;
    if (cheio === 0 || preenchidas(colunas[i]) >= cheio * fracao) return colunas[i];
  }
  return colunas[0];
}
