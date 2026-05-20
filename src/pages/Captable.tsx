import { useEffect, useMemo, useState } from "react";
import {
  Plus, Trash2, Pencil, Search, SlidersHorizontal, FileDown,
  Calendar as CalendarIcon, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ============== Tipos ============== */
type Round = {
  id: string;
  nome: string;
  data: string;
  moeda: "BRL" | "USD";
  showCredit: boolean;
  cor: string; // hsl token name: slate|blue|rose|amber|emerald|violet|cyan|pink
};
type Shareholder = { id: string; nome: string };
type Cell = { shares: number; credit: number };
type State = { shareholders: Shareholder[]; rounds: Round[]; cells: Record<string, Cell> };

const STORAGE_KEY = "captable.v2";

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtBRLcompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(2).replace(".", ",")}M`;
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toFixed(0)}k`;
  return fmtBRL(n);
};
const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtNum = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;
const fmtPct3 = (n: number) => `${n.toFixed(3).replace(".", ",")}%`;
const fmtMesAno = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
const fmtDataLonga = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

/* Paleta de cores para rodadas — chips, headers, dots da timeline */
const ROUND_PALETTE: Record<string, { soft: string; ring: string; bar: string; text: string }> = {
  slate:   { soft: "bg-slate-100 dark:bg-slate-800/60",   ring: "ring-slate-400",   bar: "bg-slate-400",   text: "text-slate-700 dark:text-slate-200" },
  blue:    { soft: "bg-blue-100 dark:bg-blue-950/40",     ring: "ring-blue-400",    bar: "bg-blue-500",    text: "text-blue-700 dark:text-blue-300" },
  rose:    { soft: "bg-rose-100 dark:bg-rose-950/40",     ring: "ring-rose-400",    bar: "bg-rose-500",    text: "text-rose-700 dark:text-rose-300" },
  amber:   { soft: "bg-amber-100 dark:bg-amber-950/40",   ring: "ring-amber-400",   bar: "bg-amber-500",   text: "text-amber-700 dark:text-amber-300" },
  emerald: { soft: "bg-emerald-100 dark:bg-emerald-950/40", ring: "ring-emerald-400", bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  violet:  { soft: "bg-violet-100 dark:bg-violet-950/40", ring: "ring-violet-400",  bar: "bg-violet-500",  text: "text-violet-700 dark:text-violet-300" },
  cyan:    { soft: "bg-cyan-100 dark:bg-cyan-950/40",     ring: "ring-cyan-400",    bar: "bg-cyan-500",    text: "text-cyan-700 dark:text-cyan-300" },
  pink:    { soft: "bg-pink-100 dark:bg-pink-950/40",     ring: "ring-pink-400",    bar: "bg-pink-500",    text: "text-pink-700 dark:text-pink-300" },
};
const COLOR_KEYS = Object.keys(ROUND_PALETTE);

/* ============== Seed inicial ============== */
const SEED: State = (() => {
  const rounds: Round[] = [
    { id: "r1", nome: "Class A Ordinary", data: "2020-01-01", moeda: "BRL", showCredit: false, cor: "slate" },
    { id: "r2", nome: "Class B Ordinary", data: "2020-06-01", moeda: "BRL", showCredit: false, cor: "slate" },
    { id: "r3", nome: "Series Seed 1",   data: "2021-02-28", moeda: "BRL", showCredit: true,  cor: "blue" },
    { id: "r4", nome: "Series Seed 2",   data: "2022-03-31", moeda: "BRL", showCredit: true,  cor: "rose" },
    { id: "r5", nome: "Series Seed 3",   data: "2023-04-30", moeda: "BRL", showCredit: true,  cor: "amber" },
    { id: "r6", nome: "Series Seed 4",   data: "2024-01-31", moeda: "BRL", showCredit: true,  cor: "emerald" },
    { id: "r7", nome: "Series A (R$)",   data: "2026-01-14", moeda: "BRL", showCredit: true,  cor: "violet" },
    { id: "r8", nome: "Series A (USD)",  data: "2026-01-14", moeda: "USD", showCredit: false, cor: "cyan" },
  ];
  const sh: Shareholder[] = [
    { id: "s1", nome: "Miguel Carvalho" },
    { id: "s2", nome: "SOP" },
    { id: "s3", nome: "Guilherme Ferreira" },
    { id: "s4", nome: "Acelera Espírito Santo LTDA (Funses1)" },
    { id: "s5", nome: "M3 Investimentos LTDA" },
    { id: "s6", nome: "Luis Claudio Silva Frade" },
    { id: "s7", nome: "Peter Celso Godoi" },
    { id: "s8", nome: "Flávio José Moritz Junior" },
    { id: "s9", nome: "Andries Oudshoorn" },
    { id: "s10", nome: "Alya Ventures/Sidecar" },
    { id: "s11", nome: "Gustavo Fehlberg" },
    { id: "s12", nome: "Rafael Furlanetti" },
    { id: "s13", nome: "DGF" },
  ];
  const c: Record<string, Cell> = {};
  const set = (sId: string, rId: string, shares: number, credit = 0) => {
    c[`${sId}:${rId}`] = { shares, credit };
  };
  set("s1", "r1", 42969);
  set("s2", "r2", 11566);
  set("s3", "r3", 5706, 70000);
  set("s4", "r4", 5502, 400000);
  set("s4", "r5", 1448, 540000);
  set("s4", "r7", 3050, 1525000);
  set("s5", "r5", 724, 270000);
  set("s5", "r7", 276, 138000);
  set("s6", "r5", 134, 50000);
  set("s6", "r7", 51, 25500);
  set("s7", "r5", 54, 20000);
  set("s7", "r7", 20, 10000);
  set("s8", "r5", 80, 30000);
  set("s8", "r7", 31, 15500);
  set("s9", "r5", 134, 50000);
  set("s9", "r7", 51, 25500);
  set("s10", "r5", 215, 80000);
  set("s11", "r5", 363, 135000);
  set("s12", "r5", 1448, 540000);
  set("s12", "r6", 2178, 0);
  set("s13", "r7", 24000, 12000000);
  return { shareholders: sh, rounds, cells: c };
})();

/* ============== Helpers ============== */
const isInstitutional = (nome: string) =>
  /(LTDA|FUND|CAPITAL|VENTURES|SIDECAR|DGF|S\/?A|INVESTIMENTOS|INVEST)/i.test(nome);
const isSOP = (nome: string) => /^SOP$/i.test(nome) || /stock\s*option/i.test(nome);

const initials = (nome: string) => {
  const w = nome.replace(/[()]/g, "").split(/\s+/).filter(Boolean);
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
};

/* Hash determinístico → cor de avatar baseada em hue */
const avatarStyle = (id: string): React.CSSProperties => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return { backgroundColor: `hsl(${h} 55% 92%)`, color: `hsl(${h} 60% 28%)` };
};
const ownershipBarColor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 55%)`;
};

/* ============== Página ============== */
export default function Captable() {
  const [state, setState] = useState<State>(SEED);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [tab, setTab] = useState<string>("resumo");
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<{ sId: string; rId: string } | null>(null);
  const [draftShares, setDraftShares] = useState("0");
  const [draftCredit, setDraftCredit] = useState("0");

  const [openShareholder, setOpenShareholder] = useState<Shareholder | null>(null);
  const [openRound, setOpenRound] = useState<Round | null>(null);
  const [newSh, setNewSh] = useState(false);
  const [newRd, setNewRd] = useState(false);

  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setState(JSON.parse(raw)); } catch {}
  }, []);
  const save = (s: State) => { setState(s); localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); };

  /* Filtro por ano */
  const visibleRounds = useMemo(() => {
    const sorted = state.rounds.slice().sort((a, b) => a.data.localeCompare(b.data));
    if (yearFilter === "all") return sorted;
    return sorted.filter(r => r.data <= `${yearFilter}-12-31`);
  }, [state.rounds, yearFilter]);

  const cell = (sId: string, rId: string): Cell =>
    state.cells[`${sId}:${rId}`] || { shares: 0, credit: 0 };

  /* Totais por rodada */
  const totaisPorRodada = useMemo(() => {
    const m: Record<string, { shares: number; credit: number }> = {};
    for (const r of visibleRounds) m[r.id] = { shares: 0, credit: 0 };
    for (const s of state.shareholders)
      for (const r of visibleRounds) {
        const c = cell(s.id, r.id);
        m[r.id].shares += c.shares;
        m[r.id].credit += c.credit;
      }
    return m;
  }, [state, visibleRounds]);

  const totalSharesGlobal = useMemo(
    () => Object.values(totaisPorRodada).reduce((s, v) => s + v.shares, 0),
    [totaisPorRodada]
  );

  const linhas = useMemo(() => {
    return state.shareholders.map(s => {
      let totShares = 0, totCreditBRL = 0, totCreditUSD = 0;
      for (const r of visibleRounds) {
        const c = cell(s.id, r.id);
        totShares += c.shares;
        if (r.moeda === "USD") totCreditUSD += c.credit;
        else totCreditBRL += c.credit;
      }
      const pct = totalSharesGlobal > 0 ? (totShares / totalSharesGlobal) * 100 : 0;
      return { s, totShares, totCreditBRL, totCreditUSD, pct };
    });
  }, [state, visibleRounds, totalSharesGlobal]);

  const linhasFiltradas = useMemo(() => {
    if (!search.trim()) return linhas;
    const q = search.toLowerCase();
    return linhas.filter(l => l.s.nome.toLowerCase().includes(q));
  }, [linhas, search]);

  /* Ordenação para o "Sumário de Ownership" — maiores primeiro */
  const linhasOrd = useMemo(
    () => linhas.slice().sort((a, b) => b.pct - a.pct).filter(l => l.totShares > 0),
    [linhas]
  );

  /* KPIs derivados */
  const totalCapitalBRL = linhas.reduce((a, l) => a + l.totCreditBRL, 0);
  const totalCapitalUSD = linhas.reduce((a, l) => a + l.totCreditUSD, 0);
  const fundador = linhasOrd.find(l => !isInstitutional(l.s.nome) && !isSOP(l.s.nome)) || linhasOrd[0];
  const diluicaoFundador = fundador ? 100 - fundador.pct : 0;

  const institucionais = linhas.filter(l => isInstitutional(l.s.nome) && l.totShares > 0);
  const pctInstitucionais = institucionais.reduce((a, l) => a + l.pct, 0);

  const sop = linhas.find(l => isSOP(l.s.nome));
  const pctSop = sop?.pct ?? 0;

  const rodadasComCredito = state.rounds
    .map(r => ({ r, t: totaisPorRodada[r.id]?.credit || (() => {
      let v = 0;
      for (const s of state.shareholders) v += cell(s.id, r.id).credit;
      return v;
    })() }))
    .filter(x => x.t > 0);
  const menorRodada = rodadasComCredito.reduce<number | null>((a, x) => a === null ? x.t : Math.min(a, x.t), null) || 0;
  const maiorRodada = rodadasComCredito.reduce<number>((a, x) => Math.max(a, x.t), 0);

  const ultimaRodada = state.rounds.slice().sort((a, b) => b.data.localeCompare(a.data))[0];
  const ultimaTotal = ultimaRodada
    ? state.shareholders.reduce((a, s) => a + cell(s.id, ultimaRodada.id).credit, 0)
    : 0;

  const anos = useMemo(() => {
    const set = new Set(state.rounds.map(r => r.data.slice(0, 4)));
    return Array.from(set).sort();
  }, [state.rounds]);

  /* Timeline (sempre histórica completa, ordenada) */
  const timeline = useMemo(() => {
    const ord = state.rounds.slice().sort((a, b) => a.data.localeCompare(b.data));
    let accBRL = 0, accUSD = 0, accShares = 0;
    return ord.map(r => {
      let shares = 0, creditBRL = 0, creditUSD = 0;
      const parts: { sh: Shareholder; shares: number; credit: number }[] = [];
      for (const s of state.shareholders) {
        const c = cell(s.id, r.id);
        if (c.shares || c.credit) {
          parts.push({ sh: s, shares: c.shares, credit: c.credit });
          shares += c.shares;
          if (r.moeda === "USD") creditUSD += c.credit;
          else creditBRL += c.credit;
        }
      }
      accShares += shares;
      accBRL += creditBRL;
      accUSD += creditUSD;
      const pricePerShare = shares > 0 && (creditBRL + creditUSD) > 0
        ? (r.moeda === "USD" ? creditUSD : creditBRL) / shares
        : 0;
      return { round: r, shares, creditBRL, creditUSD, parts, accBRL, accUSD, accShares, pricePerShare };
    });
  }, [state]);

  /* Handlers */
  const startEdit = (sId: string, rId: string) => {
    const c = cell(sId, rId);
    setDraftShares(String(c.shares || 0));
    setDraftCredit(String(c.credit || 0));
    setEditing({ sId, rId });
  };
  const saveEdit = () => {
    if (!editing) return;
    const key = `${editing.sId}:${editing.rId}`;
    save({ ...state, cells: { ...state.cells, [key]: { shares: Number(draftShares) || 0, credit: Number(draftCredit) || 0 } } });
    setEditing(null);
  };

  const upsertSh = (sh: Shareholder) => {
    const exists = state.shareholders.some(x => x.id === sh.id);
    save({ ...state, shareholders: exists ? state.shareholders.map(x => x.id === sh.id ? sh : x) : [...state.shareholders, sh] });
    setOpenShareholder(null); setNewSh(false);
    toast.success(exists ? "Sócio atualizado" : "Sócio adicionado");
  };
  const removeSh = (id: string) => {
    if (!confirm("Remover este sócio e todas as suas posições?")) return;
    const nextCells = { ...state.cells };
    Object.keys(nextCells).forEach(k => { if (k.startsWith(id + ":")) delete nextCells[k]; });
    save({ ...state, shareholders: state.shareholders.filter(x => x.id !== id), cells: nextCells });
  };

  const upsertRd = (r: Round) => {
    const exists = state.rounds.some(x => x.id === r.id);
    save({ ...state, rounds: exists ? state.rounds.map(x => x.id === r.id ? r : x) : [...state.rounds, r] });
    setOpenRound(null); setNewRd(false);
    toast.success(exists ? "Rodada atualizada" : "Rodada adicionada");
  };
  const removeRd = (id: string) => {
    if (!confirm("Remover esta rodada e suas posições?")) return;
    const nextCells = { ...state.cells };
    Object.keys(nextCells).forEach(k => { if (k.endsWith(":" + id)) delete nextCells[k]; });
    save({ ...state, rounds: state.rounds.filter(x => x.id !== id), cells: nextCells });
  };

  const exportar = () => window.print();

  const stage = ultimaRodada ? `Pós-${ultimaRodada.nome.replace(/\s*\([^)]*\)/, "")}` : "Pré-Seed";

  /* ============== Render ============== */
  return (
    <div className="space-y-5 p-6 print:p-0">
      {/* ===== Header ===== */}
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span>Societário</span>
              <ChevronRight className="h-3 w-3" />
              <span>Captable</span>
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">Takeat Sociedade Anônima</h1>
              <span className="rounded-full border border-violet-300/60 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300">
                {stage}
              </span>
            </div>
            <div className="num text-xs text-muted-foreground">
              {state.shareholders.length} sócios · {state.rounds.length} rodadas · capital subscrito de{" "}
              <span className="font-semibold text-foreground">{fmtBRL(totalCapitalBRL)}</span>
              {ultimaRodada && <> · última atualização {fmtDataLonga(ultimaRodada.data)}</>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-8 bg-muted/60">
                <TabsTrigger value="resumo" className="h-6 text-xs">Resumo</TabsTrigger>
                <TabsTrigger value="diluicao" className="h-6 text-xs">Diluição</TabsTrigger>
                <TabsTrigger value="vesting" className="h-6 text-xs">Vesting</TabsTrigger>
                <TabsTrigger value="documentos" className="h-6 text-xs">Documentos</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportar}>
              <FileDown className="h-3.5 w-3.5" /> Exportar PDF
            </Button>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        {/* ============ Resumo ============ */}
        <TabsContent value="resumo" className="space-y-5 mt-0">
          {/* ===== KPIs ===== */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiBlock
              eyebrow="Capital subscrito"
              value={fmtBRLcompact(totalCapitalBRL)}
              valueClass="text-foreground"
              sub={`${rodadasComCredito.length} rodadas · de ${fmtBRLcompact(menorRodada)} a ${fmtBRLcompact(maiorRodada)}`}
              stats={[
                { label: "Total USD", value: totalCapitalUSD ? fmtUSD(totalCapitalUSD) : "—" },
                { label: "Shares totais", value: fmtNum(totalSharesGlobal) },
                { label: "Última", value: ultimaRodada ? `${fmtMesAno(ultimaRodada.data)} · ${fmtBRLcompact(ultimaTotal)}` : "—" },
              ]}
            />
            <KpiBlock
              eyebrow="Participação fundador"
              value={fundador ? fmtPct(fundador.pct) : "—"}
              valueClass="text-primary"
              sub={fundador ? `${fundador.s.nome} · controlador` : "—"}
              stats={[
                { label: "No início", value: "100%" },
                { label: "Diluição", value: fmtPct(diluicaoFundador) },
                { label: "Rodadas", value: String(rodadasComCredito.length) },
              ]}
            />
            <KpiBlock
              eyebrow="Investidores institucionais"
              value={String(institucionais.length)}
              valueClass="text-foreground"
              sub={`${fmtPct(pctInstitucionais)} do captable`}
              stats={
                institucionais.slice(0, 3).map(i => ({
                  label: i.s.nome.split(" ")[0].slice(0, 10),
                  value: fmtPct(i.pct),
                }))
              }
            />
            <KpiBlock
              eyebrow="Pool de stock options"
              value={pctSop ? fmtPct(pctSop) : "—"}
              valueClass="text-foreground"
              sub={sop ? `${fmtNum(sop.totShares)} ações reservadas` : "Sem pool configurado"}
              stats={[
                { label: "Outorgadas", value: "—" },
                { label: "Em vesting", value: "—" },
                { label: "Disponíveis", value: sop ? fmtNum(sop.totShares) : "—" },
              ]}
            />
          </div>

          {/* ===== Shareholder Ledger ===== */}
          <section className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 flex-wrap">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Shareholder ledger
                </div>
                <h2 className="text-sm font-semibold">
                  Captable consolidada
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    todos os shareholders × todas as rodadas
                  </span>
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar shareholder…"
                    className="h-8 w-[200px] pl-7 text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
                  <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={yearFilter} onValueChange={setYearFilter}>
                    <SelectTrigger className="h-6 w-[100px] border-0 px-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Atual</SelectItem>
                      {anos.map(a => <SelectItem key={a} value={a}>Até {a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros
                </Button>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setNewRd(true)}>
                  <Plus className="h-3.5 w-3.5" /> Rodada
                </Button>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setNewSh(true)}>
                  <Plus className="h-3.5 w-3.5" /> Sócio
                </Button>
              </div>
            </div>

            {/* Sumário ownership */}
            <div className="px-4 pt-4 pb-3">
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Sumário de ownership · 100% = {fmtNum(totalSharesGlobal)} ações</span>
                <span className="num">top 5 · {fmtPct(linhasOrd.slice(0, 5).reduce((a, l) => a + l.pct, 0))}</span>
              </div>
              <div className="flex h-7 w-full overflow-hidden rounded-md border border-border bg-muted/40">
                {linhasOrd.map(l => (
                  <div
                    key={l.s.id}
                    title={`${l.s.nome} — ${fmtPct(l.pct)}`}
                    style={{ width: `${l.pct}%`, backgroundColor: ownershipBarColor(l.s.id) }}
                    className="relative h-full transition-opacity hover:opacity-80"
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground">
                {linhasOrd.slice(0, 6).map(l => (
                  <div key={l.s.id} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: ownershipBarColor(l.s.id) }} />
                    <span className="text-foreground/80 truncate max-w-[140px]">{l.s.nome}</span>
                    <span className="num font-semibold text-foreground">{fmtPct(l.pct)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-card px-4 pt-5 pb-3 text-left w-[280px] align-bottom">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 font-medium">Shareholder</span>
                    </th>
                    {visibleRounds.map(r => {
                      const p = ROUND_PALETTE[r.cor] || ROUND_PALETTE.slate;
                      return (
                        <th
                          key={r.id}
                          colSpan={r.showCredit ? 2 : 1}
                          className="px-2 pt-4 pb-2 text-center align-bottom group/h relative"
                        >
                          <div className="flex flex-col items-center gap-1.5">
                            <span className={cn("inline-block h-[3px] w-8 rounded-full", p.bar)} />
                            <div className={cn("inline-flex items-center gap-1.5 text-[11.5px] font-semibold tracking-tight", p.text)}>
                              <span className="truncate">{r.nome}</span>
                              <button onClick={() => setOpenRound(r)} className="opacity-0 group-hover/h:opacity-100 transition-opacity">
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button onClick={() => removeRd(r.id)} className="opacity-0 group-hover/h:opacity-100 transition-opacity">
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </button>
                            </div>
                            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">{fmtMesAno(r.data)}</div>
                          </div>
                        </th>
                      );
                    })}
                    <th className="px-3 pt-4 pb-2 text-center align-bottom w-[100px]">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="inline-block h-[3px] w-8 rounded-full bg-foreground/40" />
                        <span className="text-[11.5px] font-semibold tracking-tight text-foreground">Total</span>
                        <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">acumulado</span>
                      </div>
                    </th>
                    <th className="px-3 pt-4 pb-2 text-center align-bottom w-[80px]">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="inline-block h-[3px] w-8 rounded-full bg-foreground/40" />
                        <span className="text-[11.5px] font-semibold tracking-tight text-foreground">%</span>
                        <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80">stake</span>
                      </div>
                    </th>
                  </tr>
                  <tr className="border-b border-border/60">
                    <th className="sticky left-0 z-10 bg-card px-4 pb-2.5" />
                    {visibleRounds.flatMap(r => {
                      const p = ROUND_PALETTE[r.cor] || ROUND_PALETTE.slate;
                      const chip = "inline-flex items-center justify-center rounded-full px-2 py-[2px] text-[9.5px] font-medium uppercase tracking-wider";
                      return r.showCredit ? [
                        <th key={r.id + "-c"} className="px-2 pb-2.5 text-center font-normal">
                          <span className={cn(chip, p.soft, p.text)}>Credit</span>
                        </th>,
                        <th key={r.id + "-s"} className="px-2 pb-2.5 text-center font-normal">
                          <span className={cn(chip, p.soft, p.text)}>Shares</span>
                        </th>,
                      ] : [
                        <th key={r.id + "-s"} className="px-2 pb-2.5 text-center font-normal">
                          <span className={cn(chip, p.soft, p.text)}>Shares</span>
                        </th>
                      ];
                    })}
                    <th className="px-2 pb-2.5 text-center font-normal">
                      <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-[2px] text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">shares</span>
                    </th>
                    <th className="px-2 pb-2.5 text-center font-normal">
                      <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-[2px] text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">stake</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFiltradas.map(({ s, totShares, pct }) => (
                    <tr key={s.id} className="border-b border-border hover:bg-muted/20 group/row">
                      <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium group-hover/row:bg-muted/20">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="grid h-7 w-7 flex-none place-items-center rounded-full text-[10px] font-bold"
                            style={avatarStyle(s.id)}
                          >
                            {initials(s.nome)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-semibold leading-tight">{s.nome}</div>
                            <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                              {isInstitutional(s.nome) ? "Fundo de investimento"
                                : isSOP(s.nome) ? "Stock options"
                                : "Investidor anjo"}
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100">
                            <button onClick={() => setOpenShareholder(s)} className="rounded p-1 hover:bg-muted">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button onClick={() => removeSh(s.id)} className="rounded p-1 hover:bg-muted">
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </button>
                          </div>
                        </div>
                      </td>
                      {visibleRounds.flatMap(r => {
                        const c = cell(s.id, r.id);
                        return r.showCredit ? [
                          <td key={r.id + "-c"}
                              onClick={() => startEdit(s.id, r.id)}
                              className={cn("cursor-pointer px-2 py-2 text-right num border-l border-border", c.credit ? "" : "text-muted-foreground/30")}>
                            {c.credit ? (r.moeda === "USD" ? fmtUSD(c.credit) : fmtBRL(c.credit)) : "—"}
                          </td>,
                          <td key={r.id + "-s"}
                              onClick={() => startEdit(s.id, r.id)}
                              className={cn("cursor-pointer px-2 py-2 text-right num border-l border-border", c.shares ? "font-semibold" : "text-muted-foreground/30")}>
                            {c.shares ? fmtNum(c.shares) : "—"}
                          </td>,
                        ] : [
                          <td key={r.id + "-s"}
                              onClick={() => startEdit(s.id, r.id)}
                              className={cn("cursor-pointer px-2 py-2 text-right num border-l border-border", c.shares ? "font-semibold" : "text-muted-foreground/30")}>
                            {c.shares ? fmtNum(c.shares) : "—"}
                          </td>
                        ];
                      })}
                      <td className="px-2 py-2 text-right num font-semibold border-l border-border bg-muted/20">{fmtNum(totShares)}</td>
                      <td className="px-2 py-2 text-right num font-bold border-l border-border bg-muted/20">{fmtPct(pct)}</td>
                    </tr>
                  ))}
                  {/* Total */}
                  <tr className="border-t-2 border-border bg-muted/40 font-bold">
                    <td className="sticky left-0 z-10 bg-muted/60 px-3 py-2 text-[11px] uppercase tracking-wider">Total da rodada</td>
                    {visibleRounds.flatMap(r => {
                      const t = totaisPorRodada[r.id] || { shares: 0, credit: 0 };
                      return r.showCredit ? [
                        <td key={r.id + "-c"} className="px-2 py-2 text-right num border-l border-border">
                          {t.credit ? (r.moeda === "USD" ? fmtUSD(t.credit) : fmtBRL(t.credit)) : "—"}
                        </td>,
                        <td key={r.id + "-s"} className="px-2 py-2 text-right num border-l border-border">+{fmtNum(t.shares)}</td>,
                      ] : [
                        <td key={r.id + "-s"} className="px-2 py-2 text-right num border-l border-border">+{fmtNum(t.shares)}</td>
                      ];
                    })}
                    <td className="px-2 py-2 text-right num border-l border-border bg-muted/30">{fmtNum(totalSharesGlobal)}</td>
                    <td className="px-2 py-2 text-right num border-l border-border bg-muted/30">{fmtPct3(100)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="border-t border-border bg-muted/10 px-4 py-2 flex items-center justify-between text-[10.5px] text-muted-foreground">
              <span>
                {state.shareholders.length} shareholders · {state.rounds.length} rodadas
              </span>
              <span>Clique em uma célula para editar shares e crédito</span>
            </div>
          </section>

          {/* ===== Timeline ===== */}
          <Timeline timeline={timeline} totalBRL={totalCapitalBRL} anos={anos} />
        </TabsContent>

        {/* ============ Diluição ============ */}
        <TabsContent value="diluicao" className="mt-0">
          <DiluicaoView state={state} />
        </TabsContent>

        {/* ============ Vesting ============ */}
        <TabsContent value="vesting" className="mt-0">
          <EmptyTab
            title="Cronograma de vesting"
            desc="Cadastre o pool de stock options e os contratos de vesting para visualizar o cronograma de aquisição, cliffs e penhoras."
          />
        </TabsContent>

        {/* ============ Documentos ============ */}
        <TabsContent value="documentos" className="mt-0">
          <EmptyTab
            title="Documentos societários"
            desc="Espaço para acordos de acionistas, atas, side-letters e term sheets vinculados a cada rodada."
          />
        </TabsContent>
      </Tabs>

      {/* ===== Dialogs ===== */}
      <CellEditor
        open={!!editing}
        title={editing ? `${state.shareholders.find(x => x.id === editing.sId)?.nome} · ${state.rounds.find(x => x.id === editing.rId)?.nome}` : ""}
        shares={draftShares} credit={draftCredit}
        showCredit={editing ? !!state.rounds.find(x => x.id === editing.rId)?.showCredit : false}
        moeda={editing ? (state.rounds.find(x => x.id === editing.rId)?.moeda || "BRL") : "BRL"}
        onShares={setDraftShares} onCredit={setDraftCredit}
        onClose={() => setEditing(null)} onSave={saveEdit}
      />
      <ShareholderDialog
        open={!!openShareholder || newSh}
        sh={openShareholder}
        onClose={() => { setOpenShareholder(null); setNewSh(false); }}
        onSave={upsertSh}
      />
      <RoundDialog
        open={!!openRound || newRd}
        rd={openRound}
        onClose={() => { setOpenRound(null); setNewRd(false); }}
        onSave={upsertRd}
      />
    </div>
  );
}

/* ============== Timeline ============== */
function Timeline({
  timeline, totalBRL, anos,
}: {
  timeline: ReturnType<any>;
  totalBRL: number;
  anos: string[];
}) {
  const inverted = [...timeline].reverse() as any[];
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 flex-wrap">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Histórico completo
          </div>
          <h3 className="text-sm font-semibold">
            Linha do tempo
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              cada rodada com investidores e capital
            </span>
          </h3>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="num text-muted-foreground">
            {anos[0]} → {anos[anos.length - 1]}
          </span>
          <span className="num rounded-md bg-primary/10 px-2 py-1 font-bold text-primary">
            {fmtBRLcompact(totalBRL)}
          </span>
        </div>
      </div>

      <ol className="relative space-y-3 px-4 py-4">
        {inverted.map((ev: any) => {
          const p = ROUND_PALETTE[ev.round.cor] || ROUND_PALETTE.slate;
          const ano = ev.round.data.slice(2, 4);
          return (
            <li key={ev.round.id} className="flex gap-3">
              {/* dot + ano */}
              <div className="flex flex-col items-center pt-1 w-12 flex-none">
                <div className={cn("grid h-9 w-9 place-items-center rounded-full ring-2 bg-background", p.ring)}>
                  <div className={cn("h-2 w-2 rounded-full", p.bar)} />
                </div>
                <span className="num mt-1 text-[10px] font-semibold text-muted-foreground">'{ano}</span>
              </div>

              {/* card */}
              <article className={cn(
                "flex-1 rounded-lg border border-border bg-background overflow-hidden",
                "border-l-[3px]",
              )} style={{ borderLeftColor: `var(--tw-shadow-color)` }}>
                <div className={cn("flex items-start justify-between gap-3 px-4 py-3 border-b border-border", p.soft)}>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className={cn("text-sm font-bold", p.text)}>{ev.round.nome}</h4>
                      <span className="text-[11px] text-muted-foreground">{fmtDataLonga(ev.round.data)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {ev.parts.length > 0
                        ? `${ev.parts.length} investidor${ev.parts.length > 1 ? "es" : ""} aportaram ${
                            ev.round.moeda === "USD" ? fmtUSD(ev.creditUSD) : fmtBRLcompact(ev.creditBRL)
                          }${ev.pricePerShare ? ` @ ${ev.round.moeda === "USD" ? fmtUSD(ev.pricePerShare) : fmtBRL(ev.pricePerShare)}/share` : ""}.`
                        : "Rodada bridge sem desembolso de capital — emissão de ações."}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-right">
                    <Mini label="Capital" value={
                      (ev.creditBRL + ev.creditUSD) > 0
                        ? (ev.round.moeda === "USD" ? fmtUSD(ev.creditUSD) : fmtBRLcompact(ev.creditBRL))
                        : "—"
                    } accent={p.text} />
                    <Mini label="Shares" value={ev.shares ? `+${fmtNum(ev.shares)}` : "—"} />
                    <Mini label="Acum." value={fmtBRLcompact(ev.accBRL)} />
                  </div>
                </div>

                {ev.parts.length > 0 && (
                  <ul className="grid gap-1.5 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
                    {ev.parts.map((part: any) => (
                      <li key={part.sh.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                        <div className="grid h-7 w-7 flex-none place-items-center rounded-full text-[9.5px] font-bold"
                             style={avatarStyle(part.sh.id)}>
                          {initials(part.sh.nome)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11.5px] font-semibold leading-tight">{part.sh.nome}</div>
                          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                            {isInstitutional(part.sh.nome) ? "Fundo de investimento" : "Investidor anjo"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="num text-[11px] font-bold">{fmtNum(part.shares)} sh</div>
                          {part.credit > 0 && (
                            <div className="num text-[10px] text-muted-foreground">
                              {ev.round.moeda === "USD" ? fmtUSD(part.credit) : fmtBRLcompact(part.credit)}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("num text-[12px] font-bold", accent)}>{value}</div>
    </div>
  );
}

/* ============== Diluição ============== */
function DiluicaoView({ state }: { state: State }) {
  // Para cada rodada (ordenada), calcula % de cada shareholder após a rodada
  const ord = state.rounds.slice().sort((a, b) => a.data.localeCompare(b.data));
  const stages = ord.map((_, i) => {
    const slice = ord.slice(0, i + 1);
    const totals: Record<string, number> = {};
    let total = 0;
    for (const s of state.shareholders) {
      let v = 0;
      for (const r of slice) v += (state.cells[`${s.id}:${r.id}`]?.shares || 0);
      totals[s.id] = v;
      total += v;
    }
    return { round: ord[i], totals, total };
  });

  const ordenados = state.shareholders.slice().sort((a, b) => {
    const ta = stages[stages.length - 1].totals[a.id] || 0;
    const tb = stages[stages.length - 1].totals[b.id] || 0;
    return tb - ta;
  }).filter(s => stages[stages.length - 1].totals[s.id] > 0);

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Análise de diluição
        </div>
        <h3 className="text-sm font-semibold">Evolução do ownership rodada a rodada</h3>
      </div>
      <div className="space-y-3 px-4 py-4">
        {stages.map(st => {
          const p = ROUND_PALETTE[st.round.cor] || ROUND_PALETTE.slate;
          return (
            <div key={st.round.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", p.bar)} />
                  <span className="font-semibold">{st.round.nome}</span>
                  <span className="text-muted-foreground">{fmtMesAno(st.round.data)}</span>
                </div>
                <span className="num text-muted-foreground">{fmtNum(st.total)} shares emitidas</span>
              </div>
              <div className="flex h-5 w-full overflow-hidden rounded-md border border-border bg-muted/30">
                {ordenados.map(s => {
                  const pct = st.total > 0 ? ((st.totals[s.id] || 0) / st.total) * 100 : 0;
                  if (!pct) return null;
                  return (
                    <div
                      key={s.id}
                      title={`${s.nome} — ${fmtPct(pct)}`}
                      style={{ width: `${pct}%`, backgroundColor: ownershipBarColor(s.id) }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ============== Empty Tab ============== */
function EmptyTab({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

/* ============== KPI Block ============== */
function KpiBlock({
  eyebrow, value, valueClass, sub, stats,
}: {
  eyebrow: string;
  value: string;
  valueClass?: string;
  sub: string;
  stats: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {eyebrow}
      </div>
      <div className={cn("num text-[26px] font-bold leading-none tracking-tight", valueClass)}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground line-clamp-1">{sub}</div>
      <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-2.5">
        {stats.map((s, i) => (
          <div key={i} className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{s.label}</div>
            <div className="num text-[11.5px] font-semibold truncate">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============== Dialogs ============== */
function CellEditor({ open, title, shares, credit, showCredit, moeda, onShares, onCredit, onClose, onSave }: any) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className={showCredit ? "" : "col-span-2"}>
            <Label className="text-xs">Shares</Label>
            <Input type="number" value={shares} onChange={(e) => onShares(e.target.value)} />
          </div>
          {showCredit && (
            <div>
              <Label className="text-xs">Crédito ({moeda})</Label>
              <Input type="number" value={credit} onChange={(e) => onCredit(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSave}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareholderDialog({ open, sh, onClose, onSave }: { open: boolean; sh: Shareholder | null; onClose: () => void; onSave: (s: Shareholder) => void; }) {
  const [nome, setNome] = useState("");
  useEffect(() => { setNome(sh?.nome || ""); }, [sh, open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{sh ? "Editar sócio" : "Novo sócio"}</DialogTitle></DialogHeader>
        <div>
          <Label className="text-xs">Nome</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => {
            if (!nome.trim()) { toast.error("Informe o nome"); return; }
            onSave({ id: sh?.id || crypto.randomUUID(), nome: nome.trim() });
          }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoundDialog({ open, rd, onClose, onSave }: { open: boolean; rd: Round | null; onClose: () => void; onSave: (r: Round) => void; }) {
  const [form, setForm] = useState<Round>({
    id: "", nome: "", data: new Date().toISOString().slice(0, 10), moeda: "BRL", showCredit: true, cor: "blue",
  });
  useEffect(() => {
    if (rd) setForm(rd);
    else setForm({ id: crypto.randomUUID(), nome: "", data: new Date().toISOString().slice(0, 10), moeda: "BRL", showCredit: true, cor: "blue" });
  }, [rd, open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{rd ? "Editar rodada" : "Nova rodada"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Nome</Label>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Series Seed 5" />
          </div>
          <div>
            <Label className="text-xs">Data</Label>
            <Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Moeda</Label>
            <Select value={form.moeda} onValueChange={(v: any) => setForm({ ...form, moeda: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BRL">BRL (R$)</SelectItem>
                <SelectItem value="USD">USD ($)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input id="cred" type="checkbox" checked={form.showCredit} onChange={(e) => setForm({ ...form, showCredit: e.target.checked })} />
            <Label htmlFor="cred" className="text-xs">Exibir coluna de crédito (valor aportado)</Label>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Cor</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {COLOR_KEYS.map(k => (
                <button
                  key={k}
                  onClick={() => setForm({ ...form, cor: k })}
                  className={cn(
                    "h-7 w-10 rounded border-2 capitalize text-[9px] font-semibold",
                    ROUND_PALETTE[k].soft,
                    ROUND_PALETTE[k].text,
                    form.cor === k ? "border-foreground" : "border-transparent"
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => {
            if (!form.nome.trim()) { toast.error("Informe o nome"); return; }
            onSave(form);
          }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
