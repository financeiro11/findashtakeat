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

/**
 * Ordem em que os blocos aparecem. O que não estiver aqui cai no fim, antes de Concluído.
 *
 * Precisa cobrir TODAS as colunas padrão do Kanban do desktop (DEFAULT_COLUMNS em
 * components/tarefas/TaskDialog.tsx) — se uma coluna faltar aqui, a folha de detalhe não
 * oferece aquele destino e a tarefa que já está nele aparece sem nenhum chip marcado.
 * A lista não é importada de lá de propósito: puxaria a árvore do editor de desktop para
 * dentro do bundle do celular. Coluna criada à mão no desktop mora no localStorage daquele
 * computador, então quem a descobre é `statusDisponiveis`, lendo os dados.
 */
export const ORDEM_STATUS = [
  "Em andamento",
  "Revisão",
  "Acompanhamento",
  "Tasks - RPA",
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

export type Grupo = { chave: string; titulo: string; itens: TarefaMin[]; nAtencao: number };

/**
 * Blocos da lista, um por STATUS.
 *
 * O status é o único campo que a pessoa muda daqui, então tem que ser ele a desenhar os
 * blocos: mover de "Backlog" para "Em andamento" precisa tirar o card de um bloco e
 * colocar em outro, senão a ação não tem efeito visível nenhum.
 *
 * Já existiu aqui um bloco "Precisa de atenção" acima de tudo, que recolhia o que estava
 * urgente ou vencido e o retirava do bloco do status. Ele engolia a lista inteira — hoje a
 * maioria das tarefas abertas está com prazo vencido — e, como `ordenar` não olha status,
 * trocar o status deixava o card exatamente no mesmo lugar. Era o bug de "mudo a situação
 * e a tarefa não se move". O sinal continua: `nAtencao` no cabeçalho do bloco, `ordenar`
 * pondo urgente/vencida no topo e o prazo em vermelho no card.
 *
 * "Concluído" não vem aqui: ele é carregado à parte, paginado (são 160 de 196 linhas).
 */
export function agrupar(tarefas: TarefaMin[], hoje = hojeISO()): Grupo[] {
  const porStatus = new Map<string, TarefaMin[]>();
  for (const t of tarefas) {
    if (t.status === STATUS_CONCLUIDO) continue;
    if (!porStatus.has(t.status)) porStatus.set(t.status, []);
    porStatus.get(t.status)!.push(t);
  }

  const conhecidos = ORDEM_STATUS.filter((s) => (porStatus.get(s)?.length ?? 0) > 0);
  const outros = [...porStatus.keys()]
    .filter((s) => !ORDEM_STATUS.includes(s))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return [...conhecidos, ...outros].map((s) => {
    const itens = ordenar(porStatus.get(s)!);
    return {
      chave: s,
      titulo: s,
      itens,
      nAtencao: itens.filter((t) => precisaAtencao(t, hoje)).length,
    };
  });
}

/**
 * Destinos que a folha de detalhe oferece.
 *
 * Sai dos dados, não de uma lista fixa: o Kanban do desktop deixa criar e renomear coluna,
 * e essa configuração vive no localStorage do computador de cada um — o celular nunca a vê.
 * Então vale o que existe: as colunas padrão (ORDEM_STATUS) mais qualquer status que
 * apareça nas linhas carregadas, mais o status atual da tarefa aberta. Sem isto, uma
 * tarefa numa coluna que o celular desconhece abre com nenhum chip marcado, e não há como
 * devolvê-la para lá depois de mexer.
 */
export function statusDisponiveis(tarefas: TarefaMin[], atual?: string | null): string[] {
  const vistos = new Set<string>(ORDEM_STATUS);
  for (const t of tarefas) if (t.status) vistos.add(t.status);
  if (atual) vistos.add(atual);
  vistos.delete(STATUS_CONCLUIDO); // entra sempre por último, nunca no meio

  const outros = [...vistos]
    .filter((s) => !ORDEM_STATUS.includes(s))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return [...ORDEM_STATUS, ...outros, STATUS_CONCLUIDO];
}
