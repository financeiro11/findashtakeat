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

import { listarMovimentos, listarMovimentosExcluindoContas, listarCategorias, type OmieCategoria } from "./omie.ts";

/**
 * A conta "ASAAS Disponível" fica FORA do cache — e SÓ ela.
 *
 * A contabilidade exige o extrato do Asaas espelhado linha a linha no ERP —
 * 46.240 lançamentos entre abr e set/2026, crescendo ~284/dia. Baixá-los aqui
 * levaria o pull de `ListarMovimentos` de 157,8s para mais de nove minutos e
 * mataria de uma vez o `omie-sync`, o `omie-caixa-sync` e o `omie-pix-sync`. O
 * Hub não precisa deles: tem `asaas_extrato` local, o calendário do caixa já
 * ignora as contas Asaas de propósito, e "Meios de Pagamento" sai da RPC
 * `asaas_taxas_mes`. Eles existem no ERP para a contabilidade, não para nós.
 *
 * **A "ASAAS Pago" (5471927663) NÃO pode sair daqui.** É nela que mora o título
 * consolidado que o financeiro lança à mão todo mês, na categoria 1.01.03 — ou
 * seja, é RECEITA da DRE. Tirá-la do cache apagaria a receita do mês corrente
 * sem erro nenhum: os meses fechados sobreviveriam pela trava e pelos valores
 * manuais, e só o mês em curso ficaria vazio. São 262 registros, e é por isso
 * que a contrapartida daquela conta segue DIÁRIA e não linha a linha.
 */
const CONTAS_FORA_DO_CACHE = new Set(["5460455582"]);

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
  /* A varredura conta a conta é o caminho novo, e ela ainda pode esbarrar na
     regra de "consumo redundante" do Omie (chamadas parecidas em menos de 60s).
     Se esbarrar, o certo NÃO é ficar sem DRE: é cair para a varredura antiga, de
     uma chamada só. Ela ainda funciona hoje — 17.848 registros em ~158s — e só
     deixa de funcionar quando o espelho linha a linha do Asaas encher a conta.
     Enquanto as duas convivem, ficar sem número é o pior desfecho possível. */
  let dados: any[];
  try {
    dados = await listarMovimentosExcluindoContas(CONTAS_FORA_DO_CACHE);
  } catch (e) {
    console.warn(
      "omie-cache: varredura por conta falhou, caindo para a varredura única:",
      e instanceof Error ? e.message : String(e),
    );
    dados = await listarMovimentos({});
  }
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
