import { supabase } from "@/integrations/supabase/client";

// A extração de PDF (parse-balancete-pdf) roda em segundo plano no servidor.
// Este helper consulta o registro até ficar pronto (version=2) ou falhar
// (parse_status="error"), sem depender do tempo da requisição HTTP.
export async function aguardarExtracao(
  tipo: string,
  periodo: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ ok: true; contas: number } | { ok: false; error: string }> {
  const timeout = opts.timeoutMs ?? 300000; // 5 min
  const intervalo = opts.intervalMs ?? 4000;
  const inicio = Date.now();

  while (Date.now() - inicio < timeout) {
    await new Promise((r) => setTimeout(r, intervalo));
    const { data } = await supabase
      .from("demonstracoes_contabeis" as any)
      .select("dados")
      .eq("tipo", tipo)
      .eq("periodo", periodo)
      .maybeSingle();
    const d: any = (data as any)?.dados;
    if (d?.version === 2 && Array.isArray(d.accounts) && d.accounts.length) {
      return { ok: true, contas: d.accounts.length };
    }
    if (d?.parse_status === "error") {
      return { ok: false, error: d.parse_error || "Falha ao extrair o PDF" };
    }
  }
  return { ok: false, error: "Tempo esgotado ao processar o PDF. Tente reprocessar." };
}
