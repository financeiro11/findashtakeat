// Edge Function: rescisao-email
//
// Acha na caixa `financeiro@` o e-mail de desligamento de uma pessoa e devolve
// os campos do acerto que a ficha do RH não guarda.
//
// POR QUE ISTO EXISTE: o painel de rescisão da ficha do desligado precisa de
// três dados que só o gestor escreveu no e-mail — dias de férias já tirados,
// variável do mês e o motivo, que é quem define a multa de uma remuneração
// inteira. Até aqui alguém abria o Gmail, procurava o e-mail e digitava na mão
// na tela. Digitar na mão é onde o número erra, e o erro é dinheiro que sai.
//
// A DIVISÃO DE TRABALHO: esta função LÊ e EXTRAI, nada mais. Não calcula o
// acerto (isso é `src/lib/rescisao.ts`, no navegador, com teste em cima), não
// grava no RH e não escreve na caixa — o escopo do Gmail é `readonly`. O que
// ela devolve entra na tela como sugestão editável, nunca como fato consumado.
//
// A CLASSIFICAÇÃO DO MOTIVO NÃO É DA IA. O modelo copia o motivo como está
// escrito; quem decide se aquilo é voluntário ou involuntário é a tabela
// determinística de `_shared/rescisao-email.ts`. Quando não dá para decidir,
// volta nulo e a tela pergunta — que é o certo, porque a diferença entre os
// dois é uma remuneração.
//
// Body: { nome: string, emailId?: string }
//   `emailId` fecha a desambiguação: quando voltou mais de um e-mail possível,
//   a tela devolve qual deles é.

import { requireUser } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { errorResponse, generateJSON, handleCors, jsonResponse, MODELO_LITE } from "../_shared/gemini.ts";
import { listar, mensagem, segredosDoGmail, tokenDeAcesso } from "../_shared/gmail.ts";
import {
  INSTRUCAO_EXTRACAO, SCHEMA_EXTRACAO, classificarMotivo, consultasDoDesligamento,
  escolherEmail, normalizarExtracao, type EmailCandidato,
} from "../_shared/rescisao-email.ts";

/** Quantos e-mails cada consulta traz. O assunto é específico; não precisa mais. */
const POR_CONSULTA = 20;

/** O corpo que vai à IA. Um e-mail de desligamento não passa disso. */
const CORPO_MAX = 8_000;

type Candidato = EmailCandidato & { remetente: string; corpo: string };

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    /* A mesma capacidade que abre /operacional/colaboradores no PORTAO
       (src/lib/modules.ts). O e-mail de desligamento traz remuneração e motivo
       de saída — esconder a tela e deixar a função aberta não protegeria nada. */
    if (!caller.isService && !caller.pode("remuneracao")) {
      return jsonResponse({ erro: "Seu perfil não tem acesso à remuneração dos colaboradores." }, 403);
    }

    const { nome, emailId } = await req.json().catch(() => ({}));
    if (!nome || typeof nome !== "string") {
      return jsonResponse({ erro: "informe o nome do colaborador" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const segredos = await segredosDoGmail(supabase);
    if (!segredos.refreshToken) {
      return jsonResponse({ erro: "Gmail não conectado — autorize em Integrações." }, 409);
    }
    const token = await tokenDeAcesso(segredos);

    /* 1. Achar o e-mail. A segunda consulta só roda se a primeira não trouxe
       nada: ela é mais aberta e custa uma leitura a mais por candidato. */
    const vistos = new Map<string, Candidato>();
    for (const q of consultasDoDesligamento(nome)) {
      const { ids } = await listar(token, q, undefined, POR_CONSULTA);
      for (const ref of ids) {
        if (vistos.has(ref.id)) continue;
        const m = await mensagem(token, ref.id);
        vistos.set(ref.id, {
          id: m.id, assunto: m.assunto, data: m.data,
          remetente: m.remetente, corpo: m.corpo.slice(0, CORPO_MAX),
        });
      }
      if (vistos.size) break;
    }

    const candidatos = [...vistos.values()];
    if (!candidatos.length) {
      return jsonResponse({
        achou: false,
        motivo: `Nenhum e-mail com "Desligamento ${nome}" (nem com o typo "Delisgamento") na caixa financeiro@.`,
      });
    }

    /* 2. Qual deles é. Homônimo volta para alguém escolher. */
    const triagem = escolherEmail(nome, candidatos);
    const escolhido = emailId
      ? candidatos.find((c) => c.id === emailId) ?? null
      : triagem.escolhido;

    if (!escolhido) {
      const { ambiguos } = triagem;
      const lista = ambiguos.length ? ambiguos : candidatos;
      return jsonResponse({
        achou: false,
        ambiguos: lista.map((c) => ({ id: c.id, assunto: c.assunto, data: c.data, remetente: c.remetente })),
        motivo: ambiguos.length
          ? "Mais de um e-mail de desligamento com esse nome — escolha qual é."
          : `Achei e-mails de desligamento, mas nenhum com o nome "${nome}" no assunto.`,
      });
    }

    /* 3. Transcrever o corpo. `thinking: "low"` porque copiar campo de um
       texto para um schema fechado é leitura, não deliberação — e o raciocínio
       do modelo cheio é descartado depois de custar os segundos. */
    const bruto = await generateJSON({
      model: MODELO_LITE,
      thinking: "low",
      temperature: 0,
      responseSchema: SCHEMA_EXTRACAO,
      messages: [
        { role: "system", content: INSTRUCAO_EXTRACAO },
        {
          role: "user",
          content: [
            `Colaborador: ${nome}`,
            `Assunto: ${escolhido.assunto}`,
            `Data do e-mail: ${escolhido.data ?? "—"}`,
            "",
            escolhido.corpo,
          ].join("\n"),
        },
      ],
    });

    const campos = normalizarExtracao(bruto);
    const avisos: string[] = [];
    if (!campos.ultimoDia) avisos.push("O e-mail não traz o último dia trabalhado — a conta usou a data da ficha do RH.");
    if (campos.diasDeFeriasTirados === null) avisos.push("O e-mail não fala de férias tiradas — confirme com o gestor.");
    if (!campos.motivo) avisos.push("O e-mail não traz o motivo do desligamento — sem ele não dá para saber se cabe multa.");

    return jsonResponse({
      achou: true,
      email: {
        id: escolhido.id,
        assunto: escolhido.assunto,
        data: escolhido.data,
        remetente: escolhido.remetente,
      },
      campos,
      // A classificação sai daqui determinística; `null` é "não deu para saber".
      classificacao: classificarMotivo(campos.motivo),
      avisos,
    });
  } catch (e) {
    return errorResponse(e);
  }
});
