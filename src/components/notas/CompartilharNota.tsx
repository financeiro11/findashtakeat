// O painel de "Compartilhar" de uma anotação.
//
// Dois endereços, porque são dois destinatários — e a tela diz qual é qual, porque a
// diferença entre eles é quem consegue abrir:
//
//   • Link do time   → /notas/<id>. Pede login. Quem entra pode tudo o que já podia.
//   • Link público   → /n/<token>. Não pede nada. Lê e comenta; não edita.
//
// O link do time é o mesmo endereço no computador e no celular: o App.tsx decide a
// árvore de telas pelo tamanho do aparelho, então não existe "link do celular" e
// "link do PC" para a pessoa escolher errado.

import { useEffect, useState } from "react";
import {
  Check, Copy, ExternalLink, Globe, Loader2, Share2, Shield, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  buscarLink, compartilharNativo, copiar, criarLink, definirComentariosNoLink,
  revogarLink, temCompartilhamentoNativo, urlDaNota, urlPublica, type LinkPublico,
} from "@/lib/notas/compartilhar";

/** Campo de endereço com os botões de copiar e de abrir a folha do sistema. */
function CampoLink({ url, titulo }: { url: string; titulo: string }) {
  const [copiado, setCopiado] = useState(false);

  async function aoCopiar() {
    const ok = await copiar(url);
    if (!ok) { toast.error("Não deu para copiar. Selecione o endereço e copie à mão."); return; }
    setCopiado(true);
    toast.success("Link copiado");
    setTimeout(() => setCopiado(false), 1800);
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="h-8 flex-1 bg-muted/40 px-2 text-[11.5px]"
      />
      <Button size="sm" variant="outline" className="h-8 w-8 shrink-0 p-0" onClick={aoCopiar} title="Copiar">
        {copiado ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      {temCompartilhamentoNativo() && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 shrink-0 p-0"
          onClick={() => compartilharNativo(titulo, url)}
          title="Compartilhar…"
        >
          <Share2 className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button size="sm" variant="outline" className="h-8 w-8 shrink-0 p-0" asChild title="Abrir">
        <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
      </Button>
    </div>
  );
}

export function PainelCompartilhar({
  pageId, titulo, onFechar, onMudou,
}: {
  pageId: string;
  titulo: string;
  onFechar?: () => void;
  /** Criou ou revogou — a tela de fora repinta o selo de "compartilhada" na árvore. */
  onMudou?: () => void;
}) {
  const { user, profile } = useAuth();
  const [link, setLink] = useState<LinkPublico | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [trabalhando, setTrabalhando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    buscarLink(pageId)
      .then((l) => { if (vivo) setLink(l); })
      .catch((e) => { if (vivo) toast.error("Erro ao ler o link: " + e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [pageId]);

  async function criar() {
    setTrabalhando(true);
    try {
      const novo = await criarLink(pageId, { userId: user?.id ?? null, nome: profile?.nome ?? null });
      setLink(novo);
      await copiar(urlPublica(novo.token));
      toast.success("Link público criado e copiado");
      onMudou?.();
    } catch (e: any) {
      toast.error("Não deu para criar o link: " + e.message);
    } finally {
      setTrabalhando(false);
    }
  }

  async function revogar() {
    if (!link) return;
    if (!confirm("Revogar este link? Quem já o tem para de conseguir abrir a nota.")) return;
    setTrabalhando(true);
    try {
      await revogarLink(link.id);
      setLink(null);
      toast.success("Link revogado");
      onMudou?.();
    } catch (e: any) {
      toast.error("Não deu para revogar: " + e.message);
    } finally {
      setTrabalhando(false);
    }
  }

  async function alternarComentarios(permite: boolean) {
    if (!link) return;
    setLink({ ...link, permite_comentario: permite });
    try {
      await definirComentariosNoLink(link.id, permite);
    } catch (e: any) {
      setLink({ ...link, permite_comentario: !permite });
      toast.error(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold tracking-tight">Compartilhar anotação</h4>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{titulo || "Sem título"}</p>
        </div>
        {onFechar && (
          <button onClick={onFechar} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ---- Time ---- */}
      <section>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11.5px] font-semibold">Quem tem login no Hub</span>
        </div>
        <CampoLink url={urlDaNota(pageId)} titulo={titulo} />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          O mesmo endereço nos dois aparelhos: no celular abre no app, no computador abre no
          navegador. Sem sessão, ele pede o login e volta para esta nota.{" "}
          <strong className="font-medium text-foreground">Lê, edita e comenta</strong> — é o
          acesso que a pessoa já tem no Hub.
        </p>
      </section>

      <Separator />

      {/* ---- Fora ---- */}
      <section>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Globe className="h-3 w-3 text-muted-foreground" />
          <span className="text-[11.5px] font-semibold">Quem não tem conta</span>
        </div>

        {carregando ? (
          <div className="flex items-center gap-2 py-2 text-[11.5px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Verificando…
          </div>
        ) : link ? (
          <>
            <CampoLink url={urlPublica(link.token)} titulo={titulo} />

            <label className="mt-2.5 flex items-center gap-2">
              <Switch
                checked={link.permite_comentario}
                onCheckedChange={alternarComentarios}
                disabled={trabalhando}
              />
              <span className="text-[11.5px]">Pode comentar</span>
              <span className="ml-auto text-[10.5px] text-muted-foreground">
                {link.acessos === 0 ? "nunca aberto" : `${link.acessos} abertura${link.acessos === 1 ? "" : "s"}`}
              </span>
            </label>

            <Button
              size="sm"
              variant="ghost"
              onClick={revogar}
              disabled={trabalhando}
              className="mt-1.5 h-7 w-full justify-start px-1.5 text-[11.5px] text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {trabalhando ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Shield className="mr-1.5 h-3 w-3" />}
              Revogar este link
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={criar}
              disabled={trabalhando}
              className="h-8 w-full gap-1.5 text-[11.5px]"
            >
              {trabalhando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
              Criar link público
            </Button>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Um endereço que abre sem senha, em qualquer navegador.
            </p>
          </>
        )}

        <p
          className={cn(
            "mt-2 rounded-md border border-dashed p-2 text-[10.5px] leading-relaxed text-muted-foreground",
            link ? "border-amber-300/60 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20" : "border-border",
          )}
        >
          Qualquer pessoa com o endereço lê <strong className="font-medium text-foreground">esta
          nota</strong> — subpáginas não vão junto — e comenta, se você deixar.{" "}
          <strong className="font-medium text-foreground">Não edita o conteúdo</strong> e não vê o
          resto do Workspace. Para fechar a porta depois, é o botão de revogar.
        </p>
      </section>
    </div>
  );
}

/** O botão "Compartilhar" com o painel dentro de um popover — o formato do computador. */
export function BotaoCompartilhar({
  pageId, titulo, className, rotulo, onMudou,
}: {
  pageId: string;
  titulo: string;
  className?: string;
  rotulo?: string;
  onMudou?: () => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className={cn("h-7 gap-1 text-[11.5px]", className)}>
          <Share2 className="h-3 w-3" />
          {rotulo ?? "Compartilhar"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-4">
        {/* `key` no id: trocar de nota com o painel aberto tem de rebuscar o link, senão
            mostra o endereço da nota anterior — e alguém manda o link errado. */}
        <PainelCompartilhar
          key={pageId}
          pageId={pageId}
          titulo={titulo}
          onFechar={() => setAberto(false)}
          onMudou={onMudou}
        />
      </PopoverContent>
    </Popover>
  );
}
