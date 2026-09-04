// Edge Function: demonstracoes-meios-pagamento
//
// Escreve a linha "Meios de Pagamento" da DRE e da DFC com o somatório das taxas
// do Asaas do mês. Ver _shared/meios-pagamento-asaas.ts para o porquê: essa
// rubrica NUNCA vem do Omie (a taxa é descontada na liquidação, não vira conta a
// pagar), e até aqui só existia enquanto alguém digitava no tracker.
//
// O número não é gravado direto no blob: ele entra em `demonstracoes_valor_manual`
// com `origem='asaas'` e é reaplicado por cima de todo sync e todo import — a
// mesma camada dos valores digitados à mão, que já sabe repercutir o delta nos
// blocos pais e nos totais. Duas consequências de propósito:
//
//   • célula em que uma PESSOA digitou (`origem='manual'`) não é tocada. Quem
//     fixou um número está corrigindo alguma coisa que a rotina não sabe;
//   • mês que o espelho do extrato não cobre desde o dia 1 é PULADO, não somado
//     pela metade — o relatório diz qual e por quê.
//
// Body:
//   { action: "preview" }  → não escreve nada; devolve o que faria
//   { action: "aplicar" }  → grava e reaplica no blob
//   { de?: "YYYY-MM-DD", ate?: "YYYY-MM-DD" }  → recorta os meses (opcional)
//
// Auth: usuário logado (botão na tela) OU cron (header x-cron-token).

// Versão fixa: `@2` solto resolve a última do dia e já quebrou o deploy.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { aplicarValoresManuais, type Dados } from "../_shared/valores-manuais.ts";
import { aplicarEbitdaAjustado } from "../_shared/ebitda-ajustado.ts";
import { recalcularDerivadas } from "../_shared/derivadas.ts";
import {
  RUBRICA_MEIOS_PAGAMENTO,
  decidirMeses,
  aplicaveis,
  type Aplicavel,
  type Decisao,
  type TaxaDoMes,
} from "../_shared/meios-pagamento-asaas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TIPOS = ["dre", "dfc"] as const;
type Tipo = (typeof TIPOS)[number];

// O Asaas trabalha em data local; "hoje" tem que ser o de Brasília, senão à noite
// o mês corrente vira o mês seguinte e a coluna nasce no futuro.
const hojeBRT = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

// deno-lint-ignore no-explicit-any
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "demonstracoes-meios-pagamento").eq("token", token).maybeSingle();
  return !!data;
}

type Escrita = { col_key: string; valor: number; acao: "criado" | "atualizado" | "sem mudança" | "respeitado (manual)" };

/**
 * Grava as células de UM tipo e devolve as colunas que mudaram. Não reaplica no
 * blob — quem chama faz isso uma vez só, com todas as colunas na mão.
 */
async function gravarCelulas(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tipo: Tipo,
  alvos: Aplicavel[],
  agora: string,
): Promise<{ escritas: Escrita[]; colunas: Set<string> }> {
  const { data: existentes, error } = await supabase
    .from("demonstracoes_valor_manual")
    .select("id,col_key,origem,valor,modo")
    .eq("tipo", tipo).eq("rubrica", RUBRICA_MEIOS_PAGAMENTO);
  if (error) throw error;

  const porCol = new Map<string, Record<string, unknown>>();
  for (const r of existentes ?? []) porCol.set(String(r.col_key), r);

  const escritas: Escrita[] = [];
  const colunas = new Set<string>();

  for (const a of alvos) {
    const ex = porCol.get(a.col_key);

    // Alguém digitou nesta célula: a pessoa manda. A rotina reporta e segue.
    if (ex && String(ex.origem ?? "manual") !== "asaas") {
      escritas.push({ col_key: a.col_key, valor: Number(ex.valor ?? 0), acao: "respeitado (manual)" });
      continue;
    }

    const detalhe = {
      taxas: a.detalhe ?? {},
      lancamentos: a.lancamentos,
      parcial: a.parcial,
      mes: a.mes,
      em: agora,
    };

    if (ex) {
      // Já vale este número — não reescreve para não sujar `atualizado_em` todo
      // dia num mês que já fechou.
      if (Math.abs(Number(ex.valor ?? 0) - a.valor) < 0.005 && String(ex.modo ?? "") === "substitui") {
        escritas.push({ col_key: a.col_key, valor: a.valor, acao: "sem mudança" });
        continue;
      }
      /* `valor_base`/`valor_aplicado` NÃO entram no update: eles descrevem o que
         está no blob agora, e é a reaplicação que os atualiza. Zerá-los aqui
         faria o delta ser somado duas vezes no total do mês. */
      const { error: e } = await supabase.from("demonstracoes_valor_manual")
        .update({ valor: a.valor, modo: "substitui", origem: "asaas", detalhe, atualizado_em: agora })
        .eq("id", ex.id);
      if (e) throw e;
      escritas.push({ col_key: a.col_key, valor: a.valor, acao: "atualizado" });
    } else {
      const { error: e } = await supabase.from("demonstracoes_valor_manual").insert({
        tipo, rubrica: RUBRICA_MEIOS_PAGAMENTO, col_key: a.col_key,
        valor: a.valor, modo: "substitui", origem: "asaas", detalhe,
        autor: null, autor_email: null,
      });
      if (e) throw e;
      escritas.push({ col_key: a.col_key, valor: a.valor, acao: "criado" });
    }
    colunas.add(a.col_key);
  }

  return { escritas, colunas };
}

/** Reaplica os manuais no blob do tipo e regrava. Mesma sequência da edição pela tela. */
async function reaplicarNoBlob(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tipo: Tipo,
  colunas: Set<string>,
): Promise<void> {
  const { data: blobRow, error } = await supabase
    .from("demonstracoes_contabeis").select("dados")
    .eq("tipo", tipo).eq("periodo", "completo").maybeSingle();
  if (error) throw error;

  const bruto: Dados = (blobRow?.dados as Dados) ?? { columns: [], rows: [] };
  /* `colunasAtualizadas` vai VAZIO: nenhuma coluna foi refeita do zero nesta
     chamada (não houve sync nem import), então a base de cada célula é a que já
     estava guardada. É o que impede o valor de dobrar em mês travado. */
  const comManuais = await aplicarValoresManuais(supabase, tipo, bruto, new Set());
  const comAjustado = await aplicarEbitdaAjustado(supabase, tipo, comManuais);
  // Só os meses tocados: escrever agosto não pode reescrever julho.
  const dados = recalcularDerivadas(tipo, comAjustado, colunas);

  const { error: upErr } = await supabase.from("demonstracoes_contabeis")
    .upsert({ tipo, periodo: "completo", dados, pdf_path: null }, { onConflict: "tipo,periodo" });
  if (upErr) throw upErr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (!(await chamadaDeCron(req, supabase))) await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const aplicar = body?.action === "aplicar";

    /* ---------------- o que o extrato diz ---------------- */
    const { data: linhas, error: rpcErr } = await supabase.rpc("asaas_taxas_mes", {
      p_de: body?.de ?? null,
      p_ate: body?.ate ?? null,
    });
    if (rpcErr) throw rpcErr;

    const taxas: TaxaDoMes[] = (linhas ?? []).map((r: Record<string, unknown>) => ({
      mes: String(r.mes ?? ""),
      total: Number(r.total ?? 0),
      lancamentos: Number(r.lancamentos ?? 0),
      detalhe: (r.detalhe as Record<string, number>) ?? null,
      de: (r.cobertura_de as string) ?? null,
      ate: (r.cobertura_ate as string) ?? null,
      coberto: r.coberto === true,
    }));

    // O primeiro dia que o espelho conhece — só para o motivo do pulo ser legível.
    const { data: pri } = await supabase
      .from("asaas_extrato").select("data_movimento")
      .not("data_movimento", "is", null)
      .order("data_movimento", { ascending: true }).limit(1).maybeSingle();

    const decisoes: Decisao[] = decidirMeses(taxas, hojeBRT(), (pri?.data_movimento as string) ?? null);
    const alvos = aplicaveis(decisoes);

    const relatorio = {
      meses: decisoes.map((d) => d.aplicar
        ? { mes: d.mes, col_key: d.col_key, valor: d.valor, lancamentos: d.lancamentos, parcial: d.parcial, detalhe: d.detalhe }
        : { mes: d.mes, pulado: d.motivo }),
      pulados: decisoes.filter((d) => !d.aplicar).length,
    };

    if (!aplicar) return json({ ok: true, preview: true, rubrica: RUBRICA_MEIOS_PAGAMENTO, ...relatorio });

    /* ---------------- grava e reaplica ---------------- */
    const agora = new Date().toISOString();
    const escrito: Record<string, Escrita[]> = {};

    for (const tipo of TIPOS) {
      const { escritas, colunas } = await gravarCelulas(supabase, tipo, alvos, agora);
      escrito[tipo] = escritas;
      // Nada mudou nesta demonstração: reaplicar mexeria no blob à toa.
      if (colunas.size) await reaplicarNoBlob(supabase, tipo, colunas);
    }

    return json({
      ok: true,
      rubrica: RUBRICA_MEIOS_PAGAMENTO,
      ...relatorio,
      escrito,
      trigger: body?.trigger ?? "manual",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("demonstracoes-meios-pagamento error:", msg);
    return json({ error: msg }, 200);
  }
});
