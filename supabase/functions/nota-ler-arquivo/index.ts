// Edge Function: nota-ler-arquivo
//
// Abre o arquivo que o acervo já guardou e lê o que está DENTRO dele.
//
// Medido em 27/08/2026: **483 notas com arquivo e sem valor**. Elas chegaram
// por caminhos que só olham o lado de fora — o nome do arquivo, o corpo do
// e-mail, a linha da planilha — e quando esses três se calam a nota entra muda.
// Sem valor nenhuma regra do casador alcança, então ela fica `sem_alvo` para
// sempre com o documento ali do lado.
//
// A CAUSA MAIS COMUM É A MOEDA. HubSpot, Datadog e Campbells faturam em dólar e
// não escrevem "R$" em lugar nenhum; `lerCorpoDeEmail` só procurava reais.
// `valorComMoeda` agora lê US$/USD/EUR e a conversão acontece aqui, pela PTAX
// do dia da nota (`cambio_dia`, alimentada da API pública do BCB).
//
// O QUE ELA NÃO FAZ: OCR. PDF que é só imagem sai com texto vazio e fica
// carimbado como lido — quem resolve imagem é a `anexo-triagem`, que já chama o
// Gemini e tem orçamento próprio para isso. Misturar as duas faria esta
// varredura herdar o custo e o teto de CPU daquela.
//
// A FILA É POR IDENTIDADE, NÃO POR VALOR (conserto de 27/08/2026). Ela era
// `valor is null` e tinha **3 linhas**, com 1.531 notas de arquivo no bucket
// nunca abertas — todas com valor e nenhuma com CNPJ ou chave fiscal. Sem
// identidade o casador só alcança as regras de valor+data, e fornecedor mensal
// de valor fixo fica irresolvível por construção: as cinco notas de R$ 13.139
// da F. Dutra disputavam os três títulos de R$ 13.139 e todas morriam
// `ambiguo`. O valor é o que as empata; o CNPJ é o que as separa.
//
// O CARIMBO É O QUE IMPEDE O LAÇO. `lido_do_arquivo_em` é gravado mesmo quando
// nada foi extraído: sem ele, as mesmas 483 notas voltariam em toda rodada e a
// fila nunca andaria — a mesma lição dos 5 arquivos venenosos que pararam a
// drenagem da pasta "0. Gmail" em 26/08/2026.
//
// Body: { limite?: number, id?: number, releitura?: boolean }
// Cron: header `x-cron-token`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { textoDePdf } from "../_shared/pdf.ts";
import { lerCorpoDeEmail, lerXmlFiscal, valorComMoeda } from "../_shared/nota-fiscal.ts";
import { mimeDosBytes, mimeDoNome } from "../_shared/mime.ts";
import {
  perguntaSemTitulo, SISTEMA_TRIAGEM, SCHEMA_TRIAGEM, type LeituraAnexo,
} from "../_shared/anexo-triagem.ts";
import { generateJSON, MODELOS_CASCATA } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";
const CNPJ_TAKEAT = "37511891000150";
const ORCAMENTO_MS = 55_000;
/** Acima disto o PDF não vale o worker: `unpdf` carrega o documento inteiro. */
const MAX_BYTES = 8 * 1024 * 1024;

/** O que o Gemini consegue olhar. XML e texto não passam por aqui. */
const IMAGEM_OK = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function ehImagem(caminho: string, bytes: Uint8Array): boolean {
  const m = mimeDosBytes(bytes) ?? mimeDoNome(caminho);
  return !!m && m.startsWith("image/");
}

/** base64 em pedaços: `String.fromCharCode(...bytes)` estoura a pilha em ~1 MB. */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * A DATA QUE O MODELO DEVOLVE, em qualquer um dos dois jeitos que ela vem.
 *
 * O sistema pede ISO e o modelo obedece na maioria das vezes — mas num
 * documento brasileiro escrito "03/06/2026" ele às vezes repete o que leu. A
 * primeira versão exigia ISO e devolvia `null` no resto; o efeito não era um
 * erro visível, era a nota perder a âncora de data e procurar o título dela na
 * janela do dia em que foi jogada na Caixa.
 *
 * `dd/mm` e nunca `mm/dd`: o documento é brasileiro. Ano de dois dígitos vira
 * 20xx, e o que passar de 2100 ou vier antes de 2000 é recusado — data absurda
 * lida como boa é pior do que data ausente.
 */
function dataDoDocumento(bruta: unknown): string | null {
  const s = String(bruta ?? "").trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const br = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  let ano: number, mes: number, dia: number;
  if (iso) {
    [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (br) {
    dia = Number(br[1]); mes = Number(br[2]);
    ano = Number(br[3]);
    if (ano < 100) ano += 2000;
  } else {
    return null;
  }
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ano}-${p(mes)}-${p(dia)}`;
}

/** O tipo que a transcrição devolve, traduzido para o vocabulário do acervo. */
function tipoDoAcervo(tipo: string): string | null {
  const t = (tipo || "").toLowerCase();
  if (t === "nota_fiscal" || t === "cupom_fiscal") return "nota";
  if (t === "boleto") return "boleto";
  if (t === "recibo" || t === "comprovante_pagamento") return "recibo";
  if (t === "extrato") return "extrato";
  return "outro";
}

/**
 * A LEITURA POR IMAGEM — e o que ela é e não é.
 *
 * É TRANSCRIÇÃO. O modelo devolve o que está escrito no papel: emitente, CNPJ,
 * número, valor, data. Quem decide a que lançamento isso pertence continua sendo
 * o `notas_externas_casar`, com as mesmas oito regras de sempre. Se um dia a
 * transcrição errar o valor, o casamento erra junto — e é por isso que a linha
 * guarda `leitura_erro` e o valor lido fica visível na tela, em vez de virar só
 * um alvo escolhido sem explicação.
 *
 * Usa o MESMO sistema e o MESMO schema da triagem de anexos do ERP. Dois
 * contratos de transcrição no mesmo repo divergem no primeiro conserto, e aí o
 * mesmo PDF é lido de dois jeitos dependendo da porta por onde entrou.
 */
async function lerComGemini(bytes: Uint8Array, caminho: string, prazo = 0): Promise<{
  emitente: string | null; cnpj: string | null; numero: string | null;
  valor: number | null; data: string | null; legivel: boolean;
  tipo_documento: string | null; resumo: string | null;
} | null> {
  const mime = mimeDosBytes(bytes) ?? mimeDoNome(caminho);
  if (!mime || !IMAGEM_OK.has(mime)) return null;

  const b64 = toBase64(bytes);
  const mensagens = [
    { role: "system" as const, content: SISTEMA_TRIAGEM },
    {
      role: "user" as const,
      content: perguntaSemTitulo(caminho.split("/").pop() || "documento"),
      imagens: [{ mimeType: mime, data: b64 }],
    },
  ];

  /* A CASCATA DE MODELOS, e por que ela precisa existir AQUI.
   *
   * Medido em 27/08/2026, drenando a fila de leitura: metade das rodadas
   * voltava com `503 UNAVAILABLE — "This model is currently experiencing high
   * demand"`. E o `catch` de propósito NÃO carimba a linha nessa situação (erro
   * de IA melhora sozinho, arquivo corrompido não) — então a mesma nota voltava
   * na rodada seguinte, tomava o mesmo 503, e a fila de 1.288 arquivos
   * escaneados não andava: gastava-se a janela inteira para ler três.
   *
   * `MODELOS_CASCATA` já existia para isto e é o que o `ask-finance-ai` usa há
   * meses. Só o 5xx e o 429 descem um degrau — 400 é pedido malformado e tentar
   * de novo noutro modelo só repete o erro mais devagar. */
  let l: LeituraAnexo | null = null;
  let ultimo: unknown = null;
  for (const model of MODELOS_CASCATA) {
    try {
      l = await generateJSON<LeituraAnexo>({
        model, temperature: 0, responseSchema: SCHEMA_TRIAGEM, messages: mensagens,
        /* A escada de modelos JÁ É a retentativa aqui, e o parágrafo acima conta
           o preço dela: leitura de imagem gasta ~50s e três em sequência matam o
           worker. A retentativa que o helper ganhou em 29/08/2026 dobraria cada
           degrau — seis idas no pior caso. Um relógio só por chamada. */
        semRetentativa: true,
      });
      break;
    } catch (e) {
      ultimo = e;
      const st = (e as { status?: number })?.status ?? 0;
      if (st !== 429 && st < 500) throw e;
      /* O DEGRAU SEGUINTE PRECISA CABER NA JANELA. Uma leitura de imagem gasta
         ~50 s; três tentativas em sequência estouram o worker (visto:
         `WORKER_RESOURCE_LIMIT`), e um worker morto não carimba nada nem
         devolve resumo — pior que uma leitura a menos. */
      if (prazo && Date.now() > prazo) throw e;
      console.warn(`nota-ler-arquivo: ${model} respondeu ${st} — descendo um degrau`);
    }
  }
  if (l === null) throw ultimo ?? new Error("nenhum modelo respondeu");

  const cnpj = String(l?.cnpj_emitente ?? "").replace(/\D/g, "");
  /* O CNPJ DA TAKEAT É O DESTINATÁRIO, e o modelo troca os dois de vez em
     quando. Gravá-lo como emitente faria a nota casar por CNPJ com QUALQUER
     título — seria o erro mais caro que esta leitura pode cometer. */
  const cnpjEmitente = cnpj.length >= 11 && cnpj !== CNPJ_TAKEAT ? cnpj : null;
  const data = dataDoDocumento(l?.data);

  return {
    emitente: l?.emitente?.trim() || null,
    cnpj: cnpjEmitente,
    numero: l?.numero?.trim() || null,
    valor: typeof l?.valor_total === "number" && isFinite(l.valor_total) ? l.valor_total : null,
    data,
    legivel: l?.legivel !== false,
    tipo_documento: tipoDoAcervo(String(l?.tipo ?? "")),
    resumo: l?.resumo?.trim() || null,
  };
}

/** A PTAX de venda do BCB, com cache em `cambio_dia`. */
async function cotacao(supabase: any, data: string, moeda: string): Promise<number | null> {
  const { data: emCache } = await supabase.rpc("cambio_do_dia", { p_data: data, p_moeda: moeda });
  if (emCache) return Number(emCache);
  if (moeda !== "USD") return null;   // só o dólar tem série diária simples na API

  /* Pede uma JANELA e não um dia: fim de semana e feriado não têm cotação, e
     pedir "sábado" devolve lista vazia sem dizer por quê. */
  const fim = new Date(`${data}T12:00:00Z`);
  const ini = new Date(fim.getTime() - 8 * 86_400_000);
  const br = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
  const url = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo("
    + "dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)"
    + `?@dataInicial='${br(ini)}'&@dataFinalCotacao='${br(fim)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const j = await r.json();
    const linhas: { cotacaoVenda: number; dataHoraCotacao: string }[] = j?.value ?? [];
    if (!linhas.length) return null;
    await supabase.from("cambio_dia").upsert(
      linhas.map((l) => ({ data: l.dataHoraCotacao.slice(0, 10), moeda: "USD", venda: l.cotacaoVenda })),
      { onConflict: "data,moeda" },
    );
    const { data: agora } = await supabase.rpc("cambio_do_dia", { p_data: data, p_moeda: moeda });
    return agora ? Number(agora) : null;
  } catch (_) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const cron = req.headers.get("x-cron-token");
    if (cron) {
      const { data } = await supabase.from("internal_cron_tokens")
        .select("token").eq("name", "nota-ler-arquivo").maybeSingle();
      if (!data?.token || data.token !== cron) return json({ error: "Token inválido." }, 401);
    } else {
      await requireUser(req, { bloquearCargos: ["parcerias"] });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limite = Math.min(Math.max(Number(body?.limite ?? 25), 1), 80);
    const soId = Number(body?.id ?? 0) || null;

    let q = supabase
      .from("notas_externas")
      .select("id, link, arquivo_bucket, enviado_em, vencimento, cnpj, valor, chave_fiscal, nome, tipo_documento")
      .eq("tem_arquivo", true)
      .is("ignorado_em", null)
      /* A JANELA É MAIOR QUE A LEVA de propósito: o XML fura a fila logo
         abaixo, e furar fila dentro de 25 linhas já sorteadas não é furar fila
         nenhuma. Buscar quatro vezes mais e escolher aqui custa uma consulta
         com `limit` maior — nada perto dos 25s de Gemini que cada imagem cobra. */
      .limit(soId ? 1 : Math.min(limite * 4, 300));
    if (soId) q = q.eq("id", soId);
    else {
      /* A FILA É SOBRE IDENTIDADE, NÃO SOBRE VALOR — e essa troca é o conserto.
       *
       * `valor is null` deixava de fora exatamente quem mais precisa ser lido.
       * Medido em 27/08/2026: a fila tinha **3** linhas, enquanto **1.531**
       * notas com arquivo no bucket nunca foram abertas porque já tinham valor
       * — e nenhuma delas tem CNPJ nem chave fiscal. Sem identidade, o casador
       * só alcança `valor_data` (regra 5) e `nome_valor` (6); as regras 1 a 3,
       * que casam por CNPJ, ficam inalcançáveis. Para fornecedor mensal de
       * valor fixo isso é fatal: as cinco notas de R$ 13.139 da F. Dutra
       * reivindicavam os três títulos de R$ 13.139 e todas saíam `ambiguo`.
       *
       * E o valor é justamente o que as torna ambíguas; o CNPJ é o que as
       * desempata. Filtrar por valor era pedir para ler só quem não tinha o
       * problema.
       *
       * Medido no arquivo 27026 (F. Dutra, PDF escaneado): antes
       * `tipo_documento='outro'`, sem CNPJ; depois de UMA leitura veio
       * `31565399000181`, documento `00003138`, vencimento 11/05 e
       * `tipo_documento='nota'` — `parece_nota` é coluna gerada de
       * `tipo_documento`, então a linha ganha peso na disputa de graça. */
      /* E O XML ENTRA SEMPRE, mesmo já tendo valor, CNPJ e chave.
       *
       * As duas condições acima perguntam "esta linha precisa ser lida?", e
       * para o XML a resposta era não: os 111 que vieram por e-mail já chegam
       * com CNPJ e chave garimpados do CORPO da mensagem. Só que o corpo do
       * e-mail não traz a DATA — medido em 28/08/2026, os 111 tinham
       * `vencimento` nulo — e `vencimento` é a âncora das janelas do casador
       * (`data_ref = coalesce(vencimento, enviado_em)`). Sem ela, uma nota de
       * abril procura o título dela na janela do dia em que o e-mail chegou.
       *
       * A pergunta certa para o XML não é "falta identidade?" e sim "já foi
       * aberto?", porque abri-lo não custa nada: é decodificar bytes e casar
       * tag, sem Gemini, sem cota e sem chance de erro de transcrição. O
       * `lido_do_arquivo_em is null` logo abaixo é o que garante uma vez só. */
      q = q.or("valor.is.null,and(cnpj.is.null,chave_fiscal.is.null),arquivo_bucket.ilike.*.xml,link.ilike.*.xml");
      if (body?.releitura !== true) q = q.is("lido_do_arquivo_em", null);
      /* SÓ QUEM TEM CÓPIA NO BUCKET ENTRA. O `catch` lá embaixo carimba
         `lido_do_arquivo_em` mesmo falhando — de propósito, para arquivo
         corrompido não voltar toda rodada. Só que "está no Drive e ainda não
         foi copiado" NÃO é defeito do arquivo: a `notas-arquivar` copia todo
         dia às 14h15. Deixar essas linhas entrarem gastava a vaga recusando o
         link E as condenava a nunca mais serem lidas, minutos antes de a cópia
         chegar. São 989 linhas nessa situação hoje.
         MAS O CAMINHO DO BUCKET NEM SEMPRE MORA EM `arquivo_bucket`. O guard
         era `arquivo_bucket is not null`, e ele levou junto todo o e-mail: a
         `gmail-nf-sync` grava o anexo no bucket e guarda o caminho em `link`
         (não há segunda cópia — é o mesmo bucket). Vinte linhas abaixo o código
         já sabe cair para o `link`; ele nunca chegava lá. Medido em 28/08/2026:
         **493 arquivos no bucket e fora da fila** — 111 XML, 327 PDF, 49
         imagens; 342 nunca abertos, e entre os XMLs 97 já trazem chave fiscal,
         que é a evidência mais forte que o casador tem.
         O recorte certo não é a COLUNA, é o FORMATO: caminho de bucket entra,
         URL não. É a mesma pergunta que o `if` da leitura faz lá embaixo. */
      q = q.or("arquivo_bucket.not.is.null,and(link.not.is.null,link.not.ilike.http*)");
      q = q.order("id", { ascending: false });
    }
    const { data: pendentes, error } = await q;
    if (error) throw error;

    /* O XML NA FRENTE, e não por preferência: é o único que não custa IA.
       Lê-lo é decodificar bytes e casar tag — milissegundos, sem cota, sem
       chance de erro de transcrição. Uma foto custa ~25s de Gemini, e com
       `ORCAMENTO_MS` de 55s cabem duas por rodada. Misturados na mesma ordem,
       os 111 XMLs destravados em 28/08/2026 sairiam atrás de 380 imagens e
       PDFs — dias de espera pelo documento mais barato e mais exato da
       esteira. Na frente, saem numa rodada. */
    const ehXml = (r: any) => /\.xml$/i.test(String(r?.arquivo_bucket || r?.link || ""));
    const fila = soId
      ? (pendentes ?? [])
      : [...(pendentes ?? [])].sort((a, b) => Number(ehXml(b)) - Number(ehXml(a))).slice(0, limite);

    const inicio = Date.now();
    let lidos = 0, comValor = 0, emMoeda = 0, semTexto = 0, comIdentidade = 0;
    const falhas: { id: number; erro: string }[] = [];

    for (const n of fila) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      /* `arquivo_bucket` ANTES de `link`. Quem veio do Drive tem `link` de
         URL e a CÓPIA no bucket noutra coluna — a `notas-arquivar` copiou 2.654
         arquivos para cá justamente para não depender do OAuth na leitura.
         Olhar só o `link` fazia a varredura recusar todas elas. */
      const caminho = String((n as any).arquivo_bucket || (n as any).link || "");
      const agora = new Date().toISOString();
      const marca: Record<string, unknown> = { lido_do_arquivo_em: agora, atualizado_em: agora };
      /* A LEITURA PREENCHE O QUE FALTA; SÓ A RELEITURA SUBSTITUI.
       *
       * Desde que a fila passou a aceitar linha COM valor (é o conserto de
       * 27/08/2026 lá em cima), 1.531 notas que já tinham valor certo passam
       * por aqui — e o que se quer delas é o CNPJ, não um valor novo. O ramo
       * do texto lia `valorComMoeda` e regravava por cima: num PDF que traz a
       * nota e o boleto juntos, o número que aparece primeiro é o do boleto, e
       * o casamento que já funcionava passaria a errar. `releitura: true`
       * continua podendo corrigir — é para isso que ela existe. */
      /* SÓ `releitura: true` SUBSTITUI — nem mesmo a leitura de UMA nota por
         `id`. Custou caro descobrir: ler as cinco notas da F. Dutra por id
         trocou o valor delas de R$ 13.139 para R$ 14.000, e as duas cifras
         estão certas em papéis diferentes — R$ 14.000 é o BRUTO impresso na
         NFS-e, R$ 13.139 é o líquido depois do ISS retido, que é o valor do
         TÍTULO. Trocar uma pela outra tira do casador exatamente o número que
         casa. Pedir uma nota específica é pedir para PREENCHER o que falta;
         quem quer corrigir o que já está lá diz `releitura`. */
      const manterValor = body?.releitura !== true;
      const valorAtual = (n as any).valor as number | null;
      try {
        /* Só o que está no BUCKET. Link do Drive precisa do OAuth da caixa e
           tem varredura própria (`notas-arquivar`, que copia para cá); tentar
           daqui duplicaria o consentimento e o modo de falhar. */
        if (/^https?:\/\//i.test(caminho) || !caminho) {
          throw new Error("o arquivo não está no bucket (só link externo)");
        }
        const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(caminho);
        if (dlErr) throw new Error(dlErr.message);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!bytes.length) throw new Error("arquivo vazio");
        if (bytes.length > MAX_BYTES) throw new Error("arquivo grande demais para ler aqui");

        let texto = "";
        let xmlSemLayout = false;
        if (/\.xml$/i.test(caminho)) {
          texto = new TextDecoder().decode(bytes);
          const x = lerXmlFiscal(texto, CNPJ_TAKEAT);
          if (x) {
            marca.cnpj = (n as any).cnpj ?? x.cnpj ?? null;
            marca.valor = (n as any).valor ?? x.valor ?? null;
            marca.chave_fiscal = (n as any).chave_fiscal ?? x.chave ?? null;
            marca.nome = (n as any).nome ?? x.emitente ?? null;
            if (x.numero) marca.documento = x.numero;
            /* A DATA DO XML VENCE A QUE JÁ ESTAVA — única exceção à regra de só
               preencher o que falta, e ela é deliberada. As outras fontes
               CHUTAM a data: a Caixa grava "hoje" porque o casador exige
               `enviado_em` preenchido, e o PDF entrega o que o layout deixar.
               No XML ela está em campo próprio (`dhEmi`, `DataEmissao`), que é
               a definição de dado exato. Foi exatamente este campo que faltou
               nos 11 PDFs da Flash em 28/08/2026: sem ele o casador ancora a
               janela no dia do upload, e nota de abril nunca alcança o título
               de abril. Preencher por cima de um chute não é sobrescrever
               informação — é trocar palpite por fato. */
            if (x.data) marca.vencimento = x.data;
            /* O XML FISCAL É A NOTA. Não é pista de que talvez seja: ele só
               existe porque houve emissão. Decisão do usuário em 28/08/2026. */
            marca.tipo_documento = "nota";
            marca.leitura_erro = null;
            if (x.valor) { marca.moeda = "BRL"; comValor++; }
          } else {
            /* O XML QUE NÃO BATE COM LAYOUT NENHUM PARA DE SAIR CALADO.
               NFS-e é municipal e não tem padrão nacional; até 28/08/2026 este
               ramo devolvia nada, sem erro, e a linha ficava indistinguível de
               uma que ninguém tentou ler — o pior desfecho possível, porque
               some da lista do que falta sem nunca ter sido lida. O `texto`
               segue para o caminho comum lá embaixo (XML é texto, e
               `lerCorpoDeEmail`/`valorComMoeda` ainda garimpam CNPJ, chave e
               valor no meio das tags) e o erro é escrito no fim, quando já se
               sabe se o garimpo rendeu. */
            xmlSemLayout = true;
          }
        } else if (ehImagem(caminho, bytes)) {
          /* FOTO NÃO TEM TEXTO PARA EXTRAIR — só olhando. Metade do acervo é
             cupom fotografado, e até aqui essas linhas morriam sem valor e sem
             erro que explicasse. */
          texto = "";
        } else {
          const r = await textoDePdf(bytes);
          texto = r.texto ?? "";
        }

        /* ---------------- a IA entra só quando o texto falta ----------------
         *
         * E entra para TRANSCREVER, não para decidir: o que ela devolve vira
         * `cnpj`/`valor`/`nome` na linha, e quem casa com o título continua
         * sendo o `notas_externas_casar` com as regras dele. A divisão é a mesma
         * do resto do repo — o sinal é determinístico, a leitura é que é cara.
         *
         * A ordem importa: PDF com texto NUNCA passa por aqui. Extrair texto de
         * PDF é exato e de graça; pedir ao modelo o que o arquivo já diz é pagar
         * para introduzir uma chance de erro. */
        if (!texto.trim() && !/\.xml$/i.test(caminho)) {
          try {
            const lido = await lerComGemini(bytes, caminho, inicio + ORCAMENTO_MS);
            if (lido) {
              semTexto++;
              marca.nome = (n as any).nome ?? lido.emitente ?? null;
              marca.cnpj = (n as any).cnpj ?? lido.cnpj ?? null;
              marca.documento = lido.numero ?? null;
              if (lido.tipo_documento) marca.tipo_documento = lido.tipo_documento;
              if (lido.data) marca.vencimento = (n as any).vencimento ?? lido.data;
              if (lido.valor != null && lido.valor > 0) {
                marca.valor = manterValor ? (valorAtual ?? lido.valor) : lido.valor;
                marca.moeda = "BRL";
                marca.valor_moeda = lido.valor;
                /* APAGA O ERRO ANTIGO. A linha carrega "PDF sem texto" da
                   rodada em que ninguém sabia ler imagem; deixá-lo faria a tela
                   mostrar um defeito ao lado de um valor que foi lido certo. */
                marca.leitura_erro = null;
                comValor++;
              } else {
                marca.leitura_erro = lido.legivel
                  ? "a IA leu o documento e não achou valor total nele"
                  : "arquivo ilegível (escuro, cortado ou sem documento)";
              }
            } else {
              marca.leitura_erro = "PDF sem texto e formato que a leitura por imagem não aceita";
            }
          } catch (e) {
            /* FALHA DE IA NÃO CARIMBA A LINHA COMO LIDA, e é o oposto do que o
               `catch` geral lá embaixo faz. Ele carimba de propósito — arquivo
               corrompido não melhora sozinho e voltaria toda rodada. Cota
               estourada e 503 do Gemini melhoram em minutos: carimbar aqui
               condenaria a nota a nunca mais ser tentada. */
            /* O DETALHE JUNTO, e não só "Falha ao consultar a IA". A mensagem
               genérica do `GeminiError` não distingue cota estourada de modelo
               que não existe de arquivo que o Gemini recusou — e são três
               consertos diferentes. O `detail` traz o corpo da resposta. */
            const g = e as { message?: string; status?: number; detail?: string };
            const msg = `leitura por imagem: ${[
              g?.message ?? String(e),
              g?.status ? `HTTP ${g.status}` : null,
              g?.detail ? String(g.detail).replace(/\s+/g, " ").slice(0, 200) : null,
            ].filter(Boolean).join(" · ")}`.slice(0, 400);
            falhas.push({ id: (n as any).id, erro: msg });
            await supabase.from("notas_externas")
              .update({ leitura_erro: msg, atualizado_em: agora })
              .eq("id", (n as any).id);
            continue;
          }
        }

        /* O MODO DE OLHAR O TEXTO. Sem ele, um valor lido errado só se descobre
           pelo casamento errado lá na frente — e aí já não dá para saber se a
           culpa foi do extrator, do regex ou do documento. */
        if (body?.debug === true) {
          return json({
            ok: true, debug: true, id: (n as any).id, caminho,
            bytes: bytes.length,
            trecho: texto.slice(0, 2500),
            lido: valorComMoeda(texto),
          });
        }

        if (!marca.valor && texto.trim()) {
          const corpo = lerCorpoDeEmail(texto, CNPJ_TAKEAT);
          marca.cnpj = (n as any).cnpj ?? corpo.cnpj ?? null;
          marca.chave_fiscal = (n as any).chave_fiscal ?? corpo.chave ?? null;
          /* A DATA E O NÚMERO ESTAVAM SENDO JOGADOS FORA. `lerCorpoDeEmail` já
             os devolvia e esta varredura só olhava CNPJ e chave.
             `vencimento` é a âncora das janelas do casador (`data_ref =
             coalesce(vencimento, enviado_em)`), e sem ele uma nota de março
             lida em agosto procura o título dela na janela de agosto. */
          if (!(n as any).vencimento && corpo.data) marca.vencimento = corpo.data;
          if (corpo.numero) marca.documento = corpo.numero;

          const vm = valorComMoeda(texto);
          if (vm) {
            marca.moeda = vm.moeda;
            marca.valor_moeda = vm.valor;
            /* FORNECEDOR DE FORA NÃO EMITE NFS-E, e o recibo dele é o
               documento. Decisão do financeiro em 27/08/2026, e o mesmo
               raciocínio de Uber/99: recusar o papel que o fornecedor emite,
               porque não é uma nota brasileira, manda alguém procurar o que não
               existe. Só `recibo` sobe — `outro` fica de fora porque ali moram
               o CREDIT_MEMO (que é devolução, não despesa) e o Order. */
            if (vm.moeda !== "BRL" && marca.tipo_documento === undefined
                && String((n as any).tipo_documento ?? "") === "recibo") {
              marca.tipo_documento = "nota";
            }
            if (vm.moeda === "BRL") {
              marca.valor = manterValor ? (valorAtual ?? vm.valor) : vm.valor;
              comValor++;
            } else {
              /* A data da NOTA é a âncora do câmbio — não a de hoje. Converter
                 uma invoice de março pela cotação de agosto erraria em 8%,
                 que é justamente a banda inteira de tolerância. */
              const dia = String((n as any).vencimento ?? (n as any).enviado_em ?? "").slice(0, 10);
              const c = dia ? await cotacao(supabase, dia, vm.moeda) : null;
              if (c) {
                const convertido = Math.round(vm.valor * c * 100) / 100;
                marca.valor = manterValor ? (valorAtual ?? convertido) : convertido;
                comValor++; emMoeda++;
              } else {
                marca.leitura_erro = `sem cotação de ${vm.moeda} para ${dia || "data desconhecida"}`;
              }
            }
          }
        }

        /* O RECADO DO XML ILEGÍVEL, escrito só agora porque só agora se sabe se
           o garimpo no texto rendeu. As duas mensagens levam a consertos
           diferentes: a primeira pede uma tag nova em `lerXmlFiscal`, a segunda
           diz que o arquivo talvez nem seja uma nota. */
        if (xmlSemLayout) {
          marca.leitura_erro = marca.valor
            ? "XML de layout não reconhecido — os campos vieram do texto, não das tags"
            : "XML de layout não reconhecido: nenhuma tag conhecida de NF-e/NFS-e neste arquivo";
        }

        /* GANHOU IDENTIDADE? É o que decide se vale recasar no fim.
           `comValor` sozinho não responde mais: desde o conserto da fila a
           leitura mais valiosa é a que traz CNPJ para uma nota que já tinha
           valor — e essa não mexe em `comValor` nenhum. Sem contar aqui, o
           casamento novo só apareceria na rodada do cron seguinte. */
        if ((!(n as any).cnpj && marca.cnpj)
            || (!(n as any).chave_fiscal && marca.chave_fiscal)
            || (marca.tipo_documento && marca.tipo_documento !== (n as any).tipo_documento)) {
          comIdentidade++;
        }

        const { error: upErr } = await supabase.from("notas_externas").update(marca).eq("id", (n as any).id);
        if (upErr) throw new Error(upErr.message);
        lidos++;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 200);
        falhas.push({ id: (n as any).id, erro: msg });
        // Carimba mesmo falhando: é o que impede a nota de voltar toda rodada.
        await supabase.from("notas_externas")
          .update({ lido_do_arquivo_em: agora, leitura_erro: msg, atualizado_em: agora })
          .eq("id", (n as any).id);
      }
    }

    if (comValor > 0 || comIdentidade > 0) {
      try { await supabase.rpc("notas_externas_casar"); } catch (_) { /* o cron :00/:30 recasa */ }
    }

    return json({
      ok: true,
      candidatas: fila.length,
      lidos, com_valor: comValor, com_identidade: comIdentidade,
      em_moeda_estrangeira: emMoeda, pdf_sem_texto: semTexto,
      falhas: falhas.slice(0, 8),
      gastou_ms: Date.now() - inicio,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("nota-ler-arquivo:", msg);
    return json({ error: msg }, 200);
  }
});
