// Cache compartilhado dos dados brutos do Omie.
//
// Problema que isto resolve: as 4 sincronizações (omie-sync, omie-caixa-sync,
// omie-orcamento-sync, omie-pix-sync) chamavam `listarMovimentos({})` — que baixa
// TODO o histórico do Omie (paginando) — a CADA execução. Um recálculo simples da
// DRE repuxava ~8 mil movimentos (~60s). E as 4 funções faziam isso de forma
// independente, multiplicando as chamadas à API do Omie.
//
// Aqui, uma passada guarda os movimentos/categorias na tabela `omie_cache`. Os
// consumidores leem do cache (recálculo local, ~0 chamadas ao Omie) e só repuxam
// do Omie quando o cache está velho (> maxIdadeMin) ou quando forçado (atualizar=true).

import { listarMovimentos, listarCategorias, type OmieCategoria } from "./omie.ts";

// Movimentos: janela curta (dado transacional muda mais). Categorias: dia inteiro.
const IDADE_MOVIMENTOS_MIN = 360;    // 6 h
const IDADE_CATEGORIAS_MIN = 1440;   // 24 h

export interface LeituraCache<T> {
  dados: T;
  origem: "cache" | "omie";
  idadeMin: number;          // idade do dado devolvido, em minutos
  atualizadoEm: string | null;
}

async function lerLinha(supabase: any, chave: string): Promise<{ dados: any; atualizado_em: string } | null> {
  const { data } = await supabase.from("omie_cache").select("dados, atualizado_em").eq("chave", chave).maybeSingle();
  return (data as any) ?? null;
}

async function gravar(supabase: any, chave: string, dados: unknown): Promise<string> {
  const atualizado_em = new Date().toISOString();
  await supabase.from("omie_cache").upsert(
    { chave, dados, registros: Array.isArray(dados) ? dados.length : null, atualizado_em },
    { onConflict: "chave" },
  );
  return atualizado_em;
}

function idadeMinutos(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

/** Movimentos financeiros do Omie, do cache quando fresco; senão repuxa e recacheia. */
export async function lerMovimentos(
  supabase: any,
  opts: { forcar?: boolean; maxIdadeMin?: number } = {},
): Promise<LeituraCache<any[]>> {
  const maxIdade = opts.maxIdadeMin ?? IDADE_MOVIMENTOS_MIN;
  if (!opts.forcar) {
    const row = await lerLinha(supabase, "movimentos");
    if (row && Array.isArray(row.dados)) {
      const idade = idadeMinutos(row.atualizado_em);
      if (idade <= maxIdade) return { dados: row.dados, origem: "cache", idadeMin: idade, atualizadoEm: row.atualizado_em };
    }
  }
  const dados = await listarMovimentos({});
  const atualizadoEm = await gravar(supabase, "movimentos", dados);
  return { dados, origem: "omie", idadeMin: 0, atualizadoEm };
}

/** Categorias (plano de contas) do Omie, do cache quando fresco; senão repuxa. */
export async function lerCategorias(
  supabase: any,
  opts: { forcar?: boolean; maxIdadeMin?: number } = {},
): Promise<LeituraCache<OmieCategoria[]>> {
  const maxIdade = opts.maxIdadeMin ?? IDADE_CATEGORIAS_MIN;
  if (!opts.forcar) {
    const row = await lerLinha(supabase, "categorias");
    if (row && Array.isArray(row.dados)) {
      const idade = idadeMinutos(row.atualizado_em);
      if (idade <= maxIdade) return { dados: row.dados, origem: "cache", idadeMin: idade, atualizadoEm: row.atualizado_em };
    }
  }
  const dados = await listarCategorias();
  const atualizadoEm = await gravar(supabase, "categorias", dados);
  return { dados, origem: "omie", idadeMin: 0, atualizadoEm };
}

/** Força a atualização do cache (movimentos + categorias) direto do Omie. */
export async function atualizarCacheOmie(supabase: any): Promise<{ movimentos: number; categorias: number; atualizadoEm: string | null }> {
  const mov = await lerMovimentos(supabase, { forcar: true });
  const cat = await lerCategorias(supabase, { forcar: true });
  return { movimentos: mov.dados.length, categorias: cat.dados.length, atualizadoEm: mov.atualizadoEm };
}
