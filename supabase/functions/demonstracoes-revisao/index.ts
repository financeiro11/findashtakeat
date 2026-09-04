// Edge Function: demonstracoes-revisao
//
// Escreve a leitura da reunião mensal de tracker — o que a tela
// `/demonstracoes/revisao` não consegue calcular.
//
// COMO FUNCIONA
//   1. O CLIENTE calcula o sinal (`lib/revisaoMes.ts`) e manda pronto: cascata,
//      Pareto do desvio contra o BP, caixa e metas do mês seguinte, com TODO
//      número já formatado. A conta mora lá pelo mesmo motivo das justificativas
//      da DRE: é a tela que tem o esquema hierárquico e, portanto, os mesmos
//      números que estão à vista. Se o servidor recalculasse a partir do blob,
//      uma pauta poderia dizer "-42,6 k" ao lado de uma grade que mostra outra
//      coisa — e um texto que não bate com o número destrói a confiança em todos
//      os outros.
//   2. O SERVIDOR acrescenta o que o cliente não tem: o contexto organizacional
//      (Biblioteca) e — quando o cliente não mandou — as justificativas já
//      escritas na DRE daquele mês.
//   3. A IA só REDIGE. Ela não escolhe as rubricas (quem escolhe é o Pareto),
//      não faz conta e não inventa número: copia o que recebeu.
//
// Body: {
//   mes: 'Jul-26',          // chave de coluna do blob
//   sinal: Sinal,           // ver lib/revisaoMes.ts
//   detalhe?: 'bloco'|'rubrica',
//   force?: boolean,        // reescreve mesmo que o sinal não tenha mudado
//   preview?: boolean,      // devolve o prompt montado SEM chamar a IA nem gravar
//
//   // --- modo campo: reescreve UM texto e devolve, sem gravar nada ---
//   campo?: { rotulo: string, atual?: string, lista?: boolean },
//   instrucao?: string      // "cite o Datadog", "fale do churn do plano P"
// }
//
// O MODO CAMPO existe porque cada reunião é diferente. Numa, o assunto é a
// folha; na outra, o CEO quer o churn por porte na frente. Refazer a pauta
// inteira para mudar uma frase gastaria uma ida à IA e apagaria as outras nove
// que já estavam boas. Aqui a instrução da pessoa entra JUNTO com o mesmo
// dossiê — ela muda a ênfase, não a fonte dos números, e a regra 1 ("não refaça
// conta") continua valendo.
//
// O modo campo NÃO grava: devolve o texto e o cliente decide o que fazer com
// ele (na tela, vira uma edição no `editado`, que sobrevive ao Regerar).
//
// A reescrita de gente (`editado`) e o "conferi" (`status`) NÃO são tocados
// aqui: o upsert não manda essas colunas. Regerar reescreve o rascunho e deixa
// intacto o que alguém assinou.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
// OpenAI, e não Gemini, pelo mesmo motivo dos comentários da DRE/DFC: a cota do
// Gemini estourava (429) justamente no fechamento, que é quando isto roda.
import {
  generateJSON, handleCors, jsonResponse, errorResponse, DEFAULT_MODEL,
} from "../_shared/openai.ts";
import { buildOrgContext } from "../_shared/org-context.ts";

/* ============================================================
 *  Estilo — o contrato de saída
 * ============================================================
 * A reunião é entre o time financeiro e o CEO, uma vez por mês, em cima do
 * tracker. O texto tem de aguentar ser lido em voz alta com o número do lado.
 */
const ESTILO = `
Você escreve a pauta da reunião mensal de resultado da Takeat — uma empresa de
software para restaurantes, que vende assinatura recorrente. Quem lê é o time
financeiro (Henrique e Júlia) e o CEO, com a DRE do mês projetada na tela.

O QUE JÁ ESTÁ DECIDIDO ANTES DE VOCÊ ESCREVER

O desvio de cada rubrica contra o orçado, quem são os maiores ofensores e quanto
cada um pesa já foram calculados. Você NÃO escolhe o que é relevante e NÃO faz
conta. Seu trabalho é dizer o que aquilo significa para o mês que vem e o que
fazer a respeito.

REGRAS

1. NÃO REFAÇA CONTA NENHUMA. Todo valor que você citar tem de ser COPIADO
   literalmente do dossiê. Não some, não subtraia, não converta de mil para
   milhão, não arredonde, não invente casa decimal. Se um número que você quer
   citar não está no dossiê, não cite número nenhum naquela frase.
2. NÃO INVENTE A CAUSA. O dossiê diz O QUE aconteceu com o número e, quando
   existe, traz o comentário que o time já escreveu na célula da DRE ("por que
   aconteceu"). Fora isso você não sabe por quê. Se precisar supor, escreva como
   POSSIBILIDADE — "provavelmente", "costuma ser" — nunca como fato. E não
   contradiga o comentário do time: ele foi conferido contra os lançamentos.
3. RECORRENTE OU PONTUAL É A PERGUNTA CENTRAL. Cada rubrica traz em "repeticao"
   quantos dos meses fechados anteriores também ficaram do lado ruim do plano.
   Use isso: desvio que se repete continua no mês que vem e é o que precisa de
   decisão; desvio de uma vez só não deve virar corte permanente. Não afirme
   "é pontual" sem que a repetição sustente.
4. "impacto" (por rubrica): 1 a 2 frases sobre o EFEITO NO MÊS SEGUINTE, não uma
   repetição do que já aconteceu. O número já está na linha, logo acima do seu
   texto. Diga o que continua, o que não continua e quanto disso o mês que vem
   herda.
5. "acao" (por rubrica): UMA frase no imperativo, específica e verificável, com
   prazo ou número quando o dossiê der um. "Congelar as duas vagas do 2º semestre
   até a margem voltar ao orçado" serve; "monitorar de perto", "analisar melhor"
   e "buscar eficiência" não servem — se ninguém consegue dizer no mês seguinte
   se foi feito, não é ação.
6. "veredicto_titulo": UMA frase, no máximo 120 caracteres, dizendo o que
   aconteceu com o mês. É a manchete: tem de funcionar lida sozinha.
   "veredicto_resumo": 1 a 2 frases com os números principais copiados do dossiê.
7. "destaques": exatamente 3. Os dois piores e um contraponto (o que segurou o
   resultado, ou o risco que ninguém está olhando). "area" é onde a pessoa vai
   conferir ("DRE · Pessoal", "Caixa", "Carteira"). "titulo" tem no máximo 70
   caracteres.
8. "decisoes": 3 a 5 itens. Cada um é uma PERGUNTA FECHADA ou uma decisão que
   sai desta reunião com sim ou não, não uma tarefa genérica. Amarre cada uma ao
   efeito, copiando o número do dossiê quando houver.
9. "fecho": 1 a 2 frases fechando a conta — se as decisões saírem, quanto do gap
   do mês seguinte elas cobrem, e o que sobra.
10. Português do Brasil, tom de nota interna entre colegas, direto. Sem bullets,
    sem markdown, sem título, sem saudação, sem "é importante ressaltar", sem
    "vale destacar". Não repita o nome da rubrica no começo do texto dela — ele
    já está na tela.
11. Devolva um item em "rubricas" para CADA rubrica do dossiê, com o campo
    "rubrica" idêntico ao que veio. Nem a mais, nem a menos.
`.trim();

const ESQUEMA = {
  type: "object",
  properties: {
    veredicto_nivel: { type: "string", enum: ["critico", "atencao", "ok"] },
    veredicto_titulo: { type: "string" },
    veredicto_resumo: { type: "string" },
    destaques: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nivel: { type: "string", enum: ["critico", "atencao", "info"] },
          area: { type: "string" },
          titulo: { type: "string" },
          texto: { type: "string" },
        },
        required: ["nivel", "area", "titulo", "texto"],
      },
    },
    rubricas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rubrica: { type: "string" },
          impacto: { type: "string" },
          acao: { type: "string" },
        },
        required: ["rubrica", "impacto", "acao"],
      },
    },
    decisoes: { type: "array", items: { type: "string" } },
    fecho: { type: "string" },
  },
  required: ["veredicto_nivel", "veredicto_titulo", "veredicto_resumo", "destaques", "rubricas", "decisoes", "fecho"],
};

type SinalRubrica = {
  rubrica: string;
  bloco?: string;
  natureza?: string;
  lado?: string;
  posicao?: number;
  fmtRealizado?: string;
  fmtOrcado?: string;
  fmtImpacto?: string;
  fmtDesvioPct?: string;
  fmtMoM?: string;
  fatiaPct?: string;
  repeticao?: string;
  justificativa?: string | null;
};

type Sinal = Record<string, unknown> & { rubricas?: SinalRubrica[] };

/* Um texto só, para o modo campo. `itens` é o caminho da lista de decisões — a
   pauta é uma lista, e devolvê-la como um parágrafo com quebras de linha
   obrigaria o cliente a adivinhar onde uma decisão termina. */
const ESQUEMA_CAMPO = {
  type: "object",
  properties: {
    texto: { type: "string" },
    itens: { type: "array", items: { type: "string" } },
  },
  required: ["texto", "itens"],
};

type Escrito = {
  veredicto_nivel: string;
  veredicto_titulo: string;
  veredicto_resumo: string;
  destaques: { nivel: string; area: string; titulo: string; texto: string }[];
  rubricas: { rubrica: string; impacto: string; acao: string }[];
  decisoes: string[];
  fecho: string;
};

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mes = String(body?.mes ?? "").trim();
    const force = !!body?.force;
    const preview = !!body?.preview;
    const detalhe = body?.detalhe === "rubrica" ? "rubrica" : "bloco";
    const sinal = (body?.sinal ?? null) as Sinal | null;

    if (!/^[A-Za-z]{3}-\d{2}$/.test(mes)) {
      return jsonResponse({ error: "Informe o mês no formato da coluna do blob, ex.: 'Jul-26'." }, 400);
    }
    if (!sinal?.rubricas?.length) {
      return jsonResponse({ error: "O sinal chegou sem rubrica nenhuma — não há o que redigir." }, 400);
    }

    /* --- 1) O que o cliente não tem ---------------------------------------
       Os comentários que a DRE já carrega para o mês. O cliente costuma mandá-los
       junto (é ele que os exibe na tela), mas quando não manda, eles vêm daqui —
       sem isso a IA escreveria "impacto" sem saber o porquê que o time já apurou
       nos lançamentos do Omie. Vale para os dois modos. */
    const faltaJustificativa = (sinal.rubricas ?? []).some((r) => !r.justificativa);
    if (faltaJustificativa) {
      const { data: js } = await supabase.rpc("revisao_justificativas", { p_mes: mes });
      const mapa = (js ?? {}) as Record<string, string>;
      for (const r of sinal.rubricas ?? []) {
        if (!r.justificativa && mapa[r.rubrica]) r.justificativa = mapa[r.rubrica];
      }
    }

    const pedido =
      `Reunião de tracker sobre o fechamento de ${sinal.rotuloMes ?? mes}. `
      + `O mês seguinte é ${sinal.proximoMes ?? "—"}.\n\n`
      + `Dossiê (todos os números já formatados — copie, não recalcule):\n`
      + JSON.stringify(sinal, null, 1);

    /* A Biblioteca é a parte cara da montagem (oito tabelas). Fica atrás de uma
       função para não ser paga no caminho que devolve "o sinal não mudou". */
    let orgCtx: string | null = null;
    const contexto = async () => {
      if (orgCtx == null) {
        try { orgCtx = await buildOrgContext(supabase); } catch { orgCtx = ""; }
      }
      return orgCtx;
    };

    /* --- 2) MODO CAMPO: reescreve UM texto e devolve, sem gravar ----------
       O caminho de "pedir para a IA mexer neste card". A instrução da pessoa
       entra junto do MESMO dossiê: ela muda a ênfase, não a fonte dos números. */
    const campo = body?.campo as { rotulo?: string; atual?: string; lista?: boolean } | undefined;
    if (campo?.rotulo) {
      const instrucao = String(body?.instrucao ?? "").trim();
      const atual = String(campo.atual ?? "").trim();
      const pedidoCampo = [
        pedido,
        "",
        `Reescreva APENAS este campo da pauta: "${campo.rotulo}".`,
        atual ? `Texto que está lá hoje:\n${atual}` : "O campo está vazio.",
        instrucao
          ? `O que a pessoa pediu: ${instrucao}`
          : "Nenhuma instrução específica — melhore o texto mantendo o assunto.",
        campo.lista
          ? `Devolva a lista em "itens" (uma decisão por item) e deixe "texto" vazio.`
          : `Devolva o texto em "texto" e deixe "itens" vazio.`,
        "Valem todas as regras de estilo, principalmente a de NÃO refazer conta: "
        + "todo número tem de ser copiado do dossiê. Se a instrução pedir um número "
        + "que não está lá, escreva a frase sem número em vez de inventar.",
      ].join("\n");

      const out = await generateJSON<{ texto?: string; itens?: string[] }>({
        consumidor: "dre_dfc",
        temperature: 0.5,
        responseSchema: ESQUEMA_CAMPO,
        messages: [
          { role: "system", content: `${ESTILO}\n\n${await contexto()}` },
          { role: "user", content: pedidoCampo },
        ],
      });

      return jsonResponse({
        ok: true,
        campo: campo.rotulo,
        texto: texto(out?.texto),
        itens: (out?.itens ?? []).map(texto).filter(Boolean),
        modelo: DEFAULT_MODEL,
      });
    }

    /* --- 3) O que já existe -----------------------------------------------
       Sinal idêntico ao da última geração: o texto continua valendo. Reescrever
       gastaria uma ida à IA para produzir quase as mesmas frases — e apagaria a
       diferença entre "isto eu já li" e "isto acabou de sair". */
    const { data: existente } = await supabase
      .from("demonstracoes_revisao")
      .select("id,sinal,detalhe,status,editado,gerado_em")
      .eq("mes", mes)
      .maybeSingle();

    const mesmoSinal =
      !!existente
      && existente.detalhe === detalhe
      && JSON.stringify(existente.sinal ?? {}) === JSON.stringify(sinal);

    if (mesmoSinal && !force && !preview) {
      return jsonResponse({ ok: true, mes, gerada: false, motivo: "o sinal não mudou desde a última geração" });
    }

    if (preview) {
      return jsonResponse({ ok: true, preview: true, mes, detalhe, prompt: pedido, rubricas: sinal.rubricas?.length ?? 0 });
    }

    /* --- 4) Redação ------------------------------------------------------- */
    const redigir = async () => generateJSON<Escrito>({
      consumidor: "dre_dfc",
      temperature: 0.4,
      responseSchema: ESQUEMA,
      messages: [
        { role: "system", content: `${ESTILO}\n\n${await contexto()}` },
        { role: "user", content: pedido },
      ],
    });

    let out: Escrito;
    try {
      out = await redigir();
    } catch (e) {
      // Segunda tentativa com pausa: gerar vários meses seguidos dispara as
      // chamadas em rajada e o provedor responde 429.
      await new Promise((r) => setTimeout(r, 4000));
      try {
        out = await redigir();
      } catch (e2) {
        const detalheErro = e2 instanceof Error ? e2.message : String(e2);
        console.error("demonstracoes-revisao: a IA não redigiu", detalheErro);
        // SEM TEXTO, SEM PAUTA. Gravar um veredicto vazio poria a máquina
        // dizendo que não sabe no lugar de quem sabe — e a tela já mostra os
        // números, que é a parte que não depende dela.
        return jsonResponse({ error: "A IA não conseguiu redigir a revisão.", detalhe: detalheErro }, 502);
      }
    }

    /* Só as rubricas que ESTAVAM no dossiê. A IA às vezes acrescenta uma linha
       simpática que o Pareto não escolheu; ela apareceria na tela sem número ao
       lado, que é o jeito mais rápido de a pauta perder credibilidade. */
    const pedidas = new Set((sinal.rubricas ?? []).map((r) => r.rubrica));
    const rubricas = (out.rubricas ?? [])
      .filter((r) => pedidas.has(texto(r?.rubrica)))
      .map((r) => ({ rubrica: texto(r.rubrica), impacto: texto(r.impacto), acao: texto(r.acao) }));

    const linha = {
      mes,
      detalhe,
      veredicto_nivel: ["critico", "atencao", "ok"].includes(out.veredicto_nivel) ? out.veredicto_nivel : "atencao",
      veredicto_titulo: texto(out.veredicto_titulo),
      veredicto_resumo: texto(out.veredicto_resumo),
      destaques: (out.destaques ?? []).slice(0, 3).map((d) => ({
        nivel: ["critico", "atencao", "info"].includes(d?.nivel) ? d.nivel : "info",
        area: texto(d?.area),
        titulo: texto(d?.titulo),
        texto: texto(d?.texto),
      })),
      rubricas,
      decisoes: (out.decisoes ?? []).map(texto).filter(Boolean).slice(0, 6),
      fecho: texto(out.fecho),
      sinal,
      modelo: DEFAULT_MODEL,
      gerado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    };

    /* `editado` e `status` ficam de fora do upsert de propósito: a reescrita e o
       "conferi" de gente atravessam a regeração intactos. */
    const { error } = await supabase
      .from("demonstracoes_revisao")
      .upsert(linha, { onConflict: "mes" });
    if (error) throw error;

    return jsonResponse({
      ok: true,
      mes,
      detalhe,
      gerada: true,
      rubricas: rubricas.length,
      // A IA pode devolver menos linhas do que se pediu sem a chamada falhar.
      // Sem isto, uma pauta pela metade chegaria na tela com cara de completa.
      faltando: (sinal.rubricas?.length ?? 0) - rubricas.length,
      modelo: DEFAULT_MODEL,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("demonstracoes-revisao error:", msg);
    if (msg.includes("autentic") || msg.includes("permissão")) return jsonResponse({ error: msg }, 401);
    return errorResponse(e);
  }
});
