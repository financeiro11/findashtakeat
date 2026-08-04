import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MESES_CURTO, contabil, exato, pct, soma } from "./format";
import type { LinhaBP, PlanoBP } from "./useBpPlano";

/** Numerador de cada linha de percentual — a planilha só guarda o rótulo. */
const NUMERADOR_PCT: { casa: string; alvo: string }[] = [
  { casa: "margem de contribuicao", alvo: "Margem de contribuição" },
  { casa: "margem ebitda", alvo: "EBITDA" },
  { casa: "margem liquida", alvo: "Lucro Líquido" },
];

export default function PLTab({ plano, ano }: { plano: PlanoBP; ano: number }) {
  const [busca, setBusca] = useState("");
  const [fechados, setFechados] = useState<Set<string>>(new Set());

  const { ultimoRealizado } = plano;

  /** Valor da célula: realizado quando o mês já fechou, senão a projeção do BP. */
  function valorMes(linha: LinhaBP, i: number): { v: number | null; real: boolean } {
    if (linha.tipo === "percent") {
      const regra = NUMERADOR_PCT.find((r) => linha.chave.includes(r.casa));
      const num = regra ? valorMes(virtual(regra.alvo), i) : { v: null, real: false };
      const den = valorMes(virtual("Receita Líquida"), i);
      if (num.v == null || !den.v) return { v: null, real: num.real };
      return { v: num.v / den.v, real: num.real && den.real };
    }
    if (i <= ultimoRealizado) {
      // serieRealizada já normaliza o rótulo (e resolve apelidos entre BP e DRE).
      const real = plano.serieRealizada(linha.texto)[i];
      if (real != null) return { v: real, real: true };
    }
    return { v: linha.meses[i], real: false };
  }

  /** Linha "fantasma" pra reaproveitar valorMes em rubricas referenciadas por rótulo. */
  function virtual(rotulo: string): LinhaBP {
    return (
      plano.buscar("dre", rotulo) ?? {
        id: `virtual-${rotulo}`, texto: rotulo, numero: null, chave: rotulo,
        depth: 0, tipo: "linha", paiId: null, temFilhos: false,
        meses: Array(12).fill(null), total: null,
      }
    );
  }

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q) {
      return plano.dre.filter((l) =>
        `${l.numero ?? ""} ${l.texto}`.toLowerCase().includes(q),
      );
    }
    const ocultos = new Set<string>();
    return plano.dre.filter((l) => {
      if (l.paiId && (fechados.has(l.paiId) || ocultos.has(l.paiId))) {
        ocultos.add(l.id);
        return false;
      }
      return true;
    });
  }, [plano.dre, busca, fechados]);

  const alternar = (id: string) =>
    setFechados((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const paisComFilhos = plano.dre.filter((l) => l.temFilhos).map((l) => l.id);
  const tudoFechado = fechados.size > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar rubrica…"
              className="h-8 w-[220px] pl-7 text-[12px]"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[12px]"
            onClick={() => setFechados(tudoFechado ? new Set() : new Set(paisComFilhos))}
          >
            {tudoFechado ? "Expandir tudo" : "Colapsar tudo"}
          </Button>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-500/25 border border-emerald-500/50" />
            Realizado (DRE)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] border border-border bg-card" />
            Projeção BP
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="sticky left-0 z-20 bg-muted px-3 py-2 text-left text-[10px] font-semibold tracking-[0.08em] text-muted-foreground w-[280px] min-w-[280px] shadow-[1px_0_0_0_hsl(var(--border))]">
                RUBRICA
              </th>
              {MESES_CURTO.map((m, i) => {
                const real = i <= ultimoRealizado;
                return (
                  <th
                    key={m}
                    className={cn(
                      "px-2 py-2 text-right text-[10px] font-semibold tracking-[0.06em] whitespace-nowrap min-w-[82px]",
                      real ? "text-emerald-700" : "text-muted-foreground",
                    )}
                  >
                    {m}
                    <div className="text-[8.5px] font-normal opacity-80">{real ? "REAL" : "PROJ"}</div>
                  </th>
                );
              })}
              <th className="sticky right-0 z-20 bg-muted px-2 py-2 text-right text-[10px] font-semibold tracking-[0.06em] text-muted-foreground whitespace-nowrap min-w-[100px] shadow-[-1px_0_0_0_hsl(var(--border))]">
                Total {ano}
              </th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((linha) => {
              const ehTotal = linha.tipo === "total";
              const ehPct = linha.tipo === "percent";
              const fechado = fechados.has(linha.id);
              const celulas = MESES_CURTO.map((_, i) => valorMes(linha, i));
              const total = ehPct
                ? null
                : soma(celulas.map((c) => c.v));

              return (
                <tr
                  key={linha.id}
                  className={cn(
                    "border-b border-border/60",
                    ehTotal && "bg-emerald-50/40 dark:bg-emerald-500/5 font-semibold",
                    ehPct && "text-muted-foreground italic text-[11.5px]",
                    !ehTotal && !ehPct && "hover:bg-muted/30",
                  )}
                >
                  <td
                    className={cn(
                      "sticky left-0 z-[2] px-3 py-1.5 text-[12.5px] w-[280px] min-w-[280px] shadow-[1px_0_0_0_hsl(var(--border))]",
                      ehTotal ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-card",
                    )}
                    style={{ paddingLeft: 12 + linha.depth * 16 }}
                  >
                    <div className="flex items-center gap-1.5">
                      {linha.temFilhos && !busca ? (
                        <button
                          onClick={() => alternar(linha.id)}
                          className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                          aria-label={fechado ? "Expandir" : "Recolher"}
                        >
                          {fechado ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      ) : (
                        <span className="inline-block w-4" />
                      )}
                      <span
                        className={cn(
                          ehTotal && "text-emerald-800 dark:text-emerald-400",
                          linha.depth > 0 && !ehTotal && "text-foreground/85",
                        )}
                      >
                        {linha.numero ? `${linha.numero} ${linha.texto}` : linha.texto}
                      </span>
                    </div>
                  </td>

                  {celulas.map((c, i) => (
                    <td
                      key={i}
                      title={exato(c.v, ehPct)}
                      className={cn(
                        "px-2 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[82px]",
                        c.v != null && "cursor-help",
                        c.real && "bg-emerald-50/40 dark:bg-emerald-500/[0.07]",
                        c.v == null
                          ? "text-muted-foreground/40"
                          : (c.v ?? 0) < 0 && !ehPct
                            ? "text-primary"
                            : ehTotal
                              ? "text-emerald-800 dark:text-emerald-400"
                              : "text-foreground/90",
                      )}
                    >
                      {ehPct ? pct(c.v) : contabil(c.v)}
                    </td>
                  ))}

                  <td
                    title={exato(total)}
                    className={cn(
                      "sticky right-0 z-[2] px-2 py-1.5 text-right text-[12px] num whitespace-nowrap min-w-[100px] font-semibold shadow-[-1px_0_0_0_hsl(var(--border))]",
                      total != null && "cursor-help",
                      ehTotal ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-card",
                      (total ?? 0) < 0
                        ? "text-primary"
                        : ehTotal
                          ? "text-emerald-800 dark:text-emerald-400"
                          : "text-foreground",
                    )}
                  >
                    {ehPct ? "—" : contabil(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Coluna <span className="font-semibold text-emerald-700">verde</span> = mês fechado nas
        Demonstrações · cinza = projeção do BP. O total do ano mistura realizado e projeção —
        é o forecast corrente, não o plano original.
      </p>
    </div>
  );
}
