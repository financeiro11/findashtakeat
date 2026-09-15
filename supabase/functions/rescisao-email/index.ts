// Edge Function: rescisao-email
//
// Acha na caixa `financeiro@` as conversas de desligamento de uma pessoa e
// devolve os campos do acerto que a ficha do RH não guarda.
//
// POR QUE ISTO EXISTE: o painel de rescisão da ficha do desligado precisa de
// dados que só o gestor escreveu — dias de férias já tirados, comissão a
// receber e o tipo de saída, que decide a multa de uma remuneração inteira.
//
// COMO ACHA: não pelo nome no assunto, que quase nunca está lá ("Solicitação de
// Desligamento"). Busca todo e-mail de desligamento na janela da data de saída,
// lê cada conversa inteira e reconhece a pessoa pela linha "Nome do
// colaborador" do corpo — primeiro nome e sobrenome, com uma letra de folga
// para a grafia do gestor. Detalhes e testes em `_shared/rescisao-email.ts`.
//
// POR QUE A CONVERSA INTEIRA: a resposta corrige. A data passa de 31/08 para
// 16/08, "tem comissão" vira "não tem", "involuntário" vira "é voluntário
// então". A mensagem que a busca acha é, muitas vezes, o rascunho.
//
// A DIVISÃO DE TRABALHO: esta função LÊ e EXTRAI. Não calcula o acerto (isso é
// `src/lib/rescisao.ts`, com teste em cima), não grava no RH e não escreve na
// caixa — o escopo do Gmail é `readonly`. O que ela devolve entra na tela como
// sugestão editável.
//
// A CLASSIFICAÇÃO NÃO É DA IA. O modelo copia o tipo e o motivo como estão;
// quem decide é `classificarDesligamento`, determinística. Tipo e motivo
// discordando voltam nulos, e a tela pergunta.
//
// Body: { nome: string, datadesl?: string, threadId?: string }
//   `threadId` fecha a desambiguação: quando só o primeiro nome bateu, a tela
//   devolve qual conversa é.

import { requireUser } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { errorResponse, generateJSON, handleCors, jsonResponse, MODELO_LITE } from "../_shared/gemini.ts";
import { conversa, listar, segredosDoGmail, tokenDeAcesso, type Mensagem } from "../_shared/gmail.ts";
import {
  INSTRUCAO_EXTRACAO, JANELA_ANTES_DIAS, JANELA_DEPOIS_DIAS, SCHEMA_EXTRACAO,
  classificarDesligamento, consultaDoDesligamento, nomesDeclarados, normalizarExtracao,
  textoParaExtracao, triarConversas, type ConversaCandidata,
} from "../_shared/rescisao-email.ts";

/** Conversas lidas por busca. Numa janela de três meses a caixa tem uma dúzia. */
const MAX_CONVERSAS = 25;
/** Leituras em paralelo no Gmail — a cota é por usuário e por segundo. */
const LOTE = 5;

type Lida = ConversaCandidata & { mensagens: Mensagem[] };

const ddmm = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

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

    const body = await req.json().catch(() => ({}));
    const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
    const datadesl = typeof body?.datadesl === "string" ? body.datadesl.slice(0, 10) : null;
    const threadId = typeof body?.threadId === "string" ? body.threadId : null;
    if (!nome) return jsonResponse({ erro: "informe o nome do colaborador" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const segredos = await segredosDoGmail(supabase);
    if (!segredos.refreshToken) {
      return jsonResponse({ erro: "Gmail não conectado — autorize em Integrações." }, 409);
    }
    const token = await tokenDeAcesso(segredos);

    /* 1. As conversas da janela. Com `threadId`, só a que alguém escolheu. */
    let ids: string[];
    if (threadId) {
      ids = [threadId];
    } else {
      const { ids: refs } = await listar(token, consultaDoDesligamento(datadesl), undefined, 100);
      ids = [...new Set(refs.map((r) => r.threadId))].slice(0, MAX_CONVERSAS);
    }

    const lidas: Lida[] = [];
    for (let i = 0; i < ids.length; i += LOTE) {
      const lote = await Promise.all(ids.slice(i, i + LOTE).map(async (id): Promise<Lida> => {
        const mensagens = await conversa(token, id);
        const ultima = mensagens[mensagens.length - 1];
        return {
          threadId: id,
          assunto: mensagens[0]?.assunto ?? "",
          data: ultima?.data ?? null,
          remetente: ultima?.remetente ?? "",
          texto: mensagens.map((m) => m.corpo).join("\n"),
          mensagens,
        };
      }));
      lidas.push(...lote);
    }

    const janela = datadesl
      ? ` entre ${JANELA_ANTES_DIAS} dias antes e ${JANELA_DEPOIS_DIAS} dias depois de ${ddmm(datadesl)}`
      : "";

    if (!lidas.length) {
      return jsonResponse({
        achou: false,
        motivo: `Nenhum e-mail de desligamento na caixa financeiro@${janela}.`,
      });
    }

    /* 2. Quais são desta pessoa. Só o primeiro nome volta para alguém escolher. */
    const { certas, duvidosas } = threadId
      ? { certas: lidas, duvidosas: [] as Lida[] }
      : triarConversas(nome, datadesl, lidas);

    if (!certas.length) {
      if (duvidosas.length) {
        return jsonResponse({
          achou: false,
          motivo: "Achei e-mail de desligamento que bate só no primeiro nome — confira se é esta pessoa.",
          ambiguos: duvidosas.map((c) => ({
            id: c.threadId,
            assunto: c.assunto,
            data: c.data,
            remetente: c.remetente,
            trecho: nomesDeclarados(c.texto)[0] ? `Nome no e-mail: ${nomesDeclarados(c.texto)[0]}` : null,
          })),
        });
      }
      return jsonResponse({
        achou: false,
        motivo: `${lidas.length} e-mail(s) de desligamento${janela}, nenhum com o nome de ${nome}.`,
      });
    }

    /* 3. Transcrever. `thinking: "low"`: copiar campo para um schema fechado é
       leitura, não deliberação — o raciocínio do modelo cheio seria descartado
       depois de custar os segundos. */
    const bruto = await generateJSON({
      model: MODELO_LITE,
      thinking: "low",
      temperature: 0,
      responseSchema: SCHEMA_EXTRACAO,
      messages: [
        { role: "system", content: INSTRUCAO_EXTRACAO },
        {
          role: "user",
          content: textoParaExtracao(nome, certas.map((c) => ({
            assunto: c.assunto,
            mensagens: c.mensagens.map((m) => ({ data: m.data, remetente: m.remetente, corpo: m.corpo })),
          }))),
        },
      ],
    });

    const campos = normalizarExtracao(bruto);
    const { classificacao, conflito } = classificarDesligamento(campos.tipo, campos.motivo);

    /* Os avisos daqui são os que só quem leu o e-mail sabe dar. O "não
       informado" genérico é da conta, no navegador — repetir aqui é ruído. */
    const avisos: string[] = [];
    if (!campos.ultimoDia) {
      avisos.push("O e-mail não traz a data da rescisão — a conta usou a da ficha do RH.");
    }
    if (campos.diasDeFeriasTirados === null && campos.feriasTexto) {
      avisos.push(`Sobre férias, o e-mail diz "${campos.feriasTexto}" — confirme com o gestor.`);
    }
    if (campos.variavel === null && campos.variavelTexto) {
      avisos.push(`Sobre comissão, o e-mail diz "${campos.variavelTexto}", sem valor — confirme com o gestor.`);
    }
    if (conflito) {
      avisos.push(
        `O e-mail marca "${campos.tipo}", mas o motivo ("${campos.motivo}") aponta para o outro lado — classifique na mão.`,
      );
    }

    const fontes = certas.flatMap((c) =>
      c.mensagens.map((m) => ({ id: c.threadId, assunto: m.assunto, data: m.data, remetente: m.remetente })),
    );

    return jsonResponse({
      achou: true,
      email: fontes[fontes.length - 1],
      fontes,
      campos,
      classificacao,
      avisos,
    });
  } catch (e) {
    return errorResponse(e);
  }
});
