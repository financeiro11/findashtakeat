// Modelo de linguagem do Assistente — OpenAI, com o Gemini como reserva.
//
// A CHAMADA À OPENAI NÃO MORA AQUI: quem fala com a API é `_shared/openai.ts`, o mesmo
// cliente que as justificativas e as perguntas de célula usam. Este arquivo é só a
// política de escolha e a queda para o Gemini.
//
// Manter dois clientes seria pedir que divirjam: aquele já trata recusa do modelo
// (`refusal`, que chega com content nulo e viraria "resposta vazia" na tela) e corte por
// limite de tokens (`finish_reason: length`, que entregaria meia resposta como se fosse
// inteira). Reimplementar isso aqui só criaria a chance de esquecer um dos dois.
//
// POR QUE O RESTO DO HUB CONTINUA NO GEMINI: editais, insights e classificação funcionam
// e não havia motivo para arriscá-los. A escolha do assistente é em tempo de EXECUÇÃO:
// com `OPENAI_API_KEY` cadastrada usa OpenAI, sem ela usa Gemini — dá para ligar e
// desligar por secret, e uma chave expirada degrada em vez de emudecer o assistente.
//
// A queda é registrada no log e o provedor aparece na tela, para não virar um downgrade
// silencioso.

import { ChatMessage, generateJSON as geminiJSON, generateText as geminiText } from "../gemini.ts";
import { generateJSON as openaiJSON, generateText as openaiText } from "../openai.ts";

export type { ChatMessage };

export type OpcoesLLM = {
  messages: ChatMessage[];
  temperature?: number;
  /** Força saída JSON. Os prompts que usam isto já pedem JSON explicitamente. */
  json?: boolean;
};

function temOpenAI(): boolean {
  return !!Deno.env.get("OPENAI_API_KEY");
}

export function provedorAtual(): "openai" | "gemini" {
  return temOpenAI() ? "openai" : "gemini";
}

/** Texto livre. Cai para o Gemini se a OpenAI não estiver configurada ou falhar. */
export async function gerarTexto(opts: OpcoesLLM): Promise<string> {
  if (temOpenAI()) {
    try {
      return await openaiText({ messages: opts.messages, temperature: opts.temperature });
    } catch (e) {
      console.error("OpenAI falhou; caindo para o Gemini.", e instanceof Error ? e.message : e);
    }
  }
  return await geminiText({ messages: opts.messages, temperature: opts.temperature });
}

/**
 * Saída JSON já parseada.
 *
 * Falha de parse cai para o Gemini em vez de estourar — quem chama trata objeto vazio
 * como "não consegui rotear", que já tem caminho próprio.
 */
export async function gerarJSON<T = unknown>(opts: OpcoesLLM): Promise<T> {
  if (temOpenAI()) {
    try {
      return await openaiJSON<T>({ messages: opts.messages, temperature: opts.temperature, json: true });
    } catch (e) {
      console.error("OpenAI falhou; caindo para o Gemini.", e instanceof Error ? e.message : e);
    }
  }
  return await geminiJSON<T>({ messages: opts.messages, temperature: opts.temperature });
}
