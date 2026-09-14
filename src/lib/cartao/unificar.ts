/**
 * O mesmo lojista com dois nomes, em duas faturas — fundido pela linha da fatura.
 *
 * O `estabelecimento` gravado em `cartao_lancamentos` é texto de quem importou,
 * não da fatura. Enquanto um só importador escreve (o `scripts/cartao-ofx.ts`,
 * que dá o nome por uma tabela fixa), o nome é estável. A fatura de set/26 entrou
 * por outro caminho e com outro vocabulário: os mesmos "FACEBK *…" que eram
 * "META ADS" de jan a ago viraram "META / FACEBOOK ADS", e a matriz mostrou duas
 * linhas — uma "sumindo" −100% e outra "NOVA" de R$ 121 mil. Na mesma fatura,
 * 62 nomes mudaram assim ("LATAM (aéreo)", "DATADOG, INC.V", "99 (app)"…).
 *
 * O que não muda entre importadores é o MEMO, guardado cru em `descricao`. A raiz
 * dele sai do leitor único (`lerMemo`) e da mesma `chaveDe` que o de-para usa —
 * nada de terceiro normalizador.
 *
 * AS TRÊS TRAVAS, porque fundir demais erra calado:
 *   1. Só se funde nome que NUNCA aparece na mesma fatura que o outro. A fatura é
 *      a unidade de importação (`cartao_importar` troca o mês inteiro), então um
 *      importador é coerente consigo mesmo: dois nomes para a mesma raiz DENTRO de
 *      um mês foram separados de propósito. Nomes diferentes em meses DIFERENTES
 *      é o caso óbvio: foi o importador que trocou.
 *   2. As palavras do nome mais curto estão TODAS no mais longo ("META ADS" em
 *      "META / FACEBOOK ADS", "DATADOG" em "DATADOG, INC.V"). Só a raiz não basta,
 *      medido nas faturas jul–set/26: "DL *GOOGLE ADS78" perde o código e vira
 *      "GOOGLE", e sem esta trava R$ 41 mil de GOOGLE ADS caíam em "GOOGLE
 *      (outros)"; "HOSTINGER" virava "DM", o nome ruim que o adquirente deixou no
 *      histórico. Nesses a raiz coincide e o nome não — não é óbvio, fica.
 *   3. Vence o nome presente em mais faturas; no empate, o que chegou primeiro.
 *      O histórico ganha do vocabulário novo, e a marca de revisão, que é por
 *      nome, continua valendo.
 *
 * Nada é regravado no banco: a fusão é da leitura, como tudo em `analise.ts`.
 */

import { normalize } from "@/lib/normalize";
import { chaveDe, lerMemo } from "./ofx";

type ComMemo = { competencia: string; estabelecimento: string; descricao: string | null };

const palavras = (nome: string) => new Set(normalize(nome).split(/[^a-z0-9]+/i).filter(Boolean));

/** Trava 2: um nome é o outro com palavras a mais. */
function umContemOOutro(a: string, b: string): boolean {
  const [curto, longo] = [palavras(a), palavras(b)].sort((x, y) => x.size - y.size);
  return curto.size > 0 && [...curto].every((p) => longo.has(p));
}

/** A raiz do lojista pela linha da fatura, ou null quando não há MEMO. */
export function raizDoMemo(descricao: string | null | undefined): string | null {
  if (!descricao?.trim()) return null;
  const nome = lerMemo(descricao).estabelecimento;
  return (nome && chaveDe(nome)) || null;
}

export function unificarEstabelecimentos<T extends ComMemo>(lancs: T[]): T[] {
  type Uso = { nome: string; meses: Set<string>; primeiro: string; n: number };
  const porRaiz = new Map<string, Map<string, Uso>>();
  const raizes = lancs.map((l) => raizDoMemo(l.descricao));

  lancs.forEach((l, i) => {
    const raiz = raizes[i];
    if (!raiz) return;
    const nomes = porRaiz.get(raiz) ?? new Map<string, Uso>();
    const uso = nomes.get(l.estabelecimento)
      ?? { nome: l.estabelecimento, meses: new Set<string>(), primeiro: l.competencia, n: 0 };
    uso.meses.add(l.competencia);
    if (l.competencia < uso.primeiro) uso.primeiro = l.competencia;
    uso.n++;
    nomes.set(l.estabelecimento, uso);
    porRaiz.set(raiz, nomes);
  });

  // raiz → (nome gravado → nome que vale)
  const troca = new Map<string, Map<string, string>>();
  for (const [raiz, nomes] of porRaiz) {
    if (nomes.size < 2) continue;
    const [vence, ...resto] = [...nomes.values()].sort((a, b) =>
      b.meses.size - a.meses.size || a.primeiro.localeCompare(b.primeiro) || b.n - a.n || a.nome.localeCompare(b.nome),
    );
    const ocupados = new Set(vence.meses);
    const mapa = new Map<string, string>();
    for (const u of resto) {
      if ([...u.meses].some((m) => ocupados.has(m))) continue;   // trava 1
      if (!umContemOOutro(u.nome, vence.nome)) continue;          // trava 2
      u.meses.forEach((m) => ocupados.add(m));
      mapa.set(u.nome, vence.nome);
    }
    if (mapa.size) troca.set(raiz, mapa);
  }
  if (!troca.size) return lancs;

  return lancs.map((l, i) => {
    const novo = raizes[i] ? troca.get(raizes[i]!)?.get(l.estabelecimento) : undefined;
    return novo ? { ...l, estabelecimento: novo } : l;
  });
}
