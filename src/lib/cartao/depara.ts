/**
 * De onde sai a categoria de cada lojista do cartão.
 *
 * A resposta não é "a IA chuta" nem "alguém digita 94 vezes": a empresa já
 * classificou estes mesmos lojistas nos últimos oito meses, à mão, dentro do
 * Omie. Este módulo vai buscar essa decisão — casa cada lançamento das faturas
 * já importadas com o título correspondente no Omie e vê em que categoria a
 * analista o colocou. O de-para é, literalmente, a prática da casa.
 *
 * NÃO HÁ ID EM COMUM entre a fatura e o Omie, então o casamento é por VALOR
 * exato + DATA próxima. Valor em reais com centavos é bem discriminante, mas não
 * é único: a fatura de julho tem 82 linhas de IOF, várias de R$ 19,25. Por isso
 * a regra abaixo desiste de casar quando há ambiguidade REAL — e só quando ela
 * muda a resposta. Se três títulos empatam no valor mas os três estão na mesma
 * categoria, a categoria é certa mesmo sem saber qual título é qual.
 *
 * Módulo puro: sem React, sem Supabase, sem rede. Nada aqui fala com o Omie —
 * os títulos vêm do cache local (`cartao_omie_titulos`).
 */

/* ------------------------------------------------------------------ */

export type TituloOmie = {
  codTitulo: string;
  data: string;                       // 'YYYY-MM-DD'
  valor: number;
  codigoCategoria: string | null;
  descricaoCategoria: string | null;
};

/** O mínimo que um lançamento de fatura precisa ter para procurar seu título. */
export type LinhaHistorico = {
  chave: string;
  estabelecimento: string;
  data: string;
  valor: number;
};

export type Par<T extends LinhaHistorico> = {
  linha: T;
  titulo: TituloOmie;
  /** Quantos títulos empatavam no valor. 1 = casamento limpo. */
  candidatos: number;
};

export type Origem = "historico" | "manual" | "ia";

export type EntradaMapa = {
  chave: string;
  codigoCategoria: string;
  descricaoCategoria: string | null;
  origem: Origem;
  /** Lançamentos casados que apontaram para ESTA categoria. */
  votos: number;
  /** Lançamentos casados desta chave, no total. `votos/examinados` é a força. */
  examinados: number;
  exemplos: string[];
};

export type Mapa = Map<string, EntradaMapa>;

/* ------------------------------------------------------------------ */

const DIA = 86_400_000;

const diasEntre = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA;

/** Centavos como inteiro: comparar float de dinheiro erra em 0,01 e some. */
const cents = (v: number) => Math.round(v * 100);

/**
 * Casa lançamentos da fatura com títulos do Omie.
 *
 * `maxDias` é generoso (45) de propósito: o título é registrado no Omie quando a
 * analista lança a fatura, não quando a compra aconteceu, e entre uma coisa e
 * outra passa mais de um mês. Estreitar isso perderia justamente os casos que
 * mais interessam — os parcelados, cuja data de compra é antiga.
 */
export function casar<T extends LinhaHistorico>(
  linhas: T[],
  titulos: TituloOmie[],
  maxDias = 45,
): Par<T>[] {
  const porValor = new Map<number, TituloOmie[]>();
  for (const t of titulos) {
    if (!t.codigoCategoria) continue;
    const k = cents(t.valor);
    const lista = porValor.get(k);
    if (lista) lista.push(t); else porValor.set(k, [t]);
  }

  const pares: Par<T>[] = [];
  for (const linha of linhas) {
    const candidatos = (porValor.get(cents(linha.valor)) ?? [])
      .filter((t) => diasEntre(t.data, linha.data) <= maxDias);
    if (!candidatos.length) continue;

    // Ambiguidade só atrapalha se mudar a resposta. Vários títulos de R$ 19,25
    // todos em "Despesas bancárias" ensinam a mesma coisa que um só.
    const categorias = new Set(candidatos.map((t) => t.codigoCategoria));
    if (categorias.size > 1) continue;

    const maisProximo = candidatos.reduce((a, b) =>
      diasEntre(a.data, linha.data) <= diasEntre(b.data, linha.data) ? a : b,
    );
    pares.push({ linha, titulo: maisProximo, candidatos: candidatos.length });
  }
  return pares;
}

/**
 * Do que foi casado, tira uma categoria por lojista — a que ele mais recebeu.
 *
 * Empate é resolvido pela categoria com o lançamento mais recente: quando um
 * fornecedor muda de rubrica no meio do ano, a decisão nova é a que vale (é a
 * mesma leitura do alerta de reclassificação da DRE/DFC).
 */
export function aprender<T extends LinhaHistorico>(pares: Par<T>[]): Mapa {
  type Acc = {
    porCategoria: Map<string, { n: number; ultima: string; descricao: string | null }>;
    exemplos: Set<string>;
    total: number;
  };
  const acc = new Map<string, Acc>();

  for (const p of pares) {
    const cod = p.titulo.codigoCategoria!;
    const a = acc.get(p.linha.chave)
      ?? { porCategoria: new Map(), exemplos: new Set<string>(), total: 0 };
    const c = a.porCategoria.get(cod)
      ?? { n: 0, ultima: "", descricao: p.titulo.descricaoCategoria };
    c.n++;
    if (p.linha.data > c.ultima) c.ultima = p.linha.data;
    a.porCategoria.set(cod, c);
    a.exemplos.add(p.linha.estabelecimento);
    a.total++;
    acc.set(p.linha.chave, a);
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
   * "alta"  → escolha manual, ou histórico unânime com 3+ lançamentos;
   * "media" → histórico com maioria folgada;
   * "baixa" → um único lançamento sustentando, histórico dividido, ou IA.
   * A tela usa isto para decidir o que exigir de conferência — e não para
   * esconder nada: toda linha continua editável.
   */
  confianca: "alta" | "media" | "baixa";
};

export function sugerir(mapa: Mapa, chave: string): Sugestao | null {
  const e = mapa.get(chave);
  if (!e) return null;

  const unanime = e.votos === e.examinados;
  // A razão votos/examinados sozinha engana: um único lançamento dá 1,0 e
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

/** Cobertura do de-para sobre uma fatura — o que a tela mostra antes de tudo. */
export function cobertura(mapa: Mapa, chaves: string[]): {
  total: number; cobertas: number; faltando: string[];
} {
  const unicas = [...new Set(chaves)];
  const faltando = unicas.filter((c) => !mapa.has(c));
  return { total: unicas.length, cobertas: unicas.length - faltando.length, faltando };
}
