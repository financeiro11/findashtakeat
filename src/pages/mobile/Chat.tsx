// Aba Chat — o Assistente do Hub em formato de conversa nativa.
//
// Mesmas Edge Functions do painel do desktop (`assistente-responder` → `ai-chat`) e o
// mesmo selo de procedência: a tela SEMPRE diz se os números foram conferidos no banco ou
// se a resposta é raciocínio sem garantia. Perder esse selo no celular seria pior do que
// no desktop — é daqui que sai o print mandado no WhatsApp.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Send, Loader2, Plus, MessageSquare, Trash2, ShieldCheck, AlertTriangle,
  Database, RotateCcw, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { fmtDataHora } from "@/lib/mobile/formato";
import { marcarFalha, tirarPerguntaFalha } from "@/lib/mobile/chat";
import {
  ErroAssistente, TIMEOUT_MS, criarConversa, gravarMensagem, perguntarConferido, streamAiChat,
  type MsgAssistente, type NumeroConferido,
} from "@/lib/assistente";

type Conversa = { id: string; titulo: string; updated_at: string };
type Msg = MsgAssistente & { numeros?: NumeroConferido[]; avisos?: string[] };

/**
 * A aba é uma rota: sair para Tarefas e voltar DESMONTA a tela e zera o estado. Sem isto a
 * conversa em andamento some ao conferir um número em outra aba — o comportamento que
 * nenhum app de mensagem tem. Guarda só o id; o texto é relido de `ai_messages`.
 */
const CHAVE_CONVERSA = "hub:chat:conversa";

const SUGESTOES = [
  "O que eu preciso saber hoje?",
  "Qual foi o caixa no mês passado?",
  "Quais tarefas estão atrasadas e de quem?",
];

export default function MobileChat() {
  const [mensagens, setMensagens] = useState<Msg[]>([]);
  const [entrada, setEntrada] = useState("");
  const [pensando, setPensando] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  /** Última pergunta que falhou — o botão "Tentar novamente" a reenvia sem redigitar. */
  const [falhou, setFalhou] = useState<{ texto: string; motivo: string } | null>(null);

  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const mensagensRef = useRef<Msg[]>([]);
  useEffect(() => { mensagensRef.current = mensagens; }, [mensagens]);
  useEffect(() => { fim.current?.scrollIntoView({ behavior: "smooth" }); }, [mensagens, pensando]);

  async function carregarConversas() {
    const { data } = await supabase
      .from("ai_conversations" as any)
      .select("id,titulo,updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    setConversas(((data as any) ?? []) as Conversa[]);
  }

  useEffect(() => {
    carregarConversas();
    const guardada = sessionStorage.getItem(CHAVE_CONVERSA);
    if (guardada) abrirConversa(guardada);
  }, []);

  function lembrarConversa(id: string | null) {
    setConversaId(id);
    try {
      if (id) sessionStorage.setItem(CHAVE_CONVERSA, id);
      else sessionStorage.removeItem(CHAVE_CONVERSA);
    } catch { /* modo privado do Safari */ }
  }

  async function abrirConversa(id: string) {
    lembrarConversa(id);
    setHistoricoAberto(false);
    setFalhou(null);
    const { data, error } = await supabase
      .from("ai_messages" as any)
      .select("role,content,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    // Conversa apagada em outro aparelho: o id guardado não vale mais.
    if (error || !data) { lembrarConversa(null); setMensagens([]); return; }
    // Conversa recarregada não traz a tabela de números: `ai_messages` guarda só o texto.
    setMensagens((data as any[]).map((m: any) => ({ role: m.role, content: m.content })));
  }

  function novaConversa() {
    lembrarConversa(null);
    setMensagens([]);
    setFalhou(null);
    setHistoricoAberto(false);
  }

  async function apagarConversa(id: string) {
    await supabase.from("ai_messages" as any).delete().eq("conversation_id", id);
    await supabase.from("ai_conversations" as any).delete().eq("id", id);
    if (id === conversaId) novaConversa();
    carregarConversas();
  }

  async function enviar(texto: string) {
    const pergunta = texto.trim();
    if (!pergunta || pensando) return;

    setFalhou(null);
    setEntrada("");
    // O textarea cresce por `style.height` no onInput; limpar o valor não desfaz isso, e o
    // campo ficava alto e vazio depois de mandar uma pergunta longa.
    if (campo.current) campo.current.style.height = "auto";
    setPensando(true);
    const comPergunta: Msg[] = [...mensagensRef.current, { role: "user", content: pergunta }];
    setMensagens(comPergunta);

    let cid = conversaId;
    if (!cid) {
      cid = await criarConversa(pergunta);
      if (cid) lembrarConversa(cid);
    }
    if (cid) gravarMensagem(cid, "user", pergunta);

    // Só pares do caminho CONFERIDO viram contexto: resposta sem procedência não pode
    // influenciar a interpretação de uma pergunta sobre números.
    const anteriores = mensagensRef.current;
    const contexto: { pergunta: string; resposta: string }[] = [];
    for (let i = 1; i < anteriores.length; i++) {
      if (anteriores[i].role === "assistant" && anteriores[i].verificado && anteriores[i - 1].role === "user") {
        contexto.push({ pergunta: anteriores[i - 1].content, resposta: anteriores[i].content });
      }
    }

    const controle = new AbortController();
    // O relógio começa só quando o streaming começa. Ligado antes, um caminho conferido
    // lento comia o tempo do outro e o stream nascia com poucos segundos de vida.
    let relogio: ReturnType<typeof setTimeout> | undefined;

    try {
      const conferida = await perguntarConferido(pergunta, contexto, cid).catch(() => null);

      if (conferida) {
        const msg: Msg = {
          role: "assistant",
          content: conferida.resposta ?? "",
          numeros: conferida.numeros ?? [],
          avisos: conferida.avisos ?? [],
          verificado: !!conferida.ok,
          nivel: conferida.nivel,
          provedor: conferida.provedor,
        };
        setMensagens((prev) => [...prev, msg]);
        if (cid && msg.content) { await gravarMensagem(cid, "assistant", msg.content); carregarConversas(); }
        return;
      }

      // Caminho geral: a bolha do assistente nasce vazia e cresce com o streaming.
      let acumulado = "";
      relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
      setMensagens((prev) => [...prev, { role: "assistant", content: "", verificado: false, provedor: "gemini" }]);
      acumulado = await streamAiChat(comPergunta, (pedaco) => {
        setMensagens((prev) =>
          prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: m.content + pedaco } : m)),
        );
      }, controle.signal);

      if (!acumulado) throw new ErroAssistente("O assistente não respondeu nada.", "servidor");
      if (cid) { await gravarMensagem(cid, "assistant", acumulado); carregarConversas(); }
    } catch (e) {
      const motivo = e instanceof ErroAssistente
        ? e.message
        : "Falha de conexão. Verifique a internet e tente de novo.";
      // Tira a bolha vazia do assistente e marca a pergunta, que fica na tela para o botão
      // reenviar — nada digitado se perde. Regra e testes em lib/mobile/chat.ts.
      setMensagens(marcarFalha);
      setFalhou({ texto: pergunta, motivo });
    } finally {
      if (relogio) clearTimeout(relogio);
      setPensando(false);
    }
  }

  async function tentarNovamente() {
    if (!falhou) return;
    const texto = falhou.texto;
    // Tira a pergunta que falhou antes de reenviar, para não duplicar a bolha.
    setMensagens(tirarPerguntaFalha);
    setFalhou(null);
    setTimeout(() => enviar(texto), 0);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <span className="truncate pl-2 text-[12px] text-muted-foreground">
          {conversaId ? conversas.find((c) => c.id === conversaId)?.titulo ?? "Conversa" : "Nova conversa"}
        </span>
        <div className="flex items-center">
          <button
            onClick={() => setHistoricoAberto(true)}
            aria-label="Histórico de conversas"
            className="flex h-11 w-11 items-center justify-center text-muted-foreground"
          >
            <MessageSquare className="h-5 w-5" />
          </button>
          <button
            onClick={novaConversa}
            aria-label="Nova conversa"
            className="flex h-11 w-11 items-center justify-center text-muted-foreground"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {mensagens.length === 0 && (
          <div className="space-y-2.5">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Pergunte sobre os números. Quando a resposta vier da base, você vê cada valor
              com a fonte e a competência.
            </p>
            {SUGESTOES.map((s) => (
              <button
                key={s}
                onClick={() => enviar(s)}
                className="block w-full rounded-xl border border-border bg-card px-3.5 py-3 text-left text-[13.5px] active:bg-secondary"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {mensagens.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              {m.role === "user" ? (
                <div className={cn(
                  "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-[14px] leading-snug text-primary-foreground",
                  m.erro && "opacity-60",
                )}>
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                </div>
              ) : (
                <div className="max-w-[92%] space-y-2">
                  <div className="rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-2.5 text-[14px] text-foreground">
                    {/* break-words: resposta com link longo não pode empurrar a tela. */}
                    <div className="prose prose-sm max-w-none break-words text-[14px] prose-p:my-1.5 prose-ul:my-1.5 prose-headings:my-2 prose-headings:text-[15px] dark:prose-invert">
                      <ReactMarkdown
                        components={{
                          a: (props) => <a {...props} target="_blank" rel="noreferrer" className="text-primary" />,
                          table: (props) => <div className="overflow-x-auto"><table {...props} /></div>,
                        }}
                      >
                        {m.content || "…"}
                      </ReactMarkdown>
                    </div>
                    <Selo verificado={m.verificado} nivel={m.nivel} provedor={m.provedor} />
                  </div>
                  <BlocoNumeros numeros={m.numeros} avisos={m.avisos} />
                </div>
              )}
            </div>
          ))}

          {pensando && mensagens[mensagens.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando os dados…
            </div>
          )}

          {falhou && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
              <div className="flex items-start gap-2 text-[12.5px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{falhou.motivo}</span>
              </div>
              <button
                onClick={tentarNovamente}
                className="mt-2.5 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg bg-destructive text-[13px] font-semibold text-destructive-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
              </button>
            </div>
          )}
        </div>
        <div ref={fim} />
      </div>

      <div className="shrink-0 border-t border-border bg-card px-3 py-2.5">
        <form
          onSubmit={(e) => { e.preventDefault(); enviar(entrada); }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={campo}
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            rows={1}
            placeholder="Pergunte algo…"
            // 16px: abaixo disso o Safari dá zoom ao focar e a tela sai do lugar.
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-input bg-background px-3.5 py-2.5 text-base leading-snug outline-none focus:border-primary"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(128, el.scrollHeight)}px`;
            }}
          />
          <button
            type="submit"
            disabled={pensando || !entrada.trim()}
            aria-label="Enviar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
          >
            {pensando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </form>
      </div>

      <Drawer open={historicoAberto} onOpenChange={setHistoricoAberto}>
        <DrawerContent className="max-h-[80dvh]">
          <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-[16px]">Conversas</DrawerTitle>
              <button onClick={() => setHistoricoAberto(false)} aria-label="Fechar" className="flex h-11 w-11 items-center justify-center text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            {conversas.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">Nenhuma conversa ainda.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {conversas.map((c) => (
                  <li key={c.id} className="flex items-center gap-1 rounded-xl border border-border bg-card">
                    <button onClick={() => abrirConversa(c.id)} className="min-w-0 flex-1 px-3.5 py-3 text-left">
                      <div className="truncate text-[13.5px] font-medium">{c.titulo}</div>
                      <div className="num mt-0.5 text-[11px] text-muted-foreground">{fmtDataHora(c.updated_at)}</div>
                    </button>
                    <button
                      onClick={() => apagarConversa(c.id)}
                      aria-label={`Excluir ${c.titulo}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/** Espelha o selo do painel do desktop: conferido / consultado / sem verificação. */
function Selo({ verificado, nivel, provedor }: { verificado?: boolean; nivel?: "conferido" | "consultado"; provedor?: string }) {
  if (verificado === undefined) return null; // conversa recarregada do histórico
  const modelo = provedor === "openai" ? "GPT" : provedor === "gemini" ? "Gemini" : null;

  return (
    <span className="mt-1.5 inline-flex flex-wrap items-center gap-1 text-[10.5px]">
      {!verificado ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <AlertTriangle className="h-3 w-3" /> sem números verificados
        </span>
      ) : nivel === "consultado" ? (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <Database className="h-3 w-3" /> consultado · sem conferência de soma
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="h-3 w-3" /> números conferidos agora
        </span>
      )}
      {modelo && <span className="text-muted-foreground">· {modelo}</span>}
    </span>
  );
}

function BlocoNumeros({ numeros, avisos }: { numeros?: NumeroConferido[]; avisos?: string[] }) {
  const temNumeros = (numeros?.length ?? 0) > 0;
  const temAvisos = (avisos?.length ?? 0) > 0;
  if (!temNumeros && !temAvisos) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      {temNumeros && (
        <>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Números usados</div>
          <div className="space-y-1.5">
            {numeros!.map((n, i) => (
              <div key={i} className="border-b border-border/60 pb-1.5 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-muted-foreground">{n.rotulo}</span>
                  <span className="num shrink-0 text-[12px] font-semibold">{n.formatado}</span>
                </div>
                <div className="text-[10px] text-muted-foreground/80">{n.fonte} · {n.competencia}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {temAvisos && (
        <div className={temNumeros ? "mt-2 space-y-1.5" : "space-y-1.5"}>
          {avisos!.map((a, i) => (
            <div key={i} className="flex items-start gap-1.5 rounded bg-muted/60 p-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="text-[10.5px] text-muted-foreground">{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
