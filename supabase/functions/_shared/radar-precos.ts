// Núcleo do Radar de Preços do Facilities: ler as specs de um anúncio e decidir
// se ele atende ao que foi pedido.
//
// ESTE ARQUIVO NÃO IMPORTA NADA — de propósito. Ele é a fonte única, lida pelos
// dois lados: o Deno da Edge Function importa daqui com `.ts`, e o front importa
// via `src/lib/radarPrecos.ts`, que só reexporta. É o mesmo problema do
// `_shared/folha-envio.ts` (CLAUDE.md): duas cópias do mesmo cálculo divergem na
// primeira vez que alguém edita uma e esquece a outra, e o sintoma não é erro de
// build — é a tela mostrando um número diferente do que o servidor decidiu.
//
// POR QUE A DECISÃO É DETERMINÍSTICA E NÃO DA IA. A IA entra uma vez só, na hora
// de traduzir "notebook i5 16GB até 3 mil" em specs (e depois para redigir o
// aviso). O casamento anúncio-a-anúncio é regra em TypeScript porque roda
// centenas de vezes por dia, precisa ser barato, e principalmente porque precisa
// ser *auditável*: quando o radar recusar um anúncio, o Facilities tem de
// conseguir ler o motivo em português e discordar.
//
// O QUE MAIS ESTRAGA UM RADAR DE PREÇO É O ACESSÓRIO. Buscar "notebook i5 16gb"
// no Mercado Livre devolve, junto com notebooks, o carregador do notebook, a
// capa do notebook, a memória de 16GB avulsa e o aparelho "no estado, para
// retirada de peças". Todos são baratos, todos batem o preço-alvo, e um radar
// ingênuo avisaria em todos. Por isso a recusa por acessório e a recusa por
// preço-piso vêm ANTES de qualquer pontuação.

/* ------------------------------------------------------------------ tipos */

export type Condicao = "novo" | "usado" | "recondicionado";

/** Categoria com regra embutida de acessório. Fora desta lista, vale só o que a IA escreveu. */
export type CategoriaRadar =
  | "notebook" | "monitor" | "celular" | "tablet" | "impressora"
  | "cadeira" | "desktop" | "outro";

/** O que o Facilities quer — saída da interpretação por IA, guardada em `specs`. */
export interface AlvoSpecs {
  categoria: CategoriaRadar;
  /** Marcas aceitas (normalizadas). Vazio = qualquer marca. */
  marcas?: string[];
  /** Tier mínimo de processador: 3 (i3/Ryzen 3), 5, 7, 9. */
  cpu_tier_min?: number | null;
  /** Geração mínima: 12 exige i5-12xxx ou melhor. */
  cpu_geracao_min?: number | null;
  ram_gb_min?: number | null;
  armazenamento_gb_min?: number | null;
  /** "ssd" recusa HD mecânico e eMMC. */
  armazenamento_tipo?: "ssd" | "qualquer" | null;
  tela_pol_min?: number | null;
  tela_pol_max?: number | null;
  /** Palavras que TÊM de aparecer no título (já normalizadas). */
  termos_obrigatorios?: string[];
  /** Palavras que reprovam o anúncio (já normalizadas). */
  termos_proibidos?: string[];
  /** Condições aceitas. Default: só novo. */
  condicoes?: Condicao[];
  /** Termos de busca sugeridos pela IA, um por consulta. */
  buscas?: string[];
}

/** O que deu para ler do título de um anúncio. `null` = o anúncio não diz. */
export interface SpecsLidas {
  marca: string | null;
  cpu_tier: number | null;
  /** Só faz sentido comparar com `cpu_geracao_min` quando `cpu_marca` é "intel". */
  cpu_geracao: number | null;
  cpu_marca: "intel" | "amd" | "apple" | null;
  cpu_texto: string | null;
  ram_gb: number | null;
  armazenamento_gb: number | null;
  armazenamento_tipo: "ssd" | "hd" | "emmc" | null;
  tela_pol: number | null;
}

export interface OfertaBruta {
  fonte: string;
  id_externo: string;
  titulo: string;
  url: string;
  preco: number;
  preco_original?: number | null;
  imagem_url?: string | null;
  vendedor?: string | null;
  /** Reputação normalizada do vendedor, 0..1. null quando a fonte não informa. */
  reputacao?: number | null;
  vendas?: number | null;
  condicao?: Condicao | null;
  /**
   * `false` reprova o anúncio. `null` = a fonte não disse, e aí o radar não
   * inventa: segue, mas manda conferir.
   */
  disponivel?: boolean | null;
  frete_gratis?: boolean | null;
  /** Frete em reais. `0` é frete grátis; `null` é frete desconhecido — não são a mesma coisa. */
  frete_valor?: number | null;
  /** O que a página escreveu sobre frete, para a tela poder mostrar em vez de sumir. */
  frete_texto?: string | null;
}

export interface Avaliacao {
  aprovado: boolean;
  /** 0..100. Só faz sentido quando `aprovado`. */
  score: number;
  /** Motivo único da recusa, em português, para a tela. */
  recusa: string | null;
  /** O que pesou a favor. */
  motivos: string[];
  /** Specs que o anúncio não informou e alguém precisa conferir no link. */
  conferir: string[];
  lidas: SpecsLidas;
  /** Preço + frete. É por ELE que o teto, o ranking e a economia são medidos. */
  total: number;
  /** `false` quando o frete não é conhecido e o `total` é só o preço do produto. */
  frete_conhecido: boolean;
}

/* ------------------------------------------------------------- normalização */

/** minúsculas, sem acento, sem pontuação — a forma em que todas as regras comparam. */
export function norm(s: string | null | undefined): string {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.,"'\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* --------------------------------------------------------- leitura do título */

const MARCAS = [
  "lenovo", "dell", "acer", "asus", "hp", "samsung", "apple", "macbook", "positivo",
  "vaio", "multilaser", "avell", "gigabyte", "msi", "lg", "motorola", "xiaomi",
  "aoc", "philips", "benq", "epson", "brother", "canon", "logitech", "flexform",
  "cavaletti", "dt3", "thinkpad", "ideapad", "inspiron", "vostro", "latitude",
];

/**
 * Tier do processador. É uma escada grosseira de propósito: o radar não decide
 * se um Ryzen 5 5500U é melhor que um i5-1135G7 — decide que os dois passam num
 * pedido de "i5 ou superior", que é o que o Facilities realmente quis dizer.
 */
type MarcaCpu = "intel" | "amd" | "apple";
const CPU_TIERS: Array<[RegExp, number, string, MarcaCpu]> = [
  [/\b(?:intel\s*)?core\s*ultra\s*9\b/, 9, "Core Ultra 9", "intel"],
  [/\b(?:intel\s*)?core\s*ultra\s*7\b/, 7, "Core Ultra 7", "intel"],
  [/\b(?:intel\s*)?core\s*ultra\s*5\b/, 5, "Core Ultra 5", "intel"],
  [/\b(?:core\s*)?i9\b/, 9, "i9", "intel"],
  [/\b(?:core\s*)?i7\b/, 7, "i7", "intel"],
  [/\b(?:core\s*)?i5\b/, 5, "i5", "intel"],
  [/\b(?:core\s*)?i3\b/, 3, "i3", "intel"],
  [/\bryzen\s*9\b/, 9, "Ryzen 9", "amd"],
  [/\bryzen\s*7\b/, 7, "Ryzen 7", "amd"],
  [/\bryzen\s*5\b/, 5, "Ryzen 5", "amd"],
  [/\bryzen\s*3\b/, 3, "Ryzen 3", "amd"],
  [/\bm[34]\s*(?:pro|max|ultra)\b/, 9, "Apple M3/M4 Pro", "apple"],
  [/\bm[34]\b/, 8, "Apple M3/M4", "apple"],
  [/\bm2\s*(?:pro|max|ultra)\b/, 8, "Apple M2 Pro", "apple"],
  [/\bm2\b/, 7, "Apple M2", "apple"],
  [/\bm1\s*(?:pro|max|ultra)\b/, 7, "Apple M1 Pro", "apple"],
  [/\bm1\b/, 6, "Apple M1", "apple"],
  [/\b(celeron|pentium|atom)\b/, 1, "entrada", "intel"],
  [/\bathlon\b/, 1, "entrada", "amd"],
];

/**
 * i5-1235U → 12 · i7-9750H → 9 · Ryzen 5 5500U → 5.
 *
 * O `(?:[a-z]{1,3})?` no fim não é enfeite: quase todo modelo de notebook traz
 * um sufixo colado ("1235U", "9750H", "1135G7"), e sem ele o `\b` depois dos
 * dígitos nunca fecha — a geração saía sempre null.
 */
function geracaoIntel(t: string): number | null {
  const m = t.match(/\b(?:core\s*)?i[3579][\s\-]?(\d{4,5})(?:[a-z]{1,3}\d?)?\b/);
  if (m) {
    /* Onde a geração termina no número do modelo NÃO é o comprimento: i7-9750H
       é 9ª e i5-1235U é 12ª, os dois com quatro dígitos. O que separa é o "1"
       na frente — da 10ª em diante a geração passou a ocupar dois dígitos. */
    const d = m[1];
    if (d.length === 5) return Number(d.slice(0, 2));
    return d.startsWith("1") ? Number(d.slice(0, 2)) : Number(d.slice(0, 1));
  }
  // "12ª geração", "13a geracao", "geracao 12"
  const g = t.match(/\b(\d{1,2})\s*[ªa]?\s*ger(?:a[çc][ãa]o)?\b/) || t.match(/\bger(?:a[çc][ãa]o)?\s*(\d{1,2})\b/);
  if (g) {
    const n = Number(g[1]);
    if (n >= 1 && n <= 20) return n;
  }
  const r = t.match(/\bryzen\s*[3579]\s*(\d{4})(?:[a-z]{1,3})?\b/);
  if (r) return Number(r[1].slice(0, 1));
  return null;
}

/** Valores que só existem como memória RAM de notebook/desktop. */
const RAM_PLAUSIVEL = new Set([4, 6, 8, 12, 16, 24, 32, 48, 64, 128]);
/** Valores que só existem como armazenamento. */
const DISCO_PLAUSIVEL = new Set([128, 240, 256, 480, 500, 512, 960, 1000, 1024, 2000, 2048]);

/**
 * Separa "16GB RAM 512GB SSD" nos dois números certos.
 *
 * Não dá para ir pelo primeiro número: metade dos anúncios escreve
 * "Notebook 512GB SSD 16GB RAM" e a outra metade o contrário. A regra que
 * funciona é olhar as palavras coladas no número e, quando não houver nenhuma,
 * cair na grandeza — 16 nunca é disco, 512 nunca é memória.
 */
function memorias(t: string): { ram: number | null; disco: number | null; tipo: SpecsLidas["armazenamento_tipo"] } {
  let ram: number | null = null;
  let disco: number | null = null;
  let tipo: SpecsLidas["armazenamento_tipo"] = null;

  const re = /(\d{1,4})\s*(gb|tb)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const bruto = Number(m[1]);
    const emGb = m[2] === "tb" ? bruto * 1024 : bruto;
    // ±22 caracteres em volta do número é onde as etiquetas vivem
    const ctx = t.slice(Math.max(0, m.index - 22), Math.min(t.length, re.lastIndex + 22));

    const dizRam = /\b(ram|memoria|mem\b|ddr[345]?|lpddr)\b/.test(ctx);
    const dizDisco = /\b(ssd|hd|hdd|nvme|m\.?2|emmc|armazenamento|sata|disco)\b/.test(ctx);

    /* A ETIQUETA SÓ VALE SE A GRANDEZA PERMITIR. "Notebook i5 16GB SSD 512GB"
       põe "SSD" a poucos caracteres do 16, e a leitura ingênua concluía
       "16GB de armazenamento" — daí saíam recusas absurdas ("16GB de
       armazenamento, abaixo dos 512GB pedidos") em anúncios perfeitos. Foram
       12 dos 33 recusados na varredura de 26/08/2026. Não existe notebook com
       16GB de disco nem com 512GB de RAM: quando a etiqueta briga com a
       grandeza, a grandeza ganha. */
    const cabeComoDisco = emGb >= 120;
    const cabeComoRam = emGb <= 128;

    if (dizRam && !dizDisco && cabeComoRam) { if (ram == null) ram = emGb; continue; }
    if (dizDisco && !dizRam && cabeComoDisco) {
      if (disco == null) disco = emGb;
      if (!tipo) tipo = /\bemmc\b/.test(ctx) ? "emmc" : /\b(ssd|nvme|m\.?2)\b/.test(ctx) ? "ssd" : "hd";
      continue;
    }
    if (m[2] === "tb") { if (disco == null) disco = emGb; continue; }
    if (RAM_PLAUSIVEL.has(emGb) && !DISCO_PLAUSIVEL.has(emGb)) { if (ram == null) ram = emGb; continue; }
    if (DISCO_PLAUSIVEL.has(emGb)) { if (disco == null) disco = emGb; continue; }
  }

  // Tipo declarado longe do número ("Notebook ... SSD" no fim do título)
  if (disco != null && !tipo) {
    tipo = /\bemmc\b/.test(t) ? "emmc" : /\b(ssd|nvme|m\.?2)\b/.test(t) ? "ssd" : /\b(hd|hdd|sata)\b/.test(t) ? "hd" : null;
  }
  return { ram, disco, tipo };
}

function polegadas(t: string): number | null {
  const m = t.match(/(\d{2}(?:[.,]\d)?)\s*(?:"|''|pol\b|polegadas?\b|inch\b)/);
  if (m) {
    const n = Number(m[1].replace(",", "."));
    if (n >= 10 && n <= 60) return n;
  }
  /* Metade dos títulos larga o tamanho solto no fim ("... 512GB SSD 15.6").
     A casa decimal é o que dá segurança: 15.6 e 14.1 só existem como tela, ao
     passo que um "16" solto seria a memória. Inteiro solto fica de fora. */
  const d = t.match(/\b(1[0-9][.,][0-9])\b/);
  if (d) return Number(d[1].replace(",", "."));
  return null;
}

export function lerSpecs(titulo: string): SpecsLidas {
  const t = norm(titulo);
  const { ram, disco, tipo } = memorias(t);

  let cpu_tier: number | null = null;
  let cpu_texto: string | null = null;
  let cpu_marca: MarcaCpu | null = null;
  for (const [re, tier, nome, marca] of CPU_TIERS) {
    if (re.test(t)) { cpu_tier = tier; cpu_texto = nome; cpu_marca = marca; break; }
  }

  return {
    marca: MARCAS.find((mk) => new RegExp(`\\b${mk}\\b`).test(t)) ?? null,
    cpu_tier,
    // Geração só é número comparável na Intel — ver `avaliar`.
    cpu_geracao: cpu_marca === "intel" ? geracaoIntel(t) : null,
    cpu_marca,
    cpu_texto,
    ram_gb: ram,
    armazenamento_gb: disco,
    armazenamento_tipo: tipo,
    tela_pol: polegadas(t),
  };
}

/* -------------------------------------------------------- filtros de recusa */

/**
 * O que vem junto na busca e NÃO é o produto. Cada linha aqui saiu de um
 * anúncio real que apareceria numa busca por "notebook i5 16gb".
 *
 * ESTAS REGRAS SÓ VALEM NO COMEÇO DO TÍTULO — ver `cabeca()`. Procurar
 * "carregador" no título inteiro reprovaria "Notebook Dell i5 16GB com
 * carregador original", que é exatamente o que se quer comprar. Anúncio de
 * marketplace põe o substantivo do produto na frente: "Carregador Para
 * Notebook Dell 65W" começa com o acessório, o notebook de verdade começa com
 * "Notebook".
 */
const ACESSORIOS: Record<string, RegExp> = {
  notebook: /\b(carregador|fonte|bateria|capa|case|sleeve|pelicula|suporte|cooler|mochila|maleta|adaptador|hub|dock|docking|cabo|mouse|teclado|dobradica|carcaca|flat|placa mae|memoria|pente|kit upgrade|refil|caneta)\b/,
  monitor: /\b(suporte|braco|cabo|adaptador|pelicula|capa|fonte|placa de video)\b/,
  celular: /\b(capa|case|pelicula|carregador|fone|cabo|suporte|bateria|display|chip)\b/,
  tablet: /\b(capa|case|pelicula|caneta|carregador|cabo|suporte|teclado)\b/,
  impressora: /\b(toner|cartucho|refil|tinta|cabo|papel|cilindro|fusor)\b/,
  cadeira: /\b(capa|rodizio|rodinha|pistao|cilindro|apoio|almofada|braco|base|kit reparo)\b/,
  desktop: /\b(gabinete|fonte|placa mae|memoria|cooler|cabo|suporte|placa de video)\b/,
  outro: /(?!)/,
};

/**
 * O substantivo que o produto obriga. Ausente = o anúncio é outra coisa, e nem
 * adianta olhar spec. Barra o caso oposto ao do acessório: a busca por
 * "16gb ssd 512" trazendo um kit de memória que não é notebook nenhum.
 */
const PRODUTO: Record<string, RegExp> = {
  notebook: /\b(notebook|note|laptop|ultrabook|macbook|chromebook|thinkpad|ideapad|inspiron|vostro|latitude)\b/,
  monitor: /\bmonitor\b/,
  celular: /\b(celular|smartphone|iphone|galaxy|moto\s?g|redmi)\b/,
  tablet: /\b(tablet|ipad)\b/,
  impressora: /\b(impressora|multifuncional)\b/,
  cadeira: /\b(cadeira|poltrona)\b/,
  desktop: /\b(desktop|computador|pc\b|all in one|mini pc)\b/,
  outro: /(?:)/,
};

/** As primeiras palavras do título, onde mora o substantivo do anúncio. */
function cabeca(t: string, palavras = 4): string {
  return t.split(" ").slice(0, palavras).join(" ");
}

/** Palavras que aparecem quando o "produto" é sucata, e por isso é barato. */
const SUCATA =
  /\b(nao liga|n[aã]o liga|com defeito|defeituoso|para pecas|retirada de pecas|sucata|no estado|leia o anuncio|leia a descricao|sem hd|sem ssd|sem memoria|sem bateria|so a carcaca|somente a carcaca|apenas a carcaca|tela quebrada|quebrado|trincado|para conserto|desmanche)\b/;

/** "para notebook", "compatível com" — quase sempre é peça de reposição. */
const PARA_ALGO = /\b(para|p\/|compativel com|substituicao)\s+(notebook|macbook|monitor|celular|impressora|cadeira|desktop|pc)\b/;

/**
 * "Está esgotado" dito de todas as formas que as lojas brasileiras dizem.
 *
 * PRODUTO INDISPONÍVEL NO RADAR É PIOR QUE RADAR VAZIO. A pessoa larga o que
 * está fazendo, abre o link e descobre um botão "avise-me quando chegar" — e da
 * segunda vez que isso acontece ela para de clicar. Pior: página de produto
 * esgotado costuma manter o último preço praticado, que fica *bonito* justamente
 * por não estar mais à venda. É o achado mais convincente e mais inútil possível.
 *
 * "vendido" NÃO entra nesta lista: "mais vendido" é selo de destaque em quase
 * toda loja, e barraria justamente os anúncios bons.
 */
const INDISPONIVEL =
  /\b(indisponivel|esgotado|sem estoque|fora de estoque|estoque esgotado|avise[- ]?me|me avise|anuncio encerrado|produto encerrado|nao disponivel|indispon|sob consulta|descontinuado|fora de linha)\b/;

/** A fonte disse que está esgotado? `null` quando ela não falou do assunto. */
export function disponibilidade(titulo: string, texto?: string | null, informada?: boolean | null): boolean | null {
  if (informada === false) return false;
  if (INDISPONIVEL.test(norm(titulo)) || INDISPONIVEL.test(norm(texto))) return false;
  return informada === true ? true : null;
}

/**
 * Preço + frete. O teto do Facilities é quanto ele aceita GASTAR, e frete é
 * gasto: um notebook de R$ 2.980 com R$ 140 de frete estoura um teto de
 * R$ 3.000, e o radar que ignora isso avisa sobre uma compra que não cabe.
 *
 * Frete desconhecido NÃO vira zero. Somar zero é afirmar "é grátis", e o
 * anúncio nunca disse isso — o total sai só com o produto e `frete_conhecido`
 * fica falso, para a tela poder avisar em vez de mentir por omissão.
 */
export function totalDaOferta(o: OfertaBruta): { total: number; frete: number | null; frete_conhecido: boolean } {
  const frete = o.frete_gratis ? 0 : (typeof o.frete_valor === "number" && o.frete_valor >= 0 ? o.frete_valor : null);
  return { total: o.preco + (frete ?? 0), frete, frete_conhecido: frete != null };
}

/** Quanto se deixa de gastar comprando por este total em vez de gastar o teto. */
export function economiaDe(precoAlvo: number, total: number, quantidade = 1): number {
  // Arredonda em centavos: sem isto sai "R$ 770,8999999999996" no banco e na
  // tela, que é o tipo de número que faz a pessoa duvidar do resto da conta.
  return Math.round(Math.max(0, (precoAlvo - total) * Math.max(quantidade, 1)) * 100) / 100;
}

/**
 * A identidade do PRODUTO, atravessando as fontes.
 *
 * Buscapé, Zoom e Bondfaro são do mesmo grupo e listam a mesma oferta. Como a
 * chave da oferta inclui a fonte (e deve incluir — o histórico de preço de cada
 * uma é legítimo), o MESMO notebook a R$ 2.969,10 virava três avisos idênticos.
 * Três linhas do mesmo produto é o começo do fim da confiança na aba: parece
 * que o radar está com defeito, e não está.
 *
 * Título normalizado + total arredondado basta, porque é justamente quando os
 * dois batem que se trata do mesmo anúncio replicado.
 */
export function chaveDoProduto(titulo: string, total: number): string {
  return `${norm(titulo).slice(0, 80)}|${Math.round(total)}`;
}

/** Palavras que indicam produto usado/recondicionado, quando a fonte não informa a condição. */
const USADO_TEXTO = /\b(usado|seminovo|semi-novo|recondicionado|refurbished|revisado|vitrine|open box|remanufaturado)\b/;

/** Quando a fonte não diz a condição, o título costuma dizer. */
export function condicaoDoTitulo(titulo: string, informada?: Condicao | null): Condicao {
  if (informada) return informada;
  const t = norm(titulo);
  if (/\b(recondicionado|refurbished|remanufaturado)\b/.test(t)) return "recondicionado";
  if (USADO_TEXTO.test(t)) return "usado";
  return "novo";
}

/**
 * Piso de preço: abaixo disto o anúncio não é o produto, é outra coisa com o
 * nome dele. 25% do teto é folgado o bastante para uma promoção de verdade
 * (um notebook de teto R$ 3.000 por R$ 750 seria a promoção do século) e
 * apertado o bastante para barrar o carregador de R$ 89.
 */
export const FATOR_PISO = 0.25;

export function pisoDePreco(precoAlvo: number): number {
  return Math.round(precoAlvo * FATOR_PISO);
}

/* ------------------------------------------------------------- a avaliação */

const CONDICAO_LABEL: Record<Condicao, string> = {
  novo: "novo",
  usado: "usado",
  recondicionado: "recondicionado",
};

/**
 * Decide se este anúncio serve, e o quanto ele agrada.
 *
 * A ordem importa: primeiro as recusas duras (que devolvem um motivo em
 * português), só depois a pontuação. Spec que o anúncio NÃO informa não reprova
 * — vai para `conferir`, e o Facilities checa no link antes de comprar. Reprovar
 * por omissão jogaria fora metade dos anúncios bons do Mercado Livre, onde o
 * título é curto e as specs estão na ficha técnica.
 */
export function avaliar(alvo: AlvoSpecs, precoAlvo: number, o: OfertaBruta): Avaliacao {
  const t = norm(o.titulo);
  const lidas = lerSpecs(o.titulo);
  const conferir: string[] = [];
  const motivos: string[] = [];
  const { total, frete, frete_conhecido } = totalDaOferta(o);

  const nao = (recusa: string): Avaliacao =>
    ({ aprovado: false, score: 0, recusa, motivos: [], conferir: [], lidas, total, frete_conhecido });

  if (!o.titulo || !o.url || !(o.preco > 0)) return nao("anúncio sem título, link ou preço");

  // Esgotado sai antes de tudo: não interessa o quanto as specs batem.
  if (o.disponivel === false) return nao("o anúncio está indisponível/esgotado");

  // 1. Sucata e peça de reposição — o motivo mais comum de preço bom demais
  if (SUCATA.test(t)) return nao("anúncio de produto com defeito ou para peças");
  if (PARA_ALGO.test(t)) return nao("é peça/acessório para o produto, não o produto");
  const mAcess = cabeca(t).match(ACESSORIOS[alvo.categoria] ?? ACESSORIOS.outro);
  if (mAcess) return nao(`o anúncio começa com “${mAcess[0]}” — é acessório, não ${alvo.categoria}`);
  if (!(PRODUTO[alvo.categoria] ?? PRODUTO.outro).test(t)) {
    return nao(`o título não diz que é ${alvo.categoria}`);
  }

  // 2. Termos que o pedido exige / proíbe
  for (const p of alvo.termos_proibidos ?? []) {
    if (p && t.includes(norm(p))) return nao(`contém “${p}”, que o pedido exclui`);
  }
  for (const ob of alvo.termos_obrigatorios ?? []) {
    if (ob && !t.includes(norm(ob))) return nao(`não menciona “${ob}”`);
  }

  // 3. Preço — medido pelo TOTAL, porque frete é gasto igual
  const piso = pisoDePreco(precoAlvo);
  if (o.preco < piso) {
    return nao(`R$ ${o.preco.toFixed(0)} está abaixo do piso de R$ ${piso} — provável acessório ou anúncio isca`);
  }
  if (total > precoAlvo) {
    return nao(frete && frete > 0
      ? `R$ ${o.preco.toFixed(0)} + R$ ${frete.toFixed(0)} de frete passa do teto (R$ ${precoAlvo.toFixed(0)})`
      : `acima do teto (R$ ${precoAlvo.toFixed(0)})`);
  }
  if (frete === 0) motivos.push("frete grátis");
  else if (frete && frete > 0) motivos.push(`+ R$ ${frete.toFixed(0)} de frete`);
  else conferir.push("valor do frete");

  // 4. Condição
  const condicoes = alvo.condicoes?.length ? alvo.condicoes : (["novo"] as Condicao[]);
  const cond = condicaoDoTitulo(o.titulo, o.condicao);
  if (!condicoes.includes(cond)) return nao(`é ${CONDICAO_LABEL[cond]} e o pedido aceita só ${condicoes.map((c) => CONDICAO_LABEL[c]).join("/")}`);

  // 5. Marca
  if (alvo.marcas?.length) {
    const okMarca = alvo.marcas.some((mk) => new RegExp(`\\b${norm(mk)}\\b`).test(t));
    if (!okMarca) return nao(`marca fora das pedidas (${alvo.marcas.join(", ")})`);
    motivos.push("marca pedida");
  }

  // 6. Specs — reprova só quando o anúncio DIZ e diz menos
  if (alvo.cpu_tier_min != null) {
    if (lidas.cpu_tier == null) conferir.push("processador");
    else if (lidas.cpu_tier < alvo.cpu_tier_min) return nao(`processador ${lidas.cpu_texto} é inferior ao pedido`);
    else motivos.push(`processador ${lidas.cpu_texto}`);
  }
  if (alvo.cpu_geracao_min != null) {
    /* "12ª geração" é escala da Intel. O 7 de "Ryzen 7" é a SÉRIE do chip, não
       a geração — comparar os dois reprovava todo Ryzen moderno como se fosse
       de 2017. Fora da Intel, o radar admite que não sabe e manda conferir. */
    if (lidas.cpu_marca !== "intel" || lidas.cpu_geracao == null) conferir.push("geração do processador");
    else if (lidas.cpu_geracao < alvo.cpu_geracao_min) return nao(`processador de ${lidas.cpu_geracao}ª geração, abaixo da ${alvo.cpu_geracao_min}ª pedida`);
    else motivos.push(`${lidas.cpu_geracao}ª geração`);
  }
  if (alvo.ram_gb_min != null) {
    if (lidas.ram_gb == null) conferir.push("memória RAM");
    else if (lidas.ram_gb < alvo.ram_gb_min) return nao(`${lidas.ram_gb}GB de RAM, abaixo dos ${alvo.ram_gb_min}GB pedidos`);
    else motivos.push(`${lidas.ram_gb}GB de RAM`);
  }
  if (alvo.armazenamento_gb_min != null) {
    if (lidas.armazenamento_gb == null) conferir.push("armazenamento");
    else if (lidas.armazenamento_gb < alvo.armazenamento_gb_min) return nao(`${lidas.armazenamento_gb}GB de armazenamento, abaixo dos ${alvo.armazenamento_gb_min}GB pedidos`);
    else motivos.push(`${lidas.armazenamento_gb}GB`);
  }
  if (alvo.armazenamento_tipo === "ssd") {
    if (lidas.armazenamento_tipo == null) conferir.push("se o disco é SSD");
    else if (lidas.armazenamento_tipo !== "ssd") return nao(`armazenamento é ${lidas.armazenamento_tipo.toUpperCase()} e o pedido exige SSD`);
    else motivos.push("SSD");
  }
  if (alvo.tela_pol_min != null && lidas.tela_pol != null && lidas.tela_pol < alvo.tela_pol_min) {
    return nao(`tela de ${lidas.tela_pol}" menor que as ${alvo.tela_pol_min}" pedidas`);
  }
  if (alvo.tela_pol_max != null && lidas.tela_pol != null && lidas.tela_pol > alvo.tela_pol_max) {
    return nao(`tela de ${lidas.tela_pol}" maior que as ${alvo.tela_pol_max}" pedidas`);
  }
  if ((alvo.tela_pol_min != null || alvo.tela_pol_max != null) && lidas.tela_pol == null) conferir.push("tamanho da tela");

  /* Pontuação. Começa em 50 e sobe com o que dá confiança. O peso maior é da
     folga de preço: entre dois anúncios que atendem, o mais barato é a resposta.
     A reputação do vendedor vem logo atrás porque o Facilities compra de
     verdade — um preço 8% melhor num vendedor sem histórico não compensa. */
  let score = 50;
  const folga = (precoAlvo - total) / precoAlvo; // 0..1, já com frete
  score += Math.round(Math.min(folga, 0.5) * 60); // até +30
  if (o.reputacao != null) score += Math.round(o.reputacao * 12);
  else conferir.push("reputação do vendedor");
  if ((o.vendas ?? 0) >= 50) score += 3;
  // Disponibilidade confirmada na página do produto vale ponto: é a diferença
  // entre "o anúncio existe" e "dá para comprar agora".
  if (o.disponivel === true) score += 5;
  else conferir.push("se está em estoque");
  score -= conferir.length * 4; // cada coisa não confirmada tira confiança
  score = Math.max(1, Math.min(100, score));

  if (folga >= 0.10) motivos.unshift(`${Math.round(folga * 100)}% abaixo do teto`);

  return { aprovado: true, score, recusa: null, motivos, conferir, lidas, total, frete_conhecido };
}

/* ------------------------------------------------------- leitura do histórico */

export type TipoAlerta = "alvo_batido" | "minimo_historico" | "queda_forte";

export interface Historico { preco: number; coletado_em: string }

/**
 * Por que existe histórico: "R$ 2.890, abaixo do teto de R$ 3.000" não diz nada
 * sozinho. Se o anúncio custa R$ 2.890 há três meses, não há urgência nenhuma —
 * e avisar mesmo assim treina o Facilities a ignorar o radar. O que merece
 * empurrão é mínimo histórico e queda de verdade.
 */
/** `preco` aqui é o TOTAL (produto + frete) — é o que a pessoa vai gastar. */
export function classificar(preco: number, precoAlvo: number, historico: Historico[]): { tipo: TipoAlerta; texto: string } | null {
  if (preco > precoAlvo) return null;
  const antes = historico.map((h) => Number(h.preco)).filter((p) => p > 0);
  if (antes.length === 0) return { tipo: "alvo_batido", texto: "primeira vez que aparece dentro do teto" };

  const min = Math.min(...antes);
  const ultimo = Number(historico[historico.length - 1].preco);
  if (preco < min) {
    const queda = ((min - preco) / min) * 100;
    return { tipo: "minimo_historico", texto: `menor preço já visto (${queda.toFixed(0)}% abaixo do mínimo anterior de R$ ${min.toFixed(0)})` };
  }
  if (ultimo > 0 && preco <= ultimo * 0.9) {
    return { tipo: "queda_forte", texto: `caiu ${(((ultimo - preco) / ultimo) * 100).toFixed(0)}% desde a última varredura` };
  }
  return null;
}

/** Se o alvo já foi avisado por este mesmo preço, não avisa de novo. */
export function jaAvisado(preco: number, avisados: number[]): boolean {
  return avisados.some((p) => Math.abs(p - preco) < 0.01);
}

/* ---------------------------------------------- texto pronto para o WhatsApp */

const brl = (v: number) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export interface ParaWhats {
  alvo_titulo: string;
  preco_alvo: number;
  quantidade?: number;
  ofertas: Array<{
    titulo: string; preco: number; url: string; fonte: string;
    vendedor?: string | null; motivo?: string | null; conferir?: string[];
    frete_valor?: number | null; frete_texto?: string | null;
  }>;
}

/**
 * O texto que o Facilities cola no grupo. Mesmo padrão do Cartão e da Ponte:
 * o Hub escreve, a pessoa confere e manda — envio automático de WhatsApp não
 * existe neste projeto.
 */
export function textoWhats(p: ParaWhats): string {
  const qtd = Math.max(p.quantidade ?? 1, 1);
  const linhas: string[] = [];
  linhas.push(`*Radar de preços — ${p.alvo_titulo}*`);
  linhas.push(`Teto: ${brl(p.preco_alvo)}${qtd > 1 ? ` · ${qtd} unidades` : ""}`);
  linhas.push("");
  for (const o of p.ofertas) {
    const frete = o.frete_valor;
    const total = o.preco + (frete ?? 0);
    // O total vem na frente porque é ele que decide a compra. O preço sozinho,
    // sem o frete, é a metade da conta que faz a pessoa escolher errado.
    linhas.push(`• *${brl(total)}* — ${o.titulo}`);
    const detalhe = frete === 0
      ? `${brl(o.preco)} + frete grátis`
      : frete && frete > 0
        ? `${brl(o.preco)} + ${brl(frete)} de frete`
        : `${brl(o.preco)} + frete não informado`;
    linhas.push(`  ${detalhe}`);
    const rodape = [o.fonte, o.vendedor || null].filter(Boolean).join(" · ");
    if (rodape) linhas.push(`  ${rodape}`);
    if (o.motivo) linhas.push(`  ${o.motivo}`);
    const economia = economiaDe(p.preco_alvo, total, qtd);
    if (economia > 0) linhas.push(`  💰 economia de ${brl(economia)}${qtd > 1 ? ` (${qtd} un.)` : ""}`);
    if (o.conferir?.length) linhas.push(`  ⚠ conferir no anúncio: ${o.conferir.join(", ")}`);
    linhas.push(`  ${o.url}`);
    linhas.push("");
  }
  linhas.push("_Enviado pelo Radar do Hub Facilities._");
  return linhas.join("\n").trim();
}
