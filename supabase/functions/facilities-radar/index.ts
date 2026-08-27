// Edge Function: facilities-radar
//
// O radar de preços do Facilities.
//
//   { action: "interpretar", pedido, link_ref? }     → texto livre vira specs
//   { action: "varrer",  alvo_id?, limite?, fontes? } → sai atrás de preço
//   { action: "confirmar", alvo_id?, limite? }        → abre o anúncio e checa
//
// VARRER E CONFIRMAR SÃO DUAS METADES, e essa separação é o coração da coisa.
// A varredura lê PÁGINAS DE BUSCA, que são baratas e mentem: mostram produto
// esgotado com o último preço praticado — que fica bonito justamente por não
// estar mais à venda. Por isso o achado nasce em quarentena (`a_confirmar`) e
// não aparece na tela. A confirmação abre O ANÚNCIO, um a um, e só então ele
// vira aviso: com estoque conferido e com o frete somado ao preço.
//
// Confirmar os ~76 candidatos de uma rodada seriam 76 créditos por alvo por dia.
// Confirmar os três que virariam aviso custa três — e são exatamente os três em
// que alguém vai clicar. Filtro barato em tudo, conferência cara só no que vira
// ação.
//
// O FRETE ENTRA NA CONTA. O teto é quanto o Facilities aceita GASTAR, e um
// notebook de R$ 2.980 com R$ 140 de frete não cabe num teto de R$ 3.000. Teto,
// ranking, alerta e economia são todos medidos pelo total. Frete que a página
// não informa fica `null`, nunca zero: somar zero afirmaria "é grátis".
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
// DOZE FONTES, EM RODÍZIO. Comprovadas em 26/08/2026: Kabum (36 anúncios),
// Buscapé (30), Zoom (24) e Terabyte (18) — os agregadores puxam muita loja de
// uma vez e foram a melhor surpresa. Amazon, Magalu e ML abriram a página e não
// renderam nada. As demais (Bondfaro, Pichau, Balão, Americanas, Casas Bahia,
// Carrefour, Fast Shop) entraram para SEREM MEDIDAS, não porque eu suponho que
// funcionam — a que vier vazia diz isso no card e sai da lista padrão.
//
// Como seis fontes cabem numa rodada e são doze, as comprovadas vão sempre e as
// outras giram. Cortar só pelas primeiras da fila deixaria as últimas ligadas na
// tela e mudas na prática. Uma fonte que cai NÃO derruba a rodada.
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
  avaliar, chaveDoProduto, classificar, condicaoDoTitulo, disponibilidade, economiaDe, emCentavos, norm, pisoDePreco, totalDaOferta,
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
/**
 * Quantas fontes por alvo por rodada. Cada uma custa um crédito de Firecrawl,
 * uma chamada de IA e ~40s de espera — e são doze cadastradas. Seis cabem numa
 * onda paralela dentro do orçamento; as outras entram no rodízio.
 */
const MAX_FONTES_POR_RODADA = 6;
/** Até esta prioridade a fonte é consultada SEMPRE (as comprovadas). */
const FIXAS_ATE = 4;

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
  zoom:     { prioridade: 3, nome: "Zoom",     reputacao: null, waitFor: 4000, busca: (t) => `https://www.zoom.com.br/search?q=${encodeURIComponent(t)}` },
  buscape:  { prioridade: 4, nome: "Buscapé",  reputacao: null, waitFor: 4000, busca: (t) => `https://www.buscape.com.br/search?q=${encodeURIComponent(t)}` },
  bondfaro: { prioridade: 5, nome: "Bondfaro", reputacao: null, waitFor: 4000, busca: (t) => `https://www.bondfaro.com.br/search?q=${encodeURIComponent(t)}` },

  /* --- candidatas: entram na roda para serem MEDIDAS, não porque eu suponho
         que funcionam. A que vier vazia diz isso no card e sai da lista
         padrão. Lojas de TI primeiro, porque é onde o Facilities compra. --- */
  pichau:      { prioridade: 6,  nome: "Pichau",       reputacao: 0.9,  waitFor: 3000, busca: (t) => `https://www.pichau.com.br/search?q=${encodeURIComponent(t)}` },
  balao:       { prioridade: 7,  nome: "Balão da Informática", reputacao: 0.85, waitFor: 3000, busca: (t) => `https://www.balaodainformatica.com.br/busca?q=${encodeURIComponent(t)}` },
  americanas:  { prioridade: 8,  nome: "Americanas",   reputacao: 0.8,  waitFor: 3500, busca: (t) => `https://www.americanas.com.br/busca/${encodeURIComponent(t)}` },
  casasbahia:  { prioridade: 9,  nome: "Casas Bahia",  reputacao: 0.8,  waitFor: 3500, busca: (t) => `https://www.casasbahia.com.br/${encodeURIComponent(t).replace(/%20/g, "-")}/b` },
  carrefour:   { prioridade: 10, nome: "Carrefour",    reputacao: 0.8,  waitFor: 3500, busca: (t) => `https://www.carrefour.com.br/busca/${encodeURIComponent(t)}` },
  fastshop:    { prioridade: 11, nome: "Fast Shop",    reputacao: 0.85, waitFor: 3500, busca: (t) => `https://site.fastshop.com.br/web/busca?searchTerm=${encodeURIComponent(t)}` },

  /* --- abriram a página e não renderam nada; ficam por último para não comerem
         o relógio das que funcionam --- */
  // Sem o filtro `p_36`: com ele a Amazon devolveu ZERO anúncio e nenhum erro.
  // Sem ele também. É bloqueio de robô, não parâmetro errado.
  amazon: { prioridade: 90, nome: "Amazon", reputacao: 0.85, waitFor: 3000, busca: (t) => `https://www.amazon.com.br/s?k=${encodeURIComponent(t)}` },
  magalu: { prioridade: 91, nome: "Magalu", reputacao: 0.85, waitFor: 3000, busca: (t) => `https://www.magazineluiza.com.br/busca/${encodeURIComponent(t)}/` },

  // A lista pública do ML é o que sobrou depois de a API de busca fechar (403) —
  // e ela também barra robô. A URL está certa (o `_NoIndex_True` evita a página
  // canônica de categoria); fica pronta para o dia em que der para passar.
  mercado_livre: {
    prioridade: 92, nome: "Mercado Livre", reputacao: null, waitFor: 3500,
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
/**
 * O CEP do escritório. Sem ele, nenhuma loja brasileira mostra frete: todas
 * pedem "informe seu CEP" antes de calcular. É por isso que, até aqui, o frete
 * só aparecia quando era grátis e estava escrito na vitrine.
 */
const CEP_DESTINO = (Deno.env.get("RADAR_CEP") ?? "29050780").replace(/\D/g, "");

/**
 * Digitar o CEP na página, com UM seletor para todas as lojas.
 *
 * A tentação é escrever um seletor por loja — e é a decisão errada. Seriam nove
 * seletores para manter, cada um quebrando calado na primeira reforma de layout
 * do site, e o sintoma seria "frete não informado", que é indistinguível do
 * comportamento normal. Um seletor genérico com o casamento por atributo do CSS
 * (`i` = ignora maiúscula) pega o padrão que as lojas brasileiras repetem:
 * um input cujo id, nome ou placeholder tem "cep".
 *
 * Se não achar, a ação falha e a leitura é refeita sem ela — custa uma segunda
 * raspagem, e só nos poucos anúncios que chegam à confirmação.
 */
const ACOES_CEP = [
  { type: "wait", milliseconds: 1500 },
  { type: "click", selector: 'input[id*="cep" i], input[name*="cep" i], input[placeholder*="cep" i]' },
  { type: "write", text: CEP_DESTINO },
  { type: "press", key: "Enter" },
  { type: "wait", milliseconds: 3500 },
];

async function firecrawl(
  url: string,
  waitFor?: number,
  opts: { comCep?: boolean } = {},
): Promise<{ markdown: string; erro: string | null }> {
  const key = Deno.env.get("CHAVE_API_FIRCRAWL") ?? Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return { markdown: "", erro: "CHAVE_API_FIRCRAWL não configurada" };
  const ctrl = new AbortController();
  /* O TETO DE ESPERA É POR TIPO DE LEITURA, e essa distinção custou uma
     varredura de 139s: subi o timeout para 90s por causa das ações do CEP e,
     como as fontes rodam em paralelo, a rodada inteira passou a poder esperar
     90s + extração. Busca é leitura simples e tem de ser rápida; só a
     confirmação com CEP — que digita e espera a loja recalcular — merece folga. */
  const t = setTimeout(() => ctrl.abort(), opts.comCep ? 75_000 : 45_000);
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
        ...(opts.comCep ? { actions: ACOES_CEP } : {}),
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
          imagem_url: { type: "string", description: "Link absoluto da FOTO do produto. Ignore ícones, logos e banners." },
          avaliacao: { type: "number", description: "Nota do produto de 0 a 5, se a página mostrar" },
          avaliacoes: { type: "number", description: "Quantas pessoas avaliaram, se a página mostrar" },
          disponivel: { type: "boolean", description: "false SÓ se a página disser que está esgotado/indisponível. Omita se não falar." },
          frete_gratis: { type: "boolean", description: "true SÓ se a página disser frete grátis. Omita se não falar." },
          frete_valor: { type: "number", description: "Valor do frete em reais, se a página mostrar um número. Omita se não mostrar." },
          frete_texto: { type: "string", description: "O que a página escreveu sobre frete, literalmente" },
        },
        required: ["titulo", "preco"],
      },
    },
  },
  required: ["itens"],
};

/** O que se lê ABRINDO o anúncio: é aqui que estoque e frete costumam aparecer. */
const SCHEMA_CONFIRMACAO = {
  type: "object",
  properties: {
    disponivel: { type: "boolean", description: "O produto pode ser comprado agora? false se houver 'esgotado', 'indisponível', 'avise-me quando chegar'." },
    preco: { type: "number", description: "Preço à vista/PIX atual em reais" },
    frete_gratis: { type: "boolean" },
    frete_valor: { type: "number", description: "Valor do frete em reais, se a página mostrar. Omita se exigir CEP e não houver número na tela." },
    frete_texto: { type: "string", description: "O que a página diz sobre frete, literalmente" },
    avaliacao: { type: "number", description: "Nota do produto de 0 a 5, se a página mostrar" },
    avaliacoes: { type: "number", description: "Quantas pessoas avaliaram" },
    imagem_url: { type: "string", description: "Link absoluto da foto principal do produto" },
    observacao: { type: "string", description: "Algo que desaconselhe a compra (pré-venda, entrega em 30 dias, vendedor sem reputação)" },
  },
  required: ["disponivel"],
};

/**
 * A página de busca da loja vira lista de anúncios. Só isto é IA aqui: extrair
 * título/preço/link de markdown. Se o produto SERVE, quem decide é a regra —
 * a IA nem recebe as specs pedidas, de propósito, para não ser tentada a
 * "ajudar" aprovando algo que não bate.
 */
async function extrairDaLoja(markdown: string, baseUrl: string, loja: string): Promise<OfertaBruta[]> {
  if (!markdown || markdown.length < 100) return [];
  const trecho = markdown.length > 16000 ? markdown.slice(0, 16000) : markdown;
  try {
    const out = await generateJSON<{
      itens: Array<{
        titulo: string; preco: number; url?: string; imagem_url?: string;
        avaliacao?: number; avaliacoes?: number;
        disponivel?: boolean; frete_gratis?: boolean; frete_valor?: number; frete_texto?: string;
      }>;
    }>({
      messages: [
        {
          role: "system",
          content:
            "Você extrai produtos de uma página de resultados de busca de loja brasileira. " +
            "Retorne SOMENTE produtos com preço visível. Ignore banners, categorias, filtros, " +
            "'produtos vistos recentemente' e sugestões. O preço é o à vista/PIX em reais. " +
            "Se não houver produtos, retorne lista vazia.\n" +
            "NUNCA CHUTE disponibilidade nem frete: preencha `disponivel` e os campos de frete " +
            "SOMENTE quando a página disser. Omitir é o certo quando ela não diz — quem lê a sua " +
            "resposta trata campo ausente como 'não sei' e vai conferir, mas trata um `true` " +
            "inventado como fato.",
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
          /* A foto vem resolvida contra a URL da busca porque metade das lojas
             devolve caminho relativo, e `<img src="/img/x.jpg">` na tela do Hub
             não carrega nada — quebraria em silêncio, com o alt vazio. */
          imagem_url: i.imagem_url ? (() => { try { return new URL(i.imagem_url!, baseUrl).toString(); } catch { return null; } })() : null,
          preco: Number(i.preco),
          avaliacao: typeof i.avaliacao === "number" && i.avaliacao > 0 && i.avaliacao <= 5 ? i.avaliacao : null,
          avaliacoes: typeof i.avaliacoes === "number" && i.avaliacoes > 0 ? Math.round(i.avaliacoes) : null,
          vendedor: LOJAS[loja]?.nome ?? loja,
          reputacao: LOJAS[loja]?.reputacao ?? null,
          condicao: condicaoDoTitulo(String(i.titulo)),
          /* `disponibilidade` cruza o que a IA leu com as palavras do próprio
             título. A regra vence a IA no lado do "não": se o título grita
             ESGOTADO, não importa que a extração tenha dito que estava tudo bem. */
          disponivel: disponibilidade(String(i.titulo), i.frete_texto ?? null, i.disponivel ?? null),
          frete_gratis: i.frete_gratis ?? null,
          frete_valor: typeof i.frete_valor === "number" ? i.frete_valor : null,
          frete_texto: i.frete_texto ?? null,
        };
      });
  } catch (e) {
    console.error("extrairDaLoja", loja, e);
    return [];
  }
}

/* ============================================== confirmação no próprio anúncio */

export interface Confirmacao {
  /** A loja de verdade por trás do link do agregador ("Magazine Luiza"), quando dá para saber. */
  loja?: string | null;
  disponivel: boolean | null;
  preco: number | null;
  frete_valor: number | null;
  frete_texto: string | null;
  avaliacao: number | null;
  avaliacoes: number | null;
  imagem_url: string | null;
  observacao: string | null;
  erro: string | null;
}

/**
 * Abre O ANÚNCIO (não a busca) e confere o que a página de resultados quase
 * nunca conta: se tem estoque e quanto custa o frete.
 *
 * POR QUE NÃO DÁ PARA CONFIAR NA PÁGINA DE BUSCA. Ela mostra o produto mesmo
 * esgotado, e mostra o ÚLTIMO PREÇO PRATICADO — que fica bonito justamente por
 * não estar mais à venda. Um radar que avisa a partir da busca vai, mais cedo ou
 * mais tarde, mandar a pessoa correr atrás de um preço que não existe mais.
 * Da segunda vez que isso acontecer, ela para de abrir os links.
 *
 * POR QUE SÓ NOS FINALISTAS. Confirmar os 76 candidatos de uma rodada seriam 76
 * créditos de Firecrawl e 76 chamadas de IA por alvo, por dia. Confirmar os três
 * que virariam aviso custa três — e são exatamente os três em que alguém vai
 * clicar. Filtro barato em tudo, conferência cara só no que vira ação.
 *
 * SOBRE O FRETE: o que dá para ler é o que a página DECLARA ("frete grátis",
 * "frete a partir de R$ 24,90"). Loja que só calcula frete depois de digitar o
 * CEP não entrega número nenhum para uma leitura de página, e nesse caso o
 * campo fica null e a tela diz "frete não informado". Preferir isso a inventar
 * um zero.
 */
/**
 * O link do agregador não é o anúncio: é um redirecionador de clique.
 *
 * Buscapé, Zoom e Bondfaro apontam para `/lead?oid=1578116400&channel=86&...`,
 * que só existe para contar o clique e mandar a pessoa à loja. O Firecrawl não
 * raspa isso — "All scraping engines failed" — e o resultado, na medição de
 * 26/08/2026, era que TODO achado dos três agregadores ficava preso na
 * quarentena para sempre e nunca chegava à tela. Justamente as três fontes de
 * maior volume.
 *
 * Seguir o redirecionamento é barato (não gasta crédito de Firecrawl) e resolve
 * duas coisas de uma vez: dá uma página de loja que dá para conferir, e faz o
 * aviso apontar para a loja de verdade em vez de para o comparador.
 */
const UA_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function resolverLink(url: string): Promise<{ url: string; loja: string | null }> {
  if (!/\/lead\?|\/go\/|\/redirect|\/r\/|\/click/i.test(url)) return { url, loja: null };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    /* SALTO 1. O `/lead?` responde 200 com uma página do Next.js, não com um
       301 — por isso seguir redirecionamento sozinho não sai do lugar. O que
       interessa está no `__NEXT_DATA__`: `urlToRedirect` (o segundo salto, esse
       sim com `logAndRedirect=1`) e `merchantName`, que é a LOJA DE VERDADE. */
    const r1 = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA_NAVEGADOR } });
    const html = await r1.text();
    const bruto = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]{0,20000}?)<\/script>/);
    if (!bruto) return { url, loja: null };

    let dados: any = null;
    try { dados = JSON.parse(bruto[1]); } catch { return { url, loja: null }; }
    const pp = dados?.props?.pageProps ?? {};
    const loja: string | null = pp.rawName ?? pp.dataLayer?.[0]?.merchantName ?? null;
    const segundo: string | undefined = pp.urlToRedirect;
    if (!segundo) return { url, loja };

    /* SALTO 2. Esse devolve 301 para o endereço do produto na loja. O `fetch`
       segue e `r2.url` traz o destino — inclusive quando a loja responde 403
       para robô, que é o caso da Magalu. E tudo bem: o link certo vale por si,
       mesmo que a confirmação depois não consiga abrir a página. */
    const r2 = await fetch(segundo, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": UA_NAVEGADOR } });
    const final = r2.url && !/\/lead\?/i.test(r2.url) ? r2.url : url;
    return { url: final, loja };
  } catch {
    return { url, loja: null };
  } finally { clearTimeout(t); }
}

async function confirmarNoAnuncio(urlOriginal: string): Promise<Confirmacao & { url: string }> {
  const { url, loja } = await resolverLink(urlOriginal);
  const vazio: Confirmacao & { url: string } = { url, loja, disponivel: null, preco: null, frete_valor: null, frete_texto: null, avaliacao: null, avaliacoes: null, imagem_url: null, observacao: null, erro: null };

  /* Primeiro com o CEP digitado, que é a única forma de a loja mostrar frete.
     Se a ação falhar — input com outro nome, página que não carregou a tempo —,
     relê sem ela: melhor um anúncio confirmado sem frete do que anúncio nenhum.
     A segunda leitura só acontece nos poucos que chegam à confirmação. */
  let { markdown, erro } = await firecrawl(url, 3000, { comCep: true });
  let comCep = !erro && !!markdown;
  if (!comCep) {
    ({ markdown, erro } = await firecrawl(url, 3000));
    comCep = false;
  }
  if (erro) return { ...vazio, erro };
  if (!markdown || markdown.length < 100) return { ...vazio, erro: "a página do anúncio abriu vazia" };

  /* AUSÊNCIA DE EVIDÊNCIA NÃO É EVIDÊNCIA DE AUSÊNCIA — e aqui isso é a
     diferença entre um radar honesto e um que joga achado bom no lixo.
     A página de bloqueio da Magalu tem 1 KB e diz "não é possível acessar a
     página (erro 403)". Perguntada "dá para comprar agora?", a IA olha uma
     página sem botão de compra e responde `false`. O achado seria arquivado
     como "esgotado", com toda a cara de conclusão legítima, e ninguém jamais
     saberia que o produto estava lá à venda o tempo todo.
     Então antes de acreditar num "não", exige-se prova de que a página é MESMO
     um anúncio: ou tem preço, ou diz com todas as letras que acabou. */
  const temPreco = /r\$\s?\d/i.test(markdown);
  const dizEsgotado = disponibilidade(markdown.slice(0, 4000)) === false;
  if (!temPreco && !dizEsgotado) {
    return { ...vazio, erro: "a página não parece um anúncio (provável bloqueio de robô)" };
  }

  try {
    const out = await generateJSON<any>({
      messages: [
        {
          role: "system",
          content:
            "Você lê a página de UM produto em loja brasileira e responde se dá para comprar agora.\n" +
            "`disponivel` = false quando houver 'esgotado', 'indisponível', 'produto indisponível', " +
            "'avise-me quando chegar', 'sem estoque', ou quando não houver botão de compra.\n" +
            (comCep
              ? `O CEP ${CEP_DESTINO} JÁ FOI DIGITADO nesta página: se houver uma tabela ou lista de ` +
                "opções de entrega, pegue o MENOR valor de frete e ponha em `frete_valor` " +
                "(0 se disser grátis). Ignore retirada em loja, que não é frete.\n"
              : "") +
            "NÃO invente frete: só preencha `frete_valor` se houver um número na página. " +
            "Loja que só calcula frete depois do CEP não tem valor — deixe em branco.\n" +
            "Preencha `avaliacao` (0 a 5) e `avaliacoes` (quantidade) só se a página mostrar, " +
            "e `imagem_url` com a foto principal do produto.",
        },
        { role: "user", content: markdown.slice(0, 14000) },
      ],
      responseSchema: SCHEMA_CONFIRMACAO,
      temperature: 0,
    });

    /* Três degraus, do mais confiável ao menos:
       1. a página ESCREVE que acabou → false, e não se discute;
       2. a IA diz que acabou E a página tem preço (logo, é anúncio de verdade
          que carregou) → false;
       3. a IA diz que dá para comprar → true.
       Fora disso, `null`: a tela pede para conferir em vez de decidir no chute. */
    const disp: boolean | null =
      dizEsgotado ? false
      : (out?.disponivel === false && temPreco) ? false
      : out?.disponivel === true ? true
      : null;
    return {
      url, loja,
      disponivel: disp,
      preco: typeof out?.preco === "number" && out.preco > 0 ? out.preco : null,
      frete_valor: out?.frete_gratis === true ? 0 : (typeof out?.frete_valor === "number" ? out.frete_valor : null),
      frete_texto: out?.frete_texto ?? (out?.frete_gratis === true ? "Frete grátis" : null),
      avaliacao: typeof out?.avaliacao === "number" && out.avaliacao > 0 && out.avaliacao <= 5 ? out.avaliacao : null,
      avaliacoes: typeof out?.avaliacoes === "number" && out.avaliacoes > 0 ? Math.round(out.avaliacoes) : null,
      imagem_url: out?.imagem_url ?? null,
      observacao: out?.observacao ?? null,
      erro: null,
    };
  } catch (e) {
    return { ...vazio, erro: String(e) };
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
  /** Avisos suprimidos por serem o mesmo produto vindo de outra fonte. */
  repetidos: number;
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
    alvo_id: alvo.id, titulo: alvo.titulo, buscadas: 0, aprovadas: 0, recusadas: 0, alertas: 0, repetidos: 0,
    fontes: {}, top_recusas: [],
  };

  // Um anúncio pode voltar em duas buscas diferentes; a chave é (fonte, id).
  const brutas = new Map<string, OfertaBruta>();

  // O piso da regra é o mesmo que reprova o anúncio barato demais lá na
  // frente. Mandá-lo na URL faz a loja já não devolver o acessório.
  const piso = pisoDePreco(precoAlvo);

  /* RODÍZIO DE FONTES. São doze agora, e chamar as doze toda rodada estoura o
     relógio e o crédito. Cortar simplesmente pelas primeiras seria pior: a
     fila é sempre ordenada por prioridade, então as últimas NUNCA seriam
     consultadas — estariam ligadas na tela e mudas na prática.
     Então as comprovadas (prioridade <= FIXAS_ATE) vão sempre, e as demais
     entram em roda, avançando uma posição a cada varredura. Em poucas rodadas
     todas foram consultadas, e nenhuma fica órfã para sempre. */
  const escolhidas = fontes.filter((f) => f in LOJAS).sort((a, b) => LOJAS[a].prioridade - LOJAS[b].prioridade);
  const fixas = escolhidas.filter((f) => LOJAS[f].prioridade <= FIXAS_ATE);
  const roda = escolhidas.filter((f) => LOJAS[f].prioridade > FIXAS_ATE);
  const vagas = Math.max(0, MAX_FONTES_POR_RODADA - fixas.length);
  const giro = roda.length ? (Number(alvo.rodadas ?? 0) * vagas) % roda.length : 0;
  const naOrdem = [
    ...fixas,
    ...Array.from({ length: Math.min(vagas, roda.length) }, (_, i) => roda[(giro + i) % roda.length]),
  ];
  for (const f of escolhidas) {
    if (!naOrdem.includes(f)) res.fontes[f] = "fora do rodízio desta rodada — entra na próxima";
  }

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

  // Ordena pelo TOTAL (produto + frete): o mais barato de verdade, não o de
  // etiqueta menor. Entre dois totais iguais, ganha quem tem mais confirmado.
  aprovadas.sort((a, b) => a.av.total - b.av.total || b.av.score - a.av.score);

  /* Gravação: a oferta é atualizada (não reinserida) e o preço vira linha nova. */
  const idsVivos: number[] = [];
  const candidatos: Array<{ ofertaId: number; titulo: string; total: number; frete: number | null; classe: { tipo: string; texto: string } }> = [];

  for (const { o, av } of aprovadas) {
    const { frete } = totalDaOferta(o);
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
        preco_total: av.total,
        avaliacao: o.avaliacao ?? null,
        avaliacoes: o.avaliacoes ?? null,
        frete_gratis: frete === 0,
        frete_valor: frete,
        frete_texto: o.frete_texto ?? null,
        disponivel: o.disponivel ?? null,
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

    await supabase.from("facilities_radar_precos").insert({ oferta_id: linha.id, preco: av.total });

    const minAntes = linha.preco_min != null ? Number(linha.preco_min) : null;
    if (minAntes == null || av.total < minAntes) {
      await supabase.from("facilities_radar_ofertas").update({ preco_min: av.total }).eq("id", linha.id);
    }

    const classe = classificar(av.total, precoAlvo, (hist ?? []) as any);
    if (classe) candidatos.push({ ofertaId: linha.id, titulo: o.titulo, total: av.total, frete, classe });
  }

  /* Anúncio que sumiu da busca não é apagado: perde o `ativo` e mantém o
     histórico, que continua servindo de referência de mercado. */
  if (idsVivos.length) {
    await supabase.from("facilities_radar_ofertas")
      .update({ ativo: false }).eq("alvo_id", alvo.id).eq("ativo", true)
      .not("id", "in", `(${idsVivos.join(",")})`);
  }

  /* O ACHADO NASCE EM QUARENTENA. `a_confirmar` não aparece na tela: antes de
     virar aviso, a ação `confirmar` abre o anúncio e checa se tem estoque e
     quanto é o frete. A página de BUSCA mostra produto esgotado com o último
     preço praticado — que fica bonito justamente por não estar mais à venda —,
     então avisar direto dela é prometer uma compra que pode não existir.
     Máximo de três, mínimo histórico na frente. */
  const ordem: Record<string, number> = { minimo_historico: 0, queda_forte: 1, alvo_batido: 2 };
  candidatos.sort((a, b) => (ordem[a.classe.tipo] ?? 9) - (ordem[b.classe.tipo] ?? 9) || a.total - b.total);

  /* UM PRODUTO, UM AVISO. Buscapé, Zoom e Bondfaro são do mesmo grupo e
     listaram o MESMO notebook a R$ 2.969,10 — três avisos idênticos na tela,
     que é o começo do fim da confiança na aba. As três OFERTAS continuam
     gravadas (o histórico de preço de cada fonte é legítimo); o que não se
     repete é o aviso. */
  const vistos = new Set<string>();
  const unicos = candidatos.filter((c) => {
    const k = chaveDoProduto(c.titulo, c.total);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  res.repetidos = candidatos.length - unicos.length;

  for (const c of unicos.slice(0, MAX_ALERTAS_POR_ALVO)) {
    const { error } = await supabase.from("facilities_radar_alertas").insert({
      alvo_id: alvo.id, oferta_id: c.ofertaId, tipo: c.classe.tipo,
      texto: c.classe.texto, preco: c.total, preco_total: c.total,
      frete_valor: c.frete, preco_alvo: precoAlvo,
      economia: economiaDe(precoAlvo, c.total, alvo.quantidade ?? 1),
      status: "a_confirmar",
    });
    // 23505 = já existe alerta deste anúncio por este preço. É o comportamento
    // desejado (não repetir), não um erro.
    if (!error) res.alertas++;
    else if (error.code !== "23505") console.error("insert alerta", error.message);
  }

  /* "fora do rodízio" não é problema — é o desenho. Só entra em `ultimo_erro`
     o que de fato falhou, senão o card do alvo ficaria amarelo para sempre e o
     aviso deixaria de significar alguma coisa. */
  const ehOk = (v: string) => /^\d+ anúncios/.test(v) || v.startsWith("fora do rodízio");
  const falhas = Object.entries(res.fontes).filter(([, v]) => !ehOk(v));
  await supabase.from("facilities_radar_alvos").update({
    ultima_varredura: new Date().toISOString(),
    ultimo_erro: falhas.length ? falhas.map(([k, v]) => `${k}: ${v}`).join(" | ") : null,
    rodadas: Number(alvo.rodadas ?? 0) + 1,
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

    /* ------------------------------------------------------ confirmar */
    /* A segunda metade do radar: tira o achado da quarentena.
       Cada alerta em `a_confirmar` tem o anúncio ABERTO um a um. Só vira aviso
       (`novo`) o que ainda tem estoque e ainda cabe no teto COM o frete. O que
       não passa vira `indisponivel`/`descartado` e nunca chega à tela — mas fica
       gravado, porque "sumiu antes de eu ver" é informação sobre o mercado. */
    if (action === "confirmar") {
      /* Seis por rodada, não doze: com nove em paralelo, sete deram erro de leitura
         na medição de 26/08/2026 — o Firecrawl não gosta de rajada. Quem não
         couber fica na fila e é pego na rodada seguinte. */
      const limite = Number(body?.limite ?? 4);
      let q = supabase
        .from("facilities_radar_alertas")
        .select("id, alvo_id, oferta_id, preco_alvo, texto, tipo, facilities_radar_ofertas(id,url,titulo,preco,conferir), facilities_radar_alvos(quantidade)")
        .eq("status", "a_confirmar")
        .order("created_at", { ascending: true })
        .limit(limite);
      if (body?.alvo_id) q = q.eq("alvo_id", body.alvo_id);

      /* QUARENTENA TEM PRAZO. Um anúncio cuja página nunca abre ficaria em
         `a_confirmar` para sempre, e a fila encheria de zumbi — cada rodada
         gastando crédito nos mesmos links mortos e empurrando os achados novos
         para o fim. Dois dias de tentativa é generoso: são quatro rodadas de
         cron. Depois disso vira `descartado`, com o motivo escrito. */
      const limiteIdade = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { data: velhos } = await supabase.from("facilities_radar_alertas")
        .update({ status: "descartado", texto: "não consegui abrir o anúncio em 48h de tentativas" })
        .eq("status", "a_confirmar").lt("created_at", limiteIdade)
        .select("id");

      const { data: fila, error: erroFila } = await q;
      if (erroFila) throw new Error(erroFila.message);
      if (!fila?.length) {
        return json({ ok: true, confirmados: 0, desistidos: velhos?.length ?? 0, mensagem: "Nada na fila de confirmação." });
      }

      /* EM LEVAS DE DOIS, e não tudo de uma vez. Confirmar seis em paralelo
         matou o worker com WORKER_RESOURCE_LIMIT: cada uma pode fazer DUAS
         raspagens (com CEP e, se falhar, sem) e segura o markdown inteiro na
         memória enquanto a IA lê. Paralelismo aqui não economiza tanto quanto
         nas fontes — são páginas menores — e o custo de errar é a rodada toda
         morrer sem devolver relatório. */
      const saidas: any[] = [];
      const LEVA = 2;
      const confirmarUm = async (al: any) => {
        const of = al.facilities_radar_ofertas;
        if (!of?.url) return { id: al.id, desfecho: "sem link" };

        const c = await confirmarNoAnuncio(of.url);
        if (c.erro) {
          /* Erro de leitura NÃO condena o anúncio. Fica na fila e tenta de novo
             na próxima rodada — descartar por falha nossa jogaria fora achado
             bom toda vez que o Firecrawl tossisse. */
          return { id: al.id, desfecho: `erro: ${c.erro.slice(0, 80)}` };
        }

        if (c.disponivel === false) {
          await supabase.from("facilities_radar_alertas")
            .update({ status: "indisponivel", texto: al.texto + " · esgotado quando fomos conferir" })
            .eq("id", al.id);
          await supabase.from("facilities_radar_ofertas")
            .update({ disponivel: false, ativo: false, confirmado_em: new Date().toISOString() })
            .eq("id", of.id);
          return { id: al.id, desfecho: "esgotado" };
        }

        // O preço da página do anúncio vale mais que o da busca: é o que a
        // pessoa vai encontrar ao clicar.
        const preco = c.preco ?? Number(of.preco);
        const total = preco + (c.frete_valor ?? 0);
        const qtd = Number(al.facilities_radar_alvos?.quantidade ?? 1);
        const teto = Number(al.preco_alvo);

        const conferir = (of.conferir ?? []).filter((x: string) => x !== "se está em estoque" && (c.frete_valor == null || x !== "valor do frete"));

        await supabase.from("facilities_radar_ofertas").update({
          preco, preco_total: total,
          frete_valor: c.frete_valor, frete_texto: c.frete_texto,
          frete_gratis: c.frete_valor === 0,
          disponivel: c.disponivel ?? null,
          /* A confirmação COMPLETA o que a busca leu, não apaga. Foto e nota às
             vezes vêm melhor da página de busca, às vezes da do produto —
             sobrescrever com null perderia o que já estava certo. */
          ...(c.avaliacao != null ? { avaliacao: c.avaliacao } : {}),
          ...(c.avaliacoes != null ? { avaliacoes: c.avaliacoes } : {}),
          ...(c.imagem_url ? { imagem_url: c.imagem_url } : {}),
          conferir,
          // Guarda o endereço RESOLVIDO: o aviso passa a levar direto à loja,
          // e não ao redirecionador do comparador. E o vendedor deixa de ser
          // "Buscapé" (que não vende nada) para ser quem realmente vende.
          url: c.url || of.url,
          ...(c.loja ? { vendedor: c.loja } : {}),
          confirmado_em: new Date().toISOString(),
        }).eq("id", of.id);

        if (total > teto) {
          await supabase.from("facilities_radar_alertas").update({
            status: "descartado",
            texto: `no anúncio saiu R$ ${total.toFixed(0)}${c.frete_valor ? ` (com R$ ${c.frete_valor.toFixed(0)} de frete)` : ""}, acima do teto`,
          }).eq("id", al.id);
          return { id: al.id, desfecho: "passou do teto ao conferir" };
        }

        await supabase.from("facilities_radar_alertas").update({
          status: "novo",
          preco: total, preco_total: total, frete_valor: c.frete_valor,
          economia: economiaDe(teto, total, qtd),
          texto: al.texto + (c.observacao ? ` · ${c.observacao}` : ""),
        }).eq("id", al.id);
        return { id: al.id, desfecho: "confirmado" };
      };

      for (let i = 0; i < fila.length; i += LEVA) {
        // O relógio manda: o que não couber fica na fila e é pego na próxima.
        if (Date.now() - t0 > ORCAMENTO_MS) break;
        saidas.push(...await Promise.all(fila.slice(i, i + LEVA).map(confirmarUm)));
      }

      /* O RELATÓRIO CARREGA O ERRO INTEIRO, não só a contagem. "erro: 7" não
         diz se foi bloqueio de robô, página fora do ar ou crédito acabado — e
         são três problemas com três soluções diferentes. Agrupar sem a
         mensagem é o mesmo pecado do "0 anúncios" que passa por sucesso. */
      const conta: Record<string, number> = {};
      const erros: Record<string, number> = {};
      for (const s of saidas as any[]) {
        const chave = s.desfecho.startsWith("erro:") ? "erro" : s.desfecho;
        conta[chave] = (conta[chave] ?? 0) + 1;
        if (chave === "erro") {
          const msg = s.desfecho.slice(6).trim();
          erros[msg] = (erros[msg] ?? 0) + 1;
        }
      }
      return json({
        ok: true,
        confirmados: conta["confirmado"] ?? 0,
        fila: fila.length,
        desfechos: conta,
        // Quem errou continua em `a_confirmar` e é retentado — falha nossa não
        // condena o anúncio.
        erros: Object.entries(erros).map(([m, n]) => `${n}× ${m}`),
        duracao_ms: Date.now() - t0,
      });
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
          alertas: 0, repetidos: 0, fontes: { erro: String(e) }, top_recusas: [],
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
