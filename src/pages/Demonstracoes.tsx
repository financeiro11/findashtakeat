import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ChevronLeft, ChevronRight, Upload, Trash2, Pencil, Plus, X, Check, GripVertical, ArrowLeft, ArrowRight, FileText, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BalanceteTable } from "./balancete/BalanceteTable";
import { BalanceteKpis } from "./balancete/BalanceteKpis";

type Tipo = "dre" | "dfc" | "balancete" | "balanco";
type Modo = "mes" | "trimestre" | "completo";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function periodoMes(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function labelMes(p: string) {
  const [y, m] = p.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}
function periodoTri(year: number, q: number) {
  return `${q}T${String(year).slice(-2)}`;
}

export default function Demonstracoes({ tipo, modo, titulo }: { tipo: Tipo; modo: Modo; titulo: string }) {
  const today = new Date();
  const navegavel = modo !== "completo";
  const [periodo, setPeriodo] = useState<string>(
    modo === "mes" ? periodoMes(today)
    : modo === "trimestre" ? periodoTri(today.getFullYear(), Math.floor(today.getMonth() / 3) + 1)
    : "completo"
  );
  const [year, setYear] = useState<number>(today.getFullYear());
  const [quarter, setQuarter] = useState<number>(Math.floor(today.getMonth() / 3) + 1);
  const [dados, setDados] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any[]>([]);
  const [draftHeaders, setDraftHeaders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [renameOpen, setRenameOpen] = useState<{ idx: number; value: string } | null>(null);
  const [newColOpen, setNewColOpen] = useState(false);
  const [newColName, setNewColName] = useState("");

  useEffect(() => { document.title = titulo; }, [titulo]);

  useEffect(() => {
    if (modo === "trimestre") setPeriodo(periodoTri(year, quarter));
  }, [year, quarter, modo]);

  const [colunas, setColunas] = useState<string[]>([]);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [v2Data, setV2Data] = useState<any | null>(null);
  const [processing, setProcessing] = useState(false);

  const isPdfTipo = tipo === "balancete" || tipo === "balanco";
  const podeInternalizar = tipo === "balanco"; // balancete já tem página própria

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("demonstracoes_contabeis" as any)
      .select("dados, pdf_path")
      .eq("tipo", tipo).eq("periodo", periodo).maybeSingle();
    if (error && error.code !== "PGRST116") toast.error(error.message);
    const raw: any = (data as any)?.dados;
    if (raw && raw.version === 2 && Array.isArray(raw.accounts)) {
      setV2Data(raw);
      setDados([]);
      setColunas([]);
    } else if (raw && !Array.isArray(raw) && Array.isArray(raw.rows)) {
      setV2Data(null);
      setDados(raw.rows || []);
      setColunas(raw.columns || (raw.rows[0] ? Object.keys(raw.rows[0]) : []));
    } else {
      setV2Data(null);
      const arr = (raw as any[]) || [];
      setDados(arr);
      setColunas(arr.length ? Object.keys(arr[0]) : []);
    }
    const path = (data as any)?.pdf_path ?? null;
    setPdfPath(path);
    if (path) {
      const { data: signed } = await supabase.storage.from("demonstracoes-pdf").createSignedUrl(path, 3600);
      setPdfUrl(signed?.signedUrl ?? null);
    } else {
      setPdfUrl(null);
    }
    setEditing(false);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tipo, periodo]);

  const navegar = (delta: number) => {
    if (modo === "mes") {
      const [y, m] = periodo.split("-").map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      setPeriodo(periodoMes(d));
    } else if (modo === "trimestre") {
      let q = quarter + delta;
      let y = year;
      if (q > 4) { q = 1; y += 1; }
      if (q < 1) { q = 4; y -= 1; }
      setQuarter(q); setYear(y);
    }
  };

  const headers = colunas;

  const importar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
      if (!json.length) return toast.error("Planilha vazia");

      const cols = Object.keys(json[0]);
      const { error } = await supabase.from("demonstracoes_contabeis" as any).upsert(
        { tipo, periodo, dados: { columns: cols, rows: json } } as any,
        { onConflict: "tipo,periodo" }
      );
      if (error) throw error;
      toast.success(`${json.length} linha(s) importada(s)`);
      load();
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally { e.target.value = ""; }
  };

  const reprocessarPDF = async (path?: string) => {
    const usePath = path || pdfPath;
    if (!usePath || !podeInternalizar) return;
    setProcessing(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("parse-balancete-pdf", {
        body: { periodo, pdf_path: usePath, tipo },
      });
      if (error) throw new Error(error.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      toast.success(`Balanço processado (${(res as any)?.contas ?? 0} contas)`);
      await load();
    } catch (err: any) {
      toast.error("Falha no processamento: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const importarPDF = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
        return toast.error("Selecione um arquivo PDF");
      }
      const path = `${tipo}/${periodo}-${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from("demonstracoes-pdf").upload(path, f, {
        contentType: "application/pdf", upsert: true,
      });
      if (upErr) throw upErr;
      // remove pdf antigo se existir
      if (pdfPath && pdfPath !== path) {
        await supabase.storage.from("demonstracoes-pdf").remove([pdfPath]);
      }
      const { error } = await supabase.from("demonstracoes_contabeis" as any).upsert(
        { tipo, periodo, dados: { columns: [], rows: [] }, pdf_path: path } as any,
        { onConflict: "tipo,periodo" }
      );
      if (error) throw error;
      setPdfPath(path);
      if (podeInternalizar) {
        toast.success("PDF enviado, processando com IA...");
        await reprocessarPDF(path);
      } else {
        toast.success("PDF enviado");
        load();
      }
    } catch (err: any) {
      toast.error("Falha: " + err.message);
    } finally { e.target.value = ""; }
  };

  const removerPDF = async () => {
    if (!pdfPath) return;
    if (!confirm("Remover o PDF anexado?")) return;
    await supabase.storage.from("demonstracoes-pdf").remove([pdfPath]);
    const { error } = await supabase.from("demonstracoes_contabeis" as any)
      .update({ pdf_path: null } as any).eq("tipo", tipo).eq("periodo", periodo);
    if (error) toast.error(error.message); else { toast.success("PDF removido"); load(); }
  };

  const limpar = async () => {
    if (!confirm(`Excluir dados${navegavel ? " de " + labelPeriodo() : ""}?`)) return;
    if (pdfPath) await supabase.storage.from("demonstracoes-pdf").remove([pdfPath]);
    const { error } = await supabase.from("demonstracoes_contabeis" as any)
      .delete().eq("tipo", tipo).eq("periodo", periodo);
    if (error) toast.error(error.message); else { toast.success("Excluído"); load(); }
  };

  const labelPeriodo = () =>
    modo === "mes" ? labelMes(periodo)
    : modo === "trimestre" ? `${quarter}T${String(year).slice(-2)}`
    : "Completo";

  // ===== Edição =====
  const startEdit = () => {
    setDraftHeaders(headers.length ? [...headers] : ["Conta"]);
    setDraft(dados.length ? JSON.parse(JSON.stringify(dados)) : []);
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setDraft([]); setDraftHeaders([]); };

  const updateCell = (i: number, h: string, v: string) => {
    setDraft(prev => {
      const next = [...prev];
      const num = v === "" ? "" : Number(v.replace(",", "."));
      next[i] = { ...next[i], [h]: v !== "" && !isNaN(num as number) && /^-?\d+([.,]\d+)?$/.test(v) ? num : v };
      return next;
    });
  };

  const addRow = () => {
    const row: any = {};
    draftHeaders.forEach(h => row[h] = "");
    setDraft(prev => [...prev, row]);
  };
  const delRow = (i: number) => setDraft(prev => prev.filter((_, idx) => idx !== i));

  const addCol = () => {
    const name = newColName.trim();
    if (!name) return;
    if (draftHeaders.includes(name)) { toast.error("Coluna já existe"); return; }
    setDraftHeaders(prev => [...prev, name]);
    setDraft(prev => prev.map(r => ({ ...r, [name]: "" })));
    setNewColName(""); setNewColOpen(false);
  };
  const delCol = (h: string) => {
    if (!confirm(`Excluir coluna "${h}"?`)) return;
    setDraftHeaders(prev => prev.filter(x => x !== h));
    setDraft(prev => prev.map(r => { const { [h]: _, ...rest } = r; return rest; }));
  };
  const renameCol = () => {
    if (!renameOpen) return;
    const newName = renameOpen.value.trim();
    const oldName = draftHeaders[renameOpen.idx];
    if (!newName || newName === oldName) { setRenameOpen(null); return; }
    if (draftHeaders.includes(newName)) { toast.error("Já existe coluna com esse nome"); return; }
    setDraftHeaders(prev => prev.map((h, i) => i === renameOpen.idx ? newName : h));
    setDraft(prev => prev.map(r => {
      const out: any = {};
      Object.keys(r).forEach(k => { out[k === oldName ? newName : k] = r[k]; });
      return out;
    }));
    setRenameOpen(null);
  };

  const moveCol = (from: number, to: number) => {
    if (from === to || to < 0 || to >= draftHeaders.length) return;
    setDraftHeaders(prev => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const saveEdit = async () => {
    setSaving(true);
    try {
      // normaliza para garantir que todas as linhas tenham todas as colunas na ordem
      const rows = draft.map(r => {
        const out: any = {};
        draftHeaders.forEach(h => { out[h] = r[h] ?? ""; });
        return out;
      });
      const { error } = await supabase.from("demonstracoes_contabeis" as any).upsert(
        { tipo, periodo, dados: { columns: draftHeaders, rows } } as any,
        { onConflict: "tipo,periodo" }
      );
      if (error) throw error;
      toast.success("Alterações salvas");
      await load();
    } catch (err: any) {
      toast.error("Falha ao salvar: " + err.message);
    } finally { setSaving(false); }
  };

  const fmt = (v: any) =>
    typeof v === "number"
      ? Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(v ?? "");

  return (
    <div className="space-y-6 p-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{titulo}</h2>
        <p className="text-sm text-muted-foreground">
          {modo === "mes"
            ? "Navegue entre os meses e importe a demonstração do período."
            : modo === "trimestre"
            ? "Navegue entre os trimestres (lucro real) e importe a demonstração."
            : "Importe a planilha completa com todos os meses."}
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          {navegavel ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="icon" variant="outline" onClick={() => navegar(-1)} disabled={editing} title="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
              {modo === "mes" ? (
                <>
                  <Select
                    value={String(Number(periodo.split("-")[1]))}
                    onValueChange={(v) => {
                      const [y] = periodo.split("-");
                      setPeriodo(`${y}-${String(Number(v)).padStart(2, "0")}`);
                    }}
                    disabled={editing}
                  >
                    <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MESES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select
                    value={periodo.split("-")[0]}
                    onValueChange={(v) => {
                      const m = periodo.split("-")[1];
                      setPeriodo(`${v}-${m}`);
                    }}
                    disabled={editing}
                  >
                    <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 7 }, (_, i) => today.getFullYear() - 3 + i).map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <>
                  <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v))} disabled={editing}>
                    <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map(q => <SelectItem key={q} value={String(q)}>{q}T</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={String(year)} onValueChange={(v) => setYear(Number(v))} disabled={editing}>
                    <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 7 }, (_, i) => today.getFullYear() - 3 + i).map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <Button size="icon" variant="outline" onClick={() => navegar(1)} disabled={editing} title="Próximo"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          ) : <div />}
          <div className="flex flex-wrap gap-2">
            {!editing ? (
              <>
                {isPdfTipo && (
                  <Button variant="outline" asChild>
                    <label className="cursor-pointer">
                      <FileText className="mr-2 h-4 w-4" /> {pdfPath ? "Substituir PDF" : "Importar PDF"}
                      <input type="file" accept="application/pdf,.pdf" hidden onChange={importarPDF} />
                    </label>
                  </Button>
                )}
                {podeInternalizar && pdfPath && (
                  <Button variant="outline" onClick={() => reprocessarPDF()} disabled={processing}>
                    {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {processing ? "Processando..." : v2Data ? "Reprocessar com IA" : "Processar com IA"}
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <label className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" /> Importar Excel
                    <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={importar} />
                  </label>
                </Button>
                <Button variant="outline" onClick={startEdit}>
                  <Pencil className="mr-2 h-4 w-4" /> Editar
                </Button>
                {(dados.length > 0 || pdfPath) && (
                  <Button variant="outline" onClick={limpar}>
                    <Trash2 className="mr-2 h-4 w-4" /> Limpar
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" onClick={addRow}>
                  <Plus className="mr-2 h-4 w-4" /> Linha
                </Button>
                <Button variant="outline" onClick={() => setNewColOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Coluna
                </Button>
                <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                  <X className="mr-2 h-4 w-4" /> Cancelar
                </Button>
                <Button onClick={saveEdit} disabled={saving}>
                  <Check className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "Salvar"}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pdfUrl && !editing && (
            <div className="border-b bg-muted/30 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">PDF anexado</span>
                <span className="text-muted-foreground">· {labelPeriodo()}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={pdfUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" /> Abrir</a>
                </Button>
                <Button variant="outline" size="sm" onClick={removerPDF}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Remover PDF
                </Button>
              </div>
            </div>
          )}
          {pdfUrl && !editing && !v2Data && (
            <iframe src={pdfUrl} title="PDF" className="w-full h-[70vh] border-0" />
          )}
          {v2Data && !editing && (
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>
                  Tabela estruturada pela IA · {v2Data.accounts?.length ?? 0} contas · importado em{" "}
                  {v2Data.imported_at ? new Date(v2Data.imported_at).toLocaleString("pt-BR") : "—"}
                </span>
              </div>
              <BalanceteKpis totals={v2Data.totals ?? null} prevTotals={null} loading={false} />
              <BalanceteTable accounts={v2Data.accounts ?? []} prevAccounts={[]} />
            </div>
          )}
          {processing && (
            <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Processando PDF com IA...
            </div>
          )}
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : !editing && !dados.length && !pdfUrl && !v2Data ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nenhum dado{navegavel ? ` para ${labelPeriodo()}` : ""}. {isPdfTipo ? "Importe um PDF, " : "Importe "}uma planilha ou clique em Editar.
            </div>
          ) : !editing && !dados.length && (pdfUrl || v2Data) ? null : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {(editing ? draftHeaders : headers).map((h, i) => (
                      <TableHead
                        key={h}
                        className={`text-center whitespace-nowrap ${editing && overIdx === i && dragIdx !== null && dragIdx !== i ? "bg-accent/60" : ""}`}
                        draggable={editing}
                        onDragStart={editing ? () => setDragIdx(i) : undefined}
                        onDragOver={editing ? (e) => { e.preventDefault(); setOverIdx(i); } : undefined}
                        onDragLeave={editing ? () => setOverIdx(o => o === i ? null : o) : undefined}
                        onDrop={editing ? (e) => {
                          e.preventDefault();
                          if (dragIdx !== null) moveCol(dragIdx, i);
                          setDragIdx(null); setOverIdx(null);
                        } : undefined}
                        onDragEnd={editing ? () => { setDragIdx(null); setOverIdx(null); } : undefined}
                      >
                        {editing ? (
                          <div className="flex items-center justify-center gap-1">
                            <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground" />
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveCol(i, i - 1)} disabled={i === 0} title="Mover para esquerda">
                              <ArrowLeft className="h-3 w-3" />
                            </Button>
                            <button
                              className="hover:underline"
                              onClick={() => setRenameOpen({ idx: i, value: h })}
                              title="Renomear coluna"
                            >
                              {h}
                            </button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveCol(i, i + 1)} disabled={i === draftHeaders.length - 1} title="Mover para direita">
                              <ArrowRight className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => delCol(h)} title="Excluir coluna">
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : h}
                      </TableHead>
                    ))}
                    {editing && <TableHead className="w-[60px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(editing ? draft : dados).map((row, i) => (
                    <TableRow key={i}>
                      {(editing ? draftHeaders : headers).map(h => (
                        <TableCell key={h} className="text-sm whitespace-nowrap">
                          {editing ? (
                            <Input
                              value={row[h] === undefined || row[h] === null ? "" : String(row[h])}
                              onChange={(e) => updateCell(i, h, e.target.value)}
                              className="h-8 min-w-[120px]"
                            />
                          ) : fmt(row[h])}
                        </TableCell>
                      ))}
                      {editing && (
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" onClick={() => delRow(i)} title="Excluir linha">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {editing && draft.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={draftHeaders.length + 1} className="py-8 text-center text-sm text-muted-foreground">
                        Sem linhas. Clique em "Linha" para adicionar.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!renameOpen} onOpenChange={(o) => !o && setRenameOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear coluna</DialogTitle>
            <DialogDescription>Defina um novo nome para a coluna.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={renameOpen?.value ?? ""}
              onChange={(e) => setRenameOpen(s => s ? { ...s, value: e.target.value } : s)}
              onKeyDown={(e) => e.key === "Enter" && renameCol()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(null)}>Cancelar</Button>
            <Button onClick={renameCol}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newColOpen} onOpenChange={setNewColOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova coluna</DialogTitle>
            <DialogDescription>Informe o nome da nova coluna.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCol()}
              autoFocus
              placeholder="Ex.: Jan/25"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewColOpen(false); setNewColName(""); }}>Cancelar</Button>
            <Button onClick={addCol}>Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
