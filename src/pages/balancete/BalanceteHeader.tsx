import { ChevronLeft, ChevronRight, FileText, RefreshCw, Trash2, Upload, Eye, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

type Status = "idle" | "processing" | "ready" | "error" | "empty";

interface Props {
  periodo: string;
  onPeriodoChange: (p: string) => void;
  importedAt: string | null;
  status: Status;
  errorMsg?: string | null;
  hasPdf: boolean;
  onImportPdf: (file: File) => void;
  onReprocess: () => void;
  onViewPdf: () => void;
  onClear: () => void;
  yearsRange?: number;
}

export function BalanceteHeader({
  periodo, onPeriodoChange, importedAt, status, errorMsg,
  hasPdf, onImportPdf, onReprocess, onViewPdf, onClear,
  yearsRange = 5,
}: Props) {
  const [y, m] = periodo.split("-").map(Number);
  const today = new Date();

  const navega = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    onPeriodoChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const statusBadge = () => {
    switch (status) {
      case "processing":
        return (
          <Badge variant="outline" className="gap-1.5 border-primary/40 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" /> Processando
          </Badge>
        );
      case "ready":
        return (
          <Badge variant="outline" className="gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Pronto
          </Badge>
        );
      case "error":
        return (
          <Badge variant="outline" className="gap-1.5 border-destructive/40 text-destructive">
            <AlertCircle className="h-3 w-3" /> Falhou
          </Badge>
        );
      case "empty":
        return (
          <Badge variant="outline" className="gap-1.5 text-muted-foreground">
            Sem dados
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="card-surface p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="eyebrow">Hub Financeiro · Balancete</div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {MESES[m - 1]} {y}
            </h1>
            {statusBadge()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            FinHub · {importedAt ? `Importado em ${new Date(importedAt).toLocaleString("pt-BR")}` : "Nenhuma importação ainda"}
            {errorMsg && status === "error" && <span className="text-destructive"> · {errorMsg}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" onClick={() => navega(-1)} title="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select
              value={String(m)}
              onValueChange={(v) => onPeriodoChange(`${y}-${String(Number(v)).padStart(2, "0")}`)}
            >
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MESES.map((nm, i) => <SelectItem key={nm} value={String(i + 1)}>{nm}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(y)} onValueChange={(v) => onPeriodoChange(`${v}-${String(m).padStart(2, "0")}`)}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: yearsRange + 2 }, (_, i) => today.getFullYear() - yearsRange + i).map((yr) => (
                  <SelectItem key={yr} value={String(yr)}>{yr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" variant="outline" onClick={() => navega(1)} title="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="h-6 w-px bg-border mx-1" />

          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <Upload className="mr-2 h-4 w-4" /> {hasPdf ? "Substituir PDF" : "Importar PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportPdf(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
          {hasPdf && (
            <>
              <Button variant="outline" onClick={onReprocess} disabled={status === "processing"}>
                <RefreshCw className={"mr-2 h-4 w-4 " + (status === "processing" ? "animate-spin" : "")} />
                Atualizar
              </Button>
              <Button variant="outline" onClick={onViewPdf}>
                <Eye className="mr-2 h-4 w-4" /> Ver PDF
              </Button>
              <Button variant="outline" onClick={onClear}>
                <Trash2 className="mr-2 h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
