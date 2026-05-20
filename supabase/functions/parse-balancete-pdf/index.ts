// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Você é um analista contábil. Recebe o TEXTO BRUTO de um Balancete em PDF (português, BR) e devolve a estrutura contábil em JSON estrito.

Regras:
- Retorne SOMENTE JSON válido, sem markdown, sem comentários.
- Inferir hierarquia pelo código contábil (ex: "1", "1.1", "1.1.01") OU pela indentação/títulos.
- "level" começa em 1 nas raízes (ATIVO, PASSIVO, PATRIMÔNIO LÍQUIDO, RECEITAS, DESPESAS, RESULTADO).
- "group" é uma de: "ativo" | "passivo" | "pl" | "receita" | "despesa" | "resultado".
- "is_total" = true para linhas-totalizadoras de grupo (ex: "Total do Ativo Circulante").
- Valores numéricos em float, sem separador de milhar, ponto como decimal. Saídas/devedores positivos quando aparecem; saldos finais respeitam o sinal apresentado.
- "saldo_anterior", "debito", "credito", "saldo_atual": use 0 quando não houver coluna correspondente.
- "id" e "parent_id": pode usar o próprio code; "parent_id" null para raízes.
- Inclua TODAS as contas detectadas, mesmo as analíticas.

Schema:
{
  "accounts": [
    { "id": string, "code": string, "name": string, "level": number, "parent_id": string|null, "group": string, "saldo_anterior": number, "debito": number, "credito": number, "saldo_atual": number, "is_total": boolean }
  ]
}`;

function sumGroup(accs: any[], group: string, level = 1) {
  return accs
    .filter((a) => a.group === group && a.level === level)
    .reduce((s, a) => s + Number(a.saldo_atual || 0), 0);
}

function computeTotals(accounts: any[]) {
  const norm = (s: string) => (s || "").toLowerCase();
  const findByName = (re: RegExp) =>
    accounts.find((a) => re.test(norm(a.name))) || null;

  const ativo_total =
    findByName(/^total.*ativo$|^ativo$/i)?.saldo_atual ??
    sumGroup(accounts, "ativo");
  const passivo_total =
    findByName(/^total.*passivo$|^passivo$/i)?.saldo_atual ??
    sumGroup(accounts, "passivo");
  const patrimonio_liquido =
    findByName(/patrim[oô]nio l[ií]quido/i)?.saldo_atual ??
    sumGroup(accounts, "pl");
  const resultado_acumulado =
    findByName(/resultado.*(acumulad|exerc[ií]cio)/i)?.saldo_atual ??
    sumGroup(accounts, "resultado");
  const disponibilidades = accounts
    .filter((a) => /(caixa|banco|aplica)/i.test(a.name))
    .reduce((s, a) => s + Number(a.saldo_atual || 0), 0);
  const obrigacoes_curto_prazo =
    findByName(/passivo circulante/i)?.saldo_atual ?? 0;

  return {
    ativo_total,
    passivo_total,
    patrimonio_liquido,
    resultado_acumulado,
    disponibilidades,
    obrigacoes_curto_prazo,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { periodo, pdf_path, tipo: tipoRaw } = await req.json();
    const tipo = tipoRaw === "balanco" ? "balanco" : "balancete";
    if (!periodo || !pdf_path) {
      return new Response(JSON.stringify({ error: "periodo e pdf_path são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Baixar PDF
    const { data: file, error: dlErr } = await supabase.storage
      .from("demonstracoes-pdf")
      .download(pdf_path);
    if (dlErr || !file) throw new Error("Falha ao baixar PDF: " + dlErr?.message);
    const buf = new Uint8Array(await file.arrayBuffer());

    // 2. Extrair texto
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    const textoLimitado = (text || "").slice(0, 25000);
    if (!textoLimitado.trim()) throw new Error("Não foi possível extrair texto do PDF.");

    // 3. Chamar Google Gemini API direto (usando GEMINI_API_KEY do usuário)
    const aiKey = Deno.env.get("GEMINI_API_KEY");
    if (!aiKey) throw new Error("GEMINI_API_KEY ausente");

    // Timeout defensivo para não estourar 150s da edge runtime
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);

    let aiResp: Response;
    try {
      aiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${aiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [
              {
                role: "user",
                parts: [{ text: `Texto do ${tipo === "balanco" ? "balanço patrimonial" : "balancete"} (período ${periodo}):\n\n${textoLimitado}` }],
              },
            ],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        },
      );
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return new Response(
          JSON.stringify({
            error: "A IA demorou demais para processar o PDF. Tente novamente ou envie um PDF menor.",
            code: "ai_timeout",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (aiResp.status === 429)
      return new Response(
        JSON.stringify({
          error: "Limite de uso da IA atingido. Tente novamente em alguns minutos.",
          code: "rate_limited",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    if (aiResp.status === 402)
      return new Response(
        JSON.stringify({
          error:
            "Créditos de IA esgotados. Adicione créditos no workspace (Settings → Workspace → Usage) para reprocessar o balancete.",
          code: "credits_exhausted",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    if (!aiResp.ok) {
      const t = await aiResp.text();
      throw new Error("Gemini API erro " + aiResp.status + ": " + t.slice(0, 300));
    }

    const aiJson = await aiResp.json();
    const content = aiJson.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { accounts: [] };
    }
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    if (!accounts.length) throw new Error("IA não conseguiu identificar contas no PDF.");

    const totals = computeTotals(accounts);

    const dados = {
      version: 2,
      kind: tipo,
      imported_at: new Date().toISOString(),
      source: "pdf",
      accounts,
      totals,
    };

    // 4. Upsert mantendo pdf_path
    const { error: upErr } = await supabase
      .from("demonstracoes_contabeis")
      .upsert(
        { tipo, periodo, dados, pdf_path },
        { onConflict: "tipo,periodo" },
      );
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, totals, contas: accounts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("parse-balancete-pdf error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Erro inesperado" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
