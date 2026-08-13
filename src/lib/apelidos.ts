import {
  chavePessoa, MIN_CHAVE, montarMapaPessoas, pessoasNoTexto,
  type MapaPessoas,
} from "@/lib/pessoasPJ";

/* ---------------------------------------------------------------------------
 * O nome que a contraparte tem PARA NÓS.
 *
 * O Omie guarda razão social e o cartão guarda o que o adquirente mandou —
 * "JIM.COM GRUPO SOUZA". Nenhum dos dois foi feito para ser lido por gente, e
 * numa reunião alguém aponta a linha e pergunta o que é. A Parametrização
 * (/configuracoes/parametrizacao) é onde essa contraparte ganha um apelido
 * ("Café dos eventos"), uma frase do que é, e um dono a quem perguntar.
 *
 * RELAÇÃO COM `pessoasPJ.ts`: aquele arquivo resolvia o caso particular "razão
 * social que é uma pessoa só" (DALBER NEGOCIOS -> Dalber). É o MESMO gesto — um
 * nome cru entra, um nome legível sai — então este módulo generaliza e reusa a
 * chave e a varredura de texto de lá em vez de escrever um segundo normalizador.
 * `contrapartes_pessoas` virou view sobre `lib_fornecedores.apelido` na migration
 * 20260812200000, então os dois lados leem o mesmo cadastro.
 *
 * Puro de propósito: é o que dá para testar sem levantar React nem o Supabase.
 * ------------------------------------------------------------------------- */

export { MIN_CHAVE };

/** A chave de casamento — a mesma de `pessoasPJ`, com o nome do domínio novo. */
export const chaveContraparte = chavePessoa;

export type Apelido = {
  id?: string;
  /** A grafia canônica no cadastro (`lib_fornecedores.nome`). */
  nome: string;
  /** O nome curto que vai para a tela. */
  apelido: string;
  /** A frase que se responde quando perguntam. */
  oQueE?: string | null;
  /** Quem na Takeat contratou — a saída quando ninguém lembra. */
  dono?: string | null;
  documento?: string | null;
  origem?: string | null;
};

export type MapaApelidos = {
  /** chave normalizada de QUALQUER grafia conhecida -> o cadastro */
  porChave: Map<string, Apelido>;
  /** só dígitos do CNPJ/CPF -> o cadastro. Casa onde o nome falha. */
  porDocumento: Map<string, Apelido>;
  /** projeção para trocar nomes DENTRO de um texto corrido (comentário da IA) */
  paraTexto: MapaPessoas;
  lista: Apelido[];
};

export const MAPA_APELIDOS_VAZIO: MapaApelidos = {
  porChave: new Map(),
  porDocumento: new Map(),
  paraTexto: montarMapaPessoas([]),
  lista: [],
};

/** Só dígitos — é assim que o documento casa entre Omie, OFX e cadastro. */
export function soDigitos(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

/**
 * Monta o mapa a partir do cadastro e das grafias alternativas.
 *
 * `aliases` são as outras formas do mesmo nome (`contrapartes_alias`) — é o que
 * resolve os 41 lojistas que o extrato entrega cortados em exatos 20 caracteres
 * e os que viram só "DE", "DM", "MERC". Sem elas, cada corte pediria seu próprio
 * apelido.
 */
export function montarMapaApelidos(
  cadastro: Apelido[],
  aliases: { fornecedor_id: string; alias: string }[] = [],
): MapaApelidos {
  const porChave = new Map<string, Apelido>();
  const porDocumento = new Map<string, Apelido>();
  const porId = new Map<string, Apelido>();
  const lista: Apelido[] = [];

  for (const c of cadastro ?? []) {
    const nome = String(c?.nome ?? "").trim();
    const apelido = String(c?.apelido ?? "").trim();
    if (!nome || !apelido) continue;

    const item: Apelido = { ...c, nome, apelido };
    lista.push(item);
    if (item.id) porId.set(item.id, item);

    const chave = chaveContraparte(nome);
    // Chave curta demais casaria palavra comum no meio de uma frase.
    if (chave.length >= MIN_CHAVE && !porChave.has(chave)) porChave.set(chave, item);

    const doc = soDigitos(item.documento);
    if (doc.length >= 11 && !porDocumento.has(doc)) porDocumento.set(doc, item);
  }

  for (const a of aliases ?? []) {
    const dono = porId.get(String(a?.fornecedor_id ?? ""));
    if (!dono) continue; // alias de fornecedor ainda sem apelido não muda nada
    const chave = chaveContraparte(a?.alias);
    if (chave.length < MIN_CHAVE || porChave.has(chave)) continue;
    porChave.set(chave, dono);
  }

  // A varredura de texto recebe TODAS as grafias, não só a canônica: o
  // comentário gravado pode citar qualquer uma delas.
  const pares: { nome: string; pessoa: string }[] = [];
  for (const [, item] of porChave) pares.push({ nome: item.nome, pessoa: item.apelido });
  for (const a of aliases ?? []) {
    const dono = porId.get(String(a?.fornecedor_id ?? ""));
    if (dono) pares.push({ nome: String(a.alias ?? ""), pessoa: dono.apelido });
  }

  return { porChave, porDocumento, paraTexto: montarMapaPessoas(pares), lista };
}

/**
 * O cadastro de uma contraparte, ou `null`.
 *
 * O documento vem primeiro porque é identidade de verdade; o nome é o que sobra
 * quando não há CNPJ — que é sempre o caso do cartão.
 */
export function apelidoDe(
  mapa: MapaApelidos | null | undefined,
  nome: string | null | undefined,
  documento?: string | null,
): Apelido | null {
  if (!mapa) return null;

  const doc = soDigitos(documento);
  if (doc.length >= 11) {
    const porDoc = mapa.porDocumento.get(doc);
    if (porDoc) return porDoc;
  }

  const n = String(nome ?? "");
  if (!n) return null;
  return mapa.porChave.get(chaveContraparte(n)) ?? null;
}

/** O que a tela escreve: o apelido quando existe, senão o nome como veio. */
export function nomeExibido(
  mapa: MapaApelidos | null | undefined,
  nome: string | null | undefined,
  documento?: string | null,
): string {
  return apelidoDe(mapa, nome, documento)?.apelido ?? String(nome ?? "");
}

/** Troca os nomes DENTRO de um texto corrido — comentário, resposta, driver. */
export function apelidosNoTexto(
  mapa: MapaApelidos | null | undefined,
  texto: string | null | undefined,
): string {
  return pessoasNoTexto(mapa?.paraTexto, texto);
}

export function jaTemApelido(
  mapa: MapaApelidos | null | undefined,
  nome: string | null | undefined,
  documento?: string | null,
): boolean {
  return !!apelidoDe(mapa, nome, documento);
}

/**
 * O ponto de partida do campo, para quem for digitar não começar do vazio.
 *
 * "JIM COM GRUPO SOUZA" vira "Jim Com Grupo Souza" — não é o apelido e não tenta
 * ser. É só a caixa arrumada.
 */
export function sugestaoDeApelido(nome: string | null | undefined): string {
  const base = chaveContraparte(nome);
  if (!base) return "";
  return base
    .toLowerCase()
    .split(" ")
    .map((p) => (p.length <= 2 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}

/* -------------------------------------------------------------------------
 * A fila: por onde começar a nomear
 * ---------------------------------------------------------------------- */

export type Candidato = {
  origem: string;
  nome: string;
  documento: string | null;
  categoria: string | null;
  cidade: string | null;
  lancamentos: number;
  total: number;
  primeira: string | null;
  ultima: string | null;
};

/* -------------------------------------------------------------------------
 * A janela de tempo
 * ---------------------------------------------------------------------- */

export type Janela = "fechado" | "3m" | "6m" | "12m" | "tudo";

/**
 * De quando até quando a fila deve olhar.
 *
 * Um fornecedor sem nome em março pesa menos do que um de julho, que acabou de
 * fechar — e a barra de cobertura só quer dizer alguma coisa se o denominador
 * for o dinheiro DA JANELA. Por isso o intervalo vai para a RPC e não é filtro
 * de tela: filtrar só a lista deixaria "43% do valor" somando o que ficou fora.
 *
 * `hoje` é parâmetro para o teste não depender do dia em que roda.
 */
export function intervaloDaJanela(
  janela: Janela,
  hoje: Date = new Date(),
): { de: string | null; ate: string | null } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (janela === "tudo") return { de: null, ate: null };

  if (janela === "fechado") {
    // Dia 0 do mês corrente é o ÚLTIMO dia do mês passado — pega fevereiro e
    // ano bissexto de graça, sem tabela de dias.
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    return { de: iso(ini), ate: iso(fim) };
  }

  const meses = janela === "3m" ? 3 : janela === "6m" ? 6 : 12;
  const ini = new Date(hoje.getFullYear(), hoje.getMonth() - meses, hoje.getDate());
  return { de: iso(ini), ate: null };
}

/* Tabela explícita em vez de `toLocaleDateString`: o ICU do Node devolve
   "jul. de 26" e o do navegador "jul. de 26" ou "jul 26" conforme a versão — o
   rótulo do botão não pode depender de onde o código roda. */
export const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "Jul 26" — o mês fechado, para o botão dizer qual é. */
export function rotuloMesFechado(hoje: Date = new Date()): string {
  const m = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${MESES_CURTOS[m.getMonth()]} ${String(m.getFullYear()).slice(-2)}`;
}

/** Categorias que não dizem nada — quem cai nelas é justamente o que se pergunta. */
const CATEGORIA_GENERICA = /^(outros|outras|diversos|diversas|sem categoria|n[ãa]o classificad)/i;

/** O OFX corta o lojista em exatamente 20 caracteres. Nome nesse tamanho está,
 *  quase sempre, pela metade — e nome pela metade ninguém reconhece. */
const CORTE_DO_OFX = 20;

/**
 * O nome não diz o que é? Este é o único critério que importa de verdade.
 *
 * Foi aprendido na marra: a primeira versão ordenava por um score único de
 * frequência × valor, e a primeira tela veio com TAKEAT.APP - GARCOM DIGITAL,
 * PAGAMENTO DE FATURA, META ADS e RECEITA FEDERAL. Todos enormes, nenhum
 * precisando de explicação. A pergunta na reunião nunca é sobre o maior gasto —
 * é sobre o gasto que não dá para ler.
 *
 * Dois sinais, e só dois, porque são os únicos que se sustentam:
 *   • categoria genérica — quem classificou também não soube o que era (são 286
 *     das 692 contrapartes, e é onde estão KNDTEC, BONES VIX, FPANAPRATI);
 *   • lojista de cartão cortado no limite do OFX — "COMARELLA PIZZA BURG".
 *
 * O que NÃO entra: nome curto. "UBER", "GOL", "DELL", "AZUL" e "99" têm quatro
 * letras ou menos e são perfeitamente legíveis; a regra de tamanho os jogava
 * para o topo junto com "DM" e "IG". Fragmento curto de verdade tem valor e
 * frequência baixos, então afunda sozinho — e o caminho dele é "juntar grafia",
 * não ganhar apelido próprio.
 */
export function enigmatica(c: Candidato): boolean {
  if (CATEGORIA_GENERICA.test(String(c?.categoria ?? ""))) return true;
  return c?.origem === "cartao" && String(c?.nome ?? "").length === CORTE_DO_OFX;
}

/**
 * O quanto a contraparte aparece na sua frente.
 *
 * Desempata DENTRO de cada tier, nunca entre eles. O valor entra em log e não em
 * raiz: com raiz, um fornecedor de R$ 900 k ainda valia 7× um de R$ 17 k e
 * atravessava o critério do nome. Em log a diferença vira 1,4× — o bastante para
 * ordenar, pouco para mandar.
 */
export function presenca(c: Candidato): number {
  const n = Math.max(0, Number(c?.lancamentos) || 0);
  const v = Math.max(0, Number(c?.total) || 0);
  return Math.sqrt(n) * Math.log10(1 + v);
}

/** Os anônimos: primeiro os que não dizem o que são, depois o resto. */
export function filaDeAnonimos(
  candidatos: Candidato[],
  mapa: MapaApelidos | null | undefined,
): Candidato[] {
  return (candidatos ?? [])
    .filter((c) => c?.nome && !jaTemApelido(mapa, c.nome, c.documento))
    .sort((a, b) => {
      const ea = enigmatica(a) ? 0 : 1;
      const eb = enigmatica(b) ? 0 : 1;
      return ea !== eb ? ea - eb : presenca(b) - presenca(a);
    });
}

/**
 * Quanto do dinheiro já sabe dizer o próprio nome.
 *
 * Medido em VALOR, não em contagem de contrapartes: nomear 300 lojistas de R$ 50
 * não muda uma reunião, e nomear os 6 que são 80% da fatura muda.
 */
export function cobertura(
  candidatos: Candidato[],
  mapa: MapaApelidos | null | undefined,
): { nomeadas: number; total: number; valorNomeado: number; valorTotal: number; pct: number } {
  let nomeadas = 0;
  let valorNomeado = 0;
  let valorTotal = 0;

  for (const c of candidatos ?? []) {
    const v = Math.max(0, Number(c?.total) || 0);
    valorTotal += v;
    if (jaTemApelido(mapa, c?.nome, c?.documento)) {
      nomeadas++;
      valorNomeado += v;
    }
  }

  return {
    nomeadas,
    total: (candidatos ?? []).length,
    valorNomeado,
    valorTotal,
    pct: valorTotal > 0 ? valorNomeado / valorTotal : 0,
  };
}