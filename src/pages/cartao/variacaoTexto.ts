/* ============================================================================
 * A variação da fatura virando texto — a mensagem que se manda no WhatsApp.
 *
 * A tela já sabe quem gastou a mais que no mês passado e quanto. O que se faz
 * com isso, todo mês, é redigitar quatro ou cinco linhas num grupo do WhatsApp
 * ("META ADS +17,8k, DATADOG +49,4k…"). É o mesmo gesto da ponte da DRE
 * (`@/lib/copiarPonte`) e o formato aqui é o mesmo — a abreviação vem de lá, para
 * "5,0k" querer dizer a mesma coisa nos dois lugares.
 *
 * Três decisões que valem estar ditas:
 *
 * 1. O SINAL É O DA FATURA. No cartão tudo é despesa e `+17,8k` já quer dizer
 *    "passou R$ 17,8 mil a mais por aqui". Na DRE o delta troca de sinal em
 *    despesa e por isso lá existe `deltaModulo`; aqui não existe essa armadilha
 *    e o delta cru é o que se escreve.
 *
 * 2. O CORTE É EXPLÍCITO E FECHA A CONTA. A fatura tem mais de cem
 *    estabelecimentos e quase todos se mexeram alguns reais — uma mensagem com
 *    cem linhas não é mensagem. Então corta-se por valor, mas quem ficou de fora
 *    entra somado na última linha ("+ mais 23 estabelecimentos (+4,2k)"): a soma
 *    das linhas continua batendo com o VAR do cabeçalho, e ninguém precisa
 *    perguntar "e o resto?".
 *
 * 3. O NOME É O QUE A TELA MOSTRA. O OFX entrega "JIM.COM GRUPO SOUZA"; quem lê
 *    a mensagem quer "Café dos eventos". Nos formatos de mensagem vai junto o
 *    "o que é" do cadastro (Parametrização), que é o que responde a pergunta
 *    seguinte; no formato de tracker vai o nome cru entre parênteses, que é o
 *    que se procura na fatura e no Omie.
 * ========================================================================== */

import { abreviar } from "@/lib/copiarPonte";
import type { Analise, Mes } from "./analise";
import { fmtBRLStr } from "./fmt";

/** Sobre qual matriz o texto é escrito — as duas da tela. */
export type Eixo = "estabelecimento" | "categoria";
/** Que lado da variação vai no texto. */
export type Bloco = "subiu" | "caiu" | "ambos";
/** Como o texto sai. O padrão (`enxuto`) é o que cabe numa mensagem. */
export type Formato = "enxuto" | "completo" | "contexto";

export type Movimento = "entrou" | "voltou" | "saiu" | "subiu" | "caiu";

export type PecaCartao = {
  /** O nome como está no banco — é por ele que se procura na fatura. */
  chave: string;
  /** O nome que a tela mostra: o apelido quando existe. */
  nome: string;
  oQueE: string | null;
  anterior: number;
  atual: number;
  /** `atual - anterior`. Positivo = gastou a mais. */
  delta: number;
  movimento: Movimento;
};

export type VariacaoFatura = {
  eixo: Eixo;
  /** "ago/26" — a última fatura do recorte. */
  mes: string;
  mesAnterior: string;
  soma: number;
  somaAnterior: number;
  delta: number;
  pct: number | null;
  /** Gastou a mais, do que mais pesou para o que menos. */
  subiu: PecaCartao[];
  /** Gastou a menos, na mesma ordem de peso. */
  caiu: PecaCartao[];
};

/** O que a tela sabe sobre o nome — vem de `apelidoDe` (`@/lib/apelidos`). */
export type NomeExibido = { nome: string; oQueE?: string | null };
export type ResolverNome = (chave: string) => NomeExibido | null;

/* ------------------------------------------------------------------ */

/** Dinheiro do jeito que se escreve numa mensagem: em módulo, com centavos.
 *
 *  `toLocaleString` põe espaço RÍGIDO depois do "R$", e este texto vai para um
 *  WhatsApp, um comentário de Excel, uma caixa de busca. Trocar por espaço comum
 *  é o que faz o copiado ser igual ao que se digitaria à mão. */
const brl = (n: number) => fmtBRLStr(Math.abs(n)).replace(/[\u00a0\u202f]/g, " ");

const comSinal = (n: number) => `${n >= 0 ? "+" : "-"}${abreviar(n)}`;

const somaDelta = (pecas: PecaCartao[]) => pecas.reduce((s, p) => s + p.delta, 0);

const SUBSTANTIVO: Record<Eixo, [string, string]> = {
  estabelecimento: ["estabelecimento", "estabelecimentos"],
  categoria: ["categoria", "categorias"],
};

const plural = (eixo: Eixo, n: number) => SUBSTANTIVO[eixo][n === 1 ? 0 : 1];

/** Rótulo dos meses quando a fatura não trouxe um. */
const labelMes = (m: Mes | undefined) => m?.label ?? "";

/* ------------------------------------------------------------------ */

/**
 * A última fatura do recorte contra a anterior, peça a peça.
 *
 * Devolve `null` com menos de duas faturas — sem base não há variação, e é o que
 * faz o botão sumir em vez de copiar uma mensagem sem sentido.
 */
export function variacaoDaFatura(
  a: Analise,
  eixo: Eixo,
  nomeDe?: ResolverNome,
): VariacaoFatura | null {
  const n = a.meses.length;
  if (n < 2 || !a.ultimo || !a.penultimo) return null;

  const linhas = eixo === "categoria" ? a.categorias : a.estabelecimentos;

  const pecas: PecaCartao[] = linhas.map((l) => {
    const atual = l.porMes[n - 1] ?? 0;
    const anterior = l.porMes[n - 2] ?? 0;
    const delta = atual - anterior;
    /* "voltou" existe porque `novo` da matriz é mais forte do que "não veio no
       mês passado": um fornecedor que gastou em maio, sumiu em julho e reapareceu
       em agosto não é novo — e chamá-lo de novo mandaria alguém procurar uma
       cobrança indevida que não existe. */
    const movimento: Movimento =
      anterior === 0 && atual > 0 ? (l.novo ? "entrou" : "voltou")
      : atual === 0 && anterior > 0 ? "saiu"
      : delta >= 0 ? "subiu" : "caiu";
    const ap = nomeDe?.(l.chave) ?? null;
    return {
      chave: l.chave,
      nome: ap?.nome || l.chave,
      oQueE: ap?.oQueE ?? null,
      anterior,
      atual,
      delta,
      movimento,
    };
  });

  return {
    eixo,
    mes: labelMes(a.meses[n - 1]),
    mesAnterior: labelMes(a.meses[n - 2]),
    soma: a.ultimo.gastos,
    somaAnterior: a.penultimo.gastos,
    delta: a.deltaUltimo,
    pct: a.pctUltimo,
    subiu: pecas.filter((p) => p.delta > 0).sort((x, y) => y.delta - x.delta),
    caiu: pecas.filter((p) => p.delta < 0).sort((x, y) => x.delta - y.delta),
  };
}

/* ------------------------------------------------------------------ */

/** Os cortes oferecidos na tela. `0` = leva todo mundo. */
export const CORTES = [1000, 5000, 0] as const;

export type Recorte = { levadas: PecaCartao[]; fora: PecaCartao[] };

/**
 * Quem cabe na mensagem e quem vira uma linha só no fim.
 *
 * O corte NUNCA esvazia uma lista: se ninguém alcança o valor, o maior fica
 * assim mesmo. Uma seção intitulada "gastou a mais" sem nenhum nome embaixo
 * seria pior do que uma linha pequena.
 */
export function recortar(pecas: PecaCartao[], corte: number): Recorte {
  if (!corte || !pecas.length) return { levadas: pecas, fora: [] };
  const levadas = pecas.filter((p) => Math.abs(p.delta) >= corte);
  if (!levadas.length) return { levadas: [pecas[0]], fora: pecas.slice(1) };
  return { levadas, fora: pecas.filter((p) => Math.abs(p.delta) < corte) };
}

/* ------------------------------------------------------------------ */

type Secao = { titulo: string | null; pecas: PecaCartao[] };

function secoes(v: VariacaoFatura, bloco: Bloco): Secao[] {
  if (bloco === "subiu") return [{ titulo: null, pecas: v.subiu }];
  if (bloco === "caiu") return [{ titulo: null, pecas: v.caiu }];
  return [
    { titulo: "Gastou a mais", pecas: v.subiu },
    { titulo: "Gastou a menos", pecas: v.caiu },
  ];
}

function totalDoBloco(v: VariacaoFatura, bloco: Bloco): number {
  if (bloco === "subiu") return somaDelta(v.subiu);
  if (bloco === "caiu") return somaDelta(v.caiu);
  return v.delta;
}

/** O que vai entre parênteses depois do nome, conforme o uso do texto. */
function notaDoNome(p: PecaCartao, formato: Formato): string {
  if (formato === "completo") {
    // No tracker o que serve é o nome cru: é o que se procura na fatura.
    return p.nome !== p.chave ? ` (${p.chave})` : "";
  }
  /* Numa mensagem serve o que a coisa É. Frase longa fica de fora: ela viraria
     duas linhas de explicação para um número de uma linha. */
  const oQueE = (p.oQueE ?? "").trim();
  return oQueE && oQueE.length <= 48 ? ` (${oQueE})` : "";
}

const MARCA: Partial<Record<Movimento, string>> = {
  entrou: " (novo)",
  voltou: " (voltou)",
  saiu: " (saiu)",
};

function linha(p: PecaCartao, formato: Formato): string {
  const nome = `${p.nome}${notaDoNome(p, formato)}`;
  if (formato === "completo") {
    return `${nome} ${brl(p.anterior)} → ${brl(p.atual)} (${comSinal(p.delta)})`;
  }
  /* Sem os dois valores, "+2,1k" num estabelecimento que não existia no mês
     passado passaria por aumento de quem já estava lá. */
  return `${nome} ${comSinal(p.delta)}${MARCA[p.movimento] ?? ""}`;
}

function pctDaVariacao(v: VariacaoFatura): string {
  if (v.pct == null || Math.abs(v.delta) < 0.005) return "";
  return ` (${v.pct > 0 ? "+" : "-"}${Math.round(Math.abs(v.pct) * 100)}%)`;
}

function cabecalho(v: VariacaoFatura, bloco: Bloco, formato: Formato, total: number): string {
  const porCategoria = v.eixo === "categoria" ? " por categoria" : "";

  if (formato === "enxuto") {
    if (bloco === "subiu") return `Cartão ${v.mes}${porCategoria}: quem gastou a mais que ${v.mesAnterior} (${comSinal(total)}).`;
    if (bloco === "caiu") return `Cartão ${v.mes}${porCategoria}: quem gastou a menos que ${v.mesAnterior} (${comSinal(total)}).`;
    if (Math.abs(total) < 0.005) return `Cartão ${v.mes}${porCategoria}: mesmo total de ${v.mesAnterior}.`;
    return `Cartão ${v.mes}${porCategoria}: ${total > 0 ? "aumento" : "queda"} de ${abreviar(total)} vs ${v.mesAnterior}.`;
  }

  /* `VAR` é como a linha se chama no tracker — e o "cartão jul/26 → ago/26"
     ancora a mensagem para quem não está com a tela aberta. */
  const qualifica = bloco === "subiu" ? "gastou a mais"
    : bloco === "caiu" ? "gastou a menos"
    : `${v.subiu.length} ${plural(v.eixo, v.subiu.length)} a mais, ${v.caiu.length} a menos`;
  const varLinha = `VAR ${brl(total)} (${qualifica})`;

  if (formato === "contexto") {
    return [
      `Cartão corporativo${porCategoria} · ${v.mesAnterior} → ${v.mes}`,
      `${brl(v.somaAnterior)} → ${brl(v.soma)}${pctDaVariacao(v)}`,
      varLinha,
    ].join("\n");
  }
  return `${varLinha} · cartão ${v.mesAnterior} → ${v.mes}`;
}

/**
 * A variação da fatura em texto, pronta para mandar numa mensagem ou colar no
 * tracker. Devolve string vazia quando não há nada no bloco escolhido — quem
 * chama decide se some com o botão ou avisa.
 */
export function textoDaVariacao(
  v: VariacaoFatura,
  opcoes: { formato: Formato; bloco: Bloco; corte: number },
): string {
  const { formato, bloco, corte } = opcoes;
  const partes = secoes(v, bloco).filter((s) => s.pecas.length > 0);
  if (!partes.length) return "";

  const blocos: string[] = [cabecalho(v, bloco, formato, totalDoBloco(v, bloco))];

  for (const s of partes) {
    const { levadas, fora } = recortar(s.pecas, corte);
    const corpo = levadas.map((p) => linha(p, formato));
    if (fora.length) {
      corpo.push(`+ mais ${fora.length} ${plural(v.eixo, fora.length)} (${comSinal(somaDelta(fora))})`);
    }
    // Subtítulo só quando há duas listas no texto: com uma só, ele repetiria em
    // maiúsculas o que o cabeçalho acabou de dizer.
    if (partes.length > 1 && s.titulo) {
      blocos.push(`${s.titulo.toUpperCase()} (${brl(somaDelta(s.pecas))})\n${corpo.join("\n")}`);
    } else {
      blocos.push(corpo.join("\n"));
    }
  }

  return blocos.join("\n\n");
}

/** Quantas linhas de nome o texto vai levar — é o que o rodapé da prévia diz. */
export function quantasLinhas(v: VariacaoFatura, bloco: Bloco, corte: number): number {
  return secoes(v, bloco)
    .filter((s) => s.pecas.length > 0)
    .reduce((n, s) => {
      const { levadas, fora } = recortar(s.pecas, corte);
      return n + levadas.length + (fora.length ? 1 : 0);
    }, 0);
}