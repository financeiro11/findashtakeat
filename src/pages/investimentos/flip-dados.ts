// ============================================================================
// Os números e os fatos do flip da Takeat — dezembro de 2025.
//
// POR QUE ISTO ESTÁ EM CÓDIGO, E NÃO NO BANCO
// O flip fechou. Estes valores saíram dos contratos assinados (SPA, Contribution
// Agreements, Certificate of Incorporation) e do cap table consolidado de
// 18/dez/2025 — são um TESTEMUNHO, não um estado que a ferramenta administra.
// Nada aqui muda porque alguém mexeu numa tela; se mudar, mudou porque um
// documento novo foi assinado, e aí a alteração passa por revisão de código.
//
// A FONTE
// Os quatro cadernos em Drive (pasta "Flip") — Panorama, Etapa 1 (LLC),
// Etapa 2 (Cayman) e Etapa 3 (Flip & Series A). O texto integral deles está em
// `flip-documentos.ts`; aqui ficam só os dados estruturados, que a tela
// desenha em quadro, gráfico e linha do tempo.
//
// O cap table de fechamento também alimenta o simulador em /captable — é a
// única foto documentada que existe da capitalização, e por isso ela é a base
// de qualquer simulação de rodada futura.
// ============================================================================

export const FECHAMENTO_ISO = "2025-12-22";
export const FECHAMENTO_LABEL = "22 de dezembro de 2025";
export const TOTAL_ACOES = 100_000;
/** Câmbio implícito da rodada: BRL 13.739.500 / USD 2.494.009,81. */
export const CAMBIO_RODADA = 5.5090;

/* ---------------------------------------------------------------- entidades */

export interface Entidade {
  id: "holding" | "llc" | "ltda";
  nome: string;
  tipo: string;
  jurisdicao: string;
  bandeira: string;
  papel: string;
  nascimento: string;
  campos: { rotulo: string; valor: string }[];
}

export const ENTIDADES: Entidade[] = [
  {
    id: "holding",
    nome: "Takeat Holding Ltd.",
    tipo: "Exempted company",
    jurisdicao: "Ilhas Cayman",
    bandeira: "🇰🇾",
    papel: "Holding de topo — emite as ações detidas pelos acionistas",
    nascimento: "6 de outubro de 2025",
    campos: [
      { rotulo: "Registro", valor: "426581 (CB-426581)" },
      { rotulo: "Incorporação", valor: "6/out/2025 — Express Incorporation (Campbells)" },
      { rotulo: "Capital autorizado", valor: "US$ 1.000 — 100.000 ações × US$ 0,01" },
      { rotulo: "Sede registrada", valor: "Campbells Corporate Services, Floor 4, Willow House, Cricket Square, Grand Cayman" },
      { rotulo: "Autoridade", valor: "Assistant Registrar of Companies (Lisa Moore-Jervis)" },
      { rotulo: "Diretor na constituição", valor: "Miguel Macedo de Carvalho Filho" },
    ],
  },
  {
    id: "llc",
    nome: "Takeat LLC",
    tipo: "Limited Liability Company",
    jurisdicao: "Delaware, EUA",
    bandeira: "🇺🇸",
    papel: "Veículo intermediário — detentora direta da operação brasileira",
    nascimento: "3 de outubro de 2025",
    campos: [
      { rotulo: "EIN", valor: "32-0831325 — atribuído em 30/out/2025 pelo IRS" },
      { rotulo: "Nº de arquivamento", valor: "129813822 (Delaware)" },
      { rotulo: "Endereço registrado", valor: "251 Little Falls Drive, Wilmington, New Castle County, DE 19808" },
      { rotulo: "Agente registrado", valor: "Corporation Service Company (CSC)" },
      { rotulo: "Administração", valor: "Manager-managed — Miguel como sole Manager and Member" },
      { rotulo: "Constituída por", valor: "CuboStart LLC (Miami)" },
    ],
  },
  {
    id: "ltda",
    nome: "Takeat Tecnologia Ltda.",
    tipo: "Sociedade limitada",
    jurisdicao: "Brasil — Vitória/ES",
    bandeira: "🇧🇷",
    papel: "Empresa operacional — mantém atividade, contratos e faturamento",
    nascimento: "Anterior ao flip",
    campos: [
      { rotulo: "Capital", valor: "1.000 quotas — 100% contribuídas à holding e descidas para a LLC" },
      { rotulo: "Administração", valor: "Miguel Macedo de Carvalho Filho" },
      { rotulo: "Atos do flip", valor: "Alteração do contrato social (ACS) e procurações para a Junta Comercial (JUCESP)" },
      { rotulo: "Investimento estrangeiro", valor: "Registro RDE-IED no Banco Central do Brasil" },
    ],
  },
];

/* ------------------------------------------------------------ linha do tempo */

export type GrupoMarco = "estrutura" | "flip" | "pos";

export interface Marco {
  data: string;
  dataCurta: string;
  titulo: string;
  descricao: string;
  grupo: GrupoMarco;
}

export const LINHA_DO_TEMPO: Marco[] = [
  {
    data: "3 de outubro de 2025", dataCurta: "03/out/25", grupo: "estrutura",
    titulo: "Constituição da Takeat LLC (Delaware)",
    descricao: "Certificate of Formation e LLC Agreement assinados no mesmo dia. Miguel entra como sócio e administrador único, com 100 units — 100% da LLC.",
  },
  {
    data: "6 de outubro de 2025", dataCurta: "06/out/25", grupo: "estrutura",
    titulo: "Incorporação da Takeat Holding Ltd. (Cayman)",
    descricao: "Express Incorporation pela Campbells. A Campbells Nominees subscreve a primeira ação, nomeia Miguel primeiro diretor e transfere a ação a ele no mesmo envelope.",
  },
  {
    data: "8 de outubro de 2025", dataCurta: "08/out/25", grupo: "estrutura",
    titulo: "Affidavit de constituição",
    descricao: "Declaração de conformidade (KYC) firmada perante a CuboStart: veracidade das informações, origem lícita dos recursos e ciência das obrigações fiscais.",
  },
  {
    data: "30 de outubro de 2025", dataCurta: "30/out/25", grupo: "estrutura",
    titulo: "EIN da LLC atribuído pelo IRS",
    descricao: "EIN 32-0831325 — o equivalente ao CNPJ nos Estados Unidos, necessário para contas bancárias e contratos.",
  },
  {
    data: "19 a 22 de dezembro de 2025", dataCurta: "19–22/dez/25", grupo: "flip",
    titulo: "Assinatura dos documentos do flip e da rodada",
    descricao: "Três envelopes DocuSign conduzidos pelo Baptista Luz: Flip, Approvals e Financing Agreements.",
  },
  {
    data: "22 de dezembro de 2025", dataCurta: "22/dez/25", grupo: "flip",
    titulo: "Etapa 1 do flip — BR e LLC para Cayman",
    descricao: "Subscription and Contribution Agreement: os sócios contribuem quotas da Ltda. e participações na LLC à holding, recebendo 45.146 ações em troca.",
  },
  {
    data: "22 de dezembro de 2025", dataCurta: "22/dez/25", grupo: "flip",
    titulo: "Etapa 2 do flip — Cayman para LLC",
    descricao: "Deed of Contribution: a holding desce as 1.000 quotas da Ltda. para dentro da LLC. Fica a cadeia Cayman → Delaware → Brasil.",
  },
  {
    data: "22 de dezembro de 2025", dataCurta: "22/dez/25", grupo: "flip",
    titulo: "Series Seed & Series A (SPA) e Memorando alterado",
    descricao: "Fechamento da rodada: USD 2,49M de dinheiro novo, conversão de BRL 2,185M em notas e SAFEs, e adoção do Memorando e Artigos que criam as classes preferenciais.",
  },
  {
    data: "22 de dezembro de 2025", dataCurta: "22/dez/25", grupo: "flip",
    titulo: "Aprovações societárias e acordos acessórios",
    descricao: "Director Resolutions, Shareholder Resolutions e Written Consent da LLC; Voting Agreement, IRA, ROFRA, indenizações, restrição de ações e recompra.",
  },
  {
    data: "até 30 de dezembro de 2025", dataCurta: "30/dez/25", grupo: "flip",
    titulo: "Pagamento das ações Series A",
    descricao: "O Closing ocorreu na data do contrato; o desembolso dos sete investidores foi concluído até 30/dez.",
  },
  {
    data: "ao longo de 2026", dataCurta: "2026", grupo: "pos",
    titulo: "Pós-fechamento",
    descricao: "Formalização das transferências de ações, registro do investimento estrangeiro (RDE-IED), atualização na Junta Comercial e serviços societários e contábeis recorrentes.",
  },
];

/* -------------------------------------------------- a rodada: preços e tickets */

export interface PrecoClasse { classe: string; usd: number; ano?: string; nota?: string }

/** Valor nominal de todas: US$ 0,01. */
export const PRECOS_POR_ACAO: PrecoClasse[] = [
  { classe: "Series A", usd: 90.76, ano: "2025", nota: "A rodada nova" },
  { classe: "Series Seed-3", usd: 67.68, ano: "2024" },
  { classe: "Series Seed-2", usd: 13.20, ano: "2022" },
  { classe: "Series Seed-1", usd: 2.23, ano: "2020" },
  { classe: "Series Seed-4", usd: 0, ano: "—", nota: "Secondary, sem aporte de capital novo" },
];

export interface TicketSerieA {
  investidor: string;
  veiculo?: string;
  lead?: boolean;
  acoes: number;
  usd: number;
}

export const SERIE_A: TicketSerieA[] = [
  { investidor: "DGF 8, L.P.", veiculo: "DGF Investimentos — Frederico Greve", lead: true, acoes: 24_000, usd: 2_178_253.77 },
  { investidor: "Acelera Espírito Santo Ltda", veiculo: "Fundo/aceleradora capixaba (FUNSES)", acoes: 3_050, usd: 276_819.75 },
  { investidor: "Marcel Martins Malczewski", veiculo: "M3 Invest", acoes: 276, usd: 25_049.92 },
  { investidor: "Luis Cláudio Silva Frade", veiculo: "Anjo", acoes: 51, usd: 4_628.79 },
  { investidor: "Andries Oudshoorn", veiculo: "Anjo", acoes: 51, usd: 4_628.79 },
  { investidor: "Flávio José Moritz Jr.", veiculo: "Anjo", acoes: 31, usd: 2_813.58 },
  { investidor: "Peter Celso Godoi", veiculo: "Somar", acoes: 20, usd: 1_815.21 },
];

export const SERIE_A_TOTAL = { acoes: 27_479, usd: 2_494_009.81, brl: 13_739_500 };

export interface ConversaoSeed {
  investidor: string;
  classe: "Seed-1" | "Seed-2" | "Seed-3";
  acoes: number;
  brl: number;
}

/** Notas conversíveis e SAFEs anteriores que viraram ação no fechamento. */
export const CONVERSOES_SEED: ConversaoSeed[] = [
  { investidor: "Guilherme Ferroni Ferreira", classe: "Seed-1", acoes: 5_706, brl: 70_000 },
  { investidor: "Acelera Espírito Santo Ltda", classe: "Seed-2", acoes: 5_502, brl: 400_000 },
  { investidor: "Acelera Espírito Santo Ltda", classe: "Seed-3", acoes: 1_448, brl: 540_000 },
  { investidor: "Marcel Martins Malczewski", classe: "Seed-3", acoes: 724, brl: 270_000 },
  { investidor: "Alya Ventures", classe: "Seed-3", acoes: 215, brl: 80_000 },
  { investidor: "Luis Cláudio Silva Frade", classe: "Seed-3", acoes: 134, brl: 50_000 },
  { investidor: "Peter Celso Godoi", classe: "Seed-3", acoes: 54, brl: 20_000 },
  { investidor: "Flávio José Moritz Jr.", classe: "Seed-3", acoes: 80, brl: 30_000 },
  { investidor: "Andries Oudshoorn", classe: "Seed-3", acoes: 134, brl: 50_000 },
  { investidor: "Gustavo do Valle Fehlberg", classe: "Seed-3", acoes: 363, brl: 135_000 },
  { investidor: "Rafael Guerino Furlanetti", classe: "Seed-3", acoes: 1_448, brl: 540_000 },
];

export const SEED_TOTAL = { acoes: 15_808, brl: 2_185_000 };

/** Do dinheiro que entrou, o que já tinha destino carimbado. */
export const USO_DOS_RECURSOS = {
  texto:
    "Os recursos destinam-se a propósitos corporativos gerais — sobretudo desenvolvimento de produto e capital de giro.",
  recompra:
    "Do total, BRL 800 mil foram reservados para a recompra de certas ações Class B Ordinary e Series Seed-1 e de opções concedidas a prestadores, formalizada no Share Repurchase Agreement.",
  recompraBrl: 800_000,
};

/* ------------------------------------------------- o que os sócios receberam */

export interface LinhaScheduleI {
  socio: string;
  contribuido: string;
  recebido: string;
  acoes: number;
  classe: string;
}

/** "Schedule I" do Subscription and Contribution Agreement. */
export const SCHEDULE_I: LinhaScheduleI[] = [
  {
    socio: "Miguel M. de Carvalho Filho",
    contribuido: "100 units da LLC + 952 quotas da Ltda. (95,17%)",
    recebido: "42.968 Class B Ordinary",
    acoes: 42_968,
    classe: "Class B Ordinary",
  },
  {
    socio: "Rafael Guerino Furlanetti",
    contribuido: "48 quotas da Ltda. (4,83%)",
    recebido: "2.178 Series Seed-4 Preference",
    acoes: 2_178,
    classe: "Series Seed-4 Preference",
  },
];

export const SCHEDULE_I_TOTAL = 45_146;

/* ------------------------------------------------------- cap table pós-rodada */

export type TipoSocio = "fundador" | "pool" | "fundo" | "anjo";

export interface LinhaCapTable {
  socio: string;
  tipo: TipoSocio;
  ordinarias: number;
  seed: number;
  serieA: number;
  total: number;
  pct: number;
}

/**
 * Foto de 18/dez/2025 — capital totalmente diluído, 100.000 ações.
 * Os percentuais são os do documento; a tela recalcula sobre o total e confere.
 */
export const CAP_TABLE: LinhaCapTable[] = [
  { socio: "Miguel Carvalho", tipo: "fundador", ordinarias: 42_969, seed: 0, serieA: 0, total: 42_969, pct: 42.97 },
  { socio: "DGF", tipo: "fundo", ordinarias: 0, seed: 0, serieA: 24_000, total: 24_000, pct: 24.0 },
  { socio: "Pool de opções (SOP)", tipo: "pool", ordinarias: 11_566, seed: 0, serieA: 0, total: 11_566, pct: 11.57 },
  { socio: "Acelera Espírito Santo (FUNSES)", tipo: "fundo", ordinarias: 0, seed: 6_950, serieA: 3_050, total: 10_000, pct: 10.0 },
  { socio: "Guilherme Ferreira", tipo: "anjo", ordinarias: 0, seed: 5_706, serieA: 0, total: 5_706, pct: 5.71 },
  { socio: "Rafael Furlanetti", tipo: "anjo", ordinarias: 0, seed: 3_626, serieA: 0, total: 3_626, pct: 3.63 },
  { socio: "M3 Investimentos (Marcel)", tipo: "fundo", ordinarias: 0, seed: 724, serieA: 276, total: 1_000, pct: 1.0 },
  { socio: "Gustavo Fehlberg", tipo: "anjo", ordinarias: 0, seed: 363, serieA: 0, total: 363, pct: 0.36 },
  { socio: "Alya Ventures / Sidecar", tipo: "fundo", ordinarias: 0, seed: 215, serieA: 0, total: 215, pct: 0.22 },
  { socio: "Luis C. S. Frade", tipo: "anjo", ordinarias: 0, seed: 134, serieA: 51, total: 185, pct: 0.19 },
  { socio: "Andries Oudshoorn", tipo: "anjo", ordinarias: 0, seed: 134, serieA: 51, total: 185, pct: 0.19 },
  { socio: "Flávio Moritz Jr.", tipo: "anjo", ordinarias: 0, seed: 80, serieA: 31, total: 111, pct: 0.11 },
  { socio: "Peter Celso Godoi", tipo: "anjo", ordinarias: 0, seed: 54, serieA: 20, total: 74, pct: 0.07 },
];

export const CAP_TABLE_TOTAIS = { ordinarias: 54_535, seed: 17_986, serieA: 27_479, total: 100_000 };

/**
 * Nota de rótulo que vale mais do que parece: no cap table final (após o
 * Memorando alterado) as ações do fundador aparecem como Class A Ordinary e o
 * pool como Class B Ordinary; nos instrumentos do flip, as do fundador eram
 * Class B. Mesma titularidade, nome diferente — quem cruza os dois papéis
 * precisa saber disso antes de achar que sumiu ação.
 */
export const NOTA_CLASSES =
  "No cap table final (após a adoção do Memorando e Artigos alterados), as ações ordinárias do fundador aparecem como Class A Ordinary e o pool de opções como Class B Ordinary. Nos instrumentos do flip, as ações do fundador eram referidas como Class B Ordinary — é reclassificação de rótulo, sem mudança de titularidade.";

/* --------------------------------------------------------------- governança */

export interface Diretor { nome: string; observacao: string }

export const CONSELHO: Diretor[] = [
  { nome: "Miguel Macedo de Carvalho Filho", observacao: "Fundador e CEO" },
  { nome: "Marcel Martins Malczewski", observacao: "Ligado à M3 Invest" },
  { nome: "João Gabriel Coser de Orem", observacao: "Indicado nos termos do Voting Agreement" },
  { nome: "Luiz Paulo de Castro Chácara", observacao: "Indicado nos termos do Voting Agreement" },
  { nome: "Rodrigo Simões Miranda", observacao: "Indicado nos termos do Voting Agreement" },
];

export interface Acordo { nome: string; funcao: string }

export const ACORDOS_ACESSORIOS: Acordo[] = [
  { nome: "Voting Agreement", funcao: "Composição do conselho e acordos de voto entre os acionistas" },
  { nome: "Investors' Rights Agreement (IRA)", funcao: "Direitos de informação, de registro e de acompanhamento dos investidores" },
  { nome: "Right of First Refusal & Co-Sale (ROFRA)", funcao: "Direito de preferência e de venda conjunta de ações" },
  { nome: "Indemnification Agreements", funcao: "Indenização de cada um dos cinco diretores no exercício do cargo" },
  { nome: "Shares Restriction Agreement (Miguel)", funcao: "Restrições às ações do fundador (ex.: vesting/lock-up)" },
  { nome: "Share Repurchase Agreement", funcao: "Recompra de ações Class B / Series Seed-1 e de opções (BRL 800 mil)" },
  { nome: "FUNSES Side Letter", funcao: "Carta de condições específicas com investidor" },
];

export const APROVACOES: Acordo[] = [
  { nome: "Director Resolutions", funcao: "Deliberação do diretor da holding: aprova os documentos, autoriza a emissão das ações Class B ao fundador (100 + 42.868) e nomeia os novos diretores" },
  { nome: "Shareholder Resolutions", funcao: "Deliberação dos acionistas da holding" },
  { nome: "Written Consent (Takeat LLC)", funcao: "Consentimento escrito do sócio da LLC de Delaware" },
];

/* --------------------------------------------------------------- assessores */

export interface Assessor { nome: string; papel: string; pessoas?: string }

export const ASSESSORES: Assessor[] = [
  {
    nome: "Campbells (Cayman)",
    papel: "Assessoria jurídica de Cayman, agente registrado, subscritor nominal da incorporação e documentos da rodada",
    pessoas: "Sayak Bhattacharya · Denise Tibbetts · A. Goodman-Jones",
  },
  {
    nome: "Baptista Luz (Brasil)",
    papel: "Assessoria jurídica brasileira do flip e da rodada; condução dos envelopes DocuSign",
    pessoas: "Julia Noca Machado · Milena Tesser · Alexandre Gustavo de Freitas",
  },
  {
    nome: "CuboStart LLC (Miami, EUA)",
    papel: "Constituição da LLC em Delaware, obtenção do EIN e serviços de CFO-as-a-Service / contábil",
    pessoas: "Maria Cristina Adao Tordin",
  },
  {
    nome: "Corporation Service Company (CSC)",
    papel: "Agente registrado da Takeat LLC em Delaware",
  },
];

/* -------------------------------------------------------------- glossário */

export interface VerbeteGlossario { termo: string; texto: string }

export const GLOSSARIO: VerbeteGlossario[] = [
  { termo: "Flip", texto: "Reorganização que coloca uma holding no exterior no controle de uma operação brasileira, para viabilizar investimento internacional." },
  { termo: "Exempted company (Cayman)", texto: "Tipo societário de Cayman voltado a negócios conduzidos majoritariamente fora das ilhas; é a forma da holding de topo." },
  { termo: "LLC (Delaware)", texto: "“Limited liability company” — sociedade norte-americana de responsabilidade limitada; aqui, o veículo intermediário entre a holding e o Brasil." },
  { termo: "Quotas × ações", texto: "A Ltda. brasileira tem o capital dividido em quotas; a holding de Cayman, em ações (shares). No flip, quotas viram ações." },
  { termo: "Class B Ordinary Shares", texto: "Ações ordinárias dos fundadores na holding (controle/voto), sem as preferências dos investidores." },
  { termo: "Series Seed / Series A Preference Shares", texto: "Ações preferenciais dos investidores, com direitos econômicos e políticos superiores aos das ordinárias (preferência em liquidez, etc.)." },
  { termo: "SAFE / nota conversível", texto: "Instrumentos de captação que não são ações de imediato, mas se convertem em ações numa rodada futura — foi o que ocorreu na conversão em Series Seed." },
  { termo: "SPA (Share Purchase Agreement)", texto: "Contrato principal da rodada: define quem compra, qual classe, a que preço e sob quais condições." },
  { termo: "Voting Agreement", texto: "Acordo que define a composição do conselho e como os acionistas votam em certas matérias." },
  { termo: "Investors' Rights Agreement (IRA)", texto: "Garante aos investidores direitos de informação, de registro e outros direitos de acompanhamento." },
  { termo: "ROFR / Co-Sale (ROFRA)", texto: "Direito de preferência na compra de ações e direito de vender junto quando outro acionista vende." },
  { termo: "Acordo de indenização", texto: "Compromisso da companhia de cobrir despesas e responsabilidades dos diretores no exercício do cargo." },
  { termo: "RDE-IED (Banco Central)", texto: "Registro eletrônico obrigatório do investimento estrangeiro direto na empresa brasileira." },
  { termo: "Registered agent", texto: "Agente local que recebe citações e mantém o endereço registrado da entidade (CSC em Delaware; Campbells em Cayman)." },
  { termo: "Capital totalmente diluído", texto: "Considera todas as ações como se já emitidas, inclusive o estoque reservado a opções (o SOP), ainda não atribuído a pessoas específicas." },
];

/* ------------------------------------------------------ os quatro cadernos */

export interface DocDrive {
  numero: number;
  titulo: string;
  etapa: string;
  conteudo: string;
  driveId: string;
  url: string;
}

/** Pasta "Flip" no Drive — os .docx originais, para quem precisa do arquivo. */
export const DOCS_DRIVE: DocDrive[] = [
  {
    numero: 1, titulo: "Panorama Geral do Flip", etapa: "Visão geral",
    conteudo: "História, estrutura, linha do tempo, agentes, a rodada em números e o glossário",
    driveId: "1u7hv5cQslCcivD5XAiuUJeTzNeNK9XnW",
    url: "https://drive.google.com/file/d/1u7hv5cQslCcivD5XAiuUJeTzNeNK9XnW/view",
  },
  {
    numero: 2, titulo: "Estrutura nos EUA (Takeat LLC)", etapa: "Etapa 1",
    conteudo: "Certificate of Formation, LLC Agreement, affidavit e EIN",
    driveId: "1tPsrVfdMmWOlre-hKOaaQpgMVsYuZ35O",
    url: "https://drive.google.com/file/d/1tPsrVfdMmWOlre-hKOaaQpgMVsYuZ35O/view",
  },
  {
    numero: 3, titulo: "Holding de Cayman", etapa: "Etapa 2",
    conteudo: "Certificado de incorporação, Memorando e Artigos, registros e agente",
    driveId: "1TAVsAXgHxyEcU93hcuG-vCsU5Sm7RXPP",
    url: "https://drive.google.com/file/d/1TAVsAXgHxyEcU93hcuG-vCsU5Sm7RXPP/view",
  },
  {
    numero: 4, titulo: "Flip & Series A", etapa: "Etapa 3",
    conteudo: "Contribution Agreements, SPA e cap table, aprovações e acordos acessórios",
    driveId: "1ANslnv4DTIEQlxpIXTQJZqKqVu41Gssg",
    url: "https://drive.google.com/file/d/1ANslnv4DTIEQlxpIXTQJZqKqVu41Gssg/view",
  },
];

export const PASTA_DRIVE = "https://drive.google.com/drive/folders/1h-Vv1FP1WArvJxZZmBIOykc0DBSzCnYj";
