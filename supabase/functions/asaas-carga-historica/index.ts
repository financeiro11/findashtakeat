// Edge Function: asaas-carga-historica
//
// Enche `asaas_cache` com o que a asaas-sync nunca puxou.
//
// POR QUE EXISTE. A asaas-sync trabalha por MÊS DE REFERÊNCIA — ela puxa o mês
// que a tela /asaas está olhando. O efeito colateral é que o espelho só tem os
// meses que alguém abriu: medido em 18/08/26, o espelho tinha 9.103 cobranças de
// 2026 contra 3 de 2022, 42 de 2023, 93 de 2024 e 423 de 2025. Esses restos não
// são a história da empresa — são o que sobrou das varreduras por STATUS (a de
// estornos, que não tem recorte de mês). A tela de Notas Fiscais precisa de todos
// os anos, então alguém tem de ir buscar o passado uma vez.
//
// E O CADASTRO DE CLIENTES é o mais urgente dos três: a cobrança do Asaas traz só
// `customer: cus_xxx`, e o CNPJ — que é a ÚNICA chave que casa com o Omie, porque
// por nome não casa (o Asaas guarda o fantasia, o Omie a razão social) — mora no
// cadastro. Com 399 clientes espelhados de ~3.000, a maioria das cobranças não
// tinha como achar o cliente no Omie, e a emissão recusaria com "cliente não
// encontrado" sem que houvesse nada de errado com o cliente.
//
// Ações:
//   "clientes"          → /customers inteiro (uma vez; é o que destrava o CNPJ)
//   "mes"               → { referencia: "YYYY-MM" } cobranças + notas do mês
//   "faixa"             → { de: "YYYY-MM", ate: "YYYY-MM" } mês a mês, com teto
//                          de tempo para caber no limite da Edge Function
//
// Escreve em `asaas_cache` com o MESMO formato da asaas-sync — de propósito: dois
// formatos na mesma tabela quebrariam a RPC `asaas_metricas` e o painel de notas.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return isNaN(n) ? 0 : n; };
const isoDate = (s?: string | null) => {
  const d = String(s ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

/* --------------------------------- Asaas ---------------------------------- */

const BASE = () => Deno.env.get("ASAAS_BASE_URL") || "https://api.asaas.com/v3";
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * O Asaas barra com 403 (não só 429) quando a cota estoura, com a frase
 * "acesso temporariamente bloqueado". Tratar 403 como definitivo mata a carga no
 * meio; mas 403 também é chave inválida, que não melhora repetindo — daí a
 * distinção pelo texto, igual à do _shared/asaas.ts.
 */
async function asaasGet<T = any>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const chave = Deno.env.get("ASAAS_API_KEY");
  if (!chave) throw new Error("ASAAS_API_KEY não configurada nos secrets.");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  }
  const url = `${BASE()}${path}${qs.toString() ? `?${qs}` : ""}`;

  let ultimo: unknown = null;
  for (let i = 0; i < 5; i++) {
    let res: Response, texto: string;
    try {
      res = await fetch(url, { headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "FinHub" } });
      texto = await res.text();
    } catch (e) {
      ultimo = e;
      if (i === 4) throw e;
      await dorme(Math.min(2 ** i, 30) * 1000);
      continue;
    }
    let data: any;
    try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
    if (res.ok) return data as T;

    const corpo = (typeof data === "string" ? data : JSON.stringify(data ?? "")).toLowerCase();
    const bloqueio = res.status === 429 ||
      (res.status === 403 && /limite de requisi|temporariamente bloqueado|rate limit|too many/.test(corpo));
    ultimo = new Error(`Asaas ${path} [${res.status}]: ${corpo.slice(0, 200)}`);
    if ((bloqueio || res.status >= 500) && i < 4) {
      const reset = Number(res.headers.get("ratelimit-reset") ?? res.headers.get("retry-after"));
      await dorme(Number.isFinite(reset) && reset > 0 ? Math.min(reset + 1, 75) * 1000 : Math.min(15 * 2 ** i, 75) * 1000);
      continue;
    }
    throw ultimo;
  }
  throw ultimo;
}

/** Lista paginada, sequencial. Carga de fundo não tem pressa e não vale um 403. */
async function asaasList(path: string, params: Record<string, unknown> = {}, maxPaginas = 200): Promise<any[]> {
  const limit = 100;
  const out: any[] = [];
  for (let p = 0; p < maxPaginas; p++) {
    const r = await asaasGet<any>(path, { ...params, offset: p * limit, limit });
    const data = r?.data ?? [];
    out.push(...data);
    if (!r?.hasMore || data.length === 0) break;
  }
  return out;
}

/* ------------------------------- mapeamento -------------------------------- */
// Mesmíssimo formato da asaas-sync.

const mapPayment = (p: any) => ({
  tipo: "payment", id_asaas: String(p?.id ?? ""), status: String(p?.status ?? ""),
  valor: num(p?.value), valor_liquido: p?.netValue == null ? null : num(p.netValue), ciclo: null,
  data_pagamento: isoDate(p?.paymentDate), data_vencimento: isoDate(p?.dueDate), data_efetiva: null,
  data_criacao: isoDate(p?.dateCreated), forma: p?.billingType ?? null,
  data_credito: isoDate(p?.creditDate) ?? isoDate(p?.estimatedCreditDate), dados: p,
});
const mapInvoice = (i: any) => ({
  tipo: "invoice", id_asaas: String(i?.id ?? ""), status: String(i?.status ?? ""),
  valor: num(i?.value), valor_liquido: null, ciclo: null,
  data_pagamento: null, data_vencimento: null, data_efetiva: isoDate(i?.effectiveDate),
  data_criacao: isoDate(i?.dateCreated), dados: i,
});
const mapCustomer = (c: any) => ({
  tipo: "customer", id_asaas: String(c?.id ?? ""), status: c?.deleted ? "DELETED" : "ACTIVE",
  valor: null, valor_liquido: null, ciclo: null,
  data_pagamento: null, data_vencimento: null, data_efetiva: null,
  data_criacao: isoDate(c?.dateCreated), dados: c,
});

/**
 * O `Map` não é economia, é obrigatório: as buscas se SOBREPÕEM (uma cobrança que
 * vence e é paga no mesmo mês volta nas duas) e o Postgres recusa o lote inteiro
 * com "ON CONFLICT DO UPDATE command cannot affect row a second time" quando a
 * mesma chave aparece duas vezes no MESMO upsert.
 */
async function gravar(supabase: any, linhas: any[]): Promise<number> {
  const unicas = new Map<string, any>();
  for (const l of linhas) if (l.id_asaas) unicas.set(`${l.tipo}:${l.id_asaas}`, l);
  const validas = [...unicas.values()];
  const LOTE = 500;
  for (let i = 0; i < validas.length; i += LOTE) {
    const { error } = await supabase.from("asaas_cache").upsert(
      validas.slice(i, i + LOTE).map((l) => ({ ...l, atualizado_em: new Date().toISOString() })),
      { onConflict: "tipo,id_asaas" },
    );
    if (error) throw new Error(`asaas_cache upsert: ${error.message}`);
  }
  return validas.length;
}

function rangeMes(ref: string) {
  const [y, m] = ref.split("-").map(Number);
  const ult = new Date(y, m, 0).getDate();
  return { de: `${y}-${String(m).padStart(2, "0")}-01`, ate: `${y}-${String(m).padStart(2, "0")}-${String(ult).padStart(2, "0")}` };
}
function proximoMes(ref: string): string {
  const [y, m] = ref.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

async function puxarMes(supabase: any, ref: string) {
  const { de, ate } = rangeMes(ref);
  const [porVenc, porPag, notas] = await Promise.all([
    asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate }),
    asaasList("/payments", { "paymentDate[ge]": de, "paymentDate[le]": ate }),
    asaasList("/invoices", { "effectiveDate[ge]": de, "effectiveDate[le]": ate }),
  ]);
  const cobrancas = await gravar(supabase, [...porVenc, ...porPag].map(mapPayment));
  const emitidas = await gravar(supabase, notas.map(mapInvoice));
  await supabase.from("asaas_sync_estado").upsert(
    { escopo: `historico:${ref}`, ultima_completa: new Date().toISOString(), detalhe: { cobrancas, notas: emitidas } },
    { onConflict: "escopo" },
  );
  return { referencia: ref, cobrancas, notas: emitidas };
}

/* --------------------------------- handler -------------------------------- */

async function autorizado(req: Request, supabase: any): Promise<boolean> {
  const cron = req.headers.get("x-cron-token");
  if (cron) {
    const { data } = await supabase.from("internal_cron_tokens")
      .select("name").eq("name", "asaas-carga-historica").eq("token", cron).maybeSingle();
    if (data) return true;
  }
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return false;
  try {
    const role = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))?.role;
    if (role === "service_role") return true;
  } catch { /* não é JWT nosso */ }
  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data?.user;
}

// Teto de tempo: a Edge Function morre em ~150s de ociosidade e a carga de um
// ano são dezenas de páginas. Parar sozinha e devolver de onde parar é melhor do
// que estourar no meio e não saber o que entrou.
const TETO_MS = 100_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (!(await autorizado(req, supabase))) return json({ erro: "Não autenticado." }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "mes";

    if (action === "clientes") {
      const clientes = await asaasList("/customers", {}, 400);
      const n = await gravar(supabase, clientes.map(mapCustomer));
      const comDoc = clientes.filter((c: any) => String(c?.cpfCnpj ?? "").trim()).length;
      return json({ ok: true, clientes: n, com_documento: comDoc });
    }

    if (action === "mes") {
      const ref = String(body?.referencia ?? "");
      if (!/^\d{4}-\d{2}$/.test(ref)) return json({ erro: "referencia deve ser YYYY-MM." }, 400);
      return json({ ok: true, ...(await puxarMes(supabase, ref)) });
    }

    if (action === "faixa") {
      const de = String(body?.de ?? ""), ate = String(body?.ate ?? "");
      if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate)) return json({ erro: "de/ate devem ser YYYY-MM." }, 400);

      const inicio = Date.now();
      const feitos: unknown[] = [];
      let ref = de;
      while (ref <= ate) {
        feitos.push(await puxarMes(supabase, ref));
        ref = proximoMes(ref);
        if (Date.now() - inicio > TETO_MS) break;
      }
      return json({ ok: true, feitos, parou_em: ref, completo: ref > ate });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("asaas-carga-historica:", msg);
    return json({ erro: msg }, 500);
  }
});
