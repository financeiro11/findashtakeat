import { supabase } from "@/integrations/supabase/client";

// Um registro em demonstracoes_contabeis pode existir só como placeholder (ex.: PDF
// anexado mas ainda não processado pela IA, ou upload que zerou o dados). "Ter dados
// reais" exige conteúdo de verdade, não apenas a linha existir.
function temDadosReais(raw: any): boolean {
  if (!raw) return false;
  if (raw.version === 2) return Array.isArray(raw.accounts) && raw.accounts.length > 0;
  if (Array.isArray(raw.rows)) return raw.rows.length > 0;
  if (Array.isArray(raw)) return raw.length > 0;
  return false;
}

/**
 * Período mais recentemente SALVO (por updated_at) que realmente tem dados — usado para
 * abrir Balanço/Balancete já no último arquivo importado, em vez do mês/trimestre atual
 * (que costuma estar vazio até o próximo envio).
 */
export async function buscarPeriodoMaisRecenteComDados(tipo: string): Promise<string | null> {
  const { data } = await supabase
    .from("demonstracoes_contabeis" as any)
    .select("periodo, dados, updated_at")
    .eq("tipo", tipo)
    .order("updated_at", { ascending: false })
    .limit(20);
  for (const row of (data as any[]) ?? []) {
    if (temDadosReais((row as any)?.dados)) return String((row as any).periodo);
  }
  return null;
}
