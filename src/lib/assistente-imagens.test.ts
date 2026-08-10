import { describe, expect, it } from "vitest";
import {
  LIMITE_POR_MENSAGEM, TAMANHO_MAX_ARQUIVO, comImagensLegiveis, paraRequisicao, triarArquivos,
} from "./assistente-imagens";

const arq = (name: string, type = "image/png", size = 1024) => ({ name, type, size });

describe("triarArquivos", () => {
  it("aceita imagem dentro do limite", () => {
    const { aceitas, recusadas } = triarArquivos([arq("print.png"), arq("nota.jpg", "image/jpeg")]);
    expect(aceitas.map((a) => a.name)).toEqual(["print.png", "nota.jpg"]);
    expect(recusadas).toEqual([]);
  });

  it("recusa o que não é imagem dizendo qual arquivo foi", () => {
    const { aceitas, recusadas } = triarArquivos([arq("balancete.pdf", "application/pdf")]);
    expect(aceitas).toEqual([]);
    expect(recusadas[0]).toContain("balancete.pdf");
  });

  it("recusa arquivo grande demais", () => {
    const { aceitas, recusadas } = triarArquivos([arq("raw.png", "image/png", TAMANHO_MAX_ARQUIVO + 1)]);
    expect(aceitas).toEqual([]);
    expect(recusadas).toHaveLength(1);
  });

  // Arrastar a pasta inteira não pode passar calado: o excedente é recusado COM aviso.
  it("corta no limite por mensagem e avisa do excedente", () => {
    const muitas = Array.from({ length: LIMITE_POR_MENSAGEM + 2 }, (_, i) => arq(`p${i}.png`));
    const { aceitas, recusadas } = triarArquivos(muitas);
    expect(aceitas).toHaveLength(LIMITE_POR_MENSAGEM);
    expect(recusadas).toHaveLength(2);
  });

  it("conta o que já está anexado na mensagem", () => {
    const { aceitas, recusadas } = triarArquivos([arq("a.png"), arq("b.png")], LIMITE_POR_MENSAGEM - 1);
    expect(aceitas.map((a) => a.name)).toEqual(["a.png"]);
    expect(recusadas).toHaveLength(1);
  });
});

const img = (marca: string) => ({ url: `blob:${marca}`, mime: "image/jpeg", base64: marca });
const pergunta = (texto: string, marcas: string[] = []) =>
  ({ role: "user" as const, content: texto, imagens: marcas.map(img) });

describe("comImagensLegiveis", () => {
  it("não mexe na conversa sem imagem", async () => {
    const conversa = [pergunta("qual foi o caixa?")];
    expect(await comImagensLegiveis(conversa)).toBe(conversa);
  });

  // A conversa comprida reenviaria todo print a cada turno. Ficam as mais recentes — a
  // mensagem antiga continua na tela, só não volta para a IA.
  it("mantém só as imagens mais recentes, na ordem da conversa", async () => {
    const conversa = [
      pergunta("olha isso", ["velha1", "velha2"]),
      pergunta("e agora?"),
      pergunta("e esta", ["nova1", "nova2"]),
    ];
    const saida = await comImagensLegiveis(conversa, 3);

    expect(saida.map((m) => m.content)).toEqual(["olha isso", "e agora?", "e esta"]);
    expect(saida.flatMap((m) => m.imagens.map((i) => i.base64))).toEqual(["velha1", "nova1", "nova2"]);
  });

  it("descarta imagem sem bytes ao montar a requisição", () => {
    const semBytes = { url: "https://assinada", mime: "image/jpeg", path: "u/1.jpg" };
    expect(paraRequisicao([img("ok"), semBytes])).toEqual([{ mimeType: "image/jpeg", data: "ok" }]);
  });
});
