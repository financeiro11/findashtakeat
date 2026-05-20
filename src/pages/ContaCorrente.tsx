import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload, Loader2, FileText, CreditCard, Wallet, Sparkles, Download,
  CheckCircle2, AlertTriangle, XCircle, Activity, ExternalLink,
  FileSpreadsheet, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { parseFile, RawTx } from "@/lib/parsers";
import { similarity } from "@/lib/normalize";
import { Rule } from "./DePara";

/* ─────────────────────────── Tipos ─────────────────────────── */

type Tipo = "cartao" | "conta";
type Status = "classified" | "suggested" | "unclassified" | "pending";

type Row = RawTx & {
  id: string;
  status: Status;
  categoria: string;
  centro_custo: string;
  conta: string;
  cliente_fornecedor: string;
  observacao: string;
  confianca?: number;
};

type HistItem = {
  id: string;
  nome: string;
  tipo: Tipo;
  lancamentos: number;
  enviado_em: string; // ISO
  confianca: number | null;
  revisar: number;
};

/* ─────────────────────────── Constantes ─────────────────────────── */

const WEBHOOK_URL = "https://webhook.takeat.cloud/webhook/receberArquivoFinanceiro";
const HIST_KEY = "planilhamento.historico.v1";

const ACCEPT: Record<Tipo, string> = { cartao: ".ofx,.txt", conta: ".html,.htm" };
const ALLOWED_EXT: Record<Tipo, string[]> = { cartao: ["ofx", "txt"], conta: ["html", "htm"] };

const STATUS_LABEL: Record<Status, { label: string; cls: string; icon: any }> = {
  classified:   { label: "Classificado",      cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  suggested:    { label: "Sugestão IA",       cls: "bg-amber-100 text-amber-700 border-amber-200",      icon: AlertTriangle },
  unclassified: { label: "Não classificado",  cls: "bg-rose-100 text-rose-700 border-rose-200",         icon: XCircle },
  pending:      { label: "Pendente",          cls: "bg-muted text-muted-foreground border-border",      icon: AlertTriangle },
};

const CAT_COLORS = [
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-sky-50 text-sky-700 border-sky-200",
  "bg-violet-50 text-violet-700 border-violet-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-teal-50 text-teal-700 border-teal-200",
  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
];

const getExt = (n: string) => { const i = n.lastIndexOf("."); return i >= 0 ? n.slice(i + 1).toLowerCase() : ""; };
const readFileAsText = (file: File): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result ?? ""));
  r.onerror = () => rej(r.error ?? new Error("Falha ao ler arquivo"));
  r.readAsText(file);
});
const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtBRLShort = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${n < 0 ? "-" : ""}R$ ${(abs / 1000).toFixed(1).replace(".", ",")}k`;
  return fmtBRL(n);
};
const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("pt-BR") + " · " + new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
};
const tipoBadge = (t: Tipo) => t === "conta" ? "BB" : "ITA"; // ilustrativo
const tipoLabel = (t: Tipo) => t === "conta" ? "Conta Corrente" : "Cartão de Crédito";

/* ─────────────────────────── Componente ─────────────────────────── */

export default function ContaCorrente() {
  /* envio (webhook) */
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<Tipo | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  /* planilhamento manual */
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [page, setPage] = useState(1);
  const [processing, setProcessing] = useState(false);
  const pageSize = 15;

  /* histórico */
  const [hist, setHist] = useState<HistItem[]>([]);
  const [activeHistId, setActiveHistId] = useState<string | null>(null);

  /* modo: envio (form) vs revisão (tabela) */
  const [mode, setMode] = useState<"envio" | "revisao">("envio");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIST_KEY);
      if (raw) setHist(JSON.parse(raw));
    } catch {}
  }, []);

  const saveHist = (items: HistItem[]) => {
    setHist(items);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(items)); } catch {}
  };

  /* ──── handlers de envio ──── */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f || !tipo) return setFile(f);
    const ext = getExt(f.name);
    if (!ALLOWED_EXT[tipo].includes(ext)) {
      toast.error(`Arquivo inválido. Esperado: ${ALLOWED_EXT[tipo].map((x) => "." + x).join(" ou ")}`);
      e.target.value = ""; setFile(null); return;
    }
    setFile(f);
    if (!nome) setNome(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    if (!nome.trim()) return toast.error("Informe o nome do arquivo no Sheets");
    if (!tipo) return toast.error("Selecione o tipo de extrato");
    if (!file) return toast.error("Selecione o arquivo");
    setSending(true);
    try {
      const conteudoArquivo = await readFileAsText(file);
      const r = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeSheets: nome.trim(), tipoExtrato: tipo, conteudoArquivo }),
      });
      if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(t || `Erro ${r.status}`); }
      const novo: HistItem = {
        id: crypto.randomUUID(), nome: nome.trim(), tipo: tipo as Tipo,
        lancamentos: 0, enviado_em: new Date().toISOString(), confianca: null, revisar: 0,
      };
      saveHist([novo, ...hist].slice(0, 30));
      toast.success("Arquivo enviado para automação");
      setNome(""); setTipo(""); setFile(null);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar");
    } finally { setSending(false); }
  };

  /* ──── handlers planilhamento manual ──── */
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const txs = await parseFile(f);
      if (!txs.length) return toast.error("Nenhum lançamento encontrado");
      setRows(txs.map((t, i) => ({
        ...t, id: `r${i}`, status: "pending",
        categoria: "", centro_custo: "", conta: "", cliente_fornecedor: "", observacao: "",
      })));
      setMode("revisao");
      setPage(1);
      toast.success(`${txs.length} lançamentos importados`);
    } catch (err: any) {
      toast.error("Falha ao ler arquivo: " + err.message);
    } finally { e.target.value = ""; }
  };

  const processAI = async () => {
    if (!rows.length) return;
    setProcessing(true);
    try {
      const { data: rulesData, error } = await supabase.from("de_para_rules").select("*");
      if (error) throw error;
      const rules = (rulesData as Rule[]) || [];
      const matched: Row[] = rows.map((r) => {
        let best: { rule: Rule; score: number } | null = null;
        for (const rule of rules) {
          if (rule.tipo !== r.tipo) continue;
          const s = similarity(r.descricao, rule.keyword);
          if (s >= 0.6 && (!best || s > best.score)) best = { rule, score: s };
        }
        if (best) {
          return {
            ...r, status: "classified",
            categoria: best.rule.categoria || "",
            centro_custo: best.rule.centro_custo || "",
            conta: best.rule.conta || "",
            cliente_fornecedor: best.rule.cliente_fornecedor || "",
            observacao: best.rule.observacao || "",
            confianca: Math.round(best.score * 100),
          };
        }
        return { ...r, status: "unclassified" };
      });

      const toAI = matched.map((r, idx) => ({ idx, r })).filter(({ r }) => r.status === "unclassified");
      if (toAI.length) {
        const { data: aiData, error: aiErr } = await supabase.functions.invoke("classify-transaction", {
          body: { transactions: toAI.map(({ r }) => ({ description: r.descricao, amount: r.valor, tipo: r.tipo })) },
        });
        if (aiErr) {
          const msg = (aiErr as any).context?.body || aiErr.message || "Erro IA";
          toast.error(typeof msg === "string" ? msg : "Erro IA");
        } else if (aiData?.results) {
          aiData.results.forEach((sugg: any, i: number) => {
            const rowIdx = toAI[i]?.idx; if (rowIdx == null) return;
            matched[rowIdx] = {
              ...matched[rowIdx], status: "suggested",
              categoria: sugg.categoria || "",
              centro_custo: sugg.centro_custo || "",
              conta: sugg.conta || "",
              cliente_fornecedor: sugg.cliente_fornecedor || "",
              observacao: sugg.observacao || "",
              confianca: sugg.confidence ? Math.round(sugg.confidence * 100) : 70,
            };
          });
        }
      }
      setRows(matched);
      toast.success("Processamento concluído");
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally { setProcessing(false); }
  };

  const acceptSuggestion = async (row: Row, saveAsRule: boolean) => {
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, status: "classified" } : r));
    if (saveAsRule) {
      const { error } = await supabase.from("de_para_rules").insert({
        keyword: row.descricao, tipo: row.tipo,
        categoria: row.categoria, centro_custo: row.centro_custo,
        conta: row.conta, cliente_fornecedor: row.cliente_fornecedor,
        observacao: row.observacao,
      });
      if (error) toast.error(error.message); else toast.success("Salvo no DE_PARA");
    }
  };

  const updateField = (id: string, field: keyof Row, value: string) => {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const exportOmie = () => {
    const data = rows.map((r) => ({
      "Data": r.data, "Descrição": r.descricao, "Valor": r.valor, "Tipo": r.tipo,
      "Categoria": r.categoria, "Centro de Custo": r.centro_custo, "Conta": r.conta,
      "Cliente/Fornecedor": r.cliente_fornecedor, "Observação": r.observacao,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Omie");
    XLSX.writeFile(wb, `omie_planilhamento.xlsx`);
  };

  /* ──── derivados ──── */
  const filteredRows = useMemo(
    () => rows.filter((r) => filter === "all" || r.status === filter),
    [rows, filter]
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const counts = useMemo(() => ({
    total: rows.length,
    classified: rows.filter((r) => r.status === "classified").length,
    suggested: rows.filter((r) => r.status === "suggested").length,
    unclassified: rows.filter((r) => r.status === "unclassified").length,
    entradas: rows.filter((r) => r.valor > 0).reduce((s, r) => s + r.valor, 0),
    saidas: rows.filter((r) => r.valor < 0).reduce((s, r) => s + r.valor, 0),
  }), [rows]);

  const confiancaMedia = useMemo(() => {
    const cs = rows.map((r) => r.confianca).filter((c): c is number => typeof c === "number");
    if (!cs.length) return null;
    return Math.round(cs.reduce((a, b) => a + b, 0) / cs.length);
  }, [rows]);

  const pendentesRevisao = counts.suggested + counts.unclassified;
  const categoriasDistribuicao = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => { if (r.categoria) m.set(r.categoria, (m.get(r.categoria) || 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  /* ─────────────────────────── render ─────────────────────────── */

  return (
    <div className="space-y-5 p-5">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Planilhamento</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              <Sparkles className="h-3 w-3" /> Automação IA
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Envie extratos bancários para o pipeline de planilhamento automático ·
            <span className="font-mono ml-1">conta corrente .html</span> ·
            <span className="font-mono ml-1">cartão de crédito .ofx/.txt</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={mode === "envio" ? "default" : "outline"}
            size="sm"
            className="gap-2"
            onClick={() => setMode("envio")}
          >
            <FileText className="h-4 w-4" /> Planilhamento manual
          </Button>
          <Button
            variant={mode === "revisao" ? "default" : "outline"}
            size="sm"
            className="gap-2"
            onClick={() => setMode("revisao")}
          >
            <FileSpreadsheet className="h-4 w-4" /> Lançamentos categorizados
            {pendentesRevisao > 0 && (
              <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                {pendentesRevisao}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiBlock
          label="Extratos este mês"
          value={hist.length ? String(hist.length) : "—"}
          sub={hist.length ? `${hist.filter(h => h.tipo === "conta").length} conta corrente · ${hist.filter(h => h.tipo === "cartao").length} cartões` : "Sem envios"}
        />
        <KpiBlock
          label="Lançamentos categorizados"
          value={counts.total ? String(counts.total) : "—"}
          sub={counts.total ? `${counts.classified} automáticos · ${counts.suggested} p/ revisar` : "Sem dados"}
        />
        <KpiBlock
          label="Confiança média IA"
          value={confiancaMedia !== null ? `${confiancaMedia}%` : "—"}
          sub={confiancaMedia !== null ? `sobre ${categoriasDistribuicao.length} categorias · meta > 95%` : "Aguardando processamento"}
        />
        <KpiBlock
          label="Pendentes de revisão"
          value={pendentesRevisao ? String(pendentesRevisao) : "—"}
          sub={pendentesRevisao ? "lançamentos para revisar" : "Nada pendente"}
          tone={pendentesRevisao ? "warn" : "muted"}
        />
      </div>

      {/* Grid principal */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* Coluna esquerda: envio + histórico */}
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold tracking-tight">Envio de extrato financeiro</h2>
              <p className="text-[11.5px] text-muted-foreground">
                O conteúdo do arquivo é lido e enviado de forma segura ao fluxo de automação.
              </p>
            </header>
            <div className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="nome" className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Nome do arquivo no Sheets *
                </Label>
                <div className="relative">
                  <Input
                    id="nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex: BB CC ABRIL 2026"
                    maxLength={200}
                    disabled={sending}
                    className="pr-24"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    auto-sugerido
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Tipo de Extrato *
                </Label>
                <RadioGroup
                  value={tipo}
                  onValueChange={(v) => { setTipo(v as Tipo); setFile(null); }}
                  disabled={sending}
                  className="gap-2"
                >
                  <TipoOption
                    selected={tipo === "conta"}
                    value="conta"
                    icon={<Wallet className="h-4 w-4" />}
                    title="Conta Corrente"
                    desc="arquivo .html exportado do internet banking"
                  />
                  <TipoOption
                    selected={tipo === "cartao"}
                    value="cartao"
                    icon={<CreditCard className="h-4 w-4" />}
                    title="Cartão de Crédito"
                    desc="fatura .ofx ou .txt exportada do app do banco"
                  />
                </RadioGroup>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Arquivo
                </Label>
                {!file ? (
                  <label
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center text-[12.5px] transition-colors",
                      tipo && !sending
                        ? "cursor-pointer border-border hover:bg-secondary/50"
                        : "cursor-not-allowed border-border/50 text-muted-foreground"
                    )}
                  >
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    {!tipo
                      ? <span>Selecione o tipo de extrato primeiro</span>
                      : <span>Clique para selecionar <span className="font-mono text-[11px] text-muted-foreground">({ACCEPT[tipo]})</span></span>}
                    <input
                      type="file" hidden disabled={!tipo || sending}
                      accept={tipo ? ACCEPT[tipo] : undefined}
                      onChange={handleFileChange}
                    />
                  </label>
                ) : (
                  <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-medium text-emerald-900">{file.name}</div>
                        <div className="text-[11px] text-emerald-700/80">
                          {(file.size / 1024).toFixed(0)} kB · pronto para envio
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="sm" className="h-7 text-[11px] text-emerald-800 hover:bg-emerald-100"
                      onClick={() => setFile(null)} disabled={sending}
                    >
                      Trocar
                    </Button>
                  </div>
                )}
              </div>

              <Button
                onClick={submit}
                disabled={sending || !nome || !tipo || !file}
                className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                size="lg"
              >
                {sending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
                  : <><Sparkles className="h-4 w-4" /> Enviar e categorizar com IA</>}
              </Button>
            </div>
          </section>

          {/* Histórico */}
          <section className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
                  <History className="h-4 w-4 text-muted-foreground" /> Histórico de envios
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {hist.length ? `${hist.length} extrato${hist.length > 1 ? "s" : ""} · últimos 60 dias` : "Nenhum envio ainda"}
                </p>
              </div>
              {hist.length > 0 && (
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => saveHist([])}
                >
                  limpar
                </button>
              )}
            </header>
            <div className="max-h-[420px] overflow-y-auto">
              {hist.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                  Após o primeiro envio, o histórico aparece aqui.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {hist.map((h) => (
                    <li key={h.id}>
                      <button
                        onClick={() => setActiveHistId(h.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50",
                          activeHistId === h.id && "bg-secondary/70 border-l-2 border-primary"
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-[10px] font-semibold tracking-wider text-foreground/80">
                          {tipoBadge(h.tipo)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] font-medium">{h.nome}</span>
                            {h.revisar > 0 && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-amber-700">
                                {h.revisar} rev
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {tipoLabel(h.tipo)} · {h.lancamentos || "—"} lanç. · {fmtDate(h.enviado_em)}
                          </div>
                        </div>
                        {h.confianca !== null && (
                          <div className="shrink-0 text-right">
                            <div className="text-[12px] font-semibold text-emerald-700">{h.confianca}%</div>
                            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">confiança</div>
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* Coluna direita: OUTPUT IA */}
        <section className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
          <header className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Output IA · Planilha categorizada
                </span>
                {processing
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9.5px] font-semibold uppercase text-amber-700"><Loader2 className="h-2.5 w-2.5 animate-spin" /> Processando</span>
                  : rows.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9.5px] font-semibold uppercase text-emerald-700"><Activity className="h-2.5 w-2.5" /> Live</span>}
              </div>
              <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">
                {rows.length ? (nome || "Planilha em revisão") : "Nenhuma planilha carregada"}
              </h2>
              <p className="text-[11.5px] text-muted-foreground">
                {rows.length
                  ? `${counts.total} lançamento${counts.total > 1 ? "s" : ""} · processado ${new Date().toLocaleDateString("pt-BR")}`
                  : "Importe um extrato à direita ou envie um arquivo à esquerda para gerar a categorização."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={importInputRef} type="file" hidden accept=".xlsx,.csv,.ofx" onChange={handleImport} />
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => importInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Importar extrato
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={processAI} disabled={!rows.length || processing}>
                {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Processar IA
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={!rows.length}>
                <ExternalLink className="h-3.5 w-3.5" /> Abrir no Sheets
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={exportOmie} disabled={!rows.length}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button size="sm" className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90" disabled={!rows.length}>
                Exportar p/ Omie
              </Button>
            </div>
          </header>

          {/* Sub-resumo */}
          <div className="grid grid-cols-2 gap-px border-b border-border bg-border/60 lg:grid-cols-4">
            <MiniStat label="Lançamentos" value={counts.total ? String(counts.total) : "—"} />
            <MiniStat label="Entradas" value={counts.entradas ? fmtBRLShort(counts.entradas) : "—"} tone="pos" />
            <MiniStat label="Saídas" value={counts.saidas ? fmtBRLShort(counts.saidas) : "—"} tone="neg" />
            <MiniStat label="Categorias detectadas" value={categoriasDistribuicao.length ? String(categoriasDistribuicao.length) : "—"} />
          </div>

          {/* Distribuição por categoria */}
          <div className="border-b border-border px-4 py-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Distribuição por categoria
            </div>
            {categoriasDistribuicao.length === 0 ? (
              <div className="text-[12px] text-muted-foreground">
                Processe lançamentos para visualizar as categorias detectadas pela IA.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {categoriasDistribuicao.map(([cat, count], i) => (
                  <span
                    key={cat}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                      CAT_COLORS[i % CAT_COLORS.length]
                    )}
                  >
                    {cat}
                    <span className="rounded-full bg-white/70 px-1.5 text-[10px] font-semibold">{count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Filtros */}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700">{counts.classified} classificados</Badge>
                <Badge className="border-amber-200 bg-amber-100 text-amber-700">{counts.suggested} sugestões</Badge>
                <Badge className="border-rose-200 bg-rose-100 text-rose-700">{counts.unclassified} não classificados</Badge>
              </div>
              <Select value={filter} onValueChange={(v: any) => { setFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="classified">Classificados</SelectItem>
                  <SelectItem value="suggested">Sugestões pendentes</SelectItem>
                  <SelectItem value="unclassified">Não classificados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Tabela */}
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="rounded-full bg-secondary p-3">
                <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm font-medium">Nenhum lançamento carregado</div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Importe um extrato (.xlsx, .csv ou .ofx) ou aguarde o retorno da automação.
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => importInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Importar agora
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-20 text-[10px] uppercase tracking-wider">Data</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Descrição</TableHead>
                      <TableHead className="w-32 text-right text-[10px] uppercase tracking-wider">Valor</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Categoria · IA</TableHead>
                      <TableHead className="w-20 text-right text-[10px] uppercase tracking-wider">Conf.</TableHead>
                      <TableHead className="w-28 text-[10px] uppercase tracking-wider">Status</TableHead>
                      <TableHead className="w-28 text-right text-[10px] uppercase tracking-wider">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((r, i) => {
                      const s = STATUS_LABEL[r.status]; const Icon = s.icon;
                      const catColor = r.categoria
                        ? CAT_COLORS[Math.abs(hash(r.categoria)) % CAT_COLORS.length]
                        : "bg-muted text-muted-foreground border-border";
                      return (
                        <TableRow key={r.id} className="hover:bg-secondary/40">
                          <TableCell className="font-mono text-[11.5px] text-muted-foreground">{r.data}</TableCell>
                          <TableCell className="text-[12px]">{r.descricao}</TableCell>
                          <TableCell className={cn(
                            "text-right font-mono text-[12px] font-semibold tabular-nums",
                            r.valor > 0 ? "text-emerald-700" : "text-foreground"
                          )}>
                            {r.valor > 0 ? "+" : ""}{fmtBRL(r.valor)}
                          </TableCell>
                          <TableCell>
                            <InlineCategory
                              value={r.categoria}
                              onChange={(v) => updateField(r.id, "categoria", v)}
                              colorClass={catColor}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <ConfBar value={r.confianca ?? null} />
                          </TableCell>
                          <TableCell>
                            <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium", s.cls)}>
                              <Icon className="h-3 w-3" /> {s.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {r.status === "suggested" ? (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => acceptSuggestion(r, false)}>OK</Button>
                                <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => acceptSuggestion(r, true)}>+ DE_PARA</Button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
                <span>{filteredRows.length} lançamentos · {counts.classified}/{counts.total} classificados</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                  <span>Página {page} de {totalPages}</span>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ─────────────────────────── sub-componentes ─────────────────────────── */

function KpiBlock({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" | "warn" | "muted" }) {
  const valueColor =
    tone === "pos" ? "text-emerald-700" :
    tone === "neg" ? "text-rose-700" :
    tone === "warn" ? "text-amber-700" :
    "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums", valueColor)}>{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const c = tone === "pos" ? "text-emerald-700" : tone === "neg" ? "text-rose-700" : "text-foreground";
  return (
    <div className="bg-card px-4 py-2.5">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-[16px] font-semibold tracking-tight tabular-nums", c)}>{value}</div>
    </div>
  );
}

function TipoOption({
  selected, value, icon, title, desc,
}: { selected: boolean; value: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <label className={cn(
      "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors",
      selected ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/60"
    )}>
      <RadioGroupItem value={value} id={`tipo-${value}`} className="mt-0.5" />
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="flex-1">
        <span className="block text-[12.5px] font-medium leading-tight">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{desc}</span>
      </span>
      {selected && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-primary">
          Selecionado
        </span>
      )}
    </label>
  );
}

function InlineCategory({ value, onChange, colorClass }: { value: string; onChange: (v: string) => void; colorClass: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <Input
        autoFocus
        defaultValue={value}
        onBlur={(e) => { onChange(e.target.value); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === "Enter") { onChange((e.target as HTMLInputElement).value); setEditing(false); } }}
        className="h-7 text-[11.5px]"
      />
    );
  }
  if (!value) {
    return (
      <button onClick={() => setEditing(true)} className="text-[11px] text-muted-foreground hover:text-foreground">
        + categoria
      </button>
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", colorClass)}
    >
      {value}
    </button>
  );
}

function ConfBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-muted-foreground">—</span>;
  const color = value >= 90 ? "bg-emerald-500" : value >= 75 ? "bg-amber-500" : "bg-rose-500";
  const text = value >= 90 ? "text-emerald-700" : value >= 75 ? "text-amber-700" : "text-rose-700";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${value}%` }} />
      </div>
      <span className={cn("text-[11px] font-semibold tabular-nums", text)}>{value}%</span>
    </div>
  );
}

function hash(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
