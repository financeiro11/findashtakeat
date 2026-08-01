import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import {
  valorDoNo, valorBruto, variacao, rotulosDeDespesa, MES_PT,
  type Node, type Coluna, type LinhaBase,
} from "@/lib/demonstracoes-schema";

/* ============================================================================
 * Tabela da DRE / DFC no Histórico Multianual.
 *
 * Dois modos: comparativo anual (2024 · 2025 · Δ · 2026 YTD · Δ) e mês a mês
 * (12 meses + total). Sobre eles: R$ ou % da receita, mês ou acumulado, e o
 * heatmap — que é uma escala divergente em torno do zero (verde acima,
 * vermelho abaixo), com intensidade pelo peso da célula na própria linha.
 * ========================================================================== */

export type ModoTabela = "anual" | "mensal";
export type Unidade = "reais" | "pct";

type Props = {
  schema: Node[];
  rows: LinhaBase[];
  idx: Map<string, LinhaBase>;
  colunas: Coluna[];          // só meses com dado fechado
  anos: number[];
  anoParcial: number | null;  // ano ainda em curso (YTD)
  mesesDoParcial: number;     // até que mês o parcial tem dado
  modo: ModoTabela;
  anoSel: number;
  unidade: Unidade;
  acumulado: boolean;
  heatmap: boolean;
  expandirTudo: boolean;
  rotuloReceita: string;      // base do "% da receita"
};

const fmtNum = (n: number) =>
  n < 0 ? `(${Math.round(Math.abs(n)).toLocaleString("pt-BR")})` : Math.round(n).toLocaleString("pt-BR");
const fmtPct = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;
const fmtPP = (n: number) => `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(1).replace(".", ",")} pp`;

/** Verde acima de zero, vermelho abaixo; intensidade pelo peso na linha. */
function corHeatmap(v: number, maxAbs: number): string | undefined {
  if (!v || !maxAbs) return undefined;
  const t = Math.min(1, Math.abs(v) / maxAbs);
  const a = 0.08 + t * 0.32;
  return v > 0 ? `rgba(16,163,110,${a})` : `rgba(214,26,26,${a})`;
}

export default function TabelaDemonstracao({
  schema, rows, idx, colunas, anos, anoParcial, mesesDoParcial,
  modo, anoSel, unidade, acumulado, heatmap, expandirTudo, rotuloReceita,
}: Props) {
  const despesas = useMemo(() => rotulosDeDespesa(schema), [schema]);

  /* ------------------------- abrir / fechar ------------------------- */
  const comFilhos = useMemo(() => {
    const s = new Set<string>();
    const walk = (ns: Node[]) => ns.forEach((n) => { if (n.children?.length) { s.add(n.label); walk(n.children); } });
    walk(schema);
    return s;
  }, [schema]);
  // Começa com os blocos de topo abertos e o resto fechado — é o que a tela mostra.
  const [fechados, setFechados] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const walk = (ns: Node[], nivel: number) => ns.forEach((n) => {
      if (n.children?.length) { if (nivel > 0) s.add(n.label); walk(n.children, nivel + 1); }
    });
    walk(schema, 0);
    return s;
  });
  useEffect(() => {
    setFechados(expandirTudo ? new Set() : new Set(comFilhos));
  }, [expandirTudo, comFilhos]);
  const alternar = (label: string) =>
    setFechados((p) => {
      const n = new Set(p);
      if (n.has(label)) n.delete(label); else n.add(label);
      return n;
    });

  /* --------------------------- linhas visíveis --------------------------- */
  const visiveis = useMemo(() => {
    const out: { node: Node; depth: number }[] = [];
    const walk = (ns: Node[], depth: number) => {
      for (const n of ns) {
        out.push({ node: n, depth });
        if (n.children?.length && !fechados.has(n.label)) walk(n.children, depth + 1);
      }
    };
    walk(schema, 0);
    return out;
  }, [schema, fechados]);

  /* ----------------------------- colunas ----------------------------- */
  const colsDoAno = useCallback((ano: number) => colunas.filter((c) => c.ano === ano), [colunas]);

  type ColunaVista =
    | { tipo: "valor"; chave: string; titulo: string; cols: Coluna[]; parcial?: boolean }
    | { tipo: "delta"; chave: string; titulo: string; de: Coluna[]; para: Coluna[] };

  const colunasVista: ColunaVista[] = useMemo(() => {
    if (modo === "mensal") {
      const doAno = colsDoAno(anoSel);
      const meses: ColunaVista[] = doAno.map((c, i) => ({
        tipo: "valor", chave: c.col, titulo: MES_PT[c.mes - 1].toUpperCase(),
        cols: acumulado ? doAno.slice(0, i + 1) : [c],
      }));
      return [...meses, { tipo: "valor", chave: "__total", titulo: "TOTAL", cols: doAno }];
    }
    const fechados_ = anos.filter((a) => a !== anoParcial);
    const out: ColunaVista[] = [];
    fechados_.forEach((a, i) => {
      out.push({ tipo: "valor", chave: String(a), titulo: String(a), cols: colsDoAno(a) });
      if (i > 0) {
        out.push({
          tipo: "delta", chave: `d${a}`, titulo: `Δ ${String(a).slice(2)}/${String(fechados_[i - 1]).slice(2)}`,
          de: colsDoAno(fechados_[i - 1]), para: colsDoAno(a),
        });
      }
    });
    if (anoParcial) {
      const ytd = colsDoAno(anoParcial);
      const anteriorYtd = colsDoAno(anoParcial - 1).filter((c) => c.mes <= mesesDoParcial);
      out.push({ tipo: "valor", chave: String(anoParcial), titulo: `${anoParcial} YTD`, cols: ytd, parcial: true });
      out.push({
        tipo: "delta", chave: "dytd", titulo: `Δ VS ${String(anoParcial - 1).slice(2)} YTD`,
        de: anteriorYtd, para: ytd,
      });
    }
    return out;
  }, [modo, anoSel, anos, anoParcial, mesesDoParcial, acumulado, colsDoAno]);

  /* ----------------------------- cálculo ----------------------------- */
  const soma = (node: Node, cols: Coluna[]) => cols.reduce((s, c) => s + valorDoNo(idx, node, c.col), 0);
  const somaRotulo = (label: string, cols: Coluna[]) => cols.reduce((s, c) => s + valorBruto(idx, label, c.col), 0);

  /** Valor exibido: percentual recalculado (nunca somado), % da receita ou R$. */
  const valorExibido = (node: Node, cols: Coluna[]): number | null => {
    if (!cols.length) return null;
    if (node.kind === "percent") {
      // O numerador vem do `src` do esquema: "% Margem EBITDA" não existe na
      // base — a linha se chama "EBITDA". Deduzir tirando o "%" dava sempre 0%.
      const base = somaRotulo(node.pctOf ?? rotuloReceita, cols);
      const alvo = somaRotulo(node.src ?? node.label.replace(/^%\s*/, ""), cols);
      return base ? alvo / base : null;
    }
    const v = soma(node, cols);
    if (unidade === "pct") {
      const base = somaRotulo(rotuloReceita, cols);
      return base ? v / Math.abs(base) : null;
    }
    return v;
  };

  const ehPercentual = (node: Node) => node.kind === "percent" || unidade === "pct";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border bg-secondary/40">
            <th className="sticky left-0 z-10 min-w-[230px] bg-secondary/40 px-3 py-2 text-left text-[10px] font-bold tracking-wider text-muted-foreground">
              RUBRICA
            </th>
            {colunasVista.map((c) => (
              <th key={c.chave} className={cn(
                "whitespace-nowrap px-3 py-2 text-right text-[10px] font-bold tracking-wider text-muted-foreground",
                c.tipo === "delta" && "bg-secondary/60",
              )}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visiveis.map(({ node, depth }) => {
            const temFilhos = !!node.children?.length;
            const aberto = temFilhos && !fechados.has(node.label);
            const pct = ehPercentual(node);
            const ehDespesa = despesas.has(node.label);

            // escala do heatmap: peso da célula dentro da própria linha
            const valores = colunasVista
              .filter((c): c is Extract<ColunaVista, { tipo: "valor" }> => c.tipo === "valor")
              .map((c) => valorExibido(node, c.cols) ?? 0);
            const maxAbs = Math.max(...valores.map(Math.abs), 0);

            return (
              <tr key={node.label} className={cn(
                "border-b border-border/50",
                node.kind === "header" && "font-semibold",
                node.kind === "total" && "bg-secondary/30 font-semibold",
                node.kind === "percent" && "text-muted-foreground",
              )}>
                <th className={cn(
                  "sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-normal",
                  node.kind === "total" && "bg-secondary/30 font-semibold",
                  node.kind === "header" && "font-semibold",
                )}>
                  <div className="flex items-center gap-1" style={{ paddingLeft: depth * 14 }}>
                    {temFilhos ? (
                      <button onClick={() => alternar(node.label)} className="shrink-0 text-muted-foreground transition hover:text-foreground" title={aberto ? "Recolher" : "Expandir"}>
                        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", aberto && "rotate-90")} />
                      </button>
                    ) : <span className="w-3.5 shrink-0" />}
                    <span className={cn("truncate", node.kind === "percent" && "text-[11.5px]")}>{node.label}</span>
                  </div>
                </th>

                {colunasVista.map((c) => {
                  if (c.tipo === "delta") {
                    const de = valorExibido(node, c.de);
                    const para = valorExibido(node, c.para);
                    const v = de == null || para == null ? null
                      : variacao(de, para, { despesa: ehDespesa, percentual: node.kind === "percent" });
                    return (
                      <td key={c.chave} className="whitespace-nowrap bg-secondary/20 px-3 py-1.5 text-right">
                        {v == null ? <span className="text-muted-foreground">–</span> : (
                          <span className={cn("num font-medium", v.bom ? "text-success" : "text-destructive")}>
                            {v.sobe ? "↑" : "↓"} {node.kind === "percent" ? fmtPP(Math.abs(v.pp ?? 0)) : `${Math.abs(Math.round(v.pct * 100))}%`}
                          </span>
                        )}
                      </td>
                    );
                  }
                  const v = valorExibido(node, c.cols);
                  const vazio = v == null || (v === 0 && node.kind !== "total");
                  return (
                    <td
                      key={c.chave}
                      className={cn("num whitespace-nowrap px-3 py-1.5 text-right tabular-nums", v != null && v < 0 && "text-destructive")}
                      style={heatmap ? { background: corHeatmap(v ?? 0, maxAbs) } : undefined}
                    >
                      {vazio ? <span className="text-muted-foreground">–</span> : pct ? fmtPct(v as number) : fmtNum(v as number)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
