// Cliente Gemini compartilhado para todas as Edge Functions de IA da Takeat.
// Usa GEMINI_API_KEY (server-side) — nunca expor no frontend.
//
// Padrões:
// - generateJSON: chamada única retornando JSON estruturado (com ou sem responseSchema)
// - generateText: chamada única retornando texto puro
// - streamAsOpenAISSE: stream Gemini convertido para o formato OpenAI SSE
//   (compatível com clientes que já consomem chunks `choices[0].delta.content`)

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/* Os nomes dos modelos moram AQUI, e não no call site.
 *
 * Em ago/26 a conta do Gemini passou a ser a do projeto "Hub Financeiro" e todo
 * o 2.x morreu junto: `gemini-2.5-flash`, `-flash-lite`, `-pro` e `gemini-2.0-flash`
 * respondem 404 "no longer available to new users" — é idade do projeto, não
 * plano de faturamento, então não adianta assinar. Na época o nome estava escrito
 * na mão em cinco funções e a troca teve de passar por todas.
 *
 * Por env var pelo mesmo motivo: o próximo 404 desses vira uma mudança de
 * segredo, não um deploy. Mesmo padrão do OPENAI_MODEL em openai.ts. */
export const DEFAULT_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
/** O irmão barato e rápido — é o que aguenta OCR de PDF escaneado dentro do
 *  tempo do edge. Sucessor do `gemini-2.5-flash-lite`. */
export const MODELO_LITE = Deno.env.get("GEMINI_MODEL_LITE") || "gemini-3.5-flash-lite";
/** Fila de escape para 503 ("high demand") e 429: tenta o próximo da lista. */
export const MODELOS_CASCATA = [DEFAULT_MODEL, MODELO_LITE, "gemini-3.1-flash-lite"];

export type ChatRole = "system" | "user" | "assistant";

/** Imagem anexada a uma mensagem: base64 puro, sem o prefixo `data:...;base64,`. */
export interface ChatImage { mimeType: string; data: string }

export interface ChatMessage { role: ChatRole; content: string; imagens?: ChatImage[] }

export class GeminiError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status = 500, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function getKey(): string {
  const k = Deno.env.get("GEMINI_API_KEY");
  if (!k) throw new GeminiError("GEMINI_API_KEY não configurada", 500);
  return k;
}

function toContents(messages: ChatMessage[]): { systemInstruction?: any; contents: any[] } {
  const systemParts: string[] = [];
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) systemParts.push(m.content);
    } else {
      // Imagem ANTES do texto: é a ordem que o Gemini recomenda — o modelo lê a figura e
      // depois a pergunta sobre ela. Invertido, a pergunta chega sem o objeto.
      const parts: any[] = [];
      for (const img of m.imagens ?? []) {
        if (img?.data) parts.push({ inlineData: { mimeType: img.mimeType || "image/jpeg", data: img.data } });
      }
      // Mensagem só com imagem não leva `text` vazio junto; sem imagem nenhuma, o texto
      // (mesmo vazio) continua sendo a única parte, como sempre foi.
      if (m.content || parts.length === 0) parts.push({ text: m.content ?? "" });
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
    }
  }
  return {
    systemInstruction: systemParts.length ? { role: "system", parts: [{ text: systemParts.join("\n\n") }] } : undefined,
    contents,
  };
}

interface GenerateOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  responseSchema?: any; // JSON schema (Gemini-compatible subset)
  json?: boolean;       // forçar responseMimeType=application/json
  /** Quanto o modelo raciocina antes de responder (Gemini 3: `thinkingLevel`).
   *
   *  Sem isto o modelo pensa no nível alto, que é o padrão dele, e o raciocínio é
   *  a MAIOR parte do tempo de uma chamada — as partes `thought: true` que o
   *  `extractTextFromResponse` joga fora custaram os mesmos segundos das que
   *  ficaram. Vale "high" quando a resposta é uma análise; vale "low" quando o
   *  trabalho é transcrever um documento para um schema fechado, que é leitura,
   *  não deliberação. Só peça o que a tarefa precisa. */
  thinking?: "low" | "high";
}

/* Nem todo modelo aceita `thinkingLevel` — os 2.x nunca aceitaram, e o próximo
   nome de modelo pode não aceitar também. Em vez de fixar uma lista que envelhece
   (foi o que fez o 404 do 2.x passar por cinco funções), o primeiro 400 que
   reclamar do campo desliga o pedido para o resto da vida do worker e a chamada é
   refeita sem ele. Perde-se uma requisição, uma vez, e nada quebra. */
let aceitaThinking = true;

async function callGenerate(opts: GenerateOptions, stream = false): Promise<Response> {
  const key = getKey();
  const model = opts.model || DEFAULT_MODEL;
  const path = stream ? "streamGenerateContent?alt=sse&key=" : "generateContent?key=";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${path}${key}`;

  const { systemInstruction, contents } = toContents(opts.messages);

  const disparar = async (comThinking: boolean): Promise<Response> => {
    const generationConfig: Record<string, any> = { temperature: opts.temperature ?? 0.4 };
    if (opts.json || opts.responseSchema) generationConfig.responseMimeType = "application/json";
    if (opts.responseSchema) generationConfig.responseSchema = opts.responseSchema;
    if (comThinking) generationConfig.thinkingLevel = opts.thinking;

    const payload: any = { contents, generationConfig };
    if (systemInstruction) payload.systemInstruction = systemInstruction;

    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  const pedindoThinking = !!opts.thinking && aceitaThinking;
  let resp = await disparar(pedindoThinking);

  if (!resp.ok) {
    const detail = await resp.text();
    if (pedindoThinking && resp.status === 400 && /thinking/i.test(detail)) {
      console.warn(`Gemini: ${model} não aceita thinkingLevel — seguindo sem ele`);
      aceitaThinking = false;
      resp = await disparar(false);
      if (resp.ok) return resp;
      const d2 = await resp.text();
      console.error("Gemini error", resp.status, d2);
      throw new GeminiError("Falha ao consultar a IA", resp.status === 429 ? 429 : 502, d2);
    }
    console.error("Gemini error", resp.status, detail);
    throw new GeminiError("Falha ao consultar a IA", resp.status === 429 ? 429 : 502, detail);
  }
  return resp;
}

function extractTextFromResponse(data: any): string {
  const cands = data?.candidates ?? [];
  if (!cands.length) return "";
  // `thought: true` são as partes de raciocínio dos modelos Gemini 3. Elas vêm no
  // mesmo array das partes de resposta e, coladas junto, embaralham o JSON.
  return (cands[0]?.content?.parts ?? [])
    .filter((p: any) => p?.thought !== true)
    .map((p: any) => p?.text ?? "")
    .join("");
}

function tryParseJson(text: string): any | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(t); } catch {}
  const s = t.indexOf("{"); const e = t.lastIndexOf("}");
  if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
  return null;
}

export async function generateText(opts: GenerateOptions): Promise<string> {
  const resp = await callGenerate(opts, false);
  const data = await resp.json();
  return extractTextFromResponse(data);
}

export async function generateJSON<T = any>(opts: GenerateOptions): Promise<T> {
  const resp = await callGenerate({ ...opts, json: true }, false);
  const data = await resp.json();
  const txt = extractTextFromResponse(data);
  const parsed = tryParseJson(txt);
  if (!parsed) throw new GeminiError("IA retornou resposta inválida", 502, txt.slice(0, 500));
  return parsed as T;
}

/**
 * Faz streaming do Gemini e converte cada chunk para o formato OpenAI SSE
 *  → data: {"choices":[{"delta":{"content":"..."}}]}\n\n
 *  → data: [DONE]\n\n
 * Assim qualquer cliente que já consumia o gateway OpenAI-compatível continua funcionando.
 */
export async function streamAsOpenAISSE(opts: GenerateOptions): Promise<Response> {
  const upstream = await callGenerate(opts, true);
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      const sendChunk = (text: string) => {
        if (!text) return;
        const payload = { choices: [{ delta: { content: text } }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;
            try {
              const p = JSON.parse(json);
              const text = extractTextFromResponse(p);
              if (text) sendChunk(text);
            } catch { /* ignora chunks parciais */ }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        console.error("stream error", e);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "stream_error" })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return null;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof GeminiError) {
    return jsonResponse({ error: e.message, detail: e.detail }, e.status);
  }
  console.error("AI error", e);
  return jsonResponse({ error: "Não consegui processar essa análise agora. Tente novamente em alguns segundos." }, 500);
}
