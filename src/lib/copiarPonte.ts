/* ============================================================================
 * A ponte virando texto: o comentário do tracker, escrito pela tela.
 *
 * A conta que a ponte faz já é a que se manda para alguém — "a rubrica subiu
 * 17,7k: Ana Júlia +5,0k, Pedro Faro +2,5k…". Hoje isso é redigitado à mão a
 * cada fechamento, olhando a tela e batendo os números no comentário do Excel;
 * é onde entra dígito trocado e onde a lista para no quinto fornecedor porque
 * cansou.
 *
 * O formato aqui NÃO foi inventado: é o que já se escreve no tracker. Total na
 * primeira linha como `VAR`, uma linha por fornecedor com os dois meses cheios
 * e a diferença abreviada entre parênteses. Três coisas que valem estar ditas:
 *
 * 1. OS VALORES SAEM EM MÓDULO. No tracker se escreve "R$ 4.600,00 → R$
 *    9.610,27", não "-R$ 4.600,00" — quem diz a direção é o bloco ("gastou a
 *    mais") e o sinal do delta entre parênteses. Na tela o sinal fica, porque lá
 *    a coluna precisa somar com a célula; aqui o texto é uma frase, não uma
 *    planilha.
 *
 * 2. O PARÊNTESES É `deltaModulo`, NÃO `delta`. "+5,0k" quer dizer "passou
 *    R$ 5 mil a mais por aqui". Em despesa o delta é negativo justamente quando
 *    se gastou a mais; escrever "-5,0k" numa lista chamada "gastou a mais"
 *    faria o leitor entender o contrário do que aconteceu.
 *
 * 3. NADA É CORTADO. A lista copiada é a lista inteira do bloco, na mesma ordem
 *    da tela (o que mais pesou primeiro). Um "top 5" no comentário devolve a
 *    pergunta "e o resto?" para quem lê — que é o que a ponte existe para
 *    eliminar.
 * ========================================================================== */

import { mesCurto } from "@/lib/demonstracoes-schema";
import {
  resumoPonte, rotuloContagem, rotuloGrupo, type PecaDaPonte, type Ponte,
} from "@/lib/ponteVariacao";

/** Como o texto sai. O padrão (`completo`) é o do comentário que já se escreve. */
export type FormatoCopia = "completo" | "enxuto" | "contexto";

/** Que parte da ponte vai no texto. */
export type BlocoCopia = "piora" | "melhora" | "ambos" | "tudo";

/** Dinheiro do jeito que se escreve no comentário: em módulo, com centavos.
 *
 *  O espaço depois de "R$" sai do `toLocaleString` como espaço RÍGIDO (U+00A0),
 *  e este texto vai para um comentário de Excel, um WhatsApp, uma caixa de
 *  busca. Trocar por espaço comum é o que faz o que foi copiado ser igual ao
 *  que se digitaria à mão. */
const brl = (n: number) =>
  Math.abs(n)
    .toLocaleString("pt-BR", {
      style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
    })
    .replace(/[\u00a0\u202f]/g, " ");

const umaCasa = (v: number) => {
  const arred = Math.round(v * 10) / 10;
  return Number.isInteger(arred) ? String(arred) : arred.toFixed(1).replace(".", ",");
};

/** "5,0k", "850", "1,2M" — a abreviação que já se usa no tracker. */
export function abreviar(n: number): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${umaCasa(v / 1_000_000)}M`;
  if (v >= 1_000) return `${umaCasa(v / 1_000)}k`;
  return Math.round(v).toLocaleString("pt-BR");
}

/** O sinal diz "a mais" ou "a menos" — nunca "melhorou" ou "piorou". */
const comSinal = (n: number) => `${n >= 0 ? "+" : "-"}${abreviar(n)}`;

const linhaCompleta = (p: PecaDaPonte): string =>
  `${p.nome} ${brl(p.anterior)} → ${brl(p.atual)} (${p.movimento === "igual" ? "igual" : comSinal(p.deltaModulo)})`;

/* No enxuto o nome sozinho não diz que o fornecedor é novo — e sem os dois
   valores, "+2,1k" num fornecedor que não existia mês passado passaria por
   aumento de quem já estava lá. */
const linhaEnxuta = (p: PecaDaPonte): string => {
  const marca = p.movimento === "entrou" ? " (novo)"
    : p.movimento === "saiu" ? " (saiu)"
    : p.movimento === "igual" ? " (igual)" : "";
  return `${p.nome} ${comSinal(p.deltaModulo)}${marca}`;
};

const somaDelta = (pecas: PecaDaPonte[]) => pecas.reduce((s, p) => s + p.delta, 0);

/** O verbo da frase de abertura do formato enxuto. */
function palavraDaFrase(ponte: Ponte, favoravel: boolean): string {
  if (ponte.despesa) return favoravel ? "Economia de" : "Aumento de";
  return favoravel ? "Alta de" : "Queda de";
}

function pctDaPonte(ponte: Ponte): string {
  if (ponte.pct == null || Math.abs(ponte.delta) < 0.005) return "";
  return ` (${ponte.pct > 0 ? "+" : "-"}${Math.round(Math.abs(ponte.pct) * 100)}%)`;
}

type Secao = { titulo: string | null; pecas: PecaDaPonte[] };

function secoes(ponte: Ponte, bloco: BlocoCopia): Secao[] {
  if (bloco === "piora") return [{ titulo: null, pecas: ponte.piora }];
  if (bloco === "melhora") return [{ titulo: null, pecas: ponte.melhora }];
  const dois: Secao[] = [
    { titulo: rotuloGrupo(ponte, false), pecas: ponte.piora },
    { titulo: rotuloGrupo(ponte, true), pecas: ponte.melhora },
  ];
  if (bloco === "tudo") dois.push({ titulo: "Repetiram o valor", pecas: ponte.iguais });
  return dois;
}

/** O valor que o cabeçalho anuncia — o do bloco escolhido, não sempre o total. */
function totalDoBloco(ponte: Ponte, bloco: BlocoCopia): number {
  if (bloco === "piora") return ponte.totalPiora;
  if (bloco === "melhora") return ponte.totalMelhora;
  return ponte.delta;
}

/**
 * A ponte em texto, pronta para colar num comentário do tracker ou mandar numa
 * mensagem. Devolve string vazia quando não há nada no bloco escolhido — quem
 * chama decide se some com o botão ou avisa.
 */
export function textoDaPonte(
  ponte: Ponte,
  opcoes: {
    formato: FormatoCopia;
    bloco: BlocoCopia;
    /** O nome da rubrica, para o texto dizer de onde saiu. */
    rubrica?: string | null;
    /** "Jul 26" — o mês em foco como a tela escreve. */
    mesLabel?: string | null;
  },
): string {
  const { formato, bloco, rubrica, mesLabel } = opcoes;
  const partes = secoes(ponte, bloco).filter((s) => s.pecas.length > 0);
  if (!partes.length) return "";

  const total = totalDoBloco(ponte, bloco);
  const mes = mesLabel || mesCurto(ponte.mes);
  const blocos: string[] = [];

  if (formato === "enxuto") {
    const favoravel = bloco === "melhora" || (bloco !== "piora" && ponte.delta > 0);
    blocos.push(
      `${palavraDaFrase(ponte, favoravel)} ${abreviar(total)}`
      + `${rubrica ? ` em ${rubrica}` : ""} (${mes}).`,
    );
  } else {
    /* `VAR` é como a linha se chama no tracker. Só o bloco que piorou fica sem
       qualificação: é o caso de sempre, e é assim que já está escrito lá. */
    const qualifica = bloco === "melhora" ? rotuloGrupo(ponte, true).toLowerCase()
      : bloco === "piora" ? null
      : resumoPonte(ponte);
    const varLinha = `VAR ${brl(total)}${qualifica ? ` (${qualifica})` : ""}`;

    if (formato === "contexto") {
      blocos.push([
        `${rubrica ? `${rubrica} · ` : ""}${mesCurto(ponte.mesAnterior)} → ${mes}`,
        `${brl(ponte.somaAnterior)} → ${brl(ponte.soma)}${pctDaPonte(ponte)}`,
        `${varLinha} · ${ponte.piora.length} ${rotuloContagem(ponte, false)}`
          + `, ${ponte.melhora.length} ${rotuloContagem(ponte, true)}`,
      ].join("\n"));
    } else {
      blocos.push(varLinha);
    }
  }

  const escrever = formato === "enxuto" ? linhaEnxuta : linhaCompleta;
  for (const s of partes) {
    const corpo = s.pecas.map(escrever).join("\n");
    // Subtítulo só quando há mais de uma lista no texto: com uma só, ele
    // repetiria em maiúsculas o que a linha VAR acabou de dizer. E quem repetiu
    // o valor não leva total: "(R$ 0,00)" seria um número sem informação.
    if (partes.length > 1 && s.titulo) {
      const soma = somaDelta(s.pecas);
      blocos.push(`${s.titulo.toUpperCase()}${Math.abs(soma) < 0.005 ? "" : ` (${brl(soma)})`}\n${corpo}`);
    } else {
      blocos.push(corpo);
    }
  }

  return blocos.join("\n\n");
}
