import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Search, Loader2, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type MapaRow = {
  id: string;
  codigo_categoria: string;
  descricao_categoria: string | null;
  rubrica: string;
  demonstrativo: string;
  ativo: boolean;
};

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const tbl = () => supabase.from("omie_dre_mapa" as any) as any;

/**
 * Painel de edição do DE_PARA (categoria do Omie → rubrica da demonstração).
 * Usado tanto pela DRE quanto pela DFC, filtrando por `demonstrativo`.
 * `rubricas` alimenta o autocomplete (datalist) e sinaliza rubricas que não
 * correspondem a nenhuma linha conhecida da demonstração.
 */
export function OmieDeParaPanel({
  demonstrativo,
  rubricas,
}: {
  demonstrativo: "dre" | "dfc";
  rubricas: string[];
}) {
  const [rows, setRows] = useState<MapaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [novo, setNovo] = useState({ categoria: "", rubrica: "" });
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await tbl()
      .select("*")
      .eq("demonstrativo", demonstrativo)
      .order("codigo_categoria");
    if (error) toast.error(error.message);
    else setRows((data as MapaRow[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [demonstrativo]);

  const rubricasSet = useMemo(() => new Set(rubricas.map(norm)), [rubricas]);

  // Sugestões do autocomplete: rubricas do schema + as já usadas no DE_PARA
  const sugestoes = useMemo(() => {
    const s = new Set<string>(rubricas);
    rows.forEach((r) => r.rubrica && s.add(r.rubrica));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rubricas, rows]);

  const filtered = useMemo(() => {
    const n = norm(q);
    if (!n) return rows;
    return rows.filter((r) => norm(r.codigo_categoria).includes(n) || norm(r.rubrica).includes(n));
  }, [rows, q]);

  const setLocalRubrica = (id: string, rubrica: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, rubrica } : r)));

  const saveRubrica = async (id: string, rubrica: string) => {
    setSavingId(id);
    const { error } = await tbl().update({ rubrica, updated_at: new Date().toISOString() }).eq("id", id);
    setSavingId(null);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    const alvo = rows.find((r) => r.id === id);
    if (!confirm(`Remover o mapeamento de "${alvo?.codigo_categoria}"?`)) return;
    const { error } = await tbl().delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  const add = async () => {
    const categoria = novo.categoria.trim();
    const rubrica = novo.rubrica.trim();
    if (!categoria || !rubrica) return toast.error("Preencha a categoria e a rubrica.");
    setAdding(true);
    const { data, error } = await tbl()
      .insert({ codigo_categoria: categoria, descricao_categoria: categoria, rubrica, demonstrativo })
      .select("*")
      .single();
    setAdding(false);
    if (error) return toast.error(error.message);
    setRows((rs) => [...rs, data as MapaRow].sort((a, b) => a.codigo_categoria.localeCompare(b.codigo_categoria)));
    setNovo({ categoria: "", rubrica: "" });
    toast.success("Mapeamento adicionado.");
  };

  const listId = `rubricas-${demonstrativo}`;

  return (
    <div className="px-6 pb-8 pt-4">
      <datalist id={listId}>
        {sugestoes.map((r) => <option key={r} value={r} />)}
      </datalist>

      {/* Barra: busca + contador */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar por categoria do Omie ou rubrica…"
            className="h-9 pl-8 text-[13px]"
          />
        </div>
        <div className="text-[12px] text-muted-foreground">
          {loading ? "Carregando…" : `${filtered.length} de ${rows.length} mapeamento(s) · ${demonstrativo.toUpperCase()}`}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 w-[45%]">Categoria no Omie</th>
              <th className="px-3 py-2">Rubrica na {demonstrativo.toUpperCase()}</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {/* Linha de adição */}
            <tr className="border-b border-border bg-muted/20">
              <td className="px-3 py-2">
                <Input
                  value={novo.categoria}
                  onChange={(e) => setNovo((n) => ({ ...n, categoria: e.target.value }))}
                  placeholder="Nova categoria do Omie…"
                  className="h-8 text-[13px]"
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  list={listId}
                  value={novo.rubrica}
                  onChange={(e) => setNovo((n) => ({ ...n, rubrica: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                  placeholder="Rubrica de destino…"
                  className="h-8 text-[13px]"
                />
              </td>
              <td className="px-3 py-2">
                <Button size="icon" className="h-8 w-8" onClick={add} disabled={adding} title="Adicionar">
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </td>
            </tr>

            {filtered.map((r) => {
              const desconhecida = r.rubrica && !rubricasSet.has(norm(r.rubrica));
              return (
                <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-medium text-foreground/90">{r.codigo_categoria}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Input
                        list={listId}
                        value={r.rubrica}
                        onChange={(e) => setLocalRubrica(r.id, e.target.value)}
                        onBlur={(e) => saveRubrica(r.id, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        className={cn("h-8 text-[13px]", desconhecida && "border-amber-400")}
                      />
                      {savingId === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      {desconhecida && !savingId && (
                        <span title={`"${r.rubrica}" não é uma linha reconhecida da ${demonstrativo.toUpperCase()} — não aparecerá na demonstração até bater com uma rubrica existente.`}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(r.id)} title="Remover">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "Nenhum mapeamento cadastrado ainda." : "Nenhum resultado para o filtro."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Editar a rubrica salva automaticamente ao sair do campo. O triângulo âmbar indica rubricas
        que ainda não correspondem a uma linha da {demonstrativo.toUpperCase()}.
      </p>
    </div>
  );
}
