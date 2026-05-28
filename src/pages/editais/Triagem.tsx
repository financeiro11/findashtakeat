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

const normTitulo = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

async function makeHashClient(titulo: string, orgao?: string | null, dataPub?: string | null): Promise<string> {
  const payload = [normTitulo(titulo), normTitulo(orgao ?? ""), dataPub ?? ""].join("|");
  const buf = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Triagem() {
  const [rows, setRows] = useState<Edital[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { document.title = "Editais · Triagem"; load(); }, [filter]);

  const load = async () => {
    setLoading(true);
    const hoje = new Date().toISOString().slice(0, 10);
    let query: any = supabase.from("editais" as any).select("*").order("match_score", { ascending: false }).limit(500);
    query = query.or(`prazo_envio.is.null,prazo_envio.gte.${hoje}`);
    if (filter !== "all") query = query.eq("visibility_status", filter);
    const { data, error } = await query;
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
    setLoading(false);
  };

  const excluir = async (r: Edital) => {
    if (!confirm("Excluir definitivamente este edital? Ele entra na blacklist e NÃO voltará a aparecer em futuras execuções do crawler.")) return;
    // 1) grava na blacklist permanente (url + título normalizado + hash + external_id)
    const titulo_norm = normTitulo(r.titulo);
    const hash_dedupe = await makeHashClient(r.titulo, r.orgao, r.data_publicacao);
    const { error: blErr } = await supabase.from("editais_blacklist" as any).insert({
      url: r.link ?? null,
      titulo_norm,
      hash_dedupe,
      external_id: (r as any).external_id ?? null,
      motivo: "Excluído manualmente na triagem",
    });
    if (blErr) { toast.error(blErr.message); return; }
    // 2) remove o registro atual
    const { error } = await supabase.from("editais" as any).delete().eq("id", r.id);
    if (error) toast.error(error.message);
    else { toast.success("Excluído e adicionado à blacklist"); load(); }
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
                      <Button size="sm" variant="outline" className="h-7 px-2 text-rose-600" onClick={() => excluir(r)} title="Excluir definitivamente">

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
