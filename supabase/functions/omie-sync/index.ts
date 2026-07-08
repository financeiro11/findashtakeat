// Edge Function: omie-sync
// Puxa DRE e DFC do Omie e grava na tabela `demonstracoes_contabeis`,
// no mesmo formato { columns, rows } que as páginas DRE.tsx / DFC.tsx já leem.
//
// Ações (body.action):
//   "preview"  → devolve as categorias do Omie + uma amostra de movimentos
//                (usado para montar o DE_PARA e validar os nomes dos campos).
//   "sync"     → agrega os movimentos por rubrica × mês (via omie_dre_mapa),
//                calcula os totais da DRE/DFC e grava em demonstracoes_contabeis.
//
// Regime (decisão do cliente):
//   DRE → data de registro (competência)
//   DFC → data de pagamento / débito-crédito (caixa)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listarCategorias, listarMovimentos } from "../_shared/omie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseOmieDate(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function monthKey(d: Date): string {
  return `${EN[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}
function fmtOmie(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function sortKey(k: string): number {
  const m = k.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return -1;
  const i = EN.indexOf(m[1]);
  return i < 0 ? -1 : (2000 + parseInt(m[2], 10)) * 12 + i;
}
function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Primeiro campo de data presente entre os candidatos (nomes variam por conta Omie).
function pickDate(det: any, keys: string[]): Date | null {
  for (const k of keys) {
    const d = parseOmieDate(det?.[k]);
    if (d) return d;
  }
  return null;
}

/* ============================================================
 *  Estrutura das demonstrações (para calcular os totais).
 *  Os rótulos batem EXATAMENTE com o schema de DRE.tsx / DFC.tsx.
 *  Os valores já entram com sinal (receita +, despesa −), então
 *  cada total é apenas a soma das rubricas da seção.
 * ============================================================ */

const DRE_SECOES = {
  receitaBruta: ["Receita de Assinaturas", "Enterprise", "Receita Spot", "Receita com Materiais", "Receita Markup", "Serviços para Clientes"],
  deducoes: ["Simples Nacional", "PIS", "COFINS", "ISS", "ICMS", "Inadimplência", "Devoluções"],
  custos: ["Equipe Operacional", "Premiações Operacionais", "Meios de Pagamento", "CMV Materiais", "Servidor", "Softwares Operacionais", "Outros Custos"],
  sga: [
    "Equipe Administrativa", "Equipe Marketing", "Equipe Parcerias", "Equipe Comercial", "Equipe Onboarding", "Equipe Tecnologia", "Benefícios", "Encargos Sociais",
    "Ocupação & Escritório", "Assessorias & Consultorias", "Softwares Administrativos", "Viagens & Transportes Adm", "Outras despesas Adm",
    "Campanhas de Mídia Paga", "Campanhas de Outros Canais", "Comissões Consultores / Parceiros", "Premiações", "MGM", "Softwares Marketing & Vendas", "Agências & Consultorias", "Viagens & Transportes Mkt", "Eventos e Feiras", "Outras despesas Mkt",
  ],
  resultadoFin: ["(-) Depreciação & Amortização", "(-) Juros", "(-) IOF", "(+) Receita financeira"],
  resultadoNaoOp: ["Despesas Não Operacionais", "(-) Estorno de Compras"],
  impostos: ["IRPJ", "CSLL", "IRF"],
};

const DFC_SECOES = {
  entradas: [
    "Receita de Assinaturas", "Receita com Materiais", "Receita Markup", "Receita de Serviços",
    "Entrada de Receita", "(+) Receita financeira", "(+) Resultado Não Operacional",
  ],
  saidas: [
    // Impostos
    "Simples Nacional", "PIS", "COFINS", "ISS", "ICMS", "IRF", "Parcelamento de Impostos", "Retenção de Contribuição",
    // Pessoal
    "Equipe Administrativa", "Equipe Comercial", "Equipe Marketing", "Equipe Tecnologia", "Equipe Operacional", "Equipe Onboarding", "Premiações Operacionais", "Premiações", "Encargos sociais", "Benefícios",
    // Custos de operação
    "CMV Materiais", "Outros Custos", "Meios de Pagamento", "Servidor", "Softwares Operacionais", "MGM",
    // Administrativas
    "Assessorias & Consultorias", "Softwares Administrativos", "Ocupação & Escritório", "Viagens & Transportes Adm", "Outras Despesas Adm",
    // Marketing & Vendas
    "Softwares Marketing & Vendas", "Agências & Consultorias", "Campanhas de Mídia Paga", "Campanhas de Outros Canais", "Comissões Consultores / Parceiros", "Eventos e Feiras", "Viagens & Transportes Mkt", "Outras Despesas Mkt",
    // Financeiras + devoluções
    "(-) Juros", "(-) IOF", "(-) Depesas Financeiras", "Devoluções",
  ],
  investimentos: ["(-) Compra de Equipamentos", "(-) Investimentos em Estrutura", "(-) Compra de Participação", "Depósitos e Caução"],
  financiamento: ["(+) Novos Empréstimos & Financiamentos", "(-) Amortização de Financiamentos", "Antecipação da Receita", "Abatimento de Antecipação da Receita", "(-) Rodada de Investimentos"],
};

type Agg = Map<string, Map<string, number>>; // rubrica → (mês → valor)

function addTo(agg: Agg, rubrica: string, mes: string, valor: number) {
  let byMes = agg.get(rubrica);
  if (!byMes) { byMes = new Map(); agg.set(rubrica, byMes); }
  byMes.set(mes, (byMes.get(mes) ?? 0) + valor);
}
function getVal(agg: Agg, rubrica: string, mes: string): number {
  return agg.get(rubrica)?.get(mes) ?? 0;
}
function sumSecao(agg: Agg, labels: string[], mes: string): number {
  return labels.reduce((s, l) => s + getVal(agg, l, mes), 0);
}

// Constrói o payload { columns, rows } a partir do agregado + linhas de total.
function buildPayload(agg: Agg, totais: (mes: string) => Record<string, number>): { columns: string[]; rows: any[]; linhas: number } {
  const meses = new Set<string>();
  for (const byMes of agg.values()) for (const m of byMes.keys()) meses.add(m);
  // adiciona meses que só aparecem nos totais? totais derivam do agg, então já cobertos.
  const cols = [...meses].filter((m) => sortKey(m) >= 0).sort((a, b) => sortKey(a) - sortKey(b));

  const rows: any[] = [];
  // rubricas mapeadas
  for (const [rubrica, byMes] of agg) {
    const row: Record<string, any> = { Conta: rubrica };
    for (const c of cols) row[c] = Math.round((byMes.get(c) ?? 0) * 100) / 100;
    rows.push(row);
  }
  // linhas de total (calculadas por coluna)
  const totalRows: Record<string, Record<string, any>> = {};
  for (const c of cols) {
    const t = totais(c);
    for (const [label, val] of Object.entries(t)) {
      if (!totalRows[label]) totalRows[label] = { Conta: label };
      totalRows[label][c] = Math.round(val * 100) / 100;
    }
  }
  for (const r of Object.values(totalRows)) rows.push(r);

  return { columns: ["Conta", ...cols], rows, linhas: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";

    /* ---------------- PREVIEW ---------------- */
    if (action === "preview") {
      const categorias = await listarCategorias();
      // amostra pequena de movimentos (sem filtro) só para inspecionar os campos reais
      const amostra = await listarMovimentos({ nRegPorPagina: 20 }, 1);
      return json({
        ok: true,
        total_categorias: categorias.length,
        categorias: categorias.map((c) => ({
          codigo: c.codigo,
          descricao: c.descricao,
          natureza: c.natureza,
          codigo_dre: c.codigo_dre,
          descricao_dre: c.descricao_dre,
        })),
        amostra_movimento: amostra[0] ?? null,
      });
    }

    /* ---------------- SYNC ---------------- */
    // Janela de datas (default: início do ano anterior até hoje)
    const hoje = new Date();
    const defDe = new Date(hoje.getFullYear() - 1, 0, 1);
    const dDe = body?.de ? parseOmieDate(body.de) ?? defDe : defDe;
    const dAte = body?.ate ? parseOmieDate(body.ate) ?? hoje : hoje;

    // registra log
    const { data: logRow } = await supabase
      .from("omie_sync_log")
      .insert({ status: "rodando", periodo_de: dDe.toISOString().slice(0, 10), periodo_ate: dAte.toISOString().slice(0, 10) })
      .select("id")
      .single();
    const logId = (logRow as any)?.id;

    try {
      // 1) DE_PARA (chave: descrição normalizada da categoria; ver passo 2)
      const { data: mapaRows } = await supabase
        .from("omie_dre_mapa")
        .select("codigo_categoria, rubrica, demonstrativo, ativo");
      const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
      const mapaDre = new Map<string, string>();
      const mapaDfc = new Map<string, string>();
      for (const m of (mapaRows ?? []) as any[]) {
        if (m.ativo === false) continue;
        const k = norm(m.codigo_categoria);
        if (m.demonstrativo === "dre" || m.demonstrativo === "ambos") mapaDre.set(k, m.rubrica);
        if (m.demonstrativo === "dfc" || m.demonstrativo === "ambos") mapaDfc.set(k, m.rubrica);
      }

      // 2) Descoberta importante: `cCodCateg` no movimento é o código curto do Omie
      // (ex.: "1.01.03"), mas o DE_PARA foi semeado com a DESCRIÇÃO da categoria
      // (ex.: "1.1.1. Receita Assinaturas"). Portanto: monta um mapa
      // codigoOmie → descrição a partir de ListarCategorias e casa por descrição.
      const categorias = await listarCategorias();
      const codigoToDescricao = new Map<string, string>();
      for (const c of categorias) {
        if (c.codigo) codigoToDescricao.set(String(c.codigo), c.descricao ?? "");
      }

      // 3) Movimentos no período. O endpoint financas/mf/ListarMovimentos usa
      // dDtInicial/dDtFinal + cTipoData. Fazemos 2 passes: um pela competência
      // (REGISTRO) para a DRE e outro pelo caixa (PAGAMENTO) para a DFC.
      const movimentosDre = await listarMovimentos({
        dDtInicial: fmtOmie(dDe), dDtFinal: fmtOmie(dAte), cTipoData: "REGISTRO",
      });
      const movimentosDfc = await listarMovimentos({
        dDtInicial: fmtOmie(dDe), dDtFinal: fmtOmie(dAte), cTipoData: "PAGAMENTO",
      });
      const movimentos = [...movimentosDre, ...movimentosDfc];

      const dreAgg: Agg = new Map();
      const dfcAgg: Agg = new Map();
      const naoMapeadas = new Set<string>();

      const visitosDre = new Set<string>(); // dedup por título (nCodTitulo) por pass
      const visitosDfc = new Set<string>();

      function processar(mov: any, escopo: "dre" | "dfc") {
        const det = mov?.detalhes ?? {};
        // Natureza no Omie: "R" (receber / receita) vs "P" (pagar / despesa).
        const natureza = String(det.cNatureza ?? det.natureza ?? "R").toUpperCase();
        const sinal = natureza.startsWith("P") || natureza.startsWith("D") ? -1 : 1;

        const dataDre = pickDate(det, ["dDtRegistro", "dDtInclusao", "dDtEmissao", "dDtPrevisao"]);
        const dataDfc = pickDate(det, ["dDtPagamento", "dDtBaixa", "dDtCredito", "dDtConciliacao"]);

        const cats = Array.isArray(mov?.categorias) && mov.categorias.length
          ? mov.categorias
          : [{ cCodCateg: det.cCodCateg, nValor: det.nValorTitulo }];

        for (const cat of cats) {
          const codigoOmie = String(cat.cCodCateg ?? "");
          if (!codigoOmie) continue;
          const descricao = codigoToDescricao.get(codigoOmie) ?? codigoOmie;
          const chave = norm(descricao);
          const valor = sinal * Math.abs(toNum(cat.nValor));

          if (escopo === "dre" && dataDre) {
            const rub = mapaDre.get(chave);
            if (rub) addTo(dreAgg, rub, monthKey(dataDre), valor);
            else naoMapeadas.add(`${codigoOmie} :: ${descricao}`);
          }
          if (escopo === "dfc" && dataDfc) {
            const rub = mapaDfc.get(chave);
            if (rub) addTo(dfcAgg, rub, monthKey(dataDfc), valor);
            else naoMapeadas.add(`${codigoOmie} :: ${descricao}`);
          }
        }
      }

      for (const mov of movimentosDre) {
        const id = String(mov?.detalhes?.nCodTitulo ?? mov?.detalhes?.nCodTitRepet ?? "");
        if (id && visitosDre.has(id)) continue;
        if (id) visitosDre.add(id);
        processar(mov, "dre");
      }
      for (const mov of movimentosDfc) {
        const id = String(mov?.detalhes?.nCodTitulo ?? mov?.detalhes?.nCodTitRepet ?? "");
        if (id && visitosDfc.has(id)) continue;
        if (id) visitosDfc.add(id);
        processar(mov, "dfc");
      }

      // 3) Totais
      const dreTotais = (mes: string): Record<string, number> => {
        const rl = sumSecao(dreAgg, DRE_SECOES.receitaBruta, mes) + sumSecao(dreAgg, DRE_SECOES.deducoes, mes);
        const mc = rl + sumSecao(dreAgg, DRE_SECOES.custos, mes);
        const eb = mc + sumSecao(dreAgg, DRE_SECOES.sga, mes);
        const ll = eb + sumSecao(dreAgg, DRE_SECOES.resultadoFin, mes) + sumSecao(dreAgg, DRE_SECOES.resultadoNaoOp, mes) + sumSecao(dreAgg, DRE_SECOES.impostos, mes);
        return { "Receita Líquida": rl, "Margem de contribuição": mc, "EBITDA": eb, "Lucro Líquido": ll };
      };
      const drePayload = buildPayload(dreAgg, dreTotais);

      const dfcTotais = (mes: string): Record<string, number> => {
        const fco = sumSecao(dfcAgg, DFC_SECOES.entradas, mes) + sumSecao(dfcAgg, DFC_SECOES.saidas, mes);
        const fl = fco + sumSecao(dfcAgg, DFC_SECOES.investimentos, mes) + sumSecao(dfcAgg, DFC_SECOES.financiamento, mes);
        return { "Fluxo de Caixa Operacional": fco, "Fluxo Livre": fl };
      };
      const dfcPayload = buildPayload(dfcAgg, dfcTotais);
      // Cashburn 12M = soma móvel de 12 meses do Fluxo Livre
      {
        const cols = dfcPayload.columns.filter((c: string) => c !== "Conta");
        const flByCol: Record<string, number> = {};
        for (const c of cols) flByCol[c] = dfcTotais(c)["Fluxo Livre"];
        const cashRow: Record<string, any> = { Conta: "Cashburn 12M" };
        cols.forEach((c: string, i: number) => {
          const janela = cols.slice(Math.max(0, i - 11), i + 1);
          cashRow[c] = Math.round(janela.reduce((s, k) => s + (flByCol[k] ?? 0), 0) * 100) / 100;
        });
        dfcPayload.rows.push(cashRow);
      }

      // 4) Grava nas demonstrações (mesmo formato do import de Excel)
      const upserts = await Promise.all([
        supabase.from("demonstracoes_contabeis").upsert(
          { tipo: "dre", periodo: "completo", dados: { columns: drePayload.columns, rows: drePayload.rows }, pdf_path: null },
          { onConflict: "tipo,periodo" },
        ),
        supabase.from("demonstracoes_contabeis").upsert(
          { tipo: "dfc", periodo: "completo", dados: { columns: dfcPayload.columns, rows: dfcPayload.rows }, pdf_path: null },
          { onConflict: "tipo,periodo" },
        ),
      ]);
      const upErr = upserts.map((u) => u.error).filter(Boolean)[0];
      if (upErr) throw upErr;

      if (logId) {
        await supabase.from("omie_sync_log").update({
          status: "ok", concluido_em: new Date().toISOString(),
          movimentos: movimentos.length, dre_linhas: drePayload.linhas, dfc_linhas: dfcPayload.linhas,
          nao_mapeadas: naoMapeadas.size,
        }).eq("id", logId);
      }

      return json({
        ok: true,
        movimentos: movimentos.length,
        dre_linhas: drePayload.linhas,
        dfc_linhas: dfcPayload.linhas,
        nao_mapeadas: naoMapeadas.size,
        categorias_sem_de_para: [...naoMapeadas],
      });
    } catch (e) {
      if (logId) {
        await supabase.from("omie_sync_log").update({
          status: "erro", concluido_em: new Date().toISOString(), erro: e instanceof Error ? e.message : String(e),
        }).eq("id", logId);
      }
      throw e;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
