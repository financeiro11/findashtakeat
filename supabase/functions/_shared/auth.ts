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
  if (jwtRole(token) === "service_role") return { userId: null, cargo: "", perfil: "", isService: true };

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new AuthError("Não autenticado."); // anon key ou token inválido

  const { data: prof } = await admin
    .from("profiles").select("cargo, perfil").eq("user_id", data.user.id).maybeSingle();
  const cargo = (prof?.cargo ?? "").trim().toLowerCase();
  const perfil = (prof?.perfil ?? "").trim().toLowerCase();

  if (opts.bloquearCargos?.map((c) => c.toLowerCase()).includes(cargo)) {
    throw new AuthError("Você não tem permissão para esta ação.");
  }
  // Lista de quem PODE. Perfil vazio (conta sem acesso definido) nunca passa —
  // é o mesmo padrão do front: o que não se reconhece, não entra.
  if (opts.exigirPerfis && !opts.exigirPerfis.map((p) => p.toLowerCase()).includes(perfil)) {
    throw new AuthError("Você não tem permissão para esta ação.");
  }

  return { userId: data.user.id, cargo, perfil, isService: false, email: data.user.email ?? null };
}
