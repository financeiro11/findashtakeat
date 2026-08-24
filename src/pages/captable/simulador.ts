// ============================================================================
// Simulador de rodadas — a conta que hoje se faz no Excel.
//
// O QUE ELE RESPONDE
// "Se entrarem R$ X a um pre-money de R$ Y, e a gente aumentar o pool para Z%,
//  com quanto cada um fica?" — e a versão encadeada disso: A, depois B, depois C.
//
// POR QUE ISTO É UM ARQUIVO .ts SEM REACT
// Porque é aritmética, e aritmética se confere com teste, não olhando a tela.
// A diferença entre pool PRÉ e PÓS-money é um erro clássico de planilha (muda
// quem paga a diluição, e o fundador some 2 pontos sem ninguém entender por quê);
// aqui ela é explícita, tem nome e tem caso de teste ao lado.
//
// AS DUAS CONVENÇÕES DE POOL — o coração disto
//   • PRÉ-money: o pool novo nasce ANTES do dinheiro entrar. Ele sai do bolso de
//     quem já estava lá; o investidor entra já com o pool formado e não dilui por
//     causa dele. É o que o investidor sempre pede.
//   • PÓS-money: o pool nasce DEPOIS. Todos diluem junto, inclusive quem acabou
//     de comprar. É o que o fundador prefere.
// Mesmo dinheiro, mesmo valuation, resultado diferente. Por isso a escolha está
// na cara do formulário e não escondida numa constante.
// ============================================================================

/** Uma posição na base de partida: quem tem quantas ações antes de tudo. */
export interface PosicaoBase {
  id: string;
  nome: string;
  acoes: number;
  /** O pool de opções é a única posição que o simulador trata de forma especial. */
  ehPool?: boolean;
}

/** Um cheque dentro de uma rodada simulada. */
export interface Ticket {
  id: string;
  nome: string;
  valor: number;
}

export type MomentoPool = "pre" | "pos" | "nenhum";
export type BaseValuation = "pre" | "post";

export interface RodadaSimulada {
  id: string;
  nome: string;
  moeda: "BRL" | "USD";
  /** O valuation informado — pre-money ou post-money, conforme `baseValuation`. */
  valuation: number;
  baseValuation: BaseValuation;
  tickets: Ticket[];
  /** Alvo do pool DEPOIS da rodada, em % do capital totalmente diluído. */
  poolAlvoPct: number;
  momentoPool: MomentoPool;
}

export interface PosicaoResultado {
  id: string;
  nome: string;
  ehPool: boolean;
  /** Entrou nesta rodada (investidor novo). */
  novo: boolean;
  acoesAntes: number;
  acoes: number;
  pctAntes: number;
  pct: number;
  /** Variação em pontos percentuais — negativa é diluição. */
  deltaPct: number;
  /** Quanto pôs de dinheiro nesta rodada (0 para quem não participou). */
  investido: number;
}

export interface ResultadoRodada {
  rodada: RodadaSimulada;
  /** Erro que impede a conta (ex.: pool + investidores passam de 100%). */
  erro?: string;
  preMoney: number;
  postMoney: number;
  totalCaptado: number;
  precoPorAcao: number;
  acoesInvestidores: number;
  acoesPoolNovas: number;
  acoesAntes: number;
  acoesDepois: number;
  pctInvestidores: number;
  pctPool: number;
  /** Diluição de quem já estava, em pontos percentuais somados. */
  diluicaoTotalPP: number;
  posicoes: PosicaoResultado[];
}

const EPS = 1e-9;

const arred = (n: number) => Math.round(n * 1e6) / 1e6;

/** Uma rodada em branco, pronta para o formulário. */
export function rodadaVazia(indice: number, moeda: "BRL" | "USD" = "BRL"): RodadaSimulada {
  const nomes = ["Series B", "Series C", "Series D", "Series E"];
  return {
    id: `sim-${indice}-${nomes[indice] ?? indice}`,
    nome: nomes[indice] ?? `Rodada ${indice + 1}`,
    moeda,
    valuation: 0,
    baseValuation: "pre",
    tickets: [{ id: `t-${indice}-0`, nome: "Investidor líder", valor: 0 }],
    poolAlvoPct: 0,
    momentoPool: "nenhum",
  };
}

/**
 * Roda UMA rodada sobre uma base de posições.
 *
 * A conta, em ordem:
 *   1. `preMoney` — se o usuário informou post-money, desconta o captado.
 *   2. O pool, quando é PRÉ-money, entra na conta ANTES do preço sair:
 *      o total pós-rodada T é tal que quem já estava (fora o pool) fique com
 *      exatamente `1 − %investidores − %pool` do capital. Daí saem, de uma vez,
 *      as ações do pool e as dos investidores.
 *   3. O preço por ação é sempre `preMoney ÷ ações pré-money` — e "ações
 *      pré-money" inclui o pool novo quando ele é PRÉ. É por isso que o pool
 *      PRÉ derruba o preço: o mesmo valuation dividido por mais ações.
 */
export function simularRodada(base: PosicaoBase[], rodada: RodadaSimulada): ResultadoRodada {
  const acoesAntes = base.reduce((s, p) => s + p.acoes, 0);
  const totalCaptado = rodada.tickets.reduce((s, t) => s + (t.valor || 0), 0);

  const preMoney = rodada.baseValuation === "pre" ? rodada.valuation : rodada.valuation - totalCaptado;
  const postMoney = preMoney + totalCaptado;

  const poolAtual = base.filter((p) => p.ehPool).reduce((s, p) => s + p.acoes, 0);
  const naoPool = acoesAntes - poolAtual;
  const alvo = rodada.momentoPool === "nenhum" ? 0 : Math.max(0, rodada.poolAlvoPct) / 100;

  const vazio: ResultadoRodada = {
    rodada, preMoney, postMoney, totalCaptado,
    precoPorAcao: 0, acoesInvestidores: 0, acoesPoolNovas: 0,
    acoesAntes, acoesDepois: acoesAntes,
    pctInvestidores: 0, pctPool: acoesAntes > 0 ? (poolAtual / acoesAntes) * 100 : 0,
    diluicaoTotalPP: 0,
    posicoes: [],
  };

  if (acoesAntes <= 0) return { ...vazio, erro: "A base não tem ações — escolha um cap table de partida." };
  if (preMoney <= 0) {
    return {
      ...vazio,
      erro: rodada.baseValuation === "post"
        ? "O post-money informado é menor que o total captado — não sobra pre-money."
        : "Informe um pre-money maior que zero.",
    };
  }

  const pctInvestidores = totalCaptado / postMoney;

  let acoesPoolNovas = 0;
  let acoesInvestidores = 0;
  let acoesDepois = 0;
  let preco = 0;

  if (rodada.momentoPool === "pre" && alvo > 0) {
    // O pool nasce antes do dinheiro: quem já estava (fora o pool) fica com o resto.
    const resto = 1 - pctInvestidores - alvo;
    if (resto <= EPS) {
      return { ...vazio, erro: "Investidores + pool passam de 100% do capital. Reduza o pool ou o cheque." };
    }
    acoesDepois = naoPool / resto;
    const poolFinal = acoesDepois * alvo;
    acoesPoolNovas = Math.max(0, poolFinal - poolAtual);
    acoesInvestidores = acoesDepois * pctInvestidores;
    // Preço = pre-money ÷ (ações que existem ANTES do dinheiro, já com o pool novo).
    preco = preMoney / (acoesDepois - acoesInvestidores);
  } else {
    // Sem pool, ou pool depois do dinheiro: o preço sai do capital atual.
    preco = preMoney / acoesAntes;
    acoesInvestidores = totalCaptado / preco;
    const depoisDoDinheiro = acoesAntes + acoesInvestidores;
    if (rodada.momentoPool === "pos" && alvo > 0) {
      if (alvo >= 1 - EPS) {
        return { ...vazio, erro: "Um pool de 100% do capital não faz sentido." };
      }
      // (poolAtual + add) / (T + add) = alvo
      acoesPoolNovas = Math.max(0, (alvo * depoisDoDinheiro - poolAtual) / (1 - alvo));
    }
    acoesDepois = depoisDoDinheiro + acoesPoolNovas;
  }

  const pctDe = (a: number, total: number) => (total > 0 ? (a / total) * 100 : 0);

  const posicoes: PosicaoResultado[] = base.map((p) => {
    const acoes = p.ehPool ? p.acoes + acoesPoolNovas : p.acoes;
    return {
      id: p.id,
      nome: p.nome,
      ehPool: !!p.ehPool,
      novo: false,
      acoesAntes: p.acoes,
      acoes: arred(acoes),
      pctAntes: pctDe(p.acoes, acoesAntes),
      pct: pctDe(acoes, acoesDepois),
      deltaPct: pctDe(acoes, acoesDepois) - pctDe(p.acoes, acoesAntes),
      investido: 0,
    };
  });

  // Se a base não tem pool e o usuário pediu pool, cria a posição.
  if (acoesPoolNovas > 0 && poolAtual === 0) {
    posicoes.push({
      id: "pool-novo",
      nome: "Pool de opções (novo)",
      ehPool: true,
      novo: true,
      acoesAntes: 0,
      acoes: arred(acoesPoolNovas),
      pctAntes: 0,
      pct: pctDe(acoesPoolNovas, acoesDepois),
      deltaPct: pctDe(acoesPoolNovas, acoesDepois),
      investido: 0,
    });
  }

  // Os investidores da rodada. Quem já está na base entra na linha que já existe
  // (senão "DGF" apareceria duas vezes e o % de cada uma mentiria).
  for (const t of rodada.tickets) {
    if (!t.valor || t.valor <= 0) continue;
    const acoes = t.valor / preco;
    const existente = posicoes.find((p) => p.nome.trim().toLowerCase() === t.nome.trim().toLowerCase());
    if (existente) {
      existente.acoes = arred(existente.acoes + acoes);
      existente.pct = pctDe(existente.acoes, acoesDepois);
      existente.deltaPct = existente.pct - existente.pctAntes;
      existente.investido += t.valor;
    } else {
      posicoes.push({
        id: t.id,
        nome: t.nome.trim() || "Investidor",
        ehPool: false,
        novo: true,
        acoesAntes: 0,
        acoes: arred(acoes),
        pctAntes: 0,
        pct: pctDe(acoes, acoesDepois),
        deltaPct: pctDe(acoes, acoesDepois),
        investido: t.valor,
      });
    }
  }

  const diluicaoTotalPP = posicoes
    .filter((p) => p.acoesAntes > 0)
    .reduce((s, p) => s + Math.min(0, p.deltaPct), 0);

  return {
    rodada,
    preMoney,
    postMoney,
    totalCaptado,
    precoPorAcao: preco,
    acoesInvestidores: arred(acoesInvestidores),
    acoesPoolNovas: arred(acoesPoolNovas),
    acoesAntes,
    acoesDepois: arred(acoesDepois),
    pctInvestidores: pctInvestidores * 100,
    pctPool: pctDe(posicoes.filter((p) => p.ehPool).reduce((s, p) => s + p.acoes, 0), acoesDepois),
    diluicaoTotalPP,
    posicoes: posicoes.sort((a, b) => b.acoes - a.acoes),
  };
}

/** Encadeia as rodadas: a saída de uma é a base da seguinte. */
export function simular(base: PosicaoBase[], rodadas: RodadaSimulada[]): ResultadoRodada[] {
  const saida: ResultadoRodada[] = [];
  let atual = base;
  for (const r of rodadas) {
    const res = simularRodada(atual, r);
    saida.push(res);
    if (res.erro) break; // sem conta válida, encadear só propaga o erro
    atual = res.posicoes.map((p) => ({ id: p.id, nome: p.nome, acoes: p.acoes, ehPool: p.ehPool }));
  }
  return saida;
}

/* ========================================================================== */
/* Sinais — o que a tela aponta sozinha, sem IA                               */
/* ========================================================================== */

export type Gravidade = "info" | "atencao" | "alerta";

export interface Sinal {
  chave: string;
  gravidade: Gravidade;
  titulo: string;
  /** Os números do sinal, já formatados — a IA copia, não recalcula. */
  detalhe: string;
}

/** Marcos de controle que importam numa cap table (e por que importam). */
const LIMIARES_CONTROLE = [
  { pct: 50, nome: "maioria simples", oque: "deixa de decidir sozinho o que depende de maioria" },
  { pct: 33.4, nome: "minoria de bloqueio", oque: "perde o poder de barrar deliberação qualificada" },
  { pct: 25, nome: "um quarto do capital", oque: "passa a depender de coligação para qualquer bloqueio" },
];

/**
 * Lê os resultados e produz os sinais — determinístico, sem IA.
 *
 * Mesmo padrão do cartão e das justificativas da DRE: o critério do que É
 * relevante mora aqui, em código, e não pode variar de simulação para simulação.
 * A IA depois escreve por cima destes fatos; ela não escolhe o que importa.
 */
export function sinaisDaSimulacao(
  resultados: ResultadoRodada[],
  opts: { nomeFundador?: string; precoAnterior?: number; moedaPrecoAnterior?: "BRL" | "USD" } = {},
): Sinal[] {
  const sinais: Sinal[] = [];
  const validos = resultados.filter((r) => !r.erro);
  if (!validos.length) return sinais;

  const fmt = (n: number, moeda: "BRL" | "USD", casas = 2) =>
    moeda === "USD"
      ? n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: casas, maximumFractionDigits: casas })
      : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
  const pp = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2).replace(".", ",")} p.p.`;
  const pc = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;

  const nomeFundador = opts.nomeFundador?.toLowerCase();
  const achaFundador = (r: ResultadoRodada) =>
    nomeFundador ? r.posicoes.find((p) => p.nome.toLowerCase() === nomeFundador) : undefined;

  for (const r of validos) {
    const nome = r.rodada.nome;

    // 1. Quem paga a diluição — e quanto dela é pool, não dinheiro.
    if (r.acoesPoolNovas > 0) {
      const pctPoolNovo = (r.acoesPoolNovas / r.acoesDepois) * 100;
      sinais.push({
        chave: `${r.rodada.id}:pool`,
        gravidade: r.rodada.momentoPool === "pre" ? "atencao" : "info",
        titulo:
          r.rodada.momentoPool === "pre"
            ? `${nome}: o pool é PRÉ-money — quem já estava paga por ele`
            : `${nome}: o pool é PÓS-money — todos pagam junto`,
        detalhe:
          `Pool sobe para ${pc(r.pctPool)} do capital (${Math.round(r.acoesPoolNovas).toLocaleString("pt-BR")} ações novas, ` +
          `${pc(pctPoolNovo)} do total pós-rodada). Preço por ação: ${fmt(r.precoPorAcao, r.rodada.moeda)}.`,
      });
    }

    // 2. Diluição de quem já estava.
    sinais.push({
      chave: `${r.rodada.id}:diluicao`,
      gravidade: Math.abs(r.diluicaoTotalPP) >= 25 ? "atencao" : "info",
      titulo: `${nome}: a base existente cede ${pc(Math.abs(r.diluicaoTotalPP))} do capital`,
      detalhe:
        `Investidores da rodada ficam com ${pc(r.pctInvestidores)} por ${fmt(r.totalCaptado, r.rodada.moeda, 0)}. ` +
        `Pre-money ${fmt(r.preMoney, r.rodada.moeda, 0)} → post-money ${fmt(r.postMoney, r.rodada.moeda, 0)}.`,
    });

    // 3. Cruzou um limiar de controle?
    const f = achaFundador(r);
    if (f) {
      for (const lim of LIMIARES_CONTROLE) {
        if (f.pctAntes > lim.pct && f.pct <= lim.pct) {
          sinais.push({
            chave: `${r.rodada.id}:controle-${lim.pct}`,
            gravidade: "alerta",
            titulo: `${nome}: ${f.nome} cruza a ${lim.nome} (${pc(lim.pct)})`,
            detalhe: `Vai de ${pc(f.pctAntes)} para ${pc(f.pct)} (${pp(f.deltaPct)}) — ${lim.oque}.`,
          });
        }
      }
    }

    // 4. Cheque maior que o de quem hoje é o maior sócio de fora.
    const maiorTicket = [...r.posicoes].filter((p) => p.investido > 0).sort((a, b) => b.investido - a.investido)[0];
    if (maiorTicket && maiorTicket.pct > 20) {
      sinais.push({
        chave: `${r.rodada.id}:lead`,
        gravidade: maiorTicket.pct >= 30 ? "atencao" : "info",
        titulo: `${nome}: ${maiorTicket.nome} sai com ${pc(maiorTicket.pct)} do capital`,
        detalhe: `Cheque de ${fmt(maiorTicket.investido, r.rodada.moeda, 0)} — o maior da rodada.`,
      });
    }
  }

  // 5. Preço da rodada contra o preço da última rodada real (up/down round).
  const primeira = validos[0];
  if (opts.precoAnterior && opts.precoAnterior > 0 && primeira.rodada.moeda === (opts.moedaPrecoAnterior ?? "USD")) {
    const mult = primeira.precoPorAcao / opts.precoAnterior;
    const down = mult < 1;
    sinais.push({
      chave: "preco-vs-anterior",
      gravidade: down ? "alerta" : "info",
      titulo: down
        ? `${primeira.rodada.nome} sai como down round`
        : `${primeira.rodada.nome} sai a ${mult.toFixed(2).replace(".", ",")}× o preço da última rodada`,
      detalhe:
        `Preço simulado ${fmt(primeira.precoPorAcao, primeira.rodada.moeda)} contra ` +
        `${fmt(opts.precoAnterior, opts.moedaPrecoAnterior ?? "USD")} da Series A de dez/2025.`,
    });
  }

  // 6. Diluição acumulada, quando há mais de uma rodada encadeada.
  if (validos.length > 1) {
    const f0 = achaFundador(validos[0]);
    const fN = achaFundador(validos[validos.length - 1]);
    if (f0 && fN) {
      sinais.push({
        chave: "acumulado",
        gravidade: fN.pct < 25 ? "alerta" : fN.pct < 40 ? "atencao" : "info",
        titulo: `Ao fim de ${validos.length} rodadas, ${fN.nome} fica com ${pc(fN.pct)}`,
        detalhe: `Partia de ${pc(f0.pctAntes)} — diluição acumulada de ${pp(fN.pct - f0.pctAntes)}.`,
      });
    }
    const captadoTotal = validos.reduce((s, r) => s + r.totalCaptado, 0);
    sinais.push({
      chave: "captado-total",
      gravidade: "info",
      titulo: `Captação somada das ${validos.length} rodadas`,
      detalhe: `${fmt(captadoTotal, validos[0].rodada.moeda, 0)} · valuation final ${fmt(validos[validos.length - 1].postMoney, validos[validos.length - 1].rodada.moeda, 0)}.`,
    });
  }

  return sinais;
}

/**
 * Assinatura do cenário — muda quando muda o RESULTADO, não a digitação.
 * É o que evita chamar a IA a cada tecla: enquanto a assinatura for a mesma, o
 * comentário que está na tela continua valendo.
 */
export function assinatura(resultados: ResultadoRodada[]): string {
  return resultados
    .map((r) =>
      r.erro
        ? `${r.rodada.id}:erro`
        : [
            r.rodada.id,
            Math.round(r.preMoney),
            Math.round(r.totalCaptado),
            r.rodada.momentoPool,
            r.rodada.poolAlvoPct,
            Math.round(r.precoPorAcao * 100),
            ...r.posicoes.map((p) => `${p.id}=${Math.round(p.pct * 100)}`),
          ].join("|"),
    )
    .join("//");
}
