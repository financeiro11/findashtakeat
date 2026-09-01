// DESLIGAR A EMISSÃO DE NFS-e DO ASAAS — para o Omie ficar como único emissor.
//
// São DUAS coisas independentes, e desligar uma não desliga a outra. Foi essa
// confusão que quase deixou setembro inteiro sair pelos dois lados:
//
//   1. `invoiceSettings` da ASSINATURA — o ajuste que manda emitir nota a cada
//      cobrança. Removido, nenhuma nota NOVA é agendada. Não toca na assinatura,
//      na cobrança nem no cliente: só na emissão fiscal.
//   2. As notas JÁ AGENDADAS (`SCHEDULED`) — objetos que já existem, com data
//      marcada. Remover o item 1 NÃO as cancela; elas disparam sozinhas. Em
//      01/09/2026 eram 1.456 entre hoje e 30/09, ~R$ 500 mil.
//
// A FOTO VEM ANTES DE APAGAR, sempre. `DELETE /subscriptions/{id}/
// invoiceSettings` não devolve o que removeu, e reconfigurar duas mil assinaturas
// na mão não é opção — então cada remoção grava o JSON em
// `asaas_nf_desligamento` primeiro. Se a gravação falhar, NÃO se apaga: um
// desligamento sem volta é pior do que um desligamento incompleto, porque o
// incompleto se termina na próxima leva e o sem volta não se desfaz.
//
// A LEVA SE MEDE EM TEMPO, não em registros — o worker morre por volta dos 150s
// sem exceção que dê para pegar, e as duas rodadas são retomáveis (a guarda é
// `asaas_nf_desligamento`, não um cursor). Parar no meio não perde trabalho.
//
// Ações (body.action):
//   "previa" (default) → o que existe para desligar. Não escreve nada.
//   "assinaturas"      → foto + DELETE do invoiceSettings. Params: { teto }
//   "agendadas"        → cancela as notas em SCHEDULED. Params: { teto }
//
// Auth: usuário logado OU cron (x-cron-token), no padrão do repo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { asaasGet, asaasPost, asaasDelete } from "../_shared/asaas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O relógio da leva. 110s dos 150s do worker, com folga para gravar o resultado. */
const PRAZO_MS = 110_000;

/** O erro do Asaas quando o recurso simplesmente não existe mais. */
const ehNaoExiste = (e: unknown) => /\[404\]/.test(e instanceof Error ? e.message : String(e));

/* ------------------------------- assinaturas ------------------------------- */

/**
 * Remove a configuração de nota fiscal das assinaturas, com foto antes.
 *
 * Quem entra: assinatura marcada `tem_config = true` no espelho e que ainda não
 * tem linha de sucesso em `asaas_nf_desligamento`. O espelho pode estar velho —
 * por isso o 404 do GET não é erro, é "esta já não emitia", e vira sucesso com
 * `config = null`.
 */
async function desligarAssinaturas(
  supabase: any, opts: { teto: number; operador: string | null },
) {
  const { data: alvos, error } = await supabase
    .from("asaas_nf_config")
    .select("assinatura")
    .eq("tem_config", true)
    .limit(Math.max(1, Math.min(opts.teto, 400)));
  if (error) return { erro: `asaas_nf_config: ${error.message}` };
  if (!alvos?.length) return { alvos: 0, desligadas: 0, ja_desligadas: 0, falhas: 0, resultados: [] };

  // Quem já foi tratado com sucesso não volta. Uma consulta, não uma por linha.
  const ids = alvos.map((a: any) => String(a.assinatura));
  const { data: feitos } = await supabase
    .from("asaas_nf_desligamento")
    .select("referencia")
    .eq("alvo", "assinatura").eq("ok", true)
    .in("referencia", ids);
  const jaFeito = new Set((feitos ?? []).map((f: any) => String(f.referencia)));
  const fila = ids.filter((id) => !jaFeito.has(id));

  const inicio = Date.now();
  let desligadas = 0, jaNaoEmitia = 0, falhas = 0, interrompido = false;
  const resultados: any[] = [];

  for (const assinatura of fila) {
    if (Date.now() - inicio > PRAZO_MS) { interrompido = true; break; }

    let config: any = null;
    try {
      config = await asaasGet<any>(`/subscriptions/${assinatura}/invoiceSettings`);
    } catch (e) {
      if (!ehNaoExiste(e)) {
        // Erro de LEITURA não é ausência de dado. Sem a foto não se apaga.
        falhas++;
        resultados.push({ assinatura, ok: false, motivo: `Não deu para ler a configuração: ${String(e).slice(0, 140)}. Nada foi removido.` });
        await supabase.from("asaas_nf_desligamento").insert({
          alvo: "assinatura", referencia: assinatura, ok: false,
          erro: String(e).slice(0, 400), operador: opts.operador,
        });
        await dorme(150);
        continue;
      }
      // 404: já não emitia. Registra assim mesmo — é o que responde depois
      // "por que esta não aparece no rastro?".
      await supabase.from("asaas_nf_desligamento").insert({
        alvo: "assinatura", referencia: assinatura, config: null, ok: true,
        erro: "Não havia configuração de nota (404) — esta assinatura já não emitia.",
        operador: opts.operador,
      });
      await supabase.from("asaas_nf_config")
        .update({ tem_config: false, lido_em: new Date().toISOString() })
        .eq("assinatura", assinatura);
      jaNaoEmitia++;
      await dorme(150);
      continue;
    }

    // A FOTO PRIMEIRO. Se ela não grava, não se apaga.
    const { error: erroFoto } = await supabase.from("asaas_nf_desligamento").insert({
      alvo: "assinatura", referencia: assinatura, config, ok: false, operador: opts.operador,
    }).select("id").single();
    if (erroFoto) {
      falhas++;
      resultados.push({ assinatura, ok: false, motivo: `A foto da configuração não gravou (${erroFoto.message}). Nada foi removido.` });
      await dorme(150);
      continue;
    }

    try {
      await asaasDelete(`/subscriptions/${assinatura}/invoiceSettings`);
      await supabase.from("asaas_nf_desligamento")
        .update({ ok: true }).eq("alvo", "assinatura").eq("referencia", assinatura).eq("ok", false);
      await supabase.from("asaas_nf_config")
        .update({ tem_config: false, lido_em: new Date().toISOString() })
        .eq("assinatura", assinatura);
      desligadas++;
    } catch (e) {
      falhas++;
      resultados.push({ assinatura, ok: false, motivo: String(e).slice(0, 160) });
      await supabase.from("asaas_nf_desligamento")
        .update({ erro: String(e).slice(0, 400) })
        .eq("alvo", "assinatura").eq("referencia", assinatura).eq("ok", false);
    }
    await dorme(150);
  }

  return {
    alvos: fila.length, desligadas, ja_nao_emitiam: jaNaoEmitia, falhas,
    interrompido, segundos: Math.round((Date.now() - inicio) / 1000),
    resultados: resultados.slice(0, 20),
  };
}

/* -------------------------------- agendadas -------------------------------- */

/**
 * Cancela as notas que o Asaas já agendou.
 *
 * Cancelar aqui é seguro no que importa: nota `SCHEDULED` nunca chegou ao portal
 * nacional, então não há documento fiscal a desfazer — é um agendamento que
 * deixa de existir. O que ela ABRE é o vão: a cobrança que o Omie recusar fica
 * sem nota nenhuma, onde antes o Asaas cobriria. Quem responde por esse vão é a
 * fila `nfse_recusas_a_tratar`, que é por onde a recusa chega a uma pessoa.
 */
async function cancelarAgendadas(
  supabase: any, opts: { teto: number; operador: string | null },
) {
  const { data: alvos, error } = await supabase
    .from("asaas_cache")
    .select("id_asaas, pagamento_ref, dados")
    .eq("tipo", "invoice").eq("status", "SCHEDULED")
    .limit(Math.max(1, Math.min(opts.teto, 400)));
  if (error) return { erro: `asaas_cache: ${error.message}` };
  if (!alvos?.length) return { alvos: 0, canceladas: 0, ja_canceladas: 0, falhas: 0, resultados: [] };

  const ids = alvos.map((a: any) => String(a.id_asaas));
  /* Tratado é tratado, TENHA DADO CERTO OU NÃO.
   *
   * A primeira versão só pulava o sucesso, e a leva seguinte relia o mesmo bloco
   * de 400 do espelho: as que falhavam voltavam para a cabeça da fila e a rodada
   * ficava batendo nelas — 799 tentativas em 388 notas antes de a fila andar um
   * passo. Duas falhas na mesma nota já dizem que insistir não é o caminho. */
  const { data: feitos } = await supabase
    .from("asaas_nf_desligamento")
    .select("referencia, ok")
    .eq("alvo", "nota_agendada")
    .in("referencia", ids);
  const jaFeito = new Set<string>();
  const falhas_por_nota = new Map<string, number>();
  for (const f of feitos ?? []) {
    const ref = String(f.referencia);
    if (f.ok) jaFeito.add(ref);
    else falhas_por_nota.set(ref, (falhas_por_nota.get(ref) ?? 0) + 1);
  }
  const fila = alvos.filter((a: any) => {
    const id = String(a.id_asaas);
    return !jaFeito.has(id) && (falhas_por_nota.get(id) ?? 0) < 2;
  });

  const inicio = Date.now();
  let canceladas = 0, jaCanceladas = 0, falhas = 0, interrompido = false;
  const resultados: any[] = [];

  for (const nota of fila) {
    if (Date.now() - inicio > PRAZO_MS) { interrompido = true; break; }
    const id = String(nota.id_asaas);
    try {
      const r = await asaasPost<any>(`/invoices/${id}/cancel`, {});
      await supabase.from("asaas_nf_desligamento").insert({
        alvo: "nota_agendada", referencia: id, config: nota.dados ?? null,
        ok: true, operador: opts.operador,
      });
      // O espelho acompanha a escrita, senão ele mente até a próxima sync e a
      // leva seguinte volta a oferecer a mesma nota.
      await supabase.from("asaas_cache")
        .update({ status: String(r?.status ?? "CANCELED"), atualizado_em: new Date().toISOString() })
        .eq("tipo", "invoice").eq("id_asaas", id);
      canceladas++;
    } catch (e) {
      const msg = String(e);
      /* "JÁ ESTÁ CANCELADA" NÃO É FALHA — é o resultado que se queria, alcançado
       * antes. O Asaas responde 400 `invalid_object` ("A Nota fiscal está com
       * status Cancelada e não pode ser cancelada") para nota que já saiu de
       * cena; quem está errado é o espelho, que é diário. Tratar isso como erro
       * fez a rodada gastar 799 tentativas em 388 notas que já estavam prontas.
       * Cura-se o espelho e segue. */
      if (/status Cancelada|j[áa]\s+(est[áa]|foi)\s+cancelad/i.test(msg)) {
        await supabase.from("asaas_nf_desligamento").insert({
          alvo: "nota_agendada", referencia: id, config: nota.dados ?? null, ok: true,
          erro: "Já estava cancelada no Asaas — o espelho é que estava velho.",
          operador: opts.operador,
        });
        await supabase.from("asaas_cache")
          .update({ status: "CANCELED", atualizado_em: new Date().toISOString() })
          .eq("tipo", "invoice").eq("id_asaas", id);
        jaCanceladas++;
        await dorme(150);
        continue;
      }
      falhas++;
      resultados.push({ nota: id, ok: false, motivo: msg.slice(0, 160) });
      await supabase.from("asaas_nf_desligamento").insert({
        alvo: "nota_agendada", referencia: id, ok: false,
        erro: msg.slice(0, 400), operador: opts.operador,
      });
    }
    await dorme(150);
  }

  return {
    alvos: fila.length, canceladas, ja_canceladas: jaCanceladas, falhas, interrompido,
    segundos: Math.round((Date.now() - inicio) / 1000),
    resultados: resultados.slice(0, 20),
  };
}

/* ---------------------------------- rota ----------------------------------- */

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "asaas-nf-desligar").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const ehCron = await chamadaDeCron(req, supabase);
    let quem: string | null = null;
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.email ?? caller.userId;
    }
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "previa";
    const operador = String(body?.operador ?? quem ?? "desligamento por token de sistema");

    if (action === "previa") {
      const { count: assinaturas } = await supabase
        .from("asaas_nf_config").select("assinatura", { count: "exact", head: true })
        .eq("tem_config", true);
      const { count: agendadas } = await supabase
        .from("asaas_cache").select("id_asaas", { count: "exact", head: true })
        .eq("tipo", "invoice").eq("status", "SCHEDULED");
      const { count: jaFeitas } = await supabase
        .from("asaas_nf_desligamento").select("id", { count: "exact", head: true }).eq("ok", true);
      return json({
        status: "ok",
        assinaturas_com_config: assinaturas ?? 0,
        notas_agendadas: agendadas ?? 0,
        ja_desligadas: jaFeitas ?? 0,
      });
    }

    if (action === "assinaturas") {
      const r = await desligarAssinaturas(supabase, { teto: Number(body?.teto ?? 200), operador });
      return json({ status: "ok", ...r });
    }

    if (action === "agendadas") {
      const r = await cancelarAgendadas(supabase, { teto: Number(body?.teto ?? 200), operador });
      return json({ status: "ok", ...r });
    }

    return json({ status: "erro", erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ status: "erro", erro: e instanceof Error ? e.message : String(e) }, 400);
  }
});
