import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient, upsertEditais, type RawEdital } from "../_shared/normalize.ts";
import { loadFilterSettings } from "../_shared/relevance.ts";

// FAPES — coleta editais ATIVOS da página oficial https://fapes.es.gov.br/inovacao
// via Firecrawl (renderiza JS). Parseia a estrutura "- [**EDITAL ...**](#anchor)" + linha de tabela
// com o PDF e descrição.

const FONTE = "FAPES";
const SLUG = "fapes";
const ORGAO = "FAPES — Fundação de Amparo à Pesquisa e Inovação do Espírito Santo";

const PAGES = [
  { url: "https://fapes.es.gov.br/inovacao", tipo: "chamada_publica" },
  { url: "https://fapes.es.gov.br/editais-abertos-de-inovacao", tipo: "chamada_publica" },
];

interface ParsedEdital {
  titulo: string;
  pdf?: string | null;
  descricao?: string | null;
  prazo?: string | null;
}

function parsePrazoBR(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function parseValorBR(text: string | null | undefined): number {
  if (!text) return 0;
  const m = text.match(/R\$\s*([\d.,]+)\s*(bilh[õo]es?|bi|milh[õo]es?|mi|mil)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  if (!isFinite(n)) return 0;
  const u = (m[2] || "").toLowerCase();
  if (/bilh|^bi$/.test(u)) return n * 1e9;
  if (/milh|^mi$/.test(u)) return n * 1e6;
  if (/^mil$/.test(u)) return n * 1e3;
  return n;
}

/** Extrai editais ATIVOS do markdown da página /inovacao */
function parseEditaisAtivos(md: string): ParsedEdital[] {
  const editais: ParsedEdital[] = [];
  // Captura todos os títulos de editais ativos: "- [**EDITAL FAPES Nº 06/2026 - TÍTULO**](url)"
  const titleRe = /-\s*\[\*\*\s*(EDITAL\s+FAPES\s+N[ºo°]\s*[\d/]+[^*]+?)\s*\*\*\]/gi;
  const titulosVistos = new Set<string>();
  let tm: RegExpExecArray | null;
  while ((tm = titleRe.exec(md)) !== null) {
    const titulo = tm[1].replace(/\s+/g, " ").trim();
    // Pula alterações/anexos repetidos
    const key = titulo.toLowerCase().replace(/\s*\(.*\)$/, "");
    if (titulosVistos.has(key)) continue;
    titulosVistos.add(key);
    editais.push({ titulo });
  }

  // Para cada edital ativo, busca a linha de tabela com o PDF e descrição
  // Padrão: | [TITULO](PDF_URL "...")<br>DESCRIÇÃO | DD/MM/YYYY | pdf | ...
  const rowRe = /\|\s*\[([^\]]+?)\]\((https?:\/\/[^\s)"]+\.pdf[^\s)"]*)[^)]*\)\s*(?:<br\s*\/?>([^|]+?))?\s*\|\s*(\d{2}\/\d{2}\/\d{4})?/gi;
  const rows: Array<{ titulo: string; pdf: string; descricao: string | null; data: string | null }> = [];
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(md)) !== null) {
    rows.push({
      titulo: rm[1].replace(/\s+/g, " ").trim(),
      pdf: rm[2],
      descricao: rm[3]?.replace(/\s+/g, " ").trim() ?? null,
      data: rm[4] ?? null,
    });
  }

  // Match: cada edital ativo com a primeira row cujo título começa igual
  for (const ed of editais) {
    const baseKey = ed.titulo.toLowerCase().replace(/\s*\(.*\)$/, "").slice(0, 50);
    // Tenta primeiro a row com descrição (linha principal, não anexos)
    const matchComDesc = rows.find((r) =>
      r.titulo.toLowerCase().startsWith(baseKey.slice(0, 30)) && r.descricao && r.descricao.length > 30
    );
    const match = matchComDesc ?? rows.find((r) => r.titulo.toLowerCase().startsWith(baseKey.slice(0, 30)));
    if (match) {
      ed.pdf = match.pdf;
      ed.descricao = match.descricao;
      ed.prazo = parsePrazoBR(match.data);
    }
  }

  return editais;
}

async function firecrawlScrapeMd(url: string, apiKey: string): Promise<{ md: string; status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 2000 }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({} as any));
    return { md: String(data?.data?.markdown ?? data?.markdown ?? ""), status: r.status };
  } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();

  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({
      ok: false, fonte: SLUG, status: "erro",
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
  const titulosVistos = new Set<string>();

  for (const page of PAGES) {
    const t0 = Date.now();
    try {
      const { md, status } = await firecrawlScrapeMd(page.url, apiKey);
      if (status >= 400) {
        logs.push({ url: page.url, status, motivo: `Firecrawl HTTP ${status}` });
        errors.push({ url: page.url, status });
        continue;
      }
      const editais = parseEditaisAtivos(md);
      capturados += editais.length;
      let aceitos = 0;
      for (const ed of editais) {
        const key = ed.titulo.toLowerCase().slice(0, 60);
        if (titulosVistos.has(key)) continue;
        titulosVistos.add(key);
        const link = ed.pdf ?? page.url;
        const objeto = ed.descricao ?? ed.titulo;
        raws.push({
          external_id: link,
          titulo: ed.titulo,
          orgao: ORGAO,
          modalidade: page.tipo,
          numero: ed.titulo.match(/N[ºo°]\s*([\d/]+)/i)?.[1] ?? null,
          objeto,
          valor_estimado: parseValorBR(`${ed.titulo} ${objeto}`),
          data_publicacao: null,
          data_abertura: null,
          prazo_envio: ed.prazo,
          link,
          regiao: "Espírito Santo",
          fonte: FONTE,
          fonte_slug: SLUG,
        });
        aceitos++;
      }
      logs.push({ url: page.url, status, encontrados: editais.length, aceitos, md_len: md.length, ms: Date.now() - t0 });
    } catch (e) {
      const msg = String(e);
      errors.push({ url: page.url, error: msg });
      logs.push({ url: page.url, erro: msg, ms: Date.now() - t0 });
    }
  }

  const { novos, duplicados, ocultados } = await upsertEditais(supa, raws, [], SLUG, settings);
  const resultadoVazio = novos === 0 && duplicados === 0;
  const status = errors.length > 0 && capturados === 0 ? "erro" : resultadoVazio ? "funcionando_sem_resultados" : "sucesso";

  return new Response(JSON.stringify({
    ok: errors.length === 0 || capturados > 0,
    fonte: SLUG,
    status,
    capturados,
    novos,
    duplicados,
    descartados_filtro: 0,
    ocultados,
    urls_consultadas: PAGES.map((p) => p.url),
    paginas_log: logs,
    mensagem: resultadoVazio
      ? `Nenhum edital ativo encontrado em /inovacao.`
      : `${novos} novos, ${ocultados} ocultos (de ${capturados} editais ativos).`,
    duracao_ms: Date.now() - started,
    erros: errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
