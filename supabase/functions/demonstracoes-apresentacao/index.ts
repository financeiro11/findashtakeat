// Edge Function: demonstracoes-apresentacao
//
// Traduz "tira o caixa e põe o churn depois da DRE" em COMANDOS sobre o roteiro
// da apresentação da Revisão do Mês.
//
// POR QUE COMANDOS, E NÃO O ROTEIRO PRONTO
//   Pedir o documento inteiro de volta convida a IA a reescrever o que ninguém
//   mandou mexer: some uma folha, um card troca de chave, e a pessoa só descobre
//   no meio da reunião. Comando é auditável — o cliente aplica um a um
//   (`lib/apresentacao.ts`, com teste), RECUSA o que não casa com o catálogo e
//   mostra a mudança proposta antes de gravar qualquer coisa.
//
//   Ou seja: a IA aqui não monta a apresentação. Ela só entende o pedido. Quem
//   monta é código determinístico, e é por isso que um pedido mal interpretado
//   vira uma linha vermelha na tela em vez de uma folha perdida.
//
// A IA NÃO INVENTA CARD. O catálogo chega no prompt e é a lista fechada do que
// existe naquele mês; pedir "põe o gráfico de cohort" devolve uma recusa, não um
// card fantasma. O que ela PODE criar do nada é peça de texto e de série, que
// são justamente as duas que não dependem do catálogo.

import { requireUser } from "../_shared/auth.ts";
import {
  generateJSON, handleCors, jsonResponse, errorResponse, DEFAULT_MODEL,
} from "../_shared/openai.ts";

type ItemCatalogo = {
  chave: string; rotulo: string; bloco: string; vazio?: boolean;
  /* Cards que andam colados (os quatro KPIs do resultado, as rubricas do
     Pareto). Cada um é peça própria — dá para tirar um e deixar os outros —,
     então "tira os KPIs" é um comando POR MEMBRO, e não um só. */
  grupo?: string; grupoRotulo?: string;
};
type Peca =
  | { id: string; tipo: "card"; chave: string }
  | { id: string; tipo: "texto"; titulo: string; corpo: string }
  | { id: string; tipo: "serie"; titulo: string; rubrica: string; meses: number; formato: string };
type Roteiro = { folhas: { id: string; titulo: string; pecas: Peca[] }[] };

const ESQUEMA = {
  type: "object",
  properties: {
    resumo: { type: "string" },
    comandos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          acao: {
            type: "string",
            enum: ["remover", "adicionar", "mover", "nova-folha", "remover-folha",
                   "renomear-folha", "texto", "serie"],
          },
          alvo: { type: "string" },
          chave: { type: "string" },
          folha: { type: "string" },
          posicao: { type: "integer" },
          titulo: { type: "string" },
          corpo: { type: "string" },
          depoisDe: { type: "string" },
          rubrica: { type: "string" },
          meses: { type: "integer" },
          formato: { type: "string", enum: ["barra", "linha"] },
        },
        required: ["acao"],
      },
    },
  },
  required: ["comandos"],
};

const ESTILO = [
  "Você organiza a APRESENTAÇÃO mensal de resultados da Takeat para a reunião de tracker com o CEO.",
  "Recebe o roteiro atual (folhas e peças), o catálogo de cards disponíveis e um pedido em português.",
  "Devolve APENAS os comandos que executam o pedido — nada além do que foi pedido.",
  "",
  "REGRAS DURAS",
  "· Só use `chave` que esteja no catálogo. Não invente card. Se o pedido for por algo que não existe,",
  "  não devolva comando para ele e explique no `resumo`.",
  "· `alvo` e `folha` podem ser o id, a chave do card ou o TÍTULO — o que for mais claro.",
  "· Não reordene, não renomeie e não remova nada que o pedido não tenha citado.",
  "· `posicao` é o índice na folha começando em 0; omita para jogar no fim.",
  "· 'depois da X' = posição logo após a peça X; se X está numa folha, use a folha de X.",
  "· FILEIRA (os cards marcados com fileira \"...\"): cada membro é uma peça. Um pedido sobre a fileira",
  "  inteira ('tira os KPIs do caixa') vira um comando POR MEMBRO; um pedido sobre um membro",
  "  ('tira só o SG&A') mexe só nele e deixa os outros onde estão.",
  "· Peça de TEXTO: escreva o `corpo` você mesmo, em português, curto (1 a 3 frases), no tom de",
  "  quem apresenta resultado — sem enfeite e sem inventar número. Se o pedido não der o conteúdo,",
  "  escreva um rascunho curto que a pessoa possa corrigir.",
  "· Peça de SÉRIE: `rubrica` tem de ser um rótulo de linha da DRE (ex.: 'EBITDA', 'Receita Bruta',",
  "  'Pessoal'). `meses` padrão 12. `formato` padrão 'barra'.",
  "",
  "`resumo`: uma frase dizendo o que você fez, em português, para a pessoa conferir antes de aplicar.",
].join("\n");

/** O roteiro em texto: mais curto que o JSON e mais fácil de a IA acertar. */
function descreverRoteiro(r: Roteiro, catalogo: ItemCatalogo[]): string {
  const rotulo = (p: Peca) =>
    p.tipo === "card"
      ? `${catalogo.find((c) => c.chave === p.chave)?.rotulo ?? p.chave} [${p.chave}]`
      : p.tipo === "texto" ? `texto: "${p.titulo}"` : `série: "${p.titulo}"`;
  if (!r.folhas.length) return "(a apresentação está vazia)";
  return r.folhas
    .map((f, i) => `Folha ${i + 1} — "${f.titulo}" (id ${f.id})\n`
      + (f.pecas.length
        ? f.pecas.map((p, k) => `   ${k}. ${rotulo(p)} (id ${p.id})`).join("\n")
        : "   (vazia)"))
    .join("\n");
}

/* Nenhum pedido de verdade mexe em vinte peças de uma vez. O teto existe contra
   o caso patológico: com saída estruturada, um pedido composto pode fazer o
   modelo entrar em loop enchendo o array até o limite de tokens — foi assim que
   esta função ficou 150s pendurada e morreu de 504 em 11/08/26. */
const TETO_COMANDOS = 20;

/* Modo estrito da OpenAI devolve TODA chave do schema, com `null` no que não se
   aplica: um "remover" vem com `rubrica: null`, `meses: null` e mais oito. O
   cliente (`lib/apresentacao.ts`) foi escrito contra o Gemini, onde o campo
   simplesmente não vinha — então o null morre aqui, e não lá. */
function semNulos(c: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined));
}

function descreverCatalogo(catalogo: ItemCatalogo[], roteiro: Roteiro): string {
  const dentro = new Set(
    roteiro.folhas.flatMap((f) => f.pecas.filter((p) => p.tipo === "card").map((p) => (p as { chave: string }).chave)),
  );
  const linha = (c: ItemCatalogo) =>
    `· ${c.chave} — ${c.rotulo} (bloco ${c.bloco}${c.grupoRotulo ? `, fileira "${c.grupoRotulo}"` : ""})`
    + (dentro.has(c.chave) ? " [JÁ ESTÁ na apresentação]" : "")
    + (c.vazio ? " [sem dado neste mês]" : "");
  return catalogo.map(linha).join("\n");
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = await req.json().catch(() => ({}));
    const pedido = String(body?.pedido ?? "").trim();
    const roteiro = (body?.roteiro ?? { folhas: [] }) as Roteiro;
    const catalogo = (body?.catalogo ?? []) as ItemCatalogo[];
    const mes = String(body?.mes ?? "");

    if (!pedido) {
      return jsonResponse({ error: "Escreva o que você quer mudar na apresentação." }, 400);
    }
    if (!catalogo.length) {
      return jsonResponse({ error: "O catálogo de cards chegou vazio — não há o que montar." }, 400);
    }

    const out = await generateJSON<{ resumo?: string; comandos?: unknown[] }>({
      temperature: 0.2,
      responseSchema: ESQUEMA,
      maxTokens: 2000,
      messages: [
        { role: "system", content: ESTILO },
        {
          role: "user",
          content: [
            `Mês da revisão: ${mes || "(não informado)"}.`,
            "",
            "ROTEIRO ATUAL",
            descreverRoteiro(roteiro, catalogo),
            "",
            "CATÁLOGO DE CARDS DISPONÍVEIS",
            descreverCatalogo(catalogo, roteiro),
            "",
            "PEDIDO",
            pedido,
          ].join("\n"),
        },
      ],
    });

    const brutos = Array.isArray(out?.comandos) ? out.comandos : [];
    const comandos = brutos.slice(0, TETO_COMANDOS).map((c) => semNulos(c as Record<string, unknown>));
    let resumo = String(out?.resumo ?? "").trim();
    // Corte silencioso lê-se como "fiz tudo": se sobrou comando, quem confirma
    // precisa saber que está vendo só o começo.
    if (brutos.length > TETO_COMANDOS) {
      resumo += ` (mostrando as ${TETO_COMANDOS} primeiras de ${brutos.length} mudanças — peça o resto em outro comando)`;
    }

    return jsonResponse({
      ok: true,
      // Vazio é resposta legítima ("não entendi", "isso não existe"): o cliente
      // mostra o resumo em vez de fingir que aplicou alguma coisa.
      comandos,
      resumo,
      modelo: DEFAULT_MODEL,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("autentic") || msg.includes("permissão")) return jsonResponse({ error: msg }, 401);
    return errorResponse(e);
  }
});
