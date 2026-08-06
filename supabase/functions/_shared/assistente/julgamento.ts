// Julgamento — transforma um número em "isso é normal ou não".
//
// A REGRA QUE ORGANIZA ESTE ARQUIVO: julgamento é ARITMÉTICA, não retórica. Se o modelo
// decidisse sozinho o que é "preocupante", estaria opinando sem base — o mesmo problema
// que a conferência de somas existe para evitar. Aqui o veredito é calculado, entregue ao
// modelo como fato, e ele só o comunica.
//
// Duas réguas, porque respondem a perguntas diferentes:
//   • CONTRA O PRÓPRIO HISTÓRICO — "é fora do padrão para esta rubrica?" Usa média e
//     desvio dos meses fechados anteriores.
//   • CONTRA O PLANEJADO (BP anual) — "estamos acima do que combinamos gastar?" É o que
//     dá direção: 20% acima da média histórica pode ser ótimo se o plano previa dobrar.
//
// Sem a segunda régua o assistente vira um detector de anomalia estatística, que acusa
// crescimento planejado como se fosse problema.

import { Competencia, Demonstracao, montarColuna, ordenar } from "./dre.ts";

export type Veredito = {
  /** Como o valor se compara ao próprio histórico. */
  padrao: "sem histórico" | "dentro do padrão" | "acima do padrão" | "abaixo do padrão" | "recorde";
  media: number | null;
  desvio: number | null;
  /** Quantos desvios-padrão o valor está da média. */
  z: number | null;
  meses: number;
};

/**
 * Compara um valor com a série histórica dele.
 *
 * Exige pelo menos 4 meses: abaixo disso o desvio-padrão é ruído e chamar algo de "fora do
 * padrão" seria chute com aparência de estatística.
 *
 * O corte em 2 desvios é convenção, não lei — vale como sinal de "vale olhar", nunca como
 * veredito de erro.
 */
export function julgarSerie(historico: number[], atual: number): Veredito {
  const validos = historico.filter((v) => Number.isFinite(v));
  if (validos.length < 4) {
    return { padrao: "sem histórico", media: null, desvio: null, z: null, meses: validos.length };
  }

  const media = validos.reduce((a, b) => a + b, 0) / validos.length;
  const variancia = validos.reduce((a, b) => a + (b - media) ** 2, 0) / validos.length;
  const desvio = Math.sqrt(variancia);

  const maiorQueTodos = validos.every((v) => Math.abs(atual) > Math.abs(v));
  if (maiorQueTodos) {
    return { padrao: "recorde", media, desvio, z: desvio > 0 ? (atual - media) / desvio : null, meses: validos.length };
  }

  // Desvio zero significa série constante: qualquer diferença já é fora do padrão.
  if (desvio === 0) {
    return {
      padrao: atual === media ? "dentro do padrão" : "acima do padrão",
      media, desvio, z: null, meses: validos.length,
    };
  }

  const z = (atual - media) / desvio;
  const padrao = z > 2 ? "acima do padrão" : z < -2 ? "abaixo do padrão" : "dentro do padrão";
  return { padrao, media, desvio, z, meses: validos.length };
}

/** Série de uma rubrica nos meses fechados ANTERIORES à competência dada. */
export function serieAnterior(
  d: Demonstracao,
  rubrica: string,
  fechados: Competencia[],
  ate: Competencia,
  limite = 12,
): number[] {
  return fechados
    .filter((c) => ordenar(c, ate) < 0)
    .slice(-limite)
    .map((c) => d.valores.get(rubrica.toLowerCase())?.get(montarColuna(c)))
    .filter((v): v is number => typeof v === "number");
}

// ---------------------------------------------------------------------------
// Contra o planejado (BP anual)
// ---------------------------------------------------------------------------

/**
 * Rubricas do DRE ↔ rubricas do BP anual.
 *
 * ESPELHA `ORC_ALIASES` de src/pages/dashboard/useFinanceData.ts. O BP usa rótulos
 * numerados ("5.4.Viagens & Transportes") e AGREGA contas que aparecem separadas no
 * realizado — por isso o mapa é manual e vários itens do DRE apontam para a mesma linha
 * do plano. Se mudar lá, muda aqui.
 */
const ALIAS_BP: Record<string, string[]> = {
  "equipe administrativa": ["4.1.Equipe Administrativa"],
  "equipe marketing": ["4.2.Equipe Marketing"],
  "equipe comercial": ["4.3.Equipe Comercial"],
  "equipe onboarding": ["4.4.Equipe Onboarding"],
  "equipe tecnologia": ["4.5.Equipe Tecnologia"],
  "equipe operacional": ["3.1.Equipe Operacional"],
  "beneficios": ["4.6.Benefícios"],
  "premiacoes operacionais": ["3.2.Premiação Operacional"],
  "premiacoes": ["3.2.Premiação Operacional"],
  "meios de pagamento": ["3.3.Meios de Pagamento"],
  "servidor": ["3.4.Infraestrutura"],
  "softwares operacionais": ["3.5.Softwares Operacionais"],
  "outros custos": ["3.6.Outros Custos"],
  "cmv materiais": ["3.6.Outros Custos"],
  "ocupacao & escritorio": ["5.1.Ocupação & Escritório"],
  "assessorias & consultorias": ["5.2.Assessorias & Consultorias"],
  "agencias & consultorias": ["5.2.Assessorias & Consultorias"],
  "softwares administrativos": ["5.3.Softwares Administrativos"],
  "viagens & transportes adm": ["5.4.Viagens & Transportes"],
  "viagens & transportes mkt": ["5.4.Viagens & Transportes"],
  "outras despesas adm": ["5.5.Outras Despesas Adm"],
  "campanhas de midia paga": ["6.1.Aquisição de Clientes"],
  "campanhas de outros canais": ["6.1.Aquisição de Clientes"],
  "comissoes consultores / parceiros": ["6.2.Comissões"],
  "mgm": ["6.3.Outras Despesas M&V"],
  "eventos e feiras": ["6.3.Outras Despesas M&V"],
  "outras despesas mkt": ["6.3.Outras Despesas M&V"],
  "softwares marketing & vendas": ["6.3.Outras Despesas M&V"],
  "(+) receita financeira": ["9.1.Recebimento de Juros"],
  "(-) juros": ["9.2.Pagamento de Juros"],
  "pis": ["2.1.PIS"],
  "cofins": ["2.2.COFINS"],
  "iss": ["2.3.ISS"],
  "receita liquida": ["Receita Líquida"],
  "ebitda": ["EBITDA"],
};

function normalizar(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/^[\d.)\s\-+(]+/, "")
    .replace(/^[()+\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** metrica normalizada|ano|mes → valor planejado */
export type IndiceBP = Map<string, number>;

const MES_ROTULO = /^mes calendario/;

/**
 * Achata `bp_anual.dados` num índice consultável.
 *
 * O formato é uma planilha serializada: a linha "Mês Calendário" diz quais colunas são
 * quais meses (1..12). Sem ela, caímos nas 12 primeiras colunas numéricas — mesmo
 * fallback da página de BP.
 */
export function indexarBP(linhas: { ano: number; dados: unknown }[]): IndiceBP {
  const idx: IndiceBP = new Map();

  for (const linha of linhas) {
    const arr = Array.isArray(linha.dados) ? (linha.dados as Record<string, unknown>[]) : [];
    if (arr.length === 0) continue;

    const chaves = Object.keys(arr[0] ?? {});
    const chaveRotulo = chaves[0];
    const colunasMes: string[] = [];

    const linhaMeses = arr.find((r) => MES_ROTULO.test(normalizar(String(r[chaveRotulo] ?? ""))));
    if (linhaMeses) {
      for (const k of chaves) {
        const n = Number(linhaMeses[k]);
        if (Number.isInteger(n) && n >= 1 && n <= 12) colunasMes[n - 1] = k;
      }
    }
    if (colunasMes.filter(Boolean).length < 12) {
      const numericas = chaves.slice(1).filter((k) => arr.some((r) => typeof r[k] === "number"));
      for (let i = 0; i < 12 && i < numericas.length; i++) if (!colunasMes[i]) colunasMes[i] = numericas[i];
    }

    for (const r of arr) {
      const rotulo = String(r[chaveRotulo] ?? "").trim();
      const norm = normalizar(rotulo);
      // Descarta linhas estruturais da planilha, que não são rubricas. Os testes de
      // igualdade exata ("ano", "mes") cobrem o rótulo sem sufixo, que os prefixos com
      // espaço deixavam passar — viraria uma "rubrica" cujo valor planejado é o número
      // do ano.
      const estrutural = !norm
        || norm === "ano" || norm.startsWith("ano ")
        || norm === "mes" || norm.startsWith("mes ")
        || norm === "imagem" || norm.startsWith("projec");
      if (estrutural) continue;

      colunasMes.forEach((coluna, i) => {
        if (!coluna) return;
        const v = Number(r[coluna]);
        if (!Number.isFinite(v) || v === 0) return;
        const chave = `${norm}|${linha.ano}|${i + 1}`;
        idx.set(chave, (idx.get(chave) ?? 0) + v);
      });
    }
  }
  return idx;
}

export type Orcado = {
  planejado: number;
  realizado: number;
  desvio: number;
  desvioPct: number | null;
};

/** Valor planejado para uma rubrica num mês, seguindo os aliases. */
export function planejado(idx: IndiceBP, rubrica: string, c: Competencia): number | null {
  const norm = normalizar(rubrica);
  const candidatos = [rubrica, ...(ALIAS_BP[norm] ?? [])];
  for (const nome of candidatos) {
    const v = idx.get(`${normalizar(nome)}|${c.ano}|${c.mes}`);
    if (v != null) return v;
  }
  return null;
}

/** Realizado contra planejado. Devolve null quando a rubrica não está no plano. */
export function compararComPlano(
  idx: IndiceBP,
  rubrica: string,
  c: Competencia,
  realizado: number,
): Orcado | null {
  const plano = planejado(idx, rubrica, c);
  if (plano === null) return null;

  const desvio = realizado - plano;
  // Percentual só faz sentido com base diferente de zero.
  const desvioPct = plano !== 0 ? (desvio / Math.abs(plano)) * 100 : null;
  return { planejado: plano, realizado, desvio, desvioPct };
}

// ---------------------------------------------------------------------------
// Tendência
// ---------------------------------------------------------------------------

export type Tendencia = {
  direcao: "subindo" | "caindo" | "estável" | "oscilando" | "indefinida";
  /** Variação média por mês, em % sobre o nível médio da série. */
  inclinacaoPct: number | null;
  /** 0 a 1: o quanto a reta explica a série. Baixo = série errática. */
  aderencia: number | null;
  meses: number;
};

/**
 * Direção da série por regressão linear.
 *
 * Comparar dois meses responde "mudou?", não "está indo para onde?". Uma rubrica pode cair
 * neste mês e ainda estar em trajetória de alta há meio ano — e é a trajetória que importa
 * para decidir, não o solavanco.
 *
 * A aderência (R²) evita o erro clássico de traçar reta em série errática: sem ela,
 * qualquer ruído viraria "tendência de alta". Abaixo de 0,3 a resposta é "oscilando", que
 * é uma informação honesta e não um veredito falso.
 */
export function analisarTendencia(serie: number[]): Tendencia {
  const y = serie.filter((v) => Number.isFinite(v));
  if (y.length < 5) {
    return { direcao: "indefinida", inclinacaoPct: null, aderencia: null, meses: y.length };
  }

  const n = y.length;
  const x = y.map((_, i) => i);
  const mediaX = (n - 1) / 2;
  const mediaY = y.reduce((a, b) => a + b, 0) / n;

  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mediaX;
    const dy = y[i] - mediaY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  if (sxx === 0 || syy === 0) {
    return { direcao: "estável", inclinacaoPct: 0, aderencia: 1, meses: n };
  }

  const inclinacao = sxy / sxx;                     // unidades por mês
  const aderencia = (sxy * sxy) / (sxx * syy);      // R²
  const escala = Math.abs(mediaY) || 1;
  const inclinacaoPct = (inclinacao / escala) * 100;

  // Série que a reta não explica: dizer "subindo" seria ler ruído como sinal.
  if (aderencia < 0.3) {
    return { direcao: "oscilando", inclinacaoPct, aderencia, meses: n };
  }
  // Menos de 2% ao mês é ruído de operação, não movimento.
  if (Math.abs(inclinacaoPct) < 2) {
    return { direcao: "estável", inclinacaoPct, aderencia, meses: n };
  }
  return {
    direcao: inclinacaoPct > 0 ? "subindo" : "caindo",
    inclinacaoPct, aderencia, meses: n,
  };
}

export function fraseTendencia(t: Tendencia): string {
  if (t.direcao === "indefinida") return `sem série suficiente para tendência (${t.meses} meses)`;
  if (t.direcao === "oscilando") return `oscilando sem direção clara em ${t.meses} meses`;
  if (t.direcao === "estável") return `estável nos últimos ${t.meses} meses`;
  return `${t.direcao} ~${Math.abs(t.inclinacaoPct ?? 0).toFixed(1)}% ao mês nos últimos ${t.meses} meses`;
}

/** Frase pronta e determinística, para o modelo comunicar sem inventar adjetivo. */
export function frasePadrao(v: Veredito, formatar: (n: number) => string): string {
  if (v.padrao === "sem histórico") return `sem histórico suficiente (${v.meses} mês/meses)`;
  if (v.padrao === "recorde") return `RECORDE da série (${v.meses} meses observados)`;
  const base = `${v.padrao} (média ${formatar(v.media ?? 0)} em ${v.meses} meses`;
  return v.z !== null ? `${base}, ${v.z.toFixed(1)} desvios)` : `${base})`;
}
