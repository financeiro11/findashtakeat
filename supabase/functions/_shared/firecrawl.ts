// Firecrawl: o cliente compartilhado e, principalmente, o guarda-corpo do
// orçamento.
//
// POR QUE ISTO EXISTE. Havia duas cópias da chamada ao Firecrawl — a do radar de
// preços (`facilities-radar/index.ts`, com CEP, retentativa e relógio de rodada)
// e a do radar de editais (`firecrawl-collector.ts`, mais simples). Elas podem
// continuar existindo: são leituras com necessidades diferentes e apertá-las
// numa função só produziria parâmetros demais. O que NÃO pode continuar
// existindo em duas cópias é a decisão de GASTAR — porque agora são cinco
// consumidores no mesmo plano de 5.000 créditos, e cada um decidindo sozinho é a
// receita para o mês acabar dia 12 sem ninguém saber por culpa de quem.
//
// Então este módulo é, em ordem de importância:
//   1. `podeGastar`  — o freio, com teto mensal por consumidor e piso de saldo;
//   2. `registrarGasto` — o razão, que responde "de quem foi";
//   3. `raspar`/`buscar` — o cliente HTTP, para quem não precisa das manhas do
//      radar.
//
// A CONSULTA DE SALDO NÃO GASTA CRÉDITO. É por isso que o freio pode perguntar
// antes de toda rodada em vez de confiar no que a última gravou — saldo velho é
// pior que nenhum, porque tem cara de atual.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type Consumidor =
  | "radar_varrer"
  | "radar_conferir"
  /* A vigia permanente do radar tem quinhão SEPARADO da varredura, e não é
     detalhe contábil: são regimes com prioridades opostas. A varredura serve
     uma compra que alguém está esperando hoje; a vigia constrói curva para a
     compra do mês que vem, e adiá-la uma semana não custa nada. Compartilhando
     o mesmo teto, a curva de seis produtos comeria o crédito da compra em
     curso — que é exatamente o que o rateio existe para impedir. */
  | "radar_vigia"
  | "cadastro_cnpj"
  | "editais"
  | "vigilancia"
  | "churn_sinal"
  | "briefing_noticias";

const API = "https://api.firecrawl.dev/v2";

export function chaveFirecrawl(): string | null {
  return Deno.env.get("CHAVE_API_FIRCRAWL") ?? Deno.env.get("FIRECRAWL_API_KEY") ?? null;
}

export function clienteServico(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/* ================================================================== saldo */

export interface Saldo {
  restantes: number | null;
  plano: number | null;
  /** Fim do ciclo de cobrança, como o Firecrawl informa. Vira o corte do razão. */
  ate: string | null;
  erro: string | null;
}

/**
 * O saldo do plano, lido da fonte. Não gasta crédito.
 *
 * `restantes: null` é "não sei", e quem lê tem de tratar diferente de zero: não
 * saber o saldo não é estar sem saldo, e parar tudo por uma falha de rede seria
 * transformar intermitência em apagão.
 */
export async function saldoFirecrawl(): Promise<Saldo> {
  const key = chaveFirecrawl();
  const vazio = { restantes: null, plano: null, ate: null };
  if (!key) return { ...vazio, erro: "CHAVE_API_FIRCRAWL não configurada" };
  try {
    const r = await fetch(`${API}/team/credit-usage`, {
      headers: { Authorization: `Bearer ${key}`, accept: "application/json" },
    });
    const d = await r.json().catch(() => ({} as any));
    if (!r.ok || !d?.data) {
      return { ...vazio, erro: `Firecrawl HTTP ${r.status} — ${String(d?.error ?? d?.message ?? "").slice(0, 150)}` };
    }
    return {
      restantes: Number(d.data.remainingCredits ?? 0),
      plano: d.data.planCredits != null ? Number(d.data.planCredits) : null,
      ate: d.data.billingPeriodEnd ?? null,
      erro: null,
    };
  } catch (e) {
    return { ...vazio, erro: String(e) };
  }
}

/**
 * O começo do ciclo, deduzido do fim que a API informa.
 *
 * O ciclo do Firecrawl renova na data da assinatura, não no dia 1º. Contar o
 * gasto pelo mês do calendário erraria justamente na virada — que é quando o
 * teto importa. Sem a data, `null`, e o banco cai no mês corrente.
 */
export function inicioDoCiclo(ate: string | null): string | null {
  if (!ate) return null;
  const fim = new Date(ate);
  if (isNaN(fim.getTime())) return null;
  const ini = new Date(fim);
  ini.setMonth(ini.getMonth() - 1);
  return ini.toISOString();
}

/* ============================================================== o freio */

export interface Veredito {
  pode: boolean;
  /** Em português, para ir direto à tela ou ao relatório da rodada. */
  motivo: string;
  saldo: number | null;
  gastoCiclo: number;
  restaCiclo: number;
  teto: number | null;
}

/**
 * Pode gastar `quantas` páginas neste consumidor?
 *
 * TRÊS PERGUNTAS, e a ordem importa porque a resposta muda o que se faz:
 *   1. o consumidor está desligado? (alguém desligou no painel — respeitar)
 *   2. o quinhão do ciclo acabou? (só o ciclo virar resolve)
 *   3. o saldo do plano caiu abaixo do piso desta prioridade? (os mais
 *      importantes continuam; este espera)
 *
 * NÃO SABER O SALDO NÃO BLOQUEIA. Se a API de saldo falhar, o teto mensal do
 * razão ainda está de pé — e ele sozinho já impede o estouro, porque é somado
 * do que cada rodada registrou. Bloquear por falha de leitura seria deixar o
 * Hub inteiro refém do uptime de um endpoint que nem cobra.
 */
export async function podeGastar(
  supa: SupabaseClient,
  consumidor: Consumidor,
  quantas = 1,
  saldoJaLido?: Saldo,
): Promise<Veredito> {
  const saldo = saldoJaLido ?? await saldoFirecrawl();
  const { data, error } = await supa.rpc("firecrawl_orcamento_status", {
    p_desde: inicioDoCiclo(saldo.ate),
  });
  if (error) {
    // Sem razão não há teto, e sem teto não se gasta: este é o único caso em
    // que a falha de leitura fecha a porta, porque é a leitura do próprio freio.
    return { pode: false, motivo: `não deu para ler o orçamento (${error.message})`, saldo: saldo.restantes, gastoCiclo: 0, restaCiclo: 0, teto: null };
  }
  const linha = (data ?? []).find((l: any) => l.consumidor === consumidor);
  if (!linha) {
    return { pode: false, motivo: `consumidor "${consumidor}" não está no rateio de créditos`, saldo: saldo.restantes, gastoCiclo: 0, restaCiclo: 0, teto: null };
  }

  const base = { saldo: saldo.restantes, gastoCiclo: Number(linha.gasto_ciclo ?? 0), restaCiclo: Number(linha.resta_ciclo ?? 0), teto: Number(linha.teto_mes) };

  if (!linha.ativo) return { ...base, pode: false, motivo: `${linha.rotulo} está desligado no painel de créditos` };

  if (base.restaCiclo < quantas) {
    return {
      ...base, pode: false,
      motivo: `${linha.rotulo} já usou ${base.gastoCiclo} dos ${base.teto} créditos do ciclo` +
        (base.restaCiclo > 0 ? ` — restam ${base.restaCiclo}, e esta rodada precisava de ${quantas}` : ""),
    };
  }

  if (saldo.restantes != null && saldo.restantes - quantas < Number(linha.piso_saldo)) {
    return {
      ...base, pode: false,
      motivo: `o plano está em ${saldo.restantes} créditos e ${linha.rotulo} para em ${linha.piso_saldo}` +
        (saldo.ate ? ` (o ciclo renova em ${new Date(saldo.ate).toLocaleDateString("pt-BR")})` : ""),
    };
  }

  return { ...base, pode: true, motivo: `${base.restaCiclo} créditos disponíveis no quinhão de ${linha.rotulo}` };
}

/**
 * Grava o gasto. `medido` só quando o número veio da diferença de saldo — o
 * resto é o que se PEDIU, que subestima a página que exigiu stealth.
 *
 * Nunca lança: falhar ao registrar não pode derrubar a rodada que já gastou o
 * crédito. Mas escreve no log, porque razão furado é teto furado.
 */
export async function registrarGasto(
  supa: SupabaseClient,
  consumidor: Consumidor,
  creditos: number,
  detalhe: Record<string, unknown> = {},
  medido = false,
): Promise<void> {
  if (!creditos || creditos <= 0) return;
  const { error } = await supa.from("firecrawl_consumo")
    .insert({ consumidor, creditos: Math.round(creditos), medido, detalhe });
  if (error) console.error("firecrawl_consumo", consumidor, creditos, error.message);
}

/* =========================================================== o cliente */

export interface RasparOpts {
  waitFor?: number;
  /** `0` força leitura fresca; o padrão do Firecrawl entrega página de até 2 dias. */
  maxAge?: number;
  /** Detecção de mudança entre esta leitura e a anterior DA MESMA URL. */
  rastrearMudanca?: boolean;
  proxy?: "basic" | "auto" | "stealth";
  timeoutMs?: number;
  onlyMainContent?: boolean;
}

export interface Mudanca {
  status: "new" | "same" | "changed" | "removed" | null;
  anteriorEm: string | null;
  diff: string | null;
}

export interface Raspagem {
  markdown: string;
  mudanca: Mudanca | null;
  erro: string | null;
}

/**
 * Uma página, em markdown.
 *
 * NÃO CHAMA `podeGastar` SOZINHA, de propósito. Quem raspa em lote precisa
 * perguntar UMA vez por rodada e não uma vez por página — perguntar aqui dentro
 * faria N consultas de saldo por rodada e, pior, deixaria a rodada parar no
 * meio, com metade do trabalho feito e nada registrado.
 */
export async function raspar(url: string, opts: RasparOpts = {}): Promise<Raspagem> {
  const key = chaveFirecrawl();
  if (!key) return { markdown: "", mudanca: null, erro: "CHAVE_API_FIRCRAWL não configurada" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  try {
    /* `changeTracking` EXIGE `markdown` na mesma lista — sem ele a API aceita a
       chamada e devolve o objeto vazio, que na tela vira "nada mudou" para
       sempre. E o modo `git-diff` é o de graça: o modo `json` custa 5 créditos
       por página, cinco vezes o preço de ler a página inteira. */
    const formats: unknown[] = ["markdown"];
    if (opts.rastrearMudanca) {
      formats.push({ type: "changeTracking", modes: ["git-diff"] });
    }
    const r = await fetch(`${API}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats,
        onlyMainContent: opts.onlyMainContent ?? true,
        proxy: opts.proxy ?? "auto",
        location: { country: "BR", languages: ["pt-BR"] },
        maxAge: opts.maxAge ?? 0,
        ...(opts.waitFor ? { waitFor: opts.waitFor } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const txt = await r.text();
      const d = (() => { try { return JSON.parse(txt); } catch { return {} as any; } })();
      return { markdown: "", mudanca: null, erro: `Firecrawl HTTP ${r.status} — ${String(d?.error ?? d?.message ?? txt).slice(0, 220)}` };
    }
    const d = await r.json().catch(() => ({} as any));
    const dados = d?.data ?? d ?? {};
    const ct = dados?.changeTracking ?? null;
    return {
      markdown: String(dados?.markdown ?? ""),
      mudanca: ct
        ? {
            status: ct.changeStatus ?? null,
            anteriorEm: ct.previousScrapeAt ?? null,
            diff: typeof ct?.diff?.text === "string" ? ct.diff.text : (typeof ct?.diff === "string" ? ct.diff : null),
          }
        : null,
      erro: null,
    };
  } catch (e) {
    return { markdown: "", mudanca: null, erro: String(e) };
  } finally { clearTimeout(t); }
}

export interface Achado {
  url: string;
  titulo: string;
  descricao: string;
  /** De qual aba do buscador veio. A de notícias traz data; a da web, quase nunca. */
  origem?: "web" | "news";
  /** O veículo, quando o buscador informa. */
  fonte?: string | null;
  /** ISO, quando o buscador informa. `null` é comum e não quer dizer "antiga". */
  publicado?: string | null;
}

export interface BuscarOpts {
  tbs?: string;
  timeoutMs?: number;
  /**
   * Quais abas do buscador consultar. O padrão (`["web"]`) é o comportamento de
   * sempre — quem já chamava esta função continua recebendo o mesmo.
   *
   * A ABA DE NOTÍCIAS NÃO É A MESMA BUSCA COM OUTRO NOME: ela devolve `date` e o
   * nome do veículo, que a aba web não devolve. Para um painel que precisa dizer
   * "há 3 horas, no TechCrunch", isso é a diferença entre ter o dado e adivinhar
   * pela URL.
   */
  fontes?: Array<"web" | "news">;
}

/**
 * Busca na web. Dois créditos a cada dez resultados, arredondando para cima.
 *
 * `chaves` é diagnóstico: os nomes das abas que vieram em `data`. Zero resultados
 * com `chaves: ["web"]` quando se pediu `news` é a resposta noutro formato — um
 * defeito nosso; zero resultados com `chaves: ["news"]` é o buscador não tendo
 * achado nada. De fora, os dois casos são o mesmo painel vazio.
 */
export async function buscar(query: string, limite = 5, opts: BuscarOpts = {}): Promise<{ achados: Achado[]; erro: string | null; chaves: string[] }> {
  const key = chaveFirecrawl();
  if (!key) return { achados: [], erro: "CHAVE_API_FIRCRAWL não configurada", chaves: [] };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const r = await fetch(`${API}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit: limite,
        ...(opts.tbs ? { tbs: opts.tbs } : {}),
        ...(opts.fontes?.length ? { sources: opts.fontes.map((f) => ({ type: f })) } : {}),
      }),
      signal: ctrl.signal,
    });
    const d = await r.json().catch(() => ({} as any));
    if (!r.ok) return { achados: [], erro: `Firecrawl HTTP ${r.status} — ${String(d?.error ?? d?.message ?? "").slice(0, 200)}`, chaves: [] };

    const ler = (arr: unknown, origem: "web" | "news"): Achado[] =>
      Array.isArray(arr)
        ? arr.map((x: any) => ({
            url: String(x?.url ?? x?.link ?? ""),
            titulo: String(x?.title ?? ""),
            descricao: String(x?.description ?? x?.snippet ?? ""),
            origem,
            /* O nome do veículo, quando a aba de notícias o manda. Vale tentar
               várias grafias: é campo que muda de nome entre versões da API, e o
               custo de tentar quatro chaves é zero perto do de exibir o host de
               um redirecionador como se fosse o jornal. */
            fonte: x?.source ?? x?.publisher ?? x?.siteName ?? x?.site ?? null,
            publicado: x?.date ?? x?.publishedDate ?? x?.publishedAt ?? null,
          })).filter((x) => x.url)
        : [];

    /* `data` já veio como array nas respostas antigas e como objeto com abas nas
       novas. Aceitar as duas formas é o que permite acrescentar `sources` sem
       mexer em quem já chamava — e sem depender de qual versão o endpoint
       resolve devolver hoje. */
    const dados = d?.data;
    const achados = Array.isArray(dados)
      ? ler(dados, "web")
      : [...ler(dados?.web, "web"), ...ler(dados?.news, "news")];
    const chaves = Array.isArray(dados) ? ["(array)"] : Object.keys(dados ?? {});
    return { achados, erro: null, chaves };
  } catch (e) {
    return { achados: [], erro: String(e), chaves: [] };
  } finally { clearTimeout(t); }
}
