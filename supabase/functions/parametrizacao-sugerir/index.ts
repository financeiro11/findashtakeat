// Edge Function: parametrizacao-sugerir
//
// Propõe o APELIDO de uma contraparte — o nome que ela tem para nós.
//
// POR QUE EXISTE: são ~700 contrapartes (336 lojistas de cartão + 361
// fornecedores do Omie) e digitar 700 nomes do zero é trabalho que ninguém
// termina. Boa parte delas o modelo reconhece de cara ("LICENCA INHIRE" é a
// licença do ATS; "WALICHAT" é API de WhatsApp) e o que sobra é a minoria que
// exige memória da casa.
//
// O QUE ELA NÃO FAZ: adivinhar. "JIM.COM GRUPO SOUZA" é um pagamento via
// sub-adquirente para um lojista em Mogi das Cruzes — o modelo não tem como
// saber que é o café do evento, e fingir que sabe seria pior do que calar. Por
// isso todo item volta com `confianca`, e "baixa" quer dizer "isto aqui é
// leitura do nome, não conhecimento": a tela mostra o selo e a pessoa decide.
//
// A saída NUNCA grava nada. Quem grava é a tela, depois de alguém aceitar.
//
// Body: { contrapartes: [{ nome, origem, categoria, cidade, lancamentos, total,
//                          primeira, ultima, exemplos? }] }
// Resposta: { sugestoes: [{ nome, apelido, o_que_e, confianca }] }

import { requireUser } from "../_shared/auth.ts";
import { generateJSON, handleCors, jsonResponse, errorResponse } from "../_shared/openai.ts";

/** Teto por chamada: lote grande estoura o tempo da função e o corte por tokens. */
const MAX_LOTE = 30;

type Entrada = {
  nome?: string;
  origem?: string;
  categoria?: string | null;
  cidade?: string | null;
  lancamentos?: number;
  total?: number;
  primeira?: string | null;
  ultima?: string | null;
  exemplos?: (string | null)[];
};

const ESQUEMA = {
  type: "object",
  properties: {
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nome: { type: "string", description: "O nome cru, copiado EXATAMENTE como veio na entrada." },
          apelido: { type: "string", description: "Nome curto e legível, 2 a 4 palavras." },
          o_que_e: { type: "string", description: "Uma frase dizendo o que a empresa faz / o que se compra dela." },
          confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        },
        required: ["nome", "apelido", "o_que_e", "confianca"],
      },
    },
  },
  required: ["sugestoes"],
};

const SISTEMA = `Você nomeia contrapartes financeiras de uma empresa brasileira de tecnologia
para restaurantes (Takeat, sediada em Vitória/ES).

Recebe o nome como o extrato bancário ou a fatura de cartão o entrega — truncado,
sem acento, às vezes com o nome do sub-adquirente na frente (JIM.COM, PAGSEGURO,
MERCADOPAGO, SUMUP, STONE, CIELO, REDE). Devolve o nome que uma pessoa usaria numa
reunião.

REGRAS
1. Copie \`nome\` EXATAMENTE como veio. É a chave que liga a sugestão à linha.
2. \`apelido\`: 2 a 4 palavras, em português, com a caixa arrumada. Prefira a marca
   conhecida ao nome jurídico ("Anthropic", não "ANTHROPIC PBC"). Não repita o
   sufixo societário nem a cidade.
3. \`o_que_e\`: UMA frase curta dizendo o que a empresa faz ou o que se compra
   dela. Nada de repetir o valor nem a quantidade de lançamentos — isso já está
   na tela.
4. \`confianca\`:
   • "alta"  — você reconhece a empresa pelo nome, sem depender do contexto.
   • "media" — o nome mais a categoria/cidade tornam a leitura bastante provável.
   • "baixa" — você está apenas limpando o texto. USE ISTO SEMPRE que o nome for
     genérico, iniciais, um nome de pessoa desconhecido, ou vier atrás de um
     sub-adquirente. Nestes casos o \`o_que_e\` deve descrever o que dá para
     AFIRMAR ("lojista em Mogi das Cruzes, categoria Eventos e Feiras"), nunca
     um palpite sobre o ramo.
5. Nunca invente CNPJ, contrato, valor ou nome de pessoa da Takeat.

É melhor um "baixa" honesto do que um "alta" errado: quem lê vai confiar no selo.`;

function descrever(c: Entrada): string {
  const partes = [
    `nome: ${c.nome}`,
    `origem: ${c.origem === "cartao" ? "fatura de cartão de crédito" : "conta a pagar no ERP Omie"}`,
    c.categoria ? `categoria hoje: ${c.categoria}` : null,
    c.cidade ? `cidade no extrato: ${c.cidade}` : null,
    c.lancamentos ? `${c.lancamentos} lançamento(s)` : null,
    c.total ? `total R$ ${Number(c.total).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : null,
    c.primeira && c.ultima ? `de ${c.primeira} a ${c.ultima}` : null,
    c.exemplos?.length ? `linhas do extrato: ${c.exemplos.filter(Boolean).slice(0, 5).join(" | ")}` : null,
  ].filter(Boolean);
  return `- ${partes.join("; ")}`;
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = await req.json().catch(() => ({}));
    const entrada: Entrada[] = Array.isArray(body?.contrapartes) ? body.contrapartes : [];
    const lote = entrada.filter((c) => String(c?.nome ?? "").trim()).slice(0, MAX_LOTE);

    if (!lote.length) return jsonResponse({ sugestoes: [] });

    /* Sem `model`: o helper resolve por OPENAI_MODEL. Fixar o modelo no call
       site é o que deixou funções para trás na última migração de motor. */
    const resposta = await generateJSON<{ sugestoes?: unknown[] }>({
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: `Nomeie estas ${lote.length} contrapartes:\n\n${lote.map(descrever).join("\n")}` },
      ],
      responseSchema: ESQUEMA,
      temperature: 0.2,
      maxTokens: 200 * lote.length + 500,
    });

    /* Só volta o que casa com um nome pedido: o modelo às vezes reescreve a
       chave, e sugestão sem linha correspondente vira lixo silencioso na tela. */
    const pedidos = new Map(lote.map((c) => [String(c.nome).trim().toUpperCase(), String(c.nome)]));
    const sugestoes = (resposta?.sugestoes ?? [])
      .map((s) => s as Record<string, unknown>)
      .map((s) => {
        const nome = pedidos.get(String(s?.nome ?? "").trim().toUpperCase());
        const apelido = String(s?.apelido ?? "").trim();
        if (!nome || apelido.length < 2) return null;
        return {
          nome,
          apelido,
          o_que_e: String(s?.o_que_e ?? "").trim() || null,
          confianca: ["alta", "media", "baixa"].includes(String(s?.confianca))
            ? String(s.confianca) : "baixa",
        };
      })
      .filter(Boolean);

    return jsonResponse({ sugestoes, pedidas: lote.length });
  } catch (e) {
    return errorResponse(e);
  }
});
