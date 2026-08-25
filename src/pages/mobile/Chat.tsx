// Aba Chat — o Assistente do Hub em formato de conversa nativa.
//
// Mesmas Edge Functions do painel do desktop (`assistente-responder` → `ai-chat`) e o
// mesmo selo de procedência: a tela SEMPRE diz se os números foram conferidos no banco ou
// se a resposta é raciocínio sem garantia. Perder esse selo no celular seria pior do que
// no desktop — é daqui que sai o print mandado no WhatsApp.
//
// O anexo de imagem é o botão que faz mais sentido justamente aqui: a nota fiscal, o
// comprovante e o cardápio do concorrente estão na mão da pessoa, não no computador dela.
// A câmera vem de graça no seletor do próprio sistema (`accept="image/*"`).

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Send, Loader2, Plus, MessageSquare, Trash2, ShieldCheck, AlertTriangle,
  Database, RotateCcw, X, ImagePlus, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { fmtDataHora } from "@/lib/mobile/formato";
import { marcarFalha, tirarPerguntaFalha } from "@/lib/mobile/chat";
import {
  ErroAssistente, TIMEOUT_MS, criarConversa, gravarMensagem, perguntarConferido, streamAiChat,
  type MsgAssistente, type NumeroConferido,
} from "@/lib/assistente";
import {
  abrirImagens, anexarImagens, guardarImagens, prepararImagens, triarArquivos,
  type ImagemAnexada, type ImagemMsg,
} from "@/lib/assistente-imagens";

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
  const [erroHistorico, setErroHistorico] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  /** Última pergunta que falhou — o botão "Tentar novamente" a reenvia sem redigitar. */
  const [falhou, setFalhou] = useState<{ texto: string; motivo: string; imagens: ImagemAnexada[] } | null>(null);
  const [anexos, setAnexos] = useState<ImagemAnexada[]>([]);
  const [preparando, setPreparando] = useState(false);
  /** Imagem aberta em tela cheia — miniatura de nota fiscal não se lê. */
  const [ampliada, setAmpliada] = useState<string | null>(null);

  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const mensagensRef = useRef<Msg[]>([]);
  useEffect(() => { mensagensRef.current = mensagens; }, [mensagens]);
  useEffect(() => { fim.current?.scrollIntoView({ behavior: "smooth" }); }, [mensagens, pensando]);

  async function carregarConversas() {
    const { data, error } = await supabase
      .from("ai_conversations" as any)
      .select("id,titulo,updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    // A consulta do Supabase não rejeita: sem olhar o `error`, uma policy negando vira
    // "Nenhuma conversa ainda" — que afirma que a pessoa nunca perguntou nada.
    if (error) { setErroHistorico(error.message); return; }
    setErroHistorico(null);
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
      .select("role,content,imagens,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    // Conversa apagada em outro aparelho: o id guardado não vale mais.
    if (error || !data) { lembrarConversa(null); setMensagens([]); return; }
    // Conversa recarregada não traz a tabela de números: `ai_messages` guarda só o texto.
    // As imagens voltam: o bucket é privado, cada caminho vira uma URL assinada.
    const linhas = data as any[];
    const abertas = await abrirImagens(
      linhas.flatMap((m) => (Array.isArray(m.imagens) ? m.imagens : [])),
    ).catch(() => new Map<string, ImagemMsg>());
    setMensagens(linhas.map((m: any) => ({
      role: m.role,
      content: m.content,
      imagens: (Array.isArray(m.imagens) ? m.imagens : [])
        .map((p: string) => abertas.get(p))
        .filter(Boolean) as ImagemMsg[],
    })));
  }

  function novaConversa() {
    lembrarConversa(null);
    setMensagens([]);
    setAnexos([]);
    setFalhou(null);
    setHistoricoAberto(false);
  }

  /** Escolher no seletor do sistema — que no celular já oferece a câmera. */
  async function anexarArquivos(arquivos: File[]) {
    if (arquivos.length === 0) return;
    const { aceitas, recusadas } = triarArquivos(arquivos, anexos.length);
    // Recusa vai em toast, não no bloco de falha: aquele bloco tem "Tentar novamente", e
    // não há pergunta nenhuma para repetir aqui.
    if (recusadas.length) toast.error("Imagem não anexada", { description: recusadas.join(" ") });
    if (aceitas.length === 0) return;

    setPreparando(true);
    try {
      const { prontas, erros } = await prepararImagens(aceitas);
      if (erros.length) toast.error("Imagem não anexada", { description: erros.join(" ") });
      if (prontas.length) setAnexos((prev) => [...prev, ...prontas]);
    } finally {
      setPreparando(false);
    }
  }

  /**
   * O botão de excluir fica encostado no de abrir, numa lista rolada com o polegar — e
   * apagar conversa não tem desfazer (as mensagens saem de `ai_messages` de vez). A
   * pergunta é a mesma que o resto do Hub faz antes de qualquer exclusão.
   */
  async function apagarConversa(c: Conversa) {
    if (!confirm(`Excluir a conversa "${c.titulo}"? As mensagens não voltam.`)) return;
    const msgs = await supabase.from("ai_messages" as any).delete().eq("conversation_id", c.id);
    const conv = await supabase.from("ai_conversations" as any).delete().eq("id", c.id);
    const erro = msgs.error ?? conv.error;
    if (erro) { toast.error("Não deu para excluir: " + erro.message); return; }
    if (c.id === conversaId) novaConversa();
    carregarConversas();
  }

  async function enviar(texto: string, imagens: ImagemAnexada[] = anexos) {
    const pergunta = texto.trim();
    // Imagem sozinha é pergunta válida: a foto da nota já diz o que se quer saber.
    if ((!pergunta && imagens.length === 0) || pensando) return;

    setFalhou(null);
    setEntrada("");
    setAnexos([]);
    // O textarea cresce por `style.height` no onInput; limpar o valor não desfaz isso, e o
    // campo ficava alto e vazio depois de mandar uma pergunta longa.
    if (campo.current) campo.current.style.height = "auto";
    setPensando(true);
    const daPergunta: ImagemMsg[] = imagens.map((i) => ({ url: i.previa, base64: i.base64, mime: i.mime }));
    const comPergunta: Msg[] = [
      ...mensagensRef.current,
      { role: "user", content: pergunta, imagens: daPergunta },
    ];
    setMensagens(comPergunta);

    let cid = conversaId;
    if (!cid) {
      cid = await criarConversa(pergunta || "Imagem");
      if (cid) lembrarConversa(cid);
    }
    // Gravar a imagem no bucket é efeito colateral: se falhar, a conversa segue e só o
    // reabrir é que fica sem a figura.
    if (cid) {
      const gravada = gravarMensagem(cid, "user", pergunta);
      if (imagens.length > 0) {
        Promise.all([gravada, guardarImagens(imagens).catch(() => [] as string[])])
          .then(([id, paths]) => id && anexarImagens(id, paths))
          .catch(() => {});
      }
    }

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
      // Com imagem o roteador nem é consultado: nenhuma consulta nomeada lê figura, e
      // chamá-lo só somaria segundos antes de cair no caminho geral do mesmo jeito.
      const conferida = imagens.length > 0
        ? null
        : await perguntarConferido(pergunta, contexto, cid).catch(() => null);

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
      setMensagens((prev) => [
        ...prev,
        { role: "assistant", content: "", verificado: false, provedor: "gemini", leuImagem: imagens.length > 0 },
      ]);
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
      // As imagens voltam com a pergunta: reenviar sem elas mandaria outra pergunta.
      setFalhou({ texto: pergunta, motivo, imagens });
    } finally {
      if (relogio) clearTimeout(relogio);
      setPensando(false);
    }
  }

  async function tentarNovamente() {
    if (!falhou) return;
    const { texto, imagens } = falhou;
    // Tira a pergunta que falhou antes de reenviar, para não duplicar a bolha.
    setMensagens(tirarPerguntaFalha);
    setFalhou(null);
    setTimeout(() => enviar(texto, imagens), 0);
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
              com a fonte e a competência. Pode também anexar uma foto — nota, comprovante,
              print — e perguntar sobre ela.
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
                <div className={cn("max-w-[85%] space-y-1.5", m.erro && "opacity-60")}>
                  {(m.imagens?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {m.imagens!.map((img, j) => (
                        <button
                          key={j}
                          onClick={() => setAmpliada(img.url)}
                          aria-label="Ver imagem"
                          className="overflow-hidden rounded-xl border border-border"
                        >
                          <img src={img.url} alt="" className="h-28 w-28 object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                  {m.content && (
                    <div className="rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-[14px] leading-snug text-primary-foreground">
                      <span className="whitespace-pre-wrap break-words">{m.content}</span>
                    </div>
                  )}
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
                    <Selo verificado={m.verificado} nivel={m.nivel} provedor={m.provedor} leuImagem={m.leuImagem} />
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
        {(anexos.length > 0 || preparando) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {anexos.map((a) => (
              <div key={a.id} className="relative">
                <img src={a.previa} alt={a.nome} className="h-16 w-16 rounded-lg border border-border object-cover" />
                <button
                  onClick={() => setAnexos((prev) => prev.filter((x) => x.id !== a.id))}
                  aria-label={`Remover ${a.nome}`}
                  // Alvo de 28px no canto: dedo em miniatura de 64px erra o X de 16px.
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {preparando && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> preparando…
              </span>
            )}
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); enviar(entrada); }}
          className="flex items-end gap-2"
        >
          <input
            ref={seletor}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              anexarArquivos(Array.from(e.target.files ?? []));
              e.target.value = ""; // escolher a MESMA foto de novo tem que funcionar
            }}
          />
          <button
            type="button"
            onClick={() => seletor.current?.click()}
            disabled={pensando}
            aria-label="Anexar imagem"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-input text-muted-foreground disabled:opacity-40"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
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
            disabled={pensando || preparando || (!entrada.trim() && anexos.length === 0)}
            aria-label="Enviar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
          >
            {pensando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </form>
      </div>

      {/* Miniatura de 112px não serve para conferir uma nota — tocar abre inteira. */}
      {ampliada && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3"
          onClick={() => setAmpliada(null)}
          role="button"
          tabIndex={-1}
          aria-label="Fechar imagem"
        >
          <img src={ampliada} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}

      <Drawer open={historicoAberto} onOpenChange={setHistoricoAberto}>
        <DrawerContent className="max-h-[80dvh]">
          <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-[16px]">Conversas</DrawerTitle>
              <button onClick={() => setHistoricoAberto(false)} aria-label="Fechar" className="flex h-11 w-11 items-center justify-center text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            {erroHistorico ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-[12.5px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Não deu para ler as conversas.
                  <span className="mt-0.5 block text-[11.5px] opacity-80">{erroHistorico}</span>
                </span>
              </div>
            ) : conversas.length === 0 ? (
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
                      onClick={() => apagarConversa(c)}
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

/** Espelha o selo do painel do desktop: conferido / consultado / lido da imagem / nada. */
function Selo({ verificado, nivel, provedor, leuImagem }: {
  verificado?: boolean; nivel?: "conferido" | "consultado"; provedor?: string; leuImagem?: boolean;
}) {
  if (verificado === undefined) return null; // conversa recarregada do histórico
  const modelo = provedor === "openai" ? "GPT" : provedor === "gemini" ? "Gemini" : null;

  return (
    <span className="mt-1.5 inline-flex flex-wrap items-center gap-1 text-[10.5px]">
      {leuImagem ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Eye className="h-3 w-3" /> lido da imagem — não conferido
        </span>
      ) : !verificado ? (
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
