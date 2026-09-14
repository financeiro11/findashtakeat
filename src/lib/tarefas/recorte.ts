/**
 * O recorte por trás de um número da Análise Semanal.
 *
 * Cada card daquela aba é uma agregação — "Tesouraria: 2 tarefas · lead 0.5d",
 * "Operacional 55%". O recorte é o filtro que reconstrói a lista que formou o
 * número: clicar em Tesouraria abre as tarefas de Tesouraria, e a soma delas
 * tem de bater com o que o card mostrava. É o mesmo contrato do painel de
 * lançamentos da DRE — quando as duas pontas batem, a lista está completa.
 *
 * Está aqui, fora do componente, porque é a única parte testável: o resto é
 * Sheet, Select e toast.
 */

/** Uma linha de `fn_tarefas_da_semana` — a MESMA base que o resumo agrega. */
export interface TarefaDaSemana {
  id: string;
  titulo: string;
  natureza: string | null;
  area: string | null;
  rotina: boolean;
  /** "manual" = alguém corrigiu na tela; o carimbo automático não encosta mais. */
  cat_origem: string;
  pessoa: string;
  prioridade: string;
  subtarefas: number;
  lead_dias: number;
  peso: number;
  /** A hora que conta: a apontada, ou a estimativa do board quando não há. */
  horas: number;
  /** O que alguém digitou. `null` = ninguém apontou, e aí `horas` é estimativa. */
  horas_apontadas: number | null;
  /** Estimativa do board: horas comerciais abertas menos a fração parada. */
  horas_board: number;
  horas_abertas: number;
  horas_paradas: number;
  familia: string;
}

/**
 * Por qual denominador a semana é lida.
 *
 * "tarefas" conta cards; "tempo" soma horas. Os dois discordam de propósito e é
 * essa discordância que interessa: sempre haverá mais tarefas operacionais — são
 * pequenas e voltam toda semana —, então contá-las só confirma o óbvio. A
 * pergunta que decide alguma coisa é quanto da semana sobrou para construir.
 */
export type Medida = "tarefas" | "tempo";

export type EixoRecorte =
  | "todas" | "rotina" | "natureza" | "area" | "pessoa" | "familia"
  | "lead" | "horas" | "peso";

export interface Recorte {
  eixo: EixoRecorte;
  /** O valor do eixo (a área, a pessoa, a natureza…). Nulo nos eixos que não filtram. */
  valor?: string | null;
  /** O que estava escrito no card clicado — vira o título do painel. */
  titulo: string;
  /** Id da tarefa a destacar, quando o clique veio de uma lista de topo. */
  destaque?: string | null;
}

/** Nulo, vazio e ausente são a mesma coisa quando se compara rótulo. */
function igual(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "") === (b ?? "");
}

export function pertenceAoRecorte(l: TarefaDaSemana, r: Recorte): boolean {
  switch (r.eixo) {
    case "rotina":   return l.rotina;
    case "natureza": return igual(l.natureza, r.valor);
    case "area":     return igual(l.area, r.valor);
    case "pessoa":   return igual(l.pessoa, r.valor);
    case "familia":  return igual(l.familia, r.valor);
    /* "todas", "lead", "horas" e "peso" não filtram nada: são a semana inteira
       vista por uma ordem diferente. O card de lead mediano abre a mesma lista
       do card de concluídas — o que muda é por onde ela começa. */
    default:         return true;
  }
}

/** A ordem que cada eixo pede. O desempate por título mantém a lista estável. */
export function ordenarRecorte(linhas: TarefaDaSemana[], eixo: EixoRecorte): TarefaDaSemana[] {
  const porTitulo = (a: TarefaDaSemana, b: TarefaDaSemana) => a.titulo.localeCompare(b.titulo, "pt-BR");
  return [...linhas].sort((a, b) => {
    if (eixo === "lead") return (b.lead_dias - a.lead_dias) || (b.horas - a.horas) || porTitulo(a, b);
    if (eixo === "peso") return (b.peso - a.peso) || (b.lead_dias - a.lead_dias) || porTitulo(a, b);
    return (b.horas - a.horas) || (b.peso - a.peso) || porTitulo(a, b);
  });
}

export function filtrarRecorte(linhas: TarefaDaSemana[], r: Recorte): TarefaDaSemana[] {
  return ordenarRecorte(linhas.filter((l) => pertenceAoRecorte(l, r)), r.eixo);
}

/**
 * A mediana que o Postgres calcula em `percentile_cont(0.5)` — com interpolação
 * entre os dois centrais quando a lista é par. Reimplementada igual de propósito:
 * se o painel arredondasse para o de baixo, ele mostraria 4d onde o card mostra
 * 4.5d e a conferência acusaria uma divergência que não existe.
 */
export function mediana(ns: number[]): number {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const meio = (s.length - 1) / 2;
  return (s[Math.floor(meio)] + s[Math.ceil(meio)]) / 2;
}

export interface ResumoRecorte {
  n: number;
  horas: number;
  peso: number;
  rotinas: number;
  leadMediana: number;
  /** Quantas das linhas têm hora apontada por gente — o resto é estimativa. */
  apontadas: number;
  horasApontadas: number;
}

export function resumoDoRecorte(linhas: TarefaDaSemana[]): ResumoRecorte {
  const apontadas = linhas.filter((l) => l.horas_apontadas != null);
  return {
    n: linhas.length,
    horas: arredonda(linhas.reduce((s, l) => s + l.horas, 0)),
    peso: linhas.reduce((s, l) => s + l.peso, 0),
    rotinas: linhas.filter((l) => l.rotina).length,
    leadMediana: mediana(linhas.map((l) => l.lead_dias)),
    apontadas: apontadas.length,
    horasApontadas: arredonda(apontadas.reduce((s, l) => s + l.horas, 0)),
  };
}

/** Uma casa decimal, sem o 0.30000000000000004 da soma de ponto flutuante. */
export function arredonda(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Quanto este item vale no denominador escolhido. */
export function valorDaMedida(item: { n: number; horas?: number | null }, medida: Medida): number {
  return medida === "tempo" ? item.horas ?? 0 : item.n;
}

/** A fatia deste item no total, em pontos percentuais inteiros. */
export function percentual(parte: number, total: number): number {
  if (!total) return 0;
  return Math.round((parte / total) * 100);
}

/** "45h" · "8,2h" · "30min" — o tempo escrito como se fala. */
export function fmtHoras(h: number | null | undefined): string {
  const n = h ?? 0;
  if (n <= 0) return "0h";
  if (n < 1) return `${Math.round(n * 60)}min`;
  if (n < 10) return `${n.toFixed(1).replace(".", ",")}h`;
  return `${Math.round(n)}h`;
}

/**
 * Lê a hora que a pessoa digitou no painel.
 *
 * Três respostas, porque são três coisas diferentes: o número, `null` para
 * "apagar o apontamento e voltar à estimativa do board", e `undefined` para
 * "não entendi, não grava nada" — sem isso, um dedo errado apagaria a hora
 * apontada em vez de ser ignorado.
 */
export function lerHoras(txt: string): number | null | undefined {
  const s = txt.trim().toLowerCase().replace(",", ".").replace(/h$/, "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return undefined;
  return arredonda(n);
}

/** "4,5d" · "2d" — a mediana do card, com a vírgula do pt-BR. */
export function fmtDias(d: number): string {
  return Number.isInteger(d) ? `${d}d` : `${d.toFixed(1).replace(".", ",")}d`;
}
