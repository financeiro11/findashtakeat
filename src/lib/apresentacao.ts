/* ============================================================================
 * O roteiro de uma apresentação da Revisão do Mês.
 *
 * A tela da revisão sempre teve cinco blocos fixos. A reunião não é fixa: numa
 * o assunto é o caixa, na outra o caixa não entra e o churn abre a conversa.
 * O ROTEIRO é o que separa "o que o Hub sabe calcular" de "o que esta reunião
 * vai mostrar": uma lista ordenada de folhas, cada folha com as peças que vão
 * nela — e nada mais que isso.
 *
 * TRÊS TIPOS DE PEÇA
 *   · card  → aponta para um card que a página já sabe desenhar, por CHAVE
 *             estável (`pareto.rubrica:Pessoal`). O roteiro nunca guarda número
 *             nem texto do card: guardar seria uma segunda verdade envelhecendo
 *             em paralelo com a DRE.
 *   · texto → título + parágrafo escritos aqui. É o "colocar outra coisa".
 *   · serie → uma rubrica ao longo de N meses, desenhada na hora.
 *
 * O QUE NÃO MORA AQUI
 *   O texto que a pessoa reescreve por cima da leitura da IA continua em
 *   `demonstracoes_revisao.editado` (é do MÊS, não da apresentação). O que é da
 *   apresentação — o "por que aconteceu" reescrito para esta plateia — vai em
 *   `textos`, separado, justamente para não encostar na DRE.
 *
 * Tudo aqui é função pura sobre estrutura: quem desenha é `RevisaoMes.tsx`,
 * quem persiste é `demonstracoes_apresentacoes`. É isto que deixa a regra do
 * "mover para a folha 3" ser testada sem navegador nem banco.
 * ========================================================================== */

import { rotuloMes, type Leitor } from "./analisesDre";
import { rubricasDoPareto, type Natureza } from "./revisaoMes";

export type PecaCard = { id: string; tipo: "card"; chave: string };
export type PecaTexto = { id: string; tipo: "texto"; titulo: string; corpo: string };
export type PecaSerie = {
  id: string;
  tipo: "serie";
  titulo: string;
  /** Rótulo da rubrica na DRE ("EBITDA", "Pessoal"). */
  rubrica: string;
  /** Quantos meses para trás, contando o mês da revisão. */
  meses: number;
  formato: "barra" | "linha";
};
export type Peca = PecaCard | PecaTexto | PecaSerie;

export type Folha = { id: string; titulo: string; pecas: Peca[] };
export type Roteiro = { folhas: Folha[] };

/** Um card que a página sabe desenhar, oferecido no catálogo do montador. */
export type ItemCatalogo = {
  chave: string;
  /** Como o card se chama para gente ("Cascata do resultado"). */
  rotulo: string;
  /** De qual dos cinco blocos ele veio — vira o título da folha padrão. */
  bloco: string;
  /** Cards vizinhos do mesmo grupo ficam lado a lado quando caem na mesma folha. */
  grupo?: string;
  /** Card que não tem o que mostrar neste mês (sem BP, sem snapshot). */
  vazio?: boolean;
};

export const ROTEIRO_VAZIO: Roteiro = { folhas: [] };

/* ------------------------------------------------------------------ ids -- */

/**
 * Id novo e estável dentro do roteiro.
 *
 * Contador em cima do que já existe, não sorteio: dois roteiros montados a
 * partir do mesmo catálogo têm de sair iguais, ou o teste vira loteria e o
 * `diff` entre "antes" e "depois" acusa mudança onde não houve.
 */
export function novoId(prefixo: string, roteiro: Roteiro): string {
  let maior = 0;
  for (const f of roteiro.folhas) {
    for (const p of [f as { id: string }, ...f.pecas]) {
      const m = new RegExp(`^${prefixo}(\\d+)$`).exec(p.id);
      if (m) maior = Math.max(maior, Number(m[1]));
    }
  }
  return `${prefixo}${maior + 1}`;
}

/* -------------------------------------------------------------- montagem -- */

/**
 * O roteiro que a apresentação nova recebe: uma folha por bloco, na ordem do
 * catálogo, com todos os cards que têm o que mostrar.
 *
 * Card vazio fica DE FORA da folha (e continua no catálogo, para quem quiser
 * puxar de volta): abrir uma apresentação nova com três cards dizendo "sem BP
 * importado" é começar pedindo desculpa.
 */
export function roteiroPadrao(catalogo: ItemCatalogo[]): Roteiro {
  const roteiro: Roteiro = { folhas: [] };
  for (const item of catalogo) {
    let folha = roteiro.folhas.find((f) => f.titulo === item.bloco);
    if (!folha) {
      folha = { id: `f${roteiro.folhas.length + 1}`, titulo: item.bloco, pecas: [] };
      roteiro.folhas.push(folha);
    }
    if (item.vazio) continue;
    folha.pecas.push({ id: `p${item.chave}`, tipo: "card", chave: item.chave });
  }
  return { folhas: roteiro.folhas.filter((f) => f.pecas.length > 0) };
}

/**
 * Tira do roteiro os cards que sumiram do catálogo e devolve o que sobrou.
 *
 * Acontece de verdade: o Pareto por rubrica de julho tem `pareto.rubrica:Servidor`
 * e o de agosto não. Sem esta limpeza, a folha ficaria com um buraco silencioso
 * — pior que a peça sumir, porque a contagem de peças continuaria batendo.
 * Texto e série nunca são removidos: eles não dependem do catálogo.
 */
export function sanear(roteiro: Roteiro, catalogo: ItemCatalogo[]): { roteiro: Roteiro; removidas: string[] } {
  const existe = new Set(catalogo.map((c) => c.chave));
  const removidas: string[] = [];
  const folhas = roteiro.folhas.map((f) => ({
    ...f,
    pecas: f.pecas.filter((p) => {
      if (p.tipo !== "card" || existe.has(p.chave)) return true;
      removidas.push(p.chave);
      return false;
    }),
  }));
  return { roteiro: { folhas }, removidas };
}

/** Cards do catálogo que ainda não estão em folha nenhuma. */
export function foraDoRoteiro(roteiro: Roteiro, catalogo: ItemCatalogo[]): ItemCatalogo[] {
  const dentro = new Set(
    roteiro.folhas.flatMap((f) => f.pecas.filter((p): p is PecaCard => p.tipo === "card").map((p) => p.chave)),
  );
  return catalogo.filter((c) => !dentro.has(c.chave));
}

export const acharPeca = (roteiro: Roteiro, id: string): { folha: Folha; peca: Peca; i: number } | null => {
  for (const folha of roteiro.folhas) {
    const i = folha.pecas.findIndex((p) => p.id === id);
    if (i >= 0) return { folha, peca: folha.pecas[i], i };
  }
  return null;
};

/* ------------------------------------------------------------- operações -- */
/* Todas devolvem roteiro NOVO: o montador guarda o anterior para o desfazer, e
   mutar no lugar tiraria isso de graça. */

export function removerPeca(roteiro: Roteiro, id: string): Roteiro {
  return { folhas: roteiro.folhas.map((f) => ({ ...f, pecas: f.pecas.filter((p) => p.id !== id) })) };
}

export function inserirPeca(roteiro: Roteiro, folhaId: string, indice: number, peca: Peca): Roteiro {
  return {
    folhas: roteiro.folhas.map((f) => {
      if (f.id !== folhaId) return f;
      const pecas = [...f.pecas];
      pecas.splice(Math.max(0, Math.min(pecas.length, indice)), 0, peca);
      return { ...f, pecas };
    }),
  };
}

/**
 * Move uma peça para uma posição de uma folha (a mesma ou outra).
 *
 * Tira primeiro e insere depois, e é por isso que o índice de destino é
 * calculado sobre a lista JÁ SEM a peça: mover o card da posição 1 para a 3 da
 * mesma folha, com o índice contado antes da remoção, para na posição 2.
 */
export function moverPeca(roteiro: Roteiro, id: string, folhaId: string, indice: number): Roteiro {
  const achado = acharPeca(roteiro, id);
  if (!achado) return roteiro;
  return inserirPeca(removerPeca(roteiro, id), folhaId, indice, achado.peca);
}

export function novaFolha(roteiro: Roteiro, titulo: string, depoisDe?: string): Roteiro {
  const folha: Folha = { id: novoId("f", roteiro), titulo, pecas: [] };
  const folhas = [...roteiro.folhas];
  const i = depoisDe ? folhas.findIndex((f) => f.id === depoisDe) : -1;
  folhas.splice(i >= 0 ? i + 1 : folhas.length, 0, folha);
  return { folhas };
}

export function removerFolha(roteiro: Roteiro, folhaId: string): Roteiro {
  return { folhas: roteiro.folhas.filter((f) => f.id !== folhaId) };
}

export function renomearFolha(roteiro: Roteiro, folhaId: string, titulo: string): Roteiro {
  return { folhas: roteiro.folhas.map((f) => (f.id === folhaId ? { ...f, titulo } : f)) };
}

export function moverFolha(roteiro: Roteiro, folhaId: string, para: number): Roteiro {
  const folhas = [...roteiro.folhas];
  const i = folhas.findIndex((f) => f.id === folhaId);
  if (i < 0) return roteiro;
  const [f] = folhas.splice(i, 1);
  folhas.splice(Math.max(0, Math.min(folhas.length, para)), 0, f);
  return { folhas };
}

/* ------------------------------------------------------------- linguagem -- */
/**
 * O que a IA pode mandar fazer no roteiro.
 *
 * COMANDOS, não um roteiro novo. Pedir o documento inteiro de volta convida a
 * IA a reescrever o que ninguém mandou mexer — some uma folha, um card troca de
 * chave, e a pessoa só descobre no meio da reunião. Comando é auditável: dá
 * para mostrar a mudança proposta antes de aplicar e recusar a que não bate com
 * o catálogo.
 */
export type Comando =
  | { acao: "remover"; alvo: string }
  | { acao: "adicionar"; chave: string; folha?: string; posicao?: number }
  | { acao: "mover"; alvo: string; folha: string; posicao?: number }
  | { acao: "nova-folha"; titulo: string; depoisDe?: string }
  | { acao: "remover-folha"; folha: string }
  | { acao: "renomear-folha"; folha: string; titulo: string }
  | { acao: "texto"; titulo: string; corpo: string; folha?: string; posicao?: number }
  | { acao: "serie"; titulo?: string; rubrica: string; meses?: number; formato?: "barra" | "linha"; folha?: string; posicao?: number };

export type ResultadoComandos = {
  roteiro: Roteiro;
  /** Uma linha por comando aplicado, para o "antes e depois" da confirmação. */
  aplicados: string[];
  /** Comando que não deu para executar, com o motivo — sempre mostrado. */
  recusados: string[];
};

/** Acha uma folha por id ou por título, sem exigir que a IA saiba o id. */
const acharFolha = (roteiro: Roteiro, ref: string | undefined): Folha | null => {
  if (!ref) return null;
  const alvo = ref.trim().toLowerCase();
  return roteiro.folhas.find((f) => f.id === ref)
    ?? roteiro.folhas.find((f) => f.titulo.toLowerCase() === alvo)
    ?? roteiro.folhas.find((f) => f.titulo.toLowerCase().includes(alvo))
    ?? null;
};

/** Acha uma peça por id, por chave de card ou por título de texto/série. */
const acharAlvo = (roteiro: Roteiro, ref: string): { folha: Folha; peca: Peca } | null => {
  const alvo = ref.trim().toLowerCase();
  for (const folha of roteiro.folhas) {
    for (const peca of folha.pecas) {
      if (peca.id === ref) return { folha, peca };
      if (peca.tipo === "card" && peca.chave.toLowerCase() === alvo) return { folha, peca };
      if (peca.tipo !== "card" && peca.titulo.toLowerCase() === alvo) return { folha, peca };
    }
  }
  return null;
};

/**
 * Aplica os comandos em ordem, um a um, recusando o que não fizer sentido.
 *
 * Nada é "quase aplicado": um comando que não casa com o catálogo é RECUSADO
 * com motivo e os outros seguem. A alternativa — abortar tudo no primeiro erro
 * — faria "tira o caixa e põe o churn" não tirar o caixa porque o churn não
 * existe, o que é pior do que fazer metade e dizer qual metade.
 */
export function aplicarComandos(
  roteiro: Roteiro,
  comandos: Comando[],
  catalogo: ItemCatalogo[],
): ResultadoComandos {
  let atual = roteiro;
  const aplicados: string[] = [];
  const recusados: string[] = [];
  const rotuloDe = (chave: string) => catalogo.find((c) => c.chave === chave)?.rotulo ?? chave;
  /** Onde uma peça nova cai quando o comando não disse: no fim da última folha. */
  const destino = (ref?: string) => acharFolha(atual, ref) ?? atual.folhas[atual.folhas.length - 1] ?? null;

  for (const c of comandos) {
    switch (c.acao) {
      case "remover": {
        const achado = acharAlvo(atual, c.alvo);
        if (!achado) { recusados.push(`"${c.alvo}" não está na apresentação`); break; }
        atual = removerPeca(atual, achado.peca.id);
        aplicados.push(`− ${nomeDaPeca(achado.peca, catalogo)} (de "${achado.folha.titulo}")`);
        break;
      }
      case "adicionar": {
        if (!catalogo.some((i) => i.chave === c.chave)) { recusados.push(`não existe card "${c.chave}"`); break; }
        if (acharAlvo(atual, c.chave)) { recusados.push(`"${rotuloDe(c.chave)}" já está na apresentação`); break; }
        const folha = destino(c.folha);
        if (!folha) { recusados.push("a apresentação não tem folha nenhuma"); break; }
        const peca: PecaCard = { id: novoId("p", atual), tipo: "card", chave: c.chave };
        atual = inserirPeca(atual, folha.id, c.posicao ?? folha.pecas.length, peca);
        aplicados.push(`+ ${rotuloDe(c.chave)} (em "${folha.titulo}")`);
        break;
      }
      case "mover": {
        const achado = acharAlvo(atual, c.alvo);
        if (!achado) { recusados.push(`"${c.alvo}" não está na apresentação`); break; }
        const folha = acharFolha(atual, c.folha);
        if (!folha) { recusados.push(`não existe a folha "${c.folha}"`); break; }
        atual = moverPeca(atual, achado.peca.id, folha.id, c.posicao ?? folha.pecas.length);
        aplicados.push(`→ ${nomeDaPeca(achado.peca, catalogo)} para "${folha.titulo}"`);
        break;
      }
      case "nova-folha": {
        const depois = acharFolha(atual, c.depoisDe);
        atual = novaFolha(atual, c.titulo, depois?.id);
        aplicados.push(`+ folha "${c.titulo}"`);
        break;
      }
      case "remover-folha": {
        const folha = acharFolha(atual, c.folha);
        if (!folha) { recusados.push(`não existe a folha "${c.folha}"`); break; }
        atual = removerFolha(atual, folha.id);
        aplicados.push(`− folha "${folha.titulo}" (${folha.pecas.length} peça(s))`);
        break;
      }
      case "renomear-folha": {
        const folha = acharFolha(atual, c.folha);
        if (!folha) { recusados.push(`não existe a folha "${c.folha}"`); break; }
        atual = renomearFolha(atual, folha.id, c.titulo);
        aplicados.push(`"${folha.titulo}" passa a se chamar "${c.titulo}"`);
        break;
      }
      case "texto": {
        const folha = destino(c.folha);
        if (!folha) { recusados.push("a apresentação não tem folha nenhuma"); break; }
        const peca: PecaTexto = { id: novoId("p", atual), tipo: "texto", titulo: c.titulo, corpo: c.corpo };
        atual = inserirPeca(atual, folha.id, c.posicao ?? folha.pecas.length, peca);
        aplicados.push(`+ texto "${c.titulo}" (em "${folha.titulo}")`);
        break;
      }
      case "serie": {
        const folha = destino(c.folha);
        if (!folha) { recusados.push("a apresentação não tem folha nenhuma"); break; }
        const peca: PecaSerie = {
          id: novoId("p", atual),
          tipo: "serie",
          titulo: c.titulo || `${c.rubrica} — últimos meses`,
          rubrica: c.rubrica,
          meses: Math.max(2, Math.min(24, c.meses ?? 12)),
          formato: c.formato === "linha" ? "linha" : "barra",
        };
        atual = inserirPeca(atual, folha.id, c.posicao ?? folha.pecas.length, peca);
        aplicados.push(`+ série "${peca.titulo}" (em "${folha.titulo}")`);
        break;
      }
      default:
        recusados.push(`comando desconhecido: ${JSON.stringify(c)}`);
    }
  }

  return { roteiro: atual, aplicados, recusados };
}

export function nomeDaPeca(peca: Peca, catalogo: ItemCatalogo[]): string {
  if (peca.tipo === "card") return catalogo.find((c) => c.chave === peca.chave)?.rotulo ?? peca.chave;
  return peca.titulo;
}

/** Quantas peças a apresentação tem — o montador mostra no cabeçalho. */
export const contarPecas = (roteiro: Roteiro) =>
  roteiro.folhas.reduce((s, f) => s + f.pecas.length, 0);

/**
 * Um nome que ainda não existe, a partir de uma base.
 *
 * `(mes, nome)` é único no banco, e a colisão é rotina: gerar o mesmo modelo
 * duas vezes no mesmo trimestre, duplicar uma apresentação, criar a terceira do
 * mês depois de excluir a segunda. Devolver o erro do banco para a pessoa
 * ("duplicate key value violates...") seria pedir que ela adivinhe o conserto.
 *
 * O sufixo é " (2)", " (3)" — e não a hora ou um id — porque o nome vai para o
 * seletor da reunião e alguém vai ter de ler.
 */
export function nomeLivre(base: string, usados: Iterable<string>): string {
  const tomados = new Set(usados);
  if (!tomados.has(base)) return base;
  for (let n = 2; n < 500; n++) {
    const tentativa = `${base} (${n})`;
    if (!tomados.has(tentativa)) return tentativa;
  }
  return base;
}

/* ----------------------------------------------------------------- série -- */

export type PontoSerie = { col: string; rotulo: string; valor: number | null };

/**
 * Uma rubrica da DRE ao longo dos últimos meses.
 *
 * A NATUREZA decide como o número é lido, e não dá para adivinhar pelo sinal:
 * despesa vem negativa numa planilha e positiva noutra (ver `fatorSinal` em
 * `analisesDre`), e um gráfico que herdasse o sinal cru mostraria "Pessoal"
 * subindo quando caiu. Receita em módulo, despesa em magnitude positiva,
 * resultado com sinal — as mesmas três do Pareto.
 *
 * Rubrica desconhecida cai no bruto: é melhor desenhar a linha que a pessoa
 * pediu do que devolver um card vazio porque o rótulo não está na lista.
 */
export function serieDaRubrica(
  leitor: Leitor,
  meses: string[],
  rubrica: string,
  quantos: number,
): PontoSerie[] {
  const natureza: Natureza | undefined =
    [...rubricasDoPareto("rubrica"), ...rubricasDoPareto("bloco")]
      .find((r) => r.rubrica.toLowerCase() === rubrica.toLowerCase())?.natureza;

  const ler = (col: string) =>
    natureza === "receita" ? leitor.receita(rubrica, col)
      : natureza === "despesa" ? leitor.custo(rubrica, col)
      : leitor.bruto(rubrica, col);

  return meses.slice(-Math.max(2, quantos)).map((col) => ({
    col,
    rotulo: rotuloMes(col),
    valor: ler(col),
  }));
}
