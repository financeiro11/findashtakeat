import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { errorResponse, generateJSON, handleCors, jsonResponse } from "../_shared/gemini.ts";
import { buildOrgContext } from "../_shared/org-context.ts";

Deno.serve(async (req) => {
  const pre = handleCors(req); if (pre) return pre;
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const token = auth.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    if (userErr || !userId) return jsonResponse({ error: "Unauthorized" }, 401);

    const { force } = await req.json().catch(() => ({ force: false }));
    const today = new Date().toISOString().slice(0, 10);

    if (!force) {
      const { data: cache } = await supabase.from("ai_dashboard_cache").select("insights,created_at").eq("user_id", userId).eq("periodo", today).maybeSingle();
      if (cache) return jsonResponse({ insights: cache.insights, cached: true });
    }

    const { data: dem } = await supabase.from("demonstracoes_contabeis").select("tipo,dados,periodo,updated_at").order("updated_at", { ascending: false });
    const dre = dem?.find((d: any) => d.tipo === "dre");
    const dfc = dem?.find((d: any) => d.tipo === "dfc");
    if (!dre && !dfc) return jsonResponse({ insights: [] });

    const { data: bp } = await supabase.from("bp_anual").select("ano,dados").order("ano", { ascending: false }).limit(1).maybeSingle();

    const org = await buildOrgContext(supabase);
    let parsed: { insights: Array<{ titulo: string; texto: string; tom: string }> };
    try {
      parsed = await generateJSON({
        messages: [
          { role: "system", content: `Você é analista financeiro sênior da Takeat. Gere 4 insights analíticos (3-4 linhas cada), em português, comentando os dados financeiros REAIS (DRE e DFC) e comparando com o ORÇADO do BP Anual quando disponível. Foque em: 1) Receita vs orçado e tendência, 2) Margem/EBITDA e drivers, 3) Caixa/DFC (atividades operacional, investimento, financiamento), 4) Cashburn/runway e risco. Cite valores específicos, % vs orçado, áreas ou centros de custo reais quando ajudar. Seja objetivo e acionável — não genérico. Retorne JSON: { insights: [{titulo, texto, tom}] } onde tom ∈ positivo|neutro|alerta.\n\n${org}` },
          { role: "user", content: `DRE (período ${dre?.periodo ?? "n/d"}):\n${JSON.stringify(dre?.dados ?? []).slice(0, 8000)}\n\nDFC (período ${dfc?.periodo ?? "n/d"}):\n${JSON.stringify(dfc?.dados ?? []).slice(0, 6000)}\n\nBP Anual ${bp?.ano ?? ""} (orçado):\n${JSON.stringify(bp?.dados ?? []).slice(0, 6000)}` },
        ],
        temperature: 0.3,
        responseSchema: {
          type: "object",
          properties: {
            insights: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  titulo: { type: "string" },
                  texto: { type: "string" },
                  tom: { type: "string", enum: ["positivo", "neutro", "alerta"] },
                },
                required: ["titulo", "texto", "tom"],
              },
            },
          },
          required: ["insights"],
        },
      });
    } catch (e) {
      console.error(e);
      return jsonResponse({ insights: [], cached: false, degraded: true, reason: "ai_error" });
    }

    await supabase.from("ai_dashboard_cache").delete().eq("user_id", userId).eq("periodo", today);
    await supabase.from("ai_dashboard_cache").insert({ user_id: userId, periodo: today, insights: parsed.insights });

    return jsonResponse({ insights: parsed.insights, cached: false });
  } catch (e) {
    return errorResponse(e);
  }
});
