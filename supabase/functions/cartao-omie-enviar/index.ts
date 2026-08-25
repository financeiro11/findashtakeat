// Edge Function: cartao-omie-enviar
//
// Cria no Omie as contas a pagar da fatura do cartão — o caminho de escrita que
// a tela `/operacional/cartao` conferia sem poder executar.
//
// A ORDEM É A MESMA DA `omie-trocar-categoria` e pelo mesmo motivo: o Omie é a
// fonte da verdade. Para cada título, primeiro cria LÁ e só depois registra
// aqui, em `cartao_envios_omie`. Uma linha nesta tabela significa título
// existente no ERP — nunca "intenção de criar".
//
// AS TRÊS TRAVAS CONTRA LANÇAR DUAS VEZES, todas independentes:
//   1. o marco (`MARCO_FORA_DO_HUB`) e o estado da fatura: as faturas até ago/26
//      foram lançadas à mão e nem chegam a ser oferecidas;
//   2. `cartao_envios_omie` — o que já subiu é pulado nesta função;
//   3. `codigo_lancamento_integracao` — o próprio Omie recusa integração
//      repetida, e a recusa é lida como "já está lá", não como falha.
//
// LOTE E RELÓGIO: uma fatura real tem ~470 títulos e o Omie serializa chamadas
// do mesmo método. Não cabe numa invocação. A função trabalha até acabar o
// orçamento de tempo e devolve `restantes`; quem chamou repete até zerar.
//
// Ações (body.action):
//   "enviar"           → (padrão) cria os títulos que faltam
//   "conferir"         → só leitura: o que já subiu desta competência
//   "consultar-titulo" → só leitura: a ficha de um título no Omie, crua
//   "limpar-teste"     → apaga do Omie tudo que veio da fatura sintética

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { consultarTitulo, excluirContaPagar, incluirContaPagar } from "../_shared/omie.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  ehTeste, montarTitulo, recusaDoEnvio,
  type EstadoDaFatura, type TituloParaOmie,
} from "../_shared/cartao-envio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Orçamento de tempo de uma invocação. O resto volta em `restantes`. */
const ORCAMENTO_MS = 100_000;

/**
 * Chamador por token, para exercitar a fatura sintética sem sessão de usuário.
 *
 * Diferente do token da `omie-trocar-categoria`, este PODE escrever — mas só na
 * fatura de teste: qualquer título sem o prefixo `TESTEHUB` é recusado logo
 * abaixo. É o que permite rodar o teste ponta a ponta (e a limpeza) sem abrir
 * uma porta para a fatura de verdade.
 */
async function chamadaPorToken(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "cartao-omie-enviar").eq("token", token).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const porToken = await chamadaPorToken(req, supabase);
    let caller: Awaited<ReturnType<typeof requireUser>> | null = null;
    if (!porToken) caller = await requireUser(req, { bloquearCargos: ["parcerias"] });

    const action = String(body?.action ?? "enviar");

    /* ================= LIMPAR A FATURA DE TESTE ================= */
    if (action === "limpar-teste") return await limparTeste(supabase, caller?.userId ?? null);

    const competencia = String(body?.competencia ?? "").slice(0, 10);

    /* ================= O QUE O OMIE TEM (só leitura) =================
       Serve para conferir, contra a API de verdade, que o payload chegou como
       se pretendia — sobretudo `data_entrada`, que é a âncora da DRE e que o
       cache local só enxerga depois do próximo sync. */
    if (action === "consultar-titulo") {
      const cod = String(body?.cod_titulo ?? "").trim();
      if (!cod) return json({ status: "erro", erro: "Informe o cod_titulo." }, 200);
      return json({ status: "ok", omie: await consultarTitulo("CONTA_A_PAGAR", cod) });
    }

    /* ================= CONFERIR (só leitura) ================= */
    if (action === "conferir") {
      const { data, error } = await supabase
        .from("cartao_envios_omie").select("*")
        .eq("competencia_fatura", competencia).order("enviado_em");
      if (error) throw new Error(error.message);
      return json({ status: "ok", competencia, envios: data ?? [] });
    }

    if (action !== "enviar") return json({ status: "erro", erro: `Ação desconhecida: ${action}` }, 200);

    /* ================= ENVIAR ================= */
    const titulos = (Array.isArray(body?.titulos) ? body.titulos : []) as TituloParaOmie[];

    // O token só existe para a fatura sintética. Um único título de verdade no
    // lote derruba a chamada inteira — não sobra meio envio.
    if (porToken && !titulos.every((t) => ehTeste(t.fitid))) {
      return json({
        status: "erro",
        erro: "O token de teste só envia a fatura sintética (FITID com prefixo TESTEHUB). "
          + "Para a fatura de verdade, entre na tela com a sua conta.",
      }, 200);
    }

    const { data: fat } = await supabase
      .from("cartao_faturas").select("competencia, provisionamento")
      .eq("competencia", competencia).maybeSingle();

    // A MESMA função que desabilita o botão na tela. Duas checagens escritas
    // separadamente divergem, e a divergência permissiva duplica um mês.
    const recusa = recusaDoEnvio({
      competencia,
      estadoDaFatura: (fat?.provisionamento ?? null) as EstadoDaFatura,
      titulos,
    });
    if (recusa) return json({ status: "erro", erro: recusa }, 200);

    // O que já subiu não volta. `status='erro'` fica de fora do filtro de
    // propósito: aquele título NÃO existe no Omie e tem de ser tentado de novo.
    //
    // A pergunta é por `competencia_fatura`, e não por `competencia`: as
    // parcelas 2..N caem em meses à frente, e perguntar pelo mês da parcela
    // fazia 6 dos 17 títulos da fatura de teste parecerem nunca enviados.
    const { data: jaEnviados, error: erroLer } = await supabase
      .from("cartao_envios_omie").select("integracao")
      .eq("competencia_fatura", competencia).eq("status", "enviado");
    if (erroLer) throw new Error(`Falha ao ler o que já foi enviado: ${erroLer.message}`);
    const subiram = new Set((jaEnviados ?? []).map((r: { integracao: string }) => r.integracao));

    const fila = titulos.filter((t) => !subiram.has(t.integracao));
    const inicio = Date.now();
    const criados: { integracao: string; cod_titulo: string; ja_existia: boolean }[] = [];
    const falhas: { integracao: string; estabelecimento: string; erro: string }[] = [];
    let processados = 0;

    for (const t of fila) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      processados++;

      try {
        const r = await incluirContaPagar(montarTitulo(t));
        const { error } = await supabase.from("cartao_envios_omie").upsert({
          integracao: t.integracao,
          fitid: t.fitid,
          competencia: t.competencia,
          competencia_fatura: competencia,
          parcela_n: t.parcela?.n ?? null,
          parcela_de: t.parcela?.de ?? null,
          chave: t.chave,
          estabelecimento: t.estabelecimento,
          codigo_categoria: t.codigoCategoria,
          valor: t.valor,
          vencimento: t.vencimento,
          cod_titulo: r.codTitulo || null,
          status: "enviado",
          erro: r.jaExistia ? "integração já existia no Omie; vínculo recuperado" : null,
          enviado_em: new Date().toISOString(),
          enviado_por: caller?.userId ?? null,
        }, { onConflict: "integracao" });
        // O título JÁ EXISTE no Omie. Não dá para desfazer, então o que se pode
        // fazer é gritar: sem a linha aqui, o próximo envio o recria.
        if (error) {
          console.error(`título ${r.codTitulo} criado no Omie e NÃO registrado: ${error.message}`);
          falhas.push({
            integracao: t.integracao,
            estabelecimento: t.estabelecimento,
            erro: `Título ${r.codTitulo} foi criado no Omie mas não ficou registrado no Hub `
              + `(${error.message}). Não reenvie sem conferir.`,
          });
          continue;
        }
        criados.push({ integracao: t.integracao, cod_titulo: r.codTitulo, ja_existia: r.jaExistia });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        falhas.push({ integracao: t.integracao, estabelecimento: t.estabelecimento, erro: msg });
        await supabase.from("cartao_envios_omie").upsert({
          integracao: t.integracao,
          fitid: t.fitid,
          competencia: t.competencia,
          competencia_fatura: competencia,
          parcela_n: t.parcela?.n ?? null,
          parcela_de: t.parcela?.de ?? null,
          chave: t.chave,
          estabelecimento: t.estabelecimento,
          codigo_categoria: t.codigoCategoria,
          valor: t.valor,
          vencimento: t.vencimento,
          status: "erro",
          erro: msg.slice(0, 1000),
          enviado_em: new Date().toISOString(),
          enviado_por: caller?.userId ?? null,
        }, { onConflict: "integracao" });
      }
    }

    const restantes = fila.length - processados;

    // A fatura só fecha quando não sobrou nada e nada falhou — nesta chamada nem
    // nas anteriores (a consulta é ao estado gravado, não à memória deste lote).
    let faturaFechada = false;
    if (!restantes && !falhas.length && fat) {
      const { count } = await supabase
        .from("cartao_envios_omie").select("integracao", { count: "exact", head: true })
        .eq("competencia_fatura", competencia).eq("status", "erro");
      if (!count) {
        const { error } = await supabase
          .from("cartao_faturas").update({ provisionamento: "enviado" })
          .eq("competencia", competencia);
        faturaFechada = !error;
      }
    }

    console.log(
      `cartão → Omie · ${competencia} · ${criados.length} criado(s), ${falhas.length} falha(s), ` +
      `${restantes} restante(s)${faturaFechada ? " · fatura fechada" : ""}`,
    );

    return json({
      status: falhas.length ? "parcial" : "ok",
      competencia,
      total: titulos.length,
      ja_estavam: titulos.length - fila.length,
      criados: criados.length,
      recuperados: criados.filter((c) => c.ja_existia).length,
      falhas,
      restantes,
      fatura_fechada: faturaFechada,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("cartao-omie-enviar error:", msg);
    // Erro de negócio sai com 200 + { status: "erro" }: o `functions.invoke`
    // esconde o corpo quando o status não é 2xx, e é o texto que a pessoa
    // precisa ler. Só autenticação sai com 401.
    return json({ status: "erro", erro: msg }, /autentic|permiss/i.test(msg) ? 401 : 200);
  }
});

/* ------------------------------------------------------------------
 * A limpeza da fatura sintética
 * ------------------------------------------------------------------
 * Apaga do Omie tudo que o Hub criou a partir de um FITID `TESTEHUB…`. Sem
 * parâmetro nenhum de propósito: não existe "limpar a competência X". A única
 * coisa que este caminho consegue apagar é o que ele mesmo criou de teste.
 */
async function limparTeste(supabase: any, userId: string | null): Promise<Response> {
  const { data, error } = await supabase
    .from("cartao_envios_omie").select("integracao, cod_titulo, estabelecimento, status")
    .like("integracao", "CARTAO-TESTEHUB%");
  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as {
    integracao: string; cod_titulo: string | null; estabelecimento: string | null; status: string;
  }[];

  const apagados: string[] = [];
  const problemas: { integracao: string; erro: string }[] = [];

  for (const l of linhas) {
    if (l.status !== "enviado" || !l.cod_titulo) {
      // Nunca chegou ao Omie (ou chegou sem devolver código): só sai daqui.
      await supabase.from("cartao_envios_omie").delete().eq("integracao", l.integracao);
      continue;
    }
    try {
      await excluirContaPagar(l.cod_titulo);
      await supabase.from("cartao_envios_omie").delete().eq("integracao", l.integracao);
      apagados.push(l.cod_titulo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      problemas.push({ integracao: l.integracao, erro: msg });
      await supabase.from("cartao_envios_omie")
        .update({ status: "erro", erro: `falha ao excluir: ${msg}`.slice(0, 1000) })
        .eq("integracao", l.integracao);
    }
  }

  // A fatura de teste também não deve continuar marcada como enviada.
  await supabase.from("cartao_faturas")
    .update({ provisionamento: "pendente" })
    .eq("arquivo", "TESTE_HUB.ofx");

  console.log(`limpeza da fatura de teste · ${apagados.length} título(s) excluído(s) · por ${userId ?? "token"}`);

  return json({
    status: problemas.length ? "parcial" : "ok",
    encontrados: linhas.length,
    apagados: apagados.length,
    titulos: apagados,
    problemas,
  });
}
