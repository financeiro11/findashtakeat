import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PonteVariacao } from "./PonteVariacao";
import { montarPonte, type LancamentoDaPonte } from "@/lib/ponteVariacao";

/* Fumaça: a faixa monta e escreve os números certos.
 *
 * `renderToStaticMarkup` e não testing-library de propósito — a suíte do repo
 * não tem @testing-library/dom instalado, e o que se quer conferir aqui é
 * justamente o que um teste de lógica não pega: que o componente RENDERIZA sem
 * estourar e que o número grande do topo é o mesmo que a coluna DIFERENÇA soma.
 */

let seq = 0;
const l = (contraparte: string, valor: number, data = "2026-07-01"): LancamentoDaPonte => ({
  data, titulo: null, documento: null, contraparte, cnpj_cpf: null,
  categoria_codigo: "3.1.3.8", categoria_descricao: "Eventos e Feiras - Marketing",
  status: "A VENCER", valor, cod_titulo: String(++seq),
});

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const moedaSemCentavos = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const jun = [l("PRINTI", -241.27, "2026-06-10"), l("CLUSTER EVENTOS", -8400, "2026-06-14")];
const jul = [
  l("PRINTI", -241.27), l("PRINTI", -241.27), l("PRINTI", -241.27),
  l("CLUSTER EVENTOS", -3955),
  l("JIM.COM GRUPO SOUZA", -2192.07),
];

const ponte = montarPonte(jul, jun, {
  mes: "Jul-26", mesAnterior: "Jun-26",
  nomeDe: (x) => x.contraparte ?? "Sem contraparte",
});

const render = (extra: Partial<React.ComponentProps<typeof PonteVariacao>> = {}) =>
  renderToStaticMarkup(
    <PonteVariacao
      ponte={ponte}
      comp={null}
      carregando={false}
      celula={ponte.soma}
      celulaAnterior={ponte.somaAnterior}
      travado={false}
      travadoAnterior={false}
      moeda={moeda}
      moedaSemCentavos={moedaSemCentavos}
      obsDe={() => undefined}
      {...extra}
    />,
  );

describe("PonteVariacao", () => {
  it("mostra os dois lados, com os dois meses na linha de conferência", () => {
    const html = render();
    expect(html).toContain("Gastou a mais");
    expect(html).toContain("Economizou");
    expect(html).toContain("Jun 26");
    expect(html).toContain("Jul 26");
    expect(html).toContain("PRINTI");
    expect(html).toContain("JIM.COM GRUPO SOUZA");
    expect(html).toContain("CLUSTER EVENTOS");
    // Quem entrou é dito como "entrou" enquanto o comparativo de 12 meses não
    // chegou: só ele sabe separar "novo" de "trimestral".
    expect(html).toContain("entrou");
  });

  it("os dois grupos somam a variação inteira", () => {
    // Jul -6.870,88 (3×241,27 + 3.955 + 2.192,07) contra Jun -8.641,27
    // (241,27 + 8.400): a rubrica gastou 1.770,39 A MENOS.
    expect(ponte.delta).toBeCloseTo(1_770.39, 2);
    expect(ponte.totalPiora + ponte.totalMelhora).toBeCloseTo(ponte.delta, 6);
    expect(render()).toContain("a variação inteira, no centavo");
  });

  it("o número grande NÃO se repete aqui — quem o carrega é o chip que abriu a faixa", () => {
    const html = render();
    // O delta aparece uma vez só, no rodapé que afirma que a conta fecha.
    expect(html.split("1.770,39").length - 1).toBe(1);
  });

  it("cala enquanto o mês anterior não chegou — senão diria que tudo entrou", () => {
    const html = render({ carregando: true });
    expect(html).toContain("Buscando os lançamentos de Jun 26");
    expect(html).not.toContain("Gastou a mais");
  });

  it("acusa quando a variação da grade é outra (mês travado vem do tracker)", () => {
    const html = render({ celulaAnterior: -100_000, travadoAnterior: true });
    expect(html).toContain("Na grade a variação é");
    expect(html).toContain("está travado");
  });

  it("sem divergência não há faixa de aviso", () => {
    expect(render()).not.toContain("Na grade a variação é");
  });
});
