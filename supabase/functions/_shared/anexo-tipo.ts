/**
 * Que arquivo é este, de verdade — e o que fazer com ele antes de mandar ao Omie.
 *
 * Módulo separado e SEM DEPENDÊNCIA NENHUMA de propósito: é a única parte da
 * conversa com o Omie que dá para provar sem falar com o Omie. Roda igual no
 * Deno da Edge Function e no vitest do repo (ver anexo-tipo.test.ts).
 *
 * DUAS COISAS ESTAVAM ERRADAS, E A SEGUNDA CORROMPIA ARQUIVO EM SILÊNCIO.
 *
 *   1. A extensão vinha do NOME. Um comprovante que o WhatsApp salvou como
 *      "IMG-20260812-WA0007.jpeg" é JPEG; um que alguém renomeou para "nota.pdf"
 *      continua sendo JPEG. Extensão é palpite; os primeiros bytes são fato.
 *
 *   2. O tradutor de extensão devolvia "pdf" para o que não conhecia — só o
 *      NOME, não o conteúdo. Uma foto .webp virava "foto.pdf" com bytes de WebP
 *      dentro: o Omie aceitava, a varredura contava o anexo como presente, e
 *      nenhum leitor de PDF abria aquilo. Anexo que passa por documento e não é
 *      um documento é pior que anexo nenhum — some da lista do que falta.
 */

/**
 * Extensões que o Omie tem cadastradas como tipo de anexo. Fora disto ele recusa.
 *
 * ATENÇÃO: `jpg` e `png` estão aqui para NOMEAR o arquivo, não porque esta conta
 * os aceite. Medido em 25/08/2026, contra a conta de produção:
 *
 *     Omie IncluirAnexo [500]: ERROR: Tipo de Anexo não cadastrado para o Código [jpg] !
 *
 * As duas notas de agosto que estavam paradas na fila eram fotos (`.jpg` do
 * WhatsApp), e falhavam em TODA rodada do cron desde que foram anexadas — sem
 * aparecer em lugar nenhum além do console do worker. É por isso que a conversão
 * para PDF é o caminho PADRÃO e não um enfeite: nesta conta, imagem não sobe.
 */
export const EXT_ANEXO: Record<string, string> = {
  pdf: "pdf", jpg: "jpg", jpeg: "jpg", jfif: "jpg", png: "png",
  xml: "xml", txt: "txt", doc: "doc", docx: "docx", xls: "xls", xlsx: "xlsx", zip: "zip",
};

/** O que a conta do Omie aceita DE VERDADE — medido, não suposto (ver acima). */
export const ACEITO_PELO_OMIE = new Set(["pdf", "xml", "txt", "doc", "docx", "xls", "xlsx", "zip"]);

/** A extensão declarada no nome, normalizada. Sem ponto no nome, assume pdf. */
export const extDe = (nome: string): string =>
  (String(nome ?? "").includes(".") ? String(nome).split(".").pop()! : "pdf")
    .toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";

/** Imagem que o pdf-lib embute sem decodificar pixel — e portanto sem perda. */
export const IMAGEM_EMBUTIVEL = new Set(["jpg", "png"]);
/** Imagem que reconhecemos mas não sabemos converter dentro da Edge Function. */
export const IMAGEM_SEM_CONVERSOR = new Set(["webp", "heic", "gif", "bmp", "tiff"]);

/**
 * O tipo real, lido dos primeiros bytes. `null` quando não reconhecemos.
 *
 * Não reconhecer não é o mesmo que recusar: um .docx legítimo cai aqui como
 * "zip" (Office é zip por dentro) e um .txt cai como null — quem chama decide.
 */
export function tipoRealDoArquivo(bytes: Uint8Array): string | null {
  const b = bytes;
  if (!b || b.length < 4) return null;

  const casa = (pos: number, ...bs: number[]) => bs.every((x, i) => b[pos + i] === x);
  const ascii = (pos: number, s: string) => [...s].every((c, i) => b[pos + i] === c.charCodeAt(0));

  if (ascii(0, "%PDF")) return "pdf";
  if (casa(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (casa(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (casa(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (casa(0, 0x42, 0x4d)) return "bmp";
  if (casa(0, 0x49, 0x49, 0x2a, 0x00) || casa(0, 0x4d, 0x4d, 0x00, 0x2a)) return "tiff";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  // ftypheic / ftypheix / ftypmif1 / ftyphevc — HEIC e HEIF do iPhone
  if (ascii(4, "ftyp") && (ascii(8, "heic") || ascii(8, "heix") || ascii(8, "mif1") || ascii(8, "hevc"))) return "heic";
  if (casa(0, 0x50, 0x4b, 0x03, 0x04)) return "zip";

  // XML/SVG/HTML: BOM e espaço em branco antes do '<' são comuns em arquivo de
  // nota. Só olha o começo — decodificar o arquivo inteiro para farejar é caro.
  const inicio = new TextDecoder().decode(b.subarray(0, 200)).replace(/^﻿/, "").trimStart();
  if (inicio.startsWith("<?xml") || /^<[A-Za-z]/.test(inicio)) return "xml";

  return null;
}

export type PlanoDeAnexo =
  | { acao: "converter_para_pdf"; tipoOrigem: string; tipoFinal: "pdf" }
  | { acao: "manter"; tipoFinal: string; corrigiuExtensao: boolean }
  | { acao: "recusar"; motivo: string };

/**
 * O que fazer com este arquivo, decidido só pelo tipo real e pelo nome.
 *
 * Separado da execução porque é aqui que mora a regra — e regra que só existe
 * dentro de um `try` contra API de terceiro não dá para conferir.
 */
export function planoDeAnexo(
  tipoReal: string | null,
  nome: string,
  opts: { converterImagem?: boolean } = {},
): PlanoDeAnexo {
  const converter = opts.converterImagem !== false;
  const declarado = extDe(nome);

  if (!tipoReal) {
    // Não farejamos, mas a extensão declarada é aceita: seguimos com ela. Recusar
    // um .docx ou um .txt legítimo por não sabermos farejá-lo trocaria um
    // problema por outro.
    if (EXT_ANEXO[declarado]) {
      return { acao: "manter", tipoFinal: EXT_ANEXO[declarado], corrigiuExtensao: false };
    }
    return {
      acao: "recusar",
      motivo: `Não deu para identificar o tipo do arquivo "${nome}" e a extensão não é aceita pelo Omie. ` +
              "Converta para PDF antes de anexar.",
    };
  }

  if (IMAGEM_SEM_CONVERSOR.has(tipoReal)) {
    return {
      acao: "recusar",
      motivo: `O arquivo é ${tipoReal.toUpperCase()}, formato que o Omie não aceita e que não sabemos converter aqui. ` +
              "Salve como JPEG, PNG ou PDF e anexe de novo. " +
              "(Foto de iPhone costuma ser HEIC: compartilhar pelo WhatsApp ou exportar como JPEG resolve.)",
    };
  }

  if (IMAGEM_EMBUTIVEL.has(tipoReal)) {
    // Converter é o único caminho que FUNCIONA nesta conta (ver EXT_ANEXO).
    // `converterImagem: false` existe para diagnóstico e sabe o que está pedindo.
    if (converter) return { acao: "converter_para_pdf", tipoOrigem: tipoReal, tipoFinal: "pdf" };
    return { acao: "manter", tipoFinal: EXT_ANEXO[tipoReal], corrigiuExtensao: EXT_ANEXO[tipoReal] !== EXT_ANEXO[declarado] };
  }

  const tipoFinal = EXT_ANEXO[tipoReal];
  if (!tipoFinal || !ACEITO_PELO_OMIE.has(tipoFinal)) {
    return {
      acao: "recusar",
      motivo: `O Omie não tem tipo de anexo cadastrado para arquivos ${tipoReal.toUpperCase()}.`,
    };
  }
  return { acao: "manter", tipoFinal, corrigiuExtensao: tipoFinal !== EXT_ANEXO[declarado] };
}

/**
 * O nome com que o arquivo entra no zip e na tag cNomeArquivo.
 *
 * DUAS RECUSAS REAIS do Omie, as duas resolvidas aqui:
 *   • "O arquivo [X] não foi encontrado no arquivo zip encaminhado" — o unzip DELES não
 *     acha a entrada quando o nome tem acento ou espaço ("Recibo do bilhete eletrônico,
 *     29 Junho para FULANO.pdf"). O zip guarda em UTF-8; eles leem noutra tabela.
 *   • "Tipo de Anexo não cadastrado para o Código [...]" — extensão fora da lista deles.
 *
 * O nome bonito continua valendo do nosso lado: é o que gravamos em `omie_anexo_nome`.
 */
export function nomeSeguroParaOmie(nome: string): string {
  const ext = EXT_ANEXO[extDe(nome)] ?? "pdf";
  const base = String(nome ?? "")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 60) || "comprovante";
  return `${base}.${ext}`;
}

/**
 * O anexo parece mesmo uma nota fiscal, pelo nome?
 *
 * Separa "tem arquivo" de "tem a nota certa" — mas só acende a luz onde há
 * motivo. A primeira versão desta função presumia culpa: qualquer nome que não
 * tivesse "nota"/"nf"/"recibo" virava suspeito, e 89 dos 356 anexos lidos foram
 * acusados. Olhando a lista, quase todos eram legítimos:
 *
 *   32013082242514815000139000000000000426080549719853.pdf  ← chave de NF-e!
 *   Alude_Cobrança-De-Aluguel_Takeat_Julho-De-2026.pdf
 *   4407 - TAKEAT.pdf      cesan jun.pdf      Algar.pdf
 *
 * E `comprovante_whatsapp.pdf` era reprovado porque a lista negativa vencia o
 * sinal positivo que estava ali, escrito, na frente. Fila de revisão cheia de
 * falso positivo é fila que ninguém abre duas vezes — e aí o `nf_undefined` de
 * verdade se esconde no meio dos 89.
 *
 * A regra agora é a inversa: só é DUVIDOSO quem tem sinal negativo E nenhum
 * positivo. Todo o resto é 'indefinido' — não conta como problema.
 */
export type ClasseDeAnexo = "nota" | "duvidoso" | "indefinido";

/** Chave de acesso: 44 dígitos (NF-e/NFC-e) ou 50 (NFS-e nacional). É prova. */
const CHAVE_FISCAL = /(?<!\d)(\d{44}|\d{50})(?!\d)/;

/** Palavra que nomeia documento fiscal ou de cobrança. */
const PALAVRA_DE_NOTA =
  /\bnfs?e?\b|\bnf\b|nota[-_ ]?fiscal|\bnota\b|danfe|invoice|fatura|recibo|boleto|cupom|comprovante|cobran[cç]a|duplicata|\bdanfse\b/;

/**
 * Nome que não identifica nada: o que o sistema gerou sozinho, ou o que saiu da
 * câmera sem ninguém renomear.
 */
const NOME_VAZIO =
  /undefined|\bnull\b|sem[-_ ]?nome|screenshot|captura[-_ ]de[-_ ]tela|whatsapp[-_ ]?image|\bphoto\b|\.tmp\b/;

/** Nome que é só o rótulo genérico do sistema, com ou sem extensão. */
const NOME_GENERICO =
  /^(documento|arquivo|imagem|image|scan|digitalizar?)\s*(\(\d+\))?(\.[a-z0-9]+)?$|^img[-_]?\d+|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

export function classificarAnexo(nome: string | null | undefined): ClasseDeAnexo {
  const s = String(nome ?? "").trim().toLowerCase();
  if (!s) return "duvidoso";                       // anexo sem nome nenhum
  if (CHAVE_FISCAL.test(s) || PALAVRA_DE_NOTA.test(s)) return "nota";
  if (NOME_VAZIO.test(s) || NOME_GENERICO.test(s)) return "duvidoso";
  return "indefinido";
}

/**
 * Compatibilidade: `true` só quando há sinal POSITIVO de nota.
 * Para decidir o que vai para a fila de revisão use `classificarAnexo`, que
 * distingue "não sei" de "isto está errado".
 */
export function pareceNotaFiscal(nome: string | null | undefined): boolean {
  return classificarAnexo(nome) === "nota";
}
