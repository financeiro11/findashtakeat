/**
 * Carrega o BP do ano (tabela `bp_anual`) e o realizado das Demonstrações.
 *
 * Só faz I/O e estado — o parsing da planilha mora em ./parse.ts, sem
 * dependência de rede, pra poder ser testado isoladamente.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parsearEquipe, type EquipeBP } from "./equipe";
import { normRotulo } from "./format";
import {
  APELIDOS, ehStub, parsearPlano, parsearRealizado, vazio12,
  type LinhaBP, type SecaoBP,
} from "./parse";

export type { LinhaBP, SecaoBP, TipoLinha } from "./parse";
export type { CargoBP, EquipeBP } from "./equipe";

export type PlanoBP = {
  carregando: boolean;
  existe: boolean;
  dre: LinhaBP[];
  balanco: LinhaBP[];
  dfc: LinhaBP[];
  /** Aba Equipe da planilha; null quando o BP foi importado só com a Consolidado. */
  equipe: EquipeBP | null;
  /** Índice (0-11) do último mês fechado na DRE das Demonstrações; -1 se nenhum. */
  ultimoRealizado: number;
  /** Série mensal do realizado por rótulo normalizado. */
  realizado: Record<string, (number | null)[]>;
  buscar: (secao: SecaoBP, rotulo: string) => LinhaBP | undefined;
  serie: (secao: SecaoBP, rotulo: string) => (number | null)[];
  serieRealizada: (rotulo: string) => (number | null)[];
  recarregar: () => Promise<void>;
};

export function useBpPlano(ano: number): PlanoBP {
  const [carregando, setCarregando] = useState(true);
  const [secoes, setSecoes] = useState<Record<SecaoBP, LinhaBP[]>>({ dre: [], balanco: [], dfc: [] });
  const [equipe, setEquipe] = useState<EquipeBP | null>(null);
  const [realizado, setRealizado] = useState<Record<string, (number | null)[]>>({});

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [plano, dem] = await Promise.all([
        supabase.from("bp_anual" as any).select("dados, abas").eq("ano", ano).maybeSingle(),
        supabase
          .from("demonstracoes_contabeis" as any)
          .select("dados")
          .eq("tipo", "dre")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      // `dados` é a aba Consolidado no formato antigo; `abas` traz a planilha
      // inteira como matriz crua (é de onde sai o quadro da aba Equipe).
      const linha = plano.data as {
        dados?: Record<string, unknown>[];
        abas?: Record<string, unknown>;
      } | null;
      const cru = linha?.dados ?? [];
      setSecoes(parsearPlano(Array.isArray(cru) ? cru : []));
      setEquipe(parsearEquipe(linha?.abas?.["Equipe"]));
      setRealizado(parsearRealizado((dem.data as any)?.dados, ano));
    } finally {
      setCarregando(false);
    }
  }, [ano]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const ultimoRealizado = useMemo(() => {
    const ref = realizado["receita bruta"] ?? realizado["receita"];
    if (!ref) return -1;
    let ultimo = -1;
    ref.forEach((v, i) => {
      if (!ehStub(v)) ultimo = i;
    });
    return ultimo;
  }, [realizado]);

  const buscar = useCallback(
    (secao: SecaoBP, rotulo: string) => {
      const alvo = normRotulo(rotulo);
      return secoes[secao].find((l) => l.chave === alvo);
    },
    [secoes],
  );

  const serie = useCallback(
    (secao: SecaoBP, rotulo: string) => buscar(secao, rotulo)?.meses ?? vazio12(),
    [buscar],
  );

  const serieRealizada = useCallback(
    (rotulo: string) => {
      const alvo = normRotulo(rotulo);
      return realizado[APELIDOS[alvo] ?? alvo] ?? realizado[alvo] ?? vazio12();
    },
    [realizado],
  );

  return {
    carregando,
    existe: secoes.dre.length > 0,
    dre: secoes.dre,
    balanco: secoes.balanco,
    dfc: secoes.dfc,
    equipe,
    ultimoRealizado,
    realizado,
    buscar,
    serie,
    serieRealizada,
    recarregar: carregar,
  };
}
