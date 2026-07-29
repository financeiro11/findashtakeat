// Edge Function: asaas-extrato-sync
// Alimenta o EXTRATO e o SALDO da conta corrente Asaas (tabelas asaas_extrato /
// asaas_saldo), lidas pela seção Conta Corrente do Caixa.
//
// INCREMENTAL ("memória"): o passado não muda, então nunca re-puxamos tudo. A marca
// d'água é o MAIOR data_movimento já gravado em asaas_extrato; pedimos à API só de
// (marca − OVERLAP dias) até hoje. O UNIQUE em id_transacao deduplica a sobreposição.
// Na 1ª execução (base vazia) faz o backfill a partir de `desde` (default DESDE_PADRAO).
//
// Ações (body.action):
//   "preview" → amostra crua de financialTransactions + saldo (validar campos)
//   "sync"    → incremental. Params opcionais: { desde?: "YYYY-MM-DD" } (força início)
//
// Auth: usuário logado (botão "Sincronizar") OU cron (header x-cron-token) — mesmo
// esquema do omie-caixa-sync, sem expor a service key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { asaasGet, asaasList } from "../_shared/asaas.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return isNaN(n) ? 0 : n; };

const OVERLAP_DIAS = 3;         // reprocessa os últimos dias para pegar lançamentos atrasados
// A conta Asaas tem centenas de milhares de lançamentos (cada taxa/split é uma linha),
// então NÃO dá para baixar todo o histórico numa chamada (estoura o timeout). Quando a
// base está vazia, a 1ª carga cobre só uma janela recente; o cron diário mantém em dia
// dali pra frente. Para trazer mais história, chame com { desde: "YYYY-MM-DD" } em blocos.
const JANELA_INICIAL_DIAS = 90;
const MAX_PAGINAS = 800;       // teto de segurança (800×100 = 80k linhas por chamada)

// Data (YYYY-MM-DD) em BRT — o Asaas trabalha com datas locais.
function hojeBRT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // en-CA => YYYY-MM-DD
}
function isoDate(s?: string | null): string | null {
  if (!s) return null;
  const d = String(s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
function subDias(ymd: string, dias: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

// Mapeia um financialTransaction do Asaas para uma linha de asaas_extrato.
// value é ASSINADO (>0 crédito, <0 débito); gravamos valor sempre positivo + tipo.
function mapLancamento(t: any) {
  const valor = num(t?.value);
  return {
    id_transacao: String(t?.id ?? ""),
    data_movimento: isoDate(t?.date ?? t?.paymentDate ?? t?.dateCreated),
    tipo: valor >= 0 ? "credito" : "debito",
    valor: Math.abs(valor),
    historico: t?.description ?? t?.type ?? null,
    contraparte_nome: null, // financialTransactions não traz a contraparte diretamente
    contraparte_documento: null,
    numero_documento: t?.paymentId ?? t?.transferId ?? t?.billId ?? t?.invoiceId ?? null,
  };
}

// Chamada agendada (cron): x-cron-token precisa casar com internal_cron_tokens.
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "asaas-extrato-sync").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (!(await chamadaDeCron(req, supabase))) await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";

    /* ---------------- PREVIEW ---------------- */
    if (action === "preview") {
      const [ext, saldo] = await Promise.all([
        asaasGet<any>("/financialTransactions", { limit: 3, order: "desc" }),
        asaasGet<any>("/finance/balance"),
      ]);
      return json({
        ok: true,
        financialTransactions_totalCount: ext?.totalCount,
        amostra_transacao: ext?.data?.[0] ?? null,
        saldo: saldo ?? null,
      });
    }

    /* ---------------- SYNC (incremental) ---------------- */
    const ate = hojeBRT();

    // Marca d'água = maior data já gravada; recua OVERLAP p/ pegar lançamentos atrasados.
    const { data: ultimo } = await supabase
      .from("asaas_extrato").select("data_movimento")
      .not("data_movimento", "is", null)
      .order("data_movimento", { ascending: false }).limit(1).maybeSingle();

    const desdeForcado = isoDate(body?.desde);
    const desde = desdeForcado
      ?? (ultimo?.data_movimento ? subDias(String(ultimo.data_movimento).slice(0, 10), OVERLAP_DIAS) : subDias(ate, JANELA_INICIAL_DIAS));

    // Extrato do período (startDate/finishDate) — asaasList paraleliza as páginas.
    const brutos = await asaasList("/financialTransactions", { startDate: desde, finishDate: ate }, MAX_PAGINAS);
    const linhas = brutos.map(mapLancamento).filter((l) => l.id_transacao && l.data_movimento);

    // Upsert deduplicado por id_transacao (ignora os que já existem).
    let gravados = 0;
    if (linhas.length) {
      const { error, count } = await supabase
        .from("asaas_extrato")
        .upsert(linhas, { onConflict: "id_transacao", ignoreDuplicates: true, count: "exact" });
      if (error) throw error;
      gravados = count ?? 0;
    }

    // Saldo: snapshot append-only (o atual é sempre o de maior atualizado_em).
    let saldoAtual: number | null = null;
    try {
      const bal = await asaasGet<any>("/finance/balance");
      saldoAtual = num(bal?.balance);
      const { error: eSaldo } = await supabase.from("asaas_saldo").insert({
        conta: "Asaas",
        saldo: saldoAtual,
        saldo_disponivel: saldoAtual, // Asaas expõe só o saldo total nesta API
        saldo_bloqueado: 0,
        atualizado_em: new Date().toISOString(),
      });
      if (eSaldo) throw eSaldo;
    } catch (e) {
      // Não derruba o sync do extrato se o saldo falhar — apenas registra.
      console.error("asaas-extrato-sync saldo:", e instanceof Error ? e.message : String(e));
    }

    return json({
      ok: true,
      periodo: { desde, ate },
      recebidos_da_api: linhas.length,
      novos_gravados: gravados,
      saldo_atual: saldoAtual,
      trigger: body?.trigger ?? "manual",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("asaas-extrato-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
