import { chaveContraparte, enigmatica, soDigitos, sugestaoDeApelido, type Candidato } from "@/lib/apelidos";

/* ---------------------------------------------------------------------------
 * Juntar as grafias antes de pedir o nome.
 *
 * A fila crua tem ~450 linhas, e boa parte delas é a MESMA contraparte escrita
 * de jeitos diferentes: "AFIXCODE SOLU" e "AFIXCODE SOLUCOE" (o OFX cortou),
 * "BONES VIX" e "BONESVIXCOMERCIO" (o adquirente colou), "Banestes" e "BANESTES"
 * (o Omie tem os dois). Nomear uma por uma é pedir a mesma resposta três vezes —
 * e é o que fazia a fila parecer intransponível.
 *
 * Aqui elas viram GRUPO. O grupo é a unidade de trabalho: um nome interno por
 * grupo, e as outras grafias entram como alias do mesmo cadastro.
 *
 * Duas coisas diferentes, que a tela mostra juntas e é fácil confundir:
 *   • o MOTIVO — por que estas grafias foram juntadas;
 *   • a CONFIANÇA — se dá para confirmar em bloco, sem ler.
 * A segunda é o pior dos dois lados: a junção pode ser certíssima (mesmo CNPJ) e
 * o nome continuar impossível de adivinhar ("AFIXCODE SOLUCOE" é o quê?). Nesse
 * caso o grupo é alta na junção e baixa no todo — vai para "Precisa ler".
 *
 * Puro de propósito: dá para testar sem React nem Supabase.
 * ------------------------------------------------------------------------- */

export type Confianca = "alta" | "media" | "baixa";

const PESO: Record<Confianca, number> = { alta: 0, media: 1, baixa: 2 };

/** A pior das duas — é assim que a confiança do grupo se propaga. */
export function pior(a: Confianca, b: Confianca): Confianca {
  return PESO[a] >= PESO[b] ? a : b;
}

export type GrupoDeGrafias = {
  /** Estável enquanto o grupo existir: a chave da grafia principal. */
  id: string;
  /** A principal primeiro — é a que dá o nome ao cadastro. */
  grafias: Candidato[];
  /** "CNPJ igual", "corte do extrato", "grafia 94%", "sem par"… */
  motivo: string;
  conf: Confianca;
  /** Vazia quando não há palpite honesto — a tela pede para escrever. */
  sugestao: string;
  lancamentos: number;
  total: number;
  ultima: string | null;
};

/** O que a planilha de formulário respondeu sobre esta contraparte. */
export type Proposta = {
  apelido: string | null;
  /** Casou por CNPJ — identidade, não palpite. */
  forte: boolean;
  /** "Compras", "Reembolsos"… para o chip dizer de onde veio. */
  fonte?: string | null;
};

/* Palavras que não identificam ninguém: aparecem em metade do cadastro e, se
   entrassem na conta de semelhança, casariam "ALEX DE SOUZA" com "ANA DE
   OLIVEIRA" por causa do "DE". */
const RUIDO = new Set([
  "DE", "DA", "DO", "DAS", "DOS", "E", "EM", "A", "O", "AS", "OS",
  "LTDA", "ME", "MEI", "EPP", "EIRELI", "SA", "S", "CIA", "COMPANHIA",
  "INC", "LLC", "LTD", "THE", "OF", "BR", "BRASIL", "BRAZIL",
]);

const TLD = /^(COM|COM\.BR|NET|NET\.BR|IO|APP|ORG|ORG\.BR|BR|AI|CO|DEV|TECH)$/;

/** "DL*BOOKING.COM" -> "BOOKING". O domínio é identidade: dois nomes que o
 *  carregam são a mesma empresa, escreva o adquirente o que escrever à volta. */
export function dominioDe(nome: string | null | undefined): string {
  const cru = String(nome ?? "").toUpperCase();
  const m = cru.match(/([A-Z0-9][A-Z0-9-]{2,})\.([A-Z]{2,3}(?:\.[A-Z]{2})?)(?![A-Z0-9])/);
  if (!m || !TLD.test(m[2])) return "";
  return m[1];
}

/**
 * O lojista antes do `*` do adquirente — "FACEBK *ADS AB12X9" -> "FACEBK".
 *
 * Corta em 4 caracteres de propósito: o prefixo curto ("DL*BOOKING.COM") é a
 * bandeira do adquirente, não o lojista, e juntaria tudo que passou pela mesma
 * maquininha.
 */
export function lojistaDe(nome: string | null | undefined): string {
  const cru = String(nome ?? "");
  const i = cru.indexOf("*");
  if (i < 0) return "";
  const antes = chaveContraparte(cru.slice(0, i)).replace(/ /g, "");
  return antes.length >= 4 ? antes : "";
}

/** As palavras que dizem alguma coisa, na ordem em que aparecem. */
export function palavrasUteis(nome: string | null | undefined): string[] {
  return chaveContraparte(nome).split(" ").filter((t) => t && !RUIDO.has(t));
}

type Entrada = {
  c: Candidato;
  chave: string;
  doc: string;
  colada: string;
  palavras: string[];
  dominio: string;
  lojista: string;
  /** O nome não diz o que é — `enigmatica` de `apelidos.ts`. Segura os sinais
   *  frouxos: metade da fila do Omie é PJ de pessoa física, e ali "mesmo
   *  primeiro nome" junta dois colaboradores diferentes. */
  cega: boolean;
};

type Sinal = { motivo: string; conf: Confianca };

/** Jaccard sobre as palavras úteis — a mesma ideia de `similarity`, sem o ruído. */
function semelhanca(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let iguais = 0;
  for (const t of sa) if (sb.has(t)) iguais++;
  return iguais / (sa.size + sb.size - iguais);
}

/** Quantas palavras iniciais as duas têm em comum. */
function comecoIgual(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  let k = 0;
  while (k < n && a[k] === b[k]) k++;
  return k;
}

/**
 * Por que estas duas grafias seriam a mesma contraparte — ou `null`.
 *
 * A ordem importa: o primeiro sinal que acende é o que fica, e os de cima são os
 * que respondem por identidade (documento, domínio, lojista). Os de baixo são
 * parecença, e é por isso que descem de confiança.
 */
export function porQueJuntar(a: Entrada, b: Entrada): Sinal | null {
  if (a.chave && a.chave === b.chave) return { motivo: "mesma grafia", conf: "alta" };

  if (a.doc.length >= 11 && a.doc === b.doc) return { motivo: "CNPJ igual", conf: "alta" };
  if (a.dominio && a.dominio === b.dominio) return { motivo: "mesmo domínio", conf: "alta" };
  if (a.lojista && a.lojista === b.lojista) return { motivo: "mesmo lojista", conf: "alta" };

  /* O OFX corta o lojista no meio da palavra; o Omie guarda a razão social
     inteira. Uma sendo começo da outra é o caso mais comum da fila:
     "JCM NITEROI REFRIGER" e "J. C. M. NITEROI REFRIGERACAO LTDA".
     A palavra solta pede mais letras — "PATRICIA" tem oito e é o começo de
     "PATRICIA ALVES DA SILVA BARBOSA GOIS" sem ser a mesma Patrícia. */
  const menor = a.colada.length <= b.colada.length ? a : b;
  const maior = menor === a ? b : a;
  const piso = menor.palavras.length >= 2 ? 8 : 10;
  if (menor.colada.length >= piso && maior.colada.startsWith(menor.colada)) {
    return { motivo: "corte do extrato", conf: "alta" };
  }

  /* O cartão manda a marca e a loja: "KABUM", "KABUM ALPHAPR", "KABUM RAICROM".
     O nome inteiro de uma sendo as primeiras palavras da outra é a mesma
     contraparte em outra praça. Vale só entre nomes que não dizem o que são —
     senão "PATRICIA" do cartão engoliria "PATRICIA ALVES DA SILVA" do Omie. */
  if (a.cega && b.cega) {
    const menos = a.palavras.length <= b.palavras.length ? a.palavras : b.palavras;
    const mais = menos === a.palavras ? b.palavras : a.palavras;
    if (menos.length > 0 && menos.length < mais.length
      && menos.join("").length >= 5
      && menos.every((t, i) => t === mais[i])) {
      return { motivo: "mesma marca", conf: "media" };
    }
  }

  if (a.palavras.length >= 2 && b.palavras.length >= 2) {
    const s = semelhanca(a.palavras, b.palavras);
    if (s >= 0.85) return { motivo: `grafia ${Math.round(s * 100)}%`, conf: "alta" };
    if (s >= 0.67) return { motivo: `grafia ${Math.round(s * 100)}%`, conf: "media" };

    /* "JIM COM L G DA SILVA" e "JIM COM LAISE GONZAG" — duas palavras iguais na
       frente e o resto é o sublojista que o adquirente carimbou. Seis
       caracteres bastam; a trava de verdade é a linha seguinte. */
    const k = comecoIgual(a.palavras, b.palavras);
    if (k >= 2 && a.palavras.slice(0, k).join("").length >= 6 && (a.cega || b.cega)) {
      return { motivo: "mesmo começo", conf: "media" };
    }
  }

  return null;
}

/* O que ficou de fora, de propósito: juntar por PALAVRA EM COMUM ("POSTO
   IPIRANGA VIX" com "AUTO POSTO PORTAL"). Foi escrito, medido contra as 440
   linhas da fila de verdade e removido: acertava KABUM e EXTRABOM e errava
   CENTRAL DE AVIAMENTO com CENTRAL DE UTILID, SUPERMERCADO NOBRE com
   SUPERMERCADO PERIM, PADARIA GRANO com PADARIA E CONFEITARIA. Cara ou coroa
   não é sinal — e um grupo errado custa mais do que um grupo que não veio.
   Juntar postos num "Postos (combustível)" continua sendo gesto de gente, pelo
   painel. */

export type OpcoesAgrupar = {
  /** O que as planilhas de formulário responderam, por `chaveContraparte`. */
  propostas?: Map<string, Proposta>;
  /** Desligado, cada grafia vira seu próprio grupo — a fila v2 de volta. */
  agrupar?: boolean;
};

/**
 * A fila em grupos: uma linha por contraparte, não por grafia.
 *
 * ~450 grafias viram ~350 grupos, e as ~100 que somem são justamente as que
 * seriam nomeadas duas vezes.
 */
export function agruparGrafias(
  fila: Candidato[],
  opcoes: OpcoesAgrupar = {},
): GrupoDeGrafias[] {
  const propostas = opcoes.propostas ?? new Map<string, Proposta>();
  const agrupar = opcoes.agrupar !== false;

  const itens: Entrada[] = (fila ?? [])
    .filter((c) => c?.nome)
    .map((c) => {
      const chave = chaveContraparte(c.nome);
      return {
        c,
        chave,
        doc: soDigitos(c.documento),
        colada: chave.replace(/ /g, ""),
        palavras: palavrasUteis(c.nome),
        dominio: dominioDe(c.nome),
        lojista: lojistaDe(c.nome),
        cega: enigmatica(c),
      };
    });

  const pai = itens.map((_, i) => i);
  const raiz = (i: number): number => {
    while (pai[i] !== i) { pai[i] = pai[pai[i]]; i = pai[i]; }
    return i;
  };
  const sinais = new Map<number, Sinal[]>();

  const juntar = (i: number, j: number, s: Sinal) => {
    const ri = raiz(i);
    const rj = raiz(j);
    if (ri === rj) return;
    pai[rj] = ri;
    sinais.set(ri, [...(sinais.get(ri) ?? []), ...(sinais.get(rj) ?? []), s]);
    sinais.delete(rj);
  };

  if (agrupar) {
    for (let i = 0; i < itens.length; i++) {
      for (let j = i + 1; j < itens.length; j++) {
        const s = porQueJuntar(itens[i], itens[j]);
        if (s) juntar(i, j, s);
      }
    }
  }

  const porRaiz = new Map<number, Entrada[]>();
  itens.forEach((e, i) => {
    const r = raiz(i);
    porRaiz.set(r, [...(porRaiz.get(r) ?? []), e]);
  });

  const grupos: GrupoDeGrafias[] = [];
  for (const [r, membros] of porRaiz) {
    /* A principal é a que o cadastro vai carregar como nome canônico: quem tem
       CNPJ ganha (é a linha do Omie, com a razão social inteira), depois quem
       aparece mais. */
    const ordenadas = [...membros].sort((a, b) => {
      const da = a.doc.length >= 11 ? 0 : 1;
      const dbb = b.doc.length >= 11 ? 0 : 1;
      if (da !== dbb) return da - dbb;
      if (b.c.lancamentos !== a.c.lancamentos) return b.c.lancamentos - a.c.lancamentos;
      return b.c.nome.length - a.c.nome.length;
    });

    const juncao = (sinais.get(r) ?? []).reduce<Sinal | null>(
      (p, s) => (!p || PESO[s.conf] > PESO[p.conf] ? s : p),
      null,
    );

    /* O nome proposto. A planilha manda — não é palpite de modelo, é o que
       alguém digitou no formulário na hora de gastar. Sem ela, só vale o nome
       que já se explica sozinho; nome enigmático fica em branco de propósito,
       porque "Jim Com Grupo Souza" não é resposta, é a pergunta repetida. */
    const evidencia = membros
      .map((e) => propostas.get(e.chave))
      .find((p): p is Proposta => !!p?.apelido);

    const legivel = ordenadas.find((e) => !enigmatica(e.c)) ?? null;

    let sugestao = "";
    let confNome: Confianca = "baixa";
    let motivoNome = "";
    if (evidencia?.apelido) {
      sugestao = evidencia.apelido;
      confNome = evidencia.forte ? "alta" : "media";
      motivoNome = `planilha${evidencia.fonte ? ` ${evidencia.fonte}` : ""}`;
    } else if (legivel) {
      sugestao = sugestaoDeApelido(legivel.c.nome);
      confNome = "alta";
      motivoNome = "nome já serve";
    }

    const conf = pior(juncao?.conf ?? "alta", confNome);
    const motivo = juncao?.motivo ?? (motivoNome || "sem par");

    const ultima = membros
      .map((e) => e.c.ultima)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

    grupos.push({
      id: ordenadas[0].chave || ordenadas[0].c.nome,
      grafias: ordenadas.map((e) => e.c),
      motivo,
      conf,
      sugestao,
      lancamentos: membros.reduce((t, e) => t + (Number(e.c.lancamentos) || 0), 0),
      total: membros.reduce((t, e) => t + (Number(e.c.total) || 0), 0),
      ultima,
    });
  }

  return grupos;
}

/** A chave da grafia dentro do grupo — origem junto, porque o mesmo nome vem
 *  pelo cartão e pelo Omie e as duas linhas são separadas. */
export const chaveGrafia = (c: Candidato) => `${c.origem}:${c.nome}`;

/**
 * Os totais de um grupo depois das separações da tela.
 *
 * "Separar" é gesto de quem está olhando: o agrupamento errou, esta grafia não é
 * a mesma coisa. Ela sai da conta e do que vai ser gravado, mas continua na
 * lista aberta, riscada, para dar para desfazer.
 */
export function totalDoGrupo(
  g: GrupoDeGrafias,
  soltas: readonly string[] = [],
): { grafias: Candidato[]; lancamentos: number; total: number } {
  const dentro = g.grafias.filter((c) => !soltas.includes(chaveGrafia(c)));
  return {
    grafias: dentro,
    lancamentos: dentro.reduce((t, c) => t + (Number(c.lancamentos) || 0), 0),
    total: dentro.reduce((t, c) => t + (Number(c.total) || 0), 0),
  };
}

/**
 * Por onde começar.
 *
 *   • "valor"   — alta confiança primeiro e, dentro de cada faixa, o dinheiro
 *                 maior. É a ordem de quem vai varrer a fila inteira: as que dá
 *                 para confirmar em bloco vêm juntas, no topo.
 *   • "recente" — a última movimentação primeiro, confiança nenhuma no meio.
 *                 É a ordem de quem tem uma hora: contraparte sem nome que se
 *                 mexeu este mês volta na DRE desta semana, e a que parou em
 *                 maio já passou por todas as reuniões sem incomodar ninguém.
 *                 Ordenar por recência COM a confiança na frente devolveria a
 *                 ordem antiga com outro nome — por isso ela sai do critério.
 */
export type OrdemFila = "valor" | "recente";

export function comparadorDeGrupos(
  ordem: OrdemFila,
  totais: (g: GrupoDeGrafias) => number,
): (a: GrupoDeGrafias, b: GrupoDeGrafias) => number {
  if (ordem === "recente") {
    return (a, b) => {
      // Data ISO ordena como string; sem data vai para o fim.
      const da = a.ultima ?? "";
      const dbb = b.ultima ?? "";
      if (da !== dbb) return da < dbb ? 1 : -1;
      return totais(b) - totais(a);
    };
  }
  return (a, b) => PESO[a.conf] - PESO[b.conf] || totais(b) - totais(a);
}

export function ordenarGrupos(
  grupos: GrupoDeGrafias[],
  totais: (g: GrupoDeGrafias) => number,
  ordem: OrdemFila = "valor",
): GrupoDeGrafias[] {
  return [...grupos].sort(comparadorDeGrupos(ordem, totais));
}
