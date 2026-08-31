// Edge Function: omie-capital-giro-sync
// Calcula a "Necessidade mensal de capital de giro" (desembolso operacional
// recorrente) a partir do CAP do Omie — MESMO método/base do omie-caixa-sync —
// e grava um snapshot pronto em `omie_capital_giro_snapshot`. A tela só lê o snapshot.
//
// Autocontida por opção: lê os movimentos/categorias já baixados do Omie na tabela
// `omie_cache` (que as sincronizações diárias mantêm atualizada). Não chama a API do
// Omie nem depende de _shared — é só leitura + agregação, o que torna o deploy simples
// e a execução barata. Roda 1x/mês (dia 5, 9h BRT) via pg_cron.
//
// ── Metodologia (validada contra o fechamento manual abr–jun/2026, batendo ao centavo)
//   Fonte : financas/mf/ListarMovimentos, apenas cGrupo = "CONTA_A_PAGAR" (o CAP).
//   Valor : nValorTitulo  ("Valor da Conta").
//   Data  : dDtPrevisao   ("Previsão de Pagamento") → mês de desembolso.
//   Grupo : pelo código da árvore contábil embutido no INÍCIO da descrição da
//           categoria (ex.: "3.2.7.1 Pessoal - Onboarding", "2.8 Retenção de Contribuição").
//
//   Entram na NECESSIDADE (6 grupos operacionais):
//     custos      Custos Operação   = 3.2.x
//     pessoal     Pessoal SG&A      = 3.1.1.x
//     marketing   Marketing&Vendas  = 3.1.3.x / 3.1.4.x
//     admin       Administrativo    = 3.1.2.x  (+ "Alimentação", categoria sem código)
//     tecnologia  Tecnologia        = 3.1.5.x
//     impostos    Impostos          = 2.x
//   NECESSIDADE TOTAL do mês = soma desses 6 grupos.
//
//   Ficam de FORA (rastreados à parte para reconciliação — NÃO entram no total):
//     transferencias    Transferência de Saída (flag transferencia=S / "Transferência")
//     capex_construcao  CAPEX + Construção/Reformas (3.4.x / "Construção, Reformas")
//     captacao          Despesas com Captação
//     financeiras       3.3.x (amortização/taxa de crédito/empréstimo) + tarifas/juros/IOF/multas
//     estorno           Estorno ASAAS (6.x / "Estorno")
//     outros            demais não-operacionais
//
// Ações (body.action): "preview" (calcula e devolve sem gravar) | "sync" (grava; default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* ------------------------------- helpers ------------------------------- */
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function toNum(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
const pad = (n: number) => String(n).padStart(2, "0");
const brl = (n: number) => n.toFixed(2);

// "DD/MM/AAAA" → Date (só a data). Retorna null se vazio/inválido.
function parseOmieDate(s?: string | null): Date | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  const d = new Date(y, +m[2] - 1, +m[1]);
  return isNaN(d.getTime()) ? null : d;
}

// Código da árvore contábil no início da descrição da categoria (ex.: "3.1.1.9").
function leadingCode(desc: unknown): string {
  const m = String(desc ?? "").trim().match(/^([0-9][0-9.]*)/);
  return m ? m[1] : "";
}
// Prefixo com fronteira: startsCode("3.1.10","3.1.1") = false; ("3.1.1.9","3.1.1") = true.
const startsCode = (code: string, prefix: string) => code === prefix || code.startsWith(prefix + ".");

const GRUPOS_OP = ["custos", "pessoal", "marketing", "admin", "tecnologia", "impostos"] as const;
const GRUPOS_LABEL: Record<string, string> = {
  custos: "Custos Operação",
  pessoal: "Pessoal SG&A",
  marketing: "Marketing & Vendas",
  admin: "Administrativo",
  tecnologia: "Tecnologia",
  impostos: "Impostos",
  transferencias: "Transferências de Saída",
  capex_construcao: "CAPEX + Construção/Reformas",
  captacao: "Despesas com Captação",
  financeiras: "Financeiras (juros/IOF/taxa crédito/amort.)",
  estorno: "Estorno ASAAS",
  outros: "Outros (não operacional)",
};

// Classifica UMA categoria no grupo. A ordem importa (primeiro match vence).
function classificar(cat: any): string {
  const desc = cat?.descricao ?? cat?.cDescricao ?? "";
  const nd = norm(desc);
  const code = leadingCode(desc);
  const transf = String(cat?.transferencia ?? "N").toUpperCase() === "S";

  if (transf || nd.includes("transfer")) return "transferencias";
  if (startsCode(code, "3.2")) return "custos";
  if (startsCode(code, "3.1.1")) return "pessoal";
  if (startsCode(code, "3.1.3") || startsCode(code, "3.1.4")) return "marketing";
  if (startsCode(code, "3.1.5")) return "tecnologia";
  if (startsCode(code, "3.1.2") || nd.startsWith("aliment")) return "admin";
  if (startsCode(code, "2")) return "impostos";
  if (startsCode(code, "3.4") || /constru|reforma|benfeitor|capex/.test(nd)) return "capex_construcao";
  if (nd.includes("capta")) return "captacao";
  if (startsCode(code, "6") || nd.includes("estorno")) return "estorno";
  if (startsCode(code, "3.3") || /tarifa|juros|multa|iof|taxa/.test(nd)) return "financeiras";
  return "outros";
}

// Autenticação: chamada de cron (x-cron-token casa com internal_cron_tokens) OU
// um usuário/serviço com JWT válido. A anon key sozinha é rejeitada.
function jwtRole(token: string): string | null {
  try {
    const b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b))?.role ?? null;
  } catch { return null; }
}

/* ------------------------------- handler ------------------------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // --- auth ---
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const cronToken = req.headers.get("x-cron-token");
    let autorizado = false;
    if (cronToken) {
      const { data } = await supabase
        .from("internal_cron_tokens").select("name")
        .eq("name", "omie-capital-giro-sync").eq("token", cronToken).maybeSingle();
      autorizado = !!data;
    }
    if (!autorizado) {
      if (!token) return json({ error: "Não autenticado." }, 401);
      if (jwtRole(token) === "service_role") autorizado = true;
      else {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user) return json({ error: "Não autenticado." }, 401);
        autorizado = true;
      }
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";
    const mesesHistorico = Math.min(Math.max(Number(body?.meses ?? 12), 3), 24);

    // --- lê o cache do Omie (mesma base do omie-caixa-sync) ---
    const [{ data: catRow }, { data: movRow }] = await Promise.all([
      supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "categorias").maybeSingle(),
      supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", "movimentos").maybeSingle(),
    ]);
    const categorias: any[] = Array.isArray(catRow?.dados) ? catRow!.dados : [];
    const movimentos: any[] = Array.isArray(movRow?.dados) ? movRow!.dados : [];
    if (!categorias.length || !movimentos.length) {
      return json({ error: "Cache do Omie vazio (categorias/movimentos). Rode uma sincronização do Omie antes." }, 200);
    }
    const idadeCacheH = movRow?.atualizado_em
      ? (Date.now() - new Date(movRow.atualizado_em).getTime()) / 3_600_000 : null;

    // categoria (codigo) → grupo e → descrição
    const grupoPorCod = new Map<string, string>();
    const descPorCod = new Map<string, string>();
    for (const c of categorias) {
      const cod = String(c?.codigo ?? "");
      if (!cod) continue;
      grupoPorCod.set(cod, classificar(c));
      descPorCod.set(cod, String(c?.descricao ?? c?.cDescricao ?? cod));
    }

    // --- referência temporal (BRT) ---
    // Fuso America/Sao_Paulo (UTC-3): no dia 5 às 9h BRT (=12h UTC) a data é a mesma;
    // o -3h garante o mês correto mesmo se a execução escorregar para a virada.
    const brt = new Date(Date.now() - 3 * 3_600_000);
    const anoAtual = brt.getUTCFullYear();
    const mesAtual0 = brt.getUTCMonth();
    const chaveAtual = `${anoAtual}-${pad(mesAtual0 + 1)}`;
    // mês de referência = último mês FECHADO = mês anterior ao atual
    let refAno = anoAtual, refMes0 = mesAtual0 - 1;
    if (refMes0 < 0) { refMes0 = 11; refAno -= 1; }
    const chaveRef = `${refAno}-${pad(refMes0 + 1)}`;

    // --- agrega o CAP por mês (dDtPrevisao) e grupo ---
    type Bucket = Record<string, number>;
    const meses = new Map<string, Bucket>();
    const outrosRef = new Map<string, number>(); // categorias fora dos grupos, no mês de referência
    let titulosCap = 0;
    for (const mov of movimentos) {
      const det = mov?.detalhes ?? {};
      if (det.cGrupo !== "CONTA_A_PAGAR") continue;
      const prev = parseOmieDate(det.dDtPrevisao);
      if (!prev) continue;
      const val = Math.abs(toNum(det.nValorTitulo));
      if (!val) continue;
      titulosCap++;
      const mesKey = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
      const grupo = grupoPorCod.get(String(det.cCodCateg)) ?? "outros";
      const b = meses.get(mesKey) ?? {};
      b[grupo] = (b[grupo] ?? 0) + val;
      meses.set(mesKey, b);
      if (grupo === "outros" && mesKey === chaveRef) {
        const cod = String(det.cCodCateg ?? "");
        outrosRef.set(cod, (outrosRef.get(cod) ?? 0) + val);
      }
    }

    // --- janela: mês atual (parcial) e os meses fechados anteriores ---
    // limite inferior da janela (mesesHistorico meses fechados antes do atual)
    const limite = new Date(Date.UTC(anoAtual, mesAtual0 - mesesHistorico, 1));
    const dentroJanela = (k: string) => {
      const [y, m] = k.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1, 1));
      return d >= limite && d <= new Date(Date.UTC(anoAtual, mesAtual0, 1));
    };

    const totalOp = (b: Bucket) => GRUPOS_OP.reduce((s, g) => s + (b[g] ?? 0), 0);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const linhas = [...meses.keys()].filter(dentroJanela).sort().map((mes) => {
      const b = meses.get(mes)!;
      const fechado = mes < chaveAtual;
      const excl_transferencias = r2(b["transferencias"] ?? 0);
      const necessidade = r2(totalOp(b));
      const capSemTransfer = r2(
        Object.entries(b).reduce((s, [g, v]) => s + (g === "transferencias" ? 0 : v), 0),
      );
      return {
        mes,
        fechado,
        parcial: !fechado,
        custos: r2(b["custos"] ?? 0),
        pessoal: r2(b["pessoal"] ?? 0),
        marketing: r2(b["marketing"] ?? 0),
        admin: r2(b["admin"] ?? 0),
        tecnologia: r2(b["tecnologia"] ?? 0),
        impostos: r2(b["impostos"] ?? 0),
        necessidade_total: necessidade,
        excl_transferencias,
        excl_capex_construcao: r2(b["capex_construcao"] ?? 0),
        excl_captacao: r2(b["captacao"] ?? 0),
        excl_financeiras: r2(b["financeiras"] ?? 0),
        excl_estorno: r2(b["estorno"] ?? 0),
        excl_outros: r2(b["outros"] ?? 0),
        cap_total_sem_transfer: capSemTransfer,
      };
    });

    const fechados = linhas.filter((l) => l.fechado);
    const porMes = new Map(linhas.map((l) => [l.mes, l]));
    const necessidadeRef = porMes.get(chaveRef)?.necessidade_total ?? null;

    // run-rate = média das necessidades dos N últimos meses FECHADOS (terminando na ref)
    const mediaUlt = (n: number) => {
      const arr = fechados.slice(-n).map((l) => l.necessidade_total);
      return arr.length === n ? r2(arr.reduce((s, v) => s + v, 0) / n) : null;
    };
    const run_rate_2m = mediaUlt(2);
    const run_rate_3m = mediaUlt(3);

    // variação da ref vs mês fechado anterior
    const idxRef = fechados.findIndex((l) => l.mes === chaveRef);
    const necAnterior = idxRef > 0 ? fechados[idxRef - 1].necessidade_total : null;
    const var_mom_pct = necessidadeRef != null && necAnterior
      ? r2(((necessidadeRef - necAnterior) / necAnterior) * 100) : null;

    // --- alerta: categorias fora dos 6 grupos operacionais no mês de referência ---
    // (categoria nova/renomeada que não casou com nenhum prefixo mapeado cai em "outros"
    //  e NÃO entra na necessidade — de propósito. Este alerta sinaliza para revisar o mapa.)
    const LIMITE_ALERTA = Number(body?.limite_alerta ?? 1000);
    const totalOutrosRef = r2([...outrosRef.values()].reduce((s, v) => s + v, 0));
    const outrosItens = [...outrosRef.entries()]
      .map(([cod, valor]) => ({ codigo: cod, descricao: descPorCod.get(cod) ?? cod, valor: r2(valor) }))
      .sort((a, b) => b.valor - a.valor).slice(0, 20);
    const alerta = {
      ha_categoria_fora_do_mapa: totalOutrosRef > LIMITE_ALERTA,
      limite: LIMITE_ALERTA,
      mes: chaveRef,
      total_outros: totalOutrosRef,
      itens: outrosItens,
      texto: totalOutrosRef > LIMITE_ALERTA
        ? `Atenção: R$ ${brl(totalOutrosRef)} em ${chaveRef} caíram em categorias fora dos 6 grupos operacionais e NÃO entraram na necessidade. Revise se alguma deveria ser mapeada.`
        : null,
    };

    const agora = new Date();
    const dados = {
      sincronizado_em: agora.toISOString(),
      metodo: "Omie CAP (financas/mf/ListarMovimentos, cGrupo=CONTA_A_PAGAR)",
      base: "Valor da Conta (nValorTitulo) por Previsão de Pagamento (dDtPrevisao)",
      definicao: "Necessidade mensal = Custos(3.2) + Pessoal(3.1.1) + Marketing(3.1.3/3.1.4) + Admin(3.1.2 + Alimentação) + Tecnologia(3.1.5) + Impostos(2). Exclui transferências, CAPEX/construção, captação, financeiras e estorno.",
      grupos_op: GRUPOS_OP,
      grupos_label: GRUPOS_LABEL,
      mes_referencia: chaveRef,
      mes_atual_parcial: chaveAtual,
      necessidade_mes: necessidadeRef,
      necessidade_mes_anterior: necAnterior,
      var_mom_pct,
      run_rate_2m,
      run_rate_3m,
      meses: linhas,
      alerta,
      titulos_cap: titulosCap,
      cache_idade_horas: idadeCacheH != null ? r2(idadeCacheH) : null,
      aviso_cache: idadeCacheH != null && idadeCacheH > 30
        ? "Cache do Omie com mais de 30h — os valores podem não refletir o fechamento mais recente." : null,
    };

    if (action === "preview") return json({ ok: true, preview: true, ...dados });

    // --- grava snapshot e mantém só os 20 mais recentes ---
    const { error: insErr } = await supabase
      .from("omie_capital_giro_snapshot").insert({ dados, sincronizado_em: agora.toISOString() });
    if (insErr) throw insErr;
    const { data: antigos } = await supabase
      .from("omie_capital_giro_snapshot").select("id").order("gerado_em", { ascending: false }).range(20, 999);
    if (antigos && antigos.length) {
      await supabase.from("omie_capital_giro_snapshot").delete().in("id", (antigos as any[]).map((r) => r.id));
    }

    return json({
      ok: true,
      mes_referencia: chaveRef,
      necessidade_mes: necessidadeRef,
      necessidade_mes_fmt: necessidadeRef != null ? brl(necessidadeRef) : null,
      run_rate_2m, run_rate_3m,
      var_mom_pct,
      alerta: { ha_categoria_fora_do_mapa: alerta.ha_categoria_fora_do_mapa, total_outros: alerta.total_outros, itens: alerta.itens.length },
      titulos_cap: titulosCap,
      meses: linhas.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-capital-giro-sync error:", msg);
    return json({ error: msg }, 200);
  }
});
