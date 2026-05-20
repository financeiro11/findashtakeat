import { corsHeaders } from "../_shared/cors.ts";
import { runFirecrawlCollector } from "../_shared/firecrawl-collector.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return await runFirecrawlCollector({
    slug: "sebrae",
    fonte: "Sebrae",
    orgao: "Sebrae — Serviço Brasileiro de Apoio às Micro e Pequenas Empresas",
    regiao: "Brasil",
    contexto: "Sebrae publica editais de inovação, programas de aceleração e chamadas para startups e pequenas empresas. Inclua apenas chamadas com inscrições abertas.",
    searches: [
      { query: 'site:sebrae.com.br edital ("inscrições abertas" OR "chamada") 2025 OR 2026', tipo: "chamada_publica", limit: 10, tbs: "qdr:y" },
      { query: 'site:sebraestartups.com.br edital OR programa OR aceleração 2025 OR 2026', tipo: "programa_startup", limit: 10, tbs: "qdr:y" },
    ],
  });
});
