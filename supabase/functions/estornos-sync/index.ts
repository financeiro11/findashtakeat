// Edge Function: estornos-sync
// Alimenta /operacional/estornos — a conciliação Asaas × aba ESTORNOS da planilha
// de churn, que responde: quanto do que devolvemos é perda de verdade.
//
//     churn real (mês) = estornado no mês − o que o time marcou "Cobrança indevida"
//
// TRÊS COISAS QUE A API DO ASAAS NÃO ENTREGA DE GRAÇA — e que ditam o desenho:
//
// 1) NÃO EXISTE FILTRO DE ESTORNO PARCIAL. `status=PARTIALLY_REFUNDED` não é rejeitado
//    pela API: ela IGNORA o status desconhecido e devolve as 65.067 cobranças da conta
//    (medido). O mesmo vale para `type=` em /financialTransactions. A cobrança
//    devolvida pela metade continua RECEIVED/CONFIRMED e o estorno só aparece no array
//    `refunds` — logo, achar parcial exige varrer as cobranças e olhar o array.
//    Daí as duas puxadas: `status=REFUNDED` (13 requisições, pega TODOS os totais de
//    todos os tempos) + uma varredura por janela de vencimento (só os parciais).
//
// 2) A COMPETÊNCIA É O VENCIMENTO, NÃO A DATA DO ESTORNO. Um estorno feito em abril
//    pode ser de uma cobrança que vence em julho — o Asaas cancela a parcela lá na
//    frente. Ele pertence a julho. Por isso a varredura de parciais é por `dueDate`.
//
// 3) A LISTA DE COBRANÇAS NÃO TRAZ O NOME DO CLIENTE, só `cus_…`. Os nomes vêm de
//    /customers/{id}, um por requisição, e ficam cacheados em `asaas_cache`
//    (tipo='customer'). São ~900 na 1ª carga, então cada execução resolve um lote
//    (TETO_CLIENTES) e as seguintes completam. O casamento por LINK não depende
//    disso — o nome só melhora o casamento das linhas sem link.
//
// Ações (body.action):
//   "atualizar"  → Asaas + planilha + conciliação.  { desde?, ate?, completo? }
//   "recalcular" → só relê a planilha e reconcilia. ZERO requisições ao Asaas.
//   "conciliar"  → só a conciliação, do espelho local. Zero requisições.
//   "preview"    → amostra crua, para conferir campos.
//
// Auth: usuário logado OU cron (x-cron-token), como nas outras syncs.

import { asaasGet, asaasList } from "../_shared/asaas.ts";
import { requireUser } from "../_shared/auth.ts";
import { lerIntervalo, refAba } from "../_shared/sheets.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PLANILHA_ID = "10A9YnskShPPZ2Xz9d-kN2SHCv-qN-48-94rQBbCNWIo";
const ABA = "ESTORNOS";

// Janela padrão da varredura de parciais, em torno de hoje e medida no VENCIMENTO.
// 90 dias para trás cobrem o mês corrente e os dois anteriores; 45 para a frente pegam
// a parcela que o Asaas já cancelou lá na frente — o caso que motivou a competência
// por vencimento.
//
// O TAMANHO NÃO É GOSTO: a Edge Function morre com "Request idle timeout limit (150s)"
// e uma janela de 200 dias (~20 mil cobranças) bateu nisso — medido. Em ~135 dias são
// ~8 mil cobranças / ~80 requisições, que rodam com folga. Para trazer história mais
// antiga, chame com { desde, ate } em blocos de até uns 90 dias; os estornos TOTAIS
// (que são a maioria) já vêm inteiros de qualquer forma, porque `status=REFUNDED` não
// tem recorte de data.
const JANELA_ANTES = 90;
const JANELA_DEPOIS = 45;
const TETO_CLIENTES = 250;

/* --------------------------------- helpers -------------------------------- */

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return isNaN(n) ? 0 : n; };

function hojeBRT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
function somaDias(ymd: string, dias: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function isoDate(s?: string | null): string | null {
  if (!s) return null;
  const d = String(s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
const competenciaDe = (ymd: string | null) => (ymd ? `${ymd.slice(0, 7)}-01` : null);

/** Sem acento, sem caixa, sem pontuação — a chave de comparação de nomes. */
function chave(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "R$ 1.234,56" / "1234.56" / 1234.56 → 1234.56 */
function valorBR(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[R$\s ]/g, "").trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

/** "26/02/2026" (ou "2026-02-26") → "2026-02-26" */
function dataBR(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

// Quais motivos tiram o estorno do churn ("Cobrança indevida", "Erro de pagamento")
// NÃO se decide aqui: é `estornos_motivo_descarta` no Postgres, e a conciliação
// recalcula a coluna a cada passada. Ter a lista nos dois lugares já seria a
// armadilha de sempre — alguém acrescenta um motivo aqui e o SQL o desfaz calado.

/* ------------------------------- planilha --------------------------------- */

/**
 * Lê a aba pelo caminho autenticado (`_shared/sheets.ts`, gateway do Lovable).
 *
 * O caminho "óbvio" — baixar o .xlsx pelo link público — respondeu 401 nos testes: a
 * planilha não está aberta por link para quem chama de fora, e desde 29/08/2026 não está
 * aberta para ninguém. O gateway usa a conexão Google já autorizada e não depende disso;
 * foi por isso que esta sync seguiu verde enquanto a do churn morria todo dia.
 *
 * FORMATADO de propósito: o parser daqui espera "26/02/2026" e "R$ 1.234,56". Sem
 * formatação a data viria como número de série do Sheets, e `dataBR` devolveria null.
 */
async function lerPlanilha(): Promise<{ headers: string[]; rows: string[][] }> {
  const values = await lerIntervalo(PLANILHA_ID, `${refAba(ABA)}!A1:AZ1000`, { formatado: true });
  return { headers: (values[0] ?? []) as string[], rows: values.slice(1) as string[][] };
}

type LinhaPlanilha = {
  linha: number;
  estabelecimento: string; setor: string | null; periodo: string | null;
  valor_pago: number | null; valor_estornar: number | null;
  data_pagamento: string | null; data_solicitacao: string | null; mes: number | null;
  forma: string | null; status: string | null; data_realizada: string | null;
  links: string[]; motivo: string | null;
  observacoes: string | null; responsavel: string | null; executor: string | null;
};

/** Acha a coluna pelo cabeçalho normalizado — a planilha tem quebra de linha no meio de alguns. */
function coluna(headers: string[], ...pedacos: string[]): number {
  const alvos = pedacos.map(chave);
  for (let i = 0; i < headers.length; i++) {
    const h = chave(headers[i]);
    if (!h) continue;
    if (alvos.some((a) => h === a || h.startsWith(a))) return i;
  }
  return -1;
}

function parsePlanilha(headers: string[], rows: string[][]): LinhaPlanilha[] {
  const c = {
    estabelecimento: coluna(headers, "estabelecimento"),
    setor: coluna(headers, "setor"),
    periodo: coluna(headers, "periodo"),
    valor_pago: coluna(headers, "valor pago"),
    valor_estornar: coluna(headers, "valor a ser estornado"),
    data_pagamento: coluna(headers, "data de pagamento"),
    data_solicitacao: coluna(headers, "data de solicitacao"),
    mes: coluna(headers, "mes"),
    forma: coluna(headers, "forma de pagamento"),
    status: coluna(headers, "status"),
    data_realizada: coluna(headers, "data realizada"),
    link: coluna(headers, "link do comprovante"),
    motivo: coluna(headers, "motivo"),
    observacoes: coluna(headers, "observacoes"),
    responsavel: coluna(headers, "responsavel pelo pedido"),
    executor: coluna(headers, "executor"),
  };
  const txt = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");

  const out: LinhaPlanilha[] = [];
  rows.forEach((r, i) => {
    const estabelecimento = txt(r, c.estabelecimento);
    const motivo = txt(r, c.motivo);
    // Linha em branco no meio da aba não vira registro.
    if (!estabelecimento && !motivo && !txt(r, c.valor_estornar)) return;

    const linkBruto = txt(r, c.link);
    out.push({
      linha: i + 2, // +1 do cabeçalho, +1 porque o Sheets conta a partir de 1
      estabelecimento,
      setor: txt(r, c.setor) || null,
      periodo: txt(r, c.periodo) || null,
      valor_pago: valorBR(txt(r, c.valor_pago)),
      valor_estornar: valorBR(txt(r, c.valor_estornar)),
      data_pagamento: dataBR(txt(r, c.data_pagamento)),
      data_solicitacao: dataBR(txt(r, c.data_solicitacao)),
      mes: (() => { const n = parseInt(txt(r, c.mes), 10); return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null; })(),
      forma: txt(r, c.forma) || null,
      status: txt(r, c.status) || null,
      data_realizada: dataBR(txt(r, c.data_realizada)),
      links: linkBruto ? linkBruto.split(/[\s,;]+/).filter((x) => /^https?:\/\//i.test(x)) : [],
      motivo: motivo || null,
      observacoes: txt(r, c.observacoes) || null,
      responsavel: txt(r, c.responsavel) || null,
      executor: txt(r, c.executor) || null,
    });
  });
  return out;
}

async function gravarPlanilha(supabase: any, linhas: LinhaPlanilha[]) {
  // Trava contra o pior modo de falha desta função: o gateway responder 200 com a aba
  // vazia. Sem isto, a troca em bloco abaixo apagaria o espelho, a conciliação seguinte
  // não acharia classificação nenhuma e TODO estorno viraria churn — o número de topo
  // mudaria sozinho, calado, e voltaria ao normal na próxima hora. Aba vazia de verdade
  // não existe: a planilha é o registro histórico do time.
  if (!linhas.length) {
    const { count } = await supabase.from("estornos_planilha").select("*", { count: "exact", head: true });
    if ((count ?? 0) > 0) throw new Error("A aba ESTORNOS voltou vazia — espelho preservado.");
  }

  // Troca em bloco: a linha da planilha é identificada pela POSIÇÃO, e uma inserção no
  // meio da aba desloca todas as de baixo. Fazer upsert por cima deixaria um fantasma
  // com os dados antigos na última posição.
  const { error: eDel } = await supabase.from("estornos_planilha").delete().gte("linha", 0);
  if (eDel) throw new Error(`limpar estornos_planilha: ${eDel.message}`);
  const LOTE = 200;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await supabase.from("estornos_planilha")
      .insert(linhas.slice(i, i + LOTE).map((l) => ({ ...l, atualizado_em: new Date().toISOString() })));
    if (error) throw new Error(`gravar estornos_planilha: ${error.message}`);
  }
  return linhas.length;
}

/* --------------------------------- Asaas ---------------------------------- */

type Estorno = {
  id: string; id_pagamento: string; indice: number;
  cliente_id: string | null; descricao: string | null; assinatura: string | null;
  forma: string | null; status_cobranca: string | null; status_estorno: string | null;
  parcial: boolean; valor_cobranca: number; valor_estornado: number;
  data_estorno: string | null; data_vencimento: string | null; data_pagamento: string | null;
  competencia: string | null; invoice_url: string | null; comprovante_url: string | null;
  dados: unknown;
};

/** Explode uma cobrança nos seus estornos. Sem `refunds`, não é estorno — devolve []. */
function estornosDaCobranca(p: any): Estorno[] {
  const refunds = Array.isArray(p?.refunds) ? p.refunds : [];
  if (!refunds.length) return [];
  const valor = num(p?.value);
  const somaDone = refunds
    .filter((r: any) => String(r?.status).toUpperCase() === "DONE")
    .reduce((s: number, r: any) => s + num(r?.value), 0);
  // "Parcial" é sobre a COBRANÇA, não sobre cada devolução: três estornos de R$ 100
  // numa cobrança de R$ 300 não são parciais. Por isso a soma dos concluídos.
  const parcial = String(p?.status).toUpperCase() !== "REFUNDED" || (somaDone > 0 && somaDone + 0.005 < valor);
  const venc = isoDate(p?.dueDate);

  return refunds.map((r: any, i: number) => ({
    id: `${p.id}#${i}`,
    id_pagamento: String(p?.id ?? ""),
    indice: i,
    cliente_id: p?.customer ? String(p.customer) : null,
    descricao: p?.description ?? null,
    assinatura: p?.subscription ?? null,
    forma: p?.billingType ?? null,
    status_cobranca: p?.status ?? null,
    status_estorno: String(r?.status ?? "").toUpperCase() || null,
    parcial,
    valor_cobranca: valor,
    valor_estornado: num(r?.value),
    data_estorno: isoDate(r?.dateCreated),
    data_vencimento: venc,
    data_pagamento: isoDate(p?.paymentDate) ?? isoDate(p?.confirmedDate),
    competencia: competenciaDe(venc),
    invoice_url: p?.invoiceUrl ?? null,
    comprovante_url: r?.transactionReceiptUrl ?? p?.transactionReceiptUrl ?? null,
    dados: r,
  }));
}

/**
 * Resolve nomes de cliente que ainda não estão no cache, em lote limitado.
 *
 * São ~900 clientes distintos com estorno; buscar todos numa execução estoura o
 * tempo da função. Cada chamada resolve até TETO_CLIENTES e as seguintes completam —
 * enquanto isso o casamento por link (que é o exato) já funciona.
 */
async function resolverClientes(supabase: any, ids: string[]): Promise<{ mapa: Map<string, any>; resolvidos: number; faltam: number }> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const mapa = new Map<string, any>();

  for (let i = 0; i < unicos.length; i += 300) {
    const { data } = await supabase.from("asaas_cache")
      .select("id_asaas, dados").eq("tipo", "customer").in("id_asaas", unicos.slice(i, i + 300));
    for (const r of (data ?? []) as any[]) mapa.set(r.id_asaas, r.dados);
  }

  const faltantes = unicos.filter((id) => !mapa.has(id));
  const lote = faltantes.slice(0, TETO_CLIENTES);
  if (lote.length) {
    const buscados = await Promise.all(lote.map(async (id) => {
      try { return await asaasGet<any>(`/customers/${id}`); } catch { return null; }
    }));
    const linhas = buscados.filter(Boolean).map((c: any) => ({
      tipo: "customer", id_asaas: String(c.id), status: c?.deleted ? "DELETED" : "ACTIVE",
      valor: null, data_criacao: isoDate(c?.dateCreated), dados: c, atualizado_em: new Date().toISOString(),
    }));
    for (let i = 0; i < linhas.length; i += 200) {
      await supabase.from("asaas_cache").upsert(linhas.slice(i, i + 200), { onConflict: "tipo,id_asaas" });
    }
    for (const c of buscados) if (c) mapa.set(String(c.id), c);
  }
  return { mapa, resolvidos: lote.length, faltam: Math.max(0, faltantes.length - lote.length) };
}

async function gravarEstornos(supabase: any, estornos: Estorno[], mapaClientes: Map<string, any>) {
  const linhas = estornos.map((e) => {
    const c = e.cliente_id ? mapaClientes.get(e.cliente_id) : null;
    return {
      ...e,
      cliente_nome: c?.name ?? null,
      cliente_documento: c?.cpfCnpj ?? null,
      atualizado_em: new Date().toISOString(),
    };
  });
  const LOTE = 400;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await supabase.from("estornos_asaas")
      .upsert(linhas.slice(i, i + LOTE), { onConflict: "id", ignoreDuplicates: false });
    if (error) throw new Error(`gravar estornos_asaas: ${error.message}`);
  }
  return linhas.length;
}

/* ------------------------------- conciliação ------------------------------- */

/**
 * Amarra cada estorno a uma linha da planilha. A conta mora no Postgres
 * (`estornos_conciliar`) e não aqui: são 1.300 estornos × 222 linhas, e o casamento
 * é um join — em SQL isso é uma passada, em JS seriam 288 mil comparações puxadas
 * pela rede. E, mais importante, a regra fica calibrável por migration, sem
 * reimplantar a função a cada ajuste de limiar.
 */
async function conciliar(supabase: any) {
  const { data, error } = await supabase.rpc("estornos_conciliar");
  if (error) throw new Error(`conciliar: ${error.message}`);
  return data;
}

/* ---------------------------------- cron ---------------------------------- */

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "estornos-sync").eq("token", token).maybeSingle();
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

    if (action === "preview") {
      const [ref, plan] = await Promise.all([
        asaasGet<any>("/payments", { status: "REFUNDED", limit: 2 }),
        lerPlanilha(),
      ]);
      const parsed = parsePlanilha(plan.headers, plan.rows);
      return json({
        ok: true,
        refunded_totalCount: ref?.totalCount,
        amostra_cobranca: ref?.data?.[0] ?? null,
        planilha: { cabecalho: plan.headers.filter(Boolean), linhas: parsed.length, amostra: parsed.slice(0, 2) },
      });
    }

    if (action === "conciliar") {
      return json({ ok: true, origem: "espelho", conciliacao: await conciliar(supabase) });
    }

    if (action === "recalcular") {
      const plan = await lerPlanilha();
      const linhas = parsePlanilha(plan.headers, plan.rows);
      const gravadas = await gravarPlanilha(supabase, linhas);
      return json({ ok: true, origem: "planilha", planilha: { linhas: gravadas }, conciliacao: await conciliar(supabase) });
    }

    if (action === "atualizar" || action === "sync") {
      const hoje = hojeBRT();
      const de = isoDate(body?.desde) ?? somaDias(hoje, -JANELA_ANTES);
      const ate = isoDate(body?.ate) ?? somaDias(hoje, JANELA_DEPOIS);

      // (1) todos os estornos TOTAIS de todos os tempos — 13 requisições, e é a única
      //     forma de o painel enxergar um mês antigo sem varrer o ano inteiro.
      // (2) a janela de vencimento — é aqui que os PARCIAIS aparecem, já que eles não
      //     têm status próprio para filtrar.
      const [totais, janela] = await Promise.all([
        asaasList("/payments", { status: "REFUNDED" }),
        asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate }),
      ]);

      const cobrancas = new Map<string, any>();
      for (const p of [...totais, ...janela]) if (p?.id) cobrancas.set(String(p.id), p);

      const estornos: Estorno[] = [];
      for (const p of cobrancas.values()) estornos.push(...estornosDaCobranca(p));

      const clientes = await resolverClientes(supabase, estornos.map((e) => e.cliente_id ?? ""));
      const gravados = await gravarEstornos(supabase, estornos, clientes.mapa);

      // Estorno cancelado no Asaas some do array `refunds`; a linha antiga ficaria viva
      // no espelho somando um dinheiro que voltou. Some com o que não voltou na leitura
      // das cobranças que acabamos de visitar.
      const vivos = new Set(estornos.map((e) => e.id));
      const visitados = [...cobrancas.keys()];
      let removidos = 0;
      for (let i = 0; i < visitados.length; i += 300) {
        const { data } = await supabase.from("estornos_asaas").select("id").in("id_pagamento", visitados.slice(i, i + 300));
        const orfaos = (data ?? []).map((r: any) => r.id).filter((id: string) => !vivos.has(id));
        if (orfaos.length) {
          await supabase.from("estornos_asaas").delete().in("id", orfaos);
          removidos += orfaos.length;
        }
      }

      const plan = await lerPlanilha();
      const linhasPlan = parsePlanilha(plan.headers, plan.rows);
      const gravadasPlan = await gravarPlanilha(supabase, linhasPlan);

      await supabase.from("asaas_sync_estado").upsert({
        escopo: "estornos",
        ultima_completa: new Date().toISOString(),
        ultima_incremental: new Date().toISOString(),
        detalhe: { de, ate, cobrancas: cobrancas.size, estornos: gravados, clientes_faltando: clientes.faltam },
      }, { onConflict: "escopo" });

      return json({
        ok: true, origem: "asaas",
        detalhe: {
          janela: { de, ate },
          cobrancas_visitadas: cobrancas.size,
          estornos_gravados: gravados,
          estornos_removidos: removidos,
          clientes: { resolvidos: clientes.resolvidos, faltam: clientes.faltam },
          planilha: { linhas: gravadasPlan },
        },
        conciliacao: await conciliar(supabase),
      });
    }

    return json({ error: `ação desconhecida: ${action}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("estornos-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
