// Edge Function: omie-caixa-sync
// Monta o painel "Caixa" (panorama consolidado) a partir do Omie e grava um
// snapshot pronto em `omie_caixa_snapshot`. A página Caixa.tsx só lê o snapshot.
//
// Fonte única: financas/mf/ListarMovimentos (mesma base que a DRE/DFC já usam) +
// geral/contacorrente/ListarContasCorrentes (nomes/saldos das contas) +
// geral/categorias (descrições) + geral/clientes (nome dos fornecedores, sob demanda).
//
// Regime de CAIXA: tudo que tem data de PAGAMENTO/baixa é "realizado"; títulos em
// aberto com vencimento futuro são "projetados". Transferências entre contas próprias
// (detectadas por origem TRAP/TRAR ou por categoria de transferência) não contam como
// entrada/saída de resultado. O saldo por conta vem da posição conciliada do Omie
// (saldo_inicial@saldo_data), não de somar movimentos.
//
// Ações (body.action):
//   "preview" → diagnóstico: contas correntes cru + amostra de movimento + status.
//   "sync"    → calcula todos os painéis e grava o snapshot (default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listarCategorias, listarMovimentos, omieCall } from "../_shared/omie.ts";
import { lerMovimentos, lerCategorias } from "../_shared/omie-cache.ts";
import { requireUser } from "../_shared/auth.ts";
import { asaasGet, asaasList } from "../_shared/asaas.ts";

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

// Transferências entre contas próprias — só trocam de bolso, não entram no resultado de caixa.
// Por ORIGEM: a transferência nativa do Omie gera um par TRAP (saída) + TRAR (entrada).
const ORIGENS_TRANSFERENCIA = new Set(["TRAP", "TRAR"]);
// Por CATEGORIA: lançamentos manuais classificados como transferência têm origens comuns
// (MANR/BAXR/MANP/BAXP), indistinguíveis de um recebimento/pagamento real — então só dá para
// pegá-los pelo código da categoria no plano de contas do Omie. Se criarem novas categorias
// de transferência, incluir os códigos aqui.
const CATEGORIAS_TRANSFERENCIA = new Set(["0.01", "0.01.01", "0.01.02", "1.04.94", "2.10.96"]);

// Contas Asaas no Omie (Disponível + Pago). No CALENDÁRIO, os lançamentos dessas contas
// vêm do extrato REAL do Asaas (financialTransactions), não do Omie (que fica defasado) —
// por isso as movimentações do Omie dessas contas ficam FORA do calendário, para não duplicar.
const ASAAS_NCODCC = new Set(["5460455582", "5471927663"]);

// "Caixa recebido" (a ENTRADA dos relatórios) = só as contas onde o dinheiro realmente cai:
// Sicoob - Conta Corrente (pelo Omie) + Asaas Disponível (pelo extrato do Asaas). A saída dos
// relatórios continua sendo de todas as contas; isto afeta apenas o campo `recebido` do dia.
const RECEBIDO_NCODCC = new Set(["5455988727"]); // Sicoob - Conta Corrente

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
// Fallback: quando o movimento não traz o código do cliente (só o CNPJ/CPF do documento),
// acha o cadastro pelo CNPJ/CPF — mesmo recurso usado no omie-pix-sync.
async function consultarNomePorCnpj(cnpj: string): Promise<string | null> {
  try {
    const r = await omieCall<any>("geral/clientes", "ListarClientes", {
      pagina: 1, registros_por_pagina: 5, apenas_importado_api: "N", clientesFiltro: { cnpj_cpf: cnpj },
    });
    const c = (r?.clientes_cadastro ?? [])[0];
    const nome = String(c?.nome_fantasia || c?.razao_social || "").trim();
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
    const forcar = body?.atualizar === true; // força buscar do Omie; senão usa o cache

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
      // Sonda do extrato do Asaas (financialTransactions): tipos distintos + amostra + volume,
      // para calibrar a integração do extrato no calendário. Não grava nada.
      let asaasProbe: any = null;
      try {
        const hj = new Date();
        const de = new Date(hj.getFullYear(), hj.getMonth() - 1, 1);
        const ft = await asaasGet<any>("/financialTransactions", {
          startDate: iso(de), finishDate: iso(hj), offset: 0, limit: 20,
        });
        const tipos: Record<string, number> = {};
        for (const t of (ft?.data ?? [])) tipos[String(t.type)] = (tipos[String(t.type)] ?? 0) + 1;
        asaasProbe = { totalCount: ft?.totalCount, hasMore: ft?.hasMore, tipos, amostra: (ft?.data ?? []).slice(0, 6) };
      } catch (e) {
        asaasProbe = { erro: e instanceof Error ? e.message : String(e) };
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
        asaas_probe: asaasProbe,
      });
    }

    /* ---------------- SYNC ---------------- */
    const agora = new Date();
    const hojeD = startOfDay(agora);

    // 1) Categorias: código → descrição (via cache compartilhado).
    const { dados: categorias } = await lerCategorias(supabase, { forcar });
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), String(c.descricao ?? c.codigo));
    const descCategoria = (cod: unknown) => {
      const c = String(cod ?? "");
      return codToDesc.get(c) || c || "Sem categoria";
    };

    // 2) Contas correntes.
    const contasCC = await listarContasCorrentes();

    // 3) Movimentos (base única) — via cache compartilhado (_shared/omie-cache.ts).
    // Sem `atualizar`, reaproveita o último pull do Omie; com `atualizar:true`, refaz.
    const { dados: movimentosBrutos } = await lerMovimentos(supabase, { forcar });

    // 3b) Dedup por título: todo título JÁ BAIXADO/CONCILIADO gera DOIS registros no
    // ListarMovimentos com o MESMO nCodTitulo — um do "título" (cGrupo CONTA_A_RECEBER/
    // PAGAR, com nValorTitulo) e outro da "baixa/conciliação" (cGrupo CONTA_CORRENTE_REC/
    // PAG, com nValorMovCC), ambos com a MESMA dDtPagamento. Sem deduplicar, todo valor
    // realizado entra em DOBRO (confirmado via diagnóstico: 2.834 de 4.926 títulos duplicados
    // em julho/2026 — ~57% do volume). Mesmo padrão já tratado no omie-pix-sync.
    // Mescla os detalhes (união dos campos; o primeiro registro visto prevalece, o(s)
    // seguinte(s) só preenchem o que faltar) para não perder nenhum campo de nenhum dos dois.
    // nCodTitulo=0/ausente NUNCA é usado como chave (senão juntaria lançamentos sem título
    // nenhum em relação um ao outro) — cada um desses vira uma linha própria e única.
    const porTitulo = new Map<string, any>();
    let semTitulo = 0;
    for (const mov of movimentosBrutos) {
      const det = (mov as any)?.detalhes ?? {};
      const idRaw = String(det?.nCodTitulo ?? det?.cCodIntTitulo ?? "").trim();
      const id = (!idRaw || idRaw === "0") ? `__semid_${semTitulo++}` : idRaw;
      const existente = porTitulo.get(id);
      if (!existente) { porTitulo.set(id, mov); continue; }
      const detExist = (existente as any)?.detalhes ?? {};
      porTitulo.set(id, {
        ...existente,
        detalhes: { ...det, ...detExist },
        resumo: (existente as any)?.resumo ?? (mov as any)?.resumo ?? null,
        categorias: (Array.isArray((existente as any)?.categorias) && (existente as any).categorias.length)
          ? (existente as any).categorias : ((mov as any)?.categorias ?? null),
      });
    }
    const movimentos = [...porTitulo.values()];

    // 3a) Classifica cada movimento uma vez.
    type Mov = {
      det: any; entrada: boolean; transfer: boolean; ncodcc: string; valor: number; aberto: number;
      dPago: Date | null; dVenc: Date | null; catCod: string; catDesc: string; codCliente: string | null; cnpj: string | null;
      categorias: { cod: string; desc: string; valor: number }[];
    };
    const movs: Mov[] = [];
    for (const mov of movimentos) {
      const det = (mov as any)?.detalhes ?? {};
      const cats = (Array.isArray((mov as any)?.categorias) && (mov as any).categorias.length
        ? (mov as any).categorias
        : [{ cCodCateg: det.cCodCateg, nValor: valorMov(mov) }]
      ).map((c: any) => ({ cod: String(c.cCodCateg ?? ""), desc: descCategoria(c.cCodCateg), valor: Math.abs(toNum(c.nValor)) }));
      // É transferência se a origem for de transferência (TRAP/TRAR nativas) OU se a categoria
      // (no cabeçalho ou em qualquer rateio) for uma categoria de transferência.
      const transfer = ORIGENS_TRANSFERENCIA.has(norm(det.cOrigem))
        || CATEGORIAS_TRANSFERENCIA.has(String(det.cCodCateg ?? ""))
        || cats.some((c: { cod: string }) => CATEGORIAS_TRANSFERENCIA.has(c.cod));
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

    // Saldo AO VIVO do Asaas (saldo disponível, GET /finance/balance) — sobrescreve a posição
    // conciliada do Omie SÓ para a conta "ASAAS Disponível", que fica sempre defasada no Omie.
    // Se a API do Asaas falhar (chave ausente, indisponível), mantém o valor do Omie e segue.
    let asaasSaldo: number | null = null;
    try {
      const bal = await asaasGet<{ balance?: number }>("/finance/balance");
      if (bal && typeof bal.balance === "number") asaasSaldo = bal.balance;
    } catch (e) {
      console.warn("omie-caixa-sync: saldo do Asaas indisponível, mantendo o do Omie:", e instanceof Error ? e.message : String(e));
    }
    const ehAsaasDisponivel = (nome: unknown) => { const n = norm(nome); return n.includes("ASAAS") && n.includes("DISPON"); };

    const contasOut: { ncodcc: string; nome: string; banco: string; subtitulo: string; saldo: number; saldo_data: string | null; incluir: boolean; ordem: number }[] = [];
    for (const [ncodcc, info] of contasCC.map.entries()) {
      const cfg = cfgByCC.get(ncodcc);
      const ajusteManual = cfg ? toNum(cfg.saldo_inicial) : 0;
      const nome = (cfg?.nome_exibicao || info.nome || `Conta ${ncodcc}`).trim();
      // Asaas ao vivo tem prioridade sobre a posição conciliada + ajuste manual do Omie.
      const usaAsaas = asaasSaldo != null && (ehAsaasDisponivel(info.nome) || ehAsaasDisponivel(nome));
      const saldo = usaAsaas ? asaasSaldo! : info.saldoInicial + ajusteManual;
      contasOut.push({
        ncodcc,
        nome,
        banco: info.banco,
        subtitulo: (cfg?.subtitulo || info.subtitulo || "").trim(),
        saldo,
        // conta Asaas: a posição é de AGORA (ao vivo); demais, a data conciliada do Omie.
        saldo_data: usaAsaas ? iso(hojeD) : (info.saldoData ? iso(info.saldoData) : null),
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

    // Nome do fornecedor é resolvido DEPOIS (ver "resolve nomes" abaixo) — aqui só se
    // monta a estrutura com os identificadores brutos (codCliente/cnpj/categoria/nome direto
    // do movimento, quando houver). Motivo: resolver nome por código/CNPJ é uma chamada à API
    // do Omie por item, e um mês tem centenas de fornecedores distintos — resolver todos de
    // antemão (como antes) exige um corte arbitrário (ex.: só os 120 primeiros na ordem crua
    // do Omie), e o corte podia pular exatamente os fornecedores que aparecem no Top 5 ou nas
    // movimentações exibidas. Resolvendo só o que a UI realmente mostra (após agregar as 4
    // janelas), o conjunto de nomes a buscar fica pequeno e SEMPRE cobre o que é exibido.
    const dentro = (d: Date | null, de: Date, ate: Date) => !!d && d >= de && d <= ate;
    type Identificado = { codCliente: string | null; cnpj: string | null; catDesc: string; nomeDireto: string | null };
    const identDe = (m: Mov): Identificado =>
      ({ codCliente: m.codCliente, cnpj: m.cnpj, catDesc: m.catDesc, nomeDireto: limpa(m.det.cNomeCliente) });

    function computeWindow(de: Date, ate: Date, dias: number) {
      let entradas = 0, saidas = 0, nRec = 0, nPag = 0;
      const catMap = new Map<string, number>();
      // Agrupa por CNPJ/CPF quando não há código de cliente — antes agrupava por CATEGORIA
      // nesse caso, o que juntava fornecedores DIFERENTES (sem código, mesma categoria) numa
      // única linha somada (mesma classe de bug da duplicata de título: chave errada de junção).
      const fornMap = new Map<string, Identificado & { valor: number }>();
      const movimentacoes: (Identificado & { data: string | null; categoria: string; conta: string; valor: number; natureza: string })[] = [];
      for (const m of movs) {
        if (m.transfer || !dentro(m.dPago, de, ate)) continue;
        if (m.entrada) { entradas += m.valor; nRec++; } else { saidas += m.valor; nPag++; }
        if (!m.entrada) {
          for (const c of m.categorias) catMap.set(c.desc, (catMap.get(c.desc) ?? 0) + (c.valor || 0));
          const ident = identDe(m);
          const fk = m.codCliente ?? m.cnpj ?? m.catDesc;
          const cur = fornMap.get(fk) ?? { ...ident, valor: 0 };
          cur.valor += m.valor; fornMap.set(fk, cur);
        }
        // Junta TODAS as movimentações da janela; o corte para as 60 maiores é feito
        // depois do sort. (Antes cortávamos em 60 DURANTE a iteração, na ordem crua do
        // Omie — que traz os salários primeiro —, então os grandes pagamentos de
        // fornecedor nem entravam na lista e sobrava só "Pessoal" caindo na categoria.)
        movimentacoes.push({
          ...identDe(m),
          data: m.dPago ? iso(m.dPago) : null,
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
      // Corta pelas 400 MAIORES (por valor) primeiro — só para limitar o payload em janelas
      // com muitos lançamentos, sem descartar os grandes pagamentos por causa da ordem crua
      // do Omie. A exibição em si (aqui e na UI) é por DATA, mais recente primeiro.
      const movimentacoesTop = [...movimentacoes]
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 400)
        .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));

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
    const cap: (Identificado & { data: string; valor: number; dias: number })[] = [];
    for (const m of movs) {
      if (m.entrada || m.dPago || m.transfer || !m.dVenc) continue;
      if (m.dVenc >= hojeD && m.dVenc <= addDays(hojeD, 30)) {
        const dias = Math.round((startOfDay(m.dVenc).getTime() - hojeD.getTime()) / 86400000);
        cap.push({ ...identDe(m), data: iso(m.dVenc), valor: m.aberto, dias });
      }
    }
    cap.sort((a, b) => a.data.localeCompare(b.data) || b.valor - a.valor);
    const capTop = cap.slice(0, 30);

    // resolve nomes de fornecedor SÓ para o que aparece nas listas acima (Top 5 fornecedores +
    // movimentações de cada janela + contas a pagar) — nunca "todo o mês", então o conjunto é
    // pequeno e cobre exatamente o que a UI mostra. Se não há código de cliente, busca pelo
    // CNPJ/CPF (mesmo recurso do omie-pix-sync) — antes disso o fallback era mostrar o
    // CNPJ/CPF cru (ilegível).
    const codsNecessarios = new Set<string>();
    const cnpjsNecessarios = new Set<string>();
    const registrar = (id: Identificado) => {
      if (id.nomeDireto) return; // já tem nome legível, não precisa de API
      if (id.codCliente) codsNecessarios.add(id.codCliente);
      else if (id.cnpj) cnpjsNecessarios.add(id.cnpj);
    };
    for (const janela of Object.values(periodos)) {
      for (const f of janela.fornecedores) registrar(f);
      for (const mv of janela.movimentacoes) registrar(mv);
    }
    for (const c of capTop) registrar(c);

    const nomePorCod = new Map<string, string>();
    const nomePorCnpj = new Map<string, string>();
    const CN = 4;
    const cods = [...codsNecessarios];
    for (let i = 0; i < cods.length; i += CN) {
      await Promise.all(cods.slice(i, i + CN).map(async (cod) => { const n = await consultarNomeCliente(cod); if (n) nomePorCod.set(cod, n); }));
    }
    const cnpjs = [...cnpjsNecessarios];
    for (let i = 0; i < cnpjs.length; i += CN) {
      await Promise.all(cnpjs.slice(i, i + CN).map(async (cnpj) => { const n = await consultarNomePorCnpj(cnpj); if (n) nomePorCnpj.set(cnpj, n); }));
    }
    const nomeDe = (id: Identificado) =>
      id.nomeDireto || (id.codCliente && nomePorCod.get(id.codCliente)) || (id.cnpj && nomePorCnpj.get(id.cnpj)) || id.cnpj || id.catDesc || "—";

    for (const janela of Object.values(periodos)) {
      (janela as any).fornecedores = janela.fornecedores.map((f: any) => ({ nome: nomeDe(f), categoria: f.catDesc, valor: f.valor }));
      (janela as any).movimentacoes = janela.movimentacoes.map((mv: any) => ({
        data: mv.data, descricao: nomeDe(mv), categoria: mv.categoria, conta: mv.conta, valor: mv.valor, natureza: mv.natureza,
      }));
    }
    const contas_a_pagar = {
      total: cap.reduce((s, c) => s + c.valor, 0),
      itens: capTop.map((c) => ({ data: c.data, descricao: nomeDe(c), categoria: c.catDesc, valor: c.valor, dias: c.dias })),
    };

    // 9) Calendário do mês corrente (realizado + projeção de pagamentos).
    const ano = agora.getFullYear(), mesIdx = agora.getMonth();

    // Extrato REAL do Asaas (financialTransactions) para o calendário — mês atual + anterior.
    // `value` tem sinal (>0 entrada, <0 saída); transferências (type *TRANSFER*) não contam.
    // As contas Asaas do Omie ficam fora do calendário (ASAAS_NCODCC) para não duplicar.
    //
    // BUSCA INCREMENTAL (economiza chamadas de API): o extrato do Asaas é um ledger
    // APPEND-ONLY — um estorno/chargeback vira um lançamento NOVO na data em que ocorre, não
    // altera o dia passado. Logo, dias já fechados NUNCA mudam. Guardamos o agregado por dia
    // permanentemente (omie_cache/asaas_extrato_dias) com um marcador `sincronizado_ate`; a
    // cada atualização só buscamos do Asaas os últimos ASAAS_OVERLAP_DIAS dias + hoje — nunca
    // todo o histórico de novo. O overlap cobre lançamentos que cheguem com data de dias atrás.
    // Só faz a carga completa ("seed") na 1ª vez ou se pedirem rebuild explícito.
    const ASAAS_CACHE_KEY = "asaas_extrato_dias";
    const ASAAS_OVERLAP_DIAS = 4;   // re-confere os últimos 4 dias (o resto fica congelado)
    const ASAAS_TTL_MIN = 180;      // dentro de 3h, o "Recalcular" nem chama o Asaas
    const rebuildAsaas = body?.asaas_rebuild === true;
    const asaasPorDia = new Map<string, { entradas: number; saidas: number }>();
    let asaasOrigem: "cache" | "incremental" | "seed" | "erro" = "cache";
    let asaasBuscados = 0;
    try {
      const { data: cacheRow } = await supabase
        .from("omie_cache").select("dados, atualizado_em").eq("chave", ASAAS_CACHE_KEY).maybeSingle();
      const store: any = (cacheRow as any)?.dados ?? {};
      const diasStore: Record<string, { e: number; s: number }> =
        (store.dias && !Array.isArray(store.dias) && typeof store.dias === "object") ? store.dias : {};
      const idadeMin = (cacheRow as any)?.atualizado_em
        ? (Date.now() - new Date((cacheRow as any).atualizado_em).getTime()) / 60000 : Infinity;

      const needFrom = iso(new Date(ano, mesIdx - 1, 1)); // 1º dia do mês anterior (início da janela)
      let modo: "seed" | "incremental" | "cache";
      if (!store.sincronizado_ate || rebuildAsaas) modo = "seed";
      else if (forcar || idadeMin > ASAAS_TTL_MIN) modo = "incremental";
      else modo = "cache";
      asaasOrigem = modo;

      if (modo !== "cache") {
        // seed: janela inteira; incremental: só os últimos dias (overlap), nunca antes de needFrom.
        const overlapFrom = iso(addDays(hojeD, -ASAAS_OVERLAP_DIAS));
        const de = modo === "seed" ? needFrom : (overlapFrom > needFrom ? overlapFrom : needFrom);
        const tx = await asaasList("/financialTransactions", { startDate: de, finishDate: iso(hojeD) });
        // Re-confere só os dias >= de (apaga e re-agrega); dias anteriores ficam congelados.
        for (const k of Object.keys(diasStore)) if (k >= de) delete diasStore[k];
        for (const t of tx) {
          asaasBuscados++;
          const tipo = String((t as any)?.type ?? "").toUpperCase();
          if (tipo.includes("TRANSFER")) continue;
          const d = String((t as any)?.date ?? "").slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < de) continue;
          const v = toNum((t as any)?.value);
          if (v === 0) continue;
          const cur = diasStore[d] ?? { e: 0, s: 0 };
          if (v > 0) cur.e += v; else cur.s += Math.abs(v);
          diasStore[d] = cur;
        }
        await supabase.from("omie_cache").upsert(
          { chave: ASAAS_CACHE_KEY, dados: { dias: diasStore, sincronizado_ate: iso(hojeD) }, registros: Object.keys(diasStore).length, atualizado_em: new Date().toISOString() },
          { onConflict: "chave" },
        );
      }
      for (const [d, v] of Object.entries(diasStore)) asaasPorDia.set(d, { entradas: Number(v.e) || 0, saidas: Number(v.s) || 0 });
    } catch (e) {
      asaasOrigem = "erro";
      console.warn("omie-caixa-sync: extrato Asaas indisponível p/ calendário:", e instanceof Error ? e.message : String(e));
    }
    const mmAtual = String(mesIdx + 1).padStart(2, "0");

    const diasNoMes = new Date(ano, mesIdx + 1, 0).getDate();
    const calDias: Record<number, { entradas: number; saidas: number; projetado: number; recebido: number }> = {};
    for (let d = 1; d <= diasNoMes; d++) calDias[d] = { entradas: 0, saidas: 0, projetado: 0, recebido: 0 };
    for (const m of movs) {
      if (m.transfer || ASAAS_NCODCC.has(m.ncodcc)) continue;
      if (m.dPago && m.dPago.getFullYear() === ano && m.dPago.getMonth() === mesIdx) {
        const dia = m.dPago.getDate();
        if (m.entrada) { calDias[dia].entradas += m.valor; if (RECEBIDO_NCODCC.has(m.ncodcc)) calDias[dia].recebido += m.valor; }
        else calDias[dia].saidas += m.valor;
      } else if (!m.dPago && !m.entrada && m.dVenc && m.dVenc.getFullYear() === ano && m.dVenc.getMonth() === mesIdx && m.dVenc >= hojeD) {
        calDias[m.dVenc.getDate()].projetado += m.aberto;
      }
    }
    // Soma o extrato do Asaas (mês atual) — nas entradas totais E no recebido (Asaas Disponível).
    for (const [d, v] of asaasPorDia.entries()) {
      if (d.slice(0, 7) !== `${ano}-${mmAtual}`) continue;
      const dia = Number(d.slice(8, 10));
      if (calDias[dia]) { calDias[dia].entradas += v.entradas; calDias[dia].saidas += v.saidas; calDias[dia].recebido += v.entradas; }
    }
    const calendario = {
      ano, mes: mesIdx, hoje: agora.getDate(),
      dias: Object.entries(calDias).map(([dia, v]) => ({
        dia: Number(dia),
        realizado: v.entradas > 0 || v.saidas > 0,
        tem_projetado: v.projetado > 0,
        entradas: v.entradas, saidas: v.saidas, projetado: v.projetado, recebido: v.recebido,
      })),
    };

    // 9b) Calendário do mês ANTERIOR (mesmo formato, só entradas/saídas realizadas) — usado
    // pela UI para comparar o período selecionado com os MESMOS dias do mês anterior.
    const anoAnt = mesIdx === 0 ? ano - 1 : ano;
    const mesAntIdx = mesIdx === 0 ? 11 : mesIdx - 1;
    const diasNoMesAnt = new Date(anoAnt, mesAntIdx + 1, 0).getDate();
    const calDiasAnt: Record<number, { entradas: number; saidas: number; recebido: number }> = {};
    for (let d = 1; d <= diasNoMesAnt; d++) calDiasAnt[d] = { entradas: 0, saidas: 0, recebido: 0 };
    for (const m of movs) {
      if (m.transfer || ASAAS_NCODCC.has(m.ncodcc) || !m.dPago) continue;
      if (m.dPago.getFullYear() === anoAnt && m.dPago.getMonth() === mesAntIdx) {
        const dia = m.dPago.getDate();
        if (m.entrada) { calDiasAnt[dia].entradas += m.valor; if (RECEBIDO_NCODCC.has(m.ncodcc)) calDiasAnt[dia].recebido += m.valor; }
        else calDiasAnt[dia].saidas += m.valor;
      }
    }
    // Soma o extrato do Asaas (mês anterior) — entradas totais E recebido (Asaas Disponível).
    const mmAnt = String(mesAntIdx + 1).padStart(2, "0");
    for (const [d, v] of asaasPorDia.entries()) {
      if (d.slice(0, 7) !== `${anoAnt}-${mmAnt}`) continue;
      const dia = Number(d.slice(8, 10));
      if (calDiasAnt[dia]) { calDiasAnt[dia].entradas += v.entradas; calDiasAnt[dia].saidas += v.saidas; calDiasAnt[dia].recebido += v.entradas; }
    }
    const calendario_anterior = {
      ano: anoAnt, mes: mesAntIdx,
      dias: Object.entries(calDiasAnt).map(([dia, v]) => ({ dia: Number(dia), entradas: v.entradas, saidas: v.saidas, recebido: v.recebido })),
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
      calendario_anterior,
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
      asaas_extrato: { origem: asaasOrigem, dias: asaasPorDia.size, buscados: asaasBuscados },
      hoje: { entradas: periodos.hoje.entradas, saidas: periodos.hoje.saidas, resultado: periodos.hoje.resultado },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-caixa-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
