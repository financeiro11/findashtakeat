// Edge Function: asaas-sync
// Alimenta a página /asaas: Recebimentos, Assinaturas (MRR/ARR) e NF-e.
//
// COMO ERA (e por que quebrava): cada clique em "Sincronizar" baixava da API o mês
// inteiro — ~115 requisições — e contava os registros em memória. Só que a maior
// parte disso virava `.length`: `venc_total` (2.861), `ativas` (3.102), `emitidas`
// (2.421)... eram 90 páginas baixadas para produzir três números que a própria API
// devolve como `totalCount` na primeira página. Com cota de 25.000 req/12h e limites
// por endpoint, cliques repetidos batiam em 429.
//
// COMO É AGORA: as linhas cruas vivem em `asaas_cache` (mesma ideia do omie_cache) e
// o cálculo é a RPC `asaas_metricas`, que soma no Postgres. Daí as duas ações:
//
//   "recalcular" (padrão) → só lê o espelho local. ZERO requisições ao Asaas.
//   "atualizar"           → puxa da API o que mudou, grava no espelho, recalcula.
//   "janela"              → só a faixa de vencimento do /caixa (ver puxarJanela)
//   "clientes"            → só a recuperação de cadastros (ver espelharClientes)
//   "preview"             → amostras cruas (validar campos da API)
//
// Params de "atualizar": { referencia?: "YYYY-MM", completo?: boolean }
//   completo:true ignora os atalhos abaixo e re-puxa o mês inteiro.
//
// O "atualizar" é CRON — a tela /asaas só chama "recalcular" (o botão "Atualizar
// do Asaas" foi removido de propósito, ver src/pages/Asaas.tsx).
//
// Auth: usuário logado OU cron (header x-cron-token), como no asaas-extrato-sync.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { asaasGet, asaasList, asaasCount } from "../_shared/asaas.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return isNaN(n) ? 0 : n; };
/** Só os dígitos — o CNPJ chega da tela formatado ou cru, e o Asaas filtra por cru. */
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function mesAtual(): string {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return hoje.slice(0, 7);
}
function rangeMes(ref: string): { de: string; ate: string } {
  const [y, m] = ref.split("-").map(Number);
  const ult = new Date(y, m, 0).getDate();
  return { de: `${y}-${String(m).padStart(2, "0")}-01`, ate: `${y}-${String(m).padStart(2, "0")}-${String(ult).padStart(2, "0")}` };
}
function isoDate(s?: string | null): string | null {
  if (!s) return null;
  const d = String(s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
function subDias(ymd: string, dias: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
const somaDias = (ymd: string, dias: number) => subDias(ymd, -dias);

const RECEBIDO = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];
const EM_ABERTO = ["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"];
const NF_NAO_FINAL = ["SCHEDULED", "SYNCHRONIZED", "PROCESSING", "PENDING"];

// Reprocessa alguns dias para trás: um pagamento pode ser registrado com atraso.
const OVERLAP_DIAS = 5;
// Assinaturas são um retrato do AGORA e não têm recorte por mês. Uma cancelada some
// do filtro ACTIVE, e um incremental jamais saberia disso — ela ficaria viva no
// espelho inflando o MRR para sempre. Por isso a carga é completa, com validade.
const TTL_ASSINATURAS_H = 6;
// Carência entre puxadas REAIS do mesmo mês. Sem isto, apertar "Atualizar" cinco
// vezes seguidas dispara cinco incrementais; no mês corrente cada uma varre a janela
// de OVERLAP_DIAS inteira e o Asaas responde 403 "acesso temporariamente bloqueado"
// (medido). Dentro da carência a chamada vira um recálculo local, que é grátis.
const CARENCIA_PUXADA_S = 120;
// Quantos cadastros de cliente uma rodada vai buscar (1 requisição cada). O número é
// o encontro de duas contas: o backlog de 09/09/26 eram 233 clientes, e três rodadas
// diárias o zeram em um dia; e 150 requisições no portão de 8 concorrentes levam ~6s,
// que cabem folgados no que sobra do relógio do gateway. Ver espelharClientes.
const TETO_CLIENTES = 150;

/* ---------------------------- o relógio da rodada ---------------------------
 *
 * ESTA RODADA MORREU 17 VEZES EM 24. Entre 04 e 11/09/2026 o `asaas-sync-diario`
 * devolveu `IDLE_TIMEOUT (150s)` em 17 das 24 execuções, e não sozinho: as falhas
 * vinham em BLOCO, no mesmo slot, junto com a `asaas-janela-sync-diaria` (13/24) e
 * a `estornos-sync` (22/24). No mesmo minuto, a `asaas-extrato-sync` nunca falhou
 * — e é a única das quatro que NÃO pagina `/payments`.
 *
 * A causa é a soma de duas coisas que sozinhas não apareciam:
 *
 * 1) OS CRONS COLIDIAM. A migration 20260903250000 pôs cinco jobs no MESMO minuto
 *    (10:45 / 15:30 / 20:00 UTC). Três deles varrem `/payments`, e o portão de
 *    concorrência do `_shared/asaas.ts` é por ISOLATE, não por conta: são 8 vagas
 *    em cada um dos três, logo 24 requisições simultâneas no mesmo endpoint — o
 *    que o limite por endpoint do Asaas pune com espera (`esperaSugerida` chega a
 *    dormir 75s). Ver a migration 20260911200000, que espalha os horários.
 *
 * 2) A RODADA JÁ NASCIA GORDA. Medido nos logs de 11/09, um "atualizar" bom levava
 *    ~100s dentro de um orçamento de 150s — 50s de folga para ~160 requisições.
 *    Setenta delas eram a `puxarJanela`, que o cron `asaas-janela-sync-diaria`
 *    refazia inteira no mesmo instante. Trabalho duplicado, pago duas vezes, e
 *    ainda por cima em cima do endpoint disputado.
 *
 * E o 504 não é só um número feio no painel: o gateway corta a RESPOSTA depois de
 * o espelho já ter sido gravado, e o `recalcular` do fim nunca roda — a tela fica
 * com o snapshot velho mesmo com o espelho fresco.
 *
 * O CONSERTO tem três partes, e esta é a terceira: a rodada agora tem ORÇAMENTO.
 * Cada puxada grava o que traz antes de terminar, então o que o relógio corta é
 * frescor, nunca consistência; no prazo, a função devolve o que já fechou, marca
 * `parcial` e deixa o resto correndo em `EdgeRuntime.waitUntil` (o worker vive
 * 400s no plano Pro). Os 150s do gateway, esses, não mudam com plano nenhum — ver
 * "São DOIS relógios" no CLAUDE.md.
 */
const LIMITE_WORKER_MS = 120_000;

/** Reserva para o fim da rodada: `recalcular` é a RPC `asaas_metricas`, medida em
 *  ~1,6s (máx. 2,7s). Dez segundos cobrem ela e o upsert do snapshot com folga. */
const RESERVA_FIM_MS = 10_000;

/** Abaixo disto nem se tenta a fila de cadastros: são até TETO_CLIENTES GETs de
 *  1 registro, e começar o que não cabe é gastar cota para jogar fora. A fila não
 *  se perde — o cliente continua nela até alguém conseguir buscá-lo. */
const MIN_CLIENTES_MS = 20_000;

/** Depois de quanto tempo sem uma rodada INTEIRA a falha vira vermelho no painel.
 *  Uma rodada parcial é degradação normal (a seguinte alcança); o que não pode é
 *  a volta nunca se fechar — mesmo raciocínio do `ultima_volta_completa` da
 *  estornos-sync. Sem isto, esconder o 504 atrás de um 200 seria só apagar o
 *  aviso, e tela que some do painel é pior que tela quebrada. */
const SEM_RODADA_COMPLETA_H = 24;

/** Mantém o isolate de pé para o que ficou correndo depois da resposta. */
function manterVivo(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch(() => {}));
}

/**
 * Roda as puxadas em paralelo com prazo, e devolve o que couber.
 *
 * Duas diferenças para o `Promise.all` que havia aqui, e as duas importam:
 *   • o prazo — quem não terminar entra como `{ pendente: true }` e segue vivo;
 *   • o erro de UMA puxada não derruba as outras. Antes, um 403 nos estornos
 *     rejeitava o `Promise.all` inteiro e a rodada respondia `{error}`: as linhas
 *     de pagamentos e assinaturas já estavam gravadas, mas o snapshot da tela não
 *     era recalculado e o painel via uma falha total onde houve uma parcial.
 */
async function comOrcamento(
  tarefas: Array<[string, Promise<unknown>]>,
  msRestantes: number,
): Promise<{ feito: Record<string, unknown>; pendentes: string[]; resto: Promise<unknown> }> {
  // Semeado na ordem declarada, e não na de chegada: a resposta vira o registro da
  // rodada no painel de automações, e duas rodadas só se comparam de bate-pronto se
  // as chaves saírem sempre na mesma ordem.
  const feito: Record<string, unknown> = {};
  for (const [nome] of tarefas) feito[nome] = { pendente: true };

  const prontas = new Set<string>();
  const todas = Promise.all(tarefas.map(([nome, p]) =>
    p.then((v) => { feito[nome] = v; })
     .catch((e) => { feito[nome] = { erro: e instanceof Error ? e.message : String(e) }; })
     .finally(() => { prontas.add(nome); })));

  let relogio: number | undefined;
  const prazo = new Promise<void>((r) => { relogio = setTimeout(r, Math.max(msRestantes, 0)); });
  // O clearTimeout não é higiene: um setTimeout pendente segura o event loop do
  // isolate, e a rodada que terminou em 40s ficaria de pé até os 120s.
  await Promise.race([todas.then(() => clearTimeout(relogio)), prazo]);

  const pendentes = tarefas.map(([n]) => n).filter((n) => !prontas.has(n));
  return { feito, pendentes, resto: todas };
}

/* -------------------------------- mapeamento ------------------------------- */

type Linha = Record<string, unknown>;

function mapPayment(p: any): Linha {
  return {
    tipo: "payment",
    id_asaas: String(p?.id ?? ""),
    status: String(p?.status ?? ""),
    valor: num(p?.value),
    valor_liquido: p?.netValue == null ? null : num(p.netValue),
    ciclo: null,
    // paymentDate é o mesmo campo em que a API filtra; usar um fallback aqui faria a
    // linha cair num mês diferente do que a busca disse que ela é.
    data_pagamento: isoDate(p?.paymentDate),
    data_vencimento: isoDate(p?.dueDate),
    data_efetiva: null,
    data_criacao: isoDate(p?.dateCreated),
    // Forma e data de crédito alimentam o fluxo projetado do /caixa: lá o que importa
    // não é quando a cobrança vence, e sim quando o dinheiro fica disponível. Quando o
    // Asaas não diz (cobrança ainda não paga), o prazo sai da forma — ver a função
    // asaas_prazo_credito na migration.
    forma: p?.billingType ?? null,
    data_credito: isoDate(p?.creditDate) ?? isoDate(p?.estimatedCreditDate),
    dados: p,
  };
}
function mapSubscription(s: any): Linha {
  return {
    tipo: "subscription",
    id_asaas: String(s?.id ?? ""),
    status: String(s?.status ?? ""),
    valor: num(s?.value),
    valor_liquido: null,
    ciclo: s?.cycle ?? null,
    data_pagamento: null,
    data_vencimento: isoDate(s?.nextDueDate),
    data_efetiva: null,
    data_criacao: isoDate(s?.dateCreated),
    dados: s,
  };
}
/** Mesmo formato da `asaas-carga-historica` — dois formatos na mesma tabela
 *  quebrariam a `notas_fiscais_painel`, que lê `nome` e `documento` (colunas
 *  geradas a partir de `dados`). */
function mapCustomer(c: any): Linha {
  return {
    tipo: "customer",
    id_asaas: String(c?.id ?? ""),
    // `deleted` importa: cliente apagado no Asaas some da lista `/customers` e só
    // volta pelo id. É por isso que alguns órfãos eram de 2022 — a carga completa
    // de agosto não tinha como alcançá-los, e a busca por id tem.
    status: c?.deleted ? "DELETED" : "ACTIVE",
    valor: null,
    valor_liquido: null,
    ciclo: null,
    data_pagamento: null,
    data_vencimento: null,
    data_efetiva: null,
    data_criacao: isoDate(c?.dateCreated),
    dados: c,
  };
}
function mapInvoice(i: any): Linha {
  return {
    tipo: "invoice",
    id_asaas: String(i?.id ?? ""),
    status: String(i?.status ?? ""),
    valor: num(i?.value),
    valor_liquido: null,
    ciclo: null,
    data_pagamento: null,
    data_vencimento: null,
    data_efetiva: isoDate(i?.effectiveDate),
    data_criacao: isoDate(i?.dateCreated),
    dados: i,
  };
}

/**
 * Grava no espelho em blocos — um upsert de 3.000 linhas estoura o payload.
 *
 * O `Map` não é economia, é obrigatório: as buscas que alimentam isto se SOBREPÕEM
 * (uma cobrança que vence em julho e foi paga em julho volta nas duas), e o Postgres
 * recusa o lote inteiro com "ON CONFLICT DO UPDATE command cannot affect row a second
 * time" quando a mesma chave aparece duas vezes no MESMO upsert. Na carga completa o
 * erro ficava escondido só porque as duas cópias caíam em lotes diferentes.
 * Vence a última ocorrência, que é a leitura mais recente da API.
 */
async function gravar(supabase: any, linhas: Linha[]): Promise<number> {
  const unicas = new Map<string, Linha>();
  for (const l of linhas) {
    if (l.id_asaas) unicas.set(`${l.tipo}:${l.id_asaas}`, l);
  }
  const validas = [...unicas.values()];
  const LOTE = 500;
  for (let i = 0; i < validas.length; i += LOTE) {
    const { error } = await supabase
      .from("asaas_cache")
      .upsert(validas.slice(i, i + LOTE).map((l) => ({ ...l, atualizado_em: new Date().toISOString() })),
              { onConflict: "tipo,id_asaas" });
    if (error) throw new Error(`asaas_cache upsert: ${error.message}`);
  }
  return validas.length;
}

async function estado(supabase: any, escopo: string): Promise<any> {
  const { data } = await supabase.from("asaas_sync_estado").select("*").eq("escopo", escopo).maybeSingle();
  return data ?? null;
}
async function marcar(supabase: any, escopo: string, campos: Record<string, unknown>) {
  await supabase.from("asaas_sync_estado").upsert({ escopo, ...campos }, { onConflict: "escopo" });
}

/** Há quanto tempo uma rodada de "atualizar" terminou INTEIRA — ver
 *  SEM_RODADA_COMPLETA_H. Escopo nunca visto vale zero: uma função recém-publicada
 *  não deve nascer gritando que está parada há dias. */
async function horasDesdeRodadaInteira(supabase: any): Promise<number> {
  const est = await estado(supabase, "rodada");
  if (!est?.ultima_completa) {
    await marcar(supabase, "rodada", { ultima_completa: new Date().toISOString() });
    return 0;
  }
  return (Date.now() - new Date(est.ultima_completa).getTime()) / 3_600_000;
}

/* ------------------------------ as três puxadas ---------------------------- */

/**
 * Pagamentos do mês. Na 1ª vez puxa os dois recortes inteiros (quem foi pago no mês
 * e quem vence no mês). Depois, só o que pode ter mudado:
 *   • pagos desde a última sync (o grosso do movimento)
 *   • cobranças criadas desde a última sync que vencem no mês
 *
 * Estorno NÃO é tratado aqui — ver puxarEstornos(). Havia uma terceira consulta neste
 * Promise.all, `{ paymentDate[ge]: de, paymentDate[le]: ate, status: "REFUNDED" }`,
 * escrita sob a premissa de que o paymentDate diria quando o estorno aconteceu. Não
 * diz: medido no espelho em 17/08/26, das 162 cobranças REFUNDED, 153 estão com
 * data_pagamento NULA (o Asaas limpa o campo ao estornar) e as 9 que sobram guardam a
 * data do PAGAMENTO — pagas em julho, estornadas em agosto. A consulta portanto ou
 * não devolvia a linha, ou a devolvia no mês em que o dinheiro tinha ENTRADO.
 */
async function puxarPagamentos(supabase: any, ref: string, completo: boolean) {
  const { de, ate } = rangeMes(ref);
  const escopo = `payment:${ref}`;
  const est = await estado(supabase, escopo);
  const primeiraVez = !est?.ultima_completa;

  const linhas: any[] = [];
  let requisicoes = "completa";

  if (primeiraVez || completo) {
    const [porPagamento, porVencimento] = await Promise.all([
      asaasList("/payments", { "paymentDate[ge]": de, "paymentDate[le]": ate }),
      asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate }),
    ]);
    linhas.push(...porPagamento, ...porVencimento);
    await marcar(supabase, escopo, { ultima_completa: new Date().toISOString(), ultima_incremental: new Date().toISOString() });
  } else {
    requisicoes = "incremental";
    const desde = isoDate(est.ultima_incremental ?? est.ultima_completa) ?? de;
    const marca = subDias(desde, OVERLAP_DIAS);
    const inicio = marca > de ? marca : de;

    const [recemPagos, novas] = await Promise.all([
      asaasList("/payments", { "paymentDate[ge]": inicio, "paymentDate[le]": ate }),
      asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate, "dateCreated[ge]": inicio }),
    ]);
    linhas.push(...recemPagos, ...novas);
    await marcar(supabase, escopo, { ultima_incremental: new Date().toISOString() });
  }

  const n = await gravar(supabase, linhas.map(mapPayment));
  return { modo: requisicoes, linhas: n };
}

/**
 * OS ESTORNOS — varredura por STATUS, sem recorte de mês.
 *
 * POR QUE SEM MÊS: um estorno não tem mês próprio no recorte das outras puxadas. A
 * cobrança de origem pode ser de qualquer mês passado, e o paymentDate não serve de
 * âncora (ver puxarPagamentos: ou está vazio, ou é a data do pagamento) — então nem
 * `paymentDate[ge]` nem o mês de referência alcançam a linha de forma confiável.
 * A janela de vencimento (±45/31 dias) cobre só o passado recente: medido em
 * 17/08/26, as cobranças com estorno PARCIAL no espelho vão de junho a setembro/26 e
 * mais nada — exatamente o desenho da janela, e não a história real dos estornos.
 * O resultado prático era um buraco permanente: estorno em agosto de uma cobrança de
 * junho não voltava para o espelho nem em agosto nem em junho.
 *
 * O CUSTO: uma requisição por status + as páginas de quem tiver volume. Na ordem de
 * ~8 requisições, contra a cota de 25.000/12h. Só roda em "atualizar".
 *
 * LIMITE CONHECIDO — ESTORNO PARCIAL. Ele não tem status próprio: a cobrança segue
 * RECEIVED/CONFIRMED e o valor devolvido só existe dentro de `refunds[]`. Nenhuma
 * varredura por status o encontra, e a API não expõe filtro por "tem refunds". Ele só
 * chega ao espelho quando a linha é revisitada por outra puxada (vencimento no mês ou
 * na janela). Para cobranças antigas parcialmente estornadas, o dado pode faltar — o
 * fechamento definitivo é o webhook PAYMENT_PARTIALLY_REFUNDED, que ainda não existe.
 */
const STATUS_DEVOLUCAO = [
  "REFUNDED",              // estorno total já concluído
  "REFUND_REQUESTED",      // pedido registrado, dinheiro ainda não saiu
  "REFUND_IN_PROGRESS",    // liquidação agendada, estorna depois de liquidar
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
];

async function puxarEstornos(supabase: any) {
  const listas = await Promise.all(
    STATUS_DEVOLUCAO.map((status) => asaasList("/payments", { status })),
  );
  const porStatus = Object.fromEntries(STATUS_DEVOLUCAO.map((s, i) => [s, listas[i].length]));
  const n = await gravar(supabase, listas.flat().map(mapPayment));

  await marcar(supabase, "payment:estornos", {
    ultima_completa: new Date().toISOString(),
    ultima_incremental: new Date().toISOString(),
    detalhe: { por_status: porStatus, linhas: n },
  });
  return { linhas: n, por_status: porStatus };
}

/**
 * A JANELA DO FLUXO PROJETADO — o que alimenta o gráfico do /caixa.
 *
 * As outras puxadas são recortadas por MÊS DE REFERÊNCIA e por isso não enxergam o
 * que interessa aqui: a cobrança que vence dia 12 do mês que vem, e a que venceu no
 * mês passado e ainda está em trânsito para o saldo. Esta puxa uma faixa contínua de
 * vencimento em torno de hoje:
 *
 *   ← 45 dias           HOJE           31 dias →
 *   ├────────────────────┼────────────────────┤
 *   pagas há pouco,      |    a vencer dentro
 *   crédito ainda        |    dos 30 dias do
 *   a caminho (cartão)   |    gráfico
 *
 * SEM filtro de status, de propósito: é isso que faz o espelho se curar sozinho. Uma
 * cobrança gravada como PENDING que depois foi paga volta nesta varredura com o
 * status novo; com filtro `status=PENDING` ela nunca mais seria visitada e ficaria
 * viva no espelho, somando no fluxo um dinheiro que já entrou.
 *
 * QUEM CHAMA: só a action "janela", e só o cron `asaas-janela-sync-diaria`. O
 * "atualizar" chamava isto TAMBÉM, no mesmo minuto em que o cron da janela rodava
 * — as mesmas ~70 páginas de `/payments` e os mesmos ~7.000 upserts, duas vezes,
 * em paralelo, disputando o limite por endpoint um com o outro. Era metade do
 * custo da rodada e valia zero: ver o relógio lá em cima.
 */
const JANELA_ANTES = 45;
const JANELA_DEPOIS = 31;

async function puxarJanela(supabase: any) {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const de = subDias(hoje, JANELA_ANTES);
  const ate = somaDias(hoje, JANELA_DEPOIS);

  const cobrancas = await asaasList("/payments", { "dueDate[ge]": de, "dueDate[le]": ate });
  const n = await gravar(supabase, cobrancas.map(mapPayment));

  await marcar(supabase, "payment:janela", {
    ultima_completa: new Date().toISOString(),
    ultima_incremental: new Date().toISOString(),
    detalhe: { de, ate, linhas: n },
  });
  return { de, ate, linhas: n };
}

/**
 * OS CADASTROS DE CLIENTE — a puxada que faltava, e que faltava desde sempre.
 *
 * A cobrança do Asaas traz o cliente como uma referência (`customer: cus_xxx`) e
 * nada mais: nome e CNPJ moram no cadastro, noutro endpoint. Esta sync mantinha
 * pagamentos, assinaturas e notas frescos e NUNCA buscava cadastro — quem encheu
 * `tipo='customer'` foi uma ação manual da `asaas-carga-historica`, rodada uma vez
 * em 18/08/2026. O efeito, medido em 09/09/2026: 233 clientes com cobrança e sem
 * cadastro local, 475 cobranças, R$ 204 mil. Na tela de Notas Fiscais eles
 * apareciam com "—" no nome e "sem documento" embaixo — o que é falso, porque o
 * Asaas não deixa criar cliente sem nome. Pior que o rótulo: a
 * `notas_fiscais_fila_emissao` junta o cliente com `join` e não `left join`, então
 * essas cobranças sumiam da fila de emissão sem erro nenhum.
 *
 * POR QUE POR ID E NÃO RELISTANDO `/customers`: a lista inteira são 63 páginas a
 * cada rodada para descobrir os dois ou três que entraram, e ainda por cima ela
 * NÃO devolve os apagados (`deleted`), que é o que explica os órfãos de 2022. A
 * busca por id custa 1 requisição por cliente que falta, resolve o apagado, e em
 * regime normal a fila tem meia dúzia. É o mesmo desenho do `resolverClientes` da
 * estornos-sync.
 *
 * O TETO existe porque a fila pode estar grande (o backlog inicial) e o gateway
 * corta em 150s independentemente do plano. Uma rodada pega até TETO_CLIENTES e
 * devolve quantos ficaram; as três rodadas diárias terminam o serviço.
 */
async function espelharClientes(supabase: any, teto = TETO_CLIENTES) {
  const { data: fila, error } = await supabase.rpc("asaas_clientes_a_espelhar", { p_limite: teto });
  if (error) throw new Error(`asaas_clientes_a_espelhar: ${error.message}`);
  const ids = (fila ?? []).map((r: any) => String(r.cliente_ref)).filter(Boolean);
  if (!ids.length) {
    await marcar(supabase, "customer", { ultima_incremental: new Date().toISOString(), detalhe: { novos: 0, faltavam: 0 } });
    return { novos: 0, faltavam: 0, falharam: 0 };
  }

  // Um cadastro que não vem não pode derrubar a sync inteira: o resto do espelho
  // já está gravado, e a próxima rodada tenta de novo (ele continua na fila).
  const buscados = await Promise.all(ids.map(async (id: string) => {
    try { return await asaasGet<any>(`/customers/${id}`); } catch { return null; }
  }));
  const achados = buscados.filter(Boolean);
  const novos = await gravar(supabase, achados.map(mapCustomer));

  await marcar(supabase, "customer", {
    ultima_incremental: new Date().toISOString(),
    detalhe: { novos, faltavam: ids.length, falharam: ids.length - achados.length },
  });
  return { novos, faltavam: ids.length, falharam: ids.length - achados.length };
}

/**
 * Assinaturas ativas. Carga completa (ver TTL_ASSINATURAS_H), mas antes disso um
 * `totalCount` de 1 requisição decide se vale a pena: se a contagem bate com o que
 * já está no espelho e a carga é recente, as 32 páginas são puladas inteiras.
 */
async function puxarAssinaturas(supabase: any, completo: boolean) {
  const escopo = "subscription";
  const est = await estado(supabase, escopo);

  const idadeH = est?.ultima_completa
    ? (Date.now() - new Date(est.ultima_completa).getTime()) / 3_600_000
    : Infinity;

  if (!completo && idadeH < TTL_ASSINATURAS_H) {
    const [remoto, local] = await Promise.all([
      asaasCount("/subscriptions", { status: "ACTIVE" }),
      supabase.from("asaas_cache").select("*", { count: "exact", head: true }).eq("tipo", "subscription").eq("status", "ACTIVE"),
    ]);
    if (remoto === (local?.count ?? -1)) return { modo: "inalterado", linhas: 0, requisicoes: 1 };
  }

  const ativas = await asaasList("/subscriptions", { status: "ACTIVE" });
  // Quem não voltou no filtro ACTIVE saiu da base: sem isso, uma assinatura cancelada
  // continuaria somando no MRR para sempre.
  const vivos = new Set(ativas.map((s: any) => String(s?.id ?? "")));
  const { data: cacheados } = await supabase
    .from("asaas_cache").select("id_asaas").eq("tipo", "subscription").eq("status", "ACTIVE");
  const sumiram = (cacheados ?? []).map((r: any) => r.id_asaas).filter((id: string) => !vivos.has(id));
  if (sumiram.length) {
    await supabase.from("asaas_cache").update({ status: "INACTIVE" }).eq("tipo", "subscription").in("id_asaas", sumiram);
  }

  const n = await gravar(supabase, ativas.map(mapSubscription));
  await marcar(supabase, escopo, {
    ultima_completa: new Date().toISOString(),
    ultima_incremental: new Date().toISOString(),
    detalhe: { ativas: n, encerradas_no_ciclo: sumiram.length },
  });
  return { modo: "completa", linhas: n, encerradas: sumiram.length };
}

/**
 * NF-e do mês. Aqui o atalho é uma comparação de contagens: 2 requisições dizem se
 * emitidas/erro mexeram desde a última carga. Se não mexeram, as 28 páginas são
 * puladas. Nota autorizada não muda mais de valor, então a contagem basta.
 */
async function puxarNotas(supabase: any, ref: string, completo: boolean) {
  const { de, ate } = rangeMes(ref);
  const escopo = `invoice:${ref}`;
  const est = await estado(supabase, escopo);

  if (!completo && est?.ultima_completa) {
    const [remotoAut, remotoErr, local] = await Promise.all([
      asaasCount("/invoices", { "effectiveDate[ge]": de, "effectiveDate[le]": ate, status: "AUTHORIZED" }),
      asaasCount("/invoices", { "effectiveDate[ge]": de, "effectiveDate[le]": ate, status: "ERROR" }),
      supabase.rpc("asaas_metricas", { p_referencia: ref }),
    ]);
    const nfe = (local?.data as any)?.nfe;
    if (nfe && remotoAut === nfe.emitidas && remotoErr === nfe.erro) {
      return { modo: "inalterado", linhas: 0, requisicoes: 2 };
    }
  }

  const notas = await asaasList("/invoices", { "effectiveDate[ge]": de, "effectiveDate[le]": ate });
  const n = await gravar(supabase, notas.map(mapInvoice));
  await marcar(supabase, escopo, { ultima_completa: new Date().toISOString(), ultima_incremental: new Date().toISOString() });
  return { modo: "completa", linhas: n };
}

/* --------------------------------- cálculo -------------------------------- */

/**
 * Recalcula do espelho e grava o snapshot. Nenhuma requisição ao Asaas.
 *
 * A trava do começo não é decoração: um mês que nunca foi puxado tem espelho vazio,
 * e recalcular em cima disso gravaria zeros por cima de um snapshot bom. Nesse caso
 * devolvemos o que já existe e pedimos "Atualizar do Asaas".
 */
async function recalcular(supabase: any, ref: string) {
  const est = await estado(supabase, `payment:${ref}`);
  if (!est?.ultima_completa) {
    const { data: atual } = await supabase
      .from("asaas_snapshots").select("dados").eq("referencia", ref).maybeSingle();
    if (atual?.dados) {
      return { dados: atual.dados, aviso: "Este mês ainda não foi espelhado; use Atualizar do Asaas." };
    }
  }

  const { data, error } = await supabase.rpc("asaas_metricas", { p_referencia: ref });
  if (error) throw new Error(`asaas_metricas: ${error.message}`);
  const dados = data ?? null;

  const { error: e2 } = await supabase
    .from("asaas_snapshots")
    .upsert({ referencia: ref, dados, gerado_em: new Date().toISOString() }, { onConflict: "referencia" });
  if (e2) throw e2;
  return { dados };
}

/* ---------------------------------- cron ---------------------------------- */

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "asaas-sync").eq("token", token).maybeSingle();
  return !!data;
}

/* --------------------------------- handler -------------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();
  const sobra = () => LIMITE_WORKER_MS - (Date.now() - t0);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (!(await chamadaDeCron(req, supabase))) {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    const action = body?.action ?? "recalcular";
    const ref = String(body?.referencia || mesAtual());

    /* ------------- PREVIEW ------------- */
    if (action === "preview") {
      const [pay, sub, inv] = await Promise.all([
        asaasGet<any>("/payments", { limit: 3 }),
        asaasGet<any>("/subscriptions", { limit: 3, status: "ACTIVE" }),
        asaasGet<any>("/invoices", { limit: 3 }),
      ]);
      return json({
        ok: true,
        payments_totalCount: pay?.totalCount, subscriptions_totalCount: sub?.totalCount, invoices_totalCount: inv?.totalCount,
        amostra_payment: pay?.data?.[0] ?? null,
        amostra_subscription: sub?.data?.[0] ?? null,
        amostra_invoice: inv?.data?.[0] ?? null,
      });
    }

    /* ------------- JANELA — só as cobranças do fluxo projetado do /caixa ------------- */
    // Ação separada porque quem precisa dela é a omie-caixa-sync (cron das 09h), não a
    // página /asaas: puxar mês, assinaturas e NF-e só para redesenhar o gráfico seria
    // caro à toa.
    if (action === "janela") {
      const janela = await puxarJanela(supabase);
      return json({ ok: true, origem: "asaas", detalhe: { janela } });
    }

    /* ------------- CLIENTES — a recuperação de cadastros, sozinha ------------- */
    // Ação própria porque o backlog inicial (233 clientes em 09/09/26) merece ser
    // zerado de uma vez, sem esperar as rodadas diárias, e sem arrastar junto as
    // ~115 requisições de um "atualizar" completo. `teto` aceita um número maior
    // para essa mutirão; o padrão é o mesmo da rodada.
    if (action === "clientes") {
      const teto = Number.isFinite(Number(body?.teto)) ? Math.max(1, Math.min(600, Number(body.teto))) : TETO_CLIENTES;
      return json({ ok: true, origem: "asaas", clientes: await espelharClientes(supabase, teto) });
    }

    /* ------------- COBRANCA — UMA cobrança, agora, sem esperar a rodada -------------
     *
     * O BOTÃO GERAL "Atualizar do Asaas" FOI REMOVIDO DE PROPÓSITO e continua
     * removido: ele varria ~70 páginas de `/payments` e queimava cota na mão.
     * Esta ação é o oposto dele — uma a três requisições, nomeadas.
     *
     * POR QUE ELA PRECISA EXISTIR. O espelho enche três vezes por dia (07:45,
     * 12:30 e 17:00 BRT). Quem cria uma cobrança às 10h e vai emitir a nota dela
     * não encontra a linha em lugar nenhum — nem no painel do mês, nem na busca —
     * e não há nada na tela dizendo por quê. Foi o que aconteceu em 11/09/2026 com
     * a comissão do INFOSS: cobrança criada, e a linha só apareceu na varredura
     * seguinte. "Espere até amanhã" é exatamente o tipo de resposta que faz alguém
     * abrir o Asaas e resolver por fora.
     *
     * TRÊS ENTRADAS, porque quem procura raramente tem o `pay_`: o id da cobrança,
     * o CNPJ/CPF do cliente (o caminho mais comum — é o que se digita na busca do
     * painel) ou o nome. Com cliente, traz as cobranças dele; a janela é curta de
     * propósito (as 20 mais recentes), porque isto é "achar o que acabou de
     * nascer", não carga histórica — para essa existe a `asaas-carga-historica`.
     *
     * O CLIENTE VEM JUNTO, sempre. Cobrança cujo `customer` não está no espelho
     * aparece no painel como "cadastro ainda não espelhado" e não emite: gravar a
     * cobrança sem o cliente trocaria um buraco por outro. */
    if (action === "cobranca") {
      const id = String(body?.id ?? "").trim();
      const documento = soDigitos(body?.documento);
      const nome = String(body?.nome ?? "").trim();
      if (!id && !documento && !nome) {
        return json({ ok: false, erro: "Informe { id: \"pay_…\" }, { documento } ou { nome }." }, 400);
      }

      const pagamentos: any[] = [];
      const clientes: any[] = [];

      if (id) {
        const p = await asaasGet<any>(`/payments/${encodeURIComponent(id)}`).catch(() => null);
        if (p?.id) pagamentos.push(p);
      } else {
        /* `cpfCnpj` é filtro exato no Asaas; `name` é busca parcial. O documento
           vem primeiro porque é o que casa com a regra do módulo inteiro (por
           CNPJ e nunca por nome — o fantasia do Asaas e a razão social do Omie
           divergem). */
        const busca = await asaasGet<any>("/customers", documento ? { cpfCnpj: documento } : { name: nome, limit: 10 })
          .catch(() => null);
        for (const c of (busca?.data ?? []).slice(0, 5)) {
          clientes.push(c);
          const lista = await asaasGet<any>("/payments", { customer: c.id, limit: 20, offset: 0 }).catch(() => null);
          for (const p of lista?.data ?? []) pagamentos.push(p);
        }
      }

      // Do lado da cobrança achada por id, o cliente ainda falta.
      const jaTem = new Set(clientes.map((c) => String(c?.id)));
      for (const cus of [...new Set(pagamentos.map((p) => String(p?.customer ?? "")).filter(Boolean))]) {
        if (jaTem.has(cus)) continue;
        const c = await asaasGet<any>(`/customers/${encodeURIComponent(cus)}`).catch(() => null);
        if (c?.id) clientes.push(c);
      }

      const gravados = await gravar(supabase, [
        ...clientes.map(mapCustomer),
        ...pagamentos.map(mapPayment),
      ]);

      return json({
        ok: true, origem: "asaas",
        cobrancas: pagamentos.length,
        clientes: clientes.length,
        gravados,
        // A tela precisa saber O QUE achou para poder levar a pessoa até lá.
        achadas: pagamentos.slice(0, 20).map((p) => ({
          id_asaas: String(p?.id ?? ""),
          valor: num(p?.value),
          status: String(p?.status ?? ""),
          data_vencimento: isoDate(p?.dueDate),
          descricao: p?.description ?? null,
        })),
      });
    }

    /* ------------- ATUALIZAR (única ação que fala com o Asaas) ------------- */
    if (action === "atualizar" || action === "sync") {
      const completo = body?.completo === true;

      // Carência: dois cliques seguidos não viram duas varreduras. O segundo cai no
      // recálculo local, que devolve exatamente os mesmos números — nada se perde,
      // porque nenhuma puxada anterior a 2 minutos deixou dado para trás.
      const ultima = (await estado(supabase, `payment:${ref}`))?.ultima_incremental;
      const segundos = ultima ? (Date.now() - new Date(ultima).getTime()) / 1000 : Infinity;
      if (!completo && segundos < CARENCIA_PUXADA_S) {
        const { dados } = await recalcular(supabase, ref);
        return json({
          ok: true, referencia: ref, origem: "espelho",
          aviso: `Atualizado há ${Math.round(segundos)}s — números recalculados sem consultar o Asaas.`,
          dados,
        });
      }

      // A janela NÃO entra aqui — ela é do cron `asaas-janela-sync-diaria`, que
      // roda nos mesmos três horários. Ver puxarJanela.
      const { feito, pendentes, resto } = await comOrcamento([
        ["pagamentos", puxarPagamentos(supabase, ref, completo)],
        ["assinaturas", puxarAssinaturas(supabase, completo)],
        ["notas", puxarNotas(supabase, ref, completo)],
        // Estornos não têm mês e valem para QUALQUER referência: o estorno que
        // interessa a julho pode ter sido feito hoje.
        ["estornos", puxarEstornos(supabase)],
      ], sobra() - RESERVA_FIM_MS);

      // DEPOIS das puxadas, e não junto: a fila de cadastros é lida do espelho, e
      // o cliente da cobrança que acabou de chegar só entra nela depois que a
      // cobrança está gravada. Em paralelo, a rodada de hoje sempre acharia o
      // cliente novo só amanhã.
      // O catch é pelo mesmo motivo do `comOrcamento`: a fila de cadastros é a
      // última e a menos importante das puxadas, e não pode levar embora o
      // recálculo de tudo que já está gravado.
      feito.clientes = pendentes.length > 0 || sobra() < MIN_CLIENTES_MS + RESERVA_FIM_MS
        ? { pendente: true }
        : await espelharClientes(supabase).catch((e) =>
            ({ erro: e instanceof Error ? e.message : String(e) }));

      // O recálculo roda SEMPRE, inclusive na rodada parcial: o que já foi gravado
      // merece aparecer na tela. Era exatamente isto que o 504 comia.
      const { dados } = await recalcular(supabase, ref);

      // "Inteira" se lê do RESULTADO de cada passo, e não da lista de pendentes:
      // quem estourou terminou (está em `pendentes`? não) mas entregou `{erro}`, e
      // dar essa rodada por completa esconderia uma puxada quebrada para sempre.
      const incompleto = (v: unknown) => !!(v as any)?.pendente || !!(v as any)?.erro;
      const incompletas = Object.entries(feito).filter(([, v]) => incompleto(v)).map(([n]) => n);
      const inteira = incompletas.length === 0;

      if (inteira) await marcar(supabase, "rodada", { ultima_completa: new Date().toISOString() });
      else manterVivo(resto);

      const corpo = {
        ok: true, referencia: ref, origem: "asaas",
        parcial: !inteira, incompletas,
        segundos: Math.round((Date.now() - t0) / 1000),
        detalhe: feito, dados,
      };
      if (inteira) return json(corpo);

      // Parcial é degradação aceitável — a rodada seguinte alcança, e o espelho já
      // recebeu o que deu tempo. O que NÃO pode passar calado é a volta nunca se
      // fechar: aí o painel precisa ficar vermelho, ou trocar o 504 por um 200
      // teria sido só apagar o aviso.
      const desdeInteira = await horasDesdeRodadaInteira(supabase);
      if (desdeInteira > SEM_RODADA_COMPLETA_H) {
        return json({ ...corpo, ok: false,
          erro: `rodada incompleta (${incompletas.join(", ")}) e nenhuma rodada inteira há ${Math.round(desdeInteira)}h` }, 500);
      }
      return json(corpo);
    }

    /* ------------- RECALCULAR (padrão) — 0 requisições ------------- */
    const { dados, aviso } = await recalcular(supabase, ref);
    return json({ ok: true, referencia: ref, origem: "espelho", aviso, dados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("asaas-sync error:", msg);
    return json({ error: msg }, 200);
  }
});