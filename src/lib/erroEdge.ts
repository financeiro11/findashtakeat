/**
 * O QUE A EDGE FUNCTION REALMENTE DISSE.
 *
 * `supabase.functions.invoke` embrulha qualquer resposta non-2xx num
 * `FunctionsHttpError` cuja `message` é SEMPRE a mesma frase:
 *
 *     "Edge Function returned a non-2xx status code"
 *
 * O motivo de verdade — "Credenciais do Omie ausentes", "o gateway do Supabase
 * respondeu 520", "mês fechado no ERP" — está no CORPO, em `error.context`, que
 * é um `Response` ainda não lido. Sem desembrulhar, quem clicou no botão recebe
 * uma frase que não permite fazer nada a respeito: não dá para saber se é para
 * tentar de novo, avisar alguém ou abrir o Omie.
 *
 * Isto estava escrito seis vezes no repositório, cada uma com um recorte
 * diferente do corpo. Aqui é uma vez só, e o corpo é lido nas duas convenções
 * que as funções deste projeto usam: `{ erro }` (pt-BR, as mais novas) e
 * `{ error }` (as antigas).
 */

/** O formato do que o supabase-js entrega: a mensagem genérica e o corpo cru. */
type ErroDeFuncao = { message?: string; context?: { text?: () => Promise<string> } };

/** O corpo do erro, lido como texto. `Response` só pode ser lido uma vez. */
async function corpoDoErro(error: unknown): Promise<string> {
  const ctx = (error as ErroDeFuncao | null)?.context;
  if (typeof ctx?.text !== "function") return "";
  try { return String(await ctx.text()); } catch { return ""; }
}

/**
 * A mensagem para o toast: a do corpo quando existe, a do erro quando não.
 *
 * @param error   o que veio em `{ error }` do invoke
 * @param limite  corte do texto — toast não é log
 */
export async function mensagemDaFuncao(error: unknown, limite = 400): Promise<string> {
  const bruto = (await corpoDoErro(error)).trim();
  const padrao = String((error as ErroDeFuncao | null)?.message ?? error ?? "Falhou sem dizer por quê.");

  if (!bruto) return padrao.slice(0, limite);

  try {
    const j = JSON.parse(bruto);
    const msg = j?.erro ?? j?.error ?? j?.message;
    if (msg) return String(msg).slice(0, limite);
  } catch { /* o corpo não era JSON — vale como texto */ }

  return bruto.slice(0, limite);
}

/**
 * O invoke inteiro, já com o erro legível e com o `{ erro }` do corpo 200.
 *
 * Função que devolve 200 com `{ erro }` dentro é comum aqui (a varredura faz
 * isso quando quer relatar sem falhar a requisição); tratar só o status deixaria
 * esse caso passar como sucesso silencioso.
 */
export async function invocar<T = unknown>(
  invoke: Promise<{ data: unknown; error: unknown }>,
): Promise<T> {
  const { data, error } = await invoke;
  if (error) throw new Error(await mensagemDaFuncao(error));

  const corpo = data as { erro?: unknown; error?: unknown } | null;
  if (corpo?.erro) throw new Error(String(corpo.erro));
  if (corpo?.error) throw new Error(String(corpo.error));
  return data as T;
}
