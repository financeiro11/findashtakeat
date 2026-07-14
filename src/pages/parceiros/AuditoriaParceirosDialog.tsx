import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  id: string;
  action: string;
  indicacao_id: string | null;
  id_negocio: string | null;
  snapshot: any;
  user_nome: string | null;
  user_email: string | null;
  created_at: string;
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function AuditoriaParceirosDialog() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from("parceiros_indicacoes_audit" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setRows((data as any) ?? []);
        setLoading(false);
      });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12.5px]">
          <ShieldCheck className="h-3.5 w-3.5" /> Auditoria
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Auditoria — Parceiros</DialogTitle>
          <DialogDescription>Registro das exclusões de indicações em /operacional/parceiros.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>ID negócio</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Embaixador</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-[12.5px]">Carregando…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-[12.5px]">Nenhum registro.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id} className="text-[12.5px]">
                  <TableCell>{fmtDateTime(r.created_at)}</TableCell>
                  <TableCell className="capitalize">{r.action}</TableCell>
                  <TableCell>{r.user_nome || r.user_email || "—"}</TableCell>
                  <TableCell className="font-mono text-[11.5px]">{r.id_negocio || "—"}</TableCell>
                  <TableCell>{r.snapshot?.nome_negocio ?? "—"}</TableCell>
                  <TableCell>{r.snapshot?.indicador ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
