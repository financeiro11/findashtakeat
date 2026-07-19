import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { History, Search, RefreshCw, Loader2, Plus, ArrowRightLeft, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Lê o log append-only tarefas_log (preenchido pelo próprio app a cada ação num card).
// Se a tabela ainda não existir no banco, mostra um aviso em vez de quebrar.

interface LogRow {
  id: string;
  tarefa_id: string | null;
  tarefa_titulo: string | null;
  acao: string;
  descricao: string | null;
  usuario: string | null;
  usuario_id: string | null;
  created_at: string;
}

const ACAO_META: Record<string, { label: string; icon: any; cls: string }> = {
  criada: { label: "Criada", icon: Plus, cls: "bg-success/15 text-success" },
  movida: { label: "Movida", icon: ArrowRightLeft, cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  editada: { label: "Editada", icon: Pencil, cls: "bg-warning/15 text-warning" },
  excluida: { label: "Excluída", icon: Trash2, cls: "bg-destructive/15 text-destructive" },
};

const FILTROS = [
  { key: "", label: "Todas" },
  { key: "criada", label: "Criadas" },
  { key: "movida", label: "Movidas" },
  { key: "editada", label: "Editadas" },
  { key: "excluida", label: "Excluídas" },
];

function fmtDataHora(iso: string) {
  const d = new Date(iso);
  return {
    data: d.toLocaleDateString("pt-BR"),
    hora: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
}
function initials(name: string | null) {
  if (!name) return "—";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase();
}

export function HistoricoTarefas() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    const { data, error } = await supabase
      .from("tarefas_log" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      // 42P01 = tabela não existe ainda (migração não aplicada).
      setErro(
        (error as any).code === "42P01" || /does not exist|não existe/i.test(error.message)
          ? "tabela_ausente"
          : error.message,
      );
      setRows([]);
    } else {
      setRows((data as any as LogRow[]) ?? []);
    }
    setLoading(false);
  }, []);

  const deleteRow = async (id: string) => {
    if (!confirm("Tem certeza que quer apagar este registro?")) return;
    setDeleting(id);
    const { error } = await supabase.from("tarefas_log" as any).delete().eq("id", id);
    setDeleting(null);
    if (error) {
      toast.error(error.message);
    } else {
      setRows(rows => rows.filter(r => r.id !== id));
      toast.success("Registro apagado");
    }
  };

  const deleteAll = async () => {
    if (!confirm("Apagar TODO o histórico? Esta ação não pode ser desfeita.")) return;
    setDeleting("all");
    const { error } = await supabase.from("tarefas_log" as any).delete().neq("id", "");
    setDeleting(null);
    if (error) {
      toast.error(error.message);
    } else {
      setRows([]);
      toast.success("Histórico apagado completamente");
    }
  };

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro && r.acao !== filtro) return false;
      if (q) {
        const hay = `${r.tarefa_titulo ?? ""} ${r.descricao ?? ""} ${r.usuario ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, filtro]);

  return (
    <Card className="overflow-hidden border-border">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-[13.5px] font-semibold">Histórico de alterações</span>
          <span className="num text-[11px] text-muted-foreground">· {filtered.length}</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por card, usuário ou alteração..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-72 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                filtro === f.key ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={load}
            disabled={loading || deleting === "all"}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Atualizar
          </button>
          <button
            onClick={deleteAll}
            disabled={loading || rows.length === 0 || deleting !== null}
            className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-[11.5px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
            title="Apagar todo o histórico"
          >
            {deleting === "all" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Apagar Tudo
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}
        </div>
      ) : erro === "tabela_ausente" ? (
        <div className="p-10 text-center">
          <div className="text-[13px] font-medium text-foreground">Histórico ainda não está ativo</div>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
            A tabela de log precisa ser criada no banco (migração <span className="num">tarefas_log</span>).
            Depois de aplicá-la, toda movimentação nos cards passa a ser registrada aqui automaticamente.
          </p>
        </div>
      ) : erro ? (
        <div className="p-10 text-center text-[13px] text-destructive">Erro ao carregar: {erro}</div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-muted-foreground">
          {rows.length === 0 ? "Nenhuma movimentação registrada ainda." : "Nada encontrado com esse filtro."}
        </div>
      ) : (
        <div className="overflow-auto max-h-[calc(100vh-220px)]">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                <TableHead className="w-[150px] text-[10px] font-bold uppercase tracking-wider">Data / hora</TableHead>
                <TableHead className="w-[150px] text-[10px] font-bold uppercase tracking-wider">Usuário</TableHead>
                <TableHead className="w-[110px] text-[10px] font-bold uppercase tracking-wider">Ação</TableHead>
                <TableHead className="w-[240px] text-[10px] font-bold uppercase tracking-wider">Card</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-wider">Alteração</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const dt = fmtDataHora(r.created_at);
                const meta = ACAO_META[r.acao] ?? { label: r.acao, icon: Pencil, cls: "bg-muted text-muted-foreground" };
                const Icon = meta.icon;
                return (
                  <TableRow key={r.id} className="text-xs">
                    <TableCell className="num text-muted-foreground">
                      <span className="text-foreground">{dt.data}</span> <span className="text-muted-foreground">{dt.hora}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">
                          {initials(r.usuario)}
                        </span>
                        <span className="truncate">{r.usuario || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", meta.cls)}>
                        <Icon className="h-2.5 w-2.5" /> {meta.label}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="line-clamp-1">{r.tarefa_titulo || "—"}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.descricao || "—"}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => deleteRow(r.id)}
                        disabled={deleting === r.id}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        title="Apagar este registro"
                      >
                        {deleting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
