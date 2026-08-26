// Transporte do Assistente: as duas chamadas que o painel do desktop já faz, isoladas
// para o app do celular usar as MESMAS Edge Functions.
//
// Nenhuma função nova e nenhum prompt de sistema duplicado: `assistente-responder` e
// `ai-chat` continuam sendo a única fonte de resposta, com o mesmo contexto
// organizacional. Aqui só mora o fio — pedir, ler o SSE, devolver texto.
//
// Este módulo NÃO é importado por src/components/AIAssistant.tsx de propósito. O painel do
// desktop é a superfície mais usada do Hub; refatorá-lo para compartilhar código não
// melhoraria nada para quem usa e abriria risco de regressão numa tela que ninguém pediu
// para mexer.

import { supabase } from "@/integrations/supabase/client";
import { comImagensLegiveis, paraRequisicao, type ImagemMsg } from "@/lib/assistente-imagens";
import { urlDaFuncao } from "@/lib/urlFuncao";

export type PapelMsg = "user" | "assistant";
export type MsgAssistente = {
  role: PapelMsg;
  content: string;
  /** true = números vieram de consulta ao banco nesta requisição. */
  verificado?: boolean;
  nivel?: "conferido" | "consultado";
  provedor?: string;
  erro?: boolean;
  /** Imagens anexadas à pergunta. Só o caminho geral as recebe. */
  imagens?: ImagemMsg[];
  /** Resposta escrita olhando para uma imagem — número lido não é número conferido. */
  leuImagem?: boolean;
};

export type NumeroConferido = {
  rotulo: string; valor: number; formatado: string; fonte: string; competencia: string;
};

export type RespostaConferida = {
  ok?: boolean;
  consulta?: string;
  resposta?: string;
  numeros?: NumeroConferido[];
  avisos?: string[];
  provedor?: string;
  nivel?: "conferido" | "consultado";
};

export class ErroAssistente extends Error {
  constructor(message: string, readonly motivo: "timeout" | "rede" | "servidor") {
    super(message);
    this.name = "ErroAssistente";
  }
}

/** Rede móvel cai calada; sem teto a tela fica "pensando" para sempre. */
export const TIMEOUT_MS = 60_000;

function comTimeout<T>(promessa: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ErroAssistente("A resposta demorou demais.", "timeout")), ms);
    promessa.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Caminho CONFERIDO. Devolve `null` quando a pergunta não caiu numa consulta nomeada —
 * aí quem responde é o caminho geral.
 */
export async function perguntarConferido(
  pergunta: string,
  historico: { pergunta: string; resposta: string }[],
  conversaId: string | null,
): Promise<RespostaConferida | null> {
  const { data, error } = await comTimeout(
    supabase.functions.invoke("assistente-responder", {
      body: { pergunta, historico: historico.slice(-4), conversa_id: conversaId },
    }),
  );
  const resp = data as RespostaConferida | null;
  if (error || !resp || resp.consulta === "nenhuma") return null;
  return resp;
}

/**
 * Caminho GERAL (streaming). Lê o SSE no formato OpenAI que o `ai-chat` devolve e
 * entrega os pedaços conforme chegam. Retorna o texto completo.
 */
export async function streamAiChat(
  historico: MsgAssistente[],
  aoReceber: (pedaco: string) => void,
  sinal?: AbortSignal,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const url = urlDaFuncao("ai-chat");

  // Só as imagens mais recentes seguem, e as reabertas do histórico voltam a ter bytes:
  // sem isso, "e o total dessa nota?" chegaria a um modelo que não está vendo a nota.
  const legivel = await comImagensLegiveis(historico);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        messages: legivel.map((m) => ({
          role: m.role, content: m.content, imagens: paraRequisicao(m.imagens),
        })),
      }),
      signal: sinal,
    });
  } catch (e) {
    if (sinal?.aborted) throw new ErroAssistente("A resposta demorou demais.", "timeout");
    throw new ErroAssistente("Sem conexão com o servidor.", "rede");
  }

  if (!resp.ok || !resp.body) {
    // O status vai junto na frase genérica. Sem ele, um 401 vindo do endereço errado
    // ficava indistinguível de a IA ter engasgado, e o print mandado no WhatsApp não
    // permitia investigar nada — foi o que aconteceu em 25/08/26.
    const motivo =
      resp.status === 429 ? "Muitas perguntas seguidas. Espere alguns segundos."
      : resp.status === 402 ? "Sem créditos de IA."
      : resp.status === 401 || resp.status === 403
        ? "Sua sessão expirou. Saia e entre de novo."
        : `O assistente não conseguiu responder agora (erro ${resp.status}).`;
    throw new ErroAssistente(motivo, "servidor");
  }

  const leitor = resp.body.getReader();
  const decodificador = new TextDecoder();
  let acumulado = "";
  let buffer = "";
  let terminou = false;

  try {
    while (!terminou) {
      const { done, value } = await leitor.read();
      if (done) break;
      buffer += decodificador.decode(value, { stream: true });

      let quebra: number;
      while ((quebra = buffer.indexOf("\n")) !== -1) {
        let linha = buffer.slice(0, quebra);
        buffer = buffer.slice(quebra + 1);
        if (linha.endsWith("\r")) linha = linha.slice(0, -1);
        if (!linha.startsWith("data: ")) continue;

        const json = linha.slice(6).trim();
        if (json === "[DONE]") { terminou = true; break; }
        try {
          const parsed = JSON.parse(json);
          const pedaco = parsed.choices?.[0]?.delta?.content;
          if (pedaco) { acumulado += pedaco; aoReceber(pedaco); }
        } catch {
          // Pedaço partido no meio do JSON: devolve ao buffer e espera o resto chegar.
          buffer = `${linha}\n${buffer}`;
          break;
        }
      }
    }
  } catch (e) {
    // A conexão caiu no meio do stream. Se já veio texto, ele vale: a pessoa lê o que
    // chegou em vez de ver a resposta sumir.
    if (!acumulado) {
      throw new ErroAssistente(
        sinal?.aborted ? "A resposta demorou demais." : "A conexão caiu durante a resposta.",
        sinal?.aborted ? "timeout" : "rede",
      );
    }
  }
  return acumulado;
}

/* --------------------------- persistência da conversa --------------------------- */
export async function criarConversa(primeiraPergunta: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const titulo = primeiraPergunta.slice(0, 60) || "Nova conversa";
  const { data, error } = await supabase
    .from("ai_conversations" as any)
    .insert({ user_id: user.id, titulo })
    .select("id")
    .single();
  return error || !data ? null : (data as any).id;
}

/** Devolve o id da linha — é por ele que a imagem alcança a mensagem depois do upload. */
export async function gravarMensagem(
  conversaId: string, role: PapelMsg, content: string,
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("ai_messages" as any)
    .insert({ conversation_id: conversaId, user_id: user.id, role, content })
    .select("id")
    .single();
  await supabase.from("ai_conversations" as any).update({ updated_at: new Date().toISOString() }).eq("id", conversaId);
  return (data as any)?.id ?? null;
}
