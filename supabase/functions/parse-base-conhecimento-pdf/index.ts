// Extrai texto de PDF e cria notas estruturadas na base_conhecimento via Gemini API
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { generateJSON } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIPOS = ["empresa", "estrategia", "processo", "premissa", "produto", "mercado", "contrato", "politica", "nota"];

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : String(text || "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "no auth" }), { status: 401, headers: corsHeaders });

    const { path, filename, prefer_tipo } = await req.json();
    if (!path) return new Response(JSON.stringify({ error: "path required" }), { status: 400, headers: corsHeaders });

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: file, error: dlErr } = await supa.storage.from("base-conhecimento-pdf").download(path);
    if (dlErr || !file) return new Response(JSON.stringify({ error: dlErr?.message || "download failed" }), { status: 500, headers: corsHeaders });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const rawText = (await extractPdfText(bytes)).trim();
    if (!rawText) {
      return new Response(JSON.stringify({ error: "PDF sem texto extraível (talvez seja escaneado)." }), { status: 422, headers: corsHeaders });
    }

    const truncated = rawText.slice(0, 60000);

    const sysPrompt = `Você organiza documentos empresariais para uma base de conhecimento usada por uma IA financeira.
Receberá texto bruto de um PDF e deve devolver de 1 a 8 NOTAS estruturadas.
Cada nota DEVE conter:
- titulo: curto e informativo
- tipo: um destes: ${TIPOS.join(", ")}
- conteudo: resumo objetivo em markdown, com bullets quando útil, preservando números, datas, valores e cláusulas relevantes. Evite enrolação.

Quebre o PDF em notas temáticas (ex: "Cláusula de rescisão", "Política de reembolso", "Modelo de negócio"). Se for um documento pequeno e coeso, retorne UMA nota só.
Responda APENAS com JSON válido no formato { "notas": [ { "titulo": "...", "tipo": "...", "conteudo": "..." } ] }.`;

    const userPrompt = `Arquivo: ${filename || path}\n${prefer_tipo ? `Tipo sugerido: ${prefer_tipo}\n` : ""}\nTEXTO:\n${truncated}`;

    let parsed: any;
    try {
      parsed = await generateJSON({
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e?.message || "Falha ao consultar a IA", detail: e?.detail }), {
        status: 502, headers: corsHeaders,
      });
    }

    const notas: any[] = Array.isArray(parsed?.notas) ? parsed.notas : [];
    if (!notas.length) return new Response(JSON.stringify({ error: "IA não retornou notas" }), { status: 422, headers: corsHeaders });

    const sourceTag = `\n\n---\n_Origem: PDF \`${filename || path}\`_`;
    const rows = notas.map((n) => ({
      titulo: String(n.titulo || "Sem título").slice(0, 200),
      tipo: TIPOS.includes(n.tipo) ? n.tipo : (prefer_tipo && TIPOS.includes(prefer_tipo) ? prefer_tipo : "nota"),
      conteudo: String(n.conteudo || "") + sourceTag,
    }));

    const { error: insErr } = await supa.from("base_conhecimento").insert(rows);
    if (insErr) return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: corsHeaders });

    return new Response(JSON.stringify({ ok: true, count: rows.length, notas: rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: corsHeaders });
  }
});
