// Coletor genérico via Firecrawl + extração estruturada com Gemini.
// Usado pelas fontes que não têm API pública (BNDES, Sebrae, Finep, EMBRAPII, InovAtiva, Gov.br).
import { corsHeaders } from "./cors.ts";
import { getServiceClient, upsertEditais, type RawEdital } from "./normalize.ts";
import { calculateEditalRelevance, loadFilterSettings, validateEdital } from "./relevance.ts";
import { generateJSON, MODELO_LITE } from "./gemini.ts";
import { podeGastar, registrarGasto } from "./firecrawl.ts";

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

/**
 * `timeoutMs` existe por causa do aprofundamento. Noventa segundos é generoso
 * para a leitura PRINCIPAL, que é o trabalho da rodada; para o extra, que roda
 * depois de tudo, noventa segundos é a diferença entre "o edital entrou sem
 * prazo" e "o worker morreu e a coleta inteira se perdeu".
 */
async function firecrawlScrape(
  url: string,
  apiKey: string,
  waitFor?: number,
  timeoutMs = 90_000,
  /**
   * `false` (o padrão) na LISTAGEM, porque ali os editais moram em blocos que o
   * extrator de conteúdo principal costuma jogar fora junto com o menu.
   *
   * `true` na página de UM edital, e isso é o oposto pela mesma razão: medido em
   * 27/08/2026, a página do FIP-IA do BNDES devolveu 8.820 caracteres em que os
   * primeiros mil eram "Ir para o conteúdo", "GovBR", "Acessibilidade" e o resto
   * do portal. A IA recebia o menu e respondia, corretamente, que não havia
   * edital ali.
   */
  onlyMainContent = false,
): Promise<{ markdown: string; status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = {
      url,
      formats: ["markdown"],
      onlyMainContent,
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

/**
 * `opts` existe para o aprofundamento, e a razão é medida.
 *
 * Na listagem, o trabalho da IA é garimpar vários editais no meio de menus e
 * rodapés — vale o modelo cheio, raciocinando. Na página de UM edital, o
 * trabalho é copiar prazo, número e valor de um texto que já fala só disso: o
 * modelo cheio leva ~50s para isso (medido no radar de preços, mesmo tipo de
 * tarefa) e o raciocínio inteiro vai para o lixo, porque `generateJSON`
 * descarta as partes `thought`.
 *
 * E cinquenta segundos, no extra, não é lentidão: é a rodada morrendo aos 150s.
 * Foi o que aconteceu na estreia — as duas leituras do BNDES estouraram o prazo
 * de 30s e o aprofundamento voltou de mãos vazias tendo gasto o crédito.
 */
async function extractItems(
  markdown: string,
  baseUrl: string,
  contexto: string,
  opts: { model?: string; thinking?: "low" | "high"; maxChars?: number } = {},
): Promise<ExtractedItem[]> {
  if (!markdown || markdown.length < 50) return [];
  // limita p/ não estourar token
  const teto = opts.maxChars ?? 25000;
  const trimmed = markdown.length > teto ? markdown.slice(0, teto) : markdown;
  try {
    const out = await generateJSON<{ itens: ExtractedItem[] }>({
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
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

/**
 * A página de UM edital vira os campos que faltavam.
 *
 * POR QUE NÃO REUSAR `extractItems`. O prompt dela diz "retorne SOMENTE
 * oportunidades reais, ignore navegação; se não houver itens claros, devolva
 * lista vazia" — instruções escritas para uma LISTAGEM, onde a IA precisa
 * garimpar editais no meio do site. Apontada para a página de um edital só, ela
 * fazia exatamente o que foi mandada fazer: não reconhecia uma listagem e
 * devolvia vazio. Medido nas duas chamadas públicas do BNDES em 27/08/2026.
 *
 * Aqui a premissa é outra e está dita: esta página É o edital. O trabalho é
 * copiar prazo, número e valor — e devolver vazio quando não estiverem lá, que
 * é diferente de devolver vazio por não achar uma lista.
 */
async function extrairUmEdital(markdown: string, url: string): Promise<ExtractedItem | null> {
  if (!markdown || markdown.length < 200) return null;
  try {
    const out = await generateJSON<ExtractedItem>({
      model: MODELO_LITE,
      thinking: "low",
      messages: [
        {
          role: "system",
          content:
            "Você lê a página de UM edital/chamada pública brasileira e copia os dados dele. " +
            "A página É o edital — não procure uma lista. Copie apenas o que estiver escrito: " +
            "deixe o campo vazio quando a página não disser, e NUNCA calcule nem deduza uma data. " +
            "`prazo_envio` é a data FINAL para inscrição/submissão, no formato YYYY-MM-DD. " +
            "`valor_estimado` é o total dos recursos da chamada, em reais, só o número.",
        },
        { role: "user", content: `URL: ${url}\n\n${markdown.slice(0, 12_000)}` },
      ],
      responseSchema: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          objeto: { type: "string", description: "O que a chamada financia, em uma ou duas frases" },
          numero: { type: "string" },
          prazo_envio: { type: "string", description: "YYYY-MM-DD" },
          valor_estimado: { type: "number" },
        },
        required: ["titulo"],
      },
      temperature: 0.1,
    });
    return out?.titulo ? out : null;
  } catch (e) {
    console.error("extrairUmEdital", url, e);
    throw e;
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

/**
 * QUANTOS RESULTADOS DA BUSCA SÃO ABERTOS, por rodada desta fonte.
 *
 * O PROBLEMA. A busca devolve título e descrição, e era isso que virava edital.
 * Só que a descrição do Google é uma frase cortada — dela não sai prazo, não sai
 * valor e não sai número do edital. Resultado, medido em 27/08/2026: 126 editais
 * entraram em 30 dias e a maioria sem `prazo_envio`. Sem prazo não há como
 * priorizar, e uma lista de oportunidades que não dá para priorizar é uma lista
 * que ninguém abre — o radar de editais estava colhendo e jogando fora.
 *
 * A PÁGINA TEM O QUE FALTA. Abrir o edital custa 1 crédito e devolve o que a
 * busca não tem. Mas abrir os 10 resultados de cada uma das 8 buscas seriam 80
 * créditos por dia (2.400 por mês) para reler, na maioria das vezes, links que o
 * filtro de relevância vai esconder de qualquer jeito.
 *
 * ENTÃO SÓ OS FINALISTAS, e a régua já existe: `calculateEditalRelevance` é a
 * mesma que decide o que aparece na tela. Abre-se o que ficaria VISÍVEL e ainda
 * está sem prazo — quem já tem prazo não precisa da leitura, e quem vai ficar
 * oculto por baixa relevância não merece o crédito. Dois por rodada, por fonte:
 * com quatro fontes que buscam, são 8 créditos/dia, ~240/mês.
 *
 * É o mesmo princípio da conferência do radar de preços: filtro barato em tudo,
 * leitura cara só no que vira ação.
 */
const APROFUNDAR_POR_RODADA = 2;

/**
 * ATÉ QUANDO AINDA CABE APROFUNDAR — e este número foi cobrado em produção.
 *
 * O worker do Supabase é derrubado por volta dos 150s, e não com uma exceção que
 * se possa pegar: o processo morre, a resposta nunca sai, e o cliente recebe
 * `HTTP 546`. O coletor de editais nunca teve relógio porque nunca precisou —
 * uma página mais uma extração cabiam com folga. O aprofundamento mudou isso:
 * ele acrescenta até duas leituras (90s de teto cada) mais duas chamadas de IA
 * DEPOIS de a rodada já ter feito o trabalho dela.
 *
 * Foi exatamente o que aconteceu na estreia, em 27/08/2026: a rodada da
 * InovAtiva que não achou candidato respondeu 200 em segundos; as que acharam
 * morreram com 546. O sintoma é traiçoeiro porque o trabalho principal já estava
 * feito — a coleta inteira era perdida na hora de gravar, por causa do extra.
 *
 * Setenta e cinco segundos deixam margem para uma leitura longa e para o
 * `upsertEditais`, que é quem de fato precisa terminar. Aprofundamento que não
 * cabe simplesmente não acontece: o edital entra sem prazo, como entrava antes,
 * e a próxima rodada tenta de novo.
 */
const PRAZO_PARA_APROFUNDAR_MS = 60_000;

/* Os dois tetos do extra. A conta que os define é de subtração, e é o que
   mantém a rodada viva: 60s de prazo para começar + 30s de leitura + 30s de IA
   = 120s, deixando ~30s dos 150s do worker para `upsertEditais` gravar. Com os
   90s padrão da leitura, um único aprofundamento estouraria sozinho. */
const TETO_LEITURA_EXTRA_MS = 30_000;
const TETO_IA_EXTRA_MS = 30_000;

/** O MESMO piso que o `upsertEditais` usa para decidir se a página é um edital
 *  ou uma notícia. Repetido aqui de propósito, e não afrouxado: abrir com uma
 *  régua mais leniente do que a que vai julgar depois é pagar para colher o que
 *  já se sabe que será escondido. */
const MIN_CONFIANCA_PARA_ABRIR = 45;

/** Promessa com prazo. O que estoura vira erro nomeado, não worker morto. */
function comPrazo<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${oque} não respondeu em ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

/**
 * Completa o que a busca não trouxe, abrindo a página do edital.
 *
 * SÓ PREENCHE BURACO — nunca sobrescreve. O que a busca trouxe veio de um
 * agregador confiável (o próprio Google), e a extração de uma página inteira
 * erra mais que um snippet curto. Se a página disser um prazo diferente do que
 * já temos, o nosso fica: a leitura está aqui para achar o que falta, não para
 * abrir uma disputa que ninguém está em posição de arbitrar.
 */
async function aprofundar(
  raws: RawEdital[],
  cfg: FirecrawlCollectorConfig,
  apiKey: string,
  settings: any,
  supa: any,
  logs: Array<Record<string, unknown>>,
  started: number,
): Promise<number> {
  /* O RELÓGIO ANTES DE TUDO. Se a coleta já comeu o prazo, nem se monta a lista
     de candidatos: o que importa agora é sobrar tempo para GRAVAR o que já foi
     apurado. Rodada que morre aos 150s não devolve nada — nem o que tinha dado
     certo antes do extra. */
  if (Date.now() - started > PRAZO_PARA_APROFUNDAR_MS) {
    logs.push({ aprofundamento: "pulado", motivo: "a coleta consumiu o prazo da rodada" });
    return 0;
  }

  /* DUAS RÉGUAS, E A SEGUNDA FOI COMPRADA COM CRÉDITO. A primeira versão
     escolhia por relevância (`visibility_status === "visivel"`) e só isso —
     e na estreia, em 27/08/2026, gastou uma leitura na página "Desempenho
     operacional do BNDES em 2025", uma NOTÍCIA. Ela é relevante pelo vocabulário
     (fomento, inovação, bilhões) e por isso passava; o que ela não é é um
     edital, e quem sabe disso é `validateEdital` — que até então só rodava lá na
     frente, dentro do `upsertEditais`, depois de o crédito já ter saído.
     Agora as duas perguntas são feitas ANTES de pagar: "isto interessa?" e
     "isto é mesmo um edital?". O piso de confiança é o mesmo do upsert (45),
     de propósito: abrir o que vai ser escondido depois é a definição de
     desperdício. */
  const candidatos = raws
    .filter((r) => !r.prazo_envio && !r.valor_estimado)
    .map((r) => ({
      raw: r,
      rel: calculateEditalRelevance({
        titulo: r.titulo, objeto: r.objeto, orgao: r.orgao, modalidade: r.modalidade,
        regiao: r.regiao, prazo_envio: r.prazo_envio, fonte: r.fonte, fonte_slug: r.fonte_slug,
      }, settings),
      val: validateEdital({
        titulo: r.titulo, objeto: r.objeto, link: r.link,
        numero: r.numero, prazo_envio: r.prazo_envio, modalidade: r.modalidade,
      }, MIN_CONFIANCA_PARA_ABRIR),
    }))
    .filter((c) => c.rel.visibility_status === "visivel" && c.val.is_edital)
    .sort((a, b) => b.rel.score - a.rel.score)
    .slice(0, APROFUNDAR_POR_RODADA);

  if (!candidatos.length) return 0;

  const v = await podeGastar(supa, "editais", candidatos.length);
  if (!v.pode) {
    logs.push({ aprofundamento: "pulado", motivo: v.motivo });
    return 0;
  }

  let gastos = 0;
  for (const c of candidatos) {
    const link = c.raw.link;
    if (!link) continue;
    /* E o relógio ENTRE os candidatos, não só antes do primeiro: a leitura tem
       teto de 90s, então o segundo aprofundamento pode começar já sem margem
       para terminar. Melhor um edital completo e um sem prazo do que a rodada
       inteira perdida. */
    if (Date.now() - started > PRAZO_PARA_APROFUNDAR_MS) {
      logs.push({ aprofundamento: "interrompido", motivo: "acabou o prazo da rodada", faltaram: candidatos.length - gastos });
      break;
    }
    try {
      // `onlyMainContent: true`: aqui o menu do portal é ruído, não conteúdo.
      const { markdown, status } = await firecrawlScrape(link, apiKey, undefined, TETO_LEITURA_EXTRA_MS, true);
      gastos++;
      if (status >= 400 || !markdown) {
        logs.push({ aprofundou: link, status, motivo: "não abriu" });
        continue;
      }
      /* A IA TAMBÉM PRECISA DE PRAZO. `generateJSON` não tem nenhum, e uma
         chamada travada aqui segura o worker até os 150s — mesmo desfecho da
         leitura sem teto, por outra porta. */
      const it = await comPrazo(
        extrairUmEdital(markdown, link),
        TETO_IA_EXTRA_MS,
        "a leitura do edital pela IA",
      );
      if (!it) {
        logs.push({ aprofundou: link, status, motivo: "a página abriu mas nada foi extraído" });
        continue;
      }
      c.raw.prazo_envio = c.raw.prazo_envio ?? it.prazo_envio ?? null;
      c.raw.numero = c.raw.numero ?? it.numero ?? null;
      c.raw.valor_estimado = c.raw.valor_estimado || it.valor_estimado || parseValorBR(`${it.titulo} ${it.objeto ?? ""}`);
      // O objeto da página é uma frase inteira; o da busca é um trecho cortado
      // com reticências. Aqui vale trocar, porque não é fato conflitante — é a
      // mesma informação, completa.
      if (it.objeto && it.objeto.length > String(c.raw.objeto ?? "").length) c.raw.objeto = it.objeto;
      logs.push({ aprofundou: link, status, prazo: c.raw.prazo_envio, valor: c.raw.valor_estimado });
    } catch (e) {
      logs.push({ aprofundou: link, erro: String(e) });
    }
  }
  await registrarGasto(supa, "editais", gastos, { fonte: cfg.slug, acao: "aprofundar" });
  return gastos;
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

  /* O FREIO, ANTES DE QUALQUER LEITURA. O radar de editais dividia o pote com o
     radar de preços sem olhar freio nenhum: quem rodasse primeiro no dia levava.
     A conta desta rodada é uma raspagem por página mais 2 créditos por busca
     (o Firecrawl cobra 2 a cada 10 resultados), e o aprofundamento pede o dele
     depois, já sabendo quantos finalistas apareceram.
     Parar aqui, ANTES de gastar, é o que permite dizer "não coletei hoje porque
     o quinhão acabou" — que é uma resposta. Coletar metade e parar no meio
     produziria uma lista curta indistinguível de um dia sem editais. */
  const custoPrevisto = (cfg.pages?.length ?? 0) + (cfg.searches?.length ?? 0) * 2;
  const orcamento = await podeGastar(supa, "editais", custoPrevisto);
  if (!orcamento.pode) {
    return new Response(JSON.stringify({
      ok: true, fonte: cfg.slug, status: "freado",
      mensagem: `coleta suspensa: ${orcamento.motivo}.`,
      capturados: 0, novos: 0, duplicados: 0, descartados_filtro: 0, erros: [],
      saldo: orcamento.saldo,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  /** O que esta rodada pediu ao Firecrawl. Ver `registrarGasto` no fim. */
  let creditos = 0;

  for (const page of cfg.pages ?? []) {
    const t0 = Date.now();
    try {
      const { markdown, status } = await firecrawlScrape(page.url, apiKey, page.waitFor);
      creditos++;
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
      // 2 créditos a cada 10 resultados, arredondando para cima — é assim que o
      // Firecrawl cobra a busca, independente de a página ser lida ou não.
      creditos += Math.ceil((s.limit ?? 10) / 10) * 2;
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

  /* O APROFUNDAMENTO VEM ANTES DO UPSERT, e essa ordem é a coisa toda: o prazo
     e o valor achados na página do edital precisam estar no registro no momento
     em que ele é gravado. Depois seria um segundo `update` por linha — e, pior,
     o edital nasceria na tela sem prazo e ganharia um minuto depois, o que na
     prática significa que quem olhasse o alerta veria a versão pobre. */
  await registrarGasto(supa, "editais", creditos, { fonte: cfg.slug, paginas: cfg.pages?.length ?? 0, buscas: cfg.searches?.length ?? 0 });
  const aprofundados = await aprofundar(raws, cfg, apiKey, settings, supa, logs, started);

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
    creditos: creditos + aprofundados,
    aprofundados,
    mensagem: resultadoVazio
      ? `Firecrawl rodou em ${totalEntradas} entradas mas nenhum item passou nos filtros.`
      : `${novos} novos visíveis, ${ocultados} ocultos por baixa relevância (de ${capturados} capturados via Firecrawl)` +
        (aprofundados ? `; ${aprofundados} tiveram a página aberta para achar prazo e valor.` : "."),
    duracao_ms: Date.now() - started,
    erros: errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
