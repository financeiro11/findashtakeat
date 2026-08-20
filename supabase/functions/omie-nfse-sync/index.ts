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
// Ações (body.action):
//   "espelhar" (default) → lista as OS e atualiza nf_os_omie. Consulta StatusOS só
//                          de quem precisa (ver ehStatusPendente).
//   "previa"             → o que a emissão MANDARIA, sem mandar nada.
//   "emitir"             → cria/fatura de verdade. Escrita fiscal irreversível.
//
// Auth: usuário logado OU cron (x-cron-token), no padrão do repo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  const { data: aberta } = await supabase
    .from("nf_emissoes")
    .select("id, id_asaas, acao, operador, usuario")
    .eq("n_cod_os", nCodOS)
    .eq("resultado", "em_processamento")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!aberta) return;

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

  return {
    os_listadas: linhas.length,
    status_pendentes: paraStatus.length,
    status_lidos: lidos,
    com_nota: comNota,
    erros: erros.slice(0, 5),
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
async function etapasEFaturamento(opts: { lote?: number; os?: number } = {}) {
  // Atalho: com `os`, só o status daquela OS — é a leitura que diz se a nota
  // nasceu, sem varrer as 1.200 OS.
  if (opts.os) {
    const s = await omieCall<any>("servicos/os", "StatusOS", { nCodOS: opts.os });
    return { status_os: s, nfse: nfseDoStatus(s) };
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
async function sondarMetodos(): Promise<Record<string, string>> {
  const alvos: Array<[string, string]> = [
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
    Email: {
      cEnvBoleto: "N", cEnvLink: "N", cEnvPix: "N", cEnvRecibo: "N", cEnvViaUnica: "N",
      cEnviarPara: cob.email ?? "",
    },
    ServicosPrestados: [{
      ...servicoMolde,
      // As alíquotas e retenções vêm do molde; os valores calculados, não (ver acima).
      impostos: impostosDoMolde(servicoMolde?.impostos),
      cDescServ: cob.descricao.slice(0, 200),
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
    try { await omieCall<any>("servicos/os", "TrocarEtapaOS", { nCodOS, cEtapa: ETAPA_FILA }); } catch { /* não piora nada */ }
  };

  await omieCall<any>("servicos/os", "TrocarEtapaOS", { nCodOS, cEtapa: etapaIsolamento });

  const ocupantes = await ocupantesDaEtapa(etapaIsolamento);
  if (!ocupantes.includes(nCodOS)) {
    await voltarParaFila();
    return { ok: false, erro: `A OS ${nCodOS} não chegou na etapa de isolamento ${etapaIsolamento} (o Omie aceitou a troca e não moveu). Nada foi faturado.` };
  }
  if (ocupantes.length !== 1) {
    const outras = ocupantes.filter((n) => n !== nCodOS);
    await voltarParaFila();
    return { ok: false, erro: `A etapa de isolamento ${etapaIsolamento} tem ${ocupantes.length} OS (${outras.slice(0, 5).join(", ")}…). Faturar aqui emitiria nota delas também — abortado.` };
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
  usuario: string | null, seco: boolean, operador: string | null = null,
) {
  const registrar = async (acao: string, resultado: string, extra: Record<string, unknown>) => {
    if (seco) return;
    await supabase.from("nf_emissoes").insert({
      id_asaas: cob.id_asaas, acao, resultado, usuario, operador, ...extra,
    });
  };

  try {
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
      await registrar(acao, loteEncerrado ? "erro" : "em_processamento", { n_cod_os: nCodOS, erro });
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
 * A EMISSÃO DO DIA — e por que ela não é o laço da emissão manual repetido.
 *
 * O caminho manual faz, por cobrança: varre as 1.208 OS para conferir o raio,
 * dispara um lote e espera a prefeitura. São ~3 minutos cada. Para as ~100 notas
 * por dia que vêm depois do corte, isso é meio dia de relógio e não cabe nos 150s
 * da Edge Function nem de longe.
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
  opts: { origem: string; operador: string | null; usuario: string | null },
) {
  const modo = String(cfg?.emissao_automatica ?? "previa");
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

    /* Corredor livre? Uma OS esquecida na etapa de isolamento — lote anterior
     * ainda em voo, rodada que morreu no meio — faria a conferência de raio
     * abortar. Melhor não criar nada e dizer por quê. */
    const ocupantes = await ocupantesDaEtapa(etapaIso);
    if (ocupantes.length) {
      return await fechar({
        pulada: `a etapa de isolamento ${etapaIso} já tem ${ocupantes.length} OS (lote anterior ainda em andamento?). Nada foi criado.`,
        detalhe: { ocupantes: ocupantes.slice(0, 20) },
      });
    }

    // Teto do dia — o freio contra defeito que vire enxurrada fiscal.
    const { data: jaHoje } = await supabase.rpc("notas_fiscais_emitidas_hoje");
    const resta = tetoDia - Number(jaHoje ?? 0);
    if (resta <= 0) {
      return await fechar({ pulada: `teto do dia atingido (${jaHoje}/${tetoDia}).` });
    }

    const limite = Math.max(0, Math.min(tetoRodada, resta));
    const { data: fila, error: erroFila } = await supabase.rpc("notas_fiscais_fila_emissao", { p_limite: limite });
    if (erroFila) throw new Error(`fila: ${erroFila.message}`);
    if (!fila?.length) return await fechar({ fila: 0, pulada: "nada a emitir." });

    /* O ENSAIO. `previa` existe porque o primeiro dia de um processo que emite
     * nota fiscal sozinho não deveria ser o dia em que se descobre o que ele
     * escolheria. Grava no diário exatamente as cobranças que teria emitido, com
     * hora, e não toca no Omie. */
    if (modo === "previa") {
      await supabase.from("nf_emissoes").insert(fila.map((c: any) => ({
        id_asaas: c.id_asaas, n_cod_os: c.n_cod_os ?? null,
        acao: "previa", resultado: "ok",
        erro: `Ensaio: teria emitido R$ ${Number(c.valor).toFixed(2)} (${c.descricao ?? "—"}).`,
        usuario: opts.usuario, operador: opts.operador,
      })));
      return await fechar({ fila: fila.length, pulada: "modo ensaio (previa): nada foi emitido no Omie." });
    }

    // 1. Cria a OS de quem ainda não tem e leva todas para o corredor.
    const molde = await pegarMolde(supabase);
    const naLeva: Array<{ cob: any; nCodOS: number; acao: string }> = [];
    const falhas: Array<{ id_asaas: string; erro: string }> = [];

    for (const cob of fila) {
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
            usuario: opts.usuario, operador: opts.operador,
          });
        }
        await omieCall<any>("servicos/os", "TrocarEtapaOS", { nCodOS, cEtapa: etapaIso });
        naLeva.push({ cob, nCodOS, acao });
      } catch (e) {
        const erro = mensagemDoOmie(e).slice(0, 400);
        falhas.push({ id_asaas: cob.id_asaas, erro });
        await supabase.from("nf_emissoes").insert({
          id_asaas: cob.id_asaas, acao: "criar_e_faturar", resultado: "erro", erro,
          usuario: opts.usuario, operador: opts.operador,
        });
      }
    }

    if (!naLeva.length) {
      return await fechar({ fila: fila.length, falhas: falhas.length, pulada: "nenhuma OS chegou ao corredor.", detalhe: { falhas } });
    }

    // 2. A trava de raio, agora plural.
    const agora = await ocupantesDaEtapa(etapaIso);
    const meus = new Set(naLeva.map((x) => x.nCodOS));
    const intrusas = agora.filter((n) => !meus.has(n));
    if (intrusas.length) {
      for (const { nCodOS } of naLeva) {
        try { await omieCall<any>("servicos/os", "TrocarEtapaOS", { nCodOS, cEtapa: ETAPA_FILA }); } catch { /* segue */ }
      }
      return await fechar({
        fila: fila.length, falhas: falhas.length,
        pulada: `a etapa ${etapaIso} tem ${intrusas.length} OS que esta rodada não criou. Faturar aqui emitiria nota delas — abortado.`,
        detalhe: { intrusas: intrusas.slice(0, 20) },
      });
    }
    const faltando = naLeva.filter((x) => !agora.includes(x.nCodOS));
    if (faltando.length) {
      // O Omie engole troca de etapa em silêncio; quem não chegou não vai no lote.
      for (const f of faltando) {
        falhas.push({ id_asaas: f.cob.id_asaas, erro: `A OS ${f.nCodOS} não chegou na etapa ${etapaIso}.` });
      }
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
    const entraram = naLeva.filter((x) => agora.includes(x.nCodOS));
    await supabase.from("nf_emissoes").insert(entraram.map((x) => ({
      id_asaas: x.cob.id_asaas, n_cod_os: x.nCodOS, acao: x.acao, resultado: "em_processamento",
      erro: `Lote ${nIdLoteFat} disparado com ${entraram.length} OS. A nota nasce em alguns minutos; o próximo sync grava o número.`,
      usuario: opts.usuario, operador: opts.operador,
    })));

    return await fechar({
      fila: fila.length, emitidas: entraram.length, falhas: falhas.length,
      lote: nIdLoteFat, detalhe: { falhas: falhas.slice(0, 20) },
    });
  } catch (e) {
    return await fechar({ erro: mensagemDoOmie(e).slice(0, 500) });
  }
}

/** As cobranças que o lote vai tratar, já com cliente do Omie e OS resolvidos. */
async function candidatas(supabase: any, ids: string[]) {
  const { data: linhas, error } = await supabase.rpc("notas_fiscais_candidatas", { p_ids: ids });
  if (error) throw new Error(`notas_fiscais_candidatas: ${error.message}`);
  return linhas ?? [];
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
      const r = await espelhar(supabase, { tetoStatus: Math.min(Number(body?.teto_status ?? 120), 400) });
      return json({ ok: true, ...r });
    }

    if (action === "emitir_dia") {
      const { data: cfg } = await supabase.from("nf_config").select("*").eq("id", 1).maybeSingle();
      const r = await emitirDia(supabase, cfg ?? {}, {
        origem: ehCron ? "cron" : "tela",
        operador: String(body?.operador ?? "").trim() || (ehCron ? "emissão automática (cron)" : null),
        usuario,
      });
      // O sync logo em seguida fecha no diário as notas que nasceram desde a
      // rodada anterior — é o que transforma "em processamento" em número.
      const espelho = await espelhar(supabase, { tetoStatus: Math.min(Number(body?.teto_status ?? 40), 400) })
        .catch((e) => ({ erro: mensagemDoOmie(e) }));
      return json({ ok: true, ...r, espelho });
    }

    if (action === "sondar_metodos") {
      return json({ ok: true, metodos: await sondarMetodos() });
    }

    if (action === "etapas") {
      const r = await etapasEFaturamento({
        lote: body?.lote ? Number(body.lote) : undefined,
        os: body?.os ? Number(body.os) : undefined,
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
      if (action === "emitir" && ehCron) {
        const n = Array.isArray(body?.ids) ? body.ids.length : 0;
        if (n !== 1 || !operador) {
          return json({
            erro: "Emissão por token de sistema só é aceita com uma única cobrança e o campo `operador` preenchido.",
          }, 403);
        }
      }

      const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
      if (!ids.length) return json({ erro: "Nenhuma cobrança informada." }, 400);

      const { data: cfg } = await supabase.from("nf_config").select("*").eq("id", 1).maybeSingle();
      const teto = Number(cfg?.teto_lote ?? 50);
      if (ids.length > teto) {
        return json({ erro: `O lote tem ${ids.length} cobranças e o teto é ${teto}. Ajuste em Configurações ou divida o lote.` }, 400);
      }

      const linhas = await candidatas(supabase, ids);
      const seco = action === "previa";
      const molde = await pegarMolde(supabase);

      const resultados: unknown[] = [];
      for (const cob of linhas) {
        resultados.push(await emitirUma(supabase, molde, cob, cfg ?? {}, usuario, seco, operador || null));
      }
      // "Já estava emitida" não é emissão nem falha: contá-la como emitida faria a
      // tela anunciar nota nova onde nada saiu.
      const ok = resultados.filter((r: any) => r.ok).length;
      const jaEmitidas = resultados.filter((r: any) => r.ja_emitida).length;
      const emProcessamento = resultados.filter((r: any) => r.em_processamento).length;
      return json({
        ok: true, seco, pedidas: ids.length, tratadas: resultados.length,
        emitidas: ok - jaEmitidas, ja_emitidas: jaEmitidas, em_processamento: emProcessamento,
        falhas: resultados.length - ok,
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
