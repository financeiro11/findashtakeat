// Comentários de uma anotação — a via de volta de quem recebeu o link.
//
// Uma peça só para os três lugares onde a conversa aparece: o Workspace no computador,
// a nota em tela cheia no celular e a página pública `/n/<token>`. As duas primeiras
// falam com a tabela (têm sessão); a terceira fala pela RPC do token e por isso passa
// `onEnviar` próprio em vez de usar o `ComentariosDaNota` que busca sozinho.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Link2, Loader2, MessageSquare, Send, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { fmtDataHora } from "@/lib/mobile/formato";
import {
  apagarComentario, comentar, definirResolvido, listarComentarios, type Comentario,
} from "@/lib/notas/compartilhar";

function iniciais(nome: string): string {
  return nome.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/* ------------------------------------------------------------------ *
 *  Uma linha da conversa
 * ------------------------------------------------------------------ */

function Linha({
  c, onResolver, onApagar,
}: {
  c: Comentario;
  onResolver?: (c: Comentario) => void;
  onApagar?: (c: Comentario) => void;
}) {
  return (
    <li
      className={cn(
        "group rounded-lg border border-border bg-card p-3",
        c.resolvido && "border-dashed bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white",
            c.origem === "link" ? "bg-violet-600" : "bg-red-600",
          )}
        >
          {iniciais(c.autor_nome)}
        </span>
        <span className="truncate text-[12.5px] font-medium">{c.autor_nome}</span>
        {c.origem === "link" && (
          // Sem este selo, um comentário de fora se confunde com um do time — e quem lê
          // precisa saber que aquilo veio de alguém sem conta no Hub.
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
            <Link2 className="h-2.5 w-2.5" /> pelo link
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">
          {fmtDataHora(c.criado_em)}
        </span>
      </div>

      <p
        className={cn(
          "mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed",
          c.resolvido && "text-muted-foreground line-through",
        )}
      >
        {c.texto}
      </p>

      {(onResolver || onApagar) && (
        <div className="mt-2 flex items-center gap-1">
          {onResolver && (
            <button
              onClick={() => onResolver(c)}
              className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {c.resolvido
                ? (<><Undo2 className="h-3 w-3" /> Reabrir</>)
                : (<><Check className="h-3 w-3" /> Resolver</>)}
            </button>
          )}
          {onApagar && (
            <button
              onClick={() => onApagar(c)}
              className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="h-3 w-3" /> Excluir
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ *
 *  Lista + campo de escrita (sem saber de onde vêm os dados)
 * ------------------------------------------------------------------ */

export function Conversa({
  comentarios,
  onEnviar,
  onResolver,
  onApagar,
  /** Quando dado, a pessoa digita o próprio nome (é o caso de quem entra pelo link). */
  nomePedido,
  somenteLeitura,
  compacto,
}: {
  comentarios: Comentario[];
  onEnviar?: (texto: string, autor: string) => Promise<boolean>;
  onResolver?: (c: Comentario) => void;
  onApagar?: (c: Comentario) => void;
  nomePedido?: { valor: string; aoMudar: (v: string) => void };
  somenteLeitura?: boolean;
  compacto?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const abertos = comentarios.filter((c) => !c.resolvido).length;

  async function enviar() {
    if (!onEnviar) return;
    const t = texto.trim();
    if (!t) return;
    setEnviando(true);
    const ok = await onEnviar(t, nomePedido?.valor ?? "");
    setEnviando(false);
    if (ok) {
      setTexto("");
      areaRef.current?.blur();
    }
  }

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h3 className={cn("font-semibold tracking-tight", compacto ? "text-[13px]" : "text-[14px]")}>
          Comentários
        </h3>
        <span className="text-[11.5px] text-muted-foreground">
          {comentarios.length === 0
            ? "nenhum ainda"
            : abertos === comentarios.length
              ? `${comentarios.length}`
              : `${comentarios.length} · ${abertos} em aberto`}
        </span>
      </div>

      {comentarios.length > 0 && (
        <ul className="mt-3 space-y-2">
          {comentarios.map((c) => (
            <Linha key={c.id} c={c} onResolver={onResolver} onApagar={onApagar} />
          ))}
        </ul>
      )}

      {somenteLeitura ? (
        <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">
          Quem compartilhou deixou este link só de leitura.
        </p>
      ) : onEnviar ? (
        <div className="mt-3 space-y-2">
          {nomePedido && (
            <Input
              value={nomePedido.valor}
              onChange={(e) => nomePedido.aoMudar(e.target.value)}
              placeholder="Seu nome"
              className="h-10 text-[13px]"
              maxLength={80}
            />
          )}
          <Textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter sozinho quebra linha; o envio é Ctrl/⌘+Enter. Comentário costuma
              // ter mais de uma linha, e mandar pela metade não dá para desfazer.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); enviar(); }
            }}
            rows={compacto ? 3 : 2}
            maxLength={4000}
            placeholder="Escreva um comentário…"
            className="resize-none text-[13px]"
            disabled={enviando}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10.5px] text-muted-foreground">⌘/Ctrl + Enter para enviar</span>
            <Button size="sm" onClick={enviar} disabled={enviando || !texto.trim()} className="h-8">
              {enviando
                ? (<><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Enviando</>)
                : (<><Send className="mr-1.5 h-3.5 w-3.5" /> Comentar</>)}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  A versão de dentro do Hub: busca e grava sozinha
 * ------------------------------------------------------------------ */

export function ComentariosDaNota({
  pageId,
  compacto,
  aoMudarContagem,
}: {
  pageId: string;
  compacto?: boolean;
  /** Avisa a tela de fora quantos ficaram em aberto — é o número do botão. */
  aoMudarContagem?: (abertos: number) => void;
}) {
  const { user, profile } = useAuth();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [carregando, setCarregando] = useState(true);

  const autor = useMemo(
    () => ({ userId: user?.id ?? null, nome: profile?.nome ?? null }),
    [user?.id, profile?.nome],
  );

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    listarComentarios(pageId)
      .then((lista) => { if (vivo) setComentarios(lista); })
      .catch((e) => { if (vivo) toast.error("Erro ao carregar comentários: " + e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [pageId]);

  // Por ref, e não na lista de dependências: `aoMudarContagem` costuma ser uma arrow
  // criada no render de quem monta este componente. Com ela na lista, avisar a contagem
  // faria o pai repintar, recriar a função, disparar o efeito de novo — laço infinito.
  const aviso = useRef(aoMudarContagem);
  aviso.current = aoMudarContagem;
  useEffect(() => {
    aviso.current?.(comentarios.filter((c) => !c.resolvido).length);
  }, [comentarios]);

  async function enviar(texto: string): Promise<boolean> {
    try {
      const novo = await comentar(pageId, autor, texto);
      setComentarios((prev) => [...prev, novo]);
      return true;
    } catch (e: any) {
      toast.error("Não deu para comentar: " + e.message);
      return false;
    }
  }

  async function resolver(c: Comentario) {
    const proximo = !c.resolvido;
    setComentarios((prev) => prev.map((x) => (x.id === c.id ? { ...x, resolvido: proximo } : x)));
    try {
      await definirResolvido(c.id, proximo);
    } catch (e: any) {
      setComentarios((prev) => prev.map((x) => (x.id === c.id ? { ...x, resolvido: !proximo } : x)));
      toast.error(e.message);
    }
  }

  async function apagar(c: Comentario) {
    if (!confirm("Excluir este comentário?")) return;
    const antes = comentarios;
    setComentarios((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await apagarComentario(c.id);
    } catch (e: any) {
      setComentarios(antes);
      toast.error(e.message);
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando comentários…
      </div>
    );
  }

  return (
    <Conversa
      comentarios={comentarios}
      onEnviar={enviar}
      onResolver={resolver}
      onApagar={apagar}
      compacto={compacto}
    />
  );
}

/** Ícone com contagem — usado no cabeçalho da nota para abrir/fechar a conversa. */
export function BotaoComentarios({
  abertos, ativo, onClick, className,
}: {
  abertos: number;
  ativo?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      className={cn("h-7 gap-1 text-[11.5px]", ativo && "bg-accent", className)}
      title="Comentários"
    >
      <MessageSquare className="h-3 w-3" />
      {abertos > 0 && <span className="num text-[11px] font-semibold">{abertos}</span>}
    </Button>
  );
}
