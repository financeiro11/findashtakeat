import type { Candidato } from "@/lib/apelidos";
import { MESES_CURTOS } from "@/lib/apelidos";

/* ============================================================================
 * Filtrar a fila de contrapartes pelos campos que estão no cabeçalho.
 *
 * A fila abre com ~330 linhas e a ordem dela responde a UMA pergunta: "por onde
 * começar". Toda outra pergunta é um corte — "só o que caiu em Softwares", "só
 * quem passou de R$ 5 mil", "só o que apareceu em julho", "só o que a planilha
 * já respondeu". Sem os cortes a resposta é rolar a lista inteira com o olho.
 *
 * TRÊS DECISÕES QUE VALEM O ARQUIVO:
 *
 * 1. O FILTRO CORTA A LISTA, NUNCA A COBERTURA. É o oposto da janela de tempo
 *    (migration 20260813150000), e a diferença é de propósito: a janela diz
 *    QUAL DINHEIRO ESTÁ SENDO COBRADO, então ela entra na RPC e muda o
 *    denominador; o filtro de coluna é lupa de quem está trabalhando a lista.
 *    Se ele mexesse na barra, marcar uma categoria faria a cobertura "subir"
 *    para 90% sem ninguém ter nomeado nada — número que mente na reunião
 *    seguinte. Quem for "consertar" isso um dia: é intencional, e a tela diz
 *    isso em voz alta na barra de status.
 *
 * 2. PERÍODO CASA POR SOBREPOSIÇÃO, NÃO POR CONTENÇÃO. A contraparte não tem
 *    uma data, tem um intervalo (`primeira`..`ultima`). Quem filtra "julho"
 *    quer quem apareceu em julho — inclusive o fornecedor de mai–jul, que é o
 *    recorrente e justamente o que mais interessa. Exigir o intervalo INTEIRO
 *    dentro do corte devolveria só quem nasceu e morreu no mês.
 *
 * 3. "SEM CATEGORIA" É UM BALDE FILTRÁVEL, não um buraco. Contraparte sem
 *    categoria é candidata de primeira classe a precisar de nome — deixá-la
 *    fora da lista de opções esconderia exatamente quem se procura.
 *
 * Puro de propósito: dá para testar sem React e sem Supabase.
 * ========================================================================== */

/** O que a coluna "O que a planilha diz" tem para esta contraparte. */
export type EstadoPlanilha =
  /** a planilha propôs um nome — é só conferir e aceitar */
  | "proposta"
  /** a planilha conhece a contraparte mas não deu nome a ela */
  | "sem_nome"
  /** nenhuma das quatro planilhas falou desta contraparte */
  | "nada";

export const ROTULO_ESTADO_PLANILHA: Record<EstadoPlanilha, string> = {
  proposta: "Com proposta",
  sem_nome: "Planilha não soube",
  nada: "Nada da planilha",
};

export type FiltroFila = {
  /** Categorias marcadas. Vazio = todas (e não "nenhuma"). */
  categorias: Set<string>;
  /** Estados marcados. Vazio = todos. */
  planilha: Set<EstadoPlanilha>;
  lctosMin: number | null;
  lctosMax: number | null;
  totalMin: number | null;
  totalMax: number | null;
  /** "2026-05" — o mês, não o dia: é assim que a coluna Período está escrita. */
  mesDe: string | null;
  mesAte: string | null;
};

/**
 * O estado de partida.
 *
 * É função, e não constante, pelo mesmo motivo de `filtroInicial` em
 * `filtroLancamentos.ts`: um `Set` de módulo seria o MESMO objeto em toda
 * montagem da tela, e bastaria alguém marcar uma categoria sem copiar o
 * conjunto para a próxima visita abrir já filtrada.
 */
export const filtroFilaInicial = (): FiltroFila => ({
  categorias: new Set(),
  planilha: new Set(),
  lctosMin: null,
  lctosMax: null,
  totalMin: null,
  totalMax: null,
  mesDe: null,
  mesAte: null,
});

/** As colunas que têm filtro. A de Contraparte não tem: a busca lá em cima é dela. */
export type ColunaFila = "categoria" | "lancamentos" | "total" | "periodo" | "planilha";

/** Esta coluna está cortando alguma coisa? É o que acende o funil no cabeçalho. */
export function colunaFiltrada(f: FiltroFila, coluna: ColunaFila): boolean {
  switch (coluna) {
    case "categoria": return f.categorias.size > 0;
    case "planilha": return f.planilha.size > 0;
    case "lancamentos": return f.lctosMin !== null || f.lctosMax !== null;
    case "total": return f.totalMin !== null || f.totalMax !== null;
    case "periodo": return f.mesDe !== null || f.mesAte !== null;
  }
}

/** Quantas colunas estão cortando — 0 quer dizer "a lista está inteira". */
export function quantasColunasFiltradas(f: FiltroFila): number {
  const colunas: ColunaFila[] = ["categoria", "lancamentos", "total", "periodo", "planilha"];
  return colunas.filter((c) => colunaFiltrada(f, c)).length;
}

/** Zera só uma coluna — o "Limpar" de dentro de cada popover. */
export function limparColuna(f: FiltroFila, coluna: ColunaFila): FiltroFila {
  switch (coluna) {
    case "categoria": return { ...f, categorias: new Set() };
    case "planilha": return { ...f, planilha: new Set() };
    case "lancamentos": return { ...f, lctosMin: null, lctosMax: null };
    case "total": return { ...f, totalMin: null, totalMax: null };
    case "periodo": return { ...f, mesDe: null, mesAte: null };
  }
}

/** Marca/desmarca sem mexer no conjunto original — o React precisa do objeto novo. */
export function alternarNoSet<T extends string>(s: Set<T>, v: T): Set<T> {
  const n = new Set(s);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

/* -------------------------------------------------------------------------
 * Categoria
 * ---------------------------------------------------------------------- */

/** O balde de quem não tem categoria — filtrável como qualquer outra. */
export const SEM_CATEGORIA = "— sem categoria —";

/**
 * A categoria que a linha mostra.
 *
 * Nas linhas do Omie é a rubrica contábil ("3.1.5.1 Softwares - Tecnologia"),
 * que é o que se pede quando se pede "a categoria do Omie". Nas de cartão é a
 * categoria do próprio extrato ("Outros (diversos)"): o lojista do cartão não
 * vira título no Omie, então rubrica contábil ele não tem. A tela marca de qual
 * das duas se trata linha a linha — sem isso, "Outros (diversos)" ao lado de
 * "3.1.5.1 Softwares" parece um de-para malfeito.
 */
export const categoriaDaContraparte = (c: Candidato): string =>
  String(c?.categoria ?? "").trim() || SEM_CATEGORIA;

export type OpcaoCategoria = { valor: string; lancamentos: number; total: number };

/**
 * As categorias presentes na fila, da que mais pesa para a que menos pesa.
 *
 * Sai da fila INTEIRA, não da lista já filtrada: a lista de opções que encolhe
 * a cada marcação torna impossível marcar a segunda categoria.
 */
export function categoriasDaFila(fila: Candidato[]): OpcaoCategoria[] {
  const m = new Map<string, OpcaoCategoria>();
  for (const c of fila ?? []) {
    const valor = categoriaDaContraparte(c);
    let o = m.get(valor);
    if (!o) { o = { valor, lancamentos: 0, total: 0 }; m.set(valor, o); }
    o.lancamentos += Math.max(0, Number(c?.lancamentos) || 0);
    o.total += Math.max(0, Number(c?.total) || 0);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/* -------------------------------------------------------------------------
 * Período
 * ---------------------------------------------------------------------- */

/** "2026-07-14" -> "2026-07". A data vem do Postgres em ISO, então é prefixo. */
export const mesDaData = (d: string | null | undefined): string | null => {
  const s = String(d ?? "");
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
};

/** "2026-07" -> "jul 26". Tabela explícita pelo motivo comentado em `apelidos.ts`. */
export function rotuloMes(ym: string): string {
  const m = Number(String(ym ?? "").slice(5, 7));
  if (!(m >= 1 && m <= 12)) return String(ym ?? "");
  return `${MESES_CURTOS[m - 1].toLowerCase()} ${String(ym).slice(2, 4)}`;
}

/** Os meses que a fila toca, do mais antigo ao mais novo. */
export function mesesDaFila(fila: Candidato[]): string[] {
  const s = new Set<string>();
  for (const c of fila ?? []) {
    const a = mesDaData(c?.primeira);
    const b = mesDaData(c?.ultima);
    if (a) s.add(a);
    if (b) s.add(b);
  }
  return [...s].sort();
}

/* -------------------------------------------------------------------------
 * O corte
 * ---------------------------------------------------------------------- */

/** Dentro da faixa? Lado nulo é lado aberto. */
const naFaixa = (v: number, min: number | null, max: number | null): boolean =>
  (min === null || v >= min) && (max === null || v <= max);

/**
 * A fila cortada. `estado` diz o que a planilha tem para cada contraparte —
 * entra como função para este módulo não precisar conhecer `parametrizacao_evidencias`.
 */
export function filtrarFila(
  fila: Candidato[],
  f: FiltroFila,
  estado: (c: Candidato) => EstadoPlanilha,
): Candidato[] {
  return (fila ?? []).filter((c) => {
    if (f.categorias.size && !f.categorias.has(categoriaDaContraparte(c))) return false;
    if (f.planilha.size && !f.planilha.has(estado(c))) return false;
    if (!naFaixa(Math.max(0, Number(c?.lancamentos) || 0), f.lctosMin, f.lctosMax)) return false;
    if (!naFaixa(Math.max(0, Number(c?.total) || 0), f.totalMin, f.totalMax)) return false;

    if (f.mesDe !== null || f.mesAte !== null) {
      const ini = mesDaData(c?.primeira) ?? mesDaData(c?.ultima);
      const fim = mesDaData(c?.ultima) ?? mesDaData(c?.primeira);
      // Sem data legível não há como provar que caiu no corte — mesma regra que
      // a RPC usa para a janela, para as duas não discordarem sobre a linha.
      if (!ini || !fim) return false;
      // Sobreposição de intervalos: comparação de string funciona porque
      // "YYYY-MM" ordena igual à data.
      if (f.mesDe !== null && fim < f.mesDe) return false;
      if (f.mesAte !== null && ini > f.mesAte) return false;
    }

    return true;
  });
}

/**
 * "1.200,50", "1200.50" e "1200" viram 1200.5; vazio vira null.
 *
 * O campo é texto e não `<input type=number>` porque quem digita valor aqui
 * digita como lê na tela — com ponto de milhar. `Number("1.200")` daria 1,2 e o
 * filtro "acima de 1.200" esconderia a fila inteira sem dizer por quê.
 */
export function lerNumero(s: string): number | null {
  const t = String(s ?? "").trim().replace(/\s|R\$/g, "");
  if (!t) return null;
  // Com vírgula, ela é o decimal e o ponto é milhar. Sem vírgula, o ponto só é
  // milhar quando separa exatamente três dígitos ("1.200"), nunca em "1200.50".
  const limpo = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : t.replace(/\.(?=\d{3}(\D|$))/g, "");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}