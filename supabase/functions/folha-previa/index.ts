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
//
// A CHAVE PIX que cada título vai levar é a do CADASTRO do fornecedor, e a
// prévia a lê do cache `folha_chaves_pix` — só para MOSTRAR. Quem manda é o
// envio, que relê do Omie ao vivo. A prévia diz de quando é a foto justamente
// porque as duas podem discordar quando alguém acabou de corrigir no ERP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import {
  chaveDoTitulo, montarLote, pendenciasDoLote, recusaDaFolha, resolvedorDeCategoria, soDigitos,
  type CadastroDoFornecedor, type ColaboradorDaFolha, type EstadoDaFolha, type ResolveDePara,
} from "../_shared/folha-envio.ts";
import { ehEstagiario } from "../_shared/documento.ts";

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

/**
 * Quais títulos desta competência JÁ existem no Omie.
 *
 * A prévia dizia o que o Hub PRETENDE mandar; o que o ERP tem era outra
 * história, e as duas divergiram feio em 27/08/2026 (a função morria no meio e
 * ninguém sabia quantos tinham entrado). Descobrir isso exigia ler log de Edge
 * Function no painel do Supabase.
 *
 * `ListarContasPagar` não filtra por código de integração, mas a folha inteira
 * divide a MESMA data de registro — o último dia da competência —, e é por ela
 * que dá para pescar o lote de uma vez. Com 500 por página, são uma ou duas
 * chamadas para o mês inteiro.
 */
async function jaNoOmie(registro: string): Promise<Map<string, { numeroDocumento: string }>> {
  const [a, m, d] = [registro.slice(0, 4), registro.slice(5, 7), registro.slice(8, 10)];
  const registroBR = `${d}/${m}/${a}`;
  const out = new Map<string, { numeroDocumento: string }>();
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const r = await omieCall("financas/contapagar", "ListarContasPagar", {
      pagina,
      registros_por_pagina: 500,
      apenas_importado_api: "N",
      filtrar_por_registro_de: registroBR,
      filtrar_por_registro_ate: registroBR,
    });
    for (const c of r?.conta_pagar_cadastro ?? []) {
      const k = String(c?.codigo_lancamento_integracao ?? "").trim();
      if (k.startsWith("FOLHA-")) {
        out.set(k, { numeroDocumento: String(c?.numero_documento ?? "").trim() });
      }
    }
    totalPaginas = Number(r?.total_de_paginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas && pagina <= 5);
  return out;
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

    const [rh, dep, cadastrosCache, clientesCache, chavesCache, envio] = await Promise.all([
      supabase.from("rh_colaboradores")
        .select("id, codigo, nome, cnpj, razao, valor, inicio, datadesl, cargo"),
      supabase.from("folha_depara")
        .select("codigo_rh, departamento, categoria_descricao, valor_referencia, valor_ajustado, valor_rh_no_ajuste, ajuste_motivo, ajustado_em, documento_ajustado, documento_motivo"),
      supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "folha_cadastros").maybeSingle(),
      supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "clientes").maybeSingle(),
      supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "folha_chaves_pix").maybeSingle(),
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
        documentoAjustado: (d.documento_ajustado as string) ?? null,
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

    const cargoPorCodigo = new Map(
      ((rh.data ?? []) as Record<string, unknown>[])
        .map((c) => [String(c.codigo), (c.cargo as string) ?? null]),
    );

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

    /* A chave PIX do cadastro do fornecedor, da última varredura. Chaveada por
       código do RH, que é o que a varredura guarda. */
    const chaveNoOmie = new Map<string, CadastroDoFornecedor>();
    for (const c of (chavesCache.data?.dados ?? []) as Record<string, unknown>[]) {
      chaveNoOmie.set(String(c.codigo ?? ""), {
        chave: String(c.chaveOmie ?? ""),
        existe: !!c.existe,
      });
    }

    /* O que o ERP já tem. Falha aqui NÃO derruba a prévia: sem a conferência a
       tela ainda serve, só não sabe dizer quem já entrou. */
    let noOmie = new Map<string, { numeroDocumento: string }>();
    let conferidoNoOmie = true;
    try { noOmie = await jaNoOmie(lote.registro); }
    catch { conferidoNoOmie = false; }

    const linhas = lote.itens.map((i) => {
      const cargo = cargoPorCodigo.get(i.codigo) ?? null;
      /* Quem a varredura não cobre fica `undefined`, e não `{existe:false}`:
         "ainda não conferi" não é "não existe". A linha avisa, e o envio —
         que relê ao vivo — é quem decide. */
      const cadastro = chaveNoOmie.get(i.codigo);
      const daChave = cadastro
        ? chaveDoTitulo({ documento: i.cnpj, cadastro, estagiario: ehEstagiario(cargo ?? "") })
        : null;
      return {
        ...i,
        codigoFornecedor: doCache.get(i.cnpj) ?? direto.get(i.cnpj) ?? null,
        fornecedorConferidoNoOmie: doCache.has(i.cnpj) || direto.has(i.cnpj),
        codigoCategoria: i.categoria ? codCategoria(i.categoria) : null,
        codigoDepartamento: i.departamento ? codDepartamento.get(i.departamento) ?? null : null,
        ajusteMotivo: (porCodigo.get(i.codigo)?.ajuste_motivo as string) ?? null,
        ajustadoEm: (porCodigo.get(i.codigo)?.ajustado_em as string) ?? null,
        cargo,
        /** A chave que o título vai levar — a do cadastro, literal. */
        chavePix: daChave?.chave ?? null,
        chavePixBloqueio: daChave?.bloqueio ?? null,
        chavePixConferida: !!cadastro,
        /** Já existe no Omie? E com o Nº Documento que a busca do ERP usa? */
        noOmie: noOmie.has(i.integracao),
        numeroDocumento: noOmie.get(i.integracao)?.numeroDocumento ?? "",
      };
    });

    const paraChecar = linhas.map((l) => ({
      cnpj: l.cnpj,
      codigoFornecedor: l.codigoFornecedor,
      codigoCategoria: l.codigoCategoria,
      chavePixBloqueio: l.chavePixBloqueio,
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
        chaves_pix_em: chavesCache.data?.atualizado_em ?? null,
        conferido_no_omie: conferidoNoOmie,
        chaves_pix_nao_conferidas: linhas.filter((l) => !l.chavePixConferida).length,
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
