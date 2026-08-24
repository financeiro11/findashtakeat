/* ============================================================================
 * Responsável — uma pessoa, uma grafia.
 *
 * O campo é texto livre em várias telas e apodreceu sozinho: "Júlia", "Julia",
 * "Julia " e "Júlia " conviviam no mesmo banco, e um filtro montado sobre o
 * valor cru listava quatro opções para uma pessoa só — escolher uma delas
 * escondia as automações gravadas com as outras três.
 *
 * A migration 20260824120000 limpou o que existia e as telas passaram a gravar
 * por select. Isto aqui é a rede de segurança para o que já foi escrito antes
 * (e para importação de planilha, que continua aceitando texto).
 *
 * A grafia canônica não é escolha nova: é a que o módulo de tarefas já usa no
 * select do TaskDialog. Duas pessoas, dois nomes.
 * ========================================================================== */

/** As pessoas que tocam automação. Mesma dupla do select de /tarefas. */
export const PESSOAS = ["Henrique", "Júlia"] as const;

/** Automação tocada pelos dois — conta para os dois lados no filtro. */
export const AMBOS = "Ambos";

/** Valor do filtro para "ninguém pegou ainda". */
export const SEM_RESP = "__sem";

/**
 * Grafias conhecidas, indexadas pela forma achatada (sem acento, minúscula,
 * sem espaço nas pontas).
 *
 * Mapa explícito, e não `startsWith("juli")` como faz o normalizeResp de
 * /tarefas: por prefixo, uma "Juliane" viraria "Júlia" — e há uma Juliane em
 * lib_colaboradores. Casar o nome inteiro custa uma linha por variante e não
 * inventa gente.
 */
const CANONICO: Record<string, string> = {
  henrique: "Henrique",
  julia: "Júlia",
  ambos: AMBOS,
};

/** Achata para comparar: "Júlia " e "JULIA" viram "julia". */
const achatar = (v: string) =>
  v.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * A grafia boa de um responsável. Devolve `null` para vazio e **o próprio
 * valor** para quem não está no mapa — "RPA" e "VPX" não são erro de digitação,
 * são respostas legítimas, e sumir com elas esconderia automação de verdade.
 */
export function canonResp(v: string | null | undefined): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  return CANONICO[achatar(s)] ?? s;
}

/**
 * Esta linha entra no recorte de quem está filtrando?
 *
 * Regra que não é óbvia: "Ambos" aparece tanto no filtro do Henrique quanto no
 * da Júlia. Uma automação que os dois tocam é trabalho dos dois — some da fila
 * de quem filtrou seria mentira.
 */
export function respCobre(respDaLinha: string | null | undefined, filtro: string): boolean {
  if (!filtro) return true;
  const r = canonResp(respDaLinha);
  if (filtro === SEM_RESP) return r === null;
  if (r === null) return false;
  if (r === filtro) return true;
  // "Ambos" cobre as duas pessoas — mas não cobre RPA/VPX, que são outra coisa.
  return r === AMBOS && (PESSOAS as readonly string[]).includes(filtro);
}

/**
 * As opções do filtro, na ordem em que fazem sentido aparecer: as pessoas
 * primeiro (mesmo sem nenhuma linha ainda — o chip vazio é informação: ninguém
 * pegou nada), depois o que mais existir no banco, em ordem alfabética.
 *
 * "Ambos" fica de fora de propósito: já está embutido nos dois chips de pessoa,
 * e um chip próprio faria a mesma automação ser contada em três lugares.
 */
export function respExistentes(valores: (string | null | undefined)[]): string[] {
  const vistos = new Set<string>();
  for (const v of valores) {
    const c = canonResp(v);
    if (c && c !== AMBOS && !(PESSOAS as readonly string[]).includes(c)) vistos.add(c);
  }
  return [...PESSOAS, ...Array.from(vistos).sort((a, b) => a.localeCompare(b, "pt-BR"))];
}

/** Quantas linhas cada opção do filtro pegaria — para o número no chip. */
export function contarPorResp(valores: (string | null | undefined)[], opcao: string): number {
  return valores.filter((v) => respCobre(v, opcao)).length;
}
