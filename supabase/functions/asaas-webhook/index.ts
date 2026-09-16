// Edge Function: asaas-webhook
//
// O Asaas avisa; o espelho `asaas_cache` muda em segundos.
//
// POR QUE EXISTE. O espelho enche por varredura, três vezes por dia (07:45, 12:30
// e 17:00 BRT). Entre uma e outra o Hub está cego: em 15/09/2026 uma cobrança foi
// editada de R$ 14.880 para R$ 505 e outra foi criada, e a tela de Notas Fiscais
// não mostrava nenhuma das duas. A ação "cobranca" da asaas-sync resolve quando
// alguém SABE o que procurar; isto resolve sem ninguém precisar saber. As
// varreduras continuam — são elas que curam o que o webhook perder.
//
// O QUE ENTRA:
//   PAYMENT_*   → upsert de `mapPayment(payment)`; cobrança apagada vira
//                 status 'DELETED' (ver `linhaDaCobranca`)
//   INVOICE_*   → upsert de `mapInvoice(invoice)`
//   CUSTOMER_*  → upsert de `mapCustomer(customer)`, se o Asaas mandar (a
//                 documentação de 09/2026 não lista essa família)
//   o resto     → 200, 'ignorado', registrado
// Depois de gravar cobrança ou nota, o cadastro do cliente é conferido e, se
// faltar no espelho, buscado — em segundo plano, depois da resposta.
//
// AUTENTICAÇÃO. O Asaas manda o `authToken` configurado no webhook no header
// `asaas-access-token`. Ele é comparado em tempo constante com o secret
// ASAAS_WEBHOOK_TOKEN. Sem o secret a função recusa tudo com 500 — fecha, não
// abre. `verify_jwt = false` no config.toml: o Asaas não tem JWT do Supabase.
//
// 200 OU 500 — A DECISÃO QUE MANDA NO RESTO. Duas regras do Asaas, lidas juntas:
//   • depois de 15 falhas seguidas ele INTERROMPE a fila do webhook inteiro, e
//     só volta quando alguém reativa; os eventos ficam guardados 14 dias;
//   • no envio SEQUENCIAL (o recomendado), o evento que falha segura os que vêm
//     atrás dele, porque é repetido antes deles.
// Logo um 500 para um evento que NUNCA vai dar certo (um defeito nosso, um dado
// que o Postgres recusa) não é aviso: é travar todas as cobranças da conta atrás
// de uma. Por isso:
//   • token errado ou ausente → 401. Aqui travar é o certo: é configuração
//     errada, nada vai gravar mesmo, e fila interrompida é o aviso mais alto que
//     há. Os 14 dias dão tempo de consertar e reativar.
//   • não conseguimos nem abrir o diário (banco fora) → 500. Nada foi feito, e
//     repetir é exatamente o que conserta.
//   • a gravação no espelho falhou → depende de `valeRepetir`: falha de conexão,
//     tempo esgotado ou banco indisponível ganham 500 (a repetição conserta);
//     erro de dado ou de esquema ganha 200 com o erro no diário (a repetição
//     só travaria a fila). A varredura seguinte cura a linha.
//   • corpo ilegível, evento desconhecido, falha ao buscar o cliente → 200.
//
// SECRETS: ASAAS_WEBHOOK_TOKEN (o mesmo `authToken` do cadastro do webhook),
// ASAAS_API_KEY (releitura e cliente), SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { asaasGet } from "../_shared/asaas.ts";
import { gravar, mapCustomer, mapInvoice, mapPayment, type Linha } from "../_shared/asaas-espelho.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* ------------------------------- autenticação ------------------------------ */

/**
 * Compara os DIGESTS, e não as strings: com `===` o tempo de resposta vaza
 * quantos caracteres do começo acertaram, e com a comparação byte a byte direta
 * o tamanho diferente sai na primeira linha. Dois SHA-256 têm sempre 32 bytes.
 */
async function tokenConfere(recebido: string, esperado: string): Promise<boolean> {
  const digest = async (t: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  const [a, b] = await Promise.all([digest(recebido), digest(esperado)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* --------------------------------- relógios -------------------------------- */

/**
 * Depois de quanto tempo o retrato que veio no evento deixa de ser confiável.
 *
 * O evento traz o objeto COMO ELE ERA quando o evento nasceu. Em regime normal
 * isso é segundos atrás e o retrato é o estado atual. Mas quando a fila fica
 * interrompida e é reativada, o Asaas despeja horas (até 14 dias) de eventos
 * velhos — e gravar um PAYMENT_CREATED de ontem por cima da linha que a varredura
 * de hoje deixou RECEIVED faria a cobrança paga voltar a PENDING. Evento mais
 * velho que isto é relido na API antes de gravar.
 */
const IDADE_CONFIAVEL_MS = 10 * 60_000;

/** Teto da releitura. O `asaasGet` espera até 75s quando a cota bate, e o Asaas
 *  está do outro lado da linha esperando a resposta; passou disto, grava-se o
 *  retrato do evento mesmo — é o que se faria sem a releitura. */
const PRAZO_RELEITURA_MS = 8_000;

/** Idade do evento pelo `dateCreated` ("2024-06-12 16:45:03"). O Asaas não manda
 *  fuso; lemos como horário de Brasília (-03:00, sem horário de verão desde
 *  2019). Se na verdade for UTC, o erro é para o lado seguro: o evento parece MAIS
 *  NOVO, e só se deixa de reler. `null` quando não dá para ler. */
function idadeDoEventoMs(dateCreated: unknown): number | null {
  const m = String(dateCreated ?? "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}-03:00`);
  return Number.isFinite(t) ? Date.now() - t : null;
}

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let relogio: number | undefined;
  const prazo = new Promise<never>((_, rej) => {
    relogio = setTimeout(() => rej(new Error(`prazo de ${ms}ms esgotado`)), ms);
  });
  // O clearTimeout não é higiene: um setTimeout pendente segura o isolate de pé.
  return Promise.race([p, prazo]).finally(() => clearTimeout(relogio));
}

/** Mantém o isolate de pé para o que ficou correndo depois da resposta. */
function manterVivo(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const seguro = p.catch((e) => console.error("asaas-webhook (segundo plano):", e instanceof Error ? e.message : e));
  if (rt?.waitUntil) rt.waitUntil(seguro);
}

/* ------------------------------ o diário (idempotência) -------------------- */

/** Resultado com que o evento está TERMINADO. 'recebido' e 'erro' não estão
 *  aqui de propósito: são o evento cuja gravação caiu no meio, e a repetição do
 *  Asaas precisa poder terminá-lo. */
const FINAIS = new Set(["gravado", "ignorado"]);

/**
 * Registra o evento ANTES de mexer no espelho.
 *
 * Duas entregas simultâneas do mesmo evento (o Asaas garante "pelo menos uma
 * vez", não "exatamente uma") podem as duas ver 'recebido' e as duas gravar. Não
 * faz mal: a gravação é um upsert do mesmo retrato. O que o diário impede é o
 * reprocessamento de evento JÁ terminado — em especial o velho relido na API.
 */
async function abrirEvento(
  supabase: any, linha: { id: string; evento: string; objeto_id: string | null; payload: unknown },
): Promise<"novo" | "retomar" | "duplicado"> {
  const { data, error } = await supabase
    .from("asaas_webhook_eventos")
    .upsert(linha, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`asaas_webhook_eventos insert: ${error.message}`);
  if (data?.length) return "novo";

  const { data: atual, error: e2 } = await supabase
    .from("asaas_webhook_eventos").select("resultado").eq("id", linha.id).maybeSingle();
  if (e2) throw new Error(`asaas_webhook_eventos select: ${e2.message}`);
  return FINAIS.has(String(atual?.resultado ?? "")) ? "duplicado" : "retomar";
}

/** Nunca lança: se nem o diário grava, o evento fica 'recebido', e a repetição
 *  do Asaas (quando houver) retoma. */
async function fecharEvento(supabase: any, id: string, campos: { resultado?: string; erro?: string | null }) {
  const { error } = await supabase.from("asaas_webhook_eventos").update(campos).eq("id", id);
  if (error) console.error(`asaas-webhook: diário do evento ${id} não atualizou:`, error.message);
}

/**
 * A falha de gravação vale um 500 (e a repetição do Asaas)?
 *
 * Só quando o erro veio do `gravar` — que anexa o `codigo` — e o código diz que
 * o problema é de CONEXÃO ou de DISPONIBILIDADE, não de dado:
 *   ''        a requisição nem chegou ao PostgREST (rede, fetch failed)
 *   PGRST0xx  o PostgREST não alcançou o banco (conexão, pool, cache de esquema)
 *   08 conexão · 40 serialização/deadlock · 53 recursos · 57 cancelado/timeout ·
 *   58 erro de sistema
 * Qualquer outra coisa (22 dado inválido, 23 restrição, 42 esquema, um defeito
 * nosso sem `codigo`) dá o mesmo erro na repetição — e travaria a fila.
 */
function valeRepetir(e: unknown): boolean {
  if (!e || typeof e !== "object" || !("codigo" in e)) return false;
  const codigo = String((e as { codigo?: unknown }).codigo ?? "");
  if (codigo === "") return true;
  if (/^PGRST0/.test(codigo)) return true;
  return /^(08|40|53|57|58)/.test(codigo);
}

/* ---------------------------------- eventos -------------------------------- */

type Alvo = { tipo: "payment" | "invoice" | "customer"; objeto: any };

const CAMINHO: Record<Alvo["tipo"], string> = {
  payment: "/payments", invoice: "/invoices", customer: "/customers",
};

function alvoDoEvento(ev: any): Alvo | null {
  const nome = String(ev?.event ?? "");
  if (nome.startsWith("PAYMENT_") && ev?.payment?.id) return { tipo: "payment", objeto: ev.payment };
  if (nome.startsWith("INVOICE_") && ev?.invoice?.id) return { tipo: "invoice", objeto: ev.invoice };
  if (nome.startsWith("CUSTOMER_") && ev?.customer?.id) return { tipo: "customer", objeto: ev.customer };
  return null;
}

/** O id do objeto de qualquer evento, inclusive dos ignorados — para o diário
 *  responder "o que aconteceu com a pay_xxx?" sem abrir o payload. */
function objetoIdDe(ev: any): string | null {
  for (const [k, v] of Object.entries(ev ?? {})) {
    if (k === "account") continue;
    const id = (v as { id?: unknown } | null)?.id;
    if (v && typeof v === "object" && id) return String(id);
  }
  return null;
}

/**
 * Eventos de estorno em que o retrato do evento pode não bastar. O estorno
 * PARCIAL não tem status próprio — a cobrança segue RECEIVED e o valor devolvido
 * só existe em `refunds[]`, que é o que a `asaas_metricas` soma. Se o evento vier
 * sem esse array, a linha gravada apagaria o estorno em vez de registrá-lo; então
 * relê-se a cobrança, que sempre o traz.
 */
const EVENTOS_DE_ESTORNO = new Set([
  "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED", "PAYMENT_REFUND_IN_PROGRESS",
]);

/**
 * A linha de uma cobrança — `mapPayment` e, se apagada, status 'DELETED'.
 *
 * A VARREDURA NUNCA SOUBE DE COBRANÇA APAGADA. As listas do `/payments` não
 * devolvem cobrança com `deleted: true`, então a asaas-sync simplesmente para de
 * ver a linha, que fica congelada no espelho com o último status — PENDING
 * somando no "a receber" da `asaas_metricas`, ou RECEIVED pedindo nota como
 * 'falta' no painel, para sempre. O webhook é o primeiro escritor que sabe da
 * exclusão, e marca do mesmo jeito que o `mapCustomer` já marca cliente apagado:
 * status 'DELETED', que não entra em nenhum `status in (...)` das RPCs. O `dados`
 * continua com o objeto inteiro (e o `deleted: true`). PAYMENT_RESTORED traz
 * `deleted: false` e o status real, e a linha volta sozinha.
 *
 * O `mapPayment` fica intocado de propósito: é o formato que a asaas-sync grava.
 */
function linhaDaCobranca(p: any, apagada: boolean): Linha {
  const linha = mapPayment(p);
  return apagada ? { ...linha, status: "DELETED" } : linha;
}

/**
 * Cadastro do cliente, se faltar no espelho. Cobrança de cliente não espelhado
 * aparece no painel como "cadastro ainda não espelhado" e SOME da fila de emissão
 * (`join`, não `left join`) — gravar a cobrança sem o cliente trocaria um buraco
 * por outro. Roda depois da resposta: se falhar, a fila `asaas_clientes_a_espelhar`
 * da asaas-sync pega na rodada seguinte.
 */
async function espelharCliente(supabase: any, idEvento: string, cus: string) {
  try {
    const { data, error } = await supabase
      .from("asaas_cache").select("id_asaas").eq("tipo", "customer").eq("id_asaas", cus).maybeSingle();
    if (error) throw new Error(`asaas_cache select: ${error.message}`);
    if (data) return;
    const c = await asaasGet<any>(`/customers/${encodeURIComponent(cus)}`);
    if (!c?.id) throw new Error(`cliente ${cus} não veio da API`);
    await gravar(supabase, [mapCustomer(c)]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`asaas-webhook: cliente ${cus} do evento ${idEvento}:`, msg);
    // O evento continua 'gravado' — a cobrança entrou. O erro fica anotado.
    await fecharEvento(supabase, idEvento, { erro: `cliente ${cus}: ${msg}` });
  }
}

/* --------------------------------- handler -------------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);

  const esperado = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  if (!esperado) {
    console.error("asaas-webhook: ASAAS_WEBHOOK_TOKEN não configurado — recusando tudo.");
    return json({ erro: "ASAAS_WEBHOOK_TOKEN não configurado nos secrets das Edge Functions." }, 500);
  }
  const recebido = req.headers.get("asaas-access-token");
  if (!recebido || !(await tokenConfere(recebido, esperado))) {
    return json({ erro: "asaas-access-token ausente ou inválido." }, 401);
  }

  // Autenticado daqui para baixo: o que não se entende responde 200 (ver o topo).
  let ev: any;
  try {
    ev = JSON.parse(await req.text());
  } catch {
    console.error("asaas-webhook: corpo não é JSON — ignorado.");
    return json({ ok: true, resultado: "ignorado", motivo: "corpo não é JSON" });
  }
  const idEvento = String(ev?.id ?? "").trim();
  const nome = String(ev?.event ?? "").trim();
  if (!idEvento || !nome) {
    console.error("asaas-webhook: evento sem `id` ou `event` — ignorado.");
    return json({ ok: true, resultado: "ignorado", motivo: "evento sem id/event" });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const alvo = alvoDoEvento(ev);

  let abertura: "novo" | "retomar" | "duplicado";
  try {
    abertura = await abrirEvento(supabase, {
      id: idEvento, evento: nome, objeto_id: alvo ? String(alvo.objeto.id) : objetoIdDe(ev), payload: ev,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`asaas-webhook: diário indisponível (${nome} ${idEvento}):`, msg);
    return json({ ok: false, erro: msg }, 500);
  }
  if (abertura === "duplicado") return json({ ok: true, resultado: "duplicado" });

  if (!alvo) {
    console.log(`asaas-webhook: ${nome} ${idEvento} ignorado.`);
    await fecharEvento(supabase, idEvento, { resultado: "ignorado", erro: null });
    return json({ ok: true, resultado: "ignorado" });
  }

  try {
    let objeto = alvo.objeto;
    let fonte: "evento" | "releitura" = "evento";

    const idade = idadeDoEventoMs(ev?.dateCreated);
    const velho = idade != null && idade > IDADE_CONFIAVEL_MS;
    const semEstornos = EVENTOS_DE_ESTORNO.has(nome) && !Array.isArray(objeto?.refunds);
    if (velho || semEstornos) {
      try {
        const atual = await comPrazo(
          asaasGet<any>(`${CAMINHO[alvo.tipo]}/${encodeURIComponent(String(objeto.id))}`),
          PRAZO_RELEITURA_MS,
        );
        if (atual?.id) { objeto = atual; fonte = "releitura"; }
      } catch (e) {
        console.warn(`asaas-webhook: releitura de ${objeto.id} falhou, gravando o retrato do evento:`,
          e instanceof Error ? e.message : e);
      }
    }

    let linha: Linha;
    if (alvo.tipo === "payment") {
      // Relido, vale o que a API diz AGORA (pode ter sido restaurada depois).
      // Do evento, o nome do evento também conta.
      const apagada = objeto?.deleted === true || (fonte === "evento" && nome === "PAYMENT_DELETED");
      linha = linhaDaCobranca(objeto, apagada);
    } else if (alvo.tipo === "invoice") {
      linha = mapInvoice(objeto);
    } else {
      linha = mapCustomer(objeto);
    }

    await gravar(supabase, [linha]);
    await fecharEvento(supabase, idEvento, { resultado: "gravado", erro: null });

    const cus = alvo.tipo !== "customer" && linha.status !== "DELETED" ? String(objeto?.customer ?? "") : "";
    if (cus) manterVivo(espelharCliente(supabase, idEvento, cus));

    return json({ ok: true, resultado: "gravado", tipo: alvo.tipo, id_asaas: linha.id_asaas, status: linha.status, fonte });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const repetir = valeRepetir(e);
    console.error(`asaas-webhook: ${nome} ${idEvento} não gravou (${repetir ? "pedindo repetição" : "sem repetição"}):`, msg);
    await fecharEvento(supabase, idEvento, { resultado: "erro", erro: msg });
    return json({ ok: false, resultado: "erro", repetir, erro: msg }, repetir ? 500 : 200);
  }
});
