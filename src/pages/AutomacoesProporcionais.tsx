import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  RefreshCw, Loader2, ExternalLink, Check, X, MessageSquare, Search,
  CheckCircle2, Clock, Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1fwt-sosZW-YRkV-uNyE06sE40ZLwdlkh3fjbo50VU8o/edit";

type SheetData = { headers: string[]; rows: string[][]; approvalCol: number; sheet: string };
type Status = "pendente" | "aprovado" | "recusado" | "enviado";
type StatusFilter = "todos" | "pendente" | "aprovado" | "recusado";

const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTHS_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Encontra a primeira coluna cujo cabeçalho contém um dos sinônimos. */
function findCol(headers: string[], syns: string[]): number {
  return headers.findIndex((h) => syns.some((sy) => norm(h).includes(sy)));
}

function parseMoney(s?: string): number | null {
  if (s == null) return null;
  const t = String(s).replace(/[^\d,.-]/g, "").trim();
  if (!t) return null;
  const n = t.includes(",") ? parseFloat(t.replace(/\./g, "").replace(",", ".")) : parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmtBRL = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthAbbr = (d: Date) => `${MONTHS_ABBR[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}
const AVATAR_COLORS = ["0 72% 45%", "24 78% 46%", "152 52% 38%", "212 68% 46%", "260 52% 54%", "330 62% 50%", "190 62% 40%", "40 82% 46%"];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

type Rec = {
  idx: number;
  nome: string;
  telefone: string;
  inicio: Date | null;
  remuneracao: number | null;
  proporcional: number | null;
  mensagem: string;
  approvalRaw: string;
  envioRaw: string;
  sent: boolean;
  status: Status;
};

export default function AutomacoesProporcionais() {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [monthFilter, setMonthFilter] = useState<string>("todos");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<Rec | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("proporcionais-sheet", { body: { action: "read" } });
      if (err) throw new Error(err.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      setData(res as SheetData);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Mapeamento heurístico das colunas da planilha → campos do design.
  const cols = useMemo(() => {
    const h = data?.headers ?? [];
    return {
      nome: findCol(h, ["colaborador", "nome", "funcionario"]),
      telefone: findCol(h, ["telefone", "whatsapp", "celular", "fone", "contato"]),
      inicio: findCol(h, ["inicio", "entrada", "admiss", "entrou", "comeco", "data"]),
      remuneracao: findCol(h, ["remuner", "salario", "vencimento"]),
      proporcional: findCol(h, ["proporcional"]),
      mensagem: findCol(h, ["mensagem", "texto", "msg"]),
      envio: findCol(h, ["envio", "enviad", "disparo", "status"]),
      aprovacao: data?.approvalCol ?? -1,
    };
  }, [data]);

  const records = useMemo<Rec[]>(() => {
    if (!data) return [];
    const g = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
    return data.rows.map((row, idx) => {
      const nome = g(row, cols.nome) || `Linha ${idx + 2}`;
      const approvalRaw = g(row, cols.aprovacao);
      const envioRaw = g(row, cols.envio);
      const sent = cols.envio >= 0 && /enviad|sim|ok|✓|conclu|\d{2}\/\d{2}/i.test(envioRaw);
      const approved = /^s/i.test(approvalRaw);
      const refused = /^n/i.test(approvalRaw);
      const status: Status = sent ? "enviado" : approved ? "aprovado" : refused ? "recusado" : "pendente";
      return {
        idx,
        nome,
        telefone: g(row, cols.telefone),
        inicio: parseDate(g(row, cols.inicio)),
        remuneracao: parseMoney(g(row, cols.remuneracao)),
        proporcional: parseMoney(g(row, cols.proporcional)),
        mensagem: g(row, cols.mensagem),
        approvalRaw,
        envioRaw,
        sent,
        status,
      };
    });
  }, [data, cols]);

  // Meses disponíveis (chips "Entraram em")
  const months = useMemo(() => {
    const map = new Map<string, Date>();
    for (const r of records) if (r.inicio) map.set(monthKey(r.inicio), r.inicio);
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, d]) => ({ key: k, label: monthAbbr(d) }));
  }, [records]);

  const byMonth = useMemo(
    () => records.filter((r) => monthFilter === "todos" || (r.inicio && monthKey(r.inicio) === monthFilter)),
    [records, monthFilter],
  );

  const counts = useMemo(() => {
    const c = { todos: byMonth.length, pendente: 0, aprovado: 0, recusado: 0, enviado: 0 };
    for (const r of byMonth) c[r.status]++;
    return c;
  }, [byMonth]);

  const filtered = useMemo(() => {
    const q = norm(query);
    return byMonth.filter((r) => {
      if (statusFilter !== "todos" && r.status !== statusFilter) return false;
      if (q && !norm(r.nome).includes(q) && !norm(r.telefone).includes(q)) return false;
      return true;
    });
  }, [byMonth, statusFilter, query]);

  // Agrupa por mês para as seções
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; sortKey: string; rows: Rec[] }>();
    for (const r of filtered) {
      const key = r.inicio ? monthKey(r.inicio) : "sem-data";
      const label = r.inicio ? MONTHS_FULL[r.inicio.getMonth()] : "Sem data de entrada";
      if (!map.has(key)) map.set(key, { label, sortKey: key, rows: [] });
      map.get(key)!.rows.push(r);
    }
    return [...map.values()].sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [filtered]);

  const totalProporcional = useMemo(() => {
    const pend = byMonth.filter((r) => !r.sent);
    const soma = pend.reduce((acc, r) => acc + (r.proporcional ?? 0), 0);
    return { soma, n: pend.length };
  }, [byMonth]);

  const monthLabel = monthFilter === "todos" ? "Todos os períodos" : months.find((m) => m.key === monthFilter)?.label ?? "";

  async function setApproval(idx: number, value: "Sim" | "Não") {
    if (!data || cols.aprovacao < 0) {
      toast({ title: "Coluna de aprovação não encontrada", description: "Não há coluna \"Pode enviar\" na planilha.", variant: "destructive" });
      return;
    }
    const key = `${idx}:${cols.aprovacao}`;
    setSavingKey(key);
    try {
      const { error: err, data: res } = await supabase.functions.invoke("proporcionais-sheet", {
        body: { action: "update", rowIndex: idx, colIndex: cols.aprovacao, value },
      });
      if (err) throw new Error(err.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      setData((d) => {
        if (!d) return d;
        const rows = d.rows.map((r, i) => {
          if (i !== idx) return r;
          const copy = [...r];
          copy[cols.aprovacao] = value;
          return copy;
        });
        return { ...d, rows };
      });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  }

  async function approveMany(recs: Rec[], tag: string) {
    if (!recs.length) return;
    setBulkBusy(tag);
    let ok = 0;
    for (const r of recs) {
      // eslint-disable-next-line no-await-in-loop
      await setApproval(r.idx, "Sim");
      ok++;
    }
    setBulkBusy(null);
    setSelected(new Set());
    toast({ title: "Aprovações gravadas", description: `${ok} colaborador(es) marcados como "Sim" na planilha.` });
  }

  const hasData = data && records.length > 0;

  return (
    <div className="space-y-5 p-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Aprove o envio da mensagem de boas-vindas no WhatsApp · coluna <span className="font-medium text-foreground">“Pode enviar”</span>
        </p>
        <div className="flex shrink-0 gap-2">
          <button className="ghost-btn" onClick={() => window.open(SHEET_URL, "_blank")}>
            <ExternalLink className="h-3.5 w-3.5" /> Abrir planilha
          </button>
          <button className="ghost-btn" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Atualizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pendentes de aprovação" value={String(counts.pendente)} valueTone="neg" subline={monthLabel} />
        <KpiCard label="Aprovados · na fila" value={String(counts.aprovado)} subline="aguardando disparo" />
        <KpiCard label="Já enviados" value={String(counts.enviado)} valueTone="pos" subline="confirmado no WhatsApp" />
        <KpiCard label="Total proporcional" value={fmtBRL(totalProporcional.soma)} subline={`${totalProporcional.n} colaborador(es)`} />
      </div>

      {/* Filtros */}
      <div className="card-surface flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">Entraram em</span>
          <FilterChip active={monthFilter === "todos"} onClick={() => setMonthFilter("todos")}>Todos</FilterChip>
          {months.map((m) => (
            <FilterChip key={m.key} active={monthFilter === m.key} onClick={() => setMonthFilter(m.key)}>{m.label}</FilterChip>
          ))}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              className="h-8 w-64 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <StatusTab active={statusFilter === "todos"} onClick={() => setStatusFilter("todos")} count={counts.todos}>Todos</StatusTab>
          <StatusTab active={statusFilter === "pendente"} onClick={() => setStatusFilter("pendente")} count={counts.pendente}>Pendentes</StatusTab>
          <StatusTab active={statusFilter === "aprovado"} onClick={() => setStatusFilter("aprovado")} count={counts.aprovado}>Aprovados</StatusTab>
          <StatusTab active={statusFilter === "recusado"} onClick={() => setStatusFilter("recusado")} count={counts.recusado}>Recusados</StatusTab>
        </div>
      </div>

      {/* Estados */}
      {error && <div className="card-surface p-4 text-sm text-destructive">{error}</div>}
      {loading && !data && (
        <div className="card-surface flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lendo planilha…
        </div>
      )}
      {hasData && filtered.length === 0 && !loading && (
        <div className="card-surface p-10 text-center text-sm text-muted-foreground">Nenhum colaborador para os filtros atuais.</div>
      )}

      {/* Seções por mês */}
      {groups.map((g) => {
        const pending = g.rows.filter((r) => r.status === "pendente");
        const selectedHere = g.rows.filter((r) => selected.has(r.idx));
        const bulkTargets = selectedHere.length ? selectedHere : pending;
        const bulkLabel = selectedHere.length
          ? `Aprovar ${selectedHere.length} selecionado(s)`
          : `Aprovar todos os ${pending.length} pendentes`;
        const busy = bulkBusy === g.sortKey;
        const allChecked = g.rows.length > 0 && g.rows.every((r) => selected.has(r.idx));
        return (
          <div key={g.sortKey} className="card-surface overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="text-sm font-semibold">
                {g.label} <span className="font-normal text-muted-foreground">· {g.rows.length} colaborador(es)</span>
              </div>
              {bulkTargets.length > 0 && (
                <Button
                  size="sm"
                  disabled={busy || cols.aprovacao < 0}
                  onClick={() => approveMany(bulkTargets, g.sortKey)}
                  className="h-8 bg-[hsl(var(--pos))] text-white hover:bg-[hsl(var(--pos)/0.88)]"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {bulkLabel}
                </Button>
              )}
            </div>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={(v) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            g.rows.forEach((r) => (v ? next.add(r.idx) : next.delete(r.idx)));
                            return next;
                          });
                        }}
                        aria-label="Selecionar todos"
                      />
                    </TableHead>
                    <TableHead>Início</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead className="text-right">Remuneração</TableHead>
                    <TableHead className="text-right">Proporcional</TableHead>
                    <TableHead>Mensagem</TableHead>
                    <TableHead className="min-w-[150px]">Pode enviar?</TableHead>
                    <TableHead>Envio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((r) => {
                    const saving = savingKey === `${r.idx}:${cols.aprovacao}`;
                    return (
                      <TableRow key={r.idx} className={selected.has(r.idx) ? "bg-secondary/40" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(r.idx)}
                            onCheckedChange={(v) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                v ? next.add(r.idx) : next.delete(r.idx);
                                return next;
                              })
                            }
                            aria-label={`Selecionar ${r.nome}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {r.inicio ? (
                            <div className="flex flex-col leading-tight">
                              <span className="num">{r.inicio.toLocaleDateString("pt-BR")}</span>
                              <span className="text-[11px] text-muted-foreground">{monthAbbr(r.inicio)}</span>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                              style={{ backgroundColor: `hsl(${avatarColor(r.nome)})` }}
                            >
                              {initials(r.nome)}
                            </span>
                            <div className="flex min-w-0 flex-col leading-tight">
                              <span className="truncate text-sm font-medium">{r.nome}</span>
                              {r.telefone && <span className="num truncate text-[11px] text-muted-foreground">{r.telefone}</span>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-right text-sm">{fmtBRL(r.remuneracao)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-right text-sm font-semibold">{fmtBRL(r.proporcional)}</TableCell>
                        <TableCell>
                          <button className="ghost-btn h-7 px-2 text-xs" onClick={() => setPreview(r)}>
                            <MessageSquare className="h-3.5 w-3.5" /> Prévia
                          </button>
                        </TableCell>
                        <TableCell>
                          {r.sent ? (
                            <Badge className="gap-1 bg-[hsl(var(--pos)/0.12)] text-[hsl(var(--pos))] hover:bg-[hsl(var(--pos)/0.12)]">
                              <CheckCircle2 className="h-3 w-3" /> Aprovado
                            </Badge>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant={r.status === "aprovado" ? "default" : "outline"}
                                disabled={saving}
                                onClick={() => setApproval(r.idx, "Sim")}
                                className={cn("h-7 px-2", r.status === "aprovado" && "bg-[hsl(var(--pos))] hover:bg-[hsl(var(--pos)/0.88)]")}
                              >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Sim
                              </Button>
                              <Button
                                size="sm"
                                variant={r.status === "recusado" ? "destructive" : "outline"}
                                disabled={saving}
                                onClick={() => setApproval(r.idx, "Não")}
                                className="h-7 px-2"
                              >
                                <X className="h-3.5 w-3.5" /> Não
                              </Button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {r.sent ? (
                            <span className="inline-flex items-center gap-1.5 text-[hsl(var(--pos))]">
                              <Send className="h-3.5 w-3.5" /> Enviado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" />
                              {r.status === "aprovado" ? "Aguardando envio" : "Aguardando aprovação"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}

      {/* Prévia da mensagem */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Prévia da mensagem</DialogTitle>
            <DialogDescription>{preview?.nome}{preview?.telefone ? ` · ${preview.telefone}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="whitespace-pre-wrap rounded-lg border border-border bg-[hsl(152_40%_96%)] p-3 text-sm leading-relaxed text-foreground">
            {preview ? messagePreview(preview) : ""}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function messagePreview(r: Rec): string {
  if (r.mensagem) return r.mensagem;
  const primeiro = r.nome.split(/\s+/)[0];
  const mes = r.inicio ? MONTHS_FULL[r.inicio.getMonth()] : "";
  return [
    `Olá, ${primeiro}! 👋`,
    "",
    `Segue o pagamento do seu salário proporcional${mes ? ` referente a ${mes}` : ""}:`,
    "",
    `• Remuneração: ${fmtBRL(r.remuneracao)}`,
    `• Proporcional: ${fmtBRL(r.proporcional)}`,
    "",
    "Qualquer dúvida, estamos à disposição. 🙌",
  ].join("\n");
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "chip h-7 cursor-pointer transition-colors",
        active && "!border-primary !bg-primary !text-primary-foreground",
      )}
    >
      {children}
    </button>
  );
}

function StatusTab({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span className={cn("num rounded-full px-1.5 text-[10px]", active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-secondary")}>{count}</span>
    </button>
  );
}
