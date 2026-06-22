import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Loader2, ExternalLink, Plus, Save, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Props = {
  spreadsheetId: string;
  sheet: string;
  sheetUrl: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
};

type SheetData = { headers: string[]; rows: string[][]; sheet: string };

export default function SheetMirrorPage({ spreadsheetId, sheet, sheetUrl, title, description, Icon }: Props) {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; v: string } | null>(null);
  const [appending, setAppending] = useState(false);
  const [newRow, setNewRow] = useState<string[]>([]);

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

  // Indices of visible columns: drop columns whose header is empty/whitespace
  const visibleCols = useMemo(() => {
    if (!data) return [];
    return data.headers
      .map((h, i) => ({ h: (h ?? "").trim(), i }))
      .filter((x) => x.h.length > 0)
      .map((x) => x.i);
  }, [data]);

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
    // Build full-width row aligned by header index, filling unedited cols with ""
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
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                {data ? `${data.rows.length} linha(s) · aba: "${data.sheet}" · clique numa célula para editar` : "Carregando…"}
              </CardDescription>
            </div>
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
                      <TableHead key={i} className="whitespace-nowrap">{data.headers[i]}</TableHead>
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
                  {data.rows.map((row, rIdx) => (
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
                  {data.rows.length === 0 && !appending && (
                    <TableRow>
                      <TableCell colSpan={visibleCols.length} className="text-center text-sm text-muted-foreground py-8">
                        Nenhuma linha na planilha.
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
