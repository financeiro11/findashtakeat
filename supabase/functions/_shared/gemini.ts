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

export const DEFAULT_MODEL = "gemini-2.5-flash";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage { role: ChatRole; content: string }

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
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content ?? "" }],
      });
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
}

async function callGenerate(opts: GenerateOptions, stream = false): Promise<Response> {
  const key = getKey();
  const model = opts.model || DEFAULT_MODEL;
  const path = stream ? "streamGenerateContent?alt=sse&key=" : "generateContent?key=";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${path}${key}`;

  const { systemInstruction, contents } = toContents(opts.messages);
  const generationConfig: Record<string, any> = { temperature: opts.temperature ?? 0.4 };
  if (opts.json || opts.responseSchema) generationConfig.responseMimeType = "application/json";
  if (opts.responseSchema) generationConfig.responseSchema = opts.responseSchema;

  const payload: any = { contents, generationConfig };
  if (systemInstruction) payload.systemInstruction = systemInstruction;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    console.error("Gemini error", resp.status, detail);
    throw new GeminiError("Falha ao consultar a IA", resp.status === 429 ? 429 : 502, detail);
  }
  return resp;
}

function extractTextFromResponse(data: any): string {
  const cands = data?.candidates ?? [];
  if (!cands.length) return "";
  return cands[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
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
