import { useMemo, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export type GestaoRecorrenciasRow = {
  id: string;
  campanha: string;
  embaixador: string;
  empresa: string;
  mrr: number;
  recorrenciaValor: number;
  dataIndicacao: string | null;
  ativo: boolean;
};

type Cad = {
  nome: string;
  recorrencia?: boolean | null;
  metodo_recorrencia?: string | null;
  valor_recorrencia?: number | null;
};

export function GestaoRecorrenciasDialog({
  open,
  onOpenChange,
  recRows,
  cadastroByNome,
  initialMonthFilter,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recRows: GestaoRecorrenciasRow[];
  cadastroByNome: Map<string, Cad>;
  initialMonthFilter: string;
}) {
  const [monthFilter, setMonthFilter] = useState(initialMonthFilter);
  const [embFilter, setEmbFilter] = useState<string>("__all__");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setMonthFilter(initialMonthFilter);
      setEmbFilter("__all__");
      setQuery("");
    }
  }, [open, initialMonthFilter]);

  const calcRec = (mrr: number, cad?: Cad) => {
    if (!cad || !cad.recorrencia || cad.valor_recorrencia == null) return null;
    if (cad.metodo_recorrencia === "%") return (Number(mrr) || 0) * (Number(cad.valor_recorrencia) / 100);
    return Number(cad.valor_recorrencia);
  };

  const vencidas = useMemo(() => {
    const refDate = (() => {
      if (monthFilter) {
        const [y, m] = monthFilter.split("-").map(Number);
        if (y && m) return new Date(y, m, 0, 23, 59, 59);
      }
      return new Date();
    })();
    return recRows
      .map((r) => {
        const cad = cadastroByNome.get((r.embaixador || "").trim().toLowerCase());
        const calc = calcRec(r.mrr || 0, cad);
        return { ...r, recorrenciaValor: calc != null ? calc : (r.recorrenciaValor || 0) };
      })
      .filter((r) => {
        if (!r.ativo || !r.dataIndicacao) return false;
        const ind = new Date(r.dataIndicacao);
        if (isNaN(ind.getTime())) return false;
        const limite = new Date(ind);
        limite.setFullYear(limite.getFullYear() + 1);
        return refDate > limite;
      });
  }, [recRows, monthFilter, cadastroByNome]);

  const embOptions = useMemo(() => {
    const s = new Set<string>();
    vencidas.forEach((r) => { if (r.embaixador) s.add(r.embaixador); });
    return Array.from(s).sort();
  }, [vencidas]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vencidas.filter((r) => {
      if (embFilter !== "__all__" && r.embaixador !== embFilter) return false;
      if (q && ![r.campanha, r.embaixador, r.empresa].some((f) => (f || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [vencidas, embFilter, query]);

  const total = useMemo(
    () => filtered.reduce((s, r) => s + (r.recorrenciaValor || 0), 0),
    [filtered],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Gestão de Recorrências Vencidas
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Recorrências que ultrapassaram 1 ano desde a indicação. Use os filtros para apurar o impacto.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Mês de apuração</Label>
            <Input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="h-8 w-[150px] text-[12.5px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Embaixador</Label>
            <Select value={embFilter} onValueChange={setEmbFilter}>
              <SelectTrigger className="h-8 w-[220px] text-[12.5px]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {embOptions.map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[180px]">
            <Label className="text-[11px] text-muted-foreground">Buscar</Label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Embaixador, empresa, campanha…"
              className="h-8 text-[12.5px]"
            />
          </div>

          <div className="ml-auto rounded-md border border-amber-300/60 bg-amber-50 px-4 py-2 dark:bg-amber-950/30">
            <div className="text-[10.5px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Total vencido {embFilter !== "__all__" ? `· ${embFilter}` : ""}
            </div>
            <div className="text-base font-semibold text-amber-800 dark:text-amber-200">
              {BRL(total)}
            </div>
            <div className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
              {filtered.length} {filtered.length === 1 ? "recorrência" : "recorrências"}
            </div>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="text-[12px]">Campanha</TableHead>
                <TableHead className="text-[12px]">Embaixador</TableHead>
                <TableHead className="text-[12px]">Empresa</TableHead>
                <TableHead className="text-[12px]">Data indicação</TableHead>
                <TableHead className="text-right text-[12px]">MRR</TableHead>
                <TableHead className="text-right text-[12px]">Recorrência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-[12.5px] text-muted-foreground">
                    Nenhuma recorrência vencida no período/filtro.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-[12.5px]">{r.campanha || "—"}</TableCell>
                    <TableCell className="text-[12.5px]">
                      <div className="flex items-center gap-2">
                        <span>{r.embaixador || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[12.5px]">{r.empresa || "—"}</TableCell>
                    <TableCell className="text-[12.5px]">
                      <div className="flex items-center gap-2">
                        <span>{fmtDate(r.dataIndicacao)}</span>
                        <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          Vencida
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-[12.5px]">{BRL(r.mrr || 0)}</TableCell>
                    <TableCell className="text-right text-[12.5px] font-medium">{BRL(r.recorrenciaValor || 0)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
