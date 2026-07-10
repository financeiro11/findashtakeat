import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { brl, brlAbbr, fmtDateBR } from "./utils";
import { Search, RefreshCw, Loader2, ExternalLink, FileWarning, FileCheck2 } from "lucide-react";

type Lanc = {
  id: number;
  id_unico: string;
  referencia: string;
  data: string | null;
  valor: number;
  descricao: string | null;
  favorecido: string | null;
  conta_corrente: string | null;
  categoria_codigo: string | null;
  categoria: string | null;
  tem_comprovante: boolean;
  comprovante_url: string | null;
  anexo_nome: string | null;
  status: string;
  observacao: string | null;
};

const STATUS = ["Pendente", "Em análise", "Aprovado", "Reprovado"] as const;
const PAGE_SIZE = 50;

const referenciaLabel = (ref: string) => {
  const [y, m] = ref.split("-");
  if (!y || !m) return ref;
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${meses[Number(m) - 1] ?? m} / ${y}`;
};

export default function BasePix() {
  const [rows, setRows] = useState<Lanc[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [referencia, setReferencia] = useState<string>("");
  const [fCat, setFCat] = useState("todas");
  const [fCompr, setFCompr] = useState<"todos" | "com" | "sem">("todos");
  const [fStatus, setFStatus] = useState("todos");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("auditoria_pix_lancamentos" as any)
      .select("*")
      .order("data", { ascending: false })
      .limit(5000);
    if (error) { toast.error("Erro ao carregar PIX"); setRows([]); }
    else setRows((data ?? []) as unknown as Lanc[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    toast.message(referencia ? `Sincronizando PIX de ${referenciaLabel(referencia)} com o Omie…` : "Sincronizando PIX com o Omie…");
    try {
      const { data, error } = await supabase.functions.invoke("omie-pix-sync", {
        body: { action: "sync", ...(referencia ? { referencia } : {}) },
      });
      if (error) {
        let detalhe = error.message || "";
        const ctx: any = (error as any).context;
        if (ctx && typeof ctx.text === "function") {
          try { const raw = await ctx.text(); detalhe = JSON.parse(raw)?.error || raw || detalhe; } catch { /* keep */ }
        }
        console.error("[omie-pix-sync]", detalhe, error);
        if (/not found|Failed to (send|fetch)/i.test(detalhe)) throw new Error("A função omie-pix-sync ainda não foi publicada no Supabase (deploy pendente pelo Lovable).");
        if (/OMIE_APP_KEY|OMIE_APP_SECRET|Credenciais do Omie/i.test(detalhe)) throw new Error("Faltam os secrets OMIE_APP_KEY / OMIE_APP_SECRET no Supabase.");
        throw new Error(detalhe || "Erro no backend.");
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      const d = data as any;
      toast.success(`PIX sincronizado: ${d.pix_gravados} lançamentos · ${d.com_comprovante} com comprovante, ${d.sem_comprovante} sem.`);
      await load();
    } catch (e: any) {
      toast.error("Falha ao sincronizar PIX: " + e.message, { duration: 8000 });
    } finally { setSyncing(false); }
  };

  const mudarStatus = async (row: Lanc, novo: string) => {
    const anterior = row.status;
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, status: novo } : r));
    const { error } = await supabase
      .from("auditoria_pix_lancamentos" as any)
      .update({ status: novo, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      toast.error("Não foi possível salvar o status");
      setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, status: anterior } : r));
    }
  };

  const referencias = useMemo(() => Array.from(new Set(rows.map(r => r.referencia))).sort().reverse(), [rows]);
  useEffect(() => { if (!referencia && referencias.length) setReferencia(referencias[0]); }, [referencias, referencia]);

  const periodRows = useMemo(() => referencia ? rows.filter(r => r.referencia === referencia) : rows, [rows, referencia]);
  const categorias = useMemo(() => Array.from(new Set(periodRows.map(r => r.categoria).filter(Boolean) as string[])).sort(), [periodRows]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return periodRows.filter(r => {
      if (fCat !== "todas" && r.categoria !== fCat) return false;
      if (fCompr === "com" && !r.tem_comprovante) return false;
      if (fCompr === "sem" && r.tem_comprovante) return false;
      if (fStatus !== "todos" && r.status !== fStatus) return false;
      if (q) {
        const hay = `${r.favorecido ?? ""} ${r.descricao ?? ""} ${r.categoria ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [periodRows, fCat, fCompr, fStatus, busca]);

  useEffect(() => { setPage(1); }, [referencia, fCat, fCompr, fStatus, busca]);

  const kpis = useMemo(() => {
    const total = periodRows.length;
    const soma = periodRows.reduce((s, r) => s + Number(r.valor || 0), 0);
    const semCompr = periodRows.filter(r => !r.tem_comprovante).length;
    const comCompr = total - semCompr;
    const cobertura = total > 0 ? (comCompr / total) * 100 : 0;
    return { total, soma, semCompr, comCompr, cobertura };
  }, [periodRows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  return (
    <div className="mx-auto max-w-[1400px] px-6 pt-3 pb-6 space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Hub Financeiro · Governança</div>
          <h1 className="text-3xl font-bold tracking-tight mt-0.5">PIX · Sicoob</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Saídas (contas a pagar) da conta corrente Sicoob, puxadas do Omie · sem transferências,
            pessoal, premiação, escala ou benefícios · com categoria e comprovante.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={referencia}
            onChange={e => setReferencia(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium capitalize"
          >
            {referencias.map(r => <option key={r} value={r}>{referenciaLabel(r)}</option>)}
            {referencias.length === 0 && <option value="">—</option>}
          </select>
          <button
            onClick={sync}
            disabled={syncing}
            className="inline-flex items-center gap-2 h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {loading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : (
          <>
            <Kpi label="Lançamentos PIX" value={String(kpis.total)} />
            <Kpi label="Valor total" value={brlAbbr(kpis.soma)} />
            <Kpi label="Sem comprovante" value={String(kpis.semCompr)} valueClass="text-[hsl(0_72%_45%)]" />
            <Kpi label="Com comprovante" value={String(kpis.comCompr)} valueClass="text-[hsl(152_60%_36%)]" />
            <Kpi label="Cobertura" value={`${kpis.cobertura.toFixed(1)}%`} valueClass="text-[hsl(152_60%_36%)]" />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect label="Categoria" value={fCat} onChange={setFCat} options={categorias} allLabel="todas" />
        <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Comprovante</span>
          <select value={fCompr} onChange={e => setFCompr(e.target.value as any)} className="text-sm bg-transparent outline-none">
            <option value="todos">todos</option>
            <option value="com">com comprovante</option>
            <option value="sem">sem comprovante</option>
          </select>
        </label>
        <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={[...STATUS]} allLabel="todos" />
        <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3 min-w-[240px] flex-1 max-w-[360px]">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Favorecido, descrição ou categoria…"
            className="flex-1 text-sm bg-transparent outline-none"
          />
        </label>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[100px_1.4fr_1.4fr_130px_110px_130px_140px] gap-3 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
          <div>Data</div>
          <div>Favorecido / Descrição</div>
          <div>Categoria Omie</div>
          <div className="text-right">Valor</div>
          <div>Comprovante</div>
          <div>Status</div>
          <div className="text-right">Ação</div>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nenhum PIX carregado ainda. Clique em <b>Sincronizar</b> para puxar do Omie.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Nenhum lançamento com esses filtros.</div>
        ) : (
          <>
            {paged.map(r => <PixRow key={r.id} r={r} onStatus={mudarStatus} />)}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground border-t border-border">
                <div>Página {page} de {totalPages} · {filtered.length} lançamentos</div>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-2.5 py-1 rounded border border-border hover:bg-accent disabled:opacity-40">Anterior</button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-2.5 py-1 rounded border border-border hover:bg-accent disabled:opacity-40">Próxima</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PixRow({ r, onStatus }: { r: Lanc; onStatus: (r: Lanc, novo: string) => void }) {
  const bg = !r.tem_comprovante ? "bg-[hsl(0_80%_97%)]" : "";
  return (
    <div className={cn("grid grid-cols-[100px_1.4fr_1.4fr_130px_110px_130px_140px] gap-3 px-4 py-2.5 items-center border-b border-border last:border-0 text-sm", bg)}>
      <div className="text-muted-foreground">{fmtDateBR(r.data)}</div>
      <div className="min-w-0">
        <div className="font-medium truncate">{r.favorecido || r.descricao || "—"}</div>
        {r.descricao && r.descricao !== r.favorecido && (
          <div className="text-xs text-muted-foreground truncate">{r.descricao}</div>
        )}
      </div>
      <div className="text-xs truncate" title={r.categoria || ""}>{r.categoria || "—"}</div>
      <div className="text-right num font-medium">{brl(Number(r.valor || 0))}</div>
      <div>
        {r.tem_comprovante ? (
          r.comprovante_url ? (
            <a href={r.comprovante_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)] hover:underline">
              <FileCheck2 className="h-3 w-3" /> abrir <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)]">
              <FileCheck2 className="h-3 w-3" /> tem
            </span>
          )
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border-[hsl(0_80%_88%)]">
            <FileWarning className="h-3 w-3" /> sem
          </span>
        )}
      </div>
      <div>
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border",
          r.status === "Aprovado" ? "bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)]" :
          r.status === "Reprovado" ? "bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border-[hsl(0_80%_88%)]" :
          r.status === "Em análise" ? "bg-[hsl(212_80%_96%)] text-[hsl(212_80%_35%)] border-[hsl(212_80%_88%)]" :
          "bg-[hsl(38_92%_95%)] text-[hsl(30_80%_35%)] border-[hsl(38_92%_85%)]"
        )}>{r.status}</span>
      </div>
      <div className="text-right">
        <select
          value={r.status}
          onChange={e => onStatus(r, e.target.value)}
          className="h-7 rounded-md border border-border bg-card px-1.5 text-xs outline-none"
        >
          {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
  );
}

function Kpi({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-2xl font-bold num tracking-tight", valueClass)}>{value}</div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (v: string) => void; options: string[]; allLabel: string }) {
  return (
    <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="text-sm bg-transparent outline-none max-w-[180px]">
        <option value={allLabel}>{allLabel}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
