import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotaConteudo } from "./NotaConteudo";
import { textoParaDoc } from "@/lib/mobile/notas";

/* Renderiza sem navegador (renderToStaticMarkup): o que interessa aqui é a árvore, não a
   interação — e é o único lugar do app que percorre um documento arbitrário do TipTap. */
const html = (doc: unknown) => renderToStaticMarkup(<NotaConteudo doc={doc} />);

describe("NotaConteudo", () => {
  it("aplica as marcas de texto", () => {
    const saida = html(textoParaDoc("um **forte**, um *leve*, um `código` e um [link](https://takeat.app)"));
    expect(saida).toContain("<strong");
    expect(saida).toContain("<em>");
    expect(saida).toContain("<code");
    expect(saida).toContain('href="https://takeat.app"');
    expect(saida).toContain('rel="noreferrer"'); // link externo nunca sem rel
  });

  it("monta títulos, listas e citação", () => {
    const saida = html(textoParaDoc("# Título\n\n- a\n- b\n\n1. um\n\n> citado"));
    expect(saida).toContain("<h1");
    expect(saida).toContain("<ul");
    expect(saida).toContain("<ol");
    expect(saida).toContain("<blockquote");
  });

  it("tabela rola sozinha — a página nunca rola de lado", () => {
    const saida = html({
      type: "doc",
      content: [{
        type: "table",
        content: [{
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Conta" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Sicoob" }] }] },
          ],
        }],
      }],
    });
    expect(saida).toContain("overflow-x-auto");
    expect(saida).toContain("Sicoob");
  });

  it("checklist marca o item concluído", () => {
    const saida = html({
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "fechado" }] }],
        }],
      }],
    });
    expect(saida).toContain("line-through");
    expect(saida).toContain("fechado");
  });

  it("nó desconhecido não engole o texto dos filhos", () => {
    const saida = html({
      type: "doc",
      content: [{
        type: "extensaoQueAindaNaoExiste",
        content: [{ type: "paragraph", content: [{ type: "text", text: "não pode sumir" }] }],
      }],
    });
    expect(saida).toContain("não pode sumir");
  });

  it("documento vazio avisa em vez de renderizar nada", () => {
    expect(html({ type: "doc", content: [] })).toContain("vazia");
    expect(html(null)).toContain("vazia");
  });
});
