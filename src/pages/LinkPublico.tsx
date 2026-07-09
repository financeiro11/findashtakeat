import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkIcon, Paperclip, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/pages/auditoria/utils";

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

  useEffect(() => {
    document.title = "Takeat · Pendências";
    if (!token) { setLoading(false); return; }
    (async () => {
      const { data, error } = await supabase.rpc("resolver_token", {
        p_token: token,
        p_ip: null,
      });
      if (error) setData({ erro: "Não foi possível validar o link. Tente novamente mais tarde." });
      else setData(data as unknown as Resolve);
      setLoading(false);
    })();
  }, [token]);

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

  return <TokenPage data={data} />;
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

function TokenPage({ data }: { data: ResolveOk }) {
  const resolvidos = data.itens.filter(i => !!i.link_comprovante).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-[720px] px-4 py-3">
          <div className="text-sm font-semibold tracking-tight">Takeat · Financeiro</div>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 py-6 space-y-5">
        {/* Bloco 1 — Saudação */}
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
              <span>{data.qtd_itens ? Math.round((resolvidos / data.qtd_itens) * 100) : 0}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-[hsl(152_60%_40%)] transition-all"
                style={{ width: `${data.qtd_itens ? (resolvidos / data.qtd_itens) * 100 : 0}%` }}
              />
            </div>
          </div>
        </section>

        {/* Bloco 2 — Lista */}
        <section className="space-y-3">
          {data.itens.map((it, idx) => (
            <ItemCard key={idx} item={it} />
          ))}
        </section>

        {/* Bloco 3 — Rodapé */}
        <footer className="pt-4 pb-6 text-center text-[11px] text-muted-foreground">
          Financeiro Takeat · Este link é seu, não compartilhe.
        </footer>
      </main>
    </div>
  );
}

function ItemCard({ item }: { item: Item }) {
  const [justificativa, setJustificativa] = useState("");

  const handleAnexar = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/jpeg,image/png,image/jpg";
    input.onchange = () => {
      toast.message("Upload virá na próxima iteração");
    };
    input.click();
  };

  const handleSalvar = () => {
    toast.message("Upload virá na próxima iteração");
  };

  const meta = [
    item.data,
    item.regra,
    item.categoria,
    item.cartao_final ? `Cartão final ${item.cartao_final}` : null,
    item.parcela ? `Parcela ${item.parcela}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{item.estabelecimento}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{meta || "—"}</div>
        </div>
        <div className="num text-lg font-semibold shrink-0">{brl(Number(item.valor || 0))}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleAnexar}>
          <Paperclip className="h-3.5 w-3.5 mr-1.5" />
          Anexar comprovante
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
          <Button size="sm" onClick={handleSalvar} disabled={!justificativa.trim()}>
            Salvar justificativa
          </Button>
        </div>
      </div>
    </div>
  );
}
