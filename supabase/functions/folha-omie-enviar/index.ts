// Edge Function: folha-omie-enviar
//
// Cria os títulos da folha no Omie, UM A UM. É o único caminho de escrita da
// folha, e por isso está na lista de autorizados de `src/lib/cartao/envio.test.ts`.
//
// Um a um, e não em lote, porque o `IncluirContaPagarPorLote` recusa
// `departamentos` — testado com dois títulos reais em 26/08/2026. O detalhe
// está no topo de `_shared/folha-envio.ts`.
//
// TRÊS AÇÕES (body.acao):
//
//   "simular"  devolve o payload EXATO que iria ao Omie, sem criar nada. Não
//              depende de `ENVIO_FOLHA_LIBERADO`: simular não escreve, e ver o
//              payload antes é justamente como se descobre que ele está errado.
//   "enviar"   cria de verdade. Exige a chave ligada e passa por `recusaDaFolha`.
//   "excluir"  apaga títulos criados por aqui, pelo `codigo_lancamento_integracao`.
//              Existe porque o primeiro envio real é um teste de 1 ou 2 títulos,
//              e teste sem desfazer não é teste — é aposta.
//
// `codigos` restringe a um subconjunto de pessoas. É o que permite o teste
// pequeno antes dos cem — e também deixa a tela mandar em pedaços, para uma
// folha de cem não depender de uma única requisição sobreviver inteira.
//
// O REGISTRO em `folha_envios_omie` só é gravado quando a competência vai
// INTEIRA. Um teste de duas pessoas não pode marcar o mês como enviado — no
// dia seguinte ninguém provisionaria os outros cem, e o erro apareceria como
// "já foi enviado", que é a mensagem mais tranquilizadora possível para o pior
// desfecho.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import {
  CONTA_CORRENTE_FOLHA, chavePermitida, montarLote, montarTituloFolha,
  recusaDaFolha, resolvedorDeCategoria, soDigitos, tipoDeChavePix,
  type ColaboradorDaFolha, type EstadoDaFolha, type ResolveDePara, type TituloDaFolha,
} from "../_shared/folha-envio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://app.omie.com.br/api/v1";

async function omieCall(
  call: string,
  param: Record<string, unknown>,
  path = "financas/contapagar",
): Promise<any> {
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
    const transitorio = /425|redundante|processando|5020|too many|bloqueada|timeout|50[234]/i.test(msg);
    if (transitorio && tentativa < 3) {
      /* O Omie DIZ quanto esperar: "Aguarde 53 segundos para tentar novamente".
         O backoff exponencial ia a 4,8s e desistia — e um título caía por um
         problema que era só de ritmo. Quando ele informa o tempo, obedecer é o
         que faz a tentativa valer; teto de 60s para a função não estourar. */
      const pedido = msg.match(/aguarde\s+(\d+)\s*segundo/i);
      const espera = pedido
        ? Math.min(60_000, (Number(pedido[1]) + 1) * 1000)
        : 1200 * 2 ** tentativa;
      await new Promise((r) => setTimeout(r, espera));
      continue;
    }
    throw new Error(`Omie ${call}: ${msg}`);
  }
  throw new Error(`Omie ${call}: sem resposta`);
}

/**
 * A chave PIX que o FORNECEDOR tem cadastrada no Omie.
 *
 * É a chave que o ERP usaria se pudesse buscá-la sozinho — e ele não pode: com
 * `finalidade_transferencia` "01.3" ele EXIGE `pix_qrcode` no título. Então o
 * Hub busca e manda.
 *
 * Vale mais que a do espelho do RH: o cadastro do fornecedor é conferido quando
 * a pessoa é criada, e o espelho é digitado a cada admissão. Em 26/08/2026 o
 * espelho tinha CPF com cara de telefone, CNPJ truncado e CNPJ com dígito
 * trocado — dez títulos recusados por causa disso.
 */
async function chavePixDoFornecedor(cnpj: string): Promise<string | null> {
  const r = await omieCall("ListarClientes", {
    pagina: 1,
    registros_por_pagina: 20,
    apenas_importado_api: "N",
    clientesFiltro: { cnpj_cpf: cnpj },
  }, "geral/clientes");
  for (const c of r?.clientes_cadastro ?? []) {
    const chave = String(c?.dadosBancarios?.cChavePix ?? "").trim();
    if (chave) return chave;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const quem = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = await req.json().catch(() => ({}));
    const acao = String(body?.acao ?? "simular");
    const competencia = String(body?.competencia ?? "").slice(0, 7);

    /* ---------- excluir ---------- */
    if (acao === "excluir") {
      const chaves: string[] = Array.isArray(body?.integracoes)
        ? body.integracoes.map((c: unknown) => String(c ?? "").trim()).filter(Boolean)
        : [];
      if (!chaves.length) return json({ status: "erro", erro: "Nada para excluir." }, 400);
      if (chaves.some((c) => !c.startsWith("FOLHA-"))) {
        // Só apaga o que este caminho criou. Sem isto, um id digitado errado
        // apagaria um título de fornecedor que nada tem a ver com a folha.
        return json({ status: "erro", erro: "Só é possível excluir títulos com chave FOLHA-." }, 400);
      }
      const out: Record<string, unknown>[] = [];
      for (const codigo_lancamento_integracao of chaves) {
        try {
          await omieCall("ExcluirContaPagar", { codigo_lancamento_integracao });
          out.push({ integracao: codigo_lancamento_integracao, excluido: true });
        } catch (e) {
          out.push({
            integracao: codigo_lancamento_integracao,
            excluido: false,
            erro: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return json({ status: "ok", acao, resultados: out });
    }

    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      return json({ status: "erro", erro: "Competência inválida." }, 400);
    }

    /* ---------- montar o lote ---------- */
    const [rh, dep, cadastros, clientes, envio] = await Promise.all([
      supabase.from("rh_colaboradores")
        .select("id, codigo, nome, cnpj, razao, valor, inicio, datadesl, pix, cargo"),
      supabase.from("folha_depara")
        .select("codigo_rh, departamento, categoria_descricao, valor_referencia, valor_ajustado, documento_ajustado"),
      supabase.from("omie_cache").select("dados").eq("chave", "folha_cadastros").maybeSingle(),
      supabase.from("omie_cache").select("dados").eq("chave", "clientes").maybeSingle(),
      supabase.from("folha_envios_omie").select("estado, previsao_ajustada").eq("competencia", `${competencia}-01`).maybeSingle(),
    ]);
    if (rh.error) throw new Error(`Espelho do RH: ${rh.error.message}`);

    const cat = (cadastros.data?.dados ?? {}) as {
      categorias?: { codigo: string; descricao: string; conta_inativa?: boolean }[];
      departamentos?: { codigo: string; descricao: string }[];
      contas_correntes?: { id: number; descricao: string }[];
    };

    const idContaCorrente = (cat.contas_correntes ?? [])
      .find((c) => c.descricao?.trim() === CONTA_CORRENTE_FOLHA)?.id ?? 0;
    if (!idContaCorrente) {
      return json({
        status: "erro",
        erro: `Conta corrente "${CONTA_CORRENTE_FOLHA}" não achada no cadastro do Omie. `
          + "Rode omie-folha-cadastros-sync.",
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
        documentoAjustado: (d.documento_ajustado as string) ?? null,
      };
    };

    const linhasRh = (rh.data ?? []) as Record<string, unknown>[];
    const pessoas: ColaboradorDaFolha[] = linhasRh.map((c) => ({
      id: String(c.id),
      codigo: (c.codigo as string) ?? null,
      nome: String(c.nome ?? "").trim(),
      cnpj: (c.cnpj as string) ?? null,
      razao: (c.razao as string) ?? null,
      valor: c.valor as number,
      inicio: (c.inicio as string) ?? null,
      datadesl: (c.datadesl as string) ?? null,
    }));
    const pixPorCodigo = new Map(linhasRh.map((c) => [String(c.codigo), (c.pix as string) ?? null]));
    const cargoPorCodigo = new Map(
      linhasRh.map((c) => [String(c.codigo), (c.cargo as string) ?? null]),
    );
    const estagioPorCodigo = new Map(
      linhasRh.map((c) => [String(c.codigo), /estagi/i.test(String(c.cargo ?? ""))]),
    );

    const lote = montarLote(
      pessoas, competencia, deParaDe,
      (envio.data?.previsao_ajustada as string) ?? null,
    );

    /* Subconjunto explícito, para o teste pequeno antes dos cem. */
    const so: string[] = Array.isArray(body?.codigos)
      ? body.codigos.map((c: unknown) => String(c ?? "").trim().toUpperCase()).filter(Boolean)
      : [];
    const parcial = so.length > 0;
    const itens = parcial ? lote.itens.filter((i) => so.includes(i.codigo)) : lote.itens;

    if (!itens.length) return json({ status: "erro", erro: "Nenhum título a enviar." }, 400);

    const fornecedorPorCnpj = new Map<string, number>();
    for (const c of (clientes.data?.dados ?? []) as Record<string, unknown>[]) {
      const k = soDigitos(c?.cnpj_cpf);
      if (k && !fornecedorPorCnpj.has(k)) fornecedorPorCnpj.set(k, Number(c.codigo));
    }

    const titulos: TituloDaFolha[] = [];
    const semPreparo: { nome: string; falta: string }[] = [];

    /* A chave de cada um, resolvida ANTES do envio.
     *
     * Ordem: a do espelho do RH quando é válida (foi assim que noventa títulos
     * passaram), senão a do cadastro do fornecedor no Omie, senão o próprio
     * documento. Só se nada disso valer é que a pessoa fica de fora — e aí com
     * o motivo escrito, em vez de virar uma recusa do ERP que ninguém liga a
     * ninguém. */
    const chaveCache = new Map<string, string | null>();
    const chaveParaPagar = async (
      doc: string, pixRh: string | null, estagiario: boolean,
    ): Promise<string | null> => {
      const vale = (c: string) => !!c && chavePermitida(tipoDeChavePix(c), estagiario);

      // Estagiário recebe no CPF, que é o documento dele.
      if (estagiario && doc.length === 11) return doc;

      const doRh = String(pixRh ?? "").trim();
      if (vale(doRh)) return doRh;

      if (!chaveCache.has(doc)) {
        try { chaveCache.set(doc, await chavePixDoFornecedor(doc)); }
        catch { chaveCache.set(doc, null); }
      }
      const doFornecedor = chaveCache.get(doc) ?? "";
      if (vale(doFornecedor)) return doFornecedor;

      // Último recurso: o próprio documento, se ele valer como chave.
      return vale(doc) ? doc : null;
    };

    for (const i of itens) {
      const fornecedor = fornecedorPorCnpj.get(i.cnpj) ?? 0;
      const categoria = i.categoria ? codCategoria(i.categoria) : null;
      const departamento = i.departamento ? codDepartamento.get(i.departamento) ?? null : null;
      /* Departamento NÃO entra na conta de "pronto": ele não vai no payload,
         então exigi-lo aqui barraria um envio por um campo que nem é enviado.
         Continua resolvido e devolvido, para a prévia e para o dia em que o
         Omie aceitar o campo. */
      const estagiario = estagioPorCodigo.get(i.codigo) ?? false;
      const chave = await chaveParaPagar(i.cnpj, pixPorCodigo.get(i.codigo) ?? null, estagiario);
      const falta = !fornecedor ? "fornecedor no Omie"
        : !categoria ? "categoria"
          : !chave ? "chave PIX válida (nem no RH nem no cadastro do fornecedor)" : null;
      if (falta) { semPreparo.push({ nome: i.nome, falta }); continue; }
      titulos.push({
        integracao: i.integracao,
        codigoFornecedor: fornecedor,
        idContaCorrente,
        codigoCategoria: categoria!,
        codigoDepartamento: departamento ?? "",
        valor: i.valor,
        registro: lote.registro,
        vencimento: lote.vencimento,
        previsao: lote.previsao,
        nome: i.nome,
        chavePix: chave,
        estagiario,
        cnpj: i.cnpj,
        razao: i.razao,
      });
    }


    /* ---------- simular ---------- */
    if (acao !== "enviar") {
      return json({
        status: "ok",
        acao: "simular",
        competencia,
        parcial,
        titulos: titulos.length,
        sem_preparo: semPreparo,
        contaCorrente: { nome: CONTA_CORRENTE_FOLHA, id: idContaCorrente },
        // O payload do primeiro título: é ele que se confere campo a campo
        // contra a planilha de importação antes de qualquer envio.
        payload: titulos[0] ? montarTituloFolha(titulos[0]) : null,
      });
    }

    /* ---------- enviar ---------- */
    const recusa = recusaDaFolha({
      competencia,
      estado: ((envio.data?.estado as EstadoDaFolha) ?? null),
      itens: itens.map((i) => ({
        cnpj: i.cnpj,
        codigoFornecedor: fornecedorPorCnpj.get(i.cnpj) ?? null,
        codigoCategoria: i.categoria ? codCategoria(i.categoria) : null,
      })),
    });
    if (recusa) return json({ status: "erro", erro: recusa }, 409);
    if (semPreparo.length) {
      return json({
        status: "erro",
        erro: `${semPreparo.length} título(s) sem preparo: ` + semPreparo.map((s) => `${s.nome} (${s.falta})`).join(", "),
      }, 409);
    }

    /* UM A UM, e não em lote.
     *
     * O `IncluirContaPagarPorLote` recusa `departamentos` — testado em
     * 26/08/2026, ver o comentário no topo de `_shared/folha-envio.ts`. Aqui a
     * chamada é `IncluirContaPagar`, a mesma que o fluxo n8n de parceiro usa.
     *
     * Uma falha NÃO derruba as outras: quem passou, passou, e o relatório diz
     * exatamente quem ficou. Reenviar depois é seguro porque o
     * `codigo_lancamento_integracao` faz o Omie recusar o duplicado — e essa
     * recusa é lida como "já criado", não como erro. */
    const resultados: { integracao: string; nome: string; criado: boolean; erro?: string }[] = [];
    for (const t of titulos) {
      try {
        await omieCall("IncluirContaPagar", montarTituloFolha(t));
        resultados.push({ integracao: t.integracao, nome: t.nome, criado: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Duplicado é sucesso: o título já existe com esta chave.
        const jaExiste = /duplicad|j.\s*existe|j.\s*cadastrad|integra..o.*utilizad/i.test(msg);
        // Falha de título vai para o log TAMBÉM, e não só para a resposta: sem
        // isto, um envio em que todos falham aparece como sucesso silencioso e
        // o motivo morre junto com a aba do navegador.
        if (!jaExiste) console.error(`folha-omie-enviar [${t.integracao}]:`, msg);
        resultados.push({
          integracao: t.integracao, nome: t.nome,
          criado: jaExiste, erro: jaExiste ? undefined : msg,
        });
      }
      // Respiro entre chamadas: o Omie derruba rajada com "too many requests".
      await new Promise((r) => setTimeout(r, 150));
    }

    const criados = resultados.filter((r) => r.criado);
    const falharam = resultados.filter((r) => !r.criado);

    /* Só a competência INTEIRA marca o mês como enviado, e só se TUDO passou.
       Marcar com falhas dentro faria os que ficaram nunca serem reenviados. */
    if (!parcial && falharam.length === 0) {
      await supabase.from("folha_envios_omie").upsert({
        competencia: `${competencia}-01`,
        estado: "enviado",
        titulos: titulos.length,
        valor_total: titulos.reduce((s, t) => s + t.valor, 0),
        enviado_em: new Date().toISOString(),
        enviado_por: quem.userId,
        resposta: resultados,
      }, { onConflict: "competencia" });

      /* A referência de cada pessoa passa a ser o que ACABOU de ser pago, para
         o mês que vem comparar contra a realidade e não contra julho. */
      for (const i of itens) {
        await supabase.from("folha_depara")
          .update({ valor_referencia: i.valorBase, valor_referencia_competencia: `${competencia}-01` })
          .eq("codigo_rh", i.codigo);
      }
    }

    return json({
      status: "ok",
      acao: "enviar",
      competencia,
      parcial,
      titulos: criados.length,
      falharam: falharam.length,
      // Só as chaves criadas: são elas que o botão de desfazer apaga.
      integracoes: criados.map((r) => r.integracao),
      resultados,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    /* Vai para os logs da função além do corpo da resposta. O corpo serve a
       quem clicou; o log serve a quem investiga depois, quando a tela já
       fechou e a única pergunta é "por que aquele envio falhou?". */
    console.error("folha-omie-enviar:", msg);
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
