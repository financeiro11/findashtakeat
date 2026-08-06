// Contrato comum das consultas do Assistente.
//
// Existe para quebrar o ciclo entre `consultas.ts` (DRE e resultado) e `consultas-hub.ts`
// (o resto do Hub): os dois precisam do mesmo tipo de retorno e dos mesmos formatadores,
// e as justificativas do Hub enriquecem a explicação de variação do DRE. Sem este módulo,
// um importaria o outro nos dois sentidos.

/** Um número exibido na tela, sempre acompanhado de onde veio. */
export type Numero = {
  rotulo: string;
  valor: number;
  formatado: string;
  fonte: string;
  competencia: string;
};

export type Resultado = {
  consulta: string;
  ok: boolean;
  /**
   * Quão forte é a garantia por trás dos números.
   *
   * "conferido"  — consulta nomeada: o código conhece a semântica e CONFERIU que a soma
   *                das partes bate com o total. É o que pode ir para diretoria.
   * "consultado" — leitura do banco sem validação semântica da agregação. Confiável quanto
   *                à origem, não quanto à interpretação.
   *
   * Ausente equivale a "conferido".
   */
  nivel?: "conferido" | "consultado";
  /** Vão para a tabela na tela, ao lado do texto. */
  numeros: Numero[];
  /** Bloco fechado entregue ao modelo. É a única coisa que ele sabe sobre os dados. */
  paraModelo: string;
  /** Lacunas e ressalvas — sempre mostradas, nunca escondidas. */
  avisos: string[];
  /**
   * Próxima consulta que vale rodar sozinha, decidida por quem conhece o resultado.
   *
   * É o que separa um buscador de um analista: quem descobre que uma rubrica derrubou o
   * EBITDA já sabe que o passo seguinte é ver os lançamentos dela.
   */
  aprofundar?: { consulta: string; rubrica?: string };
};

export const brl = (n: number): string =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export const pct = (n: number): string =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * Confere que as partes somam o total.
 *
 * Tolerância relativa de 0,5% absorve arredondamento de centavos acumulado em dezenas de
 * rubricas, sem deixar passar erro estrutural (rubrica faltando, sinal invertido).
 */
export function fecha(partes: number[], total: number, tolerancia = 0.005): boolean {
  const soma = partes.reduce((a, b) => a + b, 0);
  const escala = Math.max(Math.abs(total), 1);
  return Math.abs(soma - total) / escala <= tolerancia;
}
