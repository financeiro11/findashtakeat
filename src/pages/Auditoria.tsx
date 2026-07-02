import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Download, X, ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Severidade = "Crítico" | "Alto" | "Médio" | "Baixo";
type Status = "Pendente" | "Em análise" | "Aprovado" | "Reprovado" | "Ajuste solicitado";
type TrilhaEvento = { ator: string; tipo: "sistema" | "humano"; texto: string; quando: string };
type Row = {
  id: number;
  competencia: string;
  titulo: string;
  area: string;
  severidade: Severidade;
  valor: number;
  responsavel: string;
  data_lancamento: string;
  descricao: string;
  origem: string;
  status: Status;
  trilha: TrilhaEvento[] | null;
};

type Escopo = "mes" | "acum";
type Filtro = "todas" | "Pendente" | "Em análise" | "Aprovado" | "Reprovado";

const MESES_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function brlAbbr(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sign}R$ ${Math.round(abs / 1_000).toLocaleString("pt-BR")} mil`;
  return brl(n);
}
function fmtDate(iso: string) {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd} ${MESES_PT[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateBR(iso: string) {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function fmtTrilha(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd} ${MESES_PT[d.getMonth()]} · ${hh}:${mm}`;
}

function sevDot(s: Severidade) {
  if (s === "Crítico") return "bg-[hsl(0_85%_42%)]";
  if (s === "Alto") return "bg-[hsl(0_72%_55%)]";
  if (s === "Médio") return "bg-[hsl(38_92%_50%)]";
  return "bg-muted-foreground/50";
}
function statusStyle(s: Status) {
  switch (s) {
    case "Pendente": return { dot: "bg-[hsl(38_92%_50%)]", pill: "bg-[hsl(38_92%_95%)] text-[hsl(30_80%_35%)] border-[hsl(38_92%_85%)]" };
    case "Em análise": return { dot: "bg-[hsl(212_80%_50%)]", pill: "bg-[hsl(212_80%_96%)] text-[hsl(212_80%_35%)] border-[hsl(212_80%_88%)]" };
    case "Aprovado": return { dot: "bg-[hsl(152_60%_40%)]", pill: "bg-[hsl(152_55%_94%)] text-[hsl(152_60%_28%)] border-[hsl(152_55%_82%)]" };
    case "Reprovado": return { dot: "bg-[hsl(0_72%_50%)]", pill: "bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border-[hsl(0_80%_88%)]" };
    case "Ajuste solicitado": return { dot: "bg-[hsl(22_92%_52%)]", pill: "bg-[hsl(22_92%_95%)] text-[hsl(22_85%_38%)] border-[hsl(22_92%_85%)]" };
  }
}

export default function Auditoria() {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [escopo, setEscopo] = useState<Escopo>("mes");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [selected, setSelected] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<{ acao: "Aprovar" | "Reprovar" | "Pedir ajuste" } | null>(null);
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { document.title = "FinHub · Auditoria"; }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("auditoria")
      .select("id,competencia,titulo,area,severidade,valor,responsavel,data_lancamento,descricao,origem,status,trilha")
      .order("data_lancamento", { ascending: false });
    if (error) {
      toast.error("Erro ao carregar auditoria");
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as Row[]);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Determine "current" competência from data (most recent month present).
  const currentComp = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((max, r) => (r.competencia > max ? r.competencia : max), rows[0].competencia);
  }, [rows]);

  const periodRows = useMemo(() => {
    if (!currentComp) return [];
    const d = new Date(currentComp + "T00:00:00");
    const ano = d.getFullYear();
    const mes = d.getMonth();
    return rows.filter(r => {
      const rd = new Date(r.competencia + "T00:00:00");
      if (escopo === "mes") return rd.getFullYear() === ano && rd.getMonth() === mes;
      return rd.getFullYear() === ano && rd <= d;
    });
  }, [rows, escopo, currentComp]);

  const counts = useMemo(() => {
    const c = { todas: periodRows.length, "Pendente": 0, "Em análise": 0, "Aprovado": 0, "Reprovado": 0 } as Record<string, number>;
    periodRows.forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });
    return c;
  }, [periodRows]);

  const filtered = useMemo(() => {
    if (filtro === "todas") return periodRows;
    return periodRows.filter(r => r.status === filtro);
  }, [periodRows, filtro]);

  const kpis = useMemo(() => {
    const pend = periodRows.filter(r => r.status === "Pendente");
    const emAn = periodRows.filter(r => r.status === "Em análise");
    const sobAud = [...pend, ...emAn];
    const valorSob = sobAud.reduce((s, r) => s + Number(r.valor || 0), 0);
    const aprov = periodRows.filter(r => r.status === "Aprovado").length;
    const repr = periodRows.filter(r => r.status === "Reprovado").length;
    return { pend: pend.length, emAn: emAn.length, valorSob, qtdSob: sobAud.length, resolv: aprov + repr, aprov, repr };
  }, [periodRows]);

  const notifCount = useMemo(
    () => periodRows.filter(r => r.status === "Pendente" || r.status === "Em análise" || r.status === "Ajuste solicitado").length,
    [periodRows]
  );

  const exportCsv = () => {
    const header = ["Título","Área","Severidade","Valor","Responsável","Data","Status"];
    const lines = filtered.map(r => [
      r.titulo, r.area, r.severidade,
      brl(Number(r.valor || 0)),
      r.responsavel ?? "",
      fmtDateBR(r.data_lancamento),
      r.status,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    const csv = "\uFEFF" + [header.join(";"), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `auditoria_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const executar = async () => {
    if (!selected || !confirm) return;
    const map: Record<string, Status> = { "Aprovar": "Aprovado", "Reprovar": "Reprovado", "Pedir ajuste": "Ajuste solicitado" };
    const novoStatus = map[confirm.acao];
    const ator = profile?.nome || user?.email || "Usuário";
    const texto = comentario.trim() ? `${confirm.acao === "Pedir ajuste" ? "Ajuste solicitado" : novoStatus}. ${comentario.trim()}` : (confirm.acao === "Pedir ajuste" ? "Ajuste solicitado." : `${novoStatus}.`);
    const novaTrilha: TrilhaEvento[] = [
      ...(Array.isArray(selected.trilha) ? selected.trilha : []),
      { ator, tipo: "humano", texto, quando: new Date().toISOString() },
    ];
    setSaving(true);
    const { error } = await supabase
      .from("auditoria")
      .update({ status: novoStatus, trilha: novaTrilha as any })
      .eq("id", selected.id);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(`Lançamento ${novoStatus.toLowerCase()}`);
    setConfirm(null); setComentario(""); setSelected(null);
    load();
  };

  return (
    <div className="min-h-screen bg-[hsl(40_30%_97%)]">
      <PageHeader />
      <div className="mx-auto max-w-[1400px] px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Hub Financeiro</div>
            <h1 className="text-3xl font-bold tracking-tight mt-0.5">Auditoria</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {(["mes","acum"] as Escopo[]).map(e => (
                <button
                  key={e}
                  onClick={() => setEscopo(e)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-md transition",
                    escopo === e ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {e === "mes" ? "Mês" : "Acumulado"}
                </button>
              ))}
            </div>
            <button className="relative h-9 w-9 rounded-lg border border-border bg-card flex items-center justify-center hover:bg-accent">
              <Bell className="h-4 w-4" />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[hsl(0_78%_47%)] text-white text-[10px] font-semibold flex items-center justify-center">
                  {notifCount}
                </span>
              )}
            </button>
            <Button onClick={exportCsv} className="bg-foreground text-background hover:bg-foreground/90 h-9">
              <Download className="h-4 w-4 mr-2" /> Exportar
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          ) : (
            <>
              <KpiCard label="Pendentes" value={String(kpis.pend)} legend="aguardando ação" />
              <KpiCard label="Em análise" value={String(kpis.emAn)} legend="em verificação" valueClass="text-[hsl(212_80%_45%)]" />
              <KpiCard label="Valor sob auditoria" value={brlAbbr(kpis.valorSob)} legend={`em ${kpis.qtdSob} lançamento${kpis.qtdSob === 1 ? "" : "s"}`} />
              <KpiCard label="Resolvidas no mês" value={String(kpis.resolv)} legend={`${kpis.aprov} aprovadas · ${kpis.repr} reprovadas`} valueClass="text-[hsl(152_60%_36%)]" />
            </>
          )}
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          {([
            { k: "todas", label: `Todas (${counts.todas})` },
            { k: "Pendente", label: `Pendentes (${counts["Pendente"]})` },
            { k: "Em análise", label: `Em análise (${counts["Em análise"]})` },
            { k: "Aprovado", label: `Aprovadas (${counts["Aprovado"]})` },
            { k: "Reprovado", label: `Reprovadas (${counts["Reprovado"]})` },
          ] as { k: Filtro; label: string }[]).map(f => (
            <button
              key={f.k}
              onClick={() => setFiltro(f.k)}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-medium border transition",
                filtro === f.k
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-foreground border-border hover:bg-accent"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Tabela */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-[1fr_140px_160px_140px_160px_40px] gap-4 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
            <div>Lançamento</div>
            <div className="text-right">Valor</div>
            <div>Responsável</div>
            <div>Data</div>
            <div>Status</div>
            <div></div>
          </div>
          {loading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Nenhum lançamento em auditoria neste período
            </div>
          ) : (
            filtered.map(r => {
              const ss = statusStyle(r.status);
              return (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="w-full grid grid-cols-[1fr_140px_160px_140px_160px_40px] gap-4 px-5 py-4 items-center border-b border-border last:border-0 hover:bg-accent/40 transition text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", sevDot(r.severidade))} />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{r.titulo}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.area} · {r.severidade}</div>
                    </div>
                  </div>
                  <div className="text-right num text-sm font-medium">{brl(Number(r.valor || 0))}</div>
                  <div className="text-sm text-foreground/80 truncate">{r.responsavel}</div>
                  <div className="text-sm text-muted-foreground">{fmtDate(r.data_lancamento)}</div>
                  <div>
                    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", ss.pill)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", ss.dot)} />
                      {r.status}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail Drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[560px] p-0 flex flex-col">
          {selected && (
            <>
              <div className="flex items-start justify-between px-6 pt-6 pb-4">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{selected.area}</div>
                  <h2 className="text-xl font-bold mt-1">{selected.titulo}</h2>
                </div>
                <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
                <div className="flex flex-wrap gap-2">
                  <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", statusStyle(selected.status).pill)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", statusStyle(selected.status).dot)} />
                    {selected.status}
                  </span>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[hsl(0_80%_96%)] text-[hsl(0_72%_38%)] border border-[hsl(0_80%_88%)]">
                    Severidade {selected.severidade}
                  </span>
                </div>

                <div className="num text-3xl font-bold">{brl(Number(selected.valor || 0))}</div>

                {selected.descricao && (
                  <p className="text-sm text-foreground/80 leading-relaxed">{selected.descricao}</p>
                )}

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <MetaItem label="Responsável" value={selected.responsavel} />
                  <MetaItem label="Data do lançamento" value={fmtDate(selected.data_lancamento)} />
                  <MetaItem label="Origem" value={selected.origem} full />
                </div>

                <div className="pt-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Trilha de auditoria</div>
                  <ol className="space-y-4">
                    {(selected.trilha ?? []).slice().sort((a, b) => a.quando.localeCompare(b.quando)).map((ev, i) => (
                      <li key={i} className="flex gap-3">
                        <div className="flex flex-col items-center pt-1">
                          <span className={cn("h-2 w-2 rounded-full", ev.tipo === "humano" ? "bg-[hsl(0_78%_47%)]" : "bg-muted-foreground/50")} />
                          <span className="w-px flex-1 bg-border mt-1" />
                        </div>
                        <div className="pb-2 min-w-0">
                          <div className="text-sm font-semibold">{ev.ator}</div>
                          <div className="text-sm text-foreground/70">{ev.texto}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{fmtTrilha(ev.quando)}</div>
                        </div>
                      </li>
                    ))}
                    {(!selected.trilha || selected.trilha.length === 0) && (
                      <li className="text-xs text-muted-foreground">Sem eventos registrados.</li>
                    )}
                  </ol>
                </div>
              </div>

              <div className="border-t border-border px-6 py-4 flex gap-2 bg-card">
                <Button
                  onClick={() => setConfirm({ acao: "Aprovar" })}
                  className="flex-1 bg-[hsl(152_60%_36%)] hover:bg-[hsl(152_60%_30%)] text-white"
                >
                  <Check className="h-4 w-4 mr-1.5" /> Aprovar
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setConfirm({ acao: "Reprovar" })}>Reprovar</Button>
                <Button variant="outline" className="flex-1" onClick={() => setConfirm({ acao: "Pedir ajuste" })}>Pedir ajuste</Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm dialog */}
      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) { setConfirm(null); setComentario(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.acao} lançamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Comentário (opcional)</label>
            <Textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={4} placeholder="Justifique ou detalhe sua decisão…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirm(null); setComentario(""); }} disabled={saving}>Cancelar</Button>
            <Button onClick={executar} disabled={saving} className={cn(confirm?.acao === "Aprovar" && "bg-[hsl(152_60%_36%)] hover:bg-[hsl(152_60%_30%)] text-white")}>
              {saving ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ label, value, legend, valueClass }: { label: string; value: string; legend: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-3xl font-bold num tracking-tight", valueClass)}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{legend}</div>
    </div>
  );
}

function MetaItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={cn(full && "col-span-2")}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="text-sm mt-1">{value || "—"}</div>
    </div>
  );
}
