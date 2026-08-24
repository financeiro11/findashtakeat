// ============================================================================
// Os quatro cadernos do flip, na íntegra.
//
// POR QUE O TEXTO INTEIRO ESTÁ AQUI
// Os .docx moram no Drive e continuam lá (links em `DOCS_DRIVE`), mas abrir o
// Drive é sair do Hub, baixar 300 KB de Word e perder o contexto. Quem está
// olhando o cap table e topa com "Series Seed-4" precisa da explicação NA
// MESMA TELA — e a explicação existe, escrita pelo Financeiro em junho/2026.
//
// O texto foi transcrito dos documentos, sem reescrita: os parágrafos, as
// caixas explicativas ("O que é um flip?"), os quadros e as notas de rodapé
// são os de lá. As figuras dos .docx são imagens que não vieram na leitura —
// no lugar de cada uma fica a legenda e o apontamento para a aba do Hub que
// desenha a mesma coisa.
//
// Estrutura em blocos (e não HTML numa string) porque a tela precisa estilizar
// cada tipo: caixa explicativa tem cara de caixa, quadro tem cara de tabela, e
// tudo isso muda entre o tema claro e o escuro.
// ============================================================================

export type Bloco =
  /** Parágrafo corrido. */
  | { t: "p"; texto: string }
  /** As caixas cinzas do documento — "O que é uma LLC de Delaware?" e afins. */
  | { t: "destaque"; titulo: string; texto: string }
  /** Lista de pontos, cada um com um começo em negrito. */
  | { t: "lista"; itens: { titulo?: string; texto: string }[] }
  /** Quadro. `totalUltima` deixa a última linha em destaque. */
  | { t: "tabela"; colunas: string[]; linhas: string[][]; totalUltima?: boolean }
  /** Figura do .docx: a imagem não veio; fica a legenda e para onde olhar. */
  | { t: "figura"; legenda: string; veja?: string };

export interface Secao {
  numero: string;
  titulo: string;
  blocos: Bloco[];
}

export interface Documento {
  numero: number;
  titulo: string;
  subtitulo: string;
  etapa: string;
  meta: { rotulo: string; valor: string }[];
  aviso: string;
  secoes: Secao[];
  notas: string[];
}

const META_COMUM = (documento: string) => [
  { rotulo: "Grupo", valor: "Takeat — Takeat Holding Ltd. · Takeat LLC · Takeat Tecnologia Ltda." },
  { rotulo: "Documento", valor: documento },
  { rotulo: "Classificação", valor: "Uso interno / data room — Confidencial" },
  { rotulo: "Data-base", valor: "22 de dezembro de 2025 (fechamento da operação)" },
  { rotulo: "Elaboração", valor: "Financeiro — Takeat · junho de 2026" },
];

const AVISO_CADERNO =
  "Documento de uso interno, parte da consolidação documental do flip da Takeat. Elaborado a partir dos documentos societários assinados e das faturas dos assessores. Não constitui aconselhamento jurídico ou tributário.";

/* ========================================================================== */
/* Documento 1 — Panorama Geral                                               */
/* ========================================================================== */

const DOC1: Documento = {
  numero: 1,
  titulo: "Panorama Geral do Flip",
  subtitulo: "Reestruturação societária internacional e rodada Series Seed & Series A",
  etapa: "Visão geral",
  meta: META_COMUM("1 de 4 — Panorama Geral do flip"),
  aviso:
    "Documento de uso interno. Consolida, em linguagem acessível, a história e a estrutura do flip da Takeat a partir dos documentos societários assinados e das faturas dos assessores. Não constitui aconselhamento jurídico ou tributário.",
  secoes: [
    {
      numero: "1",
      titulo: "Sumário executivo",
      blocos: [
        {
          t: "p",
          texto:
            "Em dezembro de 2025, a Takeat concluiu uma reestruturação societária conhecida no mercado de venture capital como “flip”: a operação que transferiu o controle do negócio — antes detido diretamente pelos fundadores no Brasil — para uma holding constituída no exterior. No mesmo ato, a empresa fechou uma rodada de investimento que combinou aporte novo de Series A com a conversão de instrumentos de dívida anteriores em ações preferenciais Series Seed.",
        },
        {
          t: "p",
          texto:
            "Ao final, a estrutura passou a ter três níveis: uma holding em Cayman no topo, uma LLC em Delaware no meio e a operação brasileira na base. A atividade da empresa permaneceu integralmente na Takeat Tecnologia Ltda.; o que mudou foi a cadeia de controle acima dela.",
        },
        {
          t: "destaque",
          titulo: "O que é um “flip”?",
          texto:
            "É a reorganização pela qual uma empresa operacional brasileira passa a ser controlada por uma holding no exterior (tipicamente nas Ilhas Cayman), em vez de pertencer diretamente aos sócios pessoas físicas. Faz-se isso para receber investimento estrangeiro com a segurança jurídica, a língua (inglês) e os instrumentos contratuais que fundos internacionais conhecem e exigem — e para simplificar futuras rodadas, vendas ou um eventual IPO.",
        },
        {
          t: "destaque",
          titulo: "De relance",
          texto:
            "Topo: Takeat Holding Ltd. (Cayman, exempted company, reg. 426581). Meio: Takeat LLC (Delaware, EIN 32-0831325). Base: Takeat Tecnologia Ltda. (Brasil, Vitória/ES) — empresa operacional. Fechamento: 22 de dezembro de 2025. Investidor-líder: DGF 8, L.P. (DGF Investimentos). Aporte novo (Series A): ≈ USD 2,49 milhões.",
        },
      ],
    },
    {
      numero: "2",
      titulo: "A estrutura final hoje",
      blocos: [
        {
          t: "p",
          texto:
            "A figura abaixo mostra a cadeia societária resultante do flip. Cada nível detém 100% do nível imediatamente inferior, de modo que a holding de Cayman controla, de forma indireta, toda a operação no Brasil.",
        },
        { t: "figura", legenda: "Figura 1 — Estrutura societária da Takeat após o flip", veja: "aba Estrutura" },
        {
          t: "p",
          texto:
            "A Takeat Holding Ltd. é uma “exempted company” incorporada nas Ilhas Cayman em 6 de outubro de 2025 ¹. É nela que os acionistas — fundadores e investidores — passam a deter suas ações. A Takeat LLC, de Delaware, formada em 3 de outubro de 2025, funciona como veículo intermediário e detentora direta da operação brasileira ². A Takeat Tecnologia Ltda., sediada em Vitória/ES, é a empresa que de fato opera o produto, contrata e fatura no Brasil.",
        },
      ],
    },
    {
      numero: "3",
      titulo: "A transformação: antes e depois",
      blocos: [
        {
          t: "p",
          texto:
            "Antes do flip, os fundadores detinham, lado a lado e sem vínculo entre si, a Takeat LLC e a Takeat Tecnologia Ltda. O flip uniu as duas sob a nova holding, em duas etapas societárias encadeadas, ambas com fechamento em 22 de dezembro de 2025.",
        },
        { t: "figura", legenda: "Figura 2 — A reorganização do controle: de entidades paralelas para uma holding única", veja: "aba Estrutura" },
        {
          t: "p",
          texto:
            "Na primeira etapa (Subscription and Contribution Agreement, “BR and LLC to Cayman”), os fundadores contribuíram à holding tanto suas quotas da Ltda. brasileira quanto suas participações na LLC, recebendo em troca ações da holding de Cayman. Na segunda etapa (Deed of Contribution, “Cayman to LLC”), a holding desceu as quotas brasileiras para dentro da LLC, posicionando-a como detentora direta da operação ³.",
        },
        {
          t: "destaque",
          titulo: "Por que Cayman e Delaware ao mesmo tempo?",
          texto:
            "Cayman oferece o regime societário de preferência dos fundos internacionais (direito flexível, contratos em inglês, neutralidade tributária na holding). Delaware acrescenta uma camada jurídica norte-americana sólida e familiar a investidores dos EUA. A combinação holding-Cayman sobre LLC-Delaware é um arranjo recorrente em startups brasileiras que captam capital lá fora.",
        },
        {
          t: "p",
          texto:
            "A operação exige ainda o registro do investimento estrangeiro junto ao Banco Central do Brasil (RDE-IED) e a atualização do contrato social da Ltda. — providências conduzidas pelo escritório brasileiro, com procurações específicas para a Junta Comercial (JUCESP).",
        },
      ],
    },
    {
      numero: "4",
      titulo: "Linha do tempo",
      blocos: [
        {
          t: "p",
          texto:
            "A montagem da estrutura e a rodada concentraram-se entre outubro e dezembro de 2025, com desdobramentos ao longo de 2026.",
        },
        { t: "figura", legenda: "Figura 3 — Principais marcos da operação", veja: "aba Linha do tempo" },
        {
          t: "p",
          texto:
            "As duas entidades foram constituídas primeiro (LLC em 3/out, holding em 6/out), seguidas da obtenção do EIN da LLC junto ao IRS em 30/out. O flip e a rodada foram assinados e fechados entre 19 e 22 de dezembro de 2025. Ao longo de 2026 seguem-se atos de pós-fechamento — formalização de transferências de ações e serviços societários e contábeis recorrentes.",
        },
      ],
    },
    {
      numero: "5",
      titulo: "Os agentes e seus papéis",
      blocos: [
        {
          t: "p",
          texto:
            "A operação envolveu três entidades do grupo, três prestadores especializados e um conjunto de pessoas-chave.",
        },
        {
          t: "tabela",
          colunas: ["Entidade", "Jurisdição", "Papel na estrutura"],
          linhas: [
            ["Takeat Holding Ltd.", "Ilhas Cayman", "Holding de topo; emite as ações detidas pelos acionistas"],
            ["Takeat LLC", "Delaware, EUA", "Veículo intermediário; detentora direta da operação brasileira"],
            ["Takeat Tecnologia Ltda.", "Brasil (Vitória/ES)", "Empresa operacional; mantém a atividade, contratos e faturamento"],
          ],
        },
        {
          t: "tabela",
          colunas: ["Assessor", "Função"],
          linhas: [
            ["Campbells (Cayman)", "Assessoria jurídica de Cayman, agente registrado e subscritor da incorporação"],
            ["Baptista Luz (Brasil)", "Assessoria jurídica brasileira do flip e da rodada"],
            ["CuboStart LLC (Miami, EUA)", "Constituição da LLC em Delaware, EIN e serviços de CFO-as-a-Service / contábil"],
            ["Corporation Service Company (CSC)", "Agente registrado da LLC em Delaware"],
          ],
        },
        {
          t: "p",
          texto:
            "Miguel Macedo de Carvalho Filho é o fundador e CEO; figura como diretor único da holding de Cayman e como sócio-administrador único da LLC de Delaware, além de administrador da Ltda. brasileira. Após a rodada, o conselho da holding passou a contar com cinco membros, indicados nos termos do Voting Agreement: Miguel, Marcel Martins Malczewski, João Gabriel Coser de Orem, Luiz Paulo de Castro Chácara e Rodrigo Simões Miranda — cada um com seu acordo de indenização.",
        },
        {
          t: "p",
          texto:
            "Do lado dos assessores, conduziram o trabalho jurídico Sayak Bhattacharya e A. Goodman-Jones (Campbells) e as advogadas Julia Noca Machado e Milena Tesser (Baptista Luz) ⁴; na CuboStart, o contato foi Maria Cristina Adao Tordin.",
        },
      ],
    },
    {
      numero: "6",
      titulo: "A rodada em números",
      blocos: [
        {
          t: "p",
          texto:
            "A rodada formaliza-se no Series Seed and Series A Preference Shares Purchase Agreement (22/dez/2025) e veio acompanhada da adoção de um Memorando e Artigos de Associação alterados — a constituição da holding na versão pós-rodada, que cria as classes de ações preferenciais. A pilha de preferências ficou em cinco camadas (Series Seed-1 a Seed-4 e Series A).",
        },
        {
          t: "destaque",
          titulo: "Preços por ação (valor nominal US$ 0,01)",
          texto: "Series A: US$ 90,76 · Series Seed-3: US$ 67,68 · Series Seed-2: US$ 13,20 · Series Seed-1: US$ 2,23",
        },
        { t: "p", texto: "O dinheiro novo da Series A somou USD 2.494.009,81, distribuído entre sete investidores:" },
        {
          t: "tabela",
          colunas: ["Investidor (Series A)", "Ações", "Valor (USD)"],
          totalUltima: true,
          linhas: [
            ["DGF 8, L.P. (lead)", "24.000", "2.178.253,77"],
            ["Acelera Espírito Santo Ltda", "3.050", "276.819,75"],
            ["Marcel Martins Malczewski (M3 Invest)", "276", "25.049,92"],
            ["Luis Cláudio Silva Frade", "51", "4.628,79"],
            ["Andries Oudshoorn", "51", "4.628,79"],
            ["Flávio José Moritz Jr.", "31", "2.813,58"],
            ["Peter Celso Godoi (Somar)", "20", "1.815,21"],
            ["Total", "27.479", "2.494.009,81"],
          ],
        },
        {
          t: "p",
          texto:
            "Além do aporte novo, notas conversíveis e SAFEs anteriores foram convertidos em ações Series Seed-1/2/3, somando BRL 2.185.000,00 (15.808 ações). Entre os convertentes estão Guilherme Ferroni Ferreira, Acelera Espírito Santo, Marcel Martins Malczewski, Alya Ventures, Rafael Guerino Furlanetti e Gustavo do Valle Fehlberg. O detalhamento por investidor consta do Documento 4. ⁵",
        },
        {
          t: "p",
          texto:
            "No fechamento, o capital totalmente diluído da holding (100.000 ações) ficou assim distribuído: o fundador detém cerca de 43%; o investidor-líder, DGF, 24%; o pool de opções (SOP), aproximadamente 11,6%; e a Acelera/FUNSES, 10% — com os demais investidores somando o restante. O cap table consolidado completo está no Documento 4.",
        },
        {
          t: "destaque",
          titulo: "Uso dos recursos",
          texto:
            "Os recursos destinam-se a propósitos corporativos gerais (sobretudo desenvolvimento de produto e capital de giro). Do total, BRL 800 mil foram reservados para a recompra de certas ações Class B Ordinary e Series Seed-1 e de opções concedidas a prestadores — formalizada no Share Repurchase Agreement.",
        },
      ],
    },
    {
      numero: "7",
      titulo: "Governança e documentos acessórios",
      blocos: [
        {
          t: "p",
          texto:
            "Com a entrada dos investidores, a holding passou a operar sob um arcabouço típico de Series A. Os documentos acessórios assinados em 22/dez/2025 incluem o Voting Agreement (composição do conselho e acordos de voto), o Investors’ Rights Agreement (IRA) (direitos de informação e registro), o Right of First Refusal and Co-Sale Agreement (ROFRA) (preferência e venda conjunta), os acordos de indenização dos cinco diretores, o Shares Restriction Agreement do fundador e o Share Repurchase Agreement.",
        },
      ],
    },
    {
      numero: "8",
      titulo: "Glossário",
      blocos: [
        {
          t: "lista",
          itens: [
            { titulo: "Flip", texto: "reorganização que coloca uma holding no exterior no controle de uma operação brasileira, para viabilizar investimento internacional." },
            { titulo: "Exempted company (Cayman)", texto: "tipo societário de Cayman voltado a negócios conduzidos majoritariamente fora das ilhas; é a forma da holding de topo." },
            { titulo: "LLC (Delaware)", texto: "“limited liability company” — sociedade norte-americana de responsabilidade limitada; aqui, o veículo intermediário entre a holding e o Brasil." },
            { titulo: "Quotas × ações", texto: "a Ltda. brasileira tem o capital dividido em quotas; a holding de Cayman, em ações (shares). No flip, quotas viram ações." },
            { titulo: "Class B Ordinary Shares", texto: "ações ordinárias dos fundadores na holding (controle/voto), sem as preferências dos investidores." },
            { titulo: "Series Seed / Series A Preference Shares", texto: "ações preferenciais dos investidores, com direitos econômicos e políticos superiores aos das ordinárias (preferência em liquidez, etc.)." },
            { titulo: "SAFE / nota conversível", texto: "instrumentos de captação que não são ações de imediato, mas se convertem em ações numa rodada futura — foi o que ocorreu na conversão em Series Seed." },
            { titulo: "SPA (Share Purchase Agreement)", texto: "contrato principal da rodada: define quem compra, qual classe, a que preço e sob quais condições." },
            { titulo: "Voting Agreement", texto: "acordo que define a composição do conselho e como os acionistas votam em certas matérias." },
            { titulo: "Investors’ Rights Agreement (IRA)", texto: "garante aos investidores direitos de informação, de registro e outros direitos de acompanhamento." },
            { titulo: "ROFR / Co-Sale (ROFRA)", texto: "direito de preferência na compra de ações e direito de vender junto quando outro acionista vende." },
            { titulo: "Acordo de indenização", texto: "compromisso da companhia de cobrir despesas e responsabilidades dos diretores no exercício do cargo." },
            { titulo: "RDE-IED (Banco Central)", texto: "registro eletrônico obrigatório do investimento estrangeiro direto na empresa brasileira." },
            { titulo: "Registered agent", texto: "agente local que recebe citações e mantém o endereço registrado da entidade (CSC em Delaware; Campbells em Cayman)." },
          ],
        },
      ],
    },
    {
      numero: "9",
      titulo: "Mapa dos documentos",
      blocos: [
        { t: "p", texto: "Os documentos que comprovam cada etapa estão organizados em três cadernos complementares a este Panorama:" },
        {
          t: "tabela",
          colunas: ["Caderno", "Etapa", "Conteúdo principal"],
          linhas: [
            ["Documento 2", "Estrutura nos EUA", "Constituição da Takeat LLC (Delaware), LLC Agreement, affidavit e EIN"],
            ["Documento 3", "Holding de Cayman", "Incorporação da Takeat Holding Ltd., Memorando e Artigos, registros e agente"],
            ["Documento 4", "Flip & Series A", "Contribution Agreements, SPA e cap table, aprovações e acordos acessórios"],
          ],
        },
      ],
    },
  ],
  notas: [
    "Certificate of Incorporation, Takeat Holding Ltd., reg. nº 426581, 6/out/2025 (Campbells).",
    "Certificate of Formation e LLC Agreement da Takeat LLC, 3/out/2025; EIN 32-0831325 atribuído em 30/out/2025 (IRS, via CuboStart).",
    "Subscription and Contribution Agreement (BR and LLC to Cayman) e Deed of Contribution (Cayman to LLC), ambos de 22/dez/2025.",
    "Julia Noca Machado e Milena Tesser aparecem como “J. Machado” e “M. Tesser” nas faturas da Campbells.",
    "Schedule of Purchasers (Exhibit A) do SPA, 22/dez/2025.",
  ],
};

/* ========================================================================== */
/* Documento 2 — Etapa 1: Takeat LLC (Delaware)                               */
/* ========================================================================== */

const DOC2: Documento = {
  numero: 2,
  titulo: "Estrutura nos Estados Unidos",
  subtitulo: "Etapa 1 — Constituição da Takeat LLC (Delaware)",
  etapa: "Etapa 1",
  meta: META_COMUM("2 de 4 — Etapa 1: estrutura nos EUA"),
  aviso: AVISO_CADERNO,
  secoes: [
    {
      numero: "1",
      titulo: "Visão geral da etapa",
      blocos: [
        {
          t: "p",
          texto:
            "A primeira peça do flip foi a montagem da estrutura norte-americana. Em 3 de outubro de 2025, constituiu-se a Takeat LLC no estado de Delaware, tendo o fundador como sócio e administrador único. A constituição foi conduzida pela CuboStart LLC, prestadora de serviços corporativos sediada em Miami.",
        },
        {
          t: "p",
          texto:
            "Embora criada antes da holding de Cayman, a LLC só assume seu papel definitivo no flip: torna-se o veículo intermediário que, ao final, detém diretamente a operação brasileira e é integralmente controlado pela holding. Nesta etapa, porém, ela nasce simples — com um único sócio e nenhuma subsidiária.",
        },
        {
          t: "destaque",
          titulo: "O que é uma LLC de Delaware?",
          texto:
            "“Limited liability company” é a sociedade de responsabilidade limitada norte-americana. Delaware é o estado preferido para constituí-la pela solidez e previsibilidade de seu direito societário. Uma LLC pode ter um único sócio (“single-member”) e ser administrada por um gestor (“manager-managed”), oferecendo limitação de responsabilidade com baixa formalidade — daí seu uso como elo intermediário em estruturas internacionais.",
        },
        { t: "figura", legenda: "Figura 1 — Titularidade da Takeat LLC na constituição", veja: "aba Estrutura" },
      ],
    },
    {
      numero: "2",
      titulo: "O Certificate of Formation",
      blocos: [
        {
          t: "p",
          texto:
            "O “Certificate of Formation” é o ato que dá existência legal à LLC perante a Divisão de Sociedades de Delaware. O documento da Takeat LLC traz os elementos essenciais da entidade:",
        },
        {
          t: "tabela",
          colunas: ["Campo", "Conteúdo"],
          linhas: [
            ["Denominação", "Takeat LLC"],
            ["Tipo", "Limited Liability Company (Delaware)"],
            ["Data", "3 de outubro de 2025"],
            ["Endereço registrado", "251 Little Falls Drive, Wilmington, New Castle County, DE 19808"],
            ["Agente registrado", "Corporation Service Company (CSC)"],
            ["Pessoa autorizada", "Miguel Macedo de Carvalho Filho"],
            ["Nº de arquivamento", "129813822"],
          ],
        },
        {
          t: "destaque",
          titulo: "O que faz o Certificate of Formation?",
          texto:
            "É a “certidão de nascimento” da LLC. Define o nome, o endereço registrado e o agente registrado — mas não trata da governança interna nem da participação dos sócios, que ficam no LLC Agreement (seção seguinte).",
        },
        { t: "p", texto: "O documento foi executado eletronicamente (DocuSign) e arquivado em Delaware sob o número acima ¹." },
      ],
    },
    {
      numero: "3",
      titulo: "O LLC Agreement",
      blocos: [
        {
          t: "p",
          texto:
            "Se o Certificate of Formation cria a entidade, o Limited Liability Company Agreement (também de 3 de outubro de 2025) define como ela funciona. Pontos centrais:",
        },
        {
          t: "lista",
          itens: [
            {
              titulo: "Sócio e administrador único",
              texto:
                "Miguel Macedo de Carvalho Filho figura como “sole Manager and Member”. A LLC é “manager-managed”: a administração e as decisões cabem ao gestor, que detém poderes amplos para conduzir os negócios e pode nomear officers (CEO, presidente, etc.).",
            },
            {
              titulo: "Responsabilidade e indenização",
              texto:
                "As obrigações da LLC são exclusivamente dela; o sócio não responde pessoalmente por elas. O acordo prevê ainda indenização ao gestor e ao sócio por atos praticados de boa-fé no exercício da função, ressalvadas culpa grave ou dolo.",
            },
            {
              titulo: "Participação (Schedule A)",
              texto:
                "O anexo de capital atribui a Miguel 100 units, equivalentes a 100% da LLC. São exatamente essas 100 units que, no flip, serão contribuídas à holding de Cayman em troca de ações Class B Ordinary.",
            },
          ],
        },
        {
          t: "destaque",
          titulo: "“Manager-managed” e sócio único",
          texto:
            "Numa LLC “member-managed”, todos os sócios administram; numa “manager-managed”, a gestão é delegada a um gestor (que pode ou não ser sócio). Aqui, fundador, sócio e gestor são a mesma pessoa — o que mantém o controle concentrado e a operação enxuta nesta fase inicial.",
        },
        { t: "p", texto: "O acordo só pode ser alterado com o consentimento escrito do sócio ²." },
      ],
    },
    {
      numero: "4",
      titulo: "A declaração de constituição (Affidavit)",
      blocos: [
        {
          t: "p",
          texto:
            "Em 8 de outubro de 2025, o fundador firmou uma declaração (affidavit) endereçada à CuboStart LLC, atestando que as informações e documentos fornecidos para a constituição da empresa em Delaware são verdadeiros, que os recursos a serem investidos têm origem lícita e que está ciente de eventuais obrigações fiscais e de reporte em seu país de domicílio. É um documento típico de conformidade (KYC), exigido pela prestadora de serviços, e não um ato societário da LLC ³.",
        },
      ],
    },
    {
      numero: "5",
      titulo: "O EIN (número fiscal federal)",
      blocos: [
        {
          t: "p",
          texto:
            "Para operar e abrir contas nos Estados Unidos, a LLC precisa de um número de identificação fiscal federal — o EIN. Em 30 de outubro de 2025, o IRS atribuiu à Takeat LLC o EIN 32-0831325, em processo conduzido pela CuboStart.",
        },
        {
          t: "tabela",
          colunas: ["Campo", "Conteúdo"],
          linhas: [
            ["Entidade", "TAKEAT LLC"],
            ["EIN", "32-0831325"],
            ["Atribuído em", "30 de outubro de 2025"],
            ["Emissor", "Internal Revenue Service (IRS) — EIN Unit"],
          ],
        },
        {
          t: "destaque",
          titulo: "O que é o EIN?",
          texto:
            "O “Employer Identification Number” é o CNPJ norte-americano: identifica a entidade perante a Receita federal dos EUA (IRS) e é necessário para contas bancárias, contratos e obrigações fiscais.",
        },
        { t: "p", texto: "A confirmação foi emitida pelo IRS e recebida pela CuboStart ⁴." },
      ],
    },
    {
      numero: "6",
      titulo: "Agentes e documentos desta etapa",
      blocos: [
        {
          t: "tabela",
          colunas: ["Agente", "Papel nesta etapa"],
          linhas: [
            ["CuboStart LLC (Miami, EUA)", "Constituição da LLC em Delaware, obtenção do EIN e serviços corporativos"],
            ["Corporation Service Company (CSC)", "Agente registrado da LLC em Delaware"],
            ["Miguel M. de Carvalho Filho", "Sócio e administrador único; signatário de todos os atos"],
          ],
        },
        {
          t: "tabela",
          colunas: ["Documento", "Data"],
          linhas: [
            ["Certificate of Formation (Takeat LLC)", "3/out/2025"],
            ["Limited Liability Company Agreement", "3/out/2025"],
            ["Affidavit to Incorporate a Company in US", "8/out/2025"],
            ["Carta de atribuição do EIN (IRS)", "30/out/2025"],
          ],
        },
      ],
    },
  ],
  notas: [
    "Certificate of Formation, Takeat LLC, 3/out/2025; arquivamento Delaware nº 129813822 (DocuSign).",
    "Limited Liability Company Agreement, Takeat LLC, 3/out/2025; participação no Schedule A.",
    "Affidavit to Incorporate a Company in US, firmado em 8/out/2025 perante a CuboStart LLC.",
    "Comunicação do IRS confirmando o EIN 32-0831325, atribuído em 30/out/2025.",
  ],
};

/* ========================================================================== */
/* Documento 3 — Etapa 2: Holding de Cayman                                   */
/* ========================================================================== */

const DOC3: Documento = {
  numero: 3,
  titulo: "Holding nas Ilhas Cayman",
  subtitulo: "Etapa 2 — Incorporação da Takeat Holding Ltd.",
  etapa: "Etapa 2",
  meta: META_COMUM("3 de 4 — Etapa 2: holding de Cayman"),
  aviso: AVISO_CADERNO,
  secoes: [
    {
      numero: "1",
      titulo: "Visão geral da etapa",
      blocos: [
        {
          t: "p",
          texto:
            "A segunda peça do flip é a holding de topo. Em 6 de outubro de 2025, por meio do procedimento de “Express Incorporation” conduzido pela Campbells, nasceu a Takeat Holding Ltd., uma “exempted company” das Ilhas Cayman. No mesmo dia, o fundador foi nomeado diretor único e tornou-se titular da primeira ação.",
        },
        {
          t: "p",
          texto:
            "É esta holding que, na etapa seguinte, receberá as participações dos sócios e emitirá as ações da rodada. Na constituição, porém, ela nasce com uma estrutura mínima: capital padrão, uma única classe de ações e uma só ação emitida.",
        },
        {
          t: "destaque",
          titulo: "O que é uma “exempted company” de Cayman?",
          texto:
            "É o tipo societário de Cayman destinado a empresas cuja atividade ocorre majoritariamente fora das ilhas. Oferece um regime flexível, documentos em inglês e neutralidade tributária na holding — características que fazem dela a estrutura preferida por fundos internacionais para sediar a holding de um grupo.",
        },
        { t: "figura", legenda: "Figura 1 — Mecânica da incorporação: subscrição e transferência da primeira ação", veja: "aba Estrutura" },
      ],
    },
    {
      numero: "2",
      titulo: "O Certificado de Incorporação (COI)",
      blocos: [
        {
          t: "p",
          texto:
            "O “Certificate of Incorporation” é o ato pelo qual o Registro de Empresas de Cayman reconhece a existência da companhia. Seus dados essenciais:",
        },
        {
          t: "tabela",
          colunas: ["Campo", "Conteúdo"],
          linhas: [
            ["Denominação", "Takeat Holding Ltd."],
            ["Tipo", "Exempted company (Ilhas Cayman)"],
            ["Nº de registro", "426581 (CB-426581)"],
            ["Data de incorporação", "6 de outubro de 2025"],
            ["Autoridade", "Assistant Registrar of Companies (Lisa Moore-Jervis)"],
          ],
        },
        {
          t: "destaque",
          titulo: "Como conferir a autenticidade",
          texto:
            "Os documentos oficiais de Cayman trazem um código de autorização e podem ser verificados no portal do registro (verify.gov.ky). É o equivalente a uma certidão validável online.",
        },
        { t: "p", texto: "O certificado confirma a constituição da companhia com responsabilidade limitada a partir de 6 de outubro de 2025 ¹." },
      ],
    },
    {
      numero: "3",
      titulo: "Memorando e Artigos de Associação",
      blocos: [
        {
          t: "p",
          texto:
            "O “Memorandum and Articles of Association” é a constituição da companhia — o documento que reúne sua finalidade, seu capital e suas regras internas. Os pontos de maior interesse:",
        },
        {
          t: "lista",
          itens: [
            {
              titulo: "Sede e objeto",
              texto:
                "A sede registrada fica nos escritórios da Campbells Corporate Services Limited (Floor 4, Willow House, Cricket Square, Grand Cayman). O objeto social é irrestrito — a companhia pode praticar qualquer ato lícito.",
            },
            {
              titulo: "Capital e ações",
              texto:
                "O capital autorizado é de US$ 1.000, dividido em 100.000 ações de valor nominal US$ 0,01 cada. Na constituição há uma única classe (ordinary shares), com direito a um voto por ação; a responsabilidade de cada sócio limita-se ao valor não integralizado de suas ações.",
            },
            {
              titulo: "Flexibilidade estrutural",
              texto:
                "Os atos preveem expressamente a possibilidade de a companhia se registrar por continuação em outra jurisdição e de ter seus atos alterados por “special resolution” — base jurídica que permitirá, adiante, adotar a versão alterada do Memorando e Artigos para criar as classes preferenciais da rodada.",
            },
          ],
        },
        {
          t: "destaque",
          titulo: "Capital e classe de ações na constituição",
          texto:
            "Na largada, a holding tem uma só classe de ações ordinárias e capital de US$ 1.000 (100.000 ações × US$ 0,01). As classes preferenciais (Series Seed e Series A) só surgem na Etapa 3, quando os sócios adotam um Memorando e Artigos alterados — tratado no Documento 4.",
        },
        { t: "p", texto: "O subscritor da constituição foi a Campbells Nominees Limited (1 ação), com Denise Tibbetts como testemunha ²." },
      ],
    },
    {
      numero: "4",
      titulo: "Subscritor, primeira ação e diretor",
      blocos: [
        {
          t: "p",
          texto:
            "A constituição de uma companhia de Cayman costuma usar um “subscritor nominal”: um agente do escritório subscreve a primeira ação para viabilizar o registro e, em seguida, transfere essa ação ao titular real. Foi o que ocorreu aqui, tudo no mesmo dia e no mesmo envelope eletrônico:",
        },
        {
          t: "p",
          texto:
            "A Campbells Nominees Limited subscreveu 1 ação ordinária; por resolução do subscritor, Miguel Macedo de Carvalho Filho foi nomeado primeiro diretor e a ação lhe foi transferida; a Campbells Corporate Services foi incumbida de manter os registros e fazer os arquivamentos. Nenhum certificado de ação foi emitido neste momento.",
        },
        {
          t: "destaque",
          titulo: "Por que um subscritor nominal?",
          texto:
            "É um expediente puramente operacional: alguém precisa subscrever a primeira ação no instante da constituição. O agente faz isso e imediatamente transfere a ação ao sócio real, de modo que o controle nunca fica, de fato, fora das mãos do fundador.",
        },
        {
          t: "p",
          texto:
            "Os atos foram assinados eletronicamente em 6/out/2025 (envelope DocuSign “Express Incorporation”), por Sayak Bhattacharya e Denise Tibbetts, da Campbells ³.",
        },
      ],
    },
    {
      numero: "5",
      titulo: "Os registros societários",
      blocos: [
        {
          t: "p",
          texto:
            "Concluída a incorporação, a Campbells emitiu os registros obrigatórios da companhia, que retratam a situação na data da constituição:",
        },
        {
          t: "tabela",
          colunas: ["Registro", "Conteúdo na constituição"],
          linhas: [
            ["Register of Members (sócios)", "Miguel: 1 ação ordinária; 99.999 ações ainda não emitidas"],
            ["Register of Directors (diretores)", "Miguel Macedo de Carvalho Filho, diretor desde 6/out/2025"],
            ["Register of Officers", "Sem officers nomeados"],
            ["Register of Mortgages and Charges", "Sem ônus ou garantias registrados"],
            ["CORIS Search Report", "Situação ACTIVE; sede na Campbells Corporate Services"],
          ],
        },
        {
          t: "p",
          texto:
            "Esses registros, somados ao certificado e ao Memorando e Artigos, compõem o “livro societário” inicial da holding ⁴.",
        },
      ],
    },
    {
      numero: "6",
      titulo: "Agentes e documentos desta etapa",
      blocos: [
        {
          t: "tabela",
          colunas: ["Agente", "Papel nesta etapa"],
          linhas: [
            ["Campbells (LLP)", "Assessoria jurídica de Cayman e condução da incorporação"],
            ["Campbells Corporate Services Limited", "Sede registrada e agente; manutenção dos registros e arquivamentos"],
            ["Campbells Nominees Limited", "Subscritor nominal da primeira ação"],
            ["Sayak Bhattacharya / Denise Tibbetts", "Signatários da Campbells (associado e administradora corporativa)"],
            ["Miguel M. de Carvalho Filho", "Diretor único e primeiro acionista"],
          ],
        },
        {
          t: "tabela",
          colunas: ["Documento", "Data"],
          linhas: [
            ["Certificate of Incorporation (reg. 426581)", "6/out/2025"],
            ["Memorandum and Articles of Association", "6/out/2025"],
            ["Subscriber Resolutions e Share Transfer Form", "6/out/2025"],
            ["Registros (Members, Directors, Officers, Charges) e CORIS", "6/out/2025"],
          ],
        },
      ],
    },
  ],
  notas: [
    "Certificate of Incorporation, Takeat Holding Ltd., reg. nº 426581, 6/out/2025 (Assistant Registrar Lisa Moore-Jervis).",
    "Memorandum and Articles of Association, Takeat Holding Ltd., 6/out/2025 (Campbells).",
    "Written Resolutions of the Subscriber e Share Transfer Form, 6/out/2025; envelope DocuSign nº 882737AA (Express Incorporation).",
    "Registers (Members, Directors, Officers, Mortgages and Charges) e CORIS Search Report, 6/out/2025.",
  ],
};

/* ========================================================================== */
/* Documento 4 — Etapa 3: Flip & Series A                                     */
/* ========================================================================== */

const DOC4: Documento = {
  numero: 4,
  titulo: "O Flip e a Series A",
  subtitulo: "Etapa 3 — Reorganização societária e rodada de investimento",
  etapa: "Etapa 3",
  meta: META_COMUM("4 de 4 — Etapa 3: flip & Series A"),
  aviso: AVISO_CADERNO,
  secoes: [
    {
      numero: "1",
      titulo: "Visão geral da etapa",
      blocos: [
        {
          t: "p",
          texto:
            "Com as duas entidades já constituídas, a etapa final reuniu tudo: o flip — que colocou a operação brasileira e a LLC sob a holding de Cayman — e a rodada Series Seed & Series A, que converteu instrumentos anteriores em ações e trouxe o aporte novo. Todos os documentos foram assinados entre 19 e 22 de dezembro de 2025, com data-base de fechamento em 22/dez. Os conceitos usados aqui (flip, ações preferenciais, SPA, etc.) estão explicados no glossário do Documento 1.",
        },
      ],
    },
    {
      numero: "2",
      titulo: "As duas etapas do flip",
      blocos: [
        { t: "p", texto: "A reorganização se deu em duas contribuições encadeadas, ambas regidas pelo direito de Cayman:" },
        { t: "figura", legenda: "Figura 1 — As duas etapas societárias do flip", veja: "aba Estrutura" },
        {
          t: "lista",
          itens: [
            {
              titulo: "Etapa 1 — BR e LLC para Cayman",
              texto:
                "Pelo Subscription and Contribution Agreement, os fundadores contribuíram à holding tanto suas quotas da Takeat Tecnologia Ltda. quanto suas participações na Takeat LLC, recebendo em troca ações da holding. Após esta etapa, a holding passou a deter 100% da LLC e 100% da Ltda.",
            },
            {
              titulo: "Etapa 2 — Cayman para LLC",
              texto:
                "Pelo Deed of Contribution, a holding contribuiu as 1.000 quotas da Ltda. para dentro da LLC, que passou a ser a detentora direta da operação brasileira. O resultado é a cadeia Holding (Cayman) → LLC (Delaware) → Takeat Tecnologia Ltda. (Brasil) ¹.",
            },
          ],
        },
        {
          t: "p",
          texto:
            "A operação foi acompanhada da alteração do contrato social da Ltda. (ACS), de procurações para a Junta Comercial (JUCESP) e do registro do investimento estrangeiro no Banco Central (RDE-IED).",
        },
        { t: "p", texto: "A “Schedule I” do contrato detalha o que cada sócio contribuiu e as ações que recebeu:" },
        {
          t: "tabela",
          colunas: ["Sócio", "Contribuído", "Ações recebidas na holding"],
          totalUltima: true,
          linhas: [
            ["Miguel M. de Carvalho Filho", "100 units da LLC + 952 quotas da Ltda. (95,17%)", "42.968 Class B Ordinary"],
            ["Rafael Guerino Furlanetti", "48 quotas da Ltda. (4,83%)", "2.178 Series Seed-4 Preference"],
            ["Total", "100% da LLC e da Ltda.", "45.146 ações"],
          ],
        },
        {
          t: "destaque",
          titulo: "Por que ações diferentes?",
          texto:
            "O fundador recebeu Class B Ordinary (ações ordinárias, de controle). Rafael Furlanetti, sócio minoritário de origem, recebeu Series Seed-4 Preference — ações preferenciais —, refletindo sua condição de investidor inicial, e não de fundador.",
        },
      ],
    },
    {
      numero: "3",
      titulo: "A rodada Series Seed & Series A",
      blocos: [
        {
          t: "p",
          texto:
            "A rodada formaliza-se no Series Seed and Series A Preference Shares Purchase Agreement (SPA), de 22/dez/2025, acompanhado da adoção de um Memorando e Artigos de Associação alterados — a constituição da holding na versão pós-rodada, que cria as classes preferenciais. Os preços por ação (valor nominal US$ 0,01):",
        },
        {
          t: "destaque",
          titulo: "Preços por ação",
          texto: "Series A: US$ 90,76 · Series Seed-3: US$ 67,68 · Series Seed-2: US$ 13,20 · Series Seed-1: US$ 2,23",
        },
        { t: "p", texto: "O fechamento (Closing) ocorreu na data do contrato; o pagamento das ações Series A deu-se até 30/dez/2025." },
        { t: "p", texto: "Sete investidores subscreveram ações Series A, totalizando USD 2.494.009,81 (BRL 13.739.500):" },
        {
          t: "tabela",
          colunas: ["Investidor (Series A)", "Ações", "Valor (USD)"],
          totalUltima: true,
          linhas: [
            ["DGF 8, L.P. (lead)", "24.000", "2.178.253,77"],
            ["Acelera Espírito Santo Ltda", "3.050", "276.819,75"],
            ["Marcel Martins Malczewski (M3 Invest)", "276", "25.049,92"],
            ["Luis Cláudio Silva Frade", "51", "4.628,79"],
            ["Andries Oudshoorn", "51", "4.628,79"],
            ["Flávio José Moritz Jr.", "31", "2.813,58"],
            ["Peter Celso Godoi (Somar)", "20", "1.815,21"],
            ["Total", "27.479", "2.494.009,81"],
          ],
        },
        {
          t: "p",
          texto:
            "Instrumentos de captação anteriores (notas conversíveis e SAFEs) converteram-se em ações Series Seed-1/2/3, somando BRL 2.185.000,00 (15.808 ações):",
        },
        {
          t: "tabela",
          colunas: ["Investidor", "Classe (quantidade)", "Valor (BRL)"],
          totalUltima: true,
          linhas: [
            ["Guilherme Ferroni Ferreira", "Seed-1 (5.706)", "70.000"],
            ["Acelera Espírito Santo Ltda", "Seed-2 (5.502)", "400.000"],
            ["Acelera Espírito Santo Ltda", "Seed-3 (1.448)", "540.000"],
            ["Marcel Martins Malczewski", "Seed-3 (724)", "270.000"],
            ["Alya Ventures", "Seed-3 (215)", "80.000"],
            ["Luis Cláudio Silva Frade", "Seed-3 (134)", "50.000"],
            ["Peter Celso Godoi", "Seed-3 (54)", "20.000"],
            ["Flávio José Moritz Jr.", "Seed-3 (80)", "30.000"],
            ["Andries Oudshoorn", "Seed-3 (134)", "50.000"],
            ["Gustavo do Valle Fehlberg", "Seed-3 (363)", "135.000"],
            ["Rafael Guerino Furlanetti", "Seed-3 (1.448)", "540.000"],
            ["Total", "15.808 ações", "2.185.000"],
          ],
        },
        {
          t: "destaque",
          titulo: "Uso dos recursos",
          texto:
            "Os recursos destinam-se a propósitos corporativos gerais (sobretudo desenvolvimento de produto e capital de giro). Do total, BRL 800 mil foram reservados para a recompra de certas ações Class B Ordinary e Series Seed-1 e de opções concedidas a prestadores — formalizada no Share Repurchase Agreement.",
        },
        {
          t: "p",
          texto:
            "As rodadas Seed ocorreram em 2020 (Seed-1), 2022 (Seed-2) e 2024 (Seed-3); a Series Seed-4 foi um secondary, sem aporte de capital novo. As quantidades, preços e valores acima constam da “Schedule of Purchasers” (Exhibit A) do SPA ².",
        },
      ],
    },
    {
      numero: "4",
      titulo: "Cap table consolidado pós-rodada",
      blocos: [
        {
          t: "p",
          texto:
            "A foto consolidada da capitalização após a Series A — na revisão final de 18/dez/2025 — distribui as 100.000 ações da holding (capital totalmente diluído) entre o fundador, o pool de opções e os investidores:",
        },
        { t: "figura", legenda: "Figura 2 — Participação por sócio (capital totalmente diluído)", veja: "aba Cap table" },
        {
          t: "tabela",
          colunas: ["Sócio", "Ordinárias", "Series Seed", "Series A", "Total", "%"],
          totalUltima: true,
          linhas: [
            ["Miguel Carvalho", "42.969", "—", "—", "42.969", "42,97%"],
            ["DGF (lead)", "—", "—", "24.000", "24.000", "24,00%"],
            ["Pool de opções (SOP)", "11.566", "—", "—", "11.566", "11,57%"],
            ["Acelera Espírito Santo (FUNSES)", "—", "6.950", "3.050", "10.000", "10,00%"],
            ["Guilherme Ferreira", "—", "5.706", "—", "5.706", "5,71%"],
            ["Rafael Furlanetti", "—", "3.626", "—", "3.626", "3,63%"],
            ["M3 Investimentos (Marcel)", "—", "724", "276", "1.000", "1,00%"],
            ["Gustavo Fehlberg", "—", "363", "—", "363", "0,36%"],
            ["Alya Ventures / Sidecar", "—", "215", "—", "215", "0,22%"],
            ["Luis C. S. Frade", "—", "134", "51", "185", "0,19%"],
            ["Andries Oudshoorn", "—", "134", "51", "185", "0,19%"],
            ["Flávio Moritz Jr.", "—", "80", "31", "111", "0,11%"],
            ["Peter Celso Godoi", "—", "54", "20", "74", "0,07%"],
            ["Total", "54.535", "17.986", "27.479", "100.000", "100%"],
          ],
        },
        { t: "figura", legenda: "Figura 3 — Composição do capital por classe (pós-rodada)", veja: "aba Cap table" },
        {
          t: "destaque",
          titulo: "Capital totalmente diluído e pool de opções",
          texto:
            "“Totalmente diluído” considera todas as ações como se já emitidas, inclusive o estoque reservado a opções. O SOP (Stock Option Pool) — 11.566 ações Class B Ordinary, cerca de 11,6% — é a reserva destinada a remunerar o time com participação societária e ainda não está atribuída a pessoas específicas.",
        },
        {
          t: "p",
          texto:
            "Nota sobre as classes. No cap table final (após a adoção do Memorando e Artigos alterados), as ações ordinárias do fundador aparecem como Class A Ordinary e o pool de opções como Class B Ordinary. Nos instrumentos do flip, as ações do fundador eram referidas como Class B Ordinary — trata-se de uma reclassificação de rótulo, sem mudança de titularidade.",
        },
        {
          t: "p",
          texto: "Distribuição conforme o cap table consolidado da Takeat (revisão de 18/dez/2025) ³.",
        },
      ],
    },
    {
      numero: "5",
      titulo: "As aprovações societárias",
      blocos: [
        {
          t: "p",
          texto:
            "O flip e a rodada foram aprovados por um conjunto de deliberações reunidas no pacote “Approvals”, assinadas em 22/dez/2025: as Director Resolutions (deliberação do diretor da holding), as Shareholder Resolutions (deliberação dos acionistas) e o Written Consent da Takeat LLC.",
        },
        {
          t: "p",
          texto:
            "Pelas Director Resolutions, o diretor aprovou os documentos do flip e da rodada, autorizou a emissão das ações Class B Ordinary ao fundador (100 + 42.868) e, nos termos do Voting Agreement, nomeou os novos diretores da holding ⁴. O conselho passou a ter cinco membros:",
        },
        {
          t: "tabela",
          colunas: ["Diretor", "Observação"],
          linhas: [
            ["Miguel Macedo de Carvalho Filho", "Fundador e CEO"],
            ["Marcel Martins Malczewski", "Ligado à M3 Invest"],
            ["João Gabriel Coser de Orem", "Indicado nos termos do Voting Agreement"],
            ["Luiz Paulo de Castro Chácara", "Indicado nos termos do Voting Agreement"],
            ["Rodrigo Simões Miranda", "Indicado nos termos do Voting Agreement"],
          ],
        },
      ],
    },
    {
      numero: "6",
      titulo: "Os acordos acessórios",
      blocos: [
        {
          t: "p",
          texto:
            "A entrada dos investidores veio com o arcabouço típico de uma Series A. Os principais acordos assinados em 22/dez/2025:",
        },
        {
          t: "tabela",
          colunas: ["Acordo", "Função"],
          linhas: [
            ["Voting Agreement", "Composição do conselho e acordos de voto entre os acionistas"],
            ["Investors’ Rights Agreement (IRA)", "Direitos de informação, de registro e de acompanhamento dos investidores"],
            ["Right of First Refusal & Co-Sale (ROFRA)", "Direito de preferência e de venda conjunta de ações"],
            ["Indemnification Agreements", "Indenização de cada um dos cinco diretores no exercício do cargo"],
            ["Shares Restriction Agreement (Miguel)", "Restrições às ações do fundador (ex.: vesting/lock-up)"],
            ["Share Repurchase Agreement", "Recompra de ações Class B / Series Seed-1 e de opções (BRL 800 mil)"],
            ["FUNSES Side Letter", "Carta de condições específicas com investidor"],
          ],
        },
      ],
    },
    {
      numero: "7",
      titulo: "Investidores e assessores",
      blocos: [
        {
          t: "p",
          texto: "A rodada combinou fundos de venture capital e investidores-anjo. Os principais veículos e seus representantes:",
        },
        {
          t: "tabela",
          colunas: ["Investidor", "Veículo / representante"],
          linhas: [
            ["DGF 8, L.P. (lead)", "DGF Investimentos — Frederico Greve"],
            ["Acelera Espírito Santo Ltda", "Fundo/aceleradora capixaba"],
            ["Alya Ventures", "Alya Ventures — Cássio Spina"],
            ["Marcel Martins Malczewski", "M3 Invest"],
            ["Peter Celso Godoi", "Somar"],
            ["Investidores-anjo", "Luis C. S. Frade, Flávio Moritz Jr., Andries Oudshoorn, Guilherme Ferroni, Gustavo Fehlberg"],
          ],
        },
        {
          t: "p",
          texto:
            "Rafael Guerino Furlanetti participa como sócio inicial (Series Seed-4) e investidor convertido (Series Seed-3); pela Takeat, Pedro Mastelo Faro também figura entre os signatários da rodada.",
        },
        {
          t: "tabela",
          colunas: ["Assessor", "Papel"],
          linhas: [
            ["Campbells (Cayman)", "Assessoria jurídica de Cayman, documentos da holding e da rodada"],
            ["Baptista Luz (Brasil)", "Assessoria jurídica brasileira — Julia Noca Machado e Milena Tesser; condução via Alexandre Gustavo de Freitas"],
            ["CuboStart LLC (EUA)", "Estrutura em Delaware e serviços corporativos/contábeis"],
          ],
        },
        {
          t: "p",
          texto:
            "Os documentos do flip, das aprovações e da rodada foram firmados em envelopes DocuSign conduzidos pelo Baptista Luz, com assinaturas coletadas entre 19 e 22/dez/2025 ⁵.",
        },
      ],
    },
  ],
  notas: [
    "Subscription and Contribution Agreement (BR and LLC to Cayman), Schedule I, e Deed of Contribution (Cayman to LLC), ambos de 22/dez/2025.",
    "Series Seed and Series A Preference Shares Purchase Agreement (SPA), Exhibit A — Schedule of Purchasers, 22/dez/2025.",
    "Takeat — Captable final pós Series A, revisão de 18/dez/2025 (planilha consolidada). Percentuais sobre 100.000 ações, capital totalmente diluído.",
    "Director Resolutions, Takeat Holding Ltd., 22/dez/2025 (§ 7, nomeação de diretores nos termos do Voting Agreement).",
    "Envelopes DocuSign (Baptista Luz): Series A_Takeat_Flip, _Approvals e _Financing Agreements, assinados entre 19 e 22/dez/2025.",
  ],
};

export const DOCUMENTOS: Documento[] = [DOC1, DOC2, DOC3, DOC4];
