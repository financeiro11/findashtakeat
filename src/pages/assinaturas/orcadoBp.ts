// Orçado da aba "Operação" do BP. O parser mora em supabase/functions/_shared/bp-operacao.ts
// (a camada de análise usa o mesmo); aqui ficam só o hook e o desvio da tela.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parsearOperacao, type MesBP } from "../../../supabase/functions/_shared/bp-operacao.ts";
export * from "../../../supabase/functions/_shared/bp-operacao.ts";

export type OrcadoBP = {
  carregando: boolean;
  existe: boolean;
  meses: Map<string, MesBP>;
  /** Rótulo do mês em que o plano foi reancorado ("Jun"), ou null. */
  ancora: MesBP | null;
};

export function useOrcadoBp(ano: number): OrcadoBP {
  const [meses, setMeses] = useState<Map<string, MesBP>>(new Map());
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await supabase
        .from("bp_anual" as any)
        .select("abas")
        .eq("ano", ano)
        .maybeSingle();
      const abas = (data as { abas?: Record<string, unknown> } | null)?.abas;
      setMeses(parsearOperacao(abas?.["Operação"], ano));
    } catch {
      setMeses(new Map());
    } finally {
      setCarregando(false);
    }
  }, [ano]);

  useEffect(() => { void carregar(); }, [carregar]);

  return {
    carregando,
    existe: meses.size > 0,
    meses,
    ancora: Array.from(meses.values()).find((m) => m.ancora) ?? null,
  };
}

/* ------------------------------ comparação ------------------------------ */
export type Desvio = { abs: number; pct: number | null; acima: boolean };

/** Desvio do realizado contra o orçado. `pct` é null quando não há orçado. */
export function desvio(real: number, orcado: number | null | undefined): Desvio | null {
  if (orcado == null || !isFinite(orcado)) return null;
  const abs = real - orcado;
  return { abs, pct: orcado === 0 ? null : (abs / orcado) * 100, acima: abs >= 0 };
}
