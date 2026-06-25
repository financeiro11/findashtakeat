import { useEffect, useState } from "react";
import { History, User2, ArrowRight } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

export type HistoricoTarget = {
  table: "parceiros_indicacoes" | "parceiros_recorrencias";
  id: string;
  titulo: string;
};

type LogRow = {
  id: string;
  campanha_anterior: string | null;
  campanha_nova: string | null;
  campo: string | null;
  valor_anterior: string | null;
  valor_novo: string | null;
  user_email: string | null;
  created_at: string;
};

const fmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
};

const fmtValor = (campo: string | null, v: string | null) => {
  if (v == null || v === "") return "—";
  if (campo === "data_indicacao" || campo === "data_venda") {
    const s = v.slice(0, 10);
    const [y, m, d] = s.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
  }
  return v;
};

const CAMPO_LABEL: Record<string, string> = {
  nome_campanha: "Campanha",
  data_indicacao: "Data indicação",
  data_venda: "Data venda",
};

export function HistoricoCampanhaSheet({
  open, onOpenChange, target,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: HistoricoTarget | null;
}) {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("parceiros_campanha_logs")
        .select("id, campanha_anterior, campanha_nova, campo, valor_anterior, valor_novo, user_email, created_at")
        .eq("registro_tabela", target.table)
        .eq("registro_id", target.id)
        .order("created_at", { ascending: false });
      if (!cancelled) {
        if (error) console.warn("logs erro", error);
        setLogs((data as LogRow[]) || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, target]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-[14px]">
            <History className="h-4 w-4 text-muted-foreground" />
            Histórico de edições
          </SheetTitle>
          <SheetDescription className="text-[12px]">
            {target?.titulo || "Alterações registradas para este registro."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 140px)" }}>
          {loading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : logs.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
              Nenhuma alteração registrada ainda.
            </div>
          ) : (
            logs.map((l) => {
              // Fallback p/ logs antigos sem `campo`
              const campo = l.campo ?? "nome_campanha";
              const antes = l.campo ? l.valor_anterior : l.campanha_anterior;
              const depois = l.campo ? l.valor_novo : l.campanha_nova;
              return (
                <div key={l.id} className="rounded-md border border-border bg-muted/20 p-3 text-[12.5px]">
                  <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <User2 className="h-3 w-3" />
                      {l.user_email || "Sistema"}
                    </span>
                    <span className="tabular-nums">{fmt(l.created_at)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10.5px] font-normal">
                      {CAMPO_LABEL[campo] || campo}
                    </Badge>
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-700 dark:text-rose-300 line-through">
                      {fmtValor(campo, antes)}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                      {fmtValor(campo, depois)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
