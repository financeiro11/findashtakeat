import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}

const daysBetween = (a: string, b: string) => {
  if (!a || !b) return 0;
  const d1 = new Date(a + "T00:00").getTime();
  const d2 = new Date(b + "T00:00").getTime();
  return Math.max(0, Math.round((d2 - d1) / 86400000) + 1);
};

export default function NovaViagemDialog({ open, onOpenChange, onSaved }: Props) {
  const [colaborador, setColaborador] = useState("");
  const [destino, setDestino] = useState("");
  const [dataIda, setDataIda] = useState("");
  const [dataVolta, setDataVolta] = useState("");
  const [valor, setValor] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setColaborador(""); setDestino(""); setDataIda(""); setDataVolta(""); setValor("");
    }
  }, [open]);

  const dias = daysBetween(dataIda, dataVolta);

  const submit = async () => {
    if (!colaborador.trim() || !destino.trim()) return toast.error("Preencha colaborador e destino");
    if (!dataIda) return toast.error("Informe a data de ida");
    const v = Number((valor || "0").toString().replace(",", "."));
    if (!(v >= 0)) return toast.error("Valor inválido");
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const hash = `manual-${crypto.randomUUID()}`;
    const { error } = await supabase.from("recargas_viagens_manuais" as any).insert({
      colaborador: colaborador.trim(),
      destino: destino.trim(),
      data_ida: dataIda,
      data_volta: dataVolta || null,
      dias,
      valor_total: v,
      viagem_hash: hash,
      created_by: userData.user?.id ?? null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Recarga criada");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nova recarga · Viagem</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Colaborador</Label>
            <Input value={colaborador} onChange={(e) => setColaborador(e.target.value)} placeholder="Nome do colaborador" />
          </div>
          <div>
            <Label className="text-xs">Destino / Evento</Label>
            <Input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ex: BurgerExpo - São Paulo" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Ida</Label>
              <Input type="date" value={dataIda} onChange={(e) => setDataIda(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Volta</Label>
              <Input type="date" value={dataVolta} onChange={(e) => setDataVolta(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Dias</Label>
              <Input value={dias} readOnly className="bg-muted" />
            </div>
            <div>
              <Label className="text-xs">Valor total (R$)</Label>
              <Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="bg-rose-600 hover:bg-rose-700 text-white">
            {saving ? "Salvando..." : "Criar recarga"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
