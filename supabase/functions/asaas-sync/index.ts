// Edge Function: asaas-sync
// Puxa dados do Asaas via API e calcula as métricas do MVP:
//   • Recebimentos (recebido no mês, a receber, conversão, estornos, ciclo médio)
//   • Assinaturas (ativas, MRR, ARR, ARPU)
//   • NF-e (emitidas, erro, pendentes, taxa de sucesso, valores)
// Grava um snapshot por competência em asaas_snapshots (histórico → tendências).
//
// Ações (body.action):
//   "preview" → amostras cruas de payments/subscriptions/invoices (validar campos)
//   "sync"    → calcula o mês e grava o snapshot. Params: { referencia?: "YYYY-MM" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { asaasGet, asaasList } from "../_shared/asaas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return isNaN(n) ? 0 : n; };

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function rangeMes(ref: string): { de: string; ate: string } {
  const [y, m] = ref.split("-").map(Number);
  const ult = new Date(y, m, 0).getDate();
  return { de: `${y}-${String(m).padStart(2, "0")}-01`, ate: `${y}-${String(m).padStart(2, "0")}-${String(ult).padStart(2, "0")}` };
}
function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
// Normaliza o valor de uma assinatura para base MENSAL (MRR).
function mensal(value: number, cycle?: string): number {
  switch (String(cycle || "MONTHLY").toUpperCase()) {
    case "WEEKLY": return value * 52 / 12;
    case "BIWEEKLY": return value * 26 / 12;
    case "MONTHLY": return value;
    case "BIMONTHLY": return value / 2;
    case "QUARTERLY": return value / 3;
    case "SEMIANNUALLY": return value / 6;
    case "YEARLY": return value / 12;
    default: return value;
  }
}

const RECEBIDO = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";

    /* ---------------- PREVIEW ---------------- */
    if (action === "preview") {
      const [pay, sub, inv] = await Promise.all([
        asaasGet<any>("/payments", { limit: 3 }),
        asaasGet<any>("/subscriptions", { limit: 3, status: "ACTIVE" }),
        asaasGet<any>("/invoices", { limit: 3 }),
      ]);
      return json({
        ok: true,
        payments_totalCount: pay?.totalCount, subscriptions_totalCount: sub?.totalCount, invoices_totalCount: inv?.totalCount,
        amostra_payment: pay?.data?.[0] ?? null,
        amostra_subscription: sub?.data?.[0] ?? null,
        amostra_invoice: inv?.data?.[0] ?? null,
      });
    }

    /* ---------------- SYNC ---------------- */
    const ref = String(body?.referencia || mesAtual());
    const { de, ate } = rangeMes(ref);

    // As 4 buscas são independentes → rodam em paralelo (cada uma já paraleliza
    // suas próprias páginas internamente). Corta drasticamente o tempo total.
    const [pagosNoMes, vencemNoMes, assinaturas, notas] = await Promise.all([
      // Pagamentos recebidos NO mês (data de pagamento no período)
      asaasList("/payments", { "paymentDate[ge]": de, "paymentDate[le]": ate }),
      // Pagamentos que VENCEM no mês (todos os status) → conversão e a-receber
      asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate }),
      // Assinaturas ativas
      asaasList("/subscriptions", { status: "ACTIVE" }),
      // NF-e criadas no mês
      asaasList("/invoices", { "effectiveDate[ge]": de, "effectiveDate[le]": ate }),
    ]);

    // --- Recebimentos ---
    const recebidos = pagosNoMes.filter((p) => RECEBIDO.has(String(p.status)));
    const recebido_valor = recebidos.reduce((s, p) => s + num(p.value), 0);
    const recebido_liquido = recebidos.reduce((s, p) => s + num(p.netValue ?? p.value), 0);
    const estornosArr = pagosNoMes.filter((p) => String(p.status) === "REFUNDED");
    const estornos_valor = estornosArr.reduce((s, p) => s + num(p.value), 0);

    const vencTotal = vencemNoMes.length;
    const vencPagos = vencemNoMes.filter((p) => RECEBIDO.has(String(p.status)));
    const a_receber_valor = vencemNoMes
      .filter((p) => ["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"].includes(String(p.status)))
      .reduce((s, p) => s + num(p.value), 0);
    const conversao = vencTotal > 0 ? vencPagos.length / vencTotal : 0;

    // Dias médios até recebimento (data de pagamento − vencimento) entre os pagos que venceram no mês
    const ciclos: number[] = [];
    for (const p of vencPagos) {
      const venc = parseDate(p.dueDate);
      const pago = parseDate(p.paymentDate ?? p.confirmedDate ?? p.clientPaymentDate);
      if (venc && pago) ciclos.push((pago.getTime() - venc.getTime()) / 86400000);
    }
    const dias_ate_recebimento = ciclos.length ? ciclos.reduce((a, b) => a + b, 0) / ciclos.length : null;

    // --- Assinaturas / recorrência ---
    const ativas = assinaturas.length;
    const mrr = assinaturas.reduce((s, a) => s + mensal(num(a.value), a.cycle), 0);
    const arr = mrr * 12;
    const arpu = ativas > 0 ? mrr / ativas : 0;
    const receita_projetada = mrr; // projeção simples do mês (assinaturas ativas × valor médio)

    // --- NF-e ---
    const st = (i: any) => String(i.status || "").toUpperCase();
    const emitidas = notas.filter((i) => st(i) === "AUTHORIZED");
    const comErro = notas.filter((i) => st(i) === "ERROR");
    const pendentes = notas.filter((i) => ["SCHEDULED", "SYNCHRONIZED", "PROCESSING", "PENDING"].includes(st(i)));
    const nf_taxa_sucesso = (emitidas.length + comErro.length) > 0
      ? emitidas.length / (emitidas.length + comErro.length) : null;
    const nf_valor_emitido = emitidas.reduce((s, i) => s + num(i.value), 0);
    const nf_valor_erro = comErro.reduce((s, i) => s + num(i.value), 0);

    const dados = {
      recebimentos: {
        recebido_valor, recebido_liquido, recebido_qtd: recebidos.length,
        a_receber_valor, conversao, estornos_valor, estornos_qtd: estornosArr.length,
        dias_ate_recebimento,
        venc_total: vencTotal, venc_pagos: vencPagos.length,
      },
      assinaturas: { ativas, mrr, arr, arpu, receita_projetada },
      nfe: {
        emitidas: emitidas.length, erro: comErro.length, pendentes: pendentes.length,
        taxa_sucesso: nf_taxa_sucesso, valor_emitido: nf_valor_emitido, valor_erro: nf_valor_erro,
      },
    };

    const { error } = await supabase
      .from("asaas_snapshots")
      .upsert({ referencia: ref, dados, gerado_em: new Date().toISOString() }, { onConflict: "referencia" });
    if (error) throw error;

    return json({ ok: true, referencia: ref, dados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("asaas-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
