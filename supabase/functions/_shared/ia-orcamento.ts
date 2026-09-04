// O freio e o razão do consumo de IA.
//
// POR QUE ISTO EXISTE, e por que só agora. Até 29/08/2026 o Hub não media uma
// única chamada de IA: `ai_usage_log` tinha 7 linhas, todas de 07/05/2026,
// porque `user_id` era NOT NULL e toda IA de cron falhava ao gravar. A pergunta
// "as IAs estão sobrecarregadas?" só pôde ser respondida indo aos logs da
// plataforma — de dentro do Hub não havia denominador nenhum.
//
// Isso não doía enquanto eram ~18 chamadas por dia. Passa a doer no momento em
// que se liga trabalho novo de IA em cima de uma fila de 1.439 documentos, que é
// exatamente o que esta leva faz. Instrumentar antes é barato; depois é
// arqueologia.
//
// O FREIO É POR CHAMADAS/DIA. É deliberado, e é diferente do freio do Firecrawl
// (`_shared/firecrawl.ts`), que é por crédito/mês. Lá o risco é o plano pré-pago
// acabar no dia 12. Aqui não há plano a estourar: o risco é VOLUME — uma rodada
// em laço martelando o modelo até ele devolver 503 para todo mundo, inclusive
// para as funções que estavam bem. Chamadas por dia é a unidade que mede esse
// risco; dólares por mês vem junto, mas protege a conta, não a disponibilidade.
//
// A ORDEM DE USO É SEMPRE A MESMA:
//   1. `podeGastarIA(supa, consumidor, quantas)` antes de chamar o modelo;
//   2. `registrarUsoIA(supa, {...})` depois de cada chamada, mesmo se falhou.
//
// GRAVAR NUNCA DERRUBA A RODADA. Falhar ao registrar é ruim (razão furado é teto
// furado), mas derrubar o trabalho já feito por causa do log seria pior.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Quem pode gastar IA. Tem de existir em `public.ia_orcamento`.
 *
 *  O tipo estava três nomes atrás da tabela (que já tinha `email_resposta` e
 *  `automacao_diagnostico`) — e os três nomes de 03/09/2026 são os que gastam de verdade:
 *  leitura de documento é multimodal e se paga por página, não por chamada. */
export type ConsumidorIA =
  | "notas_desempate" | "notas_motivo" | "assistente"
  | "email_resposta" | "automacao_diagnostico"
  | "acervo_leitura" | "anexo_triagem" | "fatura_rateio"
  /* O LADO DA OPENAI, a partir de 03/09/2026. Até aqui o razão só conhecia o Gemini:
     `_shared/openai.ts` lia o `usage` que a API devolve em toda resposta e o jogava fora,
     então as 16 funções que chamam a OpenAI gastavam sem deixar uma linha. Quando
     perguntaram "no que você gastou tanto token da OpenAI?", não havia o que responder de
     dentro do Hub — só contagem de invocação, que não sabe o tamanho do prompt.

     São seis nomes e não dezesseis porque o teto é a unidade de decisão, não a função: um
     freio por função vira dezesseis linhas que ninguém revisa. Agrupa-se pelo que a IA
     está fazendo, que é como se decide se vale a pena. */
  | "dre_dfc"          // justificar, perguntar, revisão, apresentação, projetar cenário
  | "painel_insights"  // os 4 cartões do painel inicial
  | "cartao_recomendar"
  | "rotina_diaria"    // diagnóstico das notas, novidades do Hub, vigia dos sinais
  | "classificacao"    // tarefas, transações, sugestão de parametrização
  | "texto_apoio";     // cap table, insight das assinaturas, leitura de PDF da Biblioteca

export interface VeredictoIA {
  pode: boolean;
  motivo: string;
  usadasHoje: number;
  restaHoje: number;
  tetoDia: number | null;
  gastoMesUsd: number;
}

/**
 * Dá para gastar `quantas` chamadas agora?
 *
 * Falha de leitura FECHA A PORTA, como no freio do Firecrawl: sem razão não há
 * teto, e sem teto não se gasta. É o único lugar onde um erro de banco vira
 * "não", e é de propósito — o alternativo é gastar às cegas.
 */
export async function podeGastarIA(
  supa: SupabaseClient,
  consumidor: ConsumidorIA,
  quantas = 1,
): Promise<VeredictoIA> {
  const vazio = { usadasHoje: 0, restaHoje: 0, tetoDia: null, gastoMesUsd: 0 };

  const { data, error } = await supa.rpc("ia_orcamento_status");
  if (error) {
    return { ...vazio, pode: false, motivo: `não deu para ler o orçamento de IA (${error.message})` };
  }

  const linha = (data ?? []).find((l: any) => l.consumidor === consumidor);
  if (!linha) {
    return { ...vazio, pode: false, motivo: `consumidor "${consumidor}" não está em ia_orcamento` };
  }

  const base = {
    usadasHoje: Number(linha.usadas_hoje ?? 0),
    restaHoje: Number(linha.resta_hoje ?? 0),
    tetoDia: Number(linha.teto_dia),
    gastoMesUsd: Number(linha.gasto_mes_usd ?? 0),
  };

  if (!linha.ativo) {
    return { ...base, pode: false, motivo: `${linha.rotulo} está desligado em ia_orcamento` };
  }

  if (base.restaHoje < quantas) {
    return {
      ...base, pode: false,
      motivo: `${linha.rotulo} já usou ${base.usadasHoje} das ${base.tetoDia} chamadas de hoje`
        + (base.restaHoje > 0 ? ` — restam ${base.restaHoje}, e esta rodada queria ${quantas}` : ""),
    };
  }

  const tetoMes = Number(linha.teto_mes_usd ?? 0);
  if (tetoMes > 0 && base.gastoMesUsd >= tetoMes) {
    return {
      ...base, pode: false,
      motivo: `${linha.rotulo} já gastou US$ ${base.gastoMesUsd.toFixed(2)} dos US$ ${tetoMes.toFixed(2)} do mês`,
    };
  }

  return { ...base, pode: true, motivo: `${base.restaHoje} chamadas disponíveis hoje para ${linha.rotulo}` };
}

/* Preço de reserva quando `ai_model_pricing` não conhece o modelo. A tabela
   está parada em maio/2026 e não tem os nomes atuais (`gemini-3.6-flash`,
   `gpt-4.1-mini`), então estimar por família é mais honesto que somar zero:
   custo zero no razão vira teto de dólar que nunca fecha. Valores em USD por
   milhão de tokens (entrada, saída), deliberadamente por cima.

   A ORDEM IMPORTA: vence a PRIMEIRA que casar. Os nomes da OpenAI vêm antes das
   regras por família porque `gpt-4.1-mini` casaria com `/mini/` e sairia por
   US$ 0,15 — menos de metade do preço real. Um razão que subestima é pior que
   um razão vazio: ele responde com confiança o número errado. */
const PRECO_RESERVA: Array<[RegExp, number, number]> = [
  [/^gpt-4\.1-nano/i, 0.10, 0.40],
  [/^gpt-4\.1-mini/i, 0.40, 1.60],
  [/^gpt-4\.1/i, 2.00, 8.00],
  [/^gpt-4o-mini/i, 0.15, 0.60],
  [/^gpt-4o/i, 2.50, 10.00],
  [/lite|nano|mini/i, 0.15, 0.60],
  [/pro|gpt-5(?!-)/i, 1.25, 10.00],
  [/./, 0.30, 2.50],
];

function custoEstimado(model: string, entrada: number, saida: number): number {
  const [, pin, pout] = PRECO_RESERVA.find(([re]) => re.test(model))!;
  return (entrada / 1e6) * pin + (saida / 1e6) * pout;
}

export interface UsoIA {
  consumidor: ConsumidorIA;
  model: string;
  /** Tokens do pedido e da resposta, quando o provedor informa. */
  promptTokens?: number;
  completionTokens?: number;
  /** Quem pediu. Omitido = foi o servidor. */
  userId?: string | null;
  /** Custo já calculado; sem ele, estima-se pela família do modelo. */
  custoUsd?: number;
}

/**
 * Grava uma chamada no razão. Uma linha por chamada — inclusive as que
 * falharam, porque chamada que falhou consumiu disponibilidade do mesmo jeito e
 * é justamente o que o teto diário existe para conter.
 *
 * Nunca lança.
 */
export async function registrarUsoIA(supa: SupabaseClient, uso: UsoIA): Promise<void> {
  const entrada = Math.max(0, Math.round(uso.promptTokens ?? 0));
  const saida = Math.max(0, Math.round(uso.completionTokens ?? 0));
  const custo = uso.custoUsd ?? custoEstimado(uso.model, entrada, saida);

  const { error } = await supa.from("ai_usage_log").insert({
    user_id: uso.userId ?? null,
    model: uso.model,
    feature: uso.consumidor,
    prompt_tokens: entrada,
    completion_tokens: saida,
    total_tokens: entrada + saida,
    cost_usd: Number(custo.toFixed(6)),
  });
  if (error) console.error("ai_usage_log", uso.consumidor, error.message);
}

/**
 * Quantas chamadas cabem nesta rodada, entre o que a fila pede e o que o teto
 * permite. Devolve 0 quando não dá para gastar — e o chamador responde com o
 * motivo em vez de tentar e falhar.
 */
export function quantasCabem(veredito: VeredictoIA, pedidas: number): number {
  if (!veredito.pode) return 0;
  return Math.max(0, Math.min(pedidas, veredito.restaHoje));
}
