// Edge Function: assinaturas-sheet-sync
// Lê a planilha de recorrência (Asaas) — um ARQUIVO EXCEL (.xlsx) hospedado no
// Google Drive, com uma aba por mês ("Junho 26", "Maio 26", …) — baixa o binário
// cru via Drive, parseia com SheetJS e grava um snapshot por competência em
// `assinaturas_snapshot`. A página /assinaturas só lê o snapshot.
//
// Por que baixar o .xlsx em vez de usar a API do Sheets: o arquivo é um Office file
// (Excel), e a API do Google Sheets recusa Office files ("must not be an Office
// file"). O Drive entrega o binário por `files/{id}?alt=media`.
//
// Cada aba: à esquerda a carteira (Nome … VALOR MENSAL, NÍVEL, TIPO DE PLANO); à
// direita (cols P..AB) um bloco de TOTAIS do time (#Clientes/%Perfil/$MRR/$TM/
// %Perfil Receita por nível + MRR, MRR Total, TM, Banestes, Aluguel). KPIs de
// cabeçalho e mix por nível saem desse bloco (fonte oficial); mix por plano e top
// contratos são computados da carteira. Insights de tendência: IA (Gemini) no mês
// mais recente.
//
// Ações (body.action): "sync" (default, backfill de todas as abas) · "preview"
// (lista as abas) · "probe" (testa só o download do binário do Drive).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON } from "../_shared/gemini.ts";

const FILE_ID = "110Vp0mA3r8OgGpODHxszllKIBsELSeqR";
// O arquivo é um .xlsx compartilhado por link no Drive — o endpoint público de
// download entrega o binário sem OAuth/conector. (Depende do compartilhamento
// "qualquer pessoa com o link" seguir ativo.)
const DOWNLOAD_URL = `https://drive.google.com/uc?export=download&id=${FILE_ID}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* ------------------------------- helpers ------------------------------- */
// Abas usam mês completo ("Junho 26") OU abreviado ("Abr 26", "Set 25").
const MESES: Record<string, number> = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4,
  maio: 5, mai: 5, junho: 6, jun: 6, julho: 7, jul: 7, agosto: 8, ago: 8,
  setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};
const MES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// Número no formato exibido da planilha: "R$ 1,080,613.29" → 1080613.29 ; "25.83%" → 25.83
function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).replace(/[R$\s%]/g, "").replace(/,/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
// Percentual que pode vir como fração (0.2583) ou já em pontos (25.83).
const pct = (v: unknown) => { const n = num(v); return n !== 0 && Math.abs(n) <= 1 ? n * 100 : n; };

function parseAba(title: string): { competencia: string; label: string; ord: number } | null {
  const m = semAcento(title.trim().toLowerCase()).match(/^([a-z]+)\s+(\d{2,4})$/);
  if (!m) return null;
  const mes = MESES[m[1]];
  if (!mes) return null;
  const yy = m[2].length === 2 ? 2000 + parseInt(m[2], 10) : parseInt(m[2], 10);
  return {
    competencia: `${yy}-${String(mes).padStart(2, "0")}-01`,
    label: `${MES_LABEL[mes - 1]} ${String(yy).slice(-2)}`,
    ord: yy * 100 + mes,
  };
}

// Linhas que NÃO são receita "core" de restaurante (Banestes, aluguéis de sala, repasses).
const NAO_CORE = /aluguel|banestes|repasse|concilia|sala takeat/i;

// Baixa o binário .xlsx do Drive pelo endpoint público de download (sem conector).
async function baixarXlsx(): Promise<Uint8Array> {
  const r = await fetch(DOWNLOAD_URL, { redirect: "follow" });
  if (!r.ok) throw new Error(`Drive [${r.status}] ao baixar o arquivo.`);
  const buf = new Uint8Array(await r.arrayBuffer());
  // Assinatura ZIP (PK) confirma que é um .xlsx; senão, veio HTML (login/sem acesso).
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    const amostra = new TextDecoder().decode(buf.slice(0, 160));
    throw new Error(`O arquivo não retornou um .xlsx — provavelmente o compartilhamento "por link" foi removido. Início: ${amostra}`);
  }
  return buf;
}

/* ------------------------- parsing de uma aba mensal ------------------------- */
function parseMes(rows: any[][]) {
  if (!rows || rows.length < 2) return null;

  const labelRow = (lab: string) =>
    rows.find((r) => String(r?.[16] ?? "").trim().toLowerCase() === lab.toLowerCase());
  const cl = labelRow("#Clientes");
  const perfil = labelRow("%Perfil");
  const mrrN = labelRow("$MRR");
  const tmN = labelRow("$TM");
  const perfilRec = labelRow("%Perfil Receita");

  const clients: {
    nome: string; forma_pagto: string; intervalo: string; dia_venc: string;
    descricao: string; valor_mensal: number; nivel: string; plano: string;
  }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const nome = String(r[0] ?? "").trim();
    const valor_mensal = num(r[12]);
    if (!nome || valor_mensal <= 0) continue;
    clients.push({
      nome,
      forma_pagto: String(r[3] ?? "").trim(),
      intervalo: String(r[5] ?? "").trim(),
      dia_venc: String(r[6] ?? "").trim(),
      descricao: String(r[7] ?? "").trim(),
      valor_mensal,
      nivel: String(r[13] ?? "").trim().toUpperCase(),
      plano: String(r[14] ?? "").trim(),
    });
  }
  // Exige o bloco oficial de totais (#Clientes). Abas antigas sem ele são puladas.
  if (!cl) return null;

  const NIVEIS = ["P", "M", "G", "XG"] as const;

  const mrr_core = cl ? num(cl[22]) : clients.filter((c) => !NAO_CORE.test(c.nome + c.descricao)).reduce((a, c) => a + c.valor_mensal, 0);
  const mrr_total = cl ? num(cl[23]) : clients.reduce((a, c) => a + c.valor_mensal, 0);
  const clientes_ativos = cl ? num(cl[21]) : clients.length;
  const ticket_medio = cl ? num(cl[24]) : (clientes_ativos ? mrr_core / clientes_ativos : 0);
  const ticket_medio_total = cl ? num(cl[25]) : (clientes_ativos ? mrr_total / clientes_ativos : 0);
  const mrr_banestes = cl ? num(cl[26]) : 0;
  const mrr_aluguel = cl ? num(cl[27]) : 0;

  const mix_nivel = NIVEIS.map((nivel, k) => {
    const col = 17 + k;
    const carteiraDoNivel = clients.filter((c) => c.nivel === nivel);
    const clientesN = cl ? num(cl[col]) : carteiraDoNivel.length;
    const mrrNivel = mrrN ? num(mrrN[col]) : carteiraDoNivel.reduce((a, c) => a + c.valor_mensal, 0);
    return {
      nivel,
      clientes: clientesN,
      perfil_pct: perfil ? pct(perfil[col]) : (clientes_ativos ? (clientesN / clientes_ativos) * 100 : 0),
      mrr: mrrNivel,
      tm: tmN ? num(tmN[col]) : (clientesN ? mrrNivel / clientesN : 0),
      receita_pct: perfilRec ? pct(perfilRec[col]) : (mrr_core ? (mrrNivel / mrr_core) * 100 : 0),
    };
  });

  const planoMap = new Map<string, { clientes: number; mrr: number }>();
  for (const c of clients) {
    const key = c.plano || "Adicionais / outros";
    const g = planoMap.get(key) ?? { clientes: 0, mrr: 0 };
    g.clientes += 1; g.mrr += c.valor_mensal;
    planoMap.set(key, g);
  }
  const mix_plano = Array.from(planoMap.entries())
    .map(([plano, v]) => ({ plano, ...v }))
    .sort((a, b) => b.mrr - a.mrr);

  const top_contratos = clients
    .filter((c) => !NAO_CORE.test(c.nome + " " + c.descricao))
    .sort((a, b) => b.valor_mensal - a.valor_mensal)
    .slice(0, 50)
    .map((c) => ({
      nome: c.nome, plano: c.plano, descricao: c.descricao, nivel: c.nivel,
      intervalo: c.intervalo, dia_venc: c.dia_venc, mrr: c.valor_mensal,
    }));

  return {
    kpis: {
      mrr_core, mrr_total, mrr_outras: mrr_total - mrr_core,
      clientes_ativos, ticket_medio, ticket_medio_total, mrr_banestes, mrr_aluguel,
    },
    mix_nivel, mix_plano, top_contratos, carteira_total: clients.length,
  };
}

// Lê UMA aba isolada como matriz de linhas. Reabre o workbook só com essa aba
// (sheets:[nome]) pra não materializar as 30 abas (~42MB) de uma vez — isso
// estoura a memória da edge function. sharedStrings é pequeno, então o custo é ok.
function lerAba(bytes: Uint8Array, nome: string): any[][] {
  const wb = XLSX.read(bytes, {
    type: "array", sheets: [nome],
    cellStyles: false, cellNF: false, cellHTML: false, bookVBA: false, sheetStubs: false,
  });
  const ws = wb.Sheets[nome];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "", raw: true }) as any[][];
}

/* ------------------------- insights de tendência (IA) ------------------------- */
async function gerarInsights(historico: { label: string; kpis: any }[]): Promise<any[] | null> {
  if (!Deno.env.get("GEMINI_API_KEY") || historico.length < 2) return null;
  const serie = historico.map((h) => ({
    mes: h.label,
    mrr_core: Math.round(h.kpis.mrr_core),
    clientes: h.kpis.clientes_ativos,
    ticket_medio: Math.round(h.kpis.ticket_medio),
    mrr_total: Math.round(h.kpis.mrr_total),
  }));
  try {
    const out = await generateJSON<{ insights: { tipo: string; texto: string }[] }>({
      temperature: 0.3,
      responseSchema: {
        type: "object",
        properties: {
          insights: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tipo: { type: "string", enum: ["positivo", "info", "atencao"] },
                texto: { type: "string" },
              },
              required: ["tipo", "texto"],
            },
          },
        },
        required: ["insights"],
      },
      messages: [
        {
          role: "system",
          content:
            "Você é analista financeiro da Takeat. Analise a evolução do MRR de recorrência (assinaturas de restaurantes) e gere EXATAMENTE 3 insights curtos e objetivos em pt-BR, cada um com no máximo 2 frases, citando números reais da série. " +
            "Use os tipos: 'positivo' (um avanço concreto), 'info' (um fato relevante de composição/estrutura) e 'atencao' (um ponto de alerta). Não invente dados fora da série.",
        },
        { role: "user", content: `Série mensal (mais antigo → mais recente):\n${JSON.stringify(serie, null, 2)}` },
      ],
    });
    return Array.isArray(out?.insights) ? out.insights.slice(0, 3) : null;
  } catch (_e) {
    return null;
  }
}

// Gera insights a partir dos snapshots JÁ no banco (não toca no xlsx) e salva no
// mês mais recente. Assim o passo de IA fica desacoplado do parsing pesado.
async function gerarInsightsDoBanco(supabase: any): Promise<any[] | null> {
  const { data } = await supabase
    .from("assinaturas_snapshot").select("competencia,mes_label,dados").order("competencia", { ascending: true });
  const historico = (data ?? []).map((r: any) => ({ competencia: r.competencia, label: r.mes_label, kpis: r.dados?.kpis ?? {} }));
  if (!historico.length) return null;
  const insights = await gerarInsights(historico);
  if (insights) {
    await supabase.from("assinaturas_snapshot").update({ insights }).eq("competencia", historico[historico.length - 1].competencia);
  }
  return insights;
}

/* ------------------------------- cron guard ------------------------------- */
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "assinaturas-sheet-sync").eq("token", token).maybeSingle();
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

    // PROBE: testa só o download do binário e mostra a assinatura (PK = zip/xlsx).
    if (action === "probe") {
      const bytes = await baixarXlsx();
      const sig = Array.from(bytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("");
      return json({ ok: true, bytes: bytes.length, assinatura: sig, is_xlsx: sig.startsWith("504b") });
    }

    // INSIGHTS: gera a partir dos snapshots já no banco (sem tocar no xlsx).
    if (action === "insights") {
      const insights = await gerarInsightsDoBanco(supabase);
      return json({ ok: true, insights_gerados: insights ? insights.length : 0 });
    }

    // Baixa e lê só os NOMES das abas (bookSheets — não materializa as células).
    const bytes = await baixarXlsx();
    const nomes = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;

    let abas = nomes
      .map((t) => ({ title: t, ...(parseAba(t) ?? {}) }))
      .filter((a): a is { title: string; competencia: string; label: string; ord: number } => !!(a as any).competencia)
      .sort((a, b) => a.ord - b.ord);

    if (action === "preview") {
      return json({ abas_todas: nomes, abas_mensais: abas.map((a) => ({ aba: a.title, competencia: a.competencia })) });
    }
    if (!abas.length) return json({ error: "Nenhuma aba mensal reconhecida.", abas_todas: nomes }, 422);

    // Alvos — 1 aba por chamada evita estourar a memória (o xlsx infla ~42MB por leitura):
    //   body.mes="2026-06" → só esse mês (usado no backfill, 1 chamada por mês)
    //   body.todos=true    → todos (pode estourar; evitar)
    //   default (cron)     → só o mês mais recente
    let alvo: typeof abas;
    if (body?.mes) alvo = abas.filter((a) => a.competencia === body.mes || a.competencia.slice(0, 7) === body.mes);
    else if (body?.todos === true) alvo = abas.slice(-18);
    else alvo = abas.slice(-1);

    const agora = new Date().toISOString();
    const processadas: string[] = [];
    for (const aba of alvo) {
      const parsed = parseMes(lerAba(bytes, aba.title));
      if (!parsed) continue;
      const dados = { competencia: aba.competencia, mes_label: aba.label, ...parsed };
      const { error } = await supabase.from("assinaturas_snapshot").upsert(
        { competencia: aba.competencia, mes_label: aba.label, dados, sincronizado_em: agora, gerado_em: agora },
        { onConflict: "competencia" },
      );
      if (error) { console.error("upsert erro:", error.message); continue; }
      processadas.push(aba.label);
    }

    // Regenera insights no run padrão (cron); no backfill por mês, pula (chamar action:"insights" ao final).
    let insights: any[] | null = null;
    if (!body?.mes && body?.todos !== true) insights = await gerarInsightsDoBanco(supabase);

    return json({
      ok: true,
      meses_processados: processadas,
      total: processadas.length,
      insights_gerados: insights ? insights.length : 0,
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const status = /autenticad|permiss/i.test(msg) ? 401 : 500;
    return json({ error: msg }, status);
  }
});
