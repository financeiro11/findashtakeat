import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UserRoundCog, Upload, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Tier = "Tier 1" | "Tier 2" | "Tier 3" | "Não possui";
type Metodo = "%" | "Fixo $";

type Parceiro = {
  id: string;
  nome: string;
  tier: Tier;
  status: "ativo" | "inativo";
  bonificacao: boolean;
  metodo_bonificacao: Metodo | null;
  valor_bonificacao: number | null;
  recorrencia: boolean;
  metodo_recorrencia: Metodo | null;
  valor_recorrencia: number | null;
  campanha: string | null;
};

const TIERS: Tier[] = ["Tier 1", "Tier 2", "Tier 3", "Não possui"];

const emptyForm: Omit<Parceiro, "id"> = {
  nome: "",
  tier: "Não possui",
  status: "ativo",
  bonificacao: false,
  metodo_bonificacao: null,
  valor_bonificacao: null,
  recorrencia: false,
  metodo_recorrencia: null,
  valor_recorrencia: null,
  campanha: null,
};

// --- helpers de parsing da planilha ---
const norm = (s: any) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const parseBool = (v: any): boolean => {
  const s = norm(v);
  return ["true", "1", "sim", "yes", "y", "s", "verdadeiro"].includes(s);
};

const parseTier = (v: any): Tier => {
  const s = norm(v).replace(/[^0-9]/g, "");
  if (s === "1") return "Tier 1";
  if (s === "2") return "Tier 2";
  if (s === "3") return "Tier 3";
  return "Não possui";
};

const parseStatus = (v: any): "ativo" | "inativo" => {
  const s = norm(v);
  return s.startsWith("inat") ? "inativo" : "ativo";
};

const parseMetodo = (v: any): Metodo | null => {
  const s = norm(v);
  if (!s) return null;
  if (s.includes("%") || s.includes("perc")) return "%";
  if (s.includes("$") || s.includes("fixo") || s.includes("r$")) return "Fixo $";
  return null;
};

const parseNum = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[R$\s%]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

const findKey = (row: Record<string, any>, candidates: string[]): string | undefined => {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const c = norm(cand);
    const found = keys.find((k) => norm(k) === c || norm(k).includes(c));
    if (found) return found;
  }
  return undefined;
};

export function GestaoParceirosDialog() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Parceiro[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Parceiro, "id">>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [pendingRows, setPendingRows] = useState<Record<string, any>[]>([]);
  const [pendingHeaders, setPendingHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const DB_FIELDS: { key: string; label: string; required?: boolean }[] = [
    { key: "nome", label: "Nome", required: true },
    { key: "tier", label: "Tier" },
    { key: "status", label: "Status" },
    { key: "campanha", label: "Campanha" },
    { key: "bonificacao", label: "Bonificação (sim/não)" },
    { key: "metodo_bonificacao", label: "Método bonificação" },
    { key: "valor_bonificacao", label: "Valor bonificação" },
    { key: "recorrencia", label: "Recorrência (sim/não)" },
    { key: "metodo_recorrencia", label: "Método recorrência" },
    { key: "valor_recorrencia", label: "Valor recorrência" },
  ];

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("parceiros_cadastro")
      .select("*")
      .order("nome", { ascending: true });
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Parceiro[]);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); }, [open]);

  const resetForm = () => { setForm(emptyForm); setEditingId(null); };

  const startEdit = (p: Parceiro) => {
    setEditingId(p.id);
    setForm({
      nome: p.nome,
      tier: p.tier,
      status: p.status ?? "ativo",
      bonificacao: p.bonificacao,
      metodo_bonificacao: p.metodo_bonificacao,
      valor_bonificacao: p.valor_bonificacao,
      recorrencia: p.recorrencia,
      metodo_recorrencia: p.metodo_recorrencia,
      valor_recorrencia: p.valor_recorrencia,
      campanha: p.campanha ?? null,
    });
  };

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.warning("Informe o nome do parceiro"); return; }
    setSaving(true);
    const payload = {
      nome: form.nome.trim(),
      tier: form.tier,
      status: form.status,
      bonificacao: form.bonificacao,
      metodo_bonificacao: form.bonificacao ? form.metodo_bonificacao : null,
      valor_bonificacao: form.bonificacao ? form.valor_bonificacao : null,
      recorrencia: form.recorrencia,
      metodo_recorrencia: form.recorrencia ? form.metodo_recorrencia : null,
      valor_recorrencia: form.recorrencia ? form.valor_recorrencia : null,
      campanha: form.campanha?.trim() || null,
    };
    const { error } = editingId
      ? await supabase.from("parceiros_cadastro").update(payload).eq("id", editingId)
      : await supabase.from("parceiros_cadastro").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? "Parceiro atualizado" : "Parceiro cadastrado");
    resetForm();
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Apagar este parceiro?")) return;
    const { error } = await supabase.from("parceiros_cadastro").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Parceiro apagado");
    if (editingId === id) resetForm();
    load();
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!data.length) { toast.warning("Planilha vazia"); return; }

      const headers = Object.keys(data[0]);
      const candidates: Record<string, string[]> = {
        nome: ["nome"],
        tier: ["tier"],
        status: ["status"],
        campanha: ["campanha"],
        bonificacao: ["bonificacao", "bonificação"],
        metodo_bonificacao: ["metodo bonificacao", "metodo bonificação", "método bonificação"],
        valor_bonificacao: ["valor bonificacao", "valor bonificação"],
        recorrencia: ["recorrencia", "recorrência"],
        metodo_recorrencia: ["metodo recorrencia", "metodo recorrência", "método recorrência"],
        valor_recorrencia: ["valor recorrencia", "valor recorrência"],
      };
      const autoMap: Record<string, string> = {};
      for (const [field, cands] of Object.entries(candidates)) {
        const k = findKey(data[0], cands);
        if (k) autoMap[field] = k;
      }

      setPendingRows(data);
      setPendingHeaders(headers);
      setMapping(autoMap);
      setMapOpen(true);
    } catch (e: any) {
      toast.error(`Erro ao ler planilha: ${e?.message ?? e}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    if (!mapping.nome) { toast.warning("Mapeie a coluna 'Nome' (obrigatória)"); return; }
    setImporting(true);
    try {
      const get = (r: Record<string, any>, f: string) => (mapping[f] ? r[mapping[f]] : "");
      const payloads = pendingRows
        .map((r) => {
          const nome = String(get(r, "nome") ?? "").trim();
          if (!nome) return null;
          const bonificacao = mapping.bonificacao ? parseBool(get(r, "bonificacao")) : false;
          const recorrencia = mapping.recorrencia ? parseBool(get(r, "recorrencia")) : false;
          return {
            nome,
            tier: mapping.tier ? parseTier(get(r, "tier")) : ("Não possui" as Tier),
            status: mapping.status ? parseStatus(get(r, "status")) : ("ativo" as const),
            bonificacao,
            metodo_bonificacao: bonificacao ? parseMetodo(get(r, "metodo_bonificacao")) : null,
            valor_bonificacao: bonificacao ? parseNum(get(r, "valor_bonificacao")) : null,
            recorrencia,
            metodo_recorrencia: recorrencia ? parseMetodo(get(r, "metodo_recorrencia")) : null,
            valor_recorrencia: recorrencia ? parseNum(get(r, "valor_recorrencia")) : null,
            campanha: mapping.campanha ? (String(get(r, "campanha") ?? "").trim() || null) : null,
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      if (!payloads.length) { toast.warning("Nenhuma linha válida encontrada"); return; }

      const existingByName = new Map(rows.map((r) => [r.nome.toLowerCase(), r.id]));
      const toUpdate = payloads.filter((p) => existingByName.has(p.nome.toLowerCase()));
      const toInsert = payloads.filter((p) => !existingByName.has(p.nome.toLowerCase()));

      let okCount = 0;
      let errCount = 0;

      if (toInsert.length) {
        const { error } = await supabase.from("parceiros_cadastro").insert(toInsert);
        if (error) { errCount += toInsert.length; toast.error(error.message); }
        else okCount += toInsert.length;
      }
      for (const p of toUpdate) {
        const id = existingByName.get(p.nome.toLowerCase())!;
        const { error } = await supabase.from("parceiros_cadastro").update(p).eq("id", id);
        if (error) errCount++; else okCount++;
      }

      toast.success(`Importação concluída: ${okCount} ok${errCount ? `, ${errCount} com erro` : ""}`);
      setMapOpen(false);
      setPendingRows([]);
      setPendingHeaders([]);
      setMapping({});
      load();
    } catch (e: any) {
      toast.error(`Erro ao importar: ${e?.message ?? e}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]">
          <UserRoundCog className="h-3.5 w-3.5" /> Gestão de Parceiros
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <UserRoundCog className="h-4 w-4" /> Gestão de Parceiros
            </span>
            <div className="flex items-center gap-2 pr-6">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImport(f);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px] font-normal"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
              >
                {importing ? (
                  <><FileSpreadsheet className="h-3.5 w-3.5 animate-pulse" /> Importando…</>
                ) : (
                  <><Upload className="h-3.5 w-3.5" /> Importar planilha</>
                )}
              </Button>
            </div>
          </DialogTitle>
          <p className="text-[11.5px] text-muted-foreground">
            Colunas aceitas: <span className="font-mono">Nome · Tier · Status · Bonificação · Método bonificação · Valor bonificação · Recorrência · Método recorrência · Valor recorrência · Campanha</span>. Parceiros existentes (mesmo nome) são atualizados.
          </p>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Form */}
          <div className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              {editingId ? "Editar parceiro" : "Cadastro de Parceiros"}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px]">Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Nome do parceiro"
                className="h-8 text-[12.5px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[12px]">Tier</Label>
                <Select value={form.tier} onValueChange={(v) => setForm((f) => ({ ...f, tier: v as Tier }))}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as "ativo" | "inativo" }))}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px]">Campanha</Label>
              <Input
                value={form.campanha ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, campanha: e.target.value }))}
                placeholder="(opcional)"
                className="h-8 text-[12.5px]"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label className="text-[12.5px]">Bonificação</Label>
              <Switch
                checked={form.bonificacao}
                onCheckedChange={(v) => setForm((f) => ({
                  ...f,
                  bonificacao: v,
                  metodo_bonificacao: v ? (f.metodo_bonificacao ?? "%") : null,
                  valor_bonificacao: v ? f.valor_bonificacao : null,
                }))}
              />
            </div>

            {form.bonificacao && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Método</Label>
                  <Select
                    value={form.metodo_bonificacao ?? "%"}
                    onValueChange={(v) => setForm((f) => ({ ...f, metodo_bonificacao: v as Metodo }))}
                  >
                    <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="%">% (percentual)</SelectItem>
                      <SelectItem value="Fixo $">Fixo $</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Valor</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valor_bonificacao ?? ""}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      valor_bonificacao: e.target.value === "" ? null : Number(e.target.value),
                    }))}
                    placeholder={form.metodo_bonificacao === "Fixo $" ? "R$ 0,00" : "%"}
                    className="h-8 text-[12.5px]"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label className="text-[12.5px]">Recorrência</Label>
              <Switch
                checked={form.recorrencia}
                onCheckedChange={(v) => setForm((f) => ({
                  ...f,
                  recorrencia: v,
                  metodo_recorrencia: v ? (f.metodo_recorrencia ?? "%") : null,
                  valor_recorrencia: v ? f.valor_recorrencia : null,
                }))}
              />
            </div>

            {form.recorrencia && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Método</Label>
                  <Select
                    value={form.metodo_recorrencia ?? "%"}
                    onValueChange={(v) => setForm((f) => ({ ...f, metodo_recorrencia: v as Metodo }))}
                  >
                    <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="%">% (percentual)</SelectItem>
                      <SelectItem value="Fixo $">Fixo $</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Valor</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valor_recorrencia ?? ""}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      valor_recorrencia: e.target.value === "" ? null : Number(e.target.value),
                    }))}
                    placeholder={form.metodo_recorrencia === "Fixo $" ? "R$ 0,00" : "%"}
                    className="h-8 text-[12.5px]"
                  />
                </div>
              </div>
            )}

            <DialogFooter className="!justify-start gap-2 pt-1">
              <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={handleSave} disabled={saving}>
                <Plus className="h-3.5 w-3.5" />
                {editingId ? "Salvar alterações" : "Cadastrar"}
              </Button>
              {editingId && (
                <Button variant="ghost" size="sm" className="h-8 text-[12.5px]" onClick={resetForm}>
                  Cancelar
                </Button>
              )}
            </DialogFooter>
          </div>

          {/* List */}
          <div className="rounded-lg border border-border bg-card/40 p-3">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              Parceiros cadastrados ({rows.length})
            </div>
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              {loading ? (
                <div className="py-8 text-center text-[12.5px] text-muted-foreground">Carregando…</div>
              ) : rows.length === 0 ? (
                <div className="py-8 text-center text-[12.5px] text-muted-foreground">Nenhum parceiro cadastrado</div>
              ) : (
                rows.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-start justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2",
                      editingId === p.id && "ring-1 ring-primary",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-foreground">{p.nome}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="text-[10px] font-normal">{p.tier}</Badge>
                        {p.status === "inativo" && (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 text-[10px] font-normal">
                            Inativo
                          </Badge>
                        )}
                        {p.campanha && (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {p.campanha}
                          </Badge>
                        )}
                        {p.bonificacao && (
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            Bonificação{p.metodo_bonificacao ? ` · ${p.metodo_bonificacao}${p.valor_bonificacao != null ? ` ${p.valor_bonificacao}` : ""}` : ""}
                          </Badge>
                        )}
                        {p.recorrencia && (
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            Recorrência · {p.metodo_recorrencia}{p.valor_recorrencia != null ? ` ${p.valor_recorrencia}` : ""}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(p)} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(p.id)} title="Apagar">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
