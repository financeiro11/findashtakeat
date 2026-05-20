import { corsHeaders } from "../_shared/cors.ts";
import { runFirecrawlCollector } from "../_shared/firecrawl-collector.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return await runFirecrawlCollector({
    slug: "bndes",
    fonte: "BNDES",
    orgao: "BNDES — Banco Nacional de Desenvolvimento Econômico e Social",
    regiao: "Brasil",
    contexto: "BNDES publica chamadas/seleções públicas, editais de fomento à inovação, programas de apoio a startups e linhas de financiamento. Inclua somente oportunidades reais com inscrições abertas ou em fluxo contínuo. Não inclua notícias antigas, balanços ou material institucional.",
    searches: [
      { query: 'site:bndes.gov.br ("seleção pública" OR "chamada pública" OR edital) inscrições abertas', tipo: "chamada_publica", limit: 10, tbs: "qdr:y" },
      { query: 'site:bndes.gov.br inovação edital 2025 OR 2026', tipo: "fomento", limit: 10, tbs: "qdr:y" },
    ],
  });
});
