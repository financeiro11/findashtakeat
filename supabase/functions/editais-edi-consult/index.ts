// EDI - Consultor IA dos Projetos Aprovados
// Recebe uma pergunta + snapshot dos projetos/rubricas/compras e responde via Gemini.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `Você é o EDI — Consultor IA de Editais e Projetos Aprovados da Takeat.
Sua missão é apoiar o time financeiro a decidir o que pode ser pago por cada edital, identificar riscos de execução de rubricas, lançamentos sem NF e saldo disponível por projeto.

REGRAS:
- Responda em português do Brasil, direto, com no máximo 6 linhas e bullets curtos.
- Use markdown leve (negrito **assim**, listas com "-").
- Use SOMENTE os dados enviados em DADOS. Não invente valores nem nomes de projetos/rubricas.
- Formate valores como R$ X.XXX,XX (use os números brutos vindos em DADOS).
- Quando a pergunta for "posso pagar X pelo projeto Y": avalie a rubrica mais provável (terceiros/serviços PJ/material), o saldo livre da rubrica e se há reserva obrigatória; conclua com SIM/NÃO/DEPENDE e justifique em 1 linha.
- Quando faltar dado para concluir, diga exatamente o que falta.
- Nunca exponha IDs internos.`;

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
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
    const pergunta: string = (body?.pergunta ?? "").toString().trim();
    if (!pergunta) {
      return new Response(JSON.stringify({ error: "Campo 'pergunta' é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carregar dados do banco usando service role para garantir leitura completa
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [pRes, rRes, cRes] = await Promise.all([
      supabase.from("projetos_aprovados").select("id,nome,orgao,status,prazo_final").order("ordem"),
      supabase.from("projetos_aprovados_rubricas").select("id,projeto_id,parent_id,categoria,valor_planejado,obrigatorio").order("ordem"),
      supabase.from("projetos_aprovados_compras").select("rubrica_id,descricao,valor,status,nf_anexada,fornecedor"),
    ]);

    const projetos = pRes.data ?? [];
    const rubricas = rRes.data ?? [];
    const compras = (cRes.data ?? []).filter((c: any) => c.status !== "Cancelada");

    // Construir snapshot compacto, sem IDs
    const snapshot = projetos.map((p: any) => {
      const rubs = rubricas.filter((r: any) => r.projeto_id === p.id);
      const tops = rubs.filter((r: any) => !r.parent_id);
      const buildRub = (rb: any): any => {
        const filhos = rubs.filter((x: any) => x.parent_id === rb.id);
        const gastoDireto = compras
          .filter((c: any) => c.rubrica_id === rb.id)
          .reduce((s: number, c: any) => s + Number(c.valor || 0), 0);
        const pendNF = compras.filter((c: any) => c.rubrica_id === rb.id && !c.nf_anexada).length;
        const lancamentos = compras
          .filter((c: any) => c.rubrica_id === rb.id)
          .map((c: any) => ({
            descricao: c.descricao,
            fornecedor: c.fornecedor,
            valor: Number(c.valor || 0),
            nf: !!c.nf_anexada,
          }));
        const subs = filhos.map(buildRub);
        const gastoTotal = gastoDireto + subs.reduce((s: number, x: any) => s + x.gasto, 0);
        const planejado = Number(rb.valor_planejado || 0);
        return {
          rubrica: rb.categoria,
          obrigatorio: !!rb.obrigatorio,
          planejado,
          gasto: gastoTotal,
          saldo: planejado - gastoTotal,
          pct_executado: planejado > 0 ? Math.round((gastoTotal / planejado) * 100) : 0,
          pendencias_sem_nf: pendNF + subs.reduce((s: number, x: any) => s + (x.pendencias_sem_nf || 0), 0),
          subcategorias: subs.length ? subs : undefined,
          lancamentos: lancamentos.length ? lancamentos.slice(0, 20) : undefined,
        };
      };
      return {
        projeto: p.nome,
        orgao: p.orgao,
        status: p.status,
        prazo_final: p.prazo_final,
        rubricas: tops.map(buildRub),
      };
    });

    const dadosBlock = `DADOS (fonte de verdade — JSON):\n${JSON.stringify(snapshot, null, 2)}`;

    const payload = {
      systemInstruction: { role: "system", parts: [{ text: SYSTEM }] },
      contents: [
        { role: "user", parts: [{ text: `${dadosBlock}\n\nPergunta: ${pergunta}` }] },
      ],
      generationConfig: { temperature: 0.3 },
    };

    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
    let text = "";
    let lastStatus = 0;
    let lastDetail = "";
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        lastStatus = r.status;
        lastDetail = await r.text();
        console.error("Gemini error", model, r.status, lastDetail);
        if (r.status !== 503 && r.status !== 429) break;
        continue;
      }
      const data = await r.json();
      text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
      break;
    }

    if (!text) {
      const overloaded = lastStatus === 503 || lastStatus === 429;
      return new Response(JSON.stringify({
        error: overloaded
          ? "A IA está temporariamente sobrecarregada. Tente novamente em instantes."
          : "Falha ao consultar a IA.",
        code: lastStatus,
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ answer: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("editais-edi-consult error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
