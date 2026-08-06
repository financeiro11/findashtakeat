// Edge Function: assistente-responder
//
// Responde perguntas sobre os números da Takeat em TRÊS etapas separadas de propósito:
//
//   1. ROTEAR     — o modelo lê só a PERGUNTA (nenhum dado financeiro) e escolhe qual
//                   consulta rodar e com quais parâmetros.
//   2. COLETAR    — a consulta lê o Supabase sob a RLS do usuário e CONFERE as somas.
//   3. SINTETIZAR — o modelo recebe um bloco fechado com os números já conferidos e
//                   escreve o texto. Ele não tem ferramenta de busca: o que não veio na
//                   etapa 2 não existe para ele.
//
// É essa separação que sustenta a regra de que nenhum número sai da cabeça do modelo.
// Quando a coleta não fecha, a síntese NEM RODA — a resposta é determinística, montada
// aqui, para que "não tenho esse dado" não passe por um redator criativo.
//
// Memória e log de execução são efeitos colaterais deliberadamente NÃO-BLOQUEANTES:
// nenhuma falha neles pode atrasar ou derrubar uma resposta sobre números.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { errorResponse, generateJSON, generateText, handleCors, jsonResponse } from "../_shared/gemini.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  caixaDoMes, Numero, panoramaDoMes, Resultado, rubricaDoMes, ultimoMesFechado, variacaoEbitda,
} from "../_shared/assistente/consultas.ts";
import { blocoDeMemoria, memorizar, registrarExecucao } from "../_shared/assistente/memoria.ts";
import { Competencia, competenciaExtenso } from "../_shared/assistente/dre.ts";

const CONSULTAS = [
  "caixa_do_mes", "variacao_ebitda", "panorama_do_mes", "rubrica_do_mes", "nenhuma",
] as const;
type NomeConsulta = typeof CONSULTAS[number];

const PROMPT_ROTEADOR = `Você roteia perguntas do time financeiro da Takeat para UMA consulta de dados.

Consultas:
- "caixa_do_mes": saldo bancário e movimentação de entradas/saídas. Para perguntas sobre
  caixa, saldo, quanto entrou, quanto saiu, extrato, banco.
- "variacao_ebitda": comparação do EBITDA entre os dois últimos meses fechados, com
  atribuição da variação por rubrica. Para "por que o EBITDA caiu/subiu", "o que explica
  o resultado".
- "panorama_do_mes": totais do mês (receita, margem, EBITDA, lucro). Para "como foi julho",
  "resumo do mês", "me dá os números do mês".
- "rubrica_do_mes": valor de UMA rubrica específica do DRE. Para "quanto gastamos com
  Equipe Comercial", "quanto foi Mídia Paga". Devolva o nome da rubrica em "rubrica".
- "nenhuma": a pergunta não é sobre nada disso.

Se a pergunta citar um mês, devolva ano e mes. Se não citar, deixe nulos.
A data de hoje é {HOJE}.

Responda SOMENTE com JSON:
{"consulta": "...", "ano": null|número, "mes": null|número, "rubrica": null|"texto"}`;

const PROMPT_SINTESE = `Você é analista financeiro do time da Takeat. Escreve em português do Brasil,
direto e sem enrolação, como quem conhece os números da casa.

REGRA ABSOLUTA: os únicos números que você pode escrever são os que aparecem no bloco DADOS.
Não calcule números novos, não estime, não arredonde para um valor que não está lá, não traga
nada de memória nem de conversas anteriores. Se algo não está no bloco, diga que não tem.

Como responder:
- Comece pelo veredito em uma frase. Depois explique.
- Use os números para sustentar a explicação, não para enfeitar. Duas ou três citações bastam.
- Quando o bloco disser que existe um LIMITE nos dados, respeite-o e diga onde a explicação
  termina. Não especule sobre a causa que os dados não mostram.
- Não repita a tabela inteira em prosa: ela já aparece na tela ao lado da sua resposta.
- Se o bloco disser que o mês está ABERTO, avise que o número é parcial.
- Máximo 6 linhas.`;

function normalizarCompetencia(ano: unknown, mes: unknown): Competencia | null {
  const a = Number(ano);
  const m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m)) return null;
  if (a < 2000 || a > 2100 || m < 1 || m > 12) return null;
  return { ano: a, mes: m };
}

/**
 * Guarda-corpo final: procura valores em reais no texto do modelo que NÃO existam entre os
 * números conferidos.
 *
 * Não bloqueia a resposta — a etapa de coleta já garante a origem dos dados. Serve para
 * flagrar na tela quando o modelo compôs um valor por conta própria (somando duas linhas,
 * por exemplo), que é o modo de falha que sobra depois de tirar dele o acesso à busca.
 */
function valoresNaoReconhecidos(texto: string, numeros: Numero[]): string[] {
  const conhecidos = numeros.map((n) => Math.abs(n.valor));
  const achados: string[] = [];

  for (const m of texto.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)) {
    const bruto = m[1];
    const valor = Math.abs(parseFloat(bruto.replace(/\./g, "").replace(",", ".")));
    if (!Number.isFinite(valor)) continue;

    // Tolerância de 1%: o modelo pode dizer "128 mil" para R$ 128.412,00, e isso é legítimo.
    const bate = conhecidos.some((c) => Math.abs(c - valor) / Math.max(c, 1) <= 0.01);
    if (!bate) achados.push(`R$ ${bruto}`);
  }
  return [...new Set(achados)];
}

/** Últimas trocas da conversa, para o modelo entender "e no mês anterior?". */
type Turno = { pergunta: string; resposta: string };

function blocoHistorico(historico: Turno[]): string {
  if (historico.length === 0) return "";
  return [
    "CONVERSA ATÉ AQUI (contexto para entender a pergunta; NÃO é fonte de número):",
    ...historico.slice(-4).map((t) => `P: ${t.pergunta}\nR: ${t.resposta}`),
  ].join("\n");
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const inicio = Date.now();
  try {
    const caller = await requireUser(req);

    const body = await req.json().catch(() => ({}));
    const pergunta = String(body?.pergunta ?? "").trim();
    if (!pergunta) return jsonResponse({ error: "Campo 'pergunta' é obrigatório." }, 400);

    const conversaId = typeof body?.conversa_id === "string" ? body.conversa_id : null;
    const historico: Turno[] = Array.isArray(body?.historico)
      ? body.historico
          .filter((t: unknown) => typeof (t as Turno)?.pergunta === "string")
          .slice(-4)
          .map((t: Turno) => ({
            pergunta: String(t.pergunta).slice(0, 500),
            resposta: String(t.resposta ?? "").slice(0, 800),
          }))
      : [];

    // Leitura sob a RLS do usuário; gravação (memória/log) com service_role.
    const auth = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Etapa 1: rotear (o modelo não vê nenhum dado financeiro aqui) ----------------
    const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    let rota: { consulta?: string; ano?: number | null; mes?: number | null; rubrica?: string | null } = {};
    try {
      rota = await generateJSON({
        temperature: 0,
        messages: [
          { role: "system", content: PROMPT_ROTEADOR.replace("{HOJE}", hoje) },
          { role: "user", content: [blocoHistorico(historico), `PERGUNTA: ${pergunta}`].filter(Boolean).join("\n\n") },
        ],
      });
    } catch {
      rota = {};
    }

    const escolhida = (CONSULTAS as readonly string[]).includes(String(rota?.consulta))
      ? (rota.consulta as NomeConsulta)
      : "nenhuma";

    const responderSemDados = (texto: string, avisos: string[] = []) => {
      const resp = { ok: false, consulta: escolhida, resposta: texto, numeros: [], avisos };
      registrarExecucao(admin, {
        user_id: caller.userId ?? "", conversa_id: conversaId, pergunta,
        consulta: escolhida, ok: false, numeros: [], avisos, resposta: texto,
        latencia_ms: Date.now() - inicio,
      });
      return jsonResponse(resp);
    };

    if (escolhida === "nenhuma") {
      return responderSemDados(
        "Ainda não sei responder isso. Hoje eu consulto: o caixa de um mês (saldo e " +
        "movimentação, Sicoob e Asaas), os totais do mês no DRE, o valor de uma rubrica " +
        "específica e a variação do EBITDA entre os dois últimos meses fechados.",
      );
    }

    // ---- Etapa 2: coletar (conferindo as somas) --------------------------------------
    const pedida = normalizarCompetencia(rota?.ano, rota?.mes);
    let resultado: Resultado;

    switch (escolhida) {
      case "caixa_do_mes": {
        const competencia = pedida ?? (await ultimoMesFechado(supabase));
        if (!competencia) {
          return responderSemDados(
            "Não consegui determinar de qual mês você fala e não há mês fechado no DRE " +
            "para usar como padrão. Me diga a competência (por exemplo, 07/2026).",
          );
        }
        resultado = await caixaDoMes(supabase, competencia);
        if (!pedida) {
          resultado.avisos.push(
            `A pergunta não citou o mês; usei ${competenciaExtenso(competencia)}, o último fechado.`,
          );
        }
        break;
      }
      case "panorama_do_mes":
        resultado = await panoramaDoMes(supabase, pedida);
        break;
      case "rubrica_do_mes": {
        const rubrica = String(rota?.rubrica ?? "").trim();
        if (!rubrica) {
          return responderSemDados("Qual rubrica do DRE você quer ver? Me diga o nome dela.");
        }
        resultado = await rubricaDoMes(supabase, rubrica, pedida);
        break;
      }
      default:
        resultado = await variacaoEbitda(supabase);
    }

    // Coleta não fechou: responde de forma determinística, SEM passar pelo modelo.
    if (!resultado.ok) {
      return responderSemDados(
        "Não tenho esse dado com a confiabilidade necessária para responder." +
        (resultado.avisos.length ? " " + resultado.avisos.join(" ") : ""),
        resultado.avisos,
      );
    }

    // ---- Etapa 3: sintetizar (payload fechado, sem ferramentas) ----------------------
    const memoria = caller.userId ? await blocoDeMemoria(supabase, caller.userId) : "";
    const texto = await generateText({
      temperature: 0.3,
      messages: [
        { role: "system", content: [PROMPT_SINTESE, memoria].filter(Boolean).join("\n\n") },
        {
          role: "user",
          content: [
            blocoHistorico(historico),
            `PERGUNTA:\n${pergunta}`,
            `DADOS:\n${resultado.paraModelo}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });

    const resposta = texto.trim();
    const avisos = [...resultado.avisos];
    const inventados = valoresNaoReconhecidos(resposta, resultado.numeros);
    if (inventados.length > 0) {
      avisos.push(
        `Confira: ${inventados.join(", ")} não corresponde a nenhum número consultado. ` +
        "Use a tabela ao lado como referência.",
      );
    }

    // Efeitos colaterais: não bloqueiam a resposta e não podem derrubá-la.
    if (caller.userId) {
      const depois = Promise.all([
        registrarExecucao(admin, {
          user_id: caller.userId, conversa_id: conversaId, pergunta,
          consulta: resultado.consulta, ok: true, numeros: resultado.numeros,
          avisos, resposta, latencia_ms: Date.now() - inicio,
        }),
        memorizar(admin, caller.userId, pergunta, resposta, conversaId),
      ]).catch(() => {});

      // waitUntil mantém o isolate vivo até terminarem, sem somar latência à resposta.
      const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(depois);
      else await depois;
    }

    return jsonResponse({
      ok: true,
      consulta: resultado.consulta,
      resposta,
      numeros: resultado.numeros,
      avisos,
    });
  } catch (e) {
    if (e instanceof Error && /autenticado|permissão/i.test(e.message)) {
      return jsonResponse({ error: e.message }, 401);
    }
    return errorResponse(e);
  }
});
