import type { AccountNode, BalanceteAccount, BalanceteData } from "./types";

export function fmtBRL(v: number | null | undefined, opts: { compact?: boolean } = {}) {
  if (v == null || isNaN(Number(v))) return "—";
  if (opts.compact) {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")}M`;
    if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(1).replace(".", ",")}k`;
  }
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function pctDelta(curr: number, prev: number | undefined | null) {
  if (prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

export function buildTree(accounts: BalanceteAccount[]): AccountNode[] {
  const byId = new Map<string, AccountNode>();
  accounts.forEach((a) => byId.set(a.id, { ...a, children: [] }));
  const roots: AccountNode[] = [];
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // ordena por code dentro de cada nível
  const sortRec = (arr: AccountNode[]) => {
    arr.sort((a, b) =>
      String(a.code).localeCompare(String(b.code), "pt-BR", { numeric: true }),
    );
    arr.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export function flattenVisible(
  nodes: AccountNode[],
  expanded: Set<string>,
): AccountNode[] {
  const out: AccountNode[] = [];
  const walk = (arr: AccountNode[]) => {
    arr.forEach((n) => {
      out.push(n);
      if (n.children.length && expanded.has(n.id)) walk(n.children);
    });
  };
  walk(nodes);
  return out;
}

export function previousPeriodo(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Trimestre anterior a partir de um período "qTyy" (ex.: "1T26" → "4T25"). */
export function previousPeriodoTrimestre(periodo: string): string {
  const m = periodo.match(/^(\d)T(\d{2})$/);
  if (!m) return periodo;
  let q = Number(m[1]) - 1;
  let y = 2000 + Number(m[2]);
  if (q < 1) { q = 4; y -= 1; }
  return `${q}T${String(y).slice(-2)}`;
}

/** Chave numérica pra ordenar cronologicamente períodos "qTyy" (que NÃO são
 * ordenáveis como string — "1T26" vem antes de "4T25" alfabeticamente, mas depois
 * cronologicamente). */
export function sortKeyTrimestre(periodo: string): number {
  const m = periodo.match(/^(\d)T(\d{2})$/);
  if (!m) return -1;
  return (2000 + Number(m[2])) * 4 + Number(m[1]);
}

export function isV2(d: any): d is BalanceteData {
  return d && d.version === 2 && Array.isArray(d.accounts);
}

export function indexByCode(accounts: BalanceteAccount[]) {
  const map = new Map<string, BalanceteAccount>();
  accounts.forEach((a) => map.set(a.code, a));
  return map;
}
