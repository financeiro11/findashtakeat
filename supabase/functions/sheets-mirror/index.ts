// Generic Google Sheets mirror: read / update single cell / append row.
// Caller passes spreadsheetId + sheet name in the request body.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

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
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const delay = Math.min(8000, 600 * Math.pow(2, attempt)) + Math.random() * 300;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

// Per-isolate cache keyed by spreadsheetId+sheet
const cache = new Map<string, { at: number; payload: any }>();
const CACHE_TTL_MS = 15_000;

function quoteSheet(name: string): string {
  // wrap in single quotes if contains space or special char; escape single quotes
  if (/^[A-Za-z0-9_]+$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "read";
    const spreadsheetId: string = body?.spreadsheetId;
    const sheet: string = body?.sheet;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: "spreadsheetId é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List a spreadsheet's tab titles (no specific sheet required). Used to
    // discover which monthly tabs exist per team in the "Variável" area.
    if (action === "meta") {
      const metaKey = `${spreadsheetId}::__meta__`;
      const cachedMeta = cache.get(metaKey);
      if (body?.force !== true && cachedMeta && Date.now() - cachedMeta.at < CACHE_TTL_MS) {
        return new Response(JSON.stringify({ ...cachedMeta.payload, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await gw(`/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId,gridProperties(rowCount,columnCount))`);
      const sheets = (data.sheets ?? []).map((s: any) => ({
        title: s.properties?.title ?? "",
        sheetId: s.properties?.sheetId ?? null,
        rowCount: s.properties?.gridProperties?.rowCount ?? 0,
        columnCount: s.properties?.gridProperties?.columnCount ?? 0,
      }));
      const payload = { sheets };
      cache.set(metaKey, { at: Date.now(), payload });
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!sheet) {
      return new Response(JSON.stringify({ error: "sheet é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cacheKey = `${spreadsheetId}::${sheet}`;
    const sheetRef = quoteSheet(sheet);

    if (action === "read") {
      const force = body?.force === true;
      const cached = cache.get(cacheKey);
      if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return new Response(JSON.stringify({ ...cached.payload, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const range = body?.range ?? "A1:AZ500"; // limita default a 52 colunas x 500 linhas
      const data = await gw(`/spreadsheets/${spreadsheetId}/values/${sheetRef}!${range}`);
      const values: string[][] = data.values ?? [];
      const headers = values[0] ?? [];
      const rows = values.slice(1);
      const payload = { headers, rows, sheet };
      cache.set(cacheKey, { at: Date.now(), payload });
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
      const a1 = `${sheetRef}!${colIndexToLetter(colIndex)}${rowIndex + 2}`;
      const data = await gw(`/spreadsheets/${spreadsheetId}/values/${a1}?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        body: JSON.stringify({ range: a1, values: [[value ?? ""]] }),
      });
      cache.delete(cacheKey);
      return new Response(JSON.stringify({ ok: true, updated: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "append") {
      const rowValues: string[] = Array.isArray(body?.values) ? body.values : [];
      const a1 = `${sheetRef}!A1`;
      const data = await gw(
        `/spreadsheets/${spreadsheetId}/values/${a1}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          body: JSON.stringify({ range: a1, majorDimension: "ROWS", values: [rowValues] }),
        },
      );
      cache.delete(cacheKey);
      return new Response(JSON.stringify({ ok: true, appended: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "ação inválida" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("sheets-mirror error:", msg);
    const isRate = /\[429\]/.test(msg);
    const isForbidden = /\[403\]/.test(msg);
    return new Response(
      JSON.stringify({
        error: isRate
          ? "Limite de leitura do Google Sheets atingido. Aguarde alguns segundos e tente novamente."
          : isForbidden
          ? "Acesso negado pelo Google Sheets. Compartilhe a planilha (como Editor) com a conta Google conectada ao Lovable."
          : msg,
        rateLimited: isRate,
        forbidden: isForbidden,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
