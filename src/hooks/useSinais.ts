// O que a IA achou sozinha e você ainda não viu.
//
// Alimenta as DUAS pontas do degrau que faltava no Hub: o contador do sino, no
// cabeçalho, e o selo de cada item do menu lateral. Os dois saem da MESMA
// chamada (`sinais_contagem`) de propósito — quando cada um fazia a sua conta,
// a sidebar dizia 3 e o sino dizia 4, e quem lê não tem como saber qual mente.
//
// O cache é de módulo, como no `useRadarAlertas`: o cabeçalho e o menu remontam
// a cada navegação, e sem ele cada troca de página refaria a consulta. Sem
// polling — a releitura acontece na navegação, que é a mesma decisão que o
// `AvisoGrave` tomou: as séries são medidas uma vez por dia, então uma consulta
// por navegação já chega perto de imediato e não deixa chamada em segundo plano
// para cada pessoa logada.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const VALIDADE_MS = 60_000;
const db = supabase as any;

export type Contagem = {
  total: number;
  novos: number;
  meus: number;
  subiram: number;
  por_modulo: Record<string, number>;
  por_rota: Record<string, number>;
};

export type Sinal = {
  id: string;
  serie: string;
  modulo: string;
  chave: string;
  titulo: string;
  corpo: string | null;
  acao: string | null;
  rascunho: { tipo?: string; rota?: string; [k: string]: unknown } | null;
  medida: Record<string, number | string> | null;
  valor: number | null;
  gravidade: "alta" | "media" | "baixa";
  rota: string;
  dono_user_id: string | null;
  dono_nome: string | null;
  meu: boolean;
  visto: boolean;
  subiu_em: string | null;
  carimbado_em: string | null;
  criado_em: string;
};

const VAZIA: Contagem = { total: 0, novos: 0, meus: 0, subiram: 0, por_modulo: {}, por_rota: {} };

let cache: { valor: Contagem; em: number } | null = null;
let voando: Promise<Contagem> | null = null;
const ouvintes = new Set<(c: Contagem) => void>();

async function buscar(): Promise<Contagem> {
  const { data, error } = await db.rpc("sinais_contagem");
  if (error || !data) return cache?.valor ?? VAZIA;
  return { ...VAZIA, ...(data as Contagem) };
}

async function garantir(): Promise<Contagem> {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.valor;
  if (!voando) {
    voando = buscar()
      .then((c) => {
        cache = { valor: c, em: Date.now() };
        voando = null;
        ouvintes.forEach((f) => f(c));
        return c;
      })
      .catch(() => {
        voando = null;
        return cache?.valor ?? VAZIA;
      });
  }
  return voando;
}

/**
 * Derruba o cache depois de ler, carimbar ou normalizar um sinal.
 *
 * Sem isto o selo continuaria aceso por até um minuto depois de você ter lido —
 * e um contador que não zera quando você age é a forma mais rápida de ensinar
 * que ele não vale nada.
 */
export function invalidarSinais() {
  cache = null;
  garantir();
}

/** O contador do sino e os selos do menu. */
export function useSinaisContagem(): Contagem {
  const [c, setC] = useState<Contagem>(cache?.valor ?? VAZIA);

  useEffect(() => {
    let vivo = true;
    const ouvinte = (v: Contagem) => { if (vivo) setC(v); };
    ouvintes.add(ouvinte);
    garantir().then(ouvinte);
    return () => { vivo = false; ouvintes.delete(ouvinte); };
  }, []);

  return c;
}

/** A lista, buscada só quando o sino abre — é ela que traz o texto e o rascunho. */
export function useSinaisLista(aberto: boolean) {
  const [lista, setLista] = useState<Sinal[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true);
    db.rpc("sinais_abertos")
      .then(({ data }: { data: Sinal[] | null }) => {
        if (vivo) { setLista(data ?? []); setCarregando(false); }
      })
      .catch(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [aberto]);

  return { lista, setLista, carregando };
}

export async function marcarVistos(ids: string[]) {
  await db.rpc("sinal_ver", { p_ids: ids });
  invalidarSinais();
}

export async function carimbarSinal(id: string) {
  await db.rpc("sinal_carimbar", { p_id: id });
  invalidarSinais();
}

/** "Isso é normal" — alarga a banda da série, não só cala este aviso. */
export async function normalizarSinal(id: string): Promise<number | null> {
  const { data } = await db.rpc("sinal_normalizar", { p_id: id });
  invalidarSinais();
  return (data as number) ?? null;
}
