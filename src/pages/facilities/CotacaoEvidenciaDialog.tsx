import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { db, fmtBRL, type Cotacao } from "./lib";

const BUCKET = "facilities-contratos";
const MAX_MB = 10;

interface Props {
  cotacao: Cotacao | null;
  solicTitulo?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

export function CotacaoEvidenciaDialog({ cotacao, solicTitulo, open, onOpenChange, onSaved }: Props) {
  const [linkUrl, setLinkUrl] = useState("");
  const [observacao, setObservacao] = useState("");
  const [anexos, setAnexos] = useState<{ nome: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cotacao) {
      setLinkUrl(cotacao.link_url ?? "");
      setObservacao(cotacao.observacao ?? "");
      setAnexos(Array.isArray(cotacao.anexos) ? cotacao.anexos : []);
    }
  }, [cotacao]);

  if (!cotacao) return null;

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length || !cotacao) return;
    setUploading(true);
    const novos: { nome: string; url: string }[] = [];
    try {
      for (const f of Array.from(files)) {
        if (f.size > MAX_MB * 1024 * 1024) {
          toast.error(`"${f.name}" excede ${MAX_MB}MB`);
          continue;
        }
        const ext = f.name.split(".").pop() ?? "bin";
        const path = `cotacoes/${cotacao.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false });
        if (error) { toast.error(`Falha ao enviar ${f.name}: ${error.message}`); continue; }
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        novos.push({ nome: f.name, url: data.publicUrl });
      }
      if (novos.length) setAnexos((prev) => [...prev, ...novos]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeAnexo(i: number) {
    setAnexos((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!cotacao) return;
    setSaving(true);
    const { error } = await db
      .from("facilities_cotacoes")
      .update({
        link_url: linkUrl.trim() || null,
        observacao: observacao.trim() || null,
        anexos: anexos,
      })
      .eq("id", cotacao.id);
    setSaving(false);
    if (error) { toast.error(`Erro ao salvar: ${error.message}`); return; }
    toast.success("Evidências salvas");
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Evidências da cotação</DialogTitle>
          <div className="text-[12px] text-muted-foreground">
            {solicTitulo && <span className="mr-1">{solicTitulo} ·</span>}
            <span className="font-medium text-foreground">{cotacao.fornecedor_nome ?? "Fornecedor"}</span>
            <span className="ml-1">· {fmtBRL(Number(cotacao.valor))}</span>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="link" className="text-[12px]">Link (planilha, e-mail, cotação online…)</Label>
            <Input
              id="link"
              placeholder="https://..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="mt-1 text-[13px]"
            />
          </div>

          <div>
            <Label htmlFor="obs" className="text-[12px]">Observação</Label>
            <Textarea
              id="obs"
              placeholder="Ex.: valor obtido em conversa com o fornecedor em 12/07, condição válida por 7 dias…"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              className="mt-1 text-[13px]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">Comprovantes ({anexos.length})</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="h-8 text-[12px]"
              >
                {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" />}
                Adicionar arquivo
              </Button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,application/pdf,.xlsx,.xls,.csv,.doc,.docx"
                onChange={(e) => handleUpload(e.target.files)}
              />
            </div>

            {anexos.length === 0 ? (
              <div className="mt-2 rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
                Nenhum comprovante anexado. Prints, PDFs de conversas, planilhas — até {MAX_MB}MB cada.
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {anexos.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                    <a href={a.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-[12.5px] text-foreground hover:underline">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{a.nome}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                    <button
                      type="button"
                      onClick={() => removeAnexo(i)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || uploading}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Salvar evidências
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
