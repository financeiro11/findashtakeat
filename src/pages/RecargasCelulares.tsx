import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload, Plus, Pencil, Trash2, Search, Filter, Settings2, Check, X,
  Smartphone, Calendar as CalIcon, Clock, RefreshCw, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import SolicitacoesKanban from "@/pages/recargas/SolicitacoesKanban";
import { Badge } from "@/components/ui/badge";
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
  solicitado_em?: string | null;
};

const SITUACAO_OPTS = ["Ativo", "Inativo", "Pendente", "Suspenso"];
const SETOR_OPTS = ["Financeiro", "Comercial", "RPA", "TI", "Diretoria", "RH", "Marketing"];
const VERIFICADO_OPTS = ["Sim", "Não"];

// Cores da situação — mesma paleta de status da aba Viagens.
const SITUACAO_CLS: Record<string, string> = {
  Ativo: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  Pendente: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  Suspenso: "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
  Inativo: "bg-muted text-muted-foreground border-border",
};

const AVATAR_COLORS = [
  "bg-rose-500", "bg-violet-500", "bg-emerald-500", "bg-sky-500",
  "bg-amber-500", "bg-fuchsia-500", "bg-teal-500", "bg-orange-500",
];
// Hash do nome → cor estável: o mesmo colaborador mantém a cor entre sessões.
const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "").join("") || "—";

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDataBR = (iso: string | null) =>
  iso ? new Date(iso + "T00:00").toLocaleDateString("pt-BR") : "—";
const fmtDataHoraBR = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
      })
    : "—";

// Dias até a próxima recarga. Negativo = atrasada, e o card marca em vermelho.
const diasAte = (iso: string | null) => {
  if (!iso) return null;
  const alvo = new Date(iso + "T00:00");
  if (isNaN(alvo.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
};

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

  const saveDays = (n: number) => {
    setDays(n);
    localStorage.setItem(DAYS_KEY, String(n));
  };

  const salvar = async () => {
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
    // proxima_recarga é sempre derivada de ultima_recarga + dias — nunca digitada.
    const { error } = editingId
      ? await supabase.from("recargas_celulares").update(payload).eq("id", editingId)
      : await supabase.from("recargas_celulares").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editingId ? "Atualizado" : "Criado");
    setOpen(false);
    setEditingId(null);
    setForm({ ...empty });
    load();
  };

  // Em card não cabe edição inline: o lápis abre o mesmo diálogo do "Novo",
  // já preenchido.
  const abrirEdicao = (r: Row) => {
    setEditingId(r.id);
    setForm({
      proprietario: r.proprietario || "",
      numero: r.numero || "",
      situacao: r.situacao || "Ativo",
      setor: r.setor || "",
      ultima_recarga: r.ultima_recarga || "",
      valor: r.valor != null ? String(r.valor) : "",
      verificado: r.verificado || "Não",
    });
    setOpen(true);
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Recargas <span className="text-muted-foreground">·</span> Celulares
          </h2>
          <p className="text-sm text-muted-foreground">
            Fila de solicitações dos colaboradores, por ordem de pedido
          </p>
        </div>
        {/* Cadastro de linha continua acessível aqui — a tela é uma só, sem abas. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setEditingId(null); setForm({ ...empty }); setOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Nova linha
          </Button>
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <Upload className="mr-1.5 h-4 w-4" /> Importar Excel
              <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={importExcel} />
            </label>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings2 className="mr-1.5 h-4 w-4" /> Próxima: {days}d
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <Label>Dias para próxima recarga</Label>
              <Input
                type="number"
                min={1}
                value={days}
                onChange={(e) => saveDays(Math.max(1, Number(e.target.value) || 1))}
              />
              <Button size="sm" className="w-full" onClick={recomputeAll}>
                Recalcular para todos
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <SolicitacoesKanban />



      <Dialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setEditingId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar celular" : "Novo celular"}</DialogTitle>
          </DialogHeader>
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
            <Button variant="outline" onClick={() => { setOpen(false); setEditingId(null); }}>Cancelar</Button>
            <Button onClick={salvar}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
