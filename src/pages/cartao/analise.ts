/**
 * A leitura da fatura — tudo o que a tela de Cartão mostra sai daqui.
 *
 * O banco guarda só os lançamentos que a skill normalizou (ver a migration
 * `20260805120000_cartao_ofx.sql`). KPIs, matrizes, destaques e leitura rápida
 * são calculados a cada render, e não gravados: o recorte do período é um
 * controle da tela, então congelar "o total do período" no banco produziria um
 * número que discorda do filtro que está à vista.
 *
 * Módulo puro de propósito (sem React, sem Supabase) — é o que dá para testar
 * sem subir a tela.
 */

import { abrevStr, fmtBRLStr, labelDeCompetencia, pctStr } from "./fmt";

export type TipoLancamento = "gasto" | "pagamento" | "estorno";

export type Lancamento = {
  id: string;
  competencia: string;              // '2026-08-01'
  data: string | null;
  estabelecimento: string;
  categoria: string;
  descricao: string | null;
  parcela: string | null;
  cidade: string | null;
  valor: number;                    // sempre positivo; o sinal está em `tipo`
  tipo: TipoLancamento;
};

export type Fatura = {
  competencia: string;
  mes_label: string;
  fechamento: string | null;
  arquivo: string | null;
};

export type Marcacao = { estabelecimento: string; nota: string | null; marcado_em: string };

export type Mes = { competencia: string; label: string };

export type KpiMes = {
  competencia: string;
  label: string;
  gastos: number;
  lancamentos: number;
  ticket: number;
  pagamentos: number;
  estornos: number;
};

/** Uma linha da matriz: o eixo (estabelecimento ou categoria) contra os meses. */
export type LinhaMatriz = {
  chave: string;
  /** Categoria dominante — vira o subtítulo na matriz de estabelecimento. */
  sub: string | null;
  porMes: number[];                 // alinhado com `meses`
  total: number;
  /** Último mês contra o PRIMEIRO do período: a tendência longa. */
  deltaPrimeiro: number;
  pctPrimeiro: number | null;       // null = não havia base (aparece como "novo")
  /** Último mês contra o PENÚLTIMO: "o que mudou do mês passado para este". */
  deltaPenultimo: number;
  pctPenultimo: number | null;
  /** Não teve nenhum lançamento antes da última fatura do período. */
  novo: boolean;
  /** Tinha gasto no período e não veio na última fatura. */
  sumiu: boolean;
};

export type NivelDestaque = "critico" | "atencao" | "info";
export type Destaque = {
  nivel: NivelDestaque;
  titulo: string;
  detalhe: string;
  tag: string;                      // 'ago/26' ou 'período'
};

export type Analise = {
  meses: Mes[];
  kpis: KpiMes[];
  ultimo: KpiMes | null;
  penultimo: KpiMes | null;
  /** Variação da última fatura contra a anterior — a leitura mais imediata. */
  deltaUltimo: number;
  pctUltimo: number | null;
  totalPeriodo: number;
  pagamentosPeriodo: number;
  estornosPeriodo: number;
  mediaMensal: number;
  pico: KpiMes | null;
  vale: KpiMes | null;
  estabelecimentos: LinhaMatriz[];
  categorias: LinhaMatriz[];
  destaques: Destaque[];
  leitura: string[];
};

/* ------------------------------------------------------------------ */

const soma = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** Divisão que não estoura quando a base é zero — devolve `null` (= "novo"). */
function fracao(delta: number, base: number): number | null {
  return base > 0 ? delta / base : null;
}

/**
 * Constrói a matriz eixo × mês.
 * `sub` sai da categoria que mais pesou naquele eixo — um estabelecimento pode
 * cair em duas categorias ao longo do período (recategorização na skill), e o
 * subtítulo tem de mostrar a que explica o número, não a última vista.
 */
function montarMatriz(
  lancs: Lancamento[],
  meses: Mes[],
  chaveDe: (l: Lancamento) => string,
  comSub: boolean,
): LinhaMatriz[] {
  const idxMes = new Map(meses.map((m, i) => [m.competencia, i]));
  const acc = new Map<string, { porMes: number[]; cats: Map<string, number> }>();

  for (const l of lancs) {
    const i = idxMes.get(l.competencia);
    if (i == null) continue;
    const chave = chaveDe(l);
    let linha = acc.get(chave);
    if (!linha) {
      linha = { porMes: new Array(meses.length).fill(0), cats: new Map() };
      acc.set(chave, linha);
    }
    linha.porMes[i] += l.valor;
    linha.cats.set(l.categoria, (linha.cats.get(l.categoria) ?? 0) + l.valor);
  }

  const ultimo = meses.length - 1;
  const penultimo = meses.length - 2;

  const linhas: LinhaMatriz[] = [];
  for (const [chave, v] of acc) {
    const vUlt = v.porMes[ultimo] ?? 0;
    const vPri = v.porMes[0] ?? 0;
    const vPen = penultimo >= 0 ? v.porMes[penultimo] ?? 0 : 0;
    const anteriores = v.porMes.slice(0, ultimo);

    linhas.push({
      chave,
      sub: comSub ? [...v.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null,
      porMes: v.porMes,
      total: soma(v.porMes),
      deltaPrimeiro: vUlt - vPri,
      pctPrimeiro: fracao(vUlt - vPri, vPri),
      deltaPenultimo: vUlt - vPen,
      pctPenultimo: fracao(vUlt - vPen, vPen),
      novo: meses.length > 1 && vUlt > 0 && anteriores.every((x) => x === 0),
      sumiu: meses.length > 1 && vUlt === 0 && anteriores.some((x) => x > 0),
    });
  }

  return linhas.sort((a, b) => b.total - a.total);
}

/* ------------------------------------------------------------------ */

export function analisar(
  faturas: Fatura[],
  lancamentos: Lancamento[],
  marcacoes: Marcacao[] = [],
): Analise {
  const meses: Mes[] = [...faturas]
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
    .map((f) => ({ competencia: f.competencia, label: f.mes_label || labelDeCompetencia(f.competencia) }));

  const gastos = lancamentos.filter((l) => l.tipo === "gasto");

  const kpis: KpiMes[] = meses.map((m) => {
    const doMes = gastos.filter((l) => l.competencia === m.competencia);
    const total = soma(doMes.map((l) => l.valor));
    return {
      competencia: m.competencia,
      label: m.label,
      gastos: total,
      lancamentos: doMes.length,
      ticket: doMes.length ? total / doMes.length : 0,
      pagamentos: soma(
        lancamentos.filter((l) => l.competencia === m.competencia && l.tipo === "pagamento").map((l) => l.valor),
      ),
      estornos: soma(
        lancamentos.filter((l) => l.competencia === m.competencia && l.tipo === "estorno").map((l) => l.valor),
      ),
    };
  });

  const ultimo = kpis[kpis.length - 1] ?? null;
  const penultimo = kpis.length >= 2 ? kpis[kpis.length - 2] : null;
  const deltaUltimo = ultimo && penultimo ? ultimo.gastos - penultimo.gastos : 0;
  const pctUltimo = ultimo && penultimo ? fracao(deltaUltimo, penultimo.gastos) : null;

  const totalPeriodo = soma(kpis.map((k) => k.gastos));
  const comGasto = kpis.filter((k) => k.gastos > 0);
  const pico = comGasto.length ? comGasto.reduce((a, b) => (b.gastos > a.gastos ? b : a)) : null;
  const vale = comGasto.length ? comGasto.reduce((a, b) => (b.gastos < a.gastos ? b : a)) : null;

  const estabelecimentos = montarMatriz(gastos, meses, (l) => l.estabelecimento, true);
  const categorias = montarMatriz(gastos, meses, (l) => l.categoria, false);

  const analise: Analise = {
    meses,
    kpis,
    ultimo,
    penultimo,
    deltaUltimo,
    pctUltimo,
    totalPeriodo,
    pagamentosPeriodo: soma(kpis.map((k) => k.pagamentos)),
    estornosPeriodo: soma(kpis.map((k) => k.estornos)),
    mediaMensal: kpis.length ? totalPeriodo / kpis.length : 0,
    pico,
    vale,
    estabelecimentos,
    categorias,
    destaques: [],
    leitura: [],
  };

  analise.destaques = montarDestaques(analise, marcacoes);
  analise.leitura = montarLeitura(analise);
  return analise;
}

/* ============================================================
 *  Destaques — o painel "o que olhar nesta fatura"
 * ============================================================
 * Todos derivados dos números, nenhum escrito por IA: o objetivo é achar erro de
 * lançamento e gasto fora da curva antes do fechamento, e para isso a regra
 * precisa ser a mesma todo mês.
 */
function montarDestaques(a: Analise, marcacoes: Marcacao[]): Destaque[] {
  const out: Destaque[] = [];
  const tagUlt = a.ultimo?.label ?? "período";
  const marcados = new Map(marcacoes.map((m) => [m.estabelecimento, m]));

  // 1) As marcas humanas vêm primeiro — foi alguém que pediu para olhar.
  for (const linha of a.estabelecimentos) {
    const m = marcados.get(linha.chave);
    if (!m) continue;
    out.push({
      nivel: "atencao",
      titulo: `${linha.chave} está marcado para revisão`,
      detalhe:
        (m.nota ? `${m.nota} ` : "") +
        `${abrevStr(linha.porMes[linha.porMes.length - 1] ?? 0)} nesta fatura, ` +
        `${abrevStr(linha.total)} no período.`,
      tag: tagUlt,
    });
  }

  // 2) Quem puxou a variação da última fatura. Só faz sentido com base para
  //    comparar — e só vira destaque se pesar de verdade dentro da variação.
  if (a.penultimo && Math.abs(a.deltaUltimo) > 0) {
    const subiu = a.deltaUltimo > 0;
    const candidatos = a.estabelecimentos
      .filter((l) => (subiu ? l.deltaPenultimo > 0 : l.deltaPenultimo < 0))
      .sort((x, y) => Math.abs(y.deltaPenultimo) - Math.abs(x.deltaPenultimo));
    const motor = candidatos[0];
    if (motor) {
      const peso = Math.abs(motor.deltaPenultimo) / Math.abs(a.deltaUltimo);
      if (peso >= 0.2) {
        out.push({
          nivel: subiu && peso >= 0.4 ? "critico" : subiu ? "atencao" : "info",
          titulo: `${motor.chave} puxou ${subiu ? "o aumento" : "a queda"} da fatura`,
          detalhe:
            `${abrevStr(Math.abs(motor.deltaPenultimo))} ${subiu ? "acima" : "abaixo"} de ${a.penultimo.label}` +
            `${motor.novo ? " (novo)" : ""}. Responde por ${pctStr(peso, { sinal: false })} da variação total do mês.`,
          tag: tagUlt,
        });
      }
    }
  }

  // 3) Fornecedor que nunca tinha aparecido. É onde a skill mais erra a
  //    categoria (não há regra para ele ainda) e onde mora a cobrança indevida.
  for (const linha of a.estabelecimentos.filter((l) => l.novo && !marcados.has(l.chave)).slice(0, 2)) {
    out.push({
      nivel: "atencao",
      titulo: `${linha.chave} apareceu pela primeira vez`,
      detalhe:
        `${abrevStr(linha.porMes[linha.porMes.length - 1])} em um estabelecimento sem histórico no período. ` +
        `Confirme a categoria antes do fechamento.`,
      tag: tagUlt,
    });
  }

  // 4) Assinatura que parou de vir. Some sem avisar quando o cartão é recusado —
  //    e aí o serviço cai dias depois.
  const sumidos = a.estabelecimentos
    .filter((l) => l.sumiu && !marcados.has(l.chave) && Math.abs(l.deltaPenultimo) >= 500)
    .slice(0, 2);
  for (const linha of sumidos) {
    out.push({
      nivel: "atencao",
      titulo: `${linha.chave} não veio nesta fatura`,
      detalhe:
        `Vinha em ${abrevStr(Math.abs(linha.deltaPenultimo))} na fatura anterior. ` +
        `Confira se a cobrança mudou de forma de pagamento ou se o contrato acabou.`,
      tag: tagUlt,
    });
  }

  // 5) Onde a última fatura está no período — o enquadramento, sempre por último.
  if (a.pico && a.vale && a.meses.length >= 3 && a.ultimo) {
    const noPico = a.pico.competencia === a.ultimo.competencia;
    out.push({
      nivel: "info",
      titulo: noPico ? `Pico do período em ${a.ultimo.label}` : `${a.ultimo.label} abaixo do pico do período`,
      detalhe:
        `${fmtBRLStr(a.ultimo.gastos)} contra ${fmtBRLStr(noPico ? a.vale.gastos : a.pico.gastos)} em ` +
        `${noPico ? a.vale.label : a.pico.label}. Média mensal de ${fmtBRLStr(a.mediaMensal)} nas ${a.meses.length} faturas.`,
      tag: "período",
    });
  }

  return out;
}

/* ============================================================
 *  Leitura rápida — o parágrafo que iria para o fechamento
 * ============================================================ */
function montarLeitura(a: Analise): string[] {
  const out: string[] = [];
  if (!a.ultimo) return out;

  const primeiro = a.kpis[0];

  if (a.meses.length >= 2 && primeiro) {
    const pct = fracao(a.ultimo.gastos - primeiro.gastos, primeiro.gastos);
    out.push(
      `O gasto saiu de ${fmtBRLStr(primeiro.gastos)} em ${primeiro.label} para ${fmtBRLStr(a.ultimo.gastos)} ` +
        `em ${a.ultimo.label} — ${pctStr(pct)} no período.`,
    );
  }

  if (a.penultimo) {
    const subiu = a.deltaUltimo > 0;
    out.push(
      a.deltaUltimo === 0
        ? `Da fatura anterior para esta: sem variação no total.`
        : `Da fatura anterior para esta: ${subiu ? "alta" : "queda"} de ` +
          `${fmtBRLStr(Math.abs(a.deltaUltimo))} (${pctStr(a.pctUltimo)}).`,
    );
  }

  if (a.pico && a.vale && a.meses.length >= 3) {
    out.push(
      `Pico em ${a.pico.label} (${fmtBRLStr(a.pico.gastos)}) e vale em ${a.vale.label} ` +
        `(${fmtBRLStr(a.vale.gastos)}); média mensal de ${fmtBRLStr(a.mediaMensal)}.`,
    );
  }

  const maiorAlta = [...a.estabelecimentos].sort((x, y) => y.deltaPrimeiro - x.deltaPrimeiro)[0];
  if (maiorAlta && maiorAlta.deltaPrimeiro > 0 && a.meses.length >= 2) {
    out.push(
      `Maior crescimento no período: ${maiorAlta.chave}, ${fmtBRLStr(maiorAlta.deltaPrimeiro)} acima do primeiro mês.`,
    );
  }

  // As duas categorias que mandam no período. Concentração alta não é problema
  // em si — é o que diz onde vale negociar.
  const topCats = a.categorias.slice(0, 2);
  if (topCats.length === 2 && a.totalPeriodo > 0) {
    const peso = (topCats[0].total + topCats[1].total) / a.totalPeriodo;
    out.push(
      `${topCats[0].chave} e ${topCats[1].chave} respondem por ${pctStr(peso, { sinal: false })} do total do período.`,
    );
  }

  // Ressalva de método — vem da própria skill e vale toda vez.
  out.push(
    `Parcelas recorrentes de compras antigas se repetem entre as faturas e se diluem na evolução — ` +
      `comparar o total de cada fatura continua válido.`,
  );

  return out;
}
