/**
 * O ENDEREÇO DE UMA EDGE FUNCTION.
 *
 * As chamadas que precisam de streaming (o Assistente lê SSE) não passam pelo
 * `supabase.functions.invoke` — elas montam a URL na mão e usam `fetch`. Isso estava
 * escrito em quatro arquivos, sempre assim:
 *
 *     `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`
 *
 * Em 25/08/26 o chat parou de responder — no celular e no PC — porque a variável na
 * Vercel estava com o sufixo do PostgREST (`…supabase.co/rest/v1/`). O endereço virava
 *
 *     https://…supabase.co/rest/v1//functions/v1/ai-chat
 *
 * que EXISTE: é o PostgREST, e ele responde 401 "No API key found in request". A tela
 * lia o status e dizia "O assistente não conseguiu responder agora" — uma falha de
 * servidor que nunca chegou a servidor nenhum. O resto do Hub continuou inteiro porque
 * `supabase.from(...)` usa o endereço escrito à mão em `integrations/supabase/client.ts`,
 * e não a variável; por isso só o Assistente caiu, e caiu calado.
 *
 * Aqui o endereço vem do MESMO cliente que o `invoke` usa. Enquanto o `invoke` funcionar,
 * este `fetch` aponta para o mesmo lugar — não há mais como os dois divergirem.
 */

import { supabase } from "@/integrations/supabase/client";

/**
 * A raiz do projeto a partir de um endereço qualquer do Supabase: tira o sufixo de API
 * (`/rest/v1`, `/auth/v1`, …) e as barras finais. É o conserto do valor da variável,
 * usado só se o cliente um dia deixar de expor a base das funções.
 */
export function raizSupabase(bruto: string): string {
  return String(bruto ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(rest|auth|storage|functions|realtime)\/v\d+$/, "")
    .replace(/\/+$/, "");
}

/** A base das funções, preferindo a que o próprio cliente resolveu. */
export function baseDasFuncoes(): string {
  const doCliente = (supabase as unknown as { functionsUrl?: URL | string }).functionsUrl;
  if (doCliente) return String(doCliente).replace(/\/+$/, "");
  return `${raizSupabase(import.meta.env.VITE_SUPABASE_URL ?? "")}/functions/v1`;
}

/** `urlDaFuncao("ai-chat")` → `https://<projeto>.supabase.co/functions/v1/ai-chat`. */
export function urlDaFuncao(nome: string): string {
  return `${baseDasFuncoes()}/${String(nome).replace(/^\/+/, "")}`;
}
