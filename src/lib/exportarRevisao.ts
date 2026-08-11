/* ============================================================================
 * Paginação da Revisão do Mês — o que cabe em cada folha.
 *
 * A tela é um rolo contínuo; o PDF e o PowerPoint são folhas de tamanho fixo.
 * Jogar o rolo no papel e deixar o navegador quebrar onde der produz o que a
 * gente não quer numa reunião: um card partido no meio, um título de bloco
 * sozinho no rodapé, uma tabela cuja última linha caiu na página seguinte.
 *
 * Aqui a quebra é DECIDIDA, não sofrida. Entram as alturas medidas de cada peça
 * (os filhos diretos do bloco, já renderizados na largura da folha) e sai a
 * lista de páginas com o que vai em cada uma. As regras, em ordem de prioridade:
 *
 *   1. NADA É CORTADO. Uma peça nunca começa numa folha e termina na outra.
 *   2. Bloco não se mistura com bloco — cada assunto começa em folha nova.
 *   3. Uma peça que é PILHA (lista de cards empilhados, como as rubricas do
 *      Pareto) pode ser repartida, mas só entre filhos inteiros.
 *   4. Peça que não cabe nem numa folha vazia entra sozinha e é REDUZIDA até
 *      caber — reduzir é o último recurso, não o primeiro.
 *   5. Cabeçalho de bloco não fica órfão, e uma folha final com um item
 *      pequeno sozinho volta para a folha anterior se der para encolher pouco.
 *
 * Só aritmética: quem mede o DOM e quem desenha a folha é o
 * `components/demonstracoes/ExportarRevisao.tsx`. É isto que deixa a regra
 * testável sem navegador.
 * ========================================================================== */

/** Uma peça que é uma pilha vertical — dá para repartir entre folhas. */
export type Pilha = {
  /** Altura de cada filho, na ordem em que aparecem. */
  alturas: number[];
  /** Espaço entre os filhos. */
  gap: number;
};

export type PecaMedida = {
  /** Posição da peça dentro do bloco (índice do filho em `[data-revisao-conteudo]`). */
  i: number;
  altura: number;
  pilha?: Pilha;
};

export type BlocoMedido = {
  /** Índice do bloco na tela — 0 é o Resumo. */
  n: number;
  titulo: string;
  pecas: PecaMedida[];
};

/** Um pedaço de peça numa folha. Sem `de`/`ate`, é a peça inteira. */
export type ItemDaPagina = { i: number; de?: number; ate?: number };

export type Pagina = {
  bloco: number;
  titulo: string;
  /** 1-based: "2 de 3" no rodapé da folha. */
  parte: number;
  partes: number;
  itens: ItemDaPagina[];
  /** Menor que 1 quando o conteúdo teve de ser reduzido para caber. */
  escala: number;
};

export type OpcoesPaginacao = {
  /** Espaço entre peças na folha (o `gap-3.5` do bloco). */
  gap?: number;
  /** Até onde vale encolher antes de a folha virar ilegível. */
  escalaMinima?: number;
  /** Uma folha final com um item mais baixo que isto (fração da folha) volta
   *  para a anterior, se couber com pouco encolhimento. */
  viuvaAte?: number;
};

const PADRAO: Required<OpcoesPaginacao> = { gap: 14, escalaMinima: 0.55, viuvaAte: 0.22 };

/**
 * As reduções que valem a pena testar para GANHAR UMA FOLHA.
 *
 * "Aquilo que der para encaixar num slide, encaixa; se for ficar pequeno
 * demais, vai sozinho." O bloco é empacotado primeiro em tamanho natural e
 * depois com a folha fingindo ser um pouco maior; se alguma dessas tentativas
 * gastar MENOS folhas, ela vence — e a maior escala que consegue o menor número
 * de folhas é a escolhida, porque a lista está em ordem decrescente.
 *
 * O piso de 0,8 é onde a letra de 12px ainda passa dos 9,5px. Abaixo disso,
 * meia folha em branco é melhor negócio que uma folha ilegível.
 */
const ESCALAS = [1, 0.96, 0.92, 0.88, 0.84, 0.8];

/** Altura de um item já resolvido (peça inteira ou fatia de pilha). */
export function alturaDoItem(pecas: PecaMedida[], item: ItemDaPagina, gapPilha?: number): number {
  const p = pecas.find((x) => x.i === item.i);
  if (!p) return 0;
  if (item.de == null || item.ate == null || !p.pilha) return p.altura;
  const g = gapPilha ?? p.pilha.gap;
  const fatia = p.pilha.alturas.slice(item.de, item.ate);
  return fatia.reduce((s, h) => s + h, 0) + Math.max(0, fatia.length - 1) * g;
}

/** Altura total de uma folha, com os espaços entre os itens. */
function alturaDaFolha(pecas: PecaMedida[], itens: ItemDaPagina[], gap: number): number {
  return itens.reduce((s, it, k) => s + alturaDoItem(pecas, it) + (k ? gap : 0), 0);
}

/**
 * Reparte um bloco em folhas de `capacidade`.
 *
 * O empacotamento é GULOSO e em ordem: a peça vai para a folha corrente se
 * couber, senão abre folha nova. Não vale reordenar para aproveitar buraco —
 * a ordem do bloco é a ordem da conversa da reunião.
 *
 * `capacidade` pode ser MAIOR que a folha de verdade: é assim que a busca por
 * escala pergunta "e se coubesse um pouco mais?". Por isso as regras que julgam
 * o custo de encolher (a viúva, o cabeçalho órfão) usam `alturaReal` — encolher
 * tem de ser medido contra o papel, não contra a folha imaginária.
 */
function paginarBloco(
  b: BlocoMedido,
  capacidade: number,
  alturaReal: number,
  o: Required<OpcoesPaginacao>,
): ItemDaPagina[][] {
  const alturaUtil = capacidade;
  const folhas: ItemDaPagina[][] = [];
  let atual: ItemDaPagina[] = [];
  let usado = 0;

  const fechar = () => {
    if (atual.length) folhas.push(atual);
    atual = [];
    usado = 0;
  };

  for (const p of b.pecas) {
    const custo = p.altura + (atual.length ? o.gap : 0);
    if (custo <= alturaUtil - usado) {
      atual.push({ i: p.i });
      usado += custo;
      continue;
    }

    /* Pilha: em vez de empurrar a lista inteira para a folha seguinte (e deixar
       meia folha em branco), enche o que sobrou com os primeiros cards e segue
       de onde parou. */
    if (p.pilha && p.pilha.alturas.length > 1) {
      let k = 0;
      while (k < p.pilha.alturas.length) {
        let n = 0;
        let h = atual.length ? o.gap : 0;
        while (k + n < p.pilha.alturas.length) {
          const passo = p.pilha.alturas[k + n] + (n ? p.pilha.gap : 0);
          if (usado + h + passo > alturaUtil) break;
          h += passo;
          n += 1;
        }
        if (n === 0) {
          // Nem um card cabe. Numa folha já ocupada, vira o resto para a
          // próxima; numa folha vazia, o card é maior que a folha e entra
          // sozinho para ser reduzido.
          if (atual.length) { fechar(); continue; }
          folhas.push([{ i: p.i, de: k, ate: k + 1 }]);
          k += 1;
          continue;
        }
        atual.push({ i: p.i, de: k, ate: k + n });
        usado += h;
        k += n;
        if (k < p.pilha.alturas.length) fechar();
      }
      continue;
    }

    fechar();
    atual.push({ i: p.i });
    usado = p.altura;
    // Peça mais alta que a folha: fica sozinha e será reduzida.
    if (p.altura > alturaUtil) fechar();
  }
  fechar();

  /* Cabeçalho órfão: a primeira peça é o título do bloco e uma folha só com ele
     é uma capa que ninguém pediu. Desce junto com o conteúdo — o encolhimento
     que isso possa custar é menos ruim que a folha em branco. */
  if (folhas.length > 1 && folhas[0].length === 1 && folhas[0][0].i === b.pecas[0]?.i && b.pecas[0]?.altura < alturaReal * 0.35) {
    const cabecalho = folhas.shift()!;
    folhas[0] = [...cabecalho, ...folhas[0]];
  }

  /* Viúva: última folha com um item baixinho sozinho. Se der para juntar na
     anterior encolhendo pouco, junta — uma folha inteira para uma nota de
     rodapé é pior que 8% de redução. */
  if (folhas.length > 1) {
    const ultima = folhas[folhas.length - 1];
    if (ultima.length === 1 && alturaDaFolha(b.pecas, ultima, o.gap) < alturaReal * o.viuvaAte) {
      const anterior = folhas[folhas.length - 2];
      const juntas = [...anterior, ...ultima];
      const escala = alturaReal / alturaDaFolha(b.pecas, juntas, o.gap);
      if (escala >= 0.82) {
        folhas.splice(folhas.length - 2, 2, juntas);
      }
    }
  }

  return folhas.length ? folhas : [[]];
}

export function paginar(
  blocos: BlocoMedido[],
  alturaUtil: number,
  opcoes: OpcoesPaginacao = {},
): Pagina[] {
  const o = { ...PADRAO, ...opcoes };
  const paginas: Pagina[] = [];

  for (const b of blocos) {
    if (!b.pecas.length) continue;

    /* Menos folhas, com o menor encolhimento que as conseguir. A primeira
       tentativa é sempre em tamanho natural; as seguintes só vencem se
       ECONOMIZAREM folha — empatar não justifica letra menor. */
    let folhas = paginarBloco(b, alturaUtil, alturaUtil, o);
    for (const s of ESCALAS.slice(1)) {
      if (folhas.length <= 1) break;
      const tentativa = paginarBloco(b, alturaUtil / s, alturaUtil, o);
      if (tentativa.length < folhas.length) folhas = tentativa;
    }

    folhas.forEach((itens, k) => {
      const h = alturaDaFolha(b.pecas, itens, o.gap);
      // Arredondado no milésimo: escala com 15 casas vira string enorme no
      // `transform` e não muda um pixel.
      const bruta = h > alturaUtil ? alturaUtil / h : 1;
      paginas.push({
        bloco: b.n,
        titulo: b.titulo,
        parte: k + 1,
        partes: folhas.length,
        itens,
        escala: Math.max(o.escalaMinima, Math.floor(bruta * 1000) / 1000),
      });
    });
  }

  return paginas;
}