import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LinkIcon, Paperclip, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/pages/auditoria/utils";

const SUPABASE_URL = "https://lgcxyxyidoirqmbdlldh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U";

type Item = {
  id_unico: string;
  estabelecimento: string;
  valor: number;
  regra: string;
  categoria: string | null;
  data: string;
  cartao_final: string | null;
  parcela: string | null;
  status: string;
  link_comprovante: string | null;
  justificativa: string | null;
  resolvido: boolean;
};

type ResolveOk = {
  responsavel: string;
  qtd_itens: number;
  valor_total: number;
  expira_em: string;
  acessos: number;
  itens: Item[];
  erro?: undefined;
};
type ResolveErr = { erro: string };
type Resolve = ResolveOk | ResolveErr;

export default function LinkPublico() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Resolve | null>(null);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    const { data, error } = await supabase.rpc("resolver_token", {
      p_token: token,
      p_ip: null,
    });
    if (error) setData({ erro: "Não foi possível validar o link. Tente novamente mais tarde." });
    else setData(data as unknown as Resolve);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    document.title = "Takeat · Pendências";
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-[720px] space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data || "erro" in data) {
    return <ErrorPage message={data?.erro || "Link inválido"} />;
  }

  return <TokenPage data={data} token={token!} onRefresh={load} />;
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px] text-center space-y-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-muted flex items-center justify-center">
          <LinkIcon className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Link inválido ou expirado</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-sm text-muted-foreground">
          Entre em contato com o financeiro pra receber um novo link.
        </p>
      </div>
    </div>
  );
}

function TokenPage({ data, token, onRefresh }: { data: ResolveOk; token: string; onRefresh: () => Promise<void> }) {
  const resolvidos = data.itens.filter(i => i.resolvido).length;
  const pct = data.qtd_itens ? Math.round((resolvidos / data.qtd_itens) * 100) : 0;
  const allDone = data.qtd_itens > 0 && resolvidos === data.qtd_itens;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-[720px] px-4 py-3">
          <div className="text-sm font-semibold tracking-tight">Takeat · Financeiro</div>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 py-6 space-y-5">
        {allDone && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-900">
              <strong>Você resolveu todas as {data.qtd_itens} pendências!</strong>
              <div>O time financeiro vai revisar e retornar em breve. Obrigado!</div>
            </div>
          </div>
        )}

        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">Olá, {data.responsavel}!</h1>
          <p className="text-sm text-foreground/80">
            Você tem <strong>{data.qtd_itens}</strong> pendência{data.qtd_itens === 1 ? "" : "s"} totalizando{" "}
            <strong>{brl(Number(data.valor_total || 0))}</strong> pra resolver.
          </p>

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Este link expira em <strong>{data.expira_em}</strong>.</span>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{resolvidos} de {data.qtd_itens} lançamento{data.qtd_itens === 1 ? "" : "s"} resolvido{resolvidos === 1 ? "" : "s"}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          {data.itens.map((it) => (
            <ItemCard key={it.id_unico} item={it} token={token} onRefresh={onRefresh} />
          ))}
        </section>

        <footer className="pt-4 pb-6 text-center text-[11px] text-muted-foreground">
          Financeiro Takeat · Este link é seu, não compartilhe.
        </footer>
      </main>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ItemCard({ item, token, onRefresh }: { item: Item; token: string; onRefresh: () => Promise<void> }) {
  const [justificativa, setJustificativa] = useState(item.justificativa || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAnexar = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/jpeg,image/png";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Arquivo maior que 10 MB não é aceito");
        return;
      }
      setUploading(true);
      try {
        const base64 = await fileToBase64(file);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/anexar-comprovante-auditoria`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            token,
            id_unico: item.id_unico,
            file_base64: base64,
            filename: file.name,
            mime_type: file.type,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          toast.success("Comprovante anexado com sucesso");
          await onRefresh();
        } else {
          toast.error(data.erro || "Erro ao anexar comprovante");
        }
      } catch {
        toast.error("Erro ao anexar comprovante");
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const handleSalvar = async () => {
    if (!justificativa.trim()) {
      toast.error("Escreva uma justificativa antes de salvar");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("salvar_justificativa_via_token", {
        p_token: token,
        p_id_unico: item.id_unico,
        p_texto: justificativa,
      });
      const payload = data as { ok?: boolean; erro?: string } | null;
      if (error || !payload?.ok) {
        toast.error(payload?.erro || "Erro ao salvar justificativa");
      } else {
        toast.success("Justificativa salva");
        await onRefresh();
      }
    } catch {
      toast.error("Erro ao salvar justificativa");
    } finally {
      setSaving(false);
    }
  };

  const meta = [
    item.data,
    item.regra,
    item.categoria,
    item.cartao_final ? `Cartão final ${item.cartao_final}` : null,
    item.parcela ? `Parcela ${item.parcela}` : null,
  ].filter(Boolean).join(" · ");

  const resolvido = item.resolvido;
  const jShort = item.justificativa && item.justificativa.length > 100
    ? item.justificativa.slice(0, 100) + "..."
    : item.justificativa;

  return (
    <div
      className={`rounded-lg border bg-muted/30 p-4 space-y-3 ${resolvido ? "border-emerald-200" : "border-border"}`}
      style={resolvido ? { borderLeft: "4px solid #10B981" } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {resolvido && (
            <Badge className="mb-1.5 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200">
              ✓ Resolvido
            </Badge>
          )}
          <div className="font-medium text-sm truncate">{item.estabelecimento}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{meta || "—"}</div>
        </div>
        <div className="num text-lg font-semibold shrink-0">{brl(Number(item.valor || 0))}</div>
      </div>

      {resolvido && item.link_comprovante && (
        <div className="text-xs text-emerald-800 bg-emerald-50 rounded px-2 py-1.5">
          📎 Comprovante anexado
        </div>
      )}
      {resolvido && item.justificativa && (
        <div className="text-xs text-emerald-800 bg-emerald-50 rounded px-2 py-1.5">
          💬 {jShort}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleAnexar} disabled={uploading}>
          {uploading ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Enviando...</>
          ) : (
            <><Paperclip className="h-3.5 w-3.5 mr-1.5" />{item.link_comprovante ? "Substituir comprovante" : "Anexar comprovante"}</>
          )}
        </Button>
      </div>

      <div className="space-y-2">
        <Textarea
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          rows={3}
          placeholder="Explique o gasto ou justifique a ausência de NF"
          className="text-sm"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSalvar} disabled={saving || !justificativa.trim()}>
            {saving ? (<><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Salvando...</>) : "Salvar justificativa"}
          </Button>
        </div>
      </div>
    </div>
  );
}
