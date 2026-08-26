// Edge Function: folha-omie-enviar
//
// Cria os títulos da folha no Omie, em lote. É o único caminho de escrita da
// folha, e por isso está na lista de autorizados de `src/lib/cartao/envio.test.ts`.
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
// pequeno antes dos cem: sem ele, vai a competência inteira.
//
// O REGISTRO em `folha_envios_omie` só é gravado quando a competência vai
// INTEIRA. Um teste de duas pessoas não pode marcar o mês como enviado — no
// dia seguinte ninguém provisionaria os outros cem, e o erro apareceria como
// "já foi enviado", que é a mensagem mais tranquilizadora possível para o pior
// desfecho.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import {
  CONTA_CORRENTE_FOLHA, fatiarEmLotes, montarLote, montarLoteParaOmie,
  recusaDaFolha, resolvedorDeCategoria, soDigitos,
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

async function omieCall(call: string, param: Record<string, unknown>): Promise<any> {
  const app_key = Deno.env.get("OMIE_APP_KEY");
  const app_secret = Deno.env.get("OMIE_APP_SECRET");
  if (!app_key || !app_secret) throw new Error("Credenciais do Omie ausentes nos secrets.");

  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const res = await fetch(`${BASE}/financas/contapagar/`, {
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
      await new Promise((r) => setTimeout(r, 1200 * 2 ** tentativa));
      continue;
    }
    throw new Error(`Omie ${call}: ${msg}`);
  }
  throw new Error(`Omie ${call}: sem resposta`);
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
        .select("id, codigo, nome, cnpj, razao, valor, inicio, datadesl, pix"),
      supabase.from("folha_depara")
        .select("codigo_rh, departamento, categoria_descricao, valor_referencia, valor_ajustado"),
      supabase.from("omie_cache").select("dados").eq("chave", "folha_cadastros").maybeSingle(),
      supabase.from("omie_cache").select("dados").eq("chave", "clientes").maybeSingle(),
      supabase.from("folha_envios_omie").select("estado").eq("competencia", `${competencia}-01`).maybeSingle(),
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

    const lote = montarLote(pessoas, competencia, deParaDe);

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
    for (const i of itens) {
      const fornecedor = fornecedorPorCnpj.get(i.cnpj) ?? 0;
      const categoria = i.categoria ? codCategoria(i.categoria) : null;
      const departamento = i.departamento ? codDepartamento.get(i.departamento) ?? null : null;
      const falta = !fornecedor ? "fornecedor no Omie"
        : !categoria ? "categoria"
          : !departamento ? "departamento" : null;
      if (falta) { semPreparo.push({ nome: i.nome, falta }); continue; }
      titulos.push({
        integracao: i.integracao,
        codigoFornecedor: fornecedor,
        idContaCorrente,
        codigoCategoria: categoria!,
        codigoDepartamento: departamento!,
        valor: i.valor,
        registro: lote.registro,
        vencimento: lote.vencimento,
        previsao: lote.previsao,
        nome: i.nome,
        chavePix: pixPorCodigo.get(i.codigo) ?? null,
        cnpj: i.cnpj,
        razao: i.razao,
      });
    }

    const lotes = fatiarEmLotes(titulos).map((t, n) => montarLoteParaOmie(t, n + 1));

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
        // O payload inteiro do primeiro lote: é ele que se confere campo a
        // campo contra a planilha de importação antes de qualquer envio.
        payload: lotes[0] ?? null,
        lotes: lotes.length,
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

    const respostas: unknown[] = [];
    for (const l of lotes) respostas.push(await omieCall("IncluirContaPagarPorLote", l));

    /* Só a competência INTEIRA marca o mês como enviado. Ver o cabeçalho. */
    if (!parcial) {
      await supabase.from("folha_envios_omie").upsert({
        competencia: `${competencia}-01`,
        estado: "enviado",
        titulos: titulos.length,
        valor_total: titulos.reduce((s, t) => s + t.valor, 0),
        enviado_em: new Date().toISOString(),
        enviado_por: quem.userId,
        resposta: respostas,
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
      titulos: titulos.length,
      integracoes: titulos.map((t) => t.integracao),
      respostas,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
