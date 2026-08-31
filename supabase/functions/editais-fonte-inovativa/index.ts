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
