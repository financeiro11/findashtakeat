// Edge Function: omie-pix-sync
// Puxa do Omie os lançamentos da(s) conta(s) Sicoob (a auditar) já conciliados/
// categorizados pela conciliação diária Sicoob → Omie e grava em auditoria_pix_lancamentos.
//
// IMPORTANTE (descoberto via preview): o Omie NÃO expõe o meio de pagamento em
// financas/mf/ListarMovimentos — cCodModDoc vem vazio e não há "PIX" em nenhum campo.
// O que existe é a CONTA BANCÁRIA (nCodCC). Como o Sicoob é a conta de PIX, filtramos
// pelos movimentos de saída daquela conta.
//
// Regras de negócio:
//   • só SAÍDAS (natureza "P") da conta corrente do Sicoob (contas a pagar);
//   • NÃO entram transferências de saída (cOrigem "TRAP");
//   • NÃO entram categorias de pessoal / premiação / escala / benefícios;
//   • se o título tem anexo no Omie, o link/nome vêm junto (tem_comprovante).
//
// Ações (body.action):
//   "preview" → nomes das contas (p/ achar o Sicoob), distribuições e sonda de anexo
//               com os erros do Omie (p/ achar o cTabela correto). SEM gravar.
//   "sync"    → grava. Params:
//               { referencia?: "YYYY-MM", contasSicoob?: (string|number)[], anexoTabela?: string }
//   Sem contasSicoob, a função auto-detecta a conta pelo nome/banco "SICOOB" (código 756).

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

// Categorias que NÃO devem ser auditadas aqui (pedido do financeiro).
const CATEGORIAS_EXCLUIDAS = ["PESSOAL", "PREMIA", "ESCALA", "BENEF"];
const categoriaExcluida = (desc: string) => CATEGORIAS_EXCLUIDAS.some((k) => norm(desc).includes(k));

// Origens de transferência de saída (transferência entre contas próprias) — excluídas.
const ORIGENS_TRANSFERENCIA = new Set(["TRAP"]);

// Contas correntes do Omie: nCodCC → { nome, banco }. Usado p/ achar o Sicoob pelo nome.
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

// Sonda de anexos: tenta vários cTabela e, no preview, devolve o erro do Omie de cada um
// (o Omie geralmente lista os valores válidos na mensagem de erro).
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
async function anexoDe(nId: number | string, tabelas: string[]): Promise<{ url: string; nome: string } | null> {
  for (const cTabela of tabelas) {
    try {
      const r = await omieCall<any>("geral/anexo", "ListarAnexo", { nId, cTabela, nPagina: 1, nRegPorPagina: 50 });
      const anexos = r?.listaAnexos ?? r?.anexos ?? r?.arquivos ?? [];
      if (Array.isArray(anexos) && anexos.length) {
        const a = anexos[0];
        return { url: String(a.cUrl ?? a.url ?? a.cLinkDownload ?? ""), nome: String(a.cNomeArquivo ?? a.nome ?? a.cArquivo ?? "anexo") };
      }
      if (Array.isArray(anexos)) return null; // tabela certa, sem anexos
    } catch (_) { /* tenta a próxima */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";
    const contasSicoobOverride: string[] | null = Array.isArray(body?.contasSicoob) ? body.contasSicoob.map(String) : null;
    // "conta-pagar" é o cTabela válido dos anexos (confirmado no preview). Fixável via body.
    const anexoTabelas: string[] = body?.anexoTabela ? [String(body.anexoTabela)] : ["conta-pagar"];

    // Categorias (código → descrição) e contas correntes (p/ achar o Sicoob).
    const [categorias, contas] = await Promise.all([listarCategorias(), listarContasCorrentes()]);
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");

    // Conta a auditar: SÓ a conta corrente do Sicoob (exclui o cartão e a aplicação, que
    // também são "Sicoob"). Override via body.contasSicoob; senão auto por nome.
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

    /* ---------------- PREVIEW ---------------- */
    if (action === "preview") {
      const dist = (get: (det: any) => unknown) => {
        const m = new Map<string, number>();
        for (const mov of movimentos) { const k = String(get((mov as any)?.detalhes) ?? "—"); m.set(k, (m.get(k) ?? 0) + 1); }
        return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40));
      };
      // Contas nomeadas + volume de movimentos por conta (p/ identificar o Sicoob).
      const volPorConta = new Map<string, number>();
      for (const mov of movimentos) { const k = String((mov as any)?.detalhes?.nCodCC ?? "—"); volPorConta.set(k, (volPorConta.get(k) ?? 0) + 1); }
      const contasNomeadas = [...volPorConta.entries()].sort((a, b) => b[1] - a[1]).map(([id, mov]) => ({
        nCodCC: id, movimentos: mov, nome: contas.map.get(id)?.nome ?? "(desconhecido)", banco: contas.map.get(id)?.banco ?? "",
        sicoob_detectado: sicoobIds.has(id),
      }));

      const alvoAnexo = movimentos.map((m) => (m as any)?.detalhes?.nCodTitulo).find(Boolean);
      const anexoProbe = alvoAnexo ? await probarAnexos(alvoAnexo) : [];

      return json({
        ok: true,
        total_movimentos: movimentos.length,
        contas_sicoob_detectadas: [...sicoobIds],
        contas: contasNomeadas,
        contas_corrente_raw: contas.raw,
        origem: dist((d) => d?.cOrigem),
        anexo_probe: anexoProbe,
        amostra_bruta: movimentos.slice(0, 4).map((m) => (m as any)?.detalhes ?? {}),
      });
    }

    /* ---------------- SYNC ---------------- */
    if (sicoobIds.size === 0) {
      return json({
        error: "Não identifiquei a conta do Sicoob no Omie. Rode o preview, veja a lista `contas` e me passe o nCodCC do Sicoob (ou configure via body.contasSicoob).",
        contas: [...contas.map.entries()].map(([id, info]) => ({ nCodCC: id, ...info })),
      }, 200);
    }

    const refFiltro: string | null = body?.referencia ? String(body.referencia) : null;

    type Cand = {
      id_unico: string; referencia: string; data: string | null; valor: number;
      descricao: string; favorecido: string; conta_corrente: string;
      categoria_codigo: string; categoria: string; nCodTitulo: any;
    };
    const cands: Cand[] = [];
    for (const mov of movimentos) {
      const det = (mov as any)?.detalhes ?? {};
      if (norm(det.cNatureza) !== "P") continue;              // só saídas (contas a pagar)
      if (!sicoobIds.has(String(det.nCodCC))) continue;       // só a conta corrente do Sicoob
      if (ORIGENS_TRANSFERENCIA.has(norm(det.cOrigem))) continue; // exclui transferência de saída
      const c = catPrincipal(mov);
      if (categoriaExcluida(c.desc)) continue;                // exclui pessoal/premiação/escala/benefícios

      const dataPg = parseOmieDate(det.dDtPagamento) ?? parseOmieDate(det.dDtRegistro) ?? parseOmieDate(det.dDtEmissao);
      const ref = dataPg ? ym(dataPg) : mesAtual();
      if (refFiltro && ref !== refFiltro) continue;

      const idu = String(det.nCodTitulo ?? det.cCodIntTitulo ?? "");
      if (!idu) continue;

      cands.push({
        id_unico: idu, referencia: ref, data: dataPg ? iso(dataPg) : null,
        valor: Math.abs(toNum(det.nValorTitulo ?? det.nValorMovimento ?? det.nValorPago)),
        descricao: String(det.cObs ?? det.observacao ?? det.cNumTitulo ?? "").trim(),
        favorecido: String(det.cRazaoCliente ?? det.cNomeCliente ?? det.cCPFCNPJCliente ?? "").trim(),
        conta_corrente: contas.map.get(String(det.nCodCC))?.nome ?? String(det.nCodCC ?? ""),
        categoria_codigo: c.codigo, categoria: c.desc, nCodTitulo: det.nCodTitulo,
      });
    }

    // Anexos: melhor-esforço, em lotes concorrentes. Falha de um não derruba o sync.
    const CONC = 5;
    const anexoPorId = new Map<string, { url: string; nome: string } | null>();
    for (let i = 0; i < cands.length; i += CONC) {
      const lote = cands.slice(i, i + CONC);
      await Promise.all(lote.map(async (cd) => {
        anexoPorId.set(cd.id_unico, cd.nCodTitulo ? await anexoDe(cd.nCodTitulo, anexoTabelas) : null);
      }));
    }

    const agora = new Date().toISOString();
    const linhas = cands.map((cd) => {
      const anexo = anexoPorId.get(cd.id_unico) ?? null;
      return {
        id_unico: cd.id_unico, referencia: cd.referencia, data: cd.data, valor: cd.valor,
        descricao: cd.descricao || null, favorecido: cd.favorecido || null, conta_corrente: cd.conta_corrente || null,
        categoria_codigo: cd.categoria_codigo || null, categoria: cd.categoria || null,
        tem_comprovante: !!(anexo && anexo.url), comprovante_url: anexo?.url || null, anexo_nome: anexo?.nome || null,
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

    const comCompr = linhas.filter((l) => l.tem_comprovante).length;
    return json({
      ok: true, referencia: refFiltro ?? "todos", contas_sicoob: [...sicoobIds],
      pix_gravados: gravados, com_comprovante: comCompr, sem_comprovante: gravados - comCompr,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-pix-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
