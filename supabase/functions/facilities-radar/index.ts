// Edge Function: facilities-radar
//
// O radar de preços do Facilities. Duas coisas, só:
//
//   { action: "interpretar", pedido, link_ref? }  → traduz o texto livre em specs
//   { action: "varrer", alvo_id?, limite?, fontes? } → sai atrás de preço
//
// COMO A IA E A REGRA SE DIVIDEM. A IA entra UMA vez, na `interpretar`: lê
// "notebook i5 16GB SSD 512 até 3 mil" (e, se houver, o anúncio de referência) e
// devolve specs estruturadas + os termos de busca. Depois disso ela sai de cena.
// Quem aprova ou recusa cada um dos ~200 anúncios por rodada é o
// `_shared/radar-precos.ts`, em TypeScript puro, testado — porque essa decisão
// roda centenas de vezes por dia, precisa ser barata, e precisa poder ser
// contestada: quando o radar recusa, o Facilities lê o motivo em português.
//
// FONTES: TODAS POR FIRECRAWL, INCLUSIVE O MERCADO LIVRE. O plano era usar a
// API oficial do ML, e ela não serve mais para isso — com a chave da Takeat e um
// token válido em mãos (26/08/2026), `/sites/MLB/search` responde 403 e
// `/products/{id}` vem com `buy_box_winner: null`. A API foi fechada para
// aplicações; sobrou a lista pública. Detalhes em `tokenML`.
//
// E a lista pública TAMBÉM não abre: um GET responde 302 para a página de
// "verificação de conta" e o Firecrawl esgota todos os motores, stealth
// inclusive. O ML está fechado para nós hoje, dos dois lados. O código dele fica
// aqui, com a URL correta, porque o dia em que houver um token de usuário
// autorizado (fluxo authorization_code) ou um proxy que passe, é só religar.
//
// O QUE ESTÁ MEDIDO E FUNCIONANDO (26/08/2026): Kabum (36 anúncios), Terabyte
// (18), Buscapé (30) e Zoom (24). Os dois agregadores puxam muita loja de uma
// vez e foram a melhor surpresa do teste. Amazon e Magalu abriram a página e não
// renderam nada — ficam selecionáveis, mas o card do alvo diz que vieram vazias
// em vez de fingir sucesso. Uma fonte que cai NÃO derruba a rodada.
//
// O ORÇAMENTO É DE RELÓGIO, NÃO DE CONTAGEM. O worker morre aos ~150s sem
// devolver relatório. A rodada para aos 55s e informa `restante`, para o cron do
// dia seguinte (ou um segundo clique) continuar de onde parou — a fila é
// ordenada por `ultima_varredura nulls first`, então quem ficou para trás é o
// primeiro da próxima.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON } from "../_shared/gemini.ts";
import {
  avaliar, classificar, condicaoDoTitulo, norm, pisoDePreco,
  type AlvoSpecs, type OfertaBruta,
} from "../_shared/radar-precos.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ORCAMENTO_MS = 55_000;
/**
 * Quantos achados viram alerta por alvo, por rodada. Vinte anúncios abaixo do
 * teto viram vinte avisos e o Facilities para de olhar a aba. Três é o que cabe
 * numa mensagem de WhatsApp sem rolar.
 */
const MAX_ALERTAS_POR_ALVO = 3;

/* =========================================================== Mercado Livre */

/**
 * A API do ML entra aqui SÓ para ler um anúncio que a pessoa colou. A busca por
 * ela não existe mais para aplicações — medido em 26/08/2026 com a chave da
 * Takeat, token de client_credentials válido em mãos:
 *
 *   GET /sites/MLB/search        → 403 forbidden   (fechado para app token)
 *   GET /products/search         → 200, mas devolve CATÁLOGO, sem preço
 *   GET /products/{id}           → 200, `buy_box_winner: null`, permalink vazio
 *   GET /sites/MLB               → 200              (o token funciona mesmo)
 *
 * Ou seja: a chave é boa, o endereço é que fechou. Preço de anúncio, hoje, só
 * pela lista pública — que é raspada como as lojas, com a vantagem de aceitar a
 * faixa de preço na própria URL (ver `LOJAS`).
 */
async function tokenML(): Promise<{ token: string | null; erro: string | null }> {
  const direto = Deno.env.get("MERCADO_LIVRE_ACCESS_TOKEN");
  if (direto) return { token: direto, erro: null };

  const id = Deno.env.get("MERCADO_LIVRE_APP_ID");
  const secret = Deno.env.get("MERCADO_LIVRE_SECRET");
  if (!id || !secret) {
    return { token: null, erro: "MERCADO_LIVRE_APP_ID/SECRET não configurados nos segredos do projeto" };
  }
  try {
    const r = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.access_token) {
      return { token: null, erro: `oauth ${r.status}: ${JSON.stringify(d).slice(0, 200)}` };
    }
    return { token: d.access_token as string, erro: null };
  } catch (e) {
    return { token: null, erro: String(e) };
  }
}

/** Anúncio de referência que a pessoa colou: dá para ler direto pela API. */
async function itemML(link: string, token: string): Promise<string | null> {
  const m = link.match(/\bMLB-?(\d{6,})/i);
  if (!m) return null;
  try {
    const r = await fetch(`https://api.mercadolibre.com/items/MLB${m[1]}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const attrs = Array.isArray(d?.attributes)
      ? d.attributes.map((a: any) => `${a.name}: ${a.value_name}`).join("; ")
      : "";
    return [`Título: ${d?.title ?? ""}`, `Preço: R$ ${d?.price ?? "?"}`, `Ficha: ${attrs}`].join("\n").slice(0, 4000);
  } catch { return null; }
}

/* ================================================================ Firecrawl */

/**
 * ORDENAR POR PREÇO SÓ VALE ONDE HÁ PISO. Foi medido, não chutado — mesma busca
 * na Kabum, mesmo alvo, em 26/08/2026:
 *   • relevância   → 36 anúncios, 33 recusados por passar do teto;
 *   • `sort=price` → 46 anúncios, **42 recusados por nem serem notebook**.
 *
 * Ordenar do mais barato entrega a página das capas, cabos e pentes de memória
 * que casam com as palavras da busca. Como a raspagem só lê a PRIMEIRA página,
 * ordenar por preço sem piso é escolher ler a página do lixo.
 *
 * Onde a loja aceita FAIXA de preço na URL, o dilema some: o piso corta o
 * acessório e a ordenação crescente passa a entregar o que se quer. Só o
 * Mercado Livre aceita (`_PriceRange_750-3000_OrderId_PRICE`) — e é justamente
 * o que está bloqueado.
 *
 * TODAS AS OUTRAS FICAM NA ORDENAÇÃO PADRÃO, e isso é escolha, não desleixo.
 * Tentei o `p_36` da Amazon: a página voltou com ZERO anúncio e nenhum erro.
 * Parâmetro chutado que não existe não dá 404 — dá página vazia, que na tela
 * vira "não achei nada hoje" em vez de "a URL está errada". Falhar em silêncio
 * é pior que não filtrar, então parâmetro que eu não consigo verificar sai.
 */
const LOJAS: Record<string, {
  nome: string;
  busca: (t: string, piso: number, teto: number) => string;
  waitFor?: number;
  /** Reputação assumida da fonte, 0..1. `null` = marketplace, o vendedor varia. */
  reputacao: number | null;
  /**
   * Ordem de consulta. Menor primeiro, e não é estética: quando a rodada estoura
   * o relógio, quem fica de fora é o fim da fila. As fontes que comprovadamente
   * trazem resultado vão na frente para nunca serem as sacrificadas.
   */
  prioridade: number;
}> = {
  /* --- medidas e trazendo resultado (26/08/2026) --- */
  kabum:    { prioridade: 1, nome: "Kabum",    reputacao: 0.9, waitFor: 3000, busca: (t) => `https://www.kabum.com.br/busca/${encodeURIComponent(t)}` },
  terabyte: { prioridade: 2, nome: "Terabyte", reputacao: 0.9, waitFor: 2500, busca: (t) => `https://www.terabyteshop.com.br/busca?str=${encodeURIComponent(t)}` },

  /* --- agregadores: cobrem muita loja de uma vez, e o link leva ao comparador,
         não à loja. Quem compra escolhe a loja lá dentro. --- */
  zoom:    { prioridade: 3, nome: "Zoom",    reputacao: null, waitFor: 4000, busca: (t) => `https://www.zoom.com.br/search?q=${encodeURIComponent(t)}` },
  buscape: { prioridade: 4, nome: "Buscapé", reputacao: null, waitFor: 4000, busca: (t) => `https://www.buscape.com.br/search?q=${encodeURIComponent(t)}` },

  /* --- abriram a página e não renderam nada; ficam por último para não comerem
         o relógio das que funcionam --- */
  // Sem o filtro `p_36`: com ele a Amazon devolveu ZERO anúncio e nenhum erro.
  // Sem ele também. É bloqueio de robô, não parâmetro errado.
  amazon: { prioridade: 5, nome: "Amazon", reputacao: 0.85, waitFor: 3000, busca: (t) => `https://www.amazon.com.br/s?k=${encodeURIComponent(t)}` },
  magalu: { prioridade: 6, nome: "Magalu", reputacao: 0.85, waitFor: 3000, busca: (t) => `https://www.magazineluiza.com.br/busca/${encodeURIComponent(t)}/` },

  // A lista pública do ML é o que sobrou depois de a API de busca fechar (403) —
  // e ela também barra robô. A URL está certa (o `_NoIndex_True` evita a página
  // canônica de categoria); fica pronta para o dia em que der para passar.
  mercado_livre: {
    prioridade: 7, nome: "Mercado Livre", reputacao: null, waitFor: 3500,
    busca: (t, piso, teto) =>
      `https://lista.mercadolivre.com.br/${encodeURIComponent(t).replace(/%20/g, "-")}` +
      `_PriceRange_${Math.round(piso)}-${Math.round(teto)}_OrderId_PRICE_NoIndex_True`,
  },
};

/**
 * `proxy: "auto"` NÃO É ENFEITE. Mercado Livre e Amazon derrubam raspagem
 * simples — um GET direto na lista do ML responde 302 para uma página de
 * "verificação de conta" (conferido no curl em 26/08/2026). No modo auto o
 * Firecrawl tenta o caminho barato e só repete em stealth se apanhar, que é o
 * equilíbrio certo entre custo e chegar lá.
 *
 * E o erro sai COM O CORPO da resposta: "Firecrawl HTTP 500" pelado não diz se
 * a URL está malformada, se o site bloqueou ou se o crédito acabou — três
 * problemas com três soluções diferentes.
 */
async function firecrawl(url: string, waitFor?: number): Promise<{ markdown: string; erro: string | null }> {
  const key = Deno.env.get("CHAVE_API_FIRCRAWL") ?? Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return { markdown: "", erro: "CHAVE_API_FIRCRAWL não configurada" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        proxy: "auto",
        location: { country: "BR", languages: ["pt-BR"] },
        ...(waitFor ? { waitFor } : {}),
      }),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    const d = (() => { try { return JSON.parse(txt); } catch { return {} as any; } })();
    if (!r.ok) return { markdown: "", erro: `Firecrawl HTTP ${r.status} — ${String(d?.error ?? d?.message ?? txt).slice(0, 220)}` };
    return { markdown: String(d?.data?.markdown ?? d?.markdown ?? ""), erro: null };
  } catch (e) {
    return { markdown: "", erro: String(e) };
  } finally { clearTimeout(t); }
}

const SCHEMA_ANUNCIOS = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          preco: { type: "number", description: "Preço à vista em reais, só o número" },
          url: { type: "string", description: "Link absoluto do produto" },
        },
        required: ["titulo", "preco"],
      },
    },
  },
  required: ["itens"],
};

/**
 * A página de busca da loja vira lista de anúncios. Só isto é IA aqui: extrair
 * título/preço/link de markdown. Se o produto SERVE, quem decide é a regra —
 * a IA nem recebe as specs pedidas, de propósito, para não ser tentada a
 * "ajudar" aprovando algo que não bate.
 */
async function extrairDaLoja(markdown: string, baseUrl: string, loja: string): Promise<OfertaBruta[]> {
  if (!markdown || markdown.length < 100) return [];
  const trecho = markdown.length > 22000 ? markdown.slice(0, 22000) : markdown;
  try {
    const out = await generateJSON<{ itens: Array<{ titulo: string; preco: number; url?: string }> }>({
      messages: [
        {
          role: "system",
          content:
            "Você extrai produtos de uma página de resultados de busca de loja brasileira. " +
            "Retorne SOMENTE produtos com preço visível. Ignore banners, categorias, filtros, " +
            "'produtos vistos recentemente' e sugestões. O preço é o à vista/PIX em reais. " +
            "Se não houver produtos, retorne lista vazia.",
        },
        { role: "user", content: `Loja: ${loja}\nURL base: ${baseUrl}\n\n${trecho}` },
      ],
      responseSchema: SCHEMA_ANUNCIOS,
      temperature: 0.1,
    });
    const itens = Array.isArray(out?.itens) ? out.itens : [];
    return itens
      .filter((i) => i?.titulo && Number(i.preco) > 0)
      .map((i): OfertaBruta => {
        let url = i.url || baseUrl;
        try { url = new URL(url, baseUrl).toString(); } catch { /* fica o que veio */ }
        /* A IDENTIDADE DO ANÚNCIO, EM TRÊS DEGRAUS — e o terceiro degrau não é
           luxo. No ML o id (MLB…) vence, porque o link ganha parâmetros de
           rastreio que mudam toda hora e virariam anúncio "novo" a cada
           varredura, estourando o histórico de preço.
           Quando a extração NÃO acha o link do produto (comum nos agregadores,
           que escondem a URL atrás de redirecionador), o fallback era a URL da
           BUSCA — a mesma para todos. Resultado medido: Zoom 24 + Buscapé 30 =
           54 anúncios que viraram 22, porque cada um sobrescrevia o anterior no
           mapa. O título normalizado é estável entre rodadas e distingue os
           produtos, que é exatamente o que a chave precisa fazer. */
        const mlb = url.match(/\bMLB-?(\d{6,})/i);
        const temLinkProprio = !!i.url && url.split("?")[0] !== baseUrl.split("?")[0];
        return {
          fonte: loja,
          id_externo: mlb
            ? `MLB${mlb[1]}`
            : temLinkProprio
              ? url.split("?")[0].slice(0, 300)
              : `t:${norm(String(i.titulo)).slice(0, 160)}`,
          titulo: String(i.titulo),
          url,
          preco: Number(i.preco),
          vendedor: LOJAS[loja]?.nome ?? loja,
          reputacao: LOJAS[loja]?.reputacao ?? null,
          frete_gratis: null,
          condicao: condicaoDoTitulo(String(i.titulo)),
        };
      });
  } catch (e) {
    console.error("extrairDaLoja", loja, e);
    return [];
  }
}

/* =============================================================== interpretar */

const SCHEMA_SPECS = {
  type: "object",
  properties: {
    categoria: { type: "string", enum: ["notebook", "monitor", "celular", "tablet", "impressora", "cadeira", "desktop", "outro"] },
    categoria_facilities: { type: "string", enum: ["TI", "Mobiliário", "Manutenção", "Limpeza", "Copa/Cozinha", "Happy hour", "Material de escritório"] },
    titulo: { type: "string", description: "Nome curto do alvo, ex: 'Notebook i5 16GB para vendas'" },
    marcas: { type: "array", items: { type: "string" } },
    cpu_tier_min: { type: "number", description: "1 entrada, 3 i3/Ryzen3, 5 i5/Ryzen5, 7 i7/Ryzen7, 9 i9" },
    cpu_geracao_min: { type: "number" },
    ram_gb_min: { type: "number" },
    armazenamento_gb_min: { type: "number" },
    armazenamento_tipo: { type: "string", enum: ["ssd", "qualquer"] },
    tela_pol_min: { type: "number" },
    tela_pol_max: { type: "number" },
    termos_obrigatorios: { type: "array", items: { type: "string" } },
    termos_proibidos: { type: "array", items: { type: "string" } },
    condicoes: { type: "array", items: { type: "string", enum: ["novo", "usado", "recondicionado"] } },
    buscas: { type: "array", items: { type: "string" }, description: "2 a 4 consultas de busca, da mais específica para a mais ampla" },
    preco_alvo: { type: "number", description: "Teto em reais, se a pessoa disse" },
    quantidade: { type: "number" },
  },
  required: ["categoria", "titulo", "buscas"],
};

async function interpretar(pedido: string, referencia: string | null) {
  const out = await generateJSON<any>({
    messages: [
      {
        role: "system",
        content:
          "Você traduz um pedido de compra em português em filtros de busca de produto.\n" +
          "REGRAS:\n" +
          "- Só preencha um campo se o pedido REALMENTE disser. Omitir é melhor que chutar: " +
          "cada campo preenchido vira uma recusa automática de anúncio.\n" +
          "- `buscas` são consultas curtas como alguém digitaria num marketplace " +
          "(ex: 'notebook i5 16gb ssd 512'), da mais específica para a mais ampla. " +
          "Nunca inclua preço nas buscas.\n" +
          "- `termos_obrigatorios` só para palavra que TEM de estar no título do anúncio.\n" +
          "- Se a pessoa não falou de condição, use ['novo'].\n" +
          "- `cpu_geracao_min` só quando ela citar geração explicitamente.",
      },
      {
        role: "user",
        content: `Pedido: ${pedido}` + (referencia ? `\n\nAnúncio de referência que a pessoa colou:\n${referencia}` : ""),
      },
    ],
    responseSchema: SCHEMA_SPECS,
    temperature: 0.1,
  });

  const specs: AlvoSpecs = {
    categoria: out?.categoria ?? "outro",
    marcas: (out?.marcas ?? []).map((m: string) => norm(m)).filter(Boolean),
    cpu_tier_min: out?.cpu_tier_min ?? null,
    cpu_geracao_min: out?.cpu_geracao_min ?? null,
    ram_gb_min: out?.ram_gb_min ?? null,
    armazenamento_gb_min: out?.armazenamento_gb_min ?? null,
    armazenamento_tipo: out?.armazenamento_tipo ?? null,
    tela_pol_min: out?.tela_pol_min ?? null,
    tela_pol_max: out?.tela_pol_max ?? null,
    termos_obrigatorios: (out?.termos_obrigatorios ?? []).map((s: string) => norm(s)).filter(Boolean),
    termos_proibidos: (out?.termos_proibidos ?? []).map((s: string) => norm(s)).filter(Boolean),
    condicoes: out?.condicoes?.length ? out.condicoes : ["novo"],
    buscas: (out?.buscas ?? []).filter(Boolean).slice(0, 4),
  };

  return {
    specs,
    titulo: out?.titulo ?? pedido.slice(0, 80),
    categoria_facilities: out?.categoria_facilities ?? "TI",
    preco_alvo: out?.preco_alvo ?? null,
    quantidade: out?.quantidade ?? 1,
  };
}

/* =================================================================== varrer */

interface ResultadoAlvo {
  alvo_id: string;
  titulo: string;
  buscadas: number;
  aprovadas: number;
  recusadas: number;
  alertas: number;
  fontes: Record<string, string>;   // fonte → "12 anúncios" ou o erro
  top_recusas: string[];
}

async function varrerAlvo(
  supabase: any,
  alvo: any,
  fontesPedidas: string[] | null,
  inicio: number,
): Promise<ResultadoAlvo> {
  const specs: AlvoSpecs = alvo.specs ?? { categoria: "outro" };
  const precoAlvo = Number(alvo.preco_alvo);
  const buscas: string[] = specs.buscas?.length ? specs.buscas : [alvo.titulo];
  const fontes: string[] = (fontesPedidas ?? alvo.fontes ?? []).filter(Boolean);

  const res: ResultadoAlvo = {
    alvo_id: alvo.id, titulo: alvo.titulo, buscadas: 0, aprovadas: 0, recusadas: 0, alertas: 0,
    fontes: {}, top_recusas: [],
  };

  // Um anúncio pode voltar em duas buscas diferentes; a chave é (fonte, id).
  const brutas = new Map<string, OfertaBruta>();

  // O piso da regra é o mesmo que reprova o anúncio barato demais lá na
  // frente. Mandá-lo na URL faz a loja já não devolver o acessório.
  const piso = pisoDePreco(precoAlvo);

  const naOrdem = fontes.filter((f) => f in LOJAS).sort((a, b) => LOJAS[a].prioridade - LOJAS[b].prioridade);

  /* AS FONTES VÃO EM PARALELO — é o que torna o radar viável. Cada fonte é
     ~35-50s de espera (o `waitFor` do Firecrawl mais a extração pela IA), e em
     fila indiana DUAS fontes já custaram 106s numa medição real. Com o teto de
     55s da rodada, isso significa uma fonte por alvo e pronto.
     Em paralelo o custo passa a ser o da fonte mais lenta, não a soma delas.

     O QUE SE PARALELIZA É SÓ A ESPERA. O veredito continua sequencial e
     determinístico, depois, no `avaliar` — qual site respondeu primeiro não
     pode mudar quem é aprovado. */
  if (Date.now() - inicio > ORCAMENTO_MS) {
    for (const loja of naOrdem) res.fontes[loja] = "não coube no tempo desta rodada — entra na próxima";
  } else {
    const colhidas = await Promise.all(naOrdem.map(async (loja) => {
      const cfg = LOJAS[loja];
      // Uma consulta por fonte (a mais específica). Cada scrape é um crédito de
      // Firecrawl mais uma chamada de IA — quatro buscas × seis fontes × N alvos
      // sairia caro sem trazer muito, já que a busca ampla repete a específica.
      const url = cfg.busca(buscas[0], piso, precoAlvo);
      const { markdown, erro } = await firecrawl(url, cfg.waitFor);
      if (erro) return { loja, ofertas: [] as OfertaBruta[], nota: erro };
      const ofertas = await extrairDaLoja(markdown, url, loja);
      const unicos = new Set(ofertas.map((o) => o.id_externo)).size;
      /* "0 anúncios" NÃO pode se parecer com sucesso. A página raspou e nada
         saiu dela — URL errada, layout novo, ou muro anti-bot que devolve HTML
         bonito e vazio. Se isso passar como sucesso, a tela vai dizer "não achei
         promoção" durante semanas. */
      return {
        loja, ofertas,
        nota: ofertas.length
          // "30 anúncios (13 produtos)" — a diferença entre os dois números conta
          // a história do agregador, e some se a gente reportar só um deles.
          ? `${ofertas.length} anúncios${unicos !== ofertas.length ? ` (${unicos} produtos)` : ""}`
          : "0 anúncios — a página abriu mas nada foi extraído (conferir a busca desta fonte)",
      };
    }));

    /* A junção respeita a ORDEM DA PRIORIDADE, não a de chegada, para o
       resultado da rodada não depender de qual site respondeu primeiro.
       E na colisão de chave FICA O MAIS BARATO: a página de um agregador lista
       o mesmo produto em oito lojas, uma linha por loja, com o mesmo título.
       Guardar "o último que apareceu" jogava fora justamente o preço bom — a
       única coisa que este módulo existe para achar. */
    for (const { loja, ofertas, nota } of colhidas) {
      res.fontes[loja] = nota;
      for (const o of ofertas) {
        const k = `${o.fonte}|${o.id_externo}`;
        const antes = brutas.get(k);
        if (!antes || o.preco < antes.preco) brutas.set(k, o);
      }
    }
  }

  res.buscadas = brutas.size;

  /* Avaliação — regra pura, sem rede. */
  const recusas = new Map<string, number>();
  const aprovadas: Array<{ o: OfertaBruta; av: ReturnType<typeof avaliar> }> = [];
  for (const o of brutas.values()) {
    const av = avaliar(specs, precoAlvo, o);
    if (!av.aprovado) {
      res.recusadas++;
      const chave = (av.recusa ?? "sem motivo").replace(/“[^”]*”/g, "…").replace(/R\$ ?[\d.,]+/g, "R$ …");
      recusas.set(chave, (recusas.get(chave) ?? 0) + 1);
      continue;
    }
    aprovadas.push({ o, av });
  }
  res.aprovadas = aprovadas.length;
  res.top_recusas = [...recusas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m, n]) => `${n}× ${m}`);

  aprovadas.sort((a, b) => a.o.preco - b.o.preco || b.av.score - a.av.score);

  /* Gravação: a oferta é atualizada (não reinserida) e o preço vira linha nova. */
  const idsVivos: number[] = [];
  const candidatos: Array<{ ofertaId: number; preco: number; classe: { tipo: string; texto: string } }> = [];

  for (const { o, av } of aprovadas) {
    const { data: linha, error } = await supabase
      .from("facilities_radar_ofertas")
      .upsert({
        alvo_id: alvo.id,
        fonte: o.fonte,
        id_externo: o.id_externo,
        titulo: o.titulo,
        url: o.url,
        imagem_url: o.imagem_url ?? null,
        vendedor: o.vendedor ?? null,
        condicao: condicaoDoTitulo(o.titulo, o.condicao),
        preco: o.preco,
        frete_gratis: !!o.frete_gratis,
        score: av.score,
        motivos: av.motivos,
        conferir: av.conferir,
        specs_lidas: av.lidas,
        ativo: true,
        visto_em: new Date().toISOString(),
      }, { onConflict: "alvo_id,fonte,id_externo" })
      .select("id, preco_min")
      .single();
    if (error || !linha) { console.error("upsert oferta", error?.message); continue; }
    idsVivos.push(linha.id);

    // Histórico ANTES de inserir o preço de agora — senão o preço de hoje já
    // seria o "mínimo anterior" e nada nunca seria mínimo histórico.
    const { data: hist } = await supabase
      .from("facilities_radar_precos")
      .select("preco, coletado_em")
      .eq("oferta_id", linha.id)
      .order("coletado_em", { ascending: true })
      .limit(200);

    await supabase.from("facilities_radar_precos").insert({ oferta_id: linha.id, preco: o.preco });

    const minAntes = linha.preco_min != null ? Number(linha.preco_min) : null;
    if (minAntes == null || o.preco < minAntes) {
      await supabase.from("facilities_radar_ofertas").update({ preco_min: o.preco }).eq("id", linha.id);
    }

    const classe = classificar(o.preco, precoAlvo, (hist ?? []) as any);
    if (classe) candidatos.push({ ofertaId: linha.id, preco: o.preco, classe });
  }

  /* Anúncio que sumiu da busca não é apagado: perde o `ativo` e mantém o
     histórico, que continua servindo de referência de mercado. */
  if (idsVivos.length) {
    await supabase.from("facilities_radar_ofertas")
      .update({ ativo: false }).eq("alvo_id", alvo.id).eq("ativo", true)
      .not("id", "in", `(${idsVivos.join(",")})`);
  }

  /* Alertas: mínimo histórico na frente, e no máximo três. */
  const ordem: Record<string, number> = { minimo_historico: 0, queda_forte: 1, alvo_batido: 2 };
  candidatos.sort((a, b) => (ordem[a.classe.tipo] ?? 9) - (ordem[b.classe.tipo] ?? 9) || a.preco - b.preco);
  for (const c of candidatos.slice(0, MAX_ALERTAS_POR_ALVO)) {
    const { error } = await supabase.from("facilities_radar_alertas").insert({
      alvo_id: alvo.id, oferta_id: c.ofertaId, tipo: c.classe.tipo,
      texto: c.classe.texto, preco: c.preco, preco_alvo: precoAlvo,
    });
    // 23505 = já existe alerta deste anúncio por este preço. É o comportamento
    // desejado (não repetir), não um erro.
    if (!error) res.alertas++;
    else if (error.code !== "23505") console.error("insert alerta", error.message);
  }

  const houveErro = Object.values(res.fontes).some((v) => !/^\d+ anúncios$/.test(v));
  await supabase.from("facilities_radar_alvos").update({
    ultima_varredura: new Date().toISOString(),
    ultimo_erro: houveErro ? Object.entries(res.fontes).filter(([, v]) => !/^\d+ anúncios$/.test(v)).map(([k, v]) => `${k}: ${v}`).join(" | ") : null,
    updated_at: new Date().toISOString(),
  }).eq("id", alvo.id);

  return res;
}

/* ==================================================================== HTTP */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    /* Cron ou gente. O `name` entra no filtro junto com o token: credencial que
       abre qualquer porta não é credencial. */
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "facilities-radar").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    let quem: string | null = null;
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.email ?? null;
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "varrer";

    /* ---------------------------------------------------- interpretar */
    if (action === "interpretar") {
      const pedido = String(body?.pedido ?? "").trim();
      if (!pedido) return json({ ok: false, erro: "Escreva o que você quer monitorar." }, 400);

      let referencia: string | null = null;
      const link = String(body?.link_ref ?? "").trim();
      if (link) {
        const { token } = await tokenML();
        if (token) referencia = await itemML(link, token);
        if (!referencia) {
          const { markdown } = await firecrawl(link, 2500);
          if (markdown) referencia = markdown.slice(0, 4000);
        }
      }

      const out = await interpretar(pedido, referencia);
      return json({ ok: true, ...out, leu_referencia: !!referencia, duracao_ms: Date.now() - t0 });
    }

    /* --------------------------------------------------------- varrer */
    if (action !== "varrer") return json({ ok: false, erro: `Ação desconhecida: ${action}` }, 400);

    const fontesPedidas: string[] | null = Array.isArray(body?.fontes) && body.fontes.length ? body.fontes : null;

    let q = supabase.from("facilities_radar_alvos").select("*").eq("ativo", true);
    if (body?.alvo_id) q = q.eq("id", body.alvo_id);
    else q = q.order("ultima_varredura", { ascending: true, nullsFirst: true }).limit(Number(body?.limite ?? 20));

    const { data: alvos, error } = await q;
    if (error) throw new Error(error.message);
    if (!alvos?.length) return json({ ok: true, alvos: 0, mensagem: "Nenhum alvo ativo para varrer." });

    const { data: exec } = await supabase.from("facilities_radar_execucoes")
      .insert({ alvos: alvos.length }).select("id").single();

    const resultados: ResultadoAlvo[] = [];
    let restante = 0;
    for (const alvo of alvos) {
      if (Date.now() - t0 > ORCAMENTO_MS) { restante = alvos.length - resultados.length; break; }
      try {
        resultados.push(await varrerAlvo(supabase, alvo, fontesPedidas, t0));
      } catch (e) {
        console.error("varrerAlvo", alvo.id, e);
        resultados.push({
          alvo_id: alvo.id, titulo: alvo.titulo, buscadas: 0, aprovadas: 0, recusadas: 0,
          alertas: 0, fontes: { erro: String(e) }, top_recusas: [],
        });
        await supabase.from("facilities_radar_alvos")
          .update({ ultimo_erro: String(e).slice(0, 500), ultima_varredura: new Date().toISOString() })
          .eq("id", alvo.id);
      }
    }

    const totalOfertas = resultados.reduce((s, r) => s + r.aprovadas, 0);
    const totalAlertas = resultados.reduce((s, r) => s + r.alertas, 0);

    if (exec?.id) {
      await supabase.from("facilities_radar_execucoes").update({
        terminado_em: new Date().toISOString(),
        alvos: resultados.length,
        ofertas: totalOfertas,
        alertas: totalAlertas,
        detalhe: { por_alvo: resultados, restante, quem },
      }).eq("id", exec.id);
    }

    return json({
      ok: true,
      alvos: resultados.length,
      ofertas: totalOfertas,
      alertas: totalAlertas,
      restante,
      por_alvo: resultados,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error("facilities-radar", e);
    return json({ ok: false, erro: String((e as Error)?.message ?? e) }, 400);
  }
});
