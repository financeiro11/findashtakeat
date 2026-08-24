// Cliente compartilhado da API do Asaas.
// Auth: header `access_token: <chave>`. A chave vem do secret ASAAS_API_KEY (produção).
// Base padrão: produção (https://api.asaas.com/v3). Para sandbox, defina o secret
// ASAAS_BASE_URL = https://sandbox.asaas.com/api/v3.
//
// LEITURA E ESCRITA NÃO REPETEM IGUAL. Por anos este módulo só teve GET, e a
// retentativa podia ser generosa: repetir uma leitura no máximo custa uma
// requisição. `asaasPut` mudou isso. Ver `repetivel` — a regra curta é: bloqueio
// de taxa é a ÚNICA falha que se repete numa escrita, porque é a única em que se
// sabe que a requisição não chegou a acontecer.
//
// LIMITES DA CONTA (docs.asaas.com/docs/duvidas-frequentes-limites-da-api):
//   • 25.000 requisições por conta a cada 12h (independente do endpoint)
//   • até 50 GETs concorrentes
//   • limites por endpoint, informados nos headers RateLimit-Limit / -Remaining / -Reset
// Daí as três defesas deste módulo: teto GLOBAL de concorrência (e não por chamada),
// espera guiada pelo RateLimit-Reset, e `asaasCount` para não paginar só para contar.

const DEFAULT_BASE = "https://api.asaas.com/v3";

function base() {
  return Deno.env.get("ASAAS_BASE_URL") || DEFAULT_BASE;
}
function key(): string {
  const k = Deno.env.get("ASAAS_API_KEY");
  if (!k) throw new Error("ASAAS_API_KEY não configurada nos secrets do Supabase (Edge Functions).");
  return k;
}

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ concorrência ------------------------------ */
/**
 * Teto GLOBAL de GETs simultâneos, no módulo e não por chamada. Antes cada
 * `asaasList` abria 6 páginas de uma vez; como a sync dispara 4 listas em
 * Promise.all, o efeito real eram 24 requisições concorrentes em rajada, quase
 * todas no mesmo endpoint (/payments) — exatamente o que o limite por endpoint
 * pune com 429. Com o portão aqui, o número é o mesmo com 1 ou com 10 chamadores.
 */
const TETO_CONCORRENTE = 8;
let emVoo = 0;
const fila: Array<() => void> = [];

async function entra(): Promise<void> {
  if (emVoo < TETO_CONCORRENTE) { emVoo++; return; }
  await new Promise<void>((resolve) => fila.push(resolve));
  emVoo++;
}
function sai(): void {
  emVoo--;
  fila.shift()?.();
}
/** Roda `fn` ocupando uma vaga do portão — e devolve a vaga mesmo se `fn` estourar. */
async function comVaga<T>(fn: () => Promise<T>): Promise<T> {
  await entra();
  try { return await fn(); } finally { sai(); }
}

/* --------------------------------- GET ----------------------------------- */

/**
 * O Asaas NÃO usa só 429 para barrar. Ao estourar o limite ele responde **403** com
 * "Seu acesso foi temporariamente bloqueado por exceder o limite de requisições".
 * Tratar 403 como erro definitivo (o que o código antigo fazia, e por isso a sync
 * simplesmente morria) é o erro clássico aqui — mas 403 também é a resposta de chave
 * inválida, e essa NÃO adianta repetir. Por isso a distinção é pelo texto.
 */
function eBloqueioDeTaxa(status: number, corpo: unknown): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const txt = (typeof corpo === "string" ? corpo : JSON.stringify(corpo ?? "")).toLowerCase();
  return /limite de requisi|temporariamente bloqueado|rate limit|too many requests/.test(txt);
}

/** Quantos segundos esperar antes de repetir, lendo o que a própria API mandou. */
function esperaSugerida(res: Response, tentativa: number, bloqueado: boolean): number {
  const reset = res.headers.get("RateLimit-Reset") ?? res.headers.get("ratelimit-reset");
  const retry = res.headers.get("Retry-After") ?? res.headers.get("retry-after");
  const seg = Number(reset ?? retry);
  if (Number.isFinite(seg) && seg > 0) return Math.min(seg + 1, 75) * 1000;
  // Sem header: um bloqueio temporário é mais grave que uma janela cheia — insistir
  // rápido só renova o castigo. Começa em 15s e dobra.
  if (bloqueado) return Math.min(15 * 2 ** tentativa, 75) * 1000;
  return Math.min(2 ** tentativa, 30) * 1000;
}

/**
 * Esta falha vale uma nova tentativa?
 *
 * Para o GET, a resposta antiga: bloqueio de taxa e 5xx são transitórios; 401,
 * 400 e o 403 de chave inválida não melhoram repetindo.
 *
 * Para a ESCRITA a conta é outra, e é a conta que importa. Um 5xx ou uma queda de
 * rede não dizem "não aconteceu" — dizem "não sei se aconteceu". Repetir nesse
 * escuro é como o Omie ensinou no `FaturarLoteOS`: a segunda chamada não conserta
 * a primeira, duplica-a. Já o bloqueio de taxa é a exceção honesta — a requisição
 * foi recusada NA PORTA, sem chegar ao recurso, e por isso é a única falha que uma
 * escrita repete.
 */
function repetivel(escrita: boolean, status: number, bloqueado: boolean): boolean {
  if (bloqueado) return true;
  return !escrita && status >= 500;
}

type Metodo = "GET" | "PUT" | "POST";

async function requisitar<T = any>(
  metodo: Metodo, path: string,
  opts: { params?: Record<string, unknown>; corpo?: unknown; form?: FormData } = {},
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  }
  const url = `${base()}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
  const escrita = metodo !== "GET";

  const TENTATIVAS = 5;
  let lastErr: unknown = null;

  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    const ultima = tentativa === TENTATIVAS - 1;

    // Uma falha de rede no meio de uma paginação de 30 páginas derrubava a sync
    // inteira; agora ela também repete, com a mesma espera exponencial. Na escrita,
    // não: a resposta que não chegou pode ser de uma requisição que chegou.
    let resposta: { res: Response; text: string };
    try {
      resposta = await comVaga(async () => {
        // Com FormData o Content-Type NÃO se declara: quem o escreve é o fetch,
        // porque só ele conhece o `boundary` que separa as partes. Declarar
        // "multipart/form-data" na mão manda um cabeçalho sem boundary e o Asaas
        // recebe um corpo que não sabe abrir.
        const cabecalhos: Record<string, string> = { access_token: key(), "User-Agent": "FinHub" };
        if (!opts.form) cabecalhos["Content-Type"] = "application/json";
        const res = await fetch(url, {
          method: metodo,
          headers: cabecalhos,
          ...(opts.form ? { body: opts.form }
            : opts.corpo !== undefined ? { body: JSON.stringify(opts.corpo) } : {}),
        });
        return { res, text: await res.text() };
      });
    } catch (e) {
      lastErr = e;
      if (ultima || escrita) throw e;
      await dorme(Math.min(2 ** tentativa, 30) * 1000);
      continue;
    }

    const { res, text } = resposta;
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.ok) return data as T;

    lastErr = new Error(`Asaas ${path} [${res.status}]: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    const bloqueado = eBloqueioDeTaxa(res.status, data);
    if (repetivel(escrita, res.status, bloqueado) && !ultima) {
      await dorme(esperaSugerida(res, tentativa, bloqueado));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

export async function asaasGet<T = any>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  return await requisitar<T>("GET", path, { params });
}

/* --------------------------------- escrita -------------------------------- */

/**
 * A ÚNICA escrita do Hub no Asaas. Até 24/08/26 este módulo era só de leitura, e
 * a integração inteira era de mão única: o Hub lia cobranças e emitia a NFS-e pelo
 * Omie, sem devolver nada — a pergunta "cadê a confirmação no portal do Asaas?"
 * tinha por resposta que não havia nenhuma, por construção.
 *
 * O corpo vai INTEIRO, não só o campo que muda: `PUT /payments/{id}` exige
 * `billingType`, `value` e `dueDate` mesmo quando a intenção é mexer em outra
 * coisa, e omitir campo em API que substitui o recurso é como se apaga um dado
 * sem querer. Quem chama monta o corpo a partir do que acabou de LER da própria
 * cobrança (ver o carimbo em omie-nfse-sync), não do espelho local.
 */
export async function asaasPut<T = any>(path: string, corpo: Record<string, unknown>): Promise<T> {
  return await requisitar<T>("PUT", path, { corpo });
}

/**
 * Envio de arquivo (multipart) — hoje só o anexo da NFS-e na cobrança.
 *
 * É a escrita que sobrou depois que o `PUT` provou não valer para cobrança
 * recebida ("Só é possível editar cobranças pendentes ou vencidas", medido em
 * 24/08/26). Um anexo NÃO é um campo: ele não substitui nada, ele acrescenta — e
 * por isso mandar duas vezes cria dois arquivos na cobrança, em vez de gravar o
 * mesmo valor duas vezes. Quem chama confere ANTES se o anexo já está lá.
 */
export async function asaasUpload<T = any>(path: string, form: FormData): Promise<T> {
  return await requisitar<T>("POST", path, { form });
}

/* -------------------------------- contagem -------------------------------- */

/**
 * Quantos registros existem no filtro — em UMA requisição.
 *
 * A resposta paginada do Asaas traz `totalCount` já na primeira página, então
 * contar não exige baixar as páginas. Era daqui que vinha o grosso do desperdício:
 * `venc_total` (2.861), `ativas` (3.102) e as contagens de NF-e eram obtidas
 * baixando ~90 páginas para fazer `.length` num array.
 */
export async function asaasCount(path: string, params: Record<string, unknown> = {}): Promise<number> {
  const r = await asaasGet<any>(path, { ...params, offset: 0, limit: 1 });
  const n = Number(r?.totalCount);
  return Number.isFinite(n) ? n : (r?.data?.length ?? 0);
}

/* --------------------------------- lista ---------------------------------- */

/**
 * Lista paginada do Asaas (offset/limit, resposta { data, hasMore, totalCount }).
 * Busca a 1ª página para descobrir o totalCount e então dispara as restantes em
 * lotes — respeitando o portão global acima. Se o totalCount não vier, cai no modo
 * sequencial (seguro).
 *
 * Use só quando precisar dos CAMPOS das linhas (somar valores, medir datas). Para
 * saber apenas "quantos são", use `asaasCount`.
 */
export async function asaasList(path: string, params: Record<string, unknown> = {}, maxPaginas = 300): Promise<any[]> {
  const limit = 100;
  const LOTE = 8; // o portão global é quem manda de verdade; isto só fatia o Promise.all

  const first = await asaasGet<any>(path, { ...params, offset: 0, limit });
  const out: any[] = [...(first?.data ?? [])];
  if (!first?.hasMore || out.length === 0) return out;

  const total = typeof first?.totalCount === "number" ? first.totalCount : null;

  // Sem totalCount: fallback sequencial usando hasMore.
  if (total == null) {
    let offset = limit;
    for (let page = 1; page < maxPaginas; page++) {
      const r = await asaasGet<any>(path, { ...params, offset, limit });
      const data = r?.data ?? [];
      out.push(...data);
      if (!r?.hasMore || data.length === 0) break;
      offset += limit;
    }
    return out;
  }

  // Com totalCount: paraleliza as páginas restantes em lotes.
  const totalPaginas = Math.min(maxPaginas, Math.ceil(total / limit));
  const offsets: number[] = [];
  for (let p = 1; p < totalPaginas; p++) offsets.push(p * limit);

  for (let i = 0; i < offsets.length; i += LOTE) {
    const lote = offsets.slice(i, i + LOTE);
    const partes = await Promise.all(lote.map((off) => asaasGet<any>(path, { ...params, offset: off, limit })));
    for (const r of partes) out.push(...(r?.data ?? []));
  }
  return out;
}