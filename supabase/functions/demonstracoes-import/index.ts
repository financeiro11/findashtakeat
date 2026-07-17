// Edge Function: demonstracoes-import
// Recebe o DRE e/ou DFC já PARSEADOS (client-side, em DFC.tsx/DRE.tsx, via xlsx) de um
// import de Excel/CSV do tracker fechado, e grava em `demonstracoes_contabeis` através de
// `salvarDemonstracao` — que mescla célula a célula com o que já existe (não substitui o
// blob inteiro) e TRANCA (`demonstracoes_mes_trancado`) os meses recém-importados: a partir
// daí, o omie-sync nunca mais sobrescreve esses meses, só os que ainda estão abertos.
//
// Body: { dre?: { columns: string[], rows: object[] }, dfc?: { columns: string[], rows: object[] } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { salvarDemonstracao, type Dados } from "../_shared/demonstracoes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function validaDados(d: unknown): d is Dados {
  return !!d && typeof d === "object" && Array.isArray((d as any).columns) && Array.isArray((d as any).rows);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dre = body?.dre;
    const dfc = body?.dfc;
    if (!validaDados(dre) && !validaDados(dfc)) {
      return json({ error: "Nada para importar (dre/dfc ausentes ou inválidos)." }, 200);
    }

    let dreSalvo: Dados | null = null;
    let dfcSalvo: Dados | null = null;
    if (validaDados(dre)) dreSalvo = await salvarDemonstracao(supabase, "dre", dre, { travar: true });
    if (validaDados(dfc)) dfcSalvo = await salvarDemonstracao(supabase, "dfc", dfc, { travar: true });

    return json({
      ok: true,
      dre_linhas: dreSalvo?.rows.length ?? 0,
      dfc_linhas: dfcSalvo?.rows.length ?? 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("demonstracoes-import error:", msg);
    return json({ error: msg }, 200);
  }
});
