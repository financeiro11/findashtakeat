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

/** Lista paginada (Asaas usa offset/limit e devolve { data, hasMore, totalCount }). */
export async function asaasList(path: string, params: Record<string, unknown> = {}, maxPaginas = 300): Promise<any[]> {
  const out: any[] = [];
  const limit = 100;
  let offset = 0;
  for (let page = 0; page < maxPaginas; page++) {
    const r = await asaasGet<any>(path, { ...params, offset, limit });
    const data = r?.data ?? [];
    out.push(...data);
    if (!r?.hasMore || data.length === 0) break;
    offset += limit;
  }
  return out;
}
