import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Edital, fmtBRL, daysUntil, matchColor } from "./types";
import EditalDrawer from "./EditalDrawer";
import { cn } from "@/lib/utils";

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DIAS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

type ViewMode = "mes" | "lista" | "semana";
type Filtro = "todos" | "match" | "meus";

const eventTypes = [
  { key: "vencimento", label: "Vencimento", color: "bg-rose-500", chip: "bg-rose-500/15 text-rose-600 border-rose-500/30" },
  { key: "abertura",   label: "Abertura",   color: "bg-amber-500", chip: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  { key: "publicacao", label: "Publicação", color: "bg-sky-500",   chip: "bg-sky-500/15 text-sky-600 border-sky-500/30" },
  { key: "doc",        label: "Doc",        color: "bg-violet-500",chip: "bg-violet-500/15 text-violet-600 border-violet-500/30" },
];

export default function Calendario() {
  const [rows, setRows] = useState<Edital[]>([]);
  const [ref, setRef] = useState(new Date());
  const [selected, setSelected] = useState<Edital | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("mes");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  useEffect(() => { document.title = "Editais · Calendário"; load(); }, []);
  const load = async () => {
    const { data } = await supabase.from("editais" as any).select("*");
    setRows((data as any) ?? []);
  };

  const ano = ref.getFullYear();
  const mes = ref.getMonth();
  const firstDay = new Date(ano, mes, 1);
  const lastDay = new Date(ano, mes + 1, 0);
  const startWeekday = firstDay.getDay();

  const cells = useMemo(() => {
    const arr: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) arr.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) arr.push(new Date(ano, mes, d));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [ano, mes, startWeekday, lastDay]);

  const filtered = useMemo(() => {
    if (filtro === "match") return rows.filter(r => Number(r.match_score || 0) >= 70);
    return rows;
  }, [rows, filtro]);

  type Evt = { edital: Edital; type: typeof eventTypes[number] };
  const eventsByDay = useMemo(() => {
    const map = new Map<string, Evt[]>();
    filtered.forEach(r => {
      const list: { date: string | null; type: typeof eventTypes[number] }[] = [
        { date: r.prazo_envio, type: eventTypes[0] },
        { date: r.data_abertura, type: eventTypes[1] },
        { date: r.data_publicacao, type: eventTypes[2] },
      ];
      list.forEach(({ date, type }) => {
        if (!date) return;
        const d = new Date(date);
        if (d.getFullYear() === ano && d.getMonth() === mes) {
          if (!map.has(date)) map.set(date, []);
          map.get(date)!.push({ edital: r, type });
        }
      });
    });
    return map;
  }, [filtered, ano, mes]);

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  const totals = useMemo(() => {
    let v = 0, a = 0, p = 0;
    eventsByDay.forEach(arr => arr.forEach(e => {
      if (e.type.key === "vencimento") v++;
      if (e.type.key === "abertura") a++;
      if (e.type.key === "publicacao") p++;
    }));
    return { v, a, p };
  }, [eventsByDay]);

  const criticos = useMemo(() => {
    return filtered
      .filter(r => r.prazo_envio)
      .map(r => ({ r, d: daysUntil(r.prazo_envio)! }))
      .filter(x => x.d >= 0 && x.d <= 14)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
  }, [filtered]);

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="text-xs text-muted-foreground">
          <span className="num font-semibold text-foreground">{MESES[mes]} {ano}</span> ·{" "}
          <span className="num font-semibold text-rose-600">{totals.v}</span> vencimentos ·{" "}
          <span className="num font-semibold text-sky-600">{totals.p}</span> publicações
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
            {(["mes","lista","semana"] as ViewMode[]).map(m => (
              <button key={m} onClick={() => setView(m)}
                className={cn("px-2.5 py-1 rounded capitalize transition-colors",
                  view === m ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>
                {m === "mes" ? "Mês" : m === "lista" ? "Lista" : "Semana"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => setRef(new Date())} className="h-7 text-[11px]">Hoje</Button>
          <div className="inline-flex items-center rounded-md border bg-card">
            <button onClick={() => setRef(new Date(ano, mes - 1, 1))} className="px-1.5 py-1 hover:bg-muted"><ChevronLeft className="h-3 w-3" /></button>
            <span className="px-2 text-[11px] num font-medium">{MESES[mes].slice(0,3)} {ano}</span>
            <button onClick={() => setRef(new Date(ano, mes + 1, 1))} className="px-1.5 py-1 hover:bg-muted"><ChevronRight className="h-3 w-3" /></button>
          </div>
          <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
            {([
              { v: "todos" as Filtro, l: "Todos" },
              { v: "match" as Filtro, l: "Match >70%" },
              { v: "meus" as Filtro, l: "Meus" },
            ]).map(o => (
              <button key={o.v} onClick={() => setFiltro(o.v)}
                className={cn("px-2.5 py-1 rounded transition-colors",
                  filtro === o.v ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground")}>
                {o.l}
              </button>
            ))}
          </div>
          <Button size="icon" variant="outline" className="h-7 w-7"><SlidersHorizontal className="h-3 w-3" /></Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground mb-3 flex-wrap">
        {eventTypes.map(t => (
          <span key={t.key} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", t.color)} /> {t.label}
          </span>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/40 border-b">
          {DIAS.map((d, i) => <div key={i} className="px-2 py-2 text-[10px] font-semibold text-muted-foreground text-center uppercase tracking-wider">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {cells.map((c, i) => {
            const events = c ? (eventsByDay.get(fmt(c)) ?? []) : [];
            const isToday = c && c.toDateString() === new Date().toDateString();
            const isWeekend = c && (c.getDay() === 0 || c.getDay() === 6);
            return (
              <div key={i} className={cn(
                "min-h-[112px] p-1.5 transition-colors",
                !c ? "bg-muted/30 opacity-40" : isWeekend ? "bg-muted/20" : "bg-card",
                "hover:bg-muted/40"
              )}>
                {c && (
                  <>
                    <div className={cn(
                      "text-[11px] font-semibold mb-1 num inline-flex items-center justify-center min-w-5 h-5 px-1 rounded",
                      isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                    )}>
                      {c.getDate()}
                    </div>
                    <div className="space-y-0.5">
                      {events.slice(0, 3).map((e, idx) => (
                        <button
                          key={e.edital.id + e.type.key + idx}
                          onClick={() => { setSelected(e.edital); setOpen(true); }}
                          className={cn(
                            "w-full text-left text-[10px] truncate px-1.5 py-0.5 rounded border font-medium",
                            "hover:opacity-80 transition-opacity",
                            e.type.chip
                          )}
                          title={`${e.type.label} · ${e.edital.titulo}`}
                        >
                          {e.edital.numero ? `${e.edital.numero} · ` : ""}{e.edital.titulo}
                        </button>
                      ))}
                      {events.length > 3 && <div className="text-[9px] text-muted-foreground px-1">+{events.length - 3} mais</div>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Críticos */}
      {criticos.length > 0 && (
        <div className="mt-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Próximos vencimentos críticos
          </div>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {criticos.map(({ r, d }) => {
              const score = Number(r.match_score ?? 0);
              return (
                <Card key={r.id} onClick={() => { setSelected(r); setOpen(true); }}
                  className="p-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all border-l-2 border-l-rose-500">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[11px] num font-bold text-rose-600">{d === 0 ? "Hoje" : `${d}d restantes`}</div>
                    <div className={cn("text-[10px] num font-semibold", matchColor(score))}>{score}%</div>
                  </div>
                  {r.numero && <div className="text-[9.5px] text-muted-foreground num mb-0.5">{r.numero}</div>}
                  <div className="text-[12px] font-medium line-clamp-2 leading-snug">{r.titulo}</div>
                  <div className="text-[10.5px] num font-semibold text-foreground mt-1.5">{fmtBRL(r.valor_estimado)}</div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <EditalDrawer edital={selected} open={open} onOpenChange={setOpen} onSaved={load} />
    </>
  );
}
