import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, ArrowUpDown, Filter, ChevronLeft, ChevronRight, Sparkles, Download, SlidersHorizontal } from "lucide-react";
import { Edital, STATUS_LIST, CATEGORIAS, REGIOES, fmtBRL, statusBadge, prioridadeBadge, matchColor, daysUntil, opportunityLabel } from "./types";
import EditalDrawer from "./EditalDrawer";
import { toast } from "sonner";
import { useEditaisConfig } from "./useEditaisConfig";
import { Link } from "react-router-dom";

const PAGE_SIZE = 12;

type QuickFilter = "todos" | "fapes" | "alta" | "inovacao" | "prazo_aberto" | "ocultos" | "pncp";

export default function Radar() {
  const { cfg } = useEditaisConfig();
  const [rows, setRows] = useState<Edital[]>([]);
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState("all");
  const [regiao, setRegiao] = useState("all");
  const [status, setStatus] = useState("all");
  const [matchMin, setMatchMin] = useState<string>("");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [prazoAte, setPrazoAte] = useState("");
  const [sortKey, setSortKey] = useState<keyof Edital>("match_score" as any);
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Edital | null>(null);
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState<QuickFilter>("todos");

  // Default matchMin segue config
  useEffect(() => { if (matchMin === "") setMatchMin(String(cfg.min_match_score ?? 0)); }, [cfg.min_match_score]);

  useEffect(() => { document.title = "Editais · Radar"; load(); }, [quick, cfg.min_match_score, cfg.show_low_relevance]);

  const load = async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    let q: any = supabase.from("editais" as any).select("*").order("match_score", { ascending: false });

    // Esconde editais com prazo vencido (mantém os sem prazo definido)
    q = q.or(`prazo_envio.is.null,prazo_envio.gte.${hoje}`);

    // Filtros rápidos
    if (quick === "ocultos") {
      q = q.neq("visibility_status", "visivel");
    } else if (quick === "fapes") {
      q = q.eq("visibility_status", "visivel").neq("lifecycle_status", "encerrado").ilike("fonte", "%FAPES%");
    } else if (quick === "alta") {
      q = q.eq("visibility_status", "visivel").neq("lifecycle_status", "encerrado").gte("match_score", 80);
    } else if (quick === "inovacao") {
      q = q.eq("visibility_status", "visivel").neq("lifecycle_status", "encerrado").in("opportunity_type", ["fomento","subvencao","programa_startup","aceleracao","chamada_publica"]);
    } else if (quick === "prazo_aberto") {
      q = q.eq("visibility_status", "visivel").neq("lifecycle_status", "encerrado").gte("prazo_envio", new Date().toISOString().slice(0, 10));
    } else if (quick === "pncp") {
      q = q.ilike("fonte", "%PNCP%");
    } else {
      // todos visíveis e não encerrados
      q = q.neq("lifecycle_status", "encerrado");
      if (!cfg.show_low_relevance) q = q.eq("visibility_status", "visivel");
    }


    const { data, error } = await q;
    if (error) toast.error(error.message); else setRows((data as any) ?? []);
  };

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (q && !`${r.titulo} ${r.orgao} ${r.numero}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (categoria !== "all" && r.categoria !== categoria) return false;
      if (regiao !== "all" && r.regiao !== regiao) return false;
      if (status !== "all" && r.status !== status) return false;
      if (matchMin && Number(r.match_score ?? 0) < Number(matchMin)) return false;
      if (valorMin && Number(r.valor_estimado ?? 0) < Number(valorMin)) return false;
      if (valorMax && Number(r.valor_estimado ?? 0) > Number(valorMax)) return false;
      if (prazoAte && r.prazo_envio && r.prazo_envio > prazoAte) return false;
      return true;
    });
  }, [rows, q, categoria, regiao, status, matchMin, valorMin, valorMax, prazoAte]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a: any, b: any) => {
      const av = a[sortKey] ?? ""; const bv = b[sortKey] ?? "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (k: keyof Edital) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  };

  const novo = async () => {
    const { data, error } = await supabase.from("editais" as any).insert({ titulo: "Novo edital", status: "Em análise", visibility_status: "visivel" }).select().single();
    if (error) return toast.error(error.message);
    toast.success("Edital criado");
    await load();
    setSelected(data as any); setOpen(true);
  };

  const openRow = (r: Edital) => { setSelected(r); setOpen(true); };

  const Th = ({ k, children }: { k: keyof Edital; children: React.ReactNode }) => (
    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{children}<ArrowUpDown className="h-3 w-3 opacity-50" /></span>
    </TableHead>
  );

  const QUICK: { key: QuickFilter; label: string }[] = [
    { key: "todos", label: "Todos relevantes" },
    { key: "fapes", label: "Apenas FAPES" },
    { key: "alta", label: "Alta aderência (≥80%)" },
    { key: "inovacao", label: "Inovação e Startups" },
    { key: "prazo_aberto", label: "Prazo aberto" },
    { key: "pncp", label: "PNCP" },
    { key: "ocultos", label: "Ocultos" },
  ];

  const totalValor = useMemo(() => sorted.reduce((s, r) => s + Number(r.valor_estimado || 0), 0), [sorted]);
  const matchMedio = sorted.length ? Math.round(sorted.reduce((s, r) => s + Number(r.match_score || 0), 0) / sorted.length) : 0;
  const proxVencer = sorted.filter(r => { const d = daysUntil(r.prazo_envio); return d !== null && d >= 0 && d <= 3; }).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          <span className="num font-semibold text-foreground">{sorted.length}</span> editais relevantes ·
          valor potencial <span className="num font-semibold text-foreground">{fmtBRL(totalValor)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={novo} size="sm" className="h-7 text-[11px]"><Plus className="h-3 w-3 mr-1" /> Novo</Button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <Download className="h-3 w-3" />
          </button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <Filter className="h-3 w-3" />
          </button>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-card text-[11px] text-muted-foreground hover:text-foreground">
            <SlidersHorizontal className="h-3 w-3" />
          </button>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Buscar por título, órgão ou número..." className="pl-8" />
          </div>
          <Select value={categoria} onValueChange={v => { setCategoria(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todas categorias</SelectItem>{CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={regiao} onValueChange={v => { setRegiao(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Região" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todas regiões</SelectItem>{REGIOES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos status</SelectItem>{STATUS_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={novo} size="sm" className="hidden"><Plus className="h-4 w-4 mr-1" /> Novo</Button>
        </div>

        {/* Quick filters */}
        <div className="flex items-center gap-1.5 flex-wrap mt-3">
          {QUICK.map(f => (
            <Button
              key={f.key}
              variant={quick === f.key ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setQuick(f.key); setPage(1); }}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-3 text-xs">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Match IA mín.</span>
          <Input type="number" value={matchMin} onChange={e => setMatchMin(e.target.value)} className="w-20 h-8" />
          <span className="text-muted-foreground ml-2">Valor</span>
          <Input type="number" placeholder="mín" value={valorMin} onChange={e => setValorMin(e.target.value)} className="w-24 h-8" />
          <Input type="number" placeholder="máx" value={valorMax} onChange={e => setValorMax(e.target.value)} className="w-24 h-8" />
          <span className="text-muted-foreground ml-2">Prazo até</span>
          <Input type="date" value={prazoAte} onChange={e => setPrazoAte(e.target.value)} className="w-36 h-8" />
          <span className="ml-auto text-muted-foreground">{sorted.length} editais</span>
        </div>
      </Card>

      <Card className="p-3 flex items-center gap-3 flex-wrap text-xs bg-primary/5 border-primary/20">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Filtro do perfil ativo:</span>
        {cfg.preferred_keywords.length > 0 && (
          <span className="text-muted-foreground">
            palavras: <span className="text-foreground">{cfg.preferred_keywords.slice(0, 6).join(", ")}{cfg.preferred_keywords.length > 6 ? "..." : ""}</span>
          </span>
        )}
        <span className="text-muted-foreground">match ≥ <span className="text-foreground">{cfg.min_match_score}%</span></span>
        <span className="text-muted-foreground">PNCP ≥ <span className="text-foreground">{cfg.pncp_min_match_score}%</span></span>
        <Link to="/editais/configuracoes" className="ml-auto text-primary hover:underline">Editar</Link>
      </Card>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <Th k="titulo">Edital</Th>
              <Th k="opportunity_type">Tipo</Th>
              <Th k="fonte">Fonte</Th>
              <Th k="valor_estimado">Valor</Th>
              <Th k="prazo_envio">Prazo</Th>
              <Th k="match_score">Match</Th>
              <Th k="status">Status</Th>
              <Th k="data_captura">Captura</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map(r => {
              const d = daysUntil(r.prazo_envio);
              const score = Number(r.match_score ?? 0);
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openRow(r)}>
                  <TableCell>
                    <div className="font-medium text-sm">{r.titulo}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      {r.orgao}
                      <Badge variant="outline" className={`${prioridadeBadge(r.prioridade)} text-[9px] py-0 px-1.5`}>{r.prioridade}</Badge>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{opportunityLabel(r.opportunity_type)}</Badge></TableCell>
                  <TableCell className="text-xs">{r.fonte ?? "—"}</TableCell>
                  <TableCell className="num text-sm">{fmtBRL(r.valor_estimado)}</TableCell>
                  <TableCell className="num text-xs">
                    {r.prazo_envio ?? "—"}
                    {d !== null && <div className={`text-[10px] ${d < 0 ? "text-rose-600" : d < 7 ? "text-amber-600" : "text-muted-foreground"}`}>{d < 0 ? `${Math.abs(d)}d atrás` : `${d}d`}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${score}%` }} />
                      </div>
                      <span className={`text-xs font-semibold ${matchColor(score)}`}>{score}%</span>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={statusBadge(r.status)}>{r.status}</Badge></TableCell>
                  <TableCell className="num text-xs text-muted-foreground">{r.data_captura ? new Date(r.data_captura).toLocaleDateString("pt-BR") : "—"}</TableCell>
                </TableRow>
              );
            })}
            {!pageRows.length && (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">Nenhum edital encontrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between p-3 border-t text-xs">
          <div className="text-muted-foreground">Página {page} de {totalPages}</div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="h-3 w-3" /></Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight className="h-3 w-3" /></Button>
          </div>
        </div>
      </Card>

      <EditalDrawer edital={selected} open={open} onOpenChange={setOpen} onSaved={load} />
    </div>
  );
}
