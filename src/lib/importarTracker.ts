/* ---------------------------------------------------------------------------
 *  Import do tracker (Excel/CSV) — o arquivo que alimenta DRE e DFC.
 *
 *  A planilha é a mesma nas duas telas: um cabeçalho de meses ("jan/24", "Jan-24"…),
 *  o bloco "Demonstrativo de Resultado" e, mais abaixo, o "Fluxo de Caixa". O leitor
 *  vivia copiado em DRE.tsx e DFC.tsx, linha a linha; aqui ele é um só.
 *
 *  O que este módulo decide, além de ler: QUANTO do arquivo entra. O tracker carrega
 *  o histórico inteiro (às vezes anos), e até aqui todo import reescrevia e re-travava
 *  tudo que estivesse preenchido — reimportar por causa do mês novo desfazia, sem
 *  avisar, o que tinha sido corrigido na tela num mês antigo. Agora quem importa
 *  escolhe o escopo (`EscopoImport`) e o padrão é o conservador.
 * ------------------------------------------------------------------------- */

import * as XLSX from "xlsx";

const MES_PT_TO_EN: Record<string, string> = {
  jan: "Jan", fev: "Feb", mar: "Mar", abr: "Apr", mai: "May", jun: "Jun",
  jul: "Jul", ago: "Aug", set: "Sep", out: "Oct", nov: "Nov", dez: "Dec",
};
const MES_PT_FULL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EN_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "jan/24" => "Jan-24" (a chave de coluna usada em todo o resto do sistema). */
export function colKey(ptLabel: string): string | null {
  const m = ptLabel?.toString().toLowerCase().trim().match(/^([a-zçãéê]{3,})[\s/-]+(\d{2,4})$/);
  if (!m) return null;
  const en = MES_PT_TO_EN[m[1].slice(0, 3)];
  if (!en) return null;
  const yy = m[2].length === 4 ? m[2].slice(-2) : m[2];
  return `${en}-${yy}`;
}

/** "Jan-24" => "Jan/24" — o rótulo que a pessoa lê. */
export function ptLabelFromKey(k: string): string {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return k;
  const idx = EN_ORDER.indexOf(m[1]);
  return idx >= 0 ? `${MES_PT_FULL[idx]}/${m[2]}` : k;
}

export function sortKey(k: string): number {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return -1;
  const i = EN_ORDER.indexOf(m[1]);
  if (i < 0) return -1;
  return (2000 + parseInt(m[2], 10)) * 12 + i;
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/\s/g, "").replace(/R\$/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  s = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

/**
 * Corta as colunas do import nas que têm dado real e substancial — planilhas de tracker
 * costumam ter o ano inteiro (ou vários anos) de cabeçalho, mas só os meses já FECHADOS
 * vêm de fato preenchidos; os meses futuros ficam em branco ou com lixo esporádico
 * (ex.: uma fórmula do template deixando "1" numa célula). Sem esse corte, o import travava
 * e sobrescrevia meses que nem estavam fechados ainda — inclusive apagando o que o Omie já
 * tinha calculado pra eles. Mesmo critério do heurístico de lastCol/prevCol (linha populada
 * em pelo menos 25% do máximo, piso de 3), parando no primeiro mês que não bate o critério.
 */
export function colunasFechadas(
  rows: Record<string, unknown>[],
  colsOrdenadas: string[],
  hoje: Date = new Date(),
): string[] {
  const counts = colsOrdenadas.map((col) => rows.reduce((acc, row) => (typeof row[col] === "number" ? acc + 1 : acc), 0));
  const maxCount = Math.max(...counts, 0);
  if (maxCount === 0) return [];
  const minCount = Math.max(3, Math.ceil(maxCount * 0.25));
  let ultimoIdx = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] >= minCount) ultimoIdx = i;
    else break;
  }
  /* O mês CORRENTE não fechou, por mais preenchido que ele pareça — e na aba
     automática do tracker ele vem pior que vazio: Ago/26 chegou com a coluna
     inteira invertida (Equipe Operacional +66.800, Benefícios +52.000, Entradas
     134) porque a planilha calcula o mês em curso por estorno. Isso entrou como
     mês fechado, travou, e virou um Cashburn de +753.602 — "queima" positiva de
     três quartos de milhão na última coluna da DFC. O mês em curso é do Omie,
     que tem o lançamento de verdade; o tracker só manda depois que ele acaba. */
  const corrente = sortKey(`${EN_ORDER[hoje.getMonth()]}-${String(hoje.getFullYear()).slice(-2)}`);
  return colsOrdenadas.slice(0, ultimoIdx + 1).filter((c) => sortKey(c) < corrente);
}

/* ============================================================
 *  Leitura do arquivo
 * ============================================================ */

export type LinhaTracker = Record<string, string | number>;

/** O arquivo já lido e separado — antes de qualquer decisão sobre o que gravar. */
export type TrackerLido = {
  arquivo: string;
  /** Todos os meses do cabeçalho, em ordem cronológica. */
  cols: string[];
  dreRows: LinhaTracker[];
  dfcRows: LinhaTracker[];
  /** Meses com dado substancial em cada demonstrativo (ver `colunasFechadas`). */
  dreFechadas: string[];
  dfcFechadas: string[];
  /** União das duas, cronológica: os meses que o arquivo tem para oferecer. */
  fechadas: string[];
  /** Meses do cabeçalho que ficaram de fora por dado incompleto. */
  ignoradas: string[];
};

/** Parser CSV simples, com aspas, para o separador detectado. */
function parseCsv(src: string, d: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === d) { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); out.push(row); }
  return out;
}

/** Arquivo (xlsx/xls/csv) → matriz de células. */
export async function matrizDoArquivo(file: File): Promise<unknown[][]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
    throw new Error("Formato não suportado. Envie um arquivo .xlsx, .xls ou .csv.");
  }
  const buf = await file.arrayBuffer();
  if (ext === "csv") {
    // Detecta encoding e parseia manualmente (separador ; com vírgula decimal BR)
    const bytes = new Uint8Array(buf);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder("windows-1252").decode(bytes); }
    const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
    const delim = (firstLines.match(/;/g)?.length ?? 0) > (firstLines.match(/,/g)?.length ?? 0) ? ";" : ",";
    return parseCsv(text, delim);
  }
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }) as unknown[][];
}

/**
 * Matriz de células → linhas de DRE e DFC, com os meses já em chave de coluna.
 * Lança se não achar o cabeçalho de meses (arquivo que não é o tracker).
 */
export function extrairTracker(matrix: unknown[][], arquivo = ""): TrackerLido {
  // Encontra a linha de cabeçalho (contém "jan/24" ou similar) e a coluna do rótulo
  let headerRowIdx = -1;
  let labelColIdx = 1;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i] || [];
    if (row.some((c) => colKey(String(c ?? "")))) {
      headerRowIdx = i;
      // a coluna do rótulo costuma ser a que tem "Data"
      const dataCol = row.findIndex((c) => String(c ?? "").trim().toLowerCase() === "data");
      if (dataCol >= 0) labelColIdx = dataCol;
      break;
    }
  }
  if (headerRowIdx < 0) throw new Error("Não consegui identificar o cabeçalho de meses");

  const headerRow = matrix[headerRowIdx];
  const monthMap: { idx: number; key: string }[] = [];
  headerRow.forEach((cell, idx) => {
    const k = colKey(String(cell ?? ""));
    if (k) monthMap.push({ idx, key: k });
  });
  // Ordena cronologicamente e dedupa
  const seenKeys = new Set<string>();
  const monthCols = monthMap
    .sort((a, b) => sortKey(a.key) - sortKey(b.key))
    .filter((m) => { if (seenKeys.has(m.key)) return false; seenKeys.add(m.key); return true; });
  const cols = monthCols.map((m) => m.key);

  // Localiza separadores das seções
  let dreStart = -1, dfcStart = -1;
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const lab = String(matrix[i]?.[labelColIdx] ?? "").trim().toLowerCase();
    if (!lab) continue;
    if (dreStart < 0 && lab.includes("demonstrativo de resultado")) dreStart = i;
    else if (dfcStart < 0 && (lab.includes("fluxo de caixa") || lab === "dfc")) { dfcStart = i; break; }
  }
  if (dreStart < 0) dreStart = headerRowIdx;
  const dreEnd = dfcStart > 0 ? dfcStart : matrix.length;

  const buildRows = (from: number, to: number): LinhaTracker[] => {
    const out: LinhaTracker[] = [];
    for (let i = from + 1; i < to; i++) {
      const row = matrix[i] || [];
      const lab = String(row[labelColIdx] ?? "").trim();
      if (!lab) continue;
      const rec: LinhaTracker = { Conta: lab };
      for (const m of monthCols) {
        const v = toNum(row[m.idx]);
        rec[m.key] = v === null ? "" : v;
      }
      out.push(rec);
    }
    return out;
  };

  const dreRows = buildRows(dreStart, dreEnd);
  const dfcRows = dfcStart > 0 ? buildRows(dfcStart, matrix.length) : [];

  const dreFechadas = colunasFechadas(dreRows, cols);
  const dfcFechadas = colunasFechadas(dfcRows, cols);
  const uniao = new Set([...dreFechadas, ...dfcFechadas]);
  const fechadas = cols.filter((c) => uniao.has(c));

  return {
    arquivo,
    cols,
    dreRows,
    dfcRows,
    dreFechadas,
    dfcFechadas,
    fechadas,
    ignoradas: cols.filter((c) => !uniao.has(c)),
  };
}

/** Atalho: lê o arquivo e já devolve o tracker separado. */
export async function lerTracker(file: File): Promise<TrackerLido> {
  return extrairTracker(await matrizDoArquivo(file), file.name);
}

/* ============================================================
 *  Escopo: quanto do arquivo entra
 * ============================================================ */

/**
 *  - `ultimo`  → só o mês mais recente do arquivo.
 *  - `abertos` → os meses do arquivo que ainda NÃO estavam travados (o que fechou
 *    desde o último import). Nenhum mês já fechado é reescrito.
 *  - `todos`   → tudo que o arquivo traz preenchido, inclusive meses já fechados,
 *    que são reescritos e re-travados. É como o import sempre se comportou.
 */
export type EscopoImport = "ultimo" | "abertos" | "todos";

export function colunasDoEscopo(
  fechadas: string[],
  travados: Iterable<string>,
  escopo: EscopoImport,
): string[] {
  if (!fechadas.length) return [];
  if (escopo === "todos") return [...fechadas];
  if (escopo === "ultimo") return [fechadas[fechadas.length - 1]];
  const set = travados instanceof Set ? travados : new Set(travados);
  return fechadas.filter((c) => !set.has(c));
}

/** "Ago/26", "Jul/26 e Ago/26", "Jan/24 → Ago/26 (32 meses)". */
export function resumoMeses(meses: string[]): string {
  if (!meses.length) return "nenhum mês";
  const rot = meses.map(ptLabelFromKey);
  if (rot.length === 1) return rot[0];
  if (rot.length === 2) return `${rot[0]} e ${rot[1]}`;
  if (rot.length === 3) return `${rot[0]}, ${rot[1]} e ${rot[2]}`;
  return `${rot[0]} → ${rot[rot.length - 1]} (${rot.length} meses)`;
}

export type OpcaoEscopo = {
  escopo: EscopoImport;
  titulo: string;
  descricao: string;
  meses: string[];
};

/**
 * Monta as opções que fazem sentido para ESTE arquivo, contra os meses já travados.
 * Opção que gravaria exatamente o mesmo que outra não aparece duas vezes: quando o
 * único mês em aberto é o último do arquivo — o caso normal do import mensal — sobra
 * "só o último mês", que é como a pessoa pensa nele.
 */
export function opcoesDeEscopo(
  fechadas: string[],
  travados: Iterable<string>,
): { opcoes: OpcaoEscopo[]; padrao: EscopoImport } {
  if (!fechadas.length) return { opcoes: [], padrao: "todos" };

  const ultimo = colunasDoEscopo(fechadas, travados, "ultimo");
  const abertos = colunasDoEscopo(fechadas, travados, "abertos");
  const todos = colunasDoEscopo(fechadas, travados, "todos");
  const mesmo = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

  const opcoes: OpcaoEscopo[] = [];
  if (abertos.length && !mesmo(abertos, ultimo) && !mesmo(abertos, todos)) {
    opcoes.push({
      escopo: "abertos",
      titulo: "Só os meses ainda em aberto",
      descricao: `Grava ${resumoMeses(abertos)} — o que fechou desde o último import. Nenhum mês já travado é reescrito.`,
      meses: abertos,
    });
  }
  if (!mesmo(ultimo, todos)) {
    opcoes.push({
      escopo: "ultimo",
      titulo: "Só o último mês do arquivo",
      descricao: `Grava e trava ${resumoMeses(ultimo)}. O resto da planilha é lido, mas não entra.`,
      meses: ultimo,
    });
  }
  opcoes.push({
    escopo: "todos",
    titulo: "Todos os meses do arquivo",
    descricao: `Reescreve e re-trava ${resumoMeses(todos)}${
      todos.length > 1 ? ", inclusive os meses já fechados" : ""
    }. Use quando corrigiu o histórico na planilha.`,
    meses: todos,
  });

  // Padrão: o mais conservador que ainda grava alguma coisa.
  const padrao = opcoes.find((o) => o.escopo === "abertos")?.escopo
    ?? opcoes.find((o) => o.escopo === "ultimo")?.escopo
    ?? "todos";
  return { opcoes, padrao };
}

/**
 * O corpo do POST para `demonstracoes-import`, já recortado no escopo escolhido —
 * cada demonstrativo leva só os meses que ele tem fechados E que o escopo aprovou.
 */
export function corpoDoImport(
  t: TrackerLido,
  meses: string[],
): {
  body: { dre?: { columns: string[]; rows: LinhaTracker[] }; dfc?: { columns: string[]; rows: LinhaTracker[] } };
  meses: string[];
  dreColunas: string[];
  dfcColunas: string[];
} {
  const alvo = new Set(meses);
  const dreColunas = t.dreFechadas.filter((c) => alvo.has(c));
  const dfcColunas = t.dfcFechadas.filter((c) => alvo.has(c));
  return {
    body: {
      dre: dreColunas.length ? { columns: ["Conta", ...dreColunas], rows: t.dreRows } : undefined,
      dfc: t.dfcRows.length && dfcColunas.length ? { columns: ["Conta", ...dfcColunas], rows: t.dfcRows } : undefined,
    },
    meses: t.fechadas.filter((c) => dreColunas.includes(c) || dfcColunas.includes(c)),
    dreColunas,
    dfcColunas,
  };
}
