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
  | "cadeira" | "desktop" | "consumivel" | "outro";

/**
 * A unidade em que se compara o preço de uma compra RECORRENTE.
 *
 * EQUIPAMENTO SE COMPARA PELO PREÇO; CONSUMÍVEL, PELO PREÇO POR UNIDADE. Um
 * notebook é um notebook, mas "café a R$ 20" não quer dizer nada até saber se o
 * pacote tem 250 g ou 1 kg — e as duas embalagens aparecem lado a lado na mesma
 * busca, com o pacote pequeno sempre parecendo mais barato. Um radar que compara
 * etiqueta com etiqueta em consumível não erra às vezes: erra sistematicamente,
 * sempre a favor da embalagem menor.
 */
export type UnidadeBase = "kg" | "l" | "un";

export const UNIDADE_LABEL: Record<UnidadeBase, string> = { kg: "kg", l: "L", un: "un" };

/** O que o título disse sobre o tamanho do que está sendo vendido. */
export interface Embalagem {
  /** Já convertido para a unidade base: gramas viram kg, ml viram L. */
  quantidade: number;
  unidade: UnidadeBase;
  /** Como estava escrito, para a tela poder mostrar "pacote de 500 g". */
  texto: string;
}

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
  /**
   * Presente = alvo de compra RECORRENTE, e o `preco_alvo` passa a ser lido
   * como teto POR ESTA UNIDADE (R$/kg, R$/L, R$/un) em vez de teto do pacote.
   *
   * É a diferença entre "quero pagar até R$ 40 no café" — que depende do
   * tamanho do pacote e por isso não quer dizer nada — e "até R$ 40 o quilo",
   * que é o que a pessoa realmente quis dizer.
   */
  unidade?: UnidadeBase | null;
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
  /** Nota do produto, 0 a 5. Só vale lida junto de `avaliacoes`. */
  avaliacao?: number | null;
  /** Quantas pessoas avaliaram. É o que dá peso à nota. */
  avaliacoes?: number | null;
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
  /** Preço + frete. É o que se PAGA. */
  total: number;
  /**
   * O que o teto, o ranking e a curva comparam.
   *
   * Igual ao `total` em equipamento; o preço POR UNIDADE quando o alvo é
   * recorrente. Existe como campo próprio — em vez de o `total` mudar de
   * significado — porque as duas perguntas convivem na mesma tela: "quanto sai
   * o pacote" e "está caro o quilo?".
   */
  comparavel: number;
  /** O tamanho do pacote lido no título. `null` fora de alvo recorrente. */
  embalagem: Embalagem | null;
  /** `false` quando o frete não é conhecido e o `total` é só o preço do produto. */
  frete_conhecido: boolean;
  /**
   * Passou em TUDO e só não coube no teto.
   *
   * É o produto certo pelo preço errado — e é a matéria-prima do histórico:
   * sem guardar o notebook de R$ 4.500 que ficou parado três meses, não há
   * como dizer que R$ 3.900 é o menor preço em 90 dias. Não vira alerta.
   */
  apenas_preco: boolean;
}

/**
 * O que o alvo já aprovou por 👍, num formato que `avaliar` só precisa
 * consultar — a leitura do histórico (`facilities_radar_feedback`) e a conta de
 * quem repetiu ficam do lado de fora, porque dependem do banco e este arquivo
 * não importa nada. Um por alvo, montado uma vez por varredura, não por
 * anúncio: são ~200 anúncios por rodada e o voto não muda no meio dela.
 */
export interface Preferencias {
  /** Tokens da lista MARCAS (ver `lerSpecs`), já no formato de `lidas.marca`. */
  marcasGostei: Set<string>;
  /** `vendedor` normalizado por `norm()`. */
  vendedoresGostei: Set<string>;
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
  /* PERIFÉRICO (mouse, headset, teclado), adicionadas em 03/09/2026 para o
     feedback (ver facilities_radar_feedback) ter marca para generalizar: sem
     elas, `lidas.marca` saía `null` na maioria dos anúncios de mouse/headset —
     as marcas de notebook/monitor acima não cobrem essa prateleira, e "3
     recusas de marca" nunca detectaria padrão nenhum na categoria mais barata
     do módulo. */
  "vinik", "rise mode", "ninja", "rapoo", "redragon", "hyperx", "razer",
  "corsair", "fortrek", "oex", "pcyes", "havit", "goldentec", "jbl", "elg",
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

/* ------------------------------------------------ embalagem (consumíveis) */

/** g → kg, ml → L. O que já está na unidade base passa direto. */
const PARA_BASE: Record<string, { fator: number; unidade: UnidadeBase }> = {
  mg: { fator: 1e-6, unidade: "kg" },
  g: { fator: 0.001, unidade: "kg" },
  gr: { fator: 0.001, unidade: "kg" },
  kg: { fator: 1, unidade: "kg" },
  quilo: { fator: 1, unidade: "kg" },
  quilos: { fator: 1, unidade: "kg" },
  ml: { fator: 0.001, unidade: "l" },
  l: { fator: 1, unidade: "l" },
  lt: { fator: 1, unidade: "l" },
  litro: { fator: 1, unidade: "l" },
  litros: { fator: 1, unidade: "l" },
};

const MEDIDA = "mg|gr|g|kg|quilos?|ml|lt|litros?|l";

/**
 * As palavras que contam PEÇAS. "12 rolos", "com 24", "caixa com 100 folhas".
 * Cada uma saiu de um anúncio real de copa, limpeza ou papelaria.
 */
/**
 * CONTINENTE × PEÇA — e é esta distinção que decide se a conta multiplica.
 *
 * "5 pacotes de 250g" é um quilo e um quarto: cada pacote TEM 250 g. Já
 * "10 unidades 170g" são cento e setenta gramas no total — dez cápsulas que
 * JUNTAS pesam isso. As duas frases têm a mesma forma (número, palavra, medida)
 * e significados opostos; ler a segunda como a primeira transforma uma caixa de
 * Dolce Gusto de R$ 20 em café a R$ 11 o quilo. Foi o que apareceu na primeira
 * varredura real de café, em 27/08/2026: quatro "achados dentro do teto" que
 * eram caixas de cápsula.
 *
 * Continente multiplica; peça só multiplica quando o título escreve a ligação
 * ("10 sachês DE 50g").
 */
const CONTINENTE = "pacotes?|fardos?|caixas?|sach[eê]s?|sacos?|refis|refil|kits?|d[uú]zias?";
const PECA = "unidades?|unid|un|rolos?|folhas?|c[aá]psulas?|pares?|pe[çc]as?|copos?|pratos?|guardanapos?|saquinhos?|luvas?|m[aá]scaras?|canetas?|l[aá]pis|envelopes?|pastas?";

const CONTAGEM = new RegExp(
  `\\b(?:c\\/|com|leve|contendo|pacote com|fardo com|caixa com|embalagem com)?\\s*(\\d{1,4})\\s*(${CONTINENTE}|${PECA})\\b`,
);

/**
 * Quanto vem no pacote — a peça que falta para comparar consumível.
 *
 * A ORDEM DE LEITURA É A ORDEM DA CONFIANÇA:
 *   1. o multiplicador ("6x1L", "4 x 500g") — é o formato do fardo, e ignorá-lo
 *      faria um fardo de seis litros passar por uma garrafa;
 *   2. peso ou volume ("500 g", "1,5 kg", "2 litros");
 *   3. contagem de peças ("12 rolos", "com 24").
 *
 * A GRAMATURA NÃO É EMBALAGEM, e essa exceção não é um detalhe: papel sulfite
 * se anuncia como "Papel A4 75g/m² 500 folhas". Lido de forma ingênua, o "75g"
 * vira "pacote de 75 gramas" e o radar passa a dizer que a resma custa
 * R$ 320 o quilo. O que interessa ali são as 500 folhas — por isso qualquer
 * medida seguida de "/m" é descartada antes de tudo.
 */
export function lerEmbalagem(titulo: string, preferida?: UnidadeBase | null): Embalagem | null {
  /* A gramatura sai ANTES do `norm`, porque é o "/" que a denuncia — e o `norm`
     transforma "/" em espaço, deixando "75g m2" indistinguível de um peso
     seguido de outra palavra. Depois disso não haveria como saber. */
  const cru = String(titulo || "")
    .replace(/(\d+[.,]?\d*)\s*(?:g|gr|gramas?)\s*\/\s*m[²2]?/gi, " ")
    .replace(/\b\d+\s*gsm\b/gi, " ");
  // `norm` mantém vírgula e ponto de propósito: é o que separa "1,5 kg" de "15 kg".
  const t = norm(cru);
  const num = (s: string) => Number(s.replace(",", "."));
  /* Peso absurdo é leitura errada, e preço por unidade calculado sobre leitura
     errada não dá erro: dá um achado espetacular e falso. */
  const plausivel = (q: number) => q > 0.001 && q < 500;

  const mult = t.match(new RegExp(`\\b(\\d{1,3})\\s*x\\s*(\\d+[.,]?\\d*)\\s*(${MEDIDA})\\b`));
  const medida = t.match(new RegExp(`\\b(\\d+[.,]?\\d*)\\s*(${MEDIDA})\\b`));
  const cont = t.match(CONTAGEM);
  const conv = medida ? PARA_BASE[medida[2]] : null;
  const qMedida = conv ? num(medida![1]) * conv.fator : null;
  const nCont = cont ? Number(cont[1]) : null;
  const contagemOk = nCont != null && nCont > 0 && nCont <= 5000;

  // 1. O FARDO. "6x1,5L" são nove litros; lido como garrafa, seria um e meio.
  if (mult) {
    const c = PARA_BASE[mult[3]];
    const q = c ? num(mult[1]) * num(mult[2]) * c.fator : 0;
    if (c && plausivel(q)) return { quantidade: q, unidade: c.unidade, texto: `${mult[1]}x${mult[2]}${mult[3]}` };
  }

  /* 2. QUANDO O ALVO PEDE PEÇA, A CONTAGEM MANDA — e é aqui que mora a segunda
     armadilha do consumível. "Copo descartável 200ml com 100 unidades" tem uma
     medida (200 ml) que NÃO é o tamanho do pacote: é o tamanho de UM copo. Quem
     compra copo compra peça, e é a contagem que responde. */
  if (preferida === "un" && contagemOk) {
    return { quantidade: nCont!, unidade: "un", texto: `${cont![1]} ${cont![2]}` };
  }

  /* 3. Contagem VEZES medida — o fardo escrito por extenso: "5 pacotes de
     250g", "10 sachês de 50g", "Café 500g kit 5".
     SÓ MULTIPLICA COM LICENÇA EXPLÍCITA: ou a palavra é um continente (pacote,
     caixa, kit — cada um TEM a medida), ou o título escreve a ligação com "de".
     Sem isso, "10 unidades 170g" — dez cápsulas pesando 170 g no total — viraria
     1,7 kg, e a caixa de Dolce Gusto entraria na tela como café barato. */
  const ehContinente = cont ? new RegExp(`^(?:${CONTINENTE})$`).test(cont[2]) : false;
  const ligaComDe = cont && medida
    ? new RegExp(`${cont[1]}\\s*(?:${CONTINENTE}|${PECA})\\s+(?:de|c\\/|com)\\s+${medida[1].replace(".", "\\.")}`).test(t)
    : false;
  const kitDepois = t.match(/\b(?:kit|leve|pack)\s*(\d{1,3})\b/);

  if (contagemOk && qMedida != null && conv && (ehContinente || ligaComDe) && (!preferida || preferida === conv.unidade)) {
    const q = nCont! * qMedida;
    if (plausivel(q)) {
      return { quantidade: q, unidade: conv.unidade, texto: `${cont![1]}x${medida![1]}${medida![2]}` };
    }
  }

  /* 3b. O continente que vem DEPOIS da medida: "Café Melitta 500g Kit 5". A
     forma é invertida e o significado é o mesmo — cinco embalagens de 500 g. */
  if (kitDepois && qMedida != null && conv && (!preferida || preferida === conv.unidade)) {
    const q = Number(kitDepois[1]) * qMedida;
    if (Number(kitDepois[1]) > 1 && plausivel(q)) {
      return { quantidade: q, unidade: conv.unidade, texto: `${kitDepois[1]}x${medida![1]}${medida![2]}` };
    }
  }

  /* 4. Peso ou volume solto — e a ORDEM DAS PALAVRAS decide se ele vale.
     "10 unidades 170g": a medida vem DEPOIS da contagem e é o peso líquido do
     conjunto — vale, e vale como total. "Copo 200ml c/ 100 unidades": a medida
     vem ANTES e é o tamanho de UMA peça — os 200 ml não são o pacote, e usá-los
     daria R$/L sobre o volume de um copo.
     Nesse segundo caso o radar não sabe, e não inventa: devolve `null`, e a
     recusa diz que o título não informa o tamanho. Quem quiser comprar copo
     cadastra o alvo em `un`, que é como copo se compra — e aí a regra 2 já
     respondeu lá em cima. */
  const medidaDepoisDaContagem = !cont || (medida != null && t.indexOf(medida[0]) > t.indexOf(cont[0]));
  if (conv && qMedida != null && plausivel(qMedida) && medidaDepoisDaContagem) {
    return { quantidade: qMedida, unidade: conv.unidade, texto: `${medida![1]}${medida![2]}` };
  }

  // 5. contagem solta
  if (contagemOk) return { quantidade: nCont!, unidade: "un", texto: `${cont![1]} ${cont![2]}` };

  return null;
}

/** "R$ 32,90/kg" — como o preço de consumível se lê. */
export function textoUnitario(valor: number, unidade: UnidadeBase): string {
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/${UNIDADE_LABEL[unidade]}`;
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
  /* CONSUMÍVEL NÃO TEM LISTA DE ACESSÓRIO, e não é esquecimento. O que polui a
     busca aqui é o utensílio — "café" traz cafeteira, xícara e porta-filtro —,
     e qualquer lista dessas erraria nos dois sentidos: "balde" e "vassoura" são
     acessório na copa e produto na limpeza. Quem filtra é a exigência de
     embalagem: utensílio não traz peso líquido no título e cai sozinho, com um
     motivo em português que a pessoa entende. */
  consumivel: /(?!)/,
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
  /* O substantivo do consumível é o que a pessoa pediu — café, papel toalha,
     detergente —, e isso já chega em `termos_obrigatorios`. Fixar uma lista
     aqui seria tentar prever o catálogo de copa e limpeza de uma empresa. */
  consumivel: /(?:)/,
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
  // Em centavos: sem o arredondamento sai "R$ 3.899,0000000000005" no banco e
  // na tela — número que faz a pessoa duvidar do resto da conta.
  return { total: emCentavos(o.preco + (frete ?? 0)), frete, frete_conhecido: frete != null };
}

/** Arredonda dinheiro para duas casas, de uma vez por todas. */
export function emCentavos(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Abaixo disto a nota do produto não conta.
 *
 * "5,0 estrelas" com duas avaliações não é melhor que 4,6 com mil — é só uma
 * amostra pequena demais, e vendedor sabe disso. Nota sem massa é ruído com
 * cara de sinal, e sinal falso é o que o radar menos pode produzir.
 */
export const MIN_AVALIACOES = 5;

/** O que a nota diz sobre o produto: `null` quando ela não diz nada de útil. */
export function pesoDaNota(avaliacao?: number | null, avaliacoes?: number | null): number | null {
  if (avaliacao == null || !(avaliacoes ?? 0) || (avaliacoes ?? 0) < MIN_AVALIACOES) return null;
  if (avaliacao >= 4.5) return 6;
  if (avaliacao >= 4.0) return 3;
  if (avaliacao >= 3.0) return 0;
  return -8; // produto mal avaliado com massa de avaliações é aviso, não detalhe
}

/** "4,6 ★ (1.842)" — a nota nunca aparece sem a contagem ao lado. */
export function textoNota(avaliacao?: number | null, avaliacoes?: number | null): string | null {
  if (avaliacao == null) return null;
  const n = avaliacao.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (!avaliacoes) return `${n} ★ (sem contagem)`;
  return `${n} ★ (${avaliacoes.toLocaleString("pt-BR")})`;
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
 * O FREIO DE CRÉDITO DE RASPAGEM, em um lugar só.
 *
 * Mora aqui — e não na Edge Function — porque a tela precisa do MESMO número
 * para dizer "a varredura está suspensa". Duas cópias divergem na primeira vez
 * que alguém ajusta o limiar no servidor, e o sintoma seria a tela jurando que
 * está tudo bem enquanto o radar não varre há uma semana.
 *
 * Abaixo disto a varredura para e a conferência continua: procurar achado novo
 * pode esperar o ciclo virar; dizer se o que está na tela ainda existe, não —
 * parar isso é deixar fantasma no lugar, que é pior que não ter radar. E a
 * mesma chave serve o radar de editais: um radar guloso não fica só mudo, leva
 * o vizinho junto.
 */
/* Calibrado para o plano de 5.000/mês assinado em 27/08/2026, com consumo
   medido de ~95/dia (seis varreduras e quatro conferências). 500 é a reserva de
   uns cinco dias — o bastante para o ciclo virar sem que a conferência pare e
   sem derrubar os editais junto.

   ESTE NÚMERO TEM UM GÊMEO NO BANCO: `firecrawl_orcamento.piso_saldo` da linha
   `radar_varrer`, que é quem de fato freia a rodada desde que o Firecrawl ganhou
   cinco consumidores no Hub. Os dois PRECISAM andar juntos — é exatamente a
   divergência que o comentário acima descreve, agora entre a tela e a tabela:
   com o piso do banco em 400 e este em 500, haveria uma faixa de cem créditos
   em que a tela anuncia "varredura suspensa" e o servidor continua varrendo
   alegremente. Ao mexer aqui, mexa lá. */
export const SALDO_MINIMO_RASPAGEM = 500;

/** Daqui para baixo a tela já avisa: ~10 dias de operação, tempo de reagir. */
export const SALDO_ATENCAO_RASPAGEM = 1000;

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
export function avaliar(alvo: AlvoSpecs, precoAlvo: number, o: OfertaBruta, prefs?: Preferencias): Avaliacao {
  const t = norm(o.titulo);
  const lidas = lerSpecs(o.titulo);
  const conferir: string[] = [];
  const motivos: string[] = [];
  const { total, frete, frete_conhecido } = totalDaOferta(o);

  /* A EMBALAGEM SÓ É LIDA EM ALVO RECORRENTE, e essa guarda é deliberada: os
     títulos de equipamento estão cheios de "16GB" e "1TB" que a leitura de
     embalagem interpretaria como peso. Fora do consumível, esta peça nem
     acorda. */
  /* E A EMBALAGEM LIDA TEM DE ESTAR NA UNIDADE DO ALVO. Medido em 27/08/2026
     numa varredura real de café: onze anúncios foram recusados "abaixo do piso"
     porque o título só trazia contagem de peças — "filtro de café c/ 30
     unidades" devolvia uma embalagem de 30 `un`, e dividir o preço por 30 num
     alvo medido em quilo dava R$ 0,50/kg. O número saía absurdo e o motivo saía
     errado, culpando o preço quando o problema era a unidade.
     Unidade trocada é o mesmo caso de "o título não diz o tamanho": não dá para
     comparar, e é isso que a recusa passa a dizer. */
  const lida = alvo.unidade ? lerEmbalagem(o.titulo, alvo.unidade) : null;
  const embalagem = lida && lida.unidade === alvo.unidade ? lida : null;
  const comparavel = alvo.unidade && embalagem ? emCentavos(total / embalagem.quantidade) : total;

  const nao = (recusa: string, apenas_preco = false): Avaliacao =>
    ({ aprovado: false, score: 0, recusa, motivos: [], conferir: [], lidas, total, comparavel, embalagem, frete_conhecido, apenas_preco });

  if (!o.titulo || !o.url || !(o.preco > 0)) return nao("anúncio sem título, link ou preço");

  /* SEM O TAMANHO DO PACOTE NÃO HÁ COMO COMPARAR — e aqui, ao contrário das
     specs de equipamento, a omissão REPROVA. A regra do módulo é não reprovar
     por aquilo que o anúncio não diz, mandando conferir no link; mas isso vale
     para detalhe (a geração do processador, o tamanho da tela). O tamanho da
     embalagem não é detalhe num alvo medido por quilo: comparar R$ 20 com um
     teto de R$ 40/kg sem saber se o pacote tem 250 g ou 1 kg não é uma resposta
     parcial, é uma resposta errada — e erra sempre para o mesmo lado, o da
     embalagem pequena, que é a que parece barata.
     De quebra, é o que separa o café da cafeteira: utensílio não traz peso
     líquido no título, e cai aqui sem precisar de lista de palavras proibidas. */
  if (alvo.unidade && !embalagem) {
    return nao(
      lida
        // Diz O QUE leu, senão a pessoa abre o anúncio, vê "30 unidades"
        // escrito lá e conclui que o radar não sabe ler.
        ? `o título mede em ${UNIDADE_LABEL[lida.unidade]} (${lida.texto}) e o teto é por ${UNIDADE_LABEL[alvo.unidade]}`
        : `o título não diz o tamanho da embalagem, e o teto é por ${UNIDADE_LABEL[alvo.unidade]}`,
    );
  }

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

  /* 3. Piso — guarda de acessório, e por isso continua cedo: não adianta olhar
     spec de uma coisa que custa um décimo do produto. O TETO, ao contrário, foi
     para o fim de propósito: só depois de o anúncio passar por todo o resto é
     que dá para afirmar "é o produto certo, caro demais" — que é o que alimenta
     o histórico. */
  const piso = pisoDePreco(precoAlvo);
  /* No alvo recorrente o piso também é POR UNIDADE — senão ele barraria o
     pacote pequeno legítimo (um café de 250 g custa menos que um quarto do
     teto do quilo, e não tem nada de errado com ele). */
  const precoDoPiso = alvo.unidade && embalagem ? comparavel : o.preco;
  if (precoDoPiso < piso) {
    return nao(
      alvo.unidade
        ? `${textoUnitario(precoDoPiso, alvo.unidade)} está abaixo do piso de R$ ${piso}/${UNIDADE_LABEL[alvo.unidade]} — provável leitura errada da embalagem ou anúncio isca`
        : `R$ ${o.preco.toFixed(0)} está abaixo do piso de R$ ${piso} — provável acessório ou anúncio isca`,
    );
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

  /* AGORA O TETO. Chegou aqui: é o produto certo, com as specs certas, novo e
     disponível. Se não couber no preço, a recusa sai marcada como `apenas_preco`
     — o chamador guarda a linha para o histórico em vez de jogá-la fora. */
  if (comparavel > precoAlvo) {
    return nao(
      alvo.unidade
        // O pacote entra na frase inteira: "R$ 24 o pacote de 500g dá R$ 48/kg"
        // é o que faz a pessoa entender por que um anúncio de R$ 24 foi recusado
        // por um teto de R$ 40.
        ? `${textoUnitario(comparavel, alvo.unidade)} (R$ ${total.toFixed(0)} o ${embalagem!.texto}) passa do teto de ${textoUnitario(precoAlvo, alvo.unidade)}`
        : frete && frete > 0
          ? `R$ ${o.preco.toFixed(0)} + R$ ${frete.toFixed(0)} de frete passa do teto (R$ ${precoAlvo.toFixed(0)})`
          : `acima do teto (R$ ${precoAlvo.toFixed(0)})`,
      true,
    );
  }

  /* Pontuação. Começa em 50 e sobe com o que dá confiança. O peso maior é da
     folga de preço: entre dois anúncios que atendem, o mais barato é a resposta.
     A reputação do vendedor vem logo atrás porque o Facilities compra de
     verdade — um preço 8% melhor num vendedor sem histórico não compensa. */
  let score = 50;
  // Pela mesma medida do teto: em consumível, folga é folga no preço do quilo.
  const folga = (precoAlvo - comparavel) / precoAlvo; // 0..1, já com frete
  score += Math.round(Math.min(folga, 0.5) * 60); // até +30
  if (o.reputacao != null) score += Math.round(o.reputacao * 12);
  else conferir.push("reputação do vendedor");
  if ((o.vendas ?? 0) >= 50) score += 3;
  // Disponibilidade confirmada na página do produto vale ponto: é a diferença
  // entre "o anúncio existe" e "dá para comprar agora".
  if (o.disponivel === true) score += 5;
  else conferir.push("se está em estoque");

  /* A nota do produto entra com peso próprio — e com o freio da amostra. Um
     notebook 4,7 com 1.800 avaliações merece subir na frente de um sem
     histórico nenhum; um 2,8 com 400 avaliações é aviso, não detalhe. */
  const peso = pesoDaNota(o.avaliacao, o.avaliacoes);
  if (peso == null) conferir.push("avaliações do produto");
  else {
    score += peso;
    if (peso > 0) motivos.push(`${textoNota(o.avaliacao, o.avaliacoes)}`);
    if (peso < 0) motivos.push(`⚠ mal avaliado: ${textoNota(o.avaliacao, o.avaliacoes)}`);
  }
  /* SINAL LEVE DE 👍 PASSADO — não filtra (só termos_proibidos filtra), só
     ajuda a ordenar. Marca antes de vendedor porque marca sobrevive à troca de
     loja e o vendedor não sobrevive à troca de marca: quem curtiu um mouse
     Logitech pela marca continua curtindo em outra loja; quem curtiu porque
     era a Kabum não necessariamente curte a marca que a Kabum vender amanhã. */
  if (prefs?.marcasGostei.size && lidas.marca && prefs.marcasGostei.has(lidas.marca)) {
    score += 8;
    motivos.push("marca que você já aprovou antes");
  } else if (prefs?.vendedoresGostei.size && o.vendedor && prefs.vendedoresGostei.has(norm(o.vendedor))) {
    score += 6;
    motivos.push("vendedor que você já aprovou antes");
  }
  score -= conferir.length * 4; // cada coisa não confirmada tira confiança
  score = Math.max(1, Math.min(100, score));

  if (folga >= 0.10) motivos.unshift(`${Math.round(folga * 100)}% abaixo do teto`);
  /* O preço unitário vai na FRENTE dos motivos em alvo recorrente: é o número
     que decide a compra, e o da etiqueta é o que engana. */
  if (alvo.unidade && embalagem) {
    motivos.unshift(`${textoUnitario(comparavel, alvo.unidade)} · ${embalagem.texto}`);
  }

  return { aprovado: true, score, recusa: null, motivos, conferir, lidas, total, comparavel, embalagem, frete_conhecido, apenas_preco: false };
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

/* ------------------------------------------------------ sugestão de teto */

/** Um dia da curva, como `facilities_radar_historico` devolve. */
export interface PontoHistorico { dia: string; menor: number; mediana: number; ofertas: number }

/**
 * Antes disto a curva ainda é um chute com cara de dado.
 *
 * Duas semanas são ~28 varreduras: pegam fim de semana e meio de semana, e já
 * mostram se o preço se mexe ou está parado. Com sete dias, um único dia
 * atípico — uma Black Friday, um erro de precificação — arrasta o mínimo e a
 * sugestão sai torta com toda a autoridade de um número.
 */
export const DIAS_PARA_SUGERIR = 14;

/** Folga sobre o menor preço já visto. Ver `sugerirTeto`. */
export const FOLGA_SUGESTAO = 0.05;

export type VereditoTeto = "abaixo_do_minimo" | "apertado" | "bom" | "folgado";

export interface SugestaoTeto {
  /** Há histórico suficiente para opinar? */
  pode: boolean;
  dias: number;
  /** Menor total já visto no período. */
  minimo: number;
  /** Preço típico: mediana das medianas diárias. */
  tipico: number;
  /** O teto que o radar sugere. */
  teto: number;
  /** Como o teto digitado se sai. `null` quando não há teto digitado. */
  veredito: VereditoTeto | null;
  /** Frase curta e determinística. A IA reescreve; o conteúdo é este. */
  resumo: string;
}

/** Arredonda para cima na dezena de 50 — teto quebrado (R$ 4.063) não convence ninguém. */
function ate50(v: number): number {
  return Math.ceil(v / 50) * 50;
}

function medianaDe(nums: number[]): number {
  if (!nums.length) return 0;
  const o = [...nums].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * O que o histórico diz sobre quanto vale a pena pagar.
 *
 * ANCORADO NO MÍNIMO, NÃO NA MEDIANA. Um teto na mediana é o mesmo que não ter
 * teto: metade dos dias bate, o Facilities recebe aviso todo dia e para de
 * olhar. Ancorar no menor já visto e somar 5% dá um alvo que se sabe
 * alcançável — já aconteceu — sem exigir que a melhor promoção do período se
 * repita exatamente.
 *
 * ESTA FUNÇÃO NÃO CHAMA IA, e é de propósito: o número precisa ser o mesmo toda
 * vez e precisa poder ser testado. A IA só transforma este `resumo` em frase.
 */
export function sugerirTeto(dados: PontoHistorico[], digitado?: number | null): SugestaoTeto {
  const dias = dados.length;
  if (dias === 0) {
    return { pode: false, dias: 0, minimo: 0, tipico: 0, teto: 0, veredito: null, resumo: "sem histórico ainda" };
  }

  const menores = dados.map((d) => Number(d.menor)).filter((n) => n > 0);
  const minimo = emCentavos(Math.min(...menores));
  const tipico = emCentavos(medianaDe(dados.map((d) => Number(d.mediana)).filter((n) => n > 0)));
  const teto = ate50(minimo * (1 + FOLGA_SUGESTAO));
  const pode = dias >= DIAS_PARA_SUGERIR;

  let veredito: VereditoTeto | null = null;
  let resumo: string;

  /* O TOPO DA FAIXA BOA NUNCA PODE FICAR ABAIXO DO TETO QUE A GENTE MESMO
     SUGERE. Quando o alvo tem poucos anúncios por dia, a mediana diária cola no
     mínimo e o "típico" fica ABAIXO do sugerido — e a regra passava a chamar de
     "folgado" exatamente o valor que ela acabara de recomendar. Foi o que
     apareceu no teste: sugeria R$ 4.000 e reprovava R$ 4.100. */
  const limiteBom = Math.max(tipico, teto);

  if (digitado && digitado > 0) {
    if (digitado < minimo) veredito = "abaixo_do_minimo";
    else if (digitado < teto) veredito = "apertado";
    else if (digitado <= limiteBom) veredito = "bom";
    else veredito = "folgado";
  }

  switch (veredito) {
    case "abaixo_do_minimo":
      // O erro mais caro de todos: o radar fica mudo e parece quebrado.
      resumo = `teto de R$ ${digitado!.toFixed(0)} está abaixo do menor preço já visto (R$ ${minimo.toFixed(0)}) em ${dias} dia(s) — nesse valor o radar nunca vai avisar`;
      break;
    case "apertado":
      resumo = `teto de R$ ${digitado!.toFixed(0)} só bate se a melhor promoção do período (R$ ${minimo.toFixed(0)}) se repetir; R$ ${teto.toFixed(0)} deixa uma folga de ${Math.round(FOLGA_SUGESTAO * 100)}%`;
      break;
    case "bom":
      resumo = `teto de R$ ${digitado!.toFixed(0)} está na faixa certa: acima do menor preço já visto (R$ ${minimo.toFixed(0)}) e sem passar do típico (R$ ${tipico.toFixed(0)}) — avisa sem virar ruído`;
      break;
    case "folgado":
      resumo = `teto de R$ ${digitado!.toFixed(0)} está acima do preço típico (R$ ${tipico.toFixed(0)}): mais da metade dos dias bate, e aviso todo dia é o mesmo que aviso nenhum`;
      break;
    default:
      resumo = `em ${dias} dia(s), o menor preço foi R$ ${minimo.toFixed(0)} e o típico R$ ${tipico.toFixed(0)}`;
  }

  return { pode, dias, minimo, tipico, teto, veredito, resumo };
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
