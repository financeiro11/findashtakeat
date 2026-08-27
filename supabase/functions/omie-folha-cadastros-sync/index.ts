// Edge Function: omie-folha-cadastros-sync
//
// Popula `omie_cache` (chave "folha_cadastros") com os três cadastros que o
// provisionamento da folha precisa e que hoje não existem em lugar nenhum do
// Hub: contas correntes, departamentos e categorias do Omie.
//
// POR QUE ISTO EXISTE: a planilha de importação da folha casa tudo por NOME
// ("Sicoob - Conta Corrente", "Tecnologia", "3.1.1.4. Pessoal - Tecnologia"),
// porque o importador do Omie resolve o nome por conta própria. A API não faz
// isso — ela quer `id_conta_corrente` numérico, `cCodDep` e `codigo_categoria`.
// Sem este sync, esses três valores seriam constantes digitadas à mão, e um
// dígito errado põe cem títulos na conta ou na categoria errada.
//
// É SÓ LEITURA do Omie e escreve UMA linha de cache. Não cria, não altera e
// não apaga nada no ERP.
//
// Segue o molde de `omie-clientes-sync`: mesmo envelope RPC, mesmo backoff,
// mesma autenticação (usuário logado ou token de cron), mesma tabela de cache.
// O envelope está reproduzido aqui em vez de importar `_shared/omie.ts` pelo
// mesmo motivo que lá: aquele módulo carrega anexo/zip/MD5 que isto não usa.
//
// Ações (body.action):
//   "sync" (default) → repuxa do Omie e grava no cache.
//   "status"         → só informa o que já está em cache, sem chamar o Omie.
//   "chaves_pix_pendentes" → reconfere SÓ quem está com problema. É o que roda
//                      ao abrir a tela: uma varredura inteira são ~101 chamadas
//                      ao Omie e foi o que trancou a API por consumo em
//                      27/08/2026. Quem já está certo não precisa ser
//                      perguntado de novo; quem está pendente é um punhado.
//   "chaves_pix"     → busca a chave PIX cadastrada em cada fornecedor da folha
//                      e grava em `folha_chaves_pix`. Serve para comparar com o
//                      que o espelho do RH diz: o cadastro do Omie é o que o
//                      banco usa, e o espelho é o que alguém digitou.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { chaveDoTitulo } from "../_shared/folha-envio.ts";
import { ehEstagiario } from "../_shared/documento.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://app.omie.com.br/api/v1";
const CHAVE_CACHE = "folha_cadastros";
const CHAVE_PIX_CACHE = "folha_chaves_pix";

/**
 * Teto da reconferência ao abrir a tela.
 *
 * Ela roda a cada visita, então precisa ser barata. Se a lista de pendentes
 * crescer para além disto, o certo é rodar a varredura completa uma vez, não
 * transformar a abertura da tela em cem chamadas ao Omie.
 */
const MAX_RECONFERIDOS = 25;

/** Envelope RPC do Omie, com o mesmo backoff de `omie-clientes-sync`. */
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

    // O Omie devolve erro de negócio com HTTP 500 + { faultstring }.
    const fault = data && typeof data === "object" ? data.faultstring : null;
    if (res.ok && !fault) return data;

    const msg = fault || (typeof data === "string" ? data : JSON.stringify(data));
    ultimo = new Error(`Omie ${call} [${res.status}]: ${msg}`);
    const transitorio = /425|redundante|processando|5020|too many|bloqueada|soap-error|broken response|timeout|50[234]/i.test(String(msg));
    if (transitorio && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 1200 * 2 ** tentativa));
      continue;
    }
    throw ultimo;
  }
  throw ultimo;
}

/* ------------------------------------------------------------------
 * Os três cadastros
 * ------------------------------------------------------------------ */

type ContaCorrente = { id: number; descricao: string; codigo: string | null; banco: string | null };
type Departamento = { codigo: string; descricao: string; inativo: boolean };
type Categoria = { codigo: string; descricao: string; conta_inativa: boolean };

/**
 * Contas correntes. É daqui que sai o `id_conta_corrente` de
 * "Sicoob - Conta Corrente", a conta que paga a folha.
 */
async function listarContasCorrentes(): Promise<ContaCorrente[]> {
  const out: ContaCorrente[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const r = await omieCall("geral/contacorrente", "ListarContasCorrentes", {
      pagina,
      registros_por_pagina: 100,
      apenas_importado_api: "N",
    });
    for (const c of r?.ListarContasCorrentes ?? r?.conta_corrente_cadastro ?? []) {
      const id = Number(c?.nCodCC ?? 0);
      if (!id) continue;
      out.push({
        id,
        descricao: String(c?.descricao ?? "").trim(),
        codigo: String(c?.codigo ?? "").trim() || null,
        banco: String(c?.codigo_banco ?? "").trim() || null,
      });
    }
    totalPaginas = Number(r?.nTotPaginas ?? r?.total_de_paginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas);
  return out;
}

/** Departamentos. Daqui sai o `cCodDep` de cada departamento da folha. */
async function listarDepartamentos(): Promise<Departamento[]> {
  const out: Departamento[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const r = await omieCall("geral/departamentos", "ListarDepartamentos", {
      pagina,
      registros_por_pagina: 100,
    });
    for (const d of r?.departamentos ?? []) {
      const codigo = String(d?.codigo ?? "").trim();
      if (!codigo) continue;
      out.push({
        codigo,
        descricao: String(d?.descricao ?? "").trim(),
        inativo: String(d?.inativo ?? "N").toUpperCase() === "S",
      });
    }
    totalPaginas = Number(r?.total_de_paginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas);
  return out;
}

/**
 * Categorias. Serve para CONFERIR os códigos que hoje são deduzidos da
 * descrição na planilha ("3.1.1.2. Pessoal - Comercial" → "3.1.1.2") — a
 * dedução some assim que esta lista existir.
 */
async function listarCategorias(): Promise<Categoria[]> {
  const out: Categoria[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const r = await omieCall("geral/categorias", "ListarCategorias", {
      pagina,
      registros_por_pagina: 500,
    });
    for (const c of r?.categoria_cadastro ?? []) {
      const codigo = String(c?.codigo ?? "").trim();
      if (!codigo) continue;
      out.push({
        codigo,
        descricao: String(c?.descricao ?? "").trim(),
        conta_inativa: String(c?.conta_inativa ?? "N").toUpperCase() === "S",
      });
    }
    totalPaginas = Number(r?.total_de_paginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas);
  return out;
}

/**
 * A chave PIX de um fornecedor, pelo documento.
 *
 * `ListarClientesResumido` (que o cache de clientes usa) nao devolve
 * `dadosBancarios` — por isso a busca e uma por documento, e por isso o
 * resultado e cacheado em vez de refeito a cada tela.
 */
async function chavePixPorDocumento(doc: string): Promise<{ codigo: number; chave: string; nome: string } | null> {
  const r = await omieCall("geral/clientes", "ListarClientes", {
    pagina: 1,
    registros_por_pagina: 20,
    apenas_importado_api: "N",
    clientesFiltro: { cnpj_cpf: doc },
  });
  const achados = r?.clientes_cadastro ?? [];
  if (!achados.length) return null;
  // Prefere o cadastro que TEM chave; sem nenhum, devolve o primeiro com chave
  // vazia — "existe e esta sem chave" e uma resposta diferente de "nao existe".
  const comChave = achados.find((c: any) => String(c?.dadosBancarios?.cChavePix ?? "").trim());
  const c = comChave ?? achados[0];
  return {
    codigo: Number(c?.codigo_cliente_omie ?? 0),
    chave: String(c?.dadosBancarios?.cChavePix ?? "").trim(),
    nome: String(c?.razao_social ?? c?.nome_fantasia ?? "").trim(),
  };
}

// Chamada agendada (cron): mesmo esquema de `omie-clientes-sync`.
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "omie-folha-cadastros-sync").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (!(await chamadaDeCron(req, supabase))) {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    const body = await req.json().catch(() => ({}));

    if (body?.action === "status") {
      const { data } = await supabase
        .from("omie_cache").select("registros, atualizado_em, dados").eq("chave", CHAVE_CACHE).maybeSingle();
      const d = (data?.dados ?? {}) as Record<string, unknown[]>;
      return json({
        status: "ok",
        atualizado_em: data?.atualizado_em ?? null,
        contas_correntes: d.contas_correntes?.length ?? 0,
        departamentos: d.departamentos?.length ?? 0,
        categorias: d.categorias?.length ?? 0,
      });
    }

    /* Leitura do que já foi buscado. Existe porque `omie_cache` tem RLS sem
       policy nenhuma: nem o usuário logado lê a tabela direto do navegador,
       só o service_role daqui de dentro. */
    if (body?.action === "chaves_pix_status") {
      const { data } = await supabase
        .from("omie_cache").select("dados, registros, atualizado_em")
        .eq("chave", CHAVE_PIX_CACHE).maybeSingle();
      return json({
        status: "ok",
        atualizado_em: data?.atualizado_em ?? null,
        pessoas: (data?.dados ?? []) as unknown[],
      });
    }

    /* ---------- reconferir só quem está pendente ---------- */
    if (body?.action === "chaves_pix_pendentes") {
      const { data: cacheAtual } = await supabase
        .from("omie_cache").select("dados, atualizado_em").eq("chave", CHAVE_PIX_CACHE).maybeSingle();
      const atual = ((cacheAtual?.dados ?? []) as Record<string, unknown>[]);
      if (!atual.length) return json({ status: "ok", acao: "chaves_pix_pendentes", reconferidos: 0 });

      /* Pendente = o que faria o título não sair, pela MESMA regra do envio.
       *
       * A primeira versão perguntava só "tem chave?", e com isso o Jonas nunca
       * era reconferido: a chave dele existe, só é aleatória — que a empresa
       * não paga. Um atalho aqui vira gente presa para sempre na lista de
       * pendências, porque a correção no Omie nunca é relida. */
      const { data: cargos } = await (supabase as any)
        .from("rh_colaboradores").select("codigo, cargo");
      const cargoDe = new Map<string, string>(
        ((cargos ?? []) as Record<string, unknown>[])
          .map((c) => [String(c.codigo ?? ""), String(c.cargo ?? "")]),
      );
      const pendente = (c: Record<string, unknown>) => {
        if (c.erro) return true;
        return !!chaveDoTitulo({
          documento: String(c.doc ?? ""),
          cadastro: { chave: String(c.chaveOmie ?? ""), existe: !!c.existe },
          estagiario: ehEstagiario(cargoDe.get(String(c.codigo ?? "")) ?? ""),
        }).bloqueio;
      };

      const alvos = atual.filter(pendente).slice(0, MAX_RECONFERIDOS);
      const porCodigo = new Map(alvos.map((a) => [String(a.codigo), a]));

      for (const a of alvos) {
        try {
          const f = await chavePixPorDocumento(String(a.doc ?? ""));
          porCodigo.set(String(a.codigo), {
            ...a, existe: !!f, codigoOmie: f?.codigo ?? null, chaveOmie: f?.chave ?? "",
            erro: null, em: new Date().toISOString(),
          });
        } catch (e) {
          porCodigo.set(String(a.codigo), {
            ...a, erro: e instanceof Error ? e.message : String(e), em: new Date().toISOString(),
          });
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      const novo = atual.map((c) => porCodigo.get(String(c.codigo)) ?? c);
      // Resolvido = deixou de ser pendente pela mesma regra, não "ganhou chave".
      const resolvidos = alvos.filter((a) => {
        const d = porCodigo.get(String(a.codigo));
        return d && !pendente(d);
      }).length;

      /* `atualizado_em` da LINHA fica como está: ela marca a última varredura
         COMPLETA, e é nisso que o envio se apoia. Mexer aqui faria uma
         reconferência de cinco pessoas passar por varredura de cem. */
      await supabase.from("omie_cache")
        .update({ dados: novo })
        .eq("chave", CHAVE_PIX_CACHE);

      return json({
        status: "ok",
        acao: "chaves_pix_pendentes",
        reconferidos: alvos.length,
        resolvidos,
        ainda_pendentes: novo.filter(pendente).length,
      });
    }

    /* ---------- chaves PIX dos fornecedores da folha ---------- */
    if (body?.action === "chaves_pix") {
      const { data: pessoas } = await (supabase as any)
        .from("rh_colaboradores")
        .select("codigo, nome, cnpj, pix, datadesl");
      const { data: depara } = await (supabase as any)
        .from("folha_depara")
        .select("codigo_rh, documento_ajustado");
      const ajuste = new Map<string, string>(
        (depara ?? []).map((d: any) => [String(d.codigo_rh), String(d.documento_ajustado ?? "")]),
      );

      const alvo = (pessoas ?? [])
        .filter((p: any) => !String(p.datadesl ?? "").trim())
        .map((p: any) => ({
          codigo: String(p.codigo ?? ""),
          nome: String(p.nome ?? "").trim(),
          pixRh: String(p.pix ?? "").trim(),
          doc: (ajuste.get(String(p.codigo ?? "")) || "").replace(/[^0-9]/g, "")
            || String(p.cnpj ?? "").replace(/[^0-9]/g, ""),
        }))
        .filter((p: any) => p.doc.length === 11 || p.doc.length === 14);

      const out: Record<string, unknown>[] = [];
      for (const p of alvo) {
        try {
          const f = await chavePixPorDocumento(p.doc);
          /* Carimbo POR PESSOA, e não só na linha do cache.
             A reconferência parcial atualiza umas poucas entradas; se ela
             mexesse no `atualizado_em` da linha, o envio leria "varredura de
             agora" e confiaria em cem registros dos quais só cinco foram
             relidos. O `em` de cada um é o que diz a verdade. */
          out.push({
            ...p, existe: !!f, codigoOmie: f?.codigo ?? null, chaveOmie: f?.chave ?? "",
            em: new Date().toISOString(),
          });
        } catch (e) {
          out.push({ ...p, erro: e instanceof Error ? e.message : String(e) });
        }
        // Respiro: o Omie derruba rajada com "too many requests".
        await new Promise((r) => setTimeout(r, 120));
      }

      const atualizado_em = new Date().toISOString();
      await supabase.from("omie_cache").upsert(
        { chave: CHAVE_PIX_CACHE, dados: out, registros: out.length, atualizado_em },
        { onConflict: "chave" },
      );
      return json({ status: "ok", acao: "chaves_pix", pessoas: out.length, atualizado_em });
    }

    /* Em série, não em paralelo: o Omie derruba rajada com "too many
       requests", e são três chamadas leves — não vale a corrida. */
    const contas_correntes = await listarContasCorrentes();
    const departamentos = await listarDepartamentos();
    const categorias = await listarCategorias();

    const dados = { contas_correntes, departamentos, categorias };
    const registros = contas_correntes.length + departamentos.length + categorias.length;
    const atualizado_em = new Date().toISOString();

    const { error } = await supabase.from("omie_cache").upsert(
      { chave: CHAVE_CACHE, dados, registros, atualizado_em },
      { onConflict: "chave" },
    );
    if (error) throw new Error(`Falha ao gravar o cache: ${error.message}`);

    return json({
      status: "ok",
      atualizado_em,
      contas_correntes: contas_correntes.length,
      departamentos: departamentos.length,
      categorias: categorias.length,
      // A amostra existe para conferir o formato na primeira execução, quando
      // ainda não se sabe como o Omie desta empresa nomeia as coisas.
      amostra: {
        contas_correntes: contas_correntes.slice(0, 5),
        departamentos: departamentos.slice(0, 5),
        categorias: categorias.filter((c) => /pessoal|diretor/i.test(c.descricao)).slice(0, 12),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
