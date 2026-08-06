// Cliente OpenAI compartilhado — mesma superfície do `gemini.ts`
// (`generateText`, `generateJSON`, `DEFAULT_MODEL`), para que trocar o motor de
// uma função seja trocar UMA linha de import.
//
// POR QUE EXISTE: a redação dos comentários da DRE/DFC (justificativas e
// perguntas na célula) vivia caindo com 429 de cota do Gemini no meio do
// fechamento — a pessoa clica, espera, e recebe "não consegui". Aqui a chave é
// outra e a cota é outra.
//
// Chave: OPENAI_API_KEY (aceita também as grafias `openai_api_key`/`OPENAI_KEY`,
// porque o segredo no Supabase é case-sensitive e já foi cadastrado à mão).
// Modelo: OPENAI_MODEL sobrescreve o padrão sem precisar de deploy.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/* Barato, 1M de contexto e Structured Outputs de verdade (o schema é imposto na
   decodificação, não pedido no prompt). É o par do gemini-2.5-flash que estava
   aqui antes — não uma promoção de qualidade, uma troca de fila. */
export const DEFAULT_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage { role: ChatRole; content: string }

export class OpenAIError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status = 500, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function getKey(): string {
  const k = Deno.env.get("OPENAI_API_KEY")
    || Deno.env.get("openai_api_key")
    || Deno.env.get("OPENAI_KEY");
  if (!k) throw new OpenAIError("OPENAI_API_KEY não configurada", 500);
  return k;
}

/**
 * Schema do Gemini -> schema `strict` da OpenAI.
 *
 * No modo estrito TODO objeto precisa de `additionalProperties: false` e de um
 * `required` com TODAS as chaves — o Gemini não exige nem uma coisa nem outra.
 * A conversão é aqui, e não nas funções, para que os schemas nos call sites
 * continuem legíveis (e para que voltar ao Gemini seja só trocar o import).
 */
function paraStrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(paraStrict);
  if (!node || typeof node !== "object") return node;

  const o = { ...(node as Record<string, unknown>) };
  for (const k of Object.keys(o)) o[k] = paraStrict(o[k]);

  if (o.type === "object" && o.properties && typeof o.properties === "object") {
    o.additionalProperties = false;
    // Campo opcional não existe em modo estrito: ou está no `required`, ou a
    // API recusa o schema inteiro. Nossos schemas já pedem tudo.
    o.required = Object.keys(o.properties as Record<string, unknown>);
  }
  return o;
}

/** Modelos de raciocínio (o*, gpt-5*) recusam `temperature`. */
const semTemperatura = (model: string) => /^(o\d|gpt-5)/i.test(model);

interface GenerateOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  responseSchema?: unknown; // JSON schema (o mesmo que ia para o Gemini)
  json?: boolean;           // forçar JSON sem schema
}

async function callChat(opts: GenerateOptions): Promise<Record<string, unknown>> {
  const key = getKey();
  const model = opts.model || DEFAULT_MODEL;

  const payload: Record<string, unknown> = {
    model,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content ?? "" })),
  };
  if (!semTemperatura(model)) payload.temperature = opts.temperature ?? 0.4;

  if (opts.responseSchema) {
    payload.response_format = {
      type: "json_schema",
      json_schema: { name: "resposta", strict: true, schema: paraStrict(opts.responseSchema) },
    };
  } else if (opts.json) {
    payload.response_format = { type: "json_object" };
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    console.error("OpenAI error", resp.status, detail);
    throw new OpenAIError("Falha ao consultar a IA", resp.status === 429 ? 429 : 502, detail);
  }
  return await resp.json();
}

function extractText(data: Record<string, unknown>): string {
  const choice = (data?.choices as Record<string, unknown>[] | undefined)?.[0];
  const msg = choice?.message as Record<string, unknown> | undefined;
  // Recusa do modelo vem em campo próprio e com `content: null` — sem isto, ela
  // chegaria na tela como "resposta vazia", que não diz nada a quem lê.
  if (msg?.refusal) throw new OpenAIError("A IA recusou a solicitação", 502, String(msg.refusal).slice(0, 300));
  // Corte por limite de tokens devolve JSON pela metade: melhor falhar aqui do
  // que entregar meia justificativa como se estivesse inteira.
  if (choice?.finish_reason === "length") {
    throw new OpenAIError("A resposta da IA foi cortada por tamanho", 502);
  }
  return typeof msg?.content === "string" ? msg.content : "";
}

function tryParseJson(text: string): unknown | null {
  if (!text) return null;
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(t); } catch { /* tenta recortar abaixo */ }
  const s = t.indexOf("{"); const e = t.lastIndexOf("}");
  if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { /* desiste */ } }
  return null;
}

export async function generateText(opts: GenerateOptions): Promise<string> {
  return extractText(await callChat(opts));
}

export async function generateJSON<T = unknown>(opts: GenerateOptions): Promise<T> {
  const data = await callChat({ ...opts, json: true });
  const txt = extractText(data);
  const parsed = tryParseJson(txt);
  if (!parsed) throw new OpenAIError("IA retornou resposta inválida", 502, txt.slice(0, 500));
  return parsed as T;
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
  if (e instanceof OpenAIError) {
    return jsonResponse({ error: e.message, detail: e.detail }, e.status);
  }
  console.error("AI error", e);
  return jsonResponse({ error: "Não consegui processar essa análise agora. Tente novamente em alguns segundos." }, 500);
}
