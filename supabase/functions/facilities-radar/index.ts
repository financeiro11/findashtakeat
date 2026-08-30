// Edge Function: facilities-radar
//
// O radar de preços do Facilities.
//
//   { action: "interpretar", pedido, link_ref? }     → texto livre vira specs
//   { action: "varrer",  alvo_id?, limite?, fontes? } → sai atrás de preço
//   { action: "confirmar", alvo_id?, limite? }        → abre o anúncio e checa
//   { action: "sugerir_teto", alvo_id, preco_alvo? }  → o que a curva diz do teto
//
// VARRER E CONFIRMAR SÃO DUAS METADES, e essa separação é o coração da coisa.
// A varredura lê PÁGINAS DE BUSCA, que são baratas e mentem: mostram produto
// esgotado com o último preço praticado — que fica bonito justamente por não
// estar mais à venda. Por isso o achado nasce em quarentena (`a_confirmar`) e
// não aparece na tela. A confirmação abre O ANÚNCIO, um a um, e só então ele
// vira aviso: com estoque conferido e com o frete somado ao preço.
//
// Confirmar os ~76 candidatos de uma rodada seriam 76 créditos por alvo por dia.
// Confirmar os três que virariam aviso custa três — e são exatamente os três em
// que alguém vai clicar. Filtro barato em tudo, conferência cara só no que vira
// ação.
//
// E A CONFERÊNCIA TEM VALIDADE, dos dois lados. Um "esgotado" apurado às 12h
// não pode ser apagado pela varredura das 14h: a página de busca continua
// listando o produto morto com o último preço, então quem só lê a busca
// ressuscita todo dia o que a conferência acabou de enterrar (medido em
// 27/08/2026 — a oferta 155 voltou a `ativo` duas rodadas depois de confirmada
// esgotada, e virou o "melhor preço" do alvo). Do outro lado, um achado
// confirmado ontem pode ter acabado hoje: o que já está NA TELA é reconferido
// a cada 24h e sai de lá quando some da loja. Ver `esgotadas` na varredura e
// `reconferencia` na confirmação.
//
// O FRETE ENTRA NA CONTA. O teto é quanto o Facilities aceita GASTAR, e um
// notebook de R$ 2.980 com R$ 140 de frete não cabe num teto de R$ 3.000. Teto,
// ranking, alerta e economia são todos medidos pelo total. Frete que a página
// não informa fica `null`, nunca zero: somar zero afirmaria "é grátis".
//
// COMO A IA E A REGRA SE DIVIDEM. A IA entra UMA vez, na `interpretar`: lê
// "notebook i5 16GB SSD 512 até 3 mil" (e, se houver, o anúncio de referência) e
// devolve specs estruturadas + os termos de busca. Depois disso ela sai de cena.
// Quem aprova ou recusa cada um dos ~200 anúncios por rodada é o
// `_shared/radar-precos.ts`, em TypeScript puro, testado — porque essa decisão
// roda centenas de vezes por dia, precisa ser barata, e precisa poder ser
// contestada: quando o radar recusa, o Facilities lê o motivo em português.
//
// FONTES: TODAS POR FIRECRAWL, INCLUSIVE O MERCADO LIVRE. O plano era usar a
// API oficial do ML, e ela não serve mais para isso — com a chave da Takeat e um
// token válido em mãos (26/08/2026), `/sites/MLB/search` responde 403 e
// `/products/{id}` vem com `buy_box_winner: null`. A API foi fechada para
// aplicações; sobrou a lista pública. Detalhes em `tokenML`.
//
// E a lista pública TAMBÉM não abre: um GET responde 302 para a página de
// "verificação de conta" e o Firecrawl esgota todos os motores, stealth
// inclusive. O ML está fechado para nós hoje, dos dois lados. O código dele fica
// aqui, com a URL correta, porque o dia em que houver um token de usuário
// autorizado (fluxo authorization_code) ou um proxy que passe, é só religar.
//
// DOZE FONTES, EM RODÍZIO. Comprovadas em 26/08/2026: Kabum (36 anúncios),
// Buscapé (30), Zoom (24) e Terabyte (18) — os agregadores puxam muita loja de
// uma vez e foram a melhor surpresa. Amazon, Magalu e ML abriram a página e não
// renderam nada. As demais (Bondfaro, Pichau, Balão, Americanas, Casas Bahia,
// Carrefour, Fast Shop) entraram para SEREM MEDIDAS, não porque eu suponho que
// funcionam — a que vier vazia diz isso no card e sai da lista padrão.
//
// Como seis fontes cabem numa rodada e são doze, as comprovadas vão sempre e as
// outras giram. Cortar só pelas primeiras da fila deixaria as últimas ligadas na
// tela e mudas na prática. Uma fonte que cai NÃO derruba a rodada.
//
// O ORÇAMENTO É DE RELÓGIO, NÃO DE CONTAGEM. O worker morre aos ~150s sem
// devolver relatório. A rodada para aos 55s e informa `restante`, para o cron do
// dia seguinte (ou um segundo clique) continuar de onde parou — a fila é
// ordenada por `ultima_varredura nulls first`, então quem ficou para trás é o
// primeiro da próxima.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, generateText, MODELO_LITE } from "../_shared/gemini.ts";
import {
  avaliar, chaveDoProduto, classificar, condicaoDoTitulo, disponibilidade, DIAS_PARA_SUGERIR, economiaDe, emCentavos, lerSpecs, MIN_AVALIACOES, norm, pisoDePreco, sugerirTeto, totalDaOferta,
  type AlvoSpecs, type OfertaBruta,
} from "../_shared/radar-precos.ts";
/* O saldo e o freio moram no módulo compartilhado desde que o Firecrawl passou a
   ter cinco consumidores no Hub. O radar deixou de ser o único que gasta, e o
   número que decide "posso?" não pode viver dentro de quem pergunta. */
import { podeGastar, registrarGasto, saldoFirecrawl } from "../_shared/firecrawl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ORCAMENTO_MS = 55_000;
/**
 * Quantos achados viram alerta por alvo, por rodada. Vinte anúncios abaixo do
 * teto viram vinte avisos e o Facilities para de olhar a aba. Três é o que cabe
 * numa mensagem de WhatsApp sem rolar.
 */
const MAX_ALERTAS_POR_ALVO = 3;
/**
 * Quantas fontes por alvo por rodada. Cada uma custa um crédito de Firecrawl,
 * uma chamada de IA e ~40s de espera — e são doze cadastradas.
 *
 * ERAM SEIS, E VIRARAM CINCO SEM PERDER COBERTURA. Até 27/08/2026, três das seis
 * vagas podiam cair na mesma família (Buscapé, Zoom e Bondfaro são a mesma
 * empresa, com o mesmo estoque): seis leituras compravam, na prática, quatro ou
 * cinco vitrines distintas. Com uma vaga por família, cinco leituras compram
 * cinco vitrines distintas — mais estoque de verdade do que o desenho anterior,
 * por um crédito a menos por alvo por rodada.
 */
const MAX_FONTES_POR_RODADA = 5;
/**
 * Quantas das melhores vão SEMPRE, antes do rodízio. Não é mais "até a
 * prioridade N": a ordem agora vem do rendimento medido, e o que se fixa é a
 * quantidade de lugares no pódio.
 */
const FIXAS_ATE = 3;

/* O freio de crédito mora em `_shared/radar-precos.ts` (SALDO_MINIMO_RASPAGEM),
   junto com o resto da regra: a tela precisa do mesmo número para explicar por
   que a varredura parou. */

/**
 * POR QUANTO TEMPO UM "ESGOTADO" CONFERIDO CONTINUA VALENDO.
 *
 * A varredura não tem como saber que o produto acabou — a vitrine da loja
 * segue mostrando o anúncio morto com o último preço praticado. Quem sabe é a
 * conferência, que abriu a página. Se a varredura seguinte apagar esse "não",
 * o anúncio morto volta a `ativo` e vira o "melhor preço" do alvo: foi o que
 * aconteceu em 27/08/2026 com um Vivobook da Magalu que dizia PRODUTO
 * INDISPONÍVEL na própria página e mesmo assim ocupava o topo do card.
 *
 * Mas o "não" também não é eterno — produto volta ao estoque. Passada a
 * validade, o anúncio reentra no fluxo normal e é conferido de novo; se ainda
 * estiver morto, a conferência o mata outra vez, ao custo de uma leitura por
 * semana. Uma semana é o meio-termo entre ressuscitar defunto todo dia e
 * ignorar para sempre um produto que voltou.
 */
const DIAS_QUE_O_ESGOTADO_VALE = 7;

/**
 * DE QUANTO EM QUANTO TEMPO UM ACHADO QUE JÁ ESTÁ NA TELA É RECONFERIDO.
 *
 * A conferência é um retrato do momento em que o achado subiu. O produto que
 * estava à venda ontem pode ter acabado hoje, e o aviso continuaria lá,
 * bonito, com um preço que não existe mais — exatamente o que a quarentena
 * existe para impedir, só que atrasado no tempo.
 */
const HORAS_PARA_RECONFERIR = 24;

/**
 * Quantos achados da tela são reconferidos por rodada.
 *
 * Reserva, não teto de fila: a quarentena e a reconferência disputam o mesmo
 * relógio, e sem reserva a quarentena cheia faria a reconferência nunca rodar
 * — os fantasmas ficariam na tela justamente nos dias de mais movimento.
 *
 * Três (e não dois) desde que o plano de raspagem deixou de ser o gargalo: são
 * quatro conferências por dia, então a tela inteira se renova em poucas horas,
 * e nenhum aviso passa um dia sem alguém abrir o anúncio dele.
 */
const MAX_RECONFERIR = 3;

/**
 * QUANTAS LEITURAS FALHADAS ANTES DE DESISTIR DE UM ACHADO NA QUARENTENA.
 *
 * Três, e não duas: a primeira falha costuma ser soluço (o mesmo `HTTP 500 —
 * exception ID` que a Terabyte devolveu e que sumiu minutos depois), e a
 * segunda ainda pode ser a loja em manutenção. Três leituras espaçadas por
 * rodadas diferentes já são um "não" sobre o link, não sobre o momento.
 *
 * Isto convive com o prazo de 48h em vez de substituí-lo: são as duas metades
 * da mesma frase. Idade sozinha descarta quem nunca foi tentado; tentativa
 * sozinha deixaria na fila para sempre o achado que a fila nunca alcança.
 */
const TENTATIVAS_ATE_DESISTIR = 3;

/* =========================================================== Mercado Livre */

/**
 * A API do ML entra aqui SÓ para ler um anúncio que a pessoa colou. A busca por
 * ela não existe mais para aplicações — medido em 26/08/2026 com a chave da
 * Takeat, token de client_credentials válido em mãos:
 *
 *   GET /sites/MLB/search        → 403 forbidden   (fechado para app token)
 *   GET /products/search         → 200, mas devolve CATÁLOGO, sem preço
 *   GET /products/{id}           → 200, `buy_box_winner: null`, permalink vazio
 *   GET /sites/MLB               → 200              (o token funciona mesmo)
 *
 * Ou seja: a chave é boa, o endereço é que fechou. Preço de anúncio, hoje, só
 * pela lista pública — que é raspada como as lojas, com a vantagem de aceitar a
 * faixa de preço na própria URL (ver `LOJAS`).
 */
async function tokenML(): Promise<{ token: string | null; erro: string | null }> {
  const direto = Deno.env.get("MERCADO_LIVRE_ACCESS_TOKEN");
  if (direto) return { token: direto, erro: null };

  const id = Deno.env.get("MERCADO_LIVRE_APP_ID");
  const secret = Deno.env.get("MERCADO_LIVRE_SECRET");
  if (!id || !secret) {
    return { token: null, erro: "MERCADO_LIVRE_APP_ID/SECRET não configurados nos segredos do projeto" };
  }
  try {
    const r = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d?.access_token) {
      return { token: null, erro: `oauth ${r.status}: ${JSON.stringify(d).slice(0, 200)}` };
    }
    return { token: d.access_token as string, erro: null };
  } catch (e) {
    return { token: null, erro: String(e) };
  }
}

/** Anúncio de referência que a pessoa colou: dá para ler direto pela API. */
async function itemML(link: string, token: string): Promise<string | null> {
  const m = link.match(/\bMLB-?(\d{6,})/i);
  if (!m) return null;
  try {
    const r = await fetch(`https://api.mercadolibre.com/items/MLB${m[1]}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const attrs = Array.isArray(d?.attributes)
      ? d.attributes.map((a: any) => `${a.name}: ${a.value_name}`).join("; ")
      : "";
    return [`Título: ${d?.title ?? ""}`, `Preço: R$ ${d?.price ?? "?"}`, `Ficha: ${attrs}`].join("\n").slice(0, 4000);
  } catch { return null; }
}

/* =================================================== o relógio da rodada */

/**
 * O WORKER MORRE AOS ~150s, e não há aviso. `WORKER_RESOURCE_LIMIT` não é uma
 * exceção que se possa pegar: o processo inteiro é derrubado, o `catch` do laço
 * não roda e a rodada some sem gravar nada — foi o que aconteceu às 13:54 de
 * 27/08/2026, com o relatório da execução ficando `terminado_em: null` para
 * sempre.
 *
 * Este é o prazo interno, com margem para ainda dar tempo de ESCREVER o que
 * aconteceu antes de a plataforma puxar o tapete. Relatório que não é gravado
 * não existe.
 */
const LIMITE_WORKER_MS = 135_000;

/**
 * O relógio da requisição inteira, e não de um alvo. Global de propósito: o
 * teto de 150s é do worker, não do laço — passar o `t0` por seis assinaturas
 * até chegar no `firecrawl` só espalharia o mesmo número.
 */
let fimDaRodada = Number.POSITIVE_INFINITY;
const sobramMs = () => fimDaRodada - Date.now();

/**
 * O TETO DA CHAMADA DE IA, descontando o que a rodada ainda precisa para
 * GRAVAR o que apurou. `null` = nem vale tentar.
 *
 * A primeira versão usava `Math.max(5_000, …)`, e o piso era a armadilha: com a
 * rodada em 120s, a IA ganhava um prazo de 5 SEGUNDOS e falhava — gastando um
 * crédito de raspagem para produzir "não respondeu em 5s". Prazo impossível não
 * é prazo, é desperdício com aparência de tentativa. Abaixo do mínimo honesto a
 * resposta certa é não chamar e dizer por quê.
 */
/**
 * O teto de UMA chamada de IA existe porque `generateJSON` não tem nenhum.
 * Seis extrações correm em paralelo na varredura; basta UMA travar para o
 * `Promise.all` nunca resolver e o worker ser morto aos 150s, levando junto as
 * cinco que já tinham respondido. Melhor perder uma fonte, dizendo qual, do que
 * a rodada.
 */
const TETO_IA_MS = 45_000;
const RESERVA_PARA_GRAVAR_MS = 15_000;
const MINIMO_DE_IA_MS = 15_000;

/**
 * QUANTO A PRIMEIRA TENTATIVA DE EXTRAÇÃO GANHA DO TETO — e o resto fica para a
 * segunda. As duas somadas continuam cabendo em `TETO_IA_MS`: a retentativa
 * existe para usar melhor o mesmo relógio, não para pedir mais.
 *
 * Ver `extrairDaLoja` para o porquê de 25s. Em resumo: a chamada que chega aos
 * 45s está morta, não lenta — as rodadas boas fecham em 36-41s com a raspagem
 * dentro. O log de duração de cada chamada existe para corrigir este número com
 * medida em vez de inferência.
 */
const IA_PRIMEIRA_MS = 25_000;

/** Abaixo disto a segunda tentativa é o mesmo "prazo impossível" de `prazoDeIA`. */
const IA_SEGUNDA_MINIMA_MS = 12_000;

/**
 * VALE A PENA REPETIR ESTA FALHA DE IA?
 *
 * Só o que volta diferente na segunda vez: o modelo ocupado (503, 429) e o
 * nosso próprio estouro de prazo. Erro de schema, de chave ou de payload
 * repetiria idêntico — insistir queimaria a segunda metade do prazo para
 * receber a mesma resposta e, pior, faria a mensagem final dizer "falhou nas 2
 * tentativas" sobre um defeito que não tinha nada de intermitente.
 */
const ehPassageiroIA = (cru: string) =>
  /não respondeu em/.test(cru) ||
  /high demand|UNAVAILABLE|\b503\b/i.test(cru) ||
  /\b429\b|quota|rate limit/i.test(cru) ||
  /error sending request|connection|ECONNRESET|network/i.test(cru);

/**
 * DUAS CHANCES DENTRO DE UM ORÇAMENTO SÓ.
 *
 * A página já foi raspada e o crédito já foi debitado quando a IA falha —
 * retentar não custa Firecrawl nenhum, custa tempo, e tempo aqui é a vida do
 * worker. Por isso o total NÃO cresce: `prazo` é o mesmo teto de sempre e as
 * duas tentativas o dividem. Esticar comeria a margem que existe para a rodada
 * conseguir GRAVAR o que apurou, que é o pior defeito conhecido deste módulo.
 *
 * MEDIDO EM 29/08/2026, com o log que esta função escreve: as leituras que dão
 * certo fecham em 10,5 a 18,5s, e o Gemini sobrecarregado devolve 503 em ~10s.
 * A chamada que chega aos 25s quase nunca está lenta — está morta, e o resto do
 * prazo é espera pura. Trocar uma espera longa por duas curtas é o mesmo relógio
 * comprando o dobro de tentativas.
 *
 * Existe como função porque são DOIS chamadores — a extração da vitrine e a
 * sugestão de busca. Duas cópias divergiriam no primeiro ajuste de limiar, e o
 * sintoma seria uma delas continuar esperando 45s em silêncio.
 */
async function duasChancesDeIA<T>(
  chamar: (ms: number) => Promise<T>,
  prazo: number,
  rotulo: string,
): Promise<{ ok: true; valor: T } | { ok: false; cru: string; tentativas: number }> {
  const inicio = Date.now();
  let cru = "";
  let tentativas = 0;

  for (const n of [1, 2]) {
    /* A segunda só existe se sobrar do MESMO prazo — e o `prazoDeIA()` é
       consultado de novo porque o relógio da rodada andou enquanto a primeira
       esperava. Prazo impossível não é prazo: abaixo do mínimo honesto,
       ninguém chama. */
    const ms = n === 1
      ? Math.min(IA_PRIMEIRA_MS, prazo)
      : Math.min(prazo - (Date.now() - inicio), prazoDeIA() ?? 0);
    if (n === 2 && ms < IA_SEGUNDA_MINIMA_MS) break;

    const t1 = Date.now();
    tentativas = n;
    try {
      const valor = await chamar(ms);
      console.log(`${rotulo} ok ${((Date.now() - t1) / 1000).toFixed(1)}s${n > 1 ? " (2ª tentativa)" : ""}`);
      return { ok: true, valor };
    } catch (e) {
      cru = String((e as any)?.detail ?? (e as Error)?.message ?? e);
      console.log(`${rotulo} falhou ${((Date.now() - t1) / 1000).toFixed(1)}s (tentativa ${n}): ${cru.slice(0, 100)}`);
      /* SÓ SE REPETE O QUE VOLTA DIFERENTE. Timeout, 503 e 429 são o Gemini
         ocupado — a mesma chamada, segundos depois, costuma passar. Erro de
         schema ou de chave repetiria idêntico, e insistir seria gastar a
         segunda metade do prazo para receber a mesma resposta. Mesma regra do
         `ehPassageiro` do lado do Firecrawl. */
      if (n === 1 && !ehPassageiroIA(cru)) break;
    }
  }
  return { ok: false, cru, tentativas };
}
function prazoDeIA(): number | null {
  const util = sobramMs() - RESERVA_PARA_GRAVAR_MS;
  return util < MINIMO_DE_IA_MS ? null : Math.min(TETO_IA_MS, util);
}

/**
 * QUANTAS OFERTAS ÚTEIS CADA FONTE TROUXE NOS ÚLTIMOS 14 DIAS.
 *
 * Global e carregado uma vez por requisição porque a ordem das fontes é a mesma
 * para todos os alvos da rodada — pedir a medição dentro de `varrerAlvo` faria
 * uma consulta por alvo para receber a mesma resposta.
 *
 * Vazio é um estado legítimo: banco novo, ou a RPC ainda não aplicada. Nesse
 * caso todo mundo cai na prioridade escrita, que é exatamente o comportamento
 * anterior — a medição melhora a ordem, não é pré-requisito para varrer.
 */
let rendimento = new Map<string, number>();

async function carregarRendimento(supabase: any): Promise<void> {
  rendimento = new Map();
  const { data, error } = await supabase.rpc("facilities_radar_rendimento", { p_dias: 14 });
  if (error) { console.warn("rendimento das fontes não lido:", error.message); return; }
  for (const l of data ?? []) rendimento.set(String(l.fonte), Number(l.uteis ?? 0));
}

/** Promessa com prazo. O que estoura vira erro NOMEADO, não silêncio. */
function comPrazo<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${oque} não respondeu em ${Math.round(ms / 1000)}s`)), ms); }),
  ]);
}

/* ================================================================ Firecrawl */

/**
 * ORDENAR POR PREÇO SÓ VALE ONDE HÁ PISO. Foi medido, não chutado — mesma busca
 * na Kabum, mesmo alvo, em 26/08/2026:
 *   • relevância   → 36 anúncios, 33 recusados por passar do teto;
 *   • `sort=price` → 46 anúncios, **42 recusados por nem serem notebook**.
 *
 * Ordenar do mais barato entrega a página das capas, cabos e pentes de memória
 * que casam com as palavras da busca. Como a raspagem só lê a PRIMEIRA página,
 * ordenar por preço sem piso é escolher ler a página do lixo.
 *
 * Onde a loja aceita FAIXA de preço na URL, o dilema some: o piso corta o
 * acessório e a ordenação crescente passa a entregar o que se quer. Só o
 * Mercado Livre aceita (`_PriceRange_750-3000_OrderId_PRICE`) — e é justamente
 * o que está bloqueado.
 *
 * TODAS AS OUTRAS FICAM NA ORDENAÇÃO PADRÃO, e isso é escolha, não desleixo.
 * Tentei o `p_36` da Amazon: a página voltou com ZERO anúncio e nenhum erro.
 * Parâmetro chutado que não existe não dá 404 — dá página vazia, que na tela
 * vira "não achei nada hoje" em vez de "a URL está errada". Falhar em silêncio
 * é pior que não filtrar, então parâmetro que eu não consigo verificar sai.
 */
const LOJAS: Record<string, {
  nome: string;
  busca: (t: string, piso: number, teto: number) => string;
  waitFor?: number;
  /** Reputação assumida da fonte, 0..1. `null` = marketplace, o vendedor varia. */
  reputacao: number | null;
  /**
   * Ordem de consulta INICIAL. Menor primeiro. É só a semente: a ordem de verdade
   * vem do rendimento medido (`facilities_radar_rendimento`), e esta prioridade
   * decide entre fontes que ainda não têm histórico — quem nunca foi lida não
   * pode ficar em último para sempre só por isso.
   */
  prioridade: number;
  /**
   * A QUEM ESTA FONTE PERTENCE. Fontes da mesma família servem o mesmo estoque, e
   * só uma entra por rodada.
   *
   * Buscapé, Zoom e Bondfaro são a mesma empresa: em 27/08/2026 as três
   * devolveram as MESMAS três ofertas úteis, cada uma cobrando seu crédito. Três
   * vagas fixas para um estoque só, seis rodadas por dia, dois alvos: ~700
   * créditos por mês em duplicata.
   *
   * Uma por rodada, e girando: se hoje o Zoom estiver fora do ar, amanhã é a vez
   * do Buscapé. Manter as três cadastradas não é desperdício — é o revezamento
   * que sobrevive à queda de uma delas.
   */
  familia?: string;
}> = {
  /* --- medidas e trazendo resultado (26/08/2026) --- */
  kabum:    { prioridade: 1, nome: "Kabum",    reputacao: 0.9, waitFor: 3000, busca: (t) => `https://www.kabum.com.br/busca/${encodeURIComponent(t)}` },
  terabyte: { prioridade: 2, nome: "Terabyte", reputacao: 0.9, waitFor: 2500, busca: (t) => `https://www.terabyteshop.com.br/busca?str=${encodeURIComponent(t)}` },

  /* --- agregadores: cobrem muita loja de uma vez, e o link leva ao comparador,
         não à loja. Quem compra escolhe a loja lá dentro. --- */
  zoom:     { prioridade: 3, familia: "zoom", nome: "Zoom",     reputacao: null, waitFor: 4000, busca: (t) => `https://www.zoom.com.br/search?q=${encodeURIComponent(t)}` },
  buscape:  { prioridade: 4, familia: "zoom", nome: "Buscapé",  reputacao: null, waitFor: 4000, busca: (t) => `https://www.buscape.com.br/search?q=${encodeURIComponent(t)}` },
  bondfaro: { prioridade: 5, familia: "zoom", nome: "Bondfaro", reputacao: null, waitFor: 4000, busca: (t) => `https://www.bondfaro.com.br/search?q=${encodeURIComponent(t)}` },

  /* --- candidatas: entram na roda para serem MEDIDAS, não porque eu suponho
         que funcionam. A que vier vazia diz isso no card e sai da lista
         padrão. Lojas de TI primeiro, porque é onde o Facilities compra. --- */
  pichau:      { prioridade: 6,  nome: "Pichau",       reputacao: 0.9,  waitFor: 3000, busca: (t) => `https://www.pichau.com.br/search?q=${encodeURIComponent(t)}` },
  balao:       { prioridade: 7,  nome: "Balão da Informática", reputacao: 0.85, waitFor: 3000, busca: (t) => `https://www.balaodainformatica.com.br/busca?q=${encodeURIComponent(t)}` },
  americanas:  { prioridade: 8,  nome: "Americanas",   reputacao: 0.8,  waitFor: 3500, busca: (t) => `https://www.americanas.com.br/busca/${encodeURIComponent(t)}` },
  casasbahia:  { prioridade: 9,  nome: "Casas Bahia",  reputacao: 0.8,  waitFor: 3500, busca: (t) => `https://www.casasbahia.com.br/${encodeURIComponent(t).replace(/%20/g, "-")}/b` },
  carrefour:   { prioridade: 10, nome: "Carrefour",    reputacao: 0.8,  waitFor: 3500, busca: (t) => `https://www.carrefour.com.br/busca/${encodeURIComponent(t)}` },
  fastshop:    { prioridade: 11, nome: "Fast Shop",    reputacao: 0.85, waitFor: 3500, busca: (t) => `https://site.fastshop.com.br/web/busca?searchTerm=${encodeURIComponent(t)}` },

  /* --- abriram a página e não renderam nada; ficam por último para não comerem
         o relógio das que funcionam --- */
  // Sem o filtro `p_36`: com ele a Amazon devolveu ZERO anúncio e nenhum erro.
  // Sem ele também. É bloqueio de robô, não parâmetro errado.
  amazon: { prioridade: 90, nome: "Amazon", reputacao: 0.85, waitFor: 3000, busca: (t) => `https://www.amazon.com.br/s?k=${encodeURIComponent(t)}` },
  magalu: { prioridade: 91, nome: "Magalu", reputacao: 0.85, waitFor: 3000, busca: (t) => `https://www.magazineluiza.com.br/busca/${encodeURIComponent(t)}/` },

  // A lista pública do ML é o que sobrou depois de a API de busca fechar (403) —
  // e ela também barra robô. A URL está certa (o `_NoIndex_True` evita a página
  // canônica de categoria); fica pronta para o dia em que der para passar.
  mercado_livre: {
    prioridade: 92, nome: "Mercado Livre", reputacao: null, waitFor: 3500,
    busca: (t, piso, teto) =>
      `https://lista.mercadolivre.com.br/${encodeURIComponent(t).replace(/%20/g, "-")}` +
      `_PriceRange_${Math.round(piso)}-${Math.round(teto)}_OrderId_PRICE_NoIndex_True`,
  },
};

/**
 * `proxy: "auto"` NÃO É ENFEITE. Mercado Livre e Amazon derrubam raspagem
 * simples — um GET direto na lista do ML responde 302 para uma página de
 * "verificação de conta" (conferido no curl em 26/08/2026). No modo auto o
 * Firecrawl tenta o caminho barato e só repete em stealth se apanhar, que é o
 * equilíbrio certo entre custo e chegar lá.
 *
 * E o erro sai COM O CORPO da resposta: "Firecrawl HTTP 500" pelado não diz se
 * a URL está malformada, se o site bloqueou ou se o crédito acabou — três
 * problemas com três soluções diferentes.
 */
/**
 * O CEP do escritório. Sem ele, nenhuma loja brasileira mostra frete: todas
 * pedem "informe seu CEP" antes de calcular. É por isso que, até aqui, o frete
 * só aparecia quando era grátis e estava escrito na vitrine.
 */
const CEP_DESTINO = (Deno.env.get("RADAR_CEP") ?? "29050780").replace(/\D/g, "");

/**
 * Digitar o CEP na página, com UM seletor para todas as lojas.
 *
 * A tentação é escrever um seletor por loja — e é a decisão errada. Seriam nove
 * seletores para manter, cada um quebrando calado na primeira reforma de layout
 * do site, e o sintoma seria "frete não informado", que é indistinguível do
 * comportamento normal. Um seletor genérico com o casamento por atributo do CSS
 * (`i` = ignora maiúscula) pega o padrão que as lojas brasileiras repetem:
 * um input cujo id, nome ou placeholder tem "cep".
 *
 * Se não achar, a ação falha e a leitura é refeita sem ela — custa uma segunda
 * raspagem, e só nos poucos anúncios que chegam à confirmação.
 */
const ACOES_CEP = [
  { type: "wait", milliseconds: 1500 },
  { type: "click", selector: 'input[id*="cep" i], input[name*="cep" i], input[placeholder*="cep" i]' },
  { type: "write", text: CEP_DESTINO },
  { type: "press", key: "Enter" },
  { type: "wait", milliseconds: 3500 },
];

/**
 * TETO DA PÁGINA GUARDADA. Ninguém lê mais que 16 000 caracteres: é o que
 * `extrairDaLoja` manda para a IA, e a confirmação manda 14 000. O resto era
 * carregado, parseado e segurado na memória até o fim da rodada sem que uma
 * linha de código o olhasse — e a vitrine do Carrefour tem megabytes disso.
 *
 * 200 000 é folgado de propósito, não apertado: quem varre a página inteira é
 * o teste `temPreco` da confirmação, que existe para NÃO confundir anúncio
 * comprido com página de bloqueio de robô. Cortar em 16 000 economizaria mais
 * memória e faria o radar arquivar achado bom como "provável bloqueio".
 * 200 KB é 12× o que se lê e ainda assim uma fração do que vinha.
 */
const TETO_MARKDOWN = 200_000;

/**
 * O CACHE DO FIRECRAWL ESTAVA LIGADO SEM NINGUÉM SABER, E ISSO É VENENO NUM
 * RADAR DE PREÇO. O `POST /v2/scrape` sem `maxAge` devolve **versão cacheada de
 * até 2 dias** (172 800 000 ms é o default documentado) — e cobra o mesmo
 * crédito por ela. Ou seja: pagava-se preço cheio por preço velho.
 *
 * O estrago é maior na conferência que na varredura. Conferir estoque lendo uma
 * página guardada de anteontem é responder "dá para comprar" sobre um retrato
 * antigo: o produto pode ter esgotado ontem, e a resposta viria com toda a cara
 * de conferência. A reconferência de 24h herdaria o mesmo defeito e diria
 * "segue de pé" sem nunca tocar na loja.
 *
 * Então: conferência SEMPRE fresca (`0`), varredura com validade curta. O
 * crédito é o mesmo nos dois casos — o cache do Firecrawl acelera, não
 * economiza —, mas a leitura fresca é mais lenta e falha mais, e é por isso que
 * a varredura, que corre contra o relógio da rodada, aceita o dado do próprio
 * turno em vez de exigir o do segundo.
 */
const CACHE_BUSCA_MS = 4 * 3600 * 1000;

/**
 * QUANTAS RASPAGENS JÁ SE PEDIU NESTE ISOLATE. Não é o custo em créditos — o
 * Firecrawl cobra 1 por página, mas cobra 5 quando precisa do proxy stealth, e
 * cobra igual quando a página responde 403. Contar chamadas é o que dá para
 * fazer aqui dentro com honestidade; o custo REAL sai da diferença de saldo
 * (ação `saldo`), que é a única fonte que não depende de eu adivinhar a tabela
 * de preços de terceiros.
 *
 * E O CONTADOR É DO ISOLATE, NÃO DA REQUISIÇÃO — ler este número direto era um
 * defeito. O worker do Deno sobrevive entre chamadas (é a mesma razão pela qual
 * `fimDaRodada` precisa daquele `Math.min`), então a segunda rodada atendida
 * pelo mesmo processo somava as páginas da primeira. Isso ia para o relatório e,
 * pior, para o RAZÃO: a conferência não mede pelo saldo — registra o que pediu —,
 * e em 28/08/2026 gravou 6 créditos para dois anúncios cujo teto real era 4.
 * Razão furado é teto furado.
 *
 * Por isso quem lê o número lê a DIFERENÇA desde o início da própria requisição
 * (`raspagensAntes` no handler). Zerar aqui seria pior: com duas rodadas em voo
 * no mesmo isolate — o cron das 16:45 e um clique em "Varrer agora" —, a que
 * chegasse depois apagaria a contagem da que já estava correndo.
 */
let raspagens = 0;

async function firecrawlUmaVez(
  url: string,
  waitFor?: number,
  opts: { comCep?: boolean; fresco?: boolean } = {},
): Promise<{ markdown: string; erro: string | null }> {
  const key = Deno.env.get("CHAVE_API_FIRCRAWL") ?? Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return { markdown: "", erro: "CHAVE_API_FIRCRAWL não configurada" };
  const ctrl = new AbortController();
  /* O TETO DE ESPERA É POR TIPO DE LEITURA, e essa distinção custou uma
     varredura de 139s: subi o timeout para 90s por causa das ações do CEP e,
     como as fontes rodam em paralelo, a rodada inteira passou a poder esperar
     90s + extração. Busca é leitura simples e tem de ser rápida; só a
     confirmação com CEP — que digita e espera a loja recalcular — merece folga. */
  const t = setTimeout(() => ctrl.abort(), opts.comCep ? 75_000 : 45_000);
  raspagens++;
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        proxy: "auto",
        location: { country: "BR", languages: ["pt-BR"] },
        // Ver `CACHE_BUSCA_MS`: sem este campo o Firecrawl entrega página de
        // até 2 dias, cobrando crédito cheio por ela.
        maxAge: opts.fresco ? 0 : CACHE_BUSCA_MS,
        ...(waitFor ? { waitFor } : {}),
        ...(opts.comCep ? { actions: ACOES_CEP } : {}),
      }),
      signal: ctrl.signal,
    });
    /* CORPO DE ERRO É PEQUENO; CORPO DE SUCESSO É ENORME. Ler tudo com
       `r.text()` e depois `JSON.parse` mantinha a página INTEIRA viva duas
       vezes — a string crua e o objeto — e é isso que matou a rodada com
       WORKER_RESOURCE_LIMIT em 27/08/2026, quando o rodízio trouxe o Carrefour.
       No caminho bom vai direto a `r.json()`, que não faz a cópia. */
    if (!r.ok) {
      const txt = await r.text();
      const d = (() => { try { return JSON.parse(txt); } catch { return {} as any; } })();
      return { markdown: "", erro: `Firecrawl HTTP ${r.status} — ${String(d?.error ?? d?.message ?? txt).slice(0, 220)}` };
    }
    const d = await r.json().catch(() => ({} as any));
    const md = String(d?.data?.markdown ?? d?.markdown ?? "");
    return { markdown: md.length > TETO_MARKDOWN ? md.slice(0, TETO_MARKDOWN) : md, erro: null };
  } catch (e) {
    return { markdown: "", erro: String(e) };
  } finally { clearTimeout(t); }
}

/**
 * O SALDO DE CRÉDITOS, LIDO DA FONTE.
 *
 * A conta de quanto o radar custa não pode ser feita de cabeça: a página vale
 * 1 crédito, mas 5 quando o Firecrawl precisa do proxy stealth para passar do
 * muro anti-robô, e é cobrada igual quando o site responde 403. Com o projeto
 * no plano gratuito, "acho que dá" é a diferença entre o radar funcionar até o
 * fim do mês e ficar mudo no dia 12 — mudo do jeito pior, com cara de "não achei
 * promoção hoje".
 *
 * A consulta não gasta crédito. Lida antes e depois da rodada, a diferença é o
 * custo REAL dela, sem depender de eu adivinhar a tabela de preços.
 */
/* A implementação mudou de casa: `_shared/firecrawl.ts`. Estava aqui quando o
   radar era o único a gastar; com cinco consumidores, duas cópias divergiriam na
   primeira vez que a API mudasse o nome de um campo — e o sintoma seria um saldo
   certo numa tela e errado na outra. O comentário acima fica: a razão de existir
   é a mesma, e é ela que se perde numa mudança de arquivo. */

/**
 * SOLUÇO DO FIRECRAWL NÃO É FONTE QUEBRADA. Em 27/08/2026 a Terabyte voltou
 * `HTTP 500 — An unexpected error occurred (...) exception ID` e sumiu da
 * rodada; a MESMA URL, refeita minutos depois, devolveu 11 anúncios. O site
 * estava de pé o tempo todo (GET direto: 200, 640 KB) — quem tossiu foi o
 * Firecrawl.
 *
 * Sem retentar, dois segundos de soluço apagam a fonte da varredura inteira e
 * deixam o card amarelo até a próxima rodada. E a Terabyte é FIXA (prioridade
 * 2, consultada sempre), então o amarelo vira paisagem e o aviso perde o
 * sentido — que é exatamente o que `ultimo_erro` existe para evitar.
 *
 * RETENTA SÓ O QUE VOLTA RÁPIDO: 5xx, 429 e falha de rede. O timeout (o abort
 * dos 45s) fica de fora DE PROPÓSITO — já comeu o relógio uma vez, e repetir
 * custaria a rodada das outras fontes, que correm em paralelo com esta.
 *
 * Uma tentativa extra, não três: se a segunda também falha, o problema não é
 * soluço, e insistir só queima crédito e orçamento de tempo.
 */
const ehPassageiro = (erro: string) =>
  /Firecrawl HTTP (5\d\d|429)/.test(erro) ||
  (/error sending request|connection|ECONNRESET|network/i.test(erro) && !/AbortError/i.test(erro));

async function firecrawl(
  url: string,
  waitFor?: number,
  opts: { comCep?: boolean; fresco?: boolean } = {},
): Promise<{ markdown: string; erro: string | null }> {
  const primeira = await firecrawlUmaVez(url, waitFor, opts);
  if (!primeira.erro || !ehPassageiro(primeira.erro)) return primeira;

  /* RETENTAR SÓ SE HOUVER RELÓGIO. A segunda tentativa custa até 45s, e o
     worker morre aos 150s levando a rodada inteira — as outras cinco fontes
     junto. Sem margem, a resposta honesta é registrar a falha e seguir. */
  if (sobramMs() < 55_000) return { ...primeira, erro: `${primeira.erro} (sem tempo na rodada para tentar de novo)` };

  await new Promise((ok) => setTimeout(ok, 2500));
  const segunda = await firecrawlUmaVez(url, waitFor, opts);
  if (!segunda.erro) return segunda;

  /* A mensagem diz que foram DUAS tentativas. "Firecrawl HTTP 500" pelado, na
     tela, é indistinguível de um tropeço isolado — e a diferença entre "caiu
     uma vez" e "está caindo" é o que decide se alguém precisa ir olhar. */
  return { markdown: "", erro: `${segunda.erro} (falhou nas 2 tentativas)` };
}

const SCHEMA_ANUNCIOS = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          preco: { type: "number", description: "Preço à vista em reais, só o número" },
          url: { type: "string", description: "Link absoluto do produto" },
          imagem_url: { type: "string", description: "Link absoluto da FOTO do produto. Ignore ícones, logos e banners." },
          avaliacao: { type: "number", description: "Nota do produto de 0 a 5, se a página mostrar" },
          avaliacoes: { type: "number", description: "Quantas pessoas avaliaram, se a página mostrar" },
          disponivel: { type: "boolean", description: "false SÓ se a página disser que está esgotado/indisponível. Omita se não falar." },
          frete_gratis: { type: "boolean", description: "true SÓ se a página disser frete grátis. Omita se não falar." },
          frete_valor: { type: "number", description: "Valor do frete em reais, se a página mostrar um número. Omita se não mostrar." },
          frete_texto: { type: "string", description: "O que a página escreveu sobre frete, literalmente" },
        },
        required: ["titulo", "preco"],
      },
    },
  },
  required: ["itens"],
};

/** O que se lê ABRINDO o anúncio: é aqui que estoque e frete costumam aparecer. */
const SCHEMA_CONFIRMACAO = {
  type: "object",
  properties: {
    disponivel: { type: "boolean", description: "O produto pode ser comprado agora? false se houver 'esgotado', 'indisponível', 'avise-me quando chegar'." },
    preco: { type: "number", description: "Preço à vista/PIX atual em reais" },
    frete_gratis: { type: "boolean" },
    frete_valor: { type: "number", description: "Valor do frete em reais, se a página mostrar. Omita se exigir CEP e não houver número na tela." },
    frete_texto: { type: "string", description: "O que a página diz sobre frete, literalmente" },
    avaliacao: { type: "number", description: "Nota do produto de 0 a 5, se a página mostrar" },
    avaliacoes: { type: "number", description: "Quantas pessoas avaliaram" },
    imagem_url: { type: "string", description: "Link absoluto da foto principal do produto" },
    observacao: { type: "string", description: "Algo que desaconselhe a compra (pré-venda, entrega em 30 dias, vendedor sem reputação)" },
    /* A FICHA VEM COMO TEXTO, DE PROPÓSITO — e essa escolha é a linha que o
       módulo não cruza. Pedir `ram_gb: number` faria a IA decidir se o anúncio
       é aprovado, porque é esse número que o `avaliar` compara com o pedido.
       Pedindo o texto, quem extrai o número continua sendo o `lerSpecs`, a
       mesma função testada que já lê o título — a IA só entrega mais texto para
       ela ler. Erro de transcrição vira erro de cópia, visível ao lado do que
       foi copiado, em vez de virar uma recusa sem apelação. */
    ficha: {
      type: "string",
      description:
        "A ficha técnica do produto COMO A PÁGINA ESCREVEU, em uma linha " +
        "(ex: 'Intel Core i5-13420H, 16GB DDR4, SSD 512GB, 15.6\" Full HD'). " +
        "Copie, não interprete. Omita se a página não trouxer ficha.",
    },
    reclamacoes: {
      type: "string",
      description:
        "Se a página mostrar avaliações escritas por compradores, resuma em UMA frase " +
        "curta o que eles CRITICAM (ex: 'citam tela escura e fonte que esquenta'). " +
        "Só o que estiver escrito nas avaliações. Omita se não houver avaliação escrita " +
        "ou se não houver crítica.",
    },
    porque_barato: {
      type: "string",
      description:
        "PREENCHA SOMENTE SE A PERGUNTA FOR FEITA na mensagem. O que a PÁGINA diz que " +
        "explica o preço abaixo do normal: garantia curta do vendedor, produto de vitrine/" +
        "recondicionado, versão ou configuração diferente, vendedor de marketplace sem " +
        "reputação, entrega demorada. Uma frase. Se a página não der motivo, omita — " +
        "não deduza.",
    },
  },
  required: ["disponivel"],
};

/**
 * UM ANÚNCIO COMO QUALQUER LEITOR O ENTREGA — cru, antes das nossas regras.
 *
 * É o CONTRATO entre quem lê a vitrine e o resto do radar, e existe como tipo
 * próprio porque em breve haverá dois leitores: a IA sobre markdown (hoje) e o
 * seletor CSS no servidor de raspagem (a partir da VPS). Os campos são os do
 * `SCHEMA_ANUNCIOS`, e a regra de preenchimento é a mesma para os dois — campo
 * ausente é "não sei", nunca "não".
 */
interface ItemLido {
  titulo: string;
  preco: number;
  url?: string;
  imagem_url?: string;
  avaliacao?: number;
  avaliacoes?: number;
  disponivel?: boolean;
  frete_gratis?: boolean;
  frete_valor?: number;
  frete_texto?: string;
}

/**
 * O QUE O LEITOR ENTREGA VIRA `OfertaBruta` AQUI, E SÓ AQUI.
 *
 * Estas quarenta linhas são a parte cara de acertar: os três degraus da
 * identidade do anúncio (que viram a chave do `upsert` e, por tabela, todo o
 * histórico de preço), a resolução de URL relativa da foto, e o cruzamento de
 * disponibilidade em que a regra vence a IA no lado do "não". Nada disso tem a
 * ver com QUEM leu a página.
 *
 * Vive separada da chamada de IA de propósito, e a razão é a do
 * `_shared/folha-envio.ts` no CLAUDE.md: quando a leitura por seletor chegar,
 * ela vai precisar destas mesmas regras. Se elas estivessem dentro de
 * `extrairDaLoja`, o segundo leitor nasceria com uma cópia — e a cópia diverge
 * na primeira vez que alguém corrigir um dos dois. O sintoma não seria erro de
 * build: seria o `id_externo` saindo diferente entre os leitores, cada rodada
 * criando "anúncio novo" para o mesmo produto e o histórico de preço quebrando
 * em duas metades — sem uma linha vermelha em lugar nenhum.
 */
function montarOfertas(itens: ItemLido[], baseUrl: string, loja: string): OfertaBruta[] {
  return itens
    .filter((i) => i?.titulo && Number(i.preco) > 0)
    .map((i): OfertaBruta => {
      let url = i.url || baseUrl;
      try { url = new URL(url, baseUrl).toString(); } catch { /* fica o que veio */ }
      /* A IDENTIDADE DO ANÚNCIO, EM TRÊS DEGRAUS — e o terceiro degrau não é
         luxo. No ML o id (MLB…) vence, porque o link ganha parâmetros de
         rastreio que mudam toda hora e virariam anúncio "novo" a cada
         varredura, estourando o histórico de preço.
         Quando a extração NÃO acha o link do produto (comum nos agregadores,
         que escondem a URL atrás de redirecionador), o fallback era a URL da
         BUSCA — a mesma para todos. Resultado medido: Zoom 24 + Buscapé 30 =
         54 anúncios que viraram 22, porque cada um sobrescrevia o anterior no
         mapa. O título normalizado é estável entre rodadas e distingue os
         produtos, que é exatamente o que a chave precisa fazer. */
      const mlb = url.match(/\bMLB-?(\d{6,})/i);
      const temLinkProprio = !!i.url && url.split("?")[0] !== baseUrl.split("?")[0];
      return {
        fonte: loja,
        id_externo: mlb
          ? `MLB${mlb[1]}`
          : temLinkProprio
            ? url.split("?")[0].slice(0, 300)
            : `t:${norm(String(i.titulo)).slice(0, 160)}`,
        titulo: String(i.titulo),
        url,
        /* A foto vem resolvida contra a URL da busca porque metade das lojas
           devolve caminho relativo, e `<img src="/img/x.jpg">` na tela do Hub
           não carrega nada — quebraria em silêncio, com o alt vazio. */
        imagem_url: i.imagem_url ? (() => { try { return new URL(i.imagem_url!, baseUrl).toString(); } catch { return null; } })() : null,
        preco: Number(i.preco),
        avaliacao: typeof i.avaliacao === "number" && i.avaliacao > 0 && i.avaliacao <= 5 ? i.avaliacao : null,
        avaliacoes: typeof i.avaliacoes === "number" && i.avaliacoes > 0 ? Math.round(i.avaliacoes) : null,
        vendedor: LOJAS[loja]?.nome ?? loja,
        reputacao: LOJAS[loja]?.reputacao ?? null,
        condicao: condicaoDoTitulo(String(i.titulo)),
        /* `disponibilidade` cruza o que o leitor entregou com as palavras do
           próprio título. A regra vence o leitor no lado do "não": se o título
           grita ESGOTADO, não importa que a extração tenha dito que estava tudo
           bem. */
        disponivel: disponibilidade(String(i.titulo), i.frete_texto ?? null, i.disponivel ?? null),
        frete_gratis: i.frete_gratis ?? null,
        frete_valor: typeof i.frete_valor === "number" ? i.frete_valor : null,
        frete_texto: i.frete_texto ?? null,
      };
    });
}

/**
 * A página de busca da loja vira lista de anúncios. Só isto é IA aqui: extrair
 * título/preço/link de markdown. Se o produto SERVE, quem decide é a regra —
 * a IA nem recebe as specs pedidas, de propósito, para não ser tentada a
 * "ajudar" aprovando algo que não bate.
 */
/**
 * O RESULTADO CARREGA O MOTIVO. Devolver só `OfertaBruta[]` fazia a falha da IA
 * virar lista vazia, e lista vazia virava, na tela do alvo, "0 anúncios — a
 * página abriu mas nada foi extraído (conferir a busca desta fonte)".
 *
 * Isso é uma mentira com cara de diagnóstico: em 27/08/2026 o Gemini devolveu
 * `503 — This model is currently experiencing high demand` para a Kabum e para
 * o Zoom, e a mensagem mandou conferir a URL de busca das duas lojas, que
 * estavam perfeitas. Quem fosse atrás perderia a tarde mexendo no lugar errado.
 * Raspagem vazia e IA fora do ar são problemas diferentes e têm de se parecer
 * diferentes.
 */
async function extrairDaLoja(markdown: string, baseUrl: string, loja: string): Promise<{ ofertas: OfertaBruta[]; erro: string | null }> {
  /* PÁGINA QUE VEIO VAZIA NÃO É "A LOJA NÃO TEM NADA". São 100 caracteres: nem
     o cabeçalho de uma vitrine cabe aí. É muro de robô, erro de rota ou leitura
     truncada — e antes isto devolvia `erro: null`, que lá na frente virava
     "0 anúncios" e passava por leitura limpa. Ver o comentário do `nota` na
     varredura: leitura limpa AUTORIZA desativar as ofertas daquela fonte. */
  if (!markdown || markdown.length < 100) {
    return { ofertas: [], erro: "a página voltou praticamente vazia — provável bloqueio de robô, não vitrine sem produto" };
  }
  const prazo = prazoDeIA();
  if (prazo == null) return { ofertas: [], erro: "a página foi lida, mas não sobrou tempo na rodada para a IA extrair — a fonte entra de novo na próxima" };
  const trecho = markdown.length > 16000 ? markdown.slice(0, 16000) : markdown;

  const chamar = (ms: number) => comPrazo(generateJSON<{ itens: ItemLido[] }>({
      /* O MODELO LEVE, e isto é medição, não economia de estilo. O padrão
         (`gemini-3.6-flash`) leva ~50s para transcrever UMA vitrine de 16 000
         caracteres — medido em 27/08/2026 numa rodada de fonte única, e sem
         nenhum 503 nos logs: é a latência normal dele para este trabalho.
         Com seis fontes em paralelo isso encosta nos 150s do worker, e foi o
         que matou a varredura o dia inteiro.
         O trabalho aqui é COPIAR título, preço e link para um schema fechado.
         Quem decide se o produto serve é `avaliar`, em TypeScript, que nem vê
         o modelo. Modelo mais forte não melhora cópia — só demora mais. */
      model: MODELO_LITE,
      messages: [
        {
          role: "system",
          content:
            "Você extrai produtos de uma página de resultados de busca de loja brasileira. " +
            "Retorne SOMENTE produtos com preço visível. Ignore banners, categorias, filtros, " +
            "'produtos vistos recentemente' e sugestões. O preço é o à vista/PIX em reais. " +
            "Se não houver produtos, retorne lista vazia.\n" +
            "NUNCA CHUTE disponibilidade nem frete: preencha `disponivel` e os campos de frete " +
            "SOMENTE quando a página disser. Omitir é o certo quando ela não diz — quem lê a sua " +
            "resposta trata campo ausente como 'não sei' e vai conferir, mas trata um `true` " +
            "inventado como fato.",
        },
        { role: "user", content: `Loja: ${loja}\nURL base: ${baseUrl}\n\n${trecho}` },
      ],
      responseSchema: SCHEMA_ANUNCIOS,
      temperature: 0.1,
      /* COPIAR A VITRINE PARA UM SCHEMA FECHADO É LEITURA, NÃO DELIBERAÇÃO —
         e sem pedir nada o modelo raciocina no nível ALTO, que é o padrão dele.
         Esse raciocínio era a maior fatia do tempo de cada fonte, e ia inteiro
         para o lixo: `extractTextFromResponse` descarta as partes `thought`.
         Com seis fontes em paralelo o custo virava rodada morta — em 27/08/2026
         cinco das seis estouraram os 45s de prazo e a varredura voltou vazia.
         Se um dia a extração começar a errar preço ou título, é aqui que se
         volta para "high". */
      thinking: "low",
    }), ms, "a leitura da página pela IA");

  /* DUAS CHANCES DENTRO DO MESMO RELÓGIO, e o "dentro" é a decisão inteira.
     A página já foi raspada e o crédito já foi debitado quando a IA falha — em
     29/08/2026 uma rodada pagou cinco créditos e voltou com zero anúncio,
     porque as cinco chamadas estouraram os 45s. Retentar não custa Firecrawl
     nenhum; custa tempo, e tempo aqui é a vida do worker.
     Por isso o orçamento total NÃO cresce: `prazo` continua sendo o mesmo teto
     de antes, e as duas tentativas o dividem. Esticar para 45+45 daria mais
     chance de salvar e comeria a margem que existe para a rodada conseguir
     GRAVAR o que apurou — que é o defeito de 27/08, o pior deste módulo.

     POR QUE 25s NA PRIMEIRA. As rodadas em que as cinco fontes deram certo
     fecharam em 36-41s COM a raspagem dentro (~12s), o que põe a extração boa
     na casa dos 20-25s. A chamada que chega aos 45s quase nunca está lenta —
     está morta, e o que resta do prazo é espera pura. Trocar uma espera longa
     por duas curtas é o mesmo relógio comprando o dobro de tentativas.
     É inferência a partir da duração das rodadas, não medição direta: por isso
     cada chamada agora registra quanto levou, e o número corrige este 25s. */
  const r = await duasChancesDeIA(chamar, prazo, `extração ${loja}`);
  if (r.ok) {
    const itens = Array.isArray(r.valor?.itens) ? r.valor.itens : [];
    return { ofertas: montarOfertas(itens, baseUrl, loja), erro: null };
  }
  const { cru, tentativas } = r;

  console.error("extrairDaLoja", loja, cru);
  /* `503 — high demand` e `429` são o Gemini sobrecarregado, não a loja. A
     distinção vai para a tela porque muda o que se faz: com a loja não há o
     que fazer; com a IA, é esperar a próxima rodada. */
  const motivo = /high demand|UNAVAILABLE|\b503\b/i.test(cru) ? "a IA estava sobrecarregada"
    : /\b429\b|quota|rate limit/i.test(cru) ? "a IA recusou por excesso de chamadas"
    : /não respondeu em/.test(cru) ? cru
    : `a IA falhou (${cru.slice(0, 80)})`;
  /* "falhou nas 2 tentativas" muda o que a frase significa: uma vez é tropeço,
     duas é a IA fora do ar. Mesma razão do aviso gêmeo no `firecrawl`. */
  const quantas = tentativas > 1 ? " (falhou nas 2 tentativas)" : "";
  return { ofertas: [], erro: `a página foi lida, mas ${motivo}${quantas} — a fonte entra de novo na próxima rodada` };
}

/* ============================================== confirmação no próprio anúncio */

export interface Confirmacao {
  /** A loja de verdade por trás do link do agregador ("Magazine Luiza"), quando dá para saber. */
  loja?: string | null;
  disponivel: boolean | null;
  preco: number | null;
  frete_valor: number | null;
  frete_texto: string | null;
  avaliacao: number | null;
  avaliacoes: number | null;
  imagem_url: string | null;
  observacao: string | null;
  /** A ficha técnica como a página escreveu. INSUMO do `lerSpecs`, não veredito. */
  ficha: string | null;
  /** O que os compradores criticam, lido das avaliações escritas. */
  reclamacoes: string | null;
  /** O que a página diz que explica o preço baixo. Só vem quando a pergunta foi feita. */
  porque_barato: string | null;
  erro: string | null;
}

/**
 * Abre O ANÚNCIO (não a busca) e confere o que a página de resultados quase
 * nunca conta: se tem estoque e quanto custa o frete.
 *
 * POR QUE NÃO DÁ PARA CONFIAR NA PÁGINA DE BUSCA. Ela mostra o produto mesmo
 * esgotado, e mostra o ÚLTIMO PREÇO PRATICADO — que fica bonito justamente por
 * não estar mais à venda. Um radar que avisa a partir da busca vai, mais cedo ou
 * mais tarde, mandar a pessoa correr atrás de um preço que não existe mais.
 * Da segunda vez que isso acontecer, ela para de abrir os links.
 *
 * POR QUE SÓ NOS FINALISTAS. Confirmar os 76 candidatos de uma rodada seriam 76
 * créditos de Firecrawl e 76 chamadas de IA por alvo, por dia. Confirmar os três
 * que virariam aviso custa três — e são exatamente os três em que alguém vai
 * clicar. Filtro barato em tudo, conferência cara só no que vira ação.
 *
 * SOBRE O FRETE: o que dá para ler é o que a página DECLARA ("frete grátis",
 * "frete a partir de R$ 24,90"). Loja que só calcula frete depois de digitar o
 * CEP não entrega número nenhum para uma leitura de página, e nesse caso o
 * campo fica null e a tela diz "frete não informado". Preferir isso a inventar
 * um zero.
 */
/**
 * O link do agregador não é o anúncio: é um redirecionador de clique.
 *
 * Buscapé, Zoom e Bondfaro apontam para `/lead?oid=1578116400&channel=86&...`,
 * que só existe para contar o clique e mandar a pessoa à loja. O Firecrawl não
 * raspa isso — "All scraping engines failed" — e o resultado, na medição de
 * 26/08/2026, era que TODO achado dos três agregadores ficava preso na
 * quarentena para sempre e nunca chegava à tela. Justamente as três fontes de
 * maior volume.
 *
 * Seguir o redirecionamento é barato (não gasta crédito de Firecrawl) e resolve
 * duas coisas de uma vez: dá uma página de loja que dá para conferir, e faz o
 * aviso apontar para a loja de verdade em vez de para o comparador.
 */
const UA_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function resolverLink(url: string): Promise<{ url: string; loja: string | null }> {
  if (!/\/lead\?|\/go\/|\/redirect|\/r\/|\/click/i.test(url)) return { url, loja: null };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    /* SALTO 1. O `/lead?` responde 200 com uma página do Next.js, não com um
       301 — por isso seguir redirecionamento sozinho não sai do lugar. O que
       interessa está no `__NEXT_DATA__`: `urlToRedirect` (o segundo salto, esse
       sim com `logAndRedirect=1`) e `merchantName`, que é a LOJA DE VERDADE. */
    const r1 = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA_NAVEGADOR } });
    const html = await r1.text();
    const bruto = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]{0,20000}?)<\/script>/);
    if (!bruto) return { url, loja: null };

    let dados: any = null;
    try { dados = JSON.parse(bruto[1]); } catch { return { url, loja: null }; }
    const pp = dados?.props?.pageProps ?? {};
    const loja: string | null = pp.rawName ?? pp.dataLayer?.[0]?.merchantName ?? null;
    const segundo: string | undefined = pp.urlToRedirect;
    if (!segundo) return { url, loja };

    /* SALTO 2. Esse devolve 301 para o endereço do produto na loja. O `fetch`
       segue e `r2.url` traz o destino — inclusive quando a loja responde 403
       para robô, que é o caso da Magalu. E tudo bem: o link certo vale por si,
       mesmo que a confirmação depois não consiga abrir a página. */
    const r2 = await fetch(segundo, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": UA_NAVEGADOR } });
    const final = r2.url && !/\/lead\?/i.test(r2.url) ? r2.url : url;
    return { url: final, loja };
  } catch {
    return { url, loja: null };
  } finally { clearTimeout(t); }
}

/**
 * O ESGOTADO VALE PARA O PRODUTO, NÃO PARA A LINHA DA FONTE.
 *
 * Buscapé, Zoom e Bondfaro são a mesma empresa e listam a MESMA oferta — no
 * caso medido em 27/08/2026, o mesmo `oid=1578116400` num Vivobook a
 * R$ 2.969,10. O radar já sabia disso para não repetir aviso (`chaveDoProduto`),
 * mas a conferência continuava sendo por linha: abriu-se a do Zoom, ela estava
 * esgotada e morreu; a do Bondfaro, idêntica, seguiu viva e virou o "melhor
 * preço" do alvo. Conferir um gêmeo e deixar o outro na tela é gastar o crédito
 * e não colher o resultado.
 *
 * DOIS CRITÉRIOS, do mais forte ao mais fraco:
 *   • mesmo `oid` na URL do lead → é literalmente a mesma oferta;
 *   • mesmo título normalizado e mesmo total → é o mesmo anúncio replicado, que
 *     é exatamente a premissa de `chaveDoProduto`.
 * O segundo pode, em tese, casar o mesmo modelo em duas lojas pelo mesmo preço.
 * O prejuízo é limitado e se desfaz sozinho: passados os
 * `DIAS_QUE_O_ESGOTADO_VALE`, a irmã volta ao fluxo e é conferida na própria
 * página.
 */
async function irmasDaMesmaOferta(supabase: any, alvoId: string, of: any): Promise<number[]> {
  const total = Number(of?.preco_total ?? of?.preco ?? 0);
  if (!of?.titulo || !(total > 0)) return [];
  const chave = chaveDoProduto(String(of.titulo), total);
  const lead = String(of.url ?? "").match(/[?&]oid=(\d+)/i)?.[1] ?? null;

  const { data } = await supabase
    .from("facilities_radar_ofertas")
    .select("id, titulo, preco, preco_total, url")
    .eq("alvo_id", alvoId)
    .eq("ativo", true)
    .neq("id", of.id);

  return (data ?? [])
    .filter((x: any) =>
      (lead && new RegExp(`[?&]oid=${lead}\\b`).test(String(x.url ?? ""))) ||
      chaveDoProduto(String(x.titulo ?? ""), Number(x.preco_total ?? x.preco ?? 0)) === chave)
    .map((x: any) => x.id as number);
}

/**
 * A partir de quanto abaixo dos irmãos vale perguntar "por que está barato?".
 *
 * A pergunta só faz sentido quando há um desvio a explicar. Feita sobre um preço
 * normal, ela é um convite a inventar: o modelo procura na página uma justifica-
 * tiva para uma premissa falsa e sempre acha alguma coisa. Dez por cento é a
 * mesma folga que o `classificar` usa para chamar uma queda de "forte".
 */
const GAP_PARA_PERGUNTAR = 0.10;

async function confirmarNoAnuncio(
  urlOriginal: string,
  /**
   * Quanto este anúncio está abaixo da mediana dos irmãos do mesmo alvo, de 0 a
   * 1. A CONTA É FEITA EM TypeScript e ENTREGUE pronta — a IA não mede nada,
   * só procura na página o que explica um número que já veio decidido.
   */
  abaixoDosIrmaos: number | null = null,
): Promise<Confirmacao & { url: string }> {
  const { url, loja } = await resolverLink(urlOriginal);
  const vazio: Confirmacao & { url: string } = { url, loja, disponivel: null, preco: null, frete_valor: null, frete_texto: null, avaliacao: null, avaliacoes: null, imagem_url: null, observacao: null, ficha: null, reclamacoes: null, porque_barato: null, erro: null };

  /* Primeiro com o CEP digitado, que é a única forma de a loja mostrar frete.
     Se a ação falhar — input com outro nome, página que não carregou a tempo —,
     relê sem ela: melhor um anúncio confirmado sem frete do que anúncio nenhum.
     A segunda leitura só acontece nos poucos que chegam à confirmação. */
  let { markdown, erro } = await firecrawl(url, 3000, { comCep: true, fresco: true });
  let comCep = !erro && !!markdown;
  if (!comCep) {
    /* A RELEITURA SÓ SE COUBER. Com CEP o teto é de 75s e sem ele mais 45s:
       um único anúncio pode comer 120s dos 135s da rodada, e aí não sobra nem
       para os outros da leva nem para gravar o que já se apurou. Sem margem,
       o achado fica na fila — que é o desenho: erro de leitura não condena
       anúncio nenhum. */
    if (sobramMs() < 60_000) return { ...vazio, erro: erro ?? "não coube no tempo desta rodada — fica na fila" };
    ({ markdown, erro } = await firecrawl(url, 3000, { fresco: true }));
    comCep = false;
  }
  if (erro) return { ...vazio, erro };
  if (!markdown || markdown.length < 100) return { ...vazio, erro: "a página do anúncio abriu vazia" };

  /* AUSÊNCIA DE EVIDÊNCIA NÃO É EVIDÊNCIA DE AUSÊNCIA — e aqui isso é a
     diferença entre um radar honesto e um que joga achado bom no lixo.
     A página de bloqueio da Magalu tem 1 KB e diz "não é possível acessar a
     página (erro 403)". Perguntada "dá para comprar agora?", a IA olha uma
     página sem botão de compra e responde `false`. O achado seria arquivado
     como "esgotado", com toda a cara de conclusão legítima, e ninguém jamais
     saberia que o produto estava lá à venda o tempo todo.
     Então antes de acreditar num "não", exige-se prova de que a página é MESMO
     um anúncio: ou tem preço, ou diz com todas as letras que acabou. */
  const temPreco = /r\$\s?\d/i.test(markdown);
  const dizEsgotado = disponibilidade(markdown.slice(0, 4000)) === false;
  if (!temPreco && !dizEsgotado) {
    return { ...vazio, erro: "a página não parece um anúncio (provável bloqueio de robô)" };
  }

  // Mesmo teto da extração, e pela mesma razão: chamada de IA sem prazo trava
  // o worker até os 150s e derruba a rodada inteira. Ver `prazoDeIA`.
  const prazo = prazoDeIA();
  if (prazo == null) return { ...vazio, erro: "não sobrou tempo na rodada para a IA ler o anúncio — fica na fila" };

  /* A CONFERÊNCIA TAMBÉM SE MEDE, e agora com mais razão: ela é a metade de
     vazão mais curta do radar (dois anúncios por rodada, porque o laço para em
     55s), e acabou de ganhar quatro campos e 4 000 caracteres de entrada. Se o
     custo disso for maior do que eu suponho, é aqui que vai aparecer — do mesmo
     jeito que o log da extração mostrou que as leituras boas fecham em 10 a 18s
     e o teto de 45s era espera pura. */
  const tIA = Date.now();
  try {
    const out = await comPrazo(generateJSON<any>({
      /* O MESMO modelo leve da extração, e o risco aqui é menor do que parece:
         quem decide são os três degraus logo abaixo, em TypeScript. O `false`
         da IA só vale acompanhado de prova (`temPreco`), o `dizEsgotado` por
         regex vence a IA, e qualquer dúvida vira `null`, que na tela é "conferir"
         — nunca "descartado".
         Com o modelo padrão, metade das confirmações estourava os 45s (medido em
         27/08/2026: 1 de 2), e achado que não confirma não chega à tela. */
      model: MODELO_LITE,
      messages: [
        {
          role: "system",
          content:
            "Você lê a página de UM produto em loja brasileira e responde se dá para comprar agora.\n" +
            "`disponivel` = false quando houver 'esgotado', 'indisponível', 'produto indisponível', " +
            "'avise-me quando chegar', 'sem estoque', ou quando não houver botão de compra.\n" +
            (comCep
              ? `O CEP ${CEP_DESTINO} JÁ FOI DIGITADO nesta página: se houver uma tabela ou lista de ` +
                "opções de entrega, pegue o MENOR valor de frete e ponha em `frete_valor` " +
                "(0 se disser grátis). Ignore retirada em loja, que não é frete.\n"
              : "") +
            "NÃO invente frete: só preencha `frete_valor` se houver um número na página. " +
            "Loja que só calcula frete depois do CEP não tem valor — deixe em branco.\n" +
            "Preencha `avaliacao` (0 a 5) e `avaliacoes` (quantidade) só se a página mostrar, " +
            "e `imagem_url` com a foto principal do produto.\n" +
            "Copie a ficha técnica em `ficha` e, se houver avaliações ESCRITAS, resuma as " +
            "críticas em `reclamacoes`. Nos dois casos: copiar, não deduzir.\n" +
            /* A PERGUNTA SÓ EXISTE QUANDO HÁ DESVIO A EXPLICAR, e o desvio já vem
               medido. Perguntada sobre um preço normal, a IA procura na página
               uma justificativa para uma premissa falsa — e sempre acha alguma.
               Ver `GAP_PARA_PERGUNTAR`. */
            (abaixoDosIrmaos != null && abaixoDosIrmaos >= GAP_PARA_PERGUNTAR
              ? `ATENÇÃO: este anúncio está ${Math.round(abaixoDosIrmaos * 100)}% ABAIXO dos outros ` +
                "do mesmo produto. Preencha `porque_barato` com o que ESTA PÁGINA diz que explica " +
                "isso (garantia curta do vendedor, vitrine/recondicionado, configuração menor, " +
                "vendedor sem reputação, entrega longa). Se a página não der motivo, omita o " +
                "campo — a ausência de explicação é uma resposta legítima.\n"
              : ""),
        },
        /* 18 000 e não 14 000: a ficha técnica e as avaliações escritas moram no
           MEIO da página, depois do bloco de compra. Com o corte antigo elas
           ficavam de fora com frequência, e o campo voltaria vazio dando a
           impressão de que a loja não informa. Entrada é barata em latência;
           o que custa é a saída, e a saída aqui continua sendo um punhado de
           campos curtos. */
        { role: "user", content: markdown.slice(0, 18000) },
      ],
      responseSchema: SCHEMA_CONFIRMACAO,
      temperature: 0,
      // Mesma razão da extração: ler a página e preencher campos é transcrição.
      // Quem decide de fato é a regra em TypeScript, logo abaixo.
      thinking: "low",
    }), prazo, "a leitura do anúncio pela IA");

    /* Três degraus, do mais confiável ao menos:
       1. a página ESCREVE que acabou → false, e não se discute;
       2. a IA diz que acabou E a página tem preço (logo, é anúncio de verdade
          que carregou) → false;
       3. a IA diz que dá para comprar → true.
       Fora disso, `null`: a tela pede para conferir em vez de decidir no chute. */
    const disp: boolean | null =
      dizEsgotado ? false
      : (out?.disponivel === false && temPreco) ? false
      : out?.disponivel === true ? true
      : null;
    console.log(
      `conferência ${new URL(url).hostname} ok ${((Date.now() - tIA) / 1000).toFixed(1)}s` +
      ` ficha:${out?.ficha ? "sim" : "não"} reclam:${out?.reclamacoes ? "sim" : "não"}`,
    );
    return {
      url, loja,
      disponivel: disp,
      preco: typeof out?.preco === "number" && out.preco > 0 ? out.preco : null,
      frete_valor: out?.frete_gratis === true ? 0 : (typeof out?.frete_valor === "number" ? out.frete_valor : null),
      frete_texto: out?.frete_texto ?? (out?.frete_gratis === true ? "Frete grátis" : null),
      avaliacao: typeof out?.avaliacao === "number" && out.avaliacao > 0 && out.avaliacao <= 5 ? out.avaliacao : null,
      avaliacoes: typeof out?.avaliacoes === "number" && out.avaliacoes > 0 ? Math.round(out.avaliacoes) : null,
      imagem_url: out?.imagem_url ?? null,
      observacao: out?.observacao ?? null,
      ficha: typeof out?.ficha === "string" && out.ficha.trim() ? out.ficha.trim().slice(0, 600) : null,
      reclamacoes: typeof out?.reclamacoes === "string" && out.reclamacoes.trim() ? out.reclamacoes.trim().slice(0, 300) : null,
      /* O campo só vale se a pergunta foi feita. Sem a guarda, um modelo
         prestativo preencheria mesmo sem ter sido perguntado, e a tela mostraria
         "por que está barato" ao lado de um preço que não está. */
      porque_barato: (abaixoDosIrmaos != null && abaixoDosIrmaos >= GAP_PARA_PERGUNTAR
        && typeof out?.porque_barato === "string" && out.porque_barato.trim())
        ? out.porque_barato.trim().slice(0, 300) : null,
      erro: null,
    };
  } catch (e) {
    return { ...vazio, erro: String(e) };
  }
}

/* =============================================================== interpretar */

const SCHEMA_SPECS = {
  type: "object",
  properties: {
    categoria: { type: "string", enum: ["notebook", "monitor", "celular", "tablet", "impressora", "cadeira", "desktop", "consumivel", "outro"] },
    categoria_facilities: { type: "string", enum: ["TI", "Mobiliário", "Manutenção", "Limpeza", "Copa/Cozinha", "Happy hour", "Material de escritório"] },
    titulo: { type: "string", description: "Nome curto do alvo, ex: 'Notebook i5 16GB para vendas'" },
    marcas: { type: "array", items: { type: "string" } },
    cpu_tier_min: { type: "number", description: "1 entrada, 3 i3/Ryzen3, 5 i5/Ryzen5, 7 i7/Ryzen7, 9 i9" },
    cpu_geracao_min: { type: "number" },
    ram_gb_min: { type: "number" },
    armazenamento_gb_min: { type: "number" },
    armazenamento_tipo: { type: "string", enum: ["ssd", "qualquer"] },
    tela_pol_min: { type: "number" },
    tela_pol_max: { type: "number" },
    termos_obrigatorios: { type: "array", items: { type: "string" } },
    termos_proibidos: { type: "array", items: { type: "string" } },
    condicoes: { type: "array", items: { type: "string", enum: ["novo", "usado", "recondicionado"] } },
    buscas: { type: "array", items: { type: "string" }, description: "2 a 4 consultas de busca, da mais específica para a mais ampla" },
    preco_alvo: { type: "number", description: "Teto em reais. Em consumível, o teto POR UNIDADE (o quilo, o litro, a peça)." },
    quantidade: { type: "number" },
    unidade: {
      type: "string", enum: ["kg", "l", "un"],
      description: "SÓ para consumível (café, papel, detergente): a unidade em que o teto é medido. Omita em equipamento.",
    },
    cadencia_dias: {
      type: "number",
      description: "De quantos em quantos dias vale a pena olhar. 0 para equipamento (todo dia), 7 para consumível.",
    },
  },
  required: ["categoria", "titulo", "buscas"],
};

async function interpretar(pedido: string, referencia: string | null) {
  const out = await generateJSON<any>({
    messages: [
      {
        role: "system",
        content:
          "Você traduz um pedido de compra em português em filtros de busca de produto.\n" +
          "REGRAS:\n" +
          "- Só preencha um campo se o pedido REALMENTE disser. Omitir é melhor que chutar: " +
          "cada campo preenchido vira uma recusa automática de anúncio.\n" +
          "- `buscas` são consultas curtas como alguém digitaria num marketplace " +
          "(ex: 'notebook i5 16gb ssd 512'), da mais específica para a mais ampla. " +
          "Nunca inclua preço nas buscas.\n" +
          "- `termos_obrigatorios` só para palavra que TEM de estar no título do anúncio.\n" +
          "- Se a pessoa não falou de condição, use ['novo'].\n" +
          "- `cpu_geracao_min` só quando ela citar geração explicitamente.\n" +
          "COMPRA RECORRENTE (café, açúcar, papel higiênico, detergente, sulfite, copo):\n" +
          "- use `categoria: \"consumivel\"`, `cadencia_dias: 7` e SEMPRE preencha `unidade`.\n" +
          "- `preco_alvo` vira o teto POR UNIDADE. 'café até R$ 40 o quilo' → preco_alvo 40, unidade kg. " +
          "Se a pessoa der o preço do pacote ('café 1kg até R$ 52'), converta para a unidade: 52 e kg; " +
          "'fardo de 6 águas de 1,5L por R$ 30' → 30/9 = 3,33 e unidade l.\n" +
          "- a unidade é a que a pessoa usaria para comparar: peso/volume para café, açúcar, detergente; " +
          "`un` para copo, rolo de papel, folha, caneta.\n" +
          "- `quantidade` passa a ser quanto se compra por vez NA UNIDADE (10 para 10 kg de café por mês).",
      },
      {
        role: "user",
        content: `Pedido: ${pedido}` + (referencia ? `\n\nAnúncio de referência que a pessoa colou:\n${referencia}` : ""),
      },
    ],
    responseSchema: SCHEMA_SPECS,
    temperature: 0.1,
  });

  const specs: AlvoSpecs = {
    categoria: out?.categoria ?? "outro",
    marcas: (out?.marcas ?? []).map((m: string) => norm(m)).filter(Boolean),
    cpu_tier_min: out?.cpu_tier_min ?? null,
    cpu_geracao_min: out?.cpu_geracao_min ?? null,
    ram_gb_min: out?.ram_gb_min ?? null,
    armazenamento_gb_min: out?.armazenamento_gb_min ?? null,
    armazenamento_tipo: out?.armazenamento_tipo ?? null,
    tela_pol_min: out?.tela_pol_min ?? null,
    tela_pol_max: out?.tela_pol_max ?? null,
    termos_obrigatorios: (out?.termos_obrigatorios ?? []).map((s: string) => norm(s)).filter(Boolean),
    termos_proibidos: (out?.termos_proibidos ?? []).map((s: string) => norm(s)).filter(Boolean),
    condicoes: out?.condicoes?.length ? out.condicoes : ["novo"],
    buscas: (out?.buscas ?? []).filter(Boolean).slice(0, 4),
    /* A UNIDADE É O QUE LIGA O MODO RECORRENTE, então ela só entra quando a
       categoria também diz consumível. Uma `unidade` solta num alvo de notebook
       faria o radar exigir peso no título e recusar a frota inteira. */
    unidade: out?.categoria === "consumivel" && ["kg", "l", "un"].includes(out?.unidade) ? out.unidade : null,
  };

  const consumivel = specs.categoria === "consumivel";
  return {
    specs,
    titulo: out?.titulo ?? pedido.slice(0, 80),
    categoria_facilities: out?.categoria_facilities ?? (consumivel ? "Copa/Cozinha" : "TI"),
    preco_alvo: out?.preco_alvo ?? null,
    quantidade: out?.quantidade ?? 1,
    /* Consumível nasce semanal. Preço de café não se mexe entre a manhã e a
       tarde, e com o serviço de raspagem no plano gratuito varrer todo dia
       seria gastar o crédito do mês para ver o mesmo número catorze vezes. */
    cadencia_dias: Number.isFinite(out?.cadencia_dias) ? Math.max(0, Math.round(out.cadencia_dias)) : (consumivel ? 7 : 0),
  };
}

/* =================================================================== varrer */

interface ResultadoAlvo {
  alvo_id: string;
  titulo: string;
  buscadas: number;
  aprovadas: number;
  recusadas: number;
  alertas: number;
  /** Avisos suprimidos por serem o mesmo produto vindo de outra fonte. */
  repetidos: number;
  /** Produto certo, preço acima do teto: guardado só para alimentar a curva. */
  historico: number;
  /** Anúncios que a busca trouxe de volta e a conferência já tinha enterrado. */
  esgotados: number;
  fontes: Record<string, string>;   // fonte → "12 anúncios" ou o erro
  top_recusas: string[];
}

async function varrerAlvo(
  supabase: any,
  alvo: any,
  fontesPedidas: string[] | null,
  inicio: number,
): Promise<ResultadoAlvo> {
  const specs: AlvoSpecs = alvo.specs ?? { categoria: "outro" };
  const precoAlvo = Number(alvo.preco_alvo);
  const buscas: string[] = specs.buscas?.length ? specs.buscas : [alvo.titulo];
  const fontes: string[] = (fontesPedidas ?? alvo.fontes ?? []).filter(Boolean);

  const res: ResultadoAlvo = {
    alvo_id: alvo.id, titulo: alvo.titulo, buscadas: 0, aprovadas: 0, recusadas: 0, alertas: 0, repetidos: 0, historico: 0,
    esgotados: 0, fontes: {}, top_recusas: [],
  };

  /* A MÁ NOTÍCIA É CARIMBADA NA ENTRADA e apagada no fim, se houver fim.
     Quando o worker é DERRUBADO — WORKER_RESOURCE_LIMIT, medido em 27/08/2026
     com o Carrefour no rodízio — nada é gravado: o `catch` do laço não roda,
     porque não houve exceção, o processo inteiro morreu. Na tela isso é
     indistinguível de "não houve varredura hoje", e o card fica mudo enquanto
     a rodada morre todo dia no mesmo lugar.
     Escrever o pessimismo antes resolve os dois lados: se morrer, a frase fica
     e alguém vê; se terminar, o update do fim a troca por `null`.

     E `ultima_varredura`/`rodadas` saem JÁ AQUI de propósito. A fila é ordenada
     por `ultima_varredura nulls first` e o rodízio de fontes anda com
     `rodadas` — se a rodada morre sem avançar nenhum dos dois, o mesmo alvo
     volta à cabeça da fila com as MESMAS fontes e derruba o worker de novo,
     para sempre, bloqueando todos os outros alvos atrás dele. */
  await supabase.from("facilities_radar_alvos").update({
    ultima_varredura: new Date().toISOString(),
    rodadas: Number(alvo.rodadas ?? 0) + 1,
    ultimo_erro: "a varredura foi interrompida no meio — a rodada não chegou ao fim. Tenta de novo na próxima.",
  }).eq("id", alvo.id);

  // Um anúncio pode voltar em duas buscas diferentes; a chave é (fonte, id).
  const brutas = new Map<string, OfertaBruta>();

  /**
   * As fontes que DE FATO foram lidas nesta rodada.
   *
   * O fim da varredura desativa o anúncio que sumiu da busca — e essa conta
   * estava sendo feita sobre o alvo INTEIRO, não sobre o que foi consultado.
   * Como só 6 das 9 fontes entram por rodada (rodízio), cada rodada apagava as
   * ofertas das 3 que ficaram de fora, e no dia seguinte apagava as outras. Em
   * 27/08/2026 o banco mostrava Kabum com 17 ofertas e ZERO ativas, Americanas
   * 13 e zero, Casas Bahia 16 e zero — o "melhor preço agora" do card só
   * enxergava a última rodada e balançava sozinho a cada 12 horas.
   *
   * Fonte que falhou também fica de fora desta lista: erro de leitura não é
   * "o anúncio saiu do ar", e apagar por falha nossa é o mesmo pecado de
   * arquivar achado bom porque a página não abriu.
   */
  const lidas = new Set<string>();

  // O piso da regra é o mesmo que reprova o anúncio barato demais lá na
  // frente. Mandá-lo na URL faz a loja já não devolver o acessório.
  const piso = pisoDePreco(precoAlvo);

  /* PRIMEIRO OS GÊMEOS. Buscapé, Zoom e Bondfaro são a mesma empresa e devolvem
     as mesmas ofertas; ler as três é pagar três créditos pelo mesmo estoque. Uma
     por rodada, girando com `rodadas` — assim a queda de uma não tira a família
     da varredura, e nenhuma delas fica cadastrada e muda para sempre. */
  const rodada = Number(alvo.rodadas ?? 0);
  const cadastradas = fontes.filter((f) => f in LOJAS);
  const familias = new Map<string, string[]>();
  for (const f of cadastradas) {
    const fam = LOJAS[f].familia ?? f;
    const irmas = familias.get(fam) ?? [];
    irmas.push(f);
    familias.set(fam, irmas);
  }
  const representantes = new Set<string>();
  for (const irmas of familias.values()) {
    // Ordem estável dentro da família (prioridade), para o giro ser previsível.
    const ordenadas = [...irmas].sort((a, b) => LOJAS[a].prioridade - LOJAS[b].prioridade);
    representantes.add(ordenadas[rodada % ordenadas.length]);
  }
  for (const f of cadastradas) {
    if (!representantes.has(f)) {
      const irma = [...(familias.get(LOJAS[f].familia ?? f) ?? [])].find((x) => representantes.has(x));
      res.fontes[f] = `mesmo estoque de ${LOJAS[irma ?? f]?.nome ?? irma} — a família reveza, entra na próxima`;
    }
  }

  /* RODÍZIO DE FONTES. São doze agora, e chamar as doze toda rodada estoura o
     relógio e o crédito. Cortar simplesmente pelas primeiras seria pior: as
     últimas NUNCA seriam consultadas — estariam ligadas na tela e mudas na
     prática. Então as que mais rendem vão sempre, e as demais entram em roda,
     avançando uma posição a cada varredura.

     A ORDEM É MEDIDA, NÃO ESCRITA À MÃO. A lista de prioridades do código foi
     feita com a medição de 26/08 e no dia seguinte já estava errada: a Casas
     Bahia, "comprovada", trazia 16 anúncios e 1 aproveitável; o Carrefour, no
     rodízio, trazia 4 aproveitáveis. `rendimento` conta quantas ofertas de cada
     fonte entraram no teto e sobreviveram à conferência nos últimos 14 dias.

     FONTE SEM HISTÓRICO NÃO VAI PARA O FIM DA FILA. Zero úteis por nunca ter
     sido lida e zero por ter sido lida e não render são coisas opostas, e
     tratá-las igual criaria fome: a fonte nova nunca seria consultada, nunca
     teria histórico, e nunca sairia do último lugar. Quem não tem histórico
     entra pela prioridade escrita, no meio. */
  const escolhidas = cadastradas
    .filter((f) => representantes.has(f))
    .sort((a, b) => {
      const ra = rendimento.get(a), rb = rendimento.get(b);
      if (ra != null && rb != null && ra !== rb) return rb - ra;
      if (ra != null && rb == null) return -1;
      if (ra == null && rb != null) return 1;
      return LOJAS[a].prioridade - LOJAS[b].prioridade;
    });
  const fixas = escolhidas.slice(0, FIXAS_ATE);
  const roda = escolhidas.slice(FIXAS_ATE);
  const vagas = Math.max(0, MAX_FONTES_POR_RODADA - fixas.length);
  const giro = roda.length ? (rodada * vagas) % roda.length : 0;
  const naOrdem = [
    ...fixas,
    ...Array.from({ length: Math.min(vagas, roda.length) }, (_, i) => roda[(giro + i) % roda.length]),
  ];
  for (const f of escolhidas) {
    if (!naOrdem.includes(f)) res.fontes[f] = "fora do rodízio desta rodada — entra na próxima";
  }

  /* AS FONTES VÃO EM PARALELO — é o que torna o radar viável. Cada fonte é
     ~35-50s de espera (o `waitFor` do Firecrawl mais a extração pela IA), e em
     fila indiana DUAS fontes já custaram 106s numa medição real. Com o teto de
     55s da rodada, isso significa uma fonte por alvo e pronto.
     Em paralelo o custo passa a ser o da fonte mais lenta, não a soma delas.

     O QUE SE PARALELIZA É SÓ A ESPERA. O veredito continua sequencial e
     determinístico, depois, no `avaliar` — qual site respondeu primeiro não
     pode mudar quem é aprovado. */
  if (Date.now() - inicio > ORCAMENTO_MS) {
    for (const loja of naOrdem) res.fontes[loja] = "não coube no tempo desta rodada — entra na próxima";
  } else {
    const colhidas = await Promise.all(naOrdem.map(async (loja) => {
      const cfg = LOJAS[loja];
      // Uma consulta por fonte (a mais específica). Cada scrape é um crédito de
      // Firecrawl mais uma chamada de IA — quatro buscas × seis fontes × N alvos
      // sairia caro sem trazer muito, já que a busca ampla repete a específica.
      const url = cfg.busca(buscas[0], piso, precoAlvo);
      const { markdown, erro } = await firecrawl(url, cfg.waitFor);
      if (erro) return { loja, ofertas: [] as OfertaBruta[], nota: erro };
      const { ofertas, erro: erroIA } = await extrairDaLoja(markdown, url, loja);
      /* FALHA DA IA NÃO É FONTE VAZIA. Se a extração caiu, a frase é dela — não
         a de "conferir a busca desta fonte", que mandaria mexer numa URL que
         está certa. */
      if (erroIA) return { loja, ofertas: [] as OfertaBruta[], nota: erroIA };
      const unicos = new Set(ofertas.map((o) => o.id_externo)).size;
      /* "0 anúncios" NÃO pode se parecer com sucesso — e até 29/08/2026 se
         parecia de um jeito pior do que a frase deixava ver.
         A nota "0 anúncios — …" CASA com `/^\d+ anúncios/`, que é o teste de
         duas coisas: o `ehOk` (não vira `ultimo_erro`, card verde) e, sobretudo,
         o `lidas` — que é quem AUTORIZA desativar as ofertas daquela fonte no
         fim da rodada. Ou seja: um muro anti-robô de meio quilobyte era tratado
         como "a loja foi lida e não tem mais nada", e limpava da tela as ofertas
         boas que ela tinha na rodada anterior. Exatamente o pecado que este
         módulo combate em todos os outros lugares — acreditar num "não" que
         ninguém disse.
         Nunca disparou nas rodadas gravadas (38 a 48), mas vai ficar muito mais
         provável quando a raspagem mudar de motor e entrarem justamente as
         fontes que erguem muro (ML, Amazon, Magalu).

         A DISCRIMINAÇÃO É A MESMA DA CONFERÊNCIA: só se acredita numa página se
         ela parecer uma página de resultado, e o sinal é ter preço escrito. Com
         preço e nada extraído, o defeito é nosso; sem preço nenhum, não dá para
         saber se é vitrine vazia ou muro. Nos dois casos a resposta é a mesma —
         não desativar nada e falar alto. */
      if (!ofertas.length) {
        const temPreco = /r\$\s?\d/i.test(markdown);
        return {
          loja, ofertas,
          nota: temPreco
            ? "a página tem preços, mas nada foi extraído — conferir a busca desta fonte"
            : "a página abriu sem preço nenhum — vitrine vazia ou muro de robô, não dá para saber",
        };
      }
      return {
        loja, ofertas,
        // "30 anúncios (13 produtos)" — a diferença entre os dois números conta
        // a história do agregador, e some se a gente reportar só um deles.
        nota: `${ofertas.length} anúncios${unicos !== ofertas.length ? ` (${unicos} produtos)` : ""}`,
      };
    }));

    /* A junção respeita a ORDEM DA PRIORIDADE, não a de chegada, para o
       resultado da rodada não depender de qual site respondeu primeiro.
       E na colisão de chave FICA O MAIS BARATO: a página de um agregador lista
       o mesmo produto em oito lojas, uma linha por loja, com o mesmo título.
       Guardar "o último que apareceu" jogava fora justamente o preço bom — a
       única coisa que este módulo existe para achar. */
    for (const { loja, ofertas, nota } of colhidas) {
      res.fontes[loja] = nota;
      /* SÓ QUEM RESPONDEU PODE TER SUAS OFERTAS APAGADAS no fim da rodada.
         Fonte que deu erro de leitura não teve suas ofertas "sumindo da busca"
         — não houve busca. Ver `lidas` lá embaixo.

         E "respondeu" agora quer dizer TROUXE ANÚNCIO. A condição repete o
         `ofertas.length` em vez de confiar só no formato da nota porque é uma
         permissão para APAGAR: a versão anterior a concedia por casamento de
         texto, e bastou a nota de zero começar com "0 anúncios" para que um muro
         de robô ganhasse o direito de limpar a tela. Permissão destrutiva não se
         deduz de string. */
      if (ofertas.length && /^\d+ anúncios/.test(nota)) lidas.add(loja);
      for (const o of ofertas) {
        const k = `${o.fonte}|${o.id_externo}`;
        const antes = brutas.get(k);
        if (!antes || o.preco < antes.preco) brutas.set(k, o);
      }
    }
  }

  res.buscadas = brutas.size;

  /* Avaliação — regra pura, sem rede. */
  const recusas = new Map<string, number>();
  const aprovadas: Array<{ o: OfertaBruta; av: ReturnType<typeof avaliar> }> = [];
  /* O PRODUTO CERTO PELO PREÇO ERRADO TAMBÉM É GUARDADO. Ele não vira alerta e
     não conta como oferta ativa, mas entra na tabela de preços — é dele que sai
     a frase "R$ 3.900 é o menor preço em 90 dias". Antes, o notebook de
     R$ 4.500 parado há três meses era descartado, e quando enfim caísse não
     haveria com o que comparar. */
  const soPreco: Array<{ o: OfertaBruta; av: ReturnType<typeof avaliar> }> = [];
  for (const o of brutas.values()) {
    const av = avaliar(specs, precoAlvo, o);
    if (!av.aprovado) {
      res.recusadas++;
      if (av.apenas_preco) soPreco.push({ o, av });
      const chave = (av.recusa ?? "sem motivo").replace(/“[^”]*”/g, "…").replace(/R\$ ?[\d.,]+/g, "R$ …");
      recusas.set(chave, (recusas.get(chave) ?? 0) + 1);
      continue;
    }
    aprovadas.push({ o, av });
  }
  res.historico = soPreco.length;
  res.aprovadas = aprovadas.length;
  res.top_recusas = [...recusas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m, n]) => `${n}× ${m}`);

  // Ordena pelo TOTAL (produto + frete): o mais barato de verdade, não o de
  // etiqueta menor. Entre dois totais iguais, ganha quem tem mais confirmado.
  /* Pelo COMPARÁVEL: o total em equipamento, o preço por unidade em consumível.
     Ordenar café pela etiqueta poria o pacote de 250 g na frente do de 1 kg —
     o mais barato da lista e o mais caro por quilo. */
  aprovadas.sort((a, b) => a.av.comparavel - b.av.comparavel || b.av.score - a.av.score);

  /* O QUE A CONFERÊNCIA MATOU NÃO RESSUSCITA PELA PÁGINA DE BUSCA.
     A vitrine da loja continua listando o produto esgotado — com o último
     preço, que é o mais bonito que ele já teve. Sem esta lista, cada varredura
     desfazia a conferência da rodada anterior: `disponivel` voltava a `null` e
     `ativo` a `true`, e o defunto reaparecia como o melhor preço do alvo.
     Só os "não" recentes contam (ver `DIAS_QUE_O_ESGOTADO_VALE`); passada a
     validade o anúncio reentra no fluxo normal e é conferido de novo. */
  const valeDesde = new Date(Date.now() - DIAS_QUE_O_ESGOTADO_VALE * 86_400_000).toISOString();
  const { data: mortas } = await supabase
    .from("facilities_radar_ofertas")
    .select("fonte, id_externo")
    .eq("alvo_id", alvo.id)
    .eq("disponivel", false)
    .gte("confirmado_em", valeDesde);
  const esgotadas = new Set((mortas ?? []).map((m: any) => `${m.fonte}|${m.id_externo}`));

  /* Gravação: a oferta é atualizada (não reinserida) e o preço vira linha nova. */
  const idsVivos: number[] = [];
  const candidatos: Array<{ ofertaId: number; titulo: string; total: number; comparavel: number; frete: number | null; classe: { tipo: string; texto: string } }> = [];

  /* Os "só preço" entram na MESMA gravação, marcados. A alternativa seria um
     segundo laço quase idêntico — e duas cópias da mesma escrita divergem na
     primeira coluna nova que alguém acrescentar em um só dos dois. */
  for (const { o, av } of [...aprovadas, ...soPreco]) {
    const dentroDoTeto = av.aprovado;
    const { frete } = totalDaOferta(o);
    /* Duas fontes de "acabou": o que esta busca diz (raro, mas quando diz é
       verdade) e o que a conferência já apurou e ainda vale. */
    const esgotada = o.disponivel === false || esgotadas.has(`${o.fonte}|${o.id_externo}`);
    const { data: linha, error } = await supabase
      .from("facilities_radar_ofertas")
      .upsert({
        dentro_do_teto: dentroDoTeto,
        alvo_id: alvo.id,
        fonte: o.fonte,
        id_externo: o.id_externo,
        titulo: o.titulo,
        url: o.url,
        imagem_url: o.imagem_url ?? null,
        vendedor: o.vendedor ?? null,
        condicao: condicaoDoTitulo(o.titulo, o.condicao),
        preco: o.preco,
        preco_total: av.total,
        /* O PREÇO COMPARÁVEL, quando o alvo é recorrente. `preco_total` é o que
           se paga pelo pacote; `preco_unitario` é o que decide se está caro.
           Guardar os dois é o que permite à tela dizer "R$ 52 · R$ 52/kg" e ao
           painel ordenar pelo segundo. */
        preco_unitario: av.embalagem ? av.comparavel : null,
        embalagem_qtd: av.embalagem?.quantidade ?? null,
        embalagem_unidade: av.embalagem?.unidade ?? null,
        embalagem_texto: av.embalagem?.texto ?? null,
        avaliacao: o.avaliacao ?? null,
        avaliacoes: o.avaliacoes ?? null,
        frete_gratis: frete === 0,
        frete_valor: frete,
        frete_texto: o.frete_texto ?? null,
        disponivel: esgotada ? false : (o.disponivel ?? null),
        score: av.score,
        motivos: av.motivos,
        conferir: av.conferir,
        specs_lidas: av.lidas,
        ativo: !esgotada,
        visto_em: new Date().toISOString(),
      }, { onConflict: "alvo_id,fonte,id_externo" })
      .select("id, preco_min")
      .single();
    if (error || !linha) { console.error("upsert oferta", error?.message); continue; }

    /* ESGOTADO NÃO ENTRA NA CURVA. A linha da oferta continua atualizada — o
       anúncio existe e é isso que `visto_em` conta —, mas o preço dele não vira
       ponto de histórico: preço de coisa que não se pode comprar não é preço de
       mercado, e como a curva ancora o `sugerirTeto` no MENOR valor, um defunto
       barato repetido todo dia puxaria o teto sugerido para baixo de vez.
       E, claro, não vira aviso. */
    if (esgotada) { res.esgotados++; continue; }
    idsVivos.push(linha.id);

    // Histórico ANTES de inserir o preço de agora — senão o preço de hoje já
    // seria o "mínimo anterior" e nada nunca seria mínimo histórico.
    const { data: hist } = await supabase
      .from("facilities_radar_precos")
      .select("preco, coletado_em")
      .eq("oferta_id", linha.id)
      .order("coletado_em", { ascending: true })
      .limit(200);

    /* A CURVA GUARDA O COMPARÁVEL, não o que se paga. Num alvo de café, a
       mesma busca traz pacotes de 250 g, 500 g e 1 kg; gravar o preço da
       etiqueta faria a linha do tempo subir e descer conforme o tamanho do
       pacote que apareceu naquele dia, e "menor preço em 90 dias" viraria
       "menor pacote em 90 dias". */
    await supabase.from("facilities_radar_precos").insert({ oferta_id: linha.id, preco: av.comparavel });

    const minAntes = linha.preco_min != null ? Number(linha.preco_min) : null;
    if (minAntes == null || av.comparavel < minAntes) {
      await supabase.from("facilities_radar_ofertas").update({ preco_min: av.comparavel }).eq("id", linha.id);
    }

    // Só quem cabe no teto pode virar aviso. O resto só alimenta a curva.
    if (!dentroDoTeto) continue;
    const classe = classificar(av.comparavel, precoAlvo, (hist ?? []) as any);
    if (classe) candidatos.push({ ofertaId: linha.id, titulo: o.titulo, total: av.total, comparavel: av.comparavel, frete, classe });
  }

  /* Anúncio que sumiu da busca não é apagado: perde o `ativo` e mantém o
     histórico, que continua servindo de referência de mercado.
     DENTRO DAS FONTES LIDAS, e só delas — ver `lidas`. */
  if (idsVivos.length && lidas.size) {
    await supabase.from("facilities_radar_ofertas")
      .update({ ativo: false })
      .eq("alvo_id", alvo.id).eq("ativo", true)
      .in("fonte", [...lidas])
      .not("id", "in", `(${idsVivos.join(",")})`);
  }

  /* O ACHADO NASCE EM QUARENTENA. `a_confirmar` não aparece na tela: antes de
     virar aviso, a ação `confirmar` abre o anúncio e checa se tem estoque e
     quanto é o frete. A página de BUSCA mostra produto esgotado com o último
     preço praticado — que fica bonito justamente por não estar mais à venda —,
     então avisar direto dela é prometer uma compra que pode não existir.
     Máximo de três, mínimo histórico na frente. */
  const ordem: Record<string, number> = { minimo_historico: 0, queda_forte: 1, alvo_batido: 2 };
  candidatos.sort((a, b) => (ordem[a.classe.tipo] ?? 9) - (ordem[b.classe.tipo] ?? 9) || a.total - b.total);

  /* UM PRODUTO, UM AVISO. Buscapé, Zoom e Bondfaro são do mesmo grupo e
     listaram o MESMO notebook a R$ 2.969,10 — três avisos idênticos na tela,
     que é o começo do fim da confiança na aba. As três OFERTAS continuam
     gravadas (o histórico de preço de cada fonte é legítimo); o que não se
     repete é o aviso.

     E A REGRA ATRAVESSA AS RODADAS, não só esta — foi o buraco que o rodízio de
     família abriu sem querer. Enquanto as três gêmeas entravam na MESMA rodada,
     o `Set` local dava conta: o segundo Buscapé caía no primeiro. Desde
     27/08/2026 só uma da família entra por vez, e a que entra MUDA: o Acer
     Aspire GO a R$ 4.299 virou aviso pelo Zoom às 11h45, de novo pelo Buscapé às
     15h46 e de novo pelo Bondfaro às 19h45 de 28/08 — três linhas do mesmo
     notebook, cada uma legítima do ponto de vista da sua rodada. Dos seis avisos
     na tela naquela manhã, dois eram produtos.

     Então o `Set` nasce com o que JÁ ESTÁ ABERTO neste alvo. Preço diferente
     continua avisando de propósito: a chave inclui o total, e queda de preço é
     exatamente o que merece aviso novo. */
  const vistos = new Set<string>();
  const { data: jaAbertos, error: erroAbertos } = await supabase
    .from("facilities_radar_alertas")
    .select("preco_total, preco, facilities_radar_ofertas(titulo, preco_total, preco)")
    .eq("alvo_id", alvo.id)
    .in("status", ["a_confirmar", "novo", "visto"]);
  /* SE ESTA LEITURA FALHAR, O RADAR VOLTA A REPETIR AVISO — e faria isso em
     silêncio, porque `data` nulo vira conjunto vazio e o filtro segue como se
     não houvesse nada aberto. É a forma de falha que este módulo mais combate:
     o defeito com cara de funcionamento normal. Não derruba a rodada (avisar
     duas vezes é melhor que não varrer), mas deixa rastro. */
  if (erroAbertos) console.error("dedup de aviso: não li os alertas abertos —", erroAbertos.message);
  for (const a of jaAbertos ?? []) {
    const of = (a as any).facilities_radar_ofertas;
    const titulo = String(of?.titulo ?? "");
    if (!titulo) continue;
    /* DOIS TOTAIS, e não um. A conferência reescreve o total da oferta quando
       descobre o frete (R$ 4.299 vira R$ 4.389), e nem sempre o do alerta junto
       — usar só um dos dois deixaria a gêmea passar justamente nos achados que
       já foram conferidos, que são os que estão na tela há mais tempo. */
    for (const t of [Number(a.preco_total ?? a.preco), Number(of?.preco_total ?? of?.preco)]) {
      if (t > 0) vistos.add(chaveDoProduto(titulo, t));
    }
  }

  const unicos = candidatos.filter((c) => {
    const k = chaveDoProduto(c.titulo, c.total);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  res.repetidos = candidatos.length - unicos.length;

  for (const c of unicos.slice(0, MAX_ALERTAS_POR_ALVO)) {
    const { error } = await supabase.from("facilities_radar_alertas").insert({
      alvo_id: alvo.id, oferta_id: c.ofertaId, tipo: c.classe.tipo,
      texto: c.classe.texto, preco: c.comparavel, preco_total: c.total,
      frete_valor: c.frete, preco_alvo: precoAlvo,
      /* A economia é medida na MESMA moeda do teto: por unidade em consumível,
         e `quantidade` passa a ser quanto se compra por vez (10 kg de café),
         não quantas caixas. */
      economia: economiaDe(precoAlvo, c.comparavel, alvo.quantidade ?? 1),
      status: "a_confirmar",
    });
    // 23505 = já existe alerta deste anúncio por este preço. É o comportamento
    // desejado (não repetir), não um erro.
    if (!error) res.alertas++;
    else if (error.code !== "23505") console.error("insert alerta", error.message);
  }

  /* "fora do rodízio" não é problema — é o desenho. Só entra em `ultimo_erro`
     o que de fato falhou, senão o card do alvo ficaria amarelo para sempre e o
     aviso deixaria de significar alguma coisa.

     E "mesmo estoque de X" é a MESMA classe de coisa: a família reveza porque
     alguém decidiu que ela deve revezar. Ficou de fora desta lista quando o
     rodízio de família entrou (27/08/2026), e o efeito foi exatamente o que
     este comentário existe para impedir — em 29/08 o `ultimo_erro` do único
     alvo ativo começava com "Zoom, Bondfaro: mesmo estoque de Buscapé", com a
     rodada inteira tendo corrido bem. Card amarelo por desenho é card amarelo
     que ninguém mais lê. */
  const ehOk = (v: string) =>
    /^\d+ anúncios/.test(v) || v.startsWith("fora do rodízio") || v.startsWith("mesmo estoque de");
  const falhas = Object.entries(res.fontes).filter(([, v]) => !ehOk(v));

  /* AGRUPADO PELO MOTIVO, não uma linha por fonte. Quando a IA está fora do ar
     as seis fontes falham pela MESMA razão, e "kabum: … | zoom: … | buscape: …"
     seis vezes vira uma faixa de 600 caracteres numa tarja de uma linha — que
     é como não escrever nada. "kabum, zoom, buscapé + 3: <motivo>" cabe e diz
     o mesmo. O relatório por fonte continua inteiro em `res.fontes`, que é
     onde se vai olhar fonte a fonte. */
  const porMotivo = new Map<string, string[]>();
  for (const [fonte, motivo] of falhas) porMotivo.set(motivo, [...(porMotivo.get(motivo) ?? []), fonte]);
  const resumoDasFalhas = [...porMotivo.entries()]
    .map(([motivo, fontes]) => {
      const nomes = fontes.map((f) => LOJAS[f]?.nome ?? f);
      const lista = nomes.length > 3 ? `${nomes.slice(0, 3).join(", ")} +${nomes.length - 3}` : nomes.join(", ");
      return `${lista}: ${motivo}`;
    })
    .join(" | ")
    .slice(0, 500);

  await supabase.from("facilities_radar_alvos").update({
    ultima_varredura: new Date().toISOString(),
    ultimo_erro: falhas.length ? resumoDasFalhas : null,
    rodadas: Number(alvo.rodadas ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", alvo.id);

  return res;
}

/* ==================================================================== HTTP */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const t0 = Date.now();
  /* O prazo de tudo que roda nesta requisição — ver `LIMITE_WORKER_MS`.
     FICA O MAIS APERTADO DOS DOIS quando há rodada em voo: o mesmo worker
     atende requisições concorrentes (o cron das 16:45 e um clique em "Varrer
     agora" caem juntos), e sobrescrever o prazo daria à rodada antiga um
     relógio que ela não tem — de volta a morrer sem gravar nada. */
  fimDaRodada = Math.min(fimDaRodada > t0 ? fimDaRodada : Infinity, t0 + LIMITE_WORKER_MS);
  /* Quantas páginas ESTA requisição pediu — ver `raspagens`. É diferença, e não
     leitura direta, porque o contador é do isolate e sobrevive à requisição
     anterior. */
  const raspagensAntes = raspagens;
  const daRodada = () => raspagens - raspagensAntes;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    /* Cron ou gente. O `name` entra no filtro junto com o token: credencial que
       abre qualquer porta não é credencial. */
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "facilities-radar").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    let quem: string | null = null;
    if (!ehCron) {
      const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
      quem = caller.email ?? null;
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "varrer";

    /* ---------------------------------------------------------- saldo */
    /* Quanto ainda dá para varrer. Não gasta crédito e não toca no banco. */
    if (action === "saldo") {
      const s = await saldoFirecrawl();
      return json({ ok: !s.erro, ...s, duracao_ms: Date.now() - t0 });
    }

    /* ---------------------------------------------------- interpretar */
    if (action === "interpretar") {
      const pedido = String(body?.pedido ?? "").trim();
      if (!pedido) return json({ ok: false, erro: "Escreva o que você quer monitorar." }, 400);

      let referencia: string | null = null;
      const link = String(body?.link_ref ?? "").trim();
      if (link) {
        const { token } = await tokenML();
        if (token) referencia = await itemML(link, token);
        if (!referencia) {
          const { markdown } = await firecrawl(link, 2500);
          if (markdown) referencia = markdown.slice(0, 4000);
        }
      }

      const out = await interpretar(pedido, referencia);
      return json({ ok: true, ...out, leu_referencia: !!referencia, duracao_ms: Date.now() - t0 });
    }

    /* --------------------------------------------------- sugerir teto */
    /* Os NÚMEROS saem da regra (`sugerirTeto`, testada, sempre igual); a IA só
       transforma o `resumo` em uma frase que uma pessoa lê sem esforço. É o
       mesmo desenho do Cartão e da Ponte: a IA nunca decide valor. Um teto que
       varia entre chamadas seria impossível de defender numa reunião. */
    if (action === "sugerir_teto") {
      const alvoId = String(body?.alvo_id ?? "");
      if (!alvoId) return json({ ok: false, erro: "Informe o alvo." }, 400);
      const digitado = Number(body?.preco_alvo) || null;

      const { data: hist, error: erroHist } = await supabase
        .rpc("facilities_radar_historico", { p_alvo_id: alvoId, p_dias: 90 });
      if (erroHist) throw new Error(erroHist.message);

      const s = sugerirTeto((hist ?? []) as any, digitado);
      if (!s.pode) {
        return json({
          ok: true, ...s,
          texto: s.dias === 0
            ? "Ainda não há histórico deste alvo. Depois de algumas varreduras eu consigo dizer se o teto está no lugar certo."
            : `Só ${s.dias} dia(s) medidos — a partir de ${DIAS_PARA_SUGERIR} eu consigo sugerir um teto com base na curva.`,
        });
      }

      let texto = s.resumo;
      try {
        texto = (await generateText({
          messages: [
            {
              role: "system",
              content:
                "Você escreve UMA frase curta, em português do Brasil, para quem cuida de compras num escritório. " +
                "Direto e sem jargão. NÃO invente número nenhum: use exatamente os que receber. " +
                "Não repita 'segundo o histórico' nem comece com 'Com base em'.",
            },
            { role: "user", content: `Reescreva de forma natural, em uma frase: ${s.resumo}` },
          ],
          temperature: 0.3,
        })).trim();
      } catch { /* a frase é enfeite; os números é que decidem */ }

      return json({ ok: true, ...s, texto, duracao_ms: Date.now() - t0 });
    }

    /* -------------------------------------------------- sugerir busca */
    /* O TERMO DE BUSCA ENVELHECE E NINGUÉM PERCEBE. `specs.buscas` é escrito uma
       única vez, na criação do alvo, e só o PRIMEIRO termo é usado — uma consulta
       por fonte, para sempre. Ele nunca vê o que trouxe.
       Numa rodada medida em 29/08/2026, 65 anúncios lidos viraram 48 recusas.
       Trinta e sete eram "acima do teto", que é trabalho útil (alimentam a curva
       do histórico); as outras onze eram spec — "8GB de RAM, abaixo dos 16
       pedidos" — e essas o próprio termo de busca poderia ter excluído na origem.
       É crédito e relógio gastos para ler anúncio que já se sabia que não serve.

       A IA PROPÕE, A PESSOA CARIMBA. Mesma divisão da Parametrização e do
       Cartão: nada é aplicado aqui. A resposta é uma sugestão com o porquê, e
       quem troca o termo é quem edita o alvo — porque um termo ruim não dá erro,
       dá silêncio, e silêncio é o que este módulo mais teme. */
    if (action === "sugerir_busca") {
      const alvoId = String(body?.alvo_id ?? "");
      if (!alvoId) return json({ ok: false, erro: "Informe o alvo." }, 400);

      const { data: alvo, error: erroAlvo } = await supabase
        .from("facilities_radar_alvos").select("*").eq("id", alvoId).single();
      if (erroAlvo || !alvo) return json({ ok: false, erro: "Alvo não encontrado." }, 400);

      /* As recusas moram no relatório das execuções, não numa tabela: o anúncio
         recusado não é gravado (só o "produto certo, preço errado"). Vinte
         rodadas cobrem uns cinco dias no ritmo atual. */
      const { data: execs } = await supabase
        .from("facilities_radar_execucoes")
        .select("detalhe").order("iniciado_em", { ascending: false }).limit(20);

      const contagem = new Map<string, number>();
      let lidos = 0, recusados = 0;
      for (const e of execs ?? []) {
        for (const pa of ((e as any).detalhe?.por_alvo ?? [])) {
          if (pa?.alvo_id !== alvoId) continue;
          lidos += Number(pa.buscadas ?? 0);
          recusados += Number(pa.recusadas ?? 0);
          for (const linha of (pa.top_recusas ?? [])) {
            const m = String(linha).match(/^(\d+)×\s*(.+)$/);
            if (!m) continue;
            contagem.set(m[2], (contagem.get(m[2]) ?? 0) + Number(m[1]));
          }
        }
      }
      const recusas = [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (!recusas.length) {
        return json({ ok: true, pode: false, texto: "Ainda não há rodadas suficientes deste alvo para eu olhar as recusas." });
      }

      /* O TETO NÃO É PROBLEMA DE BUSCA, e separar isso é o que impede a sugestão
         de ser boba. "Acima do teto" quer dizer que o termo achou o produto
         certo — o preço é que não coube, e é exatamente o que alimenta a curva.
         Só as recusas de SPEC e de CATEGORIA são evitáveis na origem. */
      const evitaveis = recusas.filter(([m]) => !/acima do teto|abaixo do piso/i.test(m));
      const somaEvitavel = evitaveis.reduce((s, [, n]) => s + n, 0);
      const atual = (alvo.specs?.buscas ?? [])[0] ?? alvo.titulo;

      /* Esta ação não corre contra a rodada — é um clique, e o worker é todo
         dela. Mas o prazo continua saindo do `prazoDeIA()`, porque o teto de
         150s do worker vale igual; e a retentativa não é luxo: a primeira versão
         desta ação, com uma chance de 30s, voltou "não respondeu em 30s" no
         primeiro teste real, num dia em que o Gemini devolvia 503 em 10s. */
      const prazoIA = prazoDeIA();
      if (prazoIA == null) return json({ ok: false, erro: "sem tempo de worker para a sugestão agora — tente de novo" });

      const chamarSugestao = (ms: number) => comPrazo(generateJSON<{ busca: string; porque: string }>({
        model: MODELO_LITE,
        messages: [
          {
            role: "system",
            content:
              "Você ajusta o TERMO DE BUSCA que um radar de preços digita na busca de lojas " +
              "brasileiras. Recebe o termo atual e a lista do que foi recusado depois de lido.\n" +
              "REGRAS:\n" +
              "- Devolva um termo curto, como alguém digitaria numa loja. Sem preço, sem aspas, " +
              "sem operadores (-, OR, site:). Lojas brasileiras não entendem operador.\n" +
              "- Só acrescente palavra que ESTREITE o que a recusa mostra ser lixo. " +
              "Recusa por preço NÃO se resolve com termo de busca — ignore.\n" +
              "- Mais específico não é sempre melhor: termo estreito demais devolve zero anúncio, " +
              "e zero anúncio é pior que anúncio recusado. Na dúvida, mude pouco.\n" +
              "- Se o termo atual já estiver bom, devolva-o igual e diga isso em `porque`.\n" +
              "- `porque` é UMA frase, em português do Brasil, dizendo o que muda e por quê.",
          },
          {
            role: "user",
            content:
              `Termo atual: ${atual}\n` +
              `O que se procura: ${alvo.titulo}\n` +
              `Specs pedidas: ${JSON.stringify(alvo.specs ?? {})}\n\n` +
              `Nas últimas rodadas: ${lidos} anúncios lidos, ${recusados} recusados.\n` +
              `Recusas:\n${recusas.map(([m, n]) => `  ${n}× ${m}`).join("\n")}\n\n` +
              `Evitáveis por busca (não são preço): ${somaEvitavel}`,
          },
        ],
        responseSchema: {
          type: "object",
          properties: { busca: { type: "string" }, porque: { type: "string" } },
          required: ["busca", "porque"],
        },
        temperature: 0.2,
        thinking: "low",
      }), ms, "a sugestão de busca pela IA");

      const r = await duasChancesDeIA(chamarSugestao, prazoIA, "sugestão de busca");
      if (!r.ok) {
        return json({ ok: false, erro: `não deu para sugerir agora: ${r.cru}${r.tentativas > 1 ? " (falhou nas 2 tentativas)" : ""}` });
      }
      const proposta = String(r.valor?.busca ?? "").trim() || atual;
      const porque = String(r.valor?.porque ?? "").trim();

      return json({
        ok: true,
        pode: true,
        atual,
        proposta,
        // `mudou` é comparação de string, não julgamento: a tela precisa saber se
        // há algo para carimbar ou se a IA concordou com o que já está lá.
        mudou: norm(proposta) !== norm(atual),
        porque,
        lidos, recusados,
        evitaveis: somaEvitavel,
        recusas: recusas.map(([m, n]) => `${n}× ${m}`),
        duracao_ms: Date.now() - t0,
      });
    }

    /* ------------------------------------------------------ confirmar */
    /* A segunda metade do radar: tira o achado da quarentena.
       Cada alerta em `a_confirmar` tem o anúncio ABERTO um a um. Só vira aviso
       (`novo`) o que ainda tem estoque e ainda cabe no teto COM o frete. O que
       não passa vira `indisponivel`/`descartado` e nunca chega à tela — mas fica
       gravado, porque "sumiu antes de eu ver" é informação sobre o mercado.

       E A MESMA AÇÃO RECONFERE O QUE JÁ ESTÁ NA TELA. Conferir uma vez, na
       entrada, só garante que o achado era verdade no dia em que subiu; o
       produto acaba depois, e o aviso fica lá com um preço que não existe mais.
       É o mesmo defeito da página de busca, adiado em vinte e quatro horas. */
    if (action === "confirmar") {
      /* Seis por rodada, não doze: com nove em paralelo, sete deram erro de leitura
         na medição de 26/08/2026 — o Firecrawl não gosta de rajada. Quem não
         couber fica na fila e é pego na rodada seguinte. */
      const limite = Number(body?.limite ?? 4);

      /* O FREIO DA CONFERÊNCIA TEM O PISO MAIS BAIXO DO HUB (120 créditos), e é
         de propósito: ela é a última a parar. Varredura parada significa não
         achar promoção nova — chato, sem consequência. Conferência parada
         significa deixar na tela um preço que já não existe, e é isso que faz o
         Facilities parar de clicar nos links.
         O pedido é `limite × 2` porque cada anúncio pode custar duas raspagens:
         a primeira com o CEP digitado e, se a ação falhar, a releitura sem ela. */
      const podeConferir = await podeGastar(supabase, "radar_conferir", limite * 2);
      if (!podeConferir.pode) {
        return json({
          ok: true, freado: true, confirmados: 0,
          mensagem: `conferência suspensa: ${podeConferir.motivo}.`,
          saldo: podeConferir.saldo,
        });
      }

      /* A FILA DA RECONFERÊNCIA: achado na tela cuja última conferência
         envelheceu. O `!inner` é o que permite filtrar pela coluna da oferta;
         sem ele o filtro cairia no vazio e a fila viria inteira.

         A ordem é a do alerta mais antigo, e o rodízio se resolve sozinho: quem
         é reconferido ganha `confirmado_em` de agora e sai da fila pelas
         próximas 24h. A exceção é a página que nunca abre — essa fica na
         cabeça da fila, e por isso o relatório mostra o erro em vez de contar
         "reconferido". */
      const limiteReconferir = new Date(Date.now() - HORAS_PARA_RECONFERIR * 3600 * 1000).toISOString();
      let qr = supabase
        .from("facilities_radar_alertas")
        .select("id, alvo_id, oferta_id, preco, preco_total, preco_alvo, texto, tipo, status, facilities_radar_ofertas!inner(id,url,titulo,preco,preco_total,embalagem_qtd,embalagem_unidade,embalagem_texto,conferir,confirmado_em,score,avaliacao,avaliacoes), facilities_radar_alvos(quantidade,specs)")
        .in("status", ["novo", "visto"])
        .lt("facilities_radar_ofertas.confirmado_em", limiteReconferir)
        .order("created_at", { ascending: true })
        .limit(MAX_RECONFERIR);
      if (body?.alvo_id) qr = qr.eq("alvo_id", body.alvo_id);
      const { data: reconferir, error: erroReconf } = await qr;
      if (erroReconf) console.error("fila de reconferência", erroReconf.message);

      /* A quarentena abre mão das vagas da reserva. Sem isso, num dia de muitos
         achados novos a fila de quarentena consome a rodada inteira e a
         reconferência nunca roda — o fantasma fica na tela justamente quando há
         mais gente olhando. */
      const vagasQuarentena = Math.max(1, limite - (reconferir?.length ?? 0));
      let q = supabase
        .from("facilities_radar_alertas")
        .select("id, alvo_id, oferta_id, preco, preco_total, preco_alvo, texto, tipo, status, tentativas, facilities_radar_ofertas(id,url,titulo,preco,preco_total,embalagem_qtd,embalagem_unidade,embalagem_texto,conferir,score,avaliacao,avaliacoes), facilities_radar_alvos(quantidade,specs)")
        .eq("status", "a_confirmar")
        .order("created_at", { ascending: true })
        .limit(vagasQuarentena);
      if (body?.alvo_id) q = q.eq("alvo_id", body.alvo_id);

      /* QUARENTENA TEM PRAZO. Um anúncio cuja página nunca abre ficaria em
         `a_confirmar` para sempre, e a fila encheria de zumbi — cada rodada
         gastando crédito nos mesmos links mortos e empurrando os achados novos
         para o fim.

         MAS QUEM DESISTE É A CONTAGEM, NÃO O RELÓGIO. Até aqui bastavam 48h em
         quarentena para o alerta virar `descartado` com o texto "não consegui
         abrir o anúncio em 48h de tentativas" — uma frase deduzida da idade, com
         zero tentativa apurada. E a vazão desta ação é de DOIS anúncios por
         rodada (o laço para em 55s; um anúncio custa até 75s com o CEP mais 45s
         de releitura), então uma fila um pouco maior que isso já produz achado
         descartado sem nunca ter sido aberto — afirmando o contrário.

         Idade E tentativa, agora. Quem envelheceu sem ser tentado continua na
         fila, e a fila é ordenada pelo mais antigo: ele está na cabeça dela. Se
         crescer sem parar, aparece como fila grande — que é um problema que se
         vê — em vez de sumir como limpeza. */
      const limiteIdade = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { data: velhos } = await supabase.from("facilities_radar_alertas")
        .update({ status: "descartado", texto: `não consegui abrir o anúncio em ${TENTATIVAS_ATE_DESISTIR} tentativas` })
        .eq("status", "a_confirmar").lt("created_at", limiteIdade)
        .gte("tentativas", TENTATIVAS_ATE_DESISTIR)
        .select("id");

      const { data: fila, error: erroFila } = await q;
      if (erroFila) throw new Error(erroFila.message);
      if (!fila?.length && !reconferir?.length) {
        return json({ ok: true, confirmados: 0, desistidos: velhos?.length ?? 0, mensagem: "Nada na fila de confirmação." });
      }

      /* EM LEVAS DE DOIS, e não tudo de uma vez. Confirmar seis em paralelo
         matou o worker com WORKER_RESOURCE_LIMIT: cada uma pode fazer DUAS
         raspagens (com CEP e, se falhar, sem) e segura o markdown inteiro na
         memória enquanto a IA lê. Paralelismo aqui não economiza tanto quanto
         nas fontes — são páginas menores — e o custo de errar é a rodada toda
         morrer sem devolver relatório. */
      const saidas: any[] = [];
      const LEVA = 2;
      /**
       * UMA FUNÇÃO, DOIS MODOS — e não duas cópias. A leitura da página, a
       * regra do teto e a escrita da oferta são idênticas nos dois casos; o que
       * muda é o que se diz e para onde vai o alerta. Duas cópias divergiriam
       * na primeira vez que alguém corrigisse só uma delas.
       */
      /**
       * QUANTO ESTE ANÚNCIO ESTÁ ABAIXO DOS IRMÃOS DO MESMO ALVO.
       *
       * A conta é feita AQUI, em TypeScript, e entregue pronta à IA — que só vai
       * procurar na página o que explica um desvio já medido. A alternativa
       * seria mandar as outras ofertas junto e pedir para ela comparar, e aí o
       * número que aparece na tela passaria a depender do modelo.
       *
       * Mediana e não média: numa lista de oito ofertas do mesmo notebook, um
       * único anúncio de acessório mal filtrado puxaria a média para baixo e
       * faria o preço normal parecer caro.
       */
      const abaixoDosIrmaos = async (alvoId: string, ofertaId: number, total: number): Promise<number | null> => {
        if (!(total > 0)) return null;
        const { data } = await supabase
          .from("facilities_radar_ofertas")
          .select("preco_total, preco")
          .eq("alvo_id", alvoId).eq("ativo", true).eq("dentro_do_teto", true)
          .neq("id", ofertaId);
        const totais = (data ?? [])
          .map((x: any) => Number(x.preco_total ?? x.preco ?? 0))
          .filter((n: number) => n > 0)
          .sort((a: number, b: number) => a - b);
        // Menos de três irmãos não faz mediana — faz opinião com cara de estatística.
        if (totais.length < 3) return null;
        const m = Math.floor(totais.length / 2);
        const mediana = totais.length % 2 ? totais[m] : (totais[m - 1] + totais[m]) / 2;
        if (!(mediana > 0)) return null;
        return Math.max(0, (mediana - total) / mediana);
      };

      const conferirUm = async (al: any, modo: "quarentena" | "reconferencia") => {
        const of = al.facilities_radar_ofertas;
        if (!of?.url) return { id: al.id, desfecho: "sem link" };

        const gap = await abaixoDosIrmaos(al.alvo_id, of.id, Number(of.preco_total ?? of.preco ?? 0));
        const c = await confirmarNoAnuncio(of.url, gap);
        if (c.erro) {
          /* Erro de leitura NÃO condena o anúncio. Na quarentena ele fica na
             fila; na tela, continua na tela. Tirar um achado por falha NOSSA
             seria o mesmo erro do "provável bloqueio de robô" virar "esgotado":
             ausência de evidência não é evidência de ausência.

             O que muda é que a tentativa fica ESCRITA. É ela — e não a idade —
             que autoriza a desistência lá em cima, e é ela que permite ao
             descarte dizer uma coisa verdadeira sobre o que se tentou. Só na
             quarentena: o achado que já está na tela não é descartado por
             falha de leitura, então contar seria contar para ninguém. */
          if (modo === "quarentena") {
            await supabase.from("facilities_radar_alertas")
              .update({ tentativas: Number(al.tentativas ?? 0) + 1 })
              .eq("id", al.id);
          }
          return { id: al.id, desfecho: `erro: ${c.erro.slice(0, 80)}` };
        }

        if (c.disponivel === false) {
          await supabase.from("facilities_radar_alertas")
            .update({
              status: "indisponivel",
              texto: al.texto + (modo === "quarentena"
                ? " · esgotado quando fomos conferir"
                : " · esgotou depois de aparecer aqui"),
            })
            .eq("id", al.id);
          await supabase.from("facilities_radar_ofertas")
            .update({ disponivel: false, ativo: false, confirmado_em: new Date().toISOString() })
            .eq("id", of.id);

          /* E as gêmeas junto — a mesma oferta listada por outro comparador.
             O carimbo de `confirmado_em` nelas diz quando NÓS SOUBEMOS, não que
             a página delas foi aberta; é o que segura a varredura de
             ressuscitá-las amanhã. */
          const irmas = await irmasDaMesmaOferta(supabase, al.alvo_id, of);
          if (irmas.length) {
            await supabase.from("facilities_radar_ofertas")
              .update({ disponivel: false, ativo: false, confirmado_em: new Date().toISOString() })
              .in("id", irmas);
            /* E o aviso da gêmea cai junto. Sem isto a oferta some da lista mas
               o alerta dela continua na tela — apontando para o mesmo anúncio
               esgotado, agora sem nada por trás que o desminta. */
            await supabase.from("facilities_radar_alertas")
              .update({ status: "indisponivel" })
              .in("oferta_id", irmas)
              .in("status", ["a_confirmar", "novo", "visto"]);
          }
          return { id: al.id, desfecho: modo === "quarentena" ? "esgotado" : "esgotou depois", irmas: irmas.length };
        }

        // O preço da página do anúncio vale mais que o da busca: é o que a
        // pessoa vai encontrar ao clicar.
        const preco = c.preco ?? Number(of.preco);
        const total = preco + (c.frete_valor ?? 0);
        const qtd = Number(al.facilities_radar_alvos?.quantidade ?? 1);
        const teto = Number(al.preco_alvo);
        /* O TETO DO ALVO RECORRENTE É POR UNIDADE, e a conferência tem de
           comparar na mesma moeda. O tamanho do pacote já foi lido na varredura
           e está gravado na oferta — reler o título aqui seria fazer duas vezes
           a mesma leitura, com o risco de ela dar diferente. */
        const qtdEmb = Number(of.embalagem_qtd) || null;
        const comparavel = qtdEmb ? emCentavos(total / qtdEmb) : total;
        const porUnidade = qtdEmb ? `${of.embalagem_unidade === "l" ? "L" : of.embalagem_unidade ?? "un"}` : null;

        /* ============ A FICHA FECHA AS PENDÊNCIAS QUE O TÍTULO DEIXOU ABERTAS
           Medido em 29/08/2026: 24 de 24 ofertas dentro do teto tinham pendência,
           3,2 em média, e o score médio era 46 de 100. Como cada pendência tira
           quatro pontos, ~13 do que faltava não era "este anúncio é ruim" — era
           "eu não sei". O radar descontava a própria ignorância e chamava aquilo
           de nota.

           E O NÚMERO SAI DO `lerSpecs`, NÃO DA IA. A ficha é texto transcrito;
           quem extrai "16GB de RAM" dele é a mesma função testada que já lê o
           título. A IA não ganhou voto — ganhou a obrigação de copiar mais.

           POR QUE NÃO REEXECUTAR O `avaliar` INTEIRO com título + ficha, que
           seria o caminho óbvio: as guardas de acessório e de sucata varrem o
           texto todo, e ficha de notebook diz coisas como "fonte para notebook
           65W inclusa" e "sem leitor de cartão". O `PARA_ALGO` casaria com a
           primeira e o achado bom seria recusado como peça de reposição. A ficha
           serve para PREENCHER spec, não para reabrir o julgamento de o que o
           anúncio é. */
        const specsAlvo: AlvoSpecs | null = al.facilities_radar_alvos?.specs ?? null;
        /* Fora do consumível, e isto é guarda e não escrúpulo: em alvo medido por
           quilo quem decide é o tamanho da embalagem, que mora no título — e uma
           ficha com "peso líquido 2,3 kg" (o peso do notebook!) daria uma leitura
           de embalagem inventada. */
        const lidas = (c.ficha && specsAlvo && !specsAlvo.unidade)
          ? lerSpecs(`${of.titulo} ${c.ficha}`)
          : null;

        /* O QUE A FICHA DESMENTE. Uma spec que o título não dizia, e que agora
           se sabe MENOR que o pedido, é um achado que não devia ter chegado à
           tela. Antes ele ficava lá com um "conferir: memória RAM" que ninguém
           conferia. */
        const desmentido: string | null = !lidas || !specsAlvo ? null
          : specsAlvo.ram_gb_min != null && lidas.ram_gb != null && lidas.ram_gb < specsAlvo.ram_gb_min
            ? `a ficha da página diz ${lidas.ram_gb}GB de RAM, abaixo dos ${specsAlvo.ram_gb_min}GB pedidos`
          : specsAlvo.armazenamento_gb_min != null && lidas.armazenamento_gb != null && lidas.armazenamento_gb < specsAlvo.armazenamento_gb_min
            ? `a ficha da página diz ${lidas.armazenamento_gb}GB de armazenamento, abaixo dos ${specsAlvo.armazenamento_gb_min}GB pedidos`
          : specsAlvo.cpu_tier_min != null && lidas.cpu_tier != null && lidas.cpu_tier < specsAlvo.cpu_tier_min
            ? `a ficha da página diz processador ${lidas.cpu_texto}, inferior ao pedido`
          : specsAlvo.armazenamento_tipo === "ssd" && lidas.armazenamento_tipo != null && lidas.armazenamento_tipo !== "ssd"
            ? `a ficha da página diz ${lidas.armazenamento_tipo.toUpperCase()}, e o pedido exige SSD`
          : null;

        /* O QUE A CONFERÊNCIA RESOLVEU SAI DA LISTA — e "avaliações do produto"
           saía errado desde sempre: a IA já devolvia `avaliacao`/`avaliacoes`, e
           o filtro nunca as tirava de `conferir`. Vinte e três das vinte e quatro
           ofertas carregavam essa pendência (e os quatro pontos de desconto) com
           o dado já em mãos. */
        const temNota = (c.avaliacao ?? of.avaliacao) != null
          && Number(c.avaliacoes ?? of.avaliacoes ?? 0) >= MIN_AVALIACOES;
        const resolvido = new Set<string>();
        if (c.disponivel === true) resolvido.add("se está em estoque");
        if (c.frete_valor != null) resolvido.add("valor do frete");
        if (temNota) resolvido.add("avaliações do produto");
        if (lidas?.cpu_tier != null) resolvido.add("processador");
        if (lidas?.cpu_marca === "intel" && lidas?.cpu_geracao != null) resolvido.add("geração do processador");
        if (lidas?.ram_gb != null) resolvido.add("memória RAM");
        if (lidas?.armazenamento_gb != null) resolvido.add("armazenamento");
        if (lidas?.armazenamento_tipo != null) resolvido.add("se o disco é SSD");
        if (lidas?.tela_pol != null) resolvido.add("tamanho da tela");

        const conferir = (of.conferir ?? []).filter((x: string) => !resolvido.has(x));
        /* Devolve os quatro pontos que cada pendência havia tirado — é o inverso
           exato do `score -= conferir.length * 4` do `avaliar`, e não uma nota
           nova inventada aqui. */
        const pontosDeVolta = Math.max(0, (of.conferir ?? []).length - conferir.length) * 4;
        const score = Math.min(100, Number(of.score ?? 0) + pontosDeVolta);

        if (desmentido) {
          await supabase.from("facilities_radar_ofertas").update({
            ficha: c.ficha, reclamacoes: c.reclamacoes, conferir,
            disponivel: c.disponivel ?? null, confirmado_em: new Date().toISOString(),
          }).eq("id", of.id);
          await supabase.from("facilities_radar_alertas")
            .update({ status: "descartado", texto: desmentido })
            .eq("id", al.id);
          return { id: al.id, desfecho: "a ficha desmentiu o título" };
        }

        await supabase.from("facilities_radar_ofertas").update({
          preco, preco_total: total,
          ...(qtdEmb ? { preco_unitario: comparavel } : {}),
          frete_valor: c.frete_valor, frete_texto: c.frete_texto,
          frete_gratis: c.frete_valor === 0,
          disponivel: c.disponivel ?? null,
          /* A confirmação COMPLETA o que a busca leu, não apaga. Foto e nota às
             vezes vêm melhor da página de busca, às vezes da do produto —
             sobrescrever com null perderia o que já estava certo. */
          ...(c.avaliacao != null ? { avaliacao: c.avaliacao } : {}),
          ...(c.avaliacoes != null ? { avaliacoes: c.avaliacoes } : {}),
          ...(c.imagem_url ? { imagem_url: c.imagem_url } : {}),
          /* MESMA REGRA DA FOTO E DA NOTA: a conferência COMPLETA o que a busca
             leu, não apaga. Uma releitura em que a ficha não veio (página que
             mudou de layout, corte de 18 000 caracteres que não alcançou) não
             pode zerar a ficha que já estava certa. */
          ...(c.ficha ? { ficha: c.ficha } : {}),
          ...(c.reclamacoes ? { reclamacoes: c.reclamacoes } : {}),
          /* `porque_barato` é a exceção, e de propósito: ela responde a uma
             pergunta sobre o preço DESTE momento. Se o anúncio deixou de estar
             abaixo dos irmãos, a frase antiga passou a mentir — some. */
          porque_barato: c.porque_barato,
          conferir, score,
          // Guarda o endereço RESOLVIDO: o aviso passa a levar direto à loja,
          // e não ao redirecionador do comparador. E o vendedor deixa de ser
          // "Buscapé" (que não vende nada) para ser quem realmente vende.
          url: c.url || of.url,
          ...(c.loja ? { vendedor: c.loja } : {}),
          confirmado_em: new Date().toISOString(),
        }).eq("id", of.id);

        if (comparavel > teto) {
          await supabase.from("facilities_radar_alertas").update({
            status: "descartado",
            texto: modo === "quarentena"
              ? porUnidade
                ? `no anúncio saiu R$ ${comparavel.toFixed(2)}/${porUnidade} (R$ ${total.toFixed(0)} o ${of.embalagem_texto ?? "pacote"}), acima do teto`
                : `no anúncio saiu R$ ${total.toFixed(0)}${c.frete_valor ? ` (com R$ ${c.frete_valor.toFixed(0)} de frete)` : ""}, acima do teto`
              // Aqui o aviso JÁ TINHA SIDO dado, e o preço subiu depois. A frase
              // conta as duas pontas, senão o Facilities olha o card, vê o preço
              // do anúncio e acha que o radar mediu errado.
              : `subiu de R$ ${Number(al.preco_total ?? al.preco).toFixed(0)} para R$ ${total.toFixed(0)} depois de entrar aqui`,
          }).eq("id", al.id);
          return { id: al.id, desfecho: modo === "quarentena" ? "passou do teto ao conferir" : "subiu de preço" };
        }

        await supabase.from("facilities_radar_alertas").update({
          /* Na reconferência o STATUS NÃO VOLTA A `novo`. O achado já foi visto;
             remarcá-lo como novo faria o selo do menu piscar todo dia por causa
             de uma checagem de rotina, e selo que pisca sozinho deixa de ser
             lido. O que se atualiza é o preço — que pode ter caído mais. */
          ...(modo === "quarentena" ? { status: "novo" } : {}),
          preco: comparavel, preco_total: total, frete_valor: c.frete_valor,
          economia: economiaDe(teto, comparavel, qtd),
          /* E o texto também não: a observação seria acrescentada de novo a cada
             reconferência, e em uma semana o aviso viraria uma fita. */
          ...(modo === "quarentena" ? { texto: al.texto + (c.observacao ? ` · ${c.observacao}` : "") } : {}),
        }).eq("id", al.id);
        return { id: al.id, desfecho: modo === "quarentena" ? "confirmado" : "segue de pé" };
      };

      /* INTERCALADAS, e não uma fila depois da outra. As duas disputam o mesmo
         relógio e a rodada quase nunca chega ao fim da lista; com a
         reconferência no fim, ela só rodaria nos dias fracos — e é justamente
         no dia cheio que o fantasma fica exposto na tela. */
      const trabalho: Array<{ al: any; modo: "quarentena" | "reconferencia" }> = [];
      const naQuarentena = [...(fila ?? [])];
      const naTela = [...(reconferir ?? [])];
      while (naQuarentena.length || naTela.length) {
        const a = naQuarentena.shift();
        if (a) trabalho.push({ al: a, modo: "quarentena" });
        const b = naTela.shift();
        if (b) trabalho.push({ al: b, modo: "reconferencia" });
      }

      for (let i = 0; i < trabalho.length; i += LEVA) {
        /* O relógio manda: o que não couber fica na fila e é pego na próxima.
           São DOIS relógios — o orçamento da rodada e a vida do worker. Uma
           leva pode levar 120s (raspagem com CEP mais a releitura sem ele), e
           começar uma sem essa margem é escolher morrer sem devolver relatório:
           medido em 27/08/2026, a confirmação bateu 133s. */
        if (Date.now() - t0 > ORCAMENTO_MS || sobramMs() < 60_000) break;
        saidas.push(...await Promise.all(trabalho.slice(i, i + LEVA).map(({ al, modo }) => conferirUm(al, modo))));
      }

      /* O RELATÓRIO CARREGA O ERRO INTEIRO, não só a contagem. "erro: 7" não
         diz se foi bloqueio de robô, página fora do ar ou crédito acabado — e
         são três problemas com três soluções diferentes. Agrupar sem a
         mensagem é o mesmo pecado do "0 anúncios" que passa por sucesso. */
      const conta: Record<string, number> = {};
      const erros: Record<string, number> = {};
      for (const s of saidas as any[]) {
        const chave = s.desfecho.startsWith("erro:") ? "erro" : s.desfecho;
        conta[chave] = (conta[chave] ?? 0) + 1;
        if (chave === "erro") {
          const msg = s.desfecho.slice(6).trim();
          erros[msg] = (erros[msg] ?? 0) + 1;
        }
      }
      /* A conferência não mede o custo pela diferença de saldo como a varredura:
         ela é curta e roda quatro vezes ao dia, e duas leituras de saldo por
         rodada custariam mais latência do que a precisão vale. Registra o que
         pediu — subestima o link de agregador que precisou de stealth, e é por
         isso que o quinhão dela (900) tem folga sobre a conta nominal (~640). */
      await registrarGasto(supabase, "radar_conferir", daRodada(), { desfechos: conta, quem });

      return json({
        ok: true,
        confirmados: conta["confirmado"] ?? 0,
        // Quantos achados saíram da tela por terem acabado depois de subir.
        // É o número que diz se a reconferência está pagando o crédito dela.
        sumiram: conta["esgotou depois"] ?? 0,
        // Gêmeas do mesmo anúncio (outro comparador, mesmo `oid`) enterradas
        // junto. Sem esta linha o número parece pequeno demais para o efeito.
        irmas_marcadas: (saidas as any[]).reduce((s, x) => s + (x.irmas ?? 0), 0),
        reconferidos: (conta["segue de pé"] ?? 0) + (conta["esgotou depois"] ?? 0) + (conta["subiu de preço"] ?? 0),
        fila: fila?.length ?? 0,
        na_tela: reconferir?.length ?? 0,
        // A conferência é a metade CARA: cada anúncio pode custar duas
        // raspagens (com CEP e, se falhar, sem), e o link do agregador leva a
        // lojas que só abrem com proxy stealth — cinco créditos cada.
        raspagens: daRodada(),
        desfechos: conta,
        // Quem errou continua em `a_confirmar` e é retentado — falha nossa não
        // condena o anúncio.
        erros: Object.entries(erros).map(([m, n]) => `${n}× ${m}`),
        duracao_ms: Date.now() - t0,
      });
    }

    /* --------------------------------------------------------- varrer */
    if (action !== "varrer") return json({ ok: false, erro: `Ação desconhecida: ${action}` }, 400);

    const fontesPedidas: string[] | null = Array.isArray(body?.fontes) && body.fontes.length ? body.fontes : null;

    /* A FILA VEM DO BANCO, e a razão é a cadência: o filtro compara
       `ultima_varredura` com uma expressão sobre OUTRA coluna do mesmo registro
       (`now() - cadencia_dias`), e isso não se escreve num filtro do PostgREST.
       Fazer a conta aqui obrigaria a trazer todos os alvos e descartar depois —
       gastando as vagas da rodada com quem ainda não está na hora.
       Pedir por `alvo_id` (o clique em "Varrer agora") ignora a cadência de
       propósito: quem clicou quer agora, e a espera é do cron, não da pessoa. */
    const { data: alvos, error } = body?.alvo_id
      ? await supabase.from("facilities_radar_alvos").select("*").eq("ativo", true).eq("id", body.alvo_id)
      : await supabase.rpc("facilities_radar_fila", { p_limite: Number(body?.limite ?? 20) });
    if (error) throw new Error(error.message);
    if (!alvos?.length) {
      return json({
        ok: true, alvos: 0,
        // "Nenhum alvo ativo" e "nenhum alvo NA HORA" são coisas diferentes, e
        // confundi-las faria o café semanal parecer um alvo quebrado.
        mensagem: "Nenhum alvo na hora de varrer — os semanais só entram quando a cadência deles vence.",
      });
    }

    /* O saldo ANTES: serve de freio e de régua. A consulta não gasta crédito, e
       é a diferença dela para a do fim que diz quanto a rodada custou de fato —
       contra a alternativa de nunca saber por que os créditos acabaram. */
    const saldoAntes = await saldoFirecrawl();

    /* O FREIO. Ver `SALDO_MINIMO_RASPAGEM`: sem crédito não se procura achado novo, mas
       a conferência segue rodando em sua própria chamada — o que está na tela
       continua sendo desmentido quando some da loja.
       A parada é GRAVADA como execução terminada, e não devolvida em silêncio:
       "hoje não varreu porque acabou o crédito" é uma resposta, e a tela tem de
       poder dá-la. Rodada que não deixa rastro é indistinguível de rodada que
       nunca foi chamada. */
    /* O FREIO AGORA É O RATEIO, e não mais um número solto. `podeGastar` cobra
       duas coisas ao mesmo tempo: o quinhão do ciclo desta varredura (para um
       laço defeituoso não torrar o mês numa madrugada) e o piso de saldo desta
       prioridade (para a varredura parar ANTES da conferência, que é a que tira
       fantasma da tela). Ver `_shared/firecrawl.ts`. */
    const cabe = await podeGastar(supabase, "radar_varrer", alvos.length * MAX_FONTES_POR_RODADA, saldoAntes);
    if (!cabe.pode) {
      const recado = `varredura suspensa: ${cabe.motivo}. ` +
        "A conferência dos achados que já estão na tela continua rodando.";
      const agora = new Date().toISOString();
      await supabase.from("facilities_radar_execucoes").insert({
        alvos: 0, terminado_em: agora,
        detalhe: { freado: true, motivo: recado, saldo: saldoAntes.restantes, plano: saldoAntes.plano, quinhao: cabe.restaCiclo, quem },
      });
      return json({ ok: true, freado: true, alvos: 0, saldo: saldoAntes.restantes, plano: saldoAntes.plano, mensagem: recado });
    }

    /* A ordem das fontes desta rodada sai do que elas renderam nos últimos 14
       dias. Uma consulta, antes do laço: a resposta é a mesma para todos os
       alvos. */
    await carregarRendimento(supabase);

    const { data: exec } = await supabase.from("facilities_radar_execucoes")
      .insert({ alvos: alvos.length }).select("id").single();

    const resultados: ResultadoAlvo[] = [];
    let restante = 0;
    for (const alvo of alvos) {
      /* DUAS CONTAS, e não uma. `ORCAMENTO_MS` é a política — quanto de rodada
         se quer gastar; `sobramMs()` é o físico — quanto o worker ainda vive.
         Só a primeira deixava um alvo começar aos 54s e levar 105s (medido em
         27/08/2026), estourando o teto da plataforma e matando a rodada com
         relatório e tudo. Alvo que não cabe INTEIRO fica para a próxima. */
      if (Date.now() - t0 > ORCAMENTO_MS || sobramMs() < 60_000) { restante = alvos.length - resultados.length; break; }
      try {
        resultados.push(await varrerAlvo(supabase, alvo, fontesPedidas, t0));
      } catch (e) {
        console.error("varrerAlvo", alvo.id, e);
        resultados.push({
          alvo_id: alvo.id, titulo: alvo.titulo, buscadas: 0, aprovadas: 0, recusadas: 0,
          alertas: 0, repetidos: 0, historico: 0, esgotados: 0, fontes: { erro: String(e) }, top_recusas: [],
        });
        await supabase.from("facilities_radar_alvos")
          .update({ ultimo_erro: String(e).slice(0, 500), ultima_varredura: new Date().toISOString() })
          .eq("id", alvo.id);
      }
    }

    const totalOfertas = resultados.reduce((s, r) => s + r.aprovadas, 0);
    const totalAlertas = resultados.reduce((s, r) => s + r.alertas, 0);

    /* O QUE ESTA RODADA CUSTOU, medido — não estimado. `raspagens` é quantas
       páginas foram pedidas; `creditos` é o que o Firecrawl de fato debitou, e
       os dois raramente batem: a página que exige proxy stealth custa cinco, e
       a que responde 403 custa igual à que responde 200. */
    const saldoDepois = await saldoFirecrawl();
    const custo = (saldoAntes.restantes != null && saldoDepois.restantes != null)
      ? saldoAntes.restantes - saldoDepois.restantes
      : null;

    /* O RAZÃO RECEBE O NÚMERO MEDIDO, não o estimado — esta é a única rodada do
       Hub que consegue medir, porque lê o saldo antes e depois. Quando a leitura
       de saldo falha, registra-se o que se PEDIU: subestima a página que exigiu
       stealth, mas um razão que ignora a rodada inteira mentiria muito mais. */
    await registrarGasto(
      supabase, "radar_varrer",
      custo != null && custo > 0 ? custo : daRodada(),
      { alvos: resultados.length, raspagens: daRodada(), quem },
      custo != null && custo > 0,
    );

    if (exec?.id) {
      await supabase.from("facilities_radar_execucoes").update({
        terminado_em: new Date().toISOString(),
        alvos: resultados.length,
        ofertas: totalOfertas,
        alertas: totalAlertas,
        detalhe: {
          por_alvo: resultados, restante, quem,
          raspagens: daRodada(),
          creditos: custo,
          saldo: saldoDepois.restantes,
          plano: saldoDepois.plano,
        },
      }).eq("id", exec.id);
    }

    return json({
      ok: true,
      alvos: resultados.length,
      ofertas: totalOfertas,
      alertas: totalAlertas,
      restante,
      raspagens: daRodada(),
      creditos: custo,
      saldo: saldoDepois.restantes,
      por_alvo: resultados,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error("facilities-radar", e);
    return json({ ok: false, erro: String((e as Error)?.message ?? e) }, 400);
  }
});
