// Edge Function: asaas-omie-extrato
//
// Leva o extrato do Asaas para dentro do Omie, como lançamento de conta
// corrente na conta "ASAAS Disponível" (nCodCC 5460455582) — a conta que existe
// no ERP e nunca teve um lançamento sequer.
//
// A regra de agrupamento e a escolha das categorias moram em
// `_shared/extrato-omie.ts`, com teste. Aqui fica só a conversa com o Omie.
//
// Ações (body.action):
//   "sondar"  → NÃO escreve. Lê `ListarLancCC` de uma conta para descobrir a
//               forma real do lançamento — principalmente se `nValorLanc` é
//               ASSINADO (negativo = saída) ou se a natureza vem noutro campo.
//               A documentação do Omie não diz, e chutar isso inverteria o
//               saldo inteiro da conta.
//   "preview" → NÃO escreve. Monta o que seria lançado no período e confere o
//               líquido contra o extrato, dia a dia.
//   "enviar"  → grava no Omie, em lote, com teto e relógio.
//
// Params: { de?: "YYYY-MM-DD", ate?: "YYYY-MM-DD", teto?: number, seco?: true,
//           ncodcc?: string }
//
// Auth: usuário logado (botão na tela) OU cron (header x-cron-token).

// Versão fixa: `@2` solto resolve a última do dia e já quebrou o deploy.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
// De `omie-rpc.ts` e não de `omie.ts`: aquele arrasta pdf-lib e fflate por causa
// do anexo, e aqui não se anexa nada.
import { omieCall } from "../_shared/omie-rpc.ts";
import {
  agruparPorDia,
  contrapartidasNoPago,
  dataOmie,
  liquidoDe,
  NCODCC_ASAAS_DISPONIVEL,
  NCODCC_ASAAS_PAGO,
  ROTULO,
  type LancamentoDiario,
  type LinhaExtrato,
} from "../_shared/extrato-omie.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* O worker morre por volta dos 150s sem exceção que dê para pegar: o processo é
   derrubado, a resposta nunca sai e o cliente vê 546 — com tudo que já foi
   lançado no Omie e NÃO gravado aqui. Numa função que escreve no ERP isso é o
   pior desfecho possível, porque a próxima rodada tentaria lançar de novo. Daí
   o relógio ser curto e a gravação ser POR LANÇAMENTO, nunca no fim. */
const LIMITE_WORKER_MS = 110_000;
const TETO_PADRAO = 40;
const PAGINA = 1000;   // o PostgREST corta em 1000 por resposta, calado

/* SÓ DIA FECHADO VAI PARA O ERP.
 *
 * O lançamento é o LÍQUIDO do dia, e um dia que ainda pode crescer produziria
 * um lançamento incompleto — que nenhuma rodada seguinte conserta, porque a
 * chave `ASAAS-<dia>-<sigla>` já existe e o Omie recusa a repetida. Consertar
 * seria `AlterarLancCC`, que é decisão de gente, não de cron.
 *
 * Dois dias, e não um, porque o `asaas-extrato-sync` reprocessa os últimos 3
 * dias de propósito (OVERLAP_DIAS) para pegar o que o Asaas lança atrasado.
 * Esperar a sobreposição passar é o que transforma "quase sempre certo" em
 * "certo". O preview mostra os dias em carência para ninguém achar que sumiram.
 */
const CARENCIA_DIAS = 2;

const hojeBRT = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

// deno-lint-ignore no-explicit-any
async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name")
    .eq("name", "asaas-omie-extrato").eq("token", token).maybeSingle();
  return !!data;
}

/**
 * Lê o extrato do período em páginas. `.limit(2000)` devolveria 1000 linhas
 * caladas — com ~280 lançamentos/dia, o Asaas estoura isso em três dias e a
 * conta sairia errada para menos, que é o jeito de errar que ninguém percebe.
 */
// deno-lint-ignore no-explicit-any
async function lerExtrato(supabase: any, de: string, ate: string): Promise<LinhaExtrato[]> {
  const out: LinhaExtrato[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("asaas_extrato")
      .select("id_transacao,data_movimento,tipo,valor,historico")
      .gte("data_movimento", de).lte("data_movimento", ate)
      // Desempate estável: sem ele a paginação pode repetir ou pular linha.
      .order("data_movimento", { ascending: true }).order("id_transacao", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    const linhas = (data ?? []) as LinhaExtrato[];
    out.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return out;
}

/** O tipo de documento do Omie. Resumo diário não tem documento: é "Outros". */
const tipoDoc = (l: LancamentoDiario) => (l.natureza === "transferencia" ? "TRA" : "99999");

/**
 * Monta o request do IncluirLancCC.
 *
 * `nValorLanc` vai SEMPRE POSITIVO — sondado contra lançamentos reais do Omie
 * em 10/09/2026, entrada e saída chegam as duas com valor positivo, e quem diz
 * a direção é a CATEGORIA (`conta_receita` × `conta_despesa`). O `cNatureza`
 * que aparece na resposta é derivado dela. Ver `categoriaDe` em
 * `_shared/extrato-omie.ts`: é lá que a direção é decidida, com teste.
 */
function requisicao(l: LancamentoDiario, ncodcc: string) {
  return {
    cCodIntLanc: l.cod_int_lanc,
    cabecalho: {
      // A conta é do LANÇAMENTO quando ele traz uma: a contrapartida do
      // faturado mora na "ASAAS Pago", não na conta do extrato.
      nCodCC: Number(l.ncodcc ?? ncodcc),
      dDtLanc: dataOmie(l.dia),
      nValorLanc: Math.abs(l.valor),
    },
    detalhes: {
      cCodCateg: l.categoria,
      cTipo: tipoDoc(l),
      cObs: l.observacao,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const inicio = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (!(await chamadaDeCron(req, supabase))) await requireUser(req, { bloquearCargos: ["parcerias"] });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "preview");
    const ncodcc = String(body?.ncodcc ?? NCODCC_ASAAS_DISPONIVEL);

    /* ---------------- SONDAR: a forma real do lançamento ----------------
     * `ListarLancCC` NÃO filtra por conta corrente (o `lanccListarRequest` não
     * tem `nCodCC` — ele responde "Tag [NCODCC] não faz parte da estrutura").
     * Filtra por PERÍODO (`dtPagInicial`/`dtPagFinal`) e por origem; a conta se
     * peneira na memória. `param` cru é aceito para não precisar de um deploy a
     * cada hipótese enquanto a convenção de sinal não estiver provada. */
    if (action === "sondar") {
      /* Lista fechada, e não `body.metodo` solto: o recurso
         `contacorrentelancamentos` também expõe `ExcluirLancCC` e
         `AlterarLancCC`, e a sondagem é aberta a qualquer pessoa logada que não
         seja "parcerias". Sondar é olhar; apagar lançamento do ERP não pode
         entrar de carona num parâmetro. */
      const SONDAVEIS = new Set(["ListarLancCC", "ConsultaLancCC"]);
      const metodo = String(body?.metodo ?? "ListarLancCC");
      if (!SONDAVEIS.has(metodo)) {
        return json({ error: `Sondagem só lê: ${[...SONDAVEIS].join(", ")}.` }, 200);
      }
      const param = (body?.param as Record<string, unknown>) ?? {
        nPagina: 1,
        nRegPorPagina: 50,
        dtPagInicial: dataOmie(String(body?.de ?? "2026-09-01")),
        dtPagFinal: dataOmie(String(body?.ate ?? hojeBRT())),
      };
      const r = await omieCall<Record<string, unknown>>(
        "financas/contacorrentelancamentos", metodo, param,
      );
      // `ConsultaLancCC` devolve UM lançamento, não uma lista — nesse caso o que
      // interessa é a resposta crua, com `diversos.cNatureza` à vista.
      if (metodo !== "ListarLancCC") return json({ ok: true, sondagem: true, metodo, param, resposta: r });
      const lista = (r?.listaLancamentos ?? r?.lancamentos ?? []) as Record<string, unknown>[];
      const contasPedidas: string[] = Array.isArray(body?.contas) ? body.contas.map(String) : [];
      const daConta = contasPedidas.length
        ? lista.filter((x) => contasPedidas.includes(String(
            (x?.cabecalho as Record<string, unknown>)?.nCodCC ?? (x as Record<string, unknown>)?.nCodCC ?? "")))
        : lista;

      // Conta quantos vieram por conta corrente — dá o mapa sem precisar ler tudo.
      const porConta: Record<string, number> = {};
      for (const x of lista) {
        const cc = String((x?.cabecalho as Record<string, unknown>)?.nCodCC ?? (x as Record<string, unknown>)?.nCodCC ?? "?");
        porConta[cc] = (porConta[cc] ?? 0) + 1;
      }

      return json({
        ok: true, sondagem: true, param,
        chaves_da_resposta: Object.keys(r ?? {}),
        total_de_registros: r?.nTotRegistros ?? r?.nTotRegistos ?? null,
        total_de_paginas: r?.nTotPaginas ?? null,
        recebidos: lista.length,
        por_conta: porConta,
        amostra: daConta.slice(0, 4),
      });
    }

    /* ---------------- ABERTURA: ancorar o saldo da conta ----------------
     * Os lançamentos explicam o MOVIMENTO; o saldo só fecha se a conta tiver a
     * posição de onde ela partiu. O espelho do extrato começa num dia qualquer
     * (01/04/2026 hoje), e antes dele o Omie não tem nada — com saldo inicial
     * zero a conta fecha certa no movimento e errada no saldo, para sempre.
     *
     * A abertura NÃO é digitada: é DEDUZIDA de duas coisas que não dependem uma
     * da outra — o saldo de agora, lido ao vivo do Asaas, menos o líquido de
     * todo o espelho. Se as duas pontas estiverem certas, a conta fecha; se o
     * espelho tiver buraco, o número sai estranho e denuncia o buraco. Por isso
     * é recalculável: estendendo o espelho para trás, roda de novo e reancora.
     */
    if (action === "abertura") {
      /* O SALDO TEM DE SER O DO SNAPSHOT, NUNCA O AO VIVO.
       *
       * A conta só fecha se as duas pontas forem medidas no MESMO instante, e o
       * `asaas-extrato-sync` grava as duas juntas: ele traz o extrato até agora e
       * grava o saldo daquele momento em `asaas_saldo`. Ler `/finance/balance`
       * aqui mede o saldo de AGORA contra um espelho que parou no último sync —
       * e a diferença é dinheiro que entrou no meio, que vira abertura falsa.
       *
       * Medido em 10/09/2026: snapshot das 07:46 dava R$ 86.380,56 e abertura de
       * R$ 5.251,57 (o valor certo, que o Omie já tinha no cadastro); o saldo ao
       * vivo, R$ 90.581,39, dava R$ 9.452,40. Os R$ 4.200,83 de diferença eram a
       * manhã de hoje, que o espelho ainda não conhecia. */
      const { data: snap, error: eSnap } = await supabase
        .from("asaas_saldo").select("saldo, atualizado_em")
        .order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
      if (eSnap) throw eSnap;
      const saldoAgora = Number(snap?.saldo ?? NaN);
      if (!isFinite(saldoAgora)) throw new Error("Sem snapshot de saldo do Asaas — rode o asaas-extrato-sync antes.");
      const saldoLidoEm = String(snap?.atualizado_em ?? "");

      const { data: agg, error: eAgg } = await supabase.rpc("asaas_extrato_liquido_total");
      if (eAgg) throw eAgg;
      const liquido = Number((agg as Record<string, unknown>[])?.[0]?.liquido ?? 0);
      const primeiro = String((agg as Record<string, unknown>[])?.[0]?.primeiro_dia ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiro)) throw new Error("Espelho vazio: não há de onde deduzir a abertura.");

      const abertura = Math.round((saldoAgora - liquido) * 100) / 100;
      // A posição é do dia ANTERIOR ao primeiro do espelho: no dia 1 os
      // movimentos ainda vão acontecer, e datar nele contaria o dia duas vezes.
      const vespera = new Date(new Date(primeiro + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);

      const cadastro = await omieCall<Record<string, unknown>>(
        "geral/contacorrente", "ConsultarContaCorrente", { nCodCC: Number(ncodcc) },
      );
      const atual = {
        saldo_inicial: cadastro?.saldo_inicial ?? null,
        saldo_data: cadastro?.saldo_data ?? null,
        descricao: cadastro?.descricao ?? cadastro?.nome ?? null,
      };
      const proposto = { saldo_inicial: abertura, saldo_data: dataOmie(vespera) };

      /* Se o ERP já tem a mesma posição, não há o que alterar — e o fato de dois
         caminhos independentes chegarem ao mesmo número (o que alguém cadastrou
         no Omie e o que sai de 46 mil transações do Asaas) é a melhor prova de
         que o espelho está inteiro. Vale mais dito do que escondido num no-op. */
      const jaAncorado = Math.abs(Number(atual.saldo_inicial ?? NaN) - abertura) < 0.005
        && String(atual.saldo_data ?? "") === dataOmie(vespera);

      if (jaAncorado || body?.aplicar !== true) {
        return json({
          ok: true, preview: !jaAncorado, ja_ancorado: jaAncorado, conta: ncodcc,
          saldo_do_snapshot: saldoAgora, saldo_lido_em: saldoLidoEm,
          liquido_do_espelho: liquido,
          espelho_comeca_em: primeiro, posicao_em: vespera,
          atual, proposto,
          confere: jaAncorado
            ? "O saldo inicial já cadastrado no Omie bate ao centavo com o deduzido do extrato."
            : null,
        });
      }

      /* `AlterarContaCorrente` é da família que exige o registro INTEIRO — mandar
         só os dois campos apaga o resto do cadastro. Por isso o payload sai do
         que o Consultar devolveu, com os dois campos trocados por cima. */
      const r = await omieCall<Record<string, unknown>>(
        "geral/contacorrente", "AlterarContaCorrente",
        { ...cadastro, saldo_inicial: abertura, saldo_data: dataOmie(vespera) },
      );
      return json({ ok: true, conta: ncodcc, antes: atual, depois: proposto, resposta: r });
    }

    /* ---------------- o que o extrato manda lançar ---------------- */
    const ate = String(body?.ate ?? hojeBRT()).slice(0, 10);
    let de = body?.de ? String(body.de).slice(0, 10) : null;
    if (!de) {
      const { data: pri } = await supabase
        .from("asaas_extrato").select("data_movimento")
        .not("data_movimento", "is", null)
        .order("data_movimento", { ascending: true }).limit(1).maybeSingle();
      de = (pri?.data_movimento as string) ?? ate;
    }

    const linhas = await lerExtrato(supabase, de!, ate);
    const agrupados = agruparPorDia(linhas);

    /* A carência (ver CARENCIA_DIAS): só dia fechado e fora da sobreposição do
       sync vai ao ERP. `carencia: 0` força — serve para fechar um mês a pedido,
       depois que ninguém mais espera lançamento atrasado nele. */
    const carencia = Math.max(0, Number(body?.carencia ?? CARENCIA_DIAS));
    const limite = new Date(new Date(hojeBRT() + "T00:00:00Z").getTime() - carencia * 86400000)
      .toISOString().slice(0, 10);
    const doExtrato = agrupados.filter((l) => l.dia < limite);
    const emCarencia = agrupados.filter((l) => l.dia >= limite);

    /* QUAL PERNA. O extrato é a "ASAAS Disponível"; a contrapartida é a saída do
       faturado na "ASAAS Pago" (ver `contrapartidasNoPago`). São listas
       separadas e não uma transferência nativa do Omie de propósito: aquela
       criaria as DUAS pernas, e a da Disponível já existe desde a carga. */
    const perna = String(body?.perna ?? "extrato");
    const contrapartidas = contrapartidasNoPago(doExtrato);
    const todos = perna === "pago"
      ? contrapartidas
      : perna === "ambas"
        ? [...doExtrato, ...contrapartidas]
        : doExtrato;

    // O que já foi para o Omie — a trava barata, antes de gastar a chamada.
    const { data: jaRegistrados, error: eReg } = await supabase
      .from("asaas_omie_lancamento")
      .select("cod_int_lanc,status,valor,n_cod_lanc")
      .gte("dia", de!).lte("dia", ate);
    if (eReg) throw eReg;

    const registrado = new Map<string, Record<string, unknown>>();
    for (const r of (jaRegistrados ?? []) as Record<string, unknown>[]) {
      registrado.set(String(r.cod_int_lanc), r);
    }

    /* Um dia que se corrigiu DEPOIS de enviado (o Asaas lança atrasado, e o sync
       reprocessa 3 dias) fica com valor diferente do que foi ao ERP. Isso não é
       reenvio — é conserto, e conserto no Omie é `AlterarLancCC`, que exige
       decisão. Aqui ele é só REPORTADO, para ninguém descobrir pelo saldo. */
    const pendentes: LancamentoDiario[] = [];
    const divergentes: { cod_int_lanc: string; enviado: number; extrato_agora: number }[] = [];
    for (const l of todos) {
      const r = registrado.get(l.cod_int_lanc);
      if (!r) { pendentes.push(l); continue; }
      if (String(r.status) === "enviado") {
        if (Math.abs(Number(r.valor ?? 0) - l.valor) >= 0.005) {
          divergentes.push({ cod_int_lanc: l.cod_int_lanc, enviado: Number(r.valor ?? 0), extrato_agora: l.valor });
        }
        continue;
      }
      pendentes.push(l);   // 'pendente' ou 'erro': tenta de novo
    }

    const porNatureza: Record<string, { qtd: number; valor: number; linhas: number }> = {};
    for (const l of todos) {
      const b = porNatureza[ROTULO[l.natureza]] ?? { qtd: 0, valor: 0, linhas: 0 };
      b.qtd++; b.valor = Math.round((b.valor + l.valor) * 100) / 100; b.linhas += l.lancamentos;
      porNatureza[ROTULO[l.natureza]] = b;
    }

    const resumo = {
      periodo: { de, ate },
      perna,
      conta: perna === "pago" ? NCODCC_ASAAS_PAGO : ncodcc,
      linhas_do_extrato: linhas.length,
      lancamentos_no_omie: todos.length,
      ja_enviados: todos.length - pendentes.length,
      a_enviar: pendentes.length,
      liquido_do_periodo: liquidoDe(todos),
      por_natureza: porNatureza,
      divergentes,
      /* Não é erro, é espera: o dia ainda pode crescer. Vai no relatório para
         ninguém somar o que está na tela e achar que falta lançamento. */
      em_carencia: {
        desde: limite,
        dias: carencia,
        lancamentos: emCarencia.length,
        liquido: liquidoDe(emCarencia),
      },
    };

    if (action !== "enviar" || body?.seco === true) {
      return json({
        ok: true, preview: true, ...resumo,
        amostra: pendentes.slice(0, 12),
      });
    }

    /* ---------------- ENVIAR ---------------- */
    const teto = Math.max(1, Math.min(Number(body?.teto ?? TETO_PADRAO), 200));
    const fila = pendentes.slice(0, teto);
    const enviados: Record<string, unknown>[] = [];
    const erros: Record<string, unknown>[] = [];
    let pararPorRelogio = false;

    for (const l of fila) {
      if (Date.now() - inicio > LIMITE_WORKER_MS) { pararPorRelogio = true; break; }

      /* Grava ANTES de chamar o Omie. Se o worker morrer no meio da chamada, a
         linha fica 'pendente' e a próxima rodada tenta de novo — e aí quem
         segura a duplicidade é o `cCodIntLanc`, que o Omie recusa repetido. O
         contrário (gravar depois) perderia o registro de um lançamento que já
         existe no ERP, e ninguém saberia que existe. */
      const { error: eIns } = await supabase.from("asaas_omie_lancamento").upsert({
        cod_int_lanc: l.cod_int_lanc,
        dia: l.dia,
        natureza: l.natureza,
        categoria: l.categoria,
        valor: l.valor,
        entradas: l.entradas,
        saidas: l.saidas,
        lancamentos: l.lancamentos,
        ncodcc: l.ncodcc ?? ncodcc,
        status: "pendente",
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "cod_int_lanc" });
      if (eIns) throw eIns;

      try {
        const r = await omieCall<Record<string, unknown>>(
          "financas/contacorrentelancamentos", "IncluirLancCC", requisicao(l, ncodcc),
        );
        const nCodLanc = r?.nCodLanc ?? r?.codigo_lancamento ?? null;
        await supabase.from("asaas_omie_lancamento").update({
          status: "enviado",
          n_cod_lanc: nCodLanc === null ? null : String(nCodLanc),
          erro: null,
          enviado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        }).eq("cod_int_lanc", l.cod_int_lanc);
        enviados.push({ cod_int_lanc: l.cod_int_lanc, dia: l.dia, valor: l.valor, n_cod_lanc: nCodLanc });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("asaas_omie_lancamento").update({
          status: "erro",
          erro: msg.slice(0, 500),
          tentativas: (await contarTentativas(supabase, l.cod_int_lanc)) + 1,
          atualizado_em: new Date().toISOString(),
        }).eq("cod_int_lanc", l.cod_int_lanc);
        erros.push({ cod_int_lanc: l.cod_int_lanc, dia: l.dia, erro: msg.slice(0, 300) });

        /* Erro de ESTRUTURA (categoria inválida, campo faltando, conta errada)
           vale para todos os lançamentos da fila — insistir só gastaria as 40
           chamadas para colecionar o mesmo erro. Erro de rede ou trava de
           método é da vez, e a próxima linha tenta. */
        if (/n(ã|a)o faz parte da estrutura|inv(á|a)lid|n(ã|a)o encontrad|obrigat(ó|o)ri/i.test(msg)) break;
      }
    }

    return json({
      ok: true,
      ...resumo,
      enviados_agora: enviados.length,
      com_erro: erros.length,
      parou_pelo_relogio: pararPorRelogio,
      restam: pendentes.length - enviados.length,
      enviados,
      erros,
      trigger: body?.trigger ?? "manual",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("asaas-omie-extrato error:", msg);
    return json({ error: msg }, 200);
  }
});

// deno-lint-ignore no-explicit-any
async function contarTentativas(supabase: any, cod: string): Promise<number> {
  const { data } = await supabase
    .from("asaas_omie_lancamento").select("tentativas").eq("cod_int_lanc", cod).maybeSingle();
  return Number(data?.tentativas ?? 0);
}
