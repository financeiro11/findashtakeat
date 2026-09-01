// Edge Function: notas-diagnostico
//
// O texto que explica POR QUE a nota falta, e o que fazer a respeito.
//
// O SINAL É DETERMINÍSTICO E A IA SÓ REDIGE — mesma divisão da recomendação do
// cartão e da justificativa da DRE, e pelo mesmo motivo: número inventado por
// modelo destrói a autoridade do painel inteiro, e uma vez destruída não volta.
// Quem classifica cada título por estágio é `cap_notas_diagnostico`, em SQL;
// aqui o modelo recebe esse JSON pronto e escreve por cima dele.
//
// A REGRA QUE O PROMPT REPETE TRÊS VEZES: só pode citar número que está no
// JSON. Sem essa insistência o modelo soma valores por conta própria, e a soma
// dele bate com a nossa em quase todos os casos — o que é pior do que errar
// sempre, porque ninguém desconfia.
//
// PLANOS DE AÇÃO SAEM ANCORADOS. Para `achou_mas_nao_abre` a ação já está
// cadastrada em `nota_fonte_bloqueada` e vem no JSON; o modelo a reescreve, não
// a inventa. Para os outros estágios ele propõe, e o texto diz que propôs.
//
// Ações (body.action):
//   "ler"    (default) → devolve o último texto guardado + o sinal de agora.
//   "gerar"           → chama o modelo e guarda. { de?, ate? }
//
// Body: { action?, de?, ate? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import {
  corsHeaders, DEFAULT_MODEL, errorResponse, generateJSON, handleCors, jsonResponse, temChave,
} from "../_shared/openai.ts";

const ROTULO: Record<string, string> = {
  pronta_para_subir: "o Hub já tem o arquivo e sobe sozinho",
  /* SEPARADO DE `pronta_para_subir` desde 31/08/2026, porque a fila do ERP só
     se enche por clique de gente: o que está casado e fora de `fila_erp` não
     sobe sozinho nunca. Juntos, os dois davam "ninguém precisa fazer nada" a
     11 títulos quando só 1 era verdade. */
  falta_mandar: "o Hub casou a nota e ninguém a mandou ao ERP — falta marcar no Acervo e clicar Mandar",
  espera_um_clique: "o Hub achou candidata e precisa de alguém para confirmar",
  achou_mas_nao_abre: "sabe-se onde está e não se consegue pegar",
  nunca_apareceu: "nenhuma fonte trouxe documento desse fornecedor",
  fornecedor_nao_emite: "não existe nota a emitir",
};

const SISTEMA =
  "Você é o analista do time financeiro da Takeat e escreve para quem vai agir hoje.\n" +
  "REGRA ABSOLUTA: use SOMENTE números que estão no JSON recebido. Nunca some, " +
  "calcule proporção, projete ou arredonde por conta própria — se o número não " +
  "está lá, não escreva número.\n" +
  "Escreva em português do Brasil, direto, sem jargão de consultoria e sem " +
  "adjetivo de entusiasmo. Trate o leitor como quem conhece a operação.\n" +
  "Valores em reais no formato R$ 1.234.567 (sem centavos).\n" +
  "Responda em JSON com as chaves: resumo (string, 2 a 4 frases sobre onde a " +
  "falta está concentrada e o que muda o número mais rápido) e planos (array de " +
  "3 a 5 objetos com: titulo (até 60 caracteres), estagio (uma das chaves de " +
  "estagios), porque (1 frase com o número que justifica), passos (array de 2 a " +
  "4 strings imperativas e concretas), quem (string curta: quem faz)).";

function prompt(sinal: Record<string, unknown>): string {
  return [
    "Diagnóstico das notas que faltam no ERP. Cada título foi classificado pelo",
    "ESTÁGIO em que a falta está — o que muda o trabalho a fazer:",
    ...Object.entries(ROTULO).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "Onde a ação já é conhecida (campo `bloqueios`), reescreva a ação cadastrada",
    "em vez de inventar outra — ela foi apurada olhando o dado.",
    "",
    "`acervo_sem_dono` é o outro lado do problema: nota com arquivo que não achou",
    "título. `leitura` mostra o que a esteira ainda não conseguiu ler.",
    "",
    /* A COTAÇÃO DO LOTE precisa de tradução, senão vira número solto no texto.
       O leitor não quer saber que existe uma taxa de 5,0742; quer saber que os
       seis títulos são uma fatura de cartão só e que por isso as invoices de
       meses diferentes puderam ser separadas uma a uma. */
    "`cambio_lote` é como o Hub separou invoice estrangeira de título quando",
    "várias caíram na MESMA fatura de cartão: a fatura converte tudo pela mesma",
    "cotação, então `título ÷ invoice` dá o mesmo número para todos os pares",
    "certos. `titulos_corroborando` é quantos títulos concordam com aquela",
    "cotação e `espalhamento_pct` é a distância entre o maior e o menor — abaixo",
    "de 0,1% é praticamente prova. `por_soma_de_duas` conta as NOTAS que só",
    "fecharam somando DUAS invoices, que é o pagamento atrasado juntando dois",
    "meses; essas NÃO sobem sozinhas e esperam alguém confirmar.",
    "Quando houver lote, diga em uma frase quantos títulos ele explicou, e o",
    "número para isso é `titulos_explicados` — `notas_casadas` conta NOTAS, e um",
    "título pode ter fechado com duas.",
    "",
    "JSON:",
    JSON.stringify(sinal),
  ].join("\n");
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    /* CAMINHO DE CRON, e ele não é só conveniência de teste: um diagnóstico
       escrito toda manhã é o que faz alguém ABRIR a aba. Esperar que a pessoa
       peça é esperar que ela lembre. */
    const cron = req.headers.get("x-cron-token");
    let caller: { userId: string | null } = { userId: null };
    if (cron) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("token").eq("name", "notas-diagnostico").maybeSingle();
      if (!data?.token || data.token !== cron) return jsonResponse({ erro: "Token inválido." }, 401);
    } else {
      caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "ler");
    const de = body?.de ? String(body.de) : null;
    const ate = body?.ate ? String(body.ate) : null;

    const { data: sinal, error: erroSinal } = await supabase
      .rpc("cap_notas_diagnostico", { p_de: de, p_ate: ate });
    if (erroSinal) throw new Error(erroSinal.message);

    if (action === "ler") {
      const { data: ultimo } = await supabase
        .from("cap_notas_diagnostico_texto")
        .select("resumo, planos, gerado_em, modelo, de, ate")
        .order("gerado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      return jsonResponse({ ok: true, sinal, texto: ultimo ?? null });
    }

    if (action !== "gerar") return jsonResponse({ erro: `Ação desconhecida: ${action}` }, 400);
    if (!temChave()) {
      /* Sem chave a tela NÃO fica vazia: o sinal é o que importa, e ele existe
         sem modelo nenhum. O texto é o acabamento, não o conteúdo. */
      return jsonResponse({ ok: true, sinal, texto: null, aviso: "A IA não está configurada (OPENAI_API_KEY)." });
    }

    const escrito = await generateJSON<{ resumo: string; planos: unknown[] }>({
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: prompt(sinal as Record<string, unknown>) },
      ],
      temperature: 0.2,
      maxTokens: 1800,
    });

    const { data: gravado, error: erroGravar } = await supabase
      .from("cap_notas_diagnostico_texto")
      .insert({
        de, ate,
        resumo: String(escrito?.resumo ?? "").slice(0, 4000),
        planos: Array.isArray(escrito?.planos) ? escrito.planos : [],
        sinal,
        modelo: DEFAULT_MODEL,
        gerado_por: caller.userId,
      })
      .select("resumo, planos, gerado_em, modelo, de, ate")
      .single();
    if (erroGravar) throw new Error(erroGravar.message);

    return jsonResponse({ ok: true, sinal, texto: gravado });
  } catch (e) {
    return errorResponse(e);
  }
});
