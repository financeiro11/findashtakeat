import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/* ---------------------------------------------------------------------------
 * "Começar a fazer" — a automação vira tarefa no quadro.
 *
 * A escrita toda mora na RPC `automacao_criar_tarefa` (migration 20260824120000),
 * não aqui: são quatro gravações que precisam andar juntas (a tarefa, o log do
 * histórico, o vínculo de volta na automação e o `ordem` calculado do topo da
 * fila). Feito no front, uma queda de rede no meio deixaria tarefa sem vínculo —
 * e aí o botão voltaria a oferecer "criar", abrindo a segunda cópia do mesmo
 * trabalho.
 *
 * A RPC é idempotente: chamar de novo devolve a MESMA tarefa enquanto ela
 * estiver viva no quadro.
 * ------------------------------------------------------------------------- */

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
