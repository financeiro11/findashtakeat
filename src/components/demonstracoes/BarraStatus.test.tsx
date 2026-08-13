import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarraStatus, SegmentoStatus, SeloPendencia, rotuloPeriodo, CLASSE_SEGMENTO } from "./BarraStatus";

/* A barra de status substituiu quatro blocos empilhados de ~200px por uma linha.
   O que se testa aqui é o que faz ela se comportar como uma linha: o rótulo do
   período, o segmento que some sozinho quando está zerado e a moldura que some
   junto quando não sobra nenhum. */

const segmentos = (html: string) => html.split(`class="${CLASSE_SEGMENTO}`).length - 1;

describe("rotuloPeriodo", () => {
  /* As chaves de coluna são as do blob — abreviação em INGLÊS ("Feb", "Dec"). O
     rótulo que sai é em português, que é o que a tela fala. */
  it("junta o ano quando o intervalo não cruza a virada", () => {
    expect(rotuloPeriodo(["Jan-26", "Feb-26", "Jul-26"])).toBe("JAN–JUL 26");
  });

  it("repete o ano quando cruza", () => {
    expect(rotuloPeriodo(["Nov-25", "Dec-25", "Feb-26"])).toBe("NOV 25–FEV 26");
  });

  it("um mês só não vira intervalo", () => {
    expect(rotuloPeriodo(["Jul-26"])).toBe("JUL 26");
  });

  it("sem coluna nenhuma não há período", () => {
    expect(rotuloPeriodo([])).toBeNull();
  });
});

describe("BarraStatus", () => {
  it("põe período, segmentos e ações na mesma linha", () => {
    const html = renderToStaticMarkup(
      <BarraStatus periodo="JAN–JUL 26" acoes={<button>Regerar</button>}>
        <SegmentoStatus icone={null} valor={10} rotulo="valores manuais" />
        <SegmentoStatus icone={null} valor={131} rotulo="comentários" selo={<SeloPendencia>131 a conferir</SeloPendencia>} />
      </BarraStatus>,
    );
    expect(html).toContain("JAN–JUL 26");
    expect(html).toContain("valores manuais");
    expect(html).toContain("131 a conferir");
    expect(html).toContain("Regerar");
    expect(segmentos(html)).toBe(2);
  });

  it("segmento zerado não aparece — e a moldura se esconde quando não sobra nenhum", () => {
    // É assim que cada Resumo* se cala: devolvendo null.
    const html = renderToStaticMarkup(
      <BarraStatus periodo="JAN–JUL 26">{null}</BarraStatus>,
    );
    expect(segmentos(html)).toBe(0);
    // Quem esconde é o CSS, porque a moldura não tem como se contar.
    expect(html).toContain("[&amp;:not(:has(.seg-status))]:hidden");
  });

  it("o tracinho entre segmentos é regra de irmão adjacente, não elemento avulso", () => {
    // Elemento avulso ficaria órfão quando o vizinho some; a regra acerta sozinha.
    const html = renderToStaticMarkup(<BarraStatus periodo={null}>{null}</BarraStatus>);
    expect(html).toContain(".seg-status+.seg-status");
  });

  it("segmento sem detalhe não vira botão nem ganha seta", () => {
    const semDetalhe = renderToStaticMarkup(
      <BarraStatus periodo={null}><SegmentoStatus icone={null} valor={2} rotulo="perguntas" /></BarraStatus>,
    );
    expect(semDetalhe).not.toContain("<button");

    const comDetalhe = renderToStaticMarkup(
      <BarraStatus periodo={null}>
        <SegmentoStatus icone={null} valor={2} rotulo="perguntas" detalhe={<div>lista</div>} />
      </BarraStatus>,
    );
    expect(comDetalhe).toContain("<button");
  });
});
