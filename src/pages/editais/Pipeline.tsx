import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Edital, PIPELINE_STAGES, fmtBRL, prioridadeBadge, matchColor, daysUntil } from "./types";
import EditalDrawer from "./EditalDrawer";
import { toast } from "sonner";
import { Star, SlidersHorizontal, Filter as FilterIcon, Plus, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditaisConfig } from "./useEditaisConfig";
import { cn } from "@/lib/utils";

type SortMode = "valor" | "prazo" | "match";

const STAGE_LABELS_KEY = "editais:stage-labels";
const loadLabels = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(STAGE_LABELS_KEY) || "{}"); } catch { return {}; }
};

export default function Pipeline() {
  const [rows, setRows] = useState<Edital[]>([]);
  const [selected, setSelected] = useState<Edital | null>(null);
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("prazo");
  const [labels, setLabels] = useState<Record<string, string>>(loadLabels);
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const { cfg } = useEditaisConfig();

  const labelOf = (s: string) => labels[s] ?? s;
  const startEdit = (s: string) => { setEditingStage(s); setDraftLabel(labelOf(s)); };
  const cancelEdit = () => { setEditingStage(null); setDraftLabel(""); };
  const saveEdit = (s: string) => {
    const next = { ...labels };
    const v = draftLabel.trim();
    if (!v || v === s) delete next[s]; else next[s] = v;
    setLabels(next);
    localStorage.setItem(STAGE_LABELS_KEY, JSON.stringify(next));
    setEditingStage(null);
    toast.success("Título atualizado");
  };

  useEffect(() => { document.title = "Editais · Pipeline"; load(); }, [cfg.min_match_score, cfg.show_low_relevance]);
  const load = async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    let q: any = supabase.from("editais" as any).select("*").order("created_at", { ascending: false });
    q = q.or(`prazo_envio.is.null,prazo_envio.gte.${hoje}`);
    if (!cfg.show_low_relevance) q = q.eq("visibility_status", "visivel");
    if (cfg.min_match_score > 0) q = q.gte("match_score", cfg.min_match_score);
    const { data } = await q;
    setRows((data as any) ?? []);
  };

  const onDrop = async (stage: string) => {
    if (!dragId) return;
    setRows(rs => rs.map(r => r.id === dragId ? { ...r, pipeline_stage: stage } : r));
    const { error } = await supabase.from("editais" as any).update({ pipeline_stage: stage }).eq("id", dragId);
    if (error) toast.error(error.message); else toast.success("Movido");
    setDragId(null);
  };

  const novoManual = async () => {
    const { data, error } = await supabase
      .from("editais" as any)
      .insert({
        titulo: "Novo edital (manual)",
        status: "Em análise",
        visibility_status: "visivel",
        pipeline_stage: PIPELINE_STAGES[0],
        prioridade: "Média",
        fonte: "Manual",
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    toast.success("Edital criado — preencha os detalhes");
    await load();
    setSelected(data as any);
    setOpen(true);
  };

  const sorter = (a: Edital, b: Edital) => {
    if (sortMode === "valor") return Number(b.valor_estimado || 0) - Number(a.valor_estimado || 0);
    if (sortMode === "match") return Number(b.match_score || 0) - Number(a.match_score || 0);
    const da = a.prazo_envio ? new Date(a.prazo_envio).getTime() : Infinity;
    const db = b.prazo_envio ? new Date(b.prazo_envio).getTime() : Infinity;
    return da - db;
  };

  const totalGeral = useMemo(() => rows.reduce((s, r) => s + Number(r.valor_estimado || 0), 0), [rows]);

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="text-xs text-muted-foreground">
          <span className="num font-semibold text-foreground">{rows.length}</span> editais ·{" "}
          <span className="num font-semibold text-foreground">{fmtBRL(totalGeral)}</span> em movimento
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
            {(["valor","prazo","match"] as SortMode[]).map(m => (
              <button
                key={m}
                onClick={() => setSortMode(m)}
                className={cn(
                  "px-2.5 py-1 rounded capitalize transition-colors",
                  sortMode === m ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                )}
              >Por {m}</button>
            ))}
          </div>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <FilterIcon className="h-3 w-3" /> Filtrar
          </button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <SlidersHorizontal className="h-3 w-3" />
          </button>
          <Button onClick={novoManual} size="sm" className="h-7 text-[11px]">
            <Plus className="h-3 w-3 mr-1" /> Inclusão manual
          </Button>
        </div>
      </div>

      <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, minmax(240px, 1fr))` }}>
        {PIPELINE_STAGES.map((stage, idx) => {
          const items = rows.filter(r => r.pipeline_stage === stage).sort(sorter);
          const total = items.reduce((s, r) => s + Number(r.valor_estimado || 0), 0);
          const stageColor = ["bg-sky-500","bg-indigo-500","bg-violet-500","bg-amber-500","bg-orange-500","bg-blue-500","bg-emerald-500"][idx % 7];
          return (
            <div
              key={stage}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(stage)}
              className="group/col flex flex-col bg-muted/40 rounded-lg border min-h-[480px]"
            >
              <div className="p-2.5 border-b sticky top-0 bg-card/95 backdrop-blur rounded-t-lg z-[1]">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", stageColor)} />
                  {editingStage === stage ? (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        autoFocus
                        value={draftLabel}
                        onChange={e => setDraftLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveEdit(stage); if (e.key === "Escape") cancelEdit(); }}
                        className="h-6 text-[12px] px-1.5"
                      />
                      <button onClick={() => saveEdit(stage)} className="text-emerald-600 hover:text-emerald-700"><Check className="h-3.5 w-3.5" /></button>
                      <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="text-[12px] font-semibold flex-1 truncate">{labelOf(stage)}</div>
                      <button
                        onClick={() => startEdit(stage)}
                        className="opacity-0 group-hover/col:opacity-100 hover:text-foreground text-muted-foreground transition-opacity"
                        title="Renomear"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <span className="num text-[10.5px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{items.length}</span>
                    </>
                  )}
                </div>
                <div className="text-[10.5px] text-muted-foreground num mt-1 pl-4">{fmtBRL(total)}</div>
              </div>
              <div className="p-2 space-y-2 flex-1">
                {items.map(r => {
                  const d = daysUntil(r.prazo_envio);
                  const score = Number(r.match_score ?? 0);
                  const urgent = d !== null && d >= 0 && d < 7;
                  const overdue = d !== null && d < 0;
                  return (
                    <Card
                      key={r.id}
                      draggable
                      onDragStart={() => setDragId(r.id)}
                      onClick={() => { setSelected(r); setOpen(true); }}
                      className={cn(
                        "p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-sm transition-all relative overflow-hidden",
                        overdue && "border-l-2 border-l-rose-500",
                        urgent && !overdue && "border-l-2 border-l-amber-500"
                      )}
                    >
                      {r.numero && (
                        <div className="text-[9.5px] num text-muted-foreground tracking-wide mb-0.5">{r.numero}</div>
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[12px] font-medium leading-snug flex-1 line-clamp-2">{r.titulo}</div>
                        {r.prioridade === "Alta" && <Star className="h-3 w-3 text-rose-600 fill-rose-600 shrink-0" />}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 truncate">{r.orgao ?? "—"}</div>
                      <div className="flex items-center justify-between mt-2 gap-1">
                        <span className="text-[11px] num font-semibold">{fmtBRL(r.valor_estimado)}</span>
                        <span className={cn("text-[11px] font-semibold num", matchColor(score))}>{score}%</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <Badge variant="outline" className={cn(prioridadeBadge(r.prioridade), "text-[9px] py-0 px-1.5")}>{r.prioridade}</Badge>
                        {d !== null && (
                          <span className={cn(
                            "text-[10px] num font-medium",
                            d < 0 ? "text-rose-600" : d < 7 ? "text-amber-600" : "text-muted-foreground"
                          )}>
                            {d < 0 ? `${Math.abs(d)}d atrás` : `${d}d`}
                          </span>
                        )}
                      </div>
                    </Card>
                  );
                })}
                {!items.length && <div className="text-[11px] text-muted-foreground/60 text-center py-8 border border-dashed rounded">vazio</div>}
              </div>
            </div>
          );
        })}
      </div>
      <EditalDrawer edital={selected} open={open} onOpenChange={setOpen} onSaved={load} />
    </>
  );
}
