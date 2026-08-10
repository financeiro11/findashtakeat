/**
 * O detalhe dos lançamentos — onde a matriz para de bastar.
 *
 * Duas perguntas vivem aqui: "de onde saiu esse número?" (por isso o valor vem
 * cheio, não em milhares) e "a skill leu isso direito?" (por isso a descrição
 * ORIGINAL do OFX fica visível ao lado do nome normalizado — é como se percebe
 * que "EBN*CAPCUT ... 12/24" virou CapCut quando devia ser outra coisa).
 *
 * A aba de créditos existe separada porque pagamento de fatura e estorno não são
 * gasto: somá-los na matriz zeraria o mês.
 */

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lancamento, Mes } from "./analise";
import { fmtBRLStr } from "./fmt";
import { fmtBRL } from "./valores";

const TODOS = "__todos__";

function dataBR(d: string | null): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : d;
}

/** De onde a tela pediu para abrir já filtrado. `pedidoEm` é o carimbo do clique. */
export type FocoDetalhe = { estabelecimento: string; competencia: string; pedidoEm: number };

export function Detalhe({
  lancamentos, meses, foco,
}: {
  lancamentos: Lancamento[];
  meses: Mes[];
  /** Um clique em "Lançamentos" numa recomendação chega aqui. */
  foco?: FocoDetalhe | null;
}) {
  const [mes, setMes] = useState<string>(TODOS);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<"gasto" | "credito">("gasto");

  /* O foco SEMEIA os filtros; não os prende. Depois de chegar aqui a pessoa
     apaga a busca, troca o mês, faz o que quiser — e um novo clique lá em cima
     volta a semear, porque `pedidoEm` muda mesmo quando é o mesmo
     estabelecimento (é o caso de voltar para conferir a mesma linha). */
  useEffect(() => {
    if (!foco) return;
    setAba("gasto");
    setBusca(foco.estabelecimento);
    setMes(meses.some((m) => m.competencia === foco.competencia) ? foco.competencia : TODOS);
  }, [foco, meses]);

  const rotuloMes = useMemo(
    () => new Map(meses.map((m) => [m.competencia, m.label])),
    [meses],
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lancamentos
      .filter((l) => (aba === "gasto" ? l.tipo === "gasto" : l.tipo !== "gasto"))
      .filter((l) => mes === TODOS || l.competencia === mes)
      .filter(
        (l) =>
          !q ||
          l.estabelecimento.toLowerCase().includes(q) ||
          l.categoria.toLowerCase().includes(q) ||
          (l.descricao ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? "") || b.valor - a.valor);
  }, [lancamentos, aba, mes, busca]);

  const total = filtrados.reduce((s, l) => s + l.valor, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="flex rounded-md border border-border bg-card p-0.5">
          {([["gasto", "Gastos"], ["credito", "Créditos e pagamentos"]] as const).map(([v, rot]) => (
            <button
              key={v}
              onClick={() => setAba(v)}
              className={cn(
                "rounded px-2.5 py-1 text-[12px] font-medium transition",
                aba === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {rot}
            </button>
          ))}
        </div>

        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="h-8 w-[150px] text-[12.5px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as faturas</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m.competencia} value={m.competencia}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar estabelecimento, categoria ou descrição do OFX…"
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>

        <div className="ml-auto whitespace-nowrap text-[12px] text-muted-foreground">
          {filtrados.length} {filtrados.length === 1 ? "lançamento" : "lançamentos"} ·{" "}
          <span className="num font-semibold text-foreground" title={fmtBRLStr(total)}>{fmtBRLStr(total)}</span>
        </div>
      </div>

      <div className="max-h-[560px] overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5 text-left font-semibold">Data</th>
              <th className="px-3 py-2.5 text-left font-semibold">Fatura</th>
              <th className="px-3 py-2.5 text-left font-semibold">Estabelecimento</th>
              <th className="px-3 py-2.5 text-left font-semibold">Categoria</th>
              <th className="px-3 py-2.5 text-left font-semibold">Descrição no OFX</th>
              <th className="px-3 py-2.5 text-left font-semibold">Parc.</th>
              <th className="px-3 py-2.5 text-left font-semibold">Cidade</th>
              <th className="px-3 py-2.5 text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((l) => (
              <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="num whitespace-nowrap px-3 py-2 text-[12px] text-muted-foreground">{dataBR(l.data)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-[12px] text-muted-foreground">
                  {rotuloMes.get(l.competencia) ?? l.competencia}
                </td>
                <td className="px-3 py-2 text-[12.5px] font-medium">{l.estabelecimento}</td>
                <td className="px-3 py-2 text-[12px] text-muted-foreground">{l.categoria}</td>
                <td className="max-w-[280px] truncate px-3 py-2 font-mono text-[11px] text-muted-foreground/80" title={l.descricao ?? ""}>
                  {l.descricao ?? "—"}
                </td>
                <td className="num whitespace-nowrap px-3 py-2 text-[11.5px] text-muted-foreground">{l.parcela ?? "—"}</td>
                <td className="px-3 py-2 text-[11.5px] text-muted-foreground">{l.cidade ?? "—"}</td>
                <td
                  className={cn(
                    "num whitespace-nowrap px-3 py-2 text-right text-[12.5px] font-semibold",
                    l.tipo !== "gasto" && "text-pos",
                  )}
                >
                  {l.tipo !== "gasto" && "+"}
                  {fmtBRL(l.valor)}
                </td>
              </tr>
            ))}
            {!filtrados.length && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-[12.5px] text-muted-foreground">
                  Nenhum lançamento com esse filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
