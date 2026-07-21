import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LayoutGrid, Link2, List, Paperclip, StickyNote } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FacToolbar } from "./NovaSolicitacaoDialog";
import { CatDot } from "./components";
import { CotacaoEvidenciaDialog } from "./CotacaoEvidenciaDialog";
import {
  db, fmtBRL, STATUS_LABEL,
  type Solicitacao, type Cotacao,
} from "./lib";

interface Linha {
  solic: Solicitacao;
  cots: Cotacao[];
  economia: number;
  melhor: number;
}

export default function Cotacoes() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"cards" | "lista">("lista");
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);
  const [editing, setEditing] = useState<{ cot: Cotacao; titulo: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, q] = await Promise.all([
      db.from("facilities_solicitacoes").select("*").order("created_at", { ascending: false }),
      db.from("facilities_cotacoes").select("*").order("valor", { ascending: true }),
    ]);
    setSolicitacoes((s.data as Solicitacao[]) ?? []);
    setCotacoes((q.data as Cotacao[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const linhas: Linha[] = useMemo(() => {
    const byS = new Map<string, Cotacao[]>();
    for (const q of cotacoes) {
      const arr = byS.get(q.solicitacao_id) ?? [];
      arr.push(q);
      byS.set(q.solicitacao_id, arr);
    }
    return solicitacoes
      .filter((s) => byS.has(s.id))
      .map((s) => {
        const cots = (byS.get(s.id) ?? []).slice().sort((a, b) => Number(a.valor) - Number(b.valor));
        const vals = cots.map((c) => Number(c.valor));
        const melhor = Math.min(...vals);
        const economia = vals.length >= 2 ? vals[1] - vals[0] : 0;
        return { solic: s, cots, economia, melhor };
      });
  }, [solicitacoes, cotacoes]);

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[18px] font-semibold text-foreground">Cotações e evidências</h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Compare orçamentos e anexe comprovantes, links e observações para rastreabilidade dos valores.
        </p>
      </div>
      <FacToolbar context="Comparativo de orçamentos por compra · clique numa cotação para anexar comprovantes" onChanged={load}>
        <div className="flex items-center rounded-md border border-border p-0.5">
          <button onClick={() => setView("cards")} className={cn("flex items-center gap-1 rounded px-2.5 py-1 text-[12px]", view === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </button>
          <button onClick={() => setView("lista")} className={cn("flex items-center gap-1 rounded px-2.5 py-1 text-[12px]", view === "lista" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
            <List className="h-3.5 w-3.5" /> Lista
          </button>
        </div>
      </FacToolbar>

      {loading ? (
        <Skeleton className="h-80 rounded-lg" />
      ) : linhas.length === 0 ? (
        <div className="card-surface py-16 text-center text-[13px] text-muted-foreground">
          Nenhuma cotação registrada. Adicione cotações abrindo uma solicitação em <span className="font-medium text-foreground">Solicitações</span>.
        </div>
      ) : view === "lista" ? (
        <div className="card-surface overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Compra</th>
                <th className="px-4 py-3 font-semibold">Cotação 1</th>
                <th className="px-4 py-3 font-semibold">Cotação 2</th>
                <th className="px-4 py-3 font-semibold">Cotação 3</th>
                <th className="px-4 py-3 text-right font-semibold">Economia</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ solic, cots, economia, melhor }) => (
                <tr key={solic.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-start gap-2">
                      <CatDot cat={solic.categoria} className="mt-1" />
                      <div>
                        <div className="text-[13px] font-medium text-foreground">{solic.titulo}</div>
                        <div className="text-[11.5px] text-muted-foreground">{solic.categoria ?? "—"} · {STATUS_LABEL[solic.status]}</div>
                      </div>
                    </div>
                  </td>
                  {[0, 1, 2].map((i) => {
                    const c = cots[i];
                    if (!c) return <td key={i} className="px-4 py-3 align-top"><CotBox /></td>;
                    return (
                      <td key={i} className="px-4 py-3 align-top">
                        <CotBox
                          cot={c}
                          best={Number(c.valor) === melhor}
                          onClick={() => setEditing({ cot: c, titulo: solic.titulo })}
                        />
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right align-top">
                    <span className="num rounded-md bg-emerald-50 px-2 py-1 text-[12px] font-semibold text-emerald-700">
                      {economia > 0 ? fmtBRL(economia) : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {linhas.map(({ solic, cots, economia, melhor }) => (
            <div key={solic.id} className="card-surface p-4">
              <div className="flex items-center gap-2">
                <CatDot cat={solic.categoria} />
                <div className="text-[13px] font-medium text-foreground">{solic.titulo}</div>
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">{solic.categoria ?? "—"} · {STATUS_LABEL[solic.status]}</div>
              <div className="mt-3 space-y-1.5">
                {cots.map((c) => (
                  <CotBox
                    key={c.id}
                    cot={c}
                    best={Number(c.valor) === melhor}
                    onClick={() => setEditing({ cot: c, titulo: solic.titulo })}
                  />
                ))}
              </div>
              {economia > 0 && (
                <div className="mt-3 text-right text-[12px] text-muted-foreground">
                  Economia: <span className="num font-semibold text-emerald-700">{fmtBRL(economia)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <CotacaoEvidenciaDialog
        cotacao={editing?.cot ?? null}
        solicTitulo={editing?.titulo}
        open={!!editing}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        onSaved={load}
      />
    </div>
  );
}

function CotBox({ cot, best, onClick }: { cot?: Cotacao; best?: boolean; onClick?: () => void }) {
  if (!cot) {
    return <div className="flex h-[52px] items-center justify-center rounded-md border border-dashed border-border text-muted-foreground/50">—</div>;
  }
  const anexosLen = Array.isArray(cot.anexos) ? cot.anexos.length : 0;
  const hasLink = !!cot.link_url;
  const hasObs = !!cot.observacao;
  const hasEvidencia = anexosLen > 0 || hasLink || hasObs;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-md border px-3 py-2 text-left transition hover:border-primary/50 hover:shadow-sm",
        best ? "border-emerald-300 bg-emerald-50/60" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] text-muted-foreground">{cot.fornecedor_nome ?? "—"}</span>
        <div className="flex shrink-0 items-center gap-1">
          {hasLink && <Link2 className="h-3 w-3 text-blue-600" />}
          {anexosLen > 0 && (
            <span className="flex items-center gap-0.5 text-[10.5px] text-muted-foreground">
              <Paperclip className="h-3 w-3" />{anexosLen}
            </span>
          )}
          {hasObs && !anexosLen && !hasLink && <StickyNote className="h-3 w-3 text-amber-600" />}
          {(best || cot.escolhida) && <Check className="h-3.5 w-3.5 text-emerald-600" />}
        </div>
      </div>
      <div className="num text-[13px] font-semibold text-foreground">{fmtBRL(Number(cot.valor))}</div>
      {!hasEvidencia && (
        <div className="mt-0.5 text-[10.5px] text-muted-foreground/70">clique para anexar evidências</div>
      )}
    </button>
  );
}
