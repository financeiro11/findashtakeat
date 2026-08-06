import { describe, it, expect } from "vitest";
import { docParaTexto, podeEditarNoCelular, resumoDoc, textoParaDoc } from "./notas";

const doc = (...content: any[]) => ({ type: "doc", content });

describe("podeEditarNoCelular", () => {
  it("aceita texto, títulos e listas", () => {
    expect(podeEditarNoCelular(doc(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Oi" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] },
    ))).toBe(true);
  });

  it("recusa tabela e imagem — salvar texto por cima apagaria o conteúdo", () => {
    expect(podeEditarNoCelular(doc({ type: "table", content: [] }))).toBe(false);
    expect(podeEditarNoCelular(doc({ type: "image", attrs: { src: "x.png" } }))).toBe(false);
  });

  it("recusa marca que o texto simples não representa", () => {
    expect(podeEditarNoCelular(doc(
      { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "highlight" }] }] },
    ))).toBe(false);
  });

  it("nota nova/vazia é editável", () => {
    expect(podeEditarNoCelular(null)).toBe(true);
  });
});

describe("ida e volta texto ⇄ documento", () => {
  const casos: [string, string][] = [
    ["parágrafo simples", "Uma linha só."],
    ["dois parágrafos", "Primeiro.\n\nSegundo."],
    ["título", "## Um título"],
    ["lista", "- um\n- dois"],
    ["lista numerada", "1. um\n2. dois"],
    ["citação", "> citado"],
    ["negrito", "texto **forte** aqui"],
    ["itálico", "texto *leve* aqui"],
    ["código", "roda `npm test` agora"],
    ["link", "veja o [Hub](https://hub.takeat.app) hoje"],
    ["régua", "antes\n\n---\n\ndepois"],
    ["quebra leve", "linha um\nlinha dois"],
  ];

  it.each(casos)("%s sobrevive à ida e volta", (_nome, texto) => {
    expect(docParaTexto(textoParaDoc(texto))).toBe(texto);
  });

  it("o documento gerado continua editável no celular", () => {
    for (const [, texto] of casos) expect(podeEditarNoCelular(textoParaDoc(texto))).toBe(true);
  });

  it("texto vazio vira um parágrafo vazio, não um doc quebrado", () => {
    expect(textoParaDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("bloco de código preserva as linhas", () => {
    const d = textoParaDoc("```\nlinha 1\nlinha 2\n```");
    expect(d.content?.[0]).toEqual({ type: "codeBlock", content: [{ type: "text", text: "linha 1\nlinha 2" }] });
  });
});

describe("resumoDoc", () => {
  it("junta o texto sem a marcação", () => {
    const d = doc(
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Reunião" }] },
      { type: "paragraph", content: [{ type: "text", text: "com o", marks: [{ type: "bold" }] }, { type: "text", text: " time" }] },
    );
    expect(resumoDoc(d)).toBe("Reunião com o time");
  });

  it("corta com reticências no limite pedido", () => {
    const d = doc({ type: "paragraph", content: [{ type: "text", text: "a".repeat(50) }] });
    expect(resumoDoc(d, 10)).toBe(`${"a".repeat(9)}…`);
  });
});
