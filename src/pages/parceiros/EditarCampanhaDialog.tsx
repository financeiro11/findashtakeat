import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const WEBHOOK = "https://webhook.takeat.cloud/webhook/edicao_campanha";

export type EditarCampanhaTarget = {
  table: "parceiros_indicacoes" | "parceiros_recorrencias";
  id: string;
  embaixador: string;
  campanhaAtual: string;
  campanhaCadastrada: string;
};

export function EditarCampanhaDialog({
  open,
  onOpenChange,
  target,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: EditarCampanhaTarget | null;
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [valor, setValor] = useState("");

  useEffect(() => {
    if (open && target) setValor(target.campanhaAtual || "");
  }, [open, target]);

  if (!target) return null;

  const handleSalvar = async () => {
    setSaving(true);
    try {
      const novaCampanha = valor.trim() || null;
      // 1) Atualiza no banco e retorna o registro completo
      const { data: updated, error } = await supabase
        .from(target.table)
        .update({ nome_campanha: novaCampanha })
        .eq("id", target.id)
        .select("*")
        .single();
      if (error) throw error;

      // 2) Dispara webhook com a linha completa + user
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tabela: target.table,
            tipo: target.table === "parceiros_indicacoes" ? "indicacao" : "recorrencia",
            campanha_anterior: target.campanhaAtual,
            campanha_nova: novaCampanha,
            user_id: user?.id ?? null,
            user_email: user?.email ?? null,
            registro: updated,
          }),
        });
      } catch (whErr) {
        console.warn("Webhook edicao_campanha falhou", whErr);
      }

      toast.success("Campanha atualizada");
      onOpenChange(false);
      onDone?.();
    } catch (err: any) {
      toast.error(err?.message || "Falha ao atualizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Editar campanha do registro
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            A campanha deste registro está diferente da cadastrada para o embaixador <span className="font-medium">{target.embaixador}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-2 text-[12px]">
            <div>
              <div className="text-muted-foreground">No registro</div>
              <div className="font-medium text-foreground">{target.campanhaAtual || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Cadastrada</div>
              <div className="font-medium text-foreground">{target.campanhaCadastrada || "—"}</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">Nova campanha</Label>
              {target.campanhaCadastrada && (
                <button
                  type="button"
                  onClick={() => setValor(target.campanhaCadastrada)}
                  className="text-[11.5px] text-primary hover:underline"
                >
                  Usar cadastrada
                </button>
              )}
            </div>
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="h-8 text-[12.5px]"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Ao salvar, o webhook de edição será chamado com os dados completos do registro para atualizar o CRM.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={saving}>{saving ? "Salvando…" : "Salvar e sincronizar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
