// Edge Function: churn-sheet-sync
//
// Lê a planilha "[CHURN TAKEAT 2026] Métricas gerais" (Google Sheets nativo, compartilhado
// por link) e grava um snapshot por competência em `churn_snapshot`. A aba "Churn" de
// /assinaturas só lê o snapshot.
//
// POR QUE RECALCULAR EM VEZ DE LER A ABA PRONTA: o bloco "KPI's Gerais" da aba
// "Mensal 2026" é calculado em cima de um dropdown de mês (célula B1) — pela API só viria o
// mês que estiver selecionado no momento. Aqui reproduzimos as fórmulas dela em cima das
// bases, o que dá o ano inteiro e não depende de ninguém deixar o dropdown no lugar certo.
//
// Fórmulas replicadas (conferidas contra Julho/26 na planilha):
//   # Cancelamentos   COUNTIF('CHURNS'!K = mês)                    → 142
//   $ Cancelamentos   SUMIFS('CHURNS'!E ; K = mês)                 → R$ 50.477,81
//   # / $ Downsell    COUNTIF/SUMIF('DOWNSELL'!F = mês ; D)        → 17 / R$ 1.751,21
//   # / $ Upsell      'UPSELL': B="Upsell" E H="sim" E L=mês ; J   → 74 / R$ 9.555,90
//   # / $ Reativações 'REATIVAÇÕES': D="sim" E F=mês ; C           → 5 / R$ 1.761,33
//   # Churn           cancelamentos − reativações                  → 137
//   $ Churn           cancelamentos + downsell − upsell − reativações → R$ 40.911,79
//   % Churn Receita   $ Churn / MRR início do mês                  → 3,79 %
//   North Star        Meta % / % Churn Receita                     → 77,92 %
//
// MRR de início do mês e quantidade de clientes vêm de "DADOS 2026" (colunas B e C) — e são
// o mesmo número do snapshot de assinaturas da competência ANTERIOR (a base fechada no fim
// do mês passado). O sync confere isso e guarda o resultado em dados.base.conferencia.
//
// Ações (body.action): "sync" (default — todos os meses com base) · "preview" (lista abas e
// meses com dados) · "probe" (testa só o download do binário).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { requireUser } from "../_shared/auth.ts";

const FILE_ID = "10A9YnskShPPZ2Xz9d-kN2SHCv-qN-48-94rQBbCNWIo";
// Google Sheets NATIVO (diferente da planilha de assinaturas, que é um .xlsx no Drive): o
// endpoint de export entrega o workbook convertido sem OAuth, desde que o compartilhamento
// "qualquer pessoa com o link" siga ativo.
const DOWNLOAD_URL = `https://docs.google.com/spreadsheets/d/${FILE_ID}/export?format=xlsx`;

const ANO_PADRAO = 2026;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* ------------------------------- constantes da planilha ------------------------------- */
const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const MES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Meta de churn de receita por mês. Na planilha isso NÃO é uma célula: está embutido no
// IF encadeado da fórmula B25 da aba "Mensal 2026". Se a diretoria mudar a meta, é aqui
// que se atualiza (e vale conferir a fórmula B25 de novo).
const META_PCT: Record<number, number> = {
  1: 3.42, 2: 3.28, 3: 3.23, 4: 3.15, 5: 3.05, 6: 3.00,
  7: 2.95, 8: 2.95, 9: 2.95, 10: 2.90, 11: 2.90, 12: 3.00,
};

const SETORES = ["Onboarding", "Sucesso", "Comercial"] as const;
const NIVEIS = ["P", "M", "G", "GG"] as const;

// Índices de coluna (0-based) de cada base.
const C_CHURNS = { nome: 0, cnpj: 1, valor_plano: 3, tm_mrr: 4, qualificacao: 5, fechamento: 9, mes: 10, setor: 11 };
const C_DOWNSELL = { tm_mrr: 3, mes: 5 };
const C_UPSELL = { plano: 1, pagamento: 7, mrr: 9, mes: 11 };
const C_REATIVACAO = { tm_mrr: 2, pago: 3, mes: 5 };
const C_DADOS = { mes: 0, mrr: 1, clientes: 2, tm: 3, p: 4, m: 5, g: 6, gg: 7 };

/* ------------------------------- helpers ------------------------------- */
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (s: unknown) => semAcento(String(s ?? "").trim().toLowerCase()).replace(/\s+/g, " ");

// Célula numérica. Com raw:true o SheetJS já devolve number; o fallback cobre texto em
// pt-BR ("R$ 1.080.613,29") e en-US ("1,080,613.29").
function num(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  let s = String(v).replace(/[R$\s% ]/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const div = (a: number, b: number) => (b ? a / b : 0);
const pctDe = (a: number, b: number) => div(a, b) * 100;

// Baixa o workbook convertido em .xlsx.
async function baixarXlsx(): Promise<Uint8Array> {
  const r = await fetch(DOWNLOAD_URL, { redirect: "follow" });
  if (!r.ok) {
    throw new Error(
      `Google [${r.status}] ao exportar a planilha de churn — provavelmente o compartilhamento "qualquer pessoa com o link" foi removido.`,
    );
  }
  const buf = new Uint8Array(await r.arrayBuffer());
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    const amostra = new TextDecoder().decode(buf.slice(0, 160));
    throw new Error(`O export não retornou um .xlsx (veio HTML — sem acesso?). Início: ${amostra}`);
  }
  return buf;
}

// Lê só as abas necessárias numa passada (o workbook inteiro tem ~16MB de XML; as 5 abas
// de interesse + sharedStrings dão ~4MB, o que cabe na memória da edge function).
function lerAbas(bytes: Uint8Array, nomes: string[]): Record<string, any[][]> {
  const wb = XLSX.read(bytes, {
    type: "array", sheets: nomes,
    cellStyles: false, cellNF: false, cellHTML: false, bookVBA: false, sheetStubs: false,
  });
  const out: Record<string, any[][]> = {};
  for (const n of nomes) {
    const ws = wb.Sheets[n];
    out[n] = ws
      ? (XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "", raw: true }) as any[][])
      : [];
  }
  return out;
}

// Resolve o nome real da aba (a planilha tem "CÓPIA DE 2026 CHURNS", "UPSELL 2" etc. —
// por isso o match é exato sobre o nome normalizado, não "contém").
function acharAba(nomes: string[], alvo: string): string {
  const k = chave(alvo);
  const achado = nomes.find((n) => chave(n) === k);
  if (!achado) throw new Error(`Aba "${alvo}" não encontrada na planilha. Abas: ${nomes.join(" | ")}`);
  return achado;
}

/* ------------------------------- cálculo de um mês ------------------------------- */
type Bases = { dados: any[][]; churns: any[][]; downsell: any[][]; upsell: any[][]; reativacoes: any[][] };

function linhaDoMes(dados: any[][], mes: number): any[] | null {
  const alvo = chave(MESES_PT[mes - 1]);
  return dados.find((r) => chave(r?.[C_DADOS.mes]) === alvo) ?? null;
}

function calcularMes(mes: number, ano: number, b: Bases) {
  const linha = linhaDoMes(b.dados, mes);
  const mrr_inicio = linha ? num(linha[C_DADOS.mrr]) : 0;
  const clientes = linha ? num(linha[C_DADOS.clientes]) : 0;
  if (!mrr_inicio) return null; // mês ainda sem base fechada na planilha

  const doMes = (rows: any[][], col: number) => rows.filter((r) => num(r?.[col]) === mes);

  // --- bases do mês ---
  const cancelamentos = doMes(b.churns, C_CHURNS.mes).filter((r) => String(r[C_CHURNS.nome] ?? "").trim() !== "");
  const downsell = doMes(b.downsell, C_DOWNSELL.mes);
  const upsell = doMes(b.upsell, C_UPSELL.mes)
    .filter((r) => chave(r[C_UPSELL.plano]) === "upsell" && chave(r[C_UPSELL.pagamento]) === "sim");
  const reativacoes = doMes(b.reativacoes, C_REATIVACAO.mes)
    .filter((r) => chave(r[C_REATIVACAO.pago]) === "sim");

  const soma = (rows: any[][], col: number) => rows.reduce((a, r) => a + num(r[col]), 0);

  const cancel_qtd = cancelamentos.length;
  const cancel_valor = soma(cancelamentos, C_CHURNS.tm_mrr);
  const downsell_qtd = downsell.length;
  const downsell_valor = soma(downsell, C_DOWNSELL.tm_mrr);
  const upsell_qtd = upsell.length;
  const upsell_valor = soma(upsell, C_UPSELL.mrr);
  const reativacao_qtd = reativacoes.length;
  const reativacao_valor = soma(reativacoes, C_REATIVACAO.tm_mrr);

  // # Churn = cancelamentos − reativações · $ Churn = cancelamentos + downsell − upsell − reativações
  const churn_qtd = cancel_qtd - reativacao_qtd;
  const churn_valor = cancel_valor + downsell_valor - upsell_valor - reativacao_valor;

  // --- cortes por setor ---
  const doSetor = (setor: string) => cancelamentos.filter((r) => chave(r[C_CHURNS.setor]) === chave(setor));
  const setorLinhas = SETORES.map((setor) => {
    const rows = doSetor(setor);
    const valor = soma(rows, C_CHURNS.tm_mrr);
    // Sucesso é o setor que "recebe" downsell/upsell/reativações (fórmulas B21/B24 da planilha):
    // o líquido e a contagem descontam as reativações do mês.
    const ehSucesso = chave(setor) === "sucesso";
    const valor_liquido = ehSucesso ? valor + downsell_valor - upsell_valor - reativacao_valor : valor;
    const qtd_liquida = ehSucesso ? rows.length - reativacao_qtd : rows.length;
    return {
      setor,
      qtd: rows.length,
      valor,
      pct_do_cancelamento: pctDe(valor, cancel_valor),
      pct_receita: pctDe(valor, mrr_inicio),
      pct_receita_liquido: pctDe(valor_liquido, mrr_inicio),
      pct_cliente: pctDe(qtd_liquida, clientes),
    };
  });

  // --- cortes por qualificação (geral + dentro de cada setor) ---
  const bloco = (rows: any[][]) => {
    const total = soma(rows, C_CHURNS.tm_mrr);
    return NIVEIS.map((nivel) => {
      const doNivel = rows.filter((r) => chave(r[C_CHURNS.qualificacao]) === chave(nivel));
      const valor = soma(doNivel, C_CHURNS.tm_mrr);
      return {
        nivel,
        qtd: doNivel.length,
        valor,
        pct_do_bloco: pctDe(valor, total),
        pct_mrr: pctDe(valor, mrr_inicio),
        tm: div(valor, doNivel.length),
      };
    });
  };

  const meta_pct = META_PCT[mes] ?? 0;
  const pct_receita_geral = pctDe(churn_valor, mrr_inicio);
  const sucesso = setorLinhas.find((s) => chave(s.setor) === "sucesso");
  const onboarding = setorLinhas.find((s) => chave(s.setor) === "onboarding");

  return {
    competencia: `${ano}-${String(mes).padStart(2, "0")}-01`,
    mes_label: `${MES_LABEL[mes - 1]} ${String(ano).slice(-2)}`,
    mes_nome: MESES_PT[mes - 1],
    mes_num: mes,
    base: {
      mrr_inicio,
      clientes,
      tm_mrr: linha ? num(linha[C_DADOS.tm]) : div(mrr_inicio, clientes),
      mix_clientes: linha
        ? { P: num(linha[C_DADOS.p]), M: num(linha[C_DADOS.m]), G: num(linha[C_DADOS.g]), GG: num(linha[C_DADOS.gg]) }
        : null,
    },
    kpis: {
      cancel_qtd, cancel_valor, cancel_tm: div(cancel_valor, cancel_qtd),
      downsell_qtd, downsell_valor,
      upsell_qtd, upsell_valor,
      reativacao_qtd, reativacao_valor,
      churn_qtd, churn_valor, churn_tm: div(churn_valor, churn_qtd),
      pct_receita_geral,
      pct_receita_onboarding: onboarding?.pct_receita ?? 0,
      pct_receita_sucesso: sucesso?.pct_receita_liquido ?? 0,
      pct_cliente_geral: pctDe(churn_qtd, clientes),
      pct_cliente_onboarding: onboarding?.pct_cliente ?? 0,
      pct_cliente_sucesso: sucesso?.pct_cliente ?? 0,
      meta_pct,
      meta_valor: (meta_pct / 100) * mrr_inicio,
      north_star: pct_receita_geral ? (meta_pct / pct_receita_geral) * 100 : 0,
    },
    por_setor: setorLinhas,
    por_qualificacao: {
      geral: bloco(cancelamentos),
      onboarding: bloco(doSetor("Onboarding")),
      sucesso: bloco(doSetor("Sucesso")),
    },
  };
}

/* ------------------------------- cron guard ------------------------------- */
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "churn-sheet-sync").eq("token", token).maybeSingle();
  return !!data;
}

/* ------------------------------- handler ------------------------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!(await chamadaDeCron(req, supabase))) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";
    const ano = Number(body?.ano) || ANO_PADRAO;

    if (action === "probe") {
      const bytes = await baixarXlsx();
      const sig = Array.from(bytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("");
      return json({ ok: true, bytes: bytes.length, assinatura: sig, is_xlsx: sig.startsWith("504b") });
    }

    const bytes = await baixarXlsx();
    const nomes = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames as string[];

    const nomeDados = acharAba(nomes, `DADOS ${ano}`);
    const nomeChurns = acharAba(nomes, `${ano} CHURNS`);
    const nomeDownsell = acharAba(nomes, `${ano} DOWNSELL`);
    const nomeUpsell = acharAba(nomes, `${ano} UPSELL`);
    const nomeReativacoes = acharAba(nomes, `${ano} REATIVAÇÕES`);

    const abas = lerAbas(bytes, [nomeDados, nomeChurns, nomeDownsell, nomeUpsell, nomeReativacoes]);
    const bases: Bases = {
      dados: abas[nomeDados],
      churns: abas[nomeChurns],
      downsell: abas[nomeDownsell],
      upsell: abas[nomeUpsell],
      reativacoes: abas[nomeReativacoes],
    };

    // Snapshot de recorrência: serve para (a) conferir a ponte entre as duas planilhas — o
    // "MRR início do mês" de M é a base fechada em M-1 — e (b) trazer o MRR por nível dessa
    // base, que é o denominador honesto do % de churn de cada nível.
    const { data: recorrencia } = await supabase
      .from("assinaturas_snapshot").select("competencia,mes_label,dados");
    const mrrRecorrencia = new Map<string, { label: string; mrr: number; mix: any[] }>();
    for (const r of recorrencia ?? []) {
      const mixCru = (r as any).dados?.mix_nivel;
      mrrRecorrencia.set(String(r.competencia).slice(0, 10), {
        label: r.mes_label,
        mrr: Number((r as any).dados?.kpis?.mrr_core ?? 0),
        // A recorrência chama o nível do topo de XG; a planilha de churn chama de GG.
        mix: Array.isArray(mixCru)
          ? mixCru.map((x: any) => {
              const nivel = String(x?.nivel ?? "").trim().toUpperCase();
              return {
                nivel: nivel === "XG" ? "GG" : nivel,
                clientes: Number(x?.clientes ?? 0),
                mrr: Number(x?.mrr ?? 0),
              };
            })
          : [],
      });
    }

    const hoje = new Date();
    const mesAtual = hoje.getUTCFullYear() === ano ? hoje.getUTCMonth() + 1 : 13;

    const alvo: number[] = body?.mes ? [Number(body.mes)] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const calculados = alvo.map((m) => calcularMes(m, ano, bases)).filter(Boolean) as NonNullable<
      ReturnType<typeof calcularMes>
    >[];

    if (action === "preview") {
      return json({
        abas_todas: nomes,
        abas_usadas: { nomeDados, nomeChurns, nomeDownsell, nomeUpsell, nomeReativacoes },
        meses: calculados.map((c) => ({
          competencia: c.competencia, mrr_inicio: c.base.mrr_inicio,
          cancelamentos: c.kpis.cancel_qtd, churn: c.kpis.churn_valor,
        })),
      });
    }

    const agora = new Date().toISOString();
    const processados: string[] = [];
    for (const c of calculados) {
      // Ponte com /assinaturas: a base do mês M é o snapshot de recorrência de M-1.
      const antAno = c.mes_num === 1 ? ano - 1 : ano;
      const antMes = c.mes_num === 1 ? 12 : c.mes_num - 1;
      const antComp = `${antAno}-${String(antMes).padStart(2, "0")}-01`;
      const ant = mrrRecorrencia.get(antComp);
      const diferenca = ant ? c.base.mrr_inicio - ant.mrr : null;

      const dados = {
        ...c,
        em_andamento: c.mes_num >= mesAtual,
        base: {
          ...c.base,
          snapshot_recorrencia: ant ? { competencia: antComp, mes_label: ant.label, mrr_core: ant.mrr } : null,
          // MRR e clientes por nível da base sobre a qual o churn do mês incidiu.
          mix_nivel: ant?.mix?.length ? ant.mix : null,
          // Tolerância de 1 real: os dois arquivos são alimentados por pessoas diferentes.
          conferencia: diferenca == null ? null : { diferenca, confere: Math.abs(diferenca) < 1 },
        },
      };

      const { error } = await supabase.from("churn_snapshot").upsert(
        { competencia: c.competencia, mes_label: c.mes_label, dados, sincronizado_em: agora, gerado_em: agora },
        { onConflict: "competencia" },
      );
      if (error) { console.error("upsert erro:", error.message); continue; }
      processados.push(c.mes_label);
    }

    return json({ ok: true, meses_processados: processados, total: processados.length });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const status = /autenticad|permiss/i.test(msg) ? 401 : 500;
    return json({ error: msg }, status);
  }
});
