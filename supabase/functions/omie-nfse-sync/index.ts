// Edge Function: omie-nfse-sync
//
// O lado Omie da tela /operacional/notas-fiscais: espelha as Ordens de Serviço e
// emite a NFS-e das cobranças do Asaas que ainda não têm nota.
//
// ONDE A NOTA MORA. Não em `servicos/nfse` — nenhum método existe lá (medido:
// ListarNFSe, ConsultarNFSe, ObterNFSe, EmitirNFSe, GerarNFSe, todos respondem
// "Method not exists"). A NFS-e é um pedaço da ORDEM DE SERVIÇO, e o caminho é:
//
//     OS na etapa 50  --TrocarEtapaOS(60)-->  faturada  ==>  NFS-e emitida
//
// e quem conta o que aconteceu é `StatusOS` (cFaturada + ListaRpsNfse[] com nNfse,
// nRps, cStatusRps e o XML). O `DetalhesNfse` que vem no ListarOS está VAZIO em
// todas as 1.207 OS, faturadas inclusive — quem parar nele conclui, errado, que
// nenhuma nota foi emitida.
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

async function omieCall<T = any>(path: string, call: string, param: Record<string, unknown>): Promise<T> {
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
    if (/425|redundante|processando|5020|too many|bloqueada|soap-error|broken response|timeout|50[234]|existe uma requisi/i.test(String(msg)) && i < 4) {
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

function ehStatusPendente(
  os: any,
  jaGravada: { nfse_status?: string | null; status_lido_em?: string | null } | undefined,
): boolean {
  const faturada = String(os?.InfoCadastro?.cFaturada ?? "N") === "S";
  if (!faturada) return false;
  if (!jaGravada?.status_lido_em) return true;          // nunca lida
  if (jaGravada.nfse_status === "004") return false;    // já tem nota; não muda mais
  const idadeH = (Date.now() - new Date(jaGravada.status_lido_em).getTime()) / 3_600_000;
  return idadeH >= CARENCIA_STATUS_H;
}

/** ListaRpsNfse[0] achatada. */
function nfseDoStatus(s: any): Record<string, unknown> {
  const rps = Array.isArray(s?.ListaRpsNfse) ? s.ListaRpsNfse[0] : null;
  if (!rps) return { nfse_numero: null, nfse_rps: null, nfse_status: null, nfse_lote: null, nfse_xml: null, nfse_verificacao: null };
  return {
    // "0000000011222" → "11222": o zero à esquerda é enfeite do Omie e atrapalha
    // procurar o número na prefeitura.
    nfse_numero: String(rps.nNfse ?? "").replace(/^0+/, "") || null,
    nfse_rps: String(rps.nRps ?? "") || null,
    nfse_status: String(rps.cStatusRps ?? "") || null,
    nfse_lote: rps.nLote ? Number(rps.nLote) : null,
    nfse_xml: String(rps.xml_distr ?? "") || null,
    nfse_verificacao: String(rps.cCodVerif ?? "") || null,
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
      if (nfse.nfse_status === "004") comNota++;
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

    /* 2. Faturar = emitir. É aqui que a nota nasce.
     *
     * A ETAPA NÃO PULA. Medido na primeira emissão real: uma OS criada na etapa
     * "10" recebeu `TrocarEtapaOS(60)` sem erro nenhum — e continuou na 10, não
     * faturada, sem nota. O Omie aceita a chamada e ignora o salto. Por isso a
     * troca sobe pelos degraus que as OS boas do próprio Omie ocupam (50 = a
     * faturar, 60 = faturada), e não direto para o fim.
     */
    const destino = String(cfg.etapa_faturamento ?? "60");
    for (const etapa of ["50", destino]) {
      try {
        await omieCall<any>("servicos/os", "TrocarEtapaOS", { nCodOS, cEtapa: etapa });
      } catch (e) {
        // Já estar na etapa não é falha; o resto é.
        if (!/mesma etapa|j[aá] (est|se encontra)/i.test(mensagemDoOmie(e))) throw e;
      }
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
      const erro = `A OS ${s?.cNumOS ?? nCodOS} foi criada mas não faturou (etapa ${s?.cEtapa}). Nenhuma nota foi emitida.`;
      await registrar(acao, "erro", { n_cod_os: nCodOS, erro });
      return { id_asaas: cob.id_asaas, ok: false, n_cod_os: nCodOS, erro, status_bruto: s };
    }

    await registrar(acao, "ok", { n_cod_os: nCodOS, nfse_numero: nfse.nfse_numero ?? null });
    return {
      id_asaas: cob.id_asaas, ok: true, n_cod_os: nCodOS,
      nfse_numero: nfse.nfse_numero ?? null, nfse_status: nfse.nfse_status ?? null,
      nfse_rps: nfse.nfse_rps ?? null, nfse_xml: nfse.nfse_xml ?? null,
      nfse_verificacao: nfse.nfse_verificacao ?? null, status_bruto: s,
    };
  } catch (e) {
    const erro = mensagemDoOmie(e).slice(0, 400);
    await registrar("criar_e_faturar", "erro", { erro });
    return { id_asaas: cob.id_asaas, ok: false, erro };
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
      const ok = resultados.filter((r: any) => r.ok).length;
      return json({
        ok: true, seco, pedidas: ids.length, tratadas: resultados.length,
        emitidas: ok, falhas: resultados.length - ok,
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
