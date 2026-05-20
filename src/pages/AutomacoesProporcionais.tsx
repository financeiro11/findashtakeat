import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Percent, RefreshCw, Loader2, ExternalLink, Check, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1fwt-sosZW-YRkV-uNyE06sE40ZLwdlkh3fjbo50VU8o/edit";

type SheetData = {
  headers: string[];
  rows: string[][];
  approvalCol: number;
  sheet: string;
};

export default function AutomacoesProporcionais() {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("proporcionais-sheet", {
        body: { action: "read" },
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

  useEffect(() => { load(); }, []);

  async function setApproval(rowIdx: number, value: "Sim" | "Não") {
    if (!data || data.approvalCol < 0) return;
    const key = `${rowIdx}:${data.approvalCol}`;
    setSavingKey(key);
    try {
      const { error: err, data: res } = await supabase.functions.invoke("proporcionais-sheet", {
        body: { action: "update", rowIndex: rowIdx, colIndex: data.approvalCol, value },
      });
      if (err) throw new Error(err.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      setData((d) => {
        if (!d) return d;
        const rows = d.rows.map((r, i) => {
          if (i !== rowIdx) return r;
          const copy = [...r];
          copy[d.approvalCol] = value;
          return copy;
        });
        return { ...d, rows };
      });
      toast({ title: "Atualizado", description: `Linha ${rowIdx + 2} marcada como "${value}".` });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  }

  const visibleHeaders = data?.headers ?? [];
  const approvalCol = data?.approvalCol ?? -1;

  return (
    <div className="space-y-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Proporcionais</h2>
          <p className="text-sm text-muted-foreground">
            Espelho da planilha de salários proporcionais. Aprovações feitas aqui são gravadas direto na planilha — o fluxo de envio continua normalmente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open(SHEET_URL, "_blank")}>
            <ExternalLink className="h-4 w-4" /> Abrir planilha
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      <Card className="border-border shadow-[var(--shadow-card)]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Percent className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Salário Proporcional</CardTitle>
              <CardDescription>
                {data
                  ? `${data.rows.length} colaborador(es) · coluna de aprovação: ${approvalCol >= 0 ? `"${visibleHeaders[approvalCol]}"` : "não detectada"}`
                  : "Carregando…"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="p-4 text-sm text-destructive">{error}</div>
          )}
          {loading && !data && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo planilha…
            </div>
          )}
          {data && data.rows.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma linha na planilha.</div>
          )}
          {data && data.rows.length > 0 && (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleHeaders.map((h, i) => (
                      <TableHead key={i} className={i === approvalCol ? "min-w-[180px]" : ""}>
                        {h ? h.charAt(0).toUpperCase() + h.slice(1) : h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row, rIdx) => {
                    const current = approvalCol >= 0 ? (row[approvalCol] ?? "") : "";
                    const key = `${rIdx}:${approvalCol}`;
                    const saving = savingKey === key;
                    return (
                      <TableRow key={rIdx}>
                        {visibleHeaders.map((_, cIdx) => {
                          if (cIdx === approvalCol) {
                            return (
                              <TableCell key={cIdx}>
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    size="sm"
                                    variant={current.toLowerCase() === "sim" ? "default" : "outline"}
                                    disabled={saving}
                                    onClick={() => setApproval(rIdx, "Sim")}
                                    className="h-7 px-2"
                                  >
                                    {saving && current.toLowerCase() !== "sim" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                    Sim
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={current.toLowerCase().startsWith("n") ? "destructive" : "outline"}
                                    disabled={saving}
                                    onClick={() => setApproval(rIdx, "Não")}
                                    className="h-7 px-2"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    Não
                                  </Button>
                                </div>
                              </TableCell>
                            );
                          }
                          const cell = row[cIdx] ?? "";
                          const isLong = cell.length > 80;
                          return (
                            <TableCell key={cIdx} className={isLong ? "max-w-[320px] text-xs text-muted-foreground" : "whitespace-nowrap text-sm"}>
                              {isLong ? (
                                <span title={cell} className="line-clamp-2 block">{cell}</span>
                              ) : cell}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
