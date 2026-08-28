// O papel da NFS-e, desenhado aqui porque não há PDF para baixar.
//
// São DOIS, e a diferença entre eles é quanto documento existe por trás:
//   • `espelhoPdf` — a NOSSA nota, desenhada do XML assinado. Tem cara de
//     DANFSe porque todo campo do formulário tem origem no documento.
//   • `comprovanteEmailPdf` — a nota de FORNECEDOR que só chegou por e-mail.
//     Sem endereço, sem discriminação do serviço, sem alíquota; então não imita
//     o formulário, e diz no título que é comprovante de emissão.
//
// POR QUE DESENHAR EM VEZ DE BAIXAR. Não existe PDF da nota para pegar em lugar
// nenhum, e isso foi medido, não suposto:
//
//   • Omie — o campo `danfe` do RPS volta vazio; `ObterDANFSE`, `ImprimirNFSe`,
//     `ObterPDFNFSe`, `ObterArquivoNFSe` e `servicos/nfse/*` respondem "Method not
//     exists"; e `geral/anexo/ListarAnexo` na tabela `ordem-servico` (a válida,
//     segundo a crítica do próprio Omie) devolve ZERO anexos para a OS faturada.
//   • Portal Nacional — `nfse.gov.br/consultapublica` abre o formulário com a
//     chave preenchida mas exige hCaptcha; `sefin.nfse.gov.br/sefinnacional/
//     danfse/<chave>` devolve 403 (é a API do ADN, exige certificado) e o ADN, 496.
//
// O que existe é o XML assinado. Como o DANFSe é, por definição, o documento
// AUXILIAR — uma representação do que está no XML —, montar a nossa é legítimo
// desde que ela não se faça passar pela emitida pela prefeitura. Daí duas
// decisões de conteúdo: o rodapé diz de onde o papel veio, e a chave de acesso
// aparece grande, com QR Code, porque é ela que permite a qualquer um conferir a
// nota na fonte. O papel é conveniência; a prova é a chave.
//
// A CODIFICAÇÃO É ARMADILHA. As fontes padrão do PDF são WinAnsi, e `drawText`
// ESTOURA (não ignora) diante de um caractere fora dela. O XML do Omie vem sem
// acentos, o que esconde o problema — mas o nome do tomador vem do cadastro e
// pode ter qualquer coisa. Por isso todo texto passa por `winAnsi()`.

import { PDFDocument, PDFString, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import qrcode from "https://esm.sh/qrcode-generator@1.4.4";

/* ------------------------------- leitura ---------------------------------- */

const bloco = (xml: string, tag: string): string =>
  xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
const txt = (xml: string, tag: string): string =>
  (xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1] ?? "").trim();
const num = (xml: string, tag: string): number => Number(txt(xml, tag) || 0);

export type NotaLida = {
  numero: string; serie: string; chave: string; emitidaEm: string; competencia: string;
  municipio: string;
  prestador: { nome: string; cnpj: string; endereco: string; municipio: string };
  tomador: { nome: string; cnpj: string; endereco: string; municipio: string };
  servico: { descricao: string; codigo: string; tributacao: string };
  valores: { base: number; aliquota: number; iss: number; liquido: number; servico: number };
};

/**
 * O XML da NFS-e Nacional, lido sem DOM.
 *
 * O cuidado que o parser exige: `<valores>` aparece TRÊS vezes no documento (a do
 * `infNFSe`, a do bloco IBSCBS da reforma tributária e a do DPS) e `<CNPJ>`,
 * três (emitente, prestador e tomador). Por isso nada é procurado no documento
 * inteiro — cada campo é lido dentro do bloco a que pertence, e os valores da
 * nota vêm do trecho ANTERIOR ao `<IBSCBS>`, que é onde mora o que interessa.
 */
export function lerXmlNfse(xml: string): NotaLida {
  const inf = bloco(xml, "infNFSe");
  const chave = (xml.match(/<infNFSe[^>]*Id="NFS(\d{50})"/)?.[1] ?? "").trim();

  const emit = bloco(inf, "emit");
  const ender = bloco(emit, "enderNac");
  const dps = bloco(xml, "infDPS");
  const toma = bloco(dps, "toma");
  const tomaEnd = bloco(toma, "end");
  const serv = bloco(dps, "serv");
  const valoresNota = bloco(inf.split("<IBSCBS>")[0], "valores");
  const vServ = num(bloco(dps, "vServPrest"), "vServ");

  const rua = [txt(ender, "xLgr"), txt(ender, "nro")].filter(Boolean).join(", ");
  const ruaToma = [txt(tomaEnd, "xLgr"), txt(tomaEnd, "nro")].filter(Boolean).join(", ");
  /* O tomador não tem nome de município no XML — só o código IBGE, que não diz
   * nada a quem lê. O CEP diz, e é o que vai junto do endereço. */
  const cepToma = txt(bloco(tomaEnd, "endNac"), "CEP");

  return {
    numero: txt(inf, "nNFSe"),
    serie: txt(dps, "serie"),
    chave,
    emitidaEm: txt(dps, "dhEmi") || txt(inf, "dhProc"),
    competencia: txt(dps, "dCompet"),
    municipio: txt(inf, "xLocEmi"),
    prestador: {
      nome: txt(emit, "xNome"),
      cnpj: txt(emit, "CNPJ"),
      endereco: [rua, txt(ender, "xBairro")].filter(Boolean).join(" - "),
      municipio: `${txt(inf, "xLocEmi")}/${txt(ender, "UF")}`,
    },
    tomador: {
      nome: txt(toma, "xNome"),
      cnpj: txt(toma, "CNPJ") || txt(toma, "CPF"),
      endereco: [ruaToma, txt(tomaEnd, "xBairro")].filter(Boolean).join(" - "),
      municipio: cepToma ? `CEP ${cepToma.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : "",
    },
    servico: {
      descricao: txt(serv, "xDescServ"),
      codigo: txt(serv, "cTribNac"),
      tributacao: txt(inf, "xTribNac"),
    },
    valores: {
      base: num(valoresNota, "vBC"),
      aliquota: num(valoresNota, "pAliqAplic"),
      iss: num(valoresNota, "vISSQN"),
      liquido: num(valoresNota, "vLiq"),
      servico: vServ,
    },
  };
}

/* ------------------------------ formatação -------------------------------- */

/** Substitui o que a fonte WinAnsi não sabe desenhar — ver o cabeçalho. */
function winAnsi(s: string): string {
  return String(s ?? "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\xFF]/g, "");
}

export const fmtDoc = (d: string): string => {
  const s = String(d ?? "").replace(/\D/g, "");
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return s;
};
const brl = (n: number): string =>
  `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const dataBR = (iso: string): string => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
const competenciaBR = (iso: string): string => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : "";
};
/** A chave em blocos de 4 — 50 dígitos numa linha só ninguém confere. */
export const chaveEmBlocos = (c: string): string =>
  String(c ?? "").replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").trim();

/** O endereço do Portal Nacional — o mesmo que o QR Code do DANFSe oficial aponta. */
export const linkPortalNacional = (chave: string): string =>
  `https://www.nfse.gov.br/consultapublica/?tpc=1&chave=${String(chave).replace(/\D/g, "")}`;

/* -------------------------------- desenho --------------------------------- */

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 36;
const TINTA = rgb(0.09, 0.09, 0.11);
const APOIO = rgb(0.42, 0.44, 0.48);
const LINHA = rgb(0.80, 0.82, 0.85);
const FUNDO = rgb(0.96, 0.965, 0.97);

/**
 * Quebra o texto em linhas que cabem na largura — o PDF não tem `word-wrap`.
 * Sem isto a descrição do serviço (que pode ter 200 caracteres) sai reta para
 * fora da página, e o que some é justamente o que descreve a nota.
 */
function quebrar(texto: string, fonte: any, tamanho: number, largura: number): string[] {
  const palavras = winAnsi(texto).split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) atual = tentativa;
    else { if (atual) linhas.push(atual); atual = p; }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/**
 * O QR Code, desenhado por FAIXAS e não por módulo.
 *
 * Um retângulo por módulo escuro custa ~100 bytes de caminho no content stream
 * e um QR tem ~1.000 deles — eram 170 KB de fluxo para um quadrado de 76
 * pontos. Juntar os módulos escuros vizinhos da mesma linha num retângulo só dá
 * o mesmo desenho por uma fração do arquivo.
 */
function desenharQr(pagina: any, url: string, x: number, y: number, lado: number): void {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const modulos = qr.getModuleCount();
  const passo = lado / modulos;
  for (let linha = 0; linha < modulos; linha++) {
    let inicio = -1;
    for (let col = 0; col <= modulos; col++) {
      const escuro = col < modulos && qr.isDark(linha, col);
      if (escuro && inicio < 0) inicio = col;
      if (!escuro && inicio >= 0) {
        pagina.drawRectangle({
          x: x + inicio * passo,
          y: y + (modulos - 1 - linha) * passo,
          width: (col - inicio) * passo, height: passo, color: TINTA,
        });
        inicio = -1;
      }
    }
  }
}

/**
 * O endereço vai clicável de verdade: além do texto, uma anotação de link na
 * mesma área. Um endereço de 90 caracteres para digitar à mão não é um link, é
 * um castigo — e o QR ao lado resolve para quem está no celular.
 */
function linkClicavel(pdf: any, pagina: any, url: string, x: number, y: number, largura: number): void {
  const anotacao = pdf.context.register(
    pdf.context.obj({
      Type: "Annot", Subtype: "Link",
      Rect: [x - 2, y - 3, x + largura + 2, y + 10],
      Border: [0, 0, 0],
      /* `PDFString.of`, e não `context.obj`: para uma string JS o `obj` devolve um
       * NAME do PDF, e o endereço saía gravado como `/https:#2F#2Fwww...` — um
       * link que o leitor mostra sublinhado e que não abre lugar nenhum. URI é
       * string, e string tem que ser dita com todas as letras. */
      A: pdf.context.obj({ Type: "Action", S: "URI", URI: PDFString.of(url) }),
    }),
  );
  pagina.node.set(pdf.context.obj("Annots"), pdf.context.obj([anotacao]));
}

export async function espelhoPdf(nota: NotaLida): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`NFS-e ${nota.numero}`);
  pdf.setSubject(`Espelho da NFS-e ${nota.numero} - chave ${nota.chave}`);
  pdf.setProducer("Central do Financeiro - Takeat");

  const pagina = pdf.addPage(A4);
  const [L, A] = A4;
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const util = L - MARGEM * 2;

  const escrever = (t: string, x: number, y: number, tam = 9, fonte = regular, cor = TINTA) =>
    pagina.drawText(winAnsi(t), { x, y, size: tam, font: fonte, color: cor });
  const caixa = (x: number, y: number, w: number, h: number, preenchida = false) =>
    pagina.drawRectangle({
      x, y, width: w, height: h,
      borderColor: LINHA, borderWidth: 0.7,
      ...(preenchida ? { color: FUNDO } : {}),
    });

  let y = A - MARGEM;

  /* Cabeçalho */
  caixa(MARGEM, y - 58, util, 58, true);
  escrever("NOTA FISCAL DE SERVICOS ELETRONICA", MARGEM + 14, y - 24, 14, negrito);
  escrever(`Padrao Nacional - ${nota.municipio}`, MARGEM + 14, y - 40, 9, regular, APOIO);
  const rotuloN = `Nº ${nota.numero}`;
  escrever(rotuloN, L - MARGEM - 14 - negrito.widthOfTextAtSize(rotuloN, 18), y - 26, 18, negrito);
  const sub = `Serie ${nota.serie} - ${dataBR(nota.emitidaEm)}`;
  escrever(sub, L - MARGEM - 14 - regular.widthOfTextAtSize(sub, 9), y - 42, 9, regular, APOIO);
  y -= 58 + 14;

  /* Prestador e tomador, lado a lado */
  const meia = (util - 10) / 2;
  const altPartes = 92;
  caixa(MARGEM, y - altPartes, meia, altPartes);
  caixa(MARGEM + meia + 10, y - altPartes, meia, altPartes);

  const parte = (x: number, titulo: string, p: { nome: string; cnpj: string; endereco: string; municipio?: string }) => {
    let yy = y - 18;
    escrever(titulo, x + 12, yy, 7.5, negrito, APOIO);
    yy -= 16;
    for (const linha of quebrar(p.nome, negrito, 10, meia - 24).slice(0, 2)) {
      escrever(linha, x + 12, yy, 10, negrito); yy -= 13;
    }
    escrever(`CNPJ ${fmtDoc(p.cnpj)}`, x + 12, yy, 8.5, regular, APOIO); yy -= 12;
    for (const linha of quebrar(p.endereco, regular, 8, meia - 24).slice(0, 2)) {
      escrever(linha, x + 12, yy, 8, regular, APOIO); yy -= 10;
    }
    if (p.municipio) escrever(p.municipio, x + 12, yy, 8, regular, APOIO);
  };
  parte(MARGEM, "PRESTADOR", nota.prestador);
  parte(MARGEM + meia + 10, "TOMADOR", nota.tomador);
  y -= altPartes + 14;

  /* Serviço */
  const linhasDesc = quebrar(nota.servico.descricao, negrito, 11, util - 28);
  const linhasTrib = quebrar(`${nota.servico.codigo} - ${nota.servico.tributacao}`, regular, 7.5, util - 28).slice(0, 3);
  // +6 de folga no pé: sem ela a última linha encosta na borda e os descendentes
  // (g, p, q) atravessam o traço da caixa.
  const altServ = 36 + linhasDesc.length * 14 + linhasTrib.length * 10;
  caixa(MARGEM, y - altServ, util, altServ);
  let ys = y - 18;
  escrever("DISCRIMINACAO DOS SERVICOS", MARGEM + 14, ys, 7.5, negrito, APOIO);
  ys -= 18;
  for (const linha of linhasDesc) { escrever(linha, MARGEM + 14, ys, 11, negrito); ys -= 14; }
  ys -= 2;
  for (const linha of linhasTrib) { escrever(linha, MARGEM + 14, ys, 7.5, regular, APOIO); ys -= 10; }
  y -= altServ + 14;

  /* Valores */
  const altVal = 62;
  caixa(MARGEM, y - altVal, util, altVal, true);
  const colunas: Array<[string, string]> = [
    ["COMPETENCIA", competenciaBR(nota.competencia)],
    ["VALOR DO SERVICO", brl(nota.valores.servico || nota.valores.base)],
    [`ISS (${nota.valores.aliquota.toFixed(2).replace(".", ",")}%)`, brl(nota.valores.iss)],
  ];
  colunas.forEach(([rotulo, valor], i) => {
    const x = MARGEM + 14 + i * ((util - 190) / 3);
    escrever(rotulo, x, y - 20, 7, negrito, APOIO);
    escrever(valor, x, y - 38, 11, regular);
  });
  const rotuloTotal = "VALOR LIQUIDO";
  const total = brl(nota.valores.liquido);
  escrever(rotuloTotal, L - MARGEM - 14 - negrito.widthOfTextAtSize(rotuloTotal, 7), y - 20, 7, negrito, APOIO);
  escrever(total, L - MARGEM - 14 - negrito.widthOfTextAtSize(total, 16), y - 41, 16, negrito);
  y -= altVal + 14;

  /* Chave de acesso + QR — a parte que prova a nota */
  const altChave = 104;
  caixa(MARGEM, y - altChave, util, altChave);
  const url = linkPortalNacional(nota.chave);

  const ladoQr = 76;
  const qrX = MARGEM + 14;
  desenharQr(pagina, url, qrX, y - altChave + (altChave - ladoQr) / 2, ladoQr);

  const xTexto = qrX + ladoQr + 16;
  let yc = y - 24;
  escrever("CHAVE DE ACESSO", xTexto, yc, 7.5, negrito, APOIO); yc -= 15;
  for (const linha of quebrar(chaveEmBlocos(nota.chave), regular, 10, util - (xTexto - MARGEM) - 20)) {
    escrever(linha, xTexto, yc, 10, regular); yc -= 13;
  }
  yc -= 4;
  escrever("Confira esta nota no Portal Nacional da NFS-e:", xTexto, yc, 7.5, regular, APOIO); yc -= 11;

  escrever(url, xTexto, yc, 7.5, regular, rgb(0.11, 0.36, 0.75));
  linkClicavel(pdf, pagina, url, xTexto, yc, regular.widthOfTextAtSize(winAnsi(url), 7.5));

  /* Rodapé — de onde veio este papel */
  escrever(
    "Espelho gerado pela Central do Financeiro a partir do XML oficial assinado da NFS-e, anexado a esta mesma cobranca.",
    MARGEM, MARGEM + 12, 7, regular, APOIO,
  );
  escrever(
    "Nao substitui o DANFSe emitido pela prefeitura; a nota se confere pela chave de acesso acima.",
    MARGEM, MARGEM + 2, 7, regular, APOIO,
  );

  return await pdf.save();
}

/* ===========================================================================
 * A NOTA QUE CHEGOU SÓ POR E-MAIL
 * ======================================================================== */

export type ParcelaDoComprovante = { numero: number; vencimento: string | null; valor: number | null };

export type ComprovanteDeEmail = {
  emitente: string;
  cnpj: string;
  numero: string;
  /** os 50 dígitos do Código de Verificação; nulo quando o município usa outro */
  chave: string | null;
  /** ISO */
  emissao: string | null;
  valor: number | null;
  inscricaoMunicipal: string | null;
  rps: string | null;
  ordemServico: string | null;
  parcelas: ParcelaDoComprovante[];
  tomador: { nome: string; cnpj: string };
  /** a frase do rodapé: de que e-mail, de quem e de quando este papel saiu */
  origem: string;
};

/**
 * O PAPEL DA NOTA DE FORNECEDOR QUE NÃO VEM COMO ARQUIVO.
 *
 * O `espelhoPdf` acima desenha a NOSSA nota a partir do XML assinado, e por
 * isso pode ter cara de DANFSe: todo campo do formulário tem origem no
 * documento. Aqui não. O e-mail de emissão do Omie traz emitente, CNPJ, número,
 * valor, código de verificação, emissão e parcelas — e NÃO traz endereço,
 * município, discriminação do serviço nem alíquota de ISS.
 *
 * Desenhar o mesmo formulário com metade dos campos em branco seria pior do que
 * não desenhar: pareceria a nota, e não é. Então este papel é outra coisa e diz
 * o que é já no título — um COMPROVANTE DE EMISSÃO, que reproduz o que o ERP do
 * emitente mandou e aponta para a fonte.
 *
 * O QUE O TORNA ÚTIL É A CHAVE, como no espelho: com os 50 dígitos qualquer um
 * confere a nota no Portal Nacional, e o QR leva direto. O papel é conveniência
 * para o título no contas a pagar; a prova continua sendo a chave.
 */
export async function comprovanteEmailPdf(c: ComprovanteDeEmail): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Comprovante de emissao NFS-e ${c.numero} - ${c.emitente}`);
  pdf.setSubject(c.chave ? `NFS-e ${c.numero} - chave ${c.chave}` : `NFS-e ${c.numero}`);
  pdf.setProducer("Central do Financeiro - Takeat");

  const pagina = pdf.addPage(A4);
  const [L, A] = A4;
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const util = L - MARGEM * 2;

  const escrever = (t: string, x: number, y: number, tam = 9, fonte = regular, cor = TINTA) =>
    pagina.drawText(winAnsi(t), { x, y, size: tam, font: fonte, color: cor });
  const aDireita = (t: string, dir: number, y: number, tam: number, fonte = regular, cor = TINTA) =>
    escrever(t, dir - fonte.widthOfTextAtSize(winAnsi(t), tam), y, tam, fonte, cor);
  const caixa = (x: number, y: number, w: number, h: number, preenchida = false) =>
    pagina.drawRectangle({
      x, y, width: w, height: h,
      borderColor: LINHA, borderWidth: 0.7,
      ...(preenchida ? { color: FUNDO } : {}),
    });

  let y = A - MARGEM;

  /* Cabeçalho — o título diz o que o papel é, para ninguém confundir com a nota */
  caixa(MARGEM, y - 58, util, 58, true);
  escrever("COMPROVANTE DE EMISSAO DA NFS-e", MARGEM + 14, y - 24, 14, negrito);
  escrever("Reproduzido do e-mail do emitente - nao e o DANFSe", MARGEM + 14, y - 40, 9, regular, APOIO);
  aDireita(`Nº ${c.numero}`, L - MARGEM - 14, y - 26, 18, negrito);
  if (c.emissao) aDireita(`Emitida em ${dataBR(c.emissao)}`, L - MARGEM - 14, y - 42, 9, regular, APOIO);
  y -= 58 + 14;

  /* Emitente e tomador */
  const meia = (util - 10) / 2;
  const altPartes = 62;
  caixa(MARGEM, y - altPartes, meia, altPartes);
  caixa(MARGEM + meia + 10, y - altPartes, meia, altPartes);
  const parte = (x: number, titulo: string, nome: string, cnpj: string) => {
    let yy = y - 18;
    escrever(titulo, x + 12, yy, 7.5, negrito, APOIO);
    yy -= 16;
    for (const linha of quebrar(nome, negrito, 10, meia - 24).slice(0, 2)) {
      escrever(linha, x + 12, yy, 10, negrito); yy -= 13;
    }
    escrever(`CNPJ ${fmtDoc(cnpj)}`, x + 12, yy, 8.5, regular, APOIO);
  };
  parte(MARGEM, "EMITENTE (PRESTADOR)", c.emitente, c.cnpj);
  parte(MARGEM + meia + 10, "TOMADOR", c.tomador.nome, c.tomador.cnpj);
  y -= altPartes + 14;

  /* O quadro do e-mail, campo a campo — só o que o e-mail escreveu */
  const altQuadro = 62;
  caixa(MARGEM, y - altQuadro, util, altQuadro, true);
  const campos: Array<[string, string]> = [
    ["INSCRICAO MUNICIPAL", c.inscricaoMunicipal || "-"],
    ["Nº DA RPS", c.rps || "-"],
    ["ORDEM DE SERVICO", c.ordemServico || "-"],
  ];
  campos.forEach(([rotulo, valor], i) => {
    const x = MARGEM + 14 + i * ((util - 190) / 3);
    escrever(rotulo, x, y - 20, 7, negrito, APOIO);
    escrever(valor, x, y - 38, 11, regular);
  });
  aDireita("VALOR DA NOTA", L - MARGEM - 14, y - 20, 7, negrito, APOIO);
  aDireita(c.valor === null ? "-" : brl(c.valor), L - MARGEM - 14, y - 41, 16, negrito);
  y -= altQuadro + 14;

  /* As parcelas — é por elas que o título nasce no contas a pagar, e numa nota
     com imposto retido o valor delas NÃO é o valor da nota. Mostrar os dois é o
     que evita a conversa de "o valor não bate". */
  if (c.parcelas.length) {
    const altLinha = 18;
    const altTab = 34 + c.parcelas.length * altLinha;
    caixa(MARGEM, y - altTab, util, altTab);
    escrever("VENCIMENTOS", MARGEM + 14, y - 18, 7.5, negrito, APOIO);
    let yp = y - 34;
    for (const p of c.parcelas.slice(0, 24)) {
      escrever(`Parcela ${p.numero}`, MARGEM + 14, yp, 9.5, regular);
      escrever(p.vencimento ? dataBR(p.vencimento) : "-", MARGEM + 110, yp, 9.5, regular);
      aDireita(p.valor === null ? "-" : brl(p.valor), L - MARGEM - 14, yp, 9.5, negrito);
      yp -= altLinha;
    }
    y -= altTab + 14;
  }

  /* Chave + QR — a parte que permite conferir a nota na fonte */
  if (c.chave) {
    const altChave = 104;
    caixa(MARGEM, y - altChave, util, altChave);
    const url = linkPortalNacional(c.chave);
    const ladoQr = 76;
    const qrX = MARGEM + 14;
    desenharQr(pagina, url, qrX, y - altChave + (altChave - ladoQr) / 2, ladoQr);

    const xTexto = qrX + ladoQr + 16;
    let yc = y - 24;
    escrever("CHAVE DE ACESSO", xTexto, yc, 7.5, negrito, APOIO); yc -= 15;
    for (const linha of quebrar(chaveEmBlocos(c.chave), regular, 10, util - (xTexto - MARGEM) - 20)) {
      escrever(linha, xTexto, yc, 10, regular); yc -= 13;
    }
    yc -= 4;
    escrever("Confira esta nota no Portal Nacional da NFS-e:", xTexto, yc, 7.5, regular, APOIO); yc -= 11;
    escrever(url, xTexto, yc, 7.5, regular, rgb(0.11, 0.36, 0.75));
    linkClicavel(pdf, pagina, url, xTexto, yc, regular.widthOfTextAtSize(winAnsi(url), 7.5));
  }

  /* Rodapé — de onde veio este papel. A frase é montada por quem chama porque é
     ela que responde "onde está a nota de verdade" quando alguém perguntar. */
  for (const [i, linha] of quebrar(c.origem, regular, 7, util).slice(0, 2).entries()) {
    escrever(linha, MARGEM, MARGEM + 12 - i * 10, 7, regular, APOIO);
  }
  escrever(
    "Nao substitui o DANFSe emitido pela prefeitura.",
    MARGEM, MARGEM - 8, 7, regular, APOIO,
  );

  return await pdf.save();
}
