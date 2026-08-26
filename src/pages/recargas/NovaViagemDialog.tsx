import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputMoeda } from "@/components/ui/input-moeda";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calculator } from "lucide-react";
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

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const DIARIA_PADRAO = 120;

export default function NovaViagemDialog({ open, onOpenChange, onSaved }: Props) {
  const [colaborador, setColaborador] = useState("");
  const [destino, setDestino] = useState("");
  const [dataIda, setDataIda] = useState("");
  const [dataVolta, setDataVolta] = useState("");
  const [valor, setValor] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Calculadora de diárias
  const [valorDiaria, setValorDiaria] = useState<string>(String(DIARIA_PADRAO));
  const [idaTarde, setIdaTarde] = useState(false);
  const [voltaManha, setVoltaManha] = useState(false);

  useEffect(() => {
    if (open) {
      setColaborador(""); setDestino(""); setDataIda(""); setDataVolta(""); setValor("");
      setValorDiaria(String(DIARIA_PADRAO)); setIdaTarde(false); setVoltaManha(false);
    }
  }, [open]);

  const dias = daysBetween(dataIda, dataVolta);

  const calculo = useMemo(() => {
    const diariaCheia = Number((valorDiaria || "0").toString().replace(",", "."));
    const diasCalc = dataIda ? (daysBetween(dataIda, dataVolta || dataIda) || 1) : 0;
    if (diasCalc <= 0 || !(diariaCheia > 0)) return null;
    const meiaDiaria = diariaCheia / 2;
    let totalCalc = diasCalc * diariaCheia;
    if (idaTarde) totalCalc -= meiaDiaria;
    if (voltaManha) totalCalc -= meiaDiaria;
    totalCalc = Math.max(0, totalCalc);
    return { dias: diasCalc, diariaCheia, meiaDiaria, total: totalCalc };
  }, [dataIda, dataVolta, valorDiaria, idaTarde, voltaManha]);

  const aplicarCalculo = () => {
    if (!calculo) return;
    setValor(calculo.total.toFixed(2));
  };

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
      <DialogContent className="sm:max-w-lg">
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

          {/* Calculadora de diárias */}
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Calculator className="h-3.5 w-3.5" /> Calculadora de diárias
            </div>
            <div>
              <Label className="text-xs">Valor da diária (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={valorDiaria}
                onChange={(e) => setValorDiaria(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={idaTarde} onCheckedChange={(c) => setIdaTarde(c === true)} />
                Ida depois do meio-dia (recebe meia diária no dia da ida)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={voltaManha} onCheckedChange={(c) => setVoltaManha(c === true)} />
                Volta antes do almoço (recebe meia diária no dia da volta)
              </label>
            </div>
            {calculo && (
              <div className="rounded-md border border-dashed border-border bg-background p-2 text-[11.5px] text-muted-foreground space-y-0.5">
                <div>
                  {calculo.dias} diária(s) × {fmt(calculo.diariaCheia)} = {fmt(calculo.dias * calculo.diariaCheia)}
                </div>
                {idaTarde && <div>− meia diária (ida à tarde): − {fmt(calculo.meiaDiaria)}</div>}
                {voltaManha && <div>− meia diária (volta pela manhã): − {fmt(calculo.meiaDiaria)}</div>}
                <div className="pt-1 text-sm font-semibold text-foreground">
                  Total calculado: {fmt(calculo.total)}
                </div>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!calculo}
              onClick={aplicarCalculo}
            >
              Usar valor calculado
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Dias</Label>
              <Input value={dias} readOnly className="bg-muted" />
            </div>
            <div>
              <Label className="text-xs">Valor total (R$)</Label>
              <InputMoeda value={valor} onChange={(v) => setValor(v === "" ? "" : String(v))} />
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
