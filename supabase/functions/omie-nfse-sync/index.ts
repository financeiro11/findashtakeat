// Edge Function: omie-nfse-sync
//
// O lado Omie da tela /operacional/notas-fiscais: espelha as Ordens de Serviço e
// emite a NFS-e das cobranças do Asaas que ainda não têm nota.
//
// ONDE A NOTA MORA. Não em `servicos/nfse` — nenhum método existe lá (medido:
// ListarNFSe, ConsultarNFSe, ObterNFSe, EmitirNFSe, GerarNFSe, todos respondem
// "Method not exists"). A NFS-e é um pedaço da ORDEM DE SERVIÇO, e o caminho é:
//
//     OS na etapa 50  --FaturarLoteOS(cEtapa)-->  faturada  ==>  NFS-e emitida
//
// e quem conta o que aconteceu é `StatusOS` (cFaturada + ListaRpsNfse[] com nNfse,
// nRps, cStatusRps e o XML). O `DetalhesNfse` que vem no ListarOS está VAZIO em
// todas as 1.207 OS, faturadas inclusive — quem parar nele conclui, errado, que
// nenhuma nota foi emitida.
//
// TROCAR A ETAPA NÃO FATURA. Esta função nasceu acreditando que sim — subia a OS
// até a etapa 60 ("Faturado") e dava a nota por emitida. O Omie aceita a chamada,
// devolve sucesso e NÃO FAZ NADA: 60 é o lugar onde a OS CAI depois de faturada,
// não um botão. Duas emissões reais foram reportadas como feitas sem que nota
// nenhuma existisse. Quem fatura é outro endpoint, `servicos/oslote`:
//
//     FaturarLoteOS { cEtapa } → nIdLoteFat → ListarLotesOS (DONE/ERROR, por OS)
//
// E ELE FATURA A ETAPA INTEIRA. Não aceita filtro por OS: manda para a prefeitura
// tudo o que estiver naquela etapa. Em 20/08/26 a etapa "50" (Faturar) guardava
// 523 OS antigas, R$ 188 mil, restos do lote manual de junho — um `FaturarLoteOS
// { cEtapa: "50" }` inocente emitiria as 523. Por isso a emissão do Hub ISOLA a OS
// numa etapa vazia antes de faturar, e confere que ela está sozinha lá (ver
// `faturarIsolada`). O raio da chamada é o que essa conferência disser, não o que
// a intenção de quem chamou supunha.
//
// SÓ RECEBIDA VIRA NOTA, E ESTORNADA NUNCA. A regra mora no Postgres
// (`nfse_bloqueio_emissao`, chamada pela fila e pelas candidatas) e é conferida
// DE NOVO aqui contra o Asaas ao vivo, cobrança por cobrança, no instante da
// emissão — ver `conferirNoAsaas`. Espelho é retrato de ontem; nota fiscal é
// escrita de hoje que não se apaga.
//
// A EXCEÇÃO TEM NOME: AVULSA (`body.avulsa: true`). São duas réguas, não uma
// afrouxada:
//   • a RODADA automática segue só em RECEIVED/RECEIVED_IN_CASH — intocada;
//   • a AVULSA, que uma pessoa liga no painel e assina, vai até `CONFIRMED`.
// A diferença não é o direito de emitir (as duas exigem nota: o fato gerador do
// ISS é a prestação do serviço, não a liquidação) — é quem responde se a
// liquidação não vier. Numa rodada, ninguém; num ato, quem clicou, e o nome
// dele fica em `nf_emissoes.avulsa` + `operador`. O ESTORNO barra nas duas, e
// não há chave que o abra. A avulsa também não toca em nenhuma guarda de
// duplicata (sombra, carimbo `cCodIntOS`, nota do Asaas ao vivo): essas
// respondem "esta nota já saiu?", que é outra pergunta.
//
// Ações (body.action):
//   "espelhar" (default) → lista as OS e atualiza nf_os_omie. Consulta StatusOS só
//                          de quem precisa (ver ehStatusPendente).
//   "previa"             → o que a emissão MANDARIA, sem mandar nada.
//   "emitir"             → cria/fatura de verdade. Escrita fiscal irreversível.
//                          Desde 25/08/26 usa o MESMO motor de lote da rodada
//                          diária (`emitirDia` com `ids`): a leva inteira entra na
//                          etapa de isolamento e sai UM `FaturarLoteOS`. Por isso
//                          ninguém volta com número de nota na mão — todas voltam
//                          "em processamento" e o `espelhar` grava o número.
//                          Com `avulsa: true`, a régua larga (ver acima). Só vale
//                          acompanhada de `ids`: a fila automática nunca é avulsa.
//
// Auth: usuário logado OU cron (x-cron-token), no padrão do repo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { asaasGet, asaasUpload } from "../_shared/asaas.ts";
import { espelhoPdf, lerXmlNfse } from "../_shared/danfse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://app.omie.com.br/api/v1";
const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "16/05/2026" → "2026-05-16". O Omie fala pt-BR em toda data. */
function isoDeBR(s: unknown): string | null {
  const m = String(s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
/** "2026-05-16" → "16/05/2026". */
function brDeISO(s: unknown): string {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/* --------------------------------- Omie ---------------------------------- */

async function omieCall<T = any>(
  path: string, call: string, param: Record<string, unknown>,
  opts: { semRetentativa?: boolean } = {},
): Promise<T> {
  const app_key = Deno.env.get("OMIE_APP_KEY");
  const app_secret = Deno.env.get("OMIE_APP_SECRET");
  if (!app_key || !app_secret) throw new Error("Credenciais do Omie ausentes (OMIE_APP_KEY / OMIE_APP_SECRET).");

  let ultimo: unknown = null;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${BASE}/${path}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
    });
    const texto = await res.text();
    let data: any;
    try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }

    /* O Omie recusa de DUAS formas, e ignorar a segunda é caro.
     *
     *  • HTTP 500 + { faultstring } — a conhecida, de erro de estrutura.
     *  • HTTP 200 + { codigo_status: "3", descricao_status: "…" } — SEM
     *    faultstring, com cara de sucesso. Foi assim que o `TrocarEtapaOS`
     *    respondeu "Não é possível trocar a etapa … para [60]. Utilize o
     *    processo de faturamento"; como só `faultstring` era checada, a função
     *    deu a emissão por feita e devolveu "1 nota emitida" para uma nota que
     *    nunca existiu. Erro que se anuncia como sucesso some da lista do que
     *    falta — é o pior tipo.
     *
     * `codigo_status: "0"` é sucesso; qualquer outro valor é recusa.
     */
    const fault = data && typeof data === "object" ? data.faultstring : null;
    const statusNegocio = data && typeof data === "object" ? data.codigo_status : undefined;
    const recusaDeNegocio = statusNegocio !== undefined && String(statusNegocio) !== "0";
    if (res.ok && !fault && !recusaDeNegocio) return data as T;

    const msg = fault
      || (recusaDeNegocio ? String(data.descricao_status ?? `codigo_status=${statusNegocio}`) : null)
      || (typeof data === "string" ? data : JSON.stringify(data));
    ultimo = new Error(`Omie ${call} [${res.status}]: ${msg}`);
    // A trava do Omie é POR MÉTODO: duas consultas diferentes do mesmo método ao
    // mesmo tempo esbarram nela igual. Por isso este módulo é sequencial.
    //
    // `semRetentativa` existe para as ESCRITAS que não se pode repetir no escuro.
    // "Consumo redundante detectado" não quer dizer que a chamada falhou — quer
    // dizer "você já mandou isso". Repetir um `FaturarLoteOS` nesse estado foi o
    // que fez a função dar por perdido um lote que JÁ tinha nascido, e então
    // desfazer o isolamento com o faturamento em andamento. Quem chama com esta
    // opção trata o erro procurando o efeito, não insistindo.
    if (!opts.semRetentativa
      && /425|redundante|processando|5020|too many|bloqueada|soap-error|broken response|timeout|50[234]|existe uma requisi/i.test(String(msg)) && i < 4) {
      await dorme(1500 * 2 ** i);
      continue;
    }
    throw ultimo;
  }
  throw ultimo;
}

const mensagemDoOmie = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Omie \w+ \[\d+\]:\s*/i, "").replace(/^ERROR:\s*/i, "").trim();

/* ------------------------------- espelhar -------------------------------- */

/** Todas as OS, paginadas. `ListarOS` só aceita `pagina`/`registros_por_pagina`. */
async function listarOS(): Promise<any[]> {
  const out: any[] = [];
  let pagina = 1, totalPaginas = 1;
  do {
    const r = await omieCall<any>("servicos/os", "ListarOS", {
      pagina, registros_por_pagina: 500, apenas_importado_api: "N",
    });
    out.push(...(r?.osCadastro ?? []));
    totalPaginas = Number(r?.total_de_paginas ?? 1);
    pagina++;
  } while (pagina <= totalPaginas && pagina <= 40);
  return out;
}

/**
 * Vale gastar uma chamada de StatusOS nesta OS?
 *
 * O status custa UMA requisição por OS — 1.207 delas a cada sync seria uma
 * varredura de vários minutos contra a trava por método do Omie (e estoura o
 * teto de 150s da Edge Function). Só interessa:
 *   • OS faturada que nunca foi lida;
 *   • OS faturada cujo RPS não está autorizado ('004') E cuja última leitura já
 *     tem idade — a nota pode ter saído do processamento desde então.
 * OS aberta não tem nota para ler: o `cFaturada` da própria listagem já responde.
 *
 * A CARÊNCIA não é economia, é o que faz a varredura CONVERGIR. Sem ela, as 129
 * OS cujo RPS ficou preso em '003' (enviado, nunca autorizado) voltavam à fila
 * em todo sync; como a fila é ordenada e cortada num teto, eram sempre as mesmas
 * que cabiam — e as OS antigas nunca chegavam a ser lidas uma primeira vez.
 */
const CARENCIA_STATUS_H = 12;
/** Por quantos dias uma nota conta como "recém-nascida" e fura a carência. */
const NASCENDO_DIAS = 2;

function ehStatusPendente(
  os: any,
  jaGravada: { nfse_status?: string | null; status_lido_em?: string | null } | undefined,
): boolean {
  const faturada = String(os?.InfoCadastro?.cFaturada ?? "N") === "S";
  if (!faturada) return false;
  if (!jaGravada?.status_lido_em) return true;          // nunca lida
  if (jaGravada.nfse_status === "004") return false;    // já tem nota; não muda mais

  /* NOTA RECÉM-NASCIDA NÃO ESPERA CARÊNCIA.
   *
   * A carência foi feita para as presas de junho, e virou armadilha para as
   * novas: quem emite hoje lê o status segundos depois do faturamento, quando o
   * RPS ainda está em '001' (gerado, indo para a prefeitura). Medido na OS 1629:
   * o lote fechou às 17:09 e o RPS ainda não tinha número. Com a carência valendo
   * para ela, o espelho só releria 12 horas depois — e a tela mostraria "sem
   * nota" a tarde inteira para uma nota que nasceu em minutos. É justamente a
   * emissão do dia que alguém está olhando.
   *
   * A janela é por DATA DE FATURAMENTO, e não por "status ainda não é 004": um
   * RPS preso em '001' ou sem status nenhum voltaria à fila para sempre, que é o
   * loop que a carência existe para evitar. Passados os dois dias, a nota que não
   * nasceu não é mais recém-nascida — é presa, e entra na fila das presas.
   */
  const fat = isoDeBR(os?.InfoCadastro?.dDtFat);
  const diasDesdeFat = fat ? (Date.now() - new Date(`${fat}T00:00:00Z`).getTime()) / 86_400_000 : Infinity;
  if (diasDesdeFat <= NASCENDO_DIAS) return true;

  const idadeH = (Date.now() - new Date(jaGravada.status_lido_em).getTime()) / 3_600_000;
  return idadeH >= CARENCIA_STATUS_H;
}

/**
 * A mensagem da prefeitura em uma linha legível.
 *
 * Nem toda prefeitura responde com mensagem: 22 das OS presas trouxeram no campo
 * `cDescricao` uma PÁGINA HTML inteira de 482 bytes cujo conteúdo útil era
 * "403 - Forbidden: Access is denied." — o webservice recusando a conexão, não a
 * nota sendo criticada. Guardar o HTML cru enche a coluna de CSS e não diz nada a
 * ninguém; o que serve é o <title> (ou o texto sem marcação), curto.
 */
function textoDaMensagem(bruto: unknown): string {
  const s = String(bruto ?? "").trim();
  if (!s) return "";
  if (!/<\s*(!doctype|html|body|head)\b/i.test(s)) return s;
  const titulo = s.match(/<title>(.*?)<\/title>/is)?.[1]?.trim();
  const limpo = (titulo || s.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
  return limpo ? `A prefeitura respondeu "${limpo.slice(0, 120)}" (recusa do webservice, não crítica da nota).` : "";
}

/** ListaRpsNfse[0] achatada. */
function nfseDoStatus(s: any): Record<string, unknown> {
  const rps = Array.isArray(s?.ListaRpsNfse) ? s.ListaRpsNfse[0] : null;
  if (!rps) return { nfse_numero: null, nfse_rps: null, nfse_status: null, nfse_lote: null, nfse_xml: null, nfse_verificacao: null, nfse_mensagem: null };
  return {
    // "0000000011222" → "11222": o zero à esquerda é enfeite do Omie e atrapalha
    // procurar o número na prefeitura.
    nfse_numero: String(rps.nNfse ?? "").replace(/^0+/, "") || null,
    nfse_rps: String(rps.nRps ?? "") || null,
    nfse_status: String(rps.cStatusRps ?? "") || null,
    nfse_lote: rps.nLote ? Number(rps.nLote) : null,
    nfse_xml: String(rps.xml_distr ?? "") || null,
    nfse_verificacao: String(rps.cCodVerif ?? "") || null,
    /* A recusa da prefeitura, em português. É a única coisa na resposta que diz
     * o que FAZER: "E0240 : O CEP informado para o endereço nacional do tomador
     * do serviço não existe ou não pertence ao município…" manda arrumar o
     * cadastro do cliente, não esperar a fila andar. */
    nfse_mensagem: (Array.isArray(rps.mensagens) ? rps.mensagens : [])
      .map((m: any) => textoDaMensagem(m?.cDescricao)).filter(Boolean).join(" · ") || null,
  };
}

/**
 * O que já está no espelho — PAGINADO, e isso não é zelo.
 *
 * O PostgREST corta a resposta em 1.000 linhas SEM AVISAR, e a tabela tem 1.207
 * OS. Um `select` simples devolvia 1.000 e as 207 restantes chegavam aqui como
 * "nunca lidas"; como a fila de status é ordenada e cortada num teto, eram
 * sempre as mesmas fantasmas que cabiam nela, e a varredura andava ~30 OS por
 * rodada em vez de 120 — parecendo lentidão do Omie quando era o teto do
 * Postgres. Mesma armadilha do `.limit(2000)` da classificação do Asaas.
 */
async function lerEspelho(supabase: any): Promise<any[]> {
  const PAGINA = 1000;
  const out: any[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("nf_os_omie")
      .select("n_cod_os, nfse_status, status_lido_em")
      .order("n_cod_os", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`nf_os_omie select: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGINA) return out;
  }
}

/**
 * Fecha no diário a emissão que ficou com a última palavra errada.
 *
 * `em_processamento` é um estado honesto no instante em que é gravado: o lote foi
 * disparado e a Edge Function acabou antes da prefeitura responder. Só que a nota
 * nasce DEPOIS, e ninguém volta para contar — o diário da OS 1629 terminava em
 * "ainda em processamento" com a NFS-e 16902 autorizada e visível na tela ao lado.
 * Rastro de ato fiscal que para no meio é rastro que faz alguém emitir de novo.
 *
 * Quem fecha é o sync, que é justamente quem descobre o desfecho.
 */
async function fecharEmProcessamento(supabase: any, nCodOS: number, numero: string | null) {
  /* A CONDIÇÃO É "O DIÁRIO DISCORDA DA REALIDADE", não "a última palavra foi
   * em_processamento" — e essa distinção custou uma rodada.
   *
   * Em 26/08/26, 14 OS foram faturadas por um lote que a função deu como
   * fracassado (a listagem da etapa atrasou; ver `emitirDia`). Como ela achou
   * que nada tinha sido despachado, não gravou linha `em_processamento` nenhuma
   * — e o fechamento, que procurava só por essas, não tinha o que fechar. As 14
   * notas nasceram e o Registro seguiu mostrando "Falhou", que é a mesma mentira
   * do "No forno" eterno, virada do avesso.
   *
   * Então: pega-se o último passo de FATURAMENTO da OS, qualquer que tenha sido
   * o resultado, e fecha-se se ele ainda não é o `ok` desta nota. */
  const { data: ultimos } = await supabase
    .from("nf_emissoes")
    .select("id, id_asaas, acao, operador, usuario, resultado, nfse_numero")
    .eq("n_cod_os", nCodOS)
    .in("acao", ["faturar", "criar_e_faturar"])
    .order("criado_em", { ascending: false })
    .limit(5);
  const aberta = (ultimos ?? [])[0] ?? null;
  if (!aberta) return;
  // Já fechado com ESTA nota: nada a acrescentar. (Sem esta guarda, cada sync
  // acrescentaria uma linha `ok` idêntica à anterior, todo dia, para sempre.)
  if ((ultimos ?? []).some((l: any) => l.resultado === "ok" && l.nfse_numero && l.nfse_numero === numero)) return;

  // Uma linha nova, não um UPDATE: o diário é append-only, e o "estava em
  // processamento às 17:08" é verdade que aconteceu e não se apaga.
  await supabase.from("nf_emissoes").insert({
    id_asaas: aberta.id_asaas,
    n_cod_os: nCodOS,
    acao: aberta.acao,
    resultado: "ok",
    nfse_numero: numero,
    usuario: aberta.usuario ?? null,
    operador: aberta.operador ?? null,
    erro: `Desfecho lido pelo sync: o lote concluiu e a NFS-e ${numero ?? "?"} foi autorizada.`,
  });

  /* O E-MAIL, no diário, para ninguém ter de abrir o Omie.
   *
   * Não existe API de e-mail no Omie (sondado com controle — ver a migration
   * `nf_os_email_da_nota`), então isto não é a leitura de um log de envio: é o
   * registro do GATILHO, que é determinístico. A OS foi gravada com `cEnvLink=S`
   * e um destinatário, e o instante em que o Omie dispara é este — a autorização
   * da nota. Nota recusada (003) não gera esta linha, porque não gera e-mail.
   *
   * A linha diz "disparado", nunca "entregue": entrega ninguém prova por API, e
   * prometer isso na tela seria o tipo de mentira que este módulo evita. */
  const { data: os } = await supabase
    .from("nf_os_omie").select("email_envio, email_destino").eq("n_cod_os", nCodOS).maybeSingle();
  if (os?.email_envio) {
    await supabase.from("nf_emissoes").insert({
      id_asaas: aberta.id_asaas,
      n_cod_os: nCodOS,
      acao: "email",
      resultado: "ok",
      nfse_numero: numero,
      usuario: aberta.usuario ?? null,
      operador: aberta.operador ?? null,
      erro: `O Omie disparou o e-mail com o link da NFS-e ${numero ?? "?"} para ${os.email_destino || "o e-mail do cadastro do cliente no Omie"}.`,
    });
  }
}

/**
 * O DESFECHO RUIM, QUE NINGUÉM VOLTAVA PARA CONTAR.
 *
 * `fecharEmProcessamento` só era chamada com o RPS autorizado (`004`). Ou seja:
 * dos três desfechos possíveis de um lote, o diário fechava UM. Os outros dois
 * ficavam com "em processamento" como última palavra, para sempre:
 *
 *   • a OS que o **Omie** recusou no próprio faturamento — "Para emitir a NFS-e
 *     falta preencher o Número do Endereço". Ela nunca virou RPS, então
 *     `nfse_status` fica nulo e o `StatusOS` não tem o que contar: a razão existe
 *     só no `detalhes[]` do lote, que ninguém relia depois do disparo;
 *   • a OS faturada cujo RPS a **prefeitura** recusou (`003`). Essa o espelho até
 *     lia — a mensagem estava gravada em `nf_os_omie.nfse_mensagem` —, mas o
 *     diário não ficava sabendo.
 *
 * Medido em 26/08/26: 16 cobranças (R$ 6.257) com o selo "No forno" havia 12h,
 * 15 delas recusadas pelo Omie por endereço incompleto do cliente. Nenhuma ia
 * sair, e a tela dizia que estavam saindo. "No forno" que não expira é pior do
 * que "falhou": é a única fila que ninguém revisita, porque a tela promete que o
 * tempo resolve.
 *
 * Quem fecha continua sendo o sync — é ele quem descobre o desfecho. O que muda é
 * que agora ele descobre os três.
 */

/** O lote de faturamento gravado com a linha "em processamento". */
function loteDaLinha(l: { payload?: any; erro?: string | null }): number {
  const doPayload = Number(l?.payload?.lote ?? 0);
  if (doPayload) return doPayload;
  /* As linhas anteriores a esta versão só têm o número dentro da frase — e a
   * frase é nossa, escrita em `emitirDia` ("Lote 5513639532 disparado com…").
   * Ler dali é feio, e é o que permite fechar o que JÁ está aberto em vez de só
   * acertar daqui para frente. */
  const m = /lote\s+(\d{6,})/i.exec(String(l?.erro ?? ""));
  return m ? Number(m[1]) : 0;
}

/** Quantas horas essa linha está em aberto. */
const horasDesde = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3.6e6;

async function fecharRecusadas(supabase: any): Promise<Record<string, unknown>> {
  // 1. As linhas em aberto. A janela é generosa de propósito: o custo é uma
  //    leitura do Postgres e o que se procura é justamente o que ficou esquecido.
  const desde = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: abertas } = await supabase
    .from("nf_emissoes")
    .select("id_asaas, n_cod_os, acao, usuario, operador, criado_em, erro, payload")
    .eq("resultado", "em_processamento")
    .gte("criado_em", desde)
    .not("n_cod_os", "is", null)
    .order("criado_em", { ascending: false })
    .range(0, 499);
  if (!abertas?.length) return { abertas: 0, fechadas: 0 };

  // Uma por OS, a mais recente: a mesma OS pode ter sido disparada mais de uma vez.
  const porOS = new Map<number, any>();
  for (const a of abertas) if (!porOS.has(Number(a.n_cod_os))) porOS.set(Number(a.n_cod_os), a);

  /* Quem já ganhou desfecho DEPOIS não está em aberto. Só `faturar` e
   * `criar_e_faturar` contam: `criar_os` é passo anterior e `email` é posterior à
   * nota — nenhum dos dois responde "esta emissão terminou". */
  const { data: desfechos } = await supabase
    .from("nf_emissoes")
    .select("n_cod_os, criado_em")
    .in("n_cod_os", [...porOS.keys()])
    .in("acao", ["faturar", "criar_e_faturar"])
    .neq("resultado", "em_processamento")
    .order("criado_em", { ascending: false })
    .range(0, 999);
  const fechadoEm = new Map<number, string>();
  for (const d of desfechos ?? []) {
    const k = Number(d.n_cod_os);
    if (!fechadoEm.has(k)) fechadoEm.set(k, String(d.criado_em));
  }
  for (const [os, a] of [...porOS]) {
    const q = fechadoEm.get(os);
    if (q && q > String(a.criado_em)) porOS.delete(os);
  }
  if (!porOS.size) return { abertas: 0, fechadas: 0 };

  // 2. O espelho da OS diz o que a PREFEITURA respondeu; o lote diz o que o OMIE
  //    respondeu antes dela. Os dois desfechos ruins moram em lugares diferentes.
  const { data: espelho } = await supabase
    .from("nf_os_omie")
    .select("n_cod_os, c_num_os, faturada, nfse_status, nfse_numero, nfse_mensagem")
    .in("n_cod_os", [...porOS.keys()]);
  const osPor = new Map<number, any>();
  for (const o of espelho ?? []) osPor.set(Number(o.n_cod_os), o);

  /* Um `ListarLotesOS` por lote, ESPAÇADO. A trava do Omie é por método: duas
   * leituras coladas devolvem "Consumo redundante detectado. Aguarde N segundos"
   * e derrubam o resto da rodada. Na prática são zero, um ou dois lotes. */
  const lotes = new Map<number, number[]>();
  for (const [os, a] of porOS) {
    const lote = loteDaLinha(a);
    if (!lote) continue;
    const atual = lotes.get(lote);
    if (atual) atual.push(os); else lotes.set(lote, [os]);
  }
  const veredito = new Map<number, { status: string; mensagem: string }>();
  let primeiro = true;
  for (const lote of lotes.keys()) {
    if (!primeiro) await dorme(5000);
    primeiro = false;
    const r = await omieCall<any>("servicos/oslote", "ListarLotesOS", {
      nPagina: 1, nRegistros: 5, nIdLoteFat: lote, cExibirDetalhes: "S",
    }).catch(() => null);
    const reg = (r?.lotes ?? []).find((l: any) => Number(l?.nIdLoteFat) === lote) ?? null;
    // Lote ainda rodando: "no forno" continua sendo a verdade. Não se fecha.
    if (!reg || String(reg.cStatus ?? "") === "RUNNING") continue;
    for (const d of (reg.detalhes ?? [])) {
      const nCodOS = Number(d?.nIdPedido ?? d?.nCodOS ?? 0);
      if (nCodOS) {
        veredito.set(nCodOS, {
          status: String(d?.cStatus ?? ""),
          mensagem: textoDaMensagem(d?.cMensagem ?? d?.cDesStatus ?? ""),
        });
      }
    }
  }

  // 3. A linha de encerramento — append-only, como todo o resto do diário.
  const novas: any[] = [];
  const encerrar = (a: any, erro: string) => novas.push({
    id_asaas: a.id_asaas, n_cod_os: a.n_cod_os, acao: a.acao, resultado: "erro",
    usuario: a.usuario ?? null, operador: a.operador ?? null,
    payload: a.payload ?? null, erro: erro.slice(0, 500),
  });

  for (const [os, a] of porOS) {
    const esp = osPor.get(os) ?? {};
    const nome = `OS ${esp.c_num_os ?? os}`;
    const v = veredito.get(os) ?? null;

    // a) O Omie recusou no faturamento: a OS nem chegou a virar RPS.
    if (v && v.status === "ERROR") {
      encerrar(a, `O Omie recusou o faturamento da ${nome}: ${v.mensagem} ` +
        "Nenhuma nota foi emitida e o tempo não resolve — isto é cadastro do cliente no Omie.");
      continue;
    }
    // b) A prefeitura recusou o RPS. Receita faturada sem nota válida.
    if (String(esp.nfse_status ?? "") === "003") {
      encerrar(a, `A prefeitura recusou o RPS da ${nome}` +
        (esp.nfse_mensagem ? `: ${textoDaMensagem(esp.nfse_mensagem)}` : ".") +
        ' A OS consta faturada e não existe nota válida. Não há reenvio pela API — é o botão "Reenviar NFS-e" da tela do Omie.');
      continue;
    }
    // c) A nota nasceu e o `004` escapou do teto de status desta rodada.
    if (String(esp.nfse_status ?? "") === "004" && esp.nfse_numero) {
      await fecharEmProcessamento(supabase, os, String(esp.nfse_numero));
      continue;
    }
    /* d) Sem veredito do lote e sem faturamento: nada afirma que falhou, e nada
     *    sustenta mais que esteja saindo. A emissão tem dois tempos assíncronos e
     *    leva MINUTOS; depois de 6h, "no forno" deixou de ser uma leitura
     *    possível do mesmo dado. Fecha dizendo exatamente o que se sabe. */
    if (!v && esp.faturada !== true && horasDesde(a.criado_em) >= 6) {
      const lote = loteDaLinha(a);
      encerrar(a, `${nome}: passaram-se ${Math.floor(horasDesde(a.criado_em))}h desde o disparo e a OS ` +
        `continua sem faturamento no Omie` +
        (lote ? ` (o lote ${lote} não devolveu detalhe para ela)` : "") +
        ". Nenhuma nota foi emitida.");
    }
  }

  if (novas.length) await supabase.from("nf_emissoes").insert(novas);
  return { abertas: porOS.size, fechadas: novas.length, lotes_lidos: lotes.size };
}

async function espelhar(supabase: any, opts: { tetoStatus: number }) {
  const [osLista, gravadas, { data: cacheClientes }] = await Promise.all([
    listarOS(),
    lerEspelho(supabase),
    supabase.from("omie_cache").select("dados").eq("chave", "clientes").maybeSingle(),
  ]);

  // Código do cliente no Omie → CNPJ/CPF. É esse documento que casa com o Asaas;
  // por nome não casa (o Asaas guarda o fantasia, o Omie a razão social).
  const docPorCodigo = new Map<string, string>();
  for (const c of ((cacheClientes?.dados as any[]) ?? [])) {
    const d = soDigitos(c?.cnpj_cpf);
    if (c?.codigo && d) docPorCodigo.set(String(c.codigo), d);
  }

  const jaPor = new Map<number, any>();
  for (const g of gravadas) jaPor.set(Number(g.n_cod_os), g);

  const linhas: any[] = [];
  const paraStatus: any[] = [];

  for (const os of osLista) {
    const cab = os?.Cabecalho ?? {};
    const info = os?.InfoCadastro ?? {};
    const nCodOS = Number(cab.nCodOS);
    if (!nCodOS) continue;

    linhas.push({
      n_cod_os: nCodOS,
      c_num_os: String(cab.cNumOS ?? "") || null,
      c_cod_int_os: String(cab.cCodIntOS ?? "") || null,
      n_cod_cli: cab.nCodCli ? Number(cab.nCodCli) : null,
      cnpj_cpf: docPorCodigo.get(String(cab.nCodCli)) ?? null,
      valor: Number(cab.nValorTotal ?? 0),
      data_previsao: isoDeBR(cab.dDtPrevisao),
      etapa: String(cab.cEtapa ?? "") || null,
      faturada: String(info.cFaturada ?? "N") === "S",
      cancelada: String(info.cCancelada ?? "N") === "S",
      data_faturamento: isoDeBR(info.dDtFat),
      dados: os,
      atualizado_em: new Date().toISOString(),
    });

    if (ehStatusPendente(os, jaPor.get(nCodOS))) paraStatus.push(nCodOS);
  }

  // Grava a listagem primeiro: mesmo que a leitura de status pare no meio (trava
  // do Omie), o espelho da OS fica correto e o próximo sync retoma só o status.
  const LOTE = 500;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await supabase.from("nf_os_omie").upsert(linhas.slice(i, i + LOTE), { onConflict: "n_cod_os" });
    if (error) throw new Error(`nf_os_omie upsert: ${error.message}`);
  }

  // Status, sequencial e com teto. Quem NUNCA foi lida vem primeiro — é a única
  // que ainda pode revelar uma nota desconhecida; a releitura de quem já foi lida
  // é só esperança de que o RPS preso tenha destravado. Dentro de cada grupo, do
  // mais recente para o mais antigo: é a OS de ontem que alguém está esperando
  // ver na tela, não a de abril.
  const nunca = paraStatus.filter((n) => !jaPor.get(n)?.status_lido_em).sort((a, b) => b - a);
  const relerm = paraStatus.filter((n) => jaPor.get(n)?.status_lido_em).sort((a, b) => b - a);
  const alvos = [...nunca, ...relerm].slice(0, opts.tetoStatus);
  let lidos = 0, comNota = 0;
  const erros: string[] = [];

  for (const nCodOS of alvos) {
    try {
      const s = await omieCall<any>("servicos/os", "StatusOS", { nCodOS });
      const nfse = nfseDoStatus(s);
      if (nfse.nfse_status === "004") { comNota++; await fecharEmProcessamento(supabase, nCodOS, nfse.nfse_numero as string | null); }
      await supabase.from("nf_os_omie").update({
        ...nfse,
        c_cod_int_os: String(s?.cCodIntOS ?? "") || null,
        status_lido_em: new Date().toISOString(),
      }).eq("n_cod_os", nCodOS);
      lidos++;
    } catch (e) {
      erros.push(`${nCodOS}: ${mensagemDoOmie(e).slice(0, 120)}`);
      if (erros.length > 8) break; // o Omie está barrando; não adianta insistir
    }
  }

  /* O desfecho ruim, DEPOIS do laço de status — é ele quem acabou de trazer da
   * prefeitura o `003` e a mensagem que explica a recusa. E `.catch`: fechar o
   * diário é conserto, não pode derrubar o espelho que já foi gravado. */
  const recusas = await fecharRecusadas(supabase)
    .catch((e) => ({ erro: mensagemDoOmie(e).slice(0, 200) }));

  return {
    os_listadas: linhas.length,
    status_pendentes: paraStatus.length,
    status_lidos: lidos,
    com_nota: comNota,
    recusas,
    erros: erros.slice(0, 5),
  };
}

/* --------------------------- a nota no Asaas ------------------------------ */

/**
 * A NOTA, ANEXADA NA COBRANÇA.
 *
 * A pergunta que originou isto: "onde aparece no Asaas que a cobrança foi
 * faturada e a nota emitida?". Em lugar nenhum — a integração era de mão única.
 * O elo existia só do outro lado (a OS nasce com `cCodIntOS = id_asaas`) e aqui
 * no Hub; do portal do Asaas, a cobrança recebida em julho e a cobrança recebida
 * em julho que virou NFS-e em agosto eram indistinguíveis.
 *
 * O CAMINHO ÓBVIO NÃO EXISTE — MEDIDO, NÃO SUPOSTO. A primeira versão disto
 * gravava o número da nota em `externalReference`, o campo do Asaas para "o
 * identificador disto no seu sistema", vazio em toda a base. O `PUT` foi recusado
 * na cobrança `pay_uw42beld2bddv6z5` (OS 1629, NFS-e 16902, RECEIVED) em
 * 24/08/26, com o texto do próprio Asaas:
 *
 *     400 invalid_object — "Só é possível editar cobranças pendentes ou vencidas."
 *
 * E nota só se emite de cobrança RECEBIDA, que é exatamente o que a frase exclui:
 * numa cobrança que virou nota, NENHUM campo é editável. O que sobra é o anexo —
 * `POST /payments/{id}/documents` ACRESCENTA um arquivo à cobrança em vez de
 * alterá-la, e por isso não esbarra na regra.
 *
 * O QUE ISSO SIGNIFICA PARA O CLIENTE. O anexo não é marca interna: o Asaas o
 * publica na fatura e o pagador baixa. Foi escolha feita com essa consequência à
 * vista — a NFS-e passa a chegar ao cliente pelo mesmo lugar onde ele pagou.
 *
 * O QUE É ANEXADO. O XML da NFS-e, que é o documento fiscal de verdade; o Omie
 * não devolve PDF (o campo `danfe` do RPS vem vazio nesta prefeitura). O link do
 * XML é assinado e MORRE EM ~24H, então anexar o link não serviria de nada: o
 * arquivo é baixado e reenviado como bytes. O que fica na cobrança é a nota, não
 * um endereço com prazo.
 *
 * ANEXO NÃO É CAMPO — MANDAR DUAS VEZES CRIA DOIS. Não existe upsert aqui. A
 * defesa é dupla, e a que vale é a de fora: antes de subir, a lista de documentos
 * da PRÓPRIA cobrança é lida e procurada pelo número da nota. A coluna
 * `asaas_anexado_em` é só o atalho que poupa essa leitura na segunda passada.
 */

/**
 * O nome do arquivo na cobrança, SEM extensão — os dois anexos da mesma nota (o
 * PDF e o XML) compartilham esta base. É o que o cliente vê na fatura, e é por
 * ele que a releitura reconhece o que já subiu.
 */
function nomeDoAnexo(numero: string, os: string): string {
  return `NFS-e ${numero} - OS ${os}`;
}

/** Bytes → base64, para devolver o PDF na prévia sem depender de _shared/omie.ts. */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
/** Id de cobrança do Asaas — o `_` do prefixo é literal, não curinga de LIKE. */
const EH_ID_ASAAS = /^pay_[a-z0-9]+$/i;

/**
 * A URL assinada do Omie ainda vale? Gêmea de `xmlAindaVale` em
 * [src/lib/notasFiscais.ts] — lá para não oferecer link morto na tela, aqui para
 * não anexar um arquivo que não vai baixar.
 */
function linkAindaVale(url: string | null | undefined): boolean {
  if (!url) return false;
  const m = String(url).match(/[?&]Expires=(\d+)/);
  if (!m) return true; // sem carimbo de validade: deixa tentar
  return Number(m[1]) * 1000 > Date.now();
}

/**
 * O XML da nota em bytes — renovando o link quando o do espelho já morreu.
 *
 * A renovação custa um `StatusOS` e devolve um link novo do CDN; de quebra, o
 * espelho aproveita a leitura. É o mesmo motivo pelo qual a tela pergunta antes
 * de oferecer o link: o endereço guardado ontem quase nunca serve hoje.
 */
async function xmlDaNota(supabase: any, linha: any): Promise<{ bytes: Uint8Array; renovado: boolean }> {
  let url: string | null = (linha.nfse_xml as string | null) ?? null;
  let renovado = false;

  if (!linkAindaVale(url)) {
    const s = await omieCall<any>("servicos/os", "StatusOS", { nCodOS: Number(linha.n_cod_os) });
    const nfse = nfseDoStatus(s);
    url = (nfse.nfse_xml as string | null) ?? null;
    renovado = true;
    await supabase.from("nf_os_omie")
      .update({ ...nfse, status_lido_em: new Date().toISOString() })
      .eq("n_cod_os", linha.n_cod_os);
  }
  if (!url) throw new Error("O Omie não devolveu o XML desta nota.");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`O download do XML falhou [${res.status}].`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  /* O CDN responde 200 com um XML de ERRO quando a assinatura expirou. Um
   * "AccessDenied" de 243 bytes anexado como nota fiscal é pior que anexo
   * nenhum: passa por documento na fatura do cliente e não é um. */
  const inicio = new TextDecoder().decode(bytes.slice(0, 400));
  if (/<Error>|AccessDenied|ExpiredToken|SignatureDoesNotMatch/i.test(inicio)) {
    throw new Error("O CDN do Omie recusou o download do XML (link expirado ou assinatura inválida).");
  }
  if (bytes.byteLength < 500) {
    throw new Error(`O XML veio com ${bytes.byteLength} bytes — pequeno demais para ser uma nota.`);
  }
  return { bytes, renovado };
}

/** Os documentos que a cobrança já tem. Uma leitura serve para as duas buscas. */
async function documentosDa(id: string): Promise<any[]> {
  const r = await asaasGet<any>(`/payments/${id}/documents`);
  return Array.isArray(r?.data) ? r.data : [];
}

/**
 * Este arquivo já está lá?
 *
 * A procura é no documento inteiro em texto, e não num campo nomeado: o que
 * importa é reconhecer o arquivo onde quer que o Asaas guarde o nome dele. Campo
 * que muda de lugar numa versão da API viraria anexo duplicado — e anexo
 * duplicado é a fatura do cliente com duas notas iguais.
 */
function acharDoc(docs: any[], marca: string, extensao: string): string | null {
  const achado = docs.find((d: any) => {
    const s = JSON.stringify(d ?? {});
    return s.includes(marca) && s.toLowerCase().includes(extensao);
  });
  return achado ? String(achado?.id ?? "sem-id") : null;
}

async function marcarAnexado(supabase: any, linha: any, anexos: unknown[], erro: string | null = null) {
  await supabase.from("nf_os_omie").update({
    asaas_anexos: anexos,
    asaas_anexado_em: new Date().toISOString(),
    asaas_anexo_erro: erro,
  }).eq("n_cod_os", linha.n_cod_os);
}
async function falharAnexo(supabase: any, linha: any, erro: string) {
  await supabase.from("nf_os_omie").update({ asaas_anexo_erro: erro.slice(0, 400) })
    .eq("n_cod_os", linha.n_cod_os);
}

/**
 * As OS com nota que ainda não têm a nota anexada na cobrança.
 *
 * O filtro por `c_cod_int_os` é o que dá honestidade ao alcance: só as OS que o
 * Hub criou carregam o id da cobrança. As 406 OS do lote manual de junho não
 * carregam — para elas o vínculo cobrança↔nota teria que ser adivinhado por CNPJ
 * e valor, e adivinhação não vira arquivo na fatura de cliente.
 */
async function filaDoAnexo(supabase: any, limite: number, ids: string[]): Promise<any[]> {
  let q = supabase
    .from("nf_os_omie")
    .select("n_cod_os, c_num_os, c_cod_int_os, nfse_numero, nfse_xml, asaas_anexos, asaas_anexado_em")
    .eq("nfse_status", "004")
    .not("nfse_numero", "is", null)
    .like("c_cod_int_os", "pay%");

  if (ids.length) q = q.in("c_cod_int_os", ids);
  else q = q.is("asaas_anexado_em", null);

  const { data, error } = await q.order("data_faturamento", { ascending: false }).limit(limite);
  if (error) throw new Error(`fila do anexo: ${error.message}`);
  return (data ?? []).filter((l: any) => EH_ID_ASAAS.test(String(l.c_cod_int_os ?? "")));
}

/** Um arquivo na cobrança. `type: INVOICE` é o que o Asaas rotula como nota fiscal. */
async function subirDocumento(
  id: string, nome: string, bytes: Uint8Array, tipoMime: string,
): Promise<string> {
  const form = new FormData();
  form.append("availableAfterPayment", "true");
  form.append("type", "INVOICE");
  form.append("file", new Blob([bytes], { type: tipoMime }), nome);
  const doc = await asaasUpload<any>(`/payments/${id}/documents`, form);
  return String(doc?.id ?? "");
}

/**
 * A nota na cobrança: o PDF para a pessoa, o XML para a contabilidade.
 *
 * A ORDEM IMPORTA e é esta: o XML é o documento fiscal e não depende de nada;
 * o PDF é desenhado aqui a partir dele. Se o desenho falhar — fonte, campo
 * faltando, XML de formato inesperado —, o XML sobe do mesmo jeito e a falha do
 * PDF fica registrada. O contrário (deixar de anexar a nota porque o papel não
 * saiu) seria trocar o essencial pelo enfeite.
 *
 * Os dois arquivos são conferidos SEPARADAMENTE contra a lista de documentos da
 * cobrança, porque eles podem ter chegado lá em rodadas diferentes: as duas
 * primeiras cobranças receberam só o XML, antes de o PDF existir.
 */
async function anexarUma(supabase: any, linha: any, seco: boolean, querBase64 = false) {
  const id = String(linha.c_cod_int_os);
  const numero = String(linha.nfse_numero);
  const os = String(linha.c_num_os ?? "").trim() || String(linha.n_cod_os);
  const nomeBase = nomeDoAnexo(numero, os);
  const base = { id_asaas: id, os, nfse: numero, arquivo: nomeBase };

  const docs = await documentosDa(id);
  const jaPdf = acharDoc(docs, nomeBase, ".pdf");
  const jaXml = acharDoc(docs, nomeBase, ".xml");
  const anexos: Array<Record<string, unknown>> = [];
  if (jaPdf) anexos.push({ tipo: "pdf", id: jaPdf, nome: `${nomeBase}.pdf` });
  if (jaXml) anexos.push({ tipo: "xml", id: jaXml, nome: `${nomeBase}.xml` });

  if (jaPdf && jaXml && !seco) {
    await marcarAnexado(supabase, linha, anexos);
    return { ...base, ok: true, ja_anexada: true, anexos };
  }

  // O ensaio baixa o XML e desenha o PDF de verdade: é a metade da operação que
  // pode falhar sem deixar rastro no Asaas, e é justamente a que vale ensaiar.
  let xml: Uint8Array, renovado: boolean;
  try {
    ({ bytes: xml, renovado } = await xmlDaNota(supabase, linha));
  } catch (e) {
    const erro = mensagemDoOmie(e);
    await falharAnexo(supabase, linha, erro);
    return { ...base, ok: false, erro };
  }

  let pdf: Uint8Array | null = null;
  let erroPdf: string | null = null;
  try {
    pdf = await espelhoPdf(lerXmlNfse(new TextDecoder().decode(xml)));
  } catch (e) {
    erroPdf = `O espelho em PDF não foi gerado: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
  }

  if (seco) {
    return {
      ...base, ok: true, seco: true,
      ja_anexados: { pdf: jaPdf, xml: jaXml },
      bytes_xml: xml.byteLength, bytes_pdf: pdf?.byteLength ?? null,
      link_renovado: renovado,
      ...(erroPdf ? { erro_pdf: erroPdf } : {}),
      ...(querBase64 && pdf ? { pdf_base64: toBase64(pdf) } : {}),
    };
  }

  const falhas: string[] = [];
  if (!jaPdf && pdf) {
    try {
      anexos.unshift({ tipo: "pdf", id: await subirDocumento(id, `${nomeBase}.pdf`, pdf, "application/pdf"), nome: `${nomeBase}.pdf` });
    } catch (e) { falhas.push(`PDF: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); }
  }
  if (!jaXml) {
    try {
      anexos.push({ tipo: "xml", id: await subirDocumento(id, `${nomeBase}.xml`, xml, "application/xml"), nome: `${nomeBase}.xml` });
    } catch (e) { falhas.push(`XML: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); }
  }

  const problema = [erroPdf, ...falhas].filter(Boolean).join(" · ") || null;
  // Só carimba como resolvido quando o XML — o que não pode faltar — está lá.
  const temXml = anexos.some((a) => a.tipo === "xml");
  if (temXml) await marcarAnexado(supabase, linha, anexos, problema);
  else await falharAnexo(supabase, linha, problema ?? "Nada foi anexado.");

  return { ...base, ok: temXml, anexos, ...(problema ? { aviso: problema } : {}) };
}

async function anexarNoAsaas(
  supabase: any,
  opts: { limite?: number; ids?: string[]; seco?: boolean; prazoMs?: number; base64?: boolean } = {},
) {
  const limite = Math.min(Math.max(Number(opts.limite ?? 20), 1), 200);
  const seco = opts.seco === true;
  const fila = await filaDoAnexo(supabase, limite, opts.ids ?? []);

  /* Cada cobrança custa três idas à rede (listar documentos, baixar o XML,
   * subir), e a Edge Function morre aos 150s. Melhor tratar as que cabem e dizer
   * quantas ficaram do que morrer no meio de um upload.
   *
   * O prazo é parâmetro porque esta varredura tem dois donos com folgas bem
   * diferentes: chamada sozinha, tem a função inteira para si; pendurada no fim
   * do `espelhar`, entra quando o ListarOS e as consultas de status já gastaram a
   * maior parte do relógio. */
  const PRAZO_MS = Math.min(Math.max(Number(opts.prazoMs ?? 110_000), 5_000), 110_000);
  const comecou = Date.now();
  const resultados: any[] = [];
  const naoTentadas: string[] = [];

  for (const linha of fila) {
    if (Date.now() - comecou > PRAZO_MS) { naoTentadas.push(String(linha.c_cod_int_os)); continue; }
    resultados.push(await anexarUma(supabase, linha, seco, opts.base64 === true).catch((e) => ({
      id_asaas: String(linha.c_cod_int_os), os: String(linha.c_num_os ?? ""),
      ok: false, erro: (e instanceof Error ? e.message : String(e)).slice(0, 300),
    })));
  }

  const ok = resultados.filter((r) => r.ok).length;
  const jaAnexadas = resultados.filter((r) => r.ja_anexada).length;
  return {
    fila: fila.length,
    anexadas: seco ? 0 : ok - jaAnexadas,
    ja_anexadas: jaAnexadas,
    falhas: resultados.length - ok,
    nao_tentadas: naoTentadas,
    seco,
    resultados: resultados.slice(0, 30),
  };
}

/* ------------------------------ diagnóstico ------------------------------- */

/**
 * O mapa do faturamento, sem escrever nada.
 *
 * Existe porque o passo "faturar" desta função estava construído sobre uma
 * suposição errada (subir a etapa até 60), e suposição sobre ato fiscal se
 * confere com leitura, não com tentativa. Devolve:
 *   • as etapas de venda cadastradas NESTA empresa (produtos/etapafat);
 *   • quantas OS vivem em cada etapa AGORA, direto do Omie — é o número que diz
 *     o alcance de um `FaturarLoteOS`, que fatura a etapa INTEIRA;
 *   • os últimos lotes de faturamento e como terminaram.
 */
/**
 * O Omie guarda algum ARQUIVO da NFS-e junto da OS?
 *
 * A pergunta importa porque um DANFSE oficial anexado pelo próprio Omie seria
 * melhor que qualquer representação que a gente desenhe. Os métodos de PDF não
 * existem (`ObterDANFSE`, `ImprimirNFSe`, `ObterPDFNFSe`, todos sondados), mas
 * `geral/anexo/ListarAnexo` existe — e se o PDF estivesse em algum lugar, seria
 * ali. O nome da tabela do documento não está documentado para OS, então a sonda
 * tenta as variantes plausíveis e devolve o que cada uma respondeu.
 */
async function anexosDaOS(nCodOS: number): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const cTabela of ["os-servico", "ordem-servico", "os", "servico-os", "conta-receber"]) {
    try {
      const r = await omieCall<any>("geral/anexo", "ListarAnexo", {
        cTabela, nId: Number(nCodOS), nPagina: 1, nRegPorPagina: 20,
      }, { semRetentativa: true });
      out[cTabela] = { total: r?.nTotRegistros ?? r?.total_de_registros ?? null, anexos: r?.listaAnexos ?? r };
    } catch (e) {
      out[cTabela] = mensagemDoOmie(e).slice(0, 160);
    }
  }
  return out;
}

async function etapasEFaturamento(opts: { lote?: number; os?: number; consultar?: boolean; anexos?: boolean } = {}) {
  // Atalho: com `os`, só o status daquela OS — é a leitura que diz se a nota
  // nasceu, sem varrer as 1.200 OS.
  if (opts.os) {
    const s = await omieCall<any>("servicos/os", "StatusOS", { nCodOS: opts.os });
    // `consultar` traz a OS inteira como ela ficou gravada — é onde se lê o bloco
    // Email, que decide se o Omie manda alguma coisa para o cliente.
    const cadastro = opts.consultar
      ? await omieCall<any>("servicos/os", "ConsultarOS", { nCodOS: opts.os }).catch((e) => ({ erro: mensagemDoOmie(e) }))
      : undefined;
    /* O bloco Email da OS governa boleto/link/pix/recibo. As OS históricas nasceram
     * todas "N" — as do Hub nascem com `cEnvLink: "S"` (ver `montarOS`), então esta
     * leitura serve para conferir se o interruptor foi mesmo gravado. Quem recebe é
     * o `cEnviarPara` da OS quando preenchido e o e-mail do cadastro do cliente
     * quando não — por isso o cadastro continua sendo lido logo abaixo. */
    const nCodCli = Number(cadastro?.Cabecalho?.nCodCli ?? 0);
    const cliente = nCodCli
      ? await omieCall<any>("geral/clientes", "ConsultarCliente", { codigo_cliente_omie: nCodCli })
          .then((c) => ({
            codigo: c?.codigo_cliente_omie, razao: c?.razao_social, nome: c?.nome_fantasia,
            email: c?.email, email_nfe: c?.dadosNFe?.email_nfe ?? null,
            exibir_email_nfe: c?.dadosNFe?.exibir_email_nfe ?? null,
            recebe_email: c?.recomendacoes?.email_fatura ?? null,
          }))
          .catch((e) => ({ erro: mensagemDoOmie(e) }))
      : undefined;
    const anexos = opts.anexos ? await anexosDaOS(opts.os) : undefined;
    return {
      status_os: s, nfse: nfseDoStatus(s),
      ...(cadastro ? { cadastro } : {}), ...(cliente ? { cliente } : {}), ...(anexos ? { anexos } : {}),
    };
  }
  const etapas = await omieCall<any>("produtos/etapafat", "ListarEtapasFaturamento", {
    pagina: 1, registros_por_pagina: 50,
  }).catch((e) => ({ erro: mensagemDoOmie(e) }));

  const porEtapa = new Map<string, { os: number; valor: number; exemplos: string[] }>();
  for (const os of await listarOS()) {
    const cab = os?.Cabecalho ?? {};
    const info = os?.InfoCadastro ?? {};
    if (String(info.cCancelada ?? "N") === "S") continue;
    const chave = `${String(cab.cEtapa ?? "?")}${String(info.cFaturada ?? "N") === "S" ? " (faturada)" : ""}`;
    const acc = porEtapa.get(chave) ?? { os: 0, valor: 0, exemplos: [] };
    acc.os++;
    acc.valor += Number(cab.nValorTotal ?? 0);
    if (acc.exemplos.length < 3) acc.exemplos.push(`OS ${cab.cNumOS} (${cab.nCodOS})`);
    porEtapa.set(chave, acc);
  }

  const lotes = await omieCall<any>("servicos/oslote", "ListarLotesOS", {
    nPagina: 1, nRegistros: 10,
    ...(opts.lote ? { nIdLoteFat: opts.lote, cExibirDetalhes: "S" } : { cExibirDetalhes: "N" }),
  }).catch((e) => ({ erro: mensagemDoOmie(e) }));

  return {
    etapas_cadastradas: etapas,
    os_por_etapa: Object.fromEntries(
      [...porEtapa.entries()].sort().map(([k, v]) => [k, { ...v, valor: Number(v.valor.toFixed(2)) }]),
    ),
    lotes_recentes: lotes,
  };
}

/**
 * Existe método de reenvio de NFS-e na API?
 *
 * A ajuda do Omie só descreve o botão "Reenviar NFS-e" da tela, e a lista de APIs
 * do portal não cita nada equivalente — mas ausência na documentação não é
 * ausência no servidor (foi assim que `servicos/oslote` apareceu). A sonda pergunta
 * ao próprio Omie: método que não existe responde "Method not exists"; método que
 * existe responde CRÍTICA DE PARÂMETRO, e é por isso que o nCodOS vai como 0 —
 * nenhuma OS real pode ser tocada por engano.
 */
async function sondarMetodos(extras: Array<[string, string]> = []): Promise<Record<string, string>> {
  const alvos: Array<[string, string]> = extras.length ? extras : [
    // Controles: dois que existem e um endpoint que não existe. Sem eles, a sonda
    // não prova nada — a primeira versão classificou TUDO como "EXISTE" porque a
    // recusa vem como `Method "X" not exists`, com o nome no meio da frase, e o
    // teste procurava as duas palavras coladas.
    ["servicos/os", "StatusOS"], ["servicos/oslote", "FaturarLoteOS"], ["servicos/naoexiste", "Nada"],
    ["servicos/os", "ReenviarNFSe"], ["servicos/os", "ReprocessarNFSe"],
    ["servicos/os", "EnviarNFSe"], ["servicos/os", "TransmitirNFSe"],
    ["servicos/os", "ReenviarRPS"], ["servicos/os", "EnviarRPS"],
    ["servicos/os", "ReprocessarRPS"], ["servicos/os", "RefaturarOS"],
    ["servicos/oslote", "ReenviarLoteOS"], ["servicos/oslote", "ReprocessarLoteOS"],
    ["servicos/oslote", "ReenviarLoteRPS"],
    ["servicos/rps", "ReenviarRPS"], ["servicos/nfse", "ReenviarNFSe"],
    ["servicos/osnfse", "ReenviarNFSe"], ["servicos/notafiscalservico", "ReenviarNFSe"],
  ];
  const out: Record<string, string> = {};
  for (const [path, call] of alvos) {
    try {
      await omieCall<any>(path, call, { nCodOS: 0 }, { semRetentativa: true });
      out[`${path}/${call}`] = "RESPONDEU SEM ERRO (investigar antes de usar)";
    } catch (e) {
      const m = mensagemDoOmie(e);
      out[`${path}/${call}`] = /not exists|não existe|nao existe/i.test(m) ? "não existe"
        : /404|not found/i.test(m) ? "endpoint não existe"
        : `EXISTE → ${m.slice(0, 150)}`;
    }
  }
  return out;
}

/* --------------------------------- a porta -------------------------------- */

/**
 * A REGRA DO DINHEIRO, do lado de cá.
 *
 * Gêmea de `public.nfse_bloqueio_emissao` (migration 20260822130000) e existe
 * porque a leitura ao vivo do Asaas não passa pelo Postgres: o que volta do
 * `GET /payments/{id}` é um JSON solto, e é justamente esse JSON que tem a
 * palavra final. As duas frases são as mesmas de propósito — o operador não
 * deveria conseguir dizer qual das duas camadas o barrou.
 *
 * Estorno primeiro, sempre. Emitir sobre cobrança devolvida cria imposto sobre
 * receita que não existe, e nota não se apaga: cancela-se, com prazo e
 * justificativa. As três caras do estorno: o status (total), o `refunds[]`
 * (parcial, que NÃO tem status próprio — a cobrança segue "RECEIVED") e a
 * contestação (`CHARGEBACK_*`, dinheiro em disputa).
 *
 * `avulsa` é o alcance, e o default é o estreito. Ligado, a confirmada passa —
 * e SÓ ela: o estorno continua barrando (não há caso em que emitir sobre
 * dinheiro devolvido seja a resposta certa) e a pendente/vencida também (avulsa
 * é urgência de nota, não licença para faturar o que ninguém pagou).
 */
const RECEBIDAS = ["RECEIVED", "RECEIVED_IN_CASH"];
const ESTORNADAS = [
  "REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS",
  "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL",
];

function bloqueioDeEmissao(
  status: unknown, cobranca: any, estornoRegistrado = false, avulsa = false,
): string | null {
  const st = String(status ?? "").toUpperCase();
  const temRefunds = Array.isArray(cobranca?.refunds) && cobranca.refunds.length > 0;
  if (estornoRegistrado || temRefunds || ESTORNADAS.includes(st)) {
    return "Cobrança estornada — emitir criaria imposto sobre receita devolvida.";
  }
  if (st === "CONFIRMED") {
    if (avulsa) return null;
    return "Cobrança confirmada e ainda não liquidada — a nota sai no dia em que o dinheiro entrar, " +
      "ou agora, como avulsa, se alguém assinar a espera.";
  }
  if (!RECEBIDAS.includes(st)) {
    return `Cobrança não recebida (${st || "sem status"}).` +
      (avulsa ? " A avulsa vai até a confirmada e não além." : "");
  }
  return null;
}

/**
 * O espelho errou; conserta o espelho.
 *
 * Quando a leitura ao vivo discorda do que estava gravado, o desencontro não é
 * só desta emissão: o painel do mês continuaria mostrando "recebida, falta
 * nota" para uma cobrança devolvida, e alguém tentaria de novo amanhã. Grava-se
 * o que o Asaas acabou de dizer.
 *
 * Só `status` e `dados` — a `data_pagamento` da coluna fica onde está. O Asaas
 * LIMPA o paymentDate ao estornar, e copiar essa limpeza tiraria a linha do mês
 * em que ela aparece na tela: some do painel exatamente a cobrança que alguém
 * precisa ver para cancelar a nota que porventura já saiu.
 */
async function curarEspelho(supabase: any, idAsaas: string, cobranca: any) {
  await supabase.from("asaas_cache")
    .update({ status: String(cobranca?.status ?? ""), dados: cobranca, atualizado_em: new Date().toISOString() })
    .eq("tipo", "payment").eq("id_asaas", idAsaas);
}

/**
 * A CONFERÊNCIA DA PORTA — o estado da cobrança no Asaas AGORA.
 *
 * Por que não basta o espelho. A `asaas-sync` roda às 12:15 UTC e a emissão às
 * 13h: um estorno registrado às 12:30 chega ao espelho só no dia seguinte, e
 * nesse intervalo o banco diz "recebida" sobre dinheiro que já voltou. A janela
 * é de horas, e o que cabe nela é uma nota fiscal que não se apaga.
 *
 * O custo é UMA requisição por cobrança — no máximo `teto_rodada` (20) por
 * rodada, contra a cota de 25.000 por 12h do Asaas. É a requisição mais barata
 * de todo o processo e a única que responde a pergunta que importa.
 *
 * FALHA FECHA A PORTA. Se o Asaas não responder, não se emite: a cobrança volta
 * na próxima rodada intacta. O contrário — emitir no escuro — troca um atraso de
 * horas por uma nota que se cancela com prazo e justificativa.
 */
async function conferirNoAsaas(
  supabase: any, cobrancas: any[], paralelo: boolean, avulsa = false,
): Promise<Map<string, string | null>> {
  const veredito = new Map<string, string | null>();

  await Promise.all(cobrancas.map(async (cob) => {
    const id = String(cob.id_asaas);
    // 1) O que o banco já sabia (calculado por nfse_bloqueio_emissao, que soma o
    //    status, o refunds[] do espelho e o registro da estornos-sync).
    if (cob.bloqueio) { veredito.set(id, String(cob.bloqueio)); return; }

    // 2) O que o Asaas diz neste instante.
    try {
      const p = await asaasGet<any>(`/payments/${id}`);
      const motivo = bloqueioDeEmissao(p?.status, p, false, avulsa);
      if (motivo) {
        veredito.set(id, `${motivo} (lido no Asaas agora: ${String(p?.status ?? "?")})`);
        await curarEspelho(supabase, id, p).catch(() => { /* o bloqueio já valeu */ });
        return;
      }

      /* 3) A NOTA DO ASAAS, AO VIVO — a trava do período de paralelo.
       *
       * A fila já exclui quem é do Asaas pela configuração da assinatura, e já
       * exclui quem tem nota no espelho. Mas o espelho de invoices é diário
       * (12:15 UTC) e a emissão roda às 13h: uma nota que o Asaas agendou às
       * 12:30 não estaria lá. Quarenta e cinco minutos é janela curta e mesmo
       * assim é janela — e o que cabe nela é uma segunda nota fiscal do mesmo
       * serviço, que não se apaga, cancela-se com prazo e justificativa.
       *
       * Custa UMA leitura por cobrança. Falha de leitura FECHA a porta, como o
       * resto deste bloco: no escuro não se emite. */
      if (paralelo) {
        const inv = await asaasGet<any>("/invoices", { payment: id, limit: 1 });
        const quantas = Number(inv?.totalCount ?? (inv?.data?.length ?? 0));
        if (quantas > 0) {
          const st = String(inv?.data?.[0]?.status ?? "?");
          veredito.set(id, `O Asaas já tem nota para esta cobrança (${st}), lido agora. Enquanto os dois emitem, a nota é dele.`);
          return;
        }
      }
      veredito.set(id, null);
    } catch (e) {
      veredito.set(id, `Não deu para confirmar o estado da cobrança no Asaas (${
        (e instanceof Error ? e.message : String(e)).slice(0, 120)
      }). Nada foi emitido — a cobrança volta na próxima rodada.`);
    }
  }));

  return veredito;
}

/**
 * Separa quem passa de quem não passa, e registra no diário quem não passou.
 *
 * O registro é o ponto. Recusa que não deixa rastro é indistinguível de
 * esquecimento: sem a linha `bloqueado`, a cobrança some da fila e ninguém
 * consegue responder depois por que ela nunca virou nota.
 */
async function passarPelaPorta(
  supabase: any, cobrancas: any[],
  opts: { seco: boolean; usuario: string | null; operador: string | null; avulsa?: boolean },
): Promise<{ liberadas: any[]; barradas: Array<{ id_asaas: string; motivo: string }> }> {
  if (!cobrancas.length) return { liberadas: [], barradas: [] };

  /* `paralelo_asaas` liga a conferência da nota do Asaas ao vivo. Lido aqui e
   * não no chamador porque a porta é uma só, e as duas rotas que a atravessam
   * (rodada e emissão manual) têm de fechar com o mesmo critério.
   *
   * A avulsa muda o ALCANCE da régua do dinheiro e nada mais: a conferência da
   * nota do Asaas ao vivo continua valendo igual, porque ela responde "esta
   * nota já saiu?" — pergunta que não tem urgência do outro lado. */
  const { data: cfgPar } = await supabase
    .from("nf_config").select("paralelo_asaas").eq("id", 1).maybeSingle();
  const avulsa = opts.avulsa === true;
  const veredito = await conferirNoAsaas(
    supabase, cobrancas, cfgPar?.paralelo_asaas !== false, avulsa,
  );
  const liberadas: any[] = [];
  const barradas: Array<{ id_asaas: string; motivo: string; n_cod_os: number | null }> = [];

  for (const cob of cobrancas) {
    const motivo = veredito.get(String(cob.id_asaas)) ?? null;
    if (motivo) {
      barradas.push({
        id_asaas: String(cob.id_asaas), motivo,
        n_cod_os: cob.n_cod_os ? Number(cob.n_cod_os) : null,
      });
    } else liberadas.push(cob);
  }

  if (barradas.length && !opts.seco) {
    await supabase.from("nf_emissoes").insert(barradas.map((b) => ({
      id_asaas: b.id_asaas,
      n_cod_os: b.n_cod_os,
      // A ação é a que teria acontecido: cobrança com OS nossa esperando o
      // faturamento não seria "criar e faturar", e o diário não deve inventar
      // um passo que não existiria.
      acao: b.n_cod_os ? "faturar" : "criar_e_faturar",
      resultado: "bloqueado",
      erro: b.motivo,
      // Barrada NA avulsa é diferente de barrada na régua estreita: a primeira
      // não volta sozinha (já se usou a régua larga e mesmo assim não passou).
      avulsa,
      usuario: opts.usuario, operador: opts.operador,
    })));
  }

  return { liberadas, barradas };
}

/* -------------------------------- emissão -------------------------------- */

/**
 * O MOLDE.
 *
 * Montar o payload de `IncluirOS` do zero significa escrever à mão CST, código de
 * classificação tributária, indicador de operação, NBS, alíquotas de ISS/CBS/IBS e
 * o item da LC 116 — dado fiscal que, errado, gera nota errada com valor certo, e
 * nota errada não se apaga: cancela-se, com prazo e justificativa.
 *
 * Então não se inventa nada. O Hub lê uma OS que o Omie JÁ emitiu com nota
 * autorizada e usa aquele registro como molde, trocando só o que é da cobrança:
 * cliente, valor, datas, descrição e o carimbo do Asaas. O que é fiscal vem
 * inteiro do que já passou pela prefeitura.
 */
async function pegarMolde(supabase: any): Promise<any> {
  const { data } = await supabase
    .from("nf_os_omie")
    .select("n_cod_os")
    .eq("nfse_status", "004")
    .eq("cancelada", false)
    .order("data_faturamento", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.n_cod_os) {
    throw new Error(
      "Não há OS com NFS-e autorizada no espelho para servir de molde fiscal. " +
      "Rode a ação \"espelhar\" antes de emitir.",
    );
  }
  const os = await omieCall<any>("servicos/os", "ConsultarOS", { nCodOS: Number(data.n_cod_os) });
  if (!os?.ServicosPrestados?.length) throw new Error(`A OS ${data.n_cod_os} não serve de molde: sem serviços prestados.`);
  return os;
}

/**
 * O bloco de impostos do molde, limpo dos VALORES.
 *
 * Esta função existe por causa de um erro que a prévia pegou antes de virar nota:
 * o molde traz `nBaseISS: 549`, `nValorISS: 10,98`, `nBaseCalcIbsCbs: 538,02` —
 * os impostos JÁ CALCULADOS sobre o valor daquela OS. Copiados para uma cobrança
 * de R$ 2.232, sairia uma nota de R$ 2.232 recolhendo ISS sobre R$ 549.
 *
 * Pior: o molde vem com `cFixarISS: "S"`, que é literalmente "não recalcule, use
 * o valor que eu mandei". Com ele ligado, o Omie OBEDECERIA a base errada.
 *
 * Então o que viaja é só o que é da NATUREZA do serviço — alíquotas, retenções,
 * CST, classificação tributária, indicador de operação — e o cálculo fica com o
 * ERP, que é quem sabe fazê-lo. `cFixar*` vai em "N" por isso.
 */
function impostosDoMolde(impostos: Record<string, unknown> = {}): Record<string, unknown> {
  const limpo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(impostos)) {
    // nBase* e nValor* são resultado de conta sobre OUTRO valor. nAliq* são taxa,
    // e taxa não depende do valor — essas ficam. nAliqRedBase* também é percentual.
    if (/^(nBase|nValor|nTotDeducao)/.test(k)) continue;
    limpo[k] = /^cFixar/.test(k) ? "N" : v;
  }
  return limpo;
}

/** O payload de IncluirOS para uma cobrança, a partir do molde. */
function montarOS(molde: any, cob: {
  id_asaas: string; nCodCli: number; valor: number; vencimento: string; descricao: string; email?: string | null;
}): Record<string, unknown> {
  const servicoMolde = molde.ServicosPrestados[0];
  const dtBR = brDeISO(cob.vencimento);

  return {
    Cabecalho: {
      // O carimbo. É o que torna o casamento Asaas↔Omie exato daqui pra frente —
      // e é também a trava contra duplicata: o Omie recusa cCodIntOS repetido.
      cCodIntOS: cob.id_asaas,
      cCodParc: "000",
      // "50" = a faturar, que é onde as OS boas do Omie nascem. Criar em "10"
      // (em digitação) e tentar saltar para 60 foi o que falhou em silêncio.
      cEtapa: "50",
      dDtPrevisao: dtBR,
      nCodCli: cob.nCodCli,
      nQtdeParc: 1,
      nValorTotal: cob.valor,
    },
    InformacoesAdicionais: {
      cCidPrestServ: molde.InformacoesAdicionais?.cCidPrestServ ?? "",
      cCodCateg: molde.InformacoesAdicionais?.cCodCateg ?? "",
      nCodCC: molde.InformacoesAdicionais?.nCodCC ?? 0,
    },
    /* O E-MAIL DA NOTA.
     *
     * Não existe endpoint de envio na API do Omie — nem para disparar, nem para ler
     * os "Emails Enviados" da tela. O que existe é ESTE bloco, e ele é um
     * interruptor lido no FATURAMENTO, não uma ação. Daí ele precisar nascer certo:
     * depois que a OS fatura não há como mandar o e-mail por API, só pela tela.
     *
     * `cEnvLink` ligado é o e-mail "via Portal Omie" com o link da nota — o mesmo
     * que sai ao clicar "NFS-e por e-mail" na OS faturada. O corpo é do Omie; não
     * escolhemos texto nem anexo (o PDF só viaja junto se o cadastro do cliente
     * estiver configurado para anexar).
     *
     * Os outros ficam em "N" de propósito: `cEnvRecibo` manda recibo NO LUGAR da
     * nota, e boleto/pix são cobrança — quem cobra aqui é o Asaas, e a cobrança já
     * está paga quando a nota sai.
     *
     * `cEnviarPara` vazio não impede o envio: o Omie cai no e-mail do cadastro do
     * cliente. Preenchemos com o do Asaas porque é o endereço que o cliente usou
     * para pagar — o mais provável de estar vivo.
     */
    Email: {
      cEnvBoleto: "N", cEnvLink: "S", cEnvPix: "N", cEnvRecibo: "N", cEnvViaUnica: "N",
      cEnviarPara: cob.email ?? "",
    },
    ServicosPrestados: [{
      ...servicoMolde,
      // As alíquotas e retenções vêm do molde; os valores calculados, não (ver acima).
      impostos: impostosDoMolde(servicoMolde?.impostos),
      /* A DESCRIÇÃO DO SERVIÇO, limpa antes de virar texto de nota fiscal.
       *
       * O que vem do Asaas é digitado por gente no cadastro da cobrança, e o
       * ensaio de 27/08 achou o que era de se esperar: tabulação no começo
       * ("\tTakeat - Plano PRO + POS…") e quebra de linha no meio ("…10 Tablet
       * \r\n[Diferença de -R$…"). Cortar em 200 não resolve isso — só garante
       * que o lixo caiba.
       *
       * Isto é o corpo da NFS-e, o texto que o cliente lê e que fica no XML da
       * prefeitura. Nota não se corrige: cancela-se, com prazo e justificativa.
       * Então o espaço em branco vira espaço simples e as pontas são aparadas —
       * sem tocar em mais nada, porque o resto é a descrição que o comercial
       * escreveu e não cabe a este código reescrever. */
      cDescServ: cob.descricao.replace(/\s+/g, " ").trim().slice(0, 200),
      nQtde: 1,
      nSeqItem: 1,
      nValUnit: cob.valor,
      // Ids do item do molde não podem viajar: são daquela OS.
      nIdItem: undefined,
      cCodigo: "",
    }],
    Parcelas: [{ dDtVenc: dtBR, nDias: 0, nParcela: 1, nPercentual: 100, nValor: cob.valor }],
    Observacoes: { cObsOS: `Emitida pelo Hub a partir da cobrança ${cob.id_asaas} do Asaas.` },
  };
}

/**
 * A etapa onde a OS fica SOZINHA para ser faturada.
 *
 * "20" = "Em Execução" no cadastro de etapas desta empresa (ListarEtapasFaturamento,
 * operação 01 "Venda de Serviço"): ativa — a "40" está inativa e não serve — e sem
 * nenhuma OS morando nela. É um corredor de passagem, não um estado de negócio: a
 * OS entra, fatura e sai no mesmo minuto.
 */
const ETAPA_ISOLAMENTO_PADRAO = "20";
/** Para onde a OS volta se o faturamento não acontecer. "50" = Faturar. */
const ETAPA_FILA = "50";

/** Quem está em cada etapa AGORA, direto do Omie. É o que mede o raio do lote. */
async function ocupantesDaEtapa(etapa: string): Promise<number[]> {
  const out: number[] = [];
  for (const os of await listarOS()) {
    const cab = os?.Cabecalho ?? {};
    if (String(os?.InfoCadastro?.cCancelada ?? "N") === "S") continue;
    if (String(cab.cEtapa ?? "") === etapa) out.push(Number(cab.nCodOS));
  }
  return out;
}

/**
 * Trocar etapa, tratando o "já está lá" como o que ele é: sucesso.
 *
 * `TrocarEtapaOS` responde "Ordem de Serviço já se encontra na Etapa solicitada!"
 * com status de ERRO quando a OS já está no destino. O caminho da emissão tomava
 * isso por falha e devolvia sem faturar — deixando a OS parada no corredor, que
 * então travava todas as outras. Foi o que prendeu a OS 1642 em 25/08/26. Mesmo
 * destino pedido, alcançado antes: não há nada a corrigir.
 */
async function trocarEtapa(nCodOS: number, cEtapa: string): Promise<void> {
  try {
    await omieCall<any>("servicos/os", "TrocarEtapaOS", { nCodOS, cEtapa });
  } catch (e) {
    if (!/j[áa]\s+se\s+encontra\s+na\s+Etapa/i.test(mensagemDoOmie(e))) throw e;
  }
}

/**
 * O corredor pode ter sobra — e sobra não pode parar a esteira.
 *
 * Uma OS esquecida na etapa de isolamento (lote que morreu no meio, rodada
 * interrompida, troca de etapa recusada por já estar lá) fazia TODA emissão
 * seguinte abortar na trava de raio. A etapa nunca voltava a ficar limpa sozinha:
 * o módulo inteiro parava até alguém abrir o Omie e mover a OS na mão. Em
 * 25/08/26 duas OS presas assim seguraram as 42 cobranças que vinham atrás.
 *
 * A varredura devolve o corredor ao estado de corredor, e só mexe no que é NOSSO:
 * OS com o carimbo `cCodIntOS` do Asaas e ainda não faturada. O que não for nosso
 * continua restando — e restando, aborta o lote, que é o comportamento certo:
 * faturar a etapa emitiria nota de terceiro.
 */
async function limparCorredor(
  etapa: string,
  exceto: number[] = [],
): Promise<{ removidas: number[]; restantes: number[]; lote_em_voo?: number }> {
  const poupar = new Set(exceto.map(Number));

  // Quem está lá, com o que decide o destino de cada um.
  const ocupantes: Array<{ nCodOS: number; nosso: boolean; faturada: boolean }> = [];
  for (const os of await listarOS()) {
    const cab = os?.Cabecalho ?? {};
    const info = os?.InfoCadastro ?? {};
    if (String(info.cCancelada ?? "N") === "S") continue;
    if (String(cab.cEtapa ?? "") !== etapa) continue;
    const nCodOS = Number(cab.nCodOS);
    if (poupar.has(nCodOS)) continue;
    ocupantes.push({
      nCodOS,
      // Nosso = criado pelo Hub a partir de uma cobrança do Asaas.
      nosso: /^pay_/i.test(String(cab.cCodIntOS ?? "")),
      faturada: String(info.cFaturada ?? "N") === "S",
    });
  }
  if (!ocupantes.length) return { removidas: [], restantes: [] };

  /* LOTE EM VOO NÃO SE DESMONTA.
   *
   * Tirar a OS da etapa no meio do faturamento é exatamente o que emperrou o
   * lote 5511522270 em 0/1: o faturamento foi procurar na etapa uma OS que já
   * tinha saído. Se há lote rodando, a varredura não toca em nada e devolve
   * todo mundo como restante — o chamador espera, que é o certo, em vez de
   * "consertar" o que só precisava de tempo.
   */
  const emVoo = await loteEmVoo();
  if (emVoo) {
    return { removidas: [], restantes: ocupantes.map((o) => o.nCodOS), lote_em_voo: emVoo };
  }

  const removidas: number[] = [];
  const restantes: number[] = [];
  for (const o of ocupantes) {
    // Faturada não se move (o Omie recusa) e não se fatura de novo — mas continua
    // ocupando, então vira "restante" e o lote aborta com o motivo à mostra.
    if (!o.nosso || o.faturada) { restantes.push(o.nCodOS); continue; }
    try {
      await trocarEtapa(o.nCodOS, ETAPA_FILA);
      removidas.push(o.nCodOS);
    } catch {
      restantes.push(o.nCodOS);
    }
  }
  return { removidas, restantes };
}

/** Há lote de faturamento ainda rodando? Devolve o id, ou 0. */
async function loteEmVoo(): Promise<number> {
  const r = await omieCall<any>("servicos/oslote", "ListarLotesOS", { nPagina: 1, nRegistros: 20, cExibirDetalhes: "N" })
    .catch(() => null);
  const rodando = (r?.lotes ?? []).find((l: any) => String(l?.cStatus ?? "") === "RUNNING");
  return Number(rodando?.nIdLoteFat ?? 0);
}

/** O lote mais recente que veio pela API — o efeito de um disparo que se perdeu. */
async function ultimoLoteDaApi(): Promise<number> {
  const r = await omieCall<any>("servicos/oslote", "ListarLotesOS", { nPagina: 1, nRegistros: 20, cExibirDetalhes: "N" })
    .catch(() => null);
  // Maior id, não último da lista: a ordem da resposta não é contrato de nada.
  return (r?.lotes ?? [])
    .filter((l: any) => String(l?.cOrigem ?? "") === "API")
    .reduce((maior: number, l: any) => Math.max(maior, Number(l?.nIdLoteFat ?? 0)), 0);
}

/** O lote acabou? Devolve o registro do lote com os detalhes por OS. */
async function esperarLote(nIdLoteFat: number, tentativas = 18): Promise<any> {
  let ultimo: any = null;
  for (let i = 0; i < tentativas; i++) {
    await dorme(5000);
    const r = await omieCall<any>("servicos/oslote", "ListarLotesOS", {
      nPagina: 1, nRegistros: 5, nIdLoteFat, cExibirDetalhes: "S",
    });
    ultimo = (r?.lotes ?? []).find((l: any) => Number(l?.nIdLoteFat) === Number(nIdLoteFat)) ?? null;
    if (ultimo && String(ultimo.cStatus ?? "") !== "RUNNING") return ultimo;
  }
  return ultimo;
}

/**
 * Faturar UMA OS com um método que só sabe faturar etapa inteira.
 *
 * A trava é a conferência do meio, e ela é o coração desta função: entre mover a
 * OS e disparar o lote, lê-se do Omie quem está na etapa de isolamento. Se houver
 * qualquer outra OS ali, ABORTA — porque disparar seria emitir nota de terceiro,
 * e nota emitida não se apaga, se cancela com prazo e justificativa.
 *
 * A mesma conferência pega o outro lado: se a OS NÃO chegou na etapa (o Omie
 * engole troca de etapa em silêncio, foi assim que esta função se enganou por
 * duas emissões), a etapa volta vazia e o lote não é disparado.
 */
async function faturarIsolada(nCodOS: number, etapaIsolamento: string): Promise<{
  ok: boolean; erro?: string; lote?: any; mensagem_omie?: string | null;
}> {
  const voltarParaFila = async () => {
    try { await trocarEtapa(nCodOS, ETAPA_FILA); } catch { /* não piora nada */ }
  };

  await trocarEtapa(nCodOS, etapaIsolamento);

  let ocupantes = await ocupantesDaEtapa(etapaIsolamento);
  if (!ocupantes.includes(nCodOS)) {
    await voltarParaFila();
    return { ok: false, erro: `A OS ${nCodOS} não chegou na etapa de isolamento ${etapaIsolamento} (o Omie aceitou a troca e não moveu). Nada foi faturado.` };
  }
  if (ocupantes.length !== 1) {
    /* Corredor sujo não desiste na primeira: varre a sobra NOSSA (poupando esta
     * OS) e reconfere. Antes daqui, uma OS esquecida por uma rodada anterior
     * abortava esta e todas as seguintes, para sempre. */
    const limpeza = await limparCorredor(etapaIsolamento, [nCodOS]);
    if (limpeza.restantes.length) {
      await voltarParaFila();
      return {
        ok: false,
        erro: limpeza.lote_em_voo
          ? `O lote ${limpeza.lote_em_voo} ainda está em processamento com ${limpeza.restantes.length} OS na etapa ${etapaIsolamento}. Nada foi faturado — tente de novo em alguns minutos.`
          : `A etapa de isolamento ${etapaIsolamento} tem ${limpeza.restantes.length} OS que não são desta emissão (${limpeza.restantes.slice(0, 5).join(", ")}…) e não saíram. Faturar aqui emitiria nota delas também — abortado.`,
      };
    }
    // Sem re-listar: a varredura poupou só a nossa e removeu o resto. Repetir o
    // `ListarOS` aqui esbarraria na trava por método do Omie.
    ocupantes = [nCodOS];
  }

  /* O DISPARO. Uma tentativa só, e o erro se investiga em vez de se repetir.
   *
   * A primeira versão daqui repetia a chamada na trava de "consumo redundante" —
   * e essa trava quer dizer que a chamada ANTERIOR foi aceita. Medido na emissão
   * da OS 1628: o lote 5511522270 nasceu às 11:18:14 com ela dentro, a retentativa
   * levou "Aguarde 34 segundos", e a função devolveu ERRO ao operador. Às 11:21:17
   * o mesmo lote concluiu DONE, "Ordem de Serviço faturada com sucesso!", NFS-e
   * 16901 autorizada. Ou seja: a nota existia e o Hub dizia que não — a pior das
   * duas mentiras possíveis, porque manda emitir de novo o que já foi emitido.
   * Escrita não se repete no escuro: procura-se o efeito.
   */
  let nIdLoteFat = 0;
  try {
    const r = await omieCall<any>("servicos/oslote", "FaturarLoteOS", { cEtapa: etapaIsolamento }, { semRetentativa: true });
    nIdLoteFat = Number(r?.nIdLoteFat ?? 0);
  } catch (e) {
    const msg = mensagemDoOmie(e);
    if (!/redundante|processando|existe uma requisi|bloqueada/i.test(msg)) {
      await voltarParaFila();
      return { ok: false, erro: `FaturarLoteOS na etapa ${etapaIsolamento}: ${msg}` };
    }
    // "Já mandou isso": o lote provavelmente existe. Adota o mais recente que
    // veio pela API — e só desiste se não achar nenhum.
    nIdLoteFat = await ultimoLoteDaApi();
    if (!nIdLoteFat) {
      await voltarParaFila();
      return { ok: false, erro: `FaturarLoteOS na etapa ${etapaIsolamento}: ${msg} (e nenhum lote da API foi encontrado depois disso).` };
    }
  }
  if (!nIdLoteFat) {
    await voltarParaFila();
    return { ok: false, erro: "FaturarLoteOS não devolveu nIdLoteFat." };
  }

  /* Daqui em diante a OS NÃO SAI da etapa até o lote terminar.
   *
   * O Omie se defende sozinho disso — pedir a volta para a 50 no meio do
   * faturamento devolve "pode ser alterado apenas para as etapas: 60" e a OS fica
   * onde está —, mas a defesa é dele, não nossa: não se desmonta o isolamento com
   * o lote em voo.
   *
   * E ESPERAR É NORMAL. A OS 1628 levou 3 minutos entre disparo e conclusão; um
   * teto de 30s dava "não faturou" para nota que estava a caminho da prefeitura.
   * O que não couber na espera volta como "em processamento", que é diferente de
   * falha e não manda ninguém emitir de novo.
   */
  const lote = await esperarLote(nIdLoteFat).catch(() => null);
  /* A mensagem por OS é o que explica a recusa em português — e a recusa costuma
   * ser cadastro do CLIENTE, não da nota: o lote de junho terminou "ERROR" com
   * "Para emitir a NFS-e falta preencher o E-mail." e "CEP não pertence à faixa
   * válida para o estado RJ.". Sem ela, o operador só veria "não faturou". */
  const detalhes: any[] = lote?.osLote ?? lote?.lotesOS ?? lote?.detalhes ?? [];
  const meu = detalhes.find((d: any) => Number(d?.nCodOS) === nCodOS) ?? detalhes[0] ?? null;
  const mensagem = meu?.cDesStatus ?? meu?.cMensagem ?? lote?.cDesStatus ?? null;

  return {
    ok: true,
    lote: { nIdLoteFat, cStatus: lote?.cStatus ?? null, nQtdeTotal: lote?.nQtdeTotal ?? null, nQtdeProcessadas: lote?.nQtdeProcessadas ?? null },
    mensagem_omie: mensagem,
  };
}

/**
 * Uma cobrança, do começo ao fim. Devolve o que aconteceu — e NUNCA lança: quem
 * chama está num lote, e uma cobrança que falha não pode derrubar as outras.
 */
async function emitirUma(
  supabase: any, molde: any, cob: any, cfg: any,
  usuario: string | null, seco: boolean, operador: string | null = null, avulsa = false,
) {
  const registrar = async (acao: string, resultado: string, extra: Record<string, unknown>) => {
    if (seco) return;
    await supabase.from("nf_emissoes").insert({
      id_asaas: cob.id_asaas, acao, resultado, usuario, operador, avulsa, ...extra,
    });
  };

  try {
    /* 0. A REGRA DO DINHEIRO, de novo.
     *
     * Quem chega aqui já passou pela porta (`passarPelaPorta`), então esta
     * conferência normalmente não barra nada — e é para ser assim. Ela existe
     * porque esta função é chamável de outros lugares, e a guarda que só vale
     * quando o caminho de sempre é usado não é guarda: foi exatamente assim que
     * o estorno ficou barrado apenas no TypeScript da tela enquanto a Edge
     * Function emitia normalmente para quem chamasse direto.
     */
    if (cob.bloqueio) {
      await registrar(cob.n_cod_os ? "faturar" : "criar_e_faturar", "bloqueado", {
        n_cod_os: cob.n_cod_os ? Number(cob.n_cod_os) : null,
        erro: String(cob.bloqueio),
      });
      return { id_asaas: cob.id_asaas, ok: false, bloqueado: true, erro: String(cob.bloqueio) };
    }

    // 1. Já tem OS? (carimbo primeiro, heurística depois — a mesma ordem da RPC)
    let nCodOS: number | null = cob.n_cod_os ? Number(cob.n_cod_os) : null;
    let acao: string = nCodOS ? "faturar" : "criar_e_faturar";

    if (!nCodOS) {
      if (!cob.n_cod_cli) {
        return { id_asaas: cob.id_asaas, ok: false, erro: "Cliente sem cadastro no Omie (CNPJ/CPF não encontrado)." };
      }
      const payload = montarOS(molde, {
        id_asaas: cob.id_asaas,
        nCodCli: Number(cob.n_cod_cli),
        valor: Number(cob.valor),
        vencimento: cob.data_vencimento ?? cob.data_pagamento,
        descricao: cob.descricao ?? "Serviço prestado",
        email: cob.email,
      });
      if (seco) return { id_asaas: cob.id_asaas, ok: true, seco: true, acao, payload };

      const r = await omieCall<any>("servicos/os", "IncluirOS", payload);
      nCodOS = Number(r?.nCodOS ?? 0);
      if (!nCodOS) throw new Error(`IncluirOS não devolveu nCodOS: ${JSON.stringify(r).slice(0, 200)}`);
      await registrar("criar_os", "ok", { n_cod_os: nCodOS, payload });
    } else if (seco) {
      return { id_asaas: cob.id_asaas, ok: true, seco: true, acao, n_cod_os: nCodOS };
    }

    /* 1b. JÁ TEM NOTA? Então não se emite de novo.
     *
     * Vale só para OS que já existia (a recém-criada não pode estar faturada), e
     * é a trava contra o pior acidente deste módulo: emitir a segunda nota da
     * mesma cobrança porque a primeira foi reportada errado. Aconteceu — ver o
     * comentário do disparo em `faturarIsolada`. Sem esta leitura, a defesa era o
     * Omie recusar a troca de etapa com "pode ser alterado apenas para as etapas:
     * 60", uma frase que não diz a ninguém que a nota já existe.
     */
    if (acao === "faturar") {
      const sPrevio = await omieCall<any>("servicos/os", "StatusOS", { nCodOS });
      if (String(sPrevio?.cFaturada ?? "N") === "S") {
        const nfsePrevia = nfseDoStatus(sPrevio);
        await supabase.from("nf_os_omie").upsert({
          n_cod_os: nCodOS, ...nfsePrevia,
          c_cod_int_os: cob.id_asaas,
          etapa: String(sPrevio?.cEtapa ?? "") || null,
          faturada: true,
          cancelada: String(sPrevio?.cCancelada ?? "N") === "S",
          valor: Number(cob.valor),
          data_faturamento: isoDeBR(sPrevio?.dDtFat),
          status_lido_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        }, { onConflict: "n_cod_os" });
        return {
          id_asaas: cob.id_asaas, ok: true, ja_emitida: true, n_cod_os: nCodOS,
          nfse_numero: nfsePrevia.nfse_numero ?? null, nfse_status: nfsePrevia.nfse_status ?? null,
          nfse_verificacao: nfsePrevia.nfse_verificacao ?? null,
          aviso: `A OS ${sPrevio?.cNumOS ?? nCodOS} já estava faturada em ${sPrevio?.dDtFat} com a NFS-e ${nfsePrevia.nfse_numero ?? "?"}. Nada foi emitido agora.`,
        };
      }
    }

    /* 2. Faturar = emitir. É aqui que a nota nasce — e NÃO é trocando de etapa.
     *
     * Ver o cabeçalho do arquivo: subir a OS até a etapa 60 devolve sucesso e não
     * fatura nada. Quem fatura é `FaturarLoteOS`, que trata a etapa inteira; a
     * isolação e a conferência de raio moram em `faturarIsolada`.
     */
    const etapaIso = String(cfg.etapa_isolamento ?? ETAPA_ISOLAMENTO_PADRAO);
    const fat = await faturarIsolada(nCodOS, etapaIso);
    if (!fat.ok) {
      await registrar(acao, "erro", { n_cod_os: nCodOS, erro: fat.erro });
      return { id_asaas: cob.id_asaas, ok: false, n_cod_os: nCodOS, erro: fat.erro };
    }

    /* 3. CONFERIR — e não presumir.
     *
     * A primeira versão devolvia "emitida" logo depois do TrocarEtapaOS, sem
     * olhar o resultado. Como o Omie engole o salto de etapa em silêncio, ela
     * reportou 1 nota emitida quando nenhuma existia, e ainda gravou a OS como
     * faturada no espelho. Um erro que se anuncia como sucesso é pior do que o
     * erro: some da lista do que falta.
     *
     * O RPS pode legitimamente demorar para voltar da prefeitura — isso SIM é
     * "em processamento", e é diferente de não ter faturado.
     */
    await dorme(4000);
    const s = await omieCall<any>("servicos/os", "StatusOS", { nCodOS });
    const nfse = nfseDoStatus(s);
    const faturada = String(s?.cFaturada ?? "N") === "S";

    await supabase.from("nf_os_omie").upsert({
      n_cod_os: nCodOS, ...nfse,
      c_cod_int_os: cob.id_asaas,
      etapa: String(s?.cEtapa ?? "") || null,
      faturada,
      cancelada: String(s?.cCancelada ?? "N") === "S",
      valor: Number(cob.valor),
      status_lido_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "n_cod_os" });

    if (!faturada) {
      /* Não faturou: tira a OS do corredor e devolve para a fila — MAS só com o
       * lote encerrado. Com o lote ainda RUNNING, mover a OS é exatamente o que
       * emperrou o lote 5511522270 em 0/1: o faturamento foi procurar na etapa uma
       * OS que já tinha saído. Lote em andamento é para esperar, não para desfazer;
       * a OS fica no corredor e a próxima emissão avisa que ele está ocupado. */
      const loteEncerrado = fat.lote?.cStatus && String(fat.lote.cStatus) !== "RUNNING";
      if (String(s?.cEtapa ?? "") === etapaIso && loteEncerrado) {
        try { await omieCall<any>("servicos/os", "TrocarEtapaOS", { nCodOS, cEtapa: ETAPA_FILA }); } catch { /* segue */ }
      }
      // A razão da recusa vem do lote, não do StatusOS: "falta preencher o E-mail",
      // "CEP não pertence à faixa válida para o estado RJ" — cadastro do cliente.
      const erro = loteEncerrado
        ? `A OS ${s?.cNumOS ?? nCodOS} não faturou${fat.mensagem_omie ? `: ${fat.mensagem_omie}` : ` (lote ${fat.lote?.cStatus})`}. Nenhuma nota foi emitida.`
        : `O lote ${fat.lote?.nIdLoteFat} da OS ${s?.cNumOS ?? nCodOS} ainda está em processamento no Omie (${fat.lote?.nQtdeProcessadas ?? 0}/${fat.lote?.nQtdeTotal ?? 1}). A OS ficou na etapa ${etapaIso}; consulte de novo em alguns minutos antes de tentar outra emissão.`;
      // Lote em voo não é erro de emissão — é nota a caminho. O diário registra
      // as duas coisas com nomes diferentes para que "o que falta emitir" não
      // engorde com nota que já está na prefeitura.
      await registrar(acao, loteEncerrado ? "erro" : "em_processamento", {
        n_cod_os: nCodOS, erro,
        ...(fat.lote?.nIdLoteFat ? { payload: { lote: Number(fat.lote.nIdLoteFat) } } : {}),
      });
      return {
        id_asaas: cob.id_asaas, ok: false, n_cod_os: nCodOS, erro,
        em_processamento: !loteEncerrado, lote: fat.lote ?? null, status_bruto: s,
      };
    }

    await registrar(acao, "ok", { n_cod_os: nCodOS, nfse_numero: nfse.nfse_numero ?? null });
    return {
      id_asaas: cob.id_asaas, ok: true, n_cod_os: nCodOS,
      nfse_numero: nfse.nfse_numero ?? null, nfse_status: nfse.nfse_status ?? null,
      nfse_rps: nfse.nfse_rps ?? null, nfse_xml: nfse.nfse_xml ?? null,
      nfse_verificacao: nfse.nfse_verificacao ?? null, status_bruto: s,
      lote: fat.lote ?? null, mensagem_omie: fat.mensagem_omie ?? null,
    };
  } catch (e) {
    const erro = mensagemDoOmie(e).slice(0, 400);
    await registrar("criar_e_faturar", "erro", { erro });
    return { id_asaas: cob.id_asaas, ok: false, erro };
  }
}

/* ----------------------------- rodada diária ----------------------------- */

/**
 * O MOTOR DE LOTE — da rodada diária e, desde 25/08/26, também da emissão manual.
 *
 * O caminho antigo fazia, por cobrança: varria as 1.208 OS para conferir o raio,
 * disparava um lote e esperava a prefeitura. Eram ~2min30s cada — 50 notas em duas
 * horas, e não cabia nos 150s da Edge Function nem de longe. Pior: bastava uma OS
 * presa no corredor para as seguintes pararem todas.
 *
 * Aqui a conta muda de forma: TODAS as OS da leva entram na etapa de isolamento e
 * sai UM lote para todas. As 211 OS do lote manual de junho levaram 3 minutos —
 * o custo do lote é praticamente o mesmo para 1 ou para 20.
 *
 * A trava de raio continua inteira, só que plural: em vez de "a etapa tem
 * exatamente 1 OS", é "a etapa tem exatamente AS QUE EU ACABEI DE PÔR". Se
 * aparecer qualquer OS que a rodada não criou, ela aborta sem faturar — porque
 * faturar ali emitiria nota de terceiro.
 *
 * E NÃO ESPERA O DESFECHO. A nota nasce minutos depois do lote; segurar a função
 * até lá gastaria a janela inteira à toa. A rodada grava `em_processamento` e vai
 * embora — quem descobre o fim é o `espelhar`, que já sabe fechar o diário.
 */
async function emitirDia(
  supabase: any,
  cfg: any,
  opts: { origem: string; operador: string | null; usuario: string | null; ids?: string[]; avulsa?: boolean },
) {
  /* `emissao_automatica` governa o CRON, não a pessoa.
   *
   * Com `ids` na mão foi alguém que mandou emitir, e quem quer ensaio pede
   * `previa` — que é uma ação própria. Deixar o modo do cron calar a emissão
   * manual faria a tela devolver "modo ensaio" para quem clicou em emitir. */
  const manual = Array.isArray(opts.ids) && opts.ids.length > 0;

  /* A AVULSA É FILHA DO `manual`, e o `&&` é a guarda, não um detalhe de estilo.
   *
   * Sem ele, um `{ avulsa: true }` sem `ids` — um cron mal configurado, um
   * script que copiou o corpo errado — poria a fila automática inteira sob a
   * régua larga e emitiria as confirmadas do mês numa varredura. A decisão de
   * 20/08/26 é justamente que isso não acontece sozinho: a régua larga só existe
   * quando alguém apontou para cobranças específicas. */
  const avulsa = manual && opts.avulsa === true;
  // O `modo` é o que a rodada assina em `nf_execucoes`, e "avulsa" tem de se ler
  // de longe: é a rodada que emitiu sob a régua larga.
  const modo = avulsa ? "avulsa" : manual ? "manual" : String(cfg?.emissao_automatica ?? "previa");
  const etapaIso = String(cfg?.etapa_isolamento ?? ETAPA_ISOLAMENTO_PADRAO);
  const tetoDia = Number(cfg?.teto_dia ?? 120);
  const tetoRodada = Number(cfg?.teto_rodada ?? 20);

  const { data: exec } = await supabase
    .from("nf_execucoes")
    .insert({ origem: opts.origem, modo })
    .select("id")
    .single();
  const idExec = exec?.id ?? null;

  const fechar = async (campos: Record<string, unknown>) => {
    if (idExec) {
      await supabase.from("nf_execucoes")
        .update({ concluida_em: new Date().toISOString(), ...campos })
        .eq("id", idExec);
    }
    return { execucao: idExec, modo, ...campos };
  };

  try {
    if (modo === "off") return await fechar({ pulada: "emissão automática desligada em Configurações" });

    /* A ORDEM AQUI É CUSTO, e por isso o barato vem primeiro.
     *
     * A conferência do corredor de isolamento custa `ListarOS` inteiro — 3
     * páginas, 1.207 OS — e vinha ANTES de perguntar se havia algo a emitir. Com
     * o cron rodando de 10 em 10 minutos e a fila vazia (o corte é 01/09/26),
     * eram 6 varreduras completas do Omie por dia para descobrir seis vezes que
     * não havia nada a fazer. A fila e o teto do dia são consultas ao Postgres,
     * custam zero no Omie, e respondem a mesma pergunta antes.
     */
    const { data: jaHoje } = await supabase.rpc("notas_fiscais_emitidas_hoje");
    const resta = tetoDia - Number(jaHoje ?? 0);
    if (resta <= 0) {
      return await fechar({ pulada: `teto do dia atingido (${jaHoje}/${tetoDia}).` });
    }

    /* DE ONDE VEM A LEVA — e por que a emissão manual passa a entrar por aqui.
     *
     * Sem `ids`, é a fila do dia: o caminho do cron, como sempre foi. Com `ids`,
     * são as cobranças que uma pessoa escolheu — e o que elas ganham é ESTE
     * motor, o do lote único. O caminho manual antigo (`emitirUma`, uma por
     * chamada) varre as 1.200 OS, dispara um lote e espera a prefeitura PARA
     * CADA NOTA: ~2min30s cada, duas horas para 50. Aqui o lote é um só para a
     * leva inteira, e o custo dele é o mesmo para 1 ou para 50.
     *
     * O que não muda: a porta do dinheiro, a trava de raio e o diário. Muda o
     * número de lotes, não o rigor.
     */
    const tetoLote = Number(cfg?.teto_lote ?? 50);
    const limite = Math.max(0, Math.min(manual ? tetoLote : tetoRodada, resta));

    let fila: any[];
    let jaComNota: any[] = [];
    if (manual) {
      // `candidatas` traz `ja_tem_nota` — quem já tem nota não entra no lote de
      // jeito nenhum: é a trava contra a segunda nota da mesma cobrança. Elas não
      // somem da resposta, porém: voltam marcadas, senão a tela anunciaria menos
      // cobranças tratadas do que o operador mandou e ninguém saberia por quê.
      const linhas = await candidatas(supabase, opts.ids!.slice(0, limite), avulsa);
      jaComNota = (linhas ?? []).filter((c: any) => c.ja_tem_nota);
      fila = (linhas ?? []).filter((c: any) => !c.ja_tem_nota);
    } else {
      const { data, error: erroFila } = await supabase.rpc("notas_fiscais_fila_emissao", { p_limite: limite });
      if (erroFila) throw new Error(`fila: ${erroFila.message}`);
      fila = data ?? [];
    }
    /** A linha da cobrança que já tinha nota, no formato que a tela lê. */
    const linhaJaEmitida = (c: any) => ({
      id_asaas: c.id_asaas, ok: true, ja_emitida: true,
      n_cod_os: c.n_cod_os ?? null,
      aviso: `A cobrança ${c.id_asaas} já tem nota. Nada foi emitido agora.`,
    });

    if (!fila.length) {
      return await fechar({
        fila: 0,
        pulada: jaComNota.length
          ? `as ${jaComNota.length} cobranças informadas já têm nota.`
          : "nada a emitir.",
        ...(manual ? { resultados: jaComNota.map(linhaJaEmitida) } : {}),
      });
    }

    /* A PORTA. A fila já vem filtrada pelo banco (só recebida, sem estorno), mas
     * o banco é o espelho de 12:15 e isto aqui roda às 13h. Uma requisição por
     * cobrança ao Asaas responde o que nenhum espelho responde: o dinheiro ainda
     * está aqui AGORA? No ensaio a porta também vale — e registra —, senão o
     * ensaio prometeria emitir o que a emissão de verdade recusaria. */
    const { liberadas, barradas } = await passarPelaPorta(supabase, fila, {
      seco: false, usuario: opts.usuario, operador: opts.operador, avulsa,
    });
    if (!liberadas.length) {
      return await fechar({
        fila: fila.length, bloqueadas: barradas.length,
        pulada: `as ${barradas.length} cobranças da fila foram barradas na conferência com o Asaas.`,
        detalhe: { barradas: barradas.slice(0, 20) },
      });
    }

    /* O ENSAIO. `previa` existe porque o primeiro dia de um processo que emite
     * nota fiscal sozinho não deveria ser o dia em que se descobre o que ele
     * escolheria. Grava no diário exatamente as cobranças que teria emitido, com
     * hora, e não toca no Omie. */
    if (modo === "previa") {
      await supabase.from("nf_emissoes").insert(liberadas.map((c: any) => ({
        id_asaas: c.id_asaas, n_cod_os: c.n_cod_os ?? null,
        acao: "previa", resultado: "ok",
        erro: `Ensaio: teria emitido R$ ${Number(c.valor).toFixed(2)} (${c.descricao ?? "—"}).`,
        avulsa,
        usuario: opts.usuario, operador: opts.operador,
      })));
      return await fechar({
        fila: fila.length, bloqueadas: barradas.length,
        pulada: "modo ensaio (previa): nada foi emitido no Omie.",
        ...(barradas.length ? { detalhe: { barradas: barradas.slice(0, 20) } } : {}),
      });
    }

    /* Corredor livre? Se não estiver, VARRE antes de desistir.
     *
     * Uma OS esquecida na etapa de isolamento — lote anterior em voo, rodada que
     * morreu no meio — abortava esta rodada e todas as seguintes: o corredor não
     * se limpava sozinho, e a esteira ficava parada até alguém mover a OS na mão
     * no Omie. Agora a sobra nossa volta para a fila e o dia segue; só OS de
     * terceiro (ou já faturada, que não se move) ainda interrompe. */
    let varridas: number[] = [];
    {
      /* Uma varredura só. `limparCorredor` já lista as OS — perguntar antes com
       * `ocupantesDaEtapa` era um `ListarOS` inteiro a mais, colado no dele, e a
       * trava do Omie é POR MÉTODO: as duas seguidas devolvem "Consumo redundante
       * detectado. Aguarde 11 segundos". */
      const limpeza = await limparCorredor(etapaIso);
      varridas = limpeza.removidas;
      if (limpeza.restantes.length) {
        return await fechar({
          fila: fila.length, bloqueadas: barradas.length,
          pulada: limpeza.lote_em_voo
            ? `o lote ${limpeza.lote_em_voo} ainda está em processamento no Omie, com ${limpeza.restantes.length} OS na etapa ${etapaIso}. Nada foi criado — chame de novo em alguns minutos.`
            : `a etapa de isolamento ${etapaIso} tem ${limpeza.restantes.length} OS que não saíram (já faturadas, ou de fora do Hub). Nada foi criado.`,
          detalhe: { restantes: limpeza.restantes.slice(0, 20), varridas, ...(limpeza.lote_em_voo ? { lote_em_voo: limpeza.lote_em_voo } : {}) },
        });
      }
    }

    // 1. Cria a OS de quem ainda não tem e leva todas para o corredor.
    const molde = await pegarMolde(supabase);
    const naLeva: Array<{ cob: any; nCodOS: number; acao: string }> = [];
    const falhas: Array<{ id_asaas: string; erro: string }> = [];

    for (const cob of liberadas) {
      try {
        let nCodOS = cob.n_cod_os ? Number(cob.n_cod_os) : 0;
        const acao = nCodOS ? "faturar" : "criar_e_faturar";
        if (!nCodOS) {
          const r = await omieCall<any>("servicos/os", "IncluirOS", montarOS(molde, {
            id_asaas: cob.id_asaas,
            nCodCli: Number(cob.n_cod_cli),
            valor: Number(cob.valor),
            vencimento: cob.data_vencimento ?? cob.data_pagamento,
            descricao: cob.descricao ?? "Serviço prestado",
            email: cob.email,
          }));
          nCodOS = Number(r?.nCodOS ?? 0);
          if (!nCodOS) throw new Error(`IncluirOS não devolveu nCodOS`);
          await supabase.from("nf_emissoes").insert({
            id_asaas: cob.id_asaas, n_cod_os: nCodOS, acao: "criar_os", resultado: "ok",
            avulsa,
            usuario: opts.usuario, operador: opts.operador,
          });
          /* O destinatário fica gravado no NASCIMENTO da OS, não depois.
           *
           * É aqui que se sabe o que foi para `cEnviarPara` — reconstituir isso
           * mais tarde custaria um `ConsultarOS` por nota. O espelho preenche o
           * resto da linha; o upsert por `n_cod_os` não apaga o que já existe. */
          await supabase.from("nf_os_omie").upsert({
            n_cod_os: nCodOS,
            c_cod_int_os: cob.id_asaas,
            valor: Number(cob.valor),
            email_envio: true,
            email_destino: cob.email ?? null,
            atualizado_em: new Date().toISOString(),
          }, { onConflict: "n_cod_os" });
        }
        await trocarEtapa(nCodOS, etapaIso);
        naLeva.push({ cob, nCodOS, acao });
      } catch (e) {
        const erro = mensagemDoOmie(e).slice(0, 400);
        falhas.push({ id_asaas: cob.id_asaas, erro });
        await supabase.from("nf_emissoes").insert({
          id_asaas: cob.id_asaas, acao: "criar_e_faturar", resultado: "erro", erro,
          avulsa,
          usuario: opts.usuario, operador: opts.operador,
        });
      }
    }

    if (!naLeva.length) {
      return await fechar({
        fila: fila.length, bloqueadas: barradas.length, falhas: falhas.length,
        pulada: "nenhuma OS chegou ao corredor.", detalhe: { falhas },
      });
    }

    // 2. A trava de raio, agora plural — e com uma chance de limpeza antes de desistir.
    let agora = await ocupantesDaEtapa(etapaIso);
    const meus = new Set(naLeva.map((x) => x.nCodOS));
    if (agora.some((n) => !meus.has(n))) {
      const limpeza = await limparCorredor(etapaIso, [...meus]);
      varridas = varridas.concat(limpeza.removidas);
      /* Sem re-listar: quem sobra no corredor é `restantes` mais a leva poupada.
       * Um `ListarOS` colado no que `limparCorredor` acabou de fazer bate na trava
       * por método do Omie e derruba a rodada inteira por excesso de zelo. */
      const intrusas = limpeza.restantes;
      agora = agora.filter((n) => meus.has(n));
      if (intrusas.length) {
        // Aqui SIM desiste: sobrou OS que esta rodada não criou e que não saiu.
        // Faturar a etapa emitiria nota dela — e nota não se apaga.
        for (const { nCodOS } of naLeva) {
          try { await trocarEtapa(nCodOS, ETAPA_FILA); } catch { /* segue */ }
        }
        return await fechar({
          fila: fila.length, bloqueadas: barradas.length, falhas: falhas.length,
          pulada: `a etapa ${etapaIso} tem ${intrusas.length} OS que esta rodada não criou e não saíram. Faturar aqui emitiria nota delas — abortado.`,
          detalhe: { intrusas: intrusas.slice(0, 20), varridas },
        });
      }
    }
    /* A LISTAGEM ATRASA EM RELAÇÃO À TROCA DE ETAPA — e uma vez só não basta.
     *
     * Medido em 26/08/26, reemitindo 14 OS: as 14 `TrocarEtapaOS` foram aceitas,
     * o `ListarOS` logo depois devolveu a etapa VAZIA, e a função reportou "14
     * falhas, 0 despachadas" — enquanto o Omie, dois minutos depois, faturava as
     * 14. O Hub disse que nada saiu e nasceram 14 notas: a pior das duas mentiras,
     * porque manda emitir de novo o que já foi emitido.
     *
     * A releitura tem de esperar. `ocupantesDaEtapa` é `ListarOS`, e dois colados
     * batem na trava por método ("Consumo redundante detectado. Aguarde N
     * segundos") — os 6s são a pausa que a trava pede E o tempo que o Omie leva
     * para a listagem alcançar as escritas.
     */
    let faltando = naLeva.filter((x) => !agora.includes(x.nCodOS));
    if (faltando.length) {
      await dorme(6000);
      const relista = await ocupantesDaEtapa(etapaIso).catch(() => [] as number[]);
      // Só os nossos entram na segunda leitura: intrusa já foi tratada acima, e
      // aceitar de volta o que a varredura removeu desfaria a trava de raio.
      agora = [...new Set([...agora, ...relista.filter((n) => meus.has(n))])];
      faltando = naLeva.filter((x) => !agora.includes(x.nCodOS));
    }
    if (faltando.length) {
      // O Omie engole troca de etapa em silêncio; quem não chegou não vai no lote.
      for (const f of faltando) {
        falhas.push({ id_asaas: f.cob.id_asaas, erro: `A OS ${f.nCodOS} não chegou na etapa ${etapaIso}.` });
      }
    }

    /* NENHUMA CONFIRMADA, NENHUM DISPARO.
     *
     * `FaturarLoteOS` fatura a ETAPA, não uma lista — disparar "sem ninguém
     * dentro" não é inofensivo: entre a listagem e o processamento do lote, o
     * que estiver na etapa entra. Foi exatamente o que aconteceu no lote
     * 5513872150. Se a leitura não confirma ninguém, a resposta certa é não
     * disparar e deixar o corredor para a varredura da próxima rodada. */
    const entraram = naLeva.filter((x) => agora.includes(x.nCodOS));
    if (!entraram.length) {
      return await fechar({
        fila: fila.length, bloqueadas: barradas.length, falhas: falhas.length,
        pulada: `nenhuma das ${naLeva.length} OS foi confirmada na etapa ${etapaIso} depois de duas leituras. ` +
          "Nada foi faturado — as OS podem estar no corredor, e a próxima rodada varre antes de disparar.",
        detalhe: { falhas: falhas.slice(0, 20), ...(varridas.length ? { varridas } : {}) },
        ...(manual ? { resultados: falhas.map((f) => ({ id_asaas: f.id_asaas, ok: false, erro: f.erro })) } : {}),
      });
    }

    // 3. UM lote para a leva inteira.
    const r = await omieCall<any>("servicos/oslote", "FaturarLoteOS", { cEtapa: etapaIso }, { semRetentativa: true })
      .catch(async (e) => {
        const msg = mensagemDoOmie(e);
        if (!/redundante|processando|existe uma requisi|bloqueada/i.test(msg)) throw e;
        return { nIdLoteFat: await ultimoLoteDaApi() };
      });
    const nIdLoteFat = Number(r?.nIdLoteFat ?? 0);
    if (!nIdLoteFat) throw new Error("FaturarLoteOS não devolveu nIdLoteFat.");

    // 4. Registra a intenção por cobrança. O desfecho é do `espelhar`.
    await supabase.from("nf_emissoes").insert(entraram.map((x) => {
      /* O ESTADO DA COBRANÇA NO INSTANTE DA EMISSÃO — só na avulsa, e é o que
       * responde a pergunta que um contador faz meses depois: esta nota saiu
       * antes de o dinheiro entrar? O status vive em `asaas_cache` e MUDA (a
       * confirmada de hoje é a recebida de amanhã), então perguntar depois não
       * reconstitui nada. Aqui é a única hora em que a resposta existe. */
      const st = String(x.cob.status_asaas ?? "").toUpperCase();
      return {
        id_asaas: x.cob.id_asaas, n_cod_os: x.nCodOS, acao: x.acao, resultado: "em_processamento",
        erro: `Lote ${nIdLoteFat} disparado com ${entraram.length} OS. A nota nasce em alguns minutos; o próximo sync grava o número.`
          + (avulsa ? ` Avulsa: emitida com a cobrança em ${st || "status desconhecido"}.` : ""),
        avulsa,
        // O lote em coluna e não só na frase: é por ele que o `fecharRecusadas` vai
        // reler o `detalhes[]` e descobrir quem o Omie recusou no faturamento.
        payload: { lote: nIdLoteFat, ...(avulsa ? { avulsa: true, status_na_emissao: st || null } : {}) },
        usuario: opts.usuario, operador: opts.operador,
      };
    }));

    return await fechar({
      fila: fila.length, bloqueadas: barradas.length,
      emitidas: entraram.length, falhas: falhas.length,
      lote: nIdLoteFat,
      detalhe: {
        falhas: falhas.slice(0, 20),
        ...(barradas.length ? { barradas: barradas.slice(0, 20) } : {}),
        ...(varridas.length ? { varridas } : {}),
      },
      /* A lista por cobrança, que é o que a tela sabe ler: três estados, três
       * avisos diferentes. Só no caminho manual — a rodada do cron não tem tela
       * para quem contar, e a lista inteira num log de execução é ruído. */
      ...(manual ? {
        resultados: [
          ...jaComNota.map(linhaJaEmitida),
          ...barradas.map((b) => ({ id_asaas: b.id_asaas, ok: false, bloqueado: true, erro: b.motivo })),
          ...falhas.map((f) => ({ id_asaas: f.id_asaas, ok: false, erro: f.erro })),
          ...entraram.map((x) => ({
            id_asaas: x.cob.id_asaas, ok: false, em_processamento: true, n_cod_os: x.nCodOS,
            erro: `Lote ${nIdLoteFat} disparado com ${entraram.length} OS. A nota nasce em alguns minutos; o próximo sync grava o número.`,
          })),
        ],
      } : {}),
    });
  } catch (e) {
    return await fechar({ erro: mensagemDoOmie(e).slice(0, 500) });
  }
}

/**
 * As cobranças que o lote vai tratar, já com cliente do Omie e OS resolvidos.
 *
 * `p_avulsa` decide só o `bloqueio` que volta em cada linha — é a régua do
 * dinheiro. O `ja_tem_nota` da mesma linha não muda com ele, e é assim que tem
 * de ser: a avulsa não é licença para emitir a segunda nota de nada.
 */
async function candidatas(supabase: any, ids: string[], avulsa = false) {
  const { data: linhas, error } = await supabase.rpc("notas_fiscais_candidatas", {
    p_ids: ids, p_avulsa: avulsa,
  });
  if (error) throw new Error(`notas_fiscais_candidatas: ${error.message}`);
  return linhas ?? [];
}

/**
 * Existe nota a caminho da prefeitura esperando desfecho?
 *
 * O `espelhar` que roda depois da emissão serve para uma coisa: descobrir o
 * número da nota que nasceu e fechar no diário a linha `em_processamento`. Se
 * não há nenhuma linha aberta e a rodada não emitiu nada, ele varre as 1.207 OS
 * e consulta status para não fechar nada — e faz isso seis vezes por dia, que é
 * o custo de um hábito, não de uma necessidade. O espelho completo continua
 * garantido pelo cron das 18h (`nf-espelho-tarde`).
 *
 * Duas leituras locais, sem paginação: as linhas em processamento das últimas
 * 48h e os desfechos do mesmo período. Aberta é a que não ganhou um `ok` depois.
 */
async function haNotaNoForno(supabase: any): Promise<boolean> {
  const desde = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const [{ data: forno }, { data: fechadas }] = await Promise.all([
    supabase.from("nf_emissoes").select("id_asaas, criado_em")
      .eq("resultado", "em_processamento").gte("criado_em", desde),
    supabase.from("nf_emissoes").select("id_asaas, criado_em")
      .eq("resultado", "ok").gte("criado_em", desde),
  ]);
  if (!forno?.length) return false;

  const ultimoOk = new Map<string, string>();
  for (const f of fechadas ?? []) {
    const atual = ultimoOk.get(f.id_asaas);
    if (!atual || f.criado_em > atual) ultimoOk.set(f.id_asaas, f.criado_em);
  }
  return forno.some((f: any) => (ultimoOk.get(f.id_asaas) ?? "") < f.criado_em);
}

/* ---------------------------------- cron ---------------------------------- */

async function chamadaDeCron(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get("x-cron-token");
  if (!token) return false;
  const { data } = await supabase
    .from("internal_cron_tokens").select("name").eq("name", "omie-nfse-sync").eq("token", token).maybeSingle();
  return !!data;
}

function jwtRole(t: string): string | null {
  try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))?.role ?? null; } catch { return null; }
}

/* --------------------------------- handler -------------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "espelhar";

    // Quem é o chamador — e a emissão exige pessoa, não cron.
    let usuario: string | null = null;
    let ehCron = await chamadaDeCron(req, supabase);
    if (!ehCron) {
      const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
      if (!token) return json({ erro: "Não autenticado." }, 401);
      if (jwtRole(token) !== "service_role") {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user) return json({ erro: "Não autenticado." }, 401);
        const { data: prof } = await supabase.from("profiles").select("cargo").eq("user_id", data.user.id).maybeSingle();
        if ((prof?.cargo ?? "").trim().toLowerCase() === "parcerias") {
          return json({ erro: "Você não tem permissão para esta ação." }, 401);
        }
        usuario = data.user.id;
      }
    }

    if (action === "espelhar") {
      /* `so_se_houver_forno` é o que torna barato rodar o espelho de 10 em 10
       * minutos. Sem nota esperando desfecho, a varredura completa das OS não
       * fecharia nada — e essa pergunta são duas leituras do Postgres, não um
       * `ListarOS`. Quem passa a bandeira é o cron da janela de emissão; o cron
       * das 18h não passa, porque o espelho completo do dia é garantia, não
       * economia. */
      if (body?.so_se_houver_forno === true && !(await haNotaNoForno(supabase).catch(() => true))) {
        return json({ ok: true, pulado: "nenhuma nota no forno — o espelho não teria o que fechar." });
      }
      const r = await espelhar(supabase, { tetoStatus: Math.min(Number(body?.teto_status ?? 120), 400) });

      /* O anexo mora aqui, e não no `emitir_dia`, por dois motivos.
       *
       * O primeiro é que só depois do espelho a nota TEM número: quem acabou de
       * faturar tem um RPS em '001' a caminho da prefeitura, e anexar exige o
       * arquivo que ainda não existe. O segundo é o relógio — a emissão já gasta
       * ~100s dos 150s da Edge Function, e pendurar upload nela seria disputar o
       * pouco que sobra com o que não pode ser interrompido.
       *
       * Na prática: o que sai às 13h é anexado às 18h, pelo cron do espelho. E se
       * o anexo falhar, ele falha sozinho — `catch` aqui é o que garante que uma
       * recusa do Asaas não apague o resultado do espelho, que é o trabalho
       * principal desta chamada. */
      const anexo = body?.anexar === false
        ? { pulado: "anexo desligado nesta chamada (anexar: false)." }
        : await anexarNoAsaas(supabase, { limite: Number(body?.limite_anexo ?? 5), prazoMs: 25_000 })
            .catch((e) => ({ erro: mensagemDoOmie(e) }));

      return json({ ok: true, ...r, anexo });
    }

    if (action === "emitir_dia") {
      const { data: cfg } = await supabase.from("nf_config").select("*").eq("id", 1).maybeSingle();
      const r = await emitirDia(supabase, cfg ?? {}, {
        origem: ehCron ? "cron" : "tela",
        operador: String(body?.operador ?? "").trim() || (ehCron ? "emissão automática (cron)" : null),
        usuario,
      });
      /* O ESPELHO SAIU DAQUI — 27/08/26, e a conta é de relógio.
       *
       * A rodada que cria 20 OS leva 116s dos 150s da Edge Function. Pendurar
       * nela um `ListarOS` de 3 páginas mais 40 `StatusOS` não é "um pouco mais
       * lento": é o worker derrubado sem exceção que se possa pegar. Foi o que
       * aconteceu no primeiro dia de emissão automática — a rodada das 13:00 UTC
       * criou as 20 OS, disparou o lote e MORREU antes de responder; as 17
       * seguintes voltaram 200 com o erro do espelho engolido pelo `.catch` e
       * jogado fora na resposta ao cron. Resultado: `nf_os_omie.atualizado_em`
       * parado das 10:01 às 15:00, `faturada` falso o dia inteiro, e a fila
       * servindo 17 vezes as mesmas cobranças que já tinham virado nota — 323
       * "não é possível trocar a etapa" e 17 lotes disparados à toa. Vinte notas
       * em dezoito rodadas.
       *
       * Agora o espelho tem cron próprio (`nf-espelho-rodada`, aos :05 de cada
       * janela), onde ele tem os 150s inteiros e não disputa o `ListarOS` com a
       * rodada. Aqui ele só roda a pedido explícito — a tela, que quer o número
       * na hora e aceita esperar. */
      const espelho = body?.espelhar === true
        ? await espelhar(supabase, { tetoStatus: Math.min(Number(body?.teto_status ?? 40), 400) })
            .catch((e) => ({ erro: mensagemDoOmie(e) }))
        : { pulado: "o espelho roda no cron `nf-espelho-rodada`, aos :05 — dentro da rodada ele não cabe nos 150s." };
      return json({ ok: true, ...r, espelho });
    }

    if (action === "anexar_nota") {
      /* Escrita no Asaas, e por isso o mesmo desenho da emissão: `previa: true`
       * baixa o XML e mostra o que subiria sem subir nada, `ids` estreita o
       * alcance a cobranças nomeadas, e sem `ids` a varredura anda pela fila do
       * mais recente para o mais antigo. Diferente da emissão, aqui o cron pode:
       * anexar a nota já emitida não é ato fiscal, é entrega — e entrega que
       * depende de alguém lembrar de clicar não acontece. */
      const r = await anexarNoAsaas(supabase, {
        limite: Number(body?.limite ?? 20),
        ids: Array.isArray(body?.ids) ? body.ids.map(String) : [],
        seco: body?.previa === true,
        // Só na prévia, e só a pedido: é o PDF inteiro voltando pela resposta,
        // para se poder OLHAR o papel antes de ele ir para a fatura de alguém.
        base64: body?.previa === true && body?.pdf_base64 === true,
      });
      return json({ ok: true, ...r });
    }

    /* Sonda de LEITURA no Asaas — mesma ideia do `sondar_metodos` do Omie.
     *
     * A pergunta que ela existe para responder: "o Asaas pretende emitir esta
     * nota?". O objeto `invoice` só nasce quando ele decide emitir, e ele decide
     * com até 29 dias de atraso (medido: p90 de 21 dias) — então a AUSÊNCIA de
     * invoice não prova nada. A configuração de nota fiscal da assinatura, se
     * for legível, prova. */
    if (action === "sondar_asaas") {
      const caminho = String(body?.path ?? "");
      if (!/^\/[A-Za-z0-9_\/-]+$/.test(caminho)) {
        return json({ ok: false, erro: "Informe { path: \"/subscriptions/…\" } — só leitura." }, 400);
      }
      try {
        const r = await asaasGet<any>(caminho, body?.params ?? {});
        return json({ ok: true, path: caminho, resposta: r });
      } catch (e) {
        return json({ ok: false, path: caminho, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    /* ---------------------- de quem é a nota: sonda ----------------------- */
    /* Pergunta ao Asaas, assinatura por assinatura, se ELE emite. 200 = dele,
     * 404 = nosso. Ver a migration `asaas_nf_config` para por que este é o único
     * sinal que vale, e por que ele não existe para cobrança avulsa.
     *
     * O custo no Asaas é UMA leitura por assinatura, uma vez — não por cobrança,
     * não por dia. ~1.100 assinaturas ativas contra a cota de 25.000 por 12h. */
    if (action === "sondar_nf_asaas") {
      const teto = Math.max(1, Math.min(Number(body?.teto ?? 80), 200));
      const { data: alvos, error } = await supabase.rpc("asaas_assinaturas_a_sondar", { p_limite: teto });
      if (error) return json({ ok: false, erro: `asaas_assinaturas_a_sondar: ${error.message}` }, 500);
      if (!alvos?.length) return json({ ok: true, sondadas: 0, restam: 0 });

      const inicio = Date.now();
      const linhas: any[] = [];
      let doAsaas = 0, doHub = 0, falhas = 0;
      for (const a of alvos) {
        if (Date.now() - inicio > 110_000) break;   // o bloco se mede em tempo
        try {
          const r = await asaasGet<any>(`/subscriptions/${a.assinatura}/invoiceSettings`);
          linhas.push({
            assinatura: a.assinatura, tem_config: true,
            periodo: String(r?.invoiceCreationPeriod ?? "") || null,
            lido_em: new Date().toISOString(), erro: null,
          });
          doAsaas++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          /* 404 é RESPOSTA, não falha: quer dizer "esta assinatura não tem
           * configuração de nota fiscal", que é exatamente o que se perguntou.
           * Qualquer outro erro fica `tem_config = null` — e null não emite. */
          if (/\[404\]/.test(msg)) {
            linhas.push({
              assinatura: a.assinatura, tem_config: false, periodo: null,
              lido_em: new Date().toISOString(), erro: null,
            });
            doHub++;
          } else {
            linhas.push({
              assinatura: a.assinatura, tem_config: null, periodo: null,
              lido_em: new Date().toISOString(), erro: msg.slice(0, 200),
            });
            falhas++;
          }
        }
        await dorme(250);   // o Asaas tem vaga e backoff próprios; isto é folga
      }
      if (linhas.length) {
        await supabase.from("asaas_nf_config").upsert(linhas, { onConflict: "assinatura" });
      }
      /* Quantas faltam vem por CONTAGEM, não por contar as linhas devolvidas: o
       * PostgREST corta a resposta em 1.000 sem avisar, e o "restam: 1000" que
       * ele produzia era o teto, não o resto — a sonda parecia não andar. Mesma
       * armadilha do `.limit(2000)` da classificação do Asaas. */
      const { count: restam } = await supabase
        .from("asaas_nf_config").select("assinatura", { count: "exact", head: true })
        .is("tem_config", null);
      return json({
        ok: true, sondadas: linhas.length,
        do_asaas: doAsaas, do_hub: doHub, sem_resposta: falhas,
        sem_config_ainda: restam ?? null,
        segundos: Math.round((Date.now() - inicio) / 1000),
      });
    }

    if (action === "sondar_metodos") {
      const extras = Array.isArray(body?.alvos)
        ? body.alvos.map((a: any) => [String(a?.[0] ?? ""), String(a?.[1] ?? "")] as [string, string])
        : [];
      return json({ ok: true, metodos: await sondarMetodos(extras) });
    }

    if (action === "etapas") {
      const r = await etapasEFaturamento({
        lote: body?.lote ? Number(body.lote) : undefined,
        os: body?.os ? Number(body.os) : undefined,
        consultar: body?.consultar === true,
        anexos: body?.anexos === true,
      });
      return json({ ok: true, ...r });
    }

    if (action === "previa" || action === "emitir") {
      /* Emitir é ato fiscal: nenhum job automático emite sozinho.
       *
       * A regra não é "token de sistema não emite" e sim "emissão DESACOMPANHADA
       * não acontece". Um operador com o token — conferindo uma nota de cada vez,
       * assinando o que mandou — é o oposto de um job rodando à noite. Por isso a
       * exceção é estreita nas duas pontas: UMA cobrança por chamada (um cron que
       * quisesse varrer o mês esbarra aqui) e `operador` obrigatório, que vai para
       * o diário no lugar do usuário logado.
       */
      const operador = String(body?.operador ?? "").trim();
      if (action === "emitir" && ehCron && !operador) {
        return json({
          erro: "Emissão por token de sistema exige o campo `operador` preenchido — é ele que assina no diário quem mandou.",
        }, 403);
      }

      const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
      if (!ids.length) return json({ erro: "Nenhuma cobrança informada." }, 400);

      /* A RÉGUA LARGA, e só quando pedida por escrito.
       *
       * `=== true` e não um truthy qualquer: `avulsa: "false"` (uma string, que é
       * o que sai de um formulário mal serializado) é truthy em JavaScript e
       * abriria a régua sem que ninguém tivesse pedido. O que está em jogo do
       * outro lado é nota fiscal emitida antes de o dinheiro entrar. */
      const avulsa = body?.avulsa === true;

      const { data: cfg } = await supabase.from("nf_config").select("*").eq("id", 1).maybeSingle();
      const teto = Number(cfg?.teto_lote ?? 50);
      if (ids.length > teto) {
        return json({ erro: `O lote tem ${ids.length} cobranças e o teto é ${teto}. Ajuste em Configurações ou divida o lote.` }, 400);
      }

      /* EMITIR AGORA VAI PELO MOTOR DE LOTE — o mesmo da rodada diária.
       *
       * O caminho antigo tratava cobrança por cobrança: para cada uma, varria as
       * 1.200 OS, disparava um lote e esperava a prefeitura. Deu ~2min30s por
       * nota, e 50 notas viraram duas horas — com o agravante de que uma OS presa
       * no corredor parava todas as seguintes. O motor de lote põe a leva inteira
       * na etapa de isolamento e dispara UM `FaturarLoteOS`, que custa o mesmo
       * para 1 ou para 50.
       *
       * O que muda para quem chama: ninguém volta com número de nota na mão. O
       * lote é assíncrono — todas voltam "em processamento" e quem grava o número
       * é o `espelhar`, minutos depois. É a mesma verdade de antes, dita na hora
       * certa em vez de esperada no telefone.
       *
       * `previa` continua no caminho de uma em uma: ela não toca no Omie, e o que
       * ela precisa mostrar é justamente o payload cobrança a cobrança.
       */
      if (action === "emitir") {
        const r = await emitirDia(supabase, cfg ?? {}, {
          origem: ehCron ? "cron" : "tela",
          operador: operador || (ehCron ? "emissão por token de sistema" : null),
          usuario,
          ids,
          avulsa,
        });
        const despachadas = Number((r as any)?.emitidas ?? 0);
        /* Rodada que não produziu nada precisa DIZER. Sem isto, uma recusa do
         * corredor ("tem OS de terceiro, nada foi criado") voltava como sucesso
         * silencioso: a tela não mostrava aviso nenhum e o operador ficava
         * olhando para uma lista que não tinha andado. */
        const resultados = ((r as any)?.resultados ?? []) as unknown[];
        const semNada = despachadas === 0 && resultados.length === 0;
        // `emitidas: 0` é literal: o lote foi disparado, a nota ainda não nasceu.
        // Anunciar emissão aqui seria o erro que este módulo mais teme — dizer
        // "pronto" para o que ainda pode voltar recusado pela prefeitura.
        return json({
          ok: true, ...r, emitidas: 0, despachadas, avulsa,
          ...(semNada && (r as any)?.pulada ? { erro: String((r as any).pulada) } : {}),
        });
      }

      /* O ensaio usa a MESMA régua que a emissão de verdade usaria. Uma prévia
       * que barrasse a confirmada e uma emissão que a deixasse passar seriam
       * dois processos com o mesmo nome — e o ensaio existe justamente para que
       * ninguém descubra o que a emissão escolhe no dia em que ela escolhe. */
      const linhas = await candidatas(supabase, ids, avulsa);
      /* Daqui para baixo só passa `previa`. `emitir` saiu para o motor de lote,
       * acima; o ensaio fica aqui de propósito, cobrança a cobrança, porque é
       * exatamente isso que ele precisa mostrar — o payload de cada uma — e
       * porque não tocando no Omie ele não paga o preço de ser serial. */
      const seco = true;

      /* A PORTA, também no manual — e esta é a novidade que mais importa.
       *
       * A guarda contra estorno vivia só no `motivoBloqueio` do TypeScript da
       * tela: ela não deixa marcar a caixa da cobrança devolvida, e por isso
       * parecia resolvida. Só que a guarda da tela vale para quem passa pela
       * tela. Chamar esta função com o id de uma cobrança estornada emitia a
       * nota sem uma única pergunta — e chamar esta função é o que o cron faz, o
       * que a skill faz, e o que qualquer script com o token faz.
       *
       * No ensaio (`previa`) a conferência acontece igual, mas não escreve no
       * diário: prévia da tela é pergunta, e pergunta não vira rastro fiscal.
       */
      const { liberadas, barradas } = await passarPelaPorta(supabase, linhas, {
        seco, usuario, operador: operador || null, avulsa,
      });

      const resultados: unknown[] = barradas.map((b) => ({
        id_asaas: b.id_asaas, ok: false, bloqueado: true, erro: b.motivo,
      }));

      const molde = liberadas.length ? await pegarMolde(supabase) : null;
      for (const cob of liberadas) {
        resultados.push(await emitirUma(supabase, molde, cob, cfg ?? {}, usuario, seco, operador || null, avulsa));
      }

      // "Já estava emitida" não é emissão nem falha: contá-la como emitida faria a
      // tela anunciar nota nova onde nada saiu.
      const ok = resultados.filter((r: any) => r.ok).length;
      const jaEmitidas = resultados.filter((r: any) => r.ja_emitida).length;
      const emProcessamento = resultados.filter((r: any) => r.em_processamento).length;
      const bloqueadas = resultados.filter((r: any) => r.bloqueado).length;
      return json({
        ok: true, seco, avulsa, pedidas: ids.length, tratadas: resultados.length,
        emitidas: ok - jaEmitidas, ja_emitidas: jaEmitidas, em_processamento: emProcessamento,
        bloqueadas,
        falhas: resultados.length - ok - bloqueadas,
        molde_os: molde?.Cabecalho?.nCodOS ?? null,
        resultados,
      });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("omie-nfse-sync:", msg);
    return json({ erro: msg }, 500);
  }
});
