// Edge Function: planilhas-nf-sync
//
// As cinco planilhas de formulário viram notas fiscais com link, casam com os
// lançamentos de PIX e de cartão, e conferem contra o anexo que o ERP realmente
// tem. Duas perguntas de uma vez:
//
//   • "cadê a nota deste PIX?"  — ela estava num formulário o tempo todo.
//   • "a automação anexou mesmo?" — 527 linhas dizem "Anexado! ✓". Aqui isso
//     deixa de ser promessa e passa a ser conferido contra o `ListarAnexo`.
//
// A DIVISÃO DE TRABALHO, que é a decisão central:
//   • esta função só BAIXA e EXTRAI (o parser é puro, mora em `_shared` e tem
//     gêmeo testado no front);
//   • quem CASA é o Postgres (`notas_externas_casar`), porque casar 2.326
//     notas contra ~6.000 lançamentos é junção indexada, não laço em TypeScript;
//   • quem MANDA o arquivo ao Omie é a `omie-anexar-comprovante`, pela fila
//     `fila_erp` — e só depois de alguém clicar. Anexo no ERP é difícil de
//     desfazer.
//
// Body: { action?: 'sync' | 'previa', fonte?: <uma das cinco> }
//   'previa' baixa e conta, sem gravar nada.
// Cron: header `x-cron-token`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { FONTES, notasDaPlanilha, type FonteNota, type NotaPlanilha } from "../_shared/planilhas-notas.ts";
import { lerComoCsv } from "../_shared/sheets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * A planilha vira CSV pela CONTA CONECTADA (`_shared/sheets.ts`), não pelo link.
 *
 * Isto lia `export?format=csv`, que é anônimo e só funciona com "qualquer pessoa
 * com o link" ligado. Em 29/08/2026 a planilha de churn perdeu esse
 * compartilhamento e a sync dela morreu calada por um dia — estas cinco vinham
 * pelo mesmo caminho e correriam o mesmo risco. O conteúdo é o mesmo: o Sheets
 * devolve o valor formatado, e a serialização em CSV entrega ao parser
 * exatamente o que o Google entregava.
 *
 * Uma fonte que cai NÃO derruba as outras: o erro fica na resposta, com nome, e
 * as demais seguem. Foi assim que se descobriu que uma planilha tinha perdido o
 * compartilhamento sem ninguém notar.
 */
async function baixar(id: string): Promise<{ csv: string | null; erro: string | null }> {
  try {
    const csv = await lerComoCsv(id);
    if (!csv.trim()) return { csv: null, erro: "a planilha voltou vazia" };
    return { csv, erro: null };
  } catch (e) {
    return { csv: null, erro: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/**
 * A linha do banco.
 *
 * TODAS as notas levam AS MESMAS CHAVES, sem exceção: o upsert em lote do
 * PostgREST unifica as colunas de todos os objetos do lote, e o campo que falta
 * num vira `null` explícito nos outros. Uma nota sem `competencia` apagaria a
 * competência das outras 99 do mesmo lote.
 */
function paraOBanco(n: NotaPlanilha, agora: string) {
  return {
    chave: n.chave,
    fonte: n.fonte,
    linha: n.linha,
    ordem: n.ordem,
    enviado_em: n.enviadoEm,
    // O vencimento que a planilha declara. Vai como `null` nas fontes que não
    // perguntam — e TEM de ir, porque o upsert em lote unifica as colunas de
    // todos os objetos e o campo ausente num apagaria o dos outros.
    vencimento: n.vencimento,
    nome: n.nome,
    cnpj: n.cnpj,
    documento: n.documento,
    valor: n.valor,
    valor_parcela: n.valorParcela,
    forma_pagamento: n.formaPagamento,
    competencia: n.competencia,
    o_que_e: n.oQueE,
    detalhe: n.detalhe,
    status_planilha: n.statusPlanilha,
    diz_anexado: n.dizAnexado,
    drive_id: n.driveId,
    link: n.link,
    visto_em: agora,
    atualizado_em: agora,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "planilhas-nf-sync").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const previa = body?.action === "previa";
    const soFonte = body?.fonte as FonteNota | undefined;

    const agora = new Date().toISOString();
    const porFonte: Record<string, { linhas: number; notas: number; erro: string | null }> = {};
    const todas: NotaPlanilha[] = [];

    for (const p of FONTES) {
      if (soFonte && soFonte !== p.fonte) continue;
      const { csv, erro } = await baixar(p.id);
      if (!csv) {
        porFonte[p.fonte] = { linhas: 0, notas: 0, erro };
        continue;
      }
      const notas = notasDaPlanilha(p.fonte, csv);
      todas.push(...notas);
      porFonte[p.fonte] = {
        linhas: new Set(notas.map((n) => n.linha)).size,
        notas: notas.length,
        erro: null,
      };
    }

    if (previa) {
      return json({
        ok: true, previa: true, por_fonte: porFonte, notas: todas.length,
        com_cnpj: todas.filter((n) => n.cnpj).length,
        com_valor: todas.filter((n) => n.valor).length,
        diz_anexado: todas.filter((n) => n.dizAnexado).length,
        amostra: todas.slice(0, 5),
      });
    }

    if (!todas.length) {
      return json({ ok: false, error: "nenhuma planilha respondeu", por_fonte: porFonte }, 502);
    }

    /* ---------- gravar ---------- */
    /* Lote de 100. A `chave` é `fonte|linha|driveId`: reimportar a mesma
       planilha amanhã cai nos mesmos registros e não duplica nada, e o que a
       pessoa decidiu (alvo manual, ignorado, fila) fica intacto — o upsert só
       encosta nas colunas que vêm daqui. */
    let gravadas = 0;
    for (let i = 0; i < todas.length; i += 100) {
      const lote = todas.slice(i, i + 100).map((n) => paraOBanco(n, agora));
      const { error } = await supabase.from("notas_externas")
        .upsert(lote, { onConflict: "chave" });
      if (error) throw new Error(`gravar (${i}): ${error.message}`);
      gravadas += lote.length;
    }

    /* ---------- as pastas do Drive, de carona ----------
       Elas são lidas por outra função (`comprovantes-drive-sync`, com DANFE e
       OCR), mas a passagem da leitura para cá é uma cópia idempotente e barata.
       Fazê-la aqui é o que faz o botão "Cruzar notas" cumprir o que promete:
       cruzar TODAS as origens, e não só as planilhas. */
    const { data: doDrive, error: erroDrive } = await supabase.rpc("notas_externas_do_drive");
    if (erroDrive) console.error("notas_externas_do_drive:", erroDrive.message);

    /* ---------- casar e conferir ----------
       ACESSÓRIO, e por isso não derruba a rodada. `notas_externas_casar` leva
       20–27s e o PostgREST corta em 8s: a conexão entra como `authenticator`
       (`statement_timeout=8s`) e `service_role` não tem `rolconfig` que a
       levante, então o `SET LOCAL ROLE` herda o teto de 8s. Ou seja, esta
       chamada FALHA por construção sempre que o acervo cresce — não é
       intermitência.

       Quem casa de verdade é o cron `notas-acervo-casar` (:00 e :30), que roda
       a mesma função dentro do Postgres, sem PostgREST no caminho e portanto
       sem o teto. É o mesmo arranjo de `nota-baixar-link`, `nota-caixa` e
       `nota-ler-arquivo`, que já engolem o erro com "o cron :30 recasa".

       Antes isto era `throw`, e o custo era desproporcional: as 5 planilhas
       tinham sido lidas e as notas já estavam gravadas em lotes de 100 — tudo
       comitado — e mesmo assim a função devolvia 500 com `ok:false`. O painel
       marcava a automação como falhando, e o trabalho que deu certo não
       aparecia em lugar nenhum. */
    let resumo: unknown = null;
    let erroCasarMsg: string | null = null;
    const { data: dadosCasar, error: erroCasar } = await supabase.rpc("notas_externas_casar");
    if (erroCasar) {
      erroCasarMsg = erroCasar.message;
      console.error("notas_externas_casar:", erroCasarMsg);
    } else {
      resumo = dadosCasar;
    }

    return json({
      ok: true, por_fonte: porFonte, gravadas,
      do_drive: Number(doDrive ?? 0), do_drive_erro: erroDrive?.message ?? null,
      resumo, casar_erro: erroCasarMsg,
    });
  } catch (e) {
    console.error("planilhas-nf-sync", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
