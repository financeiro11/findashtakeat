import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Edital, opportunityLabel, visibilityBadge, VISIBILITY_STATUSES, matchColor } from "./types";
import { Eye, EyeOff, Star, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

export default function Triagem() {
  const [rows, setRows] = useState<Edital[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { document.title = "Editais · Triagem"; load(); }, [filter]);

  const load = async () => {
    setLoading(true);
    let query: any = supabase.from("editais" as any).select("*").order("match_score", { ascending: false }).limit(500);
    if (filter !== "all") query = query.eq("visibility_status", filter);
    const { data, error } = await query;
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setLoading(false);
  };

  const setVisibility = async (id: string, status: string) => {
    const { error } = await supabase.from("editais" as any).update({ visibility_status: status }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`Marcado como ${status}`); load(); }
  };

  const filtered = rows.filter(r => !q || `${r.titulo} ${r.orgao}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar..." className="pl-8" />
          </div>
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>Todos ({rows.length})</Button>
          {VISIBILITY_STATUSES.map(v => (
            <Button key={v.value} size="sm" variant={filter === v.value ? "default" : "outline"} onClick={() => setFilter(v.value)}>
              {v.label}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Auditoria de tudo que foi capturado. Use as ações para promover ou descartar manualmente.
        </p>
      </Card>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Edital</TableHead>
              <TableHead>Fonte</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="num">Score</TableHead>
              <TableHead>Visibilidade</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(r => {
              const score = Number(r.match_score ?? 0);
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-sm max-w-[420px] truncate">{r.titulo}</div>
                    <div className="text-[10px] text-muted-foreground truncate max-w-[420px]">{r.orgao ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-xs">{r.fonte ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{opportunityLabel(r.opportunity_type)}</Badge></TableCell>
                  <TableCell className={`num text-xs font-semibold ${matchColor(score)}`}>{score}%</TableCell>
                  <TableCell><Badge variant="outline" className={visibilityBadge(r.visibility_status)}>{VISIBILITY_STATUSES.find(v => v.value === r.visibility_status)?.label ?? r.visibility_status ?? "—"}</Badge></TableCell>
                  <TableCell className="text-[11px] text-muted-foreground max-w-[360px]">
                    {r.exclusion_reason && <div className="text-rose-600">⛔ {r.exclusion_reason}</div>}
                    {r.relevance_reason && <div className="truncate">✓ {r.relevance_reason}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {r.visibility_status !== "visivel" && (
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setVisibility(r.id, "visivel")} title="Tornar visível">
                          <Eye className="h-3 w-3" />
                        </Button>
                      )}
                      {r.visibility_status !== "oculto_por_baixa_relevancia" && (
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setVisibility(r.id, "oculto_por_baixa_relevancia")} title="Ocultar">
                          <EyeOff className="h-3 w-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setVisibility(r.id, "pendente_revisao")} title="Marcar como relevante p/ revisão">
                        <Star className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-rose-600" onClick={() => setVisibility(r.id, "descartado")} title="Descartar">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {!filtered.length && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">{loading ? "Carregando..." : "Nenhum edital."}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
