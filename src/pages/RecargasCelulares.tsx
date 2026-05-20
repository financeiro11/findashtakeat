import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, Plus, Pencil, Trash2, Search, Filter, Settings2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalize } from "@/lib/normalize";
import { LibAutofillInput } from "@/components/LibAutofillInput";

type Row = {
  id: string;
  proprietario: string;
  numero: string | null;
  situacao: string | null;
  setor: string | null;
  ultima_recarga: string | null;
  proxima_recarga: string | null;
  valor: number | null;
  verificado: string | null;
};

const SITUACAO_OPTS = ["Ativo", "Inativo", "Pendente", "Suspenso"];
const SETOR_OPTS = ["Financeiro", "Comercial", "RPA", "TI", "Diretoria", "RH", "Marketing"];
const VERIFICADO_OPTS = ["Sim", "Não"];

const DAYS_KEY = "celulares_dias_proxima_recarga";
const getDays = () => Number(localStorage.getItem(DAYS_KEY)) || 45;
const addDays = (iso: string | null, days: number) => {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const empty = {
  proprietario: "", numero: "", situacao: "Ativo", setor: "",
  ultima_recarga: "", valor: "", verificado: "Não",
};

export default function RecargasCelulares() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Row>>({});
  const [search, setSearch] = useState("");
  const [filtSit, setFiltSit] = useState<string>("__all");
  const [filtSetor, setFiltSetor] = useState<string>("__all");
  const [filtVer, setFiltVer] = useState<string>("__all");
  const [days, setDays] = useState<number>(getDays());

  useEffect(() => { document.title = "Recargas · Celulares"; load(); }, []);

  const load = async () => {
    const { data, error } = await supabase
      .from("recargas_celulares").select("*").order("proprietario");
    if (error) toast.error(error.message);
    else setRows((data as Row[]) || []);
  };

  const setores = useMemo(() => {
    const s = new Set<string>(SETOR_OPTS);
    rows.forEach((r) => r.setor && s.add(r.setor));
    return Array.from(s).sort();
  }, [rows]);
  const situacoes = useMemo(() => {
    const s = new Set<string>(SITUACAO_OPTS);
    rows.forEach((r) => r.situacao && s.add(r.situacao));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtSit !== "__all" && (r.situacao || "") !== filtSit) return false;
      if (filtSetor !== "__all" && (r.setor || "") !== filtSetor) return false;
      if (filtVer !== "__all" && (r.verificado || "Não") !== filtVer) return false;
      if (!q) return true;
      return (r.proprietario || "").toLowerCase().includes(q)
        || (r.numero || "").toLowerCase().includes(q);
    });
  }, [rows, search, filtSit, filtSetor, filtVer]);

  const saveDays = (n: number) => {
    setDays(n);
    localStorage.setItem(DAYS_KEY, String(n));
  };

  const createNew = async () => {
    if (!form.proprietario.trim()) return toast.error("Proprietário obrigatório");
    const ultima = form.ultima_recarga || null;
    const payload = {
      proprietario: form.proprietario,
      numero: form.numero || null,
      situacao: form.situacao || null,
      setor: form.setor || null,
      ultima_recarga: ultima,
      proxima_recarga: addDays(ultima, days),
      valor: form.valor ? Number(form.valor) : 0,
      verificado: form.verificado || "Não",
    };
    const { error } = await supabase.from("recargas_celulares").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Criado");
    setOpen(false);
    setForm({ ...empty });
    load();
  };

  const startEdit = (r: Row) => { setEditingId(r.id); setDraft({ ...r }); };
  const cancelEdit = () => { setEditingId(null); setDraft({}); };

  const saveEdit = async () => {
    if (!editingId) return;
    const ultima = (draft.ultima_recarga as string) || null;
    const payload: any = {
      proprietario: draft.proprietario || "",
      numero: draft.numero || null,
      situacao: draft.situacao || null,
      setor: draft.setor || null,
      ultima_recarga: ultima,
      proxima_recarga: addDays(ultima, days),
      valor: draft.valor != null ? Number(draft.valor) : 0,
      verificado: (draft.verificado as string) || "Não",
    };
    const { error } = await supabase.from("recargas_celulares").update(payload).eq("id", editingId);
    if (error) return toast.error(error.message);
    toast.success("Atualizado");
    cancelEdit();
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir registro?")) return;
    const { error } = await supabase.from("recargas_celulares").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Excluído"); load(); }
  };

  const recomputeAll = async () => {
    if (!confirm(`Recalcular Próxima Recarga de todos os registros (+${days} dias)?`)) return;
    const updates = rows.filter(r => r.ultima_recarga).map(r =>
      supabase.from("recargas_celulares")
        .update({ proxima_recarga: addDays(r.ultima_recarga, days) })
        .eq("id", r.id)
    );
    await Promise.all(updates);
    toast.success("Atualizado");
    load();
  };

  const importExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!json.length) return toast.error("Planilha vazia");

      const map: Record<string, string> = {};
      Object.keys(json[0]).forEach((k) => { map[normalize(k)] = k; });
      const get = (row: any, ...keys: string[]) => {
        for (const k of keys) {
          const real = map[normalize(k)];
          if (real != null) return row[real];
        }
        return "";
      };
      const toDate = (v: any) => {
        if (!v) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };
      const toNum = (v: any) => {
        if (v === "" || v == null) return 0;
        if (typeof v === "number") return v;
        return Number(String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
      };

      const payload = json.map((r) => {
        const ultima = toDate(get(r, "Última Recarga", "Ultima Recarga"));
        return {
          proprietario: String(get(r, "Proprietário", "Proprietario", "Nome") || "").trim(),
          numero: String(get(r, "Número", "Numero", "Telefone") || "").trim() || null,
          situacao: String(get(r, "Situação", "Situacao", "Status") || "").trim() || null,
          setor: String(get(r, "Setor", "Departamento") || "").trim() || null,
          ultima_recarga: ultima,
          proxima_recarga: addDays(ultima, days) || toDate(get(r, "Próxima Recarga", "Proxima Recarga")),
          valor: toNum(get(r, "Valor")),
          verificado: (() => { const v = String(get(r, "Verificado") || "").trim().toLowerCase(); return v === "sim" || v === "yes" || v === "true" ? "Sim" : "Não"; })(),
        };
      }).filter((r) => r.proprietario);

      if (!payload.length) return toast.error("Nenhuma linha válida");
      const { error } = await supabase.from("recargas_celulares").insert(payload);
      if (error) throw error;
      toast.success(`${payload.length} linhas importadas`);
      load();
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-6 p-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Recargas · Celulares</h2>
        <p className="text-sm text-muted-foreground">Controle de recargas dos celulares corporativos.</p>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setForm({ ...empty }); setOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Novo
              </Button>
              <Button variant="outline" asChild>
                <label className="cursor-pointer">
                  <Upload className="mr-2 h-4 w-4" /> Importar Excel
                  <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={importExcel} />
                </label>
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline"><Settings2 className="mr-2 h-4 w-4" /> Próxima recarga: {days}d</Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 space-y-3">
                  <Label>Dias para próxima recarga</Label>
                  <Input type="number" min={1} value={days}
                    onChange={(e) => saveDays(Math.max(1, Number(e.target.value) || 1))} />
                  <Button size="sm" className="w-full" onClick={recomputeAll}>
                    Recalcular para todos
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
            <span className="text-sm text-muted-foreground">{filtered.length} de {rows.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome ou número..." value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="mr-2 h-4 w-4" /> Filtros
                  {(filtSit !== "__all" || filtSetor !== "__all") && <span className="ml-1 rounded bg-primary/10 px-1.5 text-xs text-primary">on</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-3">
                <div>
                  <Label>Situação</Label>
                  <Select value={filtSit} onValueChange={setFiltSit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Todas</SelectItem>
                      {situacoes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Setor</Label>
                  <Select value={filtSetor} onValueChange={setFiltSetor}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Todos</SelectItem>
                      {setores.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Verificado</Label>
                  <Select value={filtVer} onValueChange={setFiltVer}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Todos</SelectItem>
                      {VERIFICADO_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="outline" className="w-full"
                  onClick={() => { setFiltSit("__all"); setFiltSetor("__all"); setFiltVer("__all"); }}>Limpar filtros</Button>
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-card border-r">Proprietário</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead>Última Recarga</TableHead>
                <TableHead>Próxima Recarga</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-center">Verificado</TableHead>
                <TableHead className="w-28 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const editing = editingId === r.id;
                const d = editing ? draft : r;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium sticky left-0 z-10 bg-card border-r">
                      {editing
                        ? <LibAutofillInput
                            compact
                            value={(d.proprietario as string) || ""}
                            onChange={(v) => setDraft({ ...draft, proprietario: v })}
                            onMatch={(m) => { if (m && (m as any).setor && !draft.setor) setDraft((prev) => ({ ...prev, proprietario: m.nome, setor: (m as any).setor })); }}
                            inputClassName="h-8"
                          />
                        : r.proprietario}
                    </TableCell>
                    <TableCell>
                      {editing
                        ? <Input value={(d.numero as string) || ""} onChange={(e) => setDraft({ ...draft, numero: e.target.value })} className="h-8" />
                        : r.numero}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={(d.situacao as string) || ""}
                        onValueChange={async (v) => {
                          if (editing) setDraft({ ...draft, situacao: v });
                          else {
                            await supabase.from("recargas_celulares").update({ situacao: v }).eq("id", r.id);
                            load();
                          }
                        }}
                      >
                        <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {situacoes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={(d.setor as string) || ""}
                        onValueChange={async (v) => {
                          if (editing) setDraft({ ...draft, setor: v });
                          else {
                            await supabase.from("recargas_celulares").update({ setor: v }).eq("id", r.id);
                            load();
                          }
                        }}
                      >
                        <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {setores.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {editing
                        ? <Input type="date" value={(d.ultima_recarga as string) || ""} onChange={(e) => setDraft({ ...draft, ultima_recarga: e.target.value })} className="h-8" />
                        : r.ultima_recarga}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {editing
                        ? (addDays((draft.ultima_recarga as string) || null, days) || "—")
                        : (r.proxima_recarga || "—")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {editing
                        ? <Input type="number" step="0.01" value={(d.valor as any) ?? ""} onChange={(e) => setDraft({ ...draft, valor: e.target.value as any })} className="h-8 text-right" />
                        : Number(r.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </TableCell>
                    <TableCell className="text-center">
                      <Select
                        value={(d.verificado as string) || "Não"}
                        onValueChange={async (v) => {
                          if (editing) setDraft({ ...draft, verificado: v });
                          else {
                            await supabase.from("recargas_celulares").update({ verificado: v }).eq("id", r.id);
                            load();
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 w-24 mx-auto"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VERIFICADO_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {editing ? (
                          <>
                            <Button size="icon" variant="ghost" onClick={saveEdit} title="Salvar"><Check className="h-4 w-4 text-success" /></Button>
                            <Button size="icon" variant="ghost" onClick={cancelEdit} title="Cancelar"><X className="h-4 w-4" /></Button>
                          </>
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => startEdit(r)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => remove(r.id)} title="Excluir"><Trash2 className="h-4 w-4" /></Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filtered.length && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Sem registros</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo celular</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Proprietário</Label>
              <LibAutofillInput
                value={form.proprietario}
                onChange={(v) => setForm({ ...form, proprietario: v })}
                onMatch={(m) => { if (m && (m as any).setor) setForm((f) => ({ ...f, setor: (m as any).setor })); }}
              />
            </div>
            <div><Label>Número</Label><Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
            <div>
              <Label>Situação</Label>
              <Select value={form.situacao} onValueChange={(v) => setForm({ ...form, situacao: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{situacoes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Setor</Label>
              <Select value={form.setor} onValueChange={(v) => setForm({ ...form, setor: v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{setores.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Valor</Label><Input type="number" step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></div>
            <div><Label>Última Recarga</Label><Input type="date" value={form.ultima_recarga} onChange={(e) => setForm({ ...form, ultima_recarga: e.target.value })} /></div>
            <div>
              <Label>Verificado</Label>
              <Select value={form.verificado} onValueChange={(v) => setForm({ ...form, verificado: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{VERIFICADO_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 text-xs text-muted-foreground">
              Próxima recarga será calculada automaticamente: {addDays(form.ultima_recarga || null, days) || "—"} ({days} dias)
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={createNew}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
