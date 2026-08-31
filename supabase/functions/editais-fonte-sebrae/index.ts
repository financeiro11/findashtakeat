import { corsHeaders } from "../_shared/cors.ts";
import { runFirecrawlCollector } from "../_shared/firecrawl-collector.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  /* PORTAO (30/08/2026). Estas coletoras nao tinham checagem nenhuma e cada
     chamada gasta credito de Firecrawl da empresa — o freio de `podeGastar` e
     por consumidor, nao por quem chama, entao um estranho num laco esvaziaria o
     orcamento do mes sem estourar limite nenhum.

     Quem chama de verdade e a `editais-sync`, que manda a SERVICE ROLE no
     Authorization — e `requireUser` aceita service role justamente para as
     chamadas de sistema. A tela tambem chama, com o usuario logado. O que deixa
     de passar e a chave publica sozinha. */
  try {
    await requireUser(req);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
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
