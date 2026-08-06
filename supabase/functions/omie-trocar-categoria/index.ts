// Edge Function: omie-trocar-categoria
//
// Troca a categoria de UM lançamento no Omie a partir do drill-down da DRE/DFC.
//
// A ordem importa e é o coração desta função:
//   1. altera no OMIE (fonte da verdade) e confirma relendo o cadastro;
//   2. só então aplica a mesma troca no cache local (`omie_cache`), que é de onde
//      o drill-down e a detecção de reclassificação leem;
//   3. registra na trilha `omie_categoria_alteracoes`.
// Se o passo 1 falhar, nada muda aqui — o Hub nunca mostra uma classificação que
// o ERP não tem. O recálculo da DRE/DFC (omie-sync, que lê o cache) fica para
// quem chamou: é um clique só na tela e não custa API do Omie.
//
// Ações (body.action):
//   "trocar"    → (padrão) { cod_titulo, codigo, motivo?, origem?, mes? }
//   "consultar" → só leitura: o que o cache tem e o que o Omie tem para o título.
//
// PREVISAO_ORDEM_SERVICO / PREVISAO_CONTRATO não são alteráveis por aqui: são
// projeções geradas por OS/contrato e a categoria mora no documento de origem.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { consultarTitulo, grupoAlteravel, trocarCategoriaTitulo } from "../_shared/omie.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Lancamento = {
  cod_titulo: string; grupo: string; natureza: string; categoria: string | null;
  valor: number | null; data: string | null; contraparte: string | null;
  documento: string | null; status: string | null;
};

type Categoria = {
  codigo: string; descricao: string; despesa: boolean; receita: boolean;
  rubrica_dre: string | null; rubrica_dfc: string | null; usos: number;
};

// Diagnóstico pelo banco (SQL → pg_net), mesmo esquema de token das syncs
// agendadas. Aqui ele NÃO destranca a alteração: quem entra por este caminho só
// consegue a ação de leitura (ver a amarração logo abaixo). É o que permite
// conferir o contrato da API do Omie sem service key e sem tocar em nada.
async function chamadaDeDiagnostico(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "omie-trocar-categoria").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const diagnostico = await chamadaDeDiagnostico(req, supabase);
    let caller: Awaited<ReturnType<typeof requireUser>> | null = null;
    if (!diagnostico) caller = await requireUser(req, { bloquearCargos: ["parcerias"] });

    // Token de diagnóstico só lê, aconteça o que acontecer com o body.
    const action = diagnostico ? "consultar" : String(body?.action ?? "trocar");

    // Erro de negócio sai com HTTP 200 + { status: "erro" } de propósito: o
    // `functions.invoke` do supabase-js esconde o corpo da resposta quando o
    // status não é 2xx, e é justamente o texto do erro que a pessoa precisa ler
    // ("título rateado", "categoria inativa"). Só autenticação sai com 401.
    const codTitulo = String(body?.cod_titulo ?? "").trim();
    if (!codTitulo || codTitulo === "0") {
      return json({ status: "erro", erro: "Informe o cod_titulo do lançamento." }, 200);
    }

    /* -------- 1) O que o cache sabe do título -------- */
    const { data: lancRows, error: lancErr } = await supabase.rpc("omie_lancamento", { p_cod_titulo: codTitulo });
    if (lancErr) throw new Error(`Falha ao ler o lançamento: ${lancErr.message}`);
    const lanc = ((lancRows as Lancamento[]) ?? [])[0] ?? null;
    if (!lanc) {
      return json({
        status: "erro",
        erro: "Não achei este lançamento no cache do Omie. Sincronize com o Omie e tente de novo.",
      }, 200);
    }

    /* -------- CONSULTAR (só leitura) -------- */
    if (action === "consultar") {
      let noOmie: unknown = null;
      let erroOmie: string | null = null;
      if (grupoAlteravel(lanc.grupo)) {
        try { noOmie = await consultarTitulo(lanc.grupo, codTitulo); }
        catch (e) { erroOmie = e instanceof Error ? e.message : String(e); }
      }
      return json({ status: "ok", cache: lanc, alteravel: grupoAlteravel(lanc.grupo), omie: noOmie, erro_omie: erroOmie });
    }

    if (action !== "trocar") return json({ status: "erro", erro: `Ação desconhecida: ${action}` }, 200);

    /* -------- 2) Dá para alterar este tipo de lançamento? -------- */
    if (!grupoAlteravel(lanc.grupo)) {
      const explica = lanc.grupo?.startsWith("PREVISAO")
        ? "É uma previsão gerada por ordem de serviço/contrato: a categoria vem do documento de origem, não do financeiro."
        : "É a perna bancária de um título (movimento de conta corrente), que não tem classificação própria.";
      return json({ status: "erro", erro: `Este lançamento não pode ter a categoria trocada por aqui. ${explica}` }, 200);
    }

    /* -------- 3) A categoria de destino existe e é lançável? -------- */
    const codigoNovo = String(body?.codigo ?? "").trim();
    if (!codigoNovo) return json({ status: "erro", erro: "Informe a categoria de destino." }, 200);

    const { data: catRows, error: catErr } = await supabase.rpc("omie_categorias_disponiveis");
    if (catErr) throw new Error(`Falha ao ler as categorias: ${catErr.message}`);
    const categorias = (catRows as Categoria[]) ?? [];
    const para = categorias.find((c) => c.codigo === codigoNovo);
    if (!para) {
      return json({
        status: "erro",
        erro: `A categoria ${codigoNovo} não está disponível para lançamento (inexistente, inativa ou totalizadora no Omie).`,
      }, 200);
    }
    const deCache = categorias.find((c) => c.codigo === (lanc.categoria ?? ""));

    /* -------- 4) Altera no Omie e confirma -------- */
    const r = await trocarCategoriaTitulo({ grupo: lanc.grupo, codTitulo, codigoCategoria: codigoNovo });
    const de = categorias.find((c) => c.codigo === r.de) ?? deCache;

    /* -------- 5) Espelha no cache local -------- */
    let pernas = 0;
    let erroCache: string | null = null;
    const { data: nPernas, error: cacheErr } = await supabase.rpc("omie_cache_trocar_categoria", {
      p_cod_titulo: codTitulo, p_codigo: codigoNovo,
    });
    if (cacheErr) {
      // O Omie já mudou — isto é só o espelho local. Reportamos em vez de
      // derrubar, porque o próximo sync completo conserta sozinho.
      erroCache = cacheErr.message;
      console.error("cache não atualizado:", cacheErr.message);
    } else {
      pernas = Number(nPernas) || 0;
    }

    /* -------- 6) Trilha -------- */
    const { error: trilhaErr } = await supabase.from("omie_categoria_alteracoes").insert({
      cod_titulo: codTitulo,
      grupo: lanc.grupo,
      contraparte: lanc.contraparte,
      documento: lanc.documento,
      data: lanc.data,
      valor: lanc.valor,
      categoria_de: r.de || lanc.categoria,
      descricao_de: de?.descricao ?? null,
      categoria_para: codigoNovo,
      descricao_para: para.descricao,
      rubrica_dre_de: de?.rubrica_dre ?? null,
      rubrica_dre_para: para.rubrica_dre,
      rubrica_dfc_de: de?.rubrica_dfc ?? null,
      rubrica_dfc_para: para.rubrica_dfc,
      origem: body?.origem ? String(body.origem) : null,
      mes: body?.mes ? String(body.mes) : null,
      motivo: body?.motivo ? String(body.motivo).slice(0, 500) : null,
      alterado_por: caller?.userId ?? null,
      alterado_por_email: caller?.email ?? null,
    });
    if (trilhaErr) console.error("trilha não gravada:", trilhaErr.message);

    console.log(
      `categoria trocada · título ${codTitulo} · ${r.de || "?"} → ${codigoNovo} · ` +
      `${lanc.contraparte ?? "sem nome"} · ${r.confirmacao} · ${pernas} perna(s) no cache`,
    );

    return json({
      status: "ok",
      cod_titulo: codTitulo,
      ja_estava: r.jaEstava,
      de: { codigo: r.de || null, descricao: de?.descricao ?? null, rubrica_dre: de?.rubrica_dre ?? null, rubrica_dfc: de?.rubrica_dfc ?? null },
      para: { codigo: para.codigo, descricao: para.descricao, rubrica_dre: para.rubrica_dre, rubrica_dfc: para.rubrica_dfc },
      contraparte: lanc.contraparte,
      valor: lanc.valor,
      cache_pernas: pernas,
      erro_cache: erroCache,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-trocar-categoria error:", msg);
    // A recusa do Omie (título rateado, categoria inválida, título bloqueado)
    // chega aqui — e é o texto que a pessoa precisa ler na tela, então vai com
    // 200 pelo mesmo motivo dos erros de negócio acima.
    const status = /autentic|permiss/i.test(msg) ? 401 : 200;
    return json({ status: "erro", erro: msg }, status);
  }
});
