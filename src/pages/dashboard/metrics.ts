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

/* A DFC carrega DUAS linhas de fluxo livre: "Fluxo Livre" é o total canônico do
   esquema (FCO + investimento + financiamento) e "Fluxo de Caixa Livre" é o
   rótulo antigo, mantido como alias em DFC_SCHEMA. O blob guarda as duas lado a
   lado, e a velha ficou para trás no mês do empréstimo — jul/26 tem −218,3 mil
   na linha antiga contra +302,2 mil no total de verdade. Canônica primeiro. */
const FLUXO_LIVRE = ["Fluxo Livre", "Fluxo de Caixa Livre"];
const NOVOS_EMPRESTIMOS = [
  "(+) Novos Empréstimos & Financiamentos",
  "Novos Empréstimos & Instrumentos",
  "(+) Novos Emprestimos & Financiamentos",
];
const CASHBURN = "Cashburn";

/**
 * A queima do mês: o fluxo livre SEM a captação extraordinária.
 *
 * O valor GRAVADO manda. A DFC mantém a linha "Cashburn" preenchida mês a mês
 * (jan/24 até hoje) e é ela que a grade da DFC e a Revisão do Mês mostram — a
 * fórmula só entra no mês que o blob ainda não trouxe. Mesma ordem de
 * `cashburnDaDfc` em analisesDre.ts, para as três telas não contarem queimas
 * diferentes para o mesmo mês.
 *
 * Derivar sempre era subtrair o empréstimo de um fluxo livre que já estava
 * defasado, ou seja, descontar a captação duas vezes: jul/26 saía em −1,03
 * milhão onde a queima foi de −512,8 mil.
 */
function cashburnDoPeriodo(rows: HFRow[], periodo: Periodo): number {
  const gravado = getFirstMetrica(rows, periodo, [CASHBURN]);
  if (gravado != null) return gravado;
  const livre = getFirstMetrica(rows, periodo, FLUXO_LIVRE) ?? 0;
  return livre - (getFirstMetrica(rows, periodo, NOVOS_EMPRESTIMOS) ?? 0);
}

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
  /** Saldo consolidado do Omie (foto de hoje), quando disponível. */
  saldoReal: number | null;
  /** O saldo que o runway usou: o real quando existe, senão o estimado. */
  saldoRunway: number;
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
  /* Saldo consolidado do Omie. O runway sai DELE quando existe: o saldo
     estimado aqui do lado é uma soma de fluxos livres em cima de uma semente
     digitada à mão, e dividir a queima por ele dava meses de vida que o extrato
     não sustenta. Mesma fonte que /caixa, a Revisão do Mês e o mobile leem. */
  saldoReal: number | null = null,
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
  const fcl = getFirstMetrica(rows, periodo, FLUXO_LIVRE) ?? 0;
  const fco = getFirstMetrica(rows, periodo, ["Fluxo de Caixa Operacional"]) ?? 0;
  const fci = getFirstMetrica(rows, periodo, ["Fluxo de Caixa de Investimentos"]) ?? 0;
  const fcf = getFirstMetrica(rows, periodo, ["Fluxo de Financiamento"]) ?? 0;
  const novosEmprestimos = getFirstMetrica(rows, periodo, NOVOS_EMPRESTIMOS) ?? 0;

  // Saldo de caixa = saldo inicial + acumulado FCL até o período
  const todos = listarPeriodosDisponiveis(rows);
  let acumFcl = 0;
  for (const p of todos) {
    if (cmpPeriodo(p, periodo) > 0) break;
    acumFcl += getFirstMetrica(rows, p, FLUXO_LIVRE) ?? 0;
  }
  const saldoCaixa = saldoInicialJanela + acumFcl;

  // Cashburn = fluxo livre excluindo captação extraordinária (ver cashburnDoPeriodo)
  const cashburn = cashburnDoPeriodo(rows, periodo);

  // Burn médio 3 meses — a mesma queima, na janela que termina no período
  const ult3 = [0, 1, 2].map((i) => subMeses(periodo, i));
  const burnMedio3m = ult3.reduce((s, p) => s + cashburnDoPeriodo(rows, p), 0) / 3;
  const saldoRunway = saldoReal ?? saldoCaixa;
  const runwayMeses = burnMedio3m < 0 ? saldoRunway / Math.abs(burnMedio3m) : Infinity;

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
    saldoReal,
    saldoRunway,
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

// --- Cascata da DRE ----------------------------------------------------------

export type CascataStep = {
  key: string;
  label: string;
  subLabel: string;  // "faturado" / "saiu" / "margem X%"
  valor: number;     // sinalizado (+/-)
  acumulado: number; // subtotal depois do passo
  tipo: "anchor" | "in" | "out";
};

/**
 * Cascata da DRE do mês (competência): como a Receita Bruta vira EBITDA.
 * As âncoras são os subtotais da própria DRE — Receita Bruta, Receita Líquida
 * e EBITDA — e entre elas entram as deduções e os grupos de despesa. Os
 * números saem de calcMetricas, então a cascata bate com os KPIs do topo.
 */
export function calcCascataDRE(rows: HFRow[], periodo: Periodo): CascataStep[] {
  const m = calcMetricas(rows, periodo);
  if (!m.receitaBruta && !m.ebitda) return [];

  const deducoes = Math.max(0, m.receitaBruta - m.receitaLiquida);
  const steps: CascataStep[] = [];
  let acc = m.receitaBruta;

  steps.push({
    key: "receita-bruta",
    label: "Receita Bruta",
    subLabel: "faturado",
    valor: m.receitaBruta,
    acumulado: acc,
    tipo: "anchor",
  });

  const push = (key: string, label: string, valor: number, subLabel?: string) => {
    acc += valor;
    steps.push({
      key,
      label,
      subLabel: subLabel ?? (valor >= 0 ? "entrou" : "saiu"),
      valor,
      acumulado: acc,
      tipo: valor >= 0 ? "in" : "out",
    });
  };

  // Sem deduções relevantes a coluna da líquida repetiria a bruta — pula as duas.
  if (deducoes > m.receitaBruta * 0.005) {
    push("deducoes", "Deduções", -deducoes, "impostos");
    steps.push({
      key: "receita-liquida",
      label: "Receita Líq.",
      subLabel: "base",
      valor: m.receitaLiquida,
      acumulado: m.receitaLiquida,
      tipo: "anchor",
    });
    acc = m.receitaLiquida;
  }

  push("pessoal", "Pessoal", -m.pessoal);
  push("mkt", "Mkt & Vendas", -m.mktVendas);
  push("custos", "Custos op.", -m.custosOp);
  push("adm", "Adm/Imp/Fin", -m.admImpFin);

  // O EBITDA da planilha pode não fechar com a soma dos grupos (linha fora dos
  // grupos conhecidos); a diferença material vira uma coluna própria.
  const residual = m.ebitda - acc;
  if (Math.abs(residual) > Math.max(1000, Math.abs(m.receitaLiquida) * 0.005)) {
    push("outros", "Outros", residual);
  }

  steps.push({
    key: "ebitda",
    label: "EBITDA",
    subLabel: `margem ${m.margemEbitda.toFixed(1).replace(".", ",")}%`,
    valor: m.ebitda,
    acumulado: m.ebitda,
    tipo: "anchor",
  });

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
