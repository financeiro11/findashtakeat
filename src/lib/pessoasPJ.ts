import { normalize } from "@/lib/normalize";

/* ---------------------------------------------------------------------------
 * Razão social -> nome da pessoa, na hora de EXIBIR.
 *
 * O Omie guarda razão social. Quando o prestador é a PJ de uma pessoa só, o
 * comentário da DRE sai com "a saída de DALBER NEGOCIOS (-R$ 27,2k)" onde quem
 * lê esperava "a saída do Dalber". O de-para mora em `contrapartes_pessoas`.
 *
 * POR QUE TAMBÉM NO CLIENTE, se o servidor já troca antes de montar o prompt:
 * porque o comentário e os drivers ficam GRAVADOS. Cadastrar um nome novo só
 * teria efeito depois de "Regerar" — e regerar apaga o que já foi conferido.
 * Aplicando na exibição, cadastrar corrige na hora tudo o que já está escrito,
 * inclusive o que vai no "Copiar" e no "Copiar todos".
 *
 * O gêmeo desta lógica está em `supabase/functions/_shared/pessoas-pj.ts`, que é
 * quem faz o texto NOVO já nascer certo. Duplicado porque Deno e Vite não dividem
 * módulo — mesma relação que `src/lib/normalize.ts` tem com `_shared/normalize.ts`.
 * Este arquivo é puro de propósito: é o que dá para testar sem levantar React.
 * ------------------------------------------------------------------------- */

export type PessoaPJ = {
  id?: string;
  nome: string;
  pessoa: string;
  documento?: string | null;
  observacao?: string | null;
  status?: string | null;
};

export type MapaPessoas = {
  /** chave normalizada da razão social -> nome da pessoa */
  porChave: Map<string, string>;
  /** maior número de palavras entre as chaves — o tamanho da janela de busca */
  maxTokens: number;
  pares: { nome: string; pessoa: string }[];
};

export const MAPA_VAZIO: MapaPessoas = { porChave: new Map(), maxTokens: 0, pares: [] };

/**
 * Chave curta demais casaria palavra comum no meio da frase ("EI", "SA") e
 * trocaria o nome de quem não devia. O mesmo piso está no CHECK da tabela.
 */
export const MIN_CHAVE = 4;

/**
 * A chave de casamento.
 *
 * Tira acento, caixa, pontuação, CNPJ colado no nome e o sufixo societário —
 * assim "C M Soluções e Serviços LTDA.", "C M SOLUCOES E SERVICOS LTDA" e
 * "CM SOLUCOES E SERVICOS" caem na mesma chave. O sufixo sai em laço porque vem
 * empilhado ("FULANO SERVICOS LTDA ME").
 */
export function chavePessoa(s: string | null | undefined): string {
  // O CNPJ sai antes de `normalize`, enquanto ainda tem os pontos e a barra que
  // identificam o formato — depois dela seria só um punhado de dígitos.
  let t = normalize(String(s ?? "").replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, " "));

  for (;;) {
    const antes = t;
    t = t
      .replace(/\s+(SOCIEDADE\s+INDIVIDUAL\s+DE\s+ADVOCACIA|UNIPESSOAL|EIRELI|LTDA|EPP|MEI|ME|SS|S\s+A|SA|EI)$/, "")
      .trim();
    if (t === antes) return t;
  }
}

export function montarMapaPessoas(linhas: { nome: string; pessoa: string }[]): MapaPessoas {
  const porChave = new Map<string, string>();
  const pares: { nome: string; pessoa: string }[] = [];
  let maxTokens = 0;

  for (const l of linhas ?? []) {
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

/** Um nome só — o da lista de drivers, o da linha do lançamento. */
export function pessoaDe(mapa: MapaPessoas | null | undefined, nome: string | null | undefined): string {
  const n = String(nome ?? "");
  if (!mapa?.porChave.size || !n) return n;
  return mapa.porChave.get(chavePessoa(n)) ?? n;
}

/**
 * O texto inteiro — o comentário, a resposta da pergunta, o detalhe do sinal.
 *
 * Anda por JANELAS DE PALAVRAS do texto original, da maior para a menor,
 * normalizando cada janela e consultando o mapa. Regex por razão social
 * cadastrada não daria conta do acento e da caixa que o modelo reescreve ("C M
 * Soluções" quando o cadastro diz "C M SOLUCOES"); normalizar o texto inteiro de
 * uma vez daria, mas perderia a posição de volta para remontar a frase intacta.
 */
export function pessoasNoTexto(mapa: MapaPessoas | null | undefined, texto: string | null | undefined): string {
  const t = String(texto ?? "");
  if (!mapa?.porChave.size || !t) return t;

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

/** Já tem dono? Usado pela tela para não oferecer cadastrar duas vezes. */
export function jaMapeado(mapa: MapaPessoas | null | undefined, nome: string | null | undefined): boolean {
  return !!mapa?.porChave.size && mapa.porChave.has(chavePessoa(nome));
}

/**
 * O que a tela oferece como sugestão ao cadastrar.
 *
 * "C M SOLUCOES E SERVICOS LTDA" vira "C M Solucoes E Servicos" — não é o nome
 * da pessoa e não tenta ser. É só um ponto de partida com a caixa arrumada, para
 * quem for digitar não começar de um campo vazio.
 */
export function sugestaoDeNome(razaoSocial: string): string {
  const base = chavePessoa(razaoSocial);
  if (!base) return "";
  return base
    .toLowerCase()
    .split(" ")
    .map((p) => (p.length <= 2 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}
