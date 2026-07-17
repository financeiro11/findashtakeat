import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot } from "./components";
import {
  db, fmtBRL, fmtData, FORMA_PAGAMENTO_LABEL, MESES_PT,
  type Compra,
} from "./lib";

type Filtro = { key: string; label: string };

export default function Historico() {
  const [loading, setLoading] = useState(true);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [filtro, setFiltro] = useState<string>("todas");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await db.from("facilities_compras").select("*").order("data", { ascending: false });
    setCompras((data as Compra[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtros: Filtro[] = useMemo(() => {
    const meses = new Map<string, string>();
    for (const c of compras) {
      const d = new Date(c.data + "T00:00:00");
      const key = `mes:${d.getFullYear()}-${d.getMonth()}`;
      meses.set(key, `${MESES_PT[d.getMonth()]}`);
    }
    const mesFiltros = [...meses.entries()].slice(0, 3).map(([key, label]) => ({ key, label }));
    return [{ key: "todas", label: "Todas" }, ...mesFiltros, { key: "sem_nf", label: "Sem NF" }];
  }, [compras]);

  const filtradas = useMemo(() => {
    if (filtro === "todas") return compras;
    if (filtro === "sem_nf") return compras.filter((c) => c.nf_status !== "ok");
    if (filtro.startsWith("mes:")) {
      const [y, m] = filtro.slice(4).split("-").map(Number);
      return compras.filter((c) => {
        const d = new Date(c.data + "T00:00:00");
        return d.getFullYear() === y && d.getMonth() === m;
      });
    }
    return compras;
  }, [compras, filtro]);

  const total = filtradas.reduce((s, c) => s + Number(c.valor || 0), 0);

  const toggleNf = async (c: Compra) => {
    const novo = c.nf_status === "ok" ? "pendente" : "ok";
    const { error } = await db.from("facilities_compras").update({ nf_status: novo }).eq("id", c.id);
    if (error) return toast.error(error.message);
    setCompras((prev) => prev.map((x) => x.id === c.id ? { ...x, nf_status: novo } : x));
  };

  return (
    <div className="space-y-4 p-5">
      <FacToolbar context="Compras realizadas" onChanged={load} />

      <div className="card-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">Compras realizadas</h3>
            <p className="text-[12px] text-muted-foreground">
              <span className="num">{filtradas.length}</span> compra(s) · <span className="num">{fmtBRL(total)}</span> no total
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filtros.map((f) => (
              <button
                key={f.key}
                onClick={() => setFiltro(f.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                  filtro === f.key ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <Skeleton className="m-4 h-64 rounded" />
        ) : filtradas.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-muted-foreground">Nenhuma compra registrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Data</th>
                  <th className="px-4 py-2.5 font-semibold">Item</th>
                  <th className="px-4 py-2.5 font-semibold">Fornecedor</th>
                  <th className="px-4 py-2.5 font-semibold">Pagamento</th>
                  <th className="px-4 py-2.5 font-semibold">NF</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                    <td className="num px-5 py-2.5 text-[12.5px] text-muted-foreground">{fmtData(c.data)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <CatDot cat={c.categoria} />
                        <span className="text-[13px] text-foreground">{c.item}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground">{c.fornecedor_nome || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-foreground">
                        {c.forma_pagamento ? FORMA_PAGAMENTO_LABEL[c.forma_pagamento] : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => toggleNf(c)}
                        className={cn(
                          "inline-flex items-center gap-1 text-[12px]",
                          c.nf_status === "ok" ? "text-emerald-600" : "text-amber-600",
                        )}
                        title="Clique para alternar"
                      >
                        {c.nf_status === "ok" ? <><Check className="h-3.5 w-3.5" /> NF</> : "pendente"}
                      </button>
                    </td>
                    <td className="num px-5 py-2.5 text-right text-[13px] font-semibold text-foreground">{fmtBRL(c.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
