// A lógica pura da tela de Perfis de acesso.
//
// Separada da página pelo mesmo motivo de `pages/dashboard/metrics.ts`: o que
// decide "isto mudou?" e "o que salvar?" é testável sem montar React, e é
// justamente onde um erro passa despercebido — salvar o perfil errado numa
// matriz de 17×8 não dá erro nenhum, só um acesso torto que ninguém relaciona
// com o clique de ontem.

import { PERFIS_ESCOLHIVEIS, PERFIS, type Capacidade, type MatrizAcesso, type PerfilId } from "@/lib/modules";

/** As colunas da tela, na ordem em que aparecem. */
export const COLUNAS = PERFIS_ESCOLHIVEIS;

export type Linhas = Record<PerfilId, Set<Capacidade>>;

/** O estado editável a partir da matriz do banco — quem falta usa o padrão do código. */
export function paraLinhas(m: MatrizAcesso): Linhas {
  const out = {} as Linhas;
  for (const p of COLUNAS) out[p.id] = new Set(m[p.id] ?? p.capacidades);
  return out;
}

/** Cópia funda — os `Set` precisam ser novos, senão editar o rascunho editaria o salvo. */
export function clonar(l: Linhas): Linhas {
  return Object.fromEntries(COLUNAS.map((p) => [p.id, new Set(l[p.id])])) as Linhas;
}

export function mesmasCapacidades(a: Set<Capacidade>, b: Set<Capacidade>): boolean {
  return a.size === b.size && [...a].every((c) => b.has(c));
}

/**
 * Quais perfis mudaram.
 *
 * O `admin` fica de fora sempre: ele não se edita (a coluna vem desabilitada, e
 * o trigger no Postgres reescreve a linha cheia). Se ele entrasse aqui, um
 * clique acidental viraria um UPDATE que o banco desfaz — e a tela diria que
 * salvou algo que não mudou.
 *
 * Salvar SÓ o que mudou também é o que mantém `atualizado_em` honesto: a data
 * diz quando aquele perfil mudou, não quando alguém abriu a tela.
 */
export function perfisAlterados(salvo: Linhas, rascunho: Linhas): PerfilId[] {
  return COLUNAS
    .filter((p) => p.id !== "admin" && !mesmasCapacidades(salvo[p.id], rascunho[p.id]))
    .map((p) => p.id);
}

/** Marca/desmarca uma célula, devolvendo um estado novo. */
export function alternar(l: Linhas, perfil: PerfilId, cap: Capacidade): Linhas {
  if (perfil === "admin") return l;
  const set = new Set(l[perfil]);
  if (set.has(cap)) set.delete(cap); else set.add(cap);
  return { ...l, [perfil]: set };
}

/** Devolve a coluna ao padrão escrito em `PERFIS`. */
export function restaurarPadrao(l: Linhas, perfil: PerfilId): Linhas {
  if (perfil === "admin") return l;
  return { ...l, [perfil]: new Set(PERFIS[perfil].capacidades) };
}

/** As linhas a gravar em `acesso_perfil`. */
export function paraGravar(
  rascunho: Linhas,
  alterados: readonly PerfilId[],
  quem: string | null,
): { perfil: string; capacidades: string[]; atualizado_em: string; atualizado_por: string | null }[] {
  const agora = new Date().toISOString();
  return alterados.map((id) => ({
    perfil: id,
    capacidades: [...rascunho[id]],
    atualizado_em: agora,
    atualizado_por: quem,
  }));
}
