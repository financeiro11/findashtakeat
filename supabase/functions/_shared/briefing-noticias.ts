// A régua do painel de notícias do briefing: o que se procura, o que se descarta
// e o que merece uma linha na tela de manhã.
//
// POR QUE ISTO MORA FORA DA FUNÇÃO. Sem imports, para o vitest poder testar —
// mesmo arranjo de `vigilancia-diff.ts` e `radar-precos.ts`. E é aqui que está a
// decisão que mais precisa de teste do módulo inteiro: esta régua filtra o que
// chega aos olhos de alguém, e um erro nela não aparece como erro. Aparece como
// um painel plausível, cheio de notícia que não importa — ou vazio.
//
// O DESENHO É O DA CASA: SINAL DETERMINÍSTICO, IA SÓ REDIGE. Quem decide se a
// notícia entra é `pontuar` aqui embaixo, em TypeScript, contra um vocabulário
// escrito à mão do que a Takeat usa e de quem a Takeat disputa. A IA recebe
// depois, e só, o item já aprovado, para escrever uma frase de "por que isto
// importa" e responder duas perguntas binárias (muda algo? já vimos isso?).
// Deixar a IA escolher produziria uma seleção diferente a cada manhã,
// impossível de calibrar e impossível de explicar.
//
// AS QUATRO FRENTES (29/08/2026). Antes eram três pautas e, ao lado delas, um
// "Panorama do dia" em prosa que a skill escrevia — macro Brasil, tech/SaaS e
// foodservice. A prosa foi extinta e virou item, porque era exatamente ela que
// se repetia: "Selic em 14% desde 05/08" é verdade todo dia e novidade em um só.
// Texto sem link não tem data, não deduplica e não se marca como lido — as três
// coisas que fazem um painel diário parar de repetir. As frentes agora são:
//
//     IA e inovação  →  `ia_ferramentas` + `ia_backoffice`
//     Finanças       →  `financas`      (juros, câmbio, tributário, meios de pagamento)
//     Foodservice    →  `foodservice`   (o setor E os concorrentes)
//     Startups       →  `startups`      (rodada, aporte, M&A, foodtech/SaaS)
//
// E O PAINEL APRENDE. Cada item tem 👍 ("quero mais") e 👎 ("evite"); o voto vira
// vocabulário com peso em `briefing_noticias_preferencias`, e `pontuar` soma
// esse peso como soma qualquer outro sinal. O aprendizado não é um modelo que se
// ajusta no escuro: é uma lista de assuntos, com termos visíveis, que dá para
// abrir e apagar na tela. Ver `aplicarPreferencias`.

/* ============================================================== as pautas */

export type PautaChave =
  | "ia_ferramentas"
  | "ia_backoffice"
  | "financas"
  | "foodservice"
  | "startups";

/**
 * Pautas que mudaram de nome, e o nome novo.
 *
 * `concorrentes` virou `foodservice` quando a pauta deixou de exigir nome de
 * rival e passou a aceitar dado do setor — o que a prosa do panorama trazia. A
 * migração renomeia as linhas antigas, mas isto fica por dois motivos: um item
 * gravado entre a subida do código e a da migração, e a tela, que precisa saber
 * desenhar o chip de uma linha velha sem quebrar.
 */
export const PAUTA_RENOMEADA: Record<string, PautaChave> = { concorrentes: "foodservice" };

export function pautaAtual(chave: string): PautaChave {
  return (PAUTA_RENOMEADA[chave] ?? chave) as PautaChave;
}

export interface Consulta {
  q: string;
  /** Janela do buscador: `qdr:d` = último dia, `qdr:w` = última semana. */
  tbs: string;
  /**
   * Qual aba do buscador. UMA SÓ POR CONSULTA, e a escolha é por pauta:
   *
   * • `news` para o que sai em veículo — lançamento de modelo, decisão do Copom,
   *   rodada de investimento. É a única aba que devolve data e nome do veículo,
   *   que é o que permite escrever "há 3 horas, no TechCrunch" em vez de
   *   adivinhar pela URL.
   *
   * • `web` para o que NÃO sai em veículo. Caso de empresa que automatizou o
   *   contas a pagar mora em blog de engenharia, post de LinkedIn e página de
   *   cliente — nada disso é indexado como notícia, e pedir a aba `news` para
   *   essa pauta devolveria vazio quase sempre.
   *
   * Pedir as duas dobraria o custo da busca para cobrir a mesma pergunta.
   */
  fontes: Array<"web" | "news">;
}

export interface Pauta {
  chave: PautaChave;
  rotulo: string;
  /** Vai no prompt de quem escreve o "por que importa". */
  oQueImporta: string;
}

export const PAUTAS: Pauta[] = [
  {
    chave: "ia_ferramentas",
    rotulo: "IA e as ferramentas que usamos",
    oQueImporta:
      "A Takeat roda o Hub sobre Gemini, OpenAI, Supabase e Firecrawl, e o financeiro sobre Omie e Asaas. " +
      "Interessa: modelo novo, mudança de preço, recurso que substitui trabalho que hoje é nosso, " +
      "e depreciação de algo que já usamos.",
  },
  {
    chave: "ia_backoffice",
    rotulo: "IA aplicada ao financeiro",
    oQueImporta:
      "O que dá para copiar no Hub: agente de conciliação, leitura de nota fiscal, automação de contas a " +
      "pagar, fechamento contábil assistido. Interessa o caso concreto de quem implantou e contou o " +
      "resultado — não a promessa de fornecedor.",
  },
  {
    chave: "financas",
    rotulo: "Finanças",
    oQueImporta:
      "O que muda o custo do dinheiro e o trabalho do financeiro da Takeat: decisão do Copom e Selic, " +
      "câmbio (parte do custo de IA é em dólar), inflação, reforma tributária e obrigação fiscal nova, " +
      "regra do Banco Central sobre Pix e meios de pagamento — que é por onde o dinheiro dos clientes entra.",
  },
  {
    chave: "foodservice",
    rotulo: "Foodservice",
    oQueImporta:
      "O mercado do cliente da Takeat e quem disputa esse cliente com ela: Goomer, Anota AI, Saipos, " +
      "Consumer, Neemo, Cardápio Web e as plataformas de delivery. Interessa movimento de concorrente " +
      "(lançamento, preço, aporte, aquisição, encerramento) e dado do setor que mude a conversa de venda.",
  },
  {
    chave: "startups",
    rotulo: "Startups",
    oQueImporta:
      "A Takeat é uma startup de SaaS B2B que vai levantar Series A. Interessa rodada, aporte, M&A e " +
      "valuation em SaaS B2B, foodtech e fintech no Brasil e na América Latina — o que baliza a própria " +
      "captação — e o que fecha ou encolhe, que é o outro lado do mesmo termômetro.",
  },
];

export const pautaPorChave = (c: string): Pauta | undefined =>
  PAUTAS.find((p) => p.chave === pautaAtual(c));

/* ========================================================= o revezamento */

/**
 * QUATRO BUSCAS POR DIA, CINCO PAUTAS: quem cobre o quê hoje.
 *
 * O ORÇAMENTO NÃO MUDOU e isso foi uma decisão, não uma sobra. São 2 créditos por
 * busca (o Firecrawl cobra por dezena de resultados, arredondando para cima —
 * daí `RESULTADOS = 10`, porque pedir 5 pagaria o mesmo por metade), ~240
 * créditos/mês, contra um teto de 300. Cobrir as quatro frentes com uma busca
 * dedicada cada, todo dia, seria ~400 — e comeria 150 dos 200 créditos de
 * reserva do plano, que é o que segura o mês em que uma loja passar a exigir
 * proxy stealth e uma varredura do radar custar cinco vezes mais.
 *
 * ENTÃO O QUE SE REVEZA É A PAUTA, NÃO O DINHEIRO. Cada slot é um horário fixo
 * na grade com duas consultas que se alternam por dia. IA e foodservice caem
 * todo dia (dois slots e um slot); finanças e startups dividem o quarto slot e
 * chegam em dias alternados — o que é a cadência natural das duas: o Copom se
 * reúne a cada 45 dias e rodada de investimento não sai de manhã.
 *
 * A ESCALA É FUNÇÃO DA DATA, e de nada mais. Nada de contador no banco: uma
 * rodada repetida (o botão "buscar agora", uma reenfileirada do cron) não pode
 * fazer a grade andar, senão a mesma frente pula dois dias sem ninguém notar.
 * `escalaDoDia("2026-08-29")` devolve hoje e devolverá o mesmo daqui a um ano.
 */
export interface Slot {
  chave: string;
  /** Por que este slot existe — vai no relatório da rodada. */
  papel: string;
  consultas: Array<Consulta & { pauta: PautaChave }>;
}

export const SLOTS: Slot[] = [
  {
    chave: "ia_laboratorios",
    papel: "quem faz os modelos que o Hub usa — todo dia",
    consultas: [
      /* CONSULTA CURTA NA ABA DE NOTÍCIAS. A primeira versão mandava sopa de
         termos com aspas e oito palavras; as de duas a quatro palavras rendem
         mais. Com a intermitência da aba de notícias no meio (ver `RESULTADOS`),
         isto é tendência medida, não lei. */
      { pauta: "ia_ferramentas", q: "Anthropic OpenAI Claude modelo", tbs: "qdr:d", fontes: ["news"] },
      { pauta: "ia_ferramentas", q: "Gemini Google IA lançamento", tbs: "qdr:d", fontes: ["news"] },
    ],
  },
  {
    chave: "ia_aplicada",
    papel: "IA que vira trabalho a menos aqui dentro — todo dia, de dois ângulos",
    consultas: [
      /* A aba `web` e a janela de uma semana são de propósito: caso contado de
         automação de backoffice mora em blog de engenharia e post de LinkedIn,
         que o índice de notícias não vê, e não sai um por dia. */
      { pauta: "ia_backoffice", q: "inteligência artificial agente automação financeiro conciliação contas a pagar nota fiscal empresa caso", tbs: "qdr:w", fontes: ["web"] },
      { pauta: "ia_ferramentas", q: "agentes de IA empresas automação lançamento", tbs: "qdr:d", fontes: ["news"] },
    ],
  },
  {
    chave: "setor",
    papel: "o mercado do cliente e quem o disputa — todo dia",
    consultas: [
      /* Setor, e não os nomes das empresas: "Goomer" e "Saipos" não aparecem no
         índice de notícias (medido — zero em três janelas diferentes). O que
         aparece é a matéria de restaurante e delivery, e é ali que o movimento
         do concorrente sai quando sai. Quem separa o que interessa é a régua. */
      { pauta: "foodservice", q: "restaurantes delivery cardápio digital", tbs: "qdr:d", fontes: ["news"] },
      { pauta: "foodservice", q: "foodservice bares restaurantes mercado vendas", tbs: "qdr:d", fontes: ["news"] },
    ],
  },
  {
    chave: "dinheiro",
    papel: "o custo do dinheiro e o mercado de captação — dias alternados",
    consultas: [
      /* Consulta larga contra a regra das 2 a 4 palavras, e sabendo disso: a
         frente de finanças é a que mais tem sub-assuntos disputando o mesmo dia
         (juros, câmbio, tributário, Pix), e uma consulta estreita entregaria a
         mesma decisão do Copom por três dias enquanto a regra nova do Banco
         Central não aparece nunca. */
      { pauta: "financas", q: "Selic Copom juros inflação câmbio Pix Banco Central", tbs: "qdr:d", fontes: ["news"] },
      { pauta: "startups", q: "startup rodada aporte investimento SaaS", tbs: "qdr:d", fontes: ["news"] },
    ],
  },
];

/** Dias inteiros desde 1970 para uma data `YYYY-MM-DD`. Sem fuso: a data já vem em BRT. */
export function diasDesdeEpoch(diaISO: string): number {
  const t = Date.parse(`${String(diaISO).slice(0, 10)}T00:00:00Z`);
  return isNaN(t) ? 0 : Math.floor(t / 86_400_000);
}

/** A grade de hoje: uma consulta por slot, escolhida pela data. */
export function escalaDoDia(diaISO: string): Array<{ slot: string; pauta: Pauta; consulta: Consulta }> {
  const d = diasDesdeEpoch(diaISO);
  return SLOTS.map((s) => {
    const c = s.consultas[((d % s.consultas.length) + s.consultas.length) % s.consultas.length];
    return { slot: s.chave, pauta: pautaPorChave(c.pauta)!, consulta: { q: c.q, tbs: c.tbs, fontes: c.fontes } };
  });
}

/**
 * Resultados por busca. Ver a conta em `SLOTS`: menos que 10 custa igual.
 *
 * A ABA DE NOTÍCIAS É INTERMITENTE, e essa é a lição cara de 28/08/2026. Onze
 * buscas medidas, e o resultado NÃO tem padrão de consulta:
 *
 *     "Anthropic OpenAI Claude modelo"         qdr:d   news → 10
 *     "inteligência artificial empresas"       qdr:d   news → 10
 *     "restaurantes delivery cardápio digital" qdr:d   news →  4
 *     "iFood restaurantes delivery"            qdr:d   news →  0
 *     "iFood restaurantes delivery"            qdr:w   news →  0
 *     "Supabase n8n Cursor desenvolvedores"    (sem)   news →  0
 *
 * A mesma família de consulta devolve dez numa hora e zero na seguinte, e
 * ACRESCENTAR um termo chegou a aumentar o número de achados — o que não é
 * comportamento de busca, é comportamento de serviço intermitente.
 *
 * O QUE SE FAZ COM ISSO: não confiar em zero. A rodada retenta UMA vez quando a
 * aba de notícias volta vazia sem erro, e o painel guarda o que já tinha em vez
 * de esvaziar — item não lido continua na tela pelos dias seguintes. O que NÃO
 * se faz é ler "0 achados" como "não houve notícia": é a leitura natural, é
 * plausível, e está errada com frequência.
 */
export const RESULTADOS = 10;

/* ========================================================== normalização */

/** Sem acento, minúsculo, sem pontuação, espaços colapsados. */
export function normalizarTexto(s: string): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O termo aparece no texto COMO PALAVRA?
 *
 * A comparação por `includes` parece bastar e não basta: "api" está dentro de
 * "capital", "curso" dentro de "discurso", "gpt" dentro de nada mas "ia" dentro
 * de meia língua portuguesa. Com `includes`, uma matéria sobre o mercado de
 * capitais entraria no painel pontuando como notícia de API — e o defeito seria
 * invisível, porque a lista continuaria parecendo uma lista de notícias.
 *
 * Os dois lados já vêm normalizados (só letras, dígitos e espaço), então a borda
 * é literal e não precisa escapar nada.
 */
export function contemTermo(textoNormalizado: string, termo: string): boolean {
  const t = normalizarTexto(termo);
  if (!t) return false;
  return new RegExp(`(^|\\s)${t}(\\s|$)`).test(textoNormalizado);
}

/**
 * A chave de deduplicação de um endereço.
 *
 * O MESMO LINK CHEGA COM ROUPAS DIFERENTES: `?utm_source=`, `#` de âncora, `www`
 * ou não, barra no fim ou não. Sem normalizar, o índice único não impede nada e
 * a mesma notícia entra na segunda-feira e de novo na terça, agora com o utm da
 * newsletter. Guardo o que identifica a página — host sem `www` e caminho sem
 * barra final —, jogando fora TODA a querystring: o parâmetro que muda conteúdo
 * de verdade (um `?id=`) é raro em portal de notícia, e o risco de descartar um
 * link legítimo é menor que o de repetir a manchete de ontem.
 */
export function chaveDaUrl(url: string): string {
  const cru = String(url ?? "").trim();
  if (!cru) return "";
  try {
    const u = new URL(cru);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const caminho = u.pathname.replace(/\/+$/, "");
    return `${host}${caminho}`.toLowerCase();
  } catch {
    return normalizarTexto(cru).replace(/\s/g, "");
  }
}

/**
 * Hosts que não são o veículo: são o caminho até ele.
 *
 * A ABA DE NOTÍCIAS NÃO DEVOLVE O LINK DA MATÉRIA. Devolve
 * `google.com/goto?url=CAESfwHrOzAV…` — um redirecionador cujo caminho é o MESMO
 * para todas as notícias, e cujo parâmetro é um token opaco que não dá para
 * decodificar. Isso quebra a chave de deduplicação de um jeito
 * particularmente cruel: `chaveDaUrl` devolveria `google.com/goto` para todos os
 * itens, o índice único do banco aceitaria o PRIMEIRO e recusaria calado todos
 * os outros — para sempre, não só naquele dia. O sintoma seria "a aba de
 * notícias nunca traz nada", e a causa estaria no banco, não na busca.
 */
const REDIRECIONADORES = ["google.com", "news.google.com", "bing.com", "duckduckgo.com", "r.search.yahoo.com"];

export function ehRedirecionador(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return REDIRECIONADORES.includes(h);
  } catch { return false; }
}

/**
 * A chave de deduplicação do ITEM — a que o banco usa.
 *
 * Endereço de verdade: a URL normalizada, que é o identificador mais forte.
 * Redirecionador: o título normalizado, que é o único identificador que sobra.
 * O prefixo `titulo:` existe para as duas famílias nunca colidirem entre si.
 */
export function chaveDoItem(url: string, titulo: string): string {
  if (!url || ehRedirecionador(url)) {
    const t = normalizarTexto(titulo);
    return t ? `titulo:${t}` : "";
  }
  return chaveDaUrl(url);
}

/**
 * A data que a aba de notícias devolve NÃO É ISO: é "16 minutes ago", "10 hours
 * ago", "1 day ago". `Date.parse` disso é `NaN` — e um `NaN` aqui não quebra
 * nada visivelmente, só faz a pontuação por recência nunca disparar e a coluna
 * `publicado_em` ficar eternamente nula. Erro silencioso em cima de erro
 * silencioso: o painel continuaria montando, só que sempre sem hora e sem o
 * ponto de "das últimas 36h".
 *
 * Devolve ISO, ou `null` quando não reconhece — que é honesto e é tratado como
 * "sem data" em toda a régua.
 */
export function lerQuando(valor: string | null | undefined, agora: Date = new Date()): string | null {
  const s = String(valor ?? "").trim();
  if (!s) return null;

  const rel = s.toLowerCase().match(
    /^(?:h[áa]\s+)?(\d+)\s*(minute|minuto|hour|hora|day|dia|week|semana|month|m[êe]s|mes)/,
  );
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2];
    const ms =
      u.startsWith("minut") ? 60_000 :
      (u.startsWith("hour") || u.startsWith("hora")) ? 3_600_000 :
      (u.startsWith("day") || u.startsWith("dia")) ? 86_400_000 :
      (u.startsWith("week") || u.startsWith("semana")) ? 7 * 86_400_000 :
      30 * 86_400_000;
    return new Date(agora.getTime() - n * ms).toISOString();
  }

  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t).toISOString();
}

/** Palavras que sobrevivem à comparação de títulos: as curtas não distinguem nada. */
function palavras(titulo: string): Set<string> {
  return new Set(normalizarTexto(titulo).split(" ").filter((p) => p.length > 3));
}

/**
 * Dois títulos contam a MESMA notícia?
 *
 * Não é firula: um lançamento da Anthropic sai em oito portais no mesmo dia, com
 * URLs diferentes — o índice único por URL não pega nenhum deles.
 *
 * JACCARD NÃO SERVE AQUI, e isto foi medido em manchete de verdade. "OpenAI
 * lança GPT-5 para empresas com preço menor" e "OpenAI anuncia GPT-5 para
 * empresas e reduz preço" são a MESMA notícia e dão Jaccard 0,5 — porque cada
 * veículo escolhe seu verbo, e o denominador da união castiga justamente as
 * palavras que sobram de um lado só. Um corte que aceitasse 0,5 aceitaria
 * também metade das notícias diferentes. O coeficiente de sobreposição (comuns
 * sobre o MENOR dos dois conjuntos) mede o que interessa — "o miolo de um está
 * contido no outro?" — e dá 0,67 contra 0,2 do par diferente.
 *
 * O PISO DE TRÊS PALAVRAS COMUNS É O QUE SEGURA O TÍTULO CURTO. Sem ele,
 * "OpenAI lança GPT-5" tem sobreposição 1,0 com "OpenAI lança novo plano" — dois
 * fatos distintos declarados idênticos porque o título curto não tem miolo.
 *
 * E ERRA PARA O LADO DE MOSTRAR: repetir uma notícia custa uma linha de tela;
 * engolir uma notícia diferente por parecer com outra custa a notícia, e ninguém
 * descobre que ela existiu. Quem pega a repetição que as palavras não pegam
 * ("Copom mantém juros" × "Selic segue em 14%") é a IA, no campo `repete` da
 * legenda — e ela manda o item para o rodapé, não para o lixo.
 */
export function mesmaNoticia(a: string, b: string, corte = 0.6): boolean {
  const A = palavras(a), B = palavras(b);
  if (!A.size || !B.size) return false;
  let comuns = 0;
  for (const p of A) if (B.has(p)) comuns++;
  if (comuns < 3) return false;
  return comuns / Math.min(A.size, B.size) >= corte;
}

/* ============================================================ a pontuação */

/** O que a Takeat usa e paga. Casar aqui é o sinal mais forte que existe. */
export const NOSSAS_FERRAMENTAS = [
  "anthropic", "claude", "openai", "chatgpt", "gpt", "gemini", "google ai",
  "supabase", "postgres", "firecrawl", "n8n", "cursor", "vercel",
  "omie", "asaas", "notion", "clickup", "canva", "hubspot", "whatsapp business",
];

/** Quem disputa o mesmo restaurante — e a própria Takeat, que também vira notícia. */
export const CONCORRENTES = [
  "goomer", "anota ai", "saipos", "consumer", "neemo", "cardapio web",
  "ifood", "rappi", "abrasel", "takeat", "cardapio digital",
];

/**
 * Nomes de concorrente que são palavra comum antes de serem marca.
 *
 * "Consumer" é uma empresa de sistema para restaurante E é a palavra que todo
 * texto em inglês sobre consumo usa ("consumer prices rise"). Sozinha, ela
 * daria 3 pontos e cruzaria o corte — o painel encheria de matéria de inflação
 * americana catalogada como movimento de concorrente. Então marca ambígua só
 * conta acompanhada de contexto do setor.
 */
const RIVAIS_AMBIGUOS = ["consumer"];
const CONTEXTO_SETOR = [
  "restaurante", "restaurantes", "bar", "bares", "pizzaria", "delivery",
  "cardapio", "foodservice", "food service", "gastronomia", "lanchonete",
  "franquia", "franquias", "hamburgueria", "padaria",
];

/**
 * O vocabulário da frente de finanças.
 *
 * DUAS FAMÍLIAS NA MESMA LISTA, e é de propósito: o que muda o custo do dinheiro
 * (Selic, câmbio, inflação) e o que muda o trabalho do time (tributário, Pix,
 * meios de pagamento). As duas caem na mesma pergunta de manhã — "isso me
 * obriga a fazer alguma coisa?" — e separá-las em duas pautas gastaria uma busca
 * a mais para dividir uma frente que já rende pouco item por dia.
 */
export const FINANCAS = [
  "selic", "copom", "juros", "inflacao", "ipca", "igpm", "cambio", "dolar",
  "banco central", "bacen", "pix", "drex", "open finance", "cdi", "ibovespa",
  "imposto", "impostos", "tributaria", "tributario", "receita federal", "fisco",
  "reforma tributaria", "nota fiscal", "simples nacional", "fintech",
  "meios de pagamento", "adquirente", "maquininha", "antecipacao", "credito",
  "capital de giro", "inadimplencia",
];

/**
 * O vocabulário da frente de startups.
 *
 * "vc" ficou de fora de propósito: é a sigla de venture capital e é como meio
 * Brasil escreve "você". Um termo de duas letras que casa com conversa informal
 * encheria a pauta de qualquer coisa — e `contemTermo` não salva, porque aqui a
 * palavra é mesmo a palavra.
 */
export const STARTUP = [
  "startup", "startups", "rodada", "aporte", "seed", "series a", "series b",
  "series c", "venture", "venture capital", "valuation", "unicornio",
  "captacao", "aquisicao", "fusao", "ipo", "aceleradora", "foodtech",
  "scaleup", "scale up", "saas", "investidores", "fundo de investimento",
];

/**
 * Sinal de DADO de mercado — o que separa a matéria de setor da matéria de
 * gastronomia.
 *
 * A pauta de foodservice herdou do panorama em prosa a obrigação de trazer o
 * número do setor ("foodservice bateu recorde no 2T26: R$ 62,9 bi"), que é o
 * que serve de munição comercial. Mas a mesma busca traz, em muito maior
 * volume, "restaurante do centro lança cardápio de inverno". A diferença entre
 * as duas é medível: a primeira fala de mercado, faturamento e pesquisa; a
 * segunda, de prato.
 */
export const DADO_DE_MERCADO = [
  "recorde", "cresce", "crescimento", "faturamento", "vendas", "mercado",
  "setor", "pesquisa", "levantamento", "balanco", "bilhoes", "bilhao",
  "milhoes", "inadimplencia", "tendencia", "consumo", "alta", "queda",
  "abrasel", "abia", "ibge",
];

/**
 * O que faz uma notícia ser NOTÍCIA e não texto de fundo. Casar aqui sozinho não
 * basta para entrar (vale 1 ponto); serve para desempatar entre dois itens que
 * citam a mesma ferramenta — o que anuncia preço novo ganha do perfil
 * institucional.
 */
export const VERBOS_DE_FATO = [
  // português
  "lanca", "lancou", "lancamento", "anuncia", "anunciou", "libera", "liberou",
  "preco", "precos", "reajuste", "aumento", "gratuito", "desconto",
  "aporte", "rodada", "aquisicao", "compra", "fusao", "encerra", "desativa",
  "descontinua", "atualizacao", "versao", "api", "agente", "agentes", "automacao",
  // INGLÊS, e não é opcional: a aba de notícias devolve matéria em inglês. Com o
  // vocabulário só em português, o anúncio de produto da Anthropic pontuava
  // IGUAL a um perfil do fundador — e o perfil ganhava, por citar mais nomes.
  "launch", "launches", "launched", "announce", "announces", "announced",
  "unveils", "releases", "release", "released", "introduces", "introducing",
  "pricing", "price", "prices", "free", "preview", "update", "updates",
  "deprecated", "shuts", "acquires", "acquired", "raises", "partnership", "agents",
  // O VERBO DA DECISÃO, que a frente de finanças exigiu. "Copom mantém a Selic
  // em 14%" é o fato mais importante do mês para o custo do dinheiro e não tem
  // um único verbo de lançamento — sem esta linha, a pauta inteira morreria no
  // "só menção".
  "mantem", "manteve", "mantida", "mantido", "sobe", "subiu", "cai", "caiu",
  "reduz", "reduziu", "eleva", "elevou", "corta", "cortou", "aprova", "aprovou",
  "sanciona", "sancionou", "decide", "decidiu", "define", "publica", "vigor",
  "proibe", "autoriza", "capta", "captou", "levanta", "levantou", "investe",
  "investiu", "adquire", "adquiriu", "fecha", "fechou", "segue", "atinge",
  "supera", "recua", "avanca", "registra", "divulga", "bate", "bateu",
];

/**
 * O que NUNCA vale a linha, por mais que cite nossas ferramentas.
 *
 * Busca por "OpenAI preço" traz, junto com o anúncio oficial, uma enxurrada de
 * "as 10 melhores IAs de 2026" e de curso com cupom. Esses textos casam com todo
 * o vocabulário acima — são feitos para isso — e afundariam a lista sem um veto
 * explícito. O veto é forte de propósito (`ruido` zera o item, não desconta
 * pontos): meio-termo aqui só produz lista ruim com nota alta.
 */
export const RUIDO = [
  "melhores", "top 10", "top 5", "ranking", "cupom", "desconto imperdivel",
  "curso", "ebook", "webinar gratuito", "vagas", "concurso", "horoscopo",
  "como ganhar dinheiro", "renda extra", "passo a passo", "tutorial",
  "voce precisa conhecer", "descubra", "veja como", "guia definitivo",
  // O gênero "perfil e palpite" da imprensa de tecnologia. Casa com todos os
  // nomes que nos interessam e não anuncia nada: "os 100 mais influentes da IA",
  // "quem ganha em agosto: odds e previsões". Medido na rodada de estreia —
  // dois dos três itens escolhidos eram disto.
  "influential", "influentes", "odds", "predictions", "previsoes", "opinion",
  // A versão financeira do mesmo gênero, que a frente nova traz junto: a coluna
  // diária de "o que esperar do pregão" e a receita de investimento pessoal.
  "onde investir", "carteira recomendada", "melhores acoes", "dicas de",
];

/* --------------------------------------------------- o que a pessoa pediu */

/**
 * Um assunto que alguém marcou com 👍 ou 👎, virado em vocabulário.
 *
 * O PESO É A SOMA DOS VOTOS, com sinal: três 👍 no mesmo assunto valem +3, um 👎
 * depois deixa +2. Não é média nem taxa de aprendizado — é contagem, porque
 * contagem é a única coisa que a pessoa consegue prever ao clicar e conferir
 * depois na tela de preferências.
 *
 * OS TERMOS SÃO O QUE A RÉGUA CASA, e é aí que a IA entra sem decidir nada: ela
 * lê o item votado e devolve de 2 a 5 palavras que descrevem o assunto ("preco
 * api", "modelo", "token"). Daí em diante é casamento de palavra, igual ao
 * resto do módulo — auditável, testável, e visível na tela para quem quiser
 * apagar.
 */
export interface Preferencia {
  assunto: string;
  rotulo: string;
  termos: string[];
  /** > 0 quero mais; < 0 evite. */
  peso: number;
}

/** Nenhum assunto sozinho vale mais que isto, por mais votos que junte. */
export const TETO_POR_PREFERENCIA = 4;
/** Nem a soma de todos: preferência empurra a fila, não substitui a régua. */
export const TETO_DAS_PREFERENCIAS = 6;
/**
 * A partir daqui o 👎 deixa de descontar e passa a vetar.
 *
 * DOIS VOTOS CONTRA O MESMO ASSUNTO. Um só pode ser o dia ruim, o título
 * infeliz, o clique errado; dois é uma pessoa dizendo a mesma coisa duas vezes,
 * e ignorar isso é o que faz um botão de feedback virar enfeite. O veto é
 * reversível pela tela de preferências, que é onde ele fica visível — vetar em
 * silêncio, sem lugar para desfazer, seria a versão ruim disto.
 */
export const VETO_DA_PREFERENCIA = -2;

export interface EfeitoPreferencia {
  delta: number;
  motivos: string[];
  vetado: boolean;
}

/**
 * Quanto o gosto declarado mexe neste item.
 *
 * EXIGE DOIS TERMOS (ou o único que houver). Casar um termo solto é
 * casar coincidência: "preco" aparece em metade das manchetes de tecnologia, e
 * um 👎 em "aumento de preço de maquininha" não pode calar todo anúncio de
 * preço da Anthropic. Dois termos do mesmo assunto no mesmo texto já é assunto.
 */
export function aplicarPreferencias(textoNormalizado: string, prefs: Preferencia[] = []): EfeitoPreferencia {
  let delta = 0;
  const motivos: string[] = [];
  let vetado = false;

  for (const p of prefs) {
    const termos = (p.termos ?? []).filter(Boolean);
    if (!termos.length || !p.peso) continue;
    const casou = termos.filter((t) => contemTermo(textoNormalizado, t));
    if (casou.length < Math.min(2, termos.length)) continue;

    const peso = Math.max(-TETO_POR_PREFERENCIA, Math.min(TETO_POR_PREFERENCIA, p.peso));
    delta += peso;
    motivos.push(`${peso > 0 ? "você pediu mais" : "você pediu menos"}: ${p.rotulo}`);
    if (p.peso <= VETO_DA_PREFERENCIA) vetado = true;
  }

  return {
    delta: Math.max(-TETO_DAS_PREFERENCIAS, Math.min(TETO_DAS_PREFERENCIAS, delta)),
    motivos,
    vetado,
  };
}

export interface Bruto {
  titulo: string;
  url: string;
  descricao: string;
  fonte?: string | null;
  /** ISO, quando o buscador informa. Notícia sem data não é penalizada. */
  publicado?: string | null;
  /** De qual aba do buscador veio — só para o registro, não pontua. */
  origem?: "web" | "news" | null;
}

export interface Nota {
  pontos: number;
  /** Por que entrou (ou não). Vai para a coluna `motivos` e explica a lista. */
  motivos: string[];
  ruido: boolean;
}

/** Abaixo disto não vira linha na tela. */
export const CORTE = 3;

const conta = (texto: string, lista: string[]) => lista.filter((t) => contemTermo(texto, t));

/**
 * Quanto vale este resultado de busca.
 *
 * A ESCALA É PEQUENA DE PROPÓSITO (0 a ~10). Um score fino daria a impressão de
 * medir precisão que não existe: isto é uma soma de casamentos de palavra em um
 * título e duas linhas de snippet. O que ele precisa fazer é separar "cita uma
 * ferramenta nossa e anuncia alguma coisa" de "cita uma ferramenta nossa de
 * passagem" — e para isso três faixas bastam.
 */
export function pontuar(
  b: Bruto,
  pauta: PautaChave,
  agora: Date = new Date(),
  prefs: Preferencia[] = [],
): Nota {
  const texto = normalizarTexto(`${b.titulo} ${b.descricao}`);
  const motivos: string[] = [];

  for (const r of RUIDO) {
    if (contemTermo(texto, r)) {
      return { pontos: 0, motivos: [`descartado: parece ${r}`], ruido: true };
    }
  }

  /* O 👎 REPETIDO VETA ANTES DE QUALQUER PONTUAÇÃO, e vem aqui em cima junto do
     ruído porque é a mesma natureza de decisão: não é "vale menos", é "não é
     para mim". Deixar para o fim faria um item bem pontuado sobreviver ao veto
     por acumular pontos de outro lado — que é exatamente a queixa que originou o
     botão. */
  const gosto = aplicarPreferencias(texto, prefs);
  if (gosto.vetado) {
    return { pontos: 0, motivos: [...gosto.motivos, "evitado a seu pedido"], ruido: true };
  }

  let pontos = 0;

  const ferramentas = conta(texto, NOSSAS_FERRAMENTAS);
  if (ferramentas.length) {
    // Três pontos pela PRIMEIRA e um por cada outra: o texto que lista quinze
    // ferramentas não é notícia sobre nenhuma delas.
    pontos += 3 + Math.min(2, ferramentas.length - 1);
    motivos.push(`usamos: ${ferramentas.slice(0, 3).join(", ")}`);
  }

  const temSetor = CONTEXTO_SETOR.some((c) => contemTermo(texto, c));
  const rivais = CONCORRENTES.filter((c) =>
    contemTermo(texto, c) && (!RIVAIS_AMBIGUOS.includes(c) || temSetor));
  if (rivais.length) {
    pontos += pauta === "foodservice" ? 3 : 2;
    motivos.push(`setor: ${rivais.slice(0, 3).join(", ")}`);
  }

  const verbos = conta(texto, VERBOS_DE_FATO);
  if (verbos.length) {
    pontos += 1;
    motivos.push(`fato: ${verbos.slice(0, 2).join(", ")}`);
  }

  /* ------------------------------------------------- a régua de cada frente */

  /* MENÇÃO NÃO É NOTÍCIA — e esta é a regra que o painel mais precisava.
   *
   * Medido na rodada de estreia (28/08/2026): citar "Anthropic" e "OpenAI" já
   * valia 5 pontos, e cruzava o corte sozinho. O resultado foi um painel com
   * "OpenAI's Mid-Game Battle: Strategic Shifts" e "os 100 mais influentes da
   * IA de 2026" — dois textos que citam nossos fornecedores e não mudam uma
   * linha do que fazemos —, enquanto o anúncio de produto de verdade ficava de
   * fora, empurrado pela cota da pauta.
   *
   * Vale para as duas frentes que vivem de ANÚNCIO (ferramentas e finanças). A
   * de backoffice fica de fora porque ali o que se procura é CASO contado, e
   * caso raramente vem com verbo de anúncio; a de startups aceita a cifra no
   * lugar do verbo; e a de foodservice tem as duas portas logo abaixo, porque o
   * dado do setor chega sem verbo nenhum ("foodservice: R$ 62,9 bi no 2T26").
   */
  if ((pauta === "ia_ferramentas" || pauta === "financas") && verbos.length === 0) {
    return { pontos: 1, motivos: [...motivos, "só menção — nada aconteceu"], ruido: false };
  }

  if (pauta === "foodservice") {
    /* DUAS PORTAS, E ESSA É A NOVIDADE DA FRENTE.
     *
     * A primeira é o nome do rival, que sempre valeu — e continua exigindo que
     * algo tenha acontecido, senão volta o problema de sempre: a matéria que
     * cita o iFood de passagem.
     *
     * A segunda é o DADO do setor, que entrou quando o "Panorama do dia" foi
     * extinto: "foodservice bateu recorde no 2T26, R$ 62,9 bi" não cita
     * concorrente nenhum e é exatamente o número que servia de munição comercial
     * na prosa. Ela NÃO exige verbo de fato, e isso é o ponto: manchete de dado
     * setorial é substantivo e número, quase nunca verbo de anúncio.
     *
     * O preço de abrir a segunda porta é a matéria de gastronomia, que a busca
     * traz em muito maior volume. Por isso ela exige DOIS sinais de mercado:
     * "restaurante do centro lança cardápio de inverno" tem contexto de setor e
     * verbo de fato — que daria exatamente o corte —, e não tem nem faturamento,
     * nem pesquisa, nem número.
     */
    if (rivais.length) {
      if (!verbos.length) {
        return { pontos: 1, motivos: [...motivos, "só menção — nada aconteceu"], ruido: false };
      }
    } else {
      const dados = conta(texto, DADO_DE_MERCADO);
      if (temSetor && dados.length >= 2) {
        pontos += 3;
        motivos.push(`dado do setor: ${dados.slice(0, 3).join(", ")}`);
      } else {
        return { pontos: 1, motivos: [...motivos, "setor sim, nada de novo"], ruido: false };
      }
    }
  }

  if (pauta === "financas") {
    const termos = conta(texto, FINANCAS);
    if (!termos.length) {
      return { pontos: 1, motivos: [...motivos, "não é assunto de finanças"], ruido: false };
    }
    pontos += 3 + Math.min(1, termos.length - 1);
    motivos.push(`finanças: ${termos.slice(0, 3).join(", ")}`);
  }

  if (pauta === "startups") {
    const termos = conta(texto, STARTUP);
    /* A CIFRA VALE PELO VERBO. "Nuvemshop, US$ 500 milhões" é rodada mesmo sem
       um único verbo de anúncio no título — e é o formato mais comum da
       manchete de captação, que costuma ser nome + valor + estágio. */
    const cifra = ["milhoes", "milhao", "bilhoes", "bilhao", "million", "billion"].some((c) => contemTermo(texto, c));
    if (!termos.length || (!verbos.length && !cifra)) {
      return { pontos: 1, motivos: [...motivos, "não é movimento de startup"], ruido: false };
    }
    pontos += 3 + Math.min(1, termos.length - 1);
    if (cifra) pontos += 1;
    motivos.push(`startup: ${termos.slice(0, 3).join(", ")}`);
  }

  if (pauta === "ia_backoffice") {
    /* A pauta de backoffice não tem vocabulário próprio forte — ela procura
       CASO, e caso se reconhece pela combinação "empresa + resultado". Sem este
       empurrão ela quase nunca cruzaria o corte, e a pauta viveria vazia. */
    const sinais = ["conciliacao", "contas a pagar", "nota fiscal", "fechamento",
                    "backoffice", "financeiro", "contabil", "erp", "auditoria"];
    const casou = conta(texto, sinais);
    if (casou.length >= 2) { pontos += 3; motivos.push(`backoffice: ${casou.slice(0, 3).join(", ")}`); }
    else if (casou.length === 1) { pontos += 1; motivos.push(`backoffice: ${casou[0]}`); }
  }

  /* Recência vale ponto, mas só some com data. A ausência de data no resultado
     do buscador é comum e não diz nada sobre a idade da matéria — descontar por
     isso puniria o veículo pelo formato do HTML dele. */
  if (b.publicado) {
    const iso = lerQuando(b.publicado, agora);
    const t = iso ? Date.parse(iso) : NaN;
    if (!isNaN(t)) {
      const horas = (agora.getTime() - t) / 3_600_000;
      if (horas <= 36 && horas >= -6) { pontos += 2; motivos.push("das últimas 36h"); }
      else if (horas > 24 * 21) { pontos -= 2; motivos.push("mais de três semanas"); }
    }
  }

  /* O gosto declarado entra POR ÚLTIMO e como soma, não como multiplicador: ele
     desempata e reordena a fila do dia, e não faz um item passar no lugar da
     régua. Um 👍 vale até 4 pontos; o corte é 3, então um assunto muito querido
     pode, sim, aprovar sozinho — e essa é a intenção declarada do botão. */
  if (gosto.delta) {
    pontos += gosto.delta;
    motivos.push(...gosto.motivos);
  }

  return { pontos, motivos, ruido: false };
}

export function valeMostrar(n: Nota): boolean {
  return !n.ruido && n.pontos >= CORTE;
}

/**
 * Quantos itens do dia chegam à tela.
 *
 * SEIS, E NÃO "TODOS OS QUE PASSAREM". Briefing se lê em pé, antes do café; uma
 * lista de vinte manchetes não é mais informação, é a mesma informação com um
 * custo de leitura que faz a pessoa fechar a aba. O corte por score já derrubou
 * o que não importa — este corte derruba o que importa menos.
 */
export const MAX_NA_TELA = 6;

/**
 * No máximo dois de uma pauta só.
 *
 * ERA TRÊS ENQUANTO ERAM TRÊS PAUTAS; virou dois quando viraram quatro frentes.
 * A conta é a mesma de sempre: sem trava, um dia movimentado na Anthropic
 * entrega o painel inteiro de "IA e ferramentas" — justamente no dia em que
 * finanças tinha a decisão do Copom e foodservice, o dado do trimestre. A cota
 * protege a DIVERSIDADE, que é o que faz o painel valer quatro olhares em vez
 * de um. Com seis linhas e dois por pauta, cabem três frentes por manhã.
 */
export const MAX_POR_PAUTA = 2;

/** O veículo, quando o buscador não diz: o host, sem `www`. */
export function hostDe(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "fonte"; }
}

export interface Candidato extends Bruto {
  pauta: PautaChave;
  nota: Nota;
}

/**
 * Quais candidatos do dia viram linha na tela.
 *
 * A ORDEM É POR PONTOS, e o desempate é a cota por pauta — não o contrário.
 * Ordenar dentro de cada pauta e depois intercalar pareceria mais justo e seria
 * pior: entregaria o terceiro melhor item de uma pauta fraca na frente do
 * segundo melhor de uma pauta forte, num painel que só tem seis linhas.
 */
export function escolherDoDia(
  candidatos: Candidato[],
  max = MAX_NA_TELA,
  maxPorPauta = MAX_POR_PAUTA,
): Candidato[] {
  const ordenados = [...candidatos]
    .filter((c) => valeMostrar(c.nota))
    .sort((a, b) => b.nota.pontos - a.nota.pontos);

  const porPauta = new Map<PautaChave, number>();
  const escolhidos: Candidato[] = [];
  for (const c of ordenados) {
    if (escolhidos.length >= max) break;
    const usados = porPauta.get(c.pauta) ?? 0;
    if (usados >= maxPorPauta) continue;
    porPauta.set(c.pauta, usados + 1);
    escolhidos.push(c);
  }
  return escolhidos;
}

/* ================================================= o voto vira vocabulário */

/**
 * A chave de um assunto aprendido: o rótulo, normalizado.
 *
 * É POR AQUI QUE OS VOTOS SE SOMAM. Duas pessoas votando em "preço de API de IA"
 * e "Preço de API de IA" têm de cair na mesma linha, senão o peso nunca passa de
 * 1 e o botão não aprende nada — só acumula linhas parecidas na tela de
 * preferências, que é a maneira mais silenciosa de um recurso destes falhar.
 */
export function chaveDoAssunto(rotulo: string): string {
  return normalizarTexto(rotulo).slice(0, 80);
}

/**
 * Limpa os termos que a IA devolveu para virarem vocabulário da régua.
 *
 * Normaliza (a régua compara normalizado), tira o que tem menos de três letras —
 * "ia", "os", "de" casariam com tudo — e corta em cinco. Cinco porque o
 * casamento exige dois: uma lista longa transforma o assunto em peneira grossa,
 * e aí o 👎 em uma notícia derruba uma pauta inteira.
 */
export function limparTermos(termos: unknown, max = 5): string[] {
  const brutos = Array.isArray(termos) ? termos : [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const t of brutos) {
    const n = normalizarTexto(String(t ?? "")).slice(0, 40);
    if (n.replace(/\s/g, "").length < 3 || vistos.has(n)) continue;
    vistos.add(n);
    saida.push(n);
    if (saida.length >= max) break;
  }
  return saida;
}
