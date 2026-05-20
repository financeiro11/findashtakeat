import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Plus, Upload, Download, Pencil, Trash2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export type Rule = {
  id: string;
  keyword: string;
  tipo: "Crédito" | "Débito";
  categoria: string | null;
  centro_custo: string | null;
  conta: string | null;
  cliente_fornecedor: string | null;
  observacao: string | null;
};

const empty: Omit<Rule, "id"> = {
  keyword: "", tipo: "Débito", categoria: "", centro_custo: "",
  conta: "", cliente_fornecedor: "", observacao: "",
};

export default function DePara() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<Omit<Rule, "id">>(empty);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("de_para_rules")
      .select("*")
      .order("keyword");
    if (error) toast.error("Erro ao carregar regras");
    else setRules((data as Rule[]) || []);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (r: Rule) => {
    setEditing(r);
    setForm({
      keyword: r.keyword, tipo: r.tipo, categoria: r.categoria ?? "",
      centro_custo: r.centro_custo ?? "", conta: r.conta ?? "",
      cliente_fornecedor: r.cliente_fornecedor ?? "", observacao: r.observacao ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.keyword.trim()) return toast.error("Palavra-chave obrigatória");
    setLoading(true);
    if (editing) {
      const { error } = await supabase.from("de_para_rules").update(form).eq("id", editing.id);
      if (error) toast.error(error.message); else toast.success("Regra atualizada");
    } else {
      const { error } = await supabase.from("de_para_rules").insert(form);
      if (error) toast.error(error.message); else toast.success("Regra adicionada");
    }
    setLoading(false);
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta regra?")) return;
    const { error } = await supabase.from("de_para_rules").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Excluída"); load(); }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const inserts = rows.map((r) => {
        const k = (key: string) => {
          const found = Object.keys(r).find((x) => x.toLowerCase().includes(key));
          return found ? r[found].toString() : "";
        };
        const tipoRaw = k("tipo").toUpperCase();
        return {
          keyword: k("palavra") || k("termo") || k("descri") || "",
          tipo: tipoRaw.startsWith("C") ? "Crédito" : "Débito",
          categoria: k("categ"),
          centro_custo: k("centro"),
          conta: k("conta"),
          cliente_fornecedor: k("cliente") || k("forne"),
          observacao: k("obser"),
        };
      }).filter((r) => r.keyword);
      if (!inserts.length) return toast.error("Nenhuma regra reconhecida");
      const { error } = await supabase.from("de_para_rules").insert(inserts);
      if (error) toast.error(error.message);
      else { toast.success(`${inserts.length} regras importadas`); load(); }
    } catch (err: any) {
      toast.error("Falha ao ler planilha: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  const exportXlsx = () => {
    const data = rules.map((r) => ({
      "Palavra-chave": r.keyword, "Tipo": r.tipo, "Categoria": r.categoria,
      "Centro de Custo": r.centro_custo, "Conta": r.conta,
      "Cliente/Fornecedor": r.cliente_fornecedor, "Observação": r.observacao,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DE_PARA");
    XLSX.writeFile(wb, "de_para.xlsx");
  };

  const filtered = rules.filter((r) =>
    r.keyword.toLowerCase().includes(search.toLowerCase()) ||
    (r.categoria || "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6 p-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">DE_PARA</h2>
        <p className="text-sm text-muted-foreground">
          Cadastre as regras que a IA usará para classificar lançamentos automaticamente.
        </p>
      </div>

      <Card className="border-border shadow-[var(--shadow-card)]">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por termo ou categoria..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Badge variant="secondary">{rules.length} regras</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <label className="cursor-pointer">
                <Upload className="mr-2 h-4 w-4" />
                Importar DE_PARA
                <input type="file" accept=".xlsx,.csv" hidden onChange={handleImport} />
              </label>
            </Button>
            <Button variant="outline" onClick={exportXlsx} disabled={!rules.length}>
              <Download className="mr-2 h-4 w-4" /> Exportar
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew}>
                  <Plus className="mr-2 h-4 w-4" /> Nova regra
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editing ? "Editar regra" : "Nova regra"}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <Field label="Palavra-chave / Termo">
                    <Input value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="Ex: PIX João Silva" />
                  </Field>
                  <Field label="Tipo de lançamento">
                    <Select value={form.tipo} onValueChange={(v: any) => setForm({ ...form, tipo: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Crédito">Crédito</SelectItem>
                        <SelectItem value="Débito">Débito</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Categoria Omie">
                      <Input value={form.categoria || ""} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
                    </Field>
                    <Field label="Centro de Custo">
                      <Input value={form.centro_custo || ""} onChange={(e) => setForm({ ...form, centro_custo: e.target.value })} />
                    </Field>
                    <Field label="Conta Contábil">
                      <Input value={form.conta || ""} onChange={(e) => setForm({ ...form, conta: e.target.value })} />
                    </Field>
                    <Field label="Cliente / Fornecedor">
                      <Input value={form.cliente_fornecedor || ""} onChange={(e) => setForm({ ...form, cliente_fornecedor: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Observação padrão">
                    <Input value={form.observacao || ""} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
                  </Field>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button onClick={save} disabled={loading}>{editing ? "Salvar" : "Adicionar"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Palavra-chave</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Centro de Custo</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Cliente/Forn.</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    Nenhuma regra cadastrada. Importe sua planilha existente ou adicione manualmente.
                  </TableCell>
                </TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.keyword}</TableCell>
                  <TableCell>
                    <Badge variant={r.tipo === "Crédito" ? "default" : "secondary"} className={r.tipo === "Crédito" ? "bg-success text-success-foreground hover:bg-success/90" : ""}>
                      {r.tipo}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.categoria}</TableCell>
                  <TableCell>{r.centro_custo}</TableCell>
                  <TableCell>{r.conta}</TableCell>
                  <TableCell>{r.cliente_fornecedor}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
