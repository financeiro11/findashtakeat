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
import { classificaSicoob, eCredito, lerContraparte, SIC_META } from "@/lib/extratoNatureza";

export type FonteKey = "cartao" | "sicoob" | "asaas";

export const FONTES: { key: FonteKey; nome: string; tabela: string }[] = [
  { key: "cartao", nome: "Cartão", tabela: "cartao_lancamentos" },
  { key: "sicoob", nome: "Sicoob", tabela: "sicoob_extrato" },
  { key: "asaas", nome: "Asaas", tabela: "asaas_extrato" },
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
  /** A segunda linha do card — o texto cru de onde o título saiu, quando difere. */
  detalhe: string | null;
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
 * A busca varre o texto CRU, não o desmontado: se o parser errar num caso que
 * ainda não vimos, o lançamento continua achável pelo que o banco escreveu.
 */
export function normalizarBanco(l: LinhaBanco): LinhaExtrato {
  const valor = Math.abs(Number(l.valor) || 0);
  const entrada = eCredito(l.tipo);
  const cat = classificaSicoob(l.historico, entrada);
  const cp = lerContraparte(l.contraparte_nome);
  const titulo = (cp.nome || l.historico || cp.operacao || "Sem descrição").trim();
  const documento = cp.documento || l.contraparte_documento;

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
    // O histórico só vira segunda linha quando o título veio da contraparte —
    // senão o card repetiria a mesma frase duas vezes (o caso do Asaas).
    detalhe: cp.nome && l.historico ? l.historico : null,
    valor,
    entrada,
    cat,
    catRotulo: SIC_META[cat].rot,
    catDot: SIC_META[cat].dot,
    campos,
    busca: textoBusca(
      [l.historico, l.contraparte_nome, cp.nome, documento, l.numero_documento, SIC_META[cat].rot],
      valor,
    ),
  };
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
