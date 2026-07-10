// Edge Function: omie-pix-sync
// Puxa do Omie os lançamentos da conta corrente Sicoob (a auditar) já conciliados/
// categorizados pela conciliação diária Sicoob → Omie e grava em auditoria_pix_lancamentos.
//
// IMPORTANTE (descoberto via preview): o Omie NÃO expõe o meio de pagamento em
// financas/mf/ListarMovimentos (cCodModDoc vem vazio). O que existe é a CONTA BANCÁRIA
// (nCodCC). Como o Sicoob é a conta de PIX, filtramos as saídas daquela conta.
//
// Regras de negócio:
//   • só SAÍDAS (natureza "P") da conta corrente do Sicoob (contas a pagar);
//   • NÃO entram transferências de saída (cOrigem "TRAP");
//   • NÃO entram categorias de pessoal / premiação / escala / benefícios;
//   • se o título tem anexo no Omie, o link/nome vêm junto (tem_comprovante).
//
// O passo de anexos é SEPARADO do sync: um ListarAnexo por título estourava o wall-time
// da edge function. O sync grava rápido; a ação "anexos" preenche os comprovantes em lotes.
//
// Ações (body.action):
//   "preview" → diagnóstico (contas nomeadas, distribuições, sonda de anexo). SEM gravar.
//   "sync"    → grava os lançamentos do mês (sem anexos). Params:
//               { referencia?: "YYYY-MM", contasSicoob?: (string|number)[] }
//   "anexos"  → preenche comprovantes de um LOTE de lançamentos ainda não verificados.
//               Params: { referencia?: "YYYY-MM", limite?: number, anexoTabela?: string }
//               Chame repetidamente até `restantes` = 0.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listarCategorias, listarMovimentos, omieCall } from "../_shared/omie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
// Primeiro valor NÃO-zero entre vários campos candidatos (baixas trazem nValorTitulo = 0
// e o valor real fica em outro campo/no resumo). `??` não serve aqui pois 0 é "presente".
function primeiroNum(...vs: unknown[]): number {
  for (const v of vs) { const n = Math.abs(toNum(v)); if (n > 0) return n; }
  return 0;
}
// String limpa: vazia, "0" ou "-" viram null (para não poluir favorecido/descrição).
function limpa(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return !s || s === "0" || s === "-" ? null : s;
}
function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function parseOmieDate(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(String(s));
  return isNaN(d.getTime()) ? null : d;
}
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const CATEGORIAS_EXCLUIDAS = ["PESSOAL", "PREMIA", "ESCALA", "BENEF"];
const categoriaExcluida = (desc: string) => CATEGORIAS_EXCLUIDAS.some((k) => norm(desc).includes(k));
const ORIGENS_TRANSFERENCIA = new Set(["TRAP"]); // transferência de saída — excluída

// Contas correntes do Omie: nCodCC → { nome, banco }.
async function listarContasCorrentes(): Promise<{ map: Map<string, { nome: string; banco: string }>; raw: any }> {
  const map = new Map<string, { nome: string; banco: string }>();
  let raw: any = null;
  let pagina = 1, total = 1;
  do {
    const r = await omieCall<any>("geral/contacorrente", "ListarContasCorrentes", { pagina, registros_por_pagina: 100 });
    if (pagina === 1) raw = r;
    const arr = r?.ListarContasCorrentes ?? r?.conta_corrente_cadastro ?? r?.cadastros ?? r?.contas ?? [];
    for (const c of arr) {
      const id = String(c.nCodCC ?? c.codigo ?? c.nCodConta ?? "");
      if (id) map.set(id, { nome: String(c.descricao ?? c.cDescricao ?? c.nome ?? ""), banco: String(c.codigo_banco ?? c.cCodBanco ?? c.banco ?? "") });
    }
    total = Number(r?.total_de_paginas ?? r?.nTotPaginas ?? 1);
    pagina++;
  } while (pagina <= total);
  return { map, raw };
}

const ANEXO_TABELAS = ["conta-pagar", "contas-a-pagar", "financas-contapagar", "financas-conta-pagar", "titulos-pagar", "financas-movimentos", "movimentos"];
async function probarAnexos(nId: number | string): Promise<any[]> {
  const out: any[] = [];
  for (const cTabela of ANEXO_TABELAS) {
    try {
      const r = await omieCall<any>("geral/anexo", "ListarAnexo", { nId, cTabela, nPagina: 1, nRegPorPagina: 50 });
      const anexos = r?.listaAnexos ?? r?.anexos ?? r?.arquivos ?? [];
      out.push({ cTabela, ok: Array.isArray(anexos), qtd: Array.isArray(anexos) ? anexos.length : 0, amostra: anexos?.[0] ?? null });
    } catch (e) {
      out.push({ cTabela, ok: false, erro: String(e instanceof Error ? e.message : e).slice(0, 260) });
    }
  }
  return out;
}
// Nome do fornecedor (Nome Fantasia > Razão Social) a partir do código do cliente Omie.
async function consultarNomeCliente(cod: string): Promise<string | null> {
  try {
    const r = await omieCall<any>("geral/clientes", "ConsultarCliente", { codigo_cliente_omie: Number(cod) });
    const nome = String(r?.nome_fantasia || r?.razao_social || "").trim();
    return nome || null;
  } catch (_) { return null; }
}
async function anexoDe(nId: number | string, cTabela: string): Promise<{ url: string; nome: string } | null> {
  try {
    const r = await omieCall<any>("geral/anexo", "ListarAnexo", { nId, cTabela, nPagina: 1, nRegPorPagina: 50 });
    const anexos = r?.listaAnexos ?? r?.anexos ?? r?.arquivos ?? [];
    if (Array.isArray(anexos) && anexos.length) {
      const a = anexos[0];
      return { url: String(a.cUrl ?? a.url ?? a.cLinkDownload ?? ""), nome: String(a.cNomeArquivo ?? a.nome ?? a.cArquivo ?? "anexo") };
    }
  } catch (_) { /* melhor-esforço */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";

    /* ============ ENRIQUECER: anexo + nome do fornecedor (lote resumível) ============ */
    if (action === "anexos") {
      const ref: string | null = body?.referencia ? String(body.referencia) : null;
      const limite = Math.min(Number(body?.limite ?? 100), 300);
      const cTabela = String(body?.anexoTabela ?? "conta-pagar");

      let q = supabase.from("auditoria_pix_lancamentos")
        .select("id,id_unico,cod_cliente,favorecido").eq("anexo_verificado", false).limit(limite);
      if (ref) q = q.eq("referencia", ref);
      const { data: pend, error: pendErr } = await q;
      if (pendErr) throw pendErr;

      const CONC = 10;
      let comAnexo = 0, nomesResolvidos = 0;
      const rows = (pend ?? []) as { id: number; id_unico: string; cod_cliente: string | null; favorecido: string | null }[];
      for (let i = 0; i < rows.length; i += CONC) {
        const lote = rows.slice(i, i + CONC);
        await Promise.all(lote.map(async (r) => {
          // Anexo (comprovante) + nome do fornecedor em paralelo.
          const [anexo, nome] = await Promise.all([
            anexoDe(r.id_unico, cTabela),
            (!r.favorecido && r.cod_cliente && r.cod_cliente !== "0")
              ? consultarNomeCliente(r.cod_cliente) : Promise.resolve(null),
          ]);
          if (anexo?.url) comAnexo++;
          const patch: Record<string, unknown> = {
            anexo_verificado: true,
            tem_comprovante: !!anexo?.url,
            comprovante_url: anexo?.url || null,
            anexo_nome: anexo?.nome || null,
            updated_at: new Date().toISOString(),
          };
          if (nome) { patch.favorecido = nome; nomesResolvidos++; }
          await supabase.from("auditoria_pix_lancamentos").update(patch).eq("id", r.id);
        }));
      }

      let cq = supabase.from("auditoria_pix_lancamentos")
        .select("id", { count: "exact", head: true }).eq("anexo_verificado", false);
      if (ref) cq = cq.eq("referencia", ref);
      const { count } = await cq;

      return json({ ok: true, processados: rows.length, com_anexo: comAnexo, nomes_resolvidos: nomesResolvidos, restantes: count ?? 0 });
    }

    // preview e sync precisam de categorias + contas + movimentos.
    const [categorias, contas] = await Promise.all([listarCategorias(), listarContasCorrentes()]);
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");

    const contasSicoobOverride: string[] | null = Array.isArray(body?.contasSicoob) ? body.contasSicoob.map(String) : null;
    // Conta a auditar: SÓ a conta corrente do Sicoob (exclui cartão e aplicação).
    const sicoobIds = new Set<string>(
      contasSicoobOverride ??
      [...contas.map.entries()]
        .filter(([, info]) => norm(info.nome).includes("SICOOB") && norm(info.nome).includes("CONTA CORRENTE"))
        .map(([id]) => id),
    );

    const movimentos = await listarMovimentos({});

    const catPrincipal = (mov: any): { codigo: string; desc: string } => {
      const det = mov?.detalhes ?? {};
      const cats = Array.isArray(mov?.categorias) && mov.categorias.length
        ? mov.categorias : [{ cCodCateg: det.cCodCateg, nValor: det.nValorTitulo }];
      const main = [...cats].sort((a, b) => Math.abs(toNum(b.nValor)) - Math.abs(toNum(a.nValor)))[0];
      const codigo = String(main?.cCodCateg ?? "");
      return { codigo, desc: codToDesc.get(codigo) || codigo };
    };

    /* ================= PREVIEW ================= */
    if (action === "preview") {
      const dist = (get: (det: any) => unknown) => {
        const m = new Map<string, number>();
        for (const mov of movimentos) { const k = String(get((mov as any)?.detalhes) ?? "—"); m.set(k, (m.get(k) ?? 0) + 1); }
        return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40));
      };
      const volPorConta = new Map<string, number>();
      for (const mov of movimentos) { const k = String((mov as any)?.detalhes?.nCodCC ?? "—"); volPorConta.set(k, (volPorConta.get(k) ?? 0) + 1); }
      const contasNomeadas = [...volPorConta.entries()].sort((a, b) => b[1] - a[1]).map(([id, mov]) => ({
        nCodCC: id, movimentos: mov, nome: contas.map.get(id)?.nome ?? "(desconhecido)", banco: contas.map.get(id)?.banco ?? "",
        sicoob_detectado: sicoobIds.has(id),
      }));
      const alvoAnexo = movimentos.map((m) => (m as any)?.detalhes?.nCodTitulo).find(Boolean);
      const anexoProbe = alvoAnexo ? await probarAnexos(alvoAnexo) : [];

      // Amostra dos candidatos REAIS do Sicoob (detalhes + resumo) — p/ confirmar os nomes
      // dos campos de valor e de fornecedor caso ainda venham errados.
      const amostraSicoob = movimentos
        .filter((m) => { const d = (m as any)?.detalhes ?? {}; return norm(d.cNatureza) === "P" && sicoobIds.has(String(d.nCodCC)); })
        .slice(0, 3)
        .map((m) => ({ detalhes: (m as any)?.detalhes ?? {}, resumo: (m as any)?.resumo ?? null, categorias: (m as any)?.categorias ?? null }));

      return json({
        ok: true, total_movimentos: movimentos.length,
        contas_sicoob_detectadas: [...sicoobIds], contas: contasNomeadas, contas_corrente_raw: contas.raw,
        origem: dist((d) => d?.cOrigem), anexo_probe: anexoProbe,
        amostra_sicoob: amostraSicoob,
        amostra_bruta: movimentos.slice(0, 2).map((m) => (m as any)?.detalhes ?? {}),
      });
    }

    /* ================= SYNC (sem anexos) ================= */
    if (sicoobIds.size === 0) {
      return json({
        error: "Não identifiquei a conta corrente do Sicoob no Omie. Rode o preview, veja `contas` e me passe o nCodCC (ou configure via body.contasSicoob).",
        contas: [...contas.map.entries()].map(([id, info]) => ({ nCodCC: id, ...info })),
      }, 200);
    }

    const refFiltro: string | null = body?.referencia ? String(body.referencia) : null;

    // 1ª passada: seleciona os candidatos (guarda det/mov p/ montar depois).
    type Cand = { det: any; mov: any; codigo: string; desc: string; ref: string; idu: string };
    const cands: Cand[] = [];
    for (const mov of movimentos) {
      const det = (mov as any)?.detalhes ?? {};
      if (norm(det.cNatureza) !== "P") continue;                 // só saídas (contas a pagar)
      if (!sicoobIds.has(String(det.nCodCC))) continue;          // só a conta corrente do Sicoob
      if (ORIGENS_TRANSFERENCIA.has(norm(det.cOrigem))) continue; // exclui transferência de saída
      const c = catPrincipal(mov);
      if (categoriaExcluida(c.desc)) continue;                   // exclui pessoal/premiação/escala/benefícios

      const dataPg = parseOmieDate(det.dDtPagamento) ?? parseOmieDate(det.dDtRegistro) ?? parseOmieDate(det.dDtEmissao);
      const ref = dataPg ? ym(dataPg) : mesAtual();
      if (refFiltro && ref !== refFiltro) continue;

      const idu = String(det.nCodTitulo ?? det.cCodIntTitulo ?? "");
      if (!idu) continue;
      cands.push({ det, mov, codigo: c.codigo, desc: c.desc, ref, idu });
    }

    // 2ª passada: monta as linhas. O NOME do fornecedor (favorecido) NÃO é resolvido aqui —
    // fica a cargo do passo em lotes (ação "anexos"), que faz o ConsultarCliente. Guardamos
    // cod_cliente (p/ o lote resolver) e cnpj_cpf (fallback de exibição). Também não gravamos
    // favorecido nem anexos aqui → re-sync não reverte nome/comprovante já resolvidos.
    const agora = new Date().toISOString();
    const linhas = cands.map(({ det, mov, codigo, desc, ref, idu }) => {
      const dataPg = parseOmieDate(det.dDtPagamento) ?? parseOmieDate(det.dDtRegistro) ?? parseOmieDate(det.dDtEmissao);
      return {
        id_unico: idu, referencia: ref, data: dataPg ? iso(dataPg) : null,
        valor: primeiroNum(
          det.nValorTitulo, det.nValorMovimento, det.nValorDocumento, det.nValorBaixa, det.nValorPago,
          (mov as any)?.resumo?.nValPago, (mov as any)?.resumo?.nValLiquido, (mov as any)?.resumo?.nValAberto,
          (mov as any)?.resumo?.nValMovimento, det.nValor, det.nValLiquido,
        ),
        descricao: limpa(det.cObs) ?? limpa(det.observacao) ?? limpa(det.cNumDocFiscal),
        cod_cliente: limpa(det.nCodCliente ?? det.nCodFornecedor),
        cnpj_cpf: limpa(det.cCPFCNPJCliente),
        conta_corrente: contas.map.get(String(det.nCodCC))?.nome ?? limpa(det.nCodCC),
        categoria_codigo: limpa(codigo), categoria: limpa(desc),
        gerado_em: agora, updated_at: agora,
      };
    });

    let gravados = 0;
    for (let i = 0; i < linhas.length; i += 200) {
      const lote = linhas.slice(i, i + 200);
      const { error } = await supabase.from("auditoria_pix_lancamentos").upsert(lote, { onConflict: "id_unico" });
      if (error) throw error;
      gravados += lote.length;
    }

    // Faltam verificar os anexos deste mês (o front chama a ação "anexos" em seguida).
    let cq = supabase.from("auditoria_pix_lancamentos")
      .select("id", { count: "exact", head: true }).eq("anexo_verificado", false);
    if (refFiltro) cq = cq.eq("referencia", refFiltro);
    const { count } = await cq;

    return json({ ok: true, referencia: refFiltro ?? "todos", contas_sicoob: [...sicoobIds], pix_gravados: gravados, anexos_pendentes: count ?? 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-pix-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
