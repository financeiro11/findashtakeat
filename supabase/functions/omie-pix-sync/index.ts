// Edge Function: omie-pix-sync
// Puxa do Omie os lançamentos PIX (a auditar) já conciliados/categorizados pela
// conciliação diária Sicoob → Omie e grava em auditoria_pix_lancamentos.
//
// Regras de negócio:
//   • só SAÍDAS pagas via PIX (natureza "P" + documento/observação = PIX);
//   • NÃO entram categorias de pessoal / premiação / escala / benefícios;
//   • se o movimento tem anexo no Omie, o link/nome vêm junto (tem_comprovante).
//
// Ações (body.action):
//   "preview" → distribuições de cTipo/cCodModDoc/cOrigem/conta + dump bruto + sonda de
//               anexo (para confirmar como o Omie identifica PIX e expõe anexos) SEM gravar.
//   "sync"    → calcula o mês e grava. Params:
//               { referencia?: "YYYY-MM", modDocPix?: string[], tiposPix?: string[] }
//   Detecção de PIX: por padrão cCodModDoc = "18"; ajuste via modDocPix/tiposPix após o preview.
//
// A conciliação Sicoob→Omie é diária, então rode este sync depois dela (ex.: 1x/dia).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listarCategorias, listarMovimentos, omieCall } from "../_shared/omie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Omie devolve datas dd/mm/aaaa. Converte para Date e para "YYYY-MM" / ISO.
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
function categoriaExcluida(desc: string): boolean {
  const d = norm(desc);
  return CATEGORIAS_EXCLUIDAS.some((k) => d.includes(k));
}

// Omie identifica o MEIO DE PAGAMENTO em cCodModDoc (não em cTipo, que é o tipo de
// documento: NF/BOL/NFS/99999). PIX costuma ser o código "18". A confirmar no preview.
const MOD_DOC_PIX_DEFAULT = ["18"];
type DetectOpts = { tiposPix: string[] | null; modDocPix: string[] | null };

// Detecta PIX no movimento: por cCodModDoc (principal), por cTipo (se fixado) ou por
// texto "PIX" em qualquer campo. Ambos os filtros podem ser fixados via body após o preview.
function isPix(det: any, opts: DetectOpts): boolean {
  if (opts.tiposPix && opts.tiposPix.length && opts.tiposPix.map(norm).includes(norm(det?.cTipo))) return true;
  const mods = (opts.modDocPix && opts.modDocPix.length) ? opts.modDocPix : MOD_DOC_PIX_DEFAULT;
  if (mods.map(norm).includes(norm(det?.cCodModDoc))) return true;
  const hay = norm([det?.cTipo, det?.cOrigem, det?.cObs, det?.observacao, det?.cCodModDoc, det?.cNumDocFiscal].filter(Boolean).join(" "));
  return hay.includes("PIX");
}

// Sonda de anexos: o cTabela correto do Omie é incerto entre contas, então tentamos
// alguns candidatos. Retorna { anexos, tabela } do primeiro que responder com lista.
async function sondarAnexos(nId: number | string): Promise<{ tabela: string | null; anexos: any[] }> {
  const candidatos = ["contas-a-pagar", "financas-conta-pagar", "financas-movimentos", "movimentos"];
  for (const cTabela of candidatos) {
    try {
      const r = await omieCall<any>("geral/anexo", "ListarAnexo", { nId, cTabela });
      const anexos = r?.listaAnexos ?? r?.anexos ?? r?.arquivos ?? [];
      if (Array.isArray(anexos)) return { tabela: cTabela, anexos };
    } catch (_) { /* tenta o próximo candidato */ }
  }
  return { tabela: null, anexos: [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";
    const detectOpts: DetectOpts = {
      tiposPix: Array.isArray(body?.tiposPix) ? body.tiposPix : null,
      modDocPix: Array.isArray(body?.modDocPix) ? body.modDocPix : null,
    };

    // Categorias do Omie (código → descrição) — usadas em ambas as ações.
    const categorias = await listarCategorias();
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");

    const movimentos = await listarMovimentos({});

    // Extrai a categoria principal (maior parcela do rateio) de um movimento.
    const catPrincipal = (mov: any): { codigo: string; desc: string } => {
      const det = mov?.detalhes ?? {};
      const cats = Array.isArray(mov?.categorias) && mov.categorias.length
        ? mov.categorias
        : [{ cCodCateg: det.cCodCateg, nValor: det.nValorTitulo }];
      const main = [...cats].sort((a, b) => Math.abs(toNum(b.nValor)) - Math.abs(toNum(a.nValor)))[0];
      const codigo = String(main?.cCodCateg ?? "");
      return { codigo, desc: codToDesc.get(codigo) || codigo };
    };

    /* ---------------- PREVIEW ---------------- */
    if (action === "preview") {
      // Distribuições dos campos candidatos a identificar o meio de pagamento.
      const dist = (get: (det: any) => unknown) => {
        const m = new Map<string, number>();
        for (const mov of movimentos) { const k = String(get((mov as any)?.detalhes) ?? "—"); m.set(k, (m.get(k) ?? 0) + 1); }
        return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40));
      };
      const pixMovs = movimentos.filter((m) => isPix((m as any)?.detalhes, detectOpts));
      const amostraPix = pixMovs.slice(0, 5).map((m) => {
        const det = (m as any).detalhes ?? {};
        const c = catPrincipal(m);
        return {
          nCodTitulo: det.nCodTitulo, cTipo: det.cTipo, cCodModDoc: det.cCodModDoc, cNatureza: det.cNatureza,
          nValorTitulo: det.nValorTitulo, dDtPagamento: det.dDtPagamento,
          cObs: det.cObs, nCodCC: det.nCodCC, categoria: c.desc, excluida: categoriaExcluida(c.desc),
        };
      });
      // Dump bruto de alguns movimentos genéricos (cTipo 99999) — onde o PIX deve estar.
      const genericos = movimentos.filter((m) => String((m as any)?.detalhes?.cTipo) === "99999").slice(0, 6);
      const amostraBruta = (genericos.length ? genericos : movimentos.slice(0, 6)).map((m) => (m as any)?.detalhes ?? {});

      // Sonda de anexo no 1º PIX (ou, se nenhum, no 1º movimento) que tiver nCodTitulo.
      let anexoProbe: any = null;
      const alvo = [...pixMovs, ...movimentos].map((m) => (m as any)?.detalhes?.nCodTitulo).find(Boolean);
      if (alvo) anexoProbe = await sondarAnexos(alvo);

      return json({
        ok: true,
        total_movimentos: movimentos.length,
        total_pix_detectados: pixMovs.length,
        detector_usado: { modDocPix: detectOpts.modDocPix ?? MOD_DOC_PIX_DEFAULT, tiposPix: detectOpts.tiposPix },
        tipos_documento: dist((d) => d?.cTipo),
        mod_documento: dist((d) => d?.cCodModDoc),
        origem: dist((d) => d?.cOrigem),
        contas_nCodCC: dist((d) => d?.nCodCC),
        amostra_pix: amostraPix,
        amostra_bruta: amostraBruta,
        anexo_probe: anexoProbe,
      });
    }

    /* ---------------- SYNC ---------------- */
    const refFiltro: string | null = body?.referencia ? String(body.referencia) : null;

    // Seleciona: PIX + saída (natureza "P") + categoria não-excluída + (se pedido) do mês.
    type Cand = {
      id_unico: string; referencia: string; data: string | null; valor: number;
      descricao: string; favorecido: string; conta_corrente: string;
      categoria_codigo: string; categoria: string; nCodTitulo: any;
    };
    const cands: Cand[] = [];
    for (const mov of movimentos) {
      const det = (mov as any)?.detalhes ?? {};
      if (norm(det.cNatureza) !== "P") continue;            // só saídas
      if (!isPix(det, detectOpts)) continue;                // só PIX
      const c = catPrincipal(mov);
      if (categoriaExcluida(c.desc)) continue;              // exclui pessoal/premiação/escala/benefícios

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
        conta_corrente: String(det.cNomeCC ?? det.nCodCC ?? "").trim(),
        categoria_codigo: c.codigo, categoria: c.desc, nCodTitulo: det.nCodTitulo,
      });
    }

    // Anexos: melhor-esforço, em lotes concorrentes. Falha de um não derruba o sync.
    const CONC = 5;
    const anexoPorId = new Map<string, { url: string; nome: string } | null>();
    for (let i = 0; i < cands.length; i += CONC) {
      const lote = cands.slice(i, i + CONC);
      await Promise.all(lote.map(async (cd) => {
        if (!cd.nCodTitulo) { anexoPorId.set(cd.id_unico, null); return; }
        try {
          const { anexos } = await sondarAnexos(cd.nCodTitulo);
          const a = anexos?.[0];
          if (a) anexoPorId.set(cd.id_unico, { url: String(a.cUrl ?? a.url ?? a.cLinkDownload ?? ""), nome: String(a.cNomeArquivo ?? a.nome ?? a.cArquivo ?? "anexo") });
          else anexoPorId.set(cd.id_unico, null);
        } catch { anexoPorId.set(cd.id_unico, null); }
      }));
    }

    const agora = new Date().toISOString();
    const linhas = cands.map((cd) => {
      const anexo = anexoPorId.get(cd.id_unico) ?? null;
      return {
        id_unico: cd.id_unico, referencia: cd.referencia, data: cd.data, valor: cd.valor,
        descricao: cd.descricao || null, favorecido: cd.favorecido || null,
        conta_corrente: cd.conta_corrente || null,
        categoria_codigo: cd.categoria_codigo || null, categoria: cd.categoria || null,
        tem_comprovante: !!(anexo && anexo.url), comprovante_url: anexo?.url || null, anexo_nome: anexo?.nome || null,
        gerado_em: agora, updated_at: agora,
      };
    });

    // Upsert por id_unico (não sobrescreve status/observação editados no Hub).
    let gravados = 0;
    for (let i = 0; i < linhas.length; i += 200) {
      const lote = linhas.slice(i, i + 200);
      const { error } = await supabase
        .from("auditoria_pix_lancamentos")
        .upsert(lote, { onConflict: "id_unico", ignoreDuplicates: false });
      if (error) throw error;
      gravados += lote.length;
    }

    const comCompr = linhas.filter((l) => l.tem_comprovante).length;
    return json({
      ok: true,
      referencia: refFiltro ?? "todos",
      pix_gravados: gravados,
      com_comprovante: comCompr,
      sem_comprovante: gravados - comCompr,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-pix-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
