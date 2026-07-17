// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

// EdgeRuntime.waitUntil permite continuar o processamento DEPOIS de responder
// (essencial para PDFs escaneados grandes, cujo OCR pode passar de 2 min).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Você é um analista contábil. Recebe um Balancete ou Balanço Patrimonial em PDF (português, BR) — como TEXTO BRUTO ou como IMAGEM/PDF escaneado — e devolve a estrutura contábil em JSON estrito. Se vier como imagem/escaneado, faça a leitura (OCR) do documento.

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

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

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

// Faz a extração (IA) e grava o resultado. Roda em segundo plano.
async function processar(supabase: any, tipo: string, periodo: string, pdf_path: string, buf: Uint8Array) {
  const marcarErro = async (msg: string, code?: string) => {
    await supabase.from("demonstracoes_contabeis").upsert(
      { tipo, periodo, pdf_path, dados: { version: 0, parse_status: "error", parse_error: msg, parse_code: code ?? null } },
      { onConflict: "tipo,periodo" },
    );
  };

  try {
    // 1. Extrair texto (PDF digital). Sem texto => OCR do próprio PDF pelo Gemini.
    let textoLimitado = "";
    try {
      const pdf = await getDocumentProxy(buf);
      const { text } = await extractText(pdf, { mergePages: true });
      textoLimitado = (text || "").slice(0, 25000);
    } catch (_e) {
      textoLimitado = "";
    }
    const temTexto = textoLimitado.replace(/\s/g, "").length >= 200;

    const aiKey = Deno.env.get("GEMINI_API_KEY");
    if (!aiKey) return await marcarErro("GEMINI_API_KEY ausente");

    const docLabel = tipo === "balanco" ? "balanço patrimonial" : "balancete";
    // flash-lite lê imagem/PDF (OCR) muito mais rápido — essencial para PDFs
    // escaneados grandes caberem no tempo de execução do edge.
    const modelo = "gemini-2.5-flash-lite";
    const userParts = temTexto
      ? [{ text: `Texto do ${docLabel} (período ${periodo}):\n\n${textoLimitado}` }]
      : [
          { text: `Este é o PDF de um ${docLabel} (período ${periodo}), possivelmente escaneado. Leia o documento (OCR) e devolva a estrutura contábil no schema pedido.` },
          { inlineData: { mimeType: "application/pdf", data: toBase64(buf) } },
        ];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 230000);
    let aiResp: Response;
    try {
      aiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${aiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [{ role: "user", parts: userParts }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        },
      );
    } catch (e: any) {
      if (e?.name === "AbortError") return await marcarErro("A IA demorou demais para ler o PDF. Envie um PDF menor ou com menos páginas.", "ai_timeout");
      return await marcarErro(e?.message || "Erro de rede ao chamar a IA");
    } finally {
      clearTimeout(timer);
    }

    if (aiResp.status === 429) return await marcarErro("Limite de uso da IA atingido. Tente novamente em alguns minutos.", "rate_limited");
    if (aiResp.status === 402) return await marcarErro("Créditos de IA esgotados. Adicione créditos no workspace para reprocessar.", "credits_exhausted");
    if (!aiResp.ok) {
      const t = await aiResp.text();
      return await marcarErro("Gemini API erro " + aiResp.status + ": " + t.slice(0, 200));
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
    if (!accounts.length) return await marcarErro("A IA não conseguiu identificar contas no PDF.");

    const totals = computeTotals(accounts);
    await supabase.from("demonstracoes_contabeis").upsert(
      { tipo, periodo, pdf_path, dados: { version: 2, kind: tipo, imported_at: new Date().toISOString(), source: "pdf", accounts, totals } },
      { onConflict: "tipo,periodo" },
    );
  } catch (err: any) {
    await marcarErro(err?.message || "Erro inesperado ao processar");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { periodo, pdf_path, tipo: tipoRaw } = await req.json();
    const tipo = tipoRaw === "balanco" ? "balanco" : "balancete";
    if (!periodo || !pdf_path) {
      return new Response(JSON.stringify({ error: "periodo e pdf_path são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Baixa o PDF de forma síncrona (rápido) — se falhar, responde erro na hora.
    const { data: file, error: dlErr } = await supabase.storage.from("demonstracoes-pdf").download(pdf_path);
    if (dlErr || !file) {
      return new Response(JSON.stringify({ error: "Falha ao baixar PDF: " + (dlErr?.message || "arquivo não encontrado") }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const buf = new Uint8Array(await file.arrayBuffer());

    // Marca o registro como "processando" (mantém o pdf_path).
    await supabase.from("demonstracoes_contabeis").upsert(
      { tipo, periodo, pdf_path, dados: { version: 0, parse_status: "processing", parse_started_at: new Date().toISOString() } },
      { onConflict: "tipo,periodo" },
    );

    // Processa em segundo plano e responde imediatamente. O front consulta o
    // registro até virar version=2 (pronto) ou parse_status=error.
    const work = processar(supabase, tipo, periodo, pdf_path, buf);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(work);
    } else {
      await work; // fallback: ambiente sem waitUntil
    }

    return new Response(JSON.stringify({ started: true }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("parse-balancete-pdf error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Erro inesperado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
