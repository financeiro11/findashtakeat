import { corsHeaders } from "../_shared/cors.ts";
import { runFirecrawlCollector } from "../_shared/firecrawl-collector.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return await runFirecrawlCollector({
    slug: "embrapii",
    fonte: "EMBRAPII",
    orgao: "EMBRAPII — Empresa Brasileira de Pesquisa e Inovação Industrial",
    regiao: "Brasil",
    contexto: "EMBRAPII publica chamadas públicas de cooperação para PD&I entre empresas e unidades EMBRAPII. Inclua apenas chamadas com inscrições abertas.",
    searches: [
      { query: 'site:embrapii.org.br "chamada pública" 2025 OR 2026', tipo: "chamada_publica", limit: 10, tbs: "qdr:y" },
      { query: 'site:embrapii.org.br edital inovação ("inscrições abertas" OR aberta)', tipo: "chamada_publica", limit: 10, tbs: "qdr:y" },
    ],
  });
});
