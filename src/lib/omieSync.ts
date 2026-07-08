import { supabase } from "@/integrations/supabase/client";

export type OmieSyncResult = {
  status: "ok" | "erro" | "timeout";
  movimentos?: number;
  dre_linhas?: number;
  dfc_linhas?: number;
  nao_mapeadas?: number;
  erro?: string | null;
};

/**
 * Dispara o `omie-sync` e acompanha pelo `omie_sync_log` em vez de esperar a
 * função retornar. O sync completo leva ~80s e o `functions.invoke` do navegador
 * estoura o timeout de rede antes disso — então "disparamos e vamos consultando"
 * a última linha do log até ela concluir (status ok/erro).
 *
 * Para não confundir com uma sincronização anterior, guardamos o id do último
 * log ANTES de disparar e só aceitamos uma linha diferente (a nova).
 */
export async function runOmieSync(opts?: { maxWaitMs?: number; intervalMs?: number }): Promise<OmieSyncResult> {
  const intervalMs = opts?.intervalMs ?? 3000;
  const maxWaitMs = opts?.maxWaitMs ?? 180000; // 3 min

  const log = () => supabase.from("omie_sync_log" as any) as any;

  // id do log mais recente ANTES de disparar (para detectar o novo)
  const { data: prev } = await log().select("id").order("iniciado_em", { ascending: false }).limit(1).maybeSingle();
  const prevId = (prev as any)?.id ?? null;

  // dispara e não aguarda (o invoke pode estourar timeout — ignoramos e confiamos no log)
  supabase.functions.invoke("omie-sync", { body: { action: "sync" } }).catch(() => {});

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const { data } = await log()
      .select("id,status,movimentos,dre_linhas,dfc_linhas,nao_mapeadas,erro")
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as any;
    if (row && row.id !== prevId && (row.status === "ok" || row.status === "erro")) {
      return {
        status: row.status,
        movimentos: row.movimentos,
        dre_linhas: row.dre_linhas,
        dfc_linhas: row.dfc_linhas,
        nao_mapeadas: row.nao_mapeadas,
        erro: row.erro,
      };
    }
  }
  return { status: "timeout" };
}
