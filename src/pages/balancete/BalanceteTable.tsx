import { useMemo, useState } from "react";
import { ChevronRight, Search, DollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Delta } from "@/components/ui/delta";
import { buildTree, fmtBRL, flattenVisible, indexByCode, pctDelta } from "./utils";
import type { BalanceteAccount, BalanceteGroup } from "./types";

const GROUPS: { key: BalanceteGroup | "all"; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "ativo", label: "Ativo" },
  { key: "passivo", label: "Passivo" },
  { key: "pl", label: "Patrim. Líquido" },
  { key: "receita", label: "Receitas" },
  { key: "despesa", label: "Despesas" },
];

// Cor do "dot" de cada grupo no nível 1 (raiz da árvore) — mesma paleta usada nos
// gráficos abaixo, para o olho associar rapidamente a cor à seção.
const GROUP_DOT: Record<BalanceteGroup, string> = {
  ativo: "#3b82f6",
  passivo: "#f59e0b",
  pl: "#8b5cf6",
  receita: "#22c55e",
  despesa: "#f43f5e",
  resultado: "#64748b",
};

interface Props {
  accounts: BalanceteAccount[];
  prevAccounts: BalanceteAccount[];
  /** Rótulo da coluna de comparação, ex.: "Mês ant." (Balancete) ou "Trim. ant." (Balanço). */
  prevColLabel?: string;
}

const TH = "text-right"; // aplica junto com "eyebrow" (uppercase, 10.5px, semibold)

export function BalanceteTable({ accounts, prevAccounts, prevColLabel = "Mês ant." }: Props) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<BalanceteGroup | "all">("all");
  const [compact, setCompact] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // expandir 2 primeiros níveis por padrão
    return new Set(accounts.filter((a) => a.level <= 1).map((a) => a.id));
  });

  const prevByCode = useMemo(() => indexByCode(prevAccounts), [prevAccounts]);

  const filtered = useMemo(() => {
    let arr = accounts;
    if (group !== "all") arr = arr.filter((a) => a.group === group);
    if (search.trim()) {
      const q = search.toLowerCase();
      const matches = new Set<string>();
      arr.forEach((a) => {
        if (
          a.name.toLowerCase().includes(q) ||
          String(a.code).toLowerCase().includes(q)
        ) {
          matches.add(a.id);
          // incluir ancestrais
          let p = a.parent_id;
          while (p) {
            matches.add(p);
            const parent = arr.find((x) => x.id === p);
            p = parent?.parent_id ?? null;
          }
        }
      });
      arr = arr.filter((a) => matches.has(a.id));
    }
    return arr;
  }, [accounts, group, search]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);

  // se busca ativa, expandir tudo
  const effectiveExpanded = useMemo(() => {
    if (search.trim()) return new Set(filtered.map((a) => a.id));
    return expanded;
  }, [search, filtered, expanded]);

  const visible = useMemo(() => flattenVisible(tree, effectiveExpanded), [tree, effectiveExpanded]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(accounts.map((a) => a.id)));
  const collapseAll = () => setExpanded(new Set());

  const fmt = (v: number) => fmtBRL(v, { compact });

  return (
    <div className="card-surface flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conta ou código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {GROUPS.map((g) => (
            <Button
              key={g.key}
              size="sm"
              variant={group === g.key ? "default" : "outline"}
              onClick={() => setGroup(g.key)}
              className="h-8"
            >
              {g.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCompact((c) => !c)}
            className={cn("h-8 gap-1.5", compact && "bg-accent")}
            title={compact ? "Mostrar valores completos" : "Mostrar valores compactos (M/k)"}
          >
            <DollarSign className="h-3.5 w-3.5" /> Valores compactos
          </Button>
          <Button size="sm" variant="ghost" onClick={expandAll}>Expandir</Button>
          <Button size="sm" variant="ghost" onClick={collapseAll}>Recolher</Button>
        </div>
      </div>

      <div className="overflow-auto max-h-[640px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="eyebrow min-w-[320px]">Conta</TableHead>
              <TableHead className={cn("eyebrow", TH)}>Saldo ant.</TableHead>
              <TableHead className={cn("eyebrow", TH)}>Débito</TableHead>
              <TableHead className={cn("eyebrow", TH)}>Crédito</TableHead>
              <TableHead className={cn("eyebrow", TH)}>Saldo atual</TableHead>
              <TableHead className={cn("eyebrow", TH)}>{prevColLabel}</TableHead>
              <TableHead className={cn("eyebrow", TH)}>Δ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">
                  Nenhuma conta encontrada.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((node) => {
                const hasChildren = node.children.length > 0;
                const isOpen = effectiveExpanded.has(node.id);
                const prev = prevByCode.get(node.code);
                const delta = pctDelta(node.saldo_atual, prev?.saldo_atual);
                return (
                  <TableRow
                    key={node.id}
                    className={cn(
                      node.is_total && "bg-muted/40 font-semibold",
                      node.level === 1 && "bg-muted/60 font-semibold",
                    )}
                  >
                    <TableCell>
                      <div
                        className="flex items-center gap-1.5"
                        style={{ paddingLeft: `${(node.level - 1) * 16}px` }}
                      >
                        {hasChildren ? (
                          <button
                            onClick={() => toggle(node.id)}
                            className="h-5 w-5 flex items-center justify-center rounded hover:bg-accent shrink-0"
                          >
                            <ChevronRight
                              className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")}
                            />
                          </button>
                        ) : (
                          <span className="h-5 w-5 shrink-0" />
                        )}
                        {node.level === 1 && (
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: GROUP_DOT[node.group] }} />
                        )}
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-16">
                          {node.code}
                        </span>
                        <span className="text-sm">{node.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right num text-xs text-muted-foreground">
                      {fmt(node.saldo_anterior)}
                    </TableCell>
                    <TableCell className="text-right num text-xs text-muted-foreground">
                      {fmt(node.debito)}
                    </TableCell>
                    <TableCell className="text-right num text-xs text-muted-foreground">
                      {fmt(node.credito)}
                    </TableCell>
                    <TableCell className="text-right num text-sm text-foreground">
                      {fmt(node.saldo_atual)}
                    </TableCell>
                    <TableCell className="text-right num text-xs text-muted-foreground">
                      {prev ? fmt(prev.saldo_atual) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {delta != null ? <Delta value={delta} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
        <span>
          {visible.length} conta{visible.length === 1 ? "" : "s"} visíve{visible.length === 1 ? "l" : "is"}
          {compact ? " · valores em escala compacta (M/k)" : " · valores completos"}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-pos" /> alta
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-neg" /> queda vs {prevColLabel.toLowerCase()}
          </span>
        </span>
      </div>
    </div>
  );
}
