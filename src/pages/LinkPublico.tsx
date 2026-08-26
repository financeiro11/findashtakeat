import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LinkIcon, Paperclip, AlertTriangle, Loader2, Check, Send, X, ChevronDown, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/pages/auditoria/utils";
import takeatLogo from "@/assets/takeat-logo-white.png";

const SUPABASE_URL = "https://lgcxyxyidoirqmbdlldh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U";

/** Vermelho institucional da Takeat, o mesmo da barra lateral do Hub. */
const TINTA = "hsl(0 72% 30%)";

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
  /** null = link permanente (o padrão). Data só nos tokens antigos, que ainda têm prazo. */
  expira_em: string | null;
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
    document.title = "Takeat · Pendências do cartão";
    load();
  }, [load]);

  if (loading) return <Carregando />;
  if (!data || "erro" in data) return <ErrorPage message={data?.erro || "Link inválido"} />;
  return <TokenPage data={data} token={token!} onRefresh={load} />;
}

/* ------------------------------------------------------------------ *
 *  Casca da página — cabeçalho de marca comum a todos os estados
 * ------------------------------------------------------------------ */

function Cabecalho({ progresso }: { progresso?: { feitos: number; total: number } }) {
  const pct = progresso && progresso.total ? (progresso.feitos / progresso.total) * 100 : 0;
  return (
    <header className="sticky top-0 z-20" style={{ backgroundColor: TINTA }}>
      <div className="mx-auto flex max-w-[680px] items-center gap-2.5 px-5 py-3">
        <img src={takeatLogo} alt="Takeat" className="h-6 w-6 object-contain" />
        <span className="text-[13px] font-medium tracking-wide text-white/85">Hub Financeiro</span>
        {progresso && progresso.total > 0 && (
          <span className="num ml-auto text-[12px] text-white/70">
            {progresso.feitos}/{progresso.total}
          </span>
        )}
      </div>
      {/* Fio de progresso rente à barra: acompanha a rolagem sem ocupar espaço. */}
      {progresso && progresso.total > 0 && (
        <div className="h-[3px] w-full bg-white/15">
          <div className="h-full bg-white/85 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </header>
  );
}

function Carregando() {
  return (
    <div className="min-h-screen bg-background">
      <Cabecalho />
      <main className="mx-auto max-w-[680px] space-y-8 px-5 py-8">
        <div className="space-y-3">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-full max-w-[420px]" />
        </div>
        <Skeleton className="h-20 w-full" />
        <div className="space-y-3">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      </main>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-background">
      <Cabecalho />
      <main className="mx-auto max-w-[680px] px-5 py-16">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border">
          <LinkIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Não conseguimos abrir este link</h1>
        <p className="mt-2 max-w-[440px] text-sm leading-relaxed text-muted-foreground">{message}</p>
        <p className="mt-6 max-w-[440px] text-sm leading-relaxed text-muted-foreground">
          Fale com o time financeiro pelo WhatsApp que a gente reenvia o seu acesso.
        </p>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Página do líder
 * ------------------------------------------------------------------ */

function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0] || nome;
}

function TokenPage({ data, token, onRefresh }: { data: ResolveOk; token: string; onRefresh: () => Promise<void> }) {
  const { abertos, resolvidos, valorAberto } = useMemo(() => {
    const abertos = data.itens.filter(i => !i.resolvido);
    const resolvidos = data.itens.filter(i => i.resolvido);
    return {
      abertos,
      resolvidos,
      valorAberto: abertos.reduce((s, i) => s + Number(i.valor || 0), 0),
    };
  }, [data.itens]);

  const total = data.itens.length;
  const tudoFeito = total > 0 && abertos.length === 0;

  return (
    <div className="min-h-screen bg-background pb-16">
      <Cabecalho progresso={{ feitos: resolvidos.length, total }} />

      <main className="mx-auto max-w-[680px] px-5">
        {/* Abertura */}
        <section className="pt-9">
          <div className="eyebrow">Auditoria do cartão corporativo</div>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">
            Olá, {primeiroNome(data.responsavel)}.
          </h1>
          <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-muted-foreground">
            {tudoFeito ? (
              <>Tudo o que estava sob sua alçada já foi respondido. O financeiro revisa e volta a falar
                com você se faltar alguma coisa.</>
            ) : (
              <>Estes lançamentos do cartão precisam de <strong className="font-medium text-foreground">nota
                fiscal</strong> ou de uma <strong className="font-medium text-foreground">justificativa
                por escrito</strong>. Resolva um de cada vez — cada envio já chega no Hub na hora.</>
            )}
          </p>
        </section>

        {/* Números — o que ainda falta, não o histórico */}
        <section className="mt-8 grid grid-cols-2 divide-x divide-border border-y border-border">
          <div className="py-4 pr-4">
            <div className="eyebrow">Em aberto</div>
            {/* Em tela de 360px cada coluna tem ~155px: "R$ 4.312,80" em 26px de mono
                estoura. Só cresce a partir do sm. */}
            <div className="num mt-1.5 text-[21px] font-semibold leading-none tracking-tight sm:text-[26px]">
              {abertos.length}
            </div>
            <div className="mt-1.5 text-[12px] text-muted-foreground">
              de {total} lançamento{total === 1 ? "" : "s"}
            </div>
          </div>
          <div className="py-4 pl-4">
            <div className="eyebrow">Valor pendente</div>
            {/* Em tela de 360px cada coluna tem ~155px: "R$ 4.312,80" em 26px de mono
                estoura. Só cresce a partir do sm. */}
            <div className="num mt-1.5 text-[21px] font-semibold leading-none tracking-tight sm:text-[26px]">
              {brl(valorAberto)}
            </div>
            <div className="mt-1.5 text-[12px] text-muted-foreground">
              {resolvidos.length} já respondido{resolvidos.length === 1 ? "" : "s"}
            </div>
          </div>
        </section>

        {tudoFeito && (
          <div
            className="mt-6 flex items-start gap-3 rounded-lg border p-4"
            style={{ borderColor: "hsl(var(--pos) / 0.35)", background: "hsl(var(--pos) / 0.07)" }}
          >
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "hsl(var(--pos))" }} />
            <p className="text-sm leading-relaxed">
              <strong className="font-semibold">Nada pendente por aqui.</strong>{" "}
              <span className="text-muted-foreground">
                Se chegar um lançamento novo, ele aparece nesta mesma página.
              </span>
            </p>
          </div>
        )}

        {/* Pendências em aberto */}
        {abertos.length > 0 && (
          <section className="mt-10">
            <TituloSecao texto="Precisam de resposta" contagem={abertos.length} />
            <div className="mt-4 space-y-3">
              {abertos.map(it => (
                <ItemCard key={it.id_unico} item={it} token={token} onRefresh={onRefresh} />
              ))}
            </div>
          </section>
        )}

        {/* Já resolvidas — recolhidas, mas acessíveis pra corrigir */}
        {resolvidos.length > 0 && (
          <section className="mt-10">
            <TituloSecao texto="Já respondidas" contagem={resolvidos.length} />
            <div className="mt-4 space-y-2">
              {resolvidos.map(it => (
                <ItemCard key={it.id_unico} item={it} token={token} onRefresh={onRefresh} />
              ))}
            </div>
          </section>
        )}

        {/* Rodapé */}
        <footer className="mt-14 border-t border-border pt-5">
          <div className="flex items-start gap-2.5">
            {data.expira_em ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
            ) : (
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {data.expira_em ? (
                <>Este link expira em <strong className="font-medium text-foreground">{data.expira_em}</strong>.</>
              ) : (
                <>Este endereço é só seu e não expira — pode salvar e voltar quando precisar. Não repasse a ninguém.</>
              )}
            </p>
          </div>
          <div className="mt-4 text-[11px] text-muted-foreground/70">
            Takeat · Hub Financeiro
          </div>
        </footer>
      </main>
    </div>
  );
}

function TituloSecao({ texto, contagem }: { texto: string; contagem: number }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="eyebrow shrink-0">{texto}</h2>
      <div className="h-px flex-1 bg-border" />
      <span className="num text-[12px] text-muted-foreground">{contagem}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Uma pendência
 * ------------------------------------------------------------------ */

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function kb(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ItemCard({ item, token, onRefresh }: { item: Item; token: string; onRefresh: () => Promise<void> }) {
  const [justificativa, setJustificativa] = useState(item.justificativa || "");
  // O arquivo fica ESPERANDO aqui até o líder apertar "Enviar pro Hub". Cada pendência
  // envia a sua — não existe mais um envio em lote no fim da página.
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [expandido, setExpandido] = useState(false);

  const resolvido = item.resolvido;
  const aberto = !resolvido || expandido;

  const justSalva = (item.justificativa || "").trim();
  const justNova = justificativa.trim() !== "" && justificativa.trim() !== justSalva;
  const podeEnviar = !!arquivo || justNova;

  const handleEscolher = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/jpeg,image/png";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Arquivo maior que 10 MB não é aceito");
        return;
      }
      setArquivo(file);
    };
    input.click();
  };

  /** Manda esta pendência (comprovante e/ou justificativa) pro Hub num clique só. */
  const handleEnviar = async () => {
    if (!podeEnviar) return;
    setEnviando(true);
    try {
      if (arquivo) {
        const base64 = await fileToBase64(arquivo);
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
            filename: arquivo.name,
            mime_type: arquivo.type,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          // A justificativa não vai sozinha: se o comprovante falhou, o líder precisa
          // ver o erro e tentar de novo com o texto ainda na tela.
          toast.error(data.erro || "Erro ao enviar o comprovante");
          return;
        }
      }

      if (justNova) {
        const { data, error } = await supabase.rpc("salvar_justificativa_via_token", {
          p_token: token,
          p_id_unico: item.id_unico,
          p_texto: justificativa,
        });
        const payload = data as { ok?: boolean; erro?: string } | null;
        if (error || !payload?.ok) {
          toast.error(payload?.erro || error?.message || "Erro ao enviar a justificativa");
          return;
        }
      }

      toast.success(arquivo ? "Comprovante enviado pro Hub" : "Justificativa enviada pro Hub");
      setArquivo(null);
      setExpandido(false);
      await onRefresh();
    } catch {
      toast.error("Erro ao enviar pro Hub");
    } finally {
      setEnviando(false);
    }
  };

  // A `regra` vem do robô da auditoria como frase, não como código: "SEM NF (sem
  // comprovante nas 6 bases varridas)". Vira etiqueta em caixa alta a parte de fora
  // dos parênteses, e o que está dentro segue como texto normal — 90 caracteres
  // gritando em maiúsculas não se leem.
  const casaRegra = (item.regra || "").match(/^([^(]+?)\s*(?:\((.*)\)\s*)?$/);
  const regraCodigo = (casaRegra?.[1] || item.regra || "").trim();
  const regraDetalhe = (casaRegra?.[2] || "").trim() || null;

  // A categoria quase sempre repete o código da regra ("SEM NF" nos dois) — mostrar
  // as duas faz a linha parecer erro de montagem.
  const categoria = item.categoria && item.categoria.trim().toUpperCase() !== regraCodigo.toUpperCase()
    ? item.categoria
    : null;

  const meta = [
    item.data,
    item.cartao_final ? `final ${item.cartao_final}` : null,
    item.parcela ? `parcela ${item.parcela}` : null,
    categoria,
  ].filter(Boolean).join(" · ");

  /* ---- Resolvida e recolhida: uma linha, sem ruído ---- */
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setExpandido(true)}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: "hsl(var(--pos) / 0.14)" }}
        >
          <Check className="h-3 w-3" style={{ color: "hsl(var(--pos))" }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{item.estabelecimento}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {item.link_comprovante && item.justificativa
              ? "Comprovante e justificativa enviados"
              : item.link_comprovante ? "Comprovante enviado" : "Justificativa enviada"}
          </span>
        </span>
        <span className="num shrink-0 text-[13px] text-muted-foreground">{brl(Number(item.valor || 0))}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  /* ---- Aberta (ou reaberta pra corrigir) ---- */
  return (
    <article
      className="overflow-hidden rounded-lg border border-border bg-card"
      style={resolvido ? { borderColor: "hsl(var(--pos) / 0.35)" } : undefined}
    >
      {/* Identificação do gasto */}
      <div className="flex items-start gap-4 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-medium leading-snug">{item.estabelecimento}</h3>
          <div className="mt-1 text-[12px] text-muted-foreground">{meta || "—"}</div>
        </div>
        <div className="num shrink-0 text-[17px] font-semibold tracking-tight">
          {brl(Number(item.valor || 0))}
        </div>
      </div>

      {/* Motivo da cobrança — é o que o líder precisa entender antes de agir */}
      {regraCodigo && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3">
          <span
            className="inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{
              borderColor: "hsl(var(--warn) / 0.35)",
              background: "hsl(var(--warn) / 0.10)",
              // O --warn (48% de luz) não tem contraste sobre o próprio fundo a 10%;
              // é o mesmo tom escurecido só para o texto passar de 4.5:1.
              color: "hsl(38 92% 30%)",
            }}
          >
            {regraCodigo}
          </span>
          {regraDetalhe && (
            <span className="text-[12px] leading-snug text-muted-foreground">{regraDetalhe}</span>
          )}
        </div>
      )}

      {resolvido && (
        <div className="mt-3 flex items-center gap-2 border-y border-border bg-muted/40 px-4 py-2 text-[12px] text-muted-foreground">
          <Check className="h-3.5 w-3.5" style={{ color: "hsl(var(--pos))" }} />
          <span className="flex-1">Já respondida. Envie de novo só se precisar corrigir.</span>
          <button
            type="button"
            onClick={() => setExpandido(false)}
            className="shrink-0 font-medium text-foreground hover:underline"
          >
            Recolher
          </button>
        </div>
      )}

      {/* Ações */}
      <div className="space-y-3 px-4 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleEscolher} disabled={enviando} className="h-8">
            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
            {item.link_comprovante ? "Trocar comprovante" : "Anexar comprovante"}
          </Button>
          {arquivo ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/50 py-1 pl-2 pr-1 text-[12px]">
              <span className="truncate max-w-[160px] font-medium" title={arquivo.name}>{arquivo.name}</span>
              <span className="shrink-0 text-muted-foreground">{kb(arquivo.size)}</span>
              <button
                type="button"
                onClick={() => setArquivo(null)}
                disabled={enviando}
                aria-label="Remover arquivo escolhido"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">PDF, JPG ou PNG · até 10 MB</span>
          )}
        </div>

        <Textarea
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          rows={3}
          placeholder="Se não houver nota, explique aqui o que foi o gasto e por quê."
          className="resize-none text-sm"
          disabled={enviando}
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] leading-tight text-muted-foreground">
            {enviando
              ? "Enviando…"
              : arquivo && justNova ? "Comprovante e justificativa prontos"
              : arquivo ? "Comprovante pronto para envio"
              : justNova ? "Justificativa pronta para envio"
              : "Anexe a nota ou escreva a justificativa"}
          </span>
          <Button size="sm" onClick={handleEnviar} disabled={enviando || !podeEnviar} className="h-8 shrink-0">
            {enviando
              ? (<><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Enviando</>)
              : (<><Send className="mr-1.5 h-3.5 w-3.5" />Enviar pro Hub</>)}
          </Button>
        </div>
      </div>
    </article>
  );
}
