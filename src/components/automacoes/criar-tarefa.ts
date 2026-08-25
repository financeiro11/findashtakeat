import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/* ---------------------------------------------------------------------------
 * O vínculo automação ↔ tarefa, nas duas direções.
 *
 * IDA — "Começar a fazer": a automação vira tarefa no quadro.
 *
 * A escrita toda mora na RPC `automacao_criar_tarefa` (migration 20260824120000),
 * não aqui: são quatro gravações que precisam andar juntas (a tarefa, o log do
 * histórico, o vínculo de volta na automação e o `ordem` calculado do topo da
 * fila). Feito no front, uma queda de rede no meio deixaria tarefa sem vínculo —
 * e aí o botão voltaria a oferecer "criar", abrindo a segunda cópia do mesmo
 * trabalho.
 *
 * VOLTA — apagou a tarefa, a automação volta para a fila.
 *
 * `/tarefas` NÃO apaga: arquiva (`arquivada_em`), no PC e no celular. Então o
 * `on delete set null` da coluna `tarefa_id` — que resolveria isto sozinho — só
 * dispara num delete de verdade, que a tela nunca faz. O vínculo ficava apontando
 * para uma tarefa que sumiu do quadro e a ficha dizia "já está no quadro — ver a
 * tarefa" sobre algo impossível de achar.
 *
 * Quem decide não é mais a existência do `tarefa_id`, é o ESTADO da tarefa:
 * `tarefaViva` abaixo. Três razões para ler o estado em vez de limpar o vínculo
 * num gatilho:
 *
 *  · O "Desfazer" do arquivamento continua inteiro. Um gatilho que zerasse
 *    `tarefa_id` não teria como religá-lo ao restaurar — não existe ponteiro de
 *    volta na tarefa — e a automação abriria uma segunda tarefa em cima da
 *    primeira, que voltou viva.
 *  · A regra passa a existir uma vez só. A RPC já recusava devolver tarefa morta
 *    (`arquivada_em is null and status <> 'Concluído'`); a tela agora usa
 *    exatamente esse teste, então botão e gravação nunca discordam.
 *  · O histórico não se perde: a tarefa arquivada continua com o log dela, e o
 *    `tarefa_id` velho só é substituído quando nasce a próxima.
 * ------------------------------------------------------------------------- */

/** A tarefa vinculada, do jeito que vem embutida na leitura do catálogo. */
export type TarefaVinculada = {
  id: string;
  status: string;
  arquivada_em: string | null;
};

/**
 * O pedaço de `select` que traz a tarefa junto com a automação — uma viagem só,
 * pelo FK `automacoes_catalogo.tarefa_id`. Sem ele a ficha não tem como saber se
 * o vínculo ainda vale.
 */
export const EMBED_TAREFA = "tarefa:tarefas(id,status,arquivada_em)";

/**
 * O embed de um-para-um devolve objeto, mas versões do PostgREST já devolveram
 * lista. Normalizar aqui é barato e evita o pior desfecho possível: ler "não tem
 * tarefa" de um vínculo que existe e abrir uma tarefa duplicada em silêncio.
 */
export function tarefaDe(r: {
  tarefa?: TarefaVinculada | TarefaVinculada[] | null;
}): TarefaVinculada | null {
  const t = r.tarefa;
  if (!t) return null;
  return Array.isArray(t) ? t[0] ?? null : t;
}

/**
 * A tarefa vinculada ainda está no quadro?
 *
 * MESMA REGRA da RPC (migration 20260824120000, o teste do `v_viva`): arquivada
 * ou concluída não conta. As duas somem das listas de `/tarefas` — apontar para
 * elas seria mandar a pessoa procurar o que ela não acha. Se mudar aqui, mude
 * lá: são os dois lados da mesma decisão.
 */
export function tarefaViva(t: TarefaVinculada | null | undefined): boolean {
  return !!t && t.arquivada_em === null && t.status !== "Concluído";
}

/** O id da tarefa criada (ou a que já existia), ou null se deu erro. */
export async function criarTarefaDaAutomacao(
  automacaoId: string,
  responsavel: string,
): Promise<string | null> {
  // O types.ts gerado ainda não conhece a função nova; o cast fica preso aqui,
  // e não espalhado pelas telas que chamam.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("automacao_criar_tarefa", {
    p_id: automacaoId,
    p_responsavel: responsavel,
  });

  if (error) {
    toast.error(error.message);
    return null;
  }

  toast.success(`Tarefa aberta para ${responsavel}`, {
    description: "Está no Backlog de /tarefas, marcada como automação.",
  });
  return (data as string) ?? null;
}
