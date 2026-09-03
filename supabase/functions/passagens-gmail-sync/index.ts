// Edge Function: passagens-gmail-sync
//
// Lê os alertas de preço do Google Flights na caixa do financeiro@ e transforma
// em curva de preço + aviso no sino, para as viagens que estão em rastreamento.
//
//   { action: "sync", dias?, q?, limite? }   → lê a caixa e grava
//   { action: "atribuir", email_id, viagem_id } → o humano diz de qual viagem é
//
// POR QUE E-MAIL E NÃO API. Ver a migração de 03/09/2026: em 2026 a Amadeus
// Self-Service desligou, a Kiwi fechou para novos e a Duffel de teste devolve
// sandbox. O Google Flights monitora de graça e avisa por e-mail; a caixa já é
// lida por este Hub. Custo de raspagem: zero.
//
// O QUE ESTA FUNÇÃO NÃO FAZ: decidir. Ela grava o ponto na curva e, quando o
// preço cruza o teto que uma PESSOA digitou, abre um sinal. Quem compra é
// gente — igual ao Radar, que avisa e não compra.
//
// O CASAMENTO É CONTRA A LISTA CURTA, e é isso que o torna robusto: em vez de
// extrair rota e data de um e-mail de layout desconhecido, ele pergunta "qual
// destas N viagens abertas combina com este texto?". Quando o Google mudar o
// layout, o casamento degrada para "não achei" — que vira fila humana visível —
// em vez de degradar para "achei errado", que sujaria a curva em silêncio.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { listar, mensagem, segredosDoGmail, tokenDeAcesso } from "../_shared/gmail.ts";
import { casarEmail, deveAvisar, rotaTexto, type ViagemParaCasar } from "../_shared/passagens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * A busca na caixa.
 *
 * PROVISÓRIA ATÉ O PRIMEIRO ALERTA REAL CHEGAR, e está escrito aqui para que
 * ninguém a tome por verificada: o remetente e o assunto exatos do alerta do
 * Google Flights não foram conferidos contra um e-mail de verdade. Por isso a
 * rede é larga (qualquer coisa de google.com que fale de voo/preço) e por isso
 * `q` pode vir no corpo da chamada — dá para ajustar a busca sem republicar a
 * função, olhar o que veio em `passagens_emails.trecho`, e só então fixar aqui.
 */
const Q_PADRAO = 'from:google.com (flights OR voos OR "alerta de preço" OR "price alert" OR "queda de preço") ' +
  "-in:sent -in:draft -in:trash";

/** O worker morre por volta dos 150s sem devolver nada. Paramos antes e dizemos. */
const ORCAMENTO_MS = 110_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    /* Cron ou gente — mesmo desenho do facilities-radar: o `name` entra no
       filtro junto com o token, porque credencial que abre qualquer porta não
       é credencial. */
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "passagens-gmail-sync").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "sync";

    /* ------------------------------------------------------- atribuir */
    /* O e-mail que não casou espera gente. Esta ação é o "de qual viagem é",
       e ela precisa existir: sem ela, o e-mail órfão seria só um item numa
       lista que ninguém consegue resolver. */
    if (action === "atribuir") {
      const emailId = Number(body?.email_id);
      const viagemId = String(body?.viagem_id ?? "");
      if (!emailId || !viagemId) return json({ ok: false, erro: "Informe o e-mail e a viagem." }, 400);

      const { data: em, error: eLer } = await supabase.from("passagens_emails")
        .select("id, preco, viagem_id").eq("id", emailId).maybeSingle();
      if (eLer) throw new Error(eLer.message);
      if (!em) return json({ ok: false, erro: "E-mail não encontrado." }, 404);
      if (em.viagem_id) return json({ ok: false, erro: "Esse e-mail já está atribuído a uma viagem." }, 400);
      if (em.preco == null) {
        return json({ ok: false, erro: "Esse e-mail não tem preço em reais — não há o que gravar na curva." }, 400);
      }

      const gravado = await gravarPreco(supabase, viagemId, Number(em.preco), "email_google");
      await supabase.from("passagens_emails")
        .update({ viagem_id: viagemId, confianca: "alta", motivo: "atribuído à mão" })
        .eq("id", emailId);

      return json({ ok: true, ...gravado, duracao_ms: Date.now() - t0 });
    }

    /* ---------------------------------------------------------- preço */
    /* O preço digitado à mão entra pela MESMA porta do e-mail, e não por um
       insert direto da tela. É `gravarPreco` quem lê o menor anterior, decide
       pelo teto e abre o sinal — se a tela gravasse sozinha, um preço manual
       dentro do teto não acordaria ninguém, e a pessoa que digitou seria a
       única a saber. Vale mais ainda enquanto o parser do e-mail não foi
       conferido contra um alerta real: por aqui o módulo já funciona inteiro
       com alguém olhando o Google e digitando. */
    if (action === "preco") {
      const viagemId = String(body?.viagem_id ?? "");
      const preco = Number(body?.preco);
      if (!viagemId) return json({ ok: false, erro: "Informe a viagem." }, 400);
      if (!(preco > 0)) return json({ ok: false, erro: "Informe um preço válido." }, 400);
      const g = await gravarPreco(supabase, viagemId, preco, "manual");
      return json({ ok: true, ...g, duracao_ms: Date.now() - t0 });
    }

    if (action !== "sync") return json({ ok: false, erro: `Ação desconhecida: ${action}` }, 400);

    /* ---------------------------------------------------------- sync */

    /* Viagem cuja ida já passou sai do "rastreando" ANTES de qualquer leitura:
       casar um e-mail com uma viagem que já aconteceu gravaria preço numa curva
       que ninguém vai mais usar, e tiraria a vaga de um casamento certo. */
    const { data: expiradas } = await supabase.rpc("passagens_expirar");

    const { data: viagens, error: eViagens } = await supabase
      .from("passagens_viagens")
      .select("id, origem, destino, data_ida, data_volta, teto")
      .eq("status", "rastreando");
    if (eViagens) throw new Error(eViagens.message);

    const abertas = (viagens ?? []) as Array<ViagemParaCasar & { teto: number }>;
    if (!abertas.length) {
      return json({
        ok: true, viagens: 0, lidos: 0, casados: 0, orfaos: 0, avisos: 0,
        expiradas: expiradas ?? 0,
        mensagem: "Nenhuma viagem em rastreamento — não há com o que casar os alertas.",
        duracao_ms: Date.now() - t0,
      });
    }

    const dias = Math.min(Math.max(Number(body?.dias ?? 7), 1), 90);
    const q = `${String(body?.q ?? Q_PADRAO)} newer_than:${dias}d`;
    const limite = Math.min(Math.max(Number(body?.limite ?? 60), 1), 200);

    const s = await segredosDoGmail(supabase);
    const token = await tokenDeAcesso(s);

    const res = {
      lidos: 0, casados: 0, orfaos: 0, avisos: 0, ja_vistos: 0,
      restante: 0 as number,
    };

    let pageToken: string | undefined;
    const vistos: string[] = [];
    // Uma página basta para o volume esperado; o laço existe para o dia em que
    // a caixa acumular (o cron ficou fora do ar, alguém subiu o `dias`).
    while (vistos.length < limite) {
      const { ids, proxima } = await listar(token, q, pageToken, Math.min(100, limite - vistos.length));
      for (const r of ids) vistos.push(r.id);
      if (!proxima) break;
      pageToken = proxima;
      if (Date.now() - t0 > ORCAMENTO_MS) break;
    }

    /* JÁ LIDO NÃO SE LÊ DE NOVO. O `gmail_id` é único na tabela, então o banco
       impediria o ponto duplicado de qualquer jeito — mas descobrir isso pelo
       erro do insert custaria uma leitura completa da mensagem (uma chamada de
       rede por e-mail) para jogar fora depois. */
    const { data: conhecidos } = await supabase
      .from("passagens_emails").select("gmail_id").in("gmail_id", vistos.slice(0, 500));
    const jaVistos = new Set((conhecidos ?? []).map((c: any) => c.gmail_id));

    const paraLer = vistos.filter((id) => !jaVistos.has(id));
    res.ja_vistos = vistos.length - paraLer.length;

    for (let i = 0; i < paraLer.length; i++) {
      if (Date.now() - t0 > ORCAMENTO_MS) { res.restante = paraLer.length - i; break; }
      const id = paraLer[i];
      try {
        const m = await mensagem(token, id);
        res.lidos++;

        const c = casarEmail(m.assunto ?? "", m.corpo ?? "", abertas);

        const { data: linha, error: eIns } = await supabase.from("passagens_emails").insert({
          gmail_id: id,
          assunto: m.assunto ?? null,
          recebido_em: m.data ?? null,
          viagem_id: c.viagem_id,
          preco: c.preco,
          confianca: c.confianca,
          motivo: c.motivo,
          // Bastante para depurar o parser sem guardar a caixa inteira no banco.
          trecho: String(m.corpo ?? "").slice(0, 2000),
        }).select("id").single();
        // 23505 = alguém gravou o mesmo e-mail entre a checagem e agora.
        if (eIns && (eIns as any).code !== "23505") throw new Error(eIns.message);
        if (eIns) continue;

        if (!c.viagem_id || c.preco == null) { res.orfaos++; continue; }

        const v = abertas.find((x) => x.id === c.viagem_id)!;
        const g = await gravarPreco(supabase, c.viagem_id, c.preco, "email_google", v, linha?.id);
        res.casados++;
        if (g.avisou) res.avisos++;
      } catch (e) {
        // Um e-mail ilegível não pode derrubar a rodada inteira: os outros
        // continuam, e este reaparece na próxima (não foi gravado).
        console.error("passagens: e-mail", id, (e as Error)?.message);
      }
    }

    return json({
      ok: true,
      viagens: abertas.length,
      expiradas: expiradas ?? 0,
      ...res,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    return json({ ok: false, erro: String((e as Error)?.message ?? e) }, 400);
  }
});

/**
 * Grava o ponto e decide se acorda alguém.
 *
 * O MENOR ANTERIOR É LIDO ANTES DE INSERIR — se lesse depois, o preço que
 * acabou de entrar seria o próprio "menor já visto" e nada nunca seria novidade.
 * É a mesma armadilha que o Radar documenta no histórico de alerta.
 */
async function gravarPreco(
  supabase: any,
  viagemId: string,
  preco: number,
  fonte: "email_google" | "manual",
  viagem?: { origem: string; destino: string; data_ida: string; teto: number },
  emailId?: number,
): Promise<{ gravado: boolean; avisou: boolean; motivo: string }> {
  const { data: antes } = await supabase
    .from("passagens_precos").select("preco").eq("viagem_id", viagemId)
    .order("preco", { ascending: true }).limit(1).maybeSingle();
  const menorAntes = antes ? Number(antes.preco) : null;

  const { error } = await supabase.from("passagens_precos").insert({ viagem_id: viagemId, preco, fonte });
  if (error) throw new Error(error.message);

  const v = viagem ?? (await supabase.from("passagens_viagens")
    .select("origem, destino, data_ida, teto").eq("id", viagemId).maybeSingle()).data;
  if (!v) return { gravado: true, avisou: false, motivo: "viagem não encontrada para avaliar o teto" };

  const d = deveAvisar(preco, Number(v.teto), menorAntes);
  if (!d.avisar) return { gravado: true, avisou: false, motivo: d.motivo };

  const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const rota = rotaTexto(v.origem, v.destino);
  const dataBr = String(v.data_ida).split("-").reverse().join("/");

  /* A ASSINATURA CARREGA O PREÇO, e isso é o que faz o sino não repetir. O
     índice único de `sinais` é (serie, chave, assinatura) entre os não
     resolvidos: mesmo preço = mesma assinatura = o insert bate no conflito e
     não abre sinal novo. Um preço MENOR muda a assinatura e abre outro, que é
     exatamente a notícia que se quer ("caiu mais ainda"). */
  const { error: eSinal } = await supabase.from("sinais").insert({
    serie: "passagens.abaixo_do_teto",
    chave: viagemId,
    assinatura: `passagens.abaixo_do_teto:${viagemId}:${Math.round(preco)}`,
    titulo: `${rota} em ${dataBr} por ${brl(preco)} — dentro do teto`,
    corpo: menorAntes == null
      ? `Primeiro preço dentro do teto de ${brl(Number(v.teto))}.`
      : `Caiu de ${brl(menorAntes)} para ${brl(preco)}. Teto: ${brl(Number(v.teto))}.`,
    acao: "Abrir o Google Flights e comprar, se ainda estiver valendo.",
    valor: Number(v.teto) - preco,
    gravidade: "alta",
  });
  // 23505 = já existe sinal aberto com esta assinatura. É o comportamento certo.
  if (eSinal && (eSinal as any).code !== "23505") console.error("passagens: sinal", eSinal.message);
  if (emailId) {
    await supabase.from("passagens_emails").update({ motivo: `${d.motivo} — avisou` }).eq("id", emailId);
  }

  return { gravado: true, avisou: !eSinal, motivo: d.motivo };
}
