/* ============================================================================
 * Aba Extratos do celular — a lógica, sem React.
 *
 * Três fontes que não se parecem em nada no banco (fatura de cartão vinda de OFX,
 * extrato do Sicoob vindo do n8n, extrato do Asaas vindo da Edge Function) viram
 * aqui UMA linha de extrato, para a tela ser uma só. O que muda entre as fontes é
 * o que preenche cada campo — e isso está inteiro neste arquivo, não espalhado
 * pelos JSX.
 *
 * Duas decisões que valem mais que o código:
 *
 * 1. `valor` é SEMPRE positivo, e o sinal mora em `entrada`. É a convenção que as
 *    três tabelas já usam (`tipo` no cartão, `tipo` credito/debito nos bancos).
 *    Somar valores com sinal misturado é o jeito clássico de o total do mês dar
 *    um número que não bate com nada.
 *
 * 2. A busca é POR TERMO, não por substring: "meta ads" acha "META ADS ONLINE" e
 *    "ADS META" também. Quem digita o nome do fornecedor de memória raramente
 *    acerta a ordem — a mesma regra do drill-down da DRE (src/lib/filtroLancamentos.ts).
 * ========================================================================== */

import { normalize } from "@/lib/normalize";
import {
  classificaSicoob, comNomeDoCadastro, eCredito, fmtDocumento, lerContraparte,
  SIC_META, tituloDoExtrato,
} from "@/lib/extratoNatureza";

/* A formatação do documento mora com o parser que o extrai, e é reexportada
   daqui porque a tela do celular sempre a importou deste módulo. */
export { fmtDocumento };

export type FonteKey = "cartao" | "sicoob" | "asaas";

/** `saldo` é a tabela de saldo da conta — o cartão não tem uma (a fatura É o saldo). */
export const FONTES: { key: FonteKey; nome: string; tabela: string; saldo: string | null }[] = [
  { key: "cartao", nome: "Cartão", tabela: "cartao_lancamentos", saldo: null },
  { key: "sicoob", nome: "Sicoob", tabela: "sicoob_extrato", saldo: "sicoob_saldo" },
  { key: "asaas", nome: "Asaas", tabela: "asaas_extrato", saldo: "asaas_saldo" },
];

export const ehFonte = (v: string | null | undefined): v is FonteKey =>
  FONTES.some((f) => f.key === v);

/** A linha que a tela desenha, venha ela de onde vier. */
export type LinhaExtrato = {
  id: string;
  /** AAAA-MM-DD */
  data: string | null;
  /** O nome que se procura: lojista no cartão, contraparte ou histórico no banco. */
  titulo: string;
  /** A segunda linha do card — o texto cru que identifica a contraparte, quando difere. */
  detalhe: string | null;
  /** CPF/CNPJ da contraparte, já formatado. É por ele que a Parametrização dá o nome. */
  documento: string | null;
  /** Sempre >= 0. O sinal está em `entrada`. */
  valor: number;
  entrada: boolean;
  /** Chave do filtro de categoria/natureza. */
  cat: string;
  catRotulo: string;
  /** Classe Tailwind do pontinho colorido (natureza bancária); vazio no cartão. */
  catDot: string;
  /** Os pares que a folha de detalhe lista, na ordem. */
  campos: [string, string][];
  /** Texto normalizado que a busca varre — pré-computado, roda a cada tecla. */
  busca: string;
};

/* ------------------------------- paginação -------------------------------- */

/* O PostgREST devolve no máximo 1.000 linhas por resposta, e um `.limit(4001)` volta 1.000
   CALADO — sem erro, sem flag. Era o que fazia agosto/26 do Asaas (6.017 lançamentos) somar
   R$ 152.940,70 de entrada em vez de R$ 902.117,68: a tela lia o primeiro milheiro, e como
   1.000 é menos que o teto ela ainda se declarava inteira ("1000 de 1000 · sem filtro"). */
export const PAGINA = 1000;

/** Teto de segurança: nenhum mês real chega perto (o pior hoje é o Asaas, ~6 mil). */
export const TETO = 20000;

export type Pagina<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

/**
 * Lê o recorte inteiro em páginas de mil.
 *
 * A primeira página vem com a contagem exata, e é ela que diz quantas faltam — assim as
 * outras saem TODAS de uma vez, em vez de uma ida ao servidor por página. Para o cartão e o
 * Sicoob (que não passam de 700 linhas por mês) isso continua sendo uma consulta só.
 *
 * As linhas repetidas são descartadas por `id`: as páginas são lidas em paralelo sobre uma
 * tabela que a sync pode estar escrevendo, e um lançamento novo empurra a janela para baixo,
 * o que faria uma linha vir duas vezes. Contada duas vezes, ela mente no total — que é
 * exatamente o que esta função existe para não fazer.
 *
 * Erro vira exceção em vez de lista curta: uma policy negando é indistinguível de um mês
 * calmo quando o retorno é `[]`, e "nenhum lançamento" é uma mentira que ninguém investiga.
 */
export async function lerPaginado<T extends { id: string }>(
  consulta: (de: number, ate: number) => PromiseLike<Pagina<T>>,
): Promise<{ dados: T[]; truncado: boolean }> {
  const primeira = await consulta(0, PAGINA - 1);
  if (primeira.error) throw new Error(primeira.error.message);

  const paginas: T[][] = [primeira.data ?? []];
  // Sem `count` (fonte que não o peça) o que se sabe é só o que veio: uma página cheia
  // vira "leia a próxima", e o laço anda de mil em mil até vir uma página incompleta.
  const total = primeira.count ?? null;

  if (total === null) {
    for (let de = PAGINA; de < TETO && paginas[paginas.length - 1].length === PAGINA; de += PAGINA) {
      const p = await consulta(de, de + PAGINA - 1);
      if (p.error) throw new Error(p.error.message);
      paginas.push(p.data ?? []);
    }
  } else {
    const restantes: PromiseLike<Pagina<T>>[] = [];
    for (let de = PAGINA; de < Math.min(total, TETO); de += PAGINA) {
      restantes.push(consulta(de, de + PAGINA - 1));
    }
    for (const p of await Promise.all(restantes)) {
      if (p.error) throw new Error(p.error.message);
      paginas.push(p.data ?? []);
    }
  }

  const vistos = new Set<string>();
  const dados: T[] = [];
  for (const linha of paginas.flat()) {
    if (vistos.has(linha.id)) continue;
    vistos.add(linha.id);
    dados.push(linha);
  }
  return { dados: dados.slice(0, TETO), truncado: (total ?? dados.length) > TETO };
}

/* --------------------------------- meses --------------------------------- */

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-08-14" → "2026-08". Aceita ISO com hora. */
export const mesDe = (data: string | null | undefined): string => (data ?? "").slice(0, 7);

/** O mês de hoje em São Paulo — o padrão de abertura quando a fonte está vazia. */
export const mesAtual = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);

/** "2026-08" → "ago/26". */
export function rotuloMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  if (!ano || !m) return mes;
  return `${MESES_CURTOS[m - 1]}/${String(ano).slice(2)}`;
}

/** "2026-08" → "agosto de 2026" — o rótulo do seletor, que tem espaço. */
export function rotuloMesLongo(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  if (!ano || !m) return mes;
  return `${MESES_LONGOS[m - 1]} de ${ano}`;
}

/**
 * Anda `passos` meses (negativo = para trás). A conta é em número puro, não em
 * `Date`: somar 30 dias sobre um Date local erra na virada de horário de verão, e
 * mês errado num extrato é um mês inteiro de lançamento sumindo da tela.
 */
export function somaMes(mes: string, passos: number): string {
  const [ano, m] = mes.split("-").map(Number);
  if (!ano || !m) return mes;
  const total = ano * 12 + (m - 1) + passos;
  const a = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${a}-${String(mm).padStart(2, "0")}`;
}

/** Os `n` meses terminando em `ate`, do mais novo para o mais velho. */
export function ultimosMeses(ate: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => somaMes(ate, -i));
}

/** O primeiro e o último dia do mês, para o `gte`/`lte` da consulta. */
export function limitesDoMes(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate(); // dia 0 do mês seguinte
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/* ------------------------------ normalização ------------------------------ */

/**
 * O texto que a busca varre. Os valores entram em duas formas — inteiro e com
 * centavos — porque quem procura um gasto lembra do número redondo ("1240"), e
 * `normalize` come o ponto e a vírgula do valor formatado.
 */
function textoBusca(partes: (string | null | undefined)[], valor: number): string {
  return normalize([...partes, String(Math.round(valor)), valor.toFixed(2)].filter(Boolean).join(" "));
}

export type LinhaCartao = {
  id: string;
  data: string | null;
  estabelecimento: string;
  categoria: string;
  descricao: string | null;
  parcela: string | null;
  cidade: string | null;
  valor: number | string;
  tipo: string;
  fitid?: string | null;
};

/**
 * Um lançamento da fatura. `pagamento` e `estorno` são as duas coisas que ABATEM
 * a fatura — na tela entram como entrada (verde), senão o total do mês fica maior
 * que a fatura que o banco cobrou.
 */
export function normalizarCartao(l: LinhaCartao): LinhaExtrato {
  const valor = Math.abs(Number(l.valor) || 0);
  const entrada = l.tipo === "pagamento" || l.tipo === "estorno";
  const rotuloTipo = l.tipo === "gasto" ? "Gasto" : l.tipo === "pagamento" ? "Pagamento da fatura" : "Estorno";
  const detalhe = l.descricao && normalize(l.descricao) !== normalize(l.estabelecimento) ? l.descricao : null;

  const campos: [string, string][] = [];
  if (l.data) campos.push(["Data da compra", fmtDia(l.data)]);
  campos.push(["Categoria", l.categoria]);
  if (l.parcela) campos.push(["Parcela", l.parcela]);
  if (l.cidade) campos.push(["Cidade", l.cidade]);
  campos.push(["Tipo", rotuloTipo]);
  if (l.descricao) campos.push(["Texto da fatura", l.descricao]);

  return {
    id: l.id,
    data: l.data,
    titulo: l.estabelecimento,
    detalhe,
    documento: null, // o OFX não traz CNPJ: no cartão quem casa com o cadastro é o nome
    valor,
    entrada,
    cat: l.categoria,
    catRotulo: l.categoria,
    catDot: "",
    campos,
    busca: textoBusca([l.estabelecimento, l.descricao, l.categoria, l.cidade, l.parcela, rotuloTipo], valor),
  };
}

export type LinhaBanco = {
  id: string;
  id_transacao?: string | null;
  data_movimento: string | null;
  tipo: string | null;
  valor: number | string | null;
  historico: string | null;
  contraparte_nome: string | null;
  contraparte_documento: string | null;
  numero_documento: string | null;
};

/**
 * Uma linha de extrato bancário. O título é a contraparte quando existe — é por
 * ela que se procura, e no Sicoob ela vem embrulhada num pacote que só
 * `lerContraparte` desmonta. No Asaas ela é sempre nula (a API de
 * financialTransactions não a traz), então lá o título é o próprio histórico; sem
 * esse fallback a lista inteira ficaria sem nome.
 *
 * O rótulo da operação ("Pagamento Pix") vem ANTES do histórico na escada de fallback
 * porque é o que a pessoa reconhece: o histórico do mesmo lançamento é "PIX EMITIDO OUTRA
 * IF". Nos dois casos é um título que não diz quem recebeu — quem resolve isso é
 * `nomearContrapartes`, pelo CNPJ.
 *
 * A busca varre o texto CRU, não o desmontado: se o parser errar num caso que
 * ainda não vimos, o lançamento continua achável pelo que o banco escreveu.
 */
export function normalizarBanco(l: LinhaBanco): LinhaExtrato {
  const valor = Math.abs(Number(l.valor) || 0);
  const entrada = eCredito(l.tipo);
  const cat = classificaSicoob(l.historico, entrada);
  const cp = lerContraparte(l.contraparte_nome);
  const titulo = tituloDoExtrato(cp, l.historico) || "Sem descrição";
  const documento = fmtDocumento(cp.documento || l.contraparte_documento);

  const campos: [string, string][] = [];
  if (l.data_movimento) campos.push(["Data", fmtDia(l.data_movimento)]);
  campos.push(["Natureza", SIC_META[cat].rot]);
  campos.push(["Tipo", entrada ? "Crédito" : "Débito"]);
  if (cp.operacao) campos.push(["Operação", cp.operacao]);
  if (l.historico) campos.push(["Histórico", l.historico]);
  if (cp.nome) campos.push(["Contraparte", cp.nome]);
  if (documento) campos.push(["CPF/CNPJ", documento]);
  if (l.numero_documento) campos.push(["Documento", l.numero_documento]);

  return {
    id: l.id,
    data: l.data_movimento,
    titulo,
    // A linha de apoio é o que IDENTIFICA a contraparte, não o que já está no título: o
    // CNPJ quando ele existe (é ele que se procura no Omie), e o histórico só quando não
    // há CNPJ nem repetição do título — senão o card diria a mesma frase duas vezes, que
    // é o caso do Asaas.
    detalhe: documento ?? (l.historico && normalize(l.historico) !== normalize(titulo) ? l.historico : null),
    documento,
    valor,
    entrada,
    cat,
    catRotulo: SIC_META[cat].rot,
    catDot: SIC_META[cat].dot,
    campos,
    busca: textoBusca(
      [l.historico, l.contraparte_nome, cp.nome, cp.operacao, documento, l.numero_documento, SIC_META[cat].rot],
      valor,
    ),
  };
}

/* --------------------------- nome da contraparte --------------------------- */

/**
 * Põe o nome do cadastro (Configurações › Parametrização) no lugar do rótulo que o banco
 * mandou.
 *
 * É a razão de a aba existir: no extrato do Sicoob 248 das 303 linhas de agosto são
 * "Pagamento Pix", porque o banco manda o rótulo da operação e o CNPJ — nunca o nome. Quem
 * sabe traduzir CNPJ em nome é o cadastro, que hoje cobre 155 dos 166 CNPJs que apareceram
 * no extrato. No cartão o casamento é pelo nome, e as grafias alternativas resolvem os
 * lojistas que o OFX corta em 20 caracteres.
 *
 * Fica FORA da normalização, num passo próprio, porque o cadastro chega assíncrono: as
 * linhas já estão na tela quando o mapa termina de carregar, e refazer a normalização
 * inteira só para trocar um nome custaria uma releitura do extrato a cada carga.
 *
 * A busca ganha o nome novo sem perder o velho — quem digita "Flash" e quem digita o CNPJ
 * acham a mesma linha (a convenção do CLAUDE.md: incluir o apelido no texto que a busca
 * varre, senão a linha some do filtro pelo nome que está escrito nela).
 */
export function nomearContrapartes(
  linhas: LinhaExtrato[],
  nomeDoCadastro: (nome: string, documento: string | null) => string | null,
): LinhaExtrato[] {
  return linhas.map((l) => {
    // A regra dos dois degraus (apelido em cima, cru embaixo) mora em
    // `extratoNatureza`, com a do desktop — duas cópias divergiriam no primeiro ajuste.
    const { titulo, apoio, trocado } = comNomeDoCadastro(
      l.titulo, l.detalhe, nomeDoCadastro(l.titulo, l.documento),
    );
    if (!trocado) return l;

    return {
      ...l,
      titulo,
      detalhe: apoio,
      campos: [["Contraparte no cadastro", titulo], ...l.campos],
      busca: `${l.busca} ${normalize(titulo)}`.trim(),
    };
  });
}

/* -------------------------------- filtro --------------------------------- */

/** Todo termo digitado precisa aparecer, em qualquer ordem, em qualquer campo. */
export function casaBusca(texto: string, busca: string): boolean {
  const termos = normalize(busca).split(" ").filter(Boolean);
  return termos.every((t) => texto.includes(t));
}

/** Conjunto de categorias vazio = TODAS (e não "nenhuma"). */
export function filtrar(linhas: LinhaExtrato[], busca: string, cats: Set<string>): LinhaExtrato[] {
  const b = busca.trim();
  return linhas.filter((l) => {
    if (cats.size && !cats.has(l.cat)) return false;
    if (b && !casaBusca(l.busca, b)) return false;
    return true;
  });
}

export type Totais = { entradas: number; saidas: number; saldo: number; n: number };

export function totais(linhas: LinhaExtrato[]): Totais {
  let entradas = 0;
  let saidas = 0;
  for (const l of linhas) {
    if (l.entrada) entradas += l.valor;
    else saidas += l.valor;
  }
  return { entradas, saidas, saldo: entradas - saidas, n: linhas.length };
}

/* ------------------------------ comparativo ------------------------------- */

/** O que a RPC `extrato_comparativo` devolve (um `jsonb` só — ver a migration). */
export type ResumoPeriodo = { entradas: number; saidas: number; n: number };

export type Comparativo = {
  mes: string;
  anterior_mes: string;
  /** Dia em que o dado do mês para. Nulo no cartão, que compara fatura inteira. */
  ate_dia: number | null;
  /** Falso quando o espelho não cobre a janela anterior — aí não há o que comparar. */
  comparavel: boolean;
  cobertura_desde: string | null;
  atual: ResumoPeriodo;
  anterior: ResumoPeriodo;
};

/** "sobe_ruim" é o caso das Saídas e da Fatura: crescer ali não é boa notícia. */
export type Sentido = "sobe_bom" | "sobe_ruim";

export type Variacao = {
  /** Diferença em %. NULO quando a porcentagem mentiria — aí a tela mostra os reais. */
  pct: number | null;
  /** Diferença em reais, sempre com sinal. */
  abs: number;
  /** Nulo quando não houve mudança; senão, se a mudança é boa notícia OU não. */
  bom: boolean | null;
};

/**
 * Compara dois períodos.
 *
 * O denominador é o MÓDULO da base, e isso não é detalhe: a linha "Resultado" fica
 * negativa em mês de aperto, e dividir por um número negativo inverte o sinal do percentual.
 * Sair de −R$ 100 mil para −R$ 50 mil apareceria como queda de 50% quando é melhora de 50%
 * — o tipo de erro que faz alguém ler a tela ao contrário justo no mês ruim.
 *
 * E há dois casos em que porcentagem nenhuma serve, então `pct` sai nulo e quem desenha
 * mostra a diferença em reais:
 *
 *   * BASE ZERO — "de R$ 0 para R$ 900" não é "+∞%", é dinheiro que apareceu.
 *   * TROCA DE SINAL — caso real: a fatura de jul/26 fechou NEGATIVA (−R$ 23,6 mil, os
 *     créditos passaram os gastos) e a de ago/26 deu +R$ 82,2 mil. A fórmula cospe
 *     "+447,9%", que não descreve nada; "▲ R$ 105,8 mil" descreve.
 */
export function variacao(atual: number, anterior: number, sentido: Sentido): Variacao {
  const abs = atual - anterior;
  const trocouSinal = atual !== 0 && anterior !== 0 && atual > 0 !== anterior > 0;
  const pct = anterior === 0 || trocouSinal ? null : (abs / Math.abs(anterior)) * 100;
  const bom = abs === 0 ? null : sentido === "sobe_bom" ? abs > 0 : abs < 0;
  return { pct, abs, bom };
}

/** O último dia do mês, para saber se `ate_dia` fecha o mês ou o corta no meio. */
const ultimoDiaDoMes = (mes: string): number => {
  const [ano, m] = mes.split("-").map(Number);
  return ano && m ? new Date(Date.UTC(ano, m, 0)).getUTCDate() : 31;
};

/**
 * Contra o que a comparação é feita, escrito para caber numa linha de celular.
 *
 * O recorte precisa estar à vista: "+10%" contra o mês anterior INTEIRO e "+10%" contra os
 * mesmos 25 dias são afirmações diferentes, e quem lê não tem como adivinhar qual é.
 */
export function rotuloComparacao(c: Comparativo): string {
  const anterior = rotuloMes(c.anterior_mes);
  if (c.ate_dia === null) return `vs. fatura de ${anterior}`;
  if (c.ate_dia >= ultimoDiaDoMes(c.mes)) return `vs. ${anterior}`;
  return `vs. 1–${c.ate_dia} de ${anterior}`;
}

/**
 * Por que não há comparativo. Existe porque a ausência dele numa tela que o mostra nas
 * outras abas se lê como defeito — e neste caso a razão é informação de verdade: o espelho
 * do Asaas começa em 25/07/2026, então julho simplesmente não está inteiro no banco.
 */
export function motivoSemComparativo(c: Comparativo, fonteNome: string): string {
  if (c.ate_dia === null) return `Não há fatura de ${rotuloMes(c.anterior_mes)} para comparar.`;
  if (c.cobertura_desde && mesDe(c.cobertura_desde) >= c.mes) {
    return `${fonteNome}: o espelho começa em ${fmtDia(c.cobertura_desde)}, então não há mês anterior.`;
  }
  if (c.cobertura_desde) {
    return `${fonteNome}: o espelho começa em ${fmtDia(c.cobertura_desde)} — ${rotuloMes(c.anterior_mes)} não está inteiro.`;
  }
  return `Sem dado de ${rotuloMes(c.anterior_mes)} para comparar.`;
}

export type CategoriaResumo = { chave: string; rotulo: string; dot: string; n: number; total: number };

/**
 * As categorias presentes, da que mais pesa para a que menos pesa. A ordem por
 * peso é o que faz o chip útil no celular: o que interessa está nos três
 * primeiros, sem rolar a faixa até o fim.
 */
export function categoriasDe(linhas: LinhaExtrato[]): CategoriaResumo[] {
  const m = new Map<string, CategoriaResumo>();
  for (const l of linhas) {
    let c = m.get(l.cat);
    if (!c) {
      c = { chave: l.cat, rotulo: l.catRotulo, dot: l.catDot, n: 0, total: 0 };
      m.set(l.cat, c);
    }
    c.n++;
    c.total += l.valor;
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

export type DiaExtrato = { dia: string; linhas: LinhaExtrato[]; entradas: number; saidas: number };

/**
 * Agrupa por dia mantendo a ordem em que as linhas chegaram (a consulta já vem do
 * mais recente para o mais antigo). Agrupar por dia é o que transforma uma lista
 * de 600 linhas em algo percorrível com o polegar.
 */
export function agruparPorDia(linhas: LinhaExtrato[]): DiaExtrato[] {
  const out: DiaExtrato[] = [];
  const idx = new Map<string, DiaExtrato>();
  for (const l of linhas) {
    const dia = l.data ?? "—";
    let g = idx.get(dia);
    if (!g) {
      g = { dia, linhas: [], entradas: 0, saidas: 0 };
      idx.set(dia, g);
      out.push(g);
    }
    g.linhas.push(l);
    if (l.entrada) g.entradas += l.valor;
    else g.saidas += l.valor;
  }
  return out;
}

/* ------------------------------- formatação ------------------------------ */

/** "2026-08-14" → "14/08". O ano fica no cabeçalho do mês, não em cada linha. */
export function fmtDiaCurto(data: string): string {
  const [, m, d] = data.slice(0, 10).split("-");
  return m && d ? `${d}/${m}` : data;
}

/** "2026-08-14" → "14/08/2026". */
export function fmtDia(data: string): string {
  const [a, m, d] = data.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : data;
}

/** "2026-08-14" → "sexta-feira, 14/08". Cabeçalho de cada grupo do dia. */
export function rotuloDia(dia: string): string {
  if (dia === "—") return "Sem data";
  const d = new Date(dia.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return fmtDiaCurto(dia);
  const semana = d.toLocaleDateString("pt-BR", { weekday: "long" });
  return `${semana}, ${fmtDiaCurto(dia)}`;
}
