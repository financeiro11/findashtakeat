/**
 * De onde sai a categoria de cada lojista do cartão.
 *
 * A resposta não é "a IA chuta" nem "alguém digita 94 vezes": a empresa já
 * classificou estes mesmos lojistas, à mão, dentro do Omie. Este módulo vai
 * buscar essa decisão — o de-para é, literalmente, a prática da casa.
 *
 * ------------------------------------------------------------------
 * O NOME É LIDO, NÃO ADIVINHADO (desde 27/08/2026)
 * ------------------------------------------------------------------
 * A lista de movimentos do Omie NÃO traz nome de lojista: a contraparte de todo
 * gasto de cartão é o carimbo "Lancamento Fatura Cartao". Por isso a primeira
 * versão deste módulo casava fatura e título por VALOR exato + data próxima —
 * era o que havia.
 *
 * Era, também, adivinhação que errava calado. Medido no de-para que estava em
 * produção em 27/08/2026:
 *
 *     GOOGLE ADS → "3.2.7.1 Pessoal - Onboarding", 4 de 7 votos
 *
 * quando os 59 títulos de Google Ads lançados à mão estão, todos, em
 * "3.1.3.7 Adsense - Marketing". Uma veiculação de mídia tem o valor de qualquer
 * outra coisa, e o desempate escolheu errado com cara de certo — a sugestão
 * chegava à tela com selo de confiança.
 *
 * O nome sempre esteve legível na OBSERVAÇÃO do título, guardada em
 * `omie_titulo_texto`: é o MEMO cru da fatura, o mesmo texto posicional que o
 * parser da tela já lê. `votosDoOmie` lê dali. São 2,6 mil títulos ensinando de
 * uma vez, sem empate a desfazer.
 *
 * O caminho por valor+data foi REMOVIDO junto com esta troca, e não guardado
 * como plano B: os 39 títulos sem observação nenhuma não valem manter viva uma
 * segunda porta de entrada para o mesmo erro — ainda mais uma que a trava
 * anti-autocitação da RPC `cartao_omie_lojistas` não cobriria.
 *
 * NADA AQUI ALCANÇA A DRE. Este módulo só decide de que títulos o de-para
 * aprende; não reescreve título nenhum, não muda o nome que a DRE mostra e não
 * fala com o Omie. O nome que a demonstração exibe continua saindo de
 * `memoDaObservacao` em `_shared/cartao-memo.ts`, intocado — inclusive no ponto
 * em que ele erra (ver `memoParaAprender`).
 *
 * Módulo puro: sem React, sem Supabase, sem rede. Nada aqui fala com o Omie —
 * os títulos vêm do cache local.
 */

import { chaveDe } from "./ofx";
import { ehCartao, lerMemo } from "../../../supabase/functions/_shared/cartao-memo";

/* ------------------------------------------------------------------ */

export type Origem = "historico" | "manual" | "ia";

export type EntradaMapa = {
  chave: string;
  codigoCategoria: string;
  descricaoCategoria: string | null;
  origem: Origem;
  /** Títulos deste lojista que apontaram para ESTA categoria. */
  votos: number;
  /** Títulos deste lojista, no total. `votos/examinados` é a força da entrada. */
  examinados: number;
  exemplos: string[];
};

export type Mapa = Map<string, EntradaMapa>;

/* ------------------------------------------------------------------ */

/**
 * Um lojista já classificado, uma vez — a unidade de que o de-para é feito.
 *
 * Sai de `votosDoOmie`, que o LÊ da observação do título. Um voto por título:
 * a força de uma entrada do de-para é quantos títulos a sustentam.
 */
export type Voto = {
  chave: string;
  estabelecimento: string;
  data: string;                       // 'YYYY-MM-DD'
  codigoCategoria: string;
  descricaoCategoria: string | null;
};

/**
 * A categoria de cada lojista: a que ele mais recebeu.
 *
 * Empate é resolvido pela categoria com o lançamento mais recente: quando um
 * fornecedor muda de rubrica no meio do ano, a decisão nova é a que vale (é a
 * mesma leitura do alerta de reclassificação da DRE/DFC).
 */
export function aprenderVotos(votos: Voto[]): Mapa {
  type Acc = {
    porCategoria: Map<string, { n: number; ultima: string; descricao: string | null }>;
    exemplos: Set<string>;
    total: number;
  };
  const acc = new Map<string, Acc>();

  for (const v of votos) {
    if (!v.chave || !v.codigoCategoria) continue;
    const a = acc.get(v.chave)
      ?? { porCategoria: new Map(), exemplos: new Set<string>(), total: 0 };
    const c = a.porCategoria.get(v.codigoCategoria)
      ?? { n: 0, ultima: "", descricao: v.descricaoCategoria };
    c.n++;
    if (v.data > c.ultima) c.ultima = v.data;
    a.porCategoria.set(v.codigoCategoria, c);
    a.exemplos.add(v.estabelecimento);
    a.total++;
    acc.set(v.chave, a);
  }

  const mapa: Mapa = new Map();
  for (const [chave, a] of acc) {
    const [cod, c] = [...a.porCategoria.entries()].reduce((x, y) =>
      y[1].n > x[1].n || (y[1].n === x[1].n && y[1].ultima > x[1].ultima) ? y : x,
    );
    mapa.set(chave, {
      chave,
      codigoCategoria: cod,
      descricaoCategoria: c.descricao,
      origem: "historico",
      votos: c.n,
      examinados: a.total,
      exemplos: [...a.exemplos].slice(0, 5),
    });
  }
  return mapa;
}

/* ------------------------------------------------------------------ */

export type Sugestao = {
  codigoCategoria: string;
  descricaoCategoria: string | null;
  origem: Origem;
  /**
   * "alta"  → escolha manual, ou histórico unânime com 3+ títulos;
   * "media" → histórico com maioria folgada;
   * "baixa" → um único título sustentando, histórico dividido, ou IA.
   * A tela usa isto para decidir o que exigir de conferência — e não para
   * esconder nada: toda linha continua editável.
   */
  confianca: "alta" | "media" | "baixa";
};

export function sugerir(mapa: Mapa, chave: string): Sugestao | null {
  const e = mapa.get(chave);
  if (!e) return null;

  const unanime = e.votos === e.examinados;
  // A razão votos/examinados sozinha engana: um único título dá 1,0 e
  // pareceria unânime. Volume e concordância são exigidos juntos.
  const confianca: Sugestao["confianca"] =
    e.origem === "manual" ? "alta"
      : e.origem === "ia" ? "baixa"
        : unanime && e.votos >= 3 ? "alta"
          : e.votos >= 2 && e.votos / Math.max(e.examinados, 1) >= 0.7 ? "media"
            : "baixa";

  return {
    codigoCategoria: e.codigoCategoria,
    descricaoCategoria: e.descricaoCategoria,
    origem: e.origem,
    confianca,
  };
}

/* ------------------------------------------------------------------
 * O caminho bom: ler o lojista da observação do título
 * ------------------------------------------------------------------ */

/** Um título de cartão como a RPC `cartao_omie_lojistas` o devolve. */
export type TituloComTexto = {
  codTitulo: string;
  data: string | null;
  codigoCategoria: string | null;
  descricaoCategoria: string | null;
  contraparte: string | null;
  observacao: string | null;
};

/**
 * Onde o MEMO começa dentro da observação — para o APRENDIZADO, e só para ele.
 *
 * O "|" NÃO É UM SEPARADOR ÚNICO. Há dois formatos no Omie e o mesmo caractere
 * significa coisas opostas em cada um:
 *
 *   • importado pelo Omie — "carimbo|MEMO": o memo vem DEPOIS do pipe;
 *   • lançado à mão — "MEMO" ou "MEMO|anotação": o memo vem ANTES, e o que sobra
 *     é recado de quem lançou ("PRINTIV  01/04  Sao Paulo|grafica").
 *
 * `memoDaObservacao`, em `_shared/cartao-memo.ts`, corta pelo ÚLTIMO pipe: acerta
 * o primeiro caso e erra o segundo. Dos 2.649 títulos de cartão do cache em
 * 27/08/2026, 148 terminam em "|" e voltariam vazios, e outros 8 devolveriam a
 * anotação no lugar do lojista — "grafica" viraria nome de fornecedor.
 *
 * POR QUE A REGRA ESTÁ AQUI E NÃO LÁ. Consertar no módulo compartilhado consertaria
 * também o nome que a DRE mostra nesses 156 títulos e o que a `omie-cartao-nome`
 * escreve de volta no Omie — mexida que ficou fora de escopo por decisão de
 * 27/08/2026. Confinada aqui, ela só afeta de que títulos o de-para aprende;
 * nada do que já está lançado muda de nome.
 *
 * Não é um segundo leitor de MEMO: a leitura continua sendo `lerMemo`, um só. O
 * que esta função decide é onde o texto a ser lido começa.
 */
function memoParaAprender(obs: string | null | undefined): string | null {
  if (!obs) return null;

  const carimbo = obs.match(/^\s*Conta a Pagar importada automaticamente[^|]*\|/i);
  if (carimbo) {
    // NÃO faz trim à esquerda: `lerMemo` corta por POSIÇÃO de coluna (22 e 30),
    // e um espaço a menos no começo desloca tudo.
    const memo = obs.slice(carimbo[0].length);
    return memo.trim() ? memo : null;
  }

  // Carimbo sem "|" nenhum é observação truncada: sem memo para ler, e deixar
  // passar faria "Conta a Pagar impor" virar nome de lojista.
  if (/^\s*Conta a Pagar importada automaticamente/i.test(obs)) return null;

  const corte = obs.indexOf("|");
  const memo = corte >= 0 ? obs.slice(0, corte) : obs;
  return memo.trim() ? memo : null;
}

/**
 * Transforma títulos do Omie em votos, lendo o lojista da observação.
 *
 * A trava `ehCartao` vem antes de qualquer leitura, e é a mesma que
 * `lojistaDoTitulo` usa: numa conta a pagar comum a observação é o texto que o
 * fornecedor escreveu ("Link para visualizar a NFS-e: …"), e lida como MEMO —
 * que é posicional — o começo da frase viraria "estabelecimento".
 *
 * Descartar em silêncio é correto neste laço: título sem observação, sem
 * categoria ou sem data simplesmente não ensina nada. Quem precisa saber quanto
 * foi descartado é a tela, e para isso ela compara `titulos.length` com o que
 * volta daqui.
 */
export function votosDoOmie(titulos: TituloComTexto[]): Voto[] {
  const votos: Voto[] = [];
  for (const t of titulos) {
    if (!t.codigoCategoria || !t.data) continue;
    if (!ehCartao(t.contraparte)) continue;
    const memo = memoParaAprender(t.observacao);
    if (!memo) continue;
    const nome = lerMemo(memo).estabelecimento?.trim();
    if (!nome) continue;
    votos.push({
      chave: chaveDe(nome),
      estabelecimento: nome,
      data: t.data,
      codigoCategoria: t.codigoCategoria,
      descricaoCategoria: t.descricaoCategoria,
    });
  }
  return votos;
}

/* ------------------------------------------------------------------
 * A prévia
 * ------------------------------------------------------------------ */

export type Mudanca = {
  chave: string;
  /** Null quando a chave é nova. */
  de: { codigo: string; descricao: string | null } | null;
  para: { codigo: string; descricao: string | null };
  votos: number;
  examinados: number;
  exemplos: string[];
};

export type Previa = {
  novas: Mudanca[];
  /** Já existia e o aprendizado discorda da categoria que estava lá. */
  trocam: Mudanca[];
  /** Já existia e o aprendizado confirma. */
  iguais: number;
  /**
   * Estavam no de-para e o aprendizado novo não alcança — porque o lojista não
   * tem título com observação legível. NÃO são apagadas: `cartao_omie_map_gravar`
   * só faz upsert. Ficam listadas para quem confere saber que continuam valendo
   * pelo motivo antigo.
   */
  intocadas: string[];
  /** Escolhas manuais, que o aprendizado nunca sobrescreve. Contadas à parte. */
  manuaisPreservadas: number;
};

/**
 * O que gravar este aprendizado mudaria — antes de gravar.
 *
 * Existe porque a primeira execução do caminho novo reescreve um de-para inteiro
 * de uma vez, e "83 chaves viraram outra coisa" não é uma frase que alguém deva
 * ler DEPOIS. Uma troca de categoria aqui é uma troca de rubrica na DRE do mês
 * que vem.
 */
export function comparar(atual: Mapa, novo: Mapa): Previa {
  const novas: Mudanca[] = [];
  const trocam: Mudanca[] = [];
  let iguais = 0;
  let manuaisPreservadas = 0;

  for (const [chave, n] of novo) {
    const a = atual.get(chave);
    const mudanca: Mudanca = {
      chave,
      de: a ? { codigo: a.codigoCategoria, descricao: a.descricaoCategoria } : null,
      para: { codigo: n.codigoCategoria, descricao: n.descricaoCategoria },
      votos: n.votos,
      examinados: n.examinados,
      exemplos: n.exemplos,
    };
    if (!a) { novas.push(mudanca); continue; }
    // A RPC recusa sobrescrever escolha manual. Contar como "troca" o que não
    // vai trocar faria a prévia mentir para o lado que assusta.
    if (a.origem === "manual") { manuaisPreservadas++; continue; }
    if (a.codigoCategoria === n.codigoCategoria) iguais++;
    else trocam.push(mudanca);
  }

  const intocadas = [...atual.keys()].filter((c) => !novo.has(c));

  const porVolume = (x: Mudanca, y: Mudanca) => y.examinados - x.examinados;
  return {
    novas: novas.sort(porVolume),
    trocam: trocam.sort(porVolume),
    iguais,
    intocadas,
    manuaisPreservadas,
  };
}

/** Cobertura do de-para sobre uma fatura — o que a tela mostra antes de tudo. */
export function cobertura(mapa: Mapa, chaves: string[]): {
  total: number; cobertas: number; faltando: string[];
} {
  const unicas = [...new Set(chaves)];
  const faltando = unicas.filter((c) => !mapa.has(c));
  return { total: unicas.length, cobertas: unicas.length - faltando.length, faltando };
}
