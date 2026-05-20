// Cálculos puros do dashboard financeiro.
// Operam em cima da tabela historico_financeiro (registros { metrica, ano, mes, valor }).

export type HFRow = { metrica: string; ano: number; mes: number; valor: number };
export type Periodo = { ano: number; mes: number };
export type Serie = { periodo: Periodo; valor: number; label: string };

const MES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const periodoLabel = (p: Periodo) => `${MES_PT[p.mes - 1]}/${String(p.ano).slice(-2)}`;
export const periodoLongLabel = (p: Periodo) =>
  `${MES_PT[p.mes - 1]}/${String(p.ano).slice(-2)}`;
export const periodoKey = (p: Periodo) => `${p.ano}-${String(p.mes).padStart(2, "0")}`;
export const cmpPeriodo = (a: Periodo, b: Periodo) => a.ano * 12 + a.mes - (b.ano * 12 + b.mes);
export const subMeses = (p: Periodo, n: number): Periodo => {
  const idx = p.ano * 12 + (p.mes - 1) - n;
  return { ano: Math.floor(idx / 12), mes: (idx % 12) + 1 };
};
export const addMeses = (p: Periodo, n: number): Periodo => subMeses(p, -n);

// --- Agregação ---------------------------------------------------------------

export function listarPeriodosDisponiveis(rows: HFRow[]): Periodo[] {
  const set = new Set<string>();
  for (const r of rows) set.add(periodoKey({ ano: r.ano, mes: r.mes }));
  return [...set]
    .map((k) => {
      const [a, m] = k.split("-").map(Number);
      return { ano: a, mes: m };
    })
    .sort(cmpPeriodo);
}

function sumMetrica(rows: HFRow[], periodo: Periodo, metricas: string[]): number {
  const set = new Set(metricas.map((m) => m.toLowerCase()));
  return rows
    .filter((r) => r.ano === periodo.ano && r.mes === periodo.mes && set.has(r.metrica.toLowerCase()))
    .reduce((s, r) => s + Number(r.valor ?? 0), 0);
}

// Grupos de despesas (alinhados ao DRE existente).
export const GRUPOS = {
  pessoal: [
    "Equipe Administrativa", "Equipe Comercial", "Equipe Marketing",
    "Equipe Onboarding", "Equipe Operacional", "Equipe Tecnologia",
    "Benefícios", "Encargos Sociais", "Premiações", "Premiações Operacionais",
  ],
  mktVendas: [
    "Campanhas de Mídia Paga", "Campanhas de Outros Canais", "Eventos e Feiras",
    "MGM", "Comissões Consultores / Parceiros", "Agências & Consultorias",
    "Softwares Marketing & Vendas", "Viagens & Transportes Mkt", "Outras despesas Mkt",
  ],
  custosOp: [
    "CMV Materiais", "Servidor", "Softwares Operacionais", "Meios de Pagamento",
    "Outros Custos",
  ],
  admImpFin: [
    "Ocupação & Escritório", "Softwares Administrativos", "Assessorias & Consultorias",
    "Viagens & Transportes Adm", "Outras despesas Adm",
    "ISS", "PIS", "COFINS", "Devoluções", "Parcelamento de Impostos", "Retenção de Contribuição",
    "(-) IOF", "(-) Juros", "(+) Receita financeira",
  ],
  investimento: ["(-) Compra de Equipamentos", "(-) Investimentos em Estrutura"],
  financiamento: ["(+) Novos Empréstimos & Financiamentos", "(-) Amortização de Financiamentos", "Antecipação", "Abatimento de Atencipação"],
  receitaBruta: ["Entradas", "Entrada de Receita"],
  receitaServ: ["Receita de Serviços", "Receita Markup"],
};

export type DashboardMetricas = {
  periodo: Periodo;
  receitaBruta: number;
  receitaLiquida: number;
  pessoal: number;
  mktVendas: number;
  custosOp: number;
  admImpFin: number;
  ebitda: number;
  margemEbitda: number; // %
  saldoCaixaInicial: number;
  fcl: number; // Fluxo de Caixa Livre
  fco: number; // Fluxo de Caixa Operacional
  fci: number; // Fluxo de Caixa Investimento
  fcf: number; // Fluxo de Caixa Financiamento
  novosEmprestimos: number;
  saldoCaixa: number;
  cashburn: number; // negativo se queimando
  burnMedio3m: number;
  runwayMeses: number;
};

function getMetrica(rows: HFRow[], periodo: Periodo, nome: string): number {
  const r = rows.find(
    (x) => x.ano === periodo.ano && x.mes === periodo.mes && x.metrica.toLowerCase() === nome.toLowerCase(),
  );
  return r ? Number(r.valor) : 0;
}

/**
 * Procura a primeira métrica explicitamente presente no período (case-insensitive)
 * e retorna seu valor. Útil para usar os totais já calculados na própria DRE/DFC
 * (Receita Bruta, Receita Líquida, EBITDA, Fluxo de Caixa Livre, ...).
 */
function getFirstMetrica(rows: HFRow[], periodo: Periodo, nomes: string[]): number | null {
  const lower = nomes.map((n) => n.toLowerCase());
  for (const nome of lower) {
    const r = rows.find(
      (x) => x.ano === periodo.ano && x.mes === periodo.mes && x.metrica.toLowerCase() === nome,
    );
    if (r) return Number(r.valor);
  }
  return null;
}

export function calcMetricas(
  rows: HFRow[],
  periodo: Periodo,
  saldoInicialJanela = 0,
): DashboardMetricas {
  // --- DRE (regime de competência) -----------------------------------------
  const receitaBrutaExp = getFirstMetrica(rows, periodo, ["Receita Bruta"]);
  const receitaLiquidaExp = getFirstMetrica(rows, periodo, ["Receita Líquida", "Receita Liquida"]);
  const ebitdaExp = getFirstMetrica(rows, periodo, ["EBITDA"]);
  const pessoalExp = getFirstMetrica(rows, periodo, ["Pessoal"]);
  const mktExp = getFirstMetrica(rows, periodo, ["Despesas Marketing & Vendas", "Despesas Marketing e Vendas"]);
  const custosOpExp = getFirstMetrica(rows, periodo, ["(-) Custos Operacionais", "Custos Operacionais"]);
  const admExp = getFirstMetrica(rows, periodo, ["Despesas Administrativas"]);

  const deducoes = Math.abs(sumMetrica(rows, periodo, ["PIS", "COFINS", "ISS", "Devoluções", "Simples Nacional", "ICMS", "Inadimplência"]));
  const receitaBruta = receitaBrutaExp != null
    ? Math.abs(receitaBrutaExp)
    : Math.abs(sumMetrica(rows, periodo, GRUPOS.receitaBruta) || sumMetrica(rows, periodo, GRUPOS.receitaServ));
  const receitaLiquida = receitaLiquidaExp != null
    ? Math.abs(receitaLiquidaExp)
    : receitaBruta - deducoes;

  const pessoal = pessoalExp != null
    ? Math.abs(pessoalExp)
    : Math.abs(sumMetrica(rows, periodo, GRUPOS.pessoal));
  const mktVendas = mktExp != null
    ? Math.abs(mktExp)
    : Math.abs(sumMetrica(rows, periodo, GRUPOS.mktVendas));
  const custosOp = custosOpExp != null
    ? Math.abs(custosOpExp)
    : Math.abs(sumMetrica(rows, periodo, GRUPOS.custosOp));
  const admImpFin = admExp != null
    ? Math.abs(admExp)
    : Math.max(0, Math.abs(sumMetrica(rows, periodo, GRUPOS.admImpFin)) - deducoes);

  const ebitda = ebitdaExp != null
    ? ebitdaExp
    : receitaLiquida - pessoal - mktVendas - custosOp - Math.max(0, admImpFin);
  const margemEbitda = receitaLiquida > 0 ? (ebitda / receitaLiquida) * 100 : 0;

  // --- DFC (regime de caixa) -----------------------------------------------
  const fcl = getFirstMetrica(rows, periodo, ["Fluxo de Caixa Livre", "Fluxo Livre"]) ?? 0;
  const fco = getFirstMetrica(rows, periodo, ["Fluxo de Caixa Operacional"]) ?? 0;
  const fci = getFirstMetrica(rows, periodo, ["Fluxo de Caixa de Investimentos"]) ?? 0;
  const fcf = getFirstMetrica(rows, periodo, ["Fluxo de Financiamento"]) ?? 0;
  const novosEmprestimos = getFirstMetrica(rows, periodo, [
    "(+) Novos Empréstimos & Financiamentos",
    "Novos Empréstimos & Instrumentos",
    "(+) Novos Emprestimos & Financiamentos",
  ]) ?? 0;

  // Saldo de caixa = saldo inicial + acumulado FCL até o período
  const todos = listarPeriodosDisponiveis(rows);
  let acumFcl = 0;
  for (const p of todos) {
    if (cmpPeriodo(p, periodo) > 0) break;
    acumFcl += getFirstMetrica(rows, p, ["Fluxo de Caixa Livre", "Fluxo Livre"]) ?? 0;
  }
  const saldoCaixa = saldoInicialJanela + acumFcl;

  // Cashburn = FCL excluindo captação extraordinária (novos empréstimos)
  const cashburn = fcl - novosEmprestimos;

  // Burn médio 3 meses
  const ult3 = [0, 1, 2].map((i) => subMeses(periodo, i));
  const burns = ult3.map((p) => {
    const f = getFirstMetrica(rows, p, ["Fluxo de Caixa Livre", "Fluxo Livre"]) ?? 0;
    const n = getFirstMetrica(rows, p, [
      "(+) Novos Empréstimos & Financiamentos",
      "Novos Empréstimos & Instrumentos",
    ]) ?? 0;
    return f - n;
  });
  const burnMedio3m = burns.reduce((s, x) => s + x, 0) / 3;
  const runwayMeses = burnMedio3m < 0 ? saldoCaixa / Math.abs(burnMedio3m) : Infinity;

  return {
    periodo,
    receitaBruta,
    receitaLiquida,
    pessoal,
    mktVendas,
    custosOp,
    admImpFin: Math.max(0, admImpFin),
    ebitda,
    margemEbitda,
    saldoCaixaInicial: saldoInicialJanela,
    fcl,
    fco,
    fci,
    fcf,
    novosEmprestimos,
    saldoCaixa,
    cashburn,
    burnMedio3m,
    runwayMeses,
  };
}

// Série mensal de uma métrica derivada calculada via calcMetricas (custoso mas n é baixo)
export function serieDerivada(
  rows: HFRow[],
  periodos: Periodo[],
  saldoInicial: number,
  pick: (m: DashboardMetricas) => number,
): Serie[] {
  return periodos.map((p) => ({
    periodo: p,
    label: periodoLabel(p),
    valor: pick(calcMetricas(rows, p, saldoInicial)),
  }));
}

// --- Status (Health Strip) ---------------------------------------------------

export type HealthStatus = "verde" | "ambar" | "vermelho";
export function calcStatus(m: DashboardMetricas): HealthStatus {
  if (m.runwayMeses < 3 || m.margemEbitda < -30) return "vermelho";
  if (m.runwayMeses < 6 || m.margemEbitda < -10) return "ambar";
  return "verde";
}

// --- Bridge de caixa ---------------------------------------------------------

export type BridgeStep = {
  key: string;
  label: string;
  subLabel: string; // "entrou" / "saiu" / "saldo"
  valor: number;    // sinalizado (+/-)
  acumulado: number; // saldo após o passo
  tipo: "anchor" | "in" | "out";
};

export function calcBridge(rows: HFRow[], periodo: Periodo, saldoInicial: number): BridgeStep[] {
  const ant = subMeses(periodo, 1);
  // saldo no fim do mês anterior
  const todos = listarPeriodosDisponiveis(rows);
  let saldoAnt = saldoInicial;
  for (const p of todos) {
    if (cmpPeriodo(p, ant) > 0) break;
    saldoAnt += getMetrica(rows, p, "Fluxo de Caixa Livre");
  }

  const entradas = Math.abs(sumMetrica(rows, periodo, GRUPOS.receitaBruta));
  const pessoal = -Math.abs(sumMetrica(rows, periodo, GRUPOS.pessoal));
  const mkt = -Math.abs(sumMetrica(rows, periodo, GRUPOS.mktVendas));
  const cop = -Math.abs(sumMetrica(rows, periodo, GRUPOS.custosOp));
  const adm = -Math.abs(sumMetrica(rows, periodo, GRUPOS.admImpFin) - sumMetrica(rows, periodo, ["PIS", "COFINS", "ISS", "Devoluções"]));
  const inv = getMetrica(rows, periodo, "Fluxo de Caixa de Investimentos");
  const fin = getMetrica(rows, periodo, "Fluxo de Financiamento");

  const steps: BridgeStep[] = [];
  let acc = saldoAnt;
  steps.push({ key: "saldo-ant", label: `Saldo ${periodoLabel(ant)}`, subLabel: "início", valor: saldoAnt, acumulado: acc, tipo: "anchor" });
  const push = (key: string, label: string, valor: number) => {
    acc += valor;
    steps.push({ key, label, subLabel: valor >= 0 ? "entrou" : "saiu", valor, acumulado: acc, tipo: valor >= 0 ? "in" : "out" });
  };
  push("entradas", "Entradas", entradas);
  push("pessoal", "Pessoal", pessoal);
  push("mkt", "Mkt & Vendas", mkt);
  push("custos", "Custos op.", cop);
  push("adm", "Adm/Imp/Fin", adm);
  push("inv", "Investimento", inv);
  push("fin", "Financiamento", fin);
  steps.push({ key: "saldo-atual", label: `Saldo ${periodoLabel(periodo)}`, subLabel: "fim", valor: acc, acumulado: acc, tipo: "anchor" });
  return steps;
}

// --- Ranking de despesas que mais cresceram ---------------------------------

export type RankingItem = {
  metrica: string;
  grupo: string;
  base: number;
  atual: number;
  crescPct: number;
};

const GRUPO_DE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const k of GRUPOS.pessoal) m[k] = "Pessoal";
  for (const k of GRUPOS.mktVendas) m[k] = "Mkt & Vendas";
  for (const k of GRUPOS.custosOp) m[k] = "Custos op.";
  for (const k of GRUPOS.admImpFin) m[k] = "Adm/Imp/Fin";
  return m;
})();

export function rankingCrescimento(rows: HFRow[], periodo: Periodo, top = 7): RankingItem[] {
  // base = média dos 6 meses anteriores ao período (excluindo o próprio)
  const baseMeses = [1, 2, 3, 4, 5, 6].map((i) => subMeses(periodo, i));
  const todasMetricas = Object.keys(GRUPO_DE);
  const items: RankingItem[] = todasMetricas.map((nome) => {
    const atual = Math.abs(getMetrica(rows, periodo, nome));
    const baseVals = baseMeses.map((p) => Math.abs(getMetrica(rows, p, nome)));
    const base = baseVals.reduce((s, x) => s + x, 0) / baseVals.length;
    const crescPct = base > 0 ? ((atual - base) / base) * 100 : (atual > 0 ? 100 : 0);
    return { metrica: nome, grupo: GRUPO_DE[nome], base, atual, crescPct };
  });
  return items
    .filter((i) => i.atual > 0 && i.crescPct > 5)
    .sort((a, b) => b.crescPct - a.crescPct)
    .slice(0, top);
}

// --- Detecção de anomalias (variação > 1.5 σ vs média móvel 6m) ----------

export type Anomalia = {
  metrica: string;
  grupo: string;
  periodo: Periodo;
  valor: number;
  media: number;
  desvio: number;
  zscore: number;
  severidade: "critico" | "atencao" | "info";
};

export function detectarAnomalias(rows: HFRow[], periodo: Periodo): Anomalia[] {
  const metricas = Object.keys(GRUPO_DE);
  const baseMeses = [1, 2, 3, 4, 5, 6].map((i) => subMeses(periodo, i));
  const out: Anomalia[] = [];
  for (const m of metricas) {
    const valor = Math.abs(getMetrica(rows, periodo, m));
    const baseVals = baseMeses.map((p) => Math.abs(getMetrica(rows, p, m))).filter((v) => v > 0);
    if (baseVals.length < 3) continue;
    const media = baseVals.reduce((s, x) => s + x, 0) / baseVals.length;
    const variancia = baseVals.reduce((s, x) => s + Math.pow(x - media, 2), 0) / baseVals.length;
    const desvio = Math.sqrt(variancia);
    if (desvio < 1) continue;
    const zscore = (valor - media) / desvio;
    if (Math.abs(zscore) < 1.5) continue;
    const severidade: Anomalia["severidade"] =
      Math.abs(zscore) >= 2.5 ? "critico" : Math.abs(zscore) >= 1.8 ? "atencao" : "info";
    out.push({ metrica: m, grupo: GRUPO_DE[m], periodo, valor, media, desvio, zscore, severidade });
  }
  return out.sort((a, b) => Math.abs(b.zscore) - Math.abs(a.zscore)).slice(0, 5);
}
