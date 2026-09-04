// Edge Function: cartao-recomendar
//
// Transforma os sinais da fatura do cartão em recomendação com AÇÃO — o que a
// tela de Cartão não fazia: ela dizia "SYMPLA +15,8 mil" e parava aí, deixando
// para quem lê descobrir que a Sympla é praça de ingresso e show e que a
// conversa, portanto, é com o time de Eventos.
//
// COMO FUNCIONA
//   1. `cartao_series()` devolve a série de cada fornecedor, a história INTEIRA.
//   2. `detectar()` (_shared/cartao-sinais.ts) escolhe os candidatos da fatura com
//      limiares FIXOS, calibrados contra as 8 faturas de 2026. Nenhuma IA aqui:
//      se o critério variasse de mês para mês, "nada apareceu nesta fatura" não
//      significaria nada.
//   3. A IA só REDIGE em cima dos fatos: o que o estabelecimento provavelmente é
//      (conhecimento de mundo dela) e com quem conferir (Biblioteca da empresa).
//      Ela não faz conta — os números chegam formatados e ela copia.
//
// A pergunta que o texto responde é "o que eu faço com isso?". Por isso `acao` é
// campo separado, e não uma frase perdida no fim do parágrafo: é ela que vira o
// título da tarefa em /tarefas quando alguém clica.
//
// Body: {
//   competencia?: '2026-08-01',   // padrão: a última fatura importada
//   force?: boolean,              // reescreve inclusive o que já foi conferido
//   preview?: boolean             // devolve os candidatos SEM chamar a IA e SEM gravar
// }
//
// `preview` é o modo de calibrar limiar: mexer numa constante do detector e ver o
// que muda em cada fatura, sem gastar IA e sem sujar a tela.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
// OpenAI, e não Gemini, pelo mesmo motivo dos comentários da DRE/DFC: a cota do
// Gemini estourava (429) justamente no fechamento, que é quando isto é usado.
import { generateJSON, handleCors, jsonResponse, errorResponse, DEFAULT_MODEL } from "../_shared/openai.ts";
import { buildOrgContext } from "../_shared/org-context.ts";
import { detectar, labelMes, type Candidato, type PontoSerie } from "../_shared/cartao-sinais.ts";

/* ============================================================
 *  Estilo — o contrato de saída
 * ============================================================
 * Os dois exemplos são os que o Henrique escreveu ao pedir o recurso. Ficam aqui,
 * e não numa tabela, porque são a DEFINIÇÃO do formato: mudar isso é mudar o que
 * a função entrega, não configurar um parâmetro.
 */
const ESTILO = `
Você escreve as recomendações que aparecem na tela do cartão corporativo da
Takeat, para o time financeiro (Henrique e Júlia) ler quando a fatura do mês
chega. Cada recomendação nasce de um SINAL já detectado nos números — você não
escolhe o que é relevante, isso já foi decidido. Seu trabalho é dizer o que
aquilo provavelmente é e o que fazer.

COMO ELAS SÃO (os dois exemplos que o pedido trouxe):

• "Pude notar um aumento repentino no número de compras na Sympla. Provavelmente
   são ingressos para eventos. Conferir com o time de Eventos quais são."

• "O HubSpot é um software recorrente nas faturas e, dessa vez, não apareceu.
   Confira se não houve erro no pagamento, no cartão ou no cadastro da cobrança."

REGRAS

1. DIGA O QUE O ESTABELECIMENTO É. É o principal valor da recomendação: quem lê a
   fatura vê "SYMPLA" e não sabe o que fazer; quem sabe que a Sympla vende
   ingresso e divulga show já sabe com quem falar. Use o que você conhece do
   mundo sobre a marca, mais a categoria, a cidade e a descrição crua do OFX que
   vêm no dossiê.
2. NÃO INVENTE O QUE NÃO RECONHECE. Muitos nomes vêm mascarados pelo adquirente
   ("JIM COM L G DA SILVA", "KNDTEC", "SCIENT CONSUL"). Se você não tem certeza do
   que é, DIGA QUE NÃO É RECONHECÍVEL pelo nome e mande conferir a descrição
   original do OFX e com quem usou o cartão. Um palpite errado sobre o fornecedor
   é pior que nenhum palpite: ele manda a pessoa perguntar para o time errado.
3. NÃO INVENTE A CAUSA. Você sabe O QUE aconteceu com o número (isso está em
   "fatos"); você não sabe POR QUÊ. Escreva a explicação provável como
   POSSIBILIDADE — "provavelmente", "pode ser", "costuma ser" — nunca como fato.
4. NÃO REFAÇA CONTA NENHUMA. Todo valor que você citar tem de ser copiado
   literalmente de "fatos". Não some, não converta, não arredonde, não invente
   casa decimal.
5. "acao" é UMA frase no imperativo, dizendo o que conferir e — quando fizer
   sentido — com quem. É ela que vira título de tarefa, então tem de funcionar
   lida sozinha: "Conferir com o time de Eventos quais ingressos foram comprados
   na Sympla em agosto". Nada de "analisar melhor" nem "monitorar".
6. "com_quem" é o time ou a pessoa da Biblioteca da empresa que deve responder —
   escreva o nome EXATO como aparece no contexto organizacional (ex.: "Eventos",
   "Marketing", "Tecnologia"). Se nenhum couber com clareza, devolva null. Não
   invente time que não está na lista.
7. "texto": 2 a 4 frases. Português do Brasil, tom de nota interna entre colegas,
   direto. Sem bullets, sem markdown, sem título, sem saudação, sem assinatura,
   sem "é importante ressaltar".
8. Não repita o título da recomendação (ele já está na tela, logo acima do seu
   texto) e não repita os números todos: cite no máximo os dois que sustentam a
   sua leitura.
`.trim();

/* Quantos candidatos por chamada. Uma fatura rende no máximo 8 (teto do
   detector), então na prática é sempre um lote — o loop existe para o dia em que
   o teto subir. */
const LOTE = 8;

type Linha = {
  competencia: string;
  estabelecimento: string;
  sinal: string;
  nivel: string;
  titulo: string;
  valor: number;
  valor_referencia: number;
  razao: number | null;
  lancamentos: number;
  serie: unknown;
  fatos: string[];
  texto: string;
  acao: string | null;
  com_quem: string | null;
  confianca: string;
  modelo: string;
  gerado_em: string;
  atualizado_em: string;
};

const chaveDe = (c: { estabelecimento: string; sinal: string }) => `${c.estabelecimento}|${c.sinal}`;

/** O dossiê que a IA recebe. Só o que ela precisa para redigir — nada de série
 *  crua, que ela tentaria somar. */
function dossie(c: Candidato) {
  const SINAL_PT = {
    pico: "gasto muito acima do normal deste estabelecimento",
    ausente: "fornecedor de cobrança mensal que NÃO apareceu nesta fatura",
    dobrada: "valor de ~2x o de sempre sem aumento na quantidade de lançamentos",
  } as const;
  return {
    chave: chaveDe(c),
    estabelecimento: c.estabelecimento,
    sinal: SINAL_PT[c.sinal],
    tituloNaTela: c.titulo,
    categoriaNaSkill: c.categoria,
    descricaoOriginalNoOfx: c.descricaoOfx || null,
    cidade: c.cidade || null,
    fatos: c.fatos,
  };
}

const ESQUEMA = {
  type: "object",
  properties: {
    recomendacoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chave: { type: "string" },
          texto: { type: "string" },
          acao: { type: "string" },
          com_quem: { type: ["string", "null"] },
          confianca: { type: "string", enum: ["alta", "media", "baixa"] },
        },
        required: ["chave", "texto", "acao", "com_quem", "confianca"],
      },
    },
  },
  required: ["recomendacoes"],
};

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
    const force = !!body?.force;
    const preview = !!body?.preview;

    /* --- 1) Insumos ------------------------------------------------------- */
    const { data: faturasRows, error: fErr } = await supabase
      .from("cartao_faturas").select("competencia,mes_label").order("competencia");
    if (fErr) throw fErr;
    const faturas = (faturasRows ?? []).map((f: { competencia: string }) => String(f.competencia).slice(0, 10));
    if (!faturas.length) return jsonResponse({ ok: true, geradas: 0, motivo: "nenhuma fatura importada" });

    const pedida = String(body?.competencia ?? "").slice(0, 10);
    const competencia = faturas.includes(pedida) ? pedida : faturas[faturas.length - 1];
    const label = labelMes(competencia);

    const { data: serie, error: sErr } = await supabase.rpc("cartao_series");
    if (sErr) throw sErr;

    /* --- 2) Detecção (determinística) ------------------------------------- */
    const candidatos = detectar((serie ?? []) as PontoSerie[], faturas, competencia);

    if (preview) {
      return jsonResponse({
        ok: true, preview: true, competencia, label,
        candidatos: candidatos.map((c) => ({
          estabelecimento: c.estabelecimento, sinal: c.sinal, nivel: c.nivel, titulo: c.titulo,
          valor: c.valor, referencia: c.valorReferencia, razao: c.razao, fatos: c.fatos,
        })),
      });
    }

    /* --- 3) O que já existe ----------------------------------------------
       Regeração não apaga trabalho de gente: o `upsert` mais abaixo não manda
       `status`, `texto_editado` nem `tarefa_id`, então a decisão humana
       atravessa intacta. Aqui só se decide o que NÃO precisa de nova redação. */
    const { data: existentes } = await supabase
      .from("cartao_recomendacoes")
      .select("id,estabelecimento,sinal,valor,valor_referencia,status,texto_editado,tarefa_id")
      .eq("competencia", competencia);

    type Existente = {
      id: string; estabelecimento: string; sinal: string;
      valor: number | null; valor_referencia: number | null;
      status: string; texto_editado: string | null; tarefa_id: string | null;
    };
    const antes = new Map<string, Existente>();
    for (const r of (existentes ?? []) as Existente[]) antes.set(chaveDe(r), r);

    /* Descartável = ninguém tocou. Recomendação conferida, reescrita ou que já
       virou tarefa FICA, mesmo que o sinal tenha sumido: apagar o pedido de
       conferência que alguém aceitou é perder o rastro do trabalho. */
    const descartavel = (r: Existente) =>
      r.status === "novo" && !r.texto_editado && !r.tarefa_id;

    // Sinal que não é mais candidato (reimportaram a fatura e o número mudou)
    // perde a recomendação — senão texto escrito sob a regra antiga fica na tela
    // para sempre, porque o upsert só reescreve o que volta.
    const vivos = new Set(candidatos.map(chaveDe));
    const orfas = [...antes.values()].filter((r) => !vivos.has(chaveDe(r)) && descartavel(r)).map((r) => r.id);
    let removidas = 0;
    if (orfas.length) {
      const { error } = await supabase.from("cartao_recomendacoes").delete().in("id", orfas);
      if (!error) removidas = orfas.length;
    }

    const mudouNumero = (c: Candidato, r: Existente) => {
      const perto = (a: number | null, b: number) =>
        a != null && Math.abs(Number(a) - b) <= Math.max(1, Math.abs(b) * 0.005);
      return !(perto(r.valor, c.valor) && perto(r.valor_referencia, c.valorReferencia));
    };

    let puladas = 0;
    const aRedigir = candidatos.filter((c) => {
      const r = antes.get(chaveDe(c));
      // Mesmos números da última geração: o texto continua valendo. Reescrever
      // gastaria uma ida à IA para produzir quase a mesma frase — e apagaria a
      // diferença entre "já conferi isso" e "acabou de sair".
      if (r && !force && !mudouNumero(c, r)) { puladas++; return false; }
      return true;
    });

    if (!aRedigir.length) {
      return jsonResponse({ ok: true, competencia, label, geradas: 0, puladas, removidas, candidatos: candidatos.length });
    }

    /* --- 4) Redação ------------------------------------------------------- */
    let orgCtx = "";
    try { orgCtx = await buildOrgContext(supabase); } catch { /* segue sem a Biblioteca */ }

    const escrito = new Map<string, { texto: string; acao: string; com_quem: string | null; confianca: string }>();
    let lotesFalhos = 0;
    let falhaIA: string | null = null;

    const redigir = async (lote: Candidato[]) => {
      const out = await generateJSON<{
        recomendacoes: { chave: string; texto: string; acao: string; com_quem: string | null; confianca: string }[];
      }>({
        consumidor: "cartao_recomendar",
        temperature: 0.4,
        responseSchema: ESQUEMA,
        messages: [
          { role: "system", content: `${ESTILO}\n\n${orgCtx}` },
          {
            role: "user",
            content:
              `Fatura do cartão corporativo Sicoob de ${label}.\n\n` +
              `Escreva uma recomendação para CADA item abaixo. Devolva a mesma quantidade de itens, ` +
              `com o campo "chave" idêntico ao que veio.\n\n` +
              JSON.stringify(lote.map(dossie), null, 1),
          },
        ],
      });
      for (const r of out?.recomendacoes ?? []) {
        if (!r?.chave || !r?.texto) continue;
        const quem = typeof r.com_quem === "string" ? r.com_quem.trim() : "";
        escrito.set(String(r.chave), {
          texto: String(r.texto).trim(),
          acao: String(r.acao ?? "").trim(),
          com_quem: quem && quem.toLowerCase() !== "null" ? quem : null,
          confianca: ["alta", "media", "baixa"].includes(r.confianca) ? r.confianca : "media",
        });
      }
    };

    for (let i = 0; i < aRedigir.length; i += LOTE) {
      const lote = aRedigir.slice(i, i + LOTE);
      try {
        await redigir(lote);
      } catch (e) {
        // Segunda tentativa com pausa: gerar várias faturas seguidas dispara as
        // chamadas em rajada e o provedor responde 429.
        await new Promise((r) => setTimeout(r, 4000));
        try {
          await redigir(lote);
        } catch (e2) {
          lotesFalhos++;
          falhaIA = e2 instanceof Error ? e2.message : String(e2);
          console.error("lote falhou", i, e2);
        }
      }
    }

    /* --- 5) Grava ---------------------------------------------------------
       SEM TEXTO, SEM RECOMENDAÇÃO: um card com o título determinístico e o corpo
       vazio é a máquina dizendo que não sabe, ocupando o lugar de quem sabe. O
       sinal continua visível onde é acionável — a matriz logo abaixo mostra o
       número. */
    const linhas: Linha[] = aRedigir
      .filter((c) => escrito.has(chaveDe(c)))
      .map((c) => {
        const g = escrito.get(chaveDe(c))!;
        return {
          competencia,
          estabelecimento: c.estabelecimento,
          sinal: c.sinal,
          nivel: c.nivel,
          titulo: c.titulo,
          valor: c.valor,
          valor_referencia: c.valorReferencia,
          razao: c.razao,
          lancamentos: c.lancamentos,
          serie: c.serie,
          fatos: c.fatos,
          texto: g.texto,
          acao: g.acao || null,
          com_quem: g.com_quem,
          confianca: g.confianca,
          modelo: DEFAULT_MODEL,
          gerado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        };
      });

    if (linhas.length) {
      const { error } = await supabase
        .from("cartao_recomendacoes")
        .upsert(linhas, { onConflict: "competencia,estabelecimento,sinal" });
      if (error) throw error;
    }

    /* Número mudou desde o aceite? O "conferido" envelheceu junto: o texto é
       refeito acima e o status volta para 'novo'. Reescrita e tarefa continuam
       de pé — quem escreveu à mão decide se ainda vale.
       O gatilho é o NÚMERO ter mudado, não o clique em "Regerar": quem já
       conferiu a Sympla de ago/26 não deve perder a marca porque alguém pediu
       para reescrever o texto de outro card. */
    const reabrir = aRedigir
      .map((c) => ({ c, r: antes.get(chaveDe(c)) }))
      .filter(({ c, r }) => !!r && r.status === "aceito" && !r.texto_editado && mudouNumero(c, r))
      .map(({ r }) => r!.id);
    if (reabrir.length) {
      await supabase.from("cartao_recomendacoes")
        .update({ status: "novo", atualizado_em: new Date().toISOString() })
        .in("id", reabrir);
    }

    return jsonResponse({
      ok: true,
      competencia,
      label,
      candidatos: candidatos.length,
      geradas: linhas.length,
      puladas,
      removidas,
      reabertas: reabrir.length,
      // A redação pode falhar sem a chamada falhar. Sem isto, "0 geradas" chega
      // na tela com cara de "não havia o que recomendar".
      sem_texto: aRedigir.length - linhas.length,
      lotes_falhos: lotesFalhos,
      falha_ia: falhaIA,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("cartao-recomendar error:", msg);
    if (msg.includes("autentic") || msg.includes("permissão")) return jsonResponse({ error: msg }, 401);
    return errorResponse(e);
  }
});
