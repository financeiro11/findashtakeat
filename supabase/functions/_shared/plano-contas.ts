// Regras do cadastro de categorias do Omie — as mesmas no Hub e na Edge Function.
//
// Mora em `_shared/` porque as duas pontas precisam dizer a MESMA coisa: a tela
// avisa antes de enviar ("já existe uma categoria com esse nome") e a função
// recusa se chegar assim mesmo. Duas cópias divergiriam na primeira vez que
// alguém mexesse numa só. O front importa daqui (ver src/lib/planoContas.test.ts).

/** O Omie aceita até 50 caracteres na descrição (`string50`). */
export const LIMITE_DESCRICAO = 50;

export type CategoriaCadastro = {
  codigo: string;
  descricao: string;
  superior: string | null;
  totalizadora: boolean;
  inativa: boolean;
};

/**
 * A chave pela qual o Hub casa uma categoria com o DE-PARA, o Orçamento e a folha:
 * sem acento, sem caixa, espaço colapsado. É a expressão do SQL
 * (`lower(btrim(regexp_replace(unaccent(x), '\s+', ' ', 'g')))`), e é por isso que
 * "Outros - Administrativo" e "outros  -  administrativo" são o MESMO nome.
 */
export function chaveDescricao(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Espelha `public.categoria_e_folha`: a descrição decide se os lançamentos da
 * categoria são folha (e só quem vê a Remuneração os enxerga). Por isso um
 * RENOMEAR que muda esta resposta muda quem vê salário — e a função recusa
 * para quem não tem a capacidade `remuneracao`.
 */
export function ehFolha(descricao: string | null | undefined): boolean {
  const d = String(descricao ?? "");
  return /(Pessoal|Premia[çc][ãa]o|Escala)\s*-/i.test(d) || /Pro\s*Labore/i.test(d) || /Diretores\s*-/i.test(d);
}

/** Espaço colapsado e forma NFC — o Omie recusa acento decomposto com "hash inválido". */
export function limparDescricao(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

export type Validacao = { ok: true; descricao: string } | { ok: false; erro: string };

/**
 * O nome serve? Tamanho, caractere que o Omie devolve escapado, e duplicidade
 * pela chave do Hub — duas categorias com o mesmo nome dividiriam a mesma linha do
 * DE-PARA sem ninguém perceber.
 *
 * `ignorarCodigo` é a própria categoria num renomear.
 */
export function validarDescricao(
  bruta: string,
  existentes: CategoriaCadastro[],
  ignorarCodigo?: string,
): Validacao {
  const descricao = limparDescricao(bruta);
  if (descricao.length < 3) return { ok: false, erro: "Escreva o nome da categoria (pelo menos 3 caracteres)." };
  if (descricao.length > LIMITE_DESCRICAO) {
    return { ok: false, erro: `O Omie aceita até ${LIMITE_DESCRICAO} caracteres; este nome tem ${descricao.length}.` };
  }
  if (/[<>]/.test(descricao)) {
    return { ok: false, erro: "Use um nome sem < ou > — o Omie guarda esses sinais escapados e o nome deixaria de casar com o DE-PARA." };
  }
  const chave = chaveDescricao(descricao);
  const igual = existentes.find((c) => c.codigo !== ignorarCodigo && chaveDescricao(c.descricao) === chave);
  if (igual) {
    return {
      ok: false,
      erro: igual.inativa
        ? `Já existe "${igual.descricao}" (${igual.codigo}), desativada. Reative-a em vez de criar outra com o mesmo nome.`
        : `Já existe "${igual.descricao}" (${igual.codigo}) com esse nome.`,
    };
  }
  return { ok: true, descricao };
}

/** O grupo de destino existe, é um grupo (totalizador) e está ativo? */
export function validarGrupo(superior: string, existentes: CategoriaCadastro[]): { ok: true; grupo: CategoriaCadastro } | { ok: false; erro: string } {
  const grupo = existentes.find((c) => c.codigo === superior);
  if (!grupo) return { ok: false, erro: `O grupo ${superior} não existe no plano de contas.` };
  if (!grupo.totalizadora) return { ok: false, erro: `${grupo.codigo} é uma categoria, não um grupo — escolha o grupo em que a nova categoria entra.` };
  if (grupo.inativa) return { ok: false, erro: `O grupo ${grupo.codigo} está desativado no Omie.` };
  return { ok: true, grupo };
}

/** "<Disponível>" é a posição vazia que o Omie reserva dentro de cada grupo. */
export const ehPosicaoLivre = (descricao: string | null | undefined): boolean =>
  /^\s*(<|&lt;)\s*dispon[ií]vel\s*(>|&gt;)\s*$/i.test(String(descricao ?? ""));
