import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Loader2, ExternalLink, Plus, Save, X, Filter, FilterX, Calendar as CalendarIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Props = {
  spreadsheetId: string;
  sheet: string;
  sheetUrl: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
};

type SheetData = { headers: string[]; rows: string[][]; sheet: string };

type DateRange = { from?: Date; to?: Date; preset?: string };
type TextFilter = { selected: Set<string> }; // empty set = no filter

const DATE_HEADER_RE = /(data|timestamp|carimbo|vencimento|venc\.|date|periodo|período|mês|mes\b)/i;

function parseAnyDate(s: string): Date | null {
  if (!s) return null;
  const t = s.trim();
  // dd/mm/yyyy [hh:mm[:ss]]
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const yy = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
    return new Date(yy, parseInt(m[2]) - 1, parseInt(m[1]), parseInt(m[4] || "0"), parseInt(m[5] || "0"), parseInt(m[6] || "0"));
  }
  // yyyy-mm-dd
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

function applyPreset(preset: string): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today); end.setHours(23, 59, 59, 999);
  switch (preset) {
    case "today": return { from: today, to: end, preset };
    case "7d": { const f = new Date(today); f.setDate(f.getDate() - 6); return { from: f, to: end, preset }; }
    case "month": return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end, preset };
    case "3m": return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: end, preset };
    case "6m": return { from: new Date(now.getFullYear(), now.getMonth() - 5, 1), to: end, preset };
    case "ytd": return { from: new Date(now.getFullYear(), 0, 1), to: end, preset };
    case "12m": { const f = new Date(today); f.setFullYear(f.getFullYear() - 1); return { from: f, to: end, preset }; }
    default: return {};
  }
}

const PRESETS: { id: string; label: string }[] = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "month", label: "Mês atual" },
  { id: "3m", label: "Últimos 3 meses" },
  { id: "6m", label: "Últimos 6 meses" },
  { id: "ytd", label: "Este ano" },
  { id: "12m", label: "Últimos 12 meses" },
];

function fmt(d?: Date) {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR");
}

export default function SheetMirrorPage({ spreadsheetId, sheet, sheetUrl, title, description, Icon }: Props) {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; v: string } | null>(null);
  const [appending, setAppending] = useState(false);
  const [newRow, setNewRow] = useState<string[]>([]);

  const storageKey = `sheet-mirror-filters:${spreadsheetId}:${sheet}`;

  const [textFilters, setTextFilters] = useState<Record<number, TextFilter>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const out: Record<number, TextFilter> = {};
      for (const [k, v] of Object.entries(parsed.textFilters ?? {})) {
        out[Number(k)] = { selected: new Set((v as any).selected ?? []) };
      }
      return out;
    } catch { return {}; }
  });
  const [dateFilters, setDateFilters] = useState<Record<number, DateRange>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const out: Record<number, DateRange> = {};
      for (const [k, v] of Object.entries(parsed.dateFilters ?? {})) {
        const dr = v as any;
        if (dr.preset) {
          out[Number(k)] = applyPreset(dr.preset);
        } else {
          out[Number(k)] = {
            from: dr.from ? new Date(dr.from) : undefined,
            to: dr.to ? new Date(dr.to) : undefined,
          };
        }
      }
      return out;
    } catch { return {}; }
  });
  const [textSearch, setTextSearch] = useState<Record<number, string>>({});

  useEffect(() => {
    try {
      const tf: Record<string, { selected: string[] }> = {};
      for (const [k, v] of Object.entries(textFilters)) {
        if (v.selected.size) tf[k] = { selected: Array.from(v.selected) };
      }
      const df: Record<string, { from?: string; to?: string; preset?: string }> = {};
      for (const [k, v] of Object.entries(dateFilters)) {
        if (v.from || v.to || v.preset) {
          df[k] = {
            from: v.from ? v.from.toISOString() : undefined,
            to: v.to ? v.to.toISOString() : undefined,
            preset: v.preset,
          };
        }
      }
      localStorage.setItem(storageKey, JSON.stringify({ textFilters: tf, dateFilters: df }));
    } catch {}
  }, [textFilters, dateFilters, storageKey]);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("sheets-mirror", {
        body: { action: "read", spreadsheetId, sheet, force },
      });
      if (err) throw new Error(err.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      setData(res as SheetData);
    } catch (e: any) {
      setError(e.message ?? "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [spreadsheetId, sheet]);

  const visibleCols = useMemo(() => {
    if (!data) return [];
    return data.headers
      .map((h, i) => ({ h: (h ?? "").trim(), i }))
      .filter((x) => x.h.length > 0)
      .map((x) => x.i);
  }, [data]);

  // Detect date columns: header matches keywords OR >=60% of non-empty cells parse as a date
  const dateCols = useMemo(() => {
    if (!data) return new Set<number>();
    const out = new Set<number>();
    for (const i of visibleCols) {
      const header = data.headers[i] ?? "";
      if (DATE_HEADER_RE.test(header)) { out.add(i); continue; }
      let ok = 0, total = 0;
      for (const r of data.rows) {
        const v = (r[i] ?? "").trim();
        if (!v) continue;
        total++;
        if (parseAnyDate(v)) ok++;
        if (total >= 30) break;
      }
      if (total >= 5 && ok / total >= 0.6) out.add(i);
    }
    return out;
  }, [data, visibleCols]);

  // Unique values per text column
  const uniqueValues = useMemo(() => {
    const m: Record<number, string[]> = {};
    if (!data) return m;
    for (const i of visibleCols) {
      if (dateCols.has(i)) continue;
      const s = new Set<string>();
      for (const r of data.rows) s.add((r[i] ?? "").trim());
      m[i] = Array.from(s).sort((a, b) => a.localeCompare(b, "pt-BR"));
    }
    return m;
  }, [data, visibleCols, dateCols]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    if (!data) return [] as { row: string[]; origIdx: number }[];
    return data.rows
      .map((row, origIdx) => ({ row, origIdx }))
      .filter(({ row }) => {
        for (const [colStr, f] of Object.entries(textFilters)) {
          const c = Number(colStr);
          if (!f.selected.size) continue;
          if (!f.selected.has((row[c] ?? "").trim())) return false;
        }
        for (const [colStr, dr] of Object.entries(dateFilters)) {
          const c = Number(colStr);
          if (!dr.from && !dr.to) continue;
          const d = parseAnyDate((row[c] ?? "").trim());
          if (!d) return false;
          if (dr.from && d < dr.from) return false;
          if (dr.to && d > dr.to) return false;
        }
        return true;
      });
  }, [data, textFilters, dateFilters]);

  const activeFilterCount =
    Object.values(textFilters).filter((f) => f.selected.size > 0).length +
    Object.values(dateFilters).filter((d) => d.from || d.to).length;

  function clearAllFilters() {
    setTextFilters({});
    setDateFilters({});
    setTextSearch({});
  }

  async function saveCell(rowIdx: number, colIdx: number, value: string) {
    if (!data) return;
    const key = `${rowIdx}:${colIdx}`;
    setSavingKey(key);
    try {
      const { error: err, data: res } = await supabase.functions.invoke("sheets-mirror", {
        body: { action: "update", spreadsheetId, sheet, rowIndex: rowIdx, colIndex: colIdx, value },
      });
      if (err) throw new Error(err.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      setData((d) => {
        if (!d) return d;
        const rows = d.rows.map((r, i) => {
          if (i !== rowIdx) return r;
          const copy = [...r];
          while (copy.length <= colIdx) copy.push("");
          copy[colIdx] = value;
          return copy;
        });
        return { ...d, rows };
      });
      toast({ title: "Salvo", description: `Linha ${rowIdx + 2}, coluna ${data.headers[colIdx] || colIdx + 1}.` });
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  }

  async function appendRow() {
    if (!data) return;
    const full: string[] = data.headers.map((_, i) => {
      const visIdx = visibleCols.indexOf(i);
      return visIdx >= 0 ? (newRow[visIdx] ?? "") : "";
    });
    setSavingKey("__append__");
    try {
      const { error: err, data: res } = await supabase.functions.invoke("sheets-mirror", {
        body: { action: "append", spreadsheetId, sheet, values: full },
      });
      if (err) throw new Error(err.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      toast({ title: "Linha adicionada", description: "Nova linha gravada na planilha." });
      setAppending(false);
      setNewRow([]);
      await load(true);
    } catch (e: any) {
      toast({ title: "Erro ao adicionar", description: e.message, variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  }

  function toggleTextValue(col: number, value: string) {
    setTextFilters((prev) => {
      const cur = prev[col]?.selected ?? new Set<string>();
      const next = new Set(cur);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...prev, [col]: { selected: next } };
    });
  }

  function renderColumnFilter(colIdx: number) {
    if (!data) return null;
    const isDate = dateCols.has(colIdx);
    const active = isDate
      ? !!(dateFilters[colIdx]?.from || dateFilters[colIdx]?.to)
      : (textFilters[colIdx]?.selected.size ?? 0) > 0;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 w-6 p-0 ml-1", active && "text-primary")}
            title="Filtrar"
          >
            {isDate ? <CalendarIcon className="h-3.5 w-3.5" /> : <Filter className="h-3.5 w-3.5" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 pointer-events-auto" align="start">
          {isDate ? (
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground">Período</div>
              <div className="grid grid-cols-2 gap-1">
                {PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    variant={dateFilters[colIdx]?.preset === p.id ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDateFilters((prev) => ({ ...prev, [colIdx]: applyPreset(p.id) }))}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="border-t pt-2 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Personalizado</div>
                <Calendar
                  mode="range"
                  selected={{ from: dateFilters[colIdx]?.from, to: dateFilters[colIdx]?.to }}
                  onSelect={(range) =>
                    setDateFilters((prev) => ({
                      ...prev,
                      [colIdx]: { from: range?.from, to: range?.to, preset: undefined },
                    }))
                  }
                  numberOfMonths={1}
                  className={cn("p-0 pointer-events-auto")}
                />
                <div className="text-xs text-muted-foreground">
                  {fmt(dateFilters[colIdx]?.from)} → {fmt(dateFilters[colIdx]?.to)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => setDateFilters((prev) => { const { [colIdx]: _, ...rest } = prev; return rest; })}
              >
                <FilterX className="h-3.5 w-3.5" /> Limpar
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                placeholder="Buscar valor…"
                value={textSearch[colIdx] ?? ""}
                onChange={(e) => setTextSearch((p) => ({ ...p, [colIdx]: e.target.value }))}
                className="h-8"
              />
              <div className="flex gap-2 text-xs">
                <button
                  className="text-primary hover:underline"
                  onClick={() =>
                    setTextFilters((p) => ({
                      ...p,
                      [colIdx]: { selected: new Set(uniqueValues[colIdx] ?? []) },
                    }))
                  }
                >
                  Selecionar todos
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  className="text-primary hover:underline"
                  onClick={() => setTextFilters((p) => { const { [colIdx]: _, ...rest } = p; return rest; })}
                >
                  Limpar
                </button>
              </div>
              <div className="max-h-56 overflow-auto space-y-1 border rounded p-2">
                {(uniqueValues[colIdx] ?? [])
                  .filter((v) => {
                    const q = (textSearch[colIdx] ?? "").toLowerCase();
                    return !q || v.toLowerCase().includes(q);
                  })
                  .slice(0, 500)
                  .map((v) => {
                    const checked = textFilters[colIdx]?.selected.has(v) ?? false;
                    return (
                      <label key={v} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                        <Checkbox checked={checked} onCheckedChange={() => toggleTextValue(colIdx, v)} />
                        <span className="truncate">{v || <em className="text-muted-foreground">(vazio)</em>}</span>
                      </label>
                    );
                  })}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className="space-y-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open(sheetUrl, "_blank")}>
            <ExternalLink className="h-4 w-4" /> Abrir planilha
          </Button>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
          <Button size="sm" onClick={() => { setAppending(true); setNewRow(visibleCols.map(() => "")); }} disabled={!data || appending}>
            <Plus className="h-4 w-4" /> Novo
          </Button>
        </div>
      </div>

      <Card className="border-border shadow-[var(--shadow-card)]">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>
                  {data
                    ? `${filteredRows.length} de ${data.rows.length} linha(s) · aba: "${data.sheet}" · clique numa célula para editar`
                    : "Carregando…"}
                </CardDescription>
              </div>
            </div>
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{activeFilterCount} filtro(s) ativo(s)</Badge>
                <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                  <FilterX className="h-4 w-4" /> Limpar tudo
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error && <div className="p-4 text-sm text-destructive">{error}</div>}
          {loading && !data && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo planilha…
            </div>
          )}
          {data && (
            <div className="overflow-auto max-h-[70vh]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    {visibleCols.map((i) => (
                      <TableHead key={i} className="whitespace-nowrap">
                        <div className="flex items-center">
                          <span>{data.headers[i]}</span>
                          {renderColumnFilter(i)}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appending && (
                    <TableRow className="bg-primary-soft/30">
                      {visibleCols.map((i, vi) => (
                        <TableCell key={i} className="p-1">
                          <Input
                            value={newRow[vi] ?? ""}
                            onChange={(e) => setNewRow((r) => { const copy = [...r]; copy[vi] = e.target.value; return copy; })}
                            className="h-8"
                            placeholder={data.headers[i]}
                          />
                        </TableCell>
                      ))}
                      <TableCell className="p-1 sticky right-0 bg-background">
                        <div className="flex gap-1">
                          <Button size="sm" onClick={appendRow} disabled={savingKey === "__append__"}>
                            {savingKey === "__append__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setAppending(false); setNewRow([]); }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredRows.map(({ row, origIdx: rIdx }) => (
                    <TableRow key={rIdx}>
                      {visibleCols.map((cIdx) => {
                        const cell = row[cIdx] ?? "";
                        const isEditing = editing?.r === rIdx && editing?.c === cIdx;
                        const key = `${rIdx}:${cIdx}`;
                        const saving = savingKey === key;
                        if (isEditing) {
                          return (
                            <TableCell key={cIdx} className="p-1">
                              <div className="flex gap-1 items-center">
                                <Input
                                  autoFocus
                                  value={editing!.v}
                                  onChange={(e) => setEditing({ ...editing!, v: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveCell(rIdx, cIdx, editing!.v);
                                    if (e.key === "Escape") setEditing(null);
                                  }}
                                  className="h-8 min-w-[160px]"
                                  disabled={saving}
                                />
                                <Button size="sm" onClick={() => saveCell(rIdx, cIdx, editing!.v)} disabled={saving}>
                                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          );
                        }
                        const isLong = cell.length > 80;
                        return (
                          <TableCell
                            key={cIdx}
                            onClick={() => setEditing({ r: rIdx, c: cIdx, v: cell })}
                            className={`cursor-pointer hover:bg-muted/50 ${isLong ? "max-w-[320px] text-xs text-muted-foreground" : "whitespace-nowrap text-sm"}`}
                            title="Clique para editar"
                          >
                            {isLong ? <span className="line-clamp-2 block">{cell}</span> : (cell || <span className="text-muted-foreground/50">—</span>)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {filteredRows.length === 0 && !appending && (
                    <TableRow>
                      <TableCell colSpan={visibleCols.length} className="text-center text-sm text-muted-foreground py-8">
                        {data.rows.length === 0 ? "Nenhuma linha na planilha." : "Nenhuma linha corresponde aos filtros."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
