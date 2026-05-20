import { corsHeaders } from "../_shared/cors.ts";
import { runFirecrawlCollector } from "../_shared/firecrawl-collector.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return await runFirecrawlCollector({
    slug: "inovativa",
    fonte: "InovAtiva Brasil",
    orgao: "InovAtiva Brasil — Programa de Aceleração",
    regiao: "Brasil",
    contexto: "InovAtiva Brasil opera ciclos de aceleração gratuita para startups (InovAtiva Brasil, InovAtiva Internacional, InovAtiva de Impacto). Inclua somente ciclos com inscrições abertas.",
    pages: [
      { url: "https://www.inovativabrasil.com.br/", tipo: "programa_startup" },
    ],
  });
});
