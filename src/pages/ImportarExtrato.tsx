import { useState } from "react";
import { Upload, Loader2, FileText, CreditCard, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";

type Tipo = "cartao" | "conta";

const WEBHOOK_URL = "https://webhook.takeat.cloud/webhook/receberArquivoFinanceiro";

const ACCEPT: Record<Tipo, string> = {
  cartao: ".ofx,.txt",
  conta: ".html,.htm",
};

const ALLOWED_EXT: Record<Tipo, string[]> = {
  cartao: ["ofx", "txt"],
  conta: ["html", "htm"],
};

const TIPO_LABEL: Record<Tipo, string> = {
  cartao: "Cartão de Crédito (.ofx ou .txt)",
  conta: "Conta Corrente (.html)",
};

function getExt(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo"));
    reader.readAsText(file);
  });
}

export default function ImportarExtrato() {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<Tipo | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (!f || !tipo) {
      setFile(f);
      return;
    }
    const ext = getExt(f.name);
    if (!ALLOWED_EXT[tipo].includes(ext)) {
      toast.error(
        `Arquivo inválido para ${TIPO_LABEL[tipo]}. Selecione um arquivo ${ALLOWED_EXT[tipo]
          .map((x) => "." + x)
          .join(" ou ")}.`
      );
      e.target.value = "";
      setFile(null);
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!nome.trim()) return toast.error("Informe o nome do arquivo no Sheets");
    if (!tipo) return toast.error("Selecione o tipo de extrato");
    if (!file) return toast.error("Selecione o arquivo");

    const ext = getExt(file.name);
    if (!ALLOWED_EXT[tipo].includes(ext)) {
      return toast.error(
        `Arquivo inválido para ${TIPO_LABEL[tipo]}. Selecione um arquivo ${ALLOWED_EXT[tipo]
          .map((x) => "." + x)
          .join(" ou ")}.`
      );
    }

    setSending(true);
    try {
      const conteudoArquivo = await readFileAsText(file);

      const r = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomeSheets: nome.trim(),
          tipoExtrato: tipo,
          conteudoArquivo,
        }),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(text || `Erro ${r.status} ao enviar arquivo`);
      }

      toast.success("Arquivo enviado com sucesso para automação");
      setNome("");
      setTipo("");
      setFile(null);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar arquivo");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight">Importar Extrato (Automação IA)</h2>
        <p className="text-sm text-muted-foreground">
          Envie extratos bancários para o pipeline de planilhamento automático com IA.
        </p>
      </div>

      <Card className="max-w-2xl border-border shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Envio de extrato financeiro
          </CardTitle>
          <CardDescription>
            O conteúdo do arquivo é lido e enviado de forma segura para o fluxo de automação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome do arquivo no Sheets *</Label>
            <Input
              id="nome"
              placeholder="Ex: Fatura Janeiro 2026"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={200}
              disabled={sending}
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de Extrato *</Label>
            <RadioGroup
              value={tipo}
              onValueChange={(v) => {
                setTipo(v as Tipo);
                setFile(null);
              }}
              disabled={sending}
            >
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2.5 text-sm hover:bg-secondary">
                <RadioGroupItem value="cartao" id="t1" />
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span>
                  Cartão de Crédito{" "}
                  <span className="text-muted-foreground">(.ofx ou .txt)</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2.5 text-sm hover:bg-secondary">
                <RadioGroupItem value="conta" id="t2" />
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span>
                  Conta Corrente <span className="text-muted-foreground">(.html)</span>
                </span>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-1.5">
            <Label>Arquivo</Label>
            <label
              className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-center text-sm transition-colors ${
                tipo && !sending
                  ? "cursor-pointer border-border hover:bg-secondary/50"
                  : "cursor-not-allowed border-border/50 text-muted-foreground"
              }`}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              {!tipo ? (
                <span>Selecione o tipo de extrato primeiro</span>
              ) : file ? (
                <span className="font-medium text-foreground">{file.name}</span>
              ) : (
                <span>Clique para selecionar ({ACCEPT[tipo]})</span>
              )}
              <input
                type="file"
                hidden
                disabled={!tipo || sending}
                accept={tipo ? ACCEPT[tipo] : undefined}
                onChange={handleFileChange}
              />
            </label>
          </div>

          <Button
            onClick={submit}
            disabled={sending || !nome || !tipo || !file}
            className="w-full"
          >
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
              </>
            ) : (
              "Enviar extrato"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
