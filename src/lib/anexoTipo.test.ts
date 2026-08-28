/**
 * O tipo real do arquivo e o que fazer com ele antes de mandar ao Omie.
 *
 * Por que este teste existe: a regra antiga traduzia extensão desconhecida para
 * "pdf" e mandava os bytes originais — uma foto .webp virava "foto.pdf" com WebP
 * dentro, o Omie aceitava, a varredura contava o anexo como presente e nenhum
 * leitor abria o arquivo. Erro que se anuncia como sucesso é o pior tipo: some
 * da lista do que falta. Aqui os bytes mandam, não o nome.
 */
import { describe, expect, it } from "vitest";
import {
  extDe,
  classificarAnexo,
  nomeSeguroParaOmie,
  pareceNotaFiscal,
  planoDeAnexo,
  tipoRealDoArquivo,
} from "../../supabase/functions/_shared/anexo-tipo";

const bytes = (...b: number[]) => new Uint8Array(b);
/** Cabeçalho de N bytes seguido de recheio, para passar do mínimo de 4 bytes. */
const comCabecalho = (cab: number[], tamanho = 64) => {
  const out = new Uint8Array(tamanho);
  out.set(cab, 0);
  return out;
};
const texto = (s: string) => new TextEncoder().encode(s);

describe("tipoRealDoArquivo", () => {
  it("reconhece PDF, JPEG e PNG pelos primeiros bytes", () => {
    expect(tipoRealDoArquivo(texto("%PDF-1.7\n%âãÏÓ"))).toBe("pdf");
    expect(tipoRealDoArquivo(comCabecalho([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(tipoRealDoArquivo(comCabecalho([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
  });

  it("reconhece os formatos que o Omie não aceita", () => {
    expect(tipoRealDoArquivo(comCabecalho([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("gif");
    expect(tipoRealDoArquivo(comCabecalho([0x42, 0x4d, 0x00, 0x00]))).toBe("bmp");
    expect(tipoRealDoArquivo(comCabecalho([0x49, 0x49, 0x2a, 0x00]))).toBe("tiff");

    // RIFF <4 bytes de tamanho> WEBP
    const webp = comCabecalho([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    expect(tipoRealDoArquivo(webp)).toBe("webp");

    // HEIC do iPhone: 4 bytes de tamanho, "ftyp", marca
    const heic = new Uint8Array(64);
    heic.set([0x00, 0x00, 0x00, 0x18], 0);
    heic.set(texto("ftypheic"), 4);
    expect(tipoRealDoArquivo(heic)).toBe("heic");
  });

  it("reconhece XML mesmo com BOM e espaço antes da tag", () => {
    expect(tipoRealDoArquivo(texto('﻿  <?xml version="1.0"?><NFe/>'))).toBe("xml");
    expect(tipoRealDoArquivo(texto("<NFSe><infNFSe/></NFSe>"))).toBe("xml");
  });

  it("não inventa tipo para bytes que não reconhece", () => {
    expect(tipoRealDoArquivo(comCabecalho([0x01, 0x02, 0x03, 0x04]))).toBeNull();
    expect(tipoRealDoArquivo(bytes(0xff))).toBeNull();   // curto demais
  });

  it("ignora a extensão do nome — quem manda são os bytes", () => {
    // O caso real: foto renomeada para .pdf.
    expect(tipoRealDoArquivo(comCabecalho([0xff, 0xd8, 0xff, 0xdb]))).toBe("jpg");
  });
});

describe("planoDeAnexo", () => {
  it("manda imagem virar PDF por padrão", () => {
    expect(planoDeAnexo("jpg", "IMG-20260812-WA0007.jpeg")).toEqual({
      acao: "converter_para_pdf", tipoOrigem: "jpg", tipoFinal: "pdf",
    });
    expect(planoDeAnexo("png", "print.png")).toMatchObject({ acao: "converter_para_pdf" });
  });

  it("deixa a imagem passar quando a conversão é desligada (só diagnóstico)", () => {
    // Esta conta do Omie RECUSA jpg — desligar a conversão é para depurar, não
    // para usar. Ver a nota em EXT_ANEXO.
    expect(planoDeAnexo("jpg", "foto.jpg", { converterImagem: false }))
      .toEqual({ acao: "manter", tipoFinal: "jpg", corrigiuExtensao: false });
  });

  it("converte a imagem mesmo quando o nome já diz .jpg", () => {
    // O caso real das duas notas paradas de agosto: WhatsApp_Image_….jpg, que o
    // Omie recusava com \"Tipo de Anexo não cadastrado para o Código [jpg]\".
    expect(planoDeAnexo("jpg", "WhatsApp_Image_2026-07-07.jpg"))
      .toEqual({ acao: "converter_para_pdf", tipoOrigem: "jpg", tipoFinal: "pdf" });
  });

  it("mantém PDF e XML sem mexer", () => {
    expect(planoDeAnexo("pdf", "nota.pdf")).toEqual({ acao: "manter", tipoFinal: "pdf", corrigiuExtensao: false });
    expect(planoDeAnexo("xml", "nfse.xml")).toEqual({ acao: "manter", tipoFinal: "xml", corrigiuExtensao: false });
  });

  it("corrige a extensão quando o nome mente sobre o conteúdo", () => {
    // Bytes de PDF num arquivo chamado .jpg: sobe como PDF, não como imagem.
    const p = planoDeAnexo("pdf", "comprovante.jpg", { converterImagem: false });
    expect(p).toEqual({ acao: "manter", tipoFinal: "pdf", corrigiuExtensao: true });
  });

  it("RECUSA os formatos que viravam .pdf corrompido", () => {
    for (const t of ["webp", "heic", "gif", "bmp", "tiff"]) {
      const p = planoDeAnexo(t, `foto.${t}`);
      expect(p.acao).toBe("recusar");
      if (p.acao === "recusar") expect(p.motivo).toMatch(/JPEG, PNG ou PDF/);
    }
  });

  it("cita o HEIC do iPhone na instrução, que é o caso que acontece", () => {
    const p = planoDeAnexo("heic", "IMG_4821.HEIC");
    expect(p.acao).toBe("recusar");
    if (p.acao === "recusar") expect(p.motivo).toMatch(/iPhone/i);
  });

  it("aceita pelo nome o que não sabe farejar, se a extensão for válida", () => {
    expect(planoDeAnexo(null, "planilha.xlsx")).toEqual({
      acao: "manter", tipoFinal: "xlsx", corrigiuExtensao: false,
    });
    expect(planoDeAnexo(null, "recibo.txt")).toMatchObject({ acao: "manter", tipoFinal: "txt" });
  });

  it("recusa o que não sabe farejar e ainda tem extensão inválida", () => {
    const p = planoDeAnexo(null, "arquivo.heif");
    expect(p.acao).toBe("recusar");
    if (p.acao === "recusar") expect(p.motivo).toMatch(/Converta para PDF/);
  });
});

describe("nomeSeguroParaOmie", () => {
  it("tira acento e espaço, que o unzip do Omie não acha no zip", () => {
    expect(nomeSeguroParaOmie("Recibo do bilhete eletrônico, 29 Junho.pdf"))
      .toBe("Recibo_do_bilhete_eletronico_29_Junho.pdf");
  });

  it("normaliza jpeg para jpg, que é o tipo cadastrado no Omie", () => {
    expect(nomeSeguroParaOmie("foto.jpeg")).toBe("foto.jpg");
    expect(nomeSeguroParaOmie("foto.JFIF")).toBe("foto.jpg");
  });

  it("nunca devolve nome vazio", () => {
    expect(nomeSeguroParaOmie("...pdf")).toMatch(/\.pdf$/);
    expect(nomeSeguroParaOmie("")).toBe("comprovante.pdf");
  });

  it("corta nome muito longo mas preserva a extensão", () => {
    const n = nomeSeguroParaOmie("a".repeat(200) + ".pdf");
    expect(n.endsWith(".pdf")).toBe(true);
    expect(n.length).toBeLessThanOrEqual(64);
  });
});

describe("extDe", () => {
  it("assume pdf quando não há extensão", () => {
    expect(extDe("comprovante")).toBe("pdf");
  });
  it("lê a última extensão, em minúsculas", () => {
    expect(extDe("nota.fiscal.XML")).toBe("xml");
  });
});

describe("classificarAnexo", () => {
  it("a chave de acesso é prova: 44 dígitos (NF-e) e 50 (NFS-e)", () => {
    // Nomes reais lidos do Omie na varredura de 25/08/2026.
    expect(classificarAnexo("32013082242514815000139000000000000426080549719853.pdf")).toBe("nota");
    expect(classificarAnexo("32260617339545000120550010000230261371841572.pdf")).toBe("nota");
  });

  it("reconhece a palavra que nomeia documento fiscal ou de cobrança", () => {
    expect(classificarAnexo("NF 12345 - Fornecedor.pdf")).toBe("nota");
    expect(classificarAnexo("danfe_5512.pdf")).toBe("nota");
    expect(classificarAnexo("Alude_Cobrança-De-Aluguel_Takeat_Julho-De-2026.pdf")).toBe("nota");
    expect(classificarAnexo("Recibo-Aluguel_Abril.pdf")).toBe("nota");
  });

  it("o sinal POSITIVO vence o negativo — o caso comprovante_whatsapp", () => {
    // A versão anterior reprovava este arquivo por conter \"whatsapp\", ignorando
    // a palavra \"comprovante\" escrita na frente.
    expect(classificarAnexo("comprovante_whatsapp.pdf")).toBe("nota");
  });

  it("o XML fiscal é nota pela extensão, mesmo com nome que não diz nada", () => {
    // Decisão do usuário em 28/08/2026. Estes quatro estão pendurados em títulos
    // no ERP e caíam em 'indefinido' — contavam como cobertos pelo desempate do
    // "não sei", não por decisão, e a triagem por IA nunca ia resolvê-los porque
    // ela só aceita PDF e imagem.
    expect(classificarAnexo("19f11789034de969_anexo2.xml")).toBe("nota");
    expect(classificarAnexo("1a0243d004948306_NFSe0314535_229U.4024.5052.43.xml")).toBe("nota");
    expect(classificarAnexo("3034226600018370443-nfs-e.xml")).toBe("nota");
    expect(classificarAnexo("ANEXO2.XML")).toBe("nota");
  });

  it("a extensão do XML vence até o nome que seria duvidoso", () => {
    // Um `.xml` gerado pelo sistema continua sendo o documento fiscal: quem
    // recusa o que não tem tag de NF-e é a leitura por dentro, não o nome.
    expect(classificarAnexo("documento (3).xml")).toBe("nota");
    expect(classificarAnexo("nf_undefined.xml")).toBe("nota");
  });

  it("marca como duvidoso só o que o sistema nomeou sozinho", () => {
    expect(classificarAnexo("5aef68b9-5e16-426a-94e2-0cc1ab985241.tmp.pdf")).toBe("duvidoso");
    expect(classificarAnexo("IMG-20260812-WA0007.jpg")).toBe("duvidoso");
    expect(classificarAnexo("Screenshot 2026-08-12.png")).toBe("duvidoso");
    expect(classificarAnexo("documento (3).pdf")).toBe("duvidoso");
    expect(classificarAnexo("")).toBe("duvidoso");
    expect(classificarAnexo(null)).toBe("duvidoso");
  });

  it("nome comum de fornecedor não vira suspeito — presumir culpa lota a fila", () => {
    // Os falsos positivos que a primeira versão gerou (89 de 356 anexos).
    for (const n of ["4407 - TAKEAT.pdf", "cesan jun.pdf", "Algar.pdf", "172149.pdf", "cafe express.pdf"]) {
      expect(classificarAnexo(n), n).toBe("indefinido");
    }
  });

  it("nf_undefined é duvidoso mesmo tendo \"nf\" no nome", () => {
    // O caso real que originou a checagem — 'undefined' é sinal de que o sistema
    // não soube nomear, e aí o \"nf\" na frente não prova nada.
    expect(classificarAnexo("nf_undefined_correta.pdf")).toBe("duvidoso");
  });

  it("pareceNotaFiscal continua sendo só o sinal positivo", () => {
    expect(pareceNotaFiscal("NF 12345.pdf")).toBe(true);
    expect(pareceNotaFiscal("4407 - TAKEAT.pdf")).toBe(false);   // indefinido ≠ nota
    expect(pareceNotaFiscal("IMG_0042.jpg")).toBe(false);
  });
});
