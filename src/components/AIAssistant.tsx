import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Loader2, Trash2, Plus, MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import takeatSymbol from "@/assets/takeat-symbol-white.png";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; titulo: string; created_at: string; updated_at: string };

const STORAGE_KEY = "ai_chat_open";

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AIAssistant({ initialPrompt }: { initialPrompt?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onToggle = (e: Event) => {
      const detail = (e as CustomEvent).detail as { prompt?: string } | undefined;
      setOpen(true);
      if (detail?.prompt) setInput(detail.prompt);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("ai:open", onToggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("ai:open", onToggle);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (open) { localStorage.setItem(STORAGE_KEY, "1"); loadConversations(); }
    else localStorage.removeItem(STORAGE_KEY);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function loadConversations() {
    const { data } = await supabase
      .from("ai_conversations" as any)
      .select("id,titulo,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    setConversations((data as any) ?? []);
  }

  async function loadConversation(id: string) {
    setConvId(id);
    setShowHistory(false);
    const { data } = await supabase
      .from("ai_messages" as any)
      .select("role,content,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages(((data as any) ?? []).map((m: any) => ({ role: m.role, content: m.content })));
  }

  function newConversation() {
    setConvId(null);
    setMessages([]);
    setShowHistory(false);
  }

  async function deleteConversation(id: string) {
    await supabase.from("ai_messages" as any).delete().eq("conversation_id", id);
    await supabase.from("ai_conversations" as any).delete().eq("id", id);
    if (id === convId) newConversation();
    loadConversations();
  }

  async function ensureConversation(firstUserText: string): Promise<string | null> {
    if (convId) return convId;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const titulo = firstUserText.slice(0, 60) || "Nova conversa";
    const { data, error } = await supabase
      .from("ai_conversations" as any)
      .insert({ user_id: user.id, titulo })
      .select("id")
      .single();
    if (error || !data) return null;
    setConvId((data as any).id);
    return (data as any).id;
  }

  async function persistMessage(cid: string, role: "user" | "assistant", content: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("ai_messages" as any).insert({
      conversation_id: cid, user_id: user.id, role, content,
    });
    await supabase.from("ai_conversations" as any).update({ updated_at: new Date().toISOString() }).eq("id", cid);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);

    const cid = await ensureConversation(text);
    if (cid) persistMessage(cid, "user", text);

    let assistantSoFar = "";
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next }),
      });
      if (!resp.ok || !resp.body) {
        if (resp.status === 429) toast({ title: "Muitas requisições", description: "Aguarde alguns segundos e tente novamente.", variant: "destructive" });
        else if (resp.status === 402) toast({ title: "Sem créditos de IA", description: "Adicione saldo em Configurações da workspace.", variant: "destructive" });
        else toast({ title: "Erro", description: "Não foi possível obter resposta.", variant: "destructive" });
        setLoading(false);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(json);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) upsert(c);
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
      if (cid && assistantSoFar) {
        await persistMessage(cid, "assistant", assistantSoFar);
        loadConversations();
      }
    } catch (e) {
      console.error(e);
      toast({ title: "Erro", description: "Falha de conexão", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && initialPrompt && messages.length === 0) setInput(initialPrompt);
  }, [open, initialPrompt, messages.length]);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir assistente de IA"
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
        >
          <img src={takeatSymbol} alt="Takeat" className="h-6 w-6 object-contain" />
        </button>
      )}

      {open && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-takeat-soft text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="text-[13px] font-semibold">Assistente Financeiro</div>
                <div className="text-[10.5px] text-muted-foreground">Conectado aos seus dados (DRE, DFC, BP, Cenários)</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowHistory(s => !s)} className={`rounded p-1.5 ${showHistory ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"}`} title="Histórico">
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
              <button onClick={newConversation} className="rounded p-1.5 text-muted-foreground hover:bg-secondary" title="Nova conversa">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setOpen(false)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {showHistory ? (
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Conversas</div>
              {conversations.length === 0 && (
                <div className="text-[12px] text-muted-foreground">Nenhuma conversa ainda.</div>
              )}
              <ul className="space-y-1">
                {conversations.map(c => (
                  <li key={c.id} className="group flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2 py-1.5">
                    <button onClick={() => loadConversation(c.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[12.5px] font-medium text-foreground">{c.titulo}</div>
                      <div className="num text-[10.5px] text-muted-foreground">{fmtDateTime(c.updated_at)}</div>
                    </button>
                    <button onClick={() => deleteConversation(c.id)} className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:bg-secondary" title="Excluir">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-3 text-[12.5px]">
                  <p className="text-muted-foreground">Pergunte sobre seus números. Exemplos:</p>
                  {[
                    "Qual foi a margem EBITDA dos últimos 3 meses?",
                    "Por que o cashburn aumentou no último mês?",
                    "Compare a receita bruta deste ano com o BP.",
                    "Quais despesas mais cresceram?",
                  ].map(s => (
                    <button key={s} onClick={() => setInput(s)} className="block w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-left text-[12px] hover:bg-secondary">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                    <div className={`max-w-[88%] rounded-lg px-3 py-2 text-[12.5px] ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                      {m.role === "assistant"
                        ? <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-headings:my-1.5 prose-headings:text-[13px]"><ReactMarkdown>{m.content || "…"}</ReactMarkdown></div>
                        : <span className="whitespace-pre-wrap">{m.content}</span>}
                    </div>
                  </div>
                ))}
                {loading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando…
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Pergunte algo… (Enter envia, Shift+Enter quebra linha)"
                className="min-h-[44px] resize-none text-[12.5px]"
                rows={2}
              />
              <Button size="sm" onClick={send} disabled={loading || !input.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-1.5 text-[10.5px] text-muted-foreground">⌘/Ctrl + I para abrir/fechar</div>
          </div>
        </div>
      )}
    </>
  );
}

export function openAIAssistant(prompt?: string) {
  window.dispatchEvent(new CustomEvent("ai:open", { detail: { prompt } }));
}
