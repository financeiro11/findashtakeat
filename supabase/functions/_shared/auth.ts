// Guard de autenticação para Edge Functions.
//
// Contexto: as Edge Functions rodam com a SERVICE ROLE (ignora RLS) e o gateway do
// Supabase aceita qualquer JWT válido — INCLUSIVE a anon key, que é pública (está no
// bundle do front). Sem checagem interna, qualquer pessoa na internet com a anon key
// consegue chamar a função. Este guard exige um chamador de verdade:
//   • um USUÁRIO logado (token de sessão) — opcionalmente bloqueando cargos; ou
//   • a SERVICE ROLE KEY (chamadas de sistema/cron) — segredo, nunca exposta.
// A anon key sozinha é rejeitada.
//
// A versão do supabase-js é FIXA: com `@2` solto, o bundler do Deno resolve a
// última do dia e já quebrou o deploy ("Module not found" num submódulo do
// postgrest 2.112.2). 2.45.0 é a que as outras funções deste projeto já usam.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface Caller {
  userId: string | null;
  cargo: string;
  /**
   * As capacidades desta conta — a MESMA matriz que a tela de Perfis de acesso
   * grava (`acesso_perfil`), resolvida aqui para a função não repetir a lista.
   *
   * Vazio para service role, que passa por `isService`. Use `pode()`, nunca
   * compare perfis à mão: uma lista repetida numa Edge Function diverge da tela
   * no primeiro ajuste, e ninguém percebe até vazar.
   */
  capacidades: string[];
  /** Esta conta tem a capacidade? Service role tem todas — é o Hub trabalhando. */
  pode: (capacidade: string) => boolean;
  /**
   * O perfil de acesso — a lista FECHADA de src/lib/modules.ts, não o `cargo`,
   * que é texto livre. Vazio para chamadas de service role.
   *
   * Existe desde 10/09/2026: `bloquearCargos` só sabia dizer quem NÃO pode, e
   * quem não pode era uma lista de nomes digitados à mão. Uma função de
   * administração precisa do contrário — dizer quem PODE (ver `exigirPerfis`).
   */
  perfil: string;
  isService: boolean;
  email?: string | null;
}

// Lê a claim `role` do JWT SEM verificar assinatura — seguro porque o gateway
// (verify_jwt) já validou a assinatura antes da função rodar.
function jwtRole(token: string): string | null {
  try {
    const b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b))?.role ?? null;
  } catch { return null; }
}

// Erro do próprio portão (token ausente/inválido ou cargo bloqueado) — marcado para quem
// chama distinguir de um "permission"/"autenticad" que por acaso apareça na mensagem de uma
// API de terceiro (ex.: o Google Sheets devolve "The caller does not have permission", e um
// regex textual solto confundiria isso com falha de login e devolveria 401 pro cliente, que
// descarta o corpo da resposta — foi o que aconteceu com a planilha do Branding em 03/09/2026).
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireUser(
  req: Request,
  opts: { bloquearCargos?: string[]; exigirPerfis?: string[] } = {},
): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) throw new AuthError("Não autenticado.");

  // Chamada de sistema com a service role key (cron/back-office) — permitida.
  if (jwtRole(token) === "service_role") {
    return {
      userId: null, cargo: "", perfil: "", isService: true,
      capacidades: [], pode: () => true,
    };
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new AuthError("Não autenticado."); // anon key ou token inválido

  const { data: prof } = await admin
    .from("profiles").select("cargo, perfil").eq("user_id", data.user.id).maybeSingle();
  const cargo = (prof?.cargo ?? "").trim().toLowerCase();
  const perfil = (prof?.perfil ?? "").trim().toLowerCase();

  /* As capacidades do perfil, da mesma tabela que a tela edita. O `admin` não se
     edita — a linha dele é reescrita cheia por trigger, mas a garantia mora aqui
     também: uma linha estragada no banco não pode trancar quem conserta. */
  let capacidades: string[] = [];
  if (perfil === "admin") {
    capacidades = ["*"];
  } else if (perfil) {
    const { data: linha } = await admin
      .from("acesso_perfil").select("capacidades").eq("perfil", perfil).maybeSingle();
    capacidades = ((linha?.capacidades ?? []) as string[]).map((c) => String(c));
  }
  const pode = (c: string) => capacidades.includes("*") || capacidades.includes(c);

  if (opts.bloquearCargos?.map((c) => c.toLowerCase()).includes(cargo)) {
    throw new AuthError("Você não tem permissão para esta ação.");
  }
  // Lista de quem PODE. Perfil vazio (conta sem acesso definido) nunca passa —
  // é o mesmo padrão do front: o que não se reconhece, não entra.
  if (opts.exigirPerfis && !opts.exigirPerfis.map((p) => p.toLowerCase()).includes(perfil)) {
    throw new AuthError("Você não tem permissão para esta ação.");
  }

  return {
    userId: data.user.id, cargo, perfil, isService: false,
    email: data.user.email ?? null, capacidades, pode,
  };
}
