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

/** Há motor configurado? Para quem decide ANTES de chamar se vale a pena tentar
 *  — o sync das assinaturas roda no cron e prefere pular o insight a estourar.
 *  Lê pelo `getKey` de propósito: uma grafia aceita lá vale aqui também. */
export function temChave(): boolean {
  try { getKey(); return true; } catch { return false; }
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
    const props = o.properties as Record<string, unknown>;
    // Campo opcional não existe em modo estrito: ou está no `required`, ou a API
    // recusa o schema inteiro. O único jeito de dizer "pode não vir" é aceitar
    // `null` — então TUDO entra no `required` e o que era opcional vira anulável.
    // Sem isto, um schema como o da apresentação (só `acao` obrigatória, mais dez
    // campos que dependem da ação) forçaria o modelo a inventar `rubrica` e
    // `formato` num comando de remover. Schema sem `required` nenhum continua
    // querendo dizer "exige tudo", que é como as funções já migradas escrevem.
    const exigidas = new Set(Array.isArray(o.required) ? (o.required as string[]) : Object.keys(props));
    for (const k of Object.keys(props)) if (!exigidas.has(k)) props[k] = anulavel(props[k]);
    o.required = Object.keys(props);
  }
  return o;
}

/** `{type:"string"}` -> `{type:["string","null"]}`. Enum precisa listar o null. */
function anulavel(esquema: unknown): unknown {
  if (!esquema || typeof esquema !== "object") return esquema;
  const e = { ...(esquema as Record<string, unknown>) };
  const t = e.type;
  if (typeof t === "string" && t !== "null") e.type = [t, "null"];
  else if (Array.isArray(t) && !t.includes("null")) e.type = [...t, "null"];
  if (Array.isArray(e.enum) && !e.enum.includes(null)) e.enum = [...e.enum, null];
  return e;
}

/** Famílias de raciocínio (o*, gpt-5*): recusam `temperature` e trocaram
 *  `max_tokens` por `max_completion_tokens`. */
const familiaRaciocinio = (model: string) => /^(o\d|gpt-5)/i.test(model);

/* A Edge Function é morta aos 150s com um 504, e quem está na tela recebe
   "Edge Function returned a non-2xx status code" depois de dois minutos e meio
   de espera — sem saber se foi a IA, a rede ou o próprio pedido. Desistir antes
   disso troca o mistério por uma frase legível, ainda com folga para o resto da
   função responder. */
const TIMEOUT_PADRAO = 90_000;

interface GenerateOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  responseSchema?: unknown; // JSON schema (o mesmo que ia para o Gemini)
  json?: boolean;           // forçar JSON sem schema
  maxTokens?: number;       // teto da resposta; sem ele, uma geração em loop só para no limite do modelo
  timeoutMs?: number;       // padrão TIMEOUT_PADRAO
  /** Pula a OpenAI e vai direto ao Gemini, pela MESMA rota da queda automática.
   *  Para exercitar a rede de proteção sem mexer na chave de produção. */
  preferirGemini?: boolean;
}

async function callChat(opts: GenerateOptions): Promise<Record<string, unknown>> {
  const key = getKey();
  const model = opts.model || DEFAULT_MODEL;

  const payload: Record<string, unknown> = {
    model,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content ?? "" })),
  };
  if (!familiaRaciocinio(model)) payload.temperature = opts.temperature ?? 0.4;
  if (opts.maxTokens) {
    payload[familiaRaciocinio(model) ? "max_completion_tokens" : "max_tokens"] = opts.maxTokens;
  }

  if (opts.responseSchema) {
    payload.response_format = {
      type: "json_schema",
      json_schema: { name: "resposta", strict: true, schema: paraStrict(opts.responseSchema) },
    };
  } else if (opts.json) {
    payload.response_format = { type: "json_object" };
  }

  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_PADRAO),
    });
  } catch (e) {
    const nome = (e as Error)?.name;
    if (nome === "TimeoutError" || nome === "AbortError") {
      throw new OpenAIError("A IA demorou demais para responder. Tente de novo em alguns segundos.", 504);
    }
    throw new OpenAIError("Não consegui falar com a IA", 502, String((e as Error)?.message ?? e));
  }

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

/* ===================================================================== */
/* ===================== a rede de proteção do Gemini =================== */
/* ===================================================================== */
/**
 * EM 31/08/2026 A CONTA DA OPENAI FICOU SEM CRÉDITO, e o Hub descobriu do pior
 * jeito: oito `credit_balance_exhausted` em 24h e cada recurso de IA deste
 * módulo simplesmente apagando. Só o assistente sobrevivia, porque só ele tinha
 * queda para o Gemini — em `_shared/assistente/llm.ts`, um andar acima. Todo o
 * resto (recomendação do cartão, justificativa da DRE, o vigia do sino…) chama
 * este arquivo direto e ia junto.
 *
 * A queda passa a ser AQUI, e não em cada função, porque o problema não é de
 * nenhuma delas em particular: é do motor. Assim ninguém precisa lembrar de
 * pedir a proteção, que é exatamente o tipo de coisa que se esquece.
 *
 * QUANDO CAI, E QUANDO NÃO CAI — a parte que importa:
 *
 * Só se troca de motor quando o defeito é DA OPENAI e o Gemini teria chance de
 * acertar: sem crédito/cota (429), fora do ar (5xx), sem chave, ou demora demais.
 * Um 400 por schema malformado NÃO cai: o Gemini erraria igual, e mascarar isso
 * transformaria um bug de programação em "a IA está estranha hoje" — que é o
 * defeito mais caro de achar. Recusa do modelo idem: é resposta, não falha.
 */
function valeTentarOutroMotor(e: unknown): boolean {
  if (!(e instanceof OpenAIError)) return false;
  /* RECUSA NÃO É FALHA, é resposta — e perguntar a mesma coisa ao Gemini para
     ver se ele topa é justamente o que não se deve fazer. Fica de fora mesmo
     viajando com status 502, que é o código que `extractText` usa para ela. */
  if (/recus/i.test(e.message)) return false;
  // 429 = cota/crédito · 502 = não consegui falar · 504 = estourou o tempo
  // 500 = chave ausente (o `getKey` usa esse código)
  return e.status === 429 || e.status === 500 || e.status === 502 || e.status === 504;
}

async function comQuedaParaGemini<T>(
  tentarOpenAI: () => Promise<T>,
  tentarGemini: () => Promise<T>,
  preferirGemini?: boolean,
): Promise<T> {
  /* O DESVIO EXISTE PARA PODER TESTAR A QUEDA. Uma rede de proteção que nunca
     foi vista funcionando não é rede: o caminho do Gemini só roda quando a
     OpenAI quebra, ou seja, no pior momento possível e sem ninguém olhando.
     Com `preferirGemini` dá para exercitar a MESMA rota quando se quer, sem
     mexer na chave de produção — que, no Supabase, não se restaura depois de
     sobrescrita. Serve também a quem prefira o motor barato numa tarefa
     específica. */
  if (preferirGemini) return await tentarGemini();
  try {
    return await tentarOpenAI();
  } catch (e) {
    if (!valeTentarOutroMotor(e)) throw e;
    console.error(
      "OpenAI indisponível; caindo para o Gemini.",
      e instanceof Error ? e.message : e,
    );
    return await tentarGemini();
  }
}

export async function generateText(opts: GenerateOptions): Promise<string> {
  return await comQuedaParaGemini(
    async () => extractText(await callChat(opts)),
    /* Importação preguiçosa: quem nunca cai não paga o custo de carregar o
       módulo do Gemini, e o ciclo openai↔gemini nunca chega a se formar. */
    /* `maxTokens` e `timeoutMs` NÃO atravessam: o `GenerateOptions` do Gemini
       não tem esses campos, e mandá-los assim mesmo seria um objeto ignorado em
       silêncio — o tipo de "funciona" que só se descobre quando o teto não
       segura nada. O Gemini tem o retry e a cascata dele próprios. */
    async () => {
      const g = await import("./gemini.ts");
      return await g.generateText({
        messages: opts.messages,
        temperature: opts.temperature,
      });
    },
    opts.preferirGemini,
  );
}

export async function generateJSON<T = unknown>(opts: GenerateOptions): Promise<T> {
  return await comQuedaParaGemini(
    async () => {
      const data = await callChat({ ...opts, json: true });
      const txt = extractText(data);
      const parsed = tryParseJson(txt);
      if (!parsed) throw new OpenAIError("IA retornou resposta inválida", 502, txt.slice(0, 500));
      return parsed as T;
    },
    /* `responseSchema` vai CRU. Ele já chega na forma do Gemini — é o
       `paraStrict()` deste arquivo que o converte para a OpenAI, não o
       contrário —, então repassar o original é o certo. */
    async () => {
      const g = await import("./gemini.ts");
      return await g.generateJSON<T>({
        messages: opts.messages,
        temperature: opts.temperature,
        responseSchema: opts.responseSchema,
        /* Sem schema, o Gemini precisa que lhe digam que a saída é JSON —
           `json: true` é o `responseMimeType` dele. Na OpenAI isso já vinha
           embutido no `callChat({ ...opts, json: true })` acima. */
        json: !opts.responseSchema,
      });
    },
    opts.preferirGemini,
  );
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
