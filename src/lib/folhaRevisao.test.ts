/* A montagem da folha, com o layout simulado.
 *
 * O jsdom não faz layout: toda altura seria zero e tudo caberia numa folha só.
 * Aqui `getBoundingClientRect` é trocado por uma leitura do atributo `data-h`,
 * o que deixa testar a COMPOSIÇÃO — que nenhuma peça se perde, que nenhuma
 * aparece duas vezes e que a fatia de pilha leva os cards certos — sem abrir
 * navegador. O que depende de pixel de verdade (o `encaixar`) fica de fora:
 * `scrollHeight` é sempre 0 no jsdom e a escala nunca é acionada.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { montarDocumento, areaUtil } from "./folhaRevisao";

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const h = Number(this.getAttribute("data-h") ?? 0);
    return { height: h, width: 1046, top: 0, left: 0, right: 1046, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => { document.body.innerHTML = ""; });

/** Uma seção como a que a página renderiza, com as alturas já escolhidas. */
function bloco(titulo: string, pecas: { h: number; nome: string; pilha?: number[] }[]): HTMLElement {
  const sec = document.createElement("section");
  sec.setAttribute("data-revisao-bloco", "");
  sec.setAttribute("data-titulo", titulo);
  const conteudo = document.createElement("div");
  conteudo.setAttribute("data-revisao-conteudo", "");
  for (const p of pecas) {
    const el = document.createElement("div");
    el.setAttribute("data-h", String(p.h));
    el.setAttribute("data-nome", p.nome);
    if (p.pilha) {
      el.setAttribute("data-export-pilha", "");
      p.pilha.forEach((h, i) => {
        const filho = document.createElement("div");
        filho.setAttribute("data-h", String(h));
        filho.setAttribute("data-nome", `${p.nome}.${i}`);
        el.appendChild(filho);
      });
    }
    conteudo.appendChild(el);
  }
  sec.appendChild(conteudo);
  document.body.appendChild(sec);
  return sec;
}

/** Os nomes das peças que foram parar nas folhas, na ordem. */
const nomesNasFolhas = (folhas: HTMLElement[]) =>
  folhas.flatMap((f) => [...f.querySelectorAll("[data-revisao-corpo] > *")].map((el) => el.getAttribute("data-nome")));

describe("montarDocumento", () => {
  const { altura: UTIL } = areaUtil("pdf");

  it("a folha tem o tamanho do papel, com faixa em cima e embaixo", () => {
    const doc = montarDocumento([bloco("Resumo", [{ h: 60, nome: "cab" }])], ["Resumo"], "pdf", "Revisão · Jul/26");
    expect(doc.folhas).toHaveLength(1);
    expect(doc.folhas[0].style.width).toBe("1122px");
    expect(doc.folhas[0].style.height).toBe("793px");
    expect(doc.folhas[0].children).toHaveLength(3); // topo, janela, rodapé
    expect(doc.folhas[0].firstElementChild?.textContent).toContain("Revisão · Jul/26");
    expect(doc.folhas[0].lastElementChild?.textContent).toContain("1 / 1");
    doc.raiz.remove();
  });

  it("o slide do PowerPoint é 16:9 e a folha do PDF é A4 paisagem", () => {
    const s = bloco("Resumo", [{ h: 60, nome: "cab" }]);
    const pdf = montarDocumento([s], ["Resumo"], "pdf", "x");
    const pptx = montarDocumento([s], ["Resumo"], "pptx", "x");
    expect(1122 / 793).toBeCloseTo(297 / 210, 2);
    expect(pptx.folhas[0].style.width).toBe("1280px");
    expect(pptx.folhas[0].style.height).toBe("720px");
    pdf.raiz.remove();
    pptx.raiz.remove();
  });

  it("nenhuma peça se perde nem aparece duas vezes ao quebrar em folhas", () => {
    const doc = montarDocumento(
      [bloco("DRE", [
        { h: 60, nome: "cab" },
        { h: UTIL * 0.7, nome: "cascata" },
        { h: UTIL * 0.7, nome: "tabela" },
        { h: 80, nome: "nota" },
      ])],
      ["DRE"], "pdf", "x",
    );
    expect(doc.folhas.length).toBeGreaterThan(1);
    expect(nomesNasFolhas(doc.folhas)).toEqual(["cab", "cascata", "tabela", "nota"]);
    doc.raiz.remove();
  });

  it("a pilha é repartida em cards inteiros, com o invólucro em cada folha", () => {
    const cada = UTIL * 0.4;
    const doc = montarDocumento(
      [bloco("Pareto", [
        { h: 60, nome: "cab" },
        { h: cada * 5, nome: "rubricas", pilha: [cada, cada, cada, cada, cada] },
      ])],
      ["Pareto"], "pdf", "x",
    );
    const fatias = doc.folhas.flatMap((f) => [...f.querySelectorAll('[data-nome="rubricas"]')]);
    expect(fatias.length).toBeGreaterThan(1);
    // Cada fatia é o mesmo invólucro (mantém a marca e o estilo da lista)…
    for (const f of fatias) expect(f.hasAttribute("data-export-pilha")).toBe(true);
    // …e os cinco cards saíram na ordem, uma vez cada.
    const cards = fatias.flatMap((f) => [...f.children].map((c) => c.getAttribute("data-nome")));
    expect(cards).toEqual(["rubricas.0", "rubricas.1", "rubricas.2", "rubricas.3", "rubricas.4"]);
    doc.raiz.remove();
  });

  it("cada bloco começa em folha nova e a folha diz de qual assunto é", () => {
    const doc = montarDocumento(
      [bloco("Resumo", [{ h: 200, nome: "a" }]), bloco("Caixa", [{ h: 200, nome: "b" }])],
      ["Resumo", "Caixa"], "pdf", "x",
    );
    expect(doc.folhas).toHaveLength(2);
    expect(doc.folhas[0].getAttribute("data-titulo")).toBe("Resumo");
    expect(doc.folhas[1].getAttribute("data-titulo")).toBe("Caixa");
    expect(doc.folhas[1].lastElementChild?.textContent).toContain("2 / 2");
    doc.raiz.remove();
  });

  it("a continuação de um bloco é anunciada na faixa de cima", () => {
    const doc = montarDocumento(
      [bloco("DRE", [{ h: UTIL * 0.8, nome: "a" }, { h: UTIL * 0.8, nome: "b" }])],
      ["DRE"], "pdf", "x",
    );
    expect(doc.folhas).toHaveLength(2);
    expect(doc.folhas[0].firstElementChild?.textContent).toContain("DRE · 1 de 2");
    expect(doc.folhas[1].firstElementChild?.textContent).toContain("DRE · 2 de 2");
    doc.raiz.remove();
  });

  it("o envelope fica fora da tela e sai inteiro quando removido", () => {
    const doc = montarDocumento([bloco("Resumo", [{ h: 100, nome: "a" }])], ["Resumo"], "pdf", "x");
    expect(doc.raiz.style.position).toBe("fixed");
    expect(doc.raiz.style.left).toBe("-200000px");
    expect(document.querySelectorAll("[data-revisao-doc]")).toHaveLength(1);
    // O medidor não fica para trás depois da montagem.
    expect(doc.raiz.querySelectorAll("[data-revisao-folha]")).toHaveLength(1);
    expect(doc.raiz.children).toHaveLength(1);
    doc.raiz.remove();
    expect(document.querySelectorAll("[data-revisao-doc]")).toHaveLength(0);
  });

  it("a tela não é alterada: o que vai para a folha é cópia", () => {
    const sec = bloco("Resumo", [{ h: 100, nome: "a" }, { h: 100, nome: "b" }]);
    const antes = sec.innerHTML;
    const doc = montarDocumento([sec], ["Resumo"], "pdf", "x");
    expect(sec.innerHTML).toBe(antes);
    doc.raiz.remove();
  });
});
