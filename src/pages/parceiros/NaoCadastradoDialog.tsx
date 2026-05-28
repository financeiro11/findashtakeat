import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Link2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type Tier = "Tier 1" | "Tier 2" | "Tier 3" | "Não possui";
type Metodo = "%" | "Fixo $";

type ExistingParceiro = { id: string; nome: string; tier: string; status: string };

export function NaoCadastradoDialog({
  open,
  onOpenChange,
  nome,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nome: string;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<"novo" | "associar">("novo");
  const [saving, setSaving] = useState(false);
  const [existentes, setExistentes] = useState<ExistingParceiro[]>([]);
  const [selectedAssoc, setSelectedAssoc] = useState<string>("");

  const [form, setForm] = useState({
    nome,
    tier: "Não possui" as Tier,
    status: "ativo" as "ativo" | "inativo",
    campanha: "" as string,
    bonificacao: false,
    metodo_bonificacao: "%" as Metodo,
    valor_bonificacao: null as number | null,
    recorrencia: false,
    metodo_recorrencia: "%" as Metodo,
    valor_recorrencia: null as number | null,
  });

  useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, nome }));
      setMode("novo");
      setSelectedAssoc("");
      supabase
        .from("parceiros_cadastro")
        .select("id,nome,tier,status")
        .order("nome", { ascending: true })
        .then(({ data }) => setExistentes((data ?? []) as ExistingParceiro[]));
    }
  }, [open, nome]);

  const handleCadastrar = async () => {
    if (!form.nome.trim()) return toast.warning("Informe o nome");
    setSaving(true);
    const { error } = await supabase.from("parceiros_cadastro").insert({
      nome: form.nome.trim(),
      tier: form.tier,
      status: form.status,
      campanha: form.campanha.trim() || null,
      bonificacao: form.bonificacao,
      metodo_bonificacao: form.bonificacao ? form.metodo_bonificacao : null,
      valor_bonificacao: form.bonificacao ? form.valor_bonificacao : null,
      recorrencia: form.recorrencia,
      metodo_recorrencia: form.recorrencia ? form.metodo_recorrencia : null,
      valor_recorrencia: form.recorrencia ? form.valor_recorrencia : null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Parceiro cadastrado");
    onOpenChange(false);
    onDone?.();
  };

  const handleAssociar = async () => {
    if (!selectedAssoc) return toast.warning("Selecione um parceiro");
    const alvo = existentes.find((e) => e.id === selectedAssoc);
    if (!alvo) return;
    setSaving(true);
    try {
      // Match tolerante: ignora espaços extras e diferenças de caixa
      const pattern = `%${nome.trim()}%`;
      const upd1 = await supabase
        .from("parceiros_indicacoes")
        .update({ indicador: alvo.nome })
        .ilike("indicador", pattern)
        .select("id");
      const upd2 = await supabase
        .from("parceiros_recorrencias")
        .update({ indicador: alvo.nome })
        .ilike("indicador", pattern)
        .select("id");
      if (upd1.error) throw upd1.error;
      if (upd2.error) throw upd2.error;
      const total = (upd1.data?.length ?? 0) + (upd2.data?.length ?? 0);
      if (total === 0) {
        toast.warning(`Nenhum registro encontrado com indicador "${nome}"`);
      } else {
        toast.success(`${total} registro(s) associado(s) a ${alvo.nome}`);
        onOpenChange(false);
        onDone?.();
      }
    } catch (err: any) {
      toast.error(err?.message || "Falha ao associar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Embaixador não cadastrado</DialogTitle>
          <DialogDescription>
            "{nome}" não está cadastrado na Gestão de Parceiros. Cadastre como novo ou associe a um já existente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5 rounded-md border border-border bg-muted/30 p-1">
          <button
            onClick={() => setMode("novo")}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[12.5px] transition-colors ${mode === "novo" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            <UserPlus className="h-3.5 w-3.5" /> Cadastrar novo
          </button>
          <button
            onClick={() => setMode("associar")}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[12.5px] transition-colors ${mode === "associar" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Link2 className="h-3.5 w-3.5" /> Associar a existente
          </button>
        </div>

        {mode === "novo" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[12px]">Tier</Label>
                <Select value={form.tier} onValueChange={(v) => setForm((f) => ({ ...f, tier: v as Tier }))}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["Tier 1","Tier 2","Tier 3","Não possui"] as Tier[]).map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as any }))}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Campanha</Label>
              <Input
                value={form.campanha}
                onChange={(e) => setForm((f) => ({ ...f, campanha: e.target.value }))}
                placeholder="(opcional)"
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label className="text-[12.5px]">Bonificação</Label>
              <Switch
                checked={form.bonificacao}
                onCheckedChange={(v) => setForm((f) => ({ ...f, bonificacao: v }))}
              />
            </div>
            {form.bonificacao && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={form.metodo_bonificacao} onValueChange={(v) => setForm((f) => ({ ...f, metodo_bonificacao: v as Metodo }))}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="%">% (percentual)</SelectItem>
                    <SelectItem value="Fixo $">Fixo $</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number" step="0.01"
                  value={form.valor_bonificacao ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, valor_bonificacao: e.target.value === "" ? null : Number(e.target.value) }))}
                  className="h-8 text-[12.5px]"
                />
              </div>
            )}
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label className="text-[12.5px]">Recorrência</Label>
              <Switch
                checked={form.recorrencia}
                onCheckedChange={(v) => setForm((f) => ({ ...f, recorrencia: v }))}
              />
            </div>
            {form.recorrencia && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={form.metodo_recorrencia} onValueChange={(v) => setForm((f) => ({ ...f, metodo_recorrencia: v as Metodo }))}>
                  <SelectTrigger className="h-8 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="%">% (percentual)</SelectItem>
                    <SelectItem value="Fixo $">Fixo $</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number" step="0.01"
                  value={form.valor_recorrencia ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, valor_recorrencia: e.target.value === "" ? null : Number(e.target.value) }))}
                  className="h-8 text-[12.5px]"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Selecione um parceiro cadastrado</Label>
              <Select value={selectedAssoc} onValueChange={setSelectedAssoc}>
                <SelectTrigger className="h-8 text-[12.5px]"><SelectValue placeholder="Escolha um parceiro…" /></SelectTrigger>
                <SelectContent>
                  {existentes.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}{e.status === "inativo" ? " (inativo)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11.5px] text-muted-foreground">
                Todos os registros com o nome "{nome}" serão atualizados para o nome do parceiro selecionado nas listas de Indicações e Apuração Recorrências.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          {mode === "novo" ? (
            <Button onClick={handleCadastrar} disabled={saving}>{saving ? "Salvando…" : "Cadastrar"}</Button>
          ) : (
            <Button onClick={handleAssociar} disabled={saving || !selectedAssoc}>{saving ? "Associando…" : "Associar"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
