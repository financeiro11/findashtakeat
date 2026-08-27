/**
 * Acesso às tabelas da folha que ainda não estão no `types.ts` gerado.
 *
 * `folha_depara`, `folha_ajustes_log`, `folha_envios_omie` e `folha_recusas`
 * nasceram depois da última geração de tipos, então o cliente tipado do
 * Supabase não as conhece e `supabase.from("folha_depara")` não compila.
 *
 * A fuga de tipo fica AQUI, num lugar só, em vez de virar `(supabase as any)`
 * espalhado por cada tela — que é como o resto do repo resolveu e é o motivo de
 * o lint apontar `no-explicit-any` em vários arquivos. Quando o `types.ts` for
 * regenerado (`supabase gen types`), este módulo pode simplesmente sumir.
 */

import { supabase } from "@/integrations/supabase/client";

type Resposta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

type Filtrada = Resposta<Record<string, unknown>[]> & {
  eq: (coluna: string, valor: string) => Filtrada;
  is: (coluna: string, valor: null) => Filtrada;
  order: (coluna: string, opts?: { ascending?: boolean }) => Filtrada & {
    limit: (n: number) => Resposta<Record<string, unknown>[]>;
  };
  maybeSingle: () => Resposta<Record<string, unknown>>;
};

type Consulta = {
  select: (colunas: string) => Filtrada;
  update: (valores: Record<string, unknown>) => {
    eq: (coluna: string, valor: string) => Resposta<null>;
  };
  insert: (valores: Record<string, unknown>) => Resposta<null>;
};

/** Tabelas da folha ainda ausentes do `types.ts`. */
export type TabelaDaFolha =
  | "folha_depara" | "folha_ajustes_log" | "folha_envios_omie" | "folha_recusas";

export const tabelaFolha = (nome: TabelaDaFolha): Consulta =>
  (supabase as unknown as { from: (t: string) => Consulta }).from(nome);
