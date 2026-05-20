import { corsHeaders } from "../_shared/cors.ts";
import { runFirecrawlCollector } from "../_shared/firecrawl-collector.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return await runFirecrawlCollector({
    slug: "finep",
    fonte: "Finep",
    orgao: "Finep — Financiadora de Estudos e Projetos",
    regiao: "Brasil",
    contexto: "Finep publica chamadas públicas de fomento à inovação, subvenção econômica, crédito para CT&I e programas como Centelha, Tecnova, Mais Inovação. Inclua apenas chamadas abertas.",
    pages: [
      { url: "http://www.finep.gov.br/chamadas-publicas", tipo: "chamada_publica" },
      { url: "http://www.finep.gov.br/chamadas-publicas?situacao=aberta", tipo: "chamada_publica" },
    ],
  });
});
