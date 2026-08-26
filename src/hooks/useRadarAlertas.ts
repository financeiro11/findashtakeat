// Quantos achados do Radar de Preços ainda não foram vistos.
//
// Serve ao selo do menu lateral. É contagem, não lista: `head: true` faz o
// PostgREST devolver só o total no header, sem trazer linha nenhuma — o menu
// monta em toda navegação e não pode arrastar a tabela de alertas junto.
//
// O cache é de módulo, no mesmo espírito do useApelidos: sem ele, cada troca de
// página refaria a consulta. `invalidarRadarAlertas()` derruba o cache quando a
// própria tela do radar mexe nos alertas, para o selo não ficar mentindo até a
// janela de 60s vencer.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const VALIDADE_MS = 60_000;

let cache: { valor: number; em: number } | null = null;
let voando: Promise<number> | null = null;
const ouvintes = new Set<(n: number) => void>();

async function buscar(): Promise<number> {
  const { count, error } = await supabase
    .from("facilities_radar_alertas" as any)
    .select("id", { count: "exact", head: true })
    .eq("status", "novo");
  if (error) return cache?.valor ?? 0;
  return count ?? 0;
}

async function garantir(): Promise<number> {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.valor;
  if (!voando) {
    voando = buscar().then((n) => {
      cache = { valor: n, em: Date.now() };
      voando = null;
      ouvintes.forEach((f) => f(n));
      return n;
    }).catch(() => { voando = null; return cache?.valor ?? 0; });
  }
  return voando;
}

/** Chamado pela tela do Radar depois de dispensar/promover um achado. */
export function invalidarRadarAlertas() {
  cache = null;
  garantir();
}

export function useRadarAlertas(ativo: boolean): number {
  const [n, setN] = useState(cache?.valor ?? 0);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    const ouvinte = (v: number) => { if (vivo) setN(v); };
    ouvintes.add(ouvinte);
    garantir().then(ouvinte);
    return () => { vivo = false; ouvintes.delete(ouvinte); };
  }, [ativo]);

  return ativo ? n : 0;
}
