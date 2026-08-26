// Edge Function: auditoria-conferir-comprovante
//
// Lê o comprovante que a pessoa mandou e diz se ele explica o gasto — para o
// financeiro parar de abrir PDF por PDF só para ver se o número da nota é o
// número da fatura.
//
// O QUE BATE COM A NOTA JÁ SAI APROVADO. Antes a aprovação era um segundo botão
// na tela; hoje o veredito "aprovar" muda o status na mesma gravação da leitura —
// ninguém precisa reconferir na mão o que a regra já conferiu. A trilha registra
// a mudança com o motivo escrito, então continua reversível como qualquer outra.
//
// QUATRO AÇÕES:
//   • "conferir" — baixa o arquivo, manda para o Gemini, aplica a regra, grava a
//     leitura + o veredito e, quando o veredito é "aprovar", aprova na hora.
//   • "transcrever" — lê o documento e grava SÓ a transcrição, sem julgar nada.
//     É a leitura dos achados que já foram decididos: a auditoria não precisa
//     mais deles, mas o comprovante guarda o CNPJ e a razão social do emitente,
//     que é a melhor fonte de nome que a casa tem para a Parametrização.
//   • "aplicar"  — a varredura do que já foi lido: aprova os achados que ficaram
//     com veredito "aprovar" de leituras antigas (as de antes desta mudança, ou
//     as que a gravação do status não pegou). Não chama IA nenhuma — relê o que
//     está gravado, confere que o arquivo é o mesmo que foi lido e muda o
//     status. Aprovar não custa cota, e é o que a tela dispara ao abrir.
//   • "parcelas" — o carnê: a nota conferida numa fatura resolve as parcelas da
//     mesma compra nas faturas seguintes, sem pedir comprovante de novo e sem
//     chamar IA. Ver _shared/conferencia-comprovante.ts.
//
// LÊ VÁRIOS AO MESMO TEMPO, DECIDE UM DE CADA VEZ. Ler um comprovante é quase
// tudo espera de rede — baixar o arquivo e aguardar o Gemini. Em fila indiana,
// uma fatura de doze notas custava três minutos de relógio e quatro chamadas
// encadeadas pela tela. Hoje `LARGURA` documentos ficam no ar ao mesmo tempo e a
// mesma fatura cabe numa rodada só. O que NÃO virou paralelo é o veredito: ele
// consulta e alimenta o mapa de notas já usadas, e decidir duas cobranças ao
// mesmo tempo abriria a porta para as duas aceitarem o mesmo pedaço do mesmo
// documento. Ver `emParalelo`.
//
// QUEM APROVA É A REGRA, NÃO A IA. O veredito do modelo vale como ponteiro
// ("o que foi cobrado é o total" / "é a linha Taxa de Embarque") e a conta é
// refeita em _shared/conferencia-comprovante.ts em cima do que ele mesmo
// transcreveu. Sem um número transcrito igual à cobrança, não há aprovação.
//
// COTA: com faturamento ligado no projeto do Gemini não há mais teto diário, mas
// o limite por minuto continua existindo — um 429 encerra a rodada com
// `quota_esgotada: true` em vez de estourar, e o que já foi lido fica gravado.
//
// Body:
//   { action?: "conferir" | "transcrever" | "aplicar" | "parcelas",
//     competencia?: "AAAA-MM-DD",   // a fatura da tela
//     ids?: number[],               // achados específicos (drawer / seleção)
//     limite?: number,              // teto da rodada (padrão 12, máx 40)
//     reler?: boolean,              // relê mesmo o que já tem leitura
//     simular?: boolean }           // só em "parcelas": diz o que faria, sem gravar
//
// Resposta:
//   { ok, acao, lidos, aprovados, para_revisar, restantes,
//     quota_esgotada, itens: [...], erros: [...] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";
import { generateJSON, GeminiError, DEFAULT_MODEL } from "../_shared/gemini.ts";
import { baixarDoDrive, driveConfigurado, ehHtml, extrairIdDrive } from "../_shared/drive.ts";
import {
  carneDe, chaveDocumento, conferir, outraParcelaDoCarne, parcelaDoMemo, pedacoUsado,
  type Carne, type Lancamento, type Leitura, type Veredito,
} from "../_shared/conferencia-comprovante.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "comprovantes-auditoria";

/** Status em que ainda faz sentido conferir. Aprovado/Reprovado já foi decidido. */
const STATUS_ABERTOS = ["Pendente", "Em análise", "Ajuste solicitado"];

/* O worker é derrubado com WORKER_RESOURCE_LIMIT bem antes do que a conta ingênua
   sugere: uma rodada de dez documentos morreu aos ~100s, no sétimo. Por isso são
   DOIS freios, e o relógio é o que manda — documento pesado gasta mais que
   documento leve, e contar cabeças não protege de nada.

   Nada se perde quando a rodada acaba no meio: cada leitura é gravada assim que
   sai, e o que sobrou continua na fila para o próximo "Ler mais".

   O TETO DE CABEÇAS SUBIU PORQUE A RODADA FICOU LARGA. Enquanto a leitura era uma
   de cada vez, dez era otimismo: o relógio parava a rodada no terceiro documento
   e a tela tinha de encadear quatro chamadas para uma fatura de doze notas. Com
   `LARGURA` leituras no ar ao mesmo tempo, os mesmos 75 segundos cobrem a fatura
   inteira — e o teto de cabeças volta a ser o que sempre deveria ter sido: uma
   trava contra pedido absurdo, não o limitador do dia a dia. */
const LIMITE_PADRAO = 12;
const LIMITE_MAX = 40;
const ORCAMENTO_MS = 75_000;
const MAX_BYTES = 8 * 1024 * 1024; // acima disto o base64 não cabe na chamada

/* Quantos documentos ficam no ar ao mesmo tempo.
 *
 *  Ler um comprovante é ESPERAR: o download do Drive e o Gemini respondendo são
 *  dez a quinze segundos em que o worker não faz nada além de olhar a rede. Em
 *  fila indiana, uma fatura de doze notas custava três minutos de relógio para
 *  poucos segundos de trabalho de verdade.
 *
 *  Quatro, e não quarenta, porque o freio aqui é memória: cada documento no ar
 *  segura os bytes crus (até 8 MB) mais o base64 deles. Quatro é o que cabe com
 *  folga nos 256 MB do worker mesmo no pior caso de PDFs pesados; a partir daí o
 *  ganho é pequeno e o risco de morrer no meio da rodada, não. */
const LARGURA = Math.max(1, Number(Deno.env.get("CONFERENCIA_LARGURA")) || 4);

const MIMES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp",
};

const ehUrl = (v?: string | null) => !!v && /^https?:\/\//i.test(v.trim());
const nomeDoPath = (p: string) => p.split("/").pop() || "comprovante";

function mimeDe(nome: string): string | null {
  const ext = (nome.split("?")[0].split(".").pop() || "").toLowerCase();
  return MIMES[ext] ?? null;
}

const SUPORTADOS = new Set(Object.values(MIMES));

/** O que o arquivo É, lido dos primeiros bytes.
 *
 *  Nem sempre há extensão para perguntar: o link do Drive termina em "/view" e o
 *  download responde "application/octet-stream". Sem farejar, um PDF perfeito era
 *  recusado com "não sei ler" antes de chegar ao modelo. A assinatura do arquivo
 *  não mente — quando ela responde, ganha do nome e do cabeçalho. */
function mimeDosBytes(b: Uint8Array): string | null {
  const comeca = (...xs: number[]) => xs.length <= b.length && xs.every((x, i) => b[i] === x);
  if (comeca(0x25, 0x50, 0x44, 0x46)) return "application/pdf";                    // %PDF
  if (comeca(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (comeca(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  // RIFF????WEBP — o tamanho fica nos 4 bytes do meio, que não se conferem.
  if (comeca(0x52, 0x49, 0x46, 0x46) && b.length >= 12 &&
      [0x57, 0x45, 0x42, 0x50].every((x, i) => b[8 + i] === x)) return "image/webp";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  /* O caminho nativo faz em C++ o mesmo que o laço abaixo faz em JavaScript. Num
     PDF de alguns MB isso é segundos de CPU por documento — e CPU do worker é
     justamente o recurso que derruba a rodada no meio, então economizar aqui vale
     mais do que parece. Detectado em vez de assumido: é proposta nova de
     linguagem e o Deno da hospedagem pode ser mais velho que ela. */
  const nativo = (bytes as unknown as { toBase64?: () => string }).toBase64;
  if (typeof nativo === "function") return nativo.call(bytes);

  // Em pedaços: `String.fromCharCode(...bytes)` de um PDF de 2 MB estoura a pilha.
  let bin = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    bin += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return btoa(bin);
}

/* -------------------------------------------------------------------------
 * Ler vários ao mesmo tempo, decidir um de cada vez
 * ---------------------------------------------------------------------- */

/* O `ok` existe para o TypeScript: `erro` é `unknown`, e testar a verdade dele não
   estreita união nenhuma — sem a etiqueta, `valor` chegaria a quem consome como
   "pode ser undefined" mesmo no caminho em que ele nunca é. */
type Resultado<T, R> = { item: T; ok: true; valor: R } | { item: T; ok: false; erro: unknown };

/** Roda `trabalho` sobre a fila com `largura` itens no ar e devolve os resultados
 *  NA ORDEM DA FILA.
 *
 *  A ordem não é preciosismo: o veredito consulta e alimenta o mapa de notas já
 *  usadas, e duas cobranças decididas ao mesmo tempo poderiam aceitar o mesmo
 *  pedaço do mesmo documento — exatamente o que a trava existe para pegar. Então
 *  o que vira paralelo é só a ESPERA (baixar o arquivo, aguardar o Gemini); a
 *  decisão e a gravação continuam uma de cada vez, na mesma sequência de antes.
 *
 *  `continuar` é o freio de mão: enquanto ele disser não, nenhuma leitura NOVA
 *  começa. As que já estão no ar são consumidas até o fim de propósito — a cota
 *  delas já foi gasta, e jogar a resposta fora seria pagar duas vezes pelo mesmo
 *  documento no próximo "Ler mais".
 *
 *  Erro não interrompe nada: ele vem embrulhado no resultado, no lugar do valor,
 *  para quem consome decidir o que fazer com aquele documento. */
async function* emParalelo<T, R>(
  fila: T[],
  largura: number,
  trabalho: (t: T) => Promise<R>,
  continuar: () => boolean,
): AsyncGenerator<Resultado<T, R>> {
  const prontos: Promise<Resultado<T, R>>[] = [];
  let proximo = 0;
  let noAr = 0;

  const encher = () => {
    while (noAr < largura && proximo < fila.length && continuar()) {
      const item = fila[proximo++];
      noAr++;
      prontos.push(
        trabalho(item)
          .then((valor): Resultado<T, R> => ({ item, ok: true, valor }), (erro): Resultado<T, R> => ({ item, ok: false, erro }))
          // A vaga é reposta no instante em que ESTE item termina, não quando
          // chega a vez dele de ser consumido — senão um documento lento no
          // começo da fila deixaria três vagas paradas até alguém olhar para ele.
          .then((r) => { noAr--; encher(); return r; }),
      );
    }
  };
  encher();

  // `prontos` cresce enquanto se caminha por ele: cada resultado consumido já
  // repôs a vaga (a reposição roda antes de o `await` aqui voltar).
  for (let i = 0; i < prontos.length; i++) yield await prontos[i];
}

/* -------------------------------------------------------------------------
 * O que se pede ao modelo
 * ---------------------------------------------------------------------- */

/* A ordem das propriedades importa: o modelo preenche o schema de cima para
   baixo, então tudo o que é TRANSCRIÇÃO vem antes de qualquer julgamento. Ele
   escreve o que está no papel primeiro e só depois olha para o lançamento. */
const SCHEMA = {
  type: "object",
  properties: {
    legivel: { type: "boolean" },
    tipo_documento: { type: "string" },
    emitente_nome: { type: "string" },
    emitente_cnpj: { type: "string" },
    valor_total: { type: "number" },
    valores: {
      type: "array",
      items: {
        type: "object",
        properties: { rotulo: { type: "string" }, valor: { type: "number" } },
        required: ["rotulo", "valor"],
      },
    },
    data_documento: { type: "string" },
    numero_documento: { type: "string" },
    descricao: { type: "string" },
    observacao: { type: "string" },
    parcelas_total: { type: "number" },
    parcela_numero: { type: "number" },
    fornecedor_confere: { type: "string", enum: ["sim", "nao", "incerto"] },
    fornecedor_motivo: { type: "string" },
    cobranca_explicada: { type: "string", enum: ["total", "item", "parcela", "nao"] },
    item_rotulo: { type: "string" },
  },
  required: [
    "legivel", "tipo_documento", "emitente_nome", "valor_total", "valores",
    "descricao", "fornecedor_confere", "cobranca_explicada",
  ],
};

const SISTEMA = `Você confere comprovantes de despesa de uma empresa brasileira (Takeat) contra a
cobrança que apareceu na fatura do cartão corporativo.

PRIMEIRO TRANSCREVA, DEPOIS JULGUE. Preencha os campos de transcrição olhando só para o
documento. Nunca invente um valor que não está escrito nele — se o número da cobrança não
aparece no papel, o certo é dizer que não aparece.

TRANSCRIÇÃO
- emitente_nome: quem VENDEU / PRESTOU o serviço / emitiu o documento. Nunca o comprador:
  Takeat, Takeat Tecnologia, o CNPJ 34.379.049/0001-04 e a pessoa física nomeada como
  passageiro, destinatário ou portador do cartão são o COMPRADOR. Em bilhete aéreo o
  emitente é a companhia; em fatura de plataforma, a plataforma ou o vendedor indicado nela.
- valor_total: o valor final a pagar do documento. Sem total explícito, 0.
- valores: TODO valor monetário do documento com o rótulo que o acompanha ("Tarifa",
  "Taxa de embarque", "Total", "Gorjeta", "Valor do ICMS", "Parcela 1/3"...). É por esta
  lista que se acha a parcela ou a taxa que virou uma cobrança separada na fatura.
- parcelas_total / parcela_numero: só quando o PRÓPRIO documento fala em parcelamento —
  as duplicatas da NF-e ("001 · R$ 125,66 / 002 · R$ 125,65"), o "2x de R$ 125,66" do
  recibo, "Parcela 3 de 10". Vazio quando o papel não diz nada sobre parcelas: quem
  parcelou pode ter sido a maquininha, e isso o documento não sabe.
- data_documento: emissão em AAAA-MM-DD; vazio se não houver.
- numero_documento: número da nota / do recibo / da fatura; vazio se não houver.
- descricao: uma frase curta em português dizendo o que foi comprado.
- legivel: false se estiver ilegível, cortado, ou se não for um comprovante de despesa
  (print de painel, foto de tela, conversa de WhatsApp, cardápio).

JULGAMENTO
- fornecedor_confere: "sim" quando o emitente do documento é o mesmo estabelecimento da
  cobrança. O texto da fatura vem abreviado e sujo, com maquininha e cidade no meio
  ("ZIG*Fazenda Churrasc Sao Paulo", "DM *hostingercom Lanarca", "LATAM AIR*0000V"), e a
  nota traz a razão social ("FC COMERCIO DE ALIMENTOS E BEBIDAS LTDA", "Hostinger
  International Ltd.", "TAM Linhas Aéreas S.A."). Marca, razão social e nome de fantasia
  do mesmo negócio contam como o mesmo fornecedor. Na dúvida, "incerto" — nunca "sim".
- fornecedor_motivo: uma frase curta explicando, quando não for "sim".
- cobranca_explicada: "total" se a cobrança é o valor total do documento; "item" se é uma
  das linhas dele (a fatura cobra a taxa de embarque em separado da tarifa); "parcela" se
  a cobrança é uma FRAÇÃO do total porque a compra foi dividida em vezes — o cartão cobra
  R$ 125,66 por mês de uma nota de R$ 251,31, e aí o valor cobrado não está escrito em
  lugar nenhum do papel; "nao" se o valor cobrado não aparece no documento nem como fração.
- item_rotulo: com "item", o rótulo EXATO da linha, copiado de valores.

Quando a cobrança vier marcada como parcela na fatura ("01/02" logo depois do nome do
estabelecimento), é essa a explicação a considerar primeiro: a nota é do valor CHEIO da
compra e a fatura cobra um pedaço por mês. Não invente parcelamento sem esse marcador nem
menção no documento — nesses casos o certo é "nao".

Responda apenas o JSON.`;

/* -------------------------------------------------------------------------
 * Leitura de um documento
 * ---------------------------------------------------------------------- */

/** 429 do Gemini. `porDia` separa a cota diária (acabou, volta amanhã) da cota
 *  por minuto (é só esperar um pouco e clicar de novo) — a tela diz coisas
 *  diferentes para cada uma. */
class ErroCota extends Error {
  porDia: boolean;
  constructor(detalhe: string) {
    super(detalhe);
    this.porDia = /PerDay/i.test(detalhe) || !/PerMinute/i.test(detalhe);
  }
}

/** Tropeço do serviço de IA (5xx, rede, modelo fora do ar), não do documento.
 *  A diferença decide o destino do achado: documento ruim é carimbado "revisar"
 *  e sai da fila; serviço fora do ar continua na fila para a próxima rodada —
 *  carimbar aqui seria condenar uma nota boa por causa de um soluço da Google. */
class ErroServico extends Error {}

/** O `content-type` da resposta, quando ele diz alguma coisa. "octet-stream" é o
 *  jeito do Drive de dizer "é um arquivo" — não serve, e aí valem os bytes. */
function mimeDaResposta(r: Response): string | null {
  const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return ct && ct !== "application/octet-stream" && ct !== "binary/octet-stream" ? ct : null;
}

/** Baixa o comprovante venha ele de onde vier: link do Drive, link solto ou o
 *  bucket. `mime` é o que o servidor afirmou — pode ser nulo, e aí quem decide
 *  são os bytes. */
async function baixar(
  supabase: ReturnType<typeof createClient>,
  comprovante: string,
): Promise<{ bytes: Uint8Array; nome: string; mime: string | null }> {
  /* O DRIVE PRECISA DE OUTRO ENDEREÇO. O link que a pessoa cola é o do
     VISUALIZADOR (…/file/d/<ID>/view): baixar essa URL traz o HTML da tela do
     Drive, nunca o PDF — foi o que reprovou 40 comprovantes de uma vez, com
     "o arquivo é uma página HTML" e "respondeu 403", sem nenhum byte de nota
     chegar ao modelo. O endereço do ARQUIVO é o de download, e o fetch segue
     sozinho o 303 para drive.usercontent.google.com. */
  const idDrive = extrairIdDrive(comprovante);
  if (idDrive) {
    const r = await fetch(`https://drive.google.com/uc?export=download&id=${idDrive}`);
    const bytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
    // Arquivo compartilhado por link resolve aqui, de graça e sem credencial.
    if (bytes.length && !ehHtml(bytes)) {
      return { bytes, nome: `drive-${idDrive}`, mime: mimeDaResposta(r) };
    }
    /* Só o que é restrito chega nesta linha: o Google devolve 200 com a tela de
       login. Aí é caso para o conector — que entra como rede de segurança, não
       como caminho principal, porque exige secret e o arquivo público não
       precisa de nenhum. */
    if (!driveConfigurado()) {
      throw new Error(
        r.ok
          ? "o arquivo do Drive não está compartilhado por link (o Google devolveu a tela de login) — libere o compartilhamento ou configure o conector do Drive"
          : `o link do Drive respondeu ${r.status}`,
      );
    }
    const a = await baixarDoDrive(idDrive);
    return { bytes: a.bytes, nome: a.nome, mime: a.mime || null };
  }

  if (ehUrl(comprovante)) {
    const r = await fetch(comprovante);
    if (!r.ok) throw new Error(`o link do comprovante respondeu ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { bytes, nome: nomeDoPath(new URL(comprovante).pathname), mime: mimeDaResposta(r) };
  }
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(comprovante.replace(/^\/+/, ""));
  if (error || !blob) throw new Error(`não consegui baixar o arquivo (${error?.message ?? "não encontrado"})`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), nome: nomeDoPath(comprovante), mime: null };
}

async function lerComprovante(
  supabase: ReturnType<typeof createClient>,
  comprovante: string,
  lanc: Lancamento,
): Promise<Leitura> {
  const { bytes, nome, mime: mimeDito } = await baixar(supabase, comprovante);
  if (!bytes.length) throw new Error("o arquivo está vazio");
  if (bytes.length > MAX_BYTES) throw new Error(`o arquivo tem ${(bytes.length / 1048576).toFixed(1)} MB — acima do que cabe na leitura`);
  // Página de erro do Drive salva como "comprovante.pdf" é o engano mais comum.
  if (ehHtml(bytes)) throw new Error("o arquivo é uma página HTML, não um comprovante");

  /* Os bytes primeiro: eles são o próprio arquivo. Depois o que o servidor disse,
     e só por último a extensão do nome — que é palpite, e no link do Drive nem
     existe. Mandar ao Gemini um mime que não bate com o conteúdo é erro na
     chamada, então o que sobra fora da lista é recusado aqui. */
  const mime = mimeDosBytes(bytes) ?? mimeDito ?? mimeDe(nome) ?? mimeDe(comprovante);
  if (!mime || !SUPORTADOS.has(mime)) {
    throw new Error(`não sei ler "${nome}"${mime ? ` (${mime})` : ""} — use PDF, JPG, PNG ou WEBP`);
  }

  /* O marcador de parcela vai explícito no prompt. Ele está no MEMO cru, mas
     pedir ao modelo que ache "01/02" no meio de um texto de largura fixa é pedir
     para ele errar — a conta de parcela quem faz é a regra, e o modelo só precisa
     saber que existe para não afirmar que a nota não explica o gasto. */
  const p = parcelaDoMemo(lanc.memo);
  const pergunta =
    `Cobrança a conferir:\n` +
    `- texto na fatura do cartão: ${lanc.titulo}\n` +
    `- valor cobrado: R$ ${lanc.valor.toFixed(2).replace(".", ",")}\n` +
    `- data do gasto: ${String(lanc.data).slice(0, 10)}\n` +
    (lanc.memo ? `- linha da fatura, como o banco mandou: ${lanc.memo}\n` : "") +
    (p ? `- a fatura marca esta compra como PARCELA ${p.n} de ${p.de}\n` : "") +
    `\nTranscreva o documento anexo e depois julgue.`;

  const chamar = () => generateJSON<Leitura>({
    model: DEFAULT_MODEL,
    temperature: 0,
    /* Este trabalho é TRANSCREVER, não deliberar: copiar do papel para um schema
       fechado, com a conta do valor refeita depois em TypeScript, onde ela não
       depende de opinião nenhuma. O raciocínio alto do modelo, que é o padrão
       dele, era a maior fatia do tempo de cada nota — e o texto dele ia inteiro
       para o lixo (o `extractTextFromResponse` descarta as partes `thought`).
       Se algum dia o julgamento do fornecedor piorar com isto, é aqui que se
       volta para "high" — e só aqui. */
    thinking: "low",
    responseSchema: SCHEMA,
    messages: [
      { role: "system", content: SISTEMA },
      { role: "user", content: pergunta, imagens: [{ mimeType: mime, data: toBase64(bytes) }] },
    ],
  });

  try {
    try {
      return await chamar();
    } catch (e) {
      // "This model is currently experiencing high demand" (503) passa em
      // segundos. Uma segunda tentativa cabe folgada no orçamento da rodada e
      // salva o documento de voltar para a fila por nada. Cota (429) não se
      // repete — só gastaria a requisição seguinte no mesmo erro.
      if (!(e instanceof GeminiError) || e.status === 429) throw e;
      await new Promise((r) => setTimeout(r, 2500));
      return await chamar();
    }
  } catch (e) {
    // 429 é cota (por minuto ou por dia). Não adianta insistir na mesma rodada:
    // encerra e devolve o que já foi lido, com o aviso na resposta.
    if (e instanceof GeminiError && e.status === 429) throw new ErroCota(e.detail || "cota do Gemini esgotada");
    // Qualquer outro erro do Gemini (5xx, rede, modelo fora do ar) é do serviço,
    // não do documento — a mensagem "Falha ao consultar a IA" sozinha não diz nada.
    if (e instanceof GeminiError) throw new ErroServico(`${e.message}${e.detail ? ` (${e.detail.slice(0, 160)})` : ""}`);
    throw e;
  }
}

/* -------------------------------------------------------------------------
 * Função
 * ---------------------------------------------------------------------- */

type Achado = {
  id: number; id_unico: string; titulo: string; valor: number; data_lancamento: string;
  competencia: string; responsavel: string | null; status: string;
  /** O MEMO cru da fatura — é onde vem o marcador de parcela ("01/02"). */
  descricao: string | null;
  link_comprovante: string | null; trilha: unknown;
  ia_veredito: string | null; ia_arquivo: string | null;
};

/** A linha do achado como a regra a enxerga. */
const lancDe = (r: {
  titulo?: unknown; valor?: unknown; data_lancamento?: unknown;
  descricao?: unknown; competencia?: unknown;
}): Lancamento => ({
  titulo: String(r.titulo ?? ""),
  valor: Number(r.valor ?? 0),
  data: String(r.data_lancamento ?? ""),
  memo: r.descricao ? String(r.descricao) : null,
  competencia: r.competencia ? String(r.competencia) : null,
});

/** O que a aprovação automática escreve na linha do achado.
 *
 *  Uma função só para os dois caminhos (a leitura de agora e a varredura do que
 *  já foi lido) carimbarem igual — é pela trilha que se desfaz uma aprovação, e
 *  duas versões do mesmo evento seriam duas histórias diferentes do mesmo fato. */
function patchAprovacao(
  agora: string, quem: string, de: string, motivo: string | null | undefined, trilhaAtual: unknown,
): Record<string, unknown> {
  const trilha = Array.isArray(trilhaAtual) ? trilhaAtual : [];
  return {
    status: "Aprovado",
    ia_aprovado_em: agora,
    trilha: [...trilha, {
      em: agora,
      por: quem,
      de,
      para: "Aprovado",
      tipo: "aprovacao_automatica",
      texto: `Aprovado pela conferência do comprovante: ${motivo ?? "valor e fornecedor batem com o documento"}`,
    }],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const caller = await requireUser(req, { bloquearCargos: ["parcerias"] });
    const quem = caller.email ?? (caller.isService ? "sistema" : "hub");
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const acao = String(body?.action ?? "conferir");
    const competencia = body?.competencia ? String(body.competencia) : null;
    const ids: number[] | null = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite) : null;

    if (acao !== "conferir" && acao !== "transcrever" && acao !== "aplicar" && acao !== "parcelas") {
      return json({ error: `Ação desconhecida: ${acao}` }, 200);
    }

    /* ==================== APLICAR ==================== */
    // A varredura: aprova o que já tem veredito "aprovar" e ficou para trás.
    // Sem IA, sem cota, sem reler arquivo — a tela chama isto ao abrir.
    if (acao === "aplicar") {
      let q = supabase.from("auditoria")
        .select("id, id_unico, titulo, valor, status, trilha, link_comprovante, ia_veredito, ia_arquivo, ia_motivo")
        .eq("ia_veredito", "aprovar")
        .in("status", STATUS_ABERTOS);
      if (ids?.length) q = q.in("id", ids);
      if (competencia) q = q.eq("competencia", competencia);
      const { data, error } = await q;
      if (error) throw error;

      const aprovados: unknown[] = [];
      const pulados: unknown[] = [];
      for (const r of (data ?? []) as any[]) {
        // O comprovante trocou depois da leitura: o veredito é sobre outro arquivo.
        if ((r.ia_arquivo ?? null) !== (r.link_comprovante ?? null)) {
          pulados.push({ id: r.id, titulo: r.titulo, motivo: "o comprovante mudou depois da conferência — confira de novo" });
          continue;
        }
        const agora = new Date().toISOString();
        const { error: uErr } = await supabase.from("auditoria").update({
          ...patchAprovacao(agora, quem, r.status, r.ia_motivo, r.trilha),
          updated_at: agora,
        }).eq("id", r.id);
        if (uErr) pulados.push({ id: r.id, titulo: r.titulo, motivo: uErr.message });
        else aprovados.push({ id: r.id, id_unico: r.id_unico, titulo: r.titulo, valor: Number(r.valor) });
      }
      return json({ ok: true, acao, aprovados: aprovados.length, itens: aprovados, pulados });
    }

    /* ==================== PARCELAS (o carnê) ==================== */
    /* A nota conferida na fatura de agosto explica a parcela que chega em
       setembro. Sem isto, a Central de Aviamentos volta para "SEM NF" todo mês e
       alguém tem de reanexar a MESMA nota — a compra é uma só.

       Custo zero: nenhuma leitura nova, nenhuma chamada de IA. Lê o que já está
       gravado, casa pelo marcador da fatura e resolve. */
    if (acao === "parcelas") {
      const simular = body?.simular === true;
      const pulados: unknown[] = [];
      const { data: lidos, error: eLidos } = await supabase.from("auditoria")
        .select("id, id_unico, titulo, valor, data_lancamento, competencia, descricao, status, trilha, link_comprovante, ia_leitura, ia_veredito, ia_motivo, ia_arquivo")
        .not("ia_leitura", "is", null)
        .not("descricao", "is", null)
        // Da fatura mais nova para trás — é o que mantém a consulta longe do teto
        // de 1000 linhas que o PostgREST aplica calado.
        .order("competencia", { ascending: false })
        .limit(1000);
      if (eLidos) throw eLidos;

      /* 1) RECARIMBAR: o documento é o mesmo, a regra é que mudou.
         As notas da Central de Aviamentos e os bilhetes parcelados da GOL/LATAM
         já estavam lidos e gravados com "a cobrança não aparece no documento" —
         a frase que a regra antiga sabia dizer. Reler custaria cota para chegar à
         MESMA transcrição, então aqui só se refaz a conta em cima do que está
         guardado. Quem passa a bater sai aprovado na hora, como qualquer leitura.

         Só vale para linha com marcador de parcela: é a população que esta
         mudança atinge, e recarimbar o resto seria mexer no que ninguém pediu. */
      const recarimbados: unknown[] = [];
      /* Leitura de transcrição fica de fora: ela foi gravada SEM veredito, só para
         a Parametrização aproveitar o emitente. Deixá-la entrar aqui faria um
         documento que ninguém conferiu recarimbar veredito e, pior, virar fonte de
         carnê para aprovar as parcelas seguintes de outros lançamentos. */
      const comMarcador = ((lidos ?? []) as any[]).filter(
        (r) => !!parcelaDoMemo(r.descricao) && !(r.ia_leitura as Leitura | null)?.transcricao_apenas,
      );
      for (const r of comMarcador) {
        if (!r.link_comprovante || r.ia_arquivo !== r.link_comprovante) continue;
        const v = conferir(lancDe(r), r.ia_leitura as Leitura);
        if (v.veredito === r.ia_veredito && v.motivo === r.ia_motivo) continue;

        const aprova = v.veredito === "aprovar" && STATUS_ABERTOS.includes(r.status);
        const agora = new Date().toISOString();
        if (!simular) {
          const { error: uErr } = await supabase.from("auditoria").update({
            ia_veredito: v.veredito,
            ia_motivo: v.motivo,
            updated_at: agora,
            ...(aprova ? patchAprovacao(agora, quem, r.status, v.motivo, r.trilha) : {}),
          }).eq("id", r.id);
          if (uErr) { pulados.push({ id: r.id, titulo: r.titulo, motivo: uErr.message }); continue; }
        }
        // O que a varredura de carnês vê logo abaixo é o veredito NOVO.
        r.ia_veredito = v.veredito;
        r.ia_motivo = v.motivo;
        if (aprova) r.status = "Aprovado";
        recarimbados.push({
          id: r.id, id_unico: r.id_unico, titulo: r.titulo, valor: Number(r.valor ?? 0),
          competencia: r.competencia, veredito: v.veredito, motivo: v.motivo, aprovado: aprova,
        });
      }

      // 2) Os carnês: tudo que foi conferido POR PARCELA e está de pé — aprovado
      //    pela regra ou pela pessoa, com a leitura ainda valendo para o arquivo
      //    que está anexado.
      type Fonte = { carne: Carne; row: any };
      const carnes: Fonte[] = [];
      for (const r of comMarcador) {
        if (r.status !== "Aprovado" && r.ia_veredito !== "aprovar") continue;
        if (!r.link_comprovante || r.ia_arquivo !== r.link_comprovante) continue;
        const carne = carneDe(lancDe(r), r.ia_leitura as Leitura);
        if (carne) carnes.push({ carne, row: r });
      }

      // 2) Os alvos: achados em aberto, SEM comprovante próprio. Quem já tem nota
      //    anexada segue pela conferência normal — ler o documento que a pessoa
      //    mandou é sempre melhor do que herdar o do mês passado.
      let qa = supabase.from("auditoria")
        .select("id, id_unico, titulo, valor, data_lancamento, competencia, descricao, status, trilha, categoria")
        .in("status", STATUS_ABERTOS)
        .is("link_comprovante", null)
        .not("descricao", "is", null)
        // Da fatura mais nova para trás: é nela que a parcela seguinte chega, e é
        // ela que fica dentro do teto de 1000 linhas do PostgREST.
        .order("competencia", { ascending: false })
        .limit(1000);
      if (competencia) qa = qa.eq("competencia", competencia);
      if (ids?.length) qa = qa.in("id", ids);
      const { data: abertos, error: eAbertos } = await qa;
      if (eAbertos) throw eAbertos;

      const resolvidos: unknown[] = [];
      /* Uma parcela pertence a UM carnê. Duas notas que disputam a mesma cobrança
         é sinal de que a chave não separou o que devia — nesse caso ninguém
         resolve nada e a linha fica para o olho humano. */
      for (const a of (abertos ?? []) as any[]) {
        const alvo = lancDe(a);
        const candidatos = carnes
          .map((f) => ({ f, p: outraParcelaDoCarne(f.carne, alvo) }))
          .filter((c) => c.p !== null);
        if (!candidatos.length) continue;
        if (candidatos.length > 1) {
          pulados.push({ id: a.id, titulo: a.titulo, motivo: `${candidatos.length} notas conferidas disputam esta parcela — resolva na mão` });
          continue;
        }

        const { f, p } = candidatos[0];
        const leitura = f.row.ia_leitura as Leitura;
        const doc = [leitura?.tipo_documento, leitura?.numero_documento && `nº ${leitura.numero_documento}`]
          .filter(Boolean).join(" ") || "o documento";
        const motivo =
          `Parcela ${p!.n}/${p!.de} da compra em ${leitura?.emitente_nome || f.row.titulo}: ` +
          `${doc}, de R$ ${Number(leitura?.valor_total ?? 0).toFixed(2).replace(".", ",")}, ` +
          `já foi conferido na fatura de ${String(f.carne.competencia).slice(0, 7)} (parcela ${f.carne.parcela.n}/${f.carne.parcela.de}).`;

        const agora = new Date().toISOString();
        // `simular` devolve o que a varredura FARIA, sem gravar. É como se
        // confere uma regra que aprova sozinha antes de deixá-la solta.
        const { error: uErr } = simular ? { error: null } : await supabase.from("auditoria").update({
          // O mesmo arquivo, sem cópia: o comprovante mora no bucket e as duas
          // parcelas apontam para ele. `ia_arquivo` acompanha, senão a tela trata
          // a leitura como velha e esconde o que acabou de decidir.
          link_comprovante: f.row.link_comprovante,
          categoria: "COM NF",
          ia_leitura: leitura as unknown as Record<string, unknown>,
          ia_veredito: "aprovar",
          ia_motivo: motivo,
          ia_conferido_em: agora,
          ia_arquivo: f.row.link_comprovante,
          updated_at: agora,
          ...patchAprovacao(agora, quem, a.status, motivo, a.trilha),
        }).eq("id", a.id);
        if (uErr) { pulados.push({ id: a.id, titulo: a.titulo, motivo: uErr.message }); continue; }

        resolvidos.push({
          id: a.id, id_unico: a.id_unico, titulo: a.titulo, valor: Number(a.valor ?? 0),
          competencia: a.competencia, parcela: `${p!.n}/${p!.de}`, motivo,
          origem: { id: f.row.id, id_unico: f.row.id_unico, competencia: f.carne.competencia },
        });
      }

      return json({
        ok: true, acao, simulado: simular,
        carnes: carnes.length,
        recarimbados: recarimbados.length,
        reavaliados: recarimbados,
        resolvidos: resolvidos.length, itens: resolvidos, pulados,
      });
    }

    /* ==================== TRANSCREVER ==================== */
    /* Ler o documento sem julgar: grava a transcrição e mais nada.

       POR QUE NÃO DÁ PARA USAR "conferir": ele só enxerga STATUS_ABERTOS, e dos 59
       comprovantes anexados que nunca foram lidos, 57 já estão Aprovado (medido em
       20/08/2026). O filtro de lá está certo e não é para afrouxar — `patchAprovacao`
       roda sempre que o veredito sai "aprovar", então reler uma linha decidida
       reescreveria a trilha e viraria Reprovado em Aprovado sem ninguém pedir.

       PARA QUE SERVE ENTÃO: o comprovante traz o CNPJ e a razão social de quem
       vendeu, e essa é a melhor fonte de nome que a casa tem para os lojistas de
       cartão da fila da Parametrização — onde o extrato só entrega "JIM.COM GRUPO
       SOUZA". A auditoria já não precisa desses documentos; a Parametrização precisa.
       O CNPJ é a única chave que entra sozinha lá (migration 20260813120000).

       O QUE NUNCA TOCA: status, ia_veredito, ia_motivo, trilha, categoria. A leitura
       sai marcada com `transcricao_apenas` para o resto da função saber que atrás
       dela não há veredito — é o que impede uma transcrição de aprovar parcela ou
       trancar nota repetida. */
    if (acao === "transcrever") {
      if (!Deno.env.get("GEMINI_API_KEY")) {
        return json({ error: "GEMINI_API_KEY não configurada nas variáveis da função." }, 200);
      }

      const limite = Math.min(Math.max(1, Number(body?.limite) || LIMITE_PADRAO), LIMITE_MAX);
      const reler = body?.reler === true;

      let q = supabase.from("auditoria")
        .select("id, id_unico, titulo, valor, data_lancamento, competencia, descricao, responsavel, status, link_comprovante, ia_leitura, ia_arquivo")
        .not("link_comprovante", "is", null)
        // Sem filtro de status: é justamente o decidido que interessa aqui. Da
        // fatura mais nova para trás e com teto, porque o PostgREST corta em 1000
        // linhas calado e a ordem é o que decide quem fica de fora.
        .order("data_lancamento", { ascending: false })
        .limit(1000);
      if (competencia) q = q.eq("competencia", competencia);
      if (ids?.length) q = q.in("id", ids);
      const { data, error } = await q;
      if (error) throw error;

      const abrivel = (v: string | null) => !!v && (ehUrl(v) || v.includes("/"));
      const todos = ((data ?? []) as any[]).filter((r) => abrivel(r.link_comprovante));
      /* A fila é "este arquivo aqui nunca foi tentado". `ia_arquivo` já é o carimbo
         de qual anexo foi lido por último, então ele serve de fila sem campo novo:
         quem foi lido sai, quem falhou também sai (o carimbo é gravado no erro), e
         trocar o anexo devolve a linha para cá sozinha. O `!ia_leitura` protege as
         leituras antigas — de antes de `ia_arquivo` existir — de serem relidas à toa. */
      const fila = reler ? todos : todos.filter((r) => !r.ia_leitura && r.ia_arquivo !== r.link_comprovante);
      const rodada = fila.slice(0, limite);

      const itens: unknown[] = [];
      const erros: unknown[] = [];
      let quotaEsgotada = false;
      let quotaPorDia = false;
      let tempoEsgotado = false;
      let lidos = 0;
      const comecou = Date.now();

      /* Mesmo freio de relógio do "conferir": o worker morre bem antes do que a
         conta ingênua sugere, e o que já foi gravado não se perde. O freio vale
         para COMEÇAR leitura nova — o que já está no ar é consumido até o fim. */
      const podeComecar = () => {
        if (quotaEsgotada) return false;
        if (Date.now() - comecou > ORCAMENTO_MS) { tempoEsgotado = true; return false; }
        return true;
      };

      for await (const res of emParalelo(
        rodada, LARGURA, (r: any) => lerComprovante(supabase, r.link_comprovante!, lancDe(r)), podeComecar,
      )) {
        const r = res.item;
        const agora = new Date().toISOString();
        let leitura: Leitura;
        if (res.ok) {
          leitura = res.valor;
          lidos++;
        } else {
          const e = res.erro;
          // Cota estourada só fecha a torneira: as leituras que já estavam no ar
          // continuam sendo gravadas, porque elas já foram pagas.
          if (e instanceof ErroCota) { quotaEsgotada = true; quotaPorDia = e.porDia; continue; }
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`transcrição falhou · ${r.id_unico} · ${msg}`);
          erros.push({ id: r.id, id_unico: r.id_unico, titulo: r.titulo, erro: msg, transitorio: e instanceof ErroServico });
          /* Tropeço do serviço de IA continua na fila e tenta de novo. Documento
             ruim sai dela carimbando SÓ o arquivo: o "revisar" que o `conferir`
             escreveria é veredito de auditoria, e esta ação não emite veredito nem
             para dizer que o PDF está quebrado. */
          if (e instanceof ErroServico) continue;
          await supabase.from("auditoria").update({
            ia_arquivo: r.link_comprovante,
            ia_conferido_em: agora,
            updated_at: agora,
          }).eq("id", r.id);
          continue;
        }

        const { error: uErr } = await supabase.from("auditoria").update({
          ia_leitura: { ...leitura, transcricao_apenas: true } as unknown as Record<string, unknown>,
          ia_arquivo: r.link_comprovante,
          ia_conferido_em: agora,
          updated_at: agora,
        }).eq("id", r.id);
        if (uErr) { erros.push({ id: r.id, id_unico: r.id_unico, titulo: r.titulo, erro: uErr.message }); continue; }

        itens.push({
          id: r.id, id_unico: r.id_unico, titulo: r.titulo, valor: Number(r.valor ?? 0),
          data: r.data_lancamento, competencia: r.competencia, status: r.status,
          legivel: leitura.legivel !== false,
          emitente: leitura.emitente_nome,
          emitente_cnpj: leitura.emitente_cnpj ?? null,
          tipo_documento: leitura.tipo_documento,
          numero_documento: leitura.numero_documento ?? null,
          valor_documento: leitura.valor_total,
          descricao: leitura.descricao,
        });
      }

      return json({
        ok: true,
        acao,
        modelo: DEFAULT_MODEL,
        lidos,
        // É por este número que se decide se a fonte nova da Parametrização vale a
        // migration: sem CNPJ, a evidência não entra sozinha e vira só proposta.
        com_cnpj: itens.filter((i: any) => !!i.emitente_cnpj).length,
        restantes: Math.max(0, fila.length - lidos - erros.filter((e: any) => !e.transitorio).length),
        quota_esgotada: quotaEsgotada,
        quota_por_dia: quotaPorDia,
        tempo_esgotado: tempoEsgotado,
        itens,
        erros,
      });
    }

    /* ==================== CONFERIR ==================== */
    if (!Deno.env.get("GEMINI_API_KEY")) {
      return json({ error: "GEMINI_API_KEY não configurada nas variáveis da função." }, 200);
    }

    const limite = Math.min(Math.max(1, Number(body?.limite) || LIMITE_PADRAO), LIMITE_MAX);
    const reler = body?.reler === true;

    let q = supabase.from("auditoria")
      .select("id, id_unico, titulo, valor, data_lancamento, competencia, descricao, responsavel, status, link_comprovante, trilha, ia_veredito, ia_arquivo")
      .not("link_comprovante", "is", null)
      .in("status", STATUS_ABERTOS)
      .order("data_lancamento", { ascending: false });
    if (competencia) q = q.eq("competencia", competencia);
    if (ids?.length) q = q.in("id", ids);
    const { data, error } = await q;
    if (error) throw error;

    // Um nome solto ("nota.pdf") não é caminho nem URL: não dá para buscar nada.
    const abrivel = (v: string | null) => !!v && (ehUrl(v) || v.includes("/"));
    const todos = ((data ?? []) as unknown as Achado[]).filter((r) => abrivel(r.link_comprovante));
    // Sem `reler`, pula o que já tem leitura DO MESMO arquivo. Trocou o
    // comprovante, a leitura velha não vale e ele volta para a fila.
    const fila = reler ? todos : todos.filter((r) => !r.ia_veredito || r.ia_arquivo !== r.link_comprovante);
    const rodada = fila.slice(0, limite);

    /* Notas já usadas por um gasto aprovado. A mesma nota explicando dois
       lançamentos é achado, não aprovação — e é justamente o que a auditoria
       existe para pegar. Quatro recibos de R$ 53,96 da GOL são quatro
       passageiros e têm números diferentes; a chave é emitente + número + total.

       O QUE SE TRANCA É O PEDAÇO, NÃO O PAPEL. Uma nota de R$ 251,31 cobrada em
       2× explica duas cobranças de propósito, uma por fatura; o bilhete da GOL
       explica a taxa de embarque numa linha da fatura e a tarifa parcelada em
       outra, no mesmo mês. Por isso a chave leva também qual parte do documento
       cada cobrança consumiu (`pedacoUsado`) — repetir o pedaço é reaproveitar a
       nota; usar outra parte dela não é.

       DISPARADA AGORA, ESPERADA DEPOIS. São até mil linhas com o JSON da leitura
       inteira dentro, e o mapa só faz falta na hora do primeiro VEREDITO — que é
       segundos depois, quando a primeira nota volta do Gemini. Esperando por ela
       aqui, a consulta era tempo morto somado a cada rodada; disparada aqui e
       aguardada lá embaixo, ela acontece enquanto os documentos baixam. */
    type Dono = { id: number; titulo: string };
    const usadasP: Promise<Map<string, Dono>> = (async () => {
      const { data: jaUsadas } = await supabase.from("auditoria")
        .select("id, titulo, valor, data_lancamento, competencia, descricao, ia_leitura")
        .not("ia_leitura", "is", null)
        .eq("status", "Aprovado");
      const m = new Map<string, Dono>();
      for (const r of (jaUsadas ?? []) as any[]) {
        /* Transcrição não tranca nota repetida. Ela enche `ia_leitura` de achados
           antigos que ninguém conferiu, e um documento lido por esse caminho passaria
           a bloquear a aprovação de outro gasto sem que exista veredito por trás.
           Para a trava enxergar também os transcritos, é tirar esta linha — e aí a
           checagem de nota repetida passa a valer para o histórico inteiro. */
        if ((r.ia_leitura as Leitura | null)?.transcricao_apenas) continue;
        const k = r.ia_leitura ? chaveDocumento(r.ia_leitura as Leitura) : null;
        if (!k) continue;
        const kk = `${k}|${pedacoUsado(lancDe(r), r.ia_leitura as Leitura)}`;
        if (!m.has(kk)) m.set(kk, { id: r.id, titulo: r.titulo });
      }
      return m;
    })();
    /* Sem este ouvinte, uma rodada em que NENHUM veredito sai "aprovar" nunca
       aguarda a promessa — e uma falha de rede nela viraria "unhandled rejection",
       que no Deno derruba o worker inteiro. O `await` lá embaixo continua
       levantando o erro normalmente quando a promessa é de fato usada. */
    usadasP.catch(() => {});
    let usadas: Map<string, Dono> | null = null;

    const itens: unknown[] = [];
    const erros: unknown[] = [];
    let quotaEsgotada = false;
    let quotaPorDia = false;
    let lidos = 0;
    let tempoEsgotado = false;
    const comecou = Date.now();

    /* Não começa o que não dá tempo de terminar: o worker morto no meio de uma
       leitura devolve erro de infra, e a tela fica sem o resumo do que já saiu.
       O freio vale para COMEÇAR — o que já está no ar segue até o fim, porque a
       cota dele já foi gasta e a leitura ainda vai ser gravada. */
    const podeComecar = () => {
      if (quotaEsgotada) return false;
      if (Date.now() - comecou > ORCAMENTO_MS) { tempoEsgotado = true; return false; }
      return true;
    };

    for await (const res of emParalelo(
      rodada, LARGURA, (r: Achado) => lerComprovante(supabase, r.link_comprovante!, lancDe(r)), podeComecar,
    )) {
      const r = res.item;
      const lanc = lancDe(r);
      let leitura: Leitura;
      if (res.ok) {
        leitura = res.valor;
        lidos++;
      } else {
        const e = res.erro;
        // Cota estourada fecha a torneira e pronto: o que já voltou do Gemini
        // continua sendo julgado e gravado, porque já foi pago.
        if (e instanceof ErroCota) { quotaEsgotada = true; quotaPorDia = e.porDia; continue; }
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`conferência falhou · ${r.id_unico} · ${msg}`);
        erros.push({ id: r.id, id_unico: r.id_unico, titulo: r.titulo, erro: msg, transitorio: e instanceof ErroServico });
        /* Documento ruim (não baixa, não é PDF/imagem, é página de erro do
           Drive) é carimbado "revisar" e SAI da fila. Sem isto ele continua na
           frente — a fila é ordenada por data — e todo "Ler mais" tropeça no
           mesmo arquivo quebrado, sem nunca alcançar os de baixo. Trocado o
           anexo, `ia_arquivo` muda e ele volta sozinho.

           Tropeço do serviço de IA não carimba nada: fica na fila e tenta de
           novo na próxima rodada. */
        if (e instanceof ErroServico) continue;
        const agoraErr = new Date().toISOString();
        await supabase.from("auditoria").update({
          ia_leitura: null,
          ia_veredito: "revisar",
          ia_motivo: `Não consegui ler o comprovante: ${msg}.`,
          ia_conferido_em: agoraErr,
          ia_arquivo: r.link_comprovante,
          updated_at: agoraErr,
        }).eq("id", r.id);
        continue;
      }

      let v: Veredito = conferir(lanc, leitura);

      /* Documento já usado em outro gasto aprovado PARA A MESMA PARTE derruba a
         aprovação automática. Parcelas diferentes da mesma compra e linhas
         diferentes do mesmo bilhete são pedaços distintos e passam. */
      if (v.veredito === "aprovar") {
        // Aqui é onde o mapa disparado lá em cima faz falta pela primeira vez —
        // a esta altura ele já chegou, e esperar por ele não custa nada.
        usadas ??= await usadasP;
        const k = chaveDocumento(leitura);
        const kk = k ? `${k}|${pedacoUsado(lanc, leitura, v)}` : null;
        const dono = kk ? usadas.get(kk) : undefined;
        if (dono && dono.id !== r.id) {
          v = { ...v, veredito: "revisar", motivo: `Este mesmo documento já foi aceito no lançamento "${dono.titulo}".` };
        } else if (kk && !dono) {
          // Trava o pedaço dentro da própria rodada: quatro parcelas da mesma
          // compra lidas de uma vez continuam passando, a mesma duas vezes não.
          usadas.set(kk, { id: r.id, titulo: r.titulo });
        }
      }

      /* Bateu com a nota, já sai aprovado: a leitura e a mudança de status saem
         na MESMA gravação. Em dois updates, um worker derrubado no meio deixaria
         o achado com o selo verde e o status velho — exatamente a fila que esta
         mudança veio acabar. */
      const agora = new Date().toISOString();
      const aprova = v.veredito === "aprovar";
      const { error: uErr } = await supabase.from("auditoria").update({
        ia_leitura: leitura as unknown as Record<string, unknown>,
        ia_veredito: v.veredito,
        ia_motivo: v.motivo,
        ia_conferido_em: agora,
        ia_arquivo: r.link_comprovante,
        updated_at: agora,
        ...(aprova ? patchAprovacao(agora, quem, r.status, v.motivo, r.trilha) : {}),
      }).eq("id", r.id);
      if (uErr) erros.push({ id: r.id, id_unico: r.id_unico, titulo: r.titulo, erro: uErr.message });
      // Só conta como aprovado o que a gravação aceitou — senão a tela anuncia
      // uma aprovação que não está no banco.
      const aprovado = aprova && !uErr;

      itens.push({
        id: r.id, id_unico: r.id_unico, titulo: r.titulo, valor: Number(r.valor ?? 0),
        data: r.data_lancamento, responsavel: r.responsavel,
        status: aprovado ? "Aprovado" : r.status, aprovado,
        veredito: v.veredito, motivo: v.motivo, como: v.como,
        valor_casado: v.valor_casado, item_rotulo: v.item_rotulo,
        parcela: v.parcela ? `${v.parcela.n}/${v.parcela.de}` : null,
        emitente: leitura.emitente_nome, emitente_cnpj: leitura.emitente_cnpj ?? null,
        tipo_documento: leitura.tipo_documento, valor_documento: leitura.valor_total,
        data_documento: leitura.data_documento ?? null,
        numero_documento: leitura.numero_documento ?? null,
        descricao: leitura.descricao,
      });
    }

    const aprovados = itens.filter((i: any) => i.aprovado).length;
    return json({
      ok: true,
      acao,
      modelo: DEFAULT_MODEL,
      lidos,
      aprovados,
      para_revisar: itens.length - aprovados,
      // Quanto ainda falta ler depois desta rodada. Documento ruim já saiu da
      // fila (foi carimbado "revisar"); tropeço do serviço continua nela.
      restantes: Math.max(0, fila.length - lidos - erros.filter((e: any) => !e.transitorio).length),
      quota_esgotada: quotaEsgotada,
      quota_por_dia: quotaPorDia,
      tempo_esgotado: tempoEsgotado,
      itens,
      erros,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
