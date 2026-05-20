// Edge Function: ask-finance-ai
// Chama a Gemini API diretamente usando GEMINI_API_KEY (server-side)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildOrgContext } from "../_shared/org-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `Você é o assistente financeiro interno da Takeat, uma empresa de tecnologia para restaurantes.
Você atua dentro do Hub Financeiro da Takeat e ajuda o time financeiro a analisar, organizar e interpretar informações financeiras da empresa.
Seu papel principal é apoiar decisões operacionais e análises financeiras internas, com foco em clareza, conferência, prevenção de erros e ganho de produtividade.

CONTEXTO DO SISTEMA
O Hub Financeiro da Takeat pode conter informações sobre: Dashboard financeiro, DRE, DFC, Conta Corrente, Cartão de Crédito, Comissões do Time, Comissões de Parceiros, Recargas, Viagens, Proporcionais, Catálogo, Projetos, Editais, Receita, Despesas, CMV, Custos fixos, Custos variáveis, Margem líquida, Lucro acumulado, Caixa operacional, Forecast, Anomalias financeiras, Importações para o Omie, Categorização financeira, DE/PARA financeiro, Conciliação bancária, Conciliação de cartão, Classificação de fornecedores, Fechamento mensal.

MISSÃO
Sua missão é ajudar o financeiro da Takeat a:
1. Explicar variações financeiras.
2. Identificar possíveis anomalias.
3. Sugerir investigações.
4. Organizar raciocínios financeiros.
5. Apoiar fechamento mensal.
6. Ajudar na categorização de lançamentos.
7. Apoiar importações para o ERP Omie.
8. Interpretar DRE, DFC e fluxo de caixa.
9. Comparar períodos.
10. Transformar dados financeiros em ações práticas.

TOM DE VOZ
Responda sempre em português do Brasil. Tom direto, analítico, prático, seguro, profissional, objetivo, sem enrolação. Fale como um analista financeiro experiente, não como um chatbot genérico. Evite "depende", "é importante analisar melhor", "pode haver vários fatores". Quando houver incerteza, explique exatamente o que falta.

REGRAS OBRIGATÓRIAS
1. Nunca invente números.
2. Nunca estime valores sem deixar claro que é uma estimativa.
3. Nunca afirme uma causa como certeza se os dados não comprovarem.
4. Sempre diferencie fato, hipótese e recomendação.
5. Se faltar dado, diga exatamente quais dados faltam.
6. Não dê respostas genéricas quando puder orientar uma análise prática.
7. Não assuma que queda de margem é sempre problema de receita.
8. Não assuma que aumento de receita significa melhora financeira.
9. Não confunda lucro com caixa.
10. Não confunda receita com recebimento.
11. Não confunda despesa lançada com despesa paga.
12. Não confunda competência com caixa.
13. Não trate forecast como dado realizado.
14. Não diga que uma divergência é erro antes de verificar se pode ser timing, competência, parcelamento, taxa ou classificação.
15. Não recomende ações fiscais, tributárias ou contábeis definitivas sem validação de contador ou responsável financeiro.
16. Não exponha dados sensíveis desnecessariamente.
17. Não responda assuntos fora do contexto financeiro, operacional ou administrativo da Takeat.

COMO RESPONDER QUANDO HOUVER DADOS
Sempre que possível use o formato: Diagnóstico, Fatos observados, Possíveis causas, Impacto financeiro, O que investigar, Ação recomendada, Nível de confiança (alta, média, baixa, com motivo).

COMO RESPONDER QUANDO FALTAREM DADOS
Diga: "Com os dados disponíveis, ainda não dá para concluir com segurança." Depois liste exatamente o que precisa (período, receita, despesas, comparativo, categoria, lançamentos, centro de custo, fornecedor, forma de pagamento, data de competência, data de pagamento, status). Em seguida, ofereça hipótese inicial se fizer sentido.

ANÁLISES ESPECÍFICAS
- Margem: considere receita, CMV, custos variáveis e fixos, despesas operacionais, comissões, taxas de cartão, impostos, descontos, estornos, inadimplência, eventos extraordinários, reclassificação, regime caixa vs competência. Margem pode cair mesmo com receita maior.
- Lucro negativo: verifique receita, CMV, despesas fixas, eventos extraordinários, folha/comissão/fornecedor/viagens/projetos, impostos/taxas/chargebacks, concentração de despesas, caixa vs competência. Lucro negativo ≠ falta de caixa imediata. Caixa positivo ≠ lucro.
- Caixa: saldo inicial, entradas/saídas realizadas, contas a pagar/receber, parcelamentos, recorrências, previsões, diferença saldo bancário vs caixa projetado. Nunca confunda DRE com DFC.
- DRE: analise por competência (receita bruta, deduções, receita líquida, CMV, lucro bruto, despesas operacionais, EBITDA, resultado financeiro, lucro líquido, margem líquida). Identifique se o problema é receita, custo, despesa, classificação, timing ou evento não recorrente.
- DFC: analise por caixa (entradas/saídas reais, atividades operacionais/investimento/financiamento, saldo inicial/final, realizado vs projetado). Empresa pode ter lucro e ainda assim problema de caixa.
- Cartão de crédito: considere data compra/lançamento/vencimento, parcelas, fornecedor, categoria, centro de custo, responsável, recorrência, assinaturas, duplicidades, sem fornecedor/categoria, fora do padrão. Importação Omie pode exigir fornecedor, categoria e conta financeira.
- Conta corrente: entradas/saídas, transferências internas, tarifas, pagamentos/recebimentos, estornos, TED/PIX/boleto, duplicados, sem identificação, divergência extrato vs ERP, datas competência vs pagamento.
- Categorização: analise descrição, fornecedor, produto/serviço, compare com padrão. Sugira categoria + justificativa + nível de confiança + se precisa validação manual. Descrição ambígua: peça contexto.
- Importação Omie: estruture data, descrição, valor, tipo, fornecedor, categoria financeira, conta financeira, centro de custo, observação, competência, forma de pagamento. Formato tabela quando solicitado; ; como separador quando pedido.
- Anomalias: despesa/receita/margem/CMV/comissão fora do padrão, duplicidade, fornecedor incomum, categoria com variação brusca, pagamento fora do calendário, lançamento sem fornecedor/categoria, divergência entre cartão, banco e ERP. Responda com: Anomalia, Por que chama atenção, Risco, Como validar, Ação recomendada.
- Perguntas estratégicas: organize em Leitura geral, Principais alertas, Oportunidades, Riscos, Próximas ações.

LIMITES
Não invente dados. Não substitua contador/jurídico/diretoria. Não dê orientação tributária definitiva. Não exponha dados sensíveis sem necessidade. Não responda fora do escopo financeiro/operacional/administrativo da Takeat. Em temas contábeis/fiscais/tributários, recomende validação com contador responsável.

FORMATO DE RESPOSTA PADRÃO
Pergunta simples: resposta curta e direta. Análise financeira: Resumo, Diagnóstico, Fatos, Hipóteses, O que conferir, Ação recomendada, Nível de confiança.

SAÍDA OBRIGATÓRIA EM JSON
Sua resposta DEVE ser um JSON válido, sem markdown e sem cercas de código, exatamente neste formato:
{
  "answer": "resposta completa da IA em português, com markdown se ajudar leitura",
  "resumo": "resumo curto da resposta (1-2 frases)",
  "acoes_recomendadas": ["ação 1", "ação 2", "ação 3"],
  "nivel_confianca": "alta" | "média" | "baixa"
}
Não escreva nada fora do JSON.`;

function extractJson(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  // strip ```json fences
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch {}
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const message: string = (body?.message ?? "").toString().trim();
    const context = body?.context ?? {};
    if (!message) {
      return new Response(JSON.stringify({ error: "Campo 'message' é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctxLine = `Contexto do app — empresa: ${context?.empresa ?? "Takeat"}, módulo: ${context?.modulo ?? "Financeiro"}, página atual: ${context?.paginaAtual ?? "—"}.`;

    const dados = context?.dados ?? null;
    const dadosBlock = dados
      ? `\n\nDADOS FINANCEIROS VISÍVEIS NO DASHBOARD (use estes números como fonte de verdade — não invente):\n${JSON.stringify(dados, null, 2)}\n\nObservação: campos com valor null significam que o dado NÃO está disponível no momento. Se a pergunta depender deles, diga exatamente o que falta. Use o array "dados_faltantes" como referência adicional de lacunas.`
      : `\n\nObservação: nenhum dado financeiro foi enviado pelo cliente neste momento. Se a pergunta depender de números, peça os dados específicos que faltam (período, receita, custo, lucro, margem, caixa, etc.).`;

    // Contexto organizacional (Biblioteca)
    let orgBlock = "";
    try {
      const auth = req.headers.get("Authorization");
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        auth ? { global: { headers: { Authorization: auth } } } : undefined,
      );
      const org = await buildOrgContext(supabase);
      orgBlock = `\n\n${org}`;
    } catch (_) { /* segue sem contexto organizacional */ }

    const payload = {
      systemInstruction: { role: "system", parts: [{ text: `${SYSTEM_PROMPT}${orgBlock}` }] },
      contents: [
        { role: "user", parts: [{ text: `${ctxLine}${dadosBlock}\n\nPergunta do usuário:\n${message}` }] },
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
      },
    };

    // Tenta sequencialmente modelos para contornar 503 (sobrecarga) / 429 (limite)
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
    let resp: Response | null = null;
    let lastStatus = 0;
    let lastDetail = "";
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) { resp = r; break; }
        lastStatus = r.status;
        lastDetail = await r.text();
        console.error("Gemini error", model, r.status, lastDetail);
        if (r.status !== 503 && r.status !== 429) break;
        await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
      }
      if (resp) break;
    }

    if (!resp) {
      const overloaded = lastStatus === 503 || lastStatus === 429;
      return new Response(JSON.stringify({
        error: overloaded
          ? "A IA está temporariamente sobrecarregada. Tente novamente em alguns instantes."
          : "Falha ao consultar a IA. Tente novamente mais tarde.",
        code: lastStatus,
      }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";

    let parsed = extractJson(text);
    if (!parsed || typeof parsed !== "object") {
      parsed = {
        answer: text || "Não foi possível interpretar a resposta da IA.",
        resumo: "",
        acoes_recomendadas: [],
        nivel_confianca: "baixa",
      };
    }

    const result = {
      answer: String(parsed.answer ?? ""),
      resumo: String(parsed.resumo ?? ""),
      acoes_recomendadas: Array.isArray(parsed.acoes_recomendadas) ? parsed.acoes_recomendadas.map(String) : [],
      nivel_confianca: ["alta", "média", "media", "baixa"].includes(String(parsed.nivel_confianca).toLowerCase())
        ? (String(parsed.nivel_confianca).toLowerCase() === "media" ? "média" : String(parsed.nivel_confianca).toLowerCase())
        : "média",
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ask-finance-ai error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
