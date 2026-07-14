import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { brl, brlAbbr, fmtDateBR } from "./utils";
import { Search, ExternalLink } from "lucide-react";
import { ComprovanteLink } from "@/components/ComprovanteLink";

type Lanc = {
  id: number;
  id_unico: string;
  referencia: string;
  competencia: string;
  origem: string;
  gestor: string | null;
  time: string | null;
  card_final: string | null;
  data: string | null;
  estabelecimento: string | null;
  descricao_original: string | null;
  categoria: string | null;
  parcela: string | null;
  valor: number;
  status_nf: string;
  status_escopo: string | null;
  observacao: string | null;
  /** URL http (Drive) — é o que abre. */
  link_comprovante: string | null;
  /** só o NOME do arquivo; serve para exibir/tooltip, não para abrir. */
  arquivo_comprovante: string | null;
};

const PAGE_SIZE = 50;

export default function BaseCartao() {
  const [rows, setRows] = useState<Lanc[]>([]);
  const [loading, setLoading] = useState(true);
  const [referencia, setReferencia] = useState<string>("");
  const [fTime, setFTime] = useState("todos");
  const [fNf, setFNf] = useState("todos");
  const [fEscopo, setFEscopo] = useState("todos");
  const [busca, setBusca] = useState("");
  const [agrupar, setAgrupar] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("auditoria_cartao_lancamentos")
        .select("*")
        .order("data", { ascending: false })
        .limit(5000);
      if (error) { toast.error("Erro ao carregar base do cartão"); setRows([]); }
      else setRows((data ?? []) as unknown as Lanc[]);
      setLoading(false);
    })();
  }, []);

  const referencias = useMemo(
    () => Array.from(new Set(rows.map(r => r.referencia))).sort().reverse(),
    [rows]
  );
  useEffect(() => {
    if (!referencia && referencias.length) setReferencia(referencias[0]);
  }, [referencias, referencia]);

  const periodRows = useMemo(
    () => referencia ? rows.filter(r => r.referencia === referencia) : [],
    [rows, referencia]
  );

  const times = useMemo(() => Array.from(new Set(periodRows.map(r => r.time).filter(Boolean) as string[])).sort(), [periodRows]);
  const nfOpts = useMemo(() => Array.from(new Set(periodRows.map(r => r.status_nf).filter(Boolean))).sort(), [periodRows]);
  const escopoOpts = useMemo(() => Array.from(new Set(periodRows.map(r => r.status_escopo).filter(Boolean) as string[])).sort(), [periodRows]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return periodRows.filter(r => {
      if (fTime !== "todos" && r.time !== fTime) return false;
      if (fNf !== "todos" && r.status_nf !== fNf) return false;
      if (fEscopo !== "todos" && r.status_escopo !== fEscopo) return false;
      if (q) {
        const hay = `${r.estabelecimento ?? ""} ${r.descricao_original ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [periodRows, fTime, fNf, fEscopo, busca]);

  useEffect(() => { setPage(1); }, [referencia, fTime, fNf, fEscopo, busca, agrupar]);

  const kpis = useMemo(() => {
    const total = periodRows.length;
    const soma = periodRows.reduce((s, r) => s + Number(r.valor || 0), 0);
    const semNf = periodRows.filter(r => r.status_nf === "SEM NF").length;
    const fora = periodRows.filter(r => r.status_escopo === "FORA-JUSTIFICAR").length;
    const ok = periodRows.filter(r => r.status_nf === "OK" || r.status_nf === "OK (conferir)").length;
    const denom = ok + semNf;
    const cobertura = denom > 0 ? (ok / denom) * 100 : 0;
    return { total, soma, semNf, fora, cobertura };
  }, [periodRows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  const grouped = useMemo(() => {
    if (!agrupar) return null;
    const g = new Map<string, Lanc[]>();
    filtered.forEach(r => {
      const k = r.time ?? "—";
      const arr = g.get(k) ?? [];
      arr.push(r); g.set(k, arr);
    });
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, agrupar]);

  const referenciaLabel = (ref: string) => {
    const [y, m] = ref.split("-");
    if (!y || !m) return ref;
    const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
    return `${meses[Number(m) - 1] ?? m} / ${y}`;
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 pt-3 pb-6 space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Hub Financeiro · Governança</div>
          <h1 className="text-3xl font-bold tracking-tight mt-0.5">Base do Cartão</h1>
          <p className="text-sm text-muted-foreground mt-1">Fatura completa do cartão corporativo · leitura.</p>
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
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
            <input type="checkbox" checked={agrupar} onChange={e => setAgrupar(e.target.checked)} />
            Agrupar por time
          </label>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {loading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />) : (
          <>
            <Kpi label="Lançamentos" value={String(kpis.total)} />
            <Kpi label="Valor total" value={brlAbbr(kpis.soma)} />
            <Kpi label="SEM NF" value={String(kpis.semNf)} valueClass="text-[hsl(0_72%_45%)]" />
            <Kpi label="FORA-JUSTIFICAR" value={String(kpis.fora)} valueClass="text-[hsl(30_80%_40%)]" />
            <Kpi label="Cobertura NF" value={`${kpis.cobertura.toFixed(1)}%`} valueClass="text-[hsl(152_60%_36%)]" />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect label="Time" value={fTime} onChange={setFTime} options={times} />
        <FilterSelect label="NF" value={fNf} onChange={setFNf} options={nfOpts} />
        <FilterSelect label="Escopo" value={fEscopo} onChange={setFEscopo} options={escopoOpts} />
        <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3 min-w-[240px] flex-1 max-w-[360px]">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Estabelecimento ou descrição…"
            className="flex-1 text-sm bg-transparent outline-none"
          />
        </label>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[100px_120px_100px_80px_1.5fr_130px_80px_110px_130px_140px] gap-3 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
          <div>Data</div>
          <div>Gestor</div>
          <div>Time</div>
          <div>Card</div>
          <div>Estabelecimento</div>
          <div>Categoria</div>
          <div>Parcela</div>
          <div className="text-right">Valor</div>
          <div>Status NF</div>
          <div>Escopo</div>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Nenhum lançamento nesta referência</div>
        ) : agrupar && grouped ? (
          grouped.map(([time, list]) => {
            const soma = list.reduce((s, r) => s + Number(r.valor || 0), 0);
            return (
              <div key={time}>
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
                  <div className="text-xs font-semibold">{time} <span className="text-muted-foreground font-normal">({list.length})</span></div>
                  <div className="text-xs num font-semibold">{brl(soma)}</div>
                </div>
                {list.map(r => <BaseRow key={r.id} r={r} />)}
              </div>
            );
          })
        ) : (
          <>
            {paged.map(r => <BaseRow key={r.id} r={r} />)}
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

function BaseRow({ r }: { r: Lanc }) {
  const bg =
    r.status_nf === "SEM NF" ? "bg-[hsl(0_80%_97%)]" :
    r.status_escopo === "FORA-JUSTIFICAR" ? "bg-[hsl(48_100%_96%)]" : "";
  return (
    <div className={cn("grid grid-cols-[100px_120px_100px_80px_1.5fr_130px_80px_110px_130px_140px] gap-3 px-4 py-2.5 items-center border-b border-border last:border-0 text-sm", bg)}>
      <div className="text-muted-foreground">{fmtDateBR(r.data)}</div>
      <div className="truncate">{r.gestor || "—"}</div>
      <div className="truncate text-foreground/80">{r.time || "—"}</div>
      <div className="text-xs text-muted-foreground">•••• {r.card_final || "—"}</div>
      <div className="min-w-0">
        <div className="font-medium truncate">{r.estabelecimento || "—"}</div>
        {r.descricao_original && r.descricao_original !== r.estabelecimento && (
          <div className="text-xs text-muted-foreground truncate">{r.descricao_original}</div>
        )}
        {r.observacao && <div className="text-[11px] text-muted-foreground italic truncate">{r.observacao}</div>}
      </div>
      <div className="text-xs truncate">{r.categoria || "—"}</div>
      <div className="text-xs text-muted-foreground">{r.parcela || "—"}</div>
      <div className="text-right num font-medium">{brl(Number(r.valor || 0))}</div>
      <div className="flex items-center gap-1.5">
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border",
          r.status_nf === "SEM NF" ? "bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border-[hsl(0_80%_88%)]" :
          r.status_nf === "OK" ? "bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)]" :
          "bg-muted text-muted-foreground border-border"
        )}>{r.status_nf}</span>
        {/* O comprovante pode ser URL (Drive) ou caminho no bucket privado — o
            ComprovanteLink resolve os dois e não renderiza quando não dá para abrir. */}
        <ComprovanteLink
          valor={r.link_comprovante}
          title={r.arquivo_comprovante || "Abrir comprovante"}
          className="text-muted-foreground hover:text-primary transition-colors shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </ComprovanteLink>
      </div>
      <div>
        {r.status_escopo && (
          <span className={cn(
            "inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border",
            r.status_escopo === "FORA-JUSTIFICAR" ? "bg-[hsl(38_92%_95%)] text-[hsl(30_80%_35%)] border-[hsl(38_92%_85%)]"
            : "bg-muted text-muted-foreground border-border"
          )}>{r.status_escopo}</span>
        )}
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="inline-flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="text-sm bg-transparent outline-none">
        <option value="todos">todos</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
