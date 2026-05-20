import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type ChatMessage, corsHeaders, errorResponse, handleCors,
  jsonResponse, streamAsOpenAISSE,
} from "../_shared/gemini.ts";
import { buildOrgContext } from "../_shared/org-context.ts";

type Msg = ChatMessage;

async function buildContext(supabase: any): Promise<string> {
  const parts: string[] = [];
  const { data: dem } = await supabase
    .from("demonstracoes_contabeis")
    .select("tipo,periodo,dados,observacao,updated_at")
    .order("updated_at", { ascending: false });
  const byTipo: Record<string, any[]> = {};
  for (const d of dem ?? []) (byTipo[d.tipo] ||= []).push(d);
  for (const tipo of Object.keys(byTipo)) {
    for (const d of byTipo[tipo].slice(0, 6)) {
      const rows = Array.isArray(d.dados) ? d.dados.slice(0, 200) : d.dados;
      parts.push(`### ${tipo.toUpperCase()} — período ${d.periodo}${d.observacao ? ` (${d.observacao})` : ""}\n${JSON.stringify(rows)}`);
    }
  }
  const { data: ed } = await supabase.from("editais").select("titulo,orgao,modalidade,numero,objeto,valor_estimado,data_publicacao,data_abertura,prazo_envio,status,responsavel,observacao").limit(100);
  if (ed?.length) parts.push(`### Editais\n${JSON.stringify(ed)}`);
  const { data: bk } = await supabase.from("base_conhecimento").select("titulo,tipo,conteudo").limit(40);
  if (bk?.length) parts.push(`### Base de Conhecimento\n${bk.map((b: any) => `- [${b.tipo}] ${b.titulo}: ${b.conteudo}`).join("\n")}`);
  const { data: cen } = await supabase.from("cenarios").select("nome,descricao,premissas,analise").limit(10);
  if (cen?.length) parts.push(`### Cenários\n${JSON.stringify(cen)}`);
  const { data: bp } = await supabase.from("bp_anual").select("ano,dados,observacao").limit(5);
  if (bp?.length) parts.push(`### BP Anual\n${JSON.stringify(bp)}`);
  const { data: hist } = await supabase.from("historico_financeiro").select("metrica,ano,mes,valor,origem").order("ano").order("mes").limit(5000);
  if (hist?.length) {
    const agg = new Map<string, number>();
    for (const r of hist as any[]) {
      const k = `${r.metrica}|${r.ano}`;
      agg.set(k, (agg.get(k) || 0) + Number(r.valor));
    }
    const resumo = Array.from(agg.entries()).map(([k, v]) => {
      const [metrica, ano] = k.split("|");
      return { metrica, ano: +ano, total: v };
    });
    parts.push(`### Histórico Financeiro (totais por ano)\n${JSON.stringify(resumo)}`);
    parts.push(`### Histórico Financeiro (mensal, primeiros 1500)\n${JSON.stringify((hist as any[]).slice(0, 1500))}`);
  }
  return parts.join("\n\n");
}

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
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);

    const { messages } = await req.json() as { messages: Msg[] };
    if (!Array.isArray(messages) || messages.length === 0) return jsonResponse({ error: "messages obrigatório" }, 400);

    const [ctx, org] = await Promise.all([buildContext(supabase), buildOrgContext(supabase)]);
    const system = `Você é o assistente financeiro da Takeat. Responda em português brasileiro, direto, com números formatados em R$ e %. Use markdown e bullet points quando ajudar a leitura. Você tem acesso a TODOS os dados da empresa: DRE, DFC, Balancete, Balanço, BP Anual, Cenários, Histórico Financeiro, Editais, Base de Conhecimento e ao contexto organizacional (Biblioteca: colaboradores, departamentos, fornecedores, políticas). Baseie-se SEMPRE nos dados reais abaixo. Se a informação não estiver disponível, diga claramente.\n\n${org}\n\n=== DADOS FINANCEIROS ===\n${ctx}`;

    return await streamAsOpenAISSE({
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.4,
    });
  } catch (e) {
    return errorResponse(e);
  }
});
