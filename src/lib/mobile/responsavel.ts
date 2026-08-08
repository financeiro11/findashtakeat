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

export type Pessoa = {
  /** Identidade (primeiro nome normalizado) — serve para comparar. */
  chave: string;
  /** O que a pessoa lê no chip. */
  rotulo: string;
  /** O que vai para o banco ao escolher esta pessoa. */
  valor: string;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/**
 * Uma entrada por pessoa a partir dos responsáveis que já existem nas tarefas.
 *
 * Duas decisões, as duas por causa da bagunça de grafias:
 *
 * 1. O seletor sai dos DADOS, não de uma lista no código. O diálogo do desktop
 *    (components/tarefas/TaskDialog.tsx) tem "Henrique" e "Júlia" escritos à mão; quem
 *    entrar no time depois não aparece em lugar nenhum e a tarefa fica sem dono.
 *
 * 2. `valor` é a grafia que MAIS APARECE hoje para aquela pessoa, não um nome novo bonito.
 *    Escrever "Júlia Rodrigues" onde o resto da base diz "Julia" só acrescentaria uma sexta
 *    variante para `mesmaPessoa` ter que tolerar. O celular escolhe entre o que já existe.
 */
export function pessoasConhecidas(valores: (string | null | undefined)[]): Pessoa[] {
  const grupos = new Map<string, Map<string, number>>();

  for (const bruto of valores) {
    const limpo = String(bruto ?? "").replace(/\s+/g, " ").trim();
    if (!limpo) continue;
    const chave = chavePessoa(limpo);
    if (!chave) continue;
    if (!grupos.has(chave)) grupos.set(chave, new Map());
    const contagem = grupos.get(chave)!;
    contagem.set(limpo, (contagem.get(limpo) ?? 0) + 1);
  }

  return [...grupos.entries()]
    .map(([chave, contagem]) => {
      const valor = [...contagem.entries()].sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];                     // mais frequente
        const acentoA = a[0] !== semAcento(a[0]);
        const acentoB = b[0] !== semAcento(b[0]);
        if (acentoA !== acentoB) return acentoA ? -1 : 1;          // "Júlia" antes de "Julia"
        return a[0].localeCompare(b[0], "pt-BR");
      })[0][0];
      return { chave, rotulo: rotuloResponsavel(valor), valor };
    })
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}
