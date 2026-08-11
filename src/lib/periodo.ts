/* ============================================================================
 * O período de uma apresentação.
 *
 * A Revisão do Mês é de um mês fechado, e isso é certo para a reunião de
 * tracker. Conselho fala em trimestre; investidor fala em ano e em últimos doze
 * meses. Enquanto o mês estivesse amarrado na página, todo card novo herdaria
 * essa limitação — por isso o período passa a ser da APRESENTAÇÃO, e cada card
 * recebe a janela inteira.
 *
 * O QUE UM PERÍODO É
 *   Uma LISTA DE COLUNAS do blob, e não um par de datas. É assim que a DRE
 *   pensa (`Jul-26`), é assim que os snapshots são indexados, e resolver a
 *   janela uma vez aqui evita cada card reinventar "quais meses são o 3T".
 *
 * NEM TODO CARD É DE PERÍODO — e isso é honesto, não uma pendência:
 *   · A cascata, o Pareto e a DRE contra o orçado são de UM mês. Num trimestre
 *     eles mostram o MÊS DE FECHAMENTO (`mesFoco`) e a folha diz qual é.
 *   · Churn, receita e EBITDA somam a janela toda.
 *   · Carteira e caixa são ESTOQUE: valem no último mês da janela, somar seria
 *     contar o mesmo cliente três vezes.
 *   Fingir que tudo vira trimestral daria um número errado com cara de certo.
 *
 * A janela é sempre recortada contra os meses QUE TÊM DADO. Um trimestre pedido
 * em outubro devolve dois meses, e quem desenha sabe disso pelo tamanho da lista
 * em vez de descobrir com uma barra vazia no gráfico.
 * ========================================================================== */

import { MES_PT, parseColuna } from "@/lib/demonstracoes-schema";

export type TipoPeriodo = "mes" | "trimestre" | "semestre" | "ano" | "ultimos12";

export type Periodo = {
  tipo: TipoPeriodo;
  /** Colunas do blob cobertas, em ordem cronológica. Nunca vazia. */
  meses: string[];
  /** O mês de fechamento — o que um card mensal desenha. */
  mesFoco: string;
  /** "3T26", "2026 · até Jul", "Últimos 12 meses · Ago/25 a Jul/26". */
  rotulo: string;
  /** Falta mês na janela (trimestre pedido no meio dele, série curta). */
  parcial: boolean;
};

export const TIPOS: { tipo: TipoPeriodo; nome: string }[] = [
  { tipo: "mes", nome: "Mês" },
  { tipo: "trimestre", nome: "Trimestre" },
  { tipo: "semestre", nome: "Semestre" },
  { tipo: "ano", nome: "Ano" },
  { tipo: "ultimos12", nome: "Últimos 12 meses" },
];

const curto = (col: string) => {
  const c = parseColuna(col);
  return c ? `${MES_PT[c.mes - 1]}/${String(c.ano % 100).padStart(2, "0")}` : col;
};

/** Quantos meses o tipo cobre, quando ele é uma fatia do calendário. */
const TAMANHO: Record<TipoPeriodo, number> = {
  mes: 1, trimestre: 3, semestre: 6, ano: 12, ultimos12: 12,
};

/**
 * Resolve a janela de um período contra os meses que existem.
 *
 * `disponiveis` é a lista de colunas com dado, em ordem — a mesma que a tela usa
 * para o seletor de mês. Recortar contra ela é o que impede um trimestre pedido
 * em outubro de devolver um novembro que ainda não fechou.
 */
export function resolverPeriodo(
  tipo: TipoPeriodo,
  mesFoco: string,
  disponiveis: string[],
): Periodo {
  const c = parseColuna(mesFoco);
  const existe = new Set(disponiveis);

  // Mês que não parseia (ou fora da lista) não vira janela nenhuma: devolve ele
  // mesmo, e quem desenha mostra o vazio de sempre.
  if (!c) {
    return { tipo: "mes", meses: [mesFoco], mesFoco, rotulo: curto(mesFoco), parcial: false };
  }

  /** Primeiro mês da fatia do calendário a que o foco pertence. */
  const inicio = (() => {
    if (tipo === "ultimos12") return null;              // janela móvel, não do calendário
    const tam = TAMANHO[tipo];
    const indice = Math.floor((c.mes - 1) / tam) * tam; // 0-based dentro do ano
    return { ano: c.ano, mes: indice + 1 };
  })();

  const alvo: string[] = [];
  if (tipo === "ultimos12") {
    // Termina NO FOCO e anda para trás pela lista de disponíveis — assim um mês
    // sem dado no meio não desloca a janela para fora do ano.
    const i = disponiveis.indexOf(mesFoco);
    const fim = i >= 0 ? i : disponiveis.length - 1;
    alvo.push(...disponiveis.slice(Math.max(0, fim - 11), fim + 1));
  } else {
    for (let k = 0; k < TAMANHO[tipo]; k++) {
      const total = inicio!.ano * 12 + (inicio!.mes - 1) + k;
      const col = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][total % 12]}-${String(Math.floor(total / 12) % 100).padStart(2, "0")}`;
      // Não passa do foco: o trimestre do mês em curso é o que já fechou dele.
      if (total > c.ano * 12 + (c.mes - 1)) break;
      if (existe.has(col)) alvo.push(col);
    }
  }

  const meses = alvo.length ? alvo : [mesFoco];
  const completo = tipo === "ultimos12" ? 12 : TAMANHO[tipo];
  return {
    tipo,
    meses,
    mesFoco: meses[meses.length - 1],
    rotulo: rotuloDoPeriodo(tipo, meses, c.ano, c.mes),
    parcial: meses.length < completo,
  };
}

function rotuloDoPeriodo(tipo: TipoPeriodo, meses: string[], ano: number, mes: number): string {
  const ultimo = meses[meses.length - 1];
  const aa = String(ano % 100).padStart(2, "0");
  switch (tipo) {
    case "mes":
      return curto(ultimo);
    case "trimestre":
      return `${Math.floor((mes - 1) / 3) + 1}T${aa}`;
    case "semestre":
      return `${Math.floor((mes - 1) / 6) + 1}S${aa}`;
    case "ano":
      // "2026" só quando dezembro está dentro; senão a pessoa leria o ano cheio
      // olhando para sete meses.
      return meses.length === 12 ? `${ano}` : `${ano} · até ${curto(ultimo).split("/")[0]}`;
    case "ultimos12":
      return `Últimos ${meses.length} meses · ${curto(meses[0])} a ${curto(ultimo)}`;
  }
}

/** O período de um mês só — o padrão de toda apresentação nova. */
export const periodoDoMes = (mes: string): Periodo => ({
  tipo: "mes", meses: [mes], mesFoco: mes, rotulo: curto(mes), parcial: false,
});

/**
 * Soma uma medida ao longo da janela.
 *
 * Existe para o card não ter de decidir sozinho o que fazer com mês sem valor:
 * `null` é buraco (não zero), e uma janela inteira de buracos devolve `null` em
 * vez de um zero que passa por resultado.
 */
export function somarNoPeriodo(
  periodo: Periodo,
  ler: (mes: string) => number | null,
): number | null {
  let total: number | null = null;
  for (const m of periodo.meses) {
    const v = ler(m);
    if (v != null && isFinite(v)) total = (total ?? 0) + v;
  }
  return total;
}
