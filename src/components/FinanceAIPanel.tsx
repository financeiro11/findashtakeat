import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type AIResponse = {
  answer: string;
  resumo: string;
  acoes_recomendadas: string[];
  nivel_confianca: string;
};

type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; data?: AIResponse };

const EVT = "finance-ai:open";

export function openFinanceAI(prompt?: string) {
  // Abre o assistente global (AIAssistant) montado no AppLayout
  window.dispatchEvent(new CustomEvent("ai:open", { detail: { prompt } }));
  // Mantém compatibilidade com o painel legado caso esteja montado
  window.dispatchEvent(new CustomEvent(EVT, { detail: { prompt } }));
}

export function FinanceAIPanel({
  paginaAtual = "Dashboard",
  financeContext,
}: {
  paginaAtual?: string;
  financeContext?: Record<string, any>;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as { prompt?: string } | undefined;
      setOpen(true);
      if (detail?.prompt) setInput(detail.prompt);
      setTimeout(() => taRef.current?.focus(), 50);
    };
    window.addEventListener(EVT, onOpen);
    return () => window.removeEventListener(EVT, onOpen);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-finance-ai`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          message: text,
          context: {
            empresa: "Takeat",
            modulo: "Financeiro",
            paginaAtual,
            dados: financeContext ?? null,
          },
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data: AIResponse = await resp.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.answer || "", data }]);
    } catch (e) {
      console.error(e);
      toast({
        title: "Erro",
        description: "Não consegui consultar a IA agora. Tente novamente em alguns segundos.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-takeat-soft text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[13px] font-semibold">Assistente Financeiro Takeat</div>
            <div className="text-[10.5px] text-muted-foreground">Powered by Gemini · {paginaAtual}</div>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3 text-[12.5px]">
            <p className="text-muted-foreground">Pergunte sobre seus números. Exemplos:</p>
            {[
              "Por que a margem caiu em maio?",
              "Quais despesas devo revisar primeiro?",
              "Como organizar esse arquivo para importar no Omie?",
              "Quais lançamentos parecem duplicados?",
            ].map(s => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="block w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-left text-[12px] hover:bg-secondary"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-[12.5px] ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                }`}
              >
                {m.role === "assistant" ? (
                  <>
                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-headings:my-1.5 prose-headings:text-[13px]">
                      <ReactMarkdown>{m.content || "…"}</ReactMarkdown>
                    </div>
                    {m.data && (m.data.acoes_recomendadas?.length || m.data.nivel_confianca) && (
                      <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                        {m.data.acoes_recomendadas?.length > 0 && (
                          <div>
                            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Ações recomendadas
                            </div>
                            <ul className="mt-0.5 list-disc pl-4 text-[12px]">
                              {m.data.acoes_recomendadas.map((a, k) => (
                                <li key={k}>{a}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {m.data.nivel_confianca && (
                          <div className="text-[10.5px] text-muted-foreground">
                            Nível de confiança:{" "}
                            <span className="font-semibold text-foreground">{m.data.nivel_confianca}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando…
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Pergunte algo… (Enter envia, Shift+Enter quebra linha)"
            className="min-h-[44px] resize-none text-[12.5px]"
            rows={2}
          />
          <Button size="sm" onClick={send} disabled={loading || !input.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <div className="mt-1.5 text-[10.5px] text-muted-foreground">Histórico apenas nesta sessão</div>
      </div>
    </div>
  );
}
