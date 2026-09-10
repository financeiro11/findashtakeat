// Cliente Gemini compartilhado para todas as Edge Functions de IA da Takeat.
// Usa GEMINI_API_KEY (server-side) — nunca expor no frontend.
//
// Padrões:
// - generateJSON: chamada única retornando JSON estruturado (com ou sem responseSchema)
// - generateText: chamada única retornando texto puro
// - streamAsOpenAISSE: stream Gemini convertido para o formato OpenAI SSE
//   (compatível com clientes que já consomem chunks `choices[0].delta.content`)

import { freioIA } from "./ia-orcamento.ts";
import type { ConsumidorIA } from "./ia-orcamento.ts";

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
  /** Desliga a retentativa de 503/429 para quem já tem a sua (o radar tem). */
  semRetentativa?: boolean;
  /** Teto da resposta. Sem ele vale `TETO_SAIDA_PADRAO` — ver o comentário lá. */
  maxTokens?: number;
  /** Quem está gastando. Vai para `ai_usage_log.feature` e é por onde o painel
   *  Configurações › Uso de IA e o freio enxergam esta chamada. */
  consumidor?: ConsumidorIA;
  /** Quem pediu, quando foi gente. Omitido = foi o servidor. */
  userId?: string | null;
  /** Recebe os tokens da chamada, para quem grava o razão por conta própria.
   *  Dado isto, o motor NÃO grava sozinho — senão a chamada contaria duas vezes. */
  onUso?: (uso: { model: string; promptTokens: number; completionTokens: number }) => void;
}

/* Ver o gêmeo em `openai.ts`. Três vezes maior que ele por um motivo do Gemini: aqui o
   `maxOutputTokens` CONTA OS TOKENS DE RACIOCÍNIO junto com os da resposta. Com
   `thinking: "high"`, o modelo pode gastar milhares de tokens pensando antes de escrever a
   primeira palavra — um teto apertado cortaria a resposta no meio, e este arquivo não olha
   `finishReason`: JSON cortado vira "IA retornou resposta inválida" e texto cortado vira
   uma frase que termina no nada. 24k é ~20× a maior resposta já registrada; continua sendo
   rede contra laço, não orçamento de palavras. */
const TETO_SAIDA_PADRAO = 24_000;

const SEM_ROTULO: ConsumidorIA = "gemini_sem_rotulo";

/* ---------------------------------------------------------------- retry --
 *
 * UMA TENTATIVA EXTRA, e não três. O 503 do Gemini ("This model is currently
 * experiencing high demand") apareceu 11 vezes em 24h de logs em 29/08/2026, e
 * cada uma custava a unidade de trabalho inteira porque aqui não havia
 * retentativa nenhuma — `MODELOS_CASCATA` existe desde sempre, mas é opt-in e só
 * 3 dos ~20 call sites a usam.
 *
 * O CUIDADO É NÃO PIORAR O QUE SE QUER CONSERTAR. Retentativa agressiva contra
 * um modelo que já está dizendo "estou sobrecarregado" é exatamente como se
 * transforma um pico do fornecedor numa tempestade nossa. Por isso:
 *
 *   • uma tentativa extra, no máximo — se a segunda também falha, o problema não
 *     é intermitente e insistir é desperdício com aparência de robustez;
 *   • recuo ANTES de tentar, e maior para 429 do que para 503: 503 é "estou
 *     cheio agora", 429 é "você está pedindo demais" — a segunda merece mais
 *     silêncio da nossa parte;
 *   • só 503 e 429. 400, 404 e 403 são defeito nosso e repetir só multiplica o
 *     mesmo erro.
 */
const RECUO_MS: Record<number, number> = { 503: 1_200, 429: 4_000 };

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  /* O FREIO, no mesmo lugar do gêmeo em `openai.ts`: aqui e não nos call sites, e AQUI e
     não em `generateText`/`generateJSON`/`streamAsOpenAISSE`, que são três portas para a
     mesma chamada. A retentativa de 503/429 e a troca de modelo por `thinking` acontecem
     lá embaixo, dentro de `disparar` — de propósito: elas são a MESMA chamada tentada de
     novo, e cobrar duas vezes do teto diário por um pico do fornecedor puniria a função
     pelo mau dia do Google. */
  const bloqueio = await freioIA(opts.consumidor ?? SEM_ROTULO);
  if (bloqueio) throw new GeminiError(bloqueio, 402);

  /* A CHAMADA QUE FALHOU TAMBÉM ENTRA NO RAZÃO, com zero token — a regra que o
     `openai.ts` já seguia e que este arquivo não seguia, e a diferença custou cinco dias.
     Em 09/09/2026 descobriu-se que 376 das 391 chamadas de Gemini da semana tinham
     falhado ("prepayment credits are depleted", desde ~04/09): metade da IA do Hub estava
     MORTA e nada avisou, porque o único vigia que existia olhava GASTO — e motor parado
     não gasta. Linha zerada é o que permite ao `ia_falhas_alerta()` enxergar isso.

     Zero token não custa dinheiro, mas consome a disponibilidade do dia, que é o que o
     teto por chamadas existe para conter: 200 tentativas que falham são 200 tentativas. */
  const anotarFalha = async () => {
    try { await anotar(opts, {}, model); } catch { /* o razão não derruba a chamada */ }
  };

  const { systemInstruction, contents } = toContents(opts.messages);

  const disparar = async (comThinking: boolean): Promise<Response> => {
    const generationConfig: Record<string, any> = {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? TETO_SAIDA_PADRAO,
    };
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
      await anotarFalha();
      throw new GeminiError("Falha ao consultar a IA", resp.status === 429 ? 429 : 502, d2);
    }

    /* Pico do fornecedor: recua e tenta UMA vez. Ver o bloco `RECUO_MS`. */
    const recuo = RECUO_MS[resp.status];
    if (recuo && !opts.semRetentativa && !stream) {
      console.warn(`Gemini ${resp.status} em ${model} — recuando ${recuo}ms e tentando outra vez`);
      await dorme(recuo);
      const segunda = await disparar(pedindoThinking && aceitaThinking);
      if (segunda.ok) return segunda;
      const d3 = await segunda.text();
      console.error("Gemini error", segunda.status, "(falhou nas 2 tentativas)", d3);
      await anotarFalha();
      throw new GeminiError("Falha ao consultar a IA", segunda.status === 429 ? 429 : 502, d3);
    }

    console.error("Gemini error", resp.status, detail);
    await anotarFalha();
    throw new GeminiError("Falha ao consultar a IA", resp.status === 429 ? 429 : 502, detail);
  }
  return resp;
}

/**
 * Tokens da chamada, para o razão.
 *
 * ATÉ 09/09/2026 ISTO ERA OPT-IN E 13 DOS 19 CALL SITES NÃO OPTAVAM. `avisarUso` saía na
 * primeira linha quando não havia `onUso`, e o Gemini deste lado gastava sem deixar rastro
 * — inclusive os caros: `ai-chat` (o assistente, que ainda por cima transmite em stream e
 * nem passava por aqui), `parse-balancete-pdf` e `auditoria-conferir-comprovante`, que são
 * multimodais e se pagam por PÁGINA. Era o mesmo buraco que o `openai.ts` tapou em 03/09,
 * do outro lado do corredor: um razão que só enxerga 6 de 19 responde com confiança um
 * número que não é o da conta.
 *
 * Agora grava sozinho, e quem quiser gravar por conta própria continua passando `onUso`.
 */
async function anotar(opts: GenerateOptions, data: any, modelo?: string): Promise<void> {
  const u = data?.usageMetadata ?? {};
  const uso = {
    model: modelo || opts.model || DEFAULT_MODEL,
    promptTokens: Number(u.promptTokenCount ?? 0),
    completionTokens: Number(u.candidatesTokenCount ?? 0),
  };
  if (opts.onUso) {
    try { opts.onUso(uso); } catch { /* o razão não derruba a rodada */ }
    return;
  }
  try {
    const { clienteDeServico, registrarUsoIA } = await import("./ia-orcamento.ts");
    const supa = await clienteDeServico();
    if (!supa) return;
    await registrarUsoIA(supa, {
      consumidor: opts.consumidor ?? SEM_ROTULO,
      model: uso.model,
      promptTokens: uso.promptTokens,
      completionTokens: uso.completionTokens,
      userId: opts.userId ?? null,
    });
  } catch (e) {
    console.error("ai_usage_log (gemini)", (e as Error)?.message ?? e);
  }
}

/**
 * Para quem chama `generativelanguage.googleapis.com` NA MÃO e não passa por este motor.
 *
 * São quatro em 09/09/2026 — `parse-balancete-pdf`, `comprovantes-drive-sync` (duas
 * chamadas), `ask-finance-ai` e `editais-edi-consult` —, elas importam daqui só as
 * CONSTANTES de modelo, e por isso o medidor e o freio que moram no motor não as alcançam:
 * o motor não freia o que não passa por ele. Duas delas são multimodais e se pagam por
 * página, que é a forma de gasto mais cara que o Hub tem.
 *
 * Migrá-las para `generateJSON` é o certo e não é o que se faz num dia de auditoria de
 * conta: cada uma tem o seu próprio recorte de payload, o seu timeout e a sua cascata de
 * modelos, e trocar tudo isso junto é como se estraga uma leitura de balancete que
 * funciona. Então, por ora, elas ganham as DUAS LINHAS que importam — `freioIA` antes e
 * `anotarUsoDireto` depois — e ficam visíveis e freáveis sem que uma vírgula do prompt
 * mude.
 */
export async function anotarUsoDireto(
  consumidor: ConsumidorIA,
  model: string,
  resposta: any,
  userId?: string | null,
): Promise<void> {
  await anotar({ messages: [], consumidor, userId, model }, resposta, model);
}

function extractTextFromResponse(data: any): string {
  const cands = data?.candidates ?? [];
  if (!cands.length) return "";
  /* Avisa, não derruba. Desde que existe `maxOutputTokens` (09/09/2026) uma resposta pode
     ser cortada por teto, e o corte é silencioso: JSON pela metade já falha adiante com
     "resposta inválida", mas TEXTO pela metade volta parecendo inteiro. Quem ler o log vai
     saber que precisa passar `maxTokens` maior nesse call site. */
  if (cands[0]?.finishReason === "MAX_TOKENS") {
    console.warn("Gemini: resposta cortada pelo teto de saída (MAX_TOKENS)");
  }
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
  await anotar(opts, data);
  return extractTextFromResponse(data);
}

export async function generateJSON<T = any>(opts: GenerateOptions): Promise<T> {
  const resp = await callGenerate({ ...opts, json: true }, false);
  const data = await resp.json();
  await anotar(opts, data);
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
      /* O USO DO STREAM CHEGA NOS CHUNKS, e o último traz o total acumulado — por isso
         guarda-se o mais recente em vez de somar. Sem isto o assistente do Hub, que é a
         função de IA que mais gente usa, seria a única a nunca aparecer no razão: ele não
         passa por `generateText` nem por `generateJSON`. */
      let ultimoUso: any = null;
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
              if (p?.usageMetadata) ultimoUso = p.usageMetadata;
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
        /* GRAVA ANTES DE FECHAR, e mesmo quando o stream quebrou no meio: o que já veio
           foi cobrado. Depois do `close()` a resposta acabou e o isolate pode ser
           derrubado antes de o INSERT chegar ao banco. */
        if (ultimoUso) await anotar(opts, { usageMetadata: ultimoUso });
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
