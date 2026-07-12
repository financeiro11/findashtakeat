// Guard de autenticação para Edge Functions.
//
// Contexto: as Edge Functions rodam com a SERVICE ROLE (ignora RLS) e o gateway do
// Supabase aceita qualquer JWT válido — INCLUSIVE a anon key, que é pública (está no
// bundle do front). Sem checagem interna, qualquer pessoa na internet com a anon key
// consegue chamar a função. Este guard exige um chamador de verdade:
//   • um USUÁRIO logado (token de sessão) — opcionalmente bloqueando cargos; ou
//   • a SERVICE ROLE KEY (chamadas de sistema/cron) — segredo, nunca exposta.
// A anon key sozinha é rejeitada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface Caller { userId: string | null; cargo: string; isService: boolean; }

// Lê a claim `role` do JWT SEM verificar assinatura — seguro porque o gateway
// (verify_jwt) já validou a assinatura antes da função rodar.
function jwtRole(token: string): string | null {
  try {
    const b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b))?.role ?? null;
  } catch { return null; }
}

export async function requireUser(req: Request, opts: { bloquearCargos?: string[] } = {}): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) throw new Error("Não autenticado.");

  // Chamada de sistema com a service role key (cron/back-office) — permitida.
  if (jwtRole(token) === "service_role") return { userId: null, cargo: "", isService: true };

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Não autenticado."); // anon key ou token inválido

  const { data: prof } = await admin.from("profiles").select("cargo").eq("user_id", data.user.id).maybeSingle();
  const cargo = (prof?.cargo ?? "").trim().toLowerCase();
  if (opts.bloquearCargos?.map((c) => c.toLowerCase()).includes(cargo)) {
    throw new Error("Você não tem permissão para esta ação.");
  }
  return { userId: data.user.id, cargo, isService: false };
}
