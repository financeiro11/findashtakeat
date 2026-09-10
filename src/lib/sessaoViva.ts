/* ---------------------------------------------------------------------------
 * Sessão zumbi: o token ainda vale, mas a sessão já morreu no servidor.
 *
 * `supabase.auth.signOut()` é GLOBAL por padrão — derruba TODAS as sessões
 * daquela pessoa — e `admin-reset-password` faz o mesmo de propósito. Basta
 * então alguém sair (ou trocar de conta) NUMA aba, ou ter a senha redefinida,
 * para as OUTRAS abas ficarem com um JWT órfão.
 *
 * O JWT órfão não parece quebrado: continua assinado e dentro da validade, e o
 * PostgREST — que só confere assinatura e `exp` — aceita tudo. A tela segue
 * carregando, ninguém é mandado para o /login. Quem recusa é o GoTrue, que
 * confere a sessão de verdade: o `GET /user` volta 403 `session_not_found`. Como
 * TODA Edge Function passa por `requireUser` (que chama `getUser`), o sintoma é
 * só este: gravar qualquer coisa responde "Não autenticado." numa tela
 * obviamente logada, e o resto da página continua funcionando. Foi o que travou
 * o valor manual da DRE em 09/09/2026 — sete tentativas de salvar, todas
 * recusadas, sem nada na tela explicando o porquê.
 * ------------------------------------------------------------------------- */

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Mensagem com que `_shared/auth.ts` recusa um chamador sem sessão. */
export function ehSessaoMorta(msg: string): boolean {
  return /n[ãa]o autenticado/i.test(msg);
}

let conferindo = false;
let conferidoEm = 0;

/**
 * Pergunta ao GoTrue se a sessão desta aba ainda existe. Se não existir, sai
 * localmente — o AppLayout leva para o /login, guardando o destino.
 *
 * Só derruba em recusa do GoTrue (ver `morreu`): falha de rede não pode
 * expulsar ninguém de uma sessão que provavelmente está viva. Devolve `true`
 * quando a sessão acabou.
 *
 * @param agora ignora o intervalo mínimo entre conferências — é o caso de quem
 *   ACABOU de levar um "Não autenticado." de uma Edge Function e precisa da
 *   resposta nesta interação, não na próxima.
 */
export async function conferirSessao({ agora = false } = {}): Promise<boolean> {
  if (conferindo) return false;
  if (!agora && Date.now() - conferidoEm < 60_000) return false;

  // Sem sessão guardada não há zumbi: o AppLayout já manda para o /login.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  conferindo = true;
  try {
    const { error } = await supabase.auth.getUser();
    conferidoEm = Date.now();
    if (!error || !morreu(error)) return false;
    /* O supabase-js JÁ apaga a sessão sozinho neste caso — o que faltava era
       alguém PERGUNTAR, porque nada na tela chama `getUser`. Sair de novo, em
       `scope: "local"`, é o cinto: a sessão do servidor não existe mais, então
       um logout global só devolveria outro erro e deixaria o token na gaveta. */
    await supabase.auth.signOut({ scope: "local" });
    toast.error("Sua sessão foi encerrada em outro lugar. Entre de novo para continuar.");
    return true;
  } finally {
    conferindo = false;
  }
}

/**
 * A recusa quer dizer "esta sessão acabou"?
 *
 * `session_not_found` — o caso desta história — chega como
 * `AuthSessionMissingError`, e o **status dele é 400**, não 403: filtrar por
 * status deixaria passar justamente o erro que motivou o arquivo. Os 401/403
 * cobrem o resto (JWT malformado, chave errada). Falha de rede
 * (`AuthRetryableFetchError`, status 0) e 429 ficam de fora de propósito: não
 * se expulsa ninguém de uma sessão que provavelmente está viva.
 */
function morreu(error: { status?: number }): boolean {
  return isAuthSessionMissingError(error) || error.status === 401 || error.status === 403;
}
