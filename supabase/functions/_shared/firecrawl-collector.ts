// Coletor genérico via Firecrawl + extração estruturada com Gemini.
// Usado pelas fontes que não têm API pública (BNDES, Sebrae, Finep, EMBRAPII, InovAtiva, Gov.br).
import { corsHeaders } from "./cors.ts";
import { getServiceClient, upsertEditais, type RawEdital } from "./normalize.ts";
import { loadFilterSettings } from "./relevance.ts";
import { generateJSON } from "./gemini.ts";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";

interface FirecrawlPage {
  url: string;
  tipo?: string;          // modalidade default p/ itens dessa página
  waitFor?: number;       // ms aguardar JS render
}

interface FirecrawlSearch {
  query: string;          // ex: 'site:bndes.gov.br "edital" 2026'
  tipo?: string;          // modalidade default
  limit?: number;         // default 10
  tbs?: string;           // ex: "qdr:m" filtra último mês
}

export interface FirecrawlCollectorConfig {
  slug: string;           // ex: "bndes"
  fonte: string;          // nome amigável ex: "BNDES"
  orgao: string;          // ex: "BNDES — Banco Nacional de Desenvolvimento"
  regiao?: string | null; // ex: "Brasil"
  pages?: FirecrawlPage[];
  searches?: FirecrawlSearch[];
  contexto: string;       // dica curta p/ a IA do que essa fonte costuma publicar
}

interface ExtractedItem {
  titulo: string;
  objeto?: string | null;
  link?: string | null;
  modalidade?: string | null;
  prazo_envio?: string | null;
  numero?: string | null;
  valor_estimado?: number | null;
}

async function firecrawlScrape(url: string, apiKey: string, waitFor?: number): Promise<{ markdown: string; status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const body: Record<string, unknown> = {
      url,
      formats: ["markdown"],
      onlyMainContent: false,
    };
    if (waitFor && waitFor > 0) body.waitFor = waitFor;
    const r = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({} as any));
    const md = data?.data?.markdown ?? data?.markdown ?? "";
    return { markdown: String(md ?? ""), status: r.status };
  } finally { clearTimeout(t); }
}

interface SearchResult { url: string; title?: string; description?: string; markdown?: string }

async function firecrawlSearch(query: string, apiKey: string, limit = 10, tbs?: string): Promise<{ results: SearchResult[]; status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const body: Record<string, unknown> = { query, limit };
    if (tbs) body.tbs = tbs;
    const r = await fetch(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({} as any));
    // v2: { success, data: { web: [{url,title,description}] } } OR { data: [...] }
    const arr = data?.data?.web ?? data?.data ?? [];
    const results: SearchResult[] = Array.isArray(arr) ? arr.map((x: any) => ({
      url: x?.url ?? x?.link ?? "",
      title: x?.title ?? "",
      description: x?.description ?? x?.snippet ?? "",
      markdown: x?.markdown ?? "",
    })).filter((x) => x.url) : [];
    return { results, status: r.status };
  } finally { clearTimeout(t); }
}

const SCHEMA = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          objeto: { type: "string" },
          link: { type: "string" },
          modalidade: { type: "string" },
          prazo_envio: { type: "string", description: "Data no formato YYYY-MM-DD se houver" },
          numero: { type: "string" },
          valor_estimado: { type: "number" },
        },
        required: ["titulo"],
      },
    },
  },
  required: ["itens"],
};

async function extractItems(markdown: string, baseUrl: string, contexto: string): Promise<ExtractedItem[]> {
  if (!markdown || markdown.length < 50) return [];
  // limita p/ não estourar token
  const trimmed = markdown.length > 25000 ? markdown.slice(0, 25000) : markdown;
  try {
    const out = await generateJSON<{ itens: ExtractedItem[] }>({
      messages: [
        {
          role: "system",
          content:
            "Você extrai chamadas/editais/programas de fomento de páginas web brasileiras. " +
            "Retorne SOMENTE oportunidades reais (não inclua links de navegação, footer, login, notícias antigas sem chamada ativa). " +
            "Se não houver itens claros, retorne lista vazia. " +
            "Datas SEMPRE no formato YYYY-MM-DD.",
        },
        {
          role: "user",
          content:
            `Contexto da fonte: ${contexto}\n` +
            `URL base (para resolver links relativos): ${baseUrl}\n\n` +
            `Conteúdo da página (markdown):\n${trimmed}`,
        },
      ],
      responseSchema: SCHEMA,
      temperature: 0.1,
    });
    return Array.isArray(out?.itens) ? out.itens : [];
  } catch (e) {
    console.error("extractItems failed", e);
    return [];
  }
}

function absLink(link: string | null | undefined, baseUrl: string): string | null {
  if (!link) return null;
  try {
    const abs = new URL(link, baseUrl).toString();
    // Remove tokens de sessão IBM WebSphere (BNDES) que expiram
    return abs.replace(/\/!ut\/p\/[^?#]*/i, "").replace(/\/+$/, "");
  } catch { return link; }
}

function cleanTitle(s: string): string {
  return (s || "").replace(/\s*\.{3,}\s*$/, "").replace(/\s+-\s+[^-]{2,40}$/, (m) => {
    return /\b(BNDES|Finep|Sebrae|EMBRAPII|Gov\.br|FAPES|InovAtiva)\b/i.test(m) ? "" : m;
  }).trim();
}

// URLs que sinalizam edital/oportunidade (prioriza) vs. ruído (ignora)
const URL_RELEVANT = /(edital|chamada|chamamento|subven[çc][ãa]o|oportunidade|fomento|programa|selecao|sele[çc][ãa]o|inscric|inscri[çc])/i;
const URL_IRRELEVANT = /(noticia|not[íi]cia|\/blog\/|imprensa|\/eventos?\/|resultado|transparencia|transpar[êe]ncia|historico|hist[óo]rico|\.jpg|\.png|\/tag\/|\/categoria\/)/i;

// Segmentos de caminho que SEMPRE indicam ruído (notícia, blog, imprensa…),
// mesmo que o slug contenha "edital"/"chamada". Ex: /noticias/fapes-lanca-edital-x
const URL_HARD_NOISE = /\/(noticias?|blog|imprensa|sala-de-imprensa|press|eventos?|agenda|galeria|videos?|podcasts?|tag|tags|categoria|categorias|busca|search|resultados?|aprovados|homologa)\b/i;

/** true se a URL deve ser descartada (ruído conhecido e sem sinal de edital) */
export function urlIsNoise(url: string | null | undefined): boolean {
  const u = (url || "").toLowerCase();
  if (!u) return false;
  // Caminho de notícia/blog/imprensa é ruído absoluto — "edital" no slug não salva
  let path = u;
  try { path = new URL(u).pathname; } catch { /* usa a string toda */ }
  if (URL_HARD_NOISE.test(path)) return true;
  if (URL_RELEVANT.test(u)) return false; // sinal positivo vence o ruído brando
  return URL_IRRELEVANT.test(u);
}


// Extrai valor "R$ 10,6 milhões", "R$ 1,8 bi", "R$ 56 mil" → número em reais
export function parseValorBR(text: string | null | undefined): number {
  if (!text) return 0;
  const m = text.match(/R\$\s*([\d.,]+)\s*(bilh[õo]es?|bi|milh[õo]es?|mi|mil)?/i);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  if (!isFinite(num)) return 0;
  const unit = (m[2] || "").toLowerCase();
  if (/bilh|^bi$/.test(unit)) return num * 1_000_000_000;
  if (/milh|^mi$/.test(unit)) return num * 1_000_000;
  if (/^mil$/.test(unit)) return num * 1_000;
  return num;
}

export async function runFirecrawlCollector(cfg: FirecrawlCollectorConfig): Promise<Response> {
  const started = Date.now();
  const apiKey = Deno.env.get("CHAVE_API_FIRCRAWL") ?? Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({
      ok: false, fonte: cfg.slug, status: "erro",
      mensagem: "FIRECRAWL_API_KEY não configurada",
      capturados: 0, novos: 0, duplicados: 0, descartados_filtro: 0, erros: ["missing FIRECRAWL_API_KEY"],
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supa = getServiceClient();
  const settings = await loadFilterSettings(supa);
  const raws: RawEdital[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const errors: unknown[] = [];
  let capturados = 0;

  for (const page of cfg.pages ?? []) {
    const t0 = Date.now();
    try {
      const { markdown, status } = await firecrawlScrape(page.url, apiKey, page.waitFor);
      if (status >= 400) {
        logs.push({ url: page.url, status, motivo: `Firecrawl HTTP ${status}` });
        errors.push({ url: page.url, status });
        continue;
      }
      const items = await extractItems(markdown, page.url, cfg.contexto);
      capturados += items.length;
      for (const it of items) {
        if (!it.titulo || it.titulo.length < 8) continue;
        const link = absLink(it.link ?? null, page.url);
        raws.push({
          external_id: link ?? `${page.url}#${it.titulo.slice(0, 80)}`,
          titulo: it.titulo,
          orgao: cfg.orgao,
          modalidade: it.modalidade ?? page.tipo ?? null,
          numero: it.numero ?? null,
          objeto: it.objeto ?? it.titulo,
          valor_estimado: it.valor_estimado || parseValorBR(`${it.titulo} ${it.objeto ?? ""}`),
          data_publicacao: null,
          data_abertura: null,
          prazo_envio: it.prazo_envio ?? null,
          link: link ?? page.url,
          regiao: cfg.regiao ?? "Brasil",
          fonte: cfg.fonte,
          fonte_slug: cfg.slug,
        });
      }
      logs.push({ url: page.url, status, itens_pagina: items.length, md_len: markdown.length, md_preview: markdown.slice(0, 300), ms: Date.now() - t0 });
    } catch (e) {
      const msg = String(e);
      errors.push({ url: page.url, error: msg });
      logs.push({ url: page.url, erro: msg, ms: Date.now() - t0 });
    }
  }

  // Firecrawl Search: usa Google p/ achar editais e passa o agregado p/ Gemini filtrar
  for (const s of cfg.searches ?? []) {
    const t0 = Date.now();
    try {
      const { results, status } = await firecrawlSearch(s.query, apiKey, s.limit ?? 10, s.tbs);
      if (status >= 400) {
        logs.push({ query: s.query, status, motivo: `Firecrawl Search HTTP ${status}` });
        errors.push({ query: s.query, status });
        continue;
      }
      if (results.length === 0) {
        logs.push({ query: s.query, status, resultados: 0, ms: Date.now() - t0 });
        continue;
      }
      // Converte direto cada resultado em raw — relevance/dedupe filtram qualidade
      capturados += results.length;
      for (const r of results) {
        const titulo = cleanTitle(r.title || "");
        if (!titulo || titulo.length < 8) continue;
        // Ignora URLs de ruído (notícias, blog, imprensa, eventos, resultado...)
        if (urlIsNoise(r.url)) continue;
        const link = absLink(r.url, r.url) ?? r.url;

        raws.push({
          external_id: link,
          titulo,
          orgao: cfg.orgao,
          modalidade: s.tipo ?? null,
          numero: null,
          objeto: r.description || titulo,
          valor_estimado: parseValorBR(`${titulo} ${r.description ?? ""}`),
          data_publicacao: null,
          data_abertura: null,
          prazo_envio: null,
          link,
          regiao: cfg.regiao ?? "Brasil",
          fonte: cfg.fonte,
          fonte_slug: cfg.slug,
        });
      }
      logs.push({ query: s.query, status, resultados: results.length, ms: Date.now() - t0 });
    } catch (e) {
      const msg = String(e);
      errors.push({ query: s.query, error: msg });
      logs.push({ query: s.query, erro: msg, ms: Date.now() - t0 });
    }
  }

  const { novos, duplicados, ocultados } = await upsertEditais(supa, raws, [], cfg.slug, settings);
  const resultadoVazio = novos === 0 && duplicados === 0;
  const status = errors.length > 0 && capturados === 0 ? "erro"
               : resultadoVazio ? "funcionando_sem_resultados" : "sucesso";
  const totalEntradas = (cfg.pages?.length ?? 0) + (cfg.searches?.length ?? 0);

  return new Response(JSON.stringify({
    ok: errors.length === 0 || capturados > 0,
    fonte: cfg.slug,
    status,
    capturados, novos, duplicados,
    descartados_filtro: 0, ocultados,
    urls_consultadas: [
      ...(cfg.pages ?? []).map((p) => p.url),
      ...(cfg.searches ?? []).map((s) => `search:${s.query}`),
    ],
    paginas_log: logs,
    mensagem: resultadoVazio
      ? `Firecrawl rodou em ${totalEntradas} entradas mas nenhum item passou nos filtros.`
      : `${novos} novos visíveis, ${ocultados} ocultos por baixa relevância (de ${capturados} capturados via Firecrawl).`,
    duracao_ms: Date.now() - started,
    erros: errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
