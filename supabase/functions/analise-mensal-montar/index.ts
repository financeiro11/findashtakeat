// Edge Function: analise-mensal-montar
//
// Monta a camada de análise (`analise_mensal`): todos os números do Hub alinhados por mês,
// com fonte, regime, plano do BP, meta do OS e status de confiança. A conta inteira está em
// `_shared/analise-mensal.ts` (puro, testado); aqui só se lê cada fonte e se grava.
//
// Fontes, cada uma pelo leitor que o Hub já usa:
//   DRE / DFC   demonstracoes_contabeis (periodo='completo' — backup mais novo enganaria)
//               lido por _shared/assistente/dre.ts; trava em demonstracoes_mes_trancado.
//   OS          os_painel_completo (OS + o que o Hub calculou onde o OS deixou vazio)
//   Carteira    os_assinaturas
//   Painel CAC  RPC cac_painel(ano)            Estornos  RPC estornos_serie()
//   Churn bruto churn_snapshot (montado do OS)  BP        bp_anual (_shared/bp-anual.ts e
//                                                          _shared/bp-operacao.ts)
//
// Quem chama: `os_sync_refresh()` no fim da cópia diária (disparar_automacao, x-cron-token)
// ou alguém com `demonstracoes` à mão. Troca a tabela inteira a cada rodada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { estruturar, montarColuna, valorDe } from "../_shared/assistente/dre.ts";
import { lerBpAnual, normLabel } from "../_shared/bp-anual.ts";
import { parsearOperacao, type MesBP } from "../_shared/bp-operacao.ts";
import { montarAnalise, type Fontes } from "../_shared/analise-mensal.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const num = (v: unknown): number | null => (v == null || v === "" ? null : isFinite(Number(v)) ? Number(v) : null);
const comp = (c: string) => String(c).slice(0, 10);
const partes = (c: string) => ({ ano: Number(c.slice(0, 4)), mes: Number(c.slice(5, 7)) });

// deno-lint-ignore no-explicit-any
async function lerTudo(supabase: any, tabela: string, colunas: string, filtro?: (q: any) => any): Promise<any[]> {
  const todas: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(colunas);
    if (filtro) q = filtro(q);
    const { data, error } = await q.range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    todas.push(...(data ?? []));
    if (!data || data.length < 1000) return todas as any[];
  }
}

// deno-lint-ignore no-explicit-any
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase.from("internal_cron_tokens").select("name")
    .eq("name", "analise-mensal-montar").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (!(await chamadaDeCron(req, supabase))) {
      const u = await requireUser(req);
      if (!u.pode("demonstracoes")) return json({ error: "Sem permissão: remontar a análise pede a capacidade demonstrações." }, 403);
    }

    // Janela: jan/2025 até o mês corrente (o corrente sai como mês aberto).
    const hoje = new Date();
    const anoAtual = hoje.getUTCFullYear();
    const meses: string[] = [];
    for (let a = 2025; a <= anoAtual; a++) {
      for (let m = 1; m <= 12; m++) {
        if (a === anoAtual && m > hoje.getUTCMonth() + 1) break;
        meses.push(`${a}-${String(m).padStart(2, "0")}-01`);
      }
    }

    const [dem, travas, os, carteira, snaps, bps, estornos, ...cacs] = await Promise.all([
      supabase.from("demonstracoes_contabeis").select("tipo,dados,updated_at").eq("periodo", "completo"),
      supabase.from("demonstracoes_mes_trancado").select("col_key"),
      lerTudo(supabase, "os_painel_completo", "departamento,canal,indicador,competencia,realizado,orcado,origem,nota",
        (q) => q.not("competencia", "is", null)),
      supabase.from("os_assinaturas").select("competencia,mrr_total_assinatura,clientes"),
      supabase.from("churn_snapshot").select("competencia,dados"),
      supabase.from("bp_anual").select("ano,dados,abas"),
      supabase.rpc("estornos_serie"),
      ...Array.from({ length: anoAtual - 2024 }, (_, i) => supabase.rpc("cac_painel", { p_ano: 2025 + i })),
    ]);
    for (const r of [dem, travas, snaps, bps] as { error: { message: string } | null }[]) if (r.error) throw new Error(r.error.message);

    const dre = estruturar(dem.data?.find((d: { tipo: string }) => d.tipo === "dre")?.dados ?? null);
    const dfc = estruturar(dem.data?.find((d: { tipo: string }) => d.tipo === "dfc")?.dados ?? null);
    const travados = new Set(((travas.data ?? []) as { col_key: string }[]).map((t) => t.col_key));

    const osMapa = new Map<string, { realizado: number | null; orcado: number | null; origem: string | null; nota: string | null }>();
    for (const l of os) {
      osMapa.set(`${l.departamento}|${l.canal}|${l.indicador}|${comp(l.competencia)}`,
        { realizado: num(l.realizado), orcado: num(l.orcado), origem: l.origem ?? null, nota: l.nota ?? null });
    }
    const cart = new Map(((carteira.data ?? []) as { competencia: string; mrr_total_assinatura: unknown; clientes: unknown }[])
      .map((c) => [comp(c.competencia), { mrr: num(c.mrr_total_assinatura), clientes: num(c.clientes) }]));
    const churn = new Map(((snaps.data ?? []) as { competencia: string; dados: any }[]).map((s) => [comp(s.competencia), {
      cancelValor: num(s.dados?.kpis?.cancel_valor), downsellValor: num(s.dados?.kpis?.downsell_valor), base: num(s.dados?.base?.mrr_inicio),
    }]));
    const est = new Map(((estornos.data ?? []) as { competencia: string; churn_real: unknown; estornado: unknown }[])
      .map((e) => [comp(e.competencia), { churnReal: num(e.churn_real), estornado: num(e.estornado) }]));

    const gasto = new Map<string, number>();
    cacs.forEach((r: { data: { mes: number; valor: unknown }[] | null; error: unknown }, i: number) => {
      if (r.error) return; // acessório: sem o Painel CAC, as métricas dele saem sem dado
      for (const l of r.data ?? []) {
        const k = `${2025 + i}-${String(l.mes).padStart(2, "0")}-01`;
        gasto.set(k, (gasto.get(k) ?? 0) + (num(l.valor) ?? 0));
      }
    });

    const bpCons = new Map<number, Record<string, (number | null)[]>>();
    const bpOp = new Map<string, MesBP>();
    for (const b of (bps.data ?? []) as { ano: number; dados: unknown; abas: Record<string, unknown> | null }[]) {
      bpCons.set(Number(b.ano), lerBpAnual(b.dados).porRubrica);
      for (const [k, m] of parsearOperacao(b.abas?.["Operação"], Number(b.ano))) bpOp.set(comp(k), m);
    }

    const fontes: Fontes = {
      dre: (r, c) => valorDe(dre, r, partes(c)),
      dfc: (r, c) => valorDe(dfc, r, partes(c)),
      travado: (c) => travados.has(montarColuna(partes(c))),
      os: (d, canal, i, c) => osMapa.get(`${d}|${canal}|${i}|${c}`) ?? null,
      carteira: (c) => cart.get(c) ?? null,
      // Mês sem nenhuma linha do painel (antes do Hub ter o CAC) não é "zero de gasto".
      gastoAquisicao: (c) => (gasto.has(c) && (gasto.get(c) ?? 0) !== 0 ? gasto.get(c)! : null),
      estornos: (c) => est.get(c) ?? null,
      churnBruto: (c) => churn.get(c) ?? null,
      bp: (rotulo, c) => {
        const { ano, mes } = partes(c);
        return bpCons.get(ano)?.[normLabel(rotulo)]?.[mes - 1] ?? null;
      },
      bpOperacao: (campo, c) => {
        const v = (bpOp.get(c) as unknown as Record<string, unknown> | undefined)?.[campo];
        return typeof v === "number" && isFinite(v) ? v : null;
      },
      bpPreRevisao: (c) => !!bpOp.get(c)?.pre_revisao,
    };

    const linhas = montarAnalise(fontes, meses);
    const agora = new Date().toISOString();
    const { error: eDel } = await supabase.from("analise_mensal").delete().gte("competencia", "1900-01-01");
    if (eDel) throw new Error(`limpar analise_mensal: ${eDel.message}`);
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await supabase.from("analise_mensal").insert(linhas.slice(i, i + 500).map((l) => ({ ...l, calculado_em: agora })));
      if (error) throw new Error(`gravar analise_mensal: ${error.message}`);
    }

    const porStatus = linhas.reduce<Record<string, number>>((a, l) => ((a[l.status] = (a[l.status] ?? 0) + 1), a), {});
    return json({ ok: true, meses: meses.length, linhas: linhas.length, por_status: porStatus });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return json({ error: msg }, /autenticad|permiss/i.test(msg) ? 401 : 500);
  }
});
