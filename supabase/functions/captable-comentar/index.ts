// Edge Function: captable-comentar
//
// Escreve o comentário que aparece ao lado de uma simulação de rodada em
// /captable — a frase que o Excel nunca deu.
//
// COMO FUNCIONA (o mesmo desenho do cartao-recomendar e das justificativas da DRE)
//   1. O simulador (src/pages/captable/simulador.ts) faz a conta INTEIRA no
//      navegador e detecta os sinais com limiares fixos: cruzou 50%, o pool é
//      pré-money, o preço saiu abaixo do da Series A, e por aí.
//   2. Esta função recebe esses fatos JÁ CALCULADOS E FORMATADOS. Ela não faz
//      conta nenhuma. Se fizesse, o número da tela e o número do texto poderiam
//      divergir — e aí nenhum dos dois valeria.
//   3. A IA só REDIGE: explica o que aquele arranjo significa para quem está
//      decidindo, com o vocabulário de quem senta na mesa de negociação.
//
// Body: {
//   base: string,                      // de onde veio o cap table de partida
//   moeda: 'BRL' | 'USD',
//   rodadas: [{                        // uma entrada por rodada simulada
//     nome, preMoney, postMoney, captado, precoPorAcao,
//     pctInvestidores, pctPool, momentoPool, poolAlvoPct,
//     posicoes: [{ nome, pctAntes, pct, delta, investido }]
//   }],
//   sinais: [{ chave, gravidade, titulo, detalhe }],
//   contexto?: string                  // "a última rodada real foi ..." etc.
// }
//
// Resposta: { leitura, pontos: [{titulo, texto}], atencao }

import { requireUser } from "../_shared/auth.ts";
import { generateJSON, handleCors, jsonResponse, errorResponse } from "../_shared/openai.ts";

const ESTILO = `
Você comenta simulações de rodada de investimento para o time financeiro da
Takeat (Henrique e Júlia) e para o CEO (Miguel), no Hub interno da empresa.
A pessoa acabou de mexer num parâmetro — o pre-money, o tamanho do cheque, o
pool, ou acrescentou mais uma rodada — e quer saber o que aquilo quer dizer.

REGRAS DURAS
• Você NÃO faz conta. Todos os números já vêm calculados e formatados no pedido;
  cite-os exatamente como estão escritos. Nunca invente, arredonde ou recalcule
  um número, nem some percentuais.
• Você não escolhe o que é relevante: os sinais já vêm detectados. Seu trabalho é
  explicar o que eles significam na prática e o que a pessoa faria com isso.
• Nada de conselho jurídico ou tributário, e nada de prever o futuro do mercado.
• Português do Brasil, tom de colega experiente — direto, sem jargão de consultoria,
  sem "é importante ressaltar", sem entusiasmo de vendedor.
• Se a simulação for banal (uma rodada pequena, sem cruzar limiar nenhum), diga
  isso em uma frase em vez de inflar o texto.

O QUE ESCREVER
• "leitura": 2 a 4 frases sobre o que ESTA simulação faz com a empresa. Comece
  pelo efeito, não pelo método. Ex.: "O cheque de R$ 25 milhões a 100 de pre-money
  custa 20% do capital e leva o Miguel de 42,97% para 34,38% — ainda o maior
  sócio, mas já sem maioria simples."
• "pontos": de 2 a 4 observações curtas, uma por assunto, cada uma com um título
  de até 6 palavras. Priorize, nesta ordem: perda de controle, quem paga a
  diluição do pool, preço da rodada contra a anterior, concentração do novo
  investidor, diluição acumulada nas rodadas encadeadas.
• "atencao": a única coisa que, se ignorada, estragaria a negociação. Se não
  houver nada digno disso, devolva null — não invente risco.

EXEMPLOS DO TIPO DE OBSERVAÇÃO QUE VALE A PENA
• "Pool pré-money é o pedido padrão do investidor porque ele não paga por ele:
   os 15% saem inteiros de quem já estava na mesa. Puxar essa discussão para
   pós-money vale cerca de 0,6 ponto do fundador."
• "O preço por ação ficou abaixo do da Series A de dezembro: é down round, e
   isso costuma acionar proteção antidiluição de quem entrou antes."
• "A DGF não aparece na lista de cheques desta rodada. Se ela tem pro-rata, ou
   exerce, ou assina o waiver — e isso muda a conta."
`;

const SCHEMA = {
  type: "object",
  properties: {
    leitura: { type: "string" },
    pontos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          texto: { type: "string" },
        },
        required: ["titulo", "texto"],
      },
    },
    atencao: { type: "string" },
  },
  required: ["leitura", "pontos"],
};

interface Posicao { nome: string; pctAntes: string; pct: string; delta: string; investido: string }
interface RodadaPedido {
  nome: string; preMoney: string; postMoney: string; captado: string; precoPorAcao: string;
  pctInvestidores: string; pctPool: string; momentoPool: string; poolAlvoPct: string;
  posicoes: Posicao[];
}
interface Sinal { chave: string; gravidade: string; titulo: string; detalhe: string }

function montarPedido(body: {
  base?: string; moeda?: string; contexto?: string;
  rodadas?: RodadaPedido[]; sinais?: Sinal[];
}): string {
  const linhas: string[] = [];
  linhas.push(`CAP TABLE DE PARTIDA: ${body.base ?? "não informado"}`);
  if (body.contexto) linhas.push(`CONTEXTO: ${body.contexto}`);
  linhas.push("");

  for (const r of body.rodadas ?? []) {
    linhas.push(`## RODADA: ${r.nome}`);
    linhas.push(`Pre-money ${r.preMoney} · captado ${r.captado} · post-money ${r.postMoney}`);
    linhas.push(`Preço por ação ${r.precoPorAcao} · investidores ficam com ${r.pctInvestidores}`);
    linhas.push(`Pool: ${r.momentoPool} · alvo ${r.poolAlvoPct} · pool final ${r.pctPool}`);
    linhas.push("Posições depois desta rodada:");
    for (const p of r.posicoes) {
      const cheque = p.investido && p.investido !== "—" ? ` · pôs ${p.investido}` : "";
      linhas.push(`  • ${p.nome}: ${p.pctAntes} → ${p.pct} (${p.delta})${cheque}`);
    }
    linhas.push("");
  }

  const sinais = body.sinais ?? [];
  if (sinais.length) {
    linhas.push("## SINAIS JÁ DETECTADOS (use-os, não procure outros)");
    for (const s of sinais) {
      linhas.push(`[${s.gravidade}] ${s.titulo} — ${s.detalhe}`);
    }
  } else {
    linhas.push("## SINAIS: nenhum limiar relevante foi cruzado nesta simulação.");
  }

  return linhas.join("\n");
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    await requireUser(req);
    const body = await req.json();

    if (!Array.isArray(body?.rodadas) || body.rodadas.length === 0) {
      return jsonResponse({ error: "Nenhuma rodada para comentar." }, 400);
    }

    const resposta = await generateJSON<{ leitura: string; pontos: { titulo: string; texto: string }[]; atencao?: string | null }>({
      messages: [
        { role: "system", content: ESTILO },
        { role: "user", content: montarPedido(body) },
      ],
      responseSchema: SCHEMA,
      temperature: 0.4,
      maxTokens: 900,
    });

    return jsonResponse({
      leitura: resposta.leitura ?? "",
      pontos: (resposta.pontos ?? []).slice(0, 4),
      atencao: resposta.atencao || null,
    });
  } catch (e) {
    return errorResponse(e);
  }
});
