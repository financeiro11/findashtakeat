/* ---------------------------------------------------------------------------
 * Governança › Plano de contas — a conta, sem tela.
 *
 * O banco entrega duas coisas (migration 20260914210000):
 *   • `plano_contas_resumo`: as categorias do Omie e o valor de cada uma mês a
 *     mês, na regra da DRE (competência) ou da DFC (caixa);
 *   • `plano_contas_lancamentos`: os lançamentos de uma categoria numa janela.
 * Tudo que é recorte — período, comparação, árvore, concentração, sinais — mora
 * aqui, testado, porque é onde uma conta errada passa por número plausível.
 *
 * SENTIDO. O Omie grava despesa com sinal negativo. Aqui a categoria de despesa
 * é lida em módulo ("quanto se gastou"), senão "subiu" e "caiu" trocariam de
 * significado no meio da tela. Estorno dentro de uma categoria de despesa (natureza
 * R) continua abatendo — é o que a DRE faz.
 * ------------------------------------------------------------------------- */

/* As regras do cadastro moram em `_shared/` porque a Edge Function que escreve no
   Omie aplica as mesmas — aqui só se reexporta, para a tela avisar antes de enviar. */
export {
  LIMITE_DESCRICAO, chaveDescricao, ehFolha, ehPosicaoLivre, limparDescricao, validarDescricao, validarGrupo,
  type CategoriaCadastro,
} from "../../supabase/functions/_shared/plano-contas";

import { nomeExibido, type MapaApelidos } from "./apelidos";
import { lerGastoDeCartao } from "./observacaoTitulo";

export type Base = "competencia" | "caixa";

/** Departamento do cadastro do Omie (cache `folha_cadastros`). */
export type DepartamentoOmie = { codigo: string; descricao: string; inativo: boolean };

/** [categoria, departamento (null = sem), "YYYY-MM", valor com sinal pela distribuição, lançamentos] */
export type CelulaDepartamento = [string, string | null, string, number, number];

/** Chave de "sem departamento" — no filtro da RPC e nas linhas da tela. */
export const SEM_DEPARTAMENTO = "__sem__";

/**
 * A decisão do financeiro de que a categoria fica fora da DRE/DFC de propósito
 * (`plano_contas_fora_da_demonstracao`). Cala o aviso "fora do DE-PARA" — não
 * muda número nenhum.
 */
export type MarcaFora = {
  codigo: string;
  demonstrativo: "dre" | "dfc";
  descricao: string | null;
  motivo: string | null;
  marcado_por_email: string | null;
  marcado_em: string;
};

export const chaveMarca = (codigo: string, tipo: "dre" | "dfc") => `${codigo}|${tipo}`;

export type CategoriaPlano = {
  codigo: string;
  descricao: string;
  superior: string | null;
  totalizadora: boolean;
  inativa: boolean;
  despesa: boolean;
  receita: boolean;
  rubrica_dre: string | null;
  rubrica_dfc: string | null;
  regra_nota: "exige" | "dispensa" | "conferir" | null;
  folha: boolean;
  /** lançamentos em TODA a base do cache, sem janela — 0 é "nunca usada" */
  usos: number;
  ultimo_uso: string | null;
  /** criada pela empresa (e não do plano padrão do Omie) */
  do_usuario?: boolean;
  /** a "Observação" da categoria no Omie (campo `natureza` da API) */
  observacao?: string | null;
  /** `id_conta_contabil` do Omie; nulo = a contabilidade ainda não ligou a categoria a uma conta */
  conta_contabil?: string | null;
};

/** Uma linha da trilha do cadastro (criar, renomear, desativar…) feito pelo Hub. */
export type AlteracaoCadastro = {
  acao: "criar" | "renomear" | "reaproveitar" | "desativar" | "reativar";
  codigo: string;
  superior: string | null;
  descricao_de: string | null;
  descricao_para: string | null;
  rubrica_dre: string | null;
  rubrica_dfc: string | null;
  referencias: Record<string, number> | null;
  motivo: string | null;
  por: string | null;
  criado_em: string;
};

/** [código, "YYYY-MM", valor com sinal do Omie, lançamentos, contrapartes distintas] */
export type CelulaMensal = [string, string, number, number, number];

export type ResumoPlano = {
  base: Base;
  hoje: string;
  categorias_atualizado_em: string | null;
  movimentos_atualizado_em: string | null;
  categorias: CategoriaPlano[];
  mensal: CelulaMensal[];
  cadastro?: AlteracaoCadastro[];
  mensal_dep?: CelulaDepartamento[];
  departamentos?: DepartamentoOmie[];
  /** a leitura do Omie já trouxe o campo de departamento? */
  departamentos_carregados?: boolean;
  departamentos_atualizado_em?: string | null;
};

export type LancamentoPlano = {
  data: string;
  vencimento: string | null;
  pagamento: string | null;
  titulo: string | null;
  documento: string | null;
  parcela: string | null;
  contraparte: string | null;
  cod_cliente: string | null;
  cnpj_cpf: string | null;
  categoria: string;
  grupo: string | null;
  status: string | null;
  origem: string | null;
  valor: number;
  cod_titulo: string | null;
  observacao: string | null;
  nota: string | null;
  /** distribuição por departamento no Omie; null = sem departamento */
  departamentos?: { codigo: string; pct: number }[] | null;
  /** o valor na parte do departamento filtrado (igual a `valor` sem filtro) */
  valor_departamento?: number;
};

export type AlteracaoCategoria = {
  criado_em: string;
  cod_titulo: string | null;
  contraparte: string | null;
  data: string | null;
  valor: number | null;
  categoria_de: string | null;
  descricao_de: string | null;
  categoria_para: string | null;
  descricao_para: string | null;
  motivo: string | null;
  origem: string | null;
  por: string | null;
};

/** Um alerta de reclassificação ABERTO entre os lançamentos (`omie_reclassificacoes`). */
export type SuspeitoReclassificacao = {
  id: string;
  cod_titulo: string;
  /** chave da demonstração, "Aug-26" */
  mes: string;
  /** onde caiu agora */
  rubrica: string;
  /** onde o fornecedor vinha caindo */
  rubrica_padrao: string | null;
  fornecedor: string | null;
  valor: number;
  valor_padrao: number | null;
  severidade: "alta" | "media" | "baixa";
  hist_lancamentos: number | null;
  hist_no_padrao: number | null;
};

export type LancamentosPlano = {
  codigo: string;
  base: Base;
  de: string;
  ate: string;
  ocultos: number;
  lancamentos: LancamentoPlano[];
  alteracoes: AlteracaoCategoria[];
  suspeitos?: SuspeitoReclassificacao[];
};

/* ───────────────────────────── Meses ───────────────────────────── */

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-08" + 1 → "2026-09". Aritmética de inteiro: `Date` em fuso local erra na virada. */
export function somarMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + delta;
  const ano = Math.floor(total / 12);
  return `${ano}-${String((total % 12 + 12) % 12 + 1).padStart(2, "0")}`;
}

/** Todos os meses de `de` a `ate`, inclusive. Vazio se `de` vem depois. */
export function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let m = de; m <= ate && out.length < 600; m = somarMes(m, 1)) out.push(m);
  return out;
}

/** "2026-08" → "ago/26" */
export function rotuloMes(mes: string): string {
  const [a, m] = mes.split("-");
  return `${MES_CURTO[Number(m) - 1] ?? m}/${a.slice(2)}`;
}

/** "2026-02" → "2026-02-28". UTC para a virada de mês não depender do fuso. */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** "2026-08-10" (ou um timestamp ISO) → "10/08/26" */
export const dataCurta = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—";

/** "ago/26" ou "jun–ago/26" ou "dez/25–fev/26". */
export function rotuloPeriodo(meses: string[]): string {
  if (!meses.length) return "";
  const [p, u] = [meses[0], meses[meses.length - 1]];
  if (p === u) return rotuloMes(p);
  if (p.slice(0, 4) === u.slice(0, 4)) return `${MES_CURTO[Number(p.slice(5)) - 1]}–${rotuloMes(u)}`;
  return `${rotuloMes(p)}–${rotuloMes(u)}`;
}

export type Periodo = "mes" | "3m" | "6m" | "ano";

export const PERIODOS: { valor: Periodo; label: string }[] = [
  { valor: "mes", label: "Mês" },
  { valor: "3m", label: "3 meses" },
  { valor: "6m", label: "6 meses" },
  { valor: "ano", label: "No ano" },
];

/**
 * Os meses do período, sempre terminando no último mês FECHADO.
 *
 * O mês corrente fica fora de propósito: no dia 14 ele tem metade dos títulos, e
 * uma média ou uma variação com ele dentro acusaria queda em toda categoria. O
 * gráfico mostra o mês corrente — marcado como em andamento —, a conta não.
 */
export function mesesDoPeriodo(periodo: Periodo, hoje: string): string[] {
  const fechado = somarMes(hoje.slice(0, 7), -1);
  switch (periodo) {
    case "mes": return [fechado];
    case "3m": return mesesEntre(somarMes(fechado, -2), fechado);
    case "6m": return mesesEntre(somarMes(fechado, -5), fechado);
    case "ano": return mesesEntre(`${fechado.slice(0, 4)}-01`, fechado);
  }
}

/**
 * Com o que o período se compara. "No ano" compara com os mesmos meses do ano
 * anterior (jan–ago contra jan–ago); os outros, com a janela do mesmo tamanho
 * imediatamente antes (jun–ago contra mar–mai).
 */
export function periodoAnterior(periodo: Periodo, meses: string[]): string[] {
  if (!meses.length) return [];
  if (periodo === "ano") return meses.map((m) => somarMes(m, -12));
  return meses.map((m) => somarMes(m, -meses.length));
}

/**
 * O primeiro mês em que o Omie tem volume de verdade.
 *
 * O cache traz um punhado de títulos de 2025 (quatro em mai/25, onze em nov/25) e
 * só em abr/26 passa de mil por mês. Comparar com um trimestre que está antes
 * disso poria "novo" e "+900%" em tudo — então a comparação só vale quando o
 * período anterior inteiro está a partir deste mês. Critério: o primeiro mês com
 * pelo menos 20% dos lançamentos do mês mais cheio.
 */
export function inicioDosDados(mensal: CelulaMensal[], ate?: string): string | null {
  const porMes = new Map<string, number>();
  for (const [, mes, , n] of mensal) {
    if (ate && mes > ate) continue;
    porMes.set(mes, (porMes.get(mes) ?? 0) + n);
  }
  if (!porMes.size) return null;
  const max = Math.max(...porMes.values());
  return [...porMes.keys()].sort().find((m) => (porMes.get(m) ?? 0) >= max * 0.2) ?? null;
}

/** A comparação só é justa se o período anterior inteiro tem dado. */
export function temBase(anteriores: string[], inicio: string | null): boolean {
  return !!inicio && anteriores.length > 0 && anteriores[0] >= inicio;
}

/* ───────────────────────────── Árvore ───────────────────────────── */

/** Despesa se o Omie diz; sem flag nenhuma (os totalizadores de transferência), pelo código. */
export function ehDespesa(c: Pick<CategoriaPlano, "codigo" | "despesa" | "receita">): boolean {
  if (c.despesa !== c.receita) return c.despesa;
  return c.codigo.startsWith("2");
}

/** O valor no sentido de leitura: despesa em módulo, receita como veio. */
export const noSentido = (despesa: boolean, valor: number) => (despesa ? -valor : valor);

export type Estatistica = {
  /** soma no período, no sentido de leitura */
  total: number;
  /** soma no período anterior; null quando não há base para comparar */
  anterior: number | null;
  /** fração (0,25 = +25%); null sem base ou com anterior zero */
  variacao: number | null;
  lancamentos: number;
  /** um valor por mês de `serieMeses`, no sentido de leitura */
  serie: number[];
};

export type NoPlano = {
  codigo: string;
  descricao: string;
  categoria: CategoriaPlano | null;
  despesa: boolean;
  filhos: NoPlano[];
  stats: Estatistica;
};

export type Secao = { chave: string; titulo: string; despesa: boolean; grupos: NoPlano[]; stats: Estatistica };

const TITULO_SECAO: Record<string, string> = { "0": "Transferências", "1": "Receitas", "2": "Despesas" };

export type Recorte = {
  meses: string[];
  anteriores: string[];
  comBase: boolean;
  /** os meses do gráfico — do início dos dados até o mês corrente */
  serieMeses: string[];
};

export function montarRecorte(resumo: Pick<ResumoPlano, "hoje" | "mensal">, periodo: Periodo): Recorte {
  const meses = mesesDoPeriodo(periodo, resumo.hoje);
  const anteriores = periodoAnterior(periodo, meses);
  const fechado = meses[meses.length - 1];
  const inicio = inicioDosDados(resumo.mensal, fechado);
  const atual = resumo.hoje.slice(0, 7);
  const primeiro = [inicio ?? meses[0], meses[0]].sort()[0];
  return {
    meses,
    anteriores,
    comBase: temBase(anteriores, inicio),
    serieMeses: mesesEntre(primeiro, atual),
  };
}

type Indice = Map<string, Map<string, { v: number; n: number }>>;

function acumular(idx: Indice, chave: string, mes: string, v: number, n: number) {
  let porMes = idx.get(chave);
  if (!porMes) idx.set(chave, (porMes = new Map()));
  const atual = porMes.get(mes);
  porMes.set(mes, { v: (atual?.v ?? 0) + Number(v), n: (atual?.n ?? 0) + Number(n) });
}

function indexar(mensal: CelulaMensal[]): Indice {
  const idx: Indice = new Map();
  for (const [codigo, mes, v, n] of mensal) acumular(idx, codigo, mes, v, n);
  return idx;
}

function estatistica(codigos: string[], despesa: boolean, idx: Indice, r: Recorte): Estatistica {
  const soma = (meses: string[]) => {
    let v = 0, n = 0;
    for (const c of codigos) {
      const pm = idx.get(c);
      if (!pm) continue;
      for (const m of meses) {
        const cel = pm.get(m);
        if (cel) { v += cel.v; n += cel.n; }
      }
    }
    return { v: noSentido(despesa, v), n };
  };
  const agora = soma(r.meses);
  const antes = r.comBase ? soma(r.anteriores).v : null;
  return {
    total: arred(agora.v),
    anterior: antes === null ? null : arred(antes),
    variacao: variacao(agora.v, antes),
    lancamentos: agora.n,
    serie: r.serieMeses.map((m) => arred(soma([m]).v)),
  };
}

// `|| 0` tira o -0: despesa zerada lida em módulo vira -0, e -0 vaza para a tela como "-R$ 0".
const arred = (v: number) => Math.round(v * 100) / 100 || 0;

/** null quando não há base ou a base é zero — "de zero para X" não é porcentagem. */
export function variacao(atual: number, anterior: number | null): number | null {
  if (anterior === null || Math.abs(anterior) < 0.005) return null;
  return (atual - anterior) / Math.abs(anterior);
}

/**
 * Seção (Receitas/Despesas/Transferências) → grupo totalizador → categoria.
 *
 * Uma categoria-folha cujo superior não existe no cadastro vai para um grupo
 * "Sem grupo" da seção, em vez de sumir: no plano de contas o que some é
 * dinheiro que ninguém vê.
 */
export function montarArvore(resumo: ResumoPlano, r: Recorte): Secao[] {
  const idx = indexar(resumo.mensal);
  const porCodigo = new Map(resumo.categorias.map((c) => [c.codigo, c]));
  const folhas = resumo.categorias.filter((c) => !c.totalizadora);

  // Código com movimento que não está no cadastro (categoria apagada no Omie).
  const orfaos = [...idx.keys()].filter((c) => !porCodigo.has(c));

  const secoes = new Map<string, Secao>();
  const secao = (chave: string) => {
    let s = secoes.get(chave);
    if (!s) {
      s = { chave, titulo: TITULO_SECAO[chave] ?? `Seção ${chave}`, despesa: chave === "2", grupos: [], stats: vazio(r) };
      secoes.set(chave, s);
    }
    return s;
  };

  const grupos = new Map<string, NoPlano>();
  const grupo = (codigo: string, secaoChave: string): NoPlano => {
    let g = grupos.get(codigo);
    if (!g) {
      const cat = porCodigo.get(codigo) ?? null;
      g = {
        codigo,
        descricao: cat?.descricao ?? "Sem grupo",
        categoria: cat,
        despesa: secaoChave === "2",
        filhos: [],
        stats: vazio(r),
      };
      grupos.set(codigo, g);
      secao(secaoChave).grupos.push(g);
    }
    return g;
  };

  for (const c of folhas) {
    const sec = c.codigo.split(".")[0];
    const sup = c.superior && porCodigo.has(c.superior) ? c.superior : `${sec}.?`;
    const despesa = ehDespesa(c);
    grupo(sup, sec).filhos.push({
      codigo: c.codigo, descricao: c.descricao, categoria: c, despesa, filhos: [],
      stats: estatistica([c.codigo], despesa, idx, r),
    });
  }
  for (const codigo of orfaos) {
    const sec = codigo.split(".")[0];
    const despesa = sec === "2";
    grupo(`${sec}.?`, sec).filhos.push({
      codigo, descricao: `Categoria ${codigo} (fora do cadastro)`, categoria: null, despesa, filhos: [],
      stats: estatistica([codigo], despesa, idx, r),
    });
  }

  for (const g of grupos.values()) {
    g.filhos.sort((a, b) => a.codigo.localeCompare(b.codigo));
    g.stats = somarStats(g.filhos.map((f) => ({ stats: f.stats, despesa: f.despesa })), g.despesa, r);
  }
  for (const s of secoes.values()) {
    s.grupos.sort((a, b) => a.codigo.localeCompare(b.codigo));
    s.stats = somarStats(s.grupos.map((g) => ({ stats: g.stats, despesa: g.despesa })), s.despesa, r);
  }
  return [...secoes.values()].sort((a, b) => ordemSecao(a.chave) - ordemSecao(b.chave));
}

/* Receitas e despesas primeiro; transferência entre contas próprias por último — é
   o que menos se analisa e o que mais infla. */
const ordemSecao = (k: string) => ({ "1": 0, "2": 1, "0": 2 } as Record<string, number>)[k] ?? 3;

function vazio(r: Recorte): Estatistica {
  return { total: 0, anterior: r.comBase ? 0 : null, variacao: null, lancamentos: 0, serie: r.serieMeses.map(() => 0) };
}

/** Soma filhos que podem ter sentidos diferentes: volta ao sinal do Omie e reaplica o do pai. */
function somarStats(itens: { stats: Estatistica; despesa: boolean }[], despesa: boolean, r: Recorte): Estatistica {
  // `noSentido` é a própria inversa: aplicado de novo, devolve o sinal do Omie.
  let total = 0, anterior = 0, n = 0;
  const serie = r.serieMeses.map(() => 0);
  for (const { stats, despesa: d } of itens) {
    total += noSentido(d, stats.total);
    anterior += noSentido(d, stats.anterior ?? 0);
    n += stats.lancamentos;
    stats.serie.forEach((v, i) => { serie[i] += noSentido(d, v); });
  }
  const t = noSentido(despesa, total);
  const a = r.comBase ? noSentido(despesa, anterior) : null;
  return {
    total: arred(t),
    anterior: a === null ? null : arred(a),
    variacao: variacao(t, a),
    lancamentos: n,
    serie: serie.map((v) => arred(noSentido(despesa, v))),
  };
}

/* ───────────────────────────── Situação no cadastro ───────────────────────────── */

/**
 * O que a árvore mostra. A primeira versão tinha uma caixinha "mostrar sem
 * movimento" desligada por padrão — e as 29 inativas, as 14 posições livres e as
 * 33 nunca usadas sumiam sem a tela dizer que existiam. Agora cada situação tem
 * nome e contagem.
 *
 * `movimento` vence as outras: uma categoria INATIVA com lançamento no período
 * aparece em "Com movimento" (com o sinal de inativa), porque é justamente a que
 * precisa ser vista.
 */
export type SituacaoCadastro = "movimento" | "parada" | "nunca_usada" | "inativa";
export type FiltroArvore = "movimento" | "sem_movimento" | "inativas" | "todas";

export const FILTROS_ARVORE: { valor: FiltroArvore; label: string; dica: string }[] = [
  { valor: "movimento", label: "Com movimento", dica: "Tiveram lançamento na janela do gráfico" },
  { valor: "sem_movimento", label: "Sem movimento", dica: "Ativas no Omie, sem lançamento na janela — inclui as nunca usadas" },
  { valor: "inativas", label: "Inativas", dica: "Desativadas no Omie, incluindo as posições <Disponível>" },
  { valor: "todas", label: "Todas", dica: "O plano de contas inteiro do Omie" },
];

export function situacaoCadastro(no: NoPlano): SituacaoCadastro {
  const temMovimento = Math.abs(no.stats.total) >= 0.005
    || Math.abs(no.stats.anterior ?? 0) >= 0.005
    || no.stats.serie.some((v) => Math.abs(v) >= 0.005)
    || no.stats.lancamentos > 0;
  if (temMovimento || !no.categoria) return "movimento";
  if (no.categoria.inativa) return "inativa";
  return (no.categoria.usos ?? 0) === 0 ? "nunca_usada" : "parada";
}

export function passaNoFiltro(no: NoPlano, filtro: FiltroArvore): boolean {
  const s = situacaoCadastro(no);
  switch (filtro) {
    case "movimento": return s === "movimento";
    case "sem_movimento": return s === "parada" || s === "nunca_usada";
    case "inativas": return s === "inativa" || (!!no.categoria?.inativa && s === "movimento");
    case "todas": return true;
  }
}

export function contarFiltros(folhas: NoPlano[]): Record<FiltroArvore, number> {
  const out: Record<FiltroArvore, number> = { movimento: 0, sem_movimento: 0, inativas: 0, todas: folhas.length };
  for (const f of folhas) {
    if (passaNoFiltro(f, "movimento")) out.movimento++;
    if (passaNoFiltro(f, "sem_movimento")) out.sem_movimento++;
    if (passaNoFiltro(f, "inativas")) out.inativas++;
  }
  return out;
}

/**
 * A rubrica que as categorias irmãs mais usam — o palpite inicial do DE-PARA de uma
 * categoria nova. Só palpite: a pessoa vê e troca antes de criar.
 */
export function rubricaDasIrmas(categorias: CategoriaPlano[], superior: string, base: "dre" | "dfc"): string | null {
  const votos = new Map<string, number>();
  for (const c of categorias) {
    if (c.superior !== superior || c.totalizadora || c.inativa) continue;
    const r = base === "dre" ? c.rubrica_dre : c.rubrica_dfc;
    if (!r) continue;
    votos.set(r, (votos.get(r) ?? 0) + Math.max(1, c.usos ?? 0));
  }
  return [...votos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** Todos os nós navegáveis, achatados — para a busca e para achar o selecionado. */
export function nosDaArvore(secoes: Secao[]): NoPlano[] {
  return secoes.flatMap((s) => s.grupos.flatMap((g) => [g, ...g.filhos]));
}

/* ───────────────────────────── Departamentos ───────────────────────────── */

/*
 * Departamento é a distribuição do título no Omie. Medido em 15/09/2026 (conta
 * Sicoob, ago/26): 28% dos títulos têm, sempre um departamento a 100%, e NENHUMA
 * conta a receber tem. Por isso a visão por departamento olha só as DESPESAS
 * (seção 2) — com receita dentro, "Sem departamento" seria quase só faturamento e
 * a cobertura pareceria menor do que é para o que de fato tem dono.
 */

export type LinhaDepartamento = {
  codigo: string;
  descricao: string;
  inativo: boolean;
  /** quantas categorias de despesa tiveram valor neste departamento na janela */
  categorias: number;
  stats: Estatistica;
};

export type LinhaDepartamentoDaCategoria = {
  codigo: string;
  descricao: string;
  total: number;
  anterior: number | null;
  variacao: number | null;
  participacao: number;
};

const nomesDepartamento = (resumo: Pick<ResumoPlano, "departamentos">) =>
  new Map((resumo.departamentos ?? []).map((d) => [d.codigo, d]));

export function nomeDoDepartamento(nomes: Map<string, DepartamentoOmie>, codigo: string): string {
  if (codigo === SEM_DEPARTAMENTO) return "Sem departamento";
  return nomes.get(codigo)?.descricao ?? `Departamento ${codigo}`;
}

/** "Sem departamento" sempre por último; o resto do maior para o menor. */
const ordemDepartamento = (a: { codigo: string; total: number }, b: { codigo: string; total: number }) =>
  (a.codigo === SEM_DEPARTAMENTO ? 1 : 0) - (b.codigo === SEM_DEPARTAMENTO ? 1 : 0) || Math.abs(b.total) - Math.abs(a.total);

const temValor = (s: { total: number; anterior: number | null }) =>
  Math.abs(s.total) >= 0.005 || Math.abs(s.anterior ?? 0) >= 0.005;

/**
 * Os departamentos, com o valor das despesas de cada um. Departamento cadastrado
 * no Omie e sem lançamento na janela também entra, zerado — a lista é a do Omie.
 */
export function montarDepartamentos(resumo: ResumoPlano, r: Recorte): LinhaDepartamento[] {
  const idx: Indice = new Map();
  const cats = new Map<string, Set<string>>();
  for (const [cat, dep, mes, v, n] of resumo.mensal_dep ?? []) {
    if (!cat.startsWith("2")) continue;
    const k = dep ?? SEM_DEPARTAMENTO;
    acumular(idx, k, mes, v, n);
    let s = cats.get(k);
    if (!s) cats.set(k, (s = new Set()));
    if (Math.abs(Number(v)) >= 0.005 && r.meses.includes(mes)) s.add(cat);
  }
  const nomes = nomesDepartamento(resumo);
  for (const d of resumo.departamentos ?? []) if (!idx.has(d.codigo)) idx.set(d.codigo, new Map());

  return [...idx.keys()]
    .map((k) => ({
      codigo: k,
      descricao: nomeDoDepartamento(nomes, k),
      inativo: nomes.get(k)?.inativo ?? false,
      categorias: cats.get(k)?.size ?? 0,
      stats: estatistica([k], true, idx, r),
    }))
    .sort((a, b) => ordemDepartamento({ codigo: a.codigo, total: a.stats.total }, { codigo: b.codigo, total: b.stats.total }));
}

/** De que categorias de despesa um departamento é feito. */
export function categoriasDoDepartamento(resumo: ResumoPlano, r: Recorte, departamento: string): NoPlano[] {
  const idx: Indice = new Map();
  for (const [cat, dep, mes, v, n] of resumo.mensal_dep ?? []) {
    if (!cat.startsWith("2") || (dep ?? SEM_DEPARTAMENTO) !== departamento) continue;
    acumular(idx, cat, mes, v, n);
  }
  const porCodigo = new Map(resumo.categorias.map((c) => [c.codigo, c]));
  return [...idx.keys()]
    .map((codigo) => ({
      codigo,
      descricao: porCodigo.get(codigo)?.descricao ?? `Categoria ${codigo}`,
      categoria: porCodigo.get(codigo) ?? null,
      despesa: true,
      filhos: [],
      stats: estatistica([codigo], true, idx, r),
    }))
    .filter((c) => temValor(c.stats))
    .sort((a, b) => Math.abs(b.stats.total) - Math.abs(a.stats.total));
}

/** Como uma categoria (ou as categorias de um grupo) se divide entre departamentos. */
export function departamentosDaCategoria(
  resumo: ResumoPlano,
  r: Recorte,
  codigos: string[],
  despesa: boolean,
): LinhaDepartamentoDaCategoria[] {
  const alvo = new Set(codigos);
  const idx: Indice = new Map();
  for (const [cat, dep, mes, v, n] of resumo.mensal_dep ?? []) {
    if (alvo.has(cat)) acumular(idx, dep ?? SEM_DEPARTAMENTO, mes, v, n);
  }
  const nomes = nomesDepartamento(resumo);
  const linhas = [...idx.keys()]
    .map((k) => {
      const s = estatistica([k], despesa, idx, r);
      return { codigo: k, descricao: nomeDoDepartamento(nomes, k), total: s.total, anterior: s.anterior, variacao: s.variacao };
    })
    .filter(temValor);
  const total = linhas.reduce((s, l) => s + l.total, 0);
  return linhas
    .map((l) => ({ ...l, participacao: Math.abs(total) >= 0.005 ? l.total / total : 0 }))
    .sort(ordemDepartamento);
}

/** Fração do valor que tem departamento no Omie. null quando não há valor. */
export function coberturaDepartamento(linhas: { codigo: string; total: number }[]): number | null {
  const total = linhas.reduce((s, l) => s + l.total, 0);
  if (Math.abs(total) < 0.005) return null;
  return linhas.filter((l) => l.codigo !== SEM_DEPARTAMENTO).reduce((s, l) => s + l.total, 0) / total;
}

/* ───────────────────────────── Nome na tela ───────────────────────────── */

export type RotuloLancamento = { nome: string; cru: string | null; cartao: boolean; detalhe: string | null };

/**
 * O nome que a pessoa reconhece: no cartão, o lojista lido da observação do título
 * (a contraparte é sempre "Lancamento Fatura Cartao"); nos outros, o apelido da
 * Parametrização. O nome cru fica na linha de apoio — é o que se procura no Omie.
 */
export function rotularLancamento(
  l: Pick<LancamentoPlano, "contraparte" | "observacao" | "cnpj_cpf">,
  mapa: MapaApelidos | null | undefined,
): RotuloLancamento {
  const gasto = lerGastoDeCartao(l.contraparte, l.observacao);
  const cru = gasto?.estabelecimento ?? l.contraparte ?? null;
  const nome = cru ? nomeExibido(mapa, cru, gasto ? null : l.cnpj_cpf) || cru : "Sem contraparte";
  return { nome, cru: l.contraparte, cartao: !!gasto, detalhe: gasto?.detalhe ?? null };
}

/* ───────────────────────────── Concentração ───────────────────────────── */

export type Situacao = "novo" | "sumiu" | "subiu" | "caiu" | "estavel";

export type LinhaContraparte = {
  nome: string;
  total: number;
  lancamentos: number;
  /** fração do total do período */
  participacao: number;
  /** participação acumulada até esta linha (curva de Pareto) */
  acumulado: number;
  /** em quantos meses do período apareceu */
  mesesPresente: number;
  anterior: number | null;
  situacao: Situacao | null;
};

/**
 * Quem recebe (ou paga) esta categoria no período, do maior para o menor, com o
 * período anterior ao lado — incluindo quem SUMIU, que não tem linha no período
 * e pode explicar metade de uma queda.
 *
 * A chave é o nome já resolvido pela tela (apelido, lojista do cartão). Nada de
 * juntar por semelhança: é a mesma decisão do drill-down da DRE.
 */
export function concentracao(
  lancamentos: LancamentoPlano[],
  nomeDe: (l: LancamentoPlano) => string,
  despesa: boolean,
  meses: string[],
  anteriores: string[] | null,
): LinhaContraparte[] {
  const noPeriodo = new Set(meses);
  const antes = new Set(anteriores ?? []);
  type Acc = { nome: string; total: number; n: number; meses: Set<string>; anterior: number };
  const acc = new Map<string, Acc>();

  for (const l of lancamentos) {
    const mes = l.data.slice(0, 7);
    const dentro = noPeriodo.has(mes);
    const antesDele = antes.has(mes);
    if (!dentro && !antesDele) continue;
    const nome = nomeDe(l).trim() || "Sem contraparte";
    const chave = nome.toLocaleLowerCase("pt-BR");
    let a = acc.get(chave);
    if (!a) acc.set(chave, (a = { nome, total: 0, n: 0, meses: new Set(), anterior: 0 }));
    const v = noSentido(despesa, Number(l.valor));
    if (dentro) { a.total += v; a.n += 1; a.meses.add(mes); } else { a.anterior += v; }
  }

  const linhas = [...acc.values()].filter((a) => a.n > 0 || (anteriores && Math.abs(a.anterior) >= 0.005));
  const total = linhas.reduce((s, a) => s + a.total, 0);
  linhas.sort((x, y) => Math.abs(y.total) - Math.abs(x.total) || Math.abs(y.anterior) - Math.abs(x.anterior));

  let corrido = 0;
  return linhas.map((a) => {
    corrido += a.total;
    const anterior = anteriores ? arred(a.anterior) : null;
    return {
      nome: a.nome,
      total: arred(a.total),
      lancamentos: a.n,
      participacao: Math.abs(total) > 0.005 ? a.total / total : 0,
      acumulado: Math.abs(total) > 0.005 ? corrido / total : 0,
      mesesPresente: a.meses.size,
      anterior,
      situacao: anteriores ? situacaoDe(a.total, a.n, anterior ?? 0) : null,
    };
  });
}

/** ±10% é "estável": abaixo disso a variação é ruído de dia de vencimento. */
function situacaoDe(total: number, n: number, anterior: number): Situacao {
  if (n === 0) return "sumiu";
  if (Math.abs(anterior) < 0.005) return "novo";
  const d = (total - anterior) / Math.abs(anterior);
  if (d > 0.1) return "subiu";
  if (d < -0.1) return "caiu";
  return "estavel";
}

/** Status do título no período: quanto já saiu (ou entrou) e quanto está em aberto. */
export function porStatus(lancamentos: LancamentoPlano[], despesa: boolean, meses: string[]) {
  const noPeriodo = new Set(meses);
  const acc = new Map<string, { status: string; total: number; n: number }>();
  for (const l of lancamentos) {
    if (!noPeriodo.has(l.data.slice(0, 7))) continue;
    const status = l.status ?? "SEM STATUS";
    const a = acc.get(status) ?? { status, total: 0, n: 0 };
    a.total += noSentido(despesa, Number(l.valor));
    a.n += 1;
    acc.set(status, a);
  }
  return [...acc.values()].map((a) => ({ ...a, total: arred(a.total) })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/* ───────────────────────────── Sinais ───────────────────────────── */

export type Sinal = {
  tipo: "sem_de_para" | "inativa_com_movimento" | "concentrada" | "variacao" | "generica" | "pulverizada";
  gravidade: "atencao" | "info";
  texto: string;
};

const GENERICA = /\b(outros?|outras|diversos?|geral|avulsos?|demais)\b/i;

/**
 * O que salta desta categoria — escrito por regra, não por IA.
 *
 * Cada sinal tem um limiar explícito e um teste. É a base determinística em cima da
 * qual uma sugestão de segregação ou de categoria nova pode ser redigida depois:
 * o padrão do repo é "a banda decide, a IA só redige" (ver Cartão e o sino).
 */
export function sinaisDaCategoria(
  no: NoPlano,
  base: Base,
  contrapartes: LinhaContraparte[] | null,
  fmt: (v: number) => string,
  /** o financeiro marcou que a categoria fica fora desta demonstração de propósito */
  foraDeProposito = false,
): Sinal[] {
  const out: Sinal[] = [];
  const c = no.categoria;
  const { total, variacao: vari, anterior } = no.stats;
  const temValor = Math.abs(total) >= 0.005;

  if (c && !c.totalizadora && temValor) {
    const rubrica = base === "competencia" ? c.rubrica_dre : c.rubrica_dfc;
    if (!rubrica && !foraDeProposito) {
      out.push({
        tipo: "sem_de_para", gravidade: "atencao",
        texto: `Fora do DE-PARA da ${base === "competencia" ? "DRE" : "DFC"}: ${fmt(total)} no período não aparecem na demonstração.`,
      });
    }
    if (c.inativa) {
      out.push({
        tipo: "inativa_com_movimento", gravidade: "atencao",
        texto: `Inativa no Omie, mas recebeu ${no.stats.lancamentos} lançamento(s) no período.`,
      });
    }
  }

  if (vari !== null && anterior !== null && Math.abs(vari) >= 0.3 && Math.abs(total - anterior) >= 1000) {
    out.push({
      tipo: "variacao", gravidade: Math.abs(vari) >= 0.6 ? "atencao" : "info",
      texto: `${vari > 0 ? "Subiu" : "Caiu"} ${Math.abs(Math.round(vari * 100))}% contra o período anterior (${fmt(anterior)} → ${fmt(total)}).`,
    });
  }

  if (contrapartes && contrapartes.length) {
    const ativas = contrapartes.filter((l) => l.lancamentos > 0);
    const top = ativas[0];
    if (top && ativas.length >= 3 && top.participacao >= 0.6) {
      out.push({
        tipo: "concentrada", gravidade: "info",
        texto: `${top.nome} é ${Math.round(top.participacao * 100)}% da categoria — as outras ${ativas.length - 1} contrapartes dividem o resto.`,
      });
    }
    // Muita gente diferente numa categoria só: é o formato de quem pede segregação.
    const oitenta = ativas.findIndex((l) => l.acumulado >= 0.8) + 1;
    if (ativas.length >= 15 && oitenta >= 8) {
      out.push({
        tipo: "pulverizada", gravidade: "info",
        texto: `${ativas.length} contrapartes; são precisas ${oitenta} para chegar a 80% do valor. Categoria larga — vale ver se não são coisas diferentes juntas.`,
      });
    }
  }

  if (c && !c.totalizadora && temValor && GENERICA.test(c.descricao)) {
    out.push({
      tipo: "generica", gravidade: "info",
      texto: `Categoria de nome genérico com ${fmt(total)} no período — candidata a ser separada pelo que de fato é.`,
    });
  }

  return out;
}
