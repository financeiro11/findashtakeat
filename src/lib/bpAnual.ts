/* ============================================================================
 * Leitura do BP anual (`bp_anual.dados`) por rubrica e mês.
 *
 * A planilha do BP não tem o formato do blob da DRE: as colunas dos meses não
 * se chamam "Jan-26", elas são identificadas por uma linha "Mês Calendário"
 * que carrega 1..12. E os rótulos vêm com numeração de tópico ("1.1 Receita
 * Bruta") ou com o sinal contábil colado ("(-) SG&A"), então o casamento com o
 * esquema da DRE é por rótulo normalizado, não por igualdade.
 *
 * Isto morava dentro de pages/BPAnual.tsx. Saiu para cá quando a aba Análises
 * da DRE passou a precisar do mesmo plano: duas cópias de uma heurística frágil
 * divergem no primeiro ano em que a diretoria mudar o layout da planilha.
 * ========================================================================== */

export type MapaMensal = Record<string, (number | null)[]>;

export type BpAnual = {
  /** rótulo normalizado → 12 posições (Jan..Dez), null onde não há plano */
  porRubrica: MapaMensal;
  /** rótulo normalizado → total anual (a coluna de total, quando existe) */
  anual: Record<string, number>;
  /** true quando `bp_anual` não tinha nada para o ano */
  vazio: boolean;
  /** rótulos que apareciam mais de uma vez; valeu o primeiro bloco (ver abaixo) */
  duplicadas: string[];
};

const EN_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

/** "1.1 (-) SG&A" → "sg&a". Derruba acento, caixa, numeração de tópico e sinal. */
export function normLabel(s: string): string {
  return s.toString().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/^[\d.)\s\-+]+/, "")
    .replace(/^[()+\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Melhor chave para um rótulo alvo.
 *
 * Exato primeiro. Sem exato, a que CONTÉM o alvo (ou é contida por ele) com a
 * menor diferença de tamanho — sem esse desempate, procurar "receita liquida"
 * casava com "receita" e o plano vinha errado por um fator de 3. Linhas de
 * percentual ficam fora quando o alvo não é percentual, senão "% Margem EBITDA"
 * responde por "EBITDA".
 */
export function bestKey(keys: string[], target: string): string | null {
  if (keys.includes(target)) return target;
  const alvoEhPct = target.startsWith("%") || target.includes("margem");
  const candidatos = keys.filter((k) => {
    if (k === target) return true;
    if (!alvoEhPct && (k.startsWith("%") || k.includes("margem"))) return false;
    return k.includes(target) || target.includes(k);
  });
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => Math.abs(a.length - target.length) - Math.abs(b.length - target.length));
  return candidatos[0];
}

/** Série de 12 meses de um rótulo, casando pelo rótulo normalizado. */
export function lookupMensal(mapa: MapaMensal, label: string): (number | null)[] {
  const k = bestKey(Object.keys(mapa), normLabel(label));
  return k ? mapa[k] : Array(12).fill(null);
}

/**
 * Parser do `bp_anual.dados`: array de linhas da planilha → rubrica × mês.
 *
 * VALE O PRIMEIRO BLOCO. A planilha da diretoria repete a mesma rubrica em
 * blocos auxiliares depois do plano: um com o sinal trocado (para alimentar
 * gráfico) e um deslocado um mês (o "período anterior"). Somar as ocorrências
 * — como se fazia — misturava os três: `(-) SG&A` de Jun/26 saía −1.159.105,
 * que é o número de MAIO, porque o bloco deslocado cancelava o de sinal
 * trocado e sobrava ele. O primeiro bloco é o plano de verdade.
 *
 * Rubrica que a planilha genuinamente quebrar em duas linhas perde a segunda —
 * por isso os rótulos repetidos saem em `duplicadas` em vez de sumirem calados.
 */
export function lerBpAnual(dados: unknown): BpAnual {
  const arr = (Array.isArray(dados) ? dados : []) as Record<string, unknown>[];
  if (!arr.length) return { porRubrica: {}, anual: {}, vazio: true, duplicadas: [] };

  const keys = Object.keys(arr[0] ?? {});
  const labelKey = keys[0];

  // As colunas dos meses saem da linha "Mês Calendário", que traz 1..12.
  const linhaMes = arr.find((r) => normLabel(String(r[labelKey] ?? "")).startsWith("mes calendario"));
  const colsMes: string[] = [];
  if (linhaMes) {
    for (const k of keys) {
      const n = typeof linhaMes[k] === "number" ? (linhaMes[k] as number) : Number(linhaMes[k]);
      if (Number.isInteger(n) && n >= 1 && n <= 12) colsMes[n - 1] = k;
    }
  }
  // Sem a linha-guia, cai para as 12 primeiras colunas que têm número.
  if (colsMes.filter(Boolean).length < 12) {
    const numericas = keys.slice(1).filter((k) => arr.some((r) => typeof r[k] === "number"));
    for (let i = 0; i < 12 && i < numericas.length; i++) colsMes[i] = numericas[i];
  }

  // Total anual: a primeira coluna depois do mês 12 com valores de porte.
  const idx12 = colsMes[11] ? keys.indexOf(colsMes[11]) : -1;
  let colTotal: string | null = null;
  for (let i = idx12 + 1; i < keys.length; i++) {
    const k = keys[i];
    if (arr.some((r) => typeof r[k] === "number" && Math.abs(r[k] as number) > 1000)) { colTotal = k; break; }
  }

  const porRubrica: MapaMensal = {};
  const anual: Record<string, number> = {};
  const duplicadas: string[] = [];
  for (const r of arr) {
    const norm = normLabel(String(r[labelKey] ?? "").trim());
    if (!norm) continue;
    const meses = colsMes.map((k) => (k ? toNum(r[k]) : null));
    if (meses.every((v) => v == null)) continue;
    if (porRubrica[norm]) {
      if (!duplicadas.includes(norm)) duplicadas.push(norm);
      continue;                                   // vale o primeiro bloco
    }
    porRubrica[norm] = meses;
    const total = colTotal ? toNum(r[colTotal]) : null;
    const somado = meses.reduce<number | null>((a, b) => (b == null ? a : (a ?? 0) + b), null);
    anual[norm] = total ?? somado ?? 0;
  }

  return { porRubrica, anual, vazio: false, duplicadas };
}

/**
 * Adaptador do BP para o formato das colunas da DRE.
 *
 * Devolve `(rubrica, "Jul-26") → valor do plano`, para que as análises leiam
 * plano e realizado com a mesma assinatura. Recebe os anos todos porque a
 * janela da DRE atravessa exercícios (Jan/24 a Jul/26) e cada ano tem o seu
 * `bp_anual`; ano sem plano devolve null em vez de cair no BP do ano errado.
 */
export function planoPorColuna(porAno: Map<number, BpAnual>) {
  const cache = new Map<string, (number | null)[]>();
  return (label: string, col: string): number | null => {
    const m = /^([A-Za-z]{3})-(\d{2})$/.exec(col ?? "");
    if (!m) return null;
    const ano = 2000 + parseInt(m[2], 10);
    const bp = porAno.get(ano);
    if (!bp || bp.vazio) return null;
    const mes = EN_ORDER.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
    if (mes < 0) return null;
    const chave = `${ano}|${label}`;
    let serie = cache.get(chave);
    if (!serie) { serie = lookupMensal(bp.porRubrica, label); cache.set(chave, serie); }
    return serie[mes] ?? null;
  };
}
