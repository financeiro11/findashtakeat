import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { errorResponse, generateJSON, handleCors, jsonResponse } from "../_shared/gemini.ts";

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
    const { data: userData, error: userErr } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { cenario_id, premissas, meses_projecao = 12 } = body;
    if (!cenario_id || !premissas) return jsonResponse({ error: "cenario_id e premissas obrigatórios" }, 400);

    const { data: dem } = await supabase
      .from("demonstracoes_contabeis")
      .select("tipo, periodo, dados")
      .in("tipo", ["dre", "dfc"])
      .order("periodo", { ascending: false })
      .limit(24);
    const { data: bp } = await supabase.from("bp_anual").select("ano, dados").order("ano", { ascending: false }).limit(2);
    const { data: bk } = await supabase.from("base_conhecimento").select("titulo, conteudo, tipo").limit(20);

    const contexto = {
      historico_dre_dfc: dem ?? [],
      bp_anual: bp ?? [],
      base_conhecimento: (bk ?? []).map((d: any) => ({ titulo: d.titulo, tipo: d.tipo, conteudo: String(d.conteudo).slice(0, 4000) })),
    };

    const systemPrompt = `Você é um analista FP&A sênior da Takeat. Receberá histórico de DRE/DFC, o Budget Plan (BP) anual, base de conhecimento da empresa e premissas de cenário. Cada premissa pode vir com frequência ("mensal" ou "anual"). Gere: (1) projeção mensal estruturada (${meses_projecao} meses), (2) sensibilidade por variável (±10% sobre EBITDA acumulado), (3) análise textual em markdown PT-BR, (4) lista de 3 a 6 gráficos sugeridos com os drivers mais relevantes.`;
    const userPrompt = `PREMISSAS:\n${JSON.stringify(premissas, null, 2)}\n\nCONTEXTO:\n${JSON.stringify(contexto).slice(0, 60000)}`;

    const parsed = await generateJSON<any>({
      model: "gemini-2.5-pro",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      responseSchema: {
        type: "object",
        properties: {
          projecao_mensal: {
            type: "array",
            items: {
              type: "object",
              properties: {
                mes: { type: "string" },
                receita: { type: "number" },
                custos: { type: "number" },
                despesas: { type: "number" },
                ebitda: { type: "number" },
                resultado_liquido: { type: "number" },
                fluxo_caixa: { type: "number" },
              },
              required: ["mes", "receita", "custos", "despesas", "ebitda", "resultado_liquido", "fluxo_caixa"],
            },
          },
          sensibilidade: {
            type: "array",
            items: {
              type: "object",
              properties: {
                variavel: { type: "string" },
                impacto_pos_10pct: { type: "number" },
                impacto_neg_10pct: { type: "number" },
                comentario: { type: "string" },
              },
              required: ["variavel", "impacto_pos_10pct", "impacto_neg_10pct", "comentario"],
            },
          },
          analise: { type: "string" },
          graficos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                titulo: { type: "string" },
                descricao: { type: "string" },
                tipo: { type: "string", enum: ["line", "area", "bar"] },
                series: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { campo: { type: "string" }, rotulo: { type: "string" } },
                    required: ["campo", "rotulo"],
                  },
                },
              },
              required: ["titulo", "descricao", "tipo", "series"],
            },
          },
        },
        required: ["projecao_mensal", "sensibilidade", "analise", "graficos"],
      },
    });

    const { error: upErr } = await supabase.from("cenarios").update({
      projecao: parsed.projecao_mensal,
      sensibilidade: parsed.sensibilidade,
      analise: parsed.analise,
      graficos: parsed.graficos ?? null,
    }).eq("id", cenario_id);
    if (upErr) throw upErr;

    return jsonResponse({ ok: true, ...parsed });
  } catch (e) {
    return errorResponse(e);
  }
});
