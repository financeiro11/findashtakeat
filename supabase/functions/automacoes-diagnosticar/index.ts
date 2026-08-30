// A falha da automação chega com a causa junto.
//
//   { action: "rodada" }  → lê as falhas sem diagnóstico e escreve o que houve
//   { action: "previa" }  → o que entraria na rodada, sem gastar IA
//
// O painel já diz O QUE quebrou: `HTTP 401 {"error":"Não autenticado."}`. Quem lê
// isso e sabe o que fazer é quem escreveu a função. Em 29/08/2026 treze crons
// ficaram dois dias parados com a faixa vermelha acesa no lugar certo, e a causa
// — um `WHERE` maiúsculo numa regex de dois dias antes — não estava em lugar
// nenhum da tela.
//
// A IA REDIGE, NÃO CONSERTA. Ela recebe a falha, o histórico e o que a função
// faz, e devolve três frases: o que houve, a causa provável, o que fazer. Não
// mexe em cron, não reagenda, não redeploya. O Hub inteiro é sinal
// determinístico primeiro, IA redigindo, pessoa agindo — e "IA que mexe em
// automação sozinha" seria a primeira exceção a essa regra. Não é aqui que ela
// se abre.
//
// UM DIAGNÓSTICO POR ASSINATURA DE ERRO. Quem garante isso é
// `automacoes_para_diagnosticar`, que já exclui o que tem diagnóstico para
// aquela assinatura. Um cron diário quebrado há uma semana produz sete falhas e
// UMA chamada de IA — e, na oitava, `ocorrencias` sobe sem gastar nada.

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

const MAX_LOTE = 6;
const LIMITE_WORKER_MS = 110_000;
const TETO_IA_MS = 35_000;

function comPrazo<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${oque} não respondeu em ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

type Falha = {
  jobname: string;
  status_code: number | null;
  resposta: string | null;
  disparado_em: string;
  assinatura: string;
  schedule: string | null;
  falhas_7d: number;
};

const SCHEMA = {
  type: "object",
  properties: {
    resumo: { type: "string", description: "uma frase: o que aconteceu, em português claro" },
    causa: { type: "string", description: "a causa mais provável, dita como hipótese quando for hipótese" },
    o_que_fazer: { type: "string", description: "o próximo passo concreto de quem for consertar" },
    gravidade: { type: "string", enum: ["alta", "media", "baixa"] },
  },
  required: ["resumo", "causa", "o_que_fazer", "gravidade"],
} as const;

/* O QUE A IA PRECISA SABER PARA NÃO CHUTAR. As três armadilhas abaixo são as que
   mais aparecem neste projeto, e sem elas o modelo diagnostica "erro de
   autenticação" para tudo que devolve 401 — que é verdade e é inútil. */
const INSTRUCAO =
  "Você diagnostica falhas de automação de um Hub financeiro brasileiro. As automações são " +
  "crons do Postgres (pg_cron) que chamam Edge Functions do Supabase por HTTP.\n\n" +
  "Contexto que quase sempre explica as falhas daqui:\n" +
  "- `{\"error\":\"Não autenticado.\"}` de um CRON quer dizer que o agendamento não mandou o " +
  "cabeçalho `x-cron-token` (o nome do token some do comando quando alguém reescreve o cron), " +
  "ou que o token foi rotacionado. Não é a chave da API externa.\n" +
  "- `UNAUTHORIZED_NO_AUTH_HEADER` é o GATEWAY do Supabase recusando antes de a função rodar: " +
  "falta `verify_jwt = false` no config.toml daquela função, ou o cron não manda Authorization.\n" +
  "- `canceling statement due to statement timeout` numa chamada a RPC quer dizer que a função " +
  "SQL passou do teto de 8s do PostgREST — não que o banco esteja lento.\n" +
  "- `Timeout of 90000 ms` é o pg_net desistindo de ESPERAR; a função pode ter rodado inteira.\n" +
  "- erro de Google/[401] ao exportar planilha costuma ser compartilhamento removido.\n\n" +
  "Regras da resposta:\n" +
  "- Português claro, sem jargão desnecessário. Quem lê pode não ter escrito a função.\n" +
  "- 'causa' é hipótese: diga 'provavelmente' quando for. Não invente arquivo nem linha.\n" +
  "- 'o_que_fazer' é o próximo passo de quem vai consertar, concreto e verificável.\n" +
  "- gravidade: alta se o dado do Hub está desatualizado ou dinheiro pode estar errado; " +
  "media se atrasa trabalho; baixa se é ruído ou já se resolve sozinho.";

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
        .select("name").eq("name", "automacoes-diagnosticar").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    let quem: string | null = null;
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.userId ?? null;
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "rodada");
    const limite = Math.max(1, Math.min(Number(body?.limite ?? MAX_LOTE), MAX_LOTE));

    if (action === "previa") {
      const [{ data: fila }, freio] = await Promise.all([
        supa.rpc("automacoes_para_diagnosticar", { p_limite: limite }),
        podeGastarIA(supa, "automacao_diagnostico", 1),
      ]);
      return json({ ok: true, previa: true, fila: (fila ?? []).length, quais: (fila ?? []).map((f: Falha) => f.jobname), freio });
    }

    const veredito = await podeGastarIA(supa, "automacao_diagnostico", 1);
    const cabem = quantasCabem(veredito, limite);
    if (!cabem) {
      return json({ ok: true, freado: veredito.motivo, escritos: 0 });
    }

    const { data: fila, error: eF } = await supa.rpc("automacoes_para_diagnosticar", { p_limite: cabem });
    if (eF) throw new Error(`fila: ${eF.message}`);

    let escritos = 0;
    const erros: string[] = [];
    let parouPorTempo = false;

    for (const f of (fila ?? []) as Falha[]) {
      if (restaTempo() < TETO_IA_MS + 8_000) { parouPorTempo = true; break; }
      try {
        /* O QUE FAZ a automação vem do catálogo do front (`O_QUE_FAZ`), que não
           existe aqui. Em vez de duplicar 60 descrições num segundo lugar para
           elas divergirem, mando o NOME do cron: ele já é descritivo neste
           projeto (`omie-caixa-sync-diario`, `churn-sheet-sync-diario`), e o
           modelo lê nome tão bem quanto leria a frase. */
        const contexto = [
          `Automação: ${f.jobname}`,
          f.schedule ? `Agendamento (cron, em UTC): ${f.schedule}` : "Agendamento: desconhecido",
          `Última execução: ${f.disparado_em}`,
          `Status HTTP: ${f.status_code ?? "sem resposta"}`,
          `Resposta: ${String(f.resposta ?? "").slice(0, 800)}`,
          `Falhas nos últimos 7 dias: ${f.falhas_7d}`,
        ].join("\n");

        const out = await comPrazo(generateJSON<{
          resumo: string; causa: string; o_que_fazer: string; gravidade: string;
        }>({
          model: MODELO_LITE,
          temperature: 0.2,
          responseSchema: SCHEMA,
          messages: [
            { role: "system", content: INSTRUCAO },
            { role: "user", content: contexto },
          ],
          onUso: (u) => { void registrarUsoIA(supa, { consumidor: "automacao_diagnostico", userId: quem, ...u }); },
        }), TETO_IA_MS, "o diagnóstico");

        const { error } = await supa.rpc("automacao_diagnostico_gravar", {
          p_jobname: f.jobname,
          p_assinatura: f.assinatura,
          p_amostra: f.resposta,
          p_resumo: String(out?.resumo ?? "").slice(0, 400),
          p_causa: String(out?.causa ?? "").slice(0, 600),
          p_o_que_fazer: String(out?.o_que_fazer ?? "").slice(0, 600),
          p_gravidade: String(out?.gravidade ?? "media"),
          p_modelo: MODELO_LITE,
        });
        if (error) throw new Error(error.message);
        escritos++;
      } catch (e) {
        erros.push(`${f.jobname}: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
        void registrarUsoIA(supa, { consumidor: "automacao_diagnostico", model: MODELO_LITE, userId: quem });
      }
    }

    const { data: abertos } = await supa.rpc("automacao_diagnosticos_abertos");

    return json({
      ok: true,
      escritos,
      olhados: (fila ?? []).length,
      parou_por_tempo: parouPorTempo,
      erros,
      abertos: (abertos ?? []).length,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error("automacoes-diagnosticar", e);
    const msg = String((e as Error)?.message ?? e);
    return json({ ok: false, error: msg }, /não autenticado|sem permissão/i.test(msg) ? 401 : 500);
  }
});
