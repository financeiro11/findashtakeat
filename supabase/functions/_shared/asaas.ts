// Cliente compartilhado da API do Asaas.
// Auth: header `access_token: <chave>`. A chave vem do secret ASAAS_API_KEY (produção).
// Base padrão: produção (https://api.asaas.com/v3). Para sandbox, defina o secret
// ASAAS_BASE_URL = https://sandbox.asaas.com/api/v3.

const DEFAULT_BASE = "https://api.asaas.com/v3";

function base() {
  return Deno.env.get("ASAAS_BASE_URL") || DEFAULT_BASE;
}
function key(): string {
  const k = Deno.env.get("ASAAS_API_KEY");
  if (!k) throw new Error("ASAAS_API_KEY não configurada nos secrets do Supabase (Edge Functions).");
  return k;
}

export async function asaasGet<T = any>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  }
  const url = `${base()}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: { access_token: key(), "Content-Type": "application/json", "User-Agent": "FinHub" },
    });
    const text = await res.text();
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.ok) return data as T;
    lastErr = new Error(`Asaas ${path} [${res.status}]: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

/**
 * Lista paginada do Asaas (offset/limit, resposta { data, hasMore, totalCount }).
 * Busca a 1ª página para descobrir o totalCount e então dispara as páginas
 * restantes em lotes concorrentes — muito mais rápido que sequencial em meses
 * com muitos lançamentos (evita o idle timeout de 150s do gateway).
 * Se o totalCount não vier, cai no modo sequencial (seguro).
 */
export async function asaasList(path: string, params: Record<string, unknown> = {}, maxPaginas = 300): Promise<any[]> {
  const limit = 100;
  const CONC = 6; // páginas simultâneas por lote (respeita o rate limit do Asaas)

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

  for (let i = 0; i < offsets.length; i += CONC) {
    const lote = offsets.slice(i, i + CONC);
    const partes = await Promise.all(lote.map((off) => asaasGet<any>(path, { ...params, offset: off, limit })));
    for (const r of partes) out.push(...(r?.data ?? []));
  }
  return out;
}
