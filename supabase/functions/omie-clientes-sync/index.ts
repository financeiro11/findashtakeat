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
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/* ------------------------- o endereço, para o pré-voo ----------------------- */
/**
 * A LEITURA COMPLETA — a que responde "este cadastro emite?" antes de emitir.
 *
 * `ListarClientesResumido` (acima) devolve três campos e é o que a fila de
 * emissão precisa. Só que a NFS-e é recusada por ENDEREÇO — o Omie exige o
 * Número, a prefeitura confere CEP × município — e nada disso vem no resumido.
 * Sem esta leitura, o único jeito de descobrir que um cadastro não emite é
 * tentando emitir e lendo a recusa do lote. Medido em amostra de 24 clientes
 * ativos: 12,5% sem número do endereço.
 *
 * DUAS DIFERENÇAS EM RELAÇÃO AO RESUMIDO, e as duas são por causa do tamanho:
 *
 *   • `ListarClientes` completo aceita no máximo **50 por página** (o resumido
 *     aceita 500), então são ~141 páginas para 7 mil clientes;
 *   • uma Edge Function tem 150s. Por isso a varredura é RETOMÁVEL: guarda a
 *     página em `omie_clientes_endereco_cursor`, faz um teto por invocação e
 *     volta de onde parou. Recomeçar do zero a cada chamada nunca terminaria.
 *
 * O ritmo é do Omie e só dele: nenhuma chamada ao Asaas acontece aqui.
 */
interface ClienteEndereco {
  codigo: number; cnpj_cpf: string | null; nome: string | null;
  endereco: string | null; endereco_numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; estado: string | null;
  cep: string | null; email: string | null; lido_em: string;
}

async function varrerEnderecos(
  supabase: any, opts: { paginas: number; reiniciar: boolean },
): Promise<Record<string, unknown>> {
  const { data: cursor } = await supabase
    .from("omie_clientes_endereco_cursor")
    .select("pagina, total_paginas, concluido_em").eq("id", 1).maybeSingle();

  /* Volta recente, nada a fazer. O cron tem várias janelas (141 páginas não
   * cabem numa invocação de 150s) e a última delas costuma pegar a varredura já
   * terminada: sem esta guarda ela recomeçaria do zero, varrendo o cadastro
   * inteiro duas ou três vezes por semana contra o limite do Omie. */
  const horasDaVolta = cursor?.concluido_em
    ? (Date.now() - new Date(cursor.concluido_em).getTime()) / 3.6e6
    : Infinity;
  if (!opts.reiniciar && Number(cursor?.pagina ?? 1) <= 1 && horasDaVolta < 20) {
    return {
      paginas_lidas: 0, gravados: 0, terminou: true,
      pulada: `a volta completa terminou há ${horasDaVolta.toFixed(1)}h; nada a reler.`,
    };
  }

  let pagina = opts.reiniciar ? 1 : Math.max(1, Number(cursor?.pagina ?? 1));
  let totalPaginas = Number(cursor?.total_paginas ?? 0) || 0;
  let lidas = 0, gravados = 0;
  const limpo = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s ? s : null;
  };

  for (let i = 0; i < Math.max(1, opts.paginas); i++) {
    const r = await omieCall("geral/clientes", "ListarClientes", {
      pagina,
      registros_por_pagina: 50,
      apenas_importado_api: "N",
    });
    totalPaginas = Number(r?.total_de_paginas ?? totalPaginas ?? 1);
    const lote = r?.clientes_cadastro ?? r?.clientes_cadastro_resumido ?? [];

    const linhas: ClienteEndereco[] = [];
    for (const c of lote) {
      const codigo = Number(c?.codigo_cliente_omie ?? c?.codigo_cliente ?? 0);
      if (!codigo) continue;
      linhas.push({
        codigo,
        cnpj_cpf: limpo(String(c?.cnpj_cpf ?? "").replace(/\D/g, "")),
        nome: limpo(c?.nome_fantasia) ?? limpo(c?.razao_social),
        endereco: limpo(c?.endereco),
        endereco_numero: limpo(c?.endereco_numero),
        complemento: limpo(c?.complemento),
        bairro: limpo(c?.bairro),
        cidade: limpo(c?.cidade),
        estado: limpo(c?.estado),
        cep: limpo(String(c?.cep ?? "").replace(/\D/g, "")),
        email: limpo(c?.email),
        lido_em: new Date().toISOString(),
      });
    }
    if (linhas.length) {
      const { error } = await supabase
        .from("omie_clientes_endereco").upsert(linhas, { onConflict: "codigo" });
      if (error) throw new Error(`omie_clientes_endereco upsert: ${error.message}`);
      gravados += linhas.length;
    }
    lidas++;
    pagina++;
    if (pagina > totalPaginas) break;
    /* O Omie tranca por MÉTODO. Duas `ListarClientes` coladas viram "consumo
     * redundante" e queimam as retentativas do backoff sem necessidade. */
    await dorme(700);
  }

  const terminou = totalPaginas > 0 && pagina > totalPaginas;
  await supabase.from("omie_clientes_endereco_cursor").upsert({
    id: 1,
    // Terminou: volta para 1, para a próxima varredura recomeçar o ciclo.
    pagina: terminou ? 1 : pagina,
    total_paginas: totalPaginas,
    atualizado_em: new Date().toISOString(),
    ...(terminou ? { concluido_em: new Date().toISOString() } : {}),
  }, { onConflict: "id" });

  return {
    paginas_lidas: lidas, gravados,
    proxima_pagina: terminou ? 1 : pagina,
    total_paginas: totalPaginas,
    terminou,
  };
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

    /* A varredura de endereço, retomável. Separada da sync normal porque é 141
     * páginas contra 15, e porque ninguém precisa dela para emitir — ela serve
     * para saber em quem mexer ANTES de emitir. Só Omie: nada de Asaas aqui. */
    /* Diagnóstico: o registro CRU de uma página da listagem. Existe porque
     * adivinhar o nome do campo do Omie é como se descobre, uma semana depois,
     * que o espelho inteiro está gravando `null` num campo que existe. */
    if (body?.action === "listar_bruto") {
      const r = await omieCall("geral/clientes", "ListarClientes", {
        pagina: Number(body?.pagina ?? 1),
        registros_por_pagina: Number(body?.n ?? 1),
        apenas_importado_api: "N",
        ...(body?.codigo ? { clientesFiltro: { codigo_cliente_omie: Number(body.codigo) } } : {}),
      });
      const lote = r?.clientes_cadastro ?? r?.clientes_cadastro_resumido ?? [];
      const preenchido = (v: unknown) => String(v ?? "").trim() !== "";
      const primeiro = lote[0] ?? null;
      return json({
        status: "ok",
        registros: lote.length,
        // A contagem é o que responde "o Omie devolve isto nesta página?" — um
        // registro só não diz nada, porque pode ser um cadastro genuinamente vazio.
        com_endereco: lote.filter((c: any) => preenchido(c?.endereco)).length,
        com_numero: lote.filter((c: any) => preenchido(c?.endereco_numero)).length,
        com_email: lote.filter((c: any) => preenchido(c?.email)).length,
        com_cep: lote.filter((c: any) => preenchido(c?.cep)).length,
        chaves: primeiro ? Object.keys(primeiro) : [],
        registro: body?.cru === true ? primeiro : undefined,
      });
    }

    if (body?.action === "enderecos") {
      const r = await varrerEnderecos(supabase, {
        paginas: Math.max(1, Math.min(Number(body?.paginas ?? 40), 120)),
        reiniciar: body?.reiniciar === true,
      });
      return json({ status: "ok", ...r });
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
