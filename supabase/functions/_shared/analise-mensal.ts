// A camada de análise do Hub: todos os números alinhados por mês, com procedência.
//
// Pedido do financeiro (18/09/2026): cruzar DRE/DFC, BP, operação e aquisição. O perigo de
// cruzar fontes é comparar coisas que medem o mês de jeitos diferentes sem perceber:
//
//   DRE      competência (dDtRegistro) em 2026; CAIXA em 2025 (fonte era o Conta Azul) — o
//            corte é entre Dez-25 e Jan-26. Mês não travado ainda muda.
//   DFC      caixa. Cashburn = Fluxo Livre − novos empréstimos (a captação não é geração).
//   OS       o que comercial e operação lançam; canal que não lançou deixa total incompleto.
//   Carteira MRR e clientes do fim do mês (os_assinaturas — a mesma planilha da DRE).
//   CAC      Painel CAC (Omie, oficial) e o CAC do OS, que sai da matriz de custos do OS.
//   Estornos churn real = estornado − cobrança indevida, pelo mês de vencimento.
//   BP       plano 2026, reancorado no realizado de junho (antes de jun compara com o velho).
//
// Então cada linha diz a fonte, o regime, o plano de MESMA definição e um status de
// confiança; derivada herda o pior status das entradas. Sem import nenhum: roda no Deno
// (analise-mensal-montar) e no Vitest.

export type Unidade = "BRL" | "count" | "percent" | "ratio" | "meses";
export type Grupo = "resultado" | "caixa" | "carteira" | "aquisicao" | "retencao" | "eficiencia";
export type Regime = "competencia" | "caixa" | "carteira" | "lancamento_os" | "derivado";
export type Status = "ok" | "regime_caixa" | "mes_aberto" | "estimado" | "incompleto" | "sem_dado";

export type LinhaAnalise = {
  competencia: string; // AAAA-MM-01
  metrica: string;
  rotulo: string;
  grupo: Grupo;
  unidade: Unidade;
  valor: number | null;
  plano: number | null;
  meta: number | null;
  fonte: string;
  regime: Regime;
  status: Status;
  formula: string;
  nota: string | null;
  sensivel: boolean;
};

/** O que o montador lê de cada fonte, já reduzido a funções — o módulo não sabe de banco. */
export type Fontes = {
  /** Valor de uma rubrica da DRE / DFC no mês (null = sem valor). */
  dre: (rubrica: string, comp: string) => number | null;
  dfc: (rubrica: string, comp: string) => number | null;
  /** Mês travado (fechado pelo tracker)? DRE e DFC compartilham a trava. */
  travado: (comp: string) => boolean;
  /** Indicador do Takeat OS (os_painel_completo), por departamento/canal/indicador. */
  os: (departamento: string, canal: string, indicador: string, comp: string) =>
    { realizado: number | null; orcado: number | null; origem: string | null; nota: string | null } | null;
  carteira: (comp: string) => { mrr: number | null; clientes: number | null } | null;
  /** Soma do Painel CAC (Omie) no mês. */
  gastoAquisicao: (comp: string) => number | null;
  /** Churn real dos estornos do Asaas no mês (e o estornado bruto). */
  estornos: (comp: string) => { churnReal: number | null; estornado: number | null } | null;
  /** Churn bruto da carteira (cancelamentos + downsell) do churn_snapshot, para o GRR. */
  churnBruto: (comp: string) => { cancelValor: number | null; downsellValor: number | null; base: number | null } | null;
  /** Plano do BP: Consolidado por rótulo normalizado e aba Operação por campo. */
  bp: (rotulo: string, comp: string) => number | null;
  bpOperacao: (campo: string, comp: string) => number | null;
  /** O BP deste mês é anterior à reancoragem de junho? */
  bpPreRevisao: (comp: string) => boolean;
};

/* ------------------------------ status ------------------------------ */

const PESO: Record<Status, number> = { ok: 0, regime_caixa: 1, mes_aberto: 2, estimado: 3, incompleto: 4, sem_dado: 5 };
export const piorStatus = (...s: Status[]): Status => s.reduce((a, b) => (PESO[b] > PESO[a] ? b : a), "ok" as Status);

export const mesAnterior = (c: string, n = 1): string => {
  let [a, m] = c.slice(0, 7).split("-").map(Number);
  m -= n;
  while (m < 1) { m += 12; a -= 1; }
  return `${a}-${String(m).padStart(2, "0")}-01`;
};

/** Status de um número da DRE/DFC: 2025 é caixa, mês não travado ainda muda. */
function statusContabil(f: Fontes, comp: string, contabilPorCaixa: boolean): Status {
  if (!f.travado(comp)) return "mes_aberto";
  if (!contabilPorCaixa && comp < "2026-01-01") return "regime_caixa";
  return "ok";
}

function statusOS(origem: string | null | undefined): Status {
  if (origem === "hub_parcial") return "incompleto";
  if (origem === "hub_estimado") return "estimado";
  return "ok";
}

/* ------------------------------ o catálogo ------------------------------ */

type Calc = { valor: number | null; status?: Status; nota?: string | null; plano?: number | null; meta?: number | null };

type Def = {
  metrica: string;
  rotulo: string;
  grupo: Grupo;
  unidade: Unidade;
  fonte: string;
  regime: Regime;
  formula: string;
  sensivel?: boolean;
  calc: (f: Fontes, comp: string, v: (metrica: string, c?: string) => LinhaAnalise | undefined) => Calc;
};

const abs = (n: number | null) => (n == null ? null : Math.abs(n));
const div = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);

/** Linha da DRE com o plano do BP de mesma definição. */
const daDre = (metrica: string, rotulo: string, rubrica: string, rotuloBp: string | null, grupo: Grupo = "resultado"): Def => ({
  metrica, rotulo, grupo, unidade: "BRL", fonte: "DRE", regime: "competencia",
  formula: `DRE › ${rubrica}`,
  calc: (f, c) => ({
    valor: f.dre(rubrica, c),
    status: statusContabil(f, c, false),
    plano: rotuloBp ? f.bp(rotuloBp, c) : null,
  }),
});

/** Indicador consolidado do OS (já completado pelo Hub onde o OS deixou vazio). */
const doOS = (metrica: string, rotulo: string, grupo: Grupo, unidade: Unidade, depto: string, indicador: string,
  planoBp: string | null = null, sensivel = false): Def => ({
  metrica, rotulo, grupo, unidade, fonte: "OS", regime: "lancamento_os", sensivel,
  formula: `Takeat OS › ${depto} › Consolidado › ${indicador}`,
  calc: (f, c) => {
    const x = f.os(depto, "Consolidado", indicador, c);
    return {
      valor: x?.realizado ?? null,
      status: x?.realizado == null ? "sem_dado" : statusOS(x.origem),
      nota: x?.nota ?? null,
      meta: x?.orcado != null && x.orcado > 0 ? x.orcado : null,
      plano: planoBp ? f.bpOperacao(planoBp, c) : null,
    };
  },
});

export const CATALOGO: Def[] = [
  /* ---------- resultado (DRE, competência) ---------- */
  daDre("receita_bruta", "Receita bruta", "Receita Bruta", "receita"),
  daDre("receita_recorrente", "Receita recorrente", "Receita Recorrente", "receita recorrente assinaturas"),
  daDre("receita_liquida", "Receita líquida", "Receita Líquida", "receita liquida"),
  { ...daDre("margem_contribuicao", "Margem de contribuição", "Margem de contribuição", "margem de contribuicao"), sensivel: true },
  daDre("despesas_mkt_vendas", "Despesas de marketing e vendas", "Despesas Marketing & Vendas", "despesas marketing & vendas"),
  daDre("pessoal", "Pessoal (SG&A)", "Pessoal", "pessoal"),
  daDre("sga", "SG&A", "(-) SG&A", "sg&a"),
  daDre("ebitda", "EBITDA", "EBITDA", "ebitda"),
  daDre("lucro_liquido", "Lucro líquido", "Lucro Líquido", "lucro liquido"),
  {
    metrica: "margem_contribuicao_pct", rotulo: "Margem de contribuição %", grupo: "resultado", unidade: "percent",
    fonte: "Derivado", regime: "derivado", sensivel: true,
    formula: "Margem de contribuição ÷ Receita líquida",
    calc: (f, c, v) => {
      const m = v("margem_contribuicao"), r = v("receita_liquida");
      const pm = f.bp("margem de contribuicao", c), pr = f.bp("receita liquida", c);
      return { valor: pct(div(m?.valor ?? null, r?.valor ?? null)), status: piorStatus(m?.status ?? "sem_dado", r?.status ?? "sem_dado"), plano: pct(div(pm, pr)) };
    },
  },
  {
    metrica: "margem_ebitda_pct", rotulo: "Margem EBITDA %", grupo: "resultado", unidade: "percent",
    fonte: "Derivado", regime: "derivado",
    formula: "EBITDA ÷ Receita líquida",
    calc: (f, c, v) => {
      const e = v("ebitda"), r = v("receita_liquida");
      return { valor: pct(div(e?.valor ?? null, r?.valor ?? null)), status: piorStatus(e?.status ?? "sem_dado", r?.status ?? "sem_dado"),
        plano: pct(div(f.bp("ebitda", c), f.bp("receita liquida", c))) };
    },
  },

  /* ---------- caixa (DFC) ---------- */
  {
    metrica: "fco", rotulo: "Fluxo de caixa operacional", grupo: "caixa", unidade: "BRL", fonte: "DFC", regime: "caixa",
    formula: "DFC › Fluxo de Caixa Operacional",
    calc: (f, c) => ({ valor: f.dfc("Fluxo de Caixa Operacional", c), status: statusContabil(f, c, true), plano: f.bp("fluxo de caixa operacional", c) }),
  },
  {
    metrica: "novos_emprestimos", rotulo: "Novos empréstimos e financiamentos", grupo: "caixa", unidade: "BRL", fonte: "DFC", regime: "caixa",
    formula: "DFC › (+) Novos Empréstimos & Financiamentos",
    calc: (f, c) => ({ valor: f.dfc("(+) Novos Empréstimos & Financiamentos", c) ?? 0, status: statusContabil(f, c, true) }),
  },
  {
    metrica: "cashburn", rotulo: "Cashburn (queima do mês)", grupo: "caixa", unidade: "BRL", fonte: "DFC", regime: "caixa",
    formula: "DFC › Cashburn = Fluxo Livre − novos empréstimos (a captação não conta como geração de caixa)",
    calc: (f, c) => {
      const gravado = f.dfc("Cashburn", c);
      if (gravado != null) return { valor: gravado, status: statusContabil(f, c, true) };
      const livre = f.dfc("Fluxo Livre", c);
      return { valor: livre == null ? null : livre - (f.dfc("(+) Novos Empréstimos & Financiamentos", c) ?? 0), status: statusContabil(f, c, true),
        nota: "Sem a linha Cashburn no DFC: refeito como Fluxo Livre − novos empréstimos." };
    },
  },
  {
    metrica: "burn_medio_3m", rotulo: "Burn médio 3 meses", grupo: "caixa", unidade: "BRL", fonte: "Derivado", regime: "derivado",
    formula: "Média do cashburn do mês e dos 2 anteriores",
    calc: (_f, c, v) => {
      const ls = [c, mesAnterior(c), mesAnterior(c, 2)].map((m) => v("cashburn", m));
      if (ls.some((l) => l?.valor == null)) return { valor: null, status: "sem_dado" };
      return { valor: ls.reduce((a, l) => a + (l!.valor as number), 0) / 3, status: piorStatus(...ls.map((l) => l!.status)) };
    },
  },

  /* ---------- carteira ---------- */
  {
    metrica: "mrr", rotulo: "MRR (carteira, fim do mês)", grupo: "carteira", unidade: "BRL", fonte: "Carteira OS", regime: "carteira",
    formula: "os_assinaturas › MRR de assinatura (sem Banestes e aluguel)",
    calc: (f, c) => {
      const x = f.carteira(c);
      return { valor: x?.mrr ?? null, status: x?.mrr == null ? "sem_dado" : "ok", plano: f.bpOperacao("mrr_recorrente", c) };
    },
  },
  {
    metrica: "clientes", rotulo: "Clientes ativos (fim do mês)", grupo: "carteira", unidade: "count", fonte: "Carteira OS", regime: "carteira",
    formula: "os_assinaturas › clientes",
    calc: (f, c) => {
      const x = f.carteira(c);
      return { valor: x?.clientes ?? null, status: x?.clientes == null ? "sem_dado" : "ok", plano: f.bpOperacao("clientes_eop", c) };
    },
  },
  {
    metrica: "ticket_medio", rotulo: "Ticket médio (MRR ÷ clientes)", grupo: "carteira", unidade: "BRL", fonte: "Derivado", regime: "derivado",
    formula: "MRR ÷ clientes ativos",
    calc: (f, c, v) => {
      const m = v("mrr"), n = v("clientes");
      return { valor: div(m?.valor ?? null, n?.valor ?? null), status: piorStatus(m?.status ?? "sem_dado", n?.status ?? "sem_dado"), plano: f.bpOperacao("ticket", c) };
    },
  },
  {
    metrica: "mrr_liquido_novo", rotulo: "MRR líquido novo (variação da carteira)", grupo: "carteira", unidade: "BRL", fonte: "Derivado", regime: "derivado",
    formula: "MRR do mês − MRR do mês anterior",
    calc: (f, c, v) => {
      const a = v("mrr"), b = v("mrr", mesAnterior(c));
      const pa = f.bpOperacao("mrr_recorrente", c), pb = f.bpOperacao("mrr_recorrente", mesAnterior(c));
      return { valor: a?.valor != null && b?.valor != null ? a.valor - b.valor : null, status: piorStatus(a?.status ?? "sem_dado", b?.status ?? "sem_dado"),
        plano: pa != null && pb != null ? pa - pb : null };
    },
  },
  {
    metrica: "crescimento_mrr_pct", rotulo: "Crescimento do MRR no mês", grupo: "carteira", unidade: "percent", fonte: "Derivado", regime: "derivado",
    formula: "MRR líquido novo ÷ MRR do mês anterior",
    calc: (_f, c, v) => {
      const n = v("mrr_liquido_novo"), b = v("mrr", mesAnterior(c));
      return { valor: pct(div(n?.valor ?? null, b?.valor ?? null)), status: n?.status ?? "sem_dado" };
    },
  },

  /* ---------- aquisição ---------- */
  doOS("novos_clientes", "Novos clientes", "aquisicao", "count", "Aquisição", "Novos Clientes Total", "novos"),
  doOS("novo_mrr", "Novo MRR vendido", "aquisicao", "BRL", "Aquisição", "Novo MRR Total", "novo_mrr"),
  doOS("nova_receita", "Nova receita vendida", "aquisicao", "BRL", "Aquisição", "Nova Receita Total"),
  {
    metrica: "gasto_aquisicao", rotulo: "Gasto de aquisição (Painel CAC)", grupo: "aquisicao", unidade: "BRL", fonte: "Painel CAC", regime: "competencia",
    formula: "Painel CAC (Omie) › soma das linhas do mês: Equipes + Investimentos + Comissões",
    calc: (f, c) => {
      const g = f.gastoAquisicao(c);
      return { valor: g, status: g == null ? "sem_dado" : statusContabil(f, c, false) };
    },
  },
  {
    metrica: "cac_omie", rotulo: "CAC pelo Painel CAC (Omie)", grupo: "aquisicao", unidade: "BRL", fonte: "Derivado", regime: "derivado",
    formula: "Gasto de aquisição (Painel CAC) ÷ Novos clientes (OS)",
    calc: (_f, _c, v) => {
      const g = v("gasto_aquisicao"), n = v("novos_clientes");
      return { valor: div(g?.valor ?? null, n?.valor ?? null), status: piorStatus(g?.status ?? "sem_dado", n?.status ?? "sem_dado"),
        nota: "Não inclui o investimento em ADS lançado só no OS; o CAC do OS inclui." };
    },
  },
  doOS("cac_os", "CAC pelo Takeat OS", "aquisicao", "BRL", "Aquisição", "CAC"),
  doOS("ltv", "LTV", "aquisicao", "BRL", "Aquisição", "LTV", null, true),
  doOS("ltv_cac", "LTV/CAC", "aquisicao", "ratio", "Aquisição", "LTV/CAC", null, true),
  doOS("payback_meses", "Payback do CAC", "aquisicao", "meses", "Aquisição", "CAC Payback", null, true),
  {
    metrica: "conversao_vendido_faturado", rotulo: "Do vendido ao faturado", grupo: "aquisicao", unidade: "percent", fonte: "Derivado", regime: "derivado",
    formula: "Variação da receita recorrente na DRE ÷ Novo MRR vendido no OS",
    calc: (_f, c, v) => {
      const r = v("receita_recorrente"), ra = v("receita_recorrente", mesAnterior(c)), n = v("novo_mrr");
      const delta = r?.valor != null && ra?.valor != null ? r.valor - ra.valor : null;
      return { valor: pct(div(delta, n?.valor ?? null)), status: piorStatus(r?.status ?? "sem_dado", ra?.status ?? "sem_dado", n?.status ?? "sem_dado"),
        nota: "Quanto do MRR que o comercial vendeu apareceu como receita recorrente nova na DRE. Abaixo de 100%: venda que ainda não faturou, ou churn comendo a venda." };
    },
  },

  /* ---------- retenção ---------- */
  doOS("churn_receita_pct", "Churn de receita (líquido)", "retencao", "percent", "Operação", "% Churn Revenue Total", "churn_pct"),
  doOS("churn_receita", "Churn de receita (R$)", "retencao", "BRL", "Operação", "Receita Churn Total", "churn_valor"),
  doOS("churn_clientes", "Clientes perdidos", "retencao", "count", "Operação", "Customer Churn Total", "perdidos"),
  doOS("upsell", "Upsell", "retencao", "BRL", "Operação", "Upsell Total"),
  {
    metrica: "churn_real_estornos", rotulo: "Churn real (estornos do Asaas)", grupo: "retencao", unidade: "BRL", fonte: "Estornos Asaas", regime: "caixa",
    formula: "Estornado no mês (pelo vencimento) − cobrança indevida",
    calc: (f, c) => {
      const e = f.estornos(c);
      return { valor: e?.churnReal ?? null, status: e?.churnReal == null ? "sem_dado" : "ok",
        nota: "Dinheiro devolvido ao cliente. Mede outra coisa que o churn do OS (cancelamento pedido): os dois juntos dizem quanto do churn vira estorno." };
    },
  },
  {
    metrica: "nrr_mensal_pct", rotulo: "Retenção líquida de receita (NRR, mês)", grupo: "retencao", unidade: "percent", fonte: "Derivado", regime: "derivado",
    formula: "100% − churn de receita líquido (já desconta upsell, downsell e reativações)",
    calc: (_f, _c, v) => {
      const ch = v("churn_receita_pct");
      return { valor: ch?.valor == null ? null : 100 - ch.valor, status: ch?.status ?? "sem_dado" };
    },
  },
  {
    metrica: "grr_mensal_pct", rotulo: "Retenção bruta de receita (GRR, mês)", grupo: "retencao", unidade: "percent", fonte: "Derivado", regime: "derivado",
    formula: "100% − (cancelamentos + downsell) ÷ MRR do início do mês",
    calc: (f, c) => {
      const b = f.churnBruto(c);
      const perda = b?.cancelValor != null ? b.cancelValor + (b.downsellValor ?? 0) : null;
      const taxa = div(perda, b?.base ?? null);
      return { valor: taxa == null ? null : 100 - taxa * 100, status: taxa == null ? "sem_dado" : "estimado",
        nota: "Cancelamento da Ativação no OS é só %, então a parte dele em R$ é a do próprio OS e a quantidade é estimada." };
    },
  },

  /* ---------- eficiência ---------- */
  {
    metrica: "burn_multiple", rotulo: "Burn multiple", grupo: "eficiencia", unidade: "ratio", fonte: "Derivado", regime: "derivado",
    formula: "|Cashburn| ÷ MRR líquido novo — quanto se queima para cada R$ 1 de MRR que a carteira ganha (abaixo de 1 é excelente; acima de 2, caro)",
    calc: (_f, _c, v) => {
      const b = v("cashburn"), n = v("mrr_liquido_novo");
      if (b?.valor == null || n?.valor == null) return { valor: null, status: "sem_dado" };
      if (b.valor >= 0) return { valor: 0, status: piorStatus(b.status, n.status), nota: "O mês gerou caixa." };
      if (n.valor <= 0) return { valor: null, status: piorStatus(b.status, n.status), nota: "A carteira não cresceu no mês: burn multiple indefinido." };
      return { valor: Math.abs(b.valor) / n.valor, status: piorStatus(b.status, n.status) };
    },
  },
  {
    metrica: "magic_number", rotulo: "Magic number", grupo: "eficiencia", unidade: "ratio", fonte: "Derivado", regime: "derivado",
    formula: "(MRR líquido novo × 12) ÷ Despesas de marketing e vendas do mês ANTERIOR (acima de 0,75 justifica acelerar)",
    calc: (_f, c, v) => {
      const n = v("mrr_liquido_novo"), s = v("despesas_mkt_vendas", mesAnterior(c));
      return { valor: div(n?.valor == null ? null : n.valor * 12, abs(s?.valor ?? null)), status: piorStatus(n?.status ?? "sem_dado", s?.status ?? "sem_dado") };
    },
  },
  {
    metrica: "mkt_sobre_receita_pct", rotulo: "Marketing e vendas ÷ receita líquida", grupo: "eficiencia", unidade: "percent", fonte: "Derivado", regime: "derivado",
    formula: "|Despesas de marketing e vendas| ÷ Receita líquida",
    calc: (f, c, v) => {
      const s = v("despesas_mkt_vendas"), r = v("receita_liquida");
      return { valor: pct(div(abs(s?.valor ?? null), r?.valor ?? null)), status: piorStatus(s?.status ?? "sem_dado", r?.status ?? "sem_dado"),
        plano: pct(div(abs(f.bp("despesas marketing & vendas", c)), f.bp("receita liquida", c))) };
    },
  },
  {
    metrica: "pessoal_sobre_receita_pct", rotulo: "Pessoal ÷ receita líquida", grupo: "eficiencia", unidade: "percent", fonte: "Derivado", regime: "derivado",
    formula: "|Pessoal (SG&A)| ÷ Receita líquida",
    calc: (f, c, v) => {
      const p = v("pessoal"), r = v("receita_liquida");
      return { valor: pct(div(abs(p?.valor ?? null), r?.valor ?? null)), status: piorStatus(p?.status ?? "sem_dado", r?.status ?? "sem_dado"),
        plano: pct(div(abs(f.bp("pessoal", c)), f.bp("receita liquida", c))) };
    },
  },
  {
    metrica: "regra_dos_40", rotulo: "Regra dos 40", grupo: "eficiencia", unidade: "percent", fonte: "Derivado", regime: "derivado",
    formula: "Crescimento da receita recorrente em 12 meses (%) + Margem EBITDA (%)",
    calc: (_f, c, v) => {
      const r = v("receita_recorrente"), r12 = v("receita_recorrente", mesAnterior(c, 12)), m = v("margem_ebitda_pct");
      const cresc = pct(div(r?.valor != null && r12?.valor != null ? r.valor - r12.valor : null, r12?.valor ?? null));
      const status = piorStatus(r?.status ?? "sem_dado", r12?.status ?? "sem_dado", m?.status ?? "sem_dado");
      // O aviso de 2025 vale mesmo quando outro status (mês aberto) é o mais grave.
      return { valor: cresc == null || m?.valor == null ? null : cresc + m.valor, status,
        nota: r12?.status === "regime_caixa" ? "Compara com 2025, que está em regime de caixa na DRE: o crescimento é aproximado." : null };
    },
  },
];

function pct(x: number | null): number | null { return x == null ? null : x * 100; }

/* ------------------------------ montagem ------------------------------ */

/**
 * Monta todas as métricas de todos os meses pedidos. Ordem importa: métrica derivada lê as
 * anteriores do catálogo — e de meses anteriores ao pedido, que por isso também são
 * calculados (a janela é ampliada em 13 meses por trás para Regra dos 40 e burn 3m).
 */
export function montarAnalise(f: Fontes, meses: string[]): LinhaAnalise[] {
  const alvo = new Set(meses.map((m) => m.slice(0, 10)));
  const todos = new Set<string>();
  for (const m of alvo) for (let i = 0; i <= 13; i++) todos.add(mesAnterior(m, i));
  const ordenados = [...todos].sort();

  const feito = new Map<string, LinhaAnalise>();
  const v = (metrica: string, c: string) => feito.get(`${c}|${metrica}`);

  for (const comp of ordenados) {
    for (const d of CATALOGO) {
      let r: Calc;
      try {
        r = d.calc(f, comp, (m, c) => v(m, c ?? comp));
      } catch (e) {
        r = { valor: null, status: "sem_dado", nota: `Falhou ao calcular: ${(e as Error).message}` };
      }
      const valor = r.valor != null && isFinite(r.valor) ? r.valor : null;
      let status: Status = valor == null ? "sem_dado" : r.status ?? "ok";
      const notas = [r.nota ?? null];
      const plano = r.plano ?? null;
      if (plano != null && f.bpPreRevisao(comp)) notas.push("Plano anterior à reancoragem do BP em junho: compara com a projeção antiga.");
      if (status === "mes_aberto") notas.push("Mês ainda não travado na DRE/DFC: o número pode mudar.");
      feito.set(`${comp}|${d.metrica}`, {
        competencia: comp, metrica: d.metrica, rotulo: d.rotulo, grupo: d.grupo, unidade: d.unidade,
        valor, plano, meta: r.meta ?? null, fonte: d.fonte, regime: d.regime, status,
        formula: d.formula, nota: notas.filter(Boolean).join(" ") || null, sensivel: !!d.sensivel,
      });
    }
  }
  return [...feito.values()].filter((l) => alvo.has(l.competencia));
}
