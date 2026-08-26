// Edge Function: omie-colaboradores-cadastrar
//
// Cadastra colaboradores como FORNECEDOR no Omie — o passo que falta antes de
// existir título de folha: `IncluirContaPagar` exige um
// `codigo_cliente_fornecedor`, e ele só existe se a PJ estiver no ERP.
//
// A decisão (criar / gravar PIX / não mexer / bloquear) mora inteira em
// `_shared/colaborador-omie.ts`, que é puro e tem teste. Aqui fica só a
// conversa com o Omie.
//
// DOIS MODOS, mesmo caminho de código:
//   { simular: true }   → consulta o Omie e devolve o que FARIA. Nada é criado.
//   { simular: false }  → executa.
// A prévia da tela chama o primeiro; o botão chama o segundo. Não são dois
// códigos que podem divergir: é o mesmo, com a escrita desligada.
//
// Body:
//   { codigos: ["COL-020757", ...], simular?: boolean }
//   `codigos` são os `codigo` do espelho `rh_colaboradores`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import {
  cnpjsRepetidos, decidirCadastro, montarAlterarPix, montarIncluirCliente, soDigitos,
  type ClienteDoOmie, type ColaboradorParaOmie, type DecisaoDeCadastro,
} from "../_shared/colaborador-omie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://app.omie.com.br/api/v1";

/** Teto de gente por chamada. Cem cadastros de uma vez é lote de folha inteira. */
const MAX_POR_CHAMADA = 60;

async function omieCall(path: string, call: string, param: Record<string, unknown>): Promise<any> {
  const app_key = Deno.env.get("OMIE_APP_KEY");
  const app_secret = Deno.env.get("OMIE_APP_SECRET");
  if (!app_key || !app_secret) {
    throw new Error("Credenciais do Omie ausentes. Configure OMIE_APP_KEY e OMIE_APP_SECRET nos secrets.");
  }
  let ultimo: unknown = null;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
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

    const msg = String(fault || (typeof data === "string" ? data : JSON.stringify(data)));

    // "não encontrado" no ListarClientes é resposta legítima: ninguém cadastrado.
    if (/n.o (existem|foram encontrados|encontrado)|nenhum registro/i.test(msg)) return null;

    ultimo = new Error(`Omie ${call} [${res.status}]: ${msg}`);
    const transitorio = /425|redundante|processando|5020|too many|bloqueada|soap-error|broken response|timeout|50[234]/i.test(msg);
    if (transitorio && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 1200 * 2 ** tentativa));
      continue;
    }
    throw ultimo;
  }
  throw ultimo;
}

/** O que o Omie tem para este CNPJ. Lista vazia = ninguém. */
async function cadastrosDoCnpj(cnpj: string): Promise<ClienteDoOmie[]> {
  const r = await omieCall("geral/clientes", "ListarClientes", {
    pagina: 1,
    registros_por_pagina: 50,
    apenas_importado_api: "N",
    clientesFiltro: { cnpj_cpf: cnpj },
  });
  return (r?.clientes_cadastro ?? []) as ClienteDoOmie[];
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

    const simular = body?.simular !== false; // padrão SIMULA: escrever é escolha explícita
    const codigos: string[] = Array.isArray(body?.codigos)
      ? [...new Set(body.codigos.map((c: unknown) => String(c ?? "").trim()).filter(Boolean))]
      : [];

    if (!codigos.length) return json({ status: "erro", erro: "Nenhum colaborador informado." }, 400);
    if (codigos.length > MAX_POR_CHAMADA) {
      return json({ status: "erro", erro: `No máximo ${MAX_POR_CHAMADA} por vez (vieram ${codigos.length}).` }, 400);
    }

    // Os dados vêm do espelho, nunca do corpo do request: o cliente diz QUEM
    // cadastrar, não O QUE cadastrar. Assim ninguém consegue criar fornecedor
    // com CNPJ inventado mandando um payload à mão.
    const { data: linhas, error } = await (supabase as any)
      .from("rh_colaboradores")
      .select("codigo, nome, cnpj, razao, pix")
      .in("codigo", codigos);
    if (error) throw new Error(`Falha ao ler o espelho do RH: ${error.message}`);

    const pessoas: ColaboradorParaOmie[] = (linhas ?? []).map((l: any) => ({
      codigo: String(l.codigo ?? ""),
      nome: String(l.nome ?? "").trim(),
      cnpj: l.cnpj ?? null,
      razao: l.razao ?? null,
      pix: l.pix ?? null,
    }));

    const achados = new Set(pessoas.map((p) => p.codigo));
    const sumidos = codigos.filter((c) => !achados.has(c));

    // CNPJ repetido derruba o LOTE, não a pessoa: criar fornecedor para quatro
    // que dividem um documento junta os quatro salários num prestador só.
    const repetidos = cnpjsRepetidos(pessoas);
    if (repetidos.length) {
      return json({
        status: "erro",
        erro: `CNPJ em mais de um colaborador: ${repetidos.join(", ")}. `
          + "Os cadastros iriam para o mesmo fornecedor. Corrija o RH antes.",
      }, 409);
    }

    const resultados: (DecisaoDeCadastro & { feito?: boolean; erro?: string })[] = [];

    for (const p of pessoas) {
      const cnpj = soDigitos(p.cnpj);
      let decisao: DecisaoDeCadastro;
      try {
        // Sem CNPJ válido nem chega a consultar o Omie.
        decisao = cnpj.length === 14
          ? decidirCadastro(p, await cadastrosDoCnpj(cnpj))
          : decidirCadastro(p, []);
      } catch (e) {
        resultados.push({
          codigo: p.codigo, nome: p.nome, acao: "bloqueado",
          erro: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      if (simular || decisao.acao === "ja_ok" || decisao.acao === "bloqueado") {
        resultados.push(decisao);
        continue;
      }

      try {
        if (decisao.acao === "criar") {
          const r = await omieCall("geral/clientes", "IncluirCliente", montarIncluirCliente(p));
          resultados.push({
            ...decisao,
            feito: true,
            codigoClienteOmie: Number(r?.codigo_cliente_omie ?? 0) || undefined,
          });
        } else {
          await omieCall(
            "geral/clientes",
            "AlterarCliente",
            montarAlterarPix(decisao.codigoClienteOmie!, decisao.chavePix!),
          );
          resultados.push({ ...decisao, feito: true });
        }
      } catch (e) {
        // Uma falha não derruba as outras: quem passou, passou, e o relatório
        // diz exatamente quem ficou para trás.
        resultados.push({ ...decisao, feito: false, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    const conta = (a: string) => resultados.filter((r) => r.acao === a).length;
    const resumo = {
      criar: conta("criar"),
      alterar_pix: conta("alterar_pix"),
      ja_ok: conta("ja_ok"),
      bloqueado: conta("bloqueado"),
      feitos: resultados.filter((r) => r.feito).length,
      com_erro: resultados.filter((r) => r.erro).length,
    };

    if (!simular && resumo.feitos > 0) {
      // O cache de clientes ficou velho no instante em que criamos alguém.
      // Marcar isso é mais honesto que reescrever 7.000 linhas aqui.
      await supabase.from("omie_cache")
        .update({ atualizado_em: new Date(0).toISOString() })
        .eq("chave", "clientes");
    }

    return json({
      status: "ok",
      simulado: simular,
      por: quem.email ?? quem.userId,
      resumo,
      nao_encontrados: sumidos,
      resultados,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
