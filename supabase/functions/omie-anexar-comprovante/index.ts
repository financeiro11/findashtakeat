// Edge Function: omie-anexar-comprovante
//
// Anexa no TÍTULO correspondente do Omie os comprovantes dos lançamentos aprovados.
//
// Elegível = "aprovado com anexo", que na tela vem de DUAS origens:
//   • achado da tabela `auditoria` com status = "Aprovado" e link_comprovante; e
//   • lançamento do cartão com status_nf = "OK" e comprovante — a tela o exibe como
//     "Aprovado", mas ele NÃO existe em `auditoria` (é linha sintética do front).
//
// O comprovante pode estar no bucket `comprovantes-auditoria` (sempre legível) ou num
// link do Google Drive — este último pelo conector, quando configurado, e pelo link
// público quando não (a maioria dos nossos é "qualquer pessoa com o link").
//
// O título do Omie é reencontrado por casamento (_shared/match-cartao.ts): valor exato +
// data próxima + semelhança de texto. O anexo em si passa por _shared/omie.ts:incluirAnexo,
// que ZIPA o arquivo (exigência do Omie) e CONFIRMA que o anexo colou.
//
// Ações (body.action):
//   "preview"        → lista os elegíveis (respeitando `escopo`); confere leitura no Drive.
//   "testar_drive"   → sonda o conector do Drive. NÃO toca no Omie.
//   "enviar"         → envia. Params: { ids?: number[], escopo?: string[], todos?: bool }.
//   "anexar_arquivo" → a pessoa sobe o arquivo e ele vai direto ao título. { id, nome, base64 }.
//   "varredura"      → o cron: pega TODO comprovante que já tem título casado e ainda não
//                      foi ao Omie e manda. Params: { limite?: number }. Header x-cron-token.
//
// `escopo` = id_transacao dos lançamentos visíveis com os filtros da tela (fatura +
// responsável + busca…). Amarra o envio ao que está na tela; um único id = envio individual.
//
// POR QUE A VARREDURA NÃO PASSA PELO CASAMENTO: as ações da tela reencontram o título no
// Omie listando movimentos e comparando valor/data/texto — caro e sujeito a "confiança
// média" que ninguém confirma. Mas `omie_cod_titulo` JÁ ESTÁ GRAVADO nas duas tabelas (o
// "Cruzar com Omie" gravou). Para o trabalho de fundo isso basta e é determinístico: quem
// tem comprovante + título + nenhum carimbo de envio vai para o ERP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { incluirAnexo, listarCategorias, listarMovimentos, toBase64 } from "../_shared/omie.ts";
import { casarComOmie, indexarMovimentos, MatchResult } from "../_shared/match-cartao.ts";
import { baixarDoDrive, baseDoDrive, driveConfigurado, ehHtml, extrairIdDrive, podeLerNoDrive, sondarDrive, statusDrive } from "../_shared/drive.ts";
import { requireUser } from "../_shared/auth.ts";
import { acharIrmas, fitidDoCartao, lerParcela, type TituloOmie } from "../_shared/parcelas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";

/** Teto por arquivo e teto de tempo por execução — os dois limites que o worker impõe. */
const MAX_BYTES = 8 * 1024 * 1024;
const ORCAMENTO_MS = 55_000;

/**
 * Quantas fotos podem virar PDF na MESMA rodada.
 *
 * O limite do worker que morde primeiro não é o relógio, é a CPU — e o relógio
 * (ORCAMENTO_MS) não a enxerga. Medido em 25/08/2026: a rodada das 18:35
 * converteu três comprovantes com folga, começou o quarto e foi morta com
 * "CPU Time exceeded"; morrer assim não devolve relatório nenhum, e o que já
 * tinha subido só apareceu no log porque o carimbo é gravado item a item.
 *
 * Converter imagem é o único passo caro aqui (o pdf-lib redesenha a página);
 * PDF que já chega PDF quase não custa, e por isso não entra nesta conta. Três
 * é o que a medição mostrou caber — o resto fica para a próxima rodada, que é
 * daqui a 15 minutos e começa exatamente de onde esta parou.
 */
const CONVERSOES_POR_RODADA = 3;

const nomeDoPath = (p: string) => {
  const base = p.split("/").pop() || "comprovante";
  return base.replace(/^\d{10,}_/, "");   // o upload prefixa com timestamp
};

// cCodIntAnexo aceita 20 caracteres; timestamp em base36 (o helper ainda trunca por garantia).
// O id pode ser bigint (achado, cartão) ou uuid (compra de Facilities) — o uuid só
// contribui com o começo, e é o timestamp que garante a unicidade por tentativa.
const codIntAnexo = (id: number | string): string =>
  `h${String(id).replace(/-/g, "").slice(0, 8)}-${Date.now().toString(36)}`.slice(0, 20);

const ehUrl = (v: string) => /^https?:\/\//i.test(v.trim());
const ehCaminhoStorage = (v: string) => !ehUrl(v) && v.includes("/");

type Motivo = null | "drive" | "sem_titulo" | "ja_enviado" | "comprovante_invalido";

type Item = {
  achado_id: number;   // negativo = linha sintética vinda do cartão (não é achado)
  origem: "achado" | "cartao";
  titulo: string;
  valor: number;
  data: string | null;
  comprovante: string;
  cartao_id: number | null;
  cartao_id_unico: string | null;
  id_transacao: string | null;   // chave de casamento com o que a tela mostra
  estabelecimento: string | null;
  ja_enviado_em: string | null;
  match: MatchResult | null;
  bloqueio: Motivo;     // null = pode enviar
  detalhe?: string;     // mensagem específica do bloqueio
};

/* ============================================================================
 *  Varredura — o trabalho de fundo
 * ========================================================================== */

type Pendente = {
  origem: "achado" | "cartao" | "facilities" | "pix" | "planilha" | "drive";
  id: number | string;
  id_unico: string;
  rotulo: string;
  comprovante: string;
  codTitulo: string;
  id_transacao: string | null;
};

/**
 * O DIÁRIO DO ENVIO — uma linha por tentativa, inclusive a que falhou.
 *
 * Até 25/08/2026 a varredura logava a falha no console do worker e devolvia na
 * resposta HTTP. Quando quem chamava era o cron, ninguém lia nem uma coisa nem
 * outra: a linha simplesmente continuava pendente amanhã, sem que existisse em
 * lugar nenhum a frase "não subiu porque X". Recusa sem rastro é indistinguível
 * de esquecimento — a mesma lição que o lado da receita já tinha aprendido.
 *
 * Nunca lança: registrar é auxiliar. Falhar ao anotar a falha derrubaria a
 * rodada inteira por causa do diário.
 */
async function anotar(supabase: any, linha: {
  origem: string;
  ref_id: string;
  rotulo?: string | null;
  cod_titulo?: string | null;
  arquivo?: string | null;
  resultado: "ok" | "erro" | "bloqueado" | "tentando";
  motivo?: string | null;
  canal: string;
}): Promise<void> {
  try {
    await supabase.from("omie_anexo_envio_log").insert({
      ...linha,
      motivo: linha.motivo ? String(linha.motivo).slice(0, 1000) : null,
    });
  } catch (e) {
    console.error("omie_anexo_envio_log:", e instanceof Error ? e.message : e);
  }
}

/** Baixa o comprovante, venha ele do bucket privado ou de um link do Drive. */
async function baixarComprovante(
  supabase: any,
  comprovante: string,
): Promise<{ bytes: Uint8Array; nome: string }> {
  let bytes: Uint8Array;
  let nome: string;

  if (ehUrl(comprovante)) {
    // O teto vai JUNTO: assim o Drive recusa pelo metadado e não gastamos o
    // orçamento do worker baixando o que já se sabe grande demais. Ver a nota
    // em `_shared/drive.ts` — foi um arquivo de 9,7 MB que parou a fila inteira.
    const arq = await baixarDoDrive(comprovante, { maxBytes: MAX_BYTES });
    bytes = arq.bytes;
    nome = arq.nome;
  } else {
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(comprovante);
    if (error || !blob) throw new Error(`Falha ao baixar do storage: ${error?.message ?? "arquivo não encontrado"}`);
    bytes = new Uint8Array(await blob.arrayBuffer());
    nome = nomeDoPath(comprovante);
  }

  if (!bytes.length) throw new Error("Arquivo vazio.");
  if (ehHtml(bytes)) throw new Error("O arquivo baixado é uma página HTML, não um comprovante.");
  // Zipar e converter para base64 faz umas três cópias do arquivo na memória do worker.
  // Sem este corte, um PDF gordo derruba a execução INTEIRA (WORKER_RESOURCE_LIMIT) e leva
  // junto os itens que ainda nem começaram. Melhor um item recusado com motivo.
  if (bytes.length > MAX_BYTES) {
    throw new Error(
      `Arquivo de ${(bytes.length / 1048576).toFixed(1)} MB — acima do limite de ${MAX_BYTES / 1048576} MB ` +
      "para anexar automaticamente. Costuma ser foto em resolução cheia: reenviar o comprovante " +
      "como PDF (ou uma foto menor) resolve, e aí ele sobe na próxima rodada.",
    );
  }
  return { bytes, nome };
}

/**
 * Carimba o envio nos DOIS lados da mesma nota.
 *
 * Sem isto a varredura reenviaria tudo amanhã: a coluna `omie_anexo_enviado_em` é o único
 * freio, e o caminho antigo só a escrevia no lançamento do cartão — os achados de julho em
 * diante não têm lançamento de cartão (entram direto em `auditoria`), então ficavam para
 * sempre "pendentes" mesmo depois de anexados.
 */
async function carimbar(supabase: any, opts: {
  achadoId?: number | null;
  cartaoId?: number | null;
  cartaoIdUnico?: string | null;
  facilitiesId?: string | null;
  pixIdUnico?: string | null;
  driveId?: string | null;
  notaId?: number | null;
  idTransacao?: string | null;
  codTitulo: string;
  nome: string;
  cTabela: string;
  canal: string;
}): Promise<void> {
  const agora = new Date().toISOString();
  const marca = { omie_anexo_enviado_em: agora, omie_anexo_nome: opts.nome, updated_at: agora };

  /* A compra de Facilities não tem `updated_at`, e mandar a coluna faria o
   * update inteiro falhar — junto com o carimbo, que é o freio da varredura.
   * Sem o carimbo, a mesma nota subiria de novo amanhã e o título ficaria com
   * dois anexos iguais.
   *
   * `nf_status` continua sendo só "ok" | "pendente": é o contrato que a tela do
   * Facilities já usa para desenhar o selo, e inventar um terceiro valor aqui
   * faria a compra que ACABOU de chegar ao ERP aparecer como pendente. Onde ela
   * está é `omie_anexo_enviado_em` — coluna própria, sem ambiguidade. */
  if (opts.facilitiesId) {
    await supabase.from("facilities_compras").update({
      omie_anexo_enviado_em: agora,
      omie_anexo_nome: opts.nome,
      omie_cod_titulo: String(opts.codTitulo),
      nf_status: "ok",
    }).eq("id", opts.facilitiesId);
  }

  if (opts.achadoId) {
    const { data: atual } = await supabase.from("auditoria").select("trilha").eq("id", opts.achadoId).maybeSingle();
    const trilha = Array.isArray(atual?.trilha) ? atual.trilha : [];
    await supabase.from("auditoria").update({
      ...marca,
      omie_cod_titulo: String(opts.codTitulo),
      trilha: [...trilha, {
        em: agora,
        por: opts.canal,
        texto: `Comprovante anexado ao título ${opts.codTitulo} no Omie (${opts.nome}).`,
        tipo: "comprovante_enviado_omie",
        evento: "comprovante_enviado_omie",
        canal: opts.canal,
        omie_cod_titulo: String(opts.codTitulo),
        cTabela: opts.cTabela,
        arquivo: opts.nome,
      }],
    }).eq("id", opts.achadoId);
  }

  if (opts.cartaoId) {
    await supabase.from("auditoria_cartao_lancamentos")
      .update({ ...marca, omie_cod_titulo: String(opts.codTitulo) }).eq("id", opts.cartaoId);
  }

  /* PIX — a quarta origem, e a que faltava desde sempre.
   *
   * A auditoria de PIX é a única das quatro cujo `tem_comprovante` significa "o
   * ERP tem o arquivo": ele nasceu do `ListarAnexo`. Por isso NÃO se escreve
   * `comprovante_url` aqui — quem responde essa coluna é a `omie-pix-sync`, na
   * releitura. O que se carimba é só o que este envio sabe: que subiu, quando e
   * com que nome. Sem esse carimbo a mesma nota subiria de novo amanhã e o
   * título ficaria com dois anexos iguais. */
  if (opts.pixIdUnico) {
    await supabase.from("auditoria_pix_lancamentos").update({
      omie_anexo_enviado_em: agora,
      omie_anexo_nome: opts.nome,
      // A releitura do ERP vai confirmar; até lá, a verdade já mudou.
      anexo_verificado: false,
      updated_at: agora,
    }).eq("id_unico", opts.pixIdUnico);
  }

  /* DRIVE — a origem que a cobertura já contava e o envio não conhecia.
   *
   * `cap_titulos` conta `comprovantes_drive` como "o Hub tem a nota" desde que
   * ela existe; `pendentes()` nunca leu essa tabela. O resultado, medido em
   * 25/08/2026: dois títulos parados em "Pronta para subir" desde junho, à
   * espera de uma fila que jamais passaria por eles. Sem este carimbo o
   * problema vira o oposto — o mesmo arquivo subindo a cada rodada. */
  if (opts.driveId) {
    await supabase.from("comprovantes_drive").update({
      omie_anexo_enviado_em: agora,
      omie_anexo_nome: opts.nome,
      atualizado_em: agora,
    }).eq("id", opts.driveId);
  }

  if (opts.notaId) {
    await supabase.from("notas_externas").update({
      enviado_erp_em: agora, erro_erp: null, fila_erp: false,
      conferencia: "confere", atualizado_em: agora,
    }).eq("id", opts.notaId);
  }

  // O outro lado da mesma nota, quando existe o vínculo.
  if (opts.idTransacao && !opts.cartaoId) {
    await supabase.from("auditoria_cartao_lancamentos").update(marca).eq("id_unico", opts.idTransacao);
  }
  if (opts.cartaoIdUnico && !opts.achadoId) {
    await supabase.from("auditoria").update(marca).eq("id_transacao", opts.cartaoIdUnico);
  }
}

export type FiltroVarredura = { responsavel?: string | null; idUnico?: string | null };

/** Tudo que tem comprovante + título e ainda não foi ao Omie, dos dois lados. */
async function pendentes(supabase: any, limite: number, filtro: FiltroVarredura = {}): Promise<Pendente[]> {
  let qAch = supabase.from("auditoria")
    .select("id, id_unico, titulo, link_comprovante, omie_cod_titulo, id_transacao")
    .not("link_comprovante", "is", null).neq("link_comprovante", "")
    .not("omie_cod_titulo", "is", null)
    .is("omie_anexo_enviado_em", null);

  let qCar = supabase.from("auditoria_cartao_lancamentos")
    .select("id, id_unico, estabelecimento, descricao_original, link_comprovante, omie_cod_titulo")
    .not("link_comprovante", "is", null).neq("link_comprovante", "")
    .not("omie_cod_titulo", "is", null)
    .is("omie_anexo_enviado_em", null);

  // A tela filtra por pessoa — e a pessoa se chama `responsavel` no achado e `gestor` no
  // lançamento do cartão. Enviar uma linha que não está na tela é o tipo de surpresa que
  // faz alguém desconfiar do botão.
  if (filtro.idUnico) {
    qAch = qAch.eq("id_unico", filtro.idUnico);
    qCar = qCar.eq("id_unico", filtro.idUnico);
  } else if (filtro.responsavel) {
    qAch = qAch.eq("responsavel", filtro.responsavel);
    qCar = qCar.eq("gestor", filtro.responsavel);
  }

  const [ach, car] = await Promise.all([
    qAch.order("data_lancamento", { ascending: false }).limit(limite),
    qCar.order("data", { ascending: false }).limit(limite),
  ]);
  if (ach.error) throw ach.error;
  if (car.error) throw car.error;

  // UM ANEXO POR TÍTULO POR RODADA. Duas armadilhas, não uma:
  //   • o achado e o lançamento do cartão que o originou apontam para o mesmo título; e
  //   • DOIS achados diferentes podem apontar para o mesmo título (a fatura tem a tarifa e
  //     a passagem no mesmo lançamento do Omie). Foi assim que a primeira execução tentou
  //     anexar duas vezes no título 5504197016 — e a segunda voltou com um erro mentiroso,
  //     porque o Omie recusa a leitura logo depois de uma escrita.
  // O achado vem primeiro porque é ele que carrega a trilha da auditoria.
  //
  // A QUARENTENA ENTRA JUNTO COM OS TÍTULOS JÁ VISTOS, e por um motivo: as duas
  // são a mesma pergunta — "este título já está resolvido para esta rodada?".
  // Quem derrubou o worker três vezes seguidas sem deixar erro entra aqui e
  // deixa a fila andar; o que ele precisa (um comprovante menor, ou acesso ao
  // arquivo no Drive) não é coisa que a próxima tentativa resolva sozinha.
  const { data: quarentena } = await supabase
    .from("omie_anexo_quarentena")
    .select("cod_titulo");
  const titulos = new Set<string>((quarentena ?? []).map((q: any) => String(q.cod_titulo)));
  const lista: Pendente[] = [];

  for (const a of ach.data ?? []) {
    const cod = String(a.omie_cod_titulo);
    if (titulos.has(cod)) continue;
    titulos.add(cod);
    lista.push({
      origem: "achado",
      id: a.id,
      id_unico: a.id_unico,
      rotulo: a.titulo ?? a.id_unico,
      comprovante: String(a.link_comprovante ?? ""),
      codTitulo: cod,
      id_transacao: a.id_transacao ?? null,
    });
  }

  const vinculados = new Set(lista.map((p) => p.id_transacao).filter(Boolean));

  for (const c of car.data ?? []) {
    if (titulos.has(String(c.omie_cod_titulo)) || vinculados.has(c.id_unico)) continue;
    titulos.add(String(c.omie_cod_titulo));
    lista.push({
      origem: "cartao",
      id: c.id,
      id_unico: c.id_unico,
      rotulo: c.estabelecimento || c.descricao_original || c.id_unico,
      comprovante: String(c.link_comprovante ?? ""),
      codTitulo: String(c.omie_cod_titulo),
      id_transacao: c.id_unico,
    });
  }

  /* FACILITIES — a terceira origem, e a que estava sem caminho até 25/08/2026.
   *
   * A NF anexada numa compra de Facilities só chegava ao ERP se virasse evidência
   * de um achado da auditoria; quando não havia achado correspondente — e não há,
   * porque a compra costuma ser boleto ou PIX que ninguém auditou — a nota parava
   * ali. Medido: 41 compras, R$ 46.240, zero notas no Omie.
   *
   * O arquivo mora no mesmo bucket privado do resto (`comprovantes-auditoria`),
   * então `baixarComprovante` já sabe lê-lo sem nenhuma mudança.
   */
  if (!filtro.responsavel && !filtro.idUnico) {
    const { data: fac, error: erroFac } = await supabase
      .from("facilities_compras")
      .select("id, item, fornecedor_nome, nf_arquivo, omie_cod_titulo")
      .not("nf_arquivo", "is", null).neq("nf_arquivo", "")
      .not("omie_cod_titulo", "is", null)
      .is("omie_anexo_enviado_em", null)
      .order("data", { ascending: false })
      .limit(limite);
    if (erroFac) throw erroFac;

    for (const f of fac ?? []) {
      if (titulos.has(String(f.omie_cod_titulo))) continue;
      titulos.add(String(f.omie_cod_titulo));
      lista.push({
        origem: "facilities",
        id: f.id,
        id_unico: String(f.id),
        rotulo: f.item || f.fornecedor_nome || String(f.id),
        comprovante: String(f.nf_arquivo ?? ""),
        codTitulo: String(f.omie_cod_titulo),
        id_transacao: null,
      });
    }
  }

  /* PIX — a quarta origem, e a que estava sem caminho nenhum.
   *
   * A auditoria de PIX nunca teve varredura: quando a NF do Hub de Facilities
   * era aplicada num PIX, ela pintava a linha de verde ("anexado no Omie") sem
   * que nada tivesse chegado ao ERP. O contador abria o título e não achava.
   *
   * O filtro é estreito de propósito. `comprovante_url` da maioria das linhas é
   * o link do ANEXO DO PRÓPRIO OMIE (veio do ListarAnexo) — reenviar aquilo
   * duplicaria o arquivo que já está lá. Só sobe o que foi o Hub que pôs: o
   * bucket privado da auditoria ou um link do Drive.
   *
   * `id_unico` do PIX É o `nCodTitulo` — é assim que a semente da varredura de
   * anexos já o converteu (migration 20260825140000). O `~ '^\d+$'` fica de
   * guarda porque um id não numérico viraria chamada inválida no Omie. */
  if (!filtro.responsavel && !filtro.idUnico) {
    const { data: pix, error: erroPix } = await supabase
      .from("auditoria_pix_lancamentos")
      .select("id, id_unico, favorecido, descricao, comprovante_url")
      .not("comprovante_url", "is", null).neq("comprovante_url", "")
      .is("omie_anexo_enviado_em", null)
      .or("comprovante_url.ilike.%comprovantes-auditoria%,comprovante_url.ilike.%drive.google.com%")
      .order("data", { ascending: false })
      .limit(limite);
    if (erroPix) throw erroPix;

    for (const p of pix ?? []) {
      const cod = String(p.id_unico ?? "");
      if (!/^\d+$/.test(cod) || titulos.has(cod)) continue;
      titulos.add(cod);
      lista.push({
        origem: "pix",
        id: p.id,
        id_unico: cod,
        rotulo: p.favorecido || p.descricao || cod,
        comprovante: String(p.comprovante_url ?? ""),
        codTitulo: cod,
        id_transacao: null,
      });
    }
  }

  /* DRIVE — a nota que a varredura das pastas achou e casou sozinha.
   *
   * A view `cap_titulos` conta `comprovantes_drive` como "o Hub tem a nota"
   * desde o primeiro dia; esta função nunca leu a tabela. Dois títulos de junho
   * estavam parados em "Pronta para subir" esperando uma fila que não passava
   * por eles — e ficariam para sempre, porque nada mais no caminho olha para o
   * Drive.
   *
   * SÓ CONFIANÇA ALTA SOBE. O casamento por parcela ("média") é palpite bom o
   * bastante para uma pessoa confirmar e ruim demais para virar documento fiscal
   * dentro do ERP: anexo errado no título errado é pior que anexo nenhum, porque
   * o próximo a olhar vai acreditar nele. Confiança média fica na tela, para
   * alguém decidir.
   *
   * O arquivo mora no Drive e `baixarComprovante` já sabe abrir link de lá —
   * por isso o `comprovante` é o link montado, e não o `drive_id` cru. */
  if (!filtro.responsavel && !filtro.idUnico) {
    const { data: dri, error: erroDri } = await supabase
      .from("comprovantes_drive")
      .select("id, drive_id, nome_arquivo, emitente, cod_titulo")
      .not("drive_id", "is", null).neq("drive_id", "")
      .not("cod_titulo", "is", null).neq("cod_titulo", "")
      .eq("confianca", "alta")
      .is("omie_anexo_enviado_em", null)
      .order("data", { ascending: false })
      .limit(limite);
    if (erroDri) throw erroDri;

    for (const d of dri ?? []) {
      const cod = String(d.cod_titulo ?? "");
      if (!/^\d+$/.test(cod) || titulos.has(cod)) continue;
      titulos.add(cod);
      lista.push({
        origem: "drive",
        id: String(d.id),
        id_unico: String(d.id),
        rotulo: d.emitente || d.nome_arquivo || String(d.id),
        comprovante: `https://drive.google.com/file/d/${d.drive_id}/view`,
        codTitulo: cod,
        id_transacao: null,
      });
    }
  }

  /* PLANILHAS — a nota que alguém já tinha mandado pelo formulário.
   *
   * Aqui não se decide nada: `notas_externas_casar` casou e alguém clicou, o
   * que ligou `fila_erp`. Esta função só carrega o arquivo. É a mesma divisão
   * do "Cruzar com Omie" do cartão — quem casa não envia, quem envia não casa.
   */
  if (!filtro.responsavel && !filtro.idUnico) {
    const { data: notas, error: erroNotas } = await supabase
      .from("notas_externas")
      .select("id, fonte, linha, nome, o_que_e, link, alvo_tipo, alvo_id_unico")
      .eq("fila_erp", true)
      .is("enviado_erp_em", null)
      .not("alvo_tipo", "is", null)
      .limit(limite);
    if (erroNotas) throw erroNotas;

    /* O cartão guarda o título numa coluna própria; o PIX é o próprio id — e o
       'erp' também, por construção: lá o alvo É um título do contas a pagar, e
       `alvo_id_unico` guarda o `nCodTitulo`. Por isso os dois caem no mesmo
       ramo, e só o cartão precisa da tradução. */
    const doCartao = (notas ?? []).filter((n: any) => n.alvo_tipo === "cartao").map((n: any) => n.alvo_id_unico);
    const titulosDoCartao = new Map<string, string>();
    if (doCartao.length) {
      const { data: cars } = await supabase.from("auditoria_cartao_lancamentos")
        .select("id_unico, omie_cod_titulo").in("id_unico", doCartao)
        .not("omie_cod_titulo", "is", null);
      for (const c of cars ?? []) titulosDoCartao.set(String(c.id_unico), String(c.omie_cod_titulo));
    }

    for (const n of notas ?? []) {
      const cod = (n.alvo_tipo === "pix" || n.alvo_tipo === "erp")
        ? String(n.alvo_id_unico ?? "")
        : (titulosDoCartao.get(String(n.alvo_id_unico)) ?? "");
      // Sem título no Omie não há onde anexar. Não é erro: é o "Cruzar com
      // Omie" que ainda não passou por aquele lançamento.
      if (!/^\d+$/.test(cod) || titulos.has(cod)) continue;
      titulos.add(cod);
      lista.push({
        origem: "planilha",
        id: n.id,
        id_unico: String(n.alvo_id_unico ?? n.id),
        rotulo: `${n.nome || n.o_que_e || "nota"} · ${n.fonte} linha ${n.linha}`,
        comprovante: String(n.link ?? ""),
        codTitulo: cod,
        id_transacao: n.alvo_tipo === "cartao" ? String(n.alvo_id_unico) : null,
      });
    }
  }

  return lista.slice(0, limite);
}


/* ==================================================== nota em todas as parcelas */

/** Meses para trás e para a frente na leitura única dos movimentos. */
const JANELA_IRMAS_MESES = 12;

const isoMes = (d: Date) => d.toISOString().slice(0, 10);
const somaMeses = (base: Date, meses: number) =>
  new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + meses, base.getUTCDate()));
const brDeIso = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Lê os títulos a pagar de uma janela larga, UMA vez.
 *
 * A alternativa seria perguntar ao Omie as irmãs de cada compra: 167 janelas de
 * treze meses, uma por compra parcelada. Uma leitura só, indexada em memória,
 * responde a todas — e o Omie recusa chamadas paralelas do mesmo método, então
 * a versão cara também seria a lenta.
 */
async function lerTitulosDaJanela(de: string, ate: string): Promise<TituloOmie[]> {
  const movs = await listarMovimentos({ dDtVencDe: brDeIso(de), dDtVencAte: brDeIso(ate) }, 60);
  const out: TituloOmie[] = [];
  for (const m of movs) {
    const d = m?.detalhes ?? {};
    if (d?.cGrupo !== "CONTA_A_PAGAR") continue;
    if (d?.nValorTitulo == null) continue;   // perna de conta corrente do mesmo título
    const cod = Number(d?.nCodTitulo ?? 0);
    if (!cod) continue;
    const venc = String(d?.dDtVenc ?? "").split("/").reverse().join("-") || null;
    out.push({
      cod,
      parc: String(d?.cNumParcela ?? "") || null,
      cli: String(d?.nCodCliente ?? "") || null,
      valor: Math.abs(Number(d.nValorTitulo)),
      venc,
      integracao: String(d?.cCodIntegracao ?? "") || null,
    });
  }
  return out;
}

/** Os títulos que JÁ receberam a nota pelo Hub, com de onde veio o arquivo. */
async function origensComNota(supabase: any, limite: number): Promise<Array<{ cod: number; comprovante: string; rotulo: string }>> {
  const out: Array<{ cod: number; comprovante: string; rotulo: string }> = [];
  const visto = new Set<number>();
  const junta = (linhas: any[], campoArquivo: string, campoRotulo: string) => {
    for (const l of linhas ?? []) {
      const cod = Number(l.omie_cod_titulo);
      const arq = l[campoArquivo] ?? l.link_comprovante ?? null;
      if (!cod || !arq || visto.has(cod)) continue;
      visto.add(cod);
      out.push({ cod, comprovante: String(arq), rotulo: String(l[campoRotulo] ?? cod) });
    }
  };

  const [a, c, f] = await Promise.all([
    supabase.from("auditoria")
      .select("omie_cod_titulo, link_comprovante, titulo")
      .not("omie_cod_titulo", "is", null).not("omie_anexo_enviado_em", "is", null)
      .not("link_comprovante", "is", null).limit(limite),
    supabase.from("auditoria_cartao_lancamentos")
      .select("omie_cod_titulo, link_comprovante, arquivo_comprovante, estabelecimento")
      .not("omie_cod_titulo", "is", null).not("omie_anexo_enviado_em", "is", null).limit(limite),
    supabase.from("facilities_compras")
      .select("omie_cod_titulo, nf_arquivo, item")
      .not("omie_cod_titulo", "is", null).not("nf_arquivo", "is", null).limit(limite),
  ]);

  junta(a.data, "link_comprovante", "titulo");
  junta(c.data, "arquivo_comprovante", "estabelecimento");
  junta(f.data, "nf_arquivo", "item");
  return out;
}

async function varrer(supabase: any, cTabela: string, limite: number, canal: string, filtro: FiltroVarredura = {}) {
  const fila = await pendentes(supabase, limite, filtro);
  const enviados: any[] = [];
  const falhas: any[] = [];
  let parouPorTempo = 0;

  // O worker é derrubado sem aviso quando estoura o orçamento dele, e quem morre no meio
  // não devolve relatório nenhum. Preferimos parar por conta própria e deixar o resto para
  // a próxima rodada do cron — a fila é a mesma consulta, então nada se perde.
  const inicio = Date.now();
  let convertidas = 0;

  for (const [i, p] of fila.entries()) {
    if (Date.now() - inicio > ORCAMENTO_MS) { parouPorTempo = fila.length - i; break; }
    // O mesmo raciocínio do relógio, para a CPU: parar de propósito devolve
    // relatório; ser morto no meio não devolve nada. Ver CONVERSOES_POR_RODADA.
    if (convertidas >= CONVERSOES_POR_RODADA) { parouPorTempo = fila.length - i; break; }
    try {
      /* A TENTATIVA É REGISTRADA ANTES DE TENTAR.
       *
       * O catch abaixo cobre erro; não cobre MORTE. Quando o worker estoura a
       * CPU, o runtime o mata: o catch não roda, nada é gravado, e o item volta
       * igual na próxima rodada — para sempre, porque ele é o primeiro da fila.
       * Foi assim que 64 notas ficaram paradas atrás de um comprovante só.
       *
       * Esta linha é o rastro que sobrevive à morte. Se ela ficar órfã três
       * vezes (sem 'ok' e sem 'erro' depois), `omie_anexo_quarentena` passa a
       * apontar o título e a fila para de bater a cabeça nele.
       */
      await anotar(supabase, {
        origem: p.origem, ref_id: String(p.id), rotulo: p.rotulo,
        cod_titulo: p.codTitulo, resultado: "tentando", canal,
      });

      const { bytes, nome } = await baixarComprovante(supabase, p.comprovante);

      // `incluirAnexo` normaliza o arquivo antes de subir (foto vira PDF,
      // extensão mentirosa é corrigida pelos bytes) e devolve o nome final —
      // é esse que tem de ser carimbado, senão o Hub grava um nome de arquivo
      // que não existe do outro lado.
      const { cTabela: cTabelaOk, nome: nomeFinal, conversao } = await incluirAnexo({
        nId: p.codTitulo, cTabela, nome, base64: toBase64(bytes), codInt: codIntAnexo(p.id),
      });
      if (conversao === "imagem_para_pdf") convertidas++;

      await carimbar(supabase, {
        achadoId: p.origem === "achado" ? Number(p.id) : null,
        cartaoId: p.origem === "cartao" ? Number(p.id) : null,
        cartaoIdUnico: p.origem === "cartao" ? p.id_unico : null,
        facilitiesId: p.origem === "facilities" ? String(p.id) : null,
        pixIdUnico: p.origem === "pix" ? p.id_unico
                  : (p.origem === "planilha" && !p.id_transacao ? p.id_unico : null),
        driveId: p.origem === "drive" ? String(p.id) : null,
        notaId: p.origem === "planilha" ? Number(p.id) : null,
        idTransacao: p.id_transacao,
        codTitulo: p.codTitulo, nome: nomeFinal, cTabela: cTabelaOk, canal,
      });

      await anotar(supabase, {
        origem: p.origem, ref_id: String(p.id), rotulo: p.rotulo,
        cod_titulo: p.codTitulo, arquivo: nomeFinal, resultado: "ok",
        motivo: conversao === "imagem_para_pdf" ? "imagem convertida para PDF antes de subir" : null,
        canal,
      });

      console.log(`anexo OK · ${p.rotulo} · título ${p.codTitulo} · ${cTabelaOk} · ${conversao}`);
      enviados.push({
        id_unico: p.id_unico, titulo: p.rotulo, omie_cod_titulo: p.codTitulo,
        arquivo: nomeFinal, cTabela: cTabelaOk, conversao,
      });
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      console.error(`varredura falhou · ${p.rotulo} · título ${p.codTitulo} · ${erro}`);
      await anotar(supabase, {
        origem: p.origem, ref_id: String(p.id), rotulo: p.rotulo,
        cod_titulo: p.codTitulo, resultado: "erro", motivo: erro, canal,
      });
      /* A nota sai da fila com o motivo escrito NELA, e não só no diário: é na
         linha da nota que a pessoa vai olhar, e uma fila que retenta sozinha
         para sempre é como o "Documento não cadastrado" prendeu a varredura de
         anexos do CAP. Recolocar na fila é um clique. */
      if (p.origem === "planilha") {
        await supabase.from("notas_externas")
          .update({ fila_erp: false, erro_erp: erro.slice(0, 500), atualizado_em: new Date().toISOString() })
          .eq("id", Number(p.id));
      }
      falhas.push({ id_unico: p.id_unico, titulo: p.rotulo, omie_cod_titulo: p.codTitulo, erro });
    }
  }

  return {
    ok: true,
    fila: fila.length,
    enviados: enviados.length,
    falhas: falhas.length,
    parou_por_tempo: parouPorTempo,
    detalhe_enviados: enviados,
    detalhe_falhas: falhas,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "preview";
    const cTabela = String(body?.anexoTabela ?? "conta-pagar");

    // Cron: token próprio, mesmo padrão da comprovantes-drive-sync. Fora isso, usuário logado.
    const tok = req.headers.get("x-cron-token");
    let ehCron = false;
    if (tok) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("name").eq("name", "omie-anexar-comprovante").eq("token", tok).maybeSingle();
      ehCron = !!data;
    }
    if (!ehCron) await requireUser(req, { bloquearCargos: ["parcerias"] });

    const canal = ehCron ? "cron" : "hub";

    /* ------------------------------------------ nota em todas as parcelas */
    /* Compra parcelada tem N títulos no Omie e a nota ficava só no que casou —
       quem abrisse a parcela 5/8 não encontrava nada. Esta ação acha as irmãs e
       leva o MESMO documento para todas.

       SIMULA POR PADRÃO. `simular: false` é escolha explícita de quem chama:
       são escritas no ERP, e escrita no ERP não se desfaz com um clique. */
    if (action === "parcelas") {
      const simular = body?.simular !== false;
      const limite = Math.min(Math.max(Number(body?.limite ?? 40), 1), 200);

      const origens = await origensComNota(supabase, 500);
      if (!origens.length) return json({ ok: true, simulado: simular, origens: 0, mensagem: "Nenhum título com nota anexada pelo Hub." });

      const hoje = new Date();
      const janela = { de: isoMes(somaMeses(hoje, -JANELA_IRMAS_MESES)), ate: isoMes(somaMeses(hoje, JANELA_IRMAS_MESES)) };
      const universo = await lerTitulosDaJanela(janela.de, janela.ate);
      const porCod = new Map(universo.map((t) => [t.cod, t]));

      /* Quem já tem a nota não entra na fila: nem as origens, nem o que esta
         própria fila já anexou ou já foi recusado por uma pessoa. Sem isto a
         varredura proporia os mesmos pares todo dia. */
      const jaResolvido = new Set<number>(origens.map((o) => o.cod));
      const { data: decididos } = await supabase
        .from("omie_parcela_anexo").select("cod_titulo, status")
        .in("status", ["anexado", "recusado"]);
      for (const d of decididos ?? []) jaResolvido.add(Number(d.cod_titulo));

      const relatorio: any[] = [];
      const propostas: any[] = [];
      let semJanela = 0, aVista = 0;

      for (const o of origens) {
        const alvo = porCod.get(o.cod);
        if (!alvo) { semJanela++; continue; }
        if (!lerParcela(alvo.parc)) { aVista++; continue; }

        const g = acharIrmas(alvo, universo);
        const faltam = g.irmas.filter((t) => t.cod !== o.cod && !jaResolvido.has(t.cod));
        if (!faltam.length) continue;

        const origem = fitidDoCartao(alvo.integracao) ? "cartao" : "evidencia";
        relatorio.push({
          cod_titulo_origem: o.cod, rotulo: o.rotulo, parcela: alvo.parc,
          confianca: g.confianca, origem, motivo: g.motivo,
          irmas_sem_nota: faltam.map((t) => ({ cod: t.cod, parcela: t.parc, venc: t.venc })),
        });
        for (const t of faltam) {
          propostas.push({
            cod_titulo_origem: o.cod, cod_titulo: t.cod, parcela: t.parc,
            origem, confianca: g.confianca, motivo: g.motivo,
            // Ambígua nasce esperando gente; o resto já nasce liberado.
            status: g.confianca === "ambigua" ? "proposto" : "confirmado",
          });
        }
      }

      if (!simular && propostas.length) {
        // `ignoreDuplicates` porque a chave (origem, irmã) é única de propósito:
        // rodar de novo não pode duplicar a fila nem reabrir o que foi recusado.
        await supabase.from("omie_parcela_anexo")
          .upsert(propostas, { onConflict: "cod_titulo_origem,cod_titulo", ignoreDuplicates: true });
      }

      /* O ANEXO EM SI é limitado por rodada, pelo mesmo motivo da varredura: o
         teto do worker é de CPU (zip + base64), e quem morre no meio não devolve
         relatório. O que não couber fica na fila para a rodada seguinte. */
      const enviados: any[] = [];
      const falhas: any[] = [];
      if (!simular) {
        const inicio = Date.now();
        const { data: fila } = await supabase
          .from("omie_parcela_anexo").select("*")
          .eq("status", "confirmado").order("created_at").limit(limite);

        const arquivoDe = new Map(origens.map((o) => [o.cod, o.comprovante]));
        for (const item of fila ?? []) {
          if (Date.now() - inicio > ORCAMENTO_MS) break;
          const comprovante = arquivoDe.get(Number(item.cod_titulo_origem));
          if (!comprovante) {
            falhas.push({ cod: item.cod_titulo, erro: "a origem já não tem comprovante legível" });
            continue;
          }
          try {
            const { bytes, nome } = await baixarComprovante(supabase, comprovante);
            const r = await incluirAnexo({
              nId: String(item.cod_titulo), cTabela: "conta-pagar",
              nome, base64: toBase64(bytes), codInt: codIntAnexo(item.cod_titulo),
            });
            await supabase.from("omie_parcela_anexo")
              .update({ status: "anexado", anexado_em: new Date().toISOString(), erro: null })
              .eq("id", item.id);
            await anotar(supabase, {
              origem: "parcela", ref_id: String(item.id), rotulo: `parcela ${item.parcela}`,
              cod_titulo: String(item.cod_titulo), arquivo: r?.nome ?? nome, resultado: "ok", canal,
            });
            enviados.push({ cod: item.cod_titulo, parcela: item.parcela });
          } catch (e) {
            const erro = e instanceof Error ? e.message : String(e);
            await supabase.from("omie_parcela_anexo").update({ erro }).eq("id", item.id);
            await anotar(supabase, {
              origem: "parcela", ref_id: String(item.id), cod_titulo: String(item.cod_titulo),
              resultado: "erro", motivo: erro, canal,
            });
            falhas.push({ cod: item.cod_titulo, erro });
          }
        }
      }

      return json({
        ok: true,
        simulado: simular,
        janela,
        titulos_lidos: universo.length,
        origens_com_nota: origens.length,
        origens_fora_da_janela: semJanela,
        origens_a_vista: aVista,
        compras_parceladas_com_irma_sem_nota: relatorio.length,
        parcelas_a_receber: propostas.length,
        para_revisao: propostas.filter((p) => p.status === "proposto").length,
        anexados: enviados.length,
        falhas,
        detalhe: relatorio.slice(0, 25),
      });
    }

    /* -------- VARREDURA (cron ou botão "anexar tudo") -------- */
    if (action === "varredura") {
      const limite = Math.min(Math.max(Number(body?.limite ?? 40), 1), 120);
      return json(await varrer(supabase, cTabela, limite, ehCron ? "cron" : "hub", {
        responsavel: body?.responsavel ? String(body.responsavel) : null,
        idUnico: body?.id_unico ? String(body.id_unico) : null,
      }));
    }

    /* -------- 1) Achados (tabela `auditoria`) Aprovados + com comprovante -------- */
    const { data: achados, error: achErr } = await supabase
      .from("auditoria")
      .select("id, id_unico, titulo, valor, data_lancamento, status, link_comprovante, id_transacao, omie_cod_titulo, omie_anexo_enviado_em")
      .eq("status", "Aprovado")
      .not("link_comprovante", "is", null)
      .neq("link_comprovante", "");
    if (achErr) throw achErr;

    /* -------- 2) Lançamentos do cartão "aprovados direto" (status_nf=OK) + com comprovante -------- */
    const { data: cartoesOk, error: cOkErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .select("id, id_unico, data, valor, estabelecimento, descricao_original, status_nf, link_comprovante, arquivo_comprovante, omie_cod_titulo, omie_anexo_enviado_em")
      .eq("status_nf", "OK")
      .not("link_comprovante", "is", null)
      .neq("link_comprovante", "");
    if (cOkErr) throw cOkErr;

    // Lançamentos de origem dos achados (para casar pelos dados do gasto real).
    const idsTransacao = [...new Set((achados ?? []).map((a: any) => a.id_transacao).filter(Boolean))] as string[];
    const { data: cartoes, error: cartErr } = await supabase
      .from("auditoria_cartao_lancamentos")
      .select("id, id_unico, data, valor, estabelecimento, descricao_original, omie_cod_titulo, omie_anexo_enviado_em")
      .in("id_unico", idsTransacao.length ? idsTransacao : ["__nenhum__"]);
    if (cartErr) throw cartErr;
    const cartaoPorId = new Map((cartoes ?? []).map((c: any) => [c.id_unico, c]));

    if (!achados?.length && !cartoesOk?.length) {
      return json({ ok: true, elegiveis: [], total: 0, aviso: "Nenhum lançamento Aprovado com comprovante anexado." });
    }

    /* -------- 3) Reencontra o título no Omie (mesma lógica do match-cartao) -------- */
    const [categorias, movimentos] = await Promise.all([listarCategorias(), listarMovimentos({})]);
    const codToDesc = new Map<string, string>();
    for (const c of categorias) if (c.codigo) codToDesc.set(String(c.codigo), c.descricao ?? "");
    const byValue = indexarMovimentos(movimentos);

    const comDrive = driveConfigurado();

    // O título gravado vale mais que o recasado: o "Cruzar com Omie" já resolveu essa linha,
    // e o casamento por valor/data pode devolver "média" para um título que já é certeza.
    const doBanco = (cod: unknown): MatchResult | null =>
      cod
        ? { codigo: "", descricao: "título já casado na auditoria", codTitulo: String(cod), fornecedor: "", dataLabel: "", conf: "alta", dias: 0, sim: 1 }
        : null;

    const motivo = (comprovante: string, match: MatchResult | null, jaEnviado: string | null): Motivo => {
      if (jaEnviado) return "ja_enviado";
      if (ehUrl(comprovante)) {
        const id = extrairIdDrive(comprovante);
        if (!id) return "comprovante_invalido";   // URL que não é do Drive
        return match?.codTitulo ? null : "sem_titulo";
      }
      if (!ehCaminhoStorage(comprovante)) return "comprovante_invalido"; // só o nome do arquivo
      if (!match?.codTitulo) return "sem_titulo";
      return null;
    };

    const daAuditoria: Item[] = (achados ?? []).map((a: any) => {
      const c = a.id_transacao ? cartaoPorId.get(a.id_transacao) : null;
      const base = c ?? { valor: a.valor, data: a.data_lancamento, estabelecimento: a.titulo, descricao_original: null };
      const match = doBanco(a.omie_cod_titulo) ?? casarComOmie(base as any, byValue, codToDesc);
      const comprovante = String(a.link_comprovante ?? "");
      // O carimbo do PRÓPRIO achado conta: os achados de julho em diante não têm lançamento
      // de cartão, e olhar só para `c` fazia o já-anexado voltar para a fila.
      const jaEnviado = a.omie_anexo_enviado_em ?? c?.omie_anexo_enviado_em ?? null;
      return {
        achado_id: a.id,
        origem: "achado" as const,
        titulo: a.titulo,
        valor: Number(a.valor ?? 0),
        data: a.data_lancamento ?? null,
        comprovante,
        cartao_id: c?.id ?? null,
        cartao_id_unico: c?.id_unico ?? null,
        id_transacao: a.id_transacao ?? c?.id_unico ?? null,
        estabelecimento: c?.estabelecimento ?? null,
        ja_enviado_em: jaEnviado,
        match: match?.codTitulo ? match : null,
        bloqueio: motivo(comprovante, match, jaEnviado),
      };
    });

    const jaCobertos = new Set(daAuditoria.map((i) => i.cartao_id_unico).filter(Boolean));

    const doCartao: Item[] = (cartoesOk ?? [])
      .filter((c: any) => !jaCobertos.has(c.id_unico))
      .map((c: any) => {
        const match = doBanco(c.omie_cod_titulo) ?? casarComOmie(c as any, byValue, codToDesc);
        const comprovante = String(c.link_comprovante ?? "");
        return {
          achado_id: -c.id,
          origem: "cartao" as const,
          titulo: c.estabelecimento || c.descricao_original || "Lançamento com nota",
          valor: Number(c.valor ?? 0),
          data: c.data ?? null,
          comprovante,
          cartao_id: c.id,
          cartao_id_unico: c.id_unico,
          id_transacao: c.id_unico,
          estabelecimento: c.estabelecimento ?? null,
          ja_enviado_em: c.omie_anexo_enviado_em ?? null,
          match: match?.codTitulo ? match : null,
          bloqueio: motivo(comprovante, match, c.omie_anexo_enviado_em ?? null),
        };
      });

    let elegiveis: Item[] = [...daAuditoria, ...doCartao];

    // ESCOPO: a tela manda o recorte visível (filtros de fatura + responsável + busca…) como
    // DUAS chaves, porque nem todo lançamento tem id_transacao: os achados importados direto
    // em `auditoria` (ex.: fatura de Julho) não têm vínculo com o cartão, e para esses a chave
    // é o próprio achado_id. Sem isto o botão ignorava os filtros e/ou pulava esses achados.
    const escIdsUnicos: string[] | null = Array.isArray(body?.escopo?.idsUnicos) ? body.escopo.idsUnicos.map(String) : null;
    const escAchados: number[] | null = Array.isArray(body?.escopo?.achadoIds) ? body.escopo.achadoIds.map(Number) : null;
    if (escIdsUnicos || escAchados) {
      const su = new Set(escIdsUnicos ?? []);
      const sa = new Set(escAchados ?? []);
      elegiveis = elegiveis.filter((e) => (e.id_transacao && su.has(e.id_transacao)) || sa.has(e.achado_id));
    }

    // Antes de dizer que um item do Drive está pronto, conferimos que o arquivo abre —
    // pelo conector, se houver, ou pelo link público. Só o cabeçalho, não o arquivo inteiro.
    {
      const doDrive = elegiveis.filter((e) => !e.bloqueio && ehUrl(e.comprovante));
      for (let i = 0; i < doDrive.length; i += 5) {
        await Promise.all(doDrive.slice(i, i + 5).map(async (e) => {
          const r = await podeLerNoDrive(e.comprovante);
          if (!r.ok) { e.bloqueio = "drive"; e.detalhe = r.erro; }
        }));
      }
    }

    /* -------- PREVIEW -------- */
    if (action === "preview") {
      return json({
        ok: true,
        total: elegiveis.length,
        drive_configurado: comDrive,
        elegiveis: elegiveis.map((e) => ({
          ...e,
          pode_enviar_direto: !e.bloqueio && e.match?.conf === "alta",
        })),
      });
    }

    /* -------- TESTAR DRIVE -------- */
    if (action === "testar_drive") {
      if (!comDrive) {
        const s = statusDrive();
        const faltando = [!s.lovable ? "LOVABLE_API_KEY" : null, !s.drive ? "GOOGLE_DRIVE_API_KEY" : null].filter(Boolean);
        return json({ ok: false, drive_configurado: false, secrets: s, erro: `Falta o secret ${faltando.join(" e ")} no Supabase (Edge Functions → Secrets).` });
      }
      let conta: { email: string; nome: string };
      try {
        conta = await sondarDrive();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("testar_drive: conector não respondeu ·", msg);
        return json({ ok: false, drive_configurado: true, conector_ok: false, erro: msg });
      }
      const alvo = elegiveis.find((e) => ehUrl(e.comprovante) && extrairIdDrive(e.comprovante));
      if (!alvo) {
        return json({ ok: true, drive_configurado: true, conector_ok: true, conta: conta.email, base: baseDoDrive(), aviso: "Conector OK. Nenhum comprovante do Drive para testar." });
      }
      try {
        const arq = await baixarDoDrive(alvo.comprovante);
        return json({ ok: true, drive_configurado: true, conector_ok: true, conta: conta.email, base: baseDoDrive(), baixou: true, lancamento: alvo.estabelecimento ?? alvo.titulo, arquivo: arq.nome, mime: arq.mime, bytes: arq.bytes.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("testar_drive: download falhou ·", msg);
        return json({ ok: false, drive_configurado: true, conector_ok: true, conta: conta.email, base: baseDoDrive(), baixou: false, lancamento: alvo.estabelecimento ?? alvo.titulo, erro: msg });
      }
    }

    /* -------- ANEXAR ARQUIVO (upload manual) -------- */
    if (action === "anexar_arquivo") {
      const id = Number(body?.id);
      const nomeArq = String(body?.nome ?? "comprovante").slice(0, 120);
      const base64 = String(body?.base64 ?? "");
      if (!id || !base64) return json({ error: "Parâmetros faltando (id, base64)." }, 200);

      const item = elegiveis.find((e) => e.achado_id === id);
      if (!item) return json({ error: "Lançamento não está mais na lista de elegíveis." }, 200);
      if (!item.match?.codTitulo) return json({ error: "Não achei o título correspondente no Omie — não há onde anexar." }, 200);

      let bytes: Uint8Array;
      try {
        const limpo = base64.replace(/^data:[^;]+;base64,/, "");
        bytes = Uint8Array.from(atob(limpo), (c) => c.charCodeAt(0));
      } catch {
        return json({ error: "Arquivo inválido (base64)." }, 200);
      }
      if (!bytes.length) return json({ error: "Arquivo vazio." }, 200);
      if (bytes.length > 10 * 1024 * 1024) return json({ error: "Arquivo maior que 10 MB." }, 200);
      if (ehHtml(bytes)) return json({ error: "Isso é uma página HTML, não um comprovante. Baixe o arquivo do Drive e envie o PDF/imagem." }, 200);

      const seguro = nomeArq.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `hub/${item.cartao_id_unico ?? item.achado_id}/${Date.now()}_${seguro}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: body?.mime ? String(body.mime) : undefined, upsert: false });
      if (upErr) return json({ error: `Falha ao guardar o arquivo: ${upErr.message}` }, 200);

      let cTabelaOk: string;
      try {
        const r = await incluirAnexo({ nId: item.match.codTitulo, cTabela, nome: nomeArq, base64: toBase64(bytes), codInt: codIntAnexo(item.achado_id) });
        cTabelaOk = r.cTabela;
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 200);
      }

      await carimbar(supabase, {
        achadoId: item.origem === "achado" ? item.achado_id : null,
        cartaoId: item.cartao_id,
        cartaoIdUnico: item.origem === "cartao" ? item.cartao_id_unico : null,
        idTransacao: item.id_transacao,
        codTitulo: item.match.codTitulo,
        nome: nomeArq,
        cTabela: cTabelaOk,
        canal: "hub_upload",
      });

      return json({ ok: true, anexado: true, omie_cod_titulo: item.match.codTitulo, cTabela: cTabelaOk, arquivo: nomeArq, storage_path: path });
    }

    /* -------- ENVIAR -------- */
    if (action !== "enviar") return json({ error: `Ação desconhecida: ${action}` }, 200);

    const idsPedidos: number[] | null = Array.isArray(body?.ids) ? body.ids.map(Number) : null;
    // `todos`: envio individual (drawer) ou "enviar tudo do escopo" — a pessoa já escolheu,
    // então não filtramos por confiança. Sem isso, cai na regra padrão (só alta automático).
    const todos = body?.todos === true;
    const alvos = elegiveis.filter((e) => {
      if (e.bloqueio) return false; // já enviado / Drive sem acesso / sem título / inválido
      if (idsPedidos) return idsPedidos.includes(e.achado_id); // dialog: itens marcados/auto
      if (todos) return true;                                  // drawer/escopo explícito
      return e.match!.conf === "alta";                         // padrão: só alta
    });

    const enviados: any[] = [];
    const falhas: any[] = [];

    for (const e of alvos) {
      try {
        // Busca o arquivo — do Drive ou do nosso bucket, conforme a origem.
        const { bytes, nome } = await baixarComprovante(supabase, e.comprovante);

        // incluirAnexo NORMALIZA (foto vira PDF, extensão mentirosa é corrigida pelos
        // bytes), ZIPA, envia e CONFIRMA que o anexo colou — ou lança com diagnóstico.
        const { cTabela: cTabelaOk, variante, nome: nomeFinal, conversao } = await incluirAnexo({
          nId: e.match!.codTitulo, cTabela, nome, base64: toBase64(bytes), codInt: codIntAnexo(e.achado_id),
        });
        console.log(`anexo OK · ${e.titulo} · título ${e.match!.codTitulo} · ${cTabelaOk} · ${variante} · ${conversao}`);

        await carimbar(supabase, {
          achadoId: e.origem === "achado" ? e.achado_id : null,
          cartaoId: e.cartao_id,
          cartaoIdUnico: e.origem === "cartao" ? e.cartao_id_unico : null,
          idTransacao: e.id_transacao,
          codTitulo: e.match!.codTitulo,
          nome: nomeFinal,
          cTabela: cTabelaOk,
          canal: "hub",
        });

        await anotar(supabase, {
          origem: e.origem === "achado" ? "auditoria" : "cartao",
          ref_id: String(e.achado_id), rotulo: e.titulo,
          cod_titulo: e.match!.codTitulo, arquivo: nomeFinal, resultado: "ok",
          motivo: conversao === "imagem_para_pdf" ? "imagem convertida para PDF antes de subir" : null,
          canal: "hub",
        });

        enviados.push({ achado_id: e.achado_id, titulo: e.titulo, omie_cod_titulo: e.match!.codTitulo, cTabela: cTabelaOk, variante, arquivo: nomeFinal, conversao });
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        console.error(`envio falhou · ${e.titulo} · título ${e.match?.codTitulo} · ${erro}`);
        await anotar(supabase, {
          origem: e.origem === "achado" ? "auditoria" : "cartao",
          ref_id: String(e.achado_id), rotulo: e.titulo,
          cod_titulo: e.match?.codTitulo ?? null, resultado: "erro", motivo: erro, canal: "hub",
        });
        falhas.push({ achado_id: e.achado_id, titulo: e.titulo, erro });
      }
    }

    return json({ ok: true, enviados: enviados.length, falhas: falhas.length, detalhe_enviados: enviados, detalhe_falhas: falhas, ignorados: elegiveis.length - alvos.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message
      : (e && typeof e === "object")
        ? ([(e as any).message, (e as any).details, (e as any).hint].filter(Boolean).join(" — ") || JSON.stringify(e))
        : String(e);
    console.error("omie-anexar-comprovante error:", msg);
    return json({ error: msg }, 200);
  }
});
