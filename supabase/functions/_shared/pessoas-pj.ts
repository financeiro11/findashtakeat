// Razão social -> nome da pessoa, nos textos escritos por IA.
//
// O Omie guarda razão social. Quando o prestador é a PJ de uma pessoa só, o
// comentário da DRE sai com "a saída de DALBER NEGOCIOS (-R$ 27,2k) e C M
// SOLUCOES E SERVICOS LTDA (-R$ 3,0k)" — e quem lê corrige à mão antes de colar
// no tracker. O de-para mora em `contrapartes_pessoas`.
//
// APLICADO DOS DOIS LADOS, de propósito:
//
//   ENTRADA (`pessoaDe`)   — o nome já chega trocado no prompt, então o modelo
//                            nunca teve a razão social para copiar. É o caminho
//                            principal, e é o que fica gravado nos drivers.
//   SAÍDA   (`pessoasNoTexto`) — rede. O nome também vaza pela observação crua do
//                            título e pelo texto do fio de perguntas, que vão sem
//                            passar pela troca. Varrer o texto final fecha isso.
//
// O casamento é por NOME normalizado (sem acento, sem pontuação, sem o sufixo
// societário), porque é só isso que o texto tem para oferecer — não há id
// atravessando o prompt.
//
// O gêmeo desta lógica vive em `src/lib/pessoasPJ.ts`, que é quem corrige os
// comentários JÁ GRAVADOS na hora de exibir. Duplicado porque Deno e Vite não
// dividem módulo — mesma relação que `_shared/normalize.ts` tem com
// `src/lib/normalize.ts`. Os dois têm o mesmo teste.

type SB = any;

export type MapaPessoas = {
  /** chave normalizada da razão social -> nome da pessoa */
  porChave: Map<string, string>;
  /** maior número de palavras entre as chaves — o tamanho da janela de busca */
  maxTokens: number;
  /** os pares, para montar o bloco do prompt */
  pares: { nome: string; pessoa: string }[];
};

export const MAPA_VAZIO: MapaPessoas = { porChave: new Map(), maxTokens: 0, pares: [] };

/**
 * A chave de casamento.
 *
 * Tira acento, caixa, pontuação, CNPJ colado no nome e o sufixo societário —
 * assim "C M Soluções e Serviços LTDA.", "C M SOLUCOES E SERVICOS LTDA" e
 * "CM SOLUCOES E SERVICOS" caem na mesma chave. O sufixo sai em laço porque
 * vem empilhado ("FULANO SERVICOS LTDA ME").
 */
export function chavePessoa(s: string): string {
  let t = (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    // CNPJ/CPF colados na razão social. A RPC já limpa os do Omie; um cadastro
    // feito à mão, não.
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (;;) {
    const antes = t;
    t = t
      .replace(/\s+(SOCIEDADE\s+INDIVIDUAL\s+DE\s+ADVOCACIA|UNIPESSOAL|EIRELI|LTDA|EPP|MEI|ME|SS|S\s+A|SA|EI)$/, "")
      .trim();
    if (t === antes) return t;
  }
}

/**
 * Piso de tamanho da chave.
 *
 * Uma chave de 3 letras casaria palavra comum no meio da frase e trocaria o nome
 * de quem não devia. O mesmo piso está no CHECK da tabela.
 */
const MIN_CHAVE = 4;

export async function carregarPessoasPJ(supabase: SB): Promise<MapaPessoas> {
  try {
    const { data, error } = await supabase
      .from("contrapartes_pessoas")
      .select("nome,pessoa")
      .eq("status", "ativo")
      .order("nome");
    if (error) return MAPA_VAZIO;
    return montarMapaPessoas((data ?? []) as { nome: string; pessoa: string }[]);
  } catch {
    // Acessório: sem o de-para os textos saem como saíam antes. Nunca derruba
    // a geração do comentário.
    return MAPA_VAZIO;
  }
}

export function montarMapaPessoas(linhas: { nome: string; pessoa: string }[]): MapaPessoas {
  const porChave = new Map<string, string>();
  const pares: { nome: string; pessoa: string }[] = [];
  let maxTokens = 0;

  for (const l of linhas) {
    const nome = String(l?.nome ?? "").trim();
    const pessoa = String(l?.pessoa ?? "").trim();
    if (!nome || !pessoa) continue;
    const chave = chavePessoa(nome);
    if (chave.length < MIN_CHAVE) continue;
    if (porChave.has(chave)) continue; // primeira grafia ganha; o índice único já evita
    porChave.set(chave, pessoa);
    pares.push({ nome, pessoa });
    maxTokens = Math.max(maxTokens, chave.split(" ").length);
  }

  return { porChave, maxTokens, pares };
}

/** Um nome só. É isto que se aplica na ENTRADA, antes de montar o prompt. */
export function pessoaDe(mapa: MapaPessoas, nome: string | null | undefined): string {
  const n = String(nome ?? "");
  if (!mapa.porChave.size || !n) return n;
  return mapa.porChave.get(chavePessoa(n)) ?? n;
}

/**
 * O texto inteiro. É isto que se aplica na SAÍDA.
 *
 * Anda por JANELAS DE PALAVRAS do texto original, da maior para a menor,
 * normalizando cada janela e consultando o mapa. Fazer regex por razão social
 * cadastrada não daria conta de acento e caixa que o modelo reescreve ("C M
 * Soluções" quando o cadastro diz "C M SOLUCOES"); normalizar o texto inteiro de
 * uma vez daria, mas perderia a posição de volta para reconstruir o resto da
 * frase intacto.
 */
export function pessoasNoTexto(mapa: MapaPessoas, texto: string | null | undefined): string {
  const t = String(texto ?? "");
  if (!mapa.porChave.size || !t) return t;

  const tokens: { ini: number; fim: number }[] = [];
  // A palavra carrega ponto, hífen e barra para dentro: sem isso "LTDA." viraria
  // dois tokens e a janela de N palavras nunca fecharia sobre a razão social.
  const re = /[\p{L}\p{N}][\p{L}\p{N}.\-/&]*/gu;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    tokens.push({ ini: m.index, fim: m.index + m[0].length });
  }

  const saida: string[] = [];
  let cursor = 0;
  let i = 0;

  while (i < tokens.length) {
    let casou = false;
    // Da maior janela para a menor: com "DALBER" e "DALBER NEGOCIOS" cadastrados,
    // o certo é o mais específico ganhar.
    for (let n = Math.min(mapa.maxTokens, tokens.length - i); n >= 1; n--) {
      const trecho = t.slice(tokens[i].ini, tokens[i + n - 1].fim);
      const pessoa = mapa.porChave.get(chavePessoa(trecho));
      if (!pessoa) continue;
      saida.push(t.slice(cursor, tokens[i].ini), pessoa);
      cursor = tokens[i + n - 1].fim;
      i += n;
      casou = true;
      break;
    }
    if (!casou) i++;
  }

  saida.push(t.slice(cursor));
  return saida.join("");
}

/**
 * O bloco que entra no prompt, junto da Biblioteca.
 *
 * A troca determinística já resolve o caminho principal — este bloco existe para
 * o que ela não alcança: o modelo lendo a razão social na observação crua do
 * título, ou a pessoa perguntando "quanto pagamos para a DALBER NEGOCIOS?" e o
 * modelo precisando saber que aquilo é o Dalber.
 */
export function blocoPessoasPJ(mapa: MapaPessoas): string {
  if (!mapa.pares.length) return "";
  return [
    `\n## Razões sociais que são pessoas (${mapa.pares.length})`,
    "Cada CNPJ abaixo é a PJ de UMA PESSOA. Ao escrever, use SEMPRE o nome da pessoa e",
    "NUNCA a razão social — quem lê conhece a pessoa, não a empresa dela. Vale inclusive",
    "quando a razão social aparecer no texto de um lançamento ou na observação do título.",
    ...mapa.pares.map((p) => `- ${p.nome} → escreva "${p.pessoa}"`),
  ].join("\n");
}
