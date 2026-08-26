// Edge Function: folha-previa
//
// Monta a prévia da folha de uma competência. Só leitura.
//
// POR QUE NO SERVIDOR, e não na tela: `omie_cache` tem RLS ligada e NENHUMA
// policy — nada é legível pelo usuário autenticado, só pela service role. A
// primeira versão desta prévia montava tudo no navegador e, por isso, saía com
// "sem fornecedor" e "categoria não achada" em TODAS as linhas: as duas
// respostas vinham vazias e o código lia isso como "não existe". Ler um cache
// que o chamador não enxerga é o tipo de erro que não dá erro.
//
// O FORNECEDOR é resolvido em duas passadas:
//   1. o cache `clientes`, que cobre a maioria de uma vez;
//   2. consulta DIRETA ao Omie, por CNPJ, para quem o cache não achou.
// A segunda existe porque o cache é uma foto (a última era de 24/08) e quem foi
// cadastrado depois apareceria como pendência sem ser. A busca é sempre por
// CNPJ, nunca por nome: nome de PJ de uma pessoa só é escrito de vários jeitos
// entre o RH e o ERP, e casar por nome erra para os dois lados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import {
  montarLote, pendenciasDoLote, recusaDaFolha, resolvedorDeCategoria, soDigitos,
  type ColaboradorDaFolha, type EstadoDaFolha, type ResolveDePara,
} from "../_shared/folha-envio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://app.omie.com.br/api/v1";

/**
 * Teto de consultas diretas ao Omie numa abertura de tela.
 *
 * Se o cache estiver muito velho, resolver todo mundo um a um viraria uma
 * tela que demora meio minuto e ainda toma rate limit. Passando disso, a
 * resposta avisa quantos ficaram sem conferir em vez de mentir que não existem.
 */
const MAX_CONSULTAS_DIRETAS = 40;

async function omieCall(path: string, call: string, param: Record<string, unknown>): Promise<any> {
  const app_key = Deno.env.get("OMIE_APP_KEY");
  const app_secret = Deno.env.get("OMIE_APP_SECRET");
  if (!app_key || !app_secret) throw new Error("Credenciais do Omie ausentes nos secrets.");

  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const res = await fetch(`${BASE}/${path}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
    });
    const texto = await res.text();
    let data: any;
    try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
    const fault = data && typeof data === "object" ? data.faultstring : null;
    if (res.ok && !fault) return data;

    const msg = String(fault || texto);
    // "não encontrado" é resposta legítima: ninguém cadastrado com esse CNPJ.
    if (/n.o (existem|foram encontrados|encontrado)|nenhum registro/i.test(msg)) return null;

    const transitorio = /425|redundante|processando|5020|too many|bloqueada|timeout|50[234]/i.test(msg);
    if (transitorio && tentativa < 3) {
      await new Promise((r) => setTimeout(r, 900 * 2 ** tentativa));
      continue;
    }
    throw new Error(`Omie ${call}: ${msg}`);
  }
  return null;
}

/** O fornecedor deste CNPJ no Omie, ou `null`. Busca por documento, nunca por nome. */
async function fornecedorPorCnpj(cnpj: string): Promise<number | null> {
  const r = await omieCall("geral/clientes", "ListarClientes", {
    pagina: 1,
    registros_por_pagina: 20,
    apenas_importado_api: "N",
    clientesFiltro: { cnpj_cpf: cnpj },
  });
  const achado = (r?.clientes_cadastro ?? [])[0];
  const codigo = Number(achado?.codigo_cliente_omie ?? 0);
  return codigo || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = await req.json().catch(() => ({}));
    const competencia = String(body?.competencia ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      return json({ status: "erro", erro: "Competência inválida." }, 400);
    }

    const [rh, dep, cadastrosCache, clientesCache, envio] = await Promise.all([
      supabase.from("rh_colaboradores")
        .select("id, codigo, nome, cnpj, razao, valor, inicio, datadesl"),
      supabase.from("folha_depara")
        .select("codigo_rh, departamento, categoria_descricao, valor_referencia, valor_ajustado, valor_rh_no_ajuste, ajuste_motivo, ajustado_em"),
      supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "folha_cadastros").maybeSingle(),
      supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "clientes").maybeSingle(),
      supabase.from("folha_envios_omie").select("estado, previsao_ajustada").eq("competencia", `${competencia}-01`).maybeSingle(),
    ]);
    if (rh.error) throw new Error(`Espelho do RH: ${rh.error.message}`);

    const cat = (cadastrosCache.data?.dados ?? {}) as {
      categorias?: { codigo: string; descricao: string; conta_inativa?: boolean }[];
      departamentos?: { codigo: string; descricao: string }[];
    };
    if (!cat.categorias?.length) {
      return json({
        status: "erro",
        erro: "Os cadastros do Omie (categorias, departamentos, contas correntes) ainda não foram "
          + "sincronizados. Rode `omie-folha-cadastros-sync` antes de abrir a prévia.",
      }, 409);
    }

    const codCategoria = resolvedorDeCategoria(cat.categorias ?? []);
    const codDepartamento = new Map((cat.departamentos ?? []).map((d) => [d.descricao, d.codigo]));

    const porCodigo = new Map(
      ((dep.data ?? []) as Record<string, unknown>[]).map((d) => [String(d.codigo_rh), d]),
    );
    const deParaDe: ResolveDePara = (codigo) => {
      const d = porCodigo.get(codigo);
      if (!d) return null;
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        departamento: String(d.departamento ?? ""),
        categoria: String(d.categoria_descricao ?? ""),
        valorReferencia: num(d.valor_referencia),
        valorAjustado: num(d.valor_ajustado),
        valorRhNoAjuste: num(d.valor_rh_no_ajuste),
      };
    };

    const pessoas: ColaboradorDaFolha[] = ((rh.data ?? []) as Record<string, unknown>[]).map((c) => ({
      id: String(c.id),
      codigo: (c.codigo as string) ?? null,
      nome: String(c.nome ?? "").trim(),
      cnpj: (c.cnpj as string) ?? null,
      razao: (c.razao as string) ?? null,
      valor: c.valor as number,
      inicio: (c.inicio as string) ?? null,
      datadesl: (c.datadesl as string) ?? null,
    }));

    const lote = montarLote(
      pessoas, competencia, deParaDe,
      (envio.data?.previsao_ajustada as string) ?? null,
    );

    /* Fornecedor, passada 1: o cache. */
    const doCache = new Map<string, number>();
    for (const c of (clientesCache.data?.dados ?? []) as Record<string, unknown>[]) {
      const k = soDigitos(c?.cnpj_cpf);
      if (k && !doCache.has(k)) doCache.set(k, Number(c.codigo));
    }

    /* Passada 2: quem o cache não achou vai direto ao Omie, por CNPJ. */
    const faltantes = [...new Set(
      lote.itens.map((i) => i.cnpj).filter((c) => c.length === 14 && !doCache.has(c)),
    )];
    const consultados = faltantes.slice(0, MAX_CONSULTAS_DIRETAS);
    const naoConferidos = faltantes.length - consultados.length;

    const direto = new Map<string, number | null>();
    for (const cnpj of consultados) {
      try {
        direto.set(cnpj, await fornecedorPorCnpj(cnpj));
      } catch {
        // Falha de rede não é "não existe": deixa indefinido e a linha avisa.
        direto.set(cnpj, null);
      }
    }

    const linhas = lote.itens.map((i) => ({
      ...i,
      codigoFornecedor: doCache.get(i.cnpj) ?? direto.get(i.cnpj) ?? null,
      fornecedorConferidoNoOmie: doCache.has(i.cnpj) || direto.has(i.cnpj),
      codigoCategoria: i.categoria ? codCategoria(i.categoria) : null,
      codigoDepartamento: i.departamento ? codDepartamento.get(i.departamento) ?? null : null,
      ajusteMotivo: (porCodigo.get(i.codigo)?.ajuste_motivo as string) ?? null,
      ajustadoEm: (porCodigo.get(i.codigo)?.ajustado_em as string) ?? null,
    }));

    const paraChecar = linhas.map((l) => ({
      cnpj: l.cnpj, codigoFornecedor: l.codigoFornecedor, codigoCategoria: l.codigoCategoria,
    }));

    return json({
      status: "ok",
      competencia,
      registro: lote.registro,
      vencimento: lote.vencimento,
      previsao: lote.previsao,
      previsaoRegra: lote.previsaoRegra,
      previsaoExcepcional: lote.previsaoExcepcional,
      linhas,
      fora: lote.fora,
      total: lote.total,
      pendencia: pendenciasDoLote(paraChecar),
      recusa: recusaDaFolha({
        competencia,
        estado: ((envio.data?.estado as EstadoDaFolha) ?? null),
        itens: paraChecar,
      }),
      cache: {
        clientes_em: clientesCache.data?.atualizado_em ?? null,
        cadastros_em: cadastrosCache.data?.atualizado_em ?? null,
        consultas_diretas: consultados.length,
        nao_conferidos: naoConferidos,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
