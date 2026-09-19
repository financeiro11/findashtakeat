// Edge Function: ponto-equilibrio-ia
//
// A IA do painel "Classificação de custos · ponto de equilíbrio" (DRE › Análises).
// Duas formas de uso, na mesma chamada:
//   • sem `pergunta`  → revisa a classificação inteira e aponta o que mudaria;
//   • com `pergunta`  → responde a dúvida ("Servidor é fixo ou variável?") e,
//                       se couber, propõe a mudança.
//
// A IA PROPÕE, A PESSOA APLICA. Esta função não grava nada: a sugestão volta
// para a tela, que mostra o impacto no equilíbrio e só reclassifica no clique —
// a mesma gravação rubrica a rubrica de sempre (`ponto_equilibrio_classificacao`).
//
// NÚMERO NÃO É DA IA. O comportamento de cada rubrica contra a receita
// (correlação, elasticidade, variação, % da receita) é calculado na tela por
// `sinaisDasRubricas` (src/lib/pontoEquilibrio.ts, com testes) e chega pronto.
// O modelo argumenta sobre esses números; não produz nenhum.
//
// Body:
//   { mesRef: "Aug-26",
//     resultado: { receita, fixos, variaveis, mcPct, pe },
//     receitaSerie: [{ mes, receita }],
//     rubricas: [{ rubrica, grupo, atual, padrao, valorRef, meses, pctReceita,
//                  correlacao, elasticidade, variacao, comportamento }],
//     pergunta?: string,
//     historico?: [{ pergunta, resposta }] }
//
// Resposta: { resposta, sugestoes: [{ rubrica, bucket, motivo, confianca }] }
// ou { error } com status 200 (falha de IA não é a função quebrando).

import { requireUser, AuthError } from "../_shared/auth.ts";
import { generateJSON, handleCors, jsonResponse, errorResponse } from "../_shared/openai.ts";

type Bucket = "variavel" | "fixo" | "fora";
const BUCKETS: Bucket[] = ["variavel", "fixo", "fora"];

type RubricaIn = {
  rubrica: string; grupo: string; atual: Bucket; padrao: Bucket; valorRef: number;
  meses: number; pctReceita: number | null; correlacao: number | null;
  elasticidade: number | null; variacao: number | null; comportamento: string;
};

const REGRAS = `Você ajuda o time financeiro da Takeat (SaaS B2B) a classificar as rubricas da DRE para o cálculo do PONTO DE EQUILÍBRIO:

  margem de contribuição % = (receita − custos variáveis) ÷ receita
  ponto de equilíbrio (R$) = custos e despesas fixos ÷ margem de contribuição %

Regime de competência. As três classes:
- "variavel": custo que existe POR venda, por cliente ou por real faturado — imposto sobre faturamento, taxa de meio de pagamento, CMV, infra que escala por cliente, comissão/premiação paga por venda nova.
- "fixo": acontece independente do faturamento do mês — folha, benefícios, encargos, aluguel, software de uso interno, assessorias, marketing de marca.
- "fora": não entra na conta — imposto sobre LUCRO (IRPJ, CSLL, IRF: no ponto de equilíbrio o lucro é zero), itens não recorrentes, estornos e créditos.

Convenções do Hub: depreciação nasce "fixo" (ponto de equilíbrio contábil; em "fora" vira o de caixa). Rubrica fora do catálogo nasce "fora" e deve ser olhada.

COMO DECIDIR:
1. O critério é CAUSAL, não estatístico: variável é o que se paga PORQUE vendeu. Numa SaaS em crescimento a folha sobe junto com a receita por contratação — correlação alta não faz a equipe virar variável. Use o sinal como evidência, não como veredito.
2. O sinal de cada rubrica foi CALCULADO PELO SISTEMA sobre os últimos meses: "comportamento" (acompanha / estavel / irregular / sem_dado), correlação com a receita, elasticidade (quanto % a rubrica anda quando a receita anda 1%; ~1 é proporcional, ~0 é parada), variação (desvio ÷ média) e % da receita. Cite esses números quando forem o argumento. NUNCA invente número que não esteja nos dados.
3. Poucos meses, receita quase parada ou comportamento "sem_dado" ⇒ o sinal é fraco: diga isso e use confiança "baixa" se a decisão depender dele.
4. Custo misto (parte fixa, parte variável — ex.: servidor com base mínima): a conta só aceita uma classe; escolha a que pesa mais e diga que é misto.
5. Rubrica com valor zero no mês não muda o número de hoje; só comente se a pergunta for sobre ela.

O QUE DEVOLVER:
- "resposta": texto curto em português do Brasil, direto, sem floreio (até ~6 frases). Sem pergunta: resuma o que está bem classificado e o que você mudaria. Com pergunta: responda a pergunta.
- "sugestoes": só as rubricas em que você MUDARIA a classe atual — ou, se a pergunta for sobre rubricas específicas, essas também (mesmo que seja para manter). Use o nome EXATO da rubrica como veio. "motivo" em uma ou duas frases, com o número do sinal quando ele sustentar. "confianca": alta | media | baixa.
- Você não aplica nada: quem aplica é a pessoa, pela tela. Não diga que alterou.
- Pergunta fora do assunto (classificação de custos, margem de contribuição, ponto de equilíbrio, DRE): diga em uma frase que só ajuda com isso e devolva "sugestoes" vazio.`;

const SCHEMA = {
  type: "object",
  properties: {
    resposta: { type: "string" },
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rubrica: { type: "string" },
          bucket: { type: "string", enum: BUCKETS },
          motivo: { type: "string" },
          confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        },
        required: ["rubrica", "bucket", "motivo", "confianca"],
      },
    },
  },
  required: ["resposta", "sugestoes"],
};

const n = (v: unknown): number | null => {
  const x = Number(v);
  return v === null || v === undefined || !Number.isFinite(x) ? null : x;
};
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
const bucketOk = (v: unknown): v is Bucket => BUCKETS.includes(v as Bucket);

function motivoDaIA(e: unknown): string {
  const err = e as { status?: number; message?: string };
  if (err?.status === 402) return err.message ?? "O teto de uso de IA do mês foi atingido.";
  if (err?.status === 429) return "A IA recusou a chamada por cota (429). Espere um pouco e tente de novo.";
  return `A IA não respondeu${err?.status ? ` (${err.status})` : ""}: ${err?.message ?? String(e)}`;
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    // A capacidade da tela onde o card mora (DRE), lida da matriz de perfis.
    const caller = await requireUser(req);
    if (!caller.isService && !caller.pode("demonstracoes")) {
      throw new AuthError("Você não tem permissão para esta ação.");
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mesRef = String(body?.mesRef ?? "").trim();
    const pergunta = String(body?.pergunta ?? "").trim();
    if (!/^[A-Za-z]{3}-\d{2}$/.test(mesRef)) return jsonResponse({ error: "mesRef inválido (esperado 'Aug-26')." }, 200);
    if (pergunta.length > 1500) return jsonResponse({ error: "Pergunta longa demais (máx. 1500 caracteres)." }, 200);

    const rubricas: RubricaIn[] = (Array.isArray(body?.rubricas) ? body.rubricas : [])
      .slice(0, 150)
      .map((r: any) => ({
        rubrica: String(r?.rubrica ?? "").trim().slice(0, 120),
        grupo: String(r?.grupo ?? "").trim().slice(0, 80),
        atual: bucketOk(r?.atual) ? r.atual : "fora",
        padrao: bucketOk(r?.padrao) ? r.padrao : "fora",
        valorRef: n(r?.valorRef) ?? 0,
        meses: n(r?.meses) ?? 0,
        pctReceita: n(r?.pctReceita),
        correlacao: n(r?.correlacao),
        elasticidade: n(r?.elasticidade),
        variacao: n(r?.variacao),
        comportamento: String(r?.comportamento ?? "sem_dado").slice(0, 20),
      }))
      .filter((r: RubricaIn) => r.rubrica);
    if (!rubricas.length) return jsonResponse({ error: "Nenhuma rubrica enviada." }, 200);
    const porNome = new Map(rubricas.map((r) => [r.rubrica, r]));

    const res = body?.resultado ?? {};
    const serie = (Array.isArray(body?.receitaSerie) ? body.receitaSerie : [])
      .slice(-24)
      .map((s: any) => ({ mes: String(s?.mes ?? ""), receita: Math.round(n(s?.receita) ?? 0) }));
    const historico = (Array.isArray(body?.historico) ? body.historico : [])
      .slice(-4)
      .map((h: any) => ({
        pergunta: String(h?.pergunta ?? "").slice(0, 600),
        resposta: String(h?.resposta ?? "").slice(0, 1500),
      }));

    const dados = {
      mes_de_referencia: mesRef,
      resultado_do_mes: {
        receita: Math.round(n(res?.receita) ?? 0),
        custos_variaveis: Math.round(n(res?.variaveis) ?? 0),
        custos_fixos: Math.round(n(res?.fixos) ?? 0),
        margem_contribuicao_pct: r1(n(res?.mcPct)),
        ponto_equilibrio: n(res?.pe) === null ? "não existe" : Math.round(n(res?.pe)!),
      },
      receita_por_mes: serie,
      rubricas: rubricas.map((r) => ({
        rubrica: r.rubrica,
        grupo: r.grupo,
        classe_atual: r.atual,
        classe_padrao_do_hub: r.padrao,
        valor_no_mes: Math.round(r.valorRef),
        meses_com_valor: r.meses,
        pct_da_receita: r2(r.pctReceita),
        correlacao: r2(r.correlacao),
        elasticidade: r2(r.elasticidade),
        variacao: r2(r.variacao),
        comportamento: r.comportamento,
      })),
    };

    const conversa = historico.length
      ? "\n\nCONVERSA ATÉ AQUI (mais antiga primeiro) — a pergunta de agora pode continuar dela:\n"
        + historico.map((h, i) => `${i + 1}. P: ${h.pergunta}\n   R: ${h.resposta}`).join("\n")
      : "";
    const pedido = pergunta
      ? `PERGUNTA: ${pergunta}`
      : "PEDIDO: revise a classificação inteira e diga o que você mudaria.";

    const chamar = () => generateJSON<{ resposta?: string; sugestoes?: any[] }>({
      consumidor: "dre_dfc",
      userId: caller.userId,
      temperature: 0.2,
      responseSchema: SCHEMA,
      messages: [
        { role: "system", content: REGRAS },
        { role: "user", content: `${pedido}${conversa}\n\nDADOS:\n${JSON.stringify(dados)}` },
      ],
    });

    let out: { resposta?: string; sugestoes?: any[] } | null = null;
    try {
      out = await chamar();
    } catch (e) {
      if ((e as { status?: number })?.status === 402) return jsonResponse({ error: motivoDaIA(e) }, 200);
      // Rajada costuma passar na segunda, com pausa.
      await new Promise((r) => setTimeout(r, 3000));
      try {
        out = await chamar();
      } catch (e2) {
        console.error("ponto-equilibrio-ia: IA falhou", e2);
        return jsonResponse({ error: motivoDaIA(e2) }, 200);
      }
    }

    /* Nada do modelo é aceito de palavra: rubrica que não foi enviada é
       descartada (nome inventado ou reescrito), classe fora do enum também, e
       cada rubrica aparece uma vez só. */
    const vistas = new Set<string>();
    const sugestoes = (Array.isArray(out?.sugestoes) ? out!.sugestoes : [])
      .map((s) => ({
        rubrica: String(s?.rubrica ?? "").trim(),
        bucket: s?.bucket,
        motivo: String(s?.motivo ?? "").trim(),
        confianca: ["alta", "media", "baixa"].includes(s?.confianca) ? s.confianca : "media",
      }))
      .filter((s) => {
        if (!porNome.has(s.rubrica) || !bucketOk(s.bucket) || vistas.has(s.rubrica)) return false;
        vistas.add(s.rubrica);
        return true;
      })
      .map((s) => ({ ...s, atual: porNome.get(s.rubrica)!.atual }));

    const resposta = String(out?.resposta ?? "").trim();
    if (!resposta && !sugestoes.length) return jsonResponse({ error: "A IA devolveu uma resposta vazia. Tente de novo." }, 200);

    return jsonResponse({ resposta, sugestoes });
  } catch (e) {
    if (e instanceof AuthError) return jsonResponse({ error: e.message }, 200);
    return errorResponse(e);
  }
});
