const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";
const SPREADSHEET_ID = "1fwt-sosZW-YRkV-uNyE06sE40ZLwdlkh3fjbo50VU8o";
const SHEET_NAME = "Folha1";

function colIndexToLetter(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function detectApprovalCol(headers: string[]): number {
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // priority: "pode enviar" then "aprov" then sim/não
  const tests = [
    (h: string) => norm(h).includes("pode enviar"),
    (h: string) => norm(h).includes("aprov"),
    (h: string) => /\bsim\b.*\bn[aã]o\b|\bsim\/n[aã]o\b/i.test(h),
  ];
  for (const t of tests) {
    const i = headers.findIndex(t);
    if (i >= 0) return i;
  }
  return -1;
}

async function gw(path: string, init: RequestInit = {}, retries = 4) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");
  if (!GOOGLE_SHEETS_API_KEY) throw new Error("GOOGLE_SHEETS_API_KEY não configurada");
  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_SHEETS_API_KEY,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.ok) return data;
    lastErr = new Error(`Sheets [${res.status}]: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    // Retry only for rate-limit / transient
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const delay = Math.min(8000, 600 * Math.pow(2, attempt)) + Math.random() * 300;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

// Tiny in-memory cache to dampen burst reads (per isolate)
let cache: { at: number; payload: any } | null = null;
const CACHE_TTL_MS = 15_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "read";

    if (action === "read") {
      const force = body?.force === true;
      if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
        return new Response(JSON.stringify({ ...cache.payload, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await gw(`/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:Z1000`);
      const values: string[][] = data.values ?? [];
      const headers = values[0] ?? [];
      const rows = values.slice(1);
      const approvalCol = detectApprovalCol(headers);
      const payload = { headers, rows, approvalCol, sheet: SHEET_NAME };
      cache = { at: Date.now(), payload };
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update") {
      const { rowIndex, colIndex, value } = body; // rowIndex 0-based of data rows
      if (typeof rowIndex !== "number" || typeof colIndex !== "number") {
        return new Response(JSON.stringify({ error: "rowIndex/colIndex obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const a1 = `${SHEET_NAME}!${colIndexToLetter(colIndex)}${rowIndex + 2}`;
      const data = await gw(`/spreadsheets/${SPREADSHEET_ID}/values/${a1}?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        body: JSON.stringify({ range: a1, values: [[value]] }),
      });
      cache = null;
      return new Response(JSON.stringify({ ok: true, updated: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "ação inválida" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("proporcionais-sheet error:", msg);
    const isRate = /\[429\]/.test(msg);
    return new Response(
      JSON.stringify({
        error: isRate
          ? "Limite de leitura do Google Sheets atingido. Aguarde alguns segundos e tente novamente."
          : msg,
        rateLimited: isRate,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
