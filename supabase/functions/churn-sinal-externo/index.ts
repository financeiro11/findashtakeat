// Edge Function: churn-sinal-externo
//
// Pergunta à internet se o cliente que parou de pagar também parou de operar.
//
//   { action: "varrer", limite? }   → a rodada semanal
//   { action: "cliente", cliente_ref } → pergunta sobre um só, sob demanda
//
// POR QUE ISTO EXISTE. O Hub mede churn depois: o cancelamento entra quando o
// cliente cancela. Mas restaurante que fecha deixa rastro na rua antes de deixar
// no financeiro — o Google marca "fechado permanentemente", a página do iFood
// sai do ar, aparece post de despedida. Quem está inadimplente há 60 dias e
// fechou as portas não é cobrança a insistir: é churn que já aconteceu e ainda
// não foi contabilizado. Saber disso muda duas coisas concretas — a régua de
// cobrança para de gastar com quem não existe, e a previsão de receita para de
// contar com um cliente que não vai voltar.
//
// O RESULTADO É INDÍCIO, E O CÓDIGO INTEIRO É ESCRITO PARA NÃO DEIXAR ESQUECER
// DISSO. Nome de restaurante é homônimo com frequência ("Cantina da Nona" existe
// em toda cidade do país), e uma busca confundindo duas pizzarias faria o Hub
// dar por encerrado um cliente ativo. Por isso:
//   • a IA recebe o nome E o documento, e tem `homonimo` como resposta possível;
//   • toda linha guarda os LINKS em que se baseou;
//   • nada é escrito em cadastro nenhum — o desfecho é campo que gente preenche.
//
// UMA BUSCA POR CLIENTE, e só. A tentação é abrir as páginas achadas para ler
// melhor; seriam 3 a 5 créditos por cliente em vez de 2, para uma decisão que
// vai ser humana de qualquer jeito. O snippet do buscador já diz "fechado
// permanentemente" quando é esse o caso — é literalmente o que o Google escreve
// no resultado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, MODELO_LITE } from "../_shared/gemini.ts";
import { buscar, podeGastar, registrarGasto } from "../_shared/firecrawl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Quantos clientes por rodada. Dez por semana são ~40 por mês e ~80 créditos —
 * cabe no quinhão de 150 com folga para as consultas sob demanda.
 *
 * E é o ritmo certo pelo lado humano também: cada linha gerada precisa que
 * ALGUÉM olhe e decida. Cem indícios por semana empilhados sem conferência não
 * valem mais que zero — valem menos, porque a lista grande desanima.
 */
const MAX_POR_RODADA = 10;

/** Quantos resultados por busca. Abaixo de 10 o Firecrawl cobra os mesmos 2
 *  créditos (a conta é por dezena, arredondando para cima), então pedir 5 seria
 *  pagar igual por menos — e a evidência que interessa costuma estar nos
 *  primeiros, mas nem sempre no primeiro. */
const RESULTADOS = 10;

const SCHEMA = {
  type: "object",
  properties: {
    sinal: {
      type: "string",
      description: "fechado | indicio | nada | homonimo",
    },
    resumo: { type: "string", description: "Uma frase em português dizendo o que os resultados mostram." },
    links: { type: "array", items: { type: "string" }, description: "Só os links que sustentam a conclusão." },
  },
  required: ["sinal", "resumo"],
};

const SINAIS = ["fechado", "indicio", "nada", "homonimo"];

interface Leitura { sinal: string; resumo: string; links: string[] }

async function lerResultados(nome: string, doc: string | null, achados: Array<{ url: string; titulo: string; descricao: string }>): Promise<Leitura> {
  const lista = achados
    .map((a, i) => `${i + 1}. ${a.titulo}\n   ${a.url}\n   ${a.descricao}`)
    .join("\n");
  const out = await generateJSON<Partial<Leitura>>({
    model: MODELO_LITE,
    messages: [
      {
        role: "system",
        content:
          "Você avalia se um estabelecimento comercial brasileiro ENCERROU as atividades, a partir de " +
          "resultados de busca. Responda com um dos sinais:\n" +
          "• 'fechado' — algum resultado afirma o encerramento ('fechado permanentemente', 'encerramos', " +
          "'última semana de funcionamento').\n" +
          "• 'indicio' — sugere sem afirmar (perfil sem posts há muito tempo, página fora do ar, " +
          "avaliação recente dizendo que estava fechado).\n" +
          "• 'homonimo' — os resultados são claramente de OUTRO estabelecimento com nome parecido, " +
          "ou de cidade diferente.\n" +
          "• 'nada' — nada nos resultados sugere encerramento. Este é o resultado esperado na maioria " +
          "das vezes; não force sinal onde não há.\n" +
          "Na dúvida entre 'indicio' e 'nada', escolha 'nada'. Quem lê vai agir sobre a sua resposta, e " +
          "um alarme falso custa a cobrança de um cliente que está aberto.",
      },
      {
        role: "user",
        content:
          `Estabelecimento: ${nome}\n` +
          (doc ? `Documento: ${doc}\n` : "") +
          `\nResultados da busca:\n${lista}`,
      },
    ],
    responseSchema: SCHEMA,
    temperature: 0,
    thinking: "low",
  });
  const sinal = String(out?.sinal ?? "nada").toLowerCase();
  return {
    sinal: SINAIS.includes(sinal) ? sinal : "nada",
    resumo: String(out?.resumo ?? "").trim(),
    links: Array.isArray(out?.links) ? out!.links!.filter((l) => typeof l === "string").slice(0, 5) : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "churn-sinal-externo").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    let quem: string | null = null;
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.email ?? null;
    }

    const body = await req.json().catch(() => ({}));
    const limite = Math.min(Number(body?.limite ?? MAX_POR_RODADA), MAX_POR_RODADA);

    /* A FILA VEM DO BANCO. O corte (inadimplente há mais de 30 dias, não
       perguntado no trimestre) é uma regra sobre agregado de cobranças, e
       escrevê-la aqui obrigaria a trazer as 464 cobranças vencidas para a
       memória da função e agrupar no JavaScript. Ver `churn_fila_sinal`. */
    const { data: fila, error } = body?.cliente_ref
      ? await supabase.rpc("churn_fila_sinal", { p_limite: 500 })
          .then((r: any) => ({ data: (r.data ?? []).filter((c: any) => c.cliente_ref === body.cliente_ref), error: r.error }))
      : await supabase.rpc("churn_fila_sinal", { p_limite: limite });
    if (error) throw new Error(error.message);
    if (!fila?.length) {
      return json({ ok: true, perguntados: 0, mensagem: "Ninguém na fila: nenhum inadimplente de mais de 30 dias sem consulta no trimestre." });
    }

    // 2 créditos por busca (a cobrança é por dezena de resultados, para cima).
    const v = await podeGastar(supabase, "churn_sinal", fila.length * 2);
    if (!v.pode) return json({ ok: true, freado: true, perguntados: 0, mensagem: `busca suspensa: ${v.motivo}.` });

    let creditos = 0;
    const achadosRelevantes: any[] = [];
    const saida: any[] = [];

    for (const c of fila) {
      const nome = String(c.cliente_nome ?? "").trim();
      if (!nome) { saida.push({ cliente_ref: c.cliente_ref, pulado: "sem nome no cadastro" }); continue; }

      /* A BUSCA CARREGA AS PALAVRAS DO ENCERRAMENTO. Procurar só pelo nome
         devolveria o cardápio, o iFood e o Instagram — que existem tanto para
         quem está aberto quanto para quem fechou, e não distinguem nada. São as
         palavras do fim que separam os dois casos, e é por isso que elas vão na
         consulta em vez de ficarem só no julgamento da IA. */
      const consulta = `"${nome}" (fechado OR encerrou OR "fechado permanentemente" OR "encerrou as atividades")`;
      const { achados, erro } = await buscar(consulta, RESULTADOS);
      creditos += 2;

      if (erro) { saida.push({ cliente_ref: c.cliente_ref, nome, erro }); continue; }
      if (!achados.length) {
        await supabase.from("churn_sinais").insert({
          cliente_ref: c.cliente_ref, cliente_nome: nome, documento: c.documento,
          sinal: "nada", resumo: "a busca não devolveu resultado nenhum",
          valor_aberto: c.valor_aberto, dias_atraso: c.dias_atraso,
        });
        saida.push({ cliente_ref: c.cliente_ref, nome, sinal: "nada" });
        continue;
      }

      let leitura: Leitura;
      try {
        leitura = await lerResultados(nome, c.documento ?? null, achados);
      } catch (e) {
        /* A IA caiu DEPOIS de a busca ter sido paga. Não gravar nada faria o
           cliente voltar à fila na semana seguinte e pagar a busca de novo;
           gravar 'nada' o esconderia por 90 dias com uma conclusão que ninguém
           tirou. O certo é não gravar e dizer no relatório — o crédito já foi,
           mas a fila continua honesta. */
        saida.push({ cliente_ref: c.cliente_ref, nome, erro: `a IA falhou: ${String(e).slice(0, 80)}` });
        continue;
      }

      await supabase.from("churn_sinais").insert({
        cliente_ref: c.cliente_ref, cliente_nome: nome, documento: c.documento,
        sinal: leitura.sinal, resumo: leitura.resumo || null,
        evidencia: leitura.links.length ? leitura.links : achados.slice(0, 3).map((a) => a.url),
        valor_aberto: c.valor_aberto, dias_atraso: c.dias_atraso,
      });
      saida.push({ cliente_ref: c.cliente_ref, nome, sinal: leitura.sinal, resumo: leitura.resumo });
      if (leitura.sinal === "fechado" || leitura.sinal === "indicio") achadosRelevantes.push({ nome, ...leitura });
    }

    await registrarGasto(supabase, "churn_sinal", creditos, { perguntados: saida.length, achados: achadosRelevantes.length, quem });

    return json({
      ok: true,
      perguntados: saida.length,
      // O número que interessa: quantos merecem os olhos de alguém.
      para_conferir: achadosRelevantes.length,
      creditos,
      resultados: saida,
      mensagem: achadosRelevantes.length
        ? `${achadosRelevantes.length} de ${saida.length} têm sinal público de encerramento — conferir antes de agir.`
        : `${saida.length} consultados, nenhum sinal de encerramento.`,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error("churn-sinal-externo", e);
    return json({ ok: false, erro: String((e as Error)?.message ?? e) }, 500);
  }
});
