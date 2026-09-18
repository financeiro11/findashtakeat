// Edge Function: os-indicadores-calcular
//
// Calcula o que o Takeat OS deixa vazio (CAC, LTV, TM MRR, Payback, totais consolidados…)
// com a fórmula do próprio OS e grava em `os_painel_calculado`. Existe para o Assistente e a
// Revisão do Mês enxergarem os MESMOS números da tela /indicadores — a conta é o módulo
// `_shared/indicadores-os-calculo.ts`, o mesmo que a tela importa.
//
// Quem chama: `os_sync_refresh()` no fim da cópia diária do OS (via disparar_automacao, com
// x-cron-token), ou alguém com a capacidade `maquinario` à mão. Só escreve linha que o Hub
// calculou (origem ≠ "os"); o número do OS continua só em `os_painel_mensal`.
//
// Rápida: ~4 mil linhas do painel + 150 de custo, tudo em memória, uma escrita em lote.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import {
  completarMensal, type AssinaturaOS, type CustoOS, type IndicadorOS, type LinhaMensalOS,
} from "../_shared/indicadores-os-calculo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LOTE = 1000;

// deno-lint-ignore no-explicit-any
async function lerTudo<T>(supabase: any, tabela: string, colunas: string, ordem: string[], soMeses = false): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += LOTE) {
    let q = supabase.from(tabela).select(colunas);
    // mes = 13 é o total anual do OS, sem competência: não é mês.
    if (soMeses) q = q.not("competencia", "is", null);
    for (const o of ordem) q = q.order(o);
    const { data, error } = await q.range(de, de + LOTE - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    todas.push(...((data ?? []) as T[]));
    if (!data || data.length < LOTE) return todas;
  }
}

// PostgREST devolve numeric como número; a conversão é defensiva (texto não soma calado).
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

// deno-lint-ignore no-explicit-any
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "os-indicadores-calcular").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (!(await chamadaDeCron(req, supabase))) {
      const u = await requireUser(req);
      if (!u.pode("maquinario")) return json({ error: "Sem permissão: recalcular os indicadores do OS pede a capacidade maquinário." }, 403);
    }

    const [inds, linhasCruas, custosCrus, carteiraCrua] = await Promise.all([
      lerTudo<IndicadorOS & { unidade: string; sensivel: boolean | null }>(supabase, "os_indicadores",
        "id,departamento,canal,indicador,unidade,sensivel,e_formula,formula", ["id"]),
      lerTudo<LinhaMensalOS>(supabase, "os_painel_mensal", "indicator_id,ano,mes,competencia,orcado,realizado",
        ["competencia", "indicator_id"], true),
      lerTudo<CustoOS>(supabase, "os_custos", "competencia,grupo,categoria,valor", ["competencia", "id"]),
      lerTudo<AssinaturaOS>(supabase, "os_assinaturas", "competencia,clientes", ["competencia"]),
    ]);

    const linhas = linhasCruas.map((l) => ({ ...l, orcado: num(l.orcado), realizado: num(l.realizado) }));
    const custos = custosCrus.map((c) => ({ ...c, valor: num(c.valor) }));
    const carteira = carteiraCrua.map((a) => ({ ...a, clientes: num(a.clientes) }));

    const saida = completarMensal(inds, linhas, custos, carteira);
    const porId = new Map(inds.map((i) => [i.id, i]));
    const agora = new Date().toISOString();

    const calculadas = saida
      .filter((l) => l.origem && l.origem !== "os" && l.realizado != null && isFinite(l.realizado))
      .map((l) => {
        const i = porId.get(l.indicator_id);
        return {
          indicator_id: l.indicator_id,
          competencia: l.competencia.slice(0, 10),
          ano: l.ano, mes: l.mes,
          departamento: i?.departamento ?? null, canal: i?.canal ?? null, indicador: i?.indicador ?? null,
          unidade: i?.unidade ?? null, sensivel: i?.sensivel ?? false,
          orcado: l.orcado, realizado: l.realizado, origem: l.origem, nota: l.nota ?? null,
          calculado_em: agora,
        };
      });

    // Troca inteira: o que deixou de ser calculável (o OS passou a lançar) tem de sair.
    const { error: eDel } = await supabase.from("os_painel_calculado").delete().lt("calculado_em", agora);
    if (eDel) throw new Error(`limpar os_painel_calculado: ${eDel.message}`);
    for (let i = 0; i < calculadas.length; i += 500) {
      const { error } = await supabase.from("os_painel_calculado")
        .upsert(calculadas.slice(i, i + 500), { onConflict: "indicator_id,competencia" });
      if (error) throw new Error(`gravar os_painel_calculado: ${error.message}`);
    }

    const porOrigem = calculadas.reduce<Record<string, number>>((a, l) => ((a[l.origem!] = (a[l.origem!] ?? 0) + 1), a), {});
    return json({ ok: true, linhas_lidas: linhas.length, calculadas: calculadas.length, por_origem: porOrigem });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const status = /autenticad|permiss/i.test(msg) ? 401 : 500;
    return json({ error: msg }, status);
  }
});
