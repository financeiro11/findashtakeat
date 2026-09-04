// Edge Function: demonstracoes-valor-manual
//
// Grava (ou apaga) o valor que a pessoa digitou numa célula da DRE/DFC e já
// reflete na demonstração — a tabela `demonstracoes_valor_manual` é a fonte de
// verdade, e o blob `demonstracoes_contabeis` é reescrito na mesma chamada.
//
// Por que passa por função em vez de o cliente escrever direto na tabela: gravar
// o manual sem reaplicar no blob deixaria a tabela dizendo uma coisa e a tela
// mostrando outra até alguém sincronizar. As duas escritas andam juntas.
//
// Body:
//   { tipo: "dre"|"dfc", rubrica, col_key, valor, modo?: "substitui"|"soma" }
//   { tipo, rubrica, col_key, remover: true }

// Versão fixa: `@2` solto resolve a última do dia e já quebrou o deploy.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { aplicarValoresManuais, type Dados, type ValorManual } from "../_shared/valores-manuais.ts";
import { aplicarEbitdaAjustado } from "../_shared/ebitda-ajustado.ts";
import { recalcularDerivadas } from "../_shared/derivadas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const tipo = body?.tipo === "dfc" ? "dfc" : body?.tipo === "dre" ? "dre" : null;
    const rubrica = String(body?.rubrica ?? "").trim();
    const colKey = String(body?.col_key ?? "").trim();
    const remover = body?.remover === true;

    if (!tipo) return json({ error: "tipo inválido (use 'dre' ou 'dfc')." }, 200);
    if (!rubrica) return json({ error: "rubrica obrigatória." }, 200);
    if (!/^[A-Za-z]{3}-\d{2}$/.test(colKey)) return json({ error: `mês inválido: ${colKey}` }, 200);

    /* ---------------- a linha manual ---------------- */
    const { data: atual, error: selErr } = await supabase
      .from("demonstracoes_valor_manual")
      .select("id,tipo,rubrica,col_key,modo,valor,valor_base,valor_aplicado")
      .eq("tipo", tipo).eq("rubrica", rubrica).eq("col_key", colKey)
      .maybeSingle();
    if (selErr) throw selErr;

    const removidos: ValorManual[] = [];

    if (remover) {
      if (!atual) return json({ error: "Não há valor manual nesta célula." }, 200);
      removidos.push({
        ...atual,
        tipo,
        valor: Number(atual.valor ?? 0),
        valor_base: atual.valor_base == null ? null : Number(atual.valor_base),
        valor_aplicado: atual.valor_aplicado == null ? null : Number(atual.valor_aplicado),
      } as ValorManual);
      const { error } = await supabase.from("demonstracoes_valor_manual").delete().eq("id", atual.id);
      if (error) throw error;
    } else {
      const valor = Number(body?.valor);
      if (!Number.isFinite(valor)) return json({ error: "valor inválido." }, 200);
      const modo = body?.modo === "soma" ? "soma" : "substitui";

      /* `origem: 'manual'` sempre, inclusive por cima de uma célula que a rotina
         das taxas do Asaas escrevia: digitar aqui é FIXAR o número, e a rotina
         respeita quem tem origem manual. Sem isso, o valor da pessoa duraria até
         a rodada do dia seguinte — e sumiria sem aviso. */
      if (atual) {
        // valor_base/valor_aplicado NÃO são zerados aqui: eles descrevem o que
        // está no blob agora, e é a reaplicação abaixo que os atualiza.
        const { error } = await supabase.from("demonstracoes_valor_manual")
          .update({ valor, modo, origem: "manual", autor: caller.userId, autor_email: caller.email ?? null, atualizado_em: new Date().toISOString() })
          .eq("id", atual.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("demonstracoes_valor_manual")
          .insert({ tipo, rubrica, col_key: colKey, valor, modo, origem: "manual", autor: caller.userId, autor_email: caller.email ?? null });
        if (error) throw error;
      }
    }

    /* ---------------- reaplica no blob ----------------
     * Nenhuma coluna foi refeita do zero nesta chamada (não houve sync nem
     * import), então `colunasAtualizadas` vai vazio: a base de cada célula é a
     * que já estava guardada. */
    const { data: blobRow, error: blobErr } = await supabase
      .from("demonstracoes_contabeis")
      .select("dados")
      .eq("tipo", tipo).eq("periodo", "completo")
      .maybeSingle();
    if (blobErr) throw blobErr;

    const bruto: Dados = (blobRow?.dados as Dados) ?? { columns: [], rows: [] };
    const comManuais = await aplicarValoresManuais(supabase, tipo, bruto, new Set(), removidos);
    // Digitar depreciação derruba o EBITDA — e o EBITDA Ajustado, que sai dele,
    // tem que descer junto na mesma chamada.
    const comAjustado = await aplicarEbitdaAjustado(supabase, tipo, comManuais);
    /* Linha de cálculo é calculada: o manual mexeu numa folha, os totais dela
       saem dela. Só o mês da célula — digitar em Jul não pode reescrever Jun. */
    const dados = recalcularDerivadas(tipo, comAjustado, new Set([colKey]));

    const { error: upErr } = await supabase.from("demonstracoes_contabeis")
      .upsert({ tipo, periodo: "completo", dados, pdf_path: null }, { onConflict: "tipo,periodo" });
    if (upErr) throw upErr;

    return json({ ok: true, removido: remover });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("demonstracoes-valor-manual error:", msg);
    return json({ error: msg }, 200);
  }
});
