// As duas perguntas da IA sobre o acervo de notas.
//
//   { action: "rodada" }      → a passada completa: regra, depois motivo, depois desempate
//   { action: "motivo" }      → só classificar por que a nota não casou
//   { action: "desempatar" }  → só propor qual candidato é o certo
//   { action: "previa" }      → o tamanho das filas e o estado do freio, sem gastar nada
//
// ATÉ ONDE ELA VAI SOZINHA: resolve o óbvio, escala a dúvida.
//
// Toda leitura vira `sugestao_ia` — opinião carimbada com modelo, data e uma
// frase de justificativa. Depois disso, `notas_externas_aplicar_sugestao` decide
// se aquilo é óbvio o bastante para virar alvo sem ninguém clicar, exigindo as
// TRÊS guardas ao mesmo tempo: confiança alta, documento com arquivo e título
// ainda devendo nota. O que não passa fica como sugestão e espera gente na
// janela "Escolher o título".
//
// A RÉGUA MORA NO POSTGRES, não aqui. Se esta função repetisse a checagem,
// seriam duas réguas para divergir na primeira vez que alguém mexesse numa
// delas — e a que decide escrever alvo tem de ter um dono só.
//
// O QUE A IA APLICA FICA MARCADO E REVERSÍVEL: `alvo_decidido_por = 'ia'`, e
// `notas_externas_desfazer_ia()` desfaz em lote o que ainda não subiu ao ERP.
// Autonomia sem botão de voltar é aposta, não decisão.
//
// ---------------------------------------------------------------------------
// A ORDEM É O FREIO MAIS BARATO QUE EXISTE. A rodada começa por
// `notas_externas_motivo_por_regra()`, que é SQL puro e instantâneo. Medido em
// 29/08/2026: das 996 notas sem alvo, 801 foram explicadas por três `case when`
// (não é nota, é anterior a abril/26, está sem valor lido) e só 195 sobraram.
// Perguntar ao modelo sobre as 996 gastaria cinco vezes mais chamadas para
// descobrir o que a regra já sabia.
//
// Depois disso vêm, em ordem, os três freios de verdade:
//   1. `podeGastarIA` — teto de chamadas por DIA, por consumidor;
//   2. o lote — no máximo `MAX_LOTE` por rodada, mesmo com teto sobrando;
//   3. `comPrazo` + `LIMITE_WORKER_MS` — o worker morre por volta dos 150s, e
//      resposta que não sai é trabalho perdido na hora de gravar.
//
// E as chamadas são EM SÉRIE, não em paralelo. Seis extrações simultâneas foi o
// que derrubou o radar em 27/08; aqui não há pressa nenhuma — a fila é de 195
// documentos e o cron passa várias vezes por dia.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateJSON, MODELO_LITE } from "../_shared/gemini.ts";
import { podeGastarIA, quantasCabem, registrarUsoIA } from "../_shared/ia-orcamento.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Teto de documentos por rodada. Baixo de propósito: a fila não tem pressa. */
const MAX_LOTE = 12;
/** O worker morre por volta dos 150s. Paramos antes, com folga para gravar. */
const LIMITE_WORKER_MS = 115_000;
/* DOIS TETOS, porque são dois trabalhos de tamanho diferente — medido em
   29/08/2026, não estimado. Classificar o motivo é ler um texto curto e escolher
   entre três etiquetas: as 3 primeiras chamadas voltaram em ~4s cada. Desempatar
   manda o documento MAIS a tabela de candidatos e pede uma justificativa: com o
   teto único de 25s, 2 de 5 chamadas estouraram sem que houvesse 503 nenhum nos
   logs — era latência normal, e o teto é que estava apertado. */
const TETO_MOTIVO_MS = 25_000;
const TETO_DESEMPATE_MS = 45_000;

function comPrazo<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${oque} não respondeu em ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

type NotaFila = {
  id: number;
  nome: string | null;
  o_que_e: string | null;
  detalhe: string | null;
  valor: number | null;
  vencimento: string | null;
  enviado_em: string | null;
  cnpj: string | null;
  fonte: string | null;
  competencia: string | null;
  candidatos: Record<string, unknown> | null;
};

type Candidato = {
  alvo_tipo: string;
  id_unico: string;
  cod_titulo: string | null;
  nome: string | null;
  valor: number | null;
  data: string | null;
  categoria: string | null;
  ja_tem_nota: boolean;
  dias: number | null;
};

const brl = (n: number | null | undefined) =>
  n == null ? "sem valor lido" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O documento, escrito como uma pessoa o leria. */
function descreverNota(n: NotaFila): string {
  const linhas = [
    `Nome do documento: ${n.nome || n.o_que_e || "(sem nome)"}`,
    `Valor: ${brl(n.valor)}`,
    `Data de referência: ${n.vencimento || n.enviado_em || "desconhecida"}`,
  ];
  if (n.cnpj) linhas.push(`CNPJ/CPF: ${n.cnpj}`);
  if (n.competencia) linhas.push(`Competência declarada: ${n.competencia}`);
  if (n.detalhe) linhas.push(`Detalhe: ${String(n.detalhe).slice(0, 300)}`);
  if (n.o_que_e && n.o_que_e !== n.nome) linhas.push(`Descrição: ${String(n.o_que_e).slice(0, 300)}`);
  linhas.push(`Origem: ${n.fonte || "?"}`);
  return linhas.join("\n");
}

/* ============================================================= desempate */

const SCHEMA_DESEMPATE = {
  type: "object",
  properties: {
    id_unico: { type: "string", description: "id_unico do candidato escolhido, ou string vazia se nenhum" },
    porque: { type: "string", description: "uma frase curta, em português, dizendo o que decidiu" },
    confianca: { type: "string", enum: ["alta", "media", "baixa"] },
  },
  required: ["id_unico", "porque", "confianca"],
} as const;

const INSTRUCAO_DESEMPATE =
  "Você recebe UM documento fiscal e a lista de títulos do contas a pagar que o casador " +
  "automático levantou como candidatos. O casador compara valor e data; ele NÃO lê texto. " +
  "Sua vantagem é ler.\n\n" +
  "Escolha o candidato de que o documento fala, usando o que está ESCRITO nele: número de " +
  "parcela ('2 parcela', '02/06'), competência, mês citado no nome do arquivo, número do " +
  "pedido ou da nota.\n\n" +
  "Regras:\n" +
  "- Um título que JÁ TEM NOTA anexada quase nunca é o certo — é justamente ele que costuma " +
  "criar o empate.\n" +
  "- Se o que distingue os candidatos for só a data e o documento não disser nada sobre " +
  "período, devolva id_unico vazio. Empate sem prova não se desfaz por palpite.\n" +
  "- Nunca invente um id_unico que não esteja na lista.\n" +
  "- 'confianca' alta só quando o documento diz explicitamente o que decide.";

/* ================================================================ motivo */

const MOTIVOS = ["fornecedor_sem_titulo", "valor_divergente", "indefinido"] as const;

const SCHEMA_MOTIVO = {
  type: "object",
  properties: {
    motivo: { type: "string", enum: [...MOTIVOS] },
    porque: { type: "string" },
  },
  required: ["motivo", "porque"],
} as const;

const INSTRUCAO_MOTIVO =
  "Você recebe UM documento que o casador automático não conseguiu ligar a nenhum título do " +
  "contas a pagar. As causas óbvias já foram descartadas por regra (não é nota, é de período " +
  "anterior a abril/2026, está sem valor lido). Classifique o que sobrou:\n\n" +
  "- fornecedor_sem_titulo: é nota legítima, mas de um fornecedor que não tem conta em aberto " +
  "no período — típico de compra avulsa, reembolso ou fornecedor novo.\n" +
  "- valor_divergente: dá para ver que existe título do fornecedor, mas o valor da nota não " +
  "bate com o que se pagaria (retenção de ISS, desconto, nota cheia contra parcela).\n" +
  "- indefinido: não dá para dizer pelo que está escrito. Use sem constrangimento — " +
  "é melhor que um palpite com cara de diagnóstico.\n\n" +
  "'porque' é uma frase curta, em português, dizendo o que você viu.";

/* ================================================================= rodada */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const t0 = Date.now();
  const restaTempo = () => LIMITE_WORKER_MS - (Date.now() - t0);

  try {
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supa.from("internal_cron_tokens")
        .select("name").eq("name", "notas-explicar").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    let quem: string | null = null;
    if (!ehCron) {
      /* `userId` é nulo quando quem chamou foi a service role — e nulo em
         `ai_usage_log` quer dizer exatamente isso: foi o servidor. */
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.userId ?? null;
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "rodada");
    const limite = Math.max(1, Math.min(Number(body?.limite ?? MAX_LOTE), MAX_LOTE));

    if (action === "previa") {
      const [{ data: resumo }, freioD, freioM] = await Promise.all([
        supa.rpc("notas_externas_explicar_resumo"),
        podeGastarIA(supa, "notas_desempate", 1),
        podeGastarIA(supa, "notas_motivo", 1),
      ]);
      return json({ ok: true, previa: true, resumo, freio: { desempate: freioD, motivo: freioM } });
    }

    /* ------- a regra primeiro, sempre. É grátis e tira ~80% da fila. ------- */
    let porRegra: unknown = null;
    if (action === "rodada" || action === "motivo") {
      const { data, error } = await supa.rpc("notas_externas_motivo_por_regra");
      if (error) console.error("motivo_por_regra:", error.message);
      else porRegra = data;
    }

    const feito = { motivo: 0, desempate: 0, escolheu: 0, sem_escolha: 0, aplicou: 0, nao_aplicou: 0 };
    /* Por que NÃO aplicou, agrupado. É o número que diz se as guardas estão
       apertadas demais ou de menos — sem ele, "aplicou 1 de 7" não ensina nada. */
    const naoAplicou: Record<string, number> = {};
    const erros: string[] = [];
    const freado: Record<string, string> = {};
    let parouPorTempo = false;

    /* ------------------------------- motivo ------------------------------- */
    if (action === "rodada" || action === "motivo") {
      const veredito = await podeGastarIA(supa, "notas_motivo", 1);
      const cabem = quantasCabem(veredito, limite);
      if (!cabem) {
        freado.motivo = veredito.motivo;
      } else {
        const { data: fila } = await supa.rpc("notas_externas_fila_explicar", {
          p_modo: "motivo", p_limite: cabem,
        });
        for (const n of (fila ?? []) as NotaFila[]) {
          if (restaTempo() < TETO_MOTIVO_MS + 10_000) { parouPorTempo = true; break; }
          try {
            const out = await comPrazo(generateJSON<{ motivo: string; porque: string }>({
              /* MODELO LEVE: o trabalho é escolher uma etiqueta entre três,
                 olhando um texto curto. Não é deliberação, e o raciocínio do
                 modelo cheio seria descartado do mesmo jeito.
                 SEM `thinking`: o `gemini-3.5-flash-lite` recusa o campo com um
                 400, e o helper trata isso repetindo a chamada sem ele — uma ida
                 desperdiçada por worker frio. Pedir o que se sabe que será
                 recusado é gastar disponibilidade para não ganhar nada. */
              model: MODELO_LITE,
              temperature: 0,
              responseSchema: SCHEMA_MOTIVO,
              messages: [
                { role: "system", content: INSTRUCAO_MOTIVO },
                { role: "user", content: descreverNota(n) },
              ],
              onUso: (u) => { void registrarUsoIA(supa, { consumidor: "notas_motivo", userId: quem, ...u }); },
            }), TETO_MOTIVO_MS, "a classificação do motivo");

            const motivo = (MOTIVOS as readonly string[]).includes(out?.motivo) ? out.motivo : "indefinido";
            const { error } = await supa.rpc("notas_externas_gravar_motivo", { p_id: n.id, p_motivo: motivo });
            if (error) throw new Error(error.message);
            feito.motivo++;
          } catch (e) {
            erros.push(`motivo #${n.id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
            /* Chamada que falhou consumiu disponibilidade do mesmo jeito — o
               razão precisa saber, senão o teto diário mente para baixo. */
            void registrarUsoIA(supa, { consumidor: "notas_motivo", model: MODELO_LITE, userId: quem });
          }
        }
      }
    }

    /* ----------------------------- desempate ------------------------------ */
    if ((action === "rodada" || action === "desempatar") && !parouPorTempo) {
      const veredito = await podeGastarIA(supa, "notas_desempate", 1);
      const cabem = quantasCabem(veredito, limite);
      if (!cabem) {
        freado.desempate = veredito.motivo;
      } else {
        const { data: fila } = await supa.rpc("notas_externas_fila_explicar", {
          p_modo: "desempatar", p_limite: cabem,
        });
        for (const n of (fila ?? []) as NotaFila[]) {
          if (restaTempo() < TETO_DESEMPATE_MS + 10_000) { parouPorTempo = true; break; }
          try {
            /* OS MESMOS CANDIDATOS QUE A PESSOA VÊ. É de propósito: a janela
               "Escolher o título" lê esta mesma RPC, então a IA opina sobre
               exatamente a tela que alguém vai conferir — e não sobre uma
               versão própria dos fatos. */
            const { data: cands, error: eC } = await supa.rpc("notas_externas_candidatos", { p_id: n.id });
            if (eC) throw new Error(eC.message);
            const lista = (cands ?? []) as Candidato[];
            if (lista.length < 2) continue; // sem empate não há o que desempatar

            const tabela = lista.map((c) =>
              `- id_unico: ${c.id_unico} | ${c.nome || "(sem nome)"} | ${brl(c.valor)} | ${c.data || "?"}`
              + ` | categoria: ${c.categoria || "—"}`
              + ` | ${c.ja_tem_nota ? "JÁ TEM NOTA ANEXADA" : "ainda sem nota"}`
              + (c.dias != null ? ` | ${Math.abs(c.dias)} dia(s) de distância` : "")
            ).join("\n");

            const out = await comPrazo(generateJSON<{ id_unico: string; porque: string; confianca: string }>({
              model: MODELO_LITE,
              temperature: 0,
              responseSchema: SCHEMA_DESEMPATE,
              messages: [
                { role: "system", content: INSTRUCAO_DESEMPATE },
                { role: "user", content: `DOCUMENTO:\n${descreverNota(n)}\n\nCANDIDATOS:\n${tabela}` },
              ],
              onUso: (u) => { void registrarUsoIA(supa, { consumidor: "notas_desempate", userId: quem, ...u }); },
            }), TETO_DESEMPATE_MS, "o desempate");

            /* A ESCOLHA TEM DE EXISTIR NA LISTA. Modelo que devolve id inventado
               não recebe o benefício da dúvida — vira "não escolheu". */
            const escolhido = lista.find((c) => c.id_unico === String(out?.id_unico ?? "").trim());

            const { error } = await supa.rpc("notas_externas_gravar_sugestao", {
              p_id: n.id,
              p_alvo_tipo: escolhido?.alvo_tipo ?? null,
              p_alvo_id_unico: escolhido?.id_unico ?? null,
              p_porque: String(out?.porque ?? "").slice(0, 400),
              p_confianca: escolhido ? String(out?.confianca ?? "media") : null,
              p_modelo: MODELO_LITE,
            });
            if (error) throw new Error(error.message);

            feito.desempate++;
            if (escolhido) feito.escolheu++; else feito.sem_escolha++;

            /* RESOLVE O ÓBVIO, ESCALA A DÚVIDA. Quem decide se este caso é
               óbvio é o Postgres (`notas_externas_aplicar_sugestao`), com as
               três guardas: confiança alta, documento com arquivo e título
               ainda devendo nota. A função aqui não repete a régua — se
               repetisse, seriam duas réguas para divergir na primeira vez que
               alguém mexesse numa delas. */
            if (escolhido) {
              const { data: ap } = await supa.rpc("notas_externas_aplicar_sugestao", { p_id: n.id });
              const r = ap as { aplicou?: boolean; porque?: string } | null;
              if (r?.aplicou) feito.aplicou++;
              else if (r?.porque) {
                feito.nao_aplicou++;
                naoAplicou[r.porque] = (naoAplicou[r.porque] ?? 0) + 1;
              }
            }
          } catch (e) {
            erros.push(`desempate #${n.id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
            void registrarUsoIA(supa, { consumidor: "notas_desempate", model: MODELO_LITE, userId: quem });
          }
        }
      }
    }

    const { data: resumo } = await supa.rpc("notas_externas_explicar_resumo");

    return json({
      ok: true,
      por_regra: porRegra,
      feito,
      freado: Object.keys(freado).length ? freado : null,
      nao_aplicou_porque: Object.keys(naoAplicou).length ? naoAplicou : null,
      parou_por_tempo: parouPorTempo,
      erros,
      resumo,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error("notas-explicar", e);
    const msg = String((e as Error)?.message ?? e);
    /* `requireUser` lança um Error pelado com esta frase. Devolver 500 aqui foi
       o que escondeu 13 crons sem token por dois dias (ver `20260829170000`):
       falha de autenticação tem de sair com o status dela. */
    const st = /não autenticado|sem permissão/i.test(msg) ? 401 : 500;
    return json({ ok: false, error: msg }, st);
  }
});
