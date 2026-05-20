import { corsHeaders } from "../_shared/cors.ts";
import { runFirecrawlCollector } from "../_shared/firecrawl-collector.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return await runFirecrawlCollector({
    slug: "govbr",
    fonte: "Gov.br",
    orgao: "Governo Federal — Financiamento e Crédito",
    regiao: "Brasil",
    contexto: "Editais e chamadas públicas federais de fomento, inovação e crédito publicadas em portais .gov.br (MCTI, MDIC, MCTIC, MAPA, MS etc). Inclua apenas chamadas com inscrições abertas ou em fluxo contínuo.",
    searches: [
      { query: 'site:gov.br "chamada pública" inovação ("inscrições abertas" OR aberta) 2025 OR 2026', tipo: "chamada_publica", limit: 10, tbs: "qdr:m" },
      { query: 'site:gov.br edital fomento ("inscrições abertas" OR aberta) 2025 OR 2026', tipo: "fomento", limit: 10, tbs: "qdr:m" },
    ],
  });
});
