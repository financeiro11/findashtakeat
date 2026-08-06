// Edge Function: omie-contas-pagar-sync
//
// Popula `omie_cache` (chave "contas_pagar") com os títulos a pagar de uma
// JANELA de vencimento — incluindo o TEXTO do cadastro: observação, documento,
// nota fiscal, pedido e o favorecido da transferência.
//
// POR QUE EXISTE: a conferência da agenda do briefing contra o Omie precisa ler
// o que o time ESCREVEU no título. O caso que motivou isto: o pagamento
// "Donos de Hamburgueria (2ª parcela) - R$ 6.000" estava lançado como
// "PLENUS SOLUCOES / Eventos e Feiras" — o nome do fornecedor e a categoria não
// dizem nada, mas a observação do título diz exatamente "Donos de Hamburgueria
// (2 parcela)". Sem esse campo a conferência acusava um pagamento provisionado
// como "sem provisão", que é o pior erro que ela pode cometer.
//
// O QUE A API DO OMIE PERMITE (medido contra a API real em 05/08/2026):
//  • `financas/mf/ListarMovimentos` aceita `dDtVencDe`/`dDtVencAte` — dá a janela
//    inteira em poucas chamadas, com valor, vencimento, categoria e status
//    FRESCOS (o cache "movimentos" é de uma vez ao dia: hoje ele tinha 116 dos
//    118 títulos do dia, faltando os dois lançados depois da passada da manhã).
//  • `financas/contapagar/ListarContasPagar` NÃO devolve `observacao`.
//  • `financas/pesquisartitulos/PesquisarLancamentos` também NÃO devolve.
//  • Só `ConsultarContaPagar` devolve — UMA CHAMADA POR TÍTULO.
// Daí o desenho: a lista vem barata e fresca; o texto é buscado título a título,
// INCREMENTALMENTE (só o que ainda não foi lido), com teto por execução. Título
// já lido não é relido: `t: 1` marca "texto já consultado", inclusive quando a
// observação está vazia — senão todo dia gastaríamos as mesmas chamadas.
//
// Ações (body.action):
//   "sync" (default) → atualiza a janela e enriquece o que falta.
//   "status"         → o que já está em cache, sem chamar o Omie.
// Parâmetros: `de` / `ate` (YYYY-MM-DD ou DD/MM/AAAA), `max_consultas` (teto de
// ConsultarContaPagar por execução, padrão 150) e `orcamento_ms` (tempo máximo
// gasto consultando texto, padrão 60s — o que não deu tempo fica para a próxima).

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

    const fault = data && typeof data === "object" ? data.faultstring : null;
    if (res.ok && !fault) return data;

    const msg = fault || (typeof data === "string" ? data : JSON.stringify(data));
    ultimo = new Error(`Omie ${call} [${res.status}]: ${msg}`);
    const transitorio = /425|redundante|processando|5020|too many|bloqueada|soap-error|broken response|timeout|50[234]|existe uma requisi|tentar novamente/i.test(String(msg));
    if (transitorio && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 1200 * 2 ** tentativa));
      continue;
    }
    throw ultimo;
  }
  throw ultimo;
}

/* ------------------------------- datas ------------------------------- */
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const br = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const maisDias = (dias: number) => new Date(Date.now() + dias * 86_400_000);

/** Aceita YYYY-MM-DD e DD/MM/AAAA; devolve Date ou null. */
function lerData(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}
const isoDeBR = (s: unknown) => { const d = lerData(s); return d ? iso(d) : null; };

/* --------------------------- títulos da janela --------------------------- */

interface Titulo {
  cod: number;
  venc: string | null;          // YYYY-MM-DD
  prev?: string | null;
  valor: number;
  aberto?: number;
  cat?: string;
  cli?: string;                 // código do cliente/fornecedor
  cpf?: string;
  status?: string;
  parc?: string;
  // texto do cadastro (ConsultarContaPagar)
  t?: 1;                        // texto já consultado (mesmo que vazio)
  obs?: string;
  doc?: string;
  nf?: string;
  ped?: string;
  fav?: string;                 // favorecido da transferência (CNAB)
}

/** Movimentos a pagar da janela, direto do Omie (fresco), paginado. */
async function listarJanela(de: Date, ate: Date): Promise<Titulo[]> {
  const out: Titulo[] = [];
  let nPagina = 1;
  let total = 1;
  do {
    const r = await omieCall("financas/mf", "ListarMovimentos", {
      nPagina, nRegPorPagina: 500, dDtVencDe: br(de), dDtVencAte: br(ate),
    });
    for (const m of (r?.movimentos ?? [])) {
      const d = m?.detalhes ?? {};
      if (d?.cGrupo !== "CONTA_A_PAGAR") continue;
      if (d?.nValorTitulo == null) continue;   // perna de conta corrente do mesmo título
      const cod = Number(d?.nCodTitulo ?? 0);
      if (!cod) continue;
      out.push({
        cod,
        venc: isoDeBR(d?.dDtVenc),
        prev: isoDeBR(d?.dDtPrevisao),
        valor: Math.abs(Number(d.nValorTitulo)),
        aberto: Number(m?.resumo?.nValAberto ?? d.nValorTitulo),
        cat: String(d?.cCodCateg ?? "") || undefined,
        cli: String(d?.nCodCliente ?? "") || undefined,
        cpf: String(d?.cCPFCNPJCliente ?? "") || undefined,
        status: String(d?.cStatus ?? "") || undefined,
        parc: String(d?.cNumParcela ?? "") || undefined,
      });
    }
    total = Number(r?.nTotPaginas ?? 1);
    nPagina++;
  } while (nPagina <= total && nPagina <= 100);
  return out;
}

/** Texto do cadastro de um título. Devolve sempre `t: 1` — inclusive vazio. */
async function lerTexto(cod: number): Promise<Partial<Titulo>> {
  const c = await omieCall("financas/contapagar", "ConsultarContaPagar", { codigo_lancamento_omie: cod });
  const limpo = (v: unknown) => String(v ?? "").trim() || undefined;
  return {
    t: 1,
    obs: limpo(c?.observacao),
    doc: limpo(c?.numero_documento),
    nf: limpo(c?.numero_documento_fiscal),
    ped: limpo(c?.numero_pedido),
    fav: limpo(c?.cnab_integracao_bancaria?.nome_transferencia),
  };
}

// A consulta do texto é SEQUENCIAL de propósito: o Omie recusa duas chamadas do
// MESMO método ao mesmo tempo — "Já existe uma requisição desse método sendo
// executada". Medido: com 4 em voo, 89 de 120 consultas voltaram com esse erro.

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "omie-contas-pagar-sync").eq("token", token).maybeSingle();
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

    const { data: linha } = await supabase
      .from("omie_cache").select("dados, registros, atualizado_em").eq("chave", "contas_pagar").maybeSingle();

    if (body?.action === "status") {
      return json({ status: "ok", em_cache: linha?.registros ?? 0, atualizado_em: linha?.atualizado_em ?? null });
    }

    // Janela curta de propósito: o texto importa para o DIA que o briefing
    // confere, e cada título custa uma chamada. O que já foi lido continua no
    // cache (a poda só corta vencimento de mais de 60 dias atrás), então a
    // cobertura caminha junto com os dias.
    const de = lerData(body?.de) ?? maisDias(-1);
    const ate = lerData(body?.ate) ?? maisDias(3);
    const teto = Math.min(Math.max(Number(body?.max_consultas ?? 150), 0), 500);
    const prazo = Date.now() + Number(body?.orcamento_ms ?? 60_000);

    // 1. Janela fresca do Omie.
    const janela = await listarJanela(de, ate);

    // 2. O que já está em cache (texto preservado; títulos velhos podados).
    const anteriores: Titulo[] = Array.isArray(linha?.dados) ? linha!.dados as Titulo[] : [];
    const porCod = new Map<number, Titulo>();
    const limitePoda = iso(maisDias(-60));
    for (const t of anteriores) {
      if (t?.cod && (!t.venc || t.venc >= limitePoda)) porCod.set(t.cod, t);
    }
    for (const t of janela) {
      const antigo = porCod.get(t.cod);
      // valor/vencimento/status vêm sempre da leitura nova; o texto é preservado.
      porCod.set(t.cod, antigo ? { ...t, t: antigo.t, obs: antigo.obs, doc: antigo.doc, nf: antigo.nf, ped: antigo.ped, fav: antigo.fav } : t);
    }

    // 3. Enriquecimento incremental, dos vencimentos mais próximos de hoje para fora.
    const hoje = new Date().getTime();
    const faltando = [...porCod.values()]
      .filter((t) => !t.t)
      .sort((a, z) =>
        Math.abs(new Date(a.venc ?? "2100-01-01").getTime() - hoje) -
        Math.abs(new Date(z.venc ?? "2100-01-01").getTime() - hoje))
      .slice(0, teto);

    const erros: string[] = [];
    let lidos = 0;
    for (const t of faltando) {
      if (Date.now() > prazo) break;   // devolve o que deu tempo; o resto fica na fila
      try {
        Object.assign(t, await lerTexto(t.cod));
        lidos++;
      } catch (e) {
        // Título que recusa consulta não pode travar a passada — fica sem texto e
        // volta na próxima (não recebe `t`, então continua na fila).
        if (erros.length < 5) erros.push(`${t.cod}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      }
    }

    const dados = [...porCod.values()];
    const atualizado_em = new Date().toISOString();
    const { error } = await supabase.from("omie_cache").upsert(
      { chave: "contas_pagar", dados, registros: dados.length, atualizado_em },
      { onConflict: "chave" },
    );
    if (error) throw new Error(`Falha ao gravar o cache: ${error.message}`);

    const comTexto = dados.filter((t) => t.t).length;
    return json({
      status: "ok",
      janela: { de: iso(de), ate: iso(ate) },
      titulos_janela: janela.length,
      em_cache: dados.length,
      texto_lido_agora: lidos,
      na_fila: faltando.length,
      com_texto: comTexto,
      falta_texto: dados.length - comTexto,
      com_observacao: dados.filter((t) => t.obs).length,
      erros: erros.length ? erros : undefined,
      atualizado_em,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /autentic|permiss/i.test(msg) ? 401 : 500;
    return json({ status: "erro", erro: msg }, status);
  }
});
