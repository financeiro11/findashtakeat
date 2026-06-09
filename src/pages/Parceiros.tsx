import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Search, Plus, Download, ExternalLink, Filter, Upload, RefreshCw, GripVertical, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, History } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { GestaoParceirosDialog } from "./parceiros/GestaoParceirosDialog";
import { NaoCadastradoDialog } from "./parceiros/NaoCadastradoDialog";
import { EditarCampanhaDialog, type EditarCampanhaTarget } from "./parceiros/EditarCampanhaDialog";
import { HistoricoCampanhaSheet, type HistoricoTarget } from "./parceiros/HistoricoCampanhaSheet";

/* ─────────────────────────── Tipos ─────────────────────────── */

type Parceiro = {
  id: string;
  id_negocio: string;
  campanha: string;
  embaixador: string;
  vendedor: string;
  empresa: string;
  mrr: number;
  valorTotal: number;
  dataIndicacao: string | null;
  dataVenda: string | null;
  hubspotUrl: string;
  asaasUrl: string;
  bonificacaoVenda?: number | null;
  embaixadorStatus?: "ativo" | "inativo" | "nao_cadastrado";
  campanhaCadastrada?: string | null;
};

/* ─────────────────────────── Helpers ─────────────────────────── */

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const hubspotUrlFor = (idNegocio: string) =>
  idNegocio ? `https://app.hubspot.com/contacts/0/deal/${idNegocio}` : "";

const asaasUrlFor = (idNegocio: string) =>
  idNegocio ? `https://www.asaas.com/customers/show/${idNegocio}` : "";

/* ─────────────────────────── Logos ─────────────────────────── */

function HubspotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.164 7.93V5.084a2.198 2.198 0 1 0-1.708 0V7.93a6.225 6.225 0 0 0-2.96 1.302L5.683 3.117l.058-.197a1.76 1.76 0 1 0-.85.62l.04.013 7.62 5.928a6.244 6.244 0 0 0 .096 7.04l-2.317 2.318a2.016 2.016 0 0 0-.581-.094 2.04 2.04 0 1 0 2.04 2.04 2.02 2.02 0 0 0-.094-.581l2.293-2.293a6.252 6.252 0 1 0 4.176-10.98zm-.85 9.39a3.205 3.205 0 1 1 3.204-3.205 3.205 3.205 0 0 1-3.204 3.204z"/>
    </svg>
  );
}

function AsaasIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2 2 22h4.2l1.6-3.4h8.4L17.8 22H22L12 2zm-2.7 12.8L12 9.1l2.7 5.7H9.3z"/>
    </svg>
  );
}

/* ─────────────────────────── Colunas ─────────────────────────── */

type ColKey = "campanha" | "embaixador" | "vendedor" | "empresa" | "mrr" | "valorTotal" | "bonificacao" | "dataIndicacao" | "dataVenda" | "hubspot" | "asaas";

type SortState = { key: string; dir: "asc" | "desc" } | null;

const cmpVal = (a: any, b: any) => {
  const aNil = a === null || a === undefined || a === "";
  const bNil = b === null || b === undefined || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
};

const sortArr = <T,>(arr: T[], accessor: (r: T) => any, dir: "asc" | "desc") => {
  const out = [...arr];
  out.sort((a, b) => {
    const r = cmpVal(accessor(a), accessor(b));
    return dir === "asc" ? r : -r;
  });
  return out;
};

const toggleSort = (prev: SortState, key: string): SortState => {
  if (prev?.key !== key) return { key, dir: "asc" };
  if (prev.dir === "asc") return { key, dir: "desc" };
  return null;
};

const COLUMNS: Record<ColKey, {
  label: string;
  headClass?: string;
  cellClass?: string;
  render: (r: Parceiro) => React.ReactNode;
  sortValue?: (r: Parceiro) => any;
}> = {
  campanha: { label: "Campanha", sortValue: (r) => r.campanha, render: (r) => <span className="font-medium text-foreground">{r.campanha || "—"}</span> },
  embaixador: {
    label: "Embaixador",
    sortValue: (r) => r.embaixador,
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <span>{r.embaixador || "—"}</span>
        {r.embaixadorStatus === "nao_cadastrado" && r.embaixador && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="inline-flex items-center justify-center rounded-full text-amber-600 dark:text-amber-400 hover:text-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-500/40" aria-label="Embaixador não cadastrado">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-[11.5px]">
                Embaixador não cadastrado na Gestão de Parceiros.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {r.embaixadorStatus === "ativo" && (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-normal h-4 px-1.5">Ativo</Badge>
        )}
        {r.embaixadorStatus === "inativo" && (
          <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 text-[10px] font-normal h-4 px-1.5">Inativo</Badge>
        )}
      </span>
    ),
  },
  vendedor: { label: "Vendedor", sortValue: (r) => r.vendedor, render: (r) => r.vendedor || "—" },
  empresa: { label: "Empresa", sortValue: (r) => r.empresa, render: (r) => r.empresa || "—" },
  mrr: { label: "MRR", headClass: "text-right", cellClass: "text-right tabular-nums", sortValue: (r) => r.mrr, render: (r) => BRL(r.mrr) },
  valorTotal: { label: "Valor total", headClass: "text-right", cellClass: "text-right tabular-nums font-medium", sortValue: (r) => r.valorTotal, render: (r) => BRL(r.valorTotal) },
  bonificacao: { label: "Bonificação", headClass: "text-right", cellClass: "text-right tabular-nums", sortValue: (r) => r.bonificacaoVenda ?? null, render: (r) => r.bonificacaoVenda != null ? BRL(r.bonificacaoVenda) : <span className="text-muted-foreground">—</span> },
  dataIndicacao: { label: "Data indicação", cellClass: "tabular-nums text-muted-foreground", sortValue: (r) => r.dataIndicacao, render: (r) => fmtDate(r.dataIndicacao) },
  dataVenda: {
    label: "Data venda",
    cellClass: "tabular-nums",
    sortValue: (r) => r.dataVenda,
    render: (r) => r.dataVenda
      ? <span className="text-foreground">{fmtDate(r.dataVenda)}</span>
      : <Badge variant="outline" className="text-[10.5px] font-normal">Aguardando</Badge>,
  },
  hubspot: {
    label: "HubSpot", headClass: "text-center", cellClass: "text-center",
    render: (r) => (
      <IntegrationLink href={r.hubspotUrl} label="HubSpot" tone="hubspot">
        <HubspotIcon className="h-3.5 w-3.5" />
      </IntegrationLink>
    ),
  },
  asaas: {
    label: "Asaas", headClass: "text-center", cellClass: "text-center",
    render: (r) => (
      <IntegrationLink href={r.asaasUrl} label="Asaas" tone="asaas">
        <AsaasIcon className="h-3.5 w-3.5" />
      </IntegrationLink>
    ),
  },
};

const DEFAULT_COL_ORDER: ColKey[] = ["campanha","embaixador","vendedor","empresa","mrr","valorTotal","bonificacao","dataIndicacao","dataVenda","hubspot","asaas"];
const COL_ORDER_STORAGE_KEY = "parceiros:colOrder:v1";


const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

type MappingField = { key: string; label: string; column: string; match: string[]; type?: "number" | "date" | "bool"; required?: boolean };

const MAPPING_FIELDS: MappingField[] = [
  { key: "id_negocio", label: "ID do Negócio *", column: "id_negocio", match: ["id_negocio", "id negocio", "deal"], required: true },
  { key: "id_campanha", label: "ID da Campanha", column: "id_campanha", match: ["id_campanha", "id campanha"] },
  { key: "campanha", label: "Campanha", column: "nome_campanha", match: ["nome_campanha", "campanha"] },
  { key: "embaixador", label: "Embaixador / Indicador", column: "indicador", match: ["embaixador", "indicador"] },
  { key: "email_indicador", label: "E-mail do Indicador", column: "email_indicador", match: ["email_indicador", "email"] },
  { key: "vendedor", label: "Vendedor", column: "vendedor", match: ["vendedor"] },
  { key: "codigo_indicacao", label: "Código de Indicação", column: "codigo_indicacao", match: ["codigo_indicacao", "codigo", "código"] },
  { key: "empresa", label: "Empresa / Negócio", column: "nome_negocio", match: ["nome_negocio", "empresa", "negocio"] },
  { key: "mrr", label: "MRR", column: "mrr", match: ["mrr"], type: "number" },
  { key: "valorTotal", label: "Valor total", column: "valor_total", match: ["valor_total", "valor total", "valortotal", "total"], type: "number" },
  { key: "dataIndicacao", label: "Data indicação", column: "data_indicacao", match: ["data_indicacao", "indicac"], type: "date" },
  { key: "dataVenda", label: "Data venda", column: "data_venda", match: ["data_venda", "venda"], type: "date" },
  { key: "canal_aquisicao", label: "Canal de aquisição", column: "canal_aquisicao", match: ["canal"] },
  { key: "origem", label: "Origem", column: "origem", match: ["origem"] },
  { key: "hubspot", label: "URL Hubspot", column: "hubspot_url", match: ["hubspot"] },
  { key: "asaas", label: "URL Asaas", column: "asaas_url", match: ["asaas"] },
];

const REC_MAPPING_FIELDS: MappingField[] = [
  { key: "id_negocio", label: "ID do Negócio *", column: "id_negocio", match: ["id_negocio", "id negocio", "deal"], required: true },
  { key: "id_campanha", label: "ID da Campanha", column: "id_campanha", match: ["id_campanha", "id campanha"] },
  { key: "campanha", label: "Campanha", column: "nome_campanha", match: ["nome_campanha", "campanha"] },
  { key: "embaixador", label: "Embaixador / Indicador", column: "indicador", match: ["embaixador", "indicador"] },
  { key: "email_indicador", label: "E-mail do Indicador", column: "email_indicador", match: ["email_indicador", "email"] },
  { key: "responsavel_takeat", label: "Responsável Takeat", column: "responsavel_takeat", match: ["responsavel", "takeat"] },
  { key: "empresa", label: "Empresa / Negócio", column: "nome_negocio", match: ["nome_negocio", "empresa", "negocio"] },
  { key: "mrr", label: "MRR", column: "mrr", match: ["mrr"], type: "number" },
  { key: "recorrencia_valor", label: "Recorrência (valor)", column: "recorrencia_valor", match: ["recorrencia", "recorrência"], type: "number" },
  { key: "dataIndicacao", label: "Data indicação", column: "data_indicacao", match: ["data_indicacao", "indicac"], type: "date" },
  { key: "dataVenda", label: "Data venda", column: "data_venda", match: ["data_venda", "venda"], type: "date" },
  { key: "ativo", label: "Status (ativo)", column: "ativo", match: ["ativo", "status"], type: "bool" },
  { key: "hubspot", label: "URL Hubspot", column: "hubspot_url", match: ["hubspot"] },
  { key: "asaas", label: "URL Asaas", column: "asaas_url", match: ["asaas"] },
];

/* ─────────────────────────── Página ─────────────────────────── */

export default function Parceiros() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Parceiro[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [columnOrder, setColumnOrder] = useState<ColKey[]>(() => {
    try {
      const saved = localStorage.getItem(COL_ORDER_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ColKey[];
        const valid = parsed.filter((k) => k in COLUMNS);
        const missing = DEFAULT_COL_ORDER.filter((k) => !valid.includes(k));
        return [...valid, ...missing];
      }
    } catch {}
    return DEFAULT_COL_ORDER;
  });
  const [dragCol, setDragCol] = useState<ColKey | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColKey | null>(null);
  const [cadastros, setCadastros] = useState<Array<{ nome: string; tier: string; status: string; campanha: string | null; bonificacao: boolean; metodo_bonificacao: string | null; valor_bonificacao: number | null; recorrencia: boolean; metodo_recorrencia: string | null; valor_recorrencia: number | null }>>([]);
  const [naoCadOpen, setNaoCadOpen] = useState(false);
  const [naoCadNome, setNaoCadNome] = useState("");
  const [editCampOpen, setEditCampOpen] = useState(false);
  const [editCampTarget, setEditCampTarget] = useState<EditarCampanhaTarget | null>(null);

  const openNaoCadastrado = (nome: string) => { setNaoCadNome(nome); setNaoCadOpen(true); };
  const openEditCampanha = (t: EditarCampanhaTarget) => { setEditCampTarget(t); setEditCampOpen(true); };
  const [histOpen, setHistOpen] = useState(false);
  const [histTarget, setHistTarget] = useState<HistoricoTarget | null>(null);
  const openHistorico = (t: HistoricoTarget) => { setHistTarget(t); setHistOpen(true); };
  const [embFilter, setEmbFilter] = useState<Set<string>>(new Set());
  const [campFilter, setCampFilter] = useState<Set<string>>(new Set());
  const [embOpen, setEmbOpen] = useState(false);
  const [campOpen, setCampOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importTarget, setImportTarget] = useState<"indicacoes" | "recorrencias">("indicacoes");
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);
  const [convPageSize, setConvPageSize] = useState<number>(25);
  const [convPage, setConvPage] = useState<number>(1);
  const [recPageSize, setRecPageSize] = useState<number>(25);
  const [recPage, setRecPage] = useState<number>(1);
  const [recRows, setRecRows] = useState<Array<{ id: string; id_negocio: string; campanha: string; embaixador: string; vendedor: string; empresa: string; mrr: number; recorrenciaValor: number; dataIndicacao: string | null; ativo: boolean; hubspotUrl: string; asaasUrl: string }>>([]);
  const [sortInd, setSortInd] = useState<SortState>(null);
  const [sortConv, setSortConv] = useState<SortState>(null);
  const [sortRec, setSortRec] = useState<SortState>(null);

  // Logs de edição (para mostrar ícone Histórico apenas quando houver)
  const [logKeys, setLogKeys] = useState<Set<string>>(new Set());
  const hasLog = (table: "parceiros_indicacoes" | "parceiros_recorrencias", id: string) =>
    logKeys.has(`${table}:${id}`);

  // Filtros avançados por lista
  type FiltInd = { campanhaDivergente: boolean; embStatus: Set<string>; comHistorico: boolean };
  type FiltConv = { tier: Set<string>; campanha: Set<string>; recorrencia: "todos" | "sim" | "nao"; bonificacao: "todos" | "sim" | "nao"; naoCadastrados: boolean; comHistorico: boolean };
  const [filtInd, setFiltInd] = useState<FiltInd>({ campanhaDivergente: false, embStatus: new Set(), comHistorico: false });
  const [filtConv, setFiltConv] = useState<FiltConv>({ tier: new Set(), campanha: new Set(), recorrencia: "todos", bonificacao: "todos", naoCadastrados: false, comHistorico: false });
  type FiltRec = { status: Set<string>; campanhaDivergente: boolean; embaixadorNaoCadastrado: boolean; comHistorico: boolean };
  const [filtRec, setFiltRec] = useState<FiltRec>({ status: new Set(), campanhaDivergente: false, embaixadorNaoCadastrado: false, comHistorico: false });
  const filtIndCount = (filtInd.campanhaDivergente ? 1 : 0) + (filtInd.embStatus.size > 0 ? 1 : 0) + (filtInd.comHistorico ? 1 : 0);
  const filtConvCount = (filtConv.tier.size > 0 ? 1 : 0) + (filtConv.campanha.size > 0 ? 1 : 0) + (filtConv.recorrencia !== "todos" ? 1 : 0) + (filtConv.bonificacao !== "todos" ? 1 : 0) + (filtConv.naoCadastrados ? 1 : 0) + (filtConv.comHistorico ? 1 : 0);
  const filtRecCount = (filtRec.status.size > 0 ? 1 : 0) + (filtRec.campanhaDivergente ? 1 : 0) + (filtRec.embaixadorNaoCadastrado ? 1 : 0) + (filtRec.comHistorico ? 1 : 0);
  const filtTotalCount = filtIndCount + filtConvCount + filtRecCount;

  useEffect(() => {
    try { localStorage.setItem(COL_ORDER_STORAGE_KEY, JSON.stringify(columnOrder)); } catch {}
  }, [columnOrder]);

  const handleDropCol = (target: ColKey) => {
    if (!dragCol || dragCol === target) { setDragCol(null); setDragOverCol(null); return; }
    setColumnOrder((prev) => {
      const next = prev.filter((c) => c !== dragCol);
      const idx = next.indexOf(target);
      next.splice(idx, 0, dragCol);
      return next;
    });
    setDragCol(null);
    setDragOverCol(null);
  };



  const loadRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("parceiros_indicacoes")
      .select("*")
      .order("data_indicacao", { ascending: false, nullsFirst: false });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const mapped: Parceiro[] = (data ?? []).map((r: any) => ({
      id: r.id,
      id_negocio: r.id_negocio ?? "",
      campanha: r.nome_campanha ?? "",
      embaixador: r.indicador ?? "",
      vendedor: r.vendedor ?? "",
      empresa: r.nome_negocio ?? "",
      mrr: Number(r.mrr ?? 0),
      valorTotal: Number(r.valor_total ?? 0),
      dataIndicacao: r.data_indicacao,
      dataVenda: r.data_venda,
      hubspotUrl: r.hubspot_url || hubspotUrlFor(r.id_negocio ?? ""),
      asaasUrl: r.asaas_url || asaasUrlFor(r.id_negocio ?? ""),
    }));
    setRows(mapped);
    setLoading(false);
  };

  useEffect(() => {
    loadRows();
    loadCadastros();
    loadRecorrencias();
    loadLogKeys();
  }, []);

  const loadLogKeys = async () => {
    const { data, error } = await supabase
      .from("parceiros_campanha_logs")
      .select("registro_tabela, registro_id");
    if (error) { console.error(error); return; }
    setLogKeys(new Set((data ?? []).map((l: any) => `${l.registro_tabela}:${l.registro_id}`)));
  };

  const loadCadastros = async () => {
    const { data, error } = await supabase.from("parceiros_cadastro").select("nome,tier,status,campanha,bonificacao,metodo_bonificacao,valor_bonificacao,recorrencia,metodo_recorrencia,valor_recorrencia");
    if (error) { console.error(error); return; }
    setCadastros((data ?? []) as any);
  };

  const loadRecorrencias = async () => {
    const { data, error } = await supabase
      .from("parceiros_recorrencias")
      .select("*")
      .order("data_indicacao", { ascending: false, nullsFirst: false });
    if (error) { console.error(error); return; }
    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      id_negocio: r.id_negocio ?? "",
      campanha: r.nome_campanha ?? "",
      embaixador: r.indicador ?? "",
      vendedor: r.responsavel_takeat ?? "",
      empresa: r.nome_negocio ?? "",
      mrr: Number(r.mrr ?? 0),
      recorrenciaValor: Number(r.recorrencia_valor ?? 0),
      dataIndicacao: r.data_indicacao,
      ativo: r.ativo !== false,
      hubspotUrl: r.hubspot_url || hubspotUrlFor(r.id_negocio ?? ""),
      asaasUrl: r.asaas_url || asaasUrlFor(r.id_negocio ?? ""),
    }));
    setRecRows(mapped);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("https://webhook.takeat.cloud/webhook/dash_parceiros", { method: "POST" });
      toast.success("Atualização solicitada");
      // Recarrega após pequeno delay para pegar dados sincronizados
      setTimeout(loadRows, 1500);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao chamar webhook");
    } finally {
      setRefreshing(false);
    }
  };

  const parseDateCell = (v: any): string | null => {
    if (v == null || v === "") return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "number") {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  const parseNumberCell = (v: any): number => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v;
    let s = String(v).trim().replace(/[R$\s]/g, "");
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const handleImportClick = (target: "indicacoes" | "recorrencias") => {
    setImportTarget(target);
    fileInputRef.current?.click();
  };

  const activeMappingFields = importTarget === "recorrencias" ? REC_MAPPING_FIELDS : MAPPING_FIELDS;

  const parseBoolCell = (v: any): boolean => {
    const s = String(v ?? "").trim().toLowerCase();
    return ["true", "1", "sim", "yes", "y", "s", "verdadeiro", "ativo"].includes(s);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (data.length === 0) {
        toast.warning("Planilha vazia");
        return;
      }
      const headers = Object.keys(data[0]);
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const findHeader = (...needles: string[]) =>
        headers.find((h) => needles.some((n) => norm(h).includes(n))) || "";
      const auto: Record<string, string> = {};
      activeMappingFields.forEach((f) => { auto[f.key] = findHeader(...f.match); });
      setSheetHeaders(headers);
      setSheetRows(data);
      setMapping(auto);
      setMapOpen(true);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao ler planilha");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      const fields = activeMappingFields;
      const g = (r: any, key: string) => {
        const col = mapping[key];
        return col && col !== "__none__" ? r[col] : "";
      };
      const toInsert: any[] = [];
      let skipped = 0;
      sheetRows.forEach((r) => {
        const idNegocio = String(g(r, "id_negocio") ?? "").trim();
        if (!idNegocio) { skipped++; return; }
        const payload: Record<string, any> = { id_negocio: idNegocio };
        fields.forEach((f) => {
          if (f.key === "id_negocio") return;
          const col = mapping[f.key];
          if (!col || col === "__none__") return;
          const raw = r[col];
          if (raw == null || raw === "") return;
          if (f.type === "number") payload[f.column] = parseNumberCell(raw);
          else if (f.type === "date") payload[f.column] = parseDateCell(raw);
          else if (f.type === "bool") payload[f.column] = parseBoolCell(raw);
          else payload[f.column] = String(raw).trim() || null;
        });
        if (importTarget === "indicacoes" && !payload.origem) payload.origem = "import_planilha";
        toInsert.push(payload);
      });

      // Dedupe por id_negocio
      const byId = new Map<string, any>();
      toInsert.forEach((p) => byId.set(p.id_negocio, { ...byId.get(p.id_negocio), ...p }));
      const deduped = Array.from(byId.values());
      const duplicatesRemoved = toInsert.length - deduped.length;

      if (deduped.length === 0) {
        toast.warning("Nenhuma linha válida encontrada (ID do Negócio é obrigatório)");
        return;
      }

      if (importTarget === "indicacoes") {
        const { error } = await supabase
          .from("parceiros_indicacoes")
          .upsert(deduped, { onConflict: "id_negocio", ignoreDuplicates: false });
        if (error) throw error;
        toast.success(`${deduped.length} indicação(ões) importada(s)${skipped ? ` · ${skipped} sem ID` : ""}${duplicatesRemoved ? ` · ${duplicatesRemoved} duplicada(s) mescladas` : ""}`);
        await loadRows();
      } else {
        // Recorrências: substitui registros existentes por id_negocio (delete + insert)
        const ids = deduped.map((p) => p.id_negocio);
        await supabase.from("parceiros_recorrencias").delete().in("id_negocio", ids);
        const { error } = await supabase.from("parceiros_recorrencias").insert(deduped);
        if (error) throw error;
        toast.success(`${deduped.length} recorrência(s) importada(s)${skipped ? ` · ${skipped} sem ID` : ""}${duplicatesRemoved ? ` · ${duplicatesRemoved} duplicada(s) mescladas` : ""}`);
        await loadRecorrencias();
      }

      setMapOpen(false);
      setSheetRows([]);
      setSheetHeaders([]);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao importar");
    } finally {
      setImporting(false);
    }
  };

  const handleExport = (target: "indicacoes" | "conversoes" | "recorrencias") => {
    try {
      let rowsOut: any[] = [];
      let sheetName = "Dados";
      let fileName = "parceiros.xlsx";

      if (target === "indicacoes") {
        sheetName = "Indicações";
        fileName = "indicacoes.xlsx";
        rowsOut = filtered.map((r) => ({
          Campanha: r.campanha,
          Embaixador: r.embaixador,
          Vendedor: r.vendedor,
          Empresa: r.empresa,
          MRR: r.mrr,
          "Valor total": r.valorTotal,
          Bonificação: r.bonificacaoVenda ?? "",
          "Data indicação": r.dataIndicacao ?? "",
          "Data venda": r.dataVenda ?? "",
          HubSpot: r.hubspotUrl,
          Asaas: r.asaasUrl,
        }));
      } else if (target === "conversoes") {
        sheetName = "Conversões";
        fileName = "conversoes-embaixador.xlsx";
        rowsOut = conversoesFiltradas.map((c) => {
          const cad = cadastroByNome.get(c.nome.toLowerCase());
          const recTotal = recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0;
          const bonifFmt = cad?.bonificacao
            ? (cad.valor_bonificacao != null
                ? (cad.metodo_bonificacao === "%" ? `${cad.valor_bonificacao}%` : Number(cad.valor_bonificacao))
                : "Sim")
            : "Não";
          const recFmt = cad?.recorrencia
            ? (cad.valor_recorrencia != null
                ? (cad.metodo_recorrencia === "%" ? `${cad.valor_recorrencia}%` : Number(cad.valor_recorrencia))
                : "Sim")
            : "Não";
          return {
            Embaixador: c.nome,
            Tier: cad?.tier ?? "",
            Campanha: cad?.campanha ?? "",
            Bonificação: bonifFmt,
            Recorrência: recFmt,
            Indicações: c.indicacoes,
            Vendas: c.vendas,
            MRR: c.mrr,
            "Valor total": c.valorTotal,
            "Bonificação Total": c.bonificacaoTotal,
            "Recorrência Total": recTotal,
            "Bonificação + Recorrência": (c.bonificacaoTotal || 0) + recTotal,
          };
        });
      } else {
        sheetName = "Apuração Recorrências";
        fileName = "apuracao-recorrencias.xlsx";
        rowsOut = recorrencias.map((r) => ({
          Status: r.ativo ? "Ativo" : "Inativo",
          Campanha: r.campanha,
          Embaixador: r.embaixador,
          "Responsável Takeat": r.vendedor,
          Empresa: r.empresa,
          MRR: r.mrr,
          Recorrência: r.recorrenciaValor,
          "Data indicação": r.dataIndicacao ?? "",
          HubSpot: r.hubspotUrl,
          Asaas: r.asaasUrl,
        }));
      }

      if (rowsOut.length === 0) {
        toast.warning("Nenhum dado para exportar");
        return;
      }
      const ws = XLSX.utils.json_to_sheet(rowsOut);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, fileName);
      toast.success(`${rowsOut.length} linha(s) exportada(s)`);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao exportar");
    }
  };

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.dataVenda) set.add(r.dataVenda.slice(0, 7)); });
    return Array.from(set).sort().reverse().map((v) => {
      const [y, m] = v.split("-");
      return { value: v, label: `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y}` };
    });
  }, [rows]);

  const cadastroByNome = useMemo(() => {
    const map = new Map<string, typeof cadastros[number]>();
    cadastros.forEach((c) => map.set(c.nome.trim().toLowerCase(), c));
    return map;
  }, [cadastros]);

  const calcBonificacao = (valorTotal: number, cad?: typeof cadastros[number]) => {
    if (!cad || !cad.bonificacao || cad.valor_bonificacao == null) return null;
    if (cad.metodo_bonificacao === "%") return (Number(valorTotal) || 0) * (Number(cad.valor_bonificacao) / 100);
    return Number(cad.valor_bonificacao);
  };

  const calcRecorrencia = (mrr: number, cad?: typeof cadastros[number]) => {
    if (!cad || !cad.recorrencia || cad.valor_recorrencia == null) return null;
    if (cad.metodo_recorrencia === "%") return (Number(mrr) || 0) * (Number(cad.valor_recorrencia) / 100);
    return Number(cad.valor_recorrencia);
  };

  const embOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.embaixador) s.add(r.embaixador); });
    recRows.forEach((r) => { if (r.embaixador) s.add(r.embaixador); });
    return Array.from(s).sort();
  }, [rows, recRows]);

  const campOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.campanha) s.add(r.campanha); });
    recRows.forEach((r) => { if (r.campanha) s.add(r.campanha); });
    return Array.from(s).sort();
  }, [rows, recRows]);


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mapped = rows.map((r) => {
      const cad = cadastroByNome.get((r.embaixador || "").trim().toLowerCase());
      const bonus = r.dataVenda ? calcBonificacao(r.valorTotal, cad) : null;
      const status: "ativo" | "inativo" | "nao_cadastrado" = !cad ? "nao_cadastrado" : (cad.status === "inativo" ? "inativo" : "ativo");
      return { ...r, bonificacaoVenda: bonus, embaixadorStatus: status, campanhaCadastrada: cad?.campanha ?? null };
    });
    const base = mapped.filter((r) => {
      if (monthFilter) {
        if (!r.dataVenda || r.dataVenda.slice(0, 7) !== monthFilter) return false;
      }
      if (embFilter.size > 0 && !embFilter.has(r.embaixador)) return false;
      if (campFilter.size > 0 && !campFilter.has(r.campanha)) return false;
      if (q && ![r.campanha, r.embaixador, r.vendedor, r.empresa].some((f) => f?.toLowerCase().includes(q))) return false;
      if (filtInd.campanhaDivergente) {
        const div = !!r.campanhaCadastrada && (r.campanha || "").trim().toLowerCase() !== (r.campanhaCadastrada || "").trim().toLowerCase();
        if (!div) return false;
      }
      if (filtInd.embStatus.size > 0 && !filtInd.embStatus.has(r.embaixadorStatus)) return false;
      if (filtInd.comHistorico && !logKeys.has(`parceiros_indicacoes:${r.id}`)) return false;
      return true;
    });
    if (!sortInd) return base;
    const col = COLUMNS[sortInd.key as ColKey];
    if (!col?.sortValue) return base;
    return sortArr(base, col.sortValue as (r: any) => any, sortInd.dir);
  }, [rows, query, monthFilter, embFilter, campFilter, cadastroByNome, sortInd, filtInd, logKeys]);



  const totals = useMemo(() => {
    const mrr = filtered.reduce((s, r) => s + (r.mrr || 0), 0);
    const total = filtered.reduce((s, r) => s + (r.valorTotal || 0), 0);
    const bonificacao = filtered.reduce((s, r) => s + (r.bonificacaoVenda || 0), 0);
    return { mrr, total, bonificacao, count: filtered.length };
  }, [filtered]);

  // ===== Período anterior (para deltas dos KPIs) =====
  // Define current/prev YYYY-MM. Se monthFilter vazio, usa o mês corrente vs anterior.
  const currentMonthKey = useMemo(() => {
    if (monthFilter) return monthFilter;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [monthFilter]);
  const prevMonthKey = useMemo(() => {
    const [y, m] = currentMonthKey.split("-").map(Number);
    const d = new Date(y, (m - 1) - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [currentMonthKey]);

  // Mesma lógica do `filtered`, porém para o mês anterior (ignora monthFilter atual).
  const filteredPrev = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mapped = rows.map((r) => {
      const cad = cadastroByNome.get((r.embaixador || "").trim().toLowerCase());
      const bonus = r.dataVenda ? calcBonificacao(r.valorTotal, cad) : null;
      const status: "ativo" | "inativo" | "nao_cadastrado" = !cad ? "nao_cadastrado" : (cad.status === "inativo" ? "inativo" : "ativo");
      return { ...r, bonificacaoVenda: bonus, embaixadorStatus: status, campanhaCadastrada: cad?.campanha ?? null };
    });
    return mapped.filter((r) => {
      if (!r.dataVenda || r.dataVenda.slice(0, 7) !== prevMonthKey) return false;
      if (embFilter.size > 0 && !embFilter.has(r.embaixador)) return false;
      if (campFilter.size > 0 && !campFilter.has(r.campanha)) return false;
      if (q && ![r.campanha, r.embaixador, r.vendedor, r.empresa].some((f) => f?.toLowerCase().includes(q))) return false;
      if (filtInd.embStatus.size > 0 && !filtInd.embStatus.has(r.embaixadorStatus)) return false;
      return true;
    });
  }, [rows, query, prevMonthKey, embFilter, campFilter, cadastroByNome, filtInd]);

  const totalsPrev = useMemo(() => {
    const mrr = filteredPrev.reduce((s, r) => s + (r.mrr || 0), 0);
    const total = filteredPrev.reduce((s, r) => s + (r.valorTotal || 0), 0);
    const bonificacao = filteredPrev.reduce((s, r) => s + (r.bonificacaoVenda || 0), 0);
    return { mrr, total, bonificacao, count: filteredPrev.length };
  }, [filteredPrev]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [query, monthFilter, embFilter, campFilter, pageSize, filtInd]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);
  const paginated = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );


  const conversoes = useMemo(() => {
    const m = new Map<string, { nome: string; indicacoes: number; vendas: number; mrr: number; valorTotal: number; bonificacaoTotal: number }>();
    filtered.forEach((r) => {
      const nome = (r.embaixador || "—").trim();
      const key = nome.toLowerCase();
      const cur = m.get(key) ?? { nome, indicacoes: 0, vendas: 0, mrr: 0, valorTotal: 0, bonificacaoTotal: 0 };
      cur.indicacoes += 1;
      if (r.dataVenda) cur.vendas += 1;
      cur.mrr += r.mrr || 0;
      cur.valorTotal += r.valorTotal || 0;
      cur.bonificacaoTotal += r.bonificacaoVenda || 0;
      m.set(key, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.indicacoes - a.indicacoes);
  }, [filtered]);



  // Apuração Recorrências: fonte independente (tabela parceiros_recorrencias).
  // Inclui ativos e inativos — o status é exibido na primeira coluna.
  const REC_SORT_ACCESSORS: Record<string, (r: any) => any> = {
    status: (r) => (r.ativo ? 1 : 0),
    campanha: (r) => r.campanha,
    embaixador: (r) => r.embaixador,
    vendedor: (r) => r.vendedor,
    empresa: (r) => r.empresa,
    mrr: (r) => r.mrr,
    recorrencia: (r) => r.recorrenciaValor,
    dataIndicacao: (r) => r.dataIndicacao,
  };

  const recorrencias = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = recRows
      .map((r) => {
        const cad = cadastroByNome.get((r.embaixador || "").trim().toLowerCase());
        const calc = calcRecorrencia(r.mrr || 0, cad);
        return { ...r, recorrenciaValor: calc != null ? calc : (r.recorrenciaValor || 0), _cad: cad };
      })
      .filter((r) => {
        if (monthFilter) {
          // Apuração Recorrências: só considera registros ativos cuja indicação ocorreu há pelo menos 1 mês.
          if (!r.ativo) return false;
          if (!r.dataIndicacao) return false;
          const ind = new Date(r.dataIndicacao);
          const cutoff = new Date();
          cutoff.setMonth(cutoff.getMonth() - 1);
          if (isNaN(ind.getTime()) || ind > cutoff) return false;
        }
        if (embFilter.size > 0 && !embFilter.has(r.embaixador)) return false;
        if (campFilter.size > 0 && !campFilter.has(r.campanha)) return false;
        if (q && ![r.campanha, r.embaixador, r.vendedor, r.empresa].some((f) => f?.toLowerCase().includes(q))) return false;
        if (filtRec.status.size > 0 && !filtRec.status.has(r.ativo ? "ativo" : "inativo")) return false;
        if (filtRec.campanhaDivergente) {
          const div = !!r._cad?.campanha && (r.campanha || "").trim().toLowerCase() !== (r._cad.campanha || "").trim().toLowerCase();
          if (!div) return false;
        }
        if (filtRec.embaixadorNaoCadastrado && r._cad) return false;
        if (filtRec.comHistorico && !logKeys.has(`parceiros_recorrencias:${r.id}`)) return false;
        return true;
      });
    if (!sortRec) return base;
    const acc = REC_SORT_ACCESSORS[sortRec.key];
    if (!acc) return base;
    return sortArr(base, acc, sortRec.dir);
  }, [recRows, query, monthFilter, embFilter, campFilter, cadastroByNome, sortRec, filtRec, logKeys]);



  const recTotalPages = Math.max(1, Math.ceil(recorrencias.length / recPageSize));
  useEffect(() => { setRecPage(1); }, [query, monthFilter, embFilter, campFilter, recPageSize, filtRec]);
  useEffect(() => { if (recPage > recTotalPages) setRecPage(recTotalPages); }, [recTotalPages, recPage]);
  const recorrenciasPaginated = useMemo(
    () => recorrencias.slice((recPage - 1) * recPageSize, recPage * recPageSize),
    [recorrencias, recPage, recPageSize]
  );

  const recTotal = useMemo(
    () => recorrencias.filter((r) => r.ativo).reduce((s, r) => s + (r.recorrenciaValor || 0), 0),
    [recorrencias]
  );

  // Soma de recorrência ativa por embaixador (usada na lista de Conversões por embaixador).
  const recorrenciaPorEmbaixador = useMemo(() => {
    const m = new Map<string, number>();
    recorrencias.forEach((r) => {
      if (!r.ativo) return;
      const key = (r.embaixador || "").trim().toLowerCase();
      m.set(key, (m.get(key) ?? 0) + (r.recorrenciaValor || 0));
    });
    return m;
  }, [recorrencias]);

  // ===== Agregados do período atual (conversões) =====
  const convAgg = useMemo(() => {
    const bonificacaoTotal = conversoes.reduce((s, c) => s + (c.bonificacaoTotal || 0), 0);
    const recorrenciaTotal = Array.from(recorrenciaPorEmbaixador.values()).reduce((s, v) => s + v, 0);
    // Top campanhas
    const byCamp = new Map<string, { mrr: number; valor: number }>();
    filtered.forEach((r) => {
      const cad = cadastroByNome.get((r.embaixador || "").trim().toLowerCase());
      const camp = cad?.campanha || r.campanha || "—";
      const cur = byCamp.get(camp) ?? { mrr: 0, valor: 0 };
      cur.mrr += r.mrr || 0;
      cur.valor += r.valorTotal || 0;
      byCamp.set(camp, cur);
    });
    let topMrrCamp: { nome: string; valor: number } | null = null;
    let topValorCamp: { nome: string; valor: number } | null = null;
    byCamp.forEach((v, nome) => {
      if (!topMrrCamp || v.mrr > topMrrCamp.valor) topMrrCamp = { nome, valor: v.mrr };
      if (!topValorCamp || v.valor > topValorCamp.valor) topValorCamp = { nome, valor: v.valor };
    });
    // Top 3 embaixadores por Bonificação + Recorrência
    const top3 = conversoes
      .map((c) => ({ nome: c.nome, soma: (c.bonificacaoTotal || 0) + (recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0) }))
      .filter((x) => x.soma > 0)
      .sort((a, b) => b.soma - a.soma)
      .slice(0, 3);
    return { bonificacaoTotal, recorrenciaTotal, soma: bonificacaoTotal + recorrenciaTotal, topMrrCamp, topValorCamp, top3 };
  }, [conversoes, recorrenciaPorEmbaixador, filtered, cadastroByNome]);

  // ===== Conversões do período anterior =====
  const conversoesPrev = useMemo(() => {
    const m = new Map<string, { bonificacaoTotal: number }>();
    filteredPrev.forEach((r) => {
      const key = (r.embaixador || "—").trim().toLowerCase();
      const cur = m.get(key) ?? { bonificacaoTotal: 0 };
      cur.bonificacaoTotal += r.bonificacaoVenda || 0;
      m.set(key, cur);
    });
    const bonificacaoTotal = Array.from(m.values()).reduce((s, x) => s + x.bonificacaoTotal, 0);
    return { bonificacaoTotal };
  }, [filteredPrev]);

  // ===== Recorrências do período anterior (snapshot 1 mês antes) =====
  // Considera recRows ativos cuja indicação ocorreu até 2 meses atrás (snapshot anterior).
  const recPrev = useMemo(() => {
    const base = recRows
      .map((r) => {
        const cad = cadastroByNome.get((r.embaixador || "").trim().toLowerCase());
        const calc = calcRecorrencia(r.mrr || 0, cad);
        return { ...r, recorrenciaValor: calc != null ? calc : (r.recorrenciaValor || 0) };
      })
      .filter((r) => {
        if (!r.ativo) return false;
        if (!r.dataIndicacao) return false;
        const ind = new Date(r.dataIndicacao);
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 2);
        return !isNaN(ind.getTime()) && ind <= cutoff;
      });
    const count = base.length;
    const recValor = base.reduce((s, r) => s + (r.recorrenciaValor || 0), 0);
    const mrrAtivo = base.reduce((s, r) => s + (r.mrr || 0), 0);
    return { count, recValor, mrrAtivo };
  }, [recRows, cadastroByNome]);

  // ===== Apuração Recorrências (período atual) =====
  const recAgg = useMemo(() => {
    const ativos = recorrencias.filter((r) => r.ativo);
    const count = ativos.length;
    const mrrAtivo = ativos.reduce((s, r) => s + (r.mrr || 0), 0);
    const recValor = ativos.reduce((s, r) => s + (r.recorrenciaValor || 0), 0);
    const roi = recValor > 0 ? mrrAtivo / recValor : null;
    return { count, mrrAtivo, recValor, roi };
  }, [recorrencias]);

  // Embaixadores que possuem algum registro com histórico (indicações ou recorrências)
  const embaixadoresComLog = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (logKeys.has(`parceiros_indicacoes:${r.id}`)) s.add((r.embaixador || "").trim().toLowerCase()); });
    recRows.forEach((r) => { if (logKeys.has(`parceiros_recorrencias:${r.id}`)) s.add((r.embaixador || "").trim().toLowerCase()); });
    return s;
  }, [rows, recRows, logKeys]);

  const tierOptions = useMemo(() => {
    const s = new Set<string>();
    cadastros.forEach((c) => { if (c.tier) s.add(c.tier); });
    return Array.from(s);
  }, [cadastros]);

  const campanhaCadastroOptions = useMemo(() => {
    const s = new Set<string>();
    cadastros.forEach((c) => { if (c.campanha) s.add(c.campanha); });
    return Array.from(s).sort();
  }, [cadastros]);

  const conversoesSorted = useMemo(() => {
    if (!sortConv) return conversoes;
    const accessors: Record<string, (c: typeof conversoes[number]) => any> = {
      embaixador: (c) => c.nome,
      tier: (c) => cadastroByNome.get(c.nome.toLowerCase())?.tier ?? "",
      campanha: (c) => cadastroByNome.get(c.nome.toLowerCase())?.campanha ?? "",
      bonificacao: (c) => cadastroByNome.get(c.nome.toLowerCase())?.valor_bonificacao ?? null,
      recorrencia: (c) => cadastroByNome.get(c.nome.toLowerCase())?.valor_recorrencia ?? null,
      indicacoes: (c) => c.indicacoes,
      vendas: (c) => c.vendas,
      mrr: (c) => c.mrr,
      valorTotal: (c) => c.valorTotal,
      bonificacaoTotal: (c) => c.bonificacaoTotal,
      recorrenciaTotal: (c) => recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0,
      bonificacaoMaisRecorrencia: (c) => (c.bonificacaoTotal || 0) + (recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0),
    };
    const acc = accessors[sortConv.key];
    if (!acc) return conversoes;
    return sortArr(conversoes, acc, sortConv.dir);
  }, [conversoes, sortConv, cadastroByNome, recorrenciaPorEmbaixador]);

  const conversoesFiltradas = useMemo(() => {
    return conversoesSorted.filter((c) => {
      const cad = cadastroByNome.get(c.nome.toLowerCase());
      if (filtConv.tier.size > 0 && !filtConv.tier.has(cad?.tier ?? "Não possui")) return false;
      if (filtConv.campanha.size > 0 && !filtConv.campanha.has(cad?.campanha ?? "")) return false;
      if (filtConv.recorrencia === "sim" && !cad?.recorrencia) return false;
      if (filtConv.recorrencia === "nao" && cad?.recorrencia) return false;
      if (filtConv.bonificacao === "sim" && !cad?.bonificacao) return false;
      if (filtConv.bonificacao === "nao" && cad?.bonificacao) return false;
      if (filtConv.naoCadastrados && cad) return false;
      if (filtConv.comHistorico && !embaixadoresComLog.has(c.nome.toLowerCase())) return false;
      return true;
    });
  }, [conversoesSorted, cadastroByNome, filtConv, embaixadoresComLog]);

  const convTotalPages = Math.max(1, Math.ceil(conversoesFiltradas.length / convPageSize));
  useEffect(() => { setConvPage(1); }, [query, monthFilter, embFilter, campFilter, convPageSize, filtConv]);
  useEffect(() => { if (convPage > convTotalPages) setConvPage(convTotalPages); }, [convTotalPages, convPage]);
  const conversoesPaginated = useMemo(
    () => conversoesFiltradas.slice((convPage - 1) * convPageSize, convPage * convPageSize),
    [conversoesFiltradas, convPage, convPageSize]
  );



  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someChecked = filtered.some((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Apagar ${selected.size} indicação(ões)? Esta ação não pode ser desfeita.`)) return;
    setDeleting(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("parceiros_indicacoes").delete().in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} indicação(ões) apagada(s)`);
      setSelected(new Set());
      await loadRows();
    } catch (err: any) {
      toast.error(err?.message || "Falha ao apagar");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-5">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Parceiros</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Indicações de embaixadores, vendas atribuídas e integrações com HubSpot e Asaas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={handleFile}
          />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Atualizar
          </Button>
          <GestaoParceirosDialog />
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={handleDeleteSelected} disabled={deleting}>
              <Trash2 className="h-3.5 w-3.5" /> Apagar ({selected.size})
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]">
                <Upload className="h-3.5 w-3.5" /> Importar planilha
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleImportClick("indicacoes")}>Lista de Indicações</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleImportClick("recorrencias")}>Apuração Recorrências</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]">
                <Download className="h-3.5 w-3.5" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("indicacoes")}>Lista de Indicações</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("conversoes")}>Conversões por embaixador</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("recorrencias")}>Apuração Recorrências</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="h-8 gap-1.5 text-[12.5px]">
            <Plus className="h-3.5 w-3.5" /> Nova indicação
          </Button>
        </div>
      </div>

      {/* KPIs — Lista de Indicações */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiDeltaCard label="Indicações" current={totals.count} previous={totalsPrev.count} format="number" />
        <KpiDeltaCard label="MRR somado" current={totals.mrr} previous={totalsPrev.mrr} />
        <KpiDeltaCard label="Valor total" current={totals.total} previous={totalsPrev.total} />
      </div>

      {/* Tabela */}
      <SectionCard
        title="Lista de Indicações"
        subtitle="Visualização consolidada por campanha"
        padded={false}
        stickyHeader
        actions={
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar campanha, empresa, vendedor…"
                className="h-8 w-56 pl-7 text-[12.5px]"
              />
            </div>
            <div className={cn("relative", !monthFilter && "month-filter-alert")}> 
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className={cn(
                  "h-8 rounded-md border bg-background px-2 text-[12.5px] text-foreground transition-colors",
                  !monthFilter
                    ? "border-rose-500 text-rose-700 dark:text-rose-400 font-medium pr-2"
                    : "border-input",
                )}
                title="Filtrar por mês da data da venda"
              >
                <option value="">Todos os meses (venda)</option>
                {monthOptions.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              {!monthFilter && (
                <span
                  role="alert"
                  className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-rose-600 px-2 py-1 text-[11px] font-medium text-white shadow-md animate-bounce"
                >
                  <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-rose-600" />
                  Lembre de filtrar o mês correto para apuração
                </span>
              )}
            </div>
            <MultiFilter
              label="Embaixador"
              open={embOpen}
              setOpen={setEmbOpen}
              options={embOptions}
              selected={embFilter}
              setSelected={setEmbFilter}
            />
            <MultiFilter
              label="Campanha"
              open={campOpen}
              setOpen={setCampOpen}
              options={campOptions}
              selected={campFilter}
              setSelected={setCampFilter}
            />
            <FiltrosTabs
              filtInd={filtInd} setFiltInd={setFiltInd}
              filtConv={filtConv} setFiltConv={setFiltConv}
              filtRec={filtRec} setFiltRec={setFiltRec}
              tierOptions={tierOptions} campanhaCadastroOptions={campanhaCadastroOptions}
              totalCount={filtTotalCount}
              indCount={filtIndCount} convCount={filtConvCount} recCount={filtRecCount}
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <Th className="w-10">
                  <Checkbox
                    checked={allChecked ? true : someChecked ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Selecionar todas"
                  />
                </Th>
                {columnOrder.map((key) => {
                  const c = COLUMNS[key];
                  const sortable = !!c.sortValue;
                  const active = sortInd?.key === key;
                  const SortIcon = active ? (sortInd!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <Th
                      key={key}
                      className={cn(c.headClass, "cursor-move select-none", dragOverCol === key && "bg-muted/50", sortable && "hover:text-foreground transition-colors")}
                      draggable
                      onDragStart={() => setDragCol(key)}
                      onDragOver={(e) => { e.preventDefault(); if (dragOverCol !== key) setDragOverCol(key); }}
                      onDragLeave={() => setDragOverCol((p) => (p === key ? null : p))}
                      onDrop={() => handleDropCol(key)}
                      onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
                      onClick={sortable ? () => setSortInd((s) => toggleSort(s, key)) : undefined}
                      title={sortable ? "Clique para ordenar · arraste para reordenar" : "Arraste para reordenar"}
                    >
                      <span className={cn("inline-flex items-center gap-1", c.headClass?.includes("text-right") && "flex-row-reverse")}>
                        <GripVertical className="h-3 w-3 text-muted-foreground/40" aria-hidden />
                        {c.label}
                        {sortable && (
                          <SortIcon className={cn("h-3 w-3", active ? "text-foreground" : "text-muted-foreground/40")} aria-hidden />
                        )}
                      </span>
                    </Th>
                  );
                })}

              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={columnOrder.length + 1} className="py-16 text-center text-[12.5px] text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnOrder.length + 1} className="py-16 text-center">
                    <EmptyState />
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((r) => (
                  <TableRow key={r.id} className="text-[12.5px]" data-state={selected.has(r.id) ? "selected" : undefined}>
                    <TableCell className="py-2.5">
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggleRow(r.id)}
                        aria-label="Selecionar linha"
                      />
                    </TableCell>
                    {columnOrder.map((key) => {
                      const mismatch =
                        key === "campanha" &&
                        !!r.campanhaCadastrada &&
                        (r.campanha || "").trim().toLowerCase() !== (r.campanhaCadastrada || "").trim().toLowerCase();
                      return (
                        <TableCell key={key} className={cn("py-2.5", COLUMNS[key].cellClass)}>
                          {key === "embaixador" && r.embaixadorStatus === "nao_cadastrado" && r.embaixador ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span>{r.embaixador}</span>
                              <TooltipProvider delayDuration={150}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => openNaoCadastrado(r.embaixador)}
                                      className="inline-flex items-center justify-center rounded-full text-amber-600 dark:text-amber-400 hover:text-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                                      aria-label="Embaixador não cadastrado"
                                    >
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="text-[11.5px]">
                                    Embaixador não cadastrado. Clique para cadastrar ou associar.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </span>
                          ) : key === "campanha" ? (
                            <span className="inline-flex items-center gap-1.5">
                              {COLUMNS.campanha.render(r)}
                              {hasLog("parceiros_indicacoes", r.id) && (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => openHistorico({
                                          table: "parceiros_indicacoes",
                                          id: r.id,
                                          titulo: `${r.embaixador || "—"} · ${r.empresa || r.campanha || ""}`,
                                        })}
                                        className="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                                        aria-label="Histórico de campanha"
                                      >
                                        <History className="h-3.5 w-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="text-[11.5px]">
                                      Ver histórico de alterações de campanha
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {mismatch && (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => openEditCampanha({
                                          table: "parceiros_indicacoes",
                                          id: r.id,
                                          embaixador: r.embaixador,
                                          campanhaAtual: r.campanha || "",
                                          campanhaCadastrada: r.campanhaCadastrada || "",
                                        })}
                                        className="inline-flex items-center justify-center rounded-full text-amber-600 dark:text-amber-400 hover:text-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                                        aria-label="Campanha divergente"
                                      >
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="text-[11.5px]">
                                      Campanha do registro diferente da cadastrada ({r.campanhaCadastrada}). Clique para editar.
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </span>
                          ) : (
                            COLUMNS[key].render(r)
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {filtered.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </SectionCard>


      {/* Conversões por embaixador */}
      <SectionCard
        title="Conversões por embaixador"
        subtitle={monthFilter ? "Apuração do mês selecionado (data da venda)" : "Apuração de todos os períodos"}
        padded={false}
        stickyHeader
        actions={
          <FiltrosTabs
            filtInd={filtInd} setFiltInd={setFiltInd}
            filtConv={filtConv} setFiltConv={setFiltConv}
            filtRec={filtRec} setFiltRec={setFiltRec}
            tierOptions={tierOptions} campanhaCadastroOptions={campanhaCadastroOptions}
            totalCount={filtTotalCount}
            indCount={filtIndCount} convCount={filtConvCount} recCount={filtRecCount}
          />
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh sortKey="embaixador" sort={sortConv} setSort={setSortConv}>Embaixador</SortableTh>
                <SortableTh sortKey="tier" sort={sortConv} setSort={setSortConv}>Tier</SortableTh>
                <SortableTh sortKey="campanha" sort={sortConv} setSort={setSortConv}>Campanha</SortableTh>
                <SortableTh sortKey="bonificacao" sort={sortConv} setSort={setSortConv}>Bonificação</SortableTh>
                <SortableTh sortKey="recorrencia" sort={sortConv} setSort={setSortConv}>Recorrência</SortableTh>
                <SortableTh sortKey="indicacoes" sort={sortConv} setSort={setSortConv} className="text-right" align="right">Indicações</SortableTh>
                <SortableTh sortKey="vendas" sort={sortConv} setSort={setSortConv} className="text-right" align="right">Vendas</SortableTh>
                <SortableTh sortKey="mrr" sort={sortConv} setSort={setSortConv} className="text-right" align="right">MRR</SortableTh>
                <SortableTh sortKey="valorTotal" sort={sortConv} setSort={setSortConv} className="text-right" align="right">Valor total</SortableTh>
                <SortableTh sortKey="bonificacaoTotal" sort={sortConv} setSort={setSortConv} className="text-right" align="right">Bonificação Total</SortableTh>
                <SortableTh sortKey="recorrenciaTotal" sort={sortConv} setSort={setSortConv} className="text-right" align="right">Recorrência Total</SortableTh>
                <SortableTh sortKey="bonificacaoMaisRecorrencia" sort={sortConv} setSort={setSortConv} className="text-right" align="right">Bonificação + Recorrência</SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversoesFiltradas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="py-10 text-center text-[12.5px] text-muted-foreground">
                    Sem indicações no período.
                  </TableCell>
                </TableRow>
              ) : (
                conversoesPaginated.map((c) => {
                  const cad = cadastroByNome.get(c.nome.toLowerCase());
                  return (
                    <TableRow key={c.nome} className="text-[12.5px]">
                      <TableCell className="py-2.5 font-medium text-foreground">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {c.nome}
                          {!cad && c.nome && c.nome !== "—" && (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => openNaoCadastrado(c.nome)}
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:hover:bg-amber-500/25 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    Não cadastrado
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="text-[11.5px]">
                                  Parceiro não cadastrado. Clique para cadastrar ou associar.
                                </TooltipContent>
                              </Tooltip>

                            </TooltipProvider>
                          )}
                          {cad && cad.status === "inativo" && (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10.5px] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                                    <AlertTriangle className="h-3 w-3" />
                                    Inativo
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="text-[11.5px]">
                                  Parceiro com status Inativo na Gestão de Parceiros.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        {cad ? <Badge variant="outline" className="text-[10.5px] font-normal whitespace-nowrap">{cad.tier === "Não possui" ? "—" : cad.tier.replace("Tier ", "T")}</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5 text-[12px]">
                        {cad?.campanha ? <span className="text-foreground">{cad.campanha}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {cad ? (cad.bonificacao
                          ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10.5px] font-normal whitespace-nowrap">
                              {cad.valor_bonificacao != null
                                ? (cad.metodo_bonificacao === "%" ? `${cad.valor_bonificacao}%` : BRL(Number(cad.valor_bonificacao)))
                                : "Sim"}
                            </Badge>
                          : <span className="text-muted-foreground">Não</span>) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {cad ? (cad.recorrencia
                          ? <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/20 text-[10.5px] font-normal whitespace-nowrap">
                              {cad.valor_recorrencia != null
                                ? (cad.metodo_recorrencia === "%" ? `${cad.valor_recorrencia}%` : BRL(Number(cad.valor_recorrencia)))
                                : "Sim"}
                            </Badge>
                          : <span className="text-muted-foreground">Não</span>) : <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      <TableCell className="py-2.5 text-right tabular-nums font-medium">{c.indicacoes}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums">{c.vendas}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums">{BRL(c.mrr)}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums font-medium">{BRL(c.valorTotal)}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums font-medium">{c.bonificacaoTotal > 0 ? BRL(c.bonificacaoTotal) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums font-medium text-emerald-700 dark:text-emerald-400">{(recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0) > 0 ? BRL(recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0) : <span className="text-muted-foreground font-normal">—</span>}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums font-semibold text-foreground">{(() => { const soma = (c.bonificacaoTotal || 0) + (recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0); return soma > 0 ? BRL(soma) : <span className="text-muted-foreground font-normal">—</span>; })()}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {conversoesFiltradas.length > 0 && (
          <Pagination
            page={convPage}
            totalPages={convTotalPages}
            pageSize={convPageSize}
            onPageChange={setConvPage}
            onPageSizeChange={setConvPageSize}
          />
        )}
      </SectionCard>

      {/* Apuração Recorrências */}
      <SectionCard
        title="Apuração Recorrências"
        subtitle={`Indicações convertidas com recorrência ativa · Total: ${BRL(recTotal)}`}
        padded={false}
        stickyHeader
        actions={
          <FiltrosTabs
            filtInd={filtInd} setFiltInd={setFiltInd}
            filtConv={filtConv} setFiltConv={setFiltConv}
            filtRec={filtRec} setFiltRec={setFiltRec}
            tierOptions={tierOptions} campanhaCadastroOptions={campanhaCadastroOptions}
            totalCount={filtTotalCount}
            indCount={filtIndCount} convCount={filtConvCount} recCount={filtRecCount}
          />
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh sortKey="status" sort={sortRec} setSort={setSortRec}>Status</SortableTh>
                <SortableTh sortKey="campanha" sort={sortRec} setSort={setSortRec}>Campanha</SortableTh>
                <SortableTh sortKey="embaixador" sort={sortRec} setSort={setSortRec}>Embaixador</SortableTh>
                <SortableTh sortKey="vendedor" sort={sortRec} setSort={setSortRec}>Responsável Takeat</SortableTh>
                <SortableTh sortKey="empresa" sort={sortRec} setSort={setSortRec}>Empresa</SortableTh>
                <SortableTh sortKey="mrr" sort={sortRec} setSort={setSortRec} className="text-right" align="right">MRR</SortableTh>
                <SortableTh sortKey="recorrencia" sort={sortRec} setSort={setSortRec} className="text-right" align="right">Recorrência</SortableTh>
                <SortableTh sortKey="dataIndicacao" sort={sortRec} setSort={setSortRec}>Data indicação</SortableTh>
                <Th className="text-center">HubSpot</Th>
                <Th className="text-center">Asaas</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recorrencias.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-[12.5px] text-muted-foreground">
                    Nenhuma indicação ativa com recorrência no período.
                  </TableCell>
                </TableRow>
              ) : (
                recorrenciasPaginated.map((r) => {
                  const cadRec = cadastroByNome.get((r.embaixador || "").trim().toLowerCase());
                  const campMismatch = !!cadRec?.campanha && (r.campanha || "").trim().toLowerCase() !== (cadRec.campanha || "").trim().toLowerCase();
                  return (
                  <TableRow key={`rec-${r.id}`} className="text-[12.5px]">
                    <TableCell className="py-2.5">
                      {r.ativo ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10.5px] font-normal">Ativo</Badge>
                      ) : (
                        <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 text-[10.5px] font-normal">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5 font-medium text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{r.campanha || "—"}</span>
                        {hasLog("parceiros_recorrencias", r.id) && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => openHistorico({
                                    table: "parceiros_recorrencias",
                                    id: r.id,
                                    titulo: `${r.embaixador || "—"} · ${r.empresa || r.campanha || ""}`,
                                  })}
                                  className="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                                  aria-label="Histórico de campanha"
                                >
                                  <History className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="text-[11.5px]">
                                Ver histórico de alterações de campanha
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {campMismatch && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => openEditCampanha({
                                    table: "parceiros_recorrencias",
                                    id: r.id,
                                    embaixador: r.embaixador,
                                    campanhaAtual: r.campanha || "",
                                    campanhaCadastrada: cadRec?.campanha || "",
                                  })}
                                  className="inline-flex items-center justify-center rounded-full text-amber-600 dark:text-amber-400 hover:text-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                                  aria-label="Campanha divergente"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="text-[11.5px]">
                                Campanha do registro diferente da cadastrada ({cadRec?.campanha}). Clique para editar.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{r.embaixador || "—"}</span>
                        {!cadRec && r.embaixador && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => openNaoCadastrado(r.embaixador)}
                                  className="inline-flex items-center justify-center rounded-full text-amber-600 dark:text-amber-400 hover:text-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                                  aria-label="Embaixador não cadastrado"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="text-[11.5px]">
                                Embaixador não cadastrado. Clique para cadastrar ou associar.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5">{r.vendedor || "—"}</TableCell>
                    <TableCell className="py-2.5">{r.empresa || "—"}</TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums">{BRL(r.mrr)}</TableCell>
                    <TableCell className={cn("py-2.5 text-right tabular-nums font-medium", r.ativo ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground line-through")}>
                      {BRL(r.recorrenciaValor || 0)}
                    </TableCell>
                    <TableCell className="py-2.5 tabular-nums text-muted-foreground">{fmtDate(r.dataIndicacao)}</TableCell>
                    <TableCell className="py-2.5 text-center">
                      <IntegrationLink href={r.hubspotUrl} label="HubSpot" tone="hubspot">
                        <HubspotIcon className="h-3.5 w-3.5" />
                      </IntegrationLink>
                    </TableCell>
                    <TableCell className="py-2.5 text-center">
                      <IntegrationLink href={r.asaasUrl} label="Asaas" tone="asaas">
                        <AsaasIcon className="h-3.5 w-3.5" />
                      </IntegrationLink>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {recorrencias.length > 0 && (
          <Pagination
            page={recPage}
            totalPages={recTotalPages}
            pageSize={recPageSize}
            onPageChange={setRecPage}
            onPageSizeChange={setRecPageSize}
          />
        )}
      </SectionCard>



      <NaoCadastradoDialog
        open={naoCadOpen}
        onOpenChange={setNaoCadOpen}
        nome={naoCadNome}
        onDone={() => { loadCadastros(); loadRows(); loadRecorrencias(); }}
      />

      <EditarCampanhaDialog
        open={editCampOpen}
        onOpenChange={setEditCampOpen}
        target={editCampTarget}
        onDone={() => { loadRows(); loadRecorrencias(); }}
      />

      <HistoricoCampanhaSheet
        open={histOpen}
        onOpenChange={setHistOpen}
        target={histTarget}
      />

      <Dialog open={mapOpen} onOpenChange={(o) => { if (!importing) setMapOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mapear colunas da planilha — {importTarget === "recorrencias" ? "Apuração Recorrências" : "Lista de Indicações"}</DialogTitle>
            <DialogDescription>
              Vincule cada campo à coluna correspondente da planilha importada.
              {sheetRows.length > 0 && ` ${sheetRows.length} linha(s) detectada(s).`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-2">
              {activeMappingFields.map((f) => (
                <div key={f.key} className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[1fr_1.4fr] sm:gap-3">
                  <label className="text-[12.5px] font-medium text-foreground">{f.label}</label>
                  <Select
                    value={mapping[f.key] || "__none__"}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                  >
                    <SelectTrigger className="h-8 text-[12.5px]">
                      <SelectValue placeholder="— Não importar —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Não importar —</SelectItem>
                      {sheetHeaders.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMapOpen(false)} disabled={importing}>Cancelar</Button>
            <Button onClick={confirmImport} disabled={importing}>
              {importing ? "Importando…" : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Th({ children, className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { children: React.ReactNode }) {
  return (
    <TableHead
      className={cn(
        "h-9 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        className
      )}
      {...rest}
    >
      {children}
    </TableHead>
  );
}

function SortableTh({
  children, sortKey, sort, setSort, className, align,
}: {
  children: React.ReactNode;
  sortKey: string;
  sort: SortState;
  setSort: React.Dispatch<React.SetStateAction<SortState>>;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  const active = sort?.key === sortKey;
  const dir = active ? sort!.dir : null;
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Th
      className={cn("cursor-pointer select-none hover:text-foreground transition-colors", className)}
      onClick={() => setSort((s) => toggleSort(s, sortKey))}
    >
      <span className={cn(
        "inline-flex items-center gap-1",
        align === "right" && "flex-row-reverse w-full",
        align === "center" && "justify-center w-full",
      )}>
        {children}
        <Icon className={cn("h-3 w-3", active ? "text-foreground" : "text-muted-foreground/40")} />
      </span>
    </Th>
  );
}

function MultiFilter({
  label, open, setOpen, options, selected, setSelected,
}: {
  label: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  options: string[];
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const [q, setQ] = useState("");
  const toggle = (v: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  };
  const filteredOpts = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const count = selected.size;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]">
          <Filter className="h-3.5 w-3.5" />
          {label}
          {count > 0 && <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">{count}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="flex items-center justify-between gap-2 pb-1.5">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Buscar ${label.toLowerCase()}…`}
            className="h-7 text-[12px]"
          />
          {count > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setSelected(new Set())}>
              Limpar
            </Button>
          )}
        </div>
        <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
          {filteredOpts.length === 0 ? (
            <div className="py-4 text-center text-[11.5px] text-muted-foreground">Sem opções</div>
          ) : filteredOpts.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-muted/60">
              <Checkbox checked={selected.has(o)} onCheckedChange={() => toggle(o)} />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Pagination({
  page, totalPages, pageSize, onPageChange, onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  const pages: (number | "…")[] = [];
  const add = (n: number | "…") => { if (pages[pages.length - 1] !== n) pages.push(n); };
  const window = 1;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - window && i <= page + window)) add(i);
    else if (i < page) add("…");
    else if (i > page) { add("…"); i = totalPages - 1; }
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-1 border-t border-border px-3 py-2 text-[12.5px]">
      <Button
        variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12.5px]"
        disabled={page <= 1} onClick={() => onPageChange(page - 1)}
      >
        ‹ Voltar
      </Button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={cn(
              "h-7 min-w-7 rounded-md px-2 text-[12.5px] transition-colors",
              p === page
                ? "border border-border bg-muted font-semibold text-foreground"
                : "text-foreground hover:bg-muted/60"
            )}
          >
            {p}
          </button>
        )
      )}
      <Button
        variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12.5px]"
        disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
      >
        Próximo ›
      </Button>
      <div className="ml-2">
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-7 w-[130px] text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25 por página</SelectItem>
            <SelectItem value="50">50 por página</SelectItem>
            <SelectItem value="100">100 por página</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}




function KpiCard({ label, value, prev, format = "number", hint }: { label: string; value: string; prev?: number | null; format?: "number" | "currency"; hint?: string }) {
  // Calcula delta apenas quando prev é fornecido e for um número finito.
  let delta: { pct: number | null; up: boolean; flat: boolean; absPrev: number } | null = null;
  if (typeof prev === "number" && isFinite(prev)) {
    // Reconstrói o valor numérico a partir do string formatado é complicado; deixe o caller informar via data-attr? Em vez disso, compare contra prev usando o valor exibido convertido.
    // Como `value` já está formatado, usamos um truque: o caller deve passar um número via prop "prevDisplay" se quiser delta. Aqui apenas exibimos "vs período anterior" textual.
    delta = { pct: null, up: false, flat: true, absPrev: prev };
  }
  return (
    <div className="card-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[10.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function KpiDeltaCard({ label, current, previous, format = "currency", invertColor = false }: { label: string; current: number; previous: number; format?: "currency" | "number"; invertColor?: boolean }) {
  const diff = current - previous;
  const pct = previous !== 0 ? (diff / Math.abs(previous)) * 100 : (current !== 0 ? 100 : 0);
  const up = diff > 0;
  const flat = diff === 0;
  const positive = invertColor ? !up : up;
  const tone = flat
    ? "text-muted-foreground"
    : positive
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  const arrow = flat ? "→" : up ? "▲" : "▼";
  const fmt = (n: number) => format === "currency" ? BRL(n) : new Intl.NumberFormat("pt-BR").format(n);
  return (
    <div className="card-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{fmt(current)}</div>
      <div className={cn("mt-0.5 text-[10.5px] font-medium tabular-nums flex items-center gap-1", tone)}>
        <span>{arrow}</span>
        <span>{flat ? "estável" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}</span>
        <span className="text-muted-foreground font-normal">vs anterior ({fmt(previous)})</span>
      </div>
    </div>
  );
}

function KpiInfoCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground truncate" title={value}>{value}</div>
      {sub && <div className="mt-0.5 text-[10.5px] text-muted-foreground truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function IntegrationLink({
  href,
  label,
  tone,
  children,
}: {
  href?: string;
  label: string;
  tone: "hubspot" | "asaas";
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "hubspot"
      ? "text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-orange-500/10"
      : "text-sky-600 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-500/10";

  if (!href) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40">
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Abrir no ${label}`}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent transition-colors",
        toneCls
      )}
    >
      {children}
      <ExternalLink className="ml-0.5 h-2.5 w-2.5 opacity-0" />
    </a>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Plus className="h-4 w-4" />
        </span>
      </div>
      <div className="text-[13px] font-medium text-foreground">Nenhuma indicação cadastrada</div>
      <p className="max-w-sm text-[12px]">
        Quando houver indicações de embaixadores, elas aparecerão aqui com os dados de campanha,
        venda e links para HubSpot e Asaas.
      </p>
    </div>
  );
}

function FiltrosTabs({
  filtInd, setFiltInd, filtConv, setFiltConv, filtRec, setFiltRec,
  tierOptions, campanhaCadastroOptions, totalCount, indCount, convCount, recCount,
}: {
  filtInd: { campanhaDivergente: boolean; embStatus: Set<string>; comHistorico: boolean };
  setFiltInd: React.Dispatch<React.SetStateAction<{ campanhaDivergente: boolean; embStatus: Set<string>; comHistorico: boolean }>>;
  filtConv: { tier: Set<string>; campanha: Set<string>; recorrencia: "todos" | "sim" | "nao"; bonificacao: "todos" | "sim" | "nao"; naoCadastrados: boolean; comHistorico: boolean };
  setFiltConv: React.Dispatch<React.SetStateAction<{ tier: Set<string>; campanha: Set<string>; recorrencia: "todos" | "sim" | "nao"; bonificacao: "todos" | "sim" | "nao"; naoCadastrados: boolean; comHistorico: boolean }>>;
  filtRec: { status: Set<string>; campanhaDivergente: boolean; embaixadorNaoCadastrado: boolean; comHistorico: boolean };
  setFiltRec: React.Dispatch<React.SetStateAction<{ status: Set<string>; campanhaDivergente: boolean; embaixadorNaoCadastrado: boolean; comHistorico: boolean }>>;
  tierOptions: string[];
  campanhaCadastroOptions: string[];
  totalCount: number; indCount: number; convCount: number; recCount: number;
}) {
  const toggleSet = (s: Set<string>, v: string) => {
    const next = new Set(s);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  };
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <Label className="text-[12.5px]">{label}</Label>
      {children}
    </div>
  );
  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[11.5px] border transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/30 text-foreground hover:bg-muted"
      )}
    >{children}</button>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]">
          <Filter className="h-3.5 w-3.5" /> Filtros
          {totalCount > 0 && <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">{totalCount}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-3" align="end">
        <Tabs defaultValue="ind">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ind" className="text-[11.5px]">Indicações{indCount > 0 && <span className="ml-1 text-[10px] opacity-70">({indCount})</span>}</TabsTrigger>
            <TabsTrigger value="conv" className="text-[11.5px]">Conversões{convCount > 0 && <span className="ml-1 text-[10px] opacity-70">({convCount})</span>}</TabsTrigger>
            <TabsTrigger value="rec" className="text-[11.5px]">Recorrências{recCount > 0 && <span className="ml-1 text-[10px] opacity-70">({recCount})</span>}</TabsTrigger>
          </TabsList>

          <TabsContent value="ind" className="mt-3 space-y-1">
            <Row label="Campanha divergente da cadastrada">
              <Switch checked={filtInd.campanhaDivergente} onCheckedChange={(v) => setFiltInd((f) => ({ ...f, campanhaDivergente: v }))} />
            </Row>
            <div className="py-1.5">
              <Label className="text-[12.5px]">Status do embaixador</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["ativo", "inativo", "nao_cadastrado"] as const).map((s) => (
                  <Chip key={s} active={filtInd.embStatus.has(s)} onClick={() => setFiltInd((f) => ({ ...f, embStatus: toggleSet(f.embStatus, s) }))}>
                    {s === "nao_cadastrado" ? "Não cadastrado" : s === "ativo" ? "Ativo" : "Inativo"}
                  </Chip>
                ))}
              </div>
            </div>
            <Row label="Com histórico de edições">
              <Switch checked={filtInd.comHistorico} onCheckedChange={(v) => setFiltInd((f) => ({ ...f, comHistorico: v }))} />
            </Row>
            {indCount > 0 && (
              <Button variant="ghost" size="sm" className="mt-1 h-7 w-full text-[11.5px]" onClick={() => setFiltInd({ campanhaDivergente: false, embStatus: new Set(), comHistorico: false })}>Limpar filtros</Button>
            )}
          </TabsContent>

          <TabsContent value="conv" className="mt-3 space-y-1">
            <div className="py-1.5">
              <Label className="text-[12.5px]">Tier</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tierOptions.map((t) => (
                  <Chip key={t} active={filtConv.tier.has(t)} onClick={() => setFiltConv((f) => ({ ...f, tier: toggleSet(f.tier, t) }))}>{t}</Chip>
                ))}
              </div>
            </div>
            <div className="py-1.5">
              <Label className="text-[12.5px]">Campanha</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {campanhaCadastroOptions.length === 0 ? (
                  <span className="text-[11.5px] text-muted-foreground">Nenhuma campanha cadastrada</span>
                ) : campanhaCadastroOptions.map((c) => (
                  <Chip key={c} active={filtConv.campanha.has(c)} onClick={() => setFiltConv((f) => ({ ...f, campanha: toggleSet(f.campanha, c) }))}>{c}</Chip>
                ))}
              </div>
            </div>
            <div className="py-1.5">
              <Label className="text-[12.5px]">Recorrência</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["todos", "sim", "nao"] as const).map((v) => (
                  <Chip key={v} active={filtConv.recorrencia === v} onClick={() => setFiltConv((f) => ({ ...f, recorrencia: v }))}>
                    {v === "todos" ? "Todos" : v === "sim" ? "Com recorrência" : "Sem recorrência"}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="py-1.5">
              <Label className="text-[12.5px]">Bonificação</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["todos", "sim", "nao"] as const).map((v) => (
                  <Chip key={v} active={filtConv.bonificacao === v} onClick={() => setFiltConv((f) => ({ ...f, bonificacao: v }))}>
                    {v === "todos" ? "Todos" : v === "sim" ? "Com bonificação" : "Sem bonificação"}
                  </Chip>
                ))}
              </div>
            </div>
            <Row label="Apenas não cadastrados">
              <Switch checked={filtConv.naoCadastrados} onCheckedChange={(v) => setFiltConv((f) => ({ ...f, naoCadastrados: v }))} />
            </Row>
            <Row label="Com histórico de edições">
              <Switch checked={filtConv.comHistorico} onCheckedChange={(v) => setFiltConv((f) => ({ ...f, comHistorico: v }))} />
            </Row>
            {convCount > 0 && (
              <Button variant="ghost" size="sm" className="mt-1 h-7 w-full text-[11.5px]" onClick={() => setFiltConv({ tier: new Set(), campanha: new Set(), recorrencia: "todos", bonificacao: "todos", naoCadastrados: false, comHistorico: false })}>Limpar filtros</Button>
            )}
          </TabsContent>

          <TabsContent value="rec" className="mt-3 space-y-1">
            <div className="py-1.5">
              <Label className="text-[12.5px]">Status</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(["ativo", "inativo"] as const).map((s) => (
                  <Chip key={s} active={filtRec.status.has(s)} onClick={() => setFiltRec((f) => ({ ...f, status: toggleSet(f.status, s) }))}>
                    {s === "ativo" ? "Ativo" : "Inativo"}
                  </Chip>
                ))}
              </div>
            </div>
            <Row label="Campanha divergente da cadastrada">
              <Switch checked={filtRec.campanhaDivergente} onCheckedChange={(v) => setFiltRec((f) => ({ ...f, campanhaDivergente: v }))} />
            </Row>
            <Row label="Embaixador não cadastrado">
              <Switch checked={filtRec.embaixadorNaoCadastrado} onCheckedChange={(v) => setFiltRec((f) => ({ ...f, embaixadorNaoCadastrado: v }))} />
            </Row>
            <Row label="Com histórico de edições">
              <Switch checked={filtRec.comHistorico} onCheckedChange={(v) => setFiltRec((f) => ({ ...f, comHistorico: v }))} />
            </Row>
            {recCount > 0 && (
              <Button variant="ghost" size="sm" className="mt-1 h-7 w-full text-[11.5px]" onClick={() => setFiltRec({ status: new Set(), campanhaDivergente: false, embaixadorNaoCadastrado: false, comHistorico: false })}>Limpar filtros</Button>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
