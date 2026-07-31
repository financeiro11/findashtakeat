/* ============================================================================
 * Árvore de Automações — dados, geometria e cálculo do desenho.
 *
 * Fica separado do componente de propósito: é a parte que erra em silêncio
 * (posição sobreposta, banda fantasma, corrente que não fecha) e a que dá para
 * testar sem montar o React. Ver ArvoreAutomacoes.test.ts.
 * ========================================================================== */

export type Automacao = {
  id: string;
  automacao: string;
  categoria: string | null;
  nivel: number | null;
  status: string;
  horas_mes: number | null;
  ferramentas: string | null;
  responsavel: string | null;
  impacto: string | null;
  depende_de?: string | null;
  ordem: number;
};

/* -------------------------------- cores --------------------------------
 * O canvas é escuro nos dois temas de propósito (é uma superfície de "jogo",
 * como a pirâmide já faz com NIVEL_COR). Por isso as cores são literais: elas
 * não seguem o tema claro/escuro do app. */
export const CANVAS_BG = "#0b0d12";
export const CANVAS_GRID = "rgba(148,163,184,.055)";

const CAT_COR: Record<string, string> = {
  "IA & Categorização": "#f43f5e",
  "Pagamentos & Cobrança": "#8b5cf6",
  "Notas Fiscais": "#38bdf8",
  "Reportes & DRE": "#10b981",
  "Conciliação": "#f59e0b",
  "Comunicação Interna": "#fb923c",
  "Fechamento Mensal": "#2dd4bf",
  "Editais": "#818cf8",
  "Dashboard": "#ec4899",
  "Reembolsos": "#a3e635",
};
const CAT_FALLBACK = ["#f43f5e", "#8b5cf6", "#38bdf8", "#10b981", "#f59e0b", "#fb923c", "#2dd4bf", "#818cf8", "#ec4899", "#a3e635"];

export function corTrilha(nome: string): string {
  if (CAT_COR[nome]) return CAT_COR[nome];
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return CAT_FALLBACK[h % CAT_FALLBACK.length];
}

/* ---------------------------- status do nó ---------------------------- */
export type Tier = "on" | "wip" | "todo";
const STATUS_TIER: Record<string, Tier> = {
  "Rodando": "on",
  "Em teste": "wip",
  "Em andamento": "wip",
  "A fazer": "todo",
  "Ideias": "todo",
};
export const tierDe = (s: string): Tier => STATUS_TIER[s] ?? "todo";
export const TIER_META: Record<Tier, { cor: string; label: string }> = {
  on: { cor: "#34d399", label: "Rodando" },
  wip: { cor: "#fbbf24", label: "Em teste / andamento" },
  todo: { cor: "#64748b", label: "Ideia / a fazer" },
};

/* bandas de nível, da base para o topo (0 = ainda sem nível definido) */
export const BANDAS = [
  { k: 1, label: "N1 · FUNDAÇÃO" },
  { k: 2, label: "N2 · CONTROLES" },
  { k: 3, label: "N3 · FP&A" },
  { k: 4, label: "N4 · PROJEÇÃO" },
  { k: 5, label: "N5 · AUTONOMIA" },
  { k: 0, label: "SEM NÍVEL AINDA" },
];

/* ----------------------------- geometria ----------------------------- */
export const COL_W = 196;   // largura da trilha
export const ROW_H = 104;   // altura de uma linha de nós
export const DX = 44;       // deslocamento do nó em relação ao tronco
export const PAD_X = 120;   // respiro lateral (rótulos das bandas moram aqui)
const PAD_TOP = 70;
const HUB_H = 150;          // espaço do hub abaixo da última linha

export type NoPos = { r: Automacao; x: number; y: number; trilha: string; cor: string; tier: Tier; banda: number };

const ordemTier: Record<Tier, number> = { on: 0, wip: 1, todo: 2 };
export const horasDe = (r: Automacao) => Number(r.horas_mes) || 0;

/** Posiciona cada automação em trilha (X) × banda de nível (Y), com o hub embaixo. */
export function montarLayout(rows: Automacao[]) {
  const trilhas = Array.from(new Set(rows.map((r) => r.categoria || "Sem categoria"))).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const bandaDe = (r: Automacao) => (r.nivel && r.nivel >= 1 && r.nivel <= 5 ? r.nivel : 0);

  // Só entram as bandas que têm alguma automação — evita canvas vazio.
  const bandasPresentes = BANDAS.filter((b) => rows.some((r) => bandaDe(r) === b.k));

  // Altura de cada banda = maior "pilha" de uma trilha dentro dela (nós em ziguezague, 2 por linha).
  const linhasPorBanda = bandasPresentes.map((b) => {
    const maxNaBanda = Math.max(
      1,
      ...trilhas.map((t) => rows.filter((r) => (r.categoria || "Sem categoria") === t && bandaDe(r) === b.k).length),
    );
    return Math.ceil(maxNaBanda / 2);
  });

  const totalLinhas = linhasPorBanda.reduce((a, c) => a + c, 0);
  const W = PAD_X * 2 + Math.max(1, trilhas.length) * COL_W;
  const H = PAD_TOP + totalLinhas * ROW_H + HUB_H;
  const hubY = H - HUB_H / 2;
  const hubX = W / 2;

  // y da 1ª linha de cada banda, contando de baixo para cima
  const inicioBanda: number[] = [];
  let acc = 0;
  bandasPresentes.forEach((_, i) => { inicioBanda[i] = acc; acc += linhasPorBanda[i]; });
  const yDaLinha = (linhaGlobal: number) => hubY - HUB_H / 2 - 20 - linhaGlobal * ROW_H;

  const nos: NoPos[] = [];
  trilhas.forEach((t, ti) => {
    const colX = PAD_X + ti * COL_W + COL_W / 2;
    bandasPresentes.forEach((b, bi) => {
      const daCelula = rows
        .filter((r) => (r.categoria || "Sem categoria") === t && bandaDe(r) === b.k)
        .sort((a, z) =>
          ordemTier[tierDe(a.status)] - ordemTier[tierDe(z.status)] ||
          (a.automacao || "").localeCompare(z.automacao || "", "pt-BR"),
        );
      daCelula.forEach((r, k) => {
        const linha = inicioBanda[bi] + Math.floor(k / 2);
        // nó sozinho na linha fica centrado no tronco; em par, um de cada lado
        const sozinho = k === daCelula.length - 1 && k % 2 === 0;
        const lado = sozinho ? 0 : k % 2 === 0 ? -1 : 1;
        nos.push({
          r, trilha: t, cor: corTrilha(t), tier: tierDe(r.status), banda: b.k,
          x: colX + lado * DX,
          y: yDaLinha(linha),
        });
      });
    });
  });

  // faixas horizontais das bandas (para o rótulo lateral)
  const faixas = bandasPresentes.map((b, i) => {
    const topo = yDaLinha(inicioBanda[i] + linhasPorBanda[i] - 1) - ROW_H / 2;
    const base = yDaLinha(inicioBanda[i]) + ROW_H / 2;
    return { ...b, topo, base };
  });

  // topo do tronco de cada trilha (até o nó mais alto que ela tem)
  const troncos = trilhas.map((t, ti) => {
    const meus = nos.filter((n) => n.trilha === t);
    const topo = meus.length ? Math.min(...meus.map((n) => n.y)) : hubY - 120;
    return { trilha: t, x: PAD_X + ti * COL_W + COL_W / 2, topo, cor: corTrilha(t) };
  });

  return { trilhas, nos, faixas, troncos, W, H, hubX, hubY };
}

/** Corrente do nó: ele + os pré-requisitos acima dele + tudo que ele destrava abaixo. */
export function correnteDe(rows: Automacao[], sel: string | null): Set<string> | null {
  if (!sel) return null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = new Set<string>([sel]);
  let cur = byId.get(sel);
  while (cur?.depende_de && !ids.has(cur.depende_de)) { ids.add(cur.depende_de); cur = byId.get(cur.depende_de); }
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const r of rows) if (r.depende_de && ids.has(r.depende_de) && !ids.has(r.id)) { ids.add(r.id); mudou = true; }
  }
  return ids;
}

/** Só os descendentes do nó (o que passa a ser possível se ele for concluído). */
export function destravadasPor(rows: Automacao[], sel: string | null): { ids: Set<string>; horas: number } {
  const ids = new Set<string>();
  if (!sel) return { ids, horas: 0 };
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const r of rows) {
      if (!r.depende_de || ids.has(r.id) || r.id === sel) continue;
      if (r.depende_de === sel || ids.has(r.depende_de)) { ids.add(r.id); mudou = true; }
    }
  }
  let horas = 0;
  ids.forEach((id) => { const r = rows.find((x) => x.id === id); if (r) horas += horasDe(r); });
  return { ids, horas };
}
