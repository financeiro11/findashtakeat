// Edge Function: vigilancia-mudancas
//
// Lê uma vez por dia as páginas que explicam a despesa — tabela de preços dos
// SaaS, taxas do Asaas — e avisa quando o texto mexe.
//
//   { action: "varrer", limite?, pagina_id? }  → a rodada diária
//   { action: "testar", url }                  → abre uma página e devolve o que viu
//
// A APOSTA É ASSIMÉTRICA, e é isso que justifica a linha no orçamento. Quase
// todo dia a resposta é "nada mudou": 10 créditos gastos para confirmar o
// silêncio. Algumas vezes por ano a resposta é "a Anthropic mexeu na tabela" ou
// "o Asaas mudou a taxa do Pix" — e essa, chegando ANTES da fatura, é a
// diferença entre explicar a variação da DRE em julho e renegociar em maio.
//
// QUEM COMPARA É O FIRECRAWL, NÃO NÓS. O `changeTracking` guarda a versão
// anterior da URL do lado dele e devolve `changeStatus` com o diff pronto no
// formato do `git diff`. Guardar o markdown aqui e comparar na mão seria
// reimplementar isso com o dobro do armazenamento — e o modo git-diff não cobra
// crédito extra: a leitura é 1, a comparação vem junto.
//
// A IA SÓ REDIGE, E SOBRE O DIFF. Ela recebe as linhas que mudaram e escreve uma
// frase; não recebe a página inteira, não decide se o aumento é aceitável e não
// classifica a natureza da mudança — isso é regex sobre o diff, em código, logo
// abaixo. É o mesmo desenho das recomendações do cartão e do radar de preços:
// sinal determinístico, IA na redação.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateText, MODELO_LITE } from "../_shared/gemini.ts";
import { podeGastar, raspar, registrarGasto } from "../_shared/firecrawl.ts";
/* A régua do que vira aviso mora fora daqui, num módulo sem imports, para poder
   ser TESTADA pelo vitest — o mesmo arranjo de `radar-precos.ts`. É a decisão
   que mais precisa de teste nesta função: ela filtra o que chega aos olhos de
   alguém, e um erro nela não aparece como erro, aparece como silêncio. */
import { classificarDiff, vaiVirarAviso } from "../_shared/vigilancia-diff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Quantas páginas por rodada. Dez é o cadastro inteiro de hoje; o limite existe
 * para o dia em que ele crescer sem que ninguém repare no custo — cada página é
 * um crédito, todo dia, e trinta páginas seriam 900 por mês sozinhas.
 */
const MAX_POR_RODADA = 12;

/**
 * De quanto em quanto tempo cada página é relida. Vinte horas, e não vinte e
 * quatro: o cron dispara no mesmo horário todo dia, e um corte de exatamente 24h
 * faria a página lida ontem às 06:00:10 não estar "vencida" às 06:00:00 de hoje
 * — por dez segundos. A cadência diária viraria, na prática, a cada dois dias.
 * É a mesma pegadinha que a fila do radar de preços resolve com uma hora de
 * tolerância.
 */
const HORAS_ENTRE_LEITURAS = 20;

async function resumir(nome: string, oQueOlhar: string | null, diff: string): Promise<string> {
  const trecho = diff.length > 6000 ? diff.slice(0, 6000) : diff;
  try {
    return (await generateText({
      model: MODELO_LITE,
      messages: [
        {
          role: "system",
          content:
            "Você recebe o diff (formato git) de uma página que a empresa acompanha e escreve UMA frase " +
            "em português do Brasil dizendo o que mudou. Seja concreto: se um preço mudou, diga de quanto " +
            "para quanto. NUNCA invente número que não esteja no diff. Se a mudança for irrelevante " +
            "(banner, texto de marketing, data), diga isso em vez de inflar. Não comece com 'A página'.",
        },
        { role: "user", content: `Página: ${nome}\nO que interessa nela: ${oQueOlhar ?? "mudanças de preço"}\n\nDiff:\n${trecho}` },
      ],
      temperature: 0.2,
      thinking: "low",
    })).trim();
  } catch {
    /* A frase é o enrolamento; o diff é o fato. Sem IA o aviso continua de pé —
       ele só chega sem legenda, e quem abrir lê o diff. Trocar isso por uma
       falha faria a rodada perder uma mudança real por causa de um 503. */
    return "";
  }
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
        .select("name").eq("name", "vigilancia-mudancas").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    let quem: string | null = null;
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.email ?? null;
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "varrer";

    /* ------------------------------------------------------------- testar */
    /* Abre UMA página e conta o que viu, sem gravar nada. É como se confere um
       endereço novo antes de deixá-lo no cadastro — e o primeiro uso dele é
       descobrir quais das dez páginas semeadas realmente abrem. */
    if (action === "testar") {
      const url = String(body?.url ?? "").trim();
      if (!url) return json({ ok: false, erro: "Informe { url }." }, 400);
      const v = await podeGastar(supabase, "vigilancia", 1);
      if (!v.pode) return json({ ok: false, freado: true, erro: v.motivo });
      const r = await raspar(url, { rastrearMudanca: true, timeoutMs: 40_000 });
      await registrarGasto(supabase, "vigilancia", 1, { url, acao: "testar", quem });
      return json({
        ok: !r.erro, url, erro: r.erro,
        tamanho: r.markdown.length,
        status: r.mudanca?.status ?? null,
        previa: r.markdown.slice(0, 400),
      });
    }

    if (action !== "varrer") return json({ ok: false, erro: `Ação desconhecida: ${action}` }, 400);

    /* ------------------------------------------------------------- varrer */
    const vencidas = new Date(Date.now() - HORAS_ENTRE_LEITURAS * 3600 * 1000).toISOString();
    let q = supabase.from("vigilancia_paginas")
      .select("id, nome, url, o_que_olhar, ultima_leitura")
      .eq("ativo", true)
      .order("ultima_leitura", { ascending: true, nullsFirst: true })
      .limit(Math.min(Number(body?.limite ?? MAX_POR_RODADA), MAX_POR_RODADA));
    if (body?.pagina_id) q = q.eq("id", Number(body.pagina_id));
    else q = q.or(`ultima_leitura.is.null,ultima_leitura.lt.${vencidas}`);

    const { data: paginas, error } = await q;
    if (error) throw new Error(error.message);
    if (!paginas?.length) {
      return json({ ok: true, lidas: 0, mensagem: "Nenhuma página vencida — todas foram lidas nas últimas horas." });
    }

    const v = await podeGastar(supabase, "vigilancia", paginas.length);
    if (!v.pode) return json({ ok: true, freado: true, lidas: 0, mensagem: `vigilância suspensa: ${v.motivo}.` });

    let lidas = 0, mudaram = 0, avisos = 0;
    const detalhe: Array<Record<string, unknown>> = [];

    /* UMA DE CADA VEZ, e sem pressa. São dez páginas por dia: parte do dia
       inteiro é folga de sobra, e a rajada paralela é justamente o que faz o
       Firecrawl devolver erro de leitura (medido no radar de preços, com nove
       fontes em paralelo: sete falharam). */
    for (const p of paginas) {
      const r = await raspar(p.url, { rastrearMudanca: true, waitFor: 2000, timeoutMs: 40_000 });
      lidas++;

      if (r.erro) {
        /* O ERRO VAI PARA A LINHA DA PÁGINA, não some no log. Uma URL que mudou
           de lugar continuaria "vigiada" para sempre, devolvendo silêncio — e
           silêncio, aqui, se lê como "nada mudou". É o modo de falhar mais
           perigoso desta função, e o único remédio é a tela mostrar. */
        await supabase.from("vigilancia_paginas")
          .update({ ultima_leitura: new Date().toISOString(), ultimo_status: r.erro.slice(0, 300) })
          .eq("id", p.id);
        detalhe.push({ pagina: p.nome, erro: r.erro });
        continue;
      }

      const status = r.mudanca?.status ?? null;
      const diff = r.mudanca?.diff ?? "";
      await supabase.from("vigilancia_paginas")
        .update({ ultima_leitura: new Date().toISOString(), ultimo_status: status ?? "lida" })
        .eq("id", p.id);

      if (status !== "changed" || !diff) {
        detalhe.push({ pagina: p.nome, status: status ?? "lida" });
        continue;
      }
      mudaram++;

      if (!vaiVirarAviso(diff)) {
        detalhe.push({ pagina: p.nome, status: "mudou pouco (ruído de página viva)" });
        continue;
      }

      const natureza = classificarDiff(diff);
      const resumo = await resumir(p.nome, p.o_que_olhar, diff);
      await supabase.from("vigilancia_mudancas").insert({
        pagina_id: p.id,
        resumo: resumo || null,
        natureza,
        // O diff inteiro não cabe num aviso e ninguém lê 200 linhas na tela; o
        // suficiente para conferir a frase da IA, sim.
        diff: diff.slice(0, 20_000),
      });
      avisos++;
      detalhe.push({ pagina: p.nome, status: "mudou", natureza, resumo });
    }

    await registrarGasto(supabase, "vigilancia", lidas, { paginas: lidas, avisos, quem });

    return json({
      ok: true, lidas, mudaram, avisos, detalhe,
      mensagem: avisos
        ? `${avisos} página(s) com mudança que vale olhar.`
        : `${lidas} página(s) lidas, nada que valha aviso.`,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error("vigilancia-mudancas", e);
    return json({ ok: false, erro: String((e as Error)?.message ?? e) }, 500);
  }
});
