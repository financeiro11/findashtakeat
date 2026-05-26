import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Search, Plus, Download, ExternalLink, Filter, Upload, RefreshCw, GripVertical, AlertTriangle } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { GestaoParceirosDialog } from "./parceiros/GestaoParceirosDialog";

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

const COLUMNS: Record<ColKey, {
  label: string;
  headClass?: string;
  cellClass?: string;
  render: (r: Parceiro) => React.ReactNode;
}> = {
  campanha: { label: "Campanha", render: (r) => <span className="font-medium text-foreground">{r.campanha || "—"}</span> },
  embaixador: {
    label: "Embaixador",
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <span>{r.embaixador || "—"}</span>
        {r.embaixadorStatus === "ativo" && (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-normal h-4 px-1.5">Ativo</Badge>
        )}
        {r.embaixadorStatus === "inativo" && (
          <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 text-[10px] font-normal h-4 px-1.5">Inativo</Badge>
        )}
      </span>
    ),
  },
  vendedor: { label: "Vendedor", render: (r) => r.vendedor || "—" },
  empresa: { label: "Empresa", render: (r) => r.empresa || "—" },
  mrr: { label: "MRR", headClass: "text-right", cellClass: "text-right tabular-nums", render: (r) => BRL(r.mrr) },
  valorTotal: { label: "Valor total", headClass: "text-right", cellClass: "text-right tabular-nums font-medium", render: (r) => BRL(r.valorTotal) },
  bonificacao: { label: "Bonificação", headClass: "text-right", cellClass: "text-right tabular-nums", render: (r) => r.bonificacaoVenda != null ? BRL(r.bonificacaoVenda) : <span className="text-muted-foreground">—</span> },
  dataIndicacao: { label: "Data indicação", cellClass: "tabular-nums text-muted-foreground", render: (r) => fmtDate(r.dataIndicacao) },
  dataVenda: {
    label: "Data venda",
    cellClass: "tabular-nums",
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
  const [cadastros, setCadastros] = useState<Array<{ nome: string; tier: string; status: string; bonificacao: boolean; metodo_bonificacao: string | null; valor_bonificacao: number | null; recorrencia: boolean; metodo_recorrencia: string | null; valor_recorrencia: number | null }>>([]);
  const [embFilter, setEmbFilter] = useState<Set<string>>(new Set());
  const [campFilter, setCampFilter] = useState<Set<string>>(new Set());
  const [embOpen, setEmbOpen] = useState(false);
  const [campOpen, setCampOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);
  const [convPageSize, setConvPageSize] = useState<number>(25);
  const [convPage, setConvPage] = useState<number>(1);
  const [recPageSize, setRecPageSize] = useState<number>(25);
  const [recPage, setRecPage] = useState<number>(1);
  const [recRows, setRecRows] = useState<Array<{ id: string; id_negocio: string; campanha: string; embaixador: string; vendedor: string; empresa: string; mrr: number; recorrenciaValor: number; dataIndicacao: string | null; ativo: boolean; hubspotUrl: string; asaasUrl: string }>>([]);


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
  }, []);

  const loadCadastros = async () => {
    const { data, error } = await supabase.from("parceiros_cadastro").select("nome,tier,status,bonificacao,metodo_bonificacao,valor_bonificacao,recorrencia,metodo_recorrencia,valor_recorrencia");
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

  const handleImportClick = () => fileInputRef.current?.click();

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
      // auto-detect defaults
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const findHeader = (...needles: string[]) =>
        headers.find((h) => needles.some((n) => norm(h).includes(n))) || "";
      const auto: Record<string, string> = {};
      MAPPING_FIELDS.forEach((f) => { auto[f.key] = findHeader(...f.match); });
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
        MAPPING_FIELDS.forEach((f) => {
          if (f.key === "id_negocio") return;
          const col = mapping[f.key];
          if (!col || col === "__none__") return;
          const raw = r[col];
          if (raw == null || raw === "") return;
          if (f.type === "number") payload[f.column] = parseNumberCell(raw);
          else if (f.type === "date") payload[f.column] = parseDateCell(raw);
          else payload[f.column] = String(raw).trim() || null;
        });
        if (!payload.origem) payload.origem = "import_planilha";
        toInsert.push(payload);
      });

      // Dedupe por id_negocio (mantém a última ocorrência) — evita erro
      // "ON CONFLICT DO UPDATE command cannot affect row a second time"
      const byId = new Map<string, any>();
      toInsert.forEach((p) => byId.set(p.id_negocio, { ...byId.get(p.id_negocio), ...p }));
      const deduped = Array.from(byId.values());
      const duplicatesRemoved = toInsert.length - deduped.length;

      if (deduped.length === 0) {
        toast.warning("Nenhuma linha válida encontrada (ID do Negócio é obrigatório)");
        return;
      }
      const { error } = await supabase
        .from("parceiros_indicacoes")
        .upsert(deduped, { onConflict: "id_negocio", ignoreDuplicates: false });
      if (error) throw error;
      toast.success(`${deduped.length} indicação(ões) importada(s)${skipped ? ` · ${skipped} sem ID` : ""}${duplicatesRemoved ? ` · ${duplicatesRemoved} duplicada(s) mescladas` : ""}`);
      setMapOpen(false);
      setSheetRows([]);
      setSheetHeaders([]);
      await loadRows();
    } catch (err: any) {
      toast.error(err?.message || "Falha ao importar");
    } finally {
      setImporting(false);
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
    return Array.from(s).sort();
  }, [rows]);

  const campOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.campanha) s.add(r.campanha); });
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (monthFilter) {
          if (!r.dataVenda || r.dataVenda.slice(0, 7) !== monthFilter) return false;
        }
        if (embFilter.size > 0 && !embFilter.has(r.embaixador)) return false;
        if (campFilter.size > 0 && !campFilter.has(r.campanha)) return false;
        if (q && ![r.campanha, r.embaixador, r.vendedor, r.empresa].some((f) => f?.toLowerCase().includes(q))) return false;
        return true;
      })
      .map((r) => {
        const cad = cadastroByNome.get((r.embaixador || "").trim().toLowerCase());
        const bonus = r.dataVenda ? calcBonificacao(r.valorTotal, cad) : null;
        const status: "ativo" | "inativo" | "nao_cadastrado" = !cad ? "nao_cadastrado" : (cad.status === "inativo" ? "inativo" : "ativo");
        return { ...r, bonificacaoVenda: bonus, embaixadorStatus: status };
      });
  }, [rows, query, monthFilter, embFilter, campFilter, cadastroByNome]);


  const totals = useMemo(() => {
    const mrr = filtered.reduce((s, r) => s + (r.mrr || 0), 0);
    const total = filtered.reduce((s, r) => s + (r.valorTotal || 0), 0);
    return { mrr, total, count: filtered.length };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [query, monthFilter, embFilter, campFilter, pageSize]);
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

  const convTotalPages = Math.max(1, Math.ceil(conversoes.length / convPageSize));
  useEffect(() => { setConvPage(1); }, [query, monthFilter, embFilter, campFilter, convPageSize]);
  useEffect(() => { if (convPage > convTotalPages) setConvPage(convTotalPages); }, [convTotalPages, convPage]);
  const conversoesPaginated = useMemo(
    () => conversoes.slice((convPage - 1) * convPageSize, convPage * convPageSize),
    [conversoes, convPage, convPageSize]
  );

  // Apuração Recorrências: fonte independente (tabela parceiros_recorrencias).
  // Inclui ativos e inativos — o status é exibido na primeira coluna.
  const recorrencias = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recRows.filter((r) => {
      if (monthFilter) {
        if (!r.dataIndicacao || r.dataIndicacao.slice(0, 7) !== monthFilter) return false;
      }
      if (embFilter.size > 0 && !embFilter.has(r.embaixador)) return false;
      if (campFilter.size > 0 && !campFilter.has(r.campanha)) return false;
      if (q && ![r.campanha, r.embaixador, r.vendedor, r.empresa].some((f) => f?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [recRows, query, monthFilter, embFilter, campFilter]);

  const recTotalPages = Math.max(1, Math.ceil(recorrencias.length / recPageSize));
  useEffect(() => { setRecPage(1); }, [query, monthFilter, embFilter, campFilter, recPageSize]);
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
    recRows.forEach((r) => {
      if (!r.ativo) return;
      const key = (r.embaixador || "").trim().toLowerCase();
      m.set(key, (m.get(key) ?? 0) + (r.recorrenciaValor || 0));
    });
    return m;
  }, [recRows]);

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
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={handleImportClick}>
            <Upload className="h-3.5 w-3.5" /> Importar planilha
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]">
            <Download className="h-3.5 w-3.5" /> Exportar
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-[12.5px]">
            <Plus className="h-3.5 w-3.5" /> Nova indicação
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Indicações" value={totals.count.toString()} />
        <KpiCard label="MRR somado" value={BRL(totals.mrr)} />
        <KpiCard label="Valor total" value={BRL(totals.total)} />
      </div>

      {/* Tabela */}
      <SectionCard
        title="Lista de Indicações"
        subtitle="Visualização consolidada por campanha"
        padded={false}
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
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-[12.5px] text-foreground"
              title="Filtrar por mês da data da venda"
            >
              <option value="">Todos os meses (venda)</option>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
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
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]">
              <Filter className="h-3.5 w-3.5" /> Filtros
            </Button>
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
                  return (
                    <Th
                      key={key}
                      className={cn(c.headClass, "cursor-move select-none", dragOverCol === key && "bg-muted/50")}
                      draggable
                      onDragStart={() => setDragCol(key)}
                      onDragOver={(e) => { e.preventDefault(); if (dragOverCol !== key) setDragOverCol(key); }}
                      onDragLeave={() => setDragOverCol((p) => (p === key ? null : p))}
                      onDrop={() => handleDropCol(key)}
                      onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
                      title="Arraste para reordenar"
                    >
                      <span className={cn("inline-flex items-center gap-1", c.headClass?.includes("text-right") && "flex-row-reverse")}>
                        <GripVertical className="h-3 w-3 text-muted-foreground/40" aria-hidden />
                        {c.label}
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
                    {columnOrder.map((key) => (
                      <TableCell key={key} className={cn("py-2.5", COLUMNS[key].cellClass)}>
                        {COLUMNS[key].render(r)}
                      </TableCell>
                    ))}
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
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <Th>Embaixador</Th>
                <Th>Tier</Th>
                <Th>Bonificação</Th>
                <Th>Recorrência</Th>
                <Th className="text-right">Indicações</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">MRR</Th>
                <Th className="text-right">Valor total</Th>
                <Th className="text-right">Bonificação Total</Th>
                <Th className="text-right">Recorrência Total</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversoes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-[12.5px] text-muted-foreground">
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
                          {!cad && (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                                    <AlertTriangle className="h-3 w-3" />
                                    Não cadastrado
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="text-[11.5px]">
                                  Parceiro não cadastrado na Gestão de Parceiros.
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
                        {cad ? <Badge variant="outline" className="text-[10.5px] font-normal">{cad.tier}</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {cad ? (cad.bonificacao
                          ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10.5px] font-normal">
                              Sim{cad.metodo_bonificacao ? ` · ${cad.metodo_bonificacao}${cad.valor_bonificacao != null ? ` ${cad.metodo_bonificacao === "%" ? `${cad.valor_bonificacao}%` : BRL(Number(cad.valor_bonificacao))}` : ""}` : ""}
                            </Badge>
                          : <span className="text-muted-foreground">Não</span>) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {cad ? (cad.recorrencia
                          ? <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/20 text-[10.5px] font-normal">
                              Sim{cad.metodo_recorrencia ? ` · ${cad.metodo_recorrencia}${cad.valor_recorrencia != null ? ` ${cad.metodo_recorrencia === "%" ? `${cad.valor_recorrencia}%` : BRL(Number(cad.valor_recorrencia))}` : ""}` : ""}
                            </Badge>
                          : <span className="text-muted-foreground">Não</span>) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums font-medium">{c.indicacoes}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums">{c.vendas}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums">{BRL(c.mrr)}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums font-medium">{BRL(c.valorTotal)}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums font-medium">{c.bonificacaoTotal > 0 ? BRL(c.bonificacaoTotal) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="py-2.5 text-right tabular-nums font-medium text-emerald-700 dark:text-emerald-400">{(recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0) > 0 ? BRL(recorrenciaPorEmbaixador.get(c.nome.toLowerCase()) ?? 0) : <span className="text-muted-foreground font-normal">—</span>}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {conversoes.length > 0 && (
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
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <Th>Status</Th>
                <Th>Campanha</Th>
                <Th>Embaixador</Th>
                <Th>Responsável Takeat</Th>
                <Th>Empresa</Th>
                <Th className="text-right">MRR</Th>
                <Th className="text-right">Recorrência</Th>
                <Th>Data indicação</Th>
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
                recorrenciasPaginated.map((r) => (
                  <TableRow key={`rec-${r.id}`} className="text-[12.5px]">
                    <TableCell className="py-2.5">
                      {r.ativo ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 text-[10.5px] font-normal">Ativo</Badge>
                      ) : (
                        <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 text-[10.5px] font-normal">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5 font-medium text-foreground">{r.campanha || "—"}</TableCell>
                    <TableCell className="py-2.5">{r.embaixador || "—"}</TableCell>
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
                ))
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



      <Dialog open={mapOpen} onOpenChange={(o) => { if (!importing) setMapOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mapear colunas da planilha</DialogTitle>
            <DialogDescription>
              Vincule cada campo da lista de indicações à coluna correspondente da planilha importada.
              {sheetRows.length > 0 && ` ${sheetRows.length} linha(s) detectada(s).`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-2">
              {MAPPING_FIELDS.map((f) => (
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




function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
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
