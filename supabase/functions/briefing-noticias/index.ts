// Edge Function: briefing-noticias
//
// A rodada da manhã que enche o painel de notícias do briefing.
//
//   { action: "varrer", forcar? }  → a rodada diária (cron, 07:40 BRT)
//   { action: "previa" }           → busca e pontua SEM gravar, para calibrar
//
// POR QUE ESTA FUNÇÃO EXISTE, se a skill de briefing já trazia notícia. Porque a
// skill é um agente com MCP: ela roda quando alguém a roda, e o que ela grava é
// prosa. Prosa não se deduplica, não se marca como lida e não se clica. O painel
// mostrava, todas as manhãs, três parágrafos que podiam ser de hoje ou de
// terça — sem jeito de saber pela tela. A agenda e os e-mails continuam com ela
// (dependem de Gmail e Calendar, que cron nenhum alcança); a notícia, que é só
// busca, cabe num cron e ganha muito em ser item.
//
// QUEM ESCOLHE É `_shared/briefing-noticias.ts`, EM TYPESCRIPT E COM TESTE. A IA
// entra depois do veredito, e só para escrever uma frase sobre o item aprovado.
// É o mesmo desenho da vigilância de páginas, do radar de preços e das
// recomendações do cartão — e aqui ele importa mais que nos outros, porque o
// briefing é lido todo dia: um filtro que muda de humor a cada manhã seria
// impossível de calibrar, e ninguém confia num painel que não sabe explicar por
// que escolheu o que escolheu.
//
// O RELÓGIO. Quatro buscas em série mais seis chamadas de IA cabem folgadas nos
// 150s do worker — mas "cabem folgadas" foi o que se disse do radar antes de ele
// começar a morrer sem exceção. Então há `sobramMs()` antes de cada busca e
// `comPrazo` em toda chamada de IA, e a rodada grava o que já tem em vez de
// perder tudo no fim.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, MODELO_LITE } from "../_shared/gemini.ts";
import { buscar, podeGastar, registrarGasto, saldoFirecrawl } from "../_shared/firecrawl.ts";
import {
  MAX_NA_TELA, PAUTAS, RESULTADOS, chaveDoItem, ehRedirecionador, escolherDoDia, hostDe,
  lerQuando, mesmaNoticia, pontuar,
  type Candidato, type Pauta,
} from "../_shared/briefing-noticias.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** O worker morre por volta dos 150s sem exceção que dê para pegar. */
const LIMITE_WORKER_MS = 120_000;

/** Contra o que se compara para não repetir manchete. Três semanas. */
const DIAS_DE_MEMORIA = 21;

/** Promessa com prazo. O que estoura vira erro NOMEADO, não silêncio. */
function comPrazo<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${oque} não respondeu em ${Math.round(ms / 1000)}s`)), ms); }),
  ]);
}

const SCHEMA_LEGENDA = {
  type: "object",
  properties: {
    muda_algo: {
      type: "boolean",
      description: "true se a notícia muda algo CONCRETO para a Takeat ou para o time financeiro dela.",
    },
    frase: {
      type: "string",
      description: "Uma frase de até 20 palavras, em português do Brasil, dizendo o que muda (ou por que não muda).",
    },
  },
  required: ["muda_algo", "frase"],
};

export interface Legenda {
  /** `null` = a IA não respondeu. Não é "não muda": é "não sei", e não esconde. */
  muda: boolean | null;
  frase: string;
}

/**
 * A legenda do item: a frase de "por que importa" e o veredito de se importa.
 *
 * ELA RECEBE O TÍTULO E O SNIPPET, E MAIS NADA. Não abrimos a matéria — seria 1
 * crédito por item, e o snippet do buscador já diz do que se trata. O prompt
 * proíbe número que não esteja no texto justamente porque a tentação de uma IA
 * lendo "OpenAI reduz preço" é completar com quanto.
 *
 * O VEREDITO VEM JUNTO DA FRASE, DE PROPÓSITO. Pedir os dois na mesma chamada
 * custa uma chamada em vez de duas e, mais importante, garante que o sim/não e
 * a explicação combinem — duas chamadas separadas podem discordar entre si, e
 * aí o card diz "muda o preço da API" com o selo de "não muda nada".
 *
 * Falhar aqui NÃO derruba o item: o link é o fato, a legenda é o enrolamento.
 */
async function legendar(pauta: Pauta, titulo: string, resumo: string, tentativa = 1): Promise<Legenda> {
  try {
    const out = await comPrazo(generateJSON<Partial<Legenda> & { muda_algo?: boolean; frase?: string }>({
      model: MODELO_LITE,
      messages: [
        {
          role: "system",
          content:
            "Você avalia uma notícia para uma empresa brasileira de software para restaurantes (a Takeat) " +
            "e para o time financeiro dela, que roda seus sistemas sobre Gemini, OpenAI, Supabase, Omie e " +
            "Asaas.\n" +
            "Responda dois campos:\n" +
            "• `muda_algo`: true SOMENTE se a notícia obriga ou permite alguma ação concreta — mudou o " +
            "preço de uma ferramenta que a empresa paga, saiu um recurso que substitui trabalho manual " +
            "dela, um concorrente direto se mexeu, uma regra fiscal mudou. Análise de mercado, perfil de " +
            "executivo, previsão e notícia sobre empresa que a Takeat não usa nem enfrenta = false.\n" +
            "• `frase`: até 20 palavras, em português do Brasil, dizendo o que muda — ou, se não muda, " +
            "dizendo em poucas palavras do que se trata. NUNCA invente número, preço ou data que não " +
            "esteja no texto recebido. Não comece com 'Esta notícia'.\n" +
            "Na dúvida, `muda_algo` é false: a maioria das notícias de tecnologia não muda nada para uma " +
            "empresa específica, e um painel que grita todo dia deixa de ser lido.",
        },
        { role: "user", content: `Pauta: ${pauta.rotulo}\nO que interessa nela: ${pauta.oQueImporta}\n\nTítulo: ${titulo}\nResumo: ${resumo}` },
      ],
      responseSchema: SCHEMA_LEGENDA,
      temperature: 0.2,
      thinking: "low",
    }), 25_000, "a legenda da notícia");
    return {
      muda: typeof out?.muda_algo === "boolean" ? out.muda_algo : null,
      frase: String(out?.frase ?? "").trim().slice(0, 400),
    };
  } catch (e) {
    console.warn(`legenda falhou (tentativa ${tentativa}):`, String((e as Error)?.message ?? e));
    /* Uma segunda tentativa, e só. As falhas medidas na estreia foram soluço do
       lado do Gemini (503/limite), não prompt inválido — o mesmo item repetido
       segundos depois passa. Uma terceira tentativa não muda a probabilidade e
       come o relógio do worker. */
    if (tentativa === 1) return legendar(pauta, titulo, resumo, 2);
    return { muda: null, frase: "" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  const sobramMs = () => LIMITE_WORKER_MS - (Date.now() - t0);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "briefing-noticias").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    let quem: string | null = null;
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.email ?? null;
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "varrer";
    const previa = action === "previa";

    /* ------------------------------------------------- testar_busca */
    /* Uma busca crua, com as chaves que o Firecrawl devolveu, sem pontuar e sem
       gravar. Existe pelo mesmo motivo do `testar` da vigilância: quando uma
       consulta volta com zero resultados, "a busca não achou nada" e "a resposta
       veio noutro formato" são indistinguíveis de fora — e a segunda é um
       defeito nosso que ficaria escondido atrás de um painel vazio. Custa 2
       créditos e pergunta ao freio antes. */
    if (action === "testar_busca") {
      const q = String(body?.q ?? "").trim();
      if (!q) return json({ ok: false, erro: "Informe { q }." }, 400);
      const v = await podeGastar(supabase, "briefing_noticias", 2);
      if (!v.pode) return json({ ok: false, freado: true, erro: v.motivo });
      const r = await buscar(q, Number(body?.limite ?? 5), {
        tbs: body?.tbs, fontes: body?.fontes, timeoutMs: 30_000,
      });
      await registrarGasto(supabase, "briefing_noticias", 2, { acao: "testar_busca", q, quem });
      return json({ ok: !r.erro, q, fontes: body?.fontes ?? null, erro: r.erro, chaves: r.chaves, achados: r.achados.length, amostra: r.achados.slice(0, 3) });
    }

    /* ------------------------------------------------------ redigir */
    /* Preenche o "por que importa" do que ficou sem. NÃO GASTA CRÉDITO DE
       RASPAGEM — é só IA sobre o que já está no banco.
       Existe porque a frase é a parte que mais falha: o Gemini soluça, o
       relógio do worker acaba, e o item fica gravado e mudo. Sem esta ação, a
       única forma de recuperar seria buscar tudo de novo — pagando raspagem
       para consertar redação. */
    if (action === "redigir") {
      const limite = Math.min(Number(body?.limite ?? 8), 20);
      const { data: mudos } = await supabase.from("briefing_noticias")
        .select("id, pauta, titulo, resumo")
        .or("por_que_importa.is.null,muda_algo.is.null").is("lido_em", null)
        .order("colhido_em", { ascending: false }).limit(limite);

      let escritas = 0;
      for (const m of mudos ?? []) {
        if (sobramMs() < 30_000) break;
        const pauta = PAUTAS.find((p) => p.chave === m.pauta);
        if (!pauta) continue;
        /* SEM RETENTATIVA AQUI, e o `2` diz isso: do ponto de vista do dia, esta
           passada JÁ É a segunda tentativa — a primeira foi a varredura das
           07:40. Retentar dentro dela custa 50s por item que falha duas vezes, e
           foi assim que uma rodada tratou 2 de 4 antes de estourar o prazo: o
           item ruim atrasa a fila inteira. Quem não sair hoje sai amanhã, e
           enquanto isso aparece na tela com `muda_algo` nulo, que é o certo. */
        const l = await legendar(pauta, m.titulo, m.resumo ?? "", 2);
        if (!l.frase && l.muda === null) continue;
        await supabase.from("briefing_noticias")
          .update({ por_que_importa: l.frase || null, muda_algo: l.muda })
          .eq("id", m.id);
        escritas++;
      }
      return json({ ok: true, mudos: mudos?.length ?? 0, escritas, duracao_ms: Date.now() - t0 });
    }

    if (action !== "varrer" && !previa) return json({ ok: false, erro: `Ação desconhecida: ${action}` }, 400);

    /* ------------------------------------------------ já rodou hoje? */
    /* O cron dispara uma vez, mas `disparar_automacao` pode ser reenfileirada e
       o botão da tela existe. Gastar duas vezes pelo mesmo dia é o erro mais
       fácil de cometer aqui, e o mais difícil de perceber: o painel fica igual,
       só o crédito some. */
    const hojeBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    if (!previa && !body?.forcar) {
      const { count } = await supabase.from("briefing_noticias")
        .select("id", { count: "exact", head: true })
        .gte("colhido_em", `${hojeBRT}T00:00:00-03:00`);
      if ((count ?? 0) > 0) {
        return json({ ok: true, jaRodou: true, gravadas: 0, mensagem: `O painel já foi montado hoje (${count} item(ns)). Use { forcar: true } para buscar de novo.` });
      }
    }

    /* ----------------------------------------------------- o orçamento */
    const consultas = PAUTAS.flatMap((p) => p.consultas.map((c) => ({ pauta: p, consulta: c })));
    // 2 créditos por busca de até 10 resultados — a conta é por dezena,
    // arredondando para cima. O `+1` reserva a retentativa da aba de notícias:
    // pedir ao freio só o nominal e depois gastar a mais é como se fura teto.
    const custoPrevisto = (consultas.length + 1) * 2;
    const veredito = await podeGastar(supabase, "briefing_noticias", custoPrevisto);
    if (!veredito.pode) {
      return json({ ok: true, freado: true, gravadas: 0, mensagem: `notícias suspensas: ${veredito.motivo}.` });
    }

    /* ------------------------------------------------------ a memória */
    const desde = new Date(Date.now() - DIAS_DE_MEMORIA * 86_400_000).toISOString();
    const { data: vistas } = await supabase.from("briefing_noticias")
      .select("chave, titulo").gte("colhido_em", desde);
    const chavesVistas = new Set((vistas ?? []).map((v: any) => String(v.chave)));
    const titulosVistos = (vistas ?? []).map((v: any) => String(v.titulo));

    /* --------------------------------------------------- as buscas */
    /* UMA DE CADA VEZ. São quatro no dia inteiro: a rajada paralela não
       economiza tempo que faça diferença e é o que faz o Firecrawl devolver erro
       (medido no radar, com nove fontes em paralelo — sete falharam). */
    const candidatos: Candidato[] = [];
    const relatorio: Array<Record<string, unknown>> = [];
    let buscasFeitas = 0;
    let retentativas = 0;
    const agora = new Date();

    for (const { pauta, consulta } of consultas) {
      if (sobramMs() < 25_000) {
        relatorio.push({ pauta: pauta.chave, pulada: "sem tempo de worker" });
        continue;
      }
      const opcoes = {
        tbs: consulta.tbs, fontes: consulta.fontes,
        timeoutMs: Math.min(30_000, Math.max(10_000, sobramMs() - 15_000)),
      };
      let { achados, erro, chaves } = await buscar(consulta.q, RESULTADOS, opcoes);
      buscasFeitas++;
      if (erro) {
        relatorio.push({ pauta: pauta.chave, erro });
        continue;
      }

      /* A ABA DE NOTÍCIAS VOLTA VAZIA SEM ERRO, de vez em quando e sem padrão de
         consulta (ver a tabela de medições em `_shared/briefing-noticias.ts`).
         Uma retentativa por rodada — não por consulta: no pior dia isso são 5
         buscas em vez de 4, que cabe no teto; uma retentativa por consulta seria
         8, que não cabe. E só na aba de notícias: a `web` nunca deu sinal
         disso. */
      if (!achados.length && consulta.fontes.includes("news") && retentativas < 1 && sobramMs() > 35_000) {
        retentativas++;
        const r2 = await buscar(consulta.q, RESULTADOS, opcoes);
        buscasFeitas++;
        if (!r2.erro && r2.achados.length) { achados = r2.achados; chaves = r2.chaves; }
        relatorio.push({ pauta: pauta.chave, retentativa: `vazia na 1ª, ${r2.achados.length} na 2ª` });
      }

      let novos = 0, repetidos = 0, fracos = 0;
      for (const a of achados) {
        const chave = chaveDoItem(a.url, a.titulo);
        if (!chave || chavesVistas.has(chave)) { repetidos++; continue; }
        if (titulosVistos.some((t) => mesmaNoticia(t, a.titulo))) { repetidos++; continue; }
        // Contra os outros achados DESTA rodada também: as duas consultas da
        // pauta de ferramentas se sobrepõem de propósito, e o mesmo lançamento
        // chega pelas duas.
        if (candidatos.some((c) => mesmaNoticia(c.titulo, a.titulo))) { repetidos++; continue; }

        const nota = pontuar(a, pauta.chave, agora);
        if (nota.ruido || nota.pontos <= 0) { fracos++; continue; }
        chavesVistas.add(chave);
        candidatos.push({ ...a, pauta: pauta.chave, nota });
        novos++;
      }
      /* `chaves` no relatório: busca que volta vazia é o defeito mais provável
         desta função, e sem saber QUAIS abas vieram na resposta não dá para
         distinguir "não achou" de "veio noutro formato". */
      relatorio.push({ pauta: pauta.chave, achados: achados.length, novos, repetidos, fracos, chaves });
    }

    /* ------------------------------------------------- quem vai à tela */
    const escolhidos = escolherDoDia(candidatos, MAX_NA_TELA);

    if (previa) {
      return json({
        ok: true, previa: true, buscas: buscasFeitas, candidatos: candidatos.length,
        escolhidos: escolhidos.map((c) => ({ pauta: c.pauta, pontos: c.nota.pontos, motivos: c.nota.motivos, titulo: c.titulo, url: c.url })),
        descartados: candidatos.filter((c) => !escolhidos.includes(c))
          .map((c) => ({ pauta: c.pauta, pontos: c.nota.pontos, titulo: c.titulo })),
        relatorio, duracao_ms: Date.now() - t0,
      });
    }

    /* ------------------------------------------------------- a redação */
    /* UMA DE CADA VEZ, e isto foi medido na estreia (28/08/2026). A primeira
       versão mandava as seis redações em `Promise.all` — pareciam independentes
       e são. Resultado: das quatro chamadas, UMA respondeu; duas voltaram
       "Falha ao consultar a IA" e uma estourou o prazo. O painel gravou três dos
       quatro itens sem a frase, e o defeito não apareceu como erro — apareceu
       como card mudo.
       Em série, cada chamada leva 2 a 4 segundos com o modelo lite: seis são
       ~20s, que cabem de sobra no que resta do worker depois das buscas. E o
       relógio é consultado a cada volta, porque quem para no meio grava o que
       já tem — item sem frase ainda é item com link. */
    const legendas: Legenda[] = [];
    for (const c of escolhidos) {
      if (sobramMs() < 30_000) { legendas.push({ muda: null, frase: "" }); continue; }
      const pauta = PAUTAS.find((p) => p.chave === c.pauta)!;
      legendas.push(await legendar(pauta, c.titulo, c.descricao));
    }

    /* ------------------------------------------------------- a gravação */
    const linhas = escolhidos.map((c, i) => ({
      pauta: c.pauta,
      titulo: c.titulo.slice(0, 500),
      url: c.url,
      chave: chaveDoItem(c.url, c.titulo),
      /* O host do redirecionador NÃO é o veículo: escrever "google.com" embaixo
         da manchete seria informação errada com cara de informação. Sem o nome
         do veículo, melhor não dizer nada. */
      fonte: c.fonte || (ehRedirecionador(c.url) ? null : hostDe(c.url)),
      publicado_em: lerQuando(c.publicado, agora),
      resumo: (c.descricao ?? "").slice(0, 1000),
      por_que_importa: legendas[i]?.frase || null,
      muda_algo: legendas[i]?.muda ?? null,
      relevancia: c.nota.pontos,
      motivos: c.nota.motivos,
      detalhe: { origem: c.origem ?? null, colhido_por: quem ?? "cron" },
    }));

    let gravadas = 0;
    if (linhas.length) {
      /* `ignoreDuplicates` e não `merge`: se a chave já existe, a linha antiga é
         a que tem o histórico de leitura. Sobrescrever faria a notícia que
         alguém já marcou como lida voltar para a tela como nova. */
      const { data, error } = await supabase.from("briefing_noticias")
        .upsert(linhas, { onConflict: "chave", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      gravadas = data?.length ?? 0;
    }

    /* --------------------------------------------------------- o razão */
    /* MEDIDO, quando dá: o saldo antes veio do próprio freio e o depois custa
       uma consulta que não cobra. A estimativa (2 por busca) fica como piso —
       registrar zero porque a leitura de saldo falhou seria furar o teto. */
    const depois = await saldoFirecrawl();
    const medido = veredito.saldo != null && depois.restantes != null
      ? veredito.saldo - depois.restantes
      : null;
    const estimado = buscasFeitas * 2;
    await registrarGasto(
      supabase, "briefing_noticias",
      medido != null && medido > 0 ? medido : estimado,
      { buscas: buscasFeitas, candidatos: candidatos.length, gravadas, quem: quem ?? "cron" },
      medido != null && medido > 0,
    );

    const acionaveis = legendas.filter((l) => l.muda !== false).length;
    return json({
      ok: true,
      buscas: buscasFeitas, candidatos: candidatos.length, gravadas, acionaveis,
      creditos: medido != null && medido > 0 ? medido : estimado,
      relatorio,
      mensagem: gravadas
        ? `${gravadas} notícia(s) novas, ${acionaveis} com algo que muda para a gente.`
        : `${buscasFeitas} busca(s), nada que passasse na régua — o painel fica com o que já tinha.`,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error("briefing-noticias", e);
    return json({ ok: false, erro: String((e as Error)?.message ?? e) }, 500);
  }
});
