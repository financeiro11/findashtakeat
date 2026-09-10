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
  linhasParaOmie,
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
/* 100s, e quem manda neste número NÃO é o gateway — é o intervalo do cron.
 *
 * O teto duro do gateway são 150s até a primeira resposta, e caberia bem mais.
 * Mas a virada roda de 2 em 2 minutos, e o Omie **não aceita duas inclusões
 * simultâneas**: se uma rodada passar dos 120s, a seguinte entra com a anterior
 * ainda escrevendo, as duas se recusam por trava de método, e erro repetido é
 * exatamente o que constrói o bloqueio de 30 minutos.
 *
 * 100s garante que a rodada acaba com ~20s de folga antes da próxima, mesmo no
 * ritmo mais lento já medido (2,07/s, que dá 207 linhas em 100s). No ritmo
 * normal (2,43/s) as 250 linhas do teto levam 103s e a guarda nem chega a agir —
 * quando age, o resto vai na rodada seguinte. Nunca há trabalho perdido.
 *
 * Mexer no intervalo do cron obriga a mexer aqui junto. */
const LIMITE_WORKER_MS = 100_000;
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

/* Teto de linhas por invocação na virada linha a linha. Medido em rodada real
   depois de tirar as idas ao Postgres do caminho crítico: 250 linhas em 102,8s,
   ou 2,43/s. A cada 2 minutos dá 7.500 linhas por hora — e 125 requisições por
   minuto, ~52% do teto de 240/min do Omie. A folga que sobra é para a máquina
   de NFS-e, que roda das 13h às 22h UTC a ~6/min; os syncs pesados (contas a
   pagar, caixa) ficam fora da janela do cron de propósito. */
const TETO_LINHAS = 250;

/** Quantas vezes um mesmo lançamento pode falhar antes de sair da fila. */
const TETO_TENTATIVAS = 5;

/* De quantos em quantos resultados o lote volta ao Postgres. Se o worker morrer,
   até este tanto de linhas fica 'pendente' tendo entrado no Omie — e a rodada
   seguinte se cura pelo `cCodIntLanc` repetido. */
const FLUSH_RESULTADOS = 25;

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
      /* Sonda de LEITURA do `financas/mf`, separada e nominal — a pergunta que ela
         responde decide se dá para espelhar o Asaas linha a linha: se
         `ListarMovimentos` aceitar `nCodCC` ou recorte de data, os consumidores
         do cache conseguem parar de baixar o ERP inteiro. */
      if (body?.movimentos === true) {
        const p = (body?.param as Record<string, unknown>) ?? { nPagina: 1, nRegPorPagina: 5 };
        const m = await omieCall<Record<string, unknown>>("financas/mf", "ListarMovimentos", p);
        const lista = (m?.movimentos ?? []) as Record<string, unknown>[];
        const contas: Record<string, number> = {};
        for (const x of lista) {
          const cc = String((x?.detalhes as Record<string, unknown>)?.nCodCC ?? "?");
          contas[cc] = (contas[cc] ?? 0) + 1;
        }
        return json({
          ok: true, sondagem: "movimentos", param: p,
          nTotRegistros: m?.nTotRegistros ?? null,
          nTotPaginas: m?.nTotPaginas ?? null,
          nRegistros: m?.nRegistros ?? null,
          contas_na_amostra: contas,
        });
      }

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

    /* ---------------- VIRAR: do resumo diário para linha a linha ----------
     * A contabilidade exige espelho linha a linha. A virada é DIA A DIA: entram
     * todas as linhas do dia e só então saem os lançamentos-resumo daquele mesmo
     * dia. Carregar tudo antes de apagar deixaria a conta dobrada pelas ~26h do
     * backfill; apagar antes de carregar a deixaria zerada. Assim o pior estado
     * possível é UM dia dobrado, e ele se resolve na rodada seguinte.
     */
    if (action === "virar") {
      const teto = Math.max(1, Math.min(Number(body?.teto ?? TETO_LINHAS), 400));
      const carenciaV = Math.max(0, Number(body?.carencia ?? CARENCIA_DIAS));
      const limiteV = new Date(new Date(hojeBRT() + "T00:00:00Z").getTime() - carenciaV * 86400000)
        .toISOString().slice(0, 10);

      const { data: diasRaw, error: eDias } = await supabase.rpc("asaas_omie_virada", { p_limite: 400 });
      if (eDias) throw eDias;
      const dias = (diasRaw ?? []) as Record<string, unknown>[];
      const aFazer = dias.filter((d) => d.virado !== true && String(d.dia) < limiteV);

      let enviadas = 0, removidos = 0, errosV = 0, consecutivos = 0;
      const relatorio: Record<string, unknown>[] = [];
      let pararRelogio = false;

      for (const d of aFazer) {
        if (Date.now() - inicio > LIMITE_WORKER_MS) { pararRelogio = true; break; }
        if (enviadas >= teto) break;
        const dia = String(d.dia);

        /* 1) As linhas que faltam desse dia. */
        if (Number(d.linhas_faltando ?? 0) > 0) {
          const linhasDoDia = await lerExtrato(supabase, dia, dia);
          const candidatas = linhasParaOmie(linhasDoDia);

          const { data: jaRaw } = await supabase
            .from("asaas_omie_lancamento").select("cod_int_lanc,status")
            .eq("modo", "linha").eq("dia", dia);
          const ja = new Map<string, string>();
          for (const r of (jaRaw ?? []) as Record<string, unknown>[]) {
            ja.set(String(r.cod_int_lanc), String(r.status));
          }

          /* AS IDAS AO POSTGRES SAEM DO CAMINHO CRÍTICO.
           *
           * Antes era, por linha: um upsert 'pendente', a chamada ao Omie, e um
           * update com o resultado. Duas idas ao banco por lançamento, dentro de
           * um laço de dezenas de milhares — medido em 0,483s por linha, das
           * quais ~0,1s eram só round-trip de banco.
           *
           * Agora o lote inteiro é marcado 'pendente' de uma vez, ANTES de
           * qualquer chamada ao ERP — o que preserva o invariante que importa:
           * nada é escrito no Omie sem que já exista registro aqui de que ia ser.
           * Os resultados voltam em blocos de FLUSH_RESULTADOS.
           *
           * Se o worker morrer no meio, até FLUSH_RESULTADOS linhas ficam
           * 'pendente' tendo entrado no Omie. A rodada seguinte tenta de novo, o
           * Omie recusa por `cCodIntLanc` repetido, e o caminho de autocura marca
           * 'enviado'. Esse caminho já foi exercitado contra a produção. */
          const fila = candidatas.filter((l) => ja.get(l.id_transacao) !== "enviado")
            .slice(0, Math.max(0, teto - enviadas));

          if (fila.length) {
            const agora = new Date().toISOString();
            const { error: ePre } = await supabase.from("asaas_omie_lancamento").upsert(
              fila.map((l) => ({
                cod_int_lanc: l.id_transacao, dia: l.dia, natureza: l.natureza,
                categoria: l.categoria, valor: l.valor,
                entradas: l.valor > 0 ? l.valor : 0, saidas: l.valor < 0 ? -l.valor : 0,
                lancamentos: 1, ncodcc: NCODCC_ASAAS_DISPONIVEL, modo: "linha",
                status: "pendente", atualizado_em: agora,
              })),
              { onConflict: "cod_int_lanc" },
            );
            if (ePre) throw ePre;
          }

          let porGravar: Record<string, unknown>[] = [];
          const descarregar = async () => {
            if (!porGravar.length) return;
            const { error } = await supabase.from("asaas_omie_lancamento")
              .upsert(porGravar, { onConflict: "cod_int_lanc" });
            if (error) throw error;
            porGravar = [];
          };

          for (const l of fila) {
            if (enviadas >= teto) break;
            if (Date.now() - inicio > LIMITE_WORKER_MS) { pararRelogio = true; break; }

            try {
              const r = await omieCall<Record<string, unknown>>(
                "financas/contacorrentelancamentos", "IncluirLancCC",
                {
                  cCodIntLanc: l.id_transacao,
                  cabecalho: { nCodCC: Number(NCODCC_ASAAS_DISPONIVEL), dDtLanc: dataOmie(l.dia), nValorLanc: Math.abs(l.valor) },
                  detalhes: { cCodCateg: l.categoria, cTipo: "99999", cObs: l.observacao },
                },
              );
              porGravar.push({
                cod_int_lanc: l.id_transacao, dia: l.dia, natureza: l.natureza,
                categoria: l.categoria, valor: l.valor,
                entradas: l.valor > 0 ? l.valor : 0, saidas: l.valor < 0 ? -l.valor : 0,
                lancamentos: 1, ncodcc: NCODCC_ASAAS_DISPONIVEL, modo: "linha",
                status: "enviado", n_cod_lanc: String(r?.nCodLanc ?? ""), erro: null, tentativas: 0,
                enviado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
              });
              enviadas++; consecutivos = 0;
              if (porGravar.length >= FLUSH_RESULTADOS) await descarregar();
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              const repetido = /j(á|a) (existe|cadastrad)|duplicad/i.test(msg);
              porGravar.push({
                cod_int_lanc: l.id_transacao, dia: l.dia, natureza: l.natureza,
                categoria: l.categoria, valor: l.valor,
                entradas: l.valor > 0 ? l.valor : 0, saidas: l.valor < 0 ? -l.valor : 0,
                lancamentos: 1, ncodcc: NCODCC_ASAAS_DISPONIVEL, modo: "linha",
                status: repetido ? "enviado" : "erro",
                erro: msg.slice(0, 400),
                enviado_em: repetido ? new Date().toISOString() : null,
                atualizado_em: new Date().toISOString(),
              });
              if (repetido) { enviadas++; consecutivos = 0; continue; }
              /* Erro de verdade grava NA HORA: o disjuntor pode parar tudo na
                 linha seguinte, e o rastro não pode ficar preso no buffer. */
              await descarregar();
              errosV++; consecutivos++;
              /* DISJUNTOR. O Omie bloqueia por 30 MINUTOS na 10ª requisição com
                 erro para a mesma combinação App+IP+Método. Três erros seguidos
                 já dizem que o problema não é da linha — é da categoria, da
                 conta ou do próprio Omie —, e insistir só constrói o bloqueio. */
              if (consecutivos >= 3) { pararRelogio = true; break; }
            }
          }
          await descarregar();
        }

        /* 2) Só depois que TODAS as linhas do dia entraram, os diários saem. */
        const { count: faltam } = await supabase
          .from("asaas_omie_lancamento").select("cod_int_lanc", { count: "exact", head: true })
          .eq("modo", "linha").eq("dia", dia).neq("status", "enviado");
        const { data: linhasDia } = await supabase
          .from("asaas_extrato").select("id_transacao").eq("data_movimento", dia).limit(1);
        const temExtrato = (linhasDia ?? []).length > 0;

        const { data: enviadasDia, count: nEnviadas } = await supabase
          .from("asaas_omie_lancamento").select("cod_int_lanc", { count: "exact" })
          .eq("modo", "linha").eq("dia", dia).eq("status", "enviado").limit(1);
        void enviadasDia;

        const { count: totalExtrato } = await supabase
          .from("asaas_extrato").select("id_transacao", { count: "exact", head: true })
          .eq("data_movimento", dia);

        const completo = temExtrato && (faltam ?? 0) === 0 && (nEnviadas ?? 0) >= (totalExtrato ?? 0);
        if (!completo) { relatorio.push({ dia, estado: "linhas incompletas", enviadas_ate_agora: nEnviadas ?? 0, no_extrato: totalExtrato ?? 0 }); continue; }

        const { data: diarios } = await supabase
          .from("asaas_omie_lancamento").select("cod_int_lanc,n_cod_lanc")
          .eq("modo", "diario").eq("dia", dia).eq("status", "enviado").eq("ncodcc", NCODCC_ASAAS_DISPONIVEL);

        for (const x of (diarios ?? []) as Record<string, unknown>[]) {
          if (Date.now() - inicio > LIMITE_WORKER_MS) { pararRelogio = true; break; }
          try {
            await omieCall("financas/contacorrentelancamentos", "ExcluirLancCC", {
              cCodIntLanc: String(x.cod_int_lanc),
            });
            await supabase.from("asaas_omie_lancamento").update({
              status: "removido", erro: "Substituído pelo espelho linha a linha.",
              atualizado_em: new Date().toISOString(),
            }).eq("cod_int_lanc", String(x.cod_int_lanc));
            removidos++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            /* Já não existe no ERP: o objetivo era esse. Marcar removido. */
            if (/n(ã|a)o (foi )?(encontrad|localizad)|inexistente/i.test(msg)) {
              await supabase.from("asaas_omie_lancamento").update({
                status: "removido", erro: `Não estava mais no Omie. ${msg.slice(0, 200)}`,
                atualizado_em: new Date().toISOString(),
              }).eq("cod_int_lanc", String(x.cod_int_lanc));
              removidos++;
              continue;
            }
            errosV++; consecutivos++;
            if (consecutivos >= 3) { pararRelogio = true; break; }
          }
        }
        relatorio.push({ dia, estado: "virado", diarios_removidos: (diarios ?? []).length });
        if (pararRelogio) break;
      }

      return json({
        ok: true, acao: "virar",
        dias_pendentes: aFazer.length,
        linhas_enviadas: enviadas,
        diarios_removidos: removidos,
        erros: errosV,
        parou: pararRelogio ? (consecutivos >= 3 ? "3 erros seguidos (disjuntor)" : "relógio") : null,
        carencia_desde: limiteV,
        dias: relatorio.slice(0, 20),
      });
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
      .select("cod_int_lanc,status,valor,n_cod_lanc,tentativas")
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
    /* Lançamento que falhou TETO_TENTATIVAS vezes sai da fila. Sem isso ele volta
       todo dia, para sempre, e o relatório do cron passa a ter um erro fixo — que
       em pouco tempo vira ruído que ninguém lê, escondendo o erro do dia. Sair da
       fila NÃO é desistir: ele aparece em `desistidos`, e some sozinho quando a
       causa for corrigida, porque `tentativas` é zerado a cada envio bem-sucedido. */
    const desistidos: { cod_int_lanc: string; dia: string; tentativas: number }[] = [];
    for (const l of todos) {
      const r = registrado.get(l.cod_int_lanc);
      if (!r) { pendentes.push(l); continue; }
      if (String(r.status) === "enviado") {
        if (Math.abs(Number(r.valor ?? 0) - l.valor) >= 0.005) {
          divergentes.push({ cod_int_lanc: l.cod_int_lanc, enviado: Number(r.valor ?? 0), extrato_agora: l.valor });
        }
        continue;
      }
      const tentativas = Number(r.tentativas ?? 0);
      if (tentativas >= TETO_TENTATIVAS) {
        desistidos.push({ cod_int_lanc: l.cod_int_lanc, dia: l.dia, tentativas });
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
      desistidos,
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
          // Zera o orçamento de tentativas: o próximo tropeço nesta linha começa
          // do zero, e o teto não vira uma sentença permanente.
          tentativas: 0,
          enviado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        }).eq("cod_int_lanc", l.cod_int_lanc);
        enviados.push({ cod_int_lanc: l.cod_int_lanc, dia: l.dia, valor: l.valor, n_cod_lanc: nCodLanc });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);

        /* "JÁ CADASTRADO" NÃO É FALHA, É A TRAVA FUNCIONANDO.
         *
         * O caminho: gravamos 'pendente', o Omie criou o lançamento, e a resposta
         * se perdeu (worker morto no relógio, rede caindo). Na rodada seguinte o
         * `cCodIntLanc` é recusado por repetido — e o lançamento ESTÁ no ERP.
         * Marcar 'erro' aqui deixaria a linha voltando para a fila todo dia, para
         * sempre, colecionando o mesmo erro e escondendo os erros de verdade no
         * meio. Fica 'enviado', sem `n_cod_lanc`, com o rastro na observação.
         *
         * A mensagem exata do Omie, exercitada contra a produção em 10/09/2026:
         *   "Lançamento de Conta Corrente já cadastrado para o Código de
         *    Integração [ASAAS-20260901-EST] !" */
        if (/j(á|a) (existe|cadastrad)|duplicad|c(ó|o)digo de integra(ç|c)(ã|a)o.*(existe|utilizado)/i.test(msg)) {
          await supabase.from("asaas_omie_lancamento").update({
            status: "enviado",
            erro: `Recusado como repetido — já estava no Omie. ${msg.slice(0, 300)}`,
            enviado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
          }).eq("cod_int_lanc", l.cod_int_lanc);
          enviados.push({ cod_int_lanc: l.cod_int_lanc, dia: l.dia, valor: l.valor, n_cod_lanc: null, ja_existia: true });
          continue;
        }

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
