import { useEffect, useMemo, useState } from "react";
import {
  Plus, Trash2, Pencil, Save, X, Search, SlidersHorizontal,
  Users, Building2, Briefcase, Wallet, Truck, ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Row = Record<string, any>;
type FieldType = "text" | "textarea" | "select" | "tags" | "date";
type Field = {
  key: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  refTable?: keyof typeof TABLES;
  refLabel?: string;
};

const TABLES = {
  lib_colaboradores: "Colaboradores",
  lib_departamentos: "Departamentos",
  lib_cargos: "Cargos",
  lib_centros_custo: "Centros de Custo",
  lib_fornecedores: "Fornecedores",
  lib_politicas: "Políticas",
} as const;

const TAB_ICONS: Record<keyof typeof TABLES, any> = {
  lib_colaboradores: Users,
  lib_departamentos: Building2,
  lib_cargos: Briefcase,
  lib_centros_custo: Wallet,
  lib_fornecedores: Truck,
  lib_politicas: ScrollText,
};

const SINGULAR: Record<keyof typeof TABLES, string> = {
  lib_colaboradores: "colaborador",
  lib_departamentos: "departamento",
  lib_cargos: "cargo",
  lib_centros_custo: "centro de custo",
  lib_fornecedores: "fornecedor",
  lib_politicas: "política",
};

const FIELDS_BY_TABLE: Record<keyof typeof TABLES, Field[]> = {
  lib_colaboradores: [
    { key: "nome", label: "Nome" },
    { key: "email", label: "E-mail" },
    { key: "telefone", label: "Telefone" },
    { key: "cargo_id", label: "Cargo", type: "select", refTable: "lib_cargos", refLabel: "nome" },
    { key: "departamento_id", label: "Departamento", type: "select", refTable: "lib_departamentos", refLabel: "nome" },
    { key: "centro_custo_id", label: "Centro de custo", type: "select", refTable: "lib_centros_custo", refLabel: "nome" },
    { key: "gestor_id", label: "Gestor", type: "select", refTable: "lib_colaboradores", refLabel: "nome" },
    { key: "data_admissao", label: "Admissão", type: "date" },
    {
      key: "status", label: "Status", type: "select",
      options: [{ value: "ativo", label: "Ativo" }, { value: "inativo", label: "Inativo" }, { value: "afastado", label: "Afastado" }],
    },
    { key: "tags", label: "Tags", type: "tags" },
    { key: "observacao", label: "Observação", type: "textarea" },
  ],
  lib_departamentos: [
    { key: "nome", label: "Nome" },
    { key: "descricao", label: "Descrição", type: "textarea" },
    { key: "gestor_id", label: "Gestor", type: "select", refTable: "lib_colaboradores", refLabel: "nome" },
  ],
  lib_cargos: [
    { key: "nome", label: "Nome" },
    { key: "descricao", label: "Descrição", type: "textarea" },
  ],
  lib_centros_custo: [
    { key: "codigo", label: "Código" },
    { key: "nome", label: "Nome" },
    { key: "descricao", label: "Descrição", type: "textarea" },
  ],
  lib_fornecedores: [
    { key: "nome", label: "Nome" },
    { key: "documento", label: "CNPJ/CPF" },
    { key: "categoria", label: "Categoria" },
    { key: "contato_nome", label: "Contato (nome)" },
    { key: "contato_email", label: "Contato (e-mail)" },
    { key: "contato_telefone", label: "Contato (telefone)" },
    {
      key: "status", label: "Status", type: "select",
      options: [{ value: "ativo", label: "Ativo" }, { value: "inativo", label: "Inativo" }],
    },
    { key: "tags", label: "Tags", type: "tags" },
    { key: "observacao", label: "Observação", type: "textarea" },
  ],
  lib_politicas: [
    { key: "titulo", label: "Título" },
    { key: "categoria", label: "Categoria" },
    { key: "conteudo", label: "Conteúdo", type: "textarea" },
    { key: "aplica_a", label: "Aplica a (tags)", type: "tags" },
    { key: "tags", label: "Tags", type: "tags" },
  ],
};

/* --------- helpers visuais --------- */
const norm = (s: string) =>
  (s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(nome: string) {
  const parts = (nome || "").trim().split(/\s+/);
  const first = parts[0]?.[0] || "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function Avatar({ nome }: { nome: string }) {
  const hue = hashHue(nome || "x");
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: `hsl(${hue} 55% 45%)` }}
    >
      {initials(nome)}
    </div>
  );
}

function ColoredChip({ label }: { label: string }) {
  if (!label) return <span className="text-xs text-muted-foreground">—</span>;
  const hue = hashHue(label);
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: `hsl(${hue} 75% 94%)`,
        color: `hsl(${hue} 60% 30%)`,
      }}
    >
      {label}
    </span>
  );
}

function StatusDot({ status }: { status?: string }) {
  const s = (status || "ativo").toLowerCase();
  const color =
    s === "ativo" ? "bg-emerald-500"
      : s === "afastado" ? "bg-amber-500"
        : "bg-muted-foreground/40";
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}

function TagBadge({ tag }: { tag: string }) {
  const t = norm(tag);
  const map: Record<string, string> = {
    pj: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    clt: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
    estagio: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    estagiario: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    socio: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    diretor: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  };
  const cls = map[t] || "bg-muted text-foreground/70";
  return <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium", cls)}>{tag}</span>;
}

/* --------- contadores por tabela --------- */
function useCounts() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    (async () => {
      const out: Record<string, number> = {};
      await Promise.all(
        (Object.keys(TABLES) as (keyof typeof TABLES)[]).map(async (t) => {
          const { count } = await supabase.from(t as any).select("*", { count: "exact", head: true });
          out[t] = count || 0;
        }),
      );
      setCounts(out);
    })();
  }, []);
  const refresh = async (t: keyof typeof TABLES) => {
    const { count } = await supabase.from(t as any).select("*", { count: "exact", head: true });
    setCounts((c) => ({ ...c, [t]: count || 0 }));
  };
  return { counts, refresh };
}

/* ============================================================
 *  Componente principal
 * ============================================================ */
export default function LibEntidades() {
  const [tab, setTab] = useState<keyof typeof TABLES>("lib_colaboradores");
  const { counts, refresh } = useCounts();

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-4">
      <TabsList className="h-auto flex-wrap gap-1 bg-muted/40 p-1">
        {(Object.entries(TABLES) as [keyof typeof TABLES, string][]).map(([k, label]) => {
          const Icon = TAB_ICONS[k];
          const c = counts[k];
          return (
            <TabsTrigger key={k} value={k} className="gap-1.5 text-xs">
              <Icon className="h-3.5 w-3.5" />
              {label}
              {c != null && (
                <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground data-[state=active]:bg-primary/10">
                  {c}
                </span>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {(Object.keys(TABLES) as (keyof typeof TABLES)[]).map((t) => (
        <TabsContent key={t} value={t}>
          <EntityCRUD
            table={t}
            singular={SINGULAR[t]}
            fields={FIELDS_BY_TABLE[t]}
            onChanged={() => refresh(t)}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

/* ============================================================
 *  CRUD por entidade
 * ============================================================ */
function EntityCRUD({
  table, singular, fields, onChanged,
}: {
  table: keyof typeof TABLES;
  singular: string;
  fields: Field[];
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [refs, setRefs] = useState<Record<string, Row[]>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroDep, setFiltroDep] = useState<string>("todos");
  const [filtroTag, setFiltroTag] = useState<string>("todas");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from(table as any).select("*").order("nome", { ascending: true });
    if (error) toast.error(error.message);
    else setRows((data as any) || []);
    setLoading(false);
  };

  const loadRefs = async () => {
    const need = new Set(fields.filter((f) => f.refTable).map((f) => f.refTable as string));
    const out: Record<string, Row[]> = {};
    await Promise.all(
      Array.from(need).map(async (t) => {
        const { data } = await supabase.from(t as any).select("id,nome,codigo").order("nome");
        out[t] = (data as any) || [];
      }),
    );
    setRefs(out);
  };

  useEffect(() => { load(); loadRefs(); /* eslint-disable-next-line */ }, [table]);

  const refLabel = (refTable: string, id: string | null) => {
    if (!id) return "";
    const r = refs[refTable]?.find((x) => x.id === id);
    return r?.nome || "";
  };

  /* KPIs específicos */
  const kpis = useMemo(() => {
    if (table === "lib_colaboradores") {
      const total = rows.length;
      const ativos = rows.filter((r) => (r.status || "ativo") === "ativo").length;
      const desligados = rows.filter((r) => r.status === "inativo").length;
      const tagCount = (t: string) =>
        rows.filter((r) => Array.isArray(r.tags) && r.tags.some((x: string) => norm(x) === t)).length;
      return [
        { label: "Total", value: total, accent: "text-foreground" },
        { label: "Ativos", value: ativos, accent: "text-emerald-600" },
        { label: "PJ", value: tagCount("pj"), accent: "text-blue-600" },
        { label: "CLT", value: tagCount("clt"), accent: "text-cyan-600" },
        { label: "Estágio", value: tagCount("estagio") + tagCount("estagiario"), accent: "text-violet-600" },
        { label: "Desligados", value: desligados, accent: "text-rose-600" },
      ];
    }
    if (table === "lib_fornecedores") {
      const total = rows.length;
      const ativos = rows.filter((r) => (r.status || "ativo") === "ativo").length;
      const cats = new Set(rows.map((r) => r.categoria).filter(Boolean));
      return [
        { label: "Total", value: total, accent: "text-foreground" },
        { label: "Ativos", value: ativos, accent: "text-emerald-600" },
        { label: "Categorias", value: cats.size, accent: "text-blue-600" },
      ];
    }
    return [{ label: "Total", value: rows.length, accent: "text-foreground" }];
  }, [rows, table]);

  /* opções de filtros */
  const depOptions = useMemo(() => {
    if (table !== "lib_colaboradores") return [];
    return refs["lib_departamentos"] || [];
  }, [refs, table]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (Array.isArray(r.tags)) for (const t of r.tags) set.add(t);
    return Array.from(set).sort();
  }, [rows]);

  /* filtragem */
  const filtered = useMemo(() => {
    const q = norm(busca);
    return rows.filter((r) => {
      if (filtroStatus !== "todos" && (r.status || "ativo") !== filtroStatus) return false;
      if (table === "lib_colaboradores" && filtroDep !== "todos" && r.departamento_id !== filtroDep) return false;
      if (filtroTag !== "todas" && !(Array.isArray(r.tags) && r.tags.includes(filtroTag))) return false;
      if (!q) return true;
      const hay = [
        r.nome, r.titulo, r.email, r.documento, r.telefone, r.categoria, r.codigo,
        refLabel("lib_departamentos", r.departamento_id),
        refLabel("lib_cargos", r.cargo_id),
        refLabel("lib_centros_custo", r.centro_custo_id),
      ].join(" ");
      return norm(hay).includes(q);
    });
  }, [rows, busca, filtroStatus, filtroDep, filtroTag, refs, table]);

  /* save / delete */
  const save = async (data: Row) => {
    const payload: Row = {};
    for (const f of fields) {
      const v = data[f.key];
      payload[f.key] = v === "" || v === undefined ? null : v;
    }
    if (data.id) {
      const { error } = await supabase.from(table as any).update(payload).eq("id", data.id);
      if (error) return toast.error(error.message);
      toast.success("Atualizado");
    } else {
      const { error } = await supabase.from(table as any).insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Adicionado");
    }
    setEditing(null);
    load(); loadRefs(); onChanged?.();
  };

  const remove = async (id: string) => {
    if (!confirm(`Excluir ${singular}?`)) return;
    const { error } = await supabase.from(table as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removido"); load(); loadRefs(); onChanged?.(); }
  };

  const hasStatus = fields.some((f) => f.key === "status");

  return (
    <div className="space-y-4">
      {/* descrição */}
      <p className="text-xs text-muted-foreground">
        {table === "lib_colaboradores" && "Pessoas da empresa — quem trabalha, em qual área e com qual vínculo."}
        {table === "lib_departamentos" && "Áreas funcionais que organizam a empresa."}
        {table === "lib_cargos" && "Funções formais usadas em contratos e estrutura."}
        {table === "lib_centros_custo" && "Códigos para alocar despesas e investimentos."}
        {table === "lib_fornecedores" && "Empresas e prestadores recorrentes."}
        {table === "lib_politicas" && "Regras internas que a IA segue ao analisar dados."}
      </p>

      {/* barra: busca + filtro + novo */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder={`Buscar ${singular}, departamento, e-mail…`}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filtrar
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            {hasStatus && (
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="ativo">Ativos</SelectItem>
                    <SelectItem value="afastado">Afastados</SelectItem>
                    <SelectItem value="inativo">Inativos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {table === "lib_colaboradores" && (
              <div className="space-y-1">
                <Label className="text-xs">Departamento</Label>
                <Select value={filtroDep} onValueChange={setFiltroDep}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {depOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {tagOptions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Tag</Label>
                <Select value={filtroTag} onValueChange={setFiltroTag}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    {tagOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              variant="ghost" size="sm" className="w-full"
              onClick={() => { setFiltroStatus("todos"); setFiltroDep("todos"); setFiltroTag("todas"); }}
            >
              Limpar filtros
            </Button>
          </PopoverContent>
        </Popover>

        <Button size="sm" className="h-9 gap-1.5" onClick={() => setEditing({})}>
          <Plus className="h-3.5 w-3.5" />
          Novo {singular}
        </Button>
      </div>

      {/* KPIs */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 md:grid-cols-6">
          {kpis.map((k) => (
            <div key={k.label}>
              <div className={cn("text-2xl font-bold tracking-tight", k.accent)}>{k.value}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* tabela */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !filtered.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum registro.</div>
        ) : (
          <EntityTable
            table={table}
            rows={filtered}
            refs={refs}
            onEdit={(r) => setEditing(r)}
            onDelete={remove}
          />
        )}
      </Card>

      {/* dialog de edição/criação */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? `Editar ${singular}` : `Novo ${singular}`}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <EntityForm
              fields={fields}
              refs={refs}
              initial={editing}
              onCancel={() => setEditing(null)}
              onSave={save}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================================================
 *  Tabela por entidade
 * ============================================================ */
function EntityTable({
  table, rows, refs, onEdit, onDelete,
}: {
  table: keyof typeof TABLES;
  rows: Row[];
  refs: Record<string, Row[]>;
  onEdit: (r: Row) => void;
  onDelete: (id: string) => void;
}) {
  const refLabel = (t: string, id: string | null) =>
    !id ? "" : refs[t]?.find((x) => x.id === id)?.nome || "";

  const fmtDate = (d?: string) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("pt-BR");
  };

  /* Colaboradores: layout rico tipo CRM */
  if (table === "lib_colaboradores") {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[10px] uppercase tracking-wider">Colaborador</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">Contato</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">Departamento</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">Admissão</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">Tags</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="group">
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar nome={r.nome || ""} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.nome || "—"}</div>
                    <StatusDot status={r.status} />
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-xs">
                {r.email ? <div className="truncate">{r.email}</div> : <span className="text-muted-foreground">—</span>}
                {r.telefone && <div className="text-muted-foreground">{r.telefone}</div>}
              </TableCell>
              <TableCell><ColoredChip label={refLabel("lib_departamentos", r.departamento_id)} /></TableCell>
              <TableCell className="text-xs">{fmtDate(r.data_admissao)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {(Array.isArray(r.tags) ? r.tags : []).map((t: string) => <TagBadge key={t} tag={t} />)}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(r)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDelete(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  /* Fornecedores */
  if (table === "lib_fornecedores") {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[10px] uppercase tracking-wider">Fornecedor</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">Categoria</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">Documento</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">Contato</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">Tags</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="group">
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar nome={r.nome || ""} />
                  <div>
                    <div className="text-sm font-medium">{r.nome}</div>
                    <StatusDot status={r.status} />
                  </div>
                </div>
              </TableCell>
              <TableCell><ColoredChip label={r.categoria} /></TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.documento || "—"}</TableCell>
              <TableCell className="text-xs">
                {r.contato_nome && <div>{r.contato_nome}</div>}
                {r.contato_email && <div className="text-muted-foreground">{r.contato_email}</div>}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {(Array.isArray(r.tags) ? r.tags : []).map((t: string) => <TagBadge key={t} tag={t} />)}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(r)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDelete(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  /* Departamentos / Cargos / Centros de Custo / Políticas — tabela genérica */
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {table === "lib_centros_custo" && <TableHead className="w-24 text-[10px] uppercase tracking-wider">Código</TableHead>}
          <TableHead className="text-[10px] uppercase tracking-wider">
            {table === "lib_politicas" ? "Título" : "Nome"}
          </TableHead>
          {table === "lib_politicas" && <TableHead className="text-[10px] uppercase tracking-wider">Categoria</TableHead>}
          <TableHead className="text-[10px] uppercase tracking-wider">
            {table === "lib_politicas" ? "Conteúdo" : "Descrição"}
          </TableHead>
          {table === "lib_departamentos" && <TableHead className="text-[10px] uppercase tracking-wider">Gestor</TableHead>}
          <TableHead className="w-20" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="group">
            {table === "lib_centros_custo" && (
              <TableCell className="font-mono text-xs">{r.codigo || "—"}</TableCell>
            )}
            <TableCell className="text-sm font-medium">{r.nome || r.titulo || "—"}</TableCell>
            {table === "lib_politicas" && (
              <TableCell><ColoredChip label={r.categoria} /></TableCell>
            )}
            <TableCell className="max-w-md truncate text-xs text-muted-foreground">
              {r.descricao || r.conteudo || "—"}
            </TableCell>
            {table === "lib_departamentos" && (
              <TableCell className="text-xs">{refLabel("lib_colaboradores", r.gestor_id) || "—"}</TableCell>
            )}
            <TableCell className="text-right">
              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(r)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDelete(r.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ============================================================
 *  Formulário (dialog)
 * ============================================================ */
function EntityForm({
  fields, refs, initial, onCancel, onSave,
}: {
  fields: Field[];
  refs: Record<string, Row[]>;
  initial: Row;
  onCancel: () => void;
  onSave: (d: Row) => void;
}) {
  const [val, setVal] = useState<Row>({ ...initial });
  const upd = (k: string, v: any) => setVal((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((f) => {
          const v = val[f.key] ?? "";
          if (f.type === "textarea") return null;
          if (f.type === "select") {
            const opts = f.refTable
              ? (refs[f.refTable] || []).map((r) => ({ value: r.id, label: r.nome }))
              : (f.options || []);
            return (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Select value={v || "__none__"} onValueChange={(x) => upd(f.key, x === "__none__" ? null : x)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          if (f.type === "tags") {
            const arr: string[] = Array.isArray(v) ? v : (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : []);
            return (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label} <span className="text-muted-foreground">(separadas por vírgula)</span></Label>
                <Input
                  className="h-9 text-sm"
                  value={arr.join(", ")}
                  onChange={(e) => upd(f.key, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                />
              </div>
            );
          }
          return (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type={f.type === "date" ? "date" : "text"}
                className="h-9 text-sm"
                value={v || ""}
                onChange={(e) => upd(f.key, e.target.value)}
              />
            </div>
          );
        })}
      </div>
      {fields.filter((f) => f.type === "textarea").map((f) => (
        <div key={f.key} className="space-y-1">
          <Label className="text-xs">{f.label}</Label>
          <Textarea
            rows={4}
            className="text-sm"
            value={val[f.key] || ""}
            onChange={(e) => upd(f.key, e.target.value)}
          />
        </div>
      ))}
      <DialogFooter className="pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" /> Cancelar
        </Button>
        <Button size="sm" onClick={() => onSave(val)}>
          <Save className="mr-1 h-3.5 w-3.5" /> Salvar
        </Button>
      </DialogFooter>
    </div>
  );
}
