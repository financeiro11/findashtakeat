// A bolinha da IA — o Assistente do Hub, presente em todas as páginas.
//
// Dois caminhos de resposta, e a tela SEMPRE diz qual foi usado:
//
//   1. CONFERIDO (`assistente-responder`): a pergunta caiu numa consulta nomeada. Os
//      números vieram do Supabase naquela requisição, passaram por conferência de soma,
//      e aparecem numa tabela com fonte e competência embaixo da resposta. É o caminho
//      que pode ir para diretoria ou investidor.
//
//   2. GERAL (`ai-chat`): a pergunta está fora das consultas nomeadas. A resposta vem em
//      streaming do modelo com contexto amplo — útil para raciocinar, mas SEM garantia
//      de origem dos números. A mensagem é marcada como "sem números verificados".
//
// Por que manter os dois: o caminho conferido cobre caixa, EBITDA, panorama, rubrica e
// lançamentos. Trocar o chat inteiro por ele deixaria o time sem resposta para tudo que
// não é essas cinco coisas, o que seria uma regressão. Conforme mais consultas nomeadas
// forem escritas, o caminho geral vai sendo usado cada vez menos.
//
// IMAGEM anexada vai SEMPRE pelo caminho geral, sem passar pelo roteador: as consultas
// nomeadas leem o banco, e nenhuma delas lê figura. A resposta é marcada como lida da
// imagem — um valor que a IA enxergou num print não tem a mesma procedência de um que
// veio do Omie, e a tela não pode deixar os dois parecerem a mesma coisa.

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Sparkles, X, Send, Loader2, Trash2, Plus, MessageSquare, Mic, Square,
  Volume2, VolumeX, ShieldCheck, AlertTriangle, Brain, Database, ImagePlus, Eye,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import takeatSymbol from "@/assets/takeat-symbol-white.png";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { falar, pararFala, suportaVoz } from "@/lib/voz";
import { useMicrofone } from "@/hooks/useMicrofone";
import {
  abrirImagens, anexarImagens, comImagensLegiveis, guardarImagens, paraRequisicao,
  prepararImagens, triarArquivos, type ImagemAnexada, type ImagemMsg,
} from "@/lib/assistente-imagens";
import { contextoDaPagina } from "@/lib/contexto-pagina";
import { urlDaFuncao } from "@/lib/urlFuncao";

type Numero = {
  rotulo: string;
  valor: number;
  formatado: string;
  fonte: string;
  competencia: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  /** Presentes só no caminho conferido. */
  numeros?: Numero[];
  avisos?: string[];
  /** true = veio de uma consulta ao banco nesta requisição; false = caminho geral. */
  verificado?: boolean;
  /** "conferido" (soma validada) ou "consultado" (leitura do banco, sem validação). */
  nivel?: "conferido" | "consultado";
  /** Qual modelo respondeu — "openai" ou "gemini". */
  provedor?: string;
  /** Imagens da pergunta (role user) ou o que a resposta leu (role assistant). */
  imagens?: ImagemMsg[];
  /** Resposta escrita olhando para uma imagem: número lido não é número conferido. */
  leuImagem?: boolean;
};

type Conv = { id: string; titulo: string; created_at: string; updated_at: string };

const STORAGE_KEY = "ai_chat_open";

// Saudação ao entrar no Hub.
//
// DESLIGADA POR PADRÃO, e por decisão de produto: ligar voz automática para todo o time
// sem que ninguém tenha pedido é o tipo de coisa que faz as pessoas desativarem o
// assistente inteiro no segundo dia. Quem quiser, liga no interruptor do painel.
//
// UMA VEZ POR DIA, não por navegação: o Hub é uma SPA, mas recarregar a página ou voltar
// depois do almoço não é "entrar de novo". Ser cumprimentado cinco vezes por dia cansa
// mais rápido que qualquer utilidade que a saudação tenha.
const SAUDACAO_ATIVA = "assistente:saudacao";
const SAUDACAO_DIA = "assistente:saudacao:dia";

const PERGUNTA_SAUDACAO =
  "Me dê o resumo do dia: meus compromissos de hoje e o que eu preciso saber dos números.";

function hojeISO(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); // AAAA-MM-DD
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const SUGESTOES = [
  "O que eu preciso saber?",
  "Por que o EBITDA caiu?",
  "Qual foi o caixa no mês passado?",
  "Quais tarefas estão atrasadas e de quem?",
  "Quanto gastamos no cartão por estabelecimento?",
];

export function AIAssistant({ initialPrompt }: { initialPrompt?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [vozLigada, setVozLigada] = useState(false);
  const [saudacaoAtiva, setSaudacaoAtiva] = useState(
    () => localStorage.getItem(SAUDACAO_ATIVA) === "1",
  );
  const [saudacao, setSaudacao] = useState<string | null>(null);
  const [anexos, setAnexos] = useState<ImagemAnexada[]>([]);
  const [preparando, setPreparando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  /** Imagem aberta em tamanho grande — print de DRE em miniatura não se lê. */
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seletorRef = useRef<HTMLInputElement>(null);

  // De onde a pergunta está sendo feita. Vai junto em todas as chamadas: quem pergunta
  // "por que subiu?" olhando a fatura do cartão não está perguntando do EBITDA.
  const { pathname } = useLocation();

  // `messages` congelaria no callback do microfone; a ref garante o estado atual.
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Mesma armadilha com os anexos: o microfone chama `enviar` sem argumentos.
  const anexosRef = useRef<ImagemAnexada[]>([]);
  useEffect(() => { anexosRef.current = anexos; }, [anexos]);

  const enviarRef = useRef<(t: string) => void>(() => {});
  const mic = useMicrofone((texto) => enviarRef.current(texto));

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
      pararFala();
    };
  }, []);

  useEffect(() => {
    if (open) { localStorage.setItem(STORAGE_KEY, "1"); loadConversations(); }
    else { localStorage.removeItem(STORAGE_KEY); pararFala(); }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, mic.parcial]);

  useEffect(() => {
    if (mic.erro) toast({ title: "Microfone", description: mic.erro, variant: "destructive" });
  }, [mic.erro]);

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
      .select("role,content,imagens,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    // Conversa recarregada não traz a tabela de números: `ai_messages` guarda só o texto.
    // O log completo, com os valores e as fontes, fica em `assistente_execucao`.
    const linhas = ((data as any[]) ?? []);
    // As imagens voltam: o bucket é privado, então cada caminho vira uma URL assinada.
    const caminhos = linhas.flatMap((m) => (Array.isArray(m.imagens) ? m.imagens : []));
    const abertas = await abrirImagens(caminhos).catch(() => new Map<string, ImagemMsg>());
    setMessages(linhas.map((m) => ({
      role: m.role,
      content: m.content,
      imagens: (Array.isArray(m.imagens) ? m.imagens : [])
        .map((p: string) => abertas.get(p))
        .filter(Boolean) as ImagemMsg[],
    })));
  }

  function newConversation() {
    setConvId(null);
    setMessages([]);
    setAnexos([]);
    setShowHistory(false);
    pararFala();
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

  /** Devolve o id da linha gravada — é por ele que a imagem alcança a mensagem depois. */
  async function persistMessage(
    cid: string, role: "user" | "assistant", content: string,
  ): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("ai_messages" as any)
      .insert({ conversation_id: cid, user_id: user.id, role, content })
      .select("id")
      .single();
    await supabase.from("ai_conversations" as any).update({ updated_at: new Date().toISOString() }).eq("id", cid);
    return (data as any)?.id ?? null;
  }

  /* ---- Anexar imagem -------------------------------------------------------------
   * Três formas de trazer a imagem, porque são três hábitos diferentes e todos existem
   * aqui: colar o print recém-tirado (Ctrl+V), arrastar o arquivo para dentro do painel,
   * ou escolher pelo botão. */
  async function anexarArquivos(arquivos: File[]) {
    if (arquivos.length === 0) return;
    const { aceitas, recusadas } = triarArquivos(arquivos, anexosRef.current.length);
    if (recusadas.length) {
      toast({ title: "Imagem não anexada", description: recusadas.join(" "), variant: "destructive" });
    }
    if (aceitas.length === 0) return;

    setPreparando(true);
    try {
      const { prontas, erros } = await prepararImagens(aceitas);
      if (erros.length) {
        toast({ title: "Imagem não anexada", description: erros.join(" "), variant: "destructive" });
      }
      if (prontas.length) setAnexos(prev => [...prev, ...prontas]);
    } finally {
      setPreparando(false);
    }
  }

  const removerAnexo = (id: string) => setAnexos(prev => prev.filter(a => a.id !== id));

  /**
   * Caminho geral (streaming). Roda quando a pergunta não caiu numa consulta nomeada —
   * ou quando há imagem, que nenhuma consulta nomeada sabe ler.
   * Retorna o texto acumulado para persistência.
   */
  async function responderGeral(historico: Msg[], leuImagem = false): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    const url = urlDaFuncao("ai-chat");
    // Só as imagens mais recentes seguem, e as reabertas do histórico voltam a ter bytes:
    // sem isso, "e o total dessa nota?" chegaria a um modelo que não está vendo a nota.
    const legivel = await comImagensLegiveis(historico);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        messages: legivel.map(m => ({
          role: m.role, content: m.content, imagens: paraRequisicao(m.imagens),
        })),
        pagina: contextoDaPagina(pathname),
      }),
    });

    if (!resp.ok || !resp.body) {
      if (resp.status === 429) toast({ title: "Muitas requisições", description: "Aguarde alguns segundos e tente novamente.", variant: "destructive" });
      else if (resp.status === 402) toast({ title: "Sem créditos de IA", description: "Adicione saldo em Configurações da workspace.", variant: "destructive" });
      // O status na frase: sem ele, um 401 de endereço errado passa por "a IA engasgou".
      else toast({ title: "Erro", description: `Não foi possível obter resposta (erro ${resp.status}).`, variant: "destructive" });
      return "";
    }

    let acumulado = "";
    const upsert = (chunk: string) => {
      acumulado += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: acumulado } : m);
        }
        // O caminho geral é o `ai-chat`, que roda no Gemini (compartilhado com o Radar
        // de Editais). Marcar explicitamente evita que a ausência do rótulo seja lida
        // como "não sei qual modelo respondeu".
        return [...prev, { role: "assistant", content: acumulado, verificado: false, provedor: "gemini", leuImagem }];
      });
    };

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
    return acumulado;
  }

  async function enviar(texto: string, imagens: ImagemAnexada[] = anexosRef.current) {
    const text = texto.trim();
    // Imagem sozinha é pergunta válida ("o que é isso?" está implícito no print).
    if ((!text && imagens.length === 0) || loading) return;

    const daPergunta: ImagemMsg[] = imagens.map(i => ({ url: i.previa, base64: i.base64, mime: i.mime }));
    const next: Msg[] = [...messagesRef.current, { role: "user", content: text, imagens: daPergunta }];
    setMessages(next);
    setInput("");
    setAnexos([]);
    setLoading(true);
    pararFala();

    const cid = await ensureConversation(text || "Imagem");
    // A gravação da imagem no bucket é efeito colateral: se falhar, a conversa continua
    // (a imagem só não volta ao reabrir) e a pergunta segue para a IA do mesmo jeito.
    if (cid) {
      const gravada = persistMessage(cid, "user", text);
      if (imagens.length > 0) {
        Promise.all([gravada, guardarImagens(imagens).catch(() => [] as string[])])
          .then(([id, paths]) => id && anexarImagens(id, paths))
          .catch(() => {});
      }
    }

    try {
      // Com imagem, o roteador nem é consultado: nenhuma consulta nomeada lê figura, e
      // chamá-lo só somaria segundos antes de cair no caminho geral do mesmo jeito.
      if (imagens.length > 0) {
        const acumulado = await responderGeral(next, true);
        if (cid && acumulado) { await persistMessage(cid, "assistant", acumulado); loadConversations(); }
        if (vozLigada && acumulado) falar(acumulado);
        return;
      }

      // Contexto para o roteador entender "e no mês anterior?". Só pares (pergunta,
      // resposta) do caminho CONFERIDO: resposta do caminho geral não tem procedência e
      // não deve influenciar a interpretação de uma pergunta sobre números.
      const msgs = messagesRef.current;
      const historico: { pergunta: string; resposta: string }[] = [];
      for (let i = 1; i < msgs.length; i++) {
        if (msgs[i].role === "assistant" && msgs[i].verificado && msgs[i - 1].role === "user") {
          historico.push({ pergunta: msgs[i - 1].content, resposta: msgs[i].content });
        }
      }

      const { data, error } = await supabase.functions.invoke("assistente-responder", {
        body: {
          pergunta: text,
          historico: historico.slice(-4),
          conversa_id: cid,
          pagina: contextoDaPagina(pathname),
        },
      });

      const resp = data as {
        ok?: boolean; consulta?: string; resposta?: string; numeros?: Numero[];
        avisos?: string[]; provedor?: string; nivel?: "conferido" | "consultado";
      } | null;

      // Fora das consultas nomeadas (ou função indisponível) → caminho geral.
      if (error || !resp || resp.consulta === "nenhuma") {
        const acumulado = await responderGeral(next);
        if (cid && acumulado) { await persistMessage(cid, "assistant", acumulado); loadConversations(); }
        if (vozLigada && acumulado) falar(acumulado);
        return;
      }

      const msg: Msg = {
        role: "assistant",
        content: resp.resposta ?? "",
        numeros: resp.numeros ?? [],
        avisos: resp.avisos ?? [],
        verificado: !!resp.ok,
        nivel: resp.nivel,
        provedor: resp.provedor,
      };
      setMessages(prev => [...prev, msg]);
      if (cid && msg.content) { await persistMessage(cid, "assistant", msg.content); loadConversations(); }
      if (vozLigada && msg.content) falar(msg.content);
    } catch (e) {
      console.error(e);
      toast({ title: "Erro", description: "Falha de conexão", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  enviarRef.current = enviar;

  const alternarVoz = () => {
    if (vozLigada) { pararFala(); setVozLigada(false); return; }
    if (!suportaVoz()) {
      toast({ title: "Voz indisponível", description: "Este navegador não tem síntese de voz.", variant: "destructive" });
      return;
    }
    setVozLigada(true);
  };

  useEffect(() => {
    if (open && initialPrompt && messages.length === 0) setInput(initialPrompt);
  }, [open, initialPrompt, messages.length]);

  /* ----- Saudação ao entrar -------------------------------------------------------
   * Roda uma vez por dia, fora do caminho de qualquer coisa: falha em silêncio e nunca
   * abre o painel sozinho. O resultado aparece num balão ao lado da bolinha, que a
   * pessoa fecha — interromper quem acabou de entrar com um painel de tela cheia seria
   * o oposto de útil. */
  useEffect(() => {
    if (!saudacaoAtiva) return;
    if (localStorage.getItem(SAUDACAO_DIA) === hojeISO()) return;

    let cancelado = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("assistente-responder", {
          body: { pergunta: PERGUNTA_SAUDACAO },
        });
        if (error || cancelado) return;

        const texto = String((data as { resposta?: string })?.resposta ?? "").trim();
        if (!texto) return;

        localStorage.setItem(SAUDACAO_DIA, hojeISO());
        setSaudacao(texto);
        // Se o navegador bloquear o áudio (sem gesto do usuário nesta aba), o texto
        // continua no balão com o botão de ouvir. A voz é sempre o extra.
        falar(texto);
      } catch { /* saudação é cortesia; nunca atrapalha o uso do Hub */ }
    })();

    return () => { cancelado = true; };
  }, [saudacaoAtiva]);

  const ouvindo = mic.estado === "ouvindo";

  return (
    <>
      {!open && saudacao && (
        <div className="fixed bottom-20 right-5 z-40 max-w-sm rounded-lg border border-border bg-card p-3.5 shadow-xl">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Seu dia
            </span>
            <button
              onClick={() => { pararFala(); setSaudacao(null); }}
              className="-mt-1 rounded p-1 text-muted-foreground hover:bg-secondary"
              aria-label="Fechar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed">{saudacao}</p>
          <div className="mt-2.5 flex items-center gap-2">
            {suportaVoz() && (
              <button
                onClick={() => falar(saudacao)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Volume2 className="h-3 w-3" /> Ouvir
              </button>
            )}
            <button
              onClick={() => { setSaudacao(null); setOpen(true); }}
              className="text-[11px] text-primary hover:underline"
            >
              Abrir conversa
            </button>
          </div>
        </div>
      )}

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
        <div
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-card shadow-2xl"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={(e) => {
            // Sair para um filho dispara dragleave no pai; sem esta guarda a moldura pisca.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setArrastando(false);
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setArrastando(false);
            anexarArquivos(Array.from(e.dataTransfer.files));
          }}
        >
          {arrastando && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/85 text-[13px] font-medium text-primary">
              Solte a imagem para anexar
            </div>
          )}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-takeat-soft text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="text-[13px] font-semibold">Assistente</div>
                <div className="text-[10.5px] text-muted-foreground">
                  Números conferidos na hora · com fonte e competência
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={alternarVoz}
                className={`rounded p-1.5 ${vozLigada ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"}`}
                title={vozLigada ? "Desligar leitura em voz alta" : "Ler respostas em voz alta"}
              >
                {vozLigada ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>
              <Link to="/assistente/memoria" className="rounded p-1.5 text-muted-foreground hover:bg-secondary" title="O que eu lembro de você">
                <Brain className="h-3.5 w-3.5" />
              </Link>
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
                  <p className="text-muted-foreground">
                    Pergunte sobre os números. Quando a resposta vier da base, você vê a
                    tabela com cada valor, sua fonte e a competência. Pode colar, arrastar
                    ou anexar uma imagem — print, nota, extrato — e perguntar sobre ela.
                  </p>
                  {SUGESTOES.map(s => (
                    <button key={s} onClick={() => enviar(s)} className="block w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-left text-[12px] hover:bg-secondary">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                    {m.role === "user" ? (
                      <div className="max-w-[88%] space-y-1.5">
                        {(m.imagens?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {m.imagens!.map((img, j) => (
                              <button
                                key={j}
                                onClick={() => setAmpliada(img.url)}
                                title="Ver em tamanho grande"
                                className="overflow-hidden rounded-lg border border-border"
                              >
                                <img src={img.url} alt="" className="h-24 w-24 object-cover" />
                              </button>
                            ))}
                          </div>
                        )}
                        {m.content && (
                          <div className="rounded-lg bg-primary px-3 py-2 text-[12.5px] text-primary-foreground">
                            <span className="whitespace-pre-wrap">{m.content}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="max-w-[92%] space-y-2">
                        <div className="rounded-lg bg-secondary px-3 py-2 text-[12.5px] text-foreground">
                          <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-headings:my-1.5 prose-headings:text-[13px]">
                            <ReactMarkdown>{m.content || "…"}</ReactMarkdown>
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <Selo verificado={m.verificado} nivel={m.nivel} provedor={m.provedor} leuImagem={m.leuImagem} />
                            {suportaVoz() && m.content && (
                              <button
                                onClick={() => falar(m.content)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Ouvir"
                              >
                                <Volume2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        <BlocoNumeros numeros={m.numeros} avisos={m.avisos} />
                      </div>
                    )}
                  </div>
                ))}

                {ouvindo && (
                  <div className="flex justify-end">
                    <div className="max-w-[88%] rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px] text-muted-foreground">
                      {mic.texto || mic.parcial ? `${mic.texto} ${mic.parcial}`.trim() : "Ouvindo… pode falar."}
                    </div>
                  </div>
                )}

                {loading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando os dados…
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="border-t border-border p-3">
            {(anexos.length > 0 || preparando) && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {anexos.map(a => (
                  <div key={a.id} className="group relative">
                    <img
                      src={a.previa}
                      alt={a.nome}
                      title={a.nome}
                      className="h-14 w-14 rounded-md border border-border object-cover"
                    />
                    <button
                      onClick={() => removerAnexo(a.id)}
                      aria-label={`Remover ${a.nome}`}
                      className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-0.5 text-muted-foreground shadow-sm hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {preparando && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> preparando imagem…
                  </span>
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={seletorRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  anexarArquivos(Array.from(e.target.files ?? []));
                  e.target.value = ""; // escolher o MESMO arquivo de novo tem que funcionar
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => seletorRef.current?.click()}
                disabled={loading || ouvindo}
                title="Anexar imagem (ou cole com Ctrl+V, ou arraste para cá)"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              {mic.suportado && (
                <Button
                  size="sm"
                  variant={ouvindo ? "default" : "outline"}
                  onClick={mic.alternar}
                  disabled={loading}
                  title={ouvindo ? "Parar e enviar" : "Falar"}
                  className={ouvindo ? "animate-pulse" : undefined}
                >
                  {ouvindo ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(input); } }}
                onPaste={(e) => {
                  // Print recém-tirado vem no clipboard como arquivo. Copiar texto continua
                  // colando texto: só interceptamos quando há imagem de verdade.
                  const imgs = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
                  if (imgs.length === 0) return;
                  e.preventDefault();
                  anexarArquivos(imgs);
                }}
                placeholder={ouvindo ? "Falando…" : "Pergunte algo… (Enter envia, Shift+Enter quebra linha)"}
                className="min-h-[44px] resize-none text-[12.5px]"
                rows={2}
                disabled={ouvindo}
              />
              <Button
                size="sm"
                onClick={() => enviar(input)}
                disabled={loading || ouvindo || preparando || (!input.trim() && anexos.length === 0)}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
              <span>⌘/Ctrl + I para abrir/fechar</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5" title="Uma vez por dia, ao abrir o Hub">
                <input
                  type="checkbox"
                  checked={saudacaoAtiva}
                  onChange={(e) => {
                    const ligado = e.target.checked;
                    setSaudacaoAtiva(ligado);
                    if (ligado) {
                      localStorage.setItem(SAUDACAO_ATIVA, "1");
                      // Zera o marcador do dia: quem acabou de ligar quer ver funcionando
                      // agora, não amanhã.
                      localStorage.removeItem(SAUDACAO_DIA);
                    } else {
                      localStorage.removeItem(SAUDACAO_ATIVA);
                      pararFala();
                      setSaudacao(null);
                    }
                  }}
                  className="h-3 w-3 accent-[hsl(var(--primary))]"
                />
                Me receber ao entrar
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Miniatura de 96px não serve para conferir um print de DRE — clicar abre inteiro. */}
      {ampliada && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setAmpliada(null)}
          role="button"
          tabIndex={-1}
          aria-label="Fechar imagem"
        >
          <img src={ampliada} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </>
  );
}

/**
 * Diz de onde veio a resposta.
 *
 * Sem este selo os dois caminhos ficariam indistinguíveis, e um número sem procedência
 * pareceria tão confiável quanto um conferido — exatamente o que não pode acontecer com
 * dado que vai para diretoria.
 */
/**
 * Diz de onde veio a resposta. TRÊS níveis, não dois:
 *
 *   conferido  — consulta nomeada (DRE, caixa, EBITDA, lançamentos): a soma das partes
 *                foi validada contra o total. É o que pode ir para diretoria.
 *   consultado — explorador genérico: os dados vieram do banco agora, mas ninguém validou
 *                se a agregação responde à pergunta. Origem confiável, leitura por sua conta.
 *   nenhum     — caminho geral, sem consulta ao banco.
 *
 * Achatar isso em "confiável / não confiável" perderia a distinção que mais importa: um
 * levantamento correto lido de forma errada continua sendo um número errado no slide.
 */
function Selo({
  verificado, nivel, provedor, leuImagem,
}: {
  verificado?: boolean; nivel?: "conferido" | "consultado"; provedor?: string; leuImagem?: boolean;
}) {
  if (verificado === undefined) return null; // conversa recarregada do histórico

  // O modelo aparece em TODA resposta porque a escolha do provedor é feita em tempo de
  // execução: se a chave da OpenAI for recusada, a resposta vem do Gemini, e uma queda
  // silenciosa de modelo é exatamente o que não se pode ter.
  const modelo = provedor === "openai" ? "GPT" : provedor === "gemini" ? "Gemini" : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[10.5px]">
      {leuImagem ? (
        // Dizer "lido da imagem" em vez de só "sem verificação": o que a IA enxergou num
        // print não veio do banco, e a origem do valor é a imagem que está logo acima.
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Eye className="h-3 w-3" />
          lido da imagem — não conferido no banco
        </span>
      ) : !verificado ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <AlertTriangle className="h-3 w-3" />
          sem números verificados — confira antes de usar
        </span>
      ) : nivel === "consultado" ? (
        <span className="inline-flex items-center gap-1 text-amber-700">
          <Database className="h-3 w-3" />
          consultado no banco · sem conferência de soma
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <ShieldCheck className="h-3 w-3" />
          números conferidos agora
        </span>
      )}
      {modelo && <span className="text-muted-foreground">· {modelo}</span>}
    </span>
  );
}

/** A tabela dos números usados: a prova ao lado da leitura. */
function BlocoNumeros({ numeros, avisos }: { numeros?: Numero[]; avisos?: string[] }) {
  const temNumeros = (numeros?.length ?? 0) > 0;
  const temAvisos = (avisos?.length ?? 0) > 0;
  if (!temNumeros && !temAvisos) return null;

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      {temNumeros && (
        <>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Números usados
          </div>
          <div className="space-y-1.5">
            {numeros!.map((n, i) => (
              <div key={i} className="border-b border-border/60 pb-1.5 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11.5px] text-muted-foreground">{n.rotulo}</span>
                  <span className="num shrink-0 text-[11.5px] font-semibold">{n.formatado}</span>
                </div>
                <div className="text-[10px] text-muted-foreground/80">
                  {n.fonte} · {n.competencia}
                </div>
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

export function openAIAssistant(prompt?: string) {
  window.dispatchEvent(new CustomEvent("ai:open", { detail: { prompt } }));
}
