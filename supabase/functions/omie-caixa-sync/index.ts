// Edge Function: omie-caixa-sync
// Monta o painel "Caixa" (panorama consolidado) a partir do Omie e grava um
// snapshot pronto em `omie_caixa_snapshot`. A página Caixa.tsx só lê o snapshot.
//
// Fonte única: financas/mf/ListarMovimentos (mesma base que a DRE/DFC já usam) +
// geral/contacorrente/ListarContasCorrentes (nomes/saldos das contas) +
// geral/categorias (descrições) + geral/clientes (nome dos fornecedores, sob demanda).
//
// Regime de CAIXA: tudo que tem data de PAGAMENTO/baixa é "realizado"; títulos em
// aberto com vencimento futuro são "projetados". Transferências entre contas
// próprias (origem TRAP) não contam como entrada/saída de resultado, mas afetam o
// saldo por conta.
//
// Ações (body.action):
//   "preview" → diagnóstico: contas correntes cru + amostra de movimento + status.
//   "sync"    → calcula todos os painéis e grava o snapshot (default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listarCategorias, listarMovimentos, omieCall } from "../_shared/omie.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* ------------------------------- helpers ------------------------------- */
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
function toNum(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
// Primeiro valor NÃO-zero entre candidatos (baixas trazem nValorTitulo=0).
function primeiroNum(...vs: unknown[]): number {
  for (const v of vs) { const n = Math.abs(toNum(v)); if (n > 0) return n; }
  return 0;
}
function limpa(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return !s || s === "0" || s === "-" ? null : s;
}
function parseOmieDate(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(String(s));
  return isNaN(d.getTime()) ? null : d;
}
function pickDate(det: any, keys: string[]): Date | null {
  for (const k of keys) { const d = parseOmieDate(det?.[k]); if (d) return d; }
  return null;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const ORIGENS_TRANSFERENCIA = new Set(["TRAP"]); // transferência entre contas próprias

// Data de caixa (realizado) e data de competência/vencimento (projetado).
const dataPagamento = (det: any): Date | null => pickDate(det, ["dDtPagamento", "dDtBaixa", "dDtCredito", "dDtConciliacao"]);
const dataVencimento = (det: any): Date | null => pickDate(det, ["dDtVencimento", "dDtPrevisao", "dDtEmissao", "dDtRegistro"]);

// Natureza: "R" (receber/entrada) vs "P"/"D" (pagar/saída).
const ehEntrada = (det: any) => {
  const n = norm(det?.cNatureza ?? det?.natureza ?? "R");
  return !(n.startsWith("P") || n.startsWith("D"));
};
// Valor total de um movimento (paga>documento>rateio).
function valorMov(mov: any): number {
  const det = mov?.detalhes ?? {}; const resumo = mov?.resumo ?? {};
  let v = primeiroNum(resumo.nValPago, resumo.nValLiquido, det.nValorTitulo, det.nValorMovimento, det.nValorDocumento, det.nValorBaixa);
  if (!v && Array.isArray(mov?.categorias)) v = Math.abs(mov.categorias.reduce((s: number, c: any) => s + toNum(c.nValor), 0));
  return v;
}
const valorAberto = (mov: any): number => {
  const det = mov?.detalhes ?? {}; const resumo = mov?.resumo ?? {};
  return primeiroNum(resumo.nValAberto, det.nValorTitulo, det.nSaldo, det.nValorMovimento) || valorMov(mov);
};

// Contas correntes do Omie: nCodCC → metadados. O Omie devolve `saldo_inicial` (o
// saldo NA data `saldo_data`), não o saldo vivo. Logo o saldo de hoje =
// saldo_inicial + Σ movimentos realizados a partir da saldo_data (calculado no sync).
type ContaInfo = { nome: string; banco: string; subtitulo: string; saldoInicial: number; saldoData: Date | null; tipo: string; inativo: boolean; naoFluxo: boolean };
async function listarContasCorrentes(): Promise<{ map: Map<string, ContaInfo>; raw: any }> {
  const map = new Map<string, ContaInfo>();
  let raw: any = null, pagina = 1, total = 1;
  do {
    const r = await omieCall<any>("geral/contacorrente", "ListarContasCorrentes", { pagina, registros_por_pagina: 100 });
    if (pagina === 1) raw = r;
    const arr = r?.ListarContasCorrentes ?? r?.conta_corrente_cadastro ?? r?.conta_corrente_lista ?? r?.cadastros ?? r?.contas ?? [];
    for (const c of arr) {
      const id = String(c.nCodCC ?? c.codigo ?? c.nCodConta ?? "");
      if (!id) continue;
      const ag = limpa(c.codigo_agencia ?? c.cCodAgencia ?? c.agencia);
      const cc = limpa(c.numero_conta_corrente ?? c.cNumConta ?? c.conta_corrente ?? c.conta);
      const subtitulo = [ag && `ag. ${ag}`, cc && `cc ${cc}`].filter(Boolean).join(" · ");
      map.set(id, {
        nome: String(c.descricao ?? c.cDescricao ?? c.nome ?? "").trim(),
        banco: String(c.codigo_banco ?? c.cCodBanco ?? c.banco ?? "").trim(),
        subtitulo,
        saldoInicial: toNum(c.saldo_inicial ?? c.nValSaldoInicial ?? c.valor_saldo_inicial ?? 0),
        saldoData: parseOmieDate(c.saldo_data ?? c.dDtSaldoInicial ?? null),
        tipo: String(c.tipo ?? c.tipo_conta_corrente ?? "").toUpperCase(),
        inativo: String(c.inativo ?? "N").toUpperCase() === "S",
        naoFluxo: String(c.nao_fluxo ?? "N").toUpperCase() === "S",
      });
    }
    total = Number(r?.total_de_paginas ?? r?.nTotPaginas ?? 1);
    pagina++;
  } while (pagina <= total && pagina <= 20);
  return { map, raw };
}

// Nome do fornecedor (Nome Fantasia > Razão Social) pelo código do cliente Omie.
async function consultarNomeCliente(cod: string): Promise<string | null> {
  try {
    const r = await omieCall<any>("geral/clientes", "ConsultarCliente", { codigo_cliente_omie: Number(cod) });
    const nome = String(r?.nome_fantasia || r?.razao_social || "").trim();
    return nome || null;
  } catch (_) { return null; }
}

// Chamada agendada (cron): o header `x-cron-token` precisa casar com a linha da
// tabela `internal_cron_tokens` (só service_role lê). Assim o agendamento diário
// dispara o sync SEM expor a service key e SEM afrouxar o requireUser para a anon key.
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "omie-caixa-sync").eq("token", token).maybeSingle();
  return !!data;
}

/* ------------------------------- handler ------------------------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (!(await chamadaDeCron(req, supabase))) await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";

    /* ---------------- PREVIEW (diagnóstico) ---------------- */
    if (action === "preview") {
      const contas = await listarContasCorrentes();
      const amostra = await listarMovimentos({ nRegPorPagina: 40 }, 1);
      // distribuição de status/natureza p/ calibrar a detecção de "realizado".
      const statusDist: Record<string, number> = {};
      for (const m of amostra) {
        const det = (m as any)?.detalhes ?? {};
        const k = `${det.cNatureza ?? "?"} | ${det.cStatus ?? det.cSituacao ?? det.status_titulo ?? "?"} | pago:${dataPagamento(det) ? "s" : "n"}`;
        statusDist[k] = (statusDist[k] ?? 0) + 1;
      }
      return json({
        ok: true,
        total_contas: contas.map.size,
        contas: [...contas.map.entries()].map(([ncodcc, v]) => ({ ncodcc, ...v })),
        contas_corrente_raw: contas.raw,
        amostra_movimento: amostra[0] ?? null,
        amostra_resumo: (amostra[0] as any)?.resumo ?? null,
        amostra_categorias: (amostra[0] as any)?.categorias ?? null,
        status_distribuicao: statusDist,
      });
    }

    /* ---------------- SYNC ---------------- */
    const agora = new Date();
    const hojeD = startOfDay(agora);

    // 1) Categorias: código → descrição.
    const categorias = await listarCategorias();
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), String(c.descricao ?? c.codigo));
    const descCategoria = (cod: unknown) => {
      const c = String(cod ?? "");
      return codToDesc.get(c) || c || "Sem categoria";
    };

    // 2) Contas correntes.
    const contasCC = await listarContasCorrentes();

    // 3) Movimentos (base única). Omie ignora filtro de data em algumas contas → traz tudo e filtra em memória.
    const movimentos = await listarMovimentos({});

    // 3a) Classifica cada movimento uma vez.
    type Mov = {
      det: any; entrada: boolean; transfer: boolean; ncodcc: string; valor: number; aberto: number;
      dPago: Date | null; dVenc: Date | null; catCod: string; catDesc: string; codCliente: string | null; cnpj: string | null;
      categorias: { cod: string; desc: string; valor: number }[];
    };
    const movs: Mov[] = [];
    for (const mov of movimentos) {
      const det = (mov as any)?.detalhes ?? {};
      const transfer = ORIGENS_TRANSFERENCIA.has(norm(det.cOrigem));
      const cats = (Array.isArray((mov as any)?.categorias) && (mov as any).categorias.length
        ? (mov as any).categorias
        : [{ cCodCateg: det.cCodCateg, nValor: valorMov(mov) }]
      ).map((c: any) => ({ cod: String(c.cCodCateg ?? ""), desc: descCategoria(c.cCodCateg), valor: Math.abs(toNum(c.nValor)) }));
      movs.push({
        det,
        entrada: ehEntrada(det),
        transfer,
        ncodcc: String(det.nCodCC ?? ""),
        valor: valorMov(mov),
        aberto: valorAberto(mov),
        dPago: dataPagamento(det),
        dVenc: dataVencimento(det),
        catCod: String(det.cCodCateg ?? ""),
        catDesc: descCategoria(det.cCodCateg),
        codCliente: limpa(det.nCodCliente),
        cnpj: limpa(det.cCPFCNPJCliente ?? det.cCpfCnpjCliente ?? det.cCPFCNPJ),
        categorias: cats,
      });
    }

    // 4) Saldo por conta = última posição CONCILIADA do Omie (saldo_inicial na saldo_data)
    //    + ajuste manual do time (omie_caixa_conta.saldo_inicial, default 0).
    //    OBS: o Omie NÃO expõe saldo "vivo" — cadastro/resumo só dão saldo_inicial@saldo_data.
    //    Somar os TÍTULOS (ListarMovimentos) daria saldo errado p/ contas de aplicação e
    //    transferência (o dinheiro entra/sai por lançamentos de conta corrente, não por título).
    //    Saldo vivo exigiria varrer o ledger (ListarLancCC) por conta — fica p/ evolução.
    const { data: contasCfg } = await supabase.from("omie_caixa_conta").select("ncodcc,saldo_inicial,nome_exibicao,subtitulo,ordem,incluir");
    const cfgByCC = new Map<string, any>();
    for (const c of (contasCfg ?? []) as any[]) cfgByCC.set(String(c.ncodcc), c);

    const contasOut: { ncodcc: string; nome: string; banco: string; subtitulo: string; saldo: number; saldo_data: string | null; incluir: boolean; ordem: number }[] = [];
    for (const [ncodcc, info] of contasCC.map.entries()) {
      const cfg = cfgByCC.get(ncodcc);
      const ajusteManual = cfg ? toNum(cfg.saldo_inicial) : 0;
      const saldo = info.saldoInicial + ajusteManual;
      contasOut.push({
        ncodcc,
        nome: (cfg?.nome_exibicao || info.nome || `Conta ${ncodcc}`).trim(),
        banco: info.banco,
        subtitulo: (cfg?.subtitulo || info.subtitulo || "").trim(),
        saldo,
        saldo_data: info.saldoData ? iso(info.saldoData) : null,
        // conta nova: por padrão só entra no consolidado se for ativa e conta de fluxo.
        incluir: cfg ? cfg.incluir !== false : (!info.inativo && !info.naoFluxo),
        ordem: cfg ? Number(cfg.ordem ?? 100) : 100,
      });
    }
    contasOut.sort((a, b) => a.ordem - b.ordem || b.saldo - a.saldo);
    const saldoConsolidado = contasOut.filter((c) => c.incluir).reduce((s, c) => s + c.saldo, 0);
    const contasComPct = contasOut.map((c) => ({ ...c, pct: saldoConsolidado ? (c.saldo / saldoConsolidado) * 100 : 0 }));

    // 5) Persistência das contas (upsert nome/banco/subtitulo/saldo; preserva metadados do time).
    for (const c of contasOut) {
      const existe = cfgByCC.has(c.ncodcc);
      if (existe) {
        await supabase.from("omie_caixa_conta").update({
          banco: c.banco, nome: contasCC.map.get(c.ncodcc)?.nome ?? c.nome, saldo: c.saldo, atualizado_em: agora.toISOString(),
        }).eq("ncodcc", c.ncodcc);
      } else {
        await supabase.from("omie_caixa_conta").insert({
          ncodcc: c.ncodcc, banco: c.banco, nome: c.nome, subtitulo: c.subtitulo, saldo: c.saldo,
        });
      }
    }

    // 6) Média diária dos últimos 30 dias (realizado, exclui transferências).
    const ini30 = addDays(hojeD, -30);
    let som30Ent = 0, som30Sai = 0;
    for (const m of movs) {
      if (m.transfer || !m.dPago) continue;
      if (m.dPago >= ini30 && m.dPago <= agora) { if (m.entrada) som30Ent += m.valor; else som30Sai += m.valor; }
    }
    const media30Ent = som30Ent / 30, media30Sai = som30Sai / 30;

    // 7) Janelas (hoje / semana / mês) — realizado dentro do intervalo.
    const janelas: Record<string, { de: Date; ate: Date; dias: number }> = {
      ontem: { de: addDays(hojeD, -1), ate: new Date(hojeD.getTime() - 1), dias: 1 },
      hoje: { de: hojeD, ate: agora, dias: 1 },
      semana: { de: addDays(hojeD, -6), ate: agora, dias: 7 },
      mes: { de: new Date(agora.getFullYear(), agora.getMonth(), 1), ate: agora, dias: agora.getDate() },
    };

    // resolve nomes de fornecedor só para os movimentos que a UI mostra (limite p/ não estourar tempo).
    const codParaNome = new Set<string>();
    const coletaCods = (m: Mov) => { if (m.codCliente && m.codCliente !== "0") codParaNome.add(m.codCliente); };
    const dentro = (d: Date | null, de: Date, ate: Date) => !!d && d >= de && d <= ate;

    const ini31 = addDays(hojeD, -31);
    for (const m of movs) {
      if (m.transfer) continue;
      if (!m.entrada && m.dPago && m.dPago >= ini31 && m.dPago <= agora) coletaCods(m); // saídas recentes (fornecedores: ontem/hoje/semana/mês)
      if (!m.dPago && m.dVenc && m.dVenc >= hojeD && m.dVenc <= addDays(hojeD, 30)) coletaCods(m); // contas a pagar próximas
    }
    const nomePorCod = new Map<string, string>();
    const cods = [...codParaNome].slice(0, 120);
    const CN = 4;
    for (let i = 0; i < cods.length; i += CN) {
      await Promise.all(cods.slice(i, i + CN).map(async (cod) => { const n = await consultarNomeCliente(cod); if (n) nomePorCod.set(cod, n); }));
    }
    const nomeFornecedor = (m: Mov) =>
      (m.codCliente && nomePorCod.get(m.codCliente)) || limpa(m.det.cNomeCliente) || (m.cnpj ? m.cnpj : null) || m.catDesc || "—";

    function computeWindow(de: Date, ate: Date, dias: number) {
      let entradas = 0, saidas = 0, nRec = 0, nPag = 0;
      const catMap = new Map<string, number>();
      const fornMap = new Map<string, { nome: string; categoria: string; valor: number }>();
      const movimentacoes: any[] = [];
      for (const m of movs) {
        if (m.transfer || !dentro(m.dPago, de, ate)) continue;
        if (m.entrada) { entradas += m.valor; nRec++; } else { saidas += m.valor; nPag++; }
        if (!m.entrada) {
          for (const c of m.categorias) catMap.set(c.desc, (catMap.get(c.desc) ?? 0) + (c.valor || 0));
          const fk = m.codCliente ?? m.catDesc;
          const nome = nomeFornecedor(m);
          const cur = fornMap.get(fk) ?? { nome, categoria: m.catDesc, valor: 0 };
          cur.valor += m.valor; fornMap.set(fk, cur);
        }
        // Junta TODAS as movimentações da janela; o corte para as 60 maiores é feito
        // depois do sort. (Antes cortávamos em 60 DURANTE a iteração, na ordem crua do
        // Omie — que traz os salários primeiro —, então os grandes pagamentos de
        // fornecedor nem entravam na lista e sobrava só "Pessoal" caindo na categoria.)
        movimentacoes.push({
          data: m.dPago ? iso(m.dPago) : null,
          descricao: nomeFornecedor(m),  // nome do fornecedor (não a categoria — evita redundância com a coluna Categoria)
          categoria: m.catDesc,
          conta: contasCC.map.get(m.ncodcc)?.nome ?? "",
          valor: m.valor,
          natureza: m.entrada ? "entrada" : "saida",
        });
      }
      const totalSai = saidas || 1;
      const gastos_categoria = [...catMap.entries()].map(([nome, valor]) => ({ nome, valor, pct: (valor / totalSai) * 100 }))
        .sort((a, b) => b.valor - a.valor);
      const top = gastos_categoria.slice(0, 5);
      const restoVal = gastos_categoria.slice(5).reduce((s, c) => s + c.valor, 0);
      if (restoVal > 0) top.push({ nome: "Outros", valor: restoVal, pct: (restoVal / totalSai) * 100 });
      const fornecedores = [...fornMap.values()].sort((a, b) => b.valor - a.valor).slice(0, 5);
      movimentacoes.sort((a, b) => b.valor - a.valor);
      // guarda até 400 (as maiores) para o modal de "ver tudo"; a UI mostra as 60 primeiras inline.
      const movimentacoesTop = movimentacoes.slice(0, 400);

      const mediaEntJanela = media30Ent * dias, mediaSaiJanela = media30Sai * dias;
      return {
        entradas, saidas, resultado: entradas - saidas, n_recebimentos: nRec, n_pagamentos: nPag,
        entradas_vs_media: mediaEntJanela ? ((entradas - mediaEntJanela) / mediaEntJanela) * 100 : 0,
        saidas_vs_media: mediaSaiJanela ? ((saidas - mediaSaiJanela) / mediaSaiJanela) * 100 : 0,
        entradas_pct_fluxo: entradas + saidas ? (entradas / (entradas + saidas)) * 100 : 0,
        liquido_pct: saidas ? ((entradas - saidas) / saidas) * 100 : 0,
        gastos_categoria: top,
        fornecedores,
        movimentacoes: movimentacoesTop,
        mov_total: nRec + nPag,
      };
    }

    const periodos = {
      ontem: computeWindow(janelas.ontem.de, janelas.ontem.ate, janelas.ontem.dias),
      hoje: computeWindow(janelas.hoje.de, janelas.hoje.ate, janelas.hoje.dias),
      semana: computeWindow(janelas.semana.de, janelas.semana.ate, janelas.semana.dias),
      mes: computeWindow(janelas.mes.de, janelas.mes.ate, janelas.mes.dias),
    };

    // 8) Contas a pagar próximas (30 dias, em aberto).
    const cap: { data: string; descricao: string; categoria: string; valor: number; dias: number }[] = [];
    for (const m of movs) {
      if (m.entrada || m.dPago || m.transfer || !m.dVenc) continue;
      if (m.dVenc >= hojeD && m.dVenc <= addDays(hojeD, 30)) {
        const dias = Math.round((startOfDay(m.dVenc).getTime() - hojeD.getTime()) / 86400000);
        cap.push({ data: iso(m.dVenc), descricao: nomeFornecedor(m), categoria: m.catDesc, valor: m.aberto, dias });
      }
    }
    cap.sort((a, b) => a.data.localeCompare(b.data) || b.valor - a.valor);
    const contas_a_pagar = { total: cap.reduce((s, c) => s + c.valor, 0), itens: cap.slice(0, 30) };

    // 9) Calendário do mês corrente (realizado + projeção de pagamentos).
    const ano = agora.getFullYear(), mesIdx = agora.getMonth();
    const diasNoMes = new Date(ano, mesIdx + 1, 0).getDate();
    const calDias: Record<number, { entradas: number; saidas: number; projetado: number }> = {};
    for (let d = 1; d <= diasNoMes; d++) calDias[d] = { entradas: 0, saidas: 0, projetado: 0 };
    for (const m of movs) {
      if (m.transfer) continue;
      if (m.dPago && m.dPago.getFullYear() === ano && m.dPago.getMonth() === mesIdx) {
        if (m.entrada) calDias[m.dPago.getDate()].entradas += m.valor; else calDias[m.dPago.getDate()].saidas += m.valor;
      } else if (!m.dPago && !m.entrada && m.dVenc && m.dVenc.getFullYear() === ano && m.dVenc.getMonth() === mesIdx && m.dVenc >= hojeD) {
        calDias[m.dVenc.getDate()].projetado += m.aberto;
      }
    }
    const calendario = {
      ano, mes: mesIdx, hoje: agora.getDate(),
      dias: Object.entries(calDias).map(([dia, v]) => ({
        dia: Number(dia),
        realizado: v.entradas > 0 || v.saidas > 0,
        tem_projetado: v.projetado > 0,
        entradas: v.entradas, saidas: v.saidas, projetado: v.projetado,
      })),
    };

    // 10) Fluxo de caixa projetado (próximos 30 dias) a partir do saldo atual.
    const projDias = 30;
    const entAberto: number[] = new Array(projDias + 1).fill(0);
    const saiAberto: number[] = new Array(projDias + 1).fill(0);
    for (const m of movs) {
      if (m.dPago || m.transfer || !m.dVenc) continue;
      const off = Math.round((startOfDay(m.dVenc).getTime() - hojeD.getTime()) / 86400000);
      if (off >= 0 && off <= projDias) { if (m.entrada) entAberto[off] += m.aberto; else saiAberto[off] += m.aberto; }
    }
    let saldoRun = saldoConsolidado;
    const pontos: { data: string; saldo: number; entradas: number; saidas: number }[] = [];
    for (let off = 0; off <= projDias; off++) {
      saldoRun += entAberto[off] - saiAberto[off];
      pontos.push({ data: iso(addDays(hojeD, off)), saldo: saldoRun, entradas: entAberto[off], saidas: saiAberto[off] });
    }
    const menor = pontos.reduce((min, p) => (p.saldo < min.saldo ? p : min), pontos[0]);
    const maiorDesembolso = pontos.reduce((mx, p) => (p.saidas > mx.saidas ? p : mx), pontos[0]);
    const fluxo_projetado = {
      menor: { valor: menor.saldo, data: menor.data },
      maior_desembolso: { valor: maiorDesembolso.saidas, data: maiorDesembolso.data },
      saldo_final: pontos[pontos.length - 1],
      saldo_atual: saldoConsolidado,
      pontos,
    };

    const dados = {
      sincronizado_em: agora.toISOString(),
      saldo_consolidado: saldoConsolidado,
      saldo_delta_periodo: periodos.mes.resultado,
      n_contas: contasComPct.filter((c) => c.incluir).length,
      contas: contasComPct,
      periodos,
      contas_a_pagar,
      calendario,
      fluxo_projetado,
      movimentos_lidos: movimentos.length,
    };

    const { error: insErr } = await supabase.from("omie_caixa_snapshot").insert({ dados, sincronizado_em: agora.toISOString() });
    if (insErr) throw insErr;

    // mantém só os 20 snapshots mais recentes
    const { data: antigos } = await supabase.from("omie_caixa_snapshot").select("id").order("gerado_em", { ascending: false }).range(20, 999);
    if (antigos && antigos.length) await supabase.from("omie_caixa_snapshot").delete().in("id", (antigos as any[]).map((r) => r.id));

    return json({
      ok: true,
      movimentos: movimentos.length,
      contas: contasComPct.length,
      saldo_consolidado: saldoConsolidado,
      contas_a_pagar_total: contas_a_pagar.total,
      hoje: { entradas: periodos.hoje.entradas, saidas: periodos.hoje.saidas, resultado: periodos.hoje.resultado },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-caixa-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
