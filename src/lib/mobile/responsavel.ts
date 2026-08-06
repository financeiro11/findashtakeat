// `tarefas.responsavel` é texto livre e hoje tem cinco grafias para duas pessoas:
// "Henrique", "Júlia", "Julia", "Julia " (com espaço) e "Júlia · Financeiro" — mais linhas
// nulas. Comparar por igualdade exata faz o filtro "Minhas" devolver vazio para metade do
// time, então tudo que compara responsável passa por aqui.
//
// A correção certa é no dado (FK para lib_colaboradores); enquanto ela não vem, o
// contorno mora num módulo só, testado, em vez de espalhado pelas telas.

/** Sem acento, minúsculo, sem o sufixo depois de "·", espaços colapsados. */
export function normalizaResponsavel(valor: string | null | undefined): string {
  return String(valor ?? "")
    .split("·")[0]
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Chave de identidade: o primeiro nome normalizado.
 *
 * É o único pedaço que as duas pontas têm em comum — `profiles.nome` guarda o nome
 * completo ("Júlia Rodrigues") e `tarefas.responsavel` costuma trazer só o primeiro
 * ("Julia"). Homônimos de primeiro nome colidiriam; hoje o time financeiro não tem.
 */
export function chavePessoa(valor: string | null | undefined): string {
  return normalizaResponsavel(valor).split(" ")[0] ?? "";
}

/** Mesma pessoa, tolerando as variações de grafia. Vazio nunca casa com vazio. */
export function mesmaPessoa(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = chavePessoa(a);
  const kb = chavePessoa(b);
  return !!ka && ka === kb;
}

/** Rótulo curto para o card (primeiro nome, com a inicial maiúscula). */
export function rotuloResponsavel(valor: string | null | undefined): string {
  const bruto = String(valor ?? "").split("·")[0].replace(/\s+/g, " ").trim();
  if (!bruto) return "Sem responsável";
  const primeiro = bruto.split(" ")[0];
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1);
}

/** Iniciais para o avatar. */
export function iniciais(valor: string | null | undefined): string {
  const partes = String(valor ?? "").split("·")[0].trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "—";
  return ((partes[0][0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}
