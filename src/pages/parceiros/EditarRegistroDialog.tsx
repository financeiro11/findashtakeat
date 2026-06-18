import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const WEBHOOK = "https://webhook.takeat.cloud/webhook/edicao_feita_dash_parceiros";

export type EditarRegistroTarget = {
  table: "parceiros_indicacoes" | "parceiros_recorrencias";
  id: string;
  embaixadorAtual: string;
  campanhaAtual: string;
  empresa?: string;
};

type Cadastro = { nome: string; campanha: string | null; status: string };

export function EditarRegistroDialog({
  open,
  onOpenChange,
  target,
  cadastros,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: EditarRegistroTarget | null;
  cadastros: Array<{ nome: string; campanha: string | null; status: string }>;
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [embaixador, setEmbaixador] = useState("");
  const [campanha, setCampanha] = useState("");

  useEffect(() => {
    if (open && target) {
      setEmbaixador(target.embaixadorAtual || "");
      setCampanha(target.campanhaAtual || "");
    }
  }, [open, target]);

  const cadastroSelecionado = useMemo<Cadastro | undefined>(
    () => cadastros.find((c) => (c.nome || "").trim().toLowerCase() === (embaixador || "").trim().toLowerCase()),
    [cadastros, embaixador],
  );

  if (!target) return null;

  const handleSalvar = async () => {
    const novoEmb = embaixador.trim();
    const novaCamp = campanha.trim();
    if (!novoEmb && !novaCamp) {
      return toast.warning("Informe ao menos o embaixador ou a campanha");
    }
    setSaving(true);
    try {
      const { data: updated, error } = await supabase
        .from(target.table)
        .update({
          indicador: novoEmb || null,
          nome_campanha: novaCamp || null,
        })
        .eq("id", target.id)
        .select("*")
        .single();
      if (error) throw error;

      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tabela: target.table,
            tipo: target.table === "parceiros_indicacoes" ? "indicacao" : "recorrencia",
            alteracoes: {
              embaixador_anterior: target.embaixadorAtual || null,
              embaixador_novo: novoEmb || null,
              campanha_anterior: target.campanhaAtual || null,
              campanha_nova: novaCamp || null,
            },
            user_id: user?.id ?? null,
            user_email: user?.email ?? null,
            registro: updated,
          }),
        });
      } catch (whErr) {
        console.warn("Webhook edicao_feita_dash_parceiros falhou", whErr);
      }

      toast.success("Registro atualizado");
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
            <Pencil className="h-4 w-4 text-primary" />
            Editar registro
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {target.empresa ? <>Empresa: <span className="font-medium">{target.empresa}</span>. </> : null}
            Atualize o embaixador e/ou a campanha deste registro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">Embaixador</Label>
              {cadastros.length > 0 && (
                <Select onValueChange={(v) => setEmbaixador(v)}>
                  <SelectTrigger className="h-7 w-[160px] text-[11.5px]">
                    <SelectValue placeholder="Selecionar cadastrado…" />
                  </SelectTrigger>
                  <SelectContent>
                    {cadastros
                      .slice()
                      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""))
                      .map((c) => (
                        <SelectItem key={c.nome} value={c.nome}>
                          {c.nome}{c.status === "inativo" ? " (inativo)" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Input
              value={embaixador}
              onChange={(e) => setEmbaixador(e.target.value)}
              placeholder="Nome do embaixador"
              className="h-8 text-[12.5px]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">Campanha</Label>
              {cadastroSelecionado?.campanha && cadastroSelecionado.campanha !== campanha && (
                <button
                  type="button"
                  onClick={() => setCampanha(cadastroSelecionado.campanha || "")}
                  className="text-[11.5px] text-primary hover:underline"
                >
                  Usar cadastrada ({cadastroSelecionado.campanha})
                </button>
              )}
            </div>
            <Input
              value={campanha}
              onChange={(e) => setCampanha(e.target.value)}
              placeholder="Nome da campanha"
              className="h-8 text-[12.5px]"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Ao salvar, o webhook de edição é chamado com todos os dados do registro para sincronizar o CRM.
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
