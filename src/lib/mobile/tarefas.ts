// Agrupamento e ordenação da lista de tarefas no celular.
//
// Lógica pura de propósito: é o que decide o que a pessoa vê primeiro na tela pequena,
// e é o único pedaço da aba que dá para testar sem navegador.

import { mesmaPessoa } from "./responsavel";
import { hojeISO } from "./formato";

/** Só o que a lista usa — evita amarrar este módulo ao componente do desktop. */
export type TarefaMin = {
  id: string;
  titulo: string;
  responsavel: string | null;
  status: string;
  prioridade: string;
  prazo: string | null;
  concluido_em?: string | null;
};

export const STATUS_CONCLUIDO = "Concluído";

/** Ordem em que os blocos aparecem. O que não estiver aqui cai no fim, antes de Concluído. */
export const ORDEM_STATUS = [
  "Em andamento",
  "Revisão",
  "Acompanhamento",
  "Backlog",
  "Stand-by",
  "automações",
];

export const PRIORIDADES = ["Urgente", "Alta", "Média", "Baixa"] as const;
const PESO_PRIORIDADE: Record<string, number> = { Urgente: 0, Alta: 1, Média: 2, Baixa: 3 };

export type FiltroTarefas = "minhas" | "todas" | "atrasadas";

/** Prazo vencido e a tarefa ainda aberta. Concluída nunca conta como atrasada. */
export function estaAtrasada(t: TarefaMin, hoje = hojeISO()): boolean {
  if (!t.prazo || t.status === STATUS_CONCLUIDO) return false;
  return t.prazo.slice(0, 10) < hoje;
}

/** Precisa de ação hoje: urgente ou já vencida. É o bloco que abre a lista. */
export function precisaAtencao(t: TarefaMin, hoje = hojeISO()): boolean {
  if (t.status === STATUS_CONCLUIDO) return false;
  return t.prioridade === "Urgente" || estaAtrasada(t, hoje);
}

export function aplicarFiltro(
  tarefas: TarefaMin[],
  filtro: FiltroTarefas,
  nomeUsuario: string | null | undefined,
  hoje = hojeISO(),
): TarefaMin[] {
  if (filtro === "atrasadas") return tarefas.filter((t) => estaAtrasada(t, hoje));
  if (filtro === "minhas") return tarefas.filter((t) => mesmaPessoa(t.responsavel, nomeUsuario));
  return tarefas;
}

/** Mais urgente primeiro; empate resolve pelo prazo mais próximo (sem prazo por último). */
export function ordenar(tarefas: TarefaMin[]): TarefaMin[] {
  return [...tarefas].sort((a, b) => {
    const pa = PESO_PRIORIDADE[a.prioridade] ?? 9;
    const pb = PESO_PRIORIDADE[b.prioridade] ?? 9;
    if (pa !== pb) return pa - pb;
    const da = a.prazo ?? "9999-12-31";
    const db = b.prazo ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return a.titulo.localeCompare(b.titulo, "pt-BR");
  });
}

export type Grupo = { chave: string; titulo: string; itens: TarefaMin[]; atencao?: boolean };

/**
 * Blocos da lista. Uma tarefa aparece em UM bloco só: a que entra em "Precisa de atenção"
 * sai do bloco do status dela — repetir o mesmo card duas vezes numa tela de 375px faz a
 * pessoa achar que são duas tarefas.
 *
 * "Concluído" não vem aqui: ele é carregado à parte, paginado (são 160 de 196 linhas).
 */
export function agrupar(tarefas: TarefaMin[], hoje = hojeISO()): Grupo[] {
  const abertas = tarefas.filter((t) => t.status !== STATUS_CONCLUIDO);
  const atencao = abertas.filter((t) => precisaAtencao(t, hoje));
  const idsAtencao = new Set(atencao.map((t) => t.id));
  const resto = abertas.filter((t) => !idsAtencao.has(t.id));

  const porStatus = new Map<string, TarefaMin[]>();
  for (const t of resto) {
    if (!porStatus.has(t.status)) porStatus.set(t.status, []);
    porStatus.get(t.status)!.push(t);
  }

  const conhecidos = ORDEM_STATUS.filter((s) => (porStatus.get(s)?.length ?? 0) > 0);
  const outros = [...porStatus.keys()]
    .filter((s) => !ORDEM_STATUS.includes(s))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const grupos: Grupo[] = [];
  if (atencao.length) {
    grupos.push({ chave: "__atencao__", titulo: "Precisa de atenção", itens: ordenar(atencao), atencao: true });
  }
  for (const s of [...conhecidos, ...outros]) {
    grupos.push({ chave: s, titulo: s, itens: ordenar(porStatus.get(s)!) });
  }
  return grupos;
}
