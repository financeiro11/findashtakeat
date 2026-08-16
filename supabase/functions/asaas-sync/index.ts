// Edge Function: asaas-sync
// Alimenta a página /asaas: Recebimentos, Assinaturas (MRR/ARR) e NF-e.
//
// COMO ERA (e por que quebrava): cada clique em "Sincronizar" baixava da API o mês
// inteiro — ~115 requisições — e contava os registros em memória. Só que a maior
// parte disso virava `.length`: `venc_total` (2.861), `ativas` (3.102), `emitidas`
// (2.421)... eram 90 páginas baixadas para produzir três números que a própria API
// devolve como `totalCount` na primeira página. Com cota de 25.000 req/12h e limites
// por endpoint, cliques repetidos batiam em 429.
//
// COMO É AGORA: as linhas cruas vivem em `asaas_cache` (mesma ideia do omie_cache) e
// o cálculo é a RPC `asaas_metricas`, que soma no Postgres. Daí as duas ações:
//
//   "recalcular" (padrão) → só lê o espelho local. ZERO requisições ao Asaas.
//   "atualizar"           → puxa da API o que mudou, grava no espelho, recalcula.
//   "preview"             → amostras cruas (validar campos da API)
//
// Params de "atualizar": { referencia?: "YYYY-MM", completo?: boolean }
//   completo:true ignora os atalhos abaixo e re-puxa o mês inteiro.
//
// Auth: usuário logado OU cron (header x-cron-token), como no asaas-extrato-sync.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { asaasGet, asaasList, asaasCount } from "../_shared/asaas.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return isNaN(n) ? 0 : n; };

function mesAtual(): string {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return hoje.slice(0, 7);
}
function rangeMes(ref: string): { de: string; ate: string } {
  const [y, m] = ref.split("-").map(Number);
  const ult = new Date(y, m, 0).getDate();
  return { de: `${y}-${String(m).padStart(2, "0")}-01`, ate: `${y}-${String(m).padStart(2, "0")}-${String(ult).padStart(2, "0")}` };
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
const somaDias = (ymd: string, dias: number) => subDias(ymd, -dias);

const RECEBIDO = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];
const EM_ABERTO = ["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"];
const NF_NAO_FINAL = ["SCHEDULED", "SYNCHRONIZED", "PROCESSING", "PENDING"];

// Reprocessa alguns dias para trás: um pagamento pode ser registrado com atraso.
const OVERLAP_DIAS = 5;
// Assinaturas são um retrato do AGORA e não têm recorte por mês. Uma cancelada some
// do filtro ACTIVE, e um incremental jamais saberia disso — ela ficaria viva no
// espelho inflando o MRR para sempre. Por isso a carga é completa, com validade.
const TTL_ASSINATURAS_H = 6;
// Carência entre puxadas REAIS do mesmo mês. Sem isto, apertar "Atualizar" cinco
// vezes seguidas dispara cinco incrementais; no mês corrente cada uma varre a janela
// de OVERLAP_DIAS inteira e o Asaas responde 403 "acesso temporariamente bloqueado"
// (medido). Dentro da carência a chamada vira um recálculo local, que é grátis.
const CARENCIA_PUXADA_S = 120;

/* -------------------------------- mapeamento ------------------------------- */

type Linha = Record<string, unknown>;

function mapPayment(p: any): Linha {
  return {
    tipo: "payment",
    id_asaas: String(p?.id ?? ""),
    status: String(p?.status ?? ""),
    valor: num(p?.value),
    valor_liquido: p?.netValue == null ? null : num(p.netValue),
    ciclo: null,
    // paymentDate é o mesmo campo em que a API filtra; usar um fallback aqui faria a
    // linha cair num mês diferente do que a busca disse que ela é.
    data_pagamento: isoDate(p?.paymentDate),
    data_vencimento: isoDate(p?.dueDate),
    data_efetiva: null,
    data_criacao: isoDate(p?.dateCreated),
    // Forma e data de crédito alimentam o fluxo projetado do /caixa: lá o que importa
    // não é quando a cobrança vence, e sim quando o dinheiro fica disponível. Quando o
    // Asaas não diz (cobrança ainda não paga), o prazo sai da forma — ver a função
    // asaas_prazo_credito na migration.
    forma: p?.billingType ?? null,
    data_credito: isoDate(p?.creditDate) ?? isoDate(p?.estimatedCreditDate),
    dados: p,
  };
}
function mapSubscription(s: any): Linha {
  return {
    tipo: "subscription",
    id_asaas: String(s?.id ?? ""),
    status: String(s?.status ?? ""),
    valor: num(s?.value),
    valor_liquido: null,
    ciclo: s?.cycle ?? null,
    data_pagamento: null,
    data_vencimento: isoDate(s?.nextDueDate),
    data_efetiva: null,
    data_criacao: isoDate(s?.dateCreated),
    dados: s,
  };
}
function mapInvoice(i: any): Linha {
  return {
    tipo: "invoice",
    id_asaas: String(i?.id ?? ""),
    status: String(i?.status ?? ""),
    valor: num(i?.value),
    valor_liquido: null,
    ciclo: null,
    data_pagamento: null,
    data_vencimento: null,
    data_efetiva: isoDate(i?.effectiveDate),
    data_criacao: isoDate(i?.dateCreated),
    dados: i,
  };
}

/**
 * Grava no espelho em blocos — um upsert de 3.000 linhas estoura o payload.
 *
 * O `Map` não é economia, é obrigatório: as buscas que alimentam isto se SOBREPÕEM
 * (uma cobrança que vence em julho e foi paga em julho volta nas duas), e o Postgres
 * recusa o lote inteiro com "ON CONFLICT DO UPDATE command cannot affect row a second
 * time" quando a mesma chave aparece duas vezes no MESMO upsert. Na carga completa o
 * erro ficava escondido só porque as duas cópias caíam em lotes diferentes.
 * Vence a última ocorrência, que é a leitura mais recente da API.
 */
async function gravar(supabase: any, linhas: Linha[]): Promise<number> {
  const unicas = new Map<string, Linha>();
  for (const l of linhas) {
    if (l.id_asaas) unicas.set(`${l.tipo}:${l.id_asaas}`, l);
  }
  const validas = [...unicas.values()];
  const LOTE = 500;
  for (let i = 0; i < validas.length; i += LOTE) {
    const { error } = await supabase
      .from("asaas_cache")
      .upsert(validas.slice(i, i + LOTE).map((l) => ({ ...l, atualizado_em: new Date().toISOString() })),
              { onConflict: "tipo,id_asaas" });
    if (error) throw new Error(`asaas_cache upsert: ${error.message}`);
  }
  return validas.length;
}

async function estado(supabase: any, escopo: string): Promise<any> {
  const { data } = await supabase.from("asaas_sync_estado").select("*").eq("escopo", escopo).maybeSingle();
  return data ?? null;
}
async function marcar(supabase: any, escopo: string, campos: Record<string, unknown>) {
  await supabase.from("asaas_sync_estado").upsert({ escopo, ...campos }, { onConflict: "escopo" });
}

/* ------------------------------ as três puxadas ---------------------------- */

/**
 * Pagamentos do mês. Na 1ª vez puxa os dois recortes inteiros (quem foi pago no mês
 * e quem vence no mês). Depois, só o que pode ter mudado:
 *   • pagos desde a última sync (o grosso do movimento)
 *   • cobranças criadas desde a última sync que vencem no mês
 *   • os estornos do mês inteiro — são poucos e o estorno não mexe no paymentDate,
 *     então seria justamente o que um incremental por data deixaria passar
 */
async function puxarPagamentos(supabase: any, ref: string, completo: boolean) {
  const { de, ate } = rangeMes(ref);
  const escopo = `payment:${ref}`;
  const est = await estado(supabase, escopo);
  const primeiraVez = !est?.ultima_completa;

  const linhas: any[] = [];
  let requisicoes = "completa";

  if (primeiraVez || completo) {
    const [porPagamento, porVencimento] = await Promise.all([
      asaasList("/payments", { "paymentDate[ge]": de, "paymentDate[le]": ate }),
      asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate }),
    ]);
    linhas.push(...porPagamento, ...porVencimento);
    await marcar(supabase, escopo, { ultima_completa: new Date().toISOString(), ultima_incremental: new Date().toISOString() });
  } else {
    requisicoes = "incremental";
    const desde = isoDate(est.ultima_incremental ?? est.ultima_completa) ?? de;
    const marca = subDias(desde, OVERLAP_DIAS);
    const inicio = marca > de ? marca : de;

    const [recemPagos, novas, estornos] = await Promise.all([
      asaasList("/payments", { "paymentDate[ge]": inicio, "paymentDate[le]": ate }),
      asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate, "dateCreated[ge]": inicio }),
      asaasList("/payments", { "paymentDate[ge]": de, "paymentDate[le]": ate, status: "REFUNDED" }),
    ]);
    linhas.push(...recemPagos, ...novas, ...estornos);
    await marcar(supabase, escopo, { ultima_incremental: new Date().toISOString() });
  }

  const n = await gravar(supabase, linhas.map(mapPayment));
  return { modo: requisicoes, linhas: n };
}

/**
 * A JANELA DO FLUXO PROJETADO — o que alimenta o gráfico do /caixa.
 *
 * As outras puxadas são recortadas por MÊS DE REFERÊNCIA e por isso não enxergam o
 * que interessa aqui: a cobrança que vence dia 12 do mês que vem, e a que venceu no
 * mês passado e ainda está em trânsito para o saldo. Esta puxa uma faixa contínua de
 * vencimento em torno de hoje:
 *
 *   ← 45 dias           HOJE           31 dias →
 *   ├────────────────────┼────────────────────┤
 *   pagas há pouco,      |    a vencer dentro
 *   crédito ainda        |    dos 30 dias do
 *   a caminho (cartão)   |    gráfico
 *
 * SEM filtro de status, de propósito: é isso que faz o espelho se curar sozinho. Uma
 * cobrança gravada como PENDING que depois foi paga volta nesta varredura com o
 * status novo; com filtro `status=PENDING` ela nunca mais seria visitada e ficaria
 * viva no espelho, somando no fluxo um dinheiro que já entrou.
 */
const JANELA_ANTES = 45;
const JANELA_DEPOIS = 31;

async function puxarJanela(supabase: any) {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const de = subDias(hoje, JANELA_ANTES);
  const ate = somaDias(hoje, JANELA_DEPOIS);

  const cobrancas = await asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate });
  const n = await gravar(supabase, cobrancas.map(mapPayment));

  await marcar(supabase, "payment:janela", {
    ultima_completa: new Date().toISOString(),
    ultima_incremental: new Date().toISOString(),
    detalhe: { de, ate, linhas: n },
  });
  return { de, ate, linhas: n };
}

/**
 * Assinaturas ativas. Carga completa (ver TTL_ASSINATURAS_H), mas antes disso um
 * `totalCount` de 1 requisição decide se vale a pena: se a contagem bate com o que
 * já está no espelho e a carga é recente, as 32 páginas são puladas inteiras.
 */
async function puxarAssinaturas(supabase: any, completo: boolean) {
  const escopo = "subscription";
  const est = await estado(supabase, escopo);

  const idadeH = est?.ultima_completa
    ? (Date.now() - new Date(est.ultima_completa).getTime()) / 3_600_000
    : Infinity;

  if (!completo && idadeH < TTL_ASSINATURAS_H) {
    const [remoto, local] = await Promise.all([
      asaasCount("/subscriptions", { status: "ACTIVE" }),
      supabase.from("asaas_cache").select("*", { count: "exact", head: true }).eq("tipo", "subscription").eq("status", "ACTIVE"),
    ]);
    if (remoto === (local?.count ?? -1)) return { modo: "inalterado", linhas: 0, requisicoes: 1 };
  }

  const ativas = await asaasList("/subscriptions", { status: "ACTIVE" });
  // Quem não voltou no filtro ACTIVE saiu da base: sem isso, uma assinatura cancelada
  // continuaria somando no MRR para sempre.
  const vivos = new Set(ativas.map((s: any) => String(s?.id ?? "")));
  const { data: cacheados } = await supabase
    .from("asaas_cache").select("id_asaas").eq("tipo", "subscription").eq("status", "ACTIVE");
  const sumiram = (cacheados ?? []).map((r: any) => r.id_asaas).filter((id: string) => !vivos.has(id));
  if (sumiram.length) {
    await supabase.from("asaas_cache").update({ status: "INACTIVE" }).eq("tipo", "subscription").in("id_asaas", sumiram);
  }

  const n = await gravar(supabase, ativas.map(mapSubscription));
  await marcar(supabase, escopo, {
    ultima_completa: new Date().toISOString(),
    ultima_incremental: new Date().toISOString(),
    detalhe: { ativas: n, encerradas_no_ciclo: sumiram.length },
  });
  return { modo: "completa", linhas: n, encerradas: sumiram.length };
}

/**
 * NF-e do mês. Aqui o atalho é uma comparação de contagens: 2 requisições dizem se
 * emitidas/erro mexeram desde a última carga. Se não mexeram, as 28 páginas são
 * puladas. Nota autorizada não muda mais de valor, então a contagem basta.
 */
async function puxarNotas(supabase: any, ref: string, completo: boolean) {
  const { de, ate } = rangeMes(ref);
  const escopo = `invoice:${ref}`;
  const est = await estado(supabase, escopo);

  if (!completo && est?.ultima_completa) {
    const [remotoAut, remotoErr, local] = await Promise.all([
      asaasCount("/invoices", { "effectiveDate[ge]": de, "effectiveDate[le]": ate, status: "AUTHORIZED" }),
      asaasCount("/invoices", { "effectiveDate[ge]": de, "effectiveDate[le]": ate, status: "ERROR" }),
      supabase.rpc("asaas_metricas", { p_referencia: ref }),
    ]);
    const nfe = (local?.data as any)?.nfe;
    if (nfe && remotoAut === nfe.emitidas && remotoErr === nfe.erro) {
      return { modo: "inalterado", linhas: 0, requisicoes: 2 };
    }
  }

  const notas = await asaasList("/invoices", { "effectiveDate[ge]": de, "effectiveDate[le]": ate });
  const n = await gravar(supabase, notas.map(mapInvoice));
  await marcar(supabase, escopo, { ultima_completa: new Date().toISOString(), ultima_incremental: new Date().toISOString() });
  return { modo: "completa", linhas: n };
}

/* --------------------------------- cálculo -------------------------------- */

/**
 * Recalcula do espelho e grava o snapshot. Nenhuma requisição ao Asaas.
 *
 * A trava do começo não é decoração: um mês que nunca foi puxado tem espelho vazio,
 * e recalcular em cima disso gravaria zeros por cima de um snapshot bom. Nesse caso
 * devolvemos o que já existe e pedimos "Atualizar do Asaas".
 */
async function recalcular(supabase: any, ref: string) {
  const est = await estado(supabase, `payment:${ref}`);
  if (!est?.ultima_completa) {
    const { data: atual } = await supabase
      .from("asaas_snapshots").select("dados").eq("referencia", ref).maybeSingle();
    if (atual?.dados) {
      return { dados: atual.dados, aviso: "Este mês ainda não foi espelhado; use Atualizar do Asaas." };
    }
  }

  const { data, error } = await supabase.rpc("asaas_metricas", { p_referencia: ref });
  if (error) throw new Error(`asaas_metricas: ${error.message}`);
  const dados = data ?? null;

  const { error: e2 } = await supabase
    .from("asaas_snapshots")
    .upsert({ referencia: ref, dados, gerado_em: new Date().toISOString() }, { onConflict: "referencia" });
  if (e2) throw e2;
  return { dados };
}

/* ---------------------------------- cron ---------------------------------- */

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "asaas-sync").eq("token", token).maybeSingle();
  return !!data;
}

/* --------------------------------- handler -------------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (!(await chamadaDeCron(req, supabase))) {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    const action = body?.action ?? "recalcular";
    const ref = String(body?.referencia || mesAtual());

    /* ------------- PREVIEW ------------- */
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

    /* ------------- JANELA — só as cobranças do fluxo projetado do /caixa ------------- */
    // Ação separada porque quem precisa dela é a omie-caixa-sync (cron das 09h), não a
    // página /asaas: puxar mês, assinaturas e NF-e só para redesenhar o gráfico seria
    // caro à toa.
    if (action === "janela") {
      const janela = await puxarJanela(supabase);
      return json({ ok: true, origem: "asaas", detalhe: { janela } });
    }

    /* ------------- ATUALIZAR (única ação que fala com o Asaas) ------------- */
    if (action === "atualizar" || action === "sync") {
      const completo = body?.completo === true;

      // Carência: dois cliques seguidos não viram duas varreduras. O segundo cai no
      // recálculo local, que devolve exatamente os mesmos números — nada se perde,
      // porque nenhuma puxada anterior a 2 minutos deixou dado para trás.
      const ultima = (await estado(supabase, `payment:${ref}`))?.ultima_incremental;
      const segundos = ultima ? (Date.now() - new Date(ultima).getTime()) / 1000 : Infinity;
      if (!completo && segundos < CARENCIA_PUXADA_S) {
        const { dados } = await recalcular(supabase, ref);
        return json({
          ok: true, referencia: ref, origem: "espelho",
          aviso: `Atualizado há ${Math.round(segundos)}s — números recalculados sem consultar o Asaas.`,
          dados,
        });
      }

      const [pagamentos, assinaturas, notas, janela] = await Promise.all([
        puxarPagamentos(supabase, ref, completo),
        puxarAssinaturas(supabase, completo),
        puxarNotas(supabase, ref, completo),
        // A janela não tem mês — é sempre em torno de hoje. Só vale reatualizar quando
        // se está olhando o mês corrente.
        ref === mesAtual() ? puxarJanela(supabase) : Promise.resolve(null),
      ]);
      const { dados } = await recalcular(supabase, ref);
      return json({ ok: true, referencia: ref, origem: "asaas", detalhe: { pagamentos, assinaturas, notas, janela }, dados });
    }

    /* ------------- RECALCULAR (padrão) — 0 requisições ------------- */
    const { dados, aviso } = await recalcular(supabase, ref);
    return json({ ok: true, referencia: ref, origem: "espelho", aviso, dados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("asaas-sync error:", msg);
    return json({ error: msg }, 200);
  }
});