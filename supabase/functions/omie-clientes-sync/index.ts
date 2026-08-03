// Edge Function: omie-clientes-sync
//
// Popula `omie_cache` (chave "clientes") com o cadastro de clientes/fornecedores
// do Omie: código → nome. Existe por um motivo só — o movimento financeiro traz
// `nCodCliente` e o CNPJ, nunca o nome. Sem isto, a auditoria de lançamentos da
// DRE/DFC (função `demonstracoes_lancamentos`) mostra "55.834.810/0001-35" onde
// deveria mostrar quem é, e ninguém audita categorização lendo documento.
//
// Chaveia por `nCodCliente`, não por CNPJ: 4.311 dos 8.924 movimentos não têm
// documento preenchido, mas quase todos têm o código do cadastro.
//
// POR QUE NÃO IMPORTA `_shared/omie.ts`: aquele módulo tem 354 linhas, e a maior
// parte é anexo/zip/MD5 que esta função não usa. Trazê-lo junto obrigaria a
// republicar o cliente Omie inteiro a cada deploy desta função. Aqui basta um
// endpoint, então o envelope da API (POST com call/app_key/app_secret/param)
// está reproduzido abaixo em ~15 linhas. Se as credenciais ou o formato do
// envelope mudarem, `_shared/omie.ts` é a referência a seguir.
//
// É função separada, e não mais uma etapa do omie-sync, de propósito: o
// omie-sync é o job diário, pesado e sensível; cadastro de cliente muda pouco e
// não tem por que carregar risco para lá. Rodar isto nunca mexe em demonstração
// nenhuma — só escreve uma linha do cache.
//
// Ações (body.action):
//   "sync" (default) → repuxa do Omie e grava no cache.
//   "status"         → só informa o que já está em cache, sem chamar o Omie.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://app.omie.com.br/api/v1";

/** Envelope RPC do Omie, com o mesmo backoff de `_shared/omie.ts` para o rate limit. */
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

interface ClienteCache { codigo: string; nome: string; cnpj_cpf?: string }

/**
 * Cadastro resumido, paginado. Guarda só três campos: o cadastro completo traz
 * endereço, contatos e dados fiscais, e iria inteiro para dentro do cache.
 */
async function listarClientes(): Promise<ClienteCache[]> {
  const out: ClienteCache[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const r = await omieCall("geral/clientes", "ListarClientesResumido", {
      pagina,
      registros_por_pagina: 500,
      apenas_importado_api: "N",
    });
    // ListarClientesResumido devolve `clientes_cadastro_resumido`; a versão
    // completa usa `clientes_cadastro`. Aceita os dois.
    const lote = r?.clientes_cadastro_resumido ?? r?.clientes_cadastro ?? [];
    for (const c of lote) {
      const codigo = String(c?.codigo_cliente ?? c?.codigo_cliente_omie ?? "");
      if (!codigo || codigo === "0") continue;
      const nome = String(c?.nome_fantasia ?? "").trim() || String(c?.razao_social ?? "").trim();
      if (!nome) continue;
      out.push({ codigo, nome, cnpj_cpf: String(c?.cnpj_cpf ?? "").trim() || undefined });
    }
    totalPaginas = Number(r?.total_de_paginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas);
  return out;
}

// Chamada agendada (cron): o header `x-cron-token` casa com a linha da tabela
// `internal_cron_tokens` (só service_role lê), o que permite disparar sem expor
// a service key nem afrouxar o requireUser para a anon key.
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "omie-clientes-sync").eq("token", token).maybeSingle();
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
        .from("omie_cache").select("registros, atualizado_em").eq("chave", "clientes").maybeSingle();
      return json({ status: "ok", em_cache: data?.registros ?? 0, atualizado_em: data?.atualizado_em ?? null });
    }

    const clientes = await listarClientes();
    const atualizado_em = new Date().toISOString();
    const { error } = await supabase.from("omie_cache").upsert(
      { chave: "clientes", dados: clientes, registros: clientes.length, atualizado_em },
      { onConflict: "chave" },
    );
    if (error) throw new Error(`Falha ao gravar o cache: ${error.message}`);

    return json({ status: "ok", clientes: clientes.length, atualizado_em, amostra: clientes.slice(0, 3) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // requireUser lança com mensagem própria; devolve 401 para o cliente saber
    // que é autenticação e não falha do Omie.
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
