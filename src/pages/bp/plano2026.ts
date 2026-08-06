/**
 * Premissas operacionais do BP 2026 — abas Geral, Operação e Equipe da planilha.
 *
 * ⚠️ Estes números são **fallback**, não a fonte. O importador guarda todas as
 * abas da planilha em `bp_anual` e a aba Equipe já é lida de verdade (ver
 * ./equipe.ts): quando ela existe, o quadro de cargos, o headcount por área e as
 * contratações vêm do banco e as constantes daqui ficam só para BPs importados
 * antes disso. As abas Geral e Operação ainda não têm parser, então CANAIS,
 * PORTES, FUNIL e GATILHOS continuam valendo como constante.
 *
 * Ao trocar por dados reais, mantenha a forma dos tipos — os componentes só
 * dependem deles, não deste arquivo.
 *
 * Fonte: revisão do 2º semestre de 2026 (vRevisão 2S).
 */

/* ------------------------------------------------------------------ *
 *  Versão vigente
 * ------------------------------------------------------------------ */

export type VersaoBP = {
  rotulo: string;
  descricao: string;
  vigente: boolean;
};

export const VERSAO_VIGENTE: VersaoBP = {
  rotulo: "vRevisão 2S",
  descricao: "Revisão do 2º semestre · reforço comercial, nova sede e time de tecnologia",
  vigente: true,
};

/* ------------------------------------------------------------------ *
 *  Operação — funil, canais e unit economics
 * ------------------------------------------------------------------ */

export type CanalAquisicao = {
  canal: string;
  investimento: number;
  clientes: number;
};

/** Investimento e clientes gerados no ano por canal. CAC = investimento / clientes. */
export const CANAIS: CanalAquisicao[] = [
  { canal: "Inbound", investimento: 1_570_000, clientes: 1_897 },
  { canal: "Eventos", investimento: 1_476_000, clientes: 252 },
  { canal: "Parcerias · Consultores e Influenciadores", investimento: 252_500, clientes: 269 },
  { canal: "Outbound", investimento: 109_000, clientes: 696 },
  { canal: "MGM · indicação de clientes", investimento: 95_300, clientes: 208 },
  { canal: "Parcerias · Contadores", investimento: 63_000, clientes: 80 },
  { canal: "Parcerias · Agências e Revenda", investimento: 48_500, clientes: 96 },
  { canal: "Franquias e Flagships", investimento: 24_000, clientes: 251 },
];

export type PorteCliente = {
  porte: string;
  clientesDez: number;
  mrrDez: number;
  ticket: number;
  /** Churn mensal da base desse porte. */
  churn: number;
};

export const PORTES: PorteCliente[] = [
  { porte: "Pequeno · P", clientesDez: 999, mrrDez: 195_000, ticket: 189, churn: 0.07 },
  { porte: "Médio · M", clientesDez: 995, mrrDez: 297_000, ticket: 297, churn: 0.04 },
  { porte: "Grande · G", clientesDez: 1_415, mrrDez: 617_000, ticket: 431, churn: 0.035 },
  { porte: "Enterprise · GG", clientesDez: 727, mrrDez: 524_000, ticket: 730, churn: 0.02 },
];

/** Margem de contribuição usada no cálculo de LTV por porte. */
export const MARGEM_CONTRIBUICAO_LTV = 0.73;
/** CAC total = investimento de canal + comissão comercial. */
export const CAC_TOTAL = 1_350;
/** Base de clientes no fim de dezembro/2025, ponto de partida do funil. */
export const BASE_INICIAL = 2_074;

export type FunilMensal = {
  leads: number[];
  novasContas: number[];
  contasPerdidas: number[];
  /** Base ao fim de cada mês, como projetada na planilha. */
  baseFimMes: number[];
  novoMrr: number[];
};

/**
 * Funil mês a mês. Dezembro foi reconstruído a partir dos totais do ano
 * (3.754 novas contas, 1.431 perdidas, 4.136 clientes em dez) porque a coluna
 * estava cortada na planilha de origem — confira antes de usar em decisão.
 */
export const FUNIL: FunilMensal = {
  leads:          [2_171, 2_367, 2_595, 2_840, 2_888, 3_137, 3_188, 3_194, 3_221, 3_266, 3_313, 3_360],
  novasContas:    [  167,   182,   221,   298,   329,   372,   313,   330,   368,   394,   419,   361],
  contasPerdidas: [   94,    95,    95,    98,   106,   114,   123,   128,   134,   139,   147,   158],
  baseFimMes:     [2_147, 2_234, 2_360, 2_560, 2_783, 2_780, 2_970, 3_172, 3_406, 3_661, 3_933, 4_136],
  novoMrr:        [63_000, 68_000, 83_000, 112_000, 123_000, 141_000, 119_000, 125_000, 140_000, 149_000, 159_000, 168_000],
};

export const TICKET_MEDIO = { inicio: 374.56, fim: 379.18 };

/* ------------------------------------------------------------------ *
 *  Equipe — headcount e quadro de cargos
 * ------------------------------------------------------------------ */

export const AREAS = ["Administrativo", "Marketing", "Comercial", "Operacional", "Onboarding", "Tecnologia"] as const;
export type Area = (typeof AREAS)[number];

/**
 * Cada área do headcount tem uma linha de custo correspondente na DRE — e é
 * também o rótulo do bloco dela na aba Equipe ("4.1.Equipe Administrativa").
 */
export const LINHA_DE_CUSTO: Record<Area, string> = {
  Administrativo: "Equipe Administrativa",
  Marketing: "Equipe Marketing",
  Comercial: "Equipe Comercial",
  Operacional: "Equipe Operacional",
  Onboarding: "Equipe Onboarding",
  Tecnologia: "Equipe Tecnologia",
};

/**
 * Headcount por área, mês a mês — fallback de quando a aba Equipe não foi
 * importada. Administrativo e Marketing saem exatos do QUADRO abaixo (soma dos
 * cargos por mês de entrada); as outras quatro estão distribuídas só para
 * fechar o total mensal do plano (87 em jan → 148 em dez).
 */
export const HEADCOUNT_POR_AREA: Record<Area, number[]> = {
  Administrativo: [8, 9, 9, 10, 10, 12, 12, 12, 13, 13, 14, 14],
  Marketing:      [6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7],
  Comercial:      [30, 33, 37, 45, 46, 48, 49, 49, 51, 53, 54, 56],
  Operacional:    [22, 23, 25, 28, 29, 30, 31, 31, 32, 33, 33, 34],
  Onboarding:     [12, 13, 14, 17, 18, 19, 19, 20, 21, 21, 22, 23],
  Tecnologia:     [9, 10, 11, 12, 13, 13, 13, 13, 13, 14, 14, 14],
};

/** Contratações por mês — 61 no ano, com pico de 16 em abril. */
export const CONTRATACOES = [0, 7, 8, 16, 4, 6, 3, 1, 5, 4, 3, 4];

export const CUSTO_KIT_ONBOARDING = 4_500;
export const BENEFICIO_POR_PESSOA = 520;

export type Cargo = {
  grupo: string;
  cargo: string;
  area: Area;
  /** Remuneração base mensal; null para vaga ainda não aberta. */
  remBase: number | null;
  modelo: "PJ" | "CLT" | "Estágio";
  reajuste: "diretoria" | "key" | "base";
  /** Mês de entrada (0-11); null quando não há entrada no ano. */
  entrada: number | null;
  qtdJan: number;
  qtdDez: number;
};

/**
 * Quadro detalhado por cargo — fallback de quando a aba Equipe não foi
 * importada.
 *
 * ⚠️ Cobre apenas Executivos, Backoffice e Marketing: foi transcrito à mão de um
 * recorte parcial da planilha. O quadro completo (todas as áreas) vem da aba
 * Equipe, em ./equipe.ts.
 */
export const QUADRO: Cargo[] = [
  { grupo: "Executivos", cargo: "CEO", area: "Administrativo", remBase: 25_000, modelo: "PJ", reajuste: "diretoria", entrada: 0, qtdJan: 1, qtdDez: 1 },
  { grupo: "Executivos", cargo: "CRO", area: "Administrativo", remBase: 20_000, modelo: "PJ", reajuste: "diretoria", entrada: 0, qtdJan: 1, qtdDez: 1 },
  { grupo: "Executivos", cargo: "CTO", area: "Administrativo", remBase: 20_000, modelo: "PJ", reajuste: "diretoria", entrada: 0, qtdJan: 1, qtdDez: 1 },
  { grupo: "Executivos", cargo: "COO", area: "Administrativo", remBase: null, modelo: "PJ", reajuste: "diretoria", entrada: null, qtdJan: 0, qtdDez: 0 },
  { grupo: "Executivos", cargo: "CFO", area: "Administrativo", remBase: null, modelo: "PJ", reajuste: "diretoria", entrada: null, qtdJan: 0, qtdDez: 0 },

  { grupo: "Backoffice", cargo: "Analista Financeiro", area: "Administrativo", remBase: 5_000, modelo: "PJ", reajuste: "base", entrada: 0, qtdJan: 1, qtdDez: 2 },
  { grupo: "Backoffice", cargo: "Estagiário Financeiro", area: "Administrativo", remBase: 1_000, modelo: "PJ", reajuste: "base", entrada: 5, qtdJan: 0, qtdDez: 1 },
  { grupo: "Backoffice", cargo: "Head de Pessoas", area: "Administrativo", remBase: 10_000, modelo: "PJ", reajuste: "key", entrada: 1, qtdJan: 0, qtdDez: 1 },
  { grupo: "Backoffice", cargo: "Analista de Pessoas", area: "Administrativo", remBase: 4_250, modelo: "PJ", reajuste: "base", entrada: 0, qtdJan: 1, qtdDez: 1 },
  { grupo: "Backoffice", cargo: "Estagiário Pessoas", area: "Administrativo", remBase: 1_000, modelo: "PJ", reajuste: "base", entrada: 5, qtdJan: 0, qtdDez: 1 },
  { grupo: "Backoffice", cargo: "Head de Automações", area: "Administrativo", remBase: 13_000, modelo: "PJ", reajuste: "key", entrada: 0, qtdJan: 1, qtdDez: 1 },
  { grupo: "Backoffice", cargo: "Analista de Automações", area: "Administrativo", remBase: 4_750, modelo: "PJ", reajuste: "base", entrada: 0, qtdJan: 2, qtdDez: 4 },

  { grupo: "Marketing", cargo: "Gerente de Marketing", area: "Marketing", remBase: 10_000, modelo: "PJ", reajuste: "key", entrada: 6, qtdJan: 0, qtdDez: 1 },
  { grupo: "Marketing", cargo: "Analista de Marketing", area: "Marketing", remBase: 4_500, modelo: "PJ", reajuste: "base", entrada: 0, qtdJan: 4, qtdDez: 4 },
  { grupo: "Marketing", cargo: "Coord. Inbound", area: "Marketing", remBase: 6_000, modelo: "PJ", reajuste: "key", entrada: 0, qtdJan: 1, qtdDez: 1 },
  { grupo: "Marketing", cargo: "Analista de Performance", area: "Marketing", remBase: 5_000, modelo: "PJ", reajuste: "base", entrada: 0, qtdJan: 1, qtdDez: 1 },
];

/** Áreas ainda sem cargos detalhados — mostrado como aviso na aba Equipe. */
export const AREAS_SEM_QUADRO: Area[] = ["Comercial", "Operacional", "Onboarding", "Tecnologia"];

/* ------------------------------------------------------------------ *
 *  Premissas — indexadores, tributos e gatilhos de custo
 * ------------------------------------------------------------------ */

export const MODELOS_CONTRATACAO = [
  { modelo: "PJ", multiplicador: 1.0 },
  { modelo: "CLT", multiplicador: 1.65 },
  { modelo: "Estagiários", multiplicador: 1.2 },
];

export const INDICES_REAJUSTE = [
  { grupo: "Diretoria", indice: 0.12 },
  { grupo: "Key people", indice: 0.07 },
  { grupo: "Demais cargos", indice: 0.03 },
];

export const REGIME_TRIBUTARIO = {
  regime: "Lucro Real",
  tributos: [
    { sigla: "PIS", valor: "0,65%" },
    { sigla: "COFINS", valor: "3,00%" },
    { sigla: "ISS", valor: "2,00%" },
    { sigla: "IRPJ", valor: "15% + 10%" },
    { sigla: "CSLL", valor: "9,00%" },
    { sigla: "Margem presumida", valor: "32%" },
  ],
  nota: "Com prejuízo fiscal em 2026, IRPJ e CSLL saem zerados na DRE.",
};

export type GatilhoCusto = {
  rubrica: string;
  indexador: string;
  regra: string;
  minimoFixo: number | null;
  teto: number | null;
};

/** O que faz cada linha de custo crescer — aba Geral + Operação do BP. */
export const GATILHOS: GatilhoCusto[] = [
  { rubrica: "Infraestrutura", indexador: "MRR", regra: "8,0%", minimoFixo: null, teto: 10_000_000 },
  { rubrica: "Premiação Operacional", indexador: "MRR", regra: "3,0%", minimoFixo: null, teto: null },
  { rubrica: "Meios de Pagamento", indexador: "MRR", regra: "2,0%", minimoFixo: null, teto: null },
  { rubrica: "Devoluções", indexador: "MRR", regra: "2,0%", minimoFixo: null, teto: 10_000_000 },
  { rubrica: "CMV Materiais", indexador: "MRR", regra: "1,0%", minimoFixo: null, teto: 10_000_000 },
  { rubrica: "Softwares Operacionais", indexador: "Clientes EoP", regra: "R$ 16 / cliente", minimoFixo: null, teto: null },
  { rubrica: "Comissões", indexador: "Novo MRR", regra: "100%", minimoFixo: null, teto: null },
  { rubrica: "Ocupação & Escritório", indexador: "Headcount", regra: "R$ 300 / pessoa", minimoFixo: 55_000, teto: 10_000_000 },
  { rubrica: "Benefícios", indexador: "Headcount", regra: "R$ 520 / pessoa", minimoFixo: null, teto: null },
  { rubrica: "Softwares Administrativos", indexador: "Headcount", regra: "R$ 50 / pessoa", minimoFixo: 5_000, teto: 20_000 },
  { rubrica: "Outras Despesas Adm", indexador: "Headcount", regra: "R$ 70 / pessoa", minimoFixo: null, teto: 12_000 },
  { rubrica: "Kit Novos Colaboradores", indexador: "Contratações", regra: "R$ 4.500 / entrada", minimoFixo: null, teto: null },
  { rubrica: "Sistemas de Marketing e Vendas", indexador: "HC Aquisição", regra: "R$ 400 / pessoa", minimoFixo: null, teto: 1_000_000 },
  { rubrica: "Viagens & Transportes", indexador: "Receita bruta", regra: "0,5%", minimoFixo: null, teto: 7_800 },
  { rubrica: "Contabilidade", indexador: "Receita bruta", regra: "0,2%", minimoFixo: 1_690, teto: 4_500 },
  { rubrica: "Receita Spot · Markup", indexador: "Clientes EoP", regra: "R$ 4,20 / cliente", minimoFixo: null, teto: null },
];

export const MUDANCAS_REVISAO = [
  {
    titulo: "Reforço da equipe comercial",
    valor: "+1% da RB",
    detalhe: "Linha adicional a partir de julho, ~R$ 18 mil/mês.",
  },
  {
    titulo: "Nova sede",
    valor: "R$ 55 mil/mês",
    detalhe: "Ocupação passa a ter mínimo fixo a partir de maio.",
  },
  {
    titulo: "Adicional equipe tech",
    valor: "R$ 725 / HC tech",
    detalhe: "Entra em julho sobre o headcount de tecnologia.",
  },
  {
    titulo: "Corte de inbound em dez",
    valor: "R$ 150 K → 100 K",
    detalhe: "Redução do investimento no último mês do ano.",
  },
];
