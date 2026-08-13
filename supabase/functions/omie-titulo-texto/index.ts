// Edge Function: omie-titulo-texto
//
// Lê no Omie o TEXTO de títulos (observação, documento, NF, favorecido) e guarda
// em `omie_titulo_texto`. É o que faz o gasto de cartão deixar de ser "Lancamento
// Fatura Cartao" no drill-down da DRE/DFC: o nome do lojista está na observação.
//
// ----------------------------------------------------------------------------
// COMO A OBSERVAÇÃO VEM DO OMIE (medido contra a API real em 12/08/2026)
//
//  • `ListarContasPagar` com **exibir_obs: "S"** DEVOLVE `observacao` — as 4.808
//    contas a pagar da empresa em 49 páginas, 68 segundos. Sem a tag, o mesmo
//    endpoint devolve o cadastro SEM observação (foi o que a medição de 05/08
//    concluiu: "ListarContasPagar não devolve observacao" — devolve, com a tag
//    ligada). É por isso que a VARREDURA é o caminho normal daqui. O texto que
//    ela traz é idêntico ao de `ConsultarContaPagar`: conferido nos 575 títulos
//    que já tinham sido lidos um a um, campo por campo, sem uma diferença.
//  • `ConsultarContaPagar` devolve, mas é UMA CHAMADA POR TÍTULO: ~460 ms cada.
//  • Paralelizar não adianta: 4 em voo levaram 18,9 s e 3 das 4 foram recusadas
//    ("Já existe uma requisição desse método sendo executada") mesmo com o
//    backoff. Título a título é, e continua sendo, SEQUENCIAL.
//  • `PesquisarLancamentos` não aceita tag de observação (recusa a estrutura).
//
// O QUE ISSO MUDA: a tela não espera mais 146 consultas de meio segundo (era o
// caso de uma célula de julho: 236 gastos de cartão, 90 em cache). Uma varredura
// resolve a conta inteira em segundos, e o painel abre lendo só o cache.
// ----------------------------------------------------------------------------
//
// Body:
//   { modo: "varredura" }               → sweep completo (cron; é o padrão)
//   { cod_titulos: (number|string)[] }  → pedido da tela: cache, varredura se
//                                         faltar muita coisa, e o resto título a
//                                         título dentro do orçamento
//   { modo: "fila", limite? }           → só a fila (RPC `omie_titulos_sem_texto`),
//                                         título a título — para o que a
//                                         varredura não alcança
//   comuns: max?, orcamento_ms?, forcar?
//
// Resposta: { ok, lidos, via_varredura, ja_tinha, restantes, fila_restante, ms, erros }
//   `restantes` é o que sobrou DO PEDIDO — é com ele que o cliente decide se
//   chama de novo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { omieCall, ehRespostaQuebrada } from "../_shared/omie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const limpo = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** Uma linha de `omie_titulo_texto` a partir do cadastro do título. */
const linhaDe = (cod: number, c: Record<string, unknown> | null) => ({
  cod_titulo: cod,
  observacao: limpo(c?.observacao),
  documento: limpo(c?.numero_documento),
  nota_fiscal: limpo(c?.numero_documento_fiscal),
  favorecido: limpo((c?.cnab_integracao_bancaria as Record<string, unknown>)?.nome_transferencia),
  lido_em: new Date().toISOString(),
});

/* Grava em lotes, não só no fim: a execução pode ser cortada no meio (orçamento,
   gateway) e o que já custou chamada ao Omie não pode se perder — ou a próxima
   pagaria tudo de novo. É também o que faz a tela ver a lista se preencher
   enquanto a busca continua. */
const LOTE_GRAVACAO = 200;

/* A partir de quantos títulos faltando compensa varrer a conta inteira em vez de
   perguntar um a um. A varredura completa custa ~68 s (49 páginas); cada título
   custa ~460 ms. O ponto de virada é por volta de 150 — abaixo disso perguntar
   direto chega antes, acima dela a varredura ainda deixa o resto da empresa
   pronto de brinde. */
const LIMIAR_VARREDURA = 120;

/** Chamada do cron (mesmo padrão das demais funções): token na tabela interna. */
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "omie-titulo-texto").eq("token", token).maybeSingle();
  return !!data;
}

type Gravador = (linhas: Record<string, unknown>[]) => Promise<void>;

type Varrido = { paginas: number; registros: number; completa: boolean; tamanho: number };

/**
 * VARREDURA: todas as contas a pagar do Omie, com observação, em páginas.
 *
 * DE TRÁS PARA A FRENTE, de propósito. A listagem vem do título mais antigo para
 * o mais novo (conferido: a ordem de gravação acompanha o código do título), e o
 * que falta é sempre o RECENTE — título criado depois da última varredura. Se o
 * orçamento acabar no meio, parar tendo lido as páginas velhas seria não ter
 * lido nada de útil. Começando pelo fim, uma varredura cortada ainda entrega
 * exatamente a parte que a tela está pedindo.
 *
 * Refaz com página menor no "SOAP-ERROR: Broken response" — é o servidor do Omie
 * engasgando ao montar respostas grandes, e a observação engorda a resposta.
 * Refazer do zero (em vez de calcular de onde parou) é seguro porque a gravação é
 * upsert por código de título: repetir página não duplica nada.
 */
async function varredura(gravar: Gravador, prazo: number): Promise<Varrido> {
  const tamanhos = [500, 200, 50];

  const pagina = async (n: number, tamanho: number) =>
    await omieCall<Record<string, unknown>>("financas/contapagar", "ListarContasPagar", {
      pagina: n,
      registros_por_pagina: tamanho,
      apenas_importado_api: "N",
      exibir_obs: "S",
    });

  const gravarPagina = async (r: Record<string, unknown>): Promise<number> => {
    const lista = (r?.conta_pagar_cadastro ?? []) as Record<string, unknown>[];
    const linhas = lista
      .map((c) => ({ cod: Number(c?.codigo_lancamento_omie ?? 0), c }))
      .filter(({ cod }) => cod > 0)
      .map(({ cod, c }) => linhaDe(cod, c));
    if (linhas.length) await gravar(linhas);
    return linhas.length;
  };

  const passada = async (tamanho: number): Promise<Varrido> => {
    // A primeira chamada é só para saber quantas páginas existem — e já vale,
    // porque a página 1 também precisa ser lida.
    const primeira = await pagina(1, tamanho);
    const total = Math.max(1, Number(primeira?.total_de_paginas ?? 1));

    let registros = 0;
    let paginas = 0;
    for (let n = total; n >= 2; n--) {
      if (Date.now() > prazo) return { paginas, registros, completa: false, tamanho };
      registros += await gravarPagina(await pagina(n, tamanho));
      paginas++;
    }
    registros += await gravarPagina(primeira);
    paginas++;
    return { paginas, registros, completa: true, tamanho };
  };

  let ultimo: unknown = null;
  for (const tamanho of tamanhos) {
    try {
      return await passada(tamanho);
    } catch (e) {
      if (!ehRespostaQuebrada(e)) throw e;   // erro de verdade: insistir não resolve
      ultimo = e;
      console.warn(`omie-titulo-texto: resposta quebrada com ${tamanho} por página. Refazendo a varredura com página menor.`);
    }
  }
  throw ultimo;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const inicio = Date.now();

  try {
    if (!(await chamadaDeCron(req, supabase))) {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const teto = Math.min(Math.max(Number(body?.max ?? 100), 1), 2000);
    const prazo = inicio + Math.min(Math.max(Number(body?.orcamento_ms ?? 25_000), 1_000), 240_000);
    const forcar = body?.forcar === true;
    const pedidoDaTela = Array.isArray(body?.cod_titulos) && body.cod_titulos.length > 0;
    const modo: "varredura" | "fila" | "lista" =
      pedidoDaTela ? "lista" : body?.modo === "fila" ? "fila" : "varredura";

    const erros: string[] = [];
    let pendentes: Record<string, unknown>[] = [];
    let gravados = 0;
    let lidos = 0;

    const gravarAgora = async (linhas: Record<string, unknown>[]) => {
      if (!linhas.length) return;
      const { error } = await supabase.from("omie_titulo_texto").upsert(linhas, { onConflict: "cod_titulo" });
      if (error) throw error;
      gravados += linhas.length;
    };
    const enfileirar = async (linha: Record<string, unknown>) => {
      pendentes.push(linha);
      if (pendentes.length >= LOTE_GRAVACAO) { await gravarAgora(pendentes); pendentes = []; }
    };
    const descarregar = async () => { await gravarAgora(pendentes); pendentes = []; };

    /* ----- 1. varredura ------------------------------------------------- */
    let varrido: Awaited<ReturnType<typeof varredura>> | null = null;

    /* ----- 2. o que ainda falta, título a título ------------------------- */
    let cods: number[] = [];
    let filaRestante: number | null = null;

    const lerFila = async (limite: number) => {
      const { data, error } = await supabase.rpc("omie_titulos_sem_texto", {
        p_limite: Math.min(Math.max(limite, teto) + 1000, 5000),
        p_so_cartao: body?.so_cartao === false ? false : true,
      });
      if (error) throw error;
      const fila = (data ?? []).map((r: { cod_titulo: number }) => Number(r.cod_titulo));
      filaRestante = fila.length;
      return fila.slice(0, Math.min(limite, teto)) as number[];
    };

    if (modo === "varredura") {
      varrido = await varredura(gravarAgora, prazo);
      // O que a varredura não alcança (título que a listagem não devolve) cai na
      // fila e é perguntado um a um com o que sobrou do orçamento.
      cods = await lerFila(teto);
    } else if (modo === "fila") {
      cods = await lerFila(Number(body?.limite ?? teto));
    } else {
      const pedidos = body.cod_titulos as unknown[];
      const pedidosLimpos = [...new Set(
        pedidos.map((c) => Number(c)).filter((n) => Number.isFinite(n) && n > 0),
      )];

      // O que já foi lido antes não é relido — inclusive o que voltou vazio.
      let jaTem = new Set<number>();
      if (!forcar) {
        const { data, error } = await supabase
          .from("omie_titulo_texto").select("cod_titulo").in("cod_titulo", pedidosLimpos);
        if (error) throw error;
        jaTem = new Set((data ?? []).map((r: { cod_titulo: number }) => Number(r.cod_titulo)));
      }
      let faltando = pedidosLimpos.filter((c) => !jaTem.has(c));

      // Muita coisa faltando? Uma varredura (~10 chamadas) chega antes do que
      // dezenas de consultas de meio segundo — e ainda deixa o resto da conta
      // pronto para as próximas células.
      if (faltando.length >= LIMIAR_VARREDURA && body?.sem_varredura !== true) {
        varrido = await varredura(gravarAgora, prazo);
        const { data } = await supabase
          .from("omie_titulo_texto").select("cod_titulo").in("cod_titulo", faltando);
        const agora = new Set((data ?? []).map((r: { cod_titulo: number }) => Number(r.cod_titulo)));
        faltando = faltando.filter((c) => !agora.has(c));
      }
      cods = faltando.slice(0, teto);
    }

    for (const cod of cods) {
      if (Date.now() > prazo) break;   // o resto fica para a próxima chamada
      try {
        const c = await omieCall<Record<string, unknown>>(
          "financas/contapagar", "ConsultarContaPagar", { codigo_lancamento_omie: cod },
        );
        await enfileirar(linhaDe(cod, c));
        lidos++;
      } catch (e) {
        // Título que não é conta a pagar (recebimento, transferência) responde
        // erro — registrar mesmo assim, com texto vazio, evita perguntar de novo
        // a cada abertura do painel.
        const msg = e instanceof Error ? e.message : String(e);
        if (/n[ãa]o encontrad|inexistente|invalid|não existe/i.test(msg)) {
          await enfileirar(linhaDe(cod, null));
        } else if (erros.length < 5) {
          erros.push(`${cod}: ${msg.slice(0, 120)}`);
        }
      }
    }
    await descarregar();

    /* Quantos do PEDIDO ainda não têm texto — é o que diz ao cliente se vale
       chamar de novo. Conferido no banco, não deduzido: a varredura pode ter
       resolvido títulos que nem entraram na conta de "faltando". */
    let restantes = 0;
    if (modo === "lista") {
      const pedidos = [...new Set((body.cod_titulos as unknown[])
        .map((c) => Number(c)).filter((n) => Number.isFinite(n) && n > 0))];
      const { data } = await supabase
        .from("omie_titulo_texto").select("cod_titulo").in("cod_titulo", pedidos);
      restantes = pedidos.length - (data?.length ?? 0);
    } else {
      restantes = Math.max(0, (filaRestante ?? 0) - lidos);
    }

    return json({
      ok: true,
      modo,
      lidos,
      via_varredura: varrido ? varrido.registros : 0,
      varredura: varrido,
      restantes,
      fila_restante: filaRestante,
      gravados,
      ms: Date.now() - inicio,
      erros,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-titulo-texto error:", msg);
    return json({ error: msg }, 200);
  }
});
