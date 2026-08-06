// Modelo de linguagem do Assistente — OpenAI, com o Gemini como reserva.
//
// POR QUE UMA CAMADA SÓ PARA O ASSISTENTE, E NÃO UMA TROCA GLOBAL:
// o resto do Hub (editais, insights do dashboard, classificação, projeções) roda no
// Gemini e continua rodando. Trocar tudo de uma vez arriscaria dezenas de fluxos que
// hoje funcionam, para resolver um pedido que era só sobre o assistente.
//
// ESCOLHA EM TEMPO DE EXECUÇÃO, não em tempo de deploy:
//   • `OPENAI_API_KEY` presente  → OpenAI.
//   • ausente, ou a chamada falha → Gemini.
// Duas consequências boas: dá para ligar e desligar o GPT cadastrando ou removendo um
// secret, sem redeploy; e se a chave expirar ou a cota estourar, o assistente continua
// respondendo em vez de morrer — só que pelo modelo antigo.
//
// A queda para o Gemini é registrada no log da função, para não virar um downgrade
// silencioso que ninguém percebe.

import { ChatMessage, generateJSON as geminiJSON, generateText as geminiText } from "../gemini.ts";

export type { ChatMessage };

/** Modelo padrão. Sobrescreva com o secret `OPENAI_MODEL` sem mexer no código. */
const MODELO_PADRAO = "gpt-4o";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export type OpcoesLLM = {
  messages: ChatMessage[];
  temperature?: number;
  /** Força saída JSON. Os prompts que usam isto já pedem JSON explicitamente. */
  json?: boolean;
};

function chaveOpenAI(): string | null {
  return Deno.env.get("OPENAI_API_KEY") ?? null;
}

export function provedorAtual(): "openai" | "gemini" {
  return chaveOpenAI() ? "openai" : "gemini";
}

async function chamarOpenAI(opts: OpcoesLLM, chave: string): Promise<string> {
  const corpo: Record<string, unknown> = {
    model: Deno.env.get("OPENAI_MODEL") ?? MODELO_PADRAO,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.4,
  };
  // O modo JSON da OpenAI exige que a palavra "json" apareça nas mensagens — os prompts
  // de roteamento e de extração de memória já dizem "Responda SOMENTE com JSON".
  if (opts.json) corpo.response_format = { type: "json_object" };

  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify(corpo),
  });

  if (!resp.ok) {
    const detalhe = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${detalhe.slice(0, 300)}`);
  }

  const dados = await resp.json();
  return dados?.choices?.[0]?.message?.content ?? "";
}

/** Texto livre. Cai para o Gemini se a OpenAI não estiver configurada ou falhar. */
export async function gerarTexto(opts: OpcoesLLM): Promise<string> {
  const chave = chaveOpenAI();
  if (chave) {
    try {
      return await chamarOpenAI(opts, chave);
    } catch (e) {
      console.error("OpenAI falhou; caindo para o Gemini.", e instanceof Error ? e.message : e);
    }
  }
  return await geminiText({ messages: opts.messages, temperature: opts.temperature });
}

/**
 * Saída JSON já parseada.
 *
 * O parse é tolerante de propósito: mesmo em modo JSON, modelo às vezes devolve o objeto
 * dentro de cerca de código. Falha de parse cai para o Gemini em vez de estourar — quem
 * chama trata `null`/objeto vazio como "não consegui rotear", que já tem caminho próprio.
 */
export async function gerarJSON<T = unknown>(opts: OpcoesLLM): Promise<T> {
  const chave = chaveOpenAI();
  if (chave) {
    try {
      const bruto = await chamarOpenAI({ ...opts, json: true }, chave);
      const parseado = tentarParse(bruto);
      if (parseado !== null) return parseado as T;
      console.error("OpenAI devolveu JSON inválido; caindo para o Gemini.");
    } catch (e) {
      console.error("OpenAI falhou; caindo para o Gemini.", e instanceof Error ? e.message : e);
    }
  }
  return await geminiJSON<T>({ messages: opts.messages, temperature: opts.temperature });
}

function tentarParse(texto: string): unknown | null {
  if (!texto) return null;
  const limpo = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(limpo); } catch { /* tenta recortar abaixo */ }

  const inicio = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (inicio !== -1 && fim > inicio) {
    try { return JSON.parse(limpo.slice(inicio, fim + 1)); } catch { /* desiste */ }
  }
  return null;
}
