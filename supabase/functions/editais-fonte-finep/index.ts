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
