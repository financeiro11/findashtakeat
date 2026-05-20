import { useState } from "react";
import * as XLSX from "xlsx";
import { Upload, Sparkles, Download, Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseFile, RawTx } from "@/lib/parsers";
import { similarity } from "@/lib/normalize";
import { Rule } from "./DePara";

type Status = "classified" | "suggested" | "unclassified" | "pending";

type Row = RawTx & {
  id: string;
  status: Status;
  matchedRule?: Rule;
  categoria: string;
  centro_custo: string;
  conta: string;
  cliente_fornecedor: string;
  observacao: string;
};

const STATUS_LABEL: Record<Status, { label: string; cls: string; icon: any }> = {
  classified: { label: "Classificado", cls: "bg-success text-success-foreground", icon: CheckCircle2 },
  suggested: { label: "Sugestão IA", cls: "bg-warning text-warning-foreground", icon: AlertTriangle },
  unclassified: { label: "Não classificado", cls: "bg-destructive text-destructive-foreground", icon: XCircle },
  pending: { label: "Pendente", cls: "bg-muted text-muted-foreground", icon: AlertTriangle },
};

export default function PlanilhamentoPage({ title, description }: { title: string; description: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [page, setPage] = useState(1);
  const [processing, setProcessing] = useState(false);
  const pageSize = 15;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const txs = await parseFile(f);
      if (!txs.length) return toast.error("Nenhum lançamento encontrado");
      setRows(txs.map((t, i) => ({
        ...t, id: `r${i}`, status: "pending",
        categoria: "", centro_custo: "", conta: "",
        cliente_fornecedor: "", observacao: "",
      })));
      toast.success(`${txs.length} lançamentos importados`);
      setPage(1);
    } catch (err: any) {
      toast.error("Falha ao ler arquivo: " + err.message);
    } finally {
      e.target.value = "";
    }
  };

  const processAI = async () => {
    if (!rows.length) return;
    setProcessing(true);
    try {
      const { data: rulesData, error } = await supabase
        .from("de_para_rules").select("*");
      if (error) throw error;
      const rules = (rulesData as Rule[]) || [];

      // 1. apply DE_PARA matching
      const matched: Row[] = rows.map((r) => {
        let best: { rule: Rule; score: number } | null = null;
        for (const rule of rules) {
          if (rule.tipo !== r.tipo) continue;
          const s = similarity(r.descricao, rule.keyword);
          if (s >= 0.6 && (!best || s > best.score)) best = { rule, score: s };
        }
        if (best) {
          return {
            ...r, status: "classified", matchedRule: best.rule,
            categoria: best.rule.categoria || "",
            centro_custo: best.rule.centro_custo || "",
            conta: best.rule.conta || "",
            cliente_fornecedor: best.rule.cliente_fornecedor || "",
            observacao: best.rule.observacao || "",
          };
        }
        return { ...r, status: "unclassified" };
      });

      // 2. ask AI for unclassified
      const toAI = matched
        .map((r, idx) => ({ idx, r }))
        .filter(({ r }) => r.status === "unclassified");

      if (toAI.length) {
        const { data: aiData, error: aiErr } = await supabase.functions.invoke("classify-transaction", {
          body: {
            transactions: toAI.map(({ r }) => ({
              description: r.descricao, amount: r.valor, tipo: r.tipo,
            })),
          },
        });
        if (aiErr) {
          const msg = (aiErr as any).context?.body || aiErr.message || "Erro IA";
          toast.error(typeof msg === "string" ? msg : "Erro IA");
        } else if (aiData?.results) {
          aiData.results.forEach((sugg: any, i: number) => {
            const rowIdx = toAI[i]?.idx;
            if (rowIdx == null) return;
            matched[rowIdx] = {
              ...matched[rowIdx],
              status: "suggested",
              categoria: sugg.categoria || "",
              centro_custo: sugg.centro_custo || "",
              conta: sugg.conta || "",
              cliente_fornecedor: sugg.cliente_fornecedor || "",
              observacao: sugg.observacao || "",
            };
          });
        }
      }

      setRows(matched);
      toast.success("Processamento concluído");
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const acceptSuggestion = async (row: Row, saveAsRule: boolean) => {
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, status: "classified" } : r));
    if (saveAsRule) {
      const { error } = await supabase.from("de_para_rules").insert({
        keyword: row.descricao,
        tipo: row.tipo,
        categoria: row.categoria,
        centro_custo: row.centro_custo,
        conta: row.conta,
        cliente_fornecedor: row.cliente_fornecedor,
        observacao: row.observacao,
      });
      if (error) toast.error(error.message);
      else toast.success("Salvo no DE_PARA");
    }
  };

  const updateField = (id: string, field: keyof Row, value: string) => {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const exportOmie = () => {
    const data = rows.map((r) => ({
      "Data": r.data,
      "Descrição": r.descricao,
      "Valor": r.valor,
      "Tipo": r.tipo,
      "Categoria": r.categoria,
      "Centro de Custo": r.centro_custo,
      "Conta": r.conta,
      "Cliente/Fornecedor": r.cliente_fornecedor,
      "Observação": r.observacao,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Omie");
    XLSX.writeFile(wb, `omie_${title.toLowerCase().replace(/\s+/g, "_")}.xlsx`);
  };

  const filteredRows = rows.filter((r) => filter === "all" || r.status === filter);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const counts = {
    classified: rows.filter((r) => r.status === "classified").length,
    suggested: rows.filter((r) => r.status === "suggested").length,
    unclassified: rows.filter((r) => r.status === "unclassified").length,
  };

  return (
    <div className="space-y-6 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <Card className="border-border shadow-[var(--shadow-card)]">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <label className="cursor-pointer">
                <Upload className="mr-2 h-4 w-4" />
                Importar extrato
                <input type="file" accept=".xlsx,.csv,.ofx" hidden onChange={handleFile} />
              </label>
            </Button>
            <Button onClick={processAI} disabled={!rows.length || processing}>
              {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Processar com IA
            </Button>
            <Button variant="outline" onClick={exportOmie} disabled={!rows.length}>
              <Download className="mr-2 h-4 w-4" /> Exportar para Omie
            </Button>
          </div>
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-success text-success-foreground">{counts.classified} classificados</Badge>
              <Badge className="bg-warning text-warning-foreground">{counts.suggested} sugestões</Badge>
              <Badge className="bg-destructive text-destructive-foreground">{counts.unclassified} não classificados</Badge>
              <Select value={filter} onValueChange={(v: any) => { setFilter(v); setPage(1); }}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="classified">Classificados</SelectItem>
                  <SelectItem value="suggested">Sugestões pendentes</SelectItem>
                  <SelectItem value="unclassified">Não classificados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Upload className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Importe um extrato bancário (.xlsx, .csv ou .ofx)</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead className="w-24">Data</TableHead>
                      <TableHead className="min-w-[200px]">Descrição</TableHead>
                      <TableHead className="w-24 text-right">Valor</TableHead>
                      <TableHead className="w-20">Tipo</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Centro de Custo</TableHead>
                      <TableHead>Conta</TableHead>
                      <TableHead>Cliente/Forn.</TableHead>
                      <TableHead className="w-32">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((r) => {
                      const s = STATUS_LABEL[r.status];
                      const Icon = s.icon;
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Badge className={`${s.cls} gap-1`}>
                              <Icon className="h-3 w-3" />
                              {s.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{r.data}</TableCell>
                          <TableCell className="text-xs">{r.descricao}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {r.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{r.tipo}</Badge>
                          </TableCell>
                          <TableCell><EditableCell value={r.categoria} onChange={(v) => updateField(r.id, "categoria", v)} /></TableCell>
                          <TableCell><EditableCell value={r.centro_custo} onChange={(v) => updateField(r.id, "centro_custo", v)} /></TableCell>
                          <TableCell><EditableCell value={r.conta} onChange={(v) => updateField(r.id, "conta", v)} /></TableCell>
                          <TableCell><EditableCell value={r.cliente_fornecedor} onChange={(v) => updateField(r.id, "cliente_fornecedor", v)} /></TableCell>
                          <TableCell>
                            {r.status === "suggested" && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => acceptSuggestion(r, false)}>Aceitar</Button>
                                <Button size="sm" className="h-7 px-2 text-xs" onClick={() => acceptSuggestion(r, true)}>+ DE_PARA</Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <span>{filteredRows.length} lançamentos</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                  <span>Página {page} de {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EditableCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 min-w-[120px] border-transparent bg-transparent text-xs hover:border-border focus:border-ring"
    />
  );
}
