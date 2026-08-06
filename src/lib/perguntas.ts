/* ============================================================================
 * A pergunta que se faz em cima de uma célula da DRE/DFC.
 *
 * A justificativa automática (lib/justificativas) fala do que a máquina percebeu:
 * a célula variou, quem se mexeu. A pergunta é o contrário — nasce de um fato que
 * o banco não conhece ("quatro pessoas tiveram reajuste") e quase sempre aponta
 * para uma célula que NÃO variou.
 *
 * O QUE ESTE ARQUIVO FAZ: montar o dossiê da célula com os números que estão à
 * VISTA. Pelo mesmo motivo das justificativas — se o servidor recalculasse a
 * partir do blob, a resposta poderia falar de um número diferente do que está na
 * tela, e uma resposta que não bate com a célula ao lado não vale nada.
 *
 * E vai além delas em um ponto: aqui a página entrega a PRÓPRIA função de leitura
 * (`valorDaLinha`), a mesma que pintou cada célula da grade. Não há cópia da
 * regra de soma para ficar para trás — foi assim que "Receita Recorrente caiu
 * -1,13M" foi parar numa célula que mostrava 1,23M.
 * ========================================================================== */

import { supabase } from "@/integrations/supabase/client";
import { fontesDaCelula } from "@/lib/justificativas";
import type { Node } from "@/lib/demonstracoes-schema";

/** Meses de história da célula que acompanham a pergunta. */
export const MESES_DE_SERIE = 12;

/** A leitura da página: o valor que a célula MOSTRA, já com filhos somados. */
export type ValorDaLinha = (node: Node, col: string) => number | null;

export type PayloadPergunta = {
  tipo: "dre" | "dfc";
  rubrica: string;
  mes: string;
  mesAnterior: string | null;
  fontes: string[];
  valor: number | null;
  valorAnterior: number | null;
  despesa: boolean;
  travado: boolean;
  /** linha de %, cujo "valor" é razão e não dinheiro */
  percentual: boolean;
  serie: { mes: string; valor: number | null }[];
  filhos: { rubrica: string; valor: number | null; valorAnterior: number | null }[];
  resumoMes: { rubrica: string; valor: number | null; valorAnterior: number | null }[];
};

function achatar(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => [n, ...(n.children ? achatar(n.children) : [])]);
}

/** O nó do esquema com este rótulo — o primeiro, como a grade renderiza. */
export function acharNo(schema: Node[], rubrica: string): Node | null {
  const alvo = rubrica.trim().toLowerCase();
  return achatar(schema).find((n) => n.label.trim().toLowerCase() === alvo) ?? null;
}

/**
 * O dossiê da célula que vai junto com a pergunta.
 *
 * `resumoMes` são só as linhas de PRIMEIRO NÍVEL do demonstrativo, e existe para
 * uma resposta poder dizer "não subiu aqui porque foi parar ali" sem inventar.
 * Mandar a demonstração inteira seria convite para o modelo responder sobre
 * qualquer outra linha; mandar nada deixaria toda pergunta de linha calculada
 * (EBITDA, margem) sem chão nenhum.
 *
 * As linhas de percentual ficam de fora de `filhos` e `resumoMes`: o valor delas
 * é uma razão, e no meio de uma lista de reais viraria "R$ 0,42".
 */
export function montarPergunta(opts: {
  tipo: "dre" | "dfc";
  schema: Node[];
  rubrica: string;
  mes: string;
  colunas: string[];
  valorDaLinha: ValorDaLinha;
  despesa: boolean;
  travado: boolean;
  /** o que a célula mostra AGORA; quando omitido, lê pelo esquema */
  valorNaTela?: number | null;
}): PayloadPergunta | null {
  const { schema, rubrica, mes, colunas, valorDaLinha } = opts;
  const node = acharNo(schema, rubrica);
  if (!node) return null;

  const i = colunas.indexOf(mes);
  const mesAnterior = i > 0 ? colunas[i - 1] : null;
  const ateAqui = i >= 0 ? colunas.slice(0, i + 1) : colunas;
  const serie = ateAqui.slice(-MESES_DE_SERIE).map((col) => ({ mes: col, valor: valorDaLinha(node, col) }));

  const dinheiro = (n: Node) => n.kind !== "percent";
  const doMes = (n: Node) => ({
    rubrica: n.label,
    valor: valorDaLinha(n, mes),
    valorAnterior: mesAnterior ? valorDaLinha(n, mesAnterior) : null,
  });

  return {
    tipo: opts.tipo,
    rubrica: node.label,
    mes,
    mesAnterior,
    // Numa linha somada os lançamentos estão nas folhas: o DE-PARA do Omie aponta
    // para "Equipe Comercial", nunca para "Pessoal".
    fontes: fontesDaCelula(node),
    valor: opts.valorNaTela !== undefined ? opts.valorNaTela : valorDaLinha(node, mes),
    valorAnterior: mesAnterior ? valorDaLinha(node, mesAnterior) : null,
    despesa: opts.despesa,
    travado: opts.travado,
    percentual: node.kind === "percent",
    serie,
    filhos: (node.children ?? []).filter(dinheiro).map(doMes),
    resumoMes: schema.filter(dinheiro).map(doMes),
  };
}

export type DriverPergunta = {
  contraparte: string;
  categoria?: string | null;
  atual: number;
  anterior: number;
  delta: number;
  movimento: "entrou" | "saiu" | "aumentou" | "reduziu" | "igual";
  fmtAtual?: string;
  fmtAnterior?: string;
  fmtDelta?: string;
};

export type Pergunta = {
  id: string;
  tipo: "dre" | "dfc";
  rubrica: string;
  mes: string;
  mes_anterior: string | null;
  pergunta: string;
  resposta: string;
  valor: number | null;
  valor_anterior: number | null;
  travado: boolean;
  drivers: DriverPergunta[];
  dados: { lancamentos?: number; omitidos?: number; contrapartes?: number; diferenca_contra_tela?: number } | null;
  confianca: "alta" | "media" | "baixa" | null;
  autor_email: string | null;
  criado_em: string;
};

/**
 * O motivo de verdade quando a função responde fora do 2xx.
 *
 * `functions.invoke` joga fora o CORPO da resposta nesse caso e entrega só
 * "Edge Function returned a non-2xx status code" — foi o que apareceu na tela
 * quando o Gemini devolveu 429 por cota. O corpo continua acessível no
 * `context` (a Response original), e é lá que está a frase que explica.
 */
async function motivoDoErro(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  try {
    if (ctx && typeof ctx.json === "function") {
      const corpo = await ctx.json() as { error?: string; message?: string; detail?: string };
      const msg = corpo?.error ?? corpo?.message;
      if (msg) return String(msg) + (corpo?.detail ? ` — ${String(corpo.detail).slice(0, 300)}` : "");
    }
  } catch { /* o corpo não era JSON — fica a mensagem genérica */ }
  return (error as Error)?.message ?? String(error);
}

/**
 * Manda a pergunta. Devolve a linha gravada — o fio da célula é servidor acima,
 * não estado local: a resposta que a Júlia obteve tem de aparecer para o Henrique.
 */
export async function perguntar(payload: PayloadPergunta & { pergunta: string }): Promise<Pergunta> {
  const { data, error } = await supabase.functions.invoke("demonstracoes-perguntar", { body: payload });
  if (error) throw new Error(await motivoDoErro(error));
  const erro = (data as { error?: string })?.error;
  if (erro) throw new Error(erro);
  const linha = (data as { pergunta?: Pergunta })?.pergunta;
  if (!linha) throw new Error("A função respondeu sem a pergunta gravada.");
  return {
    ...linha,
    drivers: Array.isArray(linha.drivers) ? linha.drivers : [],
  };
}
