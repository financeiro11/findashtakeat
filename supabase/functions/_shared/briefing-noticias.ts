// A régua do painel de notícias: o que se procura, o que se descarta e o que
// merece uma linha na tela de manhã.
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
// importa". Deixar a IA escolher produziria uma seleção diferente a cada manhã,
// impossível de calibrar e impossível de explicar.
//
// O QUE ESTE PAINEL NÃO É. Não é feed de notícia geral — macro Brasil e
// foodservice genérico continuam vindo da skill de briefing, em prosa. Aqui
// entram três pautas escolhidas por serem ACIONÁVEIS: ferramenta que usamos e
// mexeu, IA aplicada a backoffice que dá para copiar no Hub, e concorrente que
// se mexeu. Notícia que não muda nada do que fazemos é ruído com fonte confiável.

/* ============================================================== as pautas */

export type PautaChave = "ia_ferramentas" | "ia_backoffice" | "concorrentes";

export interface Consulta {
  q: string;
  /** Janela do buscador: `qdr:d` = último dia, `qdr:w` = última semana. */
  tbs: string;
  /**
   * Qual aba do buscador. UMA SÓ POR CONSULTA, e a escolha é por pauta:
   *
   * • `news` para o que sai em veículo — lançamento de modelo, movimento de
   *   concorrente. É a única aba que devolve data e nome do veículo, que é o que
   *   permite escrever "há 3 horas, no TechCrunch" em vez de adivinhar pela URL.
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
  consultas: Consulta[];
}

/**
 * Quatro buscas por dia, ao custo de 2 créditos cada (o Firecrawl cobra por
 * dezena de resultados, arredondando para cima — daí `RESULTADOS = 10`, porque
 * pedir 5 pagaria o mesmo por metade). São ~240 créditos/mês, ou 300 no mês em
 * que TODO dia precisar da retentativa da aba de notícias — que é exatamente o
 * teto. Quem quiser espaço para o "buscar agora" da tela num mês desses sobe o
 * teto no painel de créditos; o freio avisa antes de estourar, não depois.
 *
 * A ABA DE NOTÍCIAS É INTERMITENTE, e essa é a lição cara de 28/08/2026. Onze
 * buscas medidas, e o resultado NÃO tem padrão de consulta:
 *
 *     "Anthropic OpenAI Claude modelo"        qdr:d   news → 10
 *     "inteligência artificial empresas"      qdr:d   news → 10
 *     "restaurantes delivery cardápio digital" qdr:d  news →  4
 *     "iFood restaurantes delivery"           qdr:d   news →  0
 *     "iFood restaurantes delivery"           qdr:w   news →  0
 *     "Supabase n8n Cursor desenvolvedores"   (sem)   news →  0
 *
 * A mesma família de consulta devolve dez numa hora e zero na seguinte, e
 * ACRESCENTAR um termo chegou a aumentar o número de achados — o que não é
 * comportamento de busca, é comportamento de serviço intermitente. Cheguei a
 * concluir que a culpa era do `tbs: "qdr:w"` (todas as primeiras vazias tinham
 * essa janela) e a consulta seguinte, com `qdr:d`, desmentiu.
 *
 * O QUE SE FAZ COM ISSO: não confiar em zero. A rodada retenta UMA vez quando a
 * aba de notícias volta vazia sem erro, e o painel guarda o que já tinha em vez
 * de esvaziar — item não lido continua na tela pelos dias seguintes. O que NÃO
 * se faz é ler "0 achados" como "não houve notícia": é a leitura natural, é
 * plausível, e está errada com frequência.
 *
 * Continua valendo `qdr:d` na aba de notícias por outro motivo, esse sim de
 * desenho: um painel lido toda manhã quer o dia, e a semana traria o mesmo
 * anúncio sete vezes. A aba `web` usa `qdr:w` e não deu sinal de intermitência.
 *
 * CONSULTA CURTA NA ABA DE NOTÍCIAS. A primeira versão mandava sopa de termos
 * com aspas e oito palavras; as de duas a quatro palavras rendem mais. Com a
 * intermitência no meio, isto é tendência medida, não lei.
 */
export const PAUTAS: Pauta[] = [
  {
    chave: "ia_ferramentas",
    rotulo: "IA e as ferramentas que usamos",
    oQueImporta:
      "A Takeat roda o Hub sobre Gemini, OpenAI, Supabase e Firecrawl, e o financeiro sobre Omie e Asaas. " +
      "Interessa: modelo novo, mudança de preço, recurso que substitui trabalho que hoje é nosso, " +
      "e depreciação de algo que já usamos.",
    consultas: [
      { q: "Anthropic OpenAI Claude modelo", tbs: "qdr:d", fontes: ["news"] },
      { q: "Gemini Google IA lançamento", tbs: "qdr:d", fontes: ["news"] },
    ],
  },
  {
    chave: "ia_backoffice",
    rotulo: "IA aplicada ao financeiro",
    oQueImporta:
      "O que dá para copiar no Hub: agente de conciliação, leitura de nota fiscal, automação de contas a " +
      "pagar, fechamento contábil assistido. Interessa o caso concreto de quem implantou e contou o " +
      "resultado — não a promessa de fornecedor.",
    consultas: [
      { q: "inteligência artificial agente automação financeiro conciliação contas a pagar nota fiscal empresa caso", tbs: "qdr:w", fontes: ["web"] },
    ],
  },
  {
    chave: "concorrentes",
    rotulo: "Concorrentes e o setor",
    oQueImporta:
      "Quem disputa o mesmo restaurante que a Takeat: Goomer, Anota AI, Saipos, Consumer, Neemo, Cardápio " +
      "Web, e as plataformas de delivery. Interessa lançamento, mudança de preço, aporte, aquisição e " +
      "encerramento.",
    consultas: [
      /* Setor, e não os nomes das empresas: "Goomer" e "Saipos" não aparecem no
         índice de notícias (medido — zero em três janelas diferentes). O que
         aparece é a matéria de restaurante e delivery, e é ali que o movimento
         do concorrente sai quando sai. Quem separa o que interessa é a régua,
         que exige nome de rival OU contexto do setor mais um verbo de fato. */
      { q: "restaurantes delivery cardápio digital", tbs: "qdr:d", fontes: ["news"] },
    ],
  },
];

/** Resultados por busca. Ver a conta em `PAUTAS`: menos que 10 custa igual. */
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
 * descobre que ela existiu.
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
];

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

/**
 * Quanto vale este resultado de busca.
 *
 * A ESCALA É PEQUENA DE PROPÓSITO (0 a ~10). Um score fino daria a impressão de
 * medir precisão que não existe: isto é uma soma de casamentos de palavra em um
 * título e duas linhas de snippet. O que ele precisa fazer é separar "cita uma
 * ferramenta nossa e anuncia alguma coisa" de "cita uma ferramenta nossa de
 * passagem" — e para isso três faixas bastam.
 */
export function pontuar(b: Bruto, pauta: PautaChave, agora: Date = new Date()): Nota {
  const texto = normalizarTexto(`${b.titulo} ${b.descricao}`);
  const motivos: string[] = [];

  for (const r of RUIDO) {
    if (contemTermo(texto, r)) {
      return { pontos: 0, motivos: [`descartado: parece ${r}`], ruido: true };
    }
  }

  let pontos = 0;

  const ferramentas = NOSSAS_FERRAMENTAS.filter((f) => contemTermo(texto, f));
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
    pontos += pauta === "concorrentes" ? 3 : 2;
    motivos.push(`setor: ${rivais.slice(0, 3).join(", ")}`);
  }

  const verbos = VERBOS_DE_FATO.filter((v) => contemTermo(texto, v));
  if (verbos.length) {
    pontos += 1;
    motivos.push(`fato: ${verbos.slice(0, 2).join(", ")}`);
  }

  /* MENÇÃO NÃO É NOTÍCIA — e esta é a regra que o painel mais precisava.
   *
   * Medido na rodada de estreia (28/08/2026): citar "Anthropic" e "OpenAI" já
   * valia 5 pontos, e cruzava o corte sozinho. O resultado foi um painel com
   * "OpenAI's Mid-Game Battle: Strategic Shifts" e "os 100 mais influentes da
   * IA de 2026" — dois textos que citam nossos fornecedores e não mudam uma
   * linha do que fazemos —, enquanto o anúncio de produto de verdade ficava de
   * fora, empurrado pela cota da pauta.
   *
   * Nestas duas pautas o item precisa dizer que ALGO ACONTECEU: lançou, mudou
   * de preço, comprou, encerrou. Sem verbo de fato, o item fica em 1 ponto e
   * morre no corte — mas continua com os motivos preenchidos, para a `previa`
   * poder mostrar por que ele não entrou.
   *
   * A pauta de backoffice não passa por aqui: lá o que se procura é CASO
   * contado, e caso raramente vem com verbo de anúncio. Ela tem a própria régua
   * logo abaixo, que exige dois sinais de backoffice.
   */
  if ((pauta === "ia_ferramentas" || pauta === "concorrentes") && verbos.length === 0) {
    return { pontos: 1, motivos: [...motivos, "só menção — nada aconteceu"], ruido: false };
  }

  /* NA PAUTA DE CONCORRENTES, PRECISA TER NOME.
   *
   * A consulta dela é do SETOR ("restaurantes delivery cardápio digital"),
   * porque os nomes das empresas não existem no índice de notícias. O preço
   * disso é que a busca traz muita matéria de restaurante em geral — abertura de
   * casa nova, tendência de consumo, alta do preço do insumo. Nada disso é
   * movimento de concorrente, e tudo isso passaria: contexto de setor mais um
   * verbo de fato dá exatamente o corte.
   *
   * Então aqui a régua é nominal. O custo é a pauta ficar vazia em muitos dias —
   * e ficar vazia é a resposta certa quando não houve movimento, num painel que
   * já tem outras duas pautas e a faixa dos fornecedores para mostrar.
   */
  if (pauta === "concorrentes" && rivais.length === 0) {
    return { pontos: 1, motivos: [...motivos, "setor sim, concorrente não"], ruido: false };
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

  /* A pauta de backoffice não tem vocabulário próprio forte — ela procura CASO,
     e caso se reconhece pela combinação "empresa + resultado". Sem este empurrão
     ela quase nunca cruzaria o corte, e a pauta viveria vazia. */
  if (pauta === "ia_backoffice") {
    const sinais = ["conciliacao", "contas a pagar", "nota fiscal", "fechamento",
                    "backoffice", "financeiro", "contabil", "erp", "auditoria"];
    const casou = sinais.filter((s) => contemTermo(texto, s));
    if (casou.length >= 2) { pontos += 3; motivos.push(`backoffice: ${casou.slice(0, 3).join(", ")}`); }
    else if (casou.length === 1) { pontos += 1; motivos.push(`backoffice: ${casou[0]}`); }
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
 * No máximo três de uma pauta só.
 *
 * Sem esta trava, um dia movimentado na Anthropic entrega seis manchetes de
 * "IA e ferramentas" e o painel inteiro vira uma pauta — justamente no dia em
 * que a pauta de concorrentes tinha a única notícia da semana. A cota protege a
 * DIVERSIDADE, que é o que faz o painel valer os três olhares em vez de um.
 */
export const MAX_POR_PAUTA = 3;

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
